import { parseQuickInput, parseDurationFromText, splitTaskLines, normalizeTime } from "../quickAddParse";
import { locale } from "../../i18n";

describe("parseQuickInput", () => {
  beforeEach(() => {
    locale.set("ru");
  });

  it("extracts plain title", () => {
    const r = parseQuickInput("Купить молоко");
    expect(r.title).toBe("Купить молоко");
    expect(r.date).toBeNull();
    expect(r.scheduledTime).toBeNull();
    expect(r.priority).toBeNull();
    expect(r.projectName).toBeNull();
  });

  it("parses priority, project, time and date tokens", () => {
    const r = parseQuickInput("!встреча @Work завтра 14:00");
    expect(r.title).toBe("встреча");
    expect(r.priority).toBe("high");
    expect(r.projectName).toBe("Work");
    expect(r.scheduledTime).toBe("14:00");
    expect(r.date).not.toBeNull();
  });

  it("parses time range", () => {
    const r = parseQuickInput("созвон 14-15");
    expect(r.title).toBe("созвон");
    expect(r.scheduledTime).toBe("14:00");
    expect(r.endTime).toBe("15:00");
  });

  it("keeps title when only metadata present is partial", () => {
    const r = parseQuickInput("~ отчёт");
    expect(r.title).toBe("отчёт");
    expect(r.priority).toBe("medium");
  });
});

describe("parseQuickInput — RU inflected weekdays & regressions", () => {
  beforeEach(() => {
    locale.set("ru");
  });

  it("parses accusative weekday forms (в пятницу / в среду / в субботу)", () => {
    for (const input of ["созвон в пятницу", "встреча в среду", "прогулка в субботу"]) {
      const r = parseQuickInput(input);
      expect(r.date).not.toBeNull();
      expect(r.title).not.toMatch(/пятниц|сред|суббот/);
    }
    expect(parseQuickInput("созвон в пятницу").date?.day()).toBe(5);
    expect(parseQuickInput("встреча в среду").date?.day()).toBe(3);
    expect(parseQuickInput("прогулка в субботу").date?.day()).toBe(6);
  });

  it("parses genitive forms (до пятницы / до среды)", () => {
    const r = parseQuickInput("сдать отчёт до пятницы");
    expect(r.date).not.toBeNull();
    expect(r.date?.day()).toBe(5);
    expect(r.title).toBe("сдать отчёт");
  });

  it("parses 'следующая пятница' (next + inflected weekday)", () => {
    const r = parseQuickInput("планёрка следующая пятница");
    expect(r.date).not.toBeNull();
    expect(r.date?.day()).toBe(5);
  });

  it("does NOT treat duration ranges like '2-3 часа' as time ranges", () => {
    const r = parseQuickInput("тренировка 2-3 часа");
    expect(r.scheduledTime).toBeNull();
    expect(r.endTime).toBeNull();
    expect(r.title).toContain("тренировка");
  });

  it("rejects impossible times like 25:00", () => {
    const r = parseQuickInput("встреча в 25:00");
    expect(r.scheduledTime).toBeNull();
    expect(normalizeTime("25:00")).toBeNull();
    expect(normalizeTime("9:05")).toBe("09:05");
    expect(normalizeTime("9")).toBe("09:00");
  });
});

describe("parseQuickInput — time prepositions в/с/по", () => {
  beforeEach(() => {
    locale.set("ru");
  });

  it("consumes 'в' with HH:MM and bare hour", () => {
    const a = parseQuickInput("Созвон в 16:00");
    expect(a.scheduledTime).toBe("16:00");
    expect(a.title).toBe("Созвон");
    const b = parseQuickInput("Встреча в 16");
    expect(b.scheduledTime).toBe("16:00");
    expect(b.title).toBe("Встреча");
  });

  it("parses ranges with в/с and по/до/– separators", () => {
    const a = parseQuickInput("Спортзал с 16-17");
    expect(a.scheduledTime).toBe("16:00");
    expect(a.endTime).toBe("17:00");
    expect(a.title).toBe("Спортзал");
    const b = parseQuickInput("Дейли с 10:00 по 11:30");
    expect(b.scheduledTime).toBe("10:00");
    expect(b.endTime).toBe("11:30");
    expect(b.title).toBe("Дейли");
    const c = parseQuickInput("Прогулка в 18:00-19:00");
    expect(c.scheduledTime).toBe("18:00");
    expect(c.endTime).toBe("19:00");
    expect(c.title).toBe("Прогулка");
    const d = parseQuickInput("Планёрка с 16:00 до 17:00");
    expect(d.scheduledTime).toBe("16:00");
    expect(d.endTime).toBe("17:00");
  });

  it("does not treat duration phrases as times", () => {
    const a = parseQuickInput("Отдых в 2 часа");
    expect(a.scheduledTime).toBeNull();
    expect(a.title).toContain("Отдых");
    const b = parseQuickInput("Перерыв в 5 минут");
    expect(b.scheduledTime).toBeNull();
  });
});

describe("parseQuickInput — unified 'next weekday' semantics", () => {
  beforeEach(() => {
    locale.set("ru");
  });

  // 2026-06-08 is a Monday, 2026-06-12 is a Friday
  it("'следующая пятница' on Monday = the upcoming Friday", () => {
    const r = parseQuickInput("планёрка следующая пятница", new Date(2026, 5, 8));
    expect(r.date?.format("YYYY-MM-DD")).toBe("2026-06-12");
  });

  it("'следующая пятница' on Friday = a week later", () => {
    const r = parseQuickInput("планёрка следующая пятница", new Date(2026, 5, 12));
    expect(r.date?.format("YYYY-MM-DD")).toBe("2026-06-19");
  });

  it("bare weekday stays 'on/after today' (пятница on Friday = today)", () => {
    const r = parseQuickInput("встреча в пятницу", new Date(2026, 5, 12));
    expect(r.date?.format("YYYY-MM-DD")).toBe("2026-06-12");
  });
});

describe("parseDurationFromText", () => {
  it("parses '2ч' at end of string (Cyrillic \\b regression)", () => {
    expect(parseDurationFromText("deep work 2ч")).toBe(120);
    expect(parseDurationFromText("на 1 час")).toBe(60);
    expect(parseDurationFromText("30 минут")).toBe(30);
    expect(parseDurationFromText("задача на 2 часа")).toBe(120);
    expect(parseDurationFromText("без длительности")).toBeNull();
  });
});

describe("splitTaskLines", () => {
  it("splits on newlines, semicolons and + separators", () => {
    expect(splitTaskLines("раз\n- два; три + четыре")).toEqual(["раз", "два", "три", "четыре"]);
  });
});
