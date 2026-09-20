import type { App } from "obsidian";
import { Notice } from "obsidian";
import { get } from "svelte/store";
import { getDateUID } from "obsidian-daily-notes-interface";
import { CustomModal } from "../ui/CustomModal";
import { FileSuggestModal } from "../modals/FileSuggestModal";
import { tRaw } from "../i18n";
import type { ExtractedTask } from "./OllamaService";
import { extractTasksFromNote } from "./OllamaService";
import { addTask, addChecklistItem, projects } from "../task-tracker/stores";
import { settings } from "../ui/stores";
import type { ISettings } from "../settings";

const momentFn = window.moment;

export class AIExtractModal extends CustomModal {
  private notePath: string;
  private noteContent = "";
  private tasks: ExtractedTask[] = [];
  private distributeStartDate = "";
  private isAnalyzing = false;
  private selectedProjectId: string | null = null;
  private dayDateOverrides: Map<number, string> = new Map();
  private autoScheduleTime = false;
  private originalTasks: ExtractedTask[] = []; // snapshot before auto-schedule
  private draggedTaskIdx: number | null = null;

  private previewEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private footerEl: HTMLDivElement | null = null;
  private autoScheduleToggleEl: HTMLInputElement | null = null;

  constructor(app: App, initialNotePath?: string) {
    super(app);
    this.notePath = initialNotePath || "";
    const now = new Date();
    this.distributeStartDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  onOpen(): void {
    this.containerEl.addClass("ai-extract-modal");

    // Header
    const header = this.contentEl.createDiv({ cls: "ai-header" });
    header.createEl("h2", { text: tRaw("ai.button"), cls: "ai-title" });

    // Note selector row
    const noteRow = this.contentEl.createDiv({ cls: "ai-note-row" });
    const noteInput = noteRow.createEl("input", {
      type: "text",
      cls: "ai-input",
      placeholder: tRaw("ai.selectNoteDesc"),
      value: this.notePath,
    });
    noteInput.addEventListener("input", () => { this.notePath = noteInput.value; });
    const noteBtn = noteRow.createEl("button", { text: "...", cls: "ai-file-btn" });
    noteBtn.addEventListener("click", () => {
      new FileSuggestModal(this.app, async (filePath) => {
        this.notePath = filePath;
        noteInput.value = filePath;
      }).open();
    });

    // Status
    this.statusEl = this.contentEl.createDiv({ cls: "ai-status" });

    // Preview area
    this.previewEl = this.contentEl.createDiv({ cls: "ai-preview" });
    this.previewEl.style.display = "none";

    // Footer
    this.footerEl = this.contentEl.createDiv({ cls: "ai-footer" });
    this.footerEl.style.display = "none";

    // Extract button
    const extractBtn = this.contentEl.createEl("button", {
      text: tRaw("ai.extract"),
      cls: "ai-btn ai-btn-primary ai-extract-btn",
    });
    extractBtn.addEventListener("click", () => void this.runExtraction());
    (this as unknown as Record<string, unknown>)._extractBtn = extractBtn;

    // Auto-load if note path was provided
    if (this.notePath) {
      void this.loadNoteContent().then(() => void this.runExtraction());
    }
  }

  private async loadNoteContent(): Promise<void> {
    if (!this.notePath) return;
    try {
      const file = this.app.vault.getAbstractFileByPath(this.notePath);
      if (file && "extension" in file && (file as { extension: string }).extension === "md") {
        this.noteContent = await this.app.vault.read(file as import("obsidian").TFile);
      }
    } catch (e) {
      this.showStatus(tRaw("ai.error", { error: String(e) }), "error");
    }
  }

  private async runExtraction(): Promise<void> {
    if (!this.notePath) {
      this.showStatus(tRaw("ai.noNoteSelected"), "error");
      return;
    }

    await this.loadNoteContent();
    if (!this.noteContent.trim()) {
      this.showStatus(tRaw("ai.noTasks"), "info");
      return;
    }

    const opts: ISettings = get(settings);
    const url = opts.ollamaUrl || "http://localhost:11434";
    const model = opts.ollamaModel || "llama3.1";
    const contextSize = opts.ollamaContextSize || 0;

    this.isAnalyzing = true;
    this.showStatus(`⚡ ${model}: ${tRaw("ai.analyzing")}`, "loading");

    try {
      this.tasks = await extractTasksFromNote(url, model, this.noteContent, contextSize);

      if (this.tasks.length === 0) {
        this.showStatus(tRaw("ai.noTasksHint"), "info");
        return;
      }

      this.dayDateOverrides.clear();
      // Store original task state for toggle restore
      this.originalTasks = this.tasks.map((t) => ({ ...t, subtasks: [...t.subtasks] }));

      this.showStatus(`✓ ${model} → ${tRaw("ai.preview")} (${this.tasks.length})`, "success");
      this.renderPreview();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Failed to fetch") || msg.includes("ECONNREFUSED") || msg.includes("NetworkError")) {
        this.showStatus(tRaw("ai.connectionError"), "error");
      } else {
        this.showStatus(tRaw("ai.error", { error: msg }), "error");
      }
    } finally {
      this.isAnalyzing = false;
    }
  }

  private showStatus(text: string, type: "info" | "loading" | "error" | "success"): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.className = "ai-status ai-status-" + type;
  }

  /** Resolve the actual date string for a given dayIndex, using overrides or start date */
  private resolveDateForDay(dayIndex: number): string {
    const override = this.dayDateOverrides.get(dayIndex);
    if (override) return override;
    const start = new Date(`${this.distributeStartDate}T00:00:00`);
    const d = new Date(start.getTime() + (dayIndex - 1) * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Get the current distribution respecting user date overrides */
  private getDistribution(): Map<string, ExtractedTask[]> {
    const result = new Map<string, ExtractedTask[]>();

    // Group by dayIndex
    const byDay = new Map<number, ExtractedTask[]>();
    for (const task of this.tasks) {
      const day = task.dayIndex || 1;
      const list = byDay.get(day) ?? [];
      list.push(task);
      byDay.set(day, list);
    }

    for (const [dayIdx, dayTasks] of byDay) {
      const dateStr = this.resolveDateForDay(dayIdx);

      // Auto-fill scheduledTime only when toggle is on and task has no time
      if (this.autoScheduleTime) {
        let nextMinutes = 9 * 60;
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
      }

      const existing = result.get(dateStr) ?? [];
      existing.push(...dayTasks);
      result.set(dateStr, existing);
    }

    return result;
  }

  private renderPreview(): void {
    if (!this.previewEl || !this.footerEl) return;

    this.previewEl.style.display = "";
    this.footerEl.style.display = "";

    const extractBtn = (this as unknown as Record<string, unknown>)._extractBtn as HTMLElement | undefined;
    if (extractBtn) extractBtn.style.display = "none";

    this.previewEl.empty();

    const distribution = this.getDistribution();
    const dateEntries = [...distribution.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [date, dayTasks] of dateEntries) {
      // Find the dayIndex for this date group
      const dayIdx = dayTasks[0]?.dayIndex || 1;

      // Day card — drop target
      const dayCard = this.previewEl.createDiv({ cls: "ai-day-card" });
      dayCard.addEventListener("dragover", (e) => {
        e.preventDefault();
        dayCard.classList.add("ai-day-card-drop");
      });
      dayCard.addEventListener("dragleave", () => {
        dayCard.classList.remove("ai-day-card-drop");
      });
      dayCard.addEventListener("drop", (e) => {
        e.preventDefault();
        dayCard.classList.remove("ai-day-card-drop");
        if (this.draggedTaskIdx !== null && this.draggedTaskIdx < this.tasks.length) {
          this.tasks[this.draggedTaskIdx].dayIndex = dayIdx;
          this.draggedTaskIdx = null;
          this.renderPreview();
        }
      });

      // Day header with editable date
      const dayHeader = dayCard.createDiv({ cls: "ai-day-card-header" });
      const dayTitle = dayHeader.createDiv({ cls: "ai-day-card-title" });
      dayTitle.createEl("span", { text: `День ${dayIdx}`, cls: "ai-day-num" });
      const m = momentFn(date, "YYYY-MM-DD", true);
      if (m.isValid()) {
        dayTitle.createEl("span", { text: m.format("dddd, D MMMM"), cls: "ai-day-date-label" });
      }

      // Editable date
      const dateInput = dayHeader.createEl("input", {
        type: "date",
        cls: "ai-day-date-input",
        value: date,
      });
      dateInput.addEventListener("change", () => {
        this.dayDateOverrides.set(dayIdx, dateInput.value);
        this.renderPreview();
      });

      // Tasks in this day
      const taskList = dayCard.createDiv({ cls: "ai-day-tasks" });

      for (let i = 0; i < dayTasks.length; i++) {
        const task = dayTasks[i];
        const taskIdx = this.tasks.indexOf(task);
        const taskRow = taskList.createDiv({ cls: "ai-task-row" });
        taskRow.draggable = true;
        taskRow.addEventListener("dragstart", (e) => {
          this.draggedTaskIdx = taskIdx;
          taskRow.classList.add("ai-task-dragging");
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(taskIdx));
          }
        });
        taskRow.addEventListener("dragend", () => {
          taskRow.classList.remove("ai-task-dragging");
          this.draggedTaskIdx = null;
        });

        // Checkbox (native)
        const checkbox = taskRow.createEl("input", { type: "checkbox" });
        checkbox.checked = task.selected;
        checkbox.addEventListener("change", () => {
          this.tasks[taskIdx].selected = checkbox.checked;
        });

        // Priority dot
        const priDot = taskRow.createSpan({ cls: "ai-pri-dot" });
        const priColors: Record<string, string> = { high: "#f44336", medium: "#ff9800", low: "#4caf50" };
        priDot.style.backgroundColor = priColors[task.priority] || "#ff9800";

        // Main info
        const info = taskRow.createDiv({ cls: "ai-task-info" });

        // Title
        const titleEl = info.createEl("input", {
          type: "text",
          cls: "ai-task-title-input",
          value: task.title,
        });
        titleEl.addEventListener("input", () => { this.tasks[taskIdx].title = titleEl.value; });

        // Description (if present)
        if (task.description) {
          const descEl = info.createDiv({ cls: "ai-task-desc-text" });
          descEl.textContent = task.description;
        }

        // Meta row (time start + end, duration, subtasks count)
        const meta = info.createDiv({ cls: "ai-task-meta" });

        const timeInput = meta.createEl("input", {
          type: "text",
          cls: "ai-task-time-input",
          placeholder: "09:00",
          value: task.scheduledTime || "",
        });
        timeInput.addEventListener("input", () => {
          this.tasks[taskIdx].scheduledTime = timeInput.value || undefined;
          this.updateEndTime(taskIdx, endTimeInput);
        });

        meta.createEl("span", { text: "—", cls: "ai-task-time-sep" });

        // End time input
        let endTimeValue = "";
        if (task.scheduledTime && task.estimatedMinutes) {
          const [sh, sm] = task.scheduledTime.split(":").map(Number);
          const endTotal = sh * 60 + sm + task.estimatedMinutes;
          endTimeValue = `${String(Math.floor(endTotal / 60) % 24).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
        }
        const endTimeInput = meta.createEl("input", {
          type: "text",
          cls: "ai-task-time-input",
          placeholder: "11:00",
          value: endTimeValue,
        });
        endTimeInput.addEventListener("input", () => {
          // Recalculate estimatedMinutes from start+end
          const start = timeInput.value;
          const end = endTimeInput.value;
          if (start && end && /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)) {
            const [sh, sm] = start.split(":").map(Number);
            const [eh, em] = end.split(":").map(Number);
            const diff = (eh * 60 + em) - (sh * 60 + sm);
            if (diff > 0) {
              this.tasks[taskIdx].estimatedMinutes = diff;
            }
          }
        });

        if (task.estimatedMinutes) {
          const estH = Math.floor(task.estimatedMinutes / 60);
          const estM = task.estimatedMinutes % 60;
          const estLabel = estH > 0 ? `${estH}ч${estM > 0 ? ` ${estM}м` : ""}` : `${estM}м`;
          meta.createEl("span", { text: estLabel, cls: "ai-task-est" });
        }

        // Subtasks badge
        if (task.subtasks.length > 0) {
          const stBadge = meta.createEl("span", {
            text: `☐ ${task.subtasks.length} ${tRaw("ai.subtasks")}`,
            cls: "ai-subtasks-badge",
          });
          // Subtasks container — append to taskList (AFTER taskRow), not inside taskRow
          let subtasksListEl: HTMLDivElement | null = null;
          stBadge.addEventListener("click", () => {
            if (subtasksListEl) {
              subtasksListEl.remove();
              subtasksListEl = null;
              stBadge.textContent = `☐ ${task.subtasks.length} ${tRaw("ai.subtasks")}`;
            } else {
              subtasksListEl = taskList.createDiv({ cls: "ai-subtasks-list" });
              for (const st of task.subtasks) {
                const stItem = subtasksListEl.createDiv({ cls: "ai-subtask-item" });
                stItem.createSpan({ text: "☐" });
                stItem.createSpan({ text: st.title, cls: "ai-subtask-title" });
              }
              stBadge.textContent = `☑ ${task.subtasks.length} ${tRaw("ai.subtasks")}`;
              // Move subtasks list right after the current taskRow
              taskRow.after(subtasksListEl);
            }
          });
        }
      }
    }

    // Footer
    this.renderFooter();
  }

  private updateEndTime(taskIdx: number, endTimeInput: HTMLInputElement): void {
    const task = this.tasks[taskIdx];
    if (task.scheduledTime && task.estimatedMinutes && /^\d{2}:\d{2}$/.test(task.scheduledTime)) {
      const [sh, sm] = task.scheduledTime.split(":").map(Number);
      const endTotal = sh * 60 + sm + task.estimatedMinutes;
      endTimeInput.value = `${String(Math.floor(endTotal / 60) % 24).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
    } else {
      endTimeInput.value = "";
    }
  }

  private renderFooter(): void {
    if (!this.footerEl) return;
    this.footerEl.empty();

    // Top row: project + start date
    const topRow = this.footerEl.createDiv({ cls: "ai-footer-row" });

    // Project selector
    const projWrap = topRow.createDiv({ cls: "ai-footer-field" });
    projWrap.createEl("label", { text: tRaw("ai.project"), cls: "ai-footer-label" });
    const projSelect = projWrap.createEl("select", { cls: "ai-select" });
    projSelect.createEl("option", { value: "", text: tRaw("ai.noProject") });
    for (const p of get(projects)) {
      const opt = projSelect.createEl("option", { value: p.id, text: `${p.icon} ${p.name}` });
      if (p.id === this.selectedProjectId) opt.selected = true;
    }
    projSelect.addEventListener("change", () => {
      this.selectedProjectId = projSelect.value || null;
    });

    // Start date
    const dateWrap = topRow.createDiv({ cls: "ai-footer-field" });
    dateWrap.createEl("label", { text: tRaw("ai.distributeFrom"), cls: "ai-footer-label" });
    const dateInput = dateWrap.createEl("input", {
      type: "date",
      cls: "ai-input",
      value: this.distributeStartDate,
    });
    dateInput.addEventListener("change", () => {
      this.distributeStartDate = dateInput.value;
      this.dayDateOverrides.clear();
      this.renderPreview();
    });

    // Auto-schedule toggle
    const toggleRow = this.footerEl.createDiv({ cls: "ai-footer-toggle" });
    const toggleLabel = toggleRow.createEl("label", { cls: "ai-toggle-label" });
    this.autoScheduleToggleEl = toggleLabel.createEl("input", { type: "checkbox", cls: "ai-toggle-cb" });
    this.autoScheduleToggleEl.checked = this.autoScheduleTime;
    this.autoScheduleToggleEl.addEventListener("change", () => {
      this.autoScheduleTime = (this.autoScheduleToggleEl as HTMLInputElement | null)?.checked ?? false;
      // Restore original times when toggling off
      if (!this.autoScheduleTime) {
        for (let i = 0; i < this.tasks.length; i++) {
          if (this.originalTasks[i]) {
            this.tasks[i].scheduledTime = this.originalTasks[i].scheduledTime;
          }
        }
      }
      this.renderPreview();
    });
    toggleLabel.createSpan({ text: tRaw("ai.autoSchedule") });

    // Action buttons
    const btnRow = this.footerEl.createDiv({ cls: "ai-footer-btns" });

    const selectAllBtn = btnRow.createEl("button", { text: tRaw("ai.selectAll"), cls: "ai-btn" });
    selectAllBtn.addEventListener("click", () => {
      for (const t of this.tasks) t.selected = true;
      this.renderPreview();
    });

    const deselectAllBtn = btnRow.createEl("button", { text: tRaw("ai.deselectAll"), cls: "ai-btn" });
    deselectAllBtn.addEventListener("click", () => {
      for (const t of this.tasks) t.selected = false;
      this.renderPreview();
    });

    const addBtn = btnRow.createEl("button", { text: tRaw("ai.addSelected"), cls: "ai-btn ai-btn-primary" });
    addBtn.addEventListener("click", () => void this.addSelectedTasks());
  }

  private async addSelectedTasks(): Promise<void> {
    const selected = this.tasks.filter((t) => t.selected);
    if (selected.length === 0) return;

    const distribution = this.getDistribution();
    let count = 0;

    for (const [date, dayTasks] of distribution) {
      const m = momentFn(date, "YYYY-MM-DD", true);
      const dateUID = m.isValid() ? getDateUID(m, "day") : getDateUID(momentFn(), "day");

      for (const task of dayTasks) {
        if (!task.selected) continue;

        const created = addTask({
          title: task.title,
          description: task.description,
          completed: false,
          status: "todo",
          dateUID,
          projectId: this.selectedProjectId,
          notePath: null,
          boundNotePath: this.notePath || null,
          priority: task.priority,
          tags: [],
          sortOrder: 0,
          estimatedTime: task.estimatedMinutes,
          scheduledTime: task.scheduledTime,
          endTime: undefined,
        });

        if (task.subtasks.length > 0) {
          for (const subtask of task.subtasks) {
            addChecklistItem(created.id, subtask.title);
          }
        }

        count++;
      }
    }

    new Notice(tRaw("ai.created", { count: String(count) }));
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
