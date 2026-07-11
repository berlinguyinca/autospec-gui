# autospec-gui

Next.js companion dashboard for viewing autospec telemetry stored in the configured Postgres database.

## Current state

This repository is intentionally scaffolded as a planning handoff. The initial design spec lives at:

- `docs/specs/2026-07-11-autospec-gui-telemetry-dashboard-design.md`

Autospec autonomous should decompose that spec into implementation issues and build the application from this baseline.

## Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and set `AUTOSPEC_TELEMETRY_DATABASE_URL` to a read-only Postgres connection string for the autospec telemetry database.
