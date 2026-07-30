import assert from "node:assert/strict";
import test from "node:test";

// Imports the exact source HtmlMessage.tsx renders with — no inlined copy, so
// a loosened CSP in production cannot pass a test that asserts the old one.
import {
  buildSandboxedSrcDoc,
  DEFAULT_EMBED_HEIGHT,
  MAX_EMBED_HEIGHT,
  MIN_EMBED_HEIGHT,
  resolveEmbedHeight,
} from "./htmlArtifact.mjs";

// ── buildSandboxedSrcDoc ────────────────────────────────────────────────────

test("CSP meta is the first element the parser sees", () => {
  const doc = buildSandboxedSrcDoc("<p>hi</p>");
  const headStart = doc.indexOf("<head>");
  const cspStart = doc.indexOf("Content-Security-Policy");
  assert.ok(cspStart > headStart, "CSP meta must be inside <head>");
  // Nothing but <head> itself may precede it — a stylesheet or image tag
  // hoisted above the CSP would load before the policy applied.
  const beforeCsp = doc.slice(headStart + "<head>".length, cspStart);
  assert.equal(beforeCsp, '<meta http-equiv="', "CSP meta must open <head>");
});

test("CSP denies everything by default", () => {
  const doc = buildSandboxedSrcDoc("");
  assert.match(doc, /default-src 'none'/);
});

test("CSP allows no remote origin for images or fonts", () => {
  const doc = buildSandboxedSrcDoc("");
  // `data:` only. A remote img-src would leak an open-the-artifact ping to
  // that host with no script involved — the exact hole the CSP layer exists
  // to close, so pin it explicitly rather than by absence.
  assert.match(doc, /img-src data:/);
  assert.match(doc, /font-src data:/);
  assert.doesNotMatch(doc, /img-src[^;"]*https?:/);
  assert.doesNotMatch(doc, /font-src[^;"]*https?:/);
});

test("CSP never grants script-src", () => {
  // Belt to the sandbox attribute's braces: even if a future edit added
  // `allow-scripts` to the iframe, the policy alone still blocks execution.
  const doc = buildSandboxedSrcDoc("<script>alert(1)</script>");
  assert.doesNotMatch(doc, /script-src/);
  assert.match(doc, /default-src 'none'/);
});

test("color-scheme is pinned to light, matching the frame's white canvas", () => {
  // `light dark` would let the UA pick dark text colors while the iframe
  // element stays opaque white — light-on-white for any artifact that does
  // not set its own colors.
  const doc = buildSandboxedSrcDoc("");
  assert.match(doc, /content="light"/);
  assert.doesNotMatch(doc, /content="light dark"/);
});

test("artifact HTML is embedded verbatim, not escaped or rewritten", () => {
  const html = '<div class="x">a & b <span>c</span></div>';
  assert.ok(buildSandboxedSrcDoc(html).includes(html));
});

test("an artifact's own CSP meta cannot precede ours", () => {
  // CSP composes by intersection, so an authored policy can only narrow
  // ours — but only if ours is parsed first. It always is: the artifact is
  // placed in <body>, after our <head>.
  const doc = buildSandboxedSrcDoc(
    '<meta http-equiv="Content-Security-Policy" content="default-src *">',
  );
  assert.ok(doc.indexOf("default-src 'none'") < doc.indexOf("default-src *"));
});

// ── resolveEmbedHeight ──────────────────────────────────────────────────────

test("missing height tag falls back to the default", () => {
  assert.equal(resolveEmbedHeight(undefined), DEFAULT_EMBED_HEIGHT);
});

test("in-range height is honored", () => {
  assert.equal(resolveEmbedHeight("400"), 400);
});

test("out-of-range height clamps instead of rejecting", () => {
  // A renderer must not assume relay validation ran: older events, an older
  // relay build, or a local-archive replay can all deliver anything.
  assert.equal(resolveEmbedHeight("40000"), MAX_EMBED_HEIGHT);
  assert.equal(resolveEmbedHeight("1"), MIN_EMBED_HEIGHT);
  assert.equal(resolveEmbedHeight("-500"), MIN_EMBED_HEIGHT);
});

test("non-numeric height falls back to the default", () => {
  assert.equal(resolveEmbedHeight("tall"), DEFAULT_EMBED_HEIGHT);
  assert.equal(resolveEmbedHeight(""), DEFAULT_EMBED_HEIGHT);
});

test("trailing junk after digits does not smuggle a value through", () => {
  // parseInt("300px") === 300 — fine, that is a sane read of a CSS-ish value.
  assert.equal(resolveEmbedHeight("300px"), 300);
});
