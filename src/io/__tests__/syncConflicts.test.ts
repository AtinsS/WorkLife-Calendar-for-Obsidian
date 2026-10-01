import { baseNameFromConflict, cleanupSyncConflictFiles, isSyncConflictName } from "../syncConflicts";

function makeApp(store: Record<string, string>, mtimes: Record<string, number> = {}) {
  const list = (dir: string) => {
    const prefix = dir === "/" || dir === "" ? "" : dir.replace(/\/$/, "") + "/";
    const files = Object.keys(store)
      .filter((p) => (prefix === "" ? !p.includes("/") : p.startsWith(prefix) && !p.slice(prefix.length).includes("/")))
      .map((p) => prefix + p.slice(prefix.length));
    return Promise.resolve({ files, folders: [] });
  };
  return {
    vault: {
      adapter: {
        list,
        read: (p: string) => {
          if (!(p in store)) return Promise.reject(new Error("missing " + p));
          return Promise.resolve(store[p]);
        },
        write: (p: string, c: string) => {
          store[p] = c;
          mtimes[p] = Date.now();
          return Promise.resolve();
        },
        remove: (p: string) => {
          delete store[p];
          delete mtimes[p];
          return Promise.resolve();
        },
        stat: (p: string) => {
          if (!(p in store)) return Promise.resolve(null);
          return Promise.resolve({ mtime: mtimes[p] ?? 0, ctime: 0, size: store[p].length, type: "file" });
        },
      },
    },
  } as never;
}

describe("sync conflict helpers", () => {
  it("detects syncthing conflict names", () => {
    expect(isSyncConflictName("tasks.json.sync-conflict-20240101-120000-ABCDEF12")).toBe(true);
    expect(isSyncConflictName("tasks.sync-conflict-20240101-120000-ABCDEF12.json")).toBe(true);
    expect(isSyncConflictName("tasks.json")).toBe(false);
    expect(isSyncConflictName("data.json")).toBe(false);
  });

  it("extracts base name from both conflict patterns", () => {
    expect(baseNameFromConflict("tasks.json.sync-conflict-20240101-120000-ABCDEF12")).toBe("tasks.json");
    expect(baseNameFromConflict("tasks.sync-conflict-20240101-120000-ABCDEF12.json")).toBe("tasks.json");
    expect(baseNameFromConflict("tasks.json")).toBe("tasks.json");
  });
});

describe("cleanupSyncConflictFiles", () => {
  it("keeps newest conflict content and removes copies", async () => {
    const store: Record<string, string> = {
      "calendar-data/tasks.json": "old",
      "calendar-data/tasks.json.sync-conflict-20240101-120000-AAA11111": "new",
    };
    const mtimes: Record<string, number> = {
      "calendar-data/tasks.json": 1000,
      "calendar-data/tasks.json.sync-conflict-20240101-120000-AAA11111": 2000,
    };
    const app = makeApp(store, mtimes);
    const removed = await cleanupSyncConflictFiles(app, ["calendar-data"]);
    expect(removed).toBe(1);
    expect(store["calendar-data/tasks.json"]).toBe("new");
    expect(Object.keys(store).filter((k) => k.includes("sync-conflict"))).toHaveLength(0);
  });

  it("keeps original when it is newer and drops conflicts", async () => {
    const store: Record<string, string> = {
      "calendar-data/tasks.json": "current",
      "calendar-data/tasks.json.sync-conflict-20240101-120000-AAA11111": "stale",
      "calendar-data/tasks.sync-conflict-20240102-120000-BBB22222.json": "stale2",
    };
    const mtimes: Record<string, number> = {
      "calendar-data/tasks.json": 5000,
      "calendar-data/tasks.json.sync-conflict-20240101-120000-AAA11111": 1000,
      "calendar-data/tasks.sync-conflict-20240102-120000-BBB22222.json": 2000,
    };
    const app = makeApp(store, mtimes);
    const removed = await cleanupSyncConflictFiles(app, ["calendar-data"]);
    expect(removed).toBe(2);
    expect(store["calendar-data/tasks.json"]).toBe("current");
    expect(Object.keys(store).filter((k) => k.includes("sync-conflict"))).toHaveLength(0);
  });

  it("ignores non-conflict files", async () => {
    const store: Record<string, string> = {
      "calendar-data/tasks.json": "ok",
      "calendar-data/finance.json": "ok2",
    };
    const app = makeApp(store);
    const removed = await cleanupSyncConflictFiles(app, ["calendar-data"]);
    expect(removed).toBe(0);
    expect(store["calendar-data/tasks.json"]).toBe("ok");
    expect(store["calendar-data/finance.json"]).toBe("ok2");
  });

  it("cleans plugin data.json conflicts in root dir", async () => {
    const store: Record<string, string> = {
      "data.json": "a",
      "data.json.sync-conflict-20240101-120000-CCC33333": "b",
    };
    const mtimes: Record<string, number> = {
      "data.json": 100,
      "data.json.sync-conflict-20240101-120000-CCC33333": 999,
    };
    const app = makeApp(store, mtimes);
    const removed = await cleanupSyncConflictFiles(app, [""]);
    expect(removed).toBe(1);
    expect(store["data.json"]).toBe("b");
    expect(Object.keys(store).filter((k) => k.includes("sync-conflict"))).toHaveLength(0);
  });
});
