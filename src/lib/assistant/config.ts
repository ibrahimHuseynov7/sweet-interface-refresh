// Server-only configuration. Secrets come from Lovable Cloud secrets (process.env), never from the browser.
const env = (k: string, d = ""): string =>
  (typeof process !== "undefined" ? process.env[k] : undefined) ?? d;

/** "summarizer" writes the short spoken summary for text-to-speech (src/lib/tts.functions.ts). */
export type AgentRole = "orchestrator" | "module_agent" | "responder" | "summarizer";

/**
 * Azure resource that hosts both deployments. The router (orchestrator) runs on birchat-decision-1-test;
 * everything else (module agent / web search, responder, voice summary) runs on gpt-6-luna.
 * Both deployments share one key: AZURE_OPENAI_API_KEY.
 */
const ROUTER_DEPLOYMENT = "birchat-decision-1-test";
const LUNA_DEPLOYMENT = "si-gpt-6-luna-eval";

/**
 * Reasoning effort per role, most-preferred first. GPT-5.x deployments differ in what they accept
 * ("none" on 5.1+, "minimal" on 5.0); llm.ts walks down the list when the deployment rejects a value,
 * remembers the first accepted one, and drops the parameter only if none is accepted.
 * Lower effort = much faster answers; routing and reply writing do not need deep reasoning.
 * Override with AZURE_REASONING_<ROLE>=low (comma-separated list allowed).
 */
const effortChain = (role: AgentRole, d: string[]): string[] => {
  const v = env(`AZURE_REASONING_${role.toUpperCase()}`);
  return v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : d;
};

export const CONFIG = {
  azure: {
    endpoint: () =>
      env(
        "AZURE_OPENAI_ENDPOINT",
        "https://ds-ai-shopping-assistant-rs.cognitiveservices.azure.com",
      ).replace(/\/+$/, ""),
    /** Same api_version as the AzureOpenAI python client: /openai/deployments/{deployment}/... */
    apiVersion: () => env("AZURE_OPENAI_API_VERSION", "2024-12-01-preview"),
    apiKey: () => env("AZURE_OPENAI_API_KEY") || env("COMPANY_AI_KEY"),
    deployment: (role: AgentRole) =>
      env(`AZURE_DEPLOYMENT_${role.toUpperCase()}`) ||
      (role === "orchestrator"
        ? ROUTER_DEPLOYMENT
        : env("AZURE_OPENAI_DEPLOYMENT", LUNA_DEPLOYMENT)),
    /** Deployment used by the web_search tool (Responses API + built-in web search). */
    searchDeployment: () => env("AZURE_DEPLOYMENT_WEB_SEARCH", LUNA_DEPLOYMENT),
    reasoningEffort: (role: AgentRole): string[] =>
      ({
        orchestrator: effortChain("orchestrator", ["none", "minimal", "low"]),
        module_agent: effortChain("module_agent", ["none", "low", "minimal"]),
        responder: effortChain("responder", ["none", "minimal", "low"]),
        summarizer: effortChain("summarizer", ["none", "minimal", "low"]),
      })[role],
    // Doc: Orchestrator at temperature 0. Dropped automatically if the deployment rejects it.
    temperature: {
      orchestrator: 0,
      module_agent: null,
      responder: null,
      summarizer: 0.3,
    } as Record<AgentRole, number | null>,
    maxCompletionTokens: {
      orchestrator: 2500,
      module_agent: 5000,
      responder: 2000,
      summarizer: 1500,
    } as Record<AgentRole, number>,
    timeoutMs: 45_000,
  },
  search: {
    /** "azure" = gpt-6-luna with its built-in web search (default); tavily / brave remain available. */
    provider: () => env("SEARCH_PROVIDER", "azure") as "azure" | "tavily" | "brave",
    tavilyKey: () => env("TAVILY_API_KEY"),
    braveKey: () => env("BRAVE_API_KEY"),
    maxResults: 6,
    timeoutMs: 30_000,
    cacheMs: 30 * 60_000,
  },
  fetch: { maxChars: 7000, timeoutMs: 8_000 },
  flights: {
    currency: "usd",
    maxOptions: 7,
    cacheMs: 10 * 60_000,
  },
  /** Live Birmarket listing lookups (tag / brand pages) on top of the background catalog snapshot. */
  birmarketLive: () => env("BIRMARKET_LIVE_LOOKUP", "true") !== "false",
  /**
   * Birmarket MP Catalog API (primary product source; no key needed today). mp-catalog.birmarket.az is
   * behind a Cloudflare block, so the umico.az host is the default. BIRMARKET_CATALOG=false switches the
   * shopping module back to page scraping only.
   */
  birmarketCatalog: {
    enabled: () => env("BIRMARKET_CATALOG", "true") !== "false",
    url: () => env("BIRMARKET_API_URL", "https://mp-catalog.umico.az"),
    apiKey: () => env("BIRMARKET_API_KEY"),
    timeoutMs: 10_000,
  },
  stateSecret: () => env("STATE_SECRET") || env("AZURE_OPENAI_API_KEY") || env("COMPANY_AI_KEY"),
  timezone: "Asia/Baku",
  recentTurns: 6,
  defaultMaxToolCalls: 4,
  defaultMaxCards: 5,
  /** Hard stop for the Module Agent loop: after this, answer with what the tools returned so far. */
  moduleAgentBudgetMs: 40_000,
  debug: () => env("ASSISTANT_DEBUG") === "true",
  /** Pipeline telemetry returned to the chat UI's "View Debugger" panel. */
  trace: () => env("ASSISTANT_TRACE", "true") !== "false",
};

export function todayISO(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CONFIG.timezone }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
}
