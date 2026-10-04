import { useCallback, useEffect, useRef, useState } from "react";

const TARGET_SAMPLE_RATE = 16_000;
const SILENCE_TIMEOUT_MS = 8_000;
const PROCESSOR_BUFFER_SIZE = 4_096;

export type AudioTranscriber = (audio: Blob, language: string, signal?: AbortSignal) => Promise<string>;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

export function encodePcm16Wav(chunks: Int16Array[], sampleCount: number): Blob {
  const dataBytes = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      view.setInt16(offset, chunk[index], true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function useServerSpeechRecognition(
  onFinalTranscript: (transcript: string) => void,
  language: string,
  enabled: boolean,
  transcribe: AudioTranscriber,
) {
  const onFinalRef = useRef(onFinalTranscript);
  const languageRef = useRef(language);
  const activeLanguageRef = useRef(language);
  const activeFinalRef = useRef(onFinalTranscript);
  const sessionActiveRef = useRef(false);
  const processingRef = useRef(false);
  const transcriptionControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);
  const sampleCountRef = useRef(0);
  const absoluteInputSamplesRef = useRef(0);
  const nextOutputSampleAtRef = useRef(0);
  const silenceTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const stopRef = useRef<(transcribeAudio?: boolean) => void>(() => undefined);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => { onFinalRef.current = onFinalTranscript; }, [onFinalTranscript]);
  useEffect(() => {
    languageRef.current = language;
    if (!sessionActiveRef.current) activeLanguageRef.current = language;
  }, [language]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const armSilenceStop = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null;
      if (sessionActiveRef.current) {
        console.log("[speech:server] eight seconds of silence; sending recording for transcription");
        stopRef.current(true);
      }
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer]);

  const releaseRecorder = useCallback(() => {
    const processor = processorRef.current;
    if (processor) {
      processor.onaudioprocess = null;
      try { processor.disconnect(); } catch { /* already disconnected */ }
      processorRef.current = null;
    }
    try { sourceRef.current?.disconnect(); } catch { /* already disconnected */ }
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }, []);

  const stop = useCallback((shouldTranscribe = true) => {
    if (!sessionActiveRef.current) return;
    sessionActiveRef.current = false;
    clearSilenceTimer();
    releaseRecorder();
    if (mountedRef.current) {
      setIsListening(false);
      setAudioLevel(0);
    }
    const chunks = chunksRef.current;
    const sampleCount = sampleCountRef.current;
    const activeCallback = activeFinalRef.current;
    const activeLanguage = activeLanguageRef.current;
    chunksRef.current = [];
    sampleCountRef.current = 0;
    absoluteInputSamplesRef.current = 0;
    nextOutputSampleAtRef.current = 0;

    if (!shouldTranscribe) {
      activeFinalRef.current = onFinalRef.current;
      activeLanguageRef.current = languageRef.current;
      return;
    }
    if (sampleCount < TARGET_SAMPLE_RATE / 4) {
      if (mountedRef.current) setError("I didn't capture enough audio. Try again or type your command.");
      activeFinalRef.current = onFinalRef.current;
      activeLanguageRef.current = languageRef.current;
      return;
    }

    const wav = encodePcm16Wav(chunks, sampleCount);
    const controller = new AbortController();
    transcriptionControllerRef.current = controller;
    processingRef.current = true;
    if (mountedRef.current) setIsProcessing(true);
    console.log("[speech:server] sending WAV recording to the configured API speech-provider chain", { seconds: Math.round(sampleCount / TARGET_SAMPLE_RATE) });
    void transcribe(wav, activeLanguage, controller.signal).then((transcript) => {
      if (!mountedRef.current || controller.signal.aborted) return;
      const clean = transcript.trim();
      if (!clean) {
        setError("The speech providers did not detect any speech. Try again or type your command.");
        return;
      }
      setError(null);
      console.log("[speech:server] transcription complete", { characters: clean.length });
      activeCallback(clean);
    }).catch((caught: unknown) => {
      if (!mountedRef.current || controller.signal.aborted) return;
      const message = caught instanceof Error ? caught.message : "Speech transcription failed. Please try again or type your command.";
      console.error("[speech:server] transcription request failed", message);
      setError(message);
    }).finally(() => {
      if (transcriptionControllerRef.current !== controller) return;
      transcriptionControllerRef.current = null;
      processingRef.current = false;
      if (mountedRef.current) setIsProcessing(false);
      activeFinalRef.current = onFinalRef.current;
      activeLanguageRef.current = languageRef.current;
    });
  }, [clearSilenceTimer, languageRef, onFinalRef, releaseRecorder, transcribe]);

  useEffect(() => { stopRef.current = stop; }, [stop]);

  const start = useCallback((onTranscript?: (transcript: string) => void, languageOverride?: string) => {
    if (!enabled) {
      setError("Server speech providers are not configured. Type your command or use browser speech recognition.");
      return;
    }
    if (sessionActiveRef.current || processingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.AudioContext === "undefined") {
      setError("This browser cannot record audio for server speech recognition. Try a current Chrome or Edge browser, or type your command.");
      return;
    }

    sessionActiveRef.current = true;
    chunksRef.current = [];
    sampleCountRef.current = 0;
    absoluteInputSamplesRef.current = 0;
    nextOutputSampleAtRef.current = 0;
    activeLanguageRef.current = languageOverride ?? languageRef.current;
    activeFinalRef.current = onTranscript ?? onFinalRef.current;
    setError(null);
    setAudioLevel(0);
    setIsListening(true);

    void navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }).then(async (stream) => {
      if (!sessionActiveRef.current || !mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const context = new window.AudioContext();
      contextRef.current = context;
      if (context.state === "suspended") await context.resume();
      if (!sessionActiveRef.current || !mountedRef.current) {
        releaseRecorder();
        return;
      }

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
      sourceRef.current = source;
      processorRef.current = processor;
      const sourceRate = context.sampleRate;
      const step = sourceRate / TARGET_SAMPLE_RATE;
      let lastUiUpdate = 0;
      let lastSpeechDetected = 0;

      processor.onaudioprocess = (event) => {
        if (!sessionActiveRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        let squaredTotal = 0;
        for (let index = 0; index < input.length; index += 1) squaredTotal += input[index] * input[index];
        const rms = Math.sqrt(squaredTotal / Math.max(input.length, 1));
        const now = performance.now();
        if (rms > 0.035 && now - lastSpeechDetected > 350) {
          armSilenceStop();
          lastSpeechDetected = now;
        }
        if (now - lastUiUpdate > 70) {
          setAudioLevel(Math.min(1, rms * 4.5));
          lastUiUpdate = now;
        }

        const blockStart = absoluteInputSamplesRef.current;
        const blockEnd = blockStart + input.length;
        const output = new Int16Array(Math.ceil(input.length / step) + 2);
        let outputLength = 0;
        while (nextOutputSampleAtRef.current < blockEnd) {
          const localIndex = Math.min(input.length - 1, Math.max(0, Math.floor(nextOutputSampleAtRef.current - blockStart)));
          const sample = Math.max(-1, Math.min(1, input[localIndex] ?? 0));
          output[outputLength] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
          outputLength += 1;
          nextOutputSampleAtRef.current += step;
        }
        absoluteInputSamplesRef.current = blockEnd;
        if (outputLength > 0) {
          const chunk = output.subarray(0, outputLength);
          chunksRef.current.push(chunk);
          sampleCountRef.current += chunk.length;
        }
        for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel += 1) event.outputBuffer.getChannelData(channel).fill(0);
      };

      source.connect(processor);
      processor.connect(context.destination);
      armSilenceStop();
      console.log("[speech:server] microphone recording started", { sampleRate: TARGET_SAMPLE_RATE, language: activeLanguageRef.current });
    }).catch((caught: unknown) => {
      if (!sessionActiveRef.current) return;
      sessionActiveRef.current = false;
      clearSilenceTimer();
      releaseRecorder();
      setIsListening(false);
      setAudioLevel(0);
      activeFinalRef.current = onFinalRef.current;
      activeLanguageRef.current = languageRef.current;
      const errorName = typeof caught === "object" && caught !== null && "name" in caught ? String(caught.name) : "";
      setError(errorName === "NotAllowedError" || errorName === "SecurityError"
        ? "Microphone access is blocked. Allow microphone access, or type your command."
        : errorName === "NotFoundError"
          ? "No microphone was found. Connect a microphone or type your command."
          : "Could not start the microphone recorder. Check microphone permissions and try again.");
      console.error("[speech:server] microphone setup failed", caught);
    });
  }, [armSilenceStop, clearSilenceTimer, enabled, languageRef, onFinalRef, releaseRecorder]);

  const cancel = useCallback(() => {
    if (sessionActiveRef.current) {
      sessionActiveRef.current = false;
      clearSilenceTimer();
      releaseRecorder();
    }
    const controller = transcriptionControllerRef.current;
    if (controller) {
      transcriptionControllerRef.current = null;
      processingRef.current = false;
      controller.abort();
    }
    chunksRef.current = [];
    sampleCountRef.current = 0;
    absoluteInputSamplesRef.current = 0;
    nextOutputSampleAtRef.current = 0;
    activeFinalRef.current = onFinalRef.current;
    activeLanguageRef.current = languageRef.current;
    if (mountedRef.current) {
      setIsListening(false);
      setIsProcessing(false);
      setAudioLevel(0);
    }
  }, [clearSilenceTimer, languageRef, onFinalRef, releaseRecorder]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionActiveRef.current = false;
      clearSilenceTimer();
      releaseRecorder();
      transcriptionControllerRef.current?.abort();
      transcriptionControllerRef.current = null;
      processingRef.current = false;
      chunksRef.current = [];
    };
  }, [clearSilenceTimer, releaseRecorder]);

  const supported = enabled
    && typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof window !== "undefined"
    && typeof window.AudioContext !== "undefined";

  return { isListening, isProcessing, supported, error, interimTranscript: "", audioLevel, start, stop: () => stop(true), cancel };
}
