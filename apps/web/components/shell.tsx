"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, BriefcaseBusiness, Compass, Crown, Gavel, HeartHandshake, LockKeyhole, Menu, MessageCircle, ShieldCheck, Sparkles, X, Activity, Shuffle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAccount } from "@/lib/client";
import { legalLinks } from "@/lib/pages";
import { site } from "@/lib/site";
import { ConsentBanner } from "./ads";
import { OnlineBadge } from "@/lib/presence";

export const modules = [
  { slug: "connect", title: "Random Connect", description: "Meet someone new in a one-to-one conversation over video, voice, or text.", icon: Shuffle, theme: "green", action: "Start a conversation", live: true },
  { slug: "private-rooms", title: "Private Rooms", description: "Make space for focused conversations with people you invite.", icon: LockKeyhole, theme: "blue", action: "Explore rooms", live: true },
  { slug: "wellness", title: "Mental Wellness", description: "Find a supportive space for peer listening and professional guidance.", icon: HeartHandshake, theme: "pink", action: "Explore wellness", live: false },
  { slug: "business", title: "Business Connect", description: "Connect with founders, independent professionals, and mentors.", icon: BriefcaseBusiness, theme: "gold", action: "Explore networking", live: false },
  { slug: "fitness", title: "Fitness & Health", description: "Meet accountability partners and find fitness communities.", icon: Activity, theme: "mint", action: "Explore fitness", live: false },
  { slug: "astrology", title: "Astrology Connect", description: "Discover practitioners and explore one-to-one consultations.", icon: Sparkles, theme: "violet", action: "Explore astrology", live: false },
] as const;

export function Brand() {
  return <Link className="brand" href="/">
    <span className="brand-icon"><MessageCircle size={19} strokeWidth={2.5} /><span /></span>
    <span>Trust Meet</span>
  </Link>;
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const studio = path === "/connect";
  const [open, setOpen] = useState(false);
  const account = useAccount();
  const profile = account.data;
  const links = [{ href: "/", name: "Home", icon: Compass },
    ...modules.filter(({ live }) => live).map(({slug, title, icon}) => ({ href: "/" + slug, name: title, icon })),
    { href: "/pricing", name: "Plans", icon: Crown },
    ...(profile?.moderator ? [{ href: "/moderation", name: "Moderation", icon: Gavel }] : [])];
  const upcoming = modules.filter(({ live }) => !live);
  return <div className={studio ? "shell shell-studio" : "shell"}>
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className={"sidebar" + (open ? " sidebar-open" : "")} id="navigation">
      <div className="sidebar-top"><Brand /><button className="icon-button mobile-only" aria-label="Close menu" onClick={() => setOpen(false)}><X size={21} /></button></div>
      <nav aria-label="Main navigation">
        <span className="nav-label">WORKSPACE</span>
        {links.map(({ href, name, icon: Icon }) => <Link key={href} href={href}
          onClick={() => setOpen(false)} aria-current={path === href ? "page" : undefined}>
          <Icon size={18} strokeWidth={1.8} />{name}
        </Link>)}
        <span className="nav-label nav-label-spaced">COMING SOON</span>
        {upcoming.map(({ slug, title, icon: Icon }) => <Link key={slug} href={"/" + slug} className="nav-muted"
          onClick={() => setOpen(false)} aria-current={path === "/" + slug ? "page" : undefined}>
          <Icon size={18} strokeWidth={1.8} />{title}
        </Link>)}
      </nav>
      <div className="sidebar-bottom">
        <Link href="/safety" className="trust-card" onClick={() => setOpen(false)}>
          <ShieldCheck size={21} /><span><strong>Safety Center</strong><small>Tools for safer conversations</small></span><ArrowUpRight size={14} />
        </Link>
        {!profile?.plus && <Link href="/pricing" className="plus-card" onClick={() => setOpen(false)}>
          <Crown size={18} /><span><strong>Go ad-free</strong><small>Upgrade to Plus</small></span>
        </Link>}
      </div>
    </aside>
    {open && <button className="mobile-backdrop" aria-label="Dismiss menu" onClick={() => setOpen(false)} />}
    <div className="workspace">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-only" aria-label="Open menu" aria-expanded={open} aria-controls="navigation" onClick={() => setOpen(!open)}><Menu size={22} /></button>
          {studio ? <Brand /> : <>
            <span className="desktop-only">{path === "/" ? "Home" : (links.find(link => link.href === path)?.name ?? "Trust Meet")}</span>
            <div className="mobile-only"><Brand /></div>
          </>}
        </div>
        <div className="topbar-right">
          <OnlineBadge />
          <Link className="top-safety icon-button" aria-label="Safety Center" href="/safety"><ShieldCheck size={20} /></Link>
          <span className="top-divider" aria-hidden="true" />
          {profile ? <Link className="profile-link" href="/account" aria-label="Account settings">
            <span className="avatar">{Array.from(profile.display_name)[0]?.toUpperCase()}</span><span className="desktop-only">{profile.display_name}</span>
            {profile.plus && <span className="plus-pill">PLUS</span>}
          </Link> : <>
            <Link className="button button-small button-ghost desktop-only" href="/account/login">Sign in</Link>
            <Link className="button button-small button-primary" href="/account/register">Join free</Link>
          </>}
        </div>
      </header>
      <main id="main" className="main-content">{children}</main>
      {!studio && <footer className="site-footer">
        <div className="footer-brand"><Brand /><p>{site.tagline} Random video, voice and text chat for adults in India.</p></div>
        <nav aria-label="Product"><strong>Product</strong><Link href="/connect">Random Connect</Link><Link href="/private-rooms">Private Rooms</Link><Link href="/pricing">Plans</Link></nav>
        <nav aria-label="Company"><strong>Company</strong><Link href="/about">About</Link><Link href="/safety">Safety Center</Link><Link href="/guidelines">Community Guidelines</Link></nav>
        <nav aria-label="Legal"><strong>Legal</strong>{legalLinks.filter(link => link.href !== "/guidelines").map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav>
        <p className="footer-base">© {new Date().getFullYear()} {site.operator.legalName}. For adults 18+ only. Emergency in India: 112 · Cybercrime: 1930</p>
      </footer>}
      <ConsentBanner />
    </div>
  </div>;
}
