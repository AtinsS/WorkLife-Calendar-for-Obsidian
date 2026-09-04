import { ItemView, WorkspaceLeaf } from "obsidian";

import type CalendarPlugin from "../main";
import HabitPanel from "../habit-tracker/HabitPanel.svelte";
import { tRaw } from "../i18n";

export default class HabitPanelView extends ItemView {
  private plugin: CalendarPlugin;
  private svelteComponent: HabitPanel;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return "calendar-habit-panel";
  }

  getDisplayText(): string {
    return tRaw("habits.panel.title");
  }

  getIcon(): string {
    return "flame";
  }

  async onOpen(): Promise<void> {
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("habit-panel-view-container");

    this.svelteComponent = new HabitPanel({
      target: container as HTMLElement,
      props: { appInstance: this.plugin.app, showAnalytics: true },
    });
  }

  async onClose(): Promise<void> {
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }
  }
}
