"use client";

import type { Mode } from "@conviya/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe2, Lock, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api, errorMessage } from "@/lib/client";
import type { PremiumFeature } from "./premium";

export type Filters = { gender: "" | "male" | "female"; region: string };

export const regions: [string, string][] = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["AU", "Australia"],
  ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["SG", "Singapore"], ["MY", "Malaysia"],
  ["ID", "Indonesia"], ["PH", "Philippines"], ["BD", "Bangladesh"], ["NP", "Nepal"], ["LK", "Sri Lanka"],
  ["PK", "Pakistan"], ["DE", "Germany"], ["FR", "France"], ["IT", "Italy"], ["ES", "Spain"], ["BR", "Brazil"],
];
const regionName = (code: string) => regions.find(([value]) => value === code)?.[1] ?? code;

type Props = {
  running: boolean; busy: boolean; mode: Mode; premium: boolean; filters: Filters;
  gender: "male" | "female" | "other" | null; country: string | null;
  onStart: () => void; onStop: () => void; onFilters: (filters: Filters) => void; onLocked: (feature: PremiumFeature) => void;
};

export function MeetControls({ running, busy, mode, premium, filters, gender, country, onStart, onStop, onFilters, onLocked }: Props) {
  const [open, setOpen] = useState<"region" | "gender" | null>(null);
  const label = running ? "Next" : mode === "video" ? "Start" : mode === "audio" ? "Start voice" : "Start chat";
  function toggle(kind: "region" | "gender") {
    if (!premium) return onLocked(kind);
    setOpen(open === kind ? null : kind);
  }
  return <div className="meet-controls">
    <div className="meet-primary">
      <button className="meet-start" disabled={busy} onClick={onStart}>
        <strong>{label}</strong><small>(Space)</small>
      </button>
      {running && <button className="meet-stop" disabled={busy} onClick={onStop}><strong>Stop</strong><small>(Esc)</small></button>}
    </div>
    <div className="meet-filter-wrap">
      <button className="meet-filter" aria-expanded={open === "region"} aria-haspopup="dialog" onClick={() => toggle("region")}>
        {!premium && <Lock className="meet-lock" size={13} aria-label="Premium" />}
        <Globe2 size={18} /> <span>{premium && filters.region ? regionName(filters.region) : "Region"}</span>
      </button>
      {open === "region" && <Popover onClose={() => setOpen(null)} label="Region filter">
        <p className="popover-title">Match with people in</p>
        <select autoFocus value={filters.region} aria-label="Region" onChange={event => { onFilters({ ...filters, region: event.target.value }); setOpen(null); }}>
          <option value="">Any country</option>
          {regions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        {country && <p className="popover-note">You appear as {regionName(country)}.</p>}
      </Popover>}
    </div>
    <div className="meet-filter-wrap">
      <button className="meet-filter" aria-expanded={open === "gender"} aria-haspopup="dialog" onClick={() => toggle("gender")}>
        {!premium && <Lock className="meet-lock" size={13} aria-label="Premium" />}
        <Users size={18} /> <span>{premium && filters.gender ? (filters.gender === "female" ? "Women" : "Men") : "Gender"}</span>
      </button>
      {open === "gender" && <Popover onClose={() => setOpen(null)} label="Gender filter">
        <GenderSettings gender={gender} filters={filters} onFilters={onFilters} />
      </Popover>}
    </div>
  </div>;
}

function GenderSettings({ gender, filters, onFilters }: { gender: Props["gender"]; filters: Filters; onFilters: Props["onFilters"] }) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (value: string) => api("/profile/gender", z.object({ gender: z.string().nullable() }), { gender: value || null }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["account"] }),
  });
  return <>
    <p className="popover-title">I am</p>
    <div className="segmented" role="radiogroup" aria-label="Your gender">
      {([["male", "Male"], ["female", "Female"], ["other", "Other"]] as const).map(([value, name]) =>
        <button key={value} role="radio" aria-checked={gender === value} disabled={save.isPending}
          onClick={() => save.mutate(gender === value ? "" : value)}>{name}</button>)}
    </div>
    <p className="popover-title">Match with</p>
    <div className="segmented" role="radiogroup" aria-label="Match with">
      {([["", "Anyone"], ["female", "Women"], ["male", "Men"]] as const).map(([value, name]) =>
        <button key={name} role="radio" aria-checked={filters.gender === value}
          onClick={() => onFilters({ ...filters, gender: value })}>{name}</button>)}
    </div>
    {filters.gender && !gender && <p className="popover-note">Add your own gender so people filtering by gender can meet you.</p>}
    {save.isError && <p className="popover-note error">{errorMessage(save.error)}</p>}
  </>;
}

function Popover({ children, onClose, label }: { children: React.ReactNode; onClose: () => void; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function away(event: MouseEvent) { if (box.current && !box.current.parentElement?.contains(event.target as Node)) onClose(); }
    function key(event: KeyboardEvent) { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key, true); };
  }, [onClose]);
  return <div className="popover" role="dialog" aria-label={label} ref={box}>{children}</div>;
}
