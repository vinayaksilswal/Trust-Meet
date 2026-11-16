"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { mode, privateRoom, roomSummary, token } from "@conviya/contracts";
import { Field, Notice } from "@conviya/ui";
import { ArrowLeft, Link2, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api, errorMessage, useAccount } from "@/lib/client";
import { Call } from "./call";

const inviteResult = z.object({ token, expires_at: z.string() });
const invitationKey = "conviya-private-room-invitation";

export function PrivateRooms({ id }: { id?: string }) {
  const account = useAccount();
  const profile = account.data;
  return <>
    <div className="page-intro"><h1>Private Rooms</h1><p>Host a conversation with people you invite.</p></div>
    {account.isPending ? <Notice>Loading your account…</Notice> :
     account.isError ? <Notice error>{errorMessage(account.error)} <button onClick={() => account.refetch()}>Try again</button></Notice> :
     !profile ? <div className="content-panel connect-panel"><p>Sign in with a verified account to host or join.</p>
       <Link className="button button-primary" href="/account/login?next=rooms">Sign in</Link>
       <SaveInvitation />
     </div> :
     !profile.eligible ? <div className="content-panel connect-panel"><p>Complete adult eligibility before joining a private room.</p><Link className="button button-primary" href="/account">Go to account</Link><SaveInvitation /></div> :
     !profile.private_rooms_enabled ? <Notice>Private rooms are currently unavailable.</Notice> :
     id ? <Room id={id} accountId={profile.id} /> : <RoomDirectory accountId={profile.id} />}
  </>;
}

function saveInvitation() {
  const fragment = token.safeParse(window.location.hash.slice(1));
  if (fragment.success) {
    sessionStorage.setItem(invitationKey, fragment.data);
    window.history.replaceState(null, "", window.location.pathname);
  }
  return token.safeParse(sessionStorage.getItem(invitationKey));
}

function SaveInvitation() {
  useEffect(() => { saveInvitation(); }, []);
  return null;
}

function RoomDirectory({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [invitation, setInvitation] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const rooms = useQuery({
    queryKey: ["rooms", accountId],
    queryFn: ({ signal }) => api("/rooms", z.array(roomSummary), undefined, signal),
  });
  useEffect(() => {
    const saved = saveInvitation();
    if (saved.success) { setInvitation(saved.data); setShowJoin(true); }
  }, []);
  const create = useMutation({
    mutationFn: (data: FormData) => {
      const start = String(data.get("starts_at") ?? "");
      return api("/rooms", roomSummary, {
        title: String(data.get("title")).trim(),
        mode: mode.parse(data.get("mode")),
        capacity: Number(data.get("capacity")),
        password: data.get("password") || null,
        approval_required: data.has("approval"),
        starts_at: start ? new Date(start).toISOString() : null,
        duration_minutes: Number(data.get("duration")),
      });
    },
    onSuccess: room => router.push("/private-rooms/" + room.id),
  });
  const join = useMutation({
    mutationFn: (data: FormData) => api("/rooms/join", roomSummary, {
      token: token.parse(invitation.trim()), password: data.get("password") || null,
    }),
    onSuccess: room => {
      sessionStorage.removeItem(invitationKey);
      router.push("/private-rooms/" + room.id);
    },
  });

  return <div className="rooms-layout">
    <section className="content-panel connect-panel">
      <h2>Your rooms</h2>
      {rooms.isPending ? <p>Loading rooms…</p> : rooms.isError ?
        <Notice error>{errorMessage(rooms.error)} <button onClick={() => rooms.refetch()}>Try again</button></Notice> :
        rooms.data.length ? <ul className="room-list">{rooms.data.map(room =>
          <li key={room.id}><Link href={"/private-rooms/" + room.id}><LockKeyhole size={17} /><span>
            <strong>{room.title}</strong><small>{room.host ? "Host" : room.state === "waiting" ? "Awaiting approval" : "Participant"} · {new Date(room.starts_at).toLocaleString()}</small>
          </span></Link></li>)}</ul> : <p>You have no open private rooms.</p>}
      <button className="button button-outline" aria-expanded={showJoin} onClick={() => setShowJoin(!showJoin)}>Join by invitation</button>
      {showJoin && <form className="form-stack" onSubmit={event => { event.preventDefault(); join.mutate(new FormData(event.currentTarget)); }}>
        <Field label="Private room invitation" value={invitation} required onChange={event => {
          const raw = event.target.value;
          setInvitation(raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw);
        }} />
        <Field label="Invitation password (if required)" type="password" name="password" minLength={8} maxLength={72} autoComplete="off" />
        {join.isError && <Notice error>{join.error instanceof z.ZodError ? "Enter a valid invitation code." : errorMessage(join.error)}</Notice>}
        <button className="button button-primary" disabled={join.isPending}>Request to join</button>
      </form>}
    </section>
    <section className="content-panel connect-panel">
      <h2>Create a room</h2>
      <form className="form-stack" onSubmit={event => { event.preventDefault(); create.mutate(new FormData(event.currentTarget)); }}>
        <Field label="Room title" name="title" required minLength={2} maxLength={80} />
        <div className="room-fields">
          <label className="field">Mode<select name="mode"><option value="video">Video</option><option value="audio">Voice</option><option value="text">Text</option></select></label>
          <Field label="Capacity (including you)" type="number" name="capacity" min={2} max={12} defaultValue={4} required />
          <label className="field">Duration<select name="duration"><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option></select></label>
          <Field label="Scheduled start (optional)" type="datetime-local" name="starts_at" />
        </div>
        <Field label="Room password (optional)" type="password" name="password" minLength={8} maxLength={72} autoComplete="new-password" />
        <label className="room-checkbox"><input type="checkbox" name="approval" defaultChecked /> Require host approval</label>
        {create.isError && <Notice error>{errorMessage(create.error)}</Notice>}
        <button className="button button-primary" disabled={create.isPending}>Create private room</button>
      </form>
    </section>
  </div>;
}

function Room({ id, accountId }: { id: string; accountId: string }) {
  const [joined, setJoined] = useState(false);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const room = useQuery({
    queryKey: ["rooms", accountId, id],
    queryFn: ({ signal }) => api("/rooms/" + id, privateRoom, undefined, signal),
    refetchInterval: 2_000,
  });
  const action = useMutation({
    mutationFn: async ({ verb, participant, locked }: { verb: string; participant?: string; locked?: boolean }) => {
      const path = "/rooms/" + id + (participant ? "/members/" + participant : "") + "/" + verb;
      if (verb === "invitations") {
        const result = await api(path, inviteResult, {});
        setLink(window.location.origin + "/private-rooms#" + result.token);
        setCopied(false);
      } else {
        await api(path, z.null(), locked === undefined ? {} : { locked });
      }
    },
    onSettled: () => { void room.refetch(); },
  });
  if (room.isPending) return <Notice>Loading room…</Notice>;
  if (room.isError) return <Notice error>{errorMessage(room.error)} <button onClick={() => room.refetch()}>Try again</button></Notice>;
  const value = room.data;
  const started = Date.parse(value.starts_at) <= Date.now();
  const approved = value.state === "approved" && !value.closed;
  return <section className="content-panel connect-panel">
    <Link className="back-link" href="/private-rooms"><ArrowLeft size={16} /> Your rooms</Link>
    <h2>{value.title}</h2>
    <p>{value.mode === "audio" ? "Voice" : value.mode} · Capacity {value.capacity} · {new Date(value.starts_at).toLocaleString()}</p>
    {value.closed ? <Notice>This room has closed.</Notice> :
      value.state === "waiting" ? <Notice>Waiting for the host to approve your request.</Notice> :
      !approved ? <Notice>You no longer have access to this room.</Notice> :
      !started ? <Notice>The room has not started yet.</Notice> :
      joined ? <Call key={id} group call={{ id, mode: value.mode, partner: value.title, expires_at: value.ends_at }}
        busy={false} onEnd={() => setJoined(false)} /> :
      <div className="action-row"><button className="button button-primary" onClick={() => setJoined(true)}>Join call</button></div>}
    {value.host && !value.closed && <div className="room-host">
      <h2>Host controls</h2>
      <div className="action-row">
        <button className="button button-outline" disabled={action.isPending || value.locked} onClick={() => action.mutate({ verb: "invitations" })}>Create room invitation</button>
        <button className="button button-outline" disabled={action.isPending} onClick={() => action.mutate({ verb: "lock", locked: !value.locked })}>{value.locked ? "Unlock room" : "Lock room"}</button>
        <button className="button button-danger" disabled={action.isPending} aria-expanded={confirmClose} onClick={() => setConfirmClose(!confirmClose)}>Close room</button>
      </div>
      {confirmClose && <div className="action-row"><p>Closing ends the room for everyone.</p><button className="button button-danger" disabled={action.isPending} onClick={() => action.mutate({ verb: "close" })}>Confirm close</button></div>}
      {link && !value.locked && <div className="form-stack">
        <Field label="Room invitation link" value={link} readOnly onFocus={event => event.target.select()} />
        <button className="button button-outline" onClick={async () => {
          try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
        }}><Link2 size={16} /> {copied ? "Link copied" : "Copy link"}</button>
      </div>}
      <h2>Participants</h2>
      {value.participants.length ? <ul className="room-list">{value.participants.map(person => <li key={person.id} className="room-member">
        <span><strong>{person.name}</strong><small>{person.state === "waiting" ? "Waiting" : "Approved"}</small></span>
        <div className="action-row">
          {person.state === "waiting" ? <button className="button button-small button-primary" disabled={action.isPending || value.locked} onClick={() => action.mutate({ verb: "approve", participant: person.id })}>Approve {person.name}</button> :
           value.mode !== "text" && <button className="button button-small button-outline" disabled={action.isPending} onClick={() => action.mutate({ verb: "mute", participant: person.id })}>Mute {person.name}</button>}
          <button className="button button-small button-danger" disabled={action.isPending} onClick={() => action.mutate({ verb: "remove", participant: person.id })}>Remove {person.name}</button>
        </div>
      </li>)}</ul> : <p>No guests have requested access.</p>}
    </div>}
    {action.isError && <Notice error>{errorMessage(action.error)}</Notice>}
  </section>;
}
