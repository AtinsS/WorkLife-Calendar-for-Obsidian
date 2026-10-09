import { writable } from "svelte/store";

export type FinanceTab = "income" | "expenses" | "budget";

/** Set by external views to open the finance block on a specific tab. */
export const financeTabRequest = writable<FinanceTab | null>(null);

/** Ask the unified Finance view to open on a given tab. */
export function requestFinanceTab(tab: FinanceTab): void {
  financeTabRequest.set(tab);
}
