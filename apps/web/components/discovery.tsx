"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, BadgeCheck, Ban, Flag, Globe2, Lock, MessageCircle, Mic, ShieldCheck, Shuffle, Sparkles, UserRound, Video, Zap } from "lucide-react";
import type { Mode } from "@conviya/contracts";
import { AdSlot } from "./ads";
import { modules } from "./shell";
import { useAccount } from "@/lib/client";
import { formatCount, useOnline } from "@/lib/presence";

const modes: { value: Mode; label: string; icon: typeof Video; cta: string }[] = [
  { value: "text", label: "Text", icon: MessageCircle, cta: "Start Text Chat" },
  { value: "audio", label: "Voice", icon: Mic, cta: "Start Voice Chat" },
  { value: "video", label: "Video", icon: Video, cta: "Start Video Chat" },
];

function StartCard() {
  const { data: account } = useAccount();
  const online = useOnline();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("video");
  const choice = modes.find(item => item.value === mode)!;
  const target = account ? `/connect?mode=${mode}` : "/account/register";
  return <section className="start-card" aria-labelledby="hero-title">
    <div className="start-art" aria-hidden="true">
      <span className="start-person"><i className="start-rec" /><UserRound size={40} /></span>
      <span className="start-link" />
      <span className="start-person"><i className="start-cam"><Video size={12} /></i><UserRound size={40} /></span>
    </div>
    <h1 id="hero-title">Talk With Strangers Online</h1>
    <p className="start-sub">Random video, voice and text chat with people aged 18 and over.</p>
    {online.data && <p className="start-online"><span className="online-dot" aria-hidden="true" />
      <strong>{formatCount(online.data.online)}</strong> {online.data.online === 1 ? "person" : "people"} online right now</p>}
    <div className="start-modes" role="radiogroup" aria-label="Chat type">
      {modes.map(({ value, label, icon: Icon }) => <button key={value} type="button" role="radio" aria-checked={mode === value}
        onClick={() => setMode(value)}><Icon size={18} /> {label}</button>)}
    </div>
    <button className="start-cta" onClick={() => router.push(target)}>{choice.cta} <ArrowRight size={20} /></button>
    <ul className="start-proof" aria-label="Highlights">
      <li><Zap size={14} /> Instant match</li><li><ShieldCheck size={14} /> Moderated</li>
      <li><BadgeCheck size={14} /> 18+ only</li><li><Lock size={14} /> No recordings</li>
    </ul>
  </section>;
}

const steps = [
  { icon: BadgeCheck, title: "Create a free account", text: "Sign up with email and confirm your date of birth. It takes under a minute." },
  { icon: Shuffle, title: "Pick video, voice or text", text: "Add a language or interests if you like, then select Start. We pair you instantly." },
  { icon: Zap, title: "Talk, or tap Next", text: "Both people accept before cameras turn on. Move to someone new whenever you want." },
];

const pillars = [
  { icon: BadgeCheck, title: "Adults only", text: "Every account confirms it is 18+ before it can join a call." },
  { icon: Lock, title: "Consent before camera", text: "Your camera and microphone stay off until both people accept." },
  { icon: Ban, title: "Block for good", text: "Blocked people are never matched with you again." },
  { icon: Flag, title: "One-tap reports", text: "Report abuse from inside the call. Reports go straight to moderation." },
  { icon: Globe2, title: "Built for India", text: "Match by language and shared interests." },
  { icon: ShieldCheck, title: "Nothing recorded", text: "We never record calls or store chat messages." },
];

const faqs = [
  { q: "Is Trust Meet free?", a: "Yes. Random video, voice and text chat and Private Rooms are free. Plus is an optional monthly plan that removes ads." },
  { q: "How is this different from other random chat sites?", a: "Every user completes an 18+ date-of-birth check, cameras only turn on after both people accept, and blocks and reports work in every call." },
  { q: "Do I need to download an app?", a: "No. Trust Meet works in Chrome, Safari, Edge and Firefox on phones and computers." },
  { q: "Can I choose who I talk to?", a: "You can match by language and up to five interests. People who share more interests with you are matched first." },
  { q: "What happens when I report someone?", a: "The conversation ends for you, the report goes to our moderation team, and repeat or serious violations lead to a ban." },
];

export function Discovery() {
  return <>
    <StartCard />

    <section className="band" aria-labelledby="steps-title">
      <div className="section-heading center"><span className="eyebrow">How it works</span><h2 id="steps-title">Your next conversation in three steps</h2></div>
      <ol className="step-grid">
        {steps.map(({ icon: Icon, title, text }, index) => <li key={title} className="step-card">
          <span className="step-number" aria-hidden="true">{index + 1}</span><Icon size={22} /><h3>{title}</h3><p>{text}</p>
        </li>)}
      </ol>
    </section>

    <section className="band" aria-labelledby="explore-title">
      <div className="section-heading"><span className="eyebrow">Explore</span><h2 id="explore-title">More ways to connect</h2><p>Choose a space that fits the conversation you want.</p></div>
      <div className="module-grid">
        {modules.map(({ slug, title, description, icon: Icon, theme, action, live }) => <Link key={slug} href={"/" + slug} className={"module-card theme-" + theme}>
          <div className="card-top"><span className="module-icon"><Icon size={22} strokeWidth={1.85} /></span>{!live && <span className="soon">Soon</span>}</div>
          <h3>{title}</h3><p>{description}</p>
          <span className="card-link">{action}<ArrowRight size={15} /></span>
        </Link>)}
      </div>
    </section>

    <AdSlot />

    <section className="band trust-band" aria-labelledby="trust-title">
      <div className="section-heading"><span className="eyebrow">Trust and safety</span><h2 id="trust-title">Safety is built into every call</h2>
        <p>Random chat should be fun, not risky. These protections are on for everyone, free.</p></div>
      <div className="pillar-grid">
        {pillars.map(({ icon: Icon, title, text }) => <div key={title} className="pillar"><Icon size={20} /><div><h3>{title}</h3><p>{text}</p></div></div>)}
      </div>
    </section>

    <section className="band" aria-labelledby="faq-title">
      <div className="section-heading"><span className="eyebrow">FAQ</span><h2 id="faq-title">Questions, answered</h2></div>
      <div className="faq">
        {faqs.map(({ q, a }) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        "@context": "https://schema.org", "@type": "FAQPage",
        mainEntity: faqs.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      }) }} />
    </section>

    <section className="cta-band">
      <Sparkles size={24} />
      <div><h2>Go ad-free with Plus</h2><p>Support a safer community and remove every ad.</p></div>
      <Link className="button button-light" href="/pricing">See plans <ArrowRight size={16} /></Link>
    </section>
  </>;
}
