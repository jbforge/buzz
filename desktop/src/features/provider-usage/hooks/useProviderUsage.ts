import * as React from "react";

import { fetchProviderUsage } from "@/shared/api/tauriProviderUsage";
import type { ProviderUsageSnapshot } from "@/shared/api/tauriProviderUsage";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Polls local AI-subscription usage while the card is visible.
 *
 * Mirrors `useMeshServingUsage`: only polls when `enabled`, returns `null`
 * until the first successful fetch, and a failed poll keeps the last snapshot
 * in place rather than flapping the card. The 5-minute cadence is deliberate —
 * usage moves slowly and each poll hits external provider APIs.
 */
export function useProviderUsage(enabled: boolean): {
  snapshot: ProviderUsageSnapshot | null;
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = React.useState<ProviderUsageSnapshot | null>(
    null,
  );
  const refreshRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    const fetchOnce = () => {
      void (async () => {
        try {
          const value = await fetchProviderUsage();
          if (!cancelled) setSnapshot(value);
        } catch {
          // Best-effort: leave the last snapshot in place.
        }
      })();
    };
    fetchOnce();
    refreshRef.current = fetchOnce;
    const handle = window.setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      refreshRef.current = () => {};
      window.clearInterval(handle);
    };
  }, [enabled]);

  const refresh = React.useCallback(() => {
    refreshRef.current();
  }, []);

  return { snapshot, refresh };
}
