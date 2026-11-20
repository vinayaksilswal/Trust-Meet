"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Ban, Flag, Globe2, Lock, MessageCircle, Mic, ShieldCheck, Shuffle, Sparkles, Video, Zap } from "lucide-react";
import { AdSlot } from "./ads";
import { modules } from "./shell";
import { useAccount } from "@/lib/client";

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
  const { data: account } = useAccount();
  const start = account ? "/connect" : "/account/register";
  return <>
    <section className="hero landing-hero" aria-labelledby="hero-title">
      <Image src="/conversation-hero.webp" alt="" fill sizes="(max-width: 740px) 100vw, 1200px" preload />
      <div className="hero-overlay" />
      <div className="hero-content">
        <span className="hero-label"><span /> {account ? `WELCOME BACK, ${account.display_name.split(" ")[0].toUpperCase()}` : "18+ ONLY"}</span>
        <h1 id="hero-title">Meet someone new,<br />face to face.</h1>
        <p>Random video chat with people aged 18 and over. Free, instant and safe by design.</p>
        <div className="hero-actions">
          <Link href={start} className="button button-light button-large">{account ? "Start a video chat" : "Start chatting free"} <ArrowRight size={18} /></Link>
          <Link href="/safety" className="hero-link"><ShieldCheck size={17} /> How we keep you safe</Link>
        </div>
        <ul className="hero-proof" aria-label="Highlights">
          <li><Video size={15} /> Video</li><li><Mic size={15} /> Voice</li><li><MessageCircle size={15} /> Text</li><li><Lock size={15} /> No recordings</li>
        </ul>
      </div>
    </section>

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
