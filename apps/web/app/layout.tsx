import type { Metadata, Viewport } from "next";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/manrope";
import "./global.css";
import { Providers } from "./providers";
import { Shell } from "@/components/shell";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: site.url ? new URL(site.url) : undefined,
  title: { default: `${site.name} · Random Video Chat for Adults`, template: `%s · ${site.name}` },
  description: site.description,
  applicationName: site.name,
  keywords: ["random video chat", "talk to strangers", "video chat India", "random chat", "meet new people", "online video call"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", siteName: site.name, locale: "en_IN",
    title: `${site.name} · ${site.tagline}`, description: site.description,
    images: [{ url: "/conversation-hero.webp", alt: "Two people talking on a video call" }],
  },
  twitter: { card: "summary_large_image", title: site.name, description: site.description, images: ["/conversation-hero.webp"] },
  robots: site.indexable ? { index: true, follow: true } : { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#123531", width: "device-width", initialScale: 1 };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-IN"><body><Providers><Shell>{children}</Shell></Providers></body></html>;
}
