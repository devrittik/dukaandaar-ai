import "dotenv/config";
import cors from "cors";
import morgan from "morgan";
import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import { z, ZodError } from "zod";
import { createStorage } from "./storage/index.js";
import { BusinessLogic } from "./services/businessLogic.js";
import { AuthError, AuthService, toPublicAuthUser, type AuthPrincipal } from "./services/authService.js";
import { ConversationMemory } from "./services/conversationMemory.js";
import type { ConversationTurn } from "./services/llmProvider.js";
import { getDashboard } from "./services/analyticsService.js";
import { isConversationLanguage } from "./services/conversationLocale.js";
import { getSpeechStatus, SpeechServiceError, speechUploadLimitBytes, synthesizeSpeech, transcribeWav } from "./services/offlineSpeech.js";
import { log, logError, logWarn } from "./utils/logger.js";
import { validateRuntimeConfiguration } from "./config/runtimeConfig.js";

const runtimeEnvironment = validateRuntimeConfiguration();
const PORT = Number(process.env.PORT ?? 4000);
const storage = createStorage();
const auth = new AuthService(storage);
const businessByShop = new Map<string, { instance: BusinessLogic; lastUsedAt: number }>();
const conversationMemory = new ConversationMemory();
const app = express();

function businessForShop(shopId: string): BusinessLogic {
  const now = Date.now();
  for (const [key, value] of businessByShop) {
    if (now - value.lastUsedAt >= 30 * 60_000) businessByShop.delete(key);
  }
  const cached = businessByShop.get(shopId);
  const entry = cached ?? { instance: new BusinessLogic(storage, shopId), lastUsedAt: now };
  entry.lastUsedAt = now;
  businessByShop.delete(shopId);
  businessByShop.set(shopId, entry);
  while (businessByShop.size > 512) {
    const oldest = businessByShop.keys().next().value as string | undefined;
    if (!oldest) break;
    businessByShop.delete(oldest);
  }
  return entry.instance;
}

const SignUpSchema = z.object({
  ownerName: z.string().trim().min(1).max(100),
  shopName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
}).strict();
const LoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();
const SettingsUpdateSchema = z.object({
  shopName: z.string().trim().min(1).max(100),
  ownerName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40).default(""),
  address: z.string().trim().max(240).default(""),
  lowStockDefaultThreshold: z.number().finite().nonnegative().max(100_000),
}).strict();
const SpeechSynthesisSchema = z.object({
  text: z.string().trim().min(1).max(1500),
  language: z.string().trim().min(2).max(35).default("en-IN"),
}).strict();
const ProductUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  sellPrice: z.number().finite().positive().optional(),
  costPrice: z.number().finite().nonnegative().optional(),
  lowStockThreshold: z.number().finite().nonnegative().max(100_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one product field to update.");

function conversationContext(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).flatMap((turn): ConversationTurn[] => {
    if (typeof turn !== "object" || turn === null) return [];
    const candidate = turn as Record<string, unknown>;
    if (candidate.role !== "user" || typeof candidate.text !== "string") return [];
    const text = candidate.text.trim().slice(0, 500);
    return text ? [{ role: candidate.role, text }] : [];
  });
}

function conversationSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(candidate) ? candidate : null;
}

const SESSION_COOKIE_NAME = "dukaandaar_session";
// Hosted frontends and APIs are often on different sites. SameSite=Lax suppresses
// the session cookie on credentialed cross-site fetches, so production uses None
// together with Secure; the non-browser write guard and exact CORS allowlist remain active.
const SESSION_COOKIE_SAME_SITE = runtimeEnvironment === "production" ? "None" : "Lax";
function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

function setSessionCookie(response: Response, token: string, expiresAt: Date): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const cookie = [`${SESSION_COOKIE_NAME}=${token}`, "Path=/api", "HttpOnly", `SameSite=${SESSION_COOKIE_SAME_SITE}`, `Max-Age=${maxAge}`];
  if (runtimeEnvironment === "production") cookie.push("Secure");
  response.setHeader("Set-Cookie", cookie.join("; "));
}

function clearSessionCookie(response: Response): void {
  const cookie = [`${SESSION_COOKIE_NAME}=`, "Path=/api", "HttpOnly", `SameSite=${SESSION_COOKIE_SAME_SITE}`, "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"];
  if (runtimeEnvironment === "production") cookie.push("Secure");
  response.setHeader("Set-Cookie", cookie.join("; "));
}

function authenticatedPrincipal(response: Response): AuthPrincipal {
  return response.locals.authenticatedPrincipal as AuthPrincipal;
}

const requireAuthentication: RequestHandler = (request, response, next) => {
  void auth.authenticate(readSessionToken(request)).then((principal) => {
    if (!principal) {
      clearSessionCookie(response);
      response.status(401).json({ error: "Please sign in to continue." });
      return;
    }
    response.locals.authenticatedPrincipal = principal;
    next();
  }).catch(next);
};

app.disable("x-powered-by");
app.use(morgan("dev", { stream: { write: (line) => log("http", line.trim()) } }));

const configuredOrigins = process.env.CLIENT_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean);
const corsOrigins = configuredOrigins?.length ? configuredOrigins : runtimeEnvironment === "production" ? false : true;
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const requireBrowserRequestHeader: RequestHandler = (request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) { next(); return; }
  if (request.get("X-Requested-With") !== "Dukaandaar") {
    response.status(403).json({ error: "The request could not be verified. Refresh the page and try again." });
    return;
  }
  next();
};
app.use("/api", requireBrowserRequestHeader);

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "dukaandaar-api", storage: process.env.STORAGE_DRIVER ?? "mongo", environment: runtimeEnvironment });
});

app.post("/api/auth/signup", async (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const input = SignUpSchema.parse(request.body);
    const grant = await auth.register(input);
    setSessionCookie(response, grant.token, grant.expiresAt);
    response.status(201).json({ user: toPublicAuthUser(grant.user) });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const input = LoginSchema.parse(request.body);
    const grant = await auth.login(input.email, input.password);
    setSessionCookie(response, grant.token, grant.expiresAt);
    response.json({ user: toPublicAuthUser(grant.user) });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", async (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const principal = await auth.authenticate(readSessionToken(request));
    if (!principal) {
      clearSessionCookie(response);
      response.status(401).json({ error: "Not signed in." });
      return;
    }
    response.json({ user: toPublicAuthUser(principal) });
  } catch (error) { next(error); }
});

app.post("/api/auth/logout", async (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  try {
    await auth.logout(readSessionToken(request));
    clearSessionCookie(response);
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.use("/api", requireAuthentication);

app.get("/api/speech/status", async (_request, response, next) => {
  try { response.json(await getSpeechStatus()); }
  catch (error) { next(error); }
});

app.post("/api/speech/transcribe", express.raw({ type: ["audio/wav", "audio/x-wav", "application/octet-stream"], limit: speechUploadLimitBytes() }), async (request, response, next) => {
  try {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: "Send a non-empty PCM WAV recording." });
      return;
    }
    const requestedLanguage = typeof request.query.language === "string" ? request.query.language : "en-IN";
    const transcript = await transcribeWav(request.body, requestedLanguage);
    response.json({ transcript });
  } catch (error) { next(error); }
});

app.post("/api/speech/synthesize", async (request, response, next) => {
  try {
    const input = SpeechSynthesisSchema.parse(request.body);
    const result = await synthesizeSpeech(input.text, input.language);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", result.contentType);
    response.send(result.audio);
  } catch (error) { next(error); }
});

app.get("/api/dashboard", async (_request, response, next) => {
  try {
    const dashboard = await getDashboard(storage, authenticatedPrincipal(response).shopId);
    response.json(dashboard);
  } catch (error) { next(error); }
});

app.get("/api/products", async (_request, response, next) => {
  try {
    const dashboard = await getDashboard(storage, authenticatedPrincipal(response).shopId);
    response.json(dashboard.products);
  } catch (error) { next(error); }
});

app.put("/api/products/:id", async (request, response, next) => {
  try {
    const changes = ProductUpdateSchema.parse(request.body);
    const product = await storage.updateProduct(authenticatedPrincipal(response).shopId, request.params.id, changes);
    response.json(product);
  } catch (error) { next(error); }
});

app.get("/api/settings", async (_request, response, next) => {
  try {
    response.json(await storage.getSettings(authenticatedPrincipal(response).shopId));
  } catch (error) { next(error); }
});

app.put("/api/settings", async (request, response, next) => {
  try {
    const changes = SettingsUpdateSchema.parse(request.body);
    response.json(await storage.updateSettings(authenticatedPrincipal(response).shopId, changes));
  } catch (error) { next(error); }
});

app.get("/api/transactions", async (_request, response, next) => {
  try {
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const [sales, purchases, expenses, losses] = await Promise.all([
      storage.querySales(authenticatedPrincipal(response).shopId, { from, to }),
      storage.queryPurchases(authenticatedPrincipal(response).shopId, { from, to }),
      storage.queryExpenses(authenticatedPrincipal(response).shopId, { from, to }),
      storage.queryLosses(authenticatedPrincipal(response).shopId, { from, to }),
    ]);
    response.json({ sales, purchases, expenses, losses });
  } catch (error) { next(error); }
});

app.post("/api/parse", async (request, response, next) => {
  try {
    const transcript = typeof request.body?.transcript === "string" ? request.body.transcript.trim() : "";
    const source = request.body?.source === "voice" ? "voice" : "text";
    if (!transcript || transcript.length > 1200) {
      response.status(400).json({ error: "Enter a command between 1 and 1200 characters." });
      return;
    }
    log("parse", "transcript received", { source, transcript });
    const preferredLanguage = isConversationLanguage(request.body?.language) ? request.body.language : undefined;
    const sessionId = conversationSessionId(request.body?.sessionId);
    if (request.body?.sessionId !== undefined && !sessionId) {
      response.status(400).json({ error: "A valid conversation session ID is required." });
      return;
    }
    const principal = authenticatedPrincipal(response);
    const scopedSessionId = sessionId ? `${principal.shopId}:${sessionId}` : null;
    const context = scopedSessionId ? conversationMemory.getContext(scopedSessionId) : conversationContext(request.body?.context);
    if (scopedSessionId) conversationMemory.remember(scopedSessionId, transcript);
    const result = await businessForShop(principal.shopId).parseTranscript(transcript, source, preferredLanguage, context);
    response.json(result);
  } catch (error) { next(error); }
});

app.post("/api/conversation/reset", (request, response) => {
  const sessionId = conversationSessionId(request.body?.sessionId);
  if (!sessionId) {
    response.status(400).json({ error: "A valid conversation session ID is required." });
    return;
  }
  const principal = authenticatedPrincipal(response);
  conversationMemory.clear(`${principal.shopId}:${sessionId}`);
  log("conversation", "short-term context cleared", { shopId: principal.shopId });
  response.json({ ok: true });
});

app.post("/api/confirm", async (request, response, next) => {
  try {
    const pendingId = typeof request.body?.pendingId === "string" ? request.body.pendingId : "";
    if (!pendingId) { response.status(400).json({ error: "A pending confirmation ID is required." }); return; }
    const result = await businessForShop(authenticatedPrincipal(response).shopId).confirm(pendingId);
    response.json(result);
  } catch (error) { next(error); }
});

app.post("/api/cancel", (request, response) => {
  const pendingId = typeof request.body?.pendingId === "string" ? request.body.pendingId : "";
  if (pendingId) businessForShop(authenticatedPrincipal(response).shopId).cancel(pendingId);
  response.json({ ok: true });
});

app.post("/api/manual/:kind", async (request, response, next) => {
  try {
    const result = await businessForShop(authenticatedPrincipal(response).shopId).recordManual(request.params.kind, request.body);
    response.status(201).json(result);
  } catch (error) { next(error); }
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const parserStatus = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : null;
  const status = error instanceof SpeechServiceError || error instanceof AuthError
    ? error.statusCode
    : parserStatus && parserStatus >= 400 && parserStatus < 500
      ? parserStatus
      : error instanceof ZodError || /invalid|choose|already exists|insufficient|expired|unknown|catalog/i.test(message) ? 400 : 500;
  if (status === 500) logError("server", "unhandled request error", error);
  else logWarn("validation", message);
  response.status(status).json({ error: message });
};
app.use(errorHandler);

async function startServer(): Promise<void> {
  await storage.connect();
  app.listen(PORT, "0.0.0.0", () => log("server", `listening on 0.0.0.0:${PORT}`, {
    STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? "mongo",
    LLM_PROVIDER: process.env.LLM_PROVIDER ?? "rules",
    PORT,
  }));
}

async function stopServer(): Promise<void> {
  await storage.disconnect();
}

void startServer().catch(async (error) => {
  logError("server", "startup failed", error);
  await stopServer().catch(() => undefined);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("server", `${signal} received, closing storage`);
    void stopServer().finally(() => process.exit(0));
  });
}
