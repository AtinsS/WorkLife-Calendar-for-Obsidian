import type { App, Plugin, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import { get } from "svelte/store";
import { tRaw } from "../i18n";
import { settings } from "./stores";

interface AiGateOptions {
  ollamaEnabled?: boolean;
  aiChatEnabled?: boolean;
}

function aiEnabled(): boolean {
  const opts = get(settings) as AiGateOptions;
  return opts.ollamaEnabled === true && opts.aiChatEnabled !== false && window.innerWidth > 768;
}

/** Markdown view that owns the given DOM node (split panes, popouts aside). */
function fileForNode(app: App, node: Node): TFile | null {
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file && view.containerEl.contains(node)) {
      return view.file;
    }
  }
  return null;
}

/**
 * Floating «Объяснить с помощью ИИ» chip on text selection in Reading view.
 * `editor-menu` never fires there (Obsidian builds it only for the CM editor),
 * so selection is the reliable entry point. Edit mode keeps its context menu.
 */
export function registerSelectionExplain(plugin: Plugin): void {
  const app = plugin.app;
  let bar: HTMLElement | null = null;

  const hide = (): void => {
    bar?.remove();
    bar = null;
  };

  const show = (): void => {
    const doc = document;
    if (!bar) {
      bar = doc.body.createDiv({ cls: "ai-ask-sel-toolbar" });
      const btn = bar.createEl("button", {
        cls: "ai-ask-sel-btn ai-ask-sel-btn--primary",
        text: `💡 ${tRaw("ai.askQa.contextMenuExplain")}`,
        attr: { type: "button" },
      });
      // Keep the selection alive across the button click
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        const text = doc.getSelection()?.toString().trim() || "";
        const sel = doc.getSelection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        const node = range?.commonAncestorContainer ?? null;
        const file = node ? fileForNode(app, node) : null;
        hide();
        if (!text) return;
        void import("../services/AIAskModal").then(({ openAiAskForSelection }) =>
          openAiAskForSelection(app, text, {
            prefill: tRaw("ai.askQa.explainPrompt"),
            send: true,
            file,
          }),
        );
      });
    }
  };

  const onSelectionChange = (): void => {
    const sel = document.getSelection();
    const text = sel?.toString().trim() || "";
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const node = range?.commonAncestorContainer ?? null;
    const el = node ? (node instanceof Element ? node : node.parentElement) : null;
    const inReadingView = !!el?.closest(".markdown-reading-view");

    if (!text || !range || !inReadingView || !aiEnabled()) {
      hide();
      return;
    }

    show();
    const rect = range.getBoundingClientRect();
    if (bar) {
      bar.style.top = `${Math.max(8, rect.top - 44)}px`;
      bar.style.left = `${Math.max(8, rect.left + rect.width / 2)}px`;
    }
  };

  plugin.registerDomEvent(document, "selectionchange", onSelectionChange);
  plugin.registerDomEvent(document, "mousedown", (e) => {
    if (bar && !bar.contains(e.target as Node)) {
      // Delay so the click on the chip still fires
      window.setTimeout(hide, 150);
    }
  });
  plugin.registerDomEvent(document, "keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  plugin.register(hide);
}
