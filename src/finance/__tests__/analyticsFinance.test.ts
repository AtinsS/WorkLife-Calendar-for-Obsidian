import {
  computeAnalyticsFinance,
  filterExpensesByPeriod,
  sumExpenseAmounts,
} from "../analyticsFinance";
import type { ExpenseEntry } from "../types";

function exp(date: string, amount: number, name = "x"): ExpenseEntry {
  return {
    id: name + date,
    name,
    icon: "i",
    amount,
    categoryName: "other",
    date,
    createdAt: date,
  };
}

describe("sumExpenseAmounts", () => {
  it("sums amounts and tolerates missing", () => {
    expect(sumExpenseAmounts([exp("2026-02-01", 100), exp("2026-02-02", 50)])).toBe(150);
    expect(sumExpenseAmounts([])).toBe(0);
  });
});

describe("filterExpensesByPeriod", () => {
  const list = [
    exp("2026-02-01", 10),
    exp("2026-02-15", 20),
    exp("2026-03-01", 40),
    exp("2025-02-01", 80),
  ];

  it("filters by month", () => {
    const result = filterExpensesByPeriod(list, 2026, 2);
    expect(result.map((e) => e.amount)).toEqual([10, 20]);
  });

  it("filters by year when month omitted", () => {
    const result = filterExpensesByPeriod(list, 2026);
    expect(result.map((e) => e.amount)).toEqual([10, 20, 40]);
  });

  it("skips entries without a parseable date", () => {
    expect(filterExpensesByPeriod([{ ...exp("2026-02-01", 1), date: "" }], 2026, 2)).toEqual([]);
  });
});

describe("computeAnalyticsFinance", () => {
  it("income = task earnings + manual income sources", () => {
    const r = computeAnalyticsFinance({
      taskEarnings: 50000,
      manualIncome: 15000,
      expenses: [exp("2026-02-01", 10000)],
    });
    expect(r.income).toBe(65000);
    expect(r.expenses).toBe(10000);
    expect(r.balance).toBe(55000);
  });

  it("expenses come only from the expense log (no plan / no goals)", () => {
    const r = computeAnalyticsFinance({
      taskEarnings: 0,
      manualIncome: 0,
      expenses: [exp("2026-02-01", 300), exp("2026-02-02", 200)],
    });
    expect(r.expenses).toBe(500);
    expect(r.balance).toBe(-500);
  });

  it("handles empty input", () => {
    const r = computeAnalyticsFinance({ taskEarnings: 0, manualIncome: 0, expenses: [] });
    expect(r).toEqual({ income: 0, expenses: 0, balance: 0, expenseList: [], goalDeposits: 0 });
  });

  it("includes goal deposits in expenses", () => {
    const r = computeAnalyticsFinance({
      taskEarnings: 10000,
      manualIncome: 5000,
      expenses: [{ id: "e1", name: "Еда", icon: "🥕", amount: 3000, categoryName: "Еда", date: "2026-07-01", createdAt: "" }],
      goalDeposits: 2000,
    });
    expect(r.income).toBe(15000);
    expect(r.goalDeposits).toBe(2000);
    expect(r.expenses).toBe(5000);
    expect(r.balance).toBe(10000);
  });
});
