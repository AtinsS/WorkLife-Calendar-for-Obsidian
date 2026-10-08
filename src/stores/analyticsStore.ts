import { writable } from "svelte/store";

export type AnalyticsTab = "weight" | "habits" | "tasks" | "time" | "earnings";

/** Set by external views to open analytics on a specific tab. */
export const analyticsTabRequest = writable<AnalyticsTab | null>(null);
