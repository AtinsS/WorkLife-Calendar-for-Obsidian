import {
  buildWorkbookXml,
  buildMonthSummarySheets,
  expenseRows,
  expenseByCategoryRows,
  expenseByDayRows,
  goalRows,
  budgetPlanRows,
  monthSummaryExcelPath,
  cellVal,
  rowVals,
  resolveExportPeriod,
  toDayStr,
  monthlyBreakdownRows,
  type ExcelRow,
} from "../monthSummaryExcel";
import { createEmptyMonthData, type FinanceMonthData } from "../types";
import { settings } from "../../ui/stores";
import { defaultSettings } from "../../settings";

function moneyIncome(total = 15000) {
  return { mode: "fact" as const, fromTasks: 10000, fromManualSources: 5000, total };
}

function flat(rows: ExcelRow[]): string {
  return rows.map((r) => rowVals(r).join("|")).join("||");
}

const sampleExpenses = [
  { id: "e2", name: "Кафе", icon: "🍔", amount: 1200, categoryName: "Еда", date: "2026-07-05", createdAt: "" },
  { id: "e1", name: "Такси", icon: "🚕", amount: 500, categoryName: "Транспорт", date: "2026-07-02", createdAt: "" },
  { id: "e3", name: "Метро", icon: "🚇", amount: 200, categoryName: "Транспорт", date: "2026-07-02", createdAt: "" },
];

describe("buildWorkbookXml", () => {
  it("emits SpreadsheetML with styles and typed cells", () => {
    const xml = buildWorkbookXml([
      {
        name: "Сводка",
        rows: [
          [{ v: "Доход", s: "header" }, { v: 15000, s: "money" }],
          ["Коммент", "a < b & c"],
        ],
      },
    ]);
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('ss:Name="Сводка"');
    expect(xml).toContain('<Data ss:Type="Number">15000</Data>');
    expect(xml).toContain('ss:StyleID="header"');
    expect(xml).toContain('ss:StyleID="money"');
    expect(xml).toContain("a &lt; b &amp; c");
  });

  it("includes a Styles block", () => {
    const xml = buildWorkbookXml([{ name: "A", rows: [["x"]] }]);
    expect(xml).toContain("<Styles>");
    expect(xml).toContain('ss:ID="title"');
    expect(xml).toContain('ss:ID="totalMoney"');
  });
});

describe("expense rows", () => {
  it("lists expenses sorted by date with share and total", () => {
    const rows = expenseRows(sampleExpenses);
    expect(rows[0]).toHaveLength(5);
    expect(cellVal(rows[1][1])).toBe("Такси");
    expect(cellVal(rows[2][1])).toBe("Метро");
    expect(cellVal(rows[3][1])).toBe("Кафе");
    const total = rows[rows.length - 1];
    expect(cellVal(total[3])).toBe(1900);
    expect(cellVal(total[4])).toBe(100);
  });

  it("groups by category with count and average", () => {
    const rows = expenseByCategoryRows(sampleExpenses);
    expect(rows).toHaveLength(4);
    expect(cellVal(rows[1][0])).toBe("Еда");
    expect(cellVal(rows[1][1])).toBe(1200);
    expect(cellVal(rows[2][0])).toBe("Транспорт");
    expect(cellVal(rows[2][1])).toBe(700);
    expect(cellVal(rows[2][3])).toBe(2);
  });

  it("groups by day", () => {
    const rows = expenseByDayRows(sampleExpenses);
    expect(cellVal(rows[1][0])).toBe("2026-07-02");
    expect(cellVal(rows[1][1])).toBe(700);
    expect(cellVal(rows[2][0])).toBe("2026-07-05");
    expect(cellVal(rows[2][1])).toBe(1200);
  });
});

describe("goalRows", () => {
  it("lists all goals with progress and deposits", () => {
    const rows = goalRows([
      { id: "g1", icon: "🎯", name: "Отпуск", currentAmount: 25000, targetAmount: 80000, broughtForward: 10000 },
      { id: "g2", icon: "💻", name: "Ноутбук", currentAmount: 5000, targetAmount: 50000, broughtForward: 5000 },
    ]);
    expect(rows).toHaveLength(4);
    expect(cellVal(rows[1][0])).toBe("Отпуск");
    expect(cellVal(rows[1][1])).toBe(25000);
    expect(cellVal(rows[1][2])).toBe(80000);
    expect(cellVal(rows[1][3])).toBe(31);
    expect(cellVal(rows[1][4])).toBe(15000);
    expect(cellVal(rows[1][5])).toBe(10000);
    expect(cellVal(rows[2][4])).toBe(0);
    expect(cellVal(rows[3][4])).toBe(15000);
  });
});

describe("budgetPlanRows", () => {
  it("includes planned income, categories, savings and rules", () => {
    const data: FinanceMonthData = {
      ...createEmptyMonthData(),
      monthlyIncome: 100000,
      mainAccountCategories: [
        { id: "c1", name: "Аренда", icon: "🏠", amount: 30000, order: 0 },
        { id: "c2", name: "Продукты", icon: "🛒", amount: 15000, order: 1 },
      ],
      savingsCategories: [
        { id: "s1", name: "Подушка", icon: "🛡️", amount: 10000, percent: 20, order: 0, completed: false },
      ],
      distributionRules: ["50% обязательные"],
    };
    const text = flat(budgetPlanRows(data));
    expect(text).toContain("100000");
    expect(text).toContain("Аренда");
    expect(text).toContain("Продукты");
    expect(text).toContain("Подушка");
    expect(text).toContain("50% обязательные");
    expect(text).toContain("45000");
  });
});

describe("buildMonthSummarySheets", () => {
  it("builds full workbook without putting plan numbers into fact totals", () => {
    const data: FinanceMonthData = {
      ...createEmptyMonthData(),
      mainAccountCategories: [
        { id: "c1", name: "Аренда", icon: "🏠", amount: 30000, order: 0 },
      ],
      expenses: [
        { id: "e1", name: "Еда", icon: "🥕", amount: 29877, categoryName: "Еда", date: "2026-10-03", createdAt: "" },
      ],
      monthGoals: [
        { id: "g1", icon: "🛫", name: "Переезд", currentAmount: 25000, targetAmount: 500000, broughtForward: 0 },
      ],
    };
    const sheets = buildMonthSummarySheets("2026-07", "Июль 2026", moneyIncome(60000), data);
    expect(sheets.map((s) => s.name).length).toBe(7);

    const overview = flat(sheets[0].rows);
    expect(overview).toContain("60000");
    expect(overview).toContain("29877");
    expect(overview).toContain("25000");
    expect(overview).toContain("5123");

    const plan = sheets.find((s) => flat(s.rows).includes("Аренда"));
    expect(plan).toBeDefined();
    const factSheets = sheets.slice(0, 6).map((s) => flat(s.rows)).join("|");
    expect(factSheets).not.toContain("Аренда");
  });

  it("adds an insights sheet when AI tips are present", () => {
    const sheets = buildMonthSummarySheets(
      "2026-07",
      "Июль 2026",
      moneyIncome(),
      createEmptyMonthData(),
      "- Основной расход — транспорт\n- Цель «Отпуск» в графике",
    );
    expect(sheets).toHaveLength(8);
    const tips = sheets[sheets.length - 1];
    const text = flat(tips.rows);
    expect(text).toContain("Основной расход — транспорт");
    expect(text).toContain("Цель «Отпуск» в графике");
  });

  it("omits insights sheet when empty", () => {
    const sheets = buildMonthSummarySheets(
      "2026-07",
      "Июль 2026",
      moneyIncome(),
      createEmptyMonthData(),
      "   ",
    );
    expect(sheets).toHaveLength(7);
  });
});

describe("monthSummaryExcelPath", () => {
  it("uses the configured export folder", () => {
    settings.set({ ...defaultSettings, financeExportFolder: "Мои финансы" });
    expect(monthSummaryExcelPath("2026-07")).toBe("Мои финансы/Финансы 2026-07.xls");
    settings.set({ ...defaultSettings, financeExportFolder: "" });
    expect(monthSummaryExcelPath("2026-07")).toBe("Финансы 2026-07.xls");
  });
});

describe("resolveExportPeriod", () => {
  it("resolves month range", () => {
    const r = resolveExportPeriod("month", new Date(2026, 9, 15)); // Oct 2026
    expect(r.key).toBe("2026-10");
    expect(toDayStr(r.start)).toBe("2026-10-01");
    expect(toDayStr(r.end)).toBe("2026-10-31");
  });

  it("resolves year range", () => {
    const r = resolveExportPeriod("year", new Date(2026, 5, 1));
    expect(r.key).toBe("2026");
    expect(toDayStr(r.start)).toBe("2026-01-01");
    expect(toDayStr(r.end)).toBe("2026-12-31");
  });
});

describe("monthlyBreakdownRows", () => {
  it("builds a bold month table with totals", () => {
    const rows = monthlyBreakdownRows(2026, [
      { month: 1, income: 1000, expenses: 400, goalDeposits: 100, expenseCount: 2 },
      { month: 2, income: 2000, expenses: 500, goalDeposits: 200, expenseCount: 3 },
    ]);
    expect(rows).toHaveLength(4);
    expect(cellVal(rows[1][0])).toBe("2026-01");
    expect(cellVal(rows[3][1])).toBe(3000); // total income
    expect(cellVal(rows[3][2])).toBe(900); // total expenses
    expect(cellVal(rows[3][4])).toBe(1800); // (1000-400-100) + (2000-500-200)
  });
});
