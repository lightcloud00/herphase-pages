#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const posts = JSON.parse(await readFile(resolve("scripts/blog-posts.json"), "utf8")).entries;
const entries = posts.map((post) => ({ slug: `${post.slug}-1200x630`, title: post.title, eyebrow: "Wellness Guide", brand: "HerPhase", alt: post.imageAlt, outputDir: "assets/blog", motif: post.motif, colors: post.colors }));
await writeFile(resolve("scripts/blog-covers.json"), `${JSON.stringify({ entries }, null, 2)}\n`);
console.log(`Prepared ${entries.length} HerPhase cover definitions.`);
