// Text-to-speech for assistant replies. Gemini 3.8 TTS via the native generateContent endpoint
// (TTS is not on the OpenAI-compatible endpoint); the key stays on the server, same GEMINI_API_KEY as STT.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const env = (k: string, d = ""): string =>
  (typeof process !== "undefined" ? process.env[k] : undefined) ?? d;

const GEMINI_NATIVE_BASE_URL = () =>
  env("GEMINI_NATIVE_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").replace(
    /\/+$/,
    "",
  );
const GEMINI_TTS_MODEL_NAME = () => env("GEMINI_TTS_MODEL_NAME", "gemini-3.8-flash-tts");
const GEMINI_TTS_VOICE = () => env("GEMINI_TTS_VOICE", "Kore");
const GEMINI_API_KEY = () => env("GEMINI_API_KEY");
// Text model that turns the reply + result cards into a short spoken summary (same endpoint as STT).
const GEMINI_BASE_URL = () =>
  env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/").replace(
    /\/+$/,
    "",
  );
const GEMINI_SUMMARY_MODEL_NAME = () =>
  env("GEMINI_SUMMARY_MODEL_NAME") || env("GEMINI_MODEL_NAME", "gemini-3.8-flash");

// Turn-level delivery goes in speech_metadata.style; Gemini 3.8 TTS reads `text` verbatim.
const TTS_STYLE = () => env("GEMINI_TTS_STYLE", "warm, friendly and natural, conversational pace");

const MAX_TEXT = 5000;

const TtsRequest = z.object({
  text: z.string().min(1).max(MAX_TEXT),
  language: z.enum(["az", "ru", "en"]).default("az"),
  /** Optional context for a spoken summary: what the user asked, the result cards and the chip labels. */
  request: z.string().max(2000).optional(),
  cards: z.array(z.record(z.any())).max(40).optional(),
  quick_replies: z.array(z.string().max(200)).max(20).optional(),
});
type TtsInput = z.infer<typeof TtsRequest>;

const LANG_NAME = { az: "Azerbaijani", ru: "Russian", en: "English" } as const;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Keep only what the summary needs from each card (titles, prices, times, places). */
function compactCards(cards: Record<string, unknown>[]): string {
  const out: string[] = [];
  let total = 0;
  for (const c of cards) {
    const line = clip(
      JSON.stringify({
        kind: c["kind"],
        title: c["title"],
        subtitle: c["subtitle"],
        price: c["price"],
        attributes: c["attributes"],
      }),
      2500,
    );
    if (total + line.length > 24_000) break;
    out.push(line);
    total += line.length;
  }
  return out.join("\n");
}

const summaryPrompt = (lang: keyof typeof LANG_NAME) =>
  [
    "You write what a voice assistant says out loud after a search. The user will hear it, not read it.",
    "You get the user's request, the assistant's written reply, the result cards (JSON) and the follow-up options.",
    "Say the concrete findings, not a generic 'I found some options'. Mention, when available:",
    "- how many options there are and the lowest price with its currency (e.g. 'flights start from 200 dollars', 'there are several movies, tickets start from 8 manat');",
    "- the most relevant specifics: the cheapest or best option, earliest/next times, cinema or mall names, dates, airlines;",
    "- if nothing matches the request (e.g. no sessions after 19:00 at that mall), say so plainly and offer the best alternative from the follow-up options (e.g. other malls, other dates).",
    "Use ONLY facts present in the input. Never invent prices, times or places.",
    "2-3 short natural sentences, at most about 50 words. No lists, markdown, emojis, URLs or IDs.",
    "Say currencies as words: AZN = manat (Russian: манат), USD = dollars (Azerbaijani: dollar, Russian: долларов), EUR = euro.",
    `Write in the same language as the assistant's written reply (the interface language is ${LANG_NAME[lang]}; Azerbaijani in Latin script).`,
    "Output ONLY the words to speak.",
  ].join("\n");

/** Turns the reply + cards into a specific spoken summary; falls back to the written reply on any problem. */
async function spokenSummary(data: TtsInput): Promise<string> {
  const key = GEMINI_API_KEY();
  const hasContext = !!(data.cards?.length || data.quick_replies?.length || data.request);
  if (!key || !hasContext) return data.text;
  const input = [
    `USER REQUEST: ${data.request ?? "(not given)"}`,
    `ASSISTANT WRITTEN REPLY: ${data.text}`,
    `RESULT CARDS (${data.cards?.length ?? 0}):\n${data.cards?.length ? compactCards(data.cards) : "(none)"}`,
    `FOLLOW-UP OPTIONS: ${data.quick_replies?.length ? data.quick_replies.join(" | ") : "(none)"}`,
  ].join("\n\n");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${GEMINI_BASE_URL()}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: GEMINI_SUMMARY_MODEL_NAME(),
          messages: [
            { role: "system", content: summaryPrompt(data.language) },
            { role: "user", content: input },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
      const out = (json.choices?.[0]?.message?.content ?? "").trim();
      if (out) return out;
      throw new Error("empty summary");
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.warn(`Spoken summary failed (attempt ${attempt + 1}/2): ${err}`);
      if (!/429|500|503|timeout|empty/i.test(err)) break;
      await sleep(1000);
    }
  }
  return data.text;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strip things that should not be read aloud (links, markdown markers, angle-bracket tags). */
function toSpeakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[<>]/g, " ") // Gemini 3.8 TTS treats <...> as vocal tags
    .replace(/[*_#`~|]+/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Older TTS models return headerless 16-bit PCM; wrap it so the browser can play it. */
function pcmToWavBase64(pcmB64: string, sampleRate: number): string {
  const pcm = Buffer.from(pcmB64, "base64");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString("base64");
}

/** Same retry policy as STT: retries on 500/429/503/timeout with 2^attempt s backoff. */
async function textToSpeechWithRetry(
  text: string,
  maxRetries = 4,
): Promise<{ audio: string; mimeType: string }> {
  const key = GEMINI_API_KEY();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  let lastErr = "";
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(
        `${GEMINI_NATIVE_BASE_URL()}/models/${GEMINI_TTS_MODEL_NAME()}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text, speech_metadata: { style: TTS_STYLE() } }],
              },
            ],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { voice: GEMINI_TTS_VOICE() } },
            },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as {
        candidates?: {
          content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
        }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      if (data.usageMetadata) {
        console.log(
          `TTS usage: prompt=${data.usageMetadata.promptTokenCount ?? "?"} output=${data.usageMetadata.candidatesTokenCount ?? "?"}`,
        );
      }
      const inline = data.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData?.data,
      )?.inlineData;
      if (!inline?.data) throw new Error("TTS response contained no audio");
      const mime = (inline.mimeType ?? "audio/wav").toLowerCase();
      if (mime.includes("l16") || mime.includes("pcm")) {
        const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
        return { audio: pcmToWavBase64(inline.data, rate), mimeType: "audio/wav" };
      }
      return { audio: inline.data, mimeType: mime.includes("wav") ? "audio/wav" : mime };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      const errType = e instanceof Error ? e.name : typeof e;
      lastErr = err;
      console.warn(
        `Error during speech synthesis (attempt ${attempt + 1}/${maxRetries}): [${errType}] ${err}`,
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
      throw new Error(`Speech synthesis failed: ${err}`);
    }
  }
  throw new Error(`Speech synthesis failed after ${maxRetries} attempts: ${lastErr}`);
}

/** Reply (+ optional cards context) in, spoken summary text and base64 audio (WAV) out. */
export const synthesizeSpeech = createServerFn({ method: "POST" })
  .validator((d: unknown) => TtsRequest.parse(d))
  .handler(async ({ data }) => {
    const spoken = clip(await spokenSummary(data), MAX_TEXT);
    const text = toSpeakable(spoken);
    if (!text) return { audio: "", mimeType: "audio/wav", spoken: "" };
    return { ...(await textToSpeechWithRetry(text)), spoken };
  });
