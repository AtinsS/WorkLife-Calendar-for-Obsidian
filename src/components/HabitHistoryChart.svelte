<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    habitLogs,
    getHabitSeriesBetween,
    summarizeHabitSeries,
    habits,
    rebuildLogsCache,
  } from "../habit-tracker/stores";
  import { t } from "../i18n";
  import { animateProgress } from "../utils/visualMotion";

  export let habitId: string | undefined = undefined;
  export let showSelector = true;

  /** month offset from current month: 0 = this month */
  let monthOffset = 0;
  let hovered = "";
  let reveal = 1;
  let cancelReveal: (() => void) | null = null;
  let lastKey = "";

  $: baseDate = (() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth() + monthOffset, 1);
  })();
  $: year = baseDate.getFullYear();
  $: month = baseDate.getMonth();
  $: monthLabel = baseDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  $: range = monthRange(year, month);
  $: points = (() => {
    void $habitLogs;
    rebuildLogsCache();
    return getHabitSeriesBetween(range.from, range.to, habitId);
  })();
  $: summary = summarizeHabitSeries(points);
  $: seriesKey = `${habitId || "all"}:${year}-${month}:${$habitLogs.length}:${points.map((p) => p.count).join(",")}`;
  $: playReveal(seriesKey);
  $: habitLabel = habitId
    ? ($habits.find((h) => h.id === habitId)?.title ?? $t("habitAnalytics.historyAll"))
    : $t("habitAnalytics.historyAll");
  $: calendar = buildMonthGrid(year, month, points);
  $: weekdays = weekdayLabels();
  $: isCurrentMonth = monthOffset === 0;

  type CalDay = {
    date: string;
    dayNum: number;
    count: number;
    done: boolean;
    weekend: boolean;
    isToday: boolean;
    outside: boolean;
  };

  function playReveal(key: string) {
    if (key === lastKey) return;
    lastKey = key;
    cancelReveal?.();
    cancelReveal = animateProgress(380, (p) => {
      reveal = p;
    });
  }

  onDestroy(() => cancelReveal?.());

  function onHabitChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    habitId = value === "all" ? undefined : value;
  }

  function prevMonth() {
    monthOffset -= 1;
    hovered = "";
  }

  function nextMonth() {
    monthOffset += 1;
    hovered = "";
  }

  function goToday() {
    monthOffset = 0;
    hovered = "";
  }

  function monthRange(y: number, m: number): { from: string; to: string } {
    const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { from, to };
  }

  function parseDay(date: string): Date {
    return new Date(date + "T12:00:00");
  }

  function todayKey(): string {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }

  /** Mon-first weekday short labels */
  function weekdayLabels(): string[] {
    const labels: string[] = [];
    const base = new Date("2024-01-01T12:00:00"); // Monday
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      labels.push(d.toLocaleDateString(undefined, { weekday: "short" }));
    }
    return labels;
  }

  function buildMonthGrid(y: number, m: number, pts: { date: string; count: number }[]): (CalDay | null)[][] {
    const byDate = new Map(pts.map((p) => [p.date, p.count]));
    const today = todayKey();
    const first = new Date(y, m, 1);
    const startPad = (first.getDay() + 6) % 7; // Mon=0
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    const cells: (CalDay | null)[] = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const count = byDate.get(key) ?? 0;
      const date = new Date(y, m, d);
      cells.push({
        date: key,
        dayNum: d,
        count,
        done: count > 0,
        weekend: date.getDay() === 0 || date.getDay() === 6,
        isToday: key === today,
        outside: false,
      });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks: (CalDay | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeks.push(cells.slice(i, i + 7));
    }
    return weeks;
  }

  function fmtDate(date: string): string {
    return parseDay(date).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
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
  </div>

  <!-- Month nav — same idea as main Calendar -->
  <div class="hh-nav">
    <button type="button" class="hh-nav-btn" on:click={prevMonth} aria-label="‹">‹</button>
    <button type="button" class="hh-nav-title" on:click={goToday} title={$t("tasks.panel.today")}>
      {monthLabel}
    </button>
    <button type="button" class="hh-nav-btn" on:click={nextMonth} aria-label="›">›</button>
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

  <div class="hh-cal">
    <div class="hh-weekdays">
      {#each weekdays as wd}
        <span class="hh-weekday">{wd}</span>
      {/each}
    </div>

    <div class="hh-weeks" style="opacity: {0.3 + 0.7 * reveal}">
      {#each calendar as week, wi}
        <div class="hh-week">
          {#each week as day, di (day?.date ?? `pad-${wi}-${di}`)}
            {#if day}
              <button
                type="button"
                class="hh-day"
                class:done={day.done}
                class:weekend={day.weekend}
                class:today={day.isToday}
                class:hovered={hovered === day.date}
                class:multi={day.count > 1}
                on:mouseenter={() => (hovered = day.date)}
                on:mouseleave={() => (hovered = "")}
                on:focus={() => (hovered = day.date)}
                on:blur={() => (hovered = "")}
                title="{fmtDate(day.date)}: {day.count}"
              >
                <span class="hh-day-num">{day.dayNum}</span>
                {#if day.done}
                  <span class="hh-day-check" aria-hidden="true">
                    <svg viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </span>
                {/if}
                {#if day.count > 1}
                  <span class="hh-day-multi">×{day.count}</span>
                {/if}
                {#if hovered === day.date}
                  <span class="hh-tip">
                    <span class="hh-tip-date">{fmtDate(day.date)}</span>
                    <span class="hh-tip-count">{day.count}</span>
                  </span>
                {/if}
              </button>
            {:else}
              <span class="hh-day empty" aria-hidden="true"></span>
            {/if}
          {/each}
        </div>
      {/each}
    </div>

    <div class="hh-legend">
      <span class="hh-day legend-swatch done">
        <span class="hh-day-check"><svg viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </span>
      <span class="hh-legend-label">{$t("habitAnalytics.historyActiveDays")}</span>
      <span class="hh-day legend-swatch"></span>
      <span class="hh-legend-label">—</span>
      {#if !isCurrentMonth}
        <button type="button" class="hh-today-btn" on:click={goToday}>{$t("tasks.panel.today")}</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .habit-history {
    margin: 12px 0 6px;
    padding: 12px;
    background:
      linear-gradient(160deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015));
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 14px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hh-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .hh-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex-wrap: wrap;
  }

  h4 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--text-normal);
  }

  .hh-habit-label {
    font-size: 11px;
    color: var(--text-muted);
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .hh-habit-select {
    appearance: none;
    -webkit-appearance: none;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239aa3b5' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")
        no-repeat right 10px center,
      linear-gradient(160deg, rgba(30, 32, 48, 0.98), rgba(22, 24, 38, 0.98));
    color: var(--text-normal, #e8ecf0);
    font-size: 12px;
    padding: 6px 28px 6px 10px;
    max-width: 200px;
    min-height: 32px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }

  .hh-habit-select:hover {
    border-color: color-mix(in srgb, var(--mcp-accent, #7c5cfc) 35%, transparent);
  }

  .hh-habit-select:focus {
    border-color: color-mix(in srgb, var(--mcp-accent, #7c5cfc) 55%, transparent);
    outline: none;
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--mcp-accent, #7c5cfc) 18%, transparent),
      0 4px 14px rgba(0, 0, 0, 0.25);
  }

  /* Dark option list (Chrome / Electron) */
  .hh-habit-select option {
    background: #1e2030;
    color: #e8ecf0;
  }

  /* Month navigation — like main Calendar nav */
  .hh-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .hh-nav-btn {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-muted);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s, transform 0.12s, border-color 0.15s;
    font-family: inherit;
  }

  .hh-nav-btn:hover {
    color: var(--text-normal);
    background: rgba(255, 255, 255, 0.08);
    border-color: color-mix(in srgb, var(--mcp-accent, #7c5cfc) 35%, transparent);
  }

  .hh-nav-btn:active {
    transform: scale(0.94);
  }

  .hh-nav-title {
    min-width: 130px;
    padding: 4px 8px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-normal);
    font-size: 12px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    text-transform: capitalize;
    transition: background 0.15s, border-color 0.15s;
  }

  .hh-nav-title:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.07);
  }

  .hh-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .hh-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 4px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .hh-stat-value {
    font-size: 14px;
    font-weight: 750;
    color: var(--text-accent, var(--mcp-accent));
    line-height: 1.1;
  }

  .hh-stat-label {
    font-size: 8px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    text-align: center;
    line-height: 1.2;
  }

  /* ── Calendar grid (matches #calendar-container look) ── */
  .hh-cal {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hh-weekdays {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 3px;
  }

  .hh-weekday {
    text-align: center;
    font-size: 9px;
    font-weight: 700;
    color: var(--mcp-text-faint, var(--text-muted));
    text-transform: uppercase;
    letter-spacing: 0.6px;
    padding: 2px 0;
  }

  .hh-weeks {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .hh-week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 3px;
  }

  .hh-day {
    position: relative;
    min-height: 28px;
    height: 100%;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    background: var(--mcp-surface, rgba(255, 255, 255, 0.03));
    color: var(--mcp-text, var(--text-normal));
    cursor: pointer;
    padding: 2px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0;
    font-family: inherit;
    font-size: 11px;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.12s ease;
  }

  .hh-day.empty {
    visibility: hidden;
    pointer-events: none;
    border: none;
    background: transparent;
  }

  .hh-day.weekend {
    background: rgba(255, 255, 255, 0.025);
  }

  .hh-day:hover:not(.empty),
  .hh-day.hovered:not(.empty) {
    background: var(--mcp-surface-hover, rgba(255, 255, 255, 0.07));
    border-color: rgba(124, 92, 252, 0.2);
    box-shadow: 0 0 12px rgba(124, 92, 252, 0.08);
    transform: scale(1.03);
    z-index: 2;
  }

  .hh-day:focus-visible {
    outline: 2px solid var(--mcp-accent, #7c5cfc);
    outline-offset: 2px;
    z-index: 3;
  }

  /* Today — same gradient as main calendar */
  .hh-day.today {
    background: linear-gradient(135deg, #7c5cfc, #5b8def);
    color: #fff;
    font-weight: 700;
    border-color: transparent;
    box-shadow:
      0 0 20px rgba(124, 92, 252, 0.3),
      0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .hh-day.done {
    background: linear-gradient(135deg, rgba(124, 92, 252, 0.22), rgba(91, 141, 239, 0.14));
    color: var(--mcp-text, var(--text-normal));
    font-weight: 600;
    border-color: rgba(124, 92, 252, 0.32);
    box-shadow:
      0 0 16px rgba(124, 92, 252, 0.12),
      inset 0 0 12px rgba(124, 92, 252, 0.06);
  }

  .hh-day.done.today {
    background: linear-gradient(135deg, #7c5cfc, #5b8def);
    color: #fff;
    border-color: transparent;
  }

  .hh-day-num {
    font-size: 11px;
    font-weight: 650;
    line-height: 1.1;
  }

  .hh-day-check {
    width: 10px;
    height: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--mcp-accent, #7c5cfc);
    opacity: 0.95;
  }

  .hh-day.today .hh-day-check,
  .hh-day.done.today .hh-day-check {
    color: #fff;
  }

  .hh-day-check svg {
    width: 10px;
    height: 10px;
    display: block;
  }

  .hh-day-multi {
    position: absolute;
    top: 2px;
    right: 3px;
    font-size: 7px;
    font-weight: 700;
    color: var(--mcp-accent, #7c5cfc);
    line-height: 1;
    pointer-events: none;
  }

  .hh-day.today .hh-day-multi {
    color: rgba(255, 255, 255, 0.9);
  }

  .hh-tip {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--mcp-surface-2, rgba(30, 32, 48, 0.97));
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
    pointer-events: none;
    white-space: nowrap;
    animation: hh-tip-in 0.12s ease;
  }

  @keyframes hh-tip-in {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(3px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .hh-tip-date {
    font-size: 9px;
    color: var(--text-muted);
  }

  .hh-tip-count {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-accent, var(--mcp-accent));
  }

  .hh-legend {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 4px;
  }

  .hh-legend .hh-day.legend-swatch {
    width: 14px;
    height: 14px;
    min-height: 14px;
    padding: 0;
    pointer-events: none;
    flex-shrink: 0;
    border-radius: 5px;
  }

  .hh-legend .hh-day-check {
    width: 9px;
    height: 9px;
  }

  .hh-legend .hh-day-check svg {
    width: 9px;
    height: 9px;
  }

  .hh-legend-label {
    font-size: 10px;
    color: var(--text-faint);
  }

  .hh-today-btn {
    margin-left: auto;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .hh-today-btn:hover {
    background: var(--interactive-accent, var(--mcp-accent));
    color: var(--text-on-accent, #fff);
    border-color: transparent;
  }

  @media (max-width: 520px) {
    .hh-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .hh-day {
      min-height: 24px;
    }

    .hh-day-num {
      font-size: 10px;
    }

    .hh-nav-title {
      min-width: 110px;
      font-size: 11px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .hh-day,
    .hh-tip,
    .hh-nav-btn {
      transition: none !important;
      animation: none !important;
    }

    .hh-day:hover:not(.empty),
    .hh-day.hovered:not(.empty) {
      transform: none;
    }
  }
</style>
