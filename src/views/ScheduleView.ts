import { ItemView, WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";

import { VIEW_TYPE_SCHEDULE, VIEW_TYPE_TASKS, VIEW_TYPE_KANBAN, VIEW_TYPE_MOBILE_TASKS } from "../constants";
import type CalendarPlugin from "../main";
import { settings } from "../ui/stores";
import { tRaw } from "../i18n";
import ScheduleCalendar from "../components/ScheduleCalendar.svelte";

export default class ScheduleView extends ItemView {
  private plugin: CalendarPlugin;
  private svelteComponent: ScheduleCalendar;
  private settingsUnsub: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SCHEDULE;
  }

  getDisplayText(): string {
    return tRaw("hello.navSchedule");
  }

  getIcon(): string {
    return "calendar";
  }

  async onOpen(): Promise<void> {
    // Destroy stale component if onOpen is called again (hot-reload / workspace restore)
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("schedule-view-container");

    // View toggle header
    const isMobile = window.innerWidth <= 768;
    const tasksView = isMobile ? VIEW_TYPE_MOBILE_TASKS : VIEW_TYPE_TASKS;
    const header = container.createDiv({ cls: "view-switch-header" });
    const btnTasks = header.createEl("button", { text: "✅", cls: "view-switch-btn", attr: { title: tRaw("tasks.panel.title") } });
    const btnKanban = header.createEl("button", { text: "▦", cls: "view-switch-btn", attr: { title: tRaw("kanban.title") } });
    header.createEl("button", { text: "📅", cls: "view-switch-btn active", attr: { title: tRaw("hello.navSchedule") } });
    btnTasks.addEventListener("click", () => this.leaf.setViewState({ type: tasksView, active: true }));
    btnKanban.addEventListener("click", () => this.leaf.setViewState({ type: VIEW_TYPE_KANBAN, active: true }));

    this.svelteComponent = new ScheduleCalendar({
      target: container as HTMLElement,
      props: {
        plugin: this.plugin,
        scheduleDisplay: get(settings),
        weatherEnabled: get(settings).weatherEnabled,
        weatherLatitude: get(settings).weatherLatitude,
        weatherLongitude: get(settings).weatherLongitude,
        weatherProvider: get(settings).weatherProvider || "open-meteo",
        weatherApiKey: get(settings).weatherApiKey,
      },
    });

    // Reactively update scheduleDisplay and weather when settings change
    this.settingsUnsub = settings.subscribe((val) => {
      if (this.svelteComponent) {
        this.svelteComponent.$set({
          scheduleDisplay: val,
          weatherEnabled: val.weatherEnabled,
          weatherLatitude: val.weatherLatitude,
          weatherLongitude: val.weatherLongitude,
          weatherProvider: val.weatherProvider || "open-meteo",
          weatherApiKey: val.weatherApiKey,
        });
      }
    });
  }

  async onClose(): Promise<void> {
    if (this.settingsUnsub) {
      this.settingsUnsub();
      this.settingsUnsub = null;
    }
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }
  }
}
