# CEX.IO REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:16 to 03:55 UTC, from the development host near Seattle, whose traffic Cloudflare's trace places in Canada (`loc=CA`, colo `YVR`).

This profile covers the public REST API of CEX.IO Spot Trading (CCXT id `cex`), for spot, since CEX.IO lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/cex/rest-probe.mjs), a CCXT file and line, or the source ledger.
The documentation (S1) redirects this host to a Canadian notice, so it was read as the Internet Archive copy of 2026-05-09, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| base URL | `https://trade.cex.io/api/spot/rest-public`, every call a `POST` with a JSON body | S1, and CCXT at `server/node_modules/ccxt/js/src/cex.js` line 127 |
| resolved address | `trade.cex.io`, `cex.io` and `ws.cex.io` each resolved to 104.20.25.69 and 172.66.166.209, Cloudflare | `rest-probe.mjs host`, 03:21 and 03:41 UTC |
| edge | `cf-ray` suffixes `YVR` and `SEA` on the same session, `cf-cache-status: DYNAMIC`, replies compressed with `br` | tag `server_time` |
| cold request | 632 and 669 ms for `get_server_time` | tag `latency`, two runs |
| warm request | 173 to 185 ms, median 181, in the first run, and 204 to 295 ms, median 217, in the second | tag `latency` |
| website | every `cex.io` and `trade.cex.io` page answered 302 to `https://cex.io/canadian-regulations/`, while every API path answered | [`fees.md`](./fees.md) section 1 |

## 2. Catalog

### The instruments call

`POST /get_pairs_info` with `{}` returns every pair, and `{"pair": ["BTC-USD"]}` narrows it, per S1.

| item | value | evidence |
|---|---|---|
| reply | 231,030 bytes, 898 rows, in 1,178 and 907 ms | tag `pairs_info`, 03:21 and 03:42 UTC |
| fields | `base`, `quote`, `baseMin`, `baseMax`, `baseLotSize`, `quoteMin`, `quoteMax`, `quoteLotSize`, `basePrecision`, `quotePrecision`, `pricePrecision`, `minPrice`, `maxPrice`, on all 898 rows | tag `pairs_info` `fieldCount` |
| status | no status or active field exists | same |
| by quote | 295 `USDT`, 287 `USD`, 210 `USDC`, 73 `EUR`, 19 `GBP`, 11 `BTC`, 3 `USD1` | tag `pairs_info` `byQuote`, both runs |
| perpetuals | none, CEX.IO lists none | [`fees.md`](./fees.md) section 3 |
| one-sided books | 50 of 898 pairs had no `bestBid` in `get_ticker`, among them `COW-USD`, `GMT-USD`, `ONG-USD`, `RPL-USD` and `XAI-USD`. None lacked a `bestAsk` and none was crossed | tag `ticker_all`, both runs |
| currencies | `get_currencies_info` returned 471 rows in 52,891 bytes | tag `currencies_info` |

Assets under a delisting notice stay in the catalog with no status to mark them.
`CLANKER-USD`, `DEXE-USDT` and 26 other pairs of the 19 assets whose purchases stopped on 2026-09-21 still showed a two-sided ticker at 03:17 UTC on 2026-09-23, see [`fees.md`](./fees.md) section 7.

### How CCXT 4.5.68 maps it

| field | value | evidence |
|---|---|---|
| `fetchMarkets` | one `publicPostGetPairsInfo`, and `loadMarkets` also calls `get_currencies_info` | `server/node_modules/ccxt/js/src/cex.js` lines 434 to 458, and `'fetchCurrencies': true` at line 60 |
| `market.id` | `base + '-' + quote` of the unified codes, commented "not actual id, but for this exchange we can use this abbreviation" | `server/node_modules/ccxt/js/src/cex.js` line 465 |
| `market.id` against the wire | equal to the raw `base-quote` of `get_pairs_info`, to the `get_ticker` keys and to the socket's `data.pair` on 898 of 898 pairs. No currency code is renamed and no id repeats | tag `ccxt_fields`, `idNotRaw` 0, `idNotTicker` 0, `renamed` empty, `dupIds` empty, both runs |
| `type` | `spot` on 898 of 898 | tag `ccxt_fields` |
| `contractSize`, `linear`, `active` | `undefined` on 898 of 898 | tag `ccxt_fields`, and `server/node_modules/ccxt/js/src/cex.js` lines 483, 485 and 515 |
| `taker`, `maker` | `undefined` on 898 of 898 | [`fees.md`](./fees.md) section 8 |
| `loadMarkets` time | 4,327 and 5,106 ms | tag `ccxt_load` |

### Pairs listed twice, and price scale

The USD family holds 792 pairs on 297 bases, and 286 of those bases are listed against more than one of `USD`, `USDT` and `USDC`, 209 against all three.
The engine takes one market per pair, so a spot integration would need a `marketFilter` that picks one quote per base, at [`types.ts`](../../../server/src/ccxt/types.ts) lines 14 to 16.
No pair is quoted per 10 or per 1000 units, since every spot price is per one unit of the base.

## 3. Anchor

CEX.IO publishes no index price, no mark price and no funding rate, because it lists no perpetual.
The only reference prices on the public API are in `get_ticker`: `bestBid`, `bestAsk`, `last`, `volume`, `volumeUSD` and `priceChangePercentage` (S1).
None of them is an index built from other venues.

`POST /get_ticker` with `{}` returns every pair in one reply, 130,761 to 130,782 bytes for 898 pairs in 204 to 805 ms over five calls.
S1 calls `last` the "Last indicative price", and on the wire it moves with the book, not with trades.
It equalled `bestAsk` in each of the seven ticker rows printed during the probes, for example `"bestAsk":"86875.1","last":"86875.1"`, and 741 and 777 of 898 pairs changed `bestBid`, `bestAsk` or `last` between calls 31 s apart while `volume` stayed put on six of seven watched pairs.

No anchor poller is recommended.
An `AnchorRow` for CEX.IO would have a mark of 0, and the reader refuses such a route at open with `anchor_no_mark`, at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) lines 37 and 38.

## 4. Anchor semantics

There is no index basket, mark formula, clamp or funding formula to record.
A settlement instant does not exist on spot, so none was captured.

How often the ticker changed, over three all-pair calls 31 s apart at 03:43 to 03:44 UTC:

| pair | `bestBid` | `bestAsk` | `last` | `volume` |
|---|---|---|---|---|
| `BTC-USD` | 1 | 2 | 2 | 0 |
| `BTC-USDT` | 2 | 2 | 2 | 0 |
| `ETH-USD` | 2 | 2 | 2 | 1 |
| `SOL-USD` | 2 | 2 | 2 | 0 |
| `XRP-USDT` | 2 | 2 | 2 | 0 |
| `ADA-USD` | 2 | 2 | 2 | 0 |
| `MSTRX-USDC` | 2 | 2 | 2 | 0 |

Each cell counts the changes over the two intervals, from tag `ticker_summary`.
A faster cadence could not be measured, because `get_ticker` answers 429 above about two calls a minute from this IP, see section 6.
The book socket shows the underlying pace instead: one increment a second per busy pair, see [`websocket.md`](./websocket.md) section 4.

The legacy host `https://cex.io/api` still answers the older public calls.
`/tickers/USD/USDT` returned 531 rows, and its `BTC:USD` `bid` and `ask` sat at the new book's touch, while `/last_price/BTC/USD` returned `"lprice":"68991.2"` at 03:35 and 03:42 UTC with the book near 86,700 to 86,900, so its trade-derived fields are stale.
CCXT 4.5.68 does not use the legacy REST host, see `server/node_modules/ccxt/js/src/cex.js` lines 126 to 129.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `POST /get_order_book` with `{"pair": "BTC-USD"}`, cost 1 point | S1 |
| reply | `{"ok":"ok","data":{"timestamp":<ms>,"currency1":"BTC","currency2":"USD","bids":[…],"asks":[…]}}`, about 1.1 to 1.2 KB | tag `rest_book`, `BTC-USD`, `ETH-USDT`, `ADA-USD`, two runs |
| depth | 20 levels per side on every call, the same window as the socket | tag `rest_book` |
| depth parameter | `depth` 0 returns 20 levels and `depth` 1 returns one. `depth` 5 answers 422 `{"error":"Parameter depth should be one of [0, 1]"}`. `limit` 5 is ignored and returns 20 | tags `rest_book_depth_param`, `rest_book_depth_value`, `rest_book_limit_param` |
| level order | bids descending and asks ascending, on every call | tag `rest_book` |
| numbers | price and amount strings | tag `rest_book` `types` |
| timestamp | integer ms, 253 to 567 ms older than the reply's arrival, reply time included, over three runs | tag `rest_book` `ageMs` |
| caching | two back-to-back `BTC-USD` calls about 180 ms apart returned the same body and `timestamp` in one of three runs and different ones in the other two, and the other pairs differed every time. That fits a book republished about once a second rather than an edge cache, since `cf-cache-status` was `DYNAMIC` | tag `rest_book` `secondSameBody` |
| lowercase pair | `{"pair": "btc-usd"}` is accepted and answers the `BTC-USD` book, unlike the socket | tag `error_case` `lowercase_pair` |
| time | 172 to 626 ms per call | tag `rest_book` `ms` |

## 6. Rate limits and errors

### Documented

"CEX.IO Spot Trading limits Public API calls to maximum of 100 points per minute", counted per IP, each call costing 1 point except `get_processing_info` at 10 (S1).
"When an API rate limit is exceeded, a 429 status will be returned", and service resumes "starting from the next calendar minute" (S1).
The help center article on API limits still states "600 requests every 10 minutes by default" and points to the legacy REST documentation (S2).

### On the wire

| call | pattern | result |
|---|---|---|
| `get_server_time` | 6 calls in about 4 s, twice | all 200 |
| `get_order_book` | 8, 8 and 10 calls in about 5 s, three runs | none refused on rate, and the one with `depth` 5 answered 422 each time |
| `get_ticker`, all pairs | 20 calls 3.2 s apart, 03:21:42 to 03:22:47 UTC | 3 answered 200, 17 answered 429 |
| `get_ticker`, seven named pairs | 10 calls 6.2 s apart, 03:36:14 to 03:37:12 UTC | 2 answered 200, 8 answered 429 |
| `get_ticker`, all pairs | 3 calls 31 s apart, 03:43:17 to 03:44:21 UTC | all 200 |

The 429 reply is 34 bytes, `{"error":"API rate limit reached"}`, with no `Retry-After` and no rate limit header.
Refusals did not end at the next calendar minute: in the second run the calls at 03:37:05 and 03:37:11 UTC were still refused.
In the first run service came back at about 03:22:31, roughly 60 s after the first of the two calls served before the refusals, which was the catalog run's call at 03:21:28.
In each refused stretch only two `get_ticker` calls were served per about 60 s, whether they named 7 pairs or all 898.
So on this IP `get_ticker` behaves as if it cost far more than its documented 1 point, or had its own counter of about two a minute.
Which of the two is true is Not verified, because telling them apart would take more refusals.
Both 429 stretches came from this probe's own pacing, before the pattern was known, and no call was made to provoke one.

### Error shapes

| request | status | body |
|---|---|---|
| unknown pair `NOPE-USD` | 422 | `{"error":"pair NOPE-USD is not supported"}` |
| missing `pair` | 422 | `{"error":"Mandatory parameter pair is missing"}` |
| unknown path `/get_nope` | 400 | `{"error":"Bad Request"}` |
| body that is not JSON | 400 | `{"error":"Bad Request"}` |
| `GET /get_server_time` | 200 | the normal reply, so `GET` is accepted where no body is needed |
| rate limit | 429 | `{"error":"API rate limit reached"}` |

Each case but the last was run twice, at 03:35 and 03:42 UTC, with the same result.

## 7. Server time and clock offset

`POST /get_server_time` returns `{"ok":"ok","data":{"timestamp":1790133677769,"ISODate":"2026-09-23T03:21:17.769Z"}}`.
Against the midpoint of each warm request the server read 5 to 9 ms ahead of this host in the first run, and 11 to 65 ms ahead in the second, where slower replies widened the error.
The cold requests read 225 and 249 ms, inflated by the handshake.

## 8. Recommended poller shape

None.
CEX.IO publishes no index, mark or funding, and the engine refuses a route whose mark is 0, see section 3.
The only bulk reference call, `get_ticker`, was served about twice a minute from this IP, while the reader refuses a reading older than 10 s, at [`anchorReading.ts`](../../../server/src/engine/opportunity/anchorReading.ts) line 5.
If a later design adds spot legs, the book socket is the source of prices, and REST is needed only for `get_pairs_info` at start.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CEX.IO Spot Trading API documentation, "Last updated: 2026-03-19", section "REST" and "Public API Calls" | `https://trade.cex.io/docs/`, read as `https://web.archive.org/web/20260509143348/https://trade.cex.io/docs/` because the live page answers this host with 302 | 2026-09-22 | CEX.IO, global | base URL, calls and costs, rate limit and status codes, ticker fields, sections 1 to 6 |
| S2 | REST and WebSocket API limits | https://support.cex.io/en/articles/4383495-rest-web-socket-api-limits | 2026-09-22, article updated 2026-08-31 | CEX.IO, global | the legacy API limit, section 6 |
| S3 | CCXT 4.5.68 `cex.js` | `server/node_modules/ccxt/js/src/cex.js` | 2026-09-22 | CCXT | catalog mapping, section 2 |
| P1 | `rest-probe.mjs host`, runs at 03:21 and 03:41 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cex/rest-probe.mjs) | 2026-09-23 | this host | sections 1 and 7 |
| P2 | `rest-probe.mjs catalog`, runs at 03:21 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cex/rest-probe.mjs) | 2026-09-23 | this host | sections 2 and 3 |
| P3 | `rest-probe.mjs ticker`, runs at 03:21 (20 all-pair calls), 03:36 (10 named-pair calls) and 03:43 UTC (3 all-pair calls) | [`rest-probe.mjs`](../../../scripts/probes/venues/cex/rest-probe.mjs) | 2026-09-23 | this host | sections 3, 4 and 6. The first two runs used earlier versions of the mode, and the script now runs the third |
| P4 | `rest-probe.mjs book`, runs at 03:35, 03:42 and 03:54 UTC, the last with the `depth` 0 and 1 cases, which two `curl` calls first found at 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cex/rest-probe.mjs) | 2026-09-23 | this host | section 5 |
| P5 | `rest-probe.mjs errors` and `legacy`, runs at 03:35 and 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cex/rest-probe.mjs) | 2026-09-23 | this host | sections 4 and 6 |
