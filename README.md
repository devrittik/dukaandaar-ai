# Dukaandaar

Dukaandaar helps a small shop keep track of products, stock, sales, purchases, expenses, and losses. You can use the dashboard, fill in a form, or ask the Assistant by typing or speaking. It turns recorded transactions into clear daily and weekly reports.

> **New here?** Start with [Use Dukaandaar](#use-dukaandaar). If you are setting up the project, see [Run it on your computer](#run-it-on-your-computer). For the full system guide, see [architecture.md](architecture.md).

## What shop owners can do

- Record sales, purchases, expenses, stock losses, and products using the Assistant or manual forms.
- Review daily and weekly sales, purchases, expenses, losses, profit, recent activity, and popular products.
- Check current inventory and low-stock alerts; edit product details and alert thresholds.
- Ask questions about stock, transaction totals, purchase history, losses, product prices, and profit.
- Use English, Hindi, Bengali, French, Spanish, Portuguese, Arabic, or Chinese in the Assistant. English is selected by default.

## Use Dukaandaar

1. Open the app and create an account with your name, shop name, email, and password.
2. The **Assistant** opens first. Type a question or request, use the microphone, or choose a manual entry from Overview.
3. For Assistant changes, check the spoken and on-screen preview before saving. Confirm with a button or voice, or cancel. Manual forms save when you submit them.
4. Use **Overview** for a quick look, **Transactions** for recent ledger entries, **Inventory** for products and stock, **Reports** for daily/weekly numbers, and **Settings** for shop details.

Try requests such as:

- “What were my sales this week?”
- “How much stock was lost this month?”
- “I sold 3 Maggi Noodles at ₹12 each.”
- “Add Soap, selling price ₹25, cost ₹16, opening stock 5.”

You can correct the Assistant or ask it to clarify. It does not save an Assistant transaction until you confirm it.

### Stock and profit, in plain language

- A sale reduces stock. A purchase increases stock. A loss reduces stock and is recorded at cost.
- A new product with **positive opening quantity** is recorded as an initial purchase, so stock and purchase history agree. A product with **zero opening quantity** is added to the catalog only.
- On-hand stock is not directly editable. It changes through sales, purchases, and losses. Product details and low-stock alerts can be edited.
- Estimated profit is **sales revenue − cost of the items sold − expenses − stock losses at cost**. A purchase adds inventory; it is not counted as an immediate expense.
- Reports use recorded data and deterministic calculations, not AI-generated totals. Treat them as operational shop reports, not formal tax or accounting statements.

## Privacy and connected services

Shop business data is stored in that shop's MongoDB database; account/session records are kept in the shared control database. The Assistant's short-term context is held in API memory, can be cleared in the app, expires after two hours idle, and disappears when the API restarts. Chat messages shown in the page are not saved as a permanent chat history. Text or voice transactions created from the Assistant may retain the original transcript on their ledger record. **The API also currently writes incoming Assistant transcript text to server logs**, so protect production logs and their retention settings.

When you choose a hosted LLM, the request can include your message, recent Assistant context, the selected language, and relevant catalog product names/aliases. It does not send the shop's transaction ledger for the model to total; the API calculates answers from your data. Hosted speech-to-text sends recordings to the configured provider, and hosted text-to-speech sends the Assistant read-back text. Provider keys stay on the API server. Review the configured vendors' data practices before enabling hosted services.

## Run it on your computer

### What you need

- Node.js **20.19 or newer in the 20.x line, or 22.12 or newer**.
- npm (included with Node.js).
- MongoDB for data that persists when the API stops. MongoDB can run locally or be hosted. For a quick, temporary try-out, the in-memory option is available (see below).

The project has two separate applications: `server/` (API) and `client/` (website). Run them in two terminals. On the first run, copy the example server environment file to `server/.env` and adjust it if needed. The example uses MongoDB on your own computer, the rules-based Assistant, and local speech mode:

```bash
# Terminal 1 — API
cd server
npm ci
cp .env.example .env   # First run only; do not overwrite an existing .env
npm run dev
```

```bash
# Terminal 2 — website
cd client
npm ci
npm run dev
```

If you use Windows PowerShell, the copy command is `Copy-Item .env.example .env` (run it from `server/`). Open the Vite address printed in Terminal 2; it is usually `http://localhost:5173`.

The API uses MongoDB by default and **does not seed demo data when it starts**. Sign up to create a private, empty shop. If MongoDB is not running and you only want a disposable local demo, set `STORAGE_DRIVER=memory` in `server/.env`. In-memory accounts and shop data disappear when the API stops. You can type without installing speech models; in development, browser speech may be available as a fallback.

### Environment choices

- **Development:** `NODE_ENV=development` (or `dev`). Local MongoDB, in-memory storage, Ollama, rules-based parsing, local Sherpa-ONNX speech, or hosted providers can be selected.
- **Production:** `NODE_ENV=production` (or `prod`). The API checks its configuration before it starts. It requires hosted MongoDB, a hosted LLM endpoint/key/model, hosted speech-to-text and text-to-speech configuration, and HTTPS frontend origins. Production does not use in-memory storage, Ollama, local Sherpa, or browser speech fallbacks. If the hosted LLM fails, the deterministic rules parser remains as a safety fallback.

Server secrets belong in `server/.env`, never in website code or a settings screen. Start a deployment from [`server/.env.production.example`](server/.env.production.example), replace every placeholder, and do not commit the resulting `.env`. The website's optional `VITE_API_BASE_URL` is set at build time when the API is hosted separately; leave it blank for the local Vite proxy. See [Runtime configuration and deployment](architecture.md#runtime-configuration-and-deployment) for the full explanation.

### Local speech models (optional)

Sherpa-ONNX model weights are not included. Local speech-to-text needs a compatible multilingual Whisper **ONNX** encoder, decoder, and tokens file; Whisper.cpp GGML `.bin` files are not interchangeable. Local speech output uses the Sherpa-ONNX Supertonic model bundle. The Assistant can still be used by typing without these files. See [Speech pipeline](architecture.md#speech-pipeline) for the expected assets and hosted/local behavior.

## Shop data and administrator commands

User accounts and login sessions live in the shared MongoDB **control database** named by `MONGODB_DB`. Each shop's settings, products, inventory, sales, purchases, expenses, and losses live in a separate MongoDB database named `${MONGODB_SHOP_DB_PREFIX}${shop_id}`. New signups receive a new shop ID and an isolated shop database. Keep `MONGODB_SHOP_DB_PREFIX` unchanged when you redeploy; changing it can make existing shop databases harder to find.

Legacy shop records in the old shared database are not automatically claimed, changed, or moved. If an existing registered account has business records in that old database, back it up, stop the API, then migrate that one shop before starting the updated API:

```bash
cd server
npm run migrate:shop -- --shop-id <shop_id>
```

The migration requires an account registered to that `shop_id`; it copies and verifies the shop's records before removing the old copies. It refuses to migrate the protected legacy/demo `SHOP_ID` fixture. See [Shop databases and data operations](architecture.md#shop-databases-and-data-operations).

To deliberately replace one shop's records with demo data, use the seed command with an explicit ID:

```bash
cd server
npm run seed -- --shop-id <shop_id>
```

This is **destructive for that shop ID**. Find a registered shop's ID in `users.shopId` in the control database. The command requires the flag, uses MongoDB, targets only the specified shop database, and never runs automatically at API startup. Do not run it for a shop whose records you want to keep.

A MongoDB replica set or `mongos` is recommended for full multi-document transaction atomicity. Standalone MongoDB is supported with guarded writes and compensating rollback, but a process or server failure in the middle of a write cannot have the same atomicity guarantee.

## For contributors

### Project map

```text
client/   React + TypeScript website (Vite)
server/   Express + TypeScript API and business logic
architecture.md   system design, request flows, data model, and operations
LICENSE   MIT license
```

The client and server have separate `package.json` files and separate type definitions. If you change an API response, update both the server implementation and the matching client types/UI.

### Test and build

Run commands from each application folder:

```bash
cd server
npm test
npm run build

cd ../client
npm run build
```

The server tests cover authentication, parsing, business rules, storage behavior, speech providers, runtime configuration, and targeted shop operations. Most test runs do not need live cloud-provider credentials. Before deploying a storage change, also test with a disposable MongoDB database and back up any existing data.

### Where to make common changes

- Pages and application state: `client/src/App.tsx`
- Assistant chat and confirmation UI: `client/src/components/AssistantPanel.tsx`
- API client and browser request behavior: `client/src/api/client.ts`
- API routes and authentication middleware: `server/src/index.ts`
- Assistant decisions, previews, and transaction commits: `server/src/services/businessLogic.ts`
- Intent shape and LLM instructions: `server/src/services/intentSchemas.ts`
- Rule-based parser and fallback: `server/src/services/ruleParser.ts`
- Dashboard and profit calculations: `server/src/services/analyticsService.ts`
- MongoDB and in-memory storage: `server/src/storage/`
- Server-side environment checks: `server/src/config/runtimeConfig.ts`

See [architecture.md](architecture.md) for the complete map, API list, security boundaries, and design decisions.

## License

Dukaandaar is distributed under the [MIT License](LICENSE).