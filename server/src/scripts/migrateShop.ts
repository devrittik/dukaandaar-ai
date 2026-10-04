import "dotenv/config";
import { validateStorageConfiguration } from "../config/runtimeConfig.js";
import { createStorage } from "../storage/index.js";
import { MongoAdapter } from "../storage/MongoAdapter.js";
import { parseShopIdArgument } from "./seedArgs.js";
import { log, logError } from "../utils/logger.js";

async function main(): Promise<void> {
  const shopId = parseShopIdArgument(process.argv.slice(2), "migrate:shop");
  const environment = validateStorageConfiguration();
  process.env.NODE_ENV = environment;
  if ((process.env.STORAGE_DRIVER ?? "mongo") !== "mongo") {
    throw new Error("The shop migration requires persistent MongoDB storage.");
  }

  const storage = createStorage();
  if (!(storage instanceof MongoAdapter)) throw new Error("The configured storage adapter does not support Mongo shop migration.");
  try {
    log("migrate:shop", "connecting; stop the API before migrating to avoid concurrent writes", { shopId });
    await storage.connect();
    const moved = await storage.migrateAccountShopData(shopId);
    log("migrate:shop", "done", { shopId, moved });
  } finally {
    await storage.disconnect();
  }
}

main().catch((error) => {
  logError("migrate:shop", "failed", error);
  process.exit(1);
});
