<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { moment as obsMoment } from "obsidian";
  import type { App } from "obsidian";
  import { get } from "svelte/store";
  import { getDateUID } from "obsidian-daily-notes-interface";
  import { tasks, projects, updateTaskStatus, updateTask, removeTask, carryOverOverdueTasks, kanbanBoards, setTaskKanbanColumn, saveKanbanBoardFilters } from "../task-tracker/stores";
  import { activeTimers, formatDuration } from "../task-tracker/TimerManager";
  import type { ITask, TaskStatus, IProject, IKanbanColumnDef } from "../task-tracker/types";
  import { DEFAULT_KANBAN_BOARD_ID, createDefaultKanbanColumns } from "../task-tracker/types";
  import { settings } from "../ui/stores";
  import { t } from "../i18n";

  const momentFn = obsMoment as unknown as (inp?: unknown, format?: string, strict?: boolean) => import("moment").Moment;

  export let appInstance: App;

  interface KanbanColumn {
    key: string;
    icon: string;
    label: string;
    color: string;
    statuses: TaskStatus[];
    statusIcon: string;
    /** Empty statuses = free-form column keyed by task.kanbanColumnId. */
    isFreeForm: boolean;
    autoStartTimer: boolean;
  }

  function defaultColumns(): KanbanColumn[] {
    const defs = createDefaultKanbanColumns();
    return defs.map((d) => ({
      key: d.id,
      icon: d.icon,
      label: "",
      color: d.color,
      statuses: d.statuses,
      statusIcon: d.id === "todo" ? "○" : d.id === "progress" ? "◐" : d.id === "paused" ? "⏸" : d.id === "done" ? "✓" : "✕",
      isFreeForm: false,
      autoStartTimer: true,
    }));
  }

  function columnsFromDef(defs: IKanbanColumnDef[]): KanbanColumn[] {
    return defs.map((d) => ({
      key: d.id,
      icon: d.icon,
      label: d.title,
      color: d.color,
      statuses: d.statuses,
      statusIcon: "○",
      isFreeForm: d.statuses.length === 0,
      autoStartTimer: d.autoStartTimer !== false,
    }));
  }

  // Active board
  let activeBoardId: string = DEFAULT_KANBAN_BOARD_ID;
  let showBoardPicker = false;

  $: customBoards = $kanbanBoards;
  $: {
    const preferred = ($settings as { defaultKanbanBoardId?: string }).defaultKanbanBoardId || DEFAULT_KANBAN_BOARD_ID;
    // Keep current selection if it still exists; otherwise fall back to default
    const ids = new Set([DEFAULT_KANBAN_BOARD_ID, ...customBoards.map((b) => b.id)]);
    if (!ids.has(activeBoardId)) activeBoardId = preferred && ids.has(preferred) ? preferred : DEFAULT_KANBAN_BOARD_ID;
    if (!activeBoardId) activeBoardId = preferred;
  }
  $: activeBoard = activeBoardId === DEFAULT_KANBAN_BOARD_ID
    ? null
    : customBoards.find((b) => b.id === activeBoardId) || null;
  $: preferredDefaultId = ($settings as { defaultKanbanBoardId?: string }).defaultKanbanBoardId || DEFAULT_KANBAN_BOARD_ID;
  $: isDefaultBoard = activeBoardId === preferredDefaultId;

  $: columns = activeBoard ? columnsFromDef(activeBoard.columns) : defaultColumns();

  $: {
    // Localize built-in column labels
    if (!activeBoard) {
      columns[0].label = $t("tasks.kanban.todo");
      columns[1].label = $t("tasks.kanban.progress");
      columns[2].label = $t("tasks.kanban.paused");
      columns[3].label = $t("tasks.kanban.done");
      columns[4].label = $t("tasks.kanban.failed");
    }
  }

  let draggedTask: ITask | null = null;
  let dragOverColumn: string | null = null;
  let dateInputRef: HTMLInputElement | null = null;

  // Date filter
  type FilterMode = "today" | "all" | "date";
  let filterMode: FilterMode = "today";
  let filterDateStr = momentFn().format("YYYY-MM-DD");

  // Project filter
  let projectFilterId: string | null = null;
  let showProjectPicker = false;

  function setFilter(mode: FilterMode) {
    filterMode = mode;
    if (mode === "today") filterDateStr = momentFn().format("YYYY-MM-DD");
    persistFilters();
  }

  function selectProject(id: string | null) {
    projectFilterId = id;
    showProjectPicker = false;
    persistFilters();
  }

  function selectBoard(id: string) {
    // Persist current filters for the board we are leaving
    persistFilters();
    activeBoardId = id;
    showBoardPicker = false;
    restoreFilters();
  }

  function persistFilters(): void {
    if (activeBoardId === DEFAULT_KANBAN_BOARD_ID) return;
    saveKanbanBoardFilters(activeBoardId, {
      filterMode,
      filterDateStr,
      projectFilterId,
    });
  }

  function restoreFilters(): void {
    const board = customBoards.find((b) => b.id === activeBoardId);
    const f = board?.filters;
    if (!f) {
      filterMode = "today";
      filterDateStr = momentFn().format("YYYY-MM-DD");
      projectFilterId = null;
      return;
    }
    filterMode = f.filterMode || "today";
    filterDateStr = f.filterDateStr || momentFn().format("YYYY-MM-DD");
    projectFilterId = f.projectFilterId ?? null;
  }

  async function openBoardsManager(): Promise<void> {
    showBoardPicker = false;
    const plugin = (
      appInstance as unknown as {
        plugins?: { getPlugin?: (id: string) => { writeOptions?: (c: Record<string, unknown>) => Promise<void> } | undefined };
      }
    ).plugins?.getPlugin?.("worklife-calendar");
    const mod = await import("../task-tracker/KanbanBoardModal");
    new mod.KanbanBoardsListModal(appInstance, {
      defaultBoardId: preferredDefaultId,
      onDefaultChange: (boardId: string) => {
        if (plugin?.writeOptions) void plugin.writeOptions({ defaultKanbanBoardId: boardId });
        else void settings.update((s) => ({ ...s, defaultKanbanBoardId: boardId }));
      },
      onEditBoard: (boardId: string | null) => {
        void import("../task-tracker/KanbanBoardModal").then(({ KanbanBoardModal }) => {
          new KanbanBoardModal(appInstance, { editBoardId: boardId }).open();
        });
      },
    }).open();
  }

  // Close project/board pickers on outside click (document-level so mobile works
  // even when the menu is position:fixed outside the filter bar).
  function closePickersOnOutsideClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (showProjectPicker && !target.closest(".kanban-project-picker")) {
      showProjectPicker = false;
    }
    if (showBoardPicker && !target.closest(".kanban-board-picker")) {
      showBoardPicker = false;
    }
  }

  /** Keep dropdowns under their trigger on phones (filters overflow clips abspos). */
  async function positionDropdown(trigger: HTMLElement): Promise<void> {
    // Desktop keeps absolute placement inside the filter bar.
    if (window.innerWidth > 768) return;
    await tick();
    const menu = trigger.parentElement?.querySelector<HTMLElement>(".kanban-project-dropdown");
    if (!menu) return;
    const rect = trigger.getBoundingClientRect();
    menu.classList.add("is-fixed");
    const menuH = menu.offsetHeight || 200;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    if (spaceBelow < Math.min(menuH, 180)) {
      menu.style.top = `${Math.max(8, Math.round(rect.top - menuH - 6))}px`;
    } else {
      menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    }
    const menuW = menu.offsetWidth || 160;
    let left = Math.round(rect.right - menuW);
    if (left < 8) left = 8;
    if (left + menuW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuW - 8);
    menu.style.left = `${left}px`;
    menu.style.right = "auto";
  }

  function toggleBoardPicker(e: MouseEvent): void {
    showProjectPicker = false;
    showBoardPicker = !showBoardPicker;
    if (showBoardPicker) {
      positionDropdown(e.currentTarget as HTMLElement);
    }
  }

  function toggleProjectPickerMenu(e: MouseEvent): void {
    showBoardPicker = false;
    showProjectPicker = !showProjectPicker;
    if (showProjectPicker) {
      positionDropdown(e.currentTarget as HTMLElement);
    }
  }

  // Reactive filter UID — use getDateUID to match actual task dateUID format
  $: filterDateUID = filterMode === "all" ? null : getDateUID(momentFn(filterDateStr, "YYYY-MM-DD"), "day");

  function matchesFilters(t: ITask): boolean {
    if (projectFilterId && t.projectId !== projectFilterId) return false;
    if (filterMode === "all") return true;
    return t.dateUID === filterDateUID;
  }

  function sortColumnTasks(list: ITask[], statuses: TaskStatus[]): ITask[] {
    const isDoneLike = statuses.length === 1 && (statuses[0] === "done" || statuses[0] === "failed");
    const sorted = [...list];
    if (isDoneLike) {
      sorted.sort((a, b) => b.updatedAt - a.updatedAt);
      return sorted.slice(0, 50);
    }
    sorted.sort((a, b) => {
      if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
      if (a.scheduledTime) return -1;
      if (b.scheduledTime) return 1;
      return b.createdAt - a.createdAt;
    });
    return sorted;
  }

  function tasksForColumn(col: KanbanColumn): ITask[] {
    if (col.isFreeForm) {
      return sortColumnTasks(
        $tasks.filter((t) => t.kanbanColumnId === col.key && matchesFilters(t)),
        col.statuses,
      );
    }
    const statusSet = new Set(col.statuses);
    return sortColumnTasks(
      $tasks.filter((t) => {
        // A task explicitly parked in a free-form column is not claimed by status columns
        if (t.kanbanColumnId) return false;
        if (!statusSet.has(t.status)) return false;
        if (t.status === "done" || t.status === "failed") {
          // keep
        } else if (t.completed) return false;
        return matchesFilters(t);
      }),
      col.statuses,
    );
  }

  // Timer — update displays every second via a reactive Map
  let timerDisplays = new Map<string, string>();
  let timerActiveSet = new Set<string>();
  let timerPausedSet = new Set<string>();
  let timerInterval: number | null = null;

  function refreshTimers() {
    const newDisplays = new Map<string, string>();
    const newActive = new Set<string>();
    const newPaused = new Set<string>();
    const timers = get(activeTimers);
    const allTasks = get(tasks);

    for (const task of allTasks) {
      if (task.status !== "progress" && task.status !== "paused") continue;
      const accumulated = task.totalWorkTime || 0;
      const startTime = timers.get(task.id);

      if (task.status === "progress" && startTime) {
        newDisplays.set(task.id, formatDuration(Date.now() - startTime + accumulated));
        newActive.add(task.id);
      } else if (accumulated > 0) {
        newDisplays.set(task.id, formatDuration(accumulated));
        if (task.status === "paused") newPaused.add(task.id);
      }
    }

    timerDisplays = newDisplays;
    timerActiveSet = newActive;
    timerPausedSet = newPaused;
  }

  onMount(() => {
    // Start on the user's default board
    const preferred = ($settings as { defaultKanbanBoardId?: string }).defaultKanbanBoardId;
    if (preferred) activeBoardId = preferred;
    restoreFilters();
    carryOverOverdueTasks();
    refreshTimers();
    timerInterval = window.setInterval(refreshTimers, 1000);
    document.addEventListener("click", closePickersOnOutsideClick, true);
    return () => {
      persistFilters();
      document.removeEventListener("click", closePickersOnOutsideClick, true);
    };
  });
  onDestroy(() => {
    if (timerInterval !== null) { window.clearInterval(timerInterval); timerInterval = null; }
    document.removeEventListener("click", closePickersOnOutsideClick, true);
  });

  function getProject(task: ITask): IProject | null {
    if (!task.projectId) return null;
    return $projects.find((p) => p.id === task.projectId) || null;
  }

  function handleDragStart(e: DragEvent, task: ITask): void {
    draggedTask = task;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", task.id);
    }
  }

  function handleDragEnd(): void {
    draggedTask = null;
    dragOverColumn = null;
  }

  function handleDragOver(e: DragEvent, colKey: string): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    dragOverColumn = colKey;
  }

  function handleDragLeave(): void {
    dragOverColumn = null;
  }

  function handleDrop(e: DragEvent, col: KanbanColumn): void {
    e.preventDefault();
    dragOverColumn = null;
    const taskId = e.dataTransfer?.getData("text/plain") || draggedTask?.id;
    if (!taskId) return;
    const currentTask = $tasks.find((t) => t.id === taskId);
    if (!currentTask) return;

    if (col.isFreeForm) {
      // Park the task in this status-less column (status stays as-is)
      if (currentTask.kanbanColumnId === col.key) return;
      setTaskKanbanColumn(taskId, col.key);
      draggedTask = null;
      return;
    }

    // Status column: keep current status if already in the set, else first status
    const targetStatus: TaskStatus = col.statuses.includes(currentTask.status)
      ? currentTask.status
      : col.statuses[0];
    if (!targetStatus) return;
    if (currentTask.status === targetStatus && !currentTask.kanbanColumnId) return;
    updateTaskStatus(taskId, targetStatus, {
      // Per-column «Запускать таймер в работе» overrides the global setting
      autoStartTimer: col.autoStartTimer,
    });
    draggedTask = null;
  }

  function handleDelete(taskId: string): void {
    removeTask(taskId);
  }

  function openEditTask(task: ITask): void {
    void import("../task-tracker/TaskModal").then(({ TaskModal }) => {
      new TaskModal(appInstance, (changes) => {
        updateTask(task.id, changes);
      }, task).open();
    });
  }

  function openNote(notePath: string): void {
    if (notePath) {
      appInstance.workspace.openLinkText(notePath, "", true);
    }
  }

  function formatDeadline(task: ITask): string {
    if (!task.deadline) return "";
    const match = task.deadline.match(/^day-(\d{4}-\d{2}-\d{2})/);
    if (!match) return "";
    const d = momentFn(match[1], "YYYY-MM-DD");
    const today = momentFn().startOf("day");
    const diff = d.diff(today, "days");
    if (diff < 0) return `${Math.abs(diff)}д просрочено`;
    if (diff === 0) return "сегодня";
    if (diff === 1) return "завтра";
    return d.format("D MMM");
  }

  function isOverdue(task: ITask): boolean {
    if (!task.deadline || task.status === "done") return false;
    const match = task.deadline.match(/^day-(\d{4}-\d{2}-\d{2})/);
    if (!match) return false;
    return match[1] < momentFn().format("YYYY-MM-DD");
  }

  function formatTaskDate(task: ITask): string {
    if (!task.dateUID) return "";
    const match = task.dateUID.match(/^day-(\d{4}-\d{2}-\d{2})/);
    if (!match) return "";
    const d = momentFn(match[1], "YYYY-MM-DD");
    const today = momentFn().startOf("day");
    const diff = d.diff(today, "days");
    if (diff === 0) return "сегодня";
    if (diff === 1) return "завтра";
    if (diff === -1) return "вчера";
    return d.format("D MMM");
  }

  function createTaskWithStatus(status: TaskStatus, freeFormColId?: string): void {
    void import("../task-tracker/QuickAddModal").then(({ QuickAddModal }) => {
      new QuickAddModal(appInstance, momentFn(), () => {
        /* store-driven */
      }, {
        onTaskCreated: (task) => {
          if (freeFormColId) {
            setTaskKanbanColumn(task.id, freeFormColId);
            return;
          }
          if (task.status !== status) updateTask(task.id, { status, completed: status === "done" });
        },
      }).open();
    });
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div class="kanban-filters" on:click|stopPropagation on:keydown|stopPropagation>
  <button class="kanban-filter-btn" class:active={filterMode === "today"} on:click={() => setFilter("today")}>
    📅 {$t("schedule.today")}
  </button>
  <button class="kanban-filter-btn" class:active={filterMode === "all"} on:click={() => setFilter("all")}>
    📋 {$t("tasks.tabs.all")}
  </button>
  <button class="kanban-filter-btn" class:active={filterMode === "date"} on:click={() => dateInputRef?.showPicker()}>
    📆 {filterMode === "date" ? momentFn(filterDateStr, "YYYY-MM-DD").format("D MMM") : "..."}
  </button>
  <input type="date" bind:this={dateInputRef} class="kanban-date-hidden" value={filterDateStr}
    on:change={(e) => { filterDateStr = e.currentTarget.value; filterMode = "date"; persistFilters(); }}
  />
  <div class="kanban-project-picker kanban-board-picker">
    <button class="kanban-filter-btn kanban-project-btn" class:active={activeBoardId !== DEFAULT_KANBAN_BOARD_ID} on:click|stopPropagation={toggleBoardPicker}>
      <span>{activeBoard?.icon || "🗂"}</span>
      <span>{activeBoard?.name || $t("kanban.title")}</span>
      {#if isDefaultBoard}<span class="kanban-default-star" title={$t("kanban.defaultBoard")}>★</span>{/if}
      <span class="kanban-project-arrow" class:rotated={showBoardPicker}>▾</span>
    </button>
    {#if showBoardPicker}
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <div class="kanban-project-dropdown" on:click|stopPropagation on:keydown|stopPropagation>
        <button class="kanban-project-item" class:active={activeBoardId === DEFAULT_KANBAN_BOARD_ID}
          on:click={() => selectBoard(DEFAULT_KANBAN_BOARD_ID)}>
          <span>🗂</span> {$t("kanban.title")}
          {#if preferredDefaultId === DEFAULT_KANBAN_BOARD_ID}
            <span class="kanban-default-star">★</span>
          {/if}
        </button>
        {#each customBoards as board (board.id)}
          <button class="kanban-project-item" class:active={activeBoardId === board.id}
            on:click={() => selectBoard(board.id)}>
            <span>{board.icon || "🗂"}</span> {board.name}
            {#if preferredDefaultId === board.id}
              <span class="kanban-default-star">★</span>
            {/if}
          </button>
        {/each}
        <button class="kanban-project-item kanban-manage-boards" on:click={() => openBoardsManager()}>
          <span>⚙</span> {$t("kanban.manageBoards")}
        </button>
      </div>
    {/if}
  </div>
  <div class="kanban-project-picker">
    <button class="kanban-filter-btn kanban-project-btn" class:active={projectFilterId !== null} on:click|stopPropagation={toggleProjectPickerMenu}>
      {#if projectFilterId}
        {@const proj = $projects.find(p => p.id === projectFilterId)}
        <span style="color: {proj?.color || 'inherit'}">{proj?.icon || '📁'}</span>
        <span>{proj?.name || $t("tasks.modal.project")}</span>
      {:else}
        <span>📂</span>
        <span>{$t("tasks.tabs.all")}</span>
      {/if}
      <span class="kanban-project-arrow" class:rotated={showProjectPicker}>▾</span>
    </button>
    {#if showProjectPicker}
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <div class="kanban-project-dropdown" on:click|stopPropagation on:keydown|stopPropagation>
        <button class="kanban-project-item" class:active={projectFilterId === null}
          on:click={() => selectProject(null)}>
          <span>📂</span> {$t("tasks.tabs.all")}
        </button>
        {#each $projects.filter(p => !p.archived) as project (project.id)}
          <button class="kanban-project-item" class:active={projectFilterId === project.id}
            on:click={() => selectProject(project.id)}>
            <span style="color: {project.color}">{project.icon || '📁'}</span> {project.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<div class="kanban-board">
  {#each columns as col (col.key)}
    {@const columnTasks = tasksForColumn(col)}
    <div
      class="kanban-column"
      class:drag-over={dragOverColumn === col.key}
      on:dragover={(e) => handleDragOver(e, col.key)}
      on:dragleave={handleDragLeave}
      on:drop={(e) => handleDrop(e, col)}
      role="region"
      aria-label={col.label}
    >
      <div class="kanban-column-header" style="--col-color: {col.color}">
        <span class="kanban-col-icon">{col.icon}</span>
        <span class="kanban-col-label">{col.label}</span>
        <span class="kanban-col-count">{columnTasks.length}</span>
        {#if col.isFreeForm || col.statuses.includes("todo")}
          <button class="kanban-col-add" on:click|stopPropagation={() => createTaskWithStatus(col.statuses[0] || "todo", col.isFreeForm ? col.key : undefined)} title={$t("tasks.modal.newTask")}>+</button>
        {/if}
      </div>
      <div class="kanban-column-body">
        {#each columnTasks as task (task.id)}
          {@const proj = getProject(task)}
          {@const overdue = isOverdue(task)}
          {@const deadline = formatDeadline(task)}
          <div
            class="kanban-card"
            class:done={task.status === "done"}
            class:failed={task.status === "failed"}
            class:overdue
            style="border-left: 3px solid {proj?.color || col.color}"
            draggable="true"
            on:dragstart={(e) => handleDragStart(e, task)}
            on:dragend={handleDragEnd}
            role="listitem"
          >
            <!-- Header: project + title -->
            <div class="kanban-card-header">
              {#if proj}
                <span class="kanban-card-project" style="color: {proj.color}">{proj.icon || "📁"}</span>
              {/if}
              <span class="kanban-card-title" class:strike={task.status === "done" || task.status === "failed"}>{task.title}</span>
            </div>

            <!-- Description -->
            {#if task.description}
              <div class="kanban-card-desc">{task.description}</div>
            {/if}

            <!-- Meta badges -->
            <div class="kanban-card-meta">
              <!-- Timer -->
              {#if timerDisplays.has(task.id)}
                <span class="kanban-card-badge kanban-badge-timer" class:kanban-badge-timer-active={timerActiveSet.has(task.id)} class:kanban-badge-timer-paused={timerPausedSet.has(task.id)}>
                  ⏱ {timerDisplays.get(task.id)}
                </span>
              {/if}

              <!-- Task date -->
              {#if formatTaskDate(task)}
                <span class="kanban-card-badge kanban-badge-date">📅 {formatTaskDate(task)}</span>
              {/if}

              <!-- Time range -->
              {#if task.scheduledTime}
                <span class="kanban-card-badge kanban-badge-time">
                  🕐 {task.scheduledTime}{task.endTime ? `–${task.endTime}` : ""}
                </span>
              {/if}

              <!-- Deadline -->
              {#if deadline}
                <span class="kanban-card-badge" class:kanban-badge-overdue={overdue} class:kanban-badge-deadline={!overdue}>
                  ⏰ {deadline}
                </span>
              {/if}

              <!-- Priority -->
              {#if task.priority === "high"}
                <span class="kanban-card-badge kanban-badge-priority-high">⏫</span>
              {:else if task.priority === "low"}
                <span class="kanban-card-badge kanban-badge-priority-low">⬇️</span>
              {/if}

              <!-- Work task -->
              {#if task.isWorkTask}
                <span class="kanban-card-badge kanban-badge-work">💼</span>
              {/if}

              <!-- Recurrence -->
              {#if task.recurrence}
                <span class="kanban-card-badge kanban-badge-recurring">🔄</span>
              {/if}

              <!-- Note link -->
              {#if task.boundNotePath}
                <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
                <span class="kanban-card-badge kanban-badge-note" role="button" tabindex="0" on:click|stopPropagation={() => openNote(task.boundNotePath)} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openNote(task.boundNotePath); }} title={task.boundNotePath}>📄</span>
              {/if}

              <!-- Project name -->
              {#if proj}
                <span class="kanban-card-badge kanban-badge-project" style="color: {proj.color}">{proj.name}</span>
              {/if}
            </div>

            <!-- Actions -->
            <div class="kanban-card-actions">
              <button class="kanban-card-btn" on:click|stopPropagation={() => openEditTask(task)} title={$t("common.edit")}>✎</button>
              <button class="kanban-card-btn kanban-card-btn--danger" on:click|stopPropagation={() => handleDelete(task.id)} title={$t("common.delete")}>✕</button>
            </div>
          </div>
        {:else}
          <div class="kanban-empty">{$t("tasks.panel.empty")}</div>
        {/each}
      </div>
    </div>
  {/each}
</div>
