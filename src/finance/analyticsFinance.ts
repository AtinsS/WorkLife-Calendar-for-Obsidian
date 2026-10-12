import type { ExpenseEntry } from "./types";

/**
 * Analytics finance figures — fact-only (user rule).
 * Income = completed work-task earnings + manual income sources («Доходы»).
 * Expenses = actual expense log + piggy-bank goal deposits (never the budget plan).
 */
export interface AnalyticsFinanceTotals {
  income: number;
  expenses: number;
  balance: number;
  expenseList: ExpenseEntry[];
  goalDeposits: number;
}

export interface AnalyticsFinanceInput {
  /** Task earnings for the period (done work tasks). */
  taskEarnings: number;
  /** Manual income sources for the period («Доходы»). */
  manualIncome: number;
  /** Expense log entries dated in the period. */
  expenses: ExpenseEntry[];
  /** Piggy-bank deposits for the period (fact outflows). */
  goalDeposits?: number;
}

export function sumExpenseAmounts(expenses: ExpenseEntry[]): number {
  return expenses.reduce((s, e) => s + (e.amount || 0), 0);
}

/** Filter expense log by calendar month (YYYY-MM) or year (YYYY). */
export function filterExpensesByPeriod(
  expenses: ExpenseEntry[],
  year: number,
  month?: number,
): ExpenseEntry[] {
  return expenses.filter((e) => {
    const m = /^(\d{4})-(\d{2})/.exec(e.date || "");
    if (!m) return false;
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    if (y !== year) return false;
    return month === undefined || mo === month;
  });
}

/** Filter expense log by calendar date range (inclusive, YYYY-MM-DD). */
export function filterExpensesByDateRange(
  expenses: ExpenseEntry[],
  start: string,
  end: string,
): ExpenseEntry[] {
  return expenses.filter((e) => {
    const d = e.date || "";
    return d >= start && d <= end;
  });
}

export function computeAnalyticsFinance(input: AnalyticsFinanceInput): AnalyticsFinanceTotals {
  const income = (input.taskEarnings || 0) + (input.manualIncome || 0);
  const goalDeposits = Math.max(0, input.goalDeposits || 0);
  const expenses = sumExpenseAmounts(input.expenses) + goalDeposits;
  return {
    income,
    expenses,
    balance: income - expenses,
    expenseList: input.expenses,
    goalDeposits,
  };
}

type MonthDataLike = { expenses?: ExpenseEntry[] };

/** Flatten expense logs from a financeData map, skipping `_meta` keys. */
export function collectExpenseLogs(financeMap: Record<string, MonthDataLike>): ExpenseEntry[] {
  const result: ExpenseEntry[] = [];
  for (const [key, data] of Object.entries(financeMap)) {
    if (key.startsWith("_") || !data) continue;
    result.push(...(data.expenses || []));
  }
  return result;
}
