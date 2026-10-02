# HashKey Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 01:25 to 01:58 UTC on 2026-09-23, the last two runs a recheck of `main` and `poll` after the profiles were written, from the development host near Seattle.

This profile covers the public REST API of HashKey Exchange, site HK, at `https://api-pro.hashkey.com`, for its spot market, which is the researched product, see [`fees.md`](./fees.md) section 3.
The same host serves the MENA site when a call carries `site=MENA`, and the legacy host `https://api-glb.hashkey.com` serves HashKey Global, site `BMU`.
Both are recorded in short sections, because they are separate venues.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/rest-probe.mjs), run from `server/`, unless a row names `dig` or `curl`.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.

## 1. Host and latency from this machine

| host | resolved on 2026-09-23 01:25 UTC by `dig` | edge |
|---|---|---|
| `api-pro.hashkey.com` | CNAME `api-pro.hashkey.com.cdn.cloudflare.net`, then `d26zvdjhliltec.cloudfront.net`, 4 addresses in `99.86.101.0/24` | CloudFront POP `SEA900-P13`, origin `server: openresty`, every 200 reply `x-cache: Miss from cloudfront` |
| `stream-pro.hashkey.com` | CNAME `stream-pro.hashkey.com.cdn.cloudflare.net`, then `dz621uibxkqus.cloudfront.net`, 4 addresses in `143.204.160.0/24` | |
| `api-glb.hashkey.com` | CNAME `api-glb.hashkey.com.cdn.cloudflare.net`, then `d6lddq4f82n4h.cloudfront.net`, 4 addresses in `52.85.129.0/24` | |

| call | cold, new TLS each | warm, one kept-alive connection |
|---|---|---|
| `GET /api/v1/time` | 512, 496 and 489 ms, and 508, 494 and 483 in the recheck | 20 calls: min 159, median 421, p90 453, max 462 ms, and min 161, median 174, p90 458, max 466 in the recheck |
| `GET /quote/v1/depth?symbol=BTCUSD&limit=20` | | 10 calls in the recheck: min 159, median 168, max 438 ms |
| `GET /quote/v1/ticker/bookTicker`, all pairs | | 40 polls: min 157, median 167, p90 458, max 489 ms, and min 154, median 164, p90 438, max 448 in the recheck |
| `GET /api/v1/exchangeInfo` | | 589 and 576 ms for 109 KB |

Warm replies fall into two classes, about 150 to 175 ms and about 420 to 470 ms, on every endpoint.
The same call can land in either class: `ticker/24hr` took 437 ms in the first run and 157 ms in the recheck, and `/api/v1/time` had a median of 421 ms in one run and 174 ms in the other.
Section 7 shows that the slow class adds its delay before the server stamps its time, so the extra 280 ms or so sits between the edge and the origin, which is an inference.
No call was refused from this host, and no geoblock was met on any public call.

## 2. Catalog

### The instruments call

`GET /api/v1/exchangeInfo` returns the whole site in one reply, S1.

| field | HK site on 2026-09-23 01:33 UTC |
|---|---|
| `site` | `"HK"`, and `?site=HK` returns the same symbols as no parameter |
| `symbols`, spot | 38, all `status` `TRADING` |
| quote assets | USD 27, HKD 5, FDUSD 2, USDT 2, USDC 2 |
| `retailAllowed` | 7 pairs, see [`fees.md`](./fees.md) section 1 |
| `contracts` | 1, `BBTCUSD-PERPETUAL`, `TRADING`, base `BBTC`, index `BBTC`, margin `USD`, `contractMultiplier` `0.001`, `inverse` false, 20 risk limit tiers |
| `options` | 0 |
| `coins` | 87 |
| reply | 109,372 bytes |

Each spot row carries `PRICE_FILTER`, `LOT_SIZE`, `MIN_NOTIONAL`, `TRADE_AMOUNT`, `LIMIT_TRADING`, `MARKET_TRADING` and `OPEN_QUOTE` filters.
On `BTCUSD` the tick is 0.01, the step 0.00001 BTC, and one order is capped at 16 BTC and USD 400,000.
`LIMIT_TRADING` carries `buyPriceUpRate` and `sellPriceDownRate`, 0.2 on `AAVEUSD` and 0.03 on the contract, a band around a reference price that S1 does not define.

The bulk `bookTicker` reply lists 56 rows: the 38 catalog pairs, and 18 pairs outside the catalog whose bid and ask are `"0"`, among them `BTCUSDC`, `ETHUSDC`, `MATICUSD` and `USDTTRC20USD`, read with `curl` at 01:34 UTC.
The reply omits `BBTCUSD-PERPETUAL`.
In the recheck 19 of the 56 rows read `"0"` on both sides, and which row was the extra one is not recorded.
`ticker/24hr` lists 39 rows, the 38 pairs and `SUIUSDT`, which is not in the catalog.
So a poller keys on the catalog, never on a ticker reply.

### How the engine's catalog would map it

There is no CCXT class for HashKey Exchange, see [`fees.md`](./fees.md) section 8, so the engine's catalog, `loadMarkets` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68 filtered to active swaps at lines 196 to 203, has nothing to load for this venue.
CCXT's `hashkey` class, which targets HashKey Global, reads the same `exchangeInfo` layout: its `fetchMarkets` concatenates `symbols` and `contracts` at `server/node_modules/ccxt/js/src/hashkey.js` lines 862 and 863.
Pointed at `https://api-pro.hashkey.com`, it loaded the HK site, P1.

| item | value with `urls.api` pointed at the HK host |
|---|---|
| spot markets | 38, and every `market.id` equals a catalog `symbol` |
| swap markets | 1, `BBTC/USD:USD`, id `BBTCUSD-PERPETUAL`, `active` true, `linear` true, `contractSize` 0.001 from `contractMultiplier` at line 1058 |
| `active` | `status === 'TRADING'`, line 1038 |
| market id against the socket | identical, see [`websocket.md`](./websocket.md) section 3 |
| size unit | base currency for spot, contract size 1 |
| pairs one quote family would hold twice | `BTCUSD` and `BTCUSDT`, `ETHUSD` and `ETHUSDT`, `USDTUSD` and `USDTUSDC` fold into one pair each under [`quoteFamily.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/quoteFamily.ts) lines 3 to 6. HKD and FDUSD pairs stay outside the family |
| price scale | none needed, prices are per coin |

The one swap CCXT would load is active in CCXT's eyes and has an empty book, so the connector would take `BBTC/USD:USD` as a live market whose base no other venue lists.

### Sister site catalogs

| call | rows on 2026-09-23 01:33 UTC | note |
|---|---|---|
| `GET /api/v1/exchangeInfo?site=MENA` on `api-pro` | `site` `MENA`, 9 spot quoted in AED 3, USD 3, USDT 2, USDC 1, and 6 USDT-M perpetuals | 155,472 bytes, 862 ms. The perpetuals are `SOXLUSDT`, `QQQUSDT`, `BTCUSDT`, `ETHUSDT`, `SKHYNIXUSDT` and `SPCXUSDT`, each with `-PERPETUAL`, `contractMultiplier` 0.01 on the equity ones and 0.001 on BTC and ETH |
| `GET /api/v1/exchangeInfo` on `api-glb` | `site` `BMU`, 31 spot all quoted in USDT, 2 perpetuals `BTCUSDT-PERPETUAL` and `ETHUSDT-PERPETUAL` | 112,591 bytes, 580 ms. This is what CCXT `hashkey` loads by default: 31 spot and 2 swaps |

The MENA site moved from `api-glb.hashkey.com` to `api-pro.hashkey.com` in July 2026, S1.
Its perpetual books were live: `BTCUSDT-PERPETUAL`, `ETHUSDT-PERPETUAL` and `QQQUSDT-PERPETUAL` each returned 20 levels a side.

## 3. Anchor

HashKey Exchange spot publishes no index, no mark and no funding rate, and nothing to anchor a spot pair.

| call | documented | wire on 2026-09-23 UTC |
|---|---|---|
| `GET /quote/v2/markPrice?symbol=` | one contract per call, `{"symbolId", "price", "time"}`, S1 | `BBTCUSD-PERPETUAL` answers 200 with a price. A spot pair answers 400 `{"code":-100011,"msg":"Not supported symbols"}`, and no `symbol` answers 400 `-100012` |
| `GET /quote/v1/markPrice?symbol=` | not in S1, in CCXT's list | same reply as v2 |
| `GET /quote/v2/index` | `{"index": {...}, "edp": {...}}`, S1 | 404 `{"code":404,"msg":"No static resource quote/v2/index."}` with or without `symbol` |
| `GET /quote/v1/index` | not in S1, in CCXT's list | 404, same body, also with `site=MENA`. On `api-glb` it answers 200 `{"index":{"BTCUSDT":"86622.9"},"edp":{"BTCUSDT":"86627.3661711"}}` |
| `GET /api/v1/futures/fundingRate`, `/historyFundingRate` | not in S1, in CCXT's list | 404 with an HTML body. On `api-glb` the rate call answers 400 `{"code":"0001","msg":"Required field timestamp missing or invalid"}` |

The reference prices the HK site does publish are the last trade, as `c` in `ticker/24hr` and `p` in `ticker/price`, and the band reference in `LIMIT_TRADING`.
None of those is an index of other venues.
This profile recommends no anchor poller for HashKey Exchange.

## 4. Anchor semantics

Not applicable to HK spot.
For the record, three readings about the one contract and the documented index.

- `BBTCUSD-PERPETUAL` mark: over 40 one-second polls its `time` stood on whole seconds and advanced one second per second, and its price changed on 10 and 7 of 39 intervals, P2.
  The recheck read the same second twice on 4 polls and skipped a second on others, which is poll jitter against a 154 to 448 ms reply.
  Its last value, 86381.4, sat 28 above the `BTCUSD` best bid of 86353.33 read in the same second, and 86260.7 sat 23 below 86283.93 in the recheck, so the mark follows BTC although its own book is empty.
- The documented index reply carries `edp`, "The average of the index for the last 10 minutes", S1.
  No formula, basket or clamp for index or mark is published in S1.
- The MENA mark for `BTCUSDT-PERPETUAL` arrived once with 18 decimal places, `"86586.535072463768202563"`, and once with one, `"86234.6"`, P1.

No funding history exists to read, and no settlement instant was captured.

## 5. REST book snapshot

`GET /quote/v1/depth?symbol=<id>&limit=<n>`, S1.

| request | reply |
|---|---|
| no `limit` | 100 bids and 100 asks on `BTCUSD` |
| `limit=200`, `201` or `1000` | 100 and 100. S1 says "Maximum value is 200. Default is 100." |
| `limit=20` | 20 and 20, 941 and 931 bytes |
| `XDCUSD`, `limit=200` | 16 bids and 17 asks, all it had |
| `BBTCUSD-PERPETUAL` | `{"t":…,"b":[],"a":[]}`, 33 bytes, `t` 276 s and 174 s old in the two runs |
| `limit=abc` | 400 `{"code":-100002,"msg":"Param limit should be int."}` |
| `NOPEUSD` | 400 `{"code":-100011,"msg":"Not supported symbols"}` |
| no `symbol` | 400 `{"code":-100012,"msg":"Parameter symbol [String] missing!"}` |
| `GET /quote/v1/depth/merged?symbol=BTCUSD&limit=20` | 20 and 20 |

Bids are best first and descending, asks best first and ascending, on every reply.
Sizes are in the base currency.
`t` is the time of the book's last change: it was 0.3 to 4.9 s before arrival on `BTCUSD` over the two `main` runs.
Two reads 160 ms apart returned identical bodies with the same `t`, and CloudFront reported `Miss` on both, so this is the book not changing rather than a cache, as far as one pair of reads shows.
The REST book matched the socket's top 20 on 36 to 40 of 40 levels, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| limit unit | a weight per endpoint, and "each API Key has a default rate limit of 5 requests per second for query-related endpoints, while order-related endpoints allow 20 requests per second", S1 | no per IP limit for public calls is published. The probe stayed at two requests a second, and nothing was refused |
| over the limit | HTTP 429, and 418 for an IP that keeps sending after a 429, S1. For orders: "Please wait 1 minute for the suspended period to expire." | not triggered |
| `Retry-After` | not documented | not seen. No reply carried a rate limit header |
| error shape | an error code table with HTTP status and message, S1, which does not list the quote codes seen here | 400 with `{"code":-100011,…}`, `-100012`, `-100002`, `-10009` for a bad kline interval. An unknown path answers 404 with `<html><body><h2>404 Not found</h2></body></html>` under `content-type: application/json`. A documented but unrouted path answers 404 `{"code":404,"msg":"No static resource …"}` |
| edge on errors | | every 4xx carried `x-cache: Error from cloudfront` |

`exchangeInfo` has weight 5 and the market calls weight 1 in CCXT's table at `hashkey.js` lines 195 to 208.

## 7. Server time and clock offset

`GET /api/v1/time` returns `{"serverTime": <ms>}`, S1.
Over 20 warm calls the midpoint estimate of the offset, server minus host, ran from 1 to 149 ms with a median of 137 ms, and from -2 to 152 ms with a median of 4 ms in the recheck.
The midpoint is only good to half the round trip, and the round trips were 159 to 466 ms.
The call with the shortest round trip, 161 ms in the recheck, gave an offset of -2 ms, P1.
The fast calls read an offset of a few ms and the slow ones about 140 to 150 ms, so the host clock is within a few ms of the server's, and a slow call spends its extra time before the server stamps it.

## 8. Recommended poller shape

None.
HashKey Exchange spot publishes no index, mark or funding for any pair, and its one contract is not live, so there is no anchor to poll.
If the HK contract goes live, the calls that exist today are `GET /quote/v2/markPrice?symbol=` one contract at a time, with a 1 s grid, and no index or funding call answers on this host.
A future poller would need a bulk mark, an index and a funding call that the HK host does not serve on 2026-09-23.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | HashKey Exchange API reference | https://docs.hashkey.com/hk/en/ | 2026-09-22 | HashKey Exchange | endpoints, parameters, weights, rate limits, error codes, the MENA move, sections 2 to 7 |
| S2 | HashKey Exchange API documentation on ReadMe, Get Order book and Get Exchange Information | https://hashkeypro-apidoc.readme.io/reference/get-order-book | 2026-09-22 | HashKey Exchange | the older copy, which names S1 as the new site |
| S3 | CCXT 4.5.68 `hashkey.js` | `server/node_modules/ccxt/js/src/hashkey.js` | 2026-09-22 | CCXT | endpoint list and weights, market parsing, section 2 |
| P1 | `rest-probe.mjs main` at 01:33 UTC, and the recheck at 01:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs poll` at 01:40 UTC, and the recheck at 01:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 and 4 |
| P3 | `dig +short` of the three hosts at 01:25 UTC | | 2026-09-23 UTC | this host | section 1 |
