import type { App, TFile } from "obsidian";
import {
  MarkdownView,
  Menu,
  Notice,
  TFile as TFileClass,
  TFolder as TFolderClass,
  normalizePath,
} from "obsidian";
import { get } from "svelte/store";
import { tRaw } from "../i18n";
import { settings } from "../ui/stores";
import { streamOllamaChat, resolveModel } from "./OllamaService";
import {
  analyzeModelInternetSupport,
  buildSearchQuery,
  formatSearchContext,
  searchWeb,
} from "./webSearch";
import { errorMessage } from "../utils/sanitize";
import { renderInline, renderMarkdown } from "../ui/markdown";
import { showTypingDots, showModelCaption } from "../ui/typingDots";

const MAX_CONTEXT_CHARS = 14000;
const MAX_FILES = 12;
const MAX_MSG_CHARS = 6000;
const MAX_SELECTION_CHARS = 4000;

export type ChatStyle = "open" | "brainstorm" | "advisor";

/** Base system prompts per chat style. User tone / about / name are appended on top. */
const CHAT_STYLE_SYSTEM: Record<ChatStyle, string> = {
  open: "You are a helpful AI assistant inside an Obsidian plugin. Stay grounded in the provided note context when it is present. Reply in the user's language. Use light markdown (short paragraphs, bullets, **bold**). Be concise and practical — this is a live conversation, not a report.",
  brainstorm:
    "You are a collaborative brainstorming partner inside an Obsidian plugin. Stay grounded in the provided note context when it is present. Think out loud with the user: ask clarifying questions when useful, offer alternatives, challenge assumptions. Reply in the user's language. Use light markdown (short paragraphs, bullets, **bold**). Be concise but substantive — this is a live conversation, not a report.",
  advisor:
    "You are a decision advisor inside an Obsidian plugin. The user often asks whether to take an action. Stay grounded in the provided note context when it is present. Lead with a clear recommendation (yes / no / depends), then the main pros, cons and risks. Ask at most one clarifying question, and only when the answer truly depends on it. Reply in the user's language. Use light markdown (short paragraphs, bullets, **bold**). Be concise and decisive — this is a live conversation, not a report.",
};

function resolveChatStyle(raw: string | undefined): ChatStyle {
  return raw === "brainstorm" || raw === "advisor" ? raw : "open";
}

const STYLE_LABEL_KEY: Record<ChatStyle, string> = {
  open: "ai.askQa.styleOpen",
  brainstorm: "ai.askQa.styleBrainstorm",
  advisor: "ai.askQa.styleAdvisor",
};

const STYLE_HINT_KEY: Record<ChatStyle, string> = {
  open: "ai.askQa.styleOpenHint",
  brainstorm: "ai.askQa.styleBrainstormHint",
  advisor: "ai.askQa.styleAdvisorHint",
};

/** Persist chat style via the plugin when available; always update the store. */
function persistChatStyle(app: App, style: ChatStyle): void {
  settings.update((s) => ({ ...s, aiChatStyle: style }));
  type PluginHost = {
    plugins?: {
      getPlugin?: (id: string) => {
        writeOptions?: (changes: Record<string, unknown>) => Promise<void>;
      } | null;
    };
  };
  const plugin = (app as unknown as PluginHost).plugins?.getPlugin?.("worklife-calendar");
  void plugin?.writeOptions?.({ aiChatStyle: style });
}

/** Extra context attached to the conversation (editor selection etc.). */
export interface AskSelection {
  text: string;
  label?: string;
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

export { MAX_FILES };

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

/**
 * Live chat UI for brainstorming in the context of notes.
 * Hosted in a detached workspace window (not a modal).
 */
export class AiAskChat {
  private app: App;
  private root: HTMLElement;
  private files: TFile[];
  private contextLabel: string;
  private contextCache: string | null = null;
  private messages: ChatMsg[] = [];
  private isRunning = false;
  private abort: AbortController | null = null;

  /** Display names from settings — user name replaces «Вы», aiName replaces «ИИ». */
  private userLabel: string;
  private aiLabel: string;

  /** Editor selection attached as a removable context chip. */
  private selection: AskSelection | null = null;

  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private streamBodyEl: HTMLElement | null = null;
  private contextChipEl: HTMLElement | null = null;
  private modelCaptionEl: HTMLElement | null = null;
  private selectionChipEl: HTMLElement | null = null;
  private chipsRowEl: HTMLElement | null = null;
  private selectionToolbarEl: HTMLElement | null = null;
  private styleRowEl: HTMLElement | null = null;
  private webSearchRowEl: HTMLElement | null = null;
  private chatStyle: ChatStyle;
  private webSearchOn: boolean;
  private lastWebSources: Array<{ title: string; url: string; snippet: string }> = [];

  constructor(app: App, root: HTMLElement, files?: TFile[], label?: string) {
    this.app = app;
    this.root = root;
    this.files = files?.length ? files.slice(0, MAX_FILES) : resolveActiveFiles(app);
    this.contextLabel = label || labelForFiles(this.files);
    const opts = get(settings) as {
      userName?: string;
      aiName?: string;
      aiChatStyle?: ChatStyle;
      aiWebSearchEnabled?: boolean;
    };
    this.userLabel = (opts.userName || "").trim() || tRaw("ai.askQa.you");
    this.aiLabel = (opts.aiName || "").trim() || tRaw("ai.askQa.ai");
    this.chatStyle = resolveChatStyle(opts.aiChatStyle);
    this.webSearchOn = opts.aiWebSearchEnabled === true;
  }

  mount(): void {
    this.root.empty();
    this.root.addClass("ai-ask-modal", "ai-ask-window");

    const head = this.root.createDiv({ cls: "ai-ask-head" });
    const icon = head.createDiv({ cls: "ai-sch-head-icon" });
    icon.createSpan({ text: "💬" });
    const headText = head.createDiv({ cls: "ai-sch-head-text" });
    headText.createEl("h2", { text: tRaw("ai.askQa.title"), cls: "ai-sch-title" });
    const ctx = headText.createDiv({ cls: "ai-ask-context" });
    this.contextChipEl = ctx.createSpan({
      text: this.contextChipText(),
      cls: "ai-ask-context-chip",
    });

    // Style switcher on the same row as «Чат с ИИ»
    this.styleRowEl = head.createDiv({ cls: "ai-ask-styles ai-ask-styles--head" });
    this.renderStylePicker();

    this.messagesEl = this.root.createDiv({ cls: "ai-ask-messages" });
    this.renderEmptyChat();
    this.bindSelectionToolbar();
    // Model caption ABOVE the messages field (outside of it) — always visible
    this.modelCaptionEl = this.root.createDiv({ cls: "ai-model-caption-slot" });
    this.messagesEl.before(this.modelCaptionEl);
    this.refreshModelCaption();

    this.statusEl = this.root.createDiv({ cls: "ai-sch-status ai-ask-status" });
    this.statusEl.createSpan({ cls: "ai-sch-spinner", attr: { "aria-hidden": "true" } });
    this.statusEl.createSpan({ cls: "ai-sch-status-text", text: "" });

    const bar = this.root.createDiv({ cls: "ai-ask-bar" });
    // Chat-level actions only — per-message actions live on each bubble
    const copyChatBtn = bar.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-ghost ai-ask-bar-btn",
      text: tRaw("ai.askQa.copyChat"),
      attr: { type: "button" },
    });
    copyChatBtn.addEventListener("click", () => void this.copyChat());

    const saveChatBtn = bar.createEl("button", {
      cls: "ai-sch-btn ai-sch-btn-accent ai-ask-bar-btn",
      text: tRaw("ai.askQa.saveChat"),
      attr: { type: "button" },
    });
    saveChatBtn.addEventListener("click", () => void this.saveChatNote());

    // Web toggle lives next to Copy/Save at the bottom
    this.webSearchRowEl = bar.createDiv({ cls: "ai-ask-websearch ai-ask-websearch--bar" });
    this.renderWebSearchToggle();

    const composer = this.root.createDiv({ cls: "ai-ask-composer" });

    // Context chips row: note context + removable editor selection
    this.chipsRowEl = composer.createDiv({ cls: "ai-ask-chips" });
    this.renderChips();

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

  destroy(): void {
    this.abort?.abort();
    this.abort = null;
    this.isRunning = false;
    this.root.removeClass("scanning", "generating");
    this.selectionToolbarEl?.remove();
    this.selectionToolbarEl = null;
    this.messagesEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.stopBtn = null;
    this.statusEl = null;
    this.streamBodyEl = null;
    this.contextChipEl = null;
    this.styleRowEl = null;
    this.webSearchRowEl = null;
    this.modelCaptionEl = null;
    this.root.empty();
  }

  /** Swap note context (e.g. re-open from another note). Keeps the conversation. */
  setContext(files?: TFile[], label?: string): void {
    this.files = files?.length ? files.slice(0, MAX_FILES) : resolveActiveFiles(this.app);
    this.contextLabel = label || labelForFiles(this.files);
    this.contextCache = null;
    if (this.contextChipEl) {
      this.contextChipEl.setText(this.contextChipText());
    }
    this.renderChips();
  }

  /** Public send with an explicit message (used by editor context menu). */
  sendText(text: string): void {
    if (this.inputEl) this.inputEl.value = text;
    void this.send();
  }

  private contextChipText(): string {
    return this.files.length
      ? tRaw("ai.askQa.ctxLabel", {
          count: String(this.files.length),
          label: this.contextLabel,
        })
      : tRaw("ai.askQa.ctxNone");
  }

  /** Attach / replace the editor selection chip (from the text editor context menu). */
  setSelection(sel: AskSelection | null): void {
    this.selection = sel
      ? { text: sel.text.slice(0, MAX_SELECTION_CHARS), label: sel.label }
      : null;
    this.renderChips();
    if (sel) this.inputEl?.focus();
  }

  /** Prefill the composer (e.g. «Объясни:» after opening from the editor). */
  prefill(text: string): void {
    if (!this.inputEl) return;
    this.inputEl.value = text;
    this.inputEl.focus();
  }

  private renderChips(): void {
    const row = this.chipsRowEl;
    if (!row) return;
    row.empty();

    // Only the selection chip lives here — note context is already in the header
    if (this.selection) {
      const chip = row.createDiv({ cls: "ai-ask-chip ai-ask-chip--sel" });
      chip.createSpan({ text: "✂️", cls: "ai-ask-chip-icon" });
      const preview =
        this.selection.text.length > 60
          ? `${this.selection.text.slice(0, 60)}…`
          : this.selection.text;
      chip.createSpan({
        text: this.selection.label
          ? `${this.selection.label}: ${preview}`
          : preview,
        cls: "ai-ask-chip-text",
      });
      const x = chip.createEl("button", {
        cls: "ai-ask-chip-x",
        text: "×",
        attr: { type: "button", "aria-label": tRaw("ai.askQa.selRemove") },
      });
      x.addEventListener("click", () => this.setSelection(null));
    }

    row.toggleClass("is-empty", row.childElementCount === 0);
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
    empty.createDiv({ cls: "ai-sch-empty-hint", text: tRaw("ai.askQa.stylePickHint") });
  }

  /** Style segmented control with tooltips (compact, lives in the header). */
  private renderStylePicker(): void {
    const row = this.styleRowEl;
    if (!row) return;
    row.empty();

    const tabs = row.createDiv({ cls: "ai-ask-styles-tabs", attr: { role: "tablist" } });
    const styles: ChatStyle[] = ["open", "brainstorm", "advisor"];
    for (const id of styles) {
      const hint = tRaw(STYLE_HINT_KEY[id]);
      const btn = tabs.createEl("button", {
        cls: `ai-ask-style-btn${this.chatStyle === id ? " is-active" : ""}`,
        text: tRaw(STYLE_LABEL_KEY[id]),
        attr: {
          type: "button",
          role: "tab",
          "aria-selected": this.chatStyle === id ? "true" : "false",
          title: hint,
        },
      });
      btn.addEventListener("click", () => {
        if (this.chatStyle === id) return;
        this.chatStyle = id;
        persistChatStyle(this.app, id);
        this.renderStylePicker();
      });
    }
  }

  /** Keep the model name visible even when the model is idle. */
  private refreshModelCaption(): void {
    if (!this.modelCaptionEl) return;
    const opts = get(settings) as {
      ollamaModel?: string;
      ollamaModelMode?: "single" | "dual";
      ollamaModelExtract?: string;
    };
    showModelCaption(this.modelCaptionEl, resolveModel("reason", opts));
  }

  /** Web search toggle (compact, in the bottom bar) + model internet capability. */
  private renderWebSearchToggle(): void {
    const row = this.webSearchRowEl;
    if (!row) return;
    row.empty();

    const opts = get(settings) as { ollamaUrl?: string; ollamaModel?: string };
    const intel = analyzeModelInternetSupport(opts);
    const hint = `${tRaw("ai.askQa.webSearchHint")}\n${intel.reason}`;

    const btn = row.createEl("button", {
      cls: `ai-sch-btn ai-ask-bar-btn ai-ask-websearch-btn${this.webSearchOn ? " is-active" : ""}`,
      text: `🌐 ${tRaw("ai.askQa.webSearch")}${this.webSearchOn ? " ●" : ""}`,
      attr: {
        type: "button",
        title: hint,
        "aria-pressed": this.webSearchOn ? "true" : "false",
      },
    });
    btn.addEventListener("click", () => {
      this.webSearchOn = !this.webSearchOn;
      settings.update((s) => ({ ...s, aiWebSearchEnabled: this.webSearchOn }));
      type PluginHost = {
        plugins?: {
          getPlugin?: (id: string) => {
            writeOptions?: (changes: Record<string, unknown>) => Promise<void>;
          } | null;
        };
      };
      const plugin = (this.app as unknown as PluginHost).plugins?.getPlugin?.("worklife-calendar");
      void plugin?.writeOptions?.({ aiWebSearchEnabled: this.webSearchOn });
      this.renderWebSearchToggle();
      new Notice(this.webSearchOn ? tRaw("ai.askQa.webSearchOn") : tRaw("ai.askQa.webSearchOff"));
    });
  }

  /**
   * Optionally fetch web results and prepend them to the user payload.
   * Skipped when the toggle is off. Failures degrade silently to no context.
   */
  private async gatherWebContext(
    text: string,
    signal?: AbortSignal,
    noteContext?: string,
    history?: string,
  ): Promise<string> {
    if (!this.webSearchOn) return "";
    const query = buildSearchQuery(text, noteContext, history);
    if (!query) {
      // Nothing searchable (chit-chat / empty) — skip silently
      return "";
    }

    this.setStatus(tRaw("ai.askQa.webSearching"), "busy");
    try {
      const resp = await searchWeb(query, 5, signal);
      if (!resp.ok || resp.results.length === 0) {
        this.lastWebSources = [];
        this.setStatus(
          `${tRaw("ai.askQa.webSearchFailed")}${resp.error ? `: ${resp.error}` : ""}`,
          "error",
        );
        return "";
      }
      this.lastWebSources = resp.results;
      this.setStatus(`${tRaw("ai.askQa.webSearch")}: ${resp.results.length}`, "idle");
      return formatSearchContext(resp.results, query);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      this.lastWebSources = [];
      this.setStatus(`${tRaw("ai.askQa.webSearchFailed")}: ${errorMessage(e)}`, "error");
      return "";
    }
  }

  private renderMessages(): void {
    const el = this.messagesEl;
    if (!el) return;
    this.streamBodyEl = null;
    // Model caption stays visible while idle — only refresh the name
    this.refreshModelCaption();
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

  private beginStream(): void {
    const el = this.messagesEl;
    if (!el) return;
    // Model label goes ABOVE the messages field, not inside the bubble
    this.refreshModelCaption();
    const row = el.createDiv({ cls: "ai-ask-msg ai-ask-msg--assistant" });
    const avatar = row.createDiv({ cls: "ai-ask-msg-avatar" });
    avatar.createSpan({ text: "✨" });
    const col = row.createDiv({ cls: "ai-ask-msg-col" });
    col.createDiv({ cls: "ai-ask-msg-who", text: this.aiLabel });
    this.streamBodyEl = col.createDiv({ cls: "ai-ask-msg-body is-streaming" });
    // Animation only — no partial word fragments while generating
    showTypingDots(this.streamBodyEl);
    el.scrollTop = el.scrollHeight;
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
      text: role === "user" ? this.userLabel : this.aiLabel,
    });
    const body = col.createDiv({
      cls: `ai-ask-msg-body${streaming ? " is-streaming" : ""}`,
    });
    if (!text.trim()) {
      showTypingDots(body);
      return;
    }

    if (role === "assistant") {
      renderMarkdown(body, text);
    } else {
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

    // Hover action bar + right-click menu on selected text
    this.mountMsgActions(row, body, role, text);
  }

  /** Per-message actions: copy / to note / make task / shorter / longer. */
  private mountMsgActions(
    row: HTMLElement,
    body: HTMLElement,
    role: "user" | "assistant",
    text: string,
  ): void {
    const actions = row.createDiv({ cls: "ai-ask-msg-actions" });
    const btn = (icon: string, label: string, fn: () => void) => {
      const b = actions.createEl("button", {
        cls: "ai-ask-msg-action",
        text: icon,
        attr: { type: "button", "aria-label": label, title: label },
      });
      b.addEventListener("click", (e) => {
        e.preventDefault();
        fn();
      });
    };

    btn("📋", tRaw("ai.askQa.actCopy"), () => {
      void navigator.clipboard.writeText(text);
      new Notice(tRaw("ai.askQa.copied"));
    });
    if (role === "assistant") {
      btn("📝", tRaw("ai.askQa.toNote"), () => void this.appendTextToNote(text));
    }
    btn("✅", tRaw("ai.askQa.actMakeTask"), () => void this.makeTaskFromText(text));
    btn("➖", tRaw("ai.askQa.actShorter"), () => this.rewrite(text, "shorter"));
    btn("➕", tRaw("ai.askQa.actLonger"), () => this.rewrite(text, "longer"));

    // Right-click on a selection inside the message body
    body.addEventListener("contextmenu", (e) => {
      const view = body.ownerDocument.defaultView ?? window;
      const sel = view.getSelection()?.toString().trim() || "";
      if (!sel) return;
      this.showSelectionMenu(e, sel);
    });
  }

  /**
   * Floating «Объяснить» chip that appears when the user selects text in chat.
   * Uses the popout window's selection (not `window` — chat lives in its own leaf).
   */
  private bindSelectionToolbar(): void {
    const host = this.root.ownerDocument;
    const getSel = (): string =>
      (host.defaultView ?? window).getSelection()?.toString().trim() || "";

    const hide = () => {
      this.selectionToolbarEl?.remove();
      this.selectionToolbarEl = null;
    };

    host.addEventListener("selectionchange", () => {
      const sel = getSel();
      const range = (host.defaultView ?? window).getSelection()?.rangeCount
        ? (host.defaultView ?? window).getSelection()?.getRangeAt(0)
        : null;
      const inChat =
        !!range &&
        !!this.messagesEl &&
        this.messagesEl.contains(range.commonAncestorContainer);

      if (!sel || !inChat) {
        hide();
        return;
      }

      if (!this.selectionToolbarEl) {
        this.selectionToolbarEl = host.body.createDiv({ cls: "ai-ask-sel-toolbar" });
        const explainBtn = this.selectionToolbarEl.createEl("button", {
          cls: "ai-ask-sel-btn ai-ask-sel-btn--primary",
          text: `💡 ${tRaw("ai.askQa.contextMenuExplain")}`,
          attr: { type: "button" },
        });
        explainBtn.addEventListener("mousedown", (e) => e.preventDefault());
        explainBtn.addEventListener("click", () => {
          const text = getSel();
          hide();
          if (text) this.rewrite(text, "explain");
        });

        const taskBtn = this.selectionToolbarEl.createEl("button", {
          cls: "ai-ask-sel-btn",
          text: `✅ ${tRaw("ai.askQa.actMakeTask")}`,
          attr: { type: "button" },
        });
        taskBtn.addEventListener("mousedown", (e) => e.preventDefault());
        taskBtn.addEventListener("click", () => {
          const text = getSel();
          hide();
          if (text) void this.makeTaskFromText(text);
        });
      }

      const rect = range.getBoundingClientRect();
      const bar = this.selectionToolbarEl;
      bar.style.top = `${Math.max(8, rect.top - 44)}px`;
      bar.style.left = `${Math.max(8, rect.left + rect.width / 2)}px`;
    });

    host.addEventListener("mousedown", (e) => {
      if (this.selectionToolbarEl && !this.selectionToolbarEl.contains(e.target as Node)) {
        // Delay so the click on the toolbar button still fires
        window.setTimeout(hide, 150);
      }
    });
  }

  /** Right-click menu on a selected fragment inside a message. */
  private showSelectionMenu(e: MouseEvent, sel: string): void {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle(tRaw("ai.askQa.contextMenuExplain"))
        .setIcon("lucide-lightbulb")
        .onClick(() => this.rewrite(sel, "explain"));
    });
    menu.addItem((item) => {
      item
        .setTitle(tRaw("ai.askQa.actMakeTask"))
        .setIcon("check-square")
        .onClick(() => void this.makeTaskFromText(sel));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle(tRaw("ai.askQa.actCopy"))
        .setIcon("copy")
        .onClick(() => {
          void navigator.clipboard.writeText(sel);
          new Notice(tRaw("ai.askQa.copied"));
        });
    });
    menu.showAtMouseEvent(e);
  }

  private rewrite(text: string, mode: "shorter" | "longer" | "explain"): void {
    const instruction =
      mode === "shorter"
        ? tRaw("ai.askQa.rewriteShorter")
        : mode === "longer"
          ? tRaw("ai.askQa.rewriteLonger")
          : tRaw("ai.askQa.explainPrompt");
    if (this.inputEl) {
      this.inputEl.value = `${instruction}\n\n${text}`;
      this.inputEl.focus();
    }
    void this.send();
  }

  private async makeTaskFromText(text: string): Promise<void> {
    const title = text.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) return;
    try {
      const { QuickAddModal } = await import("../task-tracker/QuickAddModal");
      const now = window.moment ? window.moment() : (window as unknown as { moment: () => never }).moment();
      // Straight into AI mode — the selection is free-form text for the model
      new QuickAddModal(this.app, now, undefined, {
        initialText: title,
        initialMode: "multi",
      }).open();
    } catch (e) {
      new Notice(errorMessage(e));
    }
  }

  private async appendTextToNote(text: string): Promise<void> {
    const target = await this.resolveTargetNote();
    if (!target) return;
    try {
      const prev = await this.app.vault.read(target);
      const stamp = `\n\n---\n\n${this.aiLabel}\n\n${text}\n`;
      await this.app.vault.modify(target, prev + stamp);
      new Notice(target.path);
    } catch (e) {
      new Notice(errorMessage(e));
    }
  }

  private async loadContext(): Promise<string> {
    const parts: string[] = [];
    let total = 0;

    if (this.selection?.text) {
      const block = `### Selection (${this.selection.label || "editor"})\n${this.selection.text}\n`;
      parts.push(block);
      total += block.length;
    }

    if (this.files.length === 0) {
      return parts.join("\n");
    }
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

  private chatAsMarkdown(): string {
    const lines: string[] = [`# ${tRaw("ai.askQa.chatNoteTitle")}`, ""];
    if (this.contextLabel) {
      lines.push(`> ${tRaw("ai.askQa.ctxLabel", { count: String(this.files.length), label: this.contextLabel })}`, "");
    }
    for (const m of this.messages) {
      const who = m.role === "user" ? this.userLabel : this.aiLabel;
      lines.push(`## ${who}`, "", m.text, "");
    }
    return lines.join("\n").trim() + "\n";
  }

  private async copyChat(): Promise<void> {
    if (this.messages.length === 0) {
      new Notice(tRaw("ai.askQa.nothingToCopy"));
      return;
    }
    await navigator.clipboard.writeText(this.chatAsMarkdown());
    new Notice(tRaw("ai.askQa.copied"));
  }

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

  private async resolveTargetNote(): Promise<TFile | null> {
    const md = this.app.workspace.getActiveViewOfType(MarkdownView);
    const active = md?.file;
    if (active instanceof TFileClass && active.extension === "md") return active;
    const first = this.files.find((f) => f.extension === "md");
    if (first) return first;
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
      userAbout?: string;
      aiTone?: string;
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
    this.root.addClass("scanning", "generating");
    this.setStatus("");
    this.renderMessages();
    this.beginStream();

    try {
      const context = await this.loadContext();
      const history = this.messages
        .slice(0, -1)
        .map((m) => `${m.role === "user" ? this.userLabel : this.aiLabel}: ${m.text}`)
        .join("\n\n");
      const webContext = await this.gatherWebContext(
        text,
        this.abort.signal,
        context,
        history,
      );

      const blocks: string[] = [];
      if (context) blocks.push(`Note context:\n${context}`);
      if (webContext) blocks.push(webContext);
      if (history) blocks.push(`Conversation so far:\n${history}`);
      blocks.push(`User message:\n${text}`);
      const userContent = blocks.join("\n\n");

      const about = (opts.userAbout || "").trim();
      const tone = (opts.aiTone || "").trim();
      const systemParts = [CHAT_STYLE_SYSTEM[this.chatStyle]];
      if (about) {
        systemParts.push(`About the user (use for tone and context): ${about}`);
      }
      if (tone) {
        systemParts.push(`Communication style — follow these rules strictly:\n${tone}`);
      }
      if (this.aiLabel && this.aiLabel !== tRaw("ai.askQa.ai")) {
        systemParts.push(`Your name is ${this.aiLabel}. Address yourself by this name if needed.`);
      }
      // Only talk about web access when the search toggle is on. Local models
      // otherwise volunteer a canned "I have no internet" refusal.
      if (this.webSearchOn && webContext) {
        systemParts.push(
          "You WERE given current web search results below (fetched just now by the host app). Use them as live context: answer with those facts, cite site titles or domains when useful. Do NOT say that you cannot search the web or lack internet access — the search already happened and the results are in this message. If the snippets do not cover the question, say what is missing and answer from general knowledge.",
        );
      } else if (this.webSearchOn) {
        systemParts.push(
          "Web search was attempted for this question but returned no usable snippets. Answer from general knowledge and the note context. Do not invent citations. You may mention in one short phrase that live sources were unavailable — then move on and still help.",
        );
      }

      const result = await streamOllamaChat(
        opts.ollamaUrl || "http://localhost:11434",
        resolveModel("reason", opts),
        [
          { role: "system", content: systemParts.join("\n\n") },
          { role: "user", content: userContent },
        ],
        {
          signal: this.abort.signal,
          temperature: 0.4,
        },
      );

      this.messages.push({ role: "assistant", text: result.trim() });
      this.streamBodyEl = null;
      this.renderMessages();
      this.mountSourceList();
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
      this.lastWebSources = [];
      this.isRunning = false;
      this.abort = null;
      this.root.removeClass("scanning", "generating");
      if (this.sendBtn) this.sendBtn.disabled = false;
      if (this.stopBtn) this.stopBtn.disabled = true;
      this.inputEl?.focus();
    }
  }

  /** Show clickable sources used for the last answer (when web search was on). */
  private mountSourceList(): void {
    const host = this.messagesEl;
    if (!host || this.lastWebSources.length === 0) return;
    const box = host.createDiv({ cls: "ai-ask-sources" });
    box.createDiv({ cls: "ai-ask-sources-title", text: tRaw("ai.askQa.webSearch") });
    for (const s of this.lastWebSources) {
      const a = box.createEl("a", {
        cls: "ai-ask-sources-link",
        text: s.title,
        attr: { href: s.url, target: "_blank", rel: "noopener noreferrer" },
      });
      a.addEventListener("click", (e) => {
        e.preventDefault();
        window.open(s.url, "_blank", "noopener,noreferrer");
      });
    }
    host.scrollTop = host.scrollHeight;
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


