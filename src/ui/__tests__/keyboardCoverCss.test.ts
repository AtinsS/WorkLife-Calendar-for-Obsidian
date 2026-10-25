import { readFileSync } from "fs";
import { join } from "path";

/**
 * CSS contract for the soft-keyboard body-sky leak.
 *
 * Theme paints the night-sky starfield on `body` (fixed attachment) and forces
 * workspace wrappers transparent. When the keyboard opens, transparent modal
 * scrims + glass panels expose that starfield as a «подложка» that slides with
 * the keyboard. Hello search is immune (markdown scroller); task search and
 * other plugin inputs are not.
 *
 * Policy when `html.wl-keyboard-open`:
 * 1. body starfield image is suppressed (solid --wl-bg canvas only)
 * 2. modal overlays use a solid surface — not rgba black scrim, not fully
 *    transparent (transparent re-exposes the body sky).
 */
const stylesPath = join(__dirname, "..", "..", "..", "styles.css");
const css = readFileSync(stylesPath, "utf8");

/** Collapse whitespace so multi-line rules are easy to assert. */
const flat = css.replace(/\s+/g, " ");

describe("keyboard-open cover CSS (body sky must not slide in)", () => {
  it("kills the body starfield while the keyboard is open", () => {
    expect(flat).toMatch(
      /html\.wl-keyboard-open body\s*\{[^}]*background-image:\s*none[^}]*\}/,
    );
  });

  it("keeps a solid body canvas under the keyboard (no star image, no blur)", () => {
    const rule = flat.match(/html\.wl-keyboard-open body\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule?.[0] ?? "";
    expect(body).toMatch(/background-image:\s*none/);
    // Must not leave a background-image (stars) active
    expect(body).not.toMatch(/radial-gradient/);
    expect(body).not.toMatch(/background-attachment:\s*fixed/);
  });

  it("modal scrims become solid surface when keyboard is open (not transparent, not 0.6 black)", () => {
    // The keyboard-open overlay block must cover the known overlay classes
    for (const sel of [
      ".wf-dialog-overlay",
      ".dash-popup-overlay",
      ".goals-modal-overlay",
      ".time-logs-overlay",
      ".holiday-list-overlay",
    ]) {
      expect(flat).toContain(sel);
    }

    // Extract the wl-keyboard-open overlay rule body
    const m = flat.match(
      /html\.wl-keyboard-open \.wf-dialog-overlay[^{]*\{[^}]*\}/,
    );
    expect(m).not.toBeNull();
    const rule = m?.[0] ?? "";
    // Solid app surface — not transparent (would re-show body sky)
    expect(rule).toMatch(/background:\s*var\(--background-primary/);
    expect(rule).not.toMatch(/background:\s*transparent/);
    expect(rule).not.toMatch(/rgba\(0, 0, 0, 0\.6\)/);
    // Blur is pointless on an opaque cover and is a WebKit trap
    expect(rule).toMatch(/backdrop-filter:\s*none/);
  });
});
