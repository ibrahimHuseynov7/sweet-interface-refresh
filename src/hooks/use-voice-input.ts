// Mic recording for the chat input: MediaRecorder -> 16 kHz mono WAV (base64) -> server STT.
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStatus = "idle" | "recording" | "transcribing";

const TARGET_RATE = 16_000;
const MAX_SECONDS = 60;

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const offline = new OfflineAudioContext(1, length, TARGET_RATE); // resample + downmix to mono
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const bytes = new Uint8Array(encodeWav(rendered.getChannelData(0), TARGET_RATE));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  } finally {
    void ctx.close();
  }
}

export function useVoiceInput(transcribe: (wavBase64: string) => Promise<string>) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<"denied" | "unsupported" | "failed" | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const resolveRef = useRef<((text: string) => void) | null>(null);

  const supported =
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (recRef.current?.state === "recording") recRef.current.stop();
  }, []);

  /** Starts recording; the returned promise resolves with the transcript once recording stops. */
  const start = useCallback(async (): Promise<string> => {
    setError(null);
    if (!supported) {
      setError("unsupported");
      return "";
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("denied");
      return "";
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    recRef.current = rec;
    cancelledRef.current = false;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<string>((resolve) => {
      resolveRef.current = resolve;
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recRef.current = null;
        if (cancelledRef.current || !chunks.length) {
          setStatus("idle");
          return resolve("");
        }
        setStatus("transcribing");
        try {
          const wav = await blobToWavBase64(new Blob(chunks, { type: rec.mimeType }));
          resolve(await transcribe(wav));
        } catch {
          setError("failed");
          resolve("");
        } finally {
          setStatus("idle");
        }
      };
    });
    rec.start();
    setStatus("recording");
    timerRef.current = setTimeout(stop, MAX_SECONDS * 1000);
    return done;
  }, [supported, transcribe, stop]);

  // Release the mic if the component unmounts mid-recording.
  useEffect(
    () => () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (recRef.current?.state === "recording") recRef.current.stop();
      resolveRef.current = null;
    },
    [],
  );

  return { status, error, supported, start, stop };
}
