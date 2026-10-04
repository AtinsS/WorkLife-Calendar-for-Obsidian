<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import type { App } from "obsidian";
  import moment from "moment";
  import { getDateUID } from "obsidian-daily-notes-interface";
  import type { ITask, IProject } from "./types";
  import {
    tasks, projects, selectedDate, activeTab, taskFilter,
    updateTaskStatus, removeTask,
    createNextRecurringInstance, clearAllRecurringTasks, clearRecurringByProject, clearRecurringByName, resetTaskTimer,
    carryOverOverdueTasks, updateRecurringSeries,
  } from "./stores";
  import TaskItem from "./TaskItem.svelte";
  import KanbanTabs from "./KanbanTabs.svelte";
  import TimeLogsModal from "./TimeLogsModal.svelte";
  import { TaskModal } from "./TaskModal";
  import { ProjectModal } from "./ProjectModal";
  import { t } from "../i18n";

  export let appInstance: App;

  let isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  let mqlMobile: MediaQueryList | null = null;
  let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null;

  onMount(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      mqlMobile = window.matchMedia("(max-width: 768px)");
      isMobile = mqlMobile.matches;
      mqlHandler = (e: MediaQueryListEvent) => { isMobile = e.matches; };
      mqlMobile.addEventListener("change", mqlHandler);
    }
    // Carry over overdue tasks whenever the panel opens
    carryOverOverdueTasks();
  });

  onDestroy(() => {
    if (mqlMobile && mqlHandler) {
      mqlMobile.removeEventListener("change", mqlHandler);
    }
  });

  let showTimeLogs = false;
  let showMenu = false;
  let showSearch = false;
  let showProjectPicker = false;
  let searchQuery = "";
  let sortMode: "time" | "priority" = "time";

  $: currentDate = $selectedDate;
  $: allTasksForDate = currentDate
    ? $tasks.filter((t) => t.dateUID === currentDate)
    : $tasks;

  // Day navigation
  function prevDay() {
    if (!currentDate) return;
    const match = currentDate.match(/^day-(\d{4}-\d{2}-\d{2})/);
    if (!match) return;
    const m = moment(match[1]).subtract(1, "day");
    selectedDate.set(getDateUID(m, "day"));
  }
  function nextDay() {
    if (!currentDate) return;
    const match = currentDate.match(/^day-(\d{4}-\d{2}-\d{2})/);
    if (!match) return;
    const m = moment(match[1]).add(1, "day");
    selectedDate.set(getDateUID(m, "day"));
  }
  function goToday() {
    selectedDate.set(getDateUID(moment(), "day"));
  }
  /** Enter/Space on date label — ignore when typing in form fields (Space must insert). */
  function onDateKeydown(e: KeyboardEvent) {
    const tgt = e.target as HTMLElement;
    if (tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable) return;
    if (e.key === "Enter" || e.key === " ") goToday();
  }

  $: filteredTasks = allTasksForDate.filter((t) => {
    if ($taskFilter.projectId && t.projectId !== $taskFilter.projectId) return false;
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (t.deadline && t.status !== "done") return true;
    // When viewing all tasks (no date selected), show all statuses including done
    if ($activeTab === "all") return showAllDates ? true : t.status !== "done";
    return t.status === $activeTab;
  });

  $: showAllDates = !currentDate;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $: taskGroups = (showAllDates
    ? groupTasksByDateAndProject(filteredTasks, $projects)
    : groupTasksByProject(filteredTasks, $projects)) as any[];
  $: sortedDisplayTasks = sortMode === "priority"
    ? sortTasksByPriority(filteredTasks)
    : sortTasksChronologically(filteredTasks);
  $: totalCount = allTasksForDate.length;
  $: doneCount = allTasksForDate.filter((t) => t.status === "done").length;

  function groupTasksByProject(taskList: ITask[], projectList: IProject[]): { project: IProject | null; tasks: ITask[] }[] {
    const groups = new Map<string, ITask[]>();
    const noProject: ITask[] = [];
    for (const task of taskList) {
      if (task.projectId) {
        const existing = groups.get(task.projectId) || [];
        existing.push(task);
        groups.set(task.projectId, existing);
      } else {
        noProject.push(task);
      }
    }
    const result: { project: IProject | null; tasks: ITask[] }[] = [];
    for (const [projectId, projectTasks] of groups) {
      const project = projectList.find((p) => p.id === projectId);
      if (project && !project.archived) {
        result.push({ project, tasks: sortTasks(projectTasks) });
      } else {
        noProject.push(...projectTasks);
      }
    }
    if (noProject.length > 0) {
      result.unshift({ project: null, tasks: sortTasks(noProject) });
    }
    return result;
  }

  function sortTasks(taskList: ITask[]): ITask[] {
    return [...taskList].sort((a, b) => {
      if (a.status === "done" && b.status === "done") return (b.updatedAt || 0) - (a.updatedAt || 0);
      if (a.status === "done") return 1;
      if (b.status === "done") return -1;
      // Carried-over (overdue) tasks first
      const aOverdue = !!a.carriedOverFrom;
      const bOverdue = !!b.carriedOverFrom;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      const aTime = a.scheduledTime || "";
      const bTime = b.scheduledTime || "";
      if (aTime && bTime) return aTime.localeCompare(bTime);
      if (aTime) return -1;
      if (bTime) return 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function sortTasksChronologically(taskList: ITask[]): ITask[] {
    return [...taskList].sort((a, b) => {
      if (a.status === "done" && b.status === "done") return (b.updatedAt || 0) - (a.updatedAt || 0);
      if (a.status === "done") return 1;
      if (b.status === "done") return -1;
      // Carried-over (overdue) tasks first
      const aOverdue = !!a.carriedOverFrom;
      const bOverdue = !!b.carriedOverFrom;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      const aTime = a.scheduledTime || "";
      const bTime = b.scheduledTime || "";
      if (aTime && bTime) return aTime.localeCompare(bTime);
      if (aTime) return -1;
      if (bTime) return 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

  function sortTasksByPriority(taskList: ITask[]): ITask[] {
    return [...taskList].sort((a, b) => {
      if (a.status === "done" && b.status === "done") return (b.updatedAt || 0) - (a.updatedAt || 0);
      if (a.status === "done") return 1;
      if (b.status === "done") return -1;
      // Carried-over (overdue) tasks first — above all priorities
      const aOverdue = !!a.carriedOverFrom;
      const bOverdue = !!b.carriedOverFrom;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      const aPri = PRIORITY_ORDER[a.priority] ?? 3;
      const bPri = PRIORITY_ORDER[b.priority] ?? 3;
      if (aPri !== bPri) return aPri - bPri;
      const aTime = a.scheduledTime || "";
      const bTime = b.scheduledTime || "";
      if (aTime && bTime) return aTime.localeCompare(bTime);
      if (aTime) return -1;
      if (bTime) return 1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function toggleSortMode() {
    sortMode = sortMode === "time" ? "priority" : "time";
  }

  function groupTasksByDateAndProject(taskList: ITask[], projectList: IProject[]): { dateUID: string; dateLabel: string; groups: { project: IProject | null; tasks: ITask[] }[] }[] {
    const byDate = new Map<string, ITask[]>();
    for (const task of taskList) {
      const key = task.dateUID || "unassigned";
      const arr = byDate.get(key) || [];
      arr.push(task);
      byDate.set(key, arr);
    }
    const today = moment().format("YYYY-MM-DD");
    const todayUID = `day-${today}`;
    const sortedDates = Array.from(byDate.keys()).sort((a, b) => {
      if (a === "unassigned") return 1;
      if (b === "unassigned") return -1;
      if (a === todayUID) return -1;
      if (b === todayUID) return 1;
      const aDate = a.replace("day-", "");
      const bDate = b.replace("day-", "");
      const aIsFuture = aDate >= today;
      const bIsFuture = bDate >= today;
      if (aIsFuture && !bIsFuture) return -1;
      if (!aIsFuture && bIsFuture) return 1;
      if (aIsFuture && bIsFuture) return aDate.localeCompare(bDate);
      return bDate.localeCompare(aDate);
    });
    const result: { dateUID: string; dateLabel: string; groups: { project: IProject | null; tasks: ITask[] }[] }[] = [];
    for (const dateKey of sortedDates) {
      const dateTasks = byDate.get(dateKey)!;
      const label = dateKey === "unassigned" ? $t("tasks.panel.noDate") : formatDate(dateKey);
      const groups = groupTasksByProject(dateTasks, projectList);
      result.push({ dateUID: dateKey, dateLabel: label, groups });
    }
    return result;
  }

  function formatDate(dateUID: string): string {
    if (!dateUID) return $t("tasks.panel.dateNotSelected");
    const match = dateUID.match(/^(?:day|week|month)-(\d{4}-\d{2}-\d{2})/);
    if (match) {
      try {
        const m = window.moment(match[1], "YYYY-MM-DD", true);
        if (m.isValid()) return m.format("D MMMM YYYY");
        return match[1];
      } catch { return match[1]; }
    }
    return dateUID;
  }

  function openCreateTask() {
    void import("./QuickAddModal").then(({ QuickAddModal }) => {
      const uid = $selectedDate;
      const match = uid ? /(\d{4}-\d{2}-\d{2})/.exec(uid) : null;
      const m = match ? moment(match[1], "YYYY-MM-DD", true) : moment();
      new QuickAddModal(appInstance, m.isValid() ? m : moment(), () => {
        /* list is store-driven */
      }, {
        onTaskCreated: () => {
          /* list is store-driven */
        },
      }).open();
    });
  }

  async function handleTaskDelete(task: ITask) {
    removeTask(task.id);
  }

  function toggleTaskStatus(task: ITask): "done" | "todo" {
    const newStatus = task.status === "done" ? "todo" : "done";
    updateTaskStatus(task.id, newStatus);
    if (newStatus === "todo") resetTaskTimer(task.id);
    return newStatus;
  }

  function handleRecurringNext(task: ITask): void {
    if (task.recurrence) createNextRecurringInstance(task.id);
  }

  async function handleTaskComplete(task: ITask) {
    const newStatus = toggleTaskStatus(task);
    if (newStatus === "done") handleRecurringNext(task);
  }

  async function clearCompletedTasks() {
    if (!appInstance) return;
    const allTasksList = get(tasks);
    const completedTasks = allTasksList.filter((t) => t.completed);
    if (completedTasks.length === 0) { alert($t("tasks.panel.noCompleted")); return; }
    if (!confirm($t("tasks.panel.deleteCompleted", { count: completedTasks.length }))) return;
    for (const task of completedTasks) {
      removeTask(task.id);
    }
  }

  function openProjectSettings() { new ProjectModal(appInstance).open(); }
  function toggleMenu() {
    showMenu = !showMenu;
    if (!showMenu) {
      showRecurringRoot = false;
      recurringPanel = null;
    }
  }
  function closeMenu() {
    showMenu = false;
    showRecurringRoot = false;
    recurringPanel = null;
  }
  function toggleSearch() { showSearch = !showSearch; if (!showSearch) searchQuery = ""; }

  /** Вложенное меню повторяющихся: root → clear | edit */
  let showRecurringRoot = false;
  let recurringPanel: "clear" | "edit" | null = null;

  function toggleRecurringRoot() {
    showRecurringRoot = !showRecurringRoot;
    if (!showRecurringRoot) recurringPanel = null;
  }

  function showRecurringClear() {
    recurringPanel = recurringPanel === "clear" ? null : "clear";
  }

  function showRecurringEdit() {
    recurringPanel = recurringPanel === "edit" ? null : "edit";
  }

  function getRecurringParents(): ITask[] {
    return get(tasks).filter((t) => t.recurrence && !t.isRecurringInstance);
  }

  function clearRecurringAll() {
    const result = clearAllRecurringTasks();
    closeMenu();
    alert($t("tasks.panel.recurringCleared", { count: String(result.parentCount + result.instanceCount) }));
  }

  function clearRecurringByProj(projectId: string) {
    const result = clearRecurringByProject(projectId);
    closeMenu();
    alert($t("tasks.panel.recurringCleared", { count: String(result.parentCount + result.instanceCount) }));
  }

  function clearRecurringByTitle(title: string) {
    const result = clearRecurringByName(title);
    closeMenu();
    alert($t("tasks.panel.recurringCleared", { count: String(result.parentCount + result.instanceCount) }));
  }

  function editRecurringTask(task: ITask) {
    closeMenu();
    const modal = new TaskModal(
      appInstance,
      async (data) => {
        updateRecurringSeries(task.id, data);
      },
      task,
    );
    modal.open();
  }

  function getRecurringProjects(): IProject[] {
    const recurringParents = getRecurringParents();
    const projIds = new Set(recurringParents.map((t) => t.projectId).filter(Boolean));
    return get(projects).filter((p) => projIds.has(p.id));
  }

  function getRecurringNames(): string[] {
    return [...new Set(getRecurringParents().map((t) => t.title))];
  }
</script>

<svelte:window on:click={closeMenu} />

<div class="task-tracker-panel" role="region" aria-label={$t("tasks.panel.title")}>
  <!-- ═══════ MOBILE HEADER ═══════ -->
  {#if isMobile}
    <div class="task-tracker-mob-header">
      <button class="task-tracker-btn all-tasks-btn" class:active={!currentDate}
        on:click|stopPropagation={() => { currentDate ? selectedDate.set(null) : goToday(); }}
        title={currentDate ? $t("tasks.panel.allTasks") : $t("tasks.panel.today")}>📋</button>
      <div class="task-tracker-mob-project-picker">
        <button class="task-tracker-mob-project-btn" on:click|stopPropagation={() => showProjectPicker = !showProjectPicker}>
          {#if $taskFilter.projectId}
            {@const proj = $projects.find(p => p.id === $taskFilter.projectId)}
            <span style="color: {proj?.color || 'var(--mcp-accent)'}">{proj?.icon || '📁'}</span>
            <span>{proj?.name || $t("tasks.modal.project")}</span>
          {:else}
            <span>📂</span>
            <span>{$t("tasks.tabs.all")}</span>
          {/if}
          <span class="project-picker-arrow" class:rotated={showProjectPicker}>▾</span>
        </button>
        {#if showProjectPicker}
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <div class="task-tracker-mob-project-dropdown" on:click|stopPropagation on:keydown|stopPropagation>
            <button class="project-dropdown-item" class:active={$taskFilter.projectId === null}
              on:click={() => { taskFilter.update(f => ({ ...f, projectId: null })); showProjectPicker = false; }}>
              <span>📂</span> {$t("tasks.tabs.all")}
            </button>
            {#each $projects.filter(p => !p.archived) as project (project.id)}
              <button class="project-dropdown-item" class:active={$taskFilter.projectId === project.id}
                on:click={() => { taskFilter.update(f => ({ ...f, projectId: f.projectId === project.id ? null : project.id })); showProjectPicker = false; }}>
                <span style="color: {project.color}">{project.icon || '📁'}</span> {project.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <button class="task-tracker-btn icon-btn" class:active={showSearch}
        on:click|stopPropagation={toggleSearch} title={$t("tasks.panel.search")}>🔍</button>
      <button class="task-tracker-btn sort-btn" class:active={sortMode === "priority"}
        on:click|stopPropagation={toggleSortMode}
        title={sortMode === "time" ? $t("tasks.panel.sortByTime") : $t("tasks.panel.sortByPriority")}>
        {sortMode === "time" ? "🕐" : "🔺"}
      </button>
      <button class="task-tracker-btn add-btn" on:click|stopPropagation={openCreateTask}>+</button>
      <div class="task-tracker-menu-wrapper">
        <button class="task-tracker-btn" on:click|stopPropagation={toggleMenu} title={$t("tasks.panel.more")}>⋮</button>
        {#if showMenu}
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <div class="task-tracker-dropdown" on:click|stopPropagation on:keydown|stopPropagation role="menu" tabindex="-1">
            <!-- Канбан/Расписание/Привычки — в бесшовном переключателе, не в меню -->
            <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => { openProjectSettings(); closeMenu(); }}>{$t("tasks.panel.menuProjects")}</button>
            <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => { showTimeLogs = true; closeMenu(); }}>{$t("tasks.panel.menuTimeLogs")}</button>
            <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => { clearCompletedTasks(); closeMenu(); }}>{$t("tasks.panel.menuCleanDone")}</button>
            <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={toggleRecurringRoot} aria-expanded={showRecurringRoot}>{$t("tasks.panel.menuRecurringActions")} <span class="submenu-arrow" class:rotated={showRecurringRoot}>▸</span></button>
            {#if showRecurringRoot}
              <div class="task-tracker-submenu">
                <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={showRecurringClear}>{$t("tasks.panel.menuCleanRecurring")} <span class="submenu-arrow" class:rotated={recurringPanel === "clear"}>▸</span></button>
                <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={showRecurringEdit}>{$t("tasks.panel.menuEditRecurring")} <span class="submenu-arrow" class:rotated={recurringPanel === "edit"}>▸</span></button>
                {#if recurringPanel === "clear"}
                  <div class="task-tracker-submenu task-tracker-submenu-nested">
                    <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={clearRecurringAll}>{$t("tasks.panel.recurringAll")}</button>
                    {#each getRecurringProjects() as proj (proj.id)}
                      <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => clearRecurringByProj(proj.id)}>{proj.icon} {proj.name}</button>
                    {/each}
                    {#each getRecurringNames() as name (name)}
                      <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => clearRecurringByTitle(name)}>📝 {name}</button>
                    {/each}
                  </div>
                {:else if recurringPanel === "edit"}
                  <div class="task-tracker-submenu task-tracker-submenu-nested">
                    {#each getRecurringParents() as rtask (rtask.id)}
                      <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => editRecurringTask(rtask)}>🔄 {rtask.title}</button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    <div class="task-tracker-mob-filters">
      <button class="mob-filter-btn" class:active={$activeTab === "all"} on:click={() => activeTab.set("all")}>{$t("tasks.tabs.all")}</button>
      <button class="mob-filter-btn" class:active={$activeTab === "todo"} on:click={() => activeTab.set("todo")}>{$t("tasks.tabs.todo")}</button>
      <button class="mob-filter-btn" class:active={$activeTab === "progress"} on:click={() => activeTab.set("progress")}>{$t("tasks.tabs.progress")}</button>
      <button class="mob-filter-btn" class:active={$activeTab === "paused"} on:click={() => activeTab.set("paused")}>{$t("tasks.tabs.paused")}</button>
      <button class="mob-filter-btn" class:active={$activeTab === "done"} on:click={() => activeTab.set("done")}>{$t("tasks.tabs.done")}</button>
    </div>
    <div class="task-tracker-mob-date">
      {#if currentDate}
        <button class="date-nav-btn" on:click={prevDay}>‹</button>
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <span class="task-tracker-date" role="button" tabindex="0" on:click={goToday} on:keydown={onDateKeydown}>{formatDate(currentDate)}</span>
        <button class="date-nav-btn" on:click={nextDay}>›</button>
      {:else}
        <span class="task-tracker-date-all">{$t("tasks.panel.allTasks")}</span>
      {/if}
    </div>
  {/if}

  <!-- ═══════ DESKTOP HEADER ═══════ -->
  {#if !isMobile}
    <div class="task-tracker-header">
      <div class="task-tracker-header-left">
        <span class="task-tracker-title">{$t("tasks.panel.title")}</span>
        {#if currentDate}
          <div class="task-tracker-date-nav">
            <button class="date-nav-btn" on:click={prevDay} title={$t("tasks.panel.prevDay")}>‹</button>
            <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
            <span class="task-tracker-date" role="button" tabindex="0" on:click={goToday} on:keydown={onDateKeydown} title={$t("tasks.panel.today")}>{formatDate(currentDate)}</span>
            <button class="date-nav-btn" on:click={nextDay} title={$t("tasks.panel.nextDay")}>›</button>
          </div>
        {:else}
          <span class="task-tracker-date-all">{$t("tasks.panel.allTasks")}</span>
        {/if}
      </div>
      <div class="task-tracker-header-right">
        {#if totalCount > 0}
          <div class="task-tracker-progress" title="{doneCount}/{totalCount}">
            <span class="task-tracker-count">{doneCount}/{totalCount}</span>
            <div class="task-tracker-progress-bar">
              <div class="task-tracker-progress-fill" style="width: {totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%"></div>
            </div>
          </div>
        {/if}
        <button class="task-tracker-btn all-tasks-btn" class:active={!currentDate}
          on:click|stopPropagation={() => { currentDate ? selectedDate.set(null) : goToday(); }}
          title={currentDate ? $t("tasks.panel.allTasks") : $t("tasks.panel.today")}>
          <span class="btn-glyph">📋</span>
          <span class="btn-label">{$t("tasks.panel.allTasks")}</span>
        </button>
        <!-- Переключение Канбан/Расписание — только мобильные; на десктопе через меню -->
        <button class="task-tracker-btn sort-btn" class:active={sortMode === "priority"}
          on:click|stopPropagation={toggleSortMode}
          title={sortMode === "time" ? $t("tasks.panel.sortByTime") : $t("tasks.panel.sortByPriority")}>
          <span class="btn-glyph">{sortMode === "time" ? "🕐" : "🔺"}</span>
          <span class="btn-label">{sortMode === "time" ? $t("tasks.panel.sortByTime") : $t("tasks.panel.sortByPriority")}</span>
        </button>
        <button class="task-tracker-btn icon-btn" class:active={showSearch} on:click|stopPropagation={toggleSearch} title={$t("tasks.panel.search")}>
          <span class="btn-glyph">🔍</span>
          <span class="btn-label">{$t("tasks.panel.search")}</span>
        </button>
        <button class="task-tracker-btn add-btn" on:click|stopPropagation={openCreateTask} title={$t("tasks.modal.newTask")}>
          <span class="btn-glyph">+</span>
          <span class="btn-label">{$t("tasks.modal.newTask")}</span>
        </button>
        <div class="task-tracker-menu-wrapper">
          <button class="task-tracker-btn" on:click|stopPropagation={toggleMenu}>⋮</button>
          {#if showMenu}
            <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <div class="task-tracker-dropdown" on:click|stopPropagation on:keydown|stopPropagation role="menu" tabindex="-1">
              <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => { openProjectSettings(); closeMenu(); }}>{$t("tasks.panel.menuProjects")}</button>
              <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => { showTimeLogs = true; closeMenu(); }}>{$t("tasks.panel.menuTimeLogs")}</button>
              <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => { clearCompletedTasks(); closeMenu(); }}>{$t("tasks.panel.menuCleanDone")}</button>
              <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={toggleRecurringRoot} aria-expanded={showRecurringRoot}>{$t("tasks.panel.menuRecurringActions")} <span class="submenu-arrow" class:rotated={showRecurringRoot}>▸</span></button>
              {#if showRecurringRoot}
                <div class="task-tracker-submenu">
                  <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={showRecurringClear}>{$t("tasks.panel.menuCleanRecurring")} <span class="submenu-arrow" class:rotated={recurringPanel === "clear"}>▸</span></button>
                  <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={showRecurringEdit}>{$t("tasks.panel.menuEditRecurring")} <span class="submenu-arrow" class:rotated={recurringPanel === "edit"}>▸</span></button>
                  {#if recurringPanel === "clear"}
                    <div class="task-tracker-submenu task-tracker-submenu-nested">
                      <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={clearRecurringAll}>{$t("tasks.panel.recurringAll")}</button>
                      {#each getRecurringProjects() as proj (proj.id)}
                        <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => clearRecurringByProj(proj.id)}>{proj.icon} {proj.name}</button>
                      {/each}
                      {#each getRecurringNames() as name (name)}
                        <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => clearRecurringByTitle(name)}>📝 {name}</button>
                      {/each}
                    </div>
                  {:else if recurringPanel === "edit"}
                    <div class="task-tracker-submenu task-tracker-submenu-nested">
                      {#each getRecurringParents() as rtask (rtask.id)}
                        <button class="task-tracker-dropdown-item" role="menuitem" on:click|stopPropagation={() => editRecurringTask(rtask)}>🔄 {rtask.title}</button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
    <KanbanTabs />
  {/if}

  {#if showSearch}
    <div class="task-tracker-search-bar">
      <input type="text" class="task-tracker-search-input" placeholder={$t("tasks.panel.search")} bind:value={searchQuery} />
    </div>
  {/if}



  <div class="task-tracker-body">
    <div class="task-tracker-list">
      {#if filteredTasks.length === 0}
        <div class="task-tracker-empty">
          <div class="empty-illustration">✅</div>
          <div class="empty-title">{$t("tasks.panel.empty")}</div>
          <div class="empty-subtitle">{$t("tasks.panel.emptyHint")}</div>
          <button class="empty-cta" on:click={openCreateTask}>+ {$t("tasks.modal.newTask")}</button>
        </div>
      {:else if showAllDates}
        {#each taskGroups as dateGroup (dateGroup.dateUID)}
          <div class="task-date-group-header">
            <span class="date-group-label">{dateGroup.dateLabel}</span>
          </div>
          {#each dateGroup.groups as group (dateGroup.dateUID + "-" + (group.project?.id || "none"))}
            {#each group.tasks as task (task.id)}
              <TaskItem {task} {appInstance} on:complete={(e) => handleTaskComplete(e.detail.task)} on:delete={(e) => handleTaskDelete(e.detail.task)} />
            {/each}
          {/each}
        {/each}
      {:else}
        {#each sortedDisplayTasks as task (task.id)}
          <TaskItem {task} {appInstance} on:complete={(e) => handleTaskComplete(e.detail.task)} on:delete={(e) => handleTaskDelete(e.detail.task)} />
        {/each}
      {/if}
    </div>
  </div>
</div>

{#if showTimeLogs}
  <TimeLogsModal onClose={() => (showTimeLogs = false)} />
{/if}
