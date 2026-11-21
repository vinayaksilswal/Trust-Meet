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

// Each open tab reports itself every 20 seconds; the server counts tabs seen in the last 45.
export function useOnline() {
  return useQuery({
    queryKey: ["presence"],
    queryFn: ({ signal }) => api("/presence", online, { visitor: visitorId() }, signal),
    refetchInterval: 20_000, refetchIntervalInBackground: true, staleTime: 15_000, retry: false,
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
