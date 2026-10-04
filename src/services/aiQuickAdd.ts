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
  tags?: string[] | null;
  estimatedMinutes?: number | null;
  deadline?: string | null;
  deadlineTime?: string | null;
  /** Cost of the task: numeric rate (400, 2000) */
  rate?: number | null;
  /** How the rate is charged */
  paymentType?: "hour" | "day" | null;
  recurrence?: {
    type: "daily" | "weekly" | "monthly";
    interval?: number;
    daysOfWeek?: number[];
    until?: string | null;
  } | null;
}

export interface AiQuickAddContext {
  /** Real project names so the model can match @project to an existing one. */
  projectNames?: string[];
  /** Note basenames so "в заметке X" can bind to a real note. */
  noteNames?: string[];
  /** Override "today" (tests). Defaults to local calendar date. */
  now?: Date;
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

const WEEKDAY_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function formatQuickAddDateContext(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d} (${WEEKDAY_EN[now.getDay()]})`;
}

/** Build the Ollama system prompt with live date / project / note context. */
export function buildQuickAddSystem(context: AiQuickAddContext = {}): string {
  const dateLine = formatQuickAddDateContext(context.now ?? new Date());
  const projects =
    context.projectNames && context.projectNames.length > 0
      ? context.projectNames.slice(0, 40).join(", ")
      : "(none — leave projectName null unless user writes @Name)";
  const notes =
    context.noteNames && context.noteNames.length > 0
      ? context.noteNames.slice(0, 40).join(", ")
      : "(none — use noteName only if user names a note)";

  return `You parse natural-language task quick-add input for a calendar/task plugin.
Return ONLY valid JSON. Same language as the user input.

Current date: ${dateLine}
Resolve ALL relative dates against this date. Output date/deadline as absolute YYYY-MM-DD.

Known projects (prefer these exact names for projectName): ${projects}
Known notes (prefer these exact basenames for noteName): ${notes}

Split ONE or MANY tasks from the text (newlines, ";", " + ", numbered lists, " и " only when both sides are independent actions).
Do NOT split a single action that merely contains "и" inside its title.
WEEK PLANS: a day header ("понедельник", "пн:", "вт —", "Monday") applies its date to every task listed under it until the next day header. Each task gets that day's date (absolute YYYY-MM-DD).

For each task detect:
- title: short actionable title in the user's language. Strip dates, times, @project, priority markers, tags, durations, "в заметке X" / [[X]], recurrence phrases. Keep the action verb/object. No trailing punctuation junk.
- date: absolute YYYY-MM-DD when the user names a day (today/tomorrow/weekday/date), else null. "в понедельник" = next Monday on/after today.
- scheduledTime / endTime: HH:MM (24h). Ranges "14-15", "14:00-15:00", "с 14 до 15" → both. "в 9" → 09:00. Else null.
- priority: high | medium | low. (! or !! = high, ~ = medium, - = low; also "важно/срочно/urgent" → high). Default medium.
- projectName: match the user's @token to Known projects when possible; else the token after @; else null.
- isWorkTask: true if work-related (созвон, встреча, отчёт, клиент, дедлайн, ТЗ, спринт, рабочий, работа, презентация, смета, invoice, meeting, report, client, deadline) OR if rate/payment is given
- noteName: note/file if user says "в заметке X", "[[X]]", "note X", "привязать к X" — match Known notes when possible; else null
- tags: short keywords from #tags or clear topic words (no # prefix). Empty array if none.
- estimatedMinutes: integer minutes from duration ("на 2 часа", "30 мин", "2 ч", "for 2h"). If a time range is given and no explicit duration, compute from range. Else null.
- deadline: absolute YYYY-MM-DD when user says "до / by / сдать к / deadline" + a date. Else null. (deadline ≠ date: date is when to work on it)
- deadlineTime: HH:MM if a deadline time is given ("сдать до 18:00"), else null
- rate + paymentType: COST of the task, NOT description. "400р в час", "400 ₽/час", "400/ч", "2000 в день", "2000/день", "400 руб/час" → rate 400 paymentType "hour" / rate 2000 paymentType "day". Strip this from title and description. isWorkTask = true when rate is set. paymentType "hour" for hour/h/час; "day" for day/день/сутки; if only a number with "р/₽/руб" and no period, use paymentType "hour". rate null if no price.
- recurrence: "каждый день/ежедневно" → daily; "каждую неделю/по понедельникам/раз в неделю" → weekly (daysOfWeek 0=Sun..6=Sat from weekday names; "по будням" → [1,2,3,4,5]); "каждые 2 недели" → weekly interval 2; "каждый месяц/ежемесячно" → monthly; "до 1 декабря" on a repeat → until "YYYY-MM-DD"; else null
- description: leftover details that don't belong in the title (keep short; null if none). NEVER put rate/price/payment here.

Return shape:
{"tasks":[{"title":"string","date":"YYYY-MM-DD|null","scheduledTime":"HH:MM|null","endTime":"HH:MM|null","priority":"medium","projectName":null,"isWorkTask":false,"noteName":null,"description":null,"tags":[],"estimatedMinutes":null,"deadline":null,"deadlineTime":null,"rate":null,"paymentType":null,"recurrence":null}]}

Examples (dates are illustrative — always use Current date):

Input: "!Отчёт для клиента завтра 14:00 @Work рабочий, привязать к заметке Отчёты, каждый понедельник"
Output: {"tasks":[{"title":"Отчёт для клиента","date":"<tomorrow>","scheduledTime":"14:00","endTime":null,"priority":"high","projectName":"Work","isWorkTask":true,"noteName":"Отчёты","description":null,"tags":[],"estimatedMinutes":null,"deadline":null,"deadlineTime":null,"recurrence":{"type":"weekly","interval":1,"daysOfWeek":[1]}}]}

Input: "купить молоко; созвон с командой в 10-11 и спортзал завтра"
Output: {"tasks":[{"title":"Купить молоко","priority":"low","tags":[]},{"title":"Созвон с командой","scheduledTime":"10:00","endTime":"11:00","priority":"medium","isWorkTask":true,"tags":[],"estimatedMinutes":60},{"title":"Спортзал","date":"<tomorrow>","priority":"medium","tags":[]}]}

Input: "сдать отчёт до пятницы 18:00 на 2 часа #работа @Work"
Output: {"tasks":[{"title":"Сдать отчёт","date":null,"scheduledTime":null,"endTime":null,"priority":"medium","projectName":"Work","isWorkTask":true,"noteName":null,"description":null,"tags":["работа"],"estimatedMinutes":120,"deadline":"<friday>","deadlineTime":"18:00","recurrence":null}]}

Input: "Дизайн лендинга, 400р в час @Work"
Output: {"tasks":[{"title":"Дизайн лендинга","date":null,"scheduledTime":null,"endTime":null,"priority":"medium","projectName":"Work","isWorkTask":true,"noteName":null,"description":null,"tags":[],"estimatedMinutes":null,"deadline":null,"deadlineTime":null,"rate":400,"paymentType":"hour","recurrence":null}]}

Input: "монтаж видео 2000 в день"
Output: {"tasks":[{"title":"Монтаж видео","priority":"medium","isWorkTask":true,"tags":[],"rate":2000,"paymentType":"day"}]}

Input: "утренняя зарядка каждый день на 15 минут"
Output: {"tasks":[{"title":"Утренняя зарядка","date":null,"scheduledTime":null,"endTime":null,"priority":"medium","projectName":null,"isWorkTask":false,"noteName":null,"description":null,"tags":[],"estimatedMinutes":15,"deadline":null,"deadlineTime":null,"recurrence":{"type":"daily","interval":1}}]}

Input: "team standup every weekday at 9:30"
Output: {"tasks":[{"title":"Team standup","date":null,"scheduledTime":"09:30","endTime":null,"priority":"medium","projectName":null,"isWorkTask":true,"noteName":null,"description":null,"tags":[],"estimatedMinutes":null,"deadline":null,"deadlineTime":null,"recurrence":{"type":"weekly","interval":1,"daysOfWeek":[1,2,3,4,5]}}]}

Input: "пн: созвон с командой в 10:00 @Work; отписать клиенту
вт: черновик статьи на 2 часа
пт: спортзал 18-19"
Output: {"tasks":[{"title":"Созвон с командой","date":"<next Monday>","scheduledTime":"10:00","endTime":null,"priority":"medium","projectName":"Work","isWorkTask":true,"tags":[],"estimatedMinutes":null},{"title":"Отписать клиенту","date":"<next Monday>","priority":"medium","isWorkTask":true,"tags":[]},{"title":"Черновик статьи","date":"<next Tuesday>","priority":"medium","tags":[],"estimatedMinutes":120},{"title":"Спортзал","date":"<next Friday>","scheduledTime":"18:00","endTime":"19:00","priority":"medium","tags":[],"estimatedMinutes":60}]}`;
}

/** Normalize "9", "9.30", "09:5", "23:59" → "HH:MM"; invalid → null. */
export function normalizeAiTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\./g, ":");
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = m[2] !== undefined ? parseInt(m[2], 10) : 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Validate absolute YYYY-MM-DD; invalid → null. */
export function normalizeAiDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return s;
}

export function normalizeAiMinutes(raw: unknown): number | null {
  const n = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), 60 * 24 * 14);
}

/** Parse rate number from "400", "400р", "1 500", 400 */
export function normalizeAiRate(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/\s+/g, "").replace(/[₽рp.]/gi, "").replace(/,/g, ".");
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** "hour" | "day" from model or free text; else null */
export function normalizeAiPaymentType(raw: unknown): "hour" | "day" | null {
  if (raw === "hour" || raw === "day") return raw;
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase();
  if (/час|hour|\bhr?\b|\bч\b|h\b/.test(s)) return "hour";
  if (/день|сутки|day|\bд\b|d\b/.test(s)) return "day";
  return null;
}

/**
 * Fallback: pull rate/payment out of free text like "400р в час", "2000/день".
 * Returns rate + paymentType or nulls.
 */
export function extractRateFromText(text: string): {
  rate: number | null;
  paymentType: "hour" | "day" | null;
  matched: string | null;
} {
  // 400р в час / 2000/день / 500 руб. в час / 400 ₽/hr
  const re =
    /(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:₽|р\.?|руб(?:лей|ля)?)?\s*(?:\/|\s+)?\s*(?:в\s+)?(час(?:а|ов)?|hour|hr|h|ч|день|дня|дней|day|d|сутки)(?![а-яёa-z])/i;
  const m = re.exec(text);
  if (m) {
    const rate = normalizeAiRate(m[1]);
    const paymentType = normalizeAiPaymentType(m[2]);
    return { rate, paymentType, matched: rate ? m[0] : null };
  }
  // bare "400р" / "400 руб" without period → hour
  const bare = /(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:₽|р\.|руб(?:лей|ля)?)/i.exec(text);
  if (!bare) return { rate: null, paymentType: null, matched: null };
  const rate = normalizeAiRate(bare[1]);
  return {
    rate,
    paymentType: rate ? "hour" : null,
    matched: rate ? bare[0] : null,
  };
}

function normalizeAiTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.trim().replace(/^#+/, "").trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 12);
}

function normalizeAiPriority(raw: unknown): "low" | "medium" | "high" {
  if (raw === "high" || raw === "urgent" || raw === "critical") return "high";
  if (raw === "low") return "low";
  return "medium";
}

function normalizeAiRecurrence(raw: unknown): AiQuickTaskDraft["recurrence"] {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as {
    type?: unknown;
    interval?: unknown;
    daysOfWeek?: unknown;
    until?: unknown;
  };
  const type =
    r.type === "daily" || r.type === "weekly" || r.type === "monthly" ? r.type : null;
  if (!type) return null;
  const intervalRaw =
    typeof r.interval === "number"
      ? r.interval
      : typeof r.interval === "string"
        ? parseInt(r.interval, 10)
        : 1;
  const interval = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.min(Math.round(intervalRaw), 365) : 1;
  const out: NonNullable<AiQuickTaskDraft["recurrence"]> = { type, interval };
  if (type === "weekly" && Array.isArray(r.daysOfWeek)) {
    const days = r.daysOfWeek
      .map((d) => (typeof d === "number" ? d : parseInt(String(d), 10)))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length > 0) out.daysOfWeek = [...new Set(days)].sort((a, b) => a - b);
  }
  const until = normalizeAiDate(r.until);
  if (until) out.until = until;
  return out;
}

function cleanAiTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—*•·,.:;]+/, "")
    .replace(/[\s\-–—*•·,.:;]+$/, "")
    .trim();
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  // Markdown fence first — models often wrap JSON in ```json … ```
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) candidates.push(fenced[1].trim());
  // Whole body as-is (handles {"tasks":[…]} and bare [[…],…] roots)
  candidates.push(text.trim());
  // Outermost object / array still left in the text
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) candidates.push(obj[0]);
  const arr = text.match(/\[[\s\S]*\]/);
  if (arr) candidates.push(arr[0]);
  return candidates;
}

function draftsFromParsed(parsed: unknown): AiQuickTaskDraft[] {
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { tasks?: unknown }).tasks)
      ? (parsed as { tasks: Array<Record<string, unknown>> }).tasks
      : [];
  const out: AiQuickTaskDraft[] = [];
  for (const t of list) {
    if (!t || typeof t !== "object") continue;
    const title = cleanAiTitle((t as { title?: unknown }).title);
    if (!title) continue;
    const rec = (t as { recurrence?: unknown }).recurrence;
    const draft: AiQuickTaskDraft = {
      title,
      date: normalizeAiDate((t as { date?: unknown }).date),
      scheduledTime: normalizeAiTime((t as { scheduledTime?: unknown }).scheduledTime),
      endTime: normalizeAiTime((t as { endTime?: unknown }).endTime),
      priority: normalizeAiPriority((t as { priority?: unknown }).priority),
      projectName: typeof (t as { projectName?: unknown }).projectName === "string"
        ? ((t as { projectName: string }).projectName.trim() || null)
        : null,
      isWorkTask: (t as { isWorkTask?: unknown }).isWorkTask === true,
      noteName: typeof (t as { noteName?: unknown }).noteName === "string"
        ? ((t as { noteName: string }).noteName.trim() || null)
        : null,
      description: typeof (t as { description?: unknown }).description === "string"
        ? ((t as { description: string }).description.trim() || null)
        : null,
      tags: normalizeAiTags((t as { tags?: unknown }).tags),
      estimatedMinutes: normalizeAiMinutes((t as { estimatedMinutes?: unknown }).estimatedMinutes),
      deadline: normalizeAiDate((t as { deadline?: unknown }).deadline),
      deadlineTime: normalizeAiTime((t as { deadlineTime?: unknown }).deadlineTime),
      rate: normalizeAiRate((t as { rate?: unknown }).rate),
      paymentType: normalizeAiPaymentType((t as { paymentType?: unknown }).paymentType),
      recurrence: normalizeAiRecurrence(rec),
    };
    const enriched = enrichDraftRate(draft, t as Record<string, unknown>);
    if (enriched.rate != null) enriched.isWorkTask = true;
    out.push(enriched);
  }
  return out;
}

/** Pull rate from title/description when the model left it in text. */
function enrichDraftRate(draft: AiQuickTaskDraft, rawItem: Record<string, unknown>): AiQuickTaskDraft {
  if (draft.rate != null && draft.paymentType) return draft;
  const sources = [
    typeof rawItem.title === "string" ? rawItem.title : "",
    typeof rawItem.description === "string" ? rawItem.description : "",
    draft.title,
    draft.description || "",
  ].filter(Boolean);
  for (const src of sources) {
    const { rate, paymentType, matched } = extractRateFromText(src);
    if (rate == null || !matched) continue;
    const strip = (s: string) =>
      s
        .replace(matched, "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s*[,;:]\s*$/, "")
        .trim();
    return {
      ...draft,
      rate,
      paymentType: draft.paymentType || paymentType || "hour",
      isWorkTask: true,
      title: strip(draft.title) || draft.title,
      description: draft.description ? strip(draft.description) || null : null,
    };
  }
  if (draft.rate != null && !draft.paymentType) {
    return { ...draft, paymentType: "hour", isWorkTask: true };
  }
  return draft;
}

/** Parse raw model JSON into drafts (pure — unit-testable). */
export function parseAiQuickTasks(raw: string): AiQuickTaskDraft[] {
  const text = raw.trim();
  for (const candidate of extractJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const out = draftsFromParsed(parsed);
      if (out.length > 0) return out;
    } catch {
      // try next candidate
    }
  }
  // Fallback: one task per non-empty line
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*•]\s+/, "").replace(/^\s*\d+[.)]\s+/, "").trim())
    .filter((l) => l && !l.startsWith("{") && !l.startsWith("```"))
    .map((title) => ({
      title: cleanAiTitle(title),
      priority: "medium" as const,
      tags: [] as string[],
    }))
    .filter((t) => t.title);
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
export async function parseQuickTasksWithAI(
  raw: string,
  context: AiQuickAddContext = {},
): Promise<AiQuickTaskDraft[]> {
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
      { role: "system", content: buildQuickAddSystem(context) },
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

const DESCRIPTION_SYSTEM = `You write a short task description for a calendar/task app.
Reply with plain text only — 1–3 sentences, no markdown, no quotes, no numbering.
Language: same as the user's task title.
Expand the title into concrete context: goal, key steps or constraints. Do not invent facts that contradict the title. Keep under 220 characters.`;

/** Generate a short task description from a title (and optional hint text). */
export async function generateTaskDescription(
  title: string,
  hint?: string | null,
): Promise<string> {
  const opts = get(settings) as AiQuickAddOptions;
  if (!opts.ollamaEnabled) throw new Error("ai-quick-add-unavailable");
  const url = opts.ollamaUrl || "http://localhost:11434";
  const model = opts.ollamaModel || "llama3.1";
  const { streamOllamaChat } = await import("./OllamaService");
  const user = hint && hint.trim() ? `${title}\n\nHint: ${hint.trim()}` : title;
  const out = await streamOllamaChat(
    url,
    model,
    [
      { role: "system", content: DESCRIPTION_SYSTEM },
      { role: "user", content: user },
    ],
    { temperature: 0.4 },
  );
  return out.trim().replace(/^["']|["']$/g, "").trim();
}
