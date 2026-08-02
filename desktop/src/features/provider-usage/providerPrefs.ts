import * as React from "react";

/**
 * Per-provider visibility preferences for the AI usage card.
 *
 * Providers come and go over time (new subscriptions, cancelled plans), so
 * each one can be toggled in Settings → Experiments independently of the
 * card's own feature flag. Absent id = enabled; only an explicit `false`
 * disables — so newly added providers show up by default.
 *
 * Storage mirrors the feature-override store: localStorage + a module-level
 * snapshot for useSyncExternalStore, with cross-window sync via the
 * "storage" event. User-level preference, not community-scoped — survives
 * community switches on purpose (like feature overrides).
 */

/** Providers the usage card knows about, in display order. */
export const USAGE_PROVIDERS = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "nous", label: "Nous Portal" },
] as const;

export type UsageProviderId = (typeof USAGE_PROVIDERS)[number]["id"];

export type ProviderPrefs = Readonly<Record<string, boolean>>;

export const PROVIDER_PREFS_STORAGE_KEY = "buzz:provider-usage-providers:v1";

/** Keep only boolean entries from a parsed storage payload. Pure. */
export function sanitizeProviderPrefs(
  parsed: unknown,
): Record<string, boolean> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const result: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (id && typeof value === "boolean") {
      result[id] = value;
    }
  }
  return result;
}

/** Absent id = enabled; only explicit `false` disables. Pure. */
export function isProviderEnabled(prefs: ProviderPrefs, id: string): boolean {
  return prefs[id] !== false;
}

/** True when every known provider is toggled off (card can stop polling). Pure. */
export function allProvidersDisabled(prefs: ProviderPrefs): boolean {
  return USAGE_PROVIDERS.every(
    (provider) => !isProviderEnabled(prefs, provider.id),
  );
}

function readPrefs(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return sanitizeProviderPrefs(
      JSON.parse(
        window.localStorage.getItem(PROVIDER_PREFS_STORAGE_KEY) ?? "{}",
      ),
    );
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
let prefs: ProviderPrefs = readPrefs();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Cross-window sync: another window writing the key fires "storage" here.
  const handleStorage = (event: StorageEvent) => {
    if (event.key === PROVIDER_PREFS_STORAGE_KEY) {
      prefs = readPrefs();
      emit();
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

const getSnapshot = (): ProviderPrefs => prefs;
const getServerSnapshot = (): ProviderPrefs => ({});

/** Reactive per-provider prefs; re-renders on any toggle in any window. */
export function useProviderPrefs(): ProviderPrefs {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Toggle a provider on/off and persist (best-effort) for future sessions. */
export function setProviderEnabled(id: string, enabled: boolean): void {
  prefs = { ...prefs, [id]: enabled };
  try {
    window.localStorage.setItem(
      PROVIDER_PREFS_STORAGE_KEY,
      JSON.stringify(prefs),
    );
  } catch {
    // Persistence is best-effort; the live session still uses in-memory state.
  }
  emit();
}
