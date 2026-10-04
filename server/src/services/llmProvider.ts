import type { Product } from "../types.js";
import { log, logError } from "../utils/logger.js";
import { IntentSchema, systemPrompt, type ParsedIntent } from "./intentSchemas.js";
import { parseWithRules } from "./ruleParser.js";
import { buildEnglishProductAliases, isEnglishProductSearchText, translateProductReferenceToEnglish } from "./productAliases.js";
import type { ConversationLanguage } from "./conversationLocale.js";

export type ParseProvider = "rules" | "ollama" | "hosted";
export interface ParseResult { intent: ParsedIntent; provider: ParseProvider; fallback: boolean }
export interface ConversationTurn { role: "user"; text: string }

const DEFAULT_TIMEOUT_MS = 8_000;
const MODEL_CONFIDENCE_CAP = 0.6;

function timeoutMs(): number {
  const configured = Number(process.env.LLM_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function thinkingModeEnabled(): boolean {
  return /^(?:1|true|yes|on)$/i.test((process.env.LLM_THINKING_MODE ?? "false").trim());
}

function hostedThinkingOption(): Record<string, unknown> {
  const endpoint = process.env.HOSTED_LLM_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";
  if (!/openrouter\.ai/i.test(endpoint)) return {};
  return { reasoning: { enabled: thinkingModeEnabled() } };
}

function stripCodeFence(content: string): string {
  return content.trim().replace(/^\uFEFF/, "").replace(/^```(?:json|javascript|js)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function extractBalancedObject(content: string): string | null {
  const start = content.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return null;
}

function parseJsonContent(content: string): unknown {
  const cleaned = stripCodeFence(content);
  try { return JSON.parse(cleaned) as unknown; }
  catch {
    const objectText = extractBalancedObject(cleaned);
    if (!objectText) throw new Error("LLM response did not contain a complete JSON object");
    try { return JSON.parse(objectText) as unknown; }
    catch (error) { throw new Error(`LLM returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromContentParts(parts: unknown[]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") { chunks.push(part); continue; }
    if (!isRecord(part)) continue;
    if (typeof part.text === "string") chunks.push(part.text);
    else if (typeof part.output_text === "string") chunks.push(part.output_text);
    else if (typeof part.content === "string") chunks.push(part.content);
    else if (Array.isArray(part.content)) chunks.push(textFromContentParts(part.content));
  }
  return chunks.filter(Boolean).join("\n");
}

/** Accept common OpenAI-compatible, OpenRouter, Ollama, and structured-output envelopes. */
function normalizeModelOutput(value: unknown, depth = 0): unknown {
  if (depth > 8) throw new Error("LLM response nesting is too deep");
  if (typeof value === "string") return normalizeModelOutput(parseJsonContent(value), depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 1) return normalizeModelOutput(value[0], depth + 1);
    const text = textFromContentParts(value);
    if (text) return normalizeModelOutput(text, depth + 1);
    throw new Error("LLM returned an empty or unsupported content array");
  }
  if (!isRecord(value)) throw new Error("LLM response was not a JSON object or text response");
  if (typeof value.intent === "string" || Array.isArray(value.aliases) || Array.isArray(value.translations)) return value;

  // Some providers wrap JSON in a named object; others expose OpenAI/Ollama envelopes.
  for (const key of ["json", "parsed", "parsedIntent", "result", "data", "output", "output_text", "response", "content", "text"]) {
    if (value[key] !== undefined && value[key] !== value) {
      try { return normalizeModelOutput(value[key], depth + 1); }
      catch { /* Try the next known envelope key. */ }
    }
  }
  const choices = value.choices;
  if (Array.isArray(choices) && isRecord(choices[0])) {
    const message = choices[0].message;
    if (isRecord(message)) {
      if (message.parsed !== undefined) return normalizeModelOutput(message.parsed, depth + 1);
      if (message.content !== undefined) return normalizeModelOutput(message.content, depth + 1);
    }
  }
  const message = value.message;
  if (isRecord(message)) {
    if (message.parsed !== undefined) return normalizeModelOutput(message.parsed, depth + 1);
    if (message.content !== undefined) return normalizeModelOutput(message.content, depth + 1);
  }
  const candidates = value.candidates;
  if (Array.isArray(candidates) && isRecord(candidates[0])) {
    const content = candidates[0].content;
    if (isRecord(content) && Array.isArray(content.parts)) return normalizeModelOutput(content.parts, depth + 1);
  }
  throw new Error("LLM response did not include an intent object");
}

function ollamaEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/api/chat")) return base;
  if (base.endsWith("/api")) return `${base}/chat`;
  return `${base}/api/chat`;
}

function hostedEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  if (/\/api$/i.test(base)) return `${base}/v1/chat/completions`;
  return `${base}/v1/chat/completions`;
}

async function responseError(response: Response, provider: string): Promise<Error> {
  const body = (await response.text().catch(() => "")).trim().slice(0, 800);
  return new Error(`${provider} returned HTTP ${response.status}${body ? `: ${body}` : ""}`);
}

async function sendHostedRequest(endpoint: string, apiKey: string, payload: Record<string, unknown>, label: string): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": process.env.HOSTED_LLM_REFERER ?? "http://localhost:5173",
    "X-Title": "Dukaandaar Shop Assistant",
  };
  let requestPayload = { ...payload };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(timeoutMs()),
      body: JSON.stringify(requestPayload),
    });
    if (response.ok) return response;
    if (response.status !== 400 && response.status !== 422) throw await responseError(response, label);

    const errorBody = (await response.text().catch(() => "")).slice(0, 800);
    let adjusted = false;
    if ("response_format" in requestPayload && /response_format|json.?object|structured output|unsupported parameter/i.test(errorBody)) {
      const { response_format: _ignored, ...withoutJsonMode } = requestPayload;
      requestPayload = withoutJsonMode;
      adjusted = true;
    }
    if ("reasoning" in requestPayload && /reasoning|thinking/i.test(errorBody) && /unsupported|not supported|unrecognized|unknown|invalid|not implemented|extra inputs/i.test(errorBody)) {
      const { reasoning: _ignored, ...withoutReasoning } = requestPayload;
      requestPayload = withoutReasoning;
      adjusted = true;
    }
    if (!adjusted) throw new Error(`${label} returned HTTP ${response.status}${errorBody.trim() ? `: ${errorBody.trim()}` : ""}`);
  }
  throw new Error(`${label} rejected supported-parameter compatibility retries`);
}

function currentDate(): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }).format(new Date());
}

function promptFor(
  products: Product[],
  preferredLanguage: ConversationLanguage | undefined,
  transcript: string,
  context: ConversationTurn[],
): string {
  const query = ` ${[transcript, ...context.slice(-4).map((turn) => turn.text)].join(" ").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim()} `;
  const queryWords = new Set(query.trim().split(/\s+/u).filter((word) => word.length >= 3));
  const exact: Product[] = [];
  const partial: Product[] = [];
  for (const product of products) {
    const aliases = [product.name, ...product.aliases].filter(Boolean);
    const normalizedAliases = aliases.map((alias) => alias.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim());
    if (normalizedAliases.some((alias) => alias && query.includes(` ${alias} `))) exact.push(product);
    else if (normalizedAliases.some((alias) => alias.split(/\s+/u).some((word) => word.length >= 3 && queryWords.has(word)))) partial.push(product);
  }
  const relevantProducts = [...exact, ...partial].slice(0, 16);
  return systemPrompt(
    relevantProducts.map(({ id, name, aliases }) => ({ id, name, aliases })),
    currentDate(),
    preferredLanguage,
  );
}

function userPrompt(transcript: string, context: ConversationTurn[]): string {
  const recent = context.slice(-4).map(({ role, text }) => ({ role, text: text.slice(0, 320) }));
  if (!recent.length) return transcript;
  return `Recent user history (oldest first): ${JSON.stringify(recent)}\nCurrent user message: ${transcript}`;
}

function correctionFragment(transcript: string, context: ConversationTurn[]): boolean {
  if (!context.length) return false;
  const beginsAsCorrection = /^\s*(?:no\b|nope\b|actually\b|correction\b|i meant\b|i mean\b|not quite\b|sorry,?\s+i meant\b|non\b|en fait\b|je voulais dire\b|plutôt\b|no,?\s|en realidad\b|quería decir\b|não\b|na verdade\b|quis dizer\b|नहीं|दरअसल|असल में|मेरा मतलब|না|আসলে|আমার অর্থ|لا\b|بل\b|أقصد|في الواقع|不|不是|其实|我的意思是)/iu.test(transcript);
  if (!beginsAsCorrection) return false;
  const selfContainedCue = /[?？]|\b(?:show|tell|list|what|which|how much|how many|give me|record|sold|sell|buy|bought|paid|spent|create|add|lost|damaged|history|summary|report|display)\b|(?:দেখাও|জিজ্ঞাসা|কত|তালিকা|বিক্রি|কিনেছি|যোগ করুন|दिखाओ|कितना|कितने|बताओ|बेचा|खरीदा|जोड़ें|montre|affiche|combien|vends?|acheté|histori(?:que|al)|muestra|enseña|cuánto|cuántos|vendí|compré|mostre|liste|quanto|quantos|vendi|comprei|أظهر|كم|سجل|بعت|اشتريت|显示|查询|多少|售出|卖了)/iu.test(transcript);
  return !selfContainedCue;
}

function lowConfidenceUnknown(language?: ConversationLanguage): ParsedIntent {
  return IntentSchema.parse({ intent: "UNKNOWN", responseLanguage: language, confidence: 0.25 }) as ParsedIntent;
}

function calibrateModelIntent(intent: ParsedIntent): ParsedIntent {
  const cap = intent.intent === "UNKNOWN" ? 0.35 : MODEL_CONFIDENCE_CAP;
  return { ...intent, confidence: Math.min(intent.confidence, cap) } as ParsedIntent;
}

function calibrateFallbackIntent(intent: ParsedIntent): ParsedIntent {
  return { ...intent, confidence: Math.min(intent.confidence, MODEL_CONFIDENCE_CAP) } as ParsedIntent;
}

async function callOllama(transcript: string, products: Product[], preferredLanguage?: ConversationLanguage, context: ConversationTurn[] = []): Promise<unknown> {
  const endpoint = ollamaEndpoint(process.env.OLLAMA_URL ?? "http://127.0.0.1:11434");
  const model = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs()),
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      think: thinkingModeEnabled(),
      options: { temperature: 0, num_predict: 512 },
      messages: [
        { role: "system", content: promptFor(products, preferredLanguage, transcript, context) },
        { role: "user", content: userPrompt(transcript, context) },
      ],
    }),
  });
  if (!response.ok) throw await responseError(response, "Ollama");
  const payload = await response.json() as unknown;
  return normalizeModelOutput(payload);
}

async function callHosted(transcript: string, products: Product[], preferredLanguage?: ConversationLanguage, context: ConversationTurn[] = []): Promise<unknown> {
  const apiKey = process.env.HOSTED_LLM_API_KEY;
  if (!apiKey) throw new Error("HOSTED_LLM_API_KEY is not configured");
  const endpoint = hostedEndpoint(process.env.HOSTED_LLM_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions");
  const model = process.env.HOSTED_LLM_MODEL ?? "google/gemini-3.7-flash";
  const payload = {
    model,
    temperature: 0.1,
    stream: false,
    ...hostedThinkingOption(),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: promptFor(products, preferredLanguage, transcript, context) },
      { role: "user", content: userPrompt(transcript, context) },
    ],
  };
  const response = await sendHostedRequest(endpoint, apiKey, payload, "Hosted LLM");
  return normalizeModelOutput(await response.json() as unknown);
}

async function requestProductAliasSuggestions(
  provider: "ollama" | "hosted",
  name: string,
  category: string,
  unit: string,
  existingAliases: string[],
): Promise<string[]> {
  const system = "Generate 4–5 short, distinct ENGLISH product-search aliases. Translate non-English names into natural English. Keep only names and facts supported by the input; preserve a recognized brand and pack/size. Do not add unrelated synonyms or non-English text. Return JSON only: {\"aliases\":[\"...\"]}.";
  const user = JSON.stringify({ name, category, unit, existingAliases });
  let response: Response;

  if (provider === "ollama") {
    const endpoint = ollamaEndpoint(process.env.OLLAMA_URL ?? "http://127.0.0.1:11434");
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs()),
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? "gemma4:e4b",
        stream: false,
        format: "json",
        think: thinkingModeEnabled(),
        options: { temperature: 0, num_predict: 128 },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
  } else {
    const apiKey = process.env.HOSTED_LLM_API_KEY;
    if (!apiKey) throw new Error("HOSTED_LLM_API_KEY is not configured");
    const endpoint = hostedEndpoint(process.env.HOSTED_LLM_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions");
    const payload = {
      model: process.env.HOSTED_LLM_MODEL ?? "google/gemini-3.7-flash",
      temperature: 0,
      stream: false,
      ...hostedThinkingOption(),
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    };
    response = await sendHostedRequest(endpoint, apiKey, payload, "Hosted alias generation");
  }

  if (!response.ok) throw await responseError(response, provider === "ollama" ? "Ollama alias generation" : "Hosted alias generation");
  const output = normalizeModelOutput(await response.json() as unknown);
  if (!isRecord(output) || !Array.isArray(output.aliases)) throw new Error("LLM alias response did not contain an aliases array");
  return output.aliases.filter((alias): alias is string => typeof alias === "string");
}

export async function completeProductAliases(
  name: string,
  aliases: string[] = [],
  category = "General",
  unit = "unit",
  allowLlm = true,
): Promise<string[]> {
  const deterministic = buildEnglishProductAliases(name, aliases, category, unit);
  const configured = (process.env.LLM_PROVIDER ?? "rules").trim().toLocaleLowerCase();
  const distinctProposals = new Set(aliases.map((alias) => alias.trim().toLocaleLowerCase()).filter(isEnglishProductSearchText));
  const hasEnglishNameAndAliasSet = isEnglishProductSearchText(name) && distinctProposals.size >= 4;
  if (!allowLlm || hasEnglishNameAndAliasSet || (configured !== "ollama" && configured !== "hosted")) return deterministic;
  try {
    const suggestions = await requestProductAliasSuggestions(configured, name, category, unit, aliases);
    return buildEnglishProductAliases(name, [...aliases, ...suggestions], category, unit);
  } catch (error) {
    logError("productAliases", "LLM alias generation failed; using deterministic English aliases", error);
    return deterministic;
  }
}

function translationCatalog(references: string[], products: Product[]): Array<[string, ...string[]]> {
  const query = references.map(translateProductReferenceToEnglish).join(" ").normalize("NFKC").toLocaleLowerCase();
  const queryWords = new Set(query.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").split(/\s+/u).filter((word) => word.length >= 3));
  const ranked = products.map((product) => {
    const englishTerms = [product.name, ...product.aliases].filter(isEnglishProductSearchText);
    const score = englishTerms.reduce((max, term) => {
      const normalized = term.normalize("NFKC").toLocaleLowerCase();
      const phraseMatch = Boolean(query) && (query.includes(normalized) || normalized.includes(query));
      const overlap = normalized.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").split(/\s+/u).filter((word) => queryWords.has(word)).length;
      return Math.max(max, (phraseMatch ? 10 : 0) + overlap);
    }, 0);
    return { product, score, englishTerms };
  }).filter((entry) => entry.englishTerms.length > 0)
    .sort((left, right) => right.score - left.score);
  const selected = ranked.some((entry) => entry.score > 0)
    ? ranked.filter((entry) => entry.score > 0).slice(0, 24)
    : ranked.slice(0, 12);
  return selected.map(({ product, englishTerms }) => [product.name, ...englishTerms.filter((term) => term !== product.name).slice(0, 5)] as [string, ...string[]]);
}

async function requestProductTranslations(
  provider: "ollama" | "hosted",
  references: string[],
  products: Product[],
): Promise<string[]> {
  const system = `Translate each product reference into a concise English catalog-search phrase. Do not answer the user or infer quantities. Preserve brand, product variant, and pack size. If a phrase is already English, keep its meaning and spelling; if several catalog products could match, do not choose one—translate literally. Use an English canonical catalog name only when the match is clear. Return JSON only as {"translations":["..."]}, with one string per input reference in the same order.`;
  const user = JSON.stringify({ references, englishCatalog: translationCatalog(references, products) });
  let response: Response;
  if (provider === "ollama") {
    response = await fetch(ollamaEndpoint(process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs()),
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL ?? "gemma4:e4b",
        stream: false,
        format: "json",
        think: thinkingModeEnabled(),
        options: { temperature: 0, num_predict: 192 },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
  } else {
    const apiKey = process.env.HOSTED_LLM_API_KEY;
    if (!apiKey) throw new Error("HOSTED_LLM_API_KEY is not configured");
    const endpoint = hostedEndpoint(process.env.HOSTED_LLM_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions");
    const payload = {
      model: process.env.HOSTED_LLM_MODEL ?? "google/gemini-3.7-flash",
      temperature: 0,
      stream: false,
      ...hostedThinkingOption(),
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    };
    response = await sendHostedRequest(endpoint, apiKey, payload, "Hosted product translation");
  }
  if (!response.ok) throw await responseError(response, provider === "ollama" ? "Ollama product translation" : "Hosted product translation");
  const output = normalizeModelOutput(await response.json() as unknown);
  if (!isRecord(output) || !Array.isArray(output.translations)) throw new Error("LLM product translation did not contain a translations array");
  return output.translations.filter((value): value is string => typeof value === "string");
}

/** Translate references before catalog search; deterministic dictionary matching is the failure/rules fallback. */
export async function translateProductReferences(references: string[], products: Product[], allowLlm = true): Promise<string[]> {
  if (!references.length) return [];
  const fallback = references.map(translateProductReferenceToEnglish);
  const configured = (process.env.LLM_PROVIDER ?? "rules").trim().toLocaleLowerCase();
  if (!allowLlm || (configured !== "ollama" && configured !== "hosted")) return fallback;
  try {
    const suggestions = await requestProductTranslations(configured, references, products);
    return references.map((_, index) => {
      const suggestion = suggestions[index]?.trim();
      return suggestion && isEnglishProductSearchText(suggestion) ? suggestion : fallback[index];
    });
  } catch (error) {
    logError("productResolver", "LLM product translation failed; using deterministic translation fallback", error);
    return fallback;
  }
}

export async function parseCommand(
  transcript: string,
  products: Product[],
  preferredLanguage?: ConversationLanguage,
  context: ConversationTurn[] = [],
): Promise<ParseResult> {
  const configured = (process.env.LLM_PROVIDER ?? "rules").trim().toLocaleLowerCase();
  const startedAt = Date.now();
  const rulesIntent = IntentSchema.parse(parseWithRules(transcript, products, preferredLanguage));
  const isLlmProvider = configured === "ollama" || configured === "hosted";
  const isCorrection = correctionFragment(transcript, context);
  log("llmProvider", `provider=\"${configured}\" parsing command`, { transcript: transcript.slice(0, 240), catalogSize: products.length, contextTurns: context.length });

  if (configured === "rules") {
    const intent = isCorrection ? lowConfidenceUnknown(preferredLanguage ?? rulesIntent.responseLanguage) : rulesIntent;
    log("llmProvider", `rule parse intent=\"${intent.intent}\" in ${Date.now() - startedAt}ms`);
    return { intent, provider: "rules", fallback: false };
  }

  // If an LLM provider is selected, always call it. Rules are only a fallback when the model
  // provider is unavailable or its response cannot be parsed into a valid intent.
  try {
    const raw = configured === "ollama"
      ? await callOllama(transcript, products, preferredLanguage, context)
      : configured === "hosted"
        ? await callHosted(transcript, products, preferredLanguage, context)
        : (() => { throw new Error(`Unknown LLM_PROVIDER: ${configured}`); })();
    const intent = calibrateModelIntent(IntentSchema.parse(normalizeModelOutput(raw)));
    log("llmProvider", `LLM parse intent=\"${intent.intent}\" provider=\"${configured}\" calibratedConfidence=${intent.confidence} latency=${Date.now() - startedAt}ms`, intent as unknown as Record<string, unknown>);
    return { intent, provider: configured as ParseProvider, fallback: false };
  } catch (error) {
    logError("llmProvider", `${configured} failed or returned invalid JSON; using deterministic fallback`, error);
    const fallbackIntent = isCorrection ? lowConfidenceUnknown(preferredLanguage ?? rulesIntent.responseLanguage) : rulesIntent;
    const intent = calibrateFallbackIntent(fallbackIntent);
    log("llmProvider", `fallback intent=\"${intent.intent}\" calibratedConfidence=${intent.confidence} in ${Date.now() - startedAt}ms`);
    return { intent, provider: isLlmProvider ? configured as ParseProvider : "rules", fallback: true };
  }
}

export function activeProvider(): ParseProvider {
  const value = (process.env.LLM_PROVIDER ?? "rules").trim().toLocaleLowerCase();
  return value === "ollama" || value === "hosted" ? value : "rules";
}
