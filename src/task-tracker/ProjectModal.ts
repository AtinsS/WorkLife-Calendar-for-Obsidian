import type { App } from "obsidian";
import { get } from "svelte/store";
import { CustomModal } from "../ui/CustomModal";
import { tRaw } from "../i18n";

import type { IProject } from "./types";
import { DEFAULT_PROJECT_COLORS } from "./types";
import {
  projects,
  tasks,
  addProject,
  updateProject,
  removeProject,
} from "./stores";

const RECENT_ICONS_KEY = "calendar-recent-icons";
const MAX_RECENT = 10;

function getRecentIcons(app: App): string[] {
  try {
    const raw: unknown = app.loadLocalStorage(RECENT_ICONS_KEY);
    return typeof raw === "string" ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}

function addRecentIcon(app: App, emoji: string): void {
  const recent = getRecentIcons(app).filter((e) => e !== emoji);
  recent.unshift(emoji);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  app.saveLocalStorage(RECENT_ICONS_KEY, JSON.stringify(recent));
}

function renderColorPicker(
  container: HTMLElement,
  currentColor: string,
  onSelect: (hex: string) => void,
): void {
  container.empty();
  const grid = container.createDiv("pm-color-grid");
  const presets = DEFAULT_PROJECT_COLORS.includes(currentColor)
    ? DEFAULT_PROJECT_COLORS
    : [currentColor, ...DEFAULT_PROJECT_COLORS];

  const swatches: HTMLElement[] = [];
  const selectSwatch = (hex: string, el: HTMLElement) => {
    swatches.forEach((s) => s.removeClass("active"));
    el.addClass("active");
    onSelect(hex);
  };

  presets.forEach((color) => {
    const swatch = grid.createDiv("pm-color-swatch");
    swatch.style.setProperty("--swatch-color", color);
    swatch.title = color;
    if (color === currentColor) swatch.addClass("active");
    swatch.addEventListener("click", () => {
      customInput.value = color;
      selectSwatch(color, swatch);
    });
    swatches.push(swatch);
  });

  // Custom color: native picker + hex field
  const custom = grid.createDiv("pm-color-custom");
  const customBtn = custom.createEl("button", {
    cls: "pm-color-swatch pm-color-custom-btn",
    attr: { type: "button", title: "Custom color" },
  });
  customBtn.createSpan({ text: "✦", cls: "pm-color-custom-glyph" });
  swatches.push(customBtn);

  const customInput = custom.createEl("input", {
    cls: "pm-color-custom-input",
    attr: { type: "color", value: currentColor, title: "Pick color" },
  });
  customBtn.addEventListener("click", () => customInput.click());
  customInput.addEventListener("input", () => {
    const hex = customInput.value;
    customBtn.style.setProperty("--swatch-color", hex);
    selectSwatch(hex, customBtn);
  });

  // Sync custom button preview with current color
  customBtn.style.setProperty("--swatch-color", currentColor);
  if (!DEFAULT_PROJECT_COLORS.includes(currentColor)) {
    swatches.forEach((s) => s.removeClass("active"));
    customBtn.addClass("active");
  }
}

function renderIconPicker(
  app: App,
  container: HTMLElement,
  currentIcon: string,
  onSelect: (emoji: string) => void,
): HTMLInputElement {
  container.empty();

  // Custom input
  const customRow = container.createDiv("pm-icon-custom-row");
  customRow.createEl("label", { text: tRaw("tasks.project.icon"), cls: "pm-label" });
  const inputWrap = customRow.createDiv("pm-icon-input-wrap");
  const input = inputWrap.createEl("input", {
    cls: "pm-icon-custom-input",
    attr: { type: "text", placeholder: "📁", maxlength: "4", value: currentIcon },
  });
  const applyBtn = inputWrap.createEl("button", { text: "✓", cls: "pm-icon-apply-btn" });

  function applyIcon() {
    const val = input.value.trim();
    if (val) {
      onSelect(val);
      addRecentIcon(app, val);
      renderRecentSection();
    }
  }

  applyBtn.addEventListener("click", applyIcon);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyIcon();
  });
  input.addEventListener("input", () => {
    onSelect(input.value.trim() || "📁");
  });

  // Recently used
  const recentSection = container.createDiv("pm-icon-recent");
  recentSection.createEl("label", { text: tRaw("tasks.project.recent"), cls: "pm-label" });
  const recentGrid = recentSection.createDiv("pm-icon-grid");

  function renderRecentSection() {
    recentGrid.empty();
    const recent = getRecentIcons(app);
    if (recent.length === 0) {
      recentSection.addClass("mcp-hidden");
      return;
    }
    recentSection.removeClass("mcp-hidden");
    recent.forEach((emoji) => {
      const btn = recentGrid.createDiv("pm-icon-btn");
      btn.textContent = emoji;
      btn.title = emoji;
      btn.addEventListener("click", () => {
        input.value = emoji;
        onSelect(emoji);
        recentGrid.querySelectorAll(".pm-icon-btn").forEach((b) => b.removeClass("active"));
        btn.addClass("active");
      });
    });
  }

  renderRecentSection();

  return input;
}

export class ProjectModal extends CustomModal {
  private showAddForm = false;

  onOpen(): void {
    this.contentEl.empty();
    this.containerEl.addClass("wf-project-modal");

    const allProjects = get(projects);
    // Auto-open add form when there are no projects yet
    if (allProjects.length === 0 && !this.showAddForm) {
      this.showAddForm = true;
    }

    this.renderHeader(this.contentEl);
    if (this.showAddForm) {
      this.renderNewProjectForm(this.contentEl);
    }
    this.renderProjectList(this.contentEl);
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv("pm-modal-header");
    const left = header.createDiv("pm-modal-header-left");
    left.createDiv({ text: "🗂", cls: "pm-modal-header-icon" });
    const headerText = left.createDiv("pm-modal-header-text");
    headerText.createEl("h2", { text: tRaw("tasks.project.title") });
    headerText.createEl("p", {
      text: tRaw("tasks.project.subtitle"),
      cls: "wf-dialog-subtitle",
    });

    const addBtn = header.createEl("button", {
      text: this.showAddForm ? tRaw("common.cancel") : `+ ${tRaw("tasks.project.newProject")}`,
      cls: this.showAddForm ? "pm-header-btn" : "pm-header-btn mod-cta",
    });
    addBtn.addEventListener("click", () => {
      this.showAddForm = !this.showAddForm;
      this.rerender();
    });
  }

  private renderNewProjectForm(container: HTMLElement): void {
    const section = container.createDiv("pm-new-project pm-new-project-open");

    const header = section.createDiv("pm-section-header");
    header.createSpan({ text: "+", cls: "pm-section-icon" });
    header.createSpan({ text: tRaw("tasks.project.newProject"), cls: "pm-section-title" });

    const body = section.createDiv("pm-section-body");

    let newName = "";
    let newColor = DEFAULT_PROJECT_COLORS[0];
    let newIcon = "📁";

    // Name input
    const nameField = body.createDiv("pm-field");
    nameField.createEl("label", { text: tRaw("tasks.project.name"), cls: "pm-label" });
    const nameInput = nameField.createEl("input", {
      cls: "pm-input",
      attr: { type: "text", placeholder: tRaw("tasks.project.namePlaceholder"), maxlength: "60" },
    });
    const charCount = nameField.createSpan({ text: "0/60", cls: "pm-char-count" });
    nameInput.addEventListener("input", () => {
      newName = nameInput.value;
      charCount.textContent = `${newName.length}/60`;
      updatePreview();
    });

    // Color + Icon row
    const row = body.createDiv("pm-row");

    const colorSection = row.createDiv("pm-color-section");
    colorSection.createEl("label", { text: tRaw("tasks.project.color"), cls: "pm-label" });
    renderColorPicker(colorSection, newColor, (hex) => {
      newColor = hex;
      updatePreview();
    });

    const iconSection = row.createDiv("pm-icon-section");
    renderIconPicker(this.app, iconSection, newIcon, (emoji) => {
      newIcon = emoji;
      updatePreview();
    });

    // Preview
    const preview = body.createDiv("pm-preview");
    preview.createEl("label", { text: tRaw("tasks.project.preview"), cls: "pm-label" });
    const previewCard = preview.createDiv("pm-preview-card");

    const previewDot = previewCard.createDiv("pm-preview-dot");
    previewDot.style.setProperty("--dot-color", newColor);
    const previewIcon = previewCard.createSpan("pm-preview-icon");
    previewIcon.textContent = newIcon;
    const previewName = previewCard.createSpan("pm-preview-name");
    previewName.textContent = tRaw("tasks.project.name");

    function updatePreview() {
      previewDot.style.setProperty("--dot-color", newColor);
      previewIcon.textContent = newIcon;
      previewName.textContent = newName || tRaw("tasks.project.name");
    }

    // Actions
    const actions = body.createDiv("pm-form-actions");
    const cancelBtn = actions.createEl("button", {
      text: tRaw("common.cancel"),
      cls: "pm-cancel-btn",
    });
    cancelBtn.addEventListener("click", () => {
      this.showAddForm = get(projects).length > 0;
      this.rerender();
    });

    const createBtn = actions.createEl("button", {
      text: tRaw("tasks.project.create"),
      cls: "pm-create-btn mod-cta",
    });
    createBtn.addEventListener("click", () => {
      if (!newName.trim()) {
        nameInput.focus();
        nameInput.classList.add("pm-input-error");
        window.setTimeout(() => nameInput.classList.remove("pm-input-error"), 1500);
        return;
      }
      addRecentIcon(this.app, newIcon);
      addProject({
        name: newName.trim(),
        color: newColor,
        icon: newIcon,
        folder: null,
        archived: false,
        sortOrder: get(projects).length,
      });
      this.showAddForm = false;
      this.rerender();
    });

    window.setTimeout(() => nameInput.focus(), 50);
  }

  private renderProjectList(container: HTMLElement): void {
    const section = container.createDiv("pm-existing");
    const header = section.createDiv("pm-section-header");
    header.createSpan({ text: "🗂", cls: "pm-section-icon" });
    header.createSpan({ text: tRaw("tasks.project.existingProjects"), cls: "pm-section-title" });

    const allProjects = get(projects);
    const allTasks = get(tasks);

    if (allProjects.length === 0) {
      section.createEl("p", {
        text: tRaw("tasks.project.empty"),
        cls: "pm-empty",
      });
      return;
    }

    const list = section.createDiv("pm-project-list");

    allProjects.forEach((project) => {
      const projectTasks = allTasks.filter((t) => t.projectId === project.id);
      const taskCount = projectTasks.filter((t) => t.status !== "done" && t.status !== "failed").length;
      const doneCount = projectTasks.filter((t) => t.status === "done").length;
      const failedCount = projectTasks.filter((t) => t.status === "failed").length;

      const item = list.createDiv("pm-project-item");
      item.style.setProperty("--project-color", project.color);

      const left = item.createDiv("pm-project-left");
      const dot = left.createDiv("pm-project-dot");
      dot.style.setProperty("--dot-color", project.color);
      left.createSpan({ text: project.icon, cls: "pm-project-icon" });
      const info = left.createDiv("pm-project-info");
      info.createSpan({ text: project.name, cls: "pm-project-name" });

      const stats = info.createDiv("pm-project-stats");
      if (taskCount > 0) {
        stats.createSpan({ text: tRaw("tasks.project.activeCount", { count: taskCount }), cls: "pm-stat pm-stat-active" });
      }
      if (doneCount > 0) {
        stats.createSpan({ text: tRaw("tasks.project.doneCount", { count: doneCount }), cls: "pm-stat pm-stat-done" });
      }
      if (failedCount > 0) {
        stats.createSpan({ text: tRaw("tasks.project.failedCount", { count: failedCount }), cls: "pm-stat pm-stat-failed" });
      }

      const actions = item.createDiv("pm-project-actions");

      const editBtn = actions.createEl("button", { cls: "pm-action-btn pm-edit-btn", text: "✎" });
      editBtn.title = tRaw("common.edit");
      editBtn.addEventListener("click", () => this.openEditProject(project));

      const deleteBtn = actions.createEl("button", { cls: "pm-action-btn pm-delete-btn", text: "✕" });
      deleteBtn.title = tRaw("common.delete");
      deleteBtn.addEventListener("click", () => {
        new DeleteConfirmModal(this.app, project.name, () => {
          removeProject(project.id);
          this.rerender();
        }).open();
      });
    });
  }

  private openEditProject(project: IProject): void {
    // Keep the list open underneath — just refresh it after save
    const modal = new EditProjectModal(this.app, project, () => {
      this.rerender();
    });
    modal.open();
  }

  private rerender(): void {
    this.contentEl.empty();
    this.onOpen();
  }
}

class EditProjectModal extends CustomModal {
  private project: IProject;
  private onClosed: () => void;

  constructor(app: App, project: IProject, onClosed: () => void) {
    super(app);
    this.project = project;
    this.onClosed = onClosed;
  }

  onOpen(): void {
    this.containerEl.addClass("wf-project-modal");
    this.containerEl.addClass("wf-edit-modal");

    this.contentEl.createEl("h2", { text: tRaw("tasks.project.editProject") });

    let name = this.project.name;
    let color = this.project.color;
    let icon = this.project.icon;

    // Name
    const nameField = this.contentEl.createDiv("pm-field");
    nameField.createEl("label", { text: tRaw("tasks.project.name"), cls: "pm-label" });
    const nameInput = nameField.createEl("input", {
      cls: "pm-input",
      attr: { type: "text", placeholder: tRaw("tasks.project.name"), value: name, maxlength: "50" },
    });
    nameInput.addEventListener("input", () => { name = nameInput.value; });

    // Color
    const colorSection = this.contentEl.createDiv("pm-color-section");
    colorSection.createEl("label", { text: tRaw("tasks.project.color"), cls: "pm-label" });
    renderColorPicker(colorSection, color, (hex) => {
      color = hex;
    });

    // Icon
    const iconSection = this.contentEl.createDiv("pm-icon-section");
    renderIconPicker(this.app, iconSection, icon, (emoji) => {
      icon = emoji;
    });

    // Buttons
    const buttonsEl = this.contentEl.createDiv("pm-modal-buttons");

    const cancelBtn = buttonsEl.createEl("button", { text: tRaw("common.cancel"), cls: "pm-cancel-btn" });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = buttonsEl.createEl("button", { text: tRaw("common.save"), cls: "pm-save-btn" });
    saveBtn.addEventListener("click", () => {
      if (!name.trim()) {
        nameInput.focus();
        nameInput.classList.add("pm-input-error");
        window.setTimeout(() => nameInput.classList.remove("pm-input-error"), 1500);
        return;
      }
      addRecentIcon(this.app, icon);
      updateProject(this.project.id, {
        name: name.trim(),
        color,
        icon: icon || "📁",
        folder: null,
      });
      this.close();
    });
  }

  onClose(): void {
    this.onClosed();
  }
}

class DeleteConfirmModal extends CustomModal {
  private name: string;
  private onConfirm: () => void;

  constructor(app: App, name: string, onConfirm: () => void) {
    super(app);
    this.name = name;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: tRaw("tasks.project.deleteConfirm", { name: this.name }) });
    const btnRow = contentEl.createDiv({ cls: "pm-modal-buttons" });
    btnRow.createEl("button", { text: tRaw("common.cancel"), cls: "pm-btn" }).addEventListener("click", () => this.close());
    btnRow.createEl("button", { text: tRaw("common.delete"), cls: "pm-btn pm-btn-danger" }).addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose(): void {
    // required by CustomModal
  }
}
