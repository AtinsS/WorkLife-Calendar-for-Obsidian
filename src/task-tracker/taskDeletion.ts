import { App, Modal } from "obsidian";
import { get } from "svelte/store";
import type { ITask } from "./types";
import {
  tasks,
  removeTask,
  tombstoneOccurrenceDate,
  clearRecurringSeries,
} from "./stores";
import { tRaw } from "../i18n";

interface ConfirmButton {
  label: string;
  primary?: boolean;
  danger?: boolean;
  action?: () => void;
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private body: string,
    private buttons: ConfirmButton[],
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("h3", { text: this.heading });
    this.contentEl.createEl("p", { text: this.body });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.justifyContent = "flex-end";
    for (const b of this.buttons) {
      const btn = row.createEl("button", {
        text: b.label,
        cls: b.primary ? "mod-cta" : "",
      });
      if (b.danger) btn.style.color = "var(--mcp-danger, #e5484d)";
      btn.addEventListener("click", () => {
        this.close();
        b.action?.();
      });
    }
  }
}

function occurrenceDate(task: ITask): string {
  const m = /^day-(\d{4}-\d{2}-\d{2})/.exec(task.dateUID || "");
  return m ? m[1] : "";
}

/**
 * Unified delete flow for tasks.
 * - plain task → delete right away
 * - recurring parent → ask before wiping the whole series (template + occurrences)
 * - recurring occurrence → ask: this one only (tombstoned so it never regenerates)
 *   / the whole series / cancel
 * `onDeleted` fires after a real deletion (never on cancel) so views can sync.
 */
export function requestTaskDeletion(app: App, taskId: string, onDeleted?: () => void): void {
  const task = get(tasks).find((t) => t.id === taskId);
  if (!task) return;

  const isParent = !!task.recurrence && !task.isRecurringInstance;
  const parent = task.isRecurringInstance && task.parentTaskId
    ? get(tasks).find((t) => t.id === task.parentTaskId)
    : undefined;
  const isInstance = !!task.isRecurringInstance && !!parent;

  if (!isParent && !isInstance) {
    removeTask(task.id);
    onDeleted?.();
    return;
  }

  const rootId = isParent ? task.id : parent?.id;
  if (!rootId) return;
  const seriesSize = get(tasks).filter(
    (t) => t.id === rootId || (t.isRecurringInstance && t.parentTaskId === rootId),
  ).length;

  const deleteSeries = () => {
    clearRecurringSeries(rootId);
    onDeleted?.();
  };
  const deleteOccurrence = () => {
    const date = occurrenceDate(task);
    if (date) tombstoneOccurrenceDate(rootId, date);
    removeTask(task.id);
    onDeleted?.();
  };

  if (isParent) {
    new ConfirmModal(
      app,
      tRaw("tasks.item.deleteSeriesTitle"),
      tRaw("tasks.item.deleteSeriesBody", { title: task.title, count: seriesSize }),
      [
        { label: tRaw("common.cancel") },
        { label: tRaw("tasks.item.deleteSeriesConfirm"), primary: true, danger: true, action: deleteSeries },
      ],
    ).open();
    return;
  }

  new ConfirmModal(
    app,
    tRaw("tasks.item.deleteSeriesTitle"),
    tRaw("tasks.item.deleteOccurrenceBody", { title: task.title, count: seriesSize }),
    [
      { label: tRaw("common.cancel") },
      { label: tRaw("tasks.item.deleteSeriesConfirm"), danger: true, action: deleteSeries },
      { label: tRaw("tasks.item.deleteOnlyThis"), primary: true, action: deleteOccurrence },
    ],
  ).open();
}
