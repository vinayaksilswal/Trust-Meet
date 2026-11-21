"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalog, passOrder, passState, type DayPass } from "@conviya/contracts";
import { Notice } from "@conviya/ui";
import { Crown, Globe2, Lock, Users, X, Zap } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, useAccount } from "@/lib/client";
import { site } from "@/lib/site";

export type PremiumFeature = "region" | "gender" | "priority";

const copy: Record<PremiumFeature, { title: string; text: string }> = {
  region: { title: "Unlock Region Filter", text: "Match with strangers from the country you choose." },
  gender: { title: "Unlock Gender Filter", text: "Choose to match with women, men or anyone." },
  priority: { title: "Unlock Priority Matching", text: "Skip ahead of the queue and connect faster." },
};

type RazorpayPayment = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayWindow = { open(): void; on(event: string, handler: () => void): void };

export function hasPremium(until: string | null | undefined) {
  return !!until && Date.parse(until) > Date.now();
}

export function usePassCatalog() {
  return useQuery({ queryKey: ["catalog"], staleTime: 300_000, queryFn: ({ signal }) => api("/billing/catalog", catalog, undefined, signal) });
}

export function PassCards({ onDone }: { onDone?: () => void }) {
  const account = useAccount();
  const client = useQueryClient();
  const offer = usePassCatalog();
  const [ready, setReady] = useState(false);
  const buy = useMutation({
    mutationFn: async (choice: DayPass) => {
      const order = await api("/billing/pass", passOrder, { pass_id: choice.id });
      const Razorpay = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => RazorpayWindow }).Razorpay;
      if (!Razorpay) throw new Error("The payment window could not load. Disable blockers and try again.");
      const proof = await new Promise<RazorpayPayment | null>(resolve => {
        const checkout = new Razorpay({
          key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency,
          name: site.name, description: `${choice.days}-day premium pass`, theme: { color: "#0f6e6e" },
          prefill: { email: account.data?.email, name: account.data?.display_name },
          handler: resolve, modal: { ondismiss: () => resolve(null) },
        });
        checkout.on("payment.failed", () => resolve(null));
        checkout.open();
      });
      return proof ? api("/billing/pass/verify", passState, proof) : null;
    },
    onSuccess: result => { if (result?.premium_until) onDone?.(); },
    onSettled: () => Promise.all([client.invalidateQueries({ queryKey: ["account"] }), client.invalidateQueries({ queryKey: ["billing"] })]),
  });
  const passes = offer.data?.passes ?? [];
  const signedIn = !!account.data;
  const canBuy = signedIn && account.data!.eligible && offer.data?.enabled;
  return <>
    {canBuy && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" onReady={() => setReady(true)} />}
    <div className="pass-grid">
      {passes.map(item => {
        const best = item.id === "7d";
        const body = <>
          {best && <span className="pass-best">BEST VALUE</span>}
          <span className="pass-days">{item.days} {item.days === 1 ? "DAY" : "DAYS"}</span>
          <strong>₹{item.price_inr.toLocaleString("en-IN")}</strong>
          <small>₹{Math.round(item.price_inr / item.days).toLocaleString("en-IN")}/day</small>
        </>;
        const className = "pass-card" + (best ? " pass-card-best" : "");
        if (!signedIn) return <Link key={item.id} className={className} href="/account/login?next=connect">{body}</Link>;
        return <button key={item.id} type="button" className={className}
          disabled={!canBuy || !ready || buy.isPending} onClick={() => buy.mutate(item)}>{body}</button>;
      })}
    </div>
    {offer.data && !offer.data.enabled && <Notice>Passes go on sale soon.</Notice>}
    {signedIn && !account.data!.eligible && <Notice>Complete the 18+ check on your <Link href="/account">account page</Link> to buy a pass.</Notice>}
    {!signedIn && <p className="pass-note">Sign in to buy a pass.</p>}
    {buy.isPending && <Notice>Opening secure checkout…</Notice>}
    {buy.isError && <Notice error>{errorMessage(buy.error)}</Notice>}
    {buy.data?.premium_until && <Notice>Premium is active until {new Date(buy.data.premium_until).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.</Notice>}
  </>;
}

export function PremiumModal({ feature, onClose }: { feature: PremiumFeature; onClose: () => void }) {
  const client = useQueryClient();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="premium-modal" role="dialog" aria-modal="true" aria-labelledby="premium-title" tabIndex={-1} ref={dialog}>
      <button className="modal-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
      <span className="premium-crown" aria-hidden="true"><Crown size={26} /></span>
      <h2 id="premium-title">{copy[feature].title}</h2>
      <p>{copy[feature].text}</p>
      <ul className="premium-perks" aria-label="Included with every pass">
        <li><Users size={14} /> Gender</li><li><Globe2 size={14} /> Region</li><li><Zap size={14} /> Priority</li>
      </ul>
      <PassCards onDone={onClose} />
      <p className="premium-foot"><Lock size={13} /> Secured by Razorpay ·{" "}
        <button type="button" className="link-button" onClick={() => void client.invalidateQueries({ queryKey: ["account"] })}>Restore purchase</button></p>
    </div>
  </div>;
}
