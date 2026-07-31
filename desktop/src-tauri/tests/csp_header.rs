// Compiled only with `custom-protocol`. Without it Tauri is in `cfg(dev)`,
// where the asset resolver cannot return a CSP header at all, so these tests
// would fail every ordinary `cargo test` run rather than measuring anything.
#![cfg(feature = "custom-protocol")]

//! Reads the `Content-Security-Policy` the app actually ships.
//!
//! This resolves the real embedded `index.html` through Tauri's own asset
//! resolver — the same path that serves `tauri://localhost` at runtime — so it
//! observes the assembled header rather than the string in `tauri.conf.json`.
//! That distinction is the point: Tauri does not ship the configured policy
//! verbatim. `set_csp` merges `script-src`/`style-src` entries derived from the
//! built HTML's nonces and inline-script hashes, so configuring one directive
//! can silently produce three.
//!
//! **Must be run with `tauri/custom-protocol`.** Tauri sets `cfg(dev)` as
//! simply `!custom-protocol` (tauri-2.11.5 `build.rs:256-259`), the feature
//! `tauri build` turns on. Under `cfg(dev)`,
//! `AssetResolver::get_for_scheme` reads straight off `frontendDist` and
//! hardcodes `csp_header: None` (`src/app.rs:343-370`), and `AppManager::csp`
//! reads `devCsp` instead (`src/manager/mod.rs:369`). A plain `cargo test`
//! would therefore pass vacuously on a `None` it can never not see. Hence:
//!
//! ```sh
//! cargo test --release --manifest-path desktop/src-tauri/Cargo.toml \
//!   --features custom-protocol --test csp_header
//! ```
//!
//! `--release` is not itself what matters — the feature is — but the two go
//! together for a build that matches what ships.
//!
//! It is an integration test rather than a unit test because the crate's
//! `#[cfg(test)]` modules do not compile under `--release` (several are gated
//! on `cfg(dev)`), which would block the only build where this is meaningful.
//!
//! `desktop/scripts/check-csp.mjs` guards the *config*; this guards the
//! *result*. Both are needed — the config can stay correct while a Tauri
//! upgrade changes what gets merged on top of it.

/// Fails loudly in debug rather than passing on a value that is `None` by
/// construction. A green run here must mean the header was actually inspected.
fn resolve_shipped_csp() -> String {
    assert!(
        !tauri::is_dev(),
        "run this with --release; in a dev build the asset resolver returns \
         csp_header: None unconditionally, so this test cannot observe anything"
    );

    let app = tauri::test::mock_builder()
        .build(buzz_lib::tauri_context())
        .expect("mock app should build");

    let asset = app
        .asset_resolver()
        .get("index.html".into())
        .expect("index.html should be embedded in the binary");

    asset
        .csp_header
        .expect("a CSP header should be attached to HTML assets")
}

/// The frame policy is the entire reason a CSP exists here: it stops a
/// sandboxed embed navigating itself to another origin, which `sandbox=""`
/// does not prevent. See `docs/nips/NIP-HE.md`.
#[test]
fn shipped_csp_header_is_exactly_frame_src_none() {
    assert_eq!(
        resolve_shipped_csp(),
        "frame-src 'none'",
        "shipped CSP drifted. Extra directives here mean \
         dangerousDisableAssetCspModification is no longer covering what \
         Tauri merges in."
    );
}

/// Guards the half that is easiest to lose in a Tauri upgrade or a config
/// tidy-up.
///
/// Letting Tauri manage `style-src` nonces every `<style>` element in
/// `index.html` (there is one, at `desktop/index.html:23`), and a nonce
/// disables `'unsafe-inline'` — which blocks every runtime-injected `<style>`,
/// i.e. how Radix ships its styles. The app breaks app-wide and it looks
/// nothing like a CSP problem.
///
/// React's `style={{}}` props are NOT the victim: React writes those through
/// CSSOM, which CSP does not govern. Measured in Chromium and WebKit under
/// `style-src 'self' 'nonce-x' 'unsafe-inline'` — CSSOM writes applied, while
/// HTML `style` attributes, `setAttribute("style", …)` and runtime `<style>`
/// elements were all blocked. Tightening `style-src` later means nonce-ing
/// Radix's injected stylesheets, not touching JSX.
#[test]
fn shipped_csp_does_not_constrain_scripts_or_styles() {
    let csp = resolve_shipped_csp();

    assert!(
        !csp.contains("style-src"),
        "CSP now constrains style-src ({csp:?}), which breaks Radix's \
         runtime-injected stylesheets."
    );
    assert!(
        !csp.contains("script-src"),
        "CSP now constrains script-src ({csp:?}), which is out of scope for \
         the frame-embedding fix and needs its own testing."
    );
}
