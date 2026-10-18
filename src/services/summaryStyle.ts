import { tRaw } from "../i18n";

export type SummaryStyle = "brief" | "detailed" | "bullets" | "executive" | "custom";

export const SUMMARY_STYLES: SummaryStyle[] = [
  "brief",
  "detailed",
  "bullets",
  "executive",
  "custom",
];

export function normalizeSummaryStyle(v: unknown): SummaryStyle {
  return v === "brief" || v === "bullets" || v === "executive" || v === "custom"
    ? v
    : "detailed";
}

export function summaryStyleLabel(style: SummaryStyle): string {
  const key =
    style === "brief"
      ? "settings.ai.summaryStyleBrief"
      : style === "bullets"
        ? "settings.ai.summaryStyleBullets"
        : style === "executive"
          ? "settings.ai.summaryStyleExecutive"
          : style === "custom"
            ? "settings.ai.summaryStyleCustom"
            : "settings.ai.summaryStyleDetailed";
  return tRaw(key);
}

export function summaryStyleDesc(style: SummaryStyle): string {
  const key =
    style === "brief"
      ? "settings.ai.summaryStyleBriefDesc"
      : style === "bullets"
        ? "settings.ai.summaryStyleBulletsDesc"
        : style === "executive"
          ? "settings.ai.summaryStyleExecutiveDesc"
          : style === "custom"
            ? "settings.ai.summaryStyleCustomDesc"
            : "settings.ai.summaryStyleDetailedDesc";
  return tRaw(key);
}

const SUMMARY_BASE = `You are a careful note summarizer. Write ONE unified markdown summary of the ENTIRE set of notes as a single document.
Do NOT create a separate section per source file.
Do NOT list notes one by one.
Synthesize common themes, decisions, facts, and takeaways across all sources.
Return ONLY markdown (no code fences around the whole answer).
Write body text in the SAME language as the source notes.
Use the exact section headings provided below (do not translate or bilingualize them).
Preserve important names, dates, numbers.`;

export interface SummaryStyleOptions {
  style: SummaryStyle;
  /** Free-form extra instructions (applies to every style). */
  extraPrompt?: string;
  /** Required when style === "custom". */
  customStyle?: string;
}

/** Build system prompt for note-summary generation. */
export function buildSummarySystem(opts: SummaryStyleOptions): string {
  const h = {
    overview: tRaw("ai.summaryHeadings.overview"),
    keyIdeas: tRaw("ai.summaryHeadings.keyIdeas"),
    takeaways: tRaw("ai.summaryHeadings.takeaways"),
    tldr: tRaw("ai.summaryHeadings.tldr"),
    facts: tRaw("ai.summaryHeadings.facts"),
    risks: tRaw("ai.summaryHeadings.risks"),
  };
  const style = normalizeSummaryStyle(opts.style);

  let block: string;
  if (style === "custom") {
    const custom = (opts.customStyle || "").trim();
    block = custom
      ? `Style: USER-CUSTOM (follow exactly).\n${custom}`
      : `Style: DETAILED (still one shared summary).
# <short shared title>
## ${h.overview}
2–4 sentences about the whole set.
## ${h.keyIdeas}
- bullets synthesizing topics across notes
## ${h.takeaways}
- bullets`;
  } else {
    const blocks: Record<Exclude<SummaryStyle, "custom">, string> = {
      brief: `Style: BRIEF.
# <short shared title>
2–4 sentences covering the whole corpus in one flow.`,
      detailed: `Style: DETAILED (still one shared summary).
# <short shared title>
## ${h.overview}
2–4 sentences about the whole set.
## ${h.keyIdeas}
- bullets synthesizing topics across notes
## ${h.takeaways}
- bullets
Do not split sections by source note.`,
      bullets: `Style: BULLETS ONLY (one shared list).
# <short shared title>
- short factual bullets merging themes from all notes
- no per-file blocks, no long prose`,
      executive: `Style: EXECUTIVE SUMMARY (one shared brief).
# <short shared title>
## ${h.tldr}
1–2 sentences on the whole set.
## ${h.facts}
- decisions, numbers, dates, owners from any notes
## ${h.risks}
- open questions, blockers (if any)
Never separate by note.`,
    };
    block = blocks[style] || blocks.detailed;
  }

  let sys = `${SUMMARY_BASE}\n\n${block}`;
  const extraTrim = (opts.extraPrompt || "").trim();
  if (extraTrim) {
    sys += `\n\nExtra user instructions (follow them):\n${extraTrim}`;
  }
  return sys;
}
