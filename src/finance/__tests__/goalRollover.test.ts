import {
  financeData,
  ensureGoalsRollover,
  getMonthData,
  updateMonthData,
  getArchivedGoals,
  getMonthGoalContributions,
  getCurrentBalance,
} from "../storage";
import { getGoalMonthContribution, isGoalComplete, resolveGoalAdjustment, type MonthGoal } from "../types";

function goal(partial: Partial<MonthGoal> = {}): MonthGoal {
  return {
    id: "g1",
    icon: "🎯",
    name: "Цель",
    currentAmount: 0,
    targetAmount: 100000,
    broughtForward: 0,
    ...partial,
  };
}

beforeEach(() => {
  financeData.set({});
});

describe("getGoalMonthContribution", () => {
  it("counts only money added above broughtForward", () => {
    expect(getGoalMonthContribution(goal({ currentAmount: 30000, broughtForward: 25000 }))).toBe(5000);
  });

  it("returns 0 when nothing was deposited this month", () => {
    expect(getGoalMonthContribution(goal({ currentAmount: 25000, broughtForward: 25000 }))).toBe(0);
  });

  it("returns 0 when current is below broughtForward (no negative contribution)", () => {
    expect(getGoalMonthContribution(goal({ currentAmount: 10000, broughtForward: 25000 }))).toBe(0);
  });

  it("treats missing broughtForward as already saved", () => {
    const g = goal({ currentAmount: 25000 });
    delete g.broughtForward;
    // getMonthData migration would set broughtForward = currentAmount
    expect(getGoalMonthContribution({ ...g, broughtForward: g.currentAmount })).toBe(0);
  });
});

describe("isGoalComplete", () => {
  it("is complete when current reaches target", () => {
    expect(isGoalComplete(goal({ currentAmount: 100000, targetAmount: 100000 }))).toBe(true);
  });

  it("is incomplete while under target", () => {
    expect(isGoalComplete(goal({ currentAmount: 50000, targetAmount: 100000 }))).toBe(false);
  });

  it("is incomplete when target is 0 (no target set)", () => {
    expect(isGoalComplete(goal({ currentAmount: 5000, targetAmount: 0 }))).toBe(false);
  });
});

describe("resolveGoalAdjustment", () => {
  const ctx = { balance: 50000, currentAmount: 20000 };

  it("deposits a fixed amount", () => {
    expect(resolveGoalAdjustment(5000, "amount", "deposit", ctx)).toBe(5000);
  });

  it("withdraws a fixed amount", () => {
    expect(resolveGoalAdjustment(3000, "amount", "withdraw", ctx)).toBe(-3000);
  });

  it("deposits percent of balance", () => {
    expect(resolveGoalAdjustment(10, "percent", "deposit", ctx)).toBe(5000);
  });

  it("withdraws percent of goal savings", () => {
    expect(resolveGoalAdjustment(10, "percent", "withdraw", ctx)).toBe(-2000);
  });

  it("returns 0 for empty / invalid input", () => {
    expect(resolveGoalAdjustment(0, "amount", "deposit", ctx)).toBe(0);
    expect(resolveGoalAdjustment(-5, "amount", "deposit", ctx)).toBe(0);
    expect(resolveGoalAdjustment(NaN, "percent", "withdraw", ctx)).toBe(0);
  });

  it("caps percent at 100", () => {
    expect(resolveGoalAdjustment(150, "percent", "deposit", ctx)).toBe(50000);
    expect(resolveGoalAdjustment(150, "percent", "withdraw", ctx)).toBe(-20000);
  });
});

describe("ensureGoalsRollover", () => {
  it("duplicates incomplete goals with money into next month", () => {
    updateMonthData("2026-07", {
      monthGoals: [goal({ id: "g1", name: "Отпуск", currentAmount: 25000, targetAmount: 80000 })],
    });
    updateMonthData("2026-08", { monthlyIncome: 100000 });

    ensureGoalsRollover("2026-08");

    const aug = getMonthData("2026-08");
    expect(aug.monthGoals).toHaveLength(1);
    expect(aug.monthGoals[0].id).toBe("g1");
    expect(aug.monthGoals[0].currentAmount).toBe(25000);
    expect(aug.monthGoals[0].broughtForward).toBe(25000);
  });

  it("keeps goals in previous month (duplicates, does not move)", () => {
    updateMonthData("2026-07", {
      monthGoals: [goal({ id: "g1", currentAmount: 25000, targetAmount: 80000 })],
    });
    updateMonthData("2026-08", {});

    ensureGoalsRollover("2026-08");

    const jul = getMonthData("2026-07");
    expect(jul.monthGoals).toHaveLength(1);
    expect(jul.monthGoals[0].currentAmount).toBe(25000);
  });

  it("cascades goals through missing intermediate months", () => {
    updateMonthData("2026-07", {
      monthGoals: [goal({ id: "g1", currentAmount: 10000, targetAmount: 50000 })],
    });
    // August and September empty — opening October should fill the chain
    updateMonthData("2026-10", {});

    ensureGoalsRollover("2026-10");

    const aug = getMonthData("2026-08");
    const sep = getMonthData("2026-09");
    const oct = getMonthData("2026-10");
    expect(aug.monthGoals).toHaveLength(1);
    expect(sep.monthGoals).toHaveLength(1);
    expect(oct.monthGoals).toHaveLength(1);
    expect(oct.monthGoals[0].broughtForward).toBe(10000);
    expect(oct.monthGoals[0].currentAmount).toBe(10000);
  });

  it("does not overwrite a goal already present in the target month", () => {
    updateMonthData("2026-07", {
      monthGoals: [goal({ id: "g1", currentAmount: 25000, targetAmount: 80000 })],
    });
    updateMonthData("2026-08", {
      monthGoals: [goal({ id: "g1", currentAmount: 30000, targetAmount: 80000, broughtForward: 25000 })],
    });

    ensureGoalsRollover("2026-08");

    const aug = getMonthData("2026-08");
    expect(aug.monthGoals).toHaveLength(1);
    expect(aug.monthGoals[0].currentAmount).toBe(30000);
    expect(aug.monthGoals[0].broughtForward).toBe(25000);
  });

  it("archives completed goals and does not carry them forward", () => {
    updateMonthData("2026-07", {
      monthGoals: [goal({ id: "g1", currentAmount: 80000, targetAmount: 80000 })],
    });
    updateMonthData("2026-08", {});

    ensureGoalsRollover("2026-08");

    const aug = getMonthData("2026-08");
    expect(aug.monthGoals).toHaveLength(0);
    const archived = getArchivedGoals();
    expect(archived.some((g) => g.id === "g1")).toBe(true);
  });

  it("is idempotent — second run does not duplicate goals", () => {
    updateMonthData("2026-07", {
      monthGoals: [goal({ id: "g1", currentAmount: 25000, targetAmount: 80000 })],
    });
    updateMonthData("2026-08", {});

    ensureGoalsRollover("2026-08");
    ensureGoalsRollover("2026-08");

    const aug = getMonthData("2026-08");
    expect(aug.monthGoals).toHaveLength(1);
  });
});

describe("balance uses only this month's goal deposits", () => {
  it("does not subtract carried-over money from the remainder", () => {
    updateMonthData("2026-08", {
      monthlyIncome: 150000,
      mainAccountCategories: [
        { id: "fc-1", name: "Аренда", icon: "🏠", amount: 50000, order: 0 },
      ],
      monthGoals: [
        // 45000 already saved before August, 5000 deposited in August
        goal({ id: "g1", currentAmount: 50000, broughtForward: 45000, targetAmount: 100000 }),
      ],
    });

    expect(getMonthGoalContributions("2026-08")).toBe(5000);
    // 150000 − 50000 (expenses) − 5000 (this month's deposit) = 95000
    expect(getCurrentBalance("2026-08")).toBe(95000);
  });

  it("subtracts full deposit for a goal started this month", () => {
    updateMonthData("2026-08", {
      monthlyIncome: 100000,
      mainAccountCategories: [],
      monthGoals: [
        goal({ id: "g1", currentAmount: 20000, broughtForward: 0, targetAmount: 50000 }),
      ],
    });

    expect(getMonthGoalContributions("2026-08")).toBe(20000);
    expect(getCurrentBalance("2026-08")).toBe(80000);
  });

  it("migrates legacy goals without broughtForward as already saved", () => {
    updateMonthData("2026-08", {
      monthlyIncome: 100000,
      monthGoals: [
        { id: "g1", icon: "🎯", name: "Старая", currentAmount: 30000, targetAmount: 90000 },
      ],
    });

    const data = getMonthData("2026-08");
    expect(data.monthGoals[0].broughtForward).toBe(30000);
    expect(getMonthGoalContributions("2026-08")).toBe(0);
  });
});
