import {
  isKeyboardOpen,
  applyKeyboardOpenClass,
  installKeyboardOpenWatcher,
  KEYBOARD_OPEN_CLASS,
} from "../keyboardViewport";

describe("isKeyboardOpen", () => {
  it("false when no visual viewport", () => {
    expect(isKeyboardOpen(null, 800)).toBe(false);
    expect(isKeyboardOpen(undefined, 800)).toBe(false);
  });

  it("false when heights are equal (keyboard closed)", () => {
    expect(isKeyboardOpen({ height: 800 }, 800)).toBe(false);
    expect(isKeyboardOpen({ height: 790 }, 800)).toBe(false);
  });

  it("true when visual viewport is much shorter (keyboard open)", () => {
    expect(isKeyboardOpen({ height: 500 }, 800)).toBe(true);
    expect(isKeyboardOpen({ height: 400 }, 800, 120)).toBe(true);
  });

  it("respects custom threshold", () => {
    expect(isKeyboardOpen({ height: 750 }, 800, 200)).toBe(false);
    expect(isKeyboardOpen({ height: 750 }, 800, 40)).toBe(true);
  });

  it("false on invalid heights", () => {
    expect(isKeyboardOpen({ height: 0 }, 800)).toBe(false);
    expect(isKeyboardOpen({ height: 500 }, 0)).toBe(false);
    expect(isKeyboardOpen({ height: -1 }, 800)).toBe(false);
  });
});

describe("applyKeyboardOpenClass", () => {
  it("toggles wl-keyboard-open on documentElement", () => {
    applyKeyboardOpenClass(true);
    expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(true);
    applyKeyboardOpenClass(false);
    expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false);
  });
});

describe("installKeyboardOpenWatcher", () => {
  it("sets class immediately and cleans up", () => {
    const listeners: Record<string, Array<() => void>> = {};
    const fakeVv = {
      height: 400,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => {
        (listeners[type] ||= []).push(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
    };
    const fakeWin = {
      innerHeight: 800,
      visualViewport: fakeVv,
    } as unknown as Window;

    const cleanup = installKeyboardOpenWatcher(fakeWin, document);
    expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(true);

    // Simulate keyboard closing
    (fakeVv as { height: number }).height = 800;
    for (const fn of listeners.resize || []) fn();
    expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false);

    cleanup();
    expect(document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)).toBe(false);
  });

  it("no-ops without visualViewport", () => {
    const fakeWin = { innerHeight: 800 } as unknown as Window;
    const cleanup = installKeyboardOpenWatcher(fakeWin, document);
    expect(typeof cleanup).toBe("function");
    cleanup();
  });
});
