import { useEffect, useState } from "react";
import { Save, Store } from "lucide-react";
import { api } from "../api/client";
import type { ShopSettingsUpdate } from "../types";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, TextAreaField } from "./ui/Field";

const emptySettings: ShopSettingsUpdate = { shopName: "", ownerName: "", phone: "", address: "", lowStockDefaultThreshold: 10 };

export function ShopSettingsPage({ onSaved }: { onSaved: () => void }) {
  const [draft, setDraft] = useState<ShopSettingsUpdate>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void api.settings().then((settings) => {
      if (!active) return;
      setDraft({
        shopName: settings.shopName,
        ownerName: settings.ownerName,
        phone: settings.phone,
        address: settings.address,
        lowStockDefaultThreshold: settings.lowStockDefaultThreshold,
      });
      setError("");
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "Could not load shop settings.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const update = <K extends keyof ShopSettingsUpdate>(key: K, value: ShopSettingsUpdate[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice("");
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const settings = await api.updateSettings(draft);
      setDraft({
        shopName: settings.shopName,
        ownerName: settings.ownerName,
        phone: settings.phone,
        address: settings.address,
        lowStockDefaultThreshold: settings.lowStockDefaultThreshold,
      });
      setNotice("Shop settings saved.");
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save shop settings.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="mx-auto max-w-4xl space-y-5 animate-page-in">
    <div><p className="mb-2 text-xs font-semibold uppercase tracking-[.13em] text-primary">Your workspace</p><h1 className="font-display text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">Shop Settings</h1><p className="mt-1.5 text-sm text-muted">Manage the shop profile and defaults used throughout Dukaandaar.</p></div>
    <Card className="!p-0">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-light text-primary"><Store size={18} /></span><div><h2 className="text-sm font-bold text-ink">Shop profile</h2><p className="mt-0.5 text-xs text-muted">These details appear in your workspace.</p></div></div>
      <form onSubmit={(event) => void save(event)} className="space-y-5 px-5 py-5 sm:px-6">
        {loading ? <p className="text-sm text-muted">Loading settings…</p> : <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shop name" value={draft.shopName} required maxLength={100} onChange={(event) => update("shopName", event.target.value)} placeholder="e.g. Ramesh General Store" />
            <Field label="Owner name" value={draft.ownerName} required maxLength={100} onChange={(event) => update("ownerName", event.target.value)} placeholder="Your name" />
            <Field label="Contact phone" type="tel" value={draft.phone} maxLength={40} onChange={(event) => update("phone", event.target.value)} placeholder="Optional" />
            <Field label="Default stock alert at" type="number" min="0" step="any" value={String(draft.lowStockDefaultThreshold)} onChange={(event) => update("lowStockDefaultThreshold", Number(event.target.value))} hint="Used as the starting alert level for newly added products." />
            <div className="sm:col-span-2"><TextAreaField label="Shop address" rows={3} maxLength={240} value={draft.address} onChange={(event) => update("address", event.target.value)} placeholder="Optional shop address" /></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <span className="text-xs text-muted">Currency: INR (₹)</span>
            <div className="flex items-center gap-3">{notice ? <span role="status" className="text-xs font-semibold text-primary">{notice}</span> : null}<Button type="submit" loading={busy} disabled={loading}><Save size={15} />Save settings</Button></div>
          </div>
        </>}
        {error ? <div role="alert" className="rounded-xl border border-danger/15 bg-danger-light px-3.5 py-3 text-xs leading-5 text-danger">{error}</div> : null}
      </form>
    </Card>
    <Card className="bg-primary-light/25"><h2 className="text-sm font-bold text-ink">Inventory defaults</h2><p className="mt-1 text-xs leading-5 text-muted">The default stock alert is applied to new products. You can set a different alert for each existing product from the Inventory page. On-hand quantities remain tied to the sales, purchases, and loss ledger.</p></Card>
  </div>;
}
