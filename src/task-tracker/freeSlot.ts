/**
 * Free-slot helpers for task creation (QuickAdd + AI ops).
 * Pure date/time logic — no i18n, no UI, no heavy deps (avoids import cycles).
 */

export interface BusySlot {
  scheduledTime?: string;
  endTime?: string;
  estimatedTime?: number;
}

export interface DayLoad {
  date: string;
  busy: BusySlot[];
}

/**
 * Compact per-day busy summary for AI scheduling prompts, e.g.
 * `2026-02-09: busy 10:00-11:00, 14:00-15:30 (2.5h booked)`.
 */
export function buildLoadSummary(entries: DayLoad[]): string {
  const lines: string[] = [];
  for (const { date, busy } of entries) {
    const blocks: string[] = [];
    let total = 0;
    for (const t of busy) {
      const start = parseHHMM(t.scheduledTime);
      if (start === null) continue;
      const end = slotEnd(start, t);
      blocks.push(`${t.scheduledTime}-${fmtHHMM(end)}`);
      total += end - start;
    }
    blocks.sort();
    if (blocks.length === 0) {
      lines.push(`${date}: free`);
    } else {
      const hours = Math.round((total / 60) * 10) / 10;
      lines.push(`${date}: busy ${blocks.join(", ")} (${hours}h booked)`);
    }
  }
  return lines.join("\n");
}

const DAY_START = 9 * 60;
const DAY_END = 21 * 60;

function parseHHMM(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fmtHHMM(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Accepts `day-YYYY-MM-DD…`, `day-YYYY-MM-DD`, or bare `YYYY-MM-DD`. */
export function dateStrFromUID(dateUID: string | null | undefined): string | null {
  if (!dateUID) return null;
  const m = /(\d{4}-\d{2}-\d{2})/.exec(dateUID);
  return m ? m[1] : null;
}

function slotEnd(start: number, t: BusySlot): number {
  const end = parseHHMM(t.endTime);
  if (end !== null && end > start) return end;
  const dur = t.estimatedTime && t.estimatedTime > 0 ? t.estimatedTime : 60;
  return start + dur;
}

/** First free HH:MM window of `durationMin` that does not overlap `busy`. */
export function findFreeSlot(
  busy: BusySlot[],
  durationMin = 60,
  dayStart = DAY_START,
  dayEnd = DAY_END,
): { scheduledTime: string; endTime: string } | null {
  const dur = Math.max(15, Math.min(8 * 60, Math.round(durationMin) || 60));
  const blocks: Array<[number, number]> = [];
  for (const t of busy) {
    const start = parseHHMM(t.scheduledTime);
    if (start === null) continue;
    const end = slotEnd(start, t);
    blocks.push([start, Math.max(end, start + 15)]);
  }
  blocks.sort((a, b) => a[0] - b[0]);

  let cursor = dayStart;
  for (const [s, e] of blocks) {
    if (s - cursor >= dur) break;
    if (e > cursor) cursor = e;
  }

  const snapped = Math.ceil(cursor / 30) * 30;
  const start = Math.max(snapped, dayStart);
  if (start + dur > dayEnd) return null;
  return { scheduledTime: fmtHHMM(start), endTime: fmtHHMM(start + dur) };
}

/** True when [start, start+dur) intersects any busy block. */
export function slotOverlaps(
  busy: BusySlot[],
  scheduledTime: string,
  endTime?: string | null,
  durationMin = 60,
): boolean {
  const start = parseHHMM(scheduledTime);
  if (start === null) return true;
  const dur = Math.max(15, durationMin || 60);
  const endMin = endTime ? parseHHMM(endTime) : null;
  const end = endMin !== null ? endMin : start + dur;
  for (const t of busy) {
    const s = parseHHMM(t.scheduledTime);
    if (s === null) continue;
    const e = slotEnd(s, t);
    if (start < e && s < end) return true;
  }
  return false;
}

export interface CreateTimeInput {
  dateStr: string;
  scheduledTime?: string | null;
  endTime?: string | null;
  estimatedMinutes?: number;
  busy?: BusySlot[];
  /** Always take a free slot even if the given time looks valid. */
  forceFreeSlot?: boolean;
  /**
   * Place into a free slot when the user did not give a clock time.
   * Off by default: a task without time stays untimed unless explicitly requested.
   */
  pickFreeSlot?: boolean;
}

export interface CreateTimeResult {
  scheduledTime: string | null;
  endTime: string | null;
  estimatedMinutes: number;
}

/** True when the user text explicitly asks to pick a free slot. */
export function wantsFreeSlotPlacement(text: string): boolean {
  // NB: `\w` is ASCII-only — "свободн\w*" never matched "свободный/свободное" (Cyrillic).
  return /подбери\s+(?:свободн[а-яё]*\s+)?слот|свободн[а-яё]*\s+(?:слот|время|место)|найди\s+(?:свободн[а-яё]*\s+)?(?:время|слот|место)|place\s+(?:it\s+)?in\s+a?\s*free|pick\s+a?\s*free\s+slot|find\s+a?\s*free\s+(?:slot|time)|free\s+slot/i.test(
    text,
  );
}

/**
 * Resolve create-time fields.
 * Keeps a clear non-overlapping time. Without a clock time the task stays
 * untimed unless the user asked for a free slot (`pickFreeSlot` / `forceFreeSlot`).
 * Returns null when a free slot was requested but the day has no room.
 */
export function resolveCreateTimes(input: CreateTimeInput): CreateTimeResult | null {
  const dur = Math.max(15, Math.min(8 * 60, Math.round(input.estimatedMinutes || 0) || 60));
  const busy = input.busy ?? [];
  const rawStart = (input.scheduledTime || "").trim();
  const rawEnd = (input.endTime || "").trim();
  const hasTime = !!rawStart;
  const wantSlot = !!input.pickFreeSlot || !!input.forceFreeSlot;

  const clean =
    hasTime &&
    !input.forceFreeSlot &&
    !slotOverlaps(busy, rawStart, rawEnd || null, dur);

  if (clean) {
    const endMin = parseHHMM(rawEnd);
    const startMin = parseHHMM(rawStart);
    const end =
      endMin !== null && startMin !== null && endMin > startMin
        ? rawEnd
        : fmtHHMM((parseHHMM(rawStart) ?? DAY_START) + dur);
    return { scheduledTime: rawStart, endTime: end, estimatedMinutes: dur };
  }

  // No clock time and no free-slot request → leave the task untimed.
  if (!hasTime && !wantSlot) {
    return { scheduledTime: null, endTime: null, estimatedMinutes: dur };
  }

  const slot = findFreeSlot(busy, dur);
  if (!slot) return null;
  return {
    scheduledTime: slot.scheduledTime,
    endTime: slot.endTime,
    estimatedMinutes: dur,
  };
}
