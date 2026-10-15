import { Notice } from "obsidian";
import type { App } from "obsidian";
import { get } from "svelte/store";
import { CustomModal } from "../ui/CustomModal";
import { tRaw, tArrayRaw, locale } from "../i18n";
import { settings } from "../ui/stores";
import { projects } from "../task-tracker/stores";
import { resolveModel } from "../services/OllamaService";
import { errorMessage } from "../utils/sanitize";
import {
  defaultWorkoutProfile,
  formatExercise,
  parseExerciseLine,
  weekdayLabel,
  type WorkoutDayPlan,
  type WorkoutGender,
  type WorkoutGoal,
  type WorkoutLevel,
  type WorkoutLocation,
  type WorkoutPlan,
  type WorkoutProfile,
} from "./types";
import { generateWorkoutPlan } from "./workoutAI";
import { createWorkoutPlanTasks } from "./planBuilder";

const GOALS: WorkoutGoal[] = [
  "strength",
  "muscle",
  "weightloss",
  "endurance",
  "health",
  "flexibility",
];
const LEVELS: WorkoutLevel[] = ["beginner", "intermediate", "advanced"];
const LOCATIONS: WorkoutLocation[] = ["gym", "home", "outdoors"];
const GENDERS: WorkoutGender[] = ["male", "female"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Weekday display order (moment indices) per Start-of-week setting. */
function weekDayOrder(): number[] {
  const sow: string = get(settings).startOfWeek || "system";
  if (sow === "monday") return [1, 2, 3, 4, 5, 6, 0];
  if (sow === "sunday") return [0, 1, 2, 3, 4, 5, 6];
  return get(locale) === "en" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
}

export interface WorkoutPlanModalOptions {
  saveOptions: (changes: {
    workoutProfile?: WorkoutProfile;
  }) => Promise<void>;
}

export class WorkoutPlanModal extends CustomModal {
  private saveOptions: (changes: {
    workoutProfile?: WorkoutProfile;
  }) => Promise<void>;
  private profile: WorkoutProfile;
  private weeks = 4;
  private startDate = toDateInput(new Date());
  private projectId: string | null = null;
  private plan: WorkoutPlan | null = null;
  private busy = false;
  private previewEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private createBtnEl: HTMLButtonElement | null = null;
  private genBtnEl: HTMLButtonElement | null = null;

  constructor(app: App, opts: WorkoutPlanModalOptions) {
    super(app);
    this.saveOptions = opts.saveOptions;
    const stored = get(settings).workoutProfile;
    this.profile = stored
      ? { ...defaultWorkoutProfile(), ...stored }
      : defaultWorkoutProfile();
    if (this.profile.gender !== "male" && this.profile.gender !== "female") {
      this.profile.gender = "male";
    }
  }

  onOpen(): void {
    this.containerEl.addClass("workout-plan-modal");
    this.render();
  }

  private addField(
    parent: HTMLElement,
    name: string,
    build: (control: HTMLElement) => void,
  ): void {
    const row = parent.createDiv({ cls: "wo-field" });
    row.createDiv({ cls: "wo-field-label", text: name });
    const control = row.createDiv({ cls: "wo-field-control" });
    build(control);
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    this.previewEl = null;
    this.statusEl = null;
    this.createBtnEl = null;
    this.genBtnEl = null;

    const header = root.createDiv({ cls: "wo-header" });
    header.createEl("h2", { text: tRaw("workout.modalTitle"), cls: "wo-title" });
    header.createEl("p", {
      text: tRaw("workout.headerHint"),
      cls: "wo-subtitle",
    });

    // ── Compact 2-col form ───────────────────────────────────────────────
    const form = root.createDiv({ cls: "wo-form" });

    this.addField(form, tRaw("workout.gender"), (c) => {
      const seg = c.createDiv({ cls: "wo-seg" });
      for (const g of GENDERS) {
        const btn = seg.createEl("button", {
          text: tRaw(`workout.gender_${g}`),
          cls: "wo-seg-btn",
        });
        if ((this.profile.gender || "male") === g) btn.addClass("active");
        btn.addEventListener("click", () => {
          this.profile.gender = g;
          seg.querySelectorAll(".wo-seg-btn").forEach((el) => el.removeClass("active"));
          btn.addClass("active");
        });
      }
    });

    this.addField(form, tRaw("workout.goal"), (c) => {
      const sel = c.createEl("select", { cls: "wo-select" });
      for (const g of GOALS) {
        const o = sel.createEl("option", {
          value: g,
          text: tRaw(`workout.goal${g.charAt(0).toUpperCase()}${g.slice(1)}`),
        });
        if (g === this.profile.goal) o.selected = true;
      }
      sel.addEventListener("change", () => {
        this.profile.goal = sel.value as WorkoutGoal;
      });
    });

    this.addField(form, tRaw("workout.level"), (c) => {
      const seg = c.createDiv({ cls: "wo-seg" });
      for (const l of LEVELS) {
        const btn = seg.createEl("button", {
          text: tRaw(`workout.level${l.charAt(0).toUpperCase()}${l.slice(1)}`),
          cls: "wo-seg-btn",
        });
        if (this.profile.level === l) btn.addClass("active");
        btn.addEventListener("click", () => {
          this.profile.level = l;
          seg.querySelectorAll(".wo-seg-btn").forEach((el) => el.removeClass("active"));
          btn.addClass("active");
        });
      }
    });

    this.addField(form, tRaw("workout.location"), (c) => {
      const seg = c.createDiv({ cls: "wo-seg" });
      for (const l of LOCATIONS) {
        const btn = seg.createEl("button", {
          text: tRaw(`workout.location${l.charAt(0).toUpperCase()}${l.slice(1)}`),
          cls: "wo-seg-btn",
        });
        if (this.profile.location === l) btn.addClass("active");
        btn.addEventListener("click", () => {
          this.profile.location = l;
          seg.querySelectorAll(".wo-seg-btn").forEach((el) => el.removeClass("active"));
          btn.addClass("active");
        });
      }
    });

    this.addField(form, tRaw("workout.daysOfWeek"), (c) => {
      const daysBox = c.createDiv({ cls: "wo-days" });
      const weekdayLabels = tArrayRaw("common.weekdays.short");
      const order = weekDayOrder();
      for (const dow of order) {
        const chip = daysBox.createEl("button", {
          text: weekdayLabel(weekdayLabels, dow),
          cls: "wo-day-chip",
        });
        if (this.profile.daysOfWeek.includes(dow)) chip.addClass("active");
        chip.addEventListener("click", () => {
          const set = new Set(this.profile.daysOfWeek);
          if (set.has(dow)) {
            set.delete(dow);
            chip.removeClass("active");
          } else {
            set.add(dow);
            chip.addClass("active");
          }
          this.profile.daysOfWeek = [...set].sort((a, b) => a - b);
        });
      }
    });

    this.addField(form, tRaw("workout.sessionMinutes"), (c) => {
      const inp = c.createEl("input", {
        type: "number",
        cls: "wo-input",
        attr: { min: "15", max: "180", step: "5" },
      });
      inp.value = String(this.profile.sessionMinutes || 60);
      inp.addEventListener("change", () => {
        const n = parseInt(inp.value, 10);
        if (Number.isFinite(n) && n > 0) this.profile.sessionMinutes = n;
      });
    });

    this.addField(form, tRaw("workout.age"), (c) => {
      const inp = c.createEl("input", {
        type: "number",
        cls: "wo-input",
        attr: { min: "10", max: "99" },
      });
      if (this.profile.age != null) inp.value = String(this.profile.age);
      inp.placeholder = "—";
      inp.addEventListener("change", () => {
        const n = parseInt(inp.value, 10);
        this.profile.age = Number.isFinite(n) && n > 0 ? n : null;
      });
    });

    this.addField(form, tRaw("workout.weightKg"), (c) => {
      const inp = c.createEl("input", {
        type: "number",
        cls: "wo-input",
        attr: { min: "20", max: "300", step: "0.1" },
      });
      if (this.profile.weightKg != null) inp.value = String(this.profile.weightKg);
      inp.placeholder = "—";
      inp.addEventListener("change", () => {
        const n = parseFloat(inp.value);
        this.profile.weightKg = Number.isFinite(n) && n > 0 ? n : null;
      });
    });

    this.addField(form, tRaw("workout.equipment"), (c) => {
      const inp = c.createEl("input", {
        type: "text",
        cls: "wo-input",
        attr: { placeholder: tRaw("workout.equipmentPlaceholder") },
      });
      inp.value = this.profile.equipment;
      inp.addEventListener("change", () => {
        this.profile.equipment = inp.value;
      });
    });

    this.addField(form, tRaw("workout.limitations"), (c) => {
      const inp = c.createEl("input", {
        type: "text",
        cls: "wo-input",
        attr: { placeholder: tRaw("workout.limitationsPlaceholder") },
      });
      inp.value = this.profile.limitations;
      inp.addEventListener("change", () => {
        this.profile.limitations = inp.value;
      });
    });

    this.addField(form, tRaw("workout.focusAreas"), (c) => {
      const inp = c.createEl("input", {
        type: "text",
        cls: "wo-input",
        attr: { placeholder: tRaw("workout.focusAreasPlaceholder") },
      });
      inp.value = this.profile.focusAreas || "";
      inp.addEventListener("change", () => {
        this.profile.focusAreas = inp.value;
      });
    });

    // ── Plan params (compact row) ────────────────────────────────────────
    root.createDiv({
      text: tRaw("workout.sectionPlan"),
      cls: "wo-section-label",
    });
    const planRow = root.createDiv({ cls: "wo-plan-row" });

    const weeksField = planRow.createDiv({ cls: "wo-field wo-field-mini" });
    weeksField.createDiv({ cls: "wo-field-label", text: tRaw("workout.weeks") });
    const weeksInp = weeksField.createEl("input", {
      type: "number",
      cls: "wo-input",
      attr: { min: "1", max: "16" },
    });
    weeksInp.value = String(this.weeks);
    weeksInp.addEventListener("change", () => {
      const n = parseInt(weeksInp.value, 10);
      if (Number.isFinite(n) && n > 0) this.weeks = Math.min(16, n);
    });

    const startField = planRow.createDiv({ cls: "wo-field wo-field-mini" });
    startField.createDiv({ cls: "wo-field-label", text: tRaw("workout.startDate") });
    const startInp = startField.createEl("input", {
      type: "date",
      cls: "wo-input",
    });
    startInp.value = this.startDate;
    startInp.addEventListener("change", () => {
      if (startInp.value) this.startDate = startInp.value;
    });

    const projField = planRow.createDiv({ cls: "wo-field wo-field-mini" });
    projField.createDiv({ cls: "wo-field-label", text: tRaw("workout.project") });
    const projSel = projField.createEl("select", { cls: "wo-select" });
    projSel.createEl("option", { value: "", text: tRaw("workout.noProject") });
    for (const p of get(projects)) {
      if (!p.archived) {
        const o = projSel.createEl("option", { value: p.id, text: p.name });
        if (p.id === this.projectId) o.selected = true;
      }
    }
    projSel.addEventListener("change", () => {
      this.projectId = projSel.value || null;
    });

    this.statusEl = root.createDiv({ cls: "workout-status" });
    this.previewEl = root.createDiv({ cls: "workout-preview" });

    const actions = root.createDiv({ cls: "workout-actions" });
    const genBtn = actions.createEl("button", {
      text: this.plan ? tRaw("workout.regenerate") : tRaw("workout.generate"),
      cls: "ai-btn ai-btn-primary wo-gen-btn",
    });
    genBtn.addEventListener("click", () => void this.generate());
    this.genBtnEl = genBtn;

    const createBtn = actions.createEl("button", {
      text: tRaw("workout.create"),
      cls: "ai-btn",
    });
    createBtn.addEventListener("click", () => void this.createTasks());
    if (!this.plan) createBtn.setAttribute("disabled", "true");
    this.createBtnEl = createBtn;

    if (this.plan) this.renderPreview(this.plan);
  }

  private setStatus(text: string, kind: "busy" | "error" | "ok" | "hide" = "hide"): void {
    if (!this.statusEl) return;
    this.statusEl.empty();
    this.statusEl.removeClass("is-busy");
    if (kind === "hide" || !text) return;
    if (kind === "busy") this.statusEl.addClass("is-busy");
    this.statusEl.createSpan({ text, cls: `workout-status-${kind}` });
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.containerEl.toggleClass("wo-generating", busy);
    if (this.genBtnEl) {
      this.genBtnEl.toggleClass("is-loading", busy);
      this.genBtnEl.disabled = busy;
    }
    if (this.createBtnEl) this.createBtnEl.disabled = busy || !this.plan;
  }

  private async generate(): Promise<void> {
    if (this.busy) return;
    const opts = get(settings) as {
      ollamaEnabled?: boolean;
      ollamaUrl?: string;
      ollamaModel?: string;
      ollamaModelMode?: "single" | "dual";
      ollamaModelExtract?: string;
      aiWorkoutEnabled?: boolean;
    };
    if (!opts.ollamaEnabled || opts.aiWorkoutEnabled === false) {
      new Notice(tRaw("workout.needOllama"));
      return;
    }
    if (!this.profile.daysOfWeek.length) {
      new Notice(tRaw("workout.needDays"));
      return;
    }
    if (!this.profile.goal || !this.profile.level) {
      new Notice(tRaw("workout.needProfile"));
      return;
    }

    this.setBusy(true);
    this.setStatus(tRaw("workout.generating"), "busy");
    if (this.previewEl) {
      this.previewEl.empty();
      this.previewEl.createDiv({ cls: "wo-gen-anim" });
    }
    try {
      const plan = await generateWorkoutPlan({
        url: opts.ollamaUrl || "http://localhost:11434",
        model: resolveModel("reason", opts),
        profile: this.profile,
        location: this.profile.location,
        weeks: this.weeks,
        lang: get(locale) === "en" ? "en" : "ru",
      });
      if (!plan.days.length) {
        this.setStatus(tRaw("workout.emptyPlan"), "error");
        this.plan = null;
        if (this.previewEl) this.previewEl.empty();
      } else {
        this.plan = plan;
        this.setStatus(tRaw("workout.editTitle"), "ok");
        this.renderPreview(plan);
        if (this.createBtnEl) {
          this.createBtnEl.removeAttribute("disabled");
          this.createBtnEl.disabled = false;
        }
      }
    } catch (e) {
      this.setStatus(tRaw("workout.aiError", { error: errorMessage(e) }), "error");
      if (this.previewEl) this.previewEl.empty();
    } finally {
      this.setBusy(false);
    }
  }

  private renderPreview(plan: WorkoutPlan): void {
    const box = this.previewEl;
    if (!box) return;
    box.empty();
    box.createDiv({ text: tRaw("workout.sectionPreview"), cls: "wo-section-label" });
    box.createDiv({
      text: plan.title,
      cls: "workout-plan-meta",
    });
    if (plan.notes) box.createEl("p", { text: plan.notes, cls: "workout-plan-notes" });

    const weekdayLabels = tArrayRaw("common.weekdays.short");
    for (const day of plan.days) {
      const card = box.createDiv({ cls: "workout-day-card" });
      const dayName = weekdayLabel(weekdayLabels, day.dayOfWeek);
      const head = card.createDiv({ cls: "workout-day-head" });
      head.createSpan({
        text: tRaw("workout.seriesLabel", { key: day.key, day: dayName }),
        cls: "wo-series-badge",
      });
      // Only session title is editable
      const titleInput = head.createEl("input", {
        type: "text",
        value: day.title,
        cls: "workout-day-title-input",
        attr: { "aria-label": tRaw("workout.editTitle") },
      });
      titleInput.addEventListener("change", () => {
        day.title = titleInput.value.trim() || day.title;
      });

      if (day.estimatedMinutes) {
        card.createDiv({
          text: `${day.estimatedMinutes} ${tRaw("workout.minutes")} · ${day.exercises.length} ${tRaw("workout.exercises")}`,
          cls: "workout-day-meta",
        });
      }
      // Exercises are editable as compact text rows (one per line: "Title — 3×10")
      const lang = get(locale) === "en" ? ("en" as const) : ("ru" as const);
      const list = card.createDiv({ cls: "workout-ex-list" });
      for (let i = 0; i < day.exercises.length; i++) {
        const ex = day.exercises[i];
        const row = list.createDiv({ cls: "workout-ex-row" });
        const inp = row.createEl("input", {
          type: "text",
          value: formatExercise(ex, lang),
          cls: "workout-ex-input",
          attr: { "aria-label": tRaw("workout.editExercise") },
        });
        inp.addEventListener("change", () => {
          day.exercises[i] = parseExerciseLine(inp.value);
          inp.value = formatExercise(day.exercises[i], lang);
        });
        const del = row.createEl("button", {
          text: "×",
          cls: "workout-ex-del",
          attr: { type: "button", "aria-label": tRaw("workout.removeExercise") },
        });
        del.addEventListener("click", () => {
          day.exercises.splice(i, 1);
          this.renderPreview(plan);
        });
      }
      const addBtn = card.createEl("button", {
        text: tRaw("workout.addExercise"),
        cls: "workout-ex-add",
        attr: { type: "button" },
      });
      addBtn.addEventListener("click", () => {
        day.exercises.push({ title: "" });
        this.renderPreview(plan);
      });
    }
  }

  private async createTasks(): Promise<void> {
    if (!this.plan || this.busy) return;
    const [y, m, d] = this.startDate.split("-").map(Number);
    const start = new Date(y, (m || 1) - 1, d || 1);
    if (Number.isNaN(start.getTime())) {
      new Notice(tRaw("workout.needProfile"));
      return;
    }

    this.setBusy(true);
    this.setStatus(tRaw("workout.creating"), "busy");
    try {
      this.profile.updatedAt = Date.now();
      const result = createWorkoutPlanTasks({
        plan: this.plan,
        startDate: start,
        projectId: this.projectId,
        estimatedMinutes: this.profile.sessionMinutes,
        lang: get(locale) === "en" ? "en" : "ru",
      });
      await this.saveOptions({
        workoutProfile: this.profile,
      });
      new Notice(
        tRaw("workout.created", {
          series: String(this.plan.days.length),
          instances: String(result.parentIds.length + result.instanceCount),
        }),
      );
      this.close();
    } catch (e) {
      this.setStatus(tRaw("workout.aiError", { error: errorMessage(e) }), "error");
    } finally {
      this.setBusy(false);
    }
  }
}

/** Pure helper re-exported for tests / callers. */
export type { WorkoutDayPlan };

/** Shared opener for kebab menu / command palette. */
export async function openWorkoutPlanModal(
  app: App,
  saveOptions: WorkoutPlanModalOptions["saveOptions"],
): Promise<void> {
  new WorkoutPlanModal(app, { saveOptions }).open();
}
