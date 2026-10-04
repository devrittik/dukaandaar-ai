import type { Expense, Inventory, Loss, Product, Purchase, Sale } from "../types.js";
import { formatCurrency } from "./format.js";
import { getPeriodRange, indiaDateKey, indiaDayLabel, type Period } from "./periods.js";
import type { StorageAdapter } from "../storage/StorageAdapter.js";

export interface ProductInventoryView extends Product {
  quantityOnHand: number;
  lowStockThreshold: number;
  stockValue: number;
  status: "healthy" | "low" | "out";
}

export interface Activity {
  id: string;
  kind: "sale" | "purchase" | "expense" | "loss";
  title: string;
  detail: string;
  amount: number;
  timestamp: string;
  source: string;
}

export interface DailyPoint {
  date: string;
  label: string;
  sales: number;
  purchases: number;
  expenses: number;
  losses: number;
  profit: number;
}

export interface DashboardData {
  shop: { id: string; name: string; ownerName: string; phone: string; address: string; currency: string; lowStockDefaultThreshold: number };
  generatedAt: string;
  kpis: {
    todaySales: number;
    weekSales: number;
    todayPurchases: number;
    weekPurchases: number;
    todayExpenses: number;
    todayLosses: number;
    todayProfit: number;
    weekProfit: number;
    inventoryValue: number;
    totalUnits: number;
  };
  counts: { products: number; lowStock: number; transactionsToday: number };
  weekly: DailyPoint[];
  products: ProductInventoryView[];
  lowStock: ProductInventoryView[];
  recentActivity: Activity[];
  topProducts: Array<{ productId: string; name: string; qty: number; revenue: number }>;
}

function startOfIndiaDay(date: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")) - 330 * 60_000);
}

function dayWithOffset(now: Date, offset: number): { start: Date; key: string; label: string } {
  const start = startOfIndiaDay(now);
  start.setUTCDate(start.getUTCDate() + offset);
  const key = indiaDateKey(start);
  return { start, key, label: indiaDayLabel(new Date(start.getTime() + 12 * 60 * 60 * 1000), "short") };
}

function profitOf(sales: Sale[], expenses: Expense[], losses: Loss[], productCosts: Map<string, number>): number {
  const gross = sales.reduce((total, sale) => total + sale.items.reduce((sum, item) => {
    const unitCost = Number.isFinite(item.unitCost) ? item.unitCost : productCosts.get(item.productId) ?? 0;
    return sum + item.lineTotal - item.qty * unitCost;
  }, 0), 0);
  return gross - expenses.reduce((sum, expense) => sum + expense.amount, 0) - losses.reduce((sum, loss) => sum + loss.totalCost, 0);
}

function sumSales(items: Sale[]): number { return items.reduce((sum, item) => sum + item.totalAmount, 0); }
function sumPurchases(items: Purchase[]): number { return items.reduce((sum, item) => sum + item.totalAmount, 0); }
function sumExpenses(items: Expense[]): number { return items.reduce((sum, item) => sum + item.amount, 0); }
function sumLosses(items: Loss[]): number { return items.reduce((sum, item) => sum + item.totalCost, 0); }

function itemSummary(sale: Sale | Purchase): string {
  return sale.items.slice(0, 2).map((item) => `${item.qty} × ${item.productName}`).join(" · ") + (sale.items.length > 2 ? ` +${sale.items.length - 2} more` : "");
}

export async function getDashboard(storage: StorageAdapter, shopId: string, now = new Date()): Promise<DashboardData> {
  const [settings, products, inventory, allLowStock] = await Promise.all([
    storage.getSettings(shopId), storage.listProducts(shopId), storage.listInventory(shopId), storage.listLowStock(shopId),
  ]);
  const todayRange = getPeriodRange("today", now);
  const weekRange = getPeriodRange("week", now);
  const recentStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const future = new Date(now.getTime() + 60_000).toISOString();
  const [weekSalesAll, weekPurchasesAll, weekExpensesAll, weekLossesAll, recentSales, recentPurchases, recentExpenses, recentLosses] = await Promise.all([
    storage.querySales(shopId, { from: weekRange.from, to: future }),
    storage.queryPurchases(shopId, { from: weekRange.from, to: future }),
    storage.queryExpenses(shopId, { from: weekRange.from, to: future }),
    storage.queryLosses(shopId, { from: weekRange.from, to: future }),
    storage.querySales(shopId, { from: recentStart, to: future }),
    storage.queryPurchases(shopId, { from: recentStart, to: future }),
    storage.queryExpenses(shopId, { from: recentStart, to: future }),
    storage.queryLosses(shopId, { from: recentStart, to: future }),
  ]);
  const todaySales = weekSalesAll.filter((item) => item.timestamp >= (todayRange.from ?? "") && item.timestamp < (todayRange.to ?? future));
  const todayPurchases = weekPurchasesAll.filter((item) => item.timestamp >= (todayRange.from ?? "") && item.timestamp < (todayRange.to ?? future));
  const todayExpenses = weekExpensesAll.filter((item) => item.timestamp >= (todayRange.from ?? "") && item.timestamp < (todayRange.to ?? future));
  const todayLosses = weekLossesAll.filter((item) => item.timestamp >= (todayRange.from ?? "") && item.timestamp < (todayRange.to ?? future));
  const productCosts = new Map(products.map((product) => [product.id, product.costPrice]));
  const inventoryByProduct = new Map(inventory.map((item) => [item.productId, item]));
  const productViews: ProductInventoryView[] = products.map((product) => {
    const stock = inventoryByProduct.get(product.id);
    const quantityOnHand = stock?.quantityOnHand ?? 0;
    const lowStockThreshold = stock?.lowStockThreshold ?? settings.lowStockDefaultThreshold;
    return {
      ...product,
      quantityOnHand,
      lowStockThreshold,
      stockValue: quantityOnHand * product.costPrice,
      status: (quantityOnHand <= 0 ? "out" : quantityOnHand <= lowStockThreshold ? "low" : "healthy") as ProductInventoryView["status"],
    };
  }).sort((a, b) => {
    const order: Record<ProductInventoryView["status"], number> = { out: 0, low: 1, healthy: 2 };
    return order[a.status] - order[b.status] || a.quantityOnHand - b.quantityOnHand;
  });
  const lowStockIds = new Set(allLowStock.map((item) => item.productId));
  const lowStock = productViews.filter((product) => lowStockIds.has(product.id));

  const weekly = Array.from({ length: 7 }, (_, index) => dayWithOffset(now, index - 6));
  const grouped = new Map<string, DailyPoint>();
  weekly.forEach((day) => grouped.set(day.key, { date: day.key, label: day.label, sales: 0, purchases: 0, expenses: 0, losses: 0, profit: 0 }));
  weekSalesAll.forEach((item) => { const point = grouped.get(indiaDateKey(item.timestamp)); if (point) point.sales += item.totalAmount; });
  weekPurchasesAll.forEach((item) => { const point = grouped.get(indiaDateKey(item.timestamp)); if (point) point.purchases += item.totalAmount; });
  weekExpensesAll.forEach((item) => { const point = grouped.get(indiaDateKey(item.timestamp)); if (point) point.expenses += item.amount; });
  weekLossesAll.forEach((item) => { const point = grouped.get(indiaDateKey(item.timestamp)); if (point) point.losses += item.totalCost; });
  weekly.forEach((day) => {
    const dayEnd = new Date(day.start.getTime() + 24 * 60 * 60 * 1000);
    const rangeSales = weekSalesAll.filter((item) => item.timestamp >= day.start.toISOString() && item.timestamp < dayEnd.toISOString());
    const rangeExpenses = weekExpensesAll.filter((item) => item.timestamp >= day.start.toISOString() && item.timestamp < dayEnd.toISOString());
    const rangeLosses = weekLossesAll.filter((item) => item.timestamp >= day.start.toISOString() && item.timestamp < dayEnd.toISOString());
    const point = grouped.get(day.key);
    if (point) point.profit = profitOf(rangeSales, rangeExpenses, rangeLosses, productCosts);
  });

  const topMap = new Map<string, { productId: string; name: string; qty: number; revenue: number }>();
  weekSalesAll.forEach((sale) => sale.items.forEach((item) => {
    const entry = topMap.get(item.productId) ?? { productId: item.productId, name: item.productName, qty: 0, revenue: 0 };
    entry.qty += item.qty;
    entry.revenue += item.lineTotal;
    topMap.set(item.productId, entry);
  }));

  const activity: Activity[] = [
    ...recentSales.map((item) => ({ id: item.id, kind: "sale" as const, title: "Sale recorded", detail: itemSummary(item), amount: item.totalAmount, timestamp: item.timestamp, source: item.source })),
    ...recentPurchases.map((item) => ({ id: item.id, kind: "purchase" as const, title: "Stock received", detail: itemSummary(item), amount: item.totalAmount, timestamp: item.timestamp, source: item.source })),
    ...recentExpenses.map((item) => ({ id: item.id, kind: "expense" as const, title: `${item.category[0].toUpperCase()}${item.category.slice(1)} expense`, detail: item.note || item.category, amount: item.amount, timestamp: item.timestamp, source: item.source })),
    ...recentLosses.map((item) => ({ id: item.id, kind: "loss" as const, title: item.reason || "Stock loss", detail: `${item.qty} × ${item.productName}`, amount: item.totalCost, timestamp: item.timestamp, source: item.source })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 10);

  return {
    shop: { id: shopId, name: settings.shopName, ownerName: settings.ownerName, phone: settings.phone, address: settings.address, currency: settings.currency, lowStockDefaultThreshold: settings.lowStockDefaultThreshold },
    generatedAt: now.toISOString(),
    kpis: {
      todaySales: sumSales(todaySales),
      weekSales: sumSales(weekSalesAll),
      todayPurchases: sumPurchases(todayPurchases),
      weekPurchases: sumPurchases(weekPurchasesAll),
      todayExpenses: sumExpenses(todayExpenses),
      todayLosses: sumLosses(todayLosses),
      todayProfit: profitOf(todaySales, todayExpenses, todayLosses, productCosts),
      weekProfit: profitOf(weekSalesAll, weekExpensesAll, weekLossesAll, productCosts),
      inventoryValue: productViews.reduce((sum, product) => sum + product.stockValue, 0),
      totalUnits: inventory.reduce((sum, item) => sum + item.quantityOnHand, 0),
    },
    counts: { products: products.length, lowStock: lowStock.length, transactionsToday: todaySales.length + todayPurchases.length + todayExpenses.length + todayLosses.length },
    weekly: [...grouped.values()],
    products: productViews,
    lowStock,
    recentActivity: activity,
    topProducts: [...topMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
  };
}

export async function queryTotals(storage: StorageAdapter, shopId: string, period: Period) {
  const range = getPeriodRange(period);
  const [sales, purchases, expenses, losses] = await Promise.all([
    storage.querySales(shopId, range),
    storage.queryPurchases(shopId, range),
    storage.queryExpenses(shopId, range),
    storage.queryLosses(shopId, range),
  ]);
  const products = await storage.listProducts(shopId);
  const productCosts = new Map(products.map((product) => [product.id, product.costPrice]));
  return {
    sales, purchases, expenses, losses,
    salesTotal: sumSales(sales), purchaseTotal: sumPurchases(purchases), expenseTotal: sumExpenses(expenses), lossTotal: sumLosses(losses),
    profit: profitOf(sales, expenses, losses, productCosts),
  };
}

export function currency(value: number): string { return formatCurrency(value); }
