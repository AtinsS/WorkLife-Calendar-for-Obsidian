import type { ITask } from "./types";

/** Parse "YYYY-MM-DD" from dateUID + "HH:MM" into local epoch ms. */
function toLocalMs(date: string, time: string): number | null {
  const [h, m] = time.split(":").map(Number);
  if ([h, m].some((n) => Number.isNaN(n))) return null;
  const d = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function dateOf(dateUID: string): string | null {
  return /^day-(\d{4}-\d{2}-\d{2})/.exec(dateUID)?.[1] ?? null;
}

/** Default planned slot length when the task has no end/estimate (matches schedule grid). */
export const DEFAULT_SLOT_MINUTES = 60;

/**
 * End of the task's planned slot in local epoch ms.
 * Order: explicit endTime → scheduledTime + estimatedTime → scheduledTime + DEFAULT_SLOT_MINUTES.
 * Overnight endTime (end <= start) rolls to the next day.
 * Returns null when the task has no scheduled time / usable date.
 */
export function getTaskSlotEndMs(task: ITask, defaultSlotMinutes = DEFAULT_SLOT_MINUTES): number | null {
  const date = dateOf(task.dateUID);
  if (!date || !task.scheduledTime) return null;

  const startMs = toLocalMs(date, task.scheduledTime);
  if (startMs === null) return null;

  if (task.endTime) {
    let endMs = toLocalMs(date, task.endTime);
    if (endMs === null) return startMs + defaultSlotMinutes * 60_000;
    if (endMs <= startMs) endMs += 24 * 60 * 60_000; // overnight
    return endMs;
  }

  const extraMin = task.estimatedTime && task.estimatedTime > 0 ? task.estimatedTime : defaultSlotMinutes;
  return startMs + extraMin * 60_000;
}

/**
 * True only when the planned slot has already ended and the task is still open.
 * Being "in progress" / "paused" is not overdue — the user is working on it.
 */
export function isTaskOverdue(task: ITask, nowMs: number = Date.now(), defaultSlotMinutes?: number): boolean {
  if (task.completed || task.status === "done") return false;
  if (task.status === "progress" || task.status === "paused") return false;

  const endMs = getTaskSlotEndMs(task, defaultSlotMinutes);
  if (endMs === null) {
    // No time window: overdue only when the whole day is in the past.
    const date = dateOf(task.dateUID);
    if (!date) return false;
    const endOfDay = toLocalMs(date, "23:59");
    return endOfDay !== null && nowMs > endOfDay + 60_000;
  }
  return nowMs >= endMs;
}

/** Milliseconds since the slot ended (0 when not overdue). */
export function overdueDurationMs(task: ITask, nowMs: number = Date.now()): number {
  const endMs = getTaskSlotEndMs(task);
  if (endMs === null || nowMs < endMs) return 0;
  if (task.completed || task.status === "done" || task.status === "progress" || task.status === "paused") return 0;
  return nowMs - endMs;
}
