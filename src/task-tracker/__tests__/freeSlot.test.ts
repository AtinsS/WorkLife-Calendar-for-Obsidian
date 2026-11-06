import { buildLoadSummary, findFreeSlot, type BusySlot } from "../freeSlot";

describe("buildLoadSummary", () => {
  it("marks free days", () => {
    expect(buildLoadSummary([{ date: "2026-02-09", busy: [] }])).toBe("2026-02-09: free");
  });

  it("lists busy windows with booked hours", () => {
    const busy: BusySlot[] = [
      { scheduledTime: "14:00", endTime: "15:30" },
      { scheduledTime: "10:00", endTime: "11:00" },
    ];
    expect(buildLoadSummary([{ date: "2026-02-09", busy }])).toBe(
      "2026-02-09: busy 10:00-11:00, 14:00-15:30 (2.5h booked)",
    );
  });

  it("falls back to estimatedTime when endTime is missing", () => {
    const line = buildLoadSummary([
      { date: "2026-02-09", busy: [{ scheduledTime: "09:00", estimatedTime: 90 }] },
    ]);
    expect(line).toBe("2026-02-09: busy 09:00-10:30 (1.5h booked)");
  });

  it("skips entries without a start time", () => {
    expect(
      buildLoadSummary([{ date: "2026-02-09", busy: [{ estimatedTime: 60 }] }]),
    ).toBe("2026-02-09: free");
  });
});

describe("findFreeSlot", () => {
  it("places a task at day start when the day is empty", () => {
    expect(findFreeSlot([], 60)).toEqual({ scheduledTime: "09:00", endTime: "10:00" });
  });

  it("skips existing busy windows", () => {
    const slot = findFreeSlot(
      [
        { scheduledTime: "09:00", endTime: "10:30" },
        { scheduledTime: "10:30", endTime: "12:00" },
      ],
      60,
    );
    expect(slot).toEqual({ scheduledTime: "12:00", endTime: "13:00" });
  });

  it("returns null when the day has no room left", () => {
    expect(findFreeSlot([{ scheduledTime: "09:00", endTime: "21:00" }], 60)).toBeNull();
  });
});
