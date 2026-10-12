import type { App } from "obsidian";
import { CustomModal } from "../ui/CustomModal";
import { tRaw } from "../i18n";

export type SummaryExportFormat = "md" | "xlsx";

export interface SummaryExportChoice {
  format: SummaryExportFormat;
  /** Excel-only: month or year range. */
  period: "month" | "year";
}

/**
 * One-shot picker: where to send the month summary — Markdown note or Excel file.
 * Opened from the single «Сводка» button in FinanceTracker.
 */
export class ExportSummaryModal extends CustomModal {
  private onConfirm: (choice: SummaryExportChoice) => void;

  private format: SummaryExportFormat = "md";
  private period: "month" | "year" = "month";

  constructor(app: App, onConfirm: (choice: SummaryExportChoice) => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    this.containerEl.addClass("ai-finance-modal", "export-summary-modal");
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();

    const head = root.createDiv({ cls: "aif-head" });
    const icon = head.createDiv({ cls: "aif-head-icon", text: "📤" });
    icon.setAttribute("aria-hidden", "true");
    const headText = head.createDiv({ cls: "aif-head-text" });
    headText.createEl("h3", { text: tRaw("finance.exportMenu"), cls: "aif-title" });
    headText.createEl("p", {
      text: tRaw("finance.exportChooseHint"),
      cls: "aif-subtitle",
    });

    const cards = root.createDiv({ cls: "xsm-cards" });

    const mdCard = cards.createEl("button", {
      cls: "xsm-card" + (this.format === "md" ? " is-active" : ""),
      attr: { type: "button", "data-format": "md" },
    });
    mdCard.createDiv({ cls: "xsm-card-icon", text: "📄" });
    mdCard.createDiv({ cls: "xsm-card-title", text: tRaw("finance.exportFormatMd") });
    mdCard.createDiv({
      cls: "xsm-card-desc",
      text: tRaw("finance.exportFormatMdDesc"),
    });

    const xlsCard = cards.createEl("button", {
      cls: "xsm-card" + (this.format === "xlsx" ? " is-active" : ""),
      attr: { type: "button", "data-format": "xlsx" },
    });
    xlsCard.createDiv({ cls: "xsm-card-icon", text: "📊" });
    xlsCard.createDiv({ cls: "xsm-card-title", text: tRaw("finance.exportFormatExcel") });
    xlsCard.createDiv({
      cls: "xsm-card-desc",
      text: tRaw("finance.exportFormatExcelDesc"),
    });

    // Period only matters for Excel
    const periodWrap = root.createDiv({ cls: "xsm-period" });
    const setPeriodVisible = (visible: boolean) => {
      periodWrap.setCssStyles({ display: visible ? "" : "none" });
    };
    setPeriodVisible(this.format === "xlsx");

    const selectFormat = (fmt: SummaryExportFormat) => {
      this.format = fmt;
      cards.querySelectorAll(".xsm-card").forEach((el) => {
        el.classList.toggle("is-active", el.getAttribute("data-format") === fmt);
      });
      setPeriodVisible(fmt === "xlsx");
    };
    mdCard.addEventListener("click", () => selectFormat("md"));
    xlsCard.addEventListener("click", () => selectFormat("xlsx"));

    periodWrap.createEl("label", {
      cls: "xsm-period-label",
      text: tRaw("finance.exportPeriodLabel"),
    });
    const periodRow = periodWrap.createDiv({ cls: "xsm-period-row" });
    for (const p of ["month", "year"] as const) {
      const btn = periodRow.createEl("button", {
        text:
          p === "month"
            ? tRaw("finance.exportPeriodMonth")
            : tRaw("finance.exportPeriodYear"),
        cls: "xsm-period-btn" + (this.period === p ? " is-active" : ""),
        attr: { type: "button" },
      });
      btn.addEventListener("click", () => {
        this.period = p;
        periodRow.querySelectorAll(".xsm-period-btn").forEach((el) => {
          el.classList.toggle("is-active", el === btn);
        });
      });
    }

    const footer = root.createDiv({ cls: "aif-footer" });
    const cancel = footer.createEl("button", {
      text: tRaw("common.cancel"),
      cls: "ai-btn aif-btn-ghost",
    });
    cancel.addEventListener("click", () => this.close());

    const run = footer.createEl("button", {
      text: tRaw("finance.exportRun"),
      cls: "ai-btn ai-btn-primary aif-run-btn",
    });
    run.addEventListener("click", () => {
      this.onConfirm({ format: this.format, period: this.period });
      this.close();
    });
  }
}
