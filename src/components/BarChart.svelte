<script lang="ts">
  import { onMount, afterUpdate, onDestroy } from "svelte";
  import type { TimeLog } from "../task-tracker/types";
  import { formatDuration } from "../task-tracker/TimerManager";
  import { t, locale } from "../i18n";
  import { animateProgress } from "../utils/visualMotion";

  export let logs: TimeLog[] = [];
  export let extraTimeByDate: Map<string, number> = new Map();
  export let mode: "bar" | "area" = "bar";
  /** Optional pre-aggregated series (e.g. weight). When set, logs/extraTimeByDate are ignored. */
  export let points: { date: string; value: number }[] | null = null;
  /** Value formatter for labels/tooltip/summary — default is duration. */
  export let formatValue: (v: number) => string = (v) => formatDuration(v);
  export let maxBars = 14;
  export let emptyText: string | null = null;
  /** When false, Y axis is scaled to data range (needed for weight, not time-from-zero). */
  export let zeroBased = true;
  /** "sum" = total of values (time), "last" = latest value (weight). */
  export let summaryMode: "sum" | "last" = "sum";

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let hoveredBar: number = -1;
  let reveal = 1;
  let cancelReveal: (() => void) | null = null;
  let lastDataKey = "";

  interface DayData {
    date: string;
    label: string;
    totalMs: number;
  }

  function aggregateByDay(
    logsArg: TimeLog[],
    extra: Map<string, number>,
    currentLocale: string,
    pointsArg: { date: string; value: number }[] | null,
    maxBarsArg: number
  ): DayData[] {
    const fmtDate = (date: string) => {
      const d = new Date(date + "T12:00:00");
      return d.toLocaleDateString(currentLocale === "ru" ? "ru-RU" : "en-US", {
        day: "numeric",
        month: "short",
      });
    };

    if (pointsArg) {
      const result: DayData[] = pointsArg.map((p) => ({
        date: p.date,
        label: fmtDate(p.date),
        totalMs: p.value,
      }));
      result.sort((a, b) => a.date.localeCompare(b.date));
      if (result.length > maxBarsArg) {
        return result.slice(result.length - maxBarsArg);
      }
      return result;
    }

    const map = new Map<string, number>();
    for (const log of logsArg) {
      map.set(log.date, (map.get(log.date) || 0) + log.duration);
    }
    for (const [date, ms] of extra) {
      map.set(date, (map.get(date) || 0) + ms);
    }

    const result: DayData[] = [];
    for (const [date, totalMs] of map) {
      result.push({ date, label: fmtDate(date), totalMs });
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    if (result.length > maxBarsArg) {
      return result.slice(result.length - maxBarsArg);
    }
    return result;
  }

  // points / maxBars must be in the reactive expression — Svelte does not
  // track them via the function body alone.
  $: dayData = aggregateByDay(logs, extraTimeByDate, $locale, points, maxBars);
  $: maxMs = dayData.length > 0 ? Math.max(...dayData.map((d) => d.totalMs)) : 0;
  $: minMs = dayData.length > 0 ? Math.min(...dayData.map((d) => d.totalMs)) : 0;
  $: summaryTotal =
    summaryMode === "last" && dayData.length > 0
      ? dayData[dayData.length - 1].totalMs
      : dayData.reduce((s, d) => s + d.totalMs, 0);
  $: summaryAvg =
    dayData.length > 0
      ? dayData.reduce((s, d) => s + d.totalMs, 0) / dayData.length
      : 0;

  let dpr = 1;

  function playReveal(dataKey: string) {
    if (dataKey === lastDataKey) return;
    lastDataKey = dataKey;
    cancelReveal?.();
    cancelReveal = animateProgress(mode === "area" ? 720 : 560, (p) => {
      reveal = p;
      drawChart();
    });
  }

  $: playReveal(dayData.map((d) => `${d.date}:${d.totalMs}`).join("|"));

  function drawChart() {
    if (!canvas || !container || dayData.length === 0) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = Math.min(160, Math.max(100, rect.width * 0.45));

    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const computedStyles = getComputedStyle(document.documentElement);
    const accentColor = computedStyles.getPropertyValue("--mcp-accent").trim() || "rgba(95, 153, 225, 0.479)";
    const textMuted = computedStyles.getPropertyValue("--mcp-text-muted").trim() || "rgba(200, 210, 220, 0.5)";
    const textFaint = computedStyles.getPropertyValue("--mcp-text-faint").trim() || "rgba(200, 210, 220, 0.25)";

    ctx.clearRect(0, 0, width, height);

    const paddingLeft = 8;
    const paddingRight = 8;
    const paddingTop = 18;
    const paddingBottom = 24;
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const barCount = dayData.length;
    const barGap = Math.max(3, Math.min(8, chartWidth / barCount * 0.2));
    const barWidth = Math.max(4, (chartWidth - barGap * (barCount + 1)) / barCount);

    // Parse accent color
    const accentMatch = accentColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    let barR = 95, barG = 153, barB = 225, barA = 0.85;
    if (accentMatch) {
      barR = parseInt(accentMatch[1]);
      barG = parseInt(accentMatch[2]);
      barB = parseInt(accentMatch[3]);
      barA = accentMatch[4] ? parseFloat(accentMatch[4]) : 0.85;
    }

    // Draw horizontal grid lines
    const gridLines = 3;
    ctx.strokeStyle = textFaint;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 3]);
    for (let i = 1; i <= gridLines; i++) {
      const y = paddingTop + chartHeight - (chartHeight * i) / gridLines;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(width - paddingRight, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Y mapping: zero-based (time) or data-range (weight)
    const yFor = (v: number): number => {
      if (zeroBased) {
        return paddingTop + chartHeight - (maxMs > 0 ? (v / maxMs) * chartHeight : 0);
      }
      const span = Math.max(maxMs - minMs, 0.5);
      const pad = span * 0.12;
      const lo = minMs - pad;
      const hi = maxMs + pad;
      return paddingTop + chartHeight - ((v - lo) / (hi - lo)) * chartHeight;
    };

    if (mode === "area") {
      // ── Area / Line chart with Catmull-Rom spline ──
      const points: { x: number; y: number }[] = [];

      for (let i = 0; i < barCount; i++) {
        const d = dayData[i];
        const stagger = barCount <= 1 ? 1 : Math.min(1, Math.max(0, (reveal - i * 0.035) / 0.7));
        const baseY = paddingTop + chartHeight;
        const fullY = yFor(d.totalMs);
        // Stagger from baseline toward the value
        const y = baseY + (fullY - baseY) * stagger;
        const x = paddingLeft + barGap + i * (barWidth + barGap) + barWidth / 2;
        points.push({ x, y });
      }

      if (points.length > 1) {
        // Catmull-Rom to Bezier conversion for smooth curves
        const tension = 0.3;

        // Area fill
        ctx.beginPath();
        ctx.moveTo(points[0].x, paddingTop + chartHeight);
        ctx.lineTo(points[0].x, points[0].y);

        for (let i = 0; i < points.length - 1; i++) {
          const p0 = points[Math.max(0, i - 1)];
          const p1 = points[i];
          const p2 = points[i + 1];
          const p3 = points[Math.min(points.length - 1, i + 2)];

          const cp1x = p1.x + (p2.x - p0.x) * tension;
          const cp1y = p1.y + (p2.y - p0.y) * tension;
          const cp2x = p2.x - (p3.x - p1.x) * tension;
          const cp2y = p2.y - (p3.y - p1.y) * tension;

          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
        ctx.lineTo(points[points.length - 1].x, paddingTop + chartHeight);
        ctx.closePath();

        const areaGrad = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartHeight);
        areaGrad.addColorStop(0, `rgba(${barR}, ${barG}, ${barB}, ${barA * 0.4})`);
        areaGrad.addColorStop(0.5, `rgba(${barR}, ${barG}, ${barB}, ${barA * 0.15})`);
        areaGrad.addColorStop(1, `rgba(${barR}, ${barG}, ${barB}, 0.01)`);
        ctx.fillStyle = areaGrad;
        ctx.fill();

        // Line with glow
        ctx.save();
        ctx.shadowColor = `rgba(${barR}, ${barG}, ${barB}, 0.5)`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          const cp1x = points[i - 1].x + (points[i].x - points[Math.max(0, i - 2)].x) * tension;
          const cp1y = points[i - 1].y + (points[i].y - points[Math.max(0, i - 2)].y) * tension;
          const cp2x = points[i].x - (points[Math.min(points.length - 1, i + 1)].x - points[i - 1].x) * tension;
          const cp2y = points[i].y - (points[Math.min(points.length - 1, i + 1)].y - points[i - 1].y) * tension;
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, points[i].x, points[i].y);
        }
        ctx.strokeStyle = `rgba(${barR}, ${barG}, ${barB}, ${barA})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }

      // Draw dots and labels
      for (let i = 0; i < barCount; i++) {
        const d = dayData[i];
        const p = points[i];
        const isHovered = i === hoveredBar;

        // Outer glow for hovered
        if (isHovered) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${barR}, ${barG}, ${barB}, 0.15)`;
          ctx.fill();
        }

        // Dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, isHovered ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = isHovered ? `rgba(${barR}, ${barG}, ${barB}, 1)` : `rgba(${barR}, ${barG}, ${barB}, 0.8)`;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = isHovered ? 2 : 1.5;
        ctx.stroke();

        // Duration label on hover
        if (isHovered) {
          ctx.fillStyle = textMuted;
          ctx.font = `bold 10px sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(formatValue(d.totalMs), p.x, p.y - 10);
        }

        // Date label
        ctx.fillStyle = isHovered ? textMuted : textFaint;
        ctx.font = `${Math.max(8, Math.min(10, barWidth * 0.6))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(d.label, p.x, height - 6);
      }
    } else {
      // ── Bar chart (original) ──
      for (let i = 0; i < barCount; i++) {
        const d = dayData[i];
        const stagger = barCount <= 1 ? 1 : Math.min(1, Math.max(0, (reveal - i * 0.04) / 0.72));
        const baseY = paddingTop + chartHeight;
        const fullY = yFor(d.totalMs);
        const y = baseY + (fullY - baseY) * stagger;
        const x = paddingLeft + barGap + i * (barWidth + barGap);

        const isHovered = i === hoveredBar;

        const radius = Math.min(4, barWidth / 3);
        ctx.beginPath();
        ctx.moveTo(x, y + radius);
        ctx.arcTo(x, y, x + radius, y, radius);
        ctx.arcTo(x + barWidth, y, x + barWidth, y + radius, radius);
        ctx.lineTo(x + barWidth, paddingTop + chartHeight);
        ctx.lineTo(x, paddingTop + chartHeight);
        ctx.closePath();

        if (isHovered) {
          ctx.fillStyle = `rgba(${barR}, ${barG}, ${barB}, 1)`;
        } else {
          const grad = ctx.createLinearGradient(x, y, x, paddingTop + chartHeight);
          grad.addColorStop(0, `rgba(${barR}, ${barG}, ${barB}, ${barA})`);
          grad.addColorStop(1, `rgba(${barR}, ${barG}, ${barB}, ${barA * 0.4})`);
          ctx.fillStyle = grad;
        }
        ctx.fill();

        if (isHovered) {
          ctx.shadowColor = `rgba(${barR}, ${barG}, ${barB}, 0.4)`;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        ctx.fillStyle = isHovered ? textMuted : textFaint;
        ctx.font = `${Math.max(8, Math.min(10, barWidth * 0.6))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(d.label, x + barWidth / 2, height - 6);
      }

      // Duration label on top of hovered bar
      if (hoveredBar >= 0 && hoveredBar < barCount) {
        const d = dayData[hoveredBar];
        const stagger = barCount <= 1 ? 1 : Math.min(1, Math.max(0, (reveal - hoveredBar * 0.04) / 0.72));
        const baseY = paddingTop + chartHeight;
        const y = baseY + (yFor(d.totalMs) - baseY) * stagger;
        const x = paddingLeft + barGap + hoveredBar * (barWidth + barGap);

        ctx.fillStyle = textMuted;
        ctx.font = `bold ${Math.max(9, Math.min(11, barWidth * 0.7))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(formatValue(d.totalMs), x + barWidth / 2, y - 4);
      }
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!canvas || dayData.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const width = rect.width;

    const paddingLeft = 0;
    const paddingRight = 8;
    const chartWidth = width - paddingLeft - paddingRight;
    const barGap = Math.max(3, Math.min(8, chartWidth / dayData.length * 0.2));
    const barWidth = Math.max(4, (chartWidth - barGap * (dayData.length + 1)) / dayData.length);

    const idx = Math.floor((mouseX - paddingLeft - barGap) / (barWidth + barGap));
    if (idx >= 0 && idx < dayData.length) {
      hoveredBar = idx;
    } else {
      hoveredBar = -1;
    }
    drawChart();
  }

  function handleMouseLeave() {
    hoveredBar = -1;
    drawChart();
  }

  onMount(() => {
    drawChart();
    const ro = new ResizeObserver(() => drawChart());
    ro.observe(container);
    return () => ro.disconnect();
  });

  afterUpdate(() => {
    drawChart();
  });

  onDestroy(() => {
    cancelReveal?.();
  });
</script>

<div class="bar-chart-container" bind:this={container}>
  {#if dayData.length === 0}
    <div class="bar-chart-empty">{emptyText ?? $t("components.noChartData")}</div>
  {:else}
    <canvas
      bind:this={canvas}
      on:mousemove={handleMouseMove}
      on:mouseleave={handleMouseLeave}
    ></canvas>
    <div class="bar-chart-summary">
      <span class="bar-chart-total">{$t("components.total", { value: formatValue(summaryTotal) })}</span>
      <span class="bar-chart-avg">{$t("components.average", { value: formatValue(summaryAvg) })}</span>
    </div>
  {/if}
</div>

<style>
  .bar-chart-container {
    width: 100%;
    position: relative;
  }

  canvas {
    display: block;
    width: 100%;
    cursor: crosshair;
  }

  .bar-chart-empty {
    text-align: center;
    padding: 20px 0;
    color: var(--mcp-text-faint);
    font-size: 12px;
  }

  .bar-chart-summary {
    display: flex;
    justify-content: space-between;
    padding: 6px 0 2px;
    font-size: 11px;
    color: var(--mcp-text-muted);
  }

  .bar-chart-total {
    font-weight: 600;
  }

  .bar-chart-avg {
    color: var(--mcp-text-faint);
  }

  @media (max-width: 480px) {
    .bar-chart-summary {
      font-size: 10px;
      flex-direction: column;
      gap: 2px;
      text-align: center;
    }
  }
</style>
