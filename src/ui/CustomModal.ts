import type { App } from "obsidian";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable === true;
}

export abstract class CustomModal {
  protected app: App;
  protected containerEl: HTMLElement;
  protected overlayEl: HTMLElement;
  protected contentEl: HTMLElement;
  private isOpen = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private typingShield: ((e: KeyboardEvent) => void) | null = null;

  constructor(app: App) {
    this.app = app;
  }

  abstract onOpen(): void;
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- default no-op lifecycle hook
  onClose(): void {}

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;

    // Overlay
    this.overlayEl = document.body.createDiv({ cls: "wf-dialog-overlay" });
    this.overlayEl.addEventListener("click", (e) => {
      if (e.target === this.overlayEl) this.close();
    });

    // Container
    this.containerEl = this.overlayEl.createDiv({ cls: "wf-dialog-container" });

    // Close button
    const closeBtn = this.containerEl.createEl("button", {
      cls: "wf-dialog-close",
      text: "\u00D7",
    });
    closeBtn.addEventListener("click", () => this.close());

    // Content
    this.contentEl = this.containerEl.createDiv({ cls: "wf-dialog-content" });

    // Escape key
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener("keydown", this.keyHandler);

    // Shield typing in form fields (especially Space) from global/hotkey handlers.
    // Window capture runs BEFORE document capture, where Obsidian hotkeys live —
    // stopPropagation here keeps default insertion but hides keys from hotkeys.
    this.typingShield = (e: KeyboardEvent) => {
      if (e.key === "Escape") return; // allow modal close
      if (e.isComposing || e.keyCode === 229) return; // IME composition
      if (!isEditableTarget(e.target)) return;
      e.stopPropagation();
    };
    window.addEventListener("keydown", this.typingShield, true);

    // Keep typed characters (especially Space) inside form fields.
    // Global/hotkey listeners on document must not steal or preventDefault them.
    this.contentEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (!isEditableTarget(e.target)) return;
      if (e.key === "Escape") return; // allow modal close
      // Stop bubbling only — never preventDefault — so typing works normally
      e.stopPropagation();
    });

    this.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;

    this.onClose();

    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
    if (this.typingShield) {
      window.removeEventListener("keydown", this.typingShield, true);
      this.typingShield = null;
    }

    this.overlayEl.remove();
  }
}
