# Gleec BTC REST Profile

**Status:** Done.

**Retrieved:** 2026-09-24, for the venue survey of 2026-09-22.

**Probed:** 2026-09-24 between 06:41 and 06:47 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API v3 of Gleec BTC at `https://api.exchange.gleec.com/api/3`, which is the HitBTC API v3 served for the Gleec brand.
Every probed value comes from [`rest-probe.mjs`](../../../scripts/probes/venues/gleec-btc/rest-probe.mjs) or from curl on the same morning, and the documented value is from the API documentation S1.
Access results are from the Canadian VPN exit, and no call was refused.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api.exchange.gleec.com` |
| resolved | Cloudflare, `104.26.4.199`, `104.26.5.199`, `172.67.74.34`, and IPv6 `2606:4700:20::681a:4c7` |
| edge | `cf-ray` suffix `YVR`, Vancouver |
| cold request | 635 ms, `GET /public/ticker/BTCUSDT_PERP` |
| warm requests | 140 to 184 ms |
| 60 bulk anchor calls | 138 ms minimum, 140 ms median, 279 ms maximum |

## 2. Catalog

### The instruments call

`GET /api/3/public/symbol` returns one object keyed by symbol id, 55,575 bytes in 141 ms.

| type | `contract_type` | `status` | quote | count |
|---|---|---|---|---:|
| `futures` | `perpetual` | `working` | USDT | 30 |
| `futures` | `perpetual` | `expired` | USDT | 1, `TONUSDT_PERP` |
| `spot` | | `working` | USDT, BTC, USDC and others | 206 |

A perpetual row, verbatim.

```json
{"MANAUSDT_PERP": {"type": "futures", "contract_type": "perpetual", "expiry": null, "underlying": "MANA", "base_currency": null, "quote_currency": "USDT", "status": "working", "quantity_increment": "1", "tick_size": "0.0001", "take_rate": "0.002", "make_rate": "0.001", "fee_currency": "USDT", "margin_trading": true, "max_initial_leverage": "50.00"}}
```

The 30 working perpetuals on 2026-09-24 were AAVE, ADA, APE, APT, ARB, ATOM, AVAX, BCH, BNB, BTC, DOT, ETH, FIL, FLOW, GMT, ICP, LINK, LTC, MANA, NEAR, OP, SAND, SHIB, SOL, TRUMP, TRX, UNI, XLM, XRP and ZEC, each against USDT.
`SHIBUSDT_PERP` is quoted per whole SHIB, with `tick_size` `"0.000000001"` and `quantity_increment` `"1000"`, so no per 1000 price scale is needed.

### How CCXT 4.5.68 maps it

CCXT has no Gleec class, see [`fees.md`](./fees.md) section 8.
The `hitbtc` class with `urls.api.public` set to `https://api.exchange.gleec.com/api/3` loads the catalog unchanged, 237 markets and 31 swaps, in `rest-probe.mjs catalog`.

| field | value | source |
|---|---|---|
| `market.id` | `BTCUSDT_PERP`, the socket and anchor spelling | `server/node_modules/ccxt/js/src/hitbtc.js` lines 810 to 880 |
| `symbol` | `BTC/USDT:USDT` | same |
| `base` | from `underlying`, since `base_currency` is null | line 826 |
| `contractSize` | 1 on every contract | line 840 |
| `linear` | true, since quote equals the fee currency | line 843 |
| `active` | true on all 31, including the expired `TONUSDT_PERP` | line 873 hardcodes `'active': true` |
| `taker`, `maker` | 0.002 and 0.001 | lines 877 and 878 |

The connector must filter on the raw `status` `working`, because CCXT's `active` flag does not.
No base is listed twice among the swaps.

### Size unit, pairs listed twice, and price scale

Sizes are base coins and `contractSize` 1 is right, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice, and no price scale is needed.

## 3. Anchor

### The bulk calls

| call | reply | time |
|---|---|---|
| `GET /api/3/public/futures/info` | every perpetual, 31 rows, 10,674 bytes | 141 ms, and 138 to 279 ms over 60 polls |
| `GET /api/3/public/futures/info/{symbol}` | one row, 337 bytes | 139 ms |
| `GET /api/3/public/futures/history/funding?limit=1` | the last settlement of every perpetual, 5,867 bytes | 480 ms |

One call carries index, mark, the rate and the next settlement for every perpetual.

```json
{"BTCUSDT_PERP": {"contract_type": "perpetual", "mark_price": "84174.91", "index_price": "84173.60", "funding_rate": "0.0001", "open_interest": "12.2389", "next_funding_time": "2026-09-24T08:00:00.000Z", "indicative_funding_rate": "0.0001", "premium_index": "0", "avg_premium_index": "0.000006245602257389", "interest_rate": "0.0001", "timestamp": "2026-09-24T06:45:28.632Z"}}
```

### Row mapping

| `AnchorRow` column | field | note |
|---|---|---|
| `index` | `index_price` | string |
| `mark` | `mark_price` | string |
| `fundingRate` | `funding_rate`, fraction per period | which settlement it applies to is Not verified, see section 4 |
| `fundingIntervalHours` | not in the reply, 8 | from the funding history, 8 h apart on every row read |
| `nextFundingAt` | `Date.parse(next_funding_time)` | ISO string, 2026-09-24T08:00:00.000Z on all 30 working perpetuals |

## 4. Anchor semantics

### Index

S1 says "Average underlying asset price".
The basket, its sources and weights are Not publicly specified, and no basket call exists among the public paths of S1.
`GET /api/3/public/futures/candles/index_price` exists for history.

### Mark

S1 says "Recent asset price adjusted by the value of fair basis".
On 2026-09-24 at 06:45 UTC `mark_price` equalled `index_price` on 19 of 31 contracts, and `premium_index` was `"0"` on 29 of 31.
The second pass at 06:52 UTC read 19 and 30.
On `BTCUSDT_PERP` the mark sat 1.31 USDT, about 16 ppm, above the index.
So the mark is the index plus a small basis, not the perpetual's own price, and no clamp was documented or seen.

### Funding

The rate follows `funding_rate = avg_premium_index + clamp(interest_rate − avg_premium_index, −0.0005, +0.0005)` on 30 of 30 working perpetuals, to 12 decimal places.
This is derived from the reply fields, and S1 does not write the formula.
`interest_rate` is 0.0001 on every perpetual.
`indicative_funding_rate` followed the same formula from `premium_index` on 26 of 30 working rows.
The rates on 2026-09-24 ranged from `-0.001355` to `0.0001`.

### Rate across a settlement

The two definitions of `funding_rate` in S1 disagree.
The bulk call calls it "Percent of the contract's mark value paid in the previous funding period", and the single contract call calls it "Percentage of contract mark value paid after the end of current funding interval".
`avg_premium_index` is documented as covering "the previous funding period" and is the input of `funding_rate`, so the rate is fixed when a period ends.
The history row stamped 2026-09-24T00:00:00.003Z carries `funding_rate` `0.0001` and `next_funding_time` 08:00, and the live row showed the same rate before 08:00.
Whether that rate was charged at 00:00 or will be charged at 08:00 needs a position to see, and it is Not verified.
The settlement instant itself was not captured.

### How often each number changed

Over 60 one second polls of `futures/info`, from 06:46 UTC on 2026-09-24.

| contract | reply `timestamp` changed | mark changed | index changed | largest one poll move |
|---|---:|---:|---:|---|
| `BTCUSDT_PERP` | 19 of 59 | 18 | 18 | 276 ppm |
| `ETHUSDT_PERP` | 19 | 18 | 18 | 333 ppm |
| `SOLUSDT_PERP` | 19 | 19 | 19 | 485 to 486 ppm |
| `MANAUSDT_PERP` | 11 | 2 | 2 | 2,375 ppm |

The reply is republished about every 3 s, and the reply `timestamp` was 1,270 ms old at receipt in one read.
`funding_rate` did not change, and `indicative_funding_rate` changed once on MANA.
`MANAUSDT_PERP` has a tick of 0.0001 on a price near 0.084, so one tick is about 1,190 ppm, and a single tick move trips the engine's 1,000 ppm per poll guard of design section 4.

## 5. REST book snapshot

`GET /api/3/public/orderbook/{symbol}?depth=N`, default depth 100 and 0 for every level, S1.

| contract | bids | asks | order | time |
|---|---:|---:|---|---|
| `BTCUSDT_PERP`, depth 0 | 356 | 184 | bids descending, asks ascending | 142 ms |
| `ETHUSDT_PERP`, depth 0 | 167 | 184 | same | 139 ms |
| `MANAUSDT_PERP`, depth 0 | 135 | 133 | same | 141 ms |
| `BTCUSDT_PERP`, depth 20 | 20 | 20 | same | |

`cf-cache-status` was `DYNAMIC`, so Cloudflare did not cache the book.
The book is thin: the best bid of `BTCUSDT_PERP` held 0.0112 BTC, about 940 USDT, with a spread near 27 USDT, about 320 ppm.

## 6. Rate limits and errors

| path | rate limit | burst | per |
|---|---:|---:|---|
| `/public/*` | 30 per second | 50 | IP, S1 |
| default `/*` | 20 | 30 | IP, S1 |
| `/ws/public` messages | 10 | 10 | IP, S1 |

Exceeding both gives HTTP 429, S1.
No reply carried a rate limit header, and `Retry-After` is not documented.
The limit was not provoked.

| request | status | body |
|---|---|---|
| `/public/futures/info/NOPE_PERP` | 400 | `{"timestamp":"2026-09-24T06:45:31.336Z","error":{"description":"Try get /public/symbol, to get list of all available symbols.","code":2001,"message":"No such symbol: NOPE_PERP"},"path":"/api/3/public/futures/info/NOPE_PERP","requestId":"14c1574f-35522594"}` |
| `/public/orderbook/NOPE_PERP` | 400 | same shape, code 2001 |
| `/public/nope` | 404 | a Spring style body, `"error":"Not Found"`, `"message":"No static resource api/3/public/nope."` |
| `/public/futures/info/TONUSDT_PERP`, expired | 200 | a frozen row with `timestamp` and `next_funding_time` at 2026-06-15T16:00 |

## 7. Server time and clock offset

S1 lists no server time call.
The HTTP `Date` header has one second resolution.
Error bodies carry a millisecond `timestamp`, and the clock offset was not measured with it, so the offset is Not verified.

## 8. Recommended poller shape

- Catalog: CCXT `hitbtc` with `urls.api.public` and `urls.api.private` set to `https://api.exchange.gleec.com/api/3`, filtered to `type` `futures`, `contract_type` `perpetual` and raw `status` `working`.
  This is the named change the engine needs, since no Gleec class exists.
- URL: `GET https://api.exchange.gleec.com/api/3/public/futures/info`, one call per round.
- Interval: 1 s is within the 30 per second public limit, although the reply changes only about every 3 s.
- Mapping: section 3, with `fundingIntervalHours` fixed at 8.
- Skip: any id whose catalog `status` is not `working`, and any row whose `next_funding_time` is in the past.
- On 429, pause one second, since the limit window is one second, S1.
- The `futures/info` WebSocket channel carries the same fields and could replace the poll, see [`websocket.md`](./websocket.md) section 2.

## 9. Source ledger

| id | source | read |
|---|---|---|
| S1 | API documentation, `https://api.exchange.gleec.com/`, sections "Rate Limits", "HTTP Status Codes", "Symbols", "Order Books", "Futures Info" and "Funding History" | 2026-09-24, curl, HTTP 200 |
| S2 | [`rest-probe.mjs`](../../../scripts/probes/venues/gleec-btc/rest-probe.mjs) modes `all` and `poll` | 2026-09-24 |
| S3 | `server/node_modules/ccxt/js/src/hitbtc.js` lines 810 to 880, CCXT 4.5.68 | 2026-09-24 |
| S4 | [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md), section "What the engine needs from a venue" | 2026-09-24 |
