import type { App } from "obsidian";
import { Notice } from "obsidian";
import { get } from "svelte/store";
import { getDateUID } from "obsidian-daily-notes-interface";
import {
  guardTyping,
  installTypingShield,
} from "../ui/CustomModal";
import { mountTypingBlock } from "../ui/typingDots";
import { FileSuggestModal } from "../modals/FileSuggestModal";
import { tRaw } from "../i18n";
import { errorMessage } from "../utils/sanitize";
import type { ExtractedTask } from "./OllamaService";
import { resolveModel } from "./OllamaService";
import { resolveAiConnection, type AiConnection } from "./aiProvider";
import {
  extractTasksFromNoteStream,
  applyTasksInstruction,
  computeEndTime,
  parseDurationHint,
} from "./OllamaService";
import { addTask, addChecklistItem, projects, tasks } from "../task-tracker/stores";
import {
  buildLoadSummary,
  dateStrFromUID,
  findFreeSlot,
  type BusySlot,
  type DayLoad,
} from "../task-tracker/freeSlot";
import { settings } from "../ui/stores";
import type { ISettings } from "../settings";

/** Human duration for the estimate input, e.g. "2 \u{447}" or "30 \u{43C}\u{438}\u{43D}". */
function formatEst(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hUnit = "\u{447}";
  const mUnit = "\u{43C}\u{438}\u{43D}";
  return h > 0 ? (m > 0 ? `${h} ${hUnit} ${m} ${mUnit}` : `${h} ${hUnit}`) : `${m} ${mUnit}`;
}

const momentFn = window.moment;

type ChatRole = "user" | "assistant";

interface ChatEntry {
  role: ChatRole;
  text: string;
  streaming?: boolean;
}

/**
 * AI task extraction UI. Hosted in a detached workspace window (AIExtractView)
 * so the note stays usable while extraction runs.
 */
export class AiExtractPanel {
  private app: App;
  private root: HTMLElement;
  private contentEl!: HTMLElement;
  private onRequestClose?: () => void;
  private unbindTyping: (() => void) | null = null;

  private notePath: string;
  private noteInputEl: HTMLInputElement | null = null;
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
  private analysisRawEl: HTMLDivElement | null = null;
  private analysisRaf = 0;
  private analysisPending = "";
  private modelCaptionEl: HTMLDivElement | null = null;
  private analysisSpinnerEl: HTMLDivElement | null = null;
  private askPanelEl: HTMLDivElement | null = null;
  private chatLogEl: HTMLDivElement | null = null;
  private chatInputEl: HTMLTextAreaElement | null = null;
  private chatSendBtn: HTMLButtonElement | null = null;
  private chatHistory: ChatEntry[] = [];
  private extractBtnEl: HTMLButtonElement | null = null;
  private askReady = false;

  constructor(
    app: App,
    root: HTMLElement,
    initialNotePath = "",
    opts: { onRequestClose?: () => void } = {},
  ) {
    this.app = app;
    this.root = root;
    this.onRequestClose = opts.onRequestClose;
    this.notePath = initialNotePath;
    const now = new Date();
    this.distributeStartDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  /** Point the extractor at a note and run — same as opening the old modal on it. */
  setNotePath(path: string): void {
    this.notePath = path;
    if (this.noteInputEl) this.noteInputEl.value = path;
    void this.runExtraction();
  }

  mount(): void {
    this.root.empty();
    this.root.addClass("ai-extract-modal");
    this.contentEl = this.root.createDiv({ cls: "wf-dialog-content" });
    this.unbindTyping = installTypingShield(this.root);

    // ── Top bar: title + note + extract ──────────────────────────────────
    const top = this.contentEl.createDiv({ cls: "ai-top" });
    const topHead = top.createDiv({ cls: "ai-top-head" });
    topHead.createEl("h2", { text: tRaw("ai.button"), cls: "ai-title" });

    const noteRow = top.createDiv({ cls: "ai-note-row" });
    this.noteInputEl = noteRow.createEl("input", {
      type: "text",
      cls: "ai-input",
      placeholder: tRaw("ai.selectNoteDesc"),
      value: this.notePath,
    });
    const noteInput = this.noteInputEl;
    noteInput.addEventListener("input", () => {
      this.notePath = noteInput.value;
    });
    // Enter on note path = extract (same as «Извлечь задачи»)
    guardTyping(noteInput, () => void this.runExtraction());
    const noteBtn = noteRow.createEl("button", {
      text: "…",
      cls: "ai-file-btn",
      attr: { title: tRaw("ai.selectNote") },
    });
    noteBtn.addEventListener("click", () => {
      new FileSuggestModal(this.app, (filePath) => {
        this.notePath = filePath;
        noteInput.value = filePath;
      }).open();
    });
    this.extractBtnEl = noteRow.createEl("button", {
      text: tRaw("ai.extract"),
      cls: "ai-btn ai-btn-primary ai-extract-btn",
    });
    this.extractBtnEl.addEventListener("click", () => void this.runExtraction());

    // Status
    this.statusEl = this.contentEl.createDiv({ cls: "ai-status" });

    // Live analysis panel
    this.analysisPanelEl = this.contentEl.createDiv({ cls: "ai-analysis-panel ai-hidden" });
    // Model caption slot — sits ABOVE the analysis field
    this.modelCaptionEl = this.analysisPanelEl.createDiv({ cls: "ai-model-caption-slot" });
    const analysisHeader = this.analysisPanelEl.createDiv({ cls: "ai-analysis-header" });
    this.analysisSpinnerEl = analysisHeader.createDiv({ cls: "ai-analysis-spinner" });
    analysisHeader.createSpan({ text: tRaw("ai.analyzing"), cls: "ai-analysis-label" });
    this.analysisStreamEl = this.analysisPanelEl.createDiv({ cls: "ai-analysis-stream" });

    // Preview (main scroll area)
    this.previewEl = this.contentEl.createDiv({ cls: "ai-preview" });
    this.previewEl.addClass("ai-hidden");

    // Footer: settings + actions
    this.footerEl = this.contentEl.createDiv({ cls: "ai-footer" });
    this.footerEl.addClass("ai-hidden");

    // Ask AI composer — sticky bottom, always visible after extract
    this.renderAskPanel();

    // Global Enter when focus is not in a field → add selected tasks
    this.contentEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if (tag === "BUTTON" || tag === "A") return;
      if (!this.footerEl || this.footerEl.hasClass("ai-hidden")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void this.addSelectedTasks();
    });

    // Auto-load if note path was provided
    if (this.notePath) {
      void this.loadNoteContent().then(() => void this.runExtraction());
    }
  }

  destroy(): void {
    this.unbindTyping?.();
    this.unbindTyping = null;
    this.extractAbort?.abort();
    this.extractAbort = null;
    this.askAbort?.abort();
    this.askAbort = null;
    this.root.empty();
  }

  private getOllamaOpts(): { conn: AiConnection; model: string; contextSize: number } {
    const opts: ISettings = get(settings);
    return {
      conn: resolveAiConnection(opts),
      model: resolveModel("extract", opts),
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
      this.analysisPanelEl?.removeClass("ai-hidden", "ai-analysis-empty");
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

  /**
   * Enable/disable the prompt window (input + send).
   * Uses readOnly instead of disabled so the caret/focus survive lock/unlock —
   * `disabled` blurs the field and Space then scrolls .wf-dialog-content.
   */
  private setAskEnabled(enabled: boolean): void {
    if (this.chatInputEl) {
      this.chatInputEl.readOnly = !enabled;
      this.chatInputEl.disabled = false;
    }
    if (this.chatSendBtn) this.chatSendBtn.disabled = !enabled || this.isAsking;
    if (this.askPanelEl) {
      if (enabled) this.askPanelEl.removeClass("ai-ask-disabled");
      else this.askPanelEl.addClass("ai-ask-disabled");
    }
    if (this.chatInputEl) {
      this.chatInputEl.placeholder = enabled
        ? tRaw("ai.askPlaceholder")
        : tRaw("ai.askDisabledPlaceholder");
      if (enabled) this.chatInputEl.focus();
    }
  }

  /** Existing calendar load (next 7 days) - feeds AI scheduling prompts. */
  private buildScheduleContext(): string {
    const all = get(tasks);
    const entries: DayLoad[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(`${this.distributeStartDate}T00:00:00`);
      d.setDate(d.getDate() + i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      entries.push({
        date,
        busy: all
          .filter((t) => !t.completed && dateStrFromUID(t.dateUID) === date)
          .map((t) => ({
            scheduledTime: t.scheduledTime,
            endTime: t.endTime,
            estimatedTime: t.estimatedTime,
          })),
      });
    }
    return buildLoadSummary(entries);
  }

  /** Live model output during extraction (throttled to one DOM write per frame). */
  private streamAnalysis(full: string): void {
    this.analysisPending = full;
    if (this.analysisRaf) return;
    this.analysisRaf = window.requestAnimationFrame(() => {
      this.analysisRaf = 0;
      const host = this.analysisStreamEl;
      if (!host) return;
      if (!this.analysisRawEl) {
        host.empty();
        this.analysisRawEl = host.createDiv({ cls: "ai-analysis-raw" });
      }
      this.analysisRawEl.textContent = this.analysisPending;
      host.scrollTop = host.scrollHeight;
    });
  }

  private resetAnalysisStream(): void {
    if (this.analysisRaf) {
      window.cancelAnimationFrame(this.analysisRaf);
      this.analysisRaf = 0;
    }
    this.analysisRawEl = null;
    this.analysisPending = "";
    if (this.analysisStreamEl) {
      // Spinner centered in the field; model label lives ABOVE the field
      const opts = get(settings) as {
        ollamaModel?: string;
        ollamaModelMode?: "single" | "dual";
        ollamaModelExtract?: string;
      };
      mountTypingBlock(this.analysisStreamEl, resolveModel("extract", opts), this.modelCaptionEl);
    }
    if (this.analysisPanelEl) this.analysisPanelEl.removeClass("ai-hidden");
  }

  private hideAnalysisPanel(): void {
    if (this.analysisPanelEl) this.analysisPanelEl.addClass("ai-hidden");
  }

  /** Empty result: red panel, no loader — only the "not found" message. */
  private showNoTasksResult(): void {
    if (this.analysisStreamEl) this.analysisStreamEl.empty();
    this.analysisSpinnerEl?.addClass("ai-hidden");
    if (this.analysisPanelEl) {
      this.analysisPanelEl.removeClass("ai-analysis-active");
      this.analysisPanelEl.addClass("ai-analysis-empty");
      this.analysisPanelEl.removeClass("ai-hidden");
    }
    const labelEl = this.analysisPanelEl?.querySelector(".ai-analysis-label");
    if (labelEl) labelEl.textContent = tRaw("ai.noTasksHint");
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

    const { conn, model, contextSize } = this.getOllamaOpts();

    this.extractAbort?.abort();
    this.extractAbort = new AbortController();
    this.resetAnalysisStream();
    this.setAnalyzing(true, `${model}: ${tRaw("ai.analyzing")}`);
    this.showStatus(`⚡ ${model}: ${tRaw("ai.analyzing")}`, "loading");
    this.askReady = false;

    try {
      const result = await extractTasksFromNoteStream(
        conn,
        model,
        this.noteContent,
        contextSize,
        {
          signal: this.extractAbort.signal,
          scheduleContext: this.autoScheduleTime ? this.buildScheduleContext() : undefined,
          onDelta: (_delta, full) => this.streamAnalysis(full),
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
        this.showNoTasksResult();
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
      const msg = errorMessage(e);
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
    titleWrap.createSpan({
      text: "Enter — выполнить · Shift+Enter — перенос",
      cls: "ai-ask-hint-inline",
    });
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
    this.chatInputEl.readOnly = true;
    // Enter = «Выполнить», Shift+Enter = newline
    guardTyping(this.chatInputEl, () => void this.sendPromptCommand());
    inputShell.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement | null;
      if (t === this.chatInputEl || t?.closest("button")) return;
      e.preventDefault();
      this.chatInputEl?.focus();
    });

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
    if (!this.chatLogEl) return createDiv();
    // Drop the initial hint once real chat starts
    this.chatLogEl.querySelector(".ai-chat-hint")?.remove();

    const row = this.chatLogEl.createDiv({ cls: `ai-chat-msg ai-chat-msg-${entry.role}` });
    const opts = get(settings) as { userName?: string; aiName?: string };
    const userLabel = (opts.userName || "").trim() || tRaw("ai.chatYou");
    const aiLabel = (opts.aiName || "").trim() || tRaw("ai.chatAI");
    row.createDiv({ cls: "ai-chat-role", text: entry.role === "user" ? userLabel : aiLabel });
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

    const { conn, model, contextSize } = this.getOllamaOpts();
    this.chatInputEl.value = "";
    this.isAsking = true;
    this.setAskEnabled(false);

    const userEntry: ChatEntry = { role: "user", text: question };
    this.chatHistory.push(userEntry);
    this.renderChatEntry(userEntry);

    const assistantEntry: ChatEntry = { role: "assistant", text: tRaw("ai.applying"), streaming: true };
    this.chatHistory.push(assistantEntry);
    const assistantRow = this.renderChatEntry(assistantEntry);
    const bubbleEl = assistantRow.querySelector(".ai-chat-bubble");

    this.askAbort?.abort();
    this.askAbort = new AbortController();

    try {
      const result = await applyTasksInstruction(
        conn,
        model,
        question,
        this.tasks,
        contextSize > 0 ? this.noteContent.slice(0, contextSize) : this.noteContent,
        this.distributeStartDate || undefined,
        {
          signal: this.askAbort.signal,
          scheduleContext: this.buildScheduleContext(),
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
      const msg = errorMessage(e);
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
        // Fill only what the model left unplaced, into real free windows of the day
        const storeBusy: BusySlot[] = get(tasks)
          .filter((t) => !t.completed && dateStrFromUID(t.dateUID) === dateStr)
          .map((t) => ({
            scheduledTime: t.scheduledTime,
            endTime: t.endTime,
            estimatedTime: t.estimatedTime,
          }));
        const placed: BusySlot[] = [];
        for (const task of dayTasks) {
          if (task.scheduledTime) {
            if (!task.endTime && task.estimatedMinutes) {
              task.endTime = computeEndTime(task.scheduledTime, task.estimatedMinutes);
            }
            placed.push({
              scheduledTime: task.scheduledTime,
              endTime: task.endTime,
              estimatedTime: task.estimatedMinutes,
            });
          } else {
            const slot = findFreeSlot([...storeBusy, ...placed], task.estimatedMinutes || 60);
            if (!slot) continue; // day is full - leave the time for the user
            task.scheduledTime = slot.scheduledTime;
            if (task.estimatedMinutes) {
              task.endTime = computeEndTime(task.scheduledTime, task.estimatedMinutes);
            }
            placed.push({
              scheduledTime: slot.scheduledTime,
              endTime: task.endTime ?? slot.endTime,
              estimatedTime: task.estimatedMinutes,
            });
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

      // Day header
      const dayHeader = dayCard.createDiv({ cls: "ai-day-card-header" });
      const dayTitle = dayHeader.createDiv({ cls: "ai-day-card-title" });
      dayTitle.createSpan({
        text: tRaw("ai.dayLabel", { n: String(dayIdx) }),
        cls: "ai-day-num",
      });
      const m = momentFn(date, "YYYY-MM-DD", true);
      if (m.isValid()) {
        dayTitle.createSpan({ text: m.format("dddd, D MMMM"), cls: "ai-day-date-label" });
      }

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
          this.renderFooter();
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

        meta.createSpan({ text: "—", cls: "ai-task-time-sep" });

        let estInputEl: HTMLInputElement | null = null;

        // End time input
        let endTimeValue = task.endTime || "";
        if (!endTimeValue && task.scheduledTime && task.estimatedMinutes) {
          endTimeValue = computeEndTime(task.scheduledTime, task.estimatedMinutes);
        }
        if (endTimeValue) {
          this.tasks[taskIdx].endTime = endTimeValue;
        }
        const endTimeInput = meta.createEl("input", {
          type: "text",
          cls: "ai-task-time-input",
          placeholder: "11:00",
          value: endTimeValue,
        });
        endTimeInput.addEventListener("input", () => {
          const end = endTimeInput.value;
          this.tasks[taskIdx].endTime = end || undefined;

          // Recalculate estimatedMinutes from start+end
          const start = timeInput.value;
          if (start && end && /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)) {
            const [sh, sm] = start.split(":").map(Number);
            const [eh, em] = end.split(":").map(Number);
            const diff = (eh * 60 + em) - (sh * 60 + sm);
            if (diff > 0) {
              this.tasks[taskIdx].estimatedMinutes = diff;
              if (estInputEl) estInputEl.value = formatEst(diff);
            }
          }
        });
        guardTyping(endTimeInput);

        // One-click day-part picks for tasks the AI left unplaced
        const dayPart = (label: string, time: string) => {
          const chip = meta.createEl("button", {
            cls: "ai-task-daypart",
            text: label,
            attr: { type: "button" },
          });
          chip.addEventListener("click", () => {
            this.tasks[taskIdx].scheduledTime = time;
            timeInput.value = time;
            this.updateEndTime(taskIdx, endTimeInput);
          });
        };
        dayPart(tRaw("ai.timeMorning"), "09:00");
        dayPart(tRaw("ai.timeDay"), "14:00");
        dayPart(tRaw("ai.timeEvening"), "18:00");

        // Duration input ("2 h", "2 hours", "120") - keeps endTime in sync
        estInputEl = meta.createEl("input", {
          type: "text",
          cls: "ai-task-time-input ai-task-est-input",
          placeholder: tRaw("ai.estPlaceholder"),
          value: task.estimatedMinutes ? formatEst(task.estimatedMinutes) : "",
        });
        estInputEl.addEventListener("change", () => {
          const raw = (estInputEl?.value ?? "").trim();
          const mins = /^\d+$/.test(raw) ? parseInt(raw, 10) : (parseDurationHint(raw) ?? 0);
          this.tasks[taskIdx].estimatedMinutes = mins > 0 ? mins : undefined;
          if (estInputEl && mins > 0) estInputEl.value = formatEst(mins);
          this.updateEndTime(taskIdx, endTimeInput);
        });
        guardTyping(estInputEl);

        // Subtasks badge
        if (task.subtasks.length > 0) {
          const stBadge = meta.createSpan({
            text: `☐ ${tRaw("ai.subtasksCount", { count: task.subtasks.length })}`,
            cls: "ai-subtasks-badge",
          });
          // Subtasks container — append to taskList (AFTER taskRow), not inside taskRow
          let subtasksListEl: HTMLDivElement | null = null;
          stBadge.addEventListener("click", () => {
            if (subtasksListEl) {
              subtasksListEl.remove();
              subtasksListEl = null;
              stBadge.textContent = `☐ ${tRaw("ai.subtasksCount", { count: task.subtasks.length })}`;
            } else {
              subtasksListEl = taskList.createDiv({ cls: "ai-subtasks-list" });
              for (const st of task.subtasks) {
                const stItem = subtasksListEl.createDiv({ cls: "ai-subtask-item" });
                stItem.createSpan({ text: "☐" });
                stItem.createSpan({ text: st.title, cls: "ai-subtask-title" });
              }
              stBadge.textContent = `☑ ${tRaw("ai.subtasksCount", { count: task.subtasks.length })}`;
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
      const end = computeEndTime(task.scheduledTime, task.estimatedMinutes);
      endTimeInput.value = end;
      task.endTime = end;
    } else {
      endTimeInput.value = "";
      task.endTime = undefined;
    }
  }

  private renderFooter(): void {
    if (!this.footerEl) return;
    this.footerEl.empty();

    // Compact toolbar: project · from · auto-time
    const toolbar = this.footerEl.createDiv({ cls: "ai-footer-toolbar" });

    const projWrap = toolbar.createDiv({ cls: "ai-footer-field" });
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

    const dateWrap = toolbar.createDiv({ cls: "ai-footer-field ai-footer-field-date" });
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

    const toggleLabel = toolbar.createEl("label", { cls: "ai-toggle-label" });
    this.autoScheduleToggleEl = toggleLabel.createEl("input", { type: "checkbox", cls: "ai-toggle-cb" });
    this.autoScheduleToggleEl.checked = this.autoScheduleTime;
    this.autoScheduleToggleEl.addEventListener("change", () => {
      this.autoScheduleTime = this.autoScheduleToggleEl?.checked ?? false;
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

    // Actions row
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

    const selectedCount = this.tasks.filter((t) => t.selected).length;
    const addBtn = btnRow.createEl("button", {
      text: selectedCount > 0
        ? `${tRaw("ai.addSelected")} (${selectedCount})`
        : tRaw("ai.addSelected"),
      cls: "ai-btn ai-btn-primary ai-add-btn",
    });
    addBtn.disabled = selectedCount === 0;
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
          // Subtasks go to the checklist only — never into description
          description: task.description,
          completed: false,
          status: "todo",
          dateUID,
          projectId: this.selectedProjectId,
          boundNotePath: this.notePath || null,
          priority: task.priority,
          sortOrder: 0,
          estimatedTime: task.estimatedMinutes,
          scheduledTime: task.scheduledTime,
          endTime:
            task.endTime ||
            (task.scheduledTime && task.estimatedMinutes
              ? computeEndTime(task.scheduledTime, task.estimatedMinutes)
              : undefined),
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
    this.onRequestClose?.();
  }
}
