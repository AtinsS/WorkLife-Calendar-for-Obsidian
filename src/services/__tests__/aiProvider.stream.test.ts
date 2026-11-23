/**
 * Integration tests for streamAiChat against a mocked HTTP stream.
 * Verifies the full wire path: NDJSON/SSE parsing, tool-call extraction,
 * request serialization on tool follow-ups, and abort behavior (no hangs).
 */
import {
  streamAiChat,
  toWireMessages,
  type AiChatMessage,
  type AiToolCall,
} from "../aiProvider";
// Same module instance the transport uses (jest.requireMock can hand back a
// different mock instance — plain import matches the real binding).
import { requestUrl as requestUrlMock } from "obsidian";

import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from "util";

const g = globalThis as unknown as {
  TextDecoder?: typeof TextDecoder;
  TextEncoder?: typeof TextEncoder;
};
if (typeof g.TextDecoder === "undefined") g.TextDecoder = NodeTextDecoder as typeof TextDecoder;
if (typeof g.TextEncoder === "undefined") g.TextEncoder = NodeTextEncoder as typeof TextEncoder;

const ollama = { provider: "ollama" as const, url: "http://localhost:11434" };
const lmstudio = { provider: "lmstudio" as const, url: "http://localhost:1234/v1" };

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function ndjsonBody(lines: string[]): unknown {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
        if (i >= lines.length) return Promise.resolve({ done: true, value: undefined });
        const chunk = encoder.encode(`${lines[i++]}\n`);
        return Promise.resolve({ done: false, value: chunk });
      },
    }),
  };
}

function sseBody(lines: string[]): unknown {
  return ndjsonBody(lines.map((l) => `data: ${l}`));
}

/** Install a window.fetch that replays given frames and records request bodies. */
function mockFetch(
  frames: string[],
  opts: { sse?: boolean; ok?: boolean; status?: number } = {},
): FetchCall[] {
  const calls: FetchCall[] = [];
  const win = window as unknown as { fetch?: unknown };
  win.fetch = jest.fn().mockImplementation((_url: string, init: { body: string }) => {
    calls.push({ url: String(_url), body: JSON.parse(init.body) });
    return Promise.resolve({
      ok: opts.ok !== false,
      status: opts.status ?? 200,
      headers: {
        get: (k: string) =>
          k.toLowerCase() === "content-type" ? "application/x-ndjson" : null,
      },
      body: opts.sse ? sseBody(frames) : ndjsonBody(frames),
    });
  });
  return calls;
}

afterEach(() => {
  delete (window as unknown as { fetch?: unknown }).fetch;
});

describe("streamAiChat — plain answers", () => {
  it("concatenates NDJSON deltas from an Ollama stream", async () => {
    mockFetch([
      JSON.stringify({ message: { content: "Hel" }, done: false }),
      JSON.stringify({ message: { content: "lo!" }, done: false }),
      JSON.stringify({ message: { content: "" }, done: true }),
    ]);
    const out = await streamAiChat(ollama, "llama3.1", [{ role: "user", content: "hi" }]);
    expect(out).toBe("Hello!");
  });

  it("parses SSE frames from an OpenAI-compatible stream", async () => {
    mockFetch(
      [
        JSON.stringify({ choices: [{ delta: { content: "Hi" } }] }),
        JSON.stringify({ choices: [{ delta: { content: " there" } }] }),
        "[DONE]",
      ],
      { sse: true },
    );
    const out = await streamAiChat(lmstudio, "gpt-4o", [{ role: "user", content: "hi" }]);
    expect(out).toBe("Hi there");
  });

  it("streams deltas through onDelta as they arrive", async () => {
    mockFetch([
      JSON.stringify({ message: { content: "a" }, done: false }),
      JSON.stringify({ message: { content: "b" }, done: false }),
    ]);
    const deltas: string[] = [];
    await streamAiChat(ollama, "m", [{ role: "user", content: "x" }], {
      onDelta: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(["a", "b"]);
  });
});

describe("streamAiChat — tool calls", () => {
  it("collects Ollama tool calls and reports them once", async () => {
    mockFetch([
      JSON.stringify({
        message: {
          content: "",
          tool_calls: [{ function: { name: "create_task", arguments: { title: "Milk" } } }],
        },
        done: false,
      }),
      JSON.stringify({ message: { content: "" }, done: true }),
    ]);
    const seen: AiToolCall[][] = [];
    const out = await streamAiChat(ollama, "llama3.1", [{ role: "user", content: "add" }], {
      tools: [
        {
          name: "create_task",
          description: "d",
          parameters: { type: "object", properties: { title: { type: "string" } } },
        },
      ],
      onToolCalls: (calls) => seen.push(calls),
    });
    expect(out).toBe("");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([{ id: "call_0", name: "create_task", args: { title: "Milk" } }]);
  });

  it("merges OpenAI streamed tool-call fragments", async () => {
    mockFetch(
      [
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "list_", arguments: "" } }] } }],
        }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "tasks", arguments: '{"limit":2}' } }] } }],
        }),
      ],
      { sse: true },
    );
    const seen: AiToolCall[][] = [];
    await streamAiChat(lmstudio, "gpt-4o", [{ role: "user", content: "list" }], {
      tools: [{ name: "list_tasks", description: "d", parameters: { type: "object" } }],
      onToolCalls: (calls) => seen.push(calls),
    });
    expect(seen[0]).toEqual([{ id: "call_9", name: "list_tasks", args: { limit: 2 } }]);
  });

  it("sends tools in the request and tool results back on the follow-up", async () => {
    // Queue-based fetch: 1st response asks for a tool, 2nd gives the final answer.
    const calls: FetchCall[] = [];
    const encoder = new TextEncoder();
    const queue: string[][] = [
      [
        JSON.stringify({
          message: {
            content: "",
            tool_calls: [{ function: { name: "list_tasks", arguments: {} } }],
          },
          done: true,
        }),
      ],
      [JSON.stringify({ message: { content: "You have Milk planned." }, done: true })],
    ];
    const win = window as unknown as { fetch?: unknown };
    win.fetch = jest.fn().mockImplementation((_url: string, init: { body: string }) => {
      calls.push({ url: String(_url), body: JSON.parse(init.body) });
      const frames = queue.shift() ?? [];
      let i = 0;
      return Promise.resolve({
        ok: true,
        headers: { get: () => "application/x-ndjson" },
        body: {
          getReader: () => ({
            read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
              if (i >= frames.length) return Promise.resolve({ done: true, value: undefined });
              return Promise.resolve({
                done: false,
                value: encoder.encode(`${frames[i++]}\n`),
              });
            },
          }),
        },
      });
    });

    const toolDefs = [
      { name: "list_tasks", description: "List tasks", parameters: { type: "object", properties: {} } },
    ];
    const first: AiChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "what is planned?" },
    ];
    const captured: AiToolCall[] = [];
    await streamAiChat(ollama, "llama3.1", first, {
      tools: toolDefs,
      onToolCalls: (c) => captured.push(...c),
    });
    expect(captured).toHaveLength(1);

    // Follow-up like the chat's tool loop builds it.
    const followUp: AiChatMessage[] = [
      ...first,
      { role: "assistant", content: "", tool_calls: captured },
      {
        role: "tool",
        content: "- id=a | 2026-07-10 | todo | Milk",
        tool_call_id: captured[0].id,
        name: "list_tasks",
      },
    ];
    const answer = await streamAiChat(ollama, "llama3.1", followUp, { tools: toolDefs });

    expect(answer).toBe("You have Milk planned.");
    expect(calls).toHaveLength(2);
    // First request advertised the tool…
    expect(calls[0].body.tools).toEqual([
      {
        type: "function",
        function: { name: "list_tasks", description: "List tasks", parameters: { type: "object", properties: {} } },
      },
    ]);
    // …second carried the assistant tool call + tool result in Ollama wire shape.
    const wire = calls[1].body.messages as Array<Record<string, unknown>>;
    expect(wire[2].role).toBe("assistant");
    expect(wire[2].tool_calls).toEqual([{ function: { name: "list_tasks", arguments: {} } }]);
    expect(wire[3]).toEqual({
      role: "tool",
      content: "- id=a | 2026-07-10 | todo | Milk",
      tool_name: "list_tasks",
    });
    // Same messages in OpenAI shape use string arguments + tool_call_id.
    const openaiWire = toWireMessages(lmstudio, followUp) as Array<Record<string, unknown>>;
    expect((openaiWire[2].tool_calls as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: captured[0].id,
      type: "function",
    });
    expect(openaiWire[3]).toMatchObject({ role: "tool", tool_call_id: captured[0].id });
  });

  it("passes generation knobs through to the Ollama options block", async () => {
    const calls = mockFetch([JSON.stringify({ message: { content: "ok" }, done: true })]);
    await streamAiChat(ollama, "m", [{ role: "user", content: "x" }], {
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 256,
    });
    expect(calls[0].body.options).toMatchObject({
      temperature: 0.7,
      top_p: 0.9,
      num_predict: 256,
    });
  });

  it("passes generation knobs through to an OpenAI-compatible body", async () => {
    const calls = mockFetch([JSON.stringify({ choices: [{ delta: { content: "ok" } }] })], {
      sse: true,
    });
    await streamAiChat(lmstudio, "m", [{ role: "user", content: "x" }], {
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 256,
    });
    expect(calls[0].body).toMatchObject({
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 256,
    });
    // Context window is an Ollama-side knob — never sent to OpenAI-compatible APIs.
    expect(calls[0].body.options).toBeUndefined();
  });

  it("honors an explicit Ollama context size and estimates it otherwise", async () => {
    const fixed = mockFetch([JSON.stringify({ message: { content: "ok" }, done: true })]);
    await streamAiChat(ollama, "m", [{ role: "user", content: "x" }], { contextSize: 8192 });
    expect((fixed[0].body.options as Record<string, unknown>).num_ctx).toBe(8192);

    const zero = mockFetch([JSON.stringify({ message: { content: "ok" }, done: true })]);
    await streamAiChat(ollama, "m", [{ role: "user", content: "x" }], { contextSize: 0 });
    expect((zero[0].body.options as Record<string, unknown>).num_ctx).toBeGreaterThanOrEqual(4096);

    const auto = mockFetch([JSON.stringify({ message: { content: "ok" }, done: true })]);
    await streamAiChat(ollama, "m", [{ role: "user", content: "x" }]);
    expect((auto[0].body.options as Record<string, unknown>).num_ctx).toBeGreaterThanOrEqual(4096);
  });
});

describe("streamAiChat — token usage", () => {
  it("reports usage from an Ollama done chunk", async () => {
    mockFetch([
      JSON.stringify({ message: { content: "Hi" }, done: false }),
      JSON.stringify({
        message: { content: "" },
        done: true,
        prompt_eval_count: 120,
        eval_count: 45,
      }),
    ]);
    const usages: Array<{ totalTokens: number }> = [];
    await streamAiChat(ollama, "llama3.1", [{ role: "user", content: "x" }], {
      onUsage: (u) => usages.push(u),
    });
    expect(usages).toEqual([{ promptTokens: 120, completionTokens: 45, totalTokens: 165 }]);
  });

  it("reports usage from an OpenAI closing chunk", async () => {
    mockFetch(
      [
        JSON.stringify({ choices: [{ delta: { content: "Hi" } }] }),
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        "[DONE]",
      ],
      { sse: true },
    );
    const usages: Array<{ totalTokens: number }> = [];
    await streamAiChat(lmstudio, "gpt-4o", [{ role: "user", content: "x" }], {
      onUsage: (u) => usages.push(u),
    });
    expect(usages).toEqual([{ promptTokens: 10, completionTokens: 5, totalTokens: 15 }]);
  });

  it("requests the usage block on OpenAI-compatible streams only", async () => {
    const openaiCalls = mockFetch(
      [JSON.stringify({ choices: [{ delta: { content: "ok" } }] })],
      { sse: true },
    );
    await streamAiChat(lmstudio, "m", [{ role: "user", content: "x" }]);
    expect(openaiCalls[0].body.stream_options).toEqual({ include_usage: true });

    const ollamaCalls = mockFetch([JSON.stringify({ message: { content: "ok" }, done: true })]);
    await streamAiChat(ollama, "m", [{ role: "user", content: "x" }]);
    expect(ollamaCalls[0].body.stream_options).toBeUndefined();
    expect((ollamaCalls[0].body.options as Record<string, unknown>).stream_options).toBeUndefined();
  });

  it("stays silent when the backend reports no counts", async () => {
    mockFetch([JSON.stringify({ message: { content: "Hi" }, done: true })]);
    const onUsage = jest.fn();
    await streamAiChat(ollama, "llama3.1", [{ role: "user", content: "x" }], { onUsage });
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe("streamAiChat — abort and fallback", () => {
  it("rejects with AbortError when the signal fires mid-stream", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const win = window as unknown as { fetch?: unknown };
    win.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => "application/x-ndjson" },
        body: {
          getReader: () => ({
            read: (): Promise<{ done: boolean; value?: Uint8Array }> =>
              new Promise((resolve, reject) => {
                // Real fetch: aborting the signal errors the body stream.
                if (controller.signal.aborted) {
                  reject(new DOMException("Aborted", "AbortError"));
                  return;
                }
                controller.signal.addEventListener(
                  "abort",
                  () => reject(new DOMException("Aborted", "AbortError")),
                  { once: true },
                );
                // First chunk delivered, then the stream stalls until abort.
                resolve({
                  done: false,
                  value: encoder.encode(
                    `${JSON.stringify({ message: { content: "partial" }, done: false })}\n`,
                  ),
                });
              }),
          }),
        },
      }),
    );
    const pending = streamAiChat(ollama, "m", [{ role: "user", content: "x" }], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("falls back to a non-streaming request when streaming fails", async () => {
    const requestUrl = requestUrlMock as unknown as jest.Mock;
    requestUrl.mockResolvedValueOnce({
      status: 200,
      text: "",
      json: { message: { content: "fallback answer" } },
    });
    const win = window as unknown as { fetch?: unknown };
    win.fetch = jest.fn().mockRejectedValue(new Error("network down"));
    const out = await streamAiChat(ollama, "m", [{ role: "user", content: "x" }]);
    expect(out).toBe("fallback answer");
    expect(requestUrl).toHaveBeenCalled();
    // Fallback body must still be a valid non-streaming payload.
    const body = JSON.parse(requestUrl.mock.calls[0][0].body as string);
    expect(body.stream).toBe(false);
    expect(body.model).toBe("m");
  });

  it("does not retry the fallback after an abort", async () => {
    const requestUrl = requestUrlMock as unknown as jest.Mock;
    requestUrl.mockClear();
    const controller = new AbortController();
    controller.abort();
    const win = window as unknown as { fetch?: unknown };
    win.fetch = jest.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(
      streamAiChat(ollama, "m", [{ role: "user", content: "x" }], {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requestUrl).not.toHaveBeenCalled();
  });
});
