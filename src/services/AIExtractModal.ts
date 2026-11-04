import type { App } from "obsidian";
import { VIEW_TYPE_AI_EXTRACT } from "../constants";
import type AIExtractView from "../views/AIExtractView";

/**
 * Open the AI task extraction in a detached Obsidian window (popout leaf).
 * Reuses an existing extract window if present and just swaps the note.
 */
export async function openAiExtract(app: App, notePath?: string): Promise<void> {
  const { workspace } = app;
  const applyToView = (view: AIExtractView) => {
    if (notePath) view.setNotePath(notePath);
  };

  const existing = workspace.getLeavesOfType(VIEW_TYPE_AI_EXTRACT);
  if (existing.length > 0) {
    const leaf = existing[0];
    void workspace.revealLeaf(leaf);
    applyToView(leaf.view as AIExtractView);
    return;
  }

  const leaf = workspace.getLeaf("window");
  await leaf.setViewState({ type: VIEW_TYPE_AI_EXTRACT, active: true });
  void workspace.revealLeaf(leaf);
  applyToView(leaf.view as AIExtractView);
}
