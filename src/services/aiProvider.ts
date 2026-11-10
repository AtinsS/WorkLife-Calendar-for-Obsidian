import { requestUrl } from "obsidian";
import { errorMessage } from "../utils/sanitize";

/**
 * AI provider transport layer.
 * - "ollama"   — Ollama native API (/api/tags, /api/chat NDJSON)
 * - "lmstudio" — LM Studio, OpenAI-compatible API (/v1/models, /v1/chat/completions SSE)
 * - "openai"   — OpenAI, same OpenAI-compatible API plus a Bearer key
 */
export type AiProviderId = "ollama" | "lmstudio" | "openai";

export interface AiConnection {
  provider: AiProviderId;
  url: string;
  /** Sent as `Authorization: Bearer …` — required by OpenAI, optional elsewhere. */
  apiKey?: string;
}

export const AI_PROVIDER_DEFAULT_URL: Record<AiProviderId, string> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234/v1",
  openai: "https://api.openai.com/v1",
};

export const AI_PROVIDER_LABEL: Record<AiProviderId, string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openai: "OpenAI",
};

export function isAiProviderId(v: unknown): v is AiProviderId {
  return v === "ollama" || v === "lmstudio" || v === "openai";
}

/** LM Studio and OpenAI speak the same OpenAI-compatible wire protocol. */
export function isOpenAiCompatible(conn: AiConnection): boolean {
  return conn.provider === "lmstudio" || conn.provider === "openai";
}

export interface AiConnectionSettings {
  aiProvider?: AiProviderId;
  ollamaUrl?: string;
  lmstudioUrl?: string;
  openaiUrl?: string;
  openaiApiKey?: string;
}

function providerUrlSetting(provider: AiProviderId, opts: AiConnectionSettings): string {
  if (provider === "lmstudio") return opts.lmstudioUrl || "";
  if (provider === "openai") return opts.openaiUrl || "";
  return opts.ollamaUrl || "";
}

/** Resolve the active provider + its base URL from plugin options. */
export function resolveAiConnection(opts: AiConnectionSettings): AiConnection {
  const provider: AiProviderId = isAiProviderId(opts.aiProvider) ? opts.aiProvider : "ollama";
  const url = providerUrlSetting(provider, opts).trim() || AI_PROVIDER_DEFAULT_URL[provider];
  const apiKey = provider === "openai" ? (opts.openaiApiKey || "").trim() : "";
  return { provider, url: url.replace(/\/+$/, ""), apiKey: apiKey || undefined };
}

function apiHeaders(conn: AiConnection): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
  return headers;
}

export interface AiChatMessage {
  role: string;
  content: string;
}

export interface StreamChatOptions {
  signal?: AbortSignal;
  onDelta?: (delta: string, full: string) => void;
  /** Reasoning/thinking stream (Qwen3 reasoning_content, Ollama message.thinking). */
  onReasoning?: (delta: string, full: string) => void;
  onProgress?: (stage: "connecting" | "streaming" | "fallback" | "done" | "parsing") => void;
  format?: string;
  temperature?: number;
  /** undefined = model default; true/false = ask the model to think or not. */
  think?: boolean;
}

export interface AiConnectionResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

/** List models: GET /api/tags (Ollama) or /models (OpenAI-compatible). */
export async function testAiConnection(conn: AiConnection): Promise<AiConnectionResult> {
  const openaiApi = isOpenAiCompatible(conn);
  const url = openaiApi ? `${conn.url}/models` : `${conn.url}/api/tags`;
  try {
    const resp = await requestUrl({
      url,
      method: "GET",
      headers: apiHeaders(conn),
      throw: false,
    });
    if (resp.status !== 200) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    const models = openaiApi
      ? ((resp.json as { data?: Array<{ id?: string }> }).data ?? [])
          .map((m) => m.id)
          .filter((n): n is string => !!n)
      : ((resp.json as { models?: Array<{ name?: string }> }).models ?? [])
          .map((m) => m.name)
          .filter((n): n is string => !!n);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function testAiModel(
  conn: AiConnection,
  model: string,
): Promise<{ ok: boolean; model?: string; response?: string; error?: string }> {
  try {
    const content = await streamAiChat(conn, model, [
      { role: "user", content: "Reply with the single word: ok" },
    ], { temperature: 0, think: false });
    return { ok: true, model, response: content.trim().slice(0, 80) };
  } catch (e) {
    return { ok: false, model, error: errorMessage(e) };
  }
}

/**
 * Rough token budget for the request: chars/3 + response headroom.
 * Without an explicit num_ctx Ollama keeps the model's default (often 2–4k) and
 * silently truncates long notes — tasks at the end of the file were missed.
 */
function estimateNumCtx(messages: AiChatMessage[]): number {
  const chars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const needed = Math.ceil(chars / 3) + 2048;
  return Math.max(4096, Math.min(32768, needed));
}

function chatRequestBody(
  conn: AiConnection,
  model: string,
  messages: AiChatMessage[],
  opts: StreamChatOptions,
  stream: boolean,
): Record<string, unknown> {
  const temperature = opts.temperature ?? 0.1;
  if (isOpenAiCompatible(conn)) {
    // No response_format here: LM Studio rejects {"type":"json_object"} with 400 on
    // models without structured-output support. JSON is enforced by the prompts and
    // parseOllamaJson tolerates prose around the object.
    return {
      model,
      messages,
      stream,
      temperature,
    };
  }
  return {
    model,
    messages,
    stream,
    ...(opts.think === undefined ? {} : { think: opts.think }),
    ...(opts.format ? { format: opts.format } : {}),
    options: { temperature, num_ctx: estimateNumCtx(messages) },
  };
}

/**
 * Qwen3 thinking is toggled by a /think or /no_think marker that the model's chat
 * template consumes. LM Studio ignores request-level enable_thinking knobs, so on
 * the OpenAI-compatible route this marker is the only reliable switch. Non-Qwen3
 * models would see the marker as plain text, so leave their messages untouched.
 */
export function applyThinkDirective(
  model: string,
  messages: AiChatMessage[],
  think: boolean,
): AiChatMessage[] {
  if (!/qwen3/i.test(model)) return messages;
  const marker = think ? "/think" : "/no_think";
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === "user") {
      out[i] = { ...out[i], content: `${out[i].content}\n\n${marker}` };
      break;
    }
  }
  return out;
}

function chatEndpoint(conn: AiConnection): string {
  return isOpenAiCompatible(conn)
    ? `${conn.url}/chat/completions`
    : `${conn.url}/api/chat`;
}

function extractDelta(conn: AiConnection, obj: unknown): string {
  const o = obj as {
    message?: { content?: string };
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
  };
  if (isOpenAiCompatible(conn)) {
    return o.choices?.[0]?.delta?.content ?? o.choices?.[0]?.message?.content ?? "";
  }
  return o.message?.content ?? "";
}

function extractContent(conn: AiConnection, obj: unknown): string {
  const o = obj as {
    message?: { content?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (isOpenAiCompatible(conn)) {
    return o.choices?.[0]?.message?.content ?? "";
  }
  return o.message?.content ?? "";
}

function extractReasoning(conn: AiConnection, obj: unknown): string {
  const o = obj as {
    message?: { thinking?: string };
    choices?: Array<{
      delta?: { reasoning_content?: string };
      message?: { reasoning_content?: string };
    }>;
  };
  if (isOpenAiCompatible(conn)) {
    return (
      o.choices?.[0]?.delta?.reasoning_content ??
      o.choices?.[0]?.message?.reasoning_content ??
      ""
    );
  }
  return o.message?.thinking ?? "";
}

/** Rejects with AbortError as soon as the signal fires (requestUrl has no abort). */
function abortRejection(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const err = new DOMException("Aborted", "AbortError");
    // No signal = nothing can abort the request: never settle, so requestUrl wins the race.
    if (!signal) return;
    if (signal.aborted) {
      reject(err);
      return;
    }
    signal.addEventListener("abort", () => reject(err), { once: true });
  });
}

/**
 * Stream a chat completion and return the full text.
 * Ollama speaks NDJSON over /api/chat; LM Studio speaks SSE over /v1/chat/completions.
 * Falls back to a non-streaming requestUrl round-trip when streaming is unavailable.
 */
export async function streamAiChat(
  conn: AiConnection,
  model: string,
  messages: AiChatMessage[],
  opts: StreamChatOptions = {},
): Promise<string> {
  // Qwen3 on the OpenAI-compatible route has no request-level think switch;
  // the marker in the last user message is consumed by the chat template.
  const effectiveMessages =
    isOpenAiCompatible(conn) && opts.think !== undefined
      ? applyThinkDirective(model, messages, opts.think)
      : messages;
  const endpoint = chatEndpoint(conn);
  const body = chatRequestBody(conn, model, effectiveMessages, opts, true);
  const label = AI_PROVIDER_LABEL[conn.provider];
  let reasoningFull = "";

  opts.onProgress?.("connecting");

  try {
    // window.fetch is required: requestUrl cannot stream chunks or honor AbortSignal.
    // Falls back to requestUrl below when streaming is unavailable.
    if (typeof window.fetch !== "function") throw new Error("fetch unavailable");

    const resp = await window.fetch(endpoint, {
      method: "POST",
      headers: apiHeaders(conn),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok) {
      throw new Error(`${label} HTTP ${resp.status}`);
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (contentType.includes("application/json") && !resp.body) {
      const data = await resp.json();
      const reasoning = extractReasoning(conn, data);
      if (reasoning) opts.onReasoning?.(reasoning, reasoning);
      const content = extractContent(conn, data);
      if (content) opts.onDelta?.(content, content);
      opts.onProgress?.("done");
      return content;
    }

    if (!resp.body) throw new Error("Empty stream body");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    let started = false;

    const consumeLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // SSE frames from OpenAI-compatible servers are prefixed with "data: ".
      const payload = isOpenAiCompatible(conn)
        ? trimmed.replace(/^data:\s*/, "")
        : trimmed;
      if (!payload || payload === "[DONE]") return;
      try {
        const obj = JSON.parse(payload);
        const reasoning = extractReasoning(conn, obj);
        if (reasoning) {
          reasoningFull += reasoning;
          opts.onReasoning?.(reasoning, reasoningFull);
        }
        const delta = extractDelta(conn, obj);
        if (delta) {
          full += delta;
          opts.onDelta?.(delta, full);
        }
      } catch {
        // incomplete line
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!started) {
        started = true;
        opts.onProgress?.("streaming");
      }
      buffer += decoder.decode(value, { stream: true });
      // Ollama: NDJSON one object per line. LM Studio: SSE "data: …" per line.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consumeLine(line);
    }

    if (buffer.trim()) consumeLine(buffer);

    opts.onProgress?.("done");
    return full;
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    opts.onProgress?.("fallback");
    // requestUrl cannot be aborted, so race it against the signal — otherwise the
    // Stop button hangs dead for the whole non-streaming retry (minutes on thinking
    // models re-generating the reply from scratch).
    const resp = await Promise.race([
      requestUrl({
        url: endpoint,
        method: "POST",
        headers: apiHeaders(conn),
        body: JSON.stringify(chatRequestBody(conn, model, effectiveMessages, opts, false)),
        throw: false,
      }),
      abortRejection(opts.signal),
    ]);
    if (resp.status !== 200) {
      throw new Error(`${label} HTTP ${resp.status}: ${resp.text}`);
    }
    const reasoning = extractReasoning(conn, resp.json);
    if (reasoning) opts.onReasoning?.(reasoning, reasoning);
    const content = extractContent(conn, resp.json);
    if (content) opts.onDelta?.(content, content);
    opts.onProgress?.("done");
    return content;
  }
}
