import {
  resolveAiConnection,
  applyThinkDirective,
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
