import { writable, get } from "svelte/store";
import type CalendarPlugin from "src/main";
import type { WeightData, WeightEntry, WeightGoal } from "./types";
import {
  createEmptyWeightData,
  nextEntryId,
  WEIGHT_DATA_VERSION,
} from "./types";
import { loadWeightData, saveWeightData } from "./storage";
import {
  buildWeightSeries,
  computeGoalProgress,
  currentMovingAverage,
  latestWeight,
  type GoalProgress,
  type WeightPoint,
} from "./stats";

let pluginInstance: CalendarPlugin | null = null;
let saveTimeout: number | null = null;
let loaded = false;

export const weightData = writable<WeightData>(createEmptyWeightData());

function persist(): void {
  if (!loaded || !pluginInstance) return;
  const plugin = pluginInstance;
  if (saveTimeout) window.clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(() => {
    const data = get(weightData);
    void saveWeightData(plugin, {
      ...data,
      version: WEIGHT_DATA_VERSION,
    });
  }, 300);
}

export async function initWeightStores(plugin: CalendarPlugin): Promise<void> {
  pluginInstance = plugin;
  const data = await loadWeightData(plugin);
  weightData.set(data);
  loaded = true;
}

export async function reloadWeightStores(): Promise<void> {
  if (!pluginInstance) return;
  const data = await loadWeightData(pluginInstance);
  weightData.set(data);
}

export function immediateWeightSave(): void {
  if (!loaded || !pluginInstance) return;
  if (saveTimeout) {
    window.clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  void saveWeightData(pluginInstance, get(weightData));
}

/** Append a measurement. Multiple entries per day are kept in the list. */
export function setWeightEntry(
  date: string,
  weight: number,
  note?: string
): void {
  if (!date || !isFinite(weight) || weight <= 0) return;
  weightData.update((data) => {
    const updatedAt = Date.now();
    const entries: WeightEntry[] = [
      ...data.entries,
      {
        id: nextEntryId(date),
        date,
        weight,
        note: note?.trim() || undefined,
        updatedAt,
      },
    ];
    const goal = { ...data.goal };
    // Auto-fill start weight from first measurement if unset
    if (goal.startWeight == null && entries.length > 0) {
      const first = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      goal.startWeight = first.weight;
    }
    return { ...data, entries, goal };
  });
  persist();
}

/** Remove a single measurement by id. */
export function removeWeightEntry(id: string): void {
  weightData.update((data) => ({
    ...data,
    entries: data.entries.filter((e) => e.id !== id),
  }));
  persist();
}

export function setWeightGoal(goal: Partial<WeightGoal>): void {
  weightData.update((data) => ({
    ...data,
    goal: {
      startWeight:
        goal.startWeight !== undefined ? goal.startWeight : data.goal.startWeight,
      targetWeight:
        goal.targetWeight !== undefined
          ? goal.targetWeight
          : data.goal.targetWeight,
    },
  }));
  persist();
}

// --- Derived helpers used by UI ---

export function getWeightSeries(windowDays = 7): WeightPoint[] {
  return buildWeightSeries(get(weightData).entries, windowDays);
}

export function getLatestWeightEntry(): WeightEntry | null {
  return latestWeight(get(weightData).entries);
}

export function getCurrentMA(windowDays = 7): number | null {
  return currentMovingAverage(get(weightData).entries, windowDays);
}

export function getGoalProgress(): GoalProgress {
  const data = get(weightData);
  return computeGoalProgress(data.entries, data.goal);
}
