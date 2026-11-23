/**
 * Integration tests for AiAskChat.send() — the tool-call loop must always
 * terminate, feed tool results back, honor abort, and survive HTTP-400
 * backends. The model is mocked; the tool executor runs for real against the
 * task store in the end-to-end case.
 */
import { get } from "svelte/store";
import { streamAiChat, type AiToolCall } from "../aiProvider";
import { executeChatTool } from "../aiChatTools";
import { AiAskChat } from "../AiAskChat";
import { settings } from "../../ui/stores";
import { tasks, projects } from "../../task-tracker/stores";

jest.mock("../aiProvider", () => ({
  ...(jest.requireActual("../aiProvider") as Record<string, unknown>),
  streamAiChat: jest.fn(),
}));

jest.mock("../aiChatTools", () => ({
  ...(jest.requireActual("../aiChatTools") as Record<string, unknown>),
  executeChatTool: jest.fn(),
}));

jest.mock("../aiChatStorage", () => ({
  ...(jest.requireActual("../aiChatStorage") as Record<string, unknown>),
  saveAiChatSnapshot: jest.fn().mockResolvedValue(undefined),
}));

const streamMock = streamAiChat as jest.MockedFunction<typeof streamAiChat>;
const toolExecMock = executeChatTool as jest.MockedFunction<typeof executeChatTool>;

interface SendableChat {
  mount(): void;
  prefill(text: string): void;
  send(): Promise<void>;
  isRunning: boolean;
}

function makeApp() {
  return {
    workspace: { getActiveViewOfType: () => null },
    vault: {
      getMarkdownFiles: () => [],
      cachedRead: () => Promise.resolve(""),
      getAbstractFileByPath: () => null,
    },
  } as never;
}

function makeChat(): { chat: SendableChat; root: HTMLElement } {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const chat = new AiAskChat(makeApp(), root, [], "ctx") as unknown as SendableChat;
  chat.mount();
  return { chat, root };
}

function toolCall(name: string, args: Record<string, unknown> = {}): AiToolCall {
  return { id: `call_${name}`, name, args };
}

beforeEach(() => {
  streamMock.mockReset();
  toolExecMock.mockReset();
  toolExecMock.mockResolvedValue({ output: "tool says ok" });
  tasks.set([]);
  projects.set([]);
  settings.update((s) => ({
    ...s,
    ollamaEnabled: true,
    aiWebSearchEnabled: false,
    aiChatToolsEnabled: true,
    aiChatThinking: false,
    aiChatTemperature: 0.4,
    aiChatTopP: undefined,
    aiChatMaxTokens: 0,
    aiChatSystemPrompt: "",
    ollamaContextSize: 0,
    userName: "",
    aiName: "",
    userAbout: "",
    aiTone: "",
  }));
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AiAskChat.send — plain answers", () => {
  it("returns a normal answer without touching tools and stays usable", async () => {
    streamMock.mockResolvedValueOnce("Hello!");
    const { chat } = makeChat();
    chat.prefill("hi");
    await chat.send();

    const saved = (chat as unknown as { messages: Array<{ role: string; text: string; tools?: string[] }> }).messages;
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ role: "assistant", text: "Hello!" });
    expect(saved[1].tools).toBeUndefined();
    expect(streamMock).toHaveBeenCalledTimes(1);
    // First round offers the tools…
    expect(streamMock.mock.calls[0][3]?.tools?.map((t) => t.name)).toContain("create_task");
    expect(chat.isRunning).toBe(false);

    // Chat must accept the next message (not stuck in running state).
    streamMock.mockResolvedValueOnce("Second");
    chat.prefill("again");
    await chat.send();
    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(chat.isRunning).toBe(false);
  });

  it("passes generation settings through to the provider call", async () => {
    settings.update((s) => ({
      ...s,
      aiChatTemperature: 0.9,
      aiChatTopP: 0.5,
      aiChatMaxTokens: 128,
      ollamaContextSize: 16384,
    }));
    streamMock.mockResolvedValueOnce("ok");
    const { chat } = makeChat();
    chat.prefill("hi");
    await chat.send();
    const opts = streamMock.mock.calls[0][3];
    expect(opts).toMatchObject({
      temperature: 0.9,
      topP: 0.5,
      maxTokens: 128,
      contextSize: 16384,
    });
  });

  it("appends the custom system prompt and today date", async () => {
    settings.update((s) => ({ ...s, aiChatSystemPrompt: "Always answer with a haiku." }));
    streamMock.mockResolvedValueOnce("ok");
    const { chat } = makeChat();
    chat.prefill("hi");
    await chat.send();
    const messages = streamMock.mock.calls[0][2];
    const system = String(messages[0].content);
    expect(system).toContain("Always answer with a haiku.");
    expect(system).toMatch(/Today is \d{4}-\d{2}-\d{2}/);
  });
});

describe("AiAskChat.send — tool loop", () => {
  it("runs a tool for real, feeds the result back and finishes", async () => {
    const realExecute = jest.requireActual("../aiChatTools").executeChatTool as typeof executeChatTool;
    toolExecMock.mockImplementation((app, call) => realExecute(app, call));

    // Round 1: model asks for create_task. Round 2: final text.
    streamMock
      .mockImplementationOnce((_c, _m, _msgs, opts) => {
        opts?.onToolCalls?.([toolCall("create_task", { title: "Milk from chat" })]);
        return Promise.resolve("");
      })
      .mockResolvedValueOnce("Created the task for you.");

    const { chat } = makeChat();
    chat.prefill("add a task to buy milk");
    await chat.send();

    // The task really exists in the store.
    const all = get(tasks);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Milk from chat");

    const saved = (chat as unknown as {
      messages: Array<{ role: string; text: string; tools?: string[] }>;
    }).messages;
    const answer = saved[saved.length - 1];
    expect(answer).toMatchObject({
      role: "assistant",
      text: "Created the task for you.",
      tools: ["create_task"],
    });

    // Round 2 must carry the tool result back to the model.
    expect(streamMock).toHaveBeenCalledTimes(2);
    const secondCallMessages = streamMock.mock.calls[1][2];
    expect(secondCallMessages[secondCallMessages.length - 1]).toMatchObject({
      role: "tool",
      name: "create_task",
    });
    expect(String(secondCallMessages[secondCallMessages.length - 1].content)).toContain(
      "Milk from chat",
    );
    expect(secondCallMessages[secondCallMessages.length - 2]).toMatchObject({
      role: "assistant",
      tool_calls: [toolCall("create_task", { title: "Milk from chat" })],
    });
    expect(chat.isRunning).toBe(false);
  });

  it("caps runaway tool loops at MAX_TOOL_ROUNDS batches and still answers", async () => {
    // Model calls a tool on every round that offers tools.
    streamMock
      .mockImplementation((_c, _m, _msgs, opts) => {
        if (opts?.tools?.length) {
          opts.onToolCalls?.([toolCall("list_tasks", {})]);
          return Promise.resolve("");
        }
        return Promise.resolve("final answer");
      });

    const { chat } = makeChat();
    chat.prefill("loop forever");
    await chat.send();

    // 3 tool batches + 1 final round without tools.
    expect(streamMock).toHaveBeenCalledTimes(4);
    const lastOpts = streamMock.mock.calls[3][3];
    expect(lastOpts?.tools).toBeUndefined();
    expect(toolExecMock).toHaveBeenCalledTimes(3);

    const saved = (chat as unknown as { messages: Array<{ text: string; tools?: string[] }> }).messages;
    expect(saved[saved.length - 1].text).toBe("final answer");
    expect(chat.isRunning).toBe(false);
  });

  it("drops tool calls that arrive on the final no-tools round instead of looping", async () => {
    streamMock.mockImplementation((_c, _m, _msgs, opts) => {
      // Model insists on tool calls on every round — even when none are offered.
      opts?.onToolCalls?.([toolCall("create_task", { title: "sneaky" })]);
      return Promise.resolve("done without tools");
    });
    const { chat } = makeChat();
    chat.prefill("hi");
    await chat.send();
    // 3 tool batches on tool-offering rounds; the 4th (no-tools) round must not
    // spawn another batch — its hallucinated call is dropped and the loop ends.
    expect(streamMock).toHaveBeenCalledTimes(4);
    expect(toolExecMock).toHaveBeenCalledTimes(3);
    const saved = (chat as unknown as { messages: Array<{ text: string }> }).messages;
    expect(saved[saved.length - 1].text).toBe("done without tools");
    expect(chat.isRunning).toBe(false);
  });

  it("shows the names of used tools on the answer bubble", async () => {
    streamMock
      .mockImplementationOnce((_c, _m, _o, opts) => {
        opts?.onToolCalls?.([toolCall("list_tasks", {})]);
        return Promise.resolve("");
      })
      .mockResolvedValueOnce("You have nothing planned.");
    const { chat, root } = makeChat();
    chat.prefill("what is planned?");
    await chat.send();
    const caption = root.querySelector(".ai-ask-msg-tools");
    expect(caption?.textContent).toContain("list_tasks");
  });

  it("still renders a bubble when the model answers with text only after tools", async () => {
    streamMock
      .mockImplementationOnce((_c, _m, _o, opts) => {
        opts?.onToolCalls?.([toolCall("list_tasks", {})]);
        return Promise.resolve("");
      })
      .mockResolvedValueOnce("");
    const { chat, root } = makeChat();
    chat.prefill("hi");
    await chat.send();
    // No eternal typing dots — a real placeholder instead.
    expect(root.querySelectorAll(".ai-typing-loader")).toHaveLength(0);
    expect(root.querySelector(".ai-ask-msg-body")?.textContent).toBeTruthy();
    expect(chat.isRunning).toBe(false);
  });
});

describe("AiAskChat.send — token usage", () => {
  it("sums usage across tool rounds and renders message + session captions", async () => {
    toolExecMock.mockResolvedValue({ output: "tool says ok" });
    let round = 0;
    streamMock.mockImplementation((_c, _m, _msgs, opts) => {
      round += 1;
      opts?.onUsage?.({
        promptTokens: round * 10,
        completionTokens: round,
        totalTokens: round * 10 + round,
      });
      if (round === 1) {
        opts?.onToolCalls?.([toolCall("list_tasks", {})]);
        return Promise.resolve("");
      }
      return Promise.resolve("All set.");
    });

    const { chat, root } = makeChat();
    chat.prefill("hi");
    await chat.send();

    const saved = (chat as unknown as {
      messages: Array<{ usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }>;
    }).messages;
    // Round 1: 10+1=11, round 2: 20+2=22 → totals summed.
    expect(saved[saved.length - 1].usage).toEqual({
      promptTokens: 30,
      completionTokens: 3,
      totalTokens: 33,
    });

    const msgCaption = root.querySelector(".ai-ask-msg-usage");
    expect(msgCaption?.textContent).toContain("33");
    expect(msgCaption?.getAttribute("title")).toContain("30");
    expect(msgCaption?.getAttribute("title")).toContain("3");

    const counter = root.querySelector(".ai-ask-tokens-text");
    expect(counter?.textContent).toContain("33");
  });

  it("keeps a running session total over several messages and resets on new chat", async () => {
    streamMock.mockImplementation((_c, _m, _o, opts) => {
      opts?.onUsage?.({ promptTokens: 40, completionTokens: 10, totalTokens: 50 });
      return Promise.resolve("answer");
    });
    const { chat, root } = makeChat();
    chat.prefill("one");
    await chat.send();
    chat.prefill("two");
    await chat.send();
    expect(root.querySelector(".ai-ask-tokens-text")?.textContent).toContain("100");

    // New chat drops the history and the total with it.
    const barButtons = root.querySelectorAll(".ai-ask-bar-btn");
    // "New chat" is the first ghost button in the bar.
    (barButtons[0] as HTMLButtonElement).click();
    expect(root.querySelector(".ai-ask-tokens-text")?.textContent).toContain("—");
    expect(chat.isRunning).toBe(false);
  });

  it("shows the idle placeholder before any usage is known", async () => {
    streamMock.mockResolvedValueOnce("no usage reported");
    const { chat, root } = makeChat();
    chat.prefill("hi");
    await chat.send();
    expect(root.querySelector(".ai-ask-msg-usage")).toBeNull();
    expect(root.querySelector(".ai-ask-tokens-text")?.textContent).toContain("—");
  });
});

describe("AiAskChat.send — failure paths", () => {
  it("retries once without tools when the backend rejects them (HTTP 400)", async () => {
    streamMock
      .mockRejectedValueOnce(new Error("OLLAMA HTTP 400: tool support missing"))
      .mockResolvedValueOnce("plain answer");
    const { chat } = makeChat();
    chat.prefill("hi");
    await chat.send();

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(streamMock.mock.calls[0][3]?.tools).toBeDefined();
    expect(streamMock.mock.calls[1][3]?.tools).toBeUndefined();
    const saved = (chat as unknown as { messages: Array<{ text: string }> }).messages;
    expect(saved[saved.length - 1].text).toBe("plain answer");
    expect(chat.isRunning).toBe(false);
  });

  it("does not swallow non-tool errors and recovers for the next message", async () => {
    streamMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { chat, root } = makeChat();
    chat.prefill("hi");
    await chat.send();
    expect(root.querySelector(".ai-ask-status.error")).toBeTruthy();
    expect(chat.isRunning).toBe(false);

    streamMock.mockResolvedValueOnce("recovered");
    chat.prefill("again");
    await chat.send();
    const saved = (chat as unknown as { messages: Array<{ text: string }> }).messages;
    expect(saved[saved.length - 1].text).toBe("recovered");
  });

  it("aborts a hanging request via the Stop button without freezing the chat", async () => {
    streamMock.mockImplementation((_c, _m, _o, opts) => {
      return new Promise((_resolve, reject) => {
        const err = new DOMException("Aborted", "AbortError");
        if (opts?.signal?.aborted) {
          reject(err);
          return;
        }
        opts?.signal?.addEventListener("abort", () => reject(err), { once: true });
      });
    });
    const { chat, root } = makeChat();
    chat.prefill("hang please");
    const pending = chat.send();
    // Let the request start, then hit Stop (same handler as the button).
    await new Promise((r) => window.setTimeout(r, 0));
    (root.querySelector(".ai-ask-send") as HTMLButtonElement | null)?.click();
    await pending;

    expect(chat.isRunning).toBe(false);
    expect(root.querySelector(".ai-ask-status.error")).toBeFalsy();
    // Chat is usable afterwards.
    streamMock.mockResolvedValueOnce("alive");
    chat.prefill("still there?");
    await chat.send();
    const saved = (chat as unknown as { messages: Array<{ text: string }> }).messages;
    expect(saved[saved.length - 1].text).toBe("alive");
  });

  it("stops the tool loop mid-way when aborted between rounds", async () => {
    let call = 0;
    streamMock.mockImplementation((_c, _m, _o, opts) => {
      call += 1;
      if (call === 1) {
        opts?.onToolCalls?.([toolCall("list_tasks", {})]);
        return Promise.resolve("");
      }
      return new Promise((_resolve, reject) => {
        const err = new DOMException("Aborted", "AbortError");
        if (opts?.signal?.aborted) {
          reject(err);
          return;
        }
        opts?.signal?.addEventListener("abort", () => reject(err), { once: true });
      });
    });
    const { chat, root } = makeChat();
    chat.prefill("hi");
    const pending = chat.send();
    await new Promise((r) => window.setTimeout(r, 0));
    (root.querySelector(".ai-ask-send") as HTMLButtonElement | null)?.click();
    await pending;
    expect(chat.isRunning).toBe(false);
    expect(root.querySelector(".ai-ask-status.error")).toBeFalsy();
  });
});
