import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSeedShopId } from "../src/scripts/seedArgs.js";
import { shopDatabaseName, validateShopId } from "../src/storage/tenantDatabase.js";

test("seed requires a specific shop ID and accepts both CLI forms", () => {
  assert.equal(parseSeedShopId(["--shop-id", "shop_001"]), "shop_001");
  assert.equal(parseSeedShopId(["--shop-id=shop_abc-123"]), "shop_abc-123");
  assert.throws(() => parseSeedShopId([]), /A single --shop-id/u);
  assert.throws(() => parseSeedShopId(["--shop-id", "one", "--shop-id", "two"]), /A single --shop-id/u);
  assert.throws(() => parseSeedShopId(["shop_001"]), /Unknown argument/u);
});

test("shop database names are distinct and reject database-name injection", () => {
  assert.equal(shopDatabaseName("shop_001", "test_shop_"), "test_shop_shop_001");
  assert.notEqual(shopDatabaseName("shop_001", "tenant_"), shopDatabaseName("shop_002", "tenant_"));
  assert.throws(() => validateShopId("../admin"), /shop_id must be/u);
  assert.throws(() => shopDatabaseName("shop_001", "bad.prefix"), /MONGODB_SHOP_DB_PREFIX/u);
  assert.throws(() => shopDatabaseName("a".repeat(47), "x".repeat(17)), /63-character limit/u);
});
