export interface IHabit {
  id: string;
  title: string;
  icon: string;
  color: string;
  frequency: "daily" | "weekly" | "monthly";
  customDays?: number[];
  monthlyDay?: number; // 1-31 — день месяца для выполнения (при frequency=monthly)
  projectId?: string | null;
  targetCount: number;
  archived: boolean;
  createdAt: number;
  sortOrder: number;
  /**
   * Display-only habit: shown in the list but not completable by hand.
   * Used by the AI-workout streak — completion only via workout task → done.
   */
  locked?: boolean;
}

export interface IHabitLog {
  id: string;
  habitId: string;
  date: string;
  completed: boolean;
  count: number;
  completedAt?: number;
}

export interface IHabitTrackerData {
  habits: IHabit[];
  habitLogs: IHabitLog[];
  version: number;
}

export const HABIT_TRACKER_DATA_VERSION = 1;
export const MAX_HABIT_LOG_ENTRIES = 1000;
