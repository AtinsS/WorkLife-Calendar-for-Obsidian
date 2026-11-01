import {
  customEventsToOccurrences,
  customEventEndKey,
  type ICustomEvent,
} from "../customEvents";

function ev(partial: Partial<ICustomEvent> & { id: string; startDate: string }): ICustomEvent {
  return {
    title: "Event",
    allDay: true,
    ...partial,
  };
}

function dayRange(from: string, to: string): [Date, Date] {
  return [new Date(`${from}T00:00:00`), new Date(`${to}T00:00:00`)];
}

describe("customEventsToOccurrences", () => {
  it("returns all-day events inside a half-open day range", () => {
    const events = [
      ev({ id: "a", startDate: "2026-05-09", title: "День Победы" }),
      ev({ id: "b", startDate: "2026-05-10", title: "Завтра" }),
    ];
    const occ = customEventsToOccurrences(events, "Мои события", ...dayRange("2026-05-09", "2026-05-10"));
    expect(occ.map((o) => o.occurrence.summary)).toEqual(["День Победы"]);
    expect(occ[0].subscription.name).toBe("Мои события");
    expect(occ[0].subscription.id).toBe("custom-events");
    // Per-event color falls back to the «Мои события» default
    expect(occ[0].subscription.color).toBe("#8e44ad");
  });

  it("passes a per-event color to the synthetic subscription", () => {
    const events = [
      ev({ id: "a", startDate: "2026-05-09", title: "Цветное", color: "#22cc88" }),
    ];
    const occ = customEventsToOccurrences(events, "Мои", ...dayRange("2026-05-09", "2026-05-10"));
    expect(occ[0].subscription.color).toBe("#22cc88");
  });

  it("includes multi-day events overlapping the range", () => {
    const events = [
      ev({ id: "m", startDate: "2026-07-01", endDate: "2026-07-11", title: "Отпуск" }),
    ];
    const occ = customEventsToOccurrences(events, "Мои", ...dayRange("2026-07-05", "2026-07-06"));
    expect(occ).toHaveLength(1);
    expect(occ[0].occurrence.endDate).toBe("2026-07-11");
    expect(customEventEndKey(events[0])).toBe("2026-07-11");
  });

  it("handles timed events with start/end times", () => {
    const events = [
      ev({
        id: "t",
        startDate: "2026-03-10",
        allDay: false,
        startTime: "15:00",
        endTime: "16:30",
        title: "Встреча",
      }),
    ];
    const occ = customEventsToOccurrences(events, "Мои", ...dayRange("2026-03-10", "2026-03-11"));
    expect(occ).toHaveLength(1);
    expect(occ[0].occurrence.allDay).toBe(false);
    expect(occ[0].occurrence.startMs).toBe(new Date(2026, 2, 10, 15, 0, 0).getTime());
    expect(occ[0].occurrence.endMs).toBe(new Date(2026, 2, 10, 16, 30, 0).getTime());
  });

  it("skips timed events outside the range", () => {
    const events = [
      ev({ id: "t", startDate: "2026-03-10", allDay: false, startTime: "10:00", title: "Мимо" }),
    ];
    const occ = customEventsToOccurrences(events, "Мои", ...dayRange("2026-03-11", "2026-03-12"));
    expect(occ).toHaveLength(0);
  });
});
