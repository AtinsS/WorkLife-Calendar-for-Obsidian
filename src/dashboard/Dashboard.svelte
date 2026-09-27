<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import moment from "moment";
  import type { App } from "obsidian";
  import { FileSuggestModal } from "../modals/FileSuggestModal";
  import type { DashboardData, DashboardCard } from "./types";
  import {
    loadDashboard,
    addCard,
    updateCard,
    deleteCard,
    addLink,
    deleteLink,
    reorderCards,
  } from "./storage";
  import { tasks, projects, updateTaskStatus, addTask, updateTask, removeTask } from "../task-tracker/stores";
  import { habits, habitLogs, toggleHabitCompletion, getHabitProgressOnDate, addHabit, updateHabit, removeHabit } from "../habit-tracker/stores";
  import { TaskModal } from "../task-tracker/TaskModal";
  import { HabitModal } from "../habit-tracker/HabitModal";
  import type { ITask } from "../task-tracker/types";
  import type { IHabit } from "../habit-tracker/types";
  import { getDateUID } from "obsidian-daily-notes-interface";
  import { getCurrentMonthKey, financeData, rolloverGoals, getArchivedGoals, deleteArchivedGoal } from "../finance/storage";
  import { settings } from "../ui/stores";
  import { t } from "../i18n";

  export let appInstance: App;
  export let filePath: string | undefined = undefined;

  let data: DashboardData = { cards: [] };
  let editingCard: DashboardCard | null = null;
  let editingCardTitle = "";
  let editingCardIcon = "";
  let showCardModal = false;

  let addingLinkToCardId: string | null = null;
  let newLinkLabel = "";
  let newLinkPath = "";
  let showLinkModal = false;

  let showAddCardModal = false;
  let newCardTitle = "";
  let newCardIcon = "📁";

  // Reactive current date — updates every minute so day rollover works
  let now = moment();
  const dateInterval = setInterval(() => { now = moment(); }, 60_000);
  onDestroy(() => clearInterval(dateInterval));

  // Widget settings
  $: showTasksWidget = $settings.dashboardShowTasks !== false;
  $: showHabitsWidget = $settings.dashboardShowHabits !== false && $settings.habitTrackerMode !== "hidden";
  $: showGoalsWidget = $settings.dashboardShowGoals !== false;

  // Widget expand state
  let tasksExpanded = false;
  let habitsExpanded = false;
  let goalsExpanded = false;

  // Drag & drop state
  let draggedCardId: string | null = null;
  let dragOverCardId: string | null = null;

  function onDragStart(e: DragEvent, cardId: string) {
    draggedCardId = cardId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cardId);
    (e.target as HTMLElement).classList.add("dragging");
  }

  function onDragEnd(e: DragEvent) {
    (e.target as HTMLElement).classList.remove("dragging");
    draggedCardId = null;
    dragOverCardId = null;
  }

  function onDragOver(e: DragEvent, cardId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (cardId !== draggedCardId) {
      dragOverCardId = cardId;
    }
  }

  function onDragLeave() {
    dragOverCardId = null;
  }

  async function onDrop(e: DragEvent, targetCardId: string) {
    e.preventDefault();
    if (!draggedCardId || draggedCardId === targetCardId) return;

    const ids = data.cards.map(c => c.id);
    const fromIdx = ids.indexOf(draggedCardId);
    const toIdx = ids.indexOf(targetCardId);
    if (fromIdx === -1 || toIdx === -1) return;

    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, draggedCardId);

    await reorderCards(appInstance, ids, filePath);
    data = await loadDashboard(appInstance, filePath);
    draggedCardId = null;
    dragOverCardId = null;
  }

  // Tasks widget data — react to `now` so day rollover works
  $: todayStr = now.format("YYYY-MM-DD");
  $: todayDateUID = getDateUID(now, "day");
  $: todayAllTasks = $tasks
    .filter((t) => {
      if (t.dateUID === todayDateUID) return true;
      // Fallback: match by calendar day (legacy / timezone-shifted UIDs)
      const d = t.dateUID?.match(/^day-(\d{4}-\d{2}-\d{2})/)?.[1];
      return d === todayStr;
    })
    .sort((a, b) => {
      if (a.status === "done" && b.status !== "done") return 1;
      if (a.status !== "done" && b.status === "done") return -1;
      if (a.scheduledTime && b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
      if (a.scheduledTime) return -1;
      if (b.scheduledTime) return 1;
      return 0;
    });
  $: todayDone = todayAllTasks.filter((t) => t.status === "done").length;
  $: todayTotal = todayAllTasks.length;
  $: todayProgress = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 0;

  // Habits widget data
  $: todayHabits = (() => {
    void $habitLogs; // re-render when habit logs change
    return $habits
      .filter((h) => !h.archived)
      .map((h) => ({ ...h, progress: getHabitProgressOnDate(h.id, todayStr) }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  })();
  $: habitDoneCount = todayHabits.filter((h) => h.progress === 2).length;
  $: habitTotalCount = todayHabits.length;

  // Goals widget data
  $: monthKey = getCurrentMonthKey();
  $: monthData = (() => {
    const allData = $financeData;
    if (!allData[monthKey]) return null;
    return allData[monthKey];
  })();
  $: monthGoals = monthData?.monthGoals || [];

  // Archive state
  let showArchive = false;
  $: archivedGoals = (() => {
    void $financeData;
    return getArchivedGoals();
  })();

  function removeArchivedGoal(goalId: string) {
    deleteArchivedGoal(goalId);
  }

  function cycleTaskStatus(task: { id: string; status: string }) {
    const next = task.status === "done" ? "todo" : "done";
    updateTaskStatus(task.id, next as "todo" | "done");
    // Ensure completed flag stays in sync even if timer paths skip it
    if (next === "done") updateTask(task.id, { completed: true });
  }

  // Task CRUD
  function openCreateTask() {
    const todayDateUID = getDateUID(now, "day");
    new TaskModal(appInstance, (taskData) => {
      addTask({
        ...taskData,
        dateUID: todayDateUID,
        status: "todo",
        completed: false,
        sortOrder: todayAllTasks.length,
      } as Omit<ITask, "id" | "createdAt" | "updatedAt">);
    }, undefined, todayStr).open();
  }

  function openEditTask(task: ITask) {
    new TaskModal(appInstance, (changes) => {
      updateTask(task.id, changes);
    }, task).open();
  }

  function deleteTask(taskId: string) {
    removeTask(taskId);
  }

  // Habit CRUD
  function openCreateHabit() {
    new HabitModal(appInstance, (habitData) => {
      addHabit({
        ...habitData,
        sortOrder: habitTotalCount,
      } as Omit<IHabit, "id" | "createdAt">);
    }).open();
  }

  function openEditHabit(habit: IHabit) {
    new HabitModal(appInstance, (changes) => {
      updateHabit(habit.id, changes);
    }, habit).open();
  }

  function deleteHabit(habitId: string) {
    removeHabit(habitId);
  }

  onMount(async () => {
    data = await loadDashboard(appInstance, filePath);
    // Rollover goals from previous month
    const now = new Date();
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
    rolloverGoals(prevKey, monthKey);
  });

  function openEditCard(card: DashboardCard) {
    editingCard = card;
    editingCardTitle = card.title;
    editingCardIcon = card.icon;
    showCardModal = true;
  }

  async function saveCardEdit() {
    if (!editingCard) return;
    await updateCard(appInstance, editingCard.id, {
      title: editingCardTitle,
      icon: editingCardIcon,
    }, filePath);
    data = await loadDashboard(appInstance, filePath);
    showCardModal = false;
    editingCard = null;
  }

  async function removeCard(cardId: string) {
    await deleteCard(appInstance, cardId, filePath);
    data = await loadDashboard(appInstance, filePath);
  }

  function openAddLink(cardId: string) {
    addingLinkToCardId = cardId;
    newLinkLabel = "";
    newLinkPath = "";
    showLinkModal = true;
  }

  async function saveNewLink() {
    if (!addingLinkToCardId || !newLinkLabel) return;
    await addLink(appInstance, addingLinkToCardId, newLinkLabel, newLinkPath, filePath);
    data = await loadDashboard(appInstance, filePath);
    showLinkModal = false;
    addingLinkToCardId = null;
  }

  async function removeLink(cardId: string, linkId: string) {
    await deleteLink(appInstance, cardId, linkId, filePath);
    data = await loadDashboard(appInstance, filePath);
  }

  async function createNewCard() {
    if (!newCardTitle) return;
    await addCard(appInstance, newCardTitle, newCardIcon, filePath);
    data = await loadDashboard(appInstance, filePath);
    showAddCardModal = false;
    newCardTitle = "";
    newCardIcon = "📁";
  }

  function openFilePicker() {
    new FileSuggestModal(appInstance, (filePath) => {
      newLinkPath = filePath;
      // Auto-fill label from filename if empty
      if (!newLinkLabel) {
        const parts = filePath.split("/");
        const name = parts[parts.length - 1].replace(/\.md$/, "");
        newLinkLabel = name;
      }
    }).open();
  }

  function handleLinkClick(e: MouseEvent, notePath: string) {
    e.preventDefault();
    if (notePath) {
      appInstance.workspace.openLinkText(notePath, "", true);
    }
  }

  function closeModal(e: MouseEvent, closeFn: () => void) {
    if ((e.target as HTMLElement).classList.contains("dash-popup-overlay")) {
      closeFn();
    }
  }
</script>

<div class="dashboard">
  <!-- Widgets row -->
  <div class="dashboard__widgets">
    <!-- Tasks widget -->
    {#if showTasksWidget}
      <div class="dash-widget-wrap">
        <div class="dash-widget dash-widget--tasks" class:expanded={tasksExpanded} role="button" tabindex="0" on:click={() => tasksExpanded = !tasksExpanded} on:keydown={(e) => e.key === "Enter" && (tasksExpanded = !tasksExpanded)}>
          <span class="dash-widget__icon-wrap" data-kind="tasks">
            <span class="dash-widget__icon">✅</span>
          </span>
          <span class="dash-widget__body">
            <span class="dash-widget__label">{$t("dashboard.tasks")}</span>
            {#if todayTotal > 0}
              <div class="dash-widget__bar"><div class="dash-widget__bar-fill" class:complete={todayProgress >= 100} style="width:{todayProgress}%"></div></div>
            {/if}
          </span>
          {#if todayTotal > 0}
            <span class="dash-widget__count" class:done={todayDone === todayTotal}>{todayDone}/{todayTotal}</span>
          {/if}
          <button class="dash-widget__add-btn" on:click|stopPropagation={openCreateTask} title={$t("dashboard.addCard")}>+</button>
          {#if todayTotal > 0}<span class="dash-widget__chevron" class:open={tasksExpanded}>›</span>{/if}
        </div>
        {#if tasksExpanded && todayTotal > 0}
          <div class="dash-widget__dropdown">
            {#each todayAllTasks as task (task.id)}
              {@const project = $projects.find(p => p.id === task.projectId)}
              <div
                class="dash-task"
                class:done={task.status === "done"}
                class:progress={task.status === "progress"}
                data-status={task.status}
                role="button"
                tabindex="0"
                on:click={() => cycleTaskStatus(task)}
                on:keydown={(e) => e.key === "Enter" && cycleTaskStatus(task)}
              >
                <button class="dash-task-check" class:checked={task.status === "done"} class:in-progress={task.status === "progress"} on:click|stopPropagation={() => cycleTaskStatus(task)} aria-label={$t("tasks.item.markDone")}>
                  {#if task.status === "done"}
                    <svg class="dash-check-svg" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  {:else if task.status === "progress"}
                    <span class="dash-check-icon">◐</span>
                  {/if}
                </button>
                <div class="dash-task-main">
                  <span class="dash-task-title" class:strike={task.status === "done"}>{task.title}</span>
                  <div class="dash-task-meta">
                    {#if task.scheduledTime}<span class="dash-task-time">🕐 {task.scheduledTime}</span>{/if}
                    {#if project}<span class="dash-task-project" style="--pc:{project.color}"><span class="dash-task-project-dot"></span>{project.icon || "📁"} {project.name}</span>{/if}
                  </div>
                </div>
                <div class="dash-task-actions">
                  <button class="dash-btn dash-btn--sm" on:click|stopPropagation={() => openEditTask(task)} title={$t("common.edit")}>✎</button>
                  <button class="dash-btn dash-btn--sm dash-btn--danger" on:click|stopPropagation={() => deleteTask(task.id)} title={$t("common.delete")}>✕</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Habits widget -->
    {#if showHabitsWidget}
      <div class="dash-widget-wrap">
        <div class="dash-widget dash-widget--habits" class:expanded={habitsExpanded} role="button" tabindex="0" on:click={() => habitsExpanded = !habitsExpanded} on:keydown={(e) => e.key === "Enter" && (habitsExpanded = !habitsExpanded)}>
          <span class="dash-widget__icon-wrap" data-kind="habits">
            <span class="dash-widget__icon">🔥</span>
          </span>
          <span class="dash-widget__body">
            <span class="dash-widget__label">{$t("dashboard.habits")}</span>
            {#if habitTotalCount > 0}
              <div class="dash-widget__bar"><div class="dash-widget__bar-fill habit-fill" class:complete={habitDoneCount >= habitTotalCount} style="width:{habitTotalCount > 0 ? Math.round(habitDoneCount / habitTotalCount * 100) : 0}%"></div></div>
            {/if}
          </span>
          {#if habitTotalCount > 0}
            <span class="dash-widget__count" class:done={habitDoneCount >= habitTotalCount}>{habitDoneCount}/{habitTotalCount}</span>
          {/if}
          <button class="dash-widget__add-btn" on:click|stopPropagation={openCreateHabit} title={$t("dashboard.addCard")}>+</button>
          {#if habitTotalCount > 0}<span class="dash-widget__chevron" class:open={habitsExpanded}>›</span>{/if}
        </div>
        {#if habitsExpanded && habitTotalCount > 0}
          <div class="dash-widget__dropdown">
            {#each todayHabits as habit (habit.id)}
              <div
                class="dash-habit"
                class:done={habit.progress === 2}
                style="--hc:{habit.color}"
                role="button"
                tabindex="0"
                on:click={() => toggleHabitCompletion(habit.id, todayStr, habit.targetCount || 1)}
                on:keydown={(e) => e.key === "Enter" && toggleHabitCompletion(habit.id, todayStr, habit.targetCount || 1)}
              >
                <button class="dash-habit-check" class:checked={habit.progress === 2} on:click|stopPropagation={() => toggleHabitCompletion(habit.id, todayStr, habit.targetCount || 1)} aria-label={$t("tasks.item.markDone")}>
                  {#if habit.progress === 2}<svg class="dash-check-svg" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
                </button>
                <span class="dash-habit-icon">{habit.icon}</span>
                <div class="dash-habit-main">
                  <span class="dash-habit-name" class:strike={habit.progress === 2}>{habit.title}</span>
                  {#if habit.targetCount && habit.targetCount > 1}
                    <span class="dash-habit-target">{habit.progress}/{habit.targetCount}</span>
                  {/if}
                </div>
                <div class="dash-habit-actions">
                  <button class="dash-btn dash-btn--sm" on:click|stopPropagation={() => openEditHabit(habit)} title={$t("common.edit")}>✎</button>
                  <button class="dash-btn dash-btn--sm dash-btn--danger" on:click|stopPropagation={() => deleteHabit(habit.id)} title={$t("common.delete")}>✕</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Goals widget -->
    {#if showGoalsWidget && monthGoals.length > 0}
      <div class="dash-widget-wrap">
        <button class="dash-widget dash-widget--goals" class:expanded={goalsExpanded} on:click={() => goalsExpanded = !goalsExpanded}>
          <span class="dash-widget__icon">{monthGoals[0]?.icon || '🎯'}</span>
          {#if monthGoals.length === 1}
            <span class="dash-widget__label">{monthGoals[0].name}</span>
            {@const g = monthGoals[0]}
            <div class="dash-widget__bar"><div class="dash-widget__bar-fill goal-fill" style="width:{g.targetAmount > 0 ? Math.min(100, Math.round(g.currentAmount / g.targetAmount * 100)) : 0}%"></div></div>
            <span class="dash-widget__count">{g.currentAmount.toLocaleString($t("locale.numberLocale"))}/{g.targetAmount.toLocaleString($t("locale.numberLocale"))} {$t("locale.currencySymbol")}</span>
          {:else}
            <span class="dash-widget__label">{monthGoals[0].name} +{monthGoals.length - 1}</span>
            <span class="dash-widget__count">{$t("dashboard.goalsCount", {count: monthGoals.length})}</span>
            <span class="dash-widget__chevron" class:open={goalsExpanded}>›</span>
          {/if}
        </button>
        {#if goalsExpanded && monthGoals.length > 1}
          <div class="dash-widget__dropdown">
            {#each monthGoals as goal (goal.id)}
              <div class="dash-goal">
                <span class="dash-goal-icon">{goal.icon}</span>
                <span class="dash-goal-name">{goal.name}</span>
                <div class="dash-goal-bar"><div class="dash-goal-bar-fill" style="width:{goal.targetAmount > 0 ? Math.min(100, Math.round(goal.currentAmount / goal.targetAmount * 100)) : 0}%"></div></div>
                <span class="dash-goal-amt">{goal.currentAmount.toLocaleString($t("locale.numberLocale"))}/{goal.targetAmount.toLocaleString($t("locale.numberLocale"))} {$t("locale.currencySymbol")}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Archive -->
  {#if archivedGoals.length > 0}
    <div class="dash-archive">
      <button class="dash-archive__toggle" on:click={() => showArchive = !showArchive}>
        <span class="dash-archive__icon">📦</span>
        <span class="dash-archive__label">{$t("dashboard.archive")} ({archivedGoals.length})</span>
        <span class="dash-widget__chevron" class:open={showArchive}>›</span>
      </button>
      {#if showArchive}
        <div class="dash-archive__list">
          {#each archivedGoals as goal (goal.id)}
            <div class="dash-archive__item">
              <span class="dash-goal-icon">{goal.icon}</span>
              <span class="dash-goal-name">{goal.name}</span>
              <span class="dash-archive__done">✓</span>
              <span class="dash-goal-amt">{goal.currentAmount.toLocaleString($t("locale.numberLocale"))}/{goal.targetAmount.toLocaleString($t("locale.numberLocale"))} {$t("locale.currencySymbol")}</span>
              <button class="dash-btn dash-btn--sm dash-btn--danger" on:click|stopPropagation={() => removeArchivedGoal(goal.id)} title={$t("common.delete")}>✕</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="dashboard__grid">
    {#each data.cards as card, i (card.id)}
      <div
        class="dashboard-card"
        class:drag-over={dragOverCardId === card.id}
        style="--card-index: {i}"
        draggable="true"
        on:dragstart={(e) => onDragStart(e, card.id)}
        on:dragend={onDragEnd}
        on:dragover={(e) => onDragOver(e, card.id)}
        on:dragleave={onDragLeave}
        on:drop={(e) => onDrop(e, card.id)}
      >
        <div class="dashboard-card__header">
          <h3 class="dashboard-card__title">
            <span class="dashboard-card__drag-handle">⠿</span>
            <span>{card.icon} {card.title}</span>
          </h3>
          <div class="dashboard-card__actions">
            <button
              class="dash-btn dash-btn--icon"
              title={$t("dashboard.addLink")}
              on:click={() => openAddLink(card.id)}
            >+</button>
            <button
              class="dash-btn dash-btn--icon"
              title={$t("dashboard.editCard")}
              on:click={() => openEditCard(card)}
            >✎</button>
            <button
              class="dash-btn dash-btn--icon dash-btn--danger"
              title={$t("dashboard.deleteCard")}
              on:click={() => removeCard(card.id)}
            >✕</button>
          </div>
        </div>
        <div class="dashboard-card__links">
          {#each card.links as link (link.id)}
            <a
              href={link.notePath}
              class="internal-link dashboard-card__item"
              on:click={(e) => handleLinkClick(e, link.notePath)}
            >
              <span class="dash-link-label">{link.label}</span>
              <button
                class="dash-btn dash-btn--sm dash-btn--danger"
                title={$t("dashboard.deleteLink")}
                on:click|stopPropagation|preventDefault={() => removeLink(card.id, link.id)}
              >✕</button>
            </a>
          {/each}
          {#if card.links.length === 0}
            <div class="dashboard-card__empty">{$t("dashboard.noLinks")}</div>
          {/if}
        </div>
      </div>
    {/each}

    <!-- Add card button -->
    <button class="dashboard-card dashboard-card--add" on:click={() => { showAddCardModal = true; newCardTitle = ""; newCardIcon = "📁"; }}>
      <span class="dashboard-card__add-icon">+</span>
      <span class="dashboard-card__add-text">{$t("dashboard.addCard")}</span>
    </button>
  </div>
</div>

<!-- Edit card modal -->
{#if showCardModal}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="dash-popup-overlay" role="dialog" aria-modal="true" on:click={(e) => closeModal(e, () => { showCardModal = false; editingCard = null; })} on:keydown={(e) => { if (e.key === 'Escape') { showCardModal = false; editingCard = null; } }}>
    <div class="dash-popup">
      <h3 class="dash-popup__title">{$t("dashboard.editCard")}</h3>
      <label class="dash-popup__label">
        {$t("dashboard.icon")}
        <input class="dash-popup__input" type="text" bind:value={editingCardIcon} maxlength="4" />
      </label>
      <label class="dash-popup__label">
        {$t("dashboard.name")}
        <input class="dash-popup__input" type="text" bind:value={editingCardTitle} placeholder={$t("dashboard.cardNamePlaceholder")} />
      </label>
      <div class="dash-popup__actions">
        <button class="dash-btn dash-btn--cancel" on:click={() => { showCardModal = false; editingCard = null; }}>{$t("common.cancel")}</button>
        <button class="dash-btn dash-btn--save" on:click={saveCardEdit}>{$t("common.save")}</button>
      </div>
    </div>
  </div>
{/if}

<!-- Add link modal -->
{#if showLinkModal}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="dash-popup-overlay" role="dialog" aria-modal="true" on:click={(e) => closeModal(e, () => { showLinkModal = false; addingLinkToCardId = null; })} on:keydown={(e) => { if (e.key === 'Escape') { showLinkModal = false; addingLinkToCardId = null; } }}>
    <div class="dash-popup">
      <h3 class="dash-popup__title">{$t("dashboard.addLink")}</h3>
      <label class="dash-popup__label">
        {$t("dashboard.name")}
        <input class="dash-popup__input" type="text" bind:value={newLinkLabel} placeholder={$t("dashboard.linkNamePlaceholder")} />
      </label>
      <label class="dash-popup__label">
        {$t("dashboard.notePath")}
        <div class="dash-popup__input-row">
          <input class="dash-popup__input" type="text" bind:value={newLinkPath} placeholder={$t("dashboard.pathPlaceholder")} />
          <button class="dash-btn dash-btn--browse" title={$t("dashboard.notePath")} on:click={openFilePicker}>...</button>
        </div>
      </label>
      <div class="dash-popup__actions">
        <button class="dash-btn dash-btn--cancel" on:click={() => { showLinkModal = false; addingLinkToCardId = null; }}>{$t("common.cancel")}</button>
        <button class="dash-btn dash-btn--save" on:click={saveNewLink}>{$t("common.add")}</button>
      </div>
    </div>
  </div>
{/if}

<!-- Add card modal -->
{#if showAddCardModal}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="dash-popup-overlay" role="dialog" aria-modal="true" on:click={(e) => closeModal(e, () => { showAddCardModal = false; })} on:keydown={(e) => { if (e.key === 'Escape') { showAddCardModal = false; } }}>
    <div class="dash-popup">
      <h3 class="dash-popup__title">{$t("dashboard.newCard")}</h3>
      <label class="dash-popup__label">
        {$t("dashboard.icon")}
        <input class="dash-popup__input" type="text" bind:value={newCardIcon} maxlength="4" />
      </label>
      <label class="dash-popup__label">
        {$t("dashboard.name")}
        <input class="dash-popup__input" type="text" bind:value={newCardTitle} placeholder={$t("dashboard.cardNamePlaceholder")} />
      </label>
      <div class="dash-popup__actions">
        <button class="dash-btn dash-btn--cancel" on:click={() => { showAddCardModal = false; }}>{$t("common.cancel")}</button>
        <button class="dash-btn dash-btn--save" on:click={createNewCard}>{$t("common.create")}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Widgets */
  .dashboard__widgets { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }

  .dash-widget-wrap { display: flex; flex-direction: column; flex: 1; min-width: 220px; }

  .dash-widget {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 14px;
    background:
      linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015));
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 14px;
    cursor: pointer; font-family: inherit; color: inherit;
    transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease, background 0.2s ease;
    text-align: left; width: 100%;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    box-sizing: border-box;
    min-height: 56px;
    outline: none;
    user-select: none;
  }
  .dash-widget:focus-visible {
    border-color: color-mix(in srgb, var(--interactive-accent, #7c5cfc) 45%, transparent);
  }
  .dash-widget:hover {
    border-color: rgba(255,255,255,0.12);
    background: linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02));
    box-shadow: 0 4px 18px rgba(0,0,0,0.14);
  }
  .dash-widget:active { transform: scale(0.99); }
  .dash-widget.expanded {
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -2px 16px rgba(0,0,0,0.1);
  }

  .dash-widget__icon-wrap {
    width: 36px; height: 36px;
    border-radius: 11px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .dash-widget__icon-wrap[data-kind="tasks"] {
    background: color-mix(in srgb, var(--interactive-accent, #7c5cfc) 16%, transparent);
    border-color: color-mix(in srgb, var(--interactive-accent, #7c5cfc) 28%, transparent);
  }
  .dash-widget__icon-wrap[data-kind="habits"] {
    background: rgba(255, 140, 60, 0.14);
    border-color: rgba(255, 140, 60, 0.28);
  }
  .dash-widget__icon { font-size: 16px; line-height: 1; }

  .dash-widget__body {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 5px;
  }
  .dash-widget__label {
    font-size: 13px; font-weight: 650; color: var(--text-normal);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    letter-spacing: 0.01em;
  }

  .dash-widget__bar {
    width: 100%; max-width: 120px; height: 4px;
    background: rgba(255,255,255,0.07);
    border-radius: 999px; overflow: hidden;
  }
  .dash-widget__bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--interactive-accent), color-mix(in srgb, var(--interactive-accent) 60%, #fff 20%));
    border-radius: 999px;
    transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 0 0 8px color-mix(in srgb, var(--interactive-accent) 40%, transparent);
  }
  .dash-widget__bar-fill.habit-fill {
    background: linear-gradient(90deg, #ff8c3c, #ffb35c);
    box-shadow: 0 0 8px rgba(255, 140, 60, 0.35);
  }
  .dash-widget__bar-fill.goal-fill {
    background: linear-gradient(90deg, var(--interactive-accent), #3dd68c);
    box-shadow: 0 0 8px color-mix(in srgb, var(--interactive-accent) 35%, transparent);
  }
  .dash-widget__bar-fill.complete {
    background: linear-gradient(90deg, #3dd68c, #6eebb0);
    box-shadow: 0 0 8px rgba(61, 214, 140, 0.35);
  }

  .dash-widget__count {
    font-size: 11px; font-weight: 700;
    color: var(--text-muted);
    background: rgba(255,255,255,0.05);
    padding: 3px 8px; border-radius: 999px;
    flex-shrink: 0; white-space: nowrap;
    border: 1px solid rgba(255,255,255,0.05);
  }
  .dash-widget__count.done {
    color: #3dd68c;
    background: rgba(61, 214, 140, 0.12);
    border-color: rgba(61, 214, 140, 0.25);
  }

  .dash-widget__chevron {
    font-size: 16px; color: var(--text-faint);
    transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
    flex-shrink: 0;
  }
  .dash-widget__chevron.open { transform: rotate(90deg); color: var(--text-muted); }

  .dash-widget__add-btn {
    width: 24px; height: 24px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.05);
    color: var(--text-muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s, transform 0.12s, box-shadow 0.15s;
  }
  .dash-widget__add-btn:hover {
    background: var(--interactive-accent);
    border-color: transparent;
    color: var(--text-on-accent);
    box-shadow: 0 3px 12px color-mix(in srgb, var(--interactive-accent) 40%, transparent);
  }
  .dash-widget__add-btn:active { transform: scale(0.92); }

  .dash-widget__dropdown {
    background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent), var(--background-secondary);
    border: 1px solid rgba(255,255,255,0.06);
    border-top: none;
    border-radius: 0 0 14px 14px;
    padding: 6px 8px 10px;
    display: flex; flex-direction: column; gap: 4px;
    animation: dd-open 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes dd-open { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

  /* Task rows */
  .dash-task {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 10px;
    cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
    width: 100%; text-align: left; color: var(--text-normal); font-family: inherit; font-size: 13px;
  }
  .dash-task:hover {
    background: rgba(255,255,255,0.05);
    border-color: rgba(255,255,255,0.08);
  }
  .dash-task:active { transform: scale(0.99); }
  .dash-task.done { opacity: 0.55; }
  .dash-task.progress {
    border-left: 2px solid color-mix(in srgb, var(--interactive-accent, #7c5cfc) 70%, transparent);
    padding-left: 8px;
  }

  .dash-task-check {
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    min-width: 18px;
    min-height: 18px;
    max-width: 18px;
    max-height: 18px;
    aspect-ratio: 1 / 1;
    padding: 0;
    margin: 0;
    border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.16);
    background: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 18px;
    overflow: hidden;
    transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    color: transparent;
    font-size: 10px;
    line-height: 1;
    vertical-align: middle;
  }
  .dash-task-check:hover { border-color: color-mix(in srgb, var(--interactive-accent, #7c5cfc) 55%, transparent); }
  .dash-task-check.checked {
    background: linear-gradient(135deg, var(--interactive-accent, #7c5cfc), color-mix(in srgb, var(--interactive-accent, #7c5cfc) 70%, #fff 15%));
    border-color: transparent; color: #fff;
    box-shadow: 0 2px 10px color-mix(in srgb, var(--interactive-accent, #7c5cfc) 35%, transparent);
  }
  .dash-task-check.in-progress {
    border-color: var(--interactive-accent, #7c5cfc);
    color: var(--interactive-accent, #7c5cfc);
    background: color-mix(in srgb, var(--interactive-accent, #7c5cfc) 12%, transparent);
  }

  .dash-task-main {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column; gap: 3px;
  }
  .dash-task-title {
    font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0; font-size: 12.5px; line-height: 1.3;
  }
  .dash-task-title.strike { text-decoration: line-through; color: var(--text-faint); }
  .dash-task-meta {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    min-width: 0;
  }
  .dash-task-time {
    font-size: 10px; font-weight: 600; color: var(--text-muted);
    background: rgba(255,255,255,0.04);
    padding: 1px 6px; border-radius: 999px; flex-shrink: 0;
  }
  .dash-task-project {
    font-size: 10px; font-weight: 600;
    color: var(--text-muted);
    display: inline-flex; align-items: center; gap: 4px;
    background: color-mix(in srgb, var(--pc, #888) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--pc, #888) 28%, transparent);
    padding: 1px 6px; border-radius: 999px;
    max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .dash-task-project-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--pc, #888); flex-shrink: 0;
    box-shadow: 0 0 6px color-mix(in srgb, var(--pc, #888) 50%, transparent);
  }

  .dash-task-actions {
    display: flex; gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }
  .dash-task:hover .dash-task-actions { opacity: 1; }
  @media (max-width: 768px) {
    .dash-task-actions { opacity: 0.55; }
  }

  /* Habit rows */
  .dash-habit {
    display: flex; align-items: center; gap: 9px;
    padding: 8px 10px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 10px;
    cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
    width: 100%; text-align: left; color: var(--text-normal); font-family: inherit; font-size: 13px;
  }
  .dash-habit:hover {
    background: rgba(255,255,255,0.05);
    border-color: color-mix(in srgb, var(--hc, #3dd68c) 22%, transparent);
  }
  .dash-habit:active { transform: scale(0.99); }
  .dash-habit.done {
    opacity: 0.6;
    border-color: color-mix(in srgb, var(--hc, #3dd68c) 20%, transparent);
  }

  .dash-habit-check {
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    min-width: 18px;
    min-height: 18px;
    max-width: 18px;
    max-height: 18px;
    aspect-ratio: 1 / 1;
    padding: 0;
    margin: 0;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--hc, #3dd68c) 35%, transparent);
    background: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 18px;
    overflow: hidden;
    transition: all 0.22s cubic-bezier(0.22, 1, 0.36, 1);
    color: transparent;
    line-height: 1;
    vertical-align: middle;
  }
  .dash-habit-check:hover {
    background: color-mix(in srgb, var(--hc, #3dd68c) 12%, transparent);
  }
  .dash-habit-check.checked {
    background: var(--hc, #3DD68C);
    border-color: var(--hc, #3DD68C); color: #fff;
    box-shadow: 0 2px 10px color-mix(in srgb, var(--hc, #3DD68C) 40%, transparent);
  }
  .dash-check-icon {
    display: block;
    width: 10px;
    height: 10px;
    line-height: 1;
    font-size: 9px;
    overflow: hidden;
    text-align: center;
    pointer-events: none;
    flex-shrink: 0;
  }
  .dash-check-svg {
    width: 9px;
    height: 9px;
    display: block;
    flex-shrink: 0;
    pointer-events: none;
  }
  .dash-habit-icon {
    width: 26px; height: 26px;
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; line-height: 1; flex-shrink: 0;
    background: color-mix(in srgb, var(--hc, #3dd68c) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--hc, #3dd68c) 20%, transparent);
  }
  .dash-habit-main {
    flex: 1; min-width: 0;
    display: flex; align-items: center; gap: 8px;
  }
  .dash-habit-name {
    font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0; font-size: 12.5px; line-height: 1.3; flex: 1;
  }
  .dash-habit-name.strike { text-decoration: line-through; color: var(--text-faint); }
  .dash-habit-target {
    font-size: 10px; font-weight: 700;
    color: var(--text-muted);
    background: rgba(255,255,255,0.05);
    padding: 2px 7px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }

  .dash-habit-actions {
    display: flex; gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }
  .dash-habit:hover .dash-habit-actions { opacity: 1; }
  @media (max-width: 768px) {
    .dash-habit-actions { opacity: 0.55; }
  }

  /* Goal rows */
  .dash-goal { display: flex; align-items: center; gap: 8px; padding: 6px 8px; font-size: 12.5px; }
  .dash-goal-icon { font-size: 13px; flex-shrink: 0; }
  .dash-goal-name { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .dash-goal-bar { width: 52px; height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; flex-shrink: 0; }
  .dash-goal-bar-fill { height: 100%; background: linear-gradient(90deg, var(--interactive-accent), #3dd68c); border-radius: 2px; transition: width 0.4s ease; }
  .dash-goal-amt { font-size: 10px; color: var(--text-faint); flex-shrink: 0; white-space: nowrap; }

  /* Card drag & drop */
  .dashboard-card[draggable="true"] {
    cursor: grab;
    transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  }

  .dashboard-card[draggable="true"]:active {
    cursor: grabbing;
  }

  :global(.dashboard-card.dragging) {
    opacity: 0.4;
    transform: scale(0.98);
  }

  .dashboard-card.drag-over {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px rgba(var(--interactive-accent-rgb, 124, 92, 252), 0.3);
    transform: translateY(-2px);
  }

  .dashboard-card__drag-handle {
    cursor: grab;
    color: var(--text-muted);
    opacity: 0.4;
    font-size: 14px;
    margin-right: 4px;
    user-select: none;
    transition: opacity 0.15s ease;
  }

  .dashboard-card:hover .dashboard-card__drag-handle {
    opacity: 0.8;
  }

  .dashboard-card__drag-handle:active {
    cursor: grabbing;
  }

  /* Card actions */
  .dashboard-card__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .dashboard-card__actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .dashboard-card:hover .dashboard-card__actions {
    opacity: 1;
  }

  @media (max-width: 768px) {
    .dashboard-card__actions {
      opacity: 1;
    }
  }

  .dash-btn {
    cursor: pointer;
    border: none;
    background: transparent;
    color: var(--text-muted);
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
  }

  .dash-btn--icon {
    min-width: 24px;
    min-height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dash-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .dash-btn--danger:hover {
    background: var(--background-modifier-error);
    color: var(--text-error);
  }

  .dash-btn--sm {
    padding: 2px 6px;
    font-size: 11px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .dashboard-card__item:hover .dash-btn--sm {
    opacity: 1;
  }

  @media (max-width: 768px) {
    .dash-btn--sm {
      opacity: 0.6;
    }
  }

  .dash-link-label {
    flex: 1;
  }

  .dashboard-card__empty {
    text-align: center;
    color: var(--text-faint);
    font-size: 13px;
    padding: 16px 0;
  }

  /* Add card button */
  .dashboard-card--add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 160px;
    border: 2px dashed var(--background-modifier-border);
    background: transparent;
    cursor: pointer;
    opacity: 1;
    transform: none;
    animation: none;
  }

  .dashboard-card--add:hover {
    border-color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 5%, transparent);
  }

  .dashboard-card__add-icon {
    font-size: 28px;
    color: var(--text-faint);
    transition: color 0.2s;
  }

  .dashboard-card--add:hover .dashboard-card__add-icon {
    color: var(--interactive-accent);
  }

  .dashboard-card__add-text {
    font-size: 13px;
    color: var(--text-faint);
  }

  .dashboard-card--add:hover .dashboard-card__add-text {
    color: var(--interactive-accent);
  }

  /* Modal */
  .dash-popup-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .dash-popup {
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    max-width: 420px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
  }

  .dash-popup__title {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
  }

  .dash-popup__label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .dash-popup__input {
    padding: 8px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
  }

  .dash-popup__input:focus {
    border-color: var(--interactive-accent);
  }

  .dash-popup__input-row {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }

  .dash-popup__input-row .dash-popup__input {
    flex: 1;
    min-width: 0;
  }

  .dash-btn--browse {
    padding: 8px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-secondary);
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .dash-btn--browse:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .dash-popup__actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .dash-btn--cancel {
    padding: 6px 14px;
    border-radius: 8px;
  }

  .dash-btn--save {
    padding: 6px 14px;
    border-radius: 8px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .dash-btn--save:hover {
    opacity: 0.9;
  }

  @media (max-width: 480px) {
    .dash-popup {
      min-width: 0;
      width: calc(100vw - 32px);
      padding: 18px;
    }

    .dash-popup__input {
      padding: 10px 12px;
      font-size: 16px;
    }

    .dash-popup__input-row {
      flex-direction: column;
    }

    .dash-btn--browse {
      align-self: flex-end;
    }

    .dashboard-card__links {
      gap: 6px;
    }

    .dashboard-card__item {
      padding: 10px 12px;
      font-size: 13px;
    }

    .dashboard-card--add {
      min-height: 120px;
    }
  }

  /* Archive */
  .dash-archive { margin-bottom: 12px; }
  .dash-archive__toggle {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px; border: none; border-radius: 8px;
    background: var(--background-secondary); color: var(--text-muted);
    font-size: 12px; font-weight: 500; cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .dash-archive__toggle:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
  .dash-archive__icon { font-size: 13px; }
  .dash-archive__list {
    margin-top: 6px; background: var(--background-secondary);
    border: 1px solid rgba(255,255,255,0.04); border-radius: 10px;
    padding: 6px 10px; display: flex; flex-direction: column; gap: 1px;
    animation: dd-open 0.15s ease;
  }
  .dash-archive__item {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 6px; border-radius: 6px; font-size: 12.5px;
  }
  .dash-archive__item:hover { background: rgba(255,255,255,0.03); }
  .dash-archive__done { color: var(--mcp-success, rgba(80, 200, 160, 0.85)); font-weight: 700; flex-shrink: 0; }
</style>
