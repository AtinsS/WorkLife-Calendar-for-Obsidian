import type { App } from "obsidian";
import { Notice } from "obsidian";
import { CustomModal, guardTyping } from "../ui/CustomModal";
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
  private textArea: HTMLTextAreaElement | null = null;

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
    this.containerEl.addClass("ai-finance-modal");
    this.render();
  }

  onClose(): void {
    this.abort?.abort();
    this.abort = null;
  }

  private setStatus(text: string, isError = false): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("is-error", isError);
    this.statusEl.classList.toggle("is-hidden", !text);
    this.statusEl.setCssStyles({ display: text ? "" : "none" });
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.createEl("h3", { text: tRaw("finance.parseTitle"), cls: "ai-finance-title" });
    root.createEl("p", {
      text: tRaw("finance.parseHint"),
      cls: "ai-finance-hint",
    });

    this.textArea = root.createEl("textarea", {
      cls: "ai-finance-textarea",
      attr: { rows: "5", placeholder: tRaw("finance.parsePlaceholder") },
    });
    guardTyping(this.textArea);

    const actions = root.createDiv({ cls: "ai-finance-actions" });
    const run = actions.createEl("button", {
      text: tRaw("finance.parseRun"),
      cls: "ai-btn ai-btn-primary",
    });
    run.addEventListener("click", () => void this.runParse());

    this.statusEl = root.createDiv({ cls: "ai-finance-status is-hidden" });
    this.statusEl.setCssStyles({ display: "none" });

    this.listEl = root.createDiv({ cls: "ai-finance-result" });

    const footer = root.createDiv({ cls: "ai-finance-footer" });
    const cancel = footer.createEl("button", {
      text: tRaw("common.cancel"),
      cls: "ai-btn",
    });
    cancel.addEventListener("click", () => this.close());
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
    this.setStatus(tRaw("ai.finance.working"));
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
    }
  }

  private paintResults(): void {
    const box = this.listEl;
    if (!box) return;
    box.empty();
    if (this.parsed.length === 0) {
      this.setStatus(tRaw("finance.parseEmpty"), true);
      return;
    }

    const list = box.createDiv({ cls: "ai-finance-list" });
    for (const item of this.parsed) {
      const row = list.createDiv({ cls: "ai-finance-row" });
      const check = row.createEl("input", {
        type: "checkbox",
        cls: "ai-finance-row-check",
        attr: { "aria-label": item.name },
      });
      if (check instanceof HTMLInputElement) {
        check.checked = item.selected;
        check.addEventListener("change", () => {
          item.selected = check.checked;
        });
      }
      row.createEl("span", { text: item.icon, cls: "ai-finance-row-icon" });
      row.createEl("span", { text: item.name, cls: "ai-finance-row-name" });
      row.createEl("span", {
        text: `${item.amount.toLocaleString()} ${tRaw("locale.currencySymbol")}`,
        cls: "ai-finance-row-amt",
      });
      if (item.categoryName) {
        row.createEl("span", { text: item.categoryName, cls: "ai-finance-row-cat" });
      }
    }

    const applyBtn = box.createEl("button", {
      text: tRaw("finance.parseApply"),
      cls: "ai-btn ai-btn-primary ai-finance-apply",
    });
    applyBtn.addEventListener("click", () => {
      const selected = this.parsed.filter((p) => p.selected);
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
    });
  }
}
