# PWA Functional Parity — Implementation Plan

**Branch:** `feat/pwa-functional-parity`  
**Spec:** `docs/superpowers/specs/2026-09-29-pwa-functional-parity-design.md`

## Goal

Bring the Web/PWA to operational parity with the desktop for the 12 approved daily-operation modules while keeping D1/R2 canonical, preserving offline/outbox behavior, and avoiding LAN reintroduction or new paid runtime dependencies.

## Constraints

- Work only on `feat/pwa-functional-parity` until all gates are green.
- Use RED → GREEN for each functional batch.
- Financial/workflow mutations must be server validated, permission checked, idempotent where replay can duplicate effects, and emitted into `sync_changes`.
- Customer/vehicle optimistic CRUD remains versioned.
- PWA remains mobile-first; parity is capability parity, not pixel parity.
- `main` is not merged or deployed until full Linux/Windows/Cloudflare/DR/E2E verification passes.

---

### Task 1 — Cloud read model for all 12 modules

**Modify:**
- `cloudflare/api/resource-map.mjs`
- `src/cloud-app.mjs`
- `src/sync/cloud-sync.mjs`
- `cloudflare/api/replica-routes.mjs`

**Add tests:**
- `tests/pwa-parity-resources.test.mjs`

Steps:
- [ ] RED: require readable `ledger`, `billingPlans`, `collectionActions`, `contractTemplates`, `issuedContracts`, `inspectionItems`, and `alertState` with correct RBAC.
- [ ] GREEN: expand safe read-only resource definitions and cloud cache mapping.
- [ ] Expose all 12 navigation modules according to cloud permissions.

### Task 2 — Mobile-first UI decomposition + Overview/Customers/Fleet

**Create:**
- `src/cloud/ui/common.mjs`
- `src/cloud/ui/overview.mjs`
- `src/cloud/ui/customers.mjs`
- `src/cloud/ui/vehicles.mjs`

**Modify:**
- `src/cloud-app.mjs`

**Add tests:**
- `tests/pwa-parity-ui.test.mjs`

Steps:
- [ ] RED: require dashboard KPI parity and complete customer/vehicle fields/actions.
- [ ] GREEN: render dashboard KPIs from cloud rows, complete CNH/customer fields, complete fleet/document fields, edit/deactivate flows with expectedVersion.

### Task 3 — Generic parity command boundary

**Create:**
- `cloudflare/api/parity-command-routes.mjs`
- `cloudflare/domain/parity-commands.mjs`

**Modify:**
- `cloudflare/worker.mjs`
- `src/api/client.mjs`
- `src/sync/outbox-runner.mjs`
- `cloudflare/api/replica-routes.mjs`

**Add tests:**
- `tests/cloud-parity-commands.test.mjs`

Steps:
- [ ] RED: auth/RBAC/idempotency/change-log tests for each supported command family.
- [ ] GREEN: explicit command router with receipts, audit, and change log.
- [ ] Add PWA API/outbox dispatch without exposing generic unrestricted SQL/CRUD.

### Task 4 — Rentals + Inspections parity

**Create:**
- `src/cloud/ui/rentals.mjs`
- `src/cloud/ui/inspections.mjs`

**Modify:**
- rental/inspection Worker domains/routes as needed.

**Capabilities:**
- [ ] fixed + continuous rental creation
- [ ] priority/notes/billing mode
- [ ] safe status transitions
- [ ] close continuous rental
- [ ] rental and installment payments
- [ ] full inspection checklist, draft/completion, multiple R2 photos, damages, history/PDF action

### Task 5 — Finance + Billing + Delinquency parity

**Create:**
- `src/cloud/ui/finance.mjs`
- `src/cloud/ui/billing.mjs`
- `src/cloud/ui/delinquency.mjs`

**Capabilities:**
- [ ] KPI totals and receivables
- [ ] expense create/edit/delete via explicit server command
- [ ] recurring billing plan create/list
- [ ] installment payment
- [ ] overdue/aging/customer grouping
- [ ] collection-action history + create command

### Task 6 — Contracts + Documents parity

**Create:**
- `src/cloud/ui/contracts.mjs`
- `src/cloud/ui/documents.mjs`

**Capabilities:**
- [ ] template create/edit/duplicate/deactivate/default
- [ ] rental preview
- [ ] immutable issuance
- [ ] issued contract listing
- [ ] contract/receipt/inspection PDF actions suitable for mobile

### Task 7 — Alerts + Maintenance parity

**Create:**
- `src/cloud/ui/alerts.mjs`
- `src/cloud/ui/maintenance.mjs`

**Capabilities:**
- [ ] operational alert list + acknowledge/dismiss
- [ ] maintenance schedule/start/complete
- [ ] vehicle availability changed atomically during maintenance lifecycle
- [ ] costs/mileage/notes preserved and replicated

### Task 8 — Offline/reconnect/conflict hardening

**Modify:**
- `src/cloud-app.mjs`
- `src/sync/outbox-runner.mjs`
- cloud sync/cache helpers as needed

**Add tests:**
- offline queue/restart/reconnect
- 401 session expiry
- 403 no local mutation
- 409 preserved intent
- repeated payment/contract command does not duplicate effect

### Task 9 — QA parity matrix and final gates

**Add/update:**
- `tests/pwa-parity-e2e.test.mjs`
- QA scripts/artifacts as appropriate
- parity matrix document

Run:

```bash
npm run check
npm run check:plan03
npm test
npm run test:migration
npm run dr:test
npm run cloud:migrations:local
npm run cloud:test
npm run e2e
npm run qa:release
npm run plan03:gate
```

Then require Windows build success, Cloudflare checks success, and a final Desktop × PWA QA screenshot pass before considering merge/deploy.
