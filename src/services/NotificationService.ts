import { get } from "svelte/store";
import { moment, requestUrl } from "obsidian";
import type { Moment } from "moment";
import type CalendarPlugin from "src/main";

// Obsidian's type defs export moment as `typeof Moment` (the module namespace),
// but at runtime it's the callable moment function. Cast once here.
const momentFn = moment as unknown as (inp?: unknown, format?: string, strict?: boolean) => Moment;
import { tasks } from "src/task-tracker/stores";
import type { ITask } from "src/task-tracker/types";
import type { ISettings } from "src/settings";
import { getActiveTimer } from "src/task-tracker/TimerManager";
import { recordNotificationEvent } from "./notificationTelemetry";
import { tRaw } from "../i18n";

const DEFAULT_CHECK_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_REMINDER_MINUTES = 5;

export interface NotificationSettings {
  notificationsEnabled: boolean;
  reminderMinutesBefore: number;
  checkIntervalMs: number;
  notifyReminders: boolean;
  notifyOverdue: boolean;
  notifyEstimateExceeded: boolean;
  notifyDeadlines: boolean;
}

export const defaultNotificationSettings: NotificationSettings = {
  notificationsEnabled: false,
  reminderMinutesBefore: DEFAULT_REMINDER_MINUTES,
  checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
  notifyReminders: true,
  notifyOverdue: true,
  notifyEstimateExceeded: true,
  notifyDeadlines: true,
};

const NTFY_DEDUP_KEY = "worklife-ntfy-scheduled";

export class NotificationService {
  private plugin: CalendarPlugin;
  private timer: number | null = null;
  private firedReminders = new Set<string>();
  private firedOverdue = new Set<string>();
  private firedDeadline = new Set<string>();
  private firedEstimateExceeded = new Set<string>();

  constructor(plugin: CalendarPlugin) {
    this.plugin = plugin;
  }

  /** Load the ntfy scheduled-notification dedup map from localStorage.
   *  Keys are task IDs (or "id-deadline"), values are Unix delivery timestamps. */
  private loadNtfySchedule(): Record<string, number> {
    try {
      const raw = this.plugin.app.loadLocalStorage(NTFY_DEDUP_KEY) as string | null;
      if (!raw) return {};
      return JSON.parse(raw) as Record<string, number>;
    } catch {
      return {};
    }
  }

  /** Persist the dedup map, pruning entries whose delivery time is already past. */
  private saveNtfySchedule(map: Record<string, number>): void {
    const now = Math.floor(Date.now() / 1000);
    const pruned: Record<string, number> = {};
    for (const [k, v] of Object.entries(map)) {
      if (v > now) pruned[k] = v;
    }
    try {
      this.plugin.app.saveLocalStorage(NTFY_DEDUP_KEY, JSON.stringify(pruned));
    } catch { /* quota exceeded — ignore */ }
  }

  async start(): Promise<void> {
    if (this.timer) return;

    await this.loadFiredState();
    this.requestPermission();
    this.timer = window.setInterval(() => this.check(), this.getSettings().checkIntervalMs);
    this.check(); // run immediately
  }

  stop(): void {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.firedReminders.clear();
    this.firedOverdue.clear();
    this.firedDeadline.clear();
    this.firedEstimateExceeded.clear();
  }

  restart(): void {
    this.stop();
    if (this.getSettings().notificationsEnabled) {
      void this.start();
    }
  }

  private getSettings(): NotificationSettings {
    const opts: ISettings = this.plugin.options;
    return {
      notificationsEnabled: opts.notificationsEnabled ?? defaultNotificationSettings.notificationsEnabled,
      reminderMinutesBefore: opts.reminderMinutesBefore ?? defaultNotificationSettings.reminderMinutesBefore,
      checkIntervalMs: opts.checkIntervalMs ?? defaultNotificationSettings.checkIntervalMs,
      notifyReminders: opts.notifyReminders ?? defaultNotificationSettings.notifyReminders,
      notifyOverdue: opts.notifyOverdue ?? defaultNotificationSettings.notifyOverdue,
      notifyEstimateExceeded: opts.notifyEstimateExceeded ?? defaultNotificationSettings.notifyEstimateExceeded,
      notifyDeadlines: opts.notifyDeadlines ?? defaultNotificationSettings.notifyDeadlines,
    };
  }

  private requestPermission(): void {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }

  private check(): void {
    if (!this.getSettings().notificationsEnabled) return;
    if ("Notification" in window && Notification.permission !== "granted") return;

    const allTasks = get(tasks);
    const now = Date.now();

    for (const task of allTasks) {
      if (task.completed || task.status === "done") continue;

      // Scheduled time reminders
      if (task.scheduledTime && task.dateUID) {
        const scheduledMoment = this.getScheduledMoment(task);
        if (scheduledMoment && scheduledMoment.isValid()) {
          const fireAt = scheduledMoment.valueOf();
          // Include dateUID + scheduledTime in key so carryOver / reschedule clears stale fired state
          const reminderKey = `${task.id}@${task.dateUID}@${task.scheduledTime}:reminder`;
          const overdueKey = `${task.id}@${task.dateUID}@${task.scheduledTime}:overdue`;

          const reminderMs = this.getSettings().reminderMinutesBefore * 60_000;
          if (this.getSettings().notifyReminders && now >= fireAt - reminderMs && now < fireAt && !this.firedReminders.has(reminderKey)) {
            this.firedReminders.add(reminderKey);
            this.notify(
              tRaw("taskStore.notificationTitle"),
              tRaw("notifications.reminder", { title: task.title, minutes: String(this.getSettings().reminderMinutesBefore), time: task.scheduledTime || "" }),
              "reminder"
            );
          }

          // Просрочка — сразу при наступлении запланированного времени
          if (this.getSettings().notifyOverdue && task.status === "todo" && now >= fireAt && !this.firedOverdue.has(overdueKey)) {
            this.firedOverdue.add(overdueKey);
            this.notify(
              tRaw("taskStore.notificationTitle"),
              tRaw("notifications.overdue", { title: task.title, time: task.scheduledTime || "" }),
              "overdue"
            );
          }
        }
      }

      // Estimated time exceeded — notify when work time exceeds estimate
      if (this.getSettings().notifyEstimateExceeded && task.estimatedTime && task.status === "progress") {
        const estimateKey = `${task.id}@estimate-exceeded`;
        if (!this.firedEstimateExceeded.has(estimateKey)) {
          const estimatedMs = task.estimatedTime * 60_000;
          const currentSessionMs = getActiveTimer(task.id) || 0;
          const totalMs = (task.totalWorkTime || 0) + currentSessionMs;
          if (totalMs > estimatedMs) {
            this.firedEstimateExceeded.add(estimateKey);
            const estH = Math.floor(task.estimatedTime / 60);
            const estM = task.estimatedTime % 60;
            const estStr = estH > 0 ? `${estH}ч ${estM > 0 ? `${estM}м` : ''}` : `${estM}м`;
            const actH = Math.floor(totalMs / 3_600_000);
            const actM = Math.floor((totalMs % 3_600_000) / 60_000);
            const actStr = actH > 0 ? `${actH}ч ${actM > 0 ? `${actM}м` : ''}` : `${actM}м`;
            this.notify(
              tRaw("taskStore.notificationTitle"),
              tRaw("notifications.estimateExceeded", { title: task.title, expected: estStr, actual: actStr }),
              "estimate-exceeded"
            );
          }
        }
      }

      // Deadline notifications
      if (this.getSettings().notifyDeadlines && task.deadline) {
        const deadlineMatch = /^day-(\d{4})-(\d{2})-(\d{2})/.exec(task.deadline);
        if (deadlineMatch) {
          const [, y, m, d] = deadlineMatch;
          const deadlineDate = new Date(`${y}-${m}-${d}T00:00:00`);
          const nowDate = new Date();
          const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
          const diffMs = deadlineDate.getTime() - today.getTime();
          const diffDays = Math.round(diffMs / 86400000);

          // Deadline start — when the deadline day begins (9:00 AM)
          const deadlineStartKey = `${task.id}@${task.deadline}:deadline-start`;
          if (diffDays === 0 && nowDate.getHours() >= 9 && !this.firedDeadline.has(deadlineStartKey)) {
            this.firedDeadline.add(deadlineStartKey);
            const timeStr = task.deadlineTime ? ` в ${task.deadlineTime}` : "";
            this.notify(
              tRaw("taskStore.notificationTitle"),
              tRaw("notifications.deadlineToday", { title: task.title, time: timeStr }),
              "deadline-today"
            );
          }

          // Deadline end — when the deadline time passes
          if (task.deadlineTime && diffDays <= 0) {
            const deadlineEndKey = `${task.id}@${task.deadline}:deadline-end`;
            if (!this.firedDeadline.has(deadlineEndKey)) {
              const deadlineDateTime = new Date(`${y}-${m}-${d}T${task.deadlineTime}:00`);
              if (now >= deadlineDateTime.getTime()) {
                this.firedDeadline.add(deadlineEndKey);
                this.notify(
                  tRaw("taskStore.notificationTitle"),
                  tRaw("notifications.deadlineExpired", { title: task.title, time: task.deadlineTime || "" }),
                  "deadline-expired"
                );
              }
            }
          }

          // 1 day before deadline
          const deadlineKey = `${task.id}@${task.deadline}:deadline`;
          if (diffDays === 1 && !this.firedDeadline.has(deadlineKey)) {
            this.firedDeadline.add(deadlineKey);
            const timeStr = task.deadlineTime ? ` в ${task.deadlineTime}` : "";
            this.notify(
              tRaw("taskStore.notificationTitle"),
              tRaw("notifications.deadlineTomorrow", { title: task.title, time: timeStr }),
              "deadline-tomorrow"
            );
          }
        }
      }
    }

    this.cleanupFiredKeys(allTasks);
  }

  private getScheduledMoment(task: ITask): Moment | null {
    const match: RegExpMatchArray | null = /^day-(\d{4}-\d{2}-\d{2})/.exec(task.dateUID);
    if (!match) return null;

    const dateStr: string = match[1];
    return momentFn(`${dateStr} ${task.scheduledTime}`, "YYYY-MM-DD HH:mm", true);
  }

  private notify(title: string, body: string, source: string): void {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const notification: Notification = new Notification(title, {
      body,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    // Auto-close after 10 seconds
    window.setTimeout(() => notification.close(), 10_000);

    void recordNotificationEvent(this.plugin.app, {
      channel: "browser",
      status: "sent",
      title,
      body,
      source,
    }).catch((e: unknown) => console.warn("[notification] history write failed:", e));

    // Also send via ntfy.sh if enabled
    this.sendNtfy(title, body, source);
  }

  private sendNtfy(title: string, body: string, source: string): void {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyEnabled) return;
    if (!opts.ntfyTopic) {
      void recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status: "failed",
        title,
        body,
        source,
        error: "ntfy.sh topic is empty",
      }).catch((e: unknown) => console.warn("[ntfy] history write failed:", e));
      return;
    }

    void requestUrl({
      url: `https://ntfy.sh/${encodeURIComponent(opts.ntfyTopic)}`,
      method: "POST",
      body,
    }).then((response) => {
      const status: "sent" | "failed" = response.status >= 200 && response.status < 300 ? "sent" : "failed";
      return recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status,
        title,
        body,
        source,
        topic: opts.ntfyTopic,
        error: status === "failed" ? `HTTP ${response.status}` : undefined,
      });
    }).catch((e: unknown) => {
      console.warn("[ntfy] send failed:", e);
      return recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status: "failed",
        title,
        body,
        source,
        topic: opts.ntfyTopic,
        error: e instanceof Error ? e.message : String(e),
      }).catch((historyError: unknown) => console.warn("[ntfy] history write failed:", historyError));
    });
  }

  /** Schedule ntfy.sh push notifications for tasks in the next 3 days.
   *  Each task with scheduledTime gets an X-Delay push so ntfy.sh delivers
   *  the notification at the right time — even if Obsidian is closed.
   *  Deduplicates against previously scheduled notifications so reopening
   *  Obsidian doesn't create duplicate pushes. */
  scheduleNtfyPush(): void {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyEnabled || !opts.ntfyScheduledEnabled || !opts.ntfyTopic) return;

    const allTasks = get(tasks);
    const now = momentFn();
    const horizon = now.clone().add(3, "days");
    const reminderMin = opts.reminderMinutesBefore ?? DEFAULT_REMINDER_MINUTES;

    const scheduled = this.loadNtfySchedule();
    let changed = false;

    for (const task of allTasks) {
      if (task.completed || task.status === "done" || task.status === "paused") continue;

      // Task with scheduledTime on a specific date
      if (task.scheduledTime && task.dateUID) {
        const scheduledMoment = this.getScheduledMoment(task);
        if (!scheduledMoment || !scheduledMoment.isValid()) continue;
        if (scheduledMoment.isBefore(now) || scheduledMoment.isAfter(horizon)) continue;

        const fireAt = scheduledMoment.clone().subtract(reminderMin, "minutes");
        if (fireAt.isBefore(now)) continue; // already past

        const fireUnix = Math.floor(fireAt.valueOf() / 1000);
        if (scheduled[task.id] === fireUnix) continue; // already scheduled at this time

        const title = tRaw("taskStore.notificationTitle");
        const body = tRaw("notifications.reminder", {
          title: task.title,
          minutes: String(reminderMin),
          time: task.scheduledTime || "",
        });

        this.sendNtfyDelayed(title, body, fireAt.toISOString(), task.id);
        scheduled[task.id] = fireUnix;
        changed = true;
      }

      // Task with deadline today/tomorrow
      if (task.deadline) {
        const dlMatch = /^day-(\d{4})-(\d{2})-(\d{2})/.exec(task.deadline);
        if (!dlMatch) continue;
        const [, y, m, d] = dlMatch;
        const dlDate = momentFn(`${y}-${m}-${d} 09:00`, "YYYY-MM-DD HH:mm", true);
        if (!dlDate.isValid()) continue;
        if (dlDate.isBefore(now) || dlDate.isAfter(horizon)) continue;

        const dedupeKey = `${task.id}-deadline`;
        const dlUnix = Math.floor(dlDate.valueOf() / 1000);
        if (scheduled[dedupeKey] === dlUnix) continue;

        const title = tRaw("taskStore.notificationTitle");
        const body = tRaw("notifications.deadlineToday", { title: task.title, time: task.deadlineTime || "" });

        this.sendNtfyDelayed(title, body, dlDate.toISOString(), dedupeKey);
        scheduled[dedupeKey] = dlUnix;
        changed = true;
      }
    }

    if (changed) this.saveNtfySchedule(scheduled);
  }

  private sendNtfyDelayed(title: string, body: string, deliveryIso: string, _dedupeId: string): void {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyTopic) return;

    // Convert ISO to Unix timestamp in seconds
    const unixSec = Math.floor(new Date(deliveryIso).getTime() / 1000);

    void requestUrl({
      url: `https://ntfy.sh/${encodeURIComponent(opts.ntfyTopic)}`,
      method: "POST",
      headers: {
        "X-Delay": String(unixSec),
        "X-Tags": "worklife",
      },
      body,
    }).then((response) => {
      const status = response.status >= 200 && response.status < 300 ? "sent" : "failed";
      if (status === "failed") {
        console.warn(`[ntfy] scheduled push HTTP ${response.status}:`, response.text);
      }
      void recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status,
        title,
        body,
        source: "scheduled",
        topic: opts.ntfyTopic,
        error: status === "failed" ? `HTTP ${response.status}: ${response.text}` : undefined,
      });
    }).catch((e: unknown) => {
      console.warn("[ntfy] scheduled push failed:", e);
      void recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status: "failed",
        title,
        body,
        source: "scheduled",
        topic: opts.ntfyTopic,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  /** Send a test ntfy.sh notification (immediate) */
  async testNtfyImmediate(): Promise<{ ok: boolean; error?: string }> {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyTopic) return { ok: false, error: "ntfy topic is empty" };
    try {
      const resp = await requestUrl({
        url: `https://ntfy.sh/${encodeURIComponent(opts.ntfyTopic)}`,
        method: "POST",
        headers: { "X-Tags": "test" },
        body: "WorkLife: test notification",
      });
      const ok = resp.status >= 200 && resp.status < 300;
      await recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status: ok ? "sent" : "failed",
        title: "Test notification",
        body: "WorkLife: test notification",
        source: "test",
        topic: opts.ntfyTopic,
        error: ok ? undefined : `HTTP ${resp.status}`,
      });
      return ok ? { ok: true } : { ok: false, error: `HTTP ${resp.status}` };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status: "failed",
        title: "Test notification",
        body: "WorkLife: test notification",
        source: "test",
        topic: opts.ntfyTopic,
        error: msg,
      });
      return { ok: false, error: msg };
    }
  }

  /** Send a test ntfy.sh scheduled notification (1 min from now) */
  async testNtfyScheduled(): Promise<{ ok: boolean; error?: string }> {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyTopic) return { ok: false, error: "ntfy topic is empty" };
    const delaySec = Math.floor(Date.now() / 1000) + 60; // 1 minute from now
    try {
      const resp = await requestUrl({
        url: `https://ntfy.sh/${encodeURIComponent(opts.ntfyTopic)}`,
        method: "POST",
        headers: {
          "X-Delay": String(delaySec),
          "X-Tags": "test",
        },
        body: "WorkLife: scheduled test (1 min)",
      });
      const ok = resp.status >= 200 && resp.status < 300;
      await recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status: ok ? "sent" : "failed",
        title: "Scheduled test",
        body: "WorkLife: scheduled test (1 min)",
        source: "test-scheduled",
        topic: opts.ntfyTopic,
        error: ok ? undefined : `HTTP ${resp.status}: ${resp.text}`,
      });
      return ok ? { ok: true } : { ok: false, error: `HTTP ${resp.status}: ${resp.text}` };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      await recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status: "failed",
        title: "Scheduled test",
        body: "WorkLife: scheduled test (1 min)",
        source: "test-scheduled",
        topic: opts.ntfyTopic,
        error: msg,
      });
      return { ok: false, error: msg };
    }
  }

  private cleanupFiredKeys(activeTasks: ITask[]): void {
    const activeIds = new Set(activeTasks.map((t) => t.id));
    for (const key of this.firedReminders) {
      const taskId = key.split("@")[0];
      if (!activeIds.has(taskId)) {
        this.firedReminders.delete(key);
      }
    }
    for (const key of this.firedOverdue) {
      const taskId = key.split("@")[0];
      if (!activeIds.has(taskId)) {
        this.firedOverdue.delete(key);
      }
    }
    for (const key of this.firedDeadline) {
      const taskId = key.split("@")[0];
      if (!activeIds.has(taskId)) {
        this.firedDeadline.delete(key);
      }
    }
    for (const key of this.firedEstimateExceeded) {
      const taskId = key.split("@")[0];
      if (!activeIds.has(taskId)) {
        this.firedEstimateExceeded.delete(key);
      }
    }
    this.saveFiredState();
  }

  private async loadFiredState(): Promise<void> {
    try {
      const data: Record<string, unknown> = await this.plugin.loadData() as Record<string, unknown>;
      const fired = (data?.firedNotifications ?? {}) as Record<string, string[]>;
      this.firedReminders = new Set(fired.reminders ?? []);
      this.firedOverdue = new Set(fired.overdue ?? []);
      this.firedDeadline = new Set(fired.deadline ?? []);
      this.firedEstimateExceeded = new Set(fired.estimateExceeded ?? []);
    } catch {
      // ignore
    }
  }

  private saveFiredState(): void {
    const firedData = {
      reminders: [...this.firedReminders],
      overdue: [...this.firedOverdue],
      deadline: [...this.firedDeadline],
      estimateExceeded: [...this.firedEstimateExceeded],
    };
    void this.plugin.loadData().then((existing: unknown) => {
      const updated: Record<string, unknown> = { ...((existing as Record<string, unknown>) ?? {}) };
      updated.firedNotifications = firedData;
      void this.plugin.saveData(updated);
    }).catch(() => { /* ignore */ });
  }
}
