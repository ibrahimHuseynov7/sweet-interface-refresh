// MVP data tools: web_search + fetch_page. Every URL a tool returns is recorded in the
// run context, so code can later check that each item's source_url really came from a tool.
import { CONFIG } from "../config";
import type { Item } from "../core/schemas";

export type Seen = Map<string, "searched" | "fetched" | "link">;
/** Flight search values fixed by code from the user's own words (the model cannot change them). */
export interface FlightPins {
  origin?: string;
  destination?: string;
  depart?: string;
  return?: string;
  adults?: number;
}
export interface ToolContext {
  seen: Seen;
  log: { tool: string; args: unknown; ok: boolean; note?: string; ms?: number }[];
  /** Ready-made items built in code from tool data; the Module Agent picks them by {"ref": id}. */
  items: Map<string, Item>;
  /** Next-step chips derived from tool data in code (e.g. "Only MXP" when a city has several airports). */
  suggestions: { label: string; value: string }[];
  /**
   * Pages of search results downloaded in the background while the model reads the results, so a later
   * fetch_page returns at once. Set only when the module has fetch_page. Nothing here counts as "fetched"
   * until the model actually calls fetch_page (grounding stays the same).
   */
  prefetch?: Map<string, Promise<FetchedPage>>;
  /** Set for the travel module: search_flights always uses these (see core/turn.ts flightPins). */
  pins?: FlightPins;
}
export const newToolContext = (): ToolContext => ({
  seen: new Map(),
  log: [],
  items: new Map(),
  suggestions: [],
});

/** Starts downloading the top search results in the background (see ToolContext.prefetch). */
export function prefetchPages(results: SearchResult[], ctx: ToolContext, max = 4) {
  if (!ctx.prefetch) return;
  for (const r of results.slice(0, max)) {
    const k = normUrl(r.url);
    if (ctx.prefetch.has(k)) continue;
    const p = loadPage(r.url);
    p.catch(() => {}); // a failed prefetch only matters if the model asks for that page
    ctx.prefetch.set(k, p);
  }
}
/** Registers code-built items so the agent can reference them, and marks their URLs as tool-returned. */
export function offerItems(ctx: ToolContext, items: Item[]) {
  for (const it of items) {
    ctx.items.set(it.id, it);
    if (it.source_url) mark(ctx, it.source_url, "fetched");
    if (it.action.type === "handoff_url" && it.action.value) mark(ctx, it.action.value, "fetched");
  }
}

const searchCache = new Map<string, { at: number; v: SearchResult[] }>();

export function normUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    x.hash = "";
    let s = x.toString();
    if (s.endsWith("/") && x.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return u.trim();
  }
}
const rank = { link: 0, searched: 1, fetched: 2 } as const;
export function mark(ctx: ToolContext, url: string, how: "searched" | "fetched" | "link") {
  const k = normUrl(url),
    prev = ctx.seen.get(k);
  if (!prev || rank[how] > rank[prev]) ctx.seen.set(k, how);
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(
  query: string,
  siteFilter: string[] | undefined,
  ctx: ToolContext,
): Promise<SearchResult[]> {
  const sites = (siteFilter ?? []).filter(Boolean);
  const ck = `${CONFIG.search.provider()}|${query.toLowerCase()}|${sites.join(",")}`;
  const hit = searchCache.get(ck);
  if (hit && Date.now() - hit.at < CONFIG.search.cacheMs) {
    hit.v.forEach((r) => mark(ctx, r.url, "searched"));
    return hit.v;
  }
  let results: SearchResult[];
  if (CONFIG.search.provider() === "azure") {
    results = await azureWebSearch(query, sites);
  } else if (CONFIG.search.provider() === "brave") {
    const key = CONFIG.search.braveKey();
    if (!key) throw new Error("BRAVE_API_KEY is not set");
    const q = sites.length ? `${query} (${sites.map((s) => `site:${s}`).join(" OR ")})` : query;
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${CONFIG.search.maxResults}`,
      {
        headers: { "X-Subscription-Token": key, Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!res.ok) throw new Error(`Brave search ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    results = (data?.web?.results ?? []).map((r: Record<string, string | undefined>) => ({
      title: r["title"] ?? "",
      url: r["url"] ?? "",
      snippet: stripTags(r["description"] ?? ""),
    }));
  } else {
    const key = CONFIG.search.tavilyKey();
    if (!key) throw new Error("TAVILY_API_KEY is not set");
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        max_results: CONFIG.search.maxResults,
        search_depth: "basic",
        ...(sites.length ? { include_domains: sites } : {}),
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok)
      throw new Error(`Tavily search ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    // deno-lint-ignore no-explicit-any
    results = (data?.results ?? []).map((r: Record<string, string | undefined>) => ({
      title: r["title"] ?? "",
      url: r["url"] ?? "",
      snippet: (r["content"] ?? "").slice(0, 700),
    }));
  }
  results = results.filter((r) => /^https?:\/\//.test(r.url));
  results.forEach((r) => mark(ctx, r.url, "searched"));
  searchCache.set(ck, { at: Date.now(), v: results });
  if (searchCache.size > 300) searchCache.delete(searchCache.keys().next().value!);
  return results;
}

// ---------------------------------------------------------------------------------------------
// Azure provider: gpt-6-luna (Responses API) with its built-in web search tool.
// The model returns {title,url,snippet} rows; only URLs the search tool actually cited/visited are kept,
// so a URL can never be invented by the model.

interface ResponsesOutput {
  type?: string;
  action?: { sources?: { url?: string; title?: string }[] };
  content?: {
    type?: string;
    text?: string;
    annotations?: { type?: string; url?: string; title?: string; start_index?: number }[];
  }[];
}

const SEARCH_INSTRUCTIONS = (max: number, sites: string[]) =>
  [
    "You are a web search backend. Search the web for the query and report what the result pages say.",
    `Return ONLY a JSON object: {"results":[{"title":string,"url":string,"snippet":string}]} with at most ${max} results.`,
    "One result per distinct page you actually found. url = that page's exact URL.",
    "snippet = up to 600 characters of concrete facts from that page (prices with currency, dates, times, rules). Never invent facts.",
    sites.length ? `Only use pages from these sites: ${sites.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};
const onSites = (u: string, sites: string[]) => {
  if (!sites.length) return true;
  const h = hostOf(u);
  return sites.some((s) => {
    const d = hostOf(s.includes("://") ? s : `https://${s}`);
    return !!d && (h === d || h.endsWith(`.${d}`));
  });
};

/** Picks a built-in web search tool type the deployment accepts (remembered once found). */
let searchToolType: "web_search" | "web_search_preview" = "web_search";

async function azureWebSearch(query: string, sites: string[]): Promise<SearchResult[]> {
  const key = CONFIG.azure.apiKey();
  if (!key) throw new Error("AZURE_OPENAI_API_KEY is not set");
  const max = CONFIG.search.maxResults;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${CONFIG.azure.endpoint()}/openai/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": key },
      body: JSON.stringify({
        model: CONFIG.azure.searchDeployment(),
        instructions: SEARCH_INSTRUCTIONS(max, sites),
        input: query,
        tools: [{ type: searchToolType }],
        tool_choice: "required",
      }),
      signal: AbortSignal.timeout(CONFIG.search.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && searchToolType === "web_search" && /web_search|tool/i.test(text)) {
        searchToolType = "web_search_preview";
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw new Error(`Azure web search ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { output?: ResponsesOutput[]; output_text?: string };
    return parseAzureSearch(data, sites, max);
  }
  throw new Error("Azure web search: too many retries");
}

/** Exported for tests. Keeps only rows whose URL the search tool cited or visited. */
export function parseAzureSearch(
  data: { output?: ResponsesOutput[]; output_text?: string },
  sites: string[],
  max: number,
): SearchResult[] {
  const grounded = new Map<string, { title: string; snippet: string }>();
  let text = data.output_text ?? "";
  for (const o of data.output ?? []) {
    for (const s of o.action?.sources ?? [])
      if (s.url) grounded.set(normUrl(s.url), { title: s.title ?? "", snippet: "" });
    for (const c of o.content ?? []) {
      if (c.type !== "output_text") continue;
      if (!data.output_text) text += c.text ?? "";
      for (const a of c.annotations ?? []) {
        if (a.type !== "url_citation" || !a.url) continue;
        // The sentence the citation supports is a fair snippet if the JSON rows are unusable.
        const before = (c.text ?? "").slice(0, a.start_index ?? 0);
        const sentence = before.slice(Math.max(0, before.search(/[^.!?\n]*$/))).trim();
        const k = normUrl(a.url);
        const prev = grounded.get(k);
        grounded.set(k, {
          title: a.title || prev?.title || "",
          snippet: prev?.snippet || sentence.slice(0, 600),
        });
      }
    }
  }
  const out: SearchResult[] = [];
  const add = (r: SearchResult) => {
    if (out.length >= max || !onSites(r.url, sites) || out.some((x) => x.url === r.url)) return;
    out.push(r);
  };
  let rows: { title?: unknown; url?: unknown; snippet?: unknown }[] = [];
  try {
    const t = text.replace(/^[\s\S]*?(\{)/, "$1");
    const parsed = JSON.parse(t.slice(0, t.lastIndexOf("}") + 1)) as { results?: typeof rows };
    rows = Array.isArray(parsed.results) ? parsed.results : [];
  } catch {
    /* fall back to citations below */
  }
  for (const r of rows) {
    const url = typeof r.url === "string" ? r.url.trim() : "";
    const g = grounded.get(normUrl(url));
    if (!g) continue; // not from the search tool: drop it
    add({
      title: (typeof r.title === "string" && r.title) || g.title,
      url,
      snippet: stripTags(typeof r.snippet === "string" ? r.snippet : g.snippet).slice(0, 700),
    });
  }
  for (const [url, g] of grounded) if (g.snippet) add({ title: g.title, url, snippet: g.snippet });
  return out;
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "::1" ||
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^0\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function stripTags(s: string) {
  return decode(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  structured_data: string[];
  links: { text: string; url: string }[];
}

export async function fetchPage(rawUrl: string, ctx: ToolContext): Promise<FetchedPage> {
  const page = await (ctx.prefetch?.get(normUrl(rawUrl)) ?? loadPage(rawUrl));
  mark(ctx, rawUrl, "fetched");
  mark(ctx, page.url, "fetched");
  page.links.forEach((l) => mark(ctx, l.url, "link"));
  return page;
}

async function loadPage(rawUrl: string): Promise<FetchedPage> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("invalid URL");
  }
  if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname))
    throw new Error("URL not allowed");
  const res = await fetch(u, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LifestyleAssistant/1.0)",
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
      "Accept-Language": "az,en;q=0.8,ru;q=0.7",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(CONFIG.fetch.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const finalUrl = res.url || u.toString();
  const html = (await res.text()).slice(0, 2_000_000);
  const max = CONFIG.fetch.maxChars;

  // JSON-LD often holds exact prices / showtimes / offers - keep it.
  const structured = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ]
    .map((m) => (m[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 2500))
    .slice(0, 4);
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const links: { text: string; url: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = stripTags(m[2] ?? "").slice(0, 80);
    if (!text) continue;
    try {
      const abs = new URL(decode(m[1] ?? ""), finalUrl);
      if (!/^https?:$/.test(abs.protocol)) continue;
      links.push({ text, url: abs.toString() });
    } catch {
      /* ignore */
    }
    if (links.length >= 40) break;
  }
  const text = stripTags(
    html
      .replace(/<(script|style|noscript|svg|head|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, " \n "),
  ).slice(0, max);

  return { url: finalUrl, title, text, structured_data: structured, links };
}
