import {
  resolveAiConnection,
  applyThinkDirective,
  thinkingBodyFields,
  extractUsage,
  toWireMessages,
  toWireTools,
  ToolCallAccumulator,
  type AiChatMessage,
  AI_PROVIDER_DEFAULT_URL,
} from "../aiProvider";

describe("resolveAiConnection", () => {
  it("defaults to ollama with its default URL", () => {
    expect(resolveAiConnection({})).toEqual({
      provider: "ollama",
      url: AI_PROVIDER_DEFAULT_URL.ollama,
    });
    expect(resolveAiConnection({}).url).toBe("http://localhost:11434");
  });

  it("uses the stored ollama URL", () => {
    expect(resolveAiConnection({ ollamaUrl: "http://192.168.1.5:11434" })).toEqual({
      provider: "ollama",
      url: "http://192.168.1.5:11434",
    });
  });

  it("switches to lmstudio with its default URL", () => {
    expect(resolveAiConnection({ aiProvider: "lmstudio" })).toEqual({
      provider: "lmstudio",
      url: "http://localhost:1234/v1",
    });
  });

  it("keeps provider URLs separate", () => {
    const conn = resolveAiConnection({
      aiProvider: "lmstudio",
      lmstudioUrl: "http://localhost:9999/v1",
      ollamaUrl: "http://localhost:11434",
    });
    expect(conn).toEqual({ provider: "lmstudio", url: "http://localhost:9999/v1" });
  });

  it("strips trailing slashes", () => {
    expect(resolveAiConnection({ ollamaUrl: "http://localhost:11434///" }).url).toBe(
      "http://localhost:11434",
    );
    expect(resolveAiConnection({ aiProvider: "lmstudio", lmstudioUrl: "http://x:1234/v1/" }).url).toBe(
      "http://x:1234/v1",
    );
  });

  it("falls back to ollama on unknown provider and on blank URL", () => {
    expect(resolveAiConnection({ aiProvider: "groq" as never }).provider).toBe("ollama");
    expect(resolveAiConnection({ ollamaUrl: "   " }).url).toBe("http://localhost:11434");
    expect(resolveAiConnection({ aiProvider: "lmstudio", lmstudioUrl: "  " }).url).toBe(
      "http://localhost:1234/v1",
    );
  });

  it("switches to openai with its default URL and the API key", () => {
    expect(resolveAiConnection({ aiProvider: "openai", openaiApiKey: "sk-test" })).toEqual({
      provider: "openai",
      url: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });
  });

  it("omits apiKey when it is blank and never leaks an ollama key", () => {
    expect(resolveAiConnection({ aiProvider: "openai", openaiApiKey: "  " }).apiKey).toBeUndefined();
    expect(resolveAiConnection({ aiProvider: "ollama" }).apiKey).toBeUndefined();
    expect(resolveAiConnection({ aiProvider: "lmstudio" }).apiKey).toBeUndefined();
  });
});

describe("applyThinkDirective", () => {
  const msgs: AiChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ];

  it("appends /no_think to the last user message on qwen3 when off", () => {
    const out = applyThinkDirective("qwen/qwen3-4b", msgs, false);
    expect(out).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello\n\n/no_think" },
    ]);
  });

  it("appends /think on qwen3 when on", () => {
    const out = applyThinkDirective("qwen3-8b", msgs, true);
    expect(out[1].content).toBe("hello\n\n/think");
  });

  it("leaves non-qwen3 models untouched", () => {
    expect(applyThinkDirective("llama3.1", msgs, false)).toBe(msgs);
    expect(applyThinkDirective("gemma-3-4b", msgs, true)).toBe(msgs);
  });

  it("does not mutate the original messages", () => {
    const out = applyThinkDirective("qwen3-4b", msgs, false);
    expect(out[1]).not.toBe(msgs[1]);
    expect(msgs[1].content).toBe("hello");
  });

  it("marks the last user message even after trailing assistant turns", () => {
    const out = applyThinkDirective("qwen3-4b", [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ], false);
    expect(out[0].content).toBe("q1");
    expect(out[2].content).toBe("q2\n\n/no_think");
  });
});

describe("thinkingBodyFields", () => {
  it("turns mimo-family reasoning off with reasoning_effort: none", () => {
    expect(thinkingBodyFields("mimo-v2.6 pro", false)).toEqual({ reasoning_effort: "none" });
    expect(thinkingBodyFields("MiMo-V2.6-Pro", false)).toEqual({ reasoning_effort: "none" });
    expect(thinkingBodyFields("xiaomi/mimo-v2.5", false)).toEqual({ reasoning_effort: "none" });
  });

  it("sends nothing for mimo when thinking is on or undecided", () => {
    expect(thinkingBodyFields("mimo-v2.6 pro", true)).toEqual({});
    expect(thinkingBodyFields("mimo-v2.6 pro", undefined)).toEqual({});
  });

  it("never touches non-mimo models", () => {
    expect(thinkingBodyFields("qwen3-4b", false)).toEqual({});
    expect(thinkingBodyFields("llama3.1", false)).toEqual({});
    expect(thinkingBodyFields("gpt-4o", false)).toEqual({});
  });
});

describe("ToolCallAccumulator", () => {
  it("merges streamed OpenAI fragments into one call", () => {
    const acc = new ToolCallAccumulator();
    acc.ingest([{ index: 0, id: "call_1", function: { name: "create_", arguments: '{"ti' } }]);
    acc.ingest([{ index: 0, function: { name: "task", arguments: 'tle": "Buy milk"}' } }]);
    expect(acc.finalize()).toEqual([
      { id: "call_1", name: "create_task", args: { title: "Buy milk" } },
    ]);
  });

  it("keeps parallel calls in index order", () => {
    const acc = new ToolCallAccumulator();
    acc.ingest([
      { index: 0, id: "a", function: { name: "list_tasks", arguments: "{}" } },
      { index: 1, id: "b", function: { name: "search_notes", arguments: '{"query":"x"}' } },
    ]);
    const calls = acc.finalize();
    expect(calls.map((c) => c.name)).toEqual(["list_tasks", "search_notes"]);
    expect(calls[1].id).toBe("b");
  });

  it("accepts Ollama-style parsed object arguments", () => {
    const acc = new ToolCallAccumulator();
    acc.ingest([{ function: { name: "list_tasks", arguments: { limit: 5 } } }]);
    expect(acc.finalize()).toEqual([{ id: "call_0", name: "list_tasks", args: { limit: 5 } }]);
  });

  it("falls back to raw text on malformed JSON arguments", () => {
    const acc = new ToolCallAccumulator();
    acc.ingest([{ function: { name: "search_notes", arguments: "not json" } }]);
    expect(acc.finalize()[0].args).toEqual({ _raw: "not json" });
  });

  it("yields nothing when no calls arrived", () => {
    expect(new ToolCallAccumulator().finalize()).toEqual([]);
  });
});

describe("toWireTools", () => {
  it("wraps definitions in the shared function envelope", () => {
    expect(
      toWireTools([
        {
          name: "create_task",
          description: "d",
          parameters: { type: "object", properties: {} },
        },
      ]),
    ).toEqual([
      {
        type: "function",
        function: {
          name: "create_task",
          description: "d",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });
});

describe("toWireMessages", () => {
  const ollama = { provider: "ollama" as const, url: "http://localhost:11434" };
  const lmstudio = { provider: "lmstudio" as const, url: "http://localhost:1234/v1" };

  it("serializes tool calls with string arguments for OpenAI-compatible", () => {
    const msgs: AiChatMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", name: "create_task", args: { title: "Milk" } }],
      },
    ];
    expect(toWireMessages(lmstudio, msgs)).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "create_task", arguments: '{"title":"Milk"}' },
          },
        ],
      },
    ]);
  });

  it("serializes tool calls with object arguments for Ollama", () => {
    const msgs: AiChatMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "call_1", name: "create_task", args: { title: "Milk" } }],
      },
    ];
    expect(toWireMessages(ollama, msgs)).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "create_task", arguments: { title: "Milk" } } }],
      },
    ]);
  });

  it("labels tool results per provider", () => {
    const msgs: AiChatMessage[] = [
      { role: "tool", content: "ok", tool_call_id: "call_1", name: "create_task" },
    ];
    expect(toWireMessages(lmstudio, msgs)[0]).toEqual({
      role: "tool",
      content: "ok",
      tool_call_id: "call_1",
    });
    expect(toWireMessages(ollama, msgs)[0]).toEqual({
      role: "tool",
      content: "ok",
      tool_name: "create_task",
    });
  });

  it("passes plain messages through unchanged", () => {
    const msgs: AiChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    expect(toWireMessages(ollama, msgs)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(toWireMessages(lmstudio, msgs)).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
  });
});

describe("extractUsage", () => {
  const ollama = { provider: "ollama" as const, url: "http://localhost:11434" };
  const openai = { provider: "openai" as const, url: "https://api.openai.com/v1" };

  it("reads Ollama eval counts", () => {
    expect(extractUsage(ollama, { prompt_eval_count: 120, eval_count: 45 })).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
    });
  });

  it("reads OpenAI usage blocks", () => {
    expect(
      extractUsage(openai, { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    ).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("computes the total when the backend omits it", () => {
    expect(extractUsage(openai, { usage: { prompt_tokens: 7, completion_tokens: 3 } })).toEqual({
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
    });
  });

  it("returns null when no counts are present", () => {
    expect(extractUsage(ollama, { message: { content: "x" }, done: false })).toBeNull();
    expect(extractUsage(openai, { choices: [{ delta: { content: "x" } }] })).toBeNull();
    expect(extractUsage(openai, { usage: {} })).toBeNull();
    expect(extractUsage(openai, { usage: null })).toBeNull();
  });
});
