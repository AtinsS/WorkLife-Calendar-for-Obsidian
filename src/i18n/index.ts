import { derived, writable, get } from "svelte/store";
import { ru } from "./ru";
import { en } from "./en";

export type Locale = "ru" | "en";
export type Translations = typeof ru;

const translations: Record<Locale, Translations> = { ru, en };

export const locale = writable<Locale>("ru");

/**
 * Currency symbol override (set from plugin settings).
 * When null, falls back to the locale default (₽ for ru, $ for en).
 */
export const currencyOverride = writable<string | null>(null);

/** Effective currency symbol. */
export function getCurrencySymbol(): string {
  const custom = get(currencyOverride);
  if (custom && custom.trim()) return custom.trim();
  return get(locale) === "en" ? "$" : "₽";
}

function resolveCurrencyKey(key: string, value: string | string[] | undefined): string | string[] | undefined {
  if (key === "locale.currencySymbol") {
    const custom = get(currencyOverride);
    if (custom && custom.trim()) return custom.trim();
  }
  return value;
}

/** Resolve nested key like "tasks.panel.title" from an object */
function getNestedValue(obj: unknown, path: string): string | string[] | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as string | string[] | undefined;
}

/**
 * Russian plural category: one / few / many.
 * 1 → one, 2–4 → few, 5–20 → many, 21 → one, etc.
 */
export function ruPlural(n: number): "one" | "few" | "many" {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return "many";
  if (n1 > 1 && n1 < 5) return "few";
  if (n1 === 1) return "one";
  return "many";
}

function resolvePluralValue(value: string | string[] | undefined, count: number | undefined): string | string[] | undefined {
  if (value == null || Array.isArray(value) || typeof value !== "string") return value;
  // Pipe forms: "one|few|many"
  if (value.includes("|") && typeof count === "number" && Number.isFinite(count)) {
    const forms = value.split("|");
    if (forms.length === 3) {
      return forms[ruPlural(count) === "one" ? 0 : ruPlural(count) === "few" ? 1 : 2];
    }
  }
  return value;
}

function pickCount(params?: Record<string, string | number>): number | undefined {
  if (!params) return undefined;
  const raw = params.count ?? params.n;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return undefined;
}

/**
 * Reactive translation store for use in Svelte components.
 * Usage: import { t } from "../i18n";  then  $t("key.path")
 */
function createT() {
  return derived([locale, currencyOverride], ([$locale]) => {
    const dict = translations[$locale] || translations.ru;
    return (key: string, params?: Record<string, string | number>): string => {
      let value = getNestedValue(dict, key);
      if (value === undefined) {
        // Fallback to Russian
        value = getNestedValue(translations.ru, key);
      }
      value = resolveCurrencyKey(key, value);
      if (value === undefined) {
        return key; // Return key itself as last resort
      }
      if (Array.isArray(value)) {
        return value.join(", ");
      }
      value = resolvePluralValue(value, pickCount(params)) as string;
      if (params) {
        return Object.entries(params).reduce(
          (str, [k, v]) => str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
          value
        );
      }
      return value ;
    };
  });
}

export const t = createT();

/**
 * Reactive array translation store for use in Svelte components.
 * Usage: import { tArray } from "../i18n";  then  $tArray("common.weekdays.short")
 */
function createTArray() {
  return derived(locale, ($locale) => {
    const dict = translations[$locale] || translations.ru;
    return (key: string): string[] => {
      const value = getNestedValue(dict, key);
      if (Array.isArray(value)) return value;
      const fallback = getNestedValue(translations.ru, key);
      if (Array.isArray(fallback)) return fallback;
      return [];
    };
  });
}

export const tArray = createTArray();

/**
 * Non-reactive translation for use outside Svelte components (main.ts, services, etc.).
 * Must be called after locale is set.
 */
export function tRaw(key: string, params?: Record<string, string | number>): string {
  const $locale = get(locale);
  const dict = translations[$locale] || translations.ru;
  let value = getNestedValue(dict, key);
  if (value === undefined) {
    value = getNestedValue(translations.ru, key);
  }
  value = resolveCurrencyKey(key, value);
  if (value === undefined) return key;
  if (Array.isArray(value)) return value.join(", ");
  value = resolvePluralValue(value, pickCount(params)) as string;
  if (params) {
    return Object.entries(params).reduce(
      (str, [k, v]) => str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
      value
    );
  }
  return value ;
}

/**
 * Non-reactive array translation for use outside Svelte components.
 */
export function tArrayRaw(key: string): string[] {
  const $locale = get(locale);
  const dict = translations[$locale] || translations.ru;
  const value = getNestedValue(dict, key);
  if (Array.isArray(value)) return value;
  const fallback = getNestedValue(translations.ru, key);
  if (Array.isArray(fallback)) return fallback;
  return [];
}

/**
 * Set locale and persist to settings.
 */
export function setLocale(newLocale: Locale): void {
  locale.set(newLocale);
}

/**
 * Detect system locale. Returns "ru" if system language is Russian, else "en".
 */
export function detectSystemLocale(): Locale {
  const lang = navigator.language || "en";
  return lang.startsWith("ru") ? "ru" : "en";
}

/**
 * Initialize locale from settings value.
 */
export function initLocale(setting: "ru" | "en" | "system"): void {
  if (setting === "system") {
    setLocale(detectSystemLocale());
  } else {
    setLocale(setting);
  }
}
