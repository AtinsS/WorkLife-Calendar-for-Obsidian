import { moment as momentNs } from "obsidian";
import type { Moment } from "moment";

// Obsidian types moment as the module namespace (`typeof Moment`), but at
// runtime it is the callable moment function. Cast once here so call sites
// stay clean and the bundle uses the app's moment instead of a second copy.
export const momentFn = momentNs as unknown as (
  inp?: unknown,
  format?: string,
  strict?: boolean
) => Moment;

export type { Moment };
