# Lucca POS — UI Rebuild Plan (Phase A Audit)

> Phase A only. Audit + plan. No code changes. Awaiting approval for Phase B.

- Project: Lucca POS (lucca-caffe-pos, v1.3.5)
- Workspace: C:\Users\Acer\OneDrive\Desktop\Lucca_menu-
- Branch: main (diverged; local 15 ahead, origin 8 ahead)
- Pre-existing unstaged changes (preserve): index.html, supabase-db.js
- Created: 2026-10-27

## 1. Executive Summary

POS UI is a single monolithic index.html (~7,469 lines, ~466 KB) with two inline script blocks (main logic ~5,120 lines, AI assistant ~1,660 lines). It loads ~20 external scripts (DB, Supabase, knowledge, Ollama, OCR, invoice scanner, AI engine, Batman, forecasting, report export, sync engine, menu data). Styling: styles.css (~1,700 lines) + small inline style.

App is Electron 42, contextIsolation true, nodeIntegration false, secure preload.js exposing window.electronAPI (session, apiRequest, update flow, kitchen/admin windows). Data access via window.LuccaDB and electronAPI.apiRequest. No secrets in renderer.

Rebuild principle: rebuild UI only. Keep DB, Supabase, backend, auth/permissions, order/payment/refund logic, pricing, inventory, shifts/cash, reports/audit, Batman/Ollama, printing/export. No parallel persistence.

---

## 2. Git & Environment Audit

### 2.1 Git status (audit time)
- Branch: main
- Divergence: local 15 commits ahead, origin 8 ahead. No force-push/reset.
- Unstaged changes (preserve):
  - index.html (+21/-13): checkout hardening (null closedOrder guard; order retrieval guard).
  - supabase-db.js (+8/-2).

### 2.2 Run commands
- npm start -> electron . (Electron 42.3)
- npm run build:installer -> electron-builder --win (nsis)
- Backend: cd backend && npm run build (tsc -> dist); node dist/index.js (port 3000)
- Tests: node scripts/test-*.cjs, node c2-tests/*.cjs, node c2-tests/run-tests.js

### 2.3 Entry points
- Electron main: main.js -> BrowserWindow loading index.html; IPC admin/kitchen, session, updates, clipboard.
- Renderer: index.html (POS), admin/index.html, admin/control-center.html, admin/dashboard.html, kitchen.html, public-menu/*.
- Preload: preload.js (secure bridge).

---

## 3. Current POS Screens (index.html)

### 3.1 Top-level views
1. #tablesMainView — full-screen tables grid (default landing). Header clock, kitchen button, table settings, admin dashboard, admin panel. Status bar, zone tabs, search, table cards.
2. #orderModeView — order entry (hidden by default). Header logo + back-to-tables. Quick nav categories, search. Order panel (payment method select, free table, cash drawer, reports, analytics, kitchen, tables, admin). Legacy inline table grid, customer panel, menu content, order summary/items.

### 3.2 Modals / overlays (by id)
- #itemModal — product detail/options.
- #customItemModal — custom item entry.
- #invoiceModal + #invoiceContent + #invoiceExportContainer + #invoiceExportContent — invoice display/export/share.
- #paymentSelectModal + #paymentSelectTotal + #paymentSelectButtons — payment selection.
- #splitBillModal + #splitBillContent + #splitPaymentsList + #splitCustomCount — split bill.
- #voidOrderModal + #voidOrderInfo + #voidReason + #voidReasonNote — void/refund.
- #orderSearchModal + #orderSearchInput + #orderSearchDate + #orderSearchStatus + #orderSearchResults — order search.
- #dailyReportModal + #dailyReportContent.
- #analyticsModal + #analyticsRevenue + #analyticsTopItems + #analyticsChart.
- #kitchenModal + #kitchenOrdersList + #kitchenRefreshInfo + #kitchenPrintBtn.
- #tableSettingsModal + #settingsTableList + #newTableNumber/Capacity/Zone.
- #adminLoginModal + #adminLoginUser/Pass/Error/Btn.
- #adminPanelModal + #adminTabCats/Prods/Pay panels.
- #serverSettingsModal + #serverUrlInput + #serverStatusMsg.
- #mustChangeModal + #mcCurrentPass/NewPass/NewPass2/Error/SaveBtn.
- #aiChatWindow + #aiChatHeader + #aiMessages + #aiInput + #aiQuickActions + #aiBotFab + #aiBotBadge.

### 3.3 Key UI regions
- Tables: #tablesMainGrid, #tablesMainZones, #tablesMainStatus, #tablesMainClock.
- Legacy tables: #tablesGrid, #gridCards, #zoneTabs, #statusBar, #tableSearchInput.
- Menu: #quickNavLinks, #searchInput, #menuContent, #noResultsMessage.
- Order: #orderItems, #orderSummary, #orderTotal, #orderCountBadge, #orderStatus, #orderStatusWorkflow, #statusBtnPending/Preparing/Ready/Served.
- Customer: #customerSelect, #customerNameInput, #customerPhoneInput, #customerNotesInput, #saveCustomerBtn.
- Payment: #paymentMethod, #quickPayButtons, #requestBillBtn, #requestCheckBtn, #voidOrderBtn, #clearOrderBtn, #freeTableBtn, #cashDrawerBtn/Badge, #dailyReportBtn, #analyticsBtn, #kitchenViewBtn, #tableSettingsBtn, #adminPanelBtn.
- Orders tracker: #ordersTrackerList.
- POS admin inline: #posCatList/NameAr/NameEn/Icon, #posProdList/Search/Name/Price/Cost/Category, #posPayList/Name/Type.
- Settings: #cafeNameInput/Phone/Address, #currencyInput, #taxRateInput, #printerWidthSelect, #printerConnectBtn, #serialConnectBtn, #deviceKeyInput/Msg, #openingCashInput, #closingCashInput, #financeStatusMsg, #cafeStatusMsg, #deviceKeyMsg.
- Sync: #syncStatusIcon/Text/Queue, #syncQueueCount.
- Update: #updateBadge, #luccaRunningVersion.
- Toast: #toast, #saveIndicator.

---

## 4. Function to UI Map (index.html)

### 4.1 Core order flow
- addToOrder, addToOrderWithOrigin — product card click -> add to current order.
- changeOrderQuantity, removeOrderItem — cart edits.
- renderOrderSummary — renders #orderItems/#orderSummary/#orderTotal.
- clearOrder — empties cart.
- enterOrderForTable, enterTakeawayOrder, enterDeliveryOrder — open order mode.
- selectTable, onTableChange — table selection.
- loadTableOrder — restore order when reopening table.
- autoSave (_autoSaveCore) — persists draft order.
- buildOrderPayload, buildDeliveryBox, buildTakeawayBox — payload construction.
- collectCustomerForm — customer form values.
- saveCustomerManually, loadCustomerSelect, onCustomerSelect, callCustomer.

### 4.2 Tables
- loadTables, loadTablesMainView, renderMainTableCards, buildTableCardHTML, buildTableHTML.
- renderZoneTabs, buildZoneSection, filterZone, filterMainTables, onTableSearch.
- updateTableStatus, quickAction, freeSelectedTable.
- addNewTable, removeTable, renderSettingsTableList.
- openTableSettings, closeTableSettings.
- _startTablesMainAutoRefresh.

### 4.3 Payment / checkout / void
- openPaymentSelectModal, quickPay, selectPaymentAndClose, confirmSplitPayment.
- requestBill, requestCheck.
- openVoidOrderModal, confirmVoidOrder, voidOrderFromSearch.
- reopenOrder.
- advanceOrderStatus, advanceTrackedOrder, setOrderStatus, updateStatusWorkflowUI.
- splitBill, openSplitBillModal, addSplitPaymentRow.

### 4.4 Invoice / printing / export
- openInvoiceModal, generateInvoiceHTML.
- thermalPrintInvoice, thermalPrintPreview, printInvoiceContent.
- exportInvoiceAsImage, exportInvoiceAsPDF, copyInvoiceSummary.
- shareInvoiceImageWhatsApp, generateWhatsAppMessage.
- exportOrderData, exportReportCSV.

### 4.5 Search / orders tracker
- openOrderSearchModal, performOrderSearch, viewOrderDetail.
- initOrdersTracker, refreshOrdersTracker, makeTrackerChip, filterTodayOrders.

### 4.6 Menu generation
- refreshMenuFromDB, generateMenu, generateMenuItem, generateQuickNav, scrollToCategory, scrollToTop, toggleCategory, attachMenuEvents, attachOrderButtons.

### 4.7 Admin inline (POS admin modal)
- Categories: posLoadCategories, posAddCategory, posToggleCategory, posDeleteCategory.
- Products: posLoadProducts, posAddProduct, posToggleProduct, posDeleteProduct.
- Payment methods: posLoadPaymentMethods, posAddPaymentMethod, posTogglePayMethod, posDeletePayMethod.
- switchAdminTab, openAdminPanel, closeAdminPanel, doAdminLogin, closeAdminLogin, openAdminDashboard, openExternalUrl.

### 4.8 Settings
- loadSettingsIntoModal, saveCafeInfo, getCafeInfo, saveFinanceSettings, getCurrency, saveDeviceKey, getDeviceKeyFromServer, testServerConnection, saveServerUrl, showServerSettings, openMustChangeModal, submitMustChange, applyVoidPermission, canVoidRefund.

### 4.9 Cash drawer / reports / analytics
- toggleCashDrawer, checkCashDrawerStatus, confirmOpenDrawer, confirmCloseDrawer.
- showDailyReport, filterReportByDate.
- showAnalytics, showReportModal.
- computeNetSales.

### 4.10 Kitchen
- showKitchenView, renderKitchenOrders, completeKitchenOrder, kitchenPrint, openKitchenDisplay, updateKitchenBadge.

### 4.11 AI assistant (Batman) block
- buildLiveContext, processAiCommand, sendAiMsg, aiBotReply, aiAddMsg, aiShowTyping, aiHideTyping, toggleAiChat, setBotState, matchAny, dayKeyOf, formatMoney.

### 4.12 Custom items
- openCustomItemModal, addCustomItem.

### 4.13 Utilities
- _debounce, _enqueueOrderSync, _logSaveError, _localQueuePendingCount.
- showToast, showSaveIndicator, showSaveErrorToast, updateSyncUI, setIntegrationBadge.
- initSyncEngine, initAutoUpdate, checkAppUpdate, setVersionLabel.
- playNotificationSound, normalizePhoneNumber, getSelectedOrigin, showOriginPicker.
- ensureLib, tryRecoverOrderId, openModal, closeModal.
- fallbackTables.

Total global functions identified in index.html inline scripts: ~183.

---

## 5. Data & Integration Layer (must remain untouched)

- window.LuccaDB (admin/database.js): Tables, Orders, Customers, Products, Categories, PaymentMethods, Settings, Users, Expenses, etc. Local IndexedDB + backend sync.
- window.electronAPI (preload): session, apiRequest, update flow, openAdmin/Kitchen, clipboard.
- window.supabase client (supabase-db.js).
- menuData (menu-data.js) — product catalog seed.
- sync-engine.js — queue/retry.
- ai-pos-engine.js, batman-dashboard.js, forecasting.js, report-export.js, ollama-adapter.js, ocr-adapter.js, invoice-scanner.js.

All financial calculations must continue to use existing calcOrderTotals, orderTotalsForDisplay, buildOrderPayload, and backend checkout (LuccaDB.Orders.checkout). UI must not recompute totals independently in a conflicting way.

---

## 6. CSS / Design Tokens (existing)

styles.css already defines a coherent token set (colors, gradients, shadows, radii, font Tajawal, transitions). Rebuild should reuse and extend these tokens, not replace them. Gaps for Phase B: RTL/LTR direction switching, responsive breakpoints, consistent component classes (button variants, inputs, cards, modals, toast, empty/error/loading states).

No new framework will be added; plain HTML/CSS/JS matches existing architecture.

---

## 7. Proposed New Component Set (Phase B+)

Reusable components as CSS classes + small JS render helpers (not a framework):

- Buttons: .btn, .btn-primary, .btn-ghost, .btn-danger, .btn-sm, .btn-icon, loading state.
- Inputs: .input, .select, .textarea, .field-group, .field-label, focus/error states.
- Cards: .card, .product-card, .table-card, .kpi-card.
- Tabs: .tabs, .tab, .tab-panel.
- Modals: .modal-bg, .modal, .modal-header/body/footer, .modal-close.
- Toast: .toast, .toast-success/warning/error/info.
- States: .loading, .empty-state, .error-state, .skeleton.
- Badges: .badge, .status-dot.
- Grid: .grid, .grid-cards, .product-grid.
- Order summary: .order-summary, .order-item, .order-total.
- Navigation: .app-nav, .nav-item.

Icon library: existing project uses emoji/Unicode glyphs in many places. Requirement: no Unicode substitutes for professional icons. Recommend adding a lightweight icon set compatible: Lucide (or Feather). To avoid unapproved dependencies, Phase B will first check vendor/ and existing assets; if none, propose Lucide via CDN/local vendor and get approval. (Currently only vendor/xlsx.full.min.js exists.)

---

## 8. Proposed Screen Architecture (incremental)

Keep index.html as the shell initially. Introduce organized folders only if dependency analysis confirms safety (Phase B decision gate):

- src/ui/styles/ — design tokens + components (can start as styles-v2.css).
- src/ui/components/ — JS render helpers.
- src/ui/screens/ — screen modules (tables, order, payment, etc.).

Do not split index.html automatically. First validate that all global function names referenced by inline onclick= attributes are preserved (183 functions identified). Any split must keep global names or update all call sites.

---

## 9. Risks

1. Monolithic coupling: 183 global functions referenced by inline handlers; renaming breaks UI silently.
2. Duplicate events: attachMenuEvents, attachOrderButtons, initOrdersTracker may be called multiple times; rebuild must ensure single registration.
3. Financial correctness: totals must use orderTotalsForDisplay and backend checkout; UI must not invent calculations. Tax permanently disabled (total = subtotal - discount).
4. Table state integrity: do not free table before checkout completes; no duplicate tables; no lost order on navigation.
5. Event duplication on navigation: switching tables/views must not re-register listeners or double-submit payments.
6. Payment double-click: disable button + await confirmation before showing success.
7. RTL/LTR: current dir="rtl"; need bidirectional support.
8. Icon dependency: choose lightweight library; avoid heavy frameworks.
9. Existing user changes: preserve modified index.html and supabase-db.js.
10. No new DB: must use existing LuccaDB and backend; no parallel persistence.
11. Permissions: respect existing role checks (window.__luccaRole, canVoidRefund, admin login). Permission verification stays where currently is.
12. Batman/Ollama integration: buildLiveContext reads orders; keep contract.

---

## 10. Phased Execution Plan (with gates)

- Phase A (this doc) — audit + plan. Complete pending review.
- Phase B — Design foundation: CSS variables (extend existing), fonts, buttons/inputs/cards, layout/nav, RTL/LTR. Gate: no visual regressions on tables view; all 183 functions still resolve.
- Phase C — Sales screen: search/categories, product grid, cart, status/error messages.
- Phase D — Tables & orders: tables grid, order detail, navigation, duplicate/state guards.
- Phase E — Payment & tests: cash/card/mixed, cancel/refund, data integrity.
- Phase F — Remaining screens: orders history, products/categories, customers, inventory, purchases/suppliers, expenses, shifts/cash, reports, users/permissions, Batman, settings.

Gate rule: do not start a phase if previous phase tests fail.

---

## 11. Test Plan (reference)

Existing tests to reuse:
- scripts/test-admin-analytics.cjs, test-admin-api.cjs, test-admin-login-matrix.cjs, test-employee-invite.cjs, test-ollama-runtime.cjs, test-shifts.cjs, test-supabase-adapter.cjs.
- c2-tests/accounting-tools.cjs, knowledge-unit.cjs, live-parity.cjs, rpc-v1-checkout-model.cjs, run-tests.js, safe-sync-engine.js, server-smoke.cjs.
- tests/batman-questions.test.js.

Manual verification checklist (must run on a separate test DB, never production):
1. App boots (npm start), all screens load, no new JS console errors.
2. Add/remove/change quantity of product; cart persists on navigation.
3. Save order and reopen; values match.
4. Cash, card, mixed payment; cancel; refund.
5. Close order frees table; no duplicate orders.
6. Inventory/stock updates on sale.
7. Permissions: cashier cannot void without permission; admin login works.
8. No duplicate event registration (payment not double-charged).
9. Arabic + RTL rendering; LTR toggle if supported.
10. Responsive on actual POS screen sizes (min 1024x700).

No test may be claimed passed unless actually run.

---

## 12. Files Likely to Change (future phases, not now)

- index.html (UI shell + inline logic) — incremental.
- styles.css (tokens + components) — extend.
- New: src/ui/styles/*, src/ui/components/*, src/ui/screens/* (only after dependency validation).
- kitchen.html, admin/* — later phases.
- Docs: this file + per-phase reports.

Not to change: main.js, preload.js, admin/database.js, supabase-db.js (except user's in-progress edits), backend, DB schema, version number.

---

## 13. Open Decisions (need approval before Phase B)

1. Icon library choice (Lucide vs Feather vs existing emoji) — recommend Lucide added to vendor/.
2. Whether to create src/ui/ folders now or keep single CSS file until Phase C.
3. Whether to add a minimal JS component helper module or stay purely CSS-driven.
4. Test DB path for financial verification.

---

## 14. Phase A Completion Statement

Phase A deliverable (docs/POS_UI_REBUILD_PLAN.md) is complete. No source files were modified in this phase. Awaiting approval to proceed to Phase B.

