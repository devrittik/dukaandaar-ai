import type { Expense, Inventory, Loss, Product, Purchase, Sale, Settings } from "./types.js";

function indiaTime(daysFromToday: number, hour: number, minute = 0): string {
  const offset = 330 * 60_000;
  const indiaNow = new Date(Date.now() + offset);
  indiaNow.setUTCDate(indiaNow.getUTCDate() + daysFromToday);
  indiaNow.setUTCHours(hour, minute, 0, 0);
  return new Date(indiaNow.getTime() - offset).toISOString();
}

function sale(
  id: string,
  shopId: string,
  timestamp: string,
  rows: Array<[string, string, number, number, number]>,
  source: Sale["source"] = "voice",
): Sale {
  const items = rows.map(([productId, productName, qty, unitPrice, unitCost]) => ({
    productId,
    productName,
    qty,
    unitPrice,
    unitCost,
    lineTotal: qty * unitPrice,
  }));
  return {
    id,
    shopId,
    timestamp,
    items,
    totalAmount: items.reduce((sum, item) => sum + item.lineTotal, 0),
    paymentMethod: "cash",
    source,
    rawTranscript: "Demo data",
    confirmedByUser: true,
  };
}

function purchase(
  id: string,
  shopId: string,
  timestamp: string,
  rows: Array<[string, string, number, number]>,
  supplier = "Local Distributor",
): Purchase {
  const items = rows.map(([productId, productName, qty, unitCost]) => ({
    productId,
    productName,
    qty,
    unitCost,
    lineTotal: qty * unitCost,
  }));
  return {
    id,
    shopId,
    timestamp,
    items,
    totalAmount: items.reduce((sum, item) => sum + item.lineTotal, 0),
    supplier,
    source: "manual",
    rawTranscript: "Demo data",
    confirmedByUser: true,
  };
}

export interface SeedData {
  products: Product[];
  inventory: Inventory[];
  sales: Sale[];
  purchases: Purchase[];
  expenses: Expense[];
  losses: Loss[];
  settings: Settings;
}

export function buildSeedData(shopId = process.env.SHOP_ID ?? "shop_001"): SeedData {
  const now = new Date().toISOString();
  const specs = [
    { id: "prod_maggi", name: "Maggi Noodles", aliases: ["maggi", "instant noodles", "2 minute noodles", "noodle packet"], category: "Snacks", unit: "packet", sellPrice: 14, costPrice: 10, stock: 37, threshold: 10 },
    { id: "prod_coke", name: "Coca-Cola 300ml", aliases: ["coke", "coca cola", "cola", "cola drink", "soft drink"], category: "Beverages", unit: "bottle", sellPrice: 40, costPrice: 28, stock: 11, threshold: 8 },
    { id: "prod_parleg", name: "Parle-G Biscuits", aliases: ["parle g", "parle g biscuits", "biscuits", "biscuit", "cookies"], category: "Biscuits", unit: "packet", sellPrice: 5, costPrice: 3, stock: 6, threshold: 12 },
    { id: "prod_goodday", name: "Good Day Biscuits", aliases: ["good day", "good day biscuit", "biscuit", "cookies", "tea biscuits"], category: "Biscuits", unit: "packet", sellPrice: 20, costPrice: 14, stock: 3, threshold: 6 },
    { id: "prod_milk", name: "Amul Milk 500ml", aliases: ["amul milk", "milk", "dairy milk", "milk pouch", "milk packet"], category: "Dairy", unit: "pouch", sellPrice: 30, costPrice: 25, stock: 9, threshold: 10 },
    { id: "prod_lays", name: "Lay's Classic", aliases: ["lays", "lays chips", "chips", "potato chips", "crisps"], category: "Snacks", unit: "packet", sellPrice: 20, costPrice: 13, stock: 22, threshold: 8 },
    { id: "prod_sugar", name: "Sugar 1kg", aliases: ["sugar", "white sugar", "granulated sugar", "table sugar", "cooking sugar"], category: "Staples", unit: "kg", sellPrice: 52, costPrice: 45, stock: 4, threshold: 8 },
    { id: "prod_tea", name: "Tata Tea Gold", aliases: ["tata tea", "tea", "tea leaves", "black tea", "tea powder"], category: "Beverages", unit: "packet", sellPrice: 120, costPrice: 95, stock: 15, threshold: 5 },
  ];

  const products: Product[] = specs.map(({ stock: _stock, threshold: _threshold, ...product }) => ({
    ...product,
    shopId,
    createdAt: now,
    updatedAt: now,
  }));
  const inventory: Inventory[] = specs.map((product) => ({
    id: `inv_${product.id}`,
    shopId,
    productId: product.id,
    quantityOnHand: product.stock,
    lowStockThreshold: product.threshold,
    lastRestockedAt: indiaTime(-1, 10, 15),
    updatedAt: now,
  }));

  const sales: Sale[] = [
    sale("sale_today_1", shopId, indiaTime(0, 9, 20), [
      ["prod_maggi", "Maggi Noodles", 5, 14, 10],
      ["prod_coke", "Coca-Cola 300ml", 3, 40, 28],
    ]),
    sale("sale_today_2", shopId, indiaTime(0, 11, 5), [
      ["prod_maggi", "Maggi Noodles", 10, 14, 10],
      ["prod_coke", "Coca-Cola 300ml", 4, 40, 28],
      ["prod_milk", "Amul Milk 500ml", 4, 30, 25],
      ["prod_lays", "Lay's Classic", 5, 20, 13],
      ["prod_goodday", "Good Day Biscuits", 5, 20, 14],
      ["prod_parleg", "Parle-G Biscuits", 6, 5, 3],
    ]),
    sale("sale_today_3", shopId, indiaTime(0, 13, 40), [
      ["prod_maggi", "Maggi Noodles", 20, 14, 10],
      ["prod_coke", "Coca-Cola 300ml", 10, 40, 28],
      ["prod_milk", "Amul Milk 500ml", 6, 30, 25],
      ["prod_lays", "Lay's Classic", 5, 20, 13],
      ["prod_parleg", "Parle-G Biscuits", 8, 5, 3],
    ]),
  ];

  const dailyBaskets: Array<Array<[string, string, number, number, number]>> = [
    [["prod_maggi", "Maggi Noodles", 14, 14, 10], ["prod_coke", "Coca-Cola 300ml", 7, 40, 28], ["prod_lays", "Lay's Classic", 11, 20, 13]],
    [["prod_milk", "Amul Milk 500ml", 12, 30, 25], ["prod_maggi", "Maggi Noodles", 11, 14, 10], ["prod_tea", "Tata Tea Gold", 4, 120, 95]],
    [["prod_coke", "Coca-Cola 300ml", 12, 40, 28], ["prod_parleg", "Parle-G Biscuits", 20, 5, 3], ["prod_sugar", "Sugar 1kg", 4, 52, 45]],
    [["prod_lays", "Lay's Classic", 16, 20, 13], ["prod_goodday", "Good Day Biscuits", 12, 20, 14], ["prod_maggi", "Maggi Noodles", 15, 14, 10]],
    [["prod_tea", "Tata Tea Gold", 6, 120, 95], ["prod_milk", "Amul Milk 500ml", 14, 30, 25], ["prod_coke", "Coca-Cola 300ml", 9, 40, 28]],
    [["prod_maggi", "Maggi Noodles", 18, 14, 10], ["prod_lays", "Lay's Classic", 14, 20, 13], ["prod_parleg", "Parle-G Biscuits", 24, 5, 3]],
  ];
  dailyBaskets.forEach((basket, index) => {
    sales.push(sale(`sale_week_${index + 1}`, shopId, indiaTime(-(index + 1), 10 + (index % 4), 25), basket));
  });

  const purchases: Purchase[] = [
    purchase("purchase_today_1", shopId, indiaTime(0, 8, 35), [
      ["prod_maggi", "Maggi Noodles", 100, 10],
      ["prod_coke", "Coca-Cola 300ml", 30, 28],
      ["prod_milk", "Amul Milk 500ml", 20, 25],
      ["prod_parleg", "Parle-G Biscuits", 40, 3],
    ]),
    purchase("purchase_yesterday_1", shopId, indiaTime(-1, 9, 10), [
      ["prod_tea", "Tata Tea Gold", 10, 95],
      ["prod_sugar", "Sugar 1kg", 25, 45],
    ]),
    purchase("purchase_week_1", shopId, indiaTime(-4, 8, 55), [
      ["prod_lays", "Lay's Classic", 40, 13],
      ["prod_goodday", "Good Day Biscuits", 24, 14],
    ]),
  ];

  const expenses: Expense[] = [
    { id: "expense_today_1", shopId, timestamp: indiaTime(0, 10, 10), category: "electricity", amount: 320, note: "Electricity bill", source: "text", rawTranscript: "Paid 320 for the electricity bill", confirmedByUser: true },
    { id: "expense_today_2", shopId, timestamp: indiaTime(0, 12, 20), category: "transport", amount: 80, note: "Delivery and transport", source: "manual", confirmedByUser: true },
    { id: "expense_yesterday_1", shopId, timestamp: indiaTime(-1, 16, 0), category: "misc", amount: 150, note: "Shop supplies", source: "manual", confirmedByUser: true },
    { id: "expense_week_1", shopId, timestamp: indiaTime(-3, 11, 30), category: "rent", amount: 2500, note: "Weekly rent contribution", source: "manual", confirmedByUser: true },
  ];

  const losses: Loss[] = [
    { id: "loss_today_1", shopId, timestamp: indiaTime(0, 12, 45), productId: "prod_parleg", productName: "Parle-G Biscuits", qty: 4, unitCost: 3, totalCost: 12, reason: "Rat damage", source: "text", rawTranscript: "A rat ate 4 biscuit packets", confirmedByUser: true },
    { id: "loss_yesterday_1", shopId, timestamp: indiaTime(-1, 15, 30), productId: "prod_milk", productName: "Amul Milk 500ml", qty: 2, unitCost: 25, totalCost: 50, reason: "Spoiled milk", source: "manual", confirmedByUser: true },
  ];

  const settings: Settings = {
    shopId,
    shopName: "Ramesh General Store",
    ownerName: "Ramesh Kumar",
    phone: "",
    address: "",
    currency: "INR",
    language: "en-IN",
    lowStockDefaultThreshold: 10,
    createdAt: now,
  };

  return { products, inventory, sales, purchases, expenses, losses, settings };
}
