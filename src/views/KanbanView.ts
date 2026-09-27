import { ItemView, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_KANBAN } from "../constants";
import type CalendarPlugin from "../main";
import KanbanBoard from "../components/KanbanBoard.svelte";
import { tRaw } from "../i18n";
import { createViewSwitcher, markViewEnter } from "./viewSwitch";

export default class KanbanView extends ItemView {
  private plugin: CalendarPlugin;
  private svelteComponent: KanbanBoard;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_KANBAN;
  }

  getDisplayText(): string {
    return tRaw("kanban.title");
  }

  getIcon(): string {
    return "layout-grid";
  }

  onOpen(): Promise<void> {
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }
    const container: HTMLElement = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("kanban-view-container");
    markViewEnter(container);

    createViewSwitcher(container, "kanban", this.leaf);

    this.svelteComponent = new KanbanBoard({
      target: container,
      props: {
        appInstance: this.plugin.app,
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
