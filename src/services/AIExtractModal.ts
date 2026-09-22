import type { App } from "obsidian";
import { Notice } from "obsidian";
import { get } from "svelte/store";
import { getDateUID } from "obsidian-daily-notes-interface";
import { CustomModal } from "../ui/CustomModal";
import { FileSuggestModal } from "../modals/FileSuggestModal";
import { tRaw } from "../i18n";
import type { ExtractedTask } from "./OllamaService";
import {
  extractTasksFromNoteStream,
  applyTasksInstruction,
} from "./OllamaService";
import { addTask, addChecklistItem, projects } from "../task-tracker/stores";
import { settings } from "../ui/stores";
import type { ISettings } from "../settings";

const momentFn = window.moment;

type ChatRole = "user" | "assistant";

interface ChatEntry {
  role: ChatRole;
  text: string;
  streaming?: boolean;
}

/**
 * Insert text at the caret, preserving selection replace and undo when possible.
 */
function insertTextAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): void {
  el.focus();
  // execCommand keeps the native undo stack in Chromium/Obsidian
  if (document.execCommand("insertText", false, text)) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function isSpaceKey(e: KeyboardEvent): boolean {
  return (e.key === " " || e.code === "Space") && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * Stop global/hotkey handlers from swallowing typed characters (especially Space).
 * Never preventDefault on normal keys — the field keeps default insertion —
 * except Space, which is inserted manually so hotkeys cannot cancel it.
 */
function guardTyping(
  el: HTMLInputElement | HTMLTextAreaElement,
  onEnter?: () => void,
): void {
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") return;
    if (onEnter && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      onEnter();
      return;
    }
    // Space: take full control — a hotkey may have already preventDefault'd insertion
    if (isSpaceKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      insertTextAtCursor(el, " ");
      return;
    }
    // Letters, digits — default insertion must stay; only stop bubbling
    e.stopPropagation();
  }, true);
}

export class AIExtractModal extends CustomModal {
  private notePath: string;
  private noteContent = "";
  private tasks: ExtractedTask[] = [];
  private distributeStartDate = "";
  private isAnalyzing = false;
  private isAsking = false;
  private selectedProjectId: string | null = null;
  private dayDateOverrides: Map<number, string> = new Map();
  private autoScheduleTime = false;
  private originalTasks: ExtractedTask[] = []; // snapshot before auto-schedule
  private draggedTaskIdx: number | null = null;
  private extractAbort: AbortController | null = null;
  private askAbort: AbortController | null = null;

  private previewEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private footerEl: HTMLDivElement | null = null;
  private autoScheduleToggleEl: HTMLInputElement | null = null;
  private analysisPanelEl: HTMLDivElement | null = null;
  private analysisStreamEl: HTMLDivElement | null = null;
  private analysisSpinnerEl: HTMLDivElement | null = null;
  private askPanelEl: HTMLDivElement | null = null;
  private chatLogEl: HTMLDivElement | null = null;
  private chatInputEl: HTMLTextAreaElement | null = null;
  private chatSendBtn: HTMLButtonElement | null = null;
  private chatHistory: ChatEntry[] = [];
  private extractBtnEl: HTMLButtonElement | null = null;
  private askReady = false;

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
    guardTyping(noteInput);
    const noteBtn = noteRow.createEl("button", { text: "...", cls: "ai-file-btn" });
    noteBtn.addEventListener("click", () => {
      new FileSuggestModal(this.app, async (filePath) => {
        this.notePath = filePath;
        noteInput.value = filePath;
      }).open();
    });

    // Status
    this.statusEl = this.contentEl.createDiv({ cls: "ai-status" });

    // Live analysis panel (animation + streaming model output) — always mounted
    this.analysisPanelEl = this.contentEl.createDiv({ cls: "ai-analysis-panel ai-hidden" });
    const analysisHeader = this.analysisPanelEl.createDiv({ cls: "ai-analysis-header" });
    this.analysisSpinnerEl = analysisHeader.createDiv({ cls: "ai-analysis-spinner" });
    analysisHeader.createSpan({ text: tRaw("ai.analyzing"), cls: "ai-analysis-label" });
    this.analysisStreamEl = this.analysisPanelEl.createDiv({ cls: "ai-analysis-stream" });

    // Ask-AI prompt window — placed high so it's immediately visible
    this.renderAskPanel();

    // Preview area
    this.previewEl = this.contentEl.createDiv({ cls: "ai-preview" });
    this.previewEl.addClass("ai-hidden");

    // Footer
    this.footerEl = this.contentEl.createDiv({ cls: "ai-footer" });
    this.footerEl.addClass("ai-hidden");

    // Extract button
    this.extractBtnEl = this.contentEl.createEl("button", {
      text: tRaw("ai.extract"),
      cls: "ai-btn ai-btn-primary ai-extract-btn",
    });
    this.extractBtnEl.addEventListener("click", () => void this.runExtraction());

    // Auto-load if note path was provided
    if (this.notePath) {
      void this.loadNoteContent().then(() => void this.runExtraction());
    }
  }

  private getOllamaOpts(): { url: string; model: string; contextSize: number } {
    const opts: ISettings = get(settings);
    return {
      url: opts.ollamaUrl || "http://localhost:11434",
      model: opts.ollamaModel || "llama3.1",
      contextSize: opts.ollamaContextSize || 0,
    };
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

  // -------------------------------------------------------------------------
  // Analysis animation + streaming
  // -------------------------------------------------------------------------

  private setAnalyzing(active: boolean, label?: string): void {
    this.isAnalyzing = active;
    if (active) {
      this.analysisPanelEl?.removeClass("ai-hidden");
      this.analysisPanelEl?.addClass("ai-analysis-active");
      this.analysisSpinnerEl?.removeClass("ai-hidden");
      const labelEl = this.analysisPanelEl?.querySelector(".ai-analysis-label");
      if (labelEl) labelEl.textContent = label || tRaw("ai.analyzing");
      if (this.extractBtnEl) this.extractBtnEl.disabled = true;
      // Prompt window stays locked until monitoring finishes
      this.setAskEnabled(false);
    } else {
      this.analysisPanelEl?.removeClass("ai-analysis-active");
      this.analysisSpinnerEl?.addClass("ai-hidden");
      if (this.extractBtnEl) this.extractBtnEl.disabled = false;
      // Enable only after monitoring is done and we have tasks
      this.setAskEnabled(this.askReady && this.tasks.length > 0);
    }
  }

  /** Enable/disable the prompt window (input + send). */
  private setAskEnabled(enabled: boolean): void {
    if (this.chatInputEl) this.chatInputEl.disabled = !enabled;
    if (this.chatSendBtn) this.chatSendBtn.disabled = !enabled || this.isAsking;
    if (this.askPanelEl) {
      if (enabled) this.askPanelEl.removeClass("ai-ask-disabled");
      else this.askPanelEl.addClass("ai-ask-disabled");
    }
    if (this.chatInputEl) {
      this.chatInputEl.placeholder = enabled
        ? tRaw("ai.askPlaceholder")
        : tRaw("ai.askDisabledPlaceholder");
    }
  }

  private appendStreamDelta(delta: string): void {
    if (!this.analysisStreamEl) return;
    // Keep the raw model stream visible with a soft typing feel
    this.analysisStreamEl.textContent = (this.analysisStreamEl.textContent ?? "") + delta;
    this.analysisStreamEl.scrollTop = this.analysisStreamEl.scrollHeight;
  }

  private resetAnalysisStream(): void {
    if (this.analysisStreamEl) this.analysisStreamEl.textContent = "";
    if (this.analysisPanelEl) this.analysisPanelEl.removeClass("ai-hidden");
  }

  private hideAnalysisPanel(): void {
    if (this.analysisPanelEl) this.analysisPanelEl.addClass("ai-hidden");
  }

  private async runExtraction(): Promise<void> {
    if (this.isAnalyzing) return;
    if (!this.notePath) {
      this.showStatus(tRaw("ai.noNoteSelected"), "error");
      return;
    }

    await this.loadNoteContent();
    if (!this.noteContent.trim()) {
      this.showStatus(tRaw("ai.noTasks"), "info");
      return;
    }

    const { url, model, contextSize } = this.getOllamaOpts();

    this.extractAbort?.abort();
    this.extractAbort = new AbortController();
    this.resetAnalysisStream();
    this.setAnalyzing(true, `${model}: ${tRaw("ai.analyzing")}`);
    this.showStatus(`⚡ ${model}: ${tRaw("ai.analyzing")}`, "loading");
    this.askReady = false;

    try {
      const result = await extractTasksFromNoteStream(
        url,
        model,
        this.noteContent,
        contextSize,
        {
          signal: this.extractAbort.signal,
          onDelta: (delta) => this.appendStreamDelta(delta),
          onProgress: (stage) => {
            if (stage === "connecting") {
              this.setAnalyzing(true, tRaw("ai.stages.connecting"));
            } else if (stage === "streaming") {
              this.setAnalyzing(true, tRaw("ai.stages.streaming"));
            } else if (stage === "fallback") {
              this.setAnalyzing(true, tRaw("ai.stages.fallback"));
            } else if (stage === "parsing") {
              this.setAnalyzing(true, tRaw("ai.stages.parsing"));
            }
          },
        },
      );

      this.tasks = result.tasks;

      if (this.tasks.length === 0) {
        this.askReady = false;
        this.setAnalyzing(false);
        this.showStatus(tRaw("ai.noTasksHint"), "info");
        return;
      }

      this.dayDateOverrides.clear();
      // Use week context dates as default distribution start if available
      if (result.weekContext.weekStart) {
        this.distributeStartDate = result.weekContext.weekStart;
      }
      // Store original task state for toggle restore
      this.originalTasks = this.tasks.map((t) => ({ ...t, subtasks: [...t.subtasks] }));

      const ctxInfo = result.weekContext.weekFocus ? ` · ${result.weekContext.weekFocus}` : "";
      this.showStatus(`✓ ${model} → ${tRaw("ai.preview")} (${this.tasks.length})${ctxInfo}`, "success");
      this.askReady = true;
      this.setAnalyzing(false);
      this.hideAnalysisPanel();
      this.renderPreview(true);
    } catch (e: unknown) {
      this.askReady = false;
      this.setAnalyzing(false);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Failed to fetch") || msg.includes("ECONNREFUSED") || msg.includes("NetworkError") || msg.includes("fetch")) {
        this.showStatus(tRaw("ai.connectionError"), "error");
      } else {
        this.showStatus(tRaw("ai.error", { error: msg }), "error");
      }
    } finally {
      this.extractAbort = null;
    }
  }

  private showStatus(text: string, type: "info" | "loading" | "error" | "success"): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.className = "ai-status ai-status-" + type;
  }

  // -------------------------------------------------------------------------
  // Prompt window — edit tasks or answer questions in task context
  // -------------------------------------------------------------------------

  private renderAskPanel(): void {
    if (!this.contentEl) return;
    this.askPanelEl?.remove();

    this.askPanelEl = this.contentEl.createDiv({ cls: "ai-ask-panel ai-ask-disabled" });

    const askHeader = this.askPanelEl.createDiv({ cls: "ai-ask-header" });
    const titleWrap = askHeader.createDiv({ cls: "ai-ask-title-wrap" });
    titleWrap.createSpan({ text: "✦", cls: "ai-ask-icon" });
    titleWrap.createSpan({ text: tRaw("ai.askTitle"), cls: "ai-ask-title" });
    const toggleBtn = askHeader.createEl("button", {
      text: "▾",
      cls: "ai-ask-toggle",
      attr: { "aria-label": tRaw("ai.askToggle") },
    });

    const askBody = this.askPanelEl.createDiv({ cls: "ai-ask-body" });

    this.chatLogEl = askBody.createDiv({ cls: "ai-chat-log" });
    this.chatLogEl.createDiv({
      cls: "ai-chat-hint",
      text: tRaw("ai.askHint"),
    });

    const inputShell = askBody.createDiv({ cls: "ai-ask-input-shell" });
    this.chatInputEl = inputShell.createEl("textarea", {
      cls: "ai-ask-input",
      placeholder: tRaw("ai.askDisabledPlaceholder"),
      attr: { rows: "2" },
    });
    this.chatInputEl.disabled = true;
    guardTyping(this.chatInputEl, () => void this.sendPromptCommand());

    this.chatSendBtn = inputShell.createEl("button", {
      text: tRaw("ai.askSend"),
      cls: "ai-btn ai-btn-primary ai-ask-send",
    });
    this.chatSendBtn.disabled = true;
    this.chatSendBtn.addEventListener("click", () => void this.sendPromptCommand());

    toggleBtn.addEventListener("click", () => {
      const collapsed = this.askPanelEl?.hasClass("ai-ask-collapsed") ?? false;
      if (collapsed) {
        this.askPanelEl?.removeClass("ai-ask-collapsed");
        toggleBtn.textContent = "▾";
      } else {
        this.askPanelEl?.addClass("ai-ask-collapsed");
        toggleBtn.textContent = "▸";
      }
    });
  }

  private renderChatEntry(entry: ChatEntry): HTMLElement {
    if (!this.chatLogEl) return document.createElement("div");
    // Drop the initial hint once real chat starts
    this.chatLogEl.querySelector(".ai-chat-hint")?.remove();

    const row = this.chatLogEl.createDiv({ cls: `ai-chat-msg ai-chat-msg-${entry.role}` });
    row.createDiv({ cls: "ai-chat-role", text: entry.role === "user" ? tRaw("ai.chatYou") : tRaw("ai.chatAI") });
    const bubble = row.createDiv({ cls: "ai-chat-bubble" });
    bubble.textContent = entry.text;
    if (entry.streaming) {
      row.addClass("ai-chat-streaming");
      row.createDiv({ cls: "ai-chat-cursor" });
    }
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
    return row;
  }

  /**
   * Send a prompt-window message:
   * - edit commands are APPLIED to the task list (dates, grouping, priority…)
   * - questions are answered in the context of current tasks
   * Locked while analysis is running; locked again while a command runs.
   */
  private async sendPromptCommand(): Promise<void> {
    if (this.isAsking || this.isAnalyzing || !this.chatInputEl) return;
    const question = this.chatInputEl.value.trim();
    if (!question) return;

    if (this.tasks.length === 0) {
      new Notice(tRaw("ai.askNoContext"));
      return;
    }

    const { url, model, contextSize } = this.getOllamaOpts();
    this.chatInputEl.value = "";
    this.isAsking = true;
    this.setAskEnabled(false);

    const userEntry: ChatEntry = { role: "user", text: question };
    this.chatHistory.push(userEntry);
    this.renderChatEntry(userEntry);

    const assistantEntry: ChatEntry = { role: "assistant", text: tRaw("ai.applying"), streaming: true };
    this.chatHistory.push(assistantEntry);
    const assistantRow = this.renderChatEntry(assistantEntry);
    const bubbleEl = assistantRow.querySelector(".ai-chat-bubble") as HTMLElement | null;

    this.askAbort?.abort();
    this.askAbort = new AbortController();

    try {
      const result = await applyTasksInstruction(
        url,
        model,
        question,
        this.tasks,
        contextSize > 0 ? this.noteContent.slice(0, contextSize) : this.noteContent,
        this.distributeStartDate || undefined,
        {
          signal: this.askAbort.signal,
          onDelta: () => {
            // Keep a live pulse in the bubble while the model works
            if (bubbleEl) {
              const dots = ".".repeat((Math.floor(Date.now() / 350) % 3) + 1);
              bubbleEl.textContent = `${tRaw("ai.applying")}${dots}`;
            }
          },
        },
      );

      assistantEntry.text = result.summary || tRaw("ai.done");
      if (bubbleEl) bubbleEl.textContent = assistantEntry.text;

      if (result.action === "edit" && result.tasks.length > 0) {
        // Apply edits to the live preview
        this.tasks = result.tasks.map((t) => ({ ...t, subtasks: [...t.subtasks] }));
        this.originalTasks = this.tasks.map((t) => ({ ...t, subtasks: [...t.subtasks] }));
        this.dayDateOverrides.clear();
        this.renderPreview(true);
        assistantEntry.text = `${result.summary}\n${tRaw("ai.appliedCount", { count: String(this.tasks.length) })}`;
        if (bubbleEl) bubbleEl.textContent = assistantEntry.text;
        this.showStatus(`✓ ${tRaw("ai.appliedCount", { count: String(this.tasks.length) })}`, "success");
      } else if (result.tasks.length > 0) {
        // Answer only — keep tasks as-is (model may echo a full copy)
        this.tasks = this.tasks.map((t) => ({ ...t, subtasks: [...t.subtasks] }));
      }

      assistantEntry.streaming = false;
      assistantRow.removeClass("ai-chat-streaming");
      assistantRow.querySelector(".ai-chat-cursor")?.remove();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      assistantEntry.streaming = false;
      assistantEntry.text = tRaw("ai.error", { error: msg });
      if (bubbleEl) bubbleEl.textContent = assistantEntry.text;
      assistantRow.removeClass("ai-chat-streaming");
      assistantRow.querySelector(".ai-chat-cursor")?.remove();
      assistantRow.addClass("ai-chat-msg-error");
    } finally {
      this.isAsking = false;
      this.setAskEnabled(!this.isAnalyzing && this.askReady && this.tasks.length > 0);
      this.askAbort = null;
    }
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

    // Group by effective date — explicit task.date wins over day-level override
    const byDate = new Map<string, ExtractedTask[]>();
    for (const task of this.tasks) {
      const day = task.dayIndex || 1;
      const override = this.dayDateOverrides.get(day);
      let dateStr: string;
      if (task.date) {
        dateStr = task.date;
      } else if (override) {
        dateStr = override;
      } else {
        dateStr = this.resolveDateForDay(day);
      }
      const list = byDate.get(dateStr) ?? [];
      list.push(task);
      byDate.set(dateStr, list);
    }

    for (const [dateStr, dayTasks] of byDate) {
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

  private renderPreview(animate = false): void {
    if (!this.previewEl || !this.footerEl) return;

    this.previewEl.removeClass("ai-hidden");
    this.footerEl.removeClass("ai-hidden");

    if (this.extractBtnEl) this.extractBtnEl.addClass("ai-hidden");

    this.previewEl.empty();

    const distribution = this.getDistribution();
    const dateEntries = [...distribution.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let animIdx = 0;

    for (const [date, dayTasks] of dateEntries) {
      // Find the dayIndex for this date group
      const dayIdx = dayTasks[0]?.dayIndex || 1;

      // Day card — drop target
      const dayCard = this.previewEl.createDiv({ cls: "ai-day-card" });
      if (animate) {
        dayCard.addClass("ai-card-enter");
        dayCard.style.animationDelay = `${Math.min(animIdx++, 8) * 60}ms`;
      }
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
          this.tasks[this.draggedTaskIdx].date = undefined; // clear model date so dayIndex takes effect
          this.draggedTaskIdx = null;
          this.renderPreview();
        }
      });

      // Day header with editable date
      const dayHeader = dayCard.createDiv({ cls: "ai-day-card-header" });
      const dayTitle = dayHeader.createDiv({ cls: "ai-day-card-title" });
      dayTitle.createEl("span", {
        text: tRaw("ai.dayLabel", { n: String(dayIdx) }),
        cls: "ai-day-num",
      });
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
        if (animate) {
          taskRow.addClass("ai-card-enter");
          taskRow.style.animationDelay = `${Math.min(animIdx++, 12) * 40}ms`;
        }
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
        const priorityClass = task.priority === "high" || task.priority === "low" ? task.priority : "medium";
        taskRow.createSpan({ cls: `ai-pri-dot ai-pri-dot-${priorityClass}` });

        // Main info
        const info = taskRow.createDiv({ cls: "ai-task-info" });

        // Title
        const titleEl = info.createEl("input", {
          type: "text",
          cls: "ai-task-title-input",
          value: task.title,
        });
        titleEl.addEventListener("input", () => { this.tasks[taskIdx].title = titleEl.value; });
        guardTyping(titleEl);

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
        guardTyping(timeInput);

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
        guardTyping(endTimeInput);

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
    this.extractAbort?.abort();
    this.extractAbort = null;
    this.askAbort?.abort();
    this.askAbort = null;
    this.contentEl.empty();
  }
}
