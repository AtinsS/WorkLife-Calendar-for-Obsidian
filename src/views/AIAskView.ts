import { ItemView } from "obsidian";
import type { TFile } from "obsidian";
import { VIEW_TYPE_AI_ASK } from "../constants";
import { tRaw } from "../i18n";
import { AiAskChat } from "../services/AiAskChat";

/**
 * Detached "Ask AI" chat window (Obsidian popout leaf).
 * Replaces the old modal so the chat can float next to notes.
 */
export default class AIAskView extends ItemView {
  private chat: AiAskChat | null = null;
  private pendingFiles: TFile[] | null = null;
  private pendingLabel: string | undefined;

  getViewType(): string {
    return VIEW_TYPE_AI_ASK;
  }

  getDisplayText(): string {
    return tRaw("ai.askQa.title");
  }

  getIcon(): string {
    return "lucide-message-circle-question";
  }

  /** Apply note context (same conversation is kept if the view already exists). */
  setAskContext(files?: TFile[], label?: string): void {
    this.pendingFiles = files ?? null;
    this.pendingLabel = label;
    this.chat?.setContext(files, label);
  }

  onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ai-ask-view");
    this.chat = new AiAskChat(this.app, container, this.pendingFiles ?? undefined, this.pendingLabel);
    this.chat.mount();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.chat?.destroy();
    this.chat = null;
    return Promise.resolve();
  }
}
