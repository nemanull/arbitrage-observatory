# Mercado Bitcoin REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, at 04:30 to 04:31 UTC, again at 04:41 to 04:42 UTC, and for two modes at 04:49 to 04:50 UTC on 2026-09-23 by the UTC clock, through the laptop's Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of Mercado Bitcoin (CCXT id `mercado`) for its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every claim below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/mercado/rest-probe.mjs), cited as P1 to P4, or comes from the ledger in section 9.
All access results are from a Canadian VPN exit: Cloudflare's trace reported `loc=CA` and `colo=SEA`.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-23 UTC | answer to this host |
|---|---|---|---|
| `api.mercadobitcoin.net` | v4 API, `/api/v4/...` | 104.18.80.40, 104.18.81.40 (Cloudflare) | 200 on every valid public call |
| `www.mercadobitcoin.net` | legacy v3 API, `/api/...`, which CCXT uses | 104.18.80.40, 104.18.81.40 | 200 on every valid public call |
| `ws.mercadobitcoin.net` | WebSocket and its documentation | 104.18.80.40, 104.18.81.40 | 101 on `/ws`, 200 on `/docs/v0/` |
| `www.mercadobitcoin.com.br` | marketing site, fee page, old API docs | 104.17.24.105, 104.17.25.105 | 403, a Cloudflare page "Sorry, you have been blocked", `server: cloudflare`, `cf-ray` ending `-SEA` |

The `content-security-policy` header on the legacy host's replies also names `ws2.mercadobitcoin.net`, which did not resolve.

| call | reply | cold | warm |
|---|---|---|---|
| `GET /api/v4/symbols` | 317,890 bytes | 402 and 381 ms | 162 to 198 ms in P1, 143 to 582 ms in the rerun |
| `GET /api/v4/tickers?symbols=<409 symbols>` | 73,032 to 73,037 bytes | | median 125, 113 and 129 ms, p90 322, 208 and 334 ms, max 409, 330 and 494 ms, over 30 polls in each of three runs (P3) |
| `GET /api/v4/BTC-BRL/orderbook?limit=20` | 1,371 bytes | | 89 to 134 ms over 20 polls in two runs (P2) |
| `GET /api/coins` (v3) | 1,454 names | | 151 and 119 ms |

The ten book polls of each P2 run, and the ticker and coins replies read with `curl`, carried `cf-cache-status: DYNAMIC`, so nothing is served from the Cloudflare cache.

## 2. Catalog

### The instruments call

`GET https://api.mercadobitcoin.net/api/v4/symbols` returns one object of parallel arrays, one array per field, not an array of rows (S1).
The fields are `symbol`, `description`, `currency`, `base-currency`, `exchange-listed`, `exchange-traded`, `minmovement`, `pricescale`, `type`, `timezone`, `session-regular`, `withdrawal-fee`, `withdraw-minimum`, `deposit-minimum`, `min-price`, `max-price`, `min-volume`, `max-volume`, `min-cost`, `max-cost` and `round-lot` (P1).

| count on 2026-09-23 UTC, both runs | value |
|---|---|
| symbols | 1,360 |
| by `type` | 409 `CRYPTO`, 878 `DIGITAL_ASSET`, 72 `DIGITAL_VARIABLE_INCOME`, 1 `UTILITY_TOKEN` |
| by quote (`currency`) | 1,352 `BRL`, 3 `USDT`, 3 `USDC`, 2 `BTC` |
| quoted outside BRL | `BTC-USDT`, `ETH-USDT`, `USDC-USDT`, `BTC-USDC`, `ETH-USDC`, `SKLASAAS01-USDC`, `ETH-BTC`, `ORANJE1-BTC` |
| `exchange-traded` false | 0 |
| perpetual, future or option rows | 0 |

`exchange-traded` is true on every row, even where the book is empty: `CLV-BRL` returned `{"asks":[],"bids":[]}` (P4), and in the third ticker run 32 of the 409 `CRYPTO` tickers had both `buy` and `sell` at `0.00000000` (P3).
So the flag does not mean a live book.

### How CCXT 4.5.68 maps it

CCXT does not read the v4 catalog.
`fetchMarkets` calls the legacy `GET https://www.mercadobitcoin.net/api/coins`, a flat array of base names, and builds one BRL market per name, at `server/node_modules/ccxt/js/src/mercado.js` lines 278 to 310.

| CCXT field | value | source |
|---|---|---|
| markets | 1,451, from 1,454 names, because `ETH`, `BCH` and `ORANJE1` are listed twice | P1 |
| quote | `BRL` on every market, `const quoteId = 'BRL'` | line 306 |
| `id` | quote then base, `BRLBTC`, on 1,451 of 1,451 | line 309, P1 |
| `type`, `spot`, `swap` | `spot`, true, false on every market | lines 319 to 322, P1 |
| `active` | `undefined` on every market | line 325 |
| `linear`, `contractSize` | `undefined` | lines 327 and 329 |
| `taker`, `maker` | `0.007`, `0.003` | lines 186 and 187 |
| by v4 `type` | 401 `CRYPTO`, 878 `DIGITAL_ASSET`, 72 `DIGITAL_VARIABLE_INCOME`, 1 `UTILITY_TOKEN`, and 99 names absent from v4, mostly `NFT` numbers | P1 |

The CCXT `id` is exactly the WebSocket `id`, see [`websocket.md`](./websocket.md) section 3.
The v4 REST spells the same market `BTC-BRL`, and the WebSocket refuses that spelling, so a feed keeps both spellings.
The eight non-BRL pairs are absent from CCXT, and the WebSocket does serve them under the same quote then base rule, `USDTBTC` for `BTC-USDT`.

### Size unit, pairs listed twice, and price scale

Sizes on every book source are in the base currency, `0.00674326` BTC at the BTC touch, and CCXT leaves `contractSize` undefined, which the connector would read as 1.
Each base is listed once per quote, so no pair is listed twice after CCXT drops the duplicate names.
No price scale applies.

## 3. Anchor

Mercado Bitcoin publishes no index price, no mark price and no funding rate, because it lists no perpetual.
The only reference prices on the public API are the ticker fields `last`, `buy`, `sell`, `high`, `low`, `open` and `vol`, and the candles of `GET /api/v4/candles` (S1).
None of them is an index built from other venues.

`GET /api/v4/tickers?symbols=<comma list>` is the one bulk call, and `symbols` is required: without it the reply is 400 `{"code":"PUBLIC_DATA|LIST_TICKERS|SYMBOLS_IS_REQUIRED","message":"The param {symbols} must not be empty"}` (P4).
All 409 `CRYPTO` symbols fit in one URL of 3,724 characters, and the reply held 409 rows of `pair`, `high`, `low`, `vol`, `last`, `buy`, `sell`, `open` and `date` (P3).
An unknown symbol is dropped silently, and a list of only unknown symbols returns `[]` with 200 (P4).
CCXT declares `fetchTickers` false, at `mercado.js` line 108.

No anchor poller is recommended.
An `AnchorRow` for this venue would have a mark of 0, and the reader refuses such a route with `anchor_no_mark`, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 36 to 38.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding formula to record.

How often ticker fields changed over 30 polls 1.1 s apart, 29 intervals, at 04:30, 04:42 and 04:50 UTC, in that order (P3):

| pair | `buy` | `sell` | `last` | `vol` | `date` |
|---|---|---|---|---|---|
| `BTC-BRL` | 9, 3, 3 | 9, 3, 3 | 0, 0, 1 | 0, 0, 2 | 9, 3, 4 |
| `ETH-BRL` | 4, 6, 3 | 5, 1, 4 | 0, 0, 0 | 0, 0, 1 | 7, 6, 6 |
| `USDT-BRL` | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 |
| `SOL-BRL` | 10, 4, 5 | 7, 3, 5 | 0, 0, 1 | 0, 1, 5 | 10, 5, 12 |
| `COMP-BRL` | 4, 9, 4 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 4, 9, 3 |
| all 409 rows | 961, 892, 773 | 657, 732, 610 | 3, 1, 3 | 5, 4, 13 | 1,402, 1,391, 1,222 |

At most 61, 58 and 51 of the 409 rows changed a price, the last trade or the volume between two polls.
`buy` and `sell` are the book's best bid and ask: they equalled the REST book top read right after, 445,860 and 445,861 BRL in the first run and 446,377 and 446,378 in the second (P2).
`date` moved on about as many polls as the touch did, so it reads as the time of the ticker's last update, in Unix seconds, although S1 says "Last update date in nanoseconds".
In the first reply of each run the median `date` was 128, 166 and 78 s old, and the oldest 1,139,767 s, about 13 days.
111, 110 and 111 rows had `last` at 0, markets with no trade in the window the ticker covers.

## 5. REST book snapshot

`GET https://api.mercadobitcoin.net/api/v4/{BASE}-{QUOTE}/orderbook?limit=N` (S1).

| item | value | evidence |
|---|---|---|
| limit | documented "Max allowed 1000", 400 `LIMIT_MAX_ALLOWED` "Max limit allowed is 1000." above it | S1, P4 |
| without `limit` | the whole book: 775 bids and 1,356 asks, then 778 and 1,353, on `BTC-BRL`, 70,405 bytes | P2 |
| `limit=1000` | 776 and 778 bids, 1,000 asks | P2 |
| `limit=abc` | 200 with a book, so the value is ignored | P4 |
| level shape | `["445838.00000000","0.00682912"]`, price and size as strings | P2 |
| level order | bids descending, asks ascending, on `BTC-BRL` at every limit and on `ETH-BRL`, `USDT-BRL` and `COMP-BRL` | P2 |
| documented order | S1 says of both `asks` and `bids`: "It is sorted by price in asc order." The wire contradicts it for bids | S1, P2 |
| `timestamp` | JSON integer in nanoseconds, 19 digits, so a double loses the last two or three | P2 |
| age of `timestamp` at receipt | 40 to 81 ms on 20 polls of 89 to 134 ms, and up to 197 ms on the replies of 1,000 levels or more | P2 |
| caching | 10 polls 1.1 s apart gave 10 distinct timestamps, and `cf-cache-status: DYNAMIC` | P2 |
| empty book | `{"asks":[],"bids":[],"timestamp":1790138993451242856}` on `CLV-BRL` with 200 | P4 |

The legacy `GET https://www.mercadobitcoin.net/api/BTC/orderbook/`, which CCXT's `fetchOrderBook` calls at `mercado.js` lines 371 to 380, returned the whole book, 774 bids and 1,347 asks and then 776 and 1,356, with prices and sizes as JSON numbers, bids descending and asks ascending, and keys `asks`, `bids` and `timestamp` (P2).

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| total | "The default rate limit total: 500 requests/min.", private and public together | S1 |
| each public call | "Rate Limit: 1 requests/sec" on `/symbols`, `/tickers`, `/{symbol}/orderbook`, `/{symbol}/trades`, `/candles`, `/{asset}/fees` and `/{asset}/networks` | S1 |
| what a limit returns | error codes `REQUEST_RATE_EXCEEDED` "Request rate exceeded the request limit in the range", `REQUEST_DENIED` "Request denied: high request rate or invalid request" and `REQUEST_BLOCKED` "Requests temporarily blocked", with no status code documented | S1 |
| probed | not provoked. No `Retry-After` and no rate limit header appeared on any reply | P1 to P4 |
| CCXT | `rateLimit: 1000`, at `mercado.js` line 24 | S2 |

Error shape, from P4 in all three runs, except the missing `symbols` case, which only the third run made:

| request | status | body |
|---|---|---|
| `/api/v4/NOPE-BRL/orderbook` | 400 | `{"code":"PUBLIC_DATA\|GET_ORDERBOOK\|INVALID_BASE_QUOTE","message":"This BASE-QUOTE is invalid or not found"}` |
| `/api/v4/btc-brl/orderbook` | 400 | the same, so the symbol is case sensitive |
| `/api/v4/BRLBTC/orderbook` | 404 | `{"code":"API\|ROUTE_NOT_FOUND","message":"This route not found"}` |
| `/api/v4/BTC-BRL/orderbook?limit=5000` | 400 | `{"code":"PUBLIC_DATA\|GET_ORDERBOOK\|LIMIT_MAX_ALLOWED","message":"Max limit allowed is 1000."}` |
| `/api/v4/tickers` without `symbols` | 400 | `{"code":"PUBLIC_DATA\|LIST_TICKERS\|SYMBOLS_IS_REQUIRED","message":"The param {symbols} must not be empty"}` |
| `/api/v4/nope` | 404 | `{"code":"API\|ROUTE_NOT_FOUND","message":"This route not found"}` |
| `/api/NOPE/orderbook/` (v3) | 404 | `{"code":"API\|COIN_NOT_FOUND","message":"This coin not found"}` |

The documented shape is `{"code": "DOMAIN|MODULE|ERROR", "message": …}` (S1), and every reply matched it.

## 7. Server time and clock offset

The v4 API has no server time call (S1), and CCXT declares no `fetchTime` for this venue (S2).
The `Date` header has one second resolution and read 50 to 1,019 ms behind the local receive time over 29 replies, which is that resolution plus the reply's travel time.
The book's nanosecond `timestamp` was 40 to 81 ms old on arrival for requests of 89 to 134 ms, and the WebSocket `ts` was 41 to 57 ms old at a median against a pong round trip of 85 to 105 ms, see [`websocket.md`](./websocket.md) section 5.
Both put the venue clock within about 10 ms of this host's, which is an inference from one-way delay being half the round trip.

## 8. Recommended poller shape

No anchor poller is recommended, because the venue publishes no index, mark or funding.

If a spot feed is ever built, two REST calls help it, and neither is an anchor:

| item | recommendation | reason |
|---|---|---|
| book seed | `GET /api/v4/{BASE}-BRL/orderbook?limit=20` once per market after subscribing, spaced 1.1 s apart | the WebSocket sends no snapshot on subscribe, see [`websocket.md`](./websocket.md) section 4, and the call is limited to 1 request per second |
| touch for quiet books | `GET /api/v4/tickers?symbols=<all>` every few seconds | one call carries the best bid and ask of all 409 `CRYPTO` markets, median 113 to 129 ms |
| skip | rows whose `buy` or `sell` is 0 | 37 of 409 rows had at least one side at 0, and 32 of them both, in the third P3 run |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Mercado Bitcoin API v4 reference, `swagger.yaml` version v5.36.1, rendered at `/api/v4/docs` | https://api.mercadobitcoin.net/api/v4/docs/swagger.yaml | 2026-09-22 | Mercado Bitcoin, Brazil | public paths and parameters, response fields, rate limits, error codes, sections 2 to 7 |
| S2 | CCXT 4.5.68 `mercado.js` | `server/node_modules/ccxt/js/src/mercado.js` | 2026-09-22 | CCXT | catalog mapping, constants, sections 2, 3, 5 and 6 |
| P1 | `rest-probe.mjs catalog`, at 04:30 and 04:41 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/mercado/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | DNS, catalog counts, CCXT fields, sections 1 and 2 |
| P2 | `rest-probe.mjs book`, at 04:30 and 04:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/mercado/rest-probe.mjs) | 2026-09-22 | this host | the REST book, ticker against book, section 5 |
| P3 | `rest-probe.mjs ticker`, at 04:30, 04:42 and 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/mercado/rest-probe.mjs) | 2026-09-22 | this host | bulk ticker cadence and size, sections 3 and 4 |
| P4 | `rest-probe.mjs errors`, at 04:31, 04:42 and 04:49 UTC, the last run with the empty book and the missing `symbols` cases added | [`rest-probe.mjs`](../../../scripts/probes/venues/mercado/rest-probe.mjs) | 2026-09-22 | this host | error shapes, `Date` header, sections 6 and 7 |
