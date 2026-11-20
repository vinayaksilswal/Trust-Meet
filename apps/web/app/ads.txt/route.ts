import { site } from "@/lib/site";

// Google requires ads.txt at the domain root to authorise the AdSense publisher ID.
export function GET() {
  const body = site.adsenseClient
    ? `google.com, ${site.adsenseClient.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`
    : "# No advertising partners are configured.\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
