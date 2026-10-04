import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEnglishProductAliases, isEnglishProductSearchText, translateProductReferenceToEnglish } from "../src/services/productAliases.js";

test("product references are deterministically translated to English as an LLM fallback", () => {
  assert.equal(translateProductReferenceToEnglish("দুধ 500ml"), "milk 500ml");
  assert.equal(translateProductReferenceToEnglish("চা পাতা"), "tea leaves");
  assert.equal(translateProductReferenceToEnglish("leche"), "milk");
  assert.equal(translateProductReferenceToEnglish("牛奶多少钱"), "milk");
  assert.equal(translateProductReferenceToEnglish("Amul Milk 500ml"), "amul milk 500ml");
});

test("new products receive four or five distinct English aliases", () => {
  for (const [name, aliases, category, unit] of [
    ["Amul Milk 500ml", [], "Dairy", "pouch"],
    ["Maggi Noodles", ["maggi", "instant noodles"], "Snacks", "packet"],
    ["চা", [], "Beverages", "packet"],
    ["未知商品", ["牛奶"], "General", "unit"],
  ] as Array<[string, string[], string, string]>) {
    const generated = buildEnglishProductAliases(name, aliases, category, unit);
    assert.ok(generated.length >= 4 && generated.length <= 5, `${name} generated ${generated.length} aliases`);
    assert.equal(new Set(generated.map((alias) => alias.toLocaleLowerCase())).size, generated.length);
    assert.ok(generated.every(isEnglishProductSearchText), `${name} has a non-English alias: ${generated.join(", ")}`);
  }
});

test("non-English product names include their English translation as an alias", () => {
  const aliases = buildEnglishProductAliases("চা পাতা", [], "Beverages", "packet");
  assert.ok(aliases.includes("tea leaves"));
  assert.ok(aliases.every(isEnglishProductSearchText));
});

test("non-English user-supplied alias values are never retained", () => {
  const aliases = buildEnglishProductAliases("Milk 500ml", ["দুধ", "leche", "milk pouch", "乳"]);
  assert.ok(aliases.every(isEnglishProductSearchText));
  assert.ok(aliases.includes("milk pouch"));
  assert.ok(!aliases.some((alias) => /\p{Script=Han}|\p{Script=Bengali}/u.test(alias)));
});
