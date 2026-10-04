import type { ActionPreview, ConversationLanguage, DashboardData, Health, ParseResponse, Product, ProductUpdate, ShopSettings, ShopSettingsUpdate, Source, SpeechStatus, TransactionsResponse } from "../types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const startedAt = performance.now();
  const method = (init?.method ?? "GET").toUpperCase();
  const url = `${API_BASE}${path}`;
  console.log(`[api] ${method} ${url}`);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const data = await response.json().catch(() => ({}));
    console.log(`[api] response ${response.status} in ${Math.round(performance.now() - startedAt)}ms`);
    if (!response.ok) throw new Error(data?.error ?? `Request failed with ${response.status}`);
    return data as T;
  } catch (error) {
    console.error(`[api] ${method} ${path} failed`, error);
    throw error;
  }
}

async function requestAudio(path: string, init: RequestInit): Promise<Blob> {
  const startedAt = performance.now();
  console.log(`[api] POST ${API_BASE}${path}`);
  const response = await fetch(`${API_BASE}${path}`, init);
  console.log(`[api] audio response ${response.status} in ${Math.round(performance.now() - startedAt)}ms`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error ?? `Speech request failed with ${response.status}`);
  }
  return response.blob();
}

async function transcribeAudio(audio: Blob, language: string, signal?: AbortSignal): Promise<string> {
  const query = new URLSearchParams({ language });
  const response = await fetch(`${API_BASE}/api/speech/transcribe?${query}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: audio,
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error ?? `Speech recognition failed with ${response.status}`);
  return typeof data?.transcript === "string" ? data.transcript : "";
}

export const api = {
  dashboard: () => request<DashboardData>("/api/dashboard"),
  health: () => request<Health>("/api/health"),
  speechStatus: () => request<SpeechStatus>("/api/speech/status"),
  transcribeAudio,
  synthesizeSpeech: (text: string, language: string, signal?: AbortSignal) => requestAudio("/api/speech/synthesize", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language }), signal,
  }),
  settings: () => request<ShopSettings>("/api/settings"),
  updateSettings: (changes: ShopSettingsUpdate) => request<ShopSettings>("/api/settings", { method: "PUT", body: JSON.stringify(changes) }),
  updateProduct: (productId: string, changes: ProductUpdate) => request<Product>(`/api/products/${encodeURIComponent(productId)}`, { method: "PUT", body: JSON.stringify(changes) }),
  transactions: () => request<TransactionsResponse>("/api/transactions"),
  parse: (sessionId: string, transcript: string, source: Source, language?: ConversationLanguage) => request<ParseResponse>("/api/parse", {
    method: "POST", body: JSON.stringify({ sessionId, transcript, source, ...(language ? { language } : {}) }),
  }),
  resetConversation: (sessionId: string) => request<{ ok: true }>("/api/conversation/reset", {
    method: "POST", body: JSON.stringify({ sessionId }),
  }),
  confirm: (pendingId: string) => request<{ message: string; dashboardChanged: true }>("/api/confirm", {
    method: "POST", body: JSON.stringify({ pendingId }),
  }),
  cancel: (pendingId: string) => request<{ ok: true }>("/api/cancel", {
    method: "POST", body: JSON.stringify({ pendingId }),
  }),
  manual: (kind: string, data: unknown) => request<{ message: string }>(`/api/manual/${kind}`, {
    method: "POST", body: JSON.stringify(data),
  }),
};

export type { ActionPreview };
