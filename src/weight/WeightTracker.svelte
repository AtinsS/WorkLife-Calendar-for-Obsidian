<script lang="ts">
  import { t } from "../i18n";
  import {
    weightData,
    setWeightEntry,
    removeWeightEntry,
    setWeightGoal,
  } from "./stores";
  import {
    computeGoalProgress,
    currentMovingAverage,
    latestWeight,
  } from "./stats";
  import { toDateKey } from "./types";
  import { countUp } from "../utils/visualMotion";
  import WeightChart from "./WeightChart.svelte";

  let dateInput = toDateKey(new Date());
  /** type=number binds a number after first input — keep union for safety */
  let weightInput: string | number = "";
  let noteInput = "";
  let goalInput: string | number = "";
  let startInput: string | number = "";
  let saveError = "";
  let listOpen = true;

  $: entries = $weightData.entries;
  $: goal = $weightData.goal;
  $: latest = latestWeight(entries);
  $: ma7 = currentMovingAverage(entries, 7);
  $: ma30 = currentMovingAverage(entries, 30);
  $: progress = computeGoalProgress(entries, goal);
  /** Must be reactive — a plain function in {#each} will not re-run on store updates */
  $: recentList = [...entries]
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    })
    .slice(0, 20);

  // Keep goal inputs in sync when store loads
  $: if (goal.targetWeight != null && goalInput === "") {
    goalInput = String(goal.targetWeight);
  }
  $: if (goal.startWeight != null && startInput === "") {
    startInput = String(goal.startWeight);
  }

  function parseWeight(raw: string | number | null | undefined): number | null {
    if (raw === "" || raw == null) return null;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).trim().replace(",", "."));
    return isFinite(n) && n > 0 ? n : null;
  }

  function onSave(): void {
    const w = parseWeight(weightInput);
    if (!dateInput || w == null) {
      saveError = $t("weight.invalidWeight");
      return;
    }
    saveError = "";
    setWeightEntry(dateInput, w, noteInput || undefined);
    weightInput = "";
    noteInput = "";
  }

  function onDelete(id: string): void {
    removeWeightEntry(id);
  }

  function onGoalBlur(): void {
    const target = parseWeight(goalInput);
    const start = parseWeight(startInput);
    setWeightGoal({
      targetWeight: target,
      startWeight: start,
    });
  }

  function fmt(n: number | null, digits = 1): string {
    if (n == null || !isFinite(n)) return "—";
    return n.toFixed(digits).replace(/\.0$/, "");
  }

  function fmtDate(date: string): string {
    const d = new Date(date + "T12:00:00");
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
</script>

<div class="weight-tracker">
  <div class="wt-header">
    <h3>{$t("weight.title")}</h3>
    <div class="wt-goal-fields">
      <label class="wt-goal-field">
        <span>{$t("weight.startLabel")}</span>
        <input
          type="number"
          step="0.1"
          min="1"
          bind:value={startInput}
          on:blur={onGoalBlur}
          placeholder="—"
        />
      </label>
      <label class="wt-goal-field">
        <span>{$t("weight.targetLabel")}</span>
        <input
          type="number"
          step="0.1"
          min="1"
          bind:value={goalInput}
          on:blur={onGoalBlur}
          placeholder="—"
        />
      </label>
    </div>
  </div>

  <!-- Daily input -->
  <div class="wt-input-row">
    <input type="date" bind:value={dateInput} class="wt-date" />
    <div class="wt-weight-wrap">
      <input
        type="number"
        step="0.1"
        min="1"
        bind:value={weightInput}
        placeholder={weightInput === "" && latest ? String(latest.weight) : "0.0"}
        class="wt-weight"
        on:keydown={(e) => e.key === "Enter" && onSave()}
      />
      <span class="wt-unit">{$t("weight.unit")}</span>
    </div>
    <input
      type="text"
      bind:value={noteInput}
      placeholder={$t("weight.notePlaceholder")}
      class="wt-note"
      on:keydown={(e) => e.key === "Enter" && onSave()}
    />
    <button class="wt-save" on:click={onSave}>{$t("weight.save")}</button>
  </div>
  {#if saveError}
    <div class="wt-error">{saveError}</div>
  {/if}

  <!-- Stats -->
  <div class="wt-stats">
    <div class="wt-stat">
      <span class="wt-stat-value">
        {#if latest}
          <span use:countUp={{ value: latest.weight, duration: 650, format: (n) => fmt(n) }}></span>
        {:else}
          —
        {/if}
      </span>
      <span class="wt-stat-label">{$t("weight.current")}</span>
    </div>
    <div class="wt-stat">
      <span class="wt-stat-value">{fmt(ma7)}</span>
      <span class="wt-stat-label">{$t("weight.ma7")}</span>
    </div>
    <div class="wt-stat">
      <span class="wt-stat-value">{fmt(ma30)}</span>
      <span class="wt-stat-label">{$t("weight.ma30")}</span>
    </div>
    <div class="wt-stat">
      <span class="wt-stat-value">{fmt(progress.remainingKg)}</span>
      <span class="wt-stat-label">{$t("weight.remaining")}</span>
    </div>
  </div>

  <!-- Goal progress -->
  {#if progress.hasGoal && progress.targetWeight != null}
    <div class="wt-goal">
      <div class="wt-goal-labels">
        <span>{$t("weight.startLabel")}: {fmt(progress.startWeight)}</span>
        <span class:done={progress.reached}>
          {progress.reached ? $t("weight.goalReached") : $t("weight.goalProgress", { percent: Math.round(progress.progress * 100) })}
        </span>
        <span>{$t("weight.targetLabel")}: {fmt(progress.targetWeight)}</span>
      </div>
      <div class="wt-goal-bar">
        <div
          class="wt-goal-fill"
          class:done={progress.reached}
          style="width: {Math.min(progress.progress * 100, 100)}%"
        ></div>
      </div>
    </div>
  {/if}

  <!-- Chart — same BarChart UI as time & projects -->
  <WeightChart />

  <!-- Recent list (collapsible) -->
  {#if entries.length > 0}
    <button
      class="wt-list-toggle"
      class:open={listOpen}
      on:click={() => (listOpen = !listOpen)}
      aria-expanded={listOpen}
    >
      <span class="wt-list-chevron">{listOpen ? "▾" : "▸"}</span>
      <span>{$t("weight.history")}</span>
      <span class="wt-list-count">{entries.length}</span>
    </button>
    {#if listOpen}
      <div class="wt-recent">
        {#each recentList as e (e.id)}
          <div class="wt-row">
            <span class="wt-row-date">{fmtDate(e.date)}</span>
            <span class="wt-row-weight">{fmt(e.weight)} {$t("weight.unit")}</span>
            {#if e.note}<span class="wt-row-note">{e.note}</span>{/if}
            <button class="wt-row-delete" title={$t("weight.delete")} on:click={() => onDelete(e.id)}>×</button>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .weight-tracker {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .wt-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .wt-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.8;
  }

  .wt-goal-fields {
    display: flex;
    gap: 10px;
  }

  .wt-goal-field {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .wt-goal-field input {
    width: 72px;
    padding: 5px 8px;
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius-sm);
    background: var(--mcp-glass-bg);
    color: var(--text-normal);
    font-size: 12px;
    font-family: inherit;
  }

  .wt-goal-field input:focus {
    outline: none;
    border-color: var(--mcp-accent);
    box-shadow: 0 0 0 3px var(--mcp-accent-dim);
  }

  .wt-input-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .wt-date,
  .wt-note,
  .wt-weight {
    padding: 8px 10px;
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius-sm);
    background: var(--mcp-glass-bg);
    color: var(--text-normal);
    font-size: 13px;
    font-family: inherit;
  }

  .wt-date {
    width: 140px;
  }

  .wt-weight-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .wt-weight {
    width: 90px;
    padding-right: 28px;
  }

  .wt-unit {
    position: absolute;
    right: 10px;
    font-size: 11px;
    color: var(--text-muted);
    pointer-events: none;
  }

  .wt-note {
    flex: 1;
    min-width: 120px;
  }

  .wt-date:focus,
  .wt-note:focus,
  .wt-weight:focus {
    outline: none;
    border-color: var(--mcp-accent);
    box-shadow: 0 0 0 3px var(--mcp-accent-dim);
  }

  .wt-save {
    padding: 8px 16px;
    border: 1px solid var(--mcp-accent);
    border-radius: var(--mcp-radius-sm);
    background: var(--mcp-accent);
    color: var(--text-on-accent, #fff);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .wt-save:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
  }

  .wt-error {
    font-size: 11px;
    color: var(--mcp-danger, rgba(220, 100, 100, 0.9));
    margin-top: -6px;
  }

  .wt-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .wt-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 8px;
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015));
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  }

  .wt-stat-value {
    font-size: 18px;
    font-weight: 750;
    color: var(--text-accent, var(--mcp-accent));
    letter-spacing: -0.02em;
    line-height: 1.1;
  }

  .wt-stat-label {
    font-size: 9px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 2px;
    font-weight: 600;
    text-align: center;
    line-height: 1.25;
  }

  .wt-goal {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .wt-goal-labels {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-muted);
    flex-wrap: wrap;
    gap: 6px;
  }

  .wt-goal-labels .done {
    color: var(--mcp-success, rgba(34, 197, 94, 0.9));
    font-weight: 650;
  }

  .wt-goal-bar {
    height: 8px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: 999px;
    overflow: hidden;
  }

  .wt-goal-fill {
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--mcp-accent),
      color-mix(in srgb, var(--mcp-accent) 70%, white)
    );
    border-radius: 999px;
    transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 0 0 10px color-mix(in srgb, var(--mcp-accent) 35%, transparent);
  }

  .wt-goal-fill.done {
    background: linear-gradient(
      90deg,
      var(--mcp-success, rgba(34, 197, 94, 0.9)),
      color-mix(in srgb, var(--mcp-success, rgba(34, 197, 94, 0.9)) 70%, white)
    );
    box-shadow: 0 0 10px rgba(34, 197, 94, 0.3);
  }

  .wt-recent {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 2px;
  }

  .wt-list-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
    font-family: inherit;
    width: 100%;
    text-align: left;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }

  .wt-list-toggle:hover {
    color: var(--text-normal);
    border-color: color-mix(in srgb, var(--mcp-accent, #7c5cfc) 35%, transparent);
    background: rgba(255, 255, 255, 0.05);
  }

  .wt-list-chevron {
    width: 14px;
    font-size: 12px;
    line-height: 1;
    transition: transform 0.18s ease;
  }

  .wt-list-toggle.open .wt-list-chevron {
    transform: rotate(0deg);
  }

  .wt-list-count {
    margin-left: auto;
    padding: 2px 9px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--mcp-accent, #7c5cfc) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--mcp-accent, #7c5cfc) 28%, transparent);
    color: var(--text-accent, var(--mcp-accent));
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0;
  }

  .wt-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.04);
    font-size: 12.5px;
    transition: background 0.15s, border-color 0.15s;
  }

  .wt-row:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .wt-row-date {
    width: 78px;
    color: var(--text-muted);
    font-weight: 550;
    flex-shrink: 0;
  }

  .wt-row-weight {
    font-weight: 700;
    color: var(--text-normal);
    min-width: 72px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.05);
    text-align: center;
    flex-shrink: 0;
  }

  .wt-row-note {
    flex: 1 1 auto;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Delete — always at the far right edge */
  .wt-row-delete {
    margin-left: auto;
    border: none;
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    flex-shrink: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s, transform 0.12s;
    align-self: center;
  }

  .wt-row-delete:hover {
    opacity: 1;
    color: var(--mcp-danger, rgba(220, 100, 100, 0.9));
    background: rgba(220, 100, 100, 0.12);
  }

  .wt-row-delete:active {
    transform: scale(0.92);
  }

  @media (max-width: 640px) {
    .wt-stats {
      grid-template-columns: repeat(2, 1fr);
    }

    .wt-input-row {
      flex-direction: column;
      align-items: stretch;
    }

    .wt-date,
    .wt-weight {
      width: 100%;
    }
  }
</style>
