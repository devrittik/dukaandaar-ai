import assert from "node:assert/strict";
import { test } from "node:test";
import { getSpeechStatus, SpeechServiceError, synthesizeSpeech, transcribeWav } from "../src/services/offlineSpeech.js";

const CONFIG_KEYS = [
  "VOICE_MODE", "SHERPA_ONNX_WHISPER_ENCODER_PATH", "SHERPA_ONNX_WHISPER_DECODER_PATH", "SHERPA_ONNX_WHISPER_TOKENS_PATH",
  "SHERPA_ONNX_TTS_MODEL_DIR", "VOICE_STT_PROVIDER_ORDER", "VOICE_TTS_PROVIDER_ORDER", "VOICE_STT_LANGUAGE",
  "ELEVENLABS_API_KEY", "ELEVENLABS_BASE_URL", "ELEVENLABS_STT_MODEL_ID", "ELEVENLABS_TTS_MODEL_ID",
  "ELEVENLABS_TTS_VOICE_ID", "ELEVENLABS_TTS_OUTPUT_FORMAT", "DEEPGRAM_API_KEY", "DEEPGRAM_BASE_URL",
  "DEEPGRAM_STT_MODEL", "DEEPGRAM_TTS_MODEL", "DEEPGRAM_TTS_ENCODING", "DEEPGRAM_TTS_CONTAINER",
  "DEEPGRAM_TTS_SAMPLE_RATE", "SPEECH_PROVIDER_TIMEOUT_MS",
];

const originalFetch = globalThis.fetch;

async function withEnvironment(values: Record<string, string>, action: () => Promise<void>): Promise<void> {
  const previous = new Map(CONFIG_KEYS.map((key) => [key, process.env[key]]));
  for (const key of CONFIG_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try { await action(); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function pcmWav(): Buffer {
  const sampleBytes = 3_200;
  const wav = Buffer.alloc(44 + sampleBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(sampleBytes, 40);
  return wav;
}

function installFetch(mock: typeof fetch): void { globalThis.fetch = mock; }

test("speech status exposes configured providers in env-defined order without exposing secrets", async () => {
  await withEnvironment({
    VOICE_MODE: "hosted",
    ELEVENLABS_API_KEY: "secret-elevenlabs",
    ELEVENLABS_TTS_VOICE_ID: "voice-id",
    DEEPGRAM_API_KEY: "secret-deepgram",
    VOICE_STT_PROVIDER_ORDER: "deepgram,elevenlabs,sherpa-onnx",
    VOICE_TTS_PROVIDER_ORDER: "elevenlabs,deepgram,sherpa-onnx",
  }, async () => {
    const status = await getSpeechStatus();
    assert.deepEqual(status.stt.providers, ["deepgram", "elevenlabs"]);
    assert.equal(status.stt.engine, "deepgram");
    assert.deepEqual(status.tts.providers, ["elevenlabs", "deepgram"]);
    assert.equal(status.tts.engine, "elevenlabs");
    assert.ok(!JSON.stringify(status).includes("secret-elevenlabs"));
    assert.ok(!JSON.stringify(status).includes("secret-deepgram"));
  });
});

test("STT falls from ElevenLabs to Deepgram and passes the selected language", async () => {
  const calls: string[] = [];
  try {
    installFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      if (url.pathname.endsWith("/speech-to-text")) {
        assert.equal((init?.headers as Record<string, string>)?.["xi-api-key"], "eleven-key");
        const form = init?.body as FormData;
        assert.equal(form.get("model_id"), "scribe_v2");
        assert.equal(form.get("language_code"), "hi");
        assert.ok(form.get("file") instanceof Blob);
        return new Response("{\"detail\":\"invalid key\"}", { status: 401 });
      }
      assert.equal(url.pathname, "/v1/listen");
      assert.equal(url.searchParams.get("model"), "nova-3");
      assert.equal(url.searchParams.get("language"), "hi-IN");
      assert.equal((init?.headers as Record<string, string>)?.Authorization, "Token deepgram-key");
      return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "नमस्ते दुकान" }] }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch);

    await withEnvironment({ VOICE_MODE: "hosted", ELEVENLABS_API_KEY: "eleven-key", DEEPGRAM_API_KEY: "deepgram-key" }, async () => {
      const transcript = await transcribeWav(pcmWav(), "hi-IN");
      assert.equal(transcript, "नमस्ते दुकान");
      assert.equal(calls.length, 2);
      assert.ok(calls[0]?.includes("api.elevenlabs.io/v1/speech-to-text"));
      assert.ok(calls[1]?.includes("api.deepgram.com/v1/listen"));
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("TTS uses ElevenLabs WAV output and returns the provider content type", async () => {
  const audioBytes = Buffer.from("RIFF-fake-wav-data");
  try {
    installFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1/text-to-speech/voice-abc");
      assert.equal(url.searchParams.get("output_format"), "wav_16000");
      assert.equal((init?.headers as Record<string, string>)?.["xi-api-key"], "eleven-key");
      const body = JSON.parse(String(init?.body)) as { text: string; model_id: string };
      assert.deepEqual(body, { text: "Hello there", model_id: "eleven_multilingual_v2" });
      return new Response(audioBytes, { status: 200, headers: { "content-type": "audio/wav" } });
    }) as typeof fetch);

    await withEnvironment({ VOICE_MODE: "hosted", ELEVENLABS_API_KEY: "eleven-key", ELEVENLABS_TTS_VOICE_ID: "voice-abc" }, async () => {
      const result = await synthesizeSpeech(" Hello there ", "en-IN");
      assert.equal(result.contentType, "audio/wav");
      assert.deepEqual(result.audio, audioBytes);
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("TTS falls from ElevenLabs to Deepgram when the preferred cloud provider fails", async () => {
  const calls: string[] = [];
  try {
    installFetch((async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      if (url.pathname.endsWith("/text-to-speech/voice-abc")) return new Response("rate limited", { status: 429 });
      assert.equal(url.pathname, "/v1/speak");
      assert.equal(url.searchParams.get("model"), "aura-2-thalia-en");
      assert.equal(url.searchParams.get("container"), "wav");
      return new Response(Buffer.from("RIFF-deepgram-wav"), { status: 200, headers: { "content-type": "audio/wav" } });
    }) as typeof fetch);

    await withEnvironment({
      VOICE_MODE: "hosted",
      ELEVENLABS_API_KEY: "eleven-key",
      ELEVENLABS_TTS_VOICE_ID: "voice-abc",
      DEEPGRAM_API_KEY: "deepgram-key",
    }, async () => {
      const result = await synthesizeSpeech("Hello", "en-IN");
      assert.equal(result.contentType, "audio/wav");
      assert.equal(result.audio.toString(), "RIFF-deepgram-wav");
      assert.equal(calls.length, 2);
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("hosted mode does not use Sherpa after configured cloud STT providers fail", async () => {
  try {
    installFetch((async () => new Response("unavailable", { status: 503 })) as typeof fetch);
    await withEnvironment({ VOICE_MODE: "hosted", ELEVENLABS_API_KEY: "eleven-key", DEEPGRAM_API_KEY: "deepgram-key" }, async () => {
      await assert.rejects(() => transcribeWav(pcmWav(), "en-IN"), (error: unknown) => {
        assert.ok(error instanceof SpeechServiceError);
        assert.equal(error.statusCode, 502);
        return true;
      });
    });
  } finally { globalThis.fetch = originalFetch; }
});
