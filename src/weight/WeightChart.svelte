<script lang="ts">
  import { t } from "../i18n";
  import { weightData } from "./stores";
  import { buildWeightSeries } from "./stats";
  import BarChart from "../components/BarChart.svelte";

  type Period = 30 | 90 | 180 | 365;
  let period: Period = 90;

  $: entries = $weightData.entries;
  $: unit = $t("weight.unit");
  $: chartEmpty = $t("weight.chartEmpty");
  $: series = buildWeightSeries(entries, 7).filter((p) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - period);
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    return p.date >= cutoffKey;
  });
  $: chartPoints = series.map((p) => ({ date: p.date, value: p.weight }));
  $: formatValue = (v: number): string => {
    if (!isFinite(v)) return "—";
    return `${v.toFixed(1).replace(/\.0$/, "")} ${unit}`;
  };

  function setPeriod(p: number): void {
    period = p as Period;
  }
</script>

<!-- Same shell as the time chart in HabitAnalytics (.time-logs-chart + BarChart) -->
<div class="time-logs-chart">
  <BarChart
    points={chartPoints}
    mode="area"
    {formatValue}
    maxBars={chartPoints.length || 1}
    emptyText={chartEmpty}
    zeroBased={false}
    summaryMode="last"
  />
</div>

<div class="wc-periods">
  {#each [30, 90, 180, 365] as p}
    <button class="wc-period-btn" class:active={period === p} on:click={() => setPeriod(p)}>
      {#if p === 365}{$t("weight.periodYear")}{:else}{p}{$t("weight.periodDays")}{/if}
    </button>
  {/each}
</div>

<style>
  /* Identical container styling to HabitAnalytics .time-logs-chart */
  .time-logs-chart {
    margin-top: 0;
    padding: 12px;
    background: var(--mcp-glass-highlight);
    border-radius: var(--mcp-radius-sm);
  }

  .wc-periods {
    display: flex;
    gap: 4px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  .wc-period-btn {
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: var(--mcp-radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }

  .wc-period-btn.active {
    background: var(--mcp-glass-highlight);
    border-color: var(--mcp-glass-border);
    color: var(--text-accent);
  }
</style>
