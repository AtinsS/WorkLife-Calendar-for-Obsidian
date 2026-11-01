import type { Moment } from "moment";
import type { ICalendarSource, IDayMetadata, IDot } from "obsidian-calendar-ui";
import { get } from "svelte/store";

import { settings } from "../stores";
import { tRaw } from "../../i18n";
import {
  collectAllCalendarOccurrences,
  customEventsStore,
  CUSTOM_EVENTS_CALENDAR_ID,
} from "../../services/customEvents";
import type { ICalendarSubscription } from "../../services/calendarSubscriptions";

const MAX_DOTS = 3;

/**
 * Marks days that carry events from subscribed ICS calendars and user-created
 * events: dot markers + `title` tooltip with the event names.
 */
function metadataForDate(date: Moment): IDayMetadata {
  const subs =
    (get(settings) as { calendarSubscriptions?: ICalendarSubscription[] })
      .calendarSubscriptions ?? [];
  const customEvents = get(customEventsStore);
  if (subs.length === 0 && customEvents.length === 0) return {};

  const rangeStart = new Date(date.year(), date.month(), date.date());
  const rangeEnd = new Date(date.year(), date.month(), date.date() + 1);
  const occurrences = collectAllCalendarOccurrences(
    subs,
    customEvents,
    tRaw("customEvents.calendarName"),
    rangeStart,
    rangeEnd,
  ).filter(
    (o) => o.occurrence.allDay || o.subscription.id === CUSTOM_EVENTS_CALENDAR_ID,
  );
  if (occurrences.length === 0) return {};

  const names = occurrences.map((o) => o.occurrence.summary);
  const dots: IDot[] = occurrences.slice(0, MAX_DOTS).map(() => ({
    className: "cal-event-dot",
    color: "default",
    isFilled: true,
  }));

  return {
    classes: ["is-ical-event"],
    dataAttributes: {
      "data-cal-events": names.join(", "),
      title: names.join("\n"),
    },
    dots,
  };
}

export const holidaySource: ICalendarSource = {
  getDailyMetadata: (date: Moment): Promise<IDayMetadata> =>
    Promise.resolve(metadataForDate(date)),
};
