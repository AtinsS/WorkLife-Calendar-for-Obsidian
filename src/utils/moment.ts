import { moment as momentNs } from "obsidian";
import type { Moment } from "moment";
import { tRaw } from "../i18n";

// Obsidian types moment as the module namespace (`typeof Moment`), but at
// runtime it is the callable moment function. Cast once here so call sites
// stay clean and the bundle uses the app's moment instead of a second copy.
export const momentFn = momentNs as unknown as (
  inp?: unknown,
  format?: string,
  strict?: boolean
) => Moment;

export type { Moment };

/**
 * Day label for switchers and headers. Full form is weekday-first —
 * «понедельник, 12 мая 2026»; `short` (small screens) abbreviates the
 * weekday — «пн, 12 мая 2026» — so long names don't eat the chrome.
 */
export function formatDayLabel(date: string, short = false): string {
  const m = momentFn(date, "YYYY-MM-DD", true);
  if (!m.isValid()) return date;
  return m
    .locale(tRaw("locale.momentLocale"))
    .format(short ? "dd, D MMMM YYYY" : "dddd, D MMMM YYYY");
}
