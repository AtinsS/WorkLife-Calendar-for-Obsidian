/** Shared motion helpers for analytics surfaces. */

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Run a 0→1 progress animation. Resolves at 1 when motion is reduced. */
export function animateProgress(
  duration: number,
  onFrame: (progress: number) => void,
  easing: (t: number) => number = easeOutCubic,
): () => void {
  if (prefersReducedMotion()) {
    onFrame(1);
    return () => {
      /* no-op cancel */
    };
  }

  let raf = 0;
  let cancelled = false;
  const start = performance.now();

  const tick = (now: number) => {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / duration);
    onFrame(easing(t));
    if (t < 1) raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

export interface CountUpParams {
  value: number;
  duration?: number;
  format?: (n: number) => string;
}

/** Svelte action: tick a numeric label from its previous value to the new one. */
export function countUp(
  node: HTMLElement,
  params: number | CountUpParams,
): { update: (next: number | CountUpParams) => void; destroy: () => void } {
  let cancel: (() => void) | null = null;
  let lastShown = 0;

  function run(target: number, format: (n: number) => string, duration: number) {
    cancel?.();
    const from = lastShown;
    if (prefersReducedMotion() || duration <= 0) {
      lastShown = target;
      node.textContent = format(target);
      return;
    }
    cancel = animateProgress(duration, (p) => {
      const current = from + (target - from) * p;
      lastShown = current;
      node.textContent = format(current);
    });
  }

  function apply(raw: number | CountUpParams) {
    const value = typeof raw === "number" ? raw : raw.value;
    const duration = (typeof raw === "number" ? 700 : raw.duration) ?? 700;
    const format =
      (typeof raw === "number" ? undefined : raw.format) ??
      ((n: number) => Math.round(n).toLocaleString());
    run(value, format, duration);
  }

  apply(params);

  return {
    update(next: number | CountUpParams) {
      apply(next);
    },
    destroy() {
      cancel?.();
    },
  };
}
