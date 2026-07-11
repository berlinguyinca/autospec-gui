# autospec-gui

Next.js companion dashboard for viewing autospec telemetry stored in the configured Postgres database.

## Current state

This repository contains the initial read-only dashboard implementation and validation harnesses for the telemetry data layer. The design spec lives at:

- `docs/specs/2026-07-11-autospec-gui-telemetry-dashboard-design.md`

## Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and set `AUTOSPEC_TELEMETRY_DATABASE_URL` to a read-only Postgres connection string for the autospec telemetry database.

## Validation

Run the standard local validation suite with:

```bash
bash scripts/validate.sh
```

The standard suite includes type checking, unit-only source/shape tests, and the production build.

Run the real Postgres fixture integration harness with an explicit test database URL:

```bash
AUTOSPEC_TEST_DATABASE_URL=postgres://autospec_test:postgres@localhost:5432/autospec_test npm run test:integration:postgres
```

The integration harness creates and drops an isolated fixture schema in `AUTOSPEC_TEST_DATABASE_URL`, reads those fixtures through the server read-only Postgres adapter, and refuses to run fixture writes when the test URL equals `AUTOSPEC_TELEMETRY_DATABASE_URL`.
