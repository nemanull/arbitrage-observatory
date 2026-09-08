// Counts the active perpetual swap markets on every exchange ccxt knows with derivatives support, to size the universe a fifty venue observatory would stream.
// One JSON line per exchange as it finishes, so a partial run is still usable.
// Run from server/: node ../scripts/probes/perp-universe-survey.mjs > survey.jsonl
import { createRequire } from 'node:module';

// Package resolution follows the importing file, so the server's node_modules is named explicitly.
const ccxt = createRequire(new URL('../../server/package.json', import.meta.url))('ccxt');

const CONCURRENCY = 6;
const TIMEOUT_MS = 40_000;

const ids = ccxt.exchanges.filter((id) => {
  try {
    const ex = new ccxt[id]();
    return Boolean(ex.has.swap || ex.has.future);
  } catch {
    return false;
  }
});

async function survey(id) {
  const t0 = Date.now();
  try {
    const ex = new ccxt[id]({ timeout: TIMEOUT_MS, enableRateLimit: true });
    const markets = await ex.loadMarkets();
    const all = Object.values(markets);
    const swaps = all.filter((m) => m.swap && m.active !== false);
    const linear = swaps.filter((m) => m.linear).length;
    const settle = {};
    for (const m of swaps) settle[m.settle ?? m.quote] = (settle[m.settle ?? m.quote] ?? 0) + 1;
    const pro = ccxt.pro?.[id] ? new ccxt.pro[id]() : null;
    return {
      id,
      ok: true,
      ms: Date.now() - t0,
      markets: all.length,
      swaps: swaps.length,
      linear,
      inverse: swaps.length - linear,
      settle,
      wsOrderBook: Boolean(pro?.has?.watchOrderBook),
      wsOrderBookForSymbols: Boolean(pro?.has?.watchOrderBookForSymbols),
    };
  } catch (e) {
    return { id, ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 160) };
  }
}

const queue = [...ids];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const id = queue.shift();
      console.log(JSON.stringify(await survey(id)));
    }
  }),
);
process.exit(0);
