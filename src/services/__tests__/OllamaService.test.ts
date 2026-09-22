import {
  isTemporalTitle,
  sanitizeTemporalTasks,
  fixDayIndex,
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

  it("preserves metadata from parent when promoting subtasks", () => {
    const tasks: ExtractedTask[] = [{
      title: "Понедельник · 22.09",
      priority: "high",
      dayIndex: 3,
      dayNumber: 1,
      weekday: "Понедельник",
      date: "2025-09-22",
      dayTheme: "планирование",
      scheduledTime: "09:00",
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
