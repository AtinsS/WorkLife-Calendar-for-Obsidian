import { currencyOverride, getCurrencySymbol, setLocale } from "../../i18n";
import { settings } from "../../ui/stores";
import { defaultSettings } from "../../settings";
import { getExportFolder, monthSummaryNotePath } from "../monthSummaryExport";
import { isFinanceInsightsEnabled } from "../../services/financeAI";

describe("getCurrencySymbol", () => {
  afterEach(() => {
    currencyOverride.set(null);
    setLocale("ru");
  });

  it("falls back to locale default (ru → ₽)", () => {
    setLocale("ru");
    currencyOverride.set(null);
    expect(getCurrencySymbol()).toBe("₽");
  });

  it("falls back to locale default (en → $)", () => {
    setLocale("en");
    currencyOverride.set(null);
    expect(getCurrencySymbol()).toBe("$");
  });

  it("prefers the settings override", () => {
    setLocale("ru");
    currencyOverride.set("€");
    expect(getCurrencySymbol()).toBe("€");
  });

  it("trims whitespace in the override", () => {
    currencyOverride.set("  ₸  ");
    expect(getCurrencySymbol()).toBe("₸");
  });

  it("ignores blank override", () => {
    setLocale("ru");
    currencyOverride.set("   ");
    expect(getCurrencySymbol()).toBe("₽");
  });
});

describe("getExportFolder / monthSummaryNotePath", () => {
  afterEach(() => {
    settings.set({ ...defaultSettings });
  });

  it("defaults to vault root", () => {
    settings.set({ ...defaultSettings, financeExportFolder: "" });
    expect(getExportFolder()).toBe("");
    expect(monthSummaryNotePath("2026-07")).toMatch(/^Финансы 2026-07/);
  });

  it("strips leading/trailing slashes from the folder", () => {
    settings.set({ ...defaultSettings, financeExportFolder: "/Финансы/Сводки/" });
    expect(getExportFolder()).toBe("Финансы/Сводки");
    expect(monthSummaryNotePath("2026-07")).toMatch(/^Финансы\/Сводки\/Финансы 2026-07/);
  });

  it("keeps inner spaces in folder names", () => {
    settings.set({ ...defaultSettings, financeExportFolder: "Мои финансы" });
    expect(getExportFolder()).toBe("Мои финансы");
    expect(monthSummaryNotePath("2026-01")).toContain("Мои финансы/");
  });
});

describe("isFinanceInsightsEnabled", () => {
  afterEach(() => {
    settings.set({ ...defaultSettings });
  });

  it("requires ollama to be on", () => {
    settings.set({ ...defaultSettings, ollamaEnabled: false, aiFinanceInsightsEnabled: true });
    expect(isFinanceInsightsEnabled()).toBe(false);
  });

  it("is on when ollama is on and toggle is not disabled", () => {
    settings.set({ ...defaultSettings, ollamaEnabled: true, aiFinanceInsightsEnabled: true });
    expect(isFinanceInsightsEnabled()).toBe(true);
  });

  it("respects the off toggle", () => {
    settings.set({ ...defaultSettings, ollamaEnabled: true, aiFinanceInsightsEnabled: false });
    expect(isFinanceInsightsEnabled()).toBe(false);
  });

  it("defaults to on when toggle is unset and ollama is on", () => {
    const s = { ...defaultSettings, ollamaEnabled: true } as Record<string, unknown>;
    delete s.aiFinanceInsightsEnabled;
    settings.set(s as never);
    expect(isFinanceInsightsEnabled()).toBe(true);
  });
});
