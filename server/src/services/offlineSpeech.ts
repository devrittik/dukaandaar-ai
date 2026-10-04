import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { logWarn } from "../utils/logger.js";
import { activeSpeechProviders, tryCloudSynthesis, tryCloudTranscription, type SpeechProviderName } from "./cloudSpeech.js";

const TARGET_SAMPLE_RATE = 16_000;
const OUTPUT_CAPTURE_LIMIT = 128 * 1024;
const DEFAULT_PROCESS_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_AUDIO_SECONDS = 1_800;

const SUPERTONIC_LANGUAGES = [
  "ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hi", "hr", "hu", "id", "it",
  "ja", "ko", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi",
] as const;
const SUPERTONIC_LANGUAGE_SET = new Set<string>(SUPERTONIC_LANGUAGES);
const SUPERTONIC_MODEL_FILES = [
  "duration_predictor.int8.onnx",
  "text_encoder.int8.onnx",
  "vector_estimator.int8.onnx",
  "vocoder.int8.onnx",
  "tts.json",
  "unicode_indexer.bin",
  "voice.bin",
] as const;

export class SpeechServiceError extends Error {
  constructor(message: string, readonly statusCode = 503) {
    super(message);
    this.name = "SpeechServiceError";
  }
}

export interface SpeechStatus {
  stt: { available: boolean; engine: SpeechProviderName | null; providers: SpeechProviderName[] };
  tts: { available: boolean; engine: SpeechProviderName | null; providers: SpeechProviderName[]; languages: string[] };
}

export interface SynthesizedSpeech { audio: Buffer; contentType: string }


interface ProcessResult { stdout: string; stderr: string }

const require = createRequire(import.meta.url);

function envValue(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function positiveInteger(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function nonnegativeInteger(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

function positiveNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.max(parsed, min), max) : fallback;
}

async function fileExists(path: string | undefined): Promise<boolean> {
  if (!path) return false;
  try { return (await stat(path)).isFile(); }
  catch { return false; }
}

function sherpaPackageEntry(): string | null {
  try { return require.resolve("sherpa-onnx"); }
  catch { return null; }
}

function sherpaWhisperPaths() {
  return {
    encoder: envValue("SHERPA_ONNX_WHISPER_ENCODER_PATH"),
    decoder: envValue("SHERPA_ONNX_WHISPER_DECODER_PATH"),
    tokens: envValue("SHERPA_ONNX_WHISPER_TOKENS_PATH"),
  };
}

function sherpaSupertonicModelDir(): string { return envValue("SHERPA_ONNX_TTS_MODEL_DIR"); }

function supertonicModelPaths(modelDir: string): string[] {
  return SUPERTONIC_MODEL_FILES.map((file) => join(modelDir, file));
}

export async function getSpeechStatus(): Promise<SpeechStatus> {
  const packageEntry = sherpaPackageEntry();
  const whisper = sherpaWhisperPaths();
  const whisperFiles = [whisper.encoder, whisper.decoder, whisper.tokens];
  const sherpaSttAvailable = Boolean(packageEntry && whisperFiles.every(Boolean))
    && await Promise.all(whisperFiles.map(fileExists)).then((files) => files.every(Boolean));

  const modelDir = sherpaSupertonicModelDir();
  const ttsFiles = modelDir ? supertonicModelPaths(modelDir) : [];
  const sherpaTtsAvailable = Boolean(packageEntry && modelDir && ttsFiles.length)
    && await Promise.all(ttsFiles.map(fileExists)).then((files) => files.every(Boolean));
  const sttProviders = activeSpeechProviders("stt", sherpaSttAvailable);
  const ttsProviders = activeSpeechProviders("tts", sherpaTtsAvailable);

  return {
    stt: { available: sttProviders.length > 0, engine: sttProviders[0] ?? null, providers: sttProviders },
    tts: {
      available: ttsProviders.length > 0,
      engine: ttsProviders[0] ?? null,
      providers: ttsProviders,
      languages: sherpaTtsAvailable ? [...SUPERTONIC_LANGUAGES] : [],
    },
  };
}

function maxAudioBytes(): number { return positiveInteger("SPEECH_MAX_AUDIO_BYTES", DEFAULT_MAX_AUDIO_BYTES, 256 * 1024 * 1024); }
function maxAudioSeconds(): number { return positiveInteger("SPEECH_MAX_AUDIO_SECONDS", DEFAULT_MAX_AUDIO_SECONDS, 3_600); }
function processTimeoutMs(): number { return positiveInteger("SPEECH_ENGINE_TIMEOUT_MS", DEFAULT_PROCESS_TIMEOUT_MS, 600_000); }

function wavDurationSeconds(wav: Buffer): number {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE"
    || wav.toString("ascii", 12, 16) !== "fmt " || wav.toString("ascii", 36, 40) !== "data") {
    throw new SpeechServiceError("Audio must be a PCM WAV recording.", 400);
  }
  const format = wav.readUInt16LE(20);
  const channels = wav.readUInt16LE(22);
  const sampleRate = wav.readUInt32LE(24);
  const byteRate = wav.readUInt32LE(28);
  const blockAlign = wav.readUInt16LE(32);
  const bitsPerSample = wav.readUInt16LE(34);
  const dataSize = wav.readUInt32LE(40);
  if (format !== 1 || channels !== 1 || sampleRate !== TARGET_SAMPLE_RATE || bitsPerSample !== 16
    || byteRate !== TARGET_SAMPLE_RATE * 2 || blockAlign !== 2
    || dataSize <= 0 || dataSize % blockAlign !== 0 || 44 + dataSize > wav.length) {
    throw new SpeechServiceError("The recording must be mono, 16 kHz, 16-bit PCM WAV audio.", 400);
  }
  return dataSize / byteRate;
}

function runProcess(command: string, args: string[], timeoutMs = processTimeoutMs()): Promise<ProcessResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const finish = (error?: Error, result?: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) rejectPromise(error);
      else resolvePromise(result ?? { stdout, stderr });
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new SpeechServiceError("The local Sherpa-ONNX engine timed out. Reduce the recording length or choose a smaller model.", 504));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAPTURE_LIMIT) stdout += chunk.toString("utf8").slice(0, OUTPUT_CAPTURE_LIMIT - stdout.length);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAPTURE_LIMIT) stderr += chunk.toString("utf8").slice(0, OUTPUT_CAPTURE_LIMIT - stderr.length);
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") finish(new SpeechServiceError(`Could not send input to Sherpa-ONNX: ${error.message}`, 502));
    });
    child.on("error", (error) => finish(new SpeechServiceError(`Could not start the Sherpa-ONNX Node worker: ${error.message}`, 503)));
    child.on("close", (code, signal) => {
      if (code === 0) finish(undefined, { stdout, stderr });
      else finish(new SpeechServiceError(`Sherpa-ONNX worker exited unsuccessfully (code ${String(code)}, signal ${String(signal)}).`, 502));
    });
    child.stdin.end();
  });
}

function sherpaWhisperLanguage(language: string): string {
  const configured = envValue("SHERPA_ONNX_WHISPER_LANGUAGE") || envValue("VOICE_STT_LANGUAGE");
  if (configured.toLocaleLowerCase() === "auto") return "";
  const value = configured || language;
  const code = value.trim().split(/[-_]/)[0]?.toLocaleLowerCase() ?? "";
  return /^[a-z]{2,3}$/u.test(code) ? code : "";
}

const SHERPA_WHISPER_WORKER = String.raw`
const fs = require('node:fs');
const sherpa = require(process.argv[1]);
const [audioPath, encoder, decoder, tokens, language] = process.argv.slice(2);
let recognizer;
let stream;
let text = '';
let failed = false;
try {
  const wave = sherpa.readWaveFromBinaryData(new Uint8Array(fs.readFileSync(audioPath)));
  if (!wave) throw new Error('Sherpa could not read the WAV recording');
  recognizer = sherpa.createOfflineRecognizer({
    modelConfig: {
      whisper: { encoder, decoder, language, task: 'transcribe', tailPaddings: -1 },
      tokens,
      numThreads: 1,
      provider: 'cpu',
    },
  });
  stream = recognizer.createStream();
  stream.acceptWaveform(wave.sampleRate, wave.samples);
  recognizer.decode(stream);
  const result = recognizer.getResult(stream);
  text = result.text || '';
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  failed = true;
} finally {
  if (stream) stream.free();
  if (recognizer) recognizer.free();
}
if (failed) process.exitCode = 1;
else process.stdout.write('DUKAANDAAR_STT_RESULT:' + JSON.stringify({ text }));
`;

async function transcribeWithSherpaWav(wav: Buffer, language: string): Promise<string> {
  const model = sherpaWhisperPaths();
  const packageEntry = sherpaPackageEntry();
  if (!packageEntry) throw new SpeechServiceError("The sherpa-onnx Node package is not installed. Run npm install in server/.", 503);
  const directory = await mkdtemp(join(tmpdir(), "dukaandaar-stt-"));
  const audioPath = join(directory, "recording.wav");
  try {
    await writeFile(audioPath, wav, { mode: 0o600 });
    const result = await runProcess(process.execPath, [
      "-e", SHERPA_WHISPER_WORKER,
      packageEntry, audioPath, model.encoder, model.decoder, model.tokens, sherpaWhisperLanguage(language),
    ]);
    const outputMarker = "DUKAANDAAR_STT_RESULT:";
    const markerIndex = result.stdout.lastIndexOf(outputMarker);
    const outputLines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
    const payloadText = markerIndex >= 0
      ? result.stdout.slice(markerIndex + outputMarker.length).trim()
      : outputLines[outputLines.length - 1] ?? "";
    let transcript = "";
    try {
      const payload = JSON.parse(payloadText) as { text?: unknown };
      transcript = typeof payload.text === "string" ? payload.text.trim() : "";
    } catch {
      throw new SpeechServiceError("Sherpa-ONNX returned an invalid transcription result.", 502);
    }
    if (!transcript) throw new SpeechServiceError("Sherpa-ONNX did not detect speech in that recording.", 422);
    return transcript;
  } catch (error) {
    if (error instanceof SpeechServiceError) throw error;
    logWarn("speech:stt", "Sherpa-ONNX transcription failed", error instanceof Error ? error.message : String(error));
    throw new SpeechServiceError("Sherpa-ONNX transcription failed. Check the model paths and Node package installation.", 502);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function transcribeWav(wav: Buffer, language: string): Promise<string> {
  if (wav.length > maxAudioBytes()) throw new SpeechServiceError("This recording is too large for speech recognition. Shorten it or raise SPEECH_MAX_AUDIO_BYTES.", 413);
  const duration = wavDurationSeconds(wav);
  if (duration > maxAudioSeconds()) throw new SpeechServiceError(`This recording exceeds the ${maxAudioSeconds()} second speech recognition limit.`, 413);

  const status = await getSpeechStatus();
  if (!status.stt.available) throw new SpeechServiceError("No server-side speech recognition provider is configured. Add an API key or configure compatible Sherpa-ONNX Whisper model files.", 503);
  const cloudTranscript = await tryCloudTranscription(wav, language, status.stt.providers);
  if (cloudTranscript) return cloudTranscript;

  if (status.stt.providers.includes("sherpa-onnx")) return transcribeWithSherpaWav(wav, language);
  throw new SpeechServiceError(`Configured speech recognition providers failed (${status.stt.providers.join(", ")}). Check the API keys, provider settings, or network connection.`, 502);
}

const SHERPA_SUPERTONIC_WORKER = String.raw`
const path = require('node:path');
const sherpa = require(process.argv[1]);
const [outputPath, modelDir, text, language, speakerId, speed, numSteps] = process.argv.slice(2);
let tts;
let failed = false;
try {
  tts = sherpa.createOfflineTts({
    offlineTtsModelConfig: {
      offlineTtsSupertonicModelConfig: {
        durationPredictor: path.join(modelDir, 'duration_predictor.int8.onnx'),
        textEncoder: path.join(modelDir, 'text_encoder.int8.onnx'),
        vectorEstimator: path.join(modelDir, 'vector_estimator.int8.onnx'),
        vocoder: path.join(modelDir, 'vocoder.int8.onnx'),
        ttsJson: path.join(modelDir, 'tts.json'),
        unicodeIndexer: path.join(modelDir, 'unicode_indexer.bin'),
        voiceStyle: path.join(modelDir, 'voice.bin'),
      },
      numThreads: 1,
      debug: 0,
      provider: 'cpu',
    },
    maxNumSentences: 20,
  });
  const audio = tts.generateWithConfig(text, {
    sid: Number(speakerId),
    speed: Number(speed),
    numSteps: Number(numSteps),
    extra: { lang: language },
  });
  if (!audio || !audio.samples || audio.samples.length === 0) throw new Error('Sherpa returned empty TTS audio');
  tts.save(outputPath, audio);
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  failed = true;
} finally {
  if (tts) tts.free();
}
if (failed) process.exitCode = 1;
`;

function supertonicLanguage(language: string): string | null {
  const code = language.trim().split(/[-_]/)[0]?.toLocaleLowerCase() ?? "";
  return SUPERTONIC_LANGUAGE_SET.has(code) ? code : null;
}

async function synthesizeWithSherpa(text: string, language: string): Promise<SynthesizedSpeech> {
  const modelLanguage = supertonicLanguage(language);
  if (!modelLanguage) throw new SpeechServiceError(`The configured Sherpa Supertonic voice does not support ${language}.`, 422);
  const packageEntry = sherpaPackageEntry();
  if (!packageEntry) throw new SpeechServiceError("The sherpa-onnx Node package is not installed. Run npm install in server/.", 503);

  const modelDir = sherpaSupertonicModelDir();
  const directory = await mkdtemp(join(tmpdir(), "dukaandaar-tts-"));
  const outputPath = join(directory, "speech.wav");
  const speakerId = nonnegativeInteger("SHERPA_ONNX_TTS_SPEAKER_ID", 0, 9);
  const speed = positiveNumber("SHERPA_ONNX_TTS_SPEED", 1, 0.5, 2);
  const numSteps = positiveInteger("SHERPA_ONNX_TTS_NUM_STEPS", 8, 32);
  try {
    await runProcess(process.execPath, [
      "-e", SHERPA_SUPERTONIC_WORKER,
      packageEntry, outputPath, modelDir, text, modelLanguage,
      String(speakerId), String(speed), String(numSteps),
    ]);
    const audio = await readFile(outputPath);
    if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
      throw new SpeechServiceError("Sherpa-ONNX TTS did not produce a valid WAV file.", 502);
    }
    return { audio, contentType: "audio/wav" };
  } catch (error) {
    if (error instanceof SpeechServiceError) throw error;
    logWarn("speech:tts", "Sherpa-ONNX TTS failed", error instanceof Error ? error.message : String(error));
    throw new SpeechServiceError("Sherpa-ONNX speech synthesis failed. Check the Supertonic model folder and API server Node installation.", 502);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function synthesizeSpeech(text: string, language: string): Promise<SynthesizedSpeech> {
  const cleanText = text.trim();
  if (!cleanText || cleanText.length > 1_500) throw new SpeechServiceError("Speech text must contain between 1 and 1500 characters.", 400);
  const status = await getSpeechStatus();
  if (!status.tts.available) throw new SpeechServiceError("No server-side speech synthesis provider is configured. Add provider API credentials or configure the Supertonic model folder.", 503);

  const cloudAudio = await tryCloudSynthesis(cleanText, status.tts.providers);
  if (cloudAudio) return cloudAudio;
  if (status.tts.providers.includes("sherpa-onnx")) return synthesizeWithSherpa(cleanText, language);
  throw new SpeechServiceError(`Configured speech synthesis providers failed (${status.tts.providers.join(", ")}). Check API keys, voice/model settings, or network connection.`, 502);
}

export function speechUploadLimitBytes(): number { return maxAudioBytes(); }
