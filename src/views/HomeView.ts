import { ItemView, WorkspaceLeaf } from "obsidian";

import type CalendarPlugin from "../main";
import Dashboard from "../dashboard/Dashboard.svelte";
import HelloView from "../components/HelloView.svelte";
import { tRaw } from "../i18n";
import { VIEW_TYPE_HOME } from "../constants";
import { markViewEnter } from "./viewSwitch";

/**
 * Home dashboard — thin composition of the existing HelloView (greeting,
 * weather, quick nav) and Dashboard widgets in one scrollable view.
 * No logic is duplicated: components keep their note-embed behavior.
 */
export default class HomeView extends ItemView {
  private plugin: CalendarPlugin;
  private hello: HelloView | null = null;
  private dashboard: Dashboard | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_HOME;
  }

  getDisplayText(): string {
    return tRaw("main.ribbon.home");
  }

  getIcon(): string {
    return "home";
  }

  onOpen(): Promise<void> {
    this.destroyComponents();
    const container: HTMLElement = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("wl-home-view-container");
    markViewEnter(container);

    this.hello = new HelloView({
      target: container,
      props: {
        appInstance: this.plugin.app,
        onOpenTasks: () => void this.plugin.activateTaskView(),
        onOpenAnalytics: () => void this.plugin.activateHabitAnalyticsView(),
        onOpenFinance: () => void this.plugin.activateFinanceView(),
        onOpenSchedule: () =>
          void (window.innerWidth <= 768
            ? this.plugin.activateMobileScheduleView()
            : this.plugin.activateScheduleView()),
        persistNavOrder: (order: string[]) => {
          void this.plugin.writeOptions({ helloNavOrder: order });
        },
      },
    });

    this.dashboard = new Dashboard({
      target: container,
      props: {
        appInstance: this.plugin.app,
        // No filePath → cards persist to calendar-data/dashboard.json.
        // Note-embedded ```dashboard``` blocks keep their frontmatter storage.
      },
    });
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.destroyComponents();
    return Promise.resolve();
  }

  private destroyComponents(): void {
    this.hello?.$destroy();
    this.hello = null;
    this.dashboard?.$destroy();
    this.dashboard = null;
  }
}
