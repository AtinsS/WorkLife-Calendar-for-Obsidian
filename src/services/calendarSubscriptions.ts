import { requestUrl, type App } from "obsidian";
import { writable, get } from "svelte/store";
import { parseIcs, expandIcsEvents, type IcsCalendar, type IcsOccurrence } from "./icsFeed";

/** A user-configured ICS feed («Подключаемые календари»). Persisted in plugin settings. */
export interface ICalendarSubscription {
  id: string;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
}

export interface SubscriptionStatus {
  loading?: boolean;
  /** ms epoch of the last successful fetch */
  lastFetched?: number;
  lastError?: string;
  eventCount?: number;
}

/** Parsed ICS payloads per subscription id (runtime, not persisted). */
export const subscriptionCalendars = writable<Map<string, IcsCalendar>>(new Map());

/** Fetch status per subscription id (runtime). */
export const subscriptionStatus = writable<Record<string, SubscriptionStatus>>({});

/** Public Google feed: «Праздники России» — праздники и перенесённые выходные РФ. */
export const RU_HOLIDAYS_ICS_URL =
  "https://calendar.google.com/calendar/ical/ru.russian%23holiday%40group.v.calendar.google.com/public/basic.ics";

export const CALENDAR_PRESET_COLORS = [
  "#c0392b",
  "#2980b9",
  "#27ae60",
  "#8e44ad",
  "#d35400",
  "#16a085",
  "#7f8c8d",
];

/** One-click preset for the most common need — Russian holidays. */
export function ruHolidaysSubscription(): ICalendarSubscription {
  return {
    id: `ru-holidays-${Date.now().toString(36)}`,
    name: "Праздники РФ",
    url: RU_HOLIDAYS_ICS_URL,
    color: "#c0392b",
    enabled: true,
  };
}

export function nextCalendarColor(existing: ICalendarSubscription[]): string {
  return CALENDAR_PRESET_COLORS[existing.length % CALENDAR_PRESET_COLORS.length];
}

// ── cache (localStorage): raw ICS text + fetch time, survives offline restarts ──

interface CacheEntry {
  text: string;
  fetchedAt: number;
}

const CACHE_PREFIX = "wl-ics-cache-";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function readCache(app: App, id: string): CacheEntry | null {
  try {
    const raw: unknown = app.loadLocalStorage(CACHE_PREFIX + id);
    if (raw && typeof raw === "object") {
      const entry = raw as CacheEntry;
      if (typeof entry.text === "string" && typeof entry.fetchedAt === "number") return entry;
    }
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw) as CacheEntry;
      if (parsed && typeof parsed.text === "string") return parsed;
    }
  } catch {
    /* treat as no cache */
  }
  return null;
}

function writeCache(app: App, id: string, entry: CacheEntry): void {
  try {
    app.saveLocalStorage(CACHE_PREFIX + id, entry);
  } catch {
    /* cache is best-effort */
  }
}

export function clearSubscriptionCache(app: App, id: string): void {
  try {
    app.saveLocalStorage(CACHE_PREFIX + id, null);
  } catch {
    /* ignore */
  }
}

function setStatus(id: string, patch: SubscriptionStatus): void {
  subscriptionStatus.update((current) => ({
    ...current,
    [id]: { ...current[id], ...patch },
  }));
}

function storeCalendar(id: string, cal: IcsCalendar): void {
  subscriptionCalendars.update((map) => {
    const next = new Map(map);
    next.set(id, cal);
    return next;
  });
  setStatus(id, { eventCount: cal.events.length, loading: false, lastError: undefined });
}

function dropCalendar(id: string): void {
  subscriptionCalendars.update((map) => {
    const next = new Map(map);
    next.delete(id);
    return next;
  });
}

/**
 * Fetch + parse one subscription. Fresh cache is reused (TTL); on fetch error
 * the stale cache keeps the calendar usable offline. `force` bypasses the TTL.
 */
export async function refreshSubscription(
  app: App,
  sub: ICalendarSubscription,
  force = false,
): Promise<void> {
  const cached = readCache(app, sub.id);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    storeCalendar(sub.id, parseIcs(cached.text));
    setStatus(sub.id, { lastFetched: cached.fetchedAt });
    return;
  }

  setStatus(sub.id, { loading: true });
  try {
    const resp = await requestUrl({ url: sub.url, method: "GET", throw: true });
    const text = resp.text ?? "";
    if (!text.includes("BEGIN:VCALENDAR")) {
      throw new Error("not an ICS calendar");
    }
    const cal = parseIcs(text);
    writeCache(app, sub.id, { text, fetchedAt: Date.now() });
    storeCalendar(sub.id, cal);
    setStatus(sub.id, { lastFetched: Date.now() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (cached) {
      storeCalendar(sub.id, parseIcs(cached.text));
      setStatus(sub.id, { loading: false, lastError: message, lastFetched: cached.fetchedAt });
    } else {
      dropCalendar(sub.id);
      setStatus(sub.id, { loading: false, lastError: message });
    }
  }
}

/** Refresh every enabled subscription (in parallel). Disabled ones are dropped from memory. */
export async function refreshAllSubscriptions(
  app: App,
  subs: ICalendarSubscription[],
  force = false,
): Promise<void> {
  const active = subs.filter((s) => s.enabled);
  const activeIds = new Set(active.map((s) => s.id));
  subscriptionCalendars.update((map) => {
    const next = new Map(map);
    for (const id of Array.from(next.keys())) {
      if (!activeIds.has(id)) next.delete(id);
    }
    return next;
  });
  await Promise.all(active.map((s) => refreshSubscription(app, s, force)));
}

export function forgetSubscription(id: string): void {
  dropCalendar(id);
  subscriptionStatus.update((current) => {
    const next = { ...current };
    delete next[id];
    return next;
  });
}

export interface SubscriptionOccurrence {
  subscription: ICalendarSubscription;
  occurrence: IcsOccurrence;
}

/** All occurrences of enabled subscriptions overlapping [rangeStart, rangeEnd). */
export function collectSubscriptionOccurrences(
  subs: ICalendarSubscription[],
  rangeStart: Date,
  rangeEnd: Date,
): SubscriptionOccurrence[] {
  const calendars = get(subscriptionCalendars);
  const out: SubscriptionOccurrence[] = [];
  for (const sub of subs) {
    if (!sub.enabled) continue;
    const cal = calendars.get(sub.id);
    if (!cal) continue;
    for (const occurrence of expandIcsEvents(cal, rangeStart, rangeEnd)) {
      out.push({ subscription: sub, occurrence });
    }
  }
  return out;
}
