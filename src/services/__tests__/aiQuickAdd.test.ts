import {
  parseAiQuickTasks,
  normalizeAiTime,
  normalizeAiDate,
  normalizeAiMinutes,
  normalizeAiRate,
  normalizeAiPaymentType,
  extractRateFromText,
  formatQuickAddDateContext,
  buildQuickAddSystem,
} from "../../services/aiQuickAdd";

describe("parseAiQuickTasks", () => {
  it("parses a single task with smart fields", () => {
    const raw = JSON.stringify({
      tasks: [
        {
          title: "Отчёт для клиента",
          date: "2026-10-05",
          scheduledTime: "14:00",
          endTime: "15:00",
          priority: "high",
          projectName: "Work",
          isWorkTask: true,
          noteName: "Отчёты",
          description: null,
          tags: ["#работа", "отчёт"],
          estimatedMinutes: 60,
          deadline: "2026-10-10",
          deadlineTime: "18:00",
          recurrence: { type: "weekly", interval: 1, daysOfWeek: [1], until: "2026-12-01" },
        },
      ],
    });
    const tasks = parseAiQuickTasks(raw);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Отчёт для клиента");
    expect(tasks[0].isWorkTask).toBe(true);
    expect(tasks[0].noteName).toBe("Отчёты");
    expect(tasks[0].recurrence?.type).toBe("weekly");
    expect(tasks[0].recurrence?.until).toBe("2026-12-01");
    expect(tasks[0].priority).toBe("high");
    expect(tasks[0].scheduledTime).toBe("14:00");
    expect(tasks[0].endTime).toBe("15:00");
    expect(tasks[0].tags).toEqual(["работа", "отчёт"]);
    expect(tasks[0].estimatedMinutes).toBe(60);
    expect(tasks[0].deadline).toBe("2026-10-10");
    expect(tasks[0].deadlineTime).toBe("18:00");
  });

  it("parses multiple tasks and normalizes priority", () => {
    const raw = `{"tasks":[
      {"title":"Купить молоко","priority":"weird"},
      {"title":"Созвон","isWorkTask":true,"scheduledTime":"10:00"}
    ]}`;
    const tasks = parseAiQuickTasks(raw);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].priority).toBe("medium");
    expect(tasks[1].isWorkTask).toBe(true);
    expect(tasks[1].tags).toEqual([]);
  });

  it("falls back to line split on invalid JSON", () => {
    const tasks = parseAiQuickTasks("Первая задача\n- Вторая задача");
    expect(tasks.map((t) => t.title)).toEqual(["Первая задача", "Вторая задача"]);
  });

  it("drops empty titles", () => {
    const tasks = parseAiQuickTasks('{"tasks":[{"title":"  "},{"title":"Ok"}]}');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Ok");
  });

  it("accepts markdown-fenced JSON", () => {
    const raw = '```json\n{"tasks":[{"title":"Позвонить маме","tags":["семья"]}]}\n```';
    const tasks = parseAiQuickTasks(raw);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Позвонить маме");
    expect(tasks[0].tags).toEqual(["семья"]);
  });

  it("accepts a bare tasks array root", () => {
    const tasks = parseAiQuickTasks('[{"title":"Раз"},{"title":"Два","priority":"high"}]');
    expect(tasks.map((t) => t.title)).toEqual(["Раз", "Два"]);
    expect(tasks[1].priority).toBe("high");
  });

  it("normalizes messy times and rejects invalid ones", () => {
    const raw = `{"tasks":[
      {"title":"A","scheduledTime":"9:5"},
      {"title":"B","scheduledTime":"14.30","endTime":"25:00"},
      {"title":"C","scheduledTime":"9"}
    ]}`;
    const tasks = parseAiQuickTasks(raw);
    expect(tasks[0].scheduledTime).toBe("09:05");
    expect(tasks[1].scheduledTime).toBe("14:30");
    expect(tasks[1].endTime).toBeNull();
    expect(tasks[2].scheduledTime).toBe("09:00");
  });

  it("rejects invalid dates and keeps only real calendar days", () => {
    const raw = `{"tasks":[
      {"title":"A","date":"2026-02-30"},
      {"title":"B","date":"2026-10-05"},
      {"title":"C","deadline":"05.10.2026"}
    ]}`;
    const tasks = parseAiQuickTasks(raw);
    expect(tasks[0].date).toBeNull();
    expect(tasks[1].date).toBe("2026-10-05");
    expect(tasks[2].deadline).toBeNull();
  });

  it("normalizes recurrence days and clamps interval", () => {
    const raw = `{"tasks":[
      {"title":"A","recurrence":{"type":"weekly","interval":0,"daysOfWeek":[6,1,1,9]}},
      {"title":"B","recurrence":{"type":"nope"}}
    ]}`;
    const tasks = parseAiQuickTasks(raw);
    expect(tasks[0].recurrence).toEqual({ type: "weekly", interval: 1, daysOfWeek: [1, 6] });
    expect(tasks[1].recurrence).toBeNull();
  });

  it("strips junk from titles", () => {
    const tasks = parseAiQuickTasks('{"tasks":[{"title":"  Купить хлеб!!  "}]}');
    expect(tasks[0].title).toBe("Купить хлеб!!");
  });

  it("parses rate and paymentType as cost, not description", () => {
    const raw = `{"tasks":[
      {"title":"Дизайн лендинга","description":null,"rate":400,"paymentType":"hour","isWorkTask":true},
      {"title":"Монтаж видео","rate":"2000","paymentType":"day"},
      {"title":"Фотосессия 400р в час","description":"оплата 400р в час"}
    ]}`;
    const tasks = parseAiQuickTasks(raw);
    expect(tasks[0].rate).toBe(400);
    expect(tasks[0].paymentType).toBe("hour");
    expect(tasks[1].rate).toBe(2000);
    expect(tasks[1].paymentType).toBe("day");
    expect(tasks[1].isWorkTask).toBe(true);
    // fallback from free text when model left price in title/description
    expect(tasks[2].rate).toBe(400);
    expect(tasks[2].paymentType).toBe("hour");
    expect(tasks[2].isWorkTask).toBe(true);
    expect(tasks[2].title).not.toMatch(/400/);
    expect(tasks[2].description).not.toMatch(/400/);
  });

  it("extracts rate from Russian payment phrases", () => {
    expect(extractRateFromText("Дизайн, 400р в час")).toEqual({
      rate: 400,
      paymentType: "hour",
      matched: expect.stringContaining("400"),
    });
    expect(extractRateFromText("монтаж 2000 в день").rate).toBe(2000);
    expect(extractRateFromText("монтаж 2000 в день").paymentType).toBe("day");
    expect(extractRateFromText("500 руб/час").rate).toBe(500);
    expect(extractRateFromText("просто задача").rate).toBeNull();
  });

  it("normalizes rate and payment type", () => {
    expect(normalizeAiRate("1 500")).toBe(1500);
    expect(normalizeAiRate("400р")).toBe(400);
    expect(normalizeAiRate(-1)).toBeNull();
    expect(normalizeAiPaymentType("час")).toBe("hour");
    expect(normalizeAiPaymentType("day")).toBe("day");
    expect(normalizeAiPaymentType("week")).toBeNull();
  });

  it("parses a multi-day week plan with per-task dates", () => {
    const raw = `{"tasks":[
      {"title":"Созвон с командой","date":"2026-10-05","scheduledTime":"10:00","projectName":"Work","isWorkTask":true},
      {"title":"Отписать клиенту","date":"2026-10-05","isWorkTask":true},
      {"title":"Черновик статьи","date":"2026-10-06","estimatedMinutes":120},
      {"title":"Спортзал","date":"2026-10-09","scheduledTime":"18:00","endTime":"19:00","estimatedMinutes":60}
    ]}`;
    const tasks = parseAiQuickTasks(raw);
    expect(tasks.map((t) => [t.title, t.date])).toEqual([
      ["Созвон с командой", "2026-10-05"],
      ["Отписать клиенту", "2026-10-05"],
      ["Черновик статьи", "2026-10-06"],
      ["Спортзал", "2026-10-09"],
    ]);
    expect(tasks[3].scheduledTime).toBe("18:00");
    expect(tasks[3].endTime).toBe("19:00");
    expect(tasks[2].estimatedMinutes).toBe(120);
  });
});

describe("normalizeAiTime / normalizeAiDate / normalizeAiMinutes", () => {
  it("normalizes times", () => {
    expect(normalizeAiTime("14:00")).toBe("14:00");
    expect(normalizeAiTime("9")).toBe("09:00");
    expect(normalizeAiTime("9.30")).toBe("09:30");
    expect(normalizeAiTime("24:00")).toBeNull();
    expect(normalizeAiTime("")).toBeNull();
    expect(normalizeAiTime(14)).toBeNull();
  });

  it("validates dates", () => {
    expect(normalizeAiDate("2026-10-05")).toBe("2026-10-05");
    expect(normalizeAiDate("2026-02-29")).toBeNull(); // 2026 is not a leap year
    expect(normalizeAiDate("5.10.2026")).toBeNull();
  });

  it("clamps estimated minutes", () => {
    expect(normalizeAiMinutes(120)).toBe(120);
    expect(normalizeAiMinutes("45")).toBe(45);
    expect(normalizeAiMinutes(0)).toBeNull();
    expect(normalizeAiMinutes(-5)).toBeNull();
    expect(normalizeAiMinutes(60 * 24 * 30)).toBe(60 * 24 * 14);
  });
});

describe("buildQuickAddSystem", () => {
  it("injects current date and project names", () => {
    const sys = buildQuickAddSystem({
      now: new Date(2026, 9, 5, 12, 0, 0), // 2026-10-05 Monday
      projectNames: ["Work", "Personal"],
      noteNames: ["Отчёты"],
    });
    expect(sys).toContain("Current date: 2026-10-05 (Monday)");
    expect(sys).toContain("Work, Personal");
    expect(sys).toContain("Отчёты");
  });

  it("formats date context", () => {
    expect(formatQuickAddDateContext(new Date(2026, 0, 1))).toBe("2026-01-01 (Thursday)");
  });
});
