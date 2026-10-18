import type { App, TAbstractFile, TFile } from "obsidian";
import { TFile as TFileClass, TFolder as TFolderClass } from "obsidian";
import { VIEW_TYPE_AI_ASK } from "../constants";
import type AIAskView from "../views/AIAskView";
import { collectAskFiles, type AskSelection } from "./AiAskChat";

export { collectAskFiles };
export type { AskSelection };

export interface OpenAiAskOptions {
  files?: TFile[];
  label?: string;
  /** Prefill the composer and optionally auto-send */
  prefill?: string;
  send?: boolean;
  /** Editor selection attached as a removable context chip */
  selection?: AskSelection | null;
}

/**
 * Open the AI chat in a detached Obsidian window (popout leaf).
 * Reuses an existing chat window if present and just swaps note context.
 */
export async function openAiAsk(
  app: App,
  files?: TFile[],
  label?: string,
  opts: Omit<OpenAiAskOptions, "files" | "label"> = {},
): Promise<void> {
  const { workspace } = app;
  const applyToView = (view: AIAskView) => {
    view.setAskContext(files, label);
    if (opts.selection !== undefined) view.setAskSelection(opts.selection);
    if (opts.prefill) view.setAskPrefill(opts.prefill, opts.send === true);
  };

  const existing = workspace.getLeavesOfType(VIEW_TYPE_AI_ASK);
  if (existing.length > 0) {
    const leaf = existing[0];
    void workspace.revealLeaf(leaf);
    const view = leaf.view as AIAskView;
    applyToView(view);
    return;
  }

  const leaf = workspace.getLeaf("window");
  await leaf.setViewState({ type: VIEW_TYPE_AI_ASK, active: true });
  void workspace.revealLeaf(leaf);
  const view = leaf.view as AIAskView;
  applyToView(view);
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

/**
 * Open chat around an editor selection: attach the selection as context
 * and optionally prefill / auto-send a prompt (explain, shorten, …).
 */
export async function openAiAskForSelection(
  app: App,
  selection: string,
  opts: { prefill?: string; send?: boolean; file?: TFile | null } = {},
): Promise<void> {
  // Note file is the chat context; the selection is a separate chip
  const files = opts.file ? [opts.file] : undefined;
  // When auto-sending, put the selection in the message body so the model
  // always sees it — the chip is just a visual reminder in the UI.
  const message = opts.send && opts.prefill
    ? `${opts.prefill}\n\n${selection}`
    : opts.prefill;
  await openAiAsk(app, files, opts.file?.basename, {
    selection: { text: selection },
    prefill: message,
    send: opts.send,
  });
}
