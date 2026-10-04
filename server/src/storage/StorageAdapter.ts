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

export interface StoredUserAccount {
  id: string;
  email: string;
  passwordHash: string;
  ownerName: string;
  shopId: string;
  createdAt: string;
}

export interface StoredAuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: Date;
}

export interface StorageAdapter {
  // Catalog
  listProducts(shopId: string): Promise<Product[]>;
  findProductByAlias(shopId: string, raw: string): Promise<Product | null>;
  createProduct(product: NewProduct): Promise<Product>;
  // Creates the catalog item, initial inventory, and first purchase history record as one operation.
  createProductWithInitialPurchase(product: NewProduct, purchase: NewProductPurchase): Promise<{ product: Product; purchase: Purchase }>;
  updateProduct(shopId: string, productId: string, changes: ProductUpdate): Promise<Product>;

  // Stock
  listInventory(shopId: string): Promise<Inventory[]>;
  getInventory(shopId: string, productId: string): Promise<Inventory | null>;
  adjustStock(shopId: string, productId: string, delta: number): Promise<Inventory>;
  listLowStock(shopId: string): Promise<Inventory[]>;

  // Ledger (stock-changing methods update stock and write the ledger record together)
  createSale(sale: NewSale): Promise<Sale>;
  createPurchase(purchase: NewPurchase): Promise<Purchase>;
  createExpense(expense: NewExpense): Promise<Expense>;
  createLoss(loss: NewLoss): Promise<Loss>;
  querySales(shopId: string, filter?: TimeFilter): Promise<Sale[]>;
  queryPurchases(shopId: string, filter?: TimeFilter): Promise<Purchase[]>;
  queryExpenses(shopId: string, filter?: TimeFilter): Promise<Expense[]>;
  queryLosses(shopId: string, filter?: TimeFilter): Promise<Loss[]>;
  getSettings(shopId: string): Promise<Settings>;
  updateSettings(shopId: string, changes: SettingsUpdate): Promise<Settings>;

  // Authentication accounts and revocable, server-side sessions
  createUser(user: StoredUserAccount): Promise<void>;
  findUserByEmail(email: string): Promise<StoredUserAccount | null>;
  findUserById(userId: string): Promise<StoredUserAccount | null>;
  deleteUserById(userId: string): Promise<void>;
  createAuthSession(session: StoredAuthSession): Promise<void>;
  findAuthSessionByTokenHash(tokenHash: string): Promise<StoredAuthSession | null>;
  deleteAuthSessionByTokenHash(tokenHash: string): Promise<void>;

  // Lifecycle and repeatable demo seed
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  seed(): Promise<void>;
}
