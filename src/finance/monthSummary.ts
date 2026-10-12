/**
 * Builds a Markdown month summary for the Finance block.
 * Pure string builder — no Obsidian deps, easy to test.
 *
 * Fact-only: income, expense log, goal deposits (piggy-bank outflows).
 * The Budget plan (approximate allocation) never appears here.
 */
import type { ExpenseEntry, FinanceMonthData, MonthGoal } from "./types";
import {
  computeMonthRemainder,
  getGoalMonthContribution,
  sumGoalMonthContributions,
} from "./types";
import type { MonthIncomeBreakdown } from "./income";

export interface MonthSummaryLabels {
  title: string;
  income: string;
  expenses: string;
  budget: string;
  balance: string;
  remainder: string;
  fromTasks: string;
  fromManualSources: string;
  total: string;
  mode: string;
  modePlan: string;
  modeFact: string;
  modeManual: string;
  expenseByCategory: string;
  expenseList: string;
  mainAccount: string;
  monthGoals: string;
  savings: string;
  rules: string;
  category: string;
  amount: string;
  name: string;
  date: string;
  progress: string;
  completed: string;
  empty: string;
  currency: string;
  /** Section heading for AI tips (optional). */
  insights?: string;
  /** Column header for share-of-total. */
  share?: string;
  /** "Generated …" footer. */
  generated?: string;
  /** Section heading for piggy-bank deposits (optional). */
  goalDeposits?: string;
}

export interface MonthSummaryInput {
  /** YYYY-MM */
  monthKey: string;
  monthLabel: string;
  income: MonthIncomeBreakdown;
  monthData: FinanceMonthData;
  labels: MonthSummaryLabels;
  /** Number formatter (locale-aware). Default: plain toString with spaces. */
  formatMoney?: (n: number) => string;
  /** Optional AI tips (markdown bullets) appended as the last section. */
  insights?: string;
}

function defaultFormat(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

function modeLabel(mode: MonthIncomeBreakdown["mode"], l: MonthSummaryLabels): string {
  if (mode === "plan") return l.modePlan;
  if (mode === "manual") return l.modeManual;
  return l.modeFact;
}

function expenseByCategory(expenses: ExpenseEntry[]): { name: string; amount: number; count: number }[] {
  const map = new Map<string, { name: string; amount: number; count: number }>();
  for (const e of expenses) {
    const key = e.categoryName || "—";
    const prev = map.get(key) || { name: key, amount: 0, count: 0 };
    prev.amount += e.amount || 0;
    prev.count += 1;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

/** Unicode progress bar, e.g. ██████░░░░ */
export function progressBar(pct: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

function shareLabel(amount: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((amount / total) * 100)}%`;
}

/** Render the full month summary as Markdown. */
export function buildMonthSummaryMarkdown(input: MonthSummaryInput): string {
  const { monthKey, monthLabel, income, monthData, labels } = input;
  const fmt = input.formatMoney || defaultFormat;
  const money = (n: number) => `${fmt(n)} ${labels.currency}`;
  const shareCol = labels.share || "%";

  const expenses = monthData.expenses || [];
  const expensesTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const goalsContrib = sumGoalMonthContributions(monthData.monthGoals);
  // Fact-only remainder: income − expense log − this month's piggy-bank deposits.
  // Budget plan is ignored here on purpose.
  const balance = computeMonthRemainder(income.total, expensesTotal, goalsContrib);

  const lines: string[] = [];

  // ── Header ──
  lines.push(`# 💰 ${labels.title} · ${monthLabel}`);
  lines.push("");
  lines.push(`> \`${monthKey}\``);
  lines.push("");

  // ── Key numbers (big readable card) ──
  lines.push(`## 📊 ${labels.balance}`);
  lines.push("");
  lines.push(`- 📥 **${labels.income}:** ${money(income.total)}`);
  lines.push(`- 📤 **${labels.expenses}:** ${money(expensesTotal)}`);
  if (goalsContrib !== 0) {
    lines.push(`- 🏆 **${labels.monthGoals}:** ${money(goalsContrib)}`);
  }
  lines.push(
    `- ${balance >= 0 ? "💎" : "⚠️"} **${labels.remainder}:** ${money(balance)}`,
  );
  lines.push("");

  lines.push("---");
  lines.push("");

  // ── Income ──
  lines.push(`## 📥 ${labels.income}`);
  lines.push("");
  lines.push(
    mdTable(
      [labels.name, labels.amount],
      [
        [labels.fromTasks, money(income.fromTasks)],
        [labels.fromManualSources, money(income.fromManualSources)],
        [`**${labels.total}**`, `**${money(income.total)}**`],
        [labels.mode, modeLabel(income.mode, labels)],
      ],
    ),
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // ── Expenses (fact) ──
  lines.push(`## 📤 ${labels.expenses}`);
  lines.push("");
  if (expenses.length === 0 && goalsContrib === 0) {
    lines.push(`*${labels.empty}*`);
    lines.push("");
  } else {
    if (expenses.length > 0) {
      lines.push(`### 🏷️ ${labels.expenseByCategory}`);
      lines.push("");
      const byCat = expenseByCategory(expenses);
      lines.push(
        mdTable(
          [labels.category, labels.amount, shareCol],
          byCat.map((c) => [c.name, money(c.amount), shareLabel(c.amount, expensesTotal)]),
        ),
      );
      lines.push("");
      lines.push(`### 🧾 ${labels.expenseList}`);
      lines.push("");
      const sorted = [...expenses].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      lines.push(
        mdTable(
          [labels.date, labels.name, labels.category, labels.amount],
          sorted.map((e) => [e.date || "—", e.name || "—", e.categoryName || "—", money(e.amount || 0)]),
        ),
      );
      lines.push("");
    }

    // Piggy-bank deposits are real outflows — show them beside the expense log.
    const goals: MonthGoal[] = monthData.monthGoals || [];
    const deposited = goals.filter((g) => getGoalMonthContribution(g) > 0);
    if (deposited.length > 0) {
      lines.push(`### 🏆 ${labels.goalDeposits || labels.monthGoals}`);
      lines.push("");
      lines.push(
        mdTable(
          [labels.name, labels.amount],
          deposited.map((g) => [
            `${g.icon || ""} ${g.name}`.trim(),
            money(getGoalMonthContribution(g)),
          ]),
        ),
      );
      lines.push("");
      lines.push(`**${labels.total}:** ${money(goalsContrib)}`);
      lines.push("");
    }
  }
  lines.push("---");
  lines.push("");

  // ── AI tips ──
  const insights = (input.insights || "").trim();
  if (insights) {
    lines.push("---");
    lines.push("");
    lines.push(`## ✨ ${labels.insights || "Insights"}`);
    lines.push("");
    lines.push(insights);
    lines.push("");
  }

  // ── Footer ──
  if (labels.generated) {
    lines.push("---");
    lines.push("");
    lines.push(`<sub>${labels.generated}</sub>`);
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** File title for the export, e.g. `Финансы 2026-07`. */
export function monthSummaryTitle(title: string, monthKey: string): string {
  return `${title} ${monthKey}`;
}
