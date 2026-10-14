import type { App } from "obsidian";
import { get } from "svelte/store";
import { CustomModal } from "../ui/CustomModal";
import { tRaw } from "../i18n";
import { generateId } from "../utils/id";
import type { IKanbanColumnDef, TaskStatus } from "./types";
import { DEFAULT_PROJECT_COLORS } from "./types";
import {
  kanbanBoards,
  addKanbanBoard,
  updateKanbanBoard,
  removeKanbanBoard,
  addKanbanColumn,
  updateKanbanColumn,
  removeKanbanColumn,
} from "./stores";

const STATUS_OPTIONS: TaskStatus[] = ["todo", "progress", "paused", "done", "failed"];

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "tasks.kanban.todo",
  progress: "tasks.kanban.progress",
  paused: "tasks.kanban.paused",
  done: "tasks.kanban.done",
  failed: "tasks.kanban.failed",
  all: "tasks.tabs.all",
};

const DEFAULT_COL_ICONS = ["📋", "🚀", "⏸", "✅", "❌", "🔥", "💡", "📦"];

/**
 * Create / edit custom kanban boards with custom columns.
 * Also lets the user mark a board as the default view.
 */
export class KanbanBoardModal extends CustomModal {
  private editingBoardId: string | null = null;
  private draftName = "";
  private draftIcon = "📋";
  private draftColumns: IKanbanColumnDef[] = [];
  private defaultBoardId: string;
  private onDefaultChange?: (boardId: string) => void;

  constructor(
    app: App,
    opts?: {
      editBoardId?: string | null;
      defaultBoardId?: string;
      onDefaultChange?: (boardId: string) => void;
    },
  ) {
    super(app);
    this.editingBoardId = opts?.editBoardId ?? null;
    this.defaultBoardId = opts?.defaultBoardId || "default";
    this.onDefaultChange = opts?.onDefaultChange;

    if (this.editingBoardId) {
      const existing = get(kanbanBoards).find((b) => b.id === this.editingBoardId);
      if (existing) {
        this.draftName = existing.name;
        this.draftIcon = existing.icon || "📋";
        this.draftColumns = existing.columns.map((c) => ({ ...c, statuses: [...c.statuses] }));
      }
    } else {
      this.draftColumns = [
        {
          id: generateId(),
          title: tRaw("tasks.kanban.todo"),
          icon: "📋",
          color: DEFAULT_PROJECT_COLORS[3],
          statuses: ["todo"],
        },
        {
          id: generateId(),
          title: tRaw("tasks.kanban.progress"),
          icon: "🔥",
          color: DEFAULT_PROJECT_COLORS[2],
          statuses: ["progress"],
        },
        {
          id: generateId(),
          title: tRaw("tasks.kanban.done"),
          icon: "✅",
          color: DEFAULT_PROJECT_COLORS[7],
          statuses: ["done"],
        },
      ];
    }
  }

  onOpen(): void {
    this.containerEl.addClass("kbm-board-modal");
    this.contentEl.addClass("kbm-modal");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();

    const head = this.contentEl.createDiv("kbm-head");
    head.createEl("h2", {
      text: this.editingBoardId
        ? tRaw("kanban.editBoard")
        : tRaw("kanban.newBoard"),
      cls: "kbm-title",
    });

    // ── Board name + icon ──
    const nameRow = this.contentEl.createDiv("kbm-field");
    nameRow.createEl("label", { text: tRaw("kanban.boardName"), cls: "kbm-label" });
    const nameInput = nameRow.createEl("input", {
      cls: "kbm-input",
      attr: {
        type: "text",
        placeholder: tRaw("kanban.boardNamePlaceholder"),
        maxlength: "60",
        value: this.draftName,
      },
    });
    nameInput.addEventListener("input", () => {
      this.draftName = nameInput.value;
    });

    const iconRow = this.contentEl.createDiv("kbm-field");
    iconRow.createEl("label", { text: tRaw("kanban.boardIcon"), cls: "kbm-label" });
    const iconGrid = iconRow.createDiv("kbm-icon-grid");
    for (const emoji of DEFAULT_COL_ICONS) {
      const btn = iconGrid.createEl("button", {
        cls: "kbm-icon-btn" + (emoji === this.draftIcon ? " is-active" : ""),
        text: emoji,
        attr: { type: "button" },
      });
      btn.addEventListener("click", () => {
        this.draftIcon = emoji;
        iconGrid.querySelectorAll(".kbm-icon-btn").forEach((b) => b.removeClass("is-active"));
        btn.addClass("is-active");
      });
    }

    // ── Columns ──
    const colSection = this.contentEl.createDiv("kbm-section");
    const colHead = colSection.createDiv("kbm-section-head");
    colHead.createSpan({ text: tRaw("kanban.columns"), cls: "kbm-section-title" });
    const addColBtn = colHead.createEl("button", {
      text: `+ ${tRaw("kanban.newColumn")}`,
      cls: "kbm-add-col-btn",
      attr: { type: "button" },
    });
    addColBtn.addEventListener("click", () => {
      this.draftColumns = [
        ...this.draftColumns,
        {
          id: generateId(),
          title: "",
          icon: DEFAULT_COL_ICONS[this.draftColumns.length % DEFAULT_COL_ICONS.length],
          color: DEFAULT_PROJECT_COLORS[this.draftColumns.length % DEFAULT_PROJECT_COLORS.length],
          statuses: [],
          autoStartTimer: true,
        },
      ];
      this.render();
    });

    const colList = colSection.createDiv("kbm-col-list");
    colList.createDiv({ cls: "kbm-dnd-hint", text: tRaw("kanban.dragToReorder") });
    this.draftColumns.forEach((col, idx) => {
      this.renderColumnEditor(colList, col, idx);
    });
    this.wireColumnDnD(colList);

    if (this.draftColumns.length === 0) {
      colList.createDiv({ cls: "kbm-empty", text: tRaw("kanban.emptyColumns") });
    }

    // ── Actions ──
    const actions = this.contentEl.createDiv("kbm-actions");

    if (this.editingBoardId) {
      const delBtn = actions.createEl("button", {
        text: tRaw("kanban.deleteBoard"),
        cls: "kbm-danger-btn",
        attr: { type: "button" },
      });
      delBtn.addEventListener("click", () => this.deleteBoard());
    }

    const cancel = actions.createEl("button", {
      text: tRaw("common.cancel"),
      cls: "kbm-cancel-btn",
      attr: { type: "button" },
    });
    cancel.addEventListener("click", () => this.close());

    const save = actions.createEl("button", {
      text: tRaw("common.save"),
      cls: "kbm-save-btn mod-cta",
      attr: { type: "button" },
    });
    save.addEventListener("click", () => this.save());
  }

  private renderColumnEditor(host: HTMLElement, col: IKanbanColumnDef, idx: number): void {
    const row = host.createDiv("kbm-col-row");
    row.setAttribute("draggable", "true");
    row.dataset.colId = col.id;
    row.dataset.colIdx = String(idx);
    row.addClass("kbm-col-row-drag");

    const top = row.createDiv("kbm-col-top");
    const dragHandle = top.createSpan({ cls: "kbm-dnd-handle", text: "⠿", attr: { title: tRaw("kanban.dragToReorder") } });
    dragHandle.addClass("kbm-dnd-handle");

    const iconInp = top.createEl("input", {
      cls: "kbm-col-icon",
      attr: { type: "text", maxlength: "4", value: col.icon, title: tRaw("kanban.columnIcon") },
    });
    iconInp.addEventListener("input", () => {
      col.icon = iconInp.value;
    });

    const titleInp = top.createEl("input", {
      cls: "kbm-col-title kbm-input",
      attr: {
        type: "text",
        placeholder: tRaw("kanban.columnTitlePlaceholder"),
        maxlength: "40",
        value: col.title,
      },
    });
    titleInp.addEventListener("input", () => {
      col.title = titleInp.value;
    });

    const colorInp = top.createEl("input", {
      cls: "kbm-col-color",
      attr: { type: "color", value: col.color, title: tRaw("kanban.columnColor") },
    });
    colorInp.addEventListener("input", () => {
      col.color = colorInp.value;
    });

    const delBtn = top.createEl("button", {
      text: "✕",
      cls: "kbm-col-del",
      attr: { type: "button", title: tRaw("kanban.deleteColumn") },
    });
    delBtn.addEventListener("click", () => {
      if (this.draftColumns.length <= 1) return;
      this.draftColumns = this.draftColumns.filter((c) => c.id !== col.id);
      this.render();
    });

    // Status chips — empty statuses = free-form column
    const statusWrap = row.createDiv("kbm-col-statuses");
    statusWrap.createSpan({ text: tRaw("kanban.columnStatuses"), cls: "kbm-label" });
    const chips = statusWrap.createDiv("kbm-status-chips");

    const isFreeForm = col.statuses.length === 0;
    const noneChip = chips.createEl("button", {
      text: tRaw("kanban.noStatus"),
      cls: "kbm-status-chip kbm-status-none" + (isFreeForm ? " is-active" : ""),
      attr: { type: "button" },
    });
    noneChip.addEventListener("click", () => {
      col.statuses = [];
      this.render();
    });

    for (const st of STATUS_OPTIONS) {
      const active = col.statuses.includes(st);
      const chip = chips.createEl("button", {
        text: tRaw(STATUS_LABELS[st]),
        cls: "kbm-status-chip" + (active ? " is-active" : ""),
        attr: { type: "button" },
      });
      chip.addEventListener("click", () => {
        if (col.statuses.includes(st)) {
          col.statuses = col.statuses.filter((s) => s !== st);
        } else {
          col.statuses = [...col.statuses, st];
        }
        this.render();
      });
    }

    if (isFreeForm) {
      statusWrap.createDiv({ cls: "kbm-status-hint", text: tRaw("kanban.noStatusHint") });
    }

    // Timer checkbox — only when this column maps to «В работе»
    if (col.statuses.includes("progress")) {
      const timerWrap = row.createDiv("kbm-col-timer");
      const timerId = `kbm-timer-${col.id}`;
      const label = timerWrap.createEl("label", { cls: "kbm-timer-label", attr: { for: timerId } });
      const cb = label.createEl("input", {
        cls: "kbm-timer-cb",
        attr: {
          type: "checkbox",
          id: timerId,
          ...(col.autoStartTimer !== false ? { checked: "checked" } : {}),
        },
      });
      cb.addEventListener("change", () => {
        col.autoStartTimer = cb.checked;
      });
      label.createSpan({ text: tRaw("kanban.autoStartTimer") });
      timerWrap.createDiv({ cls: "kbm-status-hint", text: tRaw("kanban.autoStartTimerDesc") });
    }
  }

  /** HTML5 drag & drop reorder for column rows (replaces the old ↑/↓ buttons). */
  private wireColumnDnD(list: HTMLElement): void {
    let dragId: string | null = null;

    list.querySelectorAll<HTMLElement>(".kbm-col-row").forEach((row) => {
      row.addEventListener("dragstart", (e: DragEvent) => {
        dragId = row.dataset.colId || null;
        row.addClass("is-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", dragId || "");
        }
      });
      row.addEventListener("dragend", () => {
        row.removeClass("is-dragging");
        dragId = null;
        list.querySelectorAll(".kbm-col-row").forEach((r) => r.removeClass("is-drag-over"));
      });
      row.addEventListener("dragover", (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        row.addClass("is-drag-over");
      });
      row.addEventListener("dragleave", () => {
        row.removeClass("is-drag-over");
      });
      row.addEventListener("drop", (e: DragEvent) => {
        e.preventDefault();
        row.removeClass("is-drag-over");
        const targetId = row.dataset.colId;
        const sourceId = dragId || e.dataTransfer?.getData("text/plain") || null;
        if (!sourceId || !targetId || sourceId === targetId) return;
        const from = this.draftColumns.findIndex((c) => c.id === sourceId);
        const to = this.draftColumns.findIndex((c) => c.id === targetId);
        if (from < 0 || to < 0) return;
        const next = [...this.draftColumns];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        this.draftColumns = next;
        this.render();
      });
    });
  }

  private save(): void {
    const name = this.draftName.trim() || tRaw("kanban.boardNamePlaceholder");
    // Keep free-form columns (empty statuses) — drop only rows with nothing at all
    const columns = this.draftColumns.map((c) => ({
      ...c,
      title: c.title.trim() || tRaw("kanban.columnTitlePlaceholder"),
      icon: c.icon || "📋",
      autoStartTimer: c.autoStartTimer !== false,
    }));

    if (columns.length === 0) return;

    if (this.editingBoardId) {
      updateKanbanBoard(this.editingBoardId, {
        name,
        icon: this.draftIcon,
        columns,
      });
    } else {
      const board = addKanbanBoard({
        name,
        icon: this.draftIcon,
        columns,
        sortOrder: get(kanbanBoards).length,
      });
      this.editingBoardId = board.id;
    }
    this.close();
  }

  private deleteBoard(): void {
    if (!this.editingBoardId) return;
    removeKanbanBoard(this.editingBoardId);
    if (this.defaultBoardId === this.editingBoardId) {
      this.onDefaultChange?.("default");
    }
    this.close();
  }
}

/**
 * Lightweight list modal: pick / manage boards, set default.
 */
export class KanbanBoardsListModal extends CustomModal {
  private defaultBoardId: string;
  private onDefaultChange: (boardId: string) => void;
  private onEditBoard: (boardId: string | null) => void;

  constructor(
    app: App,
    opts: {
      defaultBoardId: string;
      onDefaultChange: (boardId: string) => void;
      onEditBoard: (boardId: string | null) => void;
    },
  ) {
    super(app);
    this.defaultBoardId = opts.defaultBoardId;
    this.onDefaultChange = opts.onDefaultChange;
    this.onEditBoard = opts.onEditBoard;
  }

  onOpen(): void {
    this.containerEl.addClass("kbm-board-modal");
    this.contentEl.addClass("kbm-modal");
    this.renderList();
  }

  private renderList(): void {
    this.contentEl.empty();

    const head = this.contentEl.createDiv("kbm-head");
    head.createEl("h2", { text: tRaw("kanban.manageBoards"), cls: "kbm-title" });

    const newBtn = head.createEl("button", {
      text: `+ ${tRaw("kanban.newBoard")}`,
      cls: "kbm-add-col-btn mod-cta",
      attr: { type: "button" },
    });
    newBtn.addEventListener("click", () => {
      this.close();
      this.onEditBoard(null);
    });

    const list = this.contentEl.createDiv("kbm-board-list");

    // Built-in default board
    this.renderBoardRow(list, {
      id: "default",
      name: tRaw("kanban.title"),
      icon: "🗂",
    }, true);

    for (const board of get(kanbanBoards)) {
      this.renderBoardRow(list, board, false);
    }
  }

  private renderBoardRow(
    host: HTMLElement,
    board: { id: string; name: string; icon: string },
    builtIn: boolean,
  ): void {
    const row = host.createDiv("kbm-board-row");
    row.createSpan({ text: board.icon || "🗂", cls: "kbm-board-icon" });
    row.createSpan({ text: board.name, cls: "kbm-board-name" });

    const isDefault = this.defaultBoardId === board.id;
    const defaultBtn = row.createEl("button", {
      text: isDefault ? `★ ${tRaw("kanban.unsetDefault")}` : `☆ ${tRaw("kanban.setDefault")}`,
      cls: "kbm-default-btn" + (isDefault ? " is-active" : ""),
      attr: { type: "button" },
    });
    defaultBtn.addEventListener("click", () => {
      this.defaultBoardId = board.id;
      this.onDefaultChange(board.id);
      this.renderList();
    });

    if (!builtIn) {
      const editBtn = row.createEl("button", {
        text: "✎",
        cls: "kbm-move-btn",
        attr: { type: "button", title: tRaw("common.edit") },
      });
      editBtn.addEventListener("click", () => {
        this.close();
        this.onEditBoard(board.id);
      });

      const delBtn = row.createEl("button", {
        text: "✕",
        cls: "kbm-col-del",
        attr: { type: "button", title: tRaw("common.delete") },
      });
      delBtn.addEventListener("click", () => {
        removeKanbanBoard(board.id);
        if (this.defaultBoardId === board.id) {
          this.defaultBoardId = "default";
          this.onDefaultChange("default");
        }
        this.renderList();
      });
    } else {
      row.createSpan({ text: tRaw("kanban.builtIn"), cls: "kbm-built-in" });
    }
  }
}

// Re-export helpers used by KanbanBoard.svelte
export { addKanbanColumn, updateKanbanColumn, removeKanbanColumn };
