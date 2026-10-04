import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ExpenseCategory, NewExpense, NewLoss, NewProduct, NewProductPurchase, NewPurchase, NewSale, Product, ProductUpdate, Source } from "../types.js";
import type { StorageAdapter } from "../storage/StorageAdapter.js";
import { log, logError } from "../utils/logger.js";
import { IntentSchema, type ParsedIntent } from "./intentSchemas.js";
import { completeProductAliases, parseCommand, translateProductReferences, type ConversationTurn, type ParseProvider } from "./llmProvider.js";
import { resolveProduct } from "./productResolver.js";
import { getPeriodRange, type Period } from "./periods.js";
import { currency, queryTotals } from "./analyticsService.js";
import { categoryLabel, detectLanguage, formatLocalizedCurrency, formatLocalizedDate, formatLocalizedNumber, localizedMessage, localizedPeriod, localizedKind, paymentMethodLabel, productFieldLabel, transactionKindLabel, type ConversationLanguage } from "./conversationLocale.js";

interface PreviewLine { label: string; detail: string; amount?: number; }
export interface ActionPreview {
  kind: "sale" | "purchase" | "expense" | "loss" | "product";
  title: string;
  lines: PreviewLine[];
  total?: number;
  note?: string;
  confidence: number;
  stockEffect?: string;
  editData?: Record<string, unknown>;
}

type CommitAction =
  | { kind: "sale"; payload: NewSale; preview: ActionPreview }
  | { kind: "purchase"; payload: NewPurchase; preview: ActionPreview }
  | { kind: "expense"; payload: NewExpense; preview: ActionPreview }
  | { kind: "loss"; payload: NewLoss; preview: ActionPreview }
  | { kind: "product"; payload: NewProduct; initialPurchase?: NewProductPurchase; preview: ActionPreview }
  | { kind: "updateProduct"; payload: { shopId: string; productId: string; changes: ProductUpdate }; preview: ActionPreview };

interface PendingAction { action: CommitAction; language: ConversationLanguage; expiresAt: number; committing?: boolean }
export interface AssistantResponse {
  mode: "answer" | "clarification" | "confirmation";
  message: string;
  language: ConversationLanguage;
  provider: ParseProvider;
  fallback: boolean;
  confidence: number;
  pendingId?: string;
  preview?: ActionPreview;
}

type PreparedAssistantResponse = Omit<AssistantResponse, "provider" | "fallback" | "confidence">;

const ManualSaleSchema = z.object({
  items: z.array(z.object({ productId: z.string().min(1), qty: z.number().positive(), unitPrice: z.number().nonnegative().optional() })).min(1),
  paymentMethod: z.enum(["cash", "upi", "credit"]).default("cash"),
});
const ManualPurchaseSchema = z.object({
  items: z.array(z.object({ productId: z.string().min(1), qty: z.number().positive(), unitCost: z.number().nonnegative().optional() })).min(1),
  supplier: z.string().trim().default("Local supplier"),
});
const ManualExpenseSchema = z.object({ category: z.enum(["rent", "electricity", "transport", "staff", "misc"]), amount: z.number().positive(), note: z.string().trim().min(1) });
const ManualLossSchema = z.object({ productId: z.string().min(1), qty: z.number().positive(), reason: z.string().trim().min(1) });
const ManualProductSchema = z.object({
  name: z.string().trim().min(1), aliases: z.array(z.string().trim()).default([]), category: z.string().trim().default("General"), unit: z.string().trim().default("unit"),
  sellPrice: z.number().positive(), costPrice: z.number().nonnegative(), openingStock: z.number().nonnegative().default(0), purchaseUnitCost: z.number().nonnegative().optional(), supplier: z.string().trim().default("Local supplier"), lowStockThreshold: z.number().nonnegative().default(10),
});

function sourceFor(source: Source | undefined): Source { return source === "voice" ? "voice" : "text"; }
function money(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function totalItems<T extends { lineTotal: number }>(items: T[]): number { return items.reduce((sum, item) => sum + item.lineTotal, 0); }

function productFailure(raw: string, products: Product[], language: ConversationLanguage): string | null {
  const result = resolveProduct(raw, products);
  if (result.status === "not_found") return localizedMessage(language, "product_not_found", { product: raw });
  if (result.status === "ambiguous") return localizedMessage(language, "product_ambiguous", { product: raw, candidates: result.candidates.map((product) => product.name).join(", ") });
  return null;
}

async function translateIntentProductReferences(intent: ParsedIntent, products: Product[], allowLlm: boolean): Promise<ParsedIntent> {
  if (intent.intent === "RECORD_SALE" || intent.intent === "RECORD_PURCHASE") {
    const translations = await translateProductReferences(intent.items.map((item) => item.productNameRaw), products, allowLlm);
    return { ...intent, items: intent.items.map((item, index) => ({ ...item, productNameRaw: translations[index] ?? item.productNameRaw })) } as ParsedIntent;
  }
  if ("productNameRaw" in intent && typeof intent.productNameRaw === "string" && intent.productNameRaw.trim()) {
    const [translation] = await translateProductReferences([intent.productNameRaw], products, allowLlm);
    return { ...intent, productNameRaw: translation ?? intent.productNameRaw } as ParsedIntent;
  }
  return intent;
}

interface HistoryRow { timestamp: string; kind: "sale" | "purchase" | "expense" | "loss"; detail: string; amount: number; }

function itemRowsSummary(items: Array<{ productId: string; productName: string; qty: number; lineTotal: number }>, productId?: string): { detail: string; amount: number } {
  const selected = productId ? items.filter((item) => item.productId === productId) : items;
  return { detail: selected.map((item) => `${item.qty} × ${item.productName}`).join(" · ") || "—", amount: selected.reduce((sum, item) => sum + item.lineTotal, 0) };
}

export class BusinessLogic {
  private pending = new Map<string, PendingAction>();

  constructor(private readonly storage: StorageAdapter, private readonly shopId: string = process.env.SHOP_ID ?? "shop_001") {}

  async parseTranscript(transcript: string, source?: Source, preferredLanguage?: ConversationLanguage, context: ConversationTurn[] = []): Promise<AssistantResponse> {
    const clean = transcript.trim();
    if (!clean) return { mode: "clarification", message: localizedMessage(preferredLanguage ?? "en", "unknown"), language: preferredLanguage ?? "en", provider: "rules", fallback: false, confidence: 0.25 };
    const products = await this.storage.listProducts(this.shopId);
    const parsed = await parseCommand(clean, products, preferredLanguage, context);
    const language = preferredLanguage ?? parsed.intent.responseLanguage ?? detectLanguage(clean);
    const prepared = await this.prepareIntent(parsed.intent, clean, sourceFor(source), language, !parsed.fallback);
    const result: AssistantResponse = { ...prepared, provider: parsed.provider, fallback: parsed.fallback, confidence: parsed.intent.confidence };
    log("businessLogic", `transcript parsed as ${parsed.intent.intent}`, { provider: parsed.provider, fallback: parsed.fallback, mode: result.mode });
    return result;
  }

  private async prepareIntent(intentValue: ParsedIntent, transcript: string, source: Source, language: ConversationLanguage, allowLlm = true): Promise<PreparedAssistantResponse> {
    const parsedIntent = IntentSchema.parse(intentValue);
    const now = new Date().toISOString();
    const products = await this.storage.listProducts(this.shopId);
    const intent = await translateIntentProductReferences(parsedIntent, products, allowLlm);
    const base = { language };

    const amountText = (value: number) => formatLocalizedCurrency(value, language);
    const numberText = (value: number) => formatLocalizedNumber(value, language);
    const periodText = (value: string) => localizedPeriod(language, value);

    if (intent.intent === "UNKNOWN") return { ...base, mode: "clarification", message: intent.clarification && (language === "en" || intent.responseLanguage === language) ? intent.clarification : localizedMessage(language, "unknown") };

    if (intent.intent === "QUERY_SALES") {
      const resolution = intent.productNameRaw ? resolveProduct(intent.productNameRaw, products) : null;
      const failure = intent.productNameRaw ? productFailure(intent.productNameRaw, products, language) : null;
      if (failure) return { ...base, mode: "clarification", message: failure };
      const productId = resolution?.status === "matched" ? resolution.product.id : undefined;
      const sales = await this.storage.querySales(this.shopId, { ...getPeriodRange(intent.period as Period), ...(productId ? { productId } : {}) });
      const total = productId
        ? sales.reduce((sum, sale) => sum + sale.items.filter((item) => item.productId === productId).reduce((sub, item) => sub + item.lineTotal, 0), 0)
        : sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
      const qty = productId ? sales.reduce((sum, sale) => sum + sale.items.filter((item) => item.productId === productId).reduce((sub, item) => sub + item.qty, 0), 0) : 0;
      const message = productId && resolution?.status === "matched"
        ? localizedMessage(language, "sales_product", { qty: numberText(qty), product: resolution.product.name, amount: amountText(total), period: periodText(intent.period) })
        : localizedMessage(language, "sales_total", { period: periodText(intent.period), amount: amountText(total), count: numberText(sales.length) });
      return { ...base, mode: "answer", message };
    }

    if (intent.intent === "QUERY_PURCHASES") {
      const resolution = intent.productNameRaw ? resolveProduct(intent.productNameRaw, products) : null;
      const failure = intent.productNameRaw ? productFailure(intent.productNameRaw, products, language) : null;
      if (failure) return { ...base, mode: "clarification", message: failure };
      const productId = resolution?.status === "matched" ? resolution.product.id : undefined;
      const purchases = await this.storage.queryPurchases(this.shopId, { ...getPeriodRange(intent.period as Period), ...(productId ? { productId } : {}) });
      const total = productId
        ? purchases.reduce((sum, purchase) => sum + purchase.items.filter((item) => item.productId === productId).reduce((sub, item) => sub + item.lineTotal, 0), 0)
        : purchases.reduce((sum, purchase) => sum + purchase.totalAmount, 0);
      return { ...base, mode: "answer", message: localizedMessage(language, "purchases_total", { period: periodText(intent.period), amount: amountText(total), count: numberText(purchases.length) }) };
    }

    if (intent.intent === "QUERY_EXPENSES") {
      const expenses = await this.storage.queryExpenses(this.shopId, getPeriodRange(intent.period as Period));
      const filtered = intent.category ? expenses.filter((item) => item.category === intent.category) : expenses;
      const total = filtered.reduce((sum, item) => sum + item.amount, 0);
      return { ...base, mode: "answer", message: localizedMessage(language, "expenses_total", { period: periodText(intent.period), amount: amountText(total), count: numberText(filtered.length) }) };
    }

    if (intent.intent === "QUERY_LOSSES") {
      const resolution = intent.productNameRaw ? resolveProduct(intent.productNameRaw, products) : null;
      const failure = intent.productNameRaw ? productFailure(intent.productNameRaw, products, language) : null;
      if (failure) return { ...base, mode: "clarification", message: failure };
      const productId = resolution?.status === "matched" ? resolution.product.id : undefined;
      const losses = await this.storage.queryLosses(this.shopId, { ...getPeriodRange(intent.period as Period), ...(productId ? { productId } : {}) });
      const total = losses.reduce((sum, item) => sum + item.totalCost, 0);
      return { ...base, mode: "answer", message: localizedMessage(language, "losses_total", { period: periodText(intent.period), amount: amountText(total), count: numberText(losses.length) }) };
    }

    if (intent.intent === "QUERY_PROFIT") {
      const result = await queryTotals(this.storage, this.shopId, intent.period as Period);
      return { ...base, mode: "answer", message: localizedMessage(language, "profit", { period: periodText(intent.period), amount: amountText(result.profit) }) };
    }

    if (intent.intent === "QUERY_INVENTORY") {
      if (intent.productNameRaw) {
        const failure = productFailure(intent.productNameRaw, products, language);
        if (failure) return { ...base, mode: "clarification", message: failure };
        const resolution = resolveProduct(intent.productNameRaw, products);
        if (resolution.status !== "matched") return { ...base, mode: "clarification", message: localizedMessage(language, "product_not_found", { product: intent.productNameRaw }) };
        const stock = await this.storage.getInventory(this.shopId, resolution.product.id);
        const qty = stock?.quantityOnHand ?? 0;
        const status = qty <= 0 ? localizedMessage(language, "status_out") : stock && qty <= stock.lowStockThreshold ? localizedMessage(language, "status_low") : localizedMessage(language, "status_ok");
        return { ...base, mode: "answer", message: localizedMessage(language, "inventory_product", { product: resolution.product.name, qty: numberText(qty), unit: resolution.product.unit, status }) };
      }
      const [inventory, lowRows] = await Promise.all([this.storage.listInventory(this.shopId), this.storage.listLowStock(this.shopId)]);
      if (intent.focus !== "all") {
        const byId = new Map(products.map((product) => [product.id, product]));
        const names = lowRows.map((item) => `${byId.get(item.productId)?.name ?? "?"} (${numberText(item.quantityOnHand)})`).slice(0, 8);
        return { ...base, mode: "answer", message: names.length ? localizedMessage(language, "low_stock", { items: names.join(", ") }) : localizedMessage(language, "no_low_stock") };
      }
      return { ...base, mode: "answer", message: localizedMessage(language, "inventory_summary", { products: numberText(products.length), units: numberText(inventory.reduce((sum, item) => sum + item.quantityOnHand, 0)), low: numberText(lowRows.length) }) };
    }

    if (intent.intent === "QUERY_PRODUCT") {
      const failure = productFailure(intent.productNameRaw, products, language);
      if (failure) return { ...base, mode: "clarification", message: failure };
      const resolution = resolveProduct(intent.productNameRaw, products);
      if (resolution.status !== "matched") return { ...base, mode: "clarification", message: localizedMessage(language, "product_not_found", { product: intent.productNameRaw }) };
      const stock = await this.storage.getInventory(this.shopId, resolution.product.id);
      const qty = stock?.quantityOnHand ?? 0;
      return { ...base, mode: "answer", message: localizedMessage(language, "product_details", {
        product: resolution.product.name, qty: numberText(qty), unit: resolution.product.unit,
        sellPrice: amountText(resolution.product.sellPrice), costPrice: amountText(resolution.product.costPrice),
        stockValue: amountText(qty * resolution.product.costPrice), threshold: numberText(stock?.lowStockThreshold ?? 0),
      }) };
    }

    if (intent.intent === "QUERY_TRANSACTIONS") {
      const resolution = intent.productNameRaw ? resolveProduct(intent.productNameRaw, products) : null;
      const failure = intent.productNameRaw ? productFailure(intent.productNameRaw, products, language) : null;
      if (failure) return { ...base, mode: "clarification", message: failure };
      const productId = resolution?.status === "matched" ? resolution.product.id : undefined;
      const range = getPeriodRange(intent.period as Period);
      const itemFilter = { ...range, ...(productId ? { productId } : {}) };
      const [salesResult, purchaseResult, expenseResult, lossResult] = await Promise.all([
        this.storage.querySales(this.shopId, itemFilter), this.storage.queryPurchases(this.shopId, itemFilter),
        productId ? Promise.resolve([]) : this.storage.queryExpenses(this.shopId, range), this.storage.queryLosses(this.shopId, itemFilter),
      ]);
      const sales = intent.transactionType === "all" || intent.transactionType === "sale" ? salesResult : [];
      const purchases = intent.transactionType === "all" || intent.transactionType === "purchase" ? purchaseResult : [];
      const expenses = intent.transactionType === "all" || intent.transactionType === "expense" ? expenseResult : [];
      const losses = intent.transactionType === "all" || intent.transactionType === "loss" ? lossResult : [];
      const groups = [
        { kind: "sale", rows: sales, amount: sales.reduce((sum, row) => sum + (productId ? itemRowsSummary(row.items, productId).amount : row.totalAmount), 0) },
        { kind: "purchase", rows: purchases, amount: purchases.reduce((sum, row) => sum + (productId ? itemRowsSummary(row.items, productId).amount : row.totalAmount), 0) },
        { kind: "expense", rows: expenses, amount: expenses.reduce((sum, row) => sum + row.amount, 0) },
        { kind: "loss", rows: losses, amount: losses.reduce((sum, row) => sum + row.totalCost, 0) },
      ].filter((group) => group.rows.length > 0);
      const totalCount = sales.length + purchases.length + expenses.length + losses.length;
      if (!totalCount) return { ...base, mode: "answer", message: localizedMessage(language, "no_transactions", { period: periodText(intent.period) }) };
      const details = groups.map((group) => `${localizedKind(language, group.kind)} ${numberText(group.rows.length)}: ${amountText(group.amount)}`).join("; ");
      return { ...base, mode: "answer", message: localizedMessage(language, "transactions_summary", { count: numberText(totalCount), period: periodText(intent.period), details }) };
    }

    if (intent.intent === "QUERY_HISTORY") {
      const resolution = intent.productNameRaw ? resolveProduct(intent.productNameRaw, products) : null;
      const failure = intent.productNameRaw ? productFailure(intent.productNameRaw, products, language) : null;
      if (failure) return { ...base, mode: "clarification", message: failure };
      const productId = resolution?.status === "matched" ? resolution.product.id : undefined;
      const range = getPeriodRange(intent.period as Period);
      const itemFilter = { ...range, ...(productId ? { productId } : {}) };
      const [sales, purchases, expenses, losses] = await Promise.all([
        intent.transactionType === "all" || intent.transactionType === "sale" ? this.storage.querySales(this.shopId, itemFilter) : Promise.resolve([]),
        intent.transactionType === "all" || intent.transactionType === "purchase" ? this.storage.queryPurchases(this.shopId, itemFilter) : Promise.resolve([]),
        !productId && (intent.transactionType === "all" || intent.transactionType === "expense") ? this.storage.queryExpenses(this.shopId, range) : Promise.resolve([]),
        intent.transactionType === "all" || intent.transactionType === "loss" ? this.storage.queryLosses(this.shopId, itemFilter) : Promise.resolve([]),
      ]);
      const rows: HistoryRow[] = [
        ...sales.map((row) => { const summary = itemRowsSummary(row.items, productId); return { timestamp: row.timestamp, kind: "sale" as const, detail: summary.detail, amount: productId ? summary.amount : row.totalAmount }; }),
        ...purchases.map((row) => { const summary = itemRowsSummary(row.items, productId); return { timestamp: row.timestamp, kind: "purchase" as const, detail: summary.detail, amount: productId ? summary.amount : row.totalAmount }; }),
        ...expenses.map((row) => ({ timestamp: row.timestamp, kind: "expense" as const, detail: `${row.category} · ${row.note}`, amount: row.amount })),
        ...losses.map((row) => ({ timestamp: row.timestamp, kind: "loss" as const, detail: `${row.qty} × ${row.productName} · ${row.reason}`, amount: row.totalCost })),
      ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const shown = rows.slice(0, intent.limit);
      if (!shown.length) return { ...base, mode: "answer", message: localizedMessage(language, "history_empty", { kind: localizedKind(language, intent.transactionType), period: periodText(intent.period) }) };
      const lines = shown.map((row) => `${formatLocalizedDate(row.timestamp, language)} · ${transactionKindLabel(language, row.kind)}: ${row.detail} — ${amountText(row.amount)}`).join("\n");
      return { ...base, mode: "answer", message: localizedMessage(language, "history_list", { kind: localizedKind(language, intent.transactionType), period: periodText(intent.period), count: numberText(shown.length), lines }) };
    }

    if (intent.intent === "QUERY_STOCK_MOVEMENT") {
      const resolution = intent.productNameRaw ? resolveProduct(intent.productNameRaw, products) : null;
      const failure = intent.productNameRaw ? productFailure(intent.productNameRaw, products, language) : null;
      if (failure) return { ...base, mode: "clarification", message: failure };
      const productId = resolution?.status === "matched" ? resolution.product.id : undefined;
      const filter = { ...getPeriodRange(intent.period as Period), ...(productId ? { productId } : {}) };
      const [sales, purchases, losses, inventory] = await Promise.all([
        this.storage.querySales(this.shopId, filter), this.storage.queryPurchases(this.shopId, filter), this.storage.queryLosses(this.shopId, filter),
        productId ? this.storage.getInventory(this.shopId, productId).then((row) => row ? [row] : []) : this.storage.listInventory(this.shopId),
      ]);
      const sold = sales.reduce((sum, row) => sum + row.items.filter((item) => !productId || item.productId === productId).reduce((sub, item) => sub + item.qty, 0), 0);
      const bought = purchases.reduce((sum, row) => sum + row.items.filter((item) => !productId || item.productId === productId).reduce((sub, item) => sub + item.qty, 0), 0);
      const lost = losses.reduce((sum, row) => sum + row.qty, 0);
      const current = inventory.reduce((sum, row) => sum + row.quantityOnHand, 0);
      return { ...base, mode: "answer", message: localizedMessage(language, "stock_movement", {
        product: resolution?.status === "matched" ? resolution.product.name : localizedMessage(language, "all_products"),
        bought: numberText(bought), sold: numberText(sold), lost: numberText(lost), current: numberText(current),
        unit: resolution?.status === "matched" ? resolution.product.unit : localizedMessage(language, "unit_label"),
      }) };
    }

    if (intent.intent === "QUERY_TOP_PRODUCTS") {
      const sales = await this.storage.querySales(this.shopId, getPeriodRange(intent.period as Period));
      const totals = new Map<string, { name: string; qty: number; amount: number }>();
      sales.forEach((sale) => sale.items.forEach((item) => {
        const row = totals.get(item.productId) ?? { name: item.productName, qty: 0, amount: 0 };
        row.qty += item.qty; row.amount += item.lineTotal; totals.set(item.productId, row);
      }));
      const top = [...totals.values()].sort((a, b) => b.qty - a.qty).slice(0, intent.limit);
      const items = top.length ? top.map((row) => `${row.name} (${numberText(row.qty)} · ${amountText(row.amount)})`).join(", ") : localizedMessage(language, "none");
      return { ...base, mode: "answer", message: top.length ? localizedMessage(language, "top_products", { period: periodText(intent.period), items }) : localizedMessage(language, "no_sales", { period: periodText(intent.period) }) };
    }

    if (intent.intent === "RECORD_SALE") {
      const built: NewSale["items"] = [];
      for (const rawItem of intent.items) {
        const resolution = resolveProduct(rawItem.productNameRaw, products);
        if (resolution.status !== "matched") return { ...base, mode: "clarification", message: productFailure(rawItem.productNameRaw, products, language) ?? localizedMessage(language, "unknown") };
        if (!rawItem.qty || !Number.isFinite(rawItem.qty)) return { ...base, mode: "clarification", message: localizedMessage(language, "need_sale_qty", { product: resolution.product.name }) };
        const unitPrice = money(rawItem.unitPrice) ?? resolution.product.sellPrice;
        if (unitPrice <= 0) return { ...base, mode: "clarification", message: localizedMessage(language, "need_sale_price") };
        built.push({ productId: resolution.product.id, productName: resolution.product.name, qty: rawItem.qty, unitPrice, unitCost: resolution.product.costPrice, lineTotal: rawItem.qty * unitPrice });
      }
      const quantities = new Map<string, number>();
      built.forEach((item) => quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.qty));
      for (const [productId, qty] of quantities) {
        const stock = await this.storage.getInventory(this.shopId, productId);
        const product = products.find((item) => item.id === productId);
        if (!stock || stock.quantityOnHand < qty) return { ...base, mode: "clarification", message: localizedMessage(language, "stock_insufficient", { product: product?.name ?? "", qty: numberText(stock?.quantityOnHand ?? 0), unit: product?.unit ?? localizedMessage(language, "unit_label") }) };
      }
      const payload: NewSale = { shopId: this.shopId, timestamp: now, items: built, totalAmount: totalItems(built), paymentMethod: intent.paymentMethod ?? "cash", source, rawTranscript: transcript, confirmedByUser: true };
      const preview: ActionPreview = {
        kind: "sale", title: localizedMessage(language, "review_sale"),
        lines: built.map((item) => ({ label: `${numberText(item.qty)} × ${item.productName}`, detail: `${amountText(item.unitPrice)} ${localizedMessage(language, "each")}`, amount: item.lineTotal })),
        total: payload.totalAmount, note: localizedMessage(language, "payment", { value: paymentMethodLabel(language, payload.paymentMethod) }), confidence: intent.confidence,
        stockEffect: localizedMessage(language, "stock_effect_sale"),
        editData: { items: built.map((item) => ({ productId: item.productId, qty: item.qty, unitPrice: item.unitPrice })), paymentMethod: payload.paymentMethod },
      };
      return this.makePending({ kind: "sale", payload, preview }, language);
    }

    if (intent.intent === "RECORD_PURCHASE") {
      const built: NewPurchase["items"] = [];
      for (const rawItem of intent.items) {
        const resolution = resolveProduct(rawItem.productNameRaw, products);
        if (resolution.status !== "matched") return { ...base, mode: "clarification", message: productFailure(rawItem.productNameRaw, products, language) ?? localizedMessage(language, "unknown") };
        if (!rawItem.qty || !Number.isFinite(rawItem.qty)) return { ...base, mode: "clarification", message: localizedMessage(language, "need_purchase_qty", { product: resolution.product.name }) };
        const unitCost = money(rawItem.unitCost) ?? resolution.product.costPrice;
        if (unitCost < 0) return { ...base, mode: "clarification", message: localizedMessage(language, "need_product_prices") };
        built.push({ productId: resolution.product.id, productName: resolution.product.name, qty: rawItem.qty, unitCost, lineTotal: rawItem.qty * unitCost });
      }
      const payload: NewPurchase = { shopId: this.shopId, timestamp: now, items: built, totalAmount: totalItems(built), supplier: intent.supplier || "Local supplier", source, rawTranscript: transcript, confirmedByUser: true };
      const preview: ActionPreview = {
        kind: "purchase", title: localizedMessage(language, "review_purchase"),
        lines: built.map((item) => ({ label: `${numberText(item.qty)} × ${item.productName}`, detail: `${amountText(item.unitCost)} ${localizedMessage(language, "each")}`, amount: item.lineTotal })),
        total: payload.totalAmount, note: localizedMessage(language, "supplier", { value: payload.supplier }), confidence: intent.confidence,
        stockEffect: localizedMessage(language, "stock_effect_purchase"),
        editData: { items: built.map((item) => ({ productId: item.productId, qty: item.qty, unitCost: item.unitCost })), supplier: payload.supplier },
      };
      return this.makePending({ kind: "purchase", payload, preview }, language);
    }

    if (intent.intent === "RECORD_EXPENSE") {
      if (!intent.amount || intent.amount <= 0) return { ...base, mode: "clarification", message: localizedMessage(language, "need_expense_amount") };
      const category = categoryLabel(language, intent.category);
      const payload: NewExpense = { shopId: this.shopId, timestamp: now, category: intent.category as ExpenseCategory, amount: intent.amount, note: intent.note || `${category} expense`, source, rawTranscript: transcript, confirmedByUser: true };
      const preview: ActionPreview = { kind: "expense", title: localizedMessage(language, "review_expense"), lines: [{ label: category, detail: payload.note, amount: payload.amount }], total: payload.amount, confidence: intent.confidence, editData: { category: payload.category, amount: payload.amount, note: payload.note } };
      return this.makePending({ kind: "expense", payload, preview }, language);
    }

    if (intent.intent === "RECORD_LOSS") {
      const resolution = resolveProduct(intent.productNameRaw, products);
      if (resolution.status !== "matched") return { ...base, mode: "clarification", message: productFailure(intent.productNameRaw, products, language) ?? localizedMessage(language, "need_loss_product") };
      if (!intent.qty || intent.qty <= 0) return { ...base, mode: "clarification", message: localizedMessage(language, "need_loss_qty", { product: resolution.product.name }) };
      const stock = await this.storage.getInventory(this.shopId, resolution.product.id);
      if (!stock || stock.quantityOnHand < intent.qty) return { ...base, mode: "clarification", message: localizedMessage(language, "stock_insufficient", { product: resolution.product.name, qty: numberText(stock?.quantityOnHand ?? 0), unit: resolution.product.unit }) };
      const englishRuleReasons = ["Stock loss", "Rat damage", "Spoiled or expired", "Damaged goods", "Leakage"];
      const reason = !intent.reason || (language !== "en" && englishRuleReasons.includes(intent.reason)) ? localizedMessage(language, "label_loss") : intent.reason;
      const payload: NewLoss = { shopId: this.shopId, timestamp: now, productId: resolution.product.id, productName: resolution.product.name, qty: intent.qty, unitCost: resolution.product.costPrice, totalCost: intent.qty * resolution.product.costPrice, reason, source, rawTranscript: transcript, confirmedByUser: true };
      const preview: ActionPreview = { kind: "loss", title: localizedMessage(language, "review_loss"), lines: [{ label: `${numberText(payload.qty)} × ${payload.productName}`, detail: payload.reason, amount: payload.totalCost }], total: payload.totalCost, note: localizedMessage(language, "at_cost"), confidence: intent.confidence, stockEffect: localizedMessage(language, "stock_effect_loss"), editData: { productId: payload.productId, qty: payload.qty, reason: payload.reason } };
      return this.makePending({ kind: "loss", payload, preview }, language);
    }

    if (intent.intent === "CREATE_PRODUCT") {
      const [englishName] = await translateProductReferences([intent.name], products, allowLlm);
      const duplicate = resolveProduct(englishName || intent.name, products);
      if (duplicate.status === "matched" && duplicate.score >= 0.9) return { ...base, mode: "clarification", message: localizedMessage(language, "product_not_found", { product: `${duplicate.product.name} (already exists)` }) };
      if (duplicate.status === "ambiguous") return { ...base, mode: "clarification", message: localizedMessage(language, "product_ambiguous", { product: intent.name, candidates: duplicate.candidates.map((item) => item.name).join(", ") }) };
      const parsedPurchaseCost = money(intent.purchaseUnitCost);
      const productCostPrice = money(intent.costPrice) ?? parsedPurchaseCost;
      if (money(intent.sellPrice) === null || productCostPrice === null) return { ...base, mode: "clarification", message: localizedMessage(language, "need_product_prices") };
      const [settings, aliases] = await Promise.all([
        this.storage.getSettings(this.shopId),
        completeProductAliases(intent.name, intent.aliases ?? [], intent.category ?? "General", intent.unit ?? "unit", allowLlm),
      ]);
      const payload: NewProduct = { shopId: this.shopId, name: intent.name, aliases, category: intent.category ?? "General", unit: intent.unit ?? "unit", sellPrice: intent.sellPrice!, costPrice: productCostPrice, openingStock: intent.openingStock ?? 0, lowStockThreshold: intent.lowStockThreshold ?? settings.lowStockDefaultThreshold };
      const purchaseUnitCost = parsedPurchaseCost ?? payload.costPrice;
      const initialPurchase: NewProductPurchase | undefined = payload.openingStock > 0 ? {
        shopId: payload.shopId, timestamp: now, qty: payload.openingStock, unitCost: purchaseUnitCost,
        supplier: intent.supplier?.trim() || "Local supplier", source, rawTranscript: transcript, confirmedByUser: true,
      } : undefined;
      if (initialPurchase && !Number.isFinite(initialPurchase.qty * initialPurchase.unitCost)) return { ...base, mode: "clarification", message: localizedMessage(language, "need_product_prices") };
      const category = categoryLabel(language, payload.category);
      const purchaseLine = initialPurchase ? {
        label: localizedMessage(language, "review_purchase"),
        detail: `${numberText(initialPurchase.qty)} × ${payload.name} · ${amountText(initialPurchase.unitCost)} ${localizedMessage(language, "each")}`,
        amount: initialPurchase.qty * initialPurchase.unitCost,
      } : null;
      const preview: ActionPreview = {
        kind: "product", title: localizedMessage(language, "review_product"),
        lines: [
          { label: payload.name, detail: localizedMessage(language, "price_detail", { sellPrice: amountText(payload.sellPrice), costPrice: amountText(payload.costPrice) }) },
          ...(purchaseLine ? [purchaseLine] : []),
        ],
        total: payload.openingStock,
        note: initialPurchase
          ? localizedMessage(language, "supplier", { value: initialPurchase.supplier })
          : `${localizedMessage(language, "opening_stock", { qty: numberText(payload.openingStock), unit: payload.unit, category })} ${localizedMessage(language, "zero_stock_note")}`,
        confidence: intent.confidence,
        ...(initialPurchase ? { stockEffect: localizedMessage(language, "initial_purchase_effect") } : {}),
        editData: { name: payload.name, aliases: payload.aliases, category: payload.category, unit: payload.unit, sellPrice: payload.sellPrice, costPrice: payload.costPrice, openingStock: payload.openingStock, purchaseUnitCost, supplier: initialPurchase?.supplier, lowStockThreshold: payload.lowStockThreshold },
      };
      return this.makePending({ kind: "product", payload, ...(initialPurchase ? { initialPurchase } : {}), preview }, language);
    }

    if (intent.intent === "UPDATE_PRODUCT") {
      const resolution = resolveProduct(intent.productNameRaw, products);
      if (resolution.status !== "matched") return { ...base, mode: "clarification", message: productFailure(intent.productNameRaw, products, language) ?? localizedMessage(language, "unknown") };
      const product = resolution.product;
      const changes: ProductUpdate = {};
      if (intent.name !== undefined) {
        const nextName = intent.name.trim();
        const normalizeName = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
        const nextNormalized = normalizeName(nextName);
        const conflict = products.find((item) => item.id !== product.id && [item.name, ...item.aliases].some((alias) => normalizeName(alias) === nextNormalized));
        if (conflict) return { ...base, mode: "clarification", message: localizedMessage(language, "product_name_conflict", { product: nextName }) };
        changes.name = nextName;
      }
      if (intent.aliases !== undefined) changes.aliases = [...new Set(intent.aliases.map((alias) => alias.trim()).filter(Boolean))];
      if (intent.category !== undefined) changes.category = intent.category.trim();
      if (intent.unit !== undefined) changes.unit = intent.unit.trim();
      if (intent.sellPrice !== undefined && intent.sellPrice !== null) {
        if (intent.sellPrice <= 0) return { ...base, mode: "clarification", message: localizedMessage(language, "product_invalid_sell_price") };
        changes.sellPrice = intent.sellPrice;
      }
      if (intent.costPrice !== undefined && intent.costPrice !== null) changes.costPrice = intent.costPrice;
      if (intent.lowStockThreshold !== undefined && intent.lowStockThreshold !== null) changes.lowStockThreshold = intent.lowStockThreshold;
      if (!Object.keys(changes).length) return { ...base, mode: "clarification", message: localizedMessage(language, "need_product_update") };

      const stock = await this.storage.getInventory(this.shopId, product.id);
      const fieldKeys = ["name", "aliases", "category", "unit", "costPrice", "sellPrice", "lowStockThreshold"] as const;
      const oldValues: Record<(typeof fieldKeys)[number], unknown> = {
        name: product.name, aliases: product.aliases.filter((alias) => alias !== product.name), category: product.category, unit: product.unit,
        costPrice: product.costPrice, sellPrice: product.sellPrice, lowStockThreshold: stock?.lowStockThreshold ?? 10,
      };
      const displayValue = (field: (typeof fieldKeys)[number], value: unknown): string => {
        if (field === "sellPrice" || field === "costPrice") return amountText(Number(value ?? 0));
        if (field === "lowStockThreshold") return numberText(Number(value ?? 0));
        if (field === "aliases") return Array.isArray(value) && value.length ? value.join(", ") : "—";
        return String(value ?? "—");
      };
      const lines = fieldKeys.filter((field) => Object.hasOwn(changes, field)).map((field) => ({
        label: product.name,
        detail: localizedMessage(language, "product_change", { field: productFieldLabel(language, field), old: displayValue(field, oldValues[field]), new: displayValue(field, changes[field]) }),
      }));
      const preview: ActionPreview = {
        kind: "product", title: localizedMessage(language, "review_product_update"), lines,
        note: localizedMessage(language, "product_stock_unchanged"), confidence: intent.confidence,
        editData: { updateExisting: true, productId: product.id },
      };
      const payload = { shopId: this.shopId, productId: product.id, changes };
      return this.makePending({ kind: "updateProduct", payload, preview }, language);
    }

    return { ...base, mode: "clarification", message: localizedMessage(language, "unknown") };
  }

  private makePending(action: CommitAction, language: ConversationLanguage): PreparedAssistantResponse {
    const pendingId = randomUUID();
    this.pending.set(pendingId, { action, language, expiresAt: Date.now() + 5 * 60_000 });
    log("confirm", `created pending action id=${pendingId} kind=${action.kind}`);
    return { mode: "confirmation", message: localizedMessage(language, "confirm_review"), language, pendingId, preview: action.preview };
  }

  async confirm(pendingId: string): Promise<{ message: string; dashboardChanged: true }> {
    const pending = this.pending.get(pendingId);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pending.delete(pendingId);
      throw new Error("This confirmation has expired. Please send the command again.");
    }
    if (pending.committing) throw new Error("This action is already being saved.");
    pending.committing = true;
    try {
      const message = await this.commit(pending.action, pending.language);
      this.pending.delete(pendingId);
      return { message, dashboardChanged: true };
    } catch (error) {
      pending.committing = false;
      logError("confirm", "commit failed", error);
      throw error;
    }
  }

  cancel(pendingId: string): void {
    this.pending.delete(pendingId);
    log("confirm", `cancelled pending action id=${pendingId}`);
  }

  private async commit(action: CommitAction, language: ConversationLanguage): Promise<string> {
    if (action.kind === "sale") {
      const sale = await this.storage.createSale(action.payload);
      log("sales", `created sale ${sale.id} total=${sale.totalAmount}`, { items: sale.items.length, source: sale.source });
      return localizedMessage(language, "sale_saved", { amount: formatLocalizedCurrency(sale.totalAmount, language) });
    }
    if (action.kind === "purchase") {
      const purchase = await this.storage.createPurchase(action.payload);
      log("purchases", `created purchase ${purchase.id} total=${purchase.totalAmount}`, { items: purchase.items.length, source: purchase.source });
      return localizedMessage(language, "purchase_saved", { amount: formatLocalizedCurrency(purchase.totalAmount, language) });
    }
    if (action.kind === "expense") {
      const expense = await this.storage.createExpense(action.payload);
      log("expenses", `created expense ${expense.id} amount=${expense.amount}`, { category: expense.category });
      return localizedMessage(language, "expense_saved", { amount: formatLocalizedCurrency(expense.amount, language), category: categoryLabel(language, expense.category) });
    }
    if (action.kind === "loss") {
      const loss = await this.storage.createLoss(action.payload);
      log("losses", `created loss ${loss.id} value=${loss.totalCost}`, { product: loss.productName, qty: loss.qty });
      return localizedMessage(language, "loss_saved", { qty: formatLocalizedNumber(loss.qty, language), product: loss.productName, amount: formatLocalizedCurrency(loss.totalCost, language) });
    }
    if (action.kind === "updateProduct") {
      const product = await this.storage.updateProduct(action.payload.shopId, action.payload.productId, action.payload.changes);
      log("products", `updated product ${product.id} name=\"${product.name}\"`, { fields: Object.keys(action.payload.changes) });
      return localizedMessage(language, "product_updated", { product: product.name });
    }
    if (action.initialPurchase) {
      const { product, purchase } = await this.storage.createProductWithInitialPurchase(action.payload, action.initialPurchase);
      log("products", `created product ${product.id} name=\"${product.name}\" with initial purchase`, { stock: action.initialPurchase.qty, purchaseId: purchase.id });
      log("purchases", `created initial purchase ${purchase.id} total=${purchase.totalAmount}`, { product: product.name, source: purchase.source });
      return `${localizedMessage(language, "product_saved", { product: product.name })} ${localizedMessage(language, "purchase_saved", { amount: formatLocalizedCurrency(purchase.totalAmount, language) })}`;
    }
    const product = await this.storage.createProduct({ ...action.payload, openingStock: 0 });
    log("products", `created product ${product.id} name=\"${product.name}\"`, { stock: 0 });
    return `${localizedMessage(language, "product_saved", { product: product.name })} ${localizedMessage(language, "zero_stock_saved")}`;
  }

  async recordManual(kind: string, value: unknown): Promise<{ message: string }> {
    const products = await this.storage.listProducts(this.shopId);
    const now = new Date().toISOString();
    if (kind === "sale") {
      const parsed = ManualSaleSchema.parse(value);
      const items: NewSale["items"] = parsed.items.map((item) => {
        const product = products.find((entry) => entry.id === item.productId);
        if (!product) throw new Error("Choose a product from the catalog.");
        return { productId: product.id, productName: product.name, qty: item.qty, unitPrice: item.unitPrice ?? product.sellPrice, unitCost: product.costPrice, lineTotal: item.qty * (item.unitPrice ?? product.sellPrice) };
      });
      const payload: NewSale = { shopId: this.shopId, timestamp: now, items, totalAmount: totalItems(items), paymentMethod: parsed.paymentMethod, source: "manual", confirmedByUser: true };
      const sale = await this.storage.createSale(payload);
      log("sales", `manual sale ${sale.id} total=${sale.totalAmount}`);
      return { message: `Sale recorded for ${currency(sale.totalAmount)}.` };
    }
    if (kind === "purchase") {
      const parsed = ManualPurchaseSchema.parse(value);
      const items: NewPurchase["items"] = parsed.items.map((item) => {
        const product = products.find((entry) => entry.id === item.productId);
        if (!product) throw new Error("Choose a product from the catalog.");
        return { productId: product.id, productName: product.name, qty: item.qty, unitCost: item.unitCost ?? product.costPrice, lineTotal: item.qty * (item.unitCost ?? product.costPrice) };
      });
      const payload: NewPurchase = { shopId: this.shopId, timestamp: now, items, totalAmount: totalItems(items), supplier: parsed.supplier, source: "manual", confirmedByUser: true };
      const purchase = await this.storage.createPurchase(payload);
      log("purchases", `manual purchase ${purchase.id} total=${purchase.totalAmount}`);
      return { message: `Purchase recorded for ${currency(purchase.totalAmount)}. Stock has been increased.` };
    }
    if (kind === "expense") {
      const parsed = ManualExpenseSchema.parse(value);
      const payload: NewExpense = { shopId: this.shopId, timestamp: now, ...parsed, source: "manual", confirmedByUser: true };
      const expense = await this.storage.createExpense(payload);
      log("expenses", `manual expense ${expense.id} amount=${expense.amount}`);
      return { message: `${currency(expense.amount)} expense recorded.` };
    }
    if (kind === "loss") {
      const parsed = ManualLossSchema.parse(value);
      const product = products.find((entry) => entry.id === parsed.productId);
      if (!product) throw new Error("Choose a product from the catalog.");
      const payload: NewLoss = { shopId: this.shopId, timestamp: now, productId: product.id, productName: product.name, qty: parsed.qty, unitCost: product.costPrice, totalCost: parsed.qty * product.costPrice, reason: parsed.reason, source: "manual", confirmedByUser: true };
      const loss = await this.storage.createLoss(payload);
      log("losses", `manual loss ${loss.id} amount=${loss.totalCost}`);
      return { message: `${loss.qty} × ${loss.productName} loss recorded (${currency(loss.totalCost)} at cost).` };
    }
    if (kind === "product") {
      const parsed = ManualProductSchema.parse(value);
      const [englishName] = await translateProductReferences([parsed.name], products);
      const duplicate = resolveProduct(englishName || parsed.name, products);
      if (duplicate.status === "matched" && duplicate.score >= 0.9) throw new Error(`${duplicate.product.name} already exists in the catalog.`);
      const aliases = await completeProductAliases(parsed.name, parsed.aliases, parsed.category, parsed.unit);
      const productInput: NewProduct = {
        shopId: this.shopId, name: parsed.name, aliases, category: parsed.category, unit: parsed.unit,
        sellPrice: parsed.sellPrice, costPrice: parsed.costPrice, openingStock: parsed.openingStock, lowStockThreshold: parsed.lowStockThreshold,
      };
      if (parsed.openingStock > 0) {
        const unitCost = parsed.purchaseUnitCost ?? parsed.costPrice;
        const { product, purchase } = await this.storage.createProductWithInitialPurchase(productInput, {
          shopId: this.shopId, timestamp: now, qty: parsed.openingStock, unitCost, supplier: parsed.supplier,
          source: "manual", confirmedByUser: true,
        });
        log("products", `manual product created ${product.id} name=\"${product.name}\" with initial purchase`, { purchaseId: purchase.id, qty: parsed.openingStock });
        log("purchases", `manual initial purchase ${purchase.id} total=${purchase.totalAmount}`);
        return { message: `${product.name} added to the catalog. Initial purchase recorded: ${parsed.openingStock} × ${currency(unitCost)} = ${currency(purchase.totalAmount)}; stock has been increased.` };
      }
      const product = await this.storage.createProduct({ ...productInput, openingStock: 0 });
      log("products", `manual product created ${product.id} name=\"${product.name}\" with zero opening stock`);
      return { message: `${product.name} added to the catalog. Opening stock is zero, so no purchase was recorded.` };
    }
    throw new Error("Unknown manual entry type.");
  }
}
