import type {
  ProviderUsage,
  ProviderUsageSnapshot,
} from "@/shared/api/tauriProviderUsage";

/**
 * Pure projection of a provider-usage snapshot into the sidebar card's row
 * model. Single source of truth for copy, ordering, and severity thresholds,
 * so the component and its tests agree. Kept pure/total (accepts null = not
 * yet fetched).
 */

export type UsageTone = "normal" | "warn" | "critical";

export type UsageMeter = {
  label: string;
  /** Clamped 0–100 for the bar; `percentLabel` keeps the true value. */
  percent: number;
  percentLabel: string;
  /** "3h" / "5d" until the window resets, when known. */
  resetsIn: string | null;
};

export type UsageRow = {
  id: string;
  /** "Claude", "Codex · Plus". */
  title: string;
  /** A meter row shows bars; a link row only opens `dashboardUrl`. */
  kind: "meter" | "link";
  meters: UsageMeter[];
  /** Worst meter drives the row's accent. */
  tone: UsageTone;
  /** Secondary line: spend summary, or the non-ok status hint. */
  detail: string | null;
  dashboardUrl: string | null;
};

export type UsageCardModel = {
  /** False until a snapshot with at least one visible row exists. */
  show: boolean;
  rows: UsageRow[];
};

/** Severity thresholds shared by the bar tint and the headline accent. */
export function toneForPercent(percent: number): UsageTone {
  if (percent >= 90) return "critical";
  if (percent >= 70) return "warn";
  return "normal";
}

/** Compact "in Xh" horizon: "45m", "3h", "2d 4h" → capped at days. */
export function formatResetsIn(
  resetsAt: number | null,
  nowSeconds: number,
): string | null {
  if (resetsAt === null) return null;
  const remaining = resetsAt - nowSeconds;
  if (remaining <= 0) return "now";
  const minutes = Math.ceil(remaining / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const spareHours = hours % 24;
  return spareHours > 0 ? `${days}d ${spareHours}h` : `${days}d`;
}

function formatMoney(amount: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const rounded = Math.round(amount * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return `${symbol}${text}`;
}

function spendSummary(provider: ProviderUsage): string | null {
  const spend = provider.spend;
  if (!spend) return null;
  const used = formatMoney(spend.used, spend.currency);
  if (spend.limit === null) return `${spend.label}: ${used}`;
  return `${spend.label}: ${used} of ${formatMoney(spend.limit, spend.currency)}`;
}

function meterRow(provider: ProviderUsage, nowSeconds: number): UsageRow {
  const meters = provider.windows.map((window) => ({
    label: window.label,
    percent: Math.min(100, Math.max(0, window.usedPercent)),
    percentLabel: `${Math.round(window.usedPercent)}%`,
    resetsIn: formatResetsIn(window.resetsAt, nowSeconds),
  }));
  const worst = provider.windows.reduce(
    (max, window) => Math.max(max, window.usedPercent),
    0,
  );
  return {
    id: provider.id,
    title: provider.plan
      ? `${provider.name} · ${provider.plan}`
      : provider.name,
    kind: "meter",
    meters,
    tone: toneForPercent(worst),
    detail: spendSummary(provider),
    dashboardUrl: provider.dashboardUrl,
  };
}

function providerToRow(
  provider: ProviderUsage,
  nowSeconds: number,
): UsageRow | null {
  switch (provider.status) {
    case "ok":
      // Spend-only providers (e.g. OpenRouter with no prepaid balance) still
      // render as a meter row; the bars are simply absent.
      return meterRow(provider, nowSeconds);
    case "unsupported":
      return {
        id: provider.id,
        title: provider.name,
        kind: "link",
        meters: [],
        tone: "normal",
        detail: provider.detail,
        dashboardUrl: provider.dashboardUrl,
      };
    case "signed-out":
    case "error":
      return {
        id: provider.id,
        title: provider.name,
        kind: "link",
        meters: [],
        tone: "normal",
        detail:
          provider.status === "signed-out"
            ? (provider.detail ?? "Signed out")
            : "Couldn't fetch usage",
        dashboardUrl: provider.dashboardUrl,
      };
    case "not-configured":
      // Opt-in providers stay invisible until configured — a permanent
      // "add an API key" row is noise, not a meter.
      return null;
    default:
      return null;
  }
}

/**
 * @param snapshot  latest snapshot, or null if not yet fetched
 * @param nowSeconds  current unix time, injected for testability
 */
export function deriveUsageCard(
  snapshot: ProviderUsageSnapshot | null,
  nowSeconds: number,
): UsageCardModel {
  if (!snapshot) {
    return { show: false, rows: [] };
  }
  const rows = snapshot.providers
    .map((provider) => providerToRow(provider, nowSeconds))
    .filter((row): row is UsageRow => row !== null);
  return { show: rows.length > 0, rows };
}
