# Changelly PRO REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:23 to 04:57 UTC), from the development host near Seattle, through its Surfshark WireGuard exit in Canada.

This profile covers the public REST API v3 of Changelly PRO that a catalog, an anchor poller and a book resync would use, for its one perpetual family, USDT-M.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/changelly-pro/rest-probe.mjs), run from `server/`.
CCXT 4.5.68 has no Changelly PRO class, and the probe loads the catalog with CCXT's `hitbtc` class pointed at this host, see [`fees.md`](./fees.md) section 8.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.

## 1. Host and latency from this machine

| item | value |
|---|---|
| REST base | `https://api.pro.changelly.com/api/3`, S1 |
| resolved addresses | `104.26.6.176`, `104.26.7.176`, `172.67.69.12`, Cloudflare |
| Cloudflare edge | `colo=YVR`, `loc=CA`, `http=http/2`, `tls=TLSv1.3` from `/cdn-cgi/trace` |
| cold request | 481, 797 and 740 ms in three runs of `GET /public/symbol/BTCUSDT_PERP` |
| warm request | median 144 to 159 ms, max 145 to 167 ms, five requests in each run |
| refusals | none, every public call answered 200 or the documented error |

The host sits behind Cloudflare, and every reply carried `cf-cache-status: DYNAMIC`, so nothing is served from the edge cache.
These results are from the Canadian VPN exit that all traffic of this laptop leaves through.

## 2. Catalog

### The instruments call

`GET /api/3/public/symbol` returns every symbol as an object keyed by id, 74,580 bytes in 147 to 155 ms.

| type, contract type, status | count |
|---|---|
| `futures`, `perpetual`, `working` | 18, all quoted and settled in USDT |
| `futures`, `perpetual`, `expired` | 1, `LUNAUSDT_PERP` |
| `spot`, `working` | 328 |
| `spot`, `suspended` | 3 |

The 18 working perpetuals are `BTC`, `ETH`, `SOL`, `XRP`, `ADA`, `BNB`, `LTC`, `BCH`, `LINK`, `DOT`, `AVAX`, `TRX`, `UNI`, `AAVE`, `XLM`, `ZEC`, `SHIB` and `MANA`, each spelled `<underlying>USDT_PERP`.
A futures row has `base_currency` `null` and names its coin in `underlying`, S1.
The documented status values are `working`, `suspended` and `clearing`, and `expired` is not among them, S1.

### Changelly PRO is a front end of HitBTC

| check | result | probe |
|---|---|---|
| last five trades of `BTCUSDT_PERP`, `ETHUSDT_PERP`, `MANAUSDT_PERP` and spot `BTCUSDT` on both hosts | identical trade ids, prices and sizes on all four | P3 |
| top five levels per side of the same four books | identical, with the same `timestamp` to the millisecond | P3 |
| `open_interest` in `GET /public/futures/info` | equal on 18 of 18 perpetuals in both runs | P3 |
| `timestamp`, `index_price` and `mark_price` in the same call | the same `timestamp` on 18 of 18 rows, and equal index and mark on those 18, in the rerun | P3 |
| catalog | 350 symbols here against 1,228 on `api.hitbtc.com`, and 18 of HitBTC's 50 working perpetuals | P3 |

So each Changelly PRO perpetual is the HitBTC perpetual of the same id, one book and one matching engine.
If HitBTC ever joins the engine, Changelly PRO adds no second book, and a cross between the two is a comparison of a book with itself.
The fee rows differ: `take_rate` is `"0.0005"` here and `"0.0007"` on HitBTC, P3.

### How CCXT 4.5.68 maps it

`new ccxt.hitbtc({ id: 'changellypro', urls: { api: { public: 'https://api.pro.changelly.com/api/3', private: 'https://api.pro.changelly.com/api/3' } } })` loaded 350 markets in 570 and 1,557 ms, P1.

| field | value | CCXT source |
|---|---|---|
| swaps | 19, the 18 working and the expired one | `server/node_modules/ccxt/js/src/hitbtc.js` lines 817 to 824, `futures` without expiry is a swap |
| `market.id` | the catalog id on 19 of 19, `BTCUSDT_PERP`, the same spelling the socket and `futures/info` use | line 859 |
| `symbol` | `BTC/USDT:USDT`, with the base read from `underlying` | lines 826 and 845 |
| `linear` | true on all 19, settle `USDT` from `fee_currency` | lines 841 to 843 |
| `contractSize` | 1 on all 19 | line 840 |
| `active` | true on all 19, including the expired `LUNAUSDT_PERP` | line 873, a constant |
| pairs listed twice | none | P1 |

CCXT ignores `status`, and the connector keeps any swap whose `active` is not false at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 202.
So a registration needs a `marketFilter` of `m.info.status === 'working'`, or `LUNAUSDT_PERP` enters the catalog with an empty book and an anchor frozen in 2022.

### Size unit, pairs listed twice, and price scale

Sizes are underlying coins and CCXT's `contractSize` is 1, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice and no contract is quoted per 10 or per 1000 units.
`SHIBUSDT_PERP` is quoted per coin at a tick of 0.000000001 with a `quantity_increment` of 1000, so it needs no price scale.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /api/3/public/futures/info` | `index_price` | `mark_price` | `indicative_funding_rate` for the next settlement, `funding_rate` for the last | absent | `next_funding_time`, ISO 8601 | 6,561 to 6,581 bytes, 19 rows | three runs of 60 polls: min 140 to 141, median 142 to 144, p90 146 to 157, max 221 to 1,128 ms |
| `GET /api/3/public/futures/info/{symbol}` | same | | | | | 337 and 356 bytes, 1 row | 143 and 147 ms |
| `GET /api/3/public/futures/history/funding` | | | settled `funding_rate` per period | from consecutive `next_funding_time` | `next_funding_time` | 10,194 bytes at `limit=3` | 226 and 227 ms |

One call carries four of the five `AnchorRow` columns for every perpetual, keyed by the catalog id.
The fifth, the interval, is published nowhere, and it was 8 h on every row of 30 days of history, see section 4.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | object key | `BTCUSDT_PERP` | none |
| `index` | `index_price` | decimal string | `Number()` |
| `mark` | `mark_price` | decimal string, never 0 on 19 rows | `Number()` |
| `fundingRate` | `indicative_funding_rate` | decimal string, a fraction per 8 h: `"0.0001"` is 0.01 % | `Number()` |
| `fundingIntervalHours` | none | | the constant 8 |
| `nextFundingAt` | `next_funding_time` | ISO string, `"2026-09-23T08:00:00.000Z"` | `Date.parse()` |

`funding_rate` is the rate of the last settlement, not the next one.
The documentation says "Percent of the contract's mark value paid in the previous funding period" for `funding_rate`, and "Estimated percent of the contract's mark value to be paid after the end of the current funding period, calculated at the moment" for `indicative_funding_rate`, S1.
The wire agrees: `funding_rate` equalled the latest settled history row on 19 of 19 perpetuals, P1.
CCXT's `hitbtc` puts `funding_rate` in `fundingRate` and `indicative_funding_rate` in `nextFundingRate`, at `server/node_modules/ccxt/js/src/hitbtc.js` lines 3439 and 3442, so a CCXT reader would take the last settled rate for the next one.

The `timestamp` of every live row is the same and moves on a 3 s grid, so a reading is up to about 3 s old when it arrives, and a quiet contract's row can lag longer, section 4.

## 4. Anchor semantics

### Index

The documentation defines `index_price` as "Average underlying asset price.", S1, and the app's chart hint says "Average price of underlying assets on major exchanges.", S2.
The basket, its weights and its sources are Not publicly specified, and no basket call exists.
`GET /public/futures/candles/index_price/{symbol}` returns index history, S1, and was not probed.
Whether the basket includes HitBTC's own spot or perpetual is not known, which is the shape that produced false rows on binance, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).

### Mark

The documentation defines `mark_price` as "Recent asset price adjusted by the value of fair basis.", S1.
On the wire the mark is the index carried forward by the last settled rate over the time left to the next settlement:

```text
mark = index × (1 + funding_rate × (next_funding_time − timestamp) / 8 h), rounded to the tick
```

That form reproduced 18 of 18 live marks within half a tick with `funding_rate`, and none with `indicative_funding_rate`, P1.
At 04:36 and 04:54 UTC, 3.4 and 3.1 h before settlement, it put the mark 0 to 83 ppm above the index on the perpetuals with the default 0.0001 rate, 0 where the tick is coarser than the carry, and 412 and 353 ppm below it on `BCHUSDT_PERP`, whose last rate was −0.00094.

So the mark carries no price from the venue's own book.
Its premium over the index is at most the settled funding rate, which the floor in Funding below keeps within about 0.3 %.
The engine reads `freshPremium` as the touch over the mark at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 84, so every standing gap between this book and the index reads as fresh.
That is the same trap as a capped mark, since a standing basis of a thin book, as `BCHUSDT_PERP` has held for a month, would pass the fresh gate.

### Funding

| item | value | source |
|---|---|---|
| formula | rate = P + clamp(I − P, −0.0005, +0.0005), P the `avg_premium_index` of the period and I the `interest_rate` | inferred, 1,604 of 1,620 settled rows over 30 days, P1 |
| interest rate | `"0.0001"` per 8 h on every row | P1 |
| floor | the 16 rows the formula misses are `-0.003` on `BCHUSDT_PERP` (15) and `-0.0029` on `MANAUSDT_PERP` (1), each where the formula gave a lower number, so a per contract floor exists and is not published | P1 |
| cap | no row reached one, so it is Not verified | P1 |
| interval | 8 h at 00:00, 08:00 and 16:00 UTC, 1,602 of 1,602 gaps | P1 |
| published rate | `funding_rate` the last settled, `indicative_funding_rate` the next | section 3 |

### Rate across a settlement

The settlement instant was not captured.
History rows are stamped 2 to 32 ms after the hour, and each row's `next_funding_time` is 8 h after its own, P1.
Because the mark uses the last settled rate over the time left, the mark steps at each settlement from `index × (1 + old rate × about 0)` to `index × (1 + new rate)`, an inference from the formula above.

### How often each number changed

Over three runs of 60 polls one second apart, P2:

| field | changes in 59 intervals |
|---|---|
| `timestamp` | 20 or 21 on every perpetual, a 3 s grid, except `MANAUSDT_PERP` at 16 and 19 in two runs |
| `index_price` and `mark_price` | 1 to 20, always together, the fewest on `MANAUSDT_PERP` |
| `indicative_funding_rate` | 0, and 1 on `BCHUSDT_PERP` in each run |
| `premium_index` | 0 or 1 |
| `funding_rate`, `next_funding_time` | 0 |

Readings were 1,264 to 1,532 ms old on arrival at the median, by the row `timestamp`, P2.
The first run's oldest reading was 2,281 ms, and in the third run every row but `MANAUSDT_PERP` stayed at or under 2,629 ms.
`MANAUSDT_PERP` reached 5,523 ms in the third run, and one row reached 11,000 ms in the second, most likely `MANAUSDT_PERP`, whose `timestamp` moved 16 times against 21 on the others.
So a quiet contract's row can skip steps of the grid.
The socket channel `futures/info` pushes the same numbers every 3 s, arriving 66 to 72 ms after their `t` at the median over three runs, see [`websocket.md`](./websocket.md) section 2, so REST serves a copy up to one grid step old.
The reader refuses readings older than 10 s and index or mark moves over 1,000 ppm per poll at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 5 and 6, and a 3 s grid stays inside both.
The poller stamps a reading on arrival, so that 11 s old row would have passed as fresh.

## 5. REST book snapshot

| call | depth | levels on `BTCUSDT_PERP` | order | time |
|---|---|---|---|---|
| `GET /public/orderbook/{symbol}` | default 100 | 100 and 100 | bids descending, asks ascending | 146 ms |
| same | `depth=0`, the whole book | 294 and 296 bids, 183 and 187 asks | same | 143 and 147 ms |
| same | `depth=20` and `depth=5` | 20 and 5 | same | 142 ms |
| same | `volume=1` | 7 to 11 per side, depth ignored as documented | same | |
| `GET /public/orderbook?symbols=...&depth=20` | 20 | four books in one reply, 3,621 and 3,634 bytes | same | 144 ms |

The book's `timestamp` is the time of its last change, not of the reply.
Four reads over 1.3 s in the rerun carried the same `timestamp`, 1.9 to 3.2 s old, and no `cache-control` header was sent.
The REST book equalled the socket book on 40 of 40 levels while the socket was open, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| path | rate a second | burst | source |
|---|---|---|---|
| `/public/*` | 30 | 50 | S1 |
| default `/*` | 20 | 30 | S1 |
| `/ws/public` messages | 10 | 10 | S1 |

"If both limits in total are exceeded, an HTTP 429 response is returned.", counted per IP over a 1 s sliding window, S1.
No 429 was provoked, and no `Retry-After` or rate limit header appeared on any reply, so a 429's headers are Not verified.

| request | status | body |
|---|---|---|
| `/public/symbol/NOPE_PERP` | 400 | `{"error":{"code":2001,"message":"No such symbol: NOPE_PERP","description":"Try get /public/symbol, to get list of all available symbols."}}` with header `x-reason: SYMBOL_NOT_FOUND` |
| `/public/orderbook/BTCUSDT_PERP?depth=abc` | 400 | code `10001`, "Bad request parameter [depth]. Can't parse value from string: abc", `x-reason: VALIDATION_ERROR` |
| `/public/futures/info/BTCUSDT` | 400 | code `10001`, "Is not futures:BTCUSDT" |
| `/public/nope` | 404 | `{"status":404,"error":"Not Found","message":"No static resource api/3/public/nope."}` |

The error table in the documentation gives code `2002` for "Provided currency or symbol not found.", S1, and the wire sends `2001`.
Every error body also carries `timestamp`, `path` and `requestId`.

## 7. Server time and clock offset

No server time call exists, and `GET /public/time` returns 404.
The `Date` header has one second resolution and matched the local second on every read.
The best bound comes from the socket: `orderbook/full` frames arrived at least 65 to 72 ms after their `t`, and `futures/info` frames at least 65 to 70 ms after, against a warm REST round trip of 142 to 167 ms.
Half that round trip is 71 to 84 ms, so the clock offset is within about 20 ms, an inference.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.pro.changelly.com/api/3/public/futures/info` | one call carries index, mark, both rates and next settlement for every perpetual |
| interval | 1,000 ms, the default | median 142 to 144 ms and max 1,128 ms over 180 polls, 1 of the 30 a second budget, and the numbers move on a 3 s grid |
| row mapping | section 3, `fundingRate` from `indicative_funding_rate`, `fundingIntervalHours` the constant 8 | `funding_rate` is the last settled rate, and no interval field exists |
| skip | rows whose catalog `status` is not `working` | `LUNAUSDT_PERP` still has a row, stamped 2022-05-13 |
| rate limit pause | `rateLimitPauseMs` 1,000 | the window is 1 s and no `Retry-After` is documented |
| mark caveat | treat the mark as index plus funding carry, not as a book price | section 4, a standing basis reads as fresh |

The reply is 6.6 KB, about 570 MB a day at one hertz.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ChangellyPRO API Documentation, REST API Reference, Market Data, Rate Limits, Errors | https://api.pro.changelly.com/ | 2026-09-22 | Changelly PRO, global | endpoints, field definitions, status values, rate limits, error codes, sections 1 to 7 |
| S2 | App strings embedded in the app page | https://pro.changelly.com/fee-tier | 2026-09-22 | Changelly PRO | index chart hint, section 4 |
| S3 | CCXT 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/hitbtc.js` | 2026-09-22 | CCXT | market mapping and funding rate fields, sections 2 and 3 |
| P1 | `rest-probe.mjs main`, runs at 04:36, 04:38 and 04:54 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/changelly-pro/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs poll`, runs at 04:36, 04:54 and 04:55 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/changelly-pro/rest-probe.mjs) | 2026-09-22 | this host | reply time and change counts, sections 3 and 4 |
| P3 | `rest-probe.mjs mirror`, runs at 04:38 and 04:55 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/changelly-pro/rest-probe.mjs) | 2026-09-22 | this host | the HitBTC comparison, section 2 |
