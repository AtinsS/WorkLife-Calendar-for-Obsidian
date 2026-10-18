import type { App } from "obsidian";
import { Notice, normalizePath, TFile as TFileClass } from "obsidian";
import { get } from "svelte/store";
import { CustomModal } from "../ui/CustomModal";
import { mountTypingBlock } from "../ui/typingDots";
import { tRaw } from "../i18n";
import { settings } from "../ui/stores";
import { tasks } from "../task-tracker/stores";
import type { ITask } from "../task-tracker/types";
import { streamOllamaChat, resolveModel } from "./OllamaService";
import { errorMessage } from "../utils/sanitize";
import {
  applyScheduleOps,
  buildRecsToOpsSystem,
  buildRecsToOpsUser,
  buildScheduleOpsContext,
  buildScheduleOpsSystem,
  describeOp,
  parseScheduleOps,
  type ScheduleOpsPlan,
} from "./aiScheduleOps";

type PeriodKey = "day" | "view" | "week" | "lastWeek" | "month" | "last7" | "last30";
type AnalysisKind = "summary" | "load";
type UIMode = "analyze" | "command";

const MAX_TASKS = 200;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function extractDate(dateUID: string): string | null {
  const m = /^day-(\d{4}-\d{2}-\d{2})/.exec(dateUID);
  return m ? m[1] : null;
}

function minutesOf(task: ITask): number {
  if (task.estimatedTime && task.estimatedTime > 0) return task.estimatedTime;
  if (task.scheduledTime && task.endTime) {
    const [sh, sm] = task.scheduledTime.split(":").map(Number);
    const [eh, em] = task.endTime.split(":").map(Number);
    let diff = eh * 60 + em - (sh * 60 + sm);
    if (diff <= 0) diff += 24 * 60;
    if (diff > 0) return diff;
  }
  return 60;
}

function periodRange(
  key: PeriodKey,
  viewStart?: Date | null,
  viewEnd?: Date | null,
): { start: Date; end: Date; label: string } {
  const now = new Date();
  const today = startOfDay(now);

  switch (key) {
    case "day": {
      // Prefer the calendar day the user is looking at; otherwise today.
      let day = today;
      if (viewStart) {
        const vs = startOfDay(viewStart);
        const ve = viewEnd ? startOfDay(viewEnd) : vs;
        const isSingleDay =
          vs.getTime() === ve.getTime() || addDays(vs, 1).getTime() === ve.getTime();
        if (isSingleDay) day = vs;
      }
      return { start: day, end: day, label: fmtDate(day) };
    }
    case "view": {
      const start = viewStart ? startOfDay(viewStart) : today;
      // FullCalendar end is exclusive — step back one day for inclusive range
      const end = viewEnd ? addDays(startOfDay(viewEnd), -1) : today;
      return { start, end: end < start ? start : end, label: `${fmtDate(start)} … ${fmtDate(end)}` };
    }
    case "week": {
      const dow = (now.getDay() + 6) % 7; // Monday = 0
      const start = addDays(today, -dow);
      return { start, end: addDays(start, 6), label: `${fmtDate(start)} … ${fmtDate(addDays(start, 6))}` };
    }
    case "lastWeek": {
      const dow = (now.getDay() + 6) % 7;
      const start = addDays(today, -dow - 7);
      return { start, end: addDays(start, 6), label: `${fmtDate(start)} … ${fmtDate(addDays(start, 6))}` };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start, end, label: `${fmtDate(start)} … ${fmtDate(end)}` };
    }
    case "last7": {
      const start = addDays(today, -6);
      return { start, end: today, label: `${fmtDate(start)} … ${fmtDate(today)}` };
    }
    case "last30": {
      const start = addDays(today, -29);
      return { start, end: today, label: `${fmtDate(start)} … ${fmtDate(today)}` };
    }
  }
}

interface PeriodStats {
  total: number;
  done: number;
  overdue: number;
  hours: number;
  byDay: { date: string; total: number; done: number; minutes: number }[];
  lines: string[];
}

function collectPeriodTasks(start: Date, end: Date): { stats: PeriodStats; list: ITask[] } {
  const startStr = fmtDate(start);
  const endStr = fmtDate(end);
  const list: ITask[] = [];
  const dayMap = new Map<string, { total: number; done: number; minutes: number }>();

  for (const t of get(tasks)) {
    const d = extractDate(t.dateUID);
    if (!d || d < startStr || d > endStr) continue;
    list.push(t);
    const slot = dayMap.get(d) ?? { total: 0, done: 0, minutes: 0 };
    slot.total += 1;
    if (t.status === "done") slot.done += 1;
    slot.minutes += minutesOf(t);
    dayMap.set(d, slot);
  }

  list.sort((a, b) => {
    const da = extractDate(a.dateUID) || "";
    const db = extractDate(b.dateUID) || "";
    if (da !== db) return da < db ? -1 : 1;
    return (a.scheduledTime || "").localeCompare(b.scheduledTime || "");
  });

  const todayStr = fmtDate(new Date());
  let done = 0;
  let overdue = 0;
  let totalMin = 0;
  const lines: string[] = [];

  for (const t of list.slice(0, MAX_TASKS)) {
    const d = extractDate(t.dateUID) || "?";
    const min = minutesOf(t);
    totalMin += min;
    if (t.status === "done") done += 1;
    if (t.status !== "done" && d < todayStr) overdue += 1;

    const time = t.scheduledTime
      ? t.endTime
        ? `${t.scheduledTime}–${t.endTime}`
        : t.scheduledTime
      : "—";
    const status =
      t.status === "done" ? "✓" : t.status === "progress" ? "🔥" : t.status === "paused" ? "☕" : "☐";
    const prio = t.priority === "high" ? "!" : t.priority === "low" ? "↓" : "";
    lines.push(
      `- ${d} ${time} ${status}${prio} ${t.title}${t.description ? ` — ${t.description.slice(0, 120)}` : ""}`,
    );
  }

  const byDay = [...dayMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, ...v }));

  return {
    stats: {
      total: list.length,
      done,
      overdue,
      hours: Math.round((totalMin / 60) * 10) / 10,
      byDay,
      lines,
    },
    list,
  };
}

function buildSystem(action: "summary" | "load", lang: string): string {
  const isRu = lang !== "en";
  if (action === "summary") {
    return isRu
      ? `Ты — аналитик расписания. Сделай краткое саммари того, что СДЕЛАНО за период, и что осталось.
Формат markdown:
# <заголовок>
## Сделано
- ключевые результаты (3–8 пунктов, группируй похожее)
## Осталось / просрочено
- что не закрыто, что горит
## Заметки
- 2–3 коротких наблюдения
Пиши на русском. Без воды. Только факты из списка задач.`
      : `You are a schedule analyst. Summarize what was DONE in the period and what is left.
Markdown format:
# <title>
## Done
- key results (3–8 bullets, group similar)
## Left / overdue
- unfinished, hot items
## Notes
- 2–3 short observations
Write in English. No fluff. Facts from the task list only.`;
  }
  return isRu
    ? `Ты — аналитик нагрузки. Оцени загрузку за период по списку задач (есть время, длительность, статусы, по дням).
Формат markdown:
# <заголовок>
## Нагрузка
- всего задач, часов, сделано, просрочено
- пики и провалы по дням (коротко)
## Оценка
- перегруз / норма / недозагруз (1–2 предложения)
## Рекомендации
- 2–4 практических совета, которые можно ПРИМЕНИТЬ к расписанию
- называй задачи точными заголовками из списка
- формулируй как действие: «сдвинь … на день», «закрой …», «перенеси … на завтра»
Пиши на русском. Опирайся на цифры из данных.`
    : `You are a workload analyst. Assess load over the period from the task list (times, durations, statuses, per day).
Markdown format:
# <title>
## Load
- totals: tasks, hours, done, overdue
- peaks and dips by day (brief)
## Verdict
- overloaded / balanced / light (1–2 sentences)
## Recommendations
- 2–4 practical tips that can be APPLIED to the schedule
- name tasks by their exact titles from the list
- phrase as actions: "move … by a day", "complete …", "reschedule … to tomorrow"
Write in English. Ground claims in the numbers.`;
}

export class AIScheduleModal extends CustomModal {
  private periodKey: PeriodKey = "view";
  private mode: UIMode = "analyze";
  private analysisKind: AnalysisKind = "load";
  private resultText = "";
  private analysisText = "";
  private isRunning = false;
  private abort: AbortController | null = null;

  private viewStart: Date | null;
  private viewEnd: Date | null;
  private rangeLabelEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private outputEl: HTMLElement | null = null;
  private modelCaptionEl: HTMLElement | null = null;
  private runBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private copyBtn: HTMLButtonElement | null = null;
  private applyBtn: HTMLButtonElement | null = null;
  private applyRecsBtn: HTMLButtonElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private analyzePanel: HTMLElement | null = null;
  private commandPanel: HTMLElement | null = null;
  private periodField: HTMLElement | null = null;
  private metaStrip: HTMLElement | null = null;
  private tabAnalyzeBtn: HTMLButtonElement | null = null;
  private tabCommandBtn: HTMLButtonElement | null = null;
  private promptEl: HTMLTextAreaElement | null = null;
  private pendingOps: ScheduleOpsPlan | null = null;
  private showingOps = false;
  /** Persists workout profile (same as the standalone workout command). */
  private saveOptions?: (changes: { workoutProfile?: unknown }) => Promise<void>;

  constructor(
    app: App,
    viewStart?: Date | null,
    viewEnd?: Date | null,
    opts?: { saveOptions?: (changes: { workoutProfile?: unknown }) => Promise<void> },
  ) {
    super(app);
    this.viewStart = viewStart ?? null;
    this.viewEnd = viewEnd ?? null;
    this.saveOptions = opts?.saveOptions;
    // Day view → default to the single-day period
    if (viewStart && viewEnd) {
      const vs = startOfDay(viewStart);
      const ve = startOfDay(viewEnd);
      if (vs.getTime() === ve.getTime() || addDays(vs, 1).getTime() === ve.getTime()) {
        this.periodKey = "day";
      }
    }
  }

  onOpen(): void {
    this.contentEl.addClass("ai-schedule-modal");
    this.containerEl?.addClass("ai-schedule-shell");

    // ── Header ──
    const head = this.contentEl.createDiv({ cls: "ai-sch-head" });
    const icon = head.createDiv({ cls: "ai-sch-head-icon" });
    icon.createSpan({ text: "✨" });
    const headText = head.createDiv({ cls: "ai-sch-head-text" });
    headText.createEl("h2", { text: tRaw("schedule.aiActionsTitle"), cls: "ai-sch-title" });
    headText.createDiv({ text: tRaw("schedule.aiActionsSub"), cls: "ai-sch-subtitle" });

    // ── Mode tabs (segmented) ──
    const tabs = this.contentEl.createDiv({ cls: "ai-sch-tabs", attr: { role: "tablist" } });
    this.tabAnalyzeBtn = tabs.createEl("button", {
      cls: "ai-sch-tab is-active",
      text: tRaw("schedule.aiTabAnalyze"),
      attr: { type: "button", role: "tab", "aria-selected": "true" },
    });
    this.tabCommandBtn = tabs.createEl("button", {
      cls: "ai-sch-tab",
      text: tRaw("schedule.aiTabCommand"),
      attr: { type: "button", role: "tab", "aria-selected": "false" },
    });
    this.tabAnalyzeBtn.addEventListener("click", () => this.setMode("analyze"));
    this.tabCommandBtn.addEventListener("click", () => this.setMode("command"));

    // Quick launcher for the workout planner
    const woRow = this.contentEl.createDiv({ cls: "ai-wo-launch" });
    const woBtn = woRow.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-ghost ai-wo-launch-btn",
      text: `💪 ${tRaw("schedule.aiWorkoutOpen")}`,
      attr: { type: "button" },
    });
    woBtn.addEventListener("click", () => void this.openWorkoutPlan());

    // ── Analyze controls: period + analysis kind ──
    this.analyzePanel = this.contentEl.createDiv({ cls: "ai-sch-panel" });
    const panel = this.analyzePanel;

    this.periodField = panel.createDiv({ cls: "ai-sch-field" });
    this.periodField.createEl("label", { text: tRaw("schedule.aiPeriod"), cls: "ai-sch-field-label" });
    const periodSel = this.periodField.createEl("select", { cls: "ai-sch-select" });
    const periods: Array<[PeriodKey, string]> = [
      ["day", tRaw("schedule.aiPeriodDay")],
      ["view", tRaw("schedule.aiPeriodView")],
      ["week", tRaw("schedule.aiPeriodWeek")],
      ["lastWeek", tRaw("schedule.aiPeriodLastWeek")],
      ["month", tRaw("schedule.aiPeriodMonth")],
      ["last7", tRaw("schedule.aiPeriodLast7")],
      ["last30", tRaw("schedule.aiPeriodLast30")],
    ];
    for (const [val, label] of periods) {
      const opt = periodSel.createEl("option", { value: val, text: label });
      if (val === this.periodKey) opt.selected = true;
    }
    periodSel.addEventListener("change", () => {
      this.periodKey = periodSel.value as PeriodKey;
      this.refreshStats();
    });

    // Analysis kind: two compact chips (clearer than a select)
    const kindField = panel.createDiv({ cls: "ai-sch-field" });
    kindField.createEl("label", {
      text: tRaw("schedule.aiAnalysisKind"),
      cls: "ai-sch-field-label",
    });
    const kindRow = kindField.createDiv({ cls: "ai-sch-seg" });
    const kindLoad = kindRow.createEl("button", {
      cls: "ai-sch-seg-btn is-active",
      text: tRaw("schedule.aiActionLoad"),
      attr: { type: "button" },
    });
    const kindSum = kindRow.createEl("button", {
      cls: "ai-sch-seg-btn",
      text: tRaw("schedule.aiActionSummary"),
      attr: { type: "button" },
    });
    kindLoad.addEventListener("click", () => {
      if (this.analysisKind !== "load") this.clearAnalysisOutput();
      this.analysisKind = "load";
      kindLoad.addClass("is-active");
      kindSum.removeClass("is-active");
      this.syncFooter();
    });
    kindSum.addEventListener("click", () => {
      if (this.analysisKind !== "summary") this.clearAnalysisOutput();
      this.analysisKind = "summary";
      kindSum.addClass("is-active");
      kindLoad.removeClass("is-active");
      this.syncFooter();
    });

    // ── Command controls: free-text instruction ──
    this.commandPanel = this.contentEl.createDiv({
      cls: "ai-sch-panel ai-sch-command-panel mcp-hidden",
    });
    const promptField = this.commandPanel.createDiv({ cls: "ai-sch-field ai-sch-prompt" });
    const promptLabelRow = promptField.createDiv({ cls: "ai-sch-field-label-row" });
    promptLabelRow.createEl("label", {
      text: tRaw("schedule.aiPromptLabel"),
      cls: "ai-sch-field-label",
    });
    promptLabelRow.createSpan({
      text: tRaw("schedule.aiPromptHint"),
      cls: "ai-sch-field-hint",
    });
    this.promptEl = promptField.createEl("textarea", {
      cls: "ai-sch-prompt-input",
      attr: {
        rows: "3",
        placeholder: tRaw("schedule.aiPromptPlaceholder"),
        spellcheck: "false",
      },
    });
    this.promptEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void this.run();
      }
    });

    // ── Meta strip: range + live stats (analyze only) ──
    this.metaStrip = this.contentEl.createDiv({ cls: "ai-sch-meta" });
    this.rangeLabelEl = this.metaStrip.createDiv({ cls: "ai-sch-range" });
    this.statsEl = this.metaStrip.createDiv({ cls: "ai-sch-chips" });

    // Status line
    this.statusEl = this.contentEl.createDiv({ cls: "ai-sch-status" });
    this.statusEl.createSpan({ cls: "ai-sch-spinner", attr: { "aria-hidden": "true" } });
    this.statusEl.createSpan({ cls: "ai-sch-status-text", text: tRaw("schedule.aiReady") });

    // Output stage — model caption lives ABOVE the framed field, not inside it
    this.modelCaptionEl = this.contentEl.createDiv({ cls: "ai-model-caption-slot" });
    const scanShell = this.contentEl.createDiv({ cls: "ai-sch-scan" });
    this.outputEl = scanShell.createDiv({ cls: "ai-sch-output" });
    this.renderEmptyState();

    // Footer: secondary left, primary right
    const btnRow = this.contentEl.createDiv({ cls: "ai-sch-actions" });
    const left = btnRow.createDiv({ cls: "ai-sch-actions-left" });
    const right = btnRow.createDiv({ cls: "ai-sch-actions-right" });

    this.stopBtn = left.createEl("button", {
      cls: "ai-sch-btn",
      text: tRaw("schedule.aiStop"),
      attr: { type: "button", disabled: "true" },
    });
    this.stopBtn.addEventListener("click", () => this.abort?.abort());

    this.copyBtn = left.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-ghost",
      text: tRaw("schedule.aiCopy"),
      attr: { type: "button" },
    });
    this.copyBtn.addEventListener("click", () => {
      const text = this.resultText || this.outputEl?.textContent || "";
      if (!text.trim()) return;
      void navigator.clipboard.writeText(text);
      new Notice(tRaw("schedule.aiDone"));
    });

    this.saveBtn = left.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-ghost",
      text: tRaw("schedule.aiSaveNote"),
      attr: { type: "button", disabled: "true" },
    });
    this.saveBtn.addEventListener("click", () => void this.saveNote());

    this.backBtn = left.createEl("button", {
      cls: "ai-sch-btn mcp-hidden",
      text: tRaw("schedule.aiOpsBack"),
      attr: { type: "button" },
    });
    this.backBtn.addEventListener("click", () => this.backFromOps());

    this.applyRecsBtn = right.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-accent",
      text: tRaw("schedule.aiApplyRecs"),
      attr: { type: "button", disabled: "true" },
    });
    this.applyRecsBtn.addEventListener("click", () => void this.runRecsToOps());

    this.applyBtn = right.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-primary mcp-hidden",
      text: tRaw("schedule.aiOpsApply"),
      attr: { type: "button", disabled: "true" },
    });
    this.applyBtn.addEventListener("click", () => this.applyOps());

    this.runBtn = right.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-primary",
      text: `⚡ ${tRaw("schedule.aiRun")}`,
      attr: { type: "button" },
    });
    this.runBtn.addEventListener("click", () => void this.run());

    this.syncMode();
    this.refreshStats();
  }

  /** Drop previous analysis text so switching kind never shows stale recommendations. */
  private clearAnalysisOutput(): void {
    this.resultText = "";
    this.analysisText = "";
    this.showingOps = false;
    this.pendingOps = null;
    this.renderEmptyState();
    this.setStatus(tRaw("schedule.aiReady"));
    this.syncFooter();
  }

  private renderEmptyState(): void {
    const el = this.outputEl;
    if (!el) return;
    el.empty();
    const empty = el.createDiv({ cls: "ai-sch-empty" });
    empty.createDiv({
      cls: "ai-sch-empty-icon",
      text: this.mode === "command" ? "⚡" : "📊",
    });
    empty.createDiv({
      cls: "ai-sch-empty-title",
      text:
        this.mode === "command"
          ? tRaw("schedule.aiEmptyCmdTitle")
          : tRaw("schedule.aiEmptyAnTitle"),
    });
    empty.createDiv({
      cls: "ai-sch-empty-hint",
      text:
        this.mode === "command"
          ? tRaw("schedule.aiEmptyCmdHint")
          : tRaw("schedule.aiEmptyAnHint"),
    });
  }

  /** Thinking dots while the model runs — full text appears only when done. */
  private renderTyping(role: "reason" | "extract" = "reason"): void {
    const el = this.outputEl;
    if (!el) return;
    const opts = get(settings) as {
      ollamaModel?: string;
      ollamaModelMode?: "single" | "dual";
      ollamaModelExtract?: string;
    };
    // Spinner centered in the field; model label lives ABOVE the field
    mountTypingBlock(el, resolveModel(role, opts), this.modelCaptionEl);
  }

  /** Analyze vs command: panels + which footer buttons make sense. */
  private setMode(mode: UIMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.tabAnalyzeBtn?.classList.toggle("is-active", mode === "analyze");
    this.tabCommandBtn?.classList.toggle("is-active", mode === "command");
    this.tabAnalyzeBtn?.setAttribute("aria-selected", mode === "analyze" ? "true" : "false");
    this.tabCommandBtn?.setAttribute("aria-selected", mode === "command" ? "true" : "false");
    // Leaving a mode resets its output/ops state
    this.showingOps = false;
    this.pendingOps = null;
    this.resultText = "";
    this.analysisText = "";
    this.renderEmptyState();
    this.setStatus(tRaw("schedule.aiReady"));
    this.syncMode();
    this.refreshStats();
    if (mode === "command") {
      window.setTimeout(() => this.promptEl?.focus(), 50);
    }
  }

  private async openWorkoutPlan(): Promise<void> {
    const opts = get(settings) as {
      ollamaEnabled?: boolean;
      aiWorkoutEnabled?: boolean;
    };
    if (!opts.ollamaEnabled) {
      new Notice(tRaw("schedule.aiNeedOllama"));
      return;
    }
    if (opts.aiWorkoutEnabled === false) {
      new Notice(tRaw("schedule.aiWorkoutDisabled"));
      return;
    }
    try {
      const { WorkoutPlanModal } = await import("../workout/WorkoutPlanModal");
      new WorkoutPlanModal(this.app, {
        saveOptions: async (changes) => {
          if (this.saveOptions) {
            await this.saveOptions(changes);
            return;
          }
          // Fallback: merge profile into the settings store
          const { settings: settingsStore } = await import("../ui/stores");
          settingsStore.update((cur) => ({
            ...cur,
            workoutProfile: changes.workoutProfile,
          }));
        },
      }).open();
    } catch (e) {
      new Notice(errorMessage(e));
    }
  }

  private syncMode(): void {
    const isAnalyze = this.mode === "analyze";
    this.analyzePanel?.toggleClass("mcp-hidden", !isAnalyze);
    this.commandPanel?.toggleClass("mcp-hidden", isAnalyze);
    this.metaStrip?.classList.toggle("mcp-hidden", !isAnalyze);
    this.syncFooter();
  }

  /** Footer visibility: analyze / command / ops-preview. */
  private syncFooter(): void {
    const ops = this.showingOps;
    const isAnalyze = this.mode === "analyze";

    this.runBtn?.classList.toggle("mcp-hidden", ops);
    this.stopBtn?.classList.toggle("mcp-hidden", ops);
    this.copyBtn?.classList.toggle("mcp-hidden", ops || !isAnalyze);
    this.saveBtn?.classList.toggle("mcp-hidden", ops || !isAnalyze);
    this.applyRecsBtn?.classList.toggle("mcp-hidden", ops || !isAnalyze);
    this.backBtn?.classList.toggle("mcp-hidden", !ops);
    this.applyBtn?.classList.toggle("mcp-hidden", !ops);

    if (this.applyBtn) this.applyBtn.disabled = !(this.pendingOps?.operations.length);
    // "What was done" is retrospective — no apply-recommendations path
    const recsAllowed = isAnalyze && this.analysisKind === "load" && !!this.analysisText.trim();
    if (this.applyRecsBtn) this.applyRecsBtn.disabled = !recsAllowed;
    if (this.saveBtn) this.saveBtn.disabled = !this.analysisText.trim();
  }

  private setStatus(text: string, kind: "idle" | "busy" | "error" | "ok" = "idle"): void {
    if (!this.statusEl) return;
    this.statusEl.classList.remove("busy", "error", "ok");
    if (kind !== "idle") this.statusEl.classList.add(kind);
    const label = this.statusEl.querySelector(".ai-sch-status-text");
    if (label) label.textContent = text;
  }

  private setScanning(on: boolean): void {
    this.contentEl.toggleClass("scanning", on);
    this.contentEl.toggleClass("generating", on);
  }

  /** Parse inline markdown (bold/italic/code/link/strike) into a container. */
  private renderInline(host: HTMLElement, text: string): void {
    // Tokenize: `code`, **bold**, *italic* / _italic_, ~~strike~~, [label](url)
    const re =
      /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)]+\))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    const pushText = (s: string) => {
      if (s) host.append(document.createTextNode(s));
    };
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) pushText(text.slice(last, m.index));
      const tok = m[0];
      if (m[1]) {
        host.createEl("code", { text: tok.slice(1, -1), cls: "ai-sch-out-code" });
      } else if (m[2]) {
        host.createEl("strong", {
          text: tok.replace(/^\*\*|^__|\*\*$|__$/g, ""),
          cls: "ai-sch-out-strong",
        });
      } else if (m[3]) {
        host.createEl("em", {
          text: tok.slice(1, -1),
          cls: "ai-sch-out-em",
        });
      } else if (m[4]) {
        host.createEl("s", {
          text: tok.slice(2, -2),
          cls: "ai-sch-out-strike",
        });
      } else if (m[5]) {
        const linkM = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
        if (linkM) {
          const a = host.createEl("a", {
            text: linkM[1],
            cls: "ai-sch-out-link",
            href: linkM[2],
          });
          a.setAttribute("rel", "noopener noreferrer");
        }
      }
      last = m.index + tok.length;
    }
    pushText(text.slice(last));
  }

  /** Render markdown-ish text as a readable document (not an input). */
  private renderOutput(md: string): void {
    const el = this.outputEl;
    if (!el) return;
    if (!md.trim()) {
      this.renderEmptyState();
      return;
    }
    el.empty();
    const lines = md.split(/\r?\n/);
    let listEl: HTMLElement | null = null;

    const closeList = () => {
      listEl = null;
    };

    const isTableRow = (s: string) =>
      /^\s*\|.*\|\s*$/.test(s) || (s.includes("|") && s.trim().startsWith("|"));
    const isTableSep = (s: string) =>
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(s) && s.includes("-");

    const splitRow = (s: string): string[] =>
      s
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());

    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trimEnd();

      // Fenced code block ``` ... ```
      if (/^\s*```/.test(line)) {
        closeList();
        i++;
        const buf: string[] = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++; // skip closing fence
        const pre = el.createEl("pre", { cls: "ai-sch-out-pre" });
        pre.createEl("code", { text: buf.join("\n"), cls: "ai-sch-out-codeblock" });
        continue;
      }

      // Table
      if (
        isTableRow(line) &&
        i + 1 < lines.length &&
        isTableSep(lines[i + 1]) &&
        isTableRow(lines[i + 1])
      ) {
        closeList();
        const wrap = el.createDiv({ cls: "ai-sch-out-table-wrap" });
        const table = wrap.createEl("table", { cls: "ai-sch-out-table" });
        const thead = table.createEl("thead");
        const headTr = thead.createEl("tr");
        for (const cell of splitRow(line)) {
          const th = headTr.createEl("th", { cls: "ai-sch-out-th" });
          this.renderInline(th, cell);
        }
        const tbody = table.createEl("tbody");
        i += 2;
        while (i < lines.length && isTableRow(lines[i]) && lines[i].trim()) {
          const tr = tbody.createEl("tr", { cls: "ai-sch-out-tr" });
          for (const cell of splitRow(lines[i])) {
            const td = tr.createEl("td", { cls: "ai-sch-out-td" });
            this.renderInline(td, cell);
          }
          i++;
        }
        continue;
      }

      if (!line.trim()) {
        closeList();
        el.createDiv({ cls: "ai-sch-out-spacer" });
        i++;
        continue;
      }

      if (/^#{1,6}\s+/.test(line)) {
        closeList();
        const level = Math.min(6, line.match(/^#+/)?.[0].length || 1);
        const text = line.replace(/^#{1,6}\s+/, "");
        const tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[level - 1];
        const h = el.createEl(tag, { cls: `ai-sch-out-h ai-sch-out-h${level}` });
        this.renderInline(h, text);
        i++;
        continue;
      }

      // Blockquote
      if (/^\s*>\s?/.test(line)) {
        closeList();
        const quote = el.createEl("blockquote", { cls: "ai-sch-out-quote" });
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          const qLine = lines[i].replace(/^\s*>\s?/, "");
          const p = quote.createEl("p", { cls: "ai-sch-out-p" });
          this.renderInline(p, qLine);
          i++;
        }
        continue;
      }

      // Task list item  - [ ] / - [x]
      const taskM = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (taskM) {
        closeList();
        const wrap = el.createDiv({ cls: "ai-sch-out-task" });
        const box = wrap.createDiv({
          cls: `ai-sch-out-check${taskM[1].toLowerCase() === "x" ? " is-done" : ""}`,
        });
        if (taskM[1].toLowerCase() === "x") box.createSpan({ text: "✓", cls: "ai-sch-out-check-mark" });
        const label = wrap.createDiv({ cls: "ai-sch-out-task-label" });
        this.renderInline(label, taskM[2]);
        if (label.querySelector(".ai-sch-out-strike")) label.addClass("is-done");
        i++;
        continue;
      }

      // Bullet / numbered list
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const text = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
        if (!listEl) {
          listEl = ordered
            ? el.createEl("ol", { cls: "ai-sch-out-list ai-sch-out-list--ol" })
            : el.createEl("ul", { cls: "ai-sch-out-list" });
        }
        const li = listEl.createEl("li", { cls: "ai-sch-out-li" });
        this.renderInline(li, text);
        i++;
        continue;
      }

      if (/^\s*---+\s*$/.test(line) || /^\s*\*\*\*\s*$/.test(line)) {
        closeList();
        el.createDiv({ cls: "ai-sch-out-rule" });
        i++;
        continue;
      }

      closeList();
      const p = el.createEl("p", { cls: "ai-sch-out-p" });
      this.renderInline(p, line.trim());
      i++;
    }
  }

  onClose(): void {
    this.abort?.abort();
    this.abort = null;
    this.isRunning = false;
    this.setScanning(false);
  }

  private currentRange(): { start: Date; end: Date; label: string } {
    return periodRange(this.periodKey, this.viewStart, this.viewEnd);
  }

  private refreshStats(): void {
    const { start, end, label } = this.currentRange();
    if (this.rangeLabelEl) this.rangeLabelEl.textContent = label;

    const { stats } = collectPeriodTasks(start, end);
    if (this.statsEl) {
      this.statsEl.empty();
      const chips: Array<[string, string]> = [
        ["total", String(stats.total)],
        ["done", String(stats.done)],
        ["overdue", String(stats.overdue)],
        ["hours", `${stats.hours}h`],
      ];
      for (const [kind, val] of chips) {
        const chip = this.statsEl.createDiv({ cls: `ai-sch-chip ai-sch-chip--${kind}` });
        chip.createSpan({ text: val, cls: "ai-sch-chip-val" });
        chip.createSpan({
          text:
            kind === "total"
              ? tRaw("schedule.aiChipTotal")
              : kind === "done"
                ? tRaw("schedule.aiChipDone")
                : kind === "overdue"
                  ? tRaw("schedule.aiChipOverdue")
                  : tRaw("schedule.aiChipHours"),
          cls: "ai-sch-chip-label",
        });
      }
    }
  }

  private buildUserPrompt(): string {
    const { start, end } = this.currentRange();
    const { stats } = collectPeriodTasks(start, end);
    const lang = tRaw("locale.momentLocale") === "ru" ? "ru" : "en";

    const dayRows = stats.byDay
      .map((d) => `${d.date}: ${d.done}/${d.total} done, ${Math.round((d.minutes / 60) * 10) / 10}h`)
      .join("\n");

    return [
      `Period: ${fmtDate(start)} … ${fmtDate(end)}`,
      `Language: ${lang}`,
      `Totals: ${stats.total} tasks, ${stats.done} done, ${stats.overdue} overdue, ~${stats.hours}h`,
      ``,
      `Per day:`,
      dayRows || "(none)",
      ``,
      `Tasks:`,
      ...stats.lines,
    ].join("\n");
  }

  private async run(): Promise<void> {
    if (this.isRunning) return;

    const opts = get(settings) as {
      ollamaEnabled?: boolean;
      ollamaUrl?: string;
      ollamaModel?: string;
      ollamaModelMode?: "single" | "dual";
      ollamaModelExtract?: string;
    };
    if (!opts.ollamaEnabled) {
      new Notice(tRaw("schedule.aiNeedOllama"));
      return;
    }

    if (this.mode === "command") {
      await this.runOps(opts);
      return;
    }

    const { start, end } = this.currentRange();
    const { stats } = collectPeriodTasks(start, end);
    if (stats.total === 0) {
      this.setStatus(tRaw("schedule.aiEmptyPeriod"), "error");
      return;
    }

    this.isRunning = true;
    this.abort = new AbortController();
    this.showingOps = false;
    this.pendingOps = null;
    this.analysisText = "";
    if (this.runBtn) this.runBtn.disabled = true;
    if (this.stopBtn) this.stopBtn.disabled = false;
    this.syncFooter();
    this.setStatus("");
    this.setScanning(true);
    this.renderTyping("reason");

    const lang = tRaw("locale.momentLocale") === "ru" ? "ru" : "en";

    try {
      const result = await streamOllamaChat(
        opts.ollamaUrl || "http://localhost:11434",
        resolveModel("reason", opts),
        [
          { role: "system", content: buildSystem(this.analysisKind, lang) },
          { role: "user", content: this.buildUserPrompt() },
        ],
        {
          signal: this.abort.signal,
          temperature: 0.3,
          onDelta: (full) => {
            this.resultText = full;
            this.analysisText = full;
          },
        },
      );

      this.resultText = result.trim();
      this.analysisText = this.resultText;
      this.renderOutput(this.resultText);
      this.setStatus(tRaw("schedule.aiDone"), "ok");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        this.setStatus(tRaw("ai.summaryCancelled"));
        this.renderEmptyState();
      } else {
        const msg = errorMessage(e);
        this.setStatus(tRaw("ai.error", { error: msg }), "error");
        new Notice(tRaw("ai.error", { error: msg }));
        this.renderEmptyState();
      }
    } finally {
      this.isRunning = false;
      this.abort = null;
      this.setScanning(false);
      if (this.runBtn) this.runBtn.disabled = false;
      if (this.stopBtn) this.stopBtn.disabled = true;
      this.syncFooter();
    }
  }

  /**
   * Second pass: analysis text → ops plan → preview.
   * Mutations only after the user hits Apply.
   */
  private async runRecsToOps(): Promise<void> {
    if (this.isRunning || !this.analysisText.trim()) return;
    // Retrospective "what was done" has no applyable recommendations
    if (this.analysisKind !== "load") return;

    const opts = get(settings) as {
      ollamaEnabled?: boolean;
      ollamaUrl?: string;
      ollamaModel?: string;
      ollamaModelMode?: "single" | "dual";
      ollamaModelExtract?: string;
    };
    if (!opts.ollamaEnabled) {
      new Notice(tRaw("schedule.aiNeedOllama"));
      return;
    }

    this.isRunning = true;
    this.abort = new AbortController();
    if (this.runBtn) this.runBtn.disabled = true;
    if (this.stopBtn) this.stopBtn.disabled = false;
    if (this.applyRecsBtn) this.applyRecsBtn.disabled = true;
    this.setStatus(tRaw("schedule.aiOpsPlanning"), "busy");
    this.setScanning(true);
    this.renderTyping("extract");

    try {
      const raw = await streamOllamaChat(
        opts.ollamaUrl || "http://localhost:11434",
        resolveModel("extract", opts),
        [
          { role: "system", content: buildRecsToOpsSystem() },
          { role: "user", content: buildRecsToOpsUser(this.analysisText) },
        ],
        {
          signal: this.abort.signal,
          format: "json",
          temperature: 0.1,
        },
      );

      const plan = parseScheduleOps(raw);
      this.pendingOps = plan;
      this.showingOps = true;
      this.renderOpsPreview(plan);
      this.syncFooter();
      if (plan.operations.length === 0) {
        this.setStatus(tRaw("schedule.aiOpsEmpty"), "idle");
      } else {
        this.setStatus(
          tRaw("schedule.aiOpsReady", { count: String(plan.operations.length) }),
          "ok",
        );
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        this.setStatus(tRaw("ai.summaryCancelled"));
        this.renderEmptyState();
      } else {
        const msg = errorMessage(e);
        this.setStatus(tRaw("ai.error", { error: msg }), "error");
        new Notice(tRaw("ai.error", { error: msg }));
        this.renderEmptyState();
      }
    } finally {
      this.isRunning = false;
      this.abort = null;
      this.setScanning(false);
      if (this.runBtn) this.runBtn.disabled = false;
      if (this.stopBtn) this.stopBtn.disabled = true;
      this.syncFooter();
    }
  }

  /** Leave ops preview → back to analysis text. */
  private backFromOps(): void {
    this.showingOps = false;
    this.pendingOps = null;
    if (this.analysisText.trim()) {
      this.resultText = this.analysisText;
      this.renderOutput(this.analysisText);
      this.setStatus(tRaw("schedule.aiDone"), "ok");
    } else {
      this.renderOutput("");
      this.setStatus(tRaw("schedule.aiReady"));
    }
    this.syncFooter();
  }

  /** NL command → structured ops plan → preview (no mutations until Apply). */
  private async runOps(opts: {
    ollamaUrl?: string;
    ollamaModel?: string;
    ollamaModelMode?: "single" | "dual";
    ollamaModelExtract?: string;
  }): Promise<void> {
    const instruction = (this.promptEl?.value || "").trim();
    if (!instruction) {
      this.setStatus(tRaw("schedule.aiPromptEmpty"), "error");
      return;
    }

    this.isRunning = true;
    this.abort = new AbortController();
    if (this.runBtn) this.runBtn.disabled = true;
    if (this.stopBtn) this.stopBtn.disabled = false;
    this.pendingOps = null;
    this.showingOps = false;
    this.setStatus(tRaw("schedule.aiOpsPlanning"), "busy");
    this.setScanning(true);
    this.renderTyping("extract");
    this.syncFooter();

    try {
      const raw = await streamOllamaChat(
        opts.ollamaUrl || "http://localhost:11434",
        resolveModel("extract", opts),
        [
          { role: "system", content: buildScheduleOpsSystem() },
          {
            role: "user",
            content: `${buildScheduleOpsContext()}\n\nUser instruction:\n${instruction}`,
          },
        ],
        {
          signal: this.abort.signal,
          format: "json",
          temperature: 0.1,
        },
      );

      const plan = parseScheduleOps(raw);
      this.pendingOps = plan;
      this.showingOps = true;
      this.resultText = plan.summary || "";
      this.renderOpsPreview(plan);
      this.syncFooter();
      if (plan.operations.length === 0) {
        this.setStatus(tRaw("schedule.aiOpsEmpty"), "idle");
      } else {
        this.setStatus(
          tRaw("schedule.aiOpsReady", { count: String(plan.operations.length) }),
          "ok",
        );
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        this.setStatus(tRaw("ai.summaryCancelled"));
        this.renderEmptyState();
      } else {
        const msg = errorMessage(e);
        this.setStatus(tRaw("ai.error", { error: msg }), "error");
        new Notice(tRaw("ai.error", { error: msg }));
        this.renderEmptyState();
      }
    } finally {
      this.isRunning = false;
      this.abort = null;
      this.setScanning(false);
      if (this.runBtn) this.runBtn.disabled = false;
      if (this.stopBtn) this.stopBtn.disabled = true;
      this.syncFooter();
    }
  }

  private renderOpsPreview(plan: ScheduleOpsPlan): void {
    const el = this.outputEl;
    if (!el) return;
    el.empty();

    const card = el.createDiv({
      cls: plan.operations.length
        ? "ai-sch-ops-card"
        : "ai-sch-ops-card is-empty",
    });
    const head = card.createDiv({ cls: "ai-sch-ops-head" });
    head.createDiv({ cls: "ai-sch-ops-badge", text: tRaw("schedule.aiOpsBadge") });
    head.createDiv({
      cls: "ai-sch-ops-summary",
      text: plan.summary || tRaw("schedule.aiOpsPreview"),
    });

    if (plan.operations.length === 0) {
      card.createDiv({
        cls: "ai-sch-empty-hint",
        text: tRaw("schedule.aiOpsEmpty"),
      });
      return;
    }

    const list = get(tasks);
    const ul = card.createEl("ul", { cls: "ai-sch-ops-list" });
    plan.operations.forEach((op, i) => {
      const li = ul.createEl("li", { cls: "ai-sch-ops-item" });
      li.createDiv({ cls: "ai-sch-ops-num", text: String(i + 1) });
      li.createDiv({ cls: "ai-sch-ops-text", text: describeOp(op, list) });
    });
  }

  private applyOps(): void {
    const plan = this.pendingOps;
    if (!plan || plan.operations.length === 0) return;
    const { applied, skipped, warnings } = applyScheduleOps(plan.operations);
    this.pendingOps = null;
    this.showingOps = false;
    this.applyBtn?.classList.add("mcp-hidden");
    this.backBtn?.classList.add("mcp-hidden");
    this.setStatus(tRaw("schedule.aiOpsApplied", { count: String(applied) }), "ok");
    new Notice(tRaw("schedule.aiOpsApplied", { count: String(applied) }));
    for (const w of warnings) {
      new Notice(w, 8000);
    }
    if (skipped > 0) {
      new Notice(tRaw("schedule.aiOpsSkipped", { count: String(skipped) }));
    }
    // In analyze mode return to the analysis text after apply
    if (this.mode === "analyze" && this.analysisText.trim()) {
      this.resultText = this.analysisText;
      this.renderOutput(this.analysisText);
    } else {
      this.renderOutput("");
    }
    this.syncFooter();
  }

  private async saveNote(): Promise<void> {
    const text = this.resultText;
    if (!text.trim()) return;

    const { start, end } = this.currentRange();
    const kind =
      this.analysisKind === "load"
        ? tRaw("schedule.aiActionLoad")
        : tRaw("schedule.aiActionSummary");
    const title = `${kind} ${fmtDate(start)}–${fmtDate(end)}`;
    const path = normalizePath(`${title}.md`);

    try {
      const existing = this.app.vault.getAbstractFileByPath(path);
      const body = `# ${title}\n\n${text}\n`;
      if (existing instanceof TFileClass) {
        await this.app.vault.modify(existing, body);
      } else {
        await this.app.vault.create(path, body);
      }
      new Notice(path);
    } catch (e) {
      new Notice(errorMessage(e));
    }
  }
}
