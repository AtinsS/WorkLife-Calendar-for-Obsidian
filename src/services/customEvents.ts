import { writable } from "svelte/store";
import type { ICalendarSubscription, SubscriptionOccurrence } from "./calendarSubscriptions";
import { collectSubscriptionOccurrences } from "./calendarSubscriptions";
import type { IcsOccurrence } from "./icsFeed";
import { loadModuleData, saveModuleData } from "../io/vaultStorage";
import type CalendarPlugin from "../main";

/** User-created event («Мои события») — shown like subscribed calendar events. */
export interface ICustomEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  /** First day, "YYYY-MM-DD". */
  startDate: string;
  /** Exclusive end day ("YYYY-MM-DD"); defaults to startDate + 1 day. */
  endDate?: string;
  /** "HH:MM" — only when allDay is false. */
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  /** Per-event accent color; falls back to CUSTOM_EVENTS_COLOR. */
  color?: string;
}

/** Built-in pseudo-calendar id for user events. */
export const CUSTOM_EVENTS_CALENDAR_ID = "custom-events";
export const CUSTOM_EVENTS_COLOR = "#8e44ad";

/** Runtime list of user events; persisted in `calendar-data/events.json`. */
export const customEventsStore = writable<ICustomEvent[]>([]);

/** Load from vault (`calendar-data/events.json`); migrates legacy data.json settings. */
export async function loadCustomEvents(plugin: CalendarPlugin): Promise<ICustomEvent[]> {
  const moduleData = await loadModuleData(plugin.app, "events");
  const fromVault = Array.isArray(moduleData.events)
    ? (moduleData.events as ICustomEvent[])
    : [];
  if (fromVault.length > 0) return fromVault;

  // Legacy location: plugin settings (data.json) — move to vault once
  const legacy = plugin.options.customEvents;
  if (legacy && legacy.length > 0) {
    await saveCustomEvents(plugin, legacy);
    await plugin.writeOptions({ customEvents: undefined });
    return legacy;
  }
  return [];
}

/** Persist the user events list into `calendar-data/events.json`. */
export async function saveCustomEvents(plugin: CalendarPlugin, events: ICustomEvent[]): Promise<void> {
  customEventsStore.set(events);
  await saveModuleData(plugin.app, "events", {
    events,
    version: 1,
  });
}

export function customEventsSubscription(name: string): ICalendarSubscription {
  return {
    id: CUSTOM_EVENTS_CALENDAR_ID,
    name,
    url: "",
    color: CUSTOM_EVENTS_COLOR,
    enabled: true,
  };
}

/** Effective event color: per-event override or the «Мои события» default. */
export function customEventColor(ev: ICustomEvent): string {
  return ev.color || CUSTOM_EVENTS_COLOR;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

function timedMs(key: string, time?: string): number {
  return new Date(`${key}T${time || "00:00"}:00`).getTime();
}

/** Exclusive end day of a custom event (1 day when not provided). */
export function customEventEndKey(ev: ICustomEvent): string {
  return ev.endDate && ev.endDate > ev.startDate ? ev.endDate : addDaysKey(ev.startDate, 1);
}

/**
 * Expand custom events to occurrences overlapping the half-open range
 * [rangeStart, rangeEnd) — same semantics as `expandIcsEvents`.
 */
export function customEventsToOccurrences(
  events: ICustomEvent[],
  customName: string,
  rangeStart: Date,
  rangeEnd: Date,
): SubscriptionOccurrence[] {
  const out: SubscriptionOccurrence[] = [];
  const startKey = dateKey(rangeStart);
  const endKeyLast = dateKey(new Date(rangeEnd.getTime() - 1));
  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();

  for (const ev of events) {
    const occurrence: IcsOccurrence = {
      uid: ev.id,
      summary: ev.title,
      description: ev.description,
      location: ev.location,
      allDay: ev.allDay,
      startDate: ev.startDate,
    };
    if (ev.allDay) {
      occurrence.endDate = customEventEndKey(ev);
      const overlaps =
        ev.startDate <= endKeyLast && (occurrence.endDate || ev.startDate) > startKey;
      if (!overlaps) continue;
    } else {
      occurrence.startMs = timedMs(ev.startDate, ev.startTime);
      occurrence.endMs = ev.endTime ? timedMs(ev.startDate, ev.endTime) : occurrence.startMs;
      if (occurrence.startMs >= rangeEndMs || occurrence.endMs < rangeStartMs) continue;
    }
    out.push({
      subscription: { ...customEventsSubscription(customName), color: customEventColor(ev) },
      occurrence,
    });
  }
  return out;
}

/**
 * Subscriptions + user-created events in one list — the single entry point for
 * the schedule, the sidebar calendar and the notification service.
 */
export function collectAllCalendarOccurrences(
  subs: ICalendarSubscription[],
  customEvents: ICustomEvent[],
  customName: string,
  rangeStart: Date,
  rangeEnd: Date,
): SubscriptionOccurrence[] {
  return [
    ...collectSubscriptionOccurrences(subs, rangeStart, rangeEnd),
    ...customEventsToOccurrences(customEvents, customName, rangeStart, rangeEnd),
  ];
}

export function newCustomEventId(): string {
  return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
