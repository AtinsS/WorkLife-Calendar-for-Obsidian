import {
  analyzeModelInternetSupport,
  buildSearchPlanPrompt,
  buildSearchQuery,
  extractKeywords,
  formatSearchContext,
  parseDdgHtml,
  parseDdgLite,
  parseSearchPlan,
} from "../webSearch";

describe("analyzeModelInternetSupport", () => {
  it("marks Ollama models as plugin-side (no native browsing)", () => {
    const r = analyzeModelInternetSupport({
      ollamaUrl: "http://localhost:11434",
      ollamaModel: "llama3.1",
    });
    expect(r.support).toBe("plugin");
    expect(r.reason).toContain("llama3.1");
  });

  it("still uses plugin search for remote endpoints (no tool loop)", () => {
    const r = analyzeModelInternetSupport({
      ollamaUrl: "https://api.example.com",
      ollamaModel: "some-model",
    });
    expect(r.support).toBe("plugin");
    expect(r.reason).toContain("tool");
  });
});

describe("extractKeywords", () => {
  it("drops stopwords and short words", () => {
    const k = extractKeywords("Как тебе идея про планирование питания и меню?");
    expect(k).toContain("планирование");
    expect(k).toContain("питания");
    expect(k).not.toContain("как");
    expect(k).not.toContain("тебе");
    expect(k).not.toContain("идея");
  });
});

describe("buildSearchQuery", () => {
  it("does NOT search the literal chit-chat «как тебе идея»", () => {
    const q = buildSearchQuery(
      "Как тебе идея?",
      "Приложение для планирования питания и составления меню на неделю",
    );
    expect(q.toLowerCase()).not.toMatch(/^как тебе идея$/);
    expect(q.toLowerCase()).toContain("питан");
  });

  it("uses note topic when the message is filler only", () => {
    const q = buildSearchQuery("ага", "MyFitnessPal альтернатива для подсчёта калорий");
    expect(q.length).toBeGreaterThan(5);
    expect(q.toLowerCase()).toContain("myfitnesspal");
  });

  it("keeps a real question and grounds it in the note", () => {
    const q = buildSearchQuery(
      "Стоит ли покупать iPhone 17 в 2026 году?",
      "сравнение смартфонов",
    );
    expect(q.toLowerCase()).toContain("iphone");
  });

  it("returns empty when there is nothing to search", () => {
    expect(buildSearchQuery("ок", "")).toBe("");
  });

  it("strips markdown noise", () => {
    const q = buildSearchQuery("**важно**: найти `лут` по `X` для рендера", "three.js");
    expect(q).not.toContain("*");
    expect(q).not.toContain("`");
    expect(q.length).toBeGreaterThan(0);
  });
});

describe("parseDdgHtml", () => {
  it("extracts title/url/snippet and decodes uddg links", () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=x">Example Title</a>
        <a class="result__snippet" href="x">Snippet text here</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://other.org/a">Other</a>
        <a class="result__snippet" href="x">Second snippet</a>
      </div>
    `;
    const results = parseDdgHtml(html, 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Example Title");
    expect(results[0].url).toBe("https://example.com/page");
    expect(results[0].snippet).toBe("Snippet text here");
    expect(results[1].url).toBe("https://other.org/a");
  });

  it("skips duckduckgo internal links", () => {
    const html = `<a class="result__a" href="https://duckduckgo.com/y.js">Ads</a>`;
    expect(parseDdgHtml(html)).toHaveLength(0);
  });
});

describe("parseDdgLite", () => {
  it("extracts lite results with snippets", () => {
    const html = `
      <a rel="nofollow" href="https://example.com/x" class="result-link">Title X</a>
      <td class="result-snippet">Snip X</td>
      <a rel="nofollow" href="https://other.org/y" class="result-link">Title Y</a>
      <td class="result-snippet">Snip Y</td>
    `;
    const results = parseDdgLite(html, 5);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Title X");
    expect(results[0].url).toBe("https://example.com/x");
    expect(results[0].snippet).toBe("Snip X");
  });
});

describe("formatSearchContext", () => {
  it("formats numbered sources", () => {
    const block = formatSearchContext(
      [{ title: "T", url: "https://u", snippet: "S" }],
      "питание меню",
    );
    expect(block).toContain("LIVE web search results");
    expect(block).toContain("https://u");
    expect(block).toContain("S");
    expect(block).toContain("питание меню");
  });

  it("returns empty string when no results", () => {
    expect(formatSearchContext([])).toBe("");
  });
});

describe("parseSearchPlan", () => {
  it("parses a plain JSON plan", () => {
    expect(parseSearchPlan('{"search": true, "queries": ["iphone 17 review"]}')).toEqual({
      search: true,
      queries: ["iphone 17 review"],
    });
  });

  it("tolerates prose and markdown fences around the JSON", () => {
    const plan = parseSearchPlan(
      'Sure! Here is the plan:\n```json\n{"search": false, "queries": []}\n```',
    );
    expect(plan).toEqual({ search: false, queries: [] });
  });

  it("caps queries at 2 and drops empties", () => {
    const plan = parseSearchPlan(
      '{"search": true, "queries": ["a b c", "d e f", "g h i", "  "]}',
    );
    expect(plan?.queries).toEqual(["a b c", "d e f"]);
  });

  it("returns null on non-JSON garbage", () => {
    expect(parseSearchPlan("I think we should search the web.")).toBeNull();
  });

  it("returns null when search is missing or not boolean", () => {
    expect(parseSearchPlan('{"queries": ["x"]}')).toBeNull();
    expect(parseSearchPlan('{"search": "yes", "queries": ["x"]}')).toBeNull();
  });

  it("keeps search:false with stray queries sanitized to a list", () => {
    const plan = parseSearchPlan('{"search": false, "queries": ["leftover"]}');
    expect(plan).toEqual({ search: false, queries: ["leftover"] });
  });
});

describe("buildSearchPlanPrompt", () => {
  it("includes the question and trims long context", () => {
    const prompt = buildSearchPlanPrompt(
      "Стоит ли покупать iPhone 17?",
      `### note.md\n${"x".repeat(2000)}`,
      `user: привет\n${"y".repeat(2000)}`,
    );
    expect(prompt).toContain("Стоит ли покупать iPhone 17?");
    expect(prompt).toContain("Note/topic context");
    // note head is capped at 600 chars
    expect(prompt.length).toBeLessThan(4000);
  });

  it("marks missing context as (none)", () => {
    const prompt = buildSearchPlanPrompt("привет");
    expect(prompt).toContain("(none)");
  });
});
