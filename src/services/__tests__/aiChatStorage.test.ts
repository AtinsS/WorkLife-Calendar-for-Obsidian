/**
 * Persistence of the AI chat (pinned notes, context, conversation) —
 * calendar-data/aiChat.json via vaultStorage.
 */
import { TFile, App } from "obsidian";
import {
  loadAiChatSnapshot,
  saveAiChatSnapshot,
  parseSnapshot,
  resolveSnapshotFiles,
  type AiChatSnapshot,
} from "../aiChatStorage";

// ─── Vault mock ──────────────────────────────────────────────────────────
let vaultStore: Record<string, string> = {};

function createMockApp(): App {
  return {
    vault: {
      getAbstractFileByPath(path: string) {
        if (vaultStore[path] !== undefined) {
          const file = new TFile();
          Object.defineProperty(file, "path", { value: path, writable: false });
          return file;
        }
        return null;
      },
      read(file: { path: string }) {
        return Promise.resolve(vaultStore[file.path] ?? "");
      },
      modify(_file: { path: string }, content: string) {
        vaultStore[_file.path] = content;
        return Promise.resolve();
      },
      create(path: string, content: string) {
        vaultStore[path] = content;
        return Promise.resolve();
      },
      async createFolder(_path: string) {
        // no-op — directories are implicit in vault mock
      },
    },
  } as unknown as App;
}

function snap(over: Partial<AiChatSnapshot> = {}): AiChatSnapshot {
  return {
    files: ["a.md"],
    pinnedPaths: ["a.md"],
    contextLabel: "a",
    messages: [{ role: "user", text: "hi" }],
    ...over,
  };
}

function must(s: AiChatSnapshot | null): AiChatSnapshot {
  if (!s) throw new Error("expected a snapshot");
  return s;
}

beforeEach(() => {
  vaultStore = {};
});

describe("parseSnapshot", () => {
  it("returns null for empty or garbage data", () => {
    expect(parseSnapshot({})).toBeNull();
    expect(parseSnapshot({ files: [], messages: [], pinnedPaths: [] })).toBeNull();
    expect(parseSnapshot({ files: "nope", messages: 42 })).toBeNull();
  });

  it("keeps valid messages and drops malformed ones", () => {
    const parsed = must(
      parseSnapshot({
        files: ["a.md", 7, "b.md"],
        pinnedPaths: ["a.md"],
        contextLabel: "notes",
        messages: [
          { role: "user", text: "hello" },
          { role: "bot", text: "wrong role" },
          { role: "assistant", text: "" },
          { role: "assistant", text: "hi!", thinking: "hmm" },
          "junk",
        ],
      }),
    );
    expect(parsed.files).toEqual(["a.md", "b.md"]);
    expect(parsed.contextLabel).toBe("notes");
    expect(parsed.messages).toEqual([
      { role: "user", text: "hello", thinking: undefined },
      { role: "assistant", text: "hi!", thinking: "hmm" },
    ]);
  });
});

describe("save / load round trip", () => {
  it("restores pins, context and conversation", async () => {
    const app = createMockApp();
    const original = snap({
      files: ["pinned.md", "other.md"],
      pinnedPaths: ["pinned.md"],
      contextLabel: "pinned, other",
      messages: [
        { role: "user", text: "q" },
        { role: "assistant", text: "a", thinking: "why" },
      ],
    });
    await saveAiChatSnapshot(app, original);
    const loaded = await loadAiChatSnapshot(app);
    expect(loaded).toEqual(original);
  });

  it("returns null when nothing was saved yet", async () => {
    const app = createMockApp();
    expect(await loadAiChatSnapshot(app)).toBeNull();
  });

  it("caps the stored transcript at 200 messages", async () => {
    const app = createMockApp();
    const messages = Array.from({ length: 250 }, (_, i) => ({
      role: "user" as const,
      text: `m${i}`,
    }));
    await saveAiChatSnapshot(app, snap({ messages }));
    const loaded = must(await loadAiChatSnapshot(app));
    expect(loaded.messages).toHaveLength(200);
    expect(loaded.messages[0].text).toBe("m50");
  });
});

describe("resolveSnapshotFiles", () => {
  it("drops notes deleted or renamed since the snapshot", () => {
    vaultStore["a.md"] = "# a";
    vaultStore["b.md"] = "# b";
    const app = createMockApp();
    const { files, pinnedPaths } = resolveSnapshotFiles(
      app,
      snap({ files: ["a.md", "gone.md", "b.md"], pinnedPaths: ["a.md", "gone.md"] }),
    );
    expect(files.map((f) => f.path)).toEqual(["a.md", "b.md"]);
    expect([...pinnedPaths]).toEqual(["a.md"]);
  });

  it("keeps only the paths that are both present and pinned", () => {
    vaultStore["a.md"] = "# a";
    const app = createMockApp();
    const { files, pinnedPaths } = resolveSnapshotFiles(
      app,
      snap({ files: ["a.md", "b.md"], pinnedPaths: ["b.md"] }),
    );
    expect(files.map((f) => f.path)).toEqual(["a.md"]);
    expect(pinnedPaths.size).toBe(0);
  });
});
