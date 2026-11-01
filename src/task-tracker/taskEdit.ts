import type { App } from "obsidian";
import { get } from "svelte/store";
import type { ITask } from "./types";
import { tasks, updateTask, updateRecurringSeries } from "./stores";
import { tRaw } from "../i18n";
import { ConfirmModal } from "./taskDeletion";

/**
 * Unified edit flow for tasks.
 * - plain task → open the editor right away
 * - recurring task (series parent or generated occurrence) → ask first:
 *   only this task / the whole series / cancel
 * `onSubmitted` fires after the edit form is actually saved (not on cancel).
 */
export function requestTaskEdit(app: App, task: ITask, onSubmitted?: () => void): void {
  const openEditor = (scope: "this" | "series") => {
    void import("./TaskModal").then(({ TaskModal }) => {
      new TaskModal(
        app,
        (changes) => {
          const rootId = task.isRecurringInstance ? task.parentTaskId : task.id;
          if (scope === "series" && rootId) {
            const seriesChanges: Partial<ITask> = { ...changes };
            // The form shows this occurrence's date — don't re-anchor the series with it.
            if (task.isRecurringInstance) delete seriesChanges.dateUID;
            updateRecurringSeries(rootId, seriesChanges);
          } else {
            updateTask(task.id, changes);
          }
          onSubmitted?.();
        },
        task,
      ).open();
    });
  };

  const isParent = !!task.recurrence && !task.isRecurringInstance;
  const parent =
    task.isRecurringInstance && task.parentTaskId
      ? get(tasks).find((t) => t.id === task.parentTaskId)
      : undefined;
  const isInstance = !!task.isRecurringInstance && !!parent;

  if (!isParent && !isInstance) {
    openEditor("this");
    return;
  }

  const rootId = isParent ? task.id : parent?.id;
  const seriesSize = get(tasks).filter(
    (t) => t.id === rootId || (t.isRecurringInstance && t.parentTaskId === rootId),
  ).length;

  new ConfirmModal(
    app,
    tRaw("tasks.item.editSeriesTitle"),
    tRaw("tasks.item.editSeriesBody", { title: task.title, count: seriesSize }),
    [
      { label: tRaw("common.cancel") },
      { label: tRaw("tasks.item.editSeriesConfirm"), action: () => openEditor("series") },
      { label: tRaw("tasks.item.editOnlyThis"), primary: true, action: () => openEditor("this") },
    ],
  ).open();
}
