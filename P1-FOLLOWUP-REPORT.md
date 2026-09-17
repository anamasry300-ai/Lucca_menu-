# P1 Follow-up Report — Split Payments, Explicit Refunds, SSRF, SQLite Sessions (Lucca Caffè POS)

Status: IMPLEMENTED · Build: `npm run build` ✓ · Tests: 159/159 ✓
Scope: server-first money paths + harden `/api/proxy-llm` + move sessions out of RAM + manual-record invoice via server checkout only. No UI redesign, no stack change, no kitchen WebSocket changes.

## 1. Workstreams delivered

1. **Split/ai-pos collections go only through `/checkout`** — no local paid write, no PUT-paid fallback, order stays open on network failure.
2. **Manual-record invoices (بيع خارجي) go only through server `/checkout`** — `Orders.recordManualInvoice` creates an open `pending/unpaid` order server-side (crud POST, session/device identity), then closes it via `/checkout` (payment row + audit + daily shift); the phantom open order is deleted from the server if checkout fails; no local paid order is ever written. Used by ai-pos `toolRecordInvoice` and the chat invoice flow in `index.html` (zero-amount "إيراد" expense hack removed).
2. **Explicit refunds path** — paid-only, reason required, amount ≤ net paid, cumulative cap (no double full refund), single one-time stock return, manager can refund, cashier/device cannot, DELETE refunds stays admin-only.
3. **SSRF guard on `/api/proxy-llm`** — strict host allowlist, private/metadata IP rejection even after DNS lookup, no redirect following, timeout + body caps, auth stays batman-level (`authRequired` + `requirePasswordChanged`).
4. **Sessions moved out of RAM into SQLite** — survive server restart, TTL enforced, logout deletes the row, read directly from DB (verified in tests).
5. **Deliberately NOT touched** — kitchen polling (no WebSocket exists), UI redesign, stack change, raw payments CRUD.

## 2. Changed files

| File | Change |
|---|---|
| `backend/src/stock.ts` (new) | Shared `getSettingBool`, `HttpError`, `stockDeductionPlan`, `applyStockDeduction`, `restoreStockAfterVoid` — used by `/checkout`, `/void` (index.ts) and the refund path (crud.ts) without circular imports. |
| `backend/src/index.ts` | `checkout` supports `payments:[{method,amount,paymentSyncId}]`: sum must equal order total (tolerance 0.01) else `409` via audit `checkout.rejected` **outside** the transaction; per-part idempotency (`alreadyProcessed` when all parts exist for the same order); `paymentMethod='split'`; one `payments` row per part; stock deduced once inside the txn; success audit `checkout` with parts detail; daily shift cash = sum of `cash` parts. SSRF guard + helpers (`assertSafeUpstreamHost`, `isPrivateIp`, `proxyAllowedHosts`, `redirect:'manual'`, `MAX_PROXY_BODY_BYTES`, `MAX_PROXY_TIMEOUT_MS`). |
| `backend/src/routes/crud.ts` | Removed `refunds` from `WRITE_ADMIN_STORES` (manager can now refund via `refunds.write`; cashier/device stay blocked → 403). POST refunds: cumulative `SUM(refunds.amount)` cap (double full refund → 409 + `auditReject`), and the refund insert + one-time `restoreStockAfterVoid` run inside one transaction. |
| `backend/src/auth.ts` | `sessions` table-backed `createSession/getSessionUser/destroySession` + expired-row sweep (still 12h default via `SESSION_TTL_MS`). No session stored in memory anymore. |
| `backend/src/db.ts` | `CREATE TABLE IF NOT EXISTS sessions (token PK, userId, username, role, createdAt, expiresAt)` + indexes (idempotent in `migrate()`). |
| `admin/database.js` | New `Orders.checkoutToServer(orderId, data)` — strict server-only checkout (no local close, no local fake payment, no pushAll): `null` on unreachable, throws on 409, mirrors server order + frees table on success. New `Orders.recordManualInvoice({amount, description, method})` — server-only manual invoice (crud POST open order → `/checkout`), deletes the open order on failure, mirrors server truth locally. |
| `index.html` | `confirmSplitPayment()` rewritten: builds stable per-part `paymentSyncId`, calls `Orders.checkoutToServer(currentOrderId,{payments})`; server rejection → modal stays open, order stays open; success → UI reset only (no local payment writes, no `pushAll`). Chat invoice flow (`فاتورة [مبلغ] ...`) now calls `Orders.recordManualInvoice` (no `Expenses.add('إيراد', 0)` hack, no local paid `Orders.add`). |
| `ai-pos-engine.js` | `toolCloseTable` + `toolProcessPayment` no longer write `Orders.update({...status:'paid', paymentStatus:'paid'})` or close locally — both go through `checkoutToServer`; on failure the order/table stay open with a clear error. `toolRecordInvoice` now calls `Orders.recordManualInvoice` (batman `record_invoice` gate preserved). |
| `backend/test/p1-followup.cjs` (new) | 66 acceptance checks (registered in `backend/package.json` chain). |
| `backend/package.json` | test chain now ends with `node test/p1-followup.cjs`. |

## 3. Guard map (vulnerability → guard)

| # | Vulnerability (before) | Guard (after) |
|---|---|---|
| P1-1 | Split payment `confirmSplitPayment()` marked the order closed/paid locally + pushed via `/api/sync` — server persistence severed by P0, phantom local "paid" state. | Client reworked to `checkoutToServer` with stable `paymentSyncId` per part (idempotent server-side). Server refuses any split whose parts don't sum to the total (409, order stays `pending/unpaid`, audited `checkout.rejected`). Stock deducted once, not per part. |
| P1-2 | ai-pos `toolProcessPayment`/`toolCloseTable` wrote `status:'paid'/paymentStatus:'paid'` (and a `completed+paid` dead fallback) — money recorded outside `/checkout`. | Both tools now call server `/checkout`; on network failure or rejection the order is left open and no payment/status is written locally (static-source tests assert the old paid-writes are gone). |
| P1-3 | Refunds were admin-only (manager locked out by `WRITE_ADMIN_STORES`), and nothing prevented refunding the same paid order twice in full, nor restored deducted stock. | Manager can refund (has `refunds.write`); cumulative cap `SUM(refunds)+amount ≤ netPaid` else 409 "استرداد مزدوج"; refund insert + `restoreStockAfterVoid` in one transaction so stock is returned exactly once; DELETE refunds still admin-only; cashier/device → 403. |
| P1-4 | `/api/proxy-llm` forwarded to any `base` (LAN/metadata/hostname) — SSRF. | Host allowlist (`api.openai.com`, `api.x.ai`, `localhost`, `127.0.0.1`, + hosts of `OPENAI_BASE_URL`/`OLLAMA_BASE_URL`); private/metadata IPs (169.254.169.254, 10/8, 172.16/12, 192.168/16, loopback, CGNAT, IPv6 mapped/link-local) rejected after `node:dns` lookup; `redirect:'manual'` (3xx → 502); `max_tokens`-style cargo body capped at 1 MB; timeout capped at 120 s; auth = batman-level. |
| P1-5 | Sessions lived in a process-local `Map` — every restart logged everyone out; nothing to inspect externally. | Sessions in SQLite (`sessions` table): row written at login, deleted at logout, expired rows swept & deleted on TTL; token valid across restart (verified with a real SIGKILL + respawn in tests). |
| P1-6 | `toolRecordInvoice` and the chat invoice flow created a local paid order (`status:'paid'`, `paymentStatus:'paid'`) + a zero-amount "إيراد" expense hack — server never knew about the sale, no payment row, no stock audit. | `Orders.recordManualInvoice` builds an open server order (crud POST), closes it via `/checkout` (payment + audit + daily shift in one shot); on failure the server-side open order is deleted to avoid phantom state; no local paid order is written; the zero-amount expense hack is removed. |

## 4. Test results

- `npm run build` (tsc) — PASS
- `npm test` — 159/159
  - guard-regression.cjs 16/16 · checkout-idempotency.cjs 9/9 · runtime-smoke.cjs 13/13 · p0-money-guards.cjs 55/55 (no P0 regression) · p1-followup.cjs 66/66
- p1-followup highlights: sessions row present in DB (direct better-sqlite3 read); token survives restart; logout deletes row; `SESSION_TTL_MS=1500` expiry → 401 + row removed; split cash+card = 30 → closed with `paymentMethod=split`, 2 payment rows, one stock movement; same split retried → `alreadyProcessed`, no duplicates; split 10/30 → 409 + order open + zero payments + `checkout.rejected` audit; device refund → 403; full refund → 201 + stock restored once; second full refund → 409 + stock untouched; SSRF: 169.254.169.254, 192.168.1.10, 10.0.0.5, 172.16.0.5, evil.example.com, ftp:// → 400; env-added private host → 400 (private-IP branch); unauthenticated → 401; static source checks confirm invoice flows use `recordManualInvoice` and no `status:'paid'`/`paymentStatus:'paid'` local writes; runtime: manual invoice order created (INV-number, takeaway) → closed via `/checkout` → payment row `card` + audit entry present.

## 5. Flagged (intentionally out of this pass)

- ai-pos split (`awaitingSplitDetails` flag) was already an incomplete stub (flag set with no consumer) — untouched; manual split goes through the reworked `confirmSplitPayment`.

## 6. NOT touched (deliberately)

- Kitchen: no WebSocket exists; kitchen polls via 10s `setInterval` — untouched.
- UI redesign / framework changes / CRUD expansion — none.
- Raw payments CRUD stays disabled (payments only via server `/checkout`).
- `batman` decision-gate — untouched.
- No new migration: `sessions` table is `CREATE TABLE IF NOT EXISTS` inside `db.ts migrate()` alongside existing tables.