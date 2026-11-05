// Client for the OmniVoice voice sidecar (omnivoice-server/server.py). Server-only: URL and key never reach the browser.
const env = (k: string, d = ""): string =>
  (typeof process !== "undefined" ? process.env[k] : undefined) ?? d;

const OMNIVOICE_URL = () => env("OMNIVOICE_URL", "http://localhost:8008").replace(/\/+$/, "");
const OMNIVOICE_API_KEY = () => env("OMNIVOICE_API_KEY");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POSTs JSON to the sidecar; retries on 429/5xx/timeout/connection errors with 2^attempt s backoff. */
export async function callVoiceSidecar<T>(
  path: "/tts" | "/stt",
  body: unknown,
  label: string,
  maxRetries = 3,
  timeoutMs = 90_000,
): Promise<T> {
  const key = OMNIVOICE_API_KEY();
  let lastErr = "";
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${OMNIVOICE_URL()}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as T;
      const text = (await res.text()).slice(0, 300);
      lastErr = `${res.status}: ${text}`;
      if (res.status !== 429 && res.status < 500) break; // not retryable
    } catch (e) {
      // Timeouts and refused connections (sidecar restarting / model loading) are retried.
      lastErr = e instanceof Error ? `[${e.name}] ${e.message}` : String(e);
    }
    console.warn(`${label} (attempt ${attempt + 1}/${maxRetries}): ${lastErr}`);
    if (attempt < maxRetries - 1) await sleep(2 ** attempt * 1000);
  }
  throw new Error(`${label} failed: ${lastErr}`);
}
