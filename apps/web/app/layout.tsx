import type { Metadata } from "next";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/manrope";
import "./global.css";
import { Providers } from "./providers";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: { default: "Conviya · Real People. Real Conversations.", template: "%s · Conviya" },
  description: "Find meaningful conversations with adults who share your curiosity. Connect by video, voice, or text.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Providers><Shell>{children}</Shell></Providers></body></html>;
}
