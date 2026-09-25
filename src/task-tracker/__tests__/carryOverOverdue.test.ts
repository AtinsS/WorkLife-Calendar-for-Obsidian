import { get } from "svelte/store";
import { tasks, carryOverOverdueTasks, resetCarryOverGuardForTests } from "../stores";
import { settings } from "../../ui/stores";
import type { ITask } from "../types";

function makeOverdueTask(overrides: Partial<ITask> = {}): ITask {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const y = yesterday.getFullYear();
  const m = String(yesterday.getMonth() + 1).padStart(2, "0");
  const d = String(yesterday.getDate()).padStart(2, "0");

  return {
    id: "task-overdue-1",
    title: "Overdue todo",
    completed: false,
    dateUID: `day-${y}-${m}-${d}T00:00:00+00:00`,
    projectId: null,
    notePath: null,
    priority: "medium",
    tags: [],
    sortOrder: 0,
    status: "todo",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function todayUIDPrefix(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `day-${y}-${m}-${d}`;
}

describe("carryOverOverdueTasks respects carryOverOverdue setting", () => {
  beforeEach(() => {
    resetCarryOverGuardForTests();
    tasks.set([]);
    settings.update((s) => ({ ...s, carryOverOverdue: true }));
  });

  it("does NOT carry over when the setting is off", () => {
    settings.update((s) => ({ ...s, carryOverOverdue: false }));
    tasks.set([makeOverdueTask()]);

    carryOverOverdueTasks();

    const after = get(tasks);
    expect(after).toHaveLength(1);
    expect(after[0].dateUID).toMatch(/^day-\d{4}-\d{2}-\d{2}/);
    expect(after[0].dateUID.startsWith(todayUIDPrefix())).toBe(false);
    expect(after[0].carriedOverFrom).toBeUndefined();
  });

  it("does NOT treat undefined setting as enabled", () => {
    settings.update((s) => {
      const next = { ...s };
      delete (next as { carryOverOverdue?: boolean }).carryOverOverdue;
      return next;
    });
    tasks.set([makeOverdueTask()]);

    carryOverOverdueTasks();

    expect(get(tasks)[0].carriedOverFrom).toBeUndefined();
    expect(get(tasks)[0].dateUID.startsWith(todayUIDPrefix())).toBe(false);
  });

  it("carries over when the setting is on", () => {
    settings.update((s) => ({ ...s, carryOverOverdue: true }));
    const overdue = makeOverdueTask();
    tasks.set([overdue]);

    carryOverOverdueTasks();

    const after = get(tasks);
    expect(after).toHaveLength(1);
    expect(after[0].dateUID.startsWith(todayUIDPrefix())).toBe(true);
    expect(after[0].carriedOverFrom).toBe(overdue.dateUID);
  });

  it("does not carry over twice on the same day", () => {
    settings.update((s) => ({ ...s, carryOverOverdue: true }));
    tasks.set([makeOverdueTask()]);

    carryOverOverdueTasks();
    const first = get(tasks)[0].dateUID;

    // Put another overdue task and call again the same day
    tasks.set([makeOverdueTask({ id: "task-overdue-2", title: "Second" })]);
    carryOverOverdueTasks();

    expect(get(tasks)[0].dateUID.startsWith(todayUIDPrefix())).toBe(false);
    expect(first.startsWith(todayUIDPrefix())).toBe(true);
  });

  it("skips non-todo tasks", () => {
    settings.update((s) => ({ ...s, carryOverOverdue: true }));
    tasks.set([
      makeOverdueTask({ id: "done-1", status: "done", completed: true }),
      makeOverdueTask({ id: "prog-1", status: "progress" }),
    ]);

    carryOverOverdueTasks();

    for (const t of get(tasks)) {
      expect(t.carriedOverFrom).toBeUndefined();
      expect(t.dateUID.startsWith(todayUIDPrefix())).toBe(false);
    }
  });
});
