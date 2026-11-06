import { resolveModel, type ModelRole } from "../OllamaService";

describe("resolveModel", () => {
  it("reason always uses the main model", () => {
    expect(
      resolveModel("reason", { ollamaModel: "llama3.1:8b", ollamaModelMode: "dual", ollamaModelExtract: "qwen2.5:3b" }),
    ).toBe("llama3.1:8b");
  });

  it("extract falls back to main in single mode", () => {
    expect(
      resolveModel("extract", { ollamaModel: "llama3.1:8b", ollamaModelMode: "single", ollamaModelExtract: "qwen2.5:3b" }),
    ).toBe("llama3.1:8b");
  });

  it("extract uses its own model in dual mode", () => {
    expect(
      resolveModel("extract", { ollamaModel: "llama3.1:8b", ollamaModelMode: "dual", ollamaModelExtract: "qwen2.5:3b" }),
    ).toBe("qwen2.5:3b");
  });

  it("extract falls back to main when its model is empty in dual mode", () => {
    expect(
      resolveModel("extract", { ollamaModel: "llama3.1:8b", ollamaModelMode: "dual", ollamaModelExtract: "  " }),
    ).toBe("llama3.1:8b");
  });

  it("falls back to default when main model is empty", () => {
    expect(resolveModel("reason", {})).toBe("llama3.1");
    expect(resolveModel("extract", { ollamaModelMode: "dual", ollamaModelExtract: "" })).toBe("llama3.1");
  });

  it("defaults to single mode when mode is unset", () => {
    expect(resolveModel("extract", { ollamaModel: "a", ollamaModelExtract: "b" })).toBe("a");
  });

  it("covers both roles", () => {
    const roles: ModelRole[] = ["reason", "extract"];
    for (const role of roles) {
      expect(typeof resolveModel(role, {})).toBe("string");
    }
  });

  it("lmstudio uses its own model names, not the ollama ones", () => {
    expect(
      resolveModel("reason", {
        aiProvider: "lmstudio",
        lmstudioModel: "qwen/qwen3-4b",
        ollamaModel: "llama3.1:8b",
      }),
    ).toBe("qwen/qwen3-4b");
  });

  it("lmstudio extract falls back to lmstudio main in dual mode", () => {
    expect(
      resolveModel("extract", {
        aiProvider: "lmstudio",
        lmstudioModel: "qwen/qwen3-4b",
        lmstudioModelExtract: "",
        ollamaModelExtract: "qwen2.5:3b",
        ollamaModelMode: "dual",
      }),
    ).toBe("qwen/qwen3-4b");
  });

  it("lmstudio has no llama3.1 fallback when unset", () => {
    expect(resolveModel("reason", { aiProvider: "lmstudio" })).toBe("");
    expect(resolveModel("reason", { aiProvider: "lmstudio", lmstudioModel: "  " })).toBe("");
  });

  it("ollama path is unchanged when provider is unset", () => {
    expect(resolveModel("reason", { ollamaModel: "a" })).toBe("a");
    expect(resolveModel("reason", { aiProvider: "ollama", ollamaModel: "a" })).toBe("a");
  });
});
