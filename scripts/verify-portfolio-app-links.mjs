import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', process.argv[2] ?? '.');
const SKIP_DIRECTORIES = new Set(['.git', '.codebase-memory', 'node_modules', 'dist', 'build', '.output', 'audit', 'proof', 'scripts', 'tests', 'test-results', 'playwright-report', 'functions', 'content', 'partials', 'assets']);
const APPS = Object.freeze([
  { id: 'fortbudget', name: 'FortBudget', marketingUrl: 'https://gusdigitalsolutions.com/fortbudget/', appStoreUrl: 'https://apps.apple.com/us/app/fortbudget/id6796013476' },
  { id: 'gridcrush', name: 'GridCrush', marketingUrl: 'https://gusdigitalsolutions.com/gridcrush/', appStoreUrl: 'https://apps.apple.com/us/app/gridcrush-block-puzzle/id6768498037' },
  { id: 'herphase', name: 'HerPhase', marketingUrl: 'https://gusdigitalsolutions.com/herphase/', appStoreUrl: null },
  { id: 'hungrecover', name: 'HungRecover', marketingUrl: 'https://hungrecover.com/', appStoreUrl: 'https://apps.apple.com/us/app/hungrecover-bac-recovery/id6766139744' },
  { id: 'ironlog', name: 'IronLog', marketingUrl: 'https://ironlog.co/', appStoreUrl: 'https://apps.apple.com/us/app/ironlog-pr-tracker/id6759731114' },
  { id: 'sparkfit', name: 'SparkFit', marketingUrl: 'https://sparkfit.app/', appStoreUrl: null },
  { id: 'swingiq', name: 'SwingIQ', marketingUrl: 'https://gusdigitalsolutions.com/swingiq/', appStoreUrl: 'https://apps.apple.com/us/app/swingiq-golf-tracker/id6789969705' },
]);

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.html')) output.push(fullPath);
  }
  return output;
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const failures = [];
const files = (await walk(root)).sort();
if (files.length === 0) failures.push(`No public HTML files found beneath ${root}`);

for (const file of files) {
  const label = path.relative(root, file);
  const html = await readFile(file, 'utf8');
  if (count(html, 'data-portfolio-apps') !== 1) {
    failures.push(`${label}: expected exactly one Our apps module`);
    continue;
  }
  const marker = html.indexOf('data-portfolio-apps');
  const sectionStart = html.lastIndexOf('<section', marker);
  const sectionEnd = html.indexOf('</section>', marker);
  const section = sectionStart >= 0 && sectionEnd >= 0 ? html.slice(sectionStart, sectionEnd + 10) : '';
  const ids = [...section.matchAll(/data-portfolio-app="([^"]+)"/g)].map((match) => match[1]);
  if (JSON.stringify(ids) !== JSON.stringify(APPS.map((app) => app.id))) failures.push(`${label}: app membership or alphabetical order drifted`);

  for (const app of APPS) {
    if (count(section, `href="${app.marketingUrl}"`) !== 1) failures.push(`${label}: expected one ${app.name} marketing link`);
    const expectedStoreCount = app.appStoreUrl ? 1 : 0;
    const actualStoreCount = app.appStoreUrl ? count(section, `href="${app.appStoreUrl}"`) : 0;
    if (actualStoreCount !== expectedStoreCount) failures.push(`${label}: ${app.name} App Store destination drifted`);
    if (app.appStoreUrl && !section.includes(`aria-label="${app.name} on the App Store"`)) failures.push(`${label}: ${app.name} App Store label is not app-specific`);
  }

  const marketingUrls = APPS.map((app) => app.marketingUrl).filter((url) => section.includes('href="' + url + '"'));
  const storeUrls = [...section.matchAll(/href="(https:\/\/apps\.apple\.com\/[^"]+)"/g)].map((match) => match[1]);
  if (new Set(marketingUrls).size !== 7) failures.push(`${label}: expected seven unique marketing destinations`);
  if (storeUrls.length !== 5 || new Set(storeUrls).size !== 5) failures.push(`${label}: expected exactly five unique App Store destinations`);
  if (!section.includes('href="https://gusdigitalsolutions.com/portfolio/"')) failures.push(`${label}: canonical portfolio destination is missing`);

  for (const match of section.matchAll(/<a\b[^>]*href="https:[^"]+"[^>]*>/g)) {
    if (!match[0].includes('target="_blank"') || !match[0].includes('rel="noopener noreferrer"')) failures.push(`${label}: unsafe outbound portfolio link`);
  }
  if (/href="(?:https:\/\/gusdigitalsolutions\.com)?\/apps\/?"/.test(html)) failures.push(`${label}: stale /apps destination remains`);
}

if (failures.length > 0) {
  console.error(`Portfolio app link verification failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Portfolio app link verification PASS: ${files.length} public routes; exact 7 marketing / 5 App Store contract.`);
