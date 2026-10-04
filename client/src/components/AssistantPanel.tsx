import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ArrowDown, ArrowUp, Check, Mic, MicOff, Sparkles, Volume2, VolumeX, CornerDownLeft, LoaderCircle, ShieldCheck, X, PackageCheck, Pencil, RotateCcw } from "lucide-react";
import { api } from "../api/client";
import type { ActionPreview, ChatMessage, ConversationLanguage, EntryKind, Health, ParseResponse, SpeechStatus } from "../types";
import { formatUiCurrency, languageOptions, speechLocale, uiText } from "../locales";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useServerSpeechRecognition } from "../hooks/useServerSpeechRecognition";
import { useSpeechSynthesis } from "../hooks/useSpeechSynthesis";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/Dialog";

const waveformBars = [0.42, 0.64, 0.88, 0.58, 0.96, 0.68, 0.46, 0.76, 0.52];

function VoiceWaveform({ active, level, compact = false }: { active: boolean; level: number; compact?: boolean }) {
  const amplitude = Math.max(0, Math.min(1, level));
  return <span className={`voice-waveform ${active ? "voice-waveform-active" : ""} ${compact ? "voice-waveform-compact" : ""}`} aria-hidden="true">
    {waveformBars.map((weight, index) => {
      const height = active ? Math.round(5 + weight * (4 + amplitude * 15)) : 4;
      return <span key={index} className="voice-waveform-bar" style={{ height: `${height}px`, animationDelay: `${index * 55}ms` }} />;
    })}
  </span>;
}

function appendTranscript(existing: string, transcript: string): string {
  const addition = transcript.trim();
  if (!addition) return existing;
  if (!existing) return addition;
  const needsSpace = !/\s$/u.test(existing) && !/^[,.;:!?،۔؟！？，]/u.test(addition);
  return `${existing}${needsSpace ? " " : ""}${addition}`;
}

function SummaryLine({ line, language }: { line: ActionPreview["lines"][number]; language: ConversationLanguage }) {
  return <div className="flex items-start justify-between gap-3 py-2.5">
    <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{line.label}</p><p className="mt-0.5 text-xs text-muted">{line.detail}</p></div>
    {typeof line.amount === "number" ? <p className="shrink-0 pt-0.5 text-sm font-semibold text-ink">{formatUiCurrency(line.amount, language)}</p> : null}
  </div>;
}

function parserDebugText(response: Pick<ParseResponse, "provider" | "fallback" | "confidence">, language: ConversationLanguage): string {
  const confidence = String(Math.round(response.confidence * 100));
  if (response.fallback) return uiText(language, "parserFallback").replace("{provider}", response.provider).replace("{confidence}", confidence);
  const template = response.provider === "rules" ? uiText(language, "parserRules") : uiText(language, "parserLlm").replace("{provider}", response.provider);
  return template.replace("{confidence}", confidence);
}

function confirmationReadback(response: ParseResponse): string {
  const preview = response.preview;
  if (!preview) return response.message;
  const language = response.language;
  const details = preview.lines.map((line) => `${line.label}: ${line.detail}${typeof line.amount === "number" ? `, ${formatUiCurrency(line.amount, language)}` : ""}`).join(". ");
  const total = typeof preview.total === "number"
    ? preview.kind === "product" ? `${uiText(language, "openingStock")}: ${preview.total}` : `${preview.kind === "loss" ? uiText(language, "lossAtCost") : uiText(language, "total")}: ${formatUiCurrency(preview.total, language)}`
    : "";
  const parts = [uiText(language, "readbackIntro"), preview.title, details, total, preview.note, preview.stockEffect, uiText(language, "readbackQuestion")].filter(Boolean);
  return parts.join(". ");
}

function isVoiceAffirmative(transcript: string): boolean {
  const normalized = transcript.normalize("NFKC").trim().toLocaleLowerCase().replace(/[.,!?;:。！？؟،]+$/gu, "").replace(/\s+/gu, " ");
  return /^(?:yes|yeah|yep|confirm|confirmed|save|approve|approved|go ahead|do it|that's right|that is right|correct|haan|han|हाँ|हां|सही|पुष्टि|ठीक है|कर दो|ह্যাঁ|হ্যা|ঠিক আছে|নিশ্চিত|সংরক্ষণ করুন|oui|confirme|confirmer|valider|c'est bon|d'accord|sí|si|confirmar|guardar|correcto|adelante|sim|salvar|correto|pode|نعم|أكد|تأكيد|احفظ|صحيح|是|确认|保存|正确|可以)$/iu.test(normalized);
}

function ConfirmationDialog({
  response, busy, onConfirm, onCancel, onEdit, onVoiceConfirm, voiceListening, voiceProcessing, voiceSupported, voiceError, voiceLevel,
}: { response: ParseResponse; busy: boolean; onConfirm: () => void; onCancel: () => void; onEdit: (kind: EntryKind, data: Record<string, unknown>) => void; onVoiceConfirm: () => void; voiceListening: boolean; voiceProcessing: boolean; voiceSupported: boolean; voiceError?: string | null; voiceLevel: number }) {
  const preview = response.preview;
  if (!preview) return null;
  const language = response.language;
  return <Dialog open={Boolean(response.pendingId)} onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="w-[min(94vw,500px)]">
      <div className="mb-5 flex items-start gap-3 pr-8">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${preview.kind === "loss" ? "bg-amber-light text-amber" : "bg-primary-light/60 text-primary"}`}>
          {preview.kind === "sale" ? <Check size={21} /> : preview.kind === "purchase" ? <PackageCheck size={21} /> : preview.kind === "expense" ? <CornerDownLeft size={21} /> : preview.kind === "loss" ? <X size={21} /> : <Sparkles size={21} />}
        </div>
        <div><DialogTitle>{preview.title}</DialogTitle><DialogDescription>{response.message}</DialogDescription><p className="mt-1 text-[10px] text-muted">{parserDebugText(response, language)}</p></div>
      </div>
      <div className="divide-y divide-line rounded-2xl border border-line bg-surface-subtle/65 px-4">
        {preview.lines.map((line, index) => <SummaryLine key={`${line.label}-${index}`} line={line} language={language} />)}
      </div>
      {preview.note ? <div className="mt-3 rounded-xl bg-surface-subtle px-3.5 py-2.5 text-xs text-ink-soft">{preview.note}</div> : null}
      {preview.stockEffect ? <div className="mt-3 flex items-start gap-2 rounded-xl bg-primary-light/40 px-3.5 py-2.5 text-xs leading-5 text-primary"><ShieldCheck size={15} className="mt-0.5 shrink-0" />{preview.stockEffect}</div> : null}
      {typeof preview.total === "number" ? <div className="mt-4 flex items-center justify-between"><span className="text-sm font-semibold text-ink-soft">{preview.kind === "product" ? uiText(language, "openingStock") : preview.kind === "loss" ? uiText(language, "lossAtCost") : uiText(language, "total")}</span><span className="font-display text-xl font-extrabold text-ink">{preview.kind === "product" ? `${preview.total}` : formatUiCurrency(preview.total, language)}</span></div> : null}
      <div className="mt-4 flex justify-end border-t border-line pt-4">
        <div className="flex flex-wrap justify-end gap-2">{preview.editData?.updateExisting !== true ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onEdit(preview.kind, preview.editData ?? {})}><Pencil size={14} />{uiText(language, "edit")}</Button> : null}<Button type="button" size="sm" variant="outline" disabled={!voiceSupported || busy || voiceProcessing} onClick={onVoiceConfirm} title={voiceSupported ? uiText(language, "voiceConfirm") : uiText(language, "voiceConfirmUnavailable")}>{voiceProcessing ? <LoaderCircle size={14} className="animate-spin" /> : voiceListening ? <VoiceWaveform active level={voiceLevel} compact /> : <Mic size={14} />}{voiceProcessing ? uiText(language, "speechProcessing") : voiceListening ? uiText(language, "voiceConfirmListening") : uiText(language, "voiceConfirm")}</Button><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>{uiText(language, "notNow")}</Button><Button type="button" loading={busy} onClick={onConfirm}><Check size={16} />{uiText(language, "confirmSave")}</Button></div>
      </div>
      {voiceError ? <p role="status" className="mt-2 text-[11px] leading-4 text-amber">{voiceError}</p> : null}
      {preview.confidence < 0.7 ? <p className="mt-2 text-[11px] text-amber">{uiText(language, "confidenceWarning")}</p> : null}
    </DialogContent>
  </Dialog>;
}

export function AssistantPanel({ health, onMutation, onEdit, sessionId, onNewConversation, messages, setMessages }: { health: Health | null; onMutation: () => void; onEdit: (kind: EntryKind, data: Record<string, unknown>) => void; sessionId: string; onNewConversation: () => void; messages: ChatMessage[]; setMessages: Dispatch<SetStateAction<ChatMessage[]>> }) {
  const [languagePreference, setLanguagePreference] = useState<ConversationLanguage>("en");
  const uiLanguage = languagePreference;
  const recognitionLanguage = speechLocale(languagePreference);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ParseResponse | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const confirmationInFlightRef = useRef(false);
  const resetInFlightRef = useRef(false);
  const [source, setSource] = useState<"text" | "voice">("text");
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus | null>(null);
  const [speechStatusLoading, setSpeechStatusLoading] = useState(true);
  const [useBrowserSpeechFallback, setUseBrowserSpeechFallback] = useState(false);
  const [speechFallbackNotice, setSpeechFallbackNotice] = useState<string | null>(null);
  const lastServerSpeechErrorRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const { enabled: ttsEnabled, setEnabled: setTtsEnabled, supported: ttsSupported, speak, cancel: cancelSpeech } = useSpeechSynthesis(Boolean(speechStatus?.tts.available));
  const appendSpeechTranscript = (transcript: string) => {
    setInput((current) => appendTranscript(current, transcript));
    setSource("voice");
    setUseBrowserSpeechFallback(false);
    setSpeechFallbackNotice(null);
    lastServerSpeechErrorRef.current = null;
    console.log("[speech] transcript appended to assistant input", transcript);
  };
  const browserSpeech = useSpeechRecognition(appendSpeechTranscript, recognitionLanguage);
  const serverSpeech = useServerSpeechRecognition(appendSpeechTranscript, recognitionLanguage, Boolean(speechStatus?.stt.available), api.transcribeAudio);
  const speech = speechStatus?.stt.available && !useBrowserSpeechFallback ? serverSpeech : browserSpeech;

  useEffect(() => {
    const error = serverSpeech.error;
    if (!error) {
      lastServerSpeechErrorRef.current = null;
      return;
    }
    if (error === lastServerSpeechErrorRef.current) return;
    lastServerSpeechErrorRef.current = error;
    if (!speechStatus?.stt.available) return;
    if (browserSpeech.supported) {
      setUseBrowserSpeechFallback(true);
      setSpeechFallbackNotice(uiText(uiLanguage, "serverSpeechFallback"));
    } else {
      setSpeechFallbackNotice(uiText(uiLanguage, "browserSpeechUnavailable"));
    }
  }, [browserSpeech.supported, serverSpeech.error, speechStatus?.stt.available, uiLanguage]);

  useEffect(() => {
    let active = true;
    void api.speechStatus().then((status) => {
      if (active) setSpeechStatus(status);
    }).catch((error) => {
      console.warn("[speech] server speech status unavailable; using browser speech features", error);
      if (active) setSpeechStatus(null);
    }).finally(() => {
      if (active) setSpeechStatusLoading(false);
    });
    return () => { active = false; };
  }, []);

  const updateScrollPosition = () => {
    const container = chatScrollRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const atBottom = distanceFromBottom < 80;
    followLatestRef.current = atBottom;
    setShowScrollToLatest(!atBottom && container.scrollHeight > container.clientHeight);
  };

  const scrollToLatest = () => {
    const container = chatScrollRef.current;
    if (!container) return;
    followLatestRef.current = true;
    setShowScrollToLatest(false);
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  };

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    if (followLatestRef.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      setShowScrollToLatest(false);
    } else {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      setShowScrollToLatest(distanceFromBottom >= 80);
    }
  }, [messages, busy]);

  const addMessage = (role: ChatMessage["role"], text: string, meta?: string) => {
    setMessages((current) => [...current, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, role, text, meta }]);
  };

  const send = async (value = input) => {
    if (speech.isListening) { speech.stop(); return; }
    if (speech.isProcessing) return;
    const transcript = value.trim();
    if (!transcript || busy || resetBusy || resetInFlightRef.current) return;
    const inputSource = source;
    followLatestRef.current = true;
    setShowScrollToLatest(false);
    addMessage("user", transcript, inputSource === "voice" ? uiText(uiLanguage, "voiceInput") : undefined);
    setInput(""); setBusy(true);
    console.log(`[assistant] sending command source=${inputSource}`, transcript);
    try {
      const result = await api.parse(sessionId, transcript, inputSource, languagePreference);
      const spokenReply = result.mode === "confirmation" ? confirmationReadback(result) : result.message;
      addMessage("assistant", spokenReply, parserDebugText(result, uiLanguage));
      if (result.mode === "confirmation") {
        console.log(`[confirm] showing dialog for intent=${result.preview?.kind} confidence=${result.preview?.confidence}`);
        setPending(result);
        speak(spokenReply, speechLocale(result.language));
      } else {
        speak(result.message, speechLocale(result.language));
      }
    } catch (error) {
      addMessage("assistant", error instanceof Error ? error.message : "I couldn't process that. Please try again.", uiText(uiLanguage, "couldNotComplete"));
    } finally {
      setBusy(false); setSource("text");
    }
  };

  const confirm = async () => {
    if (!pending?.pendingId || confirmationInFlightRef.current || resetInFlightRef.current) return;
    confirmationInFlightRef.current = true;
    speech.cancel();
    setConfirmBusy(true);
    console.log(`[confirm] committing pending id=${pending.pendingId}`);
    try {
      const result = await api.confirm(pending.pendingId);
      setPending(null);
      addMessage("assistant", result.message, uiText(pending.language, "saved"));
      speak(result.message, speechLocale(pending.language));
      onMutation();
    } catch (error) {
      addMessage("assistant", error instanceof Error ? error.message : "This couldn't be saved. Please try again.", uiText(pending.language, "saveFailed"));
      setPending(null);
    } finally {
      confirmationInFlightRef.current = false;
      setConfirmBusy(false);
    }
  };

  const cancel = async () => {
    if (confirmBusy || resetBusy) return;
    speech.cancel();
    if (pending?.pendingId) {
      console.log(`[confirm] canceling pending id=${pending.pendingId}`);
      void api.cancel(pending.pendingId).catch((error) => console.error("[confirm] could not cancel pending action", error));
    }
    setPending(null);
  };

  const editPending = (kind: EntryKind, data: Record<string, unknown>) => {
    if (confirmBusy || resetBusy) return;
    speech.cancel();
    if (pending?.pendingId) {
      console.log(`[confirm] editing pending id=${pending.pendingId} as manual kind=${kind}`);
      void api.cancel(pending.pendingId).catch((error) => console.error("[confirm] could not cancel pending action", error));
    }
    setPending(null);
    onEdit(kind, data);
  };

  const clearShortTermMemory = async () => {
    if (busy || confirmBusy || resetInFlightRef.current) return;
    resetInFlightRef.current = true;
    setResetBusy(true);
    speech.cancel();
    cancelSpeech();

    if (pending?.pendingId) {
      try { await api.cancel(pending.pendingId); }
      catch (error) { console.error("[assistant] could not cancel pending action while resetting context", error); }
    }
    try { await api.resetConversation(sessionId); }
    catch (error) { console.error("[assistant] server context reset failed; starting a fresh session", error); }

    onNewConversation();
    setPending(null);
    setInput("");
    setSource("text");
    followLatestRef.current = true;
    setShowScrollToLatest(false);
    setMessages([{ id: "welcome", role: "assistant", text: uiText(uiLanguage, "welcome"), meta: uiText(uiLanguage, "yourAssistant") }]);
    resetInFlightRef.current = false;
    setResetBusy(false);
    console.log("[assistant] short-term conversation memory reset");
  };

  const listenForConfirmation = () => {
    if (!pending) return;
    const language = pending.language;
    speech.start((transcript) => {
      setUseBrowserSpeechFallback(false);
      setSpeechFallbackNotice(null);
      addMessage("user", transcript, uiText(language, "voiceInput"));
      if (isVoiceAffirmative(transcript)) {
        console.log("[confirm] voice confirmation accepted");
        void confirm();
        return;
      }
      const hint = uiText(language, "voiceConfirmHint");
      addMessage("assistant", hint);
      speak(hint, speechLocale(language));
    }, speechLocale(language));
  };

  const submitForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };
  const statusText = health?.ok ? uiText(uiLanguage, "ready") : uiText(uiLanguage, "connecting");
  const suggestions = [uiText(uiLanguage, "saleSuggestion"), uiText(uiLanguage, "restockSuggestion"), uiText(uiLanguage, "expenseSuggestion")];

  return <>
    <Card className="assistant-card flex h-full min-h-0 flex-col overflow-hidden !p-0">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="relative grid h-10 w-10 place-items-center rounded-2xl bg-primary text-white shadow-sm"><Sparkles size={19} /><span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-primary-light" /></div>
          <div><h2 className="font-display text-[15px] font-bold text-ink">{uiText(uiLanguage, "panelTitle")}</h2><div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{statusText}<span className="text-line">·</span>{uiText(uiLanguage, "shopData")}</div></div>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="assistant-language">{uiText(uiLanguage, "languageLabel")}</label>
          <select id="assistant-language" value={languagePreference} onChange={(event) => setLanguagePreference(event.target.value as ConversationLanguage)} className="max-w-[112px] rounded-lg border border-line bg-white px-2 py-1.5 text-[10px] font-medium text-ink-soft outline-none focus:border-primary/40" aria-label={uiText(uiLanguage, "languageLabel")}>
            {languageOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
          <button type="button" onClick={() => void clearShortTermMemory()} disabled={busy || confirmBusy || resetBusy} className="grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-surface-subtle hover:text-primary disabled:opacity-45" aria-label={uiText(uiLanguage, "clearMemory")} title={uiText(uiLanguage, "clearMemory")}>{resetBusy ? <LoaderCircle size={16} className="animate-spin" /> : <RotateCcw size={16} />}</button>
          <button type="button" onClick={() => { if (!ttsSupported) return; setTtsEnabled(!ttsEnabled); }} className={`grid h-9 w-9 place-items-center rounded-xl transition ${ttsEnabled ? "bg-primary-light text-primary" : "text-muted hover:bg-surface-subtle"}`} aria-label={ttsEnabled ? uiText(uiLanguage, "ttsOff") : uiText(uiLanguage, "ttsOn")} title={ttsSupported ? uiText(uiLanguage, "ttsToggle") : uiText(uiLanguage, "ttsUnsupported")}>{ttsEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div ref={chatScrollRef} onScroll={updateScrollPosition} className="chat-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {messages.map((message) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[90%] ${message.role === "user" ? "rounded-2xl rounded-br-md bg-primary px-4 py-3 text-white" : "rounded-2xl rounded-bl-md border border-line bg-surface-subtle px-4 py-3 text-ink"}`}>
              <p className="whitespace-pre-wrap text-[13px] leading-5">{message.text}</p>
              {message.meta ? <p className={`mt-1.5 text-[10px] ${message.role === "user" ? "text-white/65" : "text-muted"}`}>{message.meta}</p> : null}
            </div>
          </div>)}
          {busy ? <div className="flex justify-start"><div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-line bg-surface-subtle px-4 py-3 text-xs text-muted"><LoaderCircle size={14} className="animate-spin text-primary" />{uiText(uiLanguage, "thinking")}</div></div> : null}
        </div>
        {showScrollToLatest ? <button type="button" onClick={scrollToLatest} className="absolute bottom-3 left-1/2 z-10 grid h-10 w-10 -translate-x-1/2 place-items-center rounded-full border border-line bg-white text-ink shadow-float transition hover:bg-primary hover:text-white" aria-label="Scroll to latest message" title="Scroll to latest message"><ArrowDown size={18} /></button> : null}
      </div>

      {messages.length <= 1 ? <div className="px-4 pb-3 sm:px-5"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-muted">{uiText(uiLanguage, "trySaying")}</p><div className="flex flex-wrap gap-1.5">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => { setSource("text"); void send(suggestion); }} className="rounded-full border border-line bg-white px-2.5 py-1.5 text-[10px] font-medium text-ink-soft transition hover:border-primary/25 hover:bg-surface-green hover:text-primary">{suggestion}</button>)}</div></div> : null}

      <form onSubmit={submitForm} className="border-t border-line p-3 sm:p-4">
        {speechFallbackNotice ? <p role="status" className="mb-2 px-1 text-[11px] leading-4 text-amber">{speechFallbackNotice}</p> : null}
        {speech.error ? <p role="status" className="mb-2 px-1 text-[11px] leading-4 text-amber">{speech.error}</p> : null}
        {speech.isListening ? <div className="voice-listening-status" role="status" aria-live="polite">
          <span className="voice-listening-dot" />
          <div className="min-w-0 flex-1">
            <p className="voice-listening-label">{uiText(uiLanguage, "voiceListeningStatus")}</p>
            {speech.interimTranscript ? <p className="voice-interim-preview">{speech.interimTranscript}</p> : null}
          </div>
          <VoiceWaveform active level={speech.audioLevel} />
        </div> : null}
        {speech.isProcessing ? <div className="voice-listening-status" role="status" aria-live="polite"><LoaderCircle size={15} className="animate-spin text-primary" /><p className="voice-listening-label flex-1">{uiText(uiLanguage, "speechProcessing")}</p></div> : null}
        <div className="flex items-end gap-2 rounded-[17px] border border-line bg-surface-subtle/80 p-1.5 pl-3 transition focus-within:border-primary/35 focus-within:bg-white focus-within:ring-4 focus-within:ring-primary/5">
          <textarea
            rows={1}
            disabled={resetBusy}
            value={input}
            onChange={(event) => { setInput(event.target.value); setSource("text"); setUseBrowserSpeechFallback(false); setSpeechFallbackNotice(null); }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (speech.isListening) speech.stop(); else void send(); } }}
            placeholder={uiText(uiLanguage, "inputPlaceholder")}
            className="max-h-24 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-ink outline-none placeholder:text-muted/80"
            aria-label={uiText(uiLanguage, "inputPlaceholder")}
          />
          <button type="button" disabled={resetBusy || speechStatusLoading || speech.isProcessing} onClick={() => speech.isListening ? speech.stop() : speech.start()} className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition ${speech.isListening ? "bg-danger-light text-danger ring-4 ring-danger/10" : "text-muted hover:bg-white hover:text-primary"}`} aria-pressed={speech.isListening} aria-label={speech.isListening ? uiText(uiLanguage, "stopVoice") : speech.isProcessing ? uiText(uiLanguage, "speechProcessing") : uiText(uiLanguage, "startVoice")} title={speechStatusLoading ? uiText(uiLanguage, "connecting") : speech.isListening ? uiText(uiLanguage, "stopVoice") : speech.supported ? uiText(uiLanguage, "speakCommand") : uiText(uiLanguage, "voiceUnsupported")}>{speech.isProcessing ? <LoaderCircle size={16} className="animate-spin" /> : speech.isListening ? <MicOff size={17} /> : <Mic size={17} />}</button>
          <button type="submit" disabled={!input.trim() || busy || resetBusy || speech.isListening || speech.isProcessing} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-white transition hover:bg-primary-dark disabled:opacity-40" aria-label={uiText(uiLanguage, "sendCommand")}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowUp size={17} />}</button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-muted"><span className="flex items-center gap-1"><ShieldCheck size={11} />{uiText(uiLanguage, "confirmRequired")}</span><span>{uiText(uiLanguage, "enter")}</span></div>
      </form>
    </Card>

    {pending ? <ConfirmationDialog response={pending} busy={confirmBusy || resetBusy} onConfirm={() => void confirm()} onCancel={() => void cancel()} onEdit={editPending} voiceListening={speech.isListening} voiceProcessing={speech.isProcessing} voiceSupported={!speechStatusLoading && speech.supported} voiceError={speech.error} voiceLevel={speech.audioLevel} onVoiceConfirm={() => speech.isListening ? speech.stop() : listenForConfirmation()} /> : null}
  </>;
}
