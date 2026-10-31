// Shared regex quick-add parser — used by QuickAddModal (single mode, line fallback)
// and by aiQuickAdd's JSON-failure fallback so both paths parse dates/times identically.
import type { Moment } from "moment";
import { get } from "svelte/store";
import { locale } from "../i18n";

export const wm = window.moment as (inp?: unknown, format?: string, strict?: boolean) => Moment;

// Date keyword maps — RU includes inflected forms: "в пятницу", "до пятницы", "к среде"
export const RU_DAYS: Record<string, number> = {
  "пн": 1, "понедельник": 1, "понедельника": 1, "понедельнику": 1,
  "вт": 2, "вторник": 2, "вторника": 2, "вторнику": 2,
  "ср": 3, "среда": 3, "среду": 3, "среды": 3, "среде": 3,
  "чт": 4, "четверг": 4, "четверга": 4, "четвергу": 4,
  "пт": 5, "пятница": 5, "пятницу": 5, "пятницы": 5, "пятнице": 5,
  "сб": 6, "суббота": 6, "субботу": 6, "субботы": 6, "субботе": 6,
  "вс": 7, "воскресенье": 7, "воскресенья": 7, "воскресенью": 7,
};

export const EN_DAYS: Record<string, number> = {
  "mon": 1, "monday": 1,
  "tue": 2, "tuesday": 2,
  "wed": 3, "wednesday": 3,
  "thu": 4, "thursday": 4,
  "fri": 5, "friday": 5,
  "sat": 6, "saturday": 6,
  "sun": 7, "sunday": 7,
};

export const RU_MONTHS: Record<string, number> = {
  "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
  "мая": 5, "июня": 6, "июля": 7, "августа": 8,
  "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
};

export const EN_MONTHS: Record<string, number> = {
  "january": 1, "february": 2, "march": 3, "april": 4,
  "may": 5, "june": 6, "july": 7, "august": 8,
  "september": 9, "october": 10, "november": 11, "december": 12,
  "jan": 1, "feb": 2, "mar": 3, "apr": 4,
  "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
};

/** "9" / "9:30" / "09:5" → "HH:MM"; invalid ("25:00") → null. */
export function normalizeTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = m[2] !== undefined ? parseInt(m[2], 10) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export interface ParsedSegment {
  type: "priority" | "date" | "time" | "project" | "title";
  text: string;
  start: number;
  end: number;
}

export interface ParsedResult {
  title: string;
  scheduledTime: string | null;
  endTime: string | null;
  priority: "low" | "medium" | "high" | null;
  date: Moment | null;
  dateLabel: string | null;
  projectName: string | null;
  segments: ParsedSegment[];
}

export function parseQuickInput(raw: string, nowInput?: Date): ParsedResult {
  const text = raw.trim();
  const loc = get(locale) === "en" ? "en" : "ru";
  const now = wm(nowInput);
  const found: ParsedSegment[] = [];
  let scheduledTime: string | null = null;
  let endTime: string | null = null;
  let priority: "low" | "medium" | "high" | null = null;
  let date: Moment | null = null;
  let dateLabel: string | null = null;
  let projectName: string | null = null;

  // --- 1. Find priority at start ---
  const prioRe = /^(!{1,2}|~|-)\s*/;
  const prioM = prioRe.exec(text);
  if (prioM) {
    const p = prioM[1];
    priority = p === "!" || p === "!!" ? "high" : p === "~" ? "medium" : "low";
    found.push({ type: "priority", text: prioM[0], start: 0, end: prioM[0].length });
  }

  // --- 2. Find all date tokens anywhere ---
  const dayMap = loc === "en" ? EN_DAYS : { ...EN_DAYS, ...RU_DAYS };
  const monthMap = loc === "en" ? EN_MONTHS : RU_MONTHS;

  const datePatterns: Array<{ re: RegExp; resolve: (m: RegExpMatchArray) => { date: Moment; label: string } | null }> = [
    // завтра / tomorrow
    { re: /(?:^|\s)(завтра|завтр|tomorrow)(?:\s|$)/gi, resolve: () => ({ date: now.clone().add(1, "day"), label: loc === "en" ? "tomorrow" : "завтра" }) },
    // сегодня / today
    { re: /(?:^|\s)(сегодня|today)(?:\s|$)/gi, resolve: () => ({ date: now.clone(), label: loc === "en" ? "today" : "сегодня" }) },
    // послезавтра / day after tomorrow
    { re: /(?:^|\s)(послезавтра|day after tomorrow|dat)(?:\s|$)/gi, resolve: () => ({ date: now.clone().add(2, "day"), label: loc === "en" ? "day after tomorrow" : "послезавтра" }) },
    // +N days
    { re: /\+(\d{1,3})(?:\s|$)/g, resolve: (m) => { const d = parseInt(m[1]); return d > 0 && d <= 365 ? { date: now.clone().add(d, "day"), label: `+${d}` } : null; } },
    // "следующий/next" + weekday → unified semantics with the AI prompts:
    // the upcoming such day; if today IS that weekday — the one in a week.
    {
      re: new RegExp(
        `(?:^|\\s)(?:следующ[а-яё]*|next|будущ[а-яё]*)\\s+(${Object.keys(dayMap).join("|")})(?:\\s|$)`,
        "gi",
      ),
      resolve: (m) => {
        const key = m[1].toLowerCase();
        const num = dayMap[key];
        if (num === undefined) return null;
        const momentDay = num === 7 ? 0 : num;
        const target = now.clone().day(momentDay);
        if (!target.isAfter(now, "day")) target.add(1, "week");
        return { date: target, label: m[0].trim() };
      },
    },
    // weekday names, optionally with a preposition: "в пятницу", "до пятницы", "к среде", "с понедельника"
    { re: new RegExp(`(?:^|\\s)(?:(?:в|во|до|к|ко|с|со)\\s+)?(${Object.keys(dayMap).join("|")})(?:\\s|$)`, "gi"), resolve: (m) => {
      const key = m[1].toLowerCase();
      const num = dayMap[key];
      if (num === undefined) return null;
      const momentDay = num === 7 ? 0 : num;
      const target = now.clone().day(momentDay);
      if (target.isBefore(now, "day")) target.add(1, "week");
      return { date: target, label: m[1].toLowerCase() };
    }},
    // DD.MM or DD/MM
    { re: /(?:^|\s)(\d{1,2})[./](\d{1,2})(?:\s|$)/g, resolve: (m) => {
      const day = parseInt(m[1]), month = parseInt(m[2]);
      if (day < 1 || day > 31 || month < 1 || month > 12) return null;
      const target = wm({ year: now.year(), month: month - 1, day });
      if (target.isBefore(now, "day")) target.add(1, "year");
      return { date: target, label: m[0].trim() };
    }},
    // DD месяц (e.g. "25 июля")
    { re: new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(${Object.keys(monthMap).join("|")})(?:\\s|$)`, "gi"), resolve: (m) => {
      const day = parseInt(m[1]);
      const monthNum = monthMap[m[2].toLowerCase()];
      if (day < 1 || day > 31 || monthNum === undefined) return null;
      const target = wm({ year: now.year(), month: monthNum - 1, day });
      if (target.isBefore(now, "day")) target.add(1, "year");
      return { date: target, label: m[0].trim() };
    }},
    // YYYY-MM-DD
    { re: /(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?:\s|$)/g, resolve: (m) => {
      const target = wm(`${m[1]}-${m[2]}-${m[3]}`, "YYYY-MM-DD", true);
      return target.isValid() ? { date: target, label: m[0].trim() } : null;
    }},
  ];

  for (const { re, resolve } of datePatterns) {
    let m: RegExpMatchArray | null;
    while ((m = re.exec(text)) !== null) {
      const result = resolve(m);
      if (result) {
        date = result.date;
        dateLabel = result.label;
        found.push({ type: "date", text: m[0], start: m.index, end: m.index + m[0].length });
        break; // take first date match
      }
    }
    if (date) break;
  }

  // --- 3. Find all time tokens anywhere ---
  // Prepositions в/во/с/со are part of the token (the old `\b(?:в\s*)?` never fired
  // before Cyrillic "в" and left a dangling "в" in titles). "по" joins ranges
  // ("с 16 по 17"). Duration phrases like "2-3 часа" / "в 5 минут" are not times.
  const DUR_GUARD =
    "(?!\\s*(?:час[а-яё]*|ч\\b|мин[а-яё]*|минут[а-яё]*|раз[а-яё]*|день|дня|дней|недел[а-яё]*|месяц[а-яё]*|год[а-яё]*))";

  // "с 16-17", "с 16:00 до/по 17:00", "в 16-17", "во 2-3" — preposition + range
  const rangeRe = new RegExp(
    `(?<![\\p{L}\\d])(?:во|в|со|с)\\s*(\\d{1,2}(?::\\d{2})?)\\s*(?:по|до|[-–—])\\s*(\\d{1,2}(?::\\d{2})?)(?!\\d)${DUR_GUARD}`,
    "giu",
  );
  let rangeM: RegExpMatchArray | null;
  while ((rangeM = rangeRe.exec(text)) !== null) {
    const start = normalizeTime(rangeM[1]);
    const end = normalizeTime(rangeM[2]);
    if (!start) continue;
    scheduledTime = start;
    endTime = end;
    found.push({ type: "time", text: rangeM[0], start: rangeM.index, end: rangeM.index + rangeM[0].length });
    break;
  }

  // "16:00-17:00" without preposition (only if no range found)
  if (!scheduledTime) {
    const dashRe = /(?<![\p{L}\d])(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})(?![\d:])/gu;
    const dashM = dashRe.exec(text);
    if (dashM) {
      const start = normalizeTime(dashM[1]);
      const end = normalizeTime(dashM[2]);
      if (start) {
        scheduledTime = start;
        endTime = end;
        found.push({ type: "time", text: dashM[0], start: dashM.index, end: dashM.index + dashM[0].length });
      }
    }
  }
  if (!scheduledTime) {
    // Bare "14-15" = 14:00–15:00, but "2-3 часа"/"3-4 раза" are DURATION ranges, not times.
    const dashRe2 = new RegExp(
      `(?<![\\p{L}\\d])(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2})(?!\\d)${DUR_GUARD}`,
      "giu",
    );
    const dashM2 = dashRe2.exec(text);
    if (dashM2) {
      const start = normalizeTime(dashM2[1]);
      const end = normalizeTime(dashM2[2]);
      if (start) {
        scheduledTime = start;
        endTime = end;
        found.push({ type: "time", text: dashM2[0], start: dashM2.index, end: dashM2.index + dashM2[0].length });
      }
    }
  }

  // Single: "в 16:00" / "с 16:00" / "в 16" (bare hour with preposition) / "16:00"
  if (!scheduledTime) {
    const singleRe = new RegExp(
      `(?<![\\p{L}\\d])(?:(?:во|в|со|с)\\s+(\\d{1,2}(?::\\d{2})?)(?![\\d:.])|(\\d{1,2}:\\d{2})(?![\\d:]))${DUR_GUARD}`,
      "giu",
    );
    let singleM: RegExpMatchArray | null;
    while ((singleM = singleRe.exec(text)) !== null) {
      const raw = singleM[1] ?? singleM[2];
      const start = normalizeTime(raw);
      if (!start) continue;
      scheduledTime = start;
      found.push({ type: "time", text: singleM[0], start: singleM.index, end: singleM.index + singleM[0].length });
      break;
    }
  }

  // --- 3.5. Find @Project token ---
  // Single word after @ — prefix matching handles multi-word project names
  const projRe = /(?:^|\s)@(\S+)/g;
  const projM = projRe.exec(text);
  if (projM) {
    projectName = projM[1].trim();
    const start = projM.index + (projM[0].length - projM[1].length - 1);
    found.push({ type: "project", text: projM[0].trim(), start, end: projM.index + projM[0].length });
  }

  // --- 4. Sort found tokens by position and build segments ---
  found.sort((a, b) => a.start - b.start);

  const segments: ParsedSegment[] = [];
  let cursor = 0;
  for (const tok of found) {
    // Skip priority if it overlaps with something else
    if (tok.type === "priority" && tok.start > 0) continue;
    // Add title text before this token
    if (tok.start > cursor) {
      const gap = text.slice(cursor, tok.start);
      if (gap.trim()) segments.push({ type: "title", text: gap, start: cursor, end: tok.start });
    }
    segments.push(tok);
    cursor = tok.end;
  }
  // Remaining text after last token
  if (cursor < text.length) {
    const rest = text.slice(cursor);
    if (rest.trim()) segments.push({ type: "title", text: rest, start: cursor, end: text.length });
  }

  // Extract title from segments
  const titleParts = segments.filter((s) => s.type === "title").map((s) => s.text.trim()).filter(Boolean);
  const title = titleParts.join(" ");

  return { title, scheduledTime, endTime, priority, date, dateLabel, projectName, segments };
}

/** "на 1 час", "1 hour", "2 ч", "2ч", "30 минут" → minutes. */
export function parseDurationFromText(text: string): number | null {
  // NB: `(?:\s|\b)` used to fail for "2ч" at end-of-string (Cyrillic "ч" is non-word → no \b),
  // and `[а-я]` missed "ё". Use (?![а-яё\w]) as the trailing guard instead.
  const m =
    /(?:на\s+)?(\d{1,3})\s*(?:час[а-яё]*|ч|h|hr|hours?)(?![а-яё\w])/iu.exec(text) ||
    /(?:на\s+)?(\d{1,3})\s*(?:минут[а-яё]*|м(?:ин)?|min(?:ute)?s?)(?![а-яё\w])/iu.exec(text);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  // first regex is hours, second is minutes
  const isHours = /(?:на\s+)?\d{1,3}\s*(?:ч|час|h|hr|hour)/i.test(m[0]);
  const mins = isHours ? n * 60 : n;
  return Math.max(15, Math.min(8 * 60, mins));
}

/** Split free text into task lines (newlines, bullets, numbered lists, ";"). */
export function splitTaskLines(raw: string): string[] {
  return raw
    .split(/\n+|;| \+ /)
    .map((l) => l.replace(/^\s*[-*•]\s+/, "").replace(/^\s*\d+[.)]\s+/, "").trim())
    .filter((l) => l && !l.startsWith("{") && !l.startsWith("```"));
}
