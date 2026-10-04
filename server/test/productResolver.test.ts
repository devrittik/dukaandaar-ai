import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProduct } from "../src/services/productResolver.js";
import { parseWithRules } from "../src/services/ruleParser.js";
import type { Product } from "../src/types.js";

const products: Product[] = [
  {
    id: "milk-1", shopId: "shop_001", name: "Amul Milk 500ml", aliases: ["amul milk", "milk", "dairy milk", "milk pouch"],
    category: "Dairy", unit: "pouch", sellPrice: 30, costPrice: 25, createdAt: "", updatedAt: "",
  },
  {
    id: "tea-1", shopId: "shop_001", name: "Tata Tea Gold", aliases: ["tata tea", "tea", "tea leaves", "black tea"],
    category: "Beverages", unit: "packet", sellPrice: 120, costPrice: 95, createdAt: "", updatedAt: "",
  },
];

test("resolver searches English aliases after a multilingual reference is translated", () => {
  const milk = resolveProduct("দুধ 500ml", products);
  assert.equal(milk.status, "matched");
  if (milk.status === "matched") assert.equal(milk.product.id, "milk-1");

  const tea = resolveProduct("চা", products);
  assert.equal(tea.status, "matched");
  if (tea.status === "matched") assert.equal(tea.product.id, "tea-1");
});

test("rules fallback finds a catalog product from a multilingual reference using English aliases", () => {
  const result = parseWithRules("দুধ দাম কত", products, "bn");
  assert.equal(result.intent, "QUERY_PRODUCT");
  if (result.intent === "QUERY_PRODUCT") assert.equal(result.productNameRaw, "milk");
});

test("size-bearing English references outrank generic shared aliases", () => {
  const shared = [
    ...products,
    { ...products[0], id: "milk-2", name: "Cow Milk 1L", aliases: ["milk", "dairy milk", "cow milk"] },
  ];
  const resolution = resolveProduct("milk 500ml", shared);
  assert.equal(resolution.status, "matched");
  if (resolution.status === "matched") assert.equal(resolution.product.id, "milk-1");
});

test("resolver uses English alias matching and returns ambiguity for shared generic aliases", () => {
  const shared = [
    ...products,
    { ...products[0], id: "milk-2", name: "Cow Milk 1L", aliases: ["milk", "dairy milk", "cow milk"] },
  ];
  const ambiguous = resolveProduct("milk", shared);
  assert.equal(ambiguous.status, "ambiguous");
});

test("unknown non-English text is not compared directly with stored aliases", () => {
  assert.deepEqual(resolveProduct("未知商品", products), { status: "not_found" });
});
