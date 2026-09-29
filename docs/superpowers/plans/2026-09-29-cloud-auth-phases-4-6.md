# Cloud Auth Phases 4–6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete automatic desktop↔cloud convergence through phase 6: durable PC→Cloud operations, immediate Cloud→PC refresh, and bidirectional R2 attachment sync without removing the legacy LAN fallback.

**Architecture:** Keep D1/R2 authoritative for cloud state and SQLite/attachments as the desktop offline replica. Desktop writes are converted into semantic, idempotent operations stored in a durable SQLite-backed outbox; the existing replica cursor then pulls the canonical server result back to SQLite. Attachment bytes stay local and are uploaded/deleted through authenticated Worker routes while the existing replica verifies cloud downloads by SHA-256.

**Tech Stack:** Electron 39, Node.js ESM/CJS, `node:sqlite`, Cloudflare Worker/D1/R2, Web/Node Crypto, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-29-cloud-auth-phases-0-3-design.md` plus the F4–F8 constraints in `docs/superpowers/plans/2026-09-27-cloudflare-pwa-d1-r2-local-replica-master.md`.

## Global Constraints

- Work only on `feat/cloud-auth-phases-0-3`; do not merge or deploy.
- Preserve local SQLite data, migrations, and legacy LAN compatibility.
- D1 remains authoritative for cloud structured data; R2 remains authoritative for cloud blobs.
- Desktop offline writes must survive restart in SQLite-backed durable state.
- Monetary operations remain idempotent and never use last-write-wins.
- Do not expose the encrypted/decrypted cloud session credential to the renderer.
- No new paid dependency; core remains on the existing project stack.
- Changes follow RED → GREEN and release gates must be re-run after implementation.

## Review Focus

1. Re-saving the same local snapshot must not create duplicate cloud operations or duplicate payments.
2. Multiple offline edits to one versioned entity must conflict rather than silently overwrite a cloud version.
3. A successful cloud pull must refresh the renderer from SQLite without an app restart.
4. Attachment upload must keep the local file after R2 succeeds; download must continue to verify SHA-256.
5. Logout/expired auth must stop cloud delivery without deleting local data or falling back to another identity.

---

### Task 1: Phase 4 — Durable PC→Cloud semantic outbox

**Files:**
- Create: `electron/cloud-sync-operations.cjs`
- Modify: `electron/main.cjs`
- Modify: `cloudflare/domain/rentals.mjs`
- Modify: `cloudflare/domain/payments.mjs`
- Modify: `cloudflare/api/replica-routes.mjs`
- Test: `tests/desktop-cloud-phases-4-6.test.mjs`

**Interfaces:**
- Produces: `buildCloudOperations(before, after)` returning deterministic `{operationId, kind, payload}` operations.
- Consumes: existing `createOutbox`, `runOutbox`, `createApiClient`, cloud-auth cookie held only in Electron main.

- [ ] **Step 1: Write failing tests** for deterministic customer/vehicle/rental/payment/inspection operation generation, no-op unchanged snapshots, and client-provided IDs preserved by cloud rental/payment commands.
- [ ] **Step 2: Run targeted tests and verify RED** because the semantic desktop operation builder/client-ID behavior does not yet exist.
- [ ] **Step 3: Implement the semantic operation builder and main-process durable outbox**, enqueueing after relational snapshot saves only when a cloud identity is active; use deterministic operation IDs and existing optimistic concurrency/version checks.
- [ ] **Step 4: Preserve client IDs in cloud rental/payment operations** and expand rental replica snapshots to include generated billing/ledger rows so canonical IDs converge immediately.
- [ ] **Step 5: Run targeted tests and verify GREEN.**

### Task 2: Phase 5 — Immediate Cloud→PC convergence

**Files:**
- Modify: `electron/replica/agent.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/storage/repository.mjs`
- Modify: `src/app.mjs`
- Test: `tests/desktop-cloud-phases-4-6.test.mjs`

**Interfaces:**
- Produces: replica-success notification from main→preload→renderer and `repository.reload()`.
- Consumes: existing cursor/bootstrap/table-snapshot/SHA-256 replica implementation.

- [ ] **Step 1: Add failing tests** proving a successful replica cycle calls an `onSynced` hook and repository reload can replace its in-memory desktop snapshot from SQLite.
- [ ] **Step 2: Run targeted tests and verify RED.**
- [ ] **Step 3: Add `ReplicaAgent({onSynced})` hook**, emit a narrow IPC notification after canonical state lands locally, expose a safe subscription in preload, and add `repository.reload()`.
- [ ] **Step 4: Bind renderer refresh** so cloud changes become visible without restarting Electron; on reconnect also request an outbox flush/replica pull while retaining LAN auto-sync.
- [ ] **Step 5: Run targeted tests and verify GREEN.**

### Task 3: Phase 6 — Bidirectional R2 attachment delivery

**Files:**
- Modify: `src/api/client.mjs`
- Modify: `src/sync/outbox-runner.mjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Test: `tests/desktop-cloud-phases-4-6.test.mjs`

**Interfaces:**
- Produces: durable `attachment.upload`/`attachment.delete` desktop operations and authenticated API deletion.
- Consumes: local `AttachmentStore`, Worker attachment route, existing R2 metadata/storage implementation and SHA-256 replica download verification.

- [ ] **Step 1: Add failing tests** proving `attachment.delete` dispatch and desktop attachment operation creation use stable IDs/metadata.
- [ ] **Step 2: Run targeted tests and verify RED.**
- [ ] **Step 3: Add authenticated attachment deletion to the API client/outbox runner**, and wrap desktop attachment put/remove so cloud delivery is queued durably without deleting the local replica after upload.
- [ ] **Step 4: Add cloud sync status/manual flush IPC** for diagnostics and reconnect recovery without exposing credentials.
- [ ] **Step 5: Run targeted tests and verify GREEN.**

---

## Final Verification

Run the full branch gates after all three tasks:

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

Keep PR #10 draft, update its description to phases 0–6, and leave merge/deploy untouched.
