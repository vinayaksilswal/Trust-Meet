import type { Metadata } from "next";
import { Moderation } from "@/components/moderation";

export const metadata: Metadata = { title: "Moderation", robots: { index: false, follow: false } };

export default function ModerationPage() {
  return <Moderation />;
}
