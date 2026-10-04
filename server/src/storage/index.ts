import { InMemoryAdapter } from "./InMemoryAdapter.js";
import { MongoAdapter } from "./MongoAdapter.js";
import type { StorageAdapter } from "./StorageAdapter.js";
import { log } from "../utils/logger.js";
import { DEFAULT_SHOP_DATABASE_PREFIX } from "./tenantDatabase.js";

export function createStorage(): StorageAdapter {
  const driver = process.env.STORAGE_DRIVER ?? "mongo";
  log("storage", `initializing driver=\"${driver}\"`);
  if (driver === "mongo") {
    const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/";
    return new MongoAdapter(
      uri,
      process.env.MONGODB_DB ?? "dukaandaar",
      process.env.MONGODB_SHOP_DB_PREFIX ?? DEFAULT_SHOP_DATABASE_PREFIX,
    );
  }
  if (driver !== "memory") throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
  return new InMemoryAdapter();
}
