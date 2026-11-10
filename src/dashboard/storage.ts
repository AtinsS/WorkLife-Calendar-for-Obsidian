import type { App } from "obsidian";
import {
  DashboardData,
  DashboardCard,
  DashboardLink,
  createEmptyDashboard,
  generateId,
} from "./types";
import { loadModuleData, saveModuleData } from "../io/vaultStorage";

let cachedData: DashboardData | null = null;

/** Coerce stored JSON into DashboardData. */
export function normalizeDashboardData(raw: unknown): DashboardData {
  const data = createEmptyDashboard();
  if (typeof raw !== "object" || raw === null) return data;
  const cards = (raw as { cards?: unknown }).cards;
  if (!Array.isArray(cards)) return data;
  for (const entry of cards) {
    if (typeof entry !== "object" || entry === null) continue;
    const c = entry as Record<string, unknown>;
    const id = typeof c.id === "string" ? c.id : "";
    if (!id) continue;
    const card: DashboardCard = {
      id,
      title: typeof c.title === "string" ? c.title : "",
      icon: typeof c.icon === "string" ? c.icon : "📁",
      links: [],
    };
    if (Array.isArray(c.links)) {
      for (const l of c.links) {
        if (typeof l !== "object" || l === null) continue;
        const link = l as Record<string, unknown>;
        if (typeof link.id === "string" && link.id && typeof link.notePath === "string" && link.notePath) {
          card.links.push({
            id: link.id,
            label: typeof link.label === "string" ? link.label : "",
            notePath: link.notePath,
          });
        }
      }
    }
    data.cards.push(card);
  }
  return data;
}

export async function loadDashboard(app: App): Promise<DashboardData> {
  if (cachedData) return cachedData;
  try {
    const raw = await loadModuleData(app, "dashboard");
    cachedData = normalizeDashboardData(raw);
  } catch {
    cachedData = createEmptyDashboard();
  }
  return cachedData;
}

export async function saveDashboard(app: App, data: DashboardData): Promise<void> {
  cachedData = data;
  await saveModuleData(app, "dashboard", data as unknown as Record<string, unknown>);
}

export function invalidateDashboardCache(): void {
  cachedData = null;
}

// --- Card operations ---

export async function addCard(app: App, title: string, icon: string): Promise<DashboardCard> {
  const data = await loadDashboard(app);
  const card: DashboardCard = { id: generateId(), title, icon, links: [] };
  data.cards.push(card);
  await saveDashboard(app, data);
  return card;
}

export async function updateCard(app: App, cardId: string, updates: Partial<Pick<DashboardCard, "title" | "icon">>): Promise<void> {
  const data = await loadDashboard(app);
  const card = data.cards.find((c) => c.id === cardId);
  if (card) {
    if (updates.title !== undefined) card.title = updates.title;
    if (updates.icon !== undefined) card.icon = updates.icon;
    await saveDashboard(app, data);
  }
}

export async function deleteCard(app: App, cardId: string): Promise<void> {
  const data = await loadDashboard(app);
  data.cards = data.cards.filter((c) => c.id !== cardId);
  await saveDashboard(app, data);
}

export async function addLink(app: App, cardId: string, label: string, notePath: string, index?: number): Promise<DashboardLink> {
  const data = await loadDashboard(app);
  const card = data.cards.find((c) => c.id === cardId);
  if (!card) throw new Error("Card not found");
  const link: DashboardLink = { id: generateId(), label, notePath };
  const at = index === undefined ? card.links.length : Math.max(0, Math.min(index, card.links.length));
  card.links.splice(at, 0, link);
  await saveDashboard(app, data);
  return link;
}

/**
 * Move a link within its card or to another card.
 * `toIndex` is the insertion position in the target card's links *before* removal
 * of the dragged link (i.e. as computed from the drop pointer).
 */
export async function moveLink(app: App, fromCardId: string, toCardId: string, linkId: string, toIndex: number): Promise<void> {
  const data = await loadDashboard(app);
  if (!moveLinkInData(data, fromCardId, toCardId, linkId, toIndex)) return;
  await saveDashboard(app, data);
}

/** Pure move used by {@link moveLink}. Returns false when nothing moved. */
export function moveLinkInData(data: DashboardData, fromCardId: string, toCardId: string, linkId: string, toIndex: number): boolean {
  const fromCard = data.cards.find((c) => c.id === fromCardId);
  const toCard = data.cards.find((c) => c.id === toCardId);
  if (!fromCard || !toCard) return false;
  const fromIdx = fromCard.links.findIndex((l) => l.id === linkId);
  if (fromIdx === -1) return false;
  const [link] = fromCard.links.splice(fromIdx, 1);
  let idx = toIndex;
  if (fromCard === toCard && fromIdx < toIndex) idx = toIndex - 1;
  idx = Math.max(0, Math.min(idx, toCard.links.length));
  toCard.links.splice(idx, 0, link);
  return true;
}

export async function deleteLink(app: App, cardId: string, linkId: string): Promise<void> {
  const data = await loadDashboard(app);
  const card = data.cards.find((c) => c.id === cardId);
  if (card) {
    card.links = card.links.filter((l) => l.id !== linkId);
    await saveDashboard(app, data);
  }
}

export async function reorderCards(app: App, cardIds: string[]): Promise<void> {
  const data = await loadDashboard(app);
  const cardMap = new Map(data.cards.map((c) => [c.id, c]));
  data.cards = cardIds.map((id) => cardMap.get(id)).filter((c): c is DashboardCard => !!c);
  await saveDashboard(app, data);
}
