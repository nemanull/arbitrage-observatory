# server

The engine.
NestJS and TypeScript, running headless, with three HTTP routes that report and control the run.
Part of the root pnpm workspace, so `pnpm install` is run from the repository root.

Installation and configuration are in [SETUP.md](../SETUP.md).

```bash
cp .env.example .env
pnpm dev              # watch mode, http://localhost:3000
```

## Compiler

Builds use **tsgo** (`@typescript/native-preview`, the native Go TypeScript
compiler) instead of `tsc`.

| Script | What it does |
| --- | --- |
| `pnpm build` | `clean` + `tsgo -p tsconfig.build.json` |
| `pnpm dev` | `tsgo --watch` + `node --watch dist/main.js`, in parallel |
| `pnpm typecheck` | `tsgo --noEmit` |
| `pnpm start` | `node dist/main.js` |
| `pnpm build:tsc` | fallback build via `nest build` (classic tsc) |
| `pnpm start:dev` | fallback watch via `nest start --watch` (classic tsc) |

Notes:

- tsgo does emit `emitDecoratorMetadata`, which Nest's dependency injection requires.
  Verified by `__metadata("design:paramtypes", ...)` in the emitted output.
- Jest still compiles through `ts-jest` on the regular `typescript` package.
  tsgo is the build and watch path only.
- TypeScript 7 removed `baseUrl` and now requires an explicit `rootDir`, so both are set accordingly in the tsconfigs.

## Tests

```bash
pnpm test        # 30 suites, 389 tests, no Docker and no database needed
```

The jest script passes `--forceExit`, which is not cosmetic.
`app.module.spec.ts` compiles the real `AppModule`, and BullMQ dials Redis at whatever `REDIS_URL` holds the moment the queue is constructed.
The spec points it at an address that does not answer, and Nest's `close` returns before that dial gives up, so the event loop stays alive after the last assertion.
The queue and the worker are stubbed to keep the dial out of the way, and the flag covers what is left.
Removing it means the suite passes and then hangs.
