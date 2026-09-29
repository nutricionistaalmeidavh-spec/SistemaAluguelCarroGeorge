# Cloud Sync Phases 7–11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the cloud-first transition by making conflicts explicit and safe, proving offline operation on PC/PWA, removing the obsolete PC↔Mobile user experience, and retiring the LAN sync server from production Electron startup.

**Architecture:** D1/R2 remain authoritative cloud state. Electron keeps SQLite + local attachments as the offline replica and a durable cloud outbox. PWA keeps SQLite/OPFS/IndexedDB cache + durable outbox/blob store. Conflict resolution never silently overwrites a newer cloud version. The legacy LAN server/client remains only in repository history/tests after phase 11; production runtime no longer starts or exposes it.

**Global constraints:**
- Work only on `feat/cloud-sync-phases-7-11` based on main merge `176f91706f9e3c68c9de16ae7b6f83916c030e4f`.
- No merge and no deploy during implementation.
- No paid dependency.
- Preserve D1/R2 bindings, authentication, backup/restore, disaster recovery and desktop installer.
- Financial operations stay idempotent and never get a “force overwrite” path.
- Every behavior change is RED → GREEN.

### Task 1 — Phase 7: conflicts

- [ ] Add durable conflict inspection/resolution primitives to the outbox.
- [ ] Desktop IPC exposes conflict list and safe “accept cloud” resolution without credentials.
- [ ] PWA shows conflict count/details and never retries conflict automatically.
- [ ] Versioned updates keep local payload + server `current` side-by-side for review.
- [ ] Financial conflicts cannot be force-overwritten.

### Task 2 — Phase 8: offline PC

- [ ] Desktop snapshot writes always land in SQLite first.
- [ ] If a persisted cloud session exists but network is unavailable, semantic operations remain queued durably.
- [ ] Reconnect/manual sync flushes pending operations and then pulls canonical state.
- [ ] Cloud status reports offline/pending/conflict without blocking local operation.

### Task 3 — Phase 9: offline PWA

- [ ] PWA shell remains available through Service Worker.
- [ ] Cached authenticated session may continue in offline mode without claiming server validation.
- [ ] Structured writes remain in durable outbox; inspection photos remain in IndexedDB until R2 confirms upload.
- [ ] `online` event flushes outbox and pulls cloud changes.

### Task 4 — Phase 10: remove PC↔Mobile screens

- [ ] Remove `PC ↔ Mobile` navigation and `renderSync` runtime dependency from the product UI.
- [ ] Remove pairing link/token/IP/LAN configuration from user-facing UI.
- [ ] Replace with compact cloud status in the desktop top bar: synchronized / pending / offline / conflict.
- [ ] Keep diagnostics/manual cloud sync available through secure desktop IPC and existing admin/backup surfaces.

### Task 5 — Phase 11: retire legacy LAN runtime

- [ ] Electron no longer imports or starts `sync-server.cjs` in production.
- [ ] Electron no longer discovers LAN IPs, creates pairing tokens or exposes `locadora:sync-info`.
- [ ] Desktop app no longer creates/configures the legacy `createSyncClient` path.
- [ ] Remove obsolete LAN-only UI/module from production asset/build references where safe.
- [ ] Preserve old source only if a test/migration still needs it; production runtime must not reference it.

## Final verification

Run/observe all repository gates:

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
```

Open a draft PR only after the branch is green. Do not merge or deploy.