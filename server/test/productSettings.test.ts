import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildSeedData } from "../src/seedData.js";
import { BusinessLogic } from "../src/services/businessLogic.js";
import { parseWithRules } from "../src/services/ruleParser.js";
import { getDashboard } from "../src/services/analyticsService.js";
import { InMemoryAdapter } from "../src/storage/InMemoryAdapter.js";

const originalShopId = process.env.SHOP_ID;
const originalProvider = process.env.LLM_PROVIDER;

afterEach(() => {
  if (originalShopId === undefined) delete process.env.SHOP_ID;
  else process.env.SHOP_ID = originalShopId;
  if (originalProvider === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = originalProvider;
});

test("rule parser extracts editable product details and keeps on-hand quantity transaction-controlled", () => {
  const product = buildSeedData("shop_001").products.find((item) => item.id === "prod_maggi")!;
  const products = [product];
  const update = parseWithRules("change Maggi sell price to 20 and stock alert to 5", products, "en");
  assert.equal(update.intent, "UPDATE_PRODUCT");
  if (update.intent !== "UPDATE_PRODUCT") return;
  assert.equal(update.sellPrice, 20);
  assert.equal(update.lowStockThreshold, 5);
  assert.equal(update.productNameRaw.toLowerCase(), "maggi");

  const stockEdit = parseWithRules("set Maggi stock to 8", products, "en");
  assert.equal(stockEdit.intent, "UNKNOWN");
  if (stockEdit.intent === "UNKNOWN") assert.match(stockEdit.clarification ?? "", /sales, purchases, or losses/i);
});

test("rule parser treats positive quantity for a new product as an initial purchase", () => {
  const parsed = parseWithRules("I bought 4 new product Soap, selling price 25, cost price 16, from Ravi at ₹14 each", [], "en");
  assert.equal(parsed.intent, "CREATE_PRODUCT");
  if (parsed.intent !== "CREATE_PRODUCT") return;
  assert.equal(parsed.name, "Soap");
  assert.equal(parsed.openingStock, 4);
  assert.equal(parsed.purchaseUnitCost, 14);
  assert.equal(parsed.supplier, "Ravi");

  const spokenStyle = parseWithRules("new product Y at 10 cost, at 20 sell, 40 pieces purchased", [], "en");
  assert.equal(spokenStyle.intent, "CREATE_PRODUCT");
  if (spokenStyle.intent !== "CREATE_PRODUCT") return;
  assert.equal(spokenStyle.name, "Y");
  assert.equal(spokenStyle.costPrice, 10);
  assert.equal(spokenStyle.sellPrice, 20);
  assert.equal(spokenStyle.openingStock, 40);
});

test("confirmed assistant product edits update catalog and alert threshold without changing stock", async () => {
  process.env.SHOP_ID = "shop_001";
  process.env.LLM_PROVIDER = "rules";
  const storage = new InMemoryAdapter();
  await storage.connect();
  await storage.seed("shop_001");
  const product = (await storage.listProducts("shop_001")).find((item) => item.id === "prod_maggi")!;
  const before = await storage.getInventory("shop_001", product.id);
  const assistant = new BusinessLogic(storage);

  const preview = await assistant.parseTranscript("change Maggi sell price to 21 and stock alert to 6", "text", "en");
  assert.equal(preview.mode, "confirmation");
  assert.ok(preview.pendingId);
  assert.equal(preview.preview?.kind, "product");
  assert.match(preview.preview?.note ?? "", /on-hand stock will not change/i);

  const saved = await assistant.confirm(preview.pendingId!);
  assert.match(saved.message, /updated/i);
  const updatedProducts = await storage.listProducts("shop_001");
  const updatedProduct = updatedProducts.find((item) => item.id === product.id)!;
  const after = await storage.getInventory("shop_001", product.id);
  assert.equal(updatedProduct.sellPrice, 21);
  assert.equal(after?.lowStockThreshold, 6);
  assert.equal(after?.quantityOnHand, before?.quantityOnHand);
});

test("manual product creation stores English-only generated aliases", async () => {
  process.env.SHOP_ID = "shop_001";
  process.env.LLM_PROVIDER = "rules";
  const storage = new InMemoryAdapter();
  await storage.connect();
  await storage.seed("shop_001");
  const assistant = new BusinessLogic(storage);

  const result = await assistant.recordManual("product", {
    name: "সাবান", aliases: ["সাবান"], category: "Personal care", unit: "bar",
    sellPrice: 25, costPrice: 16, openingStock: 3, lowStockThreshold: 5, supplier: "Ravi",
  });
  assert.match(result.message, /Initial purchase recorded/i);

  const saved = (await storage.listProducts("shop_001")).find((product) => product.name === "সাবান");
  assert.ok(saved);
  assert.ok(saved!.aliases.length >= 4 && saved!.aliases.length <= 5);
  assert.ok(saved!.aliases.includes("soap"));
  assert.ok(saved!.aliases.every((alias) => /^[a-z0-9 ]+$/i.test(alias)));
  assert.equal((await storage.getInventory("shop_001", saved!.id))?.quantityOnHand, 3);
  const purchases = await storage.queryPurchases("shop_001", { productId: saved!.id });
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].items[0].unitCost, 16);
  assert.equal(purchases[0].supplier, "Ravi");
});

test("manual zero-stock product creation skips purchase history", async () => {
  process.env.SHOP_ID = "shop_001";
  process.env.LLM_PROVIDER = "rules";
  const storage = new InMemoryAdapter();
  await storage.connect();
  await storage.seed("shop_001");
  const assistant = new BusinessLogic(storage);

  const result = await assistant.recordManual("product", {
    name: "Catalog Only Soap", aliases: [], category: "Personal care", unit: "bar",
    sellPrice: 25, costPrice: 16, openingStock: 0, lowStockThreshold: 5,
  });
  assert.match(result.message, /no purchase was recorded/i);
  const saved = (await storage.listProducts("shop_001")).find((product) => product.name === "Catalog Only Soap");
  assert.ok(saved);
  assert.equal((await storage.getInventory("shop_001", saved!.id))?.quantityOnHand, 0);
  assert.equal((await storage.queryPurchases("shop_001", { productId: saved!.id })).length, 0);
});

test("shop profile settings update and flow into dashboard data", async () => {
  const storage = new InMemoryAdapter();
  await storage.connect();
  await storage.seed("shop_001");
  const updated = await storage.updateSettings("shop_001", {
    shopName: "Kolkata Corner Shop",
    ownerName: "Asha Das",
    phone: "9876543210",
    address: "North Kolkata",
    lowStockDefaultThreshold: 7,
  });
  assert.equal(updated.shopName, "Kolkata Corner Shop");
  assert.equal(updated.ownerName, "Asha Das");
  assert.equal(updated.lowStockDefaultThreshold, 7);

  const dashboard = await getDashboard(storage, "shop_001");
  assert.equal(dashboard.shop.name, "Kolkata Corner Shop");
  assert.equal(dashboard.shop.ownerName, "Asha Das");
  assert.equal(dashboard.shop.lowStockDefaultThreshold, 7);
});
