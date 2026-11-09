export interface SunPosition {
  /** Percent across the container (0-100). */
  left: number;
  /** Percent down from the top (0-100). */
  top: number;
  /** False outside the sunrise→sunset window (night). */
  visible: boolean;
}

/**
 * Place the sun on a day arc: sunrise at the left edge, apex at noon,
 * sunset at the right edge. Pure function of the clock — the caller
 * repaints it as time passes. The arc is a sine, so the sun eases near
 * the horizon and sweeps fastest around noon.
 */
export function sunArcPosition(
  sunriseHm: string,
  sunsetHm: string,
  now: Date,
  opts?: { leftPad?: number; rightPad?: number; topHigh?: number; topLow?: number },
): SunPosition {
  const parse = (hm: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((hm || "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (Number.isNaN(h) || Number.isNaN(min) || h > 23 || min > 59) return null;
    return h * 60 + min;
  };

  const startMin = parse(sunriseHm);
  const endMin = parse(sunsetHm);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const leftPad = opts?.leftPad ?? 10;
  const rightPad = opts?.rightPad ?? 10;
  const topLow = opts?.topLow ?? 58;
  const topHigh = opts?.topHigh ?? 8;

  if (startMin == null || endMin == null || endMin <= startMin) {
    return { left: 50, top: topHigh, visible: false };
  }

  const p = (nowMin - startMin) / (endMin - startMin);
  if (p < 0 || p > 1) {
    return { left: p < 0 ? leftPad : 100 - rightPad, top: topLow, visible: false };
  }

  return {
    left: leftPad + (100 - leftPad - rightPad) * p,
    top: topLow - (topLow - topHigh) * Math.sin(Math.PI * p),
    visible: true,
  };
}
