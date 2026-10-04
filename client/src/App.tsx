import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Activity, AlertTriangle, ArrowDownToLine, BarChart3, Bell, Boxes, ChevronDown, CircleDollarSign, CircleHelp, DollarSign, Home, LogOut, Menu, Package, PackagePlus, Plus, ReceiptText, Settings, ShoppingBag, Sparkles, Store, Truck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, ApiError, AUTH_SESSION_EXPIRED_EVENT } from "./api/client";
import { AssistantPanel } from "./components/AssistantPanel";
import { ActivityList, InventorySummary, InventoryTable, LowStockPanel, MetricCard, MoneyBreakdown, ProfitExplainer, TopProducts, WeeklyChart } from "./components/DashboardWidgets";
import { ManualEntryDialog } from "./components/ManualEntryDialog";
import { EditProductDialog } from "./components/EditProductDialog";
import { ShopSettingsPage } from "./components/ShopSettingsPage";
import { TransactionsPage } from "./components/TransactionsPage";
import { LandingPage } from "./components/LandingPage";
import { AuthPage, type AuthPageMode } from "./components/AuthPage";
import { Badge } from "./components/ui/Badge";
import { Button } from "./components/ui/Button";
import { Card } from "./components/ui/Card";
import type { AuthUser, ChatMessage, DashboardData, EntryKind, Health, ProductInventory, TransactionsResponse } from "./types";
import { uiText } from "./locales";
import { formatCurrency } from "./utils";

type View = "Assistant" | "Overview" | "Transactions" | "Inventory" | "Reports" | "Settings";

const CONVERSATION_SESSION_KEY = "dukaandaar.conversation-session";

function createConversationSessionId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getConversationSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(CONVERSATION_SESSION_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,128}$/.test(existing)) return existing;
    const created = createConversationSessionId();
    window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, created);
    return created;
  } catch {
    return createConversationSessionId();
  }
}

function rotateConversationSessionId(): string {
  const created = createConversationSessionId();
  try { window.sessionStorage.setItem(CONVERSATION_SESSION_KEY, created); }
  catch { /* The in-memory App state still provides a fresh session for this page. */ }
  return created;
}

const navItems: Array<{ label: View; icon: LucideIcon }> = [
  { label: "Assistant", icon: Sparkles }, { label: "Overview", icon: Home }, { label: "Transactions", icon: Activity }, { label: "Inventory", icon: Package }, { label: "Reports", icon: BarChart3 },
];
const actions: Array<{ kind: EntryKind; label: string; detail: string; icon: LucideIcon; tone: string }> = [
  { kind: "sale", label: "New sale", detail: "Record money in", icon: ShoppingBag, tone: "green" },
  { kind: "purchase", label: "Restock", detail: "Add stock", icon: ArrowDownToLine, tone: "blue" },
  { kind: "expense", label: "Expense", detail: "Log a cost", icon: ReceiptText, tone: "amber" },
  { kind: "loss", label: "Stock loss", detail: "Damaged / missing", icon: AlertTriangle, tone: "red" },
  { kind: "product", label: "Product", detail: "Add to catalog", icon: PackagePlus, tone: "slate" },
];

function dateHeader(): { greeting: string; date: string } {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  return { greeting, date };
}

function Sidebar({ view, setView, shopName, ownerName, health, productCount }: { view: View; setView: (view: View) => void; shopName: string; ownerName: string; health: Health | null; productCount: number }) {
  return <aside className="sidebar fixed inset-y-0 left-0 z-40 hidden w-[246px] flex-col border-r border-sidebar-line bg-sidebar text-white lg:flex">
    <div className="flex items-center gap-3 px-6 pb-7 pt-7"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary-light text-primary"><Store size={21} strokeWidth={2.1} /></div><div><p className="font-display text-[16px] font-extrabold tracking-[-.03em]">Dukaandaar</p><p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[.19em] text-white/55">Shop companion</p></div></div>
    <div className="px-4"><p className="px-3 pb-2 text-[9px] font-bold uppercase tracking-[.15em] text-white/40">Workspace</p><nav className="space-y-1">{navItems.map((item) => { const Icon = item.icon; const active = item.label === view; return <button key={item.label} type="button" onClick={() => setView(item.label)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition ${active ? "bg-white/12 text-white shadow-sm" : "text-white/65 hover:bg-white/7 hover:text-white"}`}><Icon size={17} className={active ? "text-primary-light" : "text-white/50 group-hover:text-white/80"} /><span className="flex-1">{item.label}</span>{item.label === "Inventory" ? <span className="grid h-5 min-w-5 place-items-center rounded-md bg-white/10 px-1 text-[9px] text-white/70">{productCount}</span> : null}</button>; })}</nav></div>
    <div className="mx-6 my-6 border-t border-white/10" />
    <div className="px-4"><p className="px-3 pb-2 text-[9px] font-bold uppercase tracking-[.15em] text-white/40">Shop tools</p><div className="space-y-1"><button type="button" onClick={() => setView("Settings")} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12px] font-medium transition ${view === "Settings" ? "bg-white/12 text-white" : "text-white/60 hover:bg-white/7 hover:text-white"}`}><Settings size={16} className="text-white/45" /> Shop settings</button></div></div>
    <div className="mt-auto p-4">
      <div className="rounded-2xl border border-white/10 bg-white/[.055] p-3.5"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10"><Sparkles size={15} className="text-primary-light" /></span><div className="min-w-0"><p className="truncate text-[11px] font-semibold">{shopName}</p><p className="mt-0.5 truncate text-[9px] text-white/50">{ownerName || "Single-shop workspace"}</p></div></div><div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2.5"><span className="flex items-center gap-1.5 text-[9px] text-white/50"><span className={`h-1.5 w-1.5 rounded-full ${health?.ok ? "bg-primary-light" : "bg-amber"}`} />{health?.ok ? "API online" : "Connecting"}</span></div></div>
      <p className="mt-3 text-center text-[9px] text-white/30">Private by design · Built for your shop</p>
    </div>
  </aside>;
}

function QuickActions({ onSelect }: { onSelect: (kind: EntryKind) => void }) {
  const toneClasses: Record<string, string> = {
    green: "bg-primary-light/60 text-primary group-hover:bg-primary group-hover:text-white", blue: "bg-blue-light text-blue group-hover:bg-blue group-hover:text-white", amber: "bg-amber-light text-amber group-hover:bg-amber group-hover:text-white", red: "bg-danger-light text-danger group-hover:bg-danger group-hover:text-white", slate: "bg-surface-subtle text-ink-soft group-hover:bg-ink-soft group-hover:text-white",
  };
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">{actions.map((action) => { const Icon = action.icon; const tone = toneClasses[action.tone] ?? ""; return <button key={action.kind} type="button" onClick={() => onSelect(action.kind)} className="group flex items-center gap-3 rounded-2xl border border-line bg-white px-3.5 py-3 text-left shadow-card transition duration-150 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-float sm:px-4"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition ${tone}`}><Icon size={17} /></span><span className="min-w-0"><span className="block truncate text-[12px] font-bold text-ink">{action.label}</span><span className="mt-0.5 block truncate text-[9px] text-muted">{action.detail}</span></span><Plus size={13} className="ml-auto hidden shrink-0 text-muted/65 group-hover:text-primary sm:block" /></button>; })}</div>;
}

function OverviewPage({ data, onManual, onNavigate }: { data: DashboardData; onManual: (kind: EntryKind) => void; onNavigate: (view: View) => void }) {
  const { greeting, date } = dateHeader();
  return <div className="space-y-5 animate-page-in">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2"><Badge tone="green" dot>Today · live overview</Badge><span className="text-[11px] text-muted">{date}</span></div><h1 className="font-display text-[26px] font-extrabold tracking-[-.04em] text-ink sm:text-[32px]">{greeting}, {data.shop.ownerName?.trim().split(/\s+/)[0] || "there"}<span className="text-primary">.</span></h1><p className="mt-1.5 text-sm text-muted">A quick look at how <span className="font-semibold text-ink-soft">{data.shop.name}</span> is doing.</p></div>
      <Button onClick={() => onManual("sale")} className="shadow-card"><Plus size={16} />New entry</Button>
    </div>

    <QuickActions onSelect={onManual} />

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MetricCard label="Sales today" value={formatCurrency(data.kpis.todaySales)} note={`This week ${formatCurrency(data.kpis.weekSales)}`} icon={DollarSign} tone="green" trend="up" />
      <MetricCard label="Purchases today" value={formatCurrency(data.kpis.todayPurchases)} note={`This week ${formatCurrency(data.kpis.weekPurchases)}`} icon={Truck} tone="blue" />
      <MetricCard label="Net profit today" value={formatCurrency(data.kpis.todayProfit)} note={`This week ${formatCurrency(data.kpis.weekProfit)}`} icon={CircleDollarSign} tone={data.kpis.todayProfit >= 0 ? "green" : "red"} trend={data.kpis.todayProfit >= 0 ? "up" : "down"} />
      <MetricCard label="Expenses + losses" value={formatCurrency(data.kpis.todayExpenses + data.kpis.todayLosses)} note={`${formatCurrency(data.kpis.todayExpenses)} expenses · ${formatCurrency(data.kpis.todayLosses)} losses`} icon={ReceiptText} tone="amber" />
    </div>

    <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1.58fr)_minmax(360px,.9fr)]">
      <div className="min-w-0 space-y-5">
        <WeeklyChart data={data.weekly} />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.04fr)_minmax(280px,.96fr)]"><LowStockPanel products={data.lowStock} onInventory={() => onNavigate("Inventory")} /><InventorySummary data={data} /></div>
        <InventoryTable products={data.products} compact />
        <div className="grid gap-5 xl:grid-cols-2"><TopProducts products={data.topProducts} /><ProfitExplainer data={data} /></div>
      </div>
      <div className="flex min-w-0 flex-col gap-5"><MoneyBreakdown data={data} /><ActivityList activity={data.recentActivity} compact /></div>
    </div>
  </div>;
}

function AssistantPage({ health, onMutation, onEdit, sessionId, onNewConversation, messages, setMessages }: { health: Health | null; onMutation: () => void; onEdit: (kind: EntryKind, data: Record<string, unknown>) => void; sessionId: string; onNewConversation: () => void; messages: ChatMessage[]; setMessages: Dispatch<SetStateAction<ChatMessage[]>> }) {
  return <div className="assistant-page animate-page-in"><AssistantPanel health={health} onMutation={onMutation} onEdit={onEdit} sessionId={sessionId} onNewConversation={onNewConversation} messages={messages} setMessages={setMessages} /></div>;
}

function InventoryPage({ data, onManual, onMutation }: { data: DashboardData; onManual: (kind: EntryKind) => void; onMutation: () => void }) {
  const [editingProduct, setEditingProduct] = useState<ProductInventory | null>(null);
  return <>
    <div className="space-y-5 animate-page-in"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[.13em] text-primary">Catalog & stock</p><h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Inventory</h1><p className="mt-1.5 text-sm text-muted">Keep the shelf count and product details in one place.</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => onManual("purchase")}><ArrowDownToLine size={14} />Restock</Button><Button size="sm" variant="outline" onClick={() => onManual("loss")}><AlertTriangle size={14} />Record loss</Button><Button onClick={() => onManual("product")}><PackagePlus size={16} />Add product</Button></div></div>
      <div className="grid gap-5"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><MetricCard label="Products" value={String(data.counts.products)} note="In your shop catalog" icon={Package} tone="green" /><MetricCard label="Units on hand" value={new Intl.NumberFormat("en-IN").format(data.kpis.totalUnits)} note="Across all products" icon={Boxes} tone="blue" /><MetricCard label="Stock at cost" value={formatCurrency(data.kpis.inventoryValue)} note={`${data.counts.lowStock} items need attention`} icon={CircleDollarSign} tone={data.counts.lowStock ? "amber" : "green"} /></div><InventoryTable products={data.products} onAddProduct={() => onManual("product")} onEditProduct={setEditingProduct} /></div>
    </div>
    {editingProduct ? <EditProductDialog product={editingProduct} open onOpenChange={(open) => { if (!open) setEditingProduct(null); }} onSaved={() => { setEditingProduct(null); onMutation(); }} /> : null}
  </>;
}

function ReportsPage({ data, onNavigate }: { data: DashboardData; onNavigate: (view: View) => void }) {
  const weeklySummary = useMemo(() => data.weekly.reduce((summary, day) => ({ sales: summary.sales + day.sales, purchases: summary.purchases + day.purchases, profit: summary.profit + day.profit, expenses: summary.expenses + day.expenses, losses: summary.losses + day.losses }), { sales: 0, purchases: 0, profit: 0, expenses: 0, losses: 0 }), [data.weekly]);
  return <div className="space-y-5 animate-page-in"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[.13em] text-primary">Numbers you can trust</p><h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Reports & profit</h1><p className="mt-1.5 text-sm text-muted">Real totals from your ledger—no AI guesses.</p></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><MetricCard label="Sales · 7 days" value={formatCurrency(weeklySummary.sales)} note="Sales revenue" icon={DollarSign} tone="green" /><MetricCard label="Purchases · 7 days" value={formatCurrency(weeklySummary.purchases)} note="Restocking spend" icon={Truck} tone="blue" /><MetricCard label="Net profit · 7 days" value={formatCurrency(weeklySummary.profit)} note="After expenses & losses" icon={CircleDollarSign} tone="green" /><MetricCard label="Expenses + losses" value={formatCurrency(weeklySummary.expenses + weeklySummary.losses)} note={`${formatCurrency(weeklySummary.expenses)} running costs · ${formatCurrency(weeklySummary.losses)} losses`} icon={ReceiptText} tone="amber" /></div>
    <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(330px,.75fr)]"><div className="space-y-5"><WeeklyChart data={data.weekly} /><Card><div className="flex items-start justify-between gap-4"><div><h2 className="font-display text-[16px] font-bold text-ink">Daily breakdown</h2><p className="mt-1 text-xs text-muted">Seven-day sales, restocking, and net profit</p></div><Badge tone="gray">Last 7 days</Badge></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[570px] text-left"><thead><tr className="border-b border-line text-[10px] uppercase tracking-wider text-muted"><th className="py-2 font-semibold">Day</th><th className="py-2 font-semibold">Sales</th><th className="py-2 font-semibold">Purchases</th><th className="py-2 font-semibold">Expenses + loss</th><th className="py-2 text-right font-semibold">Profit</th></tr></thead><tbody>{data.weekly.map((day) => <tr key={day.date} className="border-b border-line/70 last:border-0"><td className="py-3 text-xs font-semibold text-ink">{day.label}</td><td className="py-3 text-xs tabular-nums text-ink-soft">{formatCurrency(day.sales)}</td><td className="py-3 text-xs tabular-nums text-ink-soft">{formatCurrency(day.purchases)}</td><td className="py-3 text-xs tabular-nums text-ink-soft">{formatCurrency(day.expenses + day.losses)}</td><td className={`py-3 text-right text-xs font-bold tabular-nums ${day.profit >= 0 ? "text-primary" : "text-danger"}`}>{formatCurrency(day.profit)}</td></tr>)}</tbody></table></div></Card></div><div className="space-y-5"><TopProducts products={data.topProducts} /><MoneyBreakdown data={data} /><Card><h2 className="font-display text-[15px] font-bold text-ink">How we calculate profit</h2><p className="mt-2 text-xs leading-5 text-muted">Sales revenue minus the cost of the items sold, then minus operating expenses and stock lost to damage or spoilage. A purchase adds inventory, so it is not deducted until that stock sells.</p><button type="button" onClick={() => onNavigate("Transactions")} className="mt-3 text-xs font-semibold text-primary hover:text-primary-dark">Review ledger →</button></Card></div></div>
  </div>;
}

function LoadingState() { return <div className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center px-6 text-center"><div className="grid h-14 w-14 animate-pulse place-items-center rounded-[20px] bg-primary-light text-primary"><Store size={25} /></div><h2 className="mt-5 font-display text-lg font-bold text-ink">Opening your shop</h2><p className="mt-1 text-sm text-muted">Fetching today’s sales, stock and ledger…</p><div className="mt-5 h-1.5 w-40 overflow-hidden rounded-full bg-line"><div className="h-full w-2/3 animate-loading rounded-full bg-primary" /></div></div>; }

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="mx-auto mt-20 max-w-md rounded-card border border-danger/15 bg-white p-7 text-center shadow-card"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-danger-light text-danger"><CircleHelp size={22} /></span><h2 className="mt-4 font-display text-lg font-bold text-ink">Couldn’t reach the shop ledger</h2><p className="mt-2 text-sm leading-6 text-muted">{message}. Make sure the server is running, then try again.</p><Button onClick={onRetry} className="mt-5">Try again</Button></div>; }

export default function App() {
  const [view, setView] = useState<View>("Assistant");
  const [conversationSessionId, setConversationSessionId] = useState<string>(getConversationSessionId);
  const [assistantMessages, setAssistantMessages] = useState<ChatMessage[]>(() => [{ id: "welcome", role: "assistant", text: uiText("en", "welcome"), meta: uiText("en", "yourAssistant") }]);
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authPage, setAuthPage] = useState<"landing" | AuthPageMode>("landing");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [transactions, setTransactions] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryKind, setEntryKind] = useState<EntryKind>("sale");
  const [entryInitialData, setEntryInitialData] = useState<Record<string, unknown> | null>(null);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  const refresh = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      console.log("[dashboard] loading current shop data");
      const [nextDashboard, nextHealth] = await Promise.all([api.dashboard(), api.health()]);
      setDashboard(nextDashboard); setHealth(nextHealth); setError("");
      console.log("[dashboard] data ready", { products: nextDashboard.products.length, transactions: nextDashboard.counts.transactionsToday });
    } catch (caught) {
      console.error("[dashboard] refresh failed", caught);
      setError(caught instanceof Error ? caught.message : "The server is unavailable.");
      if (caught instanceof ApiError && caught.status === 401) {
        setAuthUser(null);
        setAuthPage("login");
        setDashboard(null); setHealth(null); setTransactions(null);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    void api.currentUser().then((user) => {
      if (active) setAuthUser(user);
    }).catch((caught) => {
      console.warn("[auth] could not restore the saved sign-in", caught);
      if (active) setAuthUser(null);
    }).finally(() => {
      if (active) setAuthReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const expireSession = () => {
      setAuthUser(null); setAuthPage("login"); setDashboard(null); setHealth(null); setTransactions(null); setError("");
    };
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expireSession);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expireSession);
  }, []);

  useEffect(() => {
    if (authUser) void refresh(true);
    else if (authReady) {
      setDashboard(null); setHealth(null); setTransactions(null); setError(""); setLoading(false);
    }
  }, [authReady, authUser, refresh]);

  useEffect(() => {
    if (authUser && view === "Transactions") {
      void api.transactions().then(setTransactions).catch((caught) => console.error("[transactions] load failed", caught));
    }
  }, [view, authUser]);

  const openEntry = (kind: EntryKind, initialData?: Record<string, unknown>) => { console.log(`[manual] open entry kind=${kind}${initialData ? " with parsed values" : ""}`); setEntryKind(kind); setEntryInitialData(initialData ?? null); setEntryOpen(true); };
  const savedEntry = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3600);
    void refresh();
  };
  const handleNavigate = (next: View) => { console.log(`[navigation] ${view} -> ${next}`); setView(next); setMobileNav(false); };
  const handleAuthenticated = (user: AuthUser) => {
    setAuthUser(user); setAuthPage("landing"); setView("Assistant");
    setDashboard(null); setHealth(null); setTransactions(null); setError(""); setLoading(true);
    setAssistantMessages([{ id: "welcome", role: "assistant", text: uiText("en", "welcome"), meta: uiText("en", "yourAssistant") }]);
    setConversationSessionId(rotateConversationSessionId());
  };
  const handleLogout = async () => {
    try { await api.logout(); }
    catch (caught) { console.warn("[auth] logout request failed; clearing this browser session", caught); }
    setAuthUser(null); setAuthPage("landing"); setDashboard(null); setHealth(null); setTransactions(null); setError("");
    setAssistantMessages([{ id: "welcome", role: "assistant", text: uiText("en", "welcome"), meta: uiText("en", "yourAssistant") }]);
    setConversationSessionId(rotateConversationSessionId());
  };
  const pageDate = useMemo(() => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date()), []);

  if (!authReady) return <div className="grid min-h-screen place-items-center bg-[#f5f7f4] px-5"><div className="text-center"><span className="mx-auto grid h-12 w-12 animate-pulse place-items-center rounded-[17px] bg-primary text-white"><Store size={21} /></span><p className="mt-4 text-sm font-semibold text-ink">Preparing your shop space…</p></div></div>;
  if (!authUser) {
    if (authPage === "landing") return <LandingPage onSignUp={() => setAuthPage("signup")} onLogin={() => setAuthPage("login")} />;
    return <AuthPage mode={authPage} onModeChange={setAuthPage} onBack={() => setAuthPage("landing")} onAuthenticated={handleAuthenticated} />;
  }

  const sidebar = <Sidebar view={view} setView={handleNavigate} shopName={dashboard?.shop.name ?? "Shop"} ownerName={dashboard?.shop.ownerName ?? "Shop owner"} health={health} productCount={dashboard?.counts.products ?? 0} />;
  return <div className="min-h-screen bg-surface-subtle text-ink">
    {sidebar}
    <div className="min-h-screen lg:pl-[246px]">
      <header className="sticky top-0 z-30 flex h-[62px] items-center justify-between border-b border-line/90 bg-surface-subtle/95 px-4 backdrop-blur-xl sm:px-7 lg:px-9">
        <div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-white lg:hidden"><Store size={16} /></div><button type="button" className="hidden text-xs font-medium text-muted hover:text-ink sm:block" onClick={() => handleNavigate("Overview")}>Workspace <span className="px-1.5 text-line">/</span><span className="font-semibold text-ink-soft">{view}</span></button><span className="text-xs font-semibold text-ink sm:hidden">{view}</span></div>
        <div className="flex items-center gap-2.5"><span className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[10px] font-medium text-ink-soft sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{health?.storage === "mongo" ? "MongoDB connected" : "In-memory mode"}</span><button type="button" className="relative grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-white hover:text-ink" aria-label="Notifications"><Bell size={17} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-amber" /></button><div className="hidden h-7 w-px bg-line sm:block"/><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-xl bg-avatar text-[10px] font-bold text-avatar-ink">{(dashboard?.shop.ownerName || "Shop owner").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div><div className="hidden sm:block"><p className="text-[11px] font-bold text-ink">{dashboard?.shop.ownerName || "Shop owner"}</p><p className="text-[9px] text-muted">Shop owner</p></div><ChevronDown size={13} className="hidden text-muted sm:block" /></div><button type="button" onClick={() => void handleLogout()} title="Sign out" aria-label="Sign out" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2 text-muted transition hover:bg-white hover:text-primary sm:px-3"><LogOut size={15} /><span className="hidden text-[10px] font-semibold sm:inline">Sign out</span></button><button type="button" onClick={() => setMobileNav((current) => !current)} className="grid h-9 w-9 place-items-center rounded-xl text-ink-soft hover:bg-white lg:hidden" aria-label="Open menu">{mobileNav ? <X size={18} /> : <Menu size={18} />}</button></div>
      </header>
      {mobileNav ? <div className="mobile-nav fixed inset-x-0 top-[62px] z-40 overflow-x-auto border-b border-line bg-white p-3 shadow-float lg:hidden"><div className="flex min-w-max gap-2">{navItems.map((item) => { const Icon = item.icon; return <button key={item.label} onClick={() => handleNavigate(item.label)} className={`flex min-w-[64px] flex-col items-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-2 text-[10px] font-semibold ${view === item.label ? "bg-primary-light text-primary" : "text-muted"}`}><Icon size={17}/>{item.label}</button>; })}<button onClick={() => handleNavigate("Settings")} className={`flex min-w-[64px] flex-col items-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-2 text-[10px] font-semibold ${view === "Settings" ? "bg-primary-light text-primary" : "text-muted"}`}><Settings size={17}/>Settings</button></div></div> : null}
      <main className="mx-auto max-w-[1600px] px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pt-7">
        {loading && !dashboard ? <LoadingState /> : error && !dashboard ? <ErrorState message={error} onRetry={() => void refresh(true)} /> : dashboard ? view === "Assistant" ? <AssistantPage health={health} onMutation={() => void refresh()} onEdit={(kind, data) => openEntry(kind, data)} sessionId={conversationSessionId} onNewConversation={() => setConversationSessionId(rotateConversationSessionId())} messages={assistantMessages} setMessages={setAssistantMessages} /> : view === "Overview" ? <OverviewPage data={dashboard} onManual={openEntry} onNavigate={handleNavigate} /> : view === "Inventory" ? <InventoryPage data={dashboard} onManual={openEntry} onMutation={() => void refresh()} /> : view === "Reports" ? <ReportsPage data={dashboard} onNavigate={handleNavigate} /> : view === "Settings" ? <ShopSettingsPage onSaved={() => void refresh()} /> : <TransactionsPage transactions={transactions} onAdd={() => openEntry("sale")} /> : null}
      </main>
      <footer className="flex items-center justify-between border-t border-line/80 px-4 py-4 text-[9px] text-muted sm:px-7 lg:px-9"><span>© 2026 Dukaandaar · Made for the shop floor</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary"/>Updated just now · {pageDate}</span></footer>
    </div>

    {dashboard ? <ManualEntryDialog open={entryOpen} kind={entryKind} products={dashboard.products} initialData={entryInitialData} defaultLowStockThreshold={dashboard.shop.lowStockDefaultThreshold} onOpenChange={setEntryOpen} onSaved={savedEntry} /> : null}
    {toast ? <div role="status" className="fixed bottom-5 right-5 z-[70] flex max-w-[min(92vw,420px)] items-center gap-3 rounded-2xl border border-primary/10 bg-white px-4 py-3 text-sm font-semibold text-ink shadow-float animate-toast-in"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary-light text-primary"><Sparkles size={16}/></span><span>{toast}</span><button type="button" onClick={() => setToast("")} className="ml-2 text-muted hover:text-ink" aria-label="Dismiss"><X size={15}/></button></div> : null}
  </div>;
}
