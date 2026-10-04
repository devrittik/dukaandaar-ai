# Dukaandaar — Voice-first shop companion

A full-stack TypeScript app for a small shop. Owners can create an account and a private shop workspace, then record sales, purchases, expenses, stock losses, and products by chat/voice or manual forms. The dashboard reports daily and weekly activity, stock health, and inventory-based profit.

## Projects

`client/` and `server/` are independent applications with their own package manifests and dependencies. They share no runtime code or types. The Vite dev server proxies `/api` to the Express server so the browser uses same-origin relative requests. When hosting them separately, set `VITE_API_BASE_URL` in `client/.env` to the Express API origin and `CLIENT_ORIGIN` on the server; keep client and API on the same site for the `SameSite=Lax` session cookie (see `client/.env.example`).

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

Open the Vite URL (normally `http://localhost:5173`) and create an account from the landing page. The API uses persistent MongoDB by default and never seeds data during startup. Each signup receives a fresh, isolated shop that starts empty; any existing records under the legacy `SHOP_ID` remain untouched and are not attached to new accounts. Start/configure MongoDB first. The explicit `npm run seed` command still resets only the legacy `SHOP_ID` demo shop; its records are not visible to newly registered accounts.

## Accounts and access

The public landing page links to signup and login. Signup collects an owner name, shop name, email, and password; each account owns a new shop ID and all shop APIs scope reads and writes to the authenticated account. Existing single-shop data is deliberately left untouched and unclaimed. Emails are unique. Passwords are stored as salted scrypt hashes (never returned to the client), and sessions use random server-side tokens stored only as hashes in MongoDB with a 30-day expiry. The browser receives only an `HttpOnly`, `SameSite=Lax` session cookie; logout revokes it. MongoDB stores accounts, sessions, settings, and shop records. `STORAGE_DRIVER=memory` is development-only and loses all accounts/sessions when the API stops.

For production, serve the app over HTTPS and set `CLIENT_ORIGIN` to the exact frontend origin(s) allowed to use the credentialed API. The session cookie is marked `Secure` when `NODE_ENV=production`. This simple auth flow does not include email verification or password reset.

## LLM and rule-based parsing

The same structured intent schema is used for all providers. Choose `LLM_PROVIDER=ollama`, `hosted`, or `rules` in `server/.env`. When `ollama` or `hosted` is selected, that provider is called for every request; the deterministic parser is used only if the provider errors, times out, or returns invalid structured output. Intent parsing sends at most four recent user turns and includes only catalog entries relevant to the current conversation. Ollama uses the local model configured by `OLLAMA_MODEL` with deterministic decoding and a bounded output. Set `LLM_THINKING_MODE=true` to request thinking from Ollama or reasoning from OpenRouter; it is off by default. Custom hosted endpoints keep their provider defaults. Thinking can increase latency, so raise `LLM_TIMEOUT_MS` if needed; reasoning traces are not returned to the assistant UI. `hosted` accepts an OpenAI-compatible chat-completions endpoint, model, and server-only API key. Ambiguous or unsafe commands are clarified instead of committed. All writes require explicit confirmation in the chat flow; manual forms validate before saving.

## Storage

- MongoDB is the default storage driver. Set `STORAGE_DRIVER=mongo`, `MONGODB_URI`, and `MONGODB_DB` in `server/.env`; the default URI targets local MongoDB. Stored data remains across API restarts. `SHOP_ID` names only the legacy/demo fixture shop; each account-created shop uses a separately generated ID.
- A single-node MongoDB replica set is recommended for full multi-document transaction atomicity. Configure `replication.replSetName: rs0`, restart MongoDB, and run `mongosh --eval "rs.initiate()"` once. The default local URI works with either standalone MongoDB or a replica set; Atlas works with its supplied connection string. The app detects standalone MongoDB and uses guarded writes with compensating rollback, so routine writes do not fail with the replica-set transaction error. Standalone mode cannot guarantee multi-document atomicity if the process or server stops mid-write; use a replica set for that guarantee.
- API startup connects to storage but never seeds or resets it. To load demo fixtures manually, run `cd server && npm run seed`; this deletes and recreates data for the configured `SHOP_ID`. Do not run it against data you want to keep. Seeding also has a non-transactional fallback for standalone MongoDB.
- `GET /api/health` reports the active storage driver. `STORAGE_DRIVER=memory` remains available only as an explicit, volatile option; it is not persistent and is not auto-seeded.

## Key behaviors

- Sale, purchase, loss, expense, and product actions can be entered by text/voice or through manual forms. Product catalog details and stock-alert thresholds can also be edited from Inventory or through a confirmed Assistant command.
- Product references are translated to English by the selected LLM before catalog lookup (with dictionary/rule fallback if unavailable); new products receive four or five English-only search aliases, generated with the LLM where needed and normalized again by storage.
- The Inventory page shows category, on-hand quantity, cost, sell price, stock-alert threshold, status, and an edit action. On-hand quantity is read-only there and changes only through sales, purchases, and losses.
- Shop Settings lets the owner edit the shop name, owner name, contact details, address, and the default low-stock threshold for new products.
- Assistant is the first page. Spoken replies are enabled by default; confirmation previews are read aloud and can be confirmed with the existing buttons or voice confirmation. An environment variable selects either the hosted ElevenLabs → Deepgram flow or the local Sherpa-ONNX flow, with browser Web Speech as the fallback.
- Short-term conversation context stays only in API-process memory (up to eight recent user turns per session), expires after two hours idle, and is never persisted to MongoDB. The browser stores only an opaque per-tab session ID. Use the reset-memory button in the Assistant header to clear the context; restarting the API also clears all conversation context.
- Sales and stock losses decrement stock; purchases increase it. Stock changes and their ledger records are committed together by each adapter.
- Daily profit is inventory-based: sales revenue minus recorded cost of goods sold, expenses, and losses valued at cost. Purchases are tracked separately as inventory additions, not double-counted as an immediate expense.
- Analytics are deterministic calculations over stored transactions—no model-generated totals.
- Voice input and speech output use one env-selected turn-based mode. In `hosted` mode, each server-side chain is ElevenLabs → Deepgram, then browser Web Speech if both providers fail. In `local` mode, each chain is Sherpa-ONNX → browser Web Speech. The modes do not cross over: hosted mode never invokes Sherpa, and local mode never calls cloud vendors. Dictation is continuous for long turns, stops when the user taps the mic or after eight seconds of silence, appends recognized speech to existing composer text, and shows a live microphone waveform. Speak mode is enabled by default and can be toggled off.

## Speech setup

Speech configuration lives in `server/.env` (start from `server/.env.example`). Select the mode with `VOICE_MODE=hosted` or `VOICE_MODE=local`; it defaults to `local`. In local mode, the API uses Sherpa-ONNX when compatible model assets are installed, then the browser uses Web Speech if Sherpa is unavailable or fails. In hosted mode, the API tries the configured cloud providers, then the client uses Web Speech if they fail. If the selected server mode has no configured provider, the client uses Web Speech directly. In hosted mode, audio for STT and text for TTS are sent to vendors. API keys stay on the server and are never returned to the browser. Enable hosted mode only if you are comfortable sending recordings and assistant readbacks to those services. For a same-machine setup, keep the Vite proxy pointed at the local API; for separate devices, use a trusted private network and HTTPS so browser microphone access is available.

### Hosted voice providers

Set `VOICE_MODE=hosted` to use ElevenLabs → Deepgram. Unconfigured cloud providers are skipped; if both fail, browser Web Speech is used rather than Sherpa. The `.env` variables `VOICE_STT_PROVIDER_ORDER` and `VOICE_TTS_PROVIDER_ORDER` customize provider order in hosted mode only. Configure `ELEVENLABS_API_KEY` and/or `DEEPGRAM_API_KEY` on the API server. `ELEVENLABS_TTS_VOICE_ID` is also required for ElevenLabs TTS. Provider model IDs, output format, and base URLs are configurable in `.env`; see `server/.env.example`. No provider keys are stored in the database or entered through the app UI. `VOICE_MODE=local` skips cloud providers entirely, even if cloud credentials are present.

Defaults are ElevenLabs `scribe_v2` for STT and `eleven_multilingual_v2` for TTS, and Deepgram `nova-3` for STT and `aura-2-thalia-en` for TTS. Set `VOICE_STT_LANGUAGE=auto` to request language detection; leave it blank to use the language selected in the app. `SHERPA_ONNX_WHISPER_LANGUAGE` can override the local Whisper setting. A Deepgram regional endpoint can be set with `DEEPGRAM_BASE_URL`. These are normal request/response API calls, not a live streaming session. The provider adapters are isolated so another vendor (for example Groq STT) can be added without changing the chat/confirmation flow; Groq is not wired in this version.

- **Sherpa-ONNX local STT:** the server uses the `sherpa-onnx` Node/WebAssembly package, so no CMake or C++ compiler setup is needed. Set `SHERPA_ONNX_WHISPER_ENCODER_PATH`, `SHERPA_ONNX_WHISPER_DECODER_PATH`, and `SHERPA_ONNX_WHISPER_TOKENS_PATH` to the three files from a compatible multilingual Whisper ONNX model bundle. The already-downloaded whisper.cpp GGML `.bin` files are a different format and cannot be used by Sherpa. Leave `SHERPA_ONNX_WHISPER_LANGUAGE` blank to use the conversation language selected in the app, or set it to `auto` for language detection. Sherpa's Node/WASM API requires Node 18 or later and runs inference in a child Node process so transcription does not block the API event loop. Download a compatible multilingual Whisper bundle from the [Sherpa-ONNX ASR model releases](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models); the [Node.js examples](https://github.com/k2-fsa/sherpa-onnx/tree/master/nodejs-examples) show the expected encoder, decoder, and tokens configuration.

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
- **Sherpa-ONNX Supertonic local TTS:** download the Supertonic 3 model bundle and set `SHERPA_ONNX_TTS_MODEL_DIR` to the directory containing `duration_predictor.int8.onnx`, `text_encoder.int8.onnx`, `vector_estimator.int8.onnx`, `vocoder.int8.onnx`, `tts.json`, `unicode_indexer.bin`, and `voice.bin`. Optional controls are `SHERPA_ONNX_TTS_SPEAKER_ID` (0-9), `SHERPA_ONNX_TTS_SPEED` (0.5-2.0), and `SHERPA_ONNX_TTS_NUM_STEPS` (1-32). Supertonic supports 31 languages, including English and Hindi, but not Bengali or Chinese. In local mode, an unsupported language falls back to browser speech when available; hosted mode never invokes Supertonic.

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
- `GET /api/speech/status` reports the active STT/TTS provider chains for the selected `VOICE_MODE` and never returns API keys. `SPEECH_PROVIDER_TIMEOUT_MS` bounds hosted-provider calls; `SPEECH_ENGINE_TIMEOUT_MS`, `SPEECH_MAX_AUDIO_SECONDS`, and `SPEECH_MAX_AUDIO_BYTES` bound local inference and recording size. Defaults allow up to 30 minutes of 16 kHz mono PCM (with a 10-minute local-engine timeout), subject to the 64 MiB upload limit. No speech model weights are included in this project.

## Build

```bash
cd server && npm run build
cd ../client && npm run build
```
