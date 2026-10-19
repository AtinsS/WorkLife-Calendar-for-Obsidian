import { requestUrl } from "obsidian";
import { errorMessage } from "../utils/sanitize";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  ok: boolean;
  results: WebSearchResult[];
  error?: string;
  /** Which backend produced the hits (for diagnostics). */
  source?: string;
}

/**
 * How the current model can reach the internet.
 * - "native": model/tool-calling stack browses on its own (not used by Ollama chat API)
 * - "plugin": model has no network — the plugin must fetch and inject context
 * - "unknown": unrecognized provider — default to plugin-side search
 */
export type ModelInternetSupport = "native" | "plugin" | "unknown";

/**
 * Ollama's `/api/chat` gives the model no network, tools, or browsing.
 * Even remote Ollama hosts only run inference — the model itself cannot fetch URLs.
 * Therefore chat web-search is always plugin-side for this stack.
 */
export function analyzeModelInternetSupport(opts: {
  ollamaUrl?: string;
  ollamaModel?: string;
}): { support: ModelInternetSupport; reason: string } {
  const url = (opts.ollamaUrl || "").trim().toLowerCase();
  const model = (opts.ollamaModel || "").trim();

  // Explicit non-Ollama / OpenAI-compatible gateways are still chat-completion
  // only in this plugin — no tool-calling loop is implemented.
  if (url && !url.includes("11434") && !url.includes("ollama")) {
    return {
      support: "plugin",
      reason: "Endpoint is not local Ollama; this plugin still has no native tool loop, so search runs in the plugin.",
    };
  }

  return {
    support: "plugin",
    reason: model
      ? `Ollama model "${model}" is inference-only (no browsing). Search is fetched by the plugin and injected as context.`
      : "Ollama models are inference-only (no browsing). Search is fetched by the plugin and injected as context.",
  };
}

/** Conversational fillers that must not become a search query. */
const FILLER_RE =
  /^(как тебе|как тебе идея|что думаешь|что скажешь|стоит ли|стоит|хорошо|ок|окей|ага|угу|спасибо|привет|пока|и|а|но|или|ну|вот|это|то есть|да|нет|ладно|понял|принято|го|давай|интересно|неплохо|норм|супер|класс)[\s!?.…]*$/i;

const STOPWORDS = new Set([
  "как", "тебе", "тебя", "мне", "я", "мы", "вы", "он", "она", "оно", "они",
  "это", "этот", "эта", "эти", "тот", "та", "те", "вот", "тут", "там",
  "что", "чего", "чем", "чтобы", "ли", "же", "бы", "был", "была", "было",
  "есть", "нет", "не", "ни", "а", "и", "или", "но", "да", "нет", "ну",
  "стоит", "может", "можно", "нужно", "надо", "хочу", "хочется",
  "идея", "идеи", "идею", "идеей", "вопрос", "ответ", "пожалуйста",
  "the", "a", "an", "is", "are", "was", "were", "do", "does", "did",
  "what", "how", "why", "when", "where", "who", "which", "this", "that",
  "it", "its", "of", "to", "in", "on", "for", "and", "or", "but", "if",
  "can", "could", "should", "would", "you", "your", "my", "our", "me",
]);

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`>()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Meaningful content words (length ≥ 3, not stopwords), lowercased. */
export function extractKeywords(text: string, limit = 12): string[] {
  const words = stripMarkdown(text.toLowerCase())
    .split(/[\s,.;:!?/\\|+"'«»()]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Build a search query that respects conversation + note topic.
 * - Pure chit-chat («как тебе идея?») does NOT become a query by itself.
 * - The note/context keywords carry the actual subject.
 * - A real question’s content words win over fillers.
 * Returns "" when nothing worth searching — caller should skip the web lookup.
 */
export function buildSearchQuery(
  message: string,
  noteContext?: string,
  history?: string,
  maxLen = 180,
): string {
  const msg = stripMarkdown(message);
  if (!msg) return "";

  const firstLine = msg.split(/\n/)[0] ?? msg;
  const isFiller = FILLER_RE.test(firstLine.trim()) || firstLine.trim().length < 12;

  const msgKeywords = extractKeywords(firstLine, 10);
  const noteKeywords = extractKeywords(noteContext || "", 10);
  const histKeywords = extractKeywords(history || "", 6);

  // Content words of the user’s actual question, in original order
  let primary = msgKeywords;
  if (isFiller || msgKeywords.length === 0) {
    // Short/chit-chat message — fall back to the note + chat topic
    primary = [...noteKeywords, ...histKeywords];
  } else {
    // Real question: still ground it in the note so «как тебе идея»
    // about meal planning searches for meal planning, not the phrase.
    const merged = [...msgKeywords];
    for (const k of [...noteKeywords, ...histKeywords]) {
      if (!merged.includes(k)) merged.push(k);
    }
    primary = merged;
  }

  if (primary.length === 0) return "";

  // Prefer a natural phrase: original question if it has substance,
  // otherwise keyword list.
  if (!isFiller && msgKeywords.length >= 2 && msg.length <= maxLen) {
    // Keep the question but drop pure filler words for a tighter query
    const tight = firstLine
      .split(/\s+/)
      .filter((w) => {
        const bare = w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, "");
        return bare.length === 0 || !STOPWORDS.has(bare) || /\d/.test(w);
      })
      .join(" ")
      .trim();
    if (tight.length >= 12) {
      const withTopic = noteKeywords.slice(0, 3).some((k) => !msg.toLowerCase().includes(k))
        ? `${tight} ${noteKeywords.slice(0, 3).join(" ")}`
        : tight;
      return withTopic.slice(0, maxLen).trim();
    }
  }

  return primary.slice(0, 10).join(" ").slice(0, maxLen).trim();
}

const decodeHtml = (s: string): string =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function resolveUrl(href: string): string {
  try {
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg?.[1]) return decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) return `https:${href}`;
    return href;
  } catch {
    return href;
  }
}

/** Parse DuckDuckGo HTML (`html.duckduckgo.com`) results. */
export function parseDdgHtml(html: string, max = 5): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();

  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const hits: Array<{ url: string; title: string; index: number; end: number }> = [];
  for (const m of html.matchAll(linkRe)) {
    const url = resolveUrl(decodeHtml(m[1] || ""));
    const title = decodeHtml(m[2] || "");
    if (!url || !title || url.includes("duckduckgo.com")) continue;
    hits.push({ url, title, index: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }

  const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);

    const nextIndex = i + 1 < hits.length ? hits[i + 1].index : html.length;
    const region = html.slice(hit.end, nextIndex);
    const snipMatch = region.match(snippetRe);
    const snippet = snipMatch ? decodeHtml(snipMatch[1] || "") : "";

    results.push({ title: hit.title, url: hit.url, snippet });
    if (results.length >= max) break;
  }

  return results;
}

/** Parse DuckDuckGo Lite (`lite.duckduckgo.com`) results. */
export function parseDdgLite(html: string, max = 5): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();

  // <a rel="nofollow" href="URL" class="result-link">TITLE</a>
  // … <td class="result-snippet">SNIPPET</td>
  const linkRe =
    /<a[^>]+href="([^"]+)"[^>]*class="[^"]*result-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const linkReAlt =
    /<a[^>]+class="[^"]*result-link[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  const hits: Array<{ url: string; title: string; end: number }> = [];
  const collect = (re: RegExp) => {
    for (const m of html.matchAll(re)) {
      const url = resolveUrl(decodeHtml(m[1] || ""));
      const title = decodeHtml(m[2] || "");
      if (!url || !title || url.includes("duckduckgo.com")) continue;
      if (seen.has(`h:${url}`)) continue;
      seen.add(`h:${url}`);
      hits.push({ url, title, end: (m.index ?? 0) + m[0].length });
    }
  };
  collect(linkRe);
  if (hits.length === 0) collect(linkReAlt);

  const snippetRe = /class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i;

  for (const hit of hits) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    const region = html.slice(hit.end, hit.end + 800);
    const snip = region.match(snippetRe);
    results.push({
      title: hit.title,
      url: hit.url,
      snippet: snip ? decodeHtml(snip[1] || "") : "",
    });
    if (results.length >= max) break;
  }

  return results;
}

/**
 * Wikipedia OpenSearch as a reliable keyless fallback.
 * Returns results with the wiki article as snippet source.
 */
export async function searchWikipedia(
  query: string,
  max = 5,
  lang: "ru" | "en" = "ru",
): Promise<WebSearchResult[]> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
    query,
  )}&limit=${max}&namespace=0&format=json`;

  const resp = await requestUrl({ url, method: "GET", throw: false });
  if (resp.status !== 200) throw new Error(`Wikipedia HTTP ${resp.status}`);
  // [query, titles[], descriptions[], urls[]]
  const data = resp.json as [string, string[], string[], string[]];
  const titles = data?.[1] ?? [];
  const descs = data?.[2] ?? [];
  const urls = data?.[3] ?? [];
  const out: WebSearchResult[] = [];
  for (let i = 0; i < titles.length && out.length < max; i++) {
    out.push({
      title: titles[i],
      url: urls[i] || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(titles[i])}`,
      snippet: descs[i] || "",
    });
  }
  return out;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  // requestUrl is the reliable path inside Obsidian (bypasses CORS).
  // Try it first; window.fetch only as a fallback that supports AbortSignal.
  try {
    const resp = await requestUrl({
      url,
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
      },
      throw: false,
    });
    if (resp.status === 200 && resp.text && resp.text.length > 200) {
      return resp.text;
    }
    if (resp.status !== 200) {
      throw new Error(`HTTP ${resp.status}`);
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    // continue to fetch fallback
  }

  if (typeof window.fetch !== "function") {
    throw new Error("requestUrl failed and fetch unavailable");
  }
  const resp = await window.fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
    },
    signal,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}

/**
 * Search the web. Tries several HTML backends, then Wikipedia.
 * All keyless — works offline-of-config, may be blocked by some networks.
 */
export async function searchWeb(
  query: string,
  max = 5,
  signal?: AbortSignal,
): Promise<WebSearchResponse> {
  const q = query.trim();
  if (!q) return { ok: false, results: [], error: "Empty query" };

  const htmlBackends: Array<{
    name: string;
    url: string;
    parse: (html: string, max: number) => WebSearchResult[];
  }> = [
    {
      name: "duckduckgo-html",
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
      parse: parseDdgHtml,
    },
    {
      name: "duckduckgo-lite",
      url: `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
      parse: parseDdgLite,
    },
    {
      name: "duckduckgo-post",
      url: `https://html.duckduckgo.com/html/`,
      parse: parseDdgHtml,
    },
  ];

  const errors: string[] = [];

  for (const backend of htmlBackends) {
    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      let html = "";
      if (backend.name === "duckduckgo-post") {
        // Some networks block GET but allow the POST form endpoint
        const resp = await requestUrl({
          url: backend.url,
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "text/html",
          },
          body: `q=${encodeURIComponent(q)}`,
          throw: false,
        });
        if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
        html = resp.text;
      } else {
        html = await fetchHtml(backend.url, signal);
      }

      const results = backend.parse(html, max);
      if (results.length > 0) {
        return { ok: true, results, source: backend.name };
      }
      errors.push(`${backend.name}: no results`);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      errors.push(`${backend.name}: ${errorMessage(e)}`);
    }
  }

  // Wikipedia fallback — almost always reachable
  for (const lang of ["ru", "en"] as const) {
    try {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const wiki = await searchWikipedia(q, max, lang);
      if (wiki.length > 0) {
        return { ok: true, results: wiki, source: `wikipedia-${lang}` };
      }
      errors.push(`wikipedia-${lang}: no results`);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      errors.push(`wikipedia-${lang}: ${errorMessage(e)}`);
    }
  }

  return {
    ok: false,
    results: [],
    error: errors.join(" | ") || "No results",
  };
}

/** Format search hits as a prompt block. */
export function formatSearchContext(results: WebSearchResult[], query?: string): string {
  if (results.length === 0) return "";
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const qLine = query ? `\nQuery used: "${query}"` : "";
  const lines = results.map(
    (r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`,
  );
  return `### LIVE web search results (fetched ${stamp} by the host app — treat as current, real sources)${qLine}\n${lines.join("\n")}`;
}
