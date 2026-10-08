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
import { isTaskOverdue } from "src/task-tracker/overdue";
import { recordNotificationEvent } from "./notificationTelemetry";
import { tRaw } from "../i18n";
import { errorMessage } from "../utils/sanitize";

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
/** Device-local (not synced): skip scheduling deferred ntfy pushes from this device. */
const NTFY_SKIP_DEVICE_KEY = "worklife-ntfy-skip-device";
const DIGEST_ENSURE_INTERVAL_MS = 15 * 60_000;
const DIGEST_CMD_POLL_MS = 2 * 60_000;
/** Stable sequence ID for the pending daily digest — replaces on reschedule. */
const DIGEST_SEQ = "daily-digest";
const DIGEST_CMD_SEQ = "daily-digest-now";

export class NotificationService {
  private plugin: CalendarPlugin;
  private timer: number | null = null;
  private digestTimer: number | null = null;
  private digestCmdTimer: number | null = null;
  private digestScheduling = false;
  private lastDigestDate = "";
  private lastDigestCmdPoll = 0;
  private firedReminders = new Set<string>();
  private firedDueNow = new Set<string>();
  private firedOverdue = new Set<string>();
  private firedDeadline = new Set<string>();
  private firedEstimateExceeded = new Set<string>();

  constructor(plugin: CalendarPlugin) {
    this.plugin = plugin;
  }

  /** Device-local: when true, this device must not schedule deferred ntfy pushes. */
  isNtfyScheduledDisabledOnThisDevice(): boolean {
    try {
      return this.plugin.app.loadLocalStorage(NTFY_SKIP_DEVICE_KEY) === true;
    } catch {
      return false;
    }
  }

  setNtfyScheduledDisabledOnThisDevice(disabled: boolean): void {
    try {
      this.plugin.app.saveLocalStorage(NTFY_SKIP_DEVICE_KEY, disabled);
    } catch {
      /* quota exceeded — ignore */
    }
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

  /** Persist the dedup map. Digest keys survive until end of their calendar day. */
  private saveNtfySchedule(map: Record<string, number>): void {
    const now = Math.floor(Date.now() / 1000);
    const pruned: Record<string, number> = {};
    for (const [k, v] of Object.entries(map)) {
      if (v > now) {
        pruned[k] = v;
        continue;
      }
      // daily-digest-YYYY-MM-DD: keep until that day ends so we never re-send
      const m = /^daily-digest-(\d{4}-\d{2}-\d{2})$/.exec(k);
      if (m) {
        const endOfDay = Math.floor(new Date(`${m[1]}T23:59:59.999`).getTime() / 1000);
        if (now <= endOfDay) pruned[k] = v;
      }
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

    const opts = this.plugin.options;
    if (opts.ntfyEnabled && opts.ntfyDailyDigestEnabled && opts.ntfyTopic) {
      this.ensureDailyDigestLoop();
      this.ensureDigestCommandLoop();
    }
  }

  stop(): void {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.stopDailyDigestLoop();
    this.stopDigestCommandLoop();
    this.firedReminders.clear();
    this.firedDueNow.clear();
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
      if (task.completed || task.status === "done" || task.status === "failed") continue;

      // Scheduled time reminders
      if (task.scheduledTime && task.dateUID) {
        const scheduledMoment = this.getScheduledMoment(task);
        if (scheduledMoment && scheduledMoment.isValid()) {
          const fireAt = scheduledMoment.valueOf();
          // Include dateUID + scheduledTime in key so carryOver / reschedule clears stale fired state
          const reminderKey = `${task.id}@${task.dateUID}@${task.scheduledTime}:reminder`;
          const dueNowKey = `${task.id}@${task.dateUID}@${task.scheduledTime}:due-now`;
          const overdueKey = `${task.id}@${task.dateUID}@${task.scheduledTime}:overdue`;

          const reminderMs = this.getSettings().reminderMinutesBefore * 60_000;
          if (this.getSettings().notifyReminders && now >= fireAt - reminderMs && now < fireAt && !this.firedReminders.has(reminderKey)) {
            this.firedReminders.add(reminderKey);
            this.notify(
              tRaw("taskStore.notificationTitle"),
              tRaw("notifications.reminder", { title: task.title, minutes: String(this.getSettings().reminderMinutesBefore), time: task.scheduledTime || "" }),
              "reminder",
              task.id
            );
          }

          // Наступило время выполнения — напоминание «приступить», НЕ «просрочено»
          if (this.getSettings().notifyReminders && now >= fireAt && now < fireAt + 60_000 && !this.firedDueNow.has(dueNowKey)) {
            this.firedDueNow.add(dueNowKey);
            this.notify(
              tRaw("taskStore.notificationTitle"),
              tRaw("notifications.dueNow", { title: task.title, time: task.scheduledTime || "" }),
              "due-now",
              `${task.id}-due-now`
            );
          }

          // Просрочка — только после окончания запланированного слота
          // (endTime / estimate / +60 мин), а не в момент начала задачи.
          if (
            this.getSettings().notifyOverdue &&
            isTaskOverdue(task, now) &&
            !this.firedOverdue.has(overdueKey)
          ) {
            this.firedOverdue.add(overdueKey);
            this.notify(
              tRaw("taskStore.notificationTitle"),
              tRaw("notifications.overdue", { title: task.title, time: task.scheduledTime || "" }),
              "overdue",
              `${task.id}-overdue`
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
              "estimate-exceeded",
              `${task.id}-estimate`
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
              "deadline-today",
              `${task.id}-deadline`
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
                  "deadline-expired",
                  `${task.id}-deadline-expired`
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
              "deadline-tomorrow",
              `${task.id}-deadline-tomorrow`
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

  private notify(title: string, body: string, source: string, sequenceId?: string): void {
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
    this.sendNtfy(title, body, source, sequenceId);
  }

  private sendNtfy(title: string, body: string, source: string, sequenceId?: string): void {
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

    const headers: Record<string, string> = {};
    if (sequenceId) headers["X-Sequence-ID"] = this.toSequenceId(sequenceId);

    void requestUrl({
      url: `https://ntfy.sh/${encodeURIComponent(opts.ntfyTopic)}`,
      method: "POST",
      headers,
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
        error: errorMessage(e),
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
    if (this.isNtfyScheduledDisabledOnThisDevice()) return;

    const allTasks = get(tasks);
    const now = momentFn();
    const horizon = now.clone().add(3, "days");
    const reminderMin = opts.reminderMinutesBefore ?? DEFAULT_REMINDER_MINUTES;

    const scheduled = this.loadNtfySchedule();
    let changed = false;

    for (const task of allTasks) {
      if (task.completed || task.status === "done" || task.status === "failed" || task.status === "paused") continue;

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

  /** Parse configured digest time "HH:mm" into hour/minute (fallback 06:00). */
  private getDigestHourMinute(): { hour: number; minute: number } {
    const raw = this.plugin.options.ntfyDigestTime || "06:00";
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!m) return { hour: 6, minute: 0 };
    const hour = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const minute = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return { hour, minute };
  }

  /** Next digest delivery moment from configured time. */
  private getDigestDeliveryMoment(): Moment {
    const now = momentFn();
    const { hour, minute } = this.getDigestHourMinute();
    const delivery = now.clone().hour(hour).minute(minute).second(0).millisecond(0);
    if (delivery.isSameOrBefore(now)) {
      delivery.add(1, "day");
    }
    return delivery;
  }

  /** Schedule ntfy.sh push with the day's task summary at the configured time.
   *  Delivery is delayed via X-Delay so it arrives even if Obsidian is closed.
   *  Idempotent via sequence ID `daily-digest`: reschedule replaces the pending push. */
  scheduleNtfyDailyDigest(): void {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyEnabled || !opts.ntfyDailyDigestEnabled || !opts.ntfyTopic) return;
    if (this.isNtfyScheduledDisabledOnThisDevice()) return;
    if (this.digestScheduling) return;

    // Keep checking daily so long-running sessions still get tomorrow's digest
    this.ensureDailyDigestLoop();
    this.ensureDigestCommandLoop();

    const delivery = this.getDigestDeliveryMoment();
    const digestDate = delivery.format("YYYY-MM-DD");
    const fireUnix = Math.floor(delivery.valueOf() / 1000);
    const scheduled = this.loadNtfySchedule();

    // Already queued for this exact delivery — skip (same time + day)
    if (scheduled[DIGEST_SEQ] === fireUnix) return;

    this.digestScheduling = true;
    try {
      const body = this.buildDigestBody(delivery);

      // Mark BEFORE network call so a concurrent tick cannot double-send
      scheduled[DIGEST_SEQ] = fireUnix;
      this.lastDigestDate = digestDate;
      this.saveNtfySchedule(scheduled);

      // Same sequence ID replaces any previously queued digest (time changed, etc.)
      this.sendNtfyDelayed(tRaw("taskStore.notificationTitle"), body, delivery.toISOString(), DIGEST_SEQ);
    } finally {
      this.digestScheduling = false;
    }
  }

  /** Build a richer digest body for the given delivery day. */
  private buildDigestBody(delivery: Moment): string {
    const dateStr = delivery.format("YYYY-MM-DD");
    const dateLabel = delivery.format("ddd DD.MM.YYYY");
    const dayTasks = get(tasks)
      .filter((t) => {
        if (t.completed || t.status === "done" || t.status === "failed" || t.status === "paused") return false;
        const match = /^day-(\d{4}-\d{2}-\d{2})/.exec(t.dateUID);
        return match?.[1] === dateStr;
      })
      .sort((a, b) => {
        const at = a.scheduledTime || "99:99";
        const bt = b.scheduledTime || "99:99";
        return at.localeCompare(bt) || a.title.localeCompare(b.title);
      });

    if (!dayTasks.length) {
      return tRaw("notifications.dailyDigestEmpty", { date: dateLabel });
    }

    const fmtEst = (min: number): string => {
      const h = Math.floor(min / 60);
      const m = min % 60;
      if (h > 0 && m > 0) return tRaw("notifications.durationHm", { h: String(h), m: String(m) });
      if (h > 0) return tRaw("notifications.durationH", { h: String(h) });
      return tRaw("notifications.durationM", { m: String(m) });
    };

    const timed: string[] = [];
    const untimed: string[] = [];
    const high: string[] = [];
    const deadlines: string[] = [];
    let totalEst = 0;

    for (const t of dayTasks) {
      if (t.estimatedTime) totalEst += t.estimatedTime;
      if (t.priority === "high") high.push(t.title);
      if (t.deadline === `day-${dateStr}`) {
        deadlines.push(t.deadlineTime ? `${t.title} (${t.deadlineTime})` : t.title);
      }

      const est = t.estimatedTime ? ` ⏱${fmtEst(t.estimatedTime)}` : "";
      const mark = t.priority === "high" ? " !" : t.priority === "medium" ? " ·" : "";
      const line = t.scheduledTime
        ? `${t.scheduledTime}  ${t.title}${est}${mark}`
        : `${t.title}${est}${mark}`;
      if (t.scheduledTime) timed.push(line);
      else untimed.push(line);
    }

    const extra: string[] = [];
    if (untimed.length) {
      extra.push(tRaw("notifications.dailyDigestNoTime", { count: String(untimed.length), list: untimed.join("\n") }));
    }
    if (high.length) {
      extra.push(tRaw("notifications.dailyDigestHighPriority", { list: high.join(", ") }));
    }
    if (deadlines.length) {
      extra.push(tRaw("notifications.dailyDigestDeadline", { list: deadlines.join(", ") }));
    }

    const summary = tRaw("notifications.dailyDigestSummary", {
      count: String(dayTasks.length),
      totalTime: totalEst ? fmtEst(totalEst) : "—",
    });

    return tRaw("notifications.dailyDigest", {
      date: dateLabel,
      list: timed.join("\n"),
      extra: extra.length ? `\n${extra.join("\n")}` : "",
      summary,
    });
  }

  /** Send the digest immediately (on-demand / ntfy command / settings test). */
  async sendDigestNow(): Promise<{ ok: boolean; error?: string }> {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyEnabled) return { ok: false, error: "ntfy is disabled" };
    if (!opts.ntfyTopic) return { ok: false, error: "ntfy topic is empty" };
    if (this.isNtfyScheduledDisabledOnThisDevice()) {
      return { ok: false, error: "deferred notifications disabled on this device" };
    }

    const body = this.buildDigestBody(momentFn());
    try {
      const resp = await requestUrl({
        url: `https://ntfy.sh/${encodeURIComponent(opts.ntfyTopic)}`,
        method: "POST",
        headers: {
          "X-Title": tRaw("taskStore.notificationTitle"),
          "X-Tags": "worklife",
          "X-Sequence-ID": DIGEST_CMD_SEQ,
        },
        body,
      });
      const ok = resp.status >= 200 && resp.status < 300;
      void recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status: ok ? "sent" : "failed",
        title: tRaw("taskStore.notificationTitle"),
        body,
        source: "digest-now",
        topic: opts.ntfyTopic,
        error: ok ? undefined : `HTTP ${resp.status}`,
      });
      return ok ? { ok: true } : { ok: false, error: `HTTP ${resp.status}` };
    } catch (e: unknown) {
      const msg = errorMessage(e);
      void recordNotificationEvent(this.plugin.app, {
        channel: "ntfy",
        status: "failed",
        title: tRaw("taskStore.notificationTitle"),
        body,
        source: "digest-now",
        topic: opts.ntfyTopic,
        error: msg,
      });
      return { ok: false, error: msg };
    }
  }

  /** Cancel the pending delayed digest on ntfy (feature turned off). */
  cancelScheduledDigest(): void {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyTopic) return;
    if (this.isNtfyScheduledDisabledOnThisDevice()) return;

    const scheduled = this.loadNtfySchedule();
    if (scheduled[DIGEST_SEQ] === undefined) return;

    delete scheduled[DIGEST_SEQ];
    this.saveNtfySchedule(scheduled);
    this.lastDigestDate = "";

    void requestUrl({
      url: `https://ntfy.sh/${encodeURIComponent(opts.ntfyTopic)}/${encodeURIComponent(DIGEST_SEQ)}`,
      method: "DELETE",
    }).catch((e: unknown) => {
      console.warn("[ntfy] digest cancel failed:", e);
    });
  }

  /** Re-check periodically so a multi-day session still schedules tomorrow's digest. */
  private ensureDailyDigestLoop(): void {
    if (this.digestTimer) return;
    this.digestTimer = window.setInterval(() => {
      this.scheduleNtfyDailyDigest();
    }, DIGEST_ENSURE_INTERVAL_MS);
  }

  private stopDailyDigestLoop(): void {
    if (this.digestTimer) {
      window.clearInterval(this.digestTimer);
      this.digestTimer = null;
    }
    this.lastDigestDate = "";
    this.digestScheduling = false;
  }

  /** Poll ntfy for a "digest" command published to the topic (works while Obsidian is open). */
  private ensureDigestCommandLoop(): void {
    if (this.digestCmdTimer) return;
    this.lastDigestCmdPoll = Math.floor(Date.now() / 1000);
    this.digestCmdTimer = window.setInterval(() => {
      void this.pollDigestCommand();
    }, DIGEST_CMD_POLL_MS);
  }

  private stopDigestCommandLoop(): void {
    if (this.digestCmdTimer) {
      window.clearInterval(this.digestCmdTimer);
      this.digestCmdTimer = null;
    }
    this.lastDigestCmdPoll = 0;
  }

  private async pollDigestCommand(): Promise<void> {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyEnabled || !opts.ntfyDailyDigestEnabled || !opts.ntfyTopic) return;
    if (this.isNtfyScheduledDisabledOnThisDevice()) return;

    const since = this.lastDigestCmdPoll;
    this.lastDigestCmdPoll = Math.floor(Date.now() / 1000);

    try {
      const resp = await requestUrl({
        url: `https://ntfy.sh/${encodeURIComponent(opts.ntfyTopic)}/json?poll=1&since=${since}`,
        method: "GET",
      });
      if (resp.status < 200 || resp.status >= 300) return;

      const lines = String(resp.text || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      for (const line of lines) {
        let msg: { event?: string; message?: string; tags?: string[]; title?: string };
        try {
          msg = JSON.parse(line) as typeof msg;
        } catch {
          continue;
        }
        if (msg.event !== "message") continue;
        // Ignore our own pushes so a digest does not re-trigger itself
        if (Array.isArray(msg.tags) && msg.tags.includes("worklife")) continue;

        const body = (msg.message || "").trim();
        if (!/^\/?(digest|дайджест|дайдж)$/i.test(body)) continue;

        await this.sendDigestNow();
        return; // one command is enough
      }
    } catch (e: unknown) {
      console.warn("[ntfy] digest command poll failed:", e);
    }
  }

  /** Stable ntfy sequence ID — second publish with the same ID replaces the first
   *  (including a pending X-Delay), so multi-device open does not double-schedule. */
  private toSequenceId(id: string): string {
    return id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
  }

  private sendNtfyDelayed(title: string, body: string, deliveryIso: string, dedupeId: string): void {
    const opts: ISettings = this.plugin.options;
    if (!opts.ntfyTopic) return;

    // Convert ISO to Unix timestamp in seconds
    const unixSec = Math.floor(new Date(deliveryIso).getTime() / 1000);

    void requestUrl({
      url: `https://ntfy.sh/${encodeURIComponent(opts.ntfyTopic)}`,
      method: "POST",
      headers: {
        "X-Delay": String(unixSec),
        "X-Title": title,
        "X-Tags": "worklife",
        "X-Sequence-ID": this.toSequenceId(dedupeId),
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
        error: errorMessage(e),
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
      const msg = errorMessage(e);
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
      const msg = errorMessage(e);
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
    for (const key of this.firedDueNow) {
      const taskId = key.split("@")[0];
      if (!activeIds.has(taskId)) {
        this.firedDueNow.delete(key);
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
      this.firedDueNow = new Set(fired.dueNow ?? []);
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
      dueNow: [...this.firedDueNow],
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
