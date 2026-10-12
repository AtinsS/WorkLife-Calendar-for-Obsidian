import { get } from "svelte/store";
import {
  addTask,
  tasks,
  updateTask,
  updateTaskStatus,
  isWorkoutSession,
  resolveWorkoutStreakDateKey,
  resolveWorkoutStreakHabitId,
} from "../stores";
import {
  addHabit,
  habits,
  habitLogs,
  isHabitCompletedOnDate,
  calculateStreak,
  rebuildLogsCache,
} from "../../habit-tracker/stores";
import { settings } from "../../ui/stores";
import { defaultSettings } from "../../settings";
import type { ITask } from "../types";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeWorkoutTask(overrides: Partial<ITask> = {}): ITask {
  return {
    id: "wo-1",
    title: "Workout: push",
    completed: false,
    status: "todo",
    dateUID: `day-${todayKey()}T00:00:00+00:00`,
    projectId: null,
    priority: "medium",
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    kind: "workout",
    workoutLocation: "gym",
    workoutDayKey: "push",
    ...overrides,
  };
}

describe("workout streak on task done", () => {
  let habitId: string;

  beforeEach(() => {
    tasks.set([]);
    habitLogs.set([]);
    habits.set([]);
    rebuildLogsCache();
    settings.set({ ...defaultSettings });

    const habit = addHabit({
      title: "Workout streak",
      icon: "\uD83D\uDCAA",
      color: "#1b7942",
      frequency: "weekly",
      targetCount: 1,
      archived: false,
      sortOrder: 0,
      projectId: "workout-streak",
    });
    habitId = habit.id;
    settings.set({ ...defaultSettings, workoutHabitId: habitId });
  });

  it("resolveWorkoutStreakDateKey parses day-YYYY-MM-DD dateUID", () => {
    expect(resolveWorkoutStreakDateKey("day-2026-02-20T00:00:00+00:00")).toBe("2026-02-20");
    expect(resolveWorkoutStreakDateKey("day-2026-02-20")).toBe("2026-02-20");
  });

  it("isWorkoutSession detects kind and parent kind", () => {
    tasks.set([
      makeWorkoutTask({ id: "parent", isRecurringInstance: false, parentTaskId: undefined }),
      makeWorkoutTask({
        id: "inst",
        kind: undefined,
        workoutDayKey: undefined,
        isRecurringInstance: true,
        parentTaskId: "parent",
      }),
      makeWorkoutTask({ id: "plain", kind: undefined, workoutDayKey: undefined }),
    ]);
    expect(isWorkoutSession(get(tasks).find((t) => t.id === "parent"))).toBe(true);
    expect(isWorkoutSession(get(tasks).find((t) => t.id === "inst"))).toBe(true);
    expect(isWorkoutSession(get(tasks).find((t) => t.id === "plain"))).toBe(false);
  });

  it("resolveWorkoutStreakHabitId falls back to projectId workout-streak", () => {
    settings.set({ ...defaultSettings });
    expect(resolveWorkoutStreakHabitId()).toBe(habitId);
  });

  it("marks habit done when updateTaskStatus moves todo → done", () => {
    tasks.set([makeWorkoutTask()]);
    updateTaskStatus("wo-1", "done");

    expect(isHabitCompletedOnDate(habitId, todayKey())).toBe(true);
    expect(calculateStreak(habitId)).toBe(1);
  });

  it("marks habit done when updateTaskStatus moves progress → done (timer path)", () => {
    tasks.set([makeWorkoutTask({ status: "progress", timerStartedAt: Date.now() })]);
    updateTaskStatus("wo-1", "done");

    const after = get(tasks).find((t) => t.id === "wo-1");
    expect(after?.status).toBe("done");
    expect(after?.completed).toBe(true);
    expect(isHabitCompletedOnDate(habitId, todayKey())).toBe(true);
  });

  it("marks habit done when updateTaskStatus moves paused → done", () => {
    tasks.set([makeWorkoutTask({ status: "paused", pausedAt: Date.now(), pausedWorkTime: 0 })]);
    updateTaskStatus("wo-1", "done");

    expect(isHabitCompletedOnDate(habitId, todayKey())).toBe(true);
  });

  it("marks habit done when updateTask({ completed: true }) without status change", () => {
    tasks.set([makeWorkoutTask({ status: "progress" })]);
    updateTask("wo-1", { completed: true });

    expect(isHabitCompletedOnDate(habitId, todayKey())).toBe(true);
  });

  it("marks habit done when updateTask({ status: 'done' })", () => {
    tasks.set([makeWorkoutTask()]);
    updateTask("wo-1", { status: "done" });

    expect(isHabitCompletedOnDate(habitId, todayKey())).toBe(true);
  });

  it("does not double-tick when already completed", () => {
    tasks.set([makeWorkoutTask({ completed: true, status: "done" })]);
    updateTaskStatus("wo-1", "todo");
    updateTaskStatus("wo-1", "done");

    expect(isHabitCompletedOnDate(habitId, todayKey())).toBe(true);
    const logs = get(habitLogs).filter((l) => l.habitId === habitId && l.date === todayKey());
    expect(logs).toHaveLength(1);
  });

  it("ignores non-workout tasks", () => {
    tasks.set([makeWorkoutTask({ kind: undefined, workoutDayKey: undefined })]);
    updateTaskStatus("wo-1", "done");

    expect(isHabitCompletedOnDate(habitId, todayKey())).toBe(false);
  });

  it("addTask + done for recurring instance with parent workout ticks streak", () => {
    const parent = addTask(
      makeWorkoutTask({ id: "ignored", title: "Workout series" }) as never,
    );
    // addTask generates its own id — re-seed via store for a clean instance
    tasks.set([
      makeWorkoutTask({ id: "parent", title: parent.title, isRecurringInstance: false, parentTaskId: undefined }),
      makeWorkoutTask({
        id: "inst",
        title: parent.title,
        kind: undefined,
        workoutDayKey: undefined,
        isRecurringInstance: true,
        parentTaskId: "parent",
      }),
    ]);

    updateTaskStatus("inst", "done");
    expect(isHabitCompletedOnDate(habitId, todayKey())).toBe(true);
  });
});
