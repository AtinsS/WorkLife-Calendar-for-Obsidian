import type { App } from "obsidian";
import { Notice } from "obsidian";
import { CustomModal, guardTyping } from "../ui/CustomModal";
import { tRaw } from "../i18n";
import { setWeightEntry } from "./stores";
import { toDateKey } from "./types";

/** Minimal modal to log today's weight. */
export class WeightEntryModal extends CustomModal {
  private initial: string;

  constructor(app: App, initial = "") {
    super(app);
    this.initial = initial;
  }

  onOpen(): void {
    this.containerEl.addClass("weight-entry-modal");
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();

    root.createEl("h3", {
      text: tRaw("weight.quickTitle"),
      cls: "weight-entry-title",
    });

    const row = root.createDiv({ cls: "weight-entry-row" });
    const input = row.createEl("input", {
      type: "number",
      value: this.initial,
      placeholder: "0.0",
      cls: "weight-entry-input",
      attr: {
        step: "0.1",
        min: "1",
        inputmode: "decimal",
      },
    });
    if (!(input instanceof HTMLInputElement)) return;
    row.createEl("span", {
      text: tRaw("weight.unit"),
      cls: "weight-entry-unit",
    });
    guardTyping(input, () => this.save(input));

    const actions = root.createDiv({ cls: "weight-entry-actions" });
    const cancel = actions.createEl("button", {
      text: tRaw("common.cancel"),
      cls: "ai-btn",
    });
    cancel.addEventListener("click", () => this.close());

    const save = actions.createEl("button", {
      text: tRaw("weight.save"),
      cls: "ai-btn ai-btn-primary",
    });
    save.addEventListener("click", () => this.save(input));

    window.setTimeout(() => input.focus(), 50);
  }

  private save(input: HTMLInputElement): void {
    const raw = input.value.trim().replace(",", ".");
    const n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) {
      new Notice(tRaw("weight.invalidWeight"));
      return;
    }
    setWeightEntry(toDateKey(new Date()), n);
    new Notice(tRaw("weight.saved"));
    this.close();
  }
}
