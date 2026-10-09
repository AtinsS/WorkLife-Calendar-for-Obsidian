import { resolveMonthIncome, resolveStoredIncome, normalizeIncomeMode, getMonthIncomeTotal } from "../income";
import { financialAnalyticsData } from "../financialAnalyticsStorage";
import { tasks } from "../../task-tracker/stores";

describe("normalizeIncomeMode", () => {
  it("maps stored sources to UI modes", () => {
    expect(normalizeIncomeMode("manual")).toBe("manual");
    expect(normalizeIncomeMode("plan")).toBe("plan");
    expect(normalizeIncomeMode("fact")).toBe("fact");
    // legacy / unknown collapse to auto-derive
    expect(normalizeIncomeMode("analytics")).toBe("fact");
    expect(normalizeIncomeMode(undefined)).toBe("fact");
  });
});

describe("resolveMonthIncome", () => {
  beforeEach(() => {
    tasks.set([]);
    financialAnalyticsData.set({ manualIncomeSources: [], incomeCategories: [] });
  });

  it("manual mode returns the override and ignores sources", () => {
    financialAnalyticsData.set({
      manualIncomeSources: [
        { id: "mi-1", name: "Фриланс", amount: 10000, date: "2026-07-05", category: "Работа", createdAt: 1 },
      ],
      incomeCategories: ["Работа"],
    });

    const result = resolveMonthIncome(2026, 7, { mode: "manual", manualOverride: 50000 });
    expect(result.total).toBe(50000);
    expect(result.fromTasks).toBe(0);
    expect(result.fromManualSources).toBe(0);
  });

  it("manual mode clamps negative override to zero", () => {
    const result = resolveMonthIncome(2026, 7, { mode: "manual", manualOverride: -100 });
    expect(result.total).toBe(0);
  });

  it("fact mode sums done-task earnings + manual sources", () => {
    tasks.set([
      {
        id: "t-1",
        title: "Work",
        isWorkTask: true,
        rate: 1000,
        paymentType: "hour",
        totalWorkTime: 2 * 3600000,
        status: "done",
        dateUID: "day-2026-07-10",
      } as never,
    ]);
    financialAnalyticsData.set({
      manualIncomeSources: [
        { id: "mi-1", name: "Продажа", amount: 3000, date: "2026-07-15", category: "Другое", createdAt: 1 },
        // different month — must be excluded
        { id: "mi-2", name: "Мимо", amount: 999, date: "2026-06-01", category: "Другое", createdAt: 2 },
      ],
      incomeCategories: ["Другое"],
    });

    const result = resolveMonthIncome(2026, 7, { mode: "fact" });
    expect(result.fromTasks).toBe(2000);
    expect(result.fromManualSources).toBe(3000);
    expect(result.total).toBe(5000);
  });

  it("plan mode uses expected earnings (estimate-based) + manual sources", () => {
    tasks.set([
      {
        id: "t-1",
        title: "Work",
        isWorkTask: true,
        rate: 1000,
        paymentType: "hour",
        estimatedTime: 120, // 2h in minutes
        status: "todo",
        dateUID: "day-2026-07-10",
      } as never,
    ]);
    financialAnalyticsData.set({
      manualIncomeSources: [
        { id: "mi-1", name: "Бонус", amount: 500, date: "2026-07-01", category: "Другое", createdAt: 1 },
      ],
      incomeCategories: ["Другое"],
    });

    const result = resolveMonthIncome(2026, 7, { mode: "plan" });
    expect(result.fromTasks).toBe(2000);
    expect(result.fromManualSources).toBe(500);
    expect(result.total).toBe(2500);
  });

  it("getMonthIncomeTotal matches the breakdown total", () => {
    financialAnalyticsData.set({
      manualIncomeSources: [
        { id: "mi-1", name: "X", amount: 700, date: "2026-07-20", category: "Другое", createdAt: 1 },
      ],
      incomeCategories: ["Другое"],
    });
    expect(getMonthIncomeTotal(2026, 7, { mode: "fact" })).toBe(700);
  });
});

describe("resolveStoredIncome", () => {
  beforeEach(() => {
    tasks.set([]);
    financialAnalyticsData.set({ manualIncomeSources: [], incomeCategories: [] });
  });

  it("legacy month (no incomeSource) trusts stored monthlyIncome", () => {
    const result = resolveStoredIncome({ monthlyIncome: 120000 }, 2026, 7);
    expect(result.mode).toBe("manual");
    expect(result.total).toBe(120000);
  });

  it("manual month trusts stored monthlyIncome", () => {
    const result = resolveStoredIncome(
      { monthlyIncome: 80000, incomeSource: "manual" },
      2026,
      7,
    );
    expect(result.total).toBe(80000);
  });

  it("fact month ignores stored monthlyIncome and derives from sources", () => {
    financialAnalyticsData.set({
      manualIncomeSources: [
        { id: "mi-1", name: "X", amount: 4000, date: "2026-07-03", category: "Другое", createdAt: 1 },
      ],
      incomeCategories: ["Другое"],
    });
    const result = resolveStoredIncome(
      { monthlyIncome: 999999, incomeSource: "fact" },
      2026,
      7,
    );
    expect(result.total).toBe(4000);
    expect(result.fromManualSources).toBe(4000);
  });

  it("analytics (legacy derived) month also derives from sources", () => {
    const result = resolveStoredIncome(
      { monthlyIncome: 500, incomeSource: "analytics" },
      2026,
      7,
    );
    expect(result.mode).toBe("fact");
    expect(result.total).toBe(0);
  });
});
