import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allProvidersDisabled,
  isProviderEnabled,
  sanitizeProviderPrefs,
  USAGE_PROVIDERS,
} from "./providerPrefs.ts";

test("absent providers are enabled; only explicit false disables", () => {
  assert.equal(isProviderEnabled({}, "claude"), true);
  assert.equal(isProviderEnabled({ claude: true }, "claude"), true);
  assert.equal(isProviderEnabled({ claude: false }, "claude"), false);
  // Unknown/future provider ids default on too.
  assert.equal(isProviderEnabled({}, "some-new-provider"), true);
});

test("sanitize keeps only boolean entries", () => {
  assert.deepEqual(sanitizeProviderPrefs(null), {});
  assert.deepEqual(sanitizeProviderPrefs([true]), {});
  assert.deepEqual(sanitizeProviderPrefs("nope"), {});
  assert.deepEqual(
    sanitizeProviderPrefs({ claude: false, codex: "yes", nous: 1, or: true }),
    { claude: false, or: true },
  );
});

test("allProvidersDisabled only when every known provider is off", () => {
  assert.equal(allProvidersDisabled({}), false);
  assert.equal(allProvidersDisabled({ claude: false }), false);
  const allOff = Object.fromEntries(
    USAGE_PROVIDERS.map((provider) => [provider.id, false]),
  );
  assert.equal(allProvidersDisabled(allOff), true);
  // One re-enabled brings the card back.
  assert.equal(allProvidersDisabled({ ...allOff, codex: true }), false);
});
