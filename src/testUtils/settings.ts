import type { ISettings } from "src/settings";

export function getDefaultSettings(
  overrides: Partial<ISettings> = {}
): ISettings {
  return Object.assign(
    {},
    {
      shouldConfirmBeforeCreate: false,
      wordsPerDot: 50,
      showWeeklyNote: false,
      weeklyNoteFolder: "",
      weeklyNoteFormat: "",
      weeklyNoteTemplate: "",
      localeOverride: "default",
    },
    overrides
  ) as ISettings;
}
