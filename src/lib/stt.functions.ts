// Speech-to-text for the mic button. Gemini via its OpenAI-compatible endpoint; the key stays on the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const env = (k: string, d = ""): string =>
  (typeof process !== "undefined" ? process.env[k] : undefined) ?? d;

const GEMINI_BASE_URL = () =>
  env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/").replace(
    /\/+$/,
    "",
  );
const GEMINI_MODEL_NAME = () => env("GEMINI_MODEL_NAME", "gemini-3.8-flash");
const GEMINI_API_KEY = () => env("GEMINI_API_KEY");

const LANG_NAME = { az: "Azerbaijani", ru: "Russian", en: "English" } as const;

const sttPrompt = (lang: keyof typeof LANG_NAME) =>
  [
    "You are a speech-to-text engine for a chat assistant.",
    "Transcribe the user's audio verbatim, in the language actually spoken (usually Azerbaijani, Russian or English).",
    `The user's interface language is ${LANG_NAME[lang]}; use it only as a hint when the audio is ambiguous.`,
    "Keep the original script of each language (Azerbaijani in Latin script, Russian in Cyrillic).",
    "Output ONLY the transcript text: no quotes, labels, translations or comments.",
    "If there is no intelligible speech, output an empty string.",
  ].join("\n");

// ~60 s of 16 kHz mono 16-bit WAV is ~2.6 MB of base64; allow some headroom.
const MAX_AUDIO_B64 = 4_000_000;

const SttRequest = z.object({
  audio: z.string().min(100).max(MAX_AUDIO_B64), // base64 WAV, no data: prefix
  language: z.enum(["az", "ru", "en"]).default("az"),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Port of wav_to_text_with_retry_audio: retries on 500/429/503/timeout with 2^attempt s backoff. */
async function wavToTextWithRetryAudio(
  audio: string,
  prompt: string,
  maxRetries = 5,
): Promise<string> {
  const key = GEMINI_API_KEY();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  let lastErr = "";
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${GEMINI_BASE_URL()}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: GEMINI_MODEL_NAME(),
          messages: [
            { role: "system", content: prompt },
            {
              role: "user",
              content: [{ type: "input_audio", input_audio: { data: audio, format: "wav" } }],
            },
          ],
          temperature: 0.0,
          top_p: 0.1,
          max_tokens: 64000,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (data.usage) {
        console.log(
          `STT usage: prompt=${data.usage.prompt_tokens ?? "?"} completion=${data.usage.completion_tokens ?? "?"}`,
        );
      }
      return (data.choices?.[0]?.message?.content ?? "").trim();
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const errType = e instanceof Error ? e.name : typeof e;
      lastErr = err;
      console.warn(
        `Error during transcription (attempt ${attempt + 1}/${maxRetries}): [${errType}] ${err}`,
      );
      if (
        err.includes("500") ||
        err.includes("429") ||
        err.includes("503") ||
        err.toLowerCase().includes("timeout") ||
        errType.toLowerCase().includes("timeout")
      ) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      // Non-retryable: fail instead of returning the error text, so it never lands in the chat input.
      throw new Error(`Transcription failed: ${err}`);
    }
  }
  console.warn("  ⚠ Max retries reached for audio call");
  throw new Error(`Transcription failed after ${maxRetries} attempts: ${lastErr}`);
}

/** Base64 WAV in, transcript text out. */
export const transcribeAudio = createServerFn({ method: "POST" })
  .validator((d: unknown) => SttRequest.parse(d))
  .handler(async ({ data }) => {
    const text = await wavToTextWithRetryAudio(data.audio, sttPrompt(data.language));
    return { text };
  });
