import { ItemView, MarkdownView } from "obsidian";
import type { TFile } from "obsidian";
import { VIEW_TYPE_AI_ASK } from "../constants";
import { tRaw } from "../i18n";
import { AiAskChat, type AskSelection } from "../services/AiAskChat";
import { loadAiChatSnapshot } from "../services/aiChatStorage";

/**
 * Detached "Ask AI" chat window (Obsidian popout leaf).
 * Replaces the old modal so the chat can float next to notes.
 */
export default class AIAskView extends ItemView {
  private chat: AiAskChat | null = null;
  private pendingFiles: TFile[] | null = null;
  private pendingLabel: string | undefined;
  private pendingSelection: AskSelection | null = null;
  private pendingPrefill: string | null = null;
  private pendingSend = false;
  /** After a restore, ignore the workspace's own file-open until the user navigates. */
  private followSuppressedUntil = 0;

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

  /** Attach / clear the editor-selection chip. */
  setAskSelection(sel: AskSelection | null): void {
    this.pendingSelection = sel;
    this.chat?.setSelection(sel);
  }

  /** Prefill the composer; `send` fires the message immediately. */
  setAskPrefill(text: string, send = false): void {
    this.pendingPrefill = text;
    this.pendingSend = send;
    if (!this.chat) return;
    if (send) {
      this.chat.sendText(text);
    } else {
      this.chat.prefill(text);
    }
    this.pendingPrefill = null;
    this.pendingSend = false;
  }

  /** Make the picked note the chat context (conversation and pinned notes are kept). */
  private followNote(file: TFile | null): void {
    if (!file || file.extension !== "md") return;
    if (Date.now() < this.followSuppressedUntil) return;
    if (this.pendingFiles?.length === 1 && this.pendingFiles[0].path === file.path) return;
    this.pendingFiles = [file];
    this.pendingLabel = file.basename;
    // No explicit label: the chat derives one covering the pinned notes too.
    this.chat?.setContext([file]);
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ai-ask-view");
    const restored = await loadAiChatSnapshot(this.app);
    this.chat = new AiAskChat(
      this.app,
      container,
      this.pendingFiles ?? undefined,
      this.pendingLabel,
      restored,
    );
    this.chat.onContextChange = (files, label) => {
      this.pendingFiles = files;
      this.pendingLabel = label;
    };
    const state = this.chat.getContextState();
    this.pendingFiles = state.files;
    this.pendingLabel = state.label;
    this.chat.mount();
    if (restored) {
      // Obsidian re-fires file-open for the note that was active before the
      // restart; that must not wipe the just-restored chat context.
      this.followSuppressedUntil = Date.now() + 2000;
    }
    // The chat reads the note the user selects: switching tabs/notes in the main
    // window makes that note the context (the header chip shows which one).
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const view = leaf?.view;
        if (view instanceof MarkdownView) this.followNote(view.file);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.followNote(file);
      }),
    );
    if (this.pendingSelection) {
      this.chat.setSelection(this.pendingSelection);
      this.pendingSelection = null;
    }
    if (this.pendingPrefill) {
      if (this.pendingSend) this.chat.sendText(this.pendingPrefill);
      else this.chat.prefill(this.pendingPrefill);
      this.pendingPrefill = null;
      this.pendingSend = false;
    }
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.chat?.destroy();
    this.chat = null;
    return Promise.resolve();
  }
}
