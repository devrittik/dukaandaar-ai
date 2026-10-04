import type { ActionPreview, AuthUser, ConversationLanguage, DashboardData, Health, ParseResponse, Product, ProductUpdate, ShopSettings, ShopSettingsUpdate, Source, SpeechStatus, TransactionsResponse } from "../types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

export const AUTH_SESSION_EXPIRED_EVENT = "dukaandaar:session-expired";

function signalExpiredSession(path: string, status: number): void {
  if (status === 401 && !path.startsWith("/api/auth/") && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const startedAt = performance.now();
  const method = (init?.method ?? "GET").toUpperCase();
  const url = `${API_BASE}${path}`;
  console.log(`[api] ${method} ${url}`);
  try {
    const response = await fetch(url, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-With": "Dukaandaar", ...(init?.headers ?? {}) },
    });
    const data = await response.json().catch(() => ({}));
    console.log(`[api] response ${response.status} in ${Math.round(performance.now() - startedAt)}ms`);
    if (!response.ok) {
      signalExpiredSession(path, response.status);
      throw new ApiError(data?.error ?? `Request failed with ${response.status}`, response.status);
    }
    return data as T;
  } catch (error) {
    console.error(`[api] ${method} ${path} failed`, error);
    throw error;
  }
}

async function requestAudio(path: string, init: RequestInit): Promise<Blob> {
  const startedAt = performance.now();
  console.log(`[api] POST ${API_BASE}${path}`);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "X-Requested-With": "Dukaandaar", ...(init.headers ?? {}) },
  });
  console.log(`[api] audio response ${response.status} in ${Math.round(performance.now() - startedAt)}ms`);
  if (!response.ok) {
    signalExpiredSession(path, response.status);
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data?.error ?? `Speech request failed with ${response.status}`, response.status);
  }
  return response.blob();
}

async function currentUser(): Promise<AuthUser | null> {
  const response = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
  if (response.status === 401) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data?.error ?? `Request failed with ${response.status}`, response.status);
  return (data?.user ?? null) as AuthUser | null;
}

async function transcribeAudio(audio: Blob, language: string, signal?: AbortSignal): Promise<string> {
  const query = new URLSearchParams({ language });
  const response = await fetch(`${API_BASE}/api/speech/transcribe?${query}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "audio/wav", "X-Requested-With": "Dukaandaar" },
    body: audio,
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    signalExpiredSession("/api/speech/transcribe", response.status);
    throw new ApiError(data?.error ?? `Speech recognition failed with ${response.status}`, response.status);
  }
  return typeof data?.transcript === "string" ? data.transcript : "";
}

export const api = {
  dashboard: () => request<DashboardData>("/api/dashboard"),
  health: () => request<Health>("/api/health"),
  currentUser,
  signUp: (input: { ownerName: string; shopName: string; email: string; password: string }) => request<{ user: AuthUser }>("/api/auth/signup", {
    method: "POST", body: JSON.stringify(input),
  }),
  login: (input: { email: string; password: string }) => request<{ user: AuthUser }>("/api/auth/login", {
    method: "POST", body: JSON.stringify(input),
  }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" }),
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
