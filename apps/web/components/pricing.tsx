"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { billing, billingState, checkout } from "@conviya/contracts";
import { Notice } from "@conviya/ui";
import { Check, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useState } from "react";
import { api, errorMessage, useAccount } from "@/lib/client";
import { site } from "@/lib/site";

type RazorpayResponse = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
type RazorpayInstance = { open(): void; on(event: string, handler: () => void): void };
declare global {
  interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance }
}

const freeFeatures = ["Unlimited random video, voice and text chat", "Language and interest matching", "Private Rooms with host controls", "Block and report in every call"];
const plusFeatures = ["Everything in Free", "No advertising anywhere", "Plus badge on your account", "Supports moderation that keeps calls safe"];

export function useBilling(enabled = true) {
  return useQuery({ queryKey: ["billing"], enabled, queryFn: ({ signal }) => api("/billing", billing, undefined, signal) });
}

export function Pricing() {
  const account = useAccount();
  const plan = useBilling(!!account.data);
  const price = plan.data?.plan.price_inr ?? site.plusPrice;
  return <div className="pricing">
    <div className="page-intro center">
      <span className="eyebrow">Plans</span>
      <h1>Free to talk. Plus to go ad-free.</h1>
      <p>Every core feature is free. Plus removes ads and funds the moderation that keeps conversations safe.</p>
    </div>
    <div className="plan-grid">
      <section className="plan-card">
        <h2>Free</h2>
        <p className="plan-price"><strong>₹0</strong><span>forever</span></p>
        <ul>{freeFeatures.map(item => <li key={item}><Check size={16} />{item}</li>)}</ul>
        <Link className="button button-outline wide" href={account.data ? "/connect" : "/account/register"}>
          {account.data ? "Start chatting" : "Create a free account"}
        </Link>
      </section>
      <section className="plan-card plan-featured">
        <span className="plan-badge"><Sparkles size={13} /> Most popular</span>
        <h2>Plus</h2>
        <p className="plan-price"><strong>₹{price}</strong><span>per month, incl. taxes</span></p>
        <ul>{plusFeatures.map(item => <li key={item}><Check size={16} />{item}</li>)}</ul>
        <PlusAction />
      </section>
    </div>
    <p className="fine-print"><ShieldCheck size={15} /> Payments are processed securely by Razorpay with UPI, cards and netbanking.
      Cancel any time. See the <Link href="/refunds">Refund and Cancellation Policy</Link> and <Link href="/terms">Terms</Link>.</p>
  </div>;
}

export function PlusAction() {
  const account = useAccount();
  const client = useQueryClient();
  const plan = useBilling(!!account.data);
  const [ready, setReady] = useState(false);
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ["billing"] }), client.invalidateQueries({ queryKey: ["account"] })]);
  const upgrade = useMutation({
    mutationFn: async () => {
      const order = await api("/billing/subscribe", checkout, {});
      if (!window.Razorpay) throw new Error("The payment window could not load. Disable blockers and try again.");
      const proof = await new Promise<RazorpayResponse | null>((resolve) => {
        const instance = new window.Razorpay!({
          key: order.key_id, subscription_id: order.subscription_id, name: site.name,
          description: "Trust Meet Plus · monthly", theme: { color: "#1e6b53" },
          prefill: { email: account.data?.email, name: account.data?.display_name },
          handler: resolve, modal: { ondismiss: () => resolve(null) },
        });
        instance.on("payment.failed", () => resolve(null));
        instance.open();
      });
      if (!proof) return null;
      return api("/billing/verify", billingState, proof);
    },
    onSettled: refresh,
  });
  const cancel = useMutation({ mutationFn: () => api("/billing/cancel", billingState, {}), onSettled: refresh });

  if (!account.data) return <Link className="button button-primary wide" href="/account/login?next=pricing">Sign in to upgrade</Link>;
  if (plan.isPending) return <button className="button button-primary wide" disabled>Loading…</button>;
  if (plan.isError) return <Notice error>{errorMessage(plan.error)}</Notice>;
  const sub = plan.data.subscription;
  const renews = sub?.current_end ? new Date(sub.current_end).toLocaleDateString("en-IN", { dateStyle: "medium" }) : null;
  if (plan.data.plus) return <div className="plan-status">
    <Notice>{sub?.cancel_requested ? `Plus ends on ${renews}.` : `You have Plus${renews ? `. Renews on ${renews}` : ""}.`}</Notice>
    {!sub?.cancel_requested && <button className="button button-outline wide" disabled={cancel.isPending}
      onClick={() => { if (window.confirm("Cancel Plus at the end of this billing period?")) cancel.mutate(); }}>
      {cancel.isPending ? "Cancelling…" : "Cancel subscription"}</button>}
    {cancel.isError && <Notice error>{errorMessage(cancel.error)}</Notice>}
  </div>;
  if (!plan.data.enabled) return <button className="button button-primary wide" disabled>Coming soon</button>;
  if (sub?.status === "authenticated") return <Notice>Your payment is being confirmed. This usually takes under a minute.</Notice>;
  if (!account.data.eligible) return <Link className="button button-primary wide" href="/account">Complete the 18+ check to upgrade</Link>;
  return <>
    <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" onReady={() => setReady(true)} />
    <button className="button button-primary wide" disabled={!ready || upgrade.isPending} onClick={() => upgrade.mutate()}>
      {upgrade.isPending ? "Opening secure checkout…" : `Upgrade for ₹${plan.data.plan.price_inr}/month`}
    </button>
    {upgrade.isError && <Notice error>{errorMessage(upgrade.error)}</Notice>}
    {upgrade.data?.plus && <Notice>Welcome to Plus. Ads are now off.</Notice>}
  </>;
}
