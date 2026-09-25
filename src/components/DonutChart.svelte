<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { t } from "../i18n";
  import { animateProgress, easeOutCubic, easeOutBack, countUp } from "../utils/visualMotion";

  export let segments: { label: string; value: number; color: string }[] = [];
  export let centerLabel: string = "";
  export let centerValue: string = "";

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  /** 0 → 1 overall entrance progress */
  let reveal = 0;
  let cancelReveal: (() => void) | null = null;
  let lastSegKey = "";
  let animKey = 0;

  $: total = segments.reduce((sum, s) => sum + s.value, 0);
  $: segKey = segments.map((s) => `${s.label}:${s.value}:${s.color}`).join("|");

  function playReveal(key: string, force = false) {
    if (!force && key === lastSegKey) return;
    lastSegKey = key;
    animKey += 1;
    cancelReveal?.();
    reveal = 0;
    drawChart();
    // Sweep + scale + text: one 1.1s timeline
    cancelReveal = animateProgress(
      1100,
      (p) => {
        reveal = p;
        drawChart();
      },
      easeOutCubic
    );
  }

  $: playReveal(segKey);

  function drawChart() {
    if (!canvas || !container || segments.length === 0 || total === 0) return;

    const rect = container.getBoundingClientRect();
    const size = Math.max(40, Math.min(rect.width || 220, 220));

    canvas.style.width = size + "px";
    canvas.style.height = size + "px";

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const computedStyles = getComputedStyle(document.documentElement);
    const textMuted =
      computedStyles.getPropertyValue("--mcp-text-muted").trim() ||
      "rgba(200, 210, 220, 0.5)";
    const textFaint =
      computedStyles.getPropertyValue("--mcp-text-faint").trim() ||
      "rgba(200, 210, 220, 0.25)";

    ctx.clearRect(0, 0, size, size);

    // Scale pop: 0.82 → 1 with a slight overshoot
    const scaleT = Math.min(1, reveal / 0.55);
    const scale = 0.82 + 0.18 * Math.max(0, easeOutBack(scaleT));

    const cx = size / 2;
    const cy = size / 2;
    const outerRadius = (size / 2 - 8) * scale;
    const innerRadius = outerRadius * 0.65;

    // Sweep across the full ring (easeOutCubic already applied to reveal)
    const sweepLimit = Math.PI * 2 * reveal;

    let startAngle = -Math.PI / 2;
    let drawnAngle = 0;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.value <= 0) continue;
      const sweep = (seg.value / total) * Math.PI * 2;

      // Each segment has its own staggered grow
      const segStart = (drawnAngle / (Math.PI * 2)) * 0.85;
      const segT = Math.min(1, Math.max(0, (reveal - segStart) / 0.25));
      const drawn = Math.min(sweep, Math.max(0, sweepLimit - drawnAngle)) * Math.min(1, segT * 1.15);

      if (drawn > 0.001) {
        const endAngle = startAngle + drawn;
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, startAngle, endAngle);
        ctx.arc(cx, cy, innerRadius, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = seg.color;
        ctx.fill();
      }

      startAngle += sweep;
      drawnAngle += sweep;
    }

    // Center text fades in after the ring is half-drawn
    const textAlpha = Math.min(1, Math.max(0, (reveal - 0.35) / 0.4));
    const textScale = 0.9 + 0.1 * textAlpha;

    if (centerValue) {
      ctx.save();
      ctx.translate(cx, cy - 6);
      ctx.scale(textScale, textScale);
      ctx.globalAlpha = textAlpha;
      ctx.fillStyle = textMuted;
      ctx.font = `bold 16px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(centerValue, 0, 0);
      ctx.restore();
    }
    if (centerLabel) {
      ctx.save();
      ctx.translate(cx, cy + 14);
      ctx.scale(textScale, textScale);
      ctx.globalAlpha = textAlpha;
      ctx.fillStyle = textFaint;
      ctx.font = `11px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(centerLabel, 0, 0);
      ctx.restore();
    }
  }

  onMount(() => {
    // Wait a frame so the container has layout before measuring/sizing
    requestAnimationFrame(() => {
      drawChart();
      playReveal(segKey, true);
    });
    const ro = new ResizeObserver(() => drawChart());
    ro.observe(container);
    return () => ro.disconnect();
  });

  onDestroy(() => {
    cancelReveal?.();
  });
</script>

<div class="donut-chart" bind:this={container}>
  {#if segments.length === 0 || total === 0}
    <div class="donut-empty">{$t("components.noData")}</div>
  {:else}
    <canvas bind:this={canvas}></canvas>
    {#key animKey}
      <div class="donut-legend">
        {#each segments as seg, i}
          <div class="donut-legend-item" style="animation-delay: {0.15 + i * 0.09}s">
            <span class="donut-legend-dot" style="background: {seg.color}"></span>
            <span class="donut-legend-label">{seg.label}</span>
            <span
              class="donut-legend-value"
              use:countUp={{
                value: seg.value > 0 ? Math.round((seg.value / total) * 100) : 0,
                duration: 750,
                format: (n) => `${Math.round(n)}%`,
              }}
            ></span>
          </div>
        {/each}
      </div>
    {/key}
  {/if}
</div>

<style>
  .donut-chart {
    display: flex;
    align-items: center;
    gap: 20px;
    width: 100%;
  }

  canvas {
    flex-shrink: 0;
  }

  .donut-empty {
    text-align: center;
    padding: 20px 0;
    color: var(--mcp-text-faint);
    font-size: 12px;
    width: 100%;
  }

  .donut-legend {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .donut-legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    animation: donut-legend-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes donut-legend-in {
    from {
      opacity: 0;
      transform: translateX(12px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .donut-legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    animation: donut-dot-pop 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
    animation-delay: inherit;
  }

  @keyframes donut-dot-pop {
    from {
      transform: scale(0);
    }
    to {
      transform: scale(1);
    }
  }

  .donut-legend-label {
    color: var(--mcp-text-muted);
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .donut-legend-value {
    color: var(--mcp-text-muted);
    font-weight: 600;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 480px) {
    .donut-chart {
      flex-direction: column;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .donut-legend-item,
    .donut-legend-dot {
      animation: none !important;
    }
  }
</style>
