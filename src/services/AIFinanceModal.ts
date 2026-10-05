import type { App } from "obsidian";
import { Notice, normalizePath, TFile } from "obsidian";
import { CustomModal } from "../ui/CustomModal";
import { renderMarkdown, appendMarkdownToNote, datedNotePath } from "../ui/markdown";
import { tRaw } from "../i18n";
import {
  forecastBalance,
  suggestDistribution,
  getFinanceAiConfig,
  type FinanceSummary,
  type DistributionSuggestion,
} from "./financeAI";

export type AIFinanceMode = "forecast" | "rules";

export interface AIFinanceCallbacks {
  getSummary: () => FinanceSummary;
  applyRules: (rules: string[], categoryPercents: Array<{ name: string; percent: number }>) => void;
}

/** AI modal for budget forecast and distribution rules (expense parsing lives in AIExpenseParseModal). */
export class AIFinanceModal extends CustomModal {
  private mode: AIFinanceMode;
  private cb: AIFinanceCallbacks;
  private abort: AbortController | null = null;
  private busy = false;

  private statusEl: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private suggestion: DistributionSuggestion | null = null;
  private forecastText = "";
  private lastPaint = 0;

  constructor(app: App, mode: AIFinanceMode, cb: AIFinanceCallbacks) {
    super(app);
    this.mode = mode;
    this.cb = cb;
  }

  onOpen(): void {
    this.containerEl.addClass("ai-finance-modal");
    this.render();
  }

  onClose(): void {
    this.abort?.abort();
    this.abort = null;
  }

  private setMode(mode: AIFinanceMode): void {
    this.mode = mode;
    this.suggestion = null;
    this.forecastText = "";
    this.render();
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
    root.createEl("h3", { text: tRaw("ai.finance.title"), cls: "ai-finance-title" });

    const tabs = root.createDiv({ cls: "ai-finance-tabs" });
    for (const m of ["forecast", "rules"] as AIFinanceMode[]) {
      const btn = tabs.createEl("button", {
        text: tRaw(`ai.finance.tab.${m}`),
        cls: "ai-finance-tab" + (m === this.mode ? " is-active" : ""),
      });
      btn.addEventListener("click", () => this.setMode(m));
    }

    this.statusEl = root.createDiv({ cls: "ai-finance-status is-hidden" });
    this.statusEl.setCssStyles({ display: "none" });
    this.resultEl = root.createDiv({ cls: "ai-finance-result" });

    if (this.mode === "forecast") this.renderForecast();
    else this.renderRules();

    const footer = root.createDiv({ cls: "ai-finance-footer" });
    const cancel = footer.createEl("button", {
      text: tRaw("common.cancel"),
      cls: "ai-btn",
    });
    cancel.addEventListener("click", () => this.close());
  }

  private renderForecast(): void {
    const box = this.resultEl;
    if (!box) return;
    box.createEl("p", { text: tRaw("ai.finance.forecastHint"), cls: "ai-finance-hint" });
    const actions = box.createDiv({ cls: "ai-finance-actions" });
    const run = actions.createEl("button", {
      text: tRaw("ai.finance.forecastRun"),
      cls: "ai-btn ai-btn-primary",
    });
    run.addEventListener("click", () => void this.runForecast());
  }

  private renderRules(): void {
    const box = this.resultEl;
    if (!box) return;
    box.createEl("p", { text: tRaw("ai.finance.rulesHint"), cls: "ai-finance-hint" });
    const actions = box.createDiv({ cls: "ai-finance-actions" });
    const run = actions.createEl("button", {
      text: tRaw("ai.finance.rulesRun"),
      cls: "ai-btn ai-btn-primary",
    });
    run.addEventListener("click", () => void this.runRules());
  }

  private ensureAi(): boolean {
    if (!getFinanceAiConfig().enabled) {
      new Notice(tRaw("ai.summaryNeedOllama"));
      return false;
    }
    return true;
  }

  private paintMarkdown(host: HTMLElement, md: string): void {
    host.empty();
    host.addClass("ai-finance-stream", "ai-md");
    renderMarkdown(host, md);
  }

  private async runForecast(): Promise<void> {
    if (this.busy || !this.ensureAi()) return;
    const box = this.resultEl;
    if (!box) return;
    this.busy = true;
    this.abort = new AbortController();
    this.forecastText = "";
    this.setStatus(tRaw("ai.finance.working"));
    const out = box.createDiv({ cls: "ai-finance-stream ai-md" });
    try {
      await forecastBalance(this.cb.getSummary(), this.abort.signal, (full) => {
        this.forecastText = full;
        const now = Date.now();
        if (now - this.lastPaint < 40) return;
        this.lastPaint = now;
        this.paintMarkdown(out, full);
      });
      this.paintMarkdown(out, this.forecastText.trim());
      this.setStatus("");
      this.mountNoteButton(box, () => this.forecastText.trim(), tRaw("ai.finance.noteForecastTitle"));
    } catch {
      out.remove();
      this.setStatus(tRaw("ai.finance.error"), true);
    } finally {
      this.busy = false;
    }
  }

  private async runRules(): Promise<void> {
    if (this.busy || !this.ensureAi()) return;
    this.busy = true;
    this.abort = new AbortController();
    this.setStatus(tRaw("ai.finance.working"));
    try {
      this.suggestion = await suggestDistribution(this.cb.getSummary(), this.abort.signal);
      this.setStatus("");
      this.paintRules();
    } catch {
      this.setStatus(tRaw("ai.finance.error"), true);
    } finally {
      this.busy = false;
    }
  }

  private rulesAsMarkdown(sug: DistributionSuggestion): string {
    const parts: string[] = [];
    if (sug.explanation) parts.push(sug.explanation.trim(), "");
    if (sug.rules.length) {
      parts.push(`## ${tRaw("ai.finance.tab.rules")}`, ...sug.rules.map((r) => `- ${r}`), "");
    }
    if (sug.categoryPercents.length) {
      parts.push(`## ${tRaw("ai.finance.rulesPercents")}`);
      for (const c of sug.categoryPercents) {
        parts.push(`- **${c.name}** — ${c.percent}%`);
      }
    }
    return parts.join("\n").trim();
  }

  private paintRules(): void {
    const box = this.resultEl;
    if (!box) return;
    box.querySelectorAll(".ai-finance-list, .ai-finance-apply, .ai-finance-stream, .ai-finance-note-btn").forEach((el) => el.remove());
    const sug = this.suggestion;
    if (!sug) return;

    const mdText = this.rulesAsMarkdown(sug);
    const stream = box.createDiv({ cls: "ai-finance-stream ai-md" });
    this.paintMarkdown(stream, mdText);

    const applyBtn = box.createEl("button", {
      text: tRaw("ai.finance.rulesApply"),
      cls: "ai-btn ai-btn-primary ai-finance-apply",
    });
    applyBtn.addEventListener("click", () => {
      if (!this.suggestion) return;
      this.cb.applyRules(this.suggestion.rules, this.suggestion.categoryPercents);
      new Notice(tRaw("ai.finance.rulesApplied"));
      this.close();
    });

    this.mountNoteButton(box, () => mdText, tRaw("ai.finance.noteRulesTitle"));
  }

  private mountNoteButton(
    box: HTMLElement,
    getText: () => string,
    title: string,
  ): void {
    box.querySelector(".ai-finance-note-btn")?.remove();
    const btn = box.createEl("button", {
      text: tRaw("ai.finance.saveToNote"),
      cls: "ai-btn ai-finance-note-btn",
    });
    btn.addEventListener("click", () => void this.saveToNote(getText(), title));
  }

  private async saveToNote(body: string, title: string): Promise<void> {
    const text = body.trim();
    if (!text) return;
    try {
      const path = await appendMarkdownToNote(
        this.app,
        datedNotePath(title),
        `# ${title}\n\n${text}\n`,
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
