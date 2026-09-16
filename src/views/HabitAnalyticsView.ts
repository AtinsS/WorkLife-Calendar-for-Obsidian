import { ItemView, WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";

import { VIEW_TYPE_HABIT_ANALYTICS } from "../constants";
import type CalendarPlugin from "../main";
import HabitAnalytics from "../components/HabitAnalytics.svelte";
import { settings } from "../ui/stores";
import type { ISettings } from "src/settings";
import { tRaw } from "../i18n";

export default class HabitAnalyticsView extends ItemView {
  private plugin: CalendarPlugin;
  private svelteComponent: HabitAnalytics;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_HABIT_ANALYTICS;
  }

  getDisplayText(): string {
    return tRaw("hello.navAnalytics");
  }

  getIcon(): string {
    return "bar-chart";
  }

  onOpen(): Promise<void> {
    if (this.svelteComponent) { this.svelteComponent.$destroy(); this.svelteComponent = null; }
    const container: HTMLElement = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("habit-analytics-view-container");

    const currentSettings: ISettings = get(settings);
    const habitsHidden = currentSettings.showHabitTracker === false;

    this.svelteComponent = new HabitAnalytics({
      target: container,
      props: { habitsHidden },
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
