#!/usr/bin/env node
// Guard the two halves of the webview CSP in tauri.conf.json.
//
// They are a pair, and removing either one silently breaks something that no
// other test would catch:
//
//   `app.security.csp`
//     Carries `frame-src`, which is the only control that stops a sandboxed
//     embed navigating itself to a remote origin. `sandbox=""` does not — a
//     frame may navigate its own browsing context. Drop this and the embedded
//     HTML viewer (kind:40009) can send a reader's IP out on one click and
//     land them on a document with no policy at all.
//
//   `app.security.dangerousDisableAssetCspModification`
//     Must list `script-src` and `style-src`. Configuring any CSP at all makes
//     tauri-build rewrite the built HTML: it nonces every `<style>` element it
//     finds, and `index.html:23` has one. Per CSP spec a nonce DISABLES
//     `'unsafe-inline'` for that directive, so a nonced `style-src` blocks
//     every **runtime-injected `<style>` element** — which is how Radix
//     (~14 prod dependencies) ships its styles. That breaks the UI app-wide.
//
//     Note what is NOT at risk, because getting this backwards sends the next
//     person to the wrong file: React's `style={{}}` props are unaffected.
//     React writes those through CSSOM property sets, and CSP does not govern
//     CSSOM. Measured in Chromium and WebKit under
//     `style-src 'self' 'nonce-x' 'unsafe-inline'`: CSSOM writes APPLIED,
//     while HTML `style` attributes, `setAttribute("style", …)`, and runtime
//     `<style>` elements were all BLOCKED. So tightening `style-src` later
//     means nonce-ing Radix's injected stylesheets, not touching JSX.
//
//     Listing both directives here keeps Tauri out of them entirely, leaving
//     scripts and styles exactly as unrestricted as they were before any CSP
//     existed. This change hardens frame embedding ONLY; hardening
//     script-src/style-src is separate work with a much larger blast radius.
//
// Deliberately a shape check, not a string match: a future policy may add
// directives, and that should not fail the build. What must not happen is
// `frame-src` disappearing or Tauri being handed back control of the two
// directives we are not hardening.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.cwd(), "src-tauri/tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const security = config.app?.security ?? {};
const errors = [];

const csp = security.csp;
if (typeof csp !== "string" || csp.trim() === "") {
  errors.push(
    "app.security.csp must be a non-empty string. `null` means no CSP is sent " +
      "at all, which reopens the embed navigation gap (docs/nips/NIP-HE.md).",
  );
} else if (!/(^|;)\s*frame-src\s/.test(csp)) {
  errors.push(
    `app.security.csp must contain a \`frame-src\` directive. Got: ${csp}`,
  );
}

const disabled = security.dangerousDisableAssetCspModification;
if (!Array.isArray(disabled)) {
  errors.push(
    "app.security.dangerousDisableAssetCspModification must be an array " +
      'listing ["script-src", "style-src"]. `true` would disable Tauri\'s ' +
      "modification of every directive; omitting it lets Tauri nonce " +
      "style-src, which blocks every runtime-injected <style> element — " +
      "how Radix ships its styles.",
  );
} else {
  for (const directive of ["script-src", "style-src"]) {
    if (!disabled.includes(directive)) {
      errors.push(
        `app.security.dangerousDisableAssetCspModification must include ` +
          `"${directive}" — otherwise tauri-build injects a nonce into it and ` +
          `'unsafe-inline' stops applying, breaking inline ${directive === "style-src" ? "styles" : "scripts"} at runtime.`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("check-csp: tauri.conf.json CSP configuration is unsafe\n");
  for (const error of errors) console.error(`  - ${error}\n`);
  process.exit(1);
}

console.log("check-csp: ok");
