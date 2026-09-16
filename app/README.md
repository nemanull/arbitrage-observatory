# app

Placeholder frontend.

This package is an unmodified Vite React starter and has not been developed.
It reserves the workspace slot for a read-only view of stored episodes, which is not currently scheduled.
Nothing in the engine depends on it, and no module here reads the server.

The engine runs headless and writes to Postgres, so stored data is read through Prisma Studio, `psql` or SigNoz.
See [README.md](../README.md) for the project and [SETUP.md](../SETUP.md) for the commands.

```bash
cp .env.example .env
pnpm dev              # http://localhost:5173
```
