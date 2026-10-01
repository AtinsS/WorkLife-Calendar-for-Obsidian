import type { App, TFile } from "obsidian";
import { get } from "svelte/store";
import { settings } from "../ui/stores";
import { tRaw } from "../i18n";

/** Desktop-only AI gate (user rule: AI is hidden/disabled on mobile). */
export function isDesktopAI(): boolean {
  return typeof window !== "undefined" && window.innerWidth > 768;
}

export interface AiQuickTaskDraft {
  title: string;
  date?: string | null;
  scheduledTime?: string | null;
  endTime?: string | null;
  priority?: "low" | "medium" | "high";
  projectName?: string | null;
  isWorkTask?: boolean;
  noteName?: string | null;
  description?: string | null;
  recurrence?: {
    type: "daily" | "weekly" | "monthly";
    interval?: number;
    daysOfWeek?: number[];
  } | null;
}

interface AiQuickAddOptions {
  ollamaEnabled?: boolean;
  aiQuickAddEnabled?: boolean;
  ollamaUrl?: string;
  ollamaModel?: string;
}

/** True when AI smart quick-add can be shown (desktop + Ollama + feature flag). */
export function isAiQuickAddAvailable(): boolean {
  if (!isDesktopAI()) return false;
  const opts = get(settings) as AiQuickAddOptions;
  return opts.ollamaEnabled === true && opts.aiQuickAddEnabled !== false;
}

const QUICK_ADD_SYSTEM = `You parse natural-language task quick-add input for a calendar/task plugin.
Return ONLY valid JSON. Same language as the user input.

Split ONE or MANY tasks from the text (lines, ";", " и ", " + ", numbered lists).
For each task detect:
- title: short actionable title (strip dates/times/project/priority markers)
- date: YYYY-MM-DD if present (today/tomorrow/weekdays/dates), else null
- scheduledTime / endTime: HH:MM (ranges like 14-15 or 14:00-15:00 → both), else null
- priority: high | medium | low (! or !! = high, ~ = medium, - = low; also "важно/срочно" → high)
- projectName: word after @ if present, else null
- isWorkTask: true if work-related (созвон, встреча, отчёт, клиент, дедлайн, ТЗ, спринт, рабочий, работа, презентация, смета, invoice, meeting, report, client, deadline)
- noteName: note/file name if user says "в заметке X", "[[X]]", "note X", "привязать к X" — else null
- recurrence: if "каждый день/ежедневно" → daily; "каждую неделю/по понедельникам/раз в неделю" → weekly (daysOfWeek 0=Sun..6=Sat from weekday names); "каждый месяц/ежемесячно" → monthly; else null
- description: leftover details not needed in title

Return shape:
{"tasks":[{"title":"string","date":"YYYY-MM-DD|null","scheduledTime":"HH:MM|null","endTime":"HH:MM|null","priority":"medium","projectName":null,"isWorkTask":false,"noteName":null,"description":null,"recurrence":null}]}

Examples:
Input: "!Отчёт для клиента завтра 14:00 @Work рабочий, привязать к заметке Отчёты, каждый понедельник"
Output: {"tasks":[{"title":"Отчёт для клиента","date":"<tomorrow>","scheduledTime":"14:00","endTime":null,"priority":"high","projectName":"Work","isWorkTask":true,"noteName":"Отчёты","description":null,"recurrence":{"type":"weekly","interval":1,"daysOfWeek":[1]}}]}

Input: "купить молоко; созвон с командой в 10-11 и спортзал завтра"
Output: {"tasks":[{"title":"Купить молоко","priority":"low"},{"title":"Созвон с командой","scheduledTime":"10:00","endTime":"11:00","priority":"medium","isWorkTask":true},{"title":"Спортзал","date":"<tomorrow>","priority":"medium"}]}`;

/** Parse raw model JSON into drafts (pure — unit-testable). */
export function parseAiQuickTasks(raw: string): AiQuickTaskDraft[] {
  const text = raw.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const candidate = jsonMatch ? jsonMatch[0] : text;
  try {
    const parsed = JSON.parse(candidate) as {
      tasks?: Array<Partial<AiQuickTaskDraft> & { title?: string }>;
    };
    const list = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const out: AiQuickTaskDraft[] = [];
    for (const t of list) {
      const title = (t.title ?? "").trim();
      if (!title) continue;
      const p = t.priority;
      const priority: "low" | "medium" | "high" =
        p === "high" || p === "low" ? p : "medium";
      out.push({
        title,
        date: t.date ?? null,
        scheduledTime: t.scheduledTime ?? null,
        endTime: t.endTime ?? null,
        priority,
        projectName: t.projectName ?? null,
        isWorkTask: t.isWorkTask === true,
        noteName: t.noteName ?? null,
        description: t.description ?? null,
        recurrence: t.recurrence ?? null,
      });
    }
    return out;
  } catch {
    // Fallback: one task per non-empty line
    return text
      .split(/\n+/)
      .map((l) => l.replace(/^\s*[-*•]\s+/, "").replace(/^\s*\d+[.)]\s+/, "").trim())
      .filter((l) => l && !l.startsWith("{") && !l.startsWith("```"))
      .map((title) => ({ title, priority: "medium" as const }));
  }
}

/** Resolve a free-text note name to a vault markdown path. */
export function resolveNotePath(app: App, noteName: string | null | undefined): string | null {
  if (!noteName) return null;
  const query = noteName.trim().toLowerCase();
  if (!query) return null;
  const files = app.vault.getMarkdownFiles();
  const exact = files.find(
    (f) => f.basename.toLowerCase() === query || f.path.toLowerCase() === query,
  );
  if (exact) return exact.path;
  const prefix = files.find((f) => f.basename.toLowerCase().startsWith(query));
  if (prefix) return prefix.path;
  const includes = files.find((f) => f.basename.toLowerCase().includes(query));
  return includes ? includes.path : null;
}

/** Suggest note paths for UI (limit 5). */
export function findNoteMatches(app: App, noteName: string): TFile[] {
  const query = noteName.trim().toLowerCase();
  if (!query) return [];
  return app.vault
    .getMarkdownFiles()
    .filter((f) => f.basename.toLowerCase().includes(query) || f.path.toLowerCase().includes(query))
    .slice(0, 5);
}

/**
 * Ask Ollama to parse quick-add text into one or more task drafts
 * (work / note / recurrence detection sits on top of the regex parser).
 */
export async function parseQuickTasksWithAI(raw: string): Promise<AiQuickTaskDraft[]> {
  const opts = get(settings) as AiQuickAddOptions;
  if (!isDesktopAI() || !opts.ollamaEnabled || opts.aiQuickAddEnabled === false) {
    throw new Error("ai-quick-add-unavailable");
  }
  const url = opts.ollamaUrl || "http://localhost:11434";
  const model = opts.ollamaModel || "llama3.1";
  const { streamOllamaChat } = await import("./OllamaService");
  const out = await streamOllamaChat(
    url,
    model,
    [
      { role: "system", content: QUICK_ADD_SYSTEM },
      { role: "user", content: raw.trim() },
    ],
    { temperature: 0.1, format: "json" },
  );
  return parseAiQuickTasks(out);
}

export function aiQuickAddBusyMessage(): string {
  return tRaw("tasks.quickAdd.aiBusy");
}

export function aiQuickAddErrorMessage(): string {
  return tRaw("tasks.quickAdd.aiError");
}
