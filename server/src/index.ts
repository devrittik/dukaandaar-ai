import "dotenv/config";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import { createStorage } from "./storage/index.js";
import { BusinessLogic } from "./services/businessLogic.js";
import { ConversationMemory } from "./services/conversationMemory.js";
import type { ConversationTurn } from "./services/llmProvider.js";
import { getDashboard } from "./services/analyticsService.js";
import { isConversationLanguage } from "./services/conversationLocale.js";
import { getSpeechStatus, SpeechServiceError, speechUploadLimitBytes, synthesizeSpeech, transcribeWav } from "./services/offlineSpeech.js";
import { log, logError, logWarn } from "./utils/logger.js";

const PORT = Number(process.env.PORT ?? 4000);
const SHOP_ID = process.env.SHOP_ID ?? "shop_001";
const storage = createStorage();
const business = new BusinessLogic(storage);
const conversationMemory = new ConversationMemory();
const app = express();

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

app.disable("x-powered-by");
app.use(cors({ origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",").map((value) => value.trim()) : true }));
app.use(express.json({ limit: "1mb" }));
app.use((request, _response, next) => {
  log("http", `${request.method} ${request.path}`);
  next();
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "dukaandaar-api", storage: process.env.STORAGE_DRIVER ?? "mongo", shopId: SHOP_ID });
});

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
    const dashboard = await getDashboard(storage, SHOP_ID);
    response.json(dashboard);
  } catch (error) { next(error); }
});

app.get("/api/products", async (_request, response, next) => {
  try {
    const dashboard = await getDashboard(storage, SHOP_ID);
    response.json(dashboard.products);
  } catch (error) { next(error); }
});

app.put("/api/products/:id", async (request, response, next) => {
  try {
    const changes = ProductUpdateSchema.parse(request.body);
    const product = await storage.updateProduct(SHOP_ID, request.params.id, changes);
    response.json(product);
  } catch (error) { next(error); }
});

app.get("/api/settings", async (_request, response, next) => {
  try {
    response.json(await storage.getSettings(SHOP_ID));
  } catch (error) { next(error); }
});

app.put("/api/settings", async (request, response, next) => {
  try {
    const changes = SettingsUpdateSchema.parse(request.body);
    response.json(await storage.updateSettings(SHOP_ID, changes));
  } catch (error) { next(error); }
});

app.get("/api/transactions", async (_request, response, next) => {
  try {
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const [sales, purchases, expenses, losses] = await Promise.all([
      storage.querySales(SHOP_ID, { from, to }),
      storage.queryPurchases(SHOP_ID, { from, to }),
      storage.queryExpenses(SHOP_ID, { from, to }),
      storage.queryLosses(SHOP_ID, { from, to }),
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
    const context = sessionId ? conversationMemory.getContext(sessionId) : conversationContext(request.body?.context);
    if (sessionId) conversationMemory.remember(sessionId, transcript);
    const result = await business.parseTranscript(transcript, source, preferredLanguage, context);
    response.json(result);
  } catch (error) { next(error); }
});

app.post("/api/conversation/reset", (request, response) => {
  const sessionId = conversationSessionId(request.body?.sessionId);
  if (!sessionId) {
    response.status(400).json({ error: "A valid conversation session ID is required." });
    return;
  }
  conversationMemory.clear(sessionId);
  log("conversation", "short-term context cleared", { sessionId });
  response.json({ ok: true });
});

app.post("/api/confirm", async (request, response, next) => {
  try {
    const pendingId = typeof request.body?.pendingId === "string" ? request.body.pendingId : "";
    if (!pendingId) { response.status(400).json({ error: "A pending confirmation ID is required." }); return; }
    const result = await business.confirm(pendingId);
    response.json(result);
  } catch (error) { next(error); }
});

app.post("/api/cancel", (request, response) => {
  const pendingId = typeof request.body?.pendingId === "string" ? request.body.pendingId : "";
  if (pendingId) business.cancel(pendingId);
  response.json({ ok: true });
});

app.post("/api/manual/:kind", async (request, response, next) => {
  try {
    const result = await business.recordManual(request.params.kind, request.body);
    response.status(201).json(result);
  } catch (error) { next(error); }
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const parserStatus = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : null;
  const status = error instanceof SpeechServiceError
    ? error.statusCode
    : parserStatus && parserStatus >= 400 && parserStatus < 500
      ? parserStatus
      : error instanceof ZodError || /invalid|choose|already exists|insufficient|expired|unknown|catalog/i.test(message) ? 400 : 500;
  if (status === 500) logError("server", "unhandled request error", error);
  else logWarn("validation", message);
  response.status(status).json({ error: message });
};
app.use(errorHandler);

async function start(): Promise<void> {
  await storage.connect();
  app.listen(PORT, "0.0.0.0", () => {
    log("server", `listening on 0.0.0.0:${PORT}`, {
      STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? "mongo",
      LLM_PROVIDER: process.env.LLM_PROVIDER ?? "rules",
      PORT,
      SHOP_ID,
    });
  });
}

start().catch(async (error) => {
  logError("server", "startup failed", error);
  await storage.disconnect().catch(() => undefined);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log("server", `${signal} received, closing storage`);
    void storage.disconnect().finally(() => process.exit(0));
  });
}
