"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Notice } from "@conviya/ui";
import { AlertTriangle, CheckCircle2, Search, ShieldAlert, UserX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { api, errorMessage, useAccount } from "@/lib/client";

const person = z.object({ id: z.uuid(), name: z.string(), email: z.string(), status: z.string(), created_at: z.string() });
const report = z.object({
  ref: z.string(), kind: z.enum(["conversation", "room"]), category: z.string(), state: z.string(),
  created_at: z.string(), reviewed_at: z.string().nullable(), room: z.string().optional(),
  reporter: person, subject: person, subject_reporters: z.number().nullable(), urgent: z.boolean(),
});
const overview = z.object({
  open_reports: z.number(), urgent_reports: z.number(), suspended_accounts: z.number(),
  active_calls: z.number(), reports_24h: z.number(), actions_24h: z.number(),
});
const account = person.extend({ reports: z.number(), staff: z.boolean() });
const action = z.object({
  id: z.uuid(), action: z.string(), note: z.string(), report_ref: z.string().nullable(),
  created_at: z.string(), moderator: z.string(), subject: person.nullable(),
});
type Report = z.infer<typeof report>;
type Tab = "open" | "closed" | "accounts" | "log";

const labels: Record<string, string> = {
  harassment: "Harassment", sexual_content: "Sexual content", scam: "Scam", threat: "Threat",
  underage: "Suspected minor", other: "Other",
};
const when = (value: string) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function Moderation() {
  const me = useAccount();
  const [tab, setTab] = useState<Tab>("open");
  const stats = useQuery({
    queryKey: ["moderation", "overview"], enabled: !!me.data?.moderator, refetchInterval: 15_000,
    queryFn: ({ signal }) => api("/moderation/overview", overview, undefined, signal),
  });
  if (me.isPending) return <Notice>Loading…</Notice>;
  if (!me.data?.moderator) return <div className="content-panel"><h1>Not available</h1>
    <p>This page is for the moderation team.</p><Link className="button button-primary" href="/">Home</Link></div>;
  const tiles = stats.data ? [
    ["Open reports", stats.data.open_reports], ["Urgent", stats.data.urgent_reports],
    ["Reports in 24 h", stats.data.reports_24h], ["Decisions in 24 h", stats.data.actions_24h],
    ["Suspended accounts", stats.data.suspended_accounts], ["Live calls", stats.data.active_calls],
  ] as const : [];
  return <div className="mod">
    <div className="page-intro"><h1>Moderation</h1><p>Review reports, act on accounts and see every decision the team has made.</p></div>
    <div className="mod-stats">{tiles.map(([label, value]) => <div key={label} className={"mod-stat" + (label === "Urgent" && value ? " mod-stat-alert" : "")}>
      <span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="mod-tabs" role="tablist" aria-label="Moderation views">
      {([["open", "Queue"], ["closed", "Reviewed"], ["accounts", "Accounts"], ["log", "Audit log"]] as const).map(([value, name]) =>
        <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{name}</button>)}
    </div>
    <div role="tabpanel">
      {tab === "open" || tab === "closed" ? <Reports state={tab} /> : tab === "accounts" ? <Accounts /> : <AuditLog />}
    </div>
  </div>;
}

function Reports({ state }: { state: "open" | "closed" }) {
  const list = useQuery({
    queryKey: ["moderation", "reports", state], refetchInterval: state === "open" ? 15_000 : false,
    queryFn: ({ signal }) => api(`/moderation/reports?state=${state}`, z.object({ reports: z.array(report) }), undefined, signal),
  });
  if (list.isPending) return <Notice>Loading reports…</Notice>;
  if (list.isError) return <Notice error>{errorMessage(list.error)}</Notice>;
  if (!list.data.reports.length) return <div className="mod-empty"><CheckCircle2 size={28} />
    <p>{state === "open" ? "The queue is clear." : "No reviewed reports yet."}</p></div>;
  return <ul className="mod-list">{list.data.reports.map(item => <ReportRow key={item.ref} item={item} open={state === "open"} />)}</ul>;
}

function ReportRow({ item, open }: { item: Report; open: boolean }) {
  const client = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (choice: "dismiss" | "suspend") => api(`/moderation/reports/${encodeURIComponent(item.ref)}`, z.object({ state: z.string() }), { action: choice, note }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["moderation"] }),
  });
  return <li className={"mod-card" + (item.urgent ? " mod-card-urgent" : "")}>
    <div className="mod-card-head">
      <span className={"mod-badge" + (item.urgent ? " mod-badge-urgent" : "")}>{item.urgent && <AlertTriangle size={13} />}{labels[item.category] ?? item.category}</span>
      <span className="mod-meta">{item.kind === "room" ? `Private room “${item.room}”` : "Random chat"} · {when(item.created_at)}</span>
      {!open && <span className="mod-meta">{item.state === "actioned" ? "Suspended" : "Dismissed"}{item.reviewed_at && ` · ${when(item.reviewed_at)}`}</span>}
    </div>
    <div className="mod-people">
      <div><span className="mod-role">{item.kind === "room" ? "Room host" : "Reported"}</span>
        <strong>{item.subject.name}</strong><small>{item.subject.email}</small>
        {item.subject.status === "suspended" && <span className="mod-status">Suspended</span>}
        {item.subject_reporters && item.subject_reporters > 1 && <span className="mod-count">Reported by {item.subject_reporters} people</span>}</div>
      <div><span className="mod-role">Reported by</span><strong>{item.reporter.name}</strong><small>{item.reporter.email}</small></div>
    </div>
    {open && <div className="mod-actions">
      <input aria-label="Decision note" placeholder="Note for the audit log (optional)" maxLength={500} value={note} onChange={event => setNote(event.target.value)} />
      <button className="button button-outline" disabled={decide.isPending} onClick={() => decide.mutate("dismiss")}>Dismiss</button>
      <button className="button button-danger" disabled={decide.isPending || item.subject.status === "suspended"}
        onClick={() => { if (window.confirm(`Suspend ${item.subject.name}? They are signed out and removed from calls now.`)) decide.mutate("suspend"); }}>
        <UserX size={16} /> Suspend</button>
    </div>}
    {decide.isError && <Notice error>{errorMessage(decide.error)}</Notice>}
  </li>;
}

function Accounts() {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const results = useQuery({
    queryKey: ["moderation", "accounts", submitted], enabled: submitted.length >= 2,
    queryFn: ({ signal }) => api(`/moderation/accounts?q=${encodeURIComponent(submitted)}`, z.object({ accounts: z.array(account) }), undefined, signal),
  });
  const change = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: "suspend" | "reinstate" }) => api(`/moderation/accounts/${id}/${verb}`, z.object({ status: z.string() }), { note: "" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["moderation"] }),
  });
  return <div>
    <form className="mod-search" onSubmit={event => { event.preventDefault(); setSubmitted(query.trim()); }}>
      <Search size={18} aria-hidden="true" />
      <input aria-label="Search accounts" placeholder="Search by email or display name" value={query} onChange={event => setQuery(event.target.value)} />
      <button className="button button-primary" disabled={query.trim().length < 2}>Search</button>
    </form>
    {results.isError && <Notice error>{errorMessage(results.error)}</Notice>}
    {change.isError && <Notice error>{errorMessage(change.error)}</Notice>}
    {results.data && !results.data.accounts.length && <p className="mod-empty-line">No accounts match.</p>}
    {results.data && results.data.accounts.length > 0 && <table className="mod-table">
      <thead><tr><th>Account</th><th>Joined</th><th>Reports</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead>
      <tbody>{results.data.accounts.map(user => <tr key={user.id}>
        <td><strong>{user.name}</strong><small>{user.email}</small></td><td>{when(user.created_at)}</td><td>{user.reports}</td>
        <td>{user.staff ? "Staff" : user.status === "suspended" ? <span className="mod-status">Suspended</span> : "Active"}</td>
        <td>{!user.staff && (user.status === "suspended"
          ? <button className="button button-outline button-small" disabled={change.isPending} onClick={() => change.mutate({ id: user.id, verb: "reinstate" })}>Reinstate</button>
          : <button className="button button-danger button-small" disabled={change.isPending}
            onClick={() => { if (window.confirm(`Suspend ${user.name}?`)) change.mutate({ id: user.id, verb: "suspend" }); }}>Suspend</button>)}</td>
      </tr>)}</tbody>
    </table>}
  </div>;
}

function AuditLog() {
  const log = useQuery({
    queryKey: ["moderation", "actions"],
    queryFn: ({ signal }) => api("/moderation/actions", z.object({ actions: z.array(action) }), undefined, signal),
  });
  if (log.isPending) return <Notice>Loading…</Notice>;
  if (log.isError) return <Notice error>{errorMessage(log.error)}</Notice>;
  if (!log.data.actions.length) return <div className="mod-empty"><ShieldAlert size={28} /><p>No decisions recorded yet.</p></div>;
  return <table className="mod-table">
    <thead><tr><th>When</th><th>Moderator</th><th>Decision</th><th>Account</th><th>Note</th></tr></thead>
    <tbody>{log.data.actions.map(item => <tr key={item.id}>
      <td>{when(item.created_at)}</td><td>{item.moderator}</td><td className="mod-decision">{item.action}</td>
      <td>{item.subject ? <><strong>{item.subject.name}</strong><small>{item.subject.email}</small></> : "—"}</td><td>{item.note || "—"}</td>
    </tr>)}</tbody>
  </table>;
}
