"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { conversation, invite, token, type Mode } from "@conviya/contracts";
import { Field, Notice } from "@conviya/ui";
import { ArrowRight, Link2, MessageCircle, Mic, Video } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { ApiError, api, errorMessage, useAccount } from "@/lib/client";
import { Call } from "./call";
import { PreviewTile, RandomStudio, RandomTile, WaitingChat } from "./random-studio";

const modes = [
  { name: "Video", id: "video", icon: Video },
  { name: "Voice", id: "audio", icon: Mic },
  { name: "Text", id: "text", icon: MessageCircle },
] as const;

const queueSchema = z.object({ waiting: z.boolean(), conversation: conversation.nullable() });
type Choice = { search_id: string; mode: Mode; language: string; country: string; interests: string[] };

const searchEnded = (error: unknown) => error instanceof ApiError && error.status === 409;

export function Connect() {
  const account = useAccount();
  const client = useQueryClient();
  const profile = account.data;
  const canConnect = !!profile?.eligible && profile.conversations_enabled;
  const callKey = useMemo(() => ["conversation", profile?.id], [profile?.id]);
  const [mode, setMode] = useState<Mode>("video");
  const [preferences, setPreferences] = useState({ language: "", country: "", interests: "" });
  const [searching, setSearching] = useState<Choice | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [autoMediaFor, setAutoMediaFor] = useState<string>();
  const stopPreview = useRef<() => void>(null);

  useEffect(() => {
    const hrefToken = token.safeParse(window.location.hash.slice(1));
    if (hrefToken.success) {
      sessionStorage.setItem("conviya-invitation", hrefToken.data);
      window.history.replaceState(null, "", window.location.pathname);
    }
    const savedToken = token.safeParse(sessionStorage.getItem("conviya-invitation"));
    if (savedToken.success) { setInviteToken(savedToken.data); setAccepting(true); }
  }, []);

  const current = useQuery({
    queryKey: callKey, enabled: canConnect,
    queryFn: ({ signal }) => api("/conversations/current", conversation.nullable(), undefined, signal),
    refetchInterval: 2_000,
  });
  const active = canConnect ? current.data : null;
  const queue = useQuery({
    queryKey: ["queue", profile?.id, searching, active?.id],
    enabled: canConnect && !!searching && !active,
    queryFn: ({ signal }) => api("/matchmaking/search", queueSchema, searching, signal),
    refetchInterval: query => searchEnded(query.state.error) ? false : 2_000,
    refetchOnWindowFocus: query => !searchEnded(query.state.error),
    retry: false,
  });

  useEffect(() => {
    if (queue.data?.conversation) client.setQueryData(callKey, queue.data.conversation);
    // The search stays on until a match is declined, ended, or explicitly cancelled.
  }, [queue.data, client, callKey]);

  async function joinQueue(choice: Choice) {
    await client.cancelQueries({ queryKey: ["queue", profile?.id] });
    const result = await api("/matchmaking/search", queueSchema, { ...choice, start: true });
    setSearching(choice);
    if (result.conversation) client.setQueryData(callKey, result.conversation);
  }

  async function requestMedia(mode: Mode) {
    if (mode === "text") return;
    stopPreview.current?.();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new ApiError(0, "Open Trust Meet over trusted HTTPS to use your camera or microphone.");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: mode === "video", audio: true });
      stream.getTracks().forEach(track => track.stop());
    } catch {
      throw new ApiError(0, mode === "video"
        ? "Allow camera and microphone access, then try finding a match again."
        : "Allow microphone access, then try finding a match again.");
    }
  }

  const action = useMutation({
    mutationFn: async (verb: "invite" | "accept-invite" | "accept-match" | "end" | "next" | "cancel" | "block" | "search") => {
      if (verb === "search") {
        const choice = searching ?? {
          mode, language: preferences.language.trim(), country: preferences.country,
          interests: [...new Set(preferences.interests.split(",").map(value => value.trim().slice(0, 40)).filter(Boolean))].slice(0, 5),
        };
        await requestMedia(choice.mode);
        await joinQueue({ ...choice, search_id: crypto.randomUUID() });
      } else if (verb === "invite") {
        const result = await api("/conversations/invitations", invite, { mode });
        setInviteUrl(window.location.origin + "/connect#" + result.token);
        setCopied(false);
      } else if (verb === "accept-invite") {
        const result = await api("/conversations/invitations/accept", conversation, { token: token.parse(inviteToken.trim()) });
        client.setQueryData(callKey, result);
        sessionStorage.removeItem("conviya-invitation");
        setInviteToken("");
        setAccepting(false);
      } else if (verb === "cancel" && searching) {
        setSearching(null);
        await client.cancelQueries({ queryKey: ["queue", profile?.id] });
        await api("/matchmaking/cancel", z.null(), { search_id: searching.search_id, mode: searching.mode });
      } else if (active) {
        if (verb === "accept-match") {
          if (searching?.mode === active.mode) setAutoMediaFor(active.id);
          const result = await api("/conversations/" + active.id + "/accept", conversation, {});
          client.setQueryData(callKey, result);
        } else {
          setSearching(null);
          await api("/conversations/" + active.id + "/" + (verb === "block" ? "block" : "end"), z.null(), {});
          setInviteUrl("");
          client.setQueryData(callKey, null);
          if (verb === "next" && searching) await joinQueue({ ...searching, search_id: crypto.randomUUID() });
        }
      }
      await client.invalidateQueries({ queryKey: callKey });
    },
  });

  const modeOnStage = active?.mode ?? searching?.mode ?? mode;
  const controls = <>
      {account.isPending ? <Notice>Loading your account…</Notice> :
       account.isError ? <Notice error>{errorMessage(account.error)}<button onClick={() => account.refetch()}>Try again</button></Notice> :
       !profile ? <><h2>Sign in to connect</h2><p>Use a verified Trust Meet account to open or join a conversation.</p>
         <div className="action-row"><Link className="button button-primary" href="/account/login?next=connect">Sign in <ArrowRight size={16} /></Link><Link className="button button-outline" href="/account/register">Create an account</Link></div></> :
       !profile.eligible ? <><h2>Check your eligibility</h2><p>Complete the adult eligibility check for this account.</p><Link className="button button-primary" href="/account">Go to account</Link></> :
       !profile.conversations_enabled ? <Notice>Conversations are currently unavailable.</Notice> :
       current.isPending ? <Notice>Checking for an open conversation…</Notice> :
       current.isError && !active ? <Notice error>{errorMessage(current.error)}<button onClick={() => current.refetch()}>Try again</button></Notice> :
       active?.state === "invited" ? <>
         <h2>{active.partner ? "Conversation invitation" : "Invitation link ready"}</h2>
         {active.partner ? <Notice>{active.consented ? "Waiting for the other participant to accept…" : active.partner + " is available for a " + active.mode + " conversation."}</Notice> :
          <p>Share this link with one eligible Trust Meet user. The invitation expires in ten minutes.</p>}
         {inviteUrl && !active.partner && <div className="form-stack"><Field label="Invitation link" value={inviteUrl} readOnly onFocus={event => event.target.select()} />
           <button className="button button-outline" onClick={async () => {
             try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); } catch { setCopied(false); }
           }}><Link2 size={16} />{copied ? "Link copied" : "Copy invitation"}</button></div>}
         <div className="action-row random-entry-actions">
           {active.partner && !active.consented && <button className="button button-primary" disabled={action.isPending} onClick={() => action.mutate("accept-match")}>Accept match</button>}
           {searching && <button className="button button-outline" disabled={action.isPending} onClick={() => action.mutate("next")}>Skip and find next</button>}
           <button className="button button-danger" disabled={action.isPending} onClick={() => action.mutate("end")}>{active.partner ? "Decline match" : "Cancel invitation"}</button>
         </div></> :
       searching ? <>
         <h2>{searchEnded(queue.error) ? "Search ended" : "Looking for someone"}</h2>
         {!queue.isError && <Notice>No conversation yet. You can keep waiting or leave the queue.</Notice>}
         {queue.isError && <Notice error>{errorMessage(queue.error)} <button disabled={action.isPending} onClick={() => searchEnded(queue.error) ? action.mutate("search") : queue.refetch()}>{searchEnded(queue.error) ? "Start a new search" : "Try again"}</button></Notice>}
         <button className="button button-outline" disabled={action.isPending} onClick={() => action.mutate("cancel")}>Leave queue</button>
       </> : <>
         <div className="random-entry">
         <fieldset className="mode-picker"><legend>Conversation mode</legend>
           {modes.map(({ name, id, icon: Icon }) => <label className="mode-choice" key={id}>
             <input type="radio" name="mode" value={id} checked={mode === id} onChange={() => setMode(id)} /><Icon size={18} /> {name}
           </label>)}
         </fieldset>
         <div className="action-row random-entry-actions">
           {profile.matchmaking_enabled && <button className="button button-primary" disabled={action.isPending} onClick={() => action.mutate("search")}>Find a match <ArrowRight size={16} /></button>}
           <button className={"button " + (profile.matchmaking_enabled ? "button-outline" : "button-primary")} disabled={action.isPending} onClick={() => action.mutate("invite")}>Create invitation</button>
           <button className="button button-outline" aria-expanded={accepting} onClick={() => setAccepting(!accepting)}>Join by invitation</button>
         </div>
         </div>
         {profile.matchmaking_enabled && mode !== "text" && <p className="random-match-permission">
           {mode === "video" ? "Your camera and microphone turn on" : "Your microphone turns on"} after both people accept.
         </p>}
         {profile.matchmaking_enabled && <details className="form-stack"><summary>Matching preferences</summary>
           <Field label="Language" maxLength={24} placeholder="e.g. English" value={preferences.language} onChange={event => setPreferences({ ...preferences, language: event.target.value })} />
           <label className="field">Country preference<select value={preferences.country} onChange={event => setPreferences({ ...preferences, country: event.target.value })}><option value="">Any country</option><option value="IN">India</option></select></label>
           <Field label="Interests (up to 5, comma separated)" maxLength={120} placeholder="e.g. music, startups" value={preferences.interests} onChange={event => setPreferences({ ...preferences, interests: event.target.value })} />
         </details>}
         {accepting && <form className="form-stack" onSubmit={event => { event.preventDefault(); action.mutate("accept-invite"); }}>
           <Field label="Invitation code" value={inviteToken} onChange={event => {
             const value = event.target.value;
             setInviteToken(value.includes("#") ? value.slice(value.indexOf("#") + 1) : value);
           }} required />
           <button className="button button-primary" disabled={action.isPending}>Accept invitation and join</button>
         </form>}
       </>}
      {action.isError && <Notice error>{action.error instanceof z.ZodError ? "Enter a valid invitation code." : errorMessage(action.error)}</Notice>}
  </>;

  return <>
    <div className="random-heading"><h1>Random Connect</h1><p>One-to-one conversations by video, voice, or text.</p></div>
    {active?.state === "active" ? <>
      <Call key={active.id} call={active} busy={action.isPending} autoStartMedia={autoMediaFor === active.id}
        onEnd={() => action.mutate("end")} onBlock={() => action.mutate("block")}
        onNext={searching ? () => action.mutate("next") : undefined} />
      {action.isError && <Notice error>{errorMessage(action.error)}</Notice>}
    </> : <RandomStudio side={<WaitingChat />} controls={controls}>
      <RandomTile name={active?.partner ?? "Your match"} mode={modeOnStage} hint={
        active?.state === "invited" ? "Waiting for the conversation to start" :
        searchEnded(queue.error) ? "Ready for a new search" : searching ? "Finding someone to talk to…" :
        modeOnStage === "video" ? "Your match’s video will appear here" :
        modeOnStage === "audio" ? "Your voice conversation starts here" : "Start a search to meet someone"
      } />
      <PreviewTile key={modeOnStage + String(canConnect)} mode={modeOnStage} allowPreview={canConnect} ref={stopPreview} />
    </RandomStudio>}
  </>;
}
