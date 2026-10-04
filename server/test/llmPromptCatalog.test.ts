import assert from "node:assert/strict";
import { test } from "node:test";
import type { Product } from "../src/types.js";
import { parseCommand } from "../src/services/llmProvider.js";

const keys = ["LLM_PROVIDER", "HOSTED_LLM_API_KEY", "HOSTED_LLM_BASE_URL", "HOSTED_LLM_MODEL"] as const;
const originalEnv = new Map(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("prompt includes only product names relevant to the current conversation", async () => {
  process.env.LLM_PROVIDER = "hosted";
  process.env.HOSTED_LLM_API_KEY = "test-key";
  process.env.HOSTED_LLM_BASE_URL = "https://mock.example/v1/chat/completions";
  let prompt = "";
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    prompt = body.messages.find((message) => message.role === "system")?.content ?? "";
    return jsonResponse({ choices: [{ message: { content: JSON.stringify({ intent: "QUERY_PRODUCT", productNameRaw: "Maggi Noodles", responseLanguage: "en", confidence: 0.5 }) } }] });
  }) as typeof fetch;

  const product = (id: string, name: string, aliases: string[]): Product => ({
    id, shopId: "shop_001", name, aliases, category: "General", unit: "packet", sellPrice: 15, costPrice: 10,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  try {
    const result = await parseCommand("What is the price of Maggi?", [product("p1", "Maggi Noodles", ["Maggi"]), product("p2", "Basmati Rice", ["Rice"])], "en");
    const catalogStart = prompt.indexOf("\nCATALOG ");
    assert.notEqual(catalogStart, -1);
    const catalog = prompt.slice(catalogStart);
    assert.match(catalog, /\[\["Maggi Noodles","Maggi"\]\]/);
    assert.doesNotMatch(catalog, /Basmati Rice|"Rice"/);
    assert.equal(result.intent.intent, "QUERY_PRODUCT");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
