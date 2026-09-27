import type { WorkspaceLeaf } from "obsidian";
import {
  VIEW_TYPE_TASKS,
  VIEW_TYPE_MOBILE_TASKS,
  VIEW_TYPE_KANBAN,
  VIEW_TYPE_SCHEDULE,
  VIEW_TYPE_MOBILE_SCHEDULE,
  VIEW_TYPE_HABIT_PANEL,
} from "../constants";
import { tRaw } from "../i18n";
import { get } from "svelte/store";
import { settings } from "../ui/stores";
import { prefersReducedMotion } from "../utils/visualMotion";

export type WorkspaceTab = "tasks" | "kanban" | "schedule" | "habits";

export function resolveViewType(tab: WorkspaceTab): string {
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  switch (tab) {
    case "tasks":
      return isMobile ? VIEW_TYPE_MOBILE_TASKS : VIEW_TYPE_TASKS;
    case "kanban":
      return VIEW_TYPE_KANBAN;
    case "schedule":
      return isMobile ? VIEW_TYPE_MOBILE_SCHEDULE : VIEW_TYPE_SCHEDULE;
    case "habits":
      return VIEW_TYPE_HABIT_PANEL;
    default:
      return VIEW_TYPE_TASKS;
  }
}

const LEAVE_MS = 130;

/** Событие после смены view — main.ts перевешивает dtw-bar. */
export const VIEW_SWITCHED_EVENT = "mcp:workspace-tab-switched";

/** Fade-out → setViewState → новый view проигрывает enter-анимацию. */
export function switchWorkspaceTab(leaf: WorkspaceLeaf, tab: WorkspaceTab): void {
  const target = resolveViewType(tab);
  const view = leaf.view as { containerEl?: HTMLElement } | null;
  const content = view?.containerEl?.children[1] as HTMLElement | undefined;

  const finish = () => {
    void leaf.setViewState({ type: target, active: true }).then(() => {
      // dtw-bar висит внутри leaf и уничтожается при смене view — даём сигнал
      window.setTimeout(() => {
        document.dispatchEvent(new CustomEvent(VIEW_SWITCHED_EVENT));
      }, 30);
    });
  };

  if (!content || prefersReducedMotion()) {
    finish();
    return;
  }

  content.classList.add("view-switch-leave");
  window.setTimeout(() => {
    content.classList.remove("view-switch-leave");
    finish();
  }, LEAVE_MS);
}

/** Пометить контент вида для enter-анимации после переключения. */
export function markViewEnter(container: HTMLElement): void {
  if (prefersReducedMotion()) return;
  container.classList.add("view-switch-enter");
  window.setTimeout(() => container.classList.remove("view-switch-enter"), 360);
}

interface SwitchButton {
  tab: WorkspaceTab;
  icon: string;
  label: string;
}

function switchButtons(): SwitchButton[] {
  const btns: SwitchButton[] = [
    {
      tab: "tasks",
      icon: "✅",
      label: tRaw("tasks.panel.title"),
    },
    {
      tab: "kanban",
      icon: "▦",
      label: tRaw("kanban.title"),
    },
    {
      tab: "schedule",
      icon: "📅",
      label: tRaw("hello.navSchedule"),
    },
  ];
  const mode = get(settings).habitTrackerMode;
  if (mode !== "hidden") {
    btns.push({
      tab: "habits",
      icon: "🔥",
      label: tRaw("habits.panel.title"),
    });
  }
  return btns;
}

/**
 * Единый segmented-control переключатель:
 * Задачи / Канбан / Расписание / Привычки.
 * Видимость управляется настройкой viewSwitcherMode.
 * Возвращает header-элемент или null, если переключатель скрыт.
 */
export function createViewSwitcher(
  parent: HTMLElement,
  active: WorkspaceTab,
  leaf: WorkspaceLeaf,
): HTMLElement | null {
  const mode = get(settings).viewSwitcherMode ?? "everywhere";
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  if (mode === "hidden") return null;
  if (mode === "desktop" && isMobile) return null;
  if (mode === "mobile" && !isMobile) return null;

  const header = parent.createDiv({ cls: "view-switch-header" });
  const track = header.createDiv({ cls: "view-switch-track" });

  for (const btn of switchButtons()) {
    const el = track.createEl("button", {
      cls: "view-switch-btn" + (btn.tab === active ? " active" : ""),
      attr: {
        type: "button",
        title: btn.label,
        "aria-pressed": btn.tab === active ? "true" : "false",
      },
    });
    el.createSpan({ cls: "view-switch-icon", text: btn.icon });
    el.createSpan({ cls: "view-switch-label", text: btn.label });
    el.addEventListener("click", () => {
      if (btn.tab === active) return;
      switchWorkspaceTab(leaf, btn.tab);
    });
  }

  return header;
}
