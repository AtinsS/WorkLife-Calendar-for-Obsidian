<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    habitLogs,
    getHabitDailySeries,
    summarizeHabitSeries,
    habits,
  } from "../habit-tracker/stores";
  import { t } from "../i18n";
  import { animateProgress } from "../utils/visualMotion";

  export let habitId: string | undefined = undefined;
  export let showSelector = true;

  type Period = 14 | 30 | 90;
  let period: Period = 30;
  let hovered = -1;
  let reveal = 1;
  let cancelReveal: (() => void) | null = null;
  let lastKey = "";

  $: points = getHabitDailySeries(period, habitId);
  $: summary = summarizeHabitSeries(points);
  $: seriesKey = `${habitId || "all"}:${period}:${$habitLogs.length}:${points.map((p) => p.count).join(",")}`;
  $: playReveal(seriesKey);
  $: habitLabel = habitId
    ? ($habits.find((h) => h.id === habitId)?.title ?? $t("habitAnalytics.historyAll"))
    : $t("habitAnalytics.historyAll");

  function playReveal(key: string) {
    if (key === lastKey) return;
    lastKey = key;
    cancelReveal?.();
    cancelReveal = animateProgress(520, (p) => {
      reveal = p;
    });
  }

  onDestroy(() => cancelReveal?.());

  function onHabitChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    habitId = value === "all" ? undefined : value;
  }

  function setPeriod(p: number) {
    period = p as Period;
  }

  function barHeight(count: number): number {
    if (summary.maxCount <= 0) return 2;
    return Math.max(count > 0 ? 4 : 2, (count / summary.maxCount) * 100 * reveal);
  }

  function fmtDate(date: string): string {
    const d = new Date(date + "T12:00:00");
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function isWeekend(date: string): boolean {
    const d = new Date(date + "T12:00:00").getDay();
    return d === 0 || d === 6;
  }
</script>

<div class="habit-history">
  <div class="hh-header">
    <div class="hh-title-row">
      <h4>{$t("habitAnalytics.historyTitle")}</h4>
      {#if showSelector}
        <select class="hh-habit-select" value={habitId || "all"} on:change={onHabitChange}>
          <option value="all">{$t("habitAnalytics.historyAll")}</option>
          {#each $habits.filter((h) => !h.archived) as h (h.id)}
            <option value={h.id}>{h.icon} {h.title}</option>
          {/each}
        </select>
      {:else}
        <span class="hh-habit-label">{habitLabel}</span>
      {/if}
    </div>
    <div class="hh-periods">
      {#each [14, 30, 90] as p}
        <button
          class="hh-period-btn"
          class:active={period === p}
          on:click={() => setPeriod(p)}
        >
          {p}{$t("habitAnalytics.historyDaysUnit")}
        </button>
      {/each}
    </div>
  </div>

  <div class="hh-stats">
    <div class="hh-stat">
      <span class="hh-stat-value">{summary.total}</span>
      <span class="hh-stat-label">{$t("habitAnalytics.historyTotal")}</span>
    </div>
    <div class="hh-stat">
      <span class="hh-stat-value">{summary.activeDays}</span>
      <span class="hh-stat-label">{$t("habitAnalytics.historyActiveDays")}</span>
    </div>
    <div class="hh-stat">
      <span class="hh-stat-value">{summary.avgPerDay.toFixed(1)}</span>
      <span class="hh-stat-label">{$t("habitAnalytics.historyAvg")}</span>
    </div>
    <div class="hh-stat">
      <span class="hh-stat-value">{summary.maxCount}</span>
      <span class="hh-stat-label">{$t("habitAnalytics.historyBestDay")}</span>
    </div>
  </div>

  {#if points.length === 0}
    <div class="hh-empty">{$t("habitAnalytics.historyEmpty")}</div>
  {:else}
    <div class="hh-chart" role="img" aria-label={$t("habitAnalytics.historyTitle")}>
      {#each points as point, i (point.date)}
        <button
          type="button"
          class="hh-col"
          class:hovered={hovered === i}
          class:weekend={isWeekend(point.date)}
          class:has-value={point.count > 0}
          style="animation-delay: {Math.min(i * 12, 360)}ms"
          on:mouseenter={() => (hovered = i)}
          on:mouseleave={() => (hovered = -1)}
          on:focus={() => (hovered = i)}
          on:blur={() => (hovered = -1)}
          title="{fmtDate(point.date)}: {point.count}"
        >
          <span class="hh-bar" style="height: {barHeight(point.count)}%"></span>
          {#if hovered === i}
            <span class="hh-tip">
              <span class="hh-tip-date">{fmtDate(point.date)}</span>
              <span class="hh-tip-count">{point.count}</span>
            </span>
          {/if}
        </button>
      {/each}
    </div>
    <div class="hh-axis">
      <span>{fmtDate(points[0].date)}</span>
      {#if points.length > 7}
        <span>{fmtDate(points[Math.floor(points.length / 2)].date)}</span>
      {/if}
      <span>{fmtDate(points[points.length - 1].date)}</span>
    </div>
  {/if}
</div>

<style>
  .habit-history {
    margin: 16px 0 8px;
    padding: 14px;
    background: var(--mcp-glass-highlight);
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius-sm);
  }

  .hh-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  .hh-title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  h4 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-normal);
    opacity: 0.85;
  }

  .hh-habit-label {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 160px;
  }

  .hh-habit-select {
    border-radius: var(--mcp-radius-sm);
    border: 1px solid var(--mcp-glass-border);
    background: var(--mcp-glass-bg);
    color: var(--text-normal);
    font-size: 11px;
    padding: 2px 6px;
    max-width: 160px;
    transition: border-color 0.15s ease;
  }

  .hh-habit-select:focus {
    border-color: var(--mcp-accent);
    outline: none;
  }

  .hh-periods {
    display: flex;
    gap: 4px;
  }

  .hh-period-btn {
    padding: 4px 10px;
    border-radius: 10px;
    border: 1px solid var(--mcp-glass-border);
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .hh-period-btn:hover {
    border-color: var(--mcp-accent);
    color: var(--text-normal);
  }

  .hh-period-btn.active {
    background: var(--mcp-accent-dim);
    border-color: var(--mcp-accent);
    color: var(--text-accent);
  }

  .hh-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }

  .hh-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 4px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
  }

  .hh-stat-value {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-accent);
    letter-spacing: -0.02em;
  }

  .hh-stat-label {
    font-size: 9px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-top: 2px;
    text-align: center;
  }

  .hh-chart {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 110px;
    padding-top: 18px;
  }

  .hh-col {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    border: none;
    background: transparent;
    padding: 0;
    cursor: default;
    position: relative;
    animation: hh-col-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    border-radius: 3px 3px 0 0;
  }

  .hh-col.weekend {
    background: rgba(255, 255, 255, 0.025);
  }

  .hh-col.hovered {
    background: rgba(255, 255, 255, 0.06);
  }

  .hh-bar {
    width: 72%;
    max-width: 18px;
    border-radius: 3px 3px 1px 1px;
    background: linear-gradient(
      180deg,
      var(--mcp-accent),
      color-mix(in srgb, var(--mcp-accent) 55%, transparent)
    );
    min-height: 2px;
    transition: height 0.35s cubic-bezier(0.22, 1, 0.36, 1), filter 0.15s ease;
  }

  .hh-col:not(.has-value) .hh-bar {
    background: var(--background-modifier-border);
    opacity: 0.55;
  }

  .hh-col.hovered .hh-bar {
    filter: brightness(1.15);
  }

  .hh-tip {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--background-primary);
    border: 1px solid var(--mcp-glass-border);
    box-shadow: var(--mcp-shadow);
    pointer-events: none;
    white-space: nowrap;
    z-index: 2;
  }

  .hh-tip-date {
    font-size: 9px;
    color: var(--text-muted);
  }

  .hh-tip-count {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-accent);
  }

  .hh-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 9px;
    color: var(--text-faint);
  }

  .hh-empty {
    text-align: center;
    padding: 20px;
    color: var(--text-muted);
    font-size: 12px;
  }

  @keyframes hh-col-in {
    from {
      opacity: 0;
      transform: scaleY(0.4);
      transform-origin: bottom;
    }
    to {
      opacity: 1;
      transform: scaleY(1);
      transform-origin: bottom;
    }
  }

  @media (max-width: 600px) {
    .hh-stats {
      grid-template-columns: repeat(2, 1fr);
    }

    .hh-habit-label {
      max-width: 100px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hh-col {
      animation: none !important;
    }

    .hh-bar {
      transition: none !important;
    }
  }
</style>
