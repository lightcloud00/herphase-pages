#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const origin = "https://gusdigitalsolutions.com/herphase";
const posts = JSON.parse(await readFile(resolve("scripts/blog-posts.json"), "utf8")).entries;
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const decode = (value = "") => value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
const attr = (tag, name) => decode(tag.match(new RegExp(`\\b${name}=(["'])([\\s\\S]*?)\\1`, "i"))?.[2] ?? "");
const meta = (html, field, name) => { const tag = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]).find((item) => attr(item, field) === name); return tag ? attr(tag, "content") : ""; };

for (const post of posts) {
  const label = post.slug;
  const html = await readFile(resolve(`blog/${label}/index.html`), "utf8");
  const canonical = `${origin}/blog/${label}/`;
  const imageUrl = `${origin}${post.image}`;
  check((html.match(/<h1\b/gi) ?? []).length === 1, `${label}: expected exactly one H1`);
  check(html.includes('<meta name="robots" content="noindex, follow">'), `${label}: migration hold must remain noindex`);
  check(html.includes(`<link rel="canonical" href="${canonical}">`), `${label}: GDS canonical mismatch`);
  check(meta(html, "property", "og:image") === imageUrl && meta(html, "property", "og:image:alt") === post.imageAlt, `${label}: Open Graph image packet mismatch`);
  check(meta(html, "name", "twitter:image") === imageUrl && meta(html, "name", "twitter:image:alt") === post.imageAlt, `${label}: Twitter image packet mismatch`);
  const hero = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]).find((tag) => attr(tag, "alt") === post.imageAlt) ?? "";
  check(attr(hero, "width") === "1200" && attr(hero, "height") === "630" && attr(hero, "loading") === "eager", `${label}: responsive article hero mismatch`);
  check(html.includes('aria-label="Primary navigation"') && html.includes('aria-label="Mobile navigation"') && html.includes('aria-label="Footer navigation"'), `${label}: navigation packet incomplete`);
  check(html.includes('aria-label="Breadcrumb"') && html.includes("Back to Blog") && html.includes("Related Articles"), `${label}: breadcrumb/back/related links incomplete`);
  let article;
  for (const match of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    const parsed = JSON.parse(match[1]);
    if (parsed["@type"] === "BlogPosting") article = parsed;
  }
  check(article?.headline === post.title && article?.mainEntityOfPage?.["@id"] === canonical, `${label}: BlogPosting identity mismatch`);
  check(article?.image?.url === imageUrl && article?.image?.width === 1200 && article?.image?.height === 630, `${label}: BlogPosting image mismatch`);
  check(article?.datePublished === post.published && article?.dateModified === post.updated, `${label}: BlogPosting dates mismatch`);
  for (const extension of ["webp", "png"]) {
    const file = resolve(`assets/blog/${label}-1200x630.${extension}`);
    try {
      check(execFileSync("identify", ["-format", "%wx%h", file], { encoding: "utf8" }).trim() === "1200x630", `${label}: ${extension} dimensions mismatch`);
      if (extension === "webp") check((await stat(file)).size <= 250_000, `${label}: WebP exceeds 250 KB`);
    } catch (error) { failures.push(`${label}: missing ${extension} cover (${error.message})`); }
  }
}

const index = await readFile(resolve("blog/index.html"), "utf8");
check((index.match(/class="blog-card"/g) ?? []).length === posts.length, "blog index: card count mismatch");
check((index.match(/loading="lazy"/g) ?? []).length === posts.length, "blog index: cards must lazy-load covers");
check(index.includes('<meta name="robots" content="noindex, follow">') && index.includes(`<link rel="canonical" href="${origin}/blog/">`), "blog index: migration hold/canonical mismatch");
const sitemap = await readFile(resolve("sitemap.xml"), "utf8");
check(sitemap.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'), "destination sitemap: image namespace missing");
check(!sitemap.includes("<url>"), "destination sitemap: held cross-canonical routes must not be emitted");
const vercel = await readFile(resolve("vercel.json"), "utf8");
check(vercel.includes("https://gusdigitalsolutions.com/herphase/:path*"), "migration hold: Vercel catch-all redirect changed");
const home = await readFile(resolve("index.html"), "utf8");
check((home.match(/href="blog\/">Blog<\/a>/g) ?? []).length >= 2, "home: Blog must appear in header and footer navigation");

if (failures.length) { console.error(`HerPhase blog verification failed (${failures.length}):\n- ${failures.join("\n- ")}`); process.exit(1); }
console.log(`HerPhase blog verification passed for ${posts.length} migration-held articles; GDS remains canonical.`);
