import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight, ArrowLeft, BadgeCheck, BriefcaseBusiness, HeartPulse, HeartHandshake, Activity, Sparkles,
  Scale, GraduationCap, Wallet, Clock, ShieldCheck, UserCheck, Video, Lock,
} from "lucide-react";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Expert Sessions — Paid 1-on-1 video consultations",
  description:
    "Coming soon to Trust Meet: book paid one-to-one video consultations with verified experts in wellness, healthcare, business and more. Pay by the minute from a secure wallet.",
  robots: { index: false },
  alternates: { canonical: "/experts" },
};

const categories = [
  { icon: HeartHandshake, label: "Mental Wellness" },
  { icon: HeartPulse, label: "Healthcare" },
  { icon: BriefcaseBusiness, label: "Business & Careers" },
  { icon: Activity, label: "Fitness & Nutrition" },
  { icon: Scale, label: "Legal & Finance" },
  { icon: GraduationCap, label: "Learning & Coaching" },
  { icon: Sparkles, label: "Astrology" },
];

const seekerSteps = [
  { icon: Wallet, title: "Top up your wallet", text: "Add money securely through Razorpay. Your balance stays in your wallet until you spend it." },
  { icon: UserCheck, title: "Choose an expert", text: "Browse verified experts by category, read their profile, and see their per-minute rate up front." },
  { icon: Clock, title: "Pay by the minute", text: "Connect over video and pay only for the minutes you talk — typically ₹10 to ₹20 per minute." },
];

const expertSteps = [
  { icon: BadgeCheck, title: "Create an expert account", text: "Sign up and tell us about your practice, qualifications and the category you want to advise in." },
  { icon: ShieldCheck, title: "Get approved by our team", text: "Every expert is reviewed and verified by Trust Meet before going live. No one is listed without approval." },
  { icon: Video, title: "Set your rate and go live", text: "Set your own per-minute rate, accept bookings, and get paid for your time from your Trust Meet earnings." },
];

const pillars = [
  { icon: UserCheck, title: "Verified experts only", text: "Experts are approved by our team before they ever appear on the platform." },
  { icon: Wallet, title: "Prepaid wallet", text: "Top up once and spend from your balance. You always see your remaining balance." },
  { icon: Clock, title: "Transparent per-minute rates", text: "Rates are shown before you connect. You are billed by the minute, nothing hidden." },
  { icon: Lock, title: "Private by design", text: "Sessions are one-to-one and never recorded, just like the rest of Trust Meet." },
];

export default function Experts() {
  return (
    <>
      <section className="experts-hero">
        <Link className="back-link" href="/"><ArrowLeft size={16} /> Home</Link>
        <span className="coming-badge"><Sparkles size={13} /> Coming soon</span>
        <h1>Expert Sessions</h1>
        <p className="experts-lead">
          Paid one-to-one video consultations with verified experts — in wellness, healthcare, business and more.
          Top up your wallet and pay by the minute. Experts apply and are approved by our team before they are listed.
        </p>
        <div className="experts-cta-row">
          <Link className="button button-primary" href="/account/register">Create your free account <ArrowRight size={16} /></Link>
          <Link className="button button-ghost" href="/account/register">Apply to become an expert</Link>
        </div>
        <p className="experts-note">We are building this now. Create an account to be first in line when Expert Sessions goes live.</p>
      </section>

      <section className="band" aria-labelledby="cats-title">
        <div className="section-heading"><span className="eyebrow">Categories</span>
          <h2 id="cats-title">Talk to the right kind of expert</h2>
          <p>Launching across the areas people ask for most. More categories will follow.</p></div>
        <ul className="cat-grid">
          {categories.map(({ icon: Icon, label }) => <li key={label} className="cat-chip"><Icon size={18} /> {label}</li>)}
        </ul>
      </section>

      <section className="band" aria-labelledby="seeker-title">
        <div className="section-heading"><span className="eyebrow">For you</span>
          <h2 id="seeker-title">Get advice in three steps</h2></div>
        <ol className="step-grid">
          {seekerSteps.map(({ icon: Icon, title, text }, index) => <li key={title} className="step-card">
            <span className="step-number" aria-hidden="true">{index + 1}</span><Icon size={22} /><h3>{title}</h3><p>{text}</p>
          </li>)}
        </ol>
      </section>

      <section className="band" aria-labelledby="expert-title">
        <div className="section-heading"><span className="eyebrow">For experts</span>
          <h2 id="expert-title">Advise, on your terms — once you are approved</h2>
          <p>We review every expert before listing, so people always reach someone we have verified.</p></div>
        <ol className="step-grid">
          {expertSteps.map(({ icon: Icon, title, text }, index) => <li key={title} className="step-card">
            <span className="step-number" aria-hidden="true">{index + 1}</span><Icon size={22} /><h3>{title}</h3><p>{text}</p>
          </li>)}
        </ol>
      </section>

      <section className="band trust-band" aria-labelledby="exp-trust-title">
        <div className="section-heading"><span className="eyebrow">Built on trust</span>
          <h2 id="exp-trust-title">Safe to spend, safe to advise</h2></div>
        <div className="pillar-grid">
          {pillars.map(({ icon: Icon, title, text }) => <div key={title} className="pillar"><Icon size={20} /><div><h3>{title}</h3><p>{text}</p></div></div>)}
        </div>
      </section>

      <section className="cta-band">
        <Sparkles size={24} />
        <div><h2>Be first when Expert Sessions launches</h2><p>Create your free {site.name} account today and we will let you know the moment it goes live.</p></div>
        <Link className="button button-light" href="/account/register">Get started <ArrowRight size={16} /></Link>
      </section>
    </>
  );
}
