import type { MetadataRoute } from "next";
import { pages } from "@/lib/pages";
import { site } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!site.indexable) return [];
  const entry = (path: string, priority: number): MetadataRoute.Sitemap[number] =>
    ({ url: site.url + path, changeFrequency: "weekly", priority });
  return [
    entry("/", 1), entry("/connect", 0.9), entry("/pricing", 0.8), entry("/private-rooms", 0.6),
    ...Object.keys(pages).map(slug => entry("/" + slug, pages[slug].legal ? 0.3 : 0.6)),
  ];
}
