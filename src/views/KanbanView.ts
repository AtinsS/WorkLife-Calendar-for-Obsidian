import { ItemView, WorkspaceLeaf } from "obsidian";

import { VIEW_TYPE_KANBAN, VIEW_TYPE_TASKS, VIEW_TYPE_SCHEDULE, VIEW_TYPE_MOBILE_TASKS, VIEW_TYPE_MOBILE_SCHEDULE } from "../constants";
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

    // View toggle header
    const isMobile = window.innerWidth <= 768;
    const tasksView = isMobile ? VIEW_TYPE_MOBILE_TASKS : VIEW_TYPE_TASKS;
    const scheduleView = isMobile ? VIEW_TYPE_MOBILE_SCHEDULE : VIEW_TYPE_SCHEDULE;
    const header = container.createDiv({ cls: "view-switch-header" });
    const btnTasks = header.createEl("button", { text: "✅", cls: "view-switch-btn", attr: { title: tRaw("tasks.panel.title") } });
    header.createEl("button", { text: "▦", cls: "view-switch-btn active", attr: { title: tRaw("kanban.title") } });
    const btnSchedule = header.createEl("button", { text: "📅", cls: "view-switch-btn", attr: { title: tRaw("hello.navSchedule") } });
    btnTasks.addEventListener("click", () => this.leaf.setViewState({ type: tasksView, active: true }));
    btnSchedule.addEventListener("click", () => this.leaf.setViewState({ type: scheduleView, active: true }));

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
