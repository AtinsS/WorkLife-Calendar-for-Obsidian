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

TWO KNOWN FORMATS — do not mix them:

FORMAT A — STUDY/WORK PLAN (theme per day).
Heading IS the main task. Checklist items under it are SUBTASKS, not independent tasks.
INPUT:
### День 1 (пн). PostgreSQL + Prisma + Workspace — 2 ч
**Что делаем:** настраиваем базу данных и описываем модели.
- [ ] docker-compose.yml с PostgreSQL 16
- [ ] .env с DATABASE_URL
    - Workspace — id, name, apiKey
    - Operator — id, email
- [ ] npx prisma init

OUTPUT (one task + nested subtasks; duration from heading → estimatedMinutes):
{"title": "PostgreSQL + Prisma + Workspace", "description": "настраиваем базу данных и описываем модели.", "estimatedMinutes": 120, "dayIndex": 1, "weekday": "Понедельник", "subtasks": [{"title": "docker-compose.yml с PostgreSQL 16"}, {"title": ".env с DATABASE_URL"}, {"title": "Workspace — id, name, apiKey"}, {"title": "Operator — id, email"}, {"title": "npx prisma init"}]}

FORMAT B — DAILY NOTES (day headers + independent checklist lines).
Day header is NEVER a task. Each checkbox/emoji line is an INDEPENDENT task.
INPUT:
## 📅 Понедельник (21.09)
- [ ] 🔴 Созвон с командой в 10:00 — обсудить ТЗ лендинга
- [ ] 🟡 Набросать структуру статьи
- [ ] 🟢 Утренние страницы (15 мин)

OUTPUT (flat tasks; 🔴=high 🟡=medium 🟢=low; "в 10:00" → scheduledTime):
{"tasks": [
  {"title": "Созвон с командой — обсудить ТЗ лендинга", "priority": "high", "scheduledTime": "10:00", "dayIndex": 1, "date": "2025-09-21", "weekday": "Понедельник", "subtasks": []},
  {"title": "Набросать структуру статьи", "priority": "medium", "dayIndex": 1, "date": "2025-09-21", "weekday": "Понедельник", "subtasks": []},
  {"title": "Утренние страницы", "priority": "low", "estimatedMinutes": 15, "dayIndex": 1, "date": "2025-09-21", "weekday": "Понедельник", "subtasks": []}
]}

RULES:
- Detect format first. Format A: heading=task, nested list=subtasks. Format B: each line=task.
- Each day/date section gets an INCREMENTING dayIndex (1, 2, 3...).
- Do NOT turn day headers (Понедельник, День 1, 📅 Вторник) into tasks in Format B.
- In Format A do NOT flatten the theme heading into its subtasks — keep the heading as the parent task.
- Strip markers (🕐 ⏫ 🔼 🔽 🔴 🟡 🟢) into fields. "в 10:00" / "10:00–13:00" → scheduledTime + estimatedMinutes.
- "— 2 ч", "(15 мин)", "2 часа" in heading/line → estimatedMinutes.

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
// Structured note parser — deterministic dual-format extraction (fast path)
// ---------------------------------------------------------------------------

export type NoteFormat = "study-plan" | "daily-list" | "unknown";

const DAY_NAME_RU = "понедельник|вторник|среда|четверг|пятница|суббота|воскресенье";
const DAY_NAME_EN = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

const WEEKDAY_TO_NUM: Record<string, number> = {
  "воскресенье": 0, "sunday": 0, "вс": 0,
  "понедельник": 1, "monday": 1, "пн": 1,
  "вторник": 2, "tuesday": 2, "вт": 2,
  "среда": 3, "wednesday": 3, "ср": 3,
  "четверг": 4, "thursday": 4, "чт": 4,
  "пятница": 5, "friday": 5, "пт": 5,
  "суббота": 6, "saturday": 6, "сб": 6,
};

const WEEKDAY_LABEL_RU: Record<number, string> = {
  0: "Воскресенье", 1: "Понедельник", 2: "Вторник", 3: "Среда",
  4: "Четверг", 5: "Пятница", 6: "Суббота",
};

/** Detect which of the two known note shapes this document uses. */
export function detectNoteFormat(content: string): NoteFormat {
  const studyDay = (content.match(new RegExp(`^#{1,6}\\s*(?:день|day)\\s*\\d+`, "gim")) ?? []).length;
  const dailyDay = (
    content.match(
      new RegExp(`^(?:#{1,6}\\s*)?(?:📅\\s*)?(?:${DAY_NAME_RU}|${DAY_NAME_EN})\\s*(?:\\(|$)`, "gim"),
    ) ?? []
  ).length;
  const checkboxLines = (content.match(/^\s*[-*]\s*\[[ xX]?\]/gm) ?? []).length;
  const emojiTasks = (content.match(/^\s*[-*]?\s*[🔴🟡🟢]/gmu) ?? []).length;
  const plainList = (content.match(/^\s*[-*]\s+\S/gm) ?? []).length;

  if (studyDay > 0 && (checkboxLines > 0 || plainList > 0)) {
    // Theme days with checklist body → study plan wins even if day names appear
    return "study-plan";
  }
  if (dailyDay > 0 && (emojiTasks > 0 || checkboxLines > 0)) {
    return "daily-list";
  }
  if (studyDay > 0) return "study-plan";
  if (dailyDay > 0) return "daily-list";
  return "unknown";
}

function makeDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateToken(monthDay: string, yearHint?: string): string | null {
  const m = monthDay.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (!m) return null;
  const now = new Date();
  let year = yearHint ? parseInt(yearHint) : (m[3] ? parseInt(m[3]) : now.getFullYear());
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const month = parseInt(m[2]);
  const day = parseInt(m[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return makeDate(year, month, day);
}

function weekdayFromDate(dateStr: string): { weekday: string; dayIndexNum: number } | null {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const n = d.getDay();
  return { weekday: WEEKDAY_LABEL_RU[n], dayIndexNum: n };
}

function emojiPriority(text: string): "low" | "medium" | "high" {
  if (/🔴/.test(text)) return "high";
  if (/🟢/.test(text)) return "low";
  return "medium";
}

function cleanLineText(text: string): string {
  return text
    .replace(/^\s*\[[ xX]?\]\s*/, "")
    .replace(/[🔴🟡🟢📅✅☑☐✔🕐⏫🔼🔽⚡❗⬜]\s*/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface StructuredParse {
  format: NoteFormat;
  tasks: ExtractedTask[];
  weekContext: WeekContext;
}

/**
 * FORMAT A — `### День 1 (пн). Title — 2 ч` is ONE task;
 * `- [ ]` / nested bullets under it are subtasks (not free tasks).
 */
function parseStudyPlan(content: string): ExtractedTask[] {
  const lines = content.split(/\r?\n/);
  const tasks: ExtractedTask[] = [];
  let daySeq = 0;
  let current: ExtractedTask | null = null;
  let lastSubtaskIndent = 0;

  const dayHead = new RegExp(
    `^(#{1,6})\\s*(?:день|day)\\s*(\\d+)\\s*(?:\\(\\s*([^)]+?)\\s*\\))?\\s*[.:=\\-–—]?\\s*(.*)$`,
    "i",
  );
  const listRe = /^(\s*)([-*+]|\d+\.)\s+(?:\[[ xX]?\]\s*)?(.*)$/;

  const pushCurrent = () => {
    if (current) {
      current.subtasks = current.subtasks.filter((s) => s.title.length > 0);
      tasks.push(current);
      current = null;
    }
  };

  for (const raw of lines) {
    const head = raw.match(dayHead);
    if (head) {
      pushCurrent();
      daySeq += 1;
      const dayNumber = parseInt(head[2], 10);
      const abbrOrName = (head[3] || "").toLowerCase().trim();
      let rest = (head[4] || "").trim();

      // Split trailing duration: "— 2 ч" / "- 30 мин" / "(2 часа)"
      let estimatedMinutes: number | undefined;
      const dur = rest.match(/\s*[–\-—(]\s*(\d+(?:[.,]\d+)?)\s*(мин|min|час(?:а|ов)?|ч|h|hr|hour)\s*\)?\s*$/i);
      if (dur) {
        const n = parseFloat(dur[1].replace(",", "."));
        estimatedMinutes = /^(мин|min)/i.test(dur[2]) ? Math.round(n) : Math.round(n * 60);
        rest = rest.slice(0, dur.index).trim();
      }

      const weekdayNum = WEEKDAY_TO_NUM[abbrOrName];
      const weekday = weekdayNum != null ? WEEKDAY_LABEL_RU[weekdayNum] : abbrOrName
        ? abbrOrName.charAt(0).toUpperCase() + abbrOrName.slice(1)
        : undefined;

      current = {
        title: rest || `День ${dayNumber}`,
        description: undefined,
        priority: "medium",
        estimatedMinutes,
        dayIndex: daySeq,
        dayNumber,
        weekday,
        subtasks: [],
        selected: true,
      };
      lastSubtaskIndent = 0;
      continue;
    }

    if (!current) continue;

    // Description block: **Что делаем:** … / **Что делаем** …
    const desc = raw.match(/^\s*(?:\*\*)?\s*(?:что\s+делаем|описание|goal|описание\s+дня)\s*(?:\*\*)?\s*[.:–—-]?\s*(.+)$/i);
    if (desc) {
      current.description = desc[1].replace(/\*\*/g, "").trim();
      continue;
    }

    const li = raw.match(listRe);
    if (li) {
      const indent = li[1].replace(/\t/g, "  ").length;
      const text = cleanLineText(li[3] || "");
      if (!text) continue;
      if (!current.subtasks) current.subtasks = [];
      current.subtasks.push({ title: text });
      lastSubtaskIndent = indent;
      continue;
    }

    // Indented continuation without bullet → detail of last subtask
    const cont = raw.match(/^(\s{2,})\S/);
    if (cont && current.subtasks.length > 0 && cont[1].replace(/\t/g, "  ").length > lastSubtaskIndent) {
      const text = cleanLineText(raw);
      if (text) {
        const last = current.subtasks[current.subtasks.length - 1];
        last.title = `${last.title} ${text}`;
      }
    }
  }
  pushCurrent();
  return tasks.filter((t) => t.title.length > 0);
}

/**
 * FORMAT B — `## 📅 Понедельник (21.09)` starts a day; each `- [ ] 🔴 …`
 * line is an independent task (header is never a task).
 */
function parseDailyList(content: string): { tasks: ExtractedTask[]; weekContext: WeekContext } {
  const lines = content.split(/\r?\n/);
  const tasks: ExtractedTask[] = [];
  const dates: string[] = [];
  let daySeq = 0;
  let currentDate: string | undefined;
  let currentWeekday: string | undefined;
  let currentDayNumber: number | undefined;

  const dayHead = new RegExp(
    `^(#{1,6}\\s*)?(?:📅\\s*)?(${DAY_NAME_RU}|${DAY_NAME_EN})\\s*(?:\\(\\s*(\\d{1,2}\\.\\d{1,2}(?:\\.\\d{2,4})?)\\s*\\))?.*$`,
    "i",
  );
  const listRe = /^(\s*)([-*+]|\d+\.)\s+(?:\[[ xX]?\]\s*)?(.*)$/;

  for (const raw of lines) {
    const head = raw.match(dayHead);
    // Only treat as day header if the line is mostly the day name (not a task line)
    if (head && !/^\s*[-*+]\s/.test(raw) && (head[3] || head[1] || /^\s*(?:📅|#)/.test(raw) || new RegExp(`^(${DAY_NAME_RU}|${DAY_NAME_EN})`, "i").test(raw.trim()))) {
      const isTaskish = /\[[ xX]\]|🔴|🟡|🟢/.test(raw) && raw.includes("—") && !head[3];
      if (!isTaskish) {
        daySeq += 1;
        const nameKey = (head[2] || "").toLowerCase();
        const parsedDate = head[3] ? parseDateToken(head[3]) : undefined;
        if (parsedDate) dates.push(parsedDate);
        const wd = weekdayFromDate(parsedDate ?? "");
        currentWeekday = wd?.weekday ?? WEEKDAY_LABEL_RU[WEEKDAY_TO_NUM[nameKey] ?? -1];
        currentDate = parsedDate;
        currentDayNumber = WEEKDAY_TO_NUM[nameKey] != null ? WEEKDAY_TO_NUM[nameKey] + 1 : daySeq;
        continue;
      }
    }

    if (daySeq === 0) continue;

    const li = raw.match(listRe);
    const body = li ? li[3] || "" : /^\s*[🔴🟡🟢]/u.test(raw) ? raw.trim() : "";
    if (!body) continue;

    let title = cleanLineText(body);
    // Strip inline time "в 10:00" / "10:00–11:00"
    let scheduledTime: string | undefined;
    let estimatedMinutes: number | undefined;
    const range = parseTimeRange(title);
    if (range) {
      scheduledTime = range.start;
      estimatedMinutes = range.minutes;
      title = stripTimeFromTitle(title);
    } else {
      const single = parseSingleTime(title);
      if (single) {
        scheduledTime = single;
        title = stripTimeFromTitle(title);
      }
    }
    const dur = parseDurationHint(title);
    if (dur && !estimatedMinutes) {
      estimatedMinutes = dur;
      title = title.replace(/\s*\(?\s*\d+\s*(?:мин|min|час(?:а|ов)?|ч|h)\s*\)?\s*$/i, "").trim();
    }
    const priority = emojiPriority(body);

    tasks.push({
      title: title || "Задача",
      priority,
      estimatedMinutes,
      dayIndex: daySeq,
      dayNumber: currentDayNumber,
      weekday: currentWeekday,
      date: currentDate,
      scheduledTime,
      subtasks: [],
      selected: true,
    });
  }

  dates.sort();
  const weekContext: WeekContext = {
    weekStart: dates[0],
    weekEnd: dates[dates.length - 1],
  };
  return { tasks, weekContext };
}

/**
 * Deterministic extract for the two known note shapes.
 * Returns null when the note does not match — caller falls back to the LLM.
 */
export function parseStructuredNote(content: string): StructuredParse | null {
  const format = detectNoteFormat(content);
  if (format === "study-plan") {
    const tasks = parseStudyPlan(content);
    if (tasks.length === 0) return null;
    return { format, tasks: tasks.map((t) => enrichTask(t)), weekContext: {} };
  }
  if (format === "daily-list") {
    const { tasks, weekContext } = parseDailyList(content);
    if (tasks.length === 0) return null;
    return { format, tasks: tasks.map((t) => enrichTask(t)), weekContext };
  }
  return null;
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
  const mHour = text.match(/(\d+(?:[.,]\d+)?)\s*(?:час(?:а|ов)?|ч|h|hr|hour)\b/i);
  if (mHour) return Math.round(parseFloat(mHour[1].replace(",", ".")) * 60);
  return null;
}

function stripTimeFromTitle(title: string): string {
  return title
    .replace(/🕐\s*\d{1,2}:\d{2}\s*[–\-—]\s*\d{1,2}:\d{2}/gu, "")
    .replace(/🕐\s*\d{1,2}:\d{2}/gu, "")
    .replace(/\b[вс]\s+\d{1,2}:\d{2}\s*[–\-—]\s*\d{1,2}:\d{2}/giu, "")
    .replace(/\b[вс]\s+\d{1,2}:\d{2}/giu, "")
    .replace(/\s*\d{1,2}:\d{2}\s*[–\-—]\s*\d{1,2}:\d{2}\s*$/u, "")
    .replace(/\s*\d{1,2}:\d{2}\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripPriorityFromTitle(title: string): string {
  return title
    .replace(/[⏫🔼🔽⚡❗⬜🔴🟡🟢]\s*/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPriorityFromTitle(title: string): "low" | "medium" | "high" | null {
  if (/⏫|⚡|❗|🔴/.test(title)) return "high";
  if (/🔽|🟢/.test(title)) return "low";
  if (/🟡/.test(title)) return "medium";
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

/**
 * Check if a title is purely temporal (a day/date container, not a task).
 * "Понедельник (21.09)" → true.
 * "День 1 (пн). PostgreSQL + Prisma — 2 ч" → false (real themed task).
 */
export function isTemporalTitle(title: string): boolean {
  let t = title.trim()
    .replace(/·/gu, " ")
    .replace(/[–—]/gu, "-")
    .replace(/[🕐⏫🔼🔽⚡❗⬜🔴🟡🟢📅✅☑☐✔]/gu, "")
    .replace(/←\s*сегодня/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return true;

  t = t
    .replace(/(?<!\p{L})(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?!\p{L})/giu, " ")
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, " ")
    .replace(/(?<!\p{L})(пн|вт|ср|чт|пт|сб|вс)(?!\p{L})/giu, " ")
    .replace(/(?<!\p{L})(день|day)\s*\d+/giu, " ")
    .replace(/(?<!\p{L})(недел[яьие]|week)\s*\d*/giu, " ")
    .replace(/(?<!\p{L})(январь|февраль|март|апрель|май|июнь|июль|август|сентябрь|октябрь|ноябрь|декабрь)(?!\p{L})/giu, " ")
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, " ")
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:мин|min|час(?:а|ов)?|ч|h|hr|hour)\b/giu, " ")
    .replace(/\b\d{1,2}:\d{2}([–-]\d{1,2}:\d{2})?\b/g, " ")
    .replace(/(?<!\p{L})(утро|утром|день|днём|вечер|вечером|ночь|ночью|до обеда|после обеда)(?!\p{L})/giu, " ")
    // dates last so "26.09" / "21.09.2025" are not left behind after dashes
    .replace(/\b\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\b/g, " ")
    .replace(/[()«»"'.,:;!?*#|`+/#\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length === 0;
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

  // Fast path: well-known study-plan / daily-notes shapes parse without LLM
  const structured = parseStructuredNote(noteSlice);
  if (structured && structured.tasks.length > 0) {
    opts.onProgress?.("parsing");
    const normalized = normalizeExtractedTasks({
      tasks: structured.tasks,
      weekContext: structured.weekContext,
    });
    return {
      tasks: normalized.tasks,
      weekContext: normalized.weekContext,
      rawText: "",
      usedFallback: false,
    };
  }

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
