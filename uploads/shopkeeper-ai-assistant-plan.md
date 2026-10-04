# Dukaandaar — Voice-First AI Assistant for a Shopkeeper
### Hacktoberfest 2026 "Build for a Friend" — Engineering Plan

> **Addendum (applies throughout):** TypeScript end-to-end · two fully independent `client/` and `server/` projects with no shared folder (so either can be hosted separately) · storage layer must work against both an in-memory store and MongoDB Atlas behind one interface, with a seed script for both · generous `console.log`/`console.error` instrumentation across client and server · centralized Tailwind theme (`tailwind.config.ts`), a free icon set, and a free component library used wherever sensible rather than hand-rolled UI. See the new §3.5, revised §4, revised §11, and the updated code snippets in §5–§7 for specifics.

---

## 0. One-paragraph summary

A small shop owner talks or types in plain language ("sold 5 Maggi at 14 each"). Speech goes through the **browser's built-in Web Speech API** (not a paid STT service), the transcript goes to a locally-run **Gemma 4 (via Ollama)** model that is *forced* to emit structured JSON matching a schema — never free text, never direct DB writes. Your Node/Express backend validates that JSON against your product catalog and stock levels, executes the actual sale/purchase/expense logic, writes to **MongoDB Atlas**, and returns a natural-language confirmation. Analytics (today's sales, best-sellers, low stock, restock suggestions) are deterministic aggregation queries — no AI involved unless explicitly asked for in NL. This is the core idea that makes the whole plan hang together: **the LLM is a translator between human language and a JSON command, nothing more.**

---

## 1. Product definition

**Exact problem:** small shopkeepers track sales/stock in a notebook or not at all. They lose track of what's low, what sells, what they're owed, and have zero appetite for learning a POS UI with forms, dropdowns, and buttons.

**Target user:** one specific person — your friend's shop. Single user, single shop, no multi-tenant complexity needed for MVP. Low digital literacy, comfortable with voice notes / WhatsApp-style interaction, Hinglish or Bengali-English code-switching likely.

**Core user journey:**
1. Shopkeeper taps a mic button, says a sentence.
2. App shows what it understood, asks for a one-tap confirmation if needed.
3. Stock and sales ledger update instantly.
4. At any time, shopkeeper asks a question in the same voice/text box and gets a spoken/text answer.

**What makes this different from a generic chatbot:**
- The LLM never has DB credentials and never free-writes to storage. It outputs *only* a constrained JSON object; a deterministic backend validates and executes it. Ask the chatbot to "delete all my sales" and it physically cannot — there's no tool call for that in the schema.
- Every financial action has a confirm-before-commit step for anything ambiguous (unknown product, fuzzy quantity, low confidence parse).
- Analytics are computed by real aggregation, not by asking the LLM "how much did I sell" and hoping it doesn't hallucinate a number.
- It works meaningfully offline-first with a local open-weight model — not just "we called an API."

**Smallest useful version (true MVP):**
Record a sale by voice → see it reflected in a running inventory + today's total. That's it. Everything else (purchases, expenses, forecasting, multilingual) is additive.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              `client/` — React + Vite + TypeScript (own repo folder) │
│                                                                   │
│  ┌──────────────┐   ┌───────────────┐   ┌─────────────────────┐ │
│  │  Mic button   │──▶│ Web Speech API │──▶│  Transcript + Text   │ │
│  │ (voice input) │   │ (SpeechRecog.) │   │  input box           │ │
│  └──────────────┘   └───────────────┘   └──────────┬──────────┘ │
│                                                      │             │
│  Dashboard (today's sales, low-stock, trends) ◀──────┤ REST calls │
│  Confirm/Edit modal for ambiguous parses      ◀──────┤            │
│  Text-to-speech for responses (SpeechSynthesis) ◀────┤            │
└──────────────────────────────────────────────────────┼───────────┘
                                                         │ HTTPS/JSON
┌────────────────────────────────────────────────────────▼─────────┐
│         `server/` — Node.js + Express + TypeScript (own repo folder) │
│                                                                    │
│  POST /api/parse            POST /api/confirm      GET /api/...  │
│       │                           │                      │        │
│       ▼                           ▼                      ▼        │
│  ┌─────────────┐          ┌──────────────┐      ┌───────────────┐│
│  │ LLM Service  │          │ Business      │      │ Analytics      ││
│  │ (prompt +    │          │ Logic Layer   │      │ Service        ││
│  │ JSON schema  │─────────▶│ - validate    │      │ (deterministic ││
│  │ enforcement) │  struct  │ - resolve     │      │  aggregations) ││
│  └──────┬───────┘  JSON    │   product     │      └───────┬───────┘│
│         │                  │   aliases     │              │        │
│         │                  │ - check stock │              │        │
│         ▼                  │ - compute     │              ▼        │
│  ┌─────────────┐           │   totals      │      ┌───────────────┐│
│  │ Ollama       │           │ - write txn   │      │  MongoDB      ││
│  │ (gemma4:e4b) │           └──────┬────────┘      │  Atlas        ││
│  │ local, OR    │                  │                │  - products   ││
│  │ hosted API   │                  └───────────────▶│  - inventory  ││
│  │ (swap via    │                                   │  - sales      ││
│  │  env var)    │                                   │  - purchases  ││
│  └─────────────┘                                   │  - expenses   ││
└────────────────────────────────────────────────────┼─ - settings  ─┘│
                                                       └───────────────┘
```

**Why this shape:** the LLM layer is a thin, swappable box that only talks JSON to the business logic layer. You could rip out Ollama and plug in any hosted provider without touching anything below the "LLM Service" box — that's the explicit requirement you asked for.

**Deployment (weekend-realistic):**
- Frontend: Vercel/Netlify static build (Vite output), or Cloudflare Pages since you already know Workers.
- Backend: a single Node process. For a hackathon demo, this can literally run on your own laptop with Ollama alongside it, exposed via a tunnel (ngrok/Cloudflare Tunnel) for judges, OR deployed to Railway/Render if you want it always-on. Given 8GB RAM constraints, **local Ollama lives on your dev machine for the demo**, not on a free-tier cloud box (those don't have the RAM either).
- Database: MongoDB Atlas free tier (M0), already familiar to you, zero ops.
- Auth: not needed for MVP — single shopkeeper, single device. Add a simple PIN/passcode screen if you want a "login" visual for the demo, backed by a single env-configured credential, not a full auth system.

---

## 3. Technology selection

### Gemma vs other open-weight models

Important update since you may be thinking of Gemma 2: **Gemma 4** shipped April 2026 under Apache 2.0 (Gemma 2/3 were under the more restrictive Gemma Terms of Use). Gemma 4 comes in E2B (~2.3B effective) and E4B (~4.5B effective) edge sizes specifically built for low-memory devices, plus native structured JSON output and function calling support built into the architecture. At Q4 quantization, E4B needs roughly 5GB RAM and E2B roughly 1.5–3GB — both comfortably fit your 8GB laptop, leaving headroom for Node, the browser, and Ollama's own overhead.

**Recommendation: `gemma4:e4b` via Ollama** for the main pipeline. It's small enough to run alongside your dev tools, Apache 2.0 licensed (no legal ambiguity for a public Hacktoberfest submission), and ships with native function-calling/structured-output support — exactly what you need for the "must emit valid JSON" requirement. If E4B is too slow on your specific hardware during testing, fall back to `gemma4:e2b` (faster, still perfectly adequate for intent classification + slot extraction, which is a much easier task than open-ended chat).

Alternatives considered:
- **Qwen 2.5/3 (7B+ class):** strong structured-output performance, but larger footprint and not the open-weight model the challenge nudges you toward using (Gemma).
- **Phi-3/Phi-4 mini:** good small-model option, comparable size class, but Gemma 4's native audio input (E2B/E4B accept audio directly) is a genuinely useful bonus for a voice-first project if you later want to skip a separate STT step for certain flows.
- **Llama 3.2 1B/3B:** viable, but weaker at reliably following JSON-schema constraints in community testing than Gemma's instruction-tuned structured output.

Gemma 4 wins mainly because of (a) its size tier fitting 8GB RAM, (b) Apache 2.0 licensing for your public repo, (c) built-in structured output, and (d) it's literally the model your challenge already pointed you to.

### Ollama/local vs hosted inference

| | Local (Ollama + Gemma4:e4b) | Hosted (OpenRouter/Groq/Together serving Gemma) |
|---|---|---|
| Privacy | Shop data never leaves the laptop | Transcript + product names go to a third party |
| Cost | Free after download | Usually free/cheap tier available, but a cost exists |
| Latency | Good once warm; first-token delay a few seconds on CPU | Fast (and GPU-backed) but depends on network |
| Reliability for demo | No internet dependency — can't fail from wifi issues at a judging event | Needs stable internet |
| Setup complexity | One `ollama pull` command | One API key env var |
| MVP practicality | **Best for a weekend build**: no API key management, no rate limits, works offline, matches your "privacy-first" requirement | Good fallback if local inference is too slow on your machine |

**Recommendation: build against Ollama locally first.** It directly satisfies your stated privacy requirement (shop data shouldn't leave the owner's control) and removes a whole class of demo-day failure modes (no wifi, no API key, no rate limit). Structure the LLM service as a tiny adapter (see §6) so a hosted fallback is a 10-line change, not a rewrite — this satisfies your "easy to switch later" requirement directly.

### MongoDB Atlas vs TigerData

You already know Mongo, and the project's core data (products, inventory, sales, purchases, expenses, settings) is fundamentally **document-shaped, not time-series-shaped** — each sale is a self-contained object with line items, not a stream of sensor readings. TigerData (formerly Timescale, now Postgres-based with hypertables) genuinely shines when you have *very high-frequency* time-series data and need `time_bucket()`-style downsampling over millions of rows. A small shop doing, realistically, 10–200 transactions a day for a hackathon demo does not come close to that scale — a plain MongoDB query with a `$match` on a date range and a `$group` aggregation will be instant for years of data at this volume.

**Recommendation: MongoDB Atlas only.** Using TigerData here would be exactly the kind of "technology added to look impressive" you explicitly told me to avoid — introducing a second database, a second connection pool, a second ORM/driver, and a data-sync problem between two stores, for analytics workloads that a Mongo aggregation pipeline handles trivially at this scale. If this were a real product with thousands of shops and millions of transactions/day, TigerData's compression and continuous aggregates would start to matter — not at MVP/hackathon scale.

### Browser speech recognition vs external STT

**Recommendation: Web Speech API (`SpeechRecognition`) in the browser for MVP.** It's free, zero-latency-to-first-byte (no network round trip for transcription), already available in Chrome/Edge, and keeps voice data off any server entirely until the *transcript* (already just text) is sent for parsing — a nice privacy win. Its weaknesses: patchy Hinglish/Bengali-code-switch accuracy, and it's Chrome-centric (not in Firefox, limited in Safari).

If demo quality on Hinglish/Bengali becomes a blocker, the fallback is sending recorded audio to an external STT (e.g., a hosted Whisper endpoint) — but treat that as a Phase 6 stretch goal, not core MVP, since it adds a cloud dependency you were trying to avoid.

### Is TabPFN worth it?

**No — do not integrate it.** TabPFN is a tabular foundation model designed for small-sample classification/regression on structured tabular datasets (think: a few hundred rows, dozens of features, Kaggle-style tasks). Your forecasting need — "how many Maggi will I sell next week" — is a univariate time-series problem with one meaningful feature (date) and no complex feature table. It's also a Python-ecosystem tool, which directly fights your stated goal of staying in JavaScript and not being a Python/ML engineer. A simple moving average or linear trend over the last N days of sales per product (computed in plain JS) will give a shopkeeper a "you usually sell ~8/day, you have 3 left, restock soon" insight that is equally useful and vastly simpler to build, explain in a demo, and maintain. Save TabPFN mentions for the "what we considered and consciously rejected" section of your write-up — that's a credibility signal, not a feature you need to ship.

---

## 3.5 Toolchain, storage abstraction, logging, and UI system

These four decisions cut across the whole codebase, so they're worth settling before touching §4 onward.

### TypeScript everywhere

Both `client/` and `server/` are TypeScript projects with their own `tsconfig.json`, own `package.json`, own `node_modules`. Share nothing via a workspace/monorepo package — if client and server need the same shape (e.g. the `Intent` union type, a `Sale` shape), **duplicate the type definition in both places** rather than importing across the boundary. This is a deliberate choice, not an oversight: the whole point of the split is that either side can be deployed/hosted independently without the other existing. A shared `types/` package would reintroduce the coupling you're trying to avoid. In practice the duplicated types are small (a dozen interfaces) and drift risk is low for a weekend project — if they diverge, the backend's `zod` schema is the source of truth anyway (see §5), since the frontend's copy is only used for editor autocomplete, not runtime validation.

```
shopkeeper-assistant/
├── client/          # fully independent Vite + React + TS app
│   ├── package.json
│   ├── tsconfig.json
│   └── ...
└── server/          # fully independent Express + TS app
    ├── package.json
    ├── tsconfig.json
    └── ...
```

`server` runs via `tsx` (or `ts-node`) in dev and compiles with `tsc` for prod (`dist/`). `client` uses Vite's native TS support — nothing extra needed there.

### Storage abstraction: in-memory AND Atlas, same interface

Define a `StorageAdapter` interface in the server. Two implementations: `InMemoryAdapter` (plain JS objects/arrays, zero setup, used by default so anyone can `git clone && npm run dev` with no Atlas account) and `MongoAdapter` (real Atlas connection). Selected by an env var, nothing else in the codebase ever imports Mongo directly.

```ts
// server/src/storage/StorageAdapter.ts
export interface StorageAdapter {
  // products
  listProducts(shopId: string): Promise<Product[]>;
  findProductByAlias(shopId: string, raw: string): Promise<Product | null>;
  createProduct(p: NewProduct): Promise<Product>;

  // inventory
  getInventory(shopId: string, productId: string): Promise<Inventory | null>;
  adjustStock(shopId: string, productId: string, delta: number): Promise<Inventory>;
  listLowStock(shopId: string): Promise<Inventory[]>;

  // sales / purchases / expenses
  createSale(s: NewSale): Promise<Sale>;
  createPurchase(p: NewPurchase): Promise<Purchase>;
  createExpense(e: NewExpense): Promise<Expense>;
  querySales(shopId: string, filter: SalesFilter): Promise<Sale[]>;

  // lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  seed(): Promise<void>;   // used by the seed script, see below
}
```

```ts
// server/src/storage/index.ts
import { InMemoryAdapter } from "./InMemoryAdapter.js";
import { MongoAdapter } from "./MongoAdapter.js";

export function createStorage(): StorageAdapter {
  const driver = process.env.STORAGE_DRIVER ?? "memory"; // "memory" | "mongo"
  console.log(`[storage] initializing driver="${driver}"`);
  if (driver === "mongo") return new MongoAdapter(process.env.MONGODB_URI!);
  return new InMemoryAdapter();
}
```

Every route/service depends only on `StorageAdapter`, never on `mongoose`/`mongodb` types directly — this is what makes "both must work well" actually true rather than aspirational. `InMemoryAdapter` is not a toy stub: implement real filtering/aggregation logic in plain JS (array `.filter`/`.reduce`) so dashboard queries, low-stock checks, and sales-by-date all behave identically regardless of backend. This also means **you can demo the entire app with zero external dependencies** if Atlas or wifi ever misbehaves on demo day — a genuine safety net, not just a nice abstraction.

**Seed script, one entry point, works against either driver:**

```ts
// server/src/scripts/seed.ts
import { createStorage } from "../storage/index.js";

async function main() {
  const storage = createStorage();
  console.log("[seed] connecting...");
  await storage.connect();
  console.log("[seed] seeding demo shop, products, inventory...");
  await storage.seed();
  console.log("[seed] done.");
  await storage.disconnect();
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
```

`npm run seed` with `STORAGE_DRIVER=memory` seeds the in-process store (useful mainly for `InMemoryAdapter` tests/demos that reseed on boot — see below) and `STORAGE_DRIVER=mongo npm run seed` seeds your real Atlas cluster. Each adapter's `seed()` inserts the same fixture data (same product names/aliases/prices) so behavior is comparable between drivers. For `InMemoryAdapter` specifically, also call `storage.seed()` automatically once at server boot when `STORAGE_DRIVER=memory`, since there's no persistence between restarts otherwise — log this clearly (`[storage] in-memory driver has no persistence; auto-seeding fixture data on boot`) so it's never a silent surprise during a demo.

### Logging

Lightweight, no logging framework needed for a weekend project — `console.log`/`console.warn`/`console.error` with consistent `[module] message` prefixes is enough, and it's zero-dependency and instantly readable in a terminal during a live demo. Conventions to apply throughout both apps:

- **Server:** log every incoming request (method + path), every LLM call (prompt summary + latency + raw response), every storage write (`[sales] created sale sale_abc123 total=190`), every validation rejection with the reason, and startup config (`[server] STORAGE_DRIVER=mongo, LLM_PROVIDER=ollama, PORT=4000`).
- **Client:** log every API call (`[api] POST /api/parse`, `[api] response 200 in 340ms`), every speech-recognition event (`[speech] listening started`, `[speech] transcript: "sold 5 maggi..."`), and every state transition in the confirm flow (`[confirm] showing dialog for intent=RECORD_SALE confidence=0.93`).
- Use `console.error` (not `console.log`) for actual failures so they're visually distinct and filterable in devtools/terminal.
- A tiny `server/src/utils/logger.ts` wrapper (`log(scope, msg, data?)` / `logError(scope, msg, err?)`) keeps the prefix format consistent without pulling in `winston`/`pino` — not needed at this scale.

### Centralized Tailwind theme + free icon/UI library

**Tailwind:** all design tokens (colors, spacing scale if customized, font family, border radius) live in `client/tailwind.config.ts` under `theme.extend`, not scattered as arbitrary values (`bg-[#1a2b3c]`) in components. Define a small semantic palette once — e.g. `primary`, `surface`, `danger`, `success`, `muted` — and reference those names everywhere, so a rebrand or dark-mode pass later is a one-file change.

```ts
// client/tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#16a34a", dark: "#15803d", light: "#86efac" }, // shop-green
        surface: "#ffffff",
        muted: "#6b7280",
        danger: "#dc2626",
        success: "#16a34a",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
      },
      borderRadius: {
        card: "1rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

**Icons:** [`lucide-react`](https://lucide.dev) — free, MIT-licensed, tree-shakeable, already listed as available in this environment's artifact tooling, and covers everything needed here (`Mic`, `Check`, `X`, `TrendingUp`, `AlertTriangle`, `Package`).

**UI library:** [`shadcn/ui`](https://ui.shadcn.com) — not an npm dependency but copy-in Radix-based components (Button, Dialog, Card, Badge) styled with Tailwind, which means they inherit the centralized theme above automatically and stay fully editable (no black-box library styling to fight). Use it for the Confirm/Edit modal (`Dialog`), buttons, and dashboard cards — exactly the kind of "boring but correct" UI chrome you don't want to hand-roll under a deadline. If `shadcn/ui`'s CLI setup is more friction than it's worth for a few components, a lighter fallback is [`@headlessui/react`](https://headlessui.com) (also free, unstyled, Tailwind-native) for just the Dialog — either is fine, pick whichever installs faster on the day.

---

## 4. Data model

Six logical entities, expressed below as MongoDB documents. These are also exactly the TypeScript interfaces each `StorageAdapter` implementation works with — `MongoAdapter` persists them as real collections, `InMemoryAdapter` keeps them as `Map<string, T>` in process memory with the same field shapes, so switching drivers never changes what a route handler sees. Single-shop, so no multi-tenant sharding needed for MVP, but I include a `shopId` field anyway since it costs nothing now and saves a painful migration if you ever add a second friend's shop.

```js
// ── products ──────────────────────────────────────────────
{
  _id: ObjectId,
  shopId: "shop_001",
  name: "Maggi 2-Minute Noodles",
  aliases: ["maggi", "maggi noodles", "ম্যাগি"],   // for fuzzy matching
  category: "snacks",
  unit: "packet",
  sellPrice: 14,
  costPrice: 10,
  createdAt: ISODate,
  updatedAt: ISODate
}

// ── inventory ─────────────────────────────────────────────
{
  _id: ObjectId,
  shopId: "shop_001",
  productId: ObjectId("..."),      // ref -> products
  quantityOnHand: 42,
  lowStockThreshold: 10,
  lastRestockedAt: ISODate,
  updatedAt: ISODate
}

// ── sales ─────────────────────────────────────────────────
{
  _id: ObjectId,
  shopId: "shop_001",
  timestamp: ISODate,
  items: [
    { productId: ObjectId("..."), productName: "Maggi", qty: 5, unitPrice: 14, lineTotal: 70 },
    { productId: ObjectId("..."), productName: "Coke",  qty: 3, unitPrice: 40, lineTotal: 120 }
  ],
  totalAmount: 190,
  paymentMethod: "cash",            // cash | credit | upi
  source: "voice",                  // voice | text | manual
  rawTranscript: "I sold 5 Maggi at 14 each and 3 Coke at 40 each",
  confirmedByUser: true
}

// ── purchases ─────────────────────────────────────────────
{
  _id: ObjectId,
  shopId: "shop_001",
  timestamp: ISODate,
  items: [
    { productId: ObjectId("..."), productName: "Maggi", qty: 50, unitCost: 10, lineTotal: 500 }
  ],
  totalAmount: 500,
  supplier: "Local Distributor",
  source: "voice"
}

// ── expenses ──────────────────────────────────────────────
{
  _id: ObjectId,
  shopId: "shop_001",
  timestamp: ISODate,
  category: "electricity",          // rent | electricity | transport | misc
  amount: 1200,
  note: "monthly bill",
  source: "text"
}

// ── settings ──────────────────────────────────────────────
{
  _id: "shop_001",
  shopName: "Ramesh General Store",
  currency: "INR",
  language: "en-IN",                // default voice locale
  lowStockDefaultThreshold: 10,
  createdAt: ISODate
}
```

A `conversations` collection is optional and not needed for MVP — you don't need chat history persistence for the assistant to work; each voice command is self-contained. Skip it unless you want a "recent commands" audit log, in which case a capped collection of `{timestamp, rawTranscript, parsedIntent, action, result}` is a cheap addition in Phase 5.

---

## 5. AI design — the core of the project

**The golden rule:** the LLM only ever returns one of a fixed set of JSON "intent" shapes. The backend is the only thing allowed to touch the database. If the JSON doesn't validate against the schema, or references a product that can't be resolved, the backend rejects it and asks the LLM to retry or asks the user to clarify — it never guesses.

### System prompt (sent with every request)

```
You are a structured command parser for a shop assistant. You NEVER answer
questions directly and you NEVER perform actions. You ONLY output a single
JSON object matching one of the schemas below. If the input is ambiguous,
set "needsConfirmation": true and fill "confidence" honestly (0-1).

Known products: {{productListWithAliases}}
Today's date: {{currentDate}}

Output ONLY valid JSON. No prose, no markdown fences, no explanation.

Schemas:
1. RECORD_SALE
2. RECORD_PURCHASE
3. RECORD_EXPENSE
4. QUERY_SALES
5. QUERY_INVENTORY
6. UNKNOWN  (use when input doesn't match any of the above)
```

### Example 1 — Recording a sale

**User:** "I sold 5 Maggi at 14 each and 3 Coke at 40 each"

```json
{
  "intent": "RECORD_SALE",
  "confidence": 0.95,
  "needsConfirmation": false,
  "items": [
    { "productNameRaw": "Maggi", "matchedProductId": "prod_maggi_001", "qty": 5, "unitPrice": 14 },
    { "productNameRaw": "Coke",  "matchedProductId": "prod_coke_001",  "qty": 3, "unitPrice": 40 }
  ],
  "totalAmount": 190
}
```
*(Note: `matchedProductId` is filled by the backend after the LLM returns `productNameRaw` — the LLM shouldn't be trusted to invent IDs. In practice the LLM returns only `productNameRaw`/`qty`/`unitPrice`, and the backend's alias-resolution step fills in `matchedProductId`, computes `totalAmount` itself from its own price lookup — never trusting the LLM's arithmetic — and only then triggers confirmation.)*

### Example 2 — Recording a purchase (restock)

**User:** "Bought 50 packets of Maggi from the distributor for 500 rupees"

```json
{
  "intent": "RECORD_PURCHASE",
  "confidence": 0.9,
  "needsConfirmation": false,
  "items": [
    { "productNameRaw": "Maggi", "qty": 50, "unitCost": 10 }
  ],
  "supplier": "distributor",
  "totalAmount": 500
}
```

### Example 3 — Recording an expense

**User:** "Paid 1200 for electricity bill"

```json
{
  "intent": "RECORD_EXPENSE",
  "confidence": 0.92,
  "needsConfirmation": false,
  "category": "electricity",
  "amount": 1200,
  "note": "electricity bill"
}
```

### Example 4 — Querying sales

**User:** "How much Coke did I sell yesterday?"

```json
{
  "intent": "QUERY_SALES",
  "confidence": 0.93,
  "filters": {
    "productNameRaw": "Coke",
    "dateRange": "yesterday"
  }
}
```
*(The backend resolves "yesterday" to actual dates, resolves "Coke" to a product ID, runs a real aggregation, and generates the NL response from the real number — the LLM never sees or states the answer itself.)*

### Example 5 — Checking inventory

**User:** "What should I restock soon?"

```json
{
  "intent": "QUERY_INVENTORY",
  "confidence": 0.97,
  "subtype": "LOW_STOCK_OR_RESTOCK_SUGGESTION"
}
```

### Example 6 — Ambiguous input

**User:** "Sold some chips"

```json
{
  "intent": "RECORD_SALE",
  "confidence": 0.4,
  "needsConfirmation": true,
  "items": [
    { "productNameRaw": "chips", "qty": null, "unitPrice": null }
  ],
  "clarificationNeeded": "quantity and price not specified; 'chips' matched multiple products"
}
```
Backend response to user: *"I heard you sold chips but I'm not sure how many or which brand, or the price. Can you say it again with quantity and price?"* — no DB write happens.

### Preventing hallucinated transactions

1. **Schema enforcement at the model layer** — use Ollama's structured-output / JSON-mode (Gemma 4 supports this natively), so the model is constrained to emit valid JSON matching your schema, not free text you then try to regex out.
2. **Backend never trusts LLM arithmetic.** It recomputes `totalAmount` itself from its own price/qty lookup. If the LLM's stated total disagrees with the recomputed one, that's itself a signal to require confirmation.
3. **Product resolution happens in code**, not in the model. The LLM gives you a raw name string; a backend fuzzy-matcher (exact alias match → fuzzy string match via something like `fuse.js` → "no match, ask user") resolves it against your actual `products` collection. If no confident match, force confirmation.
4. **Confidence threshold gate:** anything below, say, 0.7 confidence, or any `needsConfirmation: true`, always shows the Confirm/Edit UI — never auto-commits.
5. **Every write is logged with the raw transcript** (see the `rawTranscript` field in the `sales` schema) so the shopkeeper (or you, debugging) can always see what was actually said versus what was recorded.
6. **No destructive intents exist in the schema.** There is no `DELETE_SALE` or `UPDATE_INVENTORY_DIRECTLY` intent the model can emit — deletions/edits happen through explicit UI actions only, never through the voice pipeline. This is the single most important guardrail in the whole system.

### Confirmation flow (your example, implemented)

```
User (voice): "Sold five Maggi at fourteen rupees"
       │
       ▼
[STT] → "sold five maggi at fourteen rupees"
       │
       ▼
[LLM] → { intent: RECORD_SALE, items: [{productNameRaw:"maggi", qty:5, unitPrice:14}], confidence: 0.93 }
       │
       ▼
[Backend] resolves "maggi" → prod_maggi_001 (exact alias match, high confidence)
           recomputes total = 5 × 14 = 70
           confidence high + exact match → still shows confirmation (sales always confirm by default for MVP;
           you can relax this once the demo is solid)
       │
       ▼
[UI] "I understood 5 × Maggi @ ₹14 = ₹70. Record this sale?"   [Confirm]  [Edit]
       │
       ▼ (user taps Confirm)
[Backend] writes to `sales`, decrements `inventory.quantityOnHand` by 5 atomically
       │
       ▼
[UI/TTS] "Done. Maggi stock is now 37."
```

---

## 6. Voice architecture

```
Mic tap
  │
  ▼
Web Speech API (SpeechRecognition) — runs in-browser, Chrome/Edge
  │  transcript (plain text)
  ▼
POST /api/parse { transcript }
  │
  ▼
LLM Service (Node)
  ├─ builds system prompt + product list + transcript
  ├─ calls Ollama local endpoint (http://localhost:11434/api/generate or /api/chat)
  │     with format: "json" / Ollama structured output mode
  └─ returns parsed intent JSON
  │
  ▼
Business Logic Layer validates + resolves + (maybe) asks for confirmation
  │
  ▼
Response text generated from REAL data (template strings, not LLM-generated numbers)
  │
  ▼
Browser SpeechSynthesis API speaks the response (optional, toggleable)
```

**Practical JS-friendly pieces:**
- `SpeechRecognition` / `webkitSpeechRecognition` — zero dependencies, built into Chrome.
- `SpeechSynthesisUtterance` — built-in TTS, no API needed, for reading responses back.
- Ollama's REST API (`/api/generate` with `"format": "json"`, or `/api/chat` with a `tools`/structured-output schema if using Gemma 4's native function-calling) — called via plain `fetch` from Node, no Python SDK needed.
- A tiny **adapter interface** so swapping local→hosted is trivial:

```ts
// server/src/services/llmProvider.ts
import type { ParsedIntent } from "../types/intents.js";

interface ParseContext {
  productList: { id: string; name: string; aliases: string[] }[];
  currentDate: string;
}

export async function parseCommand(
  transcript: string,
  context: ParseContext
): Promise<ParsedIntent> {
  const provider = process.env.LLM_PROVIDER ?? "ollama";
  console.log(`[llmProvider] provider="${provider}" transcript="${transcript}"`);

  const start = Date.now();
  let result: ParsedIntent;

  if (provider === "ollama") {
    result = await callOllama(transcript, context);
  } else if (provider === "hosted") {
    result = await callHostedProvider(transcript, context); // e.g. OpenRouter serving gemma
  } else {
    throw new Error(`[llmProvider] unknown LLM_PROVIDER: ${provider}`);
  }

  console.log(`[llmProvider] parsed intent="${result.intent}" in ${Date.now() - start}ms`);
  return result;
}
```
This single `if` is the entirety of what "easy to switch between local and hosted inference" costs you — don't over-build an abstraction layer beyond this.

---

## 7. Analytics — deterministic vs AI

**Deterministic (plain MongoDB aggregation — build these first, they're most of the user value):**
- Today's total sales: `$match` on date range + `$sum`.
- Weekly sales / best-selling products: `$unwind` items, `$group` by productId, `$sum` qty and revenue, `$sort` descending.
- Low-stock products: simple `$match` on `inventory.quantityOnHand <= lowStockThreshold`.
- Sales trends (day-over-day, week-over-week): `$group` by date bucket.
- Expense totals by category: `$group` on `expenses.category`.

**Needs light "AI"/heuristics (still plain JS, not a model call):**
- **Estimated days until stockout:** `currentStock / averageDailySalesLast14Days`. This is arithmetic, not ML — don't dress it up as AI in your write-up, just call it "a simple projection."
- **Restocking suggestion:** flag products where `daysUntilStockout < leadTimeAssumption` (e.g. 3 days). Again, a threshold rule, not a model.
- **Simple sales forecasting (if you want it as a stretch goal):** a basic moving average or linear regression over the last N days per product, computed in plain JS (even a 10-line implementation is enough — no need for a library). This is honestly "forecasting" for demo purposes and keeps you fully in JS.

**Where an LLM call genuinely helps (and only here):** turning the *result* of a deterministic query into a friendly spoken sentence — "You've sold ₹1,240 today, mostly snacks" — versus a raw JSON blob. Even this can be done with string templates for MVP; only use the LLM for this if you want more natural variation in phrasing, and even then, feed it the *real computed numbers* to phrase, never let it compute them.

---

## 8. TabPFN — explicit verdict

**Not used. Explicitly rejected, and here's why that's stated on purpose:** TabPFN is built for tabular classification/regression on structured feature tables with a few hundred rows — a fundamentally different shape of problem than "how many units of product X will sell over the next week," which is a small univariate time series. It's also Python-only, pulling you out of the JS ecosystem you explicitly want to stay in, and it would add a Python microservice, a second runtime, and inference overhead to a project whose entire pitch is "lean, practical, LLM output flows into real business logic." Mentioning that you considered it and chose a simpler, more appropriate deterministic approach instead is a legitimate engineering-judgment point to make in your DEV write-up — it shows you evaluated the tool against the actual problem shape rather than bolting it on for buzzword value.

---

## 9. Security / privacy

- **Local-first by default:** Ollama runs on the shopkeeper's own machine (or yours, for the demo). Sales/inventory data in MongoDB Atlas is yours/theirs — not sent to any AI vendor, since the LLM only ever sees the current transcript + a product name list, never historical sales data, during inference.
- **What should/shouldn't reach an external model provider (if you ever flip to hosted mode):** send only the transcript + the minimal product alias list needed for that single parse. Never send full sales history, customer data, or financial totals to an external LLM provider — those stay local, used only by your own deterministic analytics code.
- **API key handling:** any hosted-provider key lives in a `.env` file, loaded via `dotenv`, never committed (`.gitignore` it), never exposed to the frontend — all LLM calls happen server-side only.
- **Data validation:** every JSON object from the LLM is validated against a schema (use `zod` or `ajv` — both are JS-native, zero Python needed) before it touches business logic. Reject anything that doesn't parse cleanly.
- **Authentication:** out of scope for a single-shop MVP; if you want *something* for the demo, a single shared passcode gate (stored hashed in `settings` or an env var) is enough — don't build real multi-user auth for a Hacktoberfest weekend.
- **Database security:** MongoDB Atlas with IP allowlisting or VPC peering for your deployed backend, a dedicated DB user with least-privilege (read/write only on your app's database, not admin), and connection string in env vars only.

---

## 10. MVP roadmap (phased for a short deadline)

### Phase 1 — Basic working prototype (no AI yet)
**Tasks:** Express server + MongoDB connection; `products`, `inventory`, `sales` collections; basic REST endpoints (`POST /sales`, `GET /inventory`, `GET /sales/today`); minimal React form (not voice yet) to manually add a sale and see inventory update.
**Files/modules:** `server/src/index.ts`, `server/src/storage/InMemoryAdapter.ts` (start here — zero setup), `server/src/routes/sales.ts`, `server/src/routes/inventory.ts`, `client/src/App.tsx`, `client/src/components/SaleForm.tsx`. Wire `MongoAdapter.ts` and the seed script once the in-memory path works end-to-end.
**Output:** you can add a sale via a form and see stock decrement. Boring but it's the foundation everything else plugs into.
**Can skip if short on time:** styling — make it ugly but functional first.

### Phase 2 — AI integration (text, not voice yet)
**Tasks:** install Ollama, pull `gemma4:e4b`; build `llmProvider.ts` adapter; write the system prompt + JSON schema; build `POST /api/parse` endpoint that takes typed text, returns structured intent; build product alias resolution + total recomputation in business logic layer; wire a text input box in the client that sends to `/api/parse` then shows a confirm dialog; add `console.log` at each pipeline stage (transcript received → LLM call → parsed intent → resolution result) so the flow is visible in the server terminal during dev.
**Files/modules:** `server/src/services/llmProvider.ts`, `server/src/services/intentSchemas.ts` (zod schemas), `server/src/services/productResolver.ts`, `server/src/routes/parse.ts`, `client/src/components/CommandInput.tsx`, `client/src/components/ConfirmDialog.tsx` (built on the `ui/Dialog` from shadcn/ui).
**Output:** typing "sold 5 maggi at 14 each" produces a confirm dialog with the right numbers, and confirming writes a real sale.
**Can skip if short on time:** purchase/expense intents — get sale + query working first, add the other two if time remains (they reuse the same pipeline, so they're cheap once sale recording works).

### Phase 3 — Voice
**Tasks:** wire `SpeechRecognition` to the mic button, feeding transcripts into the same `/api/parse` pipeline from Phase 2 (no backend changes needed — this is purely a frontend addition); add `SpeechSynthesis` for spoken responses.
**Files/modules:** `client/src/hooks/useSpeechRecognition.ts`, `client/src/hooks/useSpeechSynthesis.ts` — both should log every recognition event (`start`, `result`, `error`, `end`) so mic issues are diagnosable from the browser console during the demo.
**Output:** the demo-critical "talk to it" experience.
**Can skip if short on time:** TTS output (text confirmation is enough; voice *input* is the differentiator, voice *output* is a nice-to-have).

### Phase 4 — Inventory / analytics
**Tasks:** low-stock aggregation query + dashboard widget; weekly best-sellers aggregation; today/this-week sales summary cards; `QUERY_SALES` and `QUERY_INVENTORY` intents wired end-to-end so NL questions work.
**Files/modules:** `server/src/services/analyticsService.ts`, `server/src/routes/analytics.ts`, `client/src/components/Dashboard.tsx`, `client/src/components/LowStockAlert.tsx` (using `lucide-react`'s `AlertTriangle`/`TrendingUp`/`Package` icons and `ui/Card` for layout).
**Output:** "What sold the most this week?" and "What should I restock?" work via voice/text, dashboard shows real numbers.
**Can skip if short on time:** sales trend charts (nice visually, not core to the pitch) — a simple list/number is enough.

### Phase 5 — Polish / demo
**Tasks:** clean up UI (bigger buttons, clear mic affordance, loading states), seed realistic demo data (a believable product catalog with Hinglish aliases), write the demo script (see §12), record a backup video in case live demo fails, write the DEV submission post.
**Files/modules:** `server/src/scripts/seed.ts` (run once against `STORAGE_DRIVER=memory` and once against `mongo` to confirm both paths produce an identical-looking demo), demo video, README documenting both storage modes.
**Output:** a submission-ready project.
**Can skip if short on time:** nothing here — this phase is what makes the difference between "working code" and "project that wins."

### Phase 6 — Optional advanced feature (only if everything above is solid with time to spare)
**Pick one, not all:** (a) simple restock-forecast number using the moving-average approach from §7, (b) product aliasing UI so the shopkeeper can teach the app new nicknames for products, (c) Hinglish/Bengali prompt tuning for better parse accuracy, (d) hosted-inference fallback wired and demoed as a toggle.
**Explicitly not Phase 6 material:** TabPFN, a second database, multi-tenant auth — these would not improve the demo and risk destabilizing a working MVP days before the deadline.

---

## 11. Project structure

Two fully independent top-level apps — no root `package.json`, no shared workspace, no shared `types/` package. Each has its own `node_modules`, lockfile, `.env`, and can be deployed to a different host with zero changes to the other.

```
shopkeeper-assistant/
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example                    # STORAGE_DRIVER, MONGODB_URI, LLM_PROVIDER, PORT...
│   └── src/
│       ├── index.ts                    # Express app entry, logs startup config
│       ├── storage/
│       │   ├── StorageAdapter.ts       # interface (§3.5)
│       │   ├── InMemoryAdapter.ts
│       │   ├── MongoAdapter.ts
│       │   └── index.ts                # createStorage() factory
│       ├── types/
│       │   ├── Product.ts
│       │   ├── Inventory.ts
│       │   ├── Sale.ts
│       │   ├── Purchase.ts
│       │   ├── Expense.ts
│       │   └── Settings.ts
│       ├── routes/
│       │   ├── parse.ts                # POST /api/parse (voice/text -> intent)
│       │   ├── sales.ts
│       │   ├── purchases.ts
│       │   ├── expenses.ts
│       │   ├── inventory.ts
│       │   └── analytics.ts
│       ├── services/
│       │   ├── llmProvider.ts          # Ollama / hosted adapter
│       │   ├── intentSchemas.ts        # zod schemas for every intent
│       │   ├── productResolver.ts      # alias/fuzzy matching
│       │   ├── businessLogic.ts        # validate -> execute -> persist
│       │   └── analyticsService.ts     # deterministic aggregations
│       ├── scripts/
│       │   └── seed.ts                 # works against either driver, see §3.5
│       └── utils/
│           └── logger.ts               # log()/logError() console wrapper
│
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts              # centralized theme (§3.5)
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── types/                      # duplicated, not imported from server — see §3.5
│       │   └── intents.ts
│       ├── components/
│       │   ├── ui/                     # shadcn/ui components (Button, Dialog, Card, Badge)
│       │   ├── CommandInput.tsx
│       │   ├── ConfirmDialog.tsx
│       │   ├── Dashboard.tsx
│       │   └── LowStockAlert.tsx
│       ├── hooks/
│       │   ├── useSpeechRecognition.ts
│       │   └── useSpeechSynthesis.ts
│       ├── api/
│       │   └── client.ts               # fetch wrapper, logs every call (§3.5)
│       └── utils/
│           └── logger.ts
│
└── README.md                            # explains running each app independently,
                                          # both STORAGE_DRIVER modes, and seeding
```

Why no root `package.json`/workspace tooling (Turborepo, npm workspaces, etc.): the explicit goal is that `client/` and `server/` can be handed to two different hosting providers (e.g. client on Vercel, server on Railway) without either one needing to know the other exists in the same repo. A workspace setup optimizes for local dev convenience at the cost of that independence — not the right trade here. The only thing tying them together is the `README.md` documenting the `VITE_API_BASE_URL` env var the client needs to point at wherever the server ends up running.

---

## 12. Demo scenario (2–3 minutes)

1. **(0:00–0:25) Setup shot:** show the dashboard — a modest product catalog already seeded, today's sales at ₹0. State the problem in one sentence: "My friend runs a shop and tracks everything in a notebook."
2. **(0:25–0:55) Add inventory by voice:** tap mic, say *"Got 50 packets of Maggi and 30 bottles of Coke from the distributor."* Show the parsed confirm dialog, tap Confirm, show inventory numbers update live.
3. **(0:55–1:30) Record a sale by voice:** tap mic, say *"Sold 5 Maggi at 14 each and 3 Coke at 40 each."* Show the confirm dialog with the computed total (₹190), confirm, show stock decrement in real time on the dashboard.
4. **(1:30–2:00) Ask a natural-language question:** tap mic, say *"How much did I sell today?"* — app responds (voice + text) with the real total. Then ask *"What's running low?"* to show the low-stock query path.
5. **(2:00–2:30) Show the business insight:** dashboard surfaces "Maggi: 45 left, selling ~5/day, restock in ~9 days" — the deterministic restock-suggestion feature.
6. **(2:30–2:50) Close on the architecture point:** a 10-second cut to the terminal showing Ollama running locally, with a line like "this whole thing runs offline, on my laptop, with an open-weight model — no cloud AI vendor ever sees this shop's sales data."

Keep a recorded backup of this exact flow — live voice recognition demos are the single highest-risk element at a judged event (background noise, wifi issues). Script it, rehearse it twice, and if live voice is shaky on the day, fall back to the pre-recorded video without apology.

---

## 13. Hacktoberfest positioning

**Why this isn't a generic GPT wrapper:** the LLM has no database access, no free-text output path to the user, and no arithmetic authority — it is one constrained component in a pipeline where a deterministic backend does validation, product resolution, math, and persistence. You can demonstrate this directly: show the backend rejecting a malformed/hallucinated LLM response, or show that asking the assistant to "delete my sales" produces nothing, because no such intent exists in the schema. That's a concrete, demoable architecture decision a wrapper couldn't show.

**Why open-weight AI is genuinely central, not incidental:** the entire privacy pitch — "a shopkeeper's business data stays under their control" — depends on being able to run inference locally without sending transcripts to a third party. That's only possible because Gemma 4 is a small, Apache-2.0, locally-runnable model. A closed hosted model would undermine the actual value proposition of the project, not just be a different implementation choice.

**Why it matters to the specific friend:** be concrete and personal in the write-up — name the actual pain point (manual notebook tracking, no idea what's low until it's out, no sense of what sells) and show, in the demo, the exact sentence structure they'd naturally use, not a sanitized "test query."

**What to highlight in the DEV submission:**
- The pipeline diagram from §2, emphasizing the LLM's boxed-in role.
- The confirm-before-commit flow as a deliberate hallucination-mitigation design, not an afterthought.
- The single-database decision (§3) as a conscious anti-overengineering choice, explained briefly — this signals engineering maturity to judges more than a flashy but unnecessary multi-DB setup would.
- The TabPFN rejection reasoning (§8) — explicitly saying "we considered X and chose not to use it because Y" reads as more credible than silently not mentioning it.
- A short clip or GIF of the live voice flow from §12.

**What makes the project more credible:** showing you understand *why* each piece is there (small model size for 8GB RAM, Apache 2.0 licensing, deterministic analytics vs AI-generated numbers, no destructive LLM-triggerable actions) rather than listing technologies as a buzzword stack. Judges reading "we chose Mongo over a second time-series DB because our data volume doesn't warrant it" will trust the rest of your claims more than a project that used every trendy tool available.
