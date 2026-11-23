import { get } from "svelte/store";
import { executeChatTool, CHAT_TOOLS } from "../aiChatTools";
import { tasks, projects } from "../../task-tracker/stores";
import type { ITask } from "../../task-tracker/types";

// create/list/update tools never touch the vault — a stub app is enough.
const app = {} as never;

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

describe("CHAT_TOOLS", () => {
  it("declares the chat toolset with unique names", () => {
    const names = CHAT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        "create_task",
        "list_tasks",
        "update_task",
        "search_notes",
        "read_note",
      ]),
    );
    for (const t of CHAT_TOOLS) {
      expect(t.parameters.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(10);
    }
  });
});

describe("executeChatTool / create_task", () => {
  beforeEach(() => tasks.set([]));

  it("creates a task with defaults for missing fields", async () => {
    const res = await executeChatTool(app, {
      id: "call_1",
      name: "create_task",
      args: { title: "Buy milk" },
    });
    const all = get(tasks);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Buy milk");
    expect(all[0].status).toBe("todo");
    expect(all[0].priority).toBe("medium");
    expect(all[0].dateUID).toMatch(/^day-\d{4}-\d{2}-\d{2}$/);
    expect(res.output).toContain("Buy milk");
    expect(res.notice).toContain("Buy milk");
  });

  it("maps time, priority and description", async () => {
    await executeChatTool(app, {
      id: "call_1",
      name: "create_task",
      args: {
        title: "Deep work",
        date: "2026-07-15",
        scheduledTime: "9.30",
        estimatedMinutes: 90,
        priority: "high",
        description: "Focus block",
      },
    });
    const t = get(tasks)[0];
    expect(t.dateUID).toBe("day-2026-07-15");
    expect(t.scheduledTime).toBe("09:30");
    expect(t.endTime).toBe("11:00");
    expect(t.priority).toBe("high");
    expect(t.description).toBe("Focus block");
    expect(t.estimatedTime).toBe(90);
  });

  it("rejects a missing title", async () => {
    const res = await executeChatTool(app, {
      id: "call_1",
      name: "create_task",
      args: {},
    });
    expect(res.output).toMatch(/error/i);
    expect(get(tasks)).toHaveLength(0);
  });
});

describe("executeChatTool / list_tasks", () => {
  beforeEach(() => {
    tasks.set([
      makeTask({ id: "a", title: "Mon", dateUID: "day-2026-07-10" }),
      makeTask({ id: "b", title: "Tue", dateUID: "day-2026-07-11", status: "done" }),
      makeTask({ id: "c", title: "Wed", dateUID: "day-2026-07-12" }),
    ]);
    projects.set([]);
  });

  it("lists everything when no filter is given", async () => {
    const res = await executeChatTool(app, { id: "1", name: "list_tasks", args: {} });
    expect(res.output).toContain("Mon");
    expect(res.output).toContain("Wed");
  });

  it("filters by date range", async () => {
    const res = await executeChatTool(app, {
      id: "1",
      name: "list_tasks",
      args: { dateFrom: "2026-07-11", dateTo: "2026-07-11" },
    });
    expect(res.output).toContain("Tue");
    expect(res.output).not.toContain("Mon");
  });

  it("filters by status", async () => {
    const res = await executeChatTool(app, {
      id: "1",
      name: "list_tasks",
      args: { status: "done" },
    });
    expect(res.output).toContain("Tue");
    expect(res.output).not.toContain("Mon");
  });
});

describe("executeChatTool / update_task", () => {
  beforeEach(() => {
    tasks.set([
      makeTask({ id: "t1", title: "Buy milk", dateUID: "day-2026-07-10" }),
      makeTask({ id: "t2", title: "Other", dateUID: "day-2026-07-10" }),
    ]);
    projects.set([]);
  });

  it("updates by exact id", async () => {
    const res = await executeChatTool(app, {
      id: "1",
      name: "update_task",
      args: { taskId: "t1", status: "done", priority: "high" },
    });
    const t = get(tasks).find((x) => x.id === "t1");
    expect(t?.status).toBe("done");
    expect(t?.completed).toBe(true);
    expect(t?.priority).toBe("high");
    expect(res.notice).toContain("Buy milk");
  });

  it("resolves a unique title and moves the date", async () => {
    await executeChatTool(app, {
      id: "1",
      name: "update_task",
      args: { taskId: "Buy milk", date: "2026-07-20" },
    });
    const t = get(tasks).find((x) => x.id === "t1");
    expect(t?.dateUID).toBe("day-2026-07-20");
  });

  it("reports unknown tasks without touching the store", async () => {
    const res = await executeChatTool(app, {
      id: "1",
      name: "update_task",
      args: { taskId: "nope", title: "x" },
    });
    expect(res.output).toMatch(/no task/i);
    expect(get(tasks)).toHaveLength(2);
  });

  it("needs at least one change", async () => {
    const res = await executeChatTool(app, {
      id: "1",
      name: "update_task",
      args: { taskId: "t1" },
    });
    expect(res.output).toMatch(/nothing to update/i);
  });
});

describe("executeChatTool / misc", () => {
  it("answers with an error for unknown tool names", async () => {
    const res = await executeChatTool(app, {
      id: "1",
      name: "drop_database",
      args: {},
    });
    expect(res.output).toMatch(/unknown tool/i);
  });

  it("reports a missing note instead of throwing", async () => {
    const res = await executeChatTool(
      {
        vault: {
          getMarkdownFiles: () => [],
        },
      } as never,
      { id: "1", name: "read_note", args: { path: "ghost" } },
    );
    expect(res.output).toMatch(/no note/i);
  });
});

describe("executeChatTool / notes", () => {
  function noteApp(notes: Array<{ path: string; basename: string; content: string }>) {
    const files = notes.map((n) => ({
      path: n.path,
      basename: n.basename,
      extension: "md",
      stat: { mtime: 1 },
    }));
    return {
      vault: {
        getMarkdownFiles: () => files,
        cachedRead: (f: { path: string }) =>
          Promise.resolve(notes.find((n) => n.path === f.path)?.content ?? ""),
      },
    } as never;
  }

  const sample = noteApp([
    { path: "Recipes/Borscht.md", basename: "Borscht", content: "# Borscht\nBeet soup recipe." },
    { path: "Work/Meeting.md", basename: "Meeting", content: "Talk about roadmap." },
    { path: "Ideas.md", basename: "Ideas", content: "Some ideas about borscht variations." },
  ]);

  it("finds notes by name", async () => {
    const res = await executeChatTool(sample, {
      id: "1",
      name: "search_notes",
      args: { query: "meeting" },
    });
    expect(res.output).toContain("Work/Meeting.md");
    expect(res.output).not.toContain("Recipes/Borscht.md");
  });

  it("finds notes by content", async () => {
    const res = await executeChatTool(sample, {
      id: "1",
      name: "search_notes",
      args: { query: "roadmap" },
    });
    expect(res.output).toContain("Work/Meeting.md");
  });

  it("reports when nothing matches", async () => {
    const res = await executeChatTool(sample, {
      id: "1",
      name: "search_notes",
      args: { query: "zzz-nothing" },
    });
    expect(res.output).toMatch(/no notes/i);
  });

  it("reads a note by unique title", async () => {
    const res = await executeChatTool(sample, {
      id: "1",
      name: "read_note",
      args: { path: "Borscht" },
    });
    expect(res.output).toContain("Beet soup recipe.");
    expect(res.output).toContain("Recipes/Borscht.md");
  });

  it("reads a note by exact path", async () => {
    const res = await executeChatTool(sample, {
      id: "1",
      name: "read_note",
      args: { path: "Work/Meeting.md" },
    });
    expect(res.output).toContain("Talk about roadmap.");
  });
});

describe("executeChatTool / smoke", () => {
  beforeEach(() => {
    tasks.set([]);
    projects.set([]);
  });

  it("every declared tool executes and returns non-empty output", async () => {
    const appStub = {
      workspace: { getActiveViewOfType: () => null },
      vault: {
        getMarkdownFiles: () => [],
        cachedRead: () => Promise.resolve(""),
        getAbstractFileByPath: () => null,
        create: () => Promise.resolve({ path: "x.md" }),
        createFolder: () => Promise.resolve(),
        read: () => Promise.resolve(""),
        modify: () => Promise.resolve(),
      },
    } as never;
    const argsFor: Record<string, Record<string, unknown>> = {
      create_task: { title: "Smoke task", date: "2026-07-10" },
      list_tasks: {},
      update_task: { taskId: "Smoke task", priority: "high" },
      search_notes: { query: "x" },
      read_note: { path: "x" },
      create_note: { title: "Smoke note", folder: "Smoke" },
      append_note: { path: "x", content: "more text" },
    };
    for (const tool of CHAT_TOOLS) {
      const res = await executeChatTool(appStub, {
        id: `smoke_${tool.name}`,
        name: tool.name,
        args: argsFor[tool.name],
      });
      expect(typeof res.output).toBe("string");
      expect(res.output.length).toBeGreaterThan(0);
    }
    expect(get(tasks)).toHaveLength(1);
    expect(get(tasks)[0].priority).toBe("high");
  });
});

describe("executeChatTool / create_note & append_note", () => {
  /** In-memory vault with the handful of APIs the note tools use. */
  function makeVaultApp() {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    const app = {
      vault: {
        getMarkdownFiles: () =>
          [...files.keys()].map((path) => ({
            path,
            basename: path.replace(/\.md$/, "").split("/").pop() ?? path,
            extension: "md",
            stat: { mtime: 1 },
          })),
        getAbstractFileByPath: (p: string) =>
          files.has(p) ? { path: p } : folders.has(p) ? { path: p } : null,
        createFolder: (p: string) => {
          folders.add(p);
          return Promise.resolve({ path: p });
        },
        create: (p: string, content: string) => {
          if (files.has(p)) return Promise.reject(new Error("File already exists"));
          files.set(p, content);
          return Promise.resolve({ path: p });
        },
        cachedRead: (f: { path: string }) => Promise.resolve(files.get(f.path) ?? ""),
        read: (f: { path: string }) => Promise.resolve(files.get(f.path) ?? ""),
        modify: (f: { path: string }, content: string) => {
          files.set(f.path, content);
          return Promise.resolve();
        },
      },
    };
    return { app: app as never, files };
  }

  it("creates a note in the vault root", async () => {
    const { app, files } = makeVaultApp();
    const res = await executeChatTool(app, {
      id: "1",
      name: "create_note",
      args: { title: "Shopping", content: "- milk" },
    });
    expect(res.output).toContain("Shopping.md");
    expect(files.get("Shopping.md")).toBe("- milk\n");
    expect(res.notice).toContain("Shopping.md");
  });

  it("creates the folder when missing and nests the note inside", async () => {
    const { app, files, } = makeVaultApp();
    const res = await executeChatTool(app, {
      id: "1",
      name: "create_note",
      args: { title: "Report", folder: "Work/2026", content: "# Report" },
    });
    expect(res.output).toContain("Work/2026/Report.md");
    expect(files.get("Work/2026/Report.md")).toBe("# Report\n");
  });

  it("sanitizes illegal characters in the title", async () => {
    const { app, files } = makeVaultApp();
    await executeChatTool(app, {
      id: "1",
      name: "create_note",
      args: { title: 'We:ird/*?"<>| name' },
    });
    expect([...files.keys()]).toEqual(["Weird name.md"]);
  });

  it("refuses to overwrite an existing note", async () => {
    const { app, files } = makeVaultApp();
    files.set("Dup.md", "old");
    const res = await executeChatTool(app, {
      id: "1",
      name: "create_note",
      args: { title: "Dup", content: "new" },
    });
    expect(res.output).toMatch(/already exists/i);
    expect(files.get("Dup.md")).toBe("old");
  });

  it("appends to an existing note", async () => {
    const { app, files } = makeVaultApp();
    files.set("Log.md", "first line");
    const res = await executeChatTool(app, {
      id: "1",
      name: "append_note",
      args: { path: "Log", content: "second line" },
    });
    expect(files.get("Log.md")).toBe("first line\nsecond line\n");
    expect(res.notice).toContain("Log.md");
  });

  it("points to create_note when the target is missing", async () => {
    const { app } = makeVaultApp();
    const res = await executeChatTool(app, {
      id: "1",
      name: "append_note",
      args: { path: "Ghost", content: "x" },
    });
    expect(res.output).toMatch(/create_note/i);
  });
});
