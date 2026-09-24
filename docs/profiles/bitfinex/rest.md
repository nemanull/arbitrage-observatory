# Bitfinex REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:13 to 03:21 UTC on 2026-09-23 for the first pass and 03:38 to 03:43 UTC for the second, from the development host near Seattle.

This profile covers the public REST API v2 of Bitfinex (CCXT id `bitfinex`) for the perpetual contracts, whose ids end in `F0`.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bitfinex/rest-probe.mjs), a documentation page, or a CCXT file and line.
The documentation was read as Markdown from `https://docs.bitfinex.com/<page>.md`, and the legal pages as [`fees.md`](./fees.md) section 1 describes.

## 1. Host and latency from this machine

| item | value |
|---|---|
| public base URL | `https://api-pub.bitfinex.com/v2`, S1 |
| resolved addresses | `104.16.164.90`, `104.16.165.90`, `104.16.166.90`, `104.16.167.90`, `104.16.168.90`, all Cloudflare, and no IPv6 address (`ENODATA`) |
| front | every reply carries `server: cloudflare` and a `cf-cache-status` header |
| `GET /platform/status` | `[1]`, which means operative. First request 113 ms, then 15, 176, 15 and 179 ms. Second pass 98, then 180, 16, 195 and 16 ms |
| `GET /status/deriv?keys=ALL` | 17,966 bytes. First request 80 ms, then 42, 19, 193 and 20 ms. Second pass 72, then 39, 17, 202 and 16 ms |
| `GET /tickers?symbols=ALL` | 41,399 bytes. First request 21 ms, then 19, 16, 18 and 33 ms. Second pass 28, then 19, 23, 19 and 20 ms |
| refusals | none. Every call answered 200 or a documented error, and no geoblock, captcha or rate limit reply was seen |

The times split in two: about 15 to 40 ms when Cloudflare answers from its cache, and about 175 to 580 ms when it goes to the origin.
Section 3 shows that this cache also decides how fresh the anchor call is.

## 2. Catalog

### The instruments call

`GET /v2/conf/pub:list:pair:futures` lists the perpetual pairs, and `pub:info:pair:futures` adds `[pair, [null, null, null, minOrderSize, maxOrderSize, null, null, null, initialMargin, minMargin]]`, S2.
Both labels fit in one call, and the pair returned 9,192 bytes in 330 ms.

| family | conf ids | count on 2026-09-23 03:14 UTC |
|---|---|---:|
| USDt-settled | `…F0:USTF0` | 75 |
| BTC-settled | `ETHF0:BTCF0`, `LTCF0:BTCF0`, `XAUTF0:BTCF0`, `XRPF0:BTCF0` | 4 |
| paper trading | `TEST…F0:TESTUSDTF0` | 14 |
| total | | 93 |

The catalog has no status field, so a listed pair is a live pair.
The status call returned 91 rows, and the two conf pairs it lacks are the paper contracts `TESTAPTF0:TESTUSDTF0` and `TESTXTZF0:TESTUSDTF0`.
The USDt family holds 8 equity index contracts (`AUSTRALIA200IX`, `EUROPE50IX`, `FRANCE40IX`, `GERMANY40IX`, `HONGKONG50IX`, `JAPAN225IX`, `SPAIN35IX`, `UK100IX`), 2 implied volatility index contracts (`BVIV`, `EVIV`), `EUR`, `GBP`, and `XAUT`, `XAG`, `XPT`, `XPD` and `UKOIL`.

### How CCXT 4.5.68 maps it

| item | CCXT | wire | match |
|---|---|---|---|
| markets | 290 from one `conf` call of four labels, at `bitfinex.js` line 612 | | 93 swaps, 197 others |
| swap test | any id containing `F0`, at line 635 | | 93 of 93 conf pairs |
| `market.id` | `'t' + id`, at line 673, so `tBTCF0:USTF0` | the socket symbol, the status key and the REST book path are all `tBTCF0:USTF0` | 93 of 93 against the conf list, and 91 of 91 against the status keys |
| symbol | `BTC/USDT:USDT`, `ETH/BTC:BTC`, `TESTBTC/TESTUSDT:TESTUSDT` | | |
| `active` | `true` for every market, hard coded at line 688 | | 93 of 93 swaps |
| `linear` | `true` for every swap, at line 690 | the BTC-settled contracts are quoted and settled in BTC, so linear in BTC | |
| `contractSize` | `1` for every swap, at line 692 | book amounts are in the base currency, see [`websocket.md`](./websocket.md) section 4 | the engine's `sizeMul` of 1 is right |
| `taker` | 0.002 on 93 of 93 swaps | the published taker is 0, see [`fees.md`](./fees.md) section 8 | no |
| precision | amount 8, price 5 significant digits, at lines 698 and 699 and the `SIGNIFICANT_DIGITS` mode at line 343 | `P0` books keep 5 significant figures | yes |
| minimum size | `limits.amount.min` 0.00004 BTC and max 100 on `BTC/USDT:USDT`, from `pub:info:pair:futures` | | |

No pair is listed twice in the USD settlement family, so no `marketFilter` choice between two contracts is needed.

### Three names CCXT does not translate

CCXT maps the Bitfinex codes `ALG` to `ALGO`, `ATO` to `ATOM` and `IOT` to `IOTA`, at `bitfinex.js` lines 517, 519 and 530.
For a perpetual it looks up the code with its `F0` suffix still on, as `ALGF0`, and strips the suffix afterwards, at lines 654 and 656.
So the three perpetuals come out as `ALG/USDT:USDT`, `ATO/USDT:USDT` and `IOT/USDT:USDT`, and the engine would never cluster them with ALGO, ATOM or IOTA on another venue.
A venue that lists a different token under the ticker `ALG`, `ATO` or `IOT` would cluster with them instead, so the three need a rename or a denial at activation.

### Paper contracts

The 14 `TESTUSDT` contracts are paper trading markets with test money, and CCXT lists them as active swaps.
Their quote `TESTUSDT` is outside the USD settlement family, so they would not cluster, but a `marketFilter` that drops `settle === 'TESTUSDT'` keeps them off the book sockets.

### Size unit and price scale

One contract is one unit of the base currency on every swap probed, so no price scale is needed.
The index and volatility contracts quote a number such as 6,353 for `EUROPE50IX`, so they cluster only with a venue that uses the same ticker for the same index.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /v2/status/deriv?keys=ALL` | none published, see section 4 | `MARK_PRICE`, position 15 | `CURRENT_FUNDING`, position 12 | absent, 8 h for every contract | `NEXT_FUNDING_EVT_MTS`, position 8, Unix ms | 17,948 to 18,021 bytes, 91 rows of 24 fields | see the next table |

The key at position 0 is the CCXT `market.id`.
The documented rate limit is 90 requests per minute, S3.

### The edge cache sets the freshness

| run of 60 polls, one a second | `cf-cache-status` | request time | new row time seen | age of the row time on arrival |
|---|---|---|---|---|
| plain URL, 03:14 UTC | not recorded | min 21, median 28, p90 209, max 279 ms | 10 new times in 59 intervals | median 4,612 ms, max 9,614 ms |
| plain URL, 03:18 UTC | 51 `HIT`, 9 `EXPIRED`, `age` 0 to 4 | min 14, median 17, p90 195, max 278 ms | 11 times, 6,000 to 7,000 ms apart with one 3,000 | median 4,755 ms, max 8,753 ms |
| with a changing `&_=<ms>` parameter, 03:16 UTC | 60 `MISS` | min 178, median 206, p90 518, max 582 ms | 20 times, 3,000 or 4,000 ms apart | median 3,058 ms, max 4,409 ms |
| plain URL, second pass, 03:39 UTC | 50 `HIT`, 10 `EXPIRED`, `age` 0 to 4 | min 22, median 28, p90 212, max 473 ms | 11 times, 6,000 or 7,000 ms apart with one 3,000 | median 4,788 ms, max 9,790 ms |
| changing parameter, second pass, 03:40 UTC | 60 `MISS` | min 177, median 206, p90 233, max 565 ms | 20 times, 3,000 or 4,000 ms apart | median 3,014 ms, max 5,044 ms |

The origin writes a new row every 3 s, and its `MTS` is a whole second.
Cloudflare keeps the plain URL for about 5 s, so a poll of the plain URL sees a row every 6 or 7 s, and up to 9.8 s old.
A query parameter that changes on every poll misses the cache, and then every row was at most 5.0 s old on arrival.
The engine stamps a reading on arrival and refuses one older than 10 s by that stamp, at `server/src/engine/opportunity/anchorReading.ts` line 5, so the age of a Bitfinex row is invisible to that check.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | position 0, `KEY` | string, `tBTCF0:USTF0` | none |
| `index` | position 15, `MARK_PRICE` | JSON number | none, see section 4 for why the mark doubles as the index |
| `mark` | position 15, `MARK_PRICE` | JSON number, never 0 or null on 91 rows | none |
| `fundingRate` | position 12, `CURRENT_FUNDING` | fraction for the next settlement, `0.00007835` is 0.007835 % | none |
| `fundingIntervalHours` | absent | | the constant 8, from the Funding Payment Summary Table 2 |
| `nextFundingAt` | position 8, `NEXT_FUNDING_EVT_MTS` | Unix ms, `1790150400000` is 2026-09-23 08:00 UTC | none |

`CURRENT_FUNDING` was non zero on 36 of 91 rows at 03:15 UTC, with a largest magnitude of 0.0025, which is the cap.
`NEXT_FUNDING_EVT_MTS` read `2026-09-23T08:00:00.000Z` on all 91 rows.

CCXT's `fetchFundingRates` reads the same call but reports position 3, the perpetual's own book mid, as `indexPrice`, and position 9, the running average, as `nextFundingRate`, at `bitfinex.js` lines 3360 to 3369.
So CCXT's index is not an index, and its interval is `undefined`, at line 3375.

## 4. Anchor semantics

### Index

Bitfinex publishes no index price separate from the mark.
The mark is "Price based on the BFX Composite Index", S3.
The product description defines that index: "The BFXCI is designed to be an equally weighted index of the prevailing published prices of the Reference Token Pair traded in the Bitfinex.com peer-to-peer Digital Token spot market and up to three other exchanges with published pricing information for the Reference Token Pair", with a price dropped when it "exceeds a programmed standard deviation", S4.
The constituent exchanges are not named, and no basket call exists.
The basket is spot markets and never the perpetual itself, so the self index trap of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) does not apply as written.

The row's `SPOT_PRICE` at position 4, documented as "Book mid price of the underlying Bitfinex spot trading pair", is not a usable index.

| check, `rest-probe.mjs index` at 03:19 UTC and `anchor` | count |
|---|---:|
| rows whose `SPOT_PRICE` equals `MARK_PRICE` exactly | 47, 48 and 47 of 91 over three reads |
| USDt perpetuals with no Bitfinex spot ticker against USDt or USD | 37 of 75, in both reads |
| USDt perpetuals whose `SPOT_PRICE` is within 50 ppm of the Bitfinex USDt spot mid | 11 and 9 of 75 |
| rows whose `SPOT_PRICE` is more than 5,000 ppm from the mark | 7, 6 and 8 of 91 over three reads |

The far rows were `ATO` at 2.274 against a mark of 1.847, `LDO` at 0.23283 against 0.437, `APT` at 0.54152 against 0.839, `NEO` at 1.98 against 2.636, `CRV` at 0.42076 against 0.364, `ZRO` at 1.82135 against 1.4267, and `ZEC`, `NEAR` and `ENA` by less.
So `SPOT_PRICE` is a thin or stale Bitfinex book on some contracts and a copy of the mark on others.

### Mark

The mark is the index valuation itself, with no premium or funding term in it, S4 and S5.
So the engine's mark premium on a Bitfinex leg would always read 0.
The perpetual trades away from it: `|DERIV_PRICE / MARK_PRICE - 1|` had a median of 663, 655, 735 and 816 ppm over the 91 rows in four reads.
This is the capped mark shape of the design, taken to the limit: a standing Bitfinex basis is never carried by the mark, so the fresh gate would read it as fresh edge.
The running average `NEXT_FUNDING_ACCRUED` is exactly that basis, averaged over the current 8 h, and is the only published number that carries it.

### Funding

The formula, the 0.05 % dead band and the caps are in [`fees.md`](./fees.md) section 6.
`CLAMP_MIN` was 0.0005 on 91 of 91 rows.
`CLAMP_MAX` was 0.0025 on 86 rows, 0.025 on `tSOLF0:USTF0`, 0.005 on `tCRVF0:USTF0`, and null on `tEUROPE50IXF0:USTF0`, `tFRANCE40IXF0:USTF0` and `tSPAIN35IXF0:USTF0`.
The Funding Payment Summary lists 2.50 % for SOL and 0.50 % for CRV as well, S5.

### Rate across a settlement

`GET /v2/status/deriv/{key}/hist` returns the same row once a minute, S6.
At each of the last three BTC settlements the rate after the instant equals the dead band formula of the last average before it.

| settlement | `NEXT_FUNDING_ACCRUED` before | formula | `CURRENT_FUNDING` after | `CURRENT_FUNDING` before | step before, after |
|---|---:|---:|---:|---:|---|
| 2026-09-22 08:00 UTC | 0.00060759 | 0.00010759 | 0.00010768 | 0.00009354 | 9,190, 18 |
| 2026-09-22 16:00 UTC | 0.00066 | 0.00016 | 0.00016006 | 0.00010768 | 9,189, 18 |
| 2026-09-23 00:00 UTC | 0.00031437 | 0 | 0 | 0.00016006 | 9,193, 18 |

The small differences are the last minute of the period, which the one minute history does not sample.
So `CURRENT_FUNDING` is the rate for the next settlement, fixed when the previous period closed, which is what `AnchorRow.fundingRate` asks for.
`NEXT_FUNDING_ACCRUED` restarts near 0 after each instant and sets the settlement after next.
`NEXT_FUNDING_STEP` counts the 3 s samples, about 9,190 per 8 h period.
The instant itself was not captured, and the documented trading pause of several seconds at each funding time was not observed.

### How often each number changed

Per contract, over 59 one second intervals.

| field | plain URL, min, median, max, first and second pass | with the changing parameter, first and second pass |
|---|---|---|
| row time `MTS` | 10, 10, 10 and 10, 10, 10 | 19, 19, 19 and 18, 19, 19 |
| `DERIV_PRICE` | 0, 9, 10 and 0, 8, 10 | 0, 13, 19 and 0, 15, 19 |
| `MARK_PRICE` | 0, 6, 10 and 0, 6, 10 | 0, 8, 19 and 0, 10, 19 |
| `SPOT_PRICE` | 0, 6, 10 and 0, 7, 10 | 0, 8, 19 and 0, 10, 19 |
| `NEXT_FUNDING_ACCRUED` | 0, 10, 10 and 0, 10, 10 | 0, 19, 19 and 0, 18, 19 |
| `CURRENT_FUNDING` | 0, 0, 0 in every run | 0, 0, 0 in every run |

On BTC the mark changed on 10 of 10 plain rows, and on the WebSocket `status` channel it changed 12 times in 45 s, see [`websocket.md`](./websocket.md) section 4.

## 5. REST book snapshot

| call | reply | time |
|---|---|---|
| `GET /v2/book/tBTCF0:USTF0/P0?len=25` | 25 bids then 25 asks | 298 and 319 ms |
| `len=100` and `len=250` | 100 and 250 per side | 214 to 238 ms |
| `GET /v2/book/tDOGEF0:USTF0/P0?len=100` | 56 bids and 48 asks, then 58 and 50, all that exist | 209 and 221 ms |
| `GET /v2/book/tBTCF0:USTF0/R0?len=100` | 100 orders per side as `[ORDER_ID, PRICE, AMOUNT]` | 206 and 212 ms |

`len` takes `1`, `25`, `100` or `250`, and the precision `P0` to `P4` or `R0`, S7.
Rows are `[PRICE, COUNT, AMOUNT]`, bids first in descending price, then asks in ascending price with negative amounts, on every call.
Two reads 300 ms apart returned identical bodies in both passes, and the replies carried `cf-cache-status` `EXPIRED` or `MISS`, so how long Cloudflare keeps a book is Not verified.
The documented limit is 240 requests per minute, S7.

## 6. Rate limits and errors

| item | value |
|---|---|
| documented limits | "between 10 and 90 requests per minute, depending on the specific REST API endpoint", S8. Per page: status 90, status history 90, book 240, tickers 30, platform status 30 per minute, S3, S6, S7, S9 |
| on breach | "the IP is blocked for 60 seconds", with the body `{"error": "ERR_RATE_LIMIT"}`, S8. Not provoked |
| headers | no `x-ratelimit-*` header and no `Retry-After` on any reply |
| unknown symbol | HTTP 500 `["error",10020,"symbol: invalid"]` on `/book` and `/ticker` |
| bad precision or length | HTTP 500 `["error",10020,"prec: invalid"]` and `["error",10020,"len: invalid"]` |
| unknown status key | HTTP 200 `[]`, for `keys=tNOPEF0:USTF0`, for no `keys` at all, and for the history of an unknown key |
| unknown path | HTTP 404 with an HTML body `Cannot GET /api/v2/nope` |

A poller must treat an empty status reply as a failed poll, since a wrong key does not produce an error.

## 7. Server time and clock offset

The public API has no time call.
The `Date` header against the midpoint of the request gave offsets of -661, -446, -253, -147 and +43 ms, and -763 to -71 ms in the second pass, and the header has a one second resolution, so the clock agrees with the server to within that second.
The status rows carry their own time in whole seconds, which is part of why their age on arrival never fell below 660 ms on any read.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api-pub.bitfinex.com/v2/status/deriv?keys=ALL&_=<Date.now()>` | one call for every contract, and the changing parameter skips the 5 s edge cache |
| interval | 1,000 ms | 60 of the 90 requests a minute, and the origin writes every 3 s, so a row is seen within about a second of being written |
| row mapping | section 3, key at position 0 | |
| `index` and `mark` | both `MARK_PRICE` | the venue publishes no other index, and `SPOT_PRICE` is stale or a copy |
| `fundingRate` | `CURRENT_FUNDING` | the rate for the next settlement, verified across three settlements |
| `fundingIntervalHours` | 8 | every contract, S5 Table 2 |
| skip | `TEST…` keys | paper trading |
| skip | rows with a null `MARK_PRICE` or `NEXT_FUNDING_EVT_MTS` | none seen, but the fields are positional and nullable |
| empty reply | treat as a failed poll | an unknown key returns 200 `[]` |
| rate limit pause | `rateLimitPauseMs` 60,000 | a breach blocks the IP for 60 s, S8, and no reply seen carried `Retry-After`, though a breach itself was not provoked |
| open question | whether the engine should read the Bitfinex mark as carrying no premium, or build one from `MARK_PRICE × (1 + NEXT_FUNDING_ACCRUED)` | the mark has no premium, section 4 |

The reply is about 18 KB, so one hertz is about 1.5 GB a day.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitfinex API docs, Requirements and Limitations and General | https://docs.bitfinex.com/docs/requirements-and-limitations | 2026-09-22 | Bitfinex, global | public base URL, section 1 |
| S2 | Bitfinex API docs, Configs, `rest-public-conf` | https://docs.bitfinex.com/reference/rest-public-conf | 2026-09-22 | Bitfinex, global | conf labels, section 2 |
| S3 | Bitfinex API docs, Derivatives Status, updated 2025-06-10 | https://docs.bitfinex.com/reference/rest-public-derivatives-status | 2026-09-22 | Bitfinex, global | field positions and meanings, `keys=ALL`, 90 per minute, sections 3, 4, 6 |
| S4 | Derivative Product Description, BTCF0:USTF0 section, last updated July 29, 2020 | https://www.bitfinex.com/legal/derivative/product/ | 2026-09-22 | BFXD | BFXCI definition and exclusion rule, section 4 |
| S5 | Perpetual Contract Funding Payment Summary, last updated August 24th, 2026 | https://www.bitfinex.com/legal/derivative/funding/ | 2026-09-22 | BFXD | 8 h periods, caps, mark definition, sections 3 and 4 |
| S6 | Bitfinex API docs, Derivatives Status History, updated 2025-06-10 | https://docs.bitfinex.com/reference/rest-public-derivatives-status-history | 2026-09-22 | Bitfinex, global | history path, `limit` up to 5,000, 90 per minute, sections 4 and 6 |
| S7 | Bitfinex API docs, Book, updated 2026-03-03 | https://docs.bitfinex.com/reference/rest-public-book | 2026-09-22 | Bitfinex, global | book path, `len` and precision values, 240 per minute, sections 5 and 6 |
| S8 | Bitfinex API docs, Requirements and Limitations, updated 2025-06-10 | https://docs.bitfinex.com/docs/requirements-and-limitations | 2026-09-22 | Bitfinex, global | limit range, 60 s block, `ERR_RATE_LIMIT`, section 6 |
| S9 | Bitfinex API docs, Tickers and Platform Status | https://docs.bitfinex.com/reference/rest-public-tickers | 2026-09-22 | Bitfinex, global | 30 per minute each, section 6 |
| S10 | CCXT 4.5.68 `bitfinex.js` | `server/node_modules/ccxt/js/src/bitfinex.js` | 2026-09-22 | CCXT | catalog mapping, currency codes, funding parse, sections 2 and 3 |
| P1 | `rest-probe.mjs host`, `catalog`, `anchor`, `anchor-nonce`, `index`, `history`, `book` and `errors`, 03:13 to 03:21 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitfinex/rest-probe.mjs) | 2026-09-22 | this host | every probed number |
| P2 | second pass of every mode, 03:38 to 03:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitfinex/rest-probe.mjs) | 2026-09-22 | this host | the second readings in sections 1 to 7 |
