import { sunArcPosition } from "../sunPosition";

const at = (h: number, m = 0) => new Date(2026, 5, 1, h, m, 0, 0);

describe("sunArcPosition", () => {
  it("places sunrise near the left edge, sunset near the right", () => {
    const rise = sunArcPosition("06:00", "20:00", at(6, 0));
    const set = sunArcPosition("06:00", "20:00", at(20, 0));
    expect(rise.visible).toBe(true);
    expect(rise.left).toBeLessThan(15);
    expect(set.left).toBeGreaterThan(85);
  });

  it("puts noon at the horizontal centre and the arc apex", () => {
    const noon = sunArcPosition("06:00", "20:00", at(13, 0));
    expect(noon.visible).toBe(true);
    expect(Math.abs(noon.left - 50)).toBeLessThan(1);
    expect(noon.top).toBeLessThan(15);
  });

  it("is low near the horizon and high at the apex", () => {
    const morning = sunArcPosition("06:00", "20:00", at(7, 0));
    const noon = sunArcPosition("06:00", "20:00", at(13, 0));
    expect(morning.top).toBeGreaterThan(noon.top);
  });

  it("hides the sun outside the sunrise→sunset window", () => {
    expect(sunArcPosition("06:00", "20:00", at(3, 0)).visible).toBe(false);
    expect(sunArcPosition("06:00", "20:00", at(22, 0)).visible).toBe(false);
  });

  it("falls back safely on malformed input", () => {
    const r = sunArcPosition("", "bad", at(12, 0));
    expect(r.visible).toBe(false);
  });
});
