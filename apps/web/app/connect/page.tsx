import type { Metadata } from "next";
import { Connect } from "@/components/connect";

export const metadata: Metadata = { title: "Random Connect" };

export default function ConnectPage() {
  return <Connect />;
}
