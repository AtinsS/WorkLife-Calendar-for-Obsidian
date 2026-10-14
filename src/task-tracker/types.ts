export interface RecurrenceConfig {
  type: "daily" | "weekly" | "monthly";
  interval?: number;
  daysOfWeek?: number[];
  until?: DateUID; // dateUID "day-YYYY-MM-DD" — повторение до этой даты включительно
}

export type TaskStatus = "todo" | "progress" | "done" | "paused" | "failed" | "all";

/** Special task kinds with dedicated AI actions / streaks. */
export type TaskKind = "default" | "workout";

export interface ITask {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  status: TaskStatus;
  dateUID: string;
  projectId: string | null;
  boundNotePath?: string | null; // Привязанная заметка
  priority: "low" | "medium" | "high";
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  recurrence?: RecurrenceConfig;
  timerStartedAt?: number;
  pausedAt?: number;
  pausedWorkTime?: number;
  totalWorkTime?: number;
  estimatedTime?: number;
  scheduledTime?: string;
  endTime?: string; // время окончания задачи (формат: "HH:MM")
  isRecurringInstance?: boolean;
  parentTaskId?: string;
  isWorkTask?: boolean;
  paymentType?: "hour" | "day";
  rate?: number;
  overtimeStart?: number; // hour when overtime begins (e.g., 8 = after 8 hours)
  overtimeMultiplier?: number; // rate multiplier during overtime (e.g., 1.5 = 1.5x)
  deadline?: DateUID; // deadline date (format: "day-YYYY-MM-DD")
  deadlineTime?: string; // deadline time (format: "HH:MM")
  carriedOverFrom?: string; // dateUID откуда была перенесена просроченная задача
  /** "workout" sessions participate in AI plan + streak habit. */
  kind?: TaskKind;
  workoutLocation?: "gym" | "home" | "outdoors";
  workoutDayKey?: string;
  /** Placement in a status-less kanban column (`IKanbanColumnDef.statuses` empty). */
  kanbanColumnId?: string;
}

export interface IProject {
  id: string;
  name: string;
  color: string;
  icon: string;
  folder: string | null;
  archived: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface TimeLog {
  id: string;
  taskId: string;
  taskTitle: string;
  startTime: number;
  endTime: number;
  duration: number;
  date: string;
}

export interface IChecklistItem {
  id: string;
  taskId: string; // parent task ID
  title: string;
  checked: boolean;
  sortOrder: number;
  updatedAt?: number; // epoch ms — last local modification
}

/** One column on a (custom) kanban board. Maps to one or more task statuses. */
export interface IKanbanColumnDef {
  id: string;
  title: string;
  icon: string;
  color: string;
  /**
   * Task statuses that land in this column. Drop sets the first status.
   * Empty = free-form column: tasks live here via `ITask.kanbanColumnId`.
   */
  statuses: TaskStatus[];
  /** When the column includes "progress": auto-start the work timer on drop. */
  autoStartTimer?: boolean;
}

/** Per-board filter snapshot so sorting/filtering sticks across visits. */
export interface IKanbanBoardFilters {
  filterMode?: "today" | "all" | "date";
  filterDateStr?: string;
  projectFilterId?: string | null;
}

/** Kanban board layout. Built-in default board is not persisted. */
export interface IKanbanBoard {
  id: string;
  name: string;
  icon: string;
  columns: IKanbanColumnDef[];
  createdAt: number;
  sortOrder: number;
  filters?: IKanbanBoardFilters;
}

export interface ITaskTrackerData {
  tasks: ITask[];
  projects: IProject[];
  timeLogs: TimeLog[];
  checklists: IChecklistItem[];
  kanbanBoards?: IKanbanBoard[];
  version: number;
}

export type DateUID = string;

export const TASK_TRACKER_DATA_VERSION = 8;
export const MAX_TIME_LOGS = 180;

/** Built-in status board (always available, not stored). */
export const DEFAULT_KANBAN_BOARD_ID = "default";

export function createDefaultKanbanColumns(): IKanbanColumnDef[] {
  return [
    { id: "todo", title: "", icon: "🟢", color: "rgba(110, 130, 160, 0.8)", statuses: ["todo"] },
    { id: "progress", title: "", icon: "🔥", color: "rgba(180, 145, 85, 0.85)", statuses: ["progress"] },
    { id: "paused", title: "", icon: "☕", color: "rgba(180, 150, 100, 0.7)", statuses: ["paused"] },
    { id: "done", title: "", icon: "✅", color: "rgba(85, 160, 130, 0.8)", statuses: ["done"] },
    { id: "failed", title: "", icon: "❌", color: "rgba(180, 90, 90, 0.85)", statuses: ["failed"] },
  ];
}

export const DEFAULT_PROJECT_COLORS = [
  "#882e25",
  "#a84402",
  "#ac6a01",
  "#1b7942",
  "#1f618d",
  "#65337a",
  "#86103f",
  "#017065",
  "#851339",
  "#4c6570",
  "#37474f",
  "#647177",
];
