/**
 * Month summary → Excel workbook (SpreadsheetML 2003, .xls).
 * No external deps — Excel/LibreOffice open the file directly.
 *
 * Sheets: overview, income, expense log, by category, by day, piggy bank,
 * and the budget plan (clearly labeled — planning only, not fact).
 * Cells carry style IDs (headers, money, totals, sections) rendered in <Styles>.
 */
import type { App } from "obsidian";
import { Notice, TFile, normalizePath } from "obsidian";
import { get } from "svelte/store";
import { tRaw, getCurrencySymbol } from "../i18n";
import { resolveMonthIncome, type MonthIncomeBreakdown } from "./income";
import { getMonthData, financeData } from "./storage";
import { getExcelExportFolder, generateInsightsWithNotice } from "./monthSummaryExport";
import type { ExpenseEntry, FinanceMonthData, MonthGoal } from "./types";
import { getGoalMonthContribution, sumGoalMonthContributions, isGoalComplete } from "./types";
import { tasks, calculateTaskEarnings } from "../task-tracker/stores";
import { financialAnalyticsData } from "./financialAnalyticsStorage";

export type ExcelCellValue = string | number;

export type CellStyle =
  | "title"
  | "subtitle"
  | "section"
  | "header"
  | "label"
  | "money"
  | "percent"
  | "int"
  | "total"
  | "totalMoney"
  | "totalPercent"
  | "note"
  | "chip";

export interface StyledCell {
  v: ExcelCellValue;
  s?: CellStyle;
}

export type ExcelCell = ExcelCellValue | StyledCell;
export type ExcelRow = ExcelCell[];

export interface ExcelSheet {
  name: string;
  rows: ExcelRow[];
  /** Optional column widths in SpreadsheetML points. */
  colWidths?: number[];
}

/** Unwrap a cell for tests / value access. */
export function cellVal(c: ExcelCell): ExcelCellValue {
  if (isStyled(c)) return c.v;
  return c;
}

/** Flatten rows to raw values (tests). */
export function rowVals(r: ExcelRow): ExcelCellValue[] {
  return r.map(cellVal);
}

function C(v: ExcelCellValue, s?: CellStyle): StyledCell {
  return s ? { v, s } : { v };
}

function esc(v: ExcelCellValue): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isStyled(c: ExcelCell): c is StyledCell {
  return typeof c === "object" && c !== null && "v" in c;
}

function cellXml(c: ExcelCell): string {
  const st: StyledCell = isStyled(c) ? c : { v: c };
  const type = typeof st.v === "number" ? "Number" : "String";
  const style = st.s ? ` ss:StyleID="${st.s}"` : "";
  return `<Cell${style}><Data ss:Type="${type}">${esc(st.v)}</Data></Cell>`;
}

const STYLES_XML = `<Styles>
<Style ss:ID="Default" ss:Name="Normal">
  <Alignment ss:Vertical="Center"/>
  <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#1F2937"/>
</Style>
<Style ss:ID="title">
  <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#0F172A"/>
  <Interior ss:Color="#E8F0FE" ss:Pattern="Solid"/>
  <Alignment ss:Vertical="Center"/>
</Style>
<Style ss:ID="subtitle">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#64748B"/>
</Style>
<Style ss:ID="section">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#1D4ED8"/>
  <Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/>
</Style>
<Style ss:ID="header">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
  <Interior ss:Color="#2563EB" ss:Pattern="Solid"/>
  <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
  <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1E40AF"/>
  </Borders>
</Style>
<Style ss:ID="label">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#334155"/>
  <Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/>
</Style>
<Style ss:ID="money" ss:Format="#,##0">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#0F172A"/>
  <Alignment ss:Horizontal="Right"/>
</Style>
<Style ss:ID="percent" ss:Format="0.0">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#0F172A"/>
  <Alignment ss:Horizontal="Right"/>
</Style>
<Style ss:ID="int" ss:Format="0">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#0F172A"/>
  <Alignment ss:Horizontal="Right"/>
</Style>
<Style ss:ID="total">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#0F172A"/>
  <Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/>
  <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F59E0B"/>
  </Borders>
</Style>
<Style ss:ID="totalMoney" ss:Format="#,##0">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#92400E"/>
  <Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/>
  <Alignment ss:Horizontal="Right"/>
  <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F59E0B"/>
  </Borders>
</Style>
<Style ss:ID="totalPercent" ss:Format="0.0">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#92400E"/>
  <Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/>
  <Alignment ss:Horizontal="Right"/>
  <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F59E0B"/>
  </Borders>
</Style>
<Style ss:ID="note">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Italic="1" ss:Color="#64748B"/>
  <Alignment ss:WrapText="1" ss:Vertical="Top"/>
</Style>
<Style ss:ID="chip">
  <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#065F46"/>
  <Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/>
</Style>
</Styles>`;

/** Build SpreadsheetML 2003 workbook XML (Excel-compatible, styled). */
export function buildWorkbookXml(sheets: ExcelSheet[]): string {
  const sheetsXml = sheets
    .map((s) => {
      const cols = (s.colWidths || [])
        .map((w) => `<Column ss:Width="${w}"/>`)
        .join("");
      const rows = s.rows
        .map((r) => `<Row ss:AutoFitHeight="1">${r.map(cellXml).join("")}</Row>`)
        .join("");
      return `<Worksheet ss:Name="${esc(s.name)}"><Table ss:DefaultRowHeight="18">${cols}${rows}</Table></Worksheet>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"` +
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n` +
    STYLES_XML +
    `\n` +
    sheetsXml +
    `\n</Workbook>\n`
  );
}

function shareOf(amount: number, total: number): number {
  return total > 0 ? Math.round((amount / total) * 1000) / 10 : 0;
}

function sumExpenses(expenses: ExpenseEntry[]): number {
  return expenses.reduce((s, e) => s + (e.amount || 0), 0);
}

function money(n: number, s: CellStyle = "money"): StyledCell {
  return C(n, s);
}

export function expenseRows(expenses: ExpenseEntry[]): ExcelRow[] {
  const total = sumExpenses(expenses);
  const header: ExcelRow = [
    C(tRaw("finance.expensesDate"), "header"),
    C(tRaw("finance.expensesName"), "header"),
    C(tRaw("finance.expensesCategory"), "header"),
    C(tRaw("finance.amount"), "header"),
    C(tRaw("finance.share"), "header"),
  ];
  const sorted = [...expenses].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return [
    header,
    ...sorted.map(
      (e) =>
        [
          C(e.date || "", "label"),
          C(e.name || ""),
          C(e.categoryName || ""),
          money(e.amount || 0),
          C(shareOf(e.amount || 0, total), "percent"),
        ] as ExcelRow,
    ),
    [
      C(tRaw("financeAnalytics.total"), "total"),
      C("", "total"),
      C("", "total"),
      money(total, "totalMoney"),
      C(100, "totalPercent"),
    ],
  ];
}

export function expenseByCategoryRows(expenses: ExpenseEntry[]): ExcelRow[] {
  const total = sumExpenses(expenses);
  const map = new Map<string, { name: string; amount: number; count: number }>();
  for (const e of expenses) {
    const key = e.categoryName || "—";
    const prev = map.get(key) || { name: key, amount: 0, count: 0 };
    prev.amount += e.amount || 0;
    prev.count += 1;
    map.set(key, prev);
  }
  const rows = [...map.values()].sort((a, b) => b.amount - a.amount);
  return [
    [
      C(tRaw("finance.expensesCategory"), "header"),
      C(tRaw("finance.amount"), "header"),
      C(tRaw("finance.share"), "header"),
      C(tRaw("finance.excelCount"), "header"),
      C(tRaw("finance.excelAvgPerItem"), "header"),
    ],
    ...rows.map(
      (c) =>
        [
          C(c.name, "label"),
          money(c.amount),
          C(shareOf(c.amount, total), "percent"),
          C(c.count, "int"),
          money(Math.round(c.amount / Math.max(1, c.count))),
        ] as ExcelRow,
    ),
    [
      C(tRaw("financeAnalytics.total"), "total"),
      money(total, "totalMoney"),
      C(100, "totalPercent"),
      C(expenses.length, "total"),
      money(total ? Math.round(total / Math.max(1, expenses.length)) : 0, "totalMoney"),
    ],
  ];
}

export function expenseByDayRows(expenses: ExpenseEntry[]): ExcelRow[] {
  const total = sumExpenses(expenses);
  const map = new Map<string, { amount: number; count: number }>();
  for (const e of expenses) {
    const day = e.date || "—";
    const prev = map.get(day) || { amount: 0, count: 0 };
    prev.amount += e.amount || 0;
    prev.count += 1;
    map.set(day, prev);
  }
  const days = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return [
    [
      C(tRaw("finance.expensesDate"), "header"),
      C(tRaw("finance.amount"), "header"),
      C(tRaw("finance.share"), "header"),
      C(tRaw("finance.excelCount"), "header"),
    ],
    ...days.map(
      ([day, v]) =>
        [
          C(day, "label"),
          money(v.amount),
          C(shareOf(v.amount, total), "percent"),
          C(v.count, "int"),
        ] as ExcelRow,
    ),
    [
      C(tRaw("financeAnalytics.total"), "total"),
      money(total, "totalMoney"),
      C(100, "totalPercent"),
      C(expenses.length, "total"),
    ],
  ];
}

export function goalRows(goals: MonthGoal[]): ExcelRow[] {
  return [
    [
      C(tRaw("finance.monthGoals"), "header"),
      C(tRaw("finance.amountPlaceholder"), "header"),
      C(tRaw("finance.goalPlaceholder"), "header"),
      C("%", "header"),
      C(tRaw("finance.goalDeposits"), "header"),
      C(tRaw("finance.excelBroughtForward"), "header"),
      C(tRaw("finance.excelCompleted"), "header"),
    ],
    ...goals.map((g) => {
      const contrib = getGoalMonthContribution(g);
      const pct =
        g.targetAmount > 0
          ? Math.min(100, Math.round(((g.currentAmount || 0) / g.targetAmount) * 100))
          : 0;
      return [
        C(g.name, "label"),
        money(g.currentAmount || 0),
        money(g.targetAmount || 0),
        C(pct, "percent"),
        money(contrib),
        money(g.broughtForward ?? 0),
        C(isGoalComplete(g) ? "✓" : "", isGoalComplete(g) ? "chip" : undefined),
      ] as ExcelRow;
    }),
    [
      C(tRaw("financeAnalytics.total"), "total"),
      money(goals.reduce((s, g) => s + (g.currentAmount || 0), 0), "totalMoney"),
      money(goals.reduce((s, g) => s + (g.targetAmount || 0), 0), "totalMoney"),
      C("", "total"),
      money(sumGoalMonthContributions(goals), "totalMoney"),
      money(goals.reduce((s, g) => s + (g.broughtForward ?? 0), 0), "totalMoney"),
      C("", "total"),
    ],
  ];
}

export function budgetPlanRows(data: FinanceMonthData): ExcelRow[] {
  const rows: ExcelRow[] = [
    [C(tRaw("finance.budgetPlanOnly"), "title")],
    [],
    [C(tRaw("finance.plannedIncome"), "label"), money(data.monthlyIncome || 0)],
    [],
    [
      C(tRaw("finance.mainAccount"), "header"),
      C(tRaw("finance.amount"), "header"),
      C(tRaw("finance.share"), "header"),
    ],
  ];
  const mainTotal = (data.mainAccountCategories || []).reduce((s, c) => s + (c.amount || 0), 0);
  for (const c of [...(data.mainAccountCategories || [])].sort((a, b) => (b.amount || 0) - (a.amount || 0))) {
    rows.push([C(`${c.icon || ""} ${c.name}`.trim(), "label"), money(c.amount || 0), C(shareOf(c.amount || 0, mainTotal), "percent")]);
  }
  rows.push([C(tRaw("financeAnalytics.total"), "total"), money(mainTotal, "totalMoney"), C(100, "totalPercent")]);
  rows.push([]);
  rows.push([
    C(tRaw("finance.savings"), "header"),
    C(tRaw("finance.amount"), "header"),
    C(tRaw("finance.percent"), "header"),
  ]);
  const savingsTotal = (data.savingsCategories || []).reduce((s, c) => s + (c.amount || 0), 0);
  for (const s of [...(data.savingsCategories || [])].sort((a, b) => (b.amount || 0) - (a.amount || 0))) {
    rows.push([C(`${s.icon || ""} ${s.name}`.trim(), "label"), money(s.amount || 0), C(s.percent || 0, "percent")]);
  }
  rows.push([C(tRaw("financeAnalytics.total"), "total"), money(savingsTotal, "totalMoney"), C("", "total")]);
  if ((data.distributionRules || []).length) {
    rows.push([]);
    rows.push([C(tRaw("finance.rules"), "section")]);
    for (const r of data.distributionRules) rows.push([C(r, "note")]);
  }
  return rows;
}

function modeLabel(mode: string): string {
  if (mode === "plan") return tRaw("finance.excelPlanMode");
  if (mode === "manual") return tRaw("finance.excelManualMode");
  return tRaw("finance.excelFactMode");
}

/** Collect fact sheets + plan sheet for one month. */
export function buildMonthSummarySheets(
  monthKey: string,
  monthLabel: string,
  income: MonthIncomeBreakdown,
  data: FinanceMonthData,
  insights?: string | null,
): ExcelSheet[] {
  const expenses = data.expenses || [];
  const expensesTotal = sumExpenses(expenses);
  const goals = data.monthGoals || [];
  const goalsContrib = sumGoalMonthContributions(goals);
  const balance = income.total - expensesTotal - goalsContrib;
  const savingsRate = income.total > 0 ? Math.round((goalsContrib / income.total) * 1000) / 10 : 0;
  const activeDays = new Set(expenses.map((e) => e.date).filter(Boolean)).size;
  const avgPerDay = activeDays > 0 ? Math.round(expensesTotal / activeDays) : 0;

  const byCat = new Map<string, number>();
  for (const e of expenses) {
    const k = e.categoryName || "—";
    byCat.set(k, (byCat.get(k) || 0) + (e.amount || 0));
  }
  const topCat = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];

  const overview: ExcelSheet = {
    name: tRaw("finance.exportTitle"),
    colWidths: [180, 120, 90, 90, 90],
    rows: [
      [C(`${tRaw("finance.exportTitle")} · ${monthLabel}`, "title"), C(monthKey, "subtitle")],
      [C(getCurrencySymbol(), "subtitle")],
      [],
      [C(`── ${tRaw("finance.balance")} ──`, "section")],
      [C(tRaw("finance.income"), "label"), money(income.total)],
      [C(tRaw("habitAnalytics.expenses"), "label"), money(expensesTotal)],
      [C(tRaw("finance.goalDeposits"), "label"), money(goalsContrib)],
      [C(tRaw("finance.remainder"), "label"), money(balance, balance >= 0 ? "money" : "totalMoney")],
      [],
      [C(`── ${tRaw("finance.tabIncome")} ──`, "section")],
      [C(tRaw("financeAnalytics.fromTasks"), "label"), money(income.fromTasks)],
      [C(tRaw("financeAnalytics.extraIncome"), "label"), money(income.fromManualSources)],
      [C(tRaw("financeAnalytics.total"), "label"), money(income.total, "totalMoney")],
      [C(tRaw("finance.excelIncomeMode"), "label"), C(modeLabel(income.mode), "chip")],
      [],
      [C(`── ${tRaw("finance.tabExpenses")} ──`, "section")],
      [C(tRaw("finance.excelCount"), "label"), C(expenses.length, "int")],
      [C(tRaw("finance.excelActiveDays"), "label"), C(activeDays, "int")],
      [C(tRaw("finance.excelAvgPerDay"), "label"), money(avgPerDay)],
      [C(tRaw("finance.excelCategoryCount"), "label"), C(byCat.size, "int")],
      [C(tRaw("finance.excelTopCategory"), "label"), C(topCat ? topCat[0] : "")],
      [C(tRaw("finance.excelTopCategoryAmount"), "label"), money(topCat ? topCat[1] : 0)],
      [],
      [C(`── ${tRaw("finance.tabSavings")} ──`, "section")],
      [C(tRaw("finance.excelGoalCount"), "label"), C(goals.length, "int")],
      [C(tRaw("finance.goalDeposits"), "label"), money(goalsContrib)],
      [C(tRaw("finance.excelSavingsRate"), "label"), C(savingsRate, "percent")],
      [C(tRaw("finance.excelCompleted"), "label"), C(goals.filter((g) => isGoalComplete(g)).length, "int")],
    ],
  };

  const incomeSheet: ExcelSheet = {
    name: tRaw("finance.tabIncome"),
    colWidths: [180, 120],
    rows: [
      [C(`${tRaw("finance.tabIncome")} · ${monthLabel}`, "title")],
      [],
      [C(tRaw("financeAnalytics.fromTasks"), "label"), money(income.fromTasks)],
      [C(tRaw("financeAnalytics.extraIncome"), "label"), money(income.fromManualSources)],
      [C(tRaw("financeAnalytics.total"), "total"), money(income.total, "totalMoney")],
      [C(tRaw("finance.excelIncomeMode"), "label"), C(modeLabel(income.mode), "chip")],
    ],
  };

  const expensesSheet: ExcelSheet = {
    name: tRaw("finance.tabExpenses"),
    colWidths: [90, 160, 120, 90, 70],
    rows: expenseRows(expenses),
  };

  const byCategorySheet: ExcelSheet = {
    name: tRaw("habitAnalytics.expenseByCategory"),
    colWidths: [140, 100, 70, 80, 100],
    rows: expenseByCategoryRows(expenses),
  };

  const byDaySheet: ExcelSheet = {
    name: tRaw("finance.expenseByDay"),
    colWidths: [100, 100, 70, 80],
    rows: expenseByDayRows(expenses),
  };

  const savingsSheet: ExcelSheet = {
    name: tRaw("finance.tabSavings"),
    colWidths: [140, 100, 100, 50, 100, 110, 70],
    rows: goalRows(goals),
  };

  const planSheet: ExcelSheet = {
    name: tRaw("finance.tabBudget"),
    colWidths: [180, 110, 80],
    rows: budgetPlanRows(data),
  };

  const sheets: ExcelSheet[] = [
    overview,
    incomeSheet,
    expensesSheet,
    byCategorySheet,
    byDaySheet,
    savingsSheet,
    planSheet,
  ];

  const tips = (insights || "").trim();
  if (tips) {
    sheets.push({
      name: tRaw("finance.insights"),
      colWidths: [520],
      rows: [
        [C(tRaw("finance.insights"), "title")],
        [],
        ...tips
          .split(/\r?\n/)
          .map((l) => l.replace(/^[-*•]\s*/, "").trim())
          .filter(Boolean)
          .map((line) => [C(line, "note")] as ExcelRow),
      ],
    });
  }

  return sheets;
}

/** Full path for the .xls export. */
export function monthSummaryExcelPath(fileKey: string): string {
  const title = `${tRaw("finance.exportTitle")} ${fileKey}`;
  const folder = getExcelExportFolder();
  return folder ? `${folder}/${title}.xls` : `${title}.xls`;
}

export type ExportPeriod = "month" | "year";

export interface PeriodRange {
  start: Date;
  end: Date;
  /** File-safe key: 2026-10 / 2026 / 2026-10-05_2026-10-11 */
  key: string;
  label: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDayStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Resolve month / year range around `ref`. weekStartsOn kept for API stability. */
export function resolveExportPeriod(
  period: ExportPeriod,
  ref: Date,
  _weekStartsOn = 1,
): PeriodRange {
  if (period === "year") {
    const y = ref.getFullYear();
    return {
      start: new Date(y, 0, 1),
      end: new Date(y, 11, 31),
      key: String(y),
      label: String(y),
    };
  }
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  return {
    start,
    end,
    key: `${y}-${pad2(m + 1)}`,
    label: `${y}-${pad2(m + 1)}`,
  };
}

function monthKeysInRange(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const y = start.getFullYear();
  const m0 = start.getMonth();
  const y2 = end.getFullYear();
  const m1 = end.getMonth();
  let cy = y;
  let cm = m0;
  while (cy < y2 || (cy === y2 && cm <= m1)) {
    keys.push(`${cy}-${pad2(cm + 1)}`);
    cm += 1;
    if (cm > 11) {
      cm = 0;
      cy += 1;
    }
  }
  return keys;
}

/** Fact income for an arbitrary date range (task earnings + manual sources). */
export function resolveRangeIncome(start: Date, end: Date): MonthIncomeBreakdown {
  const s = toDayStr(start);
  const e = toDayStr(end);

  const fromTasks = get(tasks)
    .filter((t) => {
      if (!t.isWorkTask || !t.rate || t.status !== "done") return false;
      const m = /^day-(\d{4}-\d{2}-\d{2})/.exec(t.dateUID || "");
      return !!m && m[1] >= s && m[1] <= e;
    })
    .reduce((sum, t) => sum + calculateTaskEarnings(t), 0);

  const fromManualSources = get(financialAnalyticsData)
    .manualIncomeSources.filter((src) => {
      const d = (src.date || "").slice(0, 10);
      return d >= s && d <= e;
    })
    .reduce((sum, src) => sum + (src.amount || 0), 0);

  return {
    mode: "fact",
    fromTasks,
    fromManualSources,
    total: fromTasks + fromManualSources,
  };
}

function getFinanceMap(): Record<string, FinanceMonthData> {
  return get(financeData);
}

/** Expenses in a date range from all months. */
export function collectRangeExpenses(start: Date, end: Date): ExpenseEntry[] {
  const s = toDayStr(start);
  const e = toDayStr(end);
  const all = getFinanceMap();
  const out: ExpenseEntry[] = [];
  for (const [key, data] of Object.entries(all)) {
    if (key.startsWith("_") || !data) continue;
    for (const exp of data.expenses || []) {
      const d = exp.date || "";
      if (d >= s && d <= e) out.push(exp);
    }
  }
  return out;
}

/** One row per month for the year overview sheet. */
export function monthlyBreakdownRows(
  year: number,
  months: Array<{
    month: number;
    income: number;
    expenses: number;
    goalDeposits: number;
    expenseCount: number;
  }>,
): ExcelRow[] {
  return [
    [
      C(tRaw("finance.exportPeriodMonth"), "header"),
      C(tRaw("finance.income"), "header"),
      C(tRaw("habitAnalytics.expenses"), "header"),
      C(tRaw("finance.goalDeposits"), "header"),
      C(tRaw("finance.remainder"), "header"),
      C(tRaw("finance.excelCount"), "header"),
    ],
    ...months.map((m) => {
      const bal = m.income - m.expenses - m.goalDeposits;
      return [
        C(`${year}-${pad2(m.month)}`, "label"),
        money(m.income),
        money(m.expenses),
        money(m.goalDeposits),
        money(bal, bal >= 0 ? "money" : "totalMoney"),
        C(m.expenseCount, "int"),
      ] as ExcelRow;
    }),
    [
      C(tRaw("financeAnalytics.total"), "total"),
      money(months.reduce((s, m) => s + m.income, 0), "totalMoney"),
      money(months.reduce((s, m) => s + m.expenses, 0), "totalMoney"),
      money(months.reduce((s, m) => s + m.goalDeposits, 0), "totalMoney"),
      money(months.reduce((s, m) => s + m.income - m.expenses - m.goalDeposits, 0), "totalMoney"),
      C(months.reduce((s, m) => s + m.expenseCount, 0), "total"),
    ],
  ];
}

/** Build period sheets (month / year) — fact only + optional plan for month. */
export function buildPeriodSheets(
  period: ExportPeriod,
  range: PeriodRange,
  income: MonthIncomeBreakdown,
  expenses: ExpenseEntry[],
  goals: MonthGoal[],
  insights?: string | null,
  planData?: FinanceMonthData | null,
  monthly?: Array<{
    month: number;
    income: number;
    expenses: number;
    goalDeposits: number;
    expenseCount: number;
  }>,
): ExcelSheet[] {
  const expensesTotal = sumExpenses(expenses);
  const goalsContrib = sumGoalMonthContributions(goals);
  const balance = income.total - expensesTotal - goalsContrib;
  const activeDays = new Set(expenses.map((x) => x.date).filter(Boolean)).size;
  const avgPerDay = activeDays > 0 ? Math.round(expensesTotal / activeDays) : 0;

  const byCat = new Map<string, number>();
  for (const x of expenses) {
    const k = x.categoryName || "—";
    byCat.set(k, (byCat.get(k) || 0) + (x.amount || 0));
  }
  const topCat = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];

  const periodLabel =
    period === "year" ? tRaw("finance.exportPeriodYear") : tRaw("finance.exportPeriodMonth");

  const overview: ExcelSheet = {
    name: tRaw("finance.exportTitle"),
    colWidths: [180, 140, 90],
    rows: [
      [C(`${tRaw("finance.exportTitle")} · ${range.label}`, "title"), C(periodLabel, "chip")],
      [C(getCurrencySymbol(), "subtitle")],
      [],
      [C(`── ${tRaw("finance.balance")} ──`, "section")],
      [C(tRaw("finance.income"), "label"), money(income.total)],
      [C(tRaw("habitAnalytics.expenses"), "label"), money(expensesTotal)],
      [C(tRaw("finance.goalDeposits"), "label"), money(goalsContrib)],
      [C(tRaw("finance.remainder"), "label"), money(balance, balance >= 0 ? "money" : "totalMoney")],
      [],
      [C(`── ${tRaw("finance.tabIncome")} ──`, "section")],
      [C(tRaw("financeAnalytics.fromTasks"), "label"), money(income.fromTasks)],
      [C(tRaw("financeAnalytics.extraIncome"), "label"), money(income.fromManualSources)],
      [C(tRaw("financeAnalytics.total"), "label"), money(income.total, "totalMoney")],
      [],
      [C(`── ${tRaw("finance.tabExpenses")} ──`, "section")],
      [C(tRaw("finance.excelCount"), "label"), C(expenses.length, "int")],
      [C(tRaw("finance.excelActiveDays"), "label"), C(activeDays, "int")],
      [C(tRaw("finance.excelAvgPerDay"), "label"), money(avgPerDay)],
      [C(tRaw("finance.excelCategoryCount"), "label"), C(byCat.size, "int")],
      [C(tRaw("finance.excelTopCategory"), "label"), C(topCat ? topCat[0] : "")],
      [C(tRaw("finance.excelTopCategoryAmount"), "label"), money(topCat ? topCat[1] : 0)],
    ],
  };

  const sheets: ExcelSheet[] = [overview];

  if (period === "year" && monthly) {
    sheets.push({
      name: tRaw("finance.excelByMonths"),
      colWidths: [80, 100, 100, 100, 100, 70],
      rows: monthlyBreakdownRows(range.start.getFullYear(), monthly),
    });
  }

  sheets.push(
    {
      name: tRaw("finance.tabIncome"),
      colWidths: [180, 120],
      rows: [
        [C(`${tRaw("finance.tabIncome")} · ${range.label}`, "title")],
        [],
        [C(tRaw("financeAnalytics.fromTasks"), "label"), money(income.fromTasks)],
        [C(tRaw("financeAnalytics.extraIncome"), "label"), money(income.fromManualSources)],
        [C(tRaw("financeAnalytics.total"), "total"), money(income.total, "totalMoney")],
      ],
    },
    {
      name: tRaw("finance.tabExpenses"),
      colWidths: [90, 160, 120, 90, 70],
      rows: expenseRows(expenses),
    },
    {
      name: tRaw("habitAnalytics.expenseByCategory"),
      colWidths: [140, 100, 70, 80, 100],
      rows: expenseByCategoryRows(expenses),
    },
    {
      name: tRaw("finance.expenseByDay"),
      colWidths: [100, 100, 70, 80],
      rows: expenseByDayRows(expenses),
    },
    {
      name: tRaw("finance.tabSavings"),
      colWidths: [140, 100, 100, 50, 100, 110, 70],
      rows: goalRows(goals),
    },
  );

  if (planData && period === "month") {
    sheets.push({
      name: tRaw("finance.tabBudget"),
      colWidths: [180, 110, 80],
      rows: budgetPlanRows(planData),
    });
  }

  const tips = (insights || "").trim();
  if (tips) {
    sheets.push({
      name: tRaw("finance.insights"),
      colWidths: [520],
      rows: [
        [C(tRaw("finance.insights"), "title")],
        [],
        ...tips
          .split(/\r?\n/)
          .map((l) => l.replace(/^[-*•]\s*/, "").trim())
          .filter(Boolean)
          .map((line) => [C(line, "note")] as ExcelRow),
      ],
    });
  }

  return sheets;
}

/** Build workbook for a stored month. */
export function buildMonthSummaryWorkbook(
  monthKey: string,
  monthLabel: string,
  monthData?: FinanceMonthData,
  insights?: string | null,
): string {
  const data = monthData ?? getMonthData(monthKey);
  const [year, month] = monthKey.split("-").map(Number);
  const income = resolveMonthIncome(year, month, { mode: "fact" });
  return buildWorkbookXml(buildMonthSummarySheets(monthKey, monthLabel, income, data, insights));
}

/** Write the .xls into the vault export folder. Returns the vault path. */
export async function exportWorkbookXml(
  app: App,
  fileKey: string,
  xml: string,
): Promise<string> {
  const path = normalizePath(monthSummaryExcelPath(fileKey));

  const folder = getExcelExportFolder();
  if (folder) {
    const existing = app.vault.getAbstractFileByPath(normalizePath(folder));
    if (!existing) {
      await app.vault.createFolder(normalizePath(folder));
    }
  }

  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, xml);
    return path;
  }
  await app.vault.create(path, xml);
  return path;
}

/** Write the .xls into the vault export folder. Returns the vault path. */
export async function exportMonthSummaryExcel(
  app: App,
  monthKey: string,
  monthLabel: string,
  monthData?: FinanceMonthData,
  insights?: string | null,
): Promise<string> {
  const xml = buildMonthSummaryWorkbook(monthKey, monthLabel, monthData, insights);
  return exportWorkbookXml(app, monthKey, xml);
}

/**
 * Export Excel for month / year. Saves the file and shows a Notice.
 * Does NOT open a new tab (mobile-safe, no surprise workspace splits).
 */
export async function exportPeriodExcel(
  app: App,
  period: ExportPeriod,
  refDate: Date = new Date(),
  weekStartsOn = 1,
): Promise<string> {
  void weekStartsOn;
  const range = resolveExportPeriod(period, refDate);
  const income = resolveRangeIncome(range.start, range.end);
  const expenses = collectRangeExpenses(range.start, range.end);
  const goals: MonthGoal[] = monthKeysInRange(range.start, range.end).flatMap(
    (k) => getFinanceMap()[k]?.monthGoals || [],
  );
  // Dedupe goals by id (rollover copies ids across months) — keep the latest entry.
  const goalMap = new Map<string, MonthGoal>();
  for (const g of goals) goalMap.set(g.id, g);
  const uniqueGoals = [...goalMap.values()];

  const planData =
    period === "month"
      ? getMonthData(`${range.start.getFullYear()}-${pad2(range.start.getMonth() + 1)}`)
      : null;

  // Year → per-month breakdown rows
  let monthly:
    | Array<{
        month: number;
        income: number;
        expenses: number;
        goalDeposits: number;
        expenseCount: number;
      }>
    | undefined;
  if (period === "year") {
    const year = range.start.getFullYear();
    const all = getFinanceMap();
    monthly = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${pad2(m)}`;
      const data = all[key];
      const exps = data?.expenses || [];
      const expTotal = exps.reduce((s, e) => s + (e.amount || 0), 0);
      const goalDep = sumGoalMonthContributions(data?.monthGoals);
      const inc = resolveRangeIncome(new Date(year, m - 1, 1), new Date(year, m, 0));
      monthly.push({
        month: m,
        income: inc.total,
        expenses: expTotal,
        goalDeposits: goalDep,
        expenseCount: exps.length,
      });
    }
  }

  let insights: string | null = null;
  if (period === "month" && planData) {
    insights = await generateInsightsWithNotice(planData, income.total);
  }

  const sheets = buildPeriodSheets(
    period,
    range,
    income,
    expenses,
    uniqueGoals,
    insights,
    planData,
    monthly,
  );
  const xml = buildWorkbookXml(sheets);
  return exportWorkbookXml(app, range.key, xml);
}

/**
 * Export Excel for a period and notify. No workspace tab — safe on phone and desktop.
 */
export async function exportPeriodExcelFile(
  app: App,
  period: ExportPeriod,
  refDate: Date = new Date(),
  weekStartsOn = 1,
): Promise<void> {
  try {
    const path = await exportPeriodExcel(app, period, refDate, weekStartsOn);
    new Notice(tRaw("finance.exportSaved", { path }));
  } catch (e) {
    new Notice(tRaw("finance.exportError", { error: e instanceof Error ? e.message : String(e) }));
  }
}

/** Month export + Notice (no new tab). */
export async function exportMonthSummaryExcelFile(
  app: App,
  monthKey: string,
  monthLabel: string,
): Promise<void> {
  await exportPeriodExcelFile(app, "month", new Date(`${monthKey}-01T12:00:00`));
  void monthLabel;
}
