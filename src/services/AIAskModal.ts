import type { App, TAbstractFile, TFile } from "obsidian";
import {
  MarkdownView,
  Notice,
  TFile as TFileClass,
  TFolder as TFolderClass,
  normalizePath,
} from "obsidian";
import { get } from "svelte/store";
import { CustomModal } from "../ui/CustomModal";
import { tRaw } from "../i18n";
import { settings } from "../ui/stores";
import { streamOllamaChat, resolveModel } from "./OllamaService";
import { errorMessage } from "../utils/sanitize";
import { renderInline, renderMarkdown } from "../ui/markdown";

const MAX_CONTEXT_CHARS = 14000;
const MAX_FILES = 12;
const MAX_MSG_CHARS = 6000;

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

/** Collect markdown files from a folder (capped). */
export function collectAskFiles(root: TFolderClass, depth = 0, maxDepth = 2): TFile[] {
  const out: TFile[] = [];
  if (depth > maxDepth) return out;
  for (const child of root.children) {
    if (child instanceof TFileClass && child.extension === "md") {
      out.push(child);
    } else if (child instanceof TFolderClass) {
      out.push(...collectAskFiles(child, depth + 1, maxDepth));
    }
    if (out.length >= MAX_FILES) break;
  }
  return out.slice(0, MAX_FILES);
}

/**
 * Live chat for brainstorming in the context of the current note / note group.
 * No mode switches — context is always the notes you opened it from (or the active note).
 */
export class AIAskModal extends CustomModal {
  private files: TFile[];
  private contextLabel: string;
  private contextCache: string | null = null;
  private messages: ChatMsg[] = [];
  private isRunning = false;
  private abort: AbortController | null = null;

  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private streamBodyEl: HTMLElement | null = null;

  constructor(app: App, files?: TFile[], label?: string) {
    super(app);
    this.files = files?.length ? files.slice(0, MAX_FILES) : resolveActiveFiles(app);
    this.contextLabel = label || labelForFiles(this.files);
  }

  onOpen(): void {
    this.contentEl.addClass("ai-ask-modal");
    this.containerEl?.addClass("ai-ask-shell");

    // Compact header: title + context chips
    const head = this.contentEl.createDiv({ cls: "ai-ask-head" });
    const icon = head.createDiv({ cls: "ai-sch-head-icon" });
    icon.createSpan({ text: "💬" });
    const headText = head.createDiv({ cls: "ai-sch-head-text" });
    headText.createEl("h2", { text: tRaw("ai.askQa.title"), cls: "ai-sch-title" });
    const ctx = headText.createDiv({ cls: "ai-ask-context" });
    ctx.createSpan({
      text: this.files.length
        ? tRaw("ai.askQa.ctxLabel", {
            count: String(this.files.length),
            label: this.contextLabel,
          })
        : tRaw("ai.askQa.ctxNone"),
      cls: "ai-ask-context-chip",
    });

    // Messages
    this.messagesEl = this.contentEl.createDiv({ cls: "ai-ask-messages" });
    this.renderEmptyChat();

    // Status (only while generating)
    this.statusEl = this.contentEl.createDiv({ cls: "ai-sch-status ai-ask-status" });
    this.statusEl.createSpan({ cls: "ai-sch-spinner", attr: { "aria-hidden": "true" } });
    this.statusEl.createSpan({ cls: "ai-sch-status-text", text: "" });

    // Chat actions: copy / add to note / save history
    const bar = this.contentEl.createDiv({ cls: "ai-ask-bar" });
    const copyLastBtn = bar.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-ghost ai-ask-bar-btn",
      text: tRaw("ai.askQa.copyLast"),
      attr: { type: "button" },
    });
    copyLastBtn.addEventListener("click", () => void this.copyLastAnswer());

    const copyChatBtn = bar.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-ghost ai-ask-bar-btn",
      text: tRaw("ai.askQa.copyChat"),
      attr: { type: "button" },
    });
    copyChatBtn.addEventListener("click", () => void this.copyChat());

    const toNoteBtn = bar.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-ghost ai-ask-bar-btn",
      text: tRaw("ai.askQa.toNote"),
      attr: { type: "button" },
    });
    toNoteBtn.addEventListener("click", () => void this.appendLastToNote());

    const saveChatBtn = bar.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-accent ai-ask-bar-btn",
      text: tRaw("ai.askQa.saveChat"),
      attr: { type: "button" },
    });
    saveChatBtn.addEventListener("click", () => void this.saveChatNote());

    // Composer
    const composer = this.contentEl.createDiv({ cls: "ai-ask-composer" });
    this.inputEl = composer.createEl("textarea", {
      cls: "ai-ask-input",
      attr: {
        rows: "2",
        placeholder: tRaw("ai.askQa.placeholder"),
        spellcheck: "false",
      },
    });
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });

    this.stopBtn = composer.createEl("button", {
      cls: "ai-sch-btn ai-ask-send",
      text: tRaw("schedule.aiStop"),
      attr: { type: "button", disabled: "true" },
    });
    this.stopBtn.addEventListener("click", () => this.abort?.abort());

    this.sendBtn = composer.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-primary ai-ask-send",
      text: tRaw("ai.askQa.send"),
      attr: { type: "button" },
    });
    this.sendBtn.addEventListener("click", () => void this.send());

    window.setTimeout(() => this.inputEl?.focus(), 50);
  }

  onClose(): void {
    this.abort?.abort();
    this.abort = null;
    this.isRunning = false;
    this.contentEl.removeClass("scanning", "generating");
  }

  private setStatus(text: string, kind: "idle" | "busy" | "error" = "idle"): void {
    if (!this.statusEl) return;
    this.statusEl.classList.remove("busy", "error", "ok");
    if (kind === "busy") this.statusEl.classList.add("busy");
    if (kind === "error") this.statusEl.classList.add("error");
    const label = this.statusEl.querySelector(".ai-sch-status-text");
    if (label) label.textContent = text;
  }

  private renderEmptyChat(): void {
    const el = this.messagesEl;
    if (!el) return;
    el.empty();
    const empty = el.createDiv({ cls: "ai-sch-empty ai-ask-empty" });
    empty.createDiv({ cls: "ai-sch-empty-icon", text: "💬" });
    empty.createDiv({ cls: "ai-sch-empty-title", text: tRaw("ai.askQa.emptyTitle") });
    empty.createDiv({ cls: "ai-sch-empty-hint", text: tRaw("ai.askQa.emptyHint") });
  }

  private renderMessages(): void {
    const el = this.messagesEl;
    if (!el) return;
    this.streamBodyEl = null;
    if (this.messages.length === 0) {
      this.renderEmptyChat();
      return;
    }
    el.empty();
    for (const m of this.messages) {
      this.appendBubble(el, m.role, m.text);
    }
    el.scrollTop = el.scrollHeight;
  }

  /** Start an assistant streaming bubble (progressive markdown). */
  private beginStream(): void {
    const el = this.messagesEl;
    if (!el) return;
    const row = el.createDiv({ cls: "ai-ask-msg ai-ask-msg--assistant" });
    const avatar = row.createDiv({ cls: "ai-ask-msg-avatar" });
    avatar.createSpan({ text: "✨" });
    const col = row.createDiv({ cls: "ai-ask-msg-col" });
    col.createDiv({ cls: "ai-ask-msg-who", text: tRaw("ai.askQa.ai") });
    this.streamBodyEl = col.createDiv({ cls: "ai-ask-msg-body is-streaming" });
    this.streamBodyEl.createDiv({
      cls: "ai-ask-msg-typing",
      text: "…",
      attr: { "aria-hidden": "true" },
    });
    el.scrollTop = el.scrollHeight;
  }

  private paintStream(full: string): void {
    const body = this.streamBodyEl;
    if (!body) return;
    if (!full.trim()) {
      if (!body.querySelector(".ai-ask-msg-typing")) {
        body.empty();
        body.createDiv({
          cls: "ai-ask-msg-typing",
          text: "…",
          attr: { "aria-hidden": "true" },
        });
      }
      return;
    }
    renderMarkdown(body, full);
    const el = this.messagesEl;
    if (el) el.scrollTop = el.scrollHeight;
  }

  private appendBubble(
    host: HTMLElement,
    role: "user" | "assistant",
    text: string,
    streaming = false,
  ): void {
    const row = host.createDiv({ cls: `ai-ask-msg ai-ask-msg--${role}` });
    const avatar = row.createDiv({ cls: "ai-ask-msg-avatar" });
    avatar.createSpan({ text: role === "user" ? "👤" : "✨" });

    const col = row.createDiv({ cls: "ai-ask-msg-col" });
    col.createDiv({
      cls: "ai-ask-msg-who",
      text: role === "user" ? tRaw("ai.askQa.you") : tRaw("ai.askQa.ai"),
    });
    const body = col.createDiv({
      cls: `ai-ask-msg-body${streaming ? " is-streaming" : ""}`,
    });
    if (!text.trim()) {
      body.createDiv({ cls: "ai-ask-msg-typing", text: "…", attr: { "aria-hidden": "true" } });
      return;
    }

    if (role === "assistant") {
      // Full markdown (headings, lists, code, tables, quotes)
      renderMarkdown(body, text);
      return;
    }

    // User: light inline markdown, keep it compact
    const lines = text.split(/\r?\n/);
    let listEl: HTMLElement | null = null;
    for (const line of lines) {
      if (!line.trim()) {
        listEl = null;
        body.createDiv({ cls: "ai-sch-out-spacer" });
        continue;
      }
      const listM = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line);
      if (listM) {
        const ordered = listM[1] !== "-" && listM[1] !== "*" && listM[1] !== "+";
        if (!listEl) {
          listEl = ordered
            ? body.createEl("ol", { cls: "ai-sch-out-list ai-sch-out-list--ol" })
            : body.createEl("ul", { cls: "ai-sch-out-list" });
        }
        const li = listEl.createEl("li", { cls: "ai-sch-out-li" });
        renderInline(li, listM[2]);
        continue;
      }
      listEl = null;
      const p = body.createEl("p", { cls: "ai-sch-out-p" });
      renderInline(p, line);
    }
  }

  /** Note context is built once and reused across the chat. */
  private async loadContext(): Promise<string> {
    if (this.contextCache !== null) return this.contextCache;
    if (this.files.length === 0) {
      this.contextCache = "";
      return "";
    }
    const parts: string[] = [];
    let total = 0;
    for (const file of this.files) {
      try {
        const content = await this.app.vault.cachedRead(file);
        const block = `### ${file.path}\n${content.slice(0, 4000)}\n`;
        if (total + block.length > MAX_CONTEXT_CHARS) break;
        parts.push(block);
        total += block.length;
      } catch {
        /* skip unreadable */
      }
    }
    this.contextCache = parts.join("\n");
    return this.contextCache;
  }

  private lastAssistantText(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "assistant") return this.messages[i].text;
    }
    return "";
  }

  private chatAsMarkdown(): string {
    const lines: string[] = [`# ${tRaw("ai.askQa.chatNoteTitle")}`, ""];
    if (this.contextLabel) {
      lines.push(`> ${tRaw("ai.askQa.ctxLabel", { count: String(this.files.length), label: this.contextLabel })}`, "");
    }
    for (const m of this.messages) {
      const who = m.role === "user" ? tRaw("ai.askQa.you") : tRaw("ai.askQa.ai");
      lines.push(`## ${who}`, "", m.text, "");
    }
    return lines.join("\n").trim() + "\n";
  }

  private async copyLastAnswer(): Promise<void> {
    const text = this.lastAssistantText();
    if (!text.trim()) {
      new Notice(tRaw("ai.askQa.nothingToCopy"));
      return;
    }
    await navigator.clipboard.writeText(text);
    new Notice(tRaw("ai.askQa.copied"));
  }

  private async copyChat(): Promise<void> {
    if (this.messages.length === 0) {
      new Notice(tRaw("ai.askQa.nothingToCopy"));
      return;
    }
    await navigator.clipboard.writeText(this.chatAsMarkdown());
    new Notice(tRaw("ai.askQa.copied"));
  }

  /** Append the last AI answer to the active note (or the first context note). */
  private async appendLastToNote(): Promise<void> {
    const text = this.lastAssistantText();
    if (!text.trim()) {
      new Notice(tRaw("ai.askQa.nothingToCopy"));
      return;
    }
    const target = await this.resolveTargetNote();
    if (!target) return;
    try {
      const prev = await this.app.vault.read(target);
      const stamp = `\n\n---\n\n${tRaw("ai.askQa.ai")}\n\n${text}\n`;
      await this.app.vault.modify(target, prev + stamp);
      new Notice(target.path);
    } catch (e) {
      new Notice(errorMessage(e));
    }
  }

  /** Save the whole chat transcript as a new note. */
  private async saveChatNote(): Promise<void> {
    if (this.messages.length === 0) {
      new Notice(tRaw("ai.askQa.nothingToCopy"));
      return;
    }
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const timeStr = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const safe = (this.contextLabel || "chat").replace(/[\\/:*?"<>|]/g, "").slice(0, 30).trim();
    const title = `AI Chat ${dateStr} ${timeStr} ${safe}`.replace(/\s+/g, " ").trim();
    const path = normalizePath(`${title}.md`);
    try {
      const existing = this.app.vault.getAbstractFileByPath(path);
      const body = this.chatAsMarkdown();
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

  /** Prefer the active markdown note, else the first context file. */
  private async resolveTargetNote(): Promise<TFile | null> {
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    const active = md?.file;
    if (active instanceof TFileClass && active.extension === "md") return active;
    const first = this.files.find((f) => f.extension === "md");
    if (first) return first;
    // Last resort: create a note in the vault root
    const name = `AI Notes ${fmtStamp()}.md`;
    const path = normalizePath(name);
    try {
      const created = await this.app.vault.create(path, `# ${name}\n`);
      return created;
    } catch {
      return null;
    }
  }

  private async send(): Promise<void> {
    if (this.isRunning) return;
    const text = (this.inputEl?.value || "").trim();
    if (!text) return;

    const opts = get(settings) as {
      ollamaEnabled?: boolean;
      ollamaUrl?: string;
      ollamaModel?: string;
    };
    if (!opts.ollamaEnabled) {
      new Notice(tRaw("ai.summaryNeedOllama"));
      return;
    }

    this.isRunning = true;
    this.messages.push({ role: "user", text: text.slice(0, MAX_MSG_CHARS) });
    if (this.inputEl) this.inputEl.value = "";
    this.abort = new AbortController();
    if (this.sendBtn) this.sendBtn.disabled = true;
    if (this.stopBtn) this.stopBtn.disabled = false;
    this.contentEl.addClass("scanning", "generating");
    this.setStatus(tRaw("ai.askQa.working"), "busy");
    this.renderMessages();
    this.beginStream();

    let lastPaint = 0;
    try {
      const context = await this.loadContext();
      const history = this.messages
        .slice(0, -1)
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
        .join("\n\n");

      const userContent = context
        ? `Note context:\n${context}\n\n${history ? `Conversation so far:\n${history}\n\n` : ""}User message:\n${text}`
        : `${history ? `Conversation so far:\n${history}\n\n` : ""}User message:\n${text}`;

      const result = await streamOllamaChat(
        opts.ollamaUrl || "http://localhost:11434",
        resolveModel("reason", opts),
        [
          { role: "system", content: tRaw("ai.askQa.system") },
          { role: "user", content: userContent },
        ],
        {
          signal: this.abort.signal,
          temperature: 0.4,
          onDelta: (full) => {
            const now = Date.now();
            if (now - lastPaint < 40) return;
            lastPaint = now;
            this.paintStream(full);
            this.setStatus(`${tRaw("ai.askQa.working")} · ${full.length}`, "busy");
          },
        },
      );

      this.messages.push({ role: "assistant", text: result.trim() });
      this.streamBodyEl = null;
      this.renderMessages();
      this.setStatus("");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        this.setStatus("");
        this.streamBodyEl = null;
        this.renderMessages();
      } else {
        const msg = errorMessage(e);
        this.setStatus(tRaw("ai.error", { error: msg }), "error");
        new Notice(tRaw("ai.error", { error: msg }));
        this.streamBodyEl = null;
        this.renderMessages();
      }
    } finally {
      this.isRunning = false;
      this.abort = null;
      this.contentEl.removeClass("scanning", "generating");
      if (this.sendBtn) this.sendBtn.disabled = false;
      if (this.stopBtn) this.stopBtn.disabled = true;
      this.inputEl?.focus();
    }
  }
}

function labelForFiles(files: TFile[]): string {
  if (files.length === 0) return "";
  if (files.length === 1) return files[0].basename;
  return files
    .slice(0, 3)
    .map((f) => f.basename)
    .join(", ");
}

function fmtStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function resolveActiveFiles(app: App): TFile[] {
  const md = app.workspace.getActiveViewOfType(MarkdownView);
  const file = md?.file;
  if (file instanceof TFileClass) return [file];
  return [];
}

/** Open chat in the context of given files (or the active note). */
export function openAiAsk(app: App, files?: TFile[], label?: string): void {
  new AIAskModal(app, files, label).open();
}

/** Open chat for a file / folder / multi-selection from the context menu. */
export function openAiAskFor(app: App, target: TAbstractFile): void {
  if (target instanceof TFolderClass) {
    const files = collectAskFiles(target);
    openAiAsk(app, files, target.name);
    return;
  }
  if (target instanceof TFileClass && target.extension === "md") {
    openAiAsk(app, [target], target.basename);
    return;
  }
  openAiAsk(app);
}
