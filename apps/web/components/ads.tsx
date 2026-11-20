"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAccount } from "@/lib/client";
import { site } from "@/lib/site";

type Consent = "all" | "essential" | null;
const KEY = "trust-meet-consent";
const EVENT = "trust-meet-consent";

function readConsent(): Consent {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "all" || value === "essential" ? value : null;
  } catch {
    return null;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useConsent() {
  return useSyncExternalStore(subscribe, readConsent, () => null);
}

function saveConsent(value: Exclude<Consent, null>) {
  try { window.localStorage.setItem(KEY, value); } catch { /* Private mode: the choice lasts for this page. */ }
  window.dispatchEvent(new Event(EVENT));
}

declare global {
  interface Window { adsbygoogle?: Array<Record<string, unknown>> & { requestNonPersonalizedAds?: number } }
}

// Cookie consent only matters when a third-party ad script can load.
export function ConsentBanner() {
  const consent = useConsent();
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (!site.adsenseClient || !hydrated || consent) return null;
  return <div className="consent" role="region" aria-label="Cookie choices">
    <p>We use essential cookies to keep you signed in. With your permission, Google uses cookies to show
      personalised ads to free users. <Link href="/privacy">Privacy Policy</Link></p>
    <div className="consent-actions">
      <button className="button button-outline button-small" onClick={() => saveConsent("essential")}>Essential only</button>
      <button className="button button-primary button-small" onClick={() => saveConsent("all")}>Accept all</button>
    </div>
  </div>;
}

// Ads appear only on content pages, never inside calls, and never for Plus members.
export function AdSlot({ className = "" }: { className?: string }) {
  const consent = useConsent();
  const account = useAccount();
  const pushed = useRef(false);
  const show = !!site.adsenseClient && !!site.adsenseSlot && !!consent && !account.isPending && !account.data?.plus;
  useEffect(() => {
    if (!show || pushed.current) return;
    pushed.current = true;
    const queue = (window.adsbygoogle = window.adsbygoogle || []);
    queue.requestNonPersonalizedAds = consent === "essential" ? 1 : 0;
    try { queue.push({}); } catch { /* An ad blocker or a filled slot is not an error for the page. */ }
  }, [show, consent]);
  if (!show) return null;
  return <aside className={"ad-slot " + className} aria-label="Advertisement">
    <span className="ad-label">Advertisement</span>
    <Script id="adsense" async crossOrigin="anonymous" strategy="afterInteractive"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${site.adsenseClient}`} />
    <ins className="adsbygoogle" style={{ display: "block" }} data-ad-client={site.adsenseClient!}
      data-ad-slot={site.adsenseSlot!} data-ad-format="auto" data-full-width-responsive="true" />
    {!account.data?.plus && <Link className="ad-upsell" href="/pricing">Go ad-free with Plus</Link>}
  </aside>;
}
