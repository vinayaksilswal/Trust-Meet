"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Mic, ShieldCheck, Video, MessageCircle } from "lucide-react";
import { modules } from "./shell";
import { useAccount } from "@/lib/client";

export function Discovery() {
  const { data: account } = useAccount();
  return <>
    <div className="page-intro">
      <h1>{account ? `Welcome, ${account.display_name.split(" ")[0]}` : "Discover Trust Meet"}</h1>
      <p>Find your next conversation, community, or connection.</p>
    </div>
    <section className="hero" aria-labelledby="hero-title">
      <Image src="/conversation-hero.webp" alt="" fill sizes="(max-width: 740px) 100vw, 1050px" preload />
      <div className="hero-overlay" />
      <div className="hero-content">
        <span className="hero-label"><span /> RANDOM CONNECT</span>
        <h2 id="hero-title">Real people.<br />Real conversations.</h2>
        <p>A fresh conversation is one connection away. Choose video, voice, or text and meet someone new.</p>
        <div className="hero-actions">
          <Link href="/connect" className="button button-light">Find a conversation <ArrowRight size={18} /></Link>
          <Link href="/safety" className="hero-link"><ShieldCheck size={17} /> Safety first</Link>
        </div>
      </div>
      <div className="hero-media" aria-hidden="true"><Video size={17} /><Mic size={17} /><MessageCircle size={16} /></div>
    </section>
    <section className="explore" aria-labelledby="explore-title">
      <div className="section-heading"><h2 id="explore-title">Explore Trust Meet</h2><p>Choose a space that fits the conversation you want to have.</p></div>
      <div className="module-grid">
        {modules.map(({ slug, title, description, icon: Icon, theme, action }) => <Link key={slug} href={"/" + slug} className={"module-card theme-" + theme}>
          <div className="card-top"><span className="module-icon"><Icon size={22} strokeWidth={1.85} /></span><ArrowUpRight className="card-arrow" size={18} /></div>
          <h3>{title}</h3><p>{description}</p>
          <span className="card-link">{action}<ArrowRight size={15} /></span>
        </Link>)}
      </div>
    </section>
    <section className="safety-banner"><ShieldCheck size={25} /><div><h2>Stay in control</h2><p>Choose how you connect and leave a conversation at any time.</p></div><Link href="/safety">Visit the Safety Center <ArrowRight size={16} /></Link></section>
  </>;
}
