import type { Metadata } from "next";
import { Suspense } from "react";
import { Connect } from "@/components/connect";

export const metadata: Metadata = {
  title: "Random Video Chat",
  description: "Press Start to meet a random stranger over video, voice or text. Press Space for the next person.",
  alternates: { canonical: "/connect" },
};

export default function ConnectPage() {
  return <Suspense><Connect /></Suspense>;
}
