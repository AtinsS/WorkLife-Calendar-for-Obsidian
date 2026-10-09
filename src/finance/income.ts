import { getEarningsForMonth, getExpectedEarningsForMonth } from "../task-tracker/stores";
import { getManualIncomeForMonth } from "./financialAnalyticsStorage";
import type { FinanceIncomeSource } from "./types";

/**
 * Single source of truth for month income.
 *
 * Income is composed of two independent sources plus an optional override:
 *   - task earnings (derived from the tasks store, never stored)
 *   - manual income entries (stored in financialAnalyticsData.manualIncomeSources)
 *   - manual override (stored in FinanceMonthData.monthlyIncome when mode = "manual")
 *
 * Modes:
 *   - "plan":   expected task earnings + manual sources
 *   - "fact":   actual task earnings + manual sources
 *   - "manual": the stored override only (does not auto-derive)
 */
export type IncomeMode = "plan" | "fact" | "manual";

export interface MonthIncomeBreakdown {
  mode: IncomeMode;
  /** Earnings calculated from work tasks (0 in manual mode). */
  fromTasks: number;
  /** Sum of manual income entries dated in this month (0 in manual mode). */
  fromManualSources: number;
  /** Effective total income for the month. */
  total: number;
}

/**
 * Normalize a stored incomeSource to a mode the UI can switch between.
 * Legacy "analytics" and missing values collapse to "fact" (auto-derive).
 */
export function normalizeIncomeMode(source: FinanceIncomeSource | undefined): IncomeMode {
  if (source === "manual") return "manual";
  if (source === "plan") return "plan";
  return "fact";
}

export interface ResolveIncomeOptions {
  mode?: IncomeMode;
  /** Stored `monthlyIncome` — authoritative when mode is "manual". */
  manualOverride?: number;
}

/** Resolve effective income for a month from the underlying sources. */
export function resolveMonthIncome(
  year: number,
  month: number,
  opts: ResolveIncomeOptions = {},
): MonthIncomeBreakdown {
  const mode = opts.mode ?? "fact";

  if (mode === "manual") {
    return {
      mode,
      fromTasks: 0,
      fromManualSources: 0,
      total: Math.max(0, opts.manualOverride ?? 0),
    };
  }

  const fromTasks =
    mode === "plan"
      ? getExpectedEarningsForMonth(year, month)
      : getEarningsForMonth(year, month);
  const fromManualSources = getManualIncomeForMonth(year, month);

  return {
    mode,
    fromTasks,
    fromManualSources,
    total: fromTasks + fromManualSources,
  };
}

/** Shorthand: just the total. */
export function getMonthIncomeTotal(
  year: number,
  month: number,
  opts: ResolveIncomeOptions = {},
): number {
  return resolveMonthIncome(year, month, opts).total;
}

/**
 * Effective income for a stored month record.
 * - no incomeSource (legacy) or "manual" → stored `monthlyIncome` is authoritative
 * - "plan" / "fact" / "analytics" → derived from tasks + manual sources
 */
export function resolveStoredIncome(month: {
  monthlyIncome: number;
  incomeSource?: FinanceIncomeSource;
}, year: number, monthNum: number): MonthIncomeBreakdown {
  // Legacy months stored a plain total with no mode — treat it as a manual override.
  if (!month.incomeSource || month.incomeSource === "manual") {
    return {
      mode: "manual",
      fromTasks: 0,
      fromManualSources: 0,
      total: Math.max(0, month.monthlyIncome ?? 0),
    };
  }
  const mode = normalizeIncomeMode(month.incomeSource);
  return resolveMonthIncome(year, monthNum, {
    mode,
    manualOverride: month.monthlyIncome,
  });
}
