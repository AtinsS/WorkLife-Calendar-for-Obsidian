import {
  isTemporalTitle,
  sanitizeTemporalTasks,
  fixDayIndex,
  detectNoteFormat,
  parseStructuredNote,
  normalizeExtractedTasks,
  parseOllamaJson,
  extractBalancedJson,
  type ExtractedTask,
} from "../OllamaService";

// ---------------------------------------------------------------------------
// Internal helpers exposed via re-import trick for testing.
// We test them through the public interface where possible,
// and directly where needed.
// ---------------------------------------------------------------------------

// Import the module to access private functions indirectly.
// We'll test enrichTask behavior through sanitizeTemporalTasks + title parsing.

describe("isTemporalTitle", () => {
  // --- Cyrillic day names ---
  it.each([
    "Понедельник", "Вторник", "Среда", "Четверг",
    "Пятница", "Суббота", "Воскресенье",
  ])("recognizes '%s' as temporal", (day) => {
    expect(isTemporalTitle(day)).toBe(true);
  });

  // --- Day name with date suffix ---
  it.each([
    "Понедельник · 22.09",
    "Вторник · 23.09",
    "Пятница — 26.09",
    "Понедельник 22.09",
  ])("recognizes '%s' as temporal", (title) => {
    expect(isTemporalTitle(title)).toBe(true);
  });

  // --- English day names ---
  it.each([
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday",
  ])("recognizes '%s' as temporal", (day) => {
    expect(isTemporalTitle(day)).toBe(true);
  });

  // --- "День N" / "Day N" ---
  it.each(["День 1", "День 3", "Day 5"])(
    "recognizes '%s' as temporal",
    (title) => { expect(isTemporalTitle(title)).toBe(true); },
  );

  // --- Week references ---
  it.each(["Неделя 1", "Неделя 39", "Week 3"])(
    "recognizes '%s' as temporal",
    (title) => { expect(isTemporalTitle(title)).toBe(true); },
  );

  // --- Month names ---
  it.each([
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ])("recognizes '%s' as temporal", (month) => {
    expect(isTemporalTitle(month)).toBe(true);
  });

  // --- Date patterns ---
  it.each(["22.09", "15/10", "01-12", "22.09.2025"])(
    "recognizes '%s' as temporal",
    (date) => { expect(isTemporalTitle(date)).toBe(true); },
  );

  // --- Time-of-day words ---
  it.each(["Утро", "Вечер", "До обеда", "После обеда", "утром", "вечером"])(
    "recognizes '%s' as temporal",
    (word) => { expect(isTemporalTitle(word)).toBe(true); },
  );

  // --- Actual tasks should NOT be temporal ---
  it.each([
    "Утренняя рутина",
    "Разобрать входящие",
    "Deep work: основная задача проекта",
    "Обед + прогулка",
    "Встречи/созвоны",
    "Спортзал",
    "Чтение 30 мин",
    "Подготовка к презентации",
    "Backend разработка",
  ])("does NOT recognize '%s' as temporal", (task) => {
    expect(isTemporalTitle(task)).toBe(false);
  });

  // --- Emoji markers should be stripped before matching ---
  it("strips time emoji before checking", () => {
    expect(isTemporalTitle("Понедельник 🕐 07:00")).toBe(true);
  });

  it("strips priority emoji before checking", () => {
    expect(isTemporalTitle("Понедельник ⏫")).toBe(true);
  });
});

describe("sanitizeTemporalTasks", () => {
  function makeTask(title: string, subtasks: string[] = []): ExtractedTask {
    return {
      title,
      priority: "medium",
      dayIndex: 1,
      subtasks: subtasks.map((s) => ({ title: s })),
      selected: true,
    };
  }

  it("promotes subtasks from a temporal container", () => {
    const tasks = [
      makeTask("Понедельник · 22.09", [
        "Утренняя рутина",
        "Разобрать входящие",
        "Deep work: основная задача проекта",
        "Спортзал",
      ]),
    ];
    const result = sanitizeTemporalTasks(tasks);
    expect(result).toHaveLength(4);
    expect(result.map((t) => t.title)).toEqual([
      "Утренняя рутина",
      "Разобрать входящие",
      "Deep work: основная задача проекта",
      "Спортзал",
    ]);
    result.forEach((t) => expect(t.subtasks).toEqual([]));
  });

  it("keeps non-temporal tasks untouched", () => {
    const tasks = [
      makeTask("Подготовка к презентации", ["Слайды", "Репетиция"]),
      makeTask("Backend разработка", ["API", "Tests"]),
    ];
    const result = sanitizeTemporalTasks(tasks);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("Подготовка к презентации");
    expect(result[0].subtasks).toEqual([{ title: "Слайды" }, { title: "Репетиция" }]);
  });

  it("drops temporal tasks with no subtasks", () => {
    const tasks = [makeTask("Понедельник"), makeTask("Реальная задача")];
    const result = sanitizeTemporalTasks(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Реальная задача");
  });

  it("handles mixed temporal and non-temporal tasks", () => {
    const tasks = [
      makeTask("Понедельник · 22.09", ["Задача из понедельника"]),
      makeTask("Реальная задача"),
      makeTask("Вторник · 23.09", ["Задача из вторника", "Ещё задача из вторника"]),
    ];
    const result = sanitizeTemporalTasks(tasks);
    expect(result).toHaveLength(4);
    expect(result.map((t) => t.title)).toEqual([
      "Задача из понедельника", "Реальная задача",
      "Задача из вторника", "Ещё задача из вторника",
    ]);
  });

  it("preserves day-level metadata but NOT time/duration from parent when promoting subtasks", () => {
    const tasks: ExtractedTask[] = [{
      title: "Понедельник · 22.09",
      priority: "high",
      dayIndex: 3,
      dayNumber: 1,
      weekday: "Понедельник",
      date: "2025-09-22",
      dayTheme: "планирование",
      scheduledTime: "09:00",
      endTime: "11:00",
      estimatedMinutes: 120,
      description: "тема дня",
      subtasks: [{ title: "Утренняя рутина" }],
      selected: true,
    }];
    const result = sanitizeTemporalTasks(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Утренняя рутина");
    expect(result[0].priority).toBe("high");
    expect(result[0].dayIndex).toBe(3);
    expect(result[0].date).toBe("2025-09-22");
    expect(result[0].dayTheme).toBe("планирование");
    expect(result[0].weekday).toBe("Понедельник");
    // time/duration/description belong to the day container — must NOT clone to each subtask
    expect(result[0].scheduledTime).toBeUndefined();
    expect(result[0].endTime).toBeUndefined();
    expect(result[0].estimatedMinutes).toBeUndefined();
    expect(result[0].description).toBeUndefined();
  });

  it("handles the exact user-reported case", () => {
    const tasks = [
      makeTask("Понедельник", [
        "Утренняя рутина (зарядка, душ, завтрак)",
        "Разобрать входящие и составить план на неделю",
        "Deep work: основная задача проекта",
        "Обед + прогулка",
        "Встречи/созвоны",
        "Спортзал",
        "Чтение 30 мин",
      ]),
    ];
    const result = sanitizeTemporalTasks(tasks);
    expect(result).toHaveLength(7);
    expect(result[0].title).toBe("Утренняя рутина (зарядка, душ, завтрак)");
    expect(result[6].title).toBe("Чтение 30 мин");
    expect(result.every((t) => t.title !== "Понедельник")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Post-processing enrichment — test the behavior through the full pipeline
// by simulating what extractTasksFromNote does after receiving model output.
// ---------------------------------------------------------------------------

describe("enrichTask behavior (via title parsing)", () => {
  // We test the enrichment logic by checking that tasks with emoji markers
  // in their titles get properly cleaned when they go through sanitizeTemporalTasks.

  // The enrichment functions are internal, so we test them indirectly:
  // If the model returns a task with "Deep work 🕐 10:00–13:00" in the title,
  // the sanitizer should not treat it as temporal (it's not a day name).

  it("does not confuse time-containing task titles with temporal containers", () => {
    expect(isTemporalTitle("Deep work 🕐 10:00–13:00")).toBe(false);
    expect(isTemporalTitle("Обед + прогулка 🕐 13:00")).toBe(false);
    expect(isTemporalTitle("Спортзал 🕐 18:00")).toBe(false);
    expect(isTemporalTitle("Разобрать входящие ⏫ 🕐 09:00")).toBe(false);
  });

  it("does not confuse priority-containing task titles with temporal containers", () => {
    expect(isTemporalTitle("Сдать отчёт ⏫")).toBe(false);
    expect(isTemporalTitle("Опциональная задача 🔽")).toBe(false);
  });

  it("still recognizes day names even with emoji", () => {
    expect(isTemporalTitle("Понедельник 🕐 07:00")).toBe(true);
    expect(isTemporalTitle("Вторник ⏫")).toBe(true);
  });
});

describe("fixDayIndex", () => {
  function makeTask(overrides: Partial<ExtractedTask> & { title: string }): ExtractedTask {
    return {
      priority: "medium",
      dayIndex: 1,
      subtasks: [],
      selected: true,
      ...overrides,
    };
  }

  it("returns tasks unchanged when dayIndex values are already distinct", () => {
    const tasks = [
      makeTask({ title: "Task A", dayIndex: 1, weekday: "Понедельник" }),
      makeTask({ title: "Task B", dayIndex: 2, weekday: "Вторник" }),
    ];
    const result = fixDayIndex(tasks);
    expect(result[0].dayIndex).toBe(1);
    expect(result[1].dayIndex).toBe(2);
  });

  it("reassigns dayIndex when all tasks have same dayIndex but different weekdays", () => {
    const tasks = [
      makeTask({ title: "Task A", dayIndex: 1, weekday: "Понедельник" }),
      makeTask({ title: "Task B", dayIndex: 1, weekday: "Вторник" }),
      makeTask({ title: "Task C", dayIndex: 1, weekday: "Понедельник" }),
    ];
    const result = fixDayIndex(tasks);
    expect(result[0].dayIndex).toBe(1); // Понедельник
    expect(result[1].dayIndex).toBe(2); // Вторник
    expect(result[2].dayIndex).toBe(1); // Понедельник
  });

  it("reassigns dayIndex when all tasks have same dayIndex but different dates", () => {
    const tasks = [
      makeTask({ title: "Task A", dayIndex: 1, date: "2025-09-22" }),
      makeTask({ title: "Task B", dayIndex: 1, date: "2025-09-23" }),
      makeTask({ title: "Task C", dayIndex: 1, date: "2025-09-22" }),
    ];
    const result = fixDayIndex(tasks);
    expect(result[0].dayIndex).toBe(1); // 2025-09-22
    expect(result[1].dayIndex).toBe(2); // 2025-09-23
    expect(result[2].dayIndex).toBe(1); // 2025-09-22
  });

  it("prefers date over weekday for grouping", () => {
    const tasks = [
      makeTask({ title: "Task A", dayIndex: 1, weekday: "Понедельник", date: "2025-09-22" }),
      makeTask({ title: "Task B", dayIndex: 1, weekday: "Понедельник", date: "2025-09-23" }),
    ];
    const result = fixDayIndex(tasks);
    // Same weekday but different dates → should split
    expect(result[0].dayIndex).toBe(1);
    expect(result[1].dayIndex).toBe(2);
  });

  it("returns tasks unchanged when all have same dayIndex and no weekday/date", () => {
    const tasks = [
      makeTask({ title: "Task A", dayIndex: 1 }),
      makeTask({ title: "Task B", dayIndex: 1 }),
    ];
    const result = fixDayIndex(tasks);
    expect(result[0].dayIndex).toBe(1);
    expect(result[1].dayIndex).toBe(1);
  });

  it("handles empty array", () => {
    expect(fixDayIndex([])).toEqual([]);
  });

  it("handles the exact user-reported case: all tasks on day 1 with different weekdays", () => {
    const tasks = [
      makeTask({ title: "Утренняя рутина", dayIndex: 1, weekday: "Понедельник", date: "2025-09-22" }),
      makeTask({ title: "Deep work", dayIndex: 1, weekday: "Понедельник", date: "2025-09-22" }),
      makeTask({ title: "Backend API", dayIndex: 1, weekday: "Вторник", date: "2025-09-23" }),
      makeTask({ title: "Тесты", dayIndex: 1, weekday: "Вторник", date: "2025-09-23" }),
      makeTask({ title: "Встреча", dayIndex: 1, weekday: "Среда", date: "2025-09-24" }),
    ];
    const result = fixDayIndex(tasks);
    expect(result.map((t) => t.dayIndex)).toEqual([1, 1, 2, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Dual-format structured extraction
// ---------------------------------------------------------------------------

describe("isTemporalTitle — themed day headings are NOT temporal", () => {
  it("keeps study-plan day themes as real task titles", () => {
    expect(isTemporalTitle("День 1 (пн). PostgreSQL + Prisma + Workspace — 2 ч")).toBe(false);
    expect(isTemporalTitle("PostgreSQL + Prisma + Workspace")).toBe(false);
    expect(isTemporalTitle("День 2 (вт). Express + Socket.io + Rooms — 2 ч")).toBe(false);
  });

  it("still treats bare day labels as temporal", () => {
    expect(isTemporalTitle("День 1")).toBe(true);
    expect(isTemporalTitle("День 1 (пн)")).toBe(true);
    expect(isTemporalTitle("Понедельник (21.09)")).toBe(true);
  });
});

describe("detectNoteFormat", () => {
  const studyPlan = `### День 1 (пн). PostgreSQL + Prisma + Workspace — 2 ч

**Что делаем:** настраиваем базу данных.

- [ ] docker-compose.yml с PostgreSQL 16
- [ ] .env с DATABASE_URL
    - Workspace — id, name
- [ ] npx prisma init

### День 2 (вт). Express + Socket.io + Rooms — 2 ч
- [ ] Переписать index.ts
`;

  const dailyList = `## 📅 Понедельник (21.09)
- [ ] 🔴 Созвон с командой в 10:00 — обсудить ТЗ лендинга
- [ ] 🟡 Набросать структуру новой статьи в блог
- [ ] 🟢 Утренние страницы (15 мин)

## 📅 Вторник (22.09)
- [ ] 🔴 Вёрстка главного экрана лендинга
- [ ] 🟡 Прочитать главу 4 курса по Python
- [ ] 🟢 Прогулка 30 мин
`;

  it("detects study-plan format", () => {
    expect(detectNoteFormat(studyPlan)).toBe("study-plan");
  });

  it("detects daily-list format", () => {
    expect(detectNoteFormat(dailyList)).toBe("daily-list");
  });

  it("does not confuse the two formats", () => {
    expect(detectNoteFormat(studyPlan)).not.toBe("daily-list");
    expect(detectNoteFormat(dailyList)).not.toBe("study-plan");
  });

  it("returns unknown for free-form notes", () => {
    expect(detectNoteFormat("Just some prose about the weather.")).toBe("unknown");
    expect(parseStructuredNote("Just some prose.")).toBeNull();
  });
});

describe("parseStructuredNote — Format A study plan", () => {
  const note = `### День 1 (пн). PostgreSQL + Prisma + Workspace — 2 ч

**Что делаем:** настраиваем базу данных и описываем все модели.

- [ ] docker-compose.yml с PostgreSQL 16 (порт 5432).
- [ ] .env с DATABASE_URL.
- [ ] Схема БД (все модели):
    - Workspace — id, name, apiKey.
    - Operator — id, email, password.
- [ ] npx prisma migrate dev --name init.

### День 2 (вт). Express + Socket.io + Rooms — 2 ч

- [ ] Переписать apps/server/src/index.ts
- [ ] Event sendMessage
`;

  function requireParsed(result: ReturnType<typeof parseStructuredNote>) {
    if (!result) throw new Error("parseStructuredNote returned null");
    return result;
  }

  it("heading is ONE task, checklist items are subtasks", () => {
    const parsed = requireParsed(parseStructuredNote(note));
    expect(parsed.format).toBe("study-plan");
    expect(parsed.tasks).toHaveLength(2);

    const day1 = parsed.tasks[0];
    expect(day1.title).toBe("PostgreSQL + Prisma + Workspace");
    expect(day1.estimatedMinutes).toBe(120);
    expect(day1.dayIndex).toBe(1);
    expect(day1.weekday).toBe("Понедельник");
    expect(day1.description).toContain("настраиваем базу данных");
    // 4 top-level checkboxes + 2 nested model lines flattened as checklist detail
    expect(day1.subtasks.length).toBeGreaterThanOrEqual(4);
    expect(day1.subtasks.map((s) => s.title).join("|")).toContain("docker-compose.yml");
    expect(day1.subtasks.map((s) => s.title).join("|")).toContain("npx prisma migrate");
    // parent must survive normalize (not collapsed into free subtasks)
    const { tasks } = normalizeExtractedTasks({ tasks: parsed.tasks });
    expect(tasks.some((t) => t.title.includes("PostgreSQL"))).toBe(true);
    expect(tasks.filter((t) => t.title.includes("PostgreSQL"))[0].subtasks.length).toBeGreaterThanOrEqual(4);
  });

  it("second day is a separate parent task", () => {
    const parsed = requireParsed(parseStructuredNote(note));
    expect(parsed.tasks[1].title).toBe("Express + Socket.io + Rooms");
    expect(parsed.tasks[1].dayIndex).toBe(2);
    expect(parsed.tasks[1].subtasks.some((s) => s.title.includes("sendMessage"))).toBe(true);
  });
});

describe("parseStructuredNote — Format B daily notes", () => {
  const note = `## 📅 Понедельник (21.09)
- [ ] 🔴 Созвон с командой в 10:00 — обсудить ТЗ лендинга
- [ ] 🟡 Набросать структуру новой статьи в блог
- [ ] 🟢 Утренние страницы (15 мин)

## 📅 Вторник (22.09)
- [ ] 🔴 Вёрстка главного экрана лендинга
- [ ] 🟡 Прочитать главу 4 курса по Python
- [ ] 🟢 Прогулка 30 мин

## 📅 Среда (23.09) ← сегодня
- [ ] 🔴 Доделать блок «Отзывы» на лендинге
`;

  function requireParsed(result: ReturnType<typeof parseStructuredNote>) {
    if (!result) throw new Error("parseStructuredNote returned null");
    return result;
  }

  it("day headers are never tasks; each line is an independent task", () => {
    const parsed = requireParsed(parseStructuredNote(note));
    expect(parsed.format).toBe("daily-list");
    expect(parsed.tasks).toHaveLength(7);
    expect(parsed.tasks.every((t) => !isTemporalTitle(t.title))).toBe(true);
    expect(parsed.tasks.some((t) => t.title.includes("Понедельник"))).toBe(false);
  });

  it("maps 🔴🟡🟢 to priorities", () => {
    const parsed = requireParsed(parseStructuredNote(note));
    expect(parsed.tasks[0].priority).toBe("high"); // Созвон
    expect(parsed.tasks[1].priority).toBe("medium"); // статья
    expect(parsed.tasks[2].priority).toBe("low"); // страницы
  });

  it("parses times and durations from lines", () => {
    const parsed = requireParsed(parseStructuredNote(note));
    expect(parsed.tasks[0].scheduledTime).toBe("10:00");
    expect(parsed.tasks[0].title).toContain("Созвон");
    expect(parsed.tasks[2].estimatedMinutes).toBe(15);
    expect(parsed.tasks[5].estimatedMinutes).toBe(30); // Прогулка 30 мин
  });

  it("binds date and weekday from day headers", () => {
    const parsed = requireParsed(parseStructuredNote(note));
    expect(parsed.tasks[0].date).toMatch(/\d{4}-09-21$/);
    expect(parsed.tasks[0].weekday).toBe("Понедельник");
    expect(parsed.tasks[3].date).toMatch(/-09-22$/);
    expect(parsed.tasks[6].weekday).toBe("Среда");
  });
});

// ---------------------------------------------------------------------------
// Regression tests: Cyrillic \b fixes, field coercion, dedupe, balanced JSON
// ---------------------------------------------------------------------------

describe("normalizeExtractedTasks — Cyrillic regex + coercion regressions", () => {
  const norm = (rawTasks: Array<Record<string, unknown>>) =>
    normalizeExtractedTasks({ tasks: rawTasks as never }).tasks;

  it("strips 'в 10:00' from titles (Cyrillic \\b regression)", () => {
    const [t] = norm([{ title: "Созвон с командой в 10:00 — обсудить ТЗ", priority: "medium", dayIndex: 1, subtasks: [] }]);
    expect(t.scheduledTime).toBe("10:00");
    expect(t.title).toBe("Созвон с командой — обсудить ТЗ");
  });

  it("strips 'с 10:00 до 11:30' range from titles", () => {
    const [t] = norm([{ title: "Совещание с 10:00 до 11:30", priority: "medium", dayIndex: 1, subtasks: [] }]);
    expect(t.scheduledTime).toBe("10:00");
    expect(t.estimatedMinutes).toBe(90);
    expect(t.title).toBe("Совещание");
  });

  it("parses hour durations '2 часа' / '3 ч' (Cyrillic \\b regression)", () => {
    const [a] = norm([{ title: "Deep work — 2 часа", priority: "medium", dayIndex: 1, subtasks: [] }]);
    expect(a.estimatedMinutes).toBe(120);
    expect(a.title).toBe("Deep work");
    const [b] = norm([{ title: "Встреча — 3 ч", priority: "medium", dayIndex: 1, subtasks: [] }]);
    expect(b.estimatedMinutes).toBe(180);
  });

  it("strips trailing duration hint but keeps mid-title durations", () => {
    const [a] = norm([{ title: "Утренние страницы (15 мин)", priority: "medium", dayIndex: 1, subtasks: [] }]);
    expect(a.estimatedMinutes).toBe(15);
    expect(a.title).toBe("Утренние страницы");
    const [b] = norm([{ title: "2 часа переговоров", priority: "medium", dayIndex: 1, subtasks: [] }]);
    expect(b.estimatedMinutes).toBe(120);
    expect(b.title).toBe("2 часа переговоров");
  });

  it("reads Cyrillic priority keywords (Cyrillic \\b regression)", () => {
    const [h] = norm([{ title: "Сдать отчёт срочно", priority: "medium", dayIndex: 1, subtasks: [] }]);
    expect(h.priority).toBe("high");
    const [l] = norm([{ title: "Прочитать книгу хобби", priority: "medium", dayIndex: 1, subtasks: [] }]);
    expect(l.priority).toBe("low");
  });

  it("accepts '9:00' and rejects '25:00' for scheduledTime/endTime", () => {
    const [a] = norm([{ title: "Встреча", priority: "medium", dayIndex: 1, scheduledTime: "9:00", endTime: "10:30", subtasks: [] }]);
    expect(a.scheduledTime).toBe("09:00");
    expect(a.endTime).toBe("10:30");
    const [b] = norm([{ title: "Встреча", priority: "medium", dayIndex: 1, scheduledTime: "25:00", endTime: "9:61", subtasks: [] }]);
    expect(b.scheduledTime).toBeUndefined();
    expect(b.endTime).toBeUndefined();
  });

  it("rejects impossible dates like 2025-13-45", () => {
    const [t] = norm([{ title: "Встреча", priority: "medium", dayIndex: 1, date: "2025-13-45", subtasks: [] }]);
    expect(t.date).toBeUndefined();
    const [ok] = norm([{ title: "Встреча", priority: "medium", dayIndex: 1, date: "2025-02-28", subtasks: [] }]);
    expect(ok.date).toBe("2025-02-28");
  });

  it("keeps same-title tasks at different times but merges exact duplicates", () => {
    const distinct = norm([
      { title: "Совещание", priority: "medium", dayIndex: 1, scheduledTime: "10:00", subtasks: [] },
      { title: "Совещание", priority: "medium", dayIndex: 1, scheduledTime: "15:00", subtasks: [] },
    ]);
    expect(distinct).toHaveLength(2);
    const merged = norm([
      { title: "Совещание", priority: "medium", dayIndex: 1, scheduledTime: "10:00", subtasks: [] },
      { title: "Совещание", priority: "medium", dayIndex: 1, scheduledTime: "10:00", subtasks: [] },
    ]);
    expect(merged).toHaveLength(1);
  });

  it("recognizes bare duration titles as temporal", () => {
    expect(isTemporalTitle("2 часа")).toBe(true);
    expect(isTemporalTitle("30 мин")).toBe(true);
    expect(isTemporalTitle("Чтение")).toBe(false);
  });
});

describe("fixDayIndex — chronological ordering", () => {
  const make = (weekday: string): ExtractedTask => ({
    title: `Task for ${weekday}`,
    priority: "medium",
    dayIndex: 1,
    weekday,
    subtasks: [],
    selected: true,
  });

  it("orders Wednesday before Friday even when Friday is listed first", () => {
    const result = fixDayIndex([make("Пятница"), make("Среда"), make("Четверг")]);
    const byTitle = new Map(result.map((t) => [t.title, t.dayIndex]));
    expect(byTitle.get("Task for Среда")).toBe(1);
    expect(byTitle.get("Task for Четверг")).toBe(2);
    expect(byTitle.get("Task for Пятница")).toBe(3);
  });

  it("orders dates lexicologically regardless of input order", () => {
    const mk = (date: string): ExtractedTask => ({
      title: `Task ${date}`, priority: "medium", dayIndex: 1, date, subtasks: [], selected: true,
    });
    const result = fixDayIndex([mk("2025-09-24"), mk("2025-09-22"), mk("2025-09-23")]);
    const byTitle = new Map(result.map((t) => [t.title, t.dayIndex]));
    expect(byTitle.get("Task 2025-09-22")).toBe(1);
    expect(byTitle.get("Task 2025-09-23")).toBe(2);
    expect(byTitle.get("Task 2025-09-24")).toBe(3);
  });
});

describe("extractBalancedJson", () => {
  it("stops at the closing brace even when trailing prose contains }", () => {
    const text = '{"tasks": [{"title": "A"}]} and then a note with } inside';
    expect(extractBalancedJson(text)).toBe('{"tasks": [{"title": "A"}]}');
  });

  it("ignores braces inside strings and escapes", () => {
    expect(extractBalancedJson('x {"title": "a } b"} y')).toBe('{"title": "a } b"}');
    expect(extractBalancedJson('{"title": "a \\" } b"}')).toBe('{"title": "a \\" } b"}');
  });

  it("returns null when no complete object exists", () => {
    expect(extractBalancedJson("no json here")).toBeNull();
    expect(extractBalancedJson('{"broken": ')).toBeNull();
  });

  it("parseOllamaJson survives trailing prose after the object", () => {
    const parsed = parseOllamaJson('{"tasks": [{"title": "A"}]} hope this helps! }');
    expect(parsed.tasks).toHaveLength(1);
  });
});
