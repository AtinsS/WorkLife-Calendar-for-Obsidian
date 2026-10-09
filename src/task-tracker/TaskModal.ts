import type { App } from "obsidian";
import { moment } from "obsidian";
import type { Moment } from "moment";
import { get } from "svelte/store";
import { getDateUID } from "obsidian-daily-notes-interface";
import { CustomModal } from "../ui/CustomModal";
import { tRaw, locale } from "../i18n";

import type { ITask, RecurrenceConfig } from "./types";
import { projects, selectedDate, getChecklistForTask, setChecklistForTask } from "./stores";
import { settings } from "../ui/stores";
import { FileSuggestModal } from "../modals/FileSuggestModal";
import { FolderSuggestModal } from "../modals/FolderSuggestModal";
import { sanitizeTitle } from "../utils/sanitize";
import { generateTaskDescription, isAiQuickAddAvailable } from "../services/aiQuickAdd";

// Obsidian's type defs export moment as `typeof Moment` (the module namespace),
// but at runtime it's the callable moment function. Cast once here.
const momentFn = moment as unknown as (inp?: unknown, format?: string, strict?: boolean) => Moment;

export class TaskModal extends CustomModal {
  private task: ITask | null;
  private onSubmit: (task: Partial<ITask>, subtasks?: string[]) => void;

  private titleInput = "";
  private descriptionInput = "";
  private projectId: string | null = null;
  private dateUID = "";
  private dateValue = "";
  private priority: "low" | "medium" | "high" = "medium";
  private notePathInput = "";
  private recurrenceType: "none" | "daily" | "weekly" | "monthly" = "none";
  private recurrenceInterval = 1;
  private recurrenceDaysOfWeek: number[] = [];
  private recurrenceUntilDateUID = "";
  private recurrenceUntilDateValue = "";
  private scheduledTime = "";
  private endTime = "";
  private isWorkTask = false;
  private paymentType: "hour" | "day" = "hour";
  private rate = "";
  private overtimeStart = "";
  private overtimeMultiplier = "";
  private deadlineDateUID = "";
  private deadlineDateValue = "";
  private deadlineTime = "";
  private titleInputEl: HTMLInputElement | null = null;
  private descriptionInputEl: HTMLTextAreaElement | null = null;
  private descCounterEl: HTMLSpanElement | null = null;

  private advancedBody: HTMLDivElement | null = null;
  private recurrenceSubEl: HTMLDivElement | null = null;
  private workTaskSubEl: HTMLDivElement | null = null;
  private subtaskListEl: HTMLElement | null = null;
  private subtaskTitles: string[] = [];
  private subtasksSyncCount: (() => void) | null = null;

  private updateDescCounter(): void {
    if (!this.descCounterEl) return;
    const len = (this.descriptionInput || "").length;
    this.descCounterEl.textContent = len > 0 ? tRaw("tasks.modal.maxLength", { current: String(len) }) : "";
  }

  constructor(
    app: App,
    onSubmit: (task: Partial<ITask>, subtasks?: string[]) => void,
    task?: ITask,
    initialDate?: string,
    initialTime?: string,
    initialEndTime?: string
  ) {
    super(app);
    this.onSubmit = onSubmit;
    this.task = task || null;

    if (this.task) {
      this.titleInput = this.task.title;
      this.descriptionInput = this.task.description || "";
      this.projectId = this.task.projectId;
      this.dateUID = this.task.dateUID;
      this.dateValue = this.extractDateValue(this.task.dateUID);
      this.priority = this.task.priority;
      this.notePathInput = this.task.boundNotePath || "";
      if (this.task.recurrence) {
        this.recurrenceType = this.task.recurrence.type;
        this.recurrenceInterval = this.task.recurrence.interval || 1;
        this.recurrenceDaysOfWeek = this.task.recurrence.daysOfWeek || [];
        if (this.task.recurrence.until) {
          this.recurrenceUntilDateUID = this.task.recurrence.until;
          this.recurrenceUntilDateValue = this.extractDateValue(this.task.recurrence.until);
        }
      }
      if (this.task.scheduledTime) this.scheduledTime = this.task.scheduledTime;
      if (this.task.endTime) this.endTime = this.task.endTime;
      if (this.task.isWorkTask) {
        this.isWorkTask = this.task.isWorkTask;
        this.paymentType = this.task.paymentType || "hour";
        this.rate = this.task.rate ? String(this.task.rate) : "";
        if (this.task.overtimeStart) this.overtimeStart = String(this.task.overtimeStart);
        if (this.task.overtimeMultiplier) this.overtimeMultiplier = String(this.task.overtimeMultiplier);
      }
      if (this.task.deadline) {
        this.deadlineDateUID = this.task.deadline;
        this.deadlineDateValue = this.extractDateValue(this.task.deadline);
      }
      if (this.task.deadlineTime) this.deadlineTime = this.task.deadlineTime;
      this.subtaskTitles = getChecklistForTask(this.task.id).map((c) => c.title);
    } else {
      if (initialDate) {
        this.dateValue = initialDate;
        const m = momentFn(initialDate, "YYYY-MM-DD", true);
        if (m.isValid()) this.dateUID = getDateUID(m, "day");
      } else {
        this.dateUID = get(selectedDate) || "";
        this.dateValue = this.extractDateValue(this.dateUID);
      }
      if (initialTime) this.scheduledTime = initialTime;
      if (initialEndTime) this.endTime = initialEndTime;
      const cs = get(settings);
      this.paymentType = cs.defaultPaymentType || "hour";
      this.rate = cs.defaultRate ? String(cs.defaultRate) : "";
    }
  }

  onOpen(): void {
    this.containerEl.addClass("wf-task-modal");
    this.containerEl.addClass("quick-add-shell");
    this.contentEl.addClass("qa2");

    // ── Header (same chrome as create modal) ──
    const header = this.contentEl.createDiv({ cls: "qa2-top" });
    const iconWrap = header.createDiv({ cls: "qa2-icon" });
    iconWrap.createSpan({ text: this.task ? "📝" : "⚡", cls: "qa2-icon-glyph" });
    const topText = header.createDiv({ cls: "qa2-top-text" });
    topText.createDiv({
      text: this.task ? tRaw("tasks.modal.editTask") : tRaw("tasks.modal.newTask"),
      cls: "qa2-top-title",
    });
    // Date under the title so the CustomModal close (×) never covers it
    const dateChip = topText.createDiv({ cls: "qa2-date-chip qa2-date-chip--inline" });
    dateChip.createSpan({ text: "📅", cls: "qa2-date-chip-icon" });
    const chipDate = this.dateValue || this.extractDateValue(this.dateUID) || momentFn().format("YYYY-MM-DD");
    const mChip = momentFn(chipDate, "YYYY-MM-DD", true);
    dateChip.createSpan({
      text: mChip.isValid() ? mChip.format("dddd, D MMMM") : chipDate,
      cls: "date-label",
    });

    // ── Title ──
    const titleWrap = this.contentEl.createDiv({ cls: "qa2-input-wrap" });
    titleWrap.createSpan({ text: ">", cls: "qa2-caret" });
    this.titleInputEl = titleWrap.createEl("input", {
      type: "text",
      cls: "qa2-input",
      value: this.titleInput,
      placeholder: tRaw("tasks.modal.titlePlaceholder"),
      attr: { spellcheck: "false", autocomplete: "off" },
    });
    this.titleInputEl.addEventListener("input", () => {
      this.titleInput = this.titleInputEl?.value ?? "";
    });

    // ── Description + embedded AI ──
    const descWrap = this.contentEl.createDiv({ cls: "qa2-desc" });
    descWrap.createEl("label", { text: tRaw("tasks.quickAdd.description"), cls: "qa2-desc-label" });
    const descBox = descWrap.createDiv({ cls: "qa2-desc-box" });
    this.descriptionInputEl = descBox.createEl("textarea", {
      cls: "qa2-desc-input",
      placeholder: tRaw("tasks.quickAdd.descriptionPlaceholder"),
      attr: { rows: "2", spellcheck: "false" },
    });
    this.descriptionInputEl.value = this.descriptionInput;
    this.descriptionInputEl.addEventListener("input", () => {
      this.descriptionInput = this.descriptionInputEl?.value ?? "";
    });
    if (isAiQuickAddAvailable()) {
      const genBtn = descBox.createEl("button", {
        cls: "qa2-desc-ai-btn",
        text: "✨",
        attr: {
          type: "button",
          title: tRaw("tasks.quickAdd.descriptionAi"),
          "aria-label": tRaw("tasks.quickAdd.descriptionAi"),
        },
      });
      genBtn.addEventListener("click", () => {
        void (async () => {
          const title = (this.titleInputEl?.value || this.titleInput).trim();
          if (!title) return;
          const descBox = genBtn.closest(".qa2-desc-box");
          genBtn.setAttribute("disabled", "true");
          genBtn.addClass("is-busy");
          descBox?.addClass("is-ai-loading");
          try {
            const text = await generateTaskDescription(title, this.descriptionInputEl?.value || null);
            if (text && this.descriptionInputEl) {
              this.descriptionInputEl.value = text;
              this.descriptionInput = text;
            }
          } catch {
            /* keep existing description */
          } finally {
            genBtn.removeAttribute("disabled");
            genBtn.removeClass("is-busy");
            descBox?.removeClass("is-ai-loading");
          }
        })();
      });
    }

    // ── Section toggles on one row: Subtasks · Extra ──
    const panelBar = this.contentEl.createDiv({ cls: "qa2-panels-row" });

    // Subtasks
    const subToggle = panelBar.createEl("button", {
      cls: "qa2-subtasks-toggle",
      attr: { type: "button" },
    });
    subToggle.createSpan({ text: tRaw("tasks.modal.subtasks"), cls: "qa2-subtasks-toggle-label" });
    const subToggleCount = subToggle.createSpan({ text: "", cls: "qa2-subtasks-count" });
    const subWrap = this.contentEl.createDiv({ cls: "qa2-subtasks" });
    this.subtaskListEl = subWrap.createDiv({ cls: "qa2-subtask-list mcp-hidden" });
    const subActions = subWrap.createDiv({ cls: "qa2-subtasks-actions mcp-hidden" });
    const addSubBtn = subActions.createEl("button", {
      cls: "qa2-subtask-add",
      text: `+ ${tRaw("tasks.modal.addSubtask")}`,
      attr: { type: "button" },
    });
    addSubBtn.addEventListener("click", () => {
      this.subtaskTitles.push("");
      this.renderSubtasks();
      const inputs = this.subtaskListEl?.querySelectorAll<HTMLInputElement>("input");
      inputs?.[inputs.length - 1]?.focus();
    });
    if (isAiQuickAddAvailable()) {
      const aiSplitBtn = subActions.createEl("button", {
        cls: "qa2-subtask-ai",
        text: `✨ ${tRaw("tasks.modal.splitAi")}`,
        attr: { type: "button" },
      });
      aiSplitBtn.addEventListener("click", () => {
        void this.fillSubtasksWithAI(aiSplitBtn);
      });
    }
    const syncSubCount = () => {
      const n = this.subtaskTitles.filter((t) => t.trim()).length;
      subToggleCount.textContent = n > 0 ? String(n) : "";
    };
    this.subtasksSyncCount = syncSubCount;
    subToggle.addEventListener("click", () => {
      const hidden = this.subtaskListEl?.classList.contains("mcp-hidden");
      this.subtaskListEl?.toggleClass("mcp-hidden", !hidden);
      subActions?.toggleClass("mcp-hidden", !hidden);
      subToggle.toggleClass("open", !!hidden);
    });
    this.renderSubtasks();

    // Extra parameters
    const extraToggle = panelBar.createEl("button", {
      cls: "qa2-extra-toggle open",
      text: tRaw("tasks.quickAdd.extra"),
      attr: { type: "button" },
    });
    const extraWrap = this.contentEl.createDiv({ cls: "qa2-extra" });
    const extraBody = extraWrap.createDiv({ cls: "qa2-extra-body" });
    this.advancedBody = extraBody;
    extraToggle.addEventListener("click", () => {
      const hidden = extraBody.classList.contains("mcp-hidden");
      extraBody.toggleClass("mcp-hidden", !hidden);
      extraToggle.toggleClass("open", !!hidden);
    });

    // Date + start + end
    const timeRow = extraBody.createDiv({ cls: "qa2-extra-row" });
    const dateWrap = timeRow.createDiv({ cls: "qa2-extra-field" });
    dateWrap.createEl("label", { text: tRaw("tasks.modal.date"), cls: "qa2-extra-label" });
    const dateInput = dateWrap.createEl("input", {
      type: "date",
      cls: "qa2-extra-input",
      value: this.dateValue,
    });
    dateInput.addEventListener("change", () => {
      this.dateValue = dateInput.value;
      if (this.dateValue) {
        const m = momentFn(this.dateValue, "YYYY-MM-DD", true);
        if (m.isValid()) this.dateUID = getDateUID(m, "day");
      } else {
        this.dateUID = "";
      }
    });

    const startWrap = timeRow.createDiv({ cls: "qa2-extra-field" });
    startWrap.createEl("label", { text: tRaw("tasks.modal.time"), cls: "qa2-extra-label" });
    const timeInput = startWrap.createEl("input", {
      type: "time",
      cls: "qa2-extra-input",
      value: this.scheduledTime,
    });
    timeInput.addEventListener("change", () => {
      this.scheduledTime = timeInput.value;
      if (this.scheduledTime) {
        endTimeInput.min = this.scheduledTime;
        if (this.endTime && this.endTime < this.scheduledTime) {
          this.endTime = "";
          endTimeInput.value = "";
        }
      }
    });

    const endWrap = timeRow.createDiv({ cls: "qa2-extra-field" });
    endWrap.createEl("label", { text: tRaw("tasks.modal.endTime"), cls: "qa2-extra-label" });
    const endTimeInput = endWrap.createEl("input", {
      type: "time",
      cls: "qa2-extra-input",
      value: this.endTime,
    });
    if (this.scheduledTime) endTimeInput.min = this.scheduledTime;
    const onEndChange = () => {
      this.endTime = endTimeInput.value;
      const bad = !!(this.scheduledTime && this.endTime && this.endTime < this.scheduledTime);
      endTimeInput.classList.toggle("tm-input-error", bad);
    };
    endTimeInput.addEventListener("input", onEndChange);
    endTimeInput.addEventListener("change", onEndChange);

    // Priority
    const priRow = extraBody.createDiv({ cls: "qa2-extra-row" });
    const priWrap = priRow.createDiv({ cls: "qa2-extra-field qa2-extra-field--full" });
    priWrap.createEl("label", { text: tRaw("tasks.modal.priority"), cls: "qa2-extra-label" });
    const priBtns = priWrap.createDiv({ cls: "qa2-pri-btns" });
    const priDefs: Array<{ v: "low" | "medium" | "high"; l: string }> = [
      { v: "low", l: tRaw("tasks.modal.priorityLow") },
      { v: "medium", l: tRaw("tasks.modal.priorityMedium") },
      { v: "high", l: tRaw("tasks.modal.priorityHigh") },
    ];
    for (const p of priDefs) {
      const btn = priBtns.createEl("button", {
        cls: "qa2-pri-btn" + (this.priority === p.v ? " is-active" : ""),
        text: p.l,
        attr: { type: "button" },
      });
      btn.addEventListener("click", () => {
        this.priority = p.v;
        priBtns.querySelectorAll(".qa2-pri-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
    }

    // Project + work (Obsidian native toggle)
    const projRow = extraBody.createDiv({ cls: "qa2-extra-row" });
    const projWrap = projRow.createDiv({ cls: "qa2-extra-field" });
    projWrap.createEl("label", { text: tRaw("tasks.modal.project"), cls: "qa2-extra-label" });
    const projSelect = projWrap.createEl("select", { cls: "qa2-extra-input" });
    projSelect.createEl("option", { value: "", text: tRaw("tasks.modal.noProject") });
    for (const p of get(projects)) {
      const opt = projSelect.createEl("option", { value: p.id, text: `${p.icon} ${p.name}` });
      if (p.id === this.projectId) opt.selected = true;
    }
    projSelect.addEventListener("change", () => {
      this.projectId = projSelect.value || null;
    });

    const workWrap = projRow.createDiv({ cls: "qa2-extra-field qa2-extra-work" });
    workWrap.createEl("label", {
      text: tRaw("tasks.modal.isWorkTask"),
      cls: "qa2-extra-label qa2-work-label",
    });
    const workToggle = workWrap.createEl("label", {
      cls: "checkbox-container" + (this.isWorkTask ? " is-enabled" : ""),
    });
    const workCheckbox = workToggle.createEl("input", { type: "checkbox" });
    workCheckbox.checked = this.isWorkTask;
    workCheckbox.addEventListener("change", () => {
      this.isWorkTask = workCheckbox.checked;
      workToggle.classList.toggle("is-enabled", workCheckbox.checked);
      this.updateWorkTaskSettings();
    });

    // Work pay fields
    this.workTaskSubEl = extraBody.createDiv({ cls: "qa2-extra-work-sub mcp-hidden" });
    const payRow = this.workTaskSubEl.createDiv({ cls: "qa2-extra-row" });
    const payWrap = payRow.createDiv({ cls: "qa2-extra-field" });
    payWrap.createEl("label", { text: tRaw("tasks.modal.paymentType"), cls: "qa2-extra-label" });
    const paySelect = payWrap.createEl("select", { cls: "qa2-extra-input" });
    paySelect.createEl("option", { value: "hour", text: tRaw("tasks.modal.paymentHour") });
    paySelect.createEl("option", { value: "day", text: tRaw("tasks.modal.paymentDay") });
    paySelect.value = this.paymentType;
    paySelect.addEventListener("change", () => {
      this.paymentType = paySelect.value as "hour" | "day";
      this.updateWorkTaskSubFields();
    });

    const rateWrap = payRow.createDiv({ cls: "qa2-extra-field" });
    rateWrap.createEl("label", {
      text: tRaw("tasks.modal.rate", { currency: "₽" }),
      cls: "qa2-extra-label",
    });
    const rateInput = rateWrap.createEl("input", {
      type: "number",
      cls: "qa2-extra-input",
      value: this.rate,
      placeholder: "0",
      attr: { min: "0" },
    });
    rateInput.addEventListener("input", () => {
      this.rate = rateInput.value.replace(/[^0-9.,]/g, "");
    });

    const otRow = this.workTaskSubEl.createDiv({ cls: "qa2-extra-row qa2-extra-ot" });
    const otStartWrap = otRow.createDiv({ cls: "qa2-extra-field" });
    otStartWrap.createEl("label", { text: tRaw("tasks.modal.overtimeFrom"), cls: "qa2-extra-label" });
    const otStartInput = otStartWrap.createEl("input", {
      type: "number",
      cls: "qa2-extra-input",
      value: this.overtimeStart,
      placeholder: "8",
      attr: { min: "1", max: "24" },
    });
    otStartInput.addEventListener("input", () => {
      this.overtimeStart = otStartInput.value.replace(/[^0-9]/g, "");
    });

    const otMulWrap = otRow.createDiv({ cls: "qa2-extra-field" });
    otMulWrap.createEl("label", { text: tRaw("tasks.modal.multiplier"), cls: "qa2-extra-label" });
    const otMulInput = otMulWrap.createEl("input", {
      type: "number",
      cls: "qa2-extra-input",
      value: this.overtimeMultiplier,
      placeholder: "1.5",
      attr: { min: "1", max: "10", step: "0.1" },
    });
    otMulInput.addEventListener("input", () => {
      this.overtimeMultiplier = otMulInput.value.replace(/[^0-9.,]/g, "");
    });

    // Recurrence
    const recRow = extraBody.createDiv({ cls: "qa2-extra-row" });
    const recWrap = recRow.createDiv({ cls: "qa2-extra-field" });
    recWrap.createEl("label", { text: tRaw("tasks.modal.recurrence"), cls: "qa2-extra-label" });
    const recSelect = recWrap.createEl("select", { cls: "qa2-extra-input" });
    recSelect.createEl("option", { value: "none", text: tRaw("tasks.modal.recurrenceNone") });
    recSelect.createEl("option", { value: "daily", text: tRaw("tasks.modal.recurrenceDaily") });
    recSelect.createEl("option", { value: "weekly", text: tRaw("tasks.modal.recurrenceWeekly") });
    recSelect.createEl("option", { value: "monthly", text: tRaw("tasks.modal.recurrenceMonthly") });
    recSelect.value = this.recurrenceType;
    recSelect.addEventListener("change", () => {
      this.recurrenceType = recSelect.value as "none" | "daily" | "weekly" | "monthly";
      this.updateRecurrenceSubFields();
    });

    this.recurrenceSubEl = extraBody.createDiv({ cls: "qa2-extra-rec-sub" });
    const intRow = this.recurrenceSubEl.createDiv({ cls: "qa2-extra-row" });
    const intWrap = intRow.createDiv({ cls: "qa2-extra-field" });
    intWrap.createEl("label", { text: tRaw("tasks.modal.interval"), cls: "qa2-extra-label" });
    const intInput = intWrap.createEl("input", {
      type: "number",
      cls: "qa2-extra-input",
      value: String(this.recurrenceInterval),
      attr: { min: "1" },
    });
    intInput.addEventListener("input", () => {
      this.recurrenceInterval = Math.max(1, parseInt(intInput.value) || 1);
    });

    const daysRow = this.recurrenceSubEl.createDiv({ cls: "qa2-extra-row" });
    const daysWrap = daysRow.createDiv({ cls: "qa2-extra-field qa2-extra-field--full" });
    daysWrap.createEl("label", { text: tRaw("tasks.modal.days"), cls: "qa2-extra-label" });
    const daysContainer = daysWrap.createDiv({ cls: "qa2-rec-days" });
    const rawLabels = tRaw("common.weekdays.short").split(", ");
    const sow = get(settings).startOfWeek || "system";
    let dayIndices: number[];
    if (sow === "monday") dayIndices = [1, 2, 3, 4, 5, 6, 0];
    else if (sow === "sunday") dayIndices = [0, 1, 2, 3, 4, 5, 6];
    else dayIndices = get(locale) === "en" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
    const dayLabels =
      sow === "sunday" || (sow === "system" && get(locale) === "en")
        ? [...rawLabels.slice(-1), ...rawLabels.slice(0, -1)]
        : rawLabels;
    for (let i = 0; i < 7; i++) {
      const momentIdx = dayIndices[i];
      const dayBtn = daysContainer.createEl("button", {
        text: dayLabels[i],
        cls: "qa2-day-btn" + (this.recurrenceDaysOfWeek.includes(momentIdx) ? " is-active" : ""),
        attr: { type: "button" },
      });
      dayBtn.addEventListener("click", () => {
        const idx = this.recurrenceDaysOfWeek.indexOf(momentIdx);
        if (idx >= 0) {
          this.recurrenceDaysOfWeek.splice(idx, 1);
          dayBtn.classList.remove("is-active");
        } else {
          this.recurrenceDaysOfWeek.push(momentIdx);
          this.recurrenceDaysOfWeek.sort();
          dayBtn.classList.add("is-active");
        }
      });
    }

    const untilRow = this.recurrenceSubEl.createDiv({ cls: "qa2-extra-row" });
    const untilWrap = untilRow.createDiv({ cls: "qa2-extra-field" });
    untilWrap.createEl("label", { text: tRaw("tasks.modal.repeatUntil"), cls: "qa2-extra-label" });
    const untilInput = untilWrap.createEl("input", {
      type: "date",
      cls: "qa2-extra-input",
      value: this.recurrenceUntilDateValue,
    });
    untilInput.addEventListener("change", () => {
      this.recurrenceUntilDateValue = untilInput.value;
      if (this.recurrenceUntilDateValue) {
        const m = momentFn(this.recurrenceUntilDateValue, "YYYY-MM-DD", true);
        if (m.isValid()) this.recurrenceUntilDateUID = getDateUID(m, "day");
      } else {
        this.recurrenceUntilDateUID = "";
      }
    });

    this.updateRecurrenceSubFields();

    // Deadline + note
    const dlRow = extraBody.createDiv({ cls: "qa2-extra-row" });
    const dlWrap = dlRow.createDiv({ cls: "qa2-extra-field" });
    dlWrap.createEl("label", { text: tRaw("tasks.modal.deadline"), cls: "qa2-extra-label" });
    const dlInput = dlWrap.createEl("input", {
      type: "date",
      cls: "qa2-extra-input",
      value: this.deadlineDateValue,
    });
    dlInput.addEventListener("change", () => {
      this.deadlineDateValue = dlInput.value;
      if (this.deadlineDateValue) {
        const m = momentFn(this.deadlineDateValue, "YYYY-MM-DD", true);
        if (m.isValid()) this.deadlineDateUID = getDateUID(m, "day");
      } else {
        this.deadlineDateUID = "";
      }
    });

    const noteWrap = dlRow.createDiv({ cls: "qa2-extra-field" });
    noteWrap.createEl("label", { text: tRaw("tasks.modal.linkNote"), cls: "qa2-extra-label" });
    const noteRow = noteWrap.createDiv({ cls: "qa2-note-row" });
    const noteInput = noteRow.createEl("input", {
      type: "text",
      cls: "qa2-extra-input qa2-note-input",
      placeholder: tRaw("tasks.modal.notePlaceholder"),
      value: this.notePathInput,
    });
    noteInput.addEventListener("input", () => {
      this.notePathInput = noteInput.value;
    });
    const noteBtn = noteRow.createEl("button", {
      text: "…",
      cls: "qa2-note-btn",
      attr: { type: "button", title: tRaw("tasks.modal.linkNote") },
    });
    noteBtn.addEventListener("click", () => {
      new FileSuggestModal(this.app, (filePath) => {
        this.notePathInput = filePath;
        noteInput.value = filePath;
      }).open();
    });
    const createNoteBtn = noteRow.createEl("button", {
      text: "+",
      cls: "qa2-note-btn",
      attr: { type: "button", title: tRaw("tasks.modal.createNote") },
    });
    createNoteBtn.addEventListener("click", () => {
      new FolderSuggestModal(this.app, (folder) => {
        void (async () => {
          const title = (this.titleInputEl?.value || this.titleInput).trim() || tRaw("tasks.modal.note");
          const filename = title.replace(/[\\/:*?"<>|]/g, "_") + ".md";
          const path = `${folder}/${filename}`;
          const parts = path.split("/");
          if (parts.length > 1) {
            const folderPath = parts.slice(0, -1).join("/");
            if (!this.app.vault.getAbstractFileByPath(folderPath)) {
              await this.app.vault.createFolder(folderPath);
            }
          }
          let file = this.app.vault.getAbstractFileByPath(path);
          if (!file) {
            file = await this.app.vault.create(path, "");
          }
          this.notePathInput = path;
          noteInput.value = path;
        })();
      }).open();
    });

    this.updateWorkTaskSettings();

    // ── Footer ──
    const footer = this.contentEl.createDiv({ cls: "qa2-actions" });
    const cancelBtn = footer.createEl("button", {
      text: tRaw("common.cancel"),
      cls: "qa2-btn qa2-btn-ghost",
      attr: { type: "button" },
    });
    cancelBtn.addEventListener("click", () => this.close());
    const submitBtn = footer.createEl("button", {
      cls: "qa2-btn qa2-btn-primary",
      attr: { type: "button" },
    });
    submitBtn.createSpan({ text: this.task ? tRaw("common.save") : tRaw("tasks.modal.create") });
    submitBtn.addEventListener("click", () => this.handleSubmit());
  }

  private updateRecurrenceSubFields(): void {
    if (!this.recurrenceSubEl) return;
    const show = this.recurrenceType !== "none";
    this.recurrenceSubEl.classList.toggle("mcp-hidden", !show);

    const rows = this.recurrenceSubEl.querySelectorAll<HTMLElement>(".qa2-extra-row");
    // interval (monthly), days (weekly), until
    if (rows[0]) rows[0].classList.toggle("mcp-hidden", this.recurrenceType !== "monthly");
    if (rows[1]) rows[1].classList.toggle("mcp-hidden", this.recurrenceType !== "weekly");
    // until row always visible when recurrence is on
    if (rows[2]) rows[2].classList.remove("mcp-hidden");
  }

  private updateWorkTaskSettings(): void {
    this.updateWorkTaskSubFields();
  }

  private updateWorkTaskSubFields(): void {
    if (!this.workTaskSubEl) return;
    const show = this.isWorkTask;
    this.workTaskSubEl.classList.toggle("mcp-hidden", !show);
    const ot = this.workTaskSubEl.querySelector<HTMLElement>(".qa2-extra-ot");
    if (ot) ot.classList.toggle("mcp-hidden", this.paymentType !== "hour");
  }

  private renderSubtasks(): void {
    const list = this.subtaskListEl;
    if (!list) return;
    list.empty();
    this.subtaskTitles.forEach((title, i) => {
      const row = list.createDiv({ cls: "qa2-subtask-row" });
      const input = row.createEl("input", {
        type: "text",
        cls: "qa2-extra-input qa2-subtask-input",
        value: title,
        placeholder: tRaw("tasks.modal.subtaskPlaceholder"),
        attr: { spellcheck: "false", autocomplete: "off" },
      });
      input.addEventListener("input", () => {
        this.subtaskTitles[i] = input.value;
      });
      input.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.subtaskTitles.push("");
          this.renderSubtasks();
          const inputs = this.subtaskListEl?.querySelectorAll<HTMLInputElement>("input");
          inputs?.[inputs.length - 1]?.focus();
        } else if (e.key === "Backspace" && !input.value && this.subtaskTitles.length > 0) {
          e.preventDefault();
          this.subtaskTitles.splice(i, 1);
          this.renderSubtasks();
          const inputs = this.subtaskListEl?.querySelectorAll<HTMLInputElement>("input");
          inputs?.[Math.max(0, i - 1)]?.focus();
        }
      });
      const removeBtn = row.createEl("button", {
        cls: "qa2-subtask-remove",
        text: "✕",
        attr: { type: "button", "aria-label": "Remove" },
      });
      removeBtn.addEventListener("click", () => {
        this.subtaskTitles.splice(i, 1);
        this.renderSubtasks();
      });
    });
    this.subtasksSyncCount?.();
  }

  /** Fill the subtask list via Ollama ("Разбить на подзадачи (ИИ)"). */
  private async fillSubtasksWithAI(btn: HTMLElement): Promise<void> {
    const title = (this.titleInputEl?.value || this.titleInput).trim();
    if (!title) return;
    btn.setAttribute("disabled", "true");
    btn.addClass("is-busy");
    try {
      const { generateSubtasks, resolveModel } = await import("../services/OllamaService");
      const opts = get(settings) as { ollamaUrl?: string; ollamaModel?: string; ollamaModelMode?: "single" | "dual"; ollamaModelExtract?: string };
      const projectName = this.projectId
        ? get(projects).find((p) => p.id === this.projectId)?.name ?? null
        : null;
      const titles = await generateSubtasks(
        opts.ollamaUrl || "http://localhost:11434",
        resolveModel("extract", opts),
        title,
        this.descriptionInputEl?.value || null,
        projectName,
      );
      if (titles.length) {
        this.subtaskTitles = titles.map((t) => t.trim()).filter(Boolean);
        this.renderSubtasks();
        this.subtasksSyncCount?.();
      }
    } catch {
      /* keep existing subtasks */
    } finally {
      btn.removeAttribute("disabled");
      btn.removeClass("is-busy");
    }
  }

  private handleSubmit(): void {
    if (this.titleInputEl) this.titleInput = this.titleInputEl.value;
    if (this.descriptionInputEl) this.descriptionInput = this.descriptionInputEl.value;

    if (!this.titleInput.trim()) return;

    // Validate: endTime cannot be earlier than scheduledTime
    if (this.scheduledTime && this.endTime && this.endTime < this.scheduledTime) {
      // Show error
      const errorEl = this.contentEl.querySelector(".tm-time-error") ;
      if (errorEl) {
        errorEl.textContent = tRaw("tasks.modal.errorEndTime");
        window.setTimeout(() => {
          errorEl.textContent = "";
        }, 3000);
      } else {
        // Create error element if it doesn't exist
        const msgEl = this.contentEl.createDiv({ cls: "tm-time-error" });
        msgEl.textContent = tRaw("tasks.modal.errorEndTime");
        window.setTimeout(() => {
          msgEl.remove();
        }, 3000);
      }
      return;
    }

    let finalDateUID = this.dateUID;
    if (!finalDateUID && this.dateValue) {
      const m = momentFn(this.dateValue, "YYYY-MM-DD", true);
      if (m.isValid()) finalDateUID = getDateUID(m, "day");
    }
    if (!finalDateUID) finalDateUID = getDateUID(momentFn(), "day");

    let recurrence: RecurrenceConfig | undefined;
    if (this.recurrenceType !== "none") {
      recurrence = { type: this.recurrenceType, interval: this.recurrenceInterval };
      if (this.recurrenceType === "weekly" && this.recurrenceDaysOfWeek.length > 0) recurrence.daysOfWeek = [...this.recurrenceDaysOfWeek];
      if (this.recurrenceUntilDateUID) recurrence.until = this.recurrenceUntilDateUID;
    }

    // Calculate estimatedTime if both scheduledTime and endTime are set
    let estimatedTime: number | undefined;
    if (this.scheduledTime && this.endTime) {
      const [startH, startM] = this.scheduledTime.split(":").map(Number);
      const [endH, endM] = this.endTime.split(":").map(Number);
      const startTotalMin = startH * 60 + startM;
      const endTotalMin = endH * 60 + endM;
      const diffMin = endTotalMin - startTotalMin;
      if (diffMin > 0) {
        estimatedTime = Math.max(15, diffMin);
      }
    }

    const submitData = {
      title: sanitizeTitle(this.titleInput),
      description: sanitizeTitle(this.descriptionInput).trim() || undefined,
      projectId: this.projectId,
      dateUID: finalDateUID,
      priority: this.priority,
      boundNotePath: this.notePathInput || null,
      recurrence,
      scheduledTime: this.scheduledTime || undefined,
      endTime: this.endTime || undefined,
      estimatedTime: estimatedTime,
      isWorkTask: this.isWorkTask || undefined,
      paymentType: this.isWorkTask ? this.paymentType : undefined,
      rate: this.isWorkTask && this.rate ? parseFloat(this.rate.replace(",", ".")) : undefined,
      overtimeStart: this.isWorkTask && this.paymentType === "hour" && this.overtimeStart ? parseInt(this.overtimeStart) : undefined,
      overtimeMultiplier: this.isWorkTask && this.paymentType === "hour" && this.overtimeMultiplier ? parseFloat(this.overtimeMultiplier.replace(",", ".")) : undefined,
      deadline: this.deadlineDateUID || undefined,
      deadlineTime: this.deadlineTime || undefined,
    };
    console.debug("[TaskModal] submitData:", JSON.stringify(submitData));
    const subtasks = this.subtaskTitles.map((t) => t.trim()).filter(Boolean);
    if (this.task) {
      this.onSubmit(submitData);
      setChecklistForTask(this.task.id, subtasks);
    } else {
      this.onSubmit(submitData, subtasks);
    }
    this.close();
  }

  private extractDateValue(dateUID: string): string {
    if (!dateUID) return "";
    const match = /^day-(\d{4}-\d{2}-\d{2})/.exec(dateUID);
    return match ? match[1] : "";
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
