import {
  buildWeightSeries,
  collapseByDate,
  computeGoalProgress,
  currentMovingAverage,
  latestWeight,
} from "../stats";
import type { WeightEntry, WeightGoal } from "../types";

function entry(date: string, weight: number, updatedAt = 1): WeightEntry {
  return { date, weight, updatedAt };
}

describe("collapseByDate", () => {
  it("keeps the latest entry per date", () => {
    const collapsed = collapseByDate([
      entry("2026-01-01", 80, 1),
      entry("2026-01-01", 81, 2),
      entry("2026-01-02", 79),
    ]);
    expect(collapsed).toHaveLength(2);
    expect(collapsed.find((e) => e.date === "2026-01-01")?.weight).toBe(81);
  });

  it("sorts by date ascending", () => {
    const collapsed = collapseByDate([
      entry("2026-01-03", 78),
      entry("2026-01-01", 80),
      entry("2026-01-02", 79),
    ]);
    expect(collapsed.map((e) => e.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });
});

describe("buildWeightSeries", () => {
  it("returns null MA until the window is full", () => {
    const series = buildWeightSeries(
      [entry("2026-01-01", 80), entry("2026-01-02", 81)],
      7
    );
    expect(series).toHaveLength(2);
    expect(series[0].ma).toBeNull();
    expect(series[1].ma).toBeNull();
  });

  it("computes trailing average once window is full", () => {
    const weights = [80, 81, 82, 83, 84, 85, 86];
    const series = buildWeightSeries(
      weights.map((w, i) => entry(`2026-01-0${i + 1}`, w)),
      7
    );
    const last = series[series.length - 1];
    expect(last.ma).toBeCloseTo(83, 5);
  });

  it("uses only the last windowDays measurements", () => {
    const weights = [100, 100, 100, 100, 100, 100, 100, 70];
    const series = buildWeightSeries(
      weights.map((w, i) => entry(`2026-02-${String(i + 1).padStart(2, "0")}`, w)),
      7
    );
    const last = series[series.length - 1];
    // last 7: 100×6 + 70 = 670/7
    expect(last.ma).toBeCloseTo(670 / 7, 5);
  });
});

describe("currentMovingAverage", () => {
  it("returns null for empty history", () => {
    expect(currentMovingAverage([], 7)).toBeNull();
  });

  it("averages available points when fewer than window", () => {
    const ma = currentMovingAverage(
      [entry("2026-01-01", 80), entry("2026-01-02", 82)],
      7
    );
    expect(ma).toBeCloseTo(81, 5);
  });
});

describe("computeGoalProgress", () => {
  const goal: WeightGoal = { startWeight: 80, targetWeight: 75 };

  it("reports no goal when target missing", () => {
    const p = computeGoalProgress([entry("2026-01-01", 80)], {
      startWeight: 80,
      targetWeight: null,
    });
    expect(p.hasGoal).toBe(false);
    expect(p.progress).toBe(0);
  });

  it("computes progress toward weight-loss goal", () => {
    const p = computeGoalProgress([entry("2026-01-01", 80), entry("2026-01-08", 77.5)], goal);
    expect(p.currentWeight).toBe(77.5);
    expect(p.remainingKg).toBeCloseTo(2.5, 5);
    // (80-77.5)/(80-75) = 0.5
    expect(p.progress).toBeCloseTo(0.5, 5);
    expect(p.reached).toBe(false);
  });

  it("marks reached when target is passed", () => {
    const p = computeGoalProgress([entry("2026-01-01", 80), entry("2026-01-08", 74)], goal);
    expect(p.reached).toBe(true);
    expect(p.progress).toBe(1);
  });

  it("supports weight-gain goals", () => {
    const gainGoal: WeightGoal = { startWeight: 60, targetWeight: 65 };
    const p = computeGoalProgress(
      [entry("2026-01-01", 60), entry("2026-01-08", 62.5)],
      gainGoal
    );
    expect(p.progress).toBeCloseTo(0.5, 5);
    expect(p.reached).toBe(false);
    expect(p.remainingKg).toBeCloseTo(-2.5, 5);
  });

  it("derives start from first entry when goal.startWeight is null", () => {
    const p = computeGoalProgress(
      [entry("2026-01-01", 82), entry("2026-01-08", 80)],
      { startWeight: null, targetWeight: 78 }
    );
    expect(p.startWeight).toBe(82);
    expect(p.progress).toBeCloseTo(0.5, 5);
  });
});

describe("latestWeight", () => {
  it("returns null when empty", () => {
    expect(latestWeight([])).toBeNull();
  });

  it("returns the chronologically last entry", () => {
    const latest = latestWeight([
      entry("2026-01-02", 79),
      entry("2026-01-01", 80),
    ]);
    expect(latest?.weight).toBe(79);
  });
});
