"""
Voice sidecar for Bir Chat: OmniVoice text-to-speech (+ Whisper speech-to-text).

OmniVoice (LocalDoc/omnivoice-azerbaijani) only does TTS, so /stt uses faster-whisper.
The TypeScript server calls this over HTTP (OMNIVOICE_URL); the browser never talks to it.

Run:  uvicorn server:app --host 0.0.0.0 --port 8008
"""

from __future__ import annotations

import base64
import io
import os
import re
import threading

import numpy as np
import soundfile as sf
import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from omnivoice import OmniVoice
from pydantic import BaseModel, Field

SAMPLE_RATE = 24000  # OmniVoice output rate

MODEL_ID = os.getenv("OMNIVOICE_MODEL", "LocalDoc/omnivoice-azerbaijani")
NUM_STEP = int(os.getenv("OMNIVOICE_NUM_STEP", "32"))
# Voice design (used when no reference voice is configured).
INSTRUCT = os.getenv("OMNIVOICE_INSTRUCT", "female, young adult, moderate pitch")
# Optional voice cloning: a clean 5-15 s recording and its exact transcript.
REF_AUDIO = os.getenv("OMNIVOICE_REF_AUDIO", "")
REF_TEXT = os.getenv("OMNIVOICE_REF_TEXT", "")
# Shared secret between the app server and this sidecar (optional but recommended).
API_KEY = os.getenv("OMNIVOICE_API_KEY", "")

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")
STT_ENABLED = os.getenv("STT_ENABLED", "true").lower() != "false"
SUPPORTED_LANGS = {"az", "ru", "en"}

device = "cuda:0" if torch.cuda.is_available() else "cpu"
dtype = torch.float16 if device != "cpu" else torch.float32

tts_model = OmniVoice.from_pretrained(MODEL_ID, device_map=device, dtype=dtype)
# Build the clone prompt once and reuse it for every request.
voice_prompt = (
    tts_model.create_voice_clone_prompt(ref_audio=REF_AUDIO, ref_text=REF_TEXT)
    if REF_AUDIO and REF_TEXT
    else None
)

stt_model = None
if STT_ENABLED:
    from faster_whisper import WhisperModel

    stt_model = WhisperModel(
        WHISPER_MODEL,
        device="cuda" if device != "cpu" else "cpu",
        compute_type="float16" if device != "cpu" else "int8",
    )

# One GPU: run one generation at a time.
tts_lock = threading.Lock()
stt_lock = threading.Lock()

app = FastAPI(title="Bir Chat voice sidecar")


def check_key(authorization: str = Header(default="")) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="bad key")


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    language: str = "az"
    instruct: str | None = None


class SttIn(BaseModel):
    audio: str = Field(min_length=100)  # base64 WAV
    language: str = "az"


def chunks(text: str, limit: int = 220) -> list[str]:
    """Sentence-sized pieces so long replies stay stable; joined back with short pauses."""
    parts = re.split(r"(?<=[.!?…])\s+|\n+", text.strip())
    out: list[str] = []
    cur = ""
    for p in (x.strip() for x in parts):
        if not p:
            continue
        if cur and len(cur) + 1 + len(p) > limit:
            out.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        out.append(cur)
    return out or [text.strip()]


@app.get("/health")
def health() -> dict:
    return {"ok": True, "device": device, "tts": MODEL_ID, "stt": WHISPER_MODEL if stt_model else None}


@app.post("/tts", dependencies=[Depends(check_key)])
def tts(req: TtsIn) -> dict:
    pieces = chunks(req.text)
    kwargs: dict = {"text": pieces, "language": req.language, "num_step": NUM_STEP}
    if voice_prompt is not None:
        kwargs["voice_clone_prompt"] = voice_prompt
    else:
        kwargs["instruct"] = req.instruct or INSTRUCT
    with tts_lock, torch.inference_mode():
        audios = tts_model.generate(**kwargs)
    pause = np.zeros(int(SAMPLE_RATE * 0.25), dtype=np.float32)
    joined: list[np.ndarray] = []
    for i, a in enumerate(audios):
        a = a.detach().float().cpu().numpy() if torch.is_tensor(a) else np.asarray(a, dtype=np.float32)
        if i:
            joined.append(pause)
        joined.append(a.reshape(-1))
    buf = io.BytesIO()
    sf.write(buf, np.concatenate(joined), SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return {"audio": base64.b64encode(buf.getvalue()).decode(), "mimeType": "audio/wav"}


@app.post("/stt", dependencies=[Depends(check_key)])
def stt(req: SttIn) -> dict:
    if stt_model is None:
        raise HTTPException(status_code=503, detail="STT disabled")
    try:
        raw = base64.b64decode(req.audio)
    except Exception:
        raise HTTPException(status_code=400, detail="audio is not base64")

    def run(language: str | None):
        segments, info = stt_model.transcribe(
            io.BytesIO(raw),
            language=language,
            beam_size=5,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments).strip(), info.language

    with stt_lock:
        # Transcribe in the language actually spoken; the UI language is only a fallback hint
        # when detection lands outside the languages the app supports.
        text, detected = run(None)
        if detected not in SUPPORTED_LANGS and req.language in SUPPORTED_LANGS:
            text, detected = run(req.language)
    return {"text": text, "language": detected}
