"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, BriefcaseBusiness, Compass, HeartHandshake, LockKeyhole, Menu, MessageCircle, ShieldCheck, Sparkles, X, Activity, Shuffle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAccount } from "@/lib/client";

export const modules = [
  { slug: "connect", title: "Random Connect", description: "Meet someone new in a one-to-one conversation over video, voice, or text.", icon: Shuffle, theme: "green", action: "Start a conversation" },
  { slug: "private-rooms", title: "Private Rooms", description: "Make space for focused conversations with people you invite.", icon: LockKeyhole, theme: "blue", action: "Explore rooms" },
  { slug: "wellness", title: "Mental Wellness", description: "Find a supportive space for peer listening and professional guidance.", icon: HeartHandshake, theme: "pink", action: "Explore wellness" },
  { slug: "business", title: "Business Connect", description: "Connect with founders, independent professionals, and mentors.", icon: BriefcaseBusiness, theme: "gold", action: "Explore networking" },
  { slug: "fitness", title: "Fitness & Health", description: "Meet accountability partners and find fitness communities.", icon: Activity, theme: "mint", action: "Explore fitness" },
  { slug: "astrology", title: "Astrology Connect", description: "Discover practitioners and explore one-to-one consultations.", icon: Sparkles, theme: "violet", action: "Explore astrology" },
] as const;

export function Brand() {
  return <Link className="brand" href="/">
    <span className="brand-icon"><MessageCircle size={19} strokeWidth={2.5} /><span /></span>
    <span>Trust Meet</span>
  </Link>;
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const account = useAccount();
  const profile = account.data;
  const links = [{ href: "/", name: "Discover", icon: Compass },
    ...modules.map(({slug, title, icon}) => ({ href: "/" + slug, name: title, icon }))];
  return <div className="shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className={"sidebar" + (open ? " sidebar-open" : "")} id="navigation">
      <div className="sidebar-top"><Brand /><button className="icon-button mobile-only" aria-label="Close menu" onClick={() => setOpen(false)}><X size={21} /></button></div>
      <nav aria-label="Main navigation">
        <span className="nav-label">WORKSPACE</span>
        {links.map(({ href, name, icon: Icon }) => <Link key={href} href={href}
          onClick={() => setOpen(false)} aria-current={path === href ? "page" : undefined}>
          <Icon size={18} strokeWidth={1.8} />{name}
        </Link>)}
      </nav>
      <div className="sidebar-bottom">
        <Link href="/safety" className="trust-card" onClick={() => setOpen(false)}>
          <ShieldCheck size={21} /><span><strong>Safety Center</strong><small>Tools for safer conversations</small></span><ArrowUpRight size={14} />
        </Link>
        <div className="sidebar-footer"><Link href="/about" onClick={() => setOpen(false)}>About</Link><Link href="/privacy" onClick={() => setOpen(false)}>Privacy</Link></div>
      </div>
    </aside>
    {open && <button className="mobile-backdrop" aria-label="Dismiss menu" onClick={() => setOpen(false)} />}
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-only" aria-label="Open menu" aria-expanded={open} aria-controls="navigation" onClick={() => setOpen(!open)}><Menu size={22} /></button>
          <span className="desktop-only">{path === "/" ? "Discovery" : (links.find(link => link.href === path)?.name ?? "Trust Meet")}</span>
          <div className="mobile-only"><Brand /></div>
        </div>
        <div className="topbar-right">
          <Link className="top-safety icon-button" aria-label="Safety Center" href="/safety"><ShieldCheck size={20} /></Link>
          <span className="top-divider" aria-hidden="true" />
          {profile ? <Link className="profile-link" href="/account" aria-label="Account settings">
            <span className="avatar">{Array.from(profile.display_name)[0]?.toUpperCase()}</span><span className="desktop-only">{profile.display_name}</span>
          </Link> : <Link className="button button-small button-outline" href="/account/login">Sign in</Link>}
        </div>
      </header>
      <main id="main" className="main-content">{children}</main>
      <footer className="workspace-footer"><span>Trust Meet</span><span>Real People. Real Conversations.</span></footer>
    </div>
  </div>;
}
