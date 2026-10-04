import { App, Modal } from "obsidian";
import type { Moment } from "moment";
import { getDateUID } from "obsidian-daily-notes-interface";
import { get } from "svelte/store";
import { tRaw, locale } from "../i18n";
import { addTask, projects, setChecklistForTask, addChecklistItem } from "./stores";
import { settings } from "../ui/stores";
import type { ITask } from "./types";
import { sanitizeTitle } from "../utils/sanitize";
import {
  isAiQuickAddAvailable,
  parseQuickTasksWithAI,
  generateTaskDescription,
  resolveNotePath,
  type AiQuickAddContext,
  type AiQuickTaskDraft,
} from "../services/aiQuickAdd";
import type { RecurrenceConfig } from "./types";
import { FileSuggestModal } from "../modals/FileSuggestModal";
import { FolderSuggestModal } from "../modals/FolderSuggestModal";

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

export interface QuickAddPrefill {
  /** HH:MM from schedule selection / drag-create */
  scheduledTime?: string | null;
  endTime?: string | null;
  /** Called after each created task (note sync, analytics, …) */
  onTaskCreated?: (task: ITask) => void;
  /** Override AI on/off for this modal instance (defaults to settings) */
  aiEnabled?: boolean;
}

/** User-touched form fields — these win over regex/parse. */
interface ExtraForm {
  date: string | null; // YYYY-MM-DD
  scheduledTime: string | null;
  endTime: string | null;
  priority: "low" | "medium" | "high" | null;
  projectId: string | null;
  notePath: string | null;
  recurrenceType: "none" | "daily" | "weekly" | "monthly";
  recurrenceDays: number[];
  recurrenceUntil: string | null; // YYYY-MM-DD
  deadlineDate: string | null;
  isWorkTask: boolean;
  paymentType: "hour" | "day";
  rate: string;
  overtimeStart: string;
  overtimeMultiplier: string;
  dirty: {
    date: boolean;
    scheduledTime: boolean;
    endTime: boolean;
    priority: boolean;
    projectId: boolean;
    notePath: boolean;
    recurrence: boolean;
    deadline: boolean;
    isWorkTask: boolean;
    workPay: boolean;
  };
}

function emptyExtraForm(prefillTime?: string | null, prefillEnd?: string | null): ExtraForm {
  return {
    date: null,
    scheduledTime: prefillTime ?? null,
    endTime: prefillEnd ?? null,
    priority: null,
    projectId: null,
    notePath: null,
    recurrenceType: "none",
    recurrenceDays: [],
    recurrenceUntil: null,
    deadlineDate: null,
    isWorkTask: false,
    paymentType: "hour",
    rate: "",
    overtimeStart: "",
    overtimeMultiplier: "",
    dirty: {
      date: false,
      scheduledTime: !!prefillTime,
      endTime: !!prefillEnd,
      priority: false,
      projectId: false,
      notePath: false,
      recurrence: false,
      deadline: false,
      isWorkTask: false,
      workPay: false,
    },
  };
}

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
  private modeHintEl: HTMLElement | null = null;
  private primaryBtn: HTMLButtonElement | null = null;
  private kbdHintEl: HTMLElement | null = null;
  private reviewEl: HTMLElement | null = null;
  private parseAgainBtn: HTMLButtonElement | null = null;
  private syntaxEl: HTMLElement | null = null;
  private syntaxToggleEl: HTMLElement | null = null;
  private extraToggleEl: HTMLElement | null = null;
  private subtasksToggleEl: HTMLElement | null = null;
  private panelBarEl: HTMLElement | null = null;
  private chipsEl: HTMLElement | null = null;
  private titlePreviewEl: HTMLElement | null = null;
  private parseEl: HTMLElement | null = null;
  private modeBarEl: HTMLElement | null = null;
  private prefillTime: string | null;
  private prefillEndTime: string | null;
  private onTaskCreated: ((task: ITask) => void) | null;
  private descEl: HTMLTextAreaElement | null = null;
  private subtaskListEl: HTMLElement | null = null;
  private subtaskTitles: string[] = [""];
  private subtasksSyncCount: (() => void) | null = null;
  private extraBody: HTMLElement | null = null;
  private extra: ExtraForm;
  private extraCtrls: {
    date?: HTMLInputElement;
    start?: HTMLInputElement;
    end?: HTMLInputElement;
    project?: HTMLSelectElement;
    recType?: HTMLSelectElement;
    recDays?: HTMLElement;
    recUntil?: HTMLElement;
    recUntilInput?: HTMLInputElement;
    deadline?: HTMLInputElement;
    note?: HTMLInputElement;
    work?: HTMLInputElement;
    workSub?: HTMLElement;
    priorityBtns?: HTMLElement;
  } = {};

  constructor(app: App, date: Moment, onSubmit?: () => void, prefill: QuickAddPrefill = {}) {
    super(app);
    this.date = date;
    this.onSubmit = onSubmit ?? (() => { /* noop */ });
    this.prefillTime = prefill.scheduledTime ?? null;
    this.prefillEndTime = prefill.endTime ?? null;
    this.onTaskCreated = prefill.onTaskCreated ?? null;
    this.extra = emptyExtraForm(this.prefillTime, this.prefillEndTime);
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
    let dateLabel = this.date.format("dddd, D MMMM");
    if (this.prefillTime) {
      dateLabel += this.prefillEndTime
        ? ` · ${this.prefillTime}–${this.prefillEndTime}`
        : ` · ${this.prefillTime}`;
    }
    this.dateLabelEl = dateChip.createSpan({
      text: dateLabel,
      cls: "date-label",
    });

    // ── Mode switch — multi ("AI-задачи") only when Ollama is available ──
    this.modeBarEl = contentEl.createDiv({ cls: "qa2-modes" });
    this.renderModeTabs();

    // ── Command input (always starts as single-task) ──
    const inputWrap = contentEl.createDiv({ cls: "qa2-input-wrap" });
    inputWrap.createSpan({ text: ">", cls: "qa2-caret" });
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

    // ── Description (AI button lives inside the field) ──
    const descWrap = contentEl.createDiv({ cls: "qa2-desc" });
    descWrap.createEl("label", { text: tRaw("tasks.quickAdd.description"), cls: "qa2-desc-label" });
    const descBox = descWrap.createDiv({ cls: "qa2-desc-box" });
    this.descEl = descBox.createEl("textarea", {
      cls: "qa2-desc-input",
      placeholder: tRaw("tasks.quickAdd.descriptionPlaceholder"),
      attr: { rows: "2", spellcheck: "false" },
    });
    if (isAiQuickAddAvailable()) {
      const genBtn = descBox.createEl("button", {
        cls: "qa2-desc-ai-btn",
        text: "✨",
        attr: {
          type: "button",
          title: tRaw("tasks.quickAdd.descriptionAi"),
          "aria-label": tRaw("tasks.quickAdd.descriptionAi"),
        },
      });
      genBtn.addEventListener("click", () => {
        void this.fillDescriptionWithAI(genBtn);
      });
    }

    // ── Section toggles on one row: Subtasks · Syntax · Extra ──
    const panelBar = contentEl.createDiv({ cls: "qa2-panels-row" });
    this.panelBarEl = panelBar;

    // Subtasks
    const subToggle = panelBar.createEl("button", {
      cls: "qa2-subtasks-toggle",
      attr: { type: "button" },
    });
    this.subtasksToggleEl = subToggle;
    subToggle.createSpan({ text: tRaw("tasks.modal.subtasks"), cls: "qa2-subtasks-toggle-label" });
    const subToggleCount = subToggle.createSpan({ text: "", cls: "qa2-subtasks-count" });
    const subWrap = contentEl.createDiv({ cls: "qa2-subtasks" });
    this.subtaskListEl = subWrap.createDiv({ cls: "qa2-subtask-list mcp-hidden" });
    const subActions = subWrap.createDiv({ cls: "qa2-subtasks-actions mcp-hidden" });
    const addSubBtn = subActions.createEl("button", {
      cls: "qa2-subtask-add",
      text: `+ ${tRaw("tasks.modal.addSubtask")}`,
      attr: { type: "button" },
    });
    addSubBtn.addEventListener("click", () => {
      this.subtaskTitles.push("");
      this.renderSubtasks();
      const inputs = this.subtaskListEl?.querySelectorAll<HTMLInputElement>("input");
      inputs?.[inputs.length - 1]?.focus();
    });
    if (isAiQuickAddAvailable()) {
      const aiSplitBtn = subActions.createEl("button", {
        cls: "qa2-subtask-ai",
        text: `✨ ${tRaw("tasks.modal.splitAi")}`,
        attr: { type: "button" },
      });
      aiSplitBtn.addEventListener("click", () => {
        void this.fillSubtasksWithAI(aiSplitBtn);
      });
    }
    const syncSubCount = () => {
      const n = this.subtaskTitles.filter((t) => t.trim()).length;
      subToggleCount.textContent = n > 0 ? String(n) : "";
    };
    this.subtasksSyncCount = syncSubCount;
    subToggle.addEventListener("click", () => {
      const hidden = this.subtaskListEl?.classList.contains("mcp-hidden");
      this.subtaskListEl?.toggleClass("mcp-hidden", !hidden);
      subActions?.toggleClass("mcp-hidden", !hidden);
      subToggle.toggleClass("open", !!hidden);
    });
    this.renderSubtasks();

    // Syntax help (hidden in multi mode)
    this.syntaxEl = contentEl.createDiv({ cls: "qa2-syntax" });
    const syntaxToggle = panelBar.createEl("button", {
      cls: "qa2-syntax-toggle",
      text: tRaw("tasks.quickAdd.syntax"),
      attr: { type: "button" },
    });
    this.syntaxToggleEl = syntaxToggle;
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

    // Extra parameters
    const extraToggle = panelBar.createEl("button", {
      cls: "qa2-extra-toggle",
      text: tRaw("tasks.quickAdd.extra"),
      attr: { type: "button" },
    });
    this.extraToggleEl = extraToggle;
    const extraWrap = contentEl.createDiv({ cls: "qa2-extra" });
    this.extraBody = extraWrap.createDiv({ cls: "qa2-extra-body mcp-hidden" });
    extraToggle.addEventListener("click", () => {
      const hidden = this.extraBody?.classList.contains("mcp-hidden");
      this.extraBody?.toggleClass("mcp-hidden", !hidden);
      extraToggle.toggleClass("open", !!hidden);
    });
    this.buildExtraFields(this.extraBody);

    // ── Actions ──
    const actions = contentEl.createDiv({ cls: "qa2-actions" });

    const kbdHint = actions.createDiv({ cls: "qa2-kbd" });
    this.kbdHintEl = kbdHint;
    kbdHint.createEl("kbd", { text: "Enter" });
    kbdHint.createSpan({
      text: ` ${this.mode === "multi" ? tRaw("tasks.quickAdd.parseTasks") : tRaw("tasks.quickAdd.add")}`,
      cls: "qa2-kbd-label",
    });

    const addBtn = actions.createEl("button", {
      cls: "qa2-btn qa2-btn-primary",
      text: this.mode === "multi" ? tRaw("tasks.quickAdd.parseTasks") : tRaw("tasks.quickAdd.add"),
      attr: { type: "button" },
    });
    this.primaryBtn = addBtn;
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

  /** Mode switcher: Normal / AI (AI only when Ollama + flag are available). */
  private renderModeTabs(): void {
    const bar = this.modeBarEl;
    if (!bar) return;
    bar.empty();
    this.multiAvailable = isAiQuickAddAvailable();
    this.modeHintEl = null;
    if (!this.multiAvailable) {
      this.modeButtons = { single: null, multi: null };
      if (this.mode === "multi") this.setMode("single");
      bar.addClass("mcp-hidden");
      return;
    }
    bar.removeClass("mcp-hidden");
    const modeSwitch = bar.createDiv({
      cls: "qa2-modes-tabs",
      attr: { role: "radiogroup", "aria-label": tRaw("tasks.quickAdd.modeSingle") },
    });
    const singleBtn = modeSwitch.createEl("button", {
      cls: "qa2-mode" + (this.mode === "single" ? " is-active" : ""),
      text: tRaw("tasks.quickAdd.modeSingle"),
      attr: {
        type: "button",
        role: "radio",
        "aria-checked": this.mode === "single" ? "true" : "false",
      },
    });
    const multiBtn = modeSwitch.createEl("button", {
      cls: "qa2-mode" + (this.mode === "multi" ? " is-active" : ""),
      text: tRaw("tasks.quickAdd.modeMulti"),
      attr: {
        type: "button",
        role: "radio",
        "aria-checked": this.mode === "multi" ? "true" : "false",
      },
    });
    this.modeButtons = { single: singleBtn, multi: multiBtn };
    this.modeHintEl = bar.createDiv({
      cls: "qa2-modes-hint" + (this.mode === "multi" ? "" : " mcp-hidden"),
      text: tRaw("tasks.quickAdd.modeAiHint"),
    });
    singleBtn.addEventListener("click", () => this.setMode("single"));
    multiBtn.addEventListener("click", () => this.setMode("multi"));
  }

  private setMode(mode: Mode): void {
    if (!this.multiAvailable && mode === "multi") return;
    if (this.mode === mode) return;
    // Block switching while the AI review panel is open
    if (this.reviewEl) return;
    this.mode = mode;
    this.modeButtons.single?.toggleClass("is-active", mode === "single");
    this.modeButtons.multi?.toggleClass("is-active", mode === "multi");
    this.modeButtons.single?.setAttribute("aria-checked", mode === "single" ? "true" : "false");
    this.modeButtons.multi?.setAttribute("aria-checked", mode === "multi" ? "true" : "false");
    this.modeHintEl?.toggleClass("mcp-hidden", mode !== "multi");
    if (this.primaryBtn) {
      const label = mode === "multi" ? tRaw("tasks.quickAdd.parseTasks") : tRaw("tasks.quickAdd.add");
      this.primaryBtn.setText(label);
      this.kbdHintEl?.querySelector(".qa2-kbd-label")?.setText(` ${label}`);
    }
    // Multi ("AI-задачи"): only the prompt input — hide all section toggles/panels
    this.panelBarEl?.toggleClass("mcp-hidden", mode === "multi");
    this.syntaxEl?.toggleClass("mcp-hidden", mode === "multi");
    this.syntaxToggleEl?.toggleClass("mcp-hidden", mode === "multi");
    this.extraToggleEl?.toggleClass("mcp-hidden", mode === "multi");
    this.subtasksToggleEl?.toggleClass("mcp-hidden", mode === "multi");
    this.parseEl?.toggleClass("mcp-hidden", mode !== "single");
    this.extraBody?.parentElement?.toggleClass("mcp-hidden", mode === "multi");
    this.descEl?.closest(".qa2-desc")?.toggleClass("mcp-hidden", mode === "multi");
    this.subtaskListEl?.closest(".qa2-subtasks")?.toggleClass("mcp-hidden", mode === "multi");
    if (mode === "multi") {
      // Collapse any open panels so they don't linger visually
      this.extraBody?.addClass("mcp-hidden");
      this.extraToggleEl?.removeClass("open");
      this.subtaskListEl?.addClass("mcp-hidden");
      this.subtasksToggleEl?.removeClass("open");
    }
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
          // Modifier+Enter opens extra parameters instead of submitting
          const toggle = this.contentEl.querySelector<HTMLElement>(".qa2-extra-toggle");
          if (this.extraBody?.classList.contains("mcp-hidden")) toggle?.click();
          this.extraBody?.querySelector<HTMLElement>("input, select")?.focus();
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

  private renderSubtasks(): void {
    const list = this.subtaskListEl;
    if (!list) return;
    list.empty();
    this.subtaskTitles.forEach((title, i) => {
      const row = list.createDiv({ cls: "qa2-subtask-row" });
      const input = row.createEl("input", {
        type: "text",
        cls: "qa2-extra-input qa2-subtask-input",
        value: title,
        placeholder: tRaw("tasks.modal.subtaskPlaceholder"),
        attr: { spellcheck: "false", autocomplete: "off" },
      });
      input.addEventListener("input", () => {
        this.subtaskTitles[i] = input.value;
      });
      input.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.subtaskTitles.push("");
          this.renderSubtasks();
          const inputs = this.subtaskListEl?.querySelectorAll<HTMLInputElement>("input");
          inputs?.[inputs.length - 1]?.focus();
        } else if (e.key === "Backspace" && !input.value && this.subtaskTitles.length > 0) {
          e.preventDefault();
          this.subtaskTitles.splice(i, 1);
          this.renderSubtasks();
          const inputs = this.subtaskListEl?.querySelectorAll<HTMLInputElement>("input");
          inputs?.[Math.max(0, i - 1)]?.focus();
        }
      });
      const removeBtn = row.createEl("button", {
        cls: "qa2-subtask-remove",
        text: "✕",
        attr: { type: "button", "aria-label": "Remove" },
      });
      removeBtn.addEventListener("click", () => {
        this.subtaskTitles.splice(i, 1);
        this.renderSubtasks();
      });
    });
    this.subtasksSyncCount?.();
  }

  /** Subtask titles filled in the create form (empty lines dropped). */
  private collectSubtasks(): string[] {
    return this.subtaskTitles.map((t) => t.trim()).filter(Boolean);
  }

  /** Fill the subtask list via Ollama ("Разбить на подзадачи (ИИ)"). */
  private async fillSubtasksWithAI(btn: HTMLElement): Promise<void> {
    const parsed = parseQuickInput(this.inputValue());
    const title = parsed.title || this.inputValue().trim();
    if (!title) {
      this.setStatus(tRaw("tasks.quickAdd.aiError"), "error");
      return;
    }
    btn.setAttribute("disabled", "true");
    btn.addClass("is-busy");
    try {
      const { generateSubtasks } = await import("../services/OllamaService");
      const { settings } = await import("../ui/stores");
      const opts = get(settings) as { ollamaUrl?: string; ollamaModel?: string };
      const titles = await generateSubtasks(
        opts.ollamaUrl || "http://localhost:11434",
        opts.ollamaModel || "llama3.1",
        title,
        this.descEl?.value || null,
        parsed.projectName || null,
      );
      if (titles.length) {
        this.subtaskTitles = titles.map((t) => t.trim()).filter(Boolean);
        this.renderSubtasks();
        this.subtasksSyncCount?.();
        this.setStatus("", "hide");
      } else {
        this.setStatus(tRaw("ai.subtasksEmpty"), "error");
      }
    } catch {
      this.setStatus(tRaw("tasks.quickAdd.aiError"), "error");
    } finally {
      btn.removeAttribute("disabled");
      btn.removeClass("is-busy");
    }
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

    this.syncFormFromParse(parsed);
  }

  /** Fill extra fields from regex parse unless the user already touched them. */
  private syncFormFromParse(parsed: ReturnType<typeof parseQuickInput>): void {
    const d = this.extra.dirty;
    if (!d.date && parsed.date) {
      this.extra.date = parsed.date.format("YYYY-MM-DD");
      if (this.extraCtrls.date) this.extraCtrls.date.value = this.extra.date;
    }
    if (!d.scheduledTime && parsed.scheduledTime) {
      this.extra.scheduledTime = formatTime(parsed.scheduledTime);
      if (this.extraCtrls.start) this.extraCtrls.start.value = this.extra.scheduledTime;
    }
    if (!d.endTime && parsed.endTime) {
      this.extra.endTime = formatTime(parsed.endTime);
      if (this.extraCtrls.end) this.extraCtrls.end.value = this.extra.endTime;
    }
    if (!d.priority && parsed.priority) {
      this.extra.priority = parsed.priority;
      this.highlightPriority(parsed.priority);
    }
    if (!d.projectId && parsed.projectName) {
      const id = resolveProjectId(parsed.projectName);
      this.extra.projectId = id;
      if (this.extraCtrls.project) this.extraCtrls.project.value = id ?? "";
    }
    if (!this.dateLabelEl) return;
    // Keep header chip in sync with the effective day
    const eff = this.extra.dirty.date && this.extra.date
      ? wm(this.extra.date, "YYYY-MM-DD", true)
      : parsed.date || this.date;
    let label = (eff.isValid() ? eff : this.date).format("dddd, D MMMM");
    const st = this.extra.scheduledTime;
    const en = this.extra.endTime;
    if (st) label += en ? ` · ${st}–${en}` : ` · ${st}`;
    this.dateLabelEl.setText(label);
  }

  private highlightPriority(p: "low" | "medium" | "high"): void {
    const row = this.extraCtrls.priorityBtns;
    if (!row) return;
    row.querySelectorAll<HTMLElement>(".qa2-pri-btn").forEach((b) => {
      b.toggleClass("is-active", b.dataset.pri === p);
    });
  }

  private buildExtraFields(body: HTMLElement): void {
    // Date + start + end
    const timeRow = body.createDiv({ cls: "qa2-extra-row" });
    const dateWrap = timeRow.createDiv({ cls: "qa2-extra-field" });
    dateWrap.createEl("label", { text: tRaw("tasks.modal.date"), cls: "qa2-extra-label" });
    const dateIn = dateWrap.createEl("input", {
      type: "date",
      cls: "qa2-extra-input",
      value: this.extra.date ?? this.date.format("YYYY-MM-DD"),
    });
    if (!this.extra.date) this.extra.date = this.date.format("YYYY-MM-DD");
    dateIn.addEventListener("change", () => {
      this.extra.date = dateIn.value || null;
      this.extra.dirty.date = true;
    });
    this.extraCtrls.date = dateIn;

    const startWrap = timeRow.createDiv({ cls: "qa2-extra-field" });
    startWrap.createEl("label", { text: tRaw("tasks.modal.time"), cls: "qa2-extra-label" });
    const startIn = startWrap.createEl("input", {
      type: "time",
      cls: "qa2-extra-input",
      value: this.extra.scheduledTime ?? "",
    });
    startIn.addEventListener("change", () => {
      this.extra.scheduledTime = startIn.value || null;
      this.extra.dirty.scheduledTime = true;
    });
    this.extraCtrls.start = startIn;

    const endWrap = timeRow.createDiv({ cls: "qa2-extra-field" });
    endWrap.createEl("label", { text: tRaw("tasks.modal.endTime"), cls: "qa2-extra-label" });
    const endIn = endWrap.createEl("input", {
      type: "time",
      cls: "qa2-extra-input",
      value: this.extra.endTime ?? "",
    });
    endIn.addEventListener("change", () => {
      this.extra.endTime = endIn.value || null;
      this.extra.dirty.endTime = true;
    });
    this.extraCtrls.end = endIn;

    // Priority
    const priRow = body.createDiv({ cls: "qa2-extra-row" });
    const priWrap = priRow.createDiv({ cls: "qa2-extra-field qa2-extra-field--full" });
    priWrap.createEl("label", { text: tRaw("tasks.modal.priority"), cls: "qa2-extra-label" });
    const priBtns = priWrap.createDiv({ cls: "qa2-pri-btns" });
    this.extraCtrls.priorityBtns = priBtns;
    const priDefs: Array<{ v: "low" | "medium" | "high"; l: string }> = [
      { v: "low", l: tRaw("tasks.modal.priorityLow") },
      { v: "medium", l: tRaw("tasks.modal.priorityMedium") },
      { v: "high", l: tRaw("tasks.modal.priorityHigh") },
    ];
    for (const p of priDefs) {
      const btn = priBtns.createEl("button", {
        cls: "qa2-pri-btn" + (this.extra.priority === p.v ? " is-active" : ""),
        text: p.l,
        attr: { type: "button" },
      });
      btn.dataset.pri = p.v;
      btn.addEventListener("click", () => {
        this.extra.priority = p.v;
        this.extra.dirty.priority = true;
        this.highlightPriority(p.v);
      });
    }

    // Project + work
    const projRow = body.createDiv({ cls: "qa2-extra-row" });
    const projWrap = projRow.createDiv({ cls: "qa2-extra-field" });
    projWrap.createEl("label", { text: tRaw("tasks.modal.project"), cls: "qa2-extra-label" });
    const projSel = projWrap.createEl("select", { cls: "qa2-extra-input" });
    projSel.createEl("option", { value: "", text: tRaw("tasks.modal.noProject") });
    for (const p of get(projects)) {
      const opt = projSel.createEl("option", { value: p.id, text: `${p.icon} ${p.name}` });
      if (p.id === this.extra.projectId) opt.selected = true;
    }
    projSel.addEventListener("change", () => {
      this.extra.projectId = projSel.value || null;
      this.extra.dirty.projectId = true;
    });
    this.extraCtrls.project = projSel;

    const workWrap = projRow.createDiv({ cls: "qa2-extra-field qa2-extra-work" });
    workWrap.createEl("label", {
      text: tRaw("tasks.modal.isWorkTask"),
      cls: "qa2-extra-label qa2-work-label",
    });
    // Obsidian native toggle (Setting-style checkbox-container)
    const workToggle = workWrap.createEl("label", {
      cls: "checkbox-container" + (this.extra.isWorkTask ? " is-enabled" : ""),
    });
    const workIn = workToggle.createEl("input", { type: "checkbox" });
    workIn.checked = this.extra.isWorkTask;
    workIn.addEventListener("change", () => {
      this.extra.isWorkTask = workIn.checked;
      this.extra.dirty.isWorkTask = true;
      workToggle.toggleClass("is-enabled", workIn.checked);
      this.updateWorkSub();
    });
    this.extraCtrls.work = workIn;

    // Work pay inputs (shown when work is on)
    const workSub = body.createDiv({ cls: "qa2-extra-work-sub mcp-hidden" });
    this.extraCtrls.workSub = workSub;

    const payRow = workSub.createDiv({ cls: "qa2-extra-row" });
    const payWrap = payRow.createDiv({ cls: "qa2-extra-field" });
    payWrap.createEl("label", { text: tRaw("tasks.modal.paymentType"), cls: "qa2-extra-label" });
    const paySel = payWrap.createEl("select", { cls: "qa2-extra-input" });
    paySel.createEl("option", { value: "hour", text: tRaw("tasks.modal.paymentHour") });
    paySel.createEl("option", { value: "day", text: tRaw("tasks.modal.paymentDay") });
    paySel.value = this.extra.paymentType;
    paySel.addEventListener("change", () => {
      this.extra.paymentType = paySel.value as "hour" | "day";
      this.extra.dirty.workPay = true;
      this.updateWorkSub();
    });

    const rateWrap = payRow.createDiv({ cls: "qa2-extra-field" });
    rateWrap.createEl("label", {
      text: tRaw("tasks.modal.rate", { currency: "₽" }),
      cls: "qa2-extra-label",
    });
    const rateIn = rateWrap.createEl("input", {
      type: "number",
      cls: "qa2-extra-input",
      placeholder: "0",
      value: this.extra.rate,
      attr: { min: "0" },
    });
    rateIn.addEventListener("input", () => {
      this.extra.rate = rateIn.value.replace(/[^0-9.,]/g, "");
      this.extra.dirty.workPay = true;
    });

    const otRow = workSub.createDiv({ cls: "qa2-extra-row qa2-extra-ot" });
    const otStartWrap = otRow.createDiv({ cls: "qa2-extra-field" });
    otStartWrap.createEl("label", { text: tRaw("tasks.modal.overtimeFrom"), cls: "qa2-extra-label" });
    const otStartIn = otStartWrap.createEl("input", {
      type: "number",
      cls: "qa2-extra-input",
      placeholder: "8",
      value: this.extra.overtimeStart,
      attr: { min: "1", max: "24" },
    });
    otStartIn.addEventListener("input", () => {
      this.extra.overtimeStart = otStartIn.value.replace(/[^0-9]/g, "");
      this.extra.dirty.workPay = true;
    });

    const otMulWrap = otRow.createDiv({ cls: "qa2-extra-field" });
    otMulWrap.createEl("label", { text: tRaw("tasks.modal.multiplier"), cls: "qa2-extra-label" });
    const otMulIn = otMulWrap.createEl("input", {
      type: "number",
      cls: "qa2-extra-input",
      placeholder: "1.5",
      value: this.extra.overtimeMultiplier,
      attr: { min: "1", max: "10", step: "0.1" },
    });
    otMulIn.addEventListener("input", () => {
      this.extra.overtimeMultiplier = otMulIn.value.replace(/[^0-9.,]/g, "");
      this.extra.dirty.workPay = true;
    });
    this.updateWorkSub();

    // Recurrence
    const recRow = body.createDiv({ cls: "qa2-extra-row" });
    const recWrap = recRow.createDiv({ cls: "qa2-extra-field" });
    recWrap.createEl("label", { text: tRaw("tasks.modal.recurrence"), cls: "qa2-extra-label" });
    const recSel = recWrap.createEl("select", { cls: "qa2-extra-input" });
    recSel.createEl("option", { value: "none", text: tRaw("tasks.modal.recurrenceNone") });
    recSel.createEl("option", { value: "daily", text: tRaw("tasks.modal.recurrenceDaily") });
    recSel.createEl("option", { value: "weekly", text: tRaw("tasks.modal.recurrenceWeekly") });
    recSel.createEl("option", { value: "monthly", text: tRaw("tasks.modal.recurrenceMonthly") });
    recSel.value = this.extra.recurrenceType;
    recSel.addEventListener("change", () => {
      this.extra.recurrenceType = recSel.value as ExtraForm["recurrenceType"];
      this.extra.dirty.recurrence = true;
      this.renderRecDays();
      this.updateRecUntil();
    });
    this.extraCtrls.recType = recSel;

    const recDays = recRow.createDiv({ cls: "qa2-extra-field qa2-rec-days mcp-hidden" });
    this.extraCtrls.recDays = recDays;
    this.renderRecDays();

    // Repeat until
    const recUntilWrap = body.createDiv({ cls: "qa2-extra-row qa2-rec-until mcp-hidden" });
    this.extraCtrls.recUntil = recUntilWrap;
    const untilField = recUntilWrap.createDiv({ cls: "qa2-extra-field" });
    untilField.createEl("label", { text: tRaw("tasks.modal.repeatUntil"), cls: "qa2-extra-label" });
    const untilIn = untilField.createEl("input", {
      type: "date",
      cls: "qa2-extra-input",
      value: this.extra.recurrenceUntil ?? "",
    });
    untilIn.addEventListener("change", () => {
      this.extra.recurrenceUntil = untilIn.value || null;
      this.extra.dirty.recurrence = true;
    });
    this.extraCtrls.recUntilInput = untilIn;
    this.updateRecUntil();

    // Deadline + note
    const dlRow = body.createDiv({ cls: "qa2-extra-row" });
    const dlWrap = dlRow.createDiv({ cls: "qa2-extra-field" });
    dlWrap.createEl("label", { text: tRaw("tasks.modal.deadline"), cls: "qa2-extra-label" });
    const dlIn = dlWrap.createEl("input", {
      type: "date",
      cls: "qa2-extra-input",
      value: this.extra.deadlineDate ?? "",
    });
    dlIn.addEventListener("change", () => {
      this.extra.deadlineDate = dlIn.value || null;
      this.extra.dirty.deadline = true;
    });
    this.extraCtrls.deadline = dlIn;

    // Note + browse/create buttons
    const noteWrap = dlRow.createDiv({ cls: "qa2-extra-field" });
    noteWrap.createEl("label", { text: tRaw("tasks.modal.linkNote"), cls: "qa2-extra-label" });
    const noteRow = noteWrap.createDiv({ cls: "qa2-note-row" });
    const noteIn = noteRow.createEl("input", {
      type: "text",
      cls: "qa2-extra-input qa2-note-input",
      placeholder: tRaw("tasks.modal.notePlaceholder"),
      value: this.extra.notePath ?? "",
    });
    noteIn.addEventListener("change", () => {
      this.extra.notePath = noteIn.value.trim() || null;
      this.extra.dirty.notePath = true;
    });
    this.extraCtrls.note = noteIn;

    const browseBtn = noteRow.createEl("button", {
      text: "…",
      cls: "qa2-note-btn",
      attr: { type: "button", title: tRaw("tasks.modal.linkNote") },
    });
    browseBtn.addEventListener("click", () => {
      new FileSuggestModal(this.app, (filePath) => {
        this.extra.notePath = filePath;
        this.extra.dirty.notePath = true;
        noteIn.value = filePath;
      }).open();
    });

    const createBtn = noteRow.createEl("button", {
      text: "+",
      cls: "qa2-note-btn",
      attr: { type: "button", title: tRaw("tasks.modal.createNote") },
    });
    createBtn.addEventListener("click", () => {
      new FolderSuggestModal(this.app, (folder) => {
        void (async () => {
          const title = (this.inputValue() || tRaw("tasks.modal.note")).trim();
          const filename = title.replace(/[\\/:*?"<>|]/g, "_") + ".md";
          const path = `${folder}/${filename}`;
          const parts = path.split("/");
          if (parts.length > 1) {
            const folderPath = parts.slice(0, -1).join("/");
            if (!this.app.vault.getAbstractFileByPath(folderPath)) {
              await this.app.vault.createFolder(folderPath);
            }
          }
          let file = this.app.vault.getAbstractFileByPath(path);
          if (!file) {
            file = await this.app.vault.create(path, "");
          }
          this.extra.notePath = path;
          this.extra.dirty.notePath = true;
          noteIn.value = path;
        })();
      }).open();
    });
  }

  private updateWorkSub(): void {
    const sub = this.extraCtrls.workSub;
    if (!sub) return;
    const show = this.extra.isWorkTask;
    sub.toggleClass("mcp-hidden", !show);
    const ot = sub.querySelector<HTMLElement>(".qa2-extra-ot");
    if (ot) ot.toggleClass("mcp-hidden", this.extra.paymentType !== "hour");
  }

  private updateRecUntil(): void {
    const wrap = this.extraCtrls.recUntil;
    if (!wrap) return;
    wrap.toggleClass("mcp-hidden", this.extra.recurrenceType === "none");
  }

  private renderRecDays(): void {
    const wrap = this.extraCtrls.recDays;
    if (!wrap) return;
    wrap.empty();
    if (this.extra.recurrenceType !== "weekly") {
      wrap.addClass("mcp-hidden");
      return;
    }
    wrap.removeClass("mcp-hidden");
    const labels = tRaw("common.weekdays.short").split(", ");
    for (let i = 0; i < 7; i++) {
      const momentIdx = i === 6 ? 0 : i + 1; // Mon=1 … Sun=0
      const btn = wrap.createEl("button", {
        cls: "qa2-day-btn" + (this.extra.recurrenceDays.includes(momentIdx) ? " is-active" : ""),
        text: labels[i] || String(i),
        attr: { type: "button" },
      });
      btn.addEventListener("click", () => {
        const idx = this.extra.recurrenceDays.indexOf(momentIdx);
        if (idx >= 0) this.extra.recurrenceDays.splice(idx, 1);
        else this.extra.recurrenceDays.push(momentIdx);
        this.extra.recurrenceDays.sort();
        this.extra.dirty.recurrence = true;
        btn.toggleClass("is-active", this.extra.recurrenceDays.includes(momentIdx));
      });
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
    // Review already open — confirm/cancel/reparse from the panel instead
    if (this.reviewEl) return;
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

    // Single mode is pure regex — AI runs only in multi ("AI-задачи").
    const parsed = parseQuickInput(raw);
    if (!parsed.title) {
      this.close();
      return;
    }

    this.createTaskFromParsed(parsed, null);
    this.close();
    this.onSubmit();
  }

  private async submitMulti(raw: string): Promise<void> {
    if (this.aiBusy) return;
    this.aiBusy = true;

    if (isAiQuickAddAvailable()) {
      this.setStatus(tRaw("tasks.quickAdd.aiBusy"), "busy");
      try {
        const drafts = await parseQuickTasksWithAI(raw, this.aiContext());
        this.setStatus("", "hide");
        if (drafts.length === 0) {
          this.createTasksFromLines(raw);
          this.close();
          this.onSubmit();
        } else if (this.confirmBeforeAdd()) {
          // Show how AI understood the tasks — user confirms first
          this.showReviewPanel(drafts);
        } else {
          for (const draft of drafts) {
            this.createTaskFromDraft(draft);
          }
          this.close();
          this.onSubmit();
        }
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

  private confirmBeforeAdd(): boolean {
    const opts = get(settings) as { aiConfirmBeforeAdd?: boolean };
    return opts.aiConfirmBeforeAdd !== false;
  }

  /** Preview panel: show how AI parsed each task, let the user approve. */
  private showReviewPanel(drafts: AiQuickTaskDraft[]): void {
    // Hide input area actions; show review card list
    this.closeReviewPanel();
    const root = this.contentEl.createDiv({ cls: "qa2-review" });
    this.reviewEl = root;
    this.setReviewLock(true);
    root.createDiv({ text: tRaw("tasks.quickAdd.reviewTitle"), cls: "qa2-review-title" });
    root.createDiv({ text: tRaw("tasks.quickAdd.reviewHint"), cls: "qa2-review-hint" });

    const list = root.createDiv({ cls: "qa2-review-list" });
    const selected: boolean[] = drafts.map(() => true);

    drafts.forEach((d, i) => {
      const card = list.createDiv({ cls: "qa2-review-card" });
      const head = card.createDiv({ cls: "qa2-review-card-head" });
      const check = head.createEl("input", {
        type: "checkbox",
        cls: "qa2-review-check",
        attr: { checked: "checked" },
      });
      check.checked = true;
      check.addEventListener("change", () => {
        selected[i] = check.checked;
        card.toggleClass("is-off", !check.checked);
        this.updateReviewCount(countBtn, selected);
      });

      const titleBox = head.createDiv({ cls: "qa2-review-card-title" });
      titleBox.createSpan({ text: d.title, cls: "qa2-review-task-title" });

      const meta = card.createDiv({ cls: "qa2-review-meta" });
      const chip = (cls: string, text: string) => {
        if (text) meta.createSpan({ cls: `qa2-chip ${cls}`, text });
      };
      if (d.date) chip("qa2-chip-date", `📅 ${d.date}`);
      if (d.scheduledTime) {
        chip("qa2-chip-time", `🕐 ${d.scheduledTime}${d.endTime ? `–${d.endTime}` : ""}`);
      }
      if (d.priority && d.priority !== "medium") {
        chip("qa2-chip-priority", d.priority === "high" ? "!! high" : "− low");
      }
      if (d.projectName) chip("qa2-chip-project", `@${d.projectName}`);
      if (d.isWorkTask) chip("qa2-chip-project", "work");
      if (d.recurrence) {
        chip("qa2-chip-date", `↻ ${d.recurrence.type}${d.recurrence.daysOfWeek?.length ? ` [${d.recurrence.daysOfWeek.join(",")}]` : ""}`);
      }
      if (d.deadline) chip("qa2-chip-date", `⏰ ${d.deadline}`);
      if (d.estimatedMinutes) chip("qa2-chip-time", `⏱ ${d.estimatedMinutes}m`);
      if (d.rate != null) {
        chip("qa2-chip-project", `💰 ${d.rate}${d.paymentType === "day" ? "/день" : "/час"}`);
      }
      if (d.noteName) chip("qa2-chip-project", `📄 ${d.noteName}`);
      if (d.subtasks?.length) {
        const stBox = card.createDiv({ cls: "qa2-review-subtasks" });
        for (const st of d.subtasks) {
          stBox.createDiv({ cls: "qa2-review-subtask", text: `☐ ${st}` });
        }
      }
    });

    const actions = root.createDiv({ cls: "qa2-actions" });
    const parseAgainBtn = actions.createEl("button", {
      cls: "qa2-btn qa2-btn-ghost",
      text: tRaw("tasks.quickAdd.parseAgain"),
      attr: { type: "button" },
    });
    this.parseAgainBtn = parseAgainBtn;
    parseAgainBtn.addEventListener("click", () => {
      void this.reparseMulti();
    });
    const cancelBtn = actions.createEl("button", {
      cls: "qa2-btn qa2-btn-ghost",
      text: tRaw("tasks.quickAdd.reviewCancel"),
      attr: { type: "button" },
    });
    cancelBtn.addEventListener("click", () => {
      this.closeReviewPanel();
      this.setStatus("", "hide");
    });
    const countBtn = actions.createEl("button", {
      cls: "qa2-btn qa2-btn-primary",
      text: tRaw("tasks.quickAdd.reviewSelected", {
        count: String(drafts.length),
      }),
      attr: { type: "button" },
    });
    this.updateReviewCount(countBtn, selected);
    countBtn.addEventListener("click", () => {
      const chosen = drafts.filter((_, i) => selected[i]);
      for (const draft of chosen) this.createTaskFromDraft(draft);
      this.closeReviewPanel();
      this.close();
      this.onSubmit();
    });

    // Scroll review into view
    root.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** Hide primary action + lock "Одна задача" while the AI review is open. */
  private setReviewLock(on: boolean): void {
    this.primaryBtn?.toggleClass("mcp-hidden", on);
    const singleBtn = this.modeButtons.single;
    if (singleBtn) {
      singleBtn.toggleClass("is-disabled", on);
      if (on) singleBtn.setAttribute("disabled", "true");
      else singleBtn.removeAttribute("disabled");
    }
    this.modeButtons.multi?.toggleClass("is-disabled", on);
  }

  private closeReviewPanel(): void {
    this.reviewEl?.remove();
    this.reviewEl = null;
    this.parseAgainBtn = null;
    this.setReviewLock(false);
  }

  /** Re-run AI parse on the same input ("Разобрать снова"). */
  private async reparseMulti(): Promise<void> {
    if (this.aiBusy) return;
    this.closeReviewPanel();
    this.setStatus("", "hide");
    await this.submitMulti(this.inputValue());
  }

  private updateReviewCount(btn: HTMLElement, selected: boolean[]): void {
    const n = selected.filter(Boolean).length;
    btn.setText(tRaw("tasks.quickAdd.reviewSelected", { count: String(n) }));
    btn.toggleClass("is-disabled", n === 0);
    if (n === 0) btn.setAttribute("disabled", "true");
    else btn.removeAttribute("disabled");
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

  private async fillDescriptionWithAI(btn: HTMLElement): Promise<void> {
    const raw = this.inputValue().trim();
    const parsed = parseQuickInput(raw);
    const title = parsed.title || raw;
    if (!title) {
      this.setStatus(tRaw("tasks.quickAdd.aiError"), "error");
      return;
    }
    const descBox = btn.closest(".qa2-desc-box");
    btn.setAttribute("disabled", "true");
    btn.addClass("is-busy");
    descBox?.addClass("is-ai-loading");
    this.setStatus(tRaw("tasks.quickAdd.descriptionAiBusy"), "busy");
    try {
      const text = await generateTaskDescription(title, this.descEl?.value || null);
      if (text && this.descEl) this.descEl.value = text;
      this.setStatus("", "hide");
    } catch {
      this.setStatus(tRaw("tasks.quickAdd.aiError"), "error");
    } finally {
      btn.removeAttribute("disabled");
      btn.removeClass("is-busy");
      descBox?.removeClass("is-ai-loading");
    }
  }

  /** Project / note names for the AI prompt so it matches real vault data. */
  private aiContext(): AiQuickAddContext {
    return {
      projectNames: get(projects).map((p) => p.name),
    };
  }

  private createTaskFromParsed(
    parsed: ReturnType<typeof parseQuickInput>,
    draft: AiQuickTaskDraft | null,
  ): void {
    const d = this.extra.dirty;

    // Date: form > parse > AI > modal default
    let targetDate = this.date;
    if (d.date && this.extra.date) {
      const m = wm(this.extra.date, "YYYY-MM-DD", true);
      if (m.isValid()) targetDate = m;
    } else if (parsed.date) {
      targetDate = parsed.date;
    } else if (draft?.date) {
      const m = wm(draft.date, "YYYY-MM-DD", true);
      if (m.isValid()) targetDate = m;
    }
    const dateUID = getDateUID(targetDate, "day");

    // Times: form (if dirty) > parse > AI > prefill
    let scheduledTime: string | undefined;
    let endTime: string | undefined;
    if (d.scheduledTime && this.extra.scheduledTime) scheduledTime = formatTime(this.extra.scheduledTime);
    else if (parsed.scheduledTime) scheduledTime = formatTime(parsed.scheduledTime);
    else if (draft?.scheduledTime) scheduledTime = formatTime(draft.scheduledTime);
    else if (this.prefillTime) scheduledTime = formatTime(this.prefillTime);

    if (d.endTime && this.extra.endTime) endTime = formatTime(this.extra.endTime);
    else if (parsed.endTime) endTime = formatTime(parsed.endTime);
    else if (draft?.endTime) endTime = formatTime(draft.endTime);
    else if (this.prefillEndTime) endTime = formatTime(this.prefillEndTime);

    // Project / priority / note / recurrence / deadline / work
    let projectId: string | null;
    if (d.projectId) projectId = this.extra.projectId;
    else projectId = resolveProjectId(parsed.projectName || draft?.projectName || null);

    let priority: "low" | "medium" | "high";
    if (d.priority && this.extra.priority) priority = this.extra.priority;
    else priority = parsed.priority || draft?.priority || "medium";

    let boundNotePath: string | null = null;
    if (d.notePath && this.extra.notePath) {
      boundNotePath = this.extra.notePath.includes("/")
        ? this.extra.notePath
        : resolveNotePath(this.app, this.extra.notePath);
    } else if (draft?.noteName) {
      boundNotePath = resolveNotePath(this.app, draft.noteName);
    }

    let recurrence: RecurrenceConfig | undefined;
    if (d.recurrence && this.extra.recurrenceType !== "none") {
      recurrence = { type: this.extra.recurrenceType, interval: 1 };
      if (this.extra.recurrenceType === "weekly" && this.extra.recurrenceDays.length > 0) {
        recurrence.daysOfWeek = [...this.extra.recurrenceDays];
      }
      if (this.extra.recurrenceUntil) recurrence.until = toDateUID(this.extra.recurrenceUntil);
    } else if (draft?.recurrence) {
      recurrence = normalizeRecurrence(draft.recurrence);
    }

    let deadline: string | undefined;
    if (d.deadline && this.extra.deadlineDate) deadline = toDateUID(this.extra.deadlineDate);
    else if (draft?.deadline) deadline = toDateUID(draft.deadline);

    let isWorkTask: boolean | undefined;
    if (d.isWorkTask) isWorkTask = this.extra.isWorkTask || undefined;
    else isWorkTask = draft?.isWorkTask || undefined;
    if (draft?.rate != null) isWorkTask = true;

    const paymentType = isWorkTask ? (draft?.paymentType || this.extra.paymentType) : undefined;
    const rate = isWorkTask
      ? (draft?.rate != null
          ? draft.rate
          : this.extra.rate
            ? parseFloat(this.extra.rate.replace(",", "."))
            : undefined)
      : undefined;
    const overtimeStart = isWorkTask && this.extra.paymentType === "hour" && this.extra.overtimeStart
      ? parseInt(this.extra.overtimeStart, 10)
      : undefined;
    const overtimeMultiplier = isWorkTask && this.extra.paymentType === "hour" && this.extra.overtimeMultiplier
      ? parseFloat(this.extra.overtimeMultiplier.replace(",", "."))
      : undefined;

    const description = (this.descEl?.value || draft?.description || "").trim();

    let estimatedTime = draft?.estimatedMinutes ?? undefined;
    if (estimatedTime === undefined && scheduledTime && endTime) {
      estimatedTime = minutesBetween(scheduledTime, endTime);
    }

    try {
      const task = addTask({
        title: sanitizeTitle(parsed.title),
        dateUID,
        status: "todo",
        completed: false,
        projectId,
        boundNotePath,
        priority,
        sortOrder: 0,
        description,
        scheduledTime,
        endTime,
        estimatedTime,
        deadline,
        deadlineTime: draft?.deadlineTime || undefined,
        isWorkTask,
        paymentType,
        rate,
        overtimeStart,
        overtimeMultiplier,
        recurrence,
      });
      const subtasks = this.mode === "single" ? this.collectSubtasks() : [];
      if (subtasks.length) setChecklistForTask(task.id, subtasks);
      this.onTaskCreated?.(task);
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
    const deadline = draft.deadline ? toDateUID(draft.deadline) : undefined;

    let scheduledTime: string | undefined;
    let endTime: string | undefined;
    if (draft.scheduledTime) scheduledTime = formatTime(draft.scheduledTime);
    if (draft.endTime) endTime = formatTime(draft.endTime);

    let estimatedTime = draft.estimatedMinutes ?? undefined;
    if (estimatedTime === undefined && scheduledTime && endTime) {
      estimatedTime = minutesBetween(scheduledTime, endTime);
    }

    try {
      const task = addTask({
        title,
        dateUID,
        status: "todo",
        completed: false,
        projectId,
        boundNotePath,
        priority: draft.priority || "medium",
        sortOrder: 0,
        description: draft.description || "",
        scheduledTime,
        endTime,
        estimatedTime,
        deadline,
        deadlineTime: draft.deadlineTime || undefined,
        isWorkTask: draft.isWorkTask || draft.rate != null || undefined,
        paymentType: draft.paymentType || (draft.rate != null ? "hour" : undefined),
        rate: draft.rate ?? undefined,
        recurrence,
      });
      if (draft.subtasks?.length) {
        for (const st of draft.subtasks) {
          const title = st.trim();
          if (title) addChecklistItem(task.id, title);
        }
      }
      this.onTaskCreated?.(task);
    } catch (e: unknown) {
      console.error("[QuickAddModal] Failed to create AI task:", e);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function toDateUID(date: string): string {
  return date.startsWith("day-") ? date : `day-${date}`;
}

function minutesBetween(start: string, end: string): number | undefined {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map((x) => parseInt(x, 10));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const delta = toMin(end) - toMin(start);
  return delta > 0 ? delta : undefined;
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
  if (rec.until) out.until = toDateUID(rec.until);
  return out;
}
