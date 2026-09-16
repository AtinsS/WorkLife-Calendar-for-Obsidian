import { ItemView, WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";

import { VIEW_TYPE_SCHEDULE, VIEW_TYPE_TASKS, VIEW_TYPE_KANBAN, VIEW_TYPE_MOBILE_TASKS } from "../constants";
import type CalendarPlugin from "../main";
import { settings } from "../ui/stores";
import type { ISettings } from "src/settings";
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

  onOpen(): Promise<void> {
    // Destroy stale component if onOpen is called again (hot-reload / workspace restore)
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }

    const container: HTMLElement = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("schedule-view-container");

    // View toggle header
    const isMobile = window.innerWidth <= 768;
    const tasksView = isMobile ? VIEW_TYPE_MOBILE_TASKS : VIEW_TYPE_TASKS;
    const header = container.createDiv({ cls: "view-switch-header" });
    const btnTasks = header.createEl("button", { text: "✅", cls: "view-switch-btn", attr: { title: tRaw("tasks.panel.title") } });
    const btnKanban = header.createEl("button", { text: "▦", cls: "view-switch-btn", attr: { title: tRaw("kanban.title") } });
    header.createEl("button", { text: "📅", cls: "view-switch-btn active", attr: { title: tRaw("hello.navSchedule") } });
    btnTasks.addEventListener("click", () => void this.leaf.setViewState({ type: tasksView, active: true }));
    btnKanban.addEventListener("click", () => void this.leaf.setViewState({ type: VIEW_TYPE_KANBAN, active: true }));

    const currentSettings: ISettings = get(settings);

    this.svelteComponent = new ScheduleCalendar({
      target: container,
      props: {
        plugin: this.plugin,
        scheduleDisplay: currentSettings,
        weatherEnabled: currentSettings.weatherEnabled,
        weatherLatitude: currentSettings.weatherLatitude,
        weatherLongitude: currentSettings.weatherLongitude,
        weatherProvider: currentSettings.weatherProvider || "open-meteo",
        weatherApiKey: currentSettings.weatherApiKey,
      },
    });

    this.settingsUnsub = settings.subscribe((val: ISettings) => {
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
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    if (this.settingsUnsub) {
      this.settingsUnsub();
      this.settingsUnsub = null;
    }
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }
    return Promise.resolve();
  }
}
