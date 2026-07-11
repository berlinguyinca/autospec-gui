# AGENTS.md

## Purpose

Build a simple, read-only Next.js web application that displays autospec telemetry from the configured Postgres database.

## Engineering standards

- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- Use branch-per-issue: `feat/<slug>`. Never push implementation work directly to `main`.
- Keep the app read-only. Do not add database writes unless a future spec explicitly authorizes them.
- TDD is non-negotiable for non-doc changes.
- Do not mock Postgres behavior in integration or smoke tests. Use a real Postgres instance or clearly mark the test as unit-only.
- Keep issues small enough for autonomous implementers: focused files, explicit tests, and one primary smoke command.
- No new dependencies without a clear reason in the issue or spec.
- Never commit secrets. `.env*` files are ignored except `.env.example`.

## Next.js conventions

- Use the App Router under `app/`.
- Put server-only Postgres access behind server modules or route handlers. Do not expose connection strings to client components.
- Prefer server-rendered summaries for first-load dashboard data.
- Client components are only for interactions that need browser state, such as filters, date range controls, and chart hover states.

## Validation

Run before committing:

```bash
bash scripts/validate.sh
```

When implementation begins, extend validation with the project's test, lint, typecheck, and Playwright commands.
