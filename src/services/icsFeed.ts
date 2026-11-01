/**
 * Minimal iCalendar (RFC 5545) reader for subscribed calendars (ICS feeds).
 *
 * Scope: VEVENT parsing + a practical RRULE subset (DAILY/WEEKLY/MONTHLY/YEARLY,
 * INTERVAL, COUNT, UNTIL, BYMONTH, BYMONTHDAY, BYDAY) + EXDATE. Sufficient for
 * holiday feeds and typical Google/Outlook exports. BYSETPOS/BYWEEKNO/RDATE are
 * not supported.
 *
 * Timezone note: DTSTART/DTEND with the `Z` suffix are absolute instants;
 * TZID and floating times are treated as local wall-clock (no TZ database).
 */

export interface IcsRRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  /** Inclusive last occurrence date "YYYY-MM-DD" (date part of UNTIL). */
  untilDate?: string;
  byMonth?: number[];
  byMonthDay?: number[];
  /** 0 = Monday … 6 = Sunday; `ordinal` is 1..5 / -1 for BYDAY in MONTHLY/YEARLY. */
  byDay?: { day: number; ordinal?: number }[];
}

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  allDay: boolean;
  /** "YYYY-MM-DD" of the (first) occurrence. */
  startDate: string;
  /** Exclusive "YYYY-MM-DD"; only for all-day events. */
  endDate?: string;
  /** Local wall-clock ms; only for timed events. */
  startMs?: number;
  endMs?: number;
  rrule?: IcsRRule;
  /** Excluded occurrence keys: "YYYY-MM-DD" (all-day) or String(ms) (timed). */
  exdates: string[];
}

export interface IcsCalendar {
  name?: string;
  description?: string;
  events: IcsEvent[];
}

/** One concrete occurrence after RRULE expansion. */
export interface IcsOccurrence {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  allDay: boolean;
  startDate: string;
  endDate?: string;
  startMs?: number;
  endMs?: number;
}

// ── date helpers (pure YYYY-MM-DD arithmetic, UTC-anchored to dodge DST) ──

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function keyToParts(key: string): { y: number; m: number; d: number } {
  return { y: +key.slice(0, 4), m: +key.slice(5, 7), d: +key.slice(8, 10) };
}

function keyToUtcMs(key: string): number {
  const { y, m, d } = keyToParts(key);
  return Date.UTC(y, m - 1, d);
}

function utcMsToKey(ms: number): string {
  const dt = new Date(ms);
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function addDaysKey(key: string, days: number): string {
  return utcMsToKey(keyToUtcMs(key) + days * 86400000);
}

/** Weekday of a date key, 0 = Monday … 6 = Sunday. */
function weekdayOf(key: string): number {
  const dt = new Date(keyToUtcMs(key));
  return (dt.getUTCDay() + 6) % 7;
}

function addMonthsParts(y: number, m: number, d: number, months: number): { y: number; m: number; d: number } {
  const total = (y * 12 + (m - 1)) + months;
  return { y: Math.floor(total / 12), m: (total % 12) + 1, d };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ── value parsing ──

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1");
}

function unfoldLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/);
}

interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseContentLine(line: string): ContentLine | null {
  // NAME;PARAM=VAL;PARAM2="q:uoted":value
  const m = /^([A-Za-z0-9-]+)((?:;[^:]*)*):([\s\S]*)$/.exec(line);
  if (!m) return null;
  const name = m[1].toUpperCase();
  const params: Record<string, string> = {};
  const rawParams = m[2] || "";
  const paramRe = /;([A-Za-z0-9-]+)=("(?:[^"]*)"|[^;:]*)/g;
  let pm: RegExpExecArray | null;
  while ((pm = paramRe.exec(rawParams)) !== null) {
    let val = pm[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params[pm[1].toUpperCase()] = val;
  }
  return { name, params, value: m[3] };
}

interface DateParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  isUtc: boolean;
}

function parseIcsDateTime(value: string): { parts: DateParts; isDate: boolean } | null {
  const v = value.trim();
  const dm = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dm) {
    return { parts: { y: +dm[1], mo: +dm[2], d: +dm[3], h: 0, mi: 0, s: 0, isUtc: false }, isDate: true };
  }
  const tm = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (tm) {
    return {
      parts: {
        y: +tm[1], mo: +tm[2], d: +tm[3],
        h: +tm[4], mi: +tm[5], s: +tm[6],
        isUtc: tm[7] === "Z",
      },
      isDate: false,
    };
  }
  return null;
}

function partsToLocalMs(p: DateParts): number {
  return p.isUtc
    ? Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
    : new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s).getTime();
}

function parseRRuleValue(value: string): IcsRRule | null {
  const fields: Record<string, string> = {};
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    fields[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = fields.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;

  const rule: IcsRRule = {
    freq,
    interval: Math.max(1, parseInt(fields.INTERVAL || "1", 10) || 1),
  };
  if (fields.COUNT) rule.count = parseInt(fields.COUNT, 10) || undefined;
  if (fields.UNTIL) {
    const parsed = parseIcsDateTime(fields.UNTIL);
    if (parsed) rule.untilDate = keyOf(parsed.parts.y, parsed.parts.mo, parsed.parts.d);
  }
  if (fields.BYMONTH) {
    rule.byMonth = fields.BYMONTH.split(",").map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= 12);
  }
  if (fields.BYMONTHDAY) {
    rule.byMonthDay = fields.BYMONTHDAY.split(",").map((x) => parseInt(x, 10)).filter((n) => n !== 0 && Math.abs(n) <= 31);
  }
  if (fields.BYDAY) {
    const names: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
    const list: { day: number; ordinal?: number }[] = [];
    for (const token of fields.BYDAY.split(",")) {
      const bm = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token.trim().toUpperCase());
      if (!bm) continue;
      const item: { day: number; ordinal?: number } = { day: names[bm[2]] };
      if (bm[1]) item.ordinal = parseInt(bm[1], 10);
      list.push(item);
    }
    if (list.length) rule.byDay = list;
  }
  return rule;
}

// ── VEVENT parsing ──

function collectValues(block: string[], name: string): ContentLine[] {
  return block
    .map(parseContentLine)
    .filter((l): l is ContentLine => l !== null && l.name === name);
}

function parseEventBlock(block: string[]): IcsEvent | null {
  const startLines = collectValues(block, "DTSTART");
  if (startLines.length === 0) return null;
  const startLine = startLines[0];
  const startParsed = parseIcsDateTime(startLine.value);
  if (!startParsed) return null;

  const allDay = (startLine.params.VALUE || "").toUpperCase() === "DATE" || startParsed.isDate;
  const uid = collectValues(block, "UID")[0]?.value.trim() || `generated-${startParsed.parts.y}${pad2(startParsed.parts.mo)}${pad2(startParsed.parts.d)}`;
  const summary = unescapeText(collectValues(block, "SUMMARY")[0]?.value || "").trim() || "(без названия)";
  const descLine = collectValues(block, "DESCRIPTION")[0];
  const locLine = collectValues(block, "LOCATION")[0];

  const event: IcsEvent = {
    uid,
    summary,
    allDay,
    startDate: keyOf(startParsed.parts.y, startParsed.parts.mo, startParsed.parts.d),
    exdates: [],
  };
  if (descLine) event.description = unescapeText(descLine.value).trim() || undefined;
  if (locLine) event.location = unescapeText(locLine.value).trim() || undefined;

  const endParsed = collectValues(block, "DTEND")
    .map((l) => parseIcsDateTime(l.value))
    .find((p) => p !== null);

  if (allDay) {
    event.endDate = endParsed
      ? keyOf(endParsed.parts.y, endParsed.parts.mo, endParsed.parts.d)
      : addDaysKey(event.startDate, 1);
  } else {
    event.startMs = partsToLocalMs(startParsed.parts);
    if (endParsed) event.endMs = partsToLocalMs(endParsed.parts);
  }

  const rruleLine = collectValues(block, "RRULE")[0];
  if (rruleLine) {
    const rule = parseRRuleValue(rruleLine.value);
    if (rule) event.rrule = rule;
  }

  for (const line of collectValues(block, "EXDATE")) {
    for (const raw of line.value.split(",")) {
      const parsed = parseIcsDateTime(raw);
      if (!parsed) continue;
      if (allDay) {
        event.exdates.push(keyOf(parsed.parts.y, parsed.parts.mo, parsed.parts.d));
      } else {
        event.exdates.push(String(partsToLocalMs(parsed.parts)));
      }
    }
  }

  return event;
}

export function parseIcs(text: string): IcsCalendar {
  const cal: IcsCalendar = { events: [] };
  const lines = unfoldLines(text);
  let inCalendar = false;
  let block: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^BEGIN:VCALENDAR/i.test(line)) {
      inCalendar = true;
      continue;
    }
    if (/^END:VCALENDAR/i.test(line)) {
      inCalendar = false;
      continue;
    }
    if (/^BEGIN:VEVENT/i.test(line)) {
      block = [];
      continue;
    }
    if (/^END:VEVENT/i.test(line)) {
      if (block) {
        const ev = parseEventBlock(block);
        if (ev) cal.events.push(ev);
      }
      block = null;
      continue;
    }
    if (block) {
      block.push(line);
      continue;
    }
    if (inCalendar) {
      const parsed = parseContentLine(line);
      if (!parsed) continue;
      if (parsed.name === "X-WR-CALNAME") cal.name = unescapeText(parsed.value).trim();
      else if (parsed.name === "X-WR-CALDESC") cal.description = unescapeText(parsed.value).trim();
    }
  }
  return cal;
}

// ── RRULE expansion ──

const MAX_ITERATIONS = 5000;

function occurrenceKeys(event: IcsEvent, rule: IcsRRule, rangeEndKey: string): string[] {
  const keys: string[] = [];
  const start = event.startDate;
  const untilKey = rule.untilDate;
  let produced = 0;

  /** Returns false when expansion should stop (range end or COUNT reached). */
  const push = (key: string): boolean => {
    if (untilKey && key > untilKey) return false;
    if (key > rangeEndKey) return false;
    // COUNT bounds the rule expansion before EXDATE exclusion (RFC 5545).
    produced += 1;
    const withinCount = rule.count === undefined || produced < rule.count;
    if (event.exdates.includes(key)) return withinCount;
    keys.push(key);
    return withinCount;
  };

  /** Pick keys by BYDAY ordinal from the matching days of a month. */
  const pickByDay = (year: number, month: number): string[] => {
    const dim = daysInMonth(year, month);
    const out: string[] = [];
    for (const bd of rule.byDay || []) {
      const matches: string[] = [];
      for (let day = 1; day <= dim; day += 1) {
        const key = keyOf(year, month, day);
        if (weekdayOf(key) === bd.day) matches.push(key);
      }
      if (bd.ordinal) {
        const idx = bd.ordinal > 0 ? bd.ordinal - 1 : matches.length + bd.ordinal;
        const picked = matches[idx];
        if (picked) out.push(picked);
      } else {
        out.push(...matches);
      }
    }
    return out.sort();
  };

  const ymd = keyToParts(start);
  let iterations = 0;

  if (rule.freq === "DAILY") {
    for (let i = 0; iterations < MAX_ITERATIONS; i += 1, iterations += 1) {
      const key = addDaysKey(start, i * rule.interval);
      if (key > rangeEndKey) break;
      if (!push(key)) break;
    }
  } else if (rule.freq === "WEEKLY") {
    const days = (rule.byDay && rule.byDay.length
      ? rule.byDay.map((b) => b.day)
      : [weekdayOf(start)]
    ).slice().sort((a, b) => a - b);
    let week = 0;
    while (iterations < MAX_ITERATIONS) {
      const weekStart = addDaysKey(start, week * rule.interval * 7);
      for (const day of days) {
        const offset = (day - weekdayOf(weekStart) + 7) % 7;
        const key = addDaysKey(weekStart, offset);
        if (key < start) continue;
        if (!push(key)) return keys;
      }
      week += 1;
      iterations += 1;
      if (weekStart > rangeEndKey) break;
    }
  } else if (rule.freq === "MONTHLY") {
    const useByDay = !!rule.byDay && rule.byDay.some((b) => b.ordinal !== undefined);
    let offset = 0;
    while (iterations < MAX_ITERATIONS) {
      const next = addMonthsParts(ymd.y, ymd.m, ymd.d, offset * rule.interval);
      let candidates: string[];
      if (useByDay) {
        candidates = pickByDay(next.y, next.m);
      } else {
        const dim = daysInMonth(next.y, next.m);
        const mds = rule.byMonthDay && rule.byMonthDay.length
          ? rule.byMonthDay
          : [ymd.d];
        candidates = mds
          .map((md) => (md > 0 ? md : dim + md + 1))
          .filter((day) => day >= 1 && day <= dim)
          .map((day) => keyOf(next.y, next.m, day))
          .sort();
      }
      for (const key of candidates) {
        if (key < start) continue;
        if (!push(key)) return keys;
      }
      offset += 1;
      iterations += 1;
      if (keyOf(next.y, next.m, 1) > rangeEndKey) break;
    }
  } else {
    // YEARLY
    const months = (rule.byMonth && rule.byMonth.length ? rule.byMonth : [ymd.m])
      .slice()
      .sort((a, b) => a - b);
    let offset = 0;
    while (iterations < MAX_ITERATIONS) {
      const year = ymd.y + offset * rule.interval;
      for (const month of months) {
        let candidates: string[];
        const useDayRule = !!rule.byDay && (!rule.byMonthDay || rule.byMonthDay.length === 0);
        if (useDayRule) {
          candidates = pickByDay(year, month);
        } else {
          const dim = daysInMonth(year, month);
          const mds = rule.byMonthDay && rule.byMonthDay.length ? rule.byMonthDay : [ymd.d];
          candidates = mds
            .map((md) => (md > 0 ? md : dim + md + 1))
            .filter((day) => day >= 1 && day <= dim)
            .map((day) => keyOf(year, month, day))
            .sort();
        }
        for (const key of candidates) {
          if (key < start) continue;
          if (!push(key)) return keys;
        }
      }
      offset += 1;
      iterations += 1;
      if (year > +rangeEndKey.slice(0, 4)) break;
    }
  }
  return keys;
}

/**
 * Expand calendar events into concrete occurrences overlapping
 * [rangeStart, rangeEnd) (local dates). Recurring events are expanded with
 * the RRULE subset; EXDATE entries are skipped.
 */
export function expandIcsEvents(cal: IcsCalendar, rangeStart: Date, rangeEnd: Date): IcsOccurrence[] {
  const startKey = keyOf(rangeStart.getFullYear(), rangeStart.getMonth() + 1, rangeStart.getDate());
  // Half-open range [rangeStart, rangeEnd): the last included day ends right before rangeEnd.
  const lastDay = new Date(rangeEnd.getTime() - 1);
  const endKey = keyOf(lastDay.getFullYear(), lastDay.getMonth() + 1, lastDay.getDate());
  const out: IcsOccurrence[] = [];

  for (const ev of cal.events) {
    const durationDays = ev.allDay
      ? Math.max(1, diffDays(ev.startDate, ev.endDate || addDaysKey(ev.startDate, 1)))
      : 0;
    const durationMs = ev.allDay ? 0 : Math.max(0, (ev.endMs ?? ev.startMs ?? 0) - (ev.startMs ?? 0));

    const single = (key: string): IcsOccurrence => {
      const occ: IcsOccurrence = {
        uid: ev.uid,
        summary: ev.summary,
        description: ev.description,
        location: ev.location,
        allDay: ev.allDay,
        startDate: key,
      };
      if (ev.allDay) {
        occ.endDate = addDaysKey(key, durationDays);
      } else {
        const shiftDays = diffDays(ev.startDate, key);
        const base = ev.startMs ?? 0;
        occ.startMs = base + shiftDays * 86400000;
        occ.endMs = occ.startMs + durationMs;
      }
      return occ;
    };

    const overlaps = (occ: IcsOccurrence): boolean => {
      if (occ.allDay) {
        return occ.startDate <= endKey && (occ.endDate || occ.startDate) > startKey;
      }
      const s = occ.startMs ?? 0;
      const e = occ.endMs ?? s;
      const rangeStartMs = rangeStart.getTime();
      const rangeEndMs = rangeEnd.getTime();
      return s < rangeEndMs && e >= rangeStartMs;
    };

    if (!ev.rrule) {
      const occ = single(ev.startDate);
      if (overlaps(occ)) out.push(occ);
      continue;
    }
    for (const key of occurrenceKeys(ev, ev.rrule, endKey)) {
      const occ = single(key);
      if (overlaps(occ)) out.push(occ);
    }
  }
  return out;
}

function diffDays(a: string, b: string): number {
  return Math.round((keyToUtcMs(b) - keyToUtcMs(a)) / 86400000);
}
