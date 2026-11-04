import { ItemView } from "obsidian";
import { VIEW_TYPE_AI_EXTRACT } from "../constants";
import { tRaw } from "../i18n";
import { AiExtractPanel } from "../services/AiExtractPanel";

/**
 * Detached "AI extraction" window (Obsidian popout leaf).
 * Replaces the old modal so extraction can run next to the note.
 */
export default class AIExtractView extends ItemView {
  private panel: AiExtractPanel | null = null;
  private pendingNotePath = "";

  getViewType(): string {
    return VIEW_TYPE_AI_EXTRACT;
  }

  getDisplayText(): string {
    return tRaw("ai.button");
  }

  getIcon(): string {
    return "sparkles";
  }

  /** Point the extractor at a note (auto-runs, same as the old modal open). */
  setNotePath(path: string): void {
    if (this.panel) {
      this.panel.setNotePath(path);
      return;
    }
    this.pendingNotePath = path;
  }

  onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ai-extract-view");
    this.panel = new AiExtractPanel(this.app, container, this.pendingNotePath, {
      onRequestClose: () => this.leaf.detach(),
    });
    this.pendingNotePath = "";
    this.panel.mount();
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.panel?.destroy();
    this.panel = null;
    return Promise.resolve();
  }
}
