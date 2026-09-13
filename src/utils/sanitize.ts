/**
 * Input sanitization utilities for security.
 */

/** Strip HTML tags and control characters from user-visible text (task titles, habit names, etc.) */
export function sanitizeTitle(input: string): string {
  if (!input) return "";
  return input
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z]+;/gi, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .substring(0, 500);
}

/** Sanitize a file/folder path component — strip traversal sequences and illegal chars */
export function sanitizePathComponent(name: string): string {
  if (!name) return "";
  return name
    .replace(/\.\./g, "")            // strip ..
    .replace(/[\\:*?"<>|]/g, "_")    // filesystem-unsafe chars
    .replace(/^\s+|\s+$/g, "")       // trim
    .substring(0, 200);
}

/** Validate that a resolved path stays within the vault root */
export function isPathSafe(path: string): boolean {
  // Normalize and check for traversal
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  let depth = 0;
  for (const part of parts) {
    if (part === "..") return false;
    if (part === ".") continue;
    depth++;
  }
  return depth > 0 && !normalized.startsWith("/");
}

/** Clamp a numeric value to a safe financial range */
export function clampAmount(value: number): number {
  if (!Number.isFinite(value) || isNaN(value)) return 0;
  return Math.max(0, Math.min(999_999_999, Math.round(value)));
}

/** Validate and clamp a rate value */
export function clampRate(value: number): number {
  if (!Number.isFinite(value) || isNaN(value)) return 0;
  return Math.max(0, Math.min(1_000_000, value));
}
