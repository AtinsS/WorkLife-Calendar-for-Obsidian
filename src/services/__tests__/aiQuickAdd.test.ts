import { parseAiQuickTasks } from "../../services/aiQuickAdd";

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
          recurrence: { type: "weekly", interval: 1, daysOfWeek: [1] },
        },
      ],
    });
    const tasks = parseAiQuickTasks(raw);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Отчёт для клиента");
    expect(tasks[0].isWorkTask).toBe(true);
    expect(tasks[0].noteName).toBe("Отчёты");
    expect(tasks[0].recurrence?.type).toBe("weekly");
    expect(tasks[0].priority).toBe("high");
    expect(tasks[0].scheduledTime).toBe("14:00");
    expect(tasks[0].endTime).toBe("15:00");
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
});
