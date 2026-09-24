# FMFW.io REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:34 UTC and a second pass at 04:48 to 04:50 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocates to Canada.

This profile covers the public REST API v3 of FMFW.io (CCXT id `fmfwio`) for its one perpetual family, USDT-margined linear contracts.
Every number was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/fmfwio/rest-probe.mjs) unless a source ledger row says otherwise.
All access results are from the Canadian VPN exit, and Canada is a derivatives-restricted region, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://api.fmfw.io/api/3`, S1 |
| resolved address | `104.21.54.168` and `172.67.140.173`, Cloudflare, HTTP/2 |
| edge | `cf-ray` ended in `SEA` in the first pass and `YVR` in the second, and `cloudflare.com/cdn-cgi/trace` reported `loc=CA`, `colo=YVR` |
| cold request, curl, `/public/futures/info` | TCP connect 211 to 213 ms, TLS done at 227 to 238 ms, first byte at 1,247 to 1,383 ms, three runs |
| cold request, Node, `/public/symbol` | 935 and 1,008 ms for 137,979 bytes |
| warm request, `/public/futures/info` | median 143 and 153 ms over two runs of 60 polls, see section 3 |
| access | every public call answered 200 except the error cases of section 6, and no request was refused by region |

## 2. Catalog

### The instruments call

`GET /public/symbol` returns every symbol as an object keyed by symbol id, S1.

| field | perpetual value |
|---|---|
| `type` | `futures` |
| `contract_type` | `perpetual` |
| `underlying` | base coin, for example `BTC`, while `base_currency` is `null` |
| `quote_currency`, `fee_currency` | `USDT` |
| `status` | `working` on 23, `expired` on `LUNAUSDT_PERP`. Spot rows also use `suspended` |
| `quantity_increment` | in coins: `0.0001` on BTC, `1000` on SHIB |
| `tick_size` | `0.01` on BTC, `0.00001` on GMT |
| `take_rate`, `make_rate` | `0.0008`, `0.0004` |
| `max_initial_leverage` | `100.00` on BTC, absent on `LUNAUSDT_PERP` and `CELUSDT_PERP` |

| count on 2026-09-23 | value |
|---|---|
| all rows | 645 |
| perpetuals, `working` | 23, all USDT-settled |
| perpetuals, `expired` | 1, `LUNAUSDT_PERP`, last funding 2022-05-13 |
| spot, `working` | 618, of which 366 USDT, 137 BTC, 93 USDC, 13 ETH, 8 BCH, 1 TUSD |
| spot, `suspended` | 3 |

The 23 working perpetuals are ADA, AAVE, LINK, XLM, SOL, UNI, BTC, DOT, GMT, AVAX, MANA, LTC, APE, ATOM, CEL, BCH, ZEC, ETH, XRP, FIL, BNB, SHIB and TRX, each as `<BASE>USDT_PERP`.
`CELUSDT_PERP` is `working` but its book is empty on REST and on the socket, and the site shows its leverage as `"0"`, see [`fees.md`](./fees.md) section 7.

### How CCXT 4.5.68 maps it

| engine field | CCXT source | probed |
|---|---|---|
| `market.id` | the catalog key | equals the socket key and the `/public/futures/info` key on 24 of 24 |
| `type` and `swap` | `swap` when `type` is `futures` and `expiry` is absent, `hitbtc.js` line 824 | 24 swaps |
| `base` | `underlying`, `hitbtc.js` line 826, through `commonCurrencies` | 23 bases as listed, and `GMT Token` for `GMTUSDT_PERP` |
| `active` | the literal `true` at `hitbtc.js` line 873, whatever `status` says | 24 of 24 active, so the expired `LUNAUSDT_PERP` passes `isActiveSwapMarket` at `server/src/ccxt/connector.ts` lines 196 to 203 |
| `linear` | `quote === settle`, `hitbtc.js` line 843 | true on 24 of 24 |
| `contractSize` | `1` for every contract, `hitbtc.js` line 840 | 1 on 24 of 24, and the book size unit is the base coin, see [`websocket.md`](./websocket.md) section 4 |
| `taker` | `take_rate`, `hitbtc.js` line 877 | 0.0008 on 24 of 24 |

`hitbtc.js` line 750 maps the venue code `GMT` to `GMT Token`, and line 757 maps `STEPN` to `GMT`.
On FMFW.io the currency `GMT` has `full_name` `STEPN` in `/public/currency`, and no `STEPN` code exists, so CCXT names the STEPN contract `GMT Token/USDT:USDT`.
The engine would therefore never pair `GMTUSDT_PERP` with GMT on another venue, which is the safe failure, but it also loses the market.

### Size unit, pairs listed twice, and price scale

Sizes on the socket and in the REST book are in base coins, which matches `contractSize` 1.
No base is listed twice, so no `marketFilter` is needed for duplicates.
No contract is quoted per 1,000 units: `SHIBUSDT_PERP` is priced per coin at `0.000006218` with a tick of `0.000000001`, so no price scale is needed.

Several ticks are coarse against the price, measured as tick over index at 04:50 UTC.

| contract | tick | one tick in ppm |
|---|---|---:|
| `CELUSDT_PERP` | 0.0001 | 15,873 |
| `GMTUSDT_PERP` | 0.00001 | 1,131 |
| `MANAUSDT_PERP` | 0.0001 | 1,127 |
| `APEUSDT_PERP` | 0.0001 | 615 |
| `ATOMUSDT_PERP` | 0.001 | 544 |
| `SHIBUSDT_PERP` | 0.000000001 | 161 |
| the other 17 | | 96 or less |

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /public/futures/info` | `index_price` | `mark_price` | `funding_rate`, and `indicative_funding_rate` | absent | `next_funding_time`, ISO 8601 | 8,207 to 8,265 bytes, 24 rows | 60 polls: min 140, median 143, p90 147, max 220 ms, and min 149, median 153, p90 158, max 175 ms in the rerun, none over 1 s |
| `futures/info` on the socket, `["*"]` | `i` | `m` | `r`, and `R` | absent | `T`, Unix ms | one contract per frame | each contract every 3,000 ms median, see [`websocket.md`](./websocket.md) section 2 |

One call carries four of the five `AnchorRow` columns for all 24 contracts, keyed by symbol id, which is CCXT's `market.id`.
The interval is not in any reply, and it is 8 h on every contract, see [`fees.md`](./fees.md) section 6.
CCXT's `fetchFundingRateHistory` also paginates on a fixed `'8h'` at `hitbtc.js` line 2961.
The reply also carries `premium_index`, `avg_premium_index`, `interest_rate`, `open_interest` and `timestamp`.
`GET /public/futures/info/{symbol}` returns one contract, and `?symbols=` filters the bulk call, S1.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | object key | string, `BTCUSDT_PERP` | none |
| `index` | `index_price` | decimal string, rounded to the contract tick | `Number()` |
| `mark` | `mark_price` | decimal string, rounded to the contract tick, never 0 on 24 rows | `Number()` |
| `fundingRate` | `funding_rate`, see section 4 for the dispute | decimal string, a fraction per 8 h: `"0.0001"` is 0.01 % | `Number()` |
| `fundingIntervalHours` | none | | the constant 8 |
| `nextFundingAt` | `next_funding_time` | ISO 8601, `"2026-09-23T08:00:00.000Z"` | `Date.parse()` |

At 04:31 and 04:48 UTC every live contract read `2026-09-23T08:00:00.000Z`, and `LUNAUSDT_PERP` read `2022-05-13T08:00:00.000Z`.

## 4. Anchor semantics

### Index

The documentation calls `index_price` the "Average underlying asset price", S1, and the futures help article calls it "the price on the spot market", S2.
No basket, weights or source list is published, and no basket call exists.
`GET /public/futures/candles/index_price/{symbol}` returns index candles, for example one minute candles with `period=M1`, S1.

The wire shows an index that is not FMFW's own spot and that tracks the wider market.

| read | 04:33 UTC | 04:50 UTC |
|---|---|---|
| index equal to FMFW spot `last` | 0 of 22 | 0 of 22 |
| index against OKX spot `last`, 22 contracts | -1,126 to +616 ppm | -2,032 to +544 ppm |
| index against OKX, BTC | -126 ppm | -133 ppm |
| `ATOMUSDT_PERP` index against FMFW `ATOMUSDT` spot mid, and against OKX | -769 and -543 ppm | +20,612 and +544 ppm |

`CELUSDT_PERP` has no spot market on FMFW or OKX, so 22 contracts were compared.
The ATOM row shows the index staying with OKX while the mid of FMFW's own thin ATOM spot book moved about 2 %.
The index is rounded to the contract tick, so a coarse tick quantises it: `GMTUSDT_PERP` changed on 0 and 2 of 59 polls, `MANAUSDT_PERP` on 2 and 1, and `ATOMUSDT_PERP` on 0 and 3, and each such step is 544 to 1,131 ppm, see section 2.
The 2,032 ppm GMT gap to OKX in the second read is a quantised and 3 s old index on a contract with no volume, and it is not proven to be a stale source.

### Mark

The documentation defines `mark_price` as "Recent asset price adjusted by the value of fair basis", S1.
The 2021 help article says "In our current implementation, the mark price is always equal to the last trade price on the spot market", and gives the future formula "Mark Price = Index Price + Bfair" with "Bfair = Index Price * Funding Rate * (t/T)", where t is the time left to the next funding and T is 8 h, S2.
The wire follows the formula, not the last trade.
In the second 60 poll run, `mark_price` was within half a tick of `index_price × (1 + funding_rate × t / 8 h)` on 1,377 of 1,380 rows of the 23 working contracts, where t runs from the reply's `timestamp` to `next_funding_time`.
The same test with `indicative_funding_rate` fit 1,317 rows, 60 fewer, which is one row per poll, the count of `BCHUSDT_PERP` rows, the one contract whose two rates differed.
The mark equalled the index on 540 of 1,380 rows, the contracts whose tick is wider than the basis.

So the mark premium over the index is only the funding basis, a median of 43 and 38 ppm over the two runs, a p90 of 76 and 60 ppm, and a maximum of 413 and 382 ppm on BCH.
It carries nothing from the perpetual's own book.
The perpetual mid sat -20,767 to +2,752 ppm from the mark at 04:33 UTC and -2,250 to +3,032 ppm at 04:50 UTC.
Perpetual spreads were 240 to 61,471 ppm at 04:33 UTC and 497 to 108,496 ppm at 04:50 UTC, with BTC the narrowest and ATOM the widest.
No clamp on the mark is documented, and the formula needs none, since the mark is the index scaled by a share of the funding rate.

### Funding

The formula, the interval and the history are in [`fees.md`](./fees.md) section 6.

| field | documented, S1 | on the wire |
|---|---|---|
| `funding_rate`, info call | "Percent of the contract's mark value paid in the previous funding period." | equal to the newest history row, stamped 00:00 UTC, on 24 of 24 contracts |
| `indicative_funding_rate` | "Estimated percent of the contract's mark value to be paid after the end of the current funding period, calculated at the moment." | equal to `funding_rate` on 23 of 24, and `-0.00108` against `-0.00094` on BCH |
| `funding_rate`, history call | "Percentage of contract mark value paid after the end of current funding interval." | the 00:00 row carries `next_funding_time` 08:00 |
| CCXT | `parseFundingRate` maps `funding_rate` to `fundingRate` with `fundingTimestamp` from `next_funding_time`, and `indicative_funding_rate` to `nextFundingRate` | `hitbtc.js` lines 3439 to 3442 |

The two doc pages disagree on which settlement `funding_rate` belongs to.
Three facts point to the rate the next settlement pays: the history page's wording, CCXT's mapping, and the mark, which applies `funding_rate` over the time left to `next_funding_time`.
The info page's wording points to the rate already paid.
The settlement instant was not captured, so this stays an open question.
Most contracts sit at 0.0001, the interest rate, where both readings give the same number.

### How often each number changed

Over 59 intervals of 1 s polls, in the first and second run.

| field | live contracts | quiet contracts |
|---|---|---|
| `timestamp` | 20 and 21 of 59 on every live contract, so the call republishes every 3 s | 1 of 59 on `CELUSDT_PERP`, 0 on `LUNAUSDT_PERP` |
| `index_price` | 10 to 20 of 59 | 0 to 9 on GMT, MANA, ATOM, APE and FIL, and 0 on CEL and LUNA |
| `mark_price` | the same number of times as the index on every contract, as the mark formula implies | |
| `funding_rate` | 0 | |
| `indicative_funding_rate`, `premium_index` | 0 or 1 | |

The reply's `timestamp` is documented as "Request timestamp", S1, and it is the publication time.
It was 444 to 2,982 ms old on arrival in the two poll runs, with medians of 1,915 and 1,461 ms, and 396 to 2,960 ms old in 20 more reads, see section 7.
A poll at 1 s therefore returns the same reading about three times, and a reading up to 3 s old is stamped as new on arrival.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /public/orderbook/{symbol}?depth=N`, or `GET /public/orderbook?symbols=a,b&depth=N` for several, S1 |
| depth | default 10, `0` returns the whole book, S1. `depth=0` on BTC returned 292 and 295 bids and 188 and 186 asks. `depth=-1` also returned the whole book with no error |
| `volume` parameter | returns levels until the cumulative size reaches the value: with `volume=0.5` BTC returned 7 asks and 8 bids, then 6 and 5, each side the fewest levels whose sizes add up to 0.5 BTC or more |
| level order | bids descending and asks ascending at depth 0, 5, 20 and 100, in both runs |
| size unit | base coin, equal to the socket, see [`websocket.md`](./websocket.md) section 4 |
| time | 156 to 162 ms at depth 5 to 100, and 261 and 654 ms for the whole BTC book of about 10.7 KB |
| bulk | all 24 perpetuals at depth 20 in one call, 19.5 to 19.7 KB in 163 and 165 ms |
| caching | none seen: `cf-cache-status` `DYNAMIC`, and two reads 104 and 559 ms apart carried different `timestamp` values |
| sequence | none, the reply carries only `timestamp`, `ask` and `bid` |

## 6. Rate limits and errors

| item | value |
|---|---|
| `/public/*` per IP | 30 requests per second plus a burst of 50, in a 1 second sliding window, S1 |
| default per IP | 20 plus 30, S1 |
| over the limit | HTTP 429, S1. Not triggered, since no probe went above about 5 requests per second |
| `Retry-After` and limit headers | none documented, and none in any reply. Apart from the Cloudflare `nel` and `report-to` headers, which the probe does not print, the headers were `alt-svc`, `cf-cache-status`, `cf-ray`, `content-encoding: br`, `content-type`, `date`, `referrer-policy`, `request-id`, `server` and `transfer-encoding` |
| documented status codes | 200, 400, 401, 403, 404, 429, 500, 503 for maintenance, 504, S1 |

| request | status | body, trimmed |
|---|---|---|
| `/public/orderbook/NOPEUSDT_PERP` | 400 | `{"timestamp":"2026-09-23T04:33:54.914Z","error":{"description":"Try get /public/symbol, to get list of all available symbols.","code":2001,"message":"No such symbol: NOPEUSDT_PERP"},"path":"/api/3/public/orderbook/NOPEUSDT_PERP","requestId":"46417963-71976848"}` |
| `/public/futures/info/NOPEUSDT_PERP` | 400 | same shape, code 2001 |
| `/public/futures/info/LUNAUSDT_PERP` | 200 | the frozen 2022 row with `timestamp` `2022-05-13T00:00:00…` |
| `/public/orderbook/LUNAUSDT_PERP` | 200 | `{"ask":[],"bid":[]}` with a current `timestamp` |
| `/public/futures/history/funding?limit=5000` | 400 | code 10001, `"Bad request parameter [limit]. Parameter must be in [1, 1000]"` |
| `/public/nope` | 404 | `{"timestamp":"2026-09-23T04:33:57.443+00:00","path":"/api/3/public/nope","status":404,"error":"Not Found","requestId":"5d705e36-6347697059","message":"No static resource api/3/public/nope."}` |
| `/public/time` | 404 | no server time call exists |

## 7. Server time and clock offset

No server time call is documented, and `/public/time` answers 404.
The `timestamp` of an error body is stamped when the request is served, so the probe reads it from `/public/symbol/NOPEUSDT_PERP` ten times.
The server clock was ahead of the local midpoint of each request by 2 to 7.5 ms, median 3.5 ms, and by 2 to 4.5 ms, median 3 ms, in the rerun.
The `Date` header has 1 s resolution.
The `futures/info` `timestamp` is not a clock, since it is the publication time, section 4.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.fmfw.io/api/3/public/futures/info` | one call carries index, mark, rate and next settlement for all 24 contracts in about 8 KB |
| interval | 1,000 ms, the default | median 143 and 153 ms, 1 of the 30 requests per second, and the data republishes every 3 s, so a slower poll would add up to a second of age |
| row mapping | section 3, key = object key, `fundingIntervalHours` = 8 | the interval is in no reply |
| funding rate | `funding_rate` | CCXT, the history page and the mark formula treat it as the rate the next settlement pays, section 4 |
| skip | rows whose `/public/symbol` `status` is not `working`, which drops `LUNAUSDT_PERP` | its row is frozen at 2022-05-13 |
| skip | `CELUSDT_PERP` | an empty book on both transports and leverage `"0"` on the site |
| rate limit pause | `rateLimitPauseMs` 1,000 | the window is 1 s and no `Retry-After` is sent |
| catalog filter | a `marketFilter` that keeps `market.info.status === 'working'` and drops `CELUSDT_PERP` | CCXT marks every contract `active`, section 2, and `MarketFilter` at `server/src/ccxt/types.ts` line 16 sees the raw catalog row in `info` |
| currency | leave `GMTUSDT_PERP` unpaired, or give the connector a way to pass CCXT a `commonCurrencies` override, which `VenueConnectorOptions` at `server/src/ccxt/types.ts` lines 18 to 24 does not offer today | CCXT renames STEPN's `GMT` to `GMT Token`, section 2 |
| age | stamp on arrival as the engine does, and note that the reading is up to 3 s older | the reply's `timestamp` is 0.4 to 3.0 s old on arrival |
| guard input | GMT, MANA, APE and ATOM index ticks of 544 to 1,131 ppm | one tick on GMT or MANA exceeds `MAX_ANCHOR_MOVE_PPM` of 1,000 at `server/src/engine/opportunity/anchorReading.ts` line 6, so every index step trips `anchor_moving` there |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | FMFW.io API Documentation v3, sections "API URLs", "Rate Limits", "HTTP Status Codes", "Symbols", "Order Books", "Futures Info", "Funding History" and "Futures Index Price Candles" | https://api.fmfw.io/ | 2026-09-22 | FMFW.io | calls, field meanings, limits, status codes, sections 2 to 7 |
| S2 | Futures, help article, 2021-10-18 | https://support.fmfw.io/en/articles/5534983-futures | 2026-09-22 | FMFW.io | index wording, mark wording and formula, section 4 |
| S3 | CCXT 4.5.68 `hitbtc.js` and `fmfwio.js` | `server/node_modules/ccxt/js/src/hitbtc.js`, `server/node_modules/ccxt/js/src/fmfwio.js` | 2026-09-22 | CCXT | market mapping, `commonCurrencies`, funding rate mapping, sections 2 to 4 |
| S4 | OKX public spot tickers | https://www.okx.com/api/v5/market/tickers?instType=SPOT | 2026-09-23 UTC | OKX | external reference for the index, section 4 |
| P1 | `rest-probe.mjs catalog`, `anchor`, `index`, `funding`, `book` and `errors` at 04:31 to 04:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/fmfwio/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | the same six modes rerun at 04:48 to 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/fmfwio/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | second readings, the mark formula fit, tick sizes |
| P3 | curl timing and `/public/currency`, 04:24 and 04:44 UTC | https://api.fmfw.io/api/3/public/currency | 2026-09-23 UTC | this host | cold timing, `GMT` full name |
