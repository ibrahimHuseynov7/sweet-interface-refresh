// Speech-to-text for the mic button. Runs on the voice sidecar (omnivoice-server, faster-whisper),
// called from the server so its URL and key never reach the browser.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ~60 s of 16 kHz mono 16-bit WAV is ~2.6 MB of base64; allow some headroom.
const MAX_AUDIO_B64 = 4_000_000;

const SttRequest = z.object({
  audio: z.string().min(100).max(MAX_AUDIO_B64), // base64 WAV, no data: prefix
  language: z.enum(["az", "ru", "en"]).default("az"),
});

/** Base64 WAV in, transcript text out. */
export const transcribeAudio = createServerFn({ method: "POST" })
  .validator((d: unknown) => SttRequest.parse(d))
  .handler(async ({ data }) => {
    const { callVoiceSidecar } = await import("./voice-sidecar.server");
    const out = await callVoiceSidecar<{ text?: string }>(
      "/stt",
      { audio: data.audio, language: data.language },
      "Transcription",
      3,
      60_000,
    );
    return { text: (out.text ?? "").trim() };
  });
