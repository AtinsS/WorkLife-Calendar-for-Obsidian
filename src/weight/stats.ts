import type { WeightEntry, WeightGoal } from "./types";

export interface WeightPoint {
  date: string;
  weight: number;
  /** Moving average at this date (null until enough history) */
  ma: number | null;
}

export interface GoalProgress {
  hasGoal: boolean;
  startWeight: number | null;
  targetWeight: number | null;
  currentWeight: number | null;
  /** Signed kg left to target (positive = still to lose/gain depending on direction) */
  remainingKg: number | null;
  /** 0–1 progress toward target */
  progress: number;
  /** true when target is reached or passed */
  reached: boolean;
}

/** One measurement per date: keep the latest entry for that day. */
export function collapseByDate(entries: WeightEntry[]): WeightEntry[] {
  const byDate = new Map<string, WeightEntry>();
  for (const e of entries) {
    const prev = byDate.get(e.date);
    if (!prev || e.updatedAt >= prev.updatedAt) {
      byDate.set(e.date, e);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Trailing moving average over measurement days.
 * For each date D, MA = mean of the last `windowDays` measurements up to and including D.
 */
export function buildWeightSeries(
  entries: WeightEntry[],
  windowDays = 7
): WeightPoint[] {
  const collapsed = collapseByDate(entries);
  const points: WeightPoint[] = [];
  const recent: number[] = [];

  for (const e of collapsed) {
    recent.push(e.weight);
    if (recent.length > windowDays) recent.shift();
    const ma =
      recent.length >= windowDays
        ? recent.reduce((s, v) => s + v, 0) / recent.length
        : null;
    points.push({ date: e.date, weight: e.weight, ma });
  }
  return points;
}

/** Latest collapsed measurement, or null. */
export function latestWeight(entries: WeightEntry[]): WeightEntry | null {
  const collapsed = collapseByDate(entries);
  return collapsed.length > 0 ? collapsed[collapsed.length - 1] : null;
}

/** Moving average at the latest date (falls back to average of available window). */
export function currentMovingAverage(
  entries: WeightEntry[],
  windowDays = 7
): number | null {
  const series = buildWeightSeries(entries, windowDays);
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  if (last.ma !== null) return last.ma;
  // Not enough points for full window — average what we have
  const n = Math.min(series.length, windowDays);
  const slice = series.slice(series.length - n);
  return slice.reduce((s, p) => s + p.weight, 0) / n;
}

export function computeGoalProgress(
  entries: WeightEntry[],
  goal: WeightGoal
): GoalProgress {
  const latest = latestWeight(entries);
  const currentWeight = latest ? latest.weight : null;
  const startWeight = goal.startWeight ?? (entries.length > 0 ? collapseByDate(entries)[0].weight : null);
  const targetWeight = goal.targetWeight;

  if (targetWeight == null || startWeight == null || currentWeight == null) {
    return {
      hasGoal: targetWeight != null,
      startWeight,
      targetWeight,
      currentWeight,
      remainingKg: targetWeight != null && currentWeight != null ? currentWeight - targetWeight : null,
      progress: 0,
      reached: false,
    };
  }

  const total = startWeight - targetWeight;
  const done = startWeight - currentWeight;
  const remainingKg = currentWeight - targetWeight;

  // Goal can be loss (total > 0) or gain (total < 0)
  let progress = 0;
  if (total === 0) {
    progress = remainingKg === 0 ? 1 : 0;
  } else {
    progress = done / total;
  }
  progress = Math.max(0, Math.min(1, progress));

  const reached =
    total === 0
      ? remainingKg === 0
      : total > 0
        ? currentWeight <= targetWeight
        : currentWeight >= targetWeight;

  return {
    hasGoal: true,
    startWeight,
    targetWeight,
    currentWeight,
    remainingKg,
    progress,
    reached,
  };
}
