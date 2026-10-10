import type { App, TFile, TFolder } from "obsidian";
import { Notice, TFile as TFileClass, TFolder as TFolderClass, normalizePath } from "obsidian";
import { CustomModal } from "../ui/CustomModal";
import { tRaw } from "../i18n";
import { settings } from "../ui/stores";
import { get } from "svelte/store";
import { streamOllamaChat, resolveModel } from "./OllamaService";
import { errorMessage } from "../utils/sanitize";
import { renderMarkdown } from "../ui/markdown";

const MAX_NOTES = 40;
const MAX_CHARS_PER_NOTE = 6000;
const MAX_TOTAL_CHARS = 48000;

const SUMMARY_BASE = `You are a careful note summarizer. Write ONE unified markdown summary of the ENTIRE set of notes as a single document.
Do NOT create a separate section per source file.
Do NOT list notes one by one.
Synthesize common themes, decisions, facts, and takeaways across all sources.
Return ONLY markdown (no code fences around the whole answer).
Write body text in the SAME language as the source notes.
Use the exact section headings provided below (do not translate or bilingualize them).
Preserve important names, dates, numbers.`;

type SummaryStyle = "brief" | "detailed" | "bullets" | "executive";

function buildSummarySystem(style: SummaryStyle, extra?: string): string {
  const h = {
    overview: tRaw("ai.summaryHeadings.overview"),
    keyIdeas: tRaw("ai.summaryHeadings.keyIdeas"),
    takeaways: tRaw("ai.summaryHeadings.takeaways"),
    tldr: tRaw("ai.summaryHeadings.tldr"),
    facts: tRaw("ai.summaryHeadings.facts"),
    risks: tRaw("ai.summaryHeadings.risks"),
  };
  const blocks: Record<SummaryStyle, string> = {
    brief: `Style: BRIEF.
# <short shared title>
2–4 sentences covering the whole corpus in one flow.`,
    detailed: `Style: DETAILED (still one shared summary).
# <short shared title>
## ${h.overview}
2–4 sentences about the whole set.
## ${h.keyIdeas}
- bullets synthesizing topics across notes
## ${h.takeaways}
- bullets
Do not split sections by source note.`,
    bullets: `Style: BULLETS ONLY (one shared list).
# <short shared title>
- short factual bullets merging themes from all notes
- no per-file blocks, no long prose`,
    executive: `Style: EXECUTIVE SUMMARY (one shared brief).
# <short shared title>
## ${h.tldr}
1–2 sentences on the whole set.
## ${h.facts}
- decisions, numbers, dates, owners from any notes
## ${h.risks}
- open questions, blockers (if any)
Never separate by note.`,
  };
  let sys = `${SUMMARY_BASE}\n\n${blocks[style] || blocks.detailed}`;
  const extraTrim = (extra || "").trim();
  if (extraTrim) {
    sys += `\n\nExtra user instructions (follow them):\n${extraTrim}`;
  }
  return sys;
}

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

  private titleEl: HTMLInputElement | null = null;
  private textareaEl: HTMLTextAreaElement | null = null;
  private previewEl: HTMLElement | null = null;
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
    const scanShell = this.contentEl.createDiv({ cls: "ai-summary-scan" });
    this.textareaEl = scanShell.createEl("textarea", {
      cls: "ai-summary-textarea",
      attr: {
        rows: "14",
        placeholder: tRaw("ai.summaryPlaceholder"),
        spellcheck: "false",
      },
    });
    this.textareaEl.value = this.summaryText;
    this.textareaEl.addEventListener("input", () => {
      this.summaryText = this.textareaEl?.value ?? "";
      this.syncCreateBtn();
    });
    this.previewEl = scanShell.createDiv({ cls: "ai-summary-preview ai-hidden" });

    const footer = this.contentEl.createDiv({ cls: "ai-summary-footer" });
    this.modeBtn = footer.createEl("button", {
      text: tRaw("ai.summaryPreview"),
      cls: "ai-summary-mode-btn",
    });
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
    this.previewEl = null;
    this.modeBtn = null;
    this.statusEl = null;
    this.progressEl = null;
    this.progressFillEl = null;
    this.generateBtn = null;
    this.createBtn = null;
  }

  private toggleViewMode(): void {
    this.viewMode = this.viewMode === "preview" ? "edit" : "preview";
    this.applyViewMode();
  }

  private applyViewMode(): void {
    const preview = this.viewMode === "preview";
    this.textareaEl?.toggleClass("ai-hidden", preview);
    this.previewEl?.toggleClass("ai-hidden", !preview);
    if (this.modeBtn) {
      this.modeBtn.textContent = preview
        ? tRaw("ai.summaryEdit")
        : tRaw("ai.summaryPreview");
    }
    if (preview && this.previewEl) {
      renderMarkdown(this.previewEl, this.summaryText);
    }
  }

  private syncCreateBtn(): void {
    if (!this.createBtn) return;
    this.createBtn.disabled =
      !this.summaryText.trim() || !this.noteTitle.trim() || this.isGenerating;
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

  private async generate(): Promise<void> {
    if (this.isGenerating || this.files.length === 0) return;
    const opts = get(settings) as {
      ollamaEnabled?: boolean;
      ollamaUrl?: string;
      ollamaModel?: string;
      aiSummaryStyle?: SummaryStyle;
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
    this.applyViewMode();

    try {
      this.setStatus(tRaw("ai.summaryReading"), false, true);
      this.setProgress(null);

      const notes = await this.readSources();
      this.setStatus(tRaw("ai.summaryStreaming"), false, true);
      this.setProgress(0);

      const style: SummaryStyle =
        opts.aiSummaryStyle === "brief" ||
        opts.aiSummaryStyle === "bullets" ||
        opts.aiSummaryStyle === "executive"
          ? opts.aiSummaryStyle
          : "detailed";

      const system = buildSummarySystem(style, opts.aiSummaryPrompt);
      const expectedChars = 1200;
      let lastPaint = 0;
      let chars = 0;

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
          onProgress: () => {
            this.setStatus(tRaw("ai.summaryStreaming"), false, true);
          },
          onDelta: (full) => {
            chars = full.length;
            const now = Date.now();
            // Paint often for a "typing" feel, but not every token
            if (now - lastPaint < 40) return;
            lastPaint = now;
            this.summaryText = full;
            if (this.textareaEl) {
              this.textareaEl.value = full;
              this.textareaEl.scrollTop = this.textareaEl.scrollHeight;
            }
            this.setProgress(Math.min(0.92, chars / expectedChars));
            this.setStatus(
              `${tRaw("ai.summaryStreaming")} · ${chars}`,
              false,
              true,
            );
          },
        },
      );

      this.summaryText = result.trim();
      if (this.textareaEl) {
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
      if (msg.includes("aborted") || this.abort?.signal.aborted) {
        this.setStatus(tRaw("ai.summaryCancelled"));
      } else {
        this.setStatus(tRaw("ai.summaryError", { error: msg }), true);
      }
    } finally {
      this.isGenerating = false;
      this.contentEl.removeClass("scanning");
      if (this.generateBtn) this.generateBtn.disabled = false;
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
