import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AdSlot } from "@/components/ads";
import { closedModules, pages } from "@/lib/pages";
import { site } from "@/lib/site";

type Params = { params: Promise<{ section: string }> };

export function generateStaticParams() {
  return [...Object.keys(pages), ...Object.keys(closedModules)].map(section => ({ section }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { section } = await params;
  const page = pages[section];
  if (page) return { title: page.title, description: page.summary, alternates: { canonical: "/" + section } };
  const closed = closedModules[section as keyof typeof closedModules];
  return closed ? { title: closed, robots: { index: false } } : {};
}

export default async function Section({ params }: Params) {
  const { section } = await params;
  const page = pages[section];
  const closed = closedModules[section as keyof typeof closedModules];
  if (!page && !closed) notFound();
  // The old category placeholders now live inside Expert Sessions.
  if (!page) redirect("/experts");
  return <>
    <article className="content-panel doc">
      <Link className="back-link" href="/"><ArrowLeft size={16} /> Home</Link>
      <h1>{page.title}</h1>
      <p className="doc-summary">{page.summary}</p>
      {page.legal && <p className="doc-meta">Last updated {site.updated}</p>}
      {page.blocks.map((block, index) => <section key={index}>
        {block.heading && <h2>{block.heading}</h2>}
        {block.body?.map(line => <p key={line}>{line}</p>)}
        {block.list && <ul>{block.list.map(item => <li key={item}>{item}</li>)}</ul>}
      </section>)}
    </article>
    {!page.legal && <AdSlot />}
  </>;
}
