import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { completeProductAliases, parseCommand, translateProductReferences } from "../src/services/llmProvider.js";
import type { Product } from "../src/types.js";

const envKeys = ["LLM_PROVIDER", "LLM_THINKING_MODE", "HOSTED_LLM_API_KEY", "HOSTED_LLM_BASE_URL", "HOSTED_LLM_MODEL", "OLLAMA_URL", "OLLAMA_MODEL", "LLM_TIMEOUT_MS"] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function configureHosted(): void {
  process.env.LLM_PROVIDER = "hosted";
  process.env.HOSTED_LLM_API_KEY = "test-key";
  process.env.HOSTED_LLM_BASE_URL = "https://mock.example/v1/chat/completions";
  process.env.HOSTED_LLM_MODEL = "test-model";
}

const unfamiliarRequest = "Could you reconcile the ledger for the prior accounting interval?";

test("configured hosted parser is called even when rules can confidently parse the request", async () => {
  configureHosted();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ intent: "QUERY_LOSSES", period: "month", responseLanguage: "en", confidence: 0.5 }) } }] });
  }) as typeof fetch;

  const result = await parseCommand("What were my losses this month?", [], "en");
  assert.equal(calls, 1);
  assert.equal(result.intent.intent, "QUERY_LOSSES");
  assert.equal(result.provider, "hosted");
  assert.equal(result.fallback, false);
});

test("LLM_THINKING_MODE toggles the Ollama think field on and off", async () => {
  process.env.LLM_PROVIDER = "ollama";
  process.env.OLLAMA_URL = "http://mock.example";
  let calls = 0;
  const values: unknown[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { think?: unknown };
    values.push(body.think);
    calls += 1;
    return jsonResponse({ message: { content: JSON.stringify({ intent: "QUERY_LOSSES", period: "month", responseLanguage: "en", confidence: 0.5 }) } });
  }) as typeof fetch;

  process.env.LLM_THINKING_MODE = "true";
  await parseCommand("What were my losses this month?", [], "en");
  process.env.LLM_THINKING_MODE = "false";
  await parseCommand("What were my losses this month?", [], "en");
  assert.equal(calls, 2);
  assert.deepEqual(values, [true, false]);
});

test("OpenRouter receives the selected reasoning mode from LLM_THINKING_MODE", async () => {
  configureHosted();
  process.env.HOSTED_LLM_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
  const values: unknown[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { reasoning?: { enabled?: boolean } };
    values.push(body.reasoning?.enabled);
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ intent: "QUERY_LOSSES", period: "month", responseLanguage: "en", confidence: 0.5 }) } }] });
  }) as typeof fetch;

  process.env.LLM_THINKING_MODE = "on";
  await parseCommand("What were my losses this month?", [], "en");
  process.env.LLM_THINKING_MODE = "off";
  await parseCommand("What were my losses this month?", [], "en");
  assert.deepEqual(values, [true, false]);
});

test("hosted parser accepts fenced JSON split across array content parts and caps claimed confidence", async () => {
  configureHosted();
  const intentJson = JSON.stringify({ intent: "QUERY_LOSSES", period: "month", confidence: 0.99, responseLanguage: "en" });
  globalThis.fetch = (async () => jsonResponse({
    choices: [{ message: { content: [
      { type: "text", text: "Parsed intent follows:\n" },
      { type: "text", text: `\`\`\`json\n${intentJson}\n\`\`\`` },
    ] } }],
  })) as typeof fetch;

  const result = await parseCommand(unfamiliarRequest, [], "en");
  assert.equal(result.intent.intent, "QUERY_LOSSES");
  assert.equal(result.intent.period, "month");
  assert.equal(result.provider, "hosted");
  assert.equal(result.fallback, false);
  assert.equal(result.intent.confidence, 0.6);
});

test("hosted parser retries once when a gateway rejects JSON mode", async () => {
  configureHosted();
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.stream, false);
    if (calls === 1) {
      assert.ok("response_format" in body);
      return jsonResponse({ error: { message: "response_format unsupported" } }, 400);
    }
    assert.ok(!("response_format" in body));
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ intent: "QUERY_PURCHASES", period: "all", confidence: 0.98 }) } }] });
  }) as typeof fetch;

  const result = await parseCommand(unfamiliarRequest, [], "en");
  assert.equal(calls, 2);
  assert.equal(result.intent.intent, "QUERY_PURCHASES");
  assert.equal(result.intent.confidence, 0.6);
  assert.equal(result.provider, "hosted");
  assert.equal(result.fallback, false);
});

test("hosted parser falls back safely when provider output is invalid", async () => {
  configureHosted();
  globalThis.fetch = (async () => jsonResponse({ choices: [{ message: { content: "not JSON" } }] })) as typeof fetch;

  const result = await parseCommand("Please reconcile my books.", [], "en");
  assert.equal(result.intent.intent, "UNKNOWN");
  assert.equal(result.provider, "hosted");
  assert.equal(result.fallback, true);
});

test("Ollama is called for a clear shop request and accepts message content arrays", async () => {
  process.env.LLM_PROVIDER = "ollama";
  process.env.OLLAMA_URL = "http://mock.example";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse({
      message: { content: [{ type: "text", text: JSON.stringify({ intent: "QUERY_SALES", period: "month", responseLanguage: "bn", confidence: 0.99 }) }] },
    });
  }) as typeof fetch;

  const result = await parseCommand("এই মাসে আমার বিক্রি কত?", [], "bn");
  assert.equal(calls, 1);
  assert.equal(result.intent.intent, "QUERY_SALES");
  assert.equal(result.intent.period, "month");
  assert.equal(result.intent.responseLanguage, "bn");
  assert.equal(result.intent.confidence, 0.6);
  assert.equal(result.provider, "ollama");
  assert.equal(result.fallback, false);
});

test("hosted parser accepts Google candidate parts from compatible gateways", async () => {
  configureHosted();
  globalThis.fetch = (async () => jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: "QUERY_TRANSACTIONS", period: "all", transactionType: "all" }) }] } }],
  })) as typeof fetch;

  const result = await parseCommand("Could you review the ledger for me?", [], "en");
  assert.equal(result.intent.intent, "QUERY_TRANSACTIONS");
  assert.equal(result.intent.transactionType, "all");
  assert.equal(result.provider, "hosted");
  assert.equal(result.fallback, false);
});

test("correction follow-ups send prior turns and honor the latest correction", async () => {
  configureHosted();
  let userContent = "";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    userContent = body.messages.find((message) => message.role === "user")?.content ?? "";
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ intent: "QUERY_SALES", period: "last_month", confidence: 0.99 }) } }] });
  }) as typeof fetch;

  const result = await parseCommand("I meant last month", [], "en", [
    { role: "user", text: "How much were my sales this month?" },
  ]);
  assert.match(userContent, /How much were my sales this month/);
  assert.match(userContent, /Current user message:/i);
  assert.match(userContent, /I meant last month/);
  assert.doesNotMatch(userContent, /₹900/);
  assert.equal(result.intent.intent, "QUERY_SALES");
  assert.equal(result.intent.period, "last_month");
  assert.equal(result.intent.confidence, 0.6);
});

test("selected hosted provider translates product references before alias search", async () => {
  configureHosted();
  let calls = 0;
  let userContent = "";
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    userContent = body.messages.find((message) => message.role === "user")?.content ?? "";
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ translations: ["Amul Milk 500ml"] }) } }] });
  }) as typeof fetch;

  const product: Product = { id: "milk", shopId: "shop_001", name: "Amul Milk 500ml", aliases: ["milk", "amul milk", "milk pouch"], category: "Dairy", unit: "pouch", sellPrice: 30, costPrice: 25, createdAt: "", updatedAt: "" };
  const translated = await translateProductReferences(["দুধ 500ml"], [product]);
  assert.equal(calls, 1);
  assert.deepEqual(translated, ["Amul Milk 500ml"]);
  assert.match(userContent, /দুধ 500ml/);
  assert.match(userContent, /Amul Milk 500ml/);
});

test("failed LLM product translation falls back to the English dictionary", async () => {
  configureHosted();
  globalThis.fetch = (async () => jsonResponse({ error: "offline" }, 503)) as typeof fetch;
  const translated = await translateProductReferences(["দুধ"], []);
  assert.deepEqual(translated, ["milk"]);
});

test("LLM alias suggestions are normalized to English and capped at five", async () => {
  configureHosted();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ aliases: ["unknown product", "retail item", "shop goods", "inventory product", "catalog item", "extra alias", "牛奶"] }) } }] });
  }) as typeof fetch;
  const aliases = await completeProductAliases("未知商品", [], "General", "unit");
  assert.equal(calls, 1);
  assert.equal(aliases.length, 5);
  assert.ok(aliases.every((alias) => /^[a-z0-9 ]+$/i.test(alias)));
});

test("rules-only correction fragments ask instead of repeating a guessed answer", async () => {
  process.env.LLM_PROVIDER = "rules";
  const result = await parseCommand("Actually, expenses", [], "en", [
    { role: "user", text: "How much were my losses last month?" },
  ]);
  assert.equal(result.intent.intent, "UNKNOWN");
  assert.equal(result.intent.confidence, 0.25);
  assert.equal(result.provider, "rules");
  assert.equal(result.fallback, false);
});
