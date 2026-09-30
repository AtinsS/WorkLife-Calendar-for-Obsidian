/**
 * Expense category taxonomy with emoji.
 * Built-in defaults + user-defined custom categories (managed in the UI).
 */
export interface ExpenseCategoryDef {
  id: string;
  name: string;
  icon: string;
  keywords: string[];
  /** Built-ins cannot be deleted, only renamed/icon-changed is blocked too. */
  builtin?: boolean;
}

export const EXPENSE_CATEGORIES: ExpenseCategoryDef[] = [
  { id: "food", name: "Еда", icon: "🍔", builtin: true, keywords: ["продукт", "еда", "кафе", "ресторан", "обед", "ужин", "завтрак", "кофе", "доставка", "магазин", "супермаркет", "food", "grocery", "cafe", "restaurant"] },
  { id: "transport", name: "Транспорт", icon: "🚕", builtin: true, keywords: ["такси", "метро", "автобус", "проезд", "бензин", "топливо", "парковка", "поезд", "самолет", "билет", "транспорт", "taxi", "uber", "fuel", "gas", "train", "bus"] },
  { id: "clothing", name: "Одежда", icon: "👕", builtin: true, keywords: ["штан", "куртк", "футбол", "обув", "одежд", "джинс", "платье", "носки", "шапка", "clothes", "shirt", "pants", "shoes", "jacket"] },
  { id: "housing", name: "Дом", icon: "🏠", builtin: true, keywords: ["аренд", "квартплат", "жкх", "коммунал", "интернет", "свет", "газ", "вода", "ремонт", "мебель", "rent", "utility", "furniture"] },
  { id: "health", name: "Здоровье", icon: "💊", builtin: true, keywords: ["аптек", "лекарств", "врач", "клиник", "стоматолог", "анализ", "здоров", "спортзал", "фитнес", "pharmacy", "doctor", "gym", "health"] },
  { id: "entertainment", name: "Развлечения", icon: "🎬", builtin: true, keywords: ["кино", "театр", "игр", "подписк", "концерт", "клуб", "бар", "развлеч", "музык", "cinema", "game", "concert", "subscription"] },
  { id: "education", name: "Образование", icon: "📚", builtin: true, keywords: ["курс", "книг", "учеб", "обучен", "семинар", "тренинг", "школ", "универ", "education", "course", "book", "study"] },
  { id: "gifts", name: "Подарки", icon: "🎁", builtin: true, keywords: ["подар", "цвет", "сюрприз", "день рождения", "свадьб", "gift", "present", "flower"] },
  { id: "pets", name: "Питомцы", icon: "🐾", builtin: true, keywords: ["кот", "собак", "ветерин", "корм", "зоомагазин", "pet", "cat", "dog", "vet"] },
  { id: "other", name: "Прочее", icon: "📦", builtin: true, keywords: ["прочее", "другое", "разное", "other"] },
];

export function generateCategoryId(): string {
  return `ec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Full list = builtins first, then custom. */
export function mergeCategories(custom: ExpenseCategoryDef[]): ExpenseCategoryDef[] {
  const customIds = new Set(custom.map((c) => c.id));
  const builtins = EXPENSE_CATEGORIES.filter((c) => !customIds.has(c.id));
  return [...builtins, ...custom];
}

export function categoryById(list: ExpenseCategoryDef[], id: string): ExpenseCategoryDef {
  return (
    list.find((c) => c.id === id) ||
    list.find((c) => c.id === "other") ||
    list[list.length - 1]
  );
}

export function categoryByName(list: ExpenseCategoryDef[], name: string): ExpenseCategoryDef | null {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  return (
    list.find((c) => c.name.toLowerCase() === n) ||
    list.find((c) => c.id === n) ||
    null
  );
}

export function guessCategory(list: ExpenseCategoryDef[], text: string): ExpenseCategoryDef {
  const t = (text || "").toLowerCase();
  for (const cat of list) {
    if (cat.id === "other") continue;
    if (cat.keywords.some((k) => t.includes(k))) return cat;
    if (cat.name && t.includes(cat.name.toLowerCase())) return cat;
  }
  return categoryById(list, "other");
}

export function iconForCategory(list: ExpenseCategoryDef[], nameOrId: string): string {
  return categoryByName(list, nameOrId)?.icon || "📦";
}
