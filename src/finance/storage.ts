import { writable, get } from "svelte/store";
import type CalendarPlugin from "../main";
import type { IFinanceData, FinanceMonthData, MonthGoal } from "./types";
import { createEmptyMonthData, generateGoalId, getGoalMonthContribution, isGoalComplete } from "./types";
import { loadModuleData, saveModuleData } from "../io/vaultStorage";

export const financeData = writable<IFinanceData>({});

let pluginInstance: CalendarPlugin | null = null;
let saveTimeout: number | null = null;
let loaded = false;
let storeIsDirty = false; // true when store has unsaved local edits
let isSaving = false; // true while a write to vault is in-flight

export async function initFinanceStores(plugin: CalendarPlugin): Promise<void> {
  pluginInstance = plugin;
  // Always load from vault on init — ignore dirty/saving state
  await loadFinanceDataFromVault();
}

export async function reloadFinanceStores(): Promise<void> {
  await loadFinanceData();
}

async function loadFinanceData(): Promise<void> {
  if (!pluginInstance) return;

  // Skip reload if there are unsaved local edits or a write is in-flight —
  // otherwise the vault sync would overwrite the user's pending changes.
  if (storeIsDirty || isSaving) {
    loaded = true;
    return;
  }

  await loadFinanceDataFromVault();
}

async function loadFinanceDataFromVault(): Promise<void> {
  if (!pluginInstance) return;

  // Finance always uses vaultStorage (split-file format)
  const moduleData = await loadModuleData(pluginInstance.app, "finance") as IFinanceData;
  if (moduleData && Object.keys(moduleData).length > 0) {
    financeData.set(moduleData);
  }
  loaded = true;
}

function debouncedSave(): void {
  if (!loaded) return;
  storeIsDirty = true;
  if (saveTimeout) window.clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(() => {
    void (async () => {
      if (!pluginInstance) return;
      isSaving = true;
      try {
        await saveModuleData(pluginInstance.app, "finance", get(financeData));
      } finally {
        isSaving = false;
        storeIsDirty = false;
      }
    })();
  }, 300);
}

export async function immediateFinanceSave(): Promise<void> {
  if (!loaded || !pluginInstance) return;
  if (saveTimeout) {
    window.clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  isSaving = true;
  try {
    await saveModuleData(pluginInstance.app, "finance", get(financeData));
  } finally {
    isSaving = false;
    storeIsDirty = false;
  }
}

export function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function getMonthData(monthKey: string): FinanceMonthData {
  const allData = get(financeData);
  if (!allData[monthKey]) {
    return createEmptyMonthData();
  }
  const raw = allData[monthKey];

  // Deep copy to avoid mutating store data
  const data: FinanceMonthData = {
    ...raw,
    mainAccountCategories: raw.mainAccountCategories.map((c) => ({ ...c })),
    monthGoals: (raw.monthGoals || []).map((g) => ({ ...g })),
    savingsCategories: (raw.savingsCategories || []).map((c) => ({ ...c })),
    distributionRules: [...raw.distributionRules],
    expenses: (raw.expenses || []).map((e) => ({ ...e })),
  };

  // Migration: convert old string[] monthGoals to MonthGoal[]
  if (Array.isArray(data.monthGoals) && data.monthGoals.length > 0 && typeof data.monthGoals[0] === "string") {
    data.monthGoals = (data.monthGoals as unknown as string[]).map((g: string) => ({
      id: generateGoalId(),
      icon: "🎯",
      name: typeof g === "string" ? g : "Цель",
      currentAmount: 0,
      targetAmount: 0,
      broughtForward: 0,
    }));
  }

  // Migration: ensure goals have broughtForward (treat missing as "saved before this month")
  // so multi-month goals don't count their whole history against this month's balance.
  data.monthGoals = (data.monthGoals || []).map((g) => ({
    ...g,
    broughtForward: g.broughtForward ?? g.currentAmount ?? 0,
    currentAmount: g.currentAmount ?? 0,
    targetAmount: g.targetAmount ?? 0,
  }));

  // Migration: ensure savingsCategories have percent and completed
  if (data.savingsCategories) {
    data.savingsCategories = data.savingsCategories.map((c) => ({
      ...c,
      percent: c.percent ?? 0,
      completed: c.completed ?? false,
    }));
  }

  return data;
}

export function updateMonthData(monthKey: string, changes: Partial<FinanceMonthData>): void {
  financeData.update((current) => ({
    ...current,
    [monthKey]: {
      ...(current[monthKey] || createEmptyMonthData()),
      ...changes,
      updatedAt: new Date().toISOString(),
    },
  }));
  void debouncedSave();
}

export function addIncome(amount: number): void {
  const monthKey = getCurrentMonthKey();
  const data = getMonthData(monthKey);
  updateMonthData(monthKey, { monthlyIncome: data.monthlyIncome + amount });
}

export function getMainAccountTotal(monthKey: string): number {
  const data = getMonthData(monthKey);
  return data.mainAccountCategories.reduce((sum, c) => sum + c.amount, 0);
}

export function getSavingsTotal(monthKey: string): number {
  const data = getMonthData(monthKey);
  return data.savingsCategories.reduce((sum, c) => sum + c.amount, 0);
}

export function getCurrentBalance(monthKey: string): number {
  const data = getMonthData(monthKey);
  const mainTotal = data.mainAccountCategories.reduce((sum, c) => sum + c.amount, 0);
  return data.monthlyIncome - mainTotal - getMonthGoalContributions(monthKey);
}

/** Sum of goal deposits made THIS month (excludes money carried over from previous months). */
export function getMonthGoalContributions(monthKey: string): number {
  const data = getMonthData(monthKey);
  return (data.monthGoals || []).reduce((sum, g) => sum + getGoalMonthContribution(g), 0);
}

export function getMonthGoals(monthKey: string): MonthGoal[] {
  const data = getMonthData(monthKey);
  return data.monthGoals || [];
}

export function getStoredMonthKeys(): string[] {
  return Object.keys(get(financeData)).sort();
}

export function deleteMonthData(monthKey: string): void {
  financeData.update((current) => {
    const next = { ...current };
    delete next[monthKey];
    return next;
  });
  void debouncedSave();
}

export function deleteMonthsBefore(cutoffKey: string): number {
  const all = get(financeData);
  const keys = Object.keys(all).filter((k) => k < cutoffKey);
  if (keys.length === 0) return 0;
  financeData.update((current) => {
    const next = { ...current };
    for (const k of keys) delete next[k];
    return next;
  });
  void debouncedSave();
  return keys.length;
}

const ARCHIVE_KEY = "_archive";
const EXPENSE_CATS_KEY = "_expenseCategories";

type ExpenseCatsMeta = {
  expenseCategories: import("./expenseCategories").ExpenseCategoryDef[];
  updatedAt: string;
};

/** Custom expense categories (built on top of built-in taxonomy). */
export function getCustomExpenseCategories(): import("./expenseCategories").ExpenseCategoryDef[] {
  const all = get(financeData) as Record<string, unknown>;
  const raw = all[EXPENSE_CATS_KEY] as ExpenseCatsMeta | undefined;
  return raw?.expenseCategories || [];
}

export function saveCustomExpenseCategories(
  cats: import("./expenseCategories").ExpenseCategoryDef[],
): void {
  financeData.update((current) => {
    const next = { ...current } as Record<string, unknown>;
    next[EXPENSE_CATS_KEY] = {
      expenseCategories: cats,
      updatedAt: new Date().toISOString(),
    } satisfies ExpenseCatsMeta;
    return next as typeof current;
  });
  void debouncedSave();
}

export function getArchivedGoals(): MonthGoal[] {
  const all = get(financeData);
  return all[ARCHIVE_KEY]?.monthGoals || [];
}

export function deleteArchivedGoal(goalId: string): void {
  financeData.update((current) => {
    const archiveData = current[ARCHIVE_KEY];
    if (!archiveData) return current;
    const updated = {
      ...current,
      [ARCHIVE_KEY]: {
        ...archiveData,
        monthGoals: archiveData.monthGoals.filter((g) => g.id !== goalId),
        updatedAt: new Date().toISOString(),
      },
    };
    return updated;
  });
  void debouncedSave();
}

function normalizeGoalForCarry(goal: MonthGoal): MonthGoal {
  return {
    ...goal,
    currentAmount: goal.currentAmount ?? 0,
    targetAmount: goal.targetAmount ?? 0,
    // Money already saved before the target month — not this month's deposit
    broughtForward: goal.currentAmount ?? 0,
  };
}

/** Expand YYYY-MM keys into a continuous chain from the earliest key through currentMonthKey. */
function expandMonthChain(keys: string[], currentMonthKey: string): string[] {
  const sorted = [...new Set([...keys, currentMonthKey])].sort();
  const start = sorted[0] || currentMonthKey;
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = currentMonthKey.split("-").map(Number);
  const chain: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    chain.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return chain;
}

/**
 * Carry savings goals forward month by month until they are fully funded.
 * - Incomplete goals are DUPLICATED into the next month (history is kept in previous months),
 *   including the accumulated money (`currentAmount` → `broughtForward`).
 * - Completed goals are archived and do not continue.
 * - Runs as a cascade so opening a later month fills the gap from earlier ones.
 */
export function ensureGoalsRollover(currentMonthKey: string): void {
  const all = get(financeData);
  const existingKeys = Object.keys(all).filter((k) => k !== ARCHIVE_KEY && k <= currentMonthKey);
  const chain = expandMonthChain(existingKeys, currentMonthKey);

  // Build a working copy of goals for every month in the chain
  const goalsByMonth: Record<string, MonthGoal[]> = {};
  for (const key of chain) {
    goalsByMonth[key] = (all[key]?.monthGoals || []).map((g) => ({
      ...g,
      currentAmount: g.currentAmount ?? 0,
      targetAmount: g.targetAmount ?? 0,
      broughtForward: g.broughtForward ?? g.currentAmount ?? 0,
    }));
  }

  const archivedIds = new Set(getArchivedGoals().map((g) => g.id));
  const newArchived: MonthGoal[] = [];
  let changed = false;

  for (let i = 0; i < chain.length - 1; i++) {
    const fromKey = chain[i];
    const toKey = chain[i + 1];
    const fromGoals = goalsByMonth[fromKey];
    const toGoals = goalsByMonth[toKey];
    const toIds = new Set(toGoals.map((g) => g.id));

    for (const goal of fromGoals) {
      if (toIds.has(goal.id)) continue;

      if (isGoalComplete(goal)) {
        if (!archivedIds.has(goal.id)) {
          newArchived.push({ ...goal });
          archivedIds.add(goal.id);
          changed = true;
        }
        continue;
      }

      toGoals.push(normalizeGoalForCarry(goal));
      toIds.add(goal.id);
      changed = true;
    }
  }

  // Archive completed goals sitting in past months that never got archived
  for (const key of chain) {
    if (key === currentMonthKey) continue;
    for (const goal of goalsByMonth[key]) {
      if (isGoalComplete(goal) && !archivedIds.has(goal.id)) {
        newArchived.push({ ...goal });
        archivedIds.add(goal.id);
        changed = true;
      }
    }
  }

  if (!changed) return;

  financeData.update((current) => {
    const next = { ...current };

    if (newArchived.length > 0) {
      const existingArchive = next[ARCHIVE_KEY]?.monthGoals || [];
      const existingIds = new Set(existingArchive.map((g) => g.id));
      const toAdd = newArchived.filter((g) => !existingIds.has(g.id));
      if (toAdd.length > 0) {
        next[ARCHIVE_KEY] = {
          ...(next[ARCHIVE_KEY] || createEmptyMonthData()),
          monthGoals: [...existingArchive, ...toAdd],
          updatedAt: new Date().toISOString(),
        };
      }
    }

    for (const key of Object.keys(goalsByMonth)) {
      const prevGoals = next[key]?.monthGoals || [];
      const nextGoals = goalsByMonth[key];
      const prevIds = new Set(prevGoals.map((g) => g.id));
      const nextIds = new Set(nextGoals.map((g) => g.id));
      const same =
        prevIds.size === nextIds.size &&
        [...nextIds].every((id) => prevIds.has(id));
      if (same && next[key]) continue;

      // Only write months that already exist or that received carried goals
      if (!next[key] && nextGoals.length === 0) continue;

      next[key] = {
        ...(next[key] || createEmptyMonthData()),
        monthGoals: nextGoals,
        updatedAt: new Date().toISOString(),
      };
    }

    return next;
  });
  void debouncedSave();
}

/** @deprecated Use ensureGoalsRollover — kept for existing call sites. */
export function rolloverGoals(prevMonthKey: string, currentMonthKey: string): void {
  void prevMonthKey;
  ensureGoalsRollover(currentMonthKey);
}
