# P0 Closure Report — Financial Bypass Locks (Lucca Caffè POS)

Status: IMPLEMENTED · Tests: build ✓ · 93/93 acceptance checks ✓
Scope: server-side only, minimal-diff. No stack rewrite, no CRUD expansion, no framework change.

## 1. Changed files

| File | Change |
|---|---|
| `backend/src/routes/crud.ts` | Guard blocks for orders/payments/refunds CRUD (409 + audit) |
| `backend/src/index.ts` | Sync guard (non-admin terminal orders), server-side stock deduction inside checkout, void stock restore, `HttpError` |
| `backend/src/auth.ts:130-136` | `ADMIN_ONLY_STORES` += `payments, refunds, inventory, stock_movements, cash_registers` |
| `backend/src/db.ts:164` | New `beginImmediateTransaction()` (IMMEDIATE write lock) |
| `backend/migrations/005_stock_movements_orderid.sql` | Adds `stock_movements.orderId` column + index |
| `admin/database.js:1359-1360` | Client `Inventory.deductForCheckout(...)` disabled to avoid double deduction |
| `backend/test/p0-money-guards.cjs` | New acceptance test (registered in `backend/package.json` test chain) |

## 2. Vulnerability → Guard map

| # | Vulnerability (before) | Guard (after) |
|---|---|---|
| P0-1 | `PUT /api/orders/:id` could set any money field / close+pay / mark `paid=true`. (crud.ts PUT handler, old `res.status(200)` path) | `crud.ts:406-431` — reject terminal status/paymentStatus, money-field mutation, or total ≠ `subtotal − discountAmount + tax` (tolerance 0.01) with `409` + `auditReject` (action `orders.rejected`). Operational edits (notes, customer field) still allowed. |
| P0-2 | Devices could push `status:'closed/paymentStatus:'paid'` via `POST /api/sync`. (index.ts `// 2) دمج` merge loop) | `index.ts:779-832` — for non-adminish identities: terminal/paid incoming orders → conflict; any change to a server-side terminal order → conflict; total not matching `expectedTotalFrom` → conflict; payments store admin-only (skipped). Whitelist intact: working orders still merge. |
| P0-3 | Payments were raw CRUD stores: `POST/PUT/DELETE /api/payments` free (record any money, even from device). | `auth.ts` ADMIN_ONLY for payments/refunds/inventory/stock_movements/cash_registers + `crud.ts:277` (POST payments 409), `:387` (PUT payments 409), `:491` (DELETE payments 409). Payments now only via `/checkout` → server-created row. |
| P0-4 | Client-side `Inventory.deductForCheckout` decremented from IDB only — server DB stock never moved on sales. | `index.ts:62-124` (`stockDeductionPlan` via `product_recipes`; fallback 1:1 by item name) + `:454` `beginImmediateTransaction()` + `:508` `applyStockDeduction` inside checkout + `:117-121` `HttpError(409)` on shortfall unless setting `allowNegativeStock`. No inventory row for an item → sale proceeds (nothing to check), only an informational movement row. |
| P0-5 | Refunds were raw CRUD POST/DELETE — no reason, any amount, any order, any actor. | `crud.ts:286-307` — require reason, positive amount, existing + paid order, amount ≤ net paid → else 409 + `auditReject`; `crud.ts:497-500` — DELETE refunds admin-only (403) + audit. |
| P0-6 | `void` restored nothing; double-checkout with another `paymentSyncId` could double-write. | Checkout idempotency via `paymentSyncId` alreadyProcessed (existing, preserved at `:445`) + `beginImmediateTransaction()` + count-based `stock_movements` idempotency (one `type='sale'` per order). Void uses `beginImmediateTransaction()` + `:601 restoreStockAfterVoid` (one `type='return'`, `notes` encodes order+name). |

Every 409/403 branch logs to `audit_logs` via `recordAuditLog`/`auditReject` (`crud.ts:129-172`).

## 3. Test results

- `npm run build` (tsc) — PASS
- `npm test` — 93/93
  - guard-regression.cjs 16/16 (C2 auth lockdown intact)
  - checkout-idempotency.cjs 9/9 (paymentSyncId dedupe intact)
  - runtime-smoke.cjs 13/13 (happy path checkout works)
  - p0-money-guards.cjs 55/55 (all 8 acceptance cases + positives + audits)
- Verified: PUT-to-close → 409 + order untouched + no payments; refund abuse → 409; shortfall → 409 and order/money/stock untouched → then `allowNegativeStock=true` allows it; closed/paid order PUT/DELETE → 409; device sync of terminal order → conflict/skipped, working order still merges; recipe stock 50→48 on sale, back to 50 on void (single return movement, single sale movement); second checkout same paymentSyncId → one payment row only.

## 4. Intentionally broken behaviors (compatibility with locked server)

The current checkout flow (payment + `paymentSyncId`) is preserved and is now the ONLY way to collect money.

- `index.html:5175-5256` — `confirmSplitPayment()`: marks order closed/paid locally then `ServerSync.pushAll()` relies on `/api/sync`. Server-side persistence for that push is now severed (terminal order conflicts, payments skipped) → the local "paid" record will not survive server reconciliation. Needs a real client rework against `/checkout` — OUT OF SCOPE here, flagged as broken-on-purpose.
- `ai-pos-engine.js:1044` — `Orders.update(...{status:'completed', paymentStatus:'paid'})` fallback (already a dead call, `Orders.update` doesn't exist) would now 409 anyway via Fix 1 — reported as intentionally broken.
- Devices closing/voiding orders via `PUT /api/orders` or merging closing rows via sync — disabled (server-terminal state only reached through `/checkout` pre-verify and `/void`).
- Raw payments CRUD for clients/extensions — disabled; payments created only by the verified checkout path.
- Refund deletion — admin-only now (other roles 403).
- Selling a product whose recipe fallback matches an inventory row below the needed qty — blocked (409) unless `allowNegativeStock` set; this turns on stock enforcement in the cash-wrap.

## 5. NOT touched (deliberately)

- `proxy-llm` (index.ts:214-293) — untouched.
- Memory in-memory sessions (`auth.ts:17-18`) — untouched.
- Websocket — none; kitchen polls via 10s `setInterval` — untouched.
- `batman` decision-gate — untouched (runtime-smoke `POST /api/batman/check → executed` still passes).
- No CRUD expansion / no new front-end framework; only one new migration (`005`) and one new server-only setting (`allowNegativeStock`, default off).