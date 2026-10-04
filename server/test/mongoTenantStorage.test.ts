import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db, MongoClient } from "mongodb";
import { MongoAdapter } from "../src/storage/MongoAdapter.js";
import { shopDatabaseName } from "../src/storage/tenantDatabase.js";

type Row = Record<string, any>;

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => row[key] === value);
}

function fakeDatabase() {
  const collections = new Map<string, Map<string, Row>>();
  const indexCalls: string[] = [];
  const db = {
    collection(name: string) {
      let rows = collections.get(name);
      if (!rows) {
        rows = new Map();
        collections.set(name, rows);
      }
      const collectionRows = rows;
      let cursor: any;
      cursor = {
        sort: () => cursor,
        toArray: async () => [...collectionRows.values()].map((row) => structuredClone(row)),
      };
      return {
        createIndex: async () => { indexCalls.push(name); return `${name}_index`; },
        deleteMany: async (filter: Row) => {
          let deletedCount = 0;
          for (const [id, row] of collectionRows) {
            if (matches(row, filter)) {
              collectionRows.delete(id);
              deletedCount += 1;
            }
          }
          return { deletedCount };
        },
        insertOne: async (row: Row) => { collectionRows.set(String(row._id), structuredClone(row)); return { acknowledged: true }; },
        insertMany: async (documents: Row[]) => {
          for (const row of documents) collectionRows.set(String(row._id), structuredClone(row));
          return { acknowledged: true, insertedCount: documents.length };
        },
        findOne: async (filter: Row) => {
          const result = [...collectionRows.values()].find((row) => matches(row, filter));
          return result ? structuredClone(result) : null;
        },
        find: (filter: Row) => {
          cursor = {
            sort: () => cursor,
            toArray: async () => [...collectionRows.values()].filter((row) => matches(row, filter)).map((row) => structuredClone(row)),
          };
          return cursor;
        },
        replaceOne: async (filter: Row, replacement: Row, options: Row = {}) => {
          const existing = [...collectionRows.entries()].find(([, row]) => matches(row, filter));
          if (existing) {
            collectionRows.set(existing[0], structuredClone(replacement));
            return { matchedCount: 1, upsertedCount: 0 };
          }
          if (options.upsert) {
            collectionRows.set(String(replacement._id), structuredClone(replacement));
            return { matchedCount: 0, upsertedCount: 1 };
          }
          return { matchedCount: 0, upsertedCount: 0 };
        },
        countDocuments: async (filter: Row) => [...collectionRows.values()].filter((row) => matches(row, filter)).length,
      };
    },
  };
  return { db: db as unknown as Db, collections, indexCalls };
}

function adapterWithDatabases(prefix: string, databases: Map<string, ReturnType<typeof fakeDatabase>>, controlDb = fakeDatabase().db) {
  const adapter = new MongoAdapter("mongodb://unused", "control", prefix);
  const client = {
    db(name: string) {
      const database = databases.get(name);
      if (!database) throw new Error(`Unexpected database ${name}`);
      return database.db;
    },
  };
  const internals = adapter as unknown as { db: Db; client: MongoClient };
  internals.db = controlDb;
  internals.client = client as unknown as MongoClient;
  return adapter;
}

test("each shop resolves to a separate Mongo database and initializes its own indexes", async () => {
  const prefix = "tenant_";
  const alpha = fakeDatabase();
  const beta = fakeDatabase();
  const databases = new Map([
    [shopDatabaseName("shop_alpha", prefix), alpha],
    [shopDatabaseName("shop_beta", prefix), beta],
  ]);
  const adapter = adapterWithDatabases(prefix, databases);

  await adapter.getSettings("shop_alpha");
  await adapter.getSettings("shop_beta");
  await adapter.getSettings("shop_alpha");
  assert.equal(alpha.indexCalls.length, 7);
  assert.equal(beta.indexCalls.length, 7);
});

test("targeted seed writes demo records only to the named shop database", async () => {
  const prefix = "tenant_";
  const alpha = fakeDatabase();
  const beta = fakeDatabase();
  const databases = new Map([
    [shopDatabaseName("shop_alpha", prefix), alpha],
    [shopDatabaseName("shop_beta", prefix), beta],
  ]);
  const adapter = adapterWithDatabases(prefix, databases);

  await adapter.seed("shop_alpha");
  const products = alpha.collections.get("products");
  assert.equal(products?.size, 8);
  assert.ok([...products!.values()].every((product) => product.shopId === "shop_alpha"));
  assert.equal(beta.collections.size, 0);
  assert.equal(alpha.collections.get("settings")?.get("shop_alpha")?.shopId, "shop_alpha");
});

test("account migration moves only registered-shop records and leaves the legacy shop untouched", async () => {
  const prefix = "tenant_";
  const alpha = fakeDatabase();
  const databases = new Map([[shopDatabaseName("shop_alpha", prefix), alpha]]);
  const control = fakeDatabase();
  await control.db.collection("users").insertOne({ _id: "user_alpha", id: "user_alpha", shopId: "shop_alpha" });
  await control.db.collection("products").insertOne({ _id: "prod_old", id: "prod_old", shopId: "shop_alpha", name: "Old account product" });
  await control.db.collection("products").insertOne({ _id: "prod_legacy", id: "prod_legacy", shopId: "shop_001", name: "Legacy fixture product" });
  const adapter = adapterWithDatabases(prefix, databases, control.db);

  const moved = await adapter.migrateAccountShopData("shop_alpha");
  assert.equal(moved.products, 1);
  assert.equal(alpha.collections.get("products")?.get("prod_old")?.name, "Old account product");
  assert.equal(control.collections.get("products")?.has("prod_old"), false);
  assert.equal(control.collections.get("products")?.get("prod_legacy")?.name, "Legacy fixture product");
  await assert.rejects(adapter.migrateAccountShopData("shop_001"), /Refusing to migrate the legacy SHOP_ID/u);
});
