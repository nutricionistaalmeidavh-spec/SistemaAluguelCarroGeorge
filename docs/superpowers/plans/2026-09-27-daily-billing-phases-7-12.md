# Daily Billing Phases 7-12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete phases 7-12 of daily rental billing: continuous rentals, controlled closure, daily delinquency, payment receipts, safe PC↔mobile concurrency, and release QA.

**Architecture:** Keep `billingPlans`/`billingInstallments` as the source of truth for daily charges and keep the parent rental receivable as an aggregate only. Continuous rentals grow idempotently by elapsed rental days, without a server cron. Sync gets a specialized merge/reconciliation path for nested installment payments so offline devices cannot double-count the same daily charge.

**Tech Stack:** JavaScript ES modules, Node test runner, Electron, SQLite/local repository, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-27-daily-billing-phases-0-4-design.md` plus the approved roadmap in this project conversation.

## Global Constraints

- Core remains local/offline/self-hosted and free; no paid service may become mandatory.
- Preserve the PR #2 rental/inspection state machine.
- Daily schedule payments are the accounting authority; never double-count the parent receivable.
- Every phase gets a focused automated flow test before the implementation is accepted.
- Final gate: unit/domain tests, coverage, Electron E2E, ArtiSys QA release, Linux verify and Windows packaged-app workflow.

## Review Focus

- Continuous rental before 24h elapsed must not generate a second daily charge.
- Repeated accrual at the same timestamp must be idempotent.
- Continuous closure must not bypass the completed return inspection requirement.
- PC/mobile concurrent partial payments that fit the daily amount must merge; concurrent overpayment must become an explicit conflict and must not inflate received cash.
- Backup/restore must preserve continuous schedule, installment payments, conflicts, totals and status.

---

### Task 1: Phase 7 — Continuous daily rental

**Files:** `src/domain/rental.mjs`, `src/domain/daily-billing.mjs`, `src/app.mjs`, `src/ui/reservas.mjs`, `tests/daily-billing-phases-7-12.test.mjs`

**Interfaces:**
- `createRentalWithBilling(input, draft, actorId)` accepts `periodMode:'continuous'` with no `returnAt` and requires daily billing.
- `ensureDailyInstallmentsUntil(input, rentalId, asOf, actorId)` grows a continuous schedule by elapsed rental days and updates rental/parent receivable totals.
- `ensureOpenDailyRentals(input, asOf, actorId)` accrues every open continuous daily rental idempotently.

- [ ] Write failing flow tests for one initial daily charge, no second charge at 23h59m, second charge after 24h, and idempotent repeated accrual.
- [ ] Run focused tests and confirm RED.
- [ ] Implement the domain behavior and app/UI integration.
- [ ] Run focused tests and full suite.
- [ ] Commit.

### Task 2: Phase 8 — Close a continuous rental

**Files:** `src/domain/rental.mjs`, `src/domain/daily-billing.mjs`, `src/ui/reservas.mjs`, `tests/daily-billing-phases-7-12.test.mjs`

**Interfaces:**
- `closeContinuousDailyRental(input, rentalId, {returnAt}, actorId)` accrues the exact final number of days, marks generation closed, then uses the existing rental state machine to finish the return.

- [ ] Write failing tests that closure requires the return inspection, closes generation, releases the vehicle, and leaves unpaid debt open.
- [ ] Run focused tests and confirm RED.
- [ ] Implement minimal close flow and block direct `devolucao` while a continuous schedule is still open.
- [ ] Run focused tests and full suite.
- [ ] Commit.

### Task 3: Phase 9 — Daily delinquency

**Files:** `src/domain/commercial-finance.mjs`, `src/ui/financeiro.mjs`, `tests/daily-billing-phases-7-12.test.mjs`

**Interfaces:**
- `dailyDelinquencySummary(snapshot, asOf)` returns overdue daily count/value and rows enriched by rental/customer/vehicle IDs and daily sequence/date.

- [ ] Write failing test for overdue daily charges versus due-today/future charges.
- [ ] Run focused test and confirm RED.
- [ ] Implement summary and daily overdue table in Financeiro.
- [ ] Run focused tests and full suite.
- [ ] Commit.

### Task 4: Phase 10 — Receipt/PDF per daily payment

**Files:** `src/domain/documents.mjs`, `src/ui/reservas.mjs`, `tests/daily-billing-phases-7-12.test.mjs`

**Interfaces:**
- `dailyPaymentReceiptPdf(input, installmentId, paymentId)` generates a PDF with customer, vehicle/plate, rental ID, daily date/sequence, amount received, method and timestamp.

- [ ] Write failing PDF test and confirm RED.
- [ ] Implement document function and per-payment receipt buttons in daily control.
- [ ] Run focused tests and full suite.
- [ ] Commit.

### Task 5: Phase 11 — PC↔mobile payment concurrency

**Files:** `src/domain/sync.mjs`, `src/domain/daily-billing.mjs`, `tests/daily-billing-phases-7-12.test.mjs`

**Interfaces:**
- `mergeSnapshots` merges nested installment payments by global payment ID, reconciles rental history/ledger, preserves legitimate partial payments, and records excess concurrent payments in `installment.paymentConflicts` instead of counting them.

- [ ] Write failing tests for different-installment concurrent payments, 60+40 same-installment merge, and 100+100 same-installment conflict without double receipt.
- [ ] Run focused tests and confirm RED.
- [ ] Implement specialized billing-installment merge and schedule reconciliation.
- [ ] Run focused tests and full suite.
- [ ] Commit.

### Task 6: Phase 12 — Release QA

**Files:** `tests/daily-billing-release.test.mjs`, `qa/e2e/daily-billing.test.cjs`, PR metadata.

**Interfaces:** release gate only.

- [ ] Add release scenarios: 10×R$80 = R$800 and all paid; R$30+R$50 partial-to-paid; 5×R$100 never becomes R$1,000; backup/restore preserves daily state; concurrency conflict remains non-double-counted.
- [ ] Extend Electron E2E for continuous rental creation/accrual and multiple payment path where stable.
- [ ] Run `npm run verify`, `npm run coverage`, `npm run e2e`, `npm run qa:release` through CI.
- [ ] Require both Locadora Verify and Locadora Windows Build to be green.
- [ ] Update PR title/body to phases 0-12 and leave ready for merge.