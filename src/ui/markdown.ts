/**
 * Lightweight markdown renderer for AI output inside CustomModal dialogs.
 * Extracted from AIScheduleModal so finance / expense modals share the same look.
 */
import { type App, normalizePath, TFile } from "obsidian";

/** Parse inline markdown (bold/italic/code/link/strike) into a container. */
export function renderInline(host: HTMLElement, text: string): void {
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (s: string) => {
    if (s) host.append(document.createTextNode(s));
  };
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) pushText(text.slice(last, m.index));
    const tok = m[0];
    if (m[1]) {
      host.createEl("code", { text: tok.slice(1, -1), cls: "ai-sch-out-code" });
    } else if (m[2]) {
      host.createEl("strong", {
        text: tok.replace(/^\*\*|^__|\*\*$|__$/g, ""),
        cls: "ai-sch-out-strong",
      });
    } else if (m[3]) {
      host.createEl("em", {
        text: tok.slice(1, -1),
        cls: "ai-sch-out-em",
      });
    } else if (m[4]) {
      host.createEl("s", {
        text: tok.slice(2, -2),
        cls: "ai-sch-out-strike",
      });
    } else if (m[5]) {
      const linkM = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      if (linkM) {
        const a = host.createEl("a", {
          text: linkM[1],
          cls: "ai-sch-out-link",
          href: linkM[2],
        });
        a.setAttribute("rel", "noopener noreferrer");
      }
    }
    last = m.index + tok.length;
  }
  pushText(text.slice(last));
}

/** Render markdown-ish text as a readable document (not an input). */
export function renderMarkdown(el: HTMLElement, md: string): void {
  el.empty();
  if (!md.trim()) return;

  const lines = md.split(/\r?\n/);
  let listEl: HTMLElement | null = null;

  const closeList = () => {
    listEl = null;
  };

  const isTableRow = (s: string) =>
    /^\s*\|.*\|\s*$/.test(s) || (s.includes("|") && s.trim().startsWith("|"));
  const isTableSep = (s: string) =>
    /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(s) && s.includes("-");

  const splitRow = (s: string): string[] =>
    s
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Fenced code block ``` ... ```
    if (/^\s*```/.test(line)) {
      closeList();
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const pre = el.createEl("pre", { cls: "ai-sch-out-pre" });
      pre.createEl("code", { text: buf.join("\n"), cls: "ai-sch-out-codeblock" });
      continue;
    }

    // Table
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isTableSep(lines[i + 1]) &&
      isTableRow(lines[i + 1])
    ) {
      closeList();
      const wrap = el.createDiv({ cls: "ai-sch-out-table-wrap" });
      const table = wrap.createEl("table", { cls: "ai-sch-out-table" });
      const thead = table.createEl("thead");
      const headTr = thead.createEl("tr");
      for (const cell of splitRow(line)) {
        const th = headTr.createEl("th", { cls: "ai-sch-out-th" });
        renderInline(th, cell);
      }
      const tbody = table.createEl("tbody");
      i += 2;
      while (i < lines.length && isTableRow(lines[i]) && lines[i].trim()) {
        const tr = tbody.createEl("tr", { cls: "ai-sch-out-tr" });
        for (const cell of splitRow(lines[i])) {
          const td = tr.createEl("td", { cls: "ai-sch-out-td" });
          renderInline(td, cell);
        }
        i++;
      }
      continue;
    }

    if (!line.trim()) {
      closeList();
      el.createDiv({ cls: "ai-sch-out-spacer" });
      i++;
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      closeList();
      const level = Math.min(6, line.match(/^#+/)?.[0].length || 1);
      const text = line.replace(/^#{1,6}\s+/, "");
      const tag = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[level - 1];
      const h = el.createEl(tag, { cls: `ai-sch-out-h ai-sch-out-h${level}` });
      renderInline(h, text);
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      closeList();
      const quote = el.createEl("blockquote", { cls: "ai-sch-out-quote" });
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        const qLine = lines[i].replace(/^\s*>\s?/, "");
        const p = quote.createEl("p", { cls: "ai-sch-out-p" });
        renderInline(p, qLine);
        i++;
      }
      continue;
    }

    // Task list item  - [ ] / - [x]
    const taskM = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (taskM) {
      closeList();
      const wrap = el.createDiv({ cls: "ai-sch-out-task" });
      const box = wrap.createDiv({
        cls: `ai-sch-out-check${taskM[1].toLowerCase() === "x" ? " is-done" : ""}`,
      });
      if (taskM[1].toLowerCase() === "x")
        box.createSpan({ text: "✓", cls: "ai-sch-out-check-mark" });
      const label = wrap.createDiv({ cls: "ai-sch-out-task-label" });
      renderInline(label, taskM[2]);
      i++;
      continue;
    }

    // Bullet / numbered list
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const text = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
      if (!listEl) {
        listEl = ordered
          ? el.createEl("ol", { cls: "ai-sch-out-list ai-sch-out-list--ol" })
          : el.createEl("ul", { cls: "ai-sch-out-list" });
      }
      const li = listEl.createEl("li", { cls: "ai-sch-out-li" });
      renderInline(li, text);
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line) || /^\s*\*\*\*\s*$/.test(line)) {
      closeList();
      el.createDiv({ cls: "ai-sch-out-rule" });
      i++;
      continue;
    }

    closeList();
    const p = el.createEl("p", { cls: "ai-sch-out-p" });
    renderInline(p, line.trim());
    i++;
  }
}

/**
 * Append markdown to a note (creates the file if missing).
 * Returns the vault path of the note.
 */
export async function appendMarkdownToNote(
  app: App,
  path: string,
  body: string,
): Promise<string> {
  const full = normalizePath(path);
  const existing = app.vault.getAbstractFileByPath(full);
  if (existing instanceof TFile) {
    const prev = await app.vault.read(existing);
    const sep = prev ? "\n\n" : "";
    await app.vault.modify(existing, `${prev}${sep}${body}\n`);
  } else if (existing) {
    // non-md collision — pick a unique name
    const dot = full.lastIndexOf(".");
    const base = dot > 0 ? full.slice(0, dot) : full;
    const ext = dot > 0 ? full.slice(dot) : ".md";
    let n = 2;
    let candidate = `${base} ${n}${ext}`;
    while (app.vault.getAbstractFileByPath(candidate)) {
      n += 1;
      candidate = `${base} ${n}${ext}`;
    }
    await app.vault.create(candidate, `${body}\n`);
    return candidate;
  } else {
    await app.vault.create(full, `${body}\n`);
  }
  return full;
}

/** Build a dated note path like `Прогноз бюджета 2026-02-14.md`. */
export function datedNotePath(title: string, date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const safe = title.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return `${safe} ${y}-${m}-${d}.md`;
}
