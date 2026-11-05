// Text-to-speech for assistant replies. The reply + result cards are turned into a short spoken summary
// by gpt-6-luna (Azure, role "summarizer"), then spoken by OmniVoice on the voice sidecar (omnivoice-server).
// Keys and the sidecar URL stay on the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const env = (k: string, d = ""): string =>
  (typeof process !== "undefined" ? process.env[k] : undefined) ?? d;

/** OmniVoice voice design, e.g. "female, young adult, moderate pitch" (ignored when the sidecar clones a voice). */
const OMNIVOICE_INSTRUCT = () => env("OMNIVOICE_INSTRUCT");

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
  const hasContext = !!(data.cards?.length || data.quick_replies?.length || data.request);
  if (!hasContext) return data.text;
  const input = [
    `USER REQUEST: ${data.request ?? "(not given)"}`,
    `ASSISTANT WRITTEN REPLY: ${data.text}`,
    `RESULT CARDS (${data.cards?.length ?? 0}):\n${data.cards?.length ? compactCards(data.cards) : "(none)"}`,
    `FOLLOW-UP OPTIONS: ${data.quick_replies?.length ? data.quick_replies.join(" | ") : "(none)"}`,
  ].join("\n\n");
  try {
    // Direct call (not the progress-wrapped llm) so voice never shows up as a chat step.
    const { _azureChat } = await import("./assistant/core/llm");
    const msg = await _azureChat("summarizer", [
      { role: "system", content: summaryPrompt(data.language) },
      { role: "user", content: input },
    ]);
    const out = (msg.content ?? "").trim();
    if (out) return out;
    console.warn("Spoken summary was empty; speaking the written reply");
  } catch (e) {
    console.warn(`Spoken summary failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return data.text;
}

/** Strip things that should not be read aloud (links, markdown markers, angle-bracket tags). */
function toSpeakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[<>]/g, " ")
    .replace(/[*_#`~|]+/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Reply (+ optional cards context) in, spoken summary text and base64 audio (WAV) out. */
export const synthesizeSpeech = createServerFn({ method: "POST" })
  .validator((d: unknown) => TtsRequest.parse(d))
  .handler(async ({ data }) => {
    const spoken = clip(await spokenSummary(data), MAX_TEXT);
    const text = toSpeakable(spoken);
    if (!text) return { audio: "", mimeType: "audio/wav", spoken: "" };
    const { callVoiceSidecar } = await import("./voice-sidecar.server");
    const out = await callVoiceSidecar<{ audio?: string; mimeType?: string }>(
      "/tts",
      {
        text,
        language: data.language,
        ...(OMNIVOICE_INSTRUCT() ? { instruct: OMNIVOICE_INSTRUCT() } : {}),
      },
      "Speech synthesis",
    );
    if (!out.audio) throw new Error("Speech synthesis returned no audio");
    return { audio: out.audio, mimeType: out.mimeType || "audio/wav", spoken };
  });
