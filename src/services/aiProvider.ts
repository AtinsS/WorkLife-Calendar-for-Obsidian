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
  /** Assistant turn that requested tool runs (followed by role:"tool" results). */
  tool_calls?: AiToolCall[];
  /** Correlates a role:"tool" result with the assistant's tool call. */
  tool_call_id?: string;
  /** Ollama labels tool results with the tool name instead of a call id. */
  name?: string;
}

/** One tool invocation requested by the model (arguments already parsed). */
export interface AiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Token accounting reported by the backend for one completion. */
export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** JSON-Schema tool the model may call (function-calling). */
export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamChatOptions {
  signal?: AbortSignal;
  onDelta?: (delta: string, full: string) => void;
  /** Reasoning/thinking stream (Qwen3 reasoning_content, Ollama message.thinking). */
  onReasoning?: (delta: string, full: string) => void;
  onProgress?: (stage: "connecting" | "streaming" | "fallback" | "done" | "parsing") => void;
  format?: string;
  temperature?: number;
  /** Nucleus sampling 0–1; undefined = model default. */
  topP?: number;
  /** Cap on response tokens; undefined/0 = model default. */
  maxTokens?: number;
  /** Ollama context window (num_ctx); undefined/0 = estimated from the prompt. */
  contextSize?: number;
  /** undefined = model default; true/false = ask the model to think or not. */
  think?: boolean;
  /** Function-calling tools; omit for a plain chat completion. */
  tools?: AiToolDefinition[];
  /** Receives the model's tool calls once the turn ends (streamed or not). */
  onToolCalls?: (calls: AiToolCall[]) => void;
  /** Token counts from the backend (absent when the provider reports none). */
  onUsage?: (usage: AiTokenUsage) => void;
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
  const chars = messages.reduce(
    (n, m) =>
      n +
      (m.content?.length ?? 0) +
      (m.tool_calls?.reduce((k, c) => k + c.name.length + 80, 0) ?? 0),
    0,
  );
  const needed = Math.ceil(chars / 3) + 2048;
  return Math.max(4096, Math.min(32768, needed));
}

/**
 * Convert internal messages to the provider wire shape. Tool traffic differs:
 * OpenAI wants `arguments` as a JSON string plus `id`/`type` on each call and
 * `tool_call_id` on results; Ollama takes `arguments` as an object and labels
 * result messages with `tool_name`.
 */
export function toWireMessages(conn: AiConnection, messages: AiChatMessage[]): unknown[] {
  const openai = isOpenAiCompatible(conn);
  return messages.map((m) => {
    const out: Record<string, unknown> = {
      role: m.role,
      content: m.content ?? "",
    };
    if (m.tool_calls?.length) {
      out.tool_calls = m.tool_calls.map((c) => {
        const fn = { name: c.name, arguments: openai ? JSON.stringify(c.args ?? {}) : c.args ?? {} };
        return openai
          ? { id: c.id, type: "function", function: fn }
          : { function: fn };
      });
      if (!openai) out.content = out.content || "";
    }
    if (m.role === "tool") {
      if (openai) out.tool_call_id = m.tool_call_id ?? m.name ?? "";
      else out.tool_name = m.name ?? "";
    }
    return out;
  });
}

/** Ollama + OpenAI share this tool schema envelope. */
export function toWireTools(tools: AiToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

interface RawToolCall {
  index?: number;
  id?: string;
  name?: string;
  /** JSON string (OpenAI, streamed fragments) or a parsed object (Ollama). */
  arguments?: string | Record<string, unknown>;
}

/**
 * Both providers nest the payload under `function` (OpenAI deltas add
 * `index`/`id`/`type`); tolerate the flat shape too.
 */
function normalizeRawToolCall(raw: unknown): RawToolCall {
  const r = raw as {
    index?: number;
    id?: string;
    name?: string;
    arguments?: string | Record<string, unknown>;
    function?: { name?: string; arguments?: string | Record<string, unknown> };
  };
  return {
    index: r.index,
    id: r.id,
    name: r.name ?? r.function?.name,
    arguments: r.arguments ?? r.function?.arguments,
  };
}

function rawToolCallsOf(conn: AiConnection, obj: unknown): unknown[] {
  const o = obj as {
    message?: { tool_calls?: unknown[] };
    choices?: Array<{
      delta?: { tool_calls?: unknown[] };
      message?: { tool_calls?: unknown[] };
    }>;
  };
  const list = isOpenAiCompatible(conn)
    ? o.choices?.[0]?.delta?.tool_calls ?? o.choices?.[0]?.message?.tool_calls ?? []
    : o.message?.tool_calls ?? [];
  return Array.isArray(list) ? list : [];
}

/**
 * Accumulates tool-call fragments across stream chunks. OpenAI streams them as
 * indexed deltas with incremental `arguments` strings; Ollama delivers whole
 * calls in one chunk — both funnel through the same merge.
 */
export class ToolCallAccumulator {
  private slots: Array<{ id: string; name: string; argsRaw: string; args: Record<string, unknown> | null; index: number }> = [];

  ingest(raws: unknown[]): void {
    for (const item of raws) {
      const raw = normalizeRawToolCall(item);
      const index = raw.index ?? this.slots.length;
      let slot = this.slots[index];
      if (!slot) {
        slot = { id: "", name: "", argsRaw: "", args: null, index };
        this.slots[index] = slot;
      }
      if (raw.id) slot.id = raw.id;
      if (raw.name) slot.name = (slot.name || "") + raw.name;
      if (typeof raw.arguments === "string") slot.argsRaw += raw.arguments;
      else if (raw.arguments && typeof raw.arguments === "object") slot.args = raw.arguments;
    }
  }

  finalize(): AiToolCall[] {
    const calls: AiToolCall[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot || !slot.name) continue;
      let args = slot.args;
      if (!args) {
        const text = slot.argsRaw.trim();
        if (!text) args = {};
        else {
          try {
            const parsed = JSON.parse(text) as unknown;
            args = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
          } catch {
            args = { _raw: text };
          }
        }
      }
      calls.push({ id: slot.id || `call_${i}`, name: slot.name, args });
    }
    return calls;
  }
}

/**
 * OpenAI-compatible bodies have no universal think switch (the Ollama branch
 * gets `think` in the body instead). MiMo-family models declare `none` among
 * their reasoning-effort values, so `reasoning_effort: "none"` is their off
 * switch. Name-gated like the Qwen3 marker below: `none` is not a valid effort
 * value on every backend, and a 400 there would break the whole chat.
 */
export function thinkingBodyFields(
  model: string,
  think: boolean | undefined,
): Record<string, unknown> {
  if (think !== false || !/mimo/i.test(model)) return {};
  return { reasoning_effort: "none" };
}

function chatRequestBody(
  conn: AiConnection,
  model: string,
  messages: AiChatMessage[],
  opts: StreamChatOptions,
  stream: boolean,
): Record<string, unknown> {
  const temperature = opts.temperature ?? 0.1;
  const wireMessages = toWireMessages(conn, messages);
  const tools = opts.tools?.length ? toWireTools(opts.tools) : undefined;
  if (isOpenAiCompatible(conn)) {
    // No response_format here: LM Studio rejects {"type":"json_object"} with 400 on
    // models without structured-output support. JSON is enforced by the prompts and
    // parseOllamaJson tolerates prose around the object.
    return {
      model,
      messages: wireMessages,
      stream,
      temperature,
      ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      ...(tools ? { tools } : {}),
      // Ask for the usage block on the closing chunk — servers that dislike the
      // field fail over to the non-streaming request below.
      ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...thinkingBodyFields(model, opts.think),
    };
  }
  return {
    model,
    messages: wireMessages,
    stream,
    ...(opts.think === undefined ? {} : { think: opts.think }),
    ...(opts.format ? { format: opts.format } : {}),
    ...(tools ? { tools } : {}),
    options: {
      temperature,
      num_ctx:
        opts.contextSize && opts.contextSize > 0
          ? opts.contextSize
          : estimateNumCtx(messages),
      ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
      ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
    },
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

/**
 * Token counts: Ollama reports `prompt_eval_count`/`eval_count` (final chunk),
 * OpenAI-compatible servers report `usage.{prompt,completion,total}_tokens`.
 */
export function extractUsage(conn: AiConnection, obj: unknown): AiTokenUsage | null {
  const o = obj as {
    prompt_eval_count?: number;
    eval_count?: number;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  if (isOpenAiCompatible(conn)) {
    const u = o.usage;
    if (!u) return null;
    const promptTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
    const completionTokens = typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
    const totalTokens =
      typeof u.total_tokens === "number" ? u.total_tokens : promptTokens + completionTokens;
    if (!promptTokens && !completionTokens && !totalTokens) return null;
    return { promptTokens, completionTokens, totalTokens };
  }
  if (typeof o.prompt_eval_count !== "number" && typeof o.eval_count !== "number") return null;
  const promptTokens = o.prompt_eval_count ?? 0;
  const completionTokens = o.eval_count ?? 0;
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
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
  const toolAcc = new ToolCallAccumulator();
  let toolCallsFired = false;
  let usage: AiTokenUsage | null = null;
  const fireToolCalls = () => {
    if (toolCallsFired) return;
    const calls = toolAcc.finalize();
    if (calls.length > 0) {
      toolCallsFired = true;
      opts.onToolCalls?.(calls);
    }
  };
  const fireUsage = () => {
    if (usage) opts.onUsage?.(usage);
    usage = null;
  };

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
      const data: unknown = await resp.json();
      const reasoning = extractReasoning(conn, data);
      if (reasoning) opts.onReasoning?.(reasoning, reasoning);
      toolAcc.ingest(rawToolCallsOf(conn, data));
      usage = extractUsage(conn, data) ?? usage;
      const content = extractContent(conn, data);
      if (content) opts.onDelta?.(content, content);
      fireToolCalls();
      fireUsage();
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
        const obj: unknown = JSON.parse(payload);
        const reasoning = extractReasoning(conn, obj);
        if (reasoning) {
          reasoningFull += reasoning;
          opts.onReasoning?.(reasoning, reasoningFull);
        }
        toolAcc.ingest(rawToolCallsOf(conn, obj));
        usage = extractUsage(conn, obj) ?? usage;
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

    fireToolCalls();
    fireUsage();
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
    toolAcc.ingest(rawToolCallsOf(conn, resp.json));
    usage = extractUsage(conn, resp.json) ?? usage;
    const content = extractContent(conn, resp.json);
    if (content) opts.onDelta?.(content, content);
    fireToolCalls();
    fireUsage();
    opts.onProgress?.("done");
    return content;
  }
}
