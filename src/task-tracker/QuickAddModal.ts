import { App, Modal } from "obsidian";
import type { Moment } from "moment";
import { getDateUID } from "obsidian-daily-notes-interface";
import { get } from "svelte/store";
import { tRaw, locale } from "../i18n";
import { addTask } from "./stores";

const wm = window.moment as (format?: string) => Moment;

interface ParsedSegment {
  type: "priority" | "date" | "time" | "title";
  text: string;
}

interface ParsedResult {
  title: string;
  scheduledTime: string | null;
  endTime: string | null;
  priority: "low" | "medium" | "high" | null;
  date: Moment | null;
  dateLabel: string | null;
  segments: ParsedSegment[];
}

// Date keyword maps
const RU_DAYS: Record<string, number> = {
  "пн": 1, "понедельник": 1,
  "вт": 2, "вторник": 2,
  "ср": 3, "среда": 3,
  "чт": 4, "четверг": 4,
  "пт": 5, "пятница": 5,
  "сб": 6, "суббота": 6,
  "вс": 7, "воскресенье": 7,
};

const EN_DAYS: Record<string, number> = {
  "mon": 1, "monday": 1,
  "tue": 2, "tuesday": 2,
  "wed": 3, "wednesday": 3,
  "thu": 4, "thursday": 4,
  "fri": 5, "friday": 5,
  "sat": 6, "saturday": 6,
  "sun": 7, "sunday": 7,
};

const RU_MONTHS: Record<string, number> = {
  "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
  "мая": 5, "июня": 6, "июля": 7, "августа": 8,
  "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
};

const EN_MONTHS: Record<string, number> = {
  "january": 1, "february": 2, "march": 3, "april": 4,
  "may": 5, "june": 6, "july": 7, "august": 8,
  "september": 9, "october": 10, "november": 11, "december": 12,
  "jan": 1, "feb": 2, "mar": 3, "apr": 4,
  "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
};

function normalizeTime(raw: string): string {
  if (raw.includes(":")) {
    const [h, m] = raw.split(":");
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  }
  return `${raw.padStart(2, "0")}:00`;
}

interface ParsedSegment {
  type: "priority" | "date" | "time" | "title";
  text: string;
  start: number;
  end: number;
}

interface ParsedResult {
  title: string;
  scheduledTime: string | null;
  endTime: string | null;
  priority: "low" | "medium" | "high" | null;
  date: Moment | null;
  dateLabel: string | null;
  segments: ParsedSegment[];
}

function parseQuickInput(raw: string): ParsedResult {
  const text = raw.trim();
  const loc = get(locale) === "en" ? "en" : "ru";
  const now = wm() as Moment;
  const found: ParsedSegment[] = [];
  let scheduledTime: string | null = null;
  let endTime: string | null = null;
  let priority: "low" | "medium" | "high" | null = null;
  let date: Moment | null = null;
  let dateLabel: string | null = null;

  // --- 1. Find priority at start ---
  const prioRe = /^(!{1,2}|~|-)\s*/;
  const prioM = text.match(prioRe);
  if (prioM) {
    const p = prioM[1];
    priority = p === "!" || p === "!!" ? "high" : p === "~" ? "medium" : "low";
    found.push({ type: "priority", text: prioM[0], start: 0, end: prioM[0].length });
  }

  // --- 2. Find all date tokens anywhere ---
  const dayMap = loc === "en" ? EN_DAYS : { ...EN_DAYS, ...RU_DAYS };
  const monthMap = loc === "en" ? EN_MONTHS : RU_MONTHS;

  const datePatterns: Array<{ re: RegExp; resolve: (m: RegExpMatchArray) => { date: Moment; label: string } | null }> = [
    // завтра / tomorrow
    { re: /(?:^|\s)(завтра|завтр|tomorrow)(?:\s|$)/gi, resolve: () => ({ date: now.clone().add(1, "day"), label: loc === "en" ? "tomorrow" : "завтра" }) },
    // сегодня / today
    { re: /(?:^|\s)(сегодня|today)(?:\s|$)/gi, resolve: () => ({ date: now.clone(), label: loc === "en" ? "today" : "сегодня" }) },
    // послезавтра / day after tomorrow
    { re: /(?:^|\s)(послезавтра|day after tomorrow|dat)(?:\s|$)/gi, resolve: () => ({ date: now.clone().add(2, "day"), label: loc === "en" ? "day after tomorrow" : "послезавтра" }) },
    // +N days
    { re: /\+(\d{1,3})(?:\s|$)/g, resolve: (m) => { const d = parseInt(m[1]); return d > 0 && d <= 365 ? { date: now.clone().add(d, "day"), label: `+${d}` } : null; } },
    // weekday names
    { re: new RegExp(`(?:^|\\s)(${Object.keys(dayMap).join("|")})(?:\\s|$)`, "gi"), resolve: (m) => {
      const key = m[1].toLowerCase();
      const num = dayMap[key];
      if (num === undefined) return null;
      const momentDay = num === 7 ? 0 : num;
      const target = now.clone().day(momentDay);
      if (target.isBefore(now, "day")) target.add(1, "week");
      return { date: target, label: m[1].toLowerCase() };
    }},
    // DD.MM or DD/MM
    { re: /(?:^|\s)(\d{1,2})[./](\d{1,2})(?:\s|$)/g, resolve: (m) => {
      const day = parseInt(m[1]), month = parseInt(m[2]);
      if (day < 1 || day > 31 || month < 1 || month > 12) return null;
      const target = wm({ year: now.year(), month: month - 1, day }) as Moment;
      if (target.isBefore(now, "day")) target.add(1, "year");
      return { date: target, label: m[0].trim() };
    }},
    // DD месяц (e.g. "25 июля")
    { re: new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(${Object.keys(monthMap).join("|")})(?:\\s|$)`, "gi"), resolve: (m) => {
      const day = parseInt(m[1]);
      const monthNum = monthMap[m[2].toLowerCase()];
      if (day < 1 || day > 31 || monthNum === undefined) return null;
      const target = wm({ year: now.year(), month: monthNum - 1, day }) as Moment;
      if (target.isBefore(now, "day")) target.add(1, "year");
      return { date: target, label: m[0].trim() };
    }},
    // YYYY-MM-DD
    { re: /(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?:\s|$)/g, resolve: (m) => {
      const target = wm(`${m[1]}-${m[2]}-${m[3]}`, "YYYY-MM-DD", true) as Moment;
      return target.isValid() ? { date: target, label: m[0].trim() } : null;
    }},
  ];

  for (const { re, resolve } of datePatterns) {
    let m: RegExpMatchArray | null;
    while ((m = re.exec(text)) !== null) {
      const result = resolve(m);
      if (result) {
        date = result.date;
        dateLabel = result.label;
        found.push({ type: "date", text: m[0], start: m.index, end: m.index + m[0].length });
        break; // take first date match
      }
    }
    if (date) break;
  }

  // --- 3. Find all time tokens anywhere ---
  // "с HH:MM по/до HH:MM" or "с HH по HH"
  const rangeRe = /с\s*(\d{1,2}(?::\d{2})?)\s*(?:по|до|-)\s*(\d{1,2}(?::\d{2})?)/gi;
  let rangeM: RegExpMatchArray | null;
  while ((rangeM = rangeRe.exec(text)) !== null) {
    scheduledTime = normalizeTime(rangeM[1]);
    endTime = normalizeTime(rangeM[2]);
    found.push({ type: "time", text: rangeM[0], start: rangeM.index, end: rangeM.index + rangeM[0].length });
    break;
  }

  // "HH:MM-HH:MM" or "HH-HH" (only if no range found)
  if (!scheduledTime) {
    const dashRe = /\b(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\b/g;
    const dashM = dashRe.exec(text);
    if (dashM) {
      scheduledTime = normalizeTime(dashM[1]);
      endTime = normalizeTime(dashM[2]);
      found.push({ type: "time", text: dashM[0], start: dashM.index, end: dashM.index + dashM[0].length });
    }
  }
  if (!scheduledTime) {
    const dashRe2 = /\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b/g;
    const dashM2 = dashRe2.exec(text);
    if (dashM2) {
      scheduledTime = normalizeTime(dashM2[1]);
      endTime = normalizeTime(dashM2[2]);
      found.push({ type: "time", text: dashM2[0], start: dashM2.index, end: dashM2.index + dashM2[0].length });
    }
  }

  // "в HH:MM" or standalone "HH:MM" (only if no range found)
  if (!scheduledTime) {
    const singleRe = /\b(?:в\s*)?(\d{1,2}:\d{2})\b/gi;
    let singleM: RegExpMatchArray | null;
    while ((singleM = singleRe.exec(text)) !== null) {
      scheduledTime = normalizeTime(singleM[1]);
      found.push({ type: "time", text: singleM[0], start: singleM.index, end: singleM.index + singleM[0].length });
      break;
    }
  }

  // --- 4. Sort found tokens by position and build segments ---
  found.sort((a, b) => a.start - b.start);

  const segments: ParsedSegment[] = [];
  let cursor = 0;
  for (const tok of found) {
    // Skip priority if it overlaps with something else
    if (tok.type === "priority" && tok.start > 0) continue;
    // Add title text before this token
    if (tok.start > cursor) {
      const gap = text.slice(cursor, tok.start);
      if (gap.trim()) segments.push({ type: "title", text: gap, start: cursor, end: tok.start });
    }
    segments.push(tok);
    cursor = tok.end;
  }
  // Remaining text after last token
  if (cursor < text.length) {
    const rest = text.slice(cursor);
    if (rest.trim()) segments.push({ type: "title", text: rest, start: cursor, end: text.length });
  }

  // Extract title from segments
  const titleParts = segments.filter((s) => s.type === "title").map((s) => s.text.trim()).filter(Boolean);
  const title = titleParts.join(" ");

  return { title, scheduledTime, endTime, priority, date, dateLabel, segments };
}

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

export class QuickAddModal extends Modal {
  private date: Moment;
  private onSubmit: () => void;

  constructor(app: App, date: Moment, onSubmit?: () => void) {
    super(app);
    this.date = date;
    this.onSubmit = onSubmit ?? (() => { /* noop */ });
  }

  onOpen(): void {
    const { contentEl } = this;

    // Modal container with glassmorphism
    contentEl.addClass("quick-add-modal");

    // Header with date
    const header = contentEl.createDiv({ cls: "quick-add-header" });

    header.createSpan({ text: "📅", cls: "date-icon" });

    const dateLabelEl = header.createSpan({
      text: this.date.format("dddd, D MMMM"),
      cls: "date-label",
    });

    // Input area
    const inputArea = contentEl.createDiv({ cls: "quick-add-input-area" });

    const input = inputArea.createEl("input", {
      type: "text",
      placeholder: tRaw("tasks.quickAdd.placeholder"),
    });

    // Preview line
    const preview = inputArea.createDiv({ cls: "quick-add-preview" });

    // Bottom bar with hints and shortcuts
    const bottomBar = contentEl.createDiv({ cls: "quick-add-bottom" });

    // Hints (left side)
    const hints = bottomBar.createDiv({ cls: "quick-add-hints" });

    const hint1 = hints.createSpan();
    hint1.createEl("kbd", { text: "14:00" });
    hint1.createSpan({ text: ` ${tRaw("tasks.quickAdd.hintTime")}` });

    const hint2 = hints.createSpan();
    hint2.createEl("kbd", { text: "14-15" });
    hint2.createSpan({ text: ` ${tRaw("tasks.quickAdd.hintRange")}` });

    const hint3 = hints.createSpan();
    hint3.createEl("kbd", { text: "!" });
    hint3.createSpan({ text: ` ${tRaw("tasks.quickAdd.hintPriority")}` });

    const hint4 = hints.createSpan();
    hint4.createEl("kbd", { text: "завтра" });
    hint4.createSpan({ text: ` ${tRaw("tasks.quickAdd.hintDate")}` });

    // Shortcuts (right side)
    const shortcuts = bottomBar.createDiv({ cls: "quick-add-shortcuts" });

    const sc1 = shortcuts.createSpan();
    sc1.createEl("kbd", { text: "Enter" });
    sc1.createSpan({ text: ` ${tRaw("common.save")}` });

    // Advanced button
    const advBtn = shortcuts.createEl("button", { cls: "qa-adv-btn", text: "⋯" });
    advBtn.title = tRaw("tasks.modal.extra");
    advBtn.addEventListener("click", () => {
      this.openAdvancedModal(input.value);
    });

    // Live preview with color highlighting using segments
    input.addEventListener("input", () => {
      const raw = input.value;
      const parsed = parseQuickInput(raw);
      if (!raw.trim()) {
        preview.addClass("mcp-hidden");
        dateLabelEl.textContent = this.date.format("dddd, D MMMM");
        return;
      }
      preview.removeClass("mcp-hidden");
      preview.innerHTML = "";

      // Update header date if parsed
      if (parsed.date) {
        dateLabelEl.textContent = parsed.date.format("dddd, D MMMM");
      } else {
        dateLabelEl.textContent = this.date.format("dddd, D MMMM");
      }

      // Render segments with colors
      for (const seg of parsed.segments) {
        if (!seg.text) continue;
        const cls = seg.type === "priority" ? "qa-hl qa-hl-priority"
          : seg.type === "date" ? "qa-hl qa-hl-date"
          : seg.type === "time" ? "qa-hl qa-hl-time"
          : "qa-title";
        const s = preview.createEl("span", { cls });
        s.textContent = seg.text;
      }
    });

    // Enter → quick create
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit(input.value);
      } else if (e.key === "Escape") {
        this.close();
      }
    });

    input.focus();
    window.requestAnimationFrame(() => input.focus());
  }

  private submit(raw: string): void {
    const parsed = parseQuickInput(raw);
    if (!parsed.title) { this.close(); return; }

    const targetDate = parsed.date || this.date;
    const dateUID = getDateUID(targetDate, "day");

    let scheduledTime: string | undefined;
    let endTime: string | undefined;
    if (parsed.scheduledTime) scheduledTime = formatTime(parsed.scheduledTime);
    if (parsed.endTime) endTime = formatTime(parsed.endTime);

    try {
      addTask({
        title: parsed.title,
        dateUID,
        status: "todo",
        completed: false,
        projectId: null,
        notePath: null,
        priority: parsed.priority || "medium",
        tags: [],
        sortOrder: 0,
        description: "",
        scheduledTime,
        endTime,
      });

      this.close();
      this.onSubmit();
    } catch (e: unknown) {
      console.error("[QuickAddModal] Failed to create task:", e);
    }
  }

  private openAdvancedModal(raw: string): void {
    const parsed = parseQuickInput(raw);
    const targetDate = parsed.date || this.date;
    const dateUID = getDateUID(targetDate, "day");
    const dateStr = targetDate.format("YYYY-MM-DD");

    let scheduledTime: string | undefined;
    let endTime: string | undefined;
    if (parsed.scheduledTime) scheduledTime = formatTime(parsed.scheduledTime);
    if (parsed.endTime) endTime = formatTime(parsed.endTime);

    this.close();

    void import("./TaskModal").then(({ TaskModal }) => {
      new TaskModal(this.app, (taskData) => {
        addTask({
          title: taskData.title || parsed.title || "",
          description: taskData.description || "",
          projectId: taskData.projectId || null,
          notePath: taskData.notePath || null,
          boundNotePath: taskData.boundNotePath || null,
          dateUID: taskData.dateUID || dateUID,
          priority: taskData.priority || parsed.priority || "medium",
          tags: taskData.tags || [],
          sortOrder: 0,
          status: "todo",
          completed: false,
          scheduledTime: taskData.scheduledTime || scheduledTime,
          endTime: taskData.endTime || endTime,
          estimatedTime: taskData.estimatedTime,
          deadline: taskData.deadline,
          deadlineTime: taskData.deadlineTime,
          recurrence: taskData.recurrence,
          isWorkTask: taskData.isWorkTask,
          paymentType: taskData.paymentType,
          rate: taskData.rate,
          overtimeStart: taskData.overtimeStart,
          overtimeMultiplier: taskData.overtimeMultiplier,
        });
      }, undefined, dateStr, scheduledTime, endTime).open();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
