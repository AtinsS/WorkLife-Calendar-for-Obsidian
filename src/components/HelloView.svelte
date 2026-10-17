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
  /** Сохранить порядок nav-кнопок (drag & drop) в настройках плагина */
  export let persistNavOrder: ((order: string[]) => void) | undefined = undefined;

  let now = moment();
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let weatherTimer: ReturnType<typeof setInterval> | null = null;
  let weather: DayWeather | null = null;
  // HTML5 drag steals taps on touch WebKit — only enable reorder on desktop
  const isTouch =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0);

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

  // ── Nav buttons: order + drag & drop ──
  const NAV_DEFAULT_ORDER = ["tasks", "analytics", "finance", "schedule"] as const;
  type NavId = (typeof NAV_DEFAULT_ORDER)[number];

  let draggedNavId: string | null = null;
  let dragOverNavId: string | null = null;

  $: navOrder = (() => {
    const stored = $settings.helloNavOrder;
    if (!Array.isArray(stored) || stored.length === 0) return [...NAV_DEFAULT_ORDER];
    const known = new Set(NAV_DEFAULT_ORDER as readonly string[]);
    const ordered = stored.filter((id) => known.has(id));
    // append any missing defaults at the end
    for (const id of NAV_DEFAULT_ORDER) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  })();

  $: navItems = navOrder
    .map((id) => {
      switch (id as NavId) {
        case "tasks":
          return showTasksBtn
            ? { id, icon: "✅", label: $t("hello.navTasks"), onClick: onOpenTasks }
            : null;
        case "analytics":
          return showAnalyticsBtn
            ? { id, icon: "📊", label: $t("hello.navAnalytics"), onClick: onOpenAnalytics }
            : null;
        case "finance":
          return showFinanceBtn
            ? { id, icon: "💰", label: $t("hello.navFinance"), onClick: onOpenFinance }
            : null;
        case "schedule":
          return showScheduleBtn
            ? { id, icon: "📅", label: $t("hello.navSchedule"), onClick: onOpenSchedule }
            : null;
        default:
          return null;
      }
    })
    .filter(Boolean) as Array<{ id: string; icon: string; label: string; onClick?: () => void }>;

  function onNavDragStart(e: DragEvent, id: string) {
    draggedNavId = id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    (e.currentTarget as HTMLElement).classList.add("dragging");
  }

  function onNavDragEnd(e: DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("dragging");
    draggedNavId = null;
    dragOverNavId = null;
  }

  function onNavDragOver(e: DragEvent, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== draggedNavId) dragOverNavId = id;
  }

  function onNavDragLeave() {
    dragOverNavId = null;
  }

  function onNavDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    const fromId = draggedNavId;
    dragOverNavId = null;
    draggedNavId = null;
    if (!fromId || fromId === targetId) return;

    const next = [...navOrder];
    const fromIdx = next.indexOf(fromId);
    const toIdx = next.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromId);

    settings.update((s) => ({ ...s, helloNavOrder: next }));
    persistNavOrder?.(next);
  }
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
  $: monthNames = $tArray("common.months.genitive");
  $: dayNames = $tArray("common.weekdays.long");
  $: monthName = monthNames[now.month()] || "";
  $: year = now.format("YYYY");
  // moment day(): 0=Sun..6=Sat; weekdays.long is Monday-first → shift by +6
  $: dateDisplay = `${now.date()} ${monthName} ${year}, ${dayNames[(now.day() + 6) % 7] || ""}`;

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

  // ── Stable particle fields (seeded once per scene, not on every re-render) ──
  type Particle = {
    left: number;
    delay: number;
    duration: number;
    opacity: number;
    size: number;
    drift: number;
  };

  function mulberry32(seed: number) {
    return () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRain(count: number, heavy = false): Particle[] {
    const rnd = mulberry32(heavy ? 0x51fa : 0x2c81);
    return Array.from({ length: count }, () => ({
      left: rnd() * 100,
      delay: rnd() * (heavy ? 1.4 : 2.4),
      duration: heavy ? 0.32 + rnd() * 0.38 : 0.55 + rnd() * 0.65,
      opacity: 0.3 + rnd() * 0.55,
      size: heavy ? 2.1 + rnd() * 1.3 : 1.1 + rnd() * 1.2,
      drift: 6 + rnd() * 16,
    }));
  }

  function makeSnow(count: number): Particle[] {
    const rnd = mulberry32(0x7e11);
    return Array.from({ length: count }, () => ({
      left: rnd() * 100,
      delay: rnd() * 5.5,
      duration: 3.2 + rnd() * 4.2,
      opacity: 0.35 + rnd() * 0.5,
      size: 3.5 + rnd() * 7,
      drift: (rnd() - 0.5) * 48,
    }));
  }

  function makeClouds(count: number): Particle[] {
    const rnd = mulberry32(0x3a09);
    return Array.from({ length: count }, () => ({
      left: rnd() * 70,
      delay: rnd() * 18,
      duration: 28 + rnd() * 22,
      opacity: 0.14 + rnd() * 0.18,
      size: 140 + rnd() * 140,
      drift: 0,
    }));
  }

  function makeFog(count: number): Particle[] {
    const rnd = mulberry32(0x1f55);
    return Array.from({ length: count }, () => ({
      left: rnd() * 60,
      delay: rnd() * 10,
      duration: 16 + rnd() * 14,
      opacity: 0.1 + rnd() * 0.14,
      size: 180 + rnd() * 160,
      drift: 0,
    }));
  }

  $: rainDrops = weatherAnim === "weather-storm" ? makeRain(56, true) : makeRain(36, false);
  $: snowflakes = makeSnow(44);
  $: cloudPuffs =
    weatherAnim === "weather-partly"
      ? makeClouds(3)
      : weatherAnim === "weather-clouds"
        ? makeClouds(5)
        : weatherAnim === "weather-gloom"
          ? makeClouds(4)
          : [];
  $: fogPuffs = weatherAnim === "weather-fog" ? makeFog(6) : [];

</script>

<div class="hello">
  <!-- Weather animation layer -->
  {#if weatherAnim}
    <div class="hello-weather {weatherAnim}" aria-hidden="true">
      {#if weatherAnim === "weather-rain" || weatherAnim === "weather-storm"}
        {#each rainDrops as d, i (i)}
          <i
            class="wx-drop"
            class:is-heavy={weatherAnim === "weather-storm"}
            style="left:{d.left}%;--fall-dur:{d.duration}s;--fall-delay:-{d.delay}s;--fall-op:{d.opacity};--drop-w:{d.size}px;--drift:{d.drift}px"
          ></i>
        {/each}
        {#if weatherAnim === "weather-storm"}
          <div class="wx-lightning"></div>
          <div class="wx-lightning wx-lightning--delayed"></div>
        {/if}
      {:else if weatherAnim === "weather-partly"}
        <div class="sun sun--minimal">
          <div class="sun-glow"></div>
          <div class="sun-disc"></div>
        </div>
        {#each cloudPuffs as c, i (i)}
          <div
            class="wx-cloud"
            style="top:{12 + i * 22}%;left:{c.left}%;width:{c.size}px;opacity:{c.opacity};--cloud-dur:{c.duration}s;--cloud-delay:-{c.delay}s"
          ></div>
        {/each}
      {:else if weatherAnim === "weather-clouds"}
        {#each cloudPuffs as c, i (i)}
          <div
            class="wx-cloud"
            style="top:{8 + i * 14}%;left:{c.left}%;width:{c.size}px;opacity:{c.opacity};--cloud-dur:{c.duration}s;--cloud-delay:-{c.delay}s"
          ></div>
        {/each}
      {:else if weatherAnim === "weather-fog"}
        {#each fogPuffs as f, i (i)}
          <div
            class="wx-fog"
            style="top:{10 + i * 13}%;left:{f.left}%;width:{f.size}px;opacity:{f.opacity};--fog-dur:{f.duration}s;--fog-delay:-{f.delay}s"
          ></div>
        {/each}
      {:else if weatherAnim === "weather-gloom"}
        <div class="gloom-overlay"></div>
        {#each cloudPuffs as c, i (i)}
          <div
            class="wx-cloud"
            style="top:{8 + i * 16}%;left:{c.left}%;width:{c.size}px;opacity:{c.opacity};--cloud-dur:{c.duration}s;--cloud-delay:-{c.delay}s"
          ></div>
        {/each}
      {:else if weatherAnim === "weather-snow"}
        {#each snowflakes as s, i (i)}
          <i
            class="wx-flake"
            style="left:{s.left}%;width:{s.size}px;height:{s.size}px;--fall-dur:{s.duration}s;--fall-delay:-{s.delay}s;--fall-op:{s.opacity};--drift:{s.drift}px"
          ></i>
        {/each}
      {:else if weatherAnim === "weather-sun"}
        <div class="sun sun--minimal">
          <div class="sun-glow"></div>
          <div class="sun-disc"></div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Hero -->
  <div class="hello-hero">
    <h1 class="hello-title">{greeting}</h1>
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

  <!-- Nav (drag & drop to reorder) -->
  <div class="hello-nav">
    {#each navItems as item (item.id)}
      <button
        class="hello-nav-btn"
        class:dragging={draggedNavId === item.id}
        class:drag-over={dragOverNavId === item.id}
        draggable={!isTouch}
        on:click={() => item.onClick?.()}
        on:dragstart={(e) => isTouch || onNavDragStart(e, item.id)}
        on:dragend={onNavDragEnd}
        on:dragover={(e) => onNavDragOver(e, item.id)}
        on:dragleave={onNavDragLeave}
        on:drop={(e) => onNavDrop(e, item.id)}
      >
        <span class="hello-nav-icon">{item.icon}</span>
        <span>{item.label}</span>
      </button>
    {/each}
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
  }

  .hello * { box-sizing: border-box; }

  /* ═══ WEATHER ANIMATIONS ════════════════ */
  .hello-weather {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 0;
  }

  .hello > *:not(.hello-weather) { position: relative; z-index: 1; }

  /* Rain — container-relative fall via top% (transform % is self-relative and breaks) */
  .wx-drop {
    position: absolute;
    top: -6%;
    width: var(--drop-w, 1.6px);
    height: 22px;
    border-radius: 999px;
    background: linear-gradient(
      180deg,
      transparent 0%,
      rgba(150, 195, 255, 0.15) 35%,
      rgba(160, 200, 255, 0.55) 100%
    );
    box-shadow: 0 0 6px rgba(140, 185, 255, 0.18);
    opacity: var(--fall-op, 0.7);
    animation: wx-fall var(--fall-dur, 1s) linear var(--fall-delay, 0s) infinite;
    will-change: top, transform, opacity;
  }
  .wx-drop.is-heavy {
    height: 30px;
    background: linear-gradient(
      180deg,
      transparent 0%,
      rgba(130, 175, 255, 0.2) 30%,
      rgba(145, 190, 255, 0.7) 100%
    );
    box-shadow: 0 0 8px rgba(130, 180, 255, 0.28);
  }

  @keyframes wx-fall {
    0%   { top: -8%; transform: translateX(0) scaleY(0.85); opacity: 0; }
    8%   { opacity: var(--fall-op, 0.7); }
    88%  { opacity: calc(var(--fall-op, 0.7) * 0.85); }
    100% { top: 108%; transform: translateX(var(--drift, 10px)) scaleY(1.15); opacity: 0; }
  }

  /* Clouds — multi-blob soft mass */
  .wx-cloud {
    position: absolute;
    height: 56px;
    border-radius: 50%;
    background:
      radial-gradient(ellipse 58% 62% at 28% 55%, rgba(220, 232, 245, 0.32) 0%, transparent 72%),
      radial-gradient(ellipse 52% 58% at 54% 42%, rgba(210, 224, 240, 0.26) 0%, transparent 74%),
      radial-gradient(ellipse 48% 52% at 78% 58%, rgba(200, 216, 235, 0.2) 0%, transparent 76%);
    filter: blur(14px);
    animation: wx-cloud-drift var(--cloud-dur, 32s) linear var(--cloud-delay, 0s) infinite;
    will-change: left;
  }

  @keyframes wx-cloud-drift {
    0%   { left: -32%; }
    100% { left: 112%; }
  }

  /* Fog — wide soft banks */
  .wx-fog {
    position: absolute;
    height: 90px;
    border-radius: 50%;
    background: radial-gradient(
      ellipse 70% 55% at 50% 50%,
      rgba(195, 210, 225, 0.34) 0%,
      rgba(180, 195, 215, 0.12) 48%,
      transparent 78%
    );
    filter: blur(22px);
    animation: wx-fog-drift var(--fog-dur, 22s) linear var(--fog-delay, 0s) infinite;
    will-change: left;
  }

  @keyframes wx-fog-drift {
    0%   { left: -38%; }
    100% { left: 118%; }
  }

  .weather-fog {
    background: linear-gradient(180deg, rgba(160, 175, 190, 0.07) 0%, rgba(145, 160, 175, 0.03) 100%);
  }

  /* Gloom */
  .gloom-overlay {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(35, 40, 55, 0.16) 0%, transparent 70%),
      linear-gradient(180deg, rgba(40, 42, 55, 0.1) 0%, rgba(50, 52, 65, 0.05) 100%);
  }

  /* Snow — soft glowing flakes */
  .wx-flake {
    position: absolute;
    top: -4%;
    border-radius: 50%;
    background: radial-gradient(
      circle at 35% 32%,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(230, 240, 255, 0.65) 45%,
      rgba(200, 220, 250, 0.25) 100%
    );
    box-shadow:
      0 0 6px rgba(210, 230, 255, 0.35),
      0 0 16px rgba(180, 210, 255, 0.16);
    animation: wx-snow var(--fall-dur, 5s) linear var(--fall-delay, 0s) infinite;
    will-change: top, transform;
  }

  @keyframes wx-snow {
    0%   { top: -4%; transform: translateX(0) rotate(0deg); opacity: 0; }
    10%  { opacity: var(--fall-op, 0.7); }
    88%  { opacity: calc(var(--fall-op, 0.7) * 0.8); }
    100% { top: 108%; transform: translateX(var(--drift, 18px)) rotate(320deg); opacity: 0; }
  }

  .weather-snow {
    background: linear-gradient(180deg, rgba(185, 205, 235, 0.05) 0%, rgba(205, 220, 245, 0.02) 100%);
  }

  /* Storm — ambient flicker + lightning */
  .weather-storm {
    background: linear-gradient(180deg, rgba(15, 22, 35, 0.12) 0%, rgba(25, 35, 50, 0.06) 100%);
  }

  .wx-lightning {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      185deg,
      rgba(210, 225, 255, 0.5) 0%,
      rgba(180, 205, 255, 0.12) 38%,
      transparent 72%
    );
    opacity: 0;
    animation: wx-flash 6.5s ease-out infinite;
    mix-blend-mode: screen;
  }
  .wx-lightning--delayed {
    animation-delay: -3.2s;
    animation-duration: 8.4s;
    opacity: 0;
  }

  @keyframes wx-flash {
    0%, 84%, 100% { opacity: 0; }
    85% { opacity: 0.65; }
    86% { opacity: 0.08; }
    87.5% { opacity: 0.9; }
    89% { opacity: 0.05; }
    90% { opacity: 0.45; }
    92% { opacity: 0; }
  }

  /* Sun — quiet, minimal: soft glow + matte disc (no rays / spin) */
  .sun {
    position: absolute;
    top: -12px;
    right: 6%;
    width: 200px;
    height: 200px;
    pointer-events: none;
    --sun-size: 40px;
  }

  .sun--minimal {
    --sun-size: 36px;
  }

  .sun-glow {
    position: absolute;
    inset: 18%;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      rgba(255, 200, 120, 0.14) 0%,
      rgba(255, 185, 100, 0.06) 40%,
      transparent 70%
    );
    filter: blur(16px);
  }

  .sun-disc {
    position: absolute;
    top: 50%;
    left: 50%;
    width: var(--sun-size);
    height: var(--sun-size);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: radial-gradient(
      circle at 40% 36%,
      rgba(255, 236, 190, 0.72) 0%,
      rgba(255, 214, 140, 0.58) 45%,
      rgba(255, 190, 110, 0.42) 100%
    );
    box-shadow: 0 0 24px rgba(255, 195, 115, 0.12);
    animation: sun-breathe 12s ease-in-out infinite;
  }

  @keyframes sun-breathe {
    0%, 100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0.88;
    }
    50% {
      transform: translate(-50%, -50%) scale(1.02);
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

  .hello-date { margin: 0; font-size: 14px; color: var(--text-muted, #6b7280); font-weight: 500; }

  /* Compact, high-contrast weather chip */
  .hello-weather-card {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-top: 12px;
    padding: 5px 12px 5px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.06),
      0 4px 16px rgba(0, 0, 0, 0.08),
      0 0 28px rgba(160, 190, 255, 0.06),
      0 0 56px rgba(160, 190, 255, 0.04);
    backdrop-filter: blur(10px) saturate(1.15);
    -webkit-backdrop-filter: blur(10px) saturate(1.15);
    transition: border-color 0.2s ease, box-shadow 0.25s ease;
  }

  .hello-weather-card:hover {
    border-color: rgba(255, 255, 255, 0.18);
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.08),
      0 8px 28px rgba(0, 0, 0, 0.1),
      0 0 36px rgba(160, 190, 255, 0.1),
      0 0 72px rgba(160, 190, 255, 0.06);
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
    border-color: color-mix(in srgb, var(--interactive-accent, #7C5CFC) 55%, transparent);
    color: var(--text-normal, #e8ecf0);
    transform: translateY(-1px);
    box-shadow:
      0 1px 2px rgba(124, 92, 252, 0.06),
      0 6px 18px rgba(124, 92, 252, 0.1),
      0 14px 40px rgba(124, 92, 252, 0.12),
      0 0 60px rgba(124, 92, 252, 0.08);
  }

  .hello-nav-btn:active {
    transform: translateY(0);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  /* Drag & drop reorder */
  .hello-nav-btn {
    user-select: none;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .hello-nav-btn.dragging {
    opacity: 0.45;
    cursor: pointer;
    transform: scale(0.97);
  }
  .hello-nav-btn.drag-over {
    border-color: color-mix(in srgb, var(--interactive-accent, #7C5CFC) 65%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--interactive-accent, #7C5CFC) 35%, transparent),
      0 4px 16px color-mix(in srgb, var(--interactive-accent, #7C5CFC) 18%, transparent),
      0 12px 36px color-mix(in srgb, var(--interactive-accent, #7C5CFC) 16%, transparent),
      0 0 56px color-mix(in srgb, var(--interactive-accent, #7C5CFC) 12%, transparent);
    transform: translateY(-2px) scale(1.02);
  }

  .hello-nav-icon { font-size: 16px; line-height: 1; }

  /* ═══ RESPONSIVE ═════════════════════════ */
  @media (max-width: 768px) {
    .hello { padding: 28px 20px 36px; }
    .hello-title { font-size: 28px; }
    .hello-date { font-size: 13px; }
    .hello-nav { gap: 8px; margin-bottom: 20px; }
    .hello-nav-btn { padding: 9px 16px; font-size: 12px; }
    .hello-nav-icon { font-size: 14px; }
  }

  @media (max-width: 540px) {
    .hello { padding: 20px 14px 28px; }
    .hello-hero { margin-bottom: 20px; }
    .hello-title { font-size: 24px; }
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
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.035);
    color: var(--text-normal, #e8ecf0);
    font-size: 13px;
    padding: 10px 14px 10px 38px;
    border-radius: 10px;
    outline: none;
    font-family: inherit;
    box-sizing: border-box;
    transition:
      border-color 0.22s ease,
      background 0.22s ease,
      box-shadow 0.28s ease;
    box-shadow: 0 0 0 0 transparent;
  }
  .hello-search__input:focus {
    border-color: rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.055);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.06),
      0 2px 10px rgba(0, 0, 0, 0.08),
      0 8px 28px rgba(124, 92, 252, 0.1),
      0 0 48px rgba(124, 92, 252, 0.08);
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
    box-shadow:
      0 4px 14px rgba(0, 0, 0, 0.08),
      0 10px 32px rgba(124, 92, 252, 0.1),
      0 0 48px rgba(124, 92, 252, 0.07);
  }

  .hello-weight-btn:active {
    transform: scale(0.97);
    box-shadow: none;
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
