# server

NestJS API. Part of the root pnpm workspace — run `pnpm install` from the repo root.

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

- tsgo **does** emit `emitDecoratorMetadata`, which Nest's DI requires — verified
  by `__metadata("design:paramtypes", ...)` in the emitted output.
- Jest still compiles via `ts-jest` on the regular `typescript` package. tsgo is
  the build/watch path only.
- TypeScript 7 removed `baseUrl` and now requires an explicit `rootDir`, so both
  are set accordingly in the tsconfigs.
