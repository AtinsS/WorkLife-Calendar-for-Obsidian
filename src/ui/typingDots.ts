/**
 * Shared "AI is working" indicator — dual-ring accent spinner.
 * Model name is a quiet caption (like .ai-status) placed ABOVE the answer
 * field — never inside it and never beside the loader.
 */
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

/**
 * Quiet «model» caption in .ai-status style.
 * Render it in a slot ABOVE the answer field, not inside the field.
 */
export function showModelCaption(host: HTMLElement, model?: string): HTMLElement {
  host.empty();
  const label = (model || "").trim();
  const el = host.createDiv({ cls: "ai-model-caption" });
  if (label) {
    el.createSpan({ text: label, cls: "ai-model-caption-name" });
  }
  return el;
}

/**
 * Centered loading spinner inside a large output field.
 * `captionHost` (optional) gets the model label ABOVE the field.
 * NOT used in the chat.
 */
export function mountTypingBlock(
  fieldHost: HTMLElement,
  model?: string,
  captionHost?: HTMLElement | null,
): HTMLElement {
  if (captionHost) {
    showModelCaption(captionHost, model);
  }
  fieldHost.empty();
  const box = fieldHost.createDiv({ cls: "ai-typing-center" });
  showTypingDots(box.createDiv({ cls: "ai-typing-center-spinner" }));
  return box;
}
