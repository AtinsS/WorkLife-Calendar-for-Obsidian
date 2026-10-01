import { App, Modal } from "obsidian";
import type { Moment } from "moment";
import { getDateUID } from "obsidian-daily-notes-interface";
import { get } from "svelte/store";
import { tRaw, locale } from "../i18n";
import { addTask, projects } from "./stores";
import { sanitizeTitle } from "../utils/sanitize";
import {
  isAiQuickAddAvailable,
  parseQuickTasksWithAI,
  resolveNotePath,
  type AiQuickTaskDraft,
} from "../services/aiQuickAdd";
import type { RecurrenceConfig } from "./types";

const wm = window.moment as (inp?: unknown, format?: string, strict?: boolean) => Moment;

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
  type: "priority" | "date" | "time" | "project" | "title";
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
  projectName: string | null;
  segments: ParsedSegment[];
}

export function parseQuickInput(raw: string): ParsedResult {
  const text = raw.trim();
  const loc = get(locale) === "en" ? "en" : "ru";
  const now = wm();
  const found: ParsedSegment[] = [];
  let scheduledTime: string | null = null;
  let endTime: string | null = null;
  let priority: "low" | "medium" | "high" | null = null;
  let date: Moment | null = null;
  let dateLabel: string | null = null;
  let projectName: string | null = null;

  // --- 1. Find priority at start ---
  const prioRe = /^(!{1,2}|~|-)\s*/;
  const prioM = prioRe.exec(text);
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
      const target = wm({ year: now.year(), month: month - 1, day });
      if (target.isBefore(now, "day")) target.add(1, "year");
      return { date: target, label: m[0].trim() };
    }},
    // DD месяц (e.g. "25 июля")
    { re: new RegExp(`(?:^|\\s)(\\d{1,2})\\s+(${Object.keys(monthMap).join("|")})(?:\\s|$)`, "gi"), resolve: (m) => {
      const day = parseInt(m[1]);
      const monthNum = monthMap[m[2].toLowerCase()];
      if (day < 1 || day > 31 || monthNum === undefined) return null;
      const target = wm({ year: now.year(), month: monthNum - 1, day });
      if (target.isBefore(now, "day")) target.add(1, "year");
      return { date: target, label: m[0].trim() };
    }},
    // YYYY-MM-DD
    { re: /(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?:\s|$)/g, resolve: (m) => {
      const target = wm(`${m[1]}-${m[2]}-${m[3]}`, "YYYY-MM-DD", true);
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

  // --- 3.5. Find @Project token ---
  // Single word after @ — prefix matching handles multi-word project names
  const projRe = /(?:^|\s)@(\S+)/g;
  const projM = projRe.exec(text);
  if (projM) {
    projectName = projM[1].trim();
    const start = projM.index + (projM[0].length - projM[1].length - 1);
    found.push({ type: "project", text: projM[0].trim(), start, end: projM.index + projM[0].length });
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

  return { title, scheduledTime, endTime, priority, date, dateLabel, projectName, segments };
}

function resolveProjectId(projectName: string | null): string | null {
  if (!projectName) return null;
  const allProjects = get(projects);
  const search = projectName.toLowerCase();
  const match = allProjects.find((p) => p.name.toLowerCase() === search)
    || allProjects.find((p) => p.name.toLowerCase().startsWith(search));
  return match ? match.id : null;
}

function priorityLabel(prio: "low" | "medium" | "high"): string {
  if (prio === "high") return tRaw("tasks.modal.priorityHigh");
  if (prio === "low") return tRaw("tasks.modal.priorityLow");
  return tRaw("tasks.modal.priorityMedium");
}

function priorityGlyph(prio: "low" | "medium" | "high"): string {
  return prio === "high" ? "!!" : prio === "low" ? "−" : "~";
}

function formatTime(time: string): string {
  const [h, m] = time.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

/** Split free text into task lines (newlines, bullets, numbered lists, ";"). */
function splitTaskLines(raw: string): string[] {
  return raw
    .split(/\n+|;| \+ /)
    .map((l) => l.replace(/^\s*[-*•]\s+/, "").replace(/^\s*\d+[.)]\s+/, "").trim())
    .filter((l) => l && !l.startsWith("{") && !l.startsWith("```"));
}

type Mode = "single" | "multi";

export class QuickAddModal extends Modal {
  private date: Moment;
  private onSubmit: () => void;
  private inputEl!: HTMLInputElement | HTMLTextAreaElement;
  private dateLabelEl!: HTMLElement;
  private statusEl: HTMLElement | null = null;
  private mode: Mode = "single";
  private multiAvailable = false;
  private aiBusy = false;
  private projectSuggestEl: HTMLElement | null = null;
  private projectMatches: Array<{ id: string; name: string }> = [];
  private projectSuggestIndex = 0;
  private modeButtons: Record<Mode, HTMLButtonElement | null> = { single: null, multi: null };
  private syntaxEl: HTMLElement | null = null;
  private chipsEl: HTMLElement | null = null;
  private titlePreviewEl: HTMLElement | null = null;
  private parseEl: HTMLElement | null = null;

  constructor(app: App, date: Moment, onSubmit?: () => void) {
    super(app);
    this.date = date;
    this.onSubmit = onSubmit ?? (() => { /* noop */ });
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("quick-add-shell");
    contentEl.addClass("qa2");

    // ── Header ──
    const header = contentEl.createDiv({ cls: "qa2-top" });

    const iconWrap = header.createDiv({ cls: "qa2-icon" });
    iconWrap.createSpan({ text: "⚡", cls: "qa2-icon-glyph" });

    const topText = header.createDiv({ cls: "qa2-top-text" });
    topText.createDiv({ text: tRaw("tasks.quickAdd.title"), cls: "qa2-top-title" });

    const dateChip = header.createDiv({ cls: "qa2-date-chip" });
    dateChip.createSpan({ text: "📅", cls: "qa2-date-chip-icon" });
    this.dateLabelEl = dateChip.createSpan({
      text: this.date.format("dddd, D MMMM"),
      cls: "date-label",
    });

    // ── Mode switch — only when smart quick-add (AI) is available ──
    // Without AI (settings off / mobile) the modal is single-task only.
    // Default is always single-task; multi is opt-in.
    this.multiAvailable = isAiQuickAddAvailable();
    this.mode = "single";

    if (this.multiAvailable) {
      const modeBar = contentEl.createDiv({ cls: "qa2-modes" });
      const modeTabs = modeBar.createDiv({ cls: "qa2-modes-tabs", attr: { role: "tablist" } });
      const singleBtn = modeTabs.createEl("button", {
        cls: "qa2-mode is-active",
        text: tRaw("tasks.quickAdd.modeSingle"),
        attr: { type: "button", role: "tab" },
      });
      const multiBtn = modeTabs.createEl("button", {
        cls: "qa2-mode",
        attr: { type: "button", role: "tab" },
      });
      multiBtn.createSpan({ text: tRaw("tasks.quickAdd.modeMulti") });
      this.modeButtons = { single: singleBtn, multi: multiBtn };
      singleBtn.addEventListener("click", () => this.setMode("single"));
      multiBtn.addEventListener("click", () => this.setMode("multi"));
    }

    // ── Command input (always starts as single-task) ──
    const inputWrap = contentEl.createDiv({ cls: "qa2-input-wrap" });
    inputWrap.createSpan({ text: "›", cls: "qa2-caret" });
    this.inputEl = inputWrap.createEl("input", {
      type: "text",
      cls: "qa2-input",
      placeholder: tRaw("tasks.quickAdd.placeholder"),
      attr: { spellcheck: "false", autocomplete: "off" },
    });
    this.projectSuggestEl = inputWrap.createDiv({ cls: "qa2-proj-suggest mcp-hidden" });

    // ── Live visual parse (single mode only) ──
    this.parseEl = contentEl.createDiv({ cls: "qa2-parse mcp-hidden" });
    this.chipsEl = this.parseEl.createDiv({ cls: "qa2-chips mcp-hidden" });
    this.titlePreviewEl = this.parseEl.createDiv({ cls: "qa2-title-preview mcp-hidden" });

    this.statusEl = contentEl.createDiv({ cls: "qa2-status mcp-hidden" });

    // ── Syntax help (collapsible; hidden in multi mode) ──
    this.syntaxEl = contentEl.createDiv({ cls: "qa2-syntax" });
    const syntaxToggle = this.syntaxEl.createEl("button", {
      cls: "qa2-syntax-toggle",
      text: tRaw("tasks.quickAdd.syntax"),
      attr: { type: "button" },
    });
    const syntaxBody = this.syntaxEl.createDiv({ cls: "qa2-syntax-body mcp-hidden" });

    const hintRow = syntaxBody.createDiv({ cls: "qa2-hints" });
    this.addHint(hintRow, "14:00", tRaw("tasks.quickAdd.hintTime"));
    this.addHint(hintRow, "14-15", tRaw("tasks.quickAdd.hintRange"));
    this.addHint(hintRow, "!", tRaw("tasks.quickAdd.hintPriority"));
    this.addHint(hintRow, get(locale) === "en" ? "tomorrow" : "завтра", tRaw("tasks.quickAdd.hintDate"));
    this.addHint(hintRow, "@Work", tRaw("tasks.quickAdd.hintProject"));

    const exampleLine = syntaxBody.createDiv({ cls: "qa2-example" });
    exampleLine.createSpan({ text: tRaw("tasks.quickAdd.hints") });
    exampleLine.createEl("code", {
      text: `@Work ${tRaw("tasks.quickAdd.hintExamplePriority")} ${tRaw("tasks.quickAdd.hintExampleTime")}`,
    });

    syntaxToggle.addEventListener("click", () => {
      const hidden = syntaxBody.classList.contains("mcp-hidden");
      syntaxBody.toggleClass("mcp-hidden", !hidden);
      syntaxToggle.toggleClass("open", hidden);
    });

    // ── Actions ──
    const actions = contentEl.createDiv({ cls: "qa2-actions" });

    const kbdHint = actions.createDiv({ cls: "qa2-kbd" });
    kbdHint.createEl("kbd", { text: "Enter" });
    kbdHint.createSpan({ text: ` ${tRaw("tasks.quickAdd.add")}` });

    const manualBtn = actions.createEl("button", {
      cls: "qa2-btn qa2-btn-ghost",
      text: tRaw("tasks.quickAdd.manual"),
      attr: { type: "button" },
    });
    manualBtn.addEventListener("click", () => {
      this.openAdvancedModal(this.inputValue());
    });

    const addBtn = actions.createEl("button", {
      cls: "qa2-btn qa2-btn-primary",
      text: tRaw("tasks.quickAdd.add"),
      attr: { type: "button" },
    });
    addBtn.addEventListener("click", () => {
      void this.submit();
    });

    // ── Events ──
    this.bindInputEvents();
    this.modalEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });

    this.inputEl.focus();
    window.requestAnimationFrame(() => this.inputEl.focus());
  }

  private setMode(mode: Mode): void {
    if (!this.multiAvailable && mode === "multi") return;
    if (this.mode === mode) return;
    this.mode = mode;
    this.modeButtons.single?.toggleClass("is-active", mode === "single");
    this.modeButtons.multi?.toggleClass("is-active", mode === "multi");
    // Hints are for single-task syntax only
    this.syntaxEl?.toggleClass("mcp-hidden", mode === "multi");
    this.parseEl?.toggleClass("mcp-hidden", mode !== "single");
    this.swapInputMode();
    if (mode === "single") this.updateVisualParse(this.inputValue());
  }

  private bindInputEvents(): void {
    this.inputEl.addEventListener("input", () => {
      const raw = this.inputValue();
      if (this.mode === "single") {
        this.updateProjectSuggest(raw);
        this.updateVisualParse(raw);
      }
    });

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (this.mode === "single" && this.projectSuggestEl && !this.projectSuggestEl.classList.contains("mcp-hidden")) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          this.moveProjectSuggest(1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          this.moveProjectSuggest(-1);
          return;
        }
        if (e.key === "Tab") {
          const picked = this.projectMatches[this.projectSuggestIndex];
          if (picked) {
            e.preventDefault();
            this.acceptProjectSuggest(picked.name);
            return;
          }
        }
      }

      if (e.key === "Enter") {
        // Multi-line: Enter = newline, Ctrl/Cmd/Shift+Enter = submit
        if (this.mode === "multi" && !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
        e.preventDefault();
        if (this.mode === "single" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
          this.openAdvancedModal(this.inputValue());
        } else {
          void this.submit();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
  }

  private inputValue(): string {
    return this.inputEl.value;
  }

  private swapInputMode(): void {
    const current = this.inputValue();
    const inputWrap = this.inputEl.parentElement;
    if (!inputWrap) return;

    const caret = inputWrap.querySelector(".qa2-caret");
    const suggest = this.projectSuggestEl;
    this.inputEl.remove();
    if (suggest) suggest.remove();

    if (this.mode === "multi") {
      inputWrap.addClass("qa2-input-wrap--multi");
      this.inputEl = inputWrap.createEl("textarea", {
        cls: "qa2-textarea",
        placeholder: tRaw("tasks.quickAdd.multiPlaceholder"),
        attr: { spellcheck: "false", rows: "4" },
      });
    } else {
      inputWrap.removeClass("qa2-input-wrap--multi");
      this.inputEl = inputWrap.createEl("input", {
        type: "text",
        cls: "qa2-input",
        placeholder: tRaw("tasks.quickAdd.placeholder"),
        attr: { spellcheck: "false", autocomplete: "off" },
      });
    }

    this.projectSuggestEl = inputWrap.createDiv({ cls: "qa2-proj-suggest mcp-hidden" });
    if (caret && inputWrap.firstChild !== caret) {
      inputWrap.insertBefore(caret, inputWrap.firstChild);
    }

    this.inputEl.value = current;
    this.bindInputEvents();
    this.inputEl.focus();
  }

  private setStatus(text: string, kind: "busy" | "error" | "ok" | "hide"): void {
    if (!this.statusEl) return;
    if (kind === "hide") {
      this.statusEl.addClass("mcp-hidden");
      this.statusEl.empty();
      this.setAiThinking(false);
      return;
    }
    this.statusEl.removeClass("mcp-hidden", "is-busy", "is-error");
    if (kind === "busy") {
      this.statusEl.addClass("is-busy");
      this.setAiThinking(true);
    } else {
      this.setAiThinking(false);
    }
    if (kind === "error") this.statusEl.addClass("is-error");
    this.statusEl.empty();
    if (kind === "busy") this.statusEl.createSpan({ cls: "qa2-ai-spinner" });
    this.statusEl.createSpan({ text });
  }

  /** Spinner prefix on the multi tab + thinking state while AI parses (multi mode). */
  private setAiThinking(on: boolean): void {
    const multiBtn = this.modeButtons.multi;
    if (!multiBtn) return;
    const active = on && this.mode === "multi";
    multiBtn.toggleClass("is-thinking", active);
    multiBtn.empty();
    if (active) multiBtn.createSpan({ cls: "qa2-ai-spinner" });
    multiBtn.createSpan({ text: tRaw("tasks.quickAdd.modeMulti") });
  }

  /** Live visual parse chips + title preview (single mode). */
  private updateVisualParse(raw: string): void {
    const parseEl = this.parseEl;
    const chipsEl = this.chipsEl;
    const titleEl = this.titlePreviewEl;
    if (!parseEl || !chipsEl || !titleEl) return;
    if (this.mode !== "single" || !raw.trim()) {
      parseEl.addClass("mcp-hidden");
      chipsEl.addClass("mcp-hidden");
      titleEl.addClass("mcp-hidden");
      chipsEl.empty();
      titleEl.empty();
      return;
    }

    const parsed = parseQuickInput(raw);
    parseEl.removeClass("mcp-hidden");

    // Chips for recognized tokens
    const chips: Array<{ cls: string; text: string }> = [];
    if (parsed.priority) {
      chips.push({ cls: "qa2-chip-priority", text: `${priorityGlyph(parsed.priority)} ${priorityLabel(parsed.priority)}` });
    }
    if (parsed.dateLabel) {
      chips.push({ cls: "qa2-chip-date", text: `📅 ${parsed.dateLabel}` });
    }
    if (parsed.scheduledTime) {
      const range = parsed.endTime
        ? `${formatTime(parsed.scheduledTime)}–${formatTime(parsed.endTime)}`
        : formatTime(parsed.scheduledTime);
      chips.push({ cls: "qa2-chip-time", text: `🕐 ${range}` });
    }
    if (parsed.projectName) {
      chips.push({ cls: "qa2-chip-project", text: `@${parsed.projectName}` });
    }

    chipsEl.empty();
    if (chips.length === 0) {
      chipsEl.addClass("mcp-hidden");
    } else {
      chipsEl.removeClass("mcp-hidden");
      for (const chip of chips) {
        chipsEl.createSpan({ cls: `qa2-chip ${chip.cls}`, text: chip.text });
      }
    }

    titleEl.empty();
    if (parsed.title) {
      titleEl.removeClass("mcp-hidden");
      titleEl.createSpan({ cls: "qa2-title-label", text: `${tRaw("tasks.quickAdd.previewTitle")}: ` });
      titleEl.createSpan({ cls: "qa2-title-text", text: parsed.title });
    } else {
      titleEl.addClass("mcp-hidden");
    }
  }

  private addHint(parent: HTMLElement, kbd: string, label: string): void {
    const hint = parent.createSpan({ cls: "qa2-hint" });
    hint.createEl("kbd", { text: kbd });
    hint.createSpan({ text: ` ${label}` });
  }

  private updateProjectSuggest(raw: string): void {
    const el = this.projectSuggestEl;
    if (!el) return;

    // Only suggest while typing `@word` at the end of input
    const m = /(?:^|\s)@(\S*)$/.exec(raw);
    if (!m) {
      el.addClass("mcp-hidden");
      el.empty();
      this.projectMatches = [];
      return;
    }

    const query = m[1].toLowerCase();
    const all = get(projects);
    const matches = all
      .filter((p) => !query || p.name.toLowerCase().startsWith(query) || p.name.toLowerCase().includes(query))
      .slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name }));

    this.projectMatches = matches;
    this.projectSuggestIndex = 0;
    el.empty();

    if (matches.length === 0) {
      el.addClass("mcp-hidden");
      return;
    }

    el.removeClass("mcp-hidden");
    matches.forEach((p, i) => {
      const row = el.createDiv({
        cls: `qa2-proj-row${i === 0 ? " is-active" : ""}`,
        attr: { role: "option" },
      });
      row.createSpan({ text: "@", cls: "qa2-proj-at" });
      row.createSpan({ text: p.name, cls: "qa2-proj-name" });
      row.addEventListener("mousedown", (e: MouseEvent) => {
        e.preventDefault();
        this.acceptProjectSuggest(p.name);
      });
    });
  }

  private moveProjectSuggest(delta: number): void {
    if (this.projectMatches.length === 0 || !this.projectSuggestEl) return;
    const n = this.projectMatches.length;
    this.projectSuggestIndex = (this.projectSuggestIndex + delta + n) % n;
    const rows = this.projectSuggestEl.querySelectorAll<HTMLElement>(".qa2-proj-row");
    rows.forEach((row, i) => row.toggleClass("is-active", i === this.projectSuggestIndex));
  }

  private acceptProjectSuggest(name: string): void {
    const el = this.inputEl;
    // Replace only from `@` to end so a leading space is preserved
    el.value = el.value.replace(/@(\S*)$/, `@${name.replace(/\s+/g, "")}`);
    el.focus();
    if (this.projectSuggestEl) {
      this.projectSuggestEl.addClass("mcp-hidden");
      this.projectSuggestEl.empty();
    }
    this.projectMatches = [];
  }

  private async submit(): Promise<void> {
    const raw = this.inputValue();
    if (!raw.trim()) {
      this.close();
      return;
    }

    // Multi only when smart add is on; otherwise (settings off / mobile) — one task.
    if (this.mode === "multi" && this.multiAvailable) {
      await this.submitMulti(raw);
      return;
    }

    // Regex fast path (always available) — single task only
    const parsed = parseQuickInput(raw);
    if (!parsed.title) {
      this.close();
      return;
    }

    // Optional AI enrichment for work / note / recurrence.
    // Skip the round-trip when the text has no hint of those smart fields.
    let draft: AiQuickTaskDraft | null = null;
    if (isAiQuickAddAvailable() && looksLikeSmartFields(raw)) {
      try {
        this.setStatus(tRaw("tasks.quickAdd.aiBusy"), "busy");
        const drafts = await parseQuickTasksWithAI(raw);
        draft = drafts[0] ?? null;
        this.setStatus("", "hide");
      } catch {
        this.setStatus("", "hide");
      }
    }

    this.createTaskFromParsed(parsed, draft);
    this.close();
    this.onSubmit();
  }

  private async submitMulti(raw: string): Promise<void> {
    if (this.aiBusy) return;
    this.aiBusy = true;

    if (isAiQuickAddAvailable()) {
      this.setStatus(tRaw("tasks.quickAdd.aiBusy"), "busy");
      try {
        const drafts = await parseQuickTasksWithAI(raw);
        if (drafts.length === 0) {
          this.createTasksFromLines(raw);
        } else {
          for (const draft of drafts) {
            this.createTaskFromDraft(draft);
          }
        }
        this.setStatus("", "hide");
        this.close();
        this.onSubmit();
      } catch (e: unknown) {
        console.error("[QuickAddModal] AI multi-add failed:", e);
        // Fall back to line-by-line regex so the user still gets tasks
        try {
          this.createTasksFromLines(raw);
          this.setStatus("", "hide");
          this.close();
          this.onSubmit();
        } catch {
          this.setStatus(tRaw("tasks.quickAdd.aiError"), "error");
        }
      } finally {
        this.aiBusy = false;
      }
      return;
    }

    // No AI: one task per line / bullet / ";"
    try {
      this.createTasksFromLines(raw);
      this.close();
      this.onSubmit();
    } catch (e: unknown) {
      console.error("[QuickAddModal] Multi-add failed:", e);
      this.setStatus(tRaw("tasks.quickAdd.aiError"), "error");
    } finally {
      this.aiBusy = false;
    }
  }

  private createTasksFromLines(raw: string): void {
    const lines = splitTaskLines(raw);
    if (lines.length === 0) {
      const parsed = parseQuickInput(raw);
      if (parsed.title) this.createTaskFromParsed(parsed, null);
      return;
    }
    for (const line of lines) {
      const parsed = parseQuickInput(line);
      if (parsed.title) this.createTaskFromParsed(parsed, null);
    }
  }

  private createTaskFromParsed(
    parsed: ReturnType<typeof parseQuickInput>,
    draft: AiQuickTaskDraft | null,
  ): void {
    const targetDate = parsed.date || this.date;
    const dateUID = getDateUID(targetDate, "day");

    let scheduledTime: string | undefined;
    let endTime: string | undefined;
    if (parsed.scheduledTime) scheduledTime = formatTime(parsed.scheduledTime);
    if (parsed.endTime) endTime = formatTime(parsed.endTime);

    const projectId = resolveProjectId(parsed.projectName);
    const boundNotePath = draft?.noteName ? resolveNotePath(this.app, draft.noteName) : null;
    const recurrence = draft?.recurrence ? normalizeRecurrence(draft.recurrence) : undefined;

    try {
      addTask({
        title: sanitizeTitle(parsed.title),
        dateUID,
        status: "todo",
        completed: false,
        projectId,
        notePath: null,
        boundNotePath,
        priority: parsed.priority || draft?.priority || "medium",
        tags: [],
        sortOrder: 0,
        description: draft?.description || "",
        scheduledTime,
        endTime,
        isWorkTask: draft?.isWorkTask || undefined,
        recurrence,
      });
    } catch (e: unknown) {
      console.error("[QuickAddModal] Failed to create task:", e);
    }
  }

  private createTaskFromDraft(draft: AiQuickTaskDraft): void {
    const title = sanitizeTitle(draft.title);
    if (!title) return;

    let targetDate = this.date;
    if (draft.date) {
      const m = wm(draft.date, "YYYY-MM-DD", true);
      if (m.isValid()) targetDate = m;
    }
    const dateUID = getDateUID(targetDate, "day");

    const projectId = resolveProjectId(draft.projectName ?? null);
    const boundNotePath = draft.noteName ? resolveNotePath(this.app, draft.noteName) : null;
    const recurrence = draft.recurrence ? normalizeRecurrence(draft.recurrence) : undefined;

    let scheduledTime: string | undefined;
    let endTime: string | undefined;
    if (draft.scheduledTime) scheduledTime = formatTime(draft.scheduledTime);
    if (draft.endTime) endTime = formatTime(draft.endTime);

    try {
      addTask({
        title,
        dateUID,
        status: "todo",
        completed: false,
        projectId,
        notePath: null,
        boundNotePath,
        priority: draft.priority || "medium",
        tags: [],
        sortOrder: 0,
        description: draft.description || "",
        scheduledTime,
        endTime,
        isWorkTask: draft.isWorkTask || undefined,
        recurrence,
      });
    } catch (e: unknown) {
      console.error("[QuickAddModal] Failed to create AI task:", e);
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

    const projectId = resolveProjectId(parsed.projectName);

    this.close();

    void import("./TaskModal").then(({ TaskModal }) => {
      new TaskModal(this.app, (taskData) => {
        addTask({
          title: sanitizeTitle(taskData.title || parsed.title || ""),
          description: taskData.description || "",
          projectId: taskData.projectId || projectId || null,
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

function normalizeRecurrence(
  rec: NonNullable<AiQuickTaskDraft["recurrence"]>,
): RecurrenceConfig {
  const type = rec.type === "daily" || rec.type === "monthly" ? rec.type : "weekly";
  const out: RecurrenceConfig = {
    type,
    interval: rec.interval && rec.interval > 0 ? rec.interval : 1,
  };
  if (type === "weekly" && Array.isArray(rec.daysOfWeek) && rec.daysOfWeek.length > 0) {
    out.daysOfWeek = rec.daysOfWeek.filter((d) => d >= 0 && d <= 6);
  }
  return out;
}

/** Cheap gate: only hit Ollama when the text may contain work / note / recurrence. */
function looksLikeSmartFields(raw: string): boolean {
  return /работ|созвон|встреч|отч[её]т|клиент|дедлайн|ТЗ|спринт|презент|смет|кажд|повтор|заметк|\[\[|note|meeting|report|client|deadline|every\s|daily|weekly|monthly|recur/i.test(
    raw,
  );
}
