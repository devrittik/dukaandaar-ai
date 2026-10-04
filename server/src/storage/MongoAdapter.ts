import { randomUUID } from "node:crypto";
import { MongoClient, type ClientSession, type Db } from "mongodb";
import { buildSeedData } from "../seedData.js";
import { buildEnglishProductAliases, isEnglishProductSearchText, translateProductReferenceToEnglish } from "../services/productAliases.js";
import { log, logWarn } from "../utils/logger.js";
import type {
  Expense,
  Inventory,
  Loss,
  NewExpense,
  NewLoss,
  NewProduct,
  NewProductPurchase,
  NewPurchase,
  NewSale,
  Product,
  ProductUpdate,
  Purchase,
  Sale,
  Settings,
  SettingsUpdate,
  TimeFilter,
} from "../types.js";
import type { StorageAdapter } from "./StorageAdapter.js";

type Doc = { _id?: string; [key: string]: any };

function withoutMongoId<T>(doc: Doc): T {
  const { _id: _ignored, ...rest } = doc;
  return rest as T;
}

function timeQuery(filter: TimeFilter): Doc {
  const query: Doc = {};
  if (filter.from || filter.to) {
    query.timestamp = {};
    if (filter.from) query.timestamp.$gte = filter.from;
    if (filter.to) query.timestamp.$lt = filter.to;
  }
  if (filter.productId) query["items.productId"] = filter.productId;
  return query;
}

function isStandaloneTransactionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Transaction numbers are only allowed on a replica set member or mongos/i.test(message);
}

export class MongoAdapter implements StorageAdapter {
  private readonly client: MongoClient;
  private db!: Db;
  private transactionsSupported = false;
  private standaloneWarningLogged = false;
  private readonly shopCollectionNames = ["products", "inventory", "sales", "purchases", "expenses", "losses"];

  constructor(uri: string, private readonly dbName = "dukaandaar") {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    try {
      const topology = await this.db.admin().command({ hello: 1 });
      this.transactionsSupported = Boolean(topology.setName || topology.msg === "isdbgrid");
    } catch (error) {
      // A standalone Mongo instance (or an older server) may not support hello/transactions.
      // Prefer working with guarded single-document updates over failing shop writes at runtime.
      this.transactionsSupported = false;
      logWarn("storage:mongo", "could not verify transaction support; using standalone-safe writes", error instanceof Error ? error.message : String(error));
    }
    if (!this.transactionsSupported) this.warnStandaloneWrites();
    await Promise.all([ 
      this.db.collection("products").createIndex({ shopId: 1, name: 1 }, { unique: true }),
      this.db.collection("inventory").createIndex({ shopId: 1, productId: 1 }, { unique: true }),
      this.db.collection("sales").createIndex({ shopId: 1, timestamp: -1 }),
      this.db.collection("purchases").createIndex({ shopId: 1, timestamp: -1 }),
      this.db.collection("expenses").createIndex({ shopId: 1, timestamp: -1 }),
      this.db.collection("losses").createIndex({ shopId: 1, timestamp: -1 }),
    ]);
    log("storage:mongo", `connected to database=\"${this.dbName}\"`);
  }

  async disconnect(): Promise<void> {
    await this.client.close();
    log("storage:mongo", "disconnected");
  }

  private collection(name: string) {
    if (!this.db) throw new Error("MongoDB is not connected");
    return this.db.collection<Doc>(name);
  }

  private warnStandaloneWrites(): void {
    if (this.standaloneWarningLogged) return;
    this.standaloneWarningLogged = true;
    logWarn("storage:mongo", "MongoDB transactions are unavailable; using guarded writes with compensating rollback. A replica set or mongos is required for full multi-document atomicity.");
  }

  private async withTransaction<T>(work: (session: ClientSession) => Promise<T>, standaloneFallback: () => Promise<T>): Promise<T> {
    if (!this.transactionsSupported) {
      this.warnStandaloneWrites();
      return standaloneFallback();
    }

    const session = this.client.startSession();
    let result!: T;
    let retryWithoutTransaction = false;
    try {
      await session.withTransaction(async () => {
        result = await work(session);
      });
    } catch (error) {
      if (!isStandaloneTransactionError(error)) throw error;
      this.transactionsSupported = false;
      retryWithoutTransaction = true;
    } finally {
      await session.endSession().catch((error) => {
        logWarn("storage:mongo", "could not cleanly close MongoDB session", error instanceof Error ? error.message : String(error));
      });
    }

    if (retryWithoutTransaction) {
      this.warnStandaloneWrites();
      // Mongo rejects transaction writes on a standalone before they are applied; retry once
      // without a session using the operation's guarded, compensating fallback.
      return standaloneFallback();
    }
    return result;
  }

  private async compensateStock(shopId: string, productId: string, delta: number): Promise<void> {
    const query: Doc = { shopId, productId };
    if (delta < 0) query.quantityOnHand = { $gte: Math.abs(delta) };
    const result = await this.collection("inventory").updateOne(query, {
      $inc: { quantityOnHand: delta },
      $set: { updatedAt: new Date().toISOString() },
    });
    if (result.matchedCount !== 1) throw new Error(`Could not roll back stock for ${productId}`);
  }

  private async rollbackStock(shopId: string, changes: Array<{ productId: string; delta: number }>): Promise<void> {
    for (const change of [...changes].reverse()) {
      try {
        await this.compensateStock(shopId, change.productId, -change.delta);
      } catch (error) {
        logWarn("storage:mongo", "standalone stock rollback failed; ledger reconciliation may be needed", {
          shopId, productId: change.productId, error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async listProducts(shopId: string): Promise<Product[]> {
    const docs = await this.collection("products").find({ shopId }).sort({ name: 1 }).toArray();
    return docs.map((doc) => withoutMongoId<Product>(doc));
  }

  async findProductByAlias(shopId: string, raw: string): Promise<Product | null> {
    const normalized = translateProductReferenceToEnglish(raw).normalize("NFKC").toLocaleLowerCase().trim();
    if (!normalized) return null;
    const products = await this.listProducts(shopId);
    return products.find((product) => [product.name, ...product.aliases].filter(isEnglishProductSearchText).some((alias) => alias.normalize("NFKC").toLocaleLowerCase().trim() === normalized)) ?? null;
  }

  async createProduct(input: NewProduct): Promise<Product> {
    if (input.openingStock !== 0) throw new Error("Positive initial product stock must be recorded as a purchase.");
    const now = new Date().toISOString();
    const name = input.name.trim();
    const category = input.category.trim() || "General";
    const unit = input.unit.trim() || "unit";
    const product: Product = {
      id: `prod_${randomUUID().slice(0, 10)}`,
      shopId: input.shopId,
      name,
      aliases: buildEnglishProductAliases(name, input.aliases, category, unit),
      category,
      unit,
      sellPrice: input.sellPrice,
      costPrice: input.costPrice,
      createdAt: now,
      updatedAt: now,
    };
    const inventory: Inventory = {
      id: `inv_${product.id}`,
      shopId: input.shopId,
      productId: product.id,
      quantityOnHand: 0,
      lowStockThreshold: input.lowStockThreshold,
      lastRestockedAt: null,
      updatedAt: now,
    };
    await this.withTransaction(async (session) => {
      await this.collection("products").insertOne({ ...product, _id: product.id }, { session });
      await this.collection("inventory").insertOne({ ...inventory, _id: inventory.id }, { session });
    }, async () => {
      try {
        await this.collection("products").insertOne({ ...product, _id: product.id });
        await this.collection("inventory").insertOne({ ...inventory, _id: inventory.id });
      } catch (error) {
        await this.collection("inventory").deleteOne({ shopId: input.shopId, productId: product.id }).catch((rollbackError) => {
          logWarn("storage:mongo", "could not roll back partial product inventory insert", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        });
        await this.collection("products").deleteOne({ shopId: input.shopId, id: product.id }).catch((rollbackError) => {
          logWarn("storage:mongo", "could not roll back partial product insert", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        });
        throw error;
      }
    });
    return product;
  }

  async createProductWithInitialPurchase(input: NewProduct, purchaseInput: NewProductPurchase): Promise<{ product: Product; purchase: Purchase }> {
    if (purchaseInput.shopId !== input.shopId) throw new Error("Product and purchase must belong to the same shop.");
    if (!Number.isFinite(purchaseInput.qty) || purchaseInput.qty <= 0 || purchaseInput.qty !== input.openingStock) {
      throw new Error("Initial purchase quantity must match the product's positive starting quantity.");
    }
    if (!Number.isFinite(purchaseInput.unitCost) || purchaseInput.unitCost < 0) throw new Error("Purchase cost must be zero or greater.");

    const now = new Date().toISOString();
    const name = input.name.trim();
    const category = input.category.trim() || "General";
    const unit = input.unit.trim() || "unit";
    const product: Product = {
      id: `prod_${randomUUID().slice(0, 10)}`,
      shopId: input.shopId,
      name,
      aliases: buildEnglishProductAliases(name, input.aliases, category, unit),
      category,
      unit,
      sellPrice: input.sellPrice,
      costPrice: input.costPrice,
      createdAt: now,
      updatedAt: now,
    };
    const inventory: Inventory = {
      id: `inv_${product.id}`,
      shopId: input.shopId,
      productId: product.id,
      quantityOnHand: 0,
      lowStockThreshold: input.lowStockThreshold,
      lastRestockedAt: null,
      updatedAt: now,
    };
    const item = {
      productId: product.id,
      productName: product.name,
      qty: purchaseInput.qty,
      unitCost: purchaseInput.unitCost,
      lineTotal: purchaseInput.qty * purchaseInput.unitCost,
    };
    if (!Number.isFinite(item.lineTotal)) throw new Error("Initial purchase total is too large.");
    const record: Purchase = {
      id: `purchase_${randomUUID().slice(0, 10)}`,
      shopId: purchaseInput.shopId,
      timestamp: purchaseInput.timestamp,
      items: [item],
      totalAmount: item.lineTotal,
      supplier: purchaseInput.supplier || "Local supplier",
      source: purchaseInput.source,
      ...(purchaseInput.rawTranscript ? { rawTranscript: purchaseInput.rawTranscript } : {}),
      confirmedByUser: purchaseInput.confirmedByUser,
    };
    const purchaseDoc = { ...record, _id: record.id };
    const productDoc = { ...product, _id: product.id };
    const inventoryDoc = { ...inventory, _id: inventory.id };
    const updateOpeningStock = async (session?: ClientSession) => {
      const result = await this.collection("inventory").updateOne(
        { shopId: input.shopId, productId: product.id, quantityOnHand: 0 },
        { $inc: { quantityOnHand: purchaseInput.qty }, $set: { updatedAt: purchaseInput.timestamp, lastRestockedAt: purchaseInput.timestamp } },
        session ? { session } : {},
      );
      if (result.matchedCount !== 1) throw new Error(`Could not apply the initial purchase stock for ${product.name}.`);
    };
    try {
      await this.withTransaction(async (session) => {
        await this.collection("products").insertOne(productDoc, { session });
        await this.collection("inventory").insertOne(inventoryDoc, { session });
        await updateOpeningStock(session);
        await this.collection("purchases").insertOne(purchaseDoc, { session });
      }, async () => {
        try {
          await this.collection("products").insertOne(productDoc);
          await this.collection("inventory").insertOne(inventoryDoc);
          await updateOpeningStock();
          await this.collection("purchases").insertOne(purchaseDoc);
        } catch (error) {
          await this.collection("purchases").deleteOne({ shopId: purchaseInput.shopId, id: record.id }).catch((rollbackError) => {
            logWarn("storage:mongo", "could not roll back initial purchase history entry", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
          });
          await this.collection("inventory").deleteOne({ shopId: input.shopId, productId: product.id }).catch((rollbackError) => {
            logWarn("storage:mongo", "could not roll back initial product inventory", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
          });
          await this.collection("products").deleteOne({ shopId: input.shopId, id: product.id }).catch((rollbackError) => {
            logWarn("storage:mongo", "could not roll back initial product", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
          });
          throw error;
        }
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        throw new Error(`A product named “${name}” already exists.`);
      }
      throw error;
    }
    return { product, purchase: record };
  }

  async updateProduct(shopId: string, productId: string, changes: ProductUpdate): Promise<Product> {
    const existing = await this.collection("products").findOne({ shopId, id: productId });
    if (!existing) throw new Error("Product not found.");
    const current = withoutMongoId<Product>(existing);
    const { lowStockThreshold, ...productChanges } = changes;
    const name = productChanges.name?.trim() || current.name;
    const category = productChanges.category?.trim() || current.category;
    const unit = productChanges.unit?.trim() || current.unit;
    const sourceAliases = productChanges.aliases ?? (productChanges.name ? [] : current.aliases);
    const aliases = buildEnglishProductAliases(name, sourceAliases, category, unit);
    const updated: Product = { ...current, ...productChanges, name, category, unit, aliases, updatedAt: new Date().toISOString() };
    const stockBefore = lowStockThreshold !== undefined ? await this.getInventory(shopId, productId) : null;
    if (lowStockThreshold !== undefined && !stockBefore) throw new Error("Inventory record not found.");
    try {
      await this.withTransaction(async (session) => {
        const result = await this.collection("products").updateOne({ shopId, id: productId }, { $set: updated }, { session });
        if (result.matchedCount !== 1) throw new Error("Product not found.");
        if (lowStockThreshold !== undefined) {
          const stockResult = await this.collection("inventory").updateOne({ shopId, productId }, { $set: { lowStockThreshold, updatedAt: updated.updatedAt } }, { session });
          if (stockResult.matchedCount !== 1) throw new Error("Inventory record not found.");
        }
      }, async () => {
        let productUpdated = false;
        try {
          const result = await this.collection("products").updateOne({ shopId, id: productId, updatedAt: current.updatedAt }, { $set: updated });
          if (result.matchedCount !== 1) throw new Error("Product not found or changed concurrently.");
          productUpdated = true;
          if (lowStockThreshold !== undefined) {
            const stockResult = await this.collection("inventory").updateOne(
              { shopId, productId, lowStockThreshold: stockBefore!.lowStockThreshold },
              { $set: { lowStockThreshold, updatedAt: updated.updatedAt } },
            );
            if (stockResult.matchedCount !== 1) throw new Error("Inventory record not found or changed concurrently.");
          }
        } catch (error) {
          if (productUpdated) {
            await this.collection("products").updateOne({ shopId, id: productId, updatedAt: updated.updatedAt }, { $set: current }).catch((rollbackError) => {
              logWarn("storage:mongo", "could not roll back partial product edit", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
            });
          }
          if (lowStockThreshold !== undefined && stockBefore) {
            await this.collection("inventory").updateOne(
              { shopId, productId, lowStockThreshold },
              { $set: { lowStockThreshold: stockBefore.lowStockThreshold, updatedAt: stockBefore.updatedAt } },
            ).catch((rollbackError) => {
              logWarn("storage:mongo", "could not roll back partial stock-alert edit", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
            });
          }
          throw error;
        }
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        throw new Error(`A product named “${name}” already exists.`);
      }
      throw error;
    }
    return updated;
  }

  async listInventory(shopId: string): Promise<Inventory[]> {
    const docs = await this.collection("inventory").find({ shopId }).toArray();
    return docs.map((doc) => withoutMongoId<Inventory>(doc));
  }

  async getInventory(shopId: string, productId: string): Promise<Inventory | null> {
    const doc = await this.collection("inventory").findOne({ shopId, productId });
    return doc ? withoutMongoId<Inventory>(doc) : null;
  }

  async adjustStock(shopId: string, productId: string, delta: number): Promise<Inventory> {
    const query: Doc = { shopId, productId };
    if (delta < 0) query.quantityOnHand = { $gte: Math.abs(delta) };
    const now = new Date().toISOString();
    const set: Doc = { updatedAt: now };
    if (delta > 0) set.lastRestockedAt = now;
    const result = await this.collection("inventory").updateOne(query, { $inc: { quantityOnHand: delta }, $set: set });
    if (result.matchedCount !== 1) throw new Error(delta < 0 ? "Insufficient stock" : "Inventory record not found");
    const updated = await this.getInventory(shopId, productId);
    if (!updated) throw new Error("Inventory record not found after update");
    return updated;
  }

  async listLowStock(shopId: string): Promise<Inventory[]> {
    const all = await this.listInventory(shopId);
    return all.filter((item) => item.quantityOnHand <= item.lowStockThreshold).sort((a, b) => a.quantityOnHand - b.quantityOnHand);
  }

  async createSale(input: NewSale): Promise<Sale> {
    const record: Sale = { ...input, id: `sale_${randomUUID().slice(0, 10)}` };
    const quantities = new Map<string, number>();
    input.items.forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.qty));
    await this.withTransaction(async (session) => {
      for (const [productId, qty] of quantities) {
        const result = await this.collection("inventory").updateOne(
          { shopId: input.shopId, productId, quantityOnHand: { $gte: qty } },
          { $inc: { quantityOnHand: -qty }, $set: { updatedAt: new Date().toISOString() } },
          { session },
        );
        if (result.matchedCount !== 1) throw new Error(`Insufficient stock for ${input.items.find((item) => item.productId === productId)?.productName ?? productId}`);
      }
      await this.collection("sales").insertOne({ ...record, _id: record.id }, { session });
    }, async () => {
      const applied: Array<{ productId: string; delta: number }> = [];
      try {
        for (const [productId, qty] of quantities) {
          const result = await this.collection("inventory").updateOne(
            { shopId: input.shopId, productId, quantityOnHand: { $gte: qty } },
            { $inc: { quantityOnHand: -qty }, $set: { updatedAt: new Date().toISOString() } },
          );
          if (result.matchedCount !== 1) throw new Error(`Insufficient stock for ${input.items.find((item) => item.productId === productId)?.productName ?? productId}`);
          applied.push({ productId, delta: -qty });
        }
        await this.collection("sales").insertOne({ ...record, _id: record.id });
      } catch (error) {
        await this.collection("sales").deleteOne({ shopId: input.shopId, id: record.id }).catch((rollbackError) => {
          logWarn("storage:mongo", "could not remove partial sale record", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        });
        await this.rollbackStock(input.shopId, applied);
        throw error;
      }
    });
    return record;
  }

  async createPurchase(input: NewPurchase): Promise<Purchase> {
    const record: Purchase = { ...input, id: `purchase_${randomUUID().slice(0, 10)}` };
    const quantities = new Map<string, number>();
    input.items.forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.qty));
    await this.withTransaction(async (session) => {
      for (const [productId, qty] of quantities) {
        const result = await this.collection("inventory").updateOne(
          { shopId: input.shopId, productId },
          { $inc: { quantityOnHand: qty }, $set: { updatedAt: new Date().toISOString(), lastRestockedAt: new Date().toISOString() } },
          { session },
        );
        if (result.matchedCount !== 1) throw new Error(`Inventory record not found for ${productId}`);
      }
      await this.collection("purchases").insertOne({ ...record, _id: record.id }, { session });
    }, async () => {
      const applied: Array<{ productId: string; delta: number }> = [];
      try {
        for (const [productId, qty] of quantities) {
          const now = new Date().toISOString();
          const result = await this.collection("inventory").updateOne(
            { shopId: input.shopId, productId },
            { $inc: { quantityOnHand: qty }, $set: { updatedAt: now, lastRestockedAt: now } },
          );
          if (result.matchedCount !== 1) throw new Error(`Inventory record not found for ${productId}`);
          applied.push({ productId, delta: qty });
        }
        await this.collection("purchases").insertOne({ ...record, _id: record.id });
      } catch (error) {
        await this.collection("purchases").deleteOne({ shopId: input.shopId, id: record.id }).catch((rollbackError) => {
          logWarn("storage:mongo", "could not remove partial purchase record", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        });
        await this.rollbackStock(input.shopId, applied);
        throw error;
      }
    });
    return record;
  }

  async createExpense(input: NewExpense): Promise<Expense> {
    const record: Expense = { ...input, id: `expense_${randomUUID().slice(0, 10)}` };
    await this.collection("expenses").insertOne({ ...record, _id: record.id });
    return record;
  }

  async createLoss(input: NewLoss): Promise<Loss> {
    const record: Loss = { ...input, id: `loss_${randomUUID().slice(0, 10)}` };
    await this.withTransaction(async (session) => {
      const result = await this.collection("inventory").updateOne(
        { shopId: input.shopId, productId: input.productId, quantityOnHand: { $gte: input.qty } },
        { $inc: { quantityOnHand: -input.qty }, $set: { updatedAt: new Date().toISOString() } },
        { session },
      );
      if (result.matchedCount !== 1) throw new Error(`Insufficient stock to record loss for ${input.productName}`);
      await this.collection("losses").insertOne({ ...record, _id: record.id }, { session });
    }, async () => {
      let stockReduced = false;
      try {
        const result = await this.collection("inventory").updateOne(
          { shopId: input.shopId, productId: input.productId, quantityOnHand: { $gte: input.qty } },
          { $inc: { quantityOnHand: -input.qty }, $set: { updatedAt: new Date().toISOString() } },
        );
        if (result.matchedCount !== 1) throw new Error(`Insufficient stock to record loss for ${input.productName}`);
        stockReduced = true;
        await this.collection("losses").insertOne({ ...record, _id: record.id });
      } catch (error) {
        await this.collection("losses").deleteOne({ shopId: input.shopId, id: record.id }).catch((rollbackError) => {
          logWarn("storage:mongo", "could not remove partial stock-loss record", rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
        });
        if (stockReduced) await this.rollbackStock(input.shopId, [{ productId: input.productId, delta: -input.qty }]);
        throw error;
      }
    });
    return record;
  }

  async querySales(shopId: string, filter: TimeFilter = {}): Promise<Sale[]> {
    const docs = await this.collection("sales").find({ shopId, ...timeQuery(filter) }).sort({ timestamp: -1 }).toArray();
    return docs.map((doc) => withoutMongoId<Sale>(doc));
  }

  async queryPurchases(shopId: string, filter: TimeFilter = {}): Promise<Purchase[]> {
    const docs = await this.collection("purchases").find({ shopId, ...timeQuery(filter) }).sort({ timestamp: -1 }).toArray();
    return docs.map((doc) => withoutMongoId<Purchase>(doc));
  }

  async queryExpenses(shopId: string, filter: TimeFilter = {}): Promise<Expense[]> {
    const docs = await this.collection("expenses").find({ shopId, ...timeQuery(filter) }).sort({ timestamp: -1 }).toArray();
    return docs.map((doc) => withoutMongoId<Expense>(doc));
  }

  async queryLosses(shopId: string, filter: TimeFilter = {}): Promise<Loss[]> {
    const query = { shopId, ...timeQuery(filter) };
    if (filter.productId) delete (query as Doc)["items.productId"];
    if (filter.productId) (query as Doc).productId = filter.productId;
    const docs = await this.collection("losses").find(query).sort({ timestamp: -1 }).toArray();
    return docs.map((doc) => withoutMongoId<Loss>(doc));
  }

  async getSettings(shopId: string): Promise<Settings> {
    const doc = await this.collection("settings").findOne({ shopId });
    const defaults: Settings = {
      shopId,
      shopName: "My Shop",
      ownerName: "Shop owner",
      phone: "",
      address: "",
      currency: "INR",
      language: "en-IN",
      lowStockDefaultThreshold: 10,
      createdAt: new Date().toISOString(),
    };
    return doc ? { ...defaults, ...withoutMongoId<Partial<Settings>>(doc), shopId } : defaults;
  }

  async updateSettings(shopId: string, changes: SettingsUpdate): Promise<Settings> {
    const current = await this.getSettings(shopId);
    const updated: Settings = { ...current, ...changes, shopId };
    await this.collection("settings").replaceOne({ shopId }, { ...updated, _id: shopId }, { upsert: true });
    return updated;
  }

  async seed(): Promise<void> {
    const data = buildSeedData(process.env.SHOP_ID ?? "shop_001");
    const shopId = data.settings.shopId;
    const writeSeed = async (session?: ClientSession): Promise<void> => {
      const options = session ? { session } : {};
      for (const name of this.shopCollectionNames) await this.collection(name).deleteMany({ shopId }, options);
      await this.collection("settings").deleteMany({ shopId }, options);
      await this.collection("products").insertMany(data.products.map((item) => ({ ...item, _id: item.id })), options);
      await this.collection("inventory").insertMany(data.inventory.map((item) => ({ ...item, _id: item.id })), options);
      await this.collection("sales").insertMany(data.sales.map((item) => ({ ...item, _id: item.id })), options);
      await this.collection("purchases").insertMany(data.purchases.map((item) => ({ ...item, _id: item.id })), options);
      await this.collection("expenses").insertMany(data.expenses.map((item) => ({ ...item, _id: item.id })), options);
      await this.collection("losses").insertMany(data.losses.map((item) => ({ ...item, _id: item.id })), options);
      await this.collection("settings").insertOne({ ...data.settings, _id: shopId }, options);
    };

    try {
      await this.withTransaction((session) => writeSeed(session), () => writeSeed());
    } catch (error) {
      if (!isStandaloneTransactionError(error)) throw error;
      logWarn("storage:mongo", "local MongoDB is standalone; applying the manual seed without a transaction. Rerun the seed if interrupted; use a replica set for atomic writes.");
      await writeSeed();
    }
    log("storage:mongo", "seeded demo shop", { products: data.products.length, sales: data.sales.length });
  }
}
