<script lang="ts">
  import type CalendarPlugin from "../main";
  import TaskPanel from "../task-tracker/TaskPanel.svelte";
  import HabitPanel from "../habit-tracker/HabitPanel.svelte";
  import { settings } from "../ui/stores";

  export let plugin: CalendarPlugin;
  $: habitMode = $settings.habitTrackerMode || ($settings.showHabitTracker === false ? "hidden" : "panel");
  $: showHabits = habitMode === "panel";
</script>

<div class="mobile-tasks">
  <TaskPanel appInstance={plugin.app} />
  {#if showHabits}
    <HabitPanel appInstance={plugin.app} />
  {/if}
</div>

<style>
  .mobile-tasks {
    height: 100%;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    background: var(--background-primary, #1a1a2e);
  }

  .mobile-tasks :global(.task-tracker-panel) {
    padding: 12px 14px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .mobile-tasks :global(.task-tracker-list) {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .mobile-tasks :global(.task-tracker-filter-bar) {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    flex-wrap: nowrap;
    padding: 4px 0;
    gap: 4px;
  }

  .mobile-tasks :global(.task-tracker-filter-bar::-webkit-scrollbar) {
    display: none;
  }

  .mobile-tasks :global(.task-tracker-filter-btn) {
    flex-shrink: 0;
  }

  /* Habit panel mobile styles */
  .mobile-tasks :global(.habit-tracker-panel) {
    padding: 12px 14px;
    border-top: 1px solid var(--background-modifier-border, rgba(255,255,255,0.06));
  }

  .mobile-tasks :global(.habit-tracker-panel .habit-item) {
    min-height: 44px;
    padding: 10px 12px;
  }

  .mobile-tasks :global(.habit-tracker-panel .habit-item__toggle) {
    min-width: 44px;
    min-height: 44px;
  }

  .mobile-tasks :global(.habit-tracker-panel .habit-item__edit-btn),
  .mobile-tasks :global(.habit-tracker-panel .habit-item__delete-btn) {
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
