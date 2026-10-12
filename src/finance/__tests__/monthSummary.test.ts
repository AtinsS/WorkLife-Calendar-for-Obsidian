import {
  buildMonthSummaryMarkdown,
  monthSummaryTitle,
  progressBar,
  type MonthSummaryLabels,
} from "../monthSummary";
import { createEmptyMonthData, type FinanceMonthData } from "../types";

const labels: MonthSummaryLabels = {
  title: "Финансы",
  income: "Поступления",
  expenses: "Расходы",
  budget: "Бюджет",
  balance: "Общий баланс",
  remainder: "Остаток",
  fromTasks: "Из задач",
  fromManualSources: "Доп. доход",
  total: "Итого",
  mode: "Режим",
  modePlan: "План",
  modeFact: "Факт",
  modeManual: "Вручную",
  expenseByCategory: "По статьям",
  expenseList: "Список",
  mainAccount: "Основной счёт",
  monthGoals: "Цели",
  savings: "Куда отложить",
  rules: "Правила",
  category: "Статья",
  amount: "Сумма",
  name: "Название",
  date: "Дата",
  progress: "В этом месяце",
  completed: "Готово",
  empty: "— нет данных —",
  currency: "₽",
  insights: "Советы",
  share: "Доля",
  generated: "Сгенерировано плагином WorkLife Calendar",
  goalDeposits: "Взносы в копилку",
};

function money(n: number): string {
  return String(n);
}

function baseInput(over: Partial<Parameters<typeof buildMonthSummaryMarkdown>[0]> = {}) {
  return {
    monthKey: "2026-07",
    monthLabel: "Июль 2026",
    income: { mode: "fact" as const, fromTasks: 10000, fromManualSources: 5000, total: 15000 },
    monthData: createEmptyMonthData(),
    labels,
    formatMoney: money,
    ...over,
  };
}

describe("buildMonthSummaryMarkdown", () => {
  it("renders header with month label and key", () => {
    const md = buildMonthSummaryMarkdown(baseInput());
    expect(md).toContain("# 💰 Финансы · Июль 2026");
    expect(md).toContain("`2026-07`");
  });

  it("renders key numbers as a readable list", () => {
    const md = buildMonthSummaryMarkdown(baseInput());
    expect(md).toContain("## 📊 Общий баланс");
    expect(md).toContain("📥 **Поступления:** 15000 ₽");
    expect(md).toContain("💎 **Остаток:** 15000 ₽");
  });

  it("renders income breakdown with total and mode", () => {
    const md = buildMonthSummaryMarkdown(baseInput());
    expect(md).toContain("## 📥 Поступления");
    expect(md).toContain("| Из задач | 10000 ₽ |");
    expect(md).toContain("| Доп. доход | 5000 ₽ |");
    expect(md).toContain("| **Итого** | **15000 ₽** |");
    expect(md).toContain("| Режим | Факт |");
  });

  it("shows empty state when there are no expenses", () => {
    const md = buildMonthSummaryMarkdown(baseInput());
    expect(md).toContain("## 📤 Расходы");
    expect(md).toContain("— нет данных —");
    // no expense table headers under expenses
    expect(md).not.toContain("| Дата | Название |");
  });

  it("groups expenses by category with share and lists entries", () => {
    const monthData: FinanceMonthData = {
      ...createEmptyMonthData(),
      expenses: [
        { id: "e1", name: "Такси", icon: "🚕", amount: 500, categoryName: "Транспорт", date: "2026-07-02", createdAt: "" },
        { id: "e2", name: "Кафе", icon: "🍔", amount: 1200, categoryName: "Еда", date: "2026-07-05", createdAt: "" },
        { id: "e3", name: "Метро", icon: "🚇", amount: 200, categoryName: "Транспорт", date: "2026-07-10", createdAt: "" },
      ],
    };
    const md = buildMonthSummaryMarkdown(baseInput({ monthData }));

    expect(md).toContain("### 🏷️ По статьям");
    expect(md).toContain("| Транспорт | 700 ₽ | 37% |");
    expect(md).toContain("| Еда | 1200 ₽ | 63% |");
    expect(md).toContain("### 🧾 Список");
    expect(md).toContain("| 2026-07-02 | Такси | Транспорт | 500 ₽ |");
    expect(md).toContain("| 2026-07-10 | Метро | Транспорт | 200 ₽ |");
  });

  it("does not render budget plan in the summary", () => {
    const monthData: FinanceMonthData = {
      ...createEmptyMonthData(),
      mainAccountCategories: [
        { id: "c1", name: "Аренда", icon: "🏠", amount: 30000, order: 0 },
        { id: "c2", name: "Продукты", icon: "🛒", amount: 15000, order: 1 },
      ],
      savingsCategories: [
        { id: "s1", name: "Подушка", icon: "🛡️", amount: 10000, percent: 20, order: 0, completed: false },
      ],
      distributionRules: ["50% обязательные", "30% накопления"],
    };
    const md = buildMonthSummaryMarkdown(baseInput({ monthData }));

    expect(md).not.toContain("## 🎯 Бюджет");
    expect(md).not.toContain("Основной счёт");
    expect(md).not.toContain("Аренда");
    expect(md).not.toContain("Куда отложить");
    expect(md).not.toContain("Правила распределения");
    expect(md).not.toContain("50% обязательные");
  });

  it("shows goal deposits under expenses as fact outflows", () => {
    const monthData: FinanceMonthData = {
      ...createEmptyMonthData(),
      monthGoals: [
        { id: "g1", icon: "🎯", name: "Отпуск", currentAmount: 25000, targetAmount: 80000, broughtForward: 0 },
      ],
    };
    const md = buildMonthSummaryMarkdown(baseInput({ monthData }));

    expect(md).toContain("### 🏆 Взносы в копилку");
    expect(md).toContain("| 🎯 Отпуск | 25000 ₽ |");
    expect(md).toContain("🏆 **Цели:** 25000 ₽");
  });

  it("computes balance as income minus expense log minus goal deposits", () => {
    const monthData: FinanceMonthData = {
      ...createEmptyMonthData(),
      mainAccountCategories: [
        { id: "c1", name: "Аренда", icon: "🏠", amount: 8000, order: 0 },
      ],
      monthGoals: [
        { id: "g1", icon: "🎯", name: "Отпуск", currentAmount: 2000, targetAmount: 10000, broughtForward: 0 },
      ],
    };
    const md = buildMonthSummaryMarkdown(baseInput({ monthData }));
    // Plan is ignored: 15000 - 0 (no expense log) - 2000 = 13000
    expect(md).toContain("💎 **Остаток:** 13000 ₽");
  });

  it("uses expense log for balance and ignores the budget plan", () => {
    const monthData: FinanceMonthData = {
      ...createEmptyMonthData(),
      mainAccountCategories: [
        { id: "c1", name: "Аренда", icon: "🏠", amount: 37300, order: 0 },
      ],
      expenses: [
        { id: "e1", name: "Еда", icon: "🥕", amount: 29877, categoryName: "Еда", date: "2026-10-03", createdAt: "" },
      ],
      monthGoals: [
        { id: "g1", icon: "🛫", name: "Переезд", currentAmount: 25000, targetAmount: 500000, broughtForward: 0 },
      ],
    };
    const md = buildMonthSummaryMarkdown(
      baseInput({
        monthData,
        income: { mode: "fact", fromTasks: 0, fromManualSources: 60000, total: 60000 },
      }),
    );
    // Card shows actual spend 29877, not plan 37300
    expect(md).toContain("📥 **Поступления:** 60000 ₽");
    expect(md).toContain("📤 **Расходы:** 29877 ₽");
    expect(md).toContain("🏆 **Цели:** 25000 ₽");
    // 60000 − 29877 − 25000 = 5123
    expect(md).toContain("💎 **Остаток:** 5123 ₽");
    expect(md).not.toContain("⚠️ **Остаток:** -2300 ₽");
  });

  it("renders manual mode label", () => {
    const md = buildMonthSummaryMarkdown(
      baseInput({
        income: { mode: "manual", fromTasks: 0, fromManualSources: 0, total: 20000 },
      }),
    );
    expect(md).toContain("| Режим | Вручную |");
    expect(md).toContain("| **Итого** | **20000 ₽** |");
  });

  it("appends AI insights section when provided", () => {
    const md = buildMonthSummaryMarkdown(
      baseInput({ insights: "- Основной расход — транспорт\n- Цель «Отпуск» в графике" }),
    );
    expect(md).toContain("## ✨ Советы");
    expect(md).toContain("- Основной расход — транспорт");
    expect(md).toContain("- Цель «Отпуск» в графике");
  });

  it("omits insights section when empty", () => {
    const md = buildMonthSummaryMarkdown(baseInput({ insights: "   " }));
    expect(md).not.toContain("Советы");
    const md2 = buildMonthSummaryMarkdown(baseInput());
    expect(md2).not.toContain("## ✨");
  });

  it("adds a footer when generated label is present", () => {
    const md = buildMonthSummaryMarkdown(baseInput());
    expect(md).toContain("Сгенерировано плагином WorkLife Calendar");
  });
});

describe("progressBar", () => {
  it("renders filled and empty blocks", () => {
    expect(progressBar(0, 10)).toBe("░░░░░░░░░░");
    expect(progressBar(100, 10)).toBe("██████████");
    expect(progressBar(50, 10)).toBe("█████░░░░░");
    expect(progressBar(31, 10)).toBe("███░░░░░░░");
  });

  it("clamps out-of-range values", () => {
    expect(progressBar(-10, 4)).toBe("░░░░");
    expect(progressBar(200, 4)).toBe("████");
  });
});

describe("monthSummaryTitle", () => {
  it("formats title with month key", () => {
    expect(monthSummaryTitle("Финансы", "2026-07")).toBe("Финансы 2026-07");
  });
});
