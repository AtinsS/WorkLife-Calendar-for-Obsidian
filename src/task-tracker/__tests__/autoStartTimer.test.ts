import { get } from "svelte/store";
import { tasks, updateTaskStatus } from "../stores";
import { settings } from "../../ui/stores";
import { defaultSettings } from "../../settings";
import type { ITask } from "../types";

function makeTask(overrides: Partial<ITask> = {}): ITask {
  return {
    id: "t1",
    title: "Task",
    completed: false,
    status: "todo",
    dateUID: "day-2026-02-20T00:00:00+00:00",
    projectId: null,
    priority: "medium",
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("autoStartTimerOnWork setting", () => {
  beforeEach(() => {
    tasks.set([]);
  });

  it("starts the timer by default when moving to progress", () => {
    settings.set({ ...defaultSettings, autoStartTimerOnWork: true });
    tasks.set([makeTask()]);
    updateTaskStatus("t1", "progress");

    const t = get(tasks).find((x) => x.id === "t1");
    expect(t?.status).toBe("progress");
    expect(t?.timerStartedAt).toBeDefined();
  });

  it("does not start the timer when autoStartTimerOnWork is false", () => {
    settings.set({ ...defaultSettings, autoStartTimerOnWork: false });
    tasks.set([makeTask()]);
    updateTaskStatus("t1", "progress");

    const t = get(tasks).find((x) => x.id === "t1");
    expect(t?.status).toBe("progress");
    expect(t?.timerStartedAt).toBeUndefined();
    expect(t?.completed).toBe(false);
  });

  it("paused → progress also respects the setting", () => {
    settings.set({ ...defaultSettings, autoStartTimerOnWork: false });
    tasks.set([makeTask({ status: "paused", pausedAt: 1, pausedWorkTime: 0 })]);
    updateTaskStatus("t1", "progress");

    const t = get(tasks).find((x) => x.id === "t1");
    expect(t?.status).toBe("progress");
    expect(t?.timerStartedAt).toBeUndefined();
  });
});
