import type { App } from "obsidian";
import { TFile as TFileClass, normalizePath } from "obsidian";
import { get } from "svelte/store";
import { tRaw } from "../i18n";
import {
  addTask,
  projects as projectsStore,
  tasks as tasksStore,
  updateTask,
  updateTaskStatus,
} from "../task-tracker/stores";
import type { ITask, TaskStatus } from "../task-tracker/types";
import type { AiToolCall, AiToolDefinition } from "./aiProvider";
import { extractDateFromUID, fmtDate, setDateUID } from "./aiScheduleOps";
import { normalizeAiDate, normalizeAiMinutes, normalizeAiTime } from "./aiQuickAdd";

const MAX_TOOL_OUTPUT = 6000;
const MAX_NOTE_CHARS = 4000;
const MAX_SEARCH_RESULTS = 10;
const MAX_CONTENT_SCANNED = 150;

/** Result fed back to the model; `notice` is the short localized toast for the user. */
export interface ChatToolResult {
  output: string;
  notice?: string;
}

const TASK_STATUS_VALUES: TaskStatus[] = ["todo", "progress", "done", "paused", "failed"];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asPriority(v: unknown): "low" | "medium" | "high" | null {
  const s = str(v).toLowerCase();
  return s === "low" || s === "medium" || s === "high" ? s : null;
}

function asStatus(v: unknown): TaskStatus | null {
  const s = str(v).toLowerCase();
  return (TASK_STATUS_VALUES as string[]).includes(s) ? (s as TaskStatus) : null;
}

/** Resolve a task by exact id, exact title, then unique title substring. */
function findTask(query: string): ITask | null {
  const q = query.trim();
  if (!q) return null;
  const all = get(tasksStore);
  const lower = q.toLowerCase();
  const exactId = all.find((t) => t.id === q);
  if (exactId) return exactId;
  const exactTitle = all.filter((t) => t.title.toLowerCase() === lower);
  if (exactTitle.length === 1) return exactTitle[0];
  const partial = all.filter((t) => t.title.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  return null;
}

function resolveProjectId(name: string): string | null {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  return get(projectsStore).find((p) => p.name.toLowerCase() === q)?.id ?? null;
}

function fmtTaskLine(t: ITask): string {
  const date = extractDateFromUID(t.dateUID) || "?";
  const time = t.scheduledTime
    ? t.endTime
      ? `${t.scheduledTime}-${t.endTime}`
      : t.scheduledTime
    : "-";
  return `- id=${t.id} | ${date} ${time} | ${t.status} | prio=${t.priority} | ${t.title}`;
}

/**
 * Tools the chat model may call (function-calling). Descriptions are English on
 * purpose — they steer the model; user-facing text is localized separately.
 */
export const CHAT_TOOLS: AiToolDefinition[] = [
  {
    name: "create_task",
    description:
      "Create a task in the user's task tracker / calendar. Call when the user asks to add, schedule or plan something. Today is injected in the system prompt; use YYYY-MM-DD for the date field.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title" },
        date: {
          type: "string",
          description: "Due date YYYY-MM-DD. Omit for today.",
        },
        scheduledTime: { type: "string", description: "Start time HH:MM (24h), optional" },
        endTime: { type: "string", description: "End time HH:MM (24h), optional" },
        estimatedMinutes: { type: "number", description: "Estimated duration in minutes, optional" },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Default medium" },
        description: { type: "string", description: "Longer task description, optional" },
        project: { type: "string", description: "Existing project name, optional" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks from the task tracker. Use before scheduling to see what is already planned, or when the user asks what is on a day. Returns one line per task with its id.",
    parameters: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "YYYY-MM-DD inclusive, optional" },
        dateTo: { type: "string", description: "YYYY-MM-DD inclusive, optional" },
        status: {
          type: "string",
          enum: ["todo", "progress", "done", "paused", "failed"],
          description: "Filter by status, optional",
        },
        limit: { type: "number", description: "Max rows, default 30" },
      },
      required: [],
    },
  },
  {
    name: "update_task",
    description:
      "Update an existing task: move its date, change time, status, priority, title or description. taskId accepts the exact id from list_tasks, or a unique title. Prefer this over creating a duplicate task.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task id or unique title" },
        title: { type: "string", description: "New title" },
        status: {
          type: "string",
          enum: ["todo", "progress", "done", "paused", "failed"],
          description: "New status",
        },
        date: { type: "string", description: "New date YYYY-MM-DD" },
        scheduledTime: { type: "string", description: "New start time HH:MM" },
        endTime: { type: "string", description: "New end time HH:MM" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        description: { type: "string", description: "New description" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "search_notes",
    description:
      "Search the user's markdown notes by name (and content for short vaults). Returns matching note paths. Follow up with read_note to get the content.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or text to look for" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_note",
    description:
      "Read a markdown note from the vault. Accepts a full path from search_notes or a unique note title. Content is truncated if very long.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Note path or unique title" },
      },
      required: ["path"],
    },
  },
  {
    name: "create_note",
    description:
      "Create a new markdown note in the vault, optionally inside a specific folder (the folder is created when missing). Use when the user asks to write something down as a note.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title (file name without .md)" },
        folder: {
          type: "string",
          description: "Vault folder path like 'Projects/Work'. Omit for the vault root.",
        },
        content: { type: "string", description: "Note body in markdown. Omit for an empty note." },
      },
      required: ["title"],
    },
  },
  {
    name: "append_note",
    description:
      "Append text to the end of an existing markdown note. Accepts a full path or a unique note title. Errors when the note does not exist — use create_note first.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Note path or unique title" },
        content: { type: "string", description: "Text to append (markdown)" },
      },
      required: ["path", "content"],
    },
  },
];

function truncate(text: string, max = MAX_TOOL_OUTPUT): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

function createTaskTool(args: Record<string, unknown>): ChatToolResult {
  const title = str(args.title);
  if (!title) return { output: "Error: title is required" };
  const date = normalizeAiDate(args.date) ?? fmtDate(new Date());
  const scheduledTime = normalizeAiTime(args.scheduledTime ?? args.start) ?? undefined;
  let endTime = normalizeAiTime(args.endTime ?? args.end) ?? undefined;
  const estimatedMinutes = normalizeAiMinutes(args.estimatedMinutes ?? args.estimated);
  const priority = asPriority(args.priority) ?? "medium";
  const description = str(args.description) || undefined;
  const projectId = resolveProjectId(str(args.project ?? args.projectName));
  if (!endTime && scheduledTime && estimatedMinutes) {
    const [h, m] = scheduledTime.split(":").map(Number);
    const total = (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0) + estimatedMinutes;
    endTime = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  const created = addTask({
    title,
    description,
    completed: false,
    status: "todo",
    dateUID: `day-${date}`,
    projectId,
    priority,
    sortOrder: 0,
    scheduledTime,
    endTime,
    estimatedTime: estimatedMinutes ?? undefined,
  });
  return {
    output: `Created task: ${fmtTaskLine(created)}`,
    notice: tRaw("ai.tools.taskCreated", { title: created.title }),
  };
}

function listTasksTool(args: Record<string, unknown>): ChatToolResult {
  const dateFrom = normalizeAiDate(args.dateFrom);
  const dateTo = normalizeAiDate(args.dateTo);
  const status = asStatus(args.status);
  const limit = Math.max(1, Math.min(100, num(args.limit) ?? 30));

  let list = [...get(tasksStore)];
  if (status) list = list.filter((t) => t.status === status);
  if (dateFrom || dateTo) {
    list = list.filter((t) => {
      const d = extractDateFromUID(t.dateUID);
      if (!d) return false;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }
  list.sort((a, b) => {
    const da = extractDateFromUID(a.dateUID) || "";
    const db = extractDateFromUID(b.dateUID) || "";
    if (da !== db) return da < db ? -1 : 1;
    return (a.scheduledTime || "").localeCompare(b.scheduledTime || "");
  });

  const total = list.length;
  const shown = list.slice(0, limit);
  if (total === 0) return { output: "No tasks match the filter." };
  const head = `Tasks: ${total} matching, showing ${shown.length}. Today: ${fmtDate(new Date())}`;
  return { output: truncate([head, ...shown.map(fmtTaskLine)].join("\n")) };
}

function updateTaskTool(args: Record<string, unknown>): ChatToolResult {
  const query = str(args.taskId);
  const task = findTask(query);
  if (!task) return { output: `Error: no task matches "${query}"` };

  const patch: Partial<ITask> = {};
  const title = str(args.title);
  if (title) patch.title = title;
  const status = asStatus(args.status);
  const date = normalizeAiDate(args.date);
  if (date) {
    patch.dateUID = setDateUID(task.dateUID, date) ?? `day-${date}`;
  }
  const scheduledTime = args.scheduledTime !== undefined ? normalizeAiTime(args.scheduledTime) : undefined;
  if (args.scheduledTime !== undefined) patch.scheduledTime = scheduledTime ?? undefined;
  if (args.endTime !== undefined) patch.endTime = normalizeAiTime(args.endTime) ?? undefined;
  const priority = asPriority(args.priority);
  if (priority) patch.priority = priority;
  if (args.description !== undefined) patch.description = str(args.description) || undefined;

  if (Object.keys(patch).length === 0 && !status) {
    return { output: "Error: nothing to update — pass at least one changed field" };
  }

  if (Object.keys(patch).length > 0) updateTask(task.id, patch);
  if (status) updateTaskStatus(task.id, status, { autoStartTimer: false });

  const after = get(tasksStore).find((t) => t.id === task.id) ?? task;
  return {
    output: `Updated task: ${fmtTaskLine(after)}`,
    notice: tRaw("ai.tools.taskUpdated", { title: after.title }),
  };
}

async function searchNotesTool(app: App, args: Record<string, unknown>): Promise<ChatToolResult> {
  const query = str(args.query).toLowerCase();
  if (!query) return { output: "Error: query is required" };
  const files = app.vault.getMarkdownFiles();
  const byName = files.filter((f) => f.basename.toLowerCase().includes(query));
  const results: typeof byName = [];
  const seen = new Set<string>();
  for (const f of byName.slice(0, MAX_SEARCH_RESULTS)) {
    seen.add(f.path);
    results.push(f);
  }
  // Content scan only on smaller vaults — reading hundreds of notes is slow.
  if (results.length < MAX_SEARCH_RESULTS && files.length <= MAX_CONTENT_SCANNED) {
    const recent = files
      .slice()
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, MAX_CONTENT_SCANNED);
    for (const f of recent) {
      if (results.length >= MAX_SEARCH_RESULTS) break;
      if (seen.has(f.path)) continue;
      try {
        const text = (await app.vault.cachedRead(f)).toLowerCase();
        if (text.includes(query)) {
          seen.add(f.path);
          results.push(f);
        }
      } catch {
        /* skip unreadable */
      }
    }
  }
  if (results.length === 0) return { output: `No notes match "${query}".` };
  return {
    output: [`Notes matching "${query}":`, ...results.map((f) => `- ${f.path}`)].join("\n"),
  };
}

function findNote(app: App, raw: string): TFileClass | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  const files = app.vault.getMarkdownFiles();
  const norm = normalizePath(raw.trim());
  const byPath = files.find((f) => f.path === norm || f.path.toLowerCase() === q);
  if (byPath) return byPath;
  const exact = files.filter((f) => f.basename.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const partial = files.filter((f) => f.basename.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  return null;
}

async function readNoteTool(app: App, args: Record<string, unknown>): Promise<ChatToolResult> {
  const query = str(args.path);
  const file = findNote(app, query);
  if (!file) return { output: `Error: no note matches "${query}"` };
  try {
    const content = await app.vault.cachedRead(file);
    return { output: truncate(`### ${file.path}\n${content.slice(0, MAX_NOTE_CHARS)}`) };
  } catch (e) {
    return {
      output: `Error reading ${file.path}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Vault folder names can't contain these (plus path separators handled apart). */
function safeNoteTitle(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Create every missing folder segment along `folder` (nested paths supported). */
async function ensureFolder(app: App, folder: string): Promise<void> {
  const parts = folder.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const norm = normalizePath(current);
    if (!app.vault.getAbstractFileByPath(norm)) {
      try {
        await app.vault.createFolder(norm);
      } catch {
        /* raced into existence — fine */
      }
    }
  }
}

async function createNoteTool(app: App, args: Record<string, unknown>): Promise<ChatToolResult> {
  const titleRaw = str(args.title);
  if (!titleRaw) return { output: "Error: title is required" };
  const title = safeNoteTitle(titleRaw) || "Untitled";
  const folder = str(args.folder).replace(/^\/+|\/+$/g, "");
  const path = normalizePath(folder ? `${folder}/${title}.md` : `${title}.md`);
  if (app.vault.getAbstractFileByPath(path)) {
    return { output: `Error: note already exists: ${path}` };
  }
  try {
    if (folder) await ensureFolder(app, folder);
    const body = str(args.content);
    const file = await app.vault.create(path, body ? `${body}\n` : "");
    return {
      output: `Created note: ${file.path}`,
      notice: tRaw("ai.tools.noteCreated", { title: file.path }),
    };
  } catch (e) {
    return { output: `Error creating ${path}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function appendNoteTool(app: App, args: Record<string, unknown>): Promise<ChatToolResult> {
  const query = str(args.path);
  const content = str(args.content);
  if (!content) return { output: "Error: content is required" };
  const file = findNote(app, query);
  if (!file) {
    return {
      output: `Error: no note matches "${query}" — create it first with create_note`,
    };
  }
  try {
    const prev = await app.vault.read(file);
    const sep = prev && !prev.endsWith("\n") ? "\n" : "";
    await app.vault.modify(file, `${prev}${sep}${content}\n`);
    return {
      output: `Appended to note: ${file.path}`,
      notice: tRaw("ai.tools.noteAppended", { title: file.path }),
    };
  } catch (e) {
    return { output: `Error appending to ${file.path}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Execute one tool call. Never throws — errors go back to the model as text. */
export async function executeChatTool(app: App, call: AiToolCall): Promise<ChatToolResult> {
  const args = call.args ?? {};
  try {
    switch (call.name) {
      case "create_task":
        return createTaskTool(args);
      case "list_tasks":
        return listTasksTool(args);
      case "update_task":
        return updateTaskTool(args);
      case "search_notes":
        return searchNotesTool(app, args);
      case "read_note":
        return readNoteTool(app, args);
      case "create_note":
        return createNoteTool(app, args);
      case "append_note":
        return appendNoteTool(app, args);
      default:
        return { output: `Error: unknown tool "${call.name}"` };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { output: `Error running ${call.name}: ${msg}` };
  }
}
