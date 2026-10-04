import { get } from "svelte/store";
import { tasks, updateRecurringSeries } from "../stores";
import type { ITask } from "../types";

function makeTask(overrides: Partial<ITask> = {}): ITask {
  return {
    id: "t-base",
    title: "Recurring",
    completed: false,
    dateUID: "day-2026-10-01T00:00:00+00:00",
    projectId: null,
    priority: "medium",
    sortOrder: 0,
    status: "todo",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("updateRecurringSeries", () => {
  beforeEach(() => {
    tasks.set([
      makeTask({
        id: "parent",
        title: "Standup",
        recurrence: { type: "daily", interval: 1 },
        projectId: null,
      }),
      makeTask({
        id: "inst-1",
        title: "Standup",
        dateUID: "day-2026-10-02T00:00:00+00:00",
        isRecurringInstance: true,
        parentTaskId: "parent",
        projectId: null,
      }),
      makeTask({
        id: "inst-2",
        title: "Standup",
        dateUID: "day-2026-10-03T00:00:00+00:00",
        isRecurringInstance: true,
        parentTaskId: "parent",
        projectId: null,
        status: "done",
        completed: true,
        totalWorkTime: 60000,
      }),
      makeTask({
        id: "other",
        title: "Unrelated",
        projectId: null,
      }),
    ]);
  });

  it("applies projectId to parent and every instance", () => {
    updateRecurringSeries("parent", { projectId: "proj-1" });

    const byId = new Map(get(tasks).map((t) => [t.id, t]));
    expect(byId.get("parent")?.projectId).toBe("proj-1");
    expect(byId.get("inst-1")?.projectId).toBe("proj-1");
    expect(byId.get("inst-2")?.projectId).toBe("proj-1");
    expect(byId.get("other")?.projectId).toBeNull();
  });

  it("keeps per-instance state (status, date, work time) intact", () => {
    updateRecurringSeries("parent", {
      projectId: "proj-1",
      title: "Daily standup",
      dateUID: "day-2026-11-01T00:00:00+00:00",
    });

    const byId = new Map(get(tasks).map((t) => [t.id, t]));
    expect(byId.get("parent")?.dateUID).toBe("day-2026-11-01T00:00:00+00:00");
    expect(byId.get("inst-1")?.dateUID).toBe("day-2026-10-02T00:00:00+00:00");
    expect(byId.get("inst-2")?.dateUID).toBe("day-2026-10-03T00:00:00+00:00");

    expect(byId.get("inst-2")?.status).toBe("done");
    expect(byId.get("inst-2")?.completed).toBe(true);
    expect(byId.get("inst-2")?.totalWorkTime).toBe(60000);
    expect(byId.get("inst-1")?.status).toBe("todo");
  });

  it("propagates title to all instances", () => {
    updateRecurringSeries("parent", { title: "Daily standup" });

    const titles = get(tasks)
      .filter((t) => t.id === "parent" || t.parentTaskId === "parent")
      .map((t) => t.title);
    expect(titles).toEqual(["Daily standup", "Daily standup", "Daily standup"]);
  });
});
