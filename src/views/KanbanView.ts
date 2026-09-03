import { ItemView, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_KANBAN } from "../constants";
import type CalendarPlugin from "../main";
import KanbanBoard from "../components/KanbanBoard.svelte";
import { tRaw } from "../i18n";

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

  async onOpen(): Promise<void> {
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("kanban-view-container");

    this.svelteComponent = new KanbanBoard({
      target: container as HTMLElement,
      props: {
        appInstance: this.plugin.app,
      },
    });
  }

  async onClose(): Promise<void> {
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }
  }
}
