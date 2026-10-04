import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, AlertTriangle, CalendarDays, Search, ShoppingBag, ReceiptText, Truck } from "lucide-react";
import type { TransactionsResponse } from "../types";
import { formatCurrency, formatDate, formatTime } from "../utils";
import { Badge, type BadgeTone } from "./ui/Badge";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";

interface Row { id: string; kind: "sale" | "purchase" | "expense" | "loss"; date: string; detail: string; amount: number; source: string; }
const kinds = ["all", "sale", "purchase", "expense", "loss"] as const;
const kindMeta: Record<Row["kind"], { label: string; icon: typeof ShoppingBag; tone: BadgeTone; signed: string }> = {
  sale: { label: "Sale", icon: ShoppingBag, tone: "green", signed: "+" },
  purchase: { label: "Purchase", icon: Truck, tone: "blue", signed: "−" },
  expense: { label: "Expense", icon: ReceiptText, tone: "amber", signed: "−" },
  loss: { label: "Stock loss", icon: AlertTriangle, tone: "red", signed: "−" },
};

export function TransactionsPage({ transactions, onAdd }: { transactions: TransactionsResponse | null; onAdd: () => void }) {
  const [filter, setFilter] = useState<(typeof kinds)[number]>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 6;
  const rows = useMemo<Row[]>(() => {
    if (!transactions) return [];
    const merged: Row[] = [
      ...transactions.sales.map((item) => ({ id: item.id, kind: "sale" as const, date: item.timestamp, detail: item.items.map((row) => `${row.qty} × ${row.productName}`).join(" · "), amount: item.totalAmount, source: item.source })),
      ...transactions.purchases.map((item) => ({ id: item.id, kind: "purchase" as const, date: item.timestamp, detail: `${item.items.map((row) => `${row.qty} × ${row.productName}`).join(" · ")} · ${item.supplier}`, amount: item.totalAmount, source: item.source })),
      ...transactions.expenses.map((item) => ({ id: item.id, kind: "expense" as const, date: item.timestamp, detail: `${item.category} · ${item.note}`, amount: item.amount, source: item.source })),
      ...transactions.losses.map((item) => ({ id: item.id, kind: "loss" as const, date: item.timestamp, detail: `${item.qty} × ${item.productName} · ${item.reason}`, amount: item.totalCost, source: item.source })),
    ];
    return merged.sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions]);
  const filtered = rows.filter((row) => (filter === "all" || row.kind === filter) && `${row.detail} ${row.kind}`.toLowerCase().includes(search.toLowerCase()));
  const total = filtered.reduce((sum, row) => sum + (row.kind === "sale" ? row.amount : 0), 0);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const activePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(activePage * pageSize, (activePage + 1) * pageSize);
  const firstShown = pageRows.length ? activePage * pageSize + 1 : 0;
  const lastShown = activePage * pageSize + pageRows.length;

  useEffect(() => { setPage(0); }, [filter, search, transactions]);
  useEffect(() => { setPage((current) => Math.min(current, pageCount - 1)); }, [pageCount]);

  return <div className="space-y-5 animate-page-in">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[.13em] text-primary">Ledger</p><h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Transactions</h1><p className="mt-1.5 text-sm text-muted">A clear record of every sale, stock-in, expense and loss.</p></div><Button onClick={onAdd}><ShoppingBag size={16} />New entry</Button></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><MiniStat label="Ledger entries" value={String(rows.length)} /><MiniStat label="Sales recorded" value={formatCurrency(transactions?.sales.reduce((sum, item) => sum + item.totalAmount, 0) ?? 0)} /><MiniStat label="Expenses" value={formatCurrency(transactions?.expenses.reduce((sum, item) => sum + item.amount, 0) ?? 0)} /><MiniStat label="Loss value" value={formatCurrency(transactions?.losses.reduce((sum, item) => sum + item.totalCost, 0) ?? 0)} /></div>
    <Card className="overflow-hidden !p-0">
      <div className="flex flex-col justify-between gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        <div className="flex flex-wrap gap-1.5">{kinds.map((kind) => <button key={kind} type="button" onClick={() => setFilter(kind)} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold capitalize transition ${filter === kind ? "bg-primary text-white" : "bg-surface-subtle text-ink-soft hover:bg-primary-light hover:text-primary"}`}>{kind === "all" ? "All activity" : kind === "loss" ? "Losses" : `${kind}s`}</button>)}</div>
        <label className="flex h-9 items-center gap-2 rounded-xl border border-line bg-white px-3 text-muted focus-within:border-primary/40"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-muted" placeholder="Search ledger" /></label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left"><thead><tr className="bg-surface-subtle/60 text-[10px] uppercase tracking-[.1em] text-muted"><th className="px-5 py-3 font-semibold sm:px-6">Activity</th><th className="px-3 py-3 font-semibold">Date & time</th><th className="px-3 py-3 font-semibold">Source</th><th className="px-5 py-3 text-right font-semibold sm:px-6">Amount</th></tr></thead>
          <tbody>{pageRows.map((row) => { const meta = kindMeta[row.kind]; const Icon = meta.icon; return <tr key={row.id} className="border-t border-line/80 hover:bg-surface-subtle/35"><td className="px-5 py-3.5 sm:px-6"><div className="flex items-center gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${meta.tone === "green" ? "bg-success-light text-primary" : meta.tone === "blue" ? "bg-blue-light text-blue" : meta.tone === "amber" ? "bg-amber-light text-amber" : "bg-danger-light text-danger"}`}><Icon size={16} /></span><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs font-semibold text-ink">{meta.label}</span><Badge tone={meta.tone}>{row.kind === "loss" ? "Loss" : meta.label}</Badge></div><p className="mt-1 max-w-[460px] truncate text-[10px] text-muted">{row.detail}</p></div></div></td><td className="px-3 py-3.5"><p className="text-xs font-medium text-ink-soft">{formatDate(row.date, { year: "numeric" })}</p><p className="mt-0.5 text-[10px] text-muted">{formatTime(row.date)}</p></td><td className="px-3 py-3.5"><Badge tone="gray" className="capitalize">{row.source}</Badge></td><td className={`px-5 py-3.5 text-right text-xs font-bold tabular-nums sm:px-6 ${row.kind === "sale" ? "text-primary" : row.kind === "loss" ? "text-danger" : "text-ink-soft"}`}>{meta.signed}{formatCurrency(row.amount)}</td></tr>; })}</tbody>
        </table>
      </div>
      {!transactions ? <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-muted"><CalendarDays size={16} />Loading ledger…</div> : null}
      {transactions && filtered.length === 0 ? <div className="px-6 py-14 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-surface-subtle text-muted"><ArrowDownLeft size={19} /></div><p className="mt-3 text-sm font-semibold text-ink">No matching entries</p><p className="mt-1 text-xs text-muted">Try a different filter or add a new entry.</p></div> : null}
      <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-[10px] text-muted sm:px-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><span>Showing {firstShown}–{lastShown} of {filtered.length} entries · last 90 days</span><span className="font-semibold text-ink-soft">Sales shown: {formatCurrency(total)}</span></div>
        {transactions && filtered.length > 0 ? <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-semibold text-ink-soft">Page {activePage + 1} of {pageCount}</span>
          <div className="flex items-center gap-2"><Button size="sm" variant="outline" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={activePage >= pageCount - 1} onClick={() => setPage(activePage + 1)}>Next</Button></div>
        </div> : null}
      </div>
    </Card>
  </div>;
}

function MiniStat({ label, value }: { label: string; value: string }) { return <Card className="!p-4"><p className="text-[10px] font-semibold text-muted">{label}</p><p className="mt-1.5 font-display text-lg font-extrabold tracking-tight text-ink">{value}</p></Card>; }
