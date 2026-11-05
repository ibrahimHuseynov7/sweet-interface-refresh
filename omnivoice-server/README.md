# Voice sidecar (OmniVoice TTS + Whisper STT)

OmniVoice is a PyTorch model, so it runs here as a small HTTP service; the Bir Chat server
(`src/lib/tts.functions.ts`, `src/lib/stt.functions.ts`) calls it. OmniVoice only does
text-to-speech, so `/stt` uses faster-whisper.

```sh
cd omnivoice-server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
OMNIVOICE_API_KEY=some-shared-secret uvicorn server:app --host 0.0.0.0 --port 8008
```

A GPU is strongly recommended (CPU works but is slow).

| Variable | Default | Meaning |
| --- | --- | --- |
| `OMNIVOICE_MODEL` | `LocalDoc/omnivoice-azerbaijani` | TTS model |
| `OMNIVOICE_NUM_STEP` | `32` | Diffusion steps (lower = faster) |
| `OMNIVOICE_INSTRUCT` | `female, young adult, moderate pitch` | Voice design when no reference voice |
| `OMNIVOICE_REF_AUDIO` / `OMNIVOICE_REF_TEXT` | — | Clone a voice: 5–15 s clean WAV + its exact transcript |
| `OMNIVOICE_API_KEY` | — | Shared secret; the app sends it as `Authorization: Bearer …` |
| `WHISPER_MODEL` | `large-v3` | faster-whisper model for STT |
| `STT_ENABLED` | `true` | Set `false` to load TTS only |

In the app, set `OMNIVOICE_URL` (e.g. `http://localhost:8008`) and the same `OMNIVOICE_API_KEY`.
