// Post-build guard: every inline script, inline style and style attribute in the built pages must be
// allowed by that page's CSP <meta> tag, and no page may load a third-party subresource. Starlight
// emits inline code that Astro does not hash, so a dependency update can otherwise break the docs
// silently in the browser.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const decodeEntities = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const sha256 = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

function parsePolicy(html: string): Map<string, string[]> | undefined {
  const content = /<meta http-equiv="content-security-policy" content="([^"]*)"/i.exec(html)?.[1];
  if (content === undefined) return undefined;
  const policy = new Map<string, string[]>();
  for (const directive of decodeEntities(content).split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name) policy.set(name.toLowerCase(), sources);
  }
  return policy;
}

// CSP fallback order for the directives this site relies on.
function sourcesFor(policy: Map<string, string[]>, chain: readonly string[]): string[] {
  for (const name of chain) {
    const sources = policy.get(name);
    if (sources) return sources;
  }
  return [];
}

async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return htmlFiles(path);
      return Promise.resolve(entry.name.endsWith(".html") ? [path] : []);
    }),
  );
  return nested.flat();
}

const problems: string[] = [];
const files = await htmlFiles(distDir);
if (files.length === 0) problems.push(`No HTML found in ${distDir}; run astro build first.`);

for (const file of files) {
  const page = relative(distDir, file);
  const html = await readFile(file, "utf8");
  const policy = parsePolicy(html);
  if (policy === undefined) {
    problems.push(`${page}: missing Content-Security-Policy <meta> tag`);
    continue;
  }

  const require = (kind: string, text: string, chain: readonly string[]) => {
    const sources = sourcesFor(policy, chain);
    if (!sources.includes(sha256(text))) {
      problems.push(`${page}: ${kind} needs ${sha256(text)}: ${text.slice(0, 80)}`);
    }
  };

  for (const match of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    require("inline script", match[1] ?? "", ["script-src-elem", "script-src", "default-src"]);
  }
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    require("inline style", match[1] ?? "", ["style-src-elem", "style-src", "default-src"]);
  }
  for (const match of html.matchAll(/\sstyle="([^"]*)"/gi)) {
    require("style attribute", decodeEntities(match[1] ?? ""), [
      "style-src-attr",
      "style-src",
      "default-src",
    ]);
  }
  // Links to other sites are fine; anything the browser would fetch on load must be same-origin.
  for (const match of html.matchAll(
    /<(script|img|link|iframe|source|video|audio)\b[^>]*\s(?:src|href)="(https?:)?\/\/[^"]*"/gi,
  )) {
    const tag = match[0];
    const isPlainLink = /^<link\b/i.test(tag) && /\srel="(canonical|alternate|sitemap)"/i.test(tag);
    if (!isPlainLink) problems.push(`${page}: third-party subresource: ${tag.slice(0, 120)}`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`CSP check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`CSP check passed for ${files.length} pages.\n`);
