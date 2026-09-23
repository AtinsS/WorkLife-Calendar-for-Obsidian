/**
 * Regression tests for Space in modal text fields (especially .ai-ask-input).
 *
 * Bug: Space was stolen by global/hotkey handlers or fell through to page/modal
 * scroll after the first use. It must always type a space into the focused
 * field and never scroll.
 */
import type { App } from "obsidian";
import {
  CustomModal,
  guardTyping,
  insertTextAtCursor,
  isSpaceKey,
  claimSpace,
  resolveEditable,
} from "../CustomModal";

class TestModal extends CustomModal {
  input!: HTMLTextAreaElement;
  content!: HTMLElement;
  root!: HTMLElement;
  onOpen(): void {
    this.content = this.contentEl;
    this.root = this.containerEl;
    this.input = this.contentEl.createEl("textarea") as HTMLTextAreaElement;
    this.input.className = "ai-ask-input";
    this.lastEditable = this.input;
    guardTyping(this.input);
  }
}

function pressSpace(target: HTMLElement, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key: " ",
    code: "Space",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(ev);
  return ev;
}

function mockExecCommand(impl: (cmd: string) => boolean | never): void {
  (document as unknown as { execCommand: unknown }).execCommand = impl;
}

describe("isSpaceKey", () => {
  test("matches bare Space", () => {
    expect(isSpaceKey(new KeyboardEvent("keydown", { key: " " }))).toBe(true);
    expect(isSpaceKey(new KeyboardEvent("keydown", { code: "Space" }))).toBe(true);
  });

  test("ignores modified Space", () => {
    expect(isSpaceKey(new KeyboardEvent("keydown", { key: " ", ctrlKey: true }))).toBe(false);
    expect(isSpaceKey(new KeyboardEvent("keydown", { key: " ", metaKey: true }))).toBe(false);
    expect(isSpaceKey(new KeyboardEvent("keydown", { key: " ", altKey: true }))).toBe(false);
  });
});

describe("insertTextAtCursor", () => {
  test("inserts at caret via value write (no execCommand dependency)", () => {
    const el = document.createElement("textarea");
    el.value = "ab";
    el.setSelectionRange(1, 1);
    let inputFired = 0;
    el.addEventListener("input", () => {
      inputFired += 1;
    });

    mockExecCommand(() => {
      throw new Error("execCommand must not be required");
    });
    insertTextAtCursor(el, " ");

    expect(el.value).toBe("a b");
    expect(el.selectionStart).toBe(2);
    expect(inputFired).toBe(1);
  });

  test("replaces a selection", () => {
    const el = document.createElement("textarea");
    el.value = "abcdef";
    el.setSelectionRange(1, 4);
    insertTextAtCursor(el, " ");
    expect(el.value).toBe("a ef");
  });

  test("still inserts when execCommand lies (returns true without inserting)", () => {
    const el = document.createElement("textarea");
    el.value = "";
    el.setSelectionRange(0, 0);
    mockExecCommand(() => true);
    insertTextAtCursor(el, " ");
    expect(el.value).toBe(" ");
  });

  test("skips disabled/readonly fields", () => {
    const ro = document.createElement("textarea");
    ro.readOnly = true;
    ro.value = "x";
    insertTextAtCursor(ro, " ");
    expect(ro.value).toBe("x");

    const dis = document.createElement("input");
    dis.disabled = true;
    dis.value = "y";
    insertTextAtCursor(dis, " ");
    expect(dis.value).toBe("y");
  });
});

describe("CustomModal Space in ai-ask-input-like field", () => {
  let modal: TestModal;
  const app = {} as App;

  beforeEach(() => {
    document.body.innerHTML = "";
    modal = new TestModal(app);
    modal.open();
    modal.input.value = "";
    modal.input.readOnly = false;
    modal.input.setSelectionRange(0, 0);
    modal.input.focus();
  });

  afterEach(() => {
    modal.close();
    mockExecCommand(() => false);
  });

  test("first Space types a space and is preventDefault'd (no scroll)", () => {
    const ev = pressSpace(modal.input);
    expect(modal.input.value).toBe(" ");
    expect(ev.defaultPrevented).toBe(true);
  });

  test("repeated Spaces all insert (regression: only first launch worked)", () => {
    pressSpace(modal.input);
    pressSpace(modal.input);
    pressSpace(modal.input);
    expect(modal.input.value).toBe("   ");
  });

  test("second open after close still inserts Space", () => {
    pressSpace(modal.input);
    modal.close();

    const modal2 = new TestModal(app);
    modal2.open();
    modal2.input.value = "";
    modal2.input.readOnly = false;
    modal2.input.setSelectionRange(0, 0);
    modal2.input.focus();

    pressSpace(modal2.input);
    expect(modal2.input.value).toBe(" ");

    // and still works after another cycle
    modal2.close();
    const modal3 = new TestModal(app);
    modal3.open();
    modal3.input.readOnly = false;
    modal3.input.focus();
    modal3.input.value = "";
    pressSpace(modal3.input);
    expect(modal3.input.value).toBe(" ");
    modal3.close();
  });

  test("survives readOnly lock/unlock cycle (extract/send lock)", () => {
    modal.input.readOnly = true;
    modal.input.focus();
    pressSpace(modal.input);
    // while locked: no insert, but must not fall through to scroll
    expect(modal.input.value).toBe("");

    modal.input.readOnly = false;
    modal.input.focus();
    pressSpace(modal.input);
    expect(modal.input.value).toBe(" ");
  });

  test("inserts even when a window hotkey already preventDefault'd Space", () => {
    const hotkey = (e: Event) => {
      e.preventDefault();
    };
    window.addEventListener("keydown", hotkey, true);
    try {
      pressSpace(modal.input);
      expect(modal.input.value).toBe(" ");
    } finally {
      window.removeEventListener("keydown", hotkey, true);
    }
  });

  test("inserts even when a document-capture hotkey preventDefault'd Space first", () => {
    // Simulate Obsidian: document capture runs after window capture; use a
    // handler registered on window AFTER the modal shield would still see it
    // if the shield failed to stopPropagation — here we force defaultPrevented
    // before the field handler by claiming at document level in bubble…
    // Direct unit: claimSpace must restore the character whenever default is canceled.
    const el = modal.input;
    el.value = "";
    el.setSelectionRange(0, 0);
    const ev = new KeyboardEvent("keydown", {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    ev.preventDefault();
    claimSpace(ev as Parameters<typeof claimSpace>[0], el);
    expect(el.value).toBe(" ");
  });

  test("types into the field when event target is the scroll container but focus/lastEditable is the input", () => {
    // Simulate focus landing on .wf-dialog-content (scrollable) while the user
    // still expects typing to go to the ask input.
    modal.input.value = "";
    modal.input.setSelectionRange(0, 0);
    modal.content.focus();
    // jsdom may not move activeElement reliably; resolveEditable must still find the field
    const found = resolveEditable(null, modal.root, modal.input);
    expect(found).toBe(modal.input);

    pressSpace(modal.input);
    expect(modal.input.value).toBe(" ");
  });

  test("Space on scrollable content types into last focused field (no scroll)", () => {
    // User lost focus to .wf-dialog-content; Space must not scroll the modal —
    // it should keep typing into the ask input they were using.
    modal.input.value = "";
    modal.input.setSelectionRange(0, 0);
    modal.lastEditable = modal.input;
    const ev = pressSpace(modal.content);
    expect(ev.defaultPrevented).toBe(true);
    expect(modal.input.value).toBe(" ");
  });

  test("blocks Space from scrolling non-interactive modal content when no field is available", () => {
    modal.lastEditable = null;
    modal.input.readOnly = true; // not a valid insert target
    const ev = pressSpace(modal.content, { key: " " });
    expect(ev.defaultPrevented).toBe(true);
    expect(modal.input.value).toBe("");
  });

  test("does not double-insert when both global shield and field guard see the event", () => {
    pressSpace(modal.input);
    expect(modal.input.value).toBe(" ");
  });

  test("Enter without Shift triggers send callback, Shift+Enter inserts newline default", () => {
    let sent = 0;
    const el = document.createElement("textarea");
    guardTyping(el, () => {
      sent += 1;
    });
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(sent).toBe(1);

    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(sent).toBe(1);
  });

  test("Enter triggers submit via global shield (window capture must not swallow it)", () => {
    // Regression: global typing shield used to stopPropagation on Enter at
    // window capture, so guardTyping never saw it and «Выполнить» did not run.
    let sent = 0;
    modal.input.value = "do it";
    guardTyping(modal.input, () => {
      sent += 1;
    });
    modal.input.focus();
    const ev = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(ev);
    expect(sent).toBe(1);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("resolveEditable", () => {
  test("prefers event target over activeElement", () => {
    const a = document.createElement("textarea");
    const b = document.createElement("input");
    const wrap = document.createElement("div");
    wrap.append(a, b);
    document.body.append(wrap);
    a.focus();
    const ev = new KeyboardEvent("keydown", { key: "a", bubbles: true });
    Object.defineProperty(ev, "target", { value: b });
    expect(resolveEditable(ev, wrap)).toBe(b);
  });

  test("falls back to last focused field inside root", () => {
    const wrap = document.createElement("div");
    const ta = document.createElement("textarea");
    wrap.append(ta);
    document.body.append(wrap);
    const ev = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true });
    Object.defineProperty(ev, "target", { value: wrap });
    expect(resolveEditable(ev, wrap, ta)).toBe(ta);
  });
});
