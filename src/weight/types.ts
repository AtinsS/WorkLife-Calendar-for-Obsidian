export const WEIGHT_DATA_VERSION = 1;

export interface WeightEntry {
  /** YYYY-MM-DD */
  date: string;
  /** Weight in kg */
  weight: number;
  note?: string;
  updatedAt: number;
}

export interface WeightGoal {
  /** Starting weight for progress calculation (kg) */
  startWeight: number | null;
  /** Target weight (kg) */
  targetWeight: number | null;
}

export interface WeightData {
  entries: WeightEntry[];
  goal: WeightGoal;
  version: number;
}

export function createEmptyWeightData(): WeightData {
  return {
    entries: [],
    goal: { startWeight: null, targetWeight: null },
    version: WEIGHT_DATA_VERSION,
  };
}

/** Normalize user date input to YYYY-MM-DD */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
