/**
 * Pure helpers for rendering kind:40009 HTML artifacts.
 *
 * Lives in `.mjs` (not `.ts`) so the test runner (`node --test`, no TS
 * loader) can import the same source the renderer uses. TypeScript callers
 * get typed access via the sibling `.d.mts`.
 *
 * The security model is layered, and this file is only the second layer:
 *
 *   1. The `<iframe sandbox>` attribute (set by `HtmlMessage.tsx`, never by
 *      the event) is what actually stops scripts. With no `allow-scripts`
 *      token, `<script>` never executes and `onclick=` never fires, so the
 *      artifact cannot reach the parent document, the Tauri IPC bridge, or
 *      any other frame — regardless of what the HTML says.
 *   2. The CSP prepended here stops *passive* loads: a `<img src=…>` or
 *      `background-image: url(…)` pointing at a remote host would otherwise
 *      leak "this person opened this artifact" to that host without any
 *      script at all. `default-src 'none'` closes that; `data:` images and
 *      fonts still work, so self-contained pages render fully.
 *
 * Neither layer parses the HTML. Sanitizing untrusted markup by rewriting it
 * is a losing game; denying the capabilities is not.
 *
 * Known gap: layer 2 covers passive loads only. A sandboxed frame may still
 * navigate *itself*, so a link wrapping the artifact sends a click to a remote
 * host — and the destination document does not inherit this CSP. Closing that
 * needs a host-document `frame-src` policy, which is an app-wide setting, not
 * something this file can reach. See docs/nips/NIP-HE.md § "Known gap:
 * click-driven navigation"; e2e test 05 pins the current behaviour.
 */

/** Default embed height in CSS pixels when the event carries no `height` tag. */
export const DEFAULT_EMBED_HEIGHT = 320;

/** Smallest embed height honored — mirrors the relay's `height` tag check. */
export const MIN_EMBED_HEIGHT = 80;

/** Largest embed height honored — mirrors the relay's `height` tag check. */
export const MAX_EMBED_HEIGHT = 1200;

const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="' +
  [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    "form-action 'none'",
  ].join("; ") +
  '">';

/**
 * Wrap artifact HTML in a minimal document whose first parsed element is our
 * CSP meta.
 *
 * The artifact is embedded as the body of a document we author, rather than
 * having its own markup prepended to, for one reason: a `<meta>` CSP only
 * applies to what the parser sees *after* it. If the artifact opened with its
 * own `<!DOCTYPE html><html><head>` and we merely stuck our meta in front, the
 * parser would still honor the CSP, but any authored `<meta http-equiv>` in
 * the artifact's own head could not loosen ours (CSP composes by
 * intersection) — so the wrapper costs nothing and removes the question of
 * whether the artifact's own document structure got there first.
 *
 * @param {string} html Raw artifact source from the event content.
 * @returns {string} A complete document suitable for an iframe `srcdoc`.
 */
export function buildSandboxedSrcDoc(html) {
  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    CSP_META,
    // Pinned to light, not `light dark`. The frame is painted on an opaque
    // white canvas (see HtmlMessage.tsx), so letting the UA flip to dark text
    // colors would put light text on white for any artifact that does not set
    // its own colors. An artifact that wants to be dark styles itself.
    '<meta name="color-scheme" content="light">',
    "</head>",
    "<body>",
    html,
    "</body>",
    "</html>",
  ].join("");
}

/**
 * Resolve the `height` tag to a usable pixel height.
 *
 * The relay already rejects out-of-range values, but a renderer must not
 * trust that: events predating the check, a relay running an older build, or
 * a local archive replay can all deliver anything. Clamp rather than reject —
 * a too-tall artifact should still render, just not at 40,000 pixels.
 *
 * @param {string | undefined} tagValue Raw `height` tag value, if present.
 * @returns {number} Height in CSS pixels, always within the allowed range.
 */
export function resolveEmbedHeight(tagValue) {
  if (tagValue === undefined) return DEFAULT_EMBED_HEIGHT;

  const parsed = Number.parseInt(tagValue, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_EMBED_HEIGHT;

  return Math.min(MAX_EMBED_HEIGHT, Math.max(MIN_EMBED_HEIGHT, parsed));
}
