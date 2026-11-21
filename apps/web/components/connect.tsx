"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { conversation, mode as modeSchema, type Mode } from "@conviya/contracts";
import { Notice } from "@conviya/ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { ApiError, api, errorMessage, useAccount } from "@/lib/client";
import { Call } from "./call";
import { PremiumModal, hasPremium, type PremiumFeature } from "./premium";
import { MeetControls, type Filters } from "./random-controls";
import { LiveTile, RandomStudio, RandomTile, WelcomePanel } from "./random-studio";

const queueSchema = z.object({ waiting: z.boolean(), conversation: conversation.nullable() });
type Search = { search_id: string; mode: Mode; auto_connect: true; want_gender: Filters["gender"]; want_region: string };
const FILTERS_KEY = "trust-meet-filters";
const noFilters: Filters = { gender: "", region: "" };

function savedFilters(): Filters {
  try {
    const value = JSON.parse(window.localStorage.getItem(FILTERS_KEY) ?? "null");
    if (value && ["", "male", "female"].includes(value.gender) && /^([A-Z]{2})?$/.test(value.region)) return value;
  } catch { /* Ignore unreadable storage. */ }
  return noFilters;
}

export function Connect() {
  const account = useAccount();
  const client = useQueryClient();
  const params = useSearchParams();
  const mode = modeSchema.catch("video").parse(params.get("mode") ?? "video");
  const profile = account.data;
  const premium = hasPremium(profile?.premium_until);
  const enabled = !!profile?.eligible && profile.conversations_enabled && profile.matchmaking_enabled;
  const callKey = useMemo(() => ["conversation", profile?.id], [profile?.id]);
  const [search, setSearch] = useState<Search | null>(null);
  const [mediaAllowed, setMediaAllowed] = useState(mode === "text");
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [filters, setFiltersState] = useState<Filters>(noFilters);
  const [upsell, setUpsell] = useState<PremiumFeature | null>(null);
  const stopped = useRef(true);
  const nextInProgress = useRef(false);
  const previousCall = useRef<string | null>(null);

  useEffect(() => { setFiltersState(savedFilters()); }, []);
  const activeFilters = premium ? filters : noFilters;

  const current = useQuery({
    queryKey: callKey, enabled,
    queryFn: ({ signal }) => api("/conversations/current", conversation.nullable(), undefined, signal),
    refetchInterval: 2000,
  });
  const active = current.data;

  const stopPreview = useCallback(() => {
    setPreview(stream => { stream?.getTracks().forEach(track => track.stop()); return null; });
  }, []);
  useEffect(() => stopPreview, [stopPreview]);

  const next = useMutation({
    mutationFn: async () => {
      if (nextInProgress.current) return;
      nextInProgress.current = true;
      stopped.current = false;
      try {
        if (mode !== "text") {
          if (!navigator.mediaDevices?.getUserMedia) throw new ApiError(0, "Open Trust Meet over HTTPS to use your camera and microphone.");
          // Ask for device access once. The stream doubles as your preview while you wait.
          if (!mediaAllowed) {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ video: mode === "video", audio: true });
              setPreview(previous => { previous?.getTracks().forEach(track => track.stop()); return stream; });
              setMediaAllowed(true);
            } catch {
              stopped.current = true;
              throw new ApiError(0, "Allow camera and microphone access, then press Start.");
            }
          }
        }
        await client.cancelQueries({ queryKey: ["random-queue", profile?.id] });
        // The cached call is current to within one poll; search returns any call it missed.
        const existing = client.getQueryData<z.infer<typeof conversation> | null>(callKey);
        if (existing && existing.state !== "ended") await api(`/conversations/${existing.id}/end`, z.null(), {});
        const choice: Search = { search_id: crypto.randomUUID(), mode, auto_connect: true,
          want_gender: activeFilters.gender, want_region: activeFilters.region };
        const result = await api("/matchmaking/search", queueSchema, { ...choice, start: true });
        client.setQueryData(callKey, result.conversation);
        setSearch(choice);
      } finally { nextInProgress.current = false; }
    },
    onError: error => { if (error instanceof ApiError && error.status === 402) setUpsell("region"); },
  });

  const stop = useMutation({
    mutationFn: async () => {
      stopped.current = true;
      const pending = search;
      setSearch(null);
      await client.cancelQueries({ queryKey: ["random-queue", profile?.id] });
      if (pending) await api("/matchmaking/cancel", z.null(), { search_id: pending.search_id, mode: pending.mode }).catch(() => undefined);
      const existing = client.getQueryData<z.infer<typeof conversation> | null>(callKey);
      if (existing && existing.state !== "ended") await api(`/conversations/${existing.id}/end`, z.null(), {});
      client.setQueryData(callKey, null);
    },
  });

  const block = useMutation({
    mutationFn: async (id: string) => { await api(`/conversations/${id}/block`, z.unknown(), {}); },
    onSettled: () => next.mutate(),
  });

  const queue = useQuery({
    queryKey: ["random-queue", profile?.id, search, active?.id],
    enabled: enabled && !!search && !active && !next.isPending,
    // The server holds a waiting search open for a few seconds and answers as soon as a match is made.
    queryFn: ({ signal }) => api("/matchmaking/search", queueSchema, search, signal),
    refetchInterval: 400, retry: false,
  });
  useEffect(() => {
    if (queue.data?.conversation) client.setQueryData(callKey, queue.data.conversation);
  }, [queue.data, client, callKey]);
  useEffect(() => {
    if (active) {
      previousCall.current = active.id;
      setSearch(null);
      stopPreview();  // The call opens its own camera and microphone tracks.
    } else if (previousCall.current && !next.isPending) {
      previousCall.current = null;
      if (!search && mediaAllowed && !stopped.current) next.mutate();
    }
  }, [active?.id, search, mediaAllowed, next.isPending, next.mutate, stopPreview]);
  useEffect(() => {
    if (search && !active && queue.error instanceof ApiError && queue.error.status === 409 && !next.isPending) next.mutate();
  }, [search, active, queue.error, next.isPending, next.mutate]);
  useEffect(() => {
    if (!active || active.state !== "invited" || active.consented || !mediaAllowed) return;
    const controller = new AbortController();
    void api(`/conversations/${active.id}/accept`, conversation, {}, controller.signal)
      .then(call => { if (!controller.signal.aborted) client.setQueryData(callKey, call); })
      .catch(() => { if (!controller.signal.aborted) void client.invalidateQueries({ queryKey: callKey }); });
    return () => controller.abort();
  }, [active?.id, active?.state, active?.consented, mediaAllowed, client, callKey]);

  const busy = next.isPending || stop.isPending;
  const running = !!search || !!active;
  const start = useCallback(() => { if (!busy) next.mutate(); }, [busy, next]);
  const halt = useCallback(() => { if (!stop.isPending && (search || active)) stop.mutate(); }, [stop, search, active]);

  // Space starts or skips, Escape stops, unless you are typing.
  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable], [role=dialog]") || event.repeat) return;
      if (event.key === " ") { event.preventDefault(); start(); }
      if (event.key === "Escape") halt();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, start, halt]);

  function setFilters(value: Filters) {
    setFiltersState(value);
    try { window.localStorage.setItem(FILTERS_KEY, JSON.stringify(value)); } catch { /* Not saved in private mode. */ }
    // A running search keeps its original filters, so start a fresh one.
    if (search && !active) next.mutate();
  }

  const controls = <MeetControls running={running} busy={busy} mode={mode} premium={premium} filters={filters}
    gender={profile?.gender ?? null} country={profile?.country ?? null}
    onStart={start} onStop={halt} onFilters={setFilters} onLocked={setUpsell} />;

  const gate = !profile ? <Link className="button button-primary meet-gate" href="/account/login?next=connect">Sign in to start</Link>
    : !profile.eligible ? <Link className="button button-primary meet-gate" href="/account">Confirm you are 18+ to start</Link>
    : !enabled ? <Notice>Random chat is currently unavailable.</Notice> : null;

  return <>
    <h1 className="sr-only">Random {mode === "audio" ? "voice" : mode} chat</h1>
    {account.isPending ? <Notice>Loading…</Notice> : account.isError ? <Notice error>{errorMessage(account.error)}</Notice> :
      active?.state === "active" && mediaAllowed ? <Call key={active.id} call={active} busy={busy}
        onEnd={halt} onNext={start} autoStartMedia randomVideo studioControls={controls}
        onBlock={() => block.mutate(active.id)}
        onPeerLeft={() => void client.invalidateQueries({ queryKey: callKey })} /> :
      <RandomStudio controls={gate ?? controls} side={<WelcomePanel />}>
        <RandomTile name="Stranger" mode={mode} searching={!!search || next.isPending}
          hint={search ? "Looking for someone to talk to…" : mode === "text" ? "Your chat partner will appear here" : "Stranger's video will appear here"} />
        {preview && mode === "video" ? <LiveTile stream={preview} /> :
          <RandomTile name="You" mode={mode} local hint={mode === "video" ? "Your camera starts when you press Start" : mode === "audio" ? "Voice chat" : "Text chat"} />}
      </RandomStudio>}
    {next.isError && !(next.error instanceof ApiError && next.error.status === 402) && <Notice error>{errorMessage(next.error)}</Notice>}
    {current.isError && <Notice error>{errorMessage(current.error)}</Notice>}
    {queue.isError && !(queue.error instanceof ApiError && queue.error.status === 409) && <Notice error>{errorMessage(queue.error)}</Notice>}
    {upsell && <PremiumModal feature={upsell} onClose={() => setUpsell(null)} />}
  </>;
}
