# Mandala Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:45 to 06:55 UTC by the host clock (evening of 2026-09-23 in Seattle), from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API v3 of Mandala Exchange for its USDT-M perpetuals.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/mandala/rest-probe.mjs), and every documented value from the API v3 reference at `https://api.trade.mandala.exchange/` (S1).
The API is the HitBTC API v3 in shape, see [`fees.md`](./fees.md) section 8.
All access results are from the Canadian VPN exit.

## 1. Host and latency from this machine

- `api.trade.mandala.exchange` resolved to `104.26.10.95`, `104.26.11.95` and `172.67.73.75`, which are Cloudflare addresses.
  Every reply carried `server: cloudflare` and a `cf-ray` ending in `-YVR`, the Vancouver edge.
- `/api/3/public/symbol`, 93,393 bytes, took 1,138 ms on a first curl, 1,184 ms in the first probe run and 210 ms in the second.
- `/api/3/public/futures/info`, 8,280 to 8,300 bytes, took 137 to 146 ms cold and warm across two runs, and 139 to 854 ms with a median of 140 ms over 60 one second polls (probe `poll`).
- `/api/3/public/orderbook/BTCUSDT_PERP?depth=20` took 146 ms.
- No public call was refused.
  The help center host `support.mandala.exchange` answered 403 "Edge IP Restricted", see [`fees.md`](./fees.md) section 1.

## 2. Catalog

- Call: `GET /api/3/public/symbol`, one object keyed by symbol code (S1).
- Status values: `status` is `working` on all 426 symbols returned.
  S1 describes no other value in the fields read, so a suspended contract was not observed.
- Active perpetuals: 24, all `type` `futures`, `contract_type` `perpetual`, `quote_currency` and `fee_currency` USDT, `expiry` null.
  They are ADA, AAVE, LINK, XLM, SAND, SOL, UNI, BTC, DOT, GMT, AVAX, MANA, LTC, APE, ATOM, BCH, ZEC, ETH, XRP, FIL, BNB, SHIB, TRUMP and TRX, each as `<BASE>USDT_PERP`.
  A perpetual has `base_currency` null and names its base in `underlying`.
- CCXT: no Mandala class exists in CCXT 4.5.68 or in the current CCXT master, see [`fees.md`](./fees.md) section 8.
  `ccxt.hitbtc` with `urls.api` set to `https://api.trade.mandala.exchange/api/3` loads 426 markets and 24 active swaps in 1,350 ms, and 523 ms in the second run.
  - `market.id` is `BTCUSDT_PERP`, the same code the socket, `futures/info` and the book use, 24 of 24.
  - `symbol` is `BTC/USDT:USDT`, `base` comes from `underlying` at `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hitbtc.js` line 826.
  - `contractSize` is 1 on every swap, hardcoded at line 840, and the book size unit is base currency, see [`websocket.md`](./websocket.md) section 4.
  - `linear` is true, since quote equals settle, at line 843.
  - `active` is hardcoded true at line 873, so a halted contract would still read active.
  - No base is listed twice.
- Liquidity context, from `GET /api/3/public/ticker` at 06:51 UTC: 24 hour quote volume summed to 21.46 M USDT across the 24 perpetuals, led by SOL at 6.19 M and BTC at 4.58 M.
  Six contracts (SAND, GMT, APE, ATOM, TRUMP, and ZEC at 16 USDT) traded nothing or almost nothing.
  The touch spread was 241 ppm on BTC (380 ppm in the rerun at 06:54), 978 ppm on BNB and 1,746 to 2,928 ppm on most others, with ATOM at 108,441 ppm.

## 3. Anchor

One call returns every column for every perpetual.

- Call: `GET /api/3/public/futures/info`, no parameters, 24 rows, 8,280 to 8,300 bytes, about 140 ms.
- Row mapping for `AnchorRow`:

| column | field | note |
|---|---|---|
| key | object key, `BTCUSDT_PERP` | equals `market.id` |
| `index` | `index_price` | string |
| `mark` | `mark_price` | string |
| `fundingRate` | `indicative_funding_rate` | the rate for the upcoming settlement, a fraction on the wire |
| `fundingIntervalHours` | not in the reply, 8 | from the funding history, 8 h gaps |
| `nextFundingAt` | `next_funding_time`, ISO 8601 | `2026-09-24T08:00:00.000Z` on all 24 |

- A captured row:

```json
{"contract_type":"perpetual","mark_price":"84173.66","index_price":"84172.35","funding_rate":"0.0001","open_interest":"12.2389","next_funding_time":"2026-09-24T08:00:00.000Z","indicative_funding_rate":"0.0001","premium_index":"0","avg_premium_index":"0.000006245602257389","interest_rate":"0.0001","timestamp":"2026-09-24T06:45:25.633Z"}
```

- Funding history: `GET /api/3/public/futures/history/funding?symbols=BTCUSDT_PERP,ETHUSDT_PERP&limit=6` returned six settlements per contract, newest `2026-09-24T00:00:00.003Z` for BTC, spaced 8.000 hours apart.

## 4. Anchor semantics

- Index: "Average underlying asset price" (S1).
  The basket and its weights are not published, and no basket call exists in S1.
  Not verified.
- Mark: "Recent asset price adjusted by the value of fair basis" (S1).
  No clamp is published.
  On BTC the mark sat exactly 1.21 USDT, 14.4 ppm, above the index on ten consecutive readings at 06:50, and 1.15 USDT, 13.7 ppm, on ten more at 06:54, while `premium_index` read 0, so the fair basis looks like a slow term that does not follow the perp's own book.
- Funding: `funding_rate` is the rate "paid in the previous funding period", and `indicative_funding_rate` is the estimate for the end of the current one (S1).
  The upcoming rate is therefore `indicative_funding_rate`.
  The formula uses `premium_index`, `avg_premium_index` and `interest_rate` (0.0001 per period on every contract), and no cap or floor is published.
  MANA showed `funding_rate` 0.0001 and `indicative_funding_rate` -0.000264, so the two fields do diverge.
- Republish cadence: mark and index change together on a 3 s grid.
  Ten polls showed the BTC `timestamp` stepping 06:50:52.632, 06:50:55.632, 06:50:58.633 and 06:51:01.634.
  Over 60 one second polls, BTC, ETH, ZEC, BNB and TRX changed mark and index 20 times each, the median contract 16 times, and GMT and MANA once.
  `funding_rate` and `next_funding_time` never changed, and `indicative_funding_rate` changed on three contracts.
  The engine's reader tolerates a 10 s old reading, so a 3 s grid passes, but a one second poll sees the same value three times.
- The settlement instant itself was not captured.

## 5. REST book snapshot

- Call: `GET /api/3/public/orderbook/{symbol}?depth=20`, where `depth` defaults to 10 and 0 returns the whole book (S1).
- Probed on BTC: 20 bids descending and 20 asks ascending, 936 bytes, 146 ms.
  `depth=0` returned 354 bids and 183 asks in 11,962 bytes, and 352 and 183 in the second run.
- The reply `timestamp` was 1,317 ms and 641 ms old on arrival in the two runs, and a second call right after returned the same `timestamp`, so the book is served from a snapshot that is not rebuilt per request.
  `cf-cache-status` was `DYNAMIC`, so Cloudflare does not cache it.
- The feed does not need this call, since `orderbook/full` sends its own snapshot.

## 6. Rate limits and errors

- Limits per IP (S1): `/public/*` has a rate limit of 30 and a burst limit of 50 in a 1 second sliding window, and the default for other paths is 20 and 30.
  Exceeding both returns HTTP 429 (S1).
  No `Retry-After` or rate limit header appeared on any reply, and no 429 was provoked.
- Documented status codes (S1): 400 with a JSON error, 403 forbidden, 429 rate limited, 503 maintenance.
- Unknown symbol on a path: HTTP 400 with code 2001.

```json
{"timestamp":"2026-09-24T06:45:28.838Z","error":{"description":"Try get /public/symbol, to get list of all available symbols.","code":2001,"message":"No such symbol: NOPEUSDT_PERP"},"path":"/api/3/public/futures/info/NOPEUSDT_PERP"}
```

- Unknown symbol in the `symbols` filter of `futures/info`: HTTP 200 with `{}`.

## 7. Server time

S1 documents no server time call.
The `Date` header agreed with the host clock to the second on five calls, and the socket's `t` values agreed with the host clock within the 127 ms median frame age, see [`websocket.md`](./websocket.md) section 3.
The clock offset is below one second and was not measured more finely.

## 8. Recommended poller shape

- URL: `GET https://api.trade.mandala.exchange/api/3/public/futures/info`, one call per tick.
- Interval: 1 s is allowed by the 30 per second public limit, and 3 s matches the venue's republish grid.
  Keep 1 s so that a fresh reading lands within a second of its publication.
- Row mapping: `index_price` to `index`, `mark_price` to `mark`, `indicative_funding_rate` to `fundingRate`, 8 to `fundingIntervalHours`, `Date.parse(next_funding_time)` to `nextFundingAt`.
- Skip rows whose key is not a tracked `market.id` and rows with `contract_type` other than `perpetual`.
- Flag: the index basket and the mark clamp are unpublished, so the self-index and capped-mark checks of the design cannot be done from documents.

## 9. Source ledger

- S1: Mandala Exchange API v3 reference, `https://api.trade.mandala.exchange/`, sections "Rate limits", "Market data", "Futures information", "Funding history", "Order book", "HTTP status codes", fetched with HTTP 200 on 2026-09-24.
- CCXT: `node_modules/.pnpm/ccxt@4.5.68_protobufjs@7.6.6/node_modules/ccxt/js/src/hitbtc.js` lines 826, 840, 843 and 873, version 4.5.68.
- Probes: [`rest-probe.mjs`](../../../scripts/probes/venues/mandala/rest-probe.mjs) modes `catalog`, `anchor`, `poll`, `book` and `errors`, and `grid`, where `grid` holds the ticker volumes of section 2 and the ten `futures/info` readings of section 4.
