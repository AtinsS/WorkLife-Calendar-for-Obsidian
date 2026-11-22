import { TFile } from "obsidian";
import { mergeContextFiles, MAX_FILES } from "../AiAskChat";

function f(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.basename = path.replace(/\.md$/, "");
  return file;
}

function paths(files: TFile[]): string[] {
  return files.map((x) => x.path);
}

describe("mergeContextFiles", () => {
  it("replaces the whole context when nothing is pinned", () => {
    const out = mergeContextFiles([f("a.md"), f("b.md")], new Set(), [f("c.md")]);
    expect(paths(out)).toEqual(["c.md"]);
  });

  it("keeps pinned notes and replaces the rest", () => {
    const out = mergeContextFiles(
      [f("a.md"), f("b.md")],
      new Set(["a.md"]),
      [f("c.md")],
    );
    expect(paths(out)).toEqual(["a.md", "c.md"]);
  });

  it("drops the previous transient note on every switch", () => {
    const pinned = new Set(["a.md"]);
    const first = mergeContextFiles([f("a.md")], pinned, [f("b.md")]);
    const second = mergeContextFiles(first, pinned, [f("c.md")]);
    expect(paths(first)).toEqual(["a.md", "b.md"]);
    expect(paths(second)).toEqual(["a.md", "c.md"]);
  });

  it("does not duplicate an incoming note that is already pinned", () => {
    const a = f("a.md");
    const out = mergeContextFiles([a], new Set(["a.md"]), [a]);
    expect(paths(out)).toEqual(["a.md"]);
  });

  it("caps at MAX_FILES keeping pinned first", () => {
    const many = Array.from({ length: MAX_FILES }, (_, i) => f(`n${i}.md`));
    const out = mergeContextFiles([f("p.md")], new Set(["p.md"]), many);
    expect(out).toHaveLength(MAX_FILES);
    expect(out[0].path).toBe("p.md");
  });
});
