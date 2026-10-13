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
  } from "../task-tracker/stores";
  import { app } from "../stores/appStore";
  import {
    financialAnalyticsData,
    getManualIncomeForMonth,
    getManualIncomeForYear,
  } from "../finance/financialAnalyticsStorage";
  import { financeData, getCustomExpenseCategories } from "../finance/storage";
  import {
    computeAnalyticsFinance,
    collectExpenseLogs,
    filterExpensesByPeriod,
    type AnalyticsFinanceTotals,
  } from "../finance/analyticsFinance";
  import type { ExpenseEntry } from "../finance/types";
  import { mergeCategories, categoryByName, type ExpenseCategoryDef } from "../finance/expenseCategories";
  import { VIEW_TYPE_FINANCE } from "../constants";
  import { requestFinanceTab } from "../finance/financeUiStore";
  import { t, tArray, locale } from "../i18n";
  import { settings } from "../ui/stores";
  import { derived as derivedStore } from "svelte/store";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { countUp } from "../utils/visualMotion";
  import { analyticsTabRequest, type AnalyticsTab as RequestedTab } from "../stores/analyticsStore";

  const numberLocale = derivedStore(locale, ($locale) => $locale === "ru" ? "ru-RU" : "en-US");

  type AnalyticsTab = RequestedTab;
  let activeTab: AnalyticsTab = "habits";

  $: if ($analyticsTabRequest) {
    activeTab = $analyticsTabRequest;
    analyticsTabRequest.set(null);
  }

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

  // Task completion (done / failed / in progress / other) for the selected period
  $: periodTasks = $tasks.filter((t) => {
    const match = t.dateUID.match(/^day-(\d{4}-\d{2}-\d{2})/);
    return match && match[1] >= periodStart && match[1] <= periodEnd;
  });
  $: totalTasksCount = periodTasks.length;
  $: doneTasksCount = periodTasks.filter((t) => t.status === "done" || t.completed).length;
  $: failedTasksCount = periodTasks.filter((t) => t.status === "failed").length;
  $: progressTasksCount = periodTasks.filter((t) => t.status === "progress").length;
  $: otherTasksCount = Math.max(0, totalTasksCount - doneTasksCount - failedTasksCount - progressTasksCount);
  $: donePct = totalTasksCount > 0 ? Math.round((doneTasksCount / totalTasksCount) * 100) : 0;
  $: failedPct = totalTasksCount > 0 ? Math.round((failedTasksCount / totalTasksCount) * 100) : 0;
  $: progressPct = totalTasksCount > 0 ? Math.round((progressTasksCount / totalTasksCount) * 100) : 0;
  $: otherPct = totalTasksCount > 0 ? Math.round((otherTasksCount / totalTasksCount) * 100) : 0;
  $: completionRate = donePct;
  $: taskStatusSegments = [
    { label: $t("habitAnalytics.taskDone"), value: doneTasksCount, color: "#3d9a6c" },
    { label: $t("habitAnalytics.taskFailed"), value: failedTasksCount, color: "#c45c5c" },
    { label: $t("habitAnalytics.taskInProgress"), value: progressTasksCount, color: "#5b8def" },
    { label: $t("habitAnalytics.otherStatus"), value: otherTasksCount, color: "#8a93a0" },
  ].filter((s) => s.value > 0);

  // Task status distribution by project for the selected period
  $: projectStatusStats = (() => {
    type Row = {
      key: string;
      name: string;
      color: string;
      done: number;
      failed: number;
      progress: number;
      other: number;
      total: number;
    };
    const map = new Map<string, Row>();
    const noKey = "__none__";
    for (const task of periodTasks) {
      const pKey = task.projectId || noKey;
      if (!map.has(pKey)) {
        const proj = task.projectId ? $projects.find((p) => p.id === task.projectId) : null;
        map.set(pKey, {
          key: pKey,
          name: proj?.name || $t("projectAnalytics.noProject"),
          color: proj?.color || "#647177",
          done: 0,
          failed: 0,
          progress: 0,
          other: 0,
          total: 0,
        });
      }
      const entry = map.get(pKey)!;
      entry.total++;
      if (task.status === "done" || task.completed) entry.done++;
      else if (task.status === "failed") entry.failed++;
      else if (task.status === "progress") entry.progress++;
      else entry.other++;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  })();

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

  // Earnings stats (income = work tasks + «Доходы», never budget plan)
  let financePeriod: "month" | "year" = "month";
  let financeFigures: AnalyticsFinanceTotals = {
    income: 0,
    expenses: 0,
    balance: 0,
    expenseList: [],
    goalDeposits: 0,
  };
  let monthlyChart: { month: number; amount: number }[] = [];
  let maxMonthly = 1;
  let monthlyDelta = 0;
  let yearlyDelta = 0;

  $: {
    $tasks; // re-compute when tasks change
    $financialAnalyticsData; // re-compute when manual income changes
    $financeData; // re-compute when expense log changes
    financePeriod;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const useYear = financePeriod === "year";

    const taskIncome = useYear
      ? getEarningsForYear(currentYear)
      : getEarningsForMonth(currentYear, currentMonth);
    const manualIncome = useYear
      ? getManualIncomeForYear(currentYear)
      : getManualIncomeForMonth(currentYear, currentMonth);
    const expenseList = filterExpensesByPeriod(
      collectExpenseLogs(get(financeData) as Record<string, { expenses?: ExpenseEntry[] }>),
      currentYear,
      useYear ? undefined : currentMonth,
    );
    const goalDeposits = Object.entries(get(financeData) || {}).reduce((sum, [key, data]) => {
      if (key.startsWith("_") || !data) return sum;
      const [y, m] = key.split("-").map(Number);
      if (y !== currentYear) return sum;
      if (!useYear && m !== currentMonth) return sum;
      const goals = (data as { monthGoals?: { currentAmount?: number; broughtForward?: number }[] }).monthGoals || [];
      return sum + goals.reduce((s, g) => s + Math.max(0, (g.currentAmount || 0) - (g.broughtForward ?? 0)), 0);
    }, 0);
    financeFigures = computeAnalyticsFinance({
      taskEarnings: taskIncome,
      manualIncome,
      expenses: expenseList,
      goalDeposits,
    });

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
    monthlyDelta = getEarningsForMonth(currentYear, currentMonth) + getManualIncomeForMonth(currentYear, currentMonth) - prevMonthEarnings;

    // Real deltas: previous year vs current
    const currentYearIncome = getEarningsForYear(currentYear) + getManualIncomeForYear(currentYear);
    const prevYearEarnings = getEarningsForYear(currentYear - 1) + getManualIncomeForYear(currentYear - 1);
    yearlyDelta = currentYearIncome - prevYearEarnings;
  }

  $: expenseByCategory = (() => {
    const cats: ExpenseCategoryDef[] = mergeCategories(getCustomExpenseCategories());
    const map = new Map<string, { name: string; icon: string; amount: number }>();
    for (const e of financeFigures.expenseList) {
      const key = e.categoryName || "other";
      const def = categoryByName(cats, key);
      const name = def?.name || key;
      const icon = e.icon || def?.icon || "📦";
      const prev = map.get(name) || { name, icon, amount: 0 };
      prev.amount += e.amount || 0;
      map.set(name, prev);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);
  })();

  $: expenseCatMax = Math.max(...expenseByCategory.map((c) => c.amount), 1);
  $: financeFlowTotal = Math.max(financeFigures.income + financeFigures.expenses, 1);
  $: financeIncomePct = Math.round((financeFigures.income / financeFlowTotal) * 100);
  $: financeExpensePct = Math.round((financeFigures.expenses / financeFlowTotal) * 100);

  $: monthNames = $tArray("common.months.short");

  async function openFinancialAnalytics(): Promise<void> {
    const appInstance = get(app);
    if (!appInstance) return;

    requestFinanceTab("income");
    const existing = appInstance.workspace.getLeavesOfType(VIEW_TYPE_FINANCE);
    if (existing.length) {
      appInstance.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = appInstance.workspace.getLeaf("tab");
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_FINANCE,
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
      class:active={activeTab === "tasks"}
      role="tab"
      aria-selected={activeTab === "tasks"}
      on:click={() => (activeTab = "tasks")}
    >
      {$t("habitAnalytics.tabTasks")}
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

  {#key activeTab}
  <div
    class="analytics-panel"
    in:fly={{ x: 22, duration: 280, easing: cubicOut }}
  >
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

  <!-- Tasks: done vs not done -->
  {#if activeTab === "tasks"}
    <div class="habit-analytics-section">
      <div class="section-header-row">
        <h3>{$t("habitAnalytics.taskCompletion")}</h3>
        <div class="period-selector">
          <input type="date" bind:value={periodStart} class="period-input" />
          <span class="period-separator">—</span>
          <input type="date" bind:value={periodEnd} class="period-input" />
        </div>
      </div>

      {#if periodTasks.length === 0}
        <div class="time-logs-empty">{$t("habitAnalytics.noTasksInPeriod")}</div>
      {:else}
        <div class="time-logs-stats time-logs-stats--4">
          <div class="time-stat" style="animation-delay: 0ms">
            <span class="time-stat-value">{donePct}%</span>
            <span class="time-stat-label">{$t("habitAnalytics.taskDone")}</span>
            <span class="time-stat-sub">{doneTasksCount}</span>
          </div>
          <div class="time-stat" style="animation-delay: 70ms">
            <span class="time-stat-value">{failedPct}%</span>
            <span class="time-stat-label">{$t("habitAnalytics.taskFailed")}</span>
            <span class="time-stat-sub">{failedTasksCount}</span>
          </div>
          <div class="time-stat" style="animation-delay: 140ms">
            <span class="time-stat-value">{progressPct}%</span>
            <span class="time-stat-label">{$t("habitAnalytics.taskInProgress")}</span>
            <span class="time-stat-sub">{progressTasksCount}</span>
          </div>
          <div class="time-stat" style="animation-delay: 210ms">
            <span class="time-stat-value">{completionRate}%</span>
            <span class="time-stat-label">{$t("habitAnalytics.completionRate")}</span>
            <span class="time-stat-sub">{doneTasksCount}/{totalTasksCount}</span>
          </div>
        </div>

        <div class="task-completion-block">
          <div class="task-completion-layout">
            <div class="task-completion-donut">
              <DonutChart
                segments={taskStatusSegments}
                centerValue={`${completionRate}%`}
                centerLabel={$t("habitAnalytics.completionRate")}
              />
            </div>
            <div class="task-completion-stats">
              <div class="task-completion-row">
                <span class="tc-dot" style="background: #3d9a6c"></span>
                <span class="tc-label">{$t("habitAnalytics.taskDone")}</span>
                <span class="tc-value">{doneTasksCount} · {donePct}%</span>
              </div>
              <div class="task-completion-row">
                <span class="tc-dot" style="background: #c45c5c"></span>
                <span class="tc-label">{$t("habitAnalytics.taskFailed")}</span>
                <span class="tc-value">{failedTasksCount} · {failedPct}%</span>
              </div>
              <div class="task-completion-row">
                <span class="tc-dot" style="background: #5b8def"></span>
                <span class="tc-label">{$t("habitAnalytics.taskInProgress")}</span>
                <span class="tc-value">{progressTasksCount} · {progressPct}%</span>
              </div>
              <div class="task-completion-row">
                <span class="tc-dot" style="background: #8a93a0"></span>
                <span class="tc-label">{$t("habitAnalytics.otherStatus")}</span>
                <span class="tc-value">{otherTasksCount} · {otherPct}%</span>
              </div>
              <div class="task-completion-bar" aria-hidden="true">
                <div class="tc-bar-seg tc-bar-done" style="width: {donePct}%"></div>
                <div class="tc-bar-seg tc-bar-failed" style="width: {failedPct}%"></div>
                <div class="tc-bar-seg tc-bar-progress" style="width: {progressPct}%"></div>
                <div class="tc-bar-seg tc-bar-other" style="width: {otherPct}%"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Status distribution by project -->
        <div class="task-by-project">
          <h4>{$t("habitAnalytics.byProject")}</h4>
          <div class="task-by-project-table">
            <div class="tbp-header">
              <span class="tbp-col-name">{$t("projectAnalytics.project")}</span>
              <span class="tbp-col-num">{$t("habitAnalytics.colDone")}</span>
              <span class="tbp-col-num">{$t("habitAnalytics.colInProgress")}</span>
              <span class="tbp-col-num">{$t("habitAnalytics.colFailed")}</span>
              <span class="tbp-col-num">{$t("habitAnalytics.colRate")}</span>
            </div>
            {#each projectStatusStats as p (p.key)}
              <div class="tbp-row">
                <span class="tbp-col-name">
                  <span class="tbp-dot" style="background: {p.color}"></span>
                  <span class="tbp-name-text">{p.name}</span>
                </span>
                <span class="tbp-col-num tbp-done">{p.done}</span>
                <span class="tbp-col-num tbp-progress">{p.progress}</span>
                <span class="tbp-col-num tbp-failed">{p.failed}</span>
                <span class="tbp-col-num tbp-rate">
                  {p.total > 0 ? Math.round((p.done / p.total) * 100) : 0}%
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
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

  <!-- Finance Section (income / expense analytics — fact only, no budget plan) -->
  {#if activeTab === "earnings"}
    <div class="habit-analytics-section">
    <div class="earnings-header">
      <h3>{$t("habitAnalytics.earnings")}</h3>
      <div class="finance-period-toggle" role="tablist" aria-label={$t("habitAnalytics.periodLabel")}>
        <button
          class="finance-period-btn"
          class:active={financePeriod === "month"}
          role="tab"
          aria-selected={financePeriod === "month"}
          on:click={() => (financePeriod = "month")}
        >{$t("habitAnalytics.periodMonth")}</button>
        <button
          class="finance-period-btn"
          class:active={financePeriod === "year"}
          role="tab"
          aria-selected={financePeriod === "year"}
          on:click={() => (financePeriod = "year")}
        >{$t("habitAnalytics.periodYear")}</button>
      </div>
      <button class="earnings-detail-btn" on:click={openFinancialAnalytics}>
        {$t("financeAnalytics.details")}
      </button>
    </div>

    <!-- Income vs expense overview -->
    <div class="finance-overview">
      <div class="finance-overview-card income">
        <span class="finance-overview-label" title={$t("habitAnalytics.incomeHint")}>{$t("habitAnalytics.income")}</span>
        <span class="finance-overview-value income">
          <span use:countUp={{ value: financeFigures.income, duration: 700, format: (n) => n.toLocaleString($numberLocale) }}></span> ₽
        </span>
        {#if financePeriod === "month" && monthlyDelta !== 0}
          <span class="earnings-delta {monthlyDelta > 0 ? 'delta-up' : 'delta-down'}"
            >{monthlyDelta > 0 ? '+' : ''}{$t("finance.deltaFromLastMonth", { amount: monthlyDelta.toLocaleString($numberLocale), currency: "₽" })}</span
          >
        {:else if financePeriod === "year" && yearlyDelta !== 0}
          <span class="earnings-delta {yearlyDelta > 0 ? 'delta-up' : 'delta-down'}"
            >{yearlyDelta > 0 ? '+' : ''}{yearlyDelta.toLocaleString($numberLocale)} ₽ {$t("habitAnalytics.vsLastYear")}</span
          >
        {/if}
      </div>
      <div class="finance-overview-card expense">
        <span class="finance-overview-label" title={$t("habitAnalytics.expensesHint")}>{$t("habitAnalytics.expenses")}</span>
        <span class="finance-overview-value expense">
          <span use:countUp={{ value: financeFigures.expenses, duration: 700, format: (n) => n.toLocaleString($numberLocale) }}></span> ₽
        </span>
      </div>
      <div class="finance-overview-card balance">
        <span class="finance-overview-label">{$t("habitAnalytics.balance")}</span>
        <span class="finance-overview-value" class:income={financeFigures.balance >= 0} class:expense={financeFigures.balance < 0}>
          <span use:countUp={{ value: financeFigures.balance, duration: 700, format: (n) => n.toLocaleString($numberLocale) }}></span> ₽
        </span>
        <div class="finance-balance-bar">
          <div class="finance-balance-bar__income" style="width:{financeIncomePct}%"></div>
          <div class="finance-balance-bar__expense" style="width:{financeExpensePct}%"></div>
        </div>
      </div>
    </div>

    <!-- Expenses by category -->
    {#if expenseByCategory.length > 0}
      <div class="expense-by-cat">
        <h4 class="expense-by-cat__title">{$t("habitAnalytics.expenseByCategory")}</h4>
        {#each expenseByCategory as cat (cat.name)}
          <div class="expense-by-cat__row">
            <span class="expense-by-cat__icon">{cat.icon}</span>
            <span class="expense-by-cat__name">{cat.name}</span>
            <div class="expense-by-cat__bar">
              <div class="expense-by-cat__fill" style="width:{Math.round((cat.amount / expenseCatMax) * 100)}%"></div>
            </div>
            <span class="expense-by-cat__amt">{cat.amount.toLocaleString($numberLocale)} ₽</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="earnings-empty">{$t("habitAnalytics.noExpenseData")}</div>
    {/if}

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
  {/key}
</div>

<style>
  .analytics-panel {
    min-height: 120px;
    will-change: transform, opacity;
  }

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
    gap: 2px;
    margin-bottom: 16px;
    padding: 4px;
    border-radius: var(--mcp-radius, 16px);
    background: color-mix(in srgb, var(--mcp-glass-bg) 80%, transparent);
    border: 1px solid var(--mcp-glass-border);
    width: fit-content;
  }

  .analytics-tab {
    padding: 8px 16px;
    border: none;
    border-radius: calc(var(--mcp-radius, 16px) - 5px);
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.22s cubic-bezier(0.4, 0, 0.2, 1), color 0.18s ease,
      box-shadow 0.22s ease, transform 0.18s ease;
  }

  .analytics-tab:hover {
    color: var(--text-normal);
  }

  .analytics-tab:active {
    transform: scale(0.96);
  }

  .analytics-tab.active {
    background: var(--mcp-accent);
    color: var(--text-on-accent, #fff);
    box-shadow: 0 2px 12px color-mix(in srgb, var(--mcp-accent) 40%, transparent);
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
    border-radius: 16px;
    box-shadow: var(--mcp-shadow);
    overflow: hidden;
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

  /* Keep habit cards rounded inside analytics */
  :global(.habits-module__grid .habit-card) {
    border-radius: 14px !important;
    overflow: hidden;
  }

  /* ═══ SECTIONS ═══════════════════════════ */
  .habit-analytics-section {
    margin-bottom: 24px;
    padding: 18px;
    background: var(--mcp-glass-bg);
    backdrop-filter: var(--mcp-blur);
    -webkit-backdrop-filter: var(--mcp-blur);
    border: 1px solid var(--mcp-glass-border);
    border-radius: 16px;
    box-shadow: var(--mcp-shadow);
    overflow: hidden;
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

  /* Task completion (done / not done) */
  .task-completion-block {
    margin: 8px 0 18px;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
  }

  .task-completion-layout {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }

  .task-completion-donut {
    flex: 0 0 auto;
    display: flex;
    justify-content: center;
  }

  .task-completion-stats {
    flex: 1 1 180px;
    min-width: 160px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .task-completion-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .tc-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tc-label {
    flex: 1;
    color: var(--text-muted);
  }

  .tc-value {
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  .task-completion-bar {
    display: flex;
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--background-modifier-border);
    margin-top: 4px;
  }

  .tc-bar-seg {
    height: 100%;
    min-width: 0;
    transition: width 0.35s ease;
  }

  .tc-bar-done {
    background: #3d9a6c;
  }

  .tc-bar-failed {
    background: #c45c5c;
  }

  .tc-bar-progress {
    background: #5b8def;
  }

  .tc-bar-other {
    background: #8a93a0;
  }

  .time-logs-stats--4 {
    grid-template-columns: repeat(4, 1fr);
  }

  .time-stat-sub {
    font-size: 11px;
    color: var(--text-faint);
    font-weight: 500;
  }

  .task-by-project {
    margin: 8px 0 18px;
  }

  .task-by-project h4 {
    margin: 0 0 10px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .task-by-project-table {
    display: flex;
    flex-direction: column;
    gap: 0;
    width: 100%;
  }

  .tbp-header,
  .tbp-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px 56px 56px 48px;
    gap: 10px;
    align-items: center;
  }

  .tbp-header {
    padding: 6px 0 8px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    border-bottom: 1px solid var(--background-modifier-border);
    white-space: nowrap;
  }

  .tbp-row {
    padding: 8px 0;
    font-size: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  }

  .tbp-row:last-child {
    border-bottom: none;
  }

  .tbp-col-name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--text-muted);
    font-weight: 500;
  }

  .tbp-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tbp-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .tbp-col-num {
    text-align: right;
    font-weight: 600;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .tbp-header .tbp-col-num {
    font-size: 10px;
    font-weight: 650;
  }

  .tbp-done {
    color: #3d9a6c;
  }

  .tbp-progress {
    color: #5b8def;
  }

  .tbp-failed {
    color: #c45c5c;
  }

  .tbp-rate {
    color: var(--text-normal);
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
  .finance-overview {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 16px;
  }

  .finance-overview-card {
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .finance-overview-label {
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .finance-overview-value {
    font-size: 22px;
    font-weight: 750;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
  }

  .finance-overview-value.income { color: var(--mcp-success, #3dd68c); }
  .finance-overview-value.expense { color: var(--mcp-danger, #f07178); }

  .finance-balance-bar {
    display: flex;
    height: 5px;
    border-radius: 999px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.06);
    margin-top: 4px;
  }

  .finance-balance-bar__income {
    background: linear-gradient(90deg, #3dd68c, #6eebb0);
    height: 100%;
  }

  .finance-balance-bar__expense {
    background: linear-gradient(90deg, #f07178, #ff9a9a);
    height: 100%;
  }

  .expense-by-cat {
    margin: 4px 0 16px;
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.02);
  }

  .expense-by-cat__title {
    margin: 0 0 12px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .expense-by-cat__row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .expense-by-cat__icon {
    width: 22px;
    text-align: center;
    font-size: 15px;
    flex-shrink: 0;
  }

  .expense-by-cat__name {
    width: 110px;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .expense-by-cat__bar {
    flex: 1;
    height: 7px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
    min-width: 40px;
  }

  .expense-by-cat__fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--interactive-accent), color-mix(in srgb, var(--interactive-accent) 50%, #fff));
    transition: width 0.4s ease;
  }

  .expense-by-cat__amt {
    width: 90px;
    text-align: right;
    font-size: 12px;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
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

  .finance-period-toggle {
    display: inline-flex;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--mcp-glass-border);
    border-radius: var(--mcp-radius-sm);
    background: var(--mcp-glass-bg);
  }

  .finance-period-btn {
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.15s ease;
  }

  .finance-period-btn.active {
    background: var(--mcp-glass-highlight);
    color: var(--text-accent);
    font-weight: 600;
  }

  .finance-period-btn:hover:not(.active) {
    color: var(--text-normal);
  }

  .earnings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
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
    .habit-analytics {
      padding: 12px 10px;
    }

    .analytics-tabs {
      flex-wrap: wrap;
      gap: 2px;
    }

    .analytics-tab {
      padding: 7px 12px;
      font-size: 11px;
    }

    .habit-analytics-header h1 {
      font-size: 17px;
    }

    .habits-module {
      padding: 12px;
      border-radius: 12px;
    }

    .habits-module__grid {
      grid-template-columns: 1fr;
    }

    .time-logs-stats {
      grid-template-columns: 1fr;
    }

    .time-logs-stats--4 {
      grid-template-columns: repeat(2, 1fr);
    }

    .task-by-project .tbp-header,
    .task-by-project .tbp-row {
      grid-template-columns: minmax(0, 1fr) 44px 44px 44px 40px;
      gap: 6px;
    }

    .task-by-project .tbp-header {
      font-size: 9px;
      letter-spacing: 0;
    }

    .time-project-bottom {
      grid-template-columns: 1fr;
    }

    .finance-overview {
      grid-template-columns: 1fr;
      gap: 8px;
    }

    .finance-overview-card {
      padding: 12px 14px;
    }

    .finance-overview-value {
      font-size: 18px;
    }

    .finance-period-toggle {
      order: 3;
    }

    .earnings-header {
      gap: 8px;
    }

    .expense-by-cat {
      padding: 12px;
    }

    .expense-by-cat__name {
      width: auto;
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .expense-by-cat__bar {
      flex: 1 1 48px;
      min-width: 40px;
    }

    .expense-by-cat__amt {
      font-size: 11px;
    }

    .earnings-chart {
      height: 90px;
    }

    .earnings-empty {
      padding: 24px 12px;
    }

    .period-input {
      min-width: 0;
      width: 100%;
    }
  }

  @media (max-width: 480px) {
    .time-logs-stats--4 {
      grid-template-columns: 1fr;
    }

    .task-by-project .tbp-header,
    .task-by-project .tbp-row {
      grid-template-columns: minmax(0, 1fr) 36px 36px 36px 32px;
      gap: 4px;
      font-size: 10px;
    }

    .finance-overview-value {
      font-size: 16px;
    }

    .expense-by-cat__icon {
      width: 18px;
      font-size: 13px;
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
    .earnings-bar {
      animation: none !important;
    }
  }
</style>
