<script lang="ts">
  import { settings } from "../ui/stores";
  import { fetchDayDetail, type DayWeatherDetail, getWeatherAttribution } from "../services/weatherService";
  import { t, tRaw } from "../i18n";

  export let date = "";

  let detail: DayWeatherDetail | null = null;
  let loading = true;
  let error = false;

  $: if (date) loadWeather(date);

  async function loadWeather(d: string) {
    loading = true;
    error = false;
    const s = $settings;
    if (!s.weatherLatitude || !s.weatherLongitude || s.weatherEnabled === false) {
      loading = false;
      error = true;
      return;
    }
    try {
      detail = await fetchDayDetail(
        s.weatherLatitude,
        s.weatherLongitude,
        d,
        s.weatherProvider as any,
        s.weatherApiKey,
      );
      if (!detail) error = true;
    } catch {
      error = true;
    } finally {
      loading = false;
    }
  }

  function formatDateShort(dateStr: string): string {
    if (!dateStr) return "";
    try {
      const m = window.moment(dateStr, "YYYY-MM-DD", true);
      if (m.isValid()) return m.format("D MMMM YYYY");
    } catch { /* ignore */ }
    return dateStr;
  }

  function formatDateUpdated(dateStr: string): string {
    if (!dateStr) return "";
    try {
      const m = window.moment(dateStr, "YYYY-MM-DD", true);
      if (m.isValid()) return m.format("D MMMM") + " " + tRaw("weather.updatedAt");
    } catch { /* ignore */ }
    return dateStr;
  }

  function uvLevel(uv: number): { label: string; color: string } {
    if (uv <= 2) return { label: "0-2", color: "#4ade80" };
    if (uv <= 5) return { label: "3-5", color: "#facc15" };
    if (uv <= 7) return { label: "6-7", color: "#fb923c" };
    if (uv <= 10) return { label: "8-10", color: "#f87171" };
    return { label: "11+", color: "#c084fc" };
  }

  function isCurrentHour(timeStr: string): boolean {
    if (date !== window.moment().format("YYYY-MM-DD")) return false;
    return timeStr === window.moment().format("HH:00");
  }

  function mmHg(hpa: number): number {
    return Math.round(hpa * 0.75006);
  }

  // Determine weather class for hero animations
  $: weatherClass = getWeatherClass(detail?.weatherCode ?? 0);

  function getWeatherClass(code: number): string {
    if (code === 0) return "wd-clear";
    if (code === 1) return "wd-partly-cloudy";
    if (code === 2) return "wd-cloudy";
    if (code === 3) return "wd-overcast";
    if (code >= 45 && code <= 48) return "wd-fog";
    if (code >= 51 && code <= 57) return "wd-drizzle";
    if (code >= 61 && code <= 67) return "wd-rain";
    if (code >= 71 && code <= 77) return "wd-snow";
    if (code >= 80 && code <= 82) return "wd-rain";
    if (code >= 85 && code <= 86) return "wd-snow";
    if (code >= 95) return "wd-storm";
    return "wd-clear";
  }

  // ── Stable particle fields ──
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
      opacity: 0.16 + rnd() * 0.2,
      size: 160 + rnd() * 160,
      drift: 0,
    }));
  }

  function makeFog(count: number): Particle[] {
    const rnd = mulberry32(0x1f55);
    return Array.from({ length: count }, () => ({
      left: rnd() * 60,
      delay: rnd() * 10,
      duration: 16 + rnd() * 14,
      opacity: 0.12 + rnd() * 0.16,
      size: 200 + rnd() * 180,
      drift: 0,
    }));
  }

  $: rainDrops =
    weatherClass === "wd-storm"
      ? makeRain(52, true)
      : weatherClass === "wd-rain"
        ? makeRain(38, false)
        : weatherClass === "wd-drizzle"
          ? makeRain(22, false)
          : [];
  $: snowflakes = weatherClass === "wd-snow" ? makeSnow(40) : [];
  $: cloudPuffs =
    weatherClass === "wd-partly-cloudy"
      ? makeClouds(3)
      : weatherClass === "wd-cloudy"
        ? makeClouds(5)
        : weatherClass === "wd-overcast"
          ? makeClouds(4)
          : [];
  $: fogPuffs = weatherClass === "wd-fog" ? makeFog(5) : [];

  // Temp bar scaling
  $: maxTemp = detail?.hourly?.length ? Math.max(...detail.hourly.map(h => h.temp)) : 0;
  $: minTemp = detail?.hourly?.length ? Math.min(...detail.hourly.map(h => h.temp)) : 0;
  $: tempRange = maxTemp - minTemp || 1;
</script>

<div class="wd">
  {#if loading}
    <div class="wd-loading">
      <div class="wd-spinner"></div>
    </div>
  {:else if error || !detail}
    <div class="wd-error">{$t("weather.noData")}</div>
  {:else}
    <!-- ═══════ HERO ═══════ -->
    <div class="wd-hero {weatherClass}">
      <!-- Animated weather layer -->
      <div class="wd-hero-anim {weatherClass}" aria-hidden="true">
        {#if weatherClass === "wd-rain" || weatherClass === "wd-drizzle" || weatherClass === "wd-storm"}
          {#each rainDrops as d, i (i)}
            <i
              class="wx-drop"
              class:is-heavy={weatherClass === "wd-storm"}
              style="left:{d.left}%;--fall-dur:{d.duration}s;--fall-delay:-{d.delay}s;--fall-op:{d.opacity};--drop-w:{d.size}px;--drift:{d.drift}px"
            ></i>
          {/each}
          {#if weatherClass === "wd-storm"}
            <div class="wx-lightning"></div>
            <div class="wx-lightning wx-lightning--delayed"></div>
          {/if}
        {:else if weatherClass === "wd-cloudy" || weatherClass === "wd-partly-cloudy" || weatherClass === "wd-overcast"}
          {#each cloudPuffs as c, i (i)}
            <div
              class="wx-cloud"
              style="top:{8 + i * 18}%;left:{c.left}%;width:{c.size}px;opacity:{c.opacity};--cloud-dur:{c.duration}s;--cloud-delay:-{c.delay}s"
            ></div>
          {/each}
          {#if weatherClass === "wd-partly-cloudy"}
            <div class="sun">
              <div class="sun-glow"></div>
              <div class="sun-disc"></div>
            </div>
          {/if}
          {#if weatherClass === "wd-overcast"}
            <div class="gloom-overlay"></div>
          {/if}
        {:else if weatherClass === "wd-fog"}
          {#each fogPuffs as f, i (i)}
            <div
              class="wx-fog"
              style="top:{8 + i * 15}%;left:{f.left}%;width:{f.size}px;opacity:{f.opacity};--fog-dur:{f.duration}s;--fog-delay:-{f.delay}s"
            ></div>
          {/each}
        {:else if weatherClass === "wd-snow"}
          {#each snowflakes as s, i (i)}
            <i
              class="wx-flake"
              style="left:{s.left}%;width:{s.size}px;height:{s.size}px;--fall-dur:{s.duration}s;--fall-delay:-{s.delay}s;--fall-op:{s.opacity};--drift:{s.drift}px"
            ></i>
          {/each}
        {:else if weatherClass === "wd-clear"}
          <div class="sun sun--hero">
            <div class="sun-glow"></div>
            <div class="sun-disc"></div>
          </div>
        {/if}
      </div>

      <div class="wd-hero-content">
        <div class="wd-hero-date">{formatDateShort(detail.date)}</div>
        <div class="wd-hero-label">{detail.label}</div>
        <div class="wd-hero-temp">
          <span class="wd-hero-temp-num">{detail.tempMin}°</span>
          <span class="wd-hero-temp-sep">...</span>
          <span class="wd-hero-temp-num">{detail.tempMax}°</span>
        </div>
        <div class="wd-hero-feels">{$t("weather.feelsLike")} {detail.feelsLikeMin}° ... {detail.feelsLikeMax}°</div>
        <div class="wd-hero-badges">
          <span class="wd-hero-badge">
            <span class="wd-badge-icon">☀️</span>
            <span>{$t("weather.uvIndex")} {detail.uvIndex} ({uvLevel(detail.uvIndex).label})</span>
          </span>
          <span class="wd-hero-badge">
            <span class="wd-badge-icon">💧</span>
            <span>{$t("weather.humidity")} {detail.hourly.length > 0 ? detail.hourly[Math.floor(detail.hourly.length / 2)].humidity : 0}%</span>
          </span>
        </div>
      </div>
      <div class="wd-hero-icon">
        <span class="wd-hero-emoji">{detail.icon}</span>
      </div>
    </div>

    <!-- ═══════ INFO CARDS ═══════ -->
    <div class="wd-cards">
      <div class="wd-card">
        <div class="wd-card-top">
          <span class="wd-card-icon-card">🌅</span>
        </div>
        <div class="wd-card-label">{$t("weather.sunrise")}</div>
        <div class="wd-card-value">{detail.sunrise || "—"}</div>
      </div>
      <div class="wd-card">
        <div class="wd-card-top">
          <span class="wd-card-icon-card">🌇</span>
        </div>
        <div class="wd-card-label">{$t("weather.sunset")}</div>
        <div class="wd-card-value">{detail.sunset || "—"}</div>
      </div>
      <div class="wd-card">
        <div class="wd-card-top">
          <span class="wd-card-icon-card">💨</span>
        </div>
        <div class="wd-card-label">{$t("weather.wind")}</div>
        <div class="wd-card-value">{detail.windSpeedMax} {$t("weather.kmh")}</div>
        <div class="wd-card-sub">{detail.windDir}</div>
      </div>
      <div class="wd-card">
        <div class="wd-card-top">
          <span class="wd-card-icon-card">🌧️</span>
        </div>
        <div class="wd-card-label">{$t("weather.precipitation")}</div>
        <div class="wd-card-value">{detail.precipitationSum.toFixed(1)} {$t("weather.mm")}</div>
        <div class="wd-card-sub">{detail.precipProbMax}%</div>
      </div>
      <div class="wd-card">
        <div class="wd-card-top">
          <span class="wd-card-icon-card">🔘</span>
        </div>
        <div class="wd-card-label">{$t("weather.pressure")}</div>
        <div class="wd-card-value">{detail.pressureAvg > 0 ? mmHg(detail.pressureAvg) : "—"} {$t("weather.mmHg")}</div>
      </div>
    </div>

    <!-- ═══════ HOURLY TABLE ═══════ -->
    {#if detail.hourly.length > 0}
      <div class="wd-section">
        <div class="wd-section-title">{$t("weather.hourly")}</div>
        <div class="wd-table-wrap">
          <table class="wd-table">
            <thead>
              <tr>
                <th class="wd-th-time">{$t("weather.time")}</th>
                <th class="wd-th-icon">{$t("weather.weather")}</th>
                <th class="wd-th-temp">{$t("weather.temperature")}</th>
                <th class="wd-th-feels">{$t("weather.feelsLike")}</th>
                <th class="wd-th-wind">{$t("weather.wind")}</th>
                <th class="wd-th-hum">{$t("weather.humidity")}</th>
              </tr>
            </thead>
            <tbody>
              {#each detail.hourly as h (h.time)}
                <tr class:wd-row-current={isCurrentHour(h.time)}>
                  <td class="wd-td-time">{h.time}</td>
                  <td class="wd-td-icon">{h.icon}</td>
                  <td class="wd-td-temp">
                    <span class="wd-temp-val">{h.temp}°</span>
                    <div class="wd-bar-track">
                      <div class="wd-bar-fill" style="width:{((h.temp - minTemp) / tempRange) * 100}%"></div>
                    </div>
                  </td>
                  <td class="wd-td-feels">{h.feelsLike}°</td>
                  <td class="wd-td-wind">
                    <span>{h.windSpeed} {$t("weather.kmh")}</span>
                  </td>
                  <td class="wd-td-hum">
                    <span class="wd-hum-icon">💧</span>
                    <span>{h.humidity}%</span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

    <!-- ═══════ FOOTER ═══════ -->
    <div class="wd-footer">
      <span>{$t("weather.updated")} {formatDateUpdated(detail.date)}</span>
      <span>{getWeatherAttribution($settings.weatherProvider) || "Open-Meteo.com"}</span>
    </div>
  {/if}
</div>

<style>
  /* ── BASE ── */
  .wd {
    height: 100%;
    overflow-y: auto;
    background: var(--background-primary, #1a1a2e);
    color: var(--text-normal);
  }

  .wd-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px;
  }

  .wd-spinner {
    width: 24px;
    height: 24px;
    border: 3px solid var(--text-faint);
    border-top-color: var(--text-muted);
    border-radius: 50%;
    animation: wd-spin 0.8s linear infinite;
  }
  @keyframes wd-spin { to { transform: rotate(360deg); } }

  .wd-error {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 60px;
    color: var(--text-muted);
    font-size: 14px;
  }

  /* ── HERO ── */
  .wd-hero {
    position: relative;
    overflow: hidden;
    border-radius: 0;
    margin: 0;
    padding: 32px 24px 56px;
    min-height: 200px;
    display: flex;
    align-items: flex-end;
    isolation: isolate;
  }

  .wd-hero::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 72px;
    background: linear-gradient(to bottom, transparent, var(--background-primary, #1a1a2e));
    pointer-events: none;
    z-index: 4;
  }

  /* Soft ambient light so hero never looks like a flat gradient slab */
  .wd-hero::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 80% 70% at 18% 0%, rgba(255, 255, 255, 0.1) 0%, transparent 58%),
      radial-gradient(ellipse 55% 50% at 88% 12%, rgba(255, 255, 255, 0.06) 0%, transparent 62%);
    pointer-events: none;
    z-index: 1;
    mix-blend-mode: soft-light;
  }

  .wd-clear {
    background:
      radial-gradient(ellipse 70% 80% at 80% 15%, rgba(255, 210, 120, 0.08) 0%, transparent 55%),
      linear-gradient(145deg, #1a3a62 0%, #2d5f92 42%, #4a93c9 100%);
  }
  .wd-partly-cloudy {
    background:
      radial-gradient(ellipse 60% 70% at 75% 12%, rgba(255, 220, 150, 0.06) 0%, transparent 58%),
      linear-gradient(145deg, #2a3f55 0%, #4a6788 42%, #7d93a4 100%);
  }
  .wd-cloudy {
    background: linear-gradient(145deg, #2a3846 0%, #425260 48%, #5d6f78 100%);
  }
  .wd-overcast {
    background: linear-gradient(145deg, #1a2430 0%, #2a3c4e 48%, #3d5162 100%);
  }
  .wd-fog {
    background: linear-gradient(145deg, #3a4c5e 0%, #5a6e80 48%, #7e92a4 100%);
  }
  .wd-drizzle {
    background: linear-gradient(145deg, #1a2a38 0%, #2c4458 42%, #3d5e78 100%);
  }
  .wd-rain {
    background: linear-gradient(145deg, #0e1a26 0%, #1a3244 42%, #2a5068 100%);
  }
  .wd-snow {
    background:
      radial-gradient(ellipse 70% 60% at 30% 20%, rgba(220, 235, 255, 0.12) 0%, transparent 60%),
      linear-gradient(145deg, #2c3e52 0%, #4a6478 42%, #6a8498 100%);
  }
  .wd-storm {
    background:
      radial-gradient(ellipse 60% 50% at 70% 10%, rgba(140, 170, 220, 0.1) 0%, transparent 55%),
      linear-gradient(145deg, #080e16 0%, #1a2836 42%, #2a3e52 100%);
  }

  .wd-hero-content {
    position: relative;
    z-index: 2;
    flex: 1;
    min-width: 0;
  }

  .wd-hero-icon {
    position: relative;
    z-index: 2;
    flex-shrink: 0;
    margin-left: 16px;
  }

  .wd-hero-emoji {
    font-size: 80px;
    line-height: 1;
    filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.28)) drop-shadow(0 0 28px rgba(255, 255, 255, 0.12));
  }

  .wd-hero-date {
    font-size: 13px;
    color: rgba(255,255,255,0.65);
    margin-bottom: 4px;
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.2);
  }

  .wd-hero-label {
    font-size: 16px;
    font-weight: 600;
    color: rgba(255,255,255,0.92);
    margin-bottom: 4px;
    text-shadow: 0 1px 10px rgba(0, 0, 0, 0.22);
  }

  .wd-hero-temp {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-bottom: 2px;
  }

  .wd-hero-temp-num {
    font-size: 42px;
    font-weight: 700;
    color: #fff;
    line-height: 1.1;
    text-shadow:
      0 2px 16px rgba(0, 0, 0, 0.22),
      0 0 36px rgba(255, 255, 255, 0.12);
  }

  .wd-hero-temp-sep {
    font-size: 28px;
    font-weight: 300;
    color: rgba(255,255,255,0.5);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.18);
  }

  .wd-hero-feels {
    font-size: 13px;
    color: rgba(255,255,255,0.55);
    margin-bottom: 12px;
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.18);
  }

  .wd-hero-badges {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .wd-hero-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: rgba(255,255,255,0.75);
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .wd-badge-icon {
    font-size: 14px;
  }

  /* ── WEATHER ANIMATIONS ── */
  .wd-hero-anim {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 1;
  }

  /* Rain — container-relative fall via top% */
  .wx-drop {
    position: absolute;
    top: -6%;
    width: var(--drop-w, 1.6px);
    height: 22px;
    border-radius: 999px;
    background: linear-gradient(
      180deg,
      transparent 0%,
      rgba(160, 200, 255, 0.18) 35%,
      rgba(175, 210, 255, 0.6) 100%
    );
    box-shadow: 0 0 6px rgba(150, 195, 255, 0.2);
    opacity: var(--fall-op, 0.7);
    animation: wx-fall var(--fall-dur, 1s) linear var(--fall-delay, 0s) infinite;
    will-change: top, transform, opacity;
  }
  .wx-drop.is-heavy {
    height: 32px;
    background: linear-gradient(
      180deg,
      transparent 0%,
      rgba(140, 185, 255, 0.22) 30%,
      rgba(155, 195, 255, 0.75) 100%
    );
    box-shadow: 0 0 8px rgba(140, 185, 255, 0.3);
  }

  @keyframes wx-fall {
    0%   { top: -8%; transform: translateX(0) scaleY(0.85); opacity: 0; }
    8%   { opacity: var(--fall-op, 0.7); }
    88%  { opacity: calc(var(--fall-op, 0.7) * 0.85); }
    100% { top: 108%; transform: translateX(var(--drift, 10px)) scaleY(1.15); opacity: 0; }
  }

  /* Clouds */
  .wx-cloud {
    position: absolute;
    height: 64px;
    border-radius: 50%;
    background:
      radial-gradient(ellipse 58% 62% at 28% 55%, rgba(230, 238, 248, 0.34) 0%, transparent 72%),
      radial-gradient(ellipse 52% 58% at 54% 42%, rgba(220, 232, 245, 0.28) 0%, transparent 74%),
      radial-gradient(ellipse 48% 52% at 78% 58%, rgba(210, 224, 240, 0.22) 0%, transparent 76%);
    filter: blur(16px);
    animation: wx-cloud-drift var(--cloud-dur, 32s) linear var(--cloud-delay, 0s) infinite;
    will-change: left;
  }

  @keyframes wx-cloud-drift {
    0%   { left: -32%; }
    100% { left: 112%; }
  }

  /* Fog */
  .wx-fog {
    position: absolute;
    height: 100px;
    border-radius: 50%;
    background: radial-gradient(
      ellipse 70% 55% at 50% 50%,
      rgba(210, 222, 235, 0.38) 0%,
      rgba(195, 208, 222, 0.14) 48%,
      transparent 78%
    );
    filter: blur(24px);
    animation: wx-fog-drift var(--fog-dur, 22s) linear var(--fog-delay, 0s) infinite;
    will-change: left;
  }

  @keyframes wx-fog-drift {
    0%   { left: -38%; }
    100% { left: 118%; }
  }

  /* Gloom */
  .gloom-overlay {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(20, 28, 40, 0.22) 0%, transparent 68%),
      linear-gradient(180deg, rgba(18, 26, 38, 0.14) 0%, rgba(30, 40, 55, 0.06) 100%);
    z-index: 1;
  }

  /* Snow */
  .wx-flake {
    position: absolute;
    top: -4%;
    border-radius: 50%;
    background: radial-gradient(
      circle at 35% 32%,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(235, 245, 255, 0.7) 45%,
      rgba(210, 228, 255, 0.28) 100%
    );
    box-shadow:
      0 0 8px rgba(220, 235, 255, 0.4),
      0 0 18px rgba(190, 215, 255, 0.2);
    animation: wx-snow var(--fall-dur, 5s) linear var(--fall-delay, 0s) infinite;
    will-change: top, transform;
  }

  @keyframes wx-snow {
    0%   { top: -4%; transform: translateX(0) rotate(0deg); opacity: 0; }
    10%  { opacity: var(--fall-op, 0.7); }
    88%  { opacity: calc(var(--fall-op, 0.7) * 0.8); }
    100% { top: 108%; transform: translateX(var(--drift, 18px)) rotate(320deg); opacity: 0; }
  }

  /* Storm lightning */
  .wx-lightning {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      185deg,
      rgba(220, 232, 255, 0.55) 0%,
      rgba(190, 210, 255, 0.14) 38%,
      transparent 72%
    );
    opacity: 0;
    animation: wx-flash 6.5s ease-out infinite;
    mix-blend-mode: screen;
  }
  .wx-lightning--delayed {
    animation-delay: -3.2s;
    animation-duration: 8.4s;
  }

  @keyframes wx-flash {
    0%, 84%, 100% { opacity: 0; }
    85% { opacity: 0.7; }
    86% { opacity: 0.08; }
    87.5% { opacity: 0.95; }
    89% { opacity: 0.05; }
    90% { opacity: 0.5; }
    92% { opacity: 0; }
  }

  /* Sun — quiet, minimal: soft glow + matte disc (no rays / spin) */
  .sun {
    position: absolute;
    top: -18px;
    right: 8px;
    width: 180px;
    height: 180px;
    pointer-events: none;
    --sun-size: 48px;
  }

  .sun--hero {
    --sun-size: 56px;
    top: -14px;
    right: 12px;
  }

  .sun-glow {
    position: absolute;
    inset: 16%;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      rgba(255, 200, 120, 0.16) 0%,
      rgba(255, 185, 100, 0.07) 40%,
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
    box-shadow: 0 0 28px rgba(255, 195, 115, 0.14);
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

  /* ── INFO CARDS ── */
  .wd-cards {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
    padding: 0 16px 16px;
  }

  .wd-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 8px;
    background: var(--background-secondary, rgba(255,255,255,0.04));
    border: 1px solid var(--background-modifier-border, rgba(255,255,255,0.06));
    border-radius: 12px;
    text-align: center;
    transition: border-color 0.2s ease, box-shadow 0.28s ease, transform 0.18s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .wd-card:hover {
    border-color: rgba(255, 255, 255, 0.1);
    transform: translateY(-1px);
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.06),
      0 8px 24px color-mix(in srgb, var(--interactive-accent, #7c5cfc) 10%, transparent),
      0 0 40px color-mix(in srgb, var(--interactive-accent, #7c5cfc) 7%, transparent);
  }

  .wd-card-top {
    margin-bottom: 2px;
  }

  .wd-card-icon-card {
    font-size: 24px;
  }

  .wd-card-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-faint);
  }

  .wd-card-value {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-normal);
  }

  .wd-card-sub {
    font-size: 11px;
    color: var(--text-faint);
  }

  /* ── HOURLY TABLE ── */
  .wd-section {
    padding: 0 16px 16px;
  }

  .wd-section-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-normal);
    margin-bottom: 10px;
  }

  .wd-table-wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .wd-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    min-width: 560px;
  }

  .wd-table thead th {
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--text-faint);
    padding: 6px 8px;
    border-bottom: 1px solid var(--background-modifier-border, rgba(255,255,255,0.06));
  }

  .wd-th-time { width: 52px; }
  .wd-th-icon { width: 40px; text-align: center; }
  .wd-th-temp { width: auto; }
  .wd-th-feels { width: 70px; text-align: center; }
  .wd-th-wind { width: 100px; text-align: right; }
  .wd-th-hum { width: 70px; text-align: right; }

  .wd-table tbody tr {
    border-bottom: 1px solid var(--background-modifier-border, rgba(255,255,255,0.03));
    transition: background 0.1s;
  }

  .wd-table tbody tr:hover {
    background: var(--background-modifier-hover, rgba(255,255,255,0.03));
  }

  .wd-table tbody tr.wd-row-current {
    background: var(--background-modifier-hover, rgba(255,255,255,0.06));
  }

  .wd-table td {
    padding: 8px;
    color: var(--text-muted);
    vertical-align: middle;
  }

  .wd-td-time {
    font-weight: 600;
    color: var(--text-normal);
    font-variant-numeric: tabular-nums;
  }

  .wd-td-icon {
    text-align: center;
    font-size: 16px;
  }

  .wd-td-temp {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .wd-temp-val {
    min-width: 32px;
    font-weight: 600;
    color: var(--text-normal);
    font-variant-numeric: tabular-nums;
  }

  .wd-bar-track {
    flex: 1;
    height: 5px;
    background: var(--background-modifier-border, rgba(255,255,255,0.08));
    border-radius: 3px;
    overflow: hidden;
    max-width: 200px;
  }

  .wd-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4a90c4, var(--interactive-accent, #7c5cbf));
    border-radius: 3px;
    min-width: 3px;
    transition: width 0.3s;
    box-shadow: 0 0 8px color-mix(in srgb, var(--interactive-accent, #7c5cbf) 35%, transparent);
  }

  .wd-td-feels {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .wd-td-wind {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .wd-td-hum {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .wd-hum-icon {
    font-size: 10px;
    margin-right: 2px;
  }

  /* ── FOOTER ── */
  .wd-footer {
    display: flex;
    justify-content: space-between;
    padding: 12px 16px 16px;
    font-size: 11px;
    color: var(--text-faint);
  }

  /* ── RESPONSIVE ── */
  @media (max-width: 700px) {
    .wd-cards {
      grid-template-columns: repeat(3, 1fr);
    }
    .wd-hero-emoji {
      font-size: 56px;
    }
    .wd-hero-temp-num {
      font-size: 32px;
    }
  }

  @media (max-width: 500px) {
    .wd-hero {
      flex-direction: column-reverse;
      align-items: flex-start;
      padding: 20px;
    }
    .wd-hero-icon {
      margin-left: 0;
      margin-bottom: 8px;
    }
    .wd-hero-emoji {
      font-size: 48px;
    }
    .wd-hero-temp-num {
      font-size: 28px;
    }
    .wd-cards {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
