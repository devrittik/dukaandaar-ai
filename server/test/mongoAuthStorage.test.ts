import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "mongodb";
import { MongoAdapter } from "../src/storage/MongoAdapter.js";
import type { StoredAuthSession, StoredUserAccount } from "../src/storage/StorageAdapter.js";

function fakeAuthDb() {
  const rows = new Map<string, Map<string, Record<string, unknown>>>([
    ["users", new Map()],
    ["sessions", new Map()],
  ]);
  const db = {
    collection(name: string) {
      const collection = rows.get(name);
      if (!collection) throw new Error(`Unexpected collection ${name}`);
      return {
        insertOne: async (document: Record<string, unknown>) => {
          if (name === "users" && [...collection.values()].some((saved) => saved.email === document.email)) {
            const duplicate = new Error("duplicate key");
            Object.assign(duplicate, { code: 11000 });
            throw duplicate;
          }
          collection.set(String(document._id), structuredClone(document));
          return { acknowledged: true };
        },
        findOne: async (filter: Record<string, unknown>) => {
          const match = [...collection.values()].find((document) => Object.entries(filter).every(([key, value]) => document[key] === value));
          return match ? structuredClone(match) : null;
        },
        deleteOne: async (filter: Record<string, unknown>) => {
          const match = [...collection.entries()].find(([, document]) => Object.entries(filter).every(([key, value]) => document[key] === value));
          if (!match) return { deletedCount: 0 };
          collection.delete(match[0]);
          return { deletedCount: 1 };
        },
        deleteMany: async (filter: Record<string, unknown>) => {
          let deletedCount = 0;
          for (const [id, document] of collection) {
            if (Object.entries(filter).every(([key, value]) => document[key] === value)) {
              collection.delete(id);
              deletedCount += 1;
            }
          }
          return { deletedCount };
        },
      };
    },
  };
  return { db: db as unknown as Db };
}

function adapterForFakeDb(db: Db): MongoAdapter {
  const adapter = new MongoAdapter("mongodb://127.0.0.1:27017");
  (adapter as unknown as { db: Db }).db = db;
  return adapter;
}

test("Mongo auth storage persists normalized accounts and hashed, expiring sessions", async () => {
  const fake = fakeAuthDb();
  const adapter = adapterForFakeDb(fake.db);
  const user: StoredUserAccount = {
    id: "user_1", email: "owner@example.com", passwordHash: "salt:derived-key", ownerName: "Shop Owner", shopId: "shop_1", createdAt: "2026-10-04T00:00:00.000Z",
  };
  const session: StoredAuthSession = {
    id: "session_1", userId: user.id, tokenHash: "sha256-token-hash", createdAt: "2026-10-04T00:00:00.000Z", expiresAt: new Date(Date.now() + 60_000),
  };

  await adapter.createUser(user);
  await adapter.createAuthSession(session);
  assert.deepEqual(await adapter.findUserByEmail(user.email), user);
  assert.deepEqual(await adapter.findUserById(user.id), user);
  const savedSession = await adapter.findAuthSessionByTokenHash(session.tokenHash);
  assert.deepEqual(savedSession, session);
  assert.ok(savedSession?.expiresAt instanceof Date);

  await adapter.deleteUserById(user.id);
  assert.equal(await adapter.findUserById(user.id), null);
  assert.equal(await adapter.findAuthSessionByTokenHash(session.tokenHash), null);
});

test("Mongo auth storage maps duplicate-email index violations to a safe message", async () => {
  const adapter = adapterForFakeDb(fakeAuthDb().db);
  const account: StoredUserAccount = {
    id: "user_1", email: "same@example.com", passwordHash: "hash", ownerName: "Owner", shopId: "shop_1", createdAt: "2026-10-04T00:00:00.000Z",
  };
  await adapter.createUser(account);
  await assert.rejects(() => adapter.createUser({ ...account, id: "user_2", shopId: "shop_2" }), /Email is already registered/);
});
