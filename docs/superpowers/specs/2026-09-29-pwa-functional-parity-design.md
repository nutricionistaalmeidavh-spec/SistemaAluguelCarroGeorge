# PWA Functional Parity — Design

**Date:** 2026-09-29  
**Branch:** `feat/pwa-functional-parity`  
**Base:** `main`  

## 1. Objective

Bring the Web/PWA experience to operational parity with the desktop application for the modules used in the daily operation of the car-rental business, while keeping the interface mobile-first rather than copying desktop tables literally.

Success means that a user with the same role/permission can complete the same day-to-day business operation from the PWA as from the desktop for the modules in scope, with the same D1/R2 canonical data, the same authorization model, and the same offline/conflict guarantees.

## 2. Scope

### Existing PWA modules to complete

1. Overview / Dashboard
2. Customers
3. Fleet
4. Rentals
5. Inspections
6. Finance

### New PWA modules

7. Billing
8. Delinquency
9. Contracts
10. Documents
11. Alerts
12. Maintenance

### Explicitly out of scope for this batch

- Audit UI parity
- Backup / Settings UI parity
- Re-introduction of LAN pairing or PC↔Mobile flows
- Replacing D1/R2 with another persistence layer
- New paid runtime dependencies
- Pixel-identical reproduction of desktop screens

Audit and cloud administration require a separate administrative UX design because their mobile concepts differ materially from the desktop SQLite/recovery screens.

## 3. Current State

The cloud PWA currently exposes only six navigation items: Overview, Customers, Fleet, Rentals, Inspections, and Finance. Its forms are intentionally reduced compared with the desktop.

The Worker already exposes cloud permissions for rentals, customers, vehicles, finance, billing, contracts, inspections, maintenance, alerts, documents, reports, and synchronization. The resource map already supports read access for maintenance and billing installments, while customer and vehicle writes use versioned optimistic concurrency. Rental creation/payments, installment payments, and inspection creation already have dedicated idempotent operation routes.

The current generic sync mutation path is deliberately narrow and should remain so: customer/vehicle CRUD are versioned entity mutations, while financial/workflow operations must use explicit business commands.

## 4. Product Principle

**Same capability and same data, device-appropriate interface.**

Desktop may keep dense tables and multi-column forms. PWA will use cards, bottom sheets/modals, progressive disclosure, sticky primary actions, and compact summaries where appropriate. Functional parity is measured by supported actions and resulting canonical state, not by visual duplication.

## 5. Architecture

### 5.1 Canonical state

- **D1** remains authoritative for structured cloud data.
- **R2** remains authoritative for cloud attachments/documents/photos.
- PWA local storage remains a cache/outbox/offline working set, not a second source of truth.
- Desktop remains a SQLite replica of the same cloud state.

### 5.2 PWA UI decomposition

`src/cloud-app.mjs` currently owns navigation, data loading, rendering, form bindings, offline state, and sync conflict handling. This batch will split presentation/interaction into focused cloud UI modules while leaving bootstrap/session orchestration centralized.

Proposed structure:

- `src/cloud-app.mjs` — bootstrap, session, navigation shell, shared refresh/sync orchestration
- `src/cloud/ui/overview.mjs`
- `src/cloud/ui/customers.mjs`
- `src/cloud/ui/vehicles.mjs`
- `src/cloud/ui/rentals.mjs`
- `src/cloud/ui/inspections.mjs`
- `src/cloud/ui/finance.mjs`
- `src/cloud/ui/billing.mjs`
- `src/cloud/ui/delinquency.mjs`
- `src/cloud/ui/contracts.mjs`
- `src/cloud/ui/documents.mjs`
- `src/cloud/ui/alerts.mjs`
- `src/cloud/ui/maintenance.mjs`
- `src/cloud/ui/common.mjs` — mobile cards, form helpers, money/date/status helpers, permission guards

Domain calculations and PDF builders should be reused from existing desktop domain modules where they are pure and cloud-safe. Cloud UI modules must not directly mutate cached state for authoritative business operations.

### 5.3 Command boundary

Use two write models:

**Versioned entity CRUD**
- customer.create/update/delete
- vehicle.create/update/delete

These continue through optimistic concurrency and explicit `expectedVersion`.

**Business commands**
- rental.create
- rental.advance
- rental.closeContinuous
- rental.payment
- billing.plan.create
- billing.payment
- expense.create/update/delete
- inspection.create/complete where needed by the mobile flow
- maintenance.create/start/complete
- contract.template.create/update/duplicate/deactivate
- contract.issue
- alert.acknowledge/dismiss
- document operations that create or fetch persisted output

Business commands must be explicit, idempotent where they mutate money/workflow state, permission-checked in the Worker, auditable, and represented in the sync change log so desktop replicas converge.

## 6. Module Design

### 6.1 Overview / Dashboard

PWA will show the same operational KPIs available on desktop where the data is available in cloud state:

- fleet occupancy
- open rentals
- overdue rentals / overdue receivables
- received amount
- open amount
- net cash
- fleet totals: available / maintenance
- average ticket
- vehicle profitability summary

Mobile presentation: KPI cards followed by compact ranked cards for vehicle performance rather than a wide desktop table.

### 6.2 Customers

PWA parity fields:

- name
- document
- phone
- email
- address
- active/inactive
- driver license number
- category
- expiration

Actions:

- create
- edit
- deactivate/delete according to existing domain rules
- conflict resolution on stale versions

### 6.3 Fleet

PWA parity fields:

- model
- plate
- year
- mileage
- category
- color
- daily rate
- purchase price
- availability
- vehicle documents/expiry metadata

Actions:

- create
- edit
- update mileage/status where permitted
- delete/deactivate according to existing rules

### 6.4 Rentals

PWA must support the operational rental lifecycle, not only creation/listing.

Required capabilities:

- availability-aware creation
- fixed and continuous periods
- billing mode total/daily
- priority and notes
- current lifecycle status
- advance status through permitted transitions
- close continuous rental
- total-rental payment
- daily installment payment
- generated billing rows visible immediately
- customer/vehicle context
- contract/receipt actions where available

Workflow mutations use dedicated Worker commands, not local-only state transitions.

### 6.5 Inspections

Mobile is the preferred inspection surface.

Required capabilities:

- pickup and return
- full checklist
- progress/draft state when compatible with backend model
- mileage
- fuel level
- multiple photos
- damages
- notes
- completion
- history
- inspection PDF

Photos continue through authenticated R2 attachment flow and SHA-256 integrity checks.

### 6.6 Finance

Required capabilities:

- planned revenue
- received
- outstanding
- net cash
- receivables
- rental payments
- billing installment payments
- expenses list
- create/edit/delete expense where permitted
- due/overdue visibility

No financial mutation may be implemented as an unversioned local cache rewrite.

### 6.7 Billing

Required capabilities:

- active recurring plans
- open installments
- outstanding and overdue totals
- create recurring plan
- list installments
- receive installment payment
- display fine/interest/current balance using shared domain rules

### 6.8 Delinquency

Required capabilities:

- total overdue
- affected customers
- due today / next seven days
- overdue count
- average days late
- aging/customer report
- collection history
- register collection action

### 6.9 Contracts

Required capabilities:

- list templates
- create/edit template
- duplicate
- deactivate
- default template flag
- preview with rental data
- issue contract
- list issued contracts
- generate/download issued contract PDF

Issued contracts remain immutable historical outputs after issuance.

### 6.10 Documents

PWA should expose the same business documents relevant to field operation:

- rental contract PDF
- rental receipt PDF
- inspection PDF
- issued contract PDFs
- attachment/document listing when applicable

The UI will favor share/download/open actions suitable for mobile.

### 6.11 Alerts

Required capabilities:

- list active operational alerts
- severity/status
- due date/context
- acknowledge
- resolve/dismiss

Mutations must respect `alerts.write`.

### 6.12 Maintenance

Required capabilities:

- list maintenance entries
- due state
- schedule maintenance
- start maintenance
- complete maintenance
- actual/estimated cost
- mileage
- notes
- vehicle availability effect

The Worker command must update maintenance and any dependent vehicle state atomically where required.

## 7. Permissions

The PWA navigation and actions must be generated from the same cloud permission model already used by the Worker.

Rules:

- Hidden/disabled UI is convenience only; Worker remains authoritative.
- `admin` retains full access.
- `atendente` receives only the actions present in its permission list.
- `vistoriador` receives inspection/vehicle/rental read capabilities plus the limited write operations explicitly permitted.
- A 403 must never be silently converted into a local mutation.

## 8. Offline and Reconnection

Existing offline guarantees remain mandatory.

### Offline-safe operations

Commands that can be represented idempotently may be queued in the durable PWA outbox. The UI shows them as pending and preserves the local intent.

### Operations requiring fresh server validation

Where the action depends on current availability, money balance, lifecycle transition, or another server-side invariant, the UI may accept the intent into the outbox only when replay is safe and the Worker performs final validation. Otherwise the action is explicitly blocked offline with a clear message.

### Reconnection

On `online`:

1. revalidate cloud session;
2. flush pending outbox commands;
3. process conflicts without automatic overwrite;
4. pull canonical changes;
5. refresh the active screen without navigation reset.

A 401 clears the stale session and returns to login. A 409 preserves the local operation for explicit conflict resolution.

## 9. Conflict Handling

Customer and vehicle stale writes continue using optimistic versions.

For business commands:

- duplicate command IDs replay the previous result;
- invalid current state returns a domain conflict instead of forcing an overwrite;
- financial commands never retry as a new logical payment;
- UI displays current server state and the preserved local intent where human resolution is required.

No `last-write-wins` fallback is permitted for money, rental lifecycle, maintenance lifecycle, contracts, or inspection completion.

## 10. Worker and API Changes

Expected additions include dedicated routes/domain commands for operations missing from cloud parity. Exact files may be split by domain, following existing route patterns.

Likely Worker areas:

- rental operation routes/domain
- billing routes/domain
- maintenance routes/domain
- contract routes/domain
- alert routes/domain
- finance/expense routes/domain
- document endpoints where server persistence is required
- sync change mappings for new entity/command results

The generic API resource map may be expanded for safe CRUD/read models, but it must not become a generic escape hatch for workflow or financial mutations.

## 11. Data Flow

### Online mutation

PWA action → permission-aware UI → API/outbox command → Worker auth/RBAC → domain validation → D1 transaction → sync change log → response → PWA cache refresh → desktop replica pull.

### Offline mutation

PWA action → durable outbox + optimistic/pending UI → reconnect → authenticated replay with same operation ID → Worker validation → D1/R2 → sync change log → canonical pull → pending marker removed.

### Attachment flow

PWA photo/document → local pending blob store → authenticated Worker upload → R2 + D1 metadata/change log → canonical state → desktop replica download with hash verification.

## 12. Error Handling

User-facing errors must distinguish:

- offline / saved locally
- authentication expired
- forbidden action
- validation failure
- business conflict
- synchronization conflict
- attachment failure
- server/internal failure

Forms remain populated after recoverable errors. Financial and lifecycle actions cannot present success until the command is durably queued or accepted by the server.

## 13. Testing Strategy

### Unit/domain tests

- dashboard parity calculations
- lifecycle transitions
- billing balances and delinquency
- maintenance transitions
- contract generation
- alert transitions

### Worker contract tests

For each new command:

- authentication required
- RBAC enforced
- idempotency
- invalid-state conflict behavior
- correct D1 writes
- change-log emission
- replay result

### Offline/outbox tests

- queue while offline
- restart with pending operations
- reconnect replay
- 401 handling
- 409 handling
- no duplicate payments/contracts

### PWA E2E / QA

Every in-scope screen must be exercised at mobile viewport and desktop-web viewport. Critical flows:

- complete customer and vehicle CRUD
- rental creation/status/continuous close/payment
- full inspection with multiple photos
- expense and finance flow
- recurring billing/payment
- delinquency/collection action
- contract template + issuance + PDF
- alert acknowledge/resolve
- maintenance schedule/start/complete
- offline → reconnect → canonical refresh

### Regression gates

Existing desktop Electron E2E, Windows installer, DR, Cloudflare local migrations/tests, coverage, and release gates remain mandatory.

## 14. QA Acceptance Matrix

For each of the 12 modules, QA must record:

- desktop capability
- PWA equivalent capability
- role/permission behavior
- online result
- offline behavior if applicable
- canonical D1/R2 result
- desktop convergence after cloud mutation

The batch is not complete while a daily-operation capability exists only on desktop for an in-scope module.

## 15. Rollout

1. Implement on `feat/pwa-functional-parity` from current `main`.
2. Keep production `main` untouched during development.
3. Run all Linux/Windows/Cloudflare/DR/E2E gates.
4. Generate new QA screenshots for Desktop × PWA comparison.
5. Review parity matrix for remaining gaps.
6. Merge only after all required checks are green.
7. Deploy through the existing Cloudflare pipeline after merge.

## 16. Security and Cost Constraints

- No raw credentials in source or local plaintext storage.
- No direct public R2 bucket access.
- All writes pass through authenticated Worker routes.
- Existing D1/R2 tenancy boundaries remain intact.
- Core implementation uses the existing project stack; no new paid dependency is introduced.

## 17. Definition of Done

This design is complete when:

- all 12 in-scope PWA modules exist;
- existing six modules reach functional parity for daily operations;
- missing six modules support their desktop-equivalent daily workflows;
- financial/workflow mutations are server-validated and idempotent where required;
- permission behavior matches Worker RBAC;
- offline/reconnect/conflict behavior remains safe;
- D1/R2 remains canonical and desktop replica converges;
- QA matrix finds no unresolved in-scope daily-operation gap;
- full CI/Windows/Cloudflare/DR/E2E gates are green.
