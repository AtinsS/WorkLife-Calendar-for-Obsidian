<script lang="ts">
  import { get } from "svelte/store";
  import { habits } from "../habit-tracker/stores";
  import HabitCard from "./HabitCard.svelte";
  import HabitHistoryChart from "./HabitHistoryChart.svelte";
  import WeightTracker from "../weight/WeightTracker.svelte";
  import BarChart from "./BarChart.svelte";
  import DonutChart from "./DonutChart.svelte";
  import ProjectAnalytics from "./ProjectAnalytics.svelte";
  import {
    timeLogs,
    tasks,
    projects,
  } from "../task-tracker/stores";
  import { formatDuration } from "../task-tracker/TimerManager";
  import {
    getEarningsForMonth,
    getEarningsForYear,
    getMonthlyEarningsForYear,
    getExpectedEarningsForMonth,
  } from "../task-tracker/stores";
  import { app } from "../stores/appStore";
  import {
    financialAnalyticsData,
    getTotalManualIncome,
    getManualIncomeForMonth,
  } from "../finance/financialAnalyticsStorage";
  import { VIEW_TYPE_FINANCIAL_ANALYTICS } from "../constants";
  import { t, tArray, locale } from "../i18n";
  import { settings } from "../ui/stores";
  import { derived as derivedStore } from "svelte/store";
  import { countUp } from "../utils/visualMotion";

  const numberLocale = derivedStore(locale, ($locale) => $locale === "ru" ? "ru-RU" : "en-US");

  type AnalyticsTab = "weight" | "habits" | "time" | "earnings";
  let activeTab: AnalyticsTab = "habits";

  $: weightEnabled = $settings.weightControlEnabled !== false;
  $: if (!weightEnabled && activeTab === "weight") {
    activeTab = "habits";
  }

  // Period selector for "Время и проекты"
  function fmtLocal(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const now = new Date();
  let periodStart = fmtLocal(new Date(now.getFullYear(), now.getMonth(), 1));
  let periodEnd = fmtLocal(now);

  $: activeHabits = $habits.filter((h) => !h.archived);

  // Time logs stats — filtered by period
  $: filteredTimeLogs = $timeLogs.filter((log) => {
    if (!periodStart || !periodEnd) return true;
    return log.date >= periodStart && log.date <= periodEnd;
  });
  $: totalTimeMs = filteredTimeLogs.reduce((sum, log) => sum + log.duration, 0);
  // Combined: time logs + declared time from tasks without logs
  $: combinedTimeMs = (() => {
    const logTaskIds = new Set(filteredTimeLogs.map(l => l.taskId));
    const taskOnlyMs = tasksWithTime.reduce((sum, t) => {
      if (logTaskIds.has(t.id)) return sum;
      if (t.totalWorkTime && t.totalWorkTime > 0) return sum + t.totalWorkTime;
      if (t.estimatedTime && t.estimatedTime > 0) return sum + t.estimatedTime * 60000;
      return sum;
    }, 0);
    return totalTimeMs + taskOnlyMs;
  })();
  $: uniqueDays = new Set(filteredTimeLogs.map((log) => log.date)).size;
  $: avgPerDay = uniqueDays > 0 ? totalTimeMs / uniqueDays : 0;

  // Tasks with time data in period (for showing the section even without time logs)
  $: tasksWithTime = $tasks.filter((t) => {
    const match = t.dateUID.match(/^day-(\d{4}-\d{2}-\d{2})/);
    if (!match || match[1] < periodStart || match[1] > periodEnd) return false;
    return t.status === "done" || (t.totalWorkTime && t.totalWorkTime > 0) || (t.estimatedTime && t.estimatedTime > 0);
  });

  // Declared time from tasks without logs, grouped by date (for the chart)
  $: extraTimeByDate = (() => {
    const logTaskIds = new Set(filteredTimeLogs.map(l => l.taskId));
    const result = new Map<string, number>();
    tasksWithTime.forEach((t) => {
      if (logTaskIds.has(t.id)) return;
      let ms = 0;
      if (t.totalWorkTime && t.totalWorkTime > 0) ms = t.totalWorkTime;
      else if (t.estimatedTime && t.estimatedTime > 0) ms = t.estimatedTime * 60000;
      if (ms <= 0) return;
      const m = t.dateUID.match(/^day-(\d{4}-\d{2}-\d{2})/);
      if (m) result.set(m[1], (result.get(m[1]) || 0) + ms);
    });
    return result;
  })();

  // Donut chart data — time by project (time logs + declared time from completed tasks)
  $: donutSegments = (() => {
    const allProjectTasks = $tasks;
    const allProjects = $projects;
    const projectMap = new Map<string, { ms: number; color: string; name: string }>();
    const noKey = "__none__";

    // Time from logs
    const tasksWithLogs = new Set<string>();
    for (const log of filteredTimeLogs) {
      tasksWithLogs.add(log.taskId);
      const task = allProjectTasks.find((t) => t.id === log.taskId);
      const pKey = task?.projectId || noKey;
      if (!projectMap.has(pKey)) {
        const proj = task?.projectId ? allProjects.find((p) => p.id === task.projectId) : null;
        projectMap.set(pKey, {
          ms: 0,
          color: proj?.color || "#647177",
          name: proj?.name || $t("projectAnalytics.noProject"),
        });
      }
      projectMap.get(pKey).ms += log.duration;
    }

    // Declared time from tasks without logs (done tasks or tasks with time data)
    for (const task of tasksWithTime) {
      if (tasksWithLogs.has(task.id)) continue;
      let taskMs = 0;
      if (task.totalWorkTime && task.totalWorkTime > 0) taskMs = task.totalWorkTime;
      else if (task.estimatedTime && task.estimatedTime > 0) taskMs = task.estimatedTime * 60000;
      if (taskMs <= 0) continue;

      const pKey = task.projectId || noKey;
      if (!projectMap.has(pKey)) {
        const proj = task.projectId ? allProjects.find((p) => p.id === task.projectId) : null;
        projectMap.set(pKey, {
          ms: 0,
          color: proj?.color || "#647177",
          name: proj?.name || $t("projectAnalytics.noProject"),
        });
      }
      projectMap.get(pKey).ms += taskMs;
    }

    return Array.from(projectMap.values())
      .filter((s) => s.ms > 0)
      .sort((a, b) => b.ms - a.ms)
      .map((s) => ({ label: s.name, value: s.ms, color: s.color }));
  })();

  // Earnings stats
  $: {
    $tasks; // re-compute when tasks change
    $financialAnalyticsData; // re-compute when manual income changes
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const taskMonthly = getEarningsForMonth(currentYear, currentMonth);
    const taskYearly = getEarningsForYear(currentYear);
    const manualIncomeMonth = getManualIncomeForMonth(currentYear, currentMonth);
    const manualIncomeYear = getTotalManualIncome();
    monthlyEarnings = taskMonthly + manualIncomeMonth;
    yearlyEarnings = taskYearly + manualIncomeYear;
    expectedMonthlyEarnings = getExpectedEarningsForMonth(currentYear, currentMonth);
    monthlyChart = getMonthlyEarningsForYear(currentYear).map((m) => ({
      month: m.month,
      amount: m.amount + getManualIncomeForMonth(currentYear, m.month),
    }));
    maxMonthly = Math.max(...monthlyChart.map((m) => m.amount), 1);

    // Real deltas: previous month vs current
    const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const prevMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const prevMonthManualIncome = getManualIncomeForMonth(prevMonthYear, prevMonth);
    const prevMonthEarnings = getEarningsForMonth(prevMonthYear, prevMonth) + prevMonthManualIncome;
    monthlyDelta = monthlyEarnings - prevMonthEarnings;

    // Real deltas: previous year vs current
    const prevYearEarnings = getEarningsForYear(currentYear - 1) + manualIncomeYear;
    yearlyDelta = yearlyEarnings - prevYearEarnings;
  }
  let monthlyEarnings = 0;
  let expectedMonthlyEarnings = 0;
  let yearlyEarnings = 0;
  let monthlyChart: { month: number; amount: number }[] = [];
  let maxMonthly = 1;
  let monthlyDelta = 0;
  let yearlyDelta = 0;

  $: monthNames = $tArray("common.months.short");

  async function openFinancialAnalytics(): Promise<void> {
    const appInstance = get(app);
    if (!appInstance) return;

    const existing = appInstance.workspace.getLeavesOfType(
      VIEW_TYPE_FINANCIAL_ANALYTICS,
    );
    if (existing.length) {
      appInstance.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = appInstance.workspace.getLeaf("tab");
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_FINANCIAL_ANALYTICS,
        active: true,
      });
      appInstance.workspace.revealLeaf(leaf);
    }
  }
</script>

<div class="habit-analytics">
  <div class="habit-analytics-header">
    <h1>{$t("habitAnalytics.title")}</h1>
  </div>

  <!-- Tabs -->
  <div class="analytics-tabs" role="tablist">
    {#if weightEnabled}
      <button
        class="analytics-tab"
        class:active={activeTab === "weight"}
        role="tab"
        aria-selected={activeTab === "weight"}
        on:click={() => (activeTab = "weight")}
      >
        {$t("habitAnalytics.tabWeight")}
      </button>
    {/if}
    <button
      class="analytics-tab"
      class:active={activeTab === "habits"}
      role="tab"
      aria-selected={activeTab === "habits"}
      on:click={() => (activeTab = "habits")}
    >
      {$t("habitAnalytics.tabHabits")}
    </button>
    <button
      class="analytics-tab"
      class:active={activeTab === "time"}
      role="tab"
      aria-selected={activeTab === "time"}
      on:click={() => (activeTab = "time")}
    >
      {$t("habitAnalytics.tabTime")}
    </button>
    <button
      class="analytics-tab"
      class:active={activeTab === "earnings"}
      role="tab"
      aria-selected={activeTab === "earnings"}
      on:click={() => (activeTab = "earnings")}
    >
      {$t("habitAnalytics.tabEarnings")}
    </button>
  </div>

  <!-- Weight Control -->
  {#if activeTab === "weight" && weightEnabled}
    <div class="habit-analytics-section">
      <WeightTracker />
    </div>
  {/if}

  <!-- Habits Module -->
  {#if activeTab === "habits" && activeHabits.length > 0}
    <div class="habits-module">
      <div class="habits-module__header">
        <span class="habits-module__icon">🔥</span>
        <h2 class="habits-module__title">{$t("habitAnalytics.habits")}</h2>
        <span class="habits-module__count">{activeHabits.length}</span>
      </div>

      <!-- History: how many / when -->
      <HabitHistoryChart />

      <div class="habits-module__grid">
        {#each activeHabits as habit (habit.id)}
          <HabitCard {habit} />
        {/each}
      </div>
    </div>
  {:else if activeTab === "habits"}
    <div class="habit-analytics-section">
      <div class="time-logs-empty">{$t("habitAnalytics.noHabits")}</div>
    </div>
  {/if}

  <!-- Time & Projects -->
  {#if activeTab === "time"}
    <div class="habit-analytics-section">
    <div class="section-header-row">
      <h3>{$t("habitAnalytics.timeAndProjects")}</h3>
      <div class="period-selector">
        <input type="date" bind:value={periodStart} class="period-input" />
        <span class="period-separator">—</span>
        <input type="date" bind:value={periodEnd} class="period-input" />
      </div>
    </div>
    {#if filteredTimeLogs.length === 0 && tasksWithTime.length === 0}
      <div class="time-logs-empty">{$t("habitAnalytics.noTimeLogs")}</div>
    {:else}
      <!-- Stats cards -->
      <div class="time-logs-stats">
        <div class="time-stat" style="animation-delay: 0ms">
          <span class="time-stat-value">{formatDuration(combinedTimeMs)}</span>
          <span class="time-stat-label">{$t("habitAnalytics.totalTime")}</span>
        </div>
        <div class="time-stat" style="animation-delay: 70ms">
          <span class="time-stat-value" use:countUp={{ value: uniqueDays, duration: 650 }}></span>
          <span class="time-stat-label">{$t("habitAnalytics.workDays")}</span>
        </div>
        <div class="time-stat" style="animation-delay: 140ms">
          <span class="time-stat-value">{formatDuration(avgPerDay)}</span>
          <span class="time-stat-label">{$t("habitAnalytics.avgPerDay")}</span>
        </div>
      </div>

      <!-- Area chart -->
      <div class="time-logs-chart">
        <BarChart logs={filteredTimeLogs} {extraTimeByDate} mode="area" />
      </div>

      <!-- Two columns: Donut + Project table -->
      <div class="time-project-bottom">
        <div class="time-project-donut">
          <h4>{$t("habitAnalytics.timeDistribution")}</h4>
          <DonutChart
            segments={donutSegments}
            centerValue={formatDuration(combinedTimeMs)}
            centerLabel="100%"
          />
        </div>
        <div class="time-project-table">
          <h4>{$t("habitAnalytics.projects")}</h4>
          <ProjectAnalytics filter={(t) => {
            const match = t.dateUID.match(/^day-(\d{4}-\d{2}-\d{2})/);
            if (!match || match[1] < periodStart || match[1] > periodEnd) return false;
            return t.status === "done" || (t.totalWorkTime && t.totalWorkTime > 0) || (t.estimatedTime && t.estimatedTime > 0);
          }} />
        </div>
      </div>
    {/if}
    </div>
  {/if}

  <!-- Earnings Section -->
  {#if activeTab === "earnings"}
    <div class="habit-analytics-section">
    <div class="earnings-header">
      <h3>{$t("habitAnalytics.earnings")}</h3>
      <button class="earnings-detail-btn" on:click={openFinancialAnalytics}>
        {$t("financeAnalytics.details")}
      </button>
    </div>
    <div class="earnings-summary">
      <div class="earnings-card earnings-card-main" style="animation-delay: 0ms">
        <span class="earnings-value"
          ><span use:countUp={{ value: monthlyEarnings, duration: 800, format: (n) => n.toLocaleString($numberLocale) }}></span> ₽</span
        >
        <span class="earnings-label">{$t("habitAnalytics.monthFact")}</span>
        {#if monthlyDelta !== 0}
          <span class="earnings-delta {monthlyDelta > 0 ? 'delta-up' : 'delta-down'}"
            >{monthlyDelta > 0 ? '+' : ''}{$t("finance.deltaFromLastMonth", { amount: monthlyDelta.toLocaleString($numberLocale), currency: "₽" })}</span
          >
        {/if}
      </div>
      <div class="earnings-card earnings-card-expected" style="animation-delay: 80ms">
        <span class="earnings-value earnings-value-expected"
          ><span use:countUp={{ value: expectedMonthlyEarnings, duration: 800, format: (n) => n.toLocaleString($numberLocale) }}></span> ₽</span
        >
        <span class="earnings-label">{$t("habitAnalytics.monthPlan")}</span>
        {#if expectedMonthlyEarnings > 0}
          {@const progress = Math.round((monthlyEarnings / expectedMonthlyEarnings) * 100)}
          <div class="earnings-progress-bar">
            <div
              class="earnings-progress-fill"
              style="width: {Math.min(progress, 100)}%"
              class:over={progress >= 100}
            ></div>
          </div>
          <span class="earnings-progress-text" class:done={progress >= 100}>
            {progress}% {$t("habitAnalytics.completedLabel")}
          </span>
        {/if}
      </div>
      <div class="earnings-card" style="animation-delay: 160ms">
        <span class="earnings-value"
          ><span use:countUp={{ value: yearlyEarnings, duration: 900, format: (n) => n.toLocaleString($numberLocale) }}></span> ₽</span
        >
        <span class="earnings-label">{$t("habitAnalytics.yearTotal")}</span>
        {#if yearlyDelta !== 0}
          <span class="earnings-delta {yearlyDelta > 0 ? 'delta-up' : 'delta-down'}"
            >{yearlyDelta > 0 ? '+' : ''}{yearlyDelta.toLocaleString($numberLocale)} ₽ {$t("habitAnalytics.vsLastYear")}</span
          >
        {/if}
      </div>
    </div>
    {#if monthlyChart.some((m) => m.amount > 0)}
      <div class="earnings-chart">
        {#each monthlyChart as monthData}
          <div class="earnings-bar-wrapper">
            <div class="earnings-bar-info">
              {#if monthData.amount > 0}
                <span class="earnings-bar-amount">
                  {monthData.amount.toLocaleString($numberLocale)} ₽
                </span>
              {/if}
            </div>
            <div
              class="earnings-bar"
              style="height: {monthData.amount > 0
                ? Math.max((monthData.amount / maxMonthly) * 100, 4)
                : 0}%;"
              title="{monthNames[
                monthData.month - 1
              ]}: {monthData.amount.toLocaleString($numberLocale)} ₽"
            ></div>
            <span class="earnings-bar-label">
              {monthNames[monthData.month - 1]}
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="earnings-empty">{$t("habitAnalytics.noEarnings")}</div>
    {/if}
    </div>
  {/if}
</div>

<style>
  .habit-analytics {
    padding: 20px 16px;
    height: 100%;
    overflow-y: auto;
    background: transparent;
    max-width: 1200px;
    margin: 0 auto;
  }

  .analytics-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 16px;
  }

  .analytics-tab {
    padding: 8px 14px;
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius-sm);
    background: var(--mcp-glass-bg);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .analytics-tab:hover {
    color: var(--text-normal);
    border-color: var(--mcp-accent);
  }

  .analytics-tab.active {
    background: var(--mcp-accent);
    border-color: var(--mcp-accent);
    color: var(--text-on-accent, #fff);
  }

  .habit-analytics-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 10px;
  }

  :global(.habit-analytics-header h2) {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  :global(.habit-analytics-select) {
    border-radius: var(--mcp-radius-sm);
    border: 1px solid var(--mcp-glass-border);
    background: var(--mcp-glass-bg);
    backdrop-filter: var(--mcp-blur);
    -webkit-backdrop-filter: var(--mcp-blur);
    color: var(--text-normal);
    font-size: 13px;
    transition: all 0.2s ease;
  }

  :global(.habit-analytics-select:focus) {
    border-color: var(--mcp-accent);
    outline: none;
    box-shadow: 0 0 0 3px var(--mcp-accent-dim);
  }

  :global(.habit-analytics-empty) {
    text-align: center;
    padding: 40px 16px;
    color: var(--text-muted);
    font-size: 14px;
  }

  /* ═══ HABITS MODULE ═══════════════════════ */
  .habits-module {
    margin-bottom: 24px;
    padding: 18px;
    background: var(--mcp-glass-bg);
    backdrop-filter: var(--mcp-blur);
    -webkit-backdrop-filter: var(--mcp-blur);
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius);
    box-shadow: var(--mcp-shadow);
    animation: analytics-rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  }

  .habits-module__header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }

  .habits-module__icon {
    font-size: 16px;
    flex-shrink: 0;
  }

  .habits-module__title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-normal);
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.8;
  }

  .habits-module__count {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-accent);
    background: var(--mcp-glass-highlight);
    padding: 2px 8px;
    border-radius: 10px;
  }

  .habits-module__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }

  /* ═══ SECTIONS ═══════════════════════════ */
  .habit-analytics-section {
    margin-bottom: 24px;
    padding: 18px;
    background: var(--mcp-glass-bg);
    backdrop-filter: var(--mcp-blur);
    -webkit-backdrop-filter: var(--mcp-blur);
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius);
    box-shadow: var(--mcp-shadow);
    animation: analytics-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  }

  .habit-analytics-section + .habit-analytics-section {
    animation-delay: 0.1s;
  }

  .habit-analytics-section:last-child {
    margin-bottom: 0;
  }

  .habit-analytics-section h3 {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 14px 0;
    color: var(--text-normal);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.8;
  }

  /* Weekly Bar Chart */
  :global(.weekly-chart) {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 130px;
    padding: 12px 8px 0;
    border-radius: var(--mcp-radius-sm);
    background: var(--mcp-glass-highlight);
  }

  :global(.weekly-bar-wrapper) {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    justify-content: flex-end;
  }

  :global(.weekly-bar-info) {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 4px;
    min-height: 20px;
  }

  :global(.weekly-bar-percent) {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-accent);
    white-space: nowrap;
  }

  :global(.weekly-bar-earnings) {
    font-size: 9px;
    font-weight: 500;
    color: var(--mcp-success, rgba(34, 197, 94, 0.9));
    white-space: nowrap;
  }

  :global(.weekly-bar) {
    width: 100%;
    max-width: 36px;
    background: linear-gradient(
      180deg,
      var(--interactive-accent),
      color-mix(in srgb, var(--interactive-accent) 70%, transparent)
    );
    border-radius: 4px 4px 0 0;
    min-height: 0;
    transition:
      height 0.3s ease,
      opacity 0.2s ease;
  }

  :global(.weekly-bar:hover) {
    opacity: 0.85;
  }

  :global(.weekly-bar-label) {
    font-size: 9px;
    color: var(--text-muted);
    margin-top: 6px;
    white-space: nowrap;
    font-weight: 500;
  }

  /* Time Logs */
  .time-logs-empty {
    text-align: center;
    padding: 24px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .time-logs-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 16px;
  }

  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 10px;
  }

  .section-header-row h3 {
    margin: 0;
  }

  .period-selector {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .period-input {
    padding: 6px 10px;
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius-sm);
    background: var(--mcp-glass-bg);
    color: var(--mcp-text);
    font-size: 12px;
    font-family: inherit;
    transition: all 0.2s ease;
  }

  .period-input:focus {
    border-color: var(--mcp-accent);
    outline: none;
    box-shadow: 0 0 0 3px var(--mcp-accent-dim);
  }

  .period-separator {
    color: var(--mcp-text-muted);
    font-size: 12px;
  }

  .time-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 14px 12px;
    background: var(--mcp-glass-highlight);
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius-sm);
    transition: all 0.2s ease;
    animation: analytics-pop 0.45s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  }

  .time-stat:hover {
    border-color: var(--mcp-accent);
    transform: translateY(-2px);
  }

  .time-stat-value {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-accent);
    letter-spacing: -0.02em;
  }

  .time-stat-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 6px;
    font-weight: 500;
  }

  :global(.time-stat-delta) {
    font-size: 10px;
    font-weight: 600;
    margin-top: 4px;
  }

  .delta-up {
    color: var(--mcp-success, rgba(34, 197, 94, 0.9));
  }

  .delta-down {
    color: var(--mcp-danger, rgba(220, 150, 150, 0.8));
  }

  .time-logs-chart {
    margin-top: 14px;
    padding: 12px;
    background: var(--mcp-glass-highlight);
    border-radius: var(--mcp-radius-sm);
  }

  .time-project-bottom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 16px;
  }

  .time-project-donut,
  .time-project-table {
    padding: 16px;
    background: var(--mcp-glass-highlight);
    border-radius: var(--mcp-radius-sm);
  }

  .time-project-bottom h4 {
    margin: 0 0 14px;
    font-size: 12px;
    font-weight: 600;
    color: var(--mcp-text);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.85;
  }

  @media (max-width: 768px) {
    .time-project-bottom {
      grid-template-columns: 1fr;
    }
  }

  /* Earnings */
  .earnings-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    margin-bottom: 18px;
  }

  .earnings-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 18px 14px;
    background: var(--mcp-glass-highlight);
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius-sm);
    transition: all 0.2s ease;
    animation: analytics-pop 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  }

  .earnings-card:hover {
    border-color: var(--mcp-success, rgba(34, 197, 94, 0.5));
    transform: translateY(-2px);
  }

  .earnings-card-expected {
    border-color: var(--mcp-accent-dim);
  }

  .earnings-card-expected:hover {
    border-color: var(--mcp-accent);
  }

  .earnings-value {
    font-size: 22px;
    font-weight: 700;
    color: var(--mcp-success, rgba(34, 197, 94, 0.9));
    letter-spacing: -0.02em;
  }

  .earnings-value-expected {
    color: var(--mcp-accent);
  }

  .earnings-progress-bar {
    width: 100%;
    height: 6px;
    background: var(--mcp-surface);
    border-radius: 3px;
    margin-top: 8px;
    overflow: hidden;
  }

  .earnings-progress-fill {
    height: 100%;
    background: linear-gradient(
      90deg,
      var(--mcp-accent),
      color-mix(in srgb, var(--mcp-accent) 70%, white)
    );
    border-radius: 3px;
    transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: 0 0 8px var(--mcp-accent-dim);
  }

  .earnings-progress-fill.over {
    background: linear-gradient(
      90deg,
      var(--mcp-success, rgba(34, 197, 94, 0.9)),
      color-mix(in srgb, var(--mcp-success, rgba(34, 197, 94, 0.9)) 70%, white)
    );
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.35);
  }

  .earnings-progress-text {
    font-size: 11px;
    font-weight: 600;
    color: var(--mcp-text-muted);
    margin-top: 4px;
  }

  .earnings-progress-text.done {
    color: var(--mcp-success, rgba(34, 197, 94, 0.9));
  }

  .earnings-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-top: 6px;
    font-weight: 500;
  }

  .earnings-delta {
    font-size: 10px;
    font-weight: 600;
    margin-top: 4px;
  }

  .earnings-delta.delta-up {
    color: var(--mcp-success, rgba(34, 197, 94, 0.9));
  }

  .earnings-delta.delta-down {
    color: var(--mcp-danger, rgba(220, 100, 100, 0.9));
  }

  .earnings-chart {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 110px;
    padding: 12px 8px 0;
    border-radius: var(--mcp-radius-sm);
    background: var(--mcp-glass-highlight);
  }

  .earnings-bar-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
    justify-content: flex-end;
  }

  .earnings-bar-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 4px;
    min-height: 16px;
  }

  .earnings-bar-amount {
    font-size: 12px;
    font-weight: 600;
    color: var(--mcp-success, rgba(34, 197, 94, 0.9));
    white-space: nowrap;
  }

  .earnings-bar {
    width: 100%;
    max-width: 36px;
    background: linear-gradient(
      180deg,
      var(--mcp-success, rgba(34, 197, 94, 0.8)),
      color-mix(
        in srgb,
        var(--mcp-success, rgba(34, 197, 94, 0.5)) 60%,
        transparent
      )
    );
    border-radius: 4px 4px 0 0;
    min-height: 0;
    transform-origin: bottom center;
    animation: bar-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    transition:
      height 0.3s ease,
      opacity 0.2s ease,
      filter 0.2s ease;
  }

  .earnings-bar-wrapper:nth-child(1) .earnings-bar { animation-delay: 0ms; }
  .earnings-bar-wrapper:nth-child(2) .earnings-bar { animation-delay: 40ms; }
  .earnings-bar-wrapper:nth-child(3) .earnings-bar { animation-delay: 80ms; }
  .earnings-bar-wrapper:nth-child(4) .earnings-bar { animation-delay: 120ms; }
  .earnings-bar-wrapper:nth-child(5) .earnings-bar { animation-delay: 160ms; }
  .earnings-bar-wrapper:nth-child(6) .earnings-bar { animation-delay: 200ms; }
  .earnings-bar-wrapper:nth-child(7) .earnings-bar { animation-delay: 240ms; }
  .earnings-bar-wrapper:nth-child(8) .earnings-bar { animation-delay: 280ms; }
  .earnings-bar-wrapper:nth-child(9) .earnings-bar { animation-delay: 320ms; }
  .earnings-bar-wrapper:nth-child(10) .earnings-bar { animation-delay: 360ms; }
  .earnings-bar-wrapper:nth-child(11) .earnings-bar { animation-delay: 400ms; }
  .earnings-bar-wrapper:nth-child(12) .earnings-bar { animation-delay: 440ms; }

  .earnings-bar:hover {
    opacity: 0.95;
    filter: brightness(1.12);
  }

  .earnings-bar-label {
    font-size: 9px;
    color: var(--text-muted);
    margin-top: 6px;
    white-space: nowrap;
    font-weight: 500;
  }

  .earnings-empty {
    text-align: center;
    padding: 24px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .earnings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }

  .earnings-header h3 {
    margin: 0;
  }

  .earnings-detail-btn {
    padding: 8px 16px;
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius-sm);
    background: var(--mcp-glass-bg);
    backdrop-filter: var(--mcp-blur);
    -webkit-backdrop-filter: var(--mcp-blur);
    color: var(--text-accent);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.2s ease;
  }

  .earnings-detail-btn:hover {
    background: var(--mcp-accent);
    color: var(--text-on-accent, #fff);
    border-color: var(--mcp-accent);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px var(--mcp-accent-dim);
  }

  @media (max-width: 768px) {
    .habits-module__grid {
      grid-template-columns: 1fr;
    }

    .time-logs-stats {
      grid-template-columns: 1fr;
    }

    .time-project-bottom {
      grid-template-columns: 1fr;
    }

    .earnings-summary {
      grid-template-columns: 1fr;
    }

    .earnings-chart {
      height: 90px;
    }
  }

  /* ── Analytics motion ───────────────────────────────── */
  @keyframes analytics-rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes analytics-pop {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes bar-rise {
    from {
      transform: scaleY(0.15);
      opacity: 0.35;
    }
    to {
      transform: scaleY(1);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .habits-module,
    .habit-analytics-section,
    .time-stat,
    .earnings-card,
    .earnings-bar {
      animation: none !important;
    }

    .earnings-progress-fill {
      transition: none !important;
    }
  }
</style>
