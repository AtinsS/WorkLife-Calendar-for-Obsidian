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
  dayIndex: number; // 1-based day number from the document (День 1, День 2...)
  scheduledTime?: string; // "HH:MM"
  subtasks: ExtractedSubtask[];
  selected: boolean;
}

const SYSTEM_PROMPT = `You are a task extraction assistant. Analyze the ENTIRE given note and extract ALL tasks, respecting the document's hierarchical structure.

Document structure — the document may contain ANY of these patterns:
- WEEKS: "## Неделя 1", "## Week 2", "### Неделя 1 (1–7 июня)" — top-level grouping. Tasks under a week header belong to that week.
- DAYS: "### День 1 (пн). Title — 2 ч", "### Day 3", "### День 5 (пт)" — day groups within a week or standalone.
- STANDALONE HEADERS: "### Title", "## Setup", "### Backend" — task groups without a day number.
- CHECKBOXES: "- [ ] task text" — individual tasks or subtasks.

Hierarchy rules:
- A week header resets the day counter. "Неделя 2, День 1" = absolute day 8 (week 2 × 7 + day 1 - 7).
- If there are no week headers, days are sequential: День 1 = dayIndex 1, День 2 = dayIndex 2, etc.
- If there are week headers, calculate absolute dayIndex: (weekNumber - 1) * 7 + dayNumber.
- Example: "Неделя 2, День 3" → dayIndex = (2-1)*7 + 3 = 10.
- Standalone headers without a day number get dayIndex based on their position in the document (increment from previous).

Task extraction:
- Each H2/H3 header becomes a task. The header text = TITLE.
- Extract time from header (e.g. "2 ч" = 120 min, "30 мин" = 30 min, "1.5 ч" = 90 min).
- Text immediately below the header (before the first checkbox) = DESCRIPTION.
- Checkbox items (- [ ]) under a header = SUBTASKS of that parent task.
- Nested checkboxes (indented) are also subtasks.
- If there are no headers, treat each checkbox as an independent task.

Scheduling rules:
- If the text explicitly mentions a time (e.g. "14:00", "с 10:00 до 12:00"), set scheduledTime as "HH:MM".
- If NO time is mentioned, leave scheduledTime as null. Do NOT invent times.

Priority rules:
- Tasks with deadlines or urgent words → "high"
- Important but not urgent → "medium"
- Nice to have → "low"

Respond with valid JSON only, no markdown fences:
{
  "tasks": [
    {
      "title": "Task title from header",
      "description": "What to do (text below header)",
      "priority": "medium",
      "estimatedMinutes": 120,
      "dayIndex": 1,
      "scheduledTime": "09:00",
      "subtasks": [
        { "title": "checkbox item 1" },
        { "title": "checkbox item 2" }
      ]
    }
  ]
}`;

export async function testOllamaConnection(
  url: string,
): Promise<{ ok: boolean; models?: string[]; error?: string }> {
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
    const data = resp.json as { models?: Array<{ name: string }> };
    const models = data.models?.map((m) => m.name) ?? [];
    return { ok: true, models };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Send a test prompt to verify the model works and identify itself */
export async function testOllamaModel(
  url: string,
  model: string,
): Promise<{ ok: boolean; response?: string; model?: string; error?: string }> {
  try {
    const resp = await requestUrl({
      url: `${url}/api/chat`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "user", content: "Reply with exactly: Hello from [your model name]. Nothing else." },
        ],
        stream: false,
      }),
      throw: false,
    });
    if (resp.status !== 200) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    const data = resp.json as { message?: { content?: string }; model?: string };
    const response = data.message?.content?.trim() ?? "";
    return { ok: true, response, model: data.model || model };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function extractTasksFromNote(
  url: string,
  model: string,
  noteContent: string,
  contextSize = 0,
): Promise<ExtractedTask[]> {
  const noteSlice = contextSize > 0 ? noteContent.slice(0, contextSize) : noteContent;
  const userPrompt = `Extract tasks from this note:\n\n${noteSlice}`;

  const resp = await requestUrl({
    url: `${url}/api/chat`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      stream: false,
      format: "json",
      options: { temperature: 0.2 },
    }),
    throw: false,
  });

  if (resp.status !== 200) {
    throw new Error(`Ollama HTTP ${resp.status}: ${resp.text}`);
  }

  const data = resp.json as { message?: { content?: string } };
  const content = data.message?.content ?? "";

  let parsed: { tasks?: Array<{
    title: string;
    description?: string;
    priority?: string;
    estimatedMinutes?: number;
    dayIndex?: number;
    scheduledTime?: string;
    subtasks?: Array<{ title: string }>;
  }> };
  try {
    parsed = JSON.parse(content);
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("Invalid response format from Ollama");
    }
  }

  const tasks = parsed.tasks ?? [];
  return tasks.map((t) => ({
    title: t.title || "Untitled task",
    description: t.description || undefined,
    priority: (["low", "medium", "high"].includes(t.priority ?? "") ? t.priority : "medium") as "low" | "medium" | "high",
    estimatedMinutes: typeof t.estimatedMinutes === "number" && t.estimatedMinutes > 0 ? t.estimatedMinutes : undefined,
    dayIndex: typeof t.dayIndex === "number" && t.dayIndex > 0 ? Math.floor(t.dayIndex) : 1,
    scheduledTime: t.scheduledTime && /^\d{2}:\d{2}$/.test(t.scheduledTime) ? t.scheduledTime : undefined,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter((s) => s.title).map((s) => ({ title: s.title })) : [],
    selected: true,
  }));
}

export function distributeByDays(
  tasks: ExtractedTask[],
  startDate: string,
): Map<string, ExtractedTask[]> {
  const result = new Map<string, ExtractedTask[]>();
  const start = new Date(`${startDate}T00:00:00`);

  // Group tasks by dayIndex
  const byDay = new Map<number, ExtractedTask[]>();
  for (const task of tasks) {
    const day = task.dayIndex || 1;
    const list = byDay.get(day) ?? [];
    list.push(task);
    byDay.set(day, list);
  }

  // For each day, auto-schedule times if not already set
  for (const [dayIdx, dayTasks] of byDay) {
    // Sort by priority then by scheduledTime
    dayTasks.sort((a, b) => {
      const pri = { high: 0, medium: 1, low: 2 };
      const priDiff = (pri[a.priority] ?? 1) - (pri[b.priority] ?? 1);
      if (priDiff !== 0) return priDiff;
      if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
      if (a.scheduledTime) return -1;
      if (b.scheduledTime) return 1;
      return 0;
    });

    // Auto-fill missing scheduledTime: start at 09:00, stack sequentially
    let nextMinutes = 9 * 60; // 09:00 in minutes
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

    // Calculate the actual date for this dayIndex
    const dayDate = new Date(start.getTime() + (dayIdx - 1) * 86400000);
    const dateStr = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, "0")}-${String(dayDate.getDate()).padStart(2, "0")}`;

    result.set(dateStr, dayTasks);
  }

  return result;
}
