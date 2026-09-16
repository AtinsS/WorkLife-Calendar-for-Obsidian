import type { Moment } from "moment";
import type { TFile } from "obsidian";
import type { ICalendarSource, IDayMetadata } from "obsidian-calendar-ui";
import { getDailyNote, getWeeklyNote } from "obsidian-daily-notes-interface";
import { get } from "svelte/store";

import { dailyNotes, weeklyNotes } from "../stores";
import { getActiveClasses } from "../utils";

const getNoteExistenceClasses = (file: TFile | null): string[] => {
  return getActiveClasses({
    "has-note": !!file,
  });
};

export const streakSource: ICalendarSource = {
  getDailyMetadata: (date: Moment): Promise<IDayMetadata> => {
    const dailyNotesMap: Record<string, TFile> = get(dailyNotes);
    const file: TFile | null = getDailyNote(date, dailyNotesMap);
    return Promise.resolve({
      classes: getNoteExistenceClasses(file),
      dots: [],
    });
  },

  getWeeklyMetadata: (date: Moment): Promise<IDayMetadata> => {
    const weeklyNotesMap: Record<string, TFile> = get(weeklyNotes);
    const file: TFile | null = getWeeklyNote(date, weeklyNotesMap);
    return Promise.resolve({
      classes: getNoteExistenceClasses(file),
      dots: [],
    });
  },
};
