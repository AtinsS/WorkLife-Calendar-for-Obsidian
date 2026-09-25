import {
  habitLogs,
  getHabitDailySeries,
  summarizeHabitSeries,
  rebuildLogsCache,
} from "../stores";
import type { IHabitLog } from "../types";

function log(id: string, habitId: string, date: string, count = 1): IHabitLog {
  return { id, habitId, date, completed: true, count };
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("getHabitDailySeries", () => {
  beforeEach(() => {
    habitLogs.set([]);
    rebuildLogsCache();
  });

  it("returns empty counts for the requested window", () => {
    const points = getHabitDailySeries(7);
    expect(points).toHaveLength(7);
    expect(points.every((p) => p.count === 0)).toBe(true);
    expect(points[points.length - 1].date).toBe(dateStr(0));
    expect(points[0].date).toBe(dateStr(6));
  });

  it("counts completions per day", () => {
    habitLogs.set([
      log("a", "h1", dateStr(0), 1),
      log("b", "h2", dateStr(0), 1),
      log("c", "h1", dateStr(1), 1),
    ]);
    rebuildLogsCache();

    const points = getHabitDailySeries(3);
    expect(points[points.length - 1].count).toBe(2);
    expect(points[points.length - 2].count).toBe(1);
    expect(points[0].count).toBe(0);
  });

  it("filters by habitId", () => {
    habitLogs.set([
      log("a", "h1", dateStr(0), 1),
      log("b", "h2", dateStr(0), 1),
    ]);
    rebuildLogsCache();

    const onlyH1 = getHabitDailySeries(1, "h1");
    expect(onlyH1).toHaveLength(1);
    expect(onlyH1[0].count).toBe(1);
  });

  it("ignores incomplete logs", () => {
    habitLogs.set([
      { id: "x", habitId: "h1", date: dateStr(0), completed: false, count: 2 },
    ]);
    rebuildLogsCache();

    const points = getHabitDailySeries(1);
    expect(points[0].count).toBe(0);
  });
});

describe("summarizeHabitSeries", () => {
  it("computes totals, active days and best day", () => {
    const summary = summarizeHabitSeries([
      { date: "2026-01-01", count: 0 },
      { date: "2026-01-02", count: 3 },
      { date: "2026-01-03", count: 1 },
      { date: "2026-01-04", count: 2 },
    ]);

    expect(summary.total).toBe(6);
    expect(summary.activeDays).toBe(3);
    expect(summary.maxCount).toBe(3);
    expect(summary.bestDay).toEqual({ date: "2026-01-02", count: 3 });
    expect(summary.avgPerDay).toBeCloseTo(1.5);
  });

  it("handles empty series", () => {
    const summary = summarizeHabitSeries([]);
    expect(summary.total).toBe(0);
    expect(summary.activeDays).toBe(0);
    expect(summary.bestDay).toBeNull();
    expect(summary.avgPerDay).toBe(0);
  });
});
