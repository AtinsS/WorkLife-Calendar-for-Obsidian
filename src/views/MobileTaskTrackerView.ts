import { ItemView, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_MOBILE_TASKS } from "../constants";
import type CalendarPlugin from "../main";
import MobileTasks from "../components/MobileTasks.svelte";
import { tRaw } from "../i18n";

export default class MobileTaskTrackerView extends ItemView {
  private plugin: CalendarPlugin;
  private svelteComponent: MobileTasks;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_MOBILE_TASKS;
  }

  getDisplayText(): string {
    return tRaw("hello.navTasks");
  }

  getIcon(): string {
    return "checkbox-glyph";
  }

  onOpen(): Promise<void> {
    if (this.svelteComponent) { this.svelteComponent.$destroy(); this.svelteComponent = null; }
    const container: HTMLElement = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("mobile-tasks-view-container");

    this.svelteComponent = new MobileTasks({
      target: container,
      props: {
        plugin: this.plugin,
      },
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
