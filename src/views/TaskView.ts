import { ItemView, WorkspaceLeaf } from "obsidian";
import { momentFn } from "../utils/moment";
import { VIEW_TYPE_TASKS } from "../constants";
import TaskPanel from "../task-tracker/TaskPanel.svelte";
import { get } from "svelte/store";
import { tRaw } from "../i18n";
import { selectedDate, projects, taskFilter } from "../task-tracker/stores";
import type { IProject } from "../task-tracker/types";
import { getDateUID } from "obsidian-daily-notes-interface";
import {
  createViewSwitcher,
  markViewEnter,
} from "./viewSwitch";

export default class TaskView extends ItemView {
  private taskPanel: TaskPanel;
  private projectSidebar: HTMLElement | null = null;
  private panelsContainer: HTMLElement | null = null;
  private tasksUnsub: (() => void) | null = null;
  private projectsUnsub: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_TASKS;
  }

  getDisplayText(): string {
    return tRaw("tasks.panel.title");
  }

  getIcon(): string {
    return "checkbox-glyph";
  }

  onClose(): Promise<void> {
    if (this.tasksUnsub) { this.tasksUnsub(); this.tasksUnsub = null; }
    if (this.projectsUnsub) { this.projectsUnsub(); this.projectsUnsub = null; }
    if (this.taskPanel) { this.taskPanel.$destroy(); }
    return Promise.resolve();
  }

  onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("task-view");
    markViewEnter(this.contentEl);

    selectedDate.set(getDateUID(momentFn(), "day"));

    // Единый переключатель Tasks / Kanban / Schedule / Habits
    createViewSwitcher(this.contentEl, "tasks", this.leaf);

    // Main layout: sidebar + panels
    const body = this.contentEl.createDiv({ cls: "task-view-body" });
    const mainContent = body.createDiv({ cls: "task-view-main" });

    // Sidebar: project list
    const sidebar = mainContent.createDiv({ cls: "task-view-sidebar" });
    sidebar.createDiv({ cls: "task-view-sidebar-title", text: tRaw("tasks.panel.menuProjects").replace("📂 ", "") });
    this.projectSidebar = sidebar.createDiv({ cls: "task-view-sidebar-list" });

    // Panels
    const panelsCard = mainContent.createDiv({ cls: "task-view-panels" });
    this.panelsContainer = panelsCard.createDiv({ cls: "panels-container" });

    // Task panel (навигация — только через бесшовный переключатель)
    this.taskPanel = new TaskPanel({
      target: this.panelsContainer,
      props: {
        appInstance: this.app,
      },
    });

    // Project sidebar
    this.renderProjectSidebar();
    return Promise.resolve();
  }

  private renderProjectSidebar(): void {
    if (!this.projectSidebar) return;

    projects.subscribe((projectList: IProject[]) => {
      this.projectSidebar.empty();

      const allBtn = this.projectSidebar.createDiv({ cls: "task-view-sidebar-btn" });
      allBtn.createDiv({ cls: "task-view-sidebar-icon", text: "📂" });
      allBtn.createDiv({ cls: "task-view-sidebar-name", text: tRaw("tasks.tabs.all") });
      const filter: { projectId: string | null } = get(taskFilter);
      if (filter.projectId === null) allBtn.addClass("active");
      allBtn.addEventListener("click", () => taskFilter.update((f) => ({ ...f, projectId: null })));

      const activeProjects = projectList.filter((p) => !p.archived);
      for (const project of activeProjects) {
        const btn = this.projectSidebar.createDiv({ cls: "task-view-sidebar-btn" });
        btn.style.setProperty("--project-color", project.color || "var(--mcp-accent)");
        btn.createDiv({ cls: "task-view-sidebar-icon", text: project.icon || "📁" });
        btn.createDiv({ cls: "task-view-sidebar-name", text: project.name });
        if (filter.projectId === project.id) btn.addClass("active");
        btn.addEventListener("click", () => {
          taskFilter.update((f) => ({
            ...f,
            projectId: f.projectId === project.id ? null : project.id,
          }));
        });
      }
    });

    taskFilter.subscribe(() => {
      if (!this.projectSidebar) return;
      const currentFilter: { projectId: string | null } = get(taskFilter);
      const buttons = this.projectSidebar.querySelectorAll(".task-view-sidebar-btn");
      buttons.forEach((btn, i) => {
        if (i === 0) {
          btn.classList.toggle("active", currentFilter.projectId === null);
        } else {
          const projectList: IProject[] = get(projects);
          const activeProjects = projectList.filter((p) => !p.archived);
          const project = activeProjects[i - 1];
          if (project) btn.classList.toggle("active", currentFilter.projectId === project.id);
        }
      });
    });
  }
}
