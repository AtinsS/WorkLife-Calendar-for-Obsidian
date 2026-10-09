import { ItemView, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_FINANCIAL_ANALYTICS } from "../constants";
import type CalendarPlugin from "../main";
import FinanceTracker from "../finance/FinanceTracker.svelte";
import { tRaw } from "../i18n";

/**
 * Legacy view type kept for existing workspace layouts.
 * Renders the unified Finance block focused on the Income tab.
 */
export default class FinancialAnalyticsView extends ItemView {
  private plugin: CalendarPlugin;
  private svelteComponent: FinanceTracker;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_FINANCIAL_ANALYTICS;
  }

  getDisplayText(): string {
    return tRaw("hello.navFinance");
  }

  getIcon(): string {
    return "coins";
  }

  onOpen(): Promise<void> {
    if (this.svelteComponent) { this.svelteComponent.$destroy(); this.svelteComponent = null; }
    const container: HTMLElement = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("finance-view-container");

    this.svelteComponent = new FinanceTracker({
      target: container,
      props: { initialTab: "income" },
    });
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }
    return Promise.resolve();
  }
}
