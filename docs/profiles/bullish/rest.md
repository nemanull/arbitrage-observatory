# Bullish REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, where the production API answered HTTP 403 by location on every path, so the calls were captured on the SimNext test environment.

This profile covers the public REST API of Bullish (CCXT id `bullish`) for its USDC-settled linear perpetuals: the catalog, the anchor fields, the book snapshot, limits and clock.
Every claim carries a source row, a probe reference from [`rest-probe.mjs`](../../../scripts/probes/venues/bullish/rest-probe.mjs), or a CCXT file and line.
Production `api.exchange.bullish.com` refused this host, so every probed value below comes from `api.simnext.bullish-test.com`, the documented test environment, unless the row says production.
SimNext runs its own markets, so its catalog, prices and timings are not production numbers, and they stand only for the shape of each reply.

## 1. Host and latency from this machine

| host | resolved on 2026-09-22 | cold | warm | result |
|---|---|---|---|---|
| `api.exchange.bullish.com`, production | `104.18.24.158`, `104.18.25.158` and two IPv6 addresses, all Cloudflare | 76 and 98 ms | 12 to 23 ms | HTTP 403 on every path, P1 |
| `api.simnext.bullish-test.com`, SimNext | `104.18.10.21`, `104.18.11.21` and two IPv6 addresses, all Cloudflare | 292 to 780 ms | 194 to 284 ms, and one call of 702 ms | HTTP 200, P2 |
| `docs.exchange.bullish.com` | same addresses as production | 1,215 and 1,311 ms | | HTTP 200, P1 |

The production refusal is a 1,417 byte HTML page served by Cloudflare's Seattle or Vancouver edge, `cf-ray` ending in `-SEA` in the first run and `-YVR` in the second, whose text reads "The Bullish platform is not currently available in your location.", P1.
The page then points to a status page for service updates.
It came back on `/v1/time`, `/v1/markets`, `/v1/markets?marketType=PERPETUAL`, `/v1/markets/BTC-USDC-PERP/tick`, `/v1/markets/BTC-USDC-PERP/orderbook/hybrid`, `/v1/index-prices` and `/v1/history/markets/BTC-USDC-PERP/funding-rate`, P1.
CCXT's `loadMarkets` against production threw `ExchangeNotAvailable` on `GET https://api.exchange.bullish.com/trading-api/v1/assets 403 Forbidden`, P1.
The Bullish GI terms allow such blocking: "We may implement measures such as geo-blocking that are designed to prevent access to the Services from certain locations", see [`fees.md`](./fees.md) section 1.
No proxy, VPN or other route around the refusal was tried.
The documentation says "In GCP, generally our most optimal connection is to operate within asia-southeast1-a Availability Zone", S9, which is Singapore.

## 2. Catalog

### The instruments call

| call | rows | reply | status field |
|---|---|---|---|
| `GET /trading-api/v1/markets` | 2,874 on SimNext: 124 spot enabled, 82 spot disabled, 22 perpetual enabled, 25 perpetual disabled, 16 dated futures, 2,605 options | 3.16 MB, 234 and 244 ms, served from the Cloudflare cache with `cache-control: public, max-age=60` | `marketEnabled`, plus `createOrderEnabled`, `cancelOrderEnabled` and `amendOrderEnabled` |
| `GET /trading-api/v1/markets?marketType=PERPETUAL` | 47 on SimNext | 72 KB, 349 and 387 ms | same |

The production catalog could not be read.
CoinGecko listed 22 production perpetual pairs on 2026-09-22 and returned tickers for 19 of them, all `<base>-USDC-PERP`, see [`fees.md`](./fees.md) section 3.
All 47 SimNext perpetuals settle in USDC, with `contractMultiplier` `"1"`, P2.
A perpetual row carries `symbol`, `baseSymbol`, `quoteSymbol`, `underlyingBaseSymbol`, `underlyingQuoteSymbol`, `settlementAssetSymbol`, `contractMultiplier`, `tickSize`, `minQuantityLimit`, `maxQuantityLimit`, `openInterestLimitUSD`, `feeGroupId` and `feeTiers`, and no index, mark or funding field, P2 and S1.

### How CCXT 4.5.68 maps it

| CCXT field | source | value on the SimNext perpetuals | evidence |
|---|---|---|---|
| `id` | `symbol` | `BTC-USDC-PERP`, the same string as the socket's `data.symbol`, the tick's `symbol` and the REST paths | `server/node_modules/ccxt/js/src/bullish.js` line 773, P2 |
| `symbol` | `base/quote:settle` | `BTC/USDC:USDC` | lines 778 and 812, P2 |
| `contractSize` | `contractMultiplier` | 1 on 47 of 47 | line 811 |
| `linear` | `settle === quote` | true on 47 of 47 | line 813 |
| `active` | `marketEnabled` | true on 22 of 47 | line 885 |
| `taker`, `maker` | the class constant | `0.001` on 47 of 47 | lines 231, 232, 853 and 854, see [`fees.md`](./fees.md) section 8 |
| type | `marketType` `PERPETUAL` becomes `swap` | 47 swaps | line 893 |

No pair was listed twice among the 47 swaps, P2.
Book sizes are base units and `contractSize` is 1, so the engine's size multiplier is 1, see [`websocket.md`](./websocket.md) section 4.

### Pairs that need a rule before they could cluster

| market | what it is | effect on the engine | evidence |
|---|---|---|---|
| `SHIB1M-USDC-PERP`, and `PEPE1M-USDC-PERP` disabled on SimNext | one million tokens per unit, "Multiplied index price = Original asset index price * Multiplier" | the base `SHIB1M` matches no other venue's name, so it needs an alias and a price scale in `server/src/engine/cluster/clusterOverrides.ts` or it simply stays unmatched | S7 |
| `CD20`, `CD80`, `CD100`, `CDMEME` perpetuals | CoinDesk broad-market indices, "Unitless" | no counterpart on another venue | S6 |
| `CMWTI-USDC-PERP` | front-month WTI crude oil, 24/7 | a counterpart would need a commodity index check first | S6 |
| `GRAM-USDC-PERP` on SimNext, `TON-USDC-PERP` on CoinGecko | the help center announces a "Toncoin (TON) Rebranding to Gram (GRAM)" | the production ticker name decides whether it joins other venues' `TON` | S10 |

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time on SimNext |
|---|---|---|---|---|---|---|---|
| `GET /trading-api/v1/index-prices` | `price` per `assetSymbol`, in USD, 90 assets | absent | absent | absent | absent | 11.2 KB | 252 to 526 ms, and medians of 239 and 246 ms over two runs of 30 polls |
| `GET /trading-api/v1/markets/{symbol}/tick` | absent | `markPrice` | `fundingRate`, in percent | absent | absent | 0.9 to 3.7 KB, one market | medians of 247 to 252 ms on BTC and 301 to 303 ms on CHZ over two runs of 30 polls |
| `GET /trading-api/v1/history/markets/{symbol}/funding-rate` | | | settled hourly `fundingRate` as a fraction, with `updatedAtDatetime` | implied hourly | | 1.8 KB, 24 rows | 203 to 708 ms |
| Aggregator `GET /tickers` | absent | absent | absent | absent | absent | documented only | not probed, its schema has no index, mark or funding field, S5 |

No call returns the mark and funding of every perpetual at once.
The index comes in one bulk call keyed by asset, and the mark and rate need one tick call per market, S1.
The tick parameter is documented as "Only perpetual markets are supported", S1, yet the spot `BTCUSDC` tick answered 200 on SimNext, P2.
The interval and the next settlement appear in no reply, and the documentation fixes them: "Bullish Exchange runs on an hourly perpetual funding schedule" with the snapshot taken "at the end of every hour", S3.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | tick `symbol` | string, `BTC-USDC-PERP` | none |
| `index` | the `/index-prices` row whose `assetSymbol` equals the market's `underlyingBaseSymbol` | decimal string, USD | `Number()`. The perpetual quotes USDC, and SimNext priced `USDC` at `0.9998`. `APT-USDC-PERP` was enabled on SimNext and had no `APT` row |
| `mark` | tick `markPrice` | decimal string | `Number()` |
| `fundingRate` | tick `fundingRate` | decimal string in percent: `"-0.006250"` is -0.00625 % | divide by 100 |
| `fundingIntervalHours` | none | | the constant 1 |
| `nextFundingAt` | none | | the next full UTC hour in Unix ms |

The percent unit is the specification's own wording, "funding rate, expressed as a percentage", S1.
The wire agrees: the SimNext tick read `"-0.006250"` while the funding history for the same market read `"-0.0000625"` for 18 of its 24 settled hours and `"0"` for the other 6, and -0.0000625 as a fraction is the documented floor of -0.625 bp, P2 and S3.
The history is therefore a fraction and the tick is a percent, so the two differ by a factor of 100.
CCXT copies the history's `fundingRate` unchanged at `server/node_modules/ccxt/js/src/bullish.js` line 1453, and it has no `fetchFundingRate` for the tick's live rate.

## 4. Anchor semantics

### Index

| item | value | evidence |
|---|---|---|
| individual assets | "Raw Index Price = Median (external market prices, Bullish market price, last Index Price)" | S6 |
| exclusions | an input is dropped when not live or when it diverges from the median of all inputs by more than ±1 % for USDC and USDT, ±5 % for BTC and ETH, and ±10 % for all other assets | S6 |
| smoothing | an EMA with a 30 s half-life for stablecoins and 5 s for everything else | S6 |
| cadence | "Bullish's Index Price is recalculated for each asset every 5 seconds." | S6 |
| basket | Not publicly specified: "Please reach out to our Customer Support for more details including the current Index Price constituents." | S6 |
| broad-market indices | CD20 and its siblings come from CoinDesk Indices, "an affiliate of Bullish" | S6 |
| multiplied assets | "Multiplied index price = Original asset index price * Multiplier" | S7 |
| protection | "When Index Price deviates by 20% from the last Index Price, liquidation will be disabled automatically" | S6 |

The Bullish market price is one input to the median and the previous index is another, so the index leans on the venue's own book whenever few external prices survive the exclusions.
That is the self-reference shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) in a milder form, and no public call lists the constituents, so it cannot be screened per asset.

### Mark

The documented formula, recalculated "Every second", S4:

```text
Mark Price = clamp(INDEXPREM, min(Bid Price, Index Price), max(Ask Price, Index Price))
INDEXPREM  = Index Price * (1 + PREMIUM)
PREMIUM    = EMA((ASSUMED - Index Price) / Index Price, 30 seconds half-life)
ASSUMED    = Bid Price if Bid Price > Index Price, Ask Price if Ask Price < Index Price, otherwise Index Price
```

"PREMIUM is only updated while trading is enabled for the given market", S4.
The clamp keeps the mark inside the range spanned by the touch and the index, so the mark never strays further from the index than the book does.
The 30 s EMA makes the mark trail a book that jumps away from the index.
A reader that compares the book with the mark therefore sees a sudden book move as a gap that closes over about half a minute, while the EMA catches up.

On SimNext the documented clamp did not hold.
`BTC-USDC-PERP` showed a bid of 65,931.6 and an index of 86,631 while its mark read 65,927.25, and in other reads 65,905.3 and 65,923.98, all below `min(Bid Price, Index Price)`, P2, P4 and P5.
In the second run it read 65,945.79 against a bid of 65,931.7 and an ask of 65,931.8, inside the clamp, P2.
SimNext's BTC index is a real world price while its book is not, so this reading says only that the SimNext mark is not the documented clamp, and production is Not verified.

### Funding

The rate is the average of 59 one-minute values, each a premium with a ±2 bp dead zone, clamped to ±5 bp and divided by 8, so the final rate lies within ±0.625 bp per hour, see [`fees.md`](./fees.md) section 6 and S3.
The tick's rate is the indicative rate for the running hour, which "becomes increasingly constrained over each hour, and is equal to the final funding rate one minute before the Funding Amounts are charged", S3.
So the published rate is the upcoming settlement's rate as it builds, and the history holds the settled one, stamped `hh:59:59.999Z`, P2.
The settlement instant itself was not captured.

### How often each number changed

Two runs of thirty one-second polls on SimNext, P3.

| number | market | changes in 29 intervals | note |
|---|---|---:|---|
| `markPrice` | `BTC-USDC-PERP` | 14 and 14 | the tick's `createdAtTimestamp` changed the same 14 times, and the reply carries `cache-control: public, max-age=1` |
| `markPrice` | `CHZ-USDC-PERP` | 0 and 0 | its tick `createdAtTimestamp` was 230 s and 75 s old in the two `sim` runs, so a quiet market's tick is not refreshed each second |
| `fundingRate` | both | 0 and 0 | pinned at the ±0.00625 % bound |
| index `price` | BTC | 8 and 8 | its `updatedAtTimestamp` changed 14 and 10 times |

The tick socket gave the same picture: BTC pushed 30 tick frames in 60 s with a new mark in 29 of them, and CHZ pushed one, see [`websocket.md`](./websocket.md) section 2.
The index socket pushed every 2,000 ms median on BTC and CD20, and each push arrived a median of 502 to 1,200 ms after its `updatedAtTimestamp`, P4.
A quiet market's mark read over REST can therefore be minutes old, which the reader's 10 s age limit only catches if the poller stamps it from `createdAtTimestamp` rather than on arrival.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /trading-api/v1/markets/{symbol}/orderbook/hybrid` | S1 |
| depth | no parameter. `depth` was removed in 2025-03, S8, and `?depth=5`, `?limit=5` and `?aggregate=true` all returned the full book, 199 or 200 bids and 93 asks on BTC | P2 |
| level shape | `{"price": "65931.6000", "priceLevelQuantity": "0.01649643", "type": "bid"}` | P2 |
| order | bids descending, asks ascending | P2 |
| sequence | `sequenceNumber`, in the same space as the socket's `sequenceNumberRange`. The REST book and the socket agreed at 24499025 and again at 24499737 | P2, P4 |
| caching | `cache-control: public, max-age=1`, with `cf-cache-status` `HIT` or `EXPIRED` | P2 |
| unknown symbol | HTTP 404 with an empty body | P2 |

## 6. Rate limits and errors

| item | documented | probed on SimNext |
|---|---|---|
| unauthenticated limit | "Unauthenticated endpoints, rate limited at 50 requests per second." | no 429 induced |
| per IP | "500 requests per 10 seconds", and a limited IP "is blocked from making any requests for 60 seconds" | |
| status | 429, body `{"errorCode": 96000, "errorCodeName": "RATE_LIMIT_EXCEEDED", "message": "Rate limit exceeded"}`, and `96001` `GLOBAL_RATE_LIMIT_EXCEEDED` for the exchange-wide limit | |
| headers | `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `x-ratelimit-global-breach` | each sent twice with the same value: `x-ratelimit-limit: 1000`, `x-ratelimit-remaining` counting down 999, 998, 997 over three tick calls, `x-ratelimit-reset` in epoch ms, `x-ratelimit-global-breach: false`. The cached catalog reply carried none |
| `Retry-After` | not documented | not seen |
| unknown tick symbol | | 400 `{"message":"Invalid symbol provided","errorCode":28004,"errorCodeName":"INVALID_SYMBOL"}`, and the same for the funding history |
| unknown market | | 400 `{"message":"Invalid market symbol","errorCode":21000,"errorCodeName":"INVALID_MARKET_SYMBOL"}` |
| unknown index asset | | 404 `{"message":"No data found for asset symbol NOPE","errorCode":30001,"errorCodeName":"ASSET_SYMBOL_NOT_FOUND"}` |
| disabled perpetual tick | | 200 with a tick whose `createdAtTimestamp` was about 34 h old |
| location refusal, production | | 403 with an HTML page, P1 |

The documented limits are from S2.
The engine's poller treats 403 as a rate limit and pauses, at `server/src/shared/errors.ts` line 1 and `server/src/feeds/anchor/AnchorPoller.ts` line 192, so from this host a Bullish poller would pause forever rather than fail loudly.

## 7. Server time and clock offset

`GET /trading-api/v1/time` answers `{"datetime":"2026-09-23T01:25:46.004Z","timestamp":1790126746004}`, P2.
Against SimNext the offset, server time minus the midpoint of the request, was 1 to 13 ms on 14 of 15 calls over three runs, and 49 ms on the other, P2.
Production refused the call.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
It applies only to a host that Bullish serves, and the development host is not one, see section 1.

| item | recommendation | reason |
|---|---|---|
| index | `GET https://api.exchange.bullish.com/trading-api/v1/index-prices` once per round | one call covers every asset |
| mark and rate | `GET /trading-api/v1/markets/{symbol}/tick` for each tracked perpetual, or better the tick WebSocket | no bulk call exists, see section 3 |
| interval | 2,000 ms with the REST fan-out | 22 ticks plus one index call is 23 requests a round, which at 1 s would use 46 % of the 50 per second unauthenticated limit, and replies are cached for 1 s anyway |
| alternative | subscribe `tick` for every perpetual and `indexPrice` for every base on the public sockets, and write the latest values into the anchor rows | pushes every 2 s on SimNext, and no request budget, at the cost of a WebSocket shaped poller, which the engine does not have today |
| row mapping | section 3, key `symbol`, `fundingRate` divided by 100, interval 1, next settlement at the next full hour | |
| reading time | stamp the mark from the tick's `createdAtTimestamp`, not on arrival | a quiet market's tick was 75 s and 230 s old on SimNext |
| skip | rows whose market has `marketEnabled` false | a disabled perpetual still answers with an old tick |
| skip | `CD20`, `CD80`, `CD100`, `CDMEME` and `CMWTI` perpetuals | no counterpart elsewhere, section 2 |
| rate limit pause | `rateLimitPauseMs` 60,000 | a limited IP is blocked for 60 s and no `Retry-After` is documented |
| deny list input | Not verified | the index basket is private, and the Bullish market price is one of its inputs, section 4 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bullish Trading API OpenAPI specification | https://docs.exchange.bullish.com/assets/files/bullish-trading-api-ed81ea9ddf394481dce1122ec500c9bf.yml | 2026-09-22 | global | markets, tick, index prices, funding history, book, time schemas, sections 2 to 5 |
| S2 | Bullish REST, Rate Limits | https://docs.exchange.bullish.com/rest/general/rate-limits | 2026-09-22 | global | limits, 429 bodies, headers, section 6 |
| S3 | Bullish Help Center, Understanding funding | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/9373871 | 2026-09-22 | Bullish GI | hourly schedule, formula, indicative rate, sections 3 and 4 |
| S4 | Bullish Help Center, Understanding perpetual futures mark prices | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/9373385 | 2026-09-22 | Bullish GI | mark formula and clamp, section 4 |
| S5 | Bullish Aggregator API, Get Tickers | https://docs.exchange.bullish.com/aggregator/get-tickers | 2026-09-22 | global | ticker schema without anchor fields, section 3 |
| S6 | Bullish Help Center, What is Index Price? | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/9373374 | 2026-09-22 | Bullish GI | index methodology, thresholds, half-lives, basket, CoinDesk, WTI, sections 2 and 4 |
| S7 | Bullish Help Center, Understanding Multiplied Assets | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/20807684 | 2026-09-22 | Bullish GI | `SHIB1M`, multiplied index, section 2 |
| S8 | Bullish REST API changelog | https://docs.exchange.bullish.com/rest/changelog | 2026-09-22 | global | `depth` removal, section 5 |
| S9 | Bullish REST, Connectivity Options | https://docs.exchange.bullish.com/rest/general/connectivity-options | 2026-09-22 | global | GCP `asia-southeast1-a`, section 1 |
| S10 | Bullish Help Center, Toncoin (TON) Rebranding to Gram (GRAM) | https://support.exchange.bullish.com/wiki/spaces/BHC/pages/13985710 | 2026-09-22 | Bullish GI | the article title only, section 2 |
| S11 | CCXT 4.5.68 `bullish.js` | `server/node_modules/ccxt/js/src/bullish.js` | 2026-09-22 | CCXT | market mapping, funding history parse, sections 2 and 3 |
| P1 | `rest-probe.mjs access`, at 01:25 and 01:38 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/bullish/rest-probe.mjs) | 2026-09-22 | this host, production | refusal, DNS, CCXT error, section 1 |
| P2 | `rest-probe.mjs sim`, at 01:25, 01:39 and 01:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bullish/rest-probe.mjs) | 2026-09-22 | this host, SimNext | catalog, CCXT mapping, anchor calls, book, errors, clock, sections 1 to 7 |
| P3 | `rest-probe.mjs poll`, at 01:26 and 01:39 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bullish/rest-probe.mjs) | 2026-09-22 | this host, SimNext | change counts, section 4 |
| P4 | `ws-probe.mjs book`, at 01:28 and 01:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bullish/ws-probe.mjs) | 2026-09-22 | this host, SimNext | REST and socket book at one sequence number, mark reads, index lag, sections 4 and 5 |
| P5 | `curl` of the SimNext tick, at 01:24 UTC | `https://api.simnext.bullish-test.com/trading-api/v1/markets/BTC-USDC-PERP/tick` | 2026-09-22 | this host, SimNext | mark below the bid, section 4 |
