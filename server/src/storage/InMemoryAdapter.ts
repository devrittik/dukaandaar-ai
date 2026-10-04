import { randomUUID } from "node:crypto";
import { buildSeedData } from "../seedData.js";
import { buildEnglishProductAliases, isEnglishProductSearchText, translateProductReferenceToEnglish } from "../services/productAliases.js";
import { log } from "../utils/logger.js";
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

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}

function insideRange(timestamp: string, filter: TimeFilter = {}): boolean {
  const time = new Date(timestamp).getTime();
  if (filter.from && time < new Date(filter.from).getTime()) return false;
  if (filter.to && time >= new Date(filter.to).getTime()) return false;
  return true;
}

export class InMemoryAdapter implements StorageAdapter {
  private products = new Map<string, Product>();
  private inventory = new Map<string, Inventory>();
  private sales = new Map<string, Sale>();
  private purchases = new Map<string, Purchase>();
  private expenses = new Map<string, Expense>();
  private losses = new Map<string, Loss>();
  private settings = new Map<string, Settings>();

  async connect(): Promise<void> {
    log("storage:memory", "ready (process-local, no persistence)");
  }

  async disconnect(): Promise<void> {
    log("storage:memory", "disconnected");
  }

  async seed(): Promise<void> {
    const data = buildSeedData(process.env.SHOP_ID ?? "shop_001");
    for (const collection of [this.products, this.inventory, this.sales, this.purchases, this.expenses, this.losses, this.settings]) collection.clear();
    data.products.forEach((item) => this.products.set(item.id, structuredClone(item)));
    data.inventory.forEach((item) => this.inventory.set(item.productId, structuredClone(item)));
    data.sales.forEach((item) => this.sales.set(item.id, structuredClone(item)));
    data.purchases.forEach((item) => this.purchases.set(item.id, structuredClone(item)));
    data.expenses.forEach((item) => this.expenses.set(item.id, structuredClone(item)));
    data.losses.forEach((item) => this.losses.set(item.id, structuredClone(item)));
    this.settings.set(data.settings.shopId, structuredClone(data.settings));
    log("storage:memory", "seeded demo shop", { products: data.products.length, sales: data.sales.length });
  }

  async listProducts(shopId: string): Promise<Product[]> {
    return [...this.products.values()].filter((item) => item.shopId === shopId).sort((a, b) => a.name.localeCompare(b.name)).map((item) => structuredClone(item));
  }

  async findProductByAlias(shopId: string, raw: string): Promise<Product | null> {
    const target = normalize(translateProductReferenceToEnglish(raw));
    if (!target) return null;
    const match = [...this.products.values()].find((item) => item.shopId === shopId && [item.name, ...item.aliases].filter(isEnglishProductSearchText).some((name) => normalize(name) === target));
    return match ? structuredClone(match) : null;
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
      quantityOnHand: input.openingStock,
      lowStockThreshold: input.lowStockThreshold,
      lastRestockedAt: input.openingStock > 0 ? now : null,
      updatedAt: now,
    };
    this.products.set(product.id, product);
    this.inventory.set(product.id, inventory);
    return structuredClone(product);
  }

  async createProductWithInitialPurchase(input: NewProduct, purchaseInput: NewProductPurchase): Promise<{ product: Product; purchase: Purchase }> {
    if (purchaseInput.shopId !== input.shopId) throw new Error("Product and purchase must belong to the same shop.");
    if (!Number.isFinite(purchaseInput.qty) || purchaseInput.qty <= 0 || purchaseInput.qty !== input.openingStock) {
      throw new Error("Initial purchase quantity must match the product's positive starting quantity.");
    }
    if (!Number.isFinite(purchaseInput.unitCost) || purchaseInput.unitCost < 0) throw new Error("Purchase cost must be zero or greater.");

    const product = await this.createProduct({ ...input, openingStock: 0 });
    const lineTotal = purchaseInput.qty * purchaseInput.unitCost;
    if (!Number.isFinite(lineTotal)) {
      this.products.delete(product.id);
      this.inventory.delete(product.id);
      throw new Error("Initial purchase total is too large.");
    }
    const item = { productId: product.id, productName: product.name, qty: purchaseInput.qty, unitCost: purchaseInput.unitCost, lineTotal };
    const record: Purchase = {
      id: `purchase_${randomUUID().slice(0, 10)}`,
      shopId: purchaseInput.shopId,
      timestamp: purchaseInput.timestamp,
      items: [item],
      totalAmount: lineTotal,
      supplier: purchaseInput.supplier || "Local supplier",
      source: purchaseInput.source,
      ...(purchaseInput.rawTranscript ? { rawTranscript: purchaseInput.rawTranscript } : {}),
      confirmedByUser: purchaseInput.confirmedByUser,
    };
    try {
      const inventory = this.inventory.get(product.id);
      if (!inventory) throw new Error("Inventory record not found for initial purchase.");
      this.inventory.set(product.id, {
        ...inventory,
        quantityOnHand: inventory.quantityOnHand + purchaseInput.qty,
        lastRestockedAt: purchaseInput.timestamp,
        updatedAt: purchaseInput.timestamp,
      });
      this.purchases.set(record.id, record);
      return { product, purchase: structuredClone(record) };
    } catch (error) {
      this.purchases.delete(record.id);
      this.products.delete(product.id);
      this.inventory.delete(product.id);
      throw error;
    }
  }

  async updateProduct(shopId: string, productId: string, changes: ProductUpdate): Promise<Product> {
    const current = this.products.get(productId);
    if (!current || current.shopId !== shopId) throw new Error("Product not found.");
    const name = changes.name?.trim() || current.name;
    const category = changes.category?.trim() || current.category;
    const unit = changes.unit?.trim() || current.unit;
    const sourceAliases = changes.aliases ?? (changes.name ? [] : current.aliases);
    const aliases = buildEnglishProductAliases(name, sourceAliases, category, unit);
    const updated: Product = { ...current, ...changes, name, category, unit, aliases, updatedAt: new Date().toISOString() };
    if (changes.lowStockThreshold !== undefined) {
      const stock = this.inventory.get(productId);
      if (!stock || stock.shopId !== shopId) throw new Error("Inventory record not found.");
      this.inventory.set(productId, { ...stock, lowStockThreshold: changes.lowStockThreshold, updatedAt: updated.updatedAt });
    }
    this.products.set(productId, updated);
    return structuredClone(updated);
  }

  async listInventory(shopId: string): Promise<Inventory[]> {
    return [...this.inventory.values()].filter((item) => item.shopId === shopId).map((item) => structuredClone(item));
  }

  async getInventory(shopId: string, productId: string): Promise<Inventory | null> {
    const item = this.inventory.get(productId);
    return item?.shopId === shopId ? structuredClone(item) : null;
  }

  async adjustStock(shopId: string, productId: string, delta: number): Promise<Inventory> {
    const item = this.inventory.get(productId);
    if (!item || item.shopId !== shopId) throw new Error("Inventory record not found");
    const next = item.quantityOnHand + delta;
    if (next < 0) throw new Error("Insufficient stock");
    const updated = { ...item, quantityOnHand: next, updatedAt: new Date().toISOString(), ...(delta > 0 ? { lastRestockedAt: new Date().toISOString() } : {}) };
    this.inventory.set(productId, updated);
    return structuredClone(updated);
  }

  async listLowStock(shopId: string): Promise<Inventory[]> {
    return [...this.inventory.values()]
      .filter((item) => item.shopId === shopId && item.quantityOnHand <= item.lowStockThreshold)
      .sort((a, b) => a.quantityOnHand - b.quantityOnHand)
      .map((item) => structuredClone(item));
  }

  async createSale(input: NewSale): Promise<Sale> {
    const quantities = new Map<string, number>();
    input.items.forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.qty));
    for (const [productId, qty] of quantities) {
      const stock = this.inventory.get(productId);
      if (!stock || stock.shopId !== input.shopId || stock.quantityOnHand < qty) throw new Error(`Insufficient stock for ${input.items.find((item) => item.productId === productId)?.productName ?? productId}`);
    }
    for (const [productId, qty] of quantities) await this.adjustStock(input.shopId, productId, -qty);
    const record: Sale = { ...structuredClone(input), id: `sale_${randomUUID().slice(0, 10)}` };
    this.sales.set(record.id, record);
    return structuredClone(record);
  }

  async createPurchase(input: NewPurchase): Promise<Purchase> {
    const quantities = new Map<string, number>();
    input.items.forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.qty));
    for (const productId of quantities.keys()) {
      const stock = this.inventory.get(productId);
      if (!stock || stock.shopId !== input.shopId) throw new Error("Inventory record not found for purchase item");
    }
    for (const [productId, qty] of quantities) await this.adjustStock(input.shopId, productId, qty);
    const record: Purchase = { ...structuredClone(input), id: `purchase_${randomUUID().slice(0, 10)}` };
    this.purchases.set(record.id, record);
    return structuredClone(record);
  }

  async createExpense(input: NewExpense): Promise<Expense> {
    const record: Expense = { ...structuredClone(input), id: `expense_${randomUUID().slice(0, 10)}` };
    this.expenses.set(record.id, record);
    return structuredClone(record);
  }

  async createLoss(input: NewLoss): Promise<Loss> {
    const stock = this.inventory.get(input.productId);
    if (!stock || stock.shopId !== input.shopId || stock.quantityOnHand < input.qty) throw new Error(`Insufficient stock to record loss for ${input.productName}`);
    await this.adjustStock(input.shopId, input.productId, -input.qty);
    const record: Loss = { ...structuredClone(input), id: `loss_${randomUUID().slice(0, 10)}` };
    this.losses.set(record.id, record);
    return structuredClone(record);
  }

  async querySales(shopId: string, filter: TimeFilter = {}): Promise<Sale[]> {
    return [...this.sales.values()].filter((item) => item.shopId === shopId && insideRange(item.timestamp, filter) && (!filter.productId || item.items.some((row) => row.productId === filter.productId))).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((item) => structuredClone(item));
  }

  async queryPurchases(shopId: string, filter: TimeFilter = {}): Promise<Purchase[]> {
    return [...this.purchases.values()].filter((item) => item.shopId === shopId && insideRange(item.timestamp, filter) && (!filter.productId || item.items.some((row) => row.productId === filter.productId))).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((item) => structuredClone(item));
  }

  async queryExpenses(shopId: string, filter: TimeFilter = {}): Promise<Expense[]> {
    return [...this.expenses.values()].filter((item) => item.shopId === shopId && insideRange(item.timestamp, filter)).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((item) => structuredClone(item));
  }

  async queryLosses(shopId: string, filter: TimeFilter = {}): Promise<Loss[]> {
    return [...this.losses.values()].filter((item) => item.shopId === shopId && insideRange(item.timestamp, filter) && (!filter.productId || item.productId === filter.productId)).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((item) => structuredClone(item));
  }

  async getSettings(shopId: string): Promise<Settings> {
    return structuredClone(this.settings.get(shopId) ?? {
      shopId,
      shopName: "My Shop",
      ownerName: "Shop owner",
      phone: "",
      address: "",
      currency: "INR" as const,
      language: "en-IN",
      lowStockDefaultThreshold: 10,
      createdAt: new Date().toISOString(),
    });
  }

  async updateSettings(shopId: string, changes: SettingsUpdate): Promise<Settings> {
    const current = await this.getSettings(shopId);
    const updated = { ...current, ...changes, shopId };
    this.settings.set(shopId, structuredClone(updated));
    return structuredClone(updated);
  }
}
