import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const KIND_STREAM_MESSAGE_HTML = 40009;

const ARTIFACT_HTML = [
  "<style>body{font:14px system-ui;margin:12px}",
  "table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style>",
  "<h2>Nightly build</h2>",
  "<table><tr><th>Suite</th><th>Result</th></tr>",
  "<tr><td>relay</td><td>804 passed</td></tr>",
  "<tr><td>desktop</td><td>3785 passed</td></tr></table>",
].join("");

async function waitForMockLiveSubscription(page: Page, channelName: string) {
  await expect
    .poll(async () =>
      page.evaluate(
        ({ ch }) =>
          (
            window as Window & {
              __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
                channelName: string;
              }) => boolean;
            }
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName: ch }) ??
          false,
        { ch: channelName },
      ),
    )
    .toBe(true);
}

async function emitHtmlArtifact(page: Page) {
  await page.evaluate(
    ({ html, kind }) => {
      (
        window as Window & {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
            channelName: string;
            content: string;
            kind: number;
            extraTags: string[][];
          }) => unknown;
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: html,
        kind,
        extraTags: [
          ["title", "Nightly build"],
          ["alt", "Nightly build: relay 804 passed, desktop 3785 passed"],
          ["height", "220"],
        ],
      });
    },
    { html: ARTIFACT_HTML, kind: KIND_STREAM_MESSAGE_HTML },
  );
}

async function openGeneralWithArtifact(page: Page) {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await waitForMockLiveSubscription(page, "general");
  await emitHtmlArtifact(page);
}

test.describe("html embeds (kind:40009)", () => {
  test("01 — renders the artifact in a fully sandboxed frame", async ({
    page,
  }) => {
    // installMockBridge seeds every preview feature as enabled by default,
    // which is the state this test wants.
    await installMockBridge(page);
    await openGeneralWithArtifact(page);

    const frame = page.locator('iframe[title="Nightly build"]');
    await expect(frame).toBeVisible();

    // The sandbox attribute is the control that makes untrusted HTML safe to
    // render. An empty value means every restriction applies; any token here
    // (above all `allow-scripts`) is a security regression, not a tweak.
    await expect(frame).toHaveAttribute("sandbox", "");
    await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(frame).toHaveAttribute("height", "220");

    // The artifact really rendered — not just an empty frame.
    const inner = page.frameLocator('iframe[title="Nightly build"]');
    await expect(inner.getByRole("heading", { level: 2 })).toHaveText(
      "Nightly build",
    );
    await expect(inner.getByRole("cell", { name: "804 passed" })).toBeVisible();

    await waitForAnimations(page);
    await page
      .locator('iframe[title="Nightly build"]')
      .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]")
      .screenshot({ path: "test-results/screenshots/html-embed-enabled.png" });
  });

  test("02 — scripts in the artifact never execute", async ({ page }) => {
    await installMockBridge(page);

    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await waitForMockLiveSubscription(page, "general");

    await page.evaluate(
      ({ kind }) => {
        (
          window as Window & {
            __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
              channelName: string;
              content: string;
              kind: number;
              extraTags: string[][];
            }) => unknown;
          }
        ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content:
            "<p id='out'>inert</p>" +
            "<script>document.getElementById('out').textContent='EXECUTED';" +
            "try{window.top.__PWNED__=true}catch(e){}</script>",
          kind,
          extraTags: [["title", "Hostile artifact"]],
        });
      },
      { kind: KIND_STREAM_MESSAGE_HTML },
    );

    const inner = page.frameLocator('iframe[title="Hostile artifact"]');
    await expect(inner.locator("#out")).toHaveText("inert");

    // And nothing reached the host document.
    const pwned = await page.evaluate(
      () => (window as Window & { __PWNED__?: boolean }).__PWNED__ === true,
    );
    expect(pwned).toBe(false);
  });

  test("03 — falls back to alt text when the preview flag is off", async ({
    page,
  }) => {
    // No override seeded at all, so `htmlEmbeds` resolves to its manifest
    // default (off) — the state a user sees before opening Experiments.
    await installMockBridge(page, undefined, { seedPreviewFeatures: false });
    await openGeneralWithArtifact(page);

    await expect(
      page.getByText("Nightly build: relay 804 passed, desktop 3785 passed"),
    ).toBeVisible();
    await expect(page.locator('iframe[title="Nightly build"]')).toHaveCount(0);
  });

  test("04 — CSP blocks passive remote loads, so nothing leaves the machine", async ({
    page,
  }) => {
    // The sibling unit test asserts the CSP *string*. This asserts its
    // *effect* — the thing an attacker actually runs into.
    await installMockBridge(page);

    // Serve the beacon successfully. Without this the host simply fails to
    // resolve, and the test would pass on DNS rather than on the CSP — which
    // is exactly the false green this test exists to avoid. Test 05 proves
    // this same routing does fire for a request the sandbox lets through.
    let served = 0;
    await page.route("https://tracker.example/**", (route) => {
      served += 1;
      return route.fulfill({
        contentType: "image/gif",
        body: Buffer.from(
          "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          "base64",
        ),
      });
    });

    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await waitForMockLiveSubscription(page, "general");

    await page.evaluate(
      ({ kind }) => {
        (
          window as Window & {
            __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
              channelName: string;
              content: string;
              kind: number;
              extraTags: string[][];
            }) => unknown;
          }
        ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content:
            '<p id="marker">rendered</p>' +
            '<img src="https://tracker.example/beacon.gif">' +
            // `font-family:x` on body is required, not decoration: a browser
            // only fetches a webfont once a rendered element applies the
            // family, so a declared-but-unused @font-face never exercises
            // `font-src` at all. Without CSP this artifact fires 3 requests;
            // drop the body rule and it fires 2.
            '<style>@font-face{font-family:x;src:url("https://tracker.example/f.woff2")}' +
            'body{font-family:x;background-image:url("https://tracker.example/bg.png")}</style>',
          kind,
          extraTags: [["title", "Beacon artifact"]],
        });
      },
      { kind: KIND_STREAM_MESSAGE_HTML },
    );

    // The artifact itself rendered, so a blank frame cannot be why nothing loaded.
    const inner = page.frameLocator('iframe[title="Beacon artifact"]');
    await expect(inner.locator("#marker")).toHaveText("rendered");

    // The CSP has to have stopped all three (img, font, background-image),
    // because anything that got through would have been served happily.
    expect(served).toBe(0);
  });

  test("05 — a same-frame link navigates the embed (known gap, must stay contained)", async ({
    page,
  }) => {
    // Documents the gap in docs/nips/NIP-HE.md § "Known gap: click-driven
    // navigation": `sandbox=""` does NOT stop the frame navigating itself.
    // This test exists so the blast radius cannot silently widen — if the
    // host page ever starts navigating too, that is a serious regression.
    await installMockBridge(page);
    await page.route("https://attacker.example/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1 id=landed>x</h1>" }),
    );

    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await waitForMockLiveSubscription(page, "general");

    await page.evaluate(
      ({ kind }) => {
        (
          window as Window & {
            __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
              channelName: string;
              content: string;
              kind: number;
              extraTags: string[][];
            }) => unknown;
          }
        ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content:
            '<a id="trap" href="https://attacker.example/landing" ' +
            'style="display:block;width:100%;height:120px">report</a>',
          kind,
          extraTags: [["title", "Trap artifact"]],
        });
      },
      { kind: KIND_STREAM_MESSAGE_HTML },
    );

    const hostUrlBefore = page.url();
    await page
      .frameLocator('iframe[title="Trap artifact"]')
      .locator("#trap")
      .click();

    // The frame does navigate — that is the known gap, asserted so a future
    // change that closes it fails loudly here rather than going unnoticed.
    await expect(
      page.frameLocator('iframe[title="Trap artifact"]').locator("#landed"),
    ).toBeVisible();

    // What must never change: the user's own window stays put.
    expect(page.url()).toBe(hostUrlBefore);
  });
});
