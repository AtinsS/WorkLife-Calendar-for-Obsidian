<script lang="ts">
  import {
    financeData,
    getCurrentMonthKey,
    getMonthData,
    updateMonthData,
    getStoredMonthKeys,
    deleteMonthData,
    deleteMonthsBefore,
    ensureGoalsRollover,
  } from "./storage";
  import type { FinanceCategory, FinanceMonthData, MonthGoal, SavingsCategory, ExpenseEntry } from "./types";
  import { generateCategoryId, generateGoalId, generateExpenseId, getGoalMonthContribution, isGoalComplete, resolveGoalAdjustment, type GoalAdjustMode } from "./types";
  import {
    mergeCategories,
    iconForCategory,
    guessCategory,
    categoryByName,
    generateCategoryId as generateCatId,
    type ExpenseCategoryDef,
  } from "./expenseCategories";
  import { getCustomExpenseCategories, saveCustomExpenseCategories } from "./storage";
  import { AIFinanceModal, type AIFinanceMode } from "../services/AIFinanceModal";
  import { AIExpenseParseModal } from "../services/AIExpenseParseModal";
  import { buildFinanceSummary, getFinanceAiConfig } from "../services/financeAI";
  import { settings } from "../ui/stores";
  import { get } from "svelte/store";
  import {
    tasks,
    getEarningsForMonth,
    getExpectedEarningsForMonth,
  } from "../task-tracker/stores";
  import { financialAnalyticsData } from "./financialAnalyticsStorage";
  import { t, tArray, locale } from "../i18n";
  import { clampAmount } from "../utils/sanitize";

  type DistributionIncomeSource = "plan" | "fact" | "manual";

  function inputVal(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  let monthKey = getCurrentMonthKey();
  let monthData: FinanceMonthData = {
    monthlyIncome: 0,
    lastMonthExpense: 0,
    mainAccountCategories: [],
    monthGoals: [],
    savingsCategories: [],
    distributionRules: [],
    expenses: [],
    updatedAt: "",
  };
  let incomeSource: DistributionIncomeSource = "fact";
  let manualIncome = 0;
  let editingRules = false;
  let editingGoalId: string | null = null;
  let editingMainCatId: string | null = null;
  let editingSavingsId: string | null = null;

  $: [displayYear, displayMonth] = monthKey.split("-").map(Number);
  $: displayMonthName = `${$tArray("common.months.long")[displayMonth - 1]} ${displayYear}`;

  function prevMonth(): void {
    const d = new Date(displayYear, displayMonth - 2, 1);
    monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function nextMonth(): void {
    const d = new Date(displayYear, displayMonth, 1);
    monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // ── Load data from store when monthKey or financeData changes ──
  // Skip while user is actively editing to prevent input fields from resetting
  $: {
    $financeData;
    if (!editingMainCatId && !editingGoalId && !editingSavingsId) {
      const newData = getMonthData(monthKey);
      if (newData) {
        monthData = newData;
        incomeSource = normalizeIncomeSource(monthData.incomeSource);
        manualIncome = monthData.monthlyIncome;
      }
    }
  }

  // Carry incomplete goals (with money) into the open month
  $: {
    void monthKey;
    ensureGoalsRollover(monthKey);
  }

  // ── Sync income from tasks/analytics (only when not editing manually) ──
  // Guard: only sync after data has been loaded from disk and user is not in manual mode
  $: {
    void $tasks;
    void $financialAnalyticsData;
    // Use a microtask to avoid updating during the same tick as the store reload above
    if (incomeSource !== "manual" && monthData.updatedAt && monthKey) {
      const income = getIncomeForSource(incomeSource);
      if (income !== monthData.monthlyIncome || monthData.incomeSource !== incomeSource) {
        // Directly update the store without re-reading monthData
        financeData.update((current) => ({
          ...current,
          [monthKey]: {
            ...(current[monthKey] || {
              monthlyIncome: 0,
              lastMonthExpense: 0,
              mainAccountCategories: [],
              monthGoals: [],
              savingsCategories: [],
              distributionRules: [],
              expenses: [],
              updatedAt: "",
            }),
            monthlyIncome: income,
            incomeSource,
            updatedAt: new Date().toISOString(),
          },
        }));
      }
    }
  }

  $: mainTotal = monthData
    ? monthData.mainAccountCategories.reduce((sum, c) => sum + c.amount, 0)
    : 0;
  $: savingsTotal = monthData
    ? monthData.savingsCategories.reduce((sum, c) => sum + c.amount, 0)
    : 0;
  // Only THIS month's goal deposits reduce the remainder —
  // money carried over from previous months is already saved and must not be subtracted again.
  $: goalsMonthContributions = monthData
    ? (monthData.monthGoals || []).reduce((sum, g) => sum + getGoalMonthContribution(g), 0)
    : 0;
  $: balance = monthData
    ? monthData.monthlyIncome - mainTotal - goalsMonthContributions
    : 0;

  // Recalculate savings amounts from percentages when balance changes
  // (e.g. after duplicating from previous month or when income source updates)
  let lastCalcBalance = -1;
  $: monthKey, (lastCalcBalance = -1);
  $: if (monthData && balance > 0 && balance !== lastCalcBalance) {
    const needsRecalc = monthData.savingsCategories.some(
      (c) => c.percent > 0 && c.amount === 0
    );
    if (needsRecalc) {
      lastCalcBalance = balance;
      const updated = monthData.savingsCategories.map((c) =>
        c.percent > 0 && c.amount === 0
          ? { ...c, amount: Math.round((balance * c.percent) / 100) }
          : c
      );
      updateMonthData(monthKey, { savingsCategories: updated });
    }
  }

  // Previous month data for deltas
  $: prevMonthData = (() => {
    const d = new Date(displayYear, displayMonth - 2, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const all = $financeData || {};
    return all[key] || null;
  })();

  $: incomeDelta = prevMonthData ? monthData.monthlyIncome - prevMonthData.monthlyIncome : 0;
  $: expenseDelta = prevMonthData ? mainTotal - (prevMonthData.mainAccountCategories?.reduce((s, c) => s + c.amount, 0) || 0) : 0;
  $: balanceDelta = prevMonthData
    ? balance - ((prevMonthData.monthlyIncome || 0)
        - (prevMonthData.mainAccountCategories?.reduce((s, c) => s + c.amount, 0) || 0)
        - (prevMonthData.monthGoals || []).reduce((s, g) => s + getGoalMonthContribution(g), 0))
    : 0;

  function normalizeIncomeSource(source: FinanceMonthData["incomeSource"]): DistributionIncomeSource {
    if (source === "manual") return "manual";
    if (source === "plan") return "plan";
    return "fact";
  }

  function isManualIncomeInMonth(dateStr: string, year: number, month: number): boolean {
    const match = dateStr?.match(/^(\d{4})-(\d{2})/);
    if (match) {
      return parseInt(match[1], 10) === year && parseInt(match[2], 10) === month;
    }
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return false;
    return date.getFullYear() === year && date.getMonth() + 1 === month;
  }

  function getManualIncomeForMonth(year: number, month: number): number {
    return get(financialAnalyticsData).manualIncomeSources
      .filter((source) => isManualIncomeInMonth(source.date, year, month))
      .reduce((sum, source) => sum + source.amount, 0);
  }

  function getIncomeForSource(source: Exclude<DistributionIncomeSource, "manual">): number {
    const [year, month] = monthKey.split("-").map(Number);
    const manualIncomeForMonth = getManualIncomeForMonth(year, month);
    if (source === "plan") {
      return getExpectedEarningsForMonth(year, month) + manualIncomeForMonth;
    }
    return getEarningsForMonth(year, month) + manualIncomeForMonth;
  }

  function setIncomeSource(source: DistributionIncomeSource) {
    incomeSource = source;
    if (source === "manual") {
      updateMonthData(monthKey, {
        monthlyIncome: manualIncome,
        incomeSource: "manual",
      });
    } else {
      const income = getIncomeForSource(source);
      updateMonthData(monthKey, {
        monthlyIncome: income,
        incomeSource: source,
      });
    }
  }

  function updateManualIncome(value: string) {
    manualIncome = clampAmount(parseFloat(value.replace(/[^0-9.,]/g, "")) || 0);
    updateMonthData(monthKey, {
      monthlyIncome: manualIncome,
      incomeSource: "manual",
    });
    // Keep incomeSource in sync for the UI
    incomeSource = "manual";
  }

  // ── Main categories ──
  function addMainCategory() {
    const newCat: FinanceCategory = {
      id: generateCategoryId(),
      name: get(t)("finance.newCategory"),
      icon: "📦",
      amount: 0,
      order: monthData.mainAccountCategories.length,
    };
    updateMonthData(monthKey, {
      mainAccountCategories: [...monthData.mainAccountCategories, newCat],
    });
  }

  function removeMainCategory(id: string) {
    updateMonthData(monthKey, {
      mainAccountCategories: monthData.mainAccountCategories.filter(c => c.id !== id),
    });
  }

  function updateMainCategory(id: string, changes: Partial<FinanceCategory>) {
    const updated = monthData.mainAccountCategories.map(c =>
      c.id === id ? { ...c, ...changes } : c
    );
    monthData = { ...monthData, mainAccountCategories: updated };
    updateMonthData(monthKey, { mainAccountCategories: updated });
  }

  // ── Goals ──
  function addGoal() {
    const newGoal: MonthGoal = {
      id: generateGoalId(),
      icon: "🎯",
      name: get(t)("finance.newGoal"),
      currentAmount: 0,
      targetAmount: 0,
      broughtForward: 0,
    };
    updateMonthData(monthKey, {
      monthGoals: [...(monthData.monthGoals || []), newGoal],
    });
  }

  function removeGoal(id: string) {
    updateMonthData(monthKey, {
      monthGoals: (monthData.monthGoals || []).filter(g => g.id !== id),
    });
  }

  function updateGoal(id: string, changes: Partial<MonthGoal>) {
    const updated = (monthData.monthGoals || []).map(g =>
      g.id === id ? { ...g, ...changes } : g
    );
    monthData = { ...monthData, monthGoals: updated };
    updateMonthData(monthKey, { monthGoals: updated });
  }

  // ── Goal deposit / withdraw this month (by amount or %) ──
  let goalAdjustMode: GoalAdjustMode = "amount";
  let goalAdjustValues: Record<string, string> = {};

  function setGoalAdjustValue(id: string, value: string) {
    goalAdjustValues = { ...goalAdjustValues, [id]: value };
  }

  function applyGoalAdjust(goal: MonthGoal, direction: "deposit" | "withdraw") {
    const raw = parseFloat((goalAdjustValues[goal.id] ?? "").replace(",", ".")) || 0;
    const delta = resolveGoalAdjustment(raw, goalAdjustMode, direction, {
      balance,
      currentAmount: goal.currentAmount ?? 0,
    });
    if (delta === 0) return;
    const next = clampAmount((goal.currentAmount ?? 0) + delta);
    updateGoal(goal.id, { currentAmount: next });
    setGoalAdjustValue(goal.id, "");
  }

  // ── Savings ──
  function addSavingsCategory() {
    const newCat: SavingsCategory = {
      id: generateCategoryId(),
      name: get(t)("finance.newSavings"),
      icon: "👛",
      amount: 0,
      order: monthData.savingsCategories.length,
      percent: 0,
      completed: false,
    };
    updateMonthData(monthKey, {
      savingsCategories: [...monthData.savingsCategories, newCat],
    });
  }

  function removeSavingsCategory(id: string) {
    updateMonthData(monthKey, {
      savingsCategories: monthData.savingsCategories.filter(c => c.id !== id),
    });
  }

  function updateSavingsCategory(id: string, changes: Partial<SavingsCategory>) {
    const updated = monthData.savingsCategories.map(c =>
      c.id === id ? { ...c, ...changes } : c
    );
    monthData = { ...monthData, savingsCategories: updated };
    updateMonthData(monthKey, { savingsCategories: updated });
  }

  // ── Rules ──
  let rulesText = "";

  function startEditRules(): void {
    rulesText = monthData.distributionRules.join("\n");
    editingRules = true;
  }

  function saveRules() {
    const rules = rulesText.split("\n").filter(r => r.trim());
    updateMonthData(monthKey, { distributionRules: rules });
    editingRules = false;
  }

  function formatMoney(amount: number): string {
    return amount.toLocaleString(get(locale) === "en" ? "en-US" : "ru-RU");
  }

  function formatDelta(amount: number): string {
    if (amount === 0) return "";
    const translate = get(t);
    return translate("finance.deltaFromLastMonth", { amount: formatMoney(Math.abs(amount)), currency: translate("locale.currencySymbol") });
  }

  // ── Cleanup ──
  let showCleanup = false;
  $: storedKeys = $financeData ? getStoredMonthKeys() : [];
  $: oldKeys = storedKeys.filter(k => k < getCurrentMonthKey());

  let prevMonthKey: string | null = null;
  $: {
    const allData = $financeData || {};
    const keys = Object.keys(allData);
    const d = new Date(displayYear, displayMonth - 2, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    prevMonthKey = keys.includes(key) ? key : null;
  }

  function duplicatePrevMonth(): void {
    if (!prevMonthKey) return;
    // Bring incomplete goals forward with their money before copying expense plan
    ensureGoalsRollover(prevMonthKey);
    const prev = getMonthData(prevMonthKey);
    // Copy expense line items WITH their amounts (actual plan, not empty shells)
    const copyCat = (c: FinanceCategory): FinanceCategory => ({
      id: generateCategoryId(),
      name: c.name,
      icon: c.icon,
      amount: c.amount ?? 0,
      order: c.order,
    });
    // Savings: keep percent, zero amount so it recalculates from the new remainder
    const copySavings = (c: SavingsCategory): SavingsCategory => ({
      id: generateCategoryId(),
      name: c.name,
      icon: c.icon,
      amount: 0,
      order: c.order,
      percent: c.percent ?? 0,
      completed: false,
    });
    // Goals continue with accumulated money — only the monthly deposit resets to 0
    const continueGoal = (g: MonthGoal): MonthGoal => ({
      id: generateGoalId(),
      icon: g.icon,
      name: g.name,
      currentAmount: g.currentAmount ?? 0,
      targetAmount: g.targetAmount ?? 0,
      broughtForward: g.currentAmount ?? 0,
    });
    const existingGoalIds = new Set((monthData.monthGoals || []).map((g) => g.id));
    const continuedGoals = (prev.monthGoals || [])
      .filter((g) => !isGoalComplete(g) && !existingGoalIds.has(g.id))
      .map(continueGoal);
    updateMonthData(monthKey, {
      mainAccountCategories: prev.mainAccountCategories.map(copyCat),
      monthGoals: [...(monthData.monthGoals || []), ...continuedGoals],
      savingsCategories: (prev.savingsCategories || []).map(copySavings),
      distributionRules: [...prev.distributionRules],
    });
  }

  function clearCurrentMonth(): void {
    if (!confirm(get(t)("finance.clearMonthConfirm", { month: displayMonthName }))) return;
    updateMonthData(monthKey, {
      mainAccountCategories: [],
      savingsCategories: [],
      monthGoals: [],
      distributionRules: [],
      expenses: [],
      monthlyIncome: 0,
    });
  }

  function clearOldMonths(): void {
    if (oldKeys.length === 0) return;
    const count = deleteMonthsBefore(getCurrentMonthKey());
    alert(get(t)("finance.deletedMonths", { count }));
  }

  function clearAllData(): void {
    if (!confirm(get(t)("finance.deleteAllConfirm"))) return;
    for (const k of storedKeys) deleteMonthData(k);
  }

  // ── Tabs ──
  let activeTab: "plan" | "expenses" = "plan";

  // ── Expense log (actual money spent — separate from the budget plan) ──
  $: expenses = monthData?.expenses || [];
  $: expensesTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function addExpenseEntry(entry: Omit<ExpenseEntry, "id" | "createdAt">) {
    const next: ExpenseEntry = {
      ...entry,
      icon: entry.icon || iconForCategory(expenseCats, entry.categoryName),
      id: generateExpenseId(),
      createdAt: new Date().toISOString(),
    };
    updateMonthData(monthKey, { expenses: [...(monthData.expenses || []), next] });
  }

  function removeExpenseEntry(id: string) {
    updateMonthData(monthKey, {
      expenses: (monthData.expenses || []).filter((e) => e.id !== id),
    });
    if (editingExpenseId === id) editingExpenseId = null;
  }

  function updateExpenseEntry(id: string, changes: Partial<ExpenseEntry>) {
    const updated = (monthData.expenses || []).map((e) =>
      e.id === id ? { ...e, ...changes } : e,
    );
    updateMonthData(monthKey, { expenses: updated });
  }

  // Inline edit state for expenses
  let editingExpenseId: string | null = null;
  let editExpenseName = "";
  let editExpenseAmount = "";
  let editExpenseCategory = "";
  let editExpenseDate = "";

  function startEditExpense(exp: ExpenseEntry) {
    editingExpenseId = exp.id;
    editExpenseName = exp.name;
    editExpenseAmount = String(exp.amount);
    editExpenseCategory = exp.categoryName || "other";
    editExpenseDate = exp.date;
  }

  function saveExpenseEdit() {
    if (!editingExpenseId) return;
    const amount = clampAmount(parseFloat(editExpenseAmount) || 0);
    if (!editExpenseName.trim() || amount <= 0) return;
    updateExpenseEntry(editingExpenseId, {
      name: editExpenseName.trim(),
      amount,
      categoryName: editExpenseCategory,
      icon: iconForCategory(expenseCats, editExpenseCategory),
      date: editExpenseDate || todayStr(),
    });
    editingExpenseId = null;
  }

  function cancelExpenseEdit() {
    editingExpenseId = null;
  }

  let newExpenseName = "";
  let newExpenseAmount = "";
  let newExpenseCategory = "other";
  let newExpenseDate = todayStr();

  function addExpenseFromForm() {
    const amount = clampAmount(parseFloat(newExpenseAmount) || 0);
    if (!newExpenseName.trim() || amount <= 0) return;
    const cat = categoryByName(expenseCats, newExpenseCategory) || guessCategory(expenseCats, newExpenseName);
    addExpenseEntry({
      name: newExpenseName.trim(),
      icon: cat.icon,
      amount,
      categoryName: cat.name,
      date: newExpenseDate || todayStr(),
    });
    newExpenseName = "";
    newExpenseAmount = "";
    newExpenseCategory = "other";
    newExpenseDate = todayStr();
  }

  // ── Expense categories (builtins + custom, user-editable) ──
  let showCatManager = false;
  let newCatName = "";
  let newCatIcon = "📦";
  let editingCatId: string | null = null;
  let editCatName = "";
  let editCatIcon = "";

  $: expenseCats = (() => {
    void $financeData;
    return mergeCategories(getCustomExpenseCategories());
  })();

  function addCustomCategory() {
    const name = newCatName.trim();
    if (!name) return;
    if (categoryByName(expenseCats, name)) return;
    const cat: ExpenseCategoryDef = {
      id: generateCatId(),
      name,
      icon: newCatIcon.trim() || "📦",
      keywords: [name.toLowerCase()],
      builtin: false,
    };
    saveCustomExpenseCategories([...getCustomExpenseCategories(), cat]);
    newCatName = "";
    newCatIcon = "📦";
  }

  function startEditCategory(cat: ExpenseCategoryDef) {
    if (cat.builtin) return;
    editingCatId = cat.id;
    editCatName = cat.name;
    editCatIcon = cat.icon;
  }

  function saveCategoryEdit() {
    if (!editingCatId) return;
    const name = editCatName.trim();
    if (!name) return;
    const customs = getCustomExpenseCategories().map((c) =>
      c.id === editingCatId
        ? { ...c, name, icon: editCatIcon.trim() || "📦", keywords: [name.toLowerCase()] }
        : c,
    );
    saveCustomExpenseCategories(customs);
    editingCatId = null;
  }

  function removeCustomCategory(id: string) {
    saveCustomExpenseCategories(getCustomExpenseCategories().filter((c) => c.id !== id));
    if (editingCatId === id) editingCatId = null;
  }

  // ── AI finance tools ──
  $: ollamaOn = $settings.ollamaEnabled === true;

  function openExpenseParse() {
    if (!getFinanceAiConfig().enabled) return;
    const app = window.app as never;
    new AIExpenseParseModal(
      app,
      expenseCats,
      (items) => {
        const date = todayStr();
        const created = items.map((item) => ({
          id: generateExpenseId(),
          name: item.name,
          icon: item.icon || iconForCategory(expenseCats, item.categoryName),
          amount: item.amount,
          categoryName: item.categoryName,
          date,
          createdAt: new Date().toISOString(),
        }));
        updateMonthData(monthKey, {
          expenses: [...(monthData.expenses || []), ...created],
        });
        activeTab = "expenses";
      },
    ).open();
  }

  function openAiFinance(mode: AIFinanceMode) {
    if (!getFinanceAiConfig().enabled) return;
    const app = window.app as never;
    new AIFinanceModal(app, mode, {
      getSummary: () =>
        buildFinanceSummary({
          monthlyIncome: monthData.monthlyIncome,
          mainCategories: monthData.mainAccountCategories,
          goals: monthData.monthGoals || [],
          savings: monthData.savingsCategories || [],
          rules: monthData.distributionRules || [],
          goalContribution: goalsMonthContributions,
        }),
      applyRules: (rules, categoryPercents) => {
        const savings = (monthData.savingsCategories || []).map((s) => {
          const sug = categoryPercents.find(
            (c) => c.name.toLowerCase() === s.name.toLowerCase(),
          );
          if (!sug) return s;
          const amount =
            balance > 0 ? clampAmount(Math.round((balance * sug.percent) / 100)) : s.amount;
          return { ...s, percent: sug.percent, amount };
        });
        updateMonthData(monthKey, {
          distributionRules: rules,
          savingsCategories: savings,
        });
      },
    }).open();
  }
</script>

<div class="finance-tracker">
  <!-- Top bar: month + tabs -->
  <div class="fin-topbar">
    <div class="month-selector">
      <button class="month-nav-btn" on:click={prevMonth} aria-label="‹">&#8249;</button>
      <select bind:value={monthKey} class="month-select">
        {#each Array.from({length: 12}, (_, i) => i + 1) as m}
          <option value="{displayYear}-{String(m).padStart(2, '0')}">
            {$tArray("common.months.long")[m - 1]} {displayYear}
          </option>
        {/each}
      </select>
      <button class="month-nav-btn" on:click={nextMonth} aria-label="›">&#8250;</button>
    </div>
    <h2 class="fin-title">{$t("finance.title")}</h2>
    <div class="fin-tabs" role="tablist">
      <button
        class="fin-tab"
        class:is-active={activeTab === "plan"}
        role="tab"
        aria-selected={activeTab === "plan"}
        on:click={() => activeTab = "plan"}
      >{$t("finance.tabBudget")}</button>
      <button
        class="fin-tab"
        class:is-active={activeTab === "expenses"}
        role="tab"
        aria-selected={activeTab === "expenses"}
        on:click={() => activeTab = "expenses"}
      >{$t("finance.tabExpenses")}</button>
    </div>
  </div>

  {#if activeTab === "plan"}
    {#if ollamaOn}
      <div class="ai-finance-bar">
        <button class="ai-finance-bar-btn" on:click={() => openAiFinance("forecast")} title={$t("ai.finance.forecastHint")}>
          📈 {$t("ai.finance.tab.forecast")}
        </button>
        <button class="ai-finance-bar-btn" on:click={() => openAiFinance("rules")} title={$t("ai.finance.rulesHint")}>
          🧩 {$t("ai.finance.tab.rules")}
        </button>
      </div>
    {/if}

    {#if prevMonthKey}
      <button class="dup-btn" on:click={duplicatePrevMonth}>
        {$t("finance.duplicateExpenses")}
      </button>
    {/if}

  <!-- Блок 1: Общий баланс -->
  <div class="glass-card">
    <div class="glass-card-header">
      <span class="glass-icon">💎</span>
      <h3>{$t("finance.balance")}</h3>
    </div>
    <div class="income-toggle">
      <button
        class="toggle-btn"
        class:active={incomeSource === "plan"}
        on:click={() => setIncomeSource("plan")}
      >{$t("finance.planToggle")}</button>
      <button
        class="toggle-btn"
        class:active={incomeSource === "fact"}
        on:click={() => setIncomeSource("fact")}
      >{$t("finance.factToggle")}</button>
      <button
        class="toggle-btn"
        class:active={incomeSource === "manual"}
        on:click={() => setIncomeSource("manual")}
      >{$t("finance.manualToggle")}</button>
    </div>
    <div class="balance-grid">
      <div class="balance-item">
        <span class="balance-label">{$t("finance.income")}</span>
        {#if incomeSource === "manual"}
          <input
            type="number"
            value={manualIncome}
            on:input={(e) => updateManualIncome(inputVal(e))}
            min="0"
            class="balance-input income-input"
          />
        {:else}
          <span class="balance-value income">{formatMoney(monthData.monthlyIncome)} {$t("locale.currencySymbol")}</span>
        {/if}
        {#if incomeDelta !== 0}
          <span class="balance-delta" class:delta-up={incomeDelta > 0} class:delta-down={incomeDelta < 0}>
            {formatDelta(incomeDelta)}
          </span>
        {/if}
      </div>
      <div class="balance-item">
        <span class="balance-label">{$t("finance.expenses")}</span>
        <span class="balance-value expense">{formatMoney(mainTotal)} {$t("locale.currencySymbol")}</span>
        {#if expenseDelta !== 0}
          <span class="balance-delta" class:delta-up={expenseDelta < 0} class:delta-down={expenseDelta > 0}>
            {formatDelta(-expenseDelta)}
          </span>
        {/if}
      </div>
      <div class="balance-item total">
        <span class="balance-label">{$t("finance.remainder")}</span>
        <span class="balance-value {balance >= 0 ? 'income' : 'expense'}">{formatMoney(balance)} {$t("locale.currencySymbol")}</span>
        {#if balanceDelta !== 0}
          <span class="balance-delta" class:delta-up={balanceDelta > 0} class:delta-down={balanceDelta < 0}>
            {formatDelta(balanceDelta)}
          </span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Блок 2: Основной счёт -->
  <div class="glass-card">
    <div class="glass-card-header">
      <span class="glass-icon">🏦</span>
      <h3>{$t("finance.mainAccount")}</h3>
      <span class="glass-badge">{formatMoney(mainTotal)} {$t("locale.currencySymbol")}</span>
    </div>
    <div class="categories-list">
      {#each monthData.mainAccountCategories as cat (cat.id)}
        {#if editingMainCatId === cat.id}
          <div class="category-row editing">
            <input type="text" value={cat.icon} on:input={(e) => updateMainCategory(cat.id, { icon: inputVal(e) })} class="cat-edit-icon" maxlength="2" />
            <input type="text" value={cat.name} on:input={(e) => updateMainCategory(cat.id, { name: inputVal(e) })} class="cat-edit-name" />
            <input type="number" value={cat.amount} on:input={(e) => updateMainCategory(cat.id, { amount: clampAmount(parseFloat(inputVal(e)) || 0) })} min="0" class="cat-edit-amount" />
            <button class="goal-done-btn" on:click={() => editingMainCatId = null}>✓</button>
          </div>
        {:else}
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <div class="category-row" role="button" tabindex="0" on:click={() => editingMainCatId = cat.id} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') editingMainCatId = cat.id; }}>
            <span class="cat-icon-display">{cat.icon}</span>
            <span class="cat-name-display">{cat.name}</span>
            <span class="cat-amount-display">{formatMoney(cat.amount)} {$t("locale.currencySymbol")}</span>
            <button class="cat-delete" on:click|stopPropagation={() => removeMainCategory(cat.id)}>✕</button>
          </div>
        {/if}
      {/each}
    </div>
    <button class="glass-add-btn" on:click={addMainCategory}>{$t("finance.addCategory")}</button>
  </div>

  <!-- Блок 3: Цели на месяц -->
  <div class="glass-card">
    <div class="glass-card-header">
      <span class="glass-icon">🎯</span>
      <h3>{$t("finance.monthGoals")}</h3>
    </div>
    <div class="goals-list">
      {#each (monthData.monthGoals || []) as goal (goal.id)}
        {#if editingGoalId === goal.id}
          <div class="goal-row editing">
            <input type="text" value={goal.icon} on:input={(e) => updateGoal(goal.id, { icon: inputVal(e) })} class="goal-edit-icon" maxlength="2" />
            <div class="goal-info">
              <div class="goal-edit-row">
                <input type="text" value={goal.name} on:input={(e) => updateGoal(goal.id, { name: inputVal(e) })} class="goal-edit-name" placeholder="{$t('finance.newGoal')}" />
                <input type="number" value={goal.currentAmount} on:input={(e) => updateGoal(goal.id, { currentAmount: clampAmount(parseFloat(inputVal(e)) || 0) })} min="0" class="goal-edit-amount" placeholder="{$t('finance.amountPlaceholder')}" />
                <span class="goal-edit-sep">/</span>
                <input type="number" value={goal.targetAmount} on:input={(e) => updateGoal(goal.id, { targetAmount: clampAmount(parseFloat(inputVal(e)) || 0) })} min="0" class="goal-edit-amount" placeholder="{$t('finance.goalPlaceholder')}" />
              </div>
            </div>
            <button class="goal-done-btn" on:click={() => editingGoalId = null}>✓</button>
          </div>
        {:else}
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <div class="goal-row" class:goal-complete={isGoalComplete(goal)} role="button" tabindex="0" on:click={() => editingGoalId = goal.id} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') editingGoalId = goal.id; }}>
            <span class="goal-icon">{goal.icon}</span>
            <div class="goal-info">
              <div class="goal-header">
                <span class="goal-name">{goal.name}</span>
                <span class="goal-amounts">{formatMoney(goal.currentAmount)} {$t("locale.currencySymbol")} / {formatMoney(goal.targetAmount)} {$t("locale.currencySymbol")}</span>
              </div>
              <div class="goal-progress-bar">
                <div class="goal-progress-fill" class:complete={isGoalComplete(goal)} style="width: {goal.targetAmount > 0 ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) : 0}%"></div>
              </div>
              <div class="goal-meta">
                <span class="goal-percent">{goal.targetAmount > 0 ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) : 0}%</span>
                {#if getGoalMonthContribution(goal) > 0}
                  <span class="goal-month-add">+{formatMoney(getGoalMonthContribution(goal))} {$t("locale.currencySymbol")}</span>
                {/if}
                {#if (goal.broughtForward ?? 0) > 0}
                  <span class="goal-brought">↩ {formatMoney(goal.broughtForward ?? 0)}</span>
                {/if}
              </div>
              <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
              <div class="goal-adjust" role="group" on:click|stopPropagation on:keydown|stopPropagation>
                <div class="goal-adjust-mode" role="group">
                  <button
                    type="button"
                    class="goal-adjust-mode-btn"
                    class:active={goalAdjustMode === "amount"}
                    on:click={() => goalAdjustMode = "amount"}
                  >{$t("finance.amount")}</button>
                  <button
                    type="button"
                    class="goal-adjust-mode-btn"
                    class:active={goalAdjustMode === "percent"}
                    on:click={() => goalAdjustMode = "percent"}
                  >%</button>
                </div>
                <input
                  type="number"
                  min="0"
                  class="goal-adjust-input"
                  placeholder={goalAdjustMode === "amount" ? $t("finance.adjustPlaceholder") : "0%"}
                  value={goalAdjustValues[goal.id] ?? ""}
                  on:input={(e) => setGoalAdjustValue(goal.id, inputVal(e))}
                  on:keydown={(e) => {
                    if (e.key === "Enter") applyGoalAdjust(goal, "deposit");
                  }}
                />
                <button type="button" class="goal-adjust-btn deposit" title={$t("finance.depositThisMonth")} on:click={() => applyGoalAdjust(goal, "deposit")}>
                  + {$t("finance.deposit")}
                </button>
                <button type="button" class="goal-adjust-btn withdraw" title={$t("finance.withdrawThisMonth")} on:click={() => applyGoalAdjust(goal, "withdraw")}>
                  − {$t("finance.withdraw")}
                </button>
              </div>
            </div>
            <button class="cat-delete" on:click|stopPropagation={() => removeGoal(goal.id)}>✕</button>
          </div>
        {/if}
      {/each}
    </div>
    <button class="glass-add-btn" on:click={addGoal}>{$t("finance.addGoal")}</button>
  </div>

  <!-- Блок 4: Куда отложить -->
  <div class="glass-card" class:over-budget={savingsTotal > balance}>
    <div class="glass-card-header">
      <span class="glass-icon">💰</span>
      <h3>{$t("finance.savings")}</h3>
      <span class="glass-badge" class:badge-warn={savingsTotal > balance}>
        {$t("finance.remaining", { amount: formatMoney(Math.max(0, balance - savingsTotal)) })}
      </span>
    </div>
    <div class="categories-list">
      {#each monthData.savingsCategories as cat (cat.id)}
        {#if editingSavingsId === cat.id}
          <div class="category-row editing">
            <input type="text" value={cat.icon} on:input={(e) => updateSavingsCategory(cat.id, { icon: inputVal(e) })} class="cat-edit-icon" maxlength="2" />
            <input type="text" value={cat.name} on:input={(e) => updateSavingsCategory(cat.id, { name: inputVal(e) })} class="cat-edit-name" />
            <div class="savings-edit-fields">
              <div class="savings-field">
                <span class="savings-field-label">{$t("finance.amount")}</span>
                <input type="number" value={cat.amount} on:input={(e) => { const amount = clampAmount(parseFloat(inputVal(e)) || 0); const percent = balance > 0 ? Math.round((amount / balance) * 100) : 0; updateSavingsCategory(cat.id, { amount, percent }); }} min="0" class="savings-field-input" />
                <span class="savings-field-unit">{$t("locale.currencySymbol")}</span>
              </div>
              <div class="savings-field">
                <span class="savings-field-label">{$t("finance.percent")}</span>
                <input type="number" value={cat.percent} on:input={(e) => { const percent = Math.max(0, Math.min(100, parseFloat(inputVal(e)) || 0)); const amount = clampAmount(Math.round(balance * percent / 100)); updateSavingsCategory(cat.id, { amount, percent }); }} min="0" max="100" class="savings-field-input" />
                <span class="savings-field-unit">%</span>
              </div>
            </div>
            <button class="goal-done-btn" on:click={() => editingSavingsId = null}>✓</button>
          </div>
        {:else}
          <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
          <div class="category-row" role="button" tabindex="0" on:click={() => editingSavingsId = cat.id} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') editingSavingsId = cat.id; }}>
            <span class="cat-icon-display">{cat.icon}</span>
            <span class="cat-name-display">{cat.name}</span>
            <span class="cat-amount-display">{formatMoney(cat.amount)} {$t("locale.currencySymbol")}</span>
            <span class="cat-percent">{cat.percent}%</span>
            <button class="cat-delete" on:click|stopPropagation={() => removeSavingsCategory(cat.id)}>✕</button>
          </div>
        {/if}
      {/each}
    </div>
    <button class="glass-add-btn" on:click={addSavingsCategory}>{$t("finance.addCategory")}</button>
    {#if savingsTotal > balance}
      <div class="glass-warning">
        {$t("finance.overBudget", { amount: formatMoney(savingsTotal - balance), currency: $t("locale.currencySymbol") })}
      </div>
    {/if}
  </div>

  <!-- Блок 5: Правила распределения -->
  <div class="glass-card">
    <div class="glass-card-header">
      <span class="glass-icon">📋</span>
      <h3>{$t("finance.rules")}</h3>
    </div>
    {#if editingRules}
      <textarea
        class="glass-textarea rules"
        bind:value={rulesText}
        placeholder="{$t('finance.rulesPlaceholder')}"
        rows="6"
      ></textarea>
      <div class="rules-actions">
        <button class="rules-save-btn" on:click={saveRules}>{$t("common.save")}</button>
        <button class="rules-cancel-btn" on:click={() => { editingRules = false; rulesText = monthData.distributionRules.join("\n"); }}>{$t("common.cancel")}</button>
      </div>
    {:else}
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <div class="rules-display" role="button" tabindex="0" on:click={startEditRules} on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') startEditRules(); }}>
        {#each monthData.distributionRules as rule, i}
          <div class="rule-item">
            <span class="rule-number">{i + 1}</span>
            <span class="rule-text">{rule}</span>
          </div>
        {/each}
        {#if monthData.distributionRules.length === 0}
          <div class="rules-empty">{$t("finance.rulesHint")}</div>
        {/if}
        <div class="rules-edit-hint">{$t("finance.editHint")}</div>
      </div>
    {/if}
  </div>

  <!-- Блок 6: Управление данными -->
  <div class="glass-card cleanup-card">
    <button class="cleanup-toggle" on:click={() => showCleanup = !showCleanup}>
      <span class="glass-icon">🗑️</span>
      <span>{$t("finance.dataManagement")}</span>
      <span class="cleanup-arrow" class:open={showCleanup}>&#8250;</span>
    </button>
    {#if showCleanup}
      <div class="cleanup-body">
        <div class="cleanup-info">
          {$t("finance.monthsStored")} <strong>{storedKeys.length}</strong>
          {#if oldKeys.length > 0}
            <span class="cleanup-old">({oldKeys.length} {$t("finance.outdated")})</span>
          {/if}
        </div>
        <div class="cleanup-actions">
          <button class="cleanup-btn" on:click={clearCurrentMonth}>{$t("finance.clearMonth")}</button>
          {#if oldKeys.length > 0}
            <button class="cleanup-btn warn" on:click={clearOldMonths}>{$t("finance.deleteOutdated", { count: oldKeys.length })}</button>
          {/if}
          <button class="cleanup-btn danger" on:click={clearAllData}>{$t("finance.deleteAll")}</button>
        </div>
      </div>
    {/if}
  </div>
  {:else}
  <!-- ── Вкладка: Расходы ── -->
  <div class="glass-card expenses-card">
    <div class="glass-card-header">
      <span class="glass-icon">🧾</span>
      <h3>{$t("finance.expensesTitle")}</h3>
      <span class="glass-badge">{formatMoney(expensesTotal)} {$t("locale.currencySymbol")}</span>
    </div>

    <div class="expenses-toolbar">
      {#if ollamaOn}
        <button class="ai-finance-bar-btn expenses-ai-btn" on:click={openExpenseParse}>
          {$t("finance.expensesParseAi")}
        </button>
      {/if}
      <button class="ai-finance-bar-btn manage-cats-btn" on:click={() => showCatManager = !showCatManager}>
        {$t("finance.manageCategories")}
      </button>
    </div>

    {#if showCatManager}
      <div class="cat-manager">
        <div class="cat-manager__list">
          {#each expenseCats as cat (cat.id)}
            {#if editingCatId === cat.id}
              <div class="cat-manager__row editing">
                <input class="cat-manager__icon" type="text" bind:value={editCatIcon} maxlength="4" />
                <input class="cat-manager__name" type="text" bind:value={editCatName} />
                <button class="goal-done-btn" on:click={saveCategoryEdit}>✓</button>
                <button class="cat-delete" on:click={() => (editingCatId = null)}>✕</button>
              </div>
            {:else}
              <div class="cat-manager__row">
                <span class="cat-manager__icon">{cat.icon}</span>
                <span class="cat-manager__name">{cat.name}</span>
                {#if !cat.builtin}
                  <button class="dash-btn dash-btn--sm" on:click={() => startEditCategory(cat)} title={$t("common.edit")}>✎</button>
                  <button class="cat-delete" on:click={() => removeCustomCategory(cat.id)} title={$t("common.delete")}>✕</button>
                {:else}
                  <span class="cat-manager__builtin">★</span>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
        <div class="expense-form">
          <input class="expense-input" type="text" bind:value={newCatIcon} maxlength="4" placeholder="📦" style="max-width:56px;flex:0 0 56px" />
          <input class="expense-input" type="text" bind:value={newCatName} placeholder={$t("finance.expensesCategory")} />
          <button class="expense-add-btn" on:click={addCustomCategory}>{$t("finance.addCategory")}</button>
        </div>
      </div>
    {/if}

    <div class="expense-form">
      <input class="expense-input" type="text" bind:value={newExpenseName} placeholder={$t("finance.expensesName")} />
      <input class="expense-input amount" type="number" min="0" bind:value={newExpenseAmount} placeholder={$t("finance.expensesAmount")} />
      <select class="expense-input" bind:value={newExpenseCategory}>
        {#each expenseCats as cat (cat.id)}
          <option value={cat.name}>{cat.icon} {cat.name}</option>
        {/each}
      </select>
      <input class="expense-input date" type="date" bind:value={newExpenseDate} />
      <button class="expense-add-btn" on:click={addExpenseFromForm}>{$t("finance.expensesAdd")}</button>
    </div>

    <!-- Category chips summary -->
    {#if expenses.length > 0}
      {@const byCat = (() => {
        const map = new Map();
        for (const e of expenses) {
          const key = e.categoryName || "other";
          const prev = map.get(key) || { name: key, icon: e.icon || "📦", amount: 0, count: 0 };
          prev.amount += e.amount || 0;
          prev.count += 1;
          if (e.icon) prev.icon = e.icon;
          map.set(key, prev);
        }
        return [...map.values()].sort((a, b) => b.amount - a.amount);
      })()}
      <div class="expense-chips">
        {#each byCat as chip (chip.name)}
          <div class="expense-chip">
            <span class="expense-chip__icon">{chip.icon}</span>
            <span class="expense-chip__name">{chip.name}</span>
            <span class="expense-chip__amt">{formatMoney(chip.amount)}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="expense-list modern">
      {#if expenses.length === 0}
        <div class="expense-empty">
          <span class="expense-empty__icon">🧾</span>
          <div class="expense-empty__text">{$t("finance.expensesEmpty")}</div>
        </div>
      {:else}
        {#each expenses as exp (exp.id)}
          {#if editingExpenseId === exp.id}
            <div class="expense-card editing">
              <input class="expense-input" type="text" bind:value={editExpenseName} placeholder={$t("finance.expensesName")} style="flex:2" />
              <input class="expense-input amount" type="number" min="0" bind:value={editExpenseAmount} />
              <select class="expense-input" bind:value={editExpenseCategory}>
                {#each expenseCats as cat (cat.id)}
                  <option value={cat.name}>{cat.icon} {cat.name}</option>
                {/each}
              </select>
              <input class="expense-input date" type="date" bind:value={editExpenseDate} />
              <button class="expense-save-btn" on:click={saveExpenseEdit} title={$t("common.save")}>✓</button>
              <button class="expense-del-btn" on:click={cancelExpenseEdit} title={$t("common.cancel")}>✕</button>
            </div>
          {:else}
            <div
              class="expense-card"
              role="button"
              tabindex="0"
              on:click={() => startEditExpense(exp)}
              on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") startEditExpense(exp); }}
            >
              <span class="expense-card__icon">{exp.icon || "💸"}</span>
              <div class="expense-card__body">
                <span class="expense-card__name">{exp.name}</span>
                <div class="expense-card__meta">
                  {#if exp.categoryName}<span class="expense-card__cat">{exp.categoryName}</span>{/if}
                  <span class="expense-card__date">{exp.date}</span>
                </div>
              </div>
              <span class="expense-card__amt">{formatMoney(exp.amount)} {$t("locale.currencySymbol")}</span>
              <div class="expense-card__actions">
                <button class="expense-edit-btn" on:click|stopPropagation={() => startEditExpense(exp)} title={$t("common.edit")}>✎</button>
                <button class="expense-del-btn" on:click|stopPropagation={() => removeExpenseEntry(exp.id)} title={$t("finance.expensesDelete")}>✕</button>
              </div>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </div>
  {/if}
</div>

<style>
  .finance-tracker {
    --fi-bg: transparent;
    --fi-surface: var(--mcp-glass-bg, rgba(35, 40, 55, 0.4));
    --fi-surface-hover: var(--mcp-glass-highlight, rgba(255, 255, 255, 0.02));
    --fi-border: var(--mcp-glass-border, rgba(255, 255, 255, 0.04));
    --fi-border-focus: var(--mcp-accent, rgba(95, 153, 225, 0.479));
    --fi-muted: var(--text-muted);
    --fi-text: var(--text-normal);
    --fi-accent: var(--interactive-accent);
    --fi-green: var(--mcp-success, rgba(80, 200, 160, 0.8));
    --fi-green-bg: rgba(80, 200, 160, 0.1);
    --fi-red: var(--mcp-danger, rgba(220, 150, 150, 0.8));
    --fi-red-bg: rgba(220, 150, 150, 0.1);
    --fi-amber: var(--mcp-warning, rgba(220, 190, 130, 0.8));
    --fi-amber-bg: rgba(220, 190, 130, 0.1);
    --fi-radius: var(--mcp-radius, 14px);
    --fi-radius-sm: var(--mcp-radius-sm, 10px);
    --fi-blur: var(--mcp-blur, blur(20px));
    --fi-shadow: var(--mcp-shadow, 0 8px 32px rgba(0, 0, 0, 0.15));
    --fi-shadow-glow: var(--mcp-shadow-glow, 0 0 40px rgba(80, 170, 210, 0.06));

    padding: 20px 16px 36px;
    height: 100%;
    overflow-y: auto;
    background: var(--fi-bg);
    color: var(--fi-text);
    max-width: 1080px;
    margin: 0 auto;
  }

  /* ── Top bar: month + tabs ───────────────────────────── */
  .fin-topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
    margin-bottom: 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--fi-border);
  }

  .fin-title {
    margin: 0;
    flex: 1;
    min-width: 160px;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--fi-text);
    text-align: left;
  }

  .fin-tabs {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: var(--fi-surface);
    border: 1px solid var(--fi-border);
  }

  .fin-tab {
    padding: 7px 16px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--fi-muted);
    font-size: 12.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  }

  .fin-tab:hover { color: var(--fi-text); }

  .fin-tab.is-active {
    background: var(--fi-accent);
    color: var(--text-on-accent, #fff);
    box-shadow: 0 2px 10px color-mix(in srgb, var(--fi-accent) 35%, transparent);
  }

  /* ── Month navigator ─────────────────────────────────── */
  .month-selector {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .month-nav-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--fi-border);
    border-radius: 10px;
    background: var(--fi-surface);
    backdrop-filter: var(--fi-blur);
    -webkit-backdrop-filter: var(--fi-blur);
    color: var(--fi-muted);
    cursor: pointer;
    font-size: 18px;
    padding: 0;
    transition: all 0.2s ease;
  }

  .month-nav-btn:hover {
    background: var(--fi-surface-hover);
    color: var(--fi-text);
    border-color: var(--fi-accent);
    transform: translateY(-1px);
  }

  :global(.month-display) {
    min-width: 180px;
    text-align: center;
    font-size: 14px;
    font-weight: 600;
    color: var(--fi-text);
  }

  .month-select {
    border-radius: 10px;
    border: 1px solid var(--fi-border);
    background: var(--fi-surface);
    backdrop-filter: var(--fi-blur);
    -webkit-backdrop-filter: var(--fi-blur);
    color: var(--fi-text);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    min-width: 150px;
    text-align: center;
    cursor: pointer;
    padding: 7px 10px;
    transition: all 0.2s ease;
  }

  .month-select:focus {
    border-color: var(--fi-accent);
    outline: none;
    box-shadow: 0 0 0 3px var(--mcp-accent-faint);
  }

  .month-select:hover {
    border-color: var(--fi-accent);
  }

  /* ── Expense form ────────────────────────────────────── */
  .expense-form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }

  .expense-input {
    flex: 1;
    min-width: 110px;
    padding: 0 12px;
    font-size: 12.5px;
    font-family: inherit;
    border: 1px solid var(--fi-border);
    border-radius: 12px;
    background: var(--background-primary);
    color: var(--fi-text);
    height: 36px;
    box-sizing: border-box;
    appearance: none;
    -webkit-appearance: none;
    outline: none;
  }

  select.expense-input {
    padding-right: 28px;
    background-image: linear-gradient(45deg, transparent 50%, var(--fi-muted) 50%),
      linear-gradient(135deg, var(--fi-muted) 50%, transparent 50%);
    background-position: calc(100% - 16px) 50%, calc(100% - 11px) 50%;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
    cursor: pointer;
  }

  select.expense-input option {
    background: var(--background-primary);
    color: var(--fi-text);
  }

  .expense-input.amount { max-width: 110px; flex: 0 0 110px; }
  .expense-input.date { max-width: 140px; flex: 0 0 140px; }

  .expense-input:focus {
    outline: none;
    border-color: var(--fi-accent);
  }

  .expense-add-btn {
    padding: 8px 14px;
    border: none;
    border-radius: 10px;
    background: var(--fi-accent);
    color: var(--text-on-accent, #fff);
    font-size: 12.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .expense-add-btn:hover { filter: brightness(1.08); }

  .expenses-ai-btn,
  .manage-cats-btn {
    margin: 4px 0 8px;
  }

  /* Modern expense list */
  .expense-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 4px 0 12px;
  }

  .expense-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--fi-border);
    font-size: 11.5px;
    font-weight: 600;
  }

  .expense-chip__icon { font-size: 13px; line-height: 1; }
  .expense-chip__name { color: var(--fi-muted); }
  .expense-chip__amt {
    font-variant-numeric: tabular-nums;
    color: var(--fi-text);
  }

  .expense-list.modern {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .expense-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--fi-border);
    background: linear-gradient(160deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.01));
    cursor: pointer;
    transition: border-color 0.15s, transform 0.12s, box-shadow 0.15s;
  }

  .expense-card:hover {
    border-color: color-mix(in srgb, var(--fi-accent) 28%, var(--fi-border));
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }

  .expense-card.editing {
    flex-wrap: wrap;
    cursor: default;
  }

  .expense-card__icon {
    width: 36px;
    height: 36px;
    border-radius: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 17px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--fi-border);
    flex-shrink: 0;
  }

  .expense-card__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .expense-card__name {
    font-size: 13px;
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .expense-card__meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .expense-card__cat {
    font-size: 10px;
    font-weight: 650;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fi-accent) 12%, transparent);
    color: var(--fi-accent);
  }

  .expense-card__date {
    font-size: 11px;
    color: var(--fi-muted);
    font-variant-numeric: tabular-nums;
  }

  .expense-card__amt {
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .expense-card__actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }

  .expense-card:hover .expense-card__actions { opacity: 1; }

  .expense-edit-btn,
  .expense-del-btn,
  .expense-save-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--fi-muted);
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .expense-edit-btn:hover { background: rgba(255, 255, 255, 0.08); color: var(--fi-text); }
  .expense-del-btn:hover { background: color-mix(in srgb, var(--fi-red) 15%, transparent); color: var(--fi-red); }
  .expense-save-btn { background: var(--fi-accent); color: #fff; }

  .expense-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 32px 16px;
    border: 1px dashed var(--fi-border);
    border-radius: 14px;
    color: var(--fi-muted);
  }

  .expense-empty__icon { font-size: 28px; opacity: 0.5; }
  .expense-empty__text { font-size: 13px; }

  .expenses-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 6px 0 10px;
  }

  .cat-manager {
    border: 1px solid var(--fi-border);
    border-radius: var(--fi-radius-sm);
    padding: 10px;
    margin-bottom: 12px;
    background: color-mix(in srgb, var(--fi-surface) 80%, transparent);
  }

  .cat-manager__list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }

  .cat-manager__row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px;
    border-radius: 8px;
    font-size: 12.5px;
  }

  .cat-manager__row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .cat-manager__icon {
    width: 28px;
    text-align: center;
    flex-shrink: 0;
  }

  .cat-manager__name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: transparent;
    border: none;
    color: var(--fi-text);
    font-family: inherit;
    font-size: 12.5px;
  }

  .cat-manager__row.editing .cat-manager__name {
    border: 1px solid var(--fi-border);
    border-radius: 6px;
    padding: 4px 8px;
    background: var(--background-primary);
  }

  .cat-manager__builtin {
    font-size: 10px;
    color: var(--fi-muted);
    opacity: 0.5;
    width: 24px;
    text-align: center;
  }

  /* ── Duplicate button ────────────────────────────────── */
  .dup-btn {
    display: block;
    margin: 0 auto 18px;
    border: 1px solid var(--fi-border);
    border-radius: 10px;
    background: var(--fi-surface);
    backdrop-filter: var(--fi-blur);
    -webkit-backdrop-filter: var(--fi-blur);
    color: var(--fi-accent);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    padding: 8px 14px;
    transition: all 0.2s ease;
  }

  .dup-btn:hover {
    background: var(--fi-surface-hover);
    border-color: var(--fi-accent);
    transform: translateY(-1px);
  }

  /* ── Glass card ──────────────────────────────────────── */
  .glass-card {
    background:
      linear-gradient(160deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.01)),
      var(--fi-surface);
    backdrop-filter: var(--fi-blur);
    -webkit-backdrop-filter: var(--fi-blur);
    border: 1px solid var(--fi-border);
    border-radius: var(--fi-radius);
    padding: 18px 18px 16px;
    margin-bottom: 14px;
    box-shadow: var(--fi-shadow), var(--fi-shadow-glow);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .glass-card:hover {
    border-color: color-mix(in srgb, var(--fi-accent) 18%, var(--fi-border));
    box-shadow: var(--fi-shadow), 0 0 0 1px color-mix(in srgb, var(--fi-accent) 10%, transparent);
  }

  .glass-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--fi-border);
  }

  .glass-icon {
    font-size: 18px;
    opacity: 0.9;
  }

  .glass-card-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--fi-text);
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.85;
  }

  .glass-badge {
    font-size: 13px;
    font-weight: 600;
    color: var(--fi-accent);
    background: var(--fi-surface-hover);
    padding: 4px 12px;
    border-radius: var(--fi-radius-sm);
    letter-spacing: -0.01em;
  }

  .glass-badge.badge-warn {
    color: var(--fi-red);
    background: var(--fi-red-bg);
  }

  /* ── Income toggle ───────────────────────────────────── */
  .income-toggle {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    background: var(--fi-surface-hover);
    border-radius: var(--fi-radius-sm);
    padding: 4px;
  }

  .toggle-btn {
    flex: 1;
    padding: 9px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--fi-muted);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.2s ease;
  }

  .toggle-btn.active {
    background: var(--fi-accent);
    color: var(--text-on-accent, #fff);
    box-shadow: 0 2px 8px var(--fi-accent);
  }

  .toggle-btn:hover:not(.active) {
    color: var(--fi-text);
    background: rgba(255, 255, 255, 0.04);
  }

  .income-input {
    color: var(--fi-green) !important;
    font-weight: 700 !important;
  }

  /* ── Balance grid ────────────────────────────────────── */
  .balance-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }

  .balance-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 10px;
    background: var(--fi-surface-hover);
    border-radius: var(--fi-radius-sm);
    border: 1px solid var(--fi-border);
    transition: all 0.2s ease;
  }

  .balance-item:hover {
    transform: translateY(-2px);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .balance-item.total {
    border-color: rgba(255, 255, 255, 0.08);
    background: linear-gradient(135deg, rgba(80, 200, 160, 0.08), var(--mcp-accent-ultra-dim));
  }

  .balance-label {
    font-size: 10px;
    color: var(--fi-muted);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 8px;
    font-weight: 500;
  }

  .balance-value {
    font-size: 18px;
    font-weight: 700;
    color: var(--fi-text);
    letter-spacing: -0.02em;
  }

  .balance-value.income { color: var(--fi-green); }
  .balance-value.expense { color: var(--fi-red); }

  .balance-delta {
    font-size: 10px;
    font-weight: 500;
    margin-top: 6px;
  }

  .delta-up { color: var(--fi-green); }
  .delta-down { color: var(--fi-red); }

  .balance-input {
    width: 100%;
    text-align: center;
    padding: 8px;
    border: 1px solid var(--fi-border);
    border-radius: var(--fi-radius-sm);
    background: var(--background-primary);
    color: var(--fi-text);
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    transition: all 0.2s ease;
  }

  .balance-input:focus {
    border-color: var(--fi-accent);
    outline: none;
    box-shadow: 0 0 0 3px var(--mcp-accent-faint);
  }

  /* ── Categories list ─────────────────────────────────── */
  .categories-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .category-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--fi-surface-hover);
    border-radius: var(--fi-radius-sm);
    border: 1px solid var(--fi-border);
    transition: all 0.2s ease;
  }

  .category-row:hover {
    border-color: rgba(255, 255, 255, 0.08);
    transform: translateY(-1px);
  }

  .cat-icon-display {
    font-size: 16px;
    width: 24px;
    text-align: center;
    flex-shrink: 0;
  }

  .cat-name-display {
    flex: 1;
    font-size: 13px;
    color: var(--fi-text);
  }

  .cat-amount-display {
    font-size: 13px;
    font-weight: 600;
    color: var(--fi-text);
    letter-spacing: -0.01em;
  }

  .cat-percent {
    font-size: 11px;
    font-weight: 600;
    color: var(--fi-muted);
    min-width: 36px;
    text-align: right;
  }

  :global(.cat-check) {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid var(--fi-green);
    background: transparent;
    color: var(--fi-green);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    transition: all 0.2s ease;
    flex-shrink: 0;
    opacity: 0.5;
  }

  :global(.cat-check:hover) {
    opacity: 1;
    transform: scale(1.1);
  }

  :global(.cat-check.completed) {
    background: var(--fi-green);
    border-color: var(--fi-green);
    color: #fff;
    opacity: 1;
  }

  .savings-edit-fields {
    display: flex;
    gap: 12px;
    flex: 1;
  }

  .savings-field {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
  }

  .savings-field-label {
    font-size: 10px;
    color: var(--fi-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    min-width: 50px;
  }

  .savings-field-input {
    width: 80px;
    padding: 6px 8px;
    border: 1px solid var(--fi-border);
    border-radius: 6px;
    background: var(--background-primary);
    color: var(--fi-text);
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    text-align: right;
    transition: all 0.2s ease;
  }

  .savings-field-input:focus {
    border-color: var(--fi-accent);
    outline: none;
    box-shadow: 0 0 0 2px var(--mcp-accent-faint);
  }

  .savings-field-unit {
    font-size: 12px;
    color: var(--fi-muted);
    font-weight: 500;
  }

  .cat-delete {
    background: none;
    border: none;
    color: var(--fi-muted);
    cursor: pointer;
    padding: 6px 8px;
    font-size: 12px;
    border-radius: var(--fi-radius-sm);
    opacity: 0.4;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .category-row:hover .cat-delete {
    opacity: 1;
  }

  .cat-delete:hover {
    color: var(--fi-red);
    background: var(--fi-red-bg);
  }

  /* ── Inline edit ─────────────────────────────────────── */
  .category-row.editing,
  .goal-row.editing {
    background: var(--background-primary);
    border-color: var(--fi-accent);
  }

  .cat-edit-icon,
  .goal-edit-icon {
    width: 38px;
    text-align: center;
    font-size: 16px;
    padding: 6px 4px;
    border: 1px solid var(--fi-border);
    border-radius: 8px;
    background: var(--fi-surface-hover);
    color: var(--fi-text);
  }

  .cat-edit-name,
  .goal-edit-name {
    flex: 1;
    padding: 7px 10px;
    border: 1px solid var(--fi-border);
    border-radius: 8px;
    background: var(--fi-surface-hover);
    color: var(--fi-text);
    font-size: 12.5px;
    font-family: inherit;
  }

  .cat-edit-amount,
  .goal-edit-amount {
    width: 100px;
    text-align: right;
    padding: 7px 10px;
    border: 1px solid var(--fi-border);
    border-radius: 8px;
    background: var(--fi-surface-hover);
    color: var(--fi-text);
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
  }

  .cat-edit-icon:focus,
  .cat-edit-name:focus,
  .cat-edit-amount:focus,
  .goal-edit-icon:focus,
  .goal-edit-name:focus,
  .goal-edit-amount:focus {
    border-color: var(--fi-accent);
    outline: none;
    box-shadow: 0 0 0 3px var(--mcp-accent-faint);
  }

  .goal-edit-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .goal-edit-sep {
    color: var(--fi-muted);
    font-size: 13px;
  }

  .goal-done-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--fi-green);
    background: var(--fi-green);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }

  .goal-done-btn:hover {
    transform: scale(1.1);
    box-shadow: 0 0 8px var(--fi-green);
  }

  /* ── Goals ───────────────────────────────────────────── */
  .goals-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .goal-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--fi-surface-hover);
    border-radius: var(--fi-radius-sm);
    border: 1px solid var(--fi-border);
    transition: all 0.2s ease;
  }

  .goal-row:hover {
    border-color: rgba(255, 255, 255, 0.08);
    transform: translateY(-1px);
  }

  .goal-icon {
    font-size: 18px;
    flex-shrink: 0;
  }

  .goal-info {
    flex: 1;
    min-width: 0;
  }

  .goal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }

  .goal-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--fi-text);
  }

  .goal-amounts {
    font-size: 11px;
    color: var(--fi-muted);
    white-space: nowrap;
  }

  .goal-progress-bar {
    width: 100%;
    height: 6px;
    background: var(--fi-border);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 4px;
  }

  .goal-progress-fill {
    height: 100%;
    background: var(--fi-accent);
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  .goal-percent {
    font-size: 11px;
    color: var(--fi-muted);
  }

  .goal-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .goal-month-add {
    font-size: 10px;
    font-weight: 600;
    color: var(--fi-green);
    background: color-mix(in srgb, var(--fi-green) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--fi-green) 25%, transparent);
    padding: 1px 6px;
    border-radius: 999px;
  }

  .goal-brought {
    font-size: 10px;
    font-weight: 600;
    color: var(--fi-muted);
    background: var(--fi-border);
    padding: 1px 6px;
    border-radius: 999px;
  }

  .goal-adjust {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;
  }

  .goal-adjust-mode {
    display: inline-flex;
    border: 1px solid var(--fi-border);
    border-radius: var(--fi-radius-sm);
    overflow: hidden;
    flex-shrink: 0;
  }

  .goal-adjust-mode-btn {
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 600;
    border: none;
    background: transparent;
    color: var(--fi-muted);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .goal-adjust-mode-btn + .goal-adjust-mode-btn {
    border-left: 1px solid var(--fi-border);
  }

  .goal-adjust-mode-btn.active {
    background: var(--fi-accent);
    color: var(--text-on-accent, #fff);
  }

  .goal-adjust-input {
    width: 72px;
    padding: 5px 8px;
    font-size: 12px;
    border: 1px solid var(--fi-border);
    border-radius: var(--fi-radius-sm);
    background: var(--background-primary);
    color: var(--fi-text);
  }

  .goal-adjust-input:focus {
    outline: none;
    border-color: var(--fi-accent);
  }

  .goal-adjust-btn {
    padding: 5px 10px;
    font-size: 11px;
    font-weight: 600;
    border-radius: var(--fi-radius-sm);
    border: 1px solid transparent;
    cursor: pointer;
    transition: filter 0.15s, transform 0.12s;
    white-space: nowrap;
  }

  .goal-adjust-btn:active {
    transform: scale(0.97);
  }

  .goal-adjust-btn.deposit {
    background: color-mix(in srgb, var(--fi-green) 16%, transparent);
    color: var(--fi-green);
    border-color: color-mix(in srgb, var(--fi-green) 30%, transparent);
  }

  .goal-adjust-btn.deposit:hover {
    filter: brightness(1.1);
  }

  .goal-adjust-btn.withdraw {
    background: color-mix(in srgb, var(--fi-red, #e74c3c) 12%, transparent);
    color: var(--fi-red, #e74c3c);
    border-color: color-mix(in srgb, var(--fi-red, #e74c3c) 28%, transparent);
  }

  .goal-adjust-btn.withdraw:hover {
    filter: brightness(1.1);
  }

  .goal-complete {
    opacity: 0.75;
  }

  .goal-progress-fill.complete {
    background: var(--fi-green);
  }

  /* ── Add button ──────────────────────────────────────── */
  .glass-add-btn {
    display: block;
    width: 100%;
    margin-top: 10px;
    padding: 9px;
    background: transparent;
    border: 1px dashed var(--fi-border);
    border-radius: var(--fi-radius-sm);
    color: var(--fi-muted);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.2s ease;
  }

  .glass-add-btn:hover {
    border-color: var(--fi-accent);
    color: var(--fi-accent);
    background: var(--mcp-accent-ultra-dim);
    transform: translateY(-1px);
  }

  /* ── Rules ────────────────────────────────────────────── */
  .glass-textarea {
    width: 100%;
    padding: 12px 14px;
    border: 1px solid var(--fi-border);
    border-radius: var(--fi-radius-sm);
    background: var(--background-primary);
    color: var(--fi-text);
    font-size: 12.5px;
    font-family: inherit;
    resize: vertical;
    line-height: 1.6;
    transition: all 0.2s ease;
  }

  .glass-textarea:focus {
    border-color: var(--fi-accent);
    outline: none;
    box-shadow: 0 0 0 3px var(--mcp-accent-faint);
  }

  .glass-textarea.rules {
    white-space: pre-wrap;
    line-height: 1.8;
  }

  .rules-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }

  .rules-save-btn {
    flex: 1;
    padding: 8px 16px;
    border: none;
    border-radius: var(--fi-radius-sm);
    background: var(--fi-accent);
    color: var(--text-on-accent, #fff);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    transition: all 0.2s ease;
  }

  .rules-save-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px var(--fi-accent);
  }

  .rules-cancel-btn {
    padding: 8px 16px;
    border: 1px solid var(--fi-border);
    border-radius: var(--fi-radius-sm);
    background: transparent;
    color: var(--fi-muted);
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    transition: all 0.2s ease;
  }

  .rules-cancel-btn:hover {
    color: var(--fi-text);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .rules-display {
    cursor: pointer;
    padding: 4px 0;
    transition: opacity 0.2s ease;
  }

  .rules-display:hover {
    opacity: 0.8;
  }

  .rule-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 0;
  }

  .rule-number {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--fi-accent);
    color: var(--text-on-accent, #fff);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .rule-text {
    font-size: 12.5px;
    color: var(--fi-text);
    line-height: 1.5;
    padding-top: 2px;
  }

  .rules-empty {
    text-align: center;
    padding: 16px;
    color: var(--fi-muted);
    font-size: 12px;
  }

  .rules-edit-hint {
    text-align: center;
    padding: 10px 0 4px;
    color: var(--fi-muted);
    font-size: 11px;
    opacity: 0.6;
  }

  .rules-display:hover .rules-edit-hint {
    opacity: 1;
    color: var(--fi-accent);
  }

  /* ── Warning ─────────────────────────────────────────── */
  .glass-warning {
    margin-top: 10px;
    padding: 10px 14px;
    background: var(--fi-amber-bg);
    border: 1px solid rgba(220, 190, 130, 0.2);
    border-radius: var(--fi-radius-sm);
    color: var(--fi-amber);
    font-size: 12px;
    font-weight: 500;
  }

  .over-budget {
    border-color: rgba(220, 150, 150, 0.25);
  }

  /* ── Cleanup ─────────────────────────────────────────── */
  .cleanup-card {
    padding: 0;
    overflow: hidden;
  }

  .cleanup-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 14px 18px;
    background: none;
    border: none;
    color: var(--fi-muted);
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    transition: color 0.2s ease;
  }

  .cleanup-toggle:hover {
    color: var(--fi-text);
  }

  .cleanup-arrow {
    margin-left: auto;
    font-size: 16px;
    transition: transform 0.2s ease;
  }

  .cleanup-arrow.open {
    transform: rotate(90deg);
  }

  .cleanup-body {
    padding: 0 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cleanup-info {
    font-size: 12px;
    color: var(--fi-muted);
  }

  .cleanup-old {
    color: var(--fi-amber);
  }

  .cleanup-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .cleanup-btn {
    padding: 9px 14px;
    border: 1px solid var(--fi-border);
    border-radius: var(--fi-radius-sm);
    background: var(--fi-surface-hover);
    color: var(--fi-text);
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    text-align: left;
    transition: all 0.2s ease;
  }

  .cleanup-btn:hover {
    transform: translateY(-1px);
  }

  .cleanup-btn.warn {
    color: var(--fi-amber);
    border-color: rgba(220, 190, 130, 0.25);
  }

  .cleanup-btn.warn:hover {
    background: var(--fi-amber-bg);
  }

  .cleanup-btn.danger {
    color: var(--fi-red);
    border-color: rgba(220, 150, 150, 0.25);
  }

  .cleanup-btn.danger:hover {
    background: var(--fi-red-bg);
  }

  /* ── Mobile ──────────────────────────────────────────── */
  @media (max-width: 768px) {
    .finance-tracker {
      padding: 16px 12px 28px;
    }

    .balance-grid {
      grid-template-columns: 1fr;
    }

    .balance-value {
      font-size: 16px;
    }

    .goal-header {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
