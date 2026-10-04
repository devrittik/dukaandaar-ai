import "dotenv/config";
import { createStorage } from "../storage/index.js";
import { log, logError } from "../utils/logger.js";

async function main(): Promise<void> {
  const driver = process.env.STORAGE_DRIVER ?? "mongo";
  if (driver !== "mongo") {
    throw new Error("The seed command requires persistent MongoDB storage. Set STORAGE_DRIVER=mongo in server/.env.");
  }
  const storage = createStorage();
  try {
    log("seed", "connecting...");
    await storage.connect();
    log("seed", "resetting and inserting demo shop, products, inventory, and ledger fixtures...");
    await storage.seed();
    log("seed", "done");
  } finally {
    await storage.disconnect();
  }
}

main().catch((error) => {
  logError("seed", "failed", error);
  process.exit(1);
});
