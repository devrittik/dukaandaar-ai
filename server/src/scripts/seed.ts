import "dotenv/config";
import { validateStorageConfiguration } from "../config/runtimeConfig.js";
import { createStorage } from "../storage/index.js";
import { parseSeedShopId } from "./seedArgs.js";
import { log, logError } from "../utils/logger.js";

async function main(): Promise<void> {
  const shopId = parseSeedShopId(process.argv.slice(2));
  const environment = validateStorageConfiguration();
  process.env.NODE_ENV = environment;
  const driver = process.env.STORAGE_DRIVER ?? "mongo";
  if (driver !== "mongo") {
    throw new Error("The seed command requires persistent MongoDB storage. Set STORAGE_DRIVER=mongo in server/.env.");
  }

  const storage = createStorage();
  try {
    log("seed", "connecting...");
    await storage.connect();
    log("seed", "resetting and inserting demo records for the requested shop", { shopId });
    await storage.seed(shopId);
    log("seed", "done", { shopId });
  } finally {
    await storage.disconnect();
  }
}

main().catch((error) => {
  logError("seed", "failed", error);
  process.exit(1);
});
