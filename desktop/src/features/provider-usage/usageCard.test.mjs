import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveUsageCard,
  formatResetsIn,
  toneForPercent,
} from "./usageCard.ts";

const NOW = 1_785_000_000;

function provider(overrides = {}) {
  return {
    id: "claude",
    name: "Claude",
    status: "ok",
    plan: null,
    windows: [],
    spend: null,
    detail: null,
    dashboardUrl: "https://example.com",
    ...overrides,
  };
}

function snapshot(providers) {
  return { fetchedAt: NOW, providers };
}

test("hidden until a snapshot exists", () => {
  assert.equal(deriveUsageCard(null, NOW).show, false);
});

test("ok provider becomes a meter row with clamped bars and true labels", () => {
  const card = deriveUsageCard(
    snapshot([
      provider({
        windows: [
          { label: "5-hour", usedPercent: 16, resetsAt: NOW + 2 * 3600 },
          { label: "Weekly", usedPercent: 130, resetsAt: null },
        ],
      }),
    ]),
    NOW,
  );
  assert.equal(card.show, true);
  const [row] = card.rows;
  assert.equal(row.kind, "meter");
  assert.equal(row.meters.length, 2);
  assert.equal(row.meters[0].resetsIn, "2h");
  assert.equal(row.meters[1].percent, 100);
  assert.equal(row.meters[1].percentLabel, "130%");
  assert.equal(row.tone, "critical");
});

test("plan is folded into the title", () => {
  const card = deriveUsageCard(
    snapshot([
      provider({
        id: "codex",
        name: "Codex",
        plan: "Plus",
        windows: [{ label: "Weekly", usedPercent: 60, resetsAt: null }],
      }),
    ]),
    NOW,
  );
  assert.equal(card.rows[0].title, "Codex · Plus");
});

test("spend renders as a used-of-limit detail line", () => {
  const card = deriveUsageCard(
    snapshot([
      provider({
        spend: {
          label: "Extra usage",
          used: 34.47,
          limit: 200,
          currency: "USD",
        },
      }),
    ]),
    NOW,
  );
  assert.equal(card.rows[0].detail, "Extra usage: $34.47 of $200");
});

test("unsupported provider renders as a link row with its hint", () => {
  const card = deriveUsageCard(
    snapshot([
      provider({
        id: "nous",
        name: "Nous Portal",
        status: "unsupported",
        detail: "No usage API yet — opens the portal",
      }),
    ]),
    NOW,
  );
  const [row] = card.rows;
  assert.equal(row.kind, "link");
  assert.equal(row.detail, "No usage API yet — opens the portal");
});

test("signed-out and error rows keep the card visible with hints", () => {
  const card = deriveUsageCard(
    snapshot([
      provider({ status: "signed-out", detail: "Sign in with Claude Code" }),
      provider({ id: "codex", name: "Codex", status: "error" }),
    ]),
    NOW,
  );
  assert.equal(card.rows[0].detail, "Sign in with Claude Code");
  assert.equal(card.rows[1].detail, "Couldn't fetch usage");
});

test("not-configured providers are hidden entirely", () => {
  const card = deriveUsageCard(
    snapshot([provider({ id: "openrouter", status: "not-configured" })]),
    NOW,
  );
  assert.equal(card.show, false);
  assert.equal(card.rows.length, 0);
});

test("tone thresholds", () => {
  assert.equal(toneForPercent(0), "normal");
  assert.equal(toneForPercent(69), "normal");
  assert.equal(toneForPercent(70), "warn");
  assert.equal(toneForPercent(90), "critical");
});

test("reset horizon formatting", () => {
  assert.equal(formatResetsIn(null, NOW), null);
  assert.equal(formatResetsIn(NOW - 5, NOW), "now");
  assert.equal(formatResetsIn(NOW + 30 * 60, NOW), "30m");
  assert.equal(formatResetsIn(NOW + 5 * 3600, NOW), "5h");
  assert.equal(formatResetsIn(NOW + 2 * 86_400 + 4 * 3600, NOW), "2d 4h");
  assert.equal(formatResetsIn(NOW + 3 * 86_400, NOW), "3d");
});
