import { get } from "svelte/store";
import {
  applyScheduleOps,
  parseScheduleOps,
  setDateUID,
  shiftDateUID,
  extractDateFromUID,
  describeOp,
  findFreeSlot,
  resolveCreateTimes,
  buildRecsToOpsSystem,
  buildRecsToOpsUser,
  type ScheduleOp,
} from "../aiScheduleOps";
import { tasks } from "../../task-tracker/stores";
import type { ITask } from "../../task-tracker/types";

function makeTask(overrides: Partial<ITask> = {}): ITask {
  return {
    id: "t1",
    title: "Buy milk",
    completed: false,
    status: "todo",
    dateUID: "day-2026-07-10",
    projectId: null,
    priority: "medium",
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("shiftDateUID / setDateUID", () => {
  it("shifts by days and keeps the date-only form", () => {
    expect(shiftDateUID("day-2026-07-10", 1)).toBe("day-2026-07-11");
    expect(shiftDateUID("day-2026-07-10", -1)).toBe("day-2026-07-09");
    expect(shiftDateUID("day-2026-07-31", 1)).toBe("day-2026-08-01");
  });

  it("preserves time suffix when present", () => {
    expect(shiftDateUID("day-2026-07-10T00:00:00+00:00", 1)).toBe("day-2026-07-11T00:00:00+00:00");
  });

  it("sets an absolute date", () => {
    expect(setDateUID("day-2026-07-10", "2026-07-15")).toBe("day-2026-07-15");
    expect(setDateUID("day-2026-07-10T12:00:00+00:00", "2026-07-15")).toBe(
      "day-2026-07-15T12:00:00+00:00",
    );
    expect(setDateUID("day-2026-07-10", "bad")).toBeNull();
  });

  it("extracts the calendar day", () => {
    expect(extractDateFromUID("day-2026-07-05T00:00:00+03:00")).toBe("2026-07-05");
  });
});

describe("parseScheduleOps", () => {
  it("parses a move-by-days op", () => {
    const plan = parseScheduleOps(
      JSON.stringify({
        summary: "Сдвину задачи на день",
        operations: [{ type: "move", taskIds: ["t1", "t2"], shiftDays: 1 }],
      }),
    );
    expect(plan.summary).toBe("Сдвину задачи на день");
    expect(plan.operations).toEqual([
      { type: "move", taskIds: ["t1", "t2"], toDate: undefined, shiftDays: 1 },
    ]);
  });

  it("accepts aliases and drops invalid ops", () => {
    const plan = parseScheduleOps(
      JSON.stringify({
        summary: "ok",
        ops: [
          { type: "move", taskId: "t1", toDate: "2026-07-20" },
          { type: "move", taskIds: [] },
          { type: "setStatus", taskIds: ["t1"], status: "done" },
          { type: "setStatus", taskIds: ["t1"], status: "nope" },
          { type: "setPriority", ids: "t1", priority: "high" },
          { type: "setTime", taskIds: ["t1"], scheduledTime: "10:00", endTime: "11:00" },
          { type: "rename", taskId: "t1", title: "  New  " },
          { type: "delete", taskIds: "t1" },
          { type: "unknown", taskIds: ["t1"] },
        ],
      }),
    );

    const types = plan.operations.map((o) => o.type);
    expect(types).toEqual(["move", "setStatus", "setPriority", "setTime", "rename", "delete"]);
    expect(plan.operations[0]).toMatchObject({ toDate: "2026-07-20", taskIds: ["t1"] });
    expect(plan.operations[2]).toMatchObject({ taskIds: ["t1"], priority: "high" });
    expect(plan.operations[4]).toMatchObject({ title: "New" });
    expect(plan.operations[5]).toMatchObject({ taskIds: ["t1"] });
  });

  it("parses JSON from a markdown fence", () => {
    const plan = parseScheduleOps(
      '```json\n{"summary":"","operations":[{"type":"delete","taskIds":["a"]}]}\n```',
    );
    expect(plan.operations).toHaveLength(1);
  });

  it("returns empty plan on garbage", () => {
    expect(parseScheduleOps("not json")).toEqual({ summary: "", operations: [] });
    expect(parseScheduleOps("")).toEqual({ summary: "", operations: [] });
  });

  it("parses create ops", () => {
    const plan = parseScheduleOps(
      JSON.stringify({
        summary: "ok",
        operations: [
          {
            type: "create",
            title: "  Buy milk  ",
            date: "2026-07-15",
            scheduledTime: "10:00",
            endTime: "11:00",
            priority: "high",
            project: "Home",
          },
          { type: "create", title: "" },
        ],
      }),
    );
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      type: "create",
      title: "Buy milk",
      date: "2026-07-15",
      scheduledTime: "10:00",
      endTime: "11:00",
      priority: "high",
      projectName: "Home",
    });
  });
});

describe("applyScheduleOps", () => {
  beforeEach(() => {
    tasks.set([
      makeTask({ id: "a", title: "A", dateUID: "day-2026-07-10" }),
      makeTask({ id: "b", title: "B", dateUID: "day-2026-07-11", status: "todo" }),
    ]);
  });

  it("moves tasks by shiftDays", () => {
    const ops: ScheduleOp[] = [{ type: "move", taskIds: ["a", "b"], shiftDays: 1 }];
    const res = applyScheduleOps(ops);
    expect(res).toEqual({ applied: 2, skipped: 0, warnings: [] });
    const list = get(tasks);
    expect(list.find((t) => t.id === "a")?.dateUID).toBe("day-2026-07-11");
    expect(list.find((t) => t.id === "b")?.dateUID).toBe("day-2026-07-12");
  });

  it("moves a task to an absolute date", () => {
    applyScheduleOps([{ type: "move", taskIds: ["a"], toDate: "2026-07-20" }]);
    expect(get(tasks).find((t) => t.id === "a")?.dateUID).toBe("day-2026-07-20");
  });

  it("updates status, priority, time, title and deletes", () => {
    const res = applyScheduleOps([
      { type: "setStatus", taskIds: ["a"], status: "done" },
      { type: "setPriority", taskIds: ["b"], priority: "high" },
      { type: "setTime", taskId: "b", scheduledTime: "09:00", endTime: "10:30" },
      { type: "rename", taskId: "a", title: "Renamed" },
    ]);
    expect(res.applied).toBe(4);
    const a = get(tasks).find((t) => t.id === "a");
    expect(a?.status).toBe("done");
    expect(a?.completed).toBe(true);
    expect(a?.title).toBe("Renamed");
    const b = get(tasks).find((t) => t.id === "b");
    expect(b?.priority).toBe("high");
    expect(b?.scheduledTime).toBe("09:00");
    expect(b?.endTime).toBe("10:30");

    applyScheduleOps([{ type: "delete", taskIds: ["b"] }]);
    expect(get(tasks).find((t) => t.id === "b")).toBeUndefined();
  });

  it("skips unknown ids", () => {
    const res = applyScheduleOps([
      { type: "move", taskIds: ["a", "ghost"], shiftDays: 1 },
      { type: "rename", taskId: "ghost", title: "x" },
    ]);
    expect(res.applied).toBe(1);
    expect(res.skipped).toBe(2);
    expect(get(tasks).find((t) => t.id === "a")?.dateUID).toBe("day-2026-07-11");
  });

  it("creates a new task", () => {
    const res = applyScheduleOps([
      {
        type: "create",
        title: "New task",
        date: "2026-07-20",
        scheduledTime: "09:00",
        priority: "high",
      },
    ]);
    expect(res.applied).toBe(1);
    const created = get(tasks).find((t) => t.title === "New task");
    expect(created).toBeTruthy();
    expect(created?.dateUID).toBe("day-2026-07-20");
    expect(created?.scheduledTime).toBe("09:00");
    expect(created?.priority).toBe("high");
    expect(created?.status).toBe("todo");
  });
});

describe("describeOp", () => {
  it("uses task titles", () => {
    const tasksList = [makeTask({ id: "a", title: "Milk" })];
    const text = describeOp({ type: "move", taskIds: ["a"], shiftDays: 1 }, tasksList);
    expect(text).toContain("Milk");
  });
});

describe("buildRecsToOpsUser", () => {
  it("embeds analysis text and task context", () => {
    const user = buildRecsToOpsUser("Сдвинь «Buy milk» на день", new Date("2026-07-10T12:00:00"));
    expect(user).toContain("Buy milk");
    expect(user).toContain("2026-07-10");
    expect(user).toContain("id=");
    expect(buildRecsToOpsSystem()).toContain("operations");
  });
});

describe("findFreeSlot", () => {
  it("picks 09:00 on an empty day", () => {
    const slot = findFreeSlot([], 60);
    expect(slot).toEqual({ scheduledTime: "09:00", endTime: "10:00" });
  });

  it("skips existing busy blocks", () => {
    const slot = findFreeSlot(
      [
        { scheduledTime: "09:00", endTime: "11:00" },
        { scheduledTime: "14:00", endTime: "15:00" },
      ],
      60,
    );
    expect(slot).toEqual({ scheduledTime: "11:00", endTime: "12:00" });
  });

  it("uses estimatedTime when endTime missing", () => {
    const slot = findFreeSlot([{ scheduledTime: "09:00", estimatedTime: 120 }], 60);
    expect(slot).toEqual({ scheduledTime: "11:00", endTime: "12:00" });
  });
});

describe("resolveCreateTimes", () => {
  const busy = [
    { scheduledTime: "09:00", endTime: "10:00" },
    { scheduledTime: "11:30", endTime: "12:30" },
  ];

  it("keeps a clear non-overlapping time", () => {
    const r = resolveCreateTimes({
      dateStr: "2026-07-16",
      scheduledTime: "13:00",
      endTime: "14:00",
      estimatedMinutes: 60,
      busy,
    });
    expect(r).toEqual({ scheduledTime: "13:00", endTime: "14:00", estimatedMinutes: 60 });
  });

  it("re-picks when the model time overlaps busy blocks", () => {
    const r = resolveCreateTimes({
      dateStr: "2026-07-16",
      scheduledTime: "09:30",
      endTime: "10:30",
      estimatedMinutes: 60,
      busy,
    });
    expect(r).toEqual({ scheduledTime: "10:00", endTime: "11:00", estimatedMinutes: 60 });
  });

  it("picks free slot when no time given", () => {
    const r = resolveCreateTimes({
      dateStr: "2026-07-16",
      estimatedMinutes: 60,
      busy,
    });
    expect(r).toEqual({ scheduledTime: "10:00", endTime: "11:00", estimatedMinutes: 60 });
  });
});

describe("create «Buy milk» next Thursday (1h) in a free slot", () => {
  /** Next Thursday on/after today (weekday 4). */
  function nextThursday(from = new Date()): string {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    // 4 = Thursday; distance forward including today
    const delta = (4 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  it("places a 60m task without overlap against existing blocks", () => {
    const thu = nextThursday();
    tasks.set([
      makeTask({
        id: "busy1",
        title: "Standup",
        dateUID: `day-${thu}`,
        scheduledTime: "09:00",
        endTime: "10:00",
      }),
      makeTask({
        id: "busy2",
        title: "Call",
        dateUID: `day-${thu}`,
        scheduledTime: "11:30",
        endTime: "12:30",
      }),
    ]);

    // Ops path: create without clock time — apply must pick a free hour
    applyScheduleOps([
      {
        type: "create",
        title: "Купить молоко",
        date: thu,
        estimatedMinutes: 60,
      },
    ]);

    const created = get(tasks).find((t) => t.title === "Купить молоко");
    expect(created).toBeTruthy();
    if (!created) return;
    expect(extractDateFromUID(created.dateUID)).toBe(thu);
    expect(created.estimatedTime).toBe(60);
    // 09:00–10:00 busy → next free snap is 10:00
    expect(created.scheduledTime).toBe("10:00");
    expect(created.endTime).toBe("11:00");
  });
});
