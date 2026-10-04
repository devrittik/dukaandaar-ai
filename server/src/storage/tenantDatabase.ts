export const DEFAULT_SHOP_DATABASE_PREFIX = "dukaandaar_";
const SAFE_SHOP_ID = /^[A-Za-z0-9_-]+$/u;
const SAFE_DATABASE_PREFIX = /^[A-Za-z0-9_-]+$/u;
const MAX_MONGO_DATABASE_NAME_LENGTH = 63;

export function validateShopId(shopId: string): string {
  const normalized = shopId.trim();
  if (!normalized || normalized.length > 47 || !SAFE_SHOP_ID.test(normalized)) {
    throw new Error("shop_id must be 1–47 letters, numbers, underscores, or hyphens.");
  }
  return normalized;
}

export function shopDatabaseName(shopId: string, prefix = process.env.MONGODB_SHOP_DB_PREFIX ?? DEFAULT_SHOP_DATABASE_PREFIX): string {
  const normalizedId = validateShopId(shopId);
  const normalizedPrefix = prefix.trim();
  if (!normalizedPrefix || !SAFE_DATABASE_PREFIX.test(normalizedPrefix)) {
    throw new Error("MONGODB_SHOP_DB_PREFIX must contain only letters, numbers, underscores, or hyphens.");
  }
  const databaseName = `${normalizedPrefix}${normalizedId}`;
  if (databaseName.length > MAX_MONGO_DATABASE_NAME_LENGTH) {
    throw new Error(`The shop database name exceeds MongoDB's ${MAX_MONGO_DATABASE_NAME_LENGTH}-character limit.`);
  }
  return databaseName;
}
