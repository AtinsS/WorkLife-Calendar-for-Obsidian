export interface FinanceCategory {
  id: string;
  name: string;
  icon: string;
  amount: number;
  order: number;
}

export interface MonthGoal {
  id: string;
  icon: string;
  name: string;
  currentAmount: number;
  targetAmount: number;
  /** Amount already saved before this month (set on rollover). This month's contribution = currentAmount - broughtForward. */
  broughtForward?: number;
}

export interface SavingsCategory extends FinanceCategory {
  percent: number;
  completed: boolean;
}

/** Actual money spent — kept separate from the budget plan. */
export interface ExpenseEntry {
  id: string;
  name: string;
  icon: string;
  amount: number;
  categoryName: string;
  /** YYYY-MM-DD */
  date: string;
  note?: string;
  createdAt: string;
}

export type FinanceIncomeSource = "plan" | "fact" | "manual" | "analytics";

export interface FinanceMonthData {
  monthlyIncome: number;
  lastMonthExpense: number;
  mainAccountCategories: FinanceCategory[];
  monthGoals: MonthGoal[];
  savingsCategories: SavingsCategory[];
  distributionRules: string[];
  /** Actual money spent — kept separate from the budget plan. Optional for legacy months. */
  expenses?: ExpenseEntry[];
  incomeSource?: FinanceIncomeSource;
  updatedAt: string;
}

export interface IFinanceData {
  [monthKey: string]: FinanceMonthData;
}

export function createEmptyMonthData(): FinanceMonthData {
  return {
    monthlyIncome: 0,
    lastMonthExpense: 0,
    mainAccountCategories: [],
    monthGoals: [],
    savingsCategories: [],
    distributionRules: [],
    expenses: [],
    updatedAt: new Date().toISOString(),
  };
}

let idCounter = 0;

export function generateGoalId(): string {
  return `fg-${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function generateCategoryId(): string {
  return `fc-${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function generateExpenseId(): string {
  return `fe-${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** How much of the goal's total was deposited THIS month (not counting carried-over money). */
export function getGoalMonthContribution(goal: MonthGoal): number {
  const brought = goal.broughtForward ?? 0;
  return Math.max(0, (goal.currentAmount || 0) - brought);
}

export function isGoalComplete(goal: MonthGoal): boolean {
  return goal.targetAmount > 0 && goal.currentAmount >= goal.targetAmount;
}

export type GoalAdjustMode = "amount" | "percent";

/**
 * Resolve a deposit/withdraw action to a signed delta for `currentAmount`.
 * - amount mode: value is money
 * - percent mode: deposit is % of balance, withdraw is % of goal's saved amount
 */
export function resolveGoalAdjustment(
  value: number,
  mode: GoalAdjustMode,
  direction: "deposit" | "withdraw",
  ctx: { balance: number; currentAmount: number }
): number {
  const raw = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (raw === 0) return 0;

  let amount: number;
  if (mode === "amount") {
    amount = raw;
  } else {
    const base = direction === "deposit" ? Math.max(0, ctx.balance) : Math.max(0, ctx.currentAmount);
    amount = (base * Math.min(100, raw)) / 100;
  }
  amount = Math.round(amount);
  return direction === "deposit" ? amount : -amount;
}
