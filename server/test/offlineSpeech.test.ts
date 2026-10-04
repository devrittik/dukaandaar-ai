import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getSpeechStatus, SpeechServiceError, synthesizeSpeech, transcribeWav } from "../src/services/offlineSpeech.js";

const CONFIG_KEYS = [
  "SHERPA_ONNX_WHISPER_ENCODER_PATH", "SHERPA_ONNX_WHISPER_DECODER_PATH", "SHERPA_ONNX_WHISPER_TOKENS_PATH", "SHERPA_ONNX_WHISPER_LANGUAGE",
  "SHERPA_ONNX_TTS_MODEL_DIR", "SHERPA_ONNX_TTS_SPEAKER_ID", "SHERPA_ONNX_TTS_SPEED", "SHERPA_ONNX_TTS_NUM_STEPS",
  "VOICE_STT_PROVIDER_ORDER", "VOICE_TTS_PROVIDER_ORDER", "VOICE_STT_LANGUAGE", "ELEVENLABS_API_KEY", "ELEVENLABS_BASE_URL",
  "ELEVENLABS_STT_MODEL_ID", "ELEVENLABS_TTS_MODEL_ID", "ELEVENLABS_TTS_VOICE_ID", "ELEVENLABS_TTS_OUTPUT_FORMAT",
  "DEEPGRAM_API_KEY", "DEEPGRAM_BASE_URL", "DEEPGRAM_STT_MODEL", "DEEPGRAM_TTS_MODEL", "DEEPGRAM_TTS_ENCODING",
  "DEEPGRAM_TTS_CONTAINER", "DEEPGRAM_TTS_SAMPLE_RATE", "SPEECH_PROVIDER_TIMEOUT_MS",
  "SPEECH_ENGINE_TIMEOUT_MS", "SPEECH_MAX_AUDIO_SECONDS", "SPEECH_MAX_AUDIO_BYTES",
];

const SUPERTONIC_MODEL_FILES = [
  "duration_predictor.int8.onnx",
  "text_encoder.int8.onnx",
  "vector_estimator.int8.onnx",
  "vocoder.int8.onnx",
  "tts.json",
  "unicode_indexer.bin",
  "voice.bin",
];

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
  const wav = Buffer.alloc(44 + 2);
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
  wav.writeUInt32LE(2, 40);
  return wav;
}

async function captureSpeechError(action: () => Promise<unknown>): Promise<SpeechServiceError> {
  try { await action(); }
  catch (error) {
    assert.ok(error instanceof SpeechServiceError);
    return error;
  }
  assert.fail("Expected a SpeechServiceError");
}

test("speech status and unavailable engines fail clearly when assets are not configured", async () => {
  await withEnvironment({
    SHERPA_ONNX_WHISPER_ENCODER_PATH: "/missing/encoder.onnx",
    SHERPA_ONNX_WHISPER_DECODER_PATH: "/missing/decoder.onnx",
    SHERPA_ONNX_WHISPER_TOKENS_PATH: "/missing/tokens.txt",
    SHERPA_ONNX_TTS_MODEL_DIR: "/missing/supertonic-model",
  }, async () => {
    const status = await getSpeechStatus();
    assert.deepEqual(status, {
      stt: { available: false, engine: null, providers: [] },
      tts: { available: false, engine: null, providers: [], languages: [] },
    });
    const sttError = await captureSpeechError(() => transcribeWav(pcmWav(), "en-IN"));
    assert.equal(sttError.statusCode, 503);
    const ttsError = await captureSpeechError(() => synthesizeSpeech("Hello", "en-IN"));
    assert.equal(ttsError.statusCode, 503);
  });
});

test("Sherpa-ONNX STT status recognizes configured encoder, decoder, and tokens paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dukaandaar-speech-test-"));
  try {
    const encoder = join(directory, "tiny-encoder.int8.onnx");
    const decoder = join(directory, "tiny-decoder.int8.onnx");
    const tokens = join(directory, "tiny-tokens.txt");
    await Promise.all([writeFile(encoder, "model"), writeFile(decoder, "model"), writeFile(tokens, "tokens")]);

    await withEnvironment({
      SHERPA_ONNX_WHISPER_ENCODER_PATH: encoder,
      SHERPA_ONNX_WHISPER_DECODER_PATH: decoder,
      SHERPA_ONNX_WHISPER_TOKENS_PATH: tokens,
    }, async () => {
      const status = await getSpeechStatus();
      assert.equal(status.stt.available, true);
      assert.equal(status.stt.engine, "sherpa-onnx");
      assert.deepEqual(status.stt.providers, ["sherpa-onnx"]);
      assert.equal(status.tts.available, false);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Sherpa-ONNX TTS status requires the full Supertonic bundle and reports model languages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dukaandaar-supertonic-test-"));
  try {
    await Promise.all(SUPERTONIC_MODEL_FILES.map((file) => writeFile(join(directory, file), "model asset")));

    await withEnvironment({ SHERPA_ONNX_TTS_MODEL_DIR: directory }, async () => {
      const status = await getSpeechStatus();
      assert.equal(status.tts.available, true);
      assert.equal(status.tts.engine, "sherpa-onnx");
      assert.deepEqual(status.tts.providers, ["sherpa-onnx"]);
      assert.equal(status.tts.languages.length, 31);
      assert.ok(status.tts.languages.includes("en"));
      assert.ok(status.tts.languages.includes("hi"));
      assert.ok(!status.tts.languages.includes("bn"));
      assert.ok(!status.tts.languages.includes("zh"));
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Supertonic rejects unsupported languages so the client can use browser speech", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dukaandaar-supertonic-language-test-"));
  try {
    await Promise.all(SUPERTONIC_MODEL_FILES.map((file) => writeFile(join(directory, file), "model asset")));
    await withEnvironment({ SHERPA_ONNX_TTS_MODEL_DIR: directory }, async () => {
      const bengaliError = await captureSpeechError(() => synthesizeSpeech("নমস্কার", "bn-IN"));
      assert.equal(bengaliError.statusCode, 422);
      const chineseError = await captureSpeechError(() => synthesizeSpeech("你好", "zh-CN"));
      assert.equal(chineseError.statusCode, 422);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("transcription rejects malformed or unsupported WAV input before starting an engine", async () => {
  const malformedError = await captureSpeechError(() => transcribeWav(Buffer.from("not a wav"), "en-IN"));
  assert.equal(malformedError.statusCode, 400);
  const unsupportedRate = pcmWav();
  unsupportedRate.writeUInt32LE(48_000, 24);
  unsupportedRate.writeUInt32LE(96_000, 28);
  const formatError = await captureSpeechError(() => transcribeWav(unsupportedRate, "en-IN"));
  assert.equal(formatError.statusCode, 400);
});
