// SafeTrade documentation probe: the fee rows and market catalog the SafeTrade web app embedded in pages the Internet Archive captured, CoinGecko's listing, and whether current CCXT master has a SafeTrade class.
// Public, unauthenticated, read-only. It never contacts SafeTrade itself, which refuses this host, see rest-probe.mjs.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/safetrade/archive-probe.mjs [wayback|coingecko|ccxt-master]
//   wayback      decodes the Nuxt payload of the 2026-09-07 home page and the 2025-08-10 fees page captures and prints trading_fees, market states, quotes and pair names. About 10 s.
//   coingecko    one call each to the CoinGecko exchange record and the derivatives exchange list.
//   ccxt-master  asks raw.githubusercontent.com for ts/src/safetrade.ts on CCXT master.
// Recorded in docs/profiles/safetrade/fees.md and rest.md.

const SNAPSHOTS = [
  { name: 'home', url: 'http://web.archive.org/web/20260907111823id_/https://safetrade.com/' },
  { name: 'fees', url: 'http://web.archive.org/web/20250810125249id_/https://safetrade.com/fees' },
];
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

// Nuxt serialises its state with devalue, a flat array where objects hold indices into the array.
function decodeNuxt(html) {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return undefined;
  const a = JSON.parse(m[1]);
  const wrappers = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef', 'Set', 'Map', 'Date', 'NuxtError', 'Error', 'Object']);
  const memo = new Map();
  const rev = (i) => {
    if (typeof i !== 'number' || i < 0) return undefined;
    if (memo.has(i)) return memo.get(i);
    const v = a[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string' && wrappers.has(v[0])) {
        const r = rev(v[1]);
        memo.set(i, r);
        return r;
      }
      const out = [];
      memo.set(i, out);
      for (const x of v) out.push(rev(x));
      return out;
    }
    if (v && typeof v === 'object') {
      const o = {};
      memo.set(i, o);
      for (const k in v) o[k] = rev(v[k]);
      return o;
    }
    return v;
  };
  return rev(0);
}

async function wayback() {
  for (const snap of SNAPSHOTS) {
    const t0 = performance.now();
    const res = await fetch(snap.url, { signal: AbortSignal.timeout(90_000) });
    const html = await res.text();
    const state = decodeNuxt(html)?.pinia?.public;
    log('snapshot', { name: snap.name, url: snap.url, status: res.status, bytes: html.length, ms: Math.round(performance.now() - t0), hasState: Boolean(state) });
    if (!state) continue;

    log('trading_fees', { name: snap.name, rows: state.trading_fees });

    const markets = state.markets ?? [];
    const states = {};
    const enabledByQuote = {};
    for (const m of markets) {
      states[m.state] = (states[m.state] ?? 0) + 1;
      if (m.state === 'enabled') enabledByQuote[m.quote_unit] = (enabledByQuote[m.quote_unit] ?? 0) + 1;
    }
    const derivativeLike = markets.filter((m) => /perp|swap|future|margin/i.test(`${m.id} ${m.name} ${m.type ?? ''}`)).map((m) => m.id);
    const keys = [...new Set(markets.flatMap((m) => Object.keys(m)))].filter((k) => !k.endsWith('_currency'));
    log('markets', { name: snap.name, total: markets.length, states, enabledByQuote, derivativeLike, marketKeys: keys });

    const btc = markets.find((m) => m.id === 'btcusdt');
    if (btc) {
      const { base_currency: _b, quote_currency: _q, ...flat } = btc;
      log('market_example', { name: snap.name, market: flat });
    }

    const stable = ['usdt', 'usdc', 'dai'];
    const byBase = {};
    for (const m of markets.filter((x) => x.state === 'enabled' && stable.includes(x.quote_unit))) (byBase[m.base_unit] ??= []).push(m.id);
    log('stable_quote_family', { name: snap.name, bases: Object.keys(byBase).length, listedTwice: Object.fromEntries(Object.entries(byBase).filter(([, v]) => v.length > 1)) });

    const tickers = state.tickers ?? {};
    const first = Object.values(tickers)[0];
    if (first) {
      const { market: _m, ...flat } = first;
      log('ticker_example', { name: snap.name, count: Object.keys(tickers).length, keys: Object.keys(flat), ticker: flat });
    }
  }
}

async function coingecko() {
  const ex = await fetch('https://api.coingecko.com/api/v3/exchanges/safe_trade', { signal: AbortSignal.timeout(30_000) });
  const j = await ex.json();
  if (!ex.ok) {
    log('coingecko_exchange', { status: ex.status, body: JSON.stringify(j).slice(0, 200) });
  } else {
    const tickers = j.tickers ?? [];
    const byTarget = {};
    for (const t of tickers) byTarget[t.target] = (byTarget[t.target] ?? 0) + 1;
    const top = tickers
      .map((t) => ({ pair: `${t.base}/${t.target}`, usd: Math.round(t.converted_volume?.usd ?? 0), spreadPct: Number((t.bid_ask_spread_percentage ?? 0).toFixed(2)) }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 8);
    log('coingecko_exchange', {
      status: ex.status,
      name: j.name,
      country: j.country,
      year: j.year_established,
      url: j.url,
      trustScore: j.trust_score,
      trustScoreRank: j.trust_score_rank,
      coins: j.coins,
      pairs: j.pairs,
      volume24hBtc: j.trade_volume_24h_btc,
      tickers: tickers.length,
      byTarget,
      tradeUrl: tickers[0]?.trade_url,
      top,
    });
  }

  await new Promise((r) => setTimeout(r, 3_000));
  const dv = await fetch('https://api.coingecko.com/api/v3/derivatives/exchanges/list', { signal: AbortSignal.timeout(30_000) });
  const list = await dv.json();
  log('coingecko_derivatives', { status: dv.status, count: Array.isArray(list) ? list.length : undefined, safetrade: Array.isArray(list) ? list.filter((e) => /safe/i.test(`${e.id} ${e.name}`)) : JSON.stringify(list).slice(0, 200) });
}

async function ccxtMaster() {
  for (const f of ['safetrade.ts', 'pro/safetrade.ts']) {
    const res = await fetch(`https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/${f}`, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
    log('ccxt_master', { file: `ts/src/${f}`, status: res.status });
  }
}

const mode = process.argv[2] ?? 'wayback';
if (mode === 'wayback') await wayback();
else if (mode === 'coingecko') await coingecko();
else if (mode === 'ccxt-master') await ccxtMaster();
else console.error(`unknown mode ${mode}`);
