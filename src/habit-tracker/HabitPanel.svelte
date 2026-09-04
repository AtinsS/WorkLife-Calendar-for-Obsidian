<script lang="ts">
  import moment from "moment";
  import type { App } from "obsidian";
  import type { IHabit } from "./types";
  import {
    habits,
    habitLogs,
    addHabit,
    updateHabit,
    removeHabit,
    toggleHabitCompletion,
    getHabitStats,
  } from "./stores";
  import { selectedDate } from "../task-tracker/stores";
  import HabitItem from "./HabitItem.svelte";
  import { HabitModal } from "./HabitModal";
  import { t } from "../i18n";
  import { app } from "../stores/appStore";
  import { get } from "svelte/store";
  import { VIEW_TYPE_HABIT_ANALYTICS } from "../constants";

  export let appInstance: App;
  export let showAnalytics: boolean = false;

  $: currentDate = $selectedDate;
  $: dateStr = extractDateStr(currentDate);
  $: activeHabits = $habits.filter((h) => {
    if (h.archived) return false;
    const m = moment(dateStr, "YYYY-MM-DD");
    if (h.frequency === "weekly" && h.customDays && h.customDays.length > 0) {
      const dayOfWeek = m.day(); // 0=Sun
      return h.customDays.includes(dayOfWeek);
    }
    if (h.frequency === "monthly") {
      const dayOfMonth = m.date();
      return dayOfMonth === (h.monthlyDay || 1);
    }
    return true;
  });
  $: totalStreak = (() => {
    const logsByHabit = new Map<string, typeof $habitLogs>();
    for (const log of $habitLogs) {
      if (!log.completed) continue;
      const list = logsByHabit.get(log.habitId);
      if (list) list.push(log);
      else logsByHabit.set(log.habitId, [log]);
    }
    let total = 0;
    for (const h of activeHabits) {
      const logs = logsByHabit.get(h.id);
      if (!logs || logs.length === 0) continue;
      logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      let streak = 0;
      let streakDate = moment().startOf("day");
      for (const log of logs) {
        const logDate = moment(log.date, "YYYY-MM-DD").startOf("day");
        if (streakDate.diff(logDate, "days") <= 1) {
          streak++;
          streakDate = logDate.clone().subtract(1, "days");
        } else break;
      }
      total += streak;
    }
    return total;
  })();

  function extractDateStr(dateUID: string): string {
    if (!dateUID) {
      return moment().format("YYYY-MM-DD");
    }
    const match = dateUID.match(/^(?:day|week)-(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : moment().format("YYYY-MM-DD");
  }

  function openCreateHabit() {
    const modal = new HabitModal(
      appInstance,
      (habitData) => {
        addHabit({
          ...habitData,
          sortOrder: activeHabits.length,
        } as Omit<IHabit, "id" | "createdAt">);
      }
    );
    modal.open();
  }

  function handleToggle(event: CustomEvent<{ habit: IHabit }>) {
    const habit = event.detail.habit;
    toggleHabitCompletion(habit.id, dateStr, habit.targetCount || 1);
  }

  function handleEdit(event: CustomEvent<{ habit: IHabit }>) {
    const modal = new HabitModal(
      appInstance,
      (changes) => {
        updateHabit(event.detail.habit.id, changes);
      },
      event.detail.habit
    );
    modal.open();
  }

  function handleDelete(event: CustomEvent<{ habit: IHabit }>) {
    removeHabit(event.detail.habit.id);
  }

  // Mini-analytics
  $: habitStats = showAnalytics
    ? activeHabits.map((h) => ({ habit: h, stats: getHabitStats(h.id) }))
    : [];

  function openAnalytics(): void {
    const appRef = get(app) as App;
    if (!appRef) return;
    const existing = appRef.workspace.getLeavesOfType(VIEW_TYPE_HABIT_ANALYTICS);
    if (existing.length) {
      appRef.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = appRef.workspace.getLeaf("tab");
    if (leaf) {
      leaf.setViewState({ type: VIEW_TYPE_HABIT_ANALYTICS, active: true });
      appRef.workspace.revealLeaf(leaf);
    }
  }

  $: streakLabel = $t("habits.panel.streak");
  $: rateLabel = $t("habits.panel.rate");
</script>

<div class="habit-tracker-panel">
  <div class="habit-tracker-header">
    <div class="habit-tracker-header-left">
      <span class="habit-tracker-title">{$t("habits.panel.title")}</span>
      {#if totalStreak > 0}
        <span class="habit-tracker-streak">
          &#128293; {totalStreak}
        </span>
      {/if}
    </div>
    <div class="habit-tracker-header-right">
      <button
        class="habit-tracker-btn add-btn"
        on:click|stopPropagation={openCreateHabit}
        title={$t("habits.panel.add")}
      >
        +
      </button>
    </div>
  </div>

  <div class="habit-tracker-list">
    {#if activeHabits.length === 0}
      <div class="habit-tracker-empty">
        {$t("habits.panel.empty")}
      </div>
    {:else}
      {#each activeHabits as habit (habit.id)}
        <HabitItem
          {habit}
          date={dateStr}
          on:toggle={handleToggle}
          on:edit={handleEdit}
          on:delete={handleDelete}
        />
      {/each}
    {/if}
  </div>

  {#if showAnalytics && habitStats.length > 0}
    <div class="habit-mini-analytics">
      <div class="habit-mini-analytics-header">
        <span class="habit-mini-analytics-title">{$t("habits.panel.details")}</span>
        <button class="habit-tracker-btn analytics-btn" on:click|stopPropagation={openAnalytics}>
          {$t("habits.panel.detailsBtn")}
        </button>
      </div>
      <div class="habit-mini-stats">
        {#each habitStats as { habit, stats } (habit.id)}
          <div class="habit-mini-stat" style="--hc:{habit.color}">
            <span class="habit-mini-stat-icon">{habit.icon || "📌"}</span>
            <span class="habit-mini-stat-name">{habit.title}</span>
            <span class="habit-mini-stat-val" title={streakLabel}>
              🔥 {stats.currentStreak}
            </span>
            <span class="habit-mini-stat-val" title={rateLabel}>
              {stats.completionRate}%
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .habit-tracker-header {
    min-height: 44px;
  }

  .habit-tracker-btn {
    min-height: 44px;
  }

  .add-btn {
    min-width: auto;
  }

  .habit-mini-analytics {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .habit-mini-analytics-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .habit-mini-analytics-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .analytics-btn {
    font-size: 11px;
    padding: 4px 10px;
    min-height: auto;
  }

  .habit-mini-stats {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .habit-mini-stat {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--background-secondary);
    font-size: 12px;
  }

  .habit-mini-stat-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .habit-mini-stat-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-normal);
  }

  .habit-mini-stat-val {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    min-width: 36px;
    text-align: right;
  }
</style>
