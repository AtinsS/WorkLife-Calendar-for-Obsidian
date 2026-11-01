import { ItemView, WorkspaceLeaf } from "obsidian";
import { momentFn } from "../utils/moment";
import { VIEW_TYPE_TASKS } from "../constants";
import TaskPanel from "../task-tracker/TaskPanel.svelte";
import { get } from "svelte/store";
import { tRaw } from "../i18n";
import { selectedDate, projects, taskFilter, removeProject } from "../task-tracker/stores";
import type { IProject } from "../task-tracker/types";
import { ProjectFormModal, DeleteConfirmModal } from "../task-tracker/ProjectModal";
import { getDateUID } from "obsidian-daily-notes-interface";
import {
  createViewSwitcher,
  markViewEnter,
} from "./viewSwitch";

/** Persisted pixel width of the projects sidebar (localStorage). */
const SIDEBAR_WIDTH_KEY = "task-view-sidebar-width";
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 200;

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

    // Sidebar: project list (user-resizable width)
    const sidebar = mainContent.createDiv({ cls: "task-view-sidebar" });
    this.applySidebarWidth(sidebar, this.loadSidebarWidth());
    const sidebarTitle = sidebar.createDiv({ cls: "task-view-sidebar-title" });
    sidebarTitle.createSpan({ text: tRaw("tasks.panel.menuProjects").replace("📂 ", "") });
    const addProjectBtn = sidebarTitle.createEl("button", {
      cls: "task-view-sidebar-add-btn",
      text: "+",
      attr: { type: "button", title: tRaw("tasks.project.newProject"), "aria-label": tRaw("tasks.project.newProject") },
    });
    addProjectBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      new ProjectFormModal(this.app, null).open();
    });
    this.projectSidebar = sidebar.createDiv({ cls: "task-view-sidebar-list" });

    // Drag handle between sidebar and panels — resizes the projects sidebar
    const resizeHandle = mainContent.createDiv({ cls: "task-view-sidebar-resize" });
    resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      resizeHandle.addClass("dragging");
      document.body.classList.add("task-view-sidebar-resizing");
      const startX = e.clientX;
      const startWidth = sidebar.getBoundingClientRect().width;
      const onMove = (ev: MouseEvent) => {
        this.applySidebarWidth(sidebar, startWidth + (ev.clientX - startX));
      };
      const onUp = () => {
        resizeHandle.removeClass("dragging");
        document.body.classList.remove("task-view-sidebar-resizing");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        this.app.saveLocalStorage(SIDEBAR_WIDTH_KEY, Math.round(sidebar.getBoundingClientRect().width));
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

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

  private loadSidebarWidth(): number {
    const raw = Number(this.app.loadLocalStorage(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : SIDEBAR_DEFAULT_WIDTH;
  }

  private applySidebarWidth(sidebar: HTMLElement, width: number): void {
    const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)));
    sidebar.style.flex = `0 0 ${clamped}px`;
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

        // CRUD: update / delete (create lives in the sidebar "+" button)
        const actions = btn.createDiv({ cls: "task-view-sidebar-actions" });
        const editBtn = actions.createEl("button", {
          cls: "task-view-sidebar-action-btn",
          text: "✎",
          attr: { type: "button", title: tRaw("common.edit"), "aria-label": tRaw("common.edit") },
        });
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          new ProjectFormModal(this.app, project).open();
        });

        const deleteBtn = actions.createEl("button", {
          cls: "task-view-sidebar-action-btn task-view-sidebar-delete-btn",
          text: "✕",
          attr: { type: "button", title: tRaw("common.delete"), "aria-label": tRaw("common.delete") },
        });
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          new DeleteConfirmModal(this.app, project.name, () => {
            const f: { projectId: string | null } = get(taskFilter);
            if (f.projectId === project.id) {
              taskFilter.update((s) => ({ ...s, projectId: null }));
            }
            removeProject(project.id);
          }).open();
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
