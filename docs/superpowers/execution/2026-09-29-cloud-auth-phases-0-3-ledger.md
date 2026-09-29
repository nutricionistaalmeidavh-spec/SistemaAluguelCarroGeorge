# Execution ledger — phases 0–3

Branch: `feat/cloud-auth-phases-0-3`

Scope: phase 0 safety/isolation, phase 1 unified cloud authentication for Electron, phase 2 persistent per-device session, phase 3 D1 as central source while preserving local SQLite as offline replica/cache.

Constraints:
- Do not remove the legacy LAN sync yet.
- Do not merge or deploy from this branch.
- Preserve current local SQLite data and migration path.
- Cloudflare Worker + D1 + R2 remain the cloud core.
- Tests must be introduced before production behavior changes.

Status: branch created from current `main`; implementation pending.
