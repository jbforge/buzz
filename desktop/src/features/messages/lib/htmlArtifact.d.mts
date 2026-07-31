/**
 * Type declarations for the pure HTML-artifact helpers in `htmlArtifact.mjs`.
 * Runtime lives in `.mjs` so the (TS-loader-less) `node:test` runner can
 * import it directly; this file gives TypeScript callers a typed view.
 */

/** Default embed height in CSS pixels when the event carries no `height` tag. */
export const DEFAULT_EMBED_HEIGHT: number;

/** Smallest embed height honored — mirrors the relay's `height` tag check. */
export const MIN_EMBED_HEIGHT: number;

/** Largest embed height honored — mirrors the relay's `height` tag check. */
export const MAX_EMBED_HEIGHT: number;

/**
 * Wrap artifact HTML in a minimal document whose first parsed element is a
 * restrictive `Content-Security-Policy` meta tag.
 */
export function buildSandboxedSrcDoc(html: string): string;

/** Resolve the `height` tag to a pixel height, clamped to the allowed range. */
export function resolveEmbedHeight(tagValue: string | undefined): number;
