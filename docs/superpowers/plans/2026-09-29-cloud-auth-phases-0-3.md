# Implementation Plan — Cloud Auth Phases 0–3

Spec: `docs/superpowers/specs/2026-09-29-cloud-auth-phases-0-3-design.md`

1. Add failing tests covering the Electron cloud-auth bridge, persistent desktop session, restore/logout, and automatic replica bootstrap from a cloud-authenticated desktop context.
2. Add a narrow Electron cloud-auth client/IPC surface that reuses the existing Worker auth endpoints and stores secrets encrypted with `safeStorage`.
3. Update preload and desktop renderer bootstrap/login so Electron uses cloud auth when available, while retaining the current local/LAN flow as a rollback fallback when the cloud bridge is unavailable.
4. Wire a valid restored desktop cloud session into the existing replica agent so D1/R2 become the cloud source automatically without the manual PC↔Mobile pairing UI being required for the new path.
5. Run targeted tests, then the full project test suite. Do not merge or deploy.
