# Cloud Auth Phases 0–3 — Execution Design

## Goal
Unify the installed Electron app and the Cloudflare PWA around the same cloud identity and D1-backed source of truth, while preserving SQLite for offline desktop operation and keeping the legacy LAN sync path available during migration.

## Phase 0 — Safety
- Work only on `feat/cloud-auth-phases-0-3`.
- No merge or deployment.
- Preserve local SQLite data, migrations, and LAN compatibility.
- Add tests before production changes.

## Phase 1 — Unified authentication
The Electron renderer must stop authenticating against `snapshot.users` as its primary login path. When the installed app has cloud auth available, credentials are validated by the existing Cloudflare auth API using the same installation/user identity as the PWA. The desktop keeps its own device identity and session.

## Phase 2 — Persistent per-device session
The Electron process stores the cloud session credential in the desktop key-value database with encryption through Electron `safeStorage`. The credential is scoped to the PC device. The renderer can query the current session, login, restore, and logout through preload IPC. PWA session behavior remains independent.

## Phase 3 — D1 central source
D1 remains authoritative for cloud-backed structured data. The Electron app keeps SQLite as offline replica/cache. On desktop startup with a valid cloud session, the existing cloud replica agent is configured automatically from the authenticated device/session context rather than requiring the old manual PC↔Mobile pairing screen. Existing LAN code remains intact for rollback until later phases.

## Failure handling
- No network: keep local SQLite usable; do not discard the last valid local state.
- Invalid/expired cloud session: return to cloud login without deleting local data.
- Cloud auth failure: show a login error; never silently fall back to a different identity.
- `safeStorage` unavailable: refuse persistent cloud credential storage rather than storing secrets in plaintext.

## Tests
- Electron login uses cloud auth bridge rather than local snapshot auth when bridge exists.
- Successful login persists an encrypted desktop session/device credential.
- Restored valid session bypasses login and can start the cloud replica.
- Logout revokes/clears only the desktop session.
- Legacy local/LAN path remains available when cloud bridge is absent.
