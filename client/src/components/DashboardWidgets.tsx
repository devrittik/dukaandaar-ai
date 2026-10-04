import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, Boxes, ChevronRight, CircleDollarSign, Clock3, Package, Pencil, ReceiptText, ShoppingBag, TrendingDown, TrendingUp, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Activity, DashboardData, DailyPoint, ProductInventory } from "../types";
import { formatCurrency, formatNumber, formatTime, initials } from "../utils";
import { Badge, type BadgeTone } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const kindStyle: Record<Activity["kind"], { icon: LucideIcon; tone: BadgeTone; sign: string }> = {
  sale: { icon: ShoppingBag, tone: "green", sign: "+" },
  purchase: { icon: Truck, tone: "blue", sign: "−" },
  expense: { icon: ReceiptText, tone: "amber", sign: "−" },
  loss: { icon: AlertTriangle, tone: "red", sign: "−" },
};

export function MetricCard({ label, value, note, icon: Icon, tone = "green", trend }: {
  label: string; value: string; note: string; icon: LucideIcon; tone?: "green" | "blue" | "amber" | "red"; trend?: "up" | "down";
}) {
  const iconClass = { green: "bg-primary-light text-primary", blue: "bg-blue-light text-blue", amber: "bg-amber-light text-amber", red: "bg-danger-light text-danger" }[tone];
  return <Card className="metric-card relative overflow-hidden p-4 sm:p-5">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0"><p className="truncate text-xs font-semibold text-muted">{label}</p><p className="mt-2 font-display text-[25px] font-extrabold leading-none tracking-[-.045em] text-ink sm:text-[28px]">{value}</p></div>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${iconClass}`}><Icon size={19} strokeWidth={1.9} /></span>
    </div>
    <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted">{trend ? trend === "up" ? <TrendingUp size={13} className="text-primary" /> : <TrendingDown size={13} className="text-danger" /> : null}<span>{note}</span></div>
  </Card>;
}

function formatAxis(value: number): string {
  if (value >= 1000) return `₹${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(value)}`;
}

export function WeeklyChart({ data }: { data: DailyPoint[] }) {
  const [mode, setMode] = useState<"sales" | "purchases">("sales");
  const values = data.map((point) => mode === "sales" ? point.sales : point.purchases);
  const max = Math.max(1000, ...values);
  const yTicks = [max, max * 0.66, max * 0.33, 0];
  const total = values.reduce((sum, value) => sum + value, 0);
  return <Card className="min-w-0">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><h2 className="font-display text-[16px] font-bold text-ink">Weekly overview</h2><Badge tone="gray">Last 7 days</Badge></div><p className="mt-1 text-xs text-muted">{mode === "sales" ? "Sales recorded" : "Stock purchases"} · <span className="font-semibold text-ink-soft">{formatCurrency(total)}</span></p></div>
      <div className="flex items-center rounded-xl bg-surface-subtle p-1">
        <button type="button" onClick={() => setMode("sales")} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${mode === "sales" ? "bg-white text-primary shadow-sm" : "text-muted hover:text-ink"}`}>Sales</button>
        <button type="button" onClick={() => setMode("purchases")} className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${mode === "purchases" ? "bg-white text-blue shadow-sm" : "text-muted hover:text-ink"}`}>Purchases</button>
      </div>
    </div>
    <div className="mt-5 flex h-[190px] min-w-0 gap-2 sm:gap-3">
      <div className="flex w-9 shrink-0 flex-col justify-between pb-6 pt-1 text-right text-[9px] tabular-nums text-muted/75">{yTicks.map((tick, index) => <span key={index}>{formatAxis(tick)}</span>)}</div>
      <div className="relative flex min-w-0 flex-1 items-stretch">
        <div className="pointer-events-none absolute inset-x-0 top-1 bottom-6 flex flex-col justify-between">{[0, 1, 2, 3].map((line) => <div key={line} className="border-t border-dashed border-line" />)}</div>
        <div className="relative z-[1] flex w-full items-end justify-around gap-1.5 pb-0.5 sm:gap-3">
          {data.map((point, index) => {
            const value = mode === "sales" ? point.sales : point.purchases;
            const ratio = value > 0 ? Math.max(5, (value / max) * 100) : 2;
            const active = index === data.length - 1;
            return <div key={point.date} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
              <div className="relative flex h-[calc(100%-24px)] w-full max-w-[30px] items-end justify-center">
                <div className={`w-full rounded-t-[7px] transition-all ${active ? mode === "sales" ? "bg-primary" : "bg-blue" : mode === "sales" ? "bg-primary/35 group-hover:bg-primary/60" : "bg-blue/35 group-hover:bg-blue/60"}`} style={{ height: `${ratio}%` }} title={`${point.label}: ${formatCurrency(value)}`} />
                <div className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[10px] font-semibold text-white opacity-0 shadow-lg transition group-hover:opacity-100">{formatCurrency(value)}</div>
              </div>
              <span className={`text-[10px] font-medium ${active ? "text-primary" : "text-muted"}`}>{point.label}</span>
            </div>;
          })}
        </div>
      </div>
    </div>
    <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[10px] text-muted">
      <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-sm ${mode === "sales" ? "bg-primary" : "bg-blue"}`} />{mode === "sales" ? "Sales" : "Purchases"}</span>
      <span>Daily profit includes expenses and stock loss</span>
    </div>
  </Card>;
}

function CategoryIcon({ category }: { category: string }) {
  const normalized = category.toLowerCase();
  const className = normalized.includes("beverage") || normalized.includes("dairy") ? "bg-blue-light text-blue" : normalized.includes("snack") || normalized.includes("biscuit") ? "bg-amber-light text-amber" : "bg-primary-light/75 text-primary";
  return <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[10px] font-bold ${className}`}><span>{initials(category)}</span></span>;
}

function StockStatus({ status, quantity, threshold }: { status: ProductInventory["status"]; quantity: number; threshold: number }) {
  if (status === "out") return <Badge tone="red" dot>Out of stock</Badge>;
  if (status === "low") return <Badge tone="amber" dot>Low · {formatNumber(quantity)} left</Badge>;
  return <Badge tone="green" dot>In stock</Badge>;
}

export function InventoryTable({ products, compact = false, onAddProduct, onEditProduct }: { products: ProductInventory[]; compact?: boolean; onAddProduct?: () => void; onEditProduct?: (product: ProductInventory) => void }) {
  const pageSize = 6;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(products.length / pageSize));
  const activePage = compact ? 0 : Math.min(page, pageCount - 1);
  const shown = compact ? products.slice(0, pageSize) : products.slice(activePage * pageSize, (activePage + 1) * pageSize);
  const firstShown = shown.length ? activePage * pageSize + 1 : 0;
  const lastShown = activePage * pageSize + shown.length;

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  return <Card className="overflow-hidden !p-0">
    <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
      <div><div className="flex items-center gap-2"><h2 className="font-display text-[16px] font-bold text-ink">Product inventory</h2><Badge tone="gray">{products.length}</Badge></div><p className="mt-1 text-xs text-muted">On-hand stock and current retail price</p></div>
      <div className="flex items-center gap-2">{!compact && onAddProduct ? <Button size="sm" variant="secondary" onClick={onAddProduct}><Package size={14} />Add product</Button> : null}</div>
    </div>

    {/* On narrow and medium screens use labeled cards so every field and the edit action stays visible. */}
    <div className={compact ? "divide-y divide-line border-t border-line" : "divide-y divide-line border-t border-line 2xl:hidden"}>
      {shown.map((product) => <article key={product.id} className="px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <CategoryIcon category={product.category} />
            <div className="min-w-0"><h3 className="break-words text-[13px] font-semibold text-ink">{product.name}</h3><p className="mt-0.5 break-words text-[10px] text-muted">{product.unit}{product.aliases.length ? ` · ${product.aliases.slice(0, 2).join(", ")}` : ""}</p></div>
          </div>
          {onEditProduct ? <Button size="sm" variant="outline" className="shrink-0" onClick={() => onEditProduct(product)}><Pencil size={13} />Edit</Button> : null}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4">
          <div><dt className="text-[9px] font-semibold uppercase tracking-wide text-muted">Category</dt><dd className="mt-1 break-words text-xs text-ink-soft">{product.category}</dd></div>
          <div><dt className="text-[9px] font-semibold uppercase tracking-wide text-muted">In stock</dt><dd className="mt-1 break-words text-xs font-semibold tabular-nums text-ink">{formatNumber(product.quantityOnHand)} {product.unit}</dd></div>
          <div><dt className="text-[9px] font-semibold uppercase tracking-wide text-muted">Cost</dt><dd className="mt-1 break-all text-xs tabular-nums text-ink-soft">{formatCurrency(product.costPrice)}</dd></div>
          <div><dt className="text-[9px] font-semibold uppercase tracking-wide text-muted">Sell price</dt><dd className="mt-1 break-all text-xs font-semibold tabular-nums text-ink">{formatCurrency(product.sellPrice)}</dd></div>
          {!compact ? <div><dt className="text-[9px] font-semibold uppercase tracking-wide text-muted">Stock alert at</dt><dd className="mt-1 break-words text-xs tabular-nums text-ink-soft">{formatNumber(product.lowStockThreshold)} {product.unit}</dd></div> : null}
          {!compact ? <div className="col-span-2 sm:col-span-3"><dt className="text-[9px] font-semibold uppercase tracking-wide text-muted">Status</dt><dd className="mt-1"><StockStatus status={product.status} quantity={product.quantityOnHand} threshold={product.lowStockThreshold} /></dd></div> : null}
        </dl>
      </article>)}
    </div>

    {!compact ? <div className="hidden 2xl:block">
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup><col style={{ width: "21%" }} /><col style={{ width: "12%" }} /><col style={{ width: "11%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} /><col style={{ width: "13%" }} /><col style={{ width: "15%" }} /><col style={{ width: "10%" }} /></colgroup>
        <thead><tr className="border-y border-line bg-surface-subtle/60 text-[9px] uppercase tracking-[.08em] text-muted"><th className="px-3 py-3 font-semibold">Product</th><th className="px-2 py-3 font-semibold">Category</th><th className="px-2 py-3 font-semibold">In stock</th><th className="px-2 py-3 font-semibold">Cost</th><th className="px-2 py-3 font-semibold">Sell price</th><th className="px-2 py-3 font-semibold">Stock alert at</th><th className="px-2 py-3 font-semibold">Status</th>{onEditProduct ? <th className="px-2 py-3 text-right font-semibold">Edit</th> : <th className="px-2 py-3" />}</tr></thead>
        <tbody>{shown.map((product) => <tr key={product.id} className="group border-b border-line/80 last:border-b-0 hover:bg-surface-subtle/40">
          <td className="px-3 py-3.5"><div className="flex min-w-0 items-start gap-2"><CategoryIcon category={product.category} /><div className="min-w-0" style={{ overflowWrap: "anywhere" }}><p className="text-xs font-semibold text-ink">{product.name}</p><p className="mt-0.5 text-[9px] text-muted">{product.unit}{product.aliases.length ? ` · ${product.aliases.slice(0, 2).join(", ")}` : ""}</p></div></div></td>
          <td className="px-2 py-3.5 text-[11px] text-ink-soft" style={{ overflowWrap: "anywhere" }}>{product.category}</td>
          <td className="px-2 py-3.5 text-[11px] font-semibold tabular-nums text-ink" style={{ overflowWrap: "anywhere" }}>{formatNumber(product.quantityOnHand)} {product.unit}</td>
          <td className="px-2 py-3.5 text-[11px] tabular-nums text-ink-soft" style={{ overflowWrap: "anywhere" }}>{formatCurrency(product.costPrice)}</td>
          <td className="px-2 py-3.5 text-[11px] font-semibold tabular-nums text-ink" style={{ overflowWrap: "anywhere" }}>{formatCurrency(product.sellPrice)}</td>
          <td className="px-2 py-3.5 text-[11px] tabular-nums text-ink-soft" style={{ overflowWrap: "anywhere" }}>{formatNumber(product.lowStockThreshold)} {product.unit}</td>
          <td className="px-2 py-3.5" style={{ overflowWrap: "anywhere" }}><StockStatus status={product.status} quantity={product.quantityOnHand} threshold={product.lowStockThreshold} /></td>
          <td className="px-2 py-3.5 text-right">{onEditProduct ? <Button size="sm" variant="outline" className="whitespace-nowrap" onClick={() => onEditProduct(product)}><Pencil size={13} />Edit</Button> : <span className="sr-only">No edit action</span>}</td>
        </tr>)}</tbody>
      </table>
    </div> : null}

    {shown.length === 0 ? <div className="px-6 py-12 text-center text-sm text-muted">Your catalog is empty. Add your first product to begin.</div> : null}
    {compact && products.length > shown.length ? <div className="border-t border-line px-6 py-3 text-center text-[11px] font-semibold text-primary">Showing {shown.length} of {products.length} products</div> : null}
    {!compact && products.length > 0 ? <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <span className="text-[11px] text-muted">Showing {firstShown}–{lastShown} of {products.length} products</span>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <Button size="sm" variant="outline" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous</Button>
        <span className="whitespace-nowrap text-[11px] font-semibold text-ink-soft">Page {activePage + 1} of {pageCount}</span>
        <Button size="sm" variant="outline" disabled={activePage >= pageCount - 1} onClick={() => setPage(activePage + 1)}>Next</Button>
      </div>
    </div> : null}
  </Card>;
}

export function LowStockPanel({ products, onInventory }: { products: ProductInventory[]; onInventory?: () => void }) {
  const urgent = products.filter((product) => product.status !== "healthy").slice(0, 4);
  return <Card>
    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-light text-amber"><AlertTriangle size={16} /></span><h2 className="font-display text-[15px] font-bold text-ink">Needs a restock</h2></div><p className="mt-2 text-xs text-muted">{products.length} items are at or below their threshold</p></div><Badge tone={urgent.length ? "amber" : "green"}>{products.length} items</Badge></div>
    {urgent.length ? <div className="mt-4 space-y-3">{urgent.map((product) => {
      const progress = Math.min(100, Math.max(7, (product.quantityOnHand / Math.max(product.lowStockThreshold, 1)) * 100));
      return <div key={product.id} className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-subtle text-[10px] font-bold text-ink-soft">{initials(product.name)}</span>
        <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-semibold text-ink">{product.name}</p><p className="shrink-0 text-[10px] font-semibold text-amber">{formatNumber(product.quantityOnHand)} {product.unit}</p></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-subtle"><div className={`h-full rounded-full ${product.status === "out" ? "bg-danger" : "bg-amber"}`} style={{ width: `${progress}%` }} /></div><p className="mt-1 text-[9px] text-muted">Alert at {product.lowStockThreshold} {product.unit}</p></div>
      </div>;
    })}</div> : <div className="mt-4 rounded-xl bg-primary-light/45 px-3 py-3 text-xs text-primary">Everything is comfortably stocked.</div>}
    {onInventory ? <button type="button" onClick={onInventory} className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary-dark">Review inventory <ChevronRight size={13} /></button> : null}
  </Card>;
}

export function ActivityList({ activity, compact = false }: { activity: Activity[]; compact?: boolean }) {
  const shown = compact ? activity.slice(0, 5) : activity;
  return <Card className="overflow-hidden !p-0">
    <div className="flex items-center justify-between px-5 py-4 sm:px-6"><div><h2 className="font-display text-[15px] font-bold text-ink">Recent activity</h2><p className="mt-1 text-xs text-muted">Sales, stock-ins, expenses and losses</p></div><Clock3 size={17} className="text-muted" /></div>
    <div className="divide-y divide-line/80">{shown.map((item) => {
      const style = kindStyle[item.kind]; const Icon = style.icon;
      return <div key={item.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${style.tone === "green" ? "bg-success-light text-primary" : style.tone === "blue" ? "bg-blue-light text-blue" : style.tone === "amber" ? "bg-amber-light text-amber" : "bg-danger-light text-danger"}`}><Icon size={16} /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-ink">{item.title}</p><p className="mt-0.5 truncate text-[10px] text-muted">{item.detail} <span className="px-0.5">·</span> {formatTime(item.timestamp)}</p></div>
        <div className="shrink-0 text-right"><p className={`text-xs font-bold tabular-nums ${item.kind === "sale" ? "text-primary" : item.kind === "loss" ? "text-danger" : "text-ink-soft"}`}>{style.sign}{formatCurrency(item.amount)}</p><p className="mt-0.5 text-[9px] capitalize text-muted">{item.kind}</p></div>
      </div>;
    })}</div>
    {shown.length === 0 ? <div className="px-6 py-10 text-center text-xs text-muted">No activity yet today.</div> : null}
  </Card>;
}

export function MoneyBreakdown({ data }: { data: DashboardData }) {
  const rows = [
    { label: "Purchases", value: data.kpis.todayPurchases, color: "bg-blue" },
    { label: "Operating expenses", value: data.kpis.todayExpenses, color: "bg-amber" },
    { label: "Stock losses", value: data.kpis.todayLosses, color: "bg-danger" },
  ];
  return <Card>
    <div className="flex items-center justify-between"><div><h2 className="font-display text-[15px] font-bold text-ink">Today’s money out</h2><p className="mt-1 text-xs text-muted">Purchases are separate from profit</p></div><CircleDollarSign size={19} className="text-muted" /></div>
    <div className="mt-4 space-y-3">{rows.map((row) => <div key={row.label} className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs text-ink-soft"><span className={`h-2 w-2 rounded-full ${row.color}`} />{row.label}</span><span className="text-xs font-semibold tabular-nums text-ink">{formatCurrency(row.value)}</span></div>)}</div>
    <div className="mt-4 flex items-center justify-between rounded-xl bg-primary-light/45 px-3.5 py-3"><span className="text-xs font-semibold text-primary">Net profit today</span><span className={`font-display text-base font-extrabold ${data.kpis.todayProfit < 0 ? "text-danger" : "text-primary"}`}>{formatCurrency(data.kpis.todayProfit)}</span></div>
    <p className="mt-2 text-[9px] leading-4 text-muted">Profit = sales margin − expenses − stock losses. Restocking is inventory, not an immediate cost.</p>
  </Card>;
}

export function TopProducts({ products }: { products: DashboardData["topProducts"] }) {
  const max = Math.max(1, ...products.map((product) => product.qty));
  return <Card>
    <div className="flex items-center justify-between"><div><h2 className="font-display text-[15px] font-bold text-ink">Best sellers</h2><p className="mt-1 text-xs text-muted">Units moved this week</p></div><TrendingUp size={17} className="text-primary" /></div>
    <div className="mt-4 space-y-3.5">{products.slice(0, 4).map((product, index) => <div key={product.productId} className="flex items-center gap-3"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] font-bold ${index === 0 ? "bg-primary text-white" : "bg-surface-subtle text-ink-soft"}`}>{index + 1}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-ink">{product.name}</span><span className="shrink-0 text-[10px] font-semibold text-ink-soft">{formatNumber(product.qty)} sold</span></div><div className="mt-1.5 h-1.5 rounded-full bg-surface-subtle"><div className="h-1.5 rounded-full bg-primary/65" style={{ width: `${Math.max(7, product.qty / max * 100)}%` }} /></div></div></div>)}{products.length === 0 ? <p className="text-xs text-muted">No sales recorded this week yet.</p> : null}</div>
  </Card>;
}

export function ProfitExplainer({ data }: { data: DashboardData }) {
  return <div className="flex items-center gap-3 rounded-2xl border border-primary/10 bg-gradient-to-r from-primary-light/45 to-white px-4 py-3.5">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm"><Banknote size={17} /></span>
    <div className="min-w-0"><p className="text-xs font-bold text-ink">Profit is based on items sold</p><p className="mt-0.5 text-[10px] leading-4 text-muted">Purchases refill stock. The cost is counted when goods sell; damaged stock and expenses are deducted.</p></div>
  </div>;
}

export function InventorySummary({ data }: { data: DashboardData }) {
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    data.products.forEach((product) => counts.set(product.category, (counts.get(product.category) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [data.products]);
  return <Card>
    <div className="flex items-center justify-between"><div><h2 className="font-display text-[15px] font-bold text-ink">Inventory snapshot</h2><p className="mt-1 text-xs text-muted">Stock at cost value</p></div><Boxes size={18} className="text-primary" /></div>
    <div className="mt-4 flex items-end justify-between gap-3"><div><p className="font-display text-2xl font-extrabold tracking-tight text-ink">{formatCurrency(data.kpis.inventoryValue)}</p><p className="mt-1 text-[10px] text-muted">{formatNumber(data.kpis.totalUnits)} units on hand</p></div><div className="rounded-xl bg-primary-light/50 px-3 py-2 text-right"><p className="font-display text-lg font-extrabold text-primary">{data.counts.products}</p><p className="text-[9px] font-semibold uppercase tracking-wider text-primary/75">Products</p></div></div>
    <div className="mt-4 flex flex-wrap gap-1.5">{categories.map(([category, count]) => <Badge key={category} tone="gray">{category} <span className="ml-0.5 text-muted">{count}</span></Badge>)}</div>
  </Card>;
}
