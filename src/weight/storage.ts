import type CalendarPlugin from "src/main";
import type { WeightData } from "./types";
import { createEmptyWeightData, WEIGHT_DATA_VERSION } from "./types";
import { loadModuleData, saveModuleData } from "../io/vaultStorage";

export async function loadWeightData(plugin: CalendarPlugin): Promise<WeightData> {
  const moduleData = await loadModuleData(plugin.app, "weight");
  if (moduleData && Object.keys(moduleData).length > 0) {
    return normalizeWeightData(moduleData as unknown as Partial<WeightData>);
  }
  return createEmptyWeightData();
}

export async function saveWeightData(plugin: CalendarPlugin, data: WeightData): Promise<void> {
  await saveModuleData(plugin.app, "weight", data as unknown as Record<string, unknown>);
}

function normalizeWeightData(raw: Partial<WeightData>): WeightData {
  const empty = createEmptyWeightData();
  return {
    entries: Array.isArray(raw.entries)
      ? raw.entries
          .filter((e) => e && typeof e.date === "string" && typeof e.weight === "number" && isFinite(e.weight))
          .map((e) => ({
            date: e.date,
            weight: e.weight,
            note: typeof e.note === "string" ? e.note : undefined,
            updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : Date.now(),
          }))
      : empty.entries,
    goal: {
      startWeight:
        typeof raw.goal?.startWeight === "number" && isFinite(raw.goal.startWeight)
          ? raw.goal.startWeight
          : null,
      targetWeight:
        typeof raw.goal?.targetWeight === "number" && isFinite(raw.goal.targetWeight)
          ? raw.goal.targetWeight
          : null,
    },
    version: typeof raw.version === "number" ? raw.version : WEIGHT_DATA_VERSION,
  };
}
