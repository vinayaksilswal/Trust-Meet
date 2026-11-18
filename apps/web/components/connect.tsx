"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { conversation } from "@conviya/contracts";
import { Notice } from "@conviya/ui";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { ApiError, api, errorMessage, useAccount } from "@/lib/client";
import { Call } from "./call";
import { RandomControls } from "./random-controls";
import { RandomStudio, RandomTile, WaitingChat } from "./random-studio";

const queueSchema = z.object({ waiting: z.boolean(), conversation: conversation.nullable() });
type Search = { search_id: string; mode: "video"; auto_connect: true };

export function Connect() {
  const account = useAccount();
  const client = useQueryClient();
  const profile = account.data;
  const enabled = !!profile?.eligible && profile.conversations_enabled && profile.matchmaking_enabled;
  const callKey = useMemo(() => ["conversation", profile?.id], [profile?.id]);
  const [search, setSearch] = useState<Search | null>(null);
  const [mediaAllowed, setMediaAllowed] = useState(false);
  const nextInProgress = useRef(false);
  const current = useQuery({
    queryKey: callKey, enabled,
    queryFn: ({ signal }) => api("/conversations/current", conversation.nullable(), undefined, signal),
    refetchInterval: 2000,
  });
  const active = current.data;
  const next = useMutation({
    mutationFn: async () => {
      if (nextInProgress.current) return;
      nextInProgress.current = true;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new ApiError(0, "Open Trust Meet over HTTPS to use your camera and microphone.");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          stream.getTracks().forEach(track => track.stop());
          setMediaAllowed(true);
        } catch {
          throw new ApiError(0, "Allow camera and microphone access, then click Next.");
        }
        await client.cancelQueries({ queryKey: ["random-video-queue", profile?.id] });
        const existing = await api("/conversations/current", conversation.nullable());
        if (existing) await api(`/conversations/${existing.id}/end`, z.null(), {});
        const choice: Search = { search_id: crypto.randomUUID(), mode: "video", auto_connect: true };
        const result = await api("/matchmaking/search", queueSchema, { ...choice, start: true });
        client.setQueryData(callKey, result.conversation);
        setSearch(choice);
      } finally { nextInProgress.current = false; }
    },
  });
  const queue = useQuery({
    queryKey: ["random-video-queue", profile?.id, search, active?.id],
    enabled: enabled && !!search && !active && !next.isPending,
    queryFn: ({ signal }) => api("/matchmaking/search", queueSchema, search, signal),
    refetchInterval: 2000, retry: false,
  });
  useEffect(() => {
    if (queue.data?.conversation) client.setQueryData(callKey, queue.data.conversation);
  }, [queue.data, client, callKey]);
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

  if (account.isPending) return <Notice>Loading your account…</Notice>;
  if (account.isError) return <Notice error>{errorMessage(account.error)}</Notice>;
  if (!profile) return <><h1>Random Video</h1><Link className="button button-primary" href="/account/login?next=connect">Sign in to connect</Link></>;
  if (!profile.eligible) return <><h1>Random Video</h1><Link className="button button-primary" href="/account">Enter your date of birth to continue</Link></>;
  if (!enabled) return <Notice>Random Video is currently unavailable.</Notice>;
  return <>
    <div className="random-heading"><h1>Random Video</h1></div>
    {active?.state === "active" && mediaAllowed ? <Call key={active.id} call={active} busy={next.isPending}
      onEnd={() => next.mutate()} onNext={() => next.mutate()} autoStartMedia randomVideo /> :
      <RandomStudio side={<WaitingChat />} controls={<>
        <RandomControls busy={next.isPending || current.isPending} onNext={() => next.mutate()} />
        <Notice>{next.isPending ? "Starting your next search…" : search ? "Looking for your next match…" : "Click Next and allow camera and microphone access to start."}</Notice>
      </>}>
        <RandomTile name="Your match" mode="video" hint={search ? "Finding your next match…" : "Your match’s video will appear here"} />
        <RandomTile name="You" mode="video" local hint="Your camera and microphone start when you connect" />
      </RandomStudio>}
    {next.isError && <Notice error>{errorMessage(next.error)}</Notice>}
    {current.isError && <Notice error>{errorMessage(current.error)}</Notice>}
    {queue.isError && !(queue.error instanceof ApiError && queue.error.status === 409) && <Notice error>{errorMessage(queue.error)}</Notice>}
  </>;
}
