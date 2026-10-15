import { get } from "svelte/store";
import { getDateUID } from "obsidian-daily-notes-interface";
import { momentFn } from "../utils/moment";
import {
  addTask,
  generateMonthlyRecurringTasks,
  getChecklistForTask,
  setChecklistForTask,
  tasks as tasksStore,
} from "../task-tracker/stores";
import type { ITask } from "../task-tracker/types";
import { formatExercise, type WorkoutDayPlan, type WorkoutPlan } from "./types";

export interface CreateWorkoutPlanInput {
  plan: WorkoutPlan;
  /** Plan start date (local calendar day). */
  startDate: Date;
  /** Optional project for all created tasks. */
  projectId: string | null;
  scheduledTime?: string;
  estimatedMinutes?: number;
  /** Output language for exercise line formatting. */
  lang?: "ru" | "en";
}

export interface CreateWorkoutPlanResult {
  parentIds: string[];
  instanceCount: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function endOfPlan(start: Date, weeks: number): Date {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  // Inclusive until: start + weeks*7 - 1
  end.setDate(end.getDate() + Math.max(1, weeks) * 7 - 1);
  return end;
}

/** First date on/after start that falls on the given weekday (0=Sun). */
export function firstDateOnOrAfter(start: Date, dayOfWeek: number): Date {
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const delta = ((dayOfWeek - d.getDay()) % 7 + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export function exerciseTitles(day: WorkoutDayPlan, lang: "ru" | "en" = "en"): string[] {
  return day.exercises.map((e) => formatExercise(e, lang));
}

function copyChecklistToInstances(parentId: string, titles: string[]): number {
  const all = get(tasksStore);
  const instances = all.filter((t) => t.isRecurringInstance && t.parentTaskId === parentId);
  for (const inst of instances) {
    if (getChecklistForTask(inst.id).length === 0) {
      setChecklistForTask(inst.id, titles);
    }
  }
  return instances.length;
}

/**
 * Materialize a WorkoutPlan as recurring task series.
 * Each plan day → one weekly series with `until` at plan end.
 */
export function createWorkoutPlanTasks(input: CreateWorkoutPlanInput): CreateWorkoutPlanResult {
  const { plan, startDate, projectId } = input;
  const untilDate = endOfPlan(startDate, plan.weeks);
  const untilUID = getDateUID(
    momentFn(toDateKey(untilDate), "YYYY-MM-DD"),
    "day",
  );

  const parentIds: string[] = [];
  let instanceCount = 0;

  for (const day of plan.days) {
    const first = firstDateOnOrAfter(startDate, day.dayOfWeek);
    const dateUID = getDateUID(momentFn(toDateKey(first), "YYYY-MM-DD"), "day");
    const titles = exerciseTitles(day, input.lang || "en");
    // Exercises go to the checklist (subtasks) only — not into description.
    const estimated = day.estimatedMinutes || input.estimatedMinutes || plan.days[0]?.estimatedMinutes;

    const parent = addTask({
      title: `${plan.title}: ${day.title}`,
      completed: false,
      status: "todo",
      dateUID,
      projectId,
      boundNotePath: null,
      priority: "medium",
      sortOrder: 0,
      recurrence: {
        type: "weekly",
        interval: 1,
        daysOfWeek: [day.dayOfWeek],
        until: untilUID,
      },
      scheduledTime: input.scheduledTime,
      estimatedTime: estimated,
      totalWorkTime: 0,
      kind: "workout",
      workoutLocation: plan.location,
      workoutDayKey: day.key,
    });
    parentIds.push(parent.id);
    if (titles.length) setChecklistForTask(parent.id, titles);

    // addTask schedules monthly expansion async — also run sync so we can stamp checklists.
    generateMonthlyRecurringTasks(parent.id);
    instanceCount += copyChecklistToInstances(parent.id, titles);
  }

  return { parentIds, instanceCount };
}

/** Parent series of a workout instance (or the task itself). */
export function resolveWorkoutParent(task: ITask): ITask | null {
  if (task.kind !== "workout") return null;
  if (task.isRecurringInstance && task.parentTaskId) {
    const all = get(tasksStore);
    return all.find((t) => t.id === task.parentTaskId) ?? task;
  }
  return task;
}
