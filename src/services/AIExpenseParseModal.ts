import type { App } from "obsidian";
import { Notice, normalizePath, TFile } from "obsidian";
import { CustomModal, guardTyping } from "../ui/CustomModal";
import { renderMarkdown, appendMarkdownToNote, datedNotePath } from "../ui/markdown";
import { tRaw } from "../i18n";
import {
  parseExpensesFromText,
  getFinanceAiConfig,
  type ParsedExpense,
} from "./financeAI";
import type { ExpenseCategoryDef } from "../finance/expenseCategories";

export interface ExpenseParseResult {
  name: string;
  icon: string;
  amount: number;
  categoryName: string;
}

export class AIExpenseParseModal extends CustomModal {
  private categories: ExpenseCategoryDef[];
  private onApply: (items: ExpenseParseResult[]) => void;
  private abort: AbortController | null = null;
  private busy = false;
  private parsed: ParsedExpense[] = [];

  private statusEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private textArea: HTMLTextAreaElement | null = null;
  private runBtn: HTMLButtonElement | null = null;
  private applyBtn: HTMLButtonElement | null = null;
  private noteBtnEl: HTMLButtonElement | null = null;

  constructor(
    app: App,
    categories: ExpenseCategoryDef[],
    onApply: (items: ExpenseParseResult[]) => void,
  ) {
    super(app);
    this.categories = categories;
    this.onApply = onApply;
  }

  onOpen(): void {
    this.containerEl.addClass("ai-finance-modal", "ai-expense-modal");
    this.render();
  }

  onClose(): void {
    this.abort?.abort();
    this.abort = null;
  }

  private setStatus(text: string, isError = false, busy = false): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("is-error", isError);
    this.statusEl.classList.toggle("is-busy", busy);
    this.statusEl.classList.toggle("is-hidden", !text);
    this.statusEl.setCssStyles({ display: text ? "" : "none" });
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();

    // ── Header ──
    const head = root.createDiv({ cls: "aex-head" });
    const icon = head.createDiv({ cls: "aex-head-icon", text: "🧾" });
    icon.setAttribute("aria-hidden", "true");
    const headText = head.createDiv({ cls: "aex-head-text" });
    headText.createEl("h3", { text: tRaw("finance.parseTitle"), cls: "aex-title" });
    headText.createEl("p", { text: tRaw("finance.parseHint"), cls: "aex-subtitle" });

    // ── Input ──
    const inputWrap = root.createDiv({ cls: "aex-input-wrap" });
    this.textArea = inputWrap.createEl("textarea", {
      cls: "aex-textarea",
      attr: { rows: "4", placeholder: tRaw("finance.parsePlaceholder") },
    });
    guardTyping(this.textArea);

    this.statusEl = root.createDiv({ cls: "aex-status is-hidden" });
    this.statusEl.setCssStyles({ display: "none" });

    // ── Results ──
    this.summaryEl = root.createDiv({ cls: "aex-summary" });
    this.summaryEl.setCssStyles({ display: "none" });
    this.listEl = root.createDiv({ cls: "aex-list" });

    // ── Footer: Cancel + Parse aligned in one row; Note + Apply appear after parse ──
    const footer = root.createDiv({ cls: "aex-footer" });

    const cancel = footer.createEl("button", {
      text: tRaw("common.cancel"),
      cls: "ai-btn aex-btn-ghost aex-cancel-btn",
    });
    cancel.addEventListener("click", () => this.close());

    footer.createDiv({ cls: "aex-footer-spacer" });

    const noteBtn = footer.createEl("button", {
      text: tRaw("ai.finance.saveToNote"),
      cls: "ai-btn aex-btn-ghost aex-note-btn",
    });
    noteBtn.addEventListener("click", () => void this.saveToNote());
    noteBtn.setCssStyles({ display: "none" });
    this.noteBtnEl = noteBtn;

    this.applyBtn = footer.createEl("button", {
      text: tRaw("finance.parseApply"),
      cls: "ai-btn ai-btn-primary aex-apply-btn",
    });
    this.applyBtn.setCssStyles({ display: "none" });
    this.applyBtn.addEventListener("click", () => this.applySelected());

    this.runBtn = footer.createEl("button", {
      text: tRaw("finance.parseRun"),
      cls: "ai-btn ai-btn-primary aex-run-btn",
    });
    this.runBtn.addEventListener("click", () => void this.runParse());
  }

  private ensureAi(): boolean {
    if (!getFinanceAiConfig().enabled) {
      new Notice(tRaw("ai.summaryNeedOllama"));
      return false;
    }
    return true;
  }

  private async runParse(): Promise<void> {
    if (this.busy || !this.ensureAi() || !this.textArea) return;
    const text = this.textArea.value.trim();
    if (!text) {
      this.setStatus(tRaw("finance.parseEmpty"), true);
      return;
    }
    this.busy = true;
    this.abort = new AbortController();
    if (this.runBtn) {
      this.runBtn.disabled = true;
      this.runBtn.textContent = tRaw("ai.finance.working");
    }
    this.setStatus(tRaw("ai.finance.working"), false, true);
    try {
      this.parsed = await parseExpensesFromText(
        text,
        this.categories,
        this.abort.signal,
      );
      this.setStatus("");
      this.paintResults();
    } catch (e) {
      this.setStatus(
        e instanceof Error && e.message === "ollama-disabled"
          ? tRaw("ai.summaryNeedOllama")
          : tRaw("ai.finance.error"),
        true,
      );
    } finally {
      this.busy = false;
      if (this.runBtn) {
        this.runBtn.disabled = false;
        this.runBtn.textContent = tRaw("finance.parseRun");
      }
    }
  }

  private selected(): ParsedExpense[] {
    return this.parsed.filter((p) => p.selected);
  }

  private expensesAsMarkdown(items: ParsedExpense[]): string {
    const currency = tRaw("locale.currencySymbol");
    const total = items.reduce((s, i) => s + i.amount, 0);
    const lines = [
      `## ${tRaw("finance.parseTitle")}`,
      "",
      ...items.map(
        (i) =>
          `- ${i.icon} **${i.name}** — ${i.amount.toLocaleString()} ${currency}${
            i.categoryName ? ` · ${i.categoryName}` : ""
          }`,
      ),
      "",
      `**${tRaw("finance.parseApply")}: ${total.toLocaleString()} ${currency}**`,
    ];
    return lines.join("\n");
  }

  private paintResults(): void {
    const box = this.listEl;
    if (!box) return;
    box.empty();
    if (this.parsed.length === 0) {
      this.setStatus(tRaw("finance.parseEmpty"), true);
      this.summaryEl?.setCssStyles({ display: "none" });
      if (this.applyBtn) this.applyBtn.setCssStyles({ display: "none" });
      if (this.noteBtnEl) this.noteBtnEl.setCssStyles({ display: "none" });
      if (this.runBtn) this.runBtn.setCssStyles({ display: "" });
      return;
    }

    // Toolbar: select all + count
    const bar = box.createDiv({ cls: "aex-bar" });
    const allSelected = this.parsed.every((p) => p.selected);
    const toggleAll = bar.createEl("button", {
      text: allSelected
        ? tRaw("ai.finance.parseDeselectAll")
        : tRaw("ai.finance.parseSelectAll"),
      cls: "aex-toggle-all",
    });
    toggleAll.addEventListener("click", () => {
      const next = !this.parsed.every((p) => p.selected);
      for (const p of this.parsed) p.selected = next;
      this.paintResults();
    });
    bar.createSpan({
      text: tRaw("ai.finance.parseCount", { count: String(this.parsed.length) }),
      cls: "aex-bar-count",
    });

    // Rows
    const list = box.createDiv({ cls: "aex-rows" });
    for (const item of this.parsed) {
      const row = list.createDiv({ cls: "aex-row" + (item.selected ? " is-selected" : "") });

      const check = row.createEl("input", {
        type: "checkbox",
        cls: "aex-row-check",
        attr: { "aria-label": item.name },
      });
      if (check.instanceOf(HTMLInputElement)) {
        check.checked = item.selected;
        check.addEventListener("change", () => {
          item.selected = check.checked;
          row.classList.toggle("is-selected", item.selected);
          this.syncSummary();
          this.refreshToggleAll(bar, toggleAll);
        });
      }

      const icon = row.createDiv({ cls: "aex-row-icon", text: item.icon || "📦" });
      icon.setAttribute("aria-hidden", "true");

      const body = row.createDiv({ cls: "aex-row-body" });
      body.createDiv({ text: item.name, cls: "aex-row-name" });
      if (item.categoryName) {
        body.createDiv({ text: item.categoryName, cls: "aex-row-cat" });
      }

      row.createDiv({
        text: `${item.amount.toLocaleString()} ${tRaw("locale.currencySymbol")}`,
        cls: "aex-row-amt",
      });
    }

    // Markdown preview (collapsible-looking section)
    const mdWrap = box.createDiv({ cls: "aex-md-wrap" });
    const mdHead = mdWrap.createDiv({ cls: "aex-md-head" });
    mdHead.createSpan({ text: "MD", cls: "aex-md-badge" });
    mdHead.createSpan({
      text: tRaw("ai.finance.parsePreview"),
      cls: "aex-md-label",
    });
    const md = mdWrap.createDiv({ cls: "ai-finance-stream ai-md aex-md-body" });
    renderMarkdown(md, this.expensesAsMarkdown(this.selected()));

    if (this.applyBtn) this.applyBtn.setCssStyles({ display: "" });
    if (this.noteBtnEl) this.noteBtnEl.setCssStyles({ display: "" });
    if (this.runBtn) this.runBtn.setCssStyles({ display: "none" });
    this.syncSummary();
  }

  private refreshToggleAll(bar: HTMLElement, btn: HTMLElement): void {
    const allSelected = this.parsed.length > 0 && this.parsed.every((p) => p.selected);
    btn.textContent = allSelected
      ? tRaw("ai.finance.parseDeselectAll")
      : tRaw("ai.finance.parseSelectAll");
    void bar;
  }

  private syncSummary(): void {
    const box = this.listEl;
    const summary = this.summaryEl;
    if (!box || !summary) return;
    const sel = this.selected();
    const currency = tRaw("locale.currencySymbol");
    const total = sel.reduce((s, i) => s + i.amount, 0);

    summary.empty();
    summary.setCssStyles({ display: sel.length ? "" : "none" });
    summary.createSpan({
      text: tRaw("ai.finance.parseSelected", { count: String(sel.length) }),
      cls: "aex-summary-count",
    });
    summary.createDiv({
      text: `${total.toLocaleString()} ${currency}`,
      cls: "aex-summary-total",
    });

    const md = box.querySelector(".aex-md-body");
    if (md?.instanceOf(HTMLElement)) {
      renderMarkdown(md, this.expensesAsMarkdown(sel));
    }

    if (this.applyBtn) {
      this.applyBtn.disabled = sel.length === 0;
      this.applyBtn.textContent = sel.length
        ? `${tRaw("finance.parseApply")} (${sel.length})`
        : tRaw("finance.parseApply");
    }
    if (this.noteBtnEl) {
      this.noteBtnEl.disabled = sel.length === 0;
    }
  }

  private applySelected(): void {
    const selected = this.selected();
    if (selected.length === 0) return;
    this.onApply(
      selected.map((p) => ({
        name: p.name,
        icon: p.icon,
        amount: p.amount,
        categoryName: p.categoryName,
      })),
    );
    new Notice(tRaw("finance.parseApplied", { count: String(selected.length) }));
    this.close();
  }

  private async saveToNote(): Promise<void> {
    const items = this.selected();
    if (items.length === 0) return;
    const title = tRaw("ai.finance.noteExpensesTitle");
    const body = this.expensesAsMarkdown(items);
    try {
      const path = await appendMarkdownToNote(
        this.app,
        datedNotePath(title),
        `# ${title}\n\n${body}\n`,
      );
      new Notice(tRaw("ai.finance.noteSaved", { path }));
      const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf("tab").openFile(file);
      }
    } catch (e) {
      new Notice(tRaw("ai.finance.noteError", { error: e instanceof Error ? e.message : String(e) }));
    }
  }
}
