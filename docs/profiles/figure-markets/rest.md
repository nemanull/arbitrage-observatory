# Figure Markets REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:39 UTC for the first pass and 04:48 to 04:53 UTC for the second pass, from the development host near Seattle, through its Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of Figure Markets, whose catalog holds spot markets only, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/figure-markets/rest-probe.mjs) or from a ledger source.
Trading for BTC, ETH, SOL, LINK, UNI and XRP ends on 2026-09-23 at 12:00 UTC, about seven hours after these probes, see [`fees.md`](./fees.md) section 1.
Source ids are shared across the three files of this profile.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| documented base | `https://api.figuremarkets.com/public`, paths `/v1/...` | S1 |
| base the web app uses | `https://www.figuremarkets.com/service-hft-exchange/api/v1`, which returns the same markets reply | S16, P1 |
| resolved address | `34.117.204.231` for both `api.figuremarkets.com` and `www.figuremarkets.com` | P1 |
| front | `server: kong/3.11.0.13-enterprise-edition` and `via: 1.1 kong/3.11.0.13-enterprise-edition, 1.1 google`, a Google load balancer in front of a Kong gateway | P1 |
| cold request, `GET /public/v1/markets?size=50` | 305, 331 and 368 ms over the first three runs, 43,030 to 43,032 bytes, 29 rows | P1 |
| warm requests, same call | 150 to 248 ms over twelve | P1 |
| cold and warm on the web app base | 254 to 318 ms, then 147 to 294 ms, 29 rows | P1 |
| 60 one second polls of `GET /public/v1/markets?size=50&market_type=CRYPTO` | min 112, median 147, p90 203, max 374 ms in the first pass, and min 113, median 141, p90 182, max 222 ms in the second, 0 over 1 s, 0 failures, 28,386 bytes | P3 |
| access | every public call answered 200 from the Canadian exit, and no geoblock or refusal was seen | P1 to P5 |
| host root | `https://api.figuremarkets.com/` returned 401 with an empty body | curl at 04:23 UTC |

## 2. Catalog

### The instruments call

`GET https://api.figuremarkets.com/public/v1/markets` returns `{"data": [...], "pagination": {...}}`, S2.
With no `size` it returned all 29 markets on one page, `{"page":1,"size":29,"totalPages":1,"totalCount":29}`, and `size` above 50 is refused with 400 `"getAllMarkets.size: Size must be less than or equal to 50"`, P4.
The filter `market_type=CRYPTO` returns the crypto markets only, and the documented values are `ATS`, `CRYPTO`, `FUND`, `VIRTUAL_YLDS` and `CONNECT`, S9.

| count on 2026-09-23 04:38 UTC | value |
|---|---|
| all markets | 29 |
| by type | `CRYPTO` 17, `CONNECT` 8, `FUND` 3, `ATS` 1 |
| crypto by quote | USD 9, USDC 7, USDT 1 |
| by status | `OPEN` 29 |
| perpetuals | 0 |

The documented status values are `UNKNOWN_MARKET_STATUS`, `PENDING`, `OPEN`, `CLOSED`, `PREOPEN`, `SUSPENDED`, `EXPIRED`, `TERMINATED`, `HALTED` and `MATCH_AND_CLOSE`, S9.

| crypto market | tick | step | taker | 24 h trades | 24 h volume, USD |
|---|---|---|---|---:|---:|
| `BTC-USD-2S` | 0.1 | 0.00001 | 0.001 | 21 | 102,973 |
| `ETH-USD` | 0.01 | 0.0001 | 0.001 | 6 | 37,734 |
| `SOL-USD` | 0.01 | 0.0001 | 0.001 | 45 | 33,137 |
| `XRP-USD` | 0.0001 | 0.01 | 0.001 | 1,586 | 315,702 |
| `UNI-USD` | 0.001 | 0.001 | 0.001 | 1,911 | 86,040 |
| `LINK-USD` | 0.001 | 0.001 | 0.001 | 0 | 0 |
| `HASH-USD` | 0.001 | 0.001 | 0.001 | 9 | 653 |
| `USDC-USD`, `USDT-USD` | 0.0001 | 0.01 | 0 | 6 and 2 | 108,843 and 7 |
| `BTC-USDC-2S` | 0.1 | 0.00001 | 0.001 | 3 | 10,999 |
| `ETH-USDC`, `SOL-USDC`, `LINK-USDC`, `HASH-USDC` | as the USD pair | as the USD pair | 0.001 | 0 each | 0 each |
| `UNI-USDC` | 0.001 | 0.001 | 0.001 | 1,554 | 69,051 |
| `XRP-USDC` | 0.0001 | 0.01 | 0.001 | 264 | 69,011 |
| `USDC-USDT` | 0.0001 | 0.01 | 0 | 0 | 0 |

The 24 h volume is in quote units: `BTC-USD-2S` reported `volume24h` 102,973 and `baseVolume24h` 1.19762 BTC, P1.
The 24 h figures did not move between 04:24 and 04:48 UTC, and the trades call explains why: the books are quoted but rarely traded.

| market | last trade, `GET /public/v1/trades/{symbol}?size=1` at 04:48 UTC |
|---|---|
| `BTC-USD-2S` | 2026-09-23 01:15:14 UTC, 0.00184 BTC at 86,708.3 |
| `ETH-USD` | 2026-09-22 21:12:46 UTC, 2 ETH at 2,749.76 |
| `XRP-USD` | 2026-09-23 02:50:14 UTC, 21.97 XRP at 1.5936 |
| `UNI-USD` | 2026-09-22 21:27:44 UTC, 0.952 UNI at 9.445 |

Each match carries a `settlementTxHash`, the Provenance transaction that settled it, P1.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no class for the venue, and the master branch has none either, see [`fees.md`](./fees.md) section 8.
The connector builds its catalog from CCXT `loadMarkets` and keeps active swaps only, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 68 and 79, so this catalog would need a loader of its own before the engine could see it.

| engine field | what the venue offers |
|---|---|
| `rawMarketId` | `symbol`, such as `BTC-USD-2S`, which is exactly what the socket takes, see [`websocket.md`](./websocket.md) section 3. `displayName` `BTC-USD` is not the id |
| `base`, `quote` | `denom` and `quoteDenom` |
| `linear`, `contractSize` | not applicable to spot. Book sizes are base units, so a size multiplier of 1 |
| `active` | `status` `OPEN` |

### Size unit, pairs listed twice, and price scale

Book sizes are base asset units on both REST and the socket, and the two books matched level for level, see [`websocket.md`](./websocket.md) section 4.
Each of BTC, ETH, SOL, LINK, UNI, XRP and HASH is listed against USD and USDC, which the engine treats as one settlement family, so a `marketFilter` would have to keep one of each pair.
The two BTC markets carry the suffix `-2S`, whose meaning is Not publicly specified.
No market is quoted per 10 or per 1,000 units.

## 3. Anchor

Figure Markets publishes no mark price and no funding rate, because it lists no perpetual.
It does publish an `indexPrice` on every market, which the OpenAPI spec calls "Oracle index price", S9, and an undocumented `exchangePrice`.

| `AnchorRow` column | field | call |
|---|---|---|
| key | `symbol` | `GET /public/v1/markets` |
| `index` | `indexPrice`, a decimal string, one value per base asset | same call, and the `MARKET` socket channel |
| `mark` | none | none |
| `fundingRate` | none | none |
| `fundingIntervalHours` | none | none |
| `nextFundingAt` | none | none |

One call returns every market's index: 43,030 bytes for all 29 markets, or 28,386 bytes for the 17 crypto markets in 141 and 147 ms at the median of 60 polls in the two passes, P1 and P3.
`GET /public/v1/assets/{name}/price` needs a `time` parameter and answered 400 `"Required parameter 'time' is not present."` without it, P4.

## 4. Anchor semantics

There is no mark, funding, cap or settlement to record.
What the index is, from the wire:

| observation | value | source |
|---|---|---|
| one index per base | `BTC-USD-2S` and `BTC-USDC-2S` both read `indexPrice` `87155.1` in the same reply | P1 |
| index against an outside market | BTC index `87133.2` against a Coinbase Exchange BTC-USD mid of `87135.015`, -0.2 bps, and `87200.3` against `87204.585`, -0.5 bps, one read at the end of each poll run | P3 |
| index against the venue's own mid | medians of -0.3 and -0.3 bps on BTC, 0.1 and 0.1 on ETH, 0 and 0.4 on SOL, 0.6 and 0.3 on XRP, 0 and -1 on UNI, -0.8 and 0.4 on LINK, over 60 polls in each pass, and within 8.6 bps either way on every poll | P3 |
| `exchangePrice` | equal to `indexPrice` on 60 of 60 polls in both passes for BTC, ETH, SOL, XRP, UNI and LINK, and different on HASH, `0.008` against `0.007` | P1, P3 |
| HASH index | `0.007` on all 60 polls of both passes, 666.7 bps under its mid of 0.0075, in a book of 0.007 bid and 0.008 ask, one tick apart | P3 |
| web app chart feed | `DATAFEED_SOURCE` `pyth` for every location in the exchange bundle, and a `pyth.dourolabs.app` URL in the same bundle | S16 |

The index sat within a fraction of a basis point of Coinbase, and the venue's own quotes sat around it, which fits a market maker quoting around an outside oracle.
That the oracle is Pyth is an inference from the bundle, and no page states the source or the basket.

How often each number changed over 59 steps of one second polls, first pass and then second pass, P3:

| market | `indexPrice` changed | mid changed | best bid changed |
|---|---:|---:|---:|
| `BTC-USD-2S` | 28 and 18 | 30 and 12 | 18 and 7 |
| `ETH-USD` | 33 and 31 | 44 and 39 | 38 and 26 |
| `SOL-USD` | 18 and 13 | 30 and 31 | 21 and 16 |
| `XRP-USD` | 26 and 32 | 19 and 21 | 17 and 17 |
| `UNI-USD` | 26 and 27 | 35 and 34 | 32 and 30 |
| `LINK-USD` | 16 and 11 | 28 and 19 | 16 and 17 |
| `HASH-USD` | 0 and 0 | 0 and 0 | 0 and 0 |

## 5. REST book snapshot

`GET /public/v1/markets/{symbol}/orderbook`, with `depth`, where 0 or absent means every level, and `level`, where 1 is the best bid and ask, 2 is aggregated by price, the default, and 3 is every order without aggregation, S9.

| query on `BTC-USD-2S` | reply | levels | time |
|---|---|---|---|
| none | `{"timestamp", "asks", "bids"}`, levels `{"price", "quantity", "totalQuantity"}` as JSON numbers | 10 bids, 10 asks | 184 and 194 ms |
| `depth=3` | same shape | 3 and 3 | 102 and 103 ms |
| `depth=0` | same shape | 10 and 10 | 96 and 105 ms |
| `level=1` | same shape | 1 and 1 | 94 and 105 ms |
| `level=3` | levels `{"price", "quantity"}` | 10 and 10 | 260 and 275 ms |
| `level=2&depth=20` | same as none | 10 and 10 | 113 and 106 ms |

Bids came descending and asks ascending on every read of both passes, and `totalQuantity` is the running sum from the top, P2.
The `timestamp` has nanoseconds, `2026-09-23T04:38:20.116072459Z`.
Four reads back to back returned four different timestamps in each pass, and no reply carried a cache header, so the book is not cached, P2.
The same call on the web app base returned the same shape, P2.
The socket spells the same levels as strings and names the running sum `total`, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

The limits are not published.
The documentation says "Public REST is commonly limited per IP", that "Exact thresholds can change and may differ by route or customer arrangement", and that a limited client gets 429 and should "Respect any Retry-After header or guidance in the response when present", S7.
No reply carried a rate limit header, and 120 polls at one per second over the two passes drew no 429, P1 and P3.

| request | status | body | source |
|---|---|---|---|
| `/public/v1/markets/NOPE-USD` | 404 | `{"errors":[""]}` | P4 |
| `/public/v1/markets/NOPE-USD/orderbook` | 404 | `{"errors":["No market for NOPE-USD"]}` | P4 |
| `orderbook?depth=abc` | 400 | `{"type":"about:blank","title":"Bad Request","status":400,"detail":"Failed to convert 'depth' with value: 'abc'","instance":"/service-hft-exchange/unsecure/api/v1/markets/BTC-USD-2S/orderbook"}` | P4 |
| `orderbook?level=9` | 400 | `{"errors":["Invalid order book level: 9"]}` | P4 |
| `markets?size=100` | 400 | `{"errors":["getAllMarkets.size: Size must be less than or equal to 50"]}` | P4 |
| `/public/v1/nope` | 404 | `{"type":"about:blank","title":"Not Found","status":404,"detail":"No static resource unsecure/api/v1/nope.","instance":"/service-hft-exchange/unsecure/api/v1/nope"}` | P4 |
| `https://api.figuremarkets.com/v1/markets`, without `/public` | 401 | empty | P4 |

The documented codes are 400, 401, 403, 410 for a deprecated partner route, 429 and 5xx, S8.
The web app reads `https://www.figuremarkets.com/exchange/api/config/current` every 10 s for flags such as `EXCHANGE_MAINTENANCE`, `IS_TRADE_ENABLED` and the wind-down date, S16, and it answered 200 to a plain read, P1.

## 7. Server time and clock offset

No server time call is published, S9.
The order book `timestamp` gives the offset: over ten reads, server minus local at the request midpoint was min -3, median 3 and max 30 ms in the first pass, and min -2.5, median 5 and max 44 ms in the second, with round trips of 88 to 206 ms, P5.
So this host's clock is within a few milliseconds of the venue's at the median.
On the socket, arrival minus `MARKET` `publishTime` was 38 to 316 ms with medians of 133 and 141 ms in the first pass, and 50 to 300 ms with medians of 102 and 122 ms in the second, which is transit plus the wait for the publish tick, see [`websocket.md`](./websocket.md) section 4.

## 8. Recommended poller shape

None.
Figure Markets publishes no mark and no funding, so it has no anchor poller, and the connector would find no swap market to keep, see [`fees.md`](./fees.md) section 9.
If a later design admitted spot legs, the `MARKET` socket channel already carries `indexPrice` with each best price change, and `GET /public/v1/markets?market_type=CRYPTO` once a second would be the one REST call worth polling for the index, at 141 to 147 ms median.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Public API, REST | https://www.figuremarkets.dev/api-docs/public-api/rest/ | 2026-09-23 UTC | Figure Markets | base URL, read-only, section 1 |
| S2 | Public API, Markets | https://www.figuremarkets.dev/api-docs/public-api/markets/ | 2026-09-23 UTC | Figure Markets | markets, order book and candle calls, section 2 |
| S7 | Rate limits and best practices | https://www.figuremarkets.dev/api-docs/reference/rate-limits/ | 2026-09-23 UTC | Figure Markets | per IP limits, 429 and `Retry-After`, section 6 |
| S8 | HTTP status codes | https://www.figuremarkets.dev/api-docs/reference/errors/ | 2026-09-23 UTC | Figure Markets | status codes, section 6 |
| S9 | Public API OpenAPI spec, version 1.0.0 | https://storage.googleapis.com/markets-exchange-docs/combined-public-spec.json | 2026-09-23 UTC | Figure Markets | parameters, `market_type` and status enums, `indexPrice` description, order book levels, sections 2 to 5 and 7 |
| S16 | Exchange web app bundle | https://www.figuremarkets.com/exchange/assets/index-DkaJSetJ.js | 2026-09-23 UTC | Figure Markets | web app base, config URL and 10 s refresh, Pyth chart feed, sections 1, 4 and 6 |
| P1 | `rest-probe.mjs catalog`, first pass 04:38 UTC, and second pass twice at 04:48 UTC and once at 04:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/figure-markets/rest-probe.mjs) | 2026-09-23 UTC | this host | DNS, timings, catalog, fees, last trades, config, sections 1 to 4 and 6 |
| P2 | `rest-probe.mjs book`, first pass 04:38 UTC and second pass 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/figure-markets/rest-probe.mjs) | 2026-09-23 UTC | this host | order book queries, order, caching, section 5 |
| P3 | `rest-probe.mjs poll`, first pass 04:38 to 04:39 UTC and second pass 04:49 to 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/figure-markets/rest-probe.mjs) | 2026-09-23 UTC | this host | poll timing, index changes, index against Coinbase, sections 1, 3 and 4 |
| P4 | `rest-probe.mjs errors`, first pass 04:38 UTC and second pass 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/figure-markets/rest-probe.mjs) | 2026-09-23 UTC | this host | error shapes, page size cap, section 2, 3 and 6 |
| P5 | `rest-probe.mjs time`, first pass 04:38 UTC and second pass 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/figure-markets/rest-probe.mjs) | 2026-09-23 UTC | this host | clock offset, section 7 |
