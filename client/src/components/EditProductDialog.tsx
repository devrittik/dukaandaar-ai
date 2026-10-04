import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { api } from "../api/client";
import type { ProductInventory } from "../types";
import { formatNumber } from "../utils";
import { Button } from "./ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/Dialog";
import { Field } from "./ui/Field";

export function EditProductDialog({ product, open, onOpenChange, onSaved }: {
  product: ProductInventory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [aliases, setAliases] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !product) return;
    setName(product.name);
    setCategory(product.category);
    setUnit(product.unit);
    setAliases(product.aliases.filter((alias) => alias !== product.name).join(", "));
    setCostPrice(String(product.costPrice));
    setSellPrice(String(product.sellPrice));
    setLowStockThreshold(String(product.lowStockThreshold));
    setError("");
  }, [open, product]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!product) return;
    setBusy(true);
    setError("");
    try {
      await api.updateProduct(product.id, {
        name: name.trim(),
        category: category.trim(),
        unit: unit.trim(),
        aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
        costPrice: Number(costPrice),
        sellPrice: Number(sellPrice),
        lowStockThreshold: Number(lowStockThreshold),
      });
      onOpenChange(false);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this product. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <div className="mb-5 flex items-start gap-3 pr-8">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary-light/60 text-primary"><Pencil size={19} /></div>
        <div><DialogTitle>Edit product</DialogTitle><DialogDescription>Update catalog details and the low-stock alert. Current stock changes only through sales, purchases, or losses.</DialogDescription></div>
      </div>
      {product ? <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Field label="Product" value={name} required maxLength={120} onChange={(event) => setName(event.target.value)} /></div>
          <Field label="Category" value={category} required maxLength={80} onChange={(event) => setCategory(event.target.value)} />
          <Field label="Unit" value={unit} required maxLength={24} onChange={(event) => setUnit(event.target.value)} />
          <div className="col-span-2"><Field label="Nicknames / aliases" value={aliases} placeholder="Separate aliases with commas" onChange={(event) => setAliases(event.target.value)} /></div>
          <Field label="Cost (₹)" type="number" min="0" step="0.01" value={costPrice} required onChange={(event) => setCostPrice(event.target.value)} />
          <Field label="Sell price (₹)" type="number" min="0.01" step="0.01" value={sellPrice} required onChange={(event) => setSellPrice(event.target.value)} />
          <Field label={`Stock alert at (${unit || "unit"})`} type="number" min="0" step="any" value={lowStockThreshold} required onChange={(event) => setLowStockThreshold(event.target.value)} />
          <div className="flex flex-col justify-end rounded-xl border border-line bg-surface-subtle px-3.5 py-2.5"><span className="text-[11px] font-semibold text-muted">In stock</span><span className="mt-1 text-sm font-bold text-ink">{formatNumber(product.quantityOnHand)} {product.unit}</span></div>
        </div>
        <div className="rounded-xl bg-surface-subtle px-3.5 py-3 text-xs leading-5 text-muted">To change on-hand quantity, record a purchase, sale, or stock loss so the ledger stays accurate.</div>
        {error ? <div role="alert" className="rounded-xl border border-danger/15 bg-danger-light px-3.5 py-3 text-xs leading-5 text-danger">{error}</div> : null}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={busy}>Save changes</Button></div>
      </form> : null}
    </DialogContent>
  </Dialog>;
}
