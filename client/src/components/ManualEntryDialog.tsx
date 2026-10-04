import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, PackagePlus, ShoppingBag, ArrowDownToLine, ReceiptText, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../api/client";
import type { EntryKind, ProductInventory } from "../types";
import { formatCurrency } from "../utils";
import { Button } from "./ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/Dialog";
import { Field, SelectField } from "./ui/Field";

interface ManualEntryDialogProps {
  open: boolean;
  kind: EntryKind;
  products: ProductInventory[];
  initialData?: Record<string, unknown> | null;
  defaultLowStockThreshold?: number;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}

interface LineDraft { productId: string; qty: string; price: string; }
const entryMeta: Record<EntryKind, { title: string; description: string; icon: LucideIcon; button: string }> = {
  sale: { title: "Record a sale", description: "Add items sold and their payment details.", icon: ShoppingBag, button: "Save sale" },
  purchase: { title: "Record a purchase", description: "Log incoming stock from a supplier.", icon: ArrowDownToLine, button: "Save purchase" },
  expense: { title: "Add an expense", description: "Track the everyday costs of running your shop.", icon: ReceiptText, button: "Save expense" },
  loss: { title: "Record stock loss", description: "Log expired, damaged, or missing goods and adjust stock.", icon: TriangleAlert, button: "Record loss" },
  product: { title: "Add a product", description: "Positive opening stock is recorded as an initial purchase; zero adds the catalog item only.", icon: PackagePlus, button: "Add product" },
};

function defaultLine(kind: EntryKind, products: ProductInventory[]): LineDraft {
  const product = products.find((entry) => entry.status === "healthy" && entry.quantityOnHand > 0) ?? products.find((entry) => entry.quantityOnHand > 0) ?? products[0];
  return { productId: product?.id ?? "", qty: "1", price: product ? String(kind === "purchase" ? product.costPrice : product.sellPrice) : "" };
}

export function ManualEntryDialog({ open, kind, products, initialData, defaultLowStockThreshold = 10, onOpenChange, onSaved }: ManualEntryDialogProps) {
  const [lines, setLines] = useState<LineDraft[]>([defaultLine(kind, products)]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [supplier, setSupplier] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("electricity");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("Damaged goods");
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [category, setCategory] = useState("General");
  const [unit, setUnit] = useState("unit");
  const [sellPrice, setSellPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [openingStock, setOpeningStock] = useState("0");
  const [purchaseUnitCost, setPurchaseUnitCost] = useState("");
  const [threshold, setThreshold] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      const draft = initialData ?? {};
      const fallbackLine = defaultLine(kind, products);
      setLines([fallbackLine]);
      setPaymentMethod(typeof draft.paymentMethod === "string" ? draft.paymentMethod : "cash");
      setSupplier(typeof draft.supplier === "string" ? draft.supplier : "");
      setExpenseCategory(typeof draft.category === "string" ? draft.category : "electricity");
      setAmount(draft.amount !== undefined ? String(draft.amount) : "");
      setNote(typeof draft.note === "string" ? draft.note : "");
      setReason(typeof draft.reason === "string" ? draft.reason : "Damaged goods");
      setName(typeof draft.name === "string" ? draft.name : "");
      setAliases(Array.isArray(draft.aliases) ? draft.aliases.join(", ") : "");
      setCategory(typeof draft.category === "string" ? draft.category : "General");
      setUnit(typeof draft.unit === "string" ? draft.unit : "unit");
      setSellPrice(draft.sellPrice !== undefined ? String(draft.sellPrice) : "");
      setCostPrice(draft.costPrice !== undefined ? String(draft.costPrice) : "");
      setOpeningStock(draft.openingStock !== undefined ? String(draft.openingStock) : "0");
      setPurchaseUnitCost(draft.purchaseUnitCost !== undefined ? String(draft.purchaseUnitCost) : "");
      setThreshold(draft.lowStockThreshold !== undefined ? String(draft.lowStockThreshold) : String(defaultLowStockThreshold));
      const sourceItems = Array.isArray(draft.items) ? draft.items as Array<Record<string, unknown>> : [];
      if ((kind === "sale" || kind === "purchase") && sourceItems.length) {
        setLines(sourceItems.map((item) => ({ productId: String(item.productId ?? fallbackLine.productId), qty: String(item.qty ?? 1), price: String(kind === "sale" ? item.unitPrice ?? "" : item.unitCost ?? "") })));
      } else if (kind === "loss" && draft.productId) {
        setLines([{ productId: String(draft.productId), qty: String(draft.qty ?? 1), price: "" }]);
      }
      setError("");
      console.log(`[manual] opened form kind=${kind}${initialData ? " with parsed values" : ""}`);
    }
  }, [open, kind, products, initialData, defaultLowStockThreshold]);

  const meta = entryMeta[kind];
  const Icon = meta.icon;
  const selectedProduct = useMemo(() => products.find((product) => product.id === lines[0]?.productId), [products, lines]);
  const lineTotal = lines.reduce((sum, line) => sum + Number(line.qty || 0) * Number(line.price || 0), 0);

  const updateLine = (index: number, key: keyof LineDraft, value: string) => {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      if (key === "productId") {
        const product = products.find((entry) => entry.id === value);
        return { ...line, productId: value, price: product ? String(kind === "purchase" ? product.costPrice : product.sellPrice) : "" };
      }
      return { ...line, [key]: value };
    }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      let data: unknown;
      if (kind === "sale") {
        data = { items: lines.map((line) => ({ productId: line.productId, qty: Number(line.qty), unitPrice: Number(line.price) })), paymentMethod };
      } else if (kind === "purchase") {
        data = { items: lines.map((line) => ({ productId: line.productId, qty: Number(line.qty), unitCost: Number(line.price) })), supplier: supplier || "Local supplier" };
      } else if (kind === "expense") {
        data = { category: expenseCategory, amount: Number(amount), note: note || `${expenseCategory} expense` };
      } else if (kind === "loss") {
        data = { productId: lines[0]?.productId, qty: Number(lines[0]?.qty), reason };
      } else {
        data = {
          name, aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean), category, unit,
          sellPrice: Number(sellPrice), costPrice: Number(costPrice), openingStock: Number(openingStock),
          ...(Number(openingStock) > 0 && purchaseUnitCost.trim() ? { purchaseUnitCost: Number(purchaseUnitCost) } : {}),
          supplier: supplier || "Local supplier", lowStockThreshold: Number(threshold),
        };
      }
      const result = await api.manual(kind, data);
      console.log(`[manual] saved form kind=${kind}`);
      onOpenChange(false);
      onSaved(result.message);
    } catch (caught) {
      console.error(`[manual] failed to save kind=${kind}`, caught);
      setError(caught instanceof Error ? caught.message : "Could not save this entry. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="mb-5 flex items-start gap-3 pr-8">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary-light/60 text-primary"><Icon size={21} /></div>
          <div><DialogTitle>{meta.title}</DialogTitle><DialogDescription>{meta.description}</DialogDescription></div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {(kind === "sale" || kind === "purchase" || kind === "loss") ? (
            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-12 items-end gap-2 rounded-2xl border border-line bg-surface-subtle/65 p-3">
                  <div className="col-span-12 sm:col-span-5">
                    <SelectField label={index === 0 ? "Product" : "Another product"} value={line.productId} required onChange={(event) => updateLine(index, "productId", event.target.value)}>
                      <option value="" disabled>Select a product</option>
                      {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.quantityOnHand} {product.unit}</option>)}
                    </SelectField>
                  </div>
                  <div className="col-span-4 sm:col-span-2"><Field label="Qty" type="number" min="0.01" step="any" value={line.qty} required onChange={(event) => updateLine(index, "qty", event.target.value)} /></div>
                  {kind !== "loss" ? <div className="col-span-6 sm:col-span-4"><Field label={kind === "sale" ? "Price / unit" : "Cost / unit"} type="number" min="0" step="0.01" value={line.price} required onChange={(event) => updateLine(index, "price", event.target.value)} /></div> : <div className="col-span-7 sm:col-span-4 flex h-11 items-center rounded-xl bg-white px-3 text-xs text-muted">Value at cost: {formatCurrency((selectedProduct?.costPrice ?? 0) * Number(line.qty || 0))}</div>}
                  {kind !== "loss" && lines.length > 1 ? <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="col-span-2 grid h-11 place-items-center rounded-xl text-muted hover:bg-danger-light hover:text-danger" aria-label="Remove item"><Trash2 size={16} /></button> : null}
                </div>
              ))}
              {kind !== "loss" ? <button type="button" onClick={() => setLines((current) => [...current, defaultLine(kind, products)])} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary-dark"><Plus size={15} /> Add another item</button> : null}
            </div>
          ) : null}

          {kind === "sale" ? <div className="grid grid-cols-2 gap-3"><SelectField label="Payment" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="credit">Credit</option></SelectField><div className="flex flex-col justify-end rounded-xl bg-primary-light/45 px-4 py-2.5"><span className="text-[11px] font-semibold text-muted">Sale total</span><span className="font-display text-lg font-bold text-primary">{formatCurrency(lineTotal)}</span></div></div> : null}
          {kind === "purchase" ? <Field label="Supplier" placeholder="Local distributor" value={supplier} onChange={(event) => setSupplier(event.target.value)} /> : null}
          {kind === "expense" ? <div className="grid grid-cols-2 gap-3"><SelectField label="Category" value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)}><option value="electricity">Electricity</option><option value="rent">Rent</option><option value="transport">Transport</option><option value="staff">Staff</option><option value="misc">Other</option></SelectField><Field label="Amount (₹)" type="number" min="1" step="0.01" placeholder="0" value={amount} required onChange={(event) => setAmount(event.target.value)} /></div> : null}
          {kind === "expense" ? <Field label="Note" placeholder="Electricity bill, shop rent…" value={note} onChange={(event) => setNote(event.target.value)} /> : null}
          {kind === "loss" ? <><SelectField label="Reason" value={reason} onChange={(event) => setReason(event.target.value)}><option>Rat damage</option><option>Spoiled or expired</option><option>Damaged goods</option><option>Leakage</option><option>Missing stock</option><option>Other</option></SelectField><div className="rounded-xl bg-amber-light/65 px-3.5 py-3 text-xs leading-5 text-amber">This will reduce on-hand stock by {lines[0]?.qty || 0} {selectedProduct?.unit ?? "units"} and record its cost as a loss.</div></> : null}
          {kind === "product" ? <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label="Product name" placeholder="e.g. Aashirvaad Atta 1kg" value={name} required onChange={(event) => setName(event.target.value)} /></div>
            <div className="col-span-2"><Field label="Nicknames / aliases" placeholder="atta, flour" value={aliases} onChange={(event) => setAliases(event.target.value)} hint="Separate aliases with commas—these help voice matching." /></div>
            <Field label="Category" placeholder="Staples" value={category} required onChange={(event) => setCategory(event.target.value)} />
            <Field label="Unit" placeholder="packet" value={unit} required onChange={(event) => setUnit(event.target.value)} />
            <Field label="Selling price (₹)" type="number" min="0.01" step="0.01" value={sellPrice} required onChange={(event) => setSellPrice(event.target.value)} />
            <Field label="Cost price (₹)" type="number" min="0" step="0.01" value={costPrice} required onChange={(event) => setCostPrice(event.target.value)} />
            <Field label="Opening stock" type="number" min="0" step="any" value={openingStock} onChange={(event) => setOpeningStock(event.target.value)} />
            <Field label="Low-stock alert at" type="number" min="0" step="any" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
            {Number(openingStock) > 0 ? <>
              <Field label="Purchase cost / unit (₹)" type="number" min="0" step="0.01" placeholder={`Same as cost price${costPrice ? ` (${costPrice})` : ""}`} value={purchaseUnitCost} onChange={(event) => setPurchaseUnitCost(event.target.value)} />
              <Field label="Supplier for opening purchase" placeholder="Local supplier" value={supplier} onChange={(event) => setSupplier(event.target.value)} />
              <div className="col-span-2 rounded-xl bg-primary-light/45 px-3.5 py-3 text-xs leading-5 text-primary">Initial purchase: {openingStock} × {formatCurrency(purchaseUnitCost.trim() ? Number(purchaseUnitCost) : Number(costPrice || 0))} = {formatCurrency(Number(openingStock) * (purchaseUnitCost.trim() ? Number(purchaseUnitCost) : Number(costPrice || 0)))}. It will be added to purchase history and increase stock once.</div>
            </> : <div className="col-span-2 rounded-xl bg-surface-subtle px-3.5 py-3 text-xs leading-5 text-muted">Opening stock is zero: the product will be added to the catalog only, with no purchase-history entry.</div>}
          </div> : null}

          {error ? <div className="rounded-xl border border-danger/15 bg-danger-light px-3.5 py-3 text-xs leading-5 text-danger" role="alert">{error}</div> : null}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
            <span className="text-[11px] leading-5 text-muted">{kind === "product" ? "Product changes are saved to your catalog." : kind === "expense" ? "Saved in your shop ledger." : "Stock and ledger update together."}</span>
            <div className="flex shrink-0 gap-2"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={busy}>{meta.button}</Button></div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
