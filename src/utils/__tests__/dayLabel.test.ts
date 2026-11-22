import { formatDayLabel } from "../moment";

describe("formatDayLabel", () => {
  it("puts the weekday first and the year last", () => {
    // 2026-05-12 is a Tuesday
    const label = formatDayLabel("2026-05-12");
    expect(label.toLowerCase()).toMatch(/вторник|tuesday/);
    expect(label).toMatch(/\d{1,2}\s\S+\s2026$/);
  });

  it("abbreviates the weekday in the short form", () => {
    // 2026-05-12 is a Tuesday; short form keeps the year
    const label = formatDayLabel("2026-05-12", true);
    expect(label.toLowerCase()).toMatch(/^(вт\.?|tu), /);
    expect(label).toMatch(/\d{1,2}\s\S+\s2026$/);
    expect(label.length).toBeLessThan(formatDayLabel("2026-05-12").length);
  });

  it("returns the input unchanged when the date is invalid", () => {
    expect(formatDayLabel("not-a-date")).toBe("not-a-date");
    expect(formatDayLabel("")).toBe("");
    expect(formatDayLabel("2026-13-45")).toBe("2026-13-45");
    expect(formatDayLabel("not-a-date", true)).toBe("not-a-date");
  });
});
