"use client";

import { useQuery } from "@tanstack/react-query";
import { online } from "@conviya/contracts";
import { api } from "./client";

function visitorId() {
  try {
    const saved = window.sessionStorage.getItem("trust-meet-visitor");
    if (saved) return saved;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem("trust-meet-visitor", created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

// Register this tab as online roughly every 15 seconds; the server counts tabs seen in the last 45.
// The POST also keeps us counted while the tab is in the background.
function useHeartbeat() {
  return useQuery({
    queryKey: ["presence", "heartbeat"],
    queryFn: ({ signal }) => api("/presence", online, { visitor: visitorId() }, signal),
    refetchInterval: 15_000, refetchIntervalInBackground: true, staleTime: 15_000, retry: false,
  });
}

// Read the live count every second so the badge updates on its own, without a refresh. This GET
// is a cheap Redis read; the heartbeat above is what actually records presence.
export function useOnline() {
  useHeartbeat();
  return useQuery({
    queryKey: ["presence", "count"],
    queryFn: ({ signal }) => api("/presence", online, undefined, signal),
    refetchInterval: 1000,
    staleTime: 0,
    retry: false,
    placeholderData: previous => previous,
  });
}

export function formatCount(value: number) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return (value / 1000).toFixed(value < 10_000 ? 2 : 1).replace(/\.?0+$/, "") + "k";
  return (value / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
}

export function OnlineBadge({ suffix = "online" }: { suffix?: string }) {
  const { data } = useOnline();
  if (!data) return null;
  return <span className="online-badge" aria-live="polite"><span className="online-dot" aria-hidden="true" />
    <strong>{formatCount(data.online)}</strong> {suffix}</span>;
}
