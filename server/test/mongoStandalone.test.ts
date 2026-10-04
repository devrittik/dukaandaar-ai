import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "mongodb";
import { MongoAdapter } from "../src/storage/MongoAdapter.js";
import type { NewProduct, NewProductPurchase, NewSale } from "../src/types.js";

function fakeStandaloneDb({ failSaleInsert = false } = {}) {
  const inventoryRows = new Map<string, { shopId: string; productId: string; quantityOnHand: number }>([
    ["p1", { shopId: "shop_001", productId: "p1", quantityOnHand: 7 }],
  ]);
  const salesRows = new Map<string, Record<string, unknown>>();
  const db = {
    collection(name: string) {
      if (name === "inventory") return {
        updateOne: async (filter: Record<string, any>, update: Record<string, any>) => {
          const row = inventoryRows.get(filter.productId);
          if (!row || row.shopId !== filter.shopId) return { matchedCount: 0 };
          const minimum = filter.quantityOnHand?.$gte;
          if (typeof minimum === "number" && row.quantityOnHand < minimum) return { matchedCount: 0 };
          row.quantityOnHand += update.$inc?.quantityOnHand ?? 0;
          return { matchedCount: 1 };
        },
      };
      if (name === "sales") return {
        insertOne: async (record: Record<string, unknown>) => {
          if (failSaleInsert) throw new Error("simulated ledger insert failure");
          salesRows.set(String(record.id), record);
          return { acknowledged: true };
        },
        deleteOne: async (filter: Record<string, unknown>) => {
          const existed = salesRows.delete(String(filter.id));
          return { deletedCount: existed ? 1 : 0 };
        },
      };
      throw new Error(`Unexpected collection ${name}`);
    },
  };
  return { db: db as unknown as Db, inventoryRows, salesRows };
}

function adapterForStandalone(db: Db): MongoAdapter {
  const adapter = new MongoAdapter("mongodb://127.0.0.1:27017");
  const internals = adapter as unknown as { db: Db; shopDbs: Map<string, Db>; transactionsSupported: boolean };
  internals.db = db;
  internals.shopDbs.set("shop_001", db);
  internals.transactionsSupported = false;
  return adapter;
}

function fakeStandaloneProductDb({ failPurchaseInsert = false } = {}) {
  const products = new Map<string, Record<string, any>>();
  const inventory = new Map<string, Record<string, any>>();
  const purchases = new Map<string, Record<string, any>>();
  const db = {
    collection(name: string) {
      const rows = name === "products" ? products : name === "inventory" ? inventory : name === "purchases" ? purchases : null;
      if (!rows) throw new Error(`Unexpected collection ${name}`);
      return {
        insertOne: async (record: Record<string, any>) => {
          if (name === "purchases" && failPurchaseInsert) throw new Error("simulated initial purchase insert failure");
          const key = String(name === "inventory" ? record.productId : record.id);
          rows.set(key, record);
          return { acknowledged: true };
        },
        updateOne: async (filter: Record<string, any>, update: Record<string, any>) => {
          const row = rows.get(String(filter.productId));
          if (name !== "inventory" || !row || row.shopId !== filter.shopId) return { matchedCount: 0 };
          if (filter.quantityOnHand !== undefined && row.quantityOnHand !== filter.quantityOnHand) return { matchedCount: 0 };
          row.quantityOnHand += update.$inc?.quantityOnHand ?? 0;
          Object.assign(row, update.$set ?? {});
          return { matchedCount: 1 };
        },
        deleteOne: async (filter: Record<string, any>) => {
          const key = String(name === "inventory" ? filter.productId : filter.id);
          const deleted = rows.delete(key);
          return { deletedCount: deleted ? 1 : 0 };
        },
      };
    },
  };
  return { db: db as unknown as Db, products, inventory, purchases };
}

const sale: NewSale = {
  shopId: "shop_001",
  timestamp: "2026-10-04T10:00:00.000Z",
  items: [{ productId: "p1", productName: "Test item", qty: 2, unitPrice: 10, unitCost: 6, lineTotal: 20 }],
  totalAmount: 20,
  paymentMethod: "cash",
  source: "manual",
  confirmedByUser: true,
};

test("standalone Mongo fallback records a sale without opening a transaction", async () => {
  const fake = fakeStandaloneDb();
  const adapter = adapterForStandalone(fake.db);
  const saved = await adapter.createSale(sale);
  assert.equal(saved.totalAmount, 20);
  assert.equal(fake.inventoryRows.get("p1")?.quantityOnHand, 5);
  assert.equal(fake.salesRows.size, 1);
});

test("standalone Mongo fallback compensates stock if the ledger insert fails", async () => {
  const fake = fakeStandaloneDb({ failSaleInsert: true });
  const adapter = adapterForStandalone(fake.db);
  await assert.rejects(adapter.createSale(sale), /simulated ledger insert failure/);
  assert.equal(fake.inventoryRows.get("p1")?.quantityOnHand, 7);
  assert.equal(fake.salesRows.size, 0);
});

test("standalone Mongo creates a product and initial purchase with stock applied exactly once", async () => {
  const fake = fakeStandaloneProductDb();
  const adapter = adapterForStandalone(fake.db);
  const product: NewProduct = {
    shopId: "shop_001", name: "Soap", aliases: ["soap"], category: "Personal care", unit: "bar",
    sellPrice: 25, costPrice: 16, openingStock: 4, lowStockThreshold: 5,
  };
  const purchase: NewProductPurchase = {
    shopId: "shop_001", timestamp: "2026-10-04T10:00:00.000Z", qty: 4, unitCost: 14,
    supplier: "Ravi", source: "manual", confirmedByUser: true,
  };

  const saved = await adapter.createProductWithInitialPurchase(product, purchase);
  const stock = fake.inventory.get(saved.product.id);
  assert.equal(stock?.quantityOnHand, 4);
  assert.equal(fake.products.size, 1);
  assert.equal(fake.purchases.size, 1);
  const ledger = [...fake.purchases.values()][0];
  assert.equal(ledger.totalAmount, 56);
  assert.equal(ledger.items[0].qty, 4);
  assert.equal(ledger.items[0].unitCost, 14);
  assert.equal(ledger.supplier, "Ravi");
});

test("standalone Mongo rolls back product and stock when its initial purchase write fails", async () => {
  const fake = fakeStandaloneProductDb({ failPurchaseInsert: true });
  const adapter = adapterForStandalone(fake.db);
  const product: NewProduct = {
    shopId: "shop_001", name: "Soap", aliases: ["soap"], category: "Personal care", unit: "bar",
    sellPrice: 25, costPrice: 16, openingStock: 4, lowStockThreshold: 5,
  };
  const purchase: NewProductPurchase = {
    shopId: "shop_001", timestamp: "2026-10-04T10:00:00.000Z", qty: 4, unitCost: 14,
    supplier: "Ravi", source: "manual", confirmedByUser: true,
  };

  await assert.rejects(adapter.createProductWithInitialPurchase(product, purchase), /simulated initial purchase insert failure/);
  assert.equal(fake.products.size, 0);
  assert.equal(fake.inventory.size, 0);
  assert.equal(fake.purchases.size, 0);
});
