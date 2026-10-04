import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionAlternativeLike { transcript: string; confidence?: number }
interface SpeechRecognitionResultLike { isFinal: boolean; length: number; [index: number]: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionErrorLike { error: string; message?: string }
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const SILENCE_TIMEOUT_MS = 8_000;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useSpeechRecognition(onFinalTranscript: (transcript: string) => void, language = "en-IN") {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const languageRef = useRef(language);
  const activeLanguageRef = useRef(language);
  const onFinalRef = useRef(onFinalTranscript);
  const activeFinalRef = useRef(onFinalTranscript);
  const overrideActiveRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const flushInterimOnEndRef = useRef(false);
  const interimTextRef = useRef("");
  const processedFinalIndexesRef = useRef(new Set<number>());
  const silenceTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
    if (!overrideActiveRef.current) activeFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopAudioMeter = useCallback((updateState = true) => {
    if (audioFrameRef.current !== null) {
      window.cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    analyserRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
    if (updateState && mountedRef.current) setAudioLevel(0);
  }, []);

  const finishSession = useCallback((flushInterim: boolean, abort = false) => {
    if (!sessionActiveRef.current) return;
    sessionActiveRef.current = false;
    flushInterimOnEndRef.current = flushInterim;
    clearSilenceTimer();
    clearRestartTimer();
    if (mountedRef.current) setIsListening(false);
    stopAudioMeter();
    const recognition = recognitionRef.current;
    try {
      if (abort) recognition?.abort();
      else recognition?.stop();
    } catch (caught) {
      console.debug("[speech] recognizer was already stopped", caught);
    }
  }, [clearRestartTimer, clearSilenceTimer, stopAudioMeter]);

  const armSilenceStop = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null;
      if (!sessionActiveRef.current) return;
      console.log("[speech] 8 seconds of silence; stopping recognition");
      finishSession(true);
    }, SILENCE_TIMEOUT_MS);
  }, [clearSilenceTimer, finishSession]);

  const startAudioMeter = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) return;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!sessionActiveRef.current || !mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new window.AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      mediaStreamRef.current = stream;
      audioContextRef.current = context;
      analyserRef.current = analyser;
      if (context.state === "suspended") await context.resume();

      const samples = new Uint8Array(analyser.fftSize);
      let lastUiUpdate = 0;
      let lastSpeechTimerRefresh = 0;
      const sampleAudio = (timestamp: number) => {
        if (!sessionActiveRef.current || !mountedRef.current || analyserRef.current !== analyser) return;
        analyser.getByteTimeDomainData(samples);
        let squaredTotal = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const centered = (samples[index] - 128) / 128;
          squaredTotal += centered * centered;
        }
        const rms = Math.sqrt(squaredTotal / samples.length);
        if (rms > 0.035 && timestamp - lastSpeechTimerRefresh >= 500) {
          armSilenceStop();
          lastSpeechTimerRefresh = timestamp;
        }
        if (timestamp - lastUiUpdate >= 70) {
          setAudioLevel(Math.min(1, rms * 4.5));
          lastUiUpdate = timestamp;
        }
        audioFrameRef.current = window.requestAnimationFrame(sampleAudio);
      };
      audioFrameRef.current = window.requestAnimationFrame(sampleAudio);
    } catch (caught) {
      if (stream && stream !== mediaStreamRef.current) stream.getTracks().forEach((track) => track.stop());
      if (context && context !== audioContextRef.current && context.state !== "closed") void context.close().catch(() => undefined);
      // SpeechRecognition still works in browsers that don't expose a second mic stream;
      // the UI falls back to its animated waveform in that case.
      console.debug("[speech] live microphone meter unavailable", caught);
    }
  }, [armSilenceStop]);

  useEffect(() => {
    mountedRef.current = true;
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) {
      setSupported(false);
      return () => { mountedRef.current = false; };
    }

    setSupported(true);
    const recognition = new Constructor();
    recognition.lang = languageRef.current;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (!mountedRef.current || recognitionRef.current !== recognition) return;
      if (!sessionActiveRef.current) {
        try { recognition.stop(); } catch { /* already stopped */ }
        return;
      }
      console.log("[speech] listening started");
      processedFinalIndexesRef.current.clear();
      setIsListening(true);
      setError(null);
      if (silenceTimerRef.current === null) armSilenceStop();
      void startAudioMeter();
    };

    recognition.onresult = (event) => {
      if (!mountedRef.current || recognitionRef.current !== recognition) return;
      let heardSpeech = false;
      const interimParts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim() ?? "";
        if (!transcript) continue;
        heardSpeech = true;
        if (result.isFinal) {
          if (!processedFinalIndexesRef.current.has(index)) {
            processedFinalIndexesRef.current.add(index);
            console.log("[speech] final transcript:", transcript);
            activeFinalRef.current(transcript);
          }
        } else {
          interimParts.push(transcript);
        }
      }
      const nextInterim = interimParts.join(" ").trim();
      interimTextRef.current = nextInterim;
      setInterimTranscript(nextInterim);
      if (heardSpeech) armSilenceStop();
    };

    recognition.onerror = (event) => {
      if (!mountedRef.current || recognitionRef.current !== recognition) return;
      console.error("[speech] recognition error", event.error, event.message ?? "");
      if (event.error === "no-speech") return;
      if (event.error === "aborted" && !sessionActiveRef.current) return;
      const message = event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone access is blocked. Allow microphone access, or type your command."
        : event.error === "audio-capture"
          ? "No microphone was found. Connect a microphone or type your command."
          : event.error === "network"
            ? "Browser speech recognition lost its network connection. Reconnect or type your command."
            : `Speech recognition: ${event.error}. You can type instead.`;
      setError(message);
      finishSession(false, true);
    };

    recognition.onend = () => {
      if (!mountedRef.current || recognitionRef.current !== recognition) return;
      console.log("[speech] recognition ended");
      stopAudioMeter();
      if (sessionActiveRef.current) {
        // Some browsers end a recognition segment on their own. Keep the user's
        // recording session alive until they stop it or the silence timer expires.
        const retryStart = (attempt: number) => {
          if (!sessionActiveRef.current) return;
          restartTimerRef.current = window.setTimeout(() => {
            restartTimerRef.current = null;
            if (!sessionActiveRef.current) return;
            try {
              recognition.lang = activeLanguageRef.current;
              recognition.start();
            } catch (caught) {
              console.warn("[speech] restarting a recognition segment", caught);
              if (attempt < 3) retryStart(attempt + 1);
              else {
                setError("Speech recognition stopped unexpectedly. Please try again or type your command.");
                finishSession(false, true);
              }
            }
          }, attempt === 0 ? 160 : 300);
        };
        retryStart(0);
        return;
      }

      clearRestartTimer();
      const leftover = interimTextRef.current.trim();
      if (flushInterimOnEndRef.current && leftover) {
        console.log("[speech] using final interim transcript on stop:", leftover);
        activeFinalRef.current(leftover);
      }
      flushInterimOnEndRef.current = false;
      interimTextRef.current = "";
      setInterimTranscript("");
      setIsListening(false);
      overrideActiveRef.current = false;
      activeFinalRef.current = onFinalRef.current;
      activeLanguageRef.current = languageRef.current;
      recognition.lang = languageRef.current;
    };

    recognitionRef.current = recognition;
    return () => {
      mountedRef.current = false;
      sessionActiveRef.current = false;
      flushInterimOnEndRef.current = false;
      clearSilenceTimer();
      clearRestartTimer();
      stopAudioMeter(false);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      try { recognition.abort(); } catch { /* already stopped */ }
    };
  }, [armSilenceStop, clearRestartTimer, clearSilenceTimer, finishSession, startAudioMeter, stopAudioMeter]);

  useEffect(() => {
    languageRef.current = language;
    if (recognitionRef.current && !sessionActiveRef.current) recognitionRef.current.lang = language;
  }, [language]);

  const start = useCallback((onTranscript?: (transcript: string) => void, languageOverride?: string) => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError("Voice input is not available in this browser. Try Chrome or Edge, or type your command.");
      return;
    }
    if (sessionActiveRef.current) return;
    try {
      console.log("[speech] start requested");
      clearSilenceTimer();
      clearRestartTimer();
      stopAudioMeter();
      processedFinalIndexesRef.current.clear();
      interimTextRef.current = "";
      setInterimTranscript("");
      setAudioLevel(0);
      setError(null);
      activeLanguageRef.current = languageOverride ?? languageRef.current;
      overrideActiveRef.current = Boolean(onTranscript);
      activeFinalRef.current = onTranscript ?? onFinalRef.current;
      flushInterimOnEndRef.current = false;
      sessionActiveRef.current = true;
      recognition.lang = activeLanguageRef.current;
      recognition.start();
    } catch (caught) {
      console.error("[speech] could not start recognition", caught);
      setError("Could not start the microphone. Please try again or type your command.");
      finishSession(false, true);
      overrideActiveRef.current = false;
      activeFinalRef.current = onFinalRef.current;
    }
  }, [clearRestartTimer, clearSilenceTimer, finishSession, stopAudioMeter]);

  const stop = useCallback(() => {
    console.log("[speech] stop requested");
    finishSession(true);
  }, [finishSession]);
  const cancel = useCallback(() => finishSession(false, true), [finishSession]);

  return { isListening, isProcessing: false, supported, error, interimTranscript, audioLevel, start, stop, cancel };
}
