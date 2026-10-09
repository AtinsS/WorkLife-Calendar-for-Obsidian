/**
 * Saves the month summary as a Markdown note in the vault.
 */
import type { App } from "obsidian";
import { Notice, TFile, normalizePath } from "obsidian";
import { appendMarkdownToNote, datedNotePath } from "../ui/markdown";
import { tRaw, getCurrencySymbol } from "../i18n";
import { get } from "svelte/store";
import { settings } from "../ui/stores";
import { buildMonthSummaryMarkdown, monthSummaryTitle, type MonthSummaryLabels } from "./monthSummary";
import { resolveStoredIncome } from "./income";
import { getMonthData } from "./storage";
import type { FinanceMonthData } from "./types";
import {
  buildFinanceSummary,
  suggestMonthInsights,
  isFinanceInsightsEnabled,
} from "../services/financeAI";
import { getGoalMonthContribution } from "./types";

export function monthSummaryLabels(): MonthSummaryLabels {
  return {
    title: tRaw("finance.exportTitle"),
    income: tRaw("finance.income"),
    expenses: tRaw("finance.expenses"),
    budget: tRaw("finance.tabBudget"),
    balance: tRaw("finance.balance"),
    remainder: tRaw("finance.remainder"),
    fromTasks: tRaw("financeAnalytics.fromTasks"),
    fromManualSources: tRaw("financeAnalytics.extraIncome"),
    total: tRaw("financeAnalytics.total"),
    mode: tRaw("finance.incomeMode"),
    modePlan: tRaw("finance.planToggle"),
    modeFact: tRaw("finance.factToggle"),
    modeManual: tRaw("finance.manualToggle"),
    expenseByCategory: tRaw("habitAnalytics.expenseByCategory"),
    expenseList: tRaw("finance.expensesTitle"),
    mainAccount: tRaw("finance.mainAccount"),
    monthGoals: tRaw("finance.monthGoals"),
    savings: tRaw("finance.savings"),
    rules: tRaw("finance.rules"),
    category: tRaw("finance.expensesCategory"),
    amount: tRaw("finance.amount"),
    name: tRaw("finance.expensesName"),
    date: tRaw("finance.expensesDate"),
    progress: tRaw("finance.exportProgress"),
    completed: tRaw("financeAnalytics.completed"),
    empty: tRaw("finance.exportEmpty"),
    currency: getCurrencySymbol(),
    insights: tRaw("finance.insights"),
    share: tRaw("finance.share"),
    generated: tRaw("finance.generated"),
  };
}

/** Resolve the export folder from settings ("" → vault root). */
export function getExportFolder(): string {
  const folder = (get(settings).financeExportFolder || "").trim().replace(/^\/+|\/+$/g, "");
  return folder;
}

/** Full note path for a month summary, including the configured folder. */
export function monthSummaryNotePath(monthKey: string): string {
  const title = monthSummaryTitle(tRaw("finance.exportTitle"), monthKey);
  const dated = datedNotePath(title);
  const folder = getExportFolder();
  return folder ? `${folder}/${dated}` : dated;
}

/** Collect month snapshot for the AI prompt (same shape as financeAI.FinanceSummary). */
function buildAiSnapshot(data: FinanceMonthData, incomeTotal: number) {
  const expenses = data.expenses || [];
  const byCat = new Map<string, { name: string; icon: string; amount: number }>();
  for (const e of expenses) {
    const key = e.categoryName || "—";
    const prev = byCat.get(key) || { name: key, icon: e.icon || "📦", amount: 0 };
    prev.amount += e.amount || 0;
    if (e.icon) prev.icon = e.icon;
    byCat.set(key, prev);
  }
  const goalContrib = (data.monthGoals || []).reduce((s, g) => s + getGoalMonthContribution(g), 0);
  return buildFinanceSummary({
    monthlyIncome: incomeTotal,
    mainCategories: (data.mainAccountCategories || []).map((c) => ({
      name: c.name,
      icon: c.icon,
      amount: c.amount,
    })),
    goals: (data.monthGoals || []).map((g) => ({
      name: g.name,
      currentAmount: g.currentAmount,
      targetAmount: g.targetAmount,
      broughtForward: g.broughtForward,
    })),
    savings: (data.savingsCategories || []).map((s) => ({
      name: s.name,
      amount: s.amount,
      percent: s.percent,
    })),
    rules: data.distributionRules || [],
    goalContribution: goalContrib,
  });
}

/**
 * Generate AI tips for the month, or null when disabled/unavailable.
 * Never throws — export must work without Ollama.
 */
async function tryGenerateInsights(data: FinanceMonthData, incomeTotal: number): Promise<string | null> {
  if (!isFinanceInsightsEnabled()) return null;
  try {
    const snapshot = buildAiSnapshot(data, incomeTotal);
    const tips = await suggestMonthInsights(snapshot);
    return tips || null;
  } catch {
    return null;
  }
}

/**
 * Build the summary Markdown for a month and write it to a note.
 * Returns the vault path of the created/updated note.
 */
export async function exportMonthSummaryToNote(
  app: App,
  monthKey: string,
  monthLabel: string,
  monthData?: FinanceMonthData,
): Promise<string> {
  const data = monthData ?? getMonthData(monthKey);
  const [year, month] = monthKey.split("-").map(Number);
  const income = resolveStoredIncome(data, year, month);

  let insights: string | null = null;
  if (isFinanceInsightsEnabled()) {
    new Notice(tRaw("finance.insightsGenerating"));
    insights = await tryGenerateInsights(data, income.total);
  }

  const md = buildMonthSummaryMarkdown({
    monthKey,
    monthLabel,
    income,
    monthData: data,
    labels: monthSummaryLabels(),
    formatMoney: (n) => n.toLocaleString(undefined),
    insights: insights || undefined,
  });

  const title = monthSummaryTitle(tRaw("finance.exportTitle"), monthKey);
  const path = monthSummaryNotePath(monthKey);

  // Ensure the export folder exists
  const folder = getExportFolder();
  if (folder) {
    const existing = app.vault.getAbstractFileByPath(normalizePath(folder));
    if (!existing) {
      await app.vault.createFolder(normalizePath(folder));
    }
  }

  return appendMarkdownToNote(app, path, `# ${title}\n\n${md}\n`);
}

/** Export + open the note. Shows a Notice with the result. */
export async function exportMonthSummary(app: App, monthKey: string, monthLabel: string): Promise<void> {
  try {
    const path = await exportMonthSummaryToNote(app, monthKey, monthLabel);
    new Notice(tRaw("finance.exportSaved", { path }));
    const file = app.vault.getAbstractFileByPath(normalizePath(path));
    if (file instanceof TFile) {
      await app.workspace.getLeaf("tab").openFile(file);
    }
  } catch (e) {
    new Notice(tRaw("finance.exportError", { error: e instanceof Error ? e.message : String(e) }));
  }
}
