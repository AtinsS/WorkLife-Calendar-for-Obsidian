import { parseIcs, expandIcsEvents } from "../icsFeed";

function ics(body: string): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Test Cal", body, "END:VCALENDAR"].join("\r\n");
}

function event(props: string[]): string {
  return ["BEGIN:VEVENT", ...props, "END:VEVENT"].join("\r\n");
}

function expandRange(cal: ReturnType<typeof parseIcs>, from: string, to: string): ReturnType<typeof expandIcsEvents> {
  return expandIcsEvents(cal, new Date(from + "T00:00:00"), new Date(to + "T00:00:00"));
}

describe("parseIcs", () => {
  it("parses an all-day VEVENT with calendar name and description", () => {
    const cal = parseIcs(
      ics(
        event([
          "DTSTART;VALUE=DATE:20260101",
          "DTEND;VALUE=DATE:20260102",
          "UID:ny-2026@google.com",
          "SUMMARY:Новый Год",
          "DESCRIPTION:Государственный праздник",
        ]),
      ),
    );
    expect(cal.name).toBe("Test Cal");
    expect(cal.events).toHaveLength(1);
    const ev = cal.events[0];
    expect(ev.allDay).toBe(true);
    expect(ev.startDate).toBe("2026-01-01");
    expect(ev.endDate).toBe("2026-01-02");
    expect(ev.summary).toBe("Новый Год");
    expect(ev.description).toBe("Государственный праздник");
  });

  it("defaults all-day end date to one day when DTEND is missing", () => {
    const cal = parseIcs(ics(event(["DTSTART;VALUE=DATE:20260509", "UID:v", "SUMMARY:День Победы"])));
    expect(cal.events[0].endDate).toBe("2026-05-10");
  });

  it("unfolds continuation lines", () => {
    const cal = parseIcs(
      ics(
        event([
          "DTSTART;VALUE=DATE:20260612",
          "UID:ru",
          "SUMMARY:Длинное название праздника, которое переносится",
          "  на следующую строку",
        ]),
      ),
    );
    expect(cal.events[0].summary).toBe("Длинное название праздника, которое переносится на следующую строку");
  });

  it("unescapes text values", () => {
    const cal = parseIcs(
      ics(event(["DTSTART;VALUE=DATE:20260101", "UID:e", "SUMMARY:Half\\, part\\; two", "DESCRIPTION:Line1\\nLine2"])),
    );
    expect(cal.events[0].summary).toBe("Half, part; two");
    expect(cal.events[0].description).toBe("Line1\nLine2");
  });

  it("parses UTC date-times as absolute instants", () => {
    const cal = parseIcs(
      ics(event(["DTSTART:20260310T120000Z", "DTEND:20260310T133000Z", "UID:t", "SUMMARY:Call"])),
    );
    const ev = cal.events[0];
    expect(ev.allDay).toBe(false);
    expect(ev.startMs).toBe(Date.UTC(2026, 2, 10, 12, 0, 0));
    expect(ev.endMs).toBe(Date.UTC(2026, 2, 10, 13, 30, 0));
  });

  it("treats floating date-times as local wall clock", () => {
    const cal = parseIcs(
      ics(event(["DTSTART;TZID=Europe/Moscow:20260310T150000", "UID:f", "SUMMARY:Local"])),
    );
    const ev = cal.events[0];
    expect(ev.startMs).toBe(new Date(2026, 2, 10, 15, 0, 0).getTime());
    expect(ev.allDay).toBe(false);
  });
});

describe("expandIcsEvents", () => {
  it("returns non-recurring events inside the range only", () => {
    const cal = parseIcs(
      ics([
        event(["DTSTART;VALUE=DATE:20260223", "UID:a", "SUMMARY:23 февраля"]),
        event(["DTSTART;VALUE=DATE:20260701", "UID:b", "SUMMARY:Вне диапазона"]),
      ].join("\r\n")),
    );
    const occ = expandRange(cal, "2026-02-01", "2026-03-01");
    expect(occ.map((o) => o.summary)).toEqual(["23 февраля"]);
  });

  it("expands YEARLY recurrence (birthdays) across years", () => {
    const cal = parseIcs(
      ics(
        event([
          "DTSTART;VALUE=DATE:20200615",
          "RRULE:FREQ=YEARLY",
          "UID:bday",
          "SUMMARY:День рождения",
        ]),
      ),
    );
    const occ = expandRange(cal, "2026-01-01", "2028-12-31");
    expect(occ.map((o) => o.startDate)).toEqual(["2026-06-15", "2027-06-15", "2028-06-15"]);
  });

  it("expands MONTHLY recurrence with ordinal BYDAY (2nd Friday)", () => {
    const cal = parseIcs(
      ics(
        event([
          "DTSTART;VALUE=DATE:20260109",
          "RRULE:FREQ=MONTHLY;BYDAY=2FR",
          "UID:mf",
          "SUMMARY:Вторая пятница",
        ]),
      ),
    );
    const occ = expandRange(cal, "2026-01-01", "2026-04-01");
    expect(occ.map((o) => o.startDate)).toEqual(["2026-01-09", "2026-02-13", "2026-03-13"]);
  });

  it("expands WEEKLY recurrence with BYDAY and INTERVAL", () => {
    const cal = parseIcs(
      ics(
        event([
          "DTSTART;VALUE=DATE:20260105",
          "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
          "UID:w",
          "SUMMARY:Раз в две недели",
        ]),
      ),
    );
    const occ = expandRange(cal, "2026-01-01", "2026-01-26");
    expect(occ.map((o) => o.startDate)).toEqual([
      "2026-01-05", "2026-01-07", "2026-01-19", "2026-01-21",
    ]);
  });

  it("honors COUNT and UNTIL", () => {
    const cal = parseIcs(
      ics([
        event(["DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;COUNT=3", "UID:c", "SUMMARY:COUNT"]),
        event(["DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;UNTIL=20260104", "UID:u", "SUMMARY:UNTIL"]),
      ].join("\r\n")),
    );
    const occ = expandRange(cal, "2026-01-01", "2026-01-31");
    expect(occ.filter((o) => o.summary === "COUNT").map((o) => o.startDate)).toEqual([
      "2026-01-01", "2026-01-02", "2026-01-03",
    ]);
    expect(occ.filter((o) => o.summary === "UNTIL").map((o) => o.startDate)).toEqual([
      "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
    ]);
  });

  it("skips EXDATE occurrences", () => {
    const cal = parseIcs(
      ics(
        event([
          "DTSTART;VALUE=DATE:20260101",
          "RRULE:FREQ=DAILY;COUNT=5",
          "EXDATE;VALUE=DATE:20260102,20260103",
          "UID:x",
          "SUMMARY:С исключениями",
        ]),
      ),
    );
    const occ = expandRange(cal, "2026-01-01", "2026-01-31");
    // COUNT bounds the rule before exclusions: 5 generated, 2 excluded → 3 remain
    expect(occ.map((o) => o.startDate)).toEqual(["2026-01-01", "2026-01-04", "2026-01-05"]);
  });

  it("preserves multi-day span for all-day occurrences", () => {
    const cal = parseIcs(
      ics(
        event([
          "DTSTART;VALUE=DATE:20260101",
          "DTEND;VALUE=DATE:20260109",
          "UID:span",
          "SUMMARY:Новогодние каникулы",
        ]),
      ),
    );
    const occ = expandRange(cal, "2025-12-01", "2026-02-01");
    expect(occ).toHaveLength(1);
    expect(occ[0].startDate).toBe("2026-01-01");
    expect(occ[0].endDate).toBe("2026-01-09");
  });
});
