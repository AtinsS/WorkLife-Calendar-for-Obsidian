<script lang="ts">
  import moment from "moment";
  import { getHeatmapData } from "../habit-tracker/stores";
  import type { HeatmapCell } from "../habit-tracker/stores";

  export let habitId: string | undefined = undefined;

  let cells: HeatmapCell[] = [];
  let months: string[] = [];
  let dayLabels = ["Mon", "", "Wed", "", "Fri", "", ""];

  $: {
    cells = getHeatmapData(habitId);
    // Group cells by month for labels
    const seen = new Set<string>();
    months = [];
    for (const cell of cells) {
      const m = moment(cell.date).format("MMM");
      const key = moment(cell.date).format("YYYY-MM");
      if (!seen.has(key)) {
        seen.add(key);
        months.push(m);
      }
    }
  }

  const levelColors = [
    "var(--background-modifier-border)",
    "#9be9a8",
    "#40c463",
    "#30a14e",
    "#216e39",
  ];

  function getColor(level: number): string {
    return levelColors[level] || levelColors[0];
  }

  function getWeekIndex(dateStr: string): number {
    const first = moment(cells[0]?.date);
    const d = moment(dateStr);
    return d.diff(first, "weeks");
  }

  function getDayIndex(dateStr: string): number {
    // moment.isoWeekday: 1=Mon, 7=Sun
    return moment(dateStr).isoWeekday() - 1;
  }

  // Total completions in range
  $: totalCompletions = cells.reduce((sum, c) => sum + c.count, 0);
</script>

<div class="heatmap-container">
  <div class="heatmap-header">
    <span class="heatmap-total">{totalCompletions} completions in the last year</span>
  </div>
  <div class="heatmap-grid-wrapper">
    <div class="heatmap-day-labels">
      {#each dayLabels as label}
        <div class="heatmap-day-label">{label}</div>
      {/each}
    </div>
    <div class="heatmap-grid">
      {#each cells as cell, i}
        <div
          class="heatmap-cell"
          style="background-color: {getColor(cell.level)}; grid-row: {getDayIndex(cell.date) + 1}; grid-column: {getWeekIndex(cell.date) + 1}; animation-delay: {Math.min(i * 3, 420)}ms;"
          title="{cell.date}: {cell.count} completion{cell.count !== 1 ? 's' : ''}"
        ></div>
      {/each}
    </div>
  </div>
  <div class="heatmap-legend">
    <span class="heatmap-legend-label">Less</span>
    {#each levelColors as color}
      <div class="heatmap-cell heatmap-legend-cell" style="background-color: {color};"></div>
    {/each}
    <span class="heatmap-legend-label">More</span>
  </div>
</div>

<style>
  .heatmap-container {
    width: 100%;
    overflow-x: auto;
  }

  .heatmap-header {
    margin-bottom: 8px;
  }

  .heatmap-total {
    font-size: 13px;
    color: var(--text-muted);
  }

  .heatmap-grid-wrapper {
    display: flex;
    gap: 4px;
  }

  .heatmap-day-labels {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 10px;
    color: var(--text-muted);
    padding-top: 2px;
  }

  .heatmap-day-label {
    height: 13px;
    line-height: 13px;
    text-align: right;
    width: 30px;
    flex-shrink: 0;
  }

  .heatmap-grid {
    display: grid;
    grid-template-rows: repeat(7, 13px);
    grid-auto-flow: column;
    grid-auto-columns: 13px;
    gap: 2px;
    flex: 1;
  }

  .heatmap-cell {
    width: 13px;
    height: 13px;
    border-radius: 2px;
    cursor: default;
    animation: heat-cell-in 0.35s ease both;
  }

  .heatmap-cell:hover {
    transform: scale(1.35);
    border-radius: 3px;
    box-shadow: 0 0 0 1px var(--text-muted);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }

  @keyframes heat-cell-in {
    from {
      opacity: 0;
      transform: scale(0.55);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .heatmap-legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    justify-content: flex-end;
  }

  .heatmap-legend-label {
    font-size: 10px;
    color: var(--text-muted);
  }

  .heatmap-legend-cell {
    width: 11px;
    height: 11px;
    cursor: default;
    animation: none;
  }

  .heatmap-legend-cell:hover {
    transform: none;
    box-shadow: none;
  }

  @media (max-width: 768px) {
    .heatmap-day-labels {
      display: none;
    }
  }
</style>
