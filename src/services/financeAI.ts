import { get } from "svelte/store";
import { streamOllamaChat, parseOllamaJson } from "./OllamaService";
import { settings } from "../ui/stores";
import {
  type ExpenseCategoryDef,
  guessCategory,
  categoryByName,
} from "../finance/expenseCategories";

export interface ParsedExpense {
  name: string;
  icon: string;
  amount: number;
  /** Existing category name to credit, or empty for a new category */
  categoryName: string;
  selected: boolean;
}

export interface FinanceSummary {
  monthlyIncome: number;
  mainTotal: number;
  goalContributions: number;
  balance: number;
  savingsTotal: number;
  daysLeftInMonth: number;
  categories: Array<{ name: string; icon: string; amount: number }>;
  goals: Array<{ name: string; current: number; target: number }>;
  savings: Array<{ name: string; amount: number; percent: number }>;
  rules: string[];
}

export interface DistributionSuggestion {
  rules: string[];
  categoryPercents: Array<{ name: string; percent: number }>;
  explanation: string;
}

function daysLeftInMonth(): number {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, last - now.getDate() + 1);
}

export function buildFinanceSummary(input: {
  monthlyIncome: number;
  mainCategories: Array<{ name: string; icon: string; amount: number }>;
  goals: Array<{ name: string; currentAmount: number; targetAmount: number; broughtForward?: number }>;
  savings: Array<{ name: string; amount: number; percent: number }>;
  rules: string[];
  goalContribution: number;
}): FinanceSummary {
  const mainTotal = input.mainCategories.reduce((s, c) => s + (c.amount || 0), 0);
  const savingsTotal = input.savings.reduce((s, c) => s + (c.amount || 0), 0);
  return {
    monthlyIncome: input.monthlyIncome || 0,
    mainTotal,
    goalContributions: input.goalContribution || 0,
    balance: (input.monthlyIncome || 0) - mainTotal - (input.goalContribution || 0),
    savingsTotal,
    daysLeftInMonth: daysLeftInMonth(),
    categories: input.mainCategories.map((c) => ({
      name: c.name,
      icon: c.icon || "📦",
      amount: c.amount || 0,
    })),
    goals: input.goals.map((g) => ({
      name: g.name,
      current: g.currentAmount || 0,
      target: g.targetAmount || 0,
    })),
    savings: input.savings.map((s) => ({
      name: s.name,
      amount: s.amount || 0,
      percent: s.percent || 0,
    })),
    rules: input.rules || [],
  };
}

function ollamaOpts(): { url: string; model: string; enabled: boolean } {
  const s = get(settings) as {
    ollamaEnabled?: boolean;
    ollamaUrl?: string;
    ollamaModel?: string;
  };
  return {
    enabled: s.ollamaEnabled === true,
    url: s.ollamaUrl || "http://localhost:11434",
    model: s.ollamaModel || "llama3.1",
  };
}

export function getFinanceAiConfig(): { url: string; model: string; enabled: boolean } {
  return ollamaOpts();
}

// ── 1. Parse expenses from free text ──────────────────────────────────────────

const PARSE_SYSTEM = `You extract expense line items from free-form text (Russian or English).
Return ONLY valid JSON.

Rules:
- Each expense: name (short clean title), amount (number, no currency), category (id from the provided list), icon (single emoji).
- The user provides fixed category ids with names and emoji. ALWAYS pick one of those ids.
- Examples: "штаны 2000" → clothing, "продукты" → food, "такси" → transport (when those ids exist).
- Use the category's default emoji unless the item clearly has a better one.
- Merge same name by summing amounts.
- Amounts like "1.2к", "1200р", "1 200 ₽" → number.

OUTPUT:
{"expenses":[{"name":"string","amount":number,"category":"<id from list>","icon":"emoji"}]}`;

export async function parseExpensesFromText(
  text: string,
  categories: ExpenseCategoryDef[],
  signal?: AbortSignal,
): Promise<ParsedExpense[]> {
  const { url, model, enabled } = ollamaOpts();

  const catList = categories.map((c) => `${c.id}=${c.name} ${c.icon}`).join(", ");
  const userContent = `Categories: ${catList}\n\nText:\n${text.slice(0, 8000)}`;

  let raw = "";
  if (enabled) {
    try {
      raw = await streamOllamaChat(
        url,
        model,
        [
          { role: "system", content: PARSE_SYSTEM },
          { role: "user", content: userContent },
        ],
        { signal, temperature: 0.1 },
      );
    } catch {
      raw = "";
    }
  }

  const parsed = parseOllamaJson(raw) as {
    expenses?: Array<{
      name?: string;
      amount?: number;
      icon?: string;
      category?: string;
      categoryName?: string;
    }>;
  };

  let list = Array.isArray(parsed.expenses) ? parsed.expenses : [];

  // Fallback: rule-based extraction when AI is off or returned nothing
  if (!enabled || list.length === 0) {
    list = parseExpensesRuleBased(text, categories);
  }

  return list
    .filter((e) => e && typeof e.name === "string" && String(e.name).trim())
    .map((e) => {
      const name = String(e.name || "").trim();
      const cat =
        categoryByName(categories, String(e.category || e.categoryName || "")) ||
        guessCategory(categories, name + " " + text);
      return {
        name,
        icon: String(e.icon || cat.icon).slice(0, 4) || cat.icon,
        amount: Math.max(0, Math.round(Number(e.amount) || 0)),
        categoryName: cat.name,
        selected: true,
      };
    })
    .filter((e) => e.amount > 0 && e.name);
}

/** Simple offline parser: "такси 350, кофе 250" → entries with guessed categories. */
function parseExpensesRuleBased(
  text: string,
  categories: ExpenseCategoryDef[],
): Array<{
  name: string;
  amount: number;
  icon: string;
  category: string;
}> {
  const out: Array<{ name: string; amount: number; icon: string; category: string }> = [];
  const parts = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^(.*?)(?:\s+|:|—|-)?(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:р|руб|₽|р\.|рублей)?$/i);
    if (!m) continue;
    const name = m[1].replace(/[:\-—]\s*$/, "").trim();
    const amount = Math.round(parseFloat(m[2].replace(/\s/g, "").replace(",", ".")));
    if (!name || !isFinite(amount) || amount <= 0) continue;
    const cat = guessCategory(categories, part);
    out.push({ name, amount, icon: cat.icon, category: cat.id });
  }
  return out;
}

// ── 2. Forecast remainder ────────────────────────────────────────────────────

const FORECAST_SYSTEM = `You are a personal finance assistant. Analyze the month snapshot and forecast the remainder.
Write in the SAME language as the category names (Russian if they are Russian).
Return ONLY markdown (no code fences). Be concrete with numbers. Structure:
## Прогноз
- 2–4 sentences: will the month close, what is left, pace per day
## Риски
- 2–4 bullets
## Что сделать
- 3 short actionable tips
Keep it under 200 words.`;

export async function forecastBalance(
  summary: FinanceSummary,
  signal?: AbortSignal,
  onDelta?: (full: string) => void,
): Promise<string> {
  const { url, model, enabled } = ollamaOpts();
  if (!enabled) throw new Error("ollama-disabled");

  const payload = JSON.stringify(summary);
  return streamOllamaChat(
    url,
    model,
    [
      { role: "system", content: FORECAST_SYSTEM },
      { role: "user", content: `Month snapshot:\n${payload}` },
    ],
    {
      signal,
      temperature: 0.3,
      onDelta: (_d, full) => onDelta?.(full),
    },
  );
}

// ── 3. Smart distribution rules ──────────────────────────────────────────────

const RULES_SYSTEM = `You suggest a money-distribution plan for a monthly budget.
Return ONLY valid JSON.

RULES:
- "rules": 3–6 short allocation rules as strings (percentages must sum conceptually to 100 of the remainder).
- "categoryPercents": suggest percent of REMAINDER (balance after expenses and goal deposits) for each savings category name provided; names must match exactly.
- "explanation": 2–3 sentences in the same language as category names.

OUTPUT:
{"rules":["..."],"categoryPercents":[{"name":"...","percent":number}],"explanation":"..."}`;

export async function suggestDistribution(
  summary: FinanceSummary,
  signal?: AbortSignal,
): Promise<DistributionSuggestion> {
  const { url, model, enabled } = ollamaOpts();
  if (!enabled) throw new Error("ollama-disabled");

  const raw = await streamOllamaChat(
    url,
    model,
    [
      { role: "system", content: RULES_SYSTEM },
      { role: "user", content: `Month snapshot:\n${JSON.stringify(summary)}` },
    ],
    { signal, temperature: 0.2 },
  );

  const parsed = parseOllamaJson(raw) as {
    rules?: unknown;
    categoryPercents?: unknown;
    explanation?: unknown;
  };
  const rules = Array.isArray(parsed.rules)
    ? parsed.rules.map((r) => String(r)).filter(Boolean).slice(0, 8)
    : [];
  const categoryPercents = Array.isArray(parsed.categoryPercents)
    ? parsed.categoryPercents
        .map((c) => ({
          name: String((c as { name?: string }).name || "").trim(),
          percent: Math.max(0, Math.min(100, Math.round(Number((c as { percent?: number }).percent) || 0))),
        }))
        .filter((c) => c.name)
    : [];
  return {
    rules,
    categoryPercents,
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
  };
}
