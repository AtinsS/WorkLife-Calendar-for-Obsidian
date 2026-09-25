import {
  animateProgress,
  countUp,
  easeOutCubic,
  prefersReducedMotion,
} from "../visualMotion";

describe("visualMotion", () => {
  beforeEach(() => {
    jest.useFakeTimers("modern");
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function mockReducedMotion(reduce: boolean) {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addListener: jest.fn(),
      removeListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  function mockRaf() {
    let id = 0;
    const timers = new Map<number, number>();
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const handle = ++id;
      timers.set(handle, window.setTimeout(() => cb(performance.now()), 16) as unknown as number);
      return handle;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => {
      const t = timers.get(handle);
      if (t !== undefined) window.clearTimeout(t);
      timers.delete(handle);
    }) as typeof window.cancelAnimationFrame;
  }

  test("easeOutCubic starts at 0 and ends at 1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  test("prefersReducedMotion reflects media query", () => {
    mockReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    mockReducedMotion(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  test("animateProgress jumps to 1 when reduced motion", () => {
    mockReducedMotion(true);
    const frames: number[] = [];
    animateProgress(300, (p) => frames.push(p));
    expect(frames).toEqual([1]);
  });

  test("animateProgress eases from 0 toward 1 over time", () => {
    mockReducedMotion(false);
    mockRaf();
    const frames: number[] = [];
    const cancel = animateProgress(300, (p) => frames.push(p));

    // First rAF tick (~16ms)
    jest.advanceTimersByTime(20);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toBeGreaterThanOrEqual(0);
    expect(frames[0]).toBeLessThan(1);

    jest.advanceTimersByTime(400);
    expect(frames[frames.length - 1]).toBe(1);
    cancel();
  });

  test("countUp formats the target value when reduced motion", () => {
    mockReducedMotion(true);
    const node = document.createElement("span");
    countUp(node, { value: 42, format: (n) => `#${Math.round(n)}` });
    expect(node.textContent).toBe("#42");
  });

  test("countUp update re-animates to the new value", () => {
    mockReducedMotion(true);
    const node = document.createElement("span");
    const action = countUp(node, { value: 10, format: (n) => String(Math.round(n)) });
    expect(node.textContent).toBe("10");

    action.update({ value: 25, format: (n) => String(Math.round(n)) });
    expect(node.textContent).toBe("25");
  });
});
