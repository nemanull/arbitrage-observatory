# HitBTC REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:10 to 04:13 UTC and again 04:24 to 04:26 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocates to Canada.

This profile covers the public REST API v3 of HitBTC (CCXT id `hitbtc`) for its one perpetual family, the USDT-margined `*USDT_PERP` contracts.
Every number was produced by [`rest-probe.mjs`](../../../scripts/probes/venues/hitbtc/rest-probe.mjs) unless a source row or a CCXT line is named.
Two numbers separated by "and" are the first run and the second run.
The access results are from the Canadian VPN exit, and the API served every call while the website refused the same exit, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| item | value |
|---|---|
| REST base | `https://api.hitbtc.com/api/3`, S1 "API URLs" |
| resolved addresses | `104.26.3.240`, `104.26.2.240`, `172.67.73.73`, Cloudflare, in both runs |
| edge | `cf-ray` suffix YVR on every REST reply of both runs, SEA on the WebSocket upgrade |
| cold request | 735.6 and 944.3 ms, the first `GET /public/futures/info/BTCUSDT_PERP` of a process |
| warm request | 142.6 to 148.8 ms, median 144.3, and 140.5 to 144.7 ms, median 143.8, five requests each |
| cache | `cf-cache-status: DYNAMIC` on every reply, so Cloudflare does not cache the API |
| refusals | none on any public call |

## 2. Catalog

### The instruments call

`GET /public/symbol` returns every market as one object keyed by symbol, 1,228 rows and 264,615 bytes, in 449.8 and 1,335.7 ms.

| `type` | `contract_type` | `status` | rows |
|---|---|---|---:|
| `futures` | `perpetual` | `working` | 50 |
| `futures` | `perpetual` | `suspended` | 4 |
| `futures` | `perpetual` | `expired` | 1 |
| `spot` | | `working` | 1,170 |
| `spot` | | `suspended` | 3 |

The documented status values are `working`, `suspended` and `clearing`, S1 "Get Symbols", and the wire adds `expired` on `TONUSDT_PERP`.
Every futures row has `quote_currency` and `fee_currency` `USDT`, `base_currency` null, the coin in `underlying`, `expiry` null, and `take_rate` `0.0007` with `make_rate` `0.0002`.
A futures row looks like this.

```json
{"AAVEUSDT_PERP": {"type": "futures", "contract_type": "perpetual", "expiry": null, "underlying": "AAVE", "base_currency": null, "quote_currency": "USDT", "status": "working", "quantity_increment": "0.01", "tick_size": "0.001", "take_rate": "0.0007", "make_rate": "0.0002", "fee_currency": "USDT", "margin_trading": true, "max_initial_leverage": "50.00"}}
```

The active perpetual count by settlement asset is 50 in USDT and 0 in any other asset.

### How CCXT 4.5.68 maps it

| item | CCXT | wire | evidence |
|---|---|---|---|
| `market.id` | `BTCUSDT_PERP` | the key of `/public/symbol`, of `/public/futures/info` and of every socket frame | 55 of 55 swap ids are keys of the futures info reply, `rest-probe.mjs catalog` |
| `symbol` | `BTC/USDT:USDT` | | `server/node_modules/ccxt/js/src/hitbtc.js` lines 834 and 845 |
| `base` | from `underlying`, since `base_currency` is null on a contract | `underlying` | line 826 |
| `swap` | true when `type` is `futures` and `expiry` is null | | lines 819 and 824 |
| `linear` | true on all 55 | quote equals settle | line 843 |
| `contractSize` | 1 on every contract | sizes are in the base coin, see [`websocket.md`](./websocket.md) section 4 | line 840 |
| `active` | true on all 55, including the 5 that are not `working` | `status` | hard-coded at line 873 |
| `taker` | `0.0007` | `take_rate` | line 877 |

`active` is the defect that matters.
The connector keeps active swaps, at `server/src/ccxt/connector.ts` line 79, so it would load `PEPEUSDT_PERP`, `TONCOINUSDT_PERP`, `100PEPEUSDT_PERP`, `SUSDT_PERP` and the expired `TONUSDT_PERP` as tradable.
Their books are empty and their anchor rows carry a mark of 0 or a next settlement in the past, see section 3.
A `marketFilter` of `(m) => m.info.status === 'working'` in the registry removes them, at `server/src/ccxt/types.ts` lines 14 to 16.

### Size unit, pairs listed twice, and price scale

No pair is listed twice among the 55 swaps.
`contractSize` 1 matches the book's base coin sizes, so no pin is needed.
The one scaled contract, `100PEPEUSDT_PERP`, is suspended, so no working contract needs a price scale.
`CELUSDT_PERP` is `working` with an empty book and a frozen anchor row, see sections 3 and 4.
29 of the 50 working contracts reported a 24 h quote volume of 0 in `/public/ticker`, and the five busiest were `SOLUSDT_PERP` at 7.1 million USDT, `BTCUSDT_PERP` at 4.4 and 4.5 million, `BCHUSDT_PERP` at 2.3 million, `ETHUSDT_PERP` at 1.2 million and `LTCUSDT_PERP` at 1.1 million, out of 21.0 and 21.1 million over all 50, `rest-probe.mjs book`.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /public/futures/info` | `index_price` | `mark_price` | `funding_rate` | absent | `next_funding_time`, ISO 8601 | 18,775 to 18,816 bytes, 55 rows | 60 polls: min 141.2, median 144.3, p90 148.4, max 212.3 ms, and min 142.2, median 144.1, p90 146.4, max 157.3 ms, none over 1 s |

One call carries index, mark, rate and next settlement for every contract, keyed by `market.id`.
The interval is not a field, and every contract settles every 8 h, see section 4.
The reply also carries `indicative_funding_rate`, `premium_index`, `avg_premium_index`, `interest_rate`, `open_interest` and a `timestamp`.
`?symbols=` narrows the reply, and an unknown symbol there returns `{}` with 200.
The `futures/info` socket channel carries the same fields on the same 3 s cadence, see [`websocket.md`](./websocket.md) section 2.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the object key | string, `BTCUSDT_PERP` | none |
| `index` | `index_price` | decimal string | `Number()` |
| `mark` | `mark_price` | decimal string, `"0"` on four non-working rows | `Number()` |
| `fundingRate` | `funding_rate` | decimal string, a fraction per 8 h: `"0.0001"` is 0.01 % | `Number()` |
| `fundingIntervalHours` | none | | the constant 8 |
| `nextFundingAt` | `next_funding_time` | ISO 8601, `"2026-09-23T08:00:00.000Z"` | `Date.parse()` |

On 2026-09-23 all 50 working contracts read `next_funding_time` 08:00 UTC.
The five that are not working read `2026-06-15T16:00:00.000Z` (`TONUSDT_PERP`, mark 1.8035), `2024-05-09T16:00:00.000Z` (`TONCOINUSDT_PERP`, mark 0), and `1970-01-01T00:00:00.000Z` with mark 0 (`PEPEUSDT_PERP`, `100PEPEUSDT_PERP`, `SUSDT_PERP`).

## 4. Anchor semantics

### Index

"This stability relies on the average price calculated among the following markets: HitBTC, Binance, Coinbase, Bitfinex, Huobi, OKEx, Kraken", using "the last trade price acquired from the platform L1 market data", S2.
"Prices gathered from the platforms are taken into account only if they do not deviate from the median by more than 5%.", S2.
"Weights of providers may be distributed unevenly due to specific configuration or if some providers are idle or provide false data.", S2.
No basket or weight call is public, and the index candle calls return prices only, S1.

Two contracts do not behave like a seven venue basket.
`HITUSDT_PERP`'s index read `0.2589` while HitBTC's own spot `HITUSDT` last read `0.2589`, at 04:11:40 and 04:11:52 UTC, and it moved 0 and 1 times in 60 polls.
So the HIT index is HitBTC's own spot last trade, which is a self-venue index on the spot market, not on the perpetual.
`CELUSDT_PERP`'s row `timestamp` reached 59.3 s of age in both runs, so that row is refreshed about once a minute rather than every 3 s.
Its index read `0.0060` in every read taken, HitBTC spot `CELUSDT` last read `0.002115`, and its perpetual book was empty.
`GMTUSDT_PERP` and `MANAUSDT_PERP` also reached a `timestamp` age of 8.3 and 9.8 s in the second run.

### Mark

"Pm = Pi + Bfair" with "Bfair = Pi * rf * t/T", where `t` is the time before the next funding and `T` the funding interval, S2.
So the mark is the index plus the funding rate prorated over the time left, and nothing from the contract's own book enters it.
The wire agrees exactly: `mark_price` equalled `index_price × (1 + funding_rate × (next_funding_time − timestamp) / 8 h)` to within half a tick on 3,000 of 3,000 row polls in the second run.
With `indicative_funding_rate` in place of `funding_rate` it held on 2,880 of 3,000, so the mark uses `funding_rate`.
Rounded to the tick, the mark equalled the index on 1,920 of 3,000 row polls, because a 45 to 48 ppm basis is below half a tick on most contracts.
The mark premium ran from -412.2 to 89.1 ppm, median 0, in the second run, and from -443.5 to 95.0 ppm in the first.

The mark is therefore a capped premium in the sense of section "Anchor" of [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md).
It can never differ from the index by more than the current funding rate plus half a tick, and the rate was 0.01 % on 48 of 50 contracts.
The basis decays to zero at each settlement.
A HitBTC leg whose book sits away from the index shows that whole gap as fresh edge to `anchorReading.ts`, at `server/src/engine/opportunity/anchorReading.ts` line 84.

### Funding

The formulas and the absence of a cap are in [`fees.md`](./fees.md) section 6.
The premium index is sampled every minute and averaged over the funding period, S2.

### Upcoming or last settled

The documentation disagrees with itself.
The bulk call describes `funding_rate` as "Percent of the contract's mark value paid in the previous funding period", while the per-contract call describes it as "Percentage of contract mark value paid after the end of current funding interval", S1.
The wire shows the following.

- `funding_rate` changed 0 times in 2,950 row polls per run, so it is fixed for the interval.
- The newest row of `GET /public/futures/history/funding` equalled the live `funding_rate`, `avg_premium_index` and `next_funding_time` on 50 of 50 contracts, in both runs.
  That row is stamped `2026-09-23T00:00:00.004Z` on BTC and names 08:00 as its `next_funding_time`.
- The mark formula prorates `funding_rate` over the time to `next_funding_time`, which fits a rate that is still to be paid.
- The funding article says the rate that stands "at the moment when the countdown reaches 0" is the one paid, S2.

So `funding_rate` is read here as the rate fixed at the last settlement and charged at `next_funding_time`, and `indicative_funding_rate` as the running estimate for the settlement after it.
This reading is Not verified, because it needs an account statement, and the settlement instant itself was not captured.
`indicative_funding_rate` differed from `funding_rate` on 3 contracts: `APTUSDT_PERP` at -0.0591 % against -0.0729 %, `BCHUSDT_PERP` at -0.0942 % against -0.1070 %, and `FETUSDT_PERP` at 0.01 % against -0.0547 %, in the second run.

### Rate across a settlement

The history call is the record of settlements, and its rows fall on 00:00, 08:00 and 16:00 UTC, 2 ms after the hour at the earliest, 40 ms at the median and 51 ms at the p90 over 208 rows.
Consecutive rows are 8.00 h apart on 155 of 156 gaps over 55 contracts, the exception being `TONUSDT_PERP` at its expiry.
207 of 208 rows equal `avg_premium_index + clamp(interest_rate − avg_premium_index, −0.0005, 0.0005)`, which is the published formula, and 30 of 30 BTC rows read 0.01 %.
Whether the live `funding_rate` steps to the old `indicative_funding_rate` exactly at the settlement instant was not captured.

### How often each number changed

| field | first run, of 2,950 row polls | second run | BTC per 59 polls |
|---|---:|---:|---|
| `timestamp` | 967 | 975 | 20 and 20 |
| `mark_price` | 487 | 484 | 19 and 20 |
| `index_price` | 487 | 483 | 19 and 20 |
| `premium_index` | 5 | 7 | 1 and 0 |
| `indicative_funding_rate` | 3 | 3 | 0 |
| `funding_rate` | 0 | 0 | 0 |

The reply is regenerated every 3 s, not every second: the BTC `timestamp` took 21 distinct values in 60 polls, 2,532 to 3,467 ms apart, median 3,000.
On arrival the row `timestamp` was 281 ms old at the minimum, 1,743 ms at the median and 2,752 ms at the p90, in the second run.
`HITUSDT_PERP` and `ZRXUSDT_PERP` moved 0 to 2 times in a minute.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /public/orderbook/{symbol}?depth=N`, or `GET /public/orderbook?symbols=A,B&depth=N` for several, S1 |
| depth | default 10, `0` for the whole book, S1. Depth 0 returned 294 bids and 182 asks, and 298 and 186, on `BTCUSDT_PERP` |
| shape | `{"timestamp": ISO, "ask": [[price, size], …], "bid": [[price, size], …]}`, strings |
| level order | bids descending and asks ascending at depth 0, 20 and 100 on three contracts, both runs |
| time | 142 to 226 ms |
| `timestamp` | the book's last publication: it repeated across reads 100 ms apart on a quiet book and advanced on each read of a busy one |
| caching | `cf-cache-status: DYNAMIC` |
| bad depth | `depth=-1` answered 200 with a book |

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| public REST | 30 requests a second plus a burst of 50, per IP, within a 1 s sliding window | S1 "Rate Limits" |
| default REST | 20 plus a burst of 30 | S1 |
| over the limit | HTTP 429 | S1 |
| `Retry-After` | not documented, and no limit was approached | |
| rate headers | none on any reply | `rest-probe.mjs anchor` |
| CCXT | `rateLimit` 3.333 ms with a cost of 10 on every public call, so about 30 a second | `server/node_modules/ccxt/js/src/hitbtc.js` lines 25 and 137 to 168 |
| other codes | 400, 401, 403, 404, 500, 503 "Service is down for maintenance", 504 | S1 "HTTP Status Codes" |

| request | status | body |
|---|---|---|
| `/public/futures/info/NOPEUSDT_PERP` | 400 | `{"timestamp": …, "error": {"description": "Try get /public/symbol, to get list of all available symbols.", "code": 2001, "message": "No such symbol: NOPEUSDT_PERP"}, "path": "/api/3/public/futures/info/NOPEUSDT_PERP", "requestId": …}` |
| `/public/futures/info?symbols=NOPEUSDT_PERP` | 200 | `{}` |
| `/public/orderbook/NOPEUSDT_PERP` | 400 | code 2001, as above |
| `/public/futures/info/PEPEUSDT_PERP`, suspended | 200 | every price and rate `"0"`, `next_funding_time` `1970-01-01T00:00:00.000Z` |
| `/public/orderbook/PEPEUSDT_PERP`, `/public/orderbook/TONUSDT_PERP` | 200 | `{"timestamp": …, "ask": [], "bid": []}` |
| `/public/nope`, `/public/time` | 404 | `{"timestamp": …, "path": "/api/3/public/time", "status": 404, "error": "Not Found", "requestId": …, "message": "No static resource api/3/public/time."}` |

The 404 body has a different shape from every other error, and CCXT's `handleErrors` reads only `error.code`, at `server/node_modules/ccxt/js/src/hitbtc.js` lines 3863 to 3890.

## 7. Server time and clock offset

API v3 has no time call, and `/public/time` answers 404.
The futures info `timestamp` is regenerated every 3 s, so it cannot measure the clock.
The socket's `orderbook/full` `t` minus local arrival was 74 and 73 ms at the minimum, and the `futures/info` channel's 72 and 71 ms, against a one-way time near 72 ms, half the warm REST round trip.
So the offset is within a few ms of zero, see [`websocket.md`](./websocket.md) section 3.
That is an inference from two measurements, not a measured offset.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.hitbtc.com/api/3/public/futures/info` | one call carries four of the five `AnchorRow` fields for every contract |
| interval | 1,000 ms, the default | median 144 ms and max 212 ms over 120 polls, 1 of the 30 a second allowed. The reply only changes every 3 s, so a 3 s poll loses nothing but lets a reading age to 3 s |
| row mapping | section 3, `fundingIntervalHours` the constant 8 | the reply has no interval field |
| skip | rows whose `next_funding_time` is in the past or whose `mark_price` is `"0"` | the five non-working contracts |
| skip | rows whose `timestamp` is more than 10 s older than the newest row of the same reply | `CELUSDT_PERP` sat 59 s old with an empty book |
| catalog filter | `marketFilter: (m) => m.info.status === 'working'` | CCXT marks every contract active |
| deny list input | `HITUSDT_PERP`, whose index is HitBTC's own spot last | a self-venue index, see section 4 |
| gate caveat | treat every HitBTC mark as a funding-capped premium | the mark is the index plus the prorated funding rate, see section 4 |
| move guard caveat | a poll can carry 3 s of index movement in one step | `anchor_moving` compares consecutive polls, at `server/src/engine/opportunity/anchorReading.ts` line 6 |
| rate limit pause | `rateLimitPauseMs` 1,000 | the window is a 1 s sliding window, and no `Retry-After` is documented |

The bulk reply is about 18.8 KB, 1.6 GB a day at one hertz.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | HitBTC API v3 reference, changelog latest 27.08.2026 | https://api.hitbtc.com/ | 2026-09-22 | HitBTC, global | URLs, symbol and futures info fields, status values, funding history, order book, rate limits, status codes, sections 1 to 6 |
| S2 | What Is the Futures Funding Rate?, modified 2023-03-22, text and formula images | https://support.hitbtc.com/en/support/solutions/articles/63000268177-what-is-the-futures-funding-rate- | 2026-09-22 | HitBTC, global | index basket, mark and funding formulas, section 4 |
| S3 | CCXT 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/hitbtc.js` | 2026-09-22 | CCXT | market mapping, `active`, `contractSize`, rate limit, error handling, sections 2 and 6 |
| P1 | `rest-probe.mjs host`, `catalog`, `anchor`, `history`, `book` and `errors`, 04:10 to 04:13 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hitbtc/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 7, first numbers |
| P2 | the same six modes rerun, 04:24 to 04:26 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hitbtc/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 7, second numbers, and the mark formula, republish and stale row checks |
