import type { App } from "obsidian";

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement && target.disabled) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable === true;
}

export function isSpaceKey(e: KeyboardEvent): boolean {
  return (e.key === " " || e.code === "Space") && !e.ctrlKey && !e.metaKey && !e.altKey;
}

export type SpaceEvent = KeyboardEvent & { _wlSpaceHandled?: boolean; _wlEnterHandled?: boolean };

/**
 * Insert text at the caret using a direct value write.
 * Do NOT use document.execCommand("insertText") here: in Obsidian/Electron it
 * can throw or return success without inserting after preventDefault() on
 * keydown — which silently ate Space in .ai-ask-input.
 */
export function insertTextAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
  if (!el || el.disabled || el.readOnly) return;
  try {
    el.focus();
  } catch {
    /* focus is best-effort */
  }

  const start = typeof el.selectionStart === "number" ? el.selectionStart : el.value.length;
  const end = typeof el.selectionEnd === "number" ? el.selectionEnd : start;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  try {
    el.setSelectionRange(pos, pos);
  } catch {
    /* ignore */
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Resolve the field that should receive typing: event target first, then focus, then last focused in root. */
export function resolveEditable(
  e: KeyboardEvent | null,
  root?: HTMLElement | null,
  last?: HTMLInputElement | HTMLTextAreaElement | null,
): HTMLInputElement | HTMLTextAreaElement | null {
  const candidates: (EventTarget | null)[] = e
    ? [e.target, document.activeElement]
    : [document.activeElement];
  if (last) candidates.push(last);
  for (const cand of candidates) {
    if (!isEditableTarget(cand)) continue;
    const el = cand as HTMLInputElement | HTMLTextAreaElement;
    if (root && !root.contains(el)) continue;
    if (el.disabled || el.readOnly) continue;
    return el;
  }
  return null;
}

/**
 * Own Space completely in a text field: never let it fall through to
 * page/modal scroll. Idempotent across stacked shields on the same event.
 */
export function claimSpace(e: SpaceEvent, el: HTMLInputElement | HTMLTextAreaElement): void {
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e._wlSpaceHandled) return;
  e._wlSpaceHandled = true;
  insertTextAtCursor(el, " ");
}

const enterHandlers = new WeakMap<HTMLElement, () => void>();

/** Register Enter-to-submit for a field (global shield + local guard both honor it). */
export function setEnterHandler(
  el: HTMLInputElement | HTMLTextAreaElement,
  onEnter: () => void,
): void {
  enterHandlers.set(el, onEnter);
}

function tryEnter(e: SpaceEvent, el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
  const onEnter = enterHandlers.get(el);
  if (!onEnter) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e._wlEnterHandled) return true;
  e._wlEnterHandled = true;
  onEnter();
  return true;
}

/**
 * Per-field typing guard (used by AI ask input and other modal fields).
 * Space is always claimed so it cannot fall through to scroll or hotkeys.
 * Enter (without Shift) runs the registered submit handler — "Выполнить".
 */
export function guardTyping(
  el: HTMLInputElement | HTMLTextAreaElement,
  onEnter?: () => void,
): void {
  if (onEnter) setEnterHandler(el, onEnter);
  el.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape") return;
      if (tryEnter(e as SpaceEvent, el)) return;
      if (isSpaceKey(e)) {
        claimSpace(e as SpaceEvent, el);
        return;
      }
      e.stopPropagation();
    },
    true,
  );
}

type ModalHost = {
  /** @internal */ _wlRoot: HTMLElement;
  lastEditable: HTMLInputElement | HTMLTextAreaElement | null;
};

const openHosts = new Set<ModalHost>();
let globalShield: ((e: KeyboardEvent) => void) | null = null;
let focusTracker: ((e: Event) => void) | null = null;

function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") return;
  if (e.isComposing) return;
  for (const host of openHosts) {
    const el = resolveEditable(e, host._wlRoot, host.lastEditable);
    if (!el) continue;
    if (isSpaceKey(e)) {
      claimSpace(e as SpaceEvent, el);
      return;
    }
    // Enter must reach submit ("Выполнить") even though we hide keys from hotkeys
    if (tryEnter(e as SpaceEvent, el)) return;
    e.stopPropagation();
    return;
  }
}

function onFocusIn(e: Event): void {
  const t = e.target;
  if (!isEditableTarget(t)) return;
  const el = t as HTMLInputElement | HTMLTextAreaElement;
  for (const host of openHosts) {
    if (host._wlRoot.contains(el)) {
      host.lastEditable = el;
      return;
    }
  }
}

function installGlobalShield(): void {
  if (globalShield) return;
  globalShield = onGlobalKeydown;
  focusTracker = onFocusIn;
  // Window capture runs BEFORE document capture, where Obsidian hotkeys live.
  window.addEventListener("keydown", globalShield, true);
  document.addEventListener("focusin", focusTracker, true);
}

function maybeRemoveGlobalShield(): void {
  if (openHosts.size > 0) return;
  if (globalShield) {
    window.removeEventListener("keydown", globalShield, true);
    globalShield = null;
  }
  if (focusTracker) {
    document.removeEventListener("focusin", focusTracker, true);
    focusTracker = null;
  }
}

export abstract class CustomModal {
  protected app: App;
  protected containerEl!: HTMLElement;
  protected overlayEl!: HTMLElement;
  protected contentEl!: HTMLElement;
  /** @internal shared with global typing shield */
  _wlRoot!: HTMLElement;
  lastEditable: HTMLInputElement | HTMLTextAreaElement | null = null;
  private isOpen = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private spaceShield: ((e: KeyboardEvent) => void) | null = null;

  constructor(app: App) {
    this.app = app;
  }

  abstract onOpen(): void;
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- default no-op lifecycle hook
  onClose(): void {}

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;

    this.overlayEl = document.body.createDiv({ cls: "wf-dialog-overlay" });
    this.overlayEl.addEventListener("click", (e) => {
      if (e.target === this.overlayEl) this.close();
    });

    this.containerEl = this.overlayEl.createDiv({ cls: "wf-dialog-container" });
    this._wlRoot = this.containerEl;

    const closeBtn = this.containerEl.createEl("button", {
      cls: "wf-dialog-close",
      text: "\u00D7",
    });
    closeBtn.addEventListener("click", () => this.close());

    this.contentEl = this.containerEl.createDiv({ cls: "wf-dialog-content" });

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener("keydown", this.keyHandler);

    // Backup on the container: cover focus-on-wrapper / scroll-container cases
    // and never let Space scroll .wf-dialog-content while typing.
    this.spaceShield = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.isComposing) return;
      if (!this.containerEl.contains(e.target as Node) && e.target !== this.containerEl) {
        // still allow when activeElement is inside (focus retargeting)
        if (!this.containerEl.contains(document.activeElement)) return;
      }
      if (isSpaceKey(e)) {
        const el = resolveEditable(e, this.containerEl, this.lastEditable);
        if (el) {
          claimSpace(e as SpaceEvent, el);
          return;
        }
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const interactive =
          tag === "BUTTON" || tag === "A" || tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA";
        if (!interactive && !target?.isContentEditable) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      const el = resolveEditable(e, this.containerEl, this.lastEditable);
      if (el) e.stopPropagation();
    };
    this.containerEl.addEventListener("keydown", this.spaceShield, true);

    openHosts.add(this);
    installGlobalShield();

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
    if (this.spaceShield) {
      this.containerEl.removeEventListener("keydown", this.spaceShield, true);
      this.spaceShield = null;
    }

    openHosts.delete(this);
    this.lastEditable = null;
    maybeRemoveGlobalShield();

    this.overlayEl.remove();
  }
}
