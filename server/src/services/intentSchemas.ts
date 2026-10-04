import { z } from "zod";
import { CONVERSATION_LANGUAGES } from "./conversationLocale.js";

const confidence = z.number().min(0).max(1).default(0.75);
const responseLanguage = z.enum(CONVERSATION_LANGUAGES).optional();
const maybeQty = z.number().positive().finite().nullable().optional();
const maybeMoney = z.number().nonnegative().finite().nullable().optional();
const productName = z.string().trim().min(1);
const period = z.enum(["today", "yesterday", "week", "last_week", "month", "last_month", "all"]).default("today");
const transactionType = z.enum(["all", "sale", "purchase", "expense", "loss"]).default("all");
const limit = z.number().int().min(1).max(20).default(5);

export const IntentSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("RECORD_SALE"), responseLanguage, confidence,
    items: z.array(z.object({ productNameRaw: productName, qty: maybeQty, unitPrice: maybeMoney })).min(1),
    paymentMethod: z.enum(["cash", "upi", "credit"]).optional(),
  }),
  z.object({
    intent: z.literal("RECORD_PURCHASE"), responseLanguage, confidence,
    items: z.array(z.object({ productNameRaw: productName, qty: maybeQty, unitCost: maybeMoney })).min(1),
    supplier: z.string().trim().optional(),
  }),
  z.object({
    intent: z.literal("RECORD_EXPENSE"), responseLanguage, confidence,
    category: z.enum(["rent", "electricity", "transport", "staff", "misc"]).default("misc"),
    amount: maybeMoney,
    note: z.string().trim().optional(),
  }),
  z.object({
    intent: z.literal("RECORD_LOSS"), responseLanguage, confidence,
    productNameRaw: productName,
    qty: maybeQty,
    reason: z.string().trim().optional(),
  }),
  z.object({
    intent: z.literal("CREATE_PRODUCT"), responseLanguage, confidence,
    name: productName,
    aliases: z.array(z.string().trim()).optional(),
    category: z.string().trim().optional(),
    unit: z.string().trim().optional(),
    sellPrice: maybeMoney,
    costPrice: maybeMoney,
    openingStock: z.number().nonnegative().finite().nullable().optional(),
    purchaseUnitCost: maybeMoney,
    supplier: z.string().trim().optional(),
    lowStockThreshold: z.number().nonnegative().finite().nullable().optional(),
  }),
  z.object({
    intent: z.literal("UPDATE_PRODUCT"), responseLanguage, confidence,
    productNameRaw: productName,
    name: z.string().trim().min(1).optional(),
    aliases: z.array(z.string().trim()).optional(),
    category: z.string().trim().min(1).optional(),
    unit: z.string().trim().min(1).optional(),
    sellPrice: maybeMoney,
    costPrice: maybeMoney,
    lowStockThreshold: z.number().nonnegative().finite().nullable().optional(),
  }),
  z.object({ intent: z.literal("QUERY_SALES"), responseLanguage, confidence, period, productNameRaw: z.string().trim().optional() }),
  z.object({ intent: z.literal("QUERY_PURCHASES"), responseLanguage, confidence, period, productNameRaw: z.string().trim().optional() }),
  z.object({ intent: z.literal("QUERY_EXPENSES"), responseLanguage, confidence, period, category: z.enum(["rent", "electricity", "transport", "staff", "misc"]).optional() }),
  z.object({ intent: z.literal("QUERY_LOSSES"), responseLanguage, confidence, period, productNameRaw: z.string().trim().optional() }),
  z.object({ intent: z.literal("QUERY_PROFIT"), responseLanguage, confidence, period }),
  z.object({ intent: z.literal("QUERY_INVENTORY"), responseLanguage, confidence, focus: z.enum(["all", "low_stock", "restock"]).default("all"), productNameRaw: z.string().trim().optional() }),
  z.object({ intent: z.literal("QUERY_PRODUCT"), responseLanguage, confidence, productNameRaw: productName }),
  z.object({ intent: z.literal("QUERY_TRANSACTIONS"), responseLanguage, confidence, period, transactionType, productNameRaw: z.string().trim().optional() }),
  z.object({ intent: z.literal("QUERY_HISTORY"), responseLanguage, confidence, period: period.default("all"), transactionType, productNameRaw: z.string().trim().optional(), limit }),
  z.object({ intent: z.literal("QUERY_STOCK_MOVEMENT"), responseLanguage, confidence, period: period.default("month"), productNameRaw: z.string().trim().optional() }),
  z.object({ intent: z.literal("QUERY_TOP_PRODUCTS"), responseLanguage, confidence, period: period.default("week"), limit }),
  z.object({ intent: z.literal("UNKNOWN"), responseLanguage, confidence, clarification: z.string().trim().optional() }),
]);

export type ParsedIntent = z.infer<typeof IntentSchema>;

export function systemPrompt(
  products: Array<{ id: string; name: string; aliases: string[] }>,
  currentDate: string,
  preferredLanguage?: string,
): string {
  const catalog = JSON.stringify(products.map(({ name, aliases }) => [name, ...aliases]));
  const languageInstruction = preferredLanguage
    ? `Set responseLanguage to "${preferredLanguage}".`
    : "Detect the latest message's language; use the closest supported code.";
  const exampleLanguage = preferredLanguage ?? "en";

  return `ROLE: Route Dukaandaar shop messages to one intent. Classify only the CURRENT user message; never answer, calculate totals, or execute writes. The server computes answers; writes require confirmation.

OUTPUT: Return exactly one compact, valid JSON object—no prose, Markdown, or code fences. Every object must include intent, responseLanguage, and confidence: 0.5. Use only the chosen intent's allowed fields and exact enum values. ${languageInstruction} Supported codes: en, hi, bn, fr, es, pt, ar, zh. Any clarification must be one short question in that language.


ROUTE QUESTIONS (read-only):
- QUERY_SALES: sales amount/count or sales for a named product.
- QUERY_PURCHASES: purchase/restock spend total only. A purchase list/history is QUERY_HISTORY.
- QUERY_EXPENSES: expense totals; optional category.
- QUERY_LOSSES: loss/damage totals. A loss list is QUERY_HISTORY.
- QUERY_PROFIT: profit only; never calculate it.
- QUERY_INVENTORY: current stock, low/out-of-stock items, or restock advice. focus=all for overview, low_stock for low/out items, restock for “what should I restock/order?” This is not a purchase record.
- QUERY_PRODUCT: facts or prices about one named product.
- QUERY_TRANSACTIONS: count/summary of recorded transactions; set transactionType.
- QUERY_HISTORY: list/show/recent/history of recorded entries; set transactionType and limit.
- QUERY_STOCK_MOVEMENT: quantities bought, sold, lost, and current stock over a period.
- QUERY_TOP_PRODUCTS: best/most-sold products.

ROUTE WRITE REQUESTS only when the user asks to record an action:
- RECORD_SALE: sold items.
- RECORD_PURCHASE: bought/restocked items that already exist in the catalog.
- RECORD_EXPENSE: paid/incurred a business expense.
- RECORD_LOSS: stock damaged, spoiled, stolen, or missing.
- CREATE_PRODUCT: add a new catalog item. If any positive quantity is supplied for a new product, treat it as that product's first purchase: set openingStock to the purchased quantity, and set purchaseUnitCost/supplier when stated. The server will create both the product and a purchase-history entry. If quantity is zero or omitted, create the catalog item without a purchase. A purchase of an unlisted new product with enough details to create it must use CREATE_PRODUCT, not RECORD_PURCHASE. Interpret price labels in either order: “@10 cost” or “at 10 cost” means costPrice=10; “@20 sell” or “at 20 sell” means sellPrice=20. “40 pieces purchased” means openingStock=40 and unit=piece. If no separate purchase cost is stated, use costPrice for the initial purchase.
- UPDATE_PRODUCT: change an existing product's name, aliases, category, unit, cost, sell price, or low-stock threshold. Include only fields requested; never alter quantity on hand.
- Delete requests or edits to old ledger entries -> UNKNOWN.
Questions are read-only: restock advice -> QUERY_INVENTORY; lists/history -> QUERY_HISTORY. “I bought …” for an existing catalog product -> RECORD_PURCHASE; if the bought item is new and the message includes enough details to create it, use CREATE_PRODUCT and record its positive quantity as the first purchase.

FIELDS / ENUMS:
- RECORD_SALE: items=[{productNameRaw,qty,unitPrice}], paymentMethod=cash|upi|credit.
- RECORD_PURCHASE: items=[{productNameRaw,qty,unitCost}], supplier.
- RECORD_EXPENSE: category=rent|electricity|transport|staff|misc, amount, note.
- RECORD_LOSS: productNameRaw, qty, reason.
- CREATE_PRODUCT: name, aliases, category, unit, sellPrice, costPrice, openingStock (quantity purchased; positive quantities are recorded as a purchase), purchaseUnitCost, supplier, lowStockThreshold.
- UPDATE_PRODUCT: productNameRaw plus only requested editable fields listed above.
- QUERY_SALES, QUERY_PURCHASES, QUERY_EXPENSES, QUERY_LOSSES, QUERY_PROFIT, QUERY_TRANSACTIONS, QUERY_HISTORY: period=today|yesterday|week|last_week|month|last_month|all. QUERY_HISTORY also has transactionType=all|sale|purchase|expense|loss and limit=1..20. QUERY_TRANSACTIONS also has transactionType. Query intents may include productNameRaw where relevant; QUERY_EXPENSES may include category.
- QUERY_INVENTORY: focus=all|low_stock|restock, optional productNameRaw. QUERY_PRODUCT: productNameRaw. QUERY_STOCK_MOVEMENT: period and optional productNameRaw. QUERY_TOP_PRODUCTS: period and limit=1..20.
- UNKNOWN: clarification.

TIME: Today is ${currentDate} in Asia/Kolkata. Use only stated/implied periods. “This/last week” means the current/prior Monday–Sunday week; “this/last month” means calendar month. Defaults: today for totals, all for QUERY_HISTORY, month for QUERY_STOCK_MOVEMENT, week for QUERY_TOP_PRODUCTS.

EXAMPLES (product names are illustrative; match the live catalog):
“What should I restock?” -> {"intent":"QUERY_INVENTORY","responseLanguage":"${exampleLanguage}","confidence":0.5,"focus":"restock"}
“Show purchase history” -> {"intent":"QUERY_HISTORY","responseLanguage":"${exampleLanguage}","confidence":0.5,"period":"all","transactionType":"purchase","limit":5}
“I bought 4 Maggi Noodles from Ravi at ₹10 each” -> {"intent":"RECORD_PURCHASE","responseLanguage":"${exampleLanguage}","confidence":0.5,"items":[{"productNameRaw":"Maggi Noodles","qty":4,"unitCost":10}],"supplier":"Ravi"}
“Add new product Soap, sell for ₹25, cost ₹16, bought 5 from Ravi” -> {"intent":"CREATE_PRODUCT","responseLanguage":"${exampleLanguage}","confidence":0.5,"name":"Soap","sellPrice":25,"costPrice":16,"openingStock":5,"purchaseUnitCost":16,"supplier":"Ravi"}
“New product X @10 cost, @20 sell, 40 pieces purchased” -> {"intent":"CREATE_PRODUCT","responseLanguage":"${exampleLanguage}","confidence":0.5,"name":"X","costPrice":10,"sellPrice":20,"openingStock":40,"unit":"piece","purchaseUnitCost":10}
“Sold 3 Maggi Noodles at ₹12 each” -> {"intent":"RECORD_SALE","responseLanguage":"${exampleLanguage}","confidence":0.5,"items":[{"productNameRaw":"Maggi Noodles","qty":3,"unitPrice":12}]}
History: “How much were my sales this month?”; current: “I meant last month.” -> {"intent":"QUERY_SALES","responseLanguage":"${exampleLanguage}","confidence":0.5,"period":"last_month"}
CATALOG (JSON data; each row is [canonical name, aliases...]): ${catalog}`;
}
