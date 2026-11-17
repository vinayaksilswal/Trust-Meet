import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const sections = new Map([
  ["safety", { title: "Safety Center", lines: [
    "Trust Meet conversations are for adults. Complete the date-of-birth check before joining.",
    "Random Connect asks for device access when you start a search and turns on the devices for your selected mode after both people accept. Use the call controls to mute, turn off your camera, leave, or block the other participant.",
    "Use Report to flag behaviour such as harassment, threats, scams, or suspected underage use. Reports are saved for review.",
  ] }],
  ["about", { title: "About Trust Meet", lines: [
    "Trust Meet is an India-first conversation platform for adults. Its first experience supports one-to-one video, voice, and text.",
    "Use Random Connect to meet someone new, or create a Private Room and share an invitation.",
  ] }],
  ["privacy", { title: "Privacy", lines: [
    "Trust Meet stores account details, eligibility outcomes, and conversation timestamps. If you enter a date of birth, Trust Meet uses it to check the 18+ requirement and stores only the result.",
    "The configured media provider, LiveKit or Cloudflare RealtimeKit, carries media and live messages between participants. Trust Meet does not enable session recording or store chat history.",
  ] }],
  ["wellness", { title: "Mental Wellness" }],
  ["business", { title: "Business Connect" }],
  ["fitness", { title: "Fitness & Health" }],
  ["astrology", { title: "Astrology Connect" }],
] as [string, { title: string; lines?: string[] }][]);

export default async function Section({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const page = sections.get(section);
  if (!page) notFound();
  return <article className="content-panel">
    <Link className="back-link" href="/"><ArrowLeft size={16} /> Discover</Link>
    <h1>{page.title}</h1>
    {page.lines ? page.lines.map(line => <p key={line}>{line}</p>) : <p>This experience is currently closed.</p>}
  </article>;
}
