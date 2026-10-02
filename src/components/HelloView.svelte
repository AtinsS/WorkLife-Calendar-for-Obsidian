<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import moment from "moment";
  import type { App } from "obsidian";
  import { settings } from "../ui/stores";
  import { fetchWeekWeather, type DayWeather } from "../services/weatherService";
  import { t, tArray } from "../i18n";
  import { weightData } from "../weight/stores";
  import { latestWeight } from "../weight/stats";
  import { WeightEntryModal } from "../weight/WeightEntryModal";

  export let appInstance: App;
  export let onOpenTasks: (() => void) | undefined = undefined;
  export let onOpenAnalytics: (() => void) | undefined = undefined;
  export let onOpenFinance: (() => void) | undefined = undefined;
  export let onOpenSchedule: (() => void) | undefined = undefined;

  let now = moment();
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let weatherTimer: ReturnType<typeof setInterval> | null = null;
  let weather: DayWeather | null = null;

  // Note search
  let noteSearchQuery = "";
  let noteSearchResults: { path: string; name: string }[] = [];
  let searchInputEl: HTMLInputElement | null = null;
  let searchDropdown: HTMLDivElement | null = null;

  function searchNotes() {
    const q = noteSearchQuery.trim().toLowerCase();
    if (!q) {
      noteSearchResults = [];
      removeSearchDropdown();
      return;
    }
    const files = appInstance.vault.getMarkdownFiles();
    noteSearchResults = files
      .filter((f) => {
        const name = f.basename.toLowerCase();
        const path = f.path.toLowerCase();
        return name.includes(q) || path.includes(q);
      })
      .slice(0, 15)
      .map((f) => ({ path: f.path, name: f.basename }));
    renderSearchDropdown();
  }

  function removeSearchDropdown() {
    if (searchDropdown) {
      searchDropdown.remove();
      searchDropdown = null;
    }
  }

  function renderSearchDropdown() {
    removeSearchDropdown();
    if (!searchInputEl || noteSearchResults.length === 0) return;

    const dropdown = document.createElement("div");
    dropdown.className = "hello-search-portal";

    for (const r of noteSearchResults) {
      const btn = document.createElement("button");
      btn.className = "hello-search-portal__item";
      const nameEl = document.createElement("span");
      nameEl.className = "hello-search-portal__name";
      nameEl.textContent = r.name;
      const pathEl = document.createElement("span");
      pathEl.className = "hello-search-portal__path";
      pathEl.textContent = r.path;
      btn.appendChild(nameEl);
      btn.appendChild(pathEl);
      btn.addEventListener("click", () => {
        openNote(r.path);
        removeSearchDropdown();
        noteSearchQuery = "";
        noteSearchResults = [];
      });
      dropdown.appendChild(btn);
    }

    document.body.appendChild(dropdown);
    searchDropdown = dropdown;

    const rect = searchInputEl.getBoundingClientRect();
    const ddWidth = Math.min(rect.width, 420);
    let left = rect.left + rect.width / 2 - ddWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - ddWidth - 8));
    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.width = `${ddWidth}px`;
  }

  function openNote(path: string) {
    appInstance.workspace.openLinkText(path, "", true);
  }

  onMount(() => {
    clockTimer = setInterval(() => { now = moment(); }, 60_000);
    loadWeather();
    // Refresh weather every 30 minutes
    weatherTimer = setInterval(() => { loadWeather(); }, 30 * 60_000);
    // Close search dropdown on outside click
    document.addEventListener("mousedown", onDocumentClick);
  });

  function onDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (searchDropdown && !searchDropdown.contains(target) && target !== searchInputEl) {
      removeSearchDropdown();
    }
  }

  onDestroy(() => {
    if (clockTimer) clearInterval(clockTimer);
    if (weatherTimer) clearInterval(weatherTimer);
    removeSearchDropdown();
    document.removeEventListener("mousedown", onDocumentClick);
  });

  async function loadWeather() {
    const lat = $settings.weatherLatitude;
    const lon = $settings.weatherLongitude;
    if (lat && lon) {
      try {
        const start = moment().format("YYYY-MM-DD");
        const end = moment().add(1, "day").format("YYYY-MM-DD");
        const data = await fetchWeekWeather(lat, lon, start, end, $settings.weatherProvider as any, $settings.weatherApiKey);
        const today = data.find(d => d.date === start);
        if (today) weather = today;
      } catch {}
    }
  }

  $: userName = $settings.userName || "";
  $: showTasksBtn = $settings.helloShowTasksBtn !== false;
  $: showAnalyticsBtn = $settings.helloShowAnalyticsBtn !== false;
  $: showFinanceBtn = $settings.helloShowFinanceBtn !== false;
  $: showScheduleBtn = $settings.helloShowScheduleBtn !== false;
  $: showSearch = $settings.helloShowSearch !== false;
  $: showWeightInput =
    $settings.weightControlEnabled !== false && $settings.helloShowWeight !== false;
  $: currentWeight = latestWeight($weightData?.entries || []);
  $: weightLabel = currentWeight
    ? `${currentWeight.weight.toFixed(1).replace(/\.0$/, "")} ${$t("weight.unit")}`
    : $t("weight.quickTitle");

  function openWeightModal() {
    new WeightEntryModal(appInstance, currentWeight ? String(currentWeight.weight) : "").open();
  }
  $: hour = now.hour();
  $: greetingText = hour < 6 ? $t("hello.goodNight") : hour < 12 ? $t("hello.goodMorning") : hour < 18 ? $t("hello.goodAfternoon") : $t("hello.goodEvening");
  $: greeting = userName ? `${greetingText}, ${userName}` : greetingText;
  $: greetingEmoji = hour < 6 ? "🌙" : hour < 12 ? "☀️" : hour < 18 ? "🌤" : "🌆";
  $: monthNames = $tArray("common.months.genitive");
  $: dayNames = $tArray("common.weekdays.long");
  $: monthName = monthNames[now.month()] || "";
  $: year = now.format("YYYY");
  $: dateDisplay = `${now.date()} ${monthName} ${year}, ${dayNames[now.day()] || ""}`;

  // Time-of-day theme
  $: timeTheme = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "day" : "evening";

  // Weather animation class
  $: weatherAnim = (() => {
    if (!weather) return "";
    const code = weather.weatherCode;
    // Clear: 0
    if (code === 0) return "weather-sun";
    // Mainly clear / partly cloudy: 1
    if (code === 1) return "weather-partly";
    // Snow: 71-77, 85-86
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "weather-snow";
    // Rain: 51-67, 80-82
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "weather-rain";
    // Cloudy: 2
    if (code === 2) return "weather-clouds";
    // Fog: 45, 48
    if (code === 45 || code === 48) return "weather-fog";
    // Overcast: 3
    if (code === 3) return "weather-gloom";
    // Thunderstorm: 95-99
    if (code >= 95) return "weather-storm";
    return "";
  })();

</script>

<div class="hello hello--{timeTheme}">
  <!-- Weather animation layer -->
  {#if weatherAnim}
    <div class="hello-weather {weatherAnim}">
      {#if weatherAnim === "weather-rain"}
        {#each Array(40) as _, __}
          <div class="raindrop" style="left: {Math.random() * 100}%; animation-delay: {Math.random() * 2}s; animation-duration: {0.5 + Math.random() * 0.5}s"></div>
        {/each}
      {:else if weatherAnim === "weather-partly"}
        <div class="sun sun--minimal">
          <div class="sun-core"></div>
        </div>
        {#each Array(3) as _, i}
          <div class="cloud" style="top: {18 + i * 22}%; animation-delay: {i * 4}s; opacity: {0.12 + Math.random() * 0.12}"></div>
        {/each}
      {:else if weatherAnim === "weather-clouds"}
        {#each Array(5) as _, i}
          <div class="cloud" style="top: {10 + i * 15}%; animation-delay: {i * 3}s; opacity: {0.15 + Math.random() * 0.2}"></div>
        {/each}
      {:else if weatherAnim === "weather-fog"}
        {#each Array(6) as _, i}
          <div class="fog-layer" style="top: {15 + i * 12}%; animation-delay: {i * 2.5}s; animation-duration: {18 + i * 4}s; opacity: {0.08 + i * 0.03}"></div>
        {/each}
      {:else if weatherAnim === "weather-gloom"}
        <div class="gloom-overlay"></div>
      {:else if weatherAnim === "weather-storm"}
        {#each Array(60) as _, __}
          <div class="raindrop heavy" style="left: {Math.random() * 100}%; animation-delay: {Math.random() * 1.5}s; animation-duration: {0.3 + Math.random() * 0.4}s"></div>
        {/each}
      {:else if weatherAnim === "weather-snow"}
        {#each Array(50) as _, __}
          <div class="snowflake" style="left: {Math.random() * 100}%; animation-delay: {Math.random() * 5}s; animation-duration: {3 + Math.random() * 4}s; font-size: {8 + Math.random() * 10}px; opacity: {0.4 + Math.random() * 0.4}">*</div>
        {/each}
      {:else if weatherAnim === "weather-sun"}
        <div class="sun sun--minimal">
          <div class="sun-core"></div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Hero -->
  <div class="hello-hero">
    <h1 class="hello-title">{greeting} <span class="hello-emoji">{greetingEmoji}</span></h1>
    <p class="hello-date">{dateDisplay}</p>
    {#if weather}
      <div class="hello-weather-card" title={weather.label}>
        <span class="hello-weather-card__icon" aria-hidden="true">{weather.icon}</span>
        <span class="hello-weather-card__temp">{weather.tempMin}…{weather.tempMax}°</span>
        <span class="hello-weather-card__label">{weather.label}</span>
      </div>
    {/if}
  </div>

  <!-- Search + weight -->
  <div class="hello-toolbar">
    {#if showSearch}
      <div class="hello-search">
        <svg class="hello-search__icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input
          class="hello-search__input"
          type="text"
          placeholder={$t("hello.searchPlaceholder")}
          bind:value={noteSearchQuery}
          bind:this={searchInputEl}
          on:input={searchNotes}
        />
      </div>
    {/if}

    {#if showWeightInput}
      <button class="hello-weight-btn" on:click={openWeightModal} title={$t("weight.quickTitle")}>
        <span class="hello-weight-btn__icon">⚖️</span>
        <span class="hello-weight-btn__value">{weightLabel}</span>
      </button>
    {/if}
  </div>

  <!-- Nav -->
  <div class="hello-nav">
    {#if showTasksBtn}
      <button class="hello-nav-btn" on:click={onOpenTasks}>
        <span class="hello-nav-icon">✅</span>
        <span>{$t("hello.navTasks")}</span>
      </button>
    {/if}
    {#if showAnalyticsBtn}
      <button class="hello-nav-btn" on:click={onOpenAnalytics}>
        <span class="hello-nav-icon">📊</span>
        <span>{$t("hello.navAnalytics")}</span>
      </button>
    {/if}
    {#if showFinanceBtn}
      <button class="hello-nav-btn" on:click={onOpenFinance}>
        <span class="hello-nav-icon">💰</span>
        <span>{$t("hello.navFinance")}</span>
      </button>
    {/if}
    {#if showScheduleBtn}
      <button class="hello-nav-btn" on:click={onOpenSchedule}>
        <span class="hello-nav-icon">📅</span>
        <span>{$t("hello.navSchedule")}</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .hello {
    margin: 0 auto;
    color: var(--text-normal, #e8ecf0);
    font-family: inherit;
    box-sizing: border-box;
    position: relative;
    overflow: hidden;
    border-radius: 0;
    padding: 18px 16px 8px;
    transition: background 1s ease;
  }

  .hello * { box-sizing: border-box; }

  /* ═══ TIME-OF-DAY THEMES ═════════════════ */
  .hello--morning {
    background: radial-gradient(ellipse at 30% 20%, rgba(255, 183, 77, 0.07) 0%, transparent 60%),
                radial-gradient(ellipse at 70% 80%, rgba(255, 138, 101, 0.04) 0%, transparent 50%);
  }
  .hello--day {
    background: radial-gradient(ellipse at 50% 30%, rgba(100, 181, 246, 0.06) 0%, transparent 55%),
                radial-gradient(ellipse at 40% 70%, rgba(129, 212, 250, 0.03) 0%, transparent 50%);
  }
  .hello--evening {
    background: radial-gradient(ellipse at 60% 20%, rgba(149, 117, 205, 0.08) 0%, transparent 55%),
                radial-gradient(ellipse at 30% 80%, rgba(100, 80, 160, 0.04) 0%, transparent 50%);
  }
  .hello--night {
    background: radial-gradient(ellipse at 40% 30%, rgba(30, 30, 60, 0.12) 0%, transparent 50%),
                radial-gradient(ellipse at 70% 70%, rgba(15, 15, 40, 0.06) 0%, transparent 45%);
  }

  /* ═══ WEATHER ANIMATIONS ════════════════ */
  .hello-weather {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 0;
  }

  .hello > *:not(.hello-weather) { position: relative; z-index: 1; }

  /* Rain */
  .raindrop {
    position: absolute;
    top: -20px;
    width: 2px;
    height: 18px;
    background: linear-gradient(180deg, transparent, rgba(120, 180, 255, 0.3));
    border-radius: 0 0 2px 2px;
    animation: rain-fall linear infinite;
  }
  .raindrop.heavy {
    width: 2.5px;
    height: 24px;
    background: linear-gradient(180deg, transparent, rgba(120, 180, 255, 0.45));
  }

  @keyframes rain-fall {
    0% { transform: translateY(-20px); opacity: 0; }
    10% { opacity: 1; }
    90% { opacity: 1; }
    100% { transform: translateY(calc(100vh + 20px)); opacity: 0; }
  }

  /* Clouds */
  .cloud {
    position: absolute;
    left: -200px;
    width: 200px;
    height: 60px;
    background: radial-gradient(ellipse at center, rgba(200, 210, 220, 0.25) 0%, transparent 70%);
    border-radius: 50%;
    animation: cloud-drift 30s linear infinite;
  }

  @keyframes cloud-drift {
    0% { transform: translateX(-200px); }
    100% { transform: translateX(calc(100vw + 200px)); }
  }

  /* Fog */
  .fog-layer {
    position: absolute;
    left: -300px;
    width: 300px;
    height: 80px;
    background: radial-gradient(ellipse at center, rgba(180, 190, 200, 0.3) 0%, rgba(180, 190, 200, 0.08) 50%, transparent 80%);
    border-radius: 50%;
    animation: fog-drift linear infinite;
    filter: blur(8px);
  }

  @keyframes fog-drift {
    0% { transform: translateX(-300px); }
    100% { transform: translateX(calc(100vw + 300px)); }
  }

  .weather-fog {
    background: linear-gradient(180deg, rgba(160, 170, 180, 0.06) 0%, rgba(140, 150, 160, 0.03) 100%);
  }

  /* Gloom */
  .gloom-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: linear-gradient(180deg, rgba(40, 40, 50, 0.1) 0%, rgba(50, 50, 60, 0.06) 100%);
  }

  /* Snow */
  .snowflake {
    position: absolute;
    top: -20px;
    color: rgba(255, 255, 255, 0.6);
    font-family: serif;
    animation: snow-fall linear infinite;
    pointer-events: none;
    text-shadow: 0 0 3px rgba(200, 220, 255, 0.3);
  }

  @keyframes snow-fall {
    0% { transform: translateY(-20px) rotate(0deg); opacity: 0; }
    10% { opacity: 1; }
    90% { opacity: 0.8; }
    100% { transform: translateY(calc(100vh + 20px)) rotate(360deg); opacity: 0; }
  }

  .weather-snow {
    background: linear-gradient(180deg, rgba(180, 200, 230, 0.04) 0%, rgba(200, 215, 240, 0.02) 100%);
  }

  /* Storm = heavy rain + slight flicker */
  .weather-storm {
    animation: storm-flicker 4s ease-in-out infinite;
  }

  @keyframes storm-flicker {
    0%, 95%, 100% { opacity: 1; }
    96% { opacity: 0.85; }
  }

  /* Sun — minimal soft disc */
  .sun {
    position: absolute;
    top: -28px;
    right: 8%;
    width: 200px;
    height: 200px;
    pointer-events: none;
  }

  .sun-core {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: radial-gradient(
      circle at 45% 40%,
      rgba(255, 236, 180, 0.55) 0%,
      rgba(255, 210, 120, 0.28) 45%,
      rgba(255, 190, 80, 0.08) 75%,
      transparent 100%
    );
    box-shadow: 0 0 40px rgba(255, 200, 100, 0.18);
    animation: sun-breathe 8s ease-in-out infinite;
  }

  .sun--minimal .sun-core {
    width: 48px;
    height: 48px;
    box-shadow: 0 0 28px rgba(255, 200, 100, 0.14);
  }

  @keyframes sun-breathe {
    0%, 100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0.85;
    }
    50% {
      transform: translate(-50%, -50%) scale(1.04);
      opacity: 1;
    }
  }

  /* ═══ HERO ═══════════════════════════════ */
  .hello-hero {
    text-align: center;
    margin-bottom: 28px;
    padding-top: 8px;
  }

  .hello-title {
    font-size: 36px;
    font-weight: 800;
    margin: 0 0 8px;
    letter-spacing: -0.03em;
  }

  .hello-emoji { font-size: 32px; font-style: normal; vertical-align: middle; }

  .hello-date { margin: 0; font-size: 14px; color: var(--text-muted, #6b7280); font-weight: 500; }

  /* Compact, high-contrast weather chip */
  .hello-weather-card {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-top: 12px;
    padding: 5px 12px 5px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  }

  .hello-weather-card__icon {
    font-size: 16px;
    line-height: 1;
  }

  .hello-weather-card__temp {
    font-size: 13px;
    font-weight: 750;
    letter-spacing: -0.02em;
    color: var(--text-normal, #fff);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .hello-weather-card__label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted, #c5cad3);
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1;
  }

  /* Search + weight toolbar */
  .hello-toolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    max-width: 480px;
    margin: 0 auto 18px;
    width: 100%;
  }

  .hello-toolbar .hello-search {
    flex: 1;
    min-width: 0;
    margin: 0;
    max-width: none;
  }

  /* ═══ NAV ════════════════════════════════ */
  .hello-nav { display: flex; justify-content: center; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; }

  .hello-nav-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--background-secondary, #171a21);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    color: var(--text-muted, #888);
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 13px;
    font-weight: 600;
    font-family: inherit;
    white-space: nowrap;
  }

  .hello-nav-btn:hover {
    border-color: var(--interactive-accent, #7C5CFC);
    color: var(--text-normal, #e8ecf0);
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(124, 92, 252, 0.12);
  }

  .hello-nav-btn:active { transform: translateY(0); box-shadow: none; }

  .hello-nav-icon { font-size: 16px; line-height: 1; }

  /* ═══ RESPONSIVE ═════════════════════════ */
  @media (max-width: 768px) {
    .hello { padding: 28px 20px 36px; }
    .hello-title { font-size: 28px; }
    .hello-emoji { font-size: 26px; }
    .hello-date { font-size: 13px; }
    .hello-nav { gap: 8px; margin-bottom: 20px; }
    .hello-nav-btn { padding: 9px 16px; font-size: 12px; }
    .hello-nav-icon { font-size: 14px; }
  }

  @media (max-width: 540px) {
    .hello { padding: 20px 14px 28px; }
    .hello-hero { margin-bottom: 20px; }
    .hello-title { font-size: 24px; }
    .hello-emoji { font-size: 22px; }
    .hello-date { font-size: 12px; }
    .hello-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
    .hello-nav-btn { justify-content: center; padding: 12px 10px; font-size: 12px; }
    .hello-nav-icon { font-size: 16px; }
  }

  @media (max-width: 380px) {
    .hello-title { font-size: 20px; }
    .hello-nav { grid-template-columns: 1fr; }
  }

  @media (min-width: 1200px) {
    .hello { padding: 48px 40px 56px; }
    .hello-title { font-size: 42px; }
    .hello-emoji { font-size: 38px; }
    .hello-date { font-size: 15px; }
    .hello-nav { gap: 12px; }
    .hello-nav-btn { padding: 12px 24px; font-size: 14px; }
    .hello-nav-icon { font-size: 18px; }
  }

  /* ═══ NOTE SEARCH ═══════════════════════ */
  .hello-search {
    max-width: 420px;
    margin: 0 auto 24px;
    position: relative;
  }
  .hello-search__icon {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-faint, #4b5563);
    pointer-events: none;
  }
  .hello-search__input {
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-normal, #e8ecf0);
    font-size: 13px;
    padding: 10px 14px 10px 38px;
    border-radius: 10px;
    outline: none;
    font-family: inherit;
    box-sizing: border-box;
    transition: border-color 0.2s, background 0.2s;
  }
  .hello-search__input:focus {
    border-color: rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
  }
  .hello-search__input::placeholder {
    color: var(--text-faint, #4b5563);
  }

  /* ═══ QUICK WEIGHT BUTTON (next to search) ═══ */
  .hello-weight-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 13px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-normal, #e8ecf0);
    font-size: 12px;
    font-weight: 650;
    font-family: inherit;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
    transition: border-color 0.15s, background 0.15s, transform 0.12s;
  }

  .hello-weight-btn:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.1);
    transform: translateY(-1px);
  }

  .hello-weight-btn:active {
    transform: scale(0.97);
  }

  .hello-weight-btn__icon {
    font-size: 12px;
    line-height: 1;
  }

  .hello-weight-btn__value {
    letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums;
  }
</style>
