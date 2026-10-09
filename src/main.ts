import "moment/locale/ru";
import { moment, App, Plugin, WorkspaceLeaf, View } from "obsidian";
import type { Moment, WeekSpec } from "moment";
import type { IconName } from "obsidian";
import { get } from "svelte/store";

const registeredMarkdownCodeBlocks = new Set<string>();



import {
  VIEW_TYPE_CALENDAR,
  VIEW_TYPE_TASKS,
  VIEW_TYPE_SCHEDULE,
  VIEW_TYPE_MOBILE_SCHEDULE,
  VIEW_TYPE_MOBILE_TASKS,
  VIEW_TYPE_HABIT_ANALYTICS,
  VIEW_TYPE_FINANCE,
  VIEW_TYPE_FINANCIAL_ANALYTICS,
  VIEW_TYPE_KANBAN,
  VIEW_TYPE_HABIT_PANEL,
  VIEW_TYPE_WEATHER_DETAIL,
} from "./constants";
import { settings } from "./ui/stores";
import { app as appStore } from "./stores/appStore";
import {
  CalendarSettingsTab,
  ISettings,
  applyAccentColor,
  applyGlassBgColor,
  applyAllColors,
} from "./settings";
import { TFile, TFolder, Menu, type MenuItem } from "obsidian";
import CalendarView from "./view";
import TaskView from "./views/TaskView";
import ScheduleView from "./views/ScheduleView";
import MobileScheduleView from "./views/MobileScheduleView";
import MobileTaskTrackerView from "./views/MobileTaskTrackerView";
import HabitAnalyticsView from "./views/HabitAnalyticsView";
import FinanceView from "./views/FinanceView";
import FinancialAnalyticsView from "./views/FinancialAnalyticsView";
import KanbanView from "./views/KanbanView";
import HabitPanelView from "./views/HabitPanelView";
import WeatherDetailView from "./views/WeatherDetailView";
import { initTaskStores, reloadTaskStores, immediateSave as immediateTaskSave } from "./task-tracker/stores";
import { cleanupTimers } from "./task-tracker/TimerManager";
import { initHabitStores, reloadHabitStores, immediateSave as immediateHabitSave } from "./habit-tracker/stores";
import { initFinanceStores, reloadFinanceStores, immediateFinanceSave } from "./finance/storage";
import { initFinancialAnalyticsStores, reloadFinancialAnalyticsStores, immediateAnalyticsSave } from "./finance/financialAnalyticsStorage";
import { initWeightStores, reloadWeightStores, immediateWeightSave } from "./weight/stores";
import { initLocale, locale, tRaw, currencyOverride } from "./i18n";
import CalendarNav from "./components/CalendarNav.svelte";
import DateTimeWeather from "./components/DateTimeWeather.svelte";
import Dashboard from "./dashboard/Dashboard.svelte";
import HelloView from "./components/HelloView.svelte";
import { NotificationService } from "./services/NotificationService";
import { checkForPluginUpdate } from "./services/updateCheck";
import { initGistSync } from "./services/GistSyncService";
import { AIExtractModal } from "./services/AIExtractModal";
import {
  AISummaryModal,
  resolveSummarySources,
} from "./services/AISummaryModal";

type AiMenuAction = {
  title: string;
  icon: string;
  onClick: () => void;
};

/** Nest AI actions under one submenu when there are several; otherwise a single item. */
function addAiMenuItems(menu: Menu, actions: AiMenuAction[]): void {
  if (actions.length === 0) return;
  if (actions.length === 1) {
    const a = actions[0];
    menu.addItem((item: MenuItem) => {
      item.setTitle(a.title).setIcon(a.icon).setSection("action").onClick(a.onClick);
    });
    return;
  }
  menu.addItem((item: MenuItem) => {
    item.setTitle(tRaw("ai.toolsMenu")).setIcon("sparkles").setSection("action");
    const withSub = item as MenuItem & { setSubmenu?: () => Menu };
    if (typeof withSub.setSubmenu === "function") {
      // Native nested menu (keeps parent open as a flyout)
      const sub = withSub.setSubmenu();
      for (const a of actions) {
        sub.addItem((s: MenuItem) => {
          s.setTitle(a.title).setIcon(a.icon).onClick(a.onClick);
        });
      }
      return;
    }
    // Fallback: open a secondary menu at the parent menu position without
    // letting the parent close-then-reopen flicker steal the click.
    item.onClick((evt) => {
      if (evt instanceof MouseEvent) {
        evt.preventDefault();
        evt.stopPropagation();
      }
      const sub = new Menu();
      for (const a of actions) {
        sub.addItem((s: MenuItem) => {
          s.setTitle(a.title).setIcon(a.icon).onClick(a.onClick);
        });
      }
      const rawTarget = evt.target;
      const target =
        rawTarget instanceof Node && rawTarget.instanceOf(HTMLElement) ? rawTarget : null;
      const itemEl = target?.closest(".menu-item") ?? target;
      const rect = itemEl?.getBoundingClientRect();
      if (rect) {
        // Fly out to the right of the parent item, aligned to its top
        sub.showAtPosition({
          x: Math.round(rect.right + 4),
          y: Math.round(rect.top),
          overlap: true,
        });
      } else if (evt instanceof MouseEvent) {
        sub.showAtMouseEvent(evt);
      }
    });
  });
}
import { migrateFromSingleFile, migrateRootModuleFiles, VAULT_DATA_DIR } from "./io/vaultStorage";
import { cleanupSyncConflictFiles } from "./io/syncConflicts";
import { VIEW_SWITCHED_EVENT } from "./views/viewSwitch";

declare global {
  interface Window {
    app: App;
    // moment уже объявлен в obsidian-daily-notes-interface (typeof moment)
    _bundledLocaleWeekSpec: WeekSpec;
  }
}

export default class CalendarPlugin extends Plugin {
  public options: ISettings;
  private view: CalendarView;
  private ribbonIconsRegistered = false;
  private ribbonIcons: HTMLElement[] = [];
  private ribbonDefs: { el: HTMLElement; key: string }[] = [];
  private habitRibbonIcon: HTMLElement | null = null;
  private syncReloadTimer: number | null = null;
  private lastSavedDataJson = "";
  public notificationService: NotificationService;
  private dtwPanel: DateTimeWeather | null = null;
  private dtwContainer: HTMLElement | null = null;

  onunload(): void {
    // Destroy global DateTimeWeather panel
    if (this.dtwPanel) {
      this.dtwPanel.$destroy();
      this.dtwPanel = null;
    }
    if (this.dtwContainer) {
      this.dtwContainer.remove();
      this.dtwContainer = null;
    }

    // Flush pending debounced saves before teardown
    immediateTaskSave();
    immediateHabitSave();
    void immediateFinanceSave();
    void immediateAnalyticsSave();
    immediateWeightSave();

    if (this.syncReloadTimer) window.clearTimeout(this.syncReloadTimer);
    this.notificationService?.stop();
    cleanupTimers();
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_CALENDAR)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_SCHEDULE)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MOBILE_SCHEDULE)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MOBILE_TASKS)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_HABIT_ANALYTICS)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_FINANCE)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_FINANCIAL_ANALYTICS)
      .forEach((leaf) => leaf.detach());
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_WEATHER_DETAIL)
      .forEach((leaf) => leaf.detach());

    registeredMarkdownCodeBlocks.clear();

    // Remove ribbon icons explicitly (hot-reload safety)
    for (const icon of this.ribbonIcons) {
      icon.remove();
    }
    this.ribbonIcons = [];
    document.querySelectorAll("[data-mcp-ribbon]").forEach(el => el.remove());
    this.ribbonIconsRegistered = false;
  }

  async onload(): Promise<void> {
    // Initialize locale from settings
    initLocale(this.options?.language || "system");
    currencyOverride.set(this.options?.financeCurrency || null);

    // Set moment locale based on i18n locale
    const currentLocale = get(locale) || "ru";
    moment.locale(currentLocale);

    // Set the app store so components can access the Obsidian App instance
    appStore.set(this.app);

    let lastLocale = get(locale);
    this.register(
      settings.subscribe((value) => {
        this.options = value;
        this.notificationService?.restart();
        currencyOverride.set(value.financeCurrency || null);
        // Update locale when language setting changes
        if (value.language) {
          initLocale(value.language);
          moment.locale(get(locale) || "ru");
          const newLocale = get(locale);
          if (newLocale !== lastLocale) {
            lastLocale = newLocale;
            this.updateRibbonLabels();
          }
        }
      })
    );

    const safeRegisterView = (type: string, factory: (leaf: WorkspaceLeaf) => View) => {
      try {
        this.registerView(type, factory);
      } catch {
        // View type already registered (hot-reload / double-load) — safe to ignore
      }
    };

    const safeRegisterMarkdownCodeBlockProcessor = (
      lang: string,
      processor: (source: string, el: HTMLElement) => void
    ) => {
      if (registeredMarkdownCodeBlocks.has(lang)) {
        return;
      }
      try {
        this.registerMarkdownCodeBlockProcessor(lang, processor);
        registeredMarkdownCodeBlocks.add(lang);
      } catch {
        // Code block processor already registered (hot-reload / double-load) — safe to ignore
        registeredMarkdownCodeBlocks.add(lang);
      }
    };

    safeRegisterView(
      VIEW_TYPE_CALENDAR,
      (leaf: WorkspaceLeaf) => {
        this.view = new CalendarView(leaf, this);
        return this.view;
      }
    );

    safeRegisterView(
      VIEW_TYPE_TASKS,
      (leaf: WorkspaceLeaf) => new TaskView(leaf)
    );

    safeRegisterView(
      VIEW_TYPE_SCHEDULE,
      (leaf: WorkspaceLeaf) => new ScheduleView(leaf, this)
    );

    safeRegisterView(
      VIEW_TYPE_MOBILE_SCHEDULE,
      (leaf: WorkspaceLeaf) => new MobileScheduleView(leaf, this)
    );

    safeRegisterView(
      VIEW_TYPE_MOBILE_TASKS,
      (leaf: WorkspaceLeaf) => new MobileTaskTrackerView(leaf, this)
    );

    safeRegisterView(
      VIEW_TYPE_HABIT_ANALYTICS,
      (leaf: WorkspaceLeaf) => new HabitAnalyticsView(leaf, this)
    );

    safeRegisterView(
      VIEW_TYPE_FINANCE,
      (leaf: WorkspaceLeaf) => new FinanceView(leaf, this)
    );

    safeRegisterView(
      VIEW_TYPE_FINANCIAL_ANALYTICS,
      (leaf: WorkspaceLeaf) => new FinancialAnalyticsView(leaf, this)
    );

    safeRegisterView(
      VIEW_TYPE_KANBAN,
      (leaf: WorkspaceLeaf) => new KanbanView(leaf, this)
    );

    safeRegisterView(
      VIEW_TYPE_HABIT_PANEL,
      (leaf: WorkspaceLeaf) => new HabitPanelView(leaf, this)
    );

    safeRegisterView(
      VIEW_TYPE_WEATHER_DETAIL,
      (leaf: WorkspaceLeaf) => new WeatherDetailView(leaf, this)
    );

    this.addCommand({
      id: "show-calendar-view",
      name: "Open view",
      checkCallback: (checking: boolean) => {
        if (checking) {
          return (
            this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length === 0
          );
        }
        this.initLeaf();
      },
    });

    this.addCommand({
      id: "open-schedule-view",
      name: tRaw("main.commands.openSchedule"),
      callback: () => this.activateScheduleView(),
    });

    this.addCommand({
      id: "open-habit-analytics",
      name: tRaw("main.commands.openAnalytics"),
      callback: () => this.activateHabitAnalyticsView(),
    });

    this.addCommand({
      id: "open-finance-view",
      name: tRaw("main.commands.openFinance"),
      callback: () => this.activateFinanceView(),
    });

    this.addCommand({
      id: "quick-add-task",
      name: tRaw("main.commands.quickAddTask"),
      callback: () => {
        const now = window.moment
          ? window.moment()
          : (
              activeWindow as unknown as { moment: () => Moment }
            ).moment();
        void import("./task-tracker/QuickAddModal").then(({ QuickAddModal }: typeof import("./task-tracker/QuickAddModal")) => {
          new QuickAddModal(this.app, now).open();
        });
      },
    });

    this.addCommand({
      id: "open-kanban-view",
      name: tRaw("main.commands.openKanban"),
      callback: () => this.activateKanbanView(),
    });

    this.addCommand({
      id: "open-habit-panel",
      name: tRaw("main.commands.openHabitPanel"),
      callback: () => this.activateHabitPanelView(),
    });

    // Remove orphaned ribbon icons from previous instance (hot-reload safety)
    document.querySelectorAll("[data-mcp-ribbon]").forEach(el => el.remove());

    if (!this.ribbonIconsRegistered) {
      this.registerRibbonIcons();
    }

    // Register calendar-nav code block processor
    safeRegisterMarkdownCodeBlockProcessor("calendar-nav", (source, el) => {
      const lines = source.split("\n").filter((l) => l.trim());
      const items = lines.map((line) => {
        const [key, ...rest] = line.split(":");
        return {
          key: key.trim(),
          label: rest.length > 0 ? rest.join(":").trim() : key.trim(),
        };
      });
      if (items.length === 0) return;

      // Defaults from plugin settings
      const opts = this.options;
      let btnColor = opts.navBtnColor || "";
      let btnBg = opts.navBtnBg || "";
      let btnRadius = opts.navBtnRadius || "";
      let btnSize = opts.navBtnSize || "";
      let accentColor = opts.navAccentColor || "";

      // Override with inline % style line
      const styleLine = lines[0]?.trim();
      if (styleLine?.startsWith("%")) {
        const styleParts = styleLine.slice(1).split(";");
        for (const part of styleParts) {
          const [k, v] = part.split(":").map((s) => s.trim());
          if (k === "color") btnColor = v;
          if (k === "bg") btnBg = v;
          if (k === "radius") btnRadius = v;
          if (k === "size") btnSize = v;
          if (k === "accent") accentColor = v;
        }
        items.shift();
      }

      new CalendarNav({
        target: el,
        props: {
          items,
          btnColor,
          btnBg,
          btnRadius,
          btnSize,
          accentColor,
          onNavigate: (viewKey: string) => {
            const viewMap: Record<string, () => Promise<void> | void> = {
              schedule: () => this.activateScheduleView(),
              tasks: () => this.activateTaskView(),
              finance: () => this.activateFinanceView(),
              analytics: () => this.activateHabitAnalyticsView(),
            };
            const action = viewMap[viewKey];
            if (action) void action();
          },
        },
      });
    });

    // Register datetime-weather code block processor
    safeRegisterMarkdownCodeBlockProcessor("datetime-weather", (_source, el) => {
      new DateTimeWeather({ target: el });
    });

    // Register dashboard code block processor
    safeRegisterMarkdownCodeBlockProcessor("dashboard", (_source, el) => {
      const activeFile = this.app.workspace.getActiveFile();
      new Dashboard({ target: el, props: { appInstance: this.app, filePath: activeFile?.path } });
    });

    // Register hello code block processor
    safeRegisterMarkdownCodeBlockProcessor("hello", (_source, el) => {
      new HelloView({
        target: el,
        props: {
          appInstance: this.app,
          userName: this.options.userName || "",
          onOpenTasks: () => this.activateTaskView(),
          onOpenAnalytics: () => this.activateHabitAnalyticsView(),
          onOpenFinance: () => this.activateFinanceView(),
          onOpenSchedule: () => window.innerWidth <= 768 ? this.activateMobileScheduleView() : this.activateScheduleView(),
          persistNavOrder: (order: string[]) => {
            void this.writeOptions({ helloNavOrder: order });
          },
        },
      });
    });

    // Right-click menu: insert blocks
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((item) => {
          item.setTitle(tRaw("main.contextMenu.insertDateTimeWeather"))
            .setIcon("calendar-range")
            .onClick(() => {
              const cursor = editor.getCursor();
              editor.replaceRange("```datetime-weather\n```", cursor);
              editor.setCursor({ line: cursor.line + 1, ch: 0 });
            });
        });
        menu.addItem((item) => {
          item.setTitle(tRaw("main.contextMenu.insertDashboard"))
            .setIcon("layout-grid")
            .onClick(() => {
              const cursor = editor.getCursor();
              editor.replaceRange("```dashboard\n```", cursor);
              editor.setCursor({ line: cursor.line + 1, ch: 0 });
            });
        });
        menu.addItem((item) => {
          item.setTitle(tRaw("main.contextMenu.insertHello"))
            .setIcon("hand")
            .onClick(() => {
              const cursor = editor.getCursor();
              editor.replaceRange("```hello\n```", cursor);
              editor.setCursor({ line: cursor.line + 1, ch: 0 });
            });
        });
      })
    );

    // Right-click on .md file → AI tools (extract / summary)
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!this.options.ollamaEnabled) return;
        if (window.innerWidth <= 768) return;

        const aiActions: AiMenuAction[] = [];

        // Folders / notes → AI summary
        if (
          this.options.aiSummaryEnabled !== false &&
          (file instanceof TFolder || (file instanceof TFile && file.extension === "md"))
        ) {
          const sources = resolveSummarySources(this.app, file);
          if (sources.files.length > 0) {
            aiActions.push({
              title:
                sources.files.length > 1
                  ? tRaw("ai.contextMenuSummaryMany", { count: String(sources.files.length) })
                  : tRaw("ai.contextMenuSummary"),
              icon: "lucide-file-text",
              onClick: () => {
                new AISummaryModal(
                  this.app,
                  sources.files,
                  sources.folderPath,
                  sources.title,
                ).open();
              },
            });
          }
        }

        if (file instanceof TFile && file.extension === "md" && this.options.aiExtractEnabled !== false) {
          aiActions.push({
            title: tRaw("ai.contextMenuExtract"),
            icon: "sparkles",
            onClick: () => {
              new AIExtractModal(this.app, file.path).open();
            },
          });
        }

        addAiMenuItems(menu, aiActions);
      })
    );

    // Multi-select notes (Shift+click) → AI summary of selection
    this.registerEvent(
      // Obsidian files-menu: multi-select in file explorer
      (this.app.workspace as unknown as {
        on: (name: string, cb: (...args: never[]) => void) => unknown;
      }).on("files-menu", (menu: Menu, files: (TFile | TFolder)[]) => {
        if (!this.options.ollamaEnabled) return;
        if (this.options.aiSummaryEnabled === false) return;
        if (window.innerWidth <= 768) return;
        const mdFiles = files.filter((f): f is TFile => f instanceof TFile && f.extension === "md");
        if (mdFiles.length < 2) return;
        addAiMenuItems(menu, [
          {
            title: tRaw("ai.contextMenuSummaryMany", { count: String(mdFiles.length) }),
            icon: "lucide-files",
            onClick: () => {
              const folderPath = mdFiles[0]?.parent?.path ?? "";
              const label = tRaw("ai.summarySelection", { count: String(mdFiles.length) });
              new AISummaryModal(this.app, mdFiles.slice(0, 40), folderPath, label).open();
            },
          },
        ]);
      })
    );

    await this.loadOptions();

    // Apply accent color from settings
    if (this.options.accentColor) {
      applyAccentColor(this.options.accentColor);
    }
    if (this.options.glassBgColor) {
      applyGlassBgColor(this.options.glassBgColor, this.options.glassOpacity);
    }
    applyAllColors(this.options);

    // Migrate legacy calendar-data.json to per-module files (one-time, idempotent)
    await migrateFromSingleFile(this.app);

    // Migrate root-level module files to calendar-data/ (one-time, idempotent)
    await migrateRootModuleFiles(this.app);

    // Drop Syncthing conflict copies (keep newest) before loading data
    void this.cleanupConflicts();

    // Initialize task tracker (must await to prevent empty data from overwriting vault)
    await initTaskStores(this);

    // Initialize habit tracker (must await to prevent empty data from overwriting vault)
    await initHabitStores(this);

    // Initialize finance tracker (must await to prevent race condition where empty data overwrites vault)
    await initFinanceStores(this);

    // Initialize financial analytics (must await to prevent data loss)
    await initFinancialAnalyticsStores(this);

    // Initialize weight tracker
    await initWeightStores(this);

    // Initialize GitHub Gist sync
    initGistSync(this);

    // Initialize notification service
    this.notificationService = new NotificationService(this);
    if (this.options.notificationsEnabled) {
      void this.notificationService.start();
    }
    // Schedule ntfy.sh push notifications for upcoming tasks
    if (this.options.ntfyScheduledEnabled) {
      this.notificationService.scheduleNtfyPush();
    }
    // Schedule 6:00 morning digest with the day's task list (and keep it daily)
    if (this.options.ntfyDailyDigestEnabled) {
      this.notificationService.scheduleNtfyDailyDigest();
    }

    // Check for a new plugin version on every Obsidian open
    if (this.options.checkPluginUpdates !== false) {
      window.setTimeout(() => {
        void checkForPluginUpdate(this);
      }, 2_000);
    }

    // Watch for vault sync file changes (modify + create)
    const debouncedSyncReload = () => {
      if (this.syncReloadTimer) window.clearTimeout(this.syncReloadTimer);
      this.syncReloadTimer = window.setTimeout(() => {
        void (async () => {
          reloadTaskStores(this);
          reloadHabitStores(this);
          await reloadFinanceStores();
          await reloadFinancialAnalyticsStores();
          await reloadWeightStores();
        })();
      }, 500);
    };

    const isInVaultDataDir = (file: TFile) =>
      file.path.startsWith(`${VAULT_DATA_DIR}/`) || file.path === "calendar-data.json";

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && isInVaultDataDir(file)) {
          debouncedSyncReload();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && isInVaultDataDir(file)) {
          debouncedSyncReload();
        }
      })
    );

    this.addSettingTab(new CalendarSettingsTab(this.app, this));

    if (this.app.workspace.layoutReady) {
      this.initLeaf();
      this.injectDateTimeWeather();
    } else {
      this.app.workspace.onLayoutReady(() => {
        this.initLeaf();
        this.injectDateTimeWeather();
      });
    }

    // Re-inject panel when active leaf changes (move to active view)
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (this.options.dtwShowOnAllPages) {
          this.moveDateTimeWeatherToActiveView();
        }
      })
    );

    // Смена view внутри одного leaf (tasks/kanban/schedule) не кидает active-leaf-change,
    // а dtw-bar висит в DOM leaf и уничтожается — перевешиваем после переключения.
    const onTabSwitched = () => {
      if (this.options.dtwShowOnAllPages) {
        this.moveDateTimeWeatherToActiveView();
      } else {
        this.injectDateTimeWeather();
      }
    };
    document.addEventListener(VIEW_SWITCHED_EVENT, onTabSwitched);
    this.register(() =>
      document.removeEventListener(VIEW_SWITCHED_EVENT, onTabSwitched)
    );
  }

  private isMobile(): boolean {
    return typeof window !== "undefined" && window.innerWidth <= 768;
  }

  private injectDateTimeWeather(): void {
    if (!this.options.showStatusBar || this.isMobile()) {
      this.removeDateTimeWeather();
      return;
    }

    // If container still exists in DOM, don't re-inject
    if (this.dtwContainer && document.body.contains(this.dtwContainer)) return;

    // Clean up any orphaned dtw-bar elements from previous plugin loads
    document.querySelectorAll(".mcp-dtw-global").forEach((el) => el.remove());

    this.createDateTimeWeatherPanel();
  }

  private moveDateTimeWeatherToActiveView(): void {
    if (!this.options.showStatusBar || this.isMobile()) {
      this.removeDateTimeWeather();
      return;
    }

    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    if (!activeLeaf) return;

    // Don't move to sidebar leaves — only main content area
    const isSidebar = activeLeaf.view.containerEl.closest(
      ".workspace-split.left-split, .workspace-split.right-split, .workspace-split.mod-left-split, .workspace-split.mod-right-split, .sidebar"
    );
    if (isSidebar) return;

    // Always destroy old panel first to prevent duplicates
    this.removeDateTimeWeather();
    // Also clean up any orphaned elements
    document.querySelectorAll(".mcp-dtw-global").forEach((el) => el.remove());

    this.createDateTimeWeatherPanel();
  }

  private createDateTimeWeatherPanel(): void {
    const mainSplit = this.app.workspace.containerEl.querySelector(
      ".workspace-split.mod-root"
    );
    if (!mainSplit) return;

    // Find the active leaf's view-header
    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    let headerEl: Element | null = null;

    if (activeLeaf?.view?.containerEl) {
      headerEl = activeLeaf.view.containerEl.querySelector(".view-header");
    }

    // Fallback to first view-header if active leaf not found
    if (!headerEl) {
      headerEl = mainSplit.querySelector(".view-header");
    }

    // Header может быть ещё не пересобран после setViewState — повторим
    if (!headerEl) {
      window.setTimeout(() => {
        if (!this.dtwContainer && this.options.showStatusBar && !this.isMobile()) {
          this.createDateTimeWeatherPanel();
        }
      }, 80);
      return;
    }

    this.dtwContainer = createDiv({ cls: "mcp-dtw-global" });
    // Prevent clicks on dtw-bar from triggering active-leaf-change
    this.dtwContainer.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    headerEl.parentElement?.insertBefore(this.dtwContainer, headerEl.nextSibling);

    this.dtwPanel = new DateTimeWeather({
      target: this.dtwContainer,
      props: {
        onOpenCalendar: () => this.activateCalendarView(),
        onOpenFinance: () => this.activateFinanceView(),
      },
    });
  }

  private removeDateTimeWeather(): void {
    if (this.dtwPanel) {
      this.dtwPanel.$destroy();
      this.dtwPanel = null;
    }
    if (this.dtwContainer) {
      this.dtwContainer.remove();
      this.dtwContainer = null;
    }
  }

  initLeaf(): void {
    // Open calendar in right sidebar
    const existingCalLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
    if (existingCalLeaves.length === 0) {
      void this.app.workspace.getRightLeaf(false).setViewState({
        type: VIEW_TYPE_CALENDAR,
      });
    }

    // Task tracker is NOT auto-opened on startup — user opens it via ribbon icon or command
  }

  private async activateView(viewType: string): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(viewType);
    if (existing.length) {
      // Clean up duplicate leaves (keep only the first one)
      if (existing.length > 1) {
        existing.slice(1).forEach((leaf) => leaf.detach());
      }
      void workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    if (leaf) {
      await leaf.setViewState({ type: viewType, active: true });
      void workspace.revealLeaf(leaf);
    }
  }

  async activateScheduleView(): Promise<void> {
    return this.activateView(VIEW_TYPE_SCHEDULE);
  }

  async activateMobileScheduleView(): Promise<void> {
    return this.activateView(VIEW_TYPE_MOBILE_SCHEDULE);
  }

  async activateMobileTasksView(): Promise<void> {
    return this.activateView(VIEW_TYPE_MOBILE_TASKS);
  }

  async activateHabitAnalyticsView(): Promise<void> {
    return this.activateView(VIEW_TYPE_HABIT_ANALYTICS);
  }

  async activateFinanceView(): Promise<void> {
    return this.activateView(VIEW_TYPE_FINANCE);
  }

  async activateCalendarView(): Promise<void> {
    return this.activateView(VIEW_TYPE_CALENDAR);
  }

  async activateTaskView(): Promise<void> {
    return this.activateView(VIEW_TYPE_TASKS);
  }

  /** Opens the unified Finance block on the Income tab. */
  async activateFinancialAnalyticsView(): Promise<void> {
    const { requestFinanceTab } = await import("./finance/financeUiStore");
    requestFinanceTab("income");
    return this.activateView(VIEW_TYPE_FINANCE);
  }

  async activateKanbanView(): Promise<void> {
    return this.activateView(VIEW_TYPE_KANBAN);
  }

  async activateHabitPanelView(): Promise<void> {
    return this.activateView(VIEW_TYPE_HABIT_PANEL);
  }

  async activateWeatherDetailView(date?: string): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_WEATHER_DETAIL);
    if (existing.length) {
      void workspace.revealLeaf(existing[0]);
      const view = existing[0].view as WeatherDetailView;
      if (date) view.setDate(date);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_WEATHER_DETAIL, active: true });
      void workspace.revealLeaf(leaf);
      if (date) {
        const view = leaf.view as WeatherDetailView;
        view.setDate(date);
      }
    }
  }

  /**
   * Find the actual plugin directory path inside .obsidian/plugins/.
   * The folder name may differ from manifest.id (e.g. "WorkLife Calendar" vs "calendar-plugin-remastered").
   */
  async findPluginDir(): Promise<string | null> {
    const configDir = this.app.vault.configDir;
    const pluginsDir = `${configDir}/plugins`;
    try {
      const entries = await this.app.vault.adapter.list(pluginsDir);
      for (const dir of entries.folders) {
        try {
          const manifestPath = `${dir}/manifest.json`;
          if (await this.app.vault.adapter.exists(manifestPath)) {
            const raw: string = await this.app.vault.adapter.read(manifestPath);
            const manifest: { id?: string } = JSON.parse(raw) as { id?: string };
            if (manifest.id === this.manifest.id) {
              return dir;
            }
          }
        } catch {
          // skip broken manifest
        }
      }
    } catch {
      // list failed
    }
    return null;
  }

  /**
   * loadData with adapter fallback for Obsidian ≥1.13 where Plugin.loadData()
   * may return empty even when data.json exists on disk.
   */
  async loadDataSafe(): Promise<Record<string, unknown>> {
    let data: Record<string, unknown> | null = null;
    try {
      data = (await this.loadData()) as Record<string, unknown> | null;
    } catch {
      // base loadData failed
    }
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      try {
        // Find actual plugin dir (folder name may differ from manifest.id)
        const pluginDir = await this.findPluginDir();
        if (pluginDir) {
          const dataPath = `${pluginDir}/data.json`;
          if (await this.app.vault.adapter.exists(dataPath)) {
            const content: string = await this.app.vault.adapter.read(dataPath);
            if (content) data = JSON.parse(content) as Record<string, unknown>;
          }
        }
      } catch {
        // adapter fallback failed
      }
    }
    return data || {};
  }

  async loadOptions(): Promise<void> {
    const options = await this.loadDataSafe();
    const old = { ...this.options };
    settings.update((current) => {
      return {
        ...current,
        ...(options || {}),
      };
    });

    // Always save if data.json doesn't exist (first run / fresh install)
    // This ensures the file is created so settings persist across restarts.
    // Skip rewrite when the payload is unchanged — avoids Syncthing conflicts.
    const nextJson = JSON.stringify(this.options);
    if (Object.keys(options).length === 0) {
      await this.persistOptions(nextJson);
    } else if (JSON.stringify(old) !== JSON.stringify(this.options)) {
      await this.persistOptions(nextJson);
    } else {
      this.lastSavedDataJson = nextJson;
    }
  }

  /** Write data.json only when the serialized payload actually changed. */
  private async persistOptions(json?: string): Promise<void> {
    const payload = json ?? JSON.stringify(this.options);
    if (payload === this.lastSavedDataJson) return;
    this.lastSavedDataJson = payload;
    await this.saveData(this.options);
  }

  /**
   * Remove Syncthing conflict copies for calendar-data/ and plugin data.json.
   * Newest file wins; losers are deleted. Safe to call multiple times.
   */
  private async cleanupConflicts(): Promise<void> {
    if (this.options.syncConflictCleanupEnabled === false) return;
    const dirs = [VAULT_DATA_DIR, ""];
    const pluginDir = await this.findPluginDir();
    if (pluginDir) dirs.push(pluginDir);
    try {
      await cleanupSyncConflictFiles(this.app, dirs);
    } catch (e) {
      console.error("[CalendarPlugin] Conflict cleanup failed:", e);
    }
  }

  async writeOptions(changes: Partial<ISettings>): Promise<void> {
    settings.update((old) => ({ ...old, ...changes }));
    await this.persistOptions();
    if (changes.habitTrackerMode !== undefined || changes.showHabitTracker !== undefined) {
      this.updateHabitRibbonVisibility();
    }
  }

  private registerRibbonIcons(): void {
    const defs: [string, IconName, () => void][] = [
      ["main.ribbon.tasks", "checkbox-glyph", () => this.activateTaskView()],
      ["main.ribbon.calendar", "calendar-with-checkmark", () => this.activateCalendarView()],
      ["main.ribbon.analytics", "bar-chart", () => this.activateHabitAnalyticsView()],
      ["main.ribbon.finance", "coins", () => this.activateFinanceView()],
      ["main.ribbon.kanban", "layout-grid", () => this.activateKanbanView()],
      ["main.ribbon.habits", "flame", () => this.activateHabitPanelView()],
    ];

    for (const [key, icon, cb] of defs) {
      const el = this.addRibbonIcon(icon, tRaw(key), () => cb());
      el.dataset.mcpRibbon = "true";
      this.ribbonIcons.push(el);
      this.ribbonDefs.push({ el, key });
    }

    this.habitRibbonIcon = this.ribbonIcons[this.ribbonIcons.length - 1];
    this.updateHabitRibbonVisibility();
    this.ribbonIconsRegistered = true;
  }

  private updateRibbonLabels(): void {
    for (const { el, key } of this.ribbonDefs) {
      const label = tRaw(key);
      el.setAttribute("aria-label", label);
      el.setAttribute("title", label);
    }
  }

  private updateHabitRibbonVisibility(): void {
    if (!this.habitRibbonIcon) return;
    const habitMode = this.options.habitTrackerMode === "hidden" ? "hidden" : "separate";
    this.habitRibbonIcon.style.display = habitMode === "separate" ? "" : "none";
  }
}
