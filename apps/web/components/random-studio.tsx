"use client";

import { LockKeyhole, MessageCircle, Mic, ShieldCheck, UserRound, Video, VideoOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { Mode } from "@conviya/contracts";
import { Notice } from "@conviya/ui";

const modeIcons = { video: Video, audio: Mic, text: MessageCircle };

export function RandomStudio({ children, controls, side }: {
  children: ReactNode; controls: ReactNode; side: ReactNode;
}) {
  return <div className="random-studio">
    <div className="random-stage">
      <div className="random-tiles">{children}</div>
      <section className="random-controls" aria-label="Connection controls">{controls}</section>
    </div>
    <aside className="random-side" aria-label="Conversation chat">{side}</aside>
  </div>;
}

export function RandomTile({ name, mode, hint, children, feed, local }: {
  name: string; mode: Mode; hint: string; children?: ReactNode; feed?: Ref<HTMLDivElement>; local?: boolean;
}) {
  const Icon = local && mode === "video" ? VideoOff : modeIcons[mode];
  return <section className="random-tile" aria-label={name}>
    <div className="random-tile-placeholder"><span className="random-tile-icon"><Icon size={28} strokeWidth={1.5} /></span>
      <p>{hint}</p>{children}</div>
    {feed && <div className={"random-feed" + (local ? " random-feed-local" : "")} ref={feed}
      data-testid={local ? "local-preview" : "remote-video"} />}
    <div className="random-tile-name"><UserRound size={14} aria-hidden="true" />{name}</div>
  </section>;
}

export function PreviewTile({ mode, allowPreview }: { mode: Mode; allowPreview: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const [on, setOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const showPreview = mode === "video" && allowPreview;

  function releaseCamera() {
    generation.current++;
    camera.current?.getTracks().forEach(track => track.stop());
    camera.current = null;
    if (video.current) video.current.srcObject = null;
  }

  useEffect(() => () => releaseCamera(), []);

  async function togglePreview() {
    if (on) {
      releaseCamera();
      setOn(false);
      return;
    }
    const attempt = ++generation.current;
    setError("");
    setLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (attempt !== generation.current || !video.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      camera.current = stream;
      video.current.srcObject = stream;
      setOn(true);
    } catch {
      if (attempt === generation.current) setError("Camera unavailable. Check site permissions and try again.");
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  }

  const hint = mode === "video" ? "Your camera is off" : mode === "audio" ? "Your microphone is off" : "You're in text mode";
  if (!showPreview) return <RandomTile name="You" mode={mode} hint={hint} local />;
  return <section className="random-tile" aria-label="You">
    <div className="random-tile-placeholder"><span className="random-tile-icon"><VideoOff size={28} strokeWidth={1.5} /></span>
      <p>{hint}</p>
      {!on && <button className="random-preview-button" type="button" onClick={() => void togglePreview()} disabled={loading}>{loading ? "Opening camera…" : "Preview camera"}</button>}
      {error && <Notice error>{error}</Notice>}
    </div>
    <div className="random-feed random-feed-local" hidden={!on}><video ref={video} muted autoPlay playsInline /></div>
    <div className="random-tile-name"><UserRound size={14} aria-hidden="true" />You</div>
    {on && <button type="button" className="random-preview-button random-preview-stop" onClick={() => void togglePreview()}>Stop preview</button>}
  </section>;
}

export function WaitingChat() {
  return <>
    <div className="random-side-heading"><span className="random-side-icon"><MessageCircle size={20} /></span><div><h2>Chat</h2><p>Messages open when you connect</p></div></div>
    <div className="random-rules">
      <span className="random-rule-badge">18+</span>
      <h3>Set the tone</h3>
      <ul><li>Be respectful. Harassment and hate speech are prohibited.</li>
        <li>Keep personal details private.</li></ul>
      <Link href="/safety"><ShieldCheck size={16} /> Safety Center</Link>
    </div>
    <div className="random-chat-locked"><LockKeyhole size={16} /> Chat opens after both people accept.</div>
  </>;
}
