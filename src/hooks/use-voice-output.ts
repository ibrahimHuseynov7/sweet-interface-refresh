// Spoken replies: when enabled, assistant replies are sent to server TTS and played back.
import { useCallback, useEffect, useRef, useState } from "react";

export type SpeakStatus = "idle" | "loading" | "speaking";

// A tiny silent WAV, played inside the toggle's click so mobile Safari lets this element play later.
const SILENT_WAV =
  "data:audio/wav;base64," +
  "UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function useVoiceOutput<C = undefined>(
  synthesize: (text: string, ctx?: C) => Promise<{ audio: string; mimeType: string }>,
) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<SpeakStatus>("idle");
  const [error, setError] = useState<"failed" | "unsupported" | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const reqRef = useRef(0); // bumps on every speak/stop so stale responses are dropped

  const supported = typeof window !== "undefined" && typeof Audio !== "undefined";

  const releaseUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  const stop = useCallback(() => {
    reqRef.current++;
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    releaseUrl();
    setStatus("idle");
  }, []);

  const getAudio = () => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  };

  /** Must be called from a click handler (unlocks playback on iOS). */
  const toggle = useCallback(() => {
    setError(null);
    if (!supported) {
      setError("unsupported");
      return;
    }
    if (enabled) {
      stop();
      setEnabled(false);
      return;
    }
    const a = getAudio();
    a.src = SILENT_WAV;
    void a.play().catch(() => {});
    setEnabled(true);
  }, [enabled, supported, stop]);

  const speak = useCallback(
    async (text: string, ctx?: C) => {
      if (!enabled || !supported || !text.trim()) return;
      stop();
      const id = ++reqRef.current;
      setError(null);
      setStatus("loading");
      try {
        const { audio, mimeType } = await synthesize(text, ctx);
        if (id !== reqRef.current) return;
        if (!audio) return setStatus("idle");
        const bin = atob(audio);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        releaseUrl();
        urlRef.current = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        const a = getAudio();
        a.onended = () => {
          if (id === reqRef.current) {
            releaseUrl();
            setStatus("idle");
          }
        };
        a.src = urlRef.current;
        setStatus("speaking");
        await a.play();
      } catch {
        if (id !== reqRef.current) return;
        setError("failed");
        setStatus("idle");
      }
    },
    [enabled, supported, synthesize, stop],
  );

  // Stop playback if the component unmounts.
  useEffect(
    () => () => {
      reqRef.current++;
      audioRef.current?.pause();
      releaseUrl();
    },
    [],
  );

  return { enabled, status, error, supported, toggle, speak, stop };
}
