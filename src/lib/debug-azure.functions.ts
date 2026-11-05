// TEMPORARY debug probe: checks which Azure deployments respond. Returns only status codes and
// Azure's own error text (never the key). Delete after diagnosis.
import { createServerFn } from "@tanstack/react-start";

const env = (k: string, d = ""): string =>
  (typeof process !== "undefined" ? process.env[k] : undefined) ?? d;

export const probeAzure = createServerFn({ method: "GET" }).handler(async () => {
  const endpoint = env(
    "AZURE_OPENAI_ENDPOINT",
    "https://ds-ai-shopping-assistant-rs.cognitiveservices.azure.com",
  ).replace(/\/+$/, "");
  const key = env("AZURE_OPENAI_API_KEY") || env("COMPANY_AI_KEY");
  const apiVersion = env("AZURE_OPENAI_API_VERSION", "2024-12-01-preview");
  if (!key) return { ok: false, error: "no key in env" };
  const deployments = ["birchat-decision-1-test", "si-gpt-6-luna-eval"];
  const out: Record<string, unknown> = { endpoint, apiVersion, results: {} };
  for (const dep of deployments) {
    try {
      const res = await fetch(
        `${endpoint}/openai/deployments/${encodeURIComponent(dep)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": key },
          body: JSON.stringify({
            model: dep,
            messages: [{ role: "user", content: "Say OK" }],
            max_completion_tokens: 16,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const text = await res.text();
      (out.results as Record<string, unknown>)[dep] = {
        status: res.status,
        body: text.slice(0, 400),
      };
    } catch (e) {
      (out.results as Record<string, unknown>)[dep] = {
        status: "fetch-error",
        body: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return out;
});
