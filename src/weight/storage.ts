import type CalendarPlugin from "src/main";
import type { WeightData } from "./types";
import {
  createEmptyWeightData,
  nextEntryId,
  WEIGHT_DATA_VERSION,
} from "./types";
import { loadModuleData, saveModuleData } from "../io/vaultStorage";

export async function loadWeightData(plugin: CalendarPlugin): Promise<WeightData> {
  const moduleData = await loadModuleData(plugin.app, "weight");
  if (moduleData && Object.keys(moduleData).length > 0) {
    return normalizeWeightData(moduleData);
  }
  return createEmptyWeightData();
}

export async function saveWeightData(plugin: CalendarPlugin, data: WeightData): Promise<void> {
  await saveModuleData(plugin.app, "weight", data as unknown as Record<string, unknown>);
}

function normalizeWeightData(raw: Record<string, unknown>): WeightData {
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const goal = (raw.goal && typeof raw.goal === "object" ? raw.goal : {}) as {
    startWeight?: unknown;
    targetWeight?: unknown;
  };
  return {
    entries: entries
      .filter(
        (e): e is { date: string; weight: number; id?: unknown; note?: unknown; updatedAt?: unknown } =>
          !!e &&
          typeof (e as { date?: unknown }).date === "string" &&
          typeof (e as { weight?: unknown }).weight === "number" &&
          isFinite((e as { weight: number }).weight),
      )
      .map((e) => ({
        id: typeof e.id === "string" && e.id ? e.id : nextEntryId(e.date),
        date: e.date,
        weight: e.weight,
        note: typeof e.note === "string" ? e.note : undefined,
        updatedAt: typeof e.updatedAt === "number" ? e.updatedAt : Date.now(),
      })),
    goal: {
      startWeight:
        typeof goal.startWeight === "number" && isFinite(goal.startWeight)
          ? goal.startWeight
          : null,
      targetWeight:
        typeof goal.targetWeight === "number" && isFinite(goal.targetWeight)
          ? goal.targetWeight
          : null,
    },
    version: typeof raw.version === "number" ? raw.version : WEIGHT_DATA_VERSION,
  };
}
