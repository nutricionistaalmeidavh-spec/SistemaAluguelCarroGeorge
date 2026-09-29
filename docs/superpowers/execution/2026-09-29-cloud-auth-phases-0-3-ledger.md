# Execution ledger — phases 0–3

Branch: `feat/cloud-auth-phases-0-3`
Base `main`: `056c991e6aa0053d28c54c7a408030192d8bc277`
Draft PR: #10

## Scope
- Phase 0: isolated/safe implementation path, preserving SQLite and the legacy LAN rollback path.
- Phase 1: Electron authenticates against the existing Cloudflare auth API with the same George account used by the PWA.
- Phase 2: independent persistent desktop session encrypted with Electron `safeStorage`; restore, first access and logout are exposed through narrow IPC/preload APIs.
- Phase 3: a valid desktop cloud session automatically feeds the existing Cloud→PC D1/R2 replica into local SQLite, so manual LAN pairing is no longer required for the new cloud-authenticated replica path.

## Deliberate boundaries
- Do not remove the legacy LAN sync yet.
- Do not merge or deploy from this branch.
- Preserve current local SQLite data and migration path.
- PC→Cloud mutation upload remains phase 4; phases 0–3 must not claim bidirectional desktop write sync.
- No new paid dependency is introduced.

## TDD evidence
RED run `36583499652`: the existing suite had 180 passing tests and exactly 4 new expected failures because `electron/cloud-auth.cjs` and the cloud-auth preload/IPC bridge did not exist yet.

Implementation added `electron/cloud-auth.cjs`, cloud-auth IPC/preload wiring, persistent session restore, cloud-first desktop login UI and automatic authenticated replica bootstrap. Existing Electron E2E is explicitly run in local-only QA mode so legacy regression coverage remains independent of the cloud login path.

Final branch verification remains required before merge/deploy.
