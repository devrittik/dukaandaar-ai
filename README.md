# Dukaandaar — Voice-first shop companion

A full-stack TypeScript prototype for a small shop. Record sales, purchases, expenses, stock losses, and products by chat/voice or manual forms. The dashboard reports daily and weekly activity, stock health, and inventory-based profit.

## Projects

`client/` and `server/` are independent applications with their own package manifests and dependencies. They share no runtime code or types. The Vite dev server proxies `/api` to the Express server so the browser uses same-origin relative requests. When hosting them separately, set `VITE_API_BASE_URL` in `client/.env` to the Express API origin (see `client/.env.example`).

## Run locally (two terminals)

```bash
# Terminal 1
cd server
npm install
cp .env.example .env
npm run dev

# Terminal 2
cd client
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). The API uses persistent MongoDB by default and never seeds data during startup. Start/configure MongoDB first; run `cd server && npm run seed` only if you want demo fixtures (this is a destructive reset for the configured shop).

## LLM and rule-based parsing

The same structured intent schema is used for all providers. Choose `LLM_PROVIDER=ollama`, `hosted`, or `rules` in `server/.env`. When `ollama` or `hosted` is selected, that provider is called for every request; the deterministic parser is used only if the provider errors, times out, or returns invalid structured output. Intent parsing sends at most four recent user turns and includes only catalog entries relevant to the current conversation. Ollama uses the local model configured by `OLLAMA_MODEL` with deterministic decoding and a bounded output. Set `LLM_THINKING_MODE=true` to request thinking from Ollama or reasoning from OpenRouter; it is off by default. Custom hosted endpoints keep their provider defaults. Thinking can increase latency, so raise `LLM_TIMEOUT_MS` if needed; reasoning traces are not returned to the assistant UI. `hosted` accepts an OpenAI-compatible chat-completions endpoint, model, and server-only API key. Ambiguous or unsafe commands are clarified instead of committed. All writes require explicit confirmation in the chat flow; manual forms validate before saving.

## Storage

- MongoDB is the default storage driver. Set `STORAGE_DRIVER=mongo`, `MONGODB_URI`, `MONGODB_DB`, and `SHOP_ID` in `server/.env`; the default URI targets local MongoDB. Stored data remains across API restarts.
- A single-node MongoDB replica set is recommended for full multi-document transaction atomicity. Configure `replication.replSetName: rs0`, restart MongoDB, and run `mongosh --eval "rs.initiate()"` once. The default local URI works with either standalone MongoDB or a replica set; Atlas works with its supplied connection string. The app detects standalone MongoDB and uses guarded writes with compensating rollback, so routine writes do not fail with the replica-set transaction error. Standalone mode cannot guarantee multi-document atomicity if the process or server stops mid-write; use a replica set for that guarantee.
- API startup connects to storage but never seeds or resets it. To load demo fixtures manually, run `cd server && npm run seed`; this deletes and recreates data for the configured `SHOP_ID`. Do not run it against data you want to keep. Seeding also has a non-transactional fallback for standalone MongoDB.
- `GET /api/health` reports the active storage driver. `STORAGE_DRIVER=memory` remains available only as an explicit, volatile option; it is not persistent and is not auto-seeded.

## Key behaviors

- Sale, purchase, loss, expense, and product actions can be entered by text/voice or through manual forms. Product catalog details and stock-alert thresholds can also be edited from Inventory or through a confirmed Assistant command.
- Product references are translated to English by the selected LLM before catalog lookup (with dictionary/rule fallback if unavailable); new products receive four or five English-only search aliases, generated with the LLM where needed and normalized again by storage.
- The Inventory page shows category, on-hand quantity, cost, sell price, stock-alert threshold, status, and an edit action. On-hand quantity is read-only there and changes only through sales, purchases, and losses.
- Shop Settings lets the owner edit the shop name, owner name, contact details, address, and the default low-stock threshold for new products.
- Assistant is the first page. Spoken replies are enabled by default; confirmation previews are read aloud and can be confirmed with the existing buttons or voice confirmation. Speech can use optional server-configured ElevenLabs and Deepgram APIs, then Sherpa-ONNX, with browser speech as the final fallback. With no hosted API keys, the existing local/browser flow remains in use.
- Short-term conversation context stays only in API-process memory (up to eight recent user turns per session), expires after two hours idle, and is never persisted to MongoDB. The browser stores only an opaque per-tab session ID. Use the reset-memory button in the Assistant header to clear the context; restarting the API also clears all conversation context.
- Sales and stock losses decrement stock; purchases increase it. Stock changes and their ledger records are committed together by each adapter.
- Daily profit is inventory-based: sales revenue minus recorded cost of goods sold, expenses, and losses valued at cost. Purchases are tracked separately as inventory additions, not double-counted as an immediate expense.
- Analytics are deterministic calculations over stored transactions—no model-generated totals.
- Voice input supports a turn-based provider chain: ElevenLabs STT, Deepgram STT, local Sherpa-ONNX STT, then browser Speech Recognition. Spoken output follows the corresponding ElevenLabs → Deepgram → Sherpa-ONNX chain, then browser speech synthesis. Dictation is continuous for long turns, stops when the user taps the mic or after eight seconds of silence, appends recognized speech to existing composer text, and shows a live microphone waveform. Speak mode is enabled by default and can be toggled off.

## Speech setup

Speech configuration lives in `server/.env` (start from `server/.env.example`). The browser sends a temporary PCM WAV recording to this app's API. With no cloud API keys configured, it is handled by Sherpa-ONNX locally when model assets are installed; otherwise the client uses browser speech features. When ElevenLabs or Deepgram credentials are configured, the API forwards audio for STT and text for TTS to those vendors in the configured order. Keys stay on the server and are never returned to the browser. Enable cloud providers only if you are comfortable sending voice recordings and assistant readbacks to those services. For a same-machine setup, keep the Vite proxy pointed at the local API; for separate devices, use a trusted private network and HTTPS so browser microphone access is available.

### Optional hosted voice providers

The default turn-based chain is `ElevenLabs → Deepgram → Sherpa-ONNX`; unconfigured providers are skipped, and a failed provider request falls through to the next. The `.env` variables `VOICE_STT_PROVIDER_ORDER` and `VOICE_TTS_PROVIDER_ORDER` can reorder/limit the chain. Configure `ELEVENLABS_API_KEY` and/or `DEEPGRAM_API_KEY` on the API server. `ELEVENLABS_TTS_VOICE_ID` is also required to use ElevenLabs TTS. Provider model IDs, output format, and base URLs are configurable in `.env`; see `server/.env.example`. No provider keys are stored in the database or entered through the app UI.

Defaults are ElevenLabs `scribe_v2` for STT and `eleven_multilingual_v2` for TTS, and Deepgram `nova-3` for STT and `aura-2-thalia-en` for TTS. Set `VOICE_STT_LANGUAGE=auto` to request language detection across STT providers; leave it blank to use the language selected in the app. `SHERPA_ONNX_WHISPER_LANGUAGE` can override the local Whisper setting. A Deepgram regional endpoint can be set with `DEEPGRAM_BASE_URL`. These are normal request/response API calls, not a live streaming session. The provider adapters are isolated so another vendor (for example Groq STT) can be added without changing the chat/confirmation flow; Groq is not wired in this version.

- **Sherpa-ONNX STT fallback:** the server uses the `sherpa-onnx` Node/WebAssembly package, so no CMake or C++ compiler setup is needed. Set `SHERPA_ONNX_WHISPER_ENCODER_PATH`, `SHERPA_ONNX_WHISPER_DECODER_PATH`, and `SHERPA_ONNX_WHISPER_TOKENS_PATH` to the three files from a compatible multilingual Whisper ONNX model bundle. The already-downloaded whisper.cpp GGML `.bin` files are a different format and cannot be used by Sherpa. Leave `SHERPA_ONNX_WHISPER_LANGUAGE` blank to use the conversation language selected in the app, or set it to `auto` for language detection. Sherpa's Node/WASM API requires Node 18 or later and runs inference in a child Node process so transcription does not block the API event loop. Download a compatible multilingual Whisper bundle from the [Sherpa-ONNX ASR model releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models); the [Node.js examples](https://github.com/k2-fsa/sherpa-onnx/tree/master/nodejs-examples) show the expected encoder, decoder, and tokens configuration.

  Windows PowerShell example for Sherpa's multilingual Whisper-tiny model bundle:
  ```powershell
  $modelDir = 'F:\models\sherpa-onnx-whisper-tiny'
  New-Item -ItemType Directory -Force $modelDir | Out-Null
  $archive = Join-Path $modelDir 'sherpa-onnx-whisper-tiny.tar.bz2'
  Invoke-WebRequest 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2' -OutFile $archive
  tar -xjf $archive -C $modelDir
  Get-ChildItem $modelDir -Recurse -File | Where-Object Name -Match 'tiny-(encoder|decoder).*onnx|tiny-tokens'
  ```
  Set the three `SHERPA_ONNX_WHISPER_*_PATH` variables to the exact files returned by that last command. Change `F:\models` to a folder on your machine.
- **Sherpa-ONNX Supertonic TTS fallback:** download the Supertonic 3 model bundle and set `SHERPA_ONNX_TTS_MODEL_DIR` to the directory containing `duration_predictor.int8.onnx`, `text_encoder.int8.onnx`, `vector_estimator.int8.onnx`, `vocoder.int8.onnx`, `tts.json`, `unicode_indexer.bin`, and `voice.bin`. Optional controls are `SHERPA_ONNX_TTS_SPEAKER_ID` (0-9), `SHERPA_ONNX_TTS_SPEED` (0.5-2.0), and `SHERPA_ONNX_TTS_NUM_STEPS` (1-32). Supertonic supports 31 languages, including English and Hindi, but not Bengali or Chinese. If neither configured cloud voice provider nor Supertonic supports the selected language, the browser voice fallback is used when available.

  Windows PowerShell example using the release linked from the [official Supertonic TTS instructions](https://k2-fsa.github.io/sherpa/onnx/tts/supertonic.html):
  ```powershell
  $modelDir = 'F:\models\sherpa-onnx-supertonic-3'
  New-Item -ItemType Directory -Force $modelDir | Out-Null
  $archive = Join-Path $modelDir 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2'
  Invoke-WebRequest 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2' -OutFile $archive
  tar -xjf $archive -C $modelDir
  Get-ChildItem $modelDir -Recurse -Filter 'duration_predictor.int8.onnx' | Select-Object -ExpandProperty DirectoryName
  ```
  Set `SHERPA_ONNX_TTS_MODEL_DIR` to the directory printed by the last command. Change `F:\models` to a folder on your machine.
- `GET /api/speech/status` reports the active STT/TTS provider chains and local Sherpa model availability; it never returns API keys. `SPEECH_PROVIDER_TIMEOUT_MS` bounds hosted-provider calls; `SPEECH_ENGINE_TIMEOUT_MS`, `SPEECH_MAX_AUDIO_SECONDS`, and `SPEECH_MAX_AUDIO_BYTES` bound local inference and recording size. Defaults allow up to 30 minutes of 16 kHz mono PCM (with a 10-minute local-engine timeout), subject to the 64 MiB upload limit. No speech model weights are included in this project.

## Build

```bash
cd server && npm run build
cd ../client && npm run build
```
