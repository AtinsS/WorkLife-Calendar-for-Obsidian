<script lang="ts">
  import { settings } from "../ui/stores";
  import { fetchDayDetail, type DayWeatherDetail, getWeatherAttribution } from "../services/weatherService";
  import { t } from "../i18n";

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
      if (m.isValid()) return m.format("D MMMM") + " в 00:00";
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
      <div class="wd-hero-anim {weatherClass}">
        {#if weatherClass === "wd-rain"}
          {#each Array(40) as _, __}
            <div class="raindrop" style="left: {Math.random() * 100}%; animation-delay: {Math.random() * 2}s; animation-duration: {0.5 + Math.random() * 0.5}s"></div>
          {/each}
        {:else if weatherClass === "wd-drizzle"}
          {#each Array(25) as _, __}
            <div class="raindrop" style="left: {Math.random() * 100}%; animation-delay: {Math.random() * 3}s; animation-duration: {0.8 + Math.random() * 0.5}s"></div>
          {/each}
        {:else if weatherClass === "wd-cloudy" || weatherClass === "wd-partly-cloudy"}
          {#each Array(4) as _, i}
            <div class="cloud" style="top: {10 + i * 18}%; animation-delay: {i * 4}s; opacity: {0.15 + Math.random() * 0.15}"></div>
          {/each}
        {:else if weatherClass === "wd-fog"}
          {#each Array(5) as _, i}
            <div class="fog-layer" style="top: {10 + i * 15}%; animation-delay: {i * 2.5}s; animation-duration: {18 + i * 4}s; opacity: {0.08 + i * 0.03}"></div>
          {/each}
        {:else if weatherClass === "wd-overcast"}
          <div class="gloom-overlay"></div>
        {:else if weatherClass === "wd-storm"}
          {#each Array(55) as _, __}
            <div class="raindrop heavy" style="left: {Math.random() * 100}%; animation-delay: {Math.random() * 1.5}s; animation-duration: {0.3 + Math.random() * 0.4}s"></div>
          {/each}
        {:else if weatherClass === "wd-snow"}
          {#each Array(40) as _, __}
            <div class="snowflake" style="left: {Math.random() * 100}%; animation-delay: {Math.random() * 5}s; animation-duration: {3 + Math.random() * 4}s; font-size: {8 + Math.random() * 10}px; opacity: {0.4 + Math.random() * 0.4}">*</div>
          {/each}
        {:else if weatherClass === "wd-clear"}
          <div class="sun">
            <div class="sun-core"></div>
            {#each Array(8) as _, i}
              <div class="sun-ray" style="transform: rotate({i * 45}deg)"></div>
            {/each}
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
                <th class="wd-th-time">Время</th>
                <th class="wd-th-icon">Погода</th>
                <th class="wd-th-temp">Температура</th>
                <th class="wd-th-feels">Ощущается</th>
                <th class="wd-th-wind">Ветер</th>
                <th class="wd-th-hum">Влажность</th>
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
  }

  .wd-hero::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 48px;
    background: linear-gradient(to bottom, transparent, var(--background-primary, #1a1a2e));
    pointer-events: none;
    z-index: 4;
  }

  .wd-clear {
    background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 40%, #4a90c4 100%);
  }
  .wd-partly-cloudy {
    background: linear-gradient(135deg, #2c3e50 0%, #4a6785 40%, #7f8c8d 100%);
  }
  .wd-cloudy {
    background: linear-gradient(135deg, #2c3e50 0%, #434e58 50%, #5a6970 100%);
  }
  .wd-overcast {
    background: linear-gradient(135deg, #1c2833 0%, #2c3e50 50%, #3d4f5f 100%);
  }
  .wd-fog {
    background: linear-gradient(135deg, #3a4a5c 0%, #5a6a7c 50%, #7a8a9c 100%);
  }
  .wd-drizzle {
    background: linear-gradient(135deg, #1c2833 0%, #2e4057 40%, #3d5a73 100%);
  }
  .wd-rain {
    background: linear-gradient(135deg, #0f1923 0%, #1a3040 40%, #2a4a60 100%);
  }
  .wd-snow {
    background: linear-gradient(135deg, #2c3e50 0%, #4a6070 40%, #6a8090 100%);
  }
  .wd-storm {
    background: linear-gradient(135deg, #0a0f14 0%, #1a2530 40%, #2a3a4a 100%);
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
    filter: drop-shadow(0 4px 12px rgba(0,0,0,0.3));
  }

  .wd-hero-date {
    font-size: 13px;
    color: rgba(255,255,255,0.6);
    margin-bottom: 4px;
  }

  .wd-hero-label {
    font-size: 16px;
    font-weight: 600;
    color: rgba(255,255,255,0.9);
    margin-bottom: 4px;
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
  }

  .wd-hero-temp-sep {
    font-size: 28px;
    font-weight: 300;
    color: rgba(255,255,255,0.5);
  }

  .wd-hero-feels {
    font-size: 13px;
    color: rgba(255,255,255,0.5);
    margin-bottom: 12px;
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
    color: rgba(255,255,255,0.7);
  }

  .wd-badge-icon {
    font-size: 14px;
  }

  /* ── WEATHER ANIMATIONS (from HelloView) ── */
  .wd-hero-anim {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 1;
  }

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
    100% { transform: translateY(calc(100% + 20px)); opacity: 0; }
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
    100% { transform: translateX(calc(100% + 200px)); }
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
    100% { transform: translateX(calc(100% + 300px)); }
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
    100% { transform: translateY(calc(100% + 20px)) rotate(360deg); opacity: 0; }
  }

  /* Storm flicker */
  .wd-storm {
    animation: storm-flicker 4s ease-in-out infinite;
  }

  @keyframes storm-flicker {
    0%, 95%, 100% { opacity: 1; }
    96% { opacity: 0.85; }
  }

  /* Sun */
  .sun {
    position: absolute;
    top: -30px;
    right: -30px;
    width: 120px;
    height: 120px;
    animation: sun-pulse 4s ease-in-out infinite;
  }

  .sun-core {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 50px; height: 50px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 214, 0, 0.3) 0%, rgba(255, 183, 77, 0.1) 60%, transparent 100%);
    box-shadow: 0 0 40px rgba(255, 214, 0, 0.15), 0 0 80px rgba(255, 183, 77, 0.08);
  }

  .sun-ray {
    position: absolute;
    top: 50%; left: 50%;
    width: 2px; height: 40px;
    background: linear-gradient(180deg, rgba(255, 214, 0, 0.2), transparent);
    transform-origin: center top;
    border-radius: 1px;
  }

  @keyframes sun-pulse {
    0%, 100% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.05); opacity: 1; }
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
