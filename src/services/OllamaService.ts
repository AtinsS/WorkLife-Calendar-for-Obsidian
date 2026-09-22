import { requestUrl } from "obsidian";

export interface OllamaSettings {
  ollamaEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string;
}

export const defaultOllamaSettings: OllamaSettings = {
  ollamaEnabled: false,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
};

export interface ExtractedSubtask {
  title: string;
}

export interface ExtractedTask {
  title: string;
  description?: string;
  priority: "low" | "medium" | "high";
  estimatedMinutes?: number;
  dayIndex: number;
  dayNumber?: number;
  weekday?: string;
  date?: string;
  dayTheme?: string;
  scheduledTime?: string;
  subtasks: ExtractedSubtask[];
  selected: boolean;
}

export interface WeekContext {
  weekStart?: string;
  weekEnd?: string;
  weekFocus?: string;
}

export interface ExtractionResult {
  tasks: ExtractedTask[];
  weekContext: WeekContext;
}

// ---------------------------------------------------------------------------
// System prompt — short, focused, with few-shot example
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You extract actionable tasks from planning documents. Return ONLY valid JSON.

RULES:
- Each day header starts a new group. Tasks under it get an INCREMENTING dayIndex (1, 2, 3...).
- Items under day/date headers are INDEPENDENT tasks. The header itself is never a task.
- Sub-items under topic headers (### Подготовка, ## Ремонт) become subtasks of that topic.
- Do NOT include: day names, dates, "Тема дня:", headers, tables, trackers.
- Strip time markers (🕐 HH:MM, 🕐 HH:MM–HH:MM) and priority markers (⏫ 🔼 🔽) from titles into fields.
- For time ranges like "10:00–13:00" set scheduledTime="10:00" and estimatedMinutes=180.
- Infer priority: ⏫/срочно/urgent/deadline → "high", 🔽/optional/hobby → "low", else "medium".

EXAMPLE INPUT:
> Неделя: 22.09 – 28.09
> Фокус недели: разработка

## Понедельник · 22.09
Тема дня: планирование и разгон

Утренняя рутина (зарядка, душ, завтрак) 🕐 07:00
Разобрать входящие и составить план на неделю ⏫ 🕐 09:00
Deep work: основная задача проекта 🕐 10:00–13:00
Обед + прогулка 🕐 13:00
Встречи/созвоны 🕐 14:00–16:00
Спортзал 🕐 18:00
Чтение 30 мин 🕐 21:00

## Вторник · 23.09
### Backend разработка
API эндпоинты
Тесты

### Подготовка к встрече
Слайды
Отчёт

EXAMPLE OUTPUT:
{
  "weekContext": {"weekStart": "2025-09-22", "weekEnd": "2025-09-28", "weekFocus": "разработка"},
  "tasks": [
    {"title": "Утренняя рутина (зарядка, душ, завтрак)", "priority": "medium", "scheduledTime": "07:00", "dayIndex": 1, "dayNumber": 1, "weekday": "Понедельник", "date": "2025-09-22", "dayTheme": "планирование и разгон", "subtasks": []},
    {"title": "Разобрать входящие и составить план на неделю", "priority": "high", "scheduledTime": "09:00", "dayIndex": 1, "dayNumber": 1, "weekday": "Понедельник", "date": "2025-09-22", "dayTheme": "планирование и разгон", "subtasks": []},
    {"title": "Deep work: основная задача проекта", "priority": "medium", "scheduledTime": "10:00", "estimatedMinutes": 180, "dayIndex": 1, "dayNumber": 1, "weekday": "Понедельник", "date": "2025-09-22", "dayTheme": "планирование и разгон", "subtasks": []},
    {"title": "Обед + прогулка", "priority": "low", "scheduledTime": "13:00", "dayIndex": 1, "dayNumber": 1, "weekday": "Понедельник", "date": "2025-09-22", "dayTheme": "планирование и разгон", "subtasks": []},
    {"title": "Встречи/созвоны", "priority": "medium", "scheduledTime": "14:00", "estimatedMinutes": 120, "dayIndex": 1, "dayNumber": 1, "weekday": "Понедельник", "date": "2025-09-22", "dayTheme": "планирование и разгон", "subtasks": []},
    {"title": "Спортзал", "priority": "low", "scheduledTime": "18:00", "dayIndex": 1, "dayNumber": 1, "weekday": "Понедельник", "date": "2025-09-22", "dayTheme": "планирование и разгон", "subtasks": []},
    {"title": "Чтение 30 мин", "priority": "low", "scheduledTime": "21:00", "estimatedMinutes": 30, "dayIndex": 1, "dayNumber": 1, "weekday": "Понедельник", "date": "2025-09-22", "dayTheme": "планирование и разгон", "subtasks": []},
    {"title": "Backend разработка", "priority": "medium", "dayIndex": 2, "dayNumber": 2, "weekday": "Вторник", "date": "2025-09-23", "subtasks": [{"title": "API эндпоинты"}, {"title": "Тесты"}]},
    {"title": "Подготовка к встрече", "priority": "medium", "dayIndex": 2, "dayNumber": 2, "weekday": "Вторник", "date": "2025-09-23", "subtasks": [{"title": "Слайды"}, {"title": "Отчёт"}]}
  ]
}

OUTPUT SCHEMA:
{
  "weekContext": {"weekStart": "YYYY-MM-DD|null", "weekEnd": "YYYY-MM-DD|null", "weekFocus": "string|null"},
  "tasks": [{
    "title": "string (clean, no emoji markers)",
    "description": "string|null",
    "priority": "low|medium|high",
    "estimatedMinutes": number|null,
    "dayIndex": number,
    "dayNumber": number|null,
    "weekday": "string|null",
    "date": "YYYY-MM-DD|null",
    "dayTheme": "string|null",
    "scheduledTime": "HH:MM|null",
    "subtasks": [{"title": "string"}]
  }]
}`;

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

function sliceAtLineBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.lastIndexOf("\n", maxLen);
  return cut > maxLen * 0.5 ? text.slice(0, cut) : text.slice(0, maxLen);
}

function buildUserPrompt(noteSlice: string): string {
  const now = new Date();
  const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDay = days[now.getDay()];

  return `Current date: ${currentDate} (${currentDay})

Extract tasks from this document:

${noteSlice}`;
}

// ---------------------------------------------------------------------------
// JSON parsing with retry
// ---------------------------------------------------------------------------

interface RawOllamaResponse {
  tasks?: Array<{
    title?: string;
    description?: string;
    priority?: string;
    estimatedMinutes?: number;
    dayIndex?: number;
    dayNumber?: number;
    weekday?: string;
    date?: string;
    dayTheme?: string;
    scheduledTime?: string;
    subtasks?: Array<{ title?: string }>;
  }>;
  weekContext?: {
    weekStart?: string;
    weekEnd?: string;
    weekFocus?: string;
  };
}

export function parseOllamaJson(content: string): RawOllamaResponse {
  try {
    return JSON.parse(content) as RawOllamaResponse;
  } catch {
    const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      try {
        return JSON.parse(codeBlock[1].trim()) as RawOllamaResponse;
      } catch {
        /* fall through */
      }
    }
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as RawOllamaResponse;
      } catch {
        /* fall through */
      }
    }
    throw new Error("Invalid JSON from Ollama");
  }
}

function deduplicateTasks(tasks: ExtractedTask[]): ExtractedTask[] {
  const seen = new Set<string>();
  return tasks.filter((t) => {
    const key = `${t.title.toLowerCase()}|${t.dayIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Post-processing: extract time/priority from title text
// ---------------------------------------------------------------------------

function parseTimeRange(text: string): { start: string; minutes: number } | null {
  const m = text.match(/(\d{1,2}):(\d{2})\s*[–\-—]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const startMin = parseInt(m[1]) * 60 + parseInt(m[2]);
  const endMin = parseInt(m[3]) * 60 + parseInt(m[4]);
  const diff = endMin - startMin;
  if (diff <= 0) return null;
  return { start: `${m[1].padStart(2, "0")}:${m[2]}`, minutes: diff };
}

function parseSingleTime(text: string): string | null {
  const m = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$|[–\-—])/);
  if (!m) return null;
  const h = parseInt(m[1]);
  const min = parseInt(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseDurationHint(text: string): number | null {
  const mMin = text.match(/(\d+)\s*(?:мин|min)/i);
  if (mMin) return parseInt(mMin[1]);
  const mHour = text.match(/(\d+(?:[.,]\d+)?)\s*(?:час|hour|hr|h)\b/i);
  if (mHour) return Math.round(parseFloat(mHour[1].replace(",", ".")) * 60);
  return null;
}

function stripTimeFromTitle(title: string): string {
  return title
    .replace(/🕐\s*\d{1,2}:\d{2}\s*[–\-—]\s*\d{1,2}:\d{2}/gu, "")
    .replace(/🕐\s*\d{1,2}:\d{2}/gu, "")
    .replace(/\s*\d{1,2}:\d{2}\s*[–\-—]\s*\d{1,2}:\d{2}\s*$/u, "")
    .replace(/\s*\d{1,2}:\d{2}\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPriorityFromTitle(title: string): string {
  return title.replace(/[⏫🔼🔽⚡❗⬜]\s*/gu, "").replace(/\s+/g, " ").trim();
}

function extractPriorityFromTitle(title: string): "low" | "medium" | "high" | null {
  if (/⏫|⚡|❗/.test(title)) return "high";
  if (/🔽/.test(title)) return "low";
  if (/\b(срочно|urgent|критично|дедлайн|deadline|ASAP)\b/i.test(title)) return "high";
  if (/\b(опционально|если останется|nice.to.have|hobby|хобби)\b/i.test(title)) return "low";
  return null;
}

function enrichTask(t: ExtractedTask): ExtractedTask {
  let title = t.title;
  let scheduledTime = t.scheduledTime;
  let estimatedMinutes = t.estimatedMinutes;
  let priority = t.priority;

  const titlePriority = extractPriorityFromTitle(title);
  if (titlePriority) {
    priority = titlePriority;
    title = stripPriorityFromTitle(title);
  }

  const range = parseTimeRange(title);
  if (range && !scheduledTime) {
    scheduledTime = range.start;
    if (!estimatedMinutes) estimatedMinutes = range.minutes;
    title = stripTimeFromTitle(title);
  } else {
    const singleTime = parseSingleTime(title);
    if (singleTime && !scheduledTime) {
      scheduledTime = singleTime;
      title = stripTimeFromTitle(title);
    }
  }

  const durationHint = parseDurationHint(title);
  if (durationHint && !estimatedMinutes) {
    estimatedMinutes = durationHint;
  }

  return { ...t, title, scheduledTime, estimatedMinutes, priority };
}

// ---------------------------------------------------------------------------
// Temporal sanitizer — strip time containers from model output
// ---------------------------------------------------------------------------

const TEMPORAL_PATTERNS: RegExp[] = [
  // Day names — \b doesn't work with Cyrillic, use Unicode-aware boundaries
  /(?<!\p{L})(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?!\p{L})/iu,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  // "День N" / "Day N"
  /(?<!\p{L})(день|day)\s*\d+/iu,
  // Week references
  /(?<!\p{L})(недел[яьие]|week)\s*\d*/iu,
  // Month names
  /(?<!\p{L})(январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)(?!\p{L})/iu,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  // Date patterns: 22.09, 22/09, 22-09 — negative lookbehind for colon (avoids matching time like "10:00-13:00")
  /(?<!:)\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b/,
  // "До обеда", "После обеда", "Утро", "Вечер"
  /^(утро|день|вечер|ночь|утром|днём|вечером|ночью|до обеда|после обеда)$/i,
];

/** Check if a title is purely temporal (a time container, not a task). */
export function isTemporalTitle(title: string): boolean {
  const t = title.trim()
    .replace(/·/gu, " ")
    .replace(/[–—]/gu, "-")
    .replace(/[🕐⏫🔼🔽⚡❗⬜]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;
  return TEMPORAL_PATTERNS.some((re) => re.test(t));
}

/**
 * Remove tasks that are temporal containers and promote their subtasks.
 * Two-pass: first promote, then filter any remaining temporal titles.
 */
export function sanitizeTemporalTasks(tasks: ExtractedTask[]): ExtractedTask[] {
  const promoted: ExtractedTask[] = [];
  for (const task of tasks) {
    if (isTemporalTitle(task.title) && task.subtasks.length > 0) {
      for (const st of task.subtasks) {
        promoted.push({ ...task, title: st.title, subtasks: [], selected: true });
      }
    } else if (!isTemporalTitle(task.title)) {
      promoted.push(task);
    }
  }
  return promoted.filter((t) => !isTemporalTitle(t.title));
}

// ---------------------------------------------------------------------------
// DayIndex fixer — infer correct dayIndex from weekday/date
// ---------------------------------------------------------------------------

export function fixDayIndex(tasks: ExtractedTask[]): ExtractedTask[] {
  if (tasks.length === 0) return tasks;

  const uniqueIndices = new Set(tasks.map((t) => t.dayIndex));
  if (uniqueIndices.size > 1) return tasks;

  const dayKeyOrder: string[] = [];
  const dayKeyMap = new Map<string, number>();

  for (const task of tasks) {
    const key = task.date || task.weekday || null;
    if (key && !dayKeyMap.has(key)) {
      dayKeyMap.set(key, dayKeyOrder.length + 1);
      dayKeyOrder.push(key);
    }
  }

  if (dayKeyMap.size <= 1) return tasks;

  return tasks.map((t) => {
    const key = t.date || t.weekday || null;
    const newDayIndex = key ? dayKeyMap.get(key) ?? t.dayIndex : t.dayIndex;
    return { ...t, dayIndex: newDayIndex };
  });
}

// ---------------------------------------------------------------------------
// Ollama API calls
// ---------------------------------------------------------------------------

export interface OllamaConnectionResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

export async function testOllamaConnection(url: string): Promise<OllamaConnectionResult> {
  try {
    const resp = await requestUrl({
      url: `${url}/api/tags`,
      method: "GET",
      headers: { "Content-Type": "application/json" },
      throw: false,
    });
    if (resp.status !== 200) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    const data = resp.json as { models?: Array<{ name?: string }> };
    const models = data.models?.map((m) => m.name).filter((n): n is string => !!n) ?? [];
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function testOllamaModel(
  url: string,
  model: string,
): Promise<{ ok: boolean; model?: string; response?: string; error?: string }> {
  try {
    const content = await streamOllamaChat(url, model, [
      { role: "user", content: "Reply with the single word: ok" },
    ], { temperature: 0 });
    return { ok: true, model, response: content.trim().slice(0, 80) };
  } catch (e) {
    return { ok: false, model, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface StreamChatOptions {
  signal?: AbortSignal;
  onDelta?: (delta: string, full: string) => void;
  onProgress?: (stage: "connecting" | "streaming" | "fallback" | "done" | "parsing") => void;
  format?: string;
  temperature?: number;
}

export async function streamOllamaChat(
  url: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  opts: StreamChatOptions = {},
): Promise<string> {
  const body = {
    model,
    messages,
    stream: true,
    ...(opts.format ? { format: opts.format } : {}),
    options: { temperature: opts.temperature ?? 0.1 },
  };

  opts.onProgress?.("connecting");

  try {
    if (typeof fetch !== "function") throw new Error("fetch unavailable");

    const resp = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok) {
      throw new Error(`Ollama HTTP ${resp.status}`);
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (contentType.includes("application/json") && !resp.body) {
      const data = (await resp.json()) as { message?: { content?: string } };
      const content = data.message?.content ?? "";
      if (content) opts.onDelta?.(content, content);
      opts.onProgress?.("done");
      return content;
    }

    if (!resp.body) throw new Error("Empty stream body");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    let started = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!started) {
        started = true;
        opts.onProgress?.("streaming");
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as { message?: { content?: string } };
          const delta = obj.message?.content ?? "";
          if (delta) {
            full += delta;
            opts.onDelta?.(delta, full);
          }
        } catch {
          // incomplete NDJSON line
        }
      }
    }

    if (buffer.trim()) {
      try {
        const obj = JSON.parse(buffer.trim()) as { message?: { content?: string } };
        const delta = obj.message?.content ?? "";
        if (delta) {
          full += delta;
          opts.onDelta?.(delta, full);
        }
      } catch {
        /* ignore trailing garbage */
      }
    }

    opts.onProgress?.("done");
    return full;
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    opts.onProgress?.("fallback");
    const resp = await requestUrl({
      url: `${url}/api/chat`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: false }),
      throw: false,
    });
    if (resp.status !== 200) {
      throw new Error(`Ollama HTTP ${resp.status}: ${resp.text}`);
    }
    const data = resp.json as { message?: { content?: string } };
    const content = data.message?.content ?? "";
    if (content) opts.onDelta?.(content, content);
    opts.onProgress?.("done");
    return content;
  }
}

/** Build task-list context for the Q&A prompt window */
export function buildTasksContext(tasks: ExtractedTask[]): string {
  if (tasks.length === 0) return "(no tasks extracted yet)";
  return tasks
    .map((t, i) => {
      const sub =
        t.subtasks.length > 0
          ? ` [subtasks: ${t.subtasks.map((s) => s.title).join("; ")}]`
          : "";
      const time = t.scheduledTime ? ` @ ${t.scheduledTime}` : "";
      const dur = t.estimatedMinutes ? ` (~${t.estimatedMinutes}m)` : "";
      const day = t.date ? ` on ${t.date}` : ` day#${t.dayIndex}`;
      return `${i + 1}. [${t.priority}] ${t.title}${time}${dur}${day}${sub}`;
    })
    .join("\n");
}

export interface TaskEditResult {
  summary: string;
  tasks: ExtractedTask[];
}

const TASKS_EDITOR_SYSTEM = `You are a task-list assistant inside a calendar plugin.
The user may EITHER:
  1) ask you to EDIT the task list (move dates, group, reprioritize, reschedule, rename, add/remove subtasks)
  2) ask a QUESTION about the current tasks (what to do first, risks, how to plan, status of tasks)

Always work in the CONTEXT of the CURRENT task list provided below. Never ignore it.

Return ONLY valid JSON:
{
  "action": "edit" | "answer",
  "summary": "your reply in the user's language",
  "tasks": [ ...full task list... ]
}

RULES:
- If the message is an instruction to change tasks → "action": "edit", APPLY the change, set "summary" to a short confirmation of what changed, return FULL updated "tasks".
- If the message is a question → "action": "answer", set "summary" to a concise practical answer about THESE tasks (cite task numbers/titles), return "tasks" unchanged (full copy of current list).
- Return EVERY task in "tasks" (full list, not a diff) in both cases.
- Task indices are 1-based and match the provided list order.
- When the user names a calendar day ("22 числа", "22nd", "on September 22"), set "date": "YYYY-MM-DD".
- "Group all tasks in 1 day" / "сгруппируй в 1 день" → same dayIndex (1) and same date for all.
- Prefer real calendar "date" values when a concrete day is known.
- Answer in the user's language. Be concise and specific to this list.

Task schema:
{
  "title": "string",
  "description": "string|null",
  "priority": "low|medium|high",
  "estimatedMinutes": number|null,
  "dayIndex": number,
  "dayNumber": number|null,
  "weekday": "string|null",
  "date": "YYYY-MM-DD|null",
  "dayTheme": "string|null",
  "scheduledTime": "HH:MM|null",
  "subtasks": [{"title": "string"}]
}`;

export type PromptWindowResult = TaskEditResult & {
  action: "edit" | "answer";
};

export async function applyTasksInstruction(
  url: string,
  model: string,
  instruction: string,
  tasks: ExtractedTask[],
  noteSlice: string,
  weekStart: string | undefined,
  opts: StreamChatOptions = {},
): Promise<PromptWindowResult> {
  const now = new Date();
  const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDay = days[now.getDay()];

  const userContent = `Today: ${currentDate} (${currentDay})
Week start (planning): ${weekStart || currentDate}

Current tasks (1-based index) — ALWAYS answer/act in this context:
${buildTasksContext(tasks)}

Note excerpt (context):
${noteSlice.slice(0, 2500)}

User message:
${instruction}`;

  const content = await streamOllamaChat(
    url,
    model,
    [
      { role: "system", content: TASKS_EDITOR_SYSTEM },
      { role: "user", content: userContent },
    ],
    { format: "json", temperature: 0.1, ...opts },
  );

  const parsed = parseOllamaJson(content) as RawOllamaResponse & {
    summary?: string;
    action?: string;
  };

  const prevSelected = new Map<string, boolean>();
  tasks.forEach((t, i) => {
    prevSelected.set(`${t.title.toLowerCase()}|${i}`, t.selected);
    prevSelected.set(t.title.toLowerCase(), t.selected);
  });

  const { tasks: updated } = normalizeExtractedTasks(parsed);
  const withSelection = updated.map((t, i) => {
    const byKey = prevSelected.get(`${t.title.toLowerCase()}|${i}`);
    const byTitle = prevSelected.get(t.title.toLowerCase());
    return { ...t, selected: byKey ?? byTitle ?? true };
  });

  const action: "edit" | "answer" = parsed.action === "answer" ? "answer" : "edit";
  const summary =
    (parsed.summary || "").trim() ||
    (action === "answer"
      ? ""
      : withSelection.length === tasks.length
        ? `Updated ${withSelection.length} tasks`
        : `Tasks: ${tasks.length} → ${withSelection.length}`);

  return { action, summary, tasks: withSelection };
}

/** Map raw model JSON into ExtractedTask[] with enrichment + sanitization */
export function normalizeExtractedTasks(parsed: RawOllamaResponse): {
  tasks: ExtractedTask[];
  weekContext: WeekContext;
} {
  const tasks = (parsed.tasks ?? []).map((t) => {
    const base: ExtractedTask = {
      title: t.title || "Untitled task",
      description: t.description || undefined,
      priority: (["low", "medium", "high"].includes(t.priority ?? "") ? t.priority : "medium") as "low" | "medium" | "high",
      estimatedMinutes: typeof t.estimatedMinutes === "number" && t.estimatedMinutes > 0 ? t.estimatedMinutes : undefined,
      dayIndex: typeof t.dayIndex === "number" && t.dayIndex > 0 ? Math.floor(t.dayIndex) : 1,
      dayNumber: typeof t.dayNumber === "number" && t.dayNumber > 0 ? Math.floor(t.dayNumber) : undefined,
      weekday: t.weekday || undefined,
      date: t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : undefined,
      dayTheme: t.dayTheme || undefined,
      scheduledTime: t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime) ? t.scheduledTime : undefined,
      subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s.title).map((s) => ({ title: s.title })) : [],
      selected: true,
    };
    return enrichTask(base);
  });

  const weekContext: WeekContext = {
    weekStart: parsed.weekContext?.weekStart || undefined,
    weekEnd: parsed.weekContext?.weekEnd || undefined,
    weekFocus: parsed.weekContext?.weekFocus || undefined,
  };

  return {
    tasks: deduplicateTasks(fixDayIndex(sanitizeTemporalTasks(tasks))),
    weekContext,
  };
}

export interface StreamExtractionResult extends ExtractionResult {
  rawText: string;
  usedFallback: boolean;
}

export async function extractTasksFromNoteStream(
  url: string,
  model: string,
  noteContent: string,
  contextSize = 0,
  opts: StreamChatOptions = {},
  maxRetries = 1,
): Promise<StreamExtractionResult> {
  const noteSlice =
    contextSize > 0 ? sliceAtLineBoundary(noteContent, contextSize) : noteContent;
  const userPrompt = buildUserPrompt(noteSlice);

  let lastError: Error | null = null;
  let usedFallback = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let content = "";
    try {
      content = await streamOllamaChat(
        url,
        model,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        {
          format: "json",
          temperature: 0.1,
          signal: opts.signal,
          onDelta: opts.onDelta,
          onProgress: (stage) => {
            if (stage === "fallback") usedFallback = true;
            opts.onProgress?.(stage);
          },
        },
      );
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) continue;
      throw lastError;
    }

    opts.onProgress?.("parsing");
    let parsed: RawOllamaResponse;
    try {
      parsed = parseOllamaJson(content);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) continue;
      throw lastError;
    }

    const { tasks, weekContext } = normalizeExtractedTasks(parsed);
    opts.onProgress?.("done");
    return { tasks, weekContext, rawText: content, usedFallback };
  }

  throw lastError ?? new Error("Extraction failed");
}

export function distributeByDays(
  tasks: ExtractedTask[],
  startDate: string,
): Map<string, ExtractedTask[]> {
  const result = new Map<string, ExtractedTask[]>();
  const start = new Date(`${startDate}T00:00:00`);

  const byDate = new Map<string, ExtractedTask[]>();
  for (const task of tasks) {
    let dateStr: string;
    if (task.date) {
      dateStr = task.date;
    } else {
      const day = task.dayIndex || 1;
      const dayDate = new Date(start.getTime() + (day - 1) * 86400000);
      dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;
    }
    const list = byDate.get(dateStr) ?? [];
    list.push(task);
    byDate.set(dateStr, list);
  }

  for (const [dateStr, dayTasks] of byDate) {
    dayTasks.sort((a, b) => {
      const pri = { high: 0, medium: 1, low: 2 };
      const priDiff = (pri[a.priority] ?? 1) - (pri[b.priority] ?? 1);
      if (priDiff !== 0) return priDiff;
      if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
      if (a.scheduledTime) return -1;
      if (b.scheduledTime) return 1;
      return 0;
    });

    let nextMinutes = 9 * 60;
    for (const task of dayTasks) {
      if (task.scheduledTime) {
        const [h, m] = task.scheduledTime.split(":").map(Number);
        const taskEnd = h * 60 + m + (task.estimatedMinutes ?? 60);
        if (taskEnd > nextMinutes) nextMinutes = taskEnd;
      } else {
        const h = Math.floor(nextMinutes / 60);
        const m = nextMinutes % 60;
        task.scheduledTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        nextMinutes += task.estimatedMinutes ?? 60;
      }
    }

    result.set(dateStr, dayTasks);
  }

  return result;
}
