import type { App, TFile } from "obsidian";
import { TFile as TFileClass } from "obsidian";
import { loadModuleData, saveModuleData } from "../io/vaultStorage";
import type { AiTokenUsage } from "./aiProvider";

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  /** Reasoning trace kept with the answer (when thinking was on). */
  thinking?: string;
  /** Chat tools executed while composing this answer (function-calling). */
  tools?: string[];
  /** Tokens spent on this answer (as reported by the backend). */
  usage?: AiTokenUsage;
}

/**
 * Restorable chat state. Paths only — a note that was renamed or deleted
 * since the snapshot simply drops out on restore.
 */
export interface AiChatSnapshot {
  files: string[];
  pinnedPaths: string[];
  contextLabel: string;
  messages: ChatMsg[];
}

const SNAPSHOT_VERSION = 1;

/** Keeps calendar-data/aiChat.json from growing without bound in long chats. */
const MAX_PERSISTED_MESSAGES = 200;

export async function loadAiChatSnapshot(app: App): Promise<AiChatSnapshot | null> {
  const data = await loadModuleData(app, "aiChat");
  return parseSnapshot(data);
}

export async function saveAiChatSnapshot(app: App, snap: AiChatSnapshot): Promise<void> {
  const messages = snap.messages.slice(-MAX_PERSISTED_MESSAGES);
  await saveModuleData(app, "aiChat", {
    version: SNAPSHOT_VERSION,
    files: snap.files,
    pinnedPaths: [...snap.pinnedPaths],
    contextLabel: snap.contextLabel,
    messages: messages.map((m) => ({
      role: m.role,
      text: m.text,
      ...(m.thinking ? { thinking: m.thinking } : {}),
      ...(m.tools?.length ? { tools: m.tools } : {}),
      ...(m.usage ? { usage: m.usage } : {}),
    })),
  });
}

export function parseSnapshot(data: Record<string, unknown>): AiChatSnapshot | null {
  const files = asStringArray(data.files);
  const pinnedPaths = asStringArray(data.pinnedPaths);
  const messages = asMessages(data.messages);
  if (files.length === 0 && pinnedPaths.length === 0 && messages.length === 0) return null;
  return {
    files,
    pinnedPaths,
    contextLabel: typeof data.contextLabel === "string" ? data.contextLabel : "",
    messages,
  };
}

/** Re-open snapshot note paths against the vault; missing ones are dropped. */
export function resolveSnapshotFiles(
  app: App,
  snap: AiChatSnapshot,
): { files: TFile[]; pinnedPaths: Set<string> } {
  const files: TFile[] = [];
  const pinnedPaths = new Set<string>();
  for (const path of snap.files) {
    const found = app.vault.getAbstractFileByPath(path);
    if (!(found instanceof TFileClass)) continue;
    files.push(found);
    if (snap.pinnedPaths.includes(path)) pinnedPaths.add(path);
  }
  return { files, pinnedPaths };
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asMessages(v: unknown): ChatMsg[] {
  if (!Array.isArray(v)) return [];
  const out: ChatMsg[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const m = item as {
      role?: unknown;
      text?: unknown;
      thinking?: unknown;
      tools?: unknown;
      usage?: unknown;
    };
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (typeof m.text !== "string" || !m.text.trim()) continue;
    const tools = Array.isArray(m.tools)
      ? m.tools.filter((x): x is string => typeof x === "string" && !!x.trim())
      : [];
    out.push({
      role: m.role,
      text: m.text,
      thinking: typeof m.thinking === "string" && m.thinking.trim() ? m.thinking : undefined,
      tools: tools.length > 0 ? tools : undefined,
      usage: asUsage(m.usage),
    });
  }
  return out;
}

function asUsage(v: unknown): AiTokenUsage | undefined {
  if (!v || typeof v !== "object") return undefined;
  const u = v as { promptTokens?: unknown; completionTokens?: unknown; totalTokens?: unknown };
  const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const usage: AiTokenUsage = {
    promptTokens: num(u.promptTokens),
    completionTokens: num(u.completionTokens),
    totalTokens: num(u.totalTokens),
  };
  return usage.totalTokens > 0 || usage.promptTokens > 0 || usage.completionTokens > 0
    ? usage
    : undefined;
}
