"use client";

import { MessageCircle, Mic, Send, UserRound, Video, VideoOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import type { Mode } from "@conviya/contracts";
import { site } from "@/lib/site";

const modeIcons = { video: Video, audio: Mic, text: MessageCircle };

// Two tiles side by side, the control bar beneath them, and the rules or chat panel on the right.
export function RandomStudio({ children, controls, side }: {
  children: ReactNode; controls: ReactNode; side: ReactNode;
}) {
  return <div className="meet">
    <div className="meet-tiles">{children}</div>
    <section className="meet-bar" aria-label="Connection controls">{controls}</section>
    <aside className="meet-side" aria-label="Conversation panel">{side}</aside>
  </div>;
}

export function RandomTile({ name, mode, hint, children, feed, local, searching }: {
  name: string; mode: Mode; hint: string; children?: ReactNode; feed?: Ref<HTMLDivElement>; local?: boolean; searching?: boolean;
}) {
  const Icon = local && mode === "video" ? VideoOff : modeIcons[mode];
  return <section className={"meet-tile" + (local ? " meet-tile-local" : "")} aria-label={name}>
    <div className="meet-placeholder">
      {searching ? <span className="meet-spinner" aria-hidden="true" /> : <span className="meet-placeholder-icon"><Icon size={26} strokeWidth={1.6} /></span>}
      <p>{hint}</p>{children}
    </div>
    {feed && <div className={"meet-feed" + (local ? " meet-feed-local" : "")} ref={feed}
      data-testid={local ? "local-preview" : "remote-video"} />}
    {local ? <span className="meet-you">You</span> : <span className="meet-watermark">{site.name}</span>}
    {!local && name !== "Stranger" && <span className="meet-name"><UserRound size={13} aria-hidden="true" />{name}</span>}
  </section>;
}

export function LiveTile({ stream }: { stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (video.current) video.current.srcObject = stream; }, [stream]);
  return <section className="meet-tile meet-tile-local" aria-label="You">
    <div className="meet-feed meet-feed-local"><video ref={video} muted autoPlay playsInline data-testid="local-preview" /></div>
    <span className="meet-you">You</span>
  </section>;
}

export function WelcomePanel() {
  return <div className="meet-panel">
    <div className="meet-welcome">
      <h2>Welcome to {site.name}.</h2>
      <p className="meet-age"><span>18+</span> You must be 18+</p>
      <ul>
        <li>No nudity, hate speech, or harassment</li>
        <li>Keep your camera on and your face visible</li>
        <li>Never share personal or payment details</li>
        <li>Violations result in a ban</li>
      </ul>
      <Link href="/guidelines">Community Guidelines</Link>
    </div>
    <form className="meet-compose" onSubmit={event => event.preventDefault()}>
      <input disabled placeholder="Chat opens when you connect" aria-label="Message" />
      <button disabled aria-label="Send"><Send size={18} /></button>
    </form>
  </div>;
}
