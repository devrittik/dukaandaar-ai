import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

export function useSpeechSynthesis(serverTtsEnabled = false) {
  const [enabled, setEnabled] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const browserSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const supported = serverTtsEnabled || browserSupported;

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  const speakInBrowser = useCallback((text: string, language: string) => {
    if (!browserSupported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  }, [browserSupported]);

  useEffect(() => { if (!enabled) cancel(); }, [enabled, cancel]);

  const speak = useCallback((text: string, language = "en-IN") => {
    if (!enabled || !text.trim()) return;
    cancel();
    if (!serverTtsEnabled) {
      speakInBrowser(text, language);
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    void api.synthesizeSpeech(text, language, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      controllerRef.current = null;
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      const cleanup = () => {
        if (audioRef.current === audio) audioRef.current = null;
        if (objectUrlRef.current === objectUrl) {
          objectUrlRef.current = null;
          URL.revokeObjectURL(objectUrl);
        }
      };
      audio.onended = cleanup;
      audio.onerror = () => {
        cleanup();
        speakInBrowser(text, language);
      };
      void audio.play().catch(() => {
        cleanup();
        speakInBrowser(text, language);
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      controllerRef.current = null;
      console.warn("[speech:server] configured TTS providers failed; using browser speech synthesis", error);
      speakInBrowser(text, language);
    });
  }, [cancel, enabled, serverTtsEnabled, speakInBrowser]);

  return { enabled, setEnabled, supported, speak, cancel };
}
