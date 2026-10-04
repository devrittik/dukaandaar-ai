export type Source = "voice" | "text" | "manual";
export type PaymentMethod = "cash" | "upi" | "credit";
export type ExpenseCategory = "rent" | "electricity" | "transport" | "staff" | "misc";

export interface Product {
  id: string;
  shopId: string;
  name: string;
  aliases: string[];
  category: string;
  unit: string;
  sellPrice: number;
  costPrice: number;
  createdAt: string;
  updatedAt: string;
}

export interface Inventory {
  id: string;
  shopId: string;
  productId: string;
  quantityOnHand: number;
  lowStockThreshold: number;
  lastRestockedAt: string | null;
  updatedAt: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
}

export interface Sale {
  id: string;
  shopId: string;
  timestamp: string;
  items: SaleItem[];
  totalAmount: number;
  paymentMethod: PaymentMethod;
  source: Source;
  rawTranscript?: string;
  confirmedByUser: boolean;
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  shopId: string;
  timestamp: string;
  items: PurchaseItem[];
  totalAmount: number;
  supplier: string;
  source: Source;
  rawTranscript?: string;
  confirmedByUser: boolean;
}

export interface Expense {
  id: string;
  shopId: string;
  timestamp: string;
  category: ExpenseCategory;
  amount: number;
  note: string;
  source: Source;
  rawTranscript?: string;
  confirmedByUser: boolean;
}

export interface Loss {
  id: string;
  shopId: string;
  timestamp: string;
  productId: string;
  productName: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  reason: string;
  source: Source;
  rawTranscript?: string;
  confirmedByUser: boolean;
}

export interface Settings {
  shopId: string;
  shopName: string;
  ownerName: string;
  phone: string;
  address: string;
  currency: "INR";
  language: string;
  lowStockDefaultThreshold: number;
  createdAt: string;
}

export type SettingsUpdate = Pick<Settings, "shopName" | "ownerName" | "phone" | "address" | "lowStockDefaultThreshold">;
export type ProductUpdate = Partial<Pick<Product, "name" | "aliases" | "category" | "unit" | "sellPrice" | "costPrice">> & { lowStockThreshold?: number };

export interface NewProduct {
  shopId: string;
  name: string;
  aliases: string[];
  category: string;
  unit: string;
  sellPrice: number;
  costPrice: number;
  openingStock: number;
  lowStockThreshold: number;
}

export type NewSale = Omit<Sale, "id">;
export type NewPurchase = Omit<Purchase, "id">;
export interface NewProductPurchase {
  shopId: string;
  timestamp: string;
  qty: number;
  unitCost: number;
  supplier: string;
  source: Source;
  rawTranscript?: string;
  confirmedByUser: boolean;
}
export type NewExpense = Omit<Expense, "id">;
export type NewLoss = Omit<Loss, "id">;

export interface TimeFilter {
  from?: string;
  to?: string;
  productId?: string;
}
