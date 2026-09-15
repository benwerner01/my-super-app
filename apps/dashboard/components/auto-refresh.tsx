"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-requests the current route on an interval. Every page is force-dynamic, so
 * a refresh re-reads the run log from disk. Polling is enough for a dashboard
 * watching a job that runs once a week.
 */
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
