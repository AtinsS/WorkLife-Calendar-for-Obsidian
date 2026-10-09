import type { App } from "obsidian";
import { Notice } from "obsidian";
import { get } from "svelte/store";
import { settings } from "../ui/stores";
import { tRaw } from "../i18n";
import { addChecklistItem, checklists, projects } from "../task-tracker/stores";
import type { ITask } from "../task-tracker/types";

/** Разбить задачу на подзадачи через Ollama и добавить в чек-лист. */
export async function splitTaskIntoSubtasks(
  _app: App,
  task: ITask,
): Promise<number> {
  const opts = get(settings) as {
    ollamaEnabled?: boolean;
    aiSubtasksEnabled?: boolean;
    ollamaUrl?: string;
    ollamaModel?: string;
    ollamaModelMode?: "single" | "dual";
    ollamaModelExtract?: string;
  };
  if (!opts.ollamaEnabled) {
    new Notice(tRaw("ai.summaryNeedOllama"));
    return 0;
  }
  if (opts.aiSubtasksEnabled === false) {
    new Notice(tRaw("settings.ai.subtasksEnabled") + " — off");
    return 0;
  }

  const projectName = task.projectId
    ? get(projects).find((p) => p.id === task.projectId)?.name ?? null
    : null;

  const { generateSubtasks, resolveModel } = await import("./OllamaService");
  const titles = await generateSubtasks(
    opts.ollamaUrl || "http://localhost:11434",
    resolveModel("extract", opts),
    task.title,
    task.description || null,
    projectName,
  );
  if (!titles.length) {
    new Notice(tRaw("ai.subtasksEmpty"));
    return 0;
  }
  for (const title of titles) {
    addChecklistItem(task.id, title);
  }
  new Notice(tRaw("ai.subtasksAdded", { count: String(titles.length) }));
  return titles.length;
}

export function taskHasChecklist(taskId: string): boolean {
  return get(checklists).some((c) => c.taskId === taskId);
}
