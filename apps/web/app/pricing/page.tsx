import type { Metadata } from "next";
import { Pricing } from "@/components/pricing";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Plans and Pricing",
  description: `Trust Meet is free to use. Upgrade to Plus for ₹${site.plusPrice} a month for an ad-free experience.`,
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  return <Pricing />;
}
