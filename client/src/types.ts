export type Source = "voice" | "text" | "manual";
export type EntryKind = "sale" | "purchase" | "expense" | "loss" | "product";
export type ExpenseCategory = "rent" | "electricity" | "transport" | "staff" | "misc";
export type PaymentMethod = "cash" | "upi" | "credit";

export interface AuthUser { id: string; email: string; ownerName: string; shopName: string; }
export interface Product {
  id: string; shopId: string; name: string; aliases: string[]; category: string; unit: string;
  sellPrice: number; costPrice: number; createdAt: string; updatedAt: string;
}
export interface ProductInventory extends Product {
  quantityOnHand: number; lowStockThreshold: number; stockValue: number; status: "healthy" | "low" | "out";
}
export interface SaleItem { productId: string; productName: string; qty: number; unitPrice: number; unitCost: number; lineTotal: number; }
export interface Sale { id: string; shopId: string; timestamp: string; items: SaleItem[]; totalAmount: number; paymentMethod: PaymentMethod; source: Source; rawTranscript?: string; confirmedByUser: boolean; }
export interface PurchaseItem { productId: string; productName: string; qty: number; unitCost: number; lineTotal: number; }
export interface Purchase { id: string; shopId: string; timestamp: string; items: PurchaseItem[]; totalAmount: number; supplier: string; source: Source; rawTranscript?: string; confirmedByUser: boolean; }
export interface Expense { id: string; shopId: string; timestamp: string; category: ExpenseCategory; amount: number; note: string; source: Source; rawTranscript?: string; confirmedByUser: boolean; }
export interface Loss { id: string; shopId: string; timestamp: string; productId: string; productName: string; qty: number; unitCost: number; totalCost: number; reason: string; source: Source; rawTranscript?: string; confirmedByUser: boolean; }
export interface DailyPoint { date: string; label: string; sales: number; purchases: number; expenses: number; losses: number; profit: number; }
export interface Activity { id: string; kind: "sale" | "purchase" | "expense" | "loss"; title: string; detail: string; amount: number; timestamp: string; source: string; }
export interface ShopSettings {
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
export type ShopSettingsUpdate = Pick<ShopSettings, "shopName" | "ownerName" | "phone" | "address" | "lowStockDefaultThreshold">;
export type ProductUpdate = Partial<Pick<Product, "name" | "aliases" | "category" | "unit" | "sellPrice" | "costPrice">> & { lowStockThreshold?: number };

export interface DashboardData {
  shop: { id: string; name: string; ownerName: string; phone: string; address: string; currency: string; lowStockDefaultThreshold: number };
  generatedAt: string;
  kpis: { todaySales: number; weekSales: number; todayPurchases: number; weekPurchases: number; todayExpenses: number; todayLosses: number; todayProfit: number; weekProfit: number; inventoryValue: number; totalUnits: number; };
  counts: { products: number; lowStock: number; transactionsToday: number };
  weekly: DailyPoint[];
  products: ProductInventory[];
  lowStock: ProductInventory[];
  recentActivity: Activity[];
  topProducts: Array<{ productId: string; name: string; qty: number; revenue: number }>;
}
export interface Health { ok: boolean; service: string; storage: string; }
export type SpeechProviderName = "elevenlabs" | "deepgram" | "sherpa-onnx";
export interface SpeechStatus {
  stt: { available: boolean; engine: SpeechProviderName | null; providers: SpeechProviderName[] };
  tts: { available: boolean; engine: SpeechProviderName | null; providers: SpeechProviderName[]; languages: string[] };
}
export interface PreviewLine { label: string; detail: string; amount?: number; }
export interface ActionPreview { kind: EntryKind; title: string; lines: PreviewLine[]; total?: number; note?: string; confidence: number; stockEffect?: string; editData?: Record<string, unknown>; }
export type ConversationLanguage = "en" | "hi" | "bn" | "fr" | "es" | "pt" | "ar" | "zh";
export type ParseProvider = "rules" | "ollama" | "hosted";
export interface ConversationTurn { role: "user"; text: string; }
export interface ParseResponse { mode: "answer" | "clarification" | "confirmation"; message: string; language: ConversationLanguage; provider: ParseProvider; fallback: boolean; confidence: number; pendingId?: string; preview?: ActionPreview; }
export interface ChatMessage { id: string; role: "assistant" | "user"; text: string; meta?: string; }
export interface TransactionsResponse { sales: Sale[]; purchases: Purchase[]; expenses: Expense[]; losses: Loss[]; }
