import { get } from "svelte/store";
import {
  tasks,
  clearRecurringSeries,
  tombstoneOccurrenceDate,
  generateMonthlyRecurringTasks,
  createNextRecurringInstance,
} from "../stores";
import type { ITask } from "../types";

function makeTask(overrides: Partial<ITask> = {}): ITask {
  return {
    id: "t-base",
    title: "Recurring",
    completed: false,
    status: "todo",
    dateUID: "day-2026-10-01",
    projectId: null,
    priority: "medium",
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("clearRecurringSeries", () => {
  it("removes the parent, its instances and chained instances, keeps unrelated", () => {
    tasks.set([
      makeTask({
        id: "parent",
        title: "Standup",
        recurrence: { type: "daily", interval: 1 },
      }),
      makeTask({
        id: "inst-1",
        title: "Standup",
        dateUID: "day-2026-10-02",
        isRecurringInstance: true,
        parentTaskId: "parent",
      }),
      makeTask({
        id: "inst-2",
        title: "Standup",
        dateUID: "day-2026-10-03",
        isRecurringInstance: true,
        // chained off another instance (createNextRecurringInstance behavior)
        parentTaskId: "inst-1",
      }),
      makeTask({ id: "other", title: "Unrelated" }),
    ]);

    const res = clearRecurringSeries("parent");
    const left = get(tasks).map((t) => t.id).sort();
    expect(left).toEqual(["other"]);
    expect(res).toEqual({ parentCount: 1, instanceCount: 2 });
  });
});

describe("tombstoneOccurrenceDate", () => {
  it("records the deleted date on the parent recurrence", () => {
    tasks.set([
      makeTask({
        id: "parent",
        recurrence: { type: "daily", interval: 1 },
      }),
      makeTask({
        id: "inst-1",
        dateUID: "day-2026-10-02",
        isRecurringInstance: true,
        parentTaskId: "parent",
      }),
    ]);

    tombstoneOccurrenceDate("parent", "2026-10-02");
    const parent = get(tasks).find((t) => t.id === "parent");
    expect(parent?.recurrence?.deletedDates).toEqual(["2026-10-02"]);

    // idempotent
    tombstoneOccurrenceDate("parent", "2026-10-02");
    expect(get(tasks).find((t) => t.id === "parent")?.recurrence?.deletedDates).toEqual(["2026-10-02"]);
  });
});

describe("recurring generators respect tombstones", () => {
  beforeEach(() => {
    tasks.set([
      makeTask({
        id: "parent",
        title: "Standup",
        dateUID: "day-2026-10-01",
        recurrence: { type: "daily", interval: 1, deletedDates: ["2026-10-02"] },
      }),
    ]);
  });

  it("generateMonthlyRecurringTasks skips deleted dates", () => {
    generateMonthlyRecurringTasks("parent");
    const dates = get(tasks)
      .filter((t) => t.isRecurringInstance)
      .map((t) => t.dateUID);
    expect(dates.some((d) => d.startsWith("day-2026-10-02"))).toBe(false);
    expect(dates.some((d) => d.startsWith("day-2026-10-03"))).toBe(true);
  });

  it("createNextRecurringInstance does not recreate a deleted occurrence", () => {
    createNextRecurringInstance("parent");
    const dates = get(tasks).map((t) => t.dateUID);
    expect(dates.some((d) => d.startsWith("day-2026-10-02"))).toBe(false);
    expect(get(tasks).length).toBe(1); // only the parent
  });
});
