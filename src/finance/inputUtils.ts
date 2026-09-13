import { clampAmount } from "../utils/sanitize";

export function parseSavingsInput(input: string, balance: number): { amount: number; percent: number } {
  if (!input) return { amount: 0, percent: 0 };
  const raw = input.trim();
  // If there's an explicit percent sign anywhere, treat as percent
  if (raw.includes("%")) {
    const numStr = raw.replace("%", "").replace(/,/g, ".").trim();
    const num = parseFloat(numStr);
    const pct = Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : 0;
    const amount = clampAmount(Math.round(balance * pct / 100));
    return { amount, percent: pct };
  }

  // Otherwise try to parse numeric amount (allow commas/dots and ignore non-digit chars)
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(/,/g, ".").trim();
  const val = parseFloat(cleaned);
  const amount = Number.isFinite(val) ? clampAmount(Math.round(val)) : 0;
  const percent = balance > 0 ? Math.min(100, Math.round((amount / balance) * 100)) : 0;
  return { amount, percent };
}
