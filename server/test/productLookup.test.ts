import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { BusinessLogic } from "../src/services/businessLogic.js";
import { InMemoryAdapter } from "../src/storage/InMemoryAdapter.js";

const envKeys = ["SHOP_ID", "LLM_PROVIDER", "HOSTED_LLM_API_KEY", "HOSTED_LLM_BASE_URL", "HOSTED_LLM_MODEL"] as const;
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

function configureHosted(): void {
  process.env.SHOP_ID = "shop_001";
  process.env.LLM_PROVIDER = "hosted";
  process.env.HOSTED_LLM_API_KEY = "test-key";
  process.env.HOSTED_LLM_BASE_URL = "https://mock.example/v1/chat/completions";
  process.env.HOSTED_LLM_MODEL = "test-model";
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function llmResponse(value: unknown): Response {
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(value) } }] });
}

test("assistant translates a foreign product reference with the LLM before catalog lookup", async () => {
  configureHosted();
  const storage = new InMemoryAdapter();
  await storage.connect();
  await storage.seed();
  const requests: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")?.content ?? "";
    requests.push(system);
    if (system.includes("Translate each product reference")) {
      return llmResponse({ translations: ["Amul Milk 500ml"] });
    }
    return llmResponse({ intent: "QUERY_PRODUCT", responseLanguage: "bn", confidence: 0.5, productNameRaw: "দুধ 500ml" });
  }) as typeof fetch;

  const result = await new BusinessLogic(storage).parseTranscript("দুধ 500ml এর দাম কত?", "text", "bn");
  assert.equal(result.mode, "answer");
  assert.equal(result.provider, "hosted");
  assert.equal(result.fallback, false);
  assert.match(result.message, /Amul Milk 500ml/);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /Translate each product reference/);
});

test("chat/voice product creation generates and stores only English aliases", async () => {
  configureHosted();
  const storage = new InMemoryAdapter();
  await storage.connect();
  await storage.seed();
  const requests: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    const system = body.messages.find((message) => message.role === "system")?.content ?? "";
    requests.push(system);
    if (system.includes("Translate each product reference")) return llmResponse({ translations: ["soap"] });
    if (system.includes("Generate 4–5 short")) return llmResponse({ aliases: ["soap", "bath soap", "soap bar", "hand soap", "bathing soap"] });
    return llmResponse({
      intent: "CREATE_PRODUCT", responseLanguage: "bn", confidence: 0.5,
      name: "সাবান", aliases: [], category: "Personal care", unit: "bar",
      sellPrice: 25, costPrice: 16, openingStock: 3, purchaseUnitCost: 14, supplier: "Ravi", lowStockThreshold: 5,
    });
  }) as typeof fetch;

  const assistant = new BusinessLogic(storage);
  const preview = await assistant.parseTranscript("নতুন সাবান যোগ করো", "voice", "bn");
  assert.equal(preview.mode, "confirmation");
  assert.ok(preview.pendingId);
  assert.equal(preview.provider, "hosted");
  assert.match(preview.preview?.stockEffect ?? "", /কেনাকাটার ইতিহাস/u);
  const previewAliases = preview.preview?.editData?.aliases as string[];
  assert.equal(previewAliases.length, 5);
  assert.ok(previewAliases.every((alias) => /^[a-z0-9 ]+$/i.test(alias)));

  const savedMessage = await assistant.confirm(preview.pendingId!);
  assert.match(savedMessage.message, /কেনাকাটা নথিভুক্ত/u);
  const saved = (await storage.listProducts("shop_001")).find((product) => product.name === "সাবান");
  assert.ok(saved);
  assert.equal(saved!.aliases.length, 5);
  assert.ok(saved!.aliases.includes("soap"));
  assert.ok(saved!.aliases.every((alias) => /^[a-z0-9 ]+$/i.test(alias)));
  const stock = await storage.getInventory("shop_001", saved!.id);
  assert.equal(stock?.quantityOnHand, 3);
  const purchases = await storage.queryPurchases("shop_001", { productId: saved!.id });
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].items[0].qty, 3);
  assert.equal(purchases[0].items[0].unitCost, 14);
  assert.equal(purchases[0].items[0].lineTotal, 42);
  assert.equal(purchases[0].supplier, "Ravi");
  assert.equal(purchases[0].source, "voice");
  assert.equal(requests.length, 3);
});

test("zero-opening-stock assistant creation adds only the product catalog entry", async () => {
  process.env.SHOP_ID = "shop_001";
  process.env.LLM_PROVIDER = "rules";
  const storage = new InMemoryAdapter();
  await storage.connect();
  await storage.seed();
  const assistant = new BusinessLogic(storage);

  const preview = await assistant.parseTranscript("Add product Zero Soap, selling price 25, cost price 16, opening stock 0", "text", "en");
  assert.equal(preview.mode, "confirmation");
  assert.equal(preview.preview?.kind, "product");
  assert.equal(preview.preview?.total, 0);
  assert.doesNotMatch(preview.preview?.lines.map((line) => `${line.label} ${line.detail}`).join(" ") ?? "", /review purchase/i);
  assert.match(preview.preview?.note ?? "", /no purchase will be recorded/i);
  const savedMessage = await assistant.confirm(preview.pendingId!);
  assert.match(savedMessage.message, /added to your catalog/i);
  const saved = (await storage.listProducts("shop_001")).find((product) => product.name === "Zero Soap");
  assert.ok(saved);
  assert.equal((await storage.getInventory("shop_001", saved!.id))?.quantityOnHand, 0);
  assert.equal((await storage.queryPurchases("shop_001", { productId: saved!.id })).length, 0);
});

test("compact new-product price and quantity shorthand records a 40-unit purchase at cost", async () => {
  process.env.SHOP_ID = "shop_001";
  process.env.LLM_PROVIDER = "rules";
  const storage = new InMemoryAdapter();
  await storage.connect();
  await storage.seed();
  const assistant = new BusinessLogic(storage);

  const preview = await assistant.parseTranscript("new product X @10 cost, @20 sell, 40 pieces purchased", "text", "en");
  assert.equal(preview.mode, "confirmation");
  assert.match(preview.preview?.stockEffect ?? "", /purchase history/i);
  const savedMessage = await assistant.confirm(preview.pendingId!);
  assert.match(savedMessage.message, /Purchase recorded/i);
  const product = (await storage.listProducts("shop_001")).find((item) => item.name === "X");
  assert.ok(product);
  assert.equal(product!.costPrice, 10);
  assert.equal(product!.sellPrice, 20);
  assert.equal(product!.unit, "piece");
  assert.equal((await storage.getInventory("shop_001", product!.id))?.quantityOnHand, 40);
  const purchases = await storage.queryPurchases("shop_001", { productId: product!.id });
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].items[0].qty, 40);
  assert.equal(purchases[0].items[0].unitCost, 10);
  assert.equal(purchases[0].totalAmount, 400);
});
