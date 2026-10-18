import { get } from "svelte/store";
import { tRaw } from "../i18n";
import {
  addTask,
  projects as projectsStore,
  removeTask,
  tasks as tasksStore,
  updateTask,
  updateTaskStatus,
} from "../task-tracker/stores";
import type { ITask, TaskStatus } from "../task-tracker/types";
import {
  findFreeSlot,
  resolveCreateTimes,
  dateStrFromUID,
  type BusySlot,
  type CreateTimeResult,
} from "../task-tracker/freeSlot";

export {
  findFreeSlot,
  resolveCreateTimes,
  dateStrFromUID,
  slotOverlaps,
  wantsFreeSlotPlacement,
  type BusySlot,
  type CreateTimeResult,
} from "../task-tracker/freeSlot";

const MAX_OPS_TASKS = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export type ScheduleOp =
  | { type: "move"; taskIds: string[]; toDate?: string; shiftDays?: number }
  | { type: "setStatus"; taskIds: string[]; status: TaskStatus }
  | { type: "setPriority"; taskIds: string[]; priority: "low" | "medium" | "high" }
  | {
      type: "setTime";
      taskId: string;
      scheduledTime?: string | null;
      endTime?: string | null;
    }
  | { type: "rename"; taskId: string; title: string }
  | { type: "delete"; taskIds: string[] }
  | {
      type: "create";
      title: string;
      date?: string;
      scheduledTime?: string | null;
      endTime?: string | null;
      estimatedMinutes?: number;
      priority?: "low" | "medium" | "high";
      description?: string;
      projectName?: string;
    };

export interface ScheduleOpsPlan {
  summary: string;
  operations: ScheduleOp[];
}

export function extractDateFromUID(dateUID: string): string | null {
  return dateStrFromUID(dateUID);
}

/** Shift a dateUID by N days, preserving any time/offset suffix. */
export function shiftDateUID(dateUID: string, shiftDays: number): string | null {
  const m = /^day-(\d{4}-\d{2}-\d{2})/.exec(dateUID || "");
  if (!m) return null;
  const d = new Date(`${m[1]}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + shiftDays);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `day-${y}-${mo}-${da}${dateUID.slice(m[0].length)}`;
}

/** Point a dateUID at an absolute YYYY-MM-DD day, preserving suffix. */
export function setDateUID(dateUID: string, toDate: string): string | null {
  if (!DATE_RE.test(toDate)) return null;
  const m = /^day-\d{4}-\d{2}-\d{2}/.exec(dateUID || "");
  const suffix = m ? dateUID.slice(m[0].length) : "";
  return `day-${toDate}${suffix}`;
}

/** Collect busy slots for a calendar day from the live task store. */
export function busySlotsForDate(dateStr: string): BusySlot[] {
  return get(tasksStore)
    .filter((t) => extractDateFromUID(t.dateUID) === dateStr)
    .map((t) => ({
      scheduledTime: t.scheduledTime,
      endTime: t.endTime,
      estimatedTime: t.estimatedTime,
    }));
}

/**
 * Pick a free slot for `dateStr` (YYYY-MM-DD) from the live task store.
 * Shared by AI schedule ops and classic QuickAdd.
 */
export function pickFreeSlotForDate(
  dateStr: string,
  durationMin = 60,
): { scheduledTime: string; endTime: string } | null {
  return findFreeSlot(busySlotsForDate(dateStr), durationMin);
}

/**
 * Resolve create-time fields using the live store for `dateStr`.
 * Returns null when the day has no room.
 */
export function resolveCreateTimesForDate(input: {
  dateStr: string;
  scheduledTime?: string | null;
  endTime?: string | null;
  estimatedMinutes?: number;
  forceFreeSlot?: boolean;
  pickFreeSlot?: boolean;
}): CreateTimeResult | null {
  return resolveCreateTimes({
    ...input,
    busy: busySlotsForDate(input.dateStr),
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toIdList(v: unknown): string[] {
  if (typeof v === "string" && v.trim()) return [v.trim()];
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
  }
  return [];
}

function asStatus(v: unknown): TaskStatus | null {
  const allowed: TaskStatus[] = ["todo", "progress", "done", "paused", "failed"];
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as TaskStatus) : null;
}

function asPriority(v: unknown): "low" | "medium" | "high" | null {
  return v === "low" || v === "medium" || v === "high" ? v : null;
}

function asTime(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string" && TIME_RE.test(v)) return v;
  return undefined;
}

/**
 * Parse model JSON into a validated ops plan. Unknown / incomplete ops are dropped.
 * Accepts a few field aliases (`ops` / `actions`, `taskId` / `taskIds`).
 */
export function parseScheduleOps(content: string): ScheduleOpsPlan {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    const codeBlock = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = codeBlock?.[1] ?? content.match(/\{[\s\S]*\}/)?.[0];
    if (!candidate) return { summary: "", operations: [] };
    try {
      raw = JSON.parse(candidate.trim());
    } catch {
      return { summary: "", operations: [] };
    }
  }

  const obj = (raw ?? {}) as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const listRaw = obj.operations ?? obj.ops ?? obj.actions;
  if (!Array.isArray(listRaw)) return { summary, operations: [] };

  const operations: ScheduleOp[] = [];
  for (const item of listRaw) {
    if (!item || typeof item !== "object") continue;
    const op = item as Record<string, unknown>;
    const type = typeof op.type === "string" ? op.type.trim() : "";
    const ids = toIdList(op.taskIds ?? op.taskId ?? op.ids);

    if (type === "move") {
      const toDate = typeof op.toDate === "string" && DATE_RE.test(op.toDate) ? op.toDate : undefined;
      const shiftDays =
        typeof op.shiftDays === "number" && Number.isFinite(op.shiftDays)
          ? Math.trunc(op.shiftDays)
          : undefined;
      if (!ids.length || (!toDate && shiftDays === undefined)) continue;
      operations.push({ type: "move", taskIds: ids, toDate, shiftDays });
      continue;
    }

    if (type === "setStatus") {
      const status = asStatus(op.status);
      if (!ids.length || !status) continue;
      operations.push({ type: "setStatus", taskIds: ids, status });
      continue;
    }

    if (type === "setPriority") {
      const priority = asPriority(op.priority);
      if (!ids.length || !priority) continue;
      operations.push({ type: "setPriority", taskIds: ids, priority });
      continue;
    }

    if (type === "setTime") {
      if (!ids.length) continue;
      const scheduledTime = asTime(op.scheduledTime ?? op.start);
      const endTime = asTime(op.endTime ?? op.end);
      if (scheduledTime === undefined && endTime === undefined) continue;
      const taskId = ids[0];
      operations.push({
        type: "setTime",
        taskId,
        scheduledTime: scheduledTime ?? undefined,
        endTime: endTime ?? undefined,
      });
      continue;
    }

    if (type === "rename") {
      const title = typeof op.title === "string" ? op.title.trim() : "";
      if (!ids.length || !title) continue;
      operations.push({ type: "rename", taskId: ids[0], title });
      continue;
    }

    if (type === "delete") {
      if (!ids.length) continue;
      operations.push({ type: "delete", taskIds: ids });
      continue;
    }

    if (type === "create") {
      const title = typeof op.title === "string" ? op.title.trim() : "";
      if (!title) continue;
      const date = typeof op.date === "string" && DATE_RE.test(op.date) ? op.date : undefined;
      const scheduledTime = asTime(op.scheduledTime ?? op.start);
      const endTime = asTime(op.endTime ?? op.end);
      const priority = asPriority(op.priority) ?? undefined;
      const estimatedMinutes =
        typeof op.estimatedMinutes === "number" && Number.isFinite(op.estimatedMinutes)
          ? Math.max(15, Math.min(8 * 60, Math.round(op.estimatedMinutes)))
          : typeof op.estimatedTime === "number" && Number.isFinite(op.estimatedTime)
            ? Math.max(15, Math.min(8 * 60, Math.round(op.estimatedTime)))
            : undefined;
      const description =
        typeof op.description === "string" && op.description.trim()
          ? op.description.trim().slice(0, 500)
          : undefined;
      const projectName =
        typeof op.projectName === "string" && op.projectName.trim()
          ? op.projectName.trim()
          : typeof op.project === "string" && op.project.trim()
            ? op.project.trim()
            : undefined;
      operations.push({
        type: "create",
        title,
        date,
        scheduledTime: scheduledTime ?? undefined,
        endTime: endTime ?? undefined,
        estimatedMinutes,
        priority,
        description,
        projectName,
      });
    }
  }

  return { summary, operations };
}

function taskById(map: Map<string, ITask>, id: string): ITask | undefined {
  return map.get(id);
}

function titleOf(map: Map<string, ITask>, id: string): string {
  return taskById(map, id)?.title ?? `#${id}`;
}

function titlesOf(map: Map<string, ITask>, ids: string[]): string {
  return ids.map((id) => titleOf(map, id)).join(", ");
}

/** One-line human description of an operation for the preview card. */
export function describeOp(op: ScheduleOp, tasks: ITask[]): string {
  const map = new Map(tasks.map((t) => [t.id, t]));
  switch (op.type) {
    case "move": {
      const target =
        op.toDate ??
        (op.shiftDays != null
          ? tRaw("schedule.aiOpsShiftDays", { days: String(op.shiftDays) })
          : "?");
      return tRaw("schedule.aiOpsMove", { titles: titlesOf(map, op.taskIds), target });
    }
    case "setStatus":
      return tRaw("schedule.aiOpsStatus", {
        titles: titlesOf(map, op.taskIds),
        status: tRaw(`schedule.aiOpsStatus_${op.status}`),
      });
    case "setPriority":
      return tRaw("schedule.aiOpsPriority", {
        titles: titlesOf(map, op.taskIds),
        priority: tRaw(`schedule.aiOpsPriority_${op.priority}`),
      });
    case "setTime": {
      const time =
        op.scheduledTime && op.endTime
          ? `${op.scheduledTime}–${op.endTime}`
          : op.scheduledTime || op.endTime || "—";
      return tRaw("schedule.aiOpsTime", { title: titleOf(map, op.taskId), time });
    }
    case "rename":
      return tRaw("schedule.aiOpsRename", {
        title: titleOf(map, op.taskId),
        newTitle: op.title,
      });
    case "delete":
      return tRaw("schedule.aiOpsDelete", { titles: titlesOf(map, op.taskIds) });
    case "create": {
      const when = op.date || tRaw("schedule.aiOpsCreateToday");
      const time =
        op.scheduledTime && op.endTime
          ? `${op.scheduledTime}–${op.endTime}`
          : op.scheduledTime || "";
      return tRaw("schedule.aiOpsCreate", {
        title: op.title,
        when: time ? `${when} ${time}` : when,
      });
    }
  }
}

export interface ApplyOpsResult {
  applied: number;
  skipped: number;
  /** Human warnings (e.g. day is full — no free slot). */
  warnings: string[];
}

/** Apply validated operations to the task store. Unknown ids are skipped. */
export function applyScheduleOps(operations: ScheduleOp[]): ApplyOpsResult {
  const map = new Map(get(tasksStore).map((t) => [t.id, t]));
  let applied = 0;
  let skipped = 0;
  const warnings: string[] = [];

  const touch = (id: string): boolean => {
    if (!map.has(id)) {
      skipped += 1;
      return false;
    }
    return true;
  };

  for (const op of operations) {
    switch (op.type) {
      case "move": {
        for (const id of op.taskIds) {
          const task = taskById(map, id);
          if (!task) {
            skipped += 1;
            continue;
          }
          const current = task.dateUID;
          const next =
            op.toDate != null
              ? setDateUID(current, op.toDate)
              : op.shiftDays != null
                ? shiftDateUID(current, op.shiftDays)
                : null;
          if (!next) {
            skipped += 1;
            continue;
          }
          updateTask(id, { dateUID: next });
          map.set(id, { ...task, dateUID: next });
          applied += 1;
        }
        break;
      }
      case "setStatus": {
        for (const id of op.taskIds) {
          if (!touch(id)) continue;
          updateTaskStatus(id, op.status, { autoStartTimer: false });
          const task = taskById(map, id);
          if (task) {
            map.set(id, {
              ...task,
              status: op.status,
              completed: op.status === "done",
            });
          }
          applied += 1;
        }
        break;
      }
      case "setPriority": {
        for (const id of op.taskIds) {
          if (!touch(id)) continue;
          updateTask(id, { priority: op.priority });
          const task = taskById(map, id);
          if (task) map.set(id, { ...task, priority: op.priority });
          applied += 1;
        }
        break;
      }
      case "setTime": {
        if (!touch(op.taskId)) break;
        const patch: Partial<ITask> = {};
        if (op.scheduledTime !== undefined) patch.scheduledTime = op.scheduledTime ?? undefined;
        if (op.endTime !== undefined) patch.endTime = op.endTime ?? undefined;
        updateTask(op.taskId, patch);
        const task = taskById(map, op.taskId);
        if (task) map.set(op.taskId, { ...task, ...patch });
        applied += 1;
        break;
      }
      case "rename": {
        if (!touch(op.taskId)) break;
        updateTask(op.taskId, { title: op.title });
        const task = taskById(map, op.taskId);
        if (task) map.set(op.taskId, { ...task, title: op.title });
        applied += 1;
        break;
      }
      case "delete": {
        for (const id of op.taskIds) {
          if (!touch(id)) continue;
          removeTask(id);
          map.delete(id);
          applied += 1;
        }
        break;
      }
      case "create": {
        const dateStr = op.date || fmtDate(new Date());
        const projectName = op.projectName;
        const projectId = projectName
          ? (get(projectsStore).find((p) => p.name.toLowerCase() === projectName.toLowerCase())
              ?.id ?? null)
          : null;

        const dayTasks = [...map.values()].filter(
          (t) => extractDateFromUID(t.dateUID) === dateStr,
        );
        const resolved = resolveCreateTimes({
          dateStr,
          scheduledTime: op.scheduledTime,
          endTime: op.endTime,
          estimatedMinutes: op.estimatedMinutes || 60,
          busy: dayTasks.map((t) => ({
            scheduledTime: t.scheduledTime,
            endTime: t.endTime,
            estimatedTime: t.estimatedTime,
          })),
          // Times are chosen by the model when the user asks for a free slot;
          // without a clock time the task stays untimed.
          pickFreeSlot: false,
        });
        if (!resolved) {
          warnings.push(tRaw("schedule.aiOpsNoSlot", { date: dateStr, title: op.title }));
        }

        const created = addTask({
          title: op.title,
          description: op.description,
          completed: false,
          status: "todo",
          dateUID: `day-${dateStr}`,
          projectId,
          priority: op.priority || "medium",
          sortOrder: 0,
          scheduledTime: resolved?.scheduledTime ?? undefined,
          endTime: resolved?.endTime ?? undefined,
          estimatedTime: resolved?.estimatedMinutes ?? op.estimatedMinutes,
        });
        map.set(created.id, created);
        applied += 1;
        break;
      }
    }
  }

  return { applied, skipped, warnings };
}

export function buildScheduleOpsSystem(): string {
  return `You are a schedule editor inside a calendar/task plugin.
The user gives a natural-language instruction. You respond with ONLY valid JSON describing TASK OPERATIONS.

Return schema:
{
  "summary": "one short sentence in the user's language — what will change",
  "operations": [
    { "type": "move", "taskIds": ["id"], "shiftDays": 1 },
    { "type": "move", "taskIds": ["id"], "toDate": "YYYY-MM-DD" },
    { "type": "setStatus", "taskIds": ["id"], "status": "todo|progress|done|paused|failed" },
    { "type": "setPriority", "taskIds": ["id"], "priority": "low|medium|high" },
    { "type": "setTime", "taskId": "id", "scheduledTime": "HH:MM", "endTime": "HH:MM" },
    { "type": "rename", "taskId": "id", "title": "new title" },
    { "type": "delete", "taskIds": ["id"] },
    { "type": "create", "title": "task title", "date": "YYYY-MM-DD", "scheduledTime": "HH:MM", "endTime": "HH:MM", "estimatedMinutes": 60, "priority": "low|medium|high", "description": "optional", "projectName": "optional exact project name" }
  ]
}

RULES:
- Use EXACT task ids from the task list. Never invent ids.
- Prefer one operation that targets many taskIds over many identical ops.
- Relative dates resolve against Today in the context.
  "next Thursday" / "следующий четверг" = the Thursday AFTER the coming one if today is Thursday, else the upcoming Thursday. Always output absolute "toDate" style via "date".
- "shiftDays" is an integer offset applied to each task's current day.
- "toDate" is absolute YYYY-MM-DD. Use either toDate or shiftDays, not both.
- To clear a time set scheduledTime/endTime to null.
- TIME PICKING for "create":
  * Read "Occupied time blocks" for the target day. Never schedule over them.
  * "на 1 час" / "1 hour" → estimatedMinutes: 60. "на 30 минут" → 30. Default 60.
  * If the user asks to pick a free slot («подбери свободный слот», "pick a free slot", «найди время»), set scheduledTime/endTime to the first FREE gap in 09:00–21:00 (30-min grid).
  * If the user does NOT ask for a free slot and gives no clock time, leave scheduledTime/endTime null — the task is created without a time. NEVER auto-place into a free slot.
  * If the model is unsure of a free time, set scheduledTime/endTime to null.
- Example (dates illustrative):
  User: "Создай задачу на следующий четверг Купить молоко, подбери свободный слот, на 1 час"
  → {"operations":[{"type":"create","title":"Купить молоко","date":"<next Thursday>","estimatedMinutes":60,"scheduledTime":"<first free HH:MM>","endTime":"<HH:MM + 60m>"}]}
  User: "Создай задачу на завтра Прочитать статью"
  → {"operations":[{"type":"create","title":"Прочитать статью","date":"<tomorrow>","scheduledTime":null,"endTime":null}]}
- If the instruction is a question, not a mutation, return operations: [] and put the answer in "summary".
- Match the user's language for "summary".
- Output JSON only. No markdown fences, no commentary.`;
}

/**
 * Second-pass system prompt: turn an existing analysis/recommendation text
 * into concrete schedule operations. Used by "Apply recommendations".
 */
export function buildRecsToOpsSystem(): string {
  return `You convert schedule ANALYSIS / RECOMMENDATIONS into concrete TASK OPERATIONS.
You get: today's date, the task list with exact ids, and a free-form analysis text.
Return ONLY valid JSON with the same schema as a schedule editor:
{
  "summary": "one short sentence in the user's language — what will change",
  "operations": [
    { "type": "move", "taskIds": ["id"], "shiftDays": 1 },
    { "type": "move", "taskIds": ["id"], "toDate": "YYYY-MM-DD" },
    { "type": "setStatus", "taskIds": ["id"], "status": "todo|progress|done|paused|failed" },
    { "type": "setPriority", "taskIds": ["id"], "priority": "low|medium|high" },
    { "type": "setTime", "taskId": "id", "scheduledTime": "HH:MM", "endTime": "HH:MM" },
    { "type": "rename", "taskId": "id", "title": "new title" },
    { "type": "delete", "taskIds": ["id"] },
    { "type": "create", "title": "task title", "date": "YYYY-MM-DD", "scheduledTime": "HH:MM", "endTime": "HH:MM", "estimatedMinutes": 60, "priority": "low|medium|high", "description": "optional", "projectName": "optional exact project name" }
  ]
}

RULES:
- ONLY encode actionable recommendations that mutate the schedule. Skip pure observations.
- Use EXACT task ids from the task list. Never invent ids. Match by title when the analysis names tasks.
- Prefer one operation with many taskIds over many identical ops.
- "shiftDays" is an integer; "toDate" is absolute YYYY-MM-DD. Use one or the other.
- For "create": if no clock time is given, leave scheduledTime/endTime null (the task stays untimed) unless the analysis explicitly asks to pick a free slot — then use the first free gap (09:00–21:00, no overlap).
- If nothing is safely actionable, return operations: [] and explain in "summary".
- Be conservative: when unsure which task is meant, skip that recommendation rather than guessing.
- Match the analysis language for "summary".
- Output JSON only. No markdown fences.`;
}

/** User message for the recommendations → ops pass. */
export function buildRecsToOpsUser(analysisText: string, now: Date = new Date()): string {
  return `${buildScheduleOpsContext(now)}

Analysis / recommendations to turn into operations:
${analysisText.slice(0, 6000)}`;
}

/** Task + project context so the model can reference real ids / project names. */
export function buildScheduleOpsContext(now: Date = new Date()): string {
  const projects = get(projectsStore);
  const projMap = new Map(projects.map((p) => [p.id, p.name]));
  const all = [...get(tasksStore)];
  const todayStr = fmtDate(now);

  all.sort((a, b) => {
    const da = extractDateFromUID(a.dateUID) || "";
    const db = extractDateFromUID(b.dateUID) || "";
    if (da !== db) return da < db ? -1 : 1;
    return (a.scheduledTime || "").localeCompare(b.scheduledTime || "");
  });

  // Keep a useful window: drop long-finished old tasks first when over the cap.
  let list = all;
  if (list.length > MAX_OPS_TASKS) {
    const active = all.filter((t) => {
      const d = extractDateFromUID(t.dateUID);
      return t.status !== "done" || !d || d >= todayStr.slice(0, 7) + "-01" || d >= todayStr;
    });
    list = (active.length > 0 ? active : all).slice(0, MAX_OPS_TASKS);
  }

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const header = [
    `Today: ${todayStr} (${days[now.getDay()]})`,
    `Projects: ${
      projects.length
        ? projects.map((p) => `${p.id}=${p.name}`).join(", ")
        : "(none)"
    }`,
    `Tasks (${list.length}; use exact id):`,
  ];

  const lines = list.map((t) => {
    const date = extractDateFromUID(t.dateUID) || "?";
    const time = t.scheduledTime
      ? t.endTime
        ? `${t.scheduledTime}–${t.endTime}`
        : t.scheduledTime
      : "—";
    const status = t.status || "todo";
    const project = t.projectId ? (projMap.get(t.projectId) ?? t.projectId) : "—";
    return `- id=${t.id} | ${date} ${time} | ${status} | prio=${t.priority} | project=${project} | ${t.title}`;
  });

  // Occupancy cheat-sheet so the model can pick free clock times
  // Built from ALL tasks (not the capped list) so no busy block is missed.
  const occupied: string[] = [];
  const byDay = new Map<string, string[]>();
  for (const t of all) {
    if (!t.scheduledTime) continue;
    const d = extractDateFromUID(t.dateUID);
    if (!d) continue;
    const end = t.endTime || "…";
    const arr = byDay.get(d) ?? [];
    arr.push(`${t.scheduledTime}–${end}`);
    byDay.set(d, arr);
  }
  for (const [d, ranges] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, 31)) {
    occupied.push(`- ${d}: ${ranges.join(", ")}`);
  }

  return [
    ...header,
    `Occupied time blocks (use these to find free slots):`,
    occupied.length ? occupied.join("\n") : "(none — any slot 09:00–21:00 is free)",
    ``,
    ...lines,
  ].join("\n");
}
