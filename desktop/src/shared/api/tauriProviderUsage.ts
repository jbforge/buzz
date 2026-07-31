import { invokeTauri } from "./tauri";

export type ProviderUsageStatus =
  | "ok"
  | "signed-out"
  | "unsupported"
  | "not-configured"
  | "error";

export type ProviderUsageWindow = {
  /** Short human label: "5-hour", "Weekly". */
  label: string;
  /** 0–100; may exceed 100 on provider-reported overage. */
  usedPercent: number;
  /** Unix seconds when the window resets, when known. */
  resetsAt: number | null;
};

export type ProviderUsageSpend = {
  /** Short human label: "Extra usage", "Credits". */
  label: string;
  used: number;
  limit: number | null;
  /** ISO currency code, e.g. "USD". */
  currency: string;
};

export type ProviderUsage = {
  id: string;
  name: string;
  status: ProviderUsageStatus;
  plan: string | null;
  windows: ProviderUsageWindow[];
  spend: ProviderUsageSpend | null;
  detail: string | null;
  dashboardUrl: string | null;
};

export type ProviderUsageSnapshot = {
  /** Unix seconds when the snapshot was fetched. */
  fetchedAt: number;
  providers: ProviderUsage[];
};

/**
 * Fetch subscription usage for the AI providers signed in on this machine.
 * Fully local: the Rust side reads each provider CLI's stored credential and
 * queries the provider directly; nothing touches the relay.
 */
export async function fetchProviderUsage(): Promise<ProviderUsageSnapshot> {
  return await invokeTauri<ProviderUsageSnapshot>("fetch_provider_usage");
}
