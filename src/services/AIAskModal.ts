import type { App, TAbstractFile, TFile } from "obsidian";
import { TFile as TFileClass, TFolder as TFolderClass } from "obsidian";
import { VIEW_TYPE_AI_ASK } from "../constants";
import type AIAskView from "../views/AIAskView";
import { collectAskFiles } from "./AiAskChat";

export { collectAskFiles };

/**
 * Open the AI chat in a detached Obsidian window (popout leaf).
 * Reuses an existing chat window if present and just swaps note context.
 */
export async function openAiAsk(app: App, files?: TFile[], label?: string): Promise<void> {
  const { workspace } = app;
  const existing = workspace.getLeavesOfType(VIEW_TYPE_AI_ASK);
  if (existing.length > 0) {
    const leaf = existing[0];
    void workspace.revealLeaf(leaf);
    const view = leaf.view as AIAskView;
    view.setAskContext(files, label);
    return;
  }

  const leaf = workspace.getLeaf("window");
  await leaf.setViewState({ type: VIEW_TYPE_AI_ASK, active: true });
  void workspace.revealLeaf(leaf);
  const view = leaf.view as AIAskView;
  view.setAskContext(files, label);
}

/** Open chat for a file / folder / multi-selection from the context menu. */
export function openAiAskFor(app: App, target: TAbstractFile): void {
  if (target instanceof TFolderClass) {
    const files = collectAskFiles(target);
    void openAiAsk(app, files, target.name);
    return;
  }
  if (target instanceof TFileClass && target.extension === "md") {
    void openAiAsk(app, [target], target.basename);
    return;
  }
  void openAiAsk(app);
}
