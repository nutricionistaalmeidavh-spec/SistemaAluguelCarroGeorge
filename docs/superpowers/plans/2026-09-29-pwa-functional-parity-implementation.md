# PWA Functional Parity — Implementation Plan

> **Execution:** implement task-by-task with TDD on `feat/pwa-functional-parity`. Keep `main` untouched until the complete Linux/Windows/Cloudflare/DR/E2E gate set is green.

**Goal:** make the Web/PWA operationally equivalent to the desktop for the 12 approved daily-operation modules while preserving D1/R2 as canonical state, explicit RBAC, durable offline outbox, explicit conflict handling, and desktop replica convergence.

**Design:** `docs/superpowers/specs/2026-09-29-pwa-functional-parity-design.md`

## Global constraints

- No merge or production deploy while this plan is executing.
- No new paid runtime dependency.
- Customer/vehicle CRUD stays versioned with optimistic concurrency.
- Money, rental lifecycle, maintenance lifecycle, contracts, inspection completion and alert state use explicit Worker commands; no generic last-write-wins fallback.
- Every mutating command is authenticated and permission checked in the Worker.
- Idempotent business mutations reuse the same operation ID across retries.
- All canonical mutations emit sync changes so PWA caches and the desktop SQLite replica converge.
- D1 remains authoritative for structured data; R2 remains authoritative for cloud files.
- A 401 clears the stale cloud session. A 409 preserves local intent for explicit resolution.
- Existing desktop, DR, backup, Windows installer, Cloudflare and offline tests remain regression gates.

---

## Task 1 — Cloud PWA foundation, resources and Dashboard parity

**Files**
- Create: `src/cloud/ui/common.mjs`
- Create: `src/cloud/ui/overview.mjs`
- Modify: `src/cloud-app.mjs`
- Modify: `cloudflare/api/resource-map.mjs`
- Modify: `src/sync/cloud-sync.mjs`
- Test: `tests/pwa-parity-foundation.test.mjs`

**Interfaces**
- Export a permission-aware PWA navigation descriptor for all 12 modules.
- Add read resources needed by parity: `ledger`, `rentalPayments`, `billingPlans`, `billingInstallments`, `collectionActions`, `contractTemplates`, `issuedContracts`, `inspectionItems`, `alertState`, plus existing resources.
- Add sync entity→cache mappings for newly surfaced cloud entities.
- Build a cloud snapshot adapter consumed by pure desktop domain calculations such as `buildDashboard`.

**TDD**
- [ ] RED: navigation contains exactly the approved 12 modules and filters actions by permission.
- [ ] RED: cloud snapshot adapter produces the arrays/objects expected by `buildDashboard`.
- [ ] RED: resource map exposes parity reads while still rejecting arbitrary tables and disallowing unsafe generic writes.
- [ ] GREEN: implement shared UI helpers, resource loading and mobile Dashboard KPI cards/per-vehicle performance.
- [ ] Verify targeted tests, then existing cloud tests.

## Task 2 — Complete Customers and Fleet CRUD

**Files**
- Create: `src/cloud/ui/customers.mjs`
- Create: `src/cloud/ui/vehicles.mjs`
- Modify: `src/cloud-app.mjs`
- Modify: `src/sync/outbox-runner.mjs` only if needed for exact command shape
- Test: `tests/pwa-parity-entities.test.mjs`
- E2E: `qa/e2e/cloud-mobile.test.cjs`

**Capabilities**
- Customers: name, document, phone, email, address, active, CNH number/category/expiry; create/edit/deactivate/delete with expectedVersion.
- Fleet: model, plate, year, mileage, category, color, daily rate, purchase price, availability and vehicle document metadata; create/edit/delete with expectedVersion.

**TDD**
- [ ] RED: serialize/deserialize `driverLicenseJson` and `documentsJson` without losing existing fields.
- [ ] RED: stale edit produces explicit conflict and never overwrites server version.
- [ ] RED: PWA forms expose all parity fields and edit/delete actions according to RBAC.
- [ ] GREEN: implement mobile-first cards/forms using existing customer/vehicle sync mutations.
- [ ] Verify mobile and desktop-web viewport entity CRUD.

## Task 3 — Rental lifecycle parity

**Files**
- Modify: `cloudflare/domain/rentals.mjs`
- Modify: `cloudflare/api/rental-routes.mjs`
- Modify: `cloudflare/api/replica-routes.mjs`
- Modify: `src/api/client.mjs`
- Modify: `src/sync/outbox-runner.mjs`
- Create: `src/cloud/ui/rentals.mjs`
- Test: `tests/cloud-rental-lifecycle.test.mjs`
- Test: `tests/cloud-outbox.test.mjs`
- E2E: `qa/e2e/cloud-mobile.test.cjs`

**Commands**
- `rental.create`
- `rental.advance`
- `rental.closeContinuous`
- `rental.payment`

**Rules**
- Same transitions as desktop: `reserva → retirada → em_uso → devolucao`.
- Starting use requires completed pickup/checkout inspection.
- Return requires completed return inspection.
- Continuous rental must be closed before final return.
- State transition updates dependent vehicle state atomically and emits audit/change-log records.

**TDD**
- [ ] RED: routes require auth, permission and idempotency key.
- [ ] RED: replay returns same logical result with one D1 mutation/change record.
- [ ] RED: invalid transition/inspection/continuous-close constraints return 409 and preserve current state.
- [ ] GREEN: implement Worker domain commands, API client/outbox dispatch and rental cards/actions.
- [ ] Verify desktop replica table snapshots contain every dependent table changed by commands.

## Task 4 — Full mobile inspection workflow and documents

**Files**
- Modify: `cloudflare/domain/inspections.mjs`
- Modify: `cloudflare/api/inspection-routes.mjs`
- Modify: `src/api/client.mjs`
- Modify: `src/sync/outbox-runner.mjs`
- Create: `src/cloud/ui/inspections.mjs`
- Create/Modify: `src/cloud/ui/documents.mjs`
- Test: `tests/cloud-inspection-parity.test.mjs`
- E2E: `qa/e2e/cloud-mobile.test.cjs`

**Capabilities**
- pickup/return inspection, full checklist, mileage, fuel, damages, notes, multiple photos, history and inspection PDF.
- Preserve authenticated R2 upload flow and SHA-256 verification.
- If server schema cannot safely persist draft checklist mutations without a migration, drafts remain device-local until completion; completion is canonical and idempotent.

**TDD**
- [ ] RED: multiple attachment uploads remain tied to one inspection and survive retry without duplicate cloud metadata.
- [ ] RED: completion with duplicate checklist keys/invalid rental state is rejected.
- [ ] RED: generated document action uses canonical inspection data.
- [ ] GREEN: implement checklist UI, multiple-photo queue and document/open/share action.

## Task 5 — Finance + expenses parity

**Files**
- Create: `cloudflare/domain/finance.mjs`
- Create: `cloudflare/api/finance-routes.mjs`
- Modify: `cloudflare/worker.mjs`
- Modify: `cloudflare/api/replica-routes.mjs`
- Modify: `src/api/client.mjs`
- Modify: `src/sync/outbox-runner.mjs`
- Create: `src/cloud/ui/finance.mjs`
- Test: `tests/cloud-finance-routes.test.mjs`

**Commands**
- `expense.create`
- `expense.update`
- `expense.delete`

**Capabilities**
- planned revenue, received, outstanding, net cash, receivables, rental payments, installment payments, expense list and version-safe expense mutation.

**TDD**
- [ ] RED: expense creation atomically creates/updates matching ledger entry.
- [ ] RED: edit/delete requires current version and produces 409 on stale write.
- [ ] RED: retry does not duplicate expense/ledger records.
- [ ] GREEN: implement routes/domain/client/outbox/UI and cloud snapshot calculations.

## Task 6 — Billing and delinquency parity

**Files**
- Create: `cloudflare/domain/billing.mjs`
- Modify: `cloudflare/api/billing-routes.mjs`
- Modify: `cloudflare/api/replica-routes.mjs`
- Modify: `src/api/client.mjs`
- Modify: `src/sync/outbox-runner.mjs`
- Create: `src/cloud/ui/billing.mjs`
- Create: `src/cloud/ui/delinquency.mjs`
- Test: `tests/cloud-billing-parity.test.mjs`

**Commands**
- `billing.plan.create`
- existing `billing.payment`
- `collectionAction.create`

**Capabilities**
- active plans, open installments, balance/fine/interest, recurring-plan creation, installment payment, overdue totals/aging/customer report, collection history and register collection action.

**TDD**
- [ ] RED: recurring-plan replay creates one plan and one deterministic set of installments/ledger rows.
- [ ] RED: invalid frequency/amount/occurrences rejected.
- [ ] RED: collection action is permission checked, auditable and emits sync delta.
- [ ] GREEN: implement domain/routes/client/outbox/mobile screens using shared commercial balance rules.

## Task 7 — Maintenance parity

**Files**
- Create: `cloudflare/domain/maintenance.mjs`
- Create: `cloudflare/api/maintenance-routes.mjs`
- Modify: `cloudflare/worker.mjs`
- Modify: `cloudflare/api/replica-routes.mjs`
- Modify: `src/api/client.mjs`
- Modify: `src/sync/outbox-runner.mjs`
- Create: `src/cloud/ui/maintenance.mjs`
- Test: `tests/cloud-maintenance-routes.test.mjs`

**Commands**
- `maintenance.create`
- `maintenance.start`
- `maintenance.complete`

**Rules**
- Start blocks vehicle for maintenance.
- Complete returns vehicle to available unless another active maintenance still blocks it.
- Actual cost updates vehicle mileage where supplied and creates canonical expense/ledger cost records atomically.

**TDD**
- [ ] RED: invalid lifecycle transition returns 409.
- [ ] RED: start/complete are idempotent by operationId.
- [ ] RED: dependent vehicle + expense + ledger tables converge through replica mapping.
- [ ] GREEN: implement commands and mobile maintenance cards/forms.

## Task 8 — Contracts and document parity

**Files**
- Create: `cloudflare/domain/contracts.mjs`
- Create: `cloudflare/api/contract-routes.mjs`
- Modify: `cloudflare/worker.mjs`
- Modify: `cloudflare/api/replica-routes.mjs`
- Modify: `src/api/client.mjs`
- Modify: `src/sync/outbox-runner.mjs`
- Create: `src/cloud/ui/contracts.mjs`
- Modify: `src/cloud/ui/documents.mjs`
- Test: `tests/cloud-contract-routes.test.mjs`

**Commands**
- template create/update/duplicate/deactivate
- contract issue

**Rules**
- Issued contract freezes rendered text/template version and is immutable history.
- Duplicate issue operationId returns same issued contract rather than creating another.
- PDF generation uses canonical rendered data available to the PWA.

**TDD**
- [ ] RED: RBAC and idempotency for every mutation.
- [ ] RED: template stale update is rejected.
- [ ] RED: issuing from inactive/missing template or missing rental fails safely.
- [ ] GREEN: implement Worker commands, mobile template/issue/history UI and PDF actions.

## Task 9 — Alerts parity

**Files**
- Create: `cloudflare/domain/alerts.mjs`
- Create: `cloudflare/api/alert-routes.mjs`
- Modify: `cloudflare/worker.mjs`
- Modify: `cloudflare/api/replica-routes.mjs`
- Modify: `src/api/client.mjs`
- Modify: `src/sync/outbox-runner.mjs`
- Create: `src/cloud/ui/alerts.mjs`
- Test: `tests/cloud-alert-routes.test.mjs`

**Commands**
- `alert.acknowledge`
- `alert.dismiss`

**Design**
- Operational alerts are derived from canonical rentals/maintenance/documents/CNH, while acknowledgement/dismissal state is persisted in `alert_state` and replicated.

**TDD**
- [ ] RED: derived alert IDs match desktop rules for same canonical snapshot.
- [ ] RED: `alerts.write` required for mutation.
- [ ] RED: state update is version-safe/idempotent and survives another-device refresh.
- [ ] GREEN: implement derived alert feed + action state + mobile screen.

## Task 10 — PWA shell decomposition, permissions and reconnect regression

**Files**
- Modify: `src/cloud-app.mjs`
- Modify/Create: all `src/cloud/ui/*.mjs`
- Modify: `src/sync/cloud-sync.mjs`
- Test: `tests/pwa-parity-shell.test.mjs`
- E2E: `qa/e2e/cloud-offline-sync.test.cjs`

**TDD**
- [ ] RED: admin sees all 12 in-scope modules; atendente/vistoriador see only permitted modules/actions.
- [ ] RED: 403 never creates optimistic authoritative mutation.
- [ ] RED: reconnect preserves current screen, revalidates session, flushes once, handles 401/409 and refreshes canonical state.
- [ ] GREEN: finish module routing and remove duplicated legacy render/bind blocks from `cloud-app.mjs`.

## Task 11 — QA parity matrix and full release gates

**Files**
- Create: `docs/qa/pwa-desktop-functional-parity.md`
- Modify/Create: `qa/e2e/pwa-functional-parity.test.cjs`
- Update screenshots/report tooling only as needed; do not add production-only QA hooks.

**Acceptance matrix**
For every one of the 12 modules record:
- desktop capability;
- PWA equivalent;
- permission behavior;
- online mutation/result;
- offline behavior where applicable;
- D1/R2 canonical evidence;
- desktop replica convergence.

**Final verification**
Run/require green for:

```bash
npm run check
npm run check:plan03
npm test
npm run test:migration
npm run dr:test
npm run cloud:migrations:local
npm run cloud:test
npm run coverage
npm run e2e
npm run qa:release
npm run plan03:gate
npm run windows:installer:verify
```

Then generate fresh Desktop × Web/PWA screenshots at mobile and desktop-web viewports and compare them against the acceptance matrix.

## Definition of Done

- 12 approved PWA modules are navigable according to permission.
- The six pre-existing PWA modules expose the approved desktop-equivalent daily capabilities.
- Billing, Delinquency, Contracts, Documents, Alerts and Maintenance are usable from PWA.
- Money/workflow operations are server validated, permission checked and idempotent where required.
- Offline/reconnect/conflict safety remains intact.
- D1/R2 is canonical and Electron replica convergence is covered.
- No unresolved daily-operation gap remains in the QA matrix for in-scope modules.
- Linux CI, Windows build/installer, Cloudflare tests, DR, coverage and E2E are all green.
