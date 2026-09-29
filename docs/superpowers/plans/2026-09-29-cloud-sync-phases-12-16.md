# Cloud Sync Phases 12–16 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the cloud-first rollout with device/session management, clean-machine recovery, complete release QA, a no-data-loss migration path for the existing George desktop database, and final operator/user documentation.

**Architecture:** D1/R2 remain authoritative after migration. Electron keeps SQLite + local attachment files as an offline replica. First-run migration never overwrites a populated local database before a verified local backup; an empty cloud can be seeded from the local relational dataset, while a populated cloud requires explicit admin choice before the PC adopts it. Device/session controls use the existing authenticated Worker routes and never expose session credentials to the renderer.

**Tech Stack:** Electron 39, Node.js CJS/ESM, `node:sqlite`, Cloudflare Workers/D1/R2, existing outbox/replica/backup stack, `node:test`.

**Spec:** Existing roadmap phases 12–16 following `docs/superpowers/plans/2026-09-29-cloud-sync-phases-7-11.md`.

## Global Constraints

- Continue on `feat/cloud-sync-phases-7-11`; no paid dependency.
- No loss of the existing local SQLite database or attachment directory during migration.
- Create and verify a local backup before any first-bootstrap action that could replace local rows.
- Never silently choose between two populated datasets.
- Device/session revocation is admin-only and must not expose cookies/tokens to renderer code.
- Cloud migration import may seed only an empty business dataset; it must refuse a populated cloud.
- Existing D1/R2 restore-generation semantics remain authoritative after import/restore.
- All behavior changes use RED → GREEN and the full release gates run before merge.

## Review Focus

1. Existing PC has data, cloud is empty → local data is backed up, imported, attachments queued, then canonical cloud bootstrap occurs.
2. Existing PC and cloud both have business data → local DB is preserved and migration is blocked pending an explicit admin decision.
3. New/reinstalled PC is empty → D1/R2 rebuilds SQLite and attachments without a legacy LAN path.
4. Revoking one device invalidates only that device/session set; other sessions stay usable unless explicitly revoked.
5. Migration/import failure never marks migration complete and never deletes the verified local backup.

---

### Task 1: Phase 12 — Device and session management

**Files:**
- Modify: `src/api/client.mjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/ui/system.mjs`
- Modify: `src/cloud-app.mjs`
- Test: `tests/cloud-sync-phases-12-16.test.mjs`

**Interfaces:**
- Produces API methods `listDevices()`, `revokeDevice(id)`, `revokeOtherSessions()`, `revokeAllSessions()`.
- Desktop renderer receives only normalized device/session results through IPC.

- [ ] Write failing tests for API methods and secure desktop bridge.
- [ ] Implement client + IPC/preload methods.
- [ ] Add admin device/session panels to desktop backup/config and PWA admin view.
- [ ] Verify targeted tests pass.

### Task 2: Phase 13 — Disaster recovery finalization

**Files:**
- Create: `electron/migration/cloud-first-migration.cjs`
- Modify: `electron/main.cjs`
- Test: `qa/dr/cloud-first-bootstrap.test.cjs`
- Test: `tests/cloud-sync-phases-12-16.test.mjs`
- Create: `docs/runbooks/cloud-disaster-recovery.md`

**Interfaces:**
- Produces migration preflight distinguishing `new-device`, `seed-cloud`, `adopt-cloud`, `blocked`.
- Consumes existing verified local backup, replica bootstrap and restore-generation mechanisms.

- [ ] Write RED tests for empty-PC recovery and populated-local preservation.
- [ ] Implement preflight + verified-backup guard.
- [ ] Add clean-machine D1/R2 reconstruction DR scenario.
- [ ] Document operator recovery steps.

### Task 3: Phase 15 — Existing-PC migration without data loss

**Files:**
- Create: `cloudflare/api/migration-routes.mjs`
- Modify: `cloudflare/api/router.mjs`
- Modify: `src/api/client.mjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/ui/system.mjs`
- Test: `tests/cloud-migration-routes.test.mjs`
- Test: `tests/cloud-sync-phases-12-16.test.mjs`

**Interfaces:**
- Produces `POST /api/v1/migration/import`, admin-only, empty-cloud-only, returning restore generation/cursor.
- Produces desktop migration status/actions: seed empty cloud from local dataset or explicitly adopt cloud after verified backup.

- [ ] Write RED tests proving import refuses populated cloud and preserves auth/session tables.
- [ ] Implement empty-cloud relational import with server-side cloud backup and restore-generation bump.
- [ ] Wire desktop migration coordinator to seed structured rows, queue local attachments, then bootstrap canonical cloud.
- [ ] Add explicit `adopt cloud` action for populated cloud; never automatic.
- [ ] Verify migration and DR tests pass.

### Task 4: Phase 14 — Complete acceptance QA

**Files:**
- Modify: `scripts/plan03-release-gate.cjs`
- Test: `tests/cloud-sync-phases-12-16.test.mjs`
- Test: existing `qa/e2e/*`, `qa/dr/*`

**Interfaces:**
- Produces a release gate that requires cloud-first runtime, migration safeguards, device controls and final docs.

- [ ] Add phase 12–16 structural acceptance assertions.
- [ ] Run unit/migration/DR/cloud/Electron/QA/release gates.
- [ ] Require Windows installer build to pass before merge.

### Task 5: Phase 16 — Catalog and manual

**Files:**
- Modify: `README.md`
- Create: `docs/runbooks/manual-operacao-cloud.md`
- Create: `docs/runbooks/migracao-versao-cloud.md`

**Interfaces:**
- Documents same-login multi-device behavior, automatic cloud sync, offline behavior, recovery, device revocation, and migration from old LAN builds.

- [ ] Replace obsolete LAN/pairing guidance with cloud-first operation.
- [ ] Document D1 = structured data and R2 = photos/documents/backups.
- [ ] Document first migration and clean-PC recovery.
- [ ] Verify release gate detects the final docs.

## Final Verification

Observe fresh successful runs of:

```bash
npm run release:check
npm run dist
npm run windows:installer:verify
```

Then compare branch against current `main`, merge PR only if `main` has no unintegrated commits and all required checks are green. After merge, verify the Cloudflare deployment triggered by `main` completes successfully.
