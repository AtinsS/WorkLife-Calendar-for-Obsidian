import { readFileSync } from "fs";
import { join } from "path";

/**
 * Regression contract for mobile keyboard on Obsidian-native modals
 * (QuickAdd «новая задача», weight entry) and inline weight fields.
 *
 * Symptoms (2026): «выезжает что-то из под клавиатуры и не работает так как нужно».
 * Causes locked by these tests:
 * 1. Theme `.modal-bg` (dark cover + blur) is a full-screen fixed scrim — when the
 *    keyboard opens it paints as a plate that rides with the keyboard. Must be
 *    neutralized under `html.wl-keyboard-open`.
 * 2. QuickAdd `.quick-add-shell` keeps `max-height: min(90vh, …)` so the primary
 *    action sits under the keyboard. Must shrink when the keyboard is open
 *    (same pattern as `.kbm-board-modal`).
 * 3. QuickAdd / WeightTracker inputs are NOT CustomModal — they need `guardTyping`
 *    so Space is not eaten by Obsidian hotkeys.
 */
const stylesPath = join(__dirname, "..", "..", "..", "styles.css");
const css = readFileSync(stylesPath, "utf8");
const flat = css.replace(/\s+/g, " ");

describe("Obsidian-native modal keyboard cover (QuickAdd / weight)", () => {
  it("neutralizes theme .modal-bg when the keyboard is open", () => {
    expect(flat).toMatch(
      /html\.wl-keyboard-open \.modal-bg\s*\{[^}]*\}/,
    );
    const rule = flat.match(/html\.wl-keyboard-open \.modal-bg\s*\{[^}]*\}/)?.[0] ?? "";
    // No dark cover, no blur — must not paint a plate under the keyboard
    expect(rule).toMatch(/background:\s*transparent/);
    expect(rule).toMatch(/backdrop-filter:\s*none/);
    expect(rule).not.toMatch(/rgba\(5, 8, 14/);
    expect(rule).not.toMatch(/var\(--background-modifier-cover\)/);
  });

  it("shrinks QuickAdd shell while the keyboard is open so actions stay reachable", () => {
    expect(flat).toMatch(
      /html\.wl-keyboard-open \.quick-add-shell\s*\{[^}]*\}/,
    );
    const rule =
      flat.match(/html\.wl-keyboard-open \.quick-add-shell\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/max-height:/);
    // Must be tighter than the resting 90vh
    expect(rule).not.toMatch(/min\(90vh/);
  });
});

describe("typing guards on non-CustomModal inputs", () => {
  const quickAdd = readFileSync(
    join(__dirname, "..", "..", "task-tracker", "QuickAddModal.ts"),
    "utf8",
  );
  const weightTracker = readFileSync(
    join(__dirname, "..", "..", "weight", "WeightTracker.svelte"),
    "utf8",
  );

  it("QuickAddModal claims Space in its command input (Obsidian hotkeys eat Space)", () => {
    expect(quickAdd).toMatch(/guardTyping|claimSpace/);
  });

  it("WeightTracker claims Space in its note field", () => {
    expect(weightTracker).toMatch(/guardTyping|claimSpace/);
  });
});
