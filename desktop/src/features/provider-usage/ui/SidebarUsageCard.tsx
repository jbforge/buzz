import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, RefreshCw } from "lucide-react";
import * as React from "react";

import { deriveUsageCard } from "@/features/provider-usage/usageCard";
import type { UsageMeter, UsageRow } from "@/features/provider-usage/usageCard";
import { useProviderUsage } from "@/features/provider-usage/hooks/useProviderUsage";
import { useFeatureEnabled } from "@/shared/features/useFeatureEnabled";
import { cn } from "@/shared/lib/cn";

const TONE_BAR_CLASS: Record<UsageRow["tone"], string> = {
  normal: "bg-primary",
  warn: "bg-amber-500",
  critical: "bg-destructive",
};

/**
 * At-a-glance AI subscription usage in the sidebar footer.
 *
 * Fully local: the backing Tauri command reads each provider CLI's own stored
 * credential and queries the provider directly — nothing is published to the
 * relay. Gated behind the `providerUsage` preview feature; renders nothing
 * until the flag is on and a first snapshot has arrived.
 */
export function SidebarUsageCard({ className }: { className?: string }) {
  const enabled = useFeatureEnabled("providerUsage");
  const { snapshot, refresh } = useProviderUsage(enabled);
  const card = React.useMemo(
    () => deriveUsageCard(snapshot, Math.floor(Date.now() / 1000)),
    [snapshot],
  );

  if (!enabled || !card.show) {
    return null;
  }

  return (
    <section
      aria-label="AI subscription usage"
      className={cn(
        "rounded-xl border border-border/70 bg-background/70 px-3 py-2.5 shadow-xs dark:bg-background/50",
        className,
      )}
      data-testid="sidebar-usage-card"
    >
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          AI usage
        </span>
        <button
          aria-label="Refresh usage"
          className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-muted-foreground/40"
          data-testid="sidebar-usage-refresh"
          onClick={refresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" className="h-3 w-3" />
        </button>
      </div>
      <div className="mt-1 flex flex-col gap-2">
        {card.rows.map((row) => (
          <UsageRowView key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}

function openDashboard(url: string | null) {
  if (!url) return;
  void openUrl(url).catch(() => {
    // Opening externally is best-effort; the numbers are already on screen.
  });
}

function UsageRowView({ row }: { row: UsageRow }) {
  return (
    <button
      className="group/usage-row w-full rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-muted-foreground/40"
      data-testid={`sidebar-usage-row-${row.id}`}
      onClick={() => openDashboard(row.dashboardUrl)}
      title={row.dashboardUrl ? `Open the ${row.title} usage page` : undefined}
      type="button"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{row.title}</span>
        {row.kind === "link" ? (
          <ExternalLink
            aria-hidden="true"
            className="h-3 w-3 shrink-0 text-muted-foreground/60"
          />
        ) : null}
      </span>
      {row.meters.map((meter) => (
        <UsageMeterView key={meter.label} meter={meter} tone={row.tone} />
      ))}
      {row.detail ? (
        <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
          {row.detail}
        </span>
      ) : null}
    </button>
  );
}

function UsageMeterView({
  meter,
  tone,
}: {
  meter: UsageMeter;
  tone: UsageRow["tone"];
}) {
  return (
    <span className="mt-1 flex items-center gap-2">
      <span className="w-11 shrink-0 text-2xs text-muted-foreground">
        {meter.label}
      </span>
      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", TONE_BAR_CLASS[tone])}
          style={{ width: `${meter.percent}%` }}
        />
      </span>
      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
        {meter.percentLabel}
        {meter.resetsIn ? ` · ${meter.resetsIn}` : ""}
      </span>
    </span>
  );
}
