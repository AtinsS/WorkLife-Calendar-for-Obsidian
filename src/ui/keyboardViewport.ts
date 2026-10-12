/**
 * Mobile keyboard visibility helper.
 *
 * When the soft keyboard opens, `position: fixed; inset: 0` overlays keep the
 * layout-viewport size and paint a dark scrim under the keyboard. Marking
 * `html.wl-keyboard-open` lets CSS drop that scrim.
 */

export interface ViewportLike {
  height: number;
  offsetTop?: number;
}

/**
 * Pure detector: keyboard is "open" when the visual viewport is meaningfully
 * shorter than the layout viewport (window.innerHeight).
 */
export function isKeyboardOpen(
  visual: ViewportLike | null | undefined,
  layoutHeight: number,
  thresholdPx = 120,
): boolean {
  if (!visual || typeof visual.height !== "number" || visual.height <= 0) return false;
  if (typeof layoutHeight !== "number" || layoutHeight <= 0) return false;
  return layoutHeight - visual.height > thresholdPx;
}

export const KEYBOARD_OPEN_CLASS = "wl-keyboard-open";

export function applyKeyboardOpenClass(isOpen: boolean, doc: Document = document): void {
  const root = doc.documentElement;
  if (!root) return;
  root.classList.toggle(KEYBOARD_OPEN_CLASS, isOpen);
}

/** Wire visualViewport resize/scroll to the documentElement class. Returns cleanup. */
export function installKeyboardOpenWatcher(
  win: Window = window,
  doc: Document = document,
): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => undefined;

  const update = () => {
    applyKeyboardOpenClass(isKeyboardOpen(vv, win.innerHeight), doc);
  };
  update();
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    applyKeyboardOpenClass(false, doc);
  };
}
