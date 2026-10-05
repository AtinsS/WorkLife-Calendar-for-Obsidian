import type { ITask } from "../types";
import { getTaskSlotEndMs, isTaskOverdue, DEFAULT_SLOT_MINUTES } from "../overdue";

function makeTask(overrides: Partial<ITask> = {}): ITask {
  return {
    id: "t1",
    title: "Test",
    completed: false,
    status: "todo",
    dateUID: "day-2026-06-15",
    projectId: null,
    priority: "medium",
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Local Date for 2026-06-15 HH:MM */
function at(h: number, m = 0): number {
  return new Date(2026, 5, 15, h, m, 0, 0).getTime();
}

describe("task overdue window", () => {
  it("is NOT overdue at scheduled start", () => {
    const t = makeTask({ scheduledTime: "10:00" });
    expect(isTaskOverdue(t, at(10, 0))).toBe(false);
    expect(isTaskOverdue(t, at(10, 30))).toBe(false);
  });

  it("becomes overdue only after default slot (60 min)", () => {
    const t = makeTask({ scheduledTime: "10:00" });
    expect(getTaskSlotEndMs(t)).toBe(at(11, 0));
    expect(isTaskOverdue(t, at(10, 59))).toBe(false);
    expect(isTaskOverdue(t, at(11, 0))).toBe(true);
  });

  it("uses endTime when set", () => {
    const t = makeTask({ scheduledTime: "10:00", endTime: "12:30" });
    expect(getTaskSlotEndMs(t)).toBe(at(12, 30));
    expect(isTaskOverdue(t, at(12, 0))).toBe(false);
    expect(isTaskOverdue(t, at(12, 30))).toBe(true);
  });

  it("uses estimatedTime when no endTime", () => {
    const t = makeTask({ scheduledTime: "10:00", estimatedTime: 30 });
    expect(getTaskSlotEndMs(t)).toBe(at(10, 30));
    expect(isTaskOverdue(t, at(10, 15))).toBe(false);
    expect(isTaskOverdue(t, at(10, 30))).toBe(true);
  });

  it("handles overnight endTime", () => {
    const t = makeTask({ scheduledTime: "23:00", endTime: "01:00" });
    expect(getTaskSlotEndMs(t)).toBe(at(25, 0)); // next day 01:00
  });

  it("never marks in-progress / done as overdue", () => {
    const t = makeTask({ scheduledTime: "08:00", status: "progress" });
    expect(isTaskOverdue(t, at(20, 0))).toBe(false);
    const done = makeTask({ scheduledTime: "08:00", status: "done", completed: true });
    expect(isTaskOverdue(done, at(20, 0))).toBe(false);
  });

  it("DEFAULT_SLOT_MINUTES is 60", () => {
    expect(DEFAULT_SLOT_MINUTES).toBe(60);
  });
});
