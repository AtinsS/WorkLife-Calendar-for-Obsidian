/** Shared "AI is thinking" indicator — dual-ring accent spinner. */
export function showTypingDots(host: HTMLElement): HTMLElement {
  host.empty();
  const wrap = host.createDiv({
    cls: "ai-typing-loader",
    attr: { "aria-hidden": "true" },
  });
  return wrap;
}

/** Alias kept for call sites that prefer the semantic name. */
export const showTypingCrow = showTypingDots;
