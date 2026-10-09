/**
 * Builds a Markdown month summary for the Finance block.
 * Pure string builder — no Obsidian deps, easy to test.
 */
import type { ExpenseEntry, FinanceMonthData, MonthGoal, SavingsCategory } from "./types";
import { getGoalMonthContribution, isGoalComplete } from "./types";
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
  const mainTotal = (monthData.mainAccountCategories || []).reduce((s, c) => s + (c.amount || 0), 0);
  const goalsContrib = (monthData.monthGoals || []).reduce((s, g) => s + getGoalMonthContribution(g), 0);
  const savingsTotal = (monthData.savingsCategories || []).reduce((s, c) => s + (c.amount || 0), 0);
  const balance = income.total - mainTotal - goalsContrib;
  // Expenses shown in the totals card: actual log if present, else budget plan
  const shownExpenses = expensesTotal > 0 ? expensesTotal : mainTotal;

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
  lines.push(`- 📤 **${labels.expenses}:** ${money(shownExpenses)}`);
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

  // ── Expenses ──
  lines.push(`## 📤 ${labels.expenses}`);
  lines.push("");
  if (expenses.length === 0) {
    lines.push(`*${labels.empty}*`);
    lines.push("");
  } else {
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
  lines.push("---");
  lines.push("");

  // ── Budget ──
  lines.push(`## 🎯 ${labels.budget}`);
  lines.push("");

  lines.push(`### 💳 ${labels.mainAccount}`);
  lines.push("");
  const mainCats = monthData.mainAccountCategories || [];
  if (mainCats.length === 0) {
    lines.push(`*${labels.empty}*`);
    lines.push("");
  } else {
    lines.push(
      mdTable(
        [labels.name, labels.amount, shareCol],
        [...mainCats]
          .sort((a, b) => (b.amount || 0) - (a.amount || 0))
          .map((c) => [
            `${c.icon || ""} ${c.name}`.trim(),
            money(c.amount || 0),
            shareLabel(c.amount || 0, mainTotal),
          ]),
      ),
    );
    lines.push("");
    lines.push(`**${labels.total}:** ${money(mainTotal)}`);
    lines.push("");
  }

  lines.push(`### 🏆 ${labels.monthGoals}`);
  lines.push("");
  const goals: MonthGoal[] = monthData.monthGoals || [];
  if (goals.length === 0) {
    lines.push(`*${labels.empty}*`);
    lines.push("");
  } else {
    lines.push(
      mdTable(
        [labels.name, labels.progress, labels.amount],
        goals.map((g) => {
          const contrib = getGoalMonthContribution(g);
          const done = isGoalComplete(g);
          const pct = g.targetAmount > 0
            ? Math.min(100, Math.round(((g.currentAmount || 0) / g.targetAmount) * 100))
            : 0;
          return [
            `${done ? "✅ " : ""}${g.icon || ""} ${g.name}`.trim(),
            `\`${progressBar(pct)}\` ${pct}% · ${money(g.currentAmount || 0)} / ${money(g.targetAmount || 0)}`,
            money(contrib),
          ];
        }),
      ),
    );
    lines.push("");
  }

  lines.push(`### 🛟 ${labels.savings}`);
  lines.push("");
  const savings: SavingsCategory[] = monthData.savingsCategories || [];
  if (savings.length === 0) {
    lines.push(`*${labels.empty}*`);
    lines.push("");
  } else {
    lines.push(
      mdTable(
        [labels.name, labels.amount],
        [...savings]
          .sort((a, b) => (b.amount || 0) - (a.amount || 0))
          .map((c) => [`${c.icon || ""} ${c.name}`.trim(), money(c.amount || 0)]),
      ),
    );
    lines.push("");
    lines.push(`**${labels.total}:** ${money(savingsTotal)}`);
    lines.push("");
  }

  const rules = monthData.distributionRules || [];
  if (rules.length > 0) {
    lines.push(`### 📜 ${labels.rules}`);
    lines.push("");
    for (const r of rules) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }

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
