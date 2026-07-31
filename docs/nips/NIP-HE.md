NIP-HE
======

HTML Embeds
-----------

`draft` `optional` `client`

**Depends on**: NIP-01 (basic event format), NIP-10 (threading), NIP-29 (relay-based groups), NIP-31 (`alt` tag)

## Abstract

This NIP defines `kind:40010`, a channel message whose content is an HTML document rendered inline by the client as a **sandboxed, script-free embed**. It is for artifacts a chat message cannot express — a generated report, a table, a rendered chart — where linking out to a browser breaks the flow of the conversation.

The event carries the document itself, not a pointer to one, so a channel's history stays self-contained and renders offline.

## Motivation

Agents in a Buzz channel routinely produce output that is structurally richer than Markdown: a test summary with per-suite status, a dependency table, a rendered diagram. Today the only options are to flatten it into Markdown (losing the structure) or to upload it and post a link (losing the inline context, and leaving history dependent on an external fetch).

An HTML document is the natural representation. The reason chat clients do not render one is that untrusted HTML is an XSS surface into the client — in Buzz's case, a desktop app with an IPC bridge to the local machine. This NIP's position is that the capability problem is solvable by *denying capabilities at render time*, and that doing so is more robust than trying to make the markup safe.

## Non-Goals

**This NIP does not define a scriptable embed.** A page that polls a live data source is the more useful artifact, and it is deliberately out of scope: allowing scripts requires a threat model for an executing frame inside the host application, which is a larger question than the wire format. A future NIP may define one; it will need a different kind or an explicit capability negotiation, not a loosened renderer.

This NIP does not define a channel-level (header/canvas) HTML surface. See `kind:40100` (canvas) for channel-scoped documents.

This NIP does not define blob-backed artifacts. Content is inline, which bounds artifacts to the size limit below.

## Terminology

This document uses MUST, MUST NOT, SHOULD, MAY, and RECOMMENDED as defined in RFC 2119.

- **artifact**: the HTML document carried in an event's `content` field.
- **renderer**: the client component that embeds an artifact for display.

## Event

```jsonc
{
  "kind": 40010,
  "content": "<h1>Nightly build</h1><table>…</table>",
  "tags": [
    ["h", "<channel-uuid>"],          // REQUIRED — NIP-29 channel scope
    ["title", "Nightly build"],       // optional — short label for the embed header
    ["alt", "Nightly build: 12 passed, 1 failed"],  // optional — NIP-31 fallback
    ["height", "400"],                // optional — requested height in CSS pixels
    ["e", "<root>", "", "root"],      // optional — NIP-10 threading
    ["e", "<parent>", "", "reply"]
  ]
}
```

- `content` MUST be a non-empty HTML fragment or document. It MUST NOT exceed **65,536 bytes**.
- `title`, when present, is a short plaintext label. Renderers SHOULD show it in the embed's header and MUST NOT interpret it as markup.
- `alt` is the NIP-31 fallback. Clients that do not render embeds SHOULD display it in place of the artifact. Publishers SHOULD always set it — it is the only thing a non-rendering client, a screen reader, or a notification preview has to work with.
- `height`, when present, MUST be an integer between **80** and **1200**. It is a *request*, not a guarantee.

There is deliberately **no tag describing the sandbox, the CSP, or any other render policy.** The embedding policy belongs to the renderer. A tag that could widen it would make every other guarantee in this document advisory, since the party supplying the untrusted document is the same party that would be supplying the policy.

## Relay Processing

A relay MUST validate the envelope:

- reject `content` longer than 65,536 bytes;
- reject empty or whitespace-only `content`;
- reject a `height` tag that is not an integer in `[80, 1200]`.

A relay MUST NOT parse, sanitize, or rewrite the artifact. Rendering safety is enforced by the renderer's sandbox (below), so relay-side filtering would be non-authoritative — it cannot protect a client that renders unsafely, and it cannot help a client that renders safely. It would also add an HTML parser to the ingest path, which is a denial-of-service surface reached by unauthenticated event submission.

Relays SHOULD exclude `kind:40010` from full-text search indexing. Artifact markup is mostly tags and inline styles; indexing it dilutes results with matches on `div` and `background-color`.

## Rendering

A renderer MUST embed the artifact in an iframe with **all sandbox restrictions applied** — in HTML terms, a `sandbox` attribute with an empty value:

```html
<iframe sandbox="" srcdoc="…" referrerpolicy="no-referrer"></iframe>
```

This is the load-bearing control. Without `allow-scripts`, `<script>` never executes and event-handler attributes never fire, so the artifact cannot reach the parent document, the host application's IPC bridge, or any other frame — irrespective of what the markup contains. Without `allow-same-origin`, the frame has an opaque origin. Without `allow-forms`, `allow-popups`, and `allow-top-navigation`, it cannot navigate the user's window, open a tab, or submit a form.

It can, however, still navigate **itself**: the sandbox does not restrain a same-frame link. See [Known gap: click-driven navigation](#known-gap-click-driven-navigation).

A renderer MUST additionally apply a restrictive `Content-Security-Policy` to the embedded document, with `default-src 'none'` and no `script-src`. The sandbox already stops execution; the CSP stops *passive* loads. Without it, `<img src="https://tracker.example/x.png">` or a CSS `background-image` would report "this person opened this artifact, now" to a third party, with no script involved. Renderers SHOULD permit `data:` images and fonts and inline styles, so self-contained artifacts render fully:

```
default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'
```

When the policy is delivered as a `<meta http-equiv>`, it MUST be the first thing the frame's parser encounters — a policy declared after a resource-loading element does not apply to that element.

A renderer MUST clamp `height` into `[80, 1200]` rather than reject out-of-range values: events predating relay validation, a relay running an older build, or a local archive replay can all deliver anything, and an artifact rendered at the wrong height is a better outcome than one that does not render.

A renderer MAY gate the whole feature behind a user preference. A renderer that does not render the embed SHOULD display the `alt` text.

## Client Behavior

`kind:40010` is a **content kind**: it renders its own row in a timeline and counts toward unread state, like any other message. It is not an overlay on another event.

Clients that cannot render embeds SHOULD NOT request `kind:40010` in timeline filters unless they display the `alt` fallback. Fetching the kind and rendering `content` as message text dumps a raw HTML document into the conversation, which is worse than omitting it.

## Security Considerations

The threat model is: **a channel member or agent posts a deliberately hostile document, and every other member's client renders it.**

The controls, in the order they apply:

1. **Sandbox** — stops execution. Everything else is defense in depth around this. A renderer that adds `allow-scripts` has left this NIP's guarantees behind, and `allow-scripts` together with `allow-same-origin` is equivalent to no sandbox at all.
2. **CSP** — stops *passive* network loads (remote images, fonts, stylesheets, `background-image`). It closes the exfiltration channel that needs no user action. It does **not** close the click-driven one below.
3. **Size limit** — bounds the fan-out cost of a single event, and with it the cheapest denial-of-service against every subscriber in a channel.
4. **Height clamp** — bounds layout disruption.

Deliberately *not* a control: sanitizing the markup. Rewriting untrusted HTML to be safe is an arms race against parser differentials; denying the capabilities is not. A renderer MUST NOT treat sanitization as a substitute for the sandbox.

Not addressed by this NIP: an artifact can display misleading content inside its own frame (a fake dialog, a spoofed message). For *static* markup this is the same trust question as any other user-supplied message content, and is a moderation concern rather than a rendering one. It stops being only that once the frame navigates — see below.

### Known gap: click-driven navigation

`sandbox=""` blocks `_top`, `_blank`, and form submission, but a sandboxed frame is permitted by spec to navigate its **own** browsing context. An artifact can therefore wrap its entire visible surface in an ordinary link:

```html
<a href="https://attacker.example/landing" style="display:block;width:100%;height:100%">
  …what looks like an ordinary report…
</a>
```

One click anywhere on the embed and three things follow. Verified live in both Chromium and WebKit:

1. An outbound request carrying the reader's IP. The accurate claim is that an artifact cannot phone home *unprompted*, not that it cannot phone home.
2. **The CSP does not survive the navigation.** It lives in the `srcdoc` document; the destination document is governed by whatever policy that document carries, which is typically none. The landing page can then load remote scripts, styles, images, and nested frames freely.
3. The row now displays content fetched **after** the event was signed. This is the part that escapes the moderation framing above: a moderator reading the signed event sees a benign document, while the reader sees whatever the attacker is serving at that moment.

Scripts still never execute — the sandbox holds across the navigation, and that guarantee is unaffected. The gap is in the CSP layer, not the sandbox.

`<base target="_blank">` in the wrapper document is **not** a fix: an artifact that writes `target="_self"` on its own anchor overrides it.

The control that does hold is a **host-document CSP** restricting `frame-src` (for example `frame-src 'self' data:`), which constrains the frame's navigation regardless of what the artifact writes. That is an application-wide setting rather than a property of this rendering path, so this NIP states the gap rather than mandating the fix. **A renderer SHOULD NOT enable embeds by default until it applies such a policy.**

**Status in Buzz: closed.** The desktop app sets `frame-src 'none'` application-wide (`desktop/src-tauri/tauri.conf.json`, `app.security.csp`), so the click above navigates nowhere. This was verified by hand in both directions — the same artifact navigates in a build without the policy and does nothing in a build with it — and is pinned by two guards, described under Implementation Notes.

The gap is documented here rather than deleted because it is a property of `sandbox=""` under the spec, not of Buzz. Any other renderer of this kind inherits it and has to close it the same way.

## Implementation Notes

In Buzz:

- kind constant: `crates/buzz-core/src/kind.rs` (`KIND_STREAM_MESSAGE_HTML`)
- builder: `crates/buzz-sdk/src/builders.rs` (`build_html_artifact_message`)
- relay validation: `crates/buzz-relay/src/handlers/ingest.rs` (`validate_html_artifact_event`)
- CLI: `buzz messages send-html --channel <uuid> --html <path|->`
- desktop renderer: `desktop/src/features/messages/ui/HtmlMessage.tsx`, with the CSP wrapper and height clamp in `desktop/src/features/messages/lib/htmlArtifact.mjs`
- desktop gating: the `htmlEmbeds` preview feature in `preview-features.json`
- host-document CSP closing the click-navigation gap: `desktop/src-tauri/tauri.conf.json` (`app.security.csp` = `frame-src 'none'`), with `dangerousDisableAssetCspModification` for `script-src` and `style-src`

Both halves of that CSP setting are required and each is guarded, because removing either breaks something no other test catches:

- `desktop/scripts/check-csp.mjs` (run by `pnpm check`) fails if the `frame-src` directive or either disable-list entry goes missing. The disable list is not optional: Tauri would otherwise inject a nonce into the `<style>` block at `desktop/index.html`, which nullifies `'unsafe-inline'` and kills Radix's runtime-injected stylesheets app-wide. It is *runtime-injected `<style>` elements* that need this, not JSX inline style props — those go through CSSOM, which CSP does not govern.
- `desktop/src-tauri/tests/csp_header.rs` (run by `just desktop-tauri-test-csp`) asserts the header actually shipped in the bundle, which config linting cannot see: the config can stay correct while a Tauri upgrade changes what gets merged on top of it. It needs `--features custom-protocol`, since Tauri's dev asset resolver returns `None` for the header regardless of the config.

The mobile client defines the kind constant but deliberately omits it from its timeline filters, per §Client Behavior — it has no embed renderer yet.
