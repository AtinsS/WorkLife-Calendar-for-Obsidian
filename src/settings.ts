import { App, PluginSettingTab, Setting, TFolder, Notice, TextComponent, setIcon } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { appHasDailyNotesPluginLoaded } from "obsidian-daily-notes-interface";
import type { ILocaleOverride } from "obsidian-calendar-ui";
import { get } from "svelte/store";

import { DEFAULT_WORDS_PER_DOT } from "src/constants";
import {
  clearNotificationHistory,
  loadNotificationDiagnostics,
} from "./services/notificationTelemetry";

import type CalendarPlugin from "./main";
import { fetchWeekWeather, getWeatherAttribution, type WeatherProvider } from "./services/weatherService";
import { initLocale, tRaw } from "./i18n";
import { testOllamaConnection, testOllamaModel } from "./services/OllamaService";
import { checkForPluginUpdate, fetchLatestRelease, updatePluginNow, compareVersions, pluginUpdateInfo } from "./services/updateCheck";

export interface ISettings {
  wordsPerDot: number;
  shouldConfirmBeforeCreate: boolean;

  // Language & locale
  language: "ru" | "en" | "system";
  startOfWeek: "monday" | "sunday" | "system";

  // Weekly Note settings
  showWeeklyNote: boolean;
  weeklyNoteFormat: string;
  weeklyNoteTemplate: string;
  weeklyNoteFolder: string;

  localeOverride: ILocaleOverride;

  // Task Tracker settings
  taskTrackerCollapsed: boolean;

  // Dashboard widget settings
  dashboardShowTasks?: boolean;
  dashboardShowHabits?: boolean;
  dashboardShowGoals?: boolean;

  // Hello view settings
  userName?: string;
  helloShowTasksBtn?: boolean;
  helloShowAnalyticsBtn?: boolean;
  helloShowFinanceBtn?: boolean;
  helloShowScheduleBtn?: boolean;
  helloShowSearch?: boolean;
  helloShowWeight?: boolean;
  /** Порядок nav-кнопок в hello: "tasks" | "analytics" | "finance" | "schedule" */
  helloNavOrder?: string[];

  // Data cleanup
  autoCleanupThreshold: number;
  timeLogCleanupThreshold: number;

  // Habit Tracker settings
  showHabitTracker?: boolean;
  /** "separate" — вкладка в переключателе; "hidden" — скрыть */
  habitTrackerMode?: "separate" | "hidden";
  habitLogCleanupThreshold: number;

  /** Видимость переключателя Задачи/Канбан/Расписание/Привычки */
  viewSwitcherMode?: "everywhere" | "desktop" | "mobile" | "hidden";
  /** Kanban board shown when the Kanban view opens ("default" = built-in status board). */
  defaultKanbanBoardId?: string;

  // Weight control
  weightControlEnabled?: boolean;

  // Sync settings
  syncToVault: boolean;
  /** Автоочистка *.sync-conflict-* (Syncthing) при запуске */
  syncConflictCleanupEnabled: boolean;

  // Notification settings
  notificationsEnabled: boolean;
  reminderMinutesBefore: number;
  checkIntervalMs: number;
  notifyReminders: boolean;
  notifyOverdue: boolean;
  notifyEstimateExceeded: boolean;
  notifyDeadlines: boolean;

  // ntfy.sh settings
  ntfyEnabled: boolean;
  ntfyTopic: string;
  ntfyScheduledEnabled: boolean;
  ntfyDailyDigestEnabled: boolean;
  /** Digest delivery time, "HH:mm". Default 06:00. */
  ntfyDigestTime: string;

  /** Daily GitHub release check → notice when plugin update is available */
  checkPluginUpdates: boolean;

  // Work task settings
  defaultPaymentType: "hour" | "day";
  defaultRate: number;

  // Finance settings
  /** Currency symbol override (e.g. ₽, $, €). Empty = locale default. */
  financeCurrency?: string;
  /** Folder for month-summary MD export. Empty = vault root. */
  financeExportFolder?: string;
  /** Folder for month-summary Excel export. Empty = falls back to financeExportFolder, then vault root. */
  financeExcelExportFolder?: string;
  /** AI tips section inside the month summary (requires Ollama). */
  aiFinanceInsightsEnabled?: boolean;

  // GitHub Gist sync settings
  githubToken?: string;
  gistId?: string;
  gistUrl?: string;
  gistRawUrl?: string;
  gistAutoSync?: boolean;

  // Appearance
  accentColor?: string;
  glassBgColor?: string;
  glassOpacity?: number;

  // Overdue task carry-over
  carryOverOverdue?: boolean;
  /** When false, moving a task to «В работе» does not auto-start the work timer. */
  autoStartTimerOnWork?: boolean;

  // Color settings
  bgColor?: string;
  surfaceColor?: string;
  surface2Color?: string;
  surfaceHoverColor?: string;
  successColor?: string;
  dangerColor?: string;
  warningColor?: string;
  amberColor?: string;
  glassBorderColor?: string;
  glassHighlightColor?: string;
  textColor?: string;
  textMutedColor?: string;
  textFaintColor?: string;

  // Schedule display settings
  scheduleShowTime: boolean;
  scheduleShowStatus: boolean;
  scheduleShowPriority: boolean;
  scheduleShowWorkBadge: boolean;
  scheduleShowNoteBadge: boolean;
  scheduleShowDeadline: boolean;
  scheduleShowOverdue: boolean;
  scheduleShowDescription: boolean;
  scheduleShowNowIndicator: boolean;
  scheduleShowDeadlineEvents: boolean;

  // Weather settings
  weatherEnabled: boolean;
  weatherLatitude: number;
  weatherLongitude: number;
  weatherProvider?: string; // WeatherProvider: 'open-meteo' | 'openweathermap' | 'weatherapi' | 'visual-crossing'
  weatherApiKey?: string;

  // Status bar
  showStatusBar: boolean;
  dtwShowOnAllPages: boolean;

  // Ollama AI settings
  ollamaEnabled: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  /** "single" — one model for all roles; "dual" — separate model for structured extraction. */
  ollamaModelMode?: "single" | "dual";
  /** Model for structured extraction (JSON parsing). Used only in "dual" mode. */
  ollamaModelExtract?: string;
  ollamaContextSize: number;
  /** Извлечение задач из заметок (ПКМ → заметка) */
  aiExtractEnabled: boolean;
  /** Саммари заметок (ПКМ → папка / выделение) */
  aiSummaryEnabled: boolean;
  /** Разбить задачу на подзадачи (ПКМ → задача) */
  aiSubtasksEnabled: boolean;
  /** Кнопка «Действия с ИИ» в расписании */
  aiScheduleActionsEnabled?: boolean;
  /** Умное быстрое добавление задач (ИИ: работа / заметка / повтор / мульти) */
  aiQuickAddEnabled: boolean;
  /** Предварительное согласование AI-задач перед добавлением */
  aiConfirmBeforeAdd: boolean;
  /** Стиль саммари заметок */
  aiSummaryStyle?: "brief" | "detailed" | "bullets" | "executive";
  /** Доп. инструкции к промпту саммари */
  aiSummaryPrompt?: string;
  /** AI workout plan generator */
  aiWorkoutEnabled: boolean;
  /** Answers to the workout questionnaire (reused across plans). */
  workoutProfile?: import("./workout/types").WorkoutProfile;
  /** Habit id used for workout streaks. */
  workoutHabitId?: string;
}

export const defaultSettings = Object.freeze({
  shouldConfirmBeforeCreate: true,

  wordsPerDot: DEFAULT_WORDS_PER_DOT,

  language: "system" as const,
  startOfWeek: "system" as const,

  calendarInMainView: false,

  showWeeklyNote: false,
  weeklyNoteFormat: "",
  weeklyNoteTemplate: "",
  weeklyNoteFolder: "",

  localeOverride: "system-default",

  dashboardShowTasks: true,
  dashboardShowHabits: true,
  dashboardShowGoals: true,
  helloShowTasksBtn: true,
  helloShowAnalyticsBtn: true,
  helloShowFinanceBtn: true,
  helloShowScheduleBtn: true,
  helloShowSearch: true,
  helloShowWeight: true,
  helloNavOrder: ["tasks", "analytics", "finance", "schedule"],

  taskTrackerCollapsed: false,

  autoCleanupThreshold: 180,
  timeLogCleanupThreshold: 180,

  showHabitTracker: true,
  habitTrackerMode: "separate" as const,
  habitLogCleanupThreshold: 1000,
  weightControlEnabled: true,
  viewSwitcherMode: "everywhere" as const,
  defaultKanbanBoardId: "default",

  syncToVault: true,
  syncConflictCleanupEnabled: true,

  notificationsEnabled: false,
  reminderMinutesBefore: 5,
  checkIntervalMs: 60000,
  notifyReminders: true,
  notifyOverdue: true,
  notifyEstimateExceeded: true,
  notifyDeadlines: true,

  ntfyEnabled: false,
  ntfyTopic: "",
  ntfyScheduledEnabled: false,
  ntfyDailyDigestEnabled: false,
  ntfyDigestTime: "06:00",

  checkPluginUpdates: true,

  defaultPaymentType: "hour" as const,
  defaultRate: 0,

  financeCurrency: "",
  financeExportFolder: "",
  financeExcelExportFolder: "",
  aiFinanceInsightsEnabled: true,

  accentColor: "#5f99e1",
  glassBgColor: "#1e2332",
  glassOpacity: 55,

  carryOverOverdue: true,
  autoStartTimerOnWork: true,

  // Color defaults
  bgColor: "#0E0F13",
  surfaceColor: "#171A21",
  surface2Color: "#1E222B",
  surfaceHoverColor: "#252A36",
  successColor: "#3DD68C",
  dangerColor: "#F06565",
  warningColor: "#F5A623",
  amberColor: "#F5A623",
  glassBorderColor: "rgba(255, 255, 255, 0.06)",
  glassHighlightColor: "rgba(255, 255, 255, 0.02)",
  textColor: "#E8ECF0",
  textMutedColor: "#b7b8bb",
  textFaintColor: "#3A3F4B",

  scheduleShowTime: true,
  scheduleShowStatus: true,
  scheduleShowPriority: true,
  scheduleShowWorkBadge: true,
  scheduleShowNoteBadge: true,
  scheduleShowDeadline: true,
  scheduleShowOverdue: true,
  scheduleShowDescription: true,
  scheduleShowNowIndicator: true,
  scheduleShowDeadlineEvents: true,

  weatherEnabled: false,
  weatherLatitude: 55.75,
  weatherLongitude: 37.62,

  showStatusBar: true,
  dtwShowOnAllPages: false,

  // Ollama AI defaults
  ollamaEnabled: false,
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  ollamaModelMode: "single" as const,
  ollamaModelExtract: "",
  ollamaContextSize: 0,
  aiExtractEnabled: true,
  aiSummaryEnabled: true,
  aiSubtasksEnabled: true,
  aiScheduleActionsEnabled: true,
  aiQuickAddEnabled: true,
  aiConfirmBeforeAdd: true,
  aiSummaryStyle: "detailed" as const,
  aiSummaryPrompt: "", // 0 = unlimited
  aiWorkoutEnabled: true,
});

export function applyAccentColor(hex: string): void {
  const root = document.documentElement;
  // Parse hex to rgb
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  root.style.setProperty("--mcp-accent", `rgba(${r}, ${g}, ${b}, 0.55)`);
  root.style.setProperty("--mcp-accent-dim", `rgba(${r}, ${g}, ${b}, 0.10)`);
  root.style.setProperty("--mcp-accent-faint", `rgba(${r}, ${g}, ${b}, 0.15)`);
  root.style.setProperty(
    "--mcp-accent-ultra-dim",
    `rgba(${r}, ${g}, ${b}, 0.08)`,
  );
  root.style.setProperty("--mcp-accent-hover", `rgba(${r}, ${g}, ${b}, 0.18)`);
  root.style.setProperty("--mcp-accent-glow", `rgba(${r}, ${g}, ${b}, 0.18)`);

  // Also set Obsidian's --interactive-accent so finance/analytics views follow the color
  root.style.setProperty(
    "--interactive-accent",
    `rgba(${r}, ${g}, ${b}, 0.55)`,
  );
  root.style.setProperty("--text-accent", `rgba(${r}, ${g}, ${b}, 0.9)`);

  // Calendar nav arrows and title
  root.style.setProperty("--color-arrow", `rgba(${r}, ${g}, ${b}, 0.7)`);
  root.style.setProperty("--color-text-title", `rgba(${r}, ${g}, ${b}, 0.9)`);
}

export function applyGlassBgColor(hex: string, opacity?: number): void {
  const root = document.documentElement;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const alpha = opacity != null ? opacity / 100 : 0.55;

  root.style.setProperty("--mcp-glass-bg", `rgba(${r}, ${g}, ${b}, ${alpha})`);
  root.style.setProperty(
    "--mcp-glass-highlight",
    `rgba(${r + 5}, ${g + 5}, ${b + 5}, ${Math.max(0.01, alpha * 0.05)})`,
  );
}

export function applyAllColors(options: ISettings): void {
  const root = document.documentElement;

  const setIfHas = (cssVar: string, value?: string) => {
    if (value) root.style.setProperty(cssVar, value);
  };

  setIfHas("--mcp-bg", options.bgColor);
  setIfHas("--mcp-surface", options.surfaceColor);
  setIfHas("--mcp-surface-2", options.surface2Color);
  setIfHas("--mcp-surface-hover", options.surfaceHoverColor);
  setIfHas("--mcp-success", options.successColor);
  setIfHas("--mcp-danger", options.dangerColor);
  setIfHas("--mcp-warning", options.warningColor);
  setIfHas("--mcp-amber", options.amberColor);
  setIfHas("--mcp-text", options.textColor);
  setIfHas("--mcp-text-muted", options.textMutedColor);
  setIfHas("--mcp-text-faint", options.textFaintColor);

  if (options.glassBorderColor) {
    root.style.setProperty("--mcp-glass-border", options.glassBorderColor);
  }
  if (options.glassHighlightColor) {
    root.style.setProperty("--mcp-glass-highlight", options.glassHighlightColor);
  }
}

export function appHasPeriodicNotesPluginLoaded(): boolean {
  // Undocumented periodic-notes plugin API
  const appWithPlugins = window.app as unknown as {
    plugins: {
      getPlugin: (id: string) => {
        settings?: { weekly?: { enabled?: boolean } };
      };
    };
  };
  const periodicNotes = appWithPlugins.plugins.getPlugin("periodic-notes");
  return !!periodicNotes?.settings?.weekly?.enabled;
}

export class CalendarSettingsTab extends PluginSettingTab {
  private plugin: CalendarPlugin;
  private activeTab = "general";
  private ntfyTopicText: TextComponent | null = null;

  constructor(app: App, plugin: CalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    // Rich custom UI (tabs, banners, color pickers) is imperative, so it is
    // mounted from a single custom row. PluginSettingTab.display() is
    // deprecated since Obsidian 1.13 and must not be used at minAppVersion 1.13.
    return [
      {
        type: "group",
        cls: "worklife-settings-host",
        items: [
          {
            name: tRaw("settings.general.tabGeneral"),
            searchable: false,
            render: (setting: Setting) => {
              this.renderInto(setting.settingEl);
            },
          },
        ],
      },
    ];
  }

  private renderInto(host: HTMLElement): void {
    host.empty();
    host.addClass("worklife-settings-ui");
    this.render(host);
  }

  /** Card-style section: icon + title + optional desc, returns body for settings rows. */
  private section(
    parent: HTMLElement,
    opts: { title: string; desc?: string; icon?: string; tone?: "default" | "warning" | "accent" },
  ): HTMLElement {
    const card = parent.createDiv({
      cls: `wl-settings-card${opts.tone && opts.tone !== "default" ? ` wl-settings-card--${opts.tone}` : ""}`,
    });
    const head = card.createDiv({ cls: "wl-settings-card-head" });
    if (opts.icon) {
      const iconEl = head.createDiv({ cls: "wl-settings-card-icon" });
      setIcon(iconEl, opts.icon);
    }
    const titles = head.createDiv({ cls: "wl-settings-card-titles" });
    titles.createDiv({ cls: "wl-settings-card-title", text: opts.title });
    if (opts.desc) {
      titles.createDiv({ cls: "wl-settings-card-desc", text: opts.desc });
    }
    return card.createDiv({ cls: "wl-settings-card-body" });
  }

  /** Compact note / callout under a section. */
  private note(parent: HTMLElement, text: string, cls = "wl-settings-note"): HTMLElement {
    const el = parent.createDiv({ cls });
    el.setText(text);
    return el;
  }

  /** Code sample block (```hello``` / ```dashboard```). */
  private codeSample(parent: HTMLElement, code: string): HTMLElement {
    const pre = parent.createEl("pre", { cls: "mcp-code-block wl-settings-code" });
    pre.createEl("code", { text: code });
    return pre;
  }

  private render(containerEl: HTMLElement = this.containerEl): void {
    containerEl.empty();

    if (!appHasDailyNotesPluginLoaded()) {
      const banner = containerEl.createDiv({ cls: "wl-settings-banner wl-settings-banner--warn" });
      banner.createDiv({
        cls: "wl-settings-banner-title",
        text: tRaw("settings.general.dailyNotesWarning"),
      });
      banner.createEl("p", {
        cls: "wl-settings-banner-desc",
        text: tRaw("settings.general.dailyNotesWarningDesc"),
      });
    }

    // ── Tab shell: icon rail + content ──
    const shell = containerEl.createDiv({ cls: "wl-settings-shell" });
    const tabBar = shell.createDiv({ cls: "wl-settings-tabs" });
    const tabs: { key: string; label: string; icon: string }[] = [
      { key: "general", label: tRaw("settings.tabs.general"), icon: "sliders-horizontal" },
      { key: "interface", label: tRaw("settings.tabs.interface"), icon: "layout-dashboard" },
      { key: "dashboard", label: tRaw("settings.tabs.dashboard"), icon: "gauge" },
      { key: "schedule", label: tRaw("settings.tabs.schedule"), icon: "calendar-days" },
      { key: "finance", label: tRaw("settings.tabs.finance"), icon: "wallet" },
      { key: "weather", label: tRaw("settings.tabs.weather"), icon: "cloud-sun" },
      { key: "appearance", label: tRaw("settings.tabs.appearance"), icon: "palette" },
      { key: "sync", label: tRaw("settings.tabs.sync"), icon: "refresh-cw" },
      { key: "notifications", label: tRaw("settings.tabs.notifications"), icon: "bell" },
      { key: "ai", label: tRaw("settings.tabs.ai"), icon: "sparkles" },
    ];

    const tabButtons: Record<string, HTMLButtonElement> = {};
    const tabContainers: Record<string, HTMLDivElement> = {};
    const contentWrap = shell.createDiv({ cls: "wl-settings-content" });

    for (const tab of tabs) {
      const btn = tabBar.createEl("button", {
        cls: "wl-settings-tab",
        attr: { type: "button", "data-tab": tab.key },
      });
      const iconEl = btn.createSpan({ cls: "wl-settings-tab-icon" });
      setIcon(iconEl, tab.icon);
      btn.createSpan({ cls: "wl-settings-tab-label", text: tab.label });
      tabButtons[tab.key] = btn;
      btn.addEventListener("click", () => this.switchTab(tab.key));
    }

    for (const tab of tabs) {
      const container = contentWrap.createDiv({
        cls: "wl-settings-panel",
      });
      container.style.display = tab.key === this.activeTab ? "" : "none";
      const descKey = `settings.tabs.${tab.key}Desc`;
      const desc = tRaw(descKey);
      if (desc && desc !== descKey) {
        container.createEl("p", { cls: "wl-settings-panel-desc", text: desc });
      }
      tabContainers[tab.key] = container;
    }

    tabButtons[this.activeTab]?.addClass("active");

    // ── General ──
    const general = tabContainers["general"];

    const identity = this.section(general, {
      title: tRaw("settings.general.sectionIdentity"),
      desc: tRaw("settings.general.sectionIdentityDesc"),
      icon: "user-round",
    });

    this.addUserNameSetting(identity);

    new Setting(identity)
      .setName(tRaw("settings.general.languageLabel"))
      .setDesc(tRaw("settings.general.languageDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("system", tRaw("settings.general.languageSystem"));
        dropdown.addOption("ru", tRaw("settings.general.languageRu"));
        dropdown.addOption("en", tRaw("settings.general.languageEn"));
        dropdown.setValue(this.plugin.options.language || "system");
        dropdown.onChange(async (value: "ru" | "en" | "system") => {
          await this.plugin.writeOptions({ language: value });
          initLocale(value);
          this.render();
          new Notice(tRaw("settings.language.restartNotice"));
        });
      });

    new Setting(identity)
      .setName(tRaw("settings.general.startOfWeekLabel"))
      .setDesc(tRaw("settings.general.startOfWeekDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("system", tRaw("settings.general.startOfWeekSystem"));
        dropdown.addOption("monday", tRaw("settings.general.startOfWeekMonday"));
        dropdown.addOption("sunday", tRaw("settings.general.startOfWeekSunday"));
        dropdown.setValue(this.plugin.options.startOfWeek || "system");
        dropdown.onChange(async (value: "monday" | "sunday" | "system") => {
          await this.plugin.writeOptions({ startOfWeek: value });
        });
      });

    const updates = this.section(general, {
      title: tRaw("settings.general.sectionUpdates"),
      desc: tRaw("settings.update.checkEnabledDesc"),
      icon: "download",
    });
    new Setting(updates)
      .setName(tRaw("settings.update.checkEnabled"))
      .setDesc(tRaw("settings.update.checkEnabledDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.checkPluginUpdates !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ checkPluginUpdates: value });
        });
      });
    const updateRow = updates.createDiv({ cls: "wl-settings-actions" });
    new Setting(updateRow)
      .setName(tRaw("settings.update.checkNow"))
      .addButton((btn) => {
        btn.setButtonText(tRaw("settings.update.checkNow"));
        btn.onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText(tRaw("settings.update.checking"));
          try {
            const latest = await checkForPluginUpdate(this.plugin, { force: true });
            const current = this.plugin.manifest.version;
            if (!latest) {
              new Notice(tRaw("settings.update.upToDate", { version: current }));
            }
          } catch {
            new Notice(tRaw("settings.update.checkFailed"));
          } finally {
            btn.setDisabled(false);
            btn.setButtonText(tRaw("settings.update.checkNow"));
          }
        });
      })
      .addButton((btn) => {
        const setEnabled = (enabled: boolean) => {
          btn.setDisabled(!enabled);
          btn.buttonEl.toggleClass("is-disabled", !enabled);
          btn.buttonEl.toggleClass("mod-cta", enabled);
          btn.setButtonText(tRaw("settings.update.updateNow"));
        };
        setEnabled(Boolean(get(pluginUpdateInfo).version));
        const unsub = pluginUpdateInfo.subscribe((info) => {
          setEnabled(Boolean(info.version));
        });
        btn.onClick(async () => {
          if (btn.disabled) return;
          btn.setDisabled(true);
          btn.setButtonText(tRaw("settings.update.updating"));
          try {
            const latest = await fetchLatestRelease();
            const current = this.plugin.manifest.version;
            if (!latest) {
              new Notice(tRaw("settings.update.checkFailed"));
              return;
            }
            if (compareVersions(latest.version, current) <= 0) {
              new Notice(tRaw("settings.update.upToDate", { version: current }));
              return;
            }
            const result = await updatePluginNow(this.plugin, latest);
            if (result.ok) {
              new Notice(tRaw("settings.update.updateSuccess", { version: latest.version }));
              if (result.error === "reload-required") {
                new Notice(tRaw("settings.update.reloadRequired"));
              }
            } else {
              new Notice(`${tRaw("settings.update.updateFailed")}: ${result.error || ""}`);
            }
          } catch {
            new Notice(tRaw("settings.update.updateFailed"));
          } finally {
            setEnabled(Boolean(get(pluginUpdateInfo).version));
          }
        });
        void unsub;
      });

    const dataCard = this.section(general, {
      title: tRaw("settings.general.sectionDataCleanup"),
      desc: tRaw("settings.general.sectionDataCleanupDesc"),
      icon: "database",
    });
    this.addDataCleanupSettings(dataCard);

    // ── Interface ──
    const iface = tabContainers["interface"];

    const panels = this.section(iface, {
      title: tRaw("settings.general.sectionPanels"),
      desc: tRaw("settings.general.sectionPanelsDesc"),
      icon: "panel-top",
    });
    this.addShowStatusBarSetting(panels);
    this.addDtwShowOnAllPagesSetting(panels);
    this.addViewSwitcherModeSetting(panels);
    this.addHabitTrackerModeSetting(panels);
    this.addWeightControlSetting(panels);

    const taskBehavior = this.section(iface, {
      title: tRaw("settings.general.sectionTaskBehavior"),
      desc: tRaw("settings.general.sectionTaskBehaviorDesc"),
      icon: "list-checks",
    });
    this.addCarryOverOverdueSetting(taskBehavior);

    // ── Dashboard ──
    const dashboard = tabContainers["dashboard"];

    const widgets = this.section(dashboard, {
      title: tRaw("settings.dashboard.sectionWidgets"),
      desc: tRaw("settings.dashboard.sectionWidgetsDesc"),
      icon: "layout-grid",
    });
    new Setting(widgets)
      .setName(tRaw("settings.dashboard.showTasks"))
      .setDesc(tRaw("settings.dashboard.showTasksDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.dashboardShowTasks !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ dashboardShowTasks: value });
        });
      });
    new Setting(widgets)
      .setName(tRaw("settings.dashboard.showHabits"))
      .setDesc(tRaw("settings.dashboard.showHabitsDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.dashboardShowHabits !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ dashboardShowHabits: value });
        });
      });
    new Setting(widgets)
      .setName(tRaw("settings.dashboard.showGoals"))
      .setDesc(tRaw("settings.dashboard.showGoalsDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.dashboardShowGoals !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ dashboardShowGoals: value });
        });
      });

    const helloCard = this.section(dashboard, {
      title: tRaw("settings.dashboard.sectionHello"),
      desc: tRaw("settings.general.sectionHelloDesc"),
      icon: "hand",
    });
    this.addHelloButtonSettings(helloCard);

    const dashBlock = this.section(dashboard, {
      title: tRaw("settings.dashboard.blockTitle"),
      desc: tRaw("settings.dashboard.blockDesc"),
      icon: "code-2",
    });
    this.codeSample(dashBlock, "```dashboard\n```");
    this.note(dashBlock, tRaw("settings.dashboard.blockHint"));

    // ── Schedule ──
    const schedule = tabContainers["schedule"];
    const scheduleCard = this.section(schedule, {
      title: tRaw("settings.schedule.sectionDisplay"),
      desc: tRaw("settings.schedule.sectionDisplayDesc"),
      icon: "eye",
    });
    this.addScheduleDisplaySettings(scheduleCard);

    // ── Finance ──
    const finance = tabContainers["finance"];
    this.addFinanceSettings(finance);

    // ── Weather ──
    const weather = tabContainers["weather"];
    this.addWeatherSettings(weather);

    // ── Appearance ──
    const appearance = tabContainers["appearance"];

    const quick = this.section(appearance, {
      title: tRaw("settings.appearance.sectionQuick"),
      desc: tRaw("settings.appearance.intro"),
      icon: "sparkles",
    });
    this.addAccentColorSetting(quick);
    this.addGlassBgColorSetting(quick);

    const advanced = this.section(appearance, {
      title: tRaw("settings.appearance.sectionAdvanced"),
      desc: tRaw("settings.appearance.sectionAdvancedDesc"),
      icon: "palette",
    });
    this.addColorSettings(advanced);

    // ── Sync ──
    const sync = tabContainers["sync"];

    const vaultCard = this.section(sync, {
      title: tRaw("settings.sync.sectionVault"),
      desc: tRaw("settings.sync.sectionVaultDesc"),
      icon: "hard-drive",
    });
    this.addSyncConflictCleanupSetting(vaultCard);

    this.addGitHubGistSettings(sync);

    // ── Notifications ──
    const notif = tabContainers["notifications"];
    this.addNotificationSettings(notif);

    // ── AI ──
    const ai = tabContainers["ai"];
    this.addOllamaSettings(ai);

    // Support footer (quiet, after all tabs)
    const footer = containerEl.createDiv({ cls: "wl-settings-footer" });
    const footerText = footer.createDiv({ cls: "wl-settings-footer-text" });
    footerText.createDiv({
      cls: "wl-settings-footer-title",
      text: tRaw("settings.general.supportTitle"),
    });
    footerText.createEl("p", {
      cls: "wl-settings-footer-desc",
      text: tRaw("settings.general.supportDesc"),
    });
    const footerActions = footer.createDiv({ cls: "wl-settings-footer-actions" });
    const coffeeBtn = footerActions.createEl("a", {
      cls: "wl-settings-footer-btn",
      text: tRaw("settings.general.supportBtn"),
      href: "https://boosty.to/atins/donate",
    });
    coffeeBtn.setAttribute("target", "_blank");
    coffeeBtn.setAttribute("rel", "noopener");
    const starBtn = footerActions.createEl("a", {
      cls: "wl-settings-footer-btn wl-settings-footer-btn--ghost",
      text: tRaw("settings.general.githubStarBtn"),
      href: "https://github.com/AtinsS/WorkLife-Calendar-for-Obsidian",
    });
    starBtn.setAttribute("target", "_blank");
    starBtn.setAttribute("rel", "noopener");

    this._tabButtons = tabButtons;
    this._tabContainers = tabContainers;
  }

  private _tabButtons: Record<string, HTMLButtonElement> = {};
  private _tabContainers: Record<string, HTMLDivElement> = {};

  private switchTab(key: string): void {
    this.activeTab = key;
    for (const [k, btn] of Object.entries(this._tabButtons)) {
      btn.toggleClass("active", k === key);
    }
    for (const [k, container] of Object.entries(this._tabContainers)) {
      container.style.display = k === key ? "" : "none";
    }
  }

  addUserNameSetting(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.userName"))
      .setDesc(tRaw("settings.general.userNameDesc"))
      .addText((text) => {
        text
          .setPlaceholder(tRaw("settings.general.userNamePlaceholder"))
          .setValue(this.plugin.options.userName || "")
          .onChange(async (value) => {
            await this.plugin.writeOptions({ userName: value });
          });
        text.inputEl.addClass("mcp-input-lg");
      });
  }

  addHelloButtonSettings(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.showTasksBtn"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.helloShowTasksBtn !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ helloShowTasksBtn: value });
        });
      });

    new Setting(container)
      .setName(tRaw("settings.general.showAnalyticsBtn"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.helloShowAnalyticsBtn !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ helloShowAnalyticsBtn: value });
        });
      });

    new Setting(container)
      .setName(tRaw("settings.general.showFinanceBtn"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.helloShowFinanceBtn !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ helloShowFinanceBtn: value });
        });
      });

    new Setting(container)
      .setName(tRaw("settings.general.showScheduleBtn"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.helloShowScheduleBtn !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ helloShowScheduleBtn: value });
        });
      });

    new Setting(container)
      .setName(tRaw("settings.general.showSearch"))
      .setDesc(tRaw("settings.general.showSearchDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.helloShowSearch !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ helloShowSearch: value });
        });
      });

    new Setting(container)
      .setName(tRaw("settings.general.showWeight"))
      .setDesc(tRaw("settings.general.showWeightDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.helloShowWeight !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ helloShowWeight: value });
        });
      });

    this.note(container, tRaw("settings.general.helloBlockDesc"));
    this.codeSample(container, "```hello\n```");
    this.note(container, tRaw("settings.general.helloBlockHint"));
  }

  addShowStatusBarSetting(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.statusBar"))
      .setDesc(tRaw("settings.general.statusBarDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.showStatusBar);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ showStatusBar: value });
          // Toggle visibility in real-time
          const el = document.querySelector(".mcp-dtw-global");
          if (el) (el as HTMLElement).style.display = value ? "" : "none";
        });
      });
  }

  addDtwShowOnAllPagesSetting(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.statusBarAllPages"))
      .setDesc(tRaw("settings.general.statusBarAllPagesDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.dtwShowOnAllPages);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ dtwShowOnAllPages: value });
        });
      });
  }

  addHabitTrackerModeSetting(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.habitTrackerMode"))
      .setDesc(tRaw("settings.general.habitTrackerModeDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("separate", tRaw("settings.general.habitModeSeparate"));
        dropdown.addOption("hidden", tRaw("settings.general.habitModeHidden"));
        // Старый режим "panel" → "separate" (привычки больше не в панели задач)
        const raw = this.plugin.options.habitTrackerMode;
        const current = raw === "hidden" ? "hidden" : "separate";
        dropdown.setValue(current);
        dropdown.onChange(async (value: string) => {
          await this.plugin.writeOptions({
            habitTrackerMode: value === "hidden" ? "hidden" : "separate",
          });
        });
      });
  }

  addViewSwitcherModeSetting(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.viewSwitcherMode"))
      .setDesc(tRaw("settings.general.viewSwitcherModeDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("everywhere", tRaw("settings.general.viewSwitcherEverywhere"));
        dropdown.addOption("desktop", tRaw("settings.general.viewSwitcherDesktop"));
        dropdown.addOption("mobile", tRaw("settings.general.viewSwitcherMobile"));
        dropdown.addOption("hidden", tRaw("settings.general.viewSwitcherHidden"));
        const raw = this.plugin.options.viewSwitcherMode;
        dropdown.setValue(
          raw === "desktop" || raw === "mobile" || raw === "hidden" ? raw : "everywhere",
        );
        dropdown.onChange(async (value: string) => {
          await this.plugin.writeOptions({
            viewSwitcherMode:
              value === "desktop" || value === "mobile" || value === "hidden"
                ? value
                : "everywhere",
          });
        });
      });
  }

  addWeightControlSetting(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.weightControl"))
      .setDesc(tRaw("settings.general.weightControlDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.weightControlEnabled !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ weightControlEnabled: value });
        });
      });
  }

  private getVaultFolders(): string[] {
    const folders: string[] = [];
    const root = this.app.vault.getRoot();
    const walk = (folder: TFolder) => {
      for (const child of folder.children || []) {
        if (child instanceof TFolder) {
          folders.push(child.path);
          walk(child);
        }
      }
    };
    walk(root);
    return folders.sort();
  }

  addScheduleDisplaySettings(container: HTMLElement): void {
    const opts = this.plugin.options;
    const items: { key: string; name: string; desc: string }[] = [
      {
        key: "scheduleShowTime",
        name: tRaw("settings.schedule.showTime"),
        desc: tRaw("settings.schedule.showTimeDesc"),
      },
      {
        key: "scheduleShowStatus",
        name: tRaw("settings.schedule.showStatus"),
        desc: tRaw("settings.schedule.showStatusDesc"),
      },
      {
        key: "scheduleShowPriority",
        name: tRaw("settings.schedule.showPriority"),
        desc: tRaw("settings.schedule.showPriorityDesc"),
      },
      {
        key: "scheduleShowWorkBadge",
        name: tRaw("settings.schedule.showWorkBadge"),
        desc: tRaw("settings.schedule.showWorkBadgeDesc"),
      },
      {
        key: "scheduleShowNoteBadge",
        name: tRaw("settings.schedule.showNoteBadge"),
        desc: tRaw("settings.schedule.showNoteBadgeDesc"),
      },
      {
        key: "scheduleShowDeadline",
        name: tRaw("settings.schedule.showDeadline"),
        desc: tRaw("settings.schedule.showDeadlineDesc"),
      },
      {
        key: "scheduleShowOverdue",
        name: tRaw("settings.schedule.showOverdue"),
        desc: tRaw("settings.schedule.showOverdueDesc"),
      },
      {
        key: "scheduleShowDescription",
        name: tRaw("settings.schedule.showDescription"),
        desc: tRaw("settings.schedule.showDescriptionDesc"),
      },
      {
        key: "scheduleShowNowIndicator",
        name: tRaw("settings.schedule.showNowIndicator"),
        desc: tRaw("settings.schedule.showNowIndicatorDesc"),
      },
      {
        key: "scheduleShowDeadlineEvents",
        name: tRaw("settings.schedule.showDeadlineEvents"),
        desc: tRaw("settings.schedule.showDeadlineEventsDesc"),
      },
    ];
    for (const item of items) {
      new Setting(container)
        .setName(item.name)
        .setDesc(item.desc)
        .addToggle((toggle) => {
          toggle.setValue(opts[item.key as keyof typeof opts] as boolean);
          toggle.onChange(async (value) => {
            await this.plugin.writeOptions({ [item.key]: value });
          });
        });
    }
  }

  addWeatherSettings(container: HTMLElement): void {
    const opts = this.plugin.options;

    const weatherCard = this.section(container, {
      title: tRaw("settings.weather.showWeather"),
      desc: tRaw("settings.weather.showWeatherDesc"),
      icon: "cloud-sun",
    });

    new Setting(weatherCard)
      .setName(tRaw("settings.weather.showWeather"))
      .setDesc(tRaw("settings.weather.showWeatherDesc"))
      .addToggle((toggle) => {
        toggle.setValue(opts.weatherEnabled);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ weatherEnabled: value });
        });
      });

    new Setting(weatherCard)
      .setName(tRaw("settings.weather.provider"))
      .setDesc(tRaw("settings.weather.providerDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("open-meteo", tRaw("settings.weather.providerOpenMeteo"));
        dropdown.addOption("openweathermap", tRaw("settings.weather.providerOpenWeatherMap"));
        dropdown.addOption("weatherapi", tRaw("settings.weather.providerWeatherAPI"));
        dropdown.addOption("visual-crossing", tRaw("settings.weather.providerVisualCrossing"));
        dropdown.setValue(opts.weatherProvider || "open-meteo");
        dropdown.onChange(async (value) => {
          await this.plugin.writeOptions({ weatherProvider: value });
          this.render(); // refresh to show/hide API key field
        });
      });

    const provider = (opts.weatherProvider || "open-meteo") as WeatherProvider;
    const needsKey = provider !== "open-meteo";

    // Attribution notice
    const attribution = getWeatherAttribution(provider);
    if (attribution) {
      this.note(weatherCard, attribution);
    }

    // WeatherAPI disclaimer (required by their TOS)
    if (provider === "weatherapi") {
      this.note(weatherCard, tRaw("settings.weather.disclaimer"));
    }

    if (needsKey) {
      const providerNames: Record<string, string> = {
        "openweathermap": "OpenWeatherMap (openweathermap.org)",
        "weatherapi": "WeatherAPI (weatherapi.com)",
        "visual-crossing": "Visual Crossing (visualcrossing.com)",
      };
      new Setting(weatherCard)
        .setName(tRaw("settings.weather.apiKey"))
        .setDesc(tRaw("settings.weather.apiKeyDesc", { provider: providerNames[provider] || provider }))
        .addText((text) => {
          text
            .setPlaceholder(tRaw("settings.weather.apiKeyPlaceholder"))
            .setValue(opts.weatherApiKey || "")
            .onChange(async (value) => {
              await this.plugin.writeOptions({ weatherApiKey: value });
            });
          text.inputEl.type = "password";
          text.inputEl.addClass("mcp-input-xl");
        });
    }

    new Setting(weatherCard)
      .setName(tRaw("settings.weather.latitude"))
      .setDesc(tRaw("settings.weather.latitudeDesc"))
      .addText((text) => {
        text
          .setPlaceholder("55.75")
          .setValue(String(opts.weatherLatitude ?? 55.75))
          .onChange(async (value) => {
            const num = parseFloat(value);
            if (!isNaN(num) && num >= -90 && num <= 90) {
              await this.plugin.writeOptions({ weatherLatitude: num });
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "-90";
        text.inputEl.max = "90";
        text.inputEl.step = "0.01";
        text.inputEl.addClass("mcp-input-md");
      });

    new Setting(weatherCard)
      .setName(tRaw("settings.weather.longitude"))
      .setDesc(tRaw("settings.weather.longitudeDesc"))
      .addText((text) => {
        text
          .setPlaceholder("37.62")
          .setValue(String(opts.weatherLongitude ?? 37.62))
          .onChange(async (value) => {
            const num = parseFloat(value);
            if (!isNaN(num) && num >= -180 && num <= 180) {
              await this.plugin.writeOptions({ weatherLongitude: num });
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "-180";
        text.inputEl.max = "180";
        text.inputEl.step = "0.01";
        text.inputEl.addClass("mcp-input-md");
      });

    // Test & confirm buttons
    const btnRow = weatherCard.createDiv({ cls: "mcp-btn-row" });

    const testBtn = btnRow.createEl("button", { text: tRaw("settings.weather.checkConnection") });
    testBtn.addClass("mcp-btn");
    testBtn.addEventListener("click", () => {
      void (async () => {
        testBtn.disabled = true;
        testBtn.textContent = tRaw("settings.weather.checking");
        testBtn.removeClass("mcp-color-success", "mcp-color-danger");
        const current = this.plugin.options;
        const lat = current.weatherLatitude ?? 55.75;
        const lon = current.weatherLongitude ?? 37.62;
        const prov = (current.weatherProvider || "open-meteo") as WeatherProvider;
        const key = current.weatherApiKey;
        const today = new Date().toISOString().slice(0, 10);
        try {
          const days = await fetchWeekWeather(lat, lon, today, today, prov, key, { skipCache: true, throwOnError: true });
          if (days.length > 0) {
            testBtn.textContent = `✓ ${days[0].icon} ${days[0].tempMin}..${days[0].tempMax}° ${days[0].label}`;
            testBtn.addClass("mcp-color-success");
          } else {
            testBtn.textContent = tRaw("settings.weather.noData");
            testBtn.addClass("mcp-color-danger");
          }
        } catch (e: unknown) {
          testBtn.textContent = `✗ ${e instanceof Error ? e.message : tRaw("settings.weather.connectionError")}`;
          testBtn.addClass("mcp-color-danger");
        }
        window.setTimeout(() => {
          testBtn.disabled = false;
          testBtn.removeClass("mcp-color-success", "mcp-color-danger");
          testBtn.textContent = tRaw("settings.weather.checkConnection");
        }, 5000);
      })();
    });

    // Weather animation previews
    const previews = this.section(container, {
      title: tRaw("settings.weather.previewTitle"),
      desc: tRaw("settings.weather.previewDesc"),
      icon: "eye",
    });
    this.addWeatherPreviews(previews);
  }

  private addWeatherPreviews(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: "weather-previews" });

    const cards = [
      { cls: "wp-sun", emoji: "☀️", label: tRaw("weather.preview.sunny"), code: "0", anim: "sun" },
      { cls: "wp-partly", emoji: "🌤️", label: tRaw("weather.preview.partly"), code: "1", anim: "partly" },
      { cls: "wp-clouds", emoji: "⛅", label: tRaw("weather.preview.cloudy"), code: "2", anim: "clouds" },
      { cls: "wp-gloom", emoji: "☁️", label: tRaw("weather.preview.overcast"), code: "3", anim: "gloom" },
      { cls: "wp-fog", emoji: "🌫️", label: tRaw("weather.preview.fog"), code: "45,48", anim: "fog" },
      { cls: "wp-rain", emoji: "🌧️", label: tRaw("weather.preview.rain"), code: "51–67", anim: "rain" },
      { cls: "wp-snow", emoji: "🌨️", label: tRaw("weather.preview.snow"), code: "71–77,85", anim: "snow" },
      { cls: "wp-storm", emoji: "⛈️", label: tRaw("weather.preview.storm"), code: "95–99", anim: "storm" },
    ];

    for (const c of cards) {
      const card = wrapper.createDiv({ cls: `wp-card ${c.cls}` });

      if (c.anim === "sun") {
        const sun = card.createDiv({ cls: "wp-sun-obj wp-sun-obj--minimal" });
        sun.createDiv({ cls: "wp-sun-core" });
      }
      if (c.anim === "partly") {
        const sun = card.createDiv({ cls: "wp-sun-obj wp-sun-obj--minimal" });
        sun.createDiv({ cls: "wp-sun-core" });
        for (let i = 0; i < 2; i++) {
          const cl = card.createDiv({ cls: "wp-cloud" });
          cl.style.setProperty("--wp-top", `${25 + i * 28}%`);
          cl.style.setProperty("--wp-delay", `${i * 3.5}s`);
          cl.style.setProperty("--wp-opacity", String(0.12 + Math.random() * 0.1));
        }
      }
      if (c.anim === "clouds") {
        for (let i = 0; i < 3; i++) {
          const cl = card.createDiv({ cls: "wp-cloud" });
          cl.style.setProperty("--wp-top", `${15 + i * 25}%`);
          cl.style.setProperty("--wp-delay", `${i * 3}s`);
          cl.style.setProperty("--wp-opacity", String(0.15 + Math.random() * 0.15));
        }
      }
      if (c.anim === "gloom") {
        card.createDiv({ cls: "wp-gloom-overlay" });
      }
      if (c.anim === "fog") {
        for (let i = 0; i < 4; i++) {
          const fl = card.createDiv({ cls: "wp-fog-layer" });
          fl.style.setProperty("--wp-top", `${10 + i * 20}%`);
          fl.style.setProperty("--wp-delay", `${i * 2}s`);
          fl.style.setProperty("--wp-duration", `${10 + i * 3}s`);
          fl.style.setProperty("--wp-opacity", String(0.15 + i * 0.08));
        }
      }
      if (c.anim === "rain") {
        for (let i = 0; i < 20; i++) {
          const d = card.createDiv({ cls: "wp-drop" });
          d.style.setProperty("--wp-left", `${Math.random() * 100}%`);
          d.style.setProperty("--wp-delay", `${Math.random() * 2}s`);
          d.style.setProperty("--wp-duration", `${0.4 + Math.random() * 0.4}s`);
        }
      }
      if (c.anim === "storm") {
        for (let i = 0; i < 30; i++) {
          const d = card.createDiv({ cls: "wp-drop h" });
          d.style.setProperty("--wp-left", `${Math.random() * 100}%`);
          d.style.setProperty("--wp-delay", `${Math.random() * 1.5}s`);
          d.style.setProperty("--wp-duration", `${0.3 + Math.random() * 0.3}s`);
        }
      }
      if (c.anim === "snow") {
        for (let i = 0; i < 25; i++) {
          const s = card.createDiv({ cls: "wp-snowflake" });
          s.textContent = "*";
          s.style.setProperty("--wp-left", `${Math.random() * 100}%`);
          s.style.setProperty("--wp-delay", `${Math.random() * 4}s`);
          s.style.setProperty("--wp-duration", `${2 + Math.random() * 3}s`);
          s.style.setProperty("--wp-size", `${8 + Math.random() * 8}px`);
          s.style.setProperty("--wp-opacity", String(0.4 + Math.random() * 0.4));
        }
      }

      const emoji = card.createDiv({ cls: "wp-emoji" });
      emoji.textContent = c.emoji;
      const label = card.createDiv({ cls: "wp-label" });
      label.textContent = `${c.label} (${c.code})`;
    }
  }

  addAccentColorSetting(container: HTMLElement): void {
    const currentColor = this.plugin.options.accentColor || "#5f99e1";

    const setting = new Setting(container)
      .setName(tRaw("settings.appearance.accentColor"))
      .setDesc(tRaw("settings.appearance.accentColorDesc"))
      .addColorPicker((picker) => {
        picker.setValue(currentColor).onChange(async (value) => {
          await this.plugin.writeOptions({ accentColor: value });
          applyAccentColor(value);
        });
      });

    // Add a reset button
    setting.addButton((btn) =>
      btn
        .setButtonText(tRaw("common.reset"))
        .setTooltip(tRaw("settings.appearance.resetColors"))
        .onClick(async () => {
          const defaultColor = "#5f99e1";
          await this.plugin.writeOptions({ accentColor: defaultColor });
          applyAccentColor(defaultColor);
          this.render();
        }),
    );
  }

  addGlassBgColorSetting(container: HTMLElement): void {
    const currentColor = this.plugin.options.glassBgColor || "#1e2332";
    const currentOpacity = this.plugin.options.glassOpacity ?? 55;

    const setting = new Setting(container)
      .setName(tRaw("settings.appearance.glassBgColor"))
      .setDesc(tRaw("settings.appearance.glassBgColorDesc"))
      .addColorPicker((picker) => {
        picker.setValue(currentColor).onChange(async (value) => {
          await this.plugin.writeOptions({ glassBgColor: value });
          applyGlassBgColor(value, this.plugin.options.glassOpacity);
        });
      });

    setting.addButton((btn) =>
      btn
        .setButtonText(tRaw("common.reset"))
        .setTooltip(tRaw("settings.appearance.resetColors"))
        .onClick(async () => {
          const defaultColor = "#1e2332";
          await this.plugin.writeOptions({
            glassBgColor: defaultColor,
            glassOpacity: 55,
          });
          applyGlassBgColor(defaultColor, 55);
          this.render();
        }),
    );

    new Setting(container)
      .setName(tRaw("settings.appearance.glassOpacity"))
      .setDesc(tRaw("settings.appearance.glassOpacityDesc", { value: currentOpacity }))
      .addSlider((slider) => {
        slider
          .setLimits(0, 100, 5)
          .setValue(currentOpacity)
          .onChange(async (value) => {
            await this.plugin.writeOptions({ glassOpacity: value });
            applyGlassBgColor(
              this.plugin.options.glassBgColor || "#1e2332",
              value,
            );
            // Update description with current value
            slider.sliderEl
              .closest(".setting-item")
              ?.querySelector(".setting-item-description")
              ?.setText(tRaw("settings.appearance.glassOpacityDesc", { value }));
          });
      });
  }

  addColorSettings(container: HTMLElement): void {
    // Main colors
    const mainColors = this.section(container, {
      title: tRaw("settings.appearance.sectionMainColors"),
      icon: "paint-bucket",
    });

    this.addColorPickerSetting(
      mainColors,
      tRaw("settings.appearance.bgColor"),
      tRaw("settings.appearance.bgColorDesc"),
      "bgColor",
      "#0E0F13"
    );

    this.addColorPickerSetting(
      mainColors,
      tRaw("settings.appearance.surfaceColor"),
      tRaw("settings.appearance.surfaceColorDesc"),
      "surfaceColor",
      "#171A21"
    );

    this.addColorPickerSetting(
      mainColors,
      tRaw("settings.appearance.surface2Color"),
      tRaw("settings.appearance.surface2ColorDesc"),
      "surface2Color",
      "#1E222B"
    );

    this.addColorPickerSetting(
      mainColors,
      tRaw("settings.appearance.surfaceHoverColor"),
      tRaw("settings.appearance.surfaceHoverColorDesc"),
      "surfaceHoverColor",
      "#252A36"
    );

    // Semantic colors
    const semanticColors = this.section(container, {
      title: tRaw("settings.appearance.sectionSemanticColors"),
      icon: "tags",
    });

    this.addColorPickerSetting(
      semanticColors,
      tRaw("settings.appearance.successColor"),
      tRaw("settings.appearance.successColorDesc"),
      "successColor",
      "#3DD68C"
    );

    this.addColorPickerSetting(
      semanticColors,
      tRaw("settings.appearance.dangerColor"),
      tRaw("settings.appearance.dangerColorDesc"),
      "dangerColor",
      "#F06565"
    );

    this.addColorPickerSetting(
      semanticColors,
      tRaw("settings.appearance.warningColor"),
      tRaw("settings.appearance.warningColorDesc"),
      "warningColor",
      "#F5A623"
    );

    this.addColorPickerSetting(
      semanticColors,
      tRaw("settings.appearance.amberColor"),
      tRaw("settings.appearance.amberColorDesc"),
      "amberColor",
      "#F5A623"
    );

    // Text colors
    const textColors = this.section(container, {
      title: tRaw("settings.appearance.sectionTextColors"),
      icon: "type",
    });

    this.addColorPickerSetting(
      textColors,
      tRaw("settings.appearance.textColor"),
      tRaw("settings.appearance.textColorDesc"),
      "textColor",
      "#E8ECF0"
    );

    this.addColorPickerSetting(
      textColors,
      tRaw("settings.appearance.textMutedColor"),
      tRaw("settings.appearance.textMutedColorDesc"),
      "textMutedColor",
      "#b7b8bb"
    );

    this.addColorPickerSetting(
      textColors,
      tRaw("settings.appearance.textFaintColor"),
      tRaw("settings.appearance.textFaintColorDesc"),
      "textFaintColor",
      "#3A3F4B"
    );

    // Glass panel colors
    const glassColors = this.section(container, {
      title: tRaw("settings.appearance.sectionGlass"),
      icon: "layers",
    });

    this.addColorPickerSetting(
      glassColors,
      tRaw("settings.appearance.glassBorderColor"),
      tRaw("settings.appearance.glassBorderColorDesc"),
      "glassBorderColor",
      "rgba(255, 255, 255, 0.06)"
    );

    this.addColorPickerSetting(
      glassColors,
      tRaw("settings.appearance.glassHighlightColor"),
      tRaw("settings.appearance.glassHighlightColorDesc"),
      "glassHighlightColor",
      "rgba(255, 255, 255, 0.02)"
    );

    // Reset all button
    const resetRow = container.createDiv({ cls: "wl-settings-actions" });
    new Setting(resetRow)
      .setName(tRaw("settings.appearance.resetAllColors"))
      .setDesc(tRaw("settings.appearance.resetAllColorsDesc"))
      .addButton((btn) =>
        btn
          .setButtonText(tRaw("settings.appearance.resetAllColors"))
          .setDestructive()
          .onClick(async () => {
            await this.plugin.writeOptions({
              bgColor: "#0E0F13",
              surfaceColor: "#171A21",
              surface2Color: "#1E222B",
              surfaceHoverColor: "#252A36",
              successColor: "#3DD68C",
              dangerColor: "#F06565",
              warningColor: "#F5A623",
              amberColor: "#F5A623",
              glassBorderColor: "rgba(255, 255, 255, 0.06)",
              glassHighlightColor: "rgba(255, 255, 255, 0.02)",
              textColor: "#E8ECF0",
              textMutedColor: "#b7b8bb",
              textFaintColor: "#3A3F4B",
            });
            this.render();
          }),
      );
  }

  private addColorPickerSetting(
    container: HTMLElement,
    name: string,
    desc: string,
    key: string,
    defaultValue: string
  ): void {
    const currentColor = (this.plugin.options as unknown as Record<string, string | undefined>)[key] || defaultValue;

    new Setting(container)
      .setName(name)
      .setDesc(desc)
      .addColorPicker((picker) => {
        picker.setValue(currentColor).onChange(async (value) => {
          await this.plugin.writeOptions({ [key]: value });
          applyAllColors(this.plugin.options);
        });
      })
      .addButton((btn) =>
        btn
          .setButtonText(tRaw("common.reset"))
          .setTooltip(tRaw("settings.appearance.resetColors"))
          .onClick(async () => {
            await this.plugin.writeOptions({ [key]: defaultValue });
            applyAllColors(this.plugin.options);
            this.render();
          })
      );
  }

  addWorkTaskSettings(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.defaultPaymentType"))
      .setDesc(tRaw("settings.general.defaultPaymentTypeDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("hour", tRaw("settings.general.paymentTypeHour"));
        dropdown.addOption("day", tRaw("settings.general.paymentTypeDay"));
        dropdown.setValue(this.plugin.options.defaultPaymentType);
        dropdown.onChange(async (value) => {
          await this.plugin.writeOptions({
            defaultPaymentType: value as "hour" | "day",
          });
        });
      });

    new Setting(container)
      .setName(tRaw("settings.general.defaultRate"))
      .setDesc(tRaw("settings.general.defaultRateDesc"))
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.options.defaultRate || ""))
          .onChange(async (value) => {
            await this.plugin.writeOptions({ defaultRate: parseFloat(value) || 0 });
          });
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.addClass("mcp-input-md");
      });
  }

  /** Finance: currency, work-task defaults, month-summary export folders. */
  addFinanceSettings(container: HTMLElement): void {
    const currency = this.section(container, {
      title: tRaw("settings.finance.sectionCurrency"),
      desc: tRaw("settings.finance.currencyDesc"),
      icon: "coins",
    });

    new Setting(currency)
      .setName(tRaw("settings.finance.currency"))
      .setDesc(tRaw("settings.finance.currencyDesc"))
      .addDropdown((dropdown) => {
        const presets = [
          { value: "", label: tRaw("settings.finance.currencyDefault") },
          { value: "₽", label: "₽ — RUB" },
          { value: "$", label: "$ — USD" },
          { value: "€", label: "€ — EUR" },
          { value: "£", label: "£ — GBP" },
          { value: "₸", label: "₸ — KZT" },
          { value: "₴", label: "₴ — UAH" },
          { value: "₺", label: "₺ — TRY" },
          { value: "¥", label: "¥ — CNY/JPY" },
          { value: "₮", label: "₮ — MNT" },
          { value: "₾", label: "₾ — GEL" },
          { value: "₿", label: "₿ — BTC" },
        ];
        for (const p of presets) dropdown.addOption(p.value, p.label);
        const current = this.plugin.options.financeCurrency ?? "";
        if (current && !presets.some((p) => p.value === current)) {
          dropdown.addOption(current, `${current} — ${tRaw("settings.finance.currencyCustom")}`);
        }
        dropdown.setValue(current);
        dropdown.onChange(async (value) => {
          await this.plugin.writeOptions({ financeCurrency: value });
        });
      });

    new Setting(currency)
      .setName(tRaw("settings.finance.currencyCustom"))
      .setDesc(tRaw("settings.finance.currencyCustomDesc"))
      .addText((text) => {
        text
          .setPlaceholder("₽")
          .setValue(this.plugin.options.financeCurrency ?? "")
          .onChange(async (value) => {
            await this.plugin.writeOptions({ financeCurrency: value.trim() });
          });
        text.inputEl.addClass("mcp-input-md");
      });

    const work = this.section(container, {
      title: tRaw("settings.general.sectionWorkTasks"),
      desc: tRaw("settings.general.sectionWorkTasksDesc"),
      icon: "briefcase",
    });
    this.addWorkTaskSettings(work);

    const exportCard = this.section(container, {
      title: tRaw("settings.finance.sectionExport"),
      desc: tRaw("settings.finance.sectionExportDesc"),
      icon: "folder-output",
    });

    new Setting(exportCard)
      .setName(tRaw("settings.finance.exportFolderMd"))
      .setDesc(tRaw("settings.finance.exportFolderMdDesc"))
      .addText((text) => {
        text
          .setPlaceholder(tRaw("settings.finance.exportFolderPlaceholder"))
          .setValue(this.plugin.options.financeExportFolder ?? "")
          .onChange(async (value) => {
            await this.plugin.writeOptions({ financeExportFolder: value.trim() });
          });
        text.inputEl.addClass("mcp-input-md");
      })
      .addExtraButton((btn) => {
        btn
          .setIcon("folder")
          .setTooltip(tRaw("settings.finance.exportFolderPick"))
          .onClick(() => {
            void import("./modals/FolderSuggestModal").then(({ FolderSuggestModal }) => {
              new FolderSuggestModal(this.app, (folder) => {
                void this.plugin.writeOptions({ financeExportFolder: folder });
                this.render();
              }).open();
            });
          });
      });

    new Setting(exportCard)
      .setName(tRaw("settings.finance.exportFolderExcel"))
      .setDesc(tRaw("settings.finance.exportFolderExcelDesc"))
      .addText((text) => {
        text
          .setPlaceholder(tRaw("settings.finance.exportFolderPlaceholder"))
          .setValue(this.plugin.options.financeExcelExportFolder ?? "")
          .onChange(async (value) => {
            await this.plugin.writeOptions({ financeExcelExportFolder: value.trim() });
          });
        text.inputEl.addClass("mcp-input-md");
      })
      .addExtraButton((btn) => {
        btn
          .setIcon("folder")
          .setTooltip(tRaw("settings.finance.exportFolderPick"))
          .onClick(() => {
            void import("./modals/FolderSuggestModal").then(({ FolderSuggestModal }) => {
              new FolderSuggestModal(this.app, (folder) => {
                void this.plugin.writeOptions({ financeExcelExportFolder: folder });
                this.render();
              }).open();
            });
          });
      });
  }

  addCarryOverOverdueSetting(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.carryOverOverdue"))
      .setDesc(tRaw("settings.general.carryOverOverdueDesc"))
      .addToggle((toggle) => {
        toggle.setValue(!!this.plugin.options.carryOverOverdue);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ carryOverOverdue: value });
        });
      });

    new Setting(container)
      .setName(tRaw("settings.general.autoStartTimerOnWork"))
      .setDesc(tRaw("settings.general.autoStartTimerOnWorkDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.autoStartTimerOnWork !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ autoStartTimerOnWork: value });
        });
      });
  }

  /** Лимиты автоочистки — намеренно вне вкладки «Синхронизация». */
  addDataCleanupSettings(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.general.autoCleanupThreshold"))
      .setDesc(
        tRaw("settings.general.autoCleanupThresholdDesc"),
      )
      .addText((text) => {
        text
          .setPlaceholder("1000")
          .setValue(String(this.plugin.options.autoCleanupThreshold || 1000))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 10) {
              await this.plugin.writeOptions({ autoCleanupThreshold: num });
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "10";
        text.inputEl.max = "10000";
        text.inputEl.addClass("mcp-input-sm");
      });

    new Setting(container)
      .setName(tRaw("settings.general.timeLogCleanupThreshold"))
      .setDesc(
        tRaw("settings.general.timeLogCleanupThresholdDesc"),
      )
      .addText((text) => {
        text
          .setPlaceholder("1000")
          .setValue(String(this.plugin.options.timeLogCleanupThreshold || 1000))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 10) {
              await this.plugin.writeOptions({ timeLogCleanupThreshold: num });
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "10";
        text.inputEl.max = "10000";
        text.inputEl.addClass("mcp-input-sm");
      });

    this.note(container, tRaw("settings.general.formatCleanup"));
  }

  addSyncConflictCleanupSetting(container: HTMLElement): void {
    new Setting(container)
      .setName(tRaw("settings.sync.syncConflictCleanup"))
      .setDesc(tRaw("settings.sync.syncConflictCleanupDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.syncConflictCleanupEnabled !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ syncConflictCleanupEnabled: value });
        });
      });
  }

  addGitHubGistSettings(container: HTMLElement): void {
    const gist = this.section(container, {
      title: tRaw("settings.sync.sectionGithubGist"),
      desc: tRaw("settings.sync.gistDesc1"),
      icon: "github",
    });

    const howTo = gist.createDiv({ cls: "wl-settings-note" });
    const gistB = howTo.createEl("b");
    gistB.textContent = tRaw("settings.sync.gistHowTo");
    howTo.createEl("br");
    howTo.appendText("1. GitHub → Settings → Credentials");
    howTo.createEl("br");
    howTo.appendText("2. Personal access tokens → Tokens (classic)");
    howTo.createEl("br");
    howTo.appendText(`3. ${tRaw("settings.sync.gistHowToStep1")}`);
    howTo.createEl("br");
    howTo.appendText(`4. ${tRaw("settings.sync.gistHowToStep2")}`);

    new Setting(gist)
      .setName(tRaw("settings.sync.githubToken"))
      .setDesc(tRaw("settings.sync.githubTokenDesc"))
      .addText((text) => {
        text
          .setPlaceholder("ghp_...")
          .setValue(this.plugin.options.githubToken || "")
          .onChange(async (value) => {
            await this.plugin.writeOptions({ githubToken: value });
          });
        text.inputEl.type = "password";
        text.inputEl.addClass("mcp-input-xl");
      });

    new Setting(gist)
      .setName(tRaw("settings.sync.gistSyncBtn"))
      .setDesc(tRaw("settings.sync.gistSyncBtnDesc"))
      .addButton((btn) =>
        btn
          .setButtonText(tRaw("settings.sync.gistSync"))
          .setCta()
          .onClick(async () => {
            const { syncToGist, gistSyncStatus, connectGist } =
              await import("./services/GistSyncService");
            const token = this.plugin.options.githubToken;

            if (!token) {
              new Notice(tRaw("settings.sync.gistTokenRequired"));
              return;
            }

            // Check token permissions first
            const connectResult = await connectGist(token);
            if (connectResult.warning) {
              new Notice(connectResult.warning);
              return;
            }
            if (!connectResult.success) {
              new Notice(tRaw("settings.general.errorPrefix", { error: connectResult.error }));
              return;
            }

            const result = await syncToGist();
            if (result.success) {
              const status = get(gistSyncStatus);
              // Re-render settings to show the URL field
              this.render();
              new Notice(
                tRaw("settings.sync.gistSyncComplete", { url: status.rawUrl }),
              );
            } else {
              new Notice(tRaw("settings.general.errorPrefix", { error: result.error }));
            }
          }),
      );

    new Setting(gist)
      .setName(tRaw("settings.sync.gistAutoSync"))
      .setDesc(
        tRaw("settings.sync.gistAutoSyncDesc"),
      )
      .addToggle((toggle) => {
        toggle.setValue(!!this.plugin.options.gistAutoSync);
        toggle.onChange(async (value) => {
          const { setAutoSync } = await import("./services/GistSyncService");
          await this.plugin.writeOptions({ gistAutoSync: value });
          setAutoSync(value);
          if (value) {
            // Show status
            const statusEl = document.getElementById("gist-auto-sync-status");
            if (statusEl)
              statusEl.textContent = tRaw("settings.sync.gistAutoSyncOn");
          }
        });
      });

    // Auto-sync status indicator
    const statusDesc = createDiv({ cls: "mcp-gist-sync-status" });
    statusDesc.id = "gist-auto-sync-status";
    statusDesc.textContent = this.plugin.options.gistAutoSync
      ? tRaw("settings.sync.gistAutoSyncOn")
      : tRaw("settings.sync.gistAutoSyncOff");
    gist
      .querySelector(".setting-item:last-child")
      ?.appendChild(statusDesc);

    if (this.plugin.options.gistRawUrl) {
      new Setting(gist)
        .setName(tRaw("settings.sync.gistCalendarUrl"))
        .setDesc(tRaw("settings.sync.gistCalendarUrlDesc"))
        .addText((text) => {
          text.setValue(this.plugin.options.gistRawUrl || "").setDisabled(true);
          text.inputEl.addClass("mcp-input-full");
        });
    }
  }

  addNotificationSettings(container: HTMLElement): void {
    const local = this.section(container, {
      title: tRaw("settings.notifications.sectionGeneral"),
      desc: tRaw("settings.notifications.enabledDesc"),
      icon: "bell-ring",
    });

    new Setting(local)
      .setName(tRaw("settings.notifications.enabled"))
      .setDesc(tRaw("settings.notifications.enabledDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.notificationsEnabled);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ notificationsEnabled: value });
          this.plugin.notificationService?.restart();
        });
      });

    new Setting(local)
      .setName(tRaw("settings.notifications.reminderMinutes"))
      .setDesc(tRaw("settings.notifications.reminderMinutesDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("1", tRaw("settings.sync.intervalMinutes", { n: 1 }));
        dropdown.addOption("5", tRaw("settings.sync.intervalMinutes", { n: 5 }));
        dropdown.addOption("10", tRaw("settings.sync.intervalMinutes", { n: 10 }));
        dropdown.addOption("15", tRaw("settings.sync.intervalMinutes", { n: 15 }));
        dropdown.addOption("30", tRaw("settings.sync.intervalMinutes", { n: 30 }));
        dropdown.addOption("60", tRaw("settings.sync.intervalHour"));
        dropdown.setValue(String(this.plugin.options.reminderMinutesBefore));
        dropdown.onChange(async (value) => {
          await this.plugin.writeOptions({ reminderMinutesBefore: parseInt(value) });
        });
      });

    const types = this.section(container, {
      title: tRaw("settings.notifications.typesTitle"),
      desc: tRaw("settings.notifications.typesDesc"),
      icon: "list-filter",
    });

    new Setting(types)
      .setName(tRaw("settings.notifications.notifyReminders"))
      .setDesc(tRaw("settings.notifications.notifyRemindersDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.notifyReminders);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ notifyReminders: value });
        });
      });

    new Setting(types)
      .setName(tRaw("settings.notifications.notifyOverdue"))
      .setDesc(tRaw("settings.notifications.notifyOverdueDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.notifyOverdue);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ notifyOverdue: value });
        });
      });

    new Setting(types)
      .setName(tRaw("settings.notifications.notifyEstimateExceeded"))
      .setDesc(tRaw("settings.notifications.notifyEstimateExceededDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.notifyEstimateExceeded);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ notifyEstimateExceeded: value });
        });
      });

    new Setting(types)
      .setName(tRaw("settings.notifications.notifyDeadlines"))
      .setDesc(tRaw("settings.notifications.notifyDeadlinesDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.notifyDeadlines);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ notifyDeadlines: value });
        });
      });

    const ntfy = this.section(container, {
      title: tRaw("settings.notifications.sectionNtfy"),
      desc: tRaw("settings.notifications.ntfyEnabledDesc"),
      icon: "smartphone",
    });

    new Setting(ntfy)
      .setName(tRaw("settings.notifications.ntfyEnabled"))
      .setDesc(tRaw("settings.notifications.ntfyEnabledDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.ntfyEnabled);
        toggle.onChange(async (value) => {
          if (value && !this.plugin.options.ntfyTopic) {
            const uuid = crypto.randomUUID();
            await this.plugin.writeOptions({ ntfyEnabled: value, ntfyTopic: uuid });
            this.ntfyTopicText?.setValue(uuid);
          } else {
            await this.plugin.writeOptions({ ntfyEnabled: value });
          }
          this.plugin.notificationService?.restart();
        });
      });

    new Setting(ntfy)
      .setName(tRaw("settings.notifications.ntfyTopic"))
      .setDesc(tRaw("settings.notifications.ntfyTopicDesc"))
      .addText((text) => {
        this.ntfyTopicText = text;
        text
          .setPlaceholder("a7f9b2c4-8e1d-4f3a-9c5b-2d6e8f0a1b3c")
          .setValue(this.plugin.options.ntfyTopic)
          .onChange(async (value) => {
            await this.plugin.writeOptions({ ntfyTopic: value });
          });
        text.inputEl.addClass("mcp-input-lg");
      });

    new Setting(ntfy)
      .setName(tRaw("settings.notifications.ntfyScheduled"))
      .setDesc(tRaw("settings.notifications.ntfyScheduledDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.ntfyScheduledEnabled);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ ntfyScheduledEnabled: value });
          if (value) {
            this.plugin.notificationService?.scheduleNtfyPush();
            // Auto-test scheduled push (skip if this device is excluded from scheduling)
            if (!this.plugin.notificationService?.isNtfyScheduledDisabledOnThisDevice()) {
              const result = await this.plugin.notificationService?.testNtfyScheduled();
              if (!result?.ok) {
                new Notice(`ntfy.sh scheduled test failed: ${result?.error || "unknown"}`);
              }
            }
          }
        });
      });

    new Setting(ntfy)
      .setName(tRaw("settings.notifications.ntfyScheduledSkipDevice"))
      .setDesc(tRaw("settings.notifications.ntfyScheduledSkipDeviceDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.notificationService?.isNtfyScheduledDisabledOnThisDevice() ?? false);
        toggle.onChange((value) => {
          this.plugin.notificationService?.setNtfyScheduledDisabledOnThisDevice(value);
          if (!value) {
            this.plugin.notificationService?.scheduleNtfyPush();
          }
        });
      });

    new Setting(ntfy)
      .setName(tRaw("settings.notifications.ntfyDailyDigest"))
      .setDesc(tRaw("settings.notifications.ntfyDailyDigestDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.ntfyDailyDigestEnabled);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ ntfyDailyDigestEnabled: value });
          if (value) {
            this.plugin.notificationService?.scheduleNtfyDailyDigest();
          } else {
            this.plugin.notificationService?.cancelScheduledDigest();
          }
        });
      });

    new Setting(ntfy)
      .setName(tRaw("settings.notifications.ntfyDigestTime"))
      .setDesc(tRaw("settings.notifications.ntfyDigestTimeDesc"))
      .addText((text) => {
        text.inputEl.type = "time";
        text.setValue(this.plugin.options.ntfyDigestTime || "06:00");
        text.onChange(async (value) => {
          const time = /^\d{2}:\d{2}$/.test(value) ? value : "06:00";
          await this.plugin.writeOptions({ ntfyDigestTime: time });
          if (this.plugin.options.ntfyDailyDigestEnabled) {
            this.plugin.notificationService?.scheduleNtfyDailyDigest();
          }
        });
      });

    new Setting(ntfy)
      .setName(tRaw("settings.notifications.ntfyDigestCommand"))
      .setDesc(tRaw("settings.notifications.ntfyDigestCommandDesc"))
      .addButton((btn) => {
        btn.setButtonText(tRaw("settings.notifications.ntfyDigestSendNow"));
        btn.onClick(async () => {
          const result = await this.plugin.notificationService?.sendDigestNow();
          if (!result?.ok) {
            new Notice(result?.error || "ntfy.sh digest failed");
          } else {
            new Notice(tRaw("settings.notifications.ntfyDigestSent"));
          }
        });
      });

    this.addNotificationDiagnostics(container);
  }

  private addNotificationDiagnostics(container: HTMLElement): void {
    const diag = this.section(container, {
      title: tRaw("settings.notifications.sectionDiagnostics"),
      icon: "activity",
    });

    const panel = diag.createDiv({ cls: "mcp-notif-panel" });

    const render = async () => {
      panel.empty();
      const diagnostics = await loadNotificationDiagnostics(this.app);
      const permission = "Notification" in window
        ? Notification.permission
        : "unavailable";

      const toolbar = panel.createDiv({ cls: "mcp-notif-toolbar" });
      toolbar.createDiv({
        text: tRaw("settings.notifications.diagnosticsChannels"),
        cls: "setting-item-name",
      });
      const actions = toolbar.createDiv({ cls: "mcp-notif-actions" });
      const refreshBtn = actions.createEl("button", { text: tRaw("settings.notifications.diagnosticsRefresh") });
      refreshBtn.addClass("mod-cta");
      refreshBtn.addEventListener("click", () => void render());
      const clearBtn = actions.createEl("button", { text: tRaw("settings.notifications.diagnosticsClear") });
      clearBtn.addEventListener("click", () => {
        void (async () => {
          await clearNotificationHistory(this.app);
          await render();
        })();
      });

      const grid = panel.createDiv({ cls: "mcp-notif-grid" });

      const addMetric = (label: string, value: string, tone: "ok" | "warn" | "bad" | "muted") => {
        const item = grid.createDiv({ cls: "mcp-notif-metric" });
        item.createDiv({
          text: label,
          cls: "setting-item-description mcp-notif-metric-label",
        });
        const toneClass = `mcp-notif-metric-${tone}`;
        item.createDiv({ text: value, cls: `mcp-notif-metric-value ${toneClass}` });
      };

      addMetric(
        tRaw("settings.notifications.diagnosticsLocal"),
        `${this.plugin.options.notificationsEnabled ? tRaw("common.enabled") : tRaw("common.disabled")} · ${this.formatNotificationPermission(permission)}`,
        this.plugin.options.notificationsEnabled && permission === "granted" ? "ok" : "warn"
      );

      addMetric(
        "ntfy.sh",
        this.plugin.options.ntfyEnabled
          ? `${tRaw("common.enabled")} · ${this.plugin.options.ntfyTopic || "—"}`
          : tRaw("common.disabled"),
        this.plugin.options.ntfyEnabled ? "ok" : "muted"
      );

      addMetric(
        tRaw("settings.notifications.ntfyScheduled"),
        this.plugin.options.ntfyScheduledEnabled ? tRaw("common.enabled") : tRaw("common.disabled"),
        this.plugin.options.ntfyScheduledEnabled ? "ok" : "muted"
      );

      addMetric(
        tRaw("settings.notifications.ntfyDailyDigest"),
        this.plugin.options.ntfyDailyDigestEnabled ? tRaw("common.enabled") : tRaw("common.disabled"),
        this.plugin.options.ntfyDailyDigestEnabled ? "ok" : "muted"
      );

      // Test buttons
      if (this.plugin.options.ntfyEnabled && this.plugin.options.ntfyTopic) {
        const testRow = panel.createDiv({ cls: "mcp-notif-toolbar" });
        const testActions = testRow.createDiv({ cls: "mcp-notif-actions" });

        const testNowBtn = testActions.createEl("button", { text: tRaw("settings.notifications.testNow") });
        testNowBtn.addClass("mod-cta");
        testNowBtn.addEventListener("click", () => {
          void (async () => {
            testNowBtn.disabled = true;
            testNowBtn.textContent = "...";
            const result = await this.plugin.notificationService?.testNtfyImmediate();
            testNowBtn.textContent = result?.ok ? "✓" : `✗ ${result?.error || ""}`;
            window.setTimeout(() => {
              testNowBtn.disabled = false;
              testNowBtn.textContent = tRaw("settings.notifications.testNow");
            }, 3000);
          })();
        });

        const testLaterBtn = testActions.createEl("button", { text: tRaw("settings.notifications.testScheduled") });
        testLaterBtn.addEventListener("click", () => {
          void (async () => {
            testLaterBtn.disabled = true;
            testLaterBtn.textContent = "...";
            const result = await this.plugin.notificationService?.testNtfyScheduled();
            testLaterBtn.textContent = result?.ok ? "✓ (1 min)" : `✗ ${result?.error || ""}`;
            window.setTimeout(() => {
              testLaterBtn.disabled = false;
              testLaterBtn.textContent = tRaw("settings.notifications.testScheduled");
            }, 3000);
          })();
        });
      }

      panel.createDiv({
        text: tRaw("settings.notifications.diagnosticsHistory"),
        cls: "setting-item-name mcp-notif-history-heading",
      });

      const historyWrap = panel.createDiv({ cls: "mcp-notif-history" });

      if (diagnostics.history.length === 0) {
        historyWrap.createDiv({
          text: tRaw("settings.notifications.diagnosticsEmpty"),
          cls: "setting-item-description mcp-notif-history-empty",
        });
        return;
      }

      for (const entry of diagnostics.history.slice(0, 12)) {
        const row = historyWrap.createDiv({ cls: "mcp-notif-history-row" });
        row.createDiv({
          text: this.formatTelemetryDate(entry.createdAt),
          cls: "mcp-notif-history-date",
        });

        const content = row.createDiv();
        content.createDiv({ text: entry.title, cls: "mcp-notif-history-title" });
        content.createDiv({ text: entry.body, cls: "mcp-notif-history-body" });
        if (entry.error) {
          content.createDiv({ text: entry.error, cls: "mcp-notif-history-error" });
        }

        const badgeClass = entry.status === "sent"
          ? "mcp-notif-badge-sent"
          : entry.status === "failed"
            ? "mcp-notif-badge-failed"
            : "mcp-notif-badge-muted";
        row.createDiv({ text: `${entry.channel} · ${entry.status}`, cls: `mcp-notif-history-badge ${badgeClass}` });
      }
    };

    void render();
  }

  private formatNotificationPermission(permission: string): string {
    if (permission === "granted") return tRaw("settings.notifications.permissionAllowed");
    if (permission === "denied") return tRaw("settings.notifications.permissionDenied");
    if (permission === "default") return tRaw("settings.notifications.permissionNeeded");
    return tRaw("settings.notifications.permissionUnavailable");
  }

  private formatTelemetryDate(value?: string): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  addOllamaSettings(container: HTMLElement): void {
    // AI is desktop-only: hide the whole surface on mobile (user rule)
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
    if (isMobile) {
      const mobileCard = this.section(container, {
        title: tRaw("settings.ai.sectionOllama"),
        icon: "sparkles",
      });
      this.note(mobileCard, tRaw("settings.ai.mobileOnlyDesktop"));
      return;
    }

    // ── 1. On / off ──────────────────────────────────────────────────────
    const power = this.section(container, {
      title: tRaw("settings.ai.sectionOllama"),
      desc: tRaw("settings.ai.enabledDesc"),
      icon: "sparkles",
    });
    new Setting(power)
      .setName(tRaw("settings.ai.enabled"))
      .setDesc(tRaw("settings.ai.enabledDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.options.ollamaEnabled);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ ollamaEnabled: value });
          this.render();
        });
      });

    if (!this.plugin.options.ollamaEnabled) {
      this.note(power, tRaw("settings.ai.howToSteps"));
      return;
    }

    // ── 2. Connection ────────────────────────────────────────────────────
    const connection = this.section(container, {
      title: tRaw("settings.ai.sectionConnection"),
      icon: "plug",
    });

    new Setting(connection)
      .setName(tRaw("settings.ai.url"))
      .setDesc(tRaw("settings.ai.urlDesc"))
      .addText((text) => {
        text
          .setPlaceholder(tRaw("settings.ai.urlPlaceholder"))
          .setValue(this.plugin.options.ollamaUrl || "http://localhost:11434")
          .onChange(async (value) => {
            await this.plugin.writeOptions({ ollamaUrl: value });
          });
        text.inputEl.addClass("mcp-input-xl");
      });

    new Setting(connection)
      .setName(tRaw("settings.ai.contextSize"))
      .setDesc(tRaw("settings.ai.contextSizeDesc"))
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.options.ollamaContextSize || 0))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 0) {
              await this.plugin.writeOptions({ ollamaContextSize: num });
            }
          });
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.inputEl.addClass("mcp-input-md");
      });

    const btnRow = connection.createDiv({ cls: "mcp-btn-row" });
    this.addTestConnectionButton(btnRow);
    this.addTestAiButton(btnRow);

    // ── 3. Models ────────────────────────────────────────────────────────
    const models = this.section(container, {
      title: tRaw("settings.ai.sectionModels"),
      icon: "cpu",
    });

    const modelMode = this.plugin.options.ollamaModelMode === "dual" ? "dual" : "single";

    new Setting(models)
      .setName(tRaw("settings.ai.modelMode"))
      .setDesc(tRaw("settings.ai.modelModeDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("single", tRaw("settings.ai.modelModeSingle"));
        dropdown.addOption("dual", tRaw("settings.ai.modelModeDual"));
        dropdown.setValue(modelMode);
        dropdown.onChange(async (value) => {
          await this.plugin.writeOptions({
            ollamaModelMode: value === "dual" ? "dual" : "single",
          });
          this.render();
        });
      });

    // Main model — always visible
    this.addModelPicker(models, {
      name: tRaw("settings.ai.model"),
      desc: tRaw("settings.ai.modelDesc"),
      getValue: () => this.plugin.options.ollamaModel || "llama3.1",
      setValue: (v) => this.plugin.writeOptions({ ollamaModel: v }),
    });

    // Extract model — only in dual mode
    if (modelMode === "dual") {
      this.addModelPicker(models, {
        name: tRaw("settings.ai.modelExtract"),
        desc: tRaw("settings.ai.modelExtractDesc"),
        getValue: () => this.plugin.options.ollamaModelExtract || "",
        setValue: (v) => this.plugin.writeOptions({ ollamaModelExtract: v }),
        emptyLabel: tRaw("settings.ai.modelExtractSame"),
      });
    }

    // Cloud / remote models help
    this.note(models, `${tRaw("settings.ai.cloudModelsTitle")} — ${tRaw("settings.ai.cloudModelsDesc")}`);

    // ── 4. Actions ───────────────────────────────────────────────────────
    const actionsTasks = this.section(container, {
      title: tRaw("settings.ai.sectionActionsTasks"),
      icon: "list-checks",
    });
    this.addCompactToggle(actionsTasks, "aiExtractEnabled", "extractEnabled", "extractEnabledDesc");
    this.addCompactToggle(actionsTasks, "aiSubtasksEnabled", "subtasksEnabled", "subtasksEnabledDesc");
    this.addCompactToggle(actionsTasks, "aiQuickAddEnabled", "quickAddEnabled", "quickAddEnabledDesc", {
      onAfter: () => this.render(),
    });
    if (this.plugin.options.aiQuickAddEnabled !== false) {
      this.addCompactToggle(actionsTasks, "aiConfirmBeforeAdd", "confirmBeforeAdd", "confirmBeforeAddDesc");
      this.note(actionsTasks, tRaw("settings.ai.quickAddHowTo"));
    }

    const actionsNotes = this.section(container, {
      title: tRaw("settings.ai.sectionActionsNotes"),
      icon: "file-text",
    });
    this.addCompactToggle(actionsNotes, "aiSummaryEnabled", "summaryEnabled", "summaryEnabledDesc", {
      onAfter: () => this.render(),
    });
    if (this.plugin.options.aiSummaryEnabled !== false) {
      new Setting(actionsNotes)
        .setName(tRaw("settings.ai.summaryStyle"))
        .setDesc(tRaw("settings.ai.summaryStyleDesc"))
        .addDropdown((dropdown) => {
          dropdown.addOption("brief", tRaw("settings.ai.summaryStyleBrief"));
          dropdown.addOption("detailed", tRaw("settings.ai.summaryStyleDetailed"));
          dropdown.addOption("bullets", tRaw("settings.ai.summaryStyleBullets"));
          dropdown.addOption("executive", tRaw("settings.ai.summaryStyleExecutive"));
          const raw = this.plugin.options.aiSummaryStyle;
          dropdown.setValue(
            raw === "brief" || raw === "bullets" || raw === "executive" ? raw : "detailed",
          );
          dropdown.onChange(async (value: string) => {
            await this.plugin.writeOptions({
              aiSummaryStyle:
                value === "brief" || value === "bullets" || value === "executive"
                  ? value
                  : "detailed",
            });
            this.render();
          });
        });

      // One-line explanation of the chosen style
      const style = this.plugin.options.aiSummaryStyle === "brief"
        || this.plugin.options.aiSummaryStyle === "bullets"
        || this.plugin.options.aiSummaryStyle === "executive"
        ? this.plugin.options.aiSummaryStyle
        : "detailed";
      const styleDescMap: Record<string, string> = {
        brief: tRaw("settings.ai.summaryStyleBriefDesc"),
        detailed: tRaw("settings.ai.summaryStyleDetailedDesc"),
        bullets: tRaw("settings.ai.summaryStyleBulletsDesc"),
        executive: tRaw("settings.ai.summaryStyleExecutiveDesc"),
      };
      this.note(actionsNotes, styleDescMap[style] || "");

      new Setting(actionsNotes)
        .setName(tRaw("settings.ai.summaryPrompt"))
        .setDesc(tRaw("settings.ai.summaryPromptDesc"))
        .addTextArea((area) => {
          area
            .setPlaceholder(tRaw("settings.ai.summaryPromptPlaceholder"))
            .setValue(this.plugin.options.aiSummaryPrompt || "")
            .onChange(async (value) => {
              await this.plugin.writeOptions({ aiSummaryPrompt: value });
            });
          area.inputEl.rows = 2;
          area.inputEl.addClass("mcp-input-xl");
        });
    }

    const actionsFinance = this.section(container, {
      title: tRaw("settings.ai.sectionActionsFinance"),
      icon: "coins",
    });
    this.addCompactToggle(actionsFinance, "aiFinanceInsightsEnabled", "financeInsights", "financeInsightsDesc");

    const actionsSchedule = this.section(container, {
      title: tRaw("settings.ai.sectionActionsSchedule"),
      icon: "calendar-check",
    });
    this.addCompactToggle(actionsSchedule, "aiWorkoutEnabled", "workoutEnabled", "workoutEnabledDesc");
    this.addCompactToggle(actionsSchedule, "aiScheduleActionsEnabled", "scheduleActionsEnabled", "scheduleActionsEnabledDesc");

    // ── 5. Privacy ───────────────────────────────────────────────────────
    const privacy = this.section(container, {
      title: tRaw("settings.ai.sectionPrivacy"),
      desc: tRaw("settings.ai.dataSentDesc"),
      icon: "shield",
      tone: "warning",
    });
    this.note(privacy, tRaw("settings.ai.cloudWarningDesc"));
    this.note(privacy, `${tRaw("settings.ai.dataSentTitle")}: ${tRaw("settings.ai.dataSentDesc")}`);

    // ── 6. How-to ────────────────────────────────────────────────────────
    const howToCard = this.section(container, {
      title: tRaw("settings.ai.howToTitle"),
      icon: "help-circle",
    });
    this.note(howToCard, tRaw("settings.ai.howToSteps"));
  }

  /** Small helper: toggle with short label, one-line desc. */
  private addCompactToggle(
    container: HTMLElement,
    key:
      | "aiExtractEnabled"
      | "aiSubtasksEnabled"
      | "aiWorkoutEnabled"
      | "aiQuickAddEnabled"
      | "aiConfirmBeforeAdd"
      | "aiScheduleActionsEnabled"
      | "aiSummaryEnabled"
      | "aiFinanceInsightsEnabled",
    nameKey: string,
    descKey: string,
    opts?: { onAfter?: () => void },
  ): void {
    new Setting(container)
      .setName(tRaw(`settings.ai.${nameKey}`))
      .setDesc(tRaw(`settings.ai.${descKey}`))
      .addToggle((toggle) => {
        const current = (this.plugin.options as unknown as Record<string, unknown>)[key];
        toggle.setValue(current !== false);
        toggle.onChange(async (value) => {
          await this.plugin.writeOptions({ [key]: value });
          opts?.onAfter?.();
        });
      });
  }

  /** Model dropdown + "Find models" button. */
  private addModelPicker(
    container: HTMLElement,
    opts: {
      name: string;
      desc: string;
      getValue: () => string;
      setValue: (v: string) => Promise<void>;
      emptyLabel?: string;
    },
  ): void {
    const row = container.createDiv({ cls: "setting-item" });
    const info = row.createDiv({ cls: "setting-item-info" });
    info.createDiv({ cls: "setting-item-name", text: opts.name });
    info.createDiv({ cls: "setting-item-description", text: opts.desc });
    const control = row.createDiv({ cls: "setting-item-control" });

    const select = control.createEl("select", { cls: "dropdown" });
    const fill = (models: string[], selected: string) => {
      select.empty();
      if (opts.emptyLabel) {
        select.createEl("option", { value: "", text: opts.emptyLabel });
      }
      for (const name of models) {
        select.createEl("option", { value: name, text: name });
      }
      // Keep a non-empty saved value visible even if it's not in the fetched list.
      if (selected && !models.includes(selected)) {
        select.createEl("option", { value: selected, text: selected });
      }
      select.value = selected;
    };

    const current = opts.getValue();
    fill(current ? [current] : [], current);
    select.addEventListener("change", () => {
      void opts.setValue(select.value);
    });

    const findBtn = control.createEl("button", { text: tRaw("settings.ai.findModels") });
    findBtn.addClass("mod-cta");
    findBtn.addEventListener("click", () => {
      void (async () => {
        findBtn.disabled = true;
        findBtn.textContent = tRaw("settings.ai.finding");
        const url = this.plugin.options.ollamaUrl || "http://localhost:11434";
        const result = await testOllamaConnection(url);
        findBtn.disabled = false;
        findBtn.textContent = tRaw("settings.ai.findModels");
        if (result.ok && result.models && result.models.length > 0) {
          fill(result.models, opts.getValue());
        }
      })();
    });
  }

  private addTestConnectionButton(btnRow: HTMLElement): void {
    const testBtn = btnRow.createEl("button", { text: tRaw("settings.ai.testConnection") });
    testBtn.addClass("mcp-btn");
    testBtn.addEventListener("click", () => {
      void (async () => {
        testBtn.disabled = true;
        testBtn.textContent = tRaw("settings.ai.checking");
        testBtn.removeClass("mcp-color-success", "mcp-color-danger");

        const url = this.plugin.options.ollamaUrl || "http://localhost:11434";
        const result = await testOllamaConnection(url);

        if (result.ok && result.models) {
          const modelCount = result.models.length;
          if (modelCount > 0) {
            testBtn.textContent = tRaw("settings.ai.modelsFound", { count: String(modelCount) });
            testBtn.addClass("mcp-color-success");
          } else {
            testBtn.textContent = tRaw("settings.ai.noModels");
            testBtn.addClass("mcp-color-danger");
          }
        } else {
          testBtn.textContent = `${tRaw("settings.ai.connectionError")}${result.error ? `: ${result.error}` : ""}`;
          testBtn.addClass("mcp-color-danger");
        }

        window.setTimeout(() => {
          testBtn.disabled = false;
          testBtn.removeClass("mcp-color-success", "mcp-color-danger");
          testBtn.textContent = tRaw("settings.ai.testConnection");
        }, 5000);
      })();
    });
  }

  private addTestAiButton(btnRow: HTMLElement): void {
    const aiTestBtn = btnRow.createEl("button", { text: tRaw("settings.ai.testAI") });
    aiTestBtn.addClass("mcp-btn");
    aiTestBtn.addEventListener("click", () => {
      void (async () => {
        aiTestBtn.disabled = true;
        aiTestBtn.textContent = tRaw("settings.ai.testing");
        aiTestBtn.removeClass("mcp-color-success", "mcp-color-danger");

        const url = this.plugin.options.ollamaUrl || "http://localhost:11434";
        const { resolveModel } = await import("./services/OllamaService");
        const model = resolveModel("reason", this.plugin.options);
        const result = await testOllamaModel(url, model);

        if (result.ok) {
          aiTestBtn.textContent = `✓ ${result.model}: "${(result.response || "").slice(0, 60)}"`;
          aiTestBtn.addClass("mcp-color-success");
        } else {
          aiTestBtn.textContent = `✗ ${result.error || "failed"}`;
          aiTestBtn.addClass("mcp-color-danger");
        }

        window.setTimeout(() => {
          aiTestBtn.disabled = false;
          aiTestBtn.removeClass("mcp-color-success", "mcp-color-danger");
          aiTestBtn.textContent = tRaw("settings.ai.testAI");
        }, 8000);
      })();
    });
  }
}
