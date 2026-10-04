import { logWarn } from "../utils/logger.js";

export type SpeechProviderName = "elevenlabs" | "deepgram" | "sherpa-onnx";
export type SpeechCapability = "stt" | "tts";
export type SpeechMode = "hosted" | "local";

export interface ProviderAudio { audio: Buffer; contentType: string }

const DEFAULT_HOSTED_PROVIDER_ORDER = ["elevenlabs", "deepgram"] as const;
const HOSTED_PROVIDER_NAMES = new Set<string>(DEFAULT_HOSTED_PROVIDER_ORDER);
const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;

export function speechMode(): SpeechMode {
  return envValue("VOICE_MODE", "local").toLocaleLowerCase() === "hosted" ? "hosted" : "local";
}

function envValue(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function providerTimeoutMs(): number {
  const value = Number(process.env.SPEECH_PROVIDER_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 600_000) : DEFAULT_PROVIDER_TIMEOUT_MS;
}

function baseUrl(name: string, fallback: string): string {
  return envValue(name, fallback).replace(/\/+$/u, "");
}

function baseLanguageCode(language: string): string {
  return language.trim().split(/[-_]/u)[0]?.toLocaleLowerCase() ?? "";
}

function providerLanguage(language: string): string | null {
  const configured = envValue("VOICE_STT_LANGUAGE");
  const value = configured || language;
  if (value.toLocaleLowerCase() === "auto") return null;
  return value.trim();
}

function isConfigured(provider: SpeechProviderName, capability: SpeechCapability): boolean {
  if (provider === "sherpa-onnx") return true;
  if (provider === "deepgram") return Boolean(envValue("DEEPGRAM_API_KEY"));
  if (!envValue("ELEVENLABS_API_KEY")) return false;
  return capability === "stt" || Boolean(envValue("ELEVENLABS_TTS_VOICE_ID"));
}

export function activeSpeechProviders(capability: SpeechCapability, sherpaAvailable: boolean): SpeechProviderName[] {
  if (speechMode() === "local") return sherpaAvailable ? ["sherpa-onnx"] : [];

  const orderVariable = capability === "stt" ? "VOICE_STT_PROVIDER_ORDER" : "VOICE_TTS_PROVIDER_ORDER";
  const rawOrder = envValue(orderVariable) || DEFAULT_HOSTED_PROVIDER_ORDER.join(",");
  const seen = new Set<string>();
  const requestedOrder: SpeechProviderName[] = [];
  for (const rawProvider of rawOrder.split(",")) {
    const provider = rawProvider.trim().toLocaleLowerCase();
    if (!HOSTED_PROVIDER_NAMES.has(provider) || seen.has(provider)) continue;
    seen.add(provider);
    requestedOrder.push(provider as SpeechProviderName);
  }
  return requestedOrder.filter((provider) => isConfigured(provider, capability));
}

async function withProviderTimeout<T>(provider: string, capability: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = providerTimeoutMs();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await action(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${provider} ${capability} request timed out after ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureResponseOk(response: Response, provider: string, capability: string): Promise<void> {
  if (response.ok) return;
  await response.body?.cancel().catch(() => undefined);
  throw new Error(`${provider} ${capability} API returned HTTP ${response.status}.`);
}

async function jsonResponse(response: Response, provider: string, capability: string): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("Expected an object response.");
    return data as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${provider} ${capability} API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function transcribeWithElevenLabs(wav: Buffer, language: string): Promise<string> {
  const apiKey = envValue("ELEVENLABS_API_KEY");
  const modelId = envValue("ELEVENLABS_STT_MODEL_ID", "scribe_v2");
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "recording.wav");
  form.set("model_id", modelId);
  const languageCode = providerLanguage(language);
  if (languageCode) form.set("language_code", baseLanguageCode(languageCode));

  return withProviderTimeout("ElevenLabs", "STT", async (signal) => {
    const response = await fetch(`${baseUrl("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1")}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal,
    });
    await ensureResponseOk(response, "ElevenLabs", "STT");
    const payload = await jsonResponse(response, "ElevenLabs", "STT");
    const transcript = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!transcript) throw new Error("ElevenLabs STT returned an empty transcript.");
    return transcript;
  });
}

export async function transcribeWithDeepgram(wav: Buffer, language: string): Promise<string> {
  const apiKey = envValue("DEEPGRAM_API_KEY");
  const url = new URL(`${baseUrl("DEEPGRAM_BASE_URL", "https://api.deepgram.com/v1")}/listen`);
  url.searchParams.set("model", envValue("DEEPGRAM_STT_MODEL", "nova-3"));
  url.searchParams.set("smart_format", "true");
  const languageTag = providerLanguage(language);
  if (languageTag) url.searchParams.set("language", languageTag);

  return withProviderTimeout("Deepgram", "STT", async (signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" },
      body: new Uint8Array(wav),
      signal,
    });
    await ensureResponseOk(response, "Deepgram", "STT");
    const payload = await jsonResponse(response, "Deepgram", "STT");
    const results = payload.results as { channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }> } | undefined;
    const transcript = results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (typeof transcript !== "string" || !transcript.trim()) throw new Error("Deepgram STT returned an empty transcript.");
    return transcript.trim();
  });
}

function audioContentType(response: Response, fallback: string): string {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase();
  return contentType?.startsWith("audio/") ? contentType : fallback;
}

export async function synthesizeWithElevenLabs(text: string): Promise<ProviderAudio> {
  const apiKey = envValue("ELEVENLABS_API_KEY");
  const voiceId = envValue("ELEVENLABS_TTS_VOICE_ID");
  const modelId = envValue("ELEVENLABS_TTS_MODEL_ID", "eleven_multilingual_v2");
  const outputFormat = envValue("ELEVENLABS_TTS_OUTPUT_FORMAT", "wav_16000");
  const url = new URL(`${baseUrl("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io/v1")}/text-to-speech/${encodeURIComponent(voiceId)}`);
  url.searchParams.set("output_format", outputFormat);

  return withProviderTimeout("ElevenLabs", "TTS", async (signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/*" },
      body: JSON.stringify({ text, model_id: modelId }),
      signal,
    });
    await ensureResponseOk(response, "ElevenLabs", "TTS");
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) throw new Error("ElevenLabs TTS returned empty audio.");
    const fallbackType = outputFormat.startsWith("wav_") ? "audio/wav" : "audio/mpeg";
    return { audio, contentType: audioContentType(response, fallbackType) };
  });
}

export async function synthesizeWithDeepgram(text: string): Promise<ProviderAudio> {
  const apiKey = envValue("DEEPGRAM_API_KEY");
  const url = new URL(`${baseUrl("DEEPGRAM_BASE_URL", "https://api.deepgram.com/v1")}/speak`);
  url.searchParams.set("model", envValue("DEEPGRAM_TTS_MODEL", "aura-2-thalia-en"));
  url.searchParams.set("encoding", envValue("DEEPGRAM_TTS_ENCODING", "linear16"));
  url.searchParams.set("container", envValue("DEEPGRAM_TTS_CONTAINER", "wav"));
  url.searchParams.set("sample_rate", envValue("DEEPGRAM_TTS_SAMPLE_RATE", "24000"));

  return withProviderTimeout("Deepgram", "TTS", async (signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json", Accept: "audio/wav" },
      body: JSON.stringify({ text }),
      signal,
    });
    await ensureResponseOk(response, "Deepgram", "TTS");
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) throw new Error("Deepgram TTS returned empty audio.");
    return { audio, contentType: audioContentType(response, "audio/wav") };
  });
}

export async function tryCloudTranscription(wav: Buffer, language: string, providers: SpeechProviderName[]): Promise<string | null> {
  for (const provider of providers) {
    if (provider === "sherpa-onnx") continue;
    try {
      const transcript = provider === "elevenlabs"
        ? await transcribeWithElevenLabs(wav, language)
        : await transcribeWithDeepgram(wav, language);
      return transcript;
    } catch (error) {
      logWarn("speech:stt", `${provider} transcription failed; trying the next configured provider`, error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}

export async function tryCloudSynthesis(text: string, providers: SpeechProviderName[]): Promise<ProviderAudio | null> {
  for (const provider of providers) {
    if (provider === "sherpa-onnx") continue;
    try {
      return provider === "elevenlabs" ? await synthesizeWithElevenLabs(text) : await synthesizeWithDeepgram(text);
    } catch (error) {
      logWarn("speech:tts", `${provider} synthesis failed; trying the next configured provider`, error instanceof Error ? error.message : String(error));
    }
  }
  return null;
}
