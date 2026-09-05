import { ItemView, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_WEATHER_DETAIL } from "../constants";
import type CalendarPlugin from "../main";
import WeatherDetail from "../components/WeatherDetail.svelte";
import { tRaw } from "../i18n";

export default class WeatherDetailView extends ItemView {
  private plugin: CalendarPlugin;
  private svelteComponent: WeatherDetail | null = null;
  private _date = "";

  constructor(leaf: WorkspaceLeaf, plugin: CalendarPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_WEATHER_DETAIL;
  }

  getDisplayText(): string {
    return tRaw("weather.detailTitle");
  }

  getIcon(): string {
    return "cloud-sun";
  }

  setDate(date: string): void {
    this._date = date;
    if (this.svelteComponent) {
      this.svelteComponent.$set({ date });
    }
  }

  async onOpen(): Promise<void> {
    if (this.svelteComponent) {
      this.svelteComponent.$destroy();
      this.svelteComponent = null;
    }
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("weather-detail-container");

    this.svelteComponent = new WeatherDetail({
      target: container as HTMLElement,
      props: {
        date: this._date,
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
