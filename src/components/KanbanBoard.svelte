<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { moment as obsMoment } from "obsidian";
  import type { App } from "obsidian";
  import { get } from "svelte/store";
  import { getDateUID } from "obsidian-daily-notes-interface";
  import { tasks, projects, updateTaskStatus, updateTask, removeTask, addTask } from "../task-tracker/stores";
  import { activeTimers, formatDuration } from "../task-tracker/TimerManager";
  import type { ITask, TaskStatus, IProject } from "../task-tracker/types";
  import { t } from "../i18n";

  const momentFn = obsMoment as unknown as (inp?: unknown, format?: string, strict?: boolean) => import("moment").Moment;

  export let appInstance: App;

  interface KanbanColumn {
    key: TaskStatus;
    icon: string;
    label: string;
    color: string;
    statusIcon: string;
  }

  const columns: KanbanColumn[] = [
    { key: "todo", icon: "🟢", label: "", color: "rgba(110, 130, 160, 0.8)", statusIcon: "○" },
    { key: "progress", icon: "🔥", label: "", color: "rgba(180, 145, 85, 0.85)", statusIcon: "◐" },
    { key: "paused", icon: "☕", label: "", color: "rgba(180, 150, 100, 0.7)", statusIcon: "⏸" },
    { key: "done", icon: "✅", label: "", color: "rgba(85, 160, 130, 0.8)", statusIcon: "✓" },
  ];

  $: columns[0].label = $t("tasks.kanban.todo");
  $: columns[1].label = $t("tasks.kanban.progress");
  $: columns[2].label = $t("tasks.kanban.paused");
  $: columns[3].label = $t("tasks.kanban.done");

  let draggedTask: ITask | null = null;
  let dragOverColumn: TaskStatus | null = null;
  let dateInputRef: HTMLInputElement | null = null;

  // Date filter
  type FilterMode = "today" | "all" | "date";
  let filterMode: FilterMode = "today";
  let filterDateStr = momentFn().format("YYYY-MM-DD");

  function setFilter(mode: FilterMode) {
    filterMode = mode;
    if (mode === "today") filterDateStr = momentFn().format("YYYY-MM-DD");
  }

  // Reactive filter UID — use getDateUID to match actual task dateUID format
  $: filterDateUID = filterMode === "all" ? null : getDateUID(momentFn(filterDateStr, "YYYY-MM-DD"), "day");

  // Reactive filtered task lists — depend on $tasks AND filterMode/filterDateUID
  $: todoTasks = $tasks
    .filter((t) => {
      if (t.status !== "todo" || t.completed) return false;
      if (filterMode === "all") return true;
      return t.dateUID === filterDateUID;
    })
    .sort((a, b) => {
      if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
      if (a.scheduledTime) return -1;
      if (b.scheduledTime) return 1;
      return b.createdAt - a.createdAt;
    });

  $: progressTasks = $tasks
    .filter((t) => {
      if (t.status !== "progress" || t.completed) return false;
      if (filterMode === "all") return true;
      return t.dateUID === filterDateUID;
    })
    .sort((a, b) => {
      if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
      if (a.scheduledTime) return -1;
      if (b.scheduledTime) return 1;
      return b.createdAt - a.createdAt;
    });

  $: pausedTasks = $tasks
    .filter((t) => {
      if (t.status !== "paused" || t.completed) return false;
      if (filterMode === "all") return true;
      return t.dateUID === filterDateUID;
    })
    .sort((a, b) => {
      if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
      if (a.scheduledTime) return -1;
      if (b.scheduledTime) return 1;
      return b.createdAt - a.createdAt;
    });

  $: doneTasks = $tasks
    .filter((t) => {
      if (t.status !== "done" && !t.completed) return false;
      if (filterMode === "all") return true;
      return t.dateUID === filterDateUID;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50);

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
    refreshTimers();
    timerInterval = window.setInterval(refreshTimers, 1000);
  });
  onDestroy(() => {
    if (timerInterval !== null) { window.clearInterval(timerInterval); timerInterval = null; }
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

  function handleDragOver(e: DragEvent, status: TaskStatus): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    dragOverColumn = status;
  }

  function handleDragLeave(): void {
    dragOverColumn = null;
  }

  function handleDrop(e: DragEvent, status: TaskStatus): void {
    e.preventDefault();
    dragOverColumn = null;
    const taskId = e.dataTransfer?.getData("text/plain") || draggedTask?.id;
    if (!taskId) return;
    const currentTask = $tasks.find((t) => t.id === taskId);
    if (!currentTask || currentTask.status === status) return;
    updateTaskStatus(taskId, status);
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

  function createTaskWithStatus(status: TaskStatus): void {
    void import("../task-tracker/TaskModal").then(({ TaskModal }) => {
      const todayUID = `day-${momentFn().format("YYYY-MM-DD")}`;
      new TaskModal(appInstance, (taskData) => {
        addTask({
          title: taskData.title || "",
          description: taskData.description || "",
          projectId: taskData.projectId || null,
          notePath: taskData.notePath || null,
          boundNotePath: taskData.boundNotePath || null,
          dateUID: taskData.dateUID || todayUID,
          priority: taskData.priority || "medium",
          tags: taskData.tags || [],
          sortOrder: 0,
          status,
          completed: status === "done",
          scheduledTime: taskData.scheduledTime,
          endTime: taskData.endTime,
          estimatedTime: taskData.estimatedTime,
          deadline: taskData.deadline,
          deadlineTime: taskData.deadlineTime,
          recurrence: taskData.recurrence,
          isWorkTask: taskData.isWorkTask,
          paymentType: taskData.paymentType,
          rate: taskData.rate,
          overtimeStart: taskData.overtimeStart,
          overtimeMultiplier: taskData.overtimeMultiplier,
        });
      }, undefined, momentFn().format("YYYY-MM-DD")).open();
    });
  }
</script>

<div class="kanban-filters">
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
    on:change={(e) => { filterDateStr = e.currentTarget.value; filterMode = "date"; }}
  />
</div>

<div class="kanban-board">
  {#each columns as col (col.key)}
    {@const columnTasks = col.key === "todo" ? todoTasks : col.key === "progress" ? progressTasks : col.key === "paused" ? pausedTasks : doneTasks}
    <div
      class="kanban-column"
      class:drag-over={dragOverColumn === col.key}
      on:dragover={(e) => handleDragOver(e, col.key)}
      on:dragleave={handleDragLeave}
      on:drop={(e) => handleDrop(e, col.key)}
      role="region"
      aria-label={col.label}
    >
      <div class="kanban-column-header" style="--col-color: {col.color}">
        <span class="kanban-col-icon">{col.icon}</span>
        <span class="kanban-col-label">{col.label}</span>
        <span class="kanban-col-count">{columnTasks.length}</span>
        {#if col.key === "todo"}
          <button class="kanban-col-add" on:click|stopPropagation={() => createTaskWithStatus(col.key)} title={$t("tasks.modal.newTask")}>+</button>
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
              <span class="kanban-card-title" class:strike={task.status === "done"}>{task.title}</span>
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
