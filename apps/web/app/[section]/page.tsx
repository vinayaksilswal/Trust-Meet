import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const sections = new Map([
  ["safety", { title: "Safety Center", lines: [
    "Conviya's local conversation experience is for adults. Confirm your email and complete the eligibility check before joining.",
    "Your microphone and camera start disabled. Use the conversation controls to turn them on, leave, or block the other participant.",
    "Use Report to flag behaviour such as harassment, threats, scams, or suspected underage use. Reports are saved for review. This development environment has no staffed review service.",
  ] }],
  ["about", { title: "About Conviya", lines: [
    "Conviya is an India-first conversation platform for adults. Its first experience supports one-to-one video, voice, and text.",
    "The development environment is for local testing. Public registration and conversations require launch approval.",
  ] }],
  ["privacy", { title: "Privacy in development", lines: [
    "The local environment stores email addresses, display names, password hashes, eligibility outcomes, and conversation timestamps. It discards submitted birth dates.",
    "LiveKit carries media and chat messages between participants. Conviya does not enable server-side session recording or store chat history in this version.",
    "Use synthetic identities and test data in the local environment.",
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
