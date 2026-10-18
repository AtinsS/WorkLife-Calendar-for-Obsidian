import type { App, TFile, TFolder } from "obsidian";
import { Notice, TFile as TFileClass, TFolder as TFolderClass, normalizePath } from "obsidian";
import { CustomModal } from "../ui/CustomModal";
import { tRaw } from "../i18n";
import { settings } from "../ui/stores";
import { get } from "svelte/store";
import { streamOllamaChat, resolveModel } from "./OllamaService";
import { errorMessage } from "../utils/sanitize";
import { renderMarkdown } from "../ui/markdown";
import { mountTypingBlock } from "../ui/typingDots";
import {
  buildSummarySystem,
  normalizeSummaryStyle,
  summaryStyleLabel,
  type SummaryStyle,
} from "./summaryStyle";

const MAX_NOTES = 40;
const MAX_CHARS_PER_NOTE = 6000;
const MAX_TOTAL_CHARS = 48000;

export function collectMarkdownFiles(root: TFolder, depth = 0, maxDepth = 3): TFile[] {
  const out: TFile[] = [];
  if (depth > maxDepth) return out;
  for (const child of root.children) {
    if (child instanceof TFileClass && child.extension === "md") {
      out.push(child);
    } else if (child instanceof TFolderClass) {
      out.push(...collectMarkdownFiles(child, depth + 1, maxDepth));
    }
    if (out.length >= MAX_NOTES) break;
  }
  return out.slice(0, MAX_NOTES);
}

export function resolveSummarySources(
  _app: App,
  file: TFile | TFolder,
): { files: TFile[]; folderPath: string; title: string } {
  if (file instanceof TFolderClass) {
    const files = collectMarkdownFiles(file).filter((f) => !/^summary[-_ ]/i.test(f.basename));
    return {
      files,
      folderPath: file.path,
      title: file.name,
    };
  }
  const parent = file.parent;
  return {
    files: [file],
    folderPath: parent?.path ?? "",
    title: file.basename,
  };
}

export class AISummaryModal extends CustomModal {
  private files: TFile[];
  private folderPath: string;
  private sourcesLabel: string;
  private noteTitle = "";
  private noteTitleEdited = false;
  private summaryText = "";
  private isGenerating = false;
  private abort: AbortController | null = null;

  private style: SummaryStyle = "detailed";
  private customStyle = "";
  private styleSel: HTMLSelectElement | null = null;
  private customStyleWrap: HTMLElement | null = null;
  private customStyleEl: HTMLTextAreaElement | null = null;

  private titleEl: HTMLInputElement | null = null;
  private textareaEl: HTMLTextAreaElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private modelCaptionEl: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private typingHostEl: HTMLElement | null = null;
  private modeBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private progressFillEl: HTMLElement | null = null;
  private generateBtn: HTMLButtonElement | null = null;
  private createBtn: HTMLButtonElement | null = null;
  private viewMode: "preview" | "edit" = "edit";

  constructor(
    app: App,
    files: TFile[],
    folderPath: string,
    sourcesLabel: string,
  ) {
    super(app);
    this.files = files;
    this.folderPath = folderPath;
    this.sourcesLabel = sourcesLabel;

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const safeLabel = (sourcesLabel || "notes").replace(/[\\/:*?"<>|]/g, "").slice(0, 40).trim();
    this.noteTitle = `Summary ${dateStr} ${safeLabel}`.replace(/\s+/g, " ").trim() || `Summary ${dateStr}`;
  }

  onOpen(): void {
    this.contentEl.addClass("ai-summary-modal");
    this.containerEl?.addClass("ai-summary-shell");

    const head = this.contentEl.createDiv({ cls: "ai-summary-head" });
    head.createEl("h2", { text: tRaw("ai.summaryTitle"), cls: "ai-title" });
    head.createDiv({
      cls: "ai-summary-sources",
      text: tRaw("ai.summarySources", {
        count: String(this.files.length),
        label: this.sourcesLabel,
      }),
    });

    // Style picker (defaults from settings, overridable per run)
    const opts = get(settings) as {
      aiSummaryStyle?: SummaryStyle;
      aiSummaryCustomStyle?: string;
    };
    this.style = normalizeSummaryStyle(opts.aiSummaryStyle);
    this.customStyle = opts.aiSummaryCustomStyle || "";

    const styleRow = this.contentEl.createDiv({ cls: "ai-summary-style-row" });
    styleRow.createEl("label", {
      cls: "ai-summary-title-label",
      text: tRaw("settings.ai.summaryStyle"),
    });
    this.styleSel = styleRow.createEl("select", { cls: "ai-summary-style-select" });
    for (const s of ["brief", "detailed", "bullets", "executive", "custom"] as SummaryStyle[]) {
      const opt = this.styleSel.createEl("option", {
        value: s,
        text: summaryStyleLabel(s),
      });
      if (s === this.style) opt.selected = true;
    }
    this.styleSel.addEventListener("change", () => {
      this.style = normalizeSummaryStyle(this.styleSel?.value);
      this.syncCustomStyle();
    });

    this.customStyleWrap = this.contentEl.createDiv({
      cls: "ai-summary-custom-style mcp-hidden",
    });
    this.customStyleWrap.createEl("label", {
      cls: "ai-summary-title-label",
      text: tRaw("settings.ai.summaryStyleCustom"),
    });
    this.customStyleEl = this.customStyleWrap.createEl("textarea", {
      cls: "ai-summary-custom-style-input",
      attr: {
        rows: "3",
        placeholder: tRaw("settings.ai.summaryStyleCustomPlaceholder"),
        spellcheck: "false",
      },
    });
    this.customStyleEl.value = this.customStyle;
    this.customStyleEl.addEventListener("input", () => {
      this.customStyle = this.customStyleEl?.value || "";
    });
    this.syncCustomStyle();

    const titleRow = this.contentEl.createDiv({ cls: "ai-summary-title-row" });
    titleRow.createEl("label", {
      cls: "ai-summary-title-label",
      text: tRaw("ai.summaryNameLabel"),
    });
    this.titleEl = titleRow.createEl("input", {
      type: "text",
      cls: "ai-summary-title-input",
      value: this.noteTitle,
      attr: {
        placeholder: tRaw("ai.summaryNamePlaceholder"),
        spellcheck: "false",
      },
    });
    this.titleEl.addEventListener("input", () => {
      this.noteTitle = this.titleEl?.value ?? "";
      this.noteTitleEdited = true;
      this.syncCreateBtn();
    });

    this.statusEl = this.contentEl.createDiv({ cls: "ai-summary-status" });
    this.statusEl.createSpan({ cls: "ai-summary-spinner", attr: { "aria-hidden": "true" } });

    this.progressEl = this.contentEl.createDiv({ cls: "ai-summary-progress" });
    this.progressFillEl = this.progressEl.createDiv({ cls: "ai-summary-progress-fill" });

    // Scan shell wraps the output area (same visual language as AI extract analysis)
    // Model caption slot — sits ABOVE the answer field
    this.modelCaptionEl = this.contentEl.createDiv({ cls: "ai-model-caption-slot" });
    const scanShell = this.contentEl.createDiv({ cls: "ai-summary-scan" });

    // Pretty empty stub — textarea stays hidden until generation (or manual edit)
    this.emptyEl = scanShell.createDiv({ cls: "ai-summary-empty" });
    this.emptyEl.createDiv({ cls: "ai-summary-empty-icon", text: "✨" });
    this.emptyEl.createDiv({
      cls: "ai-summary-empty-title",
      text: tRaw("ai.summaryEmptyTitle"),
    });
    this.emptyEl.createDiv({
      cls: "ai-summary-empty-hint",
      text: tRaw("ai.summaryEmptyHint"),
    });

    this.textareaEl = scanShell.createEl("textarea", {
      cls: "ai-summary-textarea ai-hidden",
      attr: {
        rows: "14",
        placeholder: tRaw("ai.summaryPlaceholder"),
        spellcheck: "false",
        readonly: "readonly",
      },
    });
    this.textareaEl.value = this.summaryText;
    // Starts locked so the empty field doesn't look like a free-form editor.
    // Unlocks on explicit edit (click/focus) or after generation.
    this.textareaEl.readOnly = true;
    this.textareaEl.addEventListener("focus", () => {
      if (this.textareaEl && !this.isGenerating) this.textareaEl.readOnly = false;
    });
    this.textareaEl.addEventListener("input", () => {
      this.summaryText = this.textareaEl?.value ?? "";
      this.syncCreateBtn();
    });
    this.previewEl = scanShell.createDiv({ cls: "ai-summary-preview ai-hidden" });
    this.typingHostEl = scanShell.createDiv({ cls: "ai-summary-typing ai-hidden" });

    const footer = this.contentEl.createDiv({ cls: "ai-summary-footer" });
    this.modeBtn = footer.createEl("button", {
      text: tRaw("ai.summaryPreview"),
      cls: "ai-summary-mode-btn",
    });
    // Preview stays locked until the summary body exists (generated or typed).
    this.modeBtn.disabled = true;
    this.modeBtn.setAttribute("aria-disabled", "true");
    this.modeBtn.addEventListener("click", () => this.toggleViewMode());

    this.generateBtn = footer.createEl("button", {
      text: tRaw("ai.summaryGenerate"),
      cls: "mod-cta",
    });
    this.generateBtn.addEventListener("click", () => void this.generate());

    this.createBtn = footer.createEl("button", {
      text: tRaw("ai.summaryCreate"),
      cls: "mod-cta",
    });
    this.createBtn.disabled = true;
    this.createBtn.addEventListener("click", () => void this.createNote());

    const cancelBtn = footer.createEl("button", {
      text: tRaw("ai.summaryCancel"),
    });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.abort?.abort();
    this.abort = null;
    this.titleEl = null;
    this.textareaEl = null;
    this.emptyEl = null;
    this.previewEl = null;
    this.typingHostEl = null;
    this.modeBtn = null;
    this.statusEl = null;
    this.progressEl = null;
    this.progressFillEl = null;
    this.generateBtn = null;
    this.createBtn = null;
  }

  private toggleViewMode(): void {
    // Locked until generation produces (or user types) a body.
    if (!this.summaryText.trim() || this.isGenerating) return;
    this.viewMode = this.viewMode === "preview" ? "edit" : "preview";
    // Entering edit unlocks the textarea (starts read-only until first generation)
    if (this.viewMode === "edit" && this.textareaEl) {
      this.textareaEl.readOnly = false;
    }
    this.applyViewMode();
  }

  private applyViewMode(): void {
    const preview = this.viewMode === "preview";
    this.textareaEl?.toggleClass("ai-hidden", preview);
    this.previewEl?.toggleClass("ai-hidden", !preview);
    // Preview is always locked; edit mode is unlocked explicitly
    if (this.textareaEl) this.textareaEl.readOnly = preview || this.isGenerating;
    // Empty stub only when there is no summary yet
    this.emptyEl?.toggleClass("ai-hidden", !!this.summaryText.trim() || this.isGenerating);
    if (this.modeBtn) {
      this.modeBtn.textContent = preview
        ? tRaw("ai.summaryEdit")
        : tRaw("ai.summaryPreview");
    }
    if (preview && this.previewEl) {
      renderMarkdown(this.previewEl, this.summaryText);
    }
    this.syncModeBtn();
  }

  /** Preview/edit toggle unlocks only when there is a summary body and generation is idle. */
  private syncModeBtn(): void {
    if (!this.modeBtn) return;
    const locked = !this.summaryText.trim() || this.isGenerating;
    this.modeBtn.disabled = locked;
    this.modeBtn.setAttribute("aria-disabled", locked ? "true" : "false");
    this.modeBtn.classList.toggle("is-locked", locked);
  }

  private syncCreateBtn(): void {
    if (!this.createBtn) return;
    this.createBtn.disabled =
      !this.summaryText.trim() || !this.noteTitle.trim() || this.isGenerating;
    this.syncModeBtn();
  }

  private setStatus(text: string, isError = false, busy = false): void {
    if (!this.statusEl) return;
    this.statusEl.classList.toggle("error", isError);
    this.statusEl.classList.toggle("busy", busy);
    const spinner = this.statusEl.querySelector(".ai-summary-spinner");
    this.statusEl.textContent = "";
    if (spinner) this.statusEl.appendChild(spinner);
    this.statusEl.appendChild(document.createTextNode(text));
  }

  private setProgress(ratio: number | null): void {
    if (!this.progressFillEl || !this.progressEl) return;
    if (ratio == null) {
      this.progressEl.classList.add("indeterminate", "active");
      // Clear dynamic width so the .indeterminate class controls the bar
      this.progressFillEl.setCssStyles({ width: "" });
      return;
    }
    this.progressEl.classList.remove("indeterminate");
    this.progressEl.classList.add("active");
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    this.progressFillEl.setCssStyles({ width: `${pct}%` });
  }

  private clearProgress(): void {
    if (!this.progressFillEl || !this.progressEl) return;
    this.progressEl.classList.remove("active", "indeterminate");
    this.progressFillEl.setCssStyles({ width: "" });
  }

  private async readSources(): Promise<string> {
    const parts: string[] = [];
    let total = 0;
    const fileList = this.files.map((f, i) => `${i + 1}. ${f.path}`).join("\n");
    parts.push(`# CORPUS (summarize as one set)\n\nSources:\n${fileList}\n\n---`);
    for (const file of this.files) {
      const content = await this.app.vault.cachedRead(file);
      const slice = content.slice(0, MAX_CHARS_PER_NOTE);
      // Fence instead of "### path" headings — less likely to split summary per file
      const block = `\n\`\`\`note:${file.path}\n${slice}\n\`\`\`\n`;
      if (total + block.length > MAX_TOTAL_CHARS) {
        parts.push(block.slice(0, Math.max(0, MAX_TOTAL_CHARS - total - 200)));
        break;
      }
      parts.push(block);
      total += block.length;
    }
    return parts.join("\n");
  }

  private syncCustomStyle(): void {
    this.customStyleWrap?.classList.toggle("mcp-hidden", this.style !== "custom");
  }

  private async generate(): Promise<void> {
    if (this.isGenerating || this.files.length === 0) return;
    const opts = get(settings) as {
      ollamaEnabled?: boolean;
      ollamaUrl?: string;
      ollamaModel?: string;
      aiSummaryPrompt?: string;
    };
    if (!opts.ollamaEnabled) {
      new Notice(tRaw("ai.summaryNeedOllama"));
      return;
    }

    this.isGenerating = true;
    this.syncCreateBtn();
    if (this.generateBtn) this.generateBtn.disabled = true;
    this.abort = new AbortController();
    this.contentEl.addClass("scanning");
    this.viewMode = "edit";
    if (this.textareaEl) this.textareaEl.readOnly = true;
    this.applyViewMode();

    try {
      this.setStatus(tRaw("ai.summaryReading"), false, true);
      this.setProgress(null);

      const notes = await this.readSources();
      this.setStatus("", false, true);
      this.setProgress(0);

      const system = buildSummarySystem({
        style: this.style,
        extraPrompt: opts.aiSummaryPrompt,
        customStyle: this.customStyle,
      });
      const expectedChars = 1200;
      let chars = 0;

      // Animation only while generating — text appears when the run finishes
      this.textareaEl?.addClass("ai-hidden");
      this.previewEl?.addClass("ai-hidden");
      this.emptyEl?.addClass("ai-hidden");
      this.typingHostEl?.removeClass("ai-hidden");
      if (this.typingHostEl) {
        // Spinner centered in the field; model label lives ABOVE the field
        mountTypingBlock(this.typingHostEl, resolveModel("reason", opts), this.modelCaptionEl);
      }

      const result = await streamOllamaChat(
        opts.ollamaUrl || "http://localhost:11434",
        resolveModel("reason", opts),
        [
          { role: "system", content: system },
          {
            role: "user",
            content:
              tRaw("ai.summaryUserPrompt", {
                count: String(this.files.length),
                label: this.sourcesLabel,
              }) + "\n\n" + notes,
          },
        ],
        {
          signal: this.abort.signal,
          temperature: 0.3,
          onDelta: (full) => {
            chars = full.length;
            this.setProgress(Math.min(0.92, chars / expectedChars));
          },
        },
      );

      this.summaryText = result.trim();
      this.typingHostEl?.addClass("ai-hidden");
      if (this.textareaEl) {
        this.textareaEl.removeClass("ai-hidden");
        this.textareaEl.readOnly = false;
        this.textareaEl.value = this.summaryText;
        this.textareaEl.scrollTop = this.textareaEl.scrollHeight;
      }
      this.setProgress(1);

      const heading = this.summaryText.match(/^#\s+(.+)$/m)?.[1]?.trim();
      if (heading && this.titleEl && !this.noteTitleEdited) {
        this.noteTitle = heading.slice(0, 80);
        this.titleEl.value = this.noteTitle;
      }

      // Show readable preview after generation; user can switch to edit
      this.viewMode = "preview";
      this.applyViewMode();

      this.setStatus(tRaw("ai.summaryReady"));
      window.setTimeout(() => this.clearProgress(), 400);
      this.syncCreateBtn();
    } catch (e) {
      const msg = errorMessage(e);
      this.clearProgress();
      this.typingHostEl?.addClass("ai-hidden");
      this.textareaEl?.removeClass("ai-hidden");
      if (msg.includes("aborted") || this.abort?.signal.aborted) {
        this.setStatus(tRaw("ai.summaryCancelled"));
      } else {
        this.setStatus(tRaw("ai.summaryError", { error: msg }), true);
      }
    } finally {
      this.isGenerating = false;
      this.contentEl.removeClass("scanning");
      this.typingHostEl?.addClass("ai-hidden");
      if (this.generateBtn) this.generateBtn.disabled = false;
      // Allow editing the result (or typing a custom summary) once generation ends
      if (this.textareaEl) this.textareaEl.readOnly = false;
      this.syncCreateBtn();
      this.abort = null;
    }
  }

  private async createNote(): Promise<void> {
    const body = this.summaryText.trim();
    if (!body) return;

    const custom = (this.noteTitle || "").replace(/[\\/:*?"<>|]/g, "").trim();
    let baseName = custom || `Summary ${this.sourcesLabel}`.replace(/\s+/g, " ").trim();
    if (!baseName) baseName = "Summary";

    const folder = this.folderPath || "/";
    let path = normalizePath(`${folder}/${baseName}.md`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${baseName} ${n}.md`);
      n += 1;
    }

    const sourceList = this.files
      .map((f) => `- [[${f.path.replace(/\.md$/, "")}]]`)
      .join("\n");

    const content = `${body}\n\n---\n\n${tRaw("ai.summarySourcesHeader")}\n${sourceList}\n`;

    try {
      const file = await this.app.vault.create(path, content);
      new Notice(tRaw("ai.summaryCreated", { path: file.path }));
      await this.app.workspace.getLeaf("tab").openFile(file, {
        state: { mode: "source" },
      });
      this.close();
    } catch (e) {
      const msg = errorMessage(e);
      this.setStatus(tRaw("ai.summaryCreateError", { error: msg }), true);
    }
  }
}
