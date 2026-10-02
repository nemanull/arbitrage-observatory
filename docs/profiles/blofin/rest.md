# BloFin REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:23 and 03:33 UTC on 2026-09-23, from the development host near Seattle, where every public REST call was refused with HTTP 403 by Cloudflare.

This profile covers the public REST API of BloFin (CCXT id `blofin`) for its perpetual families, with the anchor calls in detail.
Every call from this host returned BloFin's restricted region page, so nothing below was measured on a live reply, see section 1.
Protocol claims come from an Internet Archive copy of the API reference dated 2025-10-31 (S1), catalog numbers from an Internet Archive copy of the instruments reply dated 2026-09-16 (S2), and CCXT 4.5.68.
No proxy, VPN or other route to the API was used.

## 1. Host and latency from this machine

| item | value |
|---|---|
| REST root | `https://openapi.blofin.com`, S1, and `server/node_modules/ccxt/js/src/blofin.js` line 164 |
| resolved addresses | `104.18.41.96` and `172.64.146.160`, Cloudflare, shared by `openapi`, `demo-trading-openapi`, `docs` and the apex, P1 |
| answer to every public call | HTTP 403, `text/html`, 5,313 bytes, the restricted region page, P1 |
| calls refused | `market/instruments`, `market/tickers`, `market/mark-price`, `market/funding-rate`, `market/funding-rate-history`, `market/books` and `market/trades`, on both the live and the demo root, P1 |
| time to the refusal | cold 22 to 107 ms, warm 22 to 81 ms, over two runs of 14 calls, from the Cloudflare `SEA` colo, P1 |
| `Retry-After` | absent |

The refusal body reads "We noticed that your IP address is from one of BloFin's restricted countries or regions. Unfortunately, BloFin is not able to provide service to users in these regions under our Terms and Conditions.", P1.
These times are Cloudflare's edge answering, so they say nothing about how fast BloFin's origin would serve a permitted host.
The documentation names HTTP 403 for a second case as well, "If you receive an HTTP 403 error message, it means you have violated a network firewall rule.", which "will result in a five-minute temporary ban", S1.
The geoblock page is not that ban, since it arrived on the first request of the day and names the region.

## 2. Catalog

### The instruments call

`GET /api/v1/market/instruments`, with an optional `instId`, S1.
The archived reply of 2026-09-16 used `?instType=SWAP`, was 212 KB uncompressed, and held 485 rows, all `state` `live`, S2.
The documented states are `live` and `suspend`, S1.

| family | rows on 2026-09-16 | `contractType` | quote | settles in | example |
|---|---:|---|---|---|---|
| USDT-M | 461 | `linear` | USDT | USDT | `BTC-USDT`, `contractValue` `0.001` |
| USDC-M | 10 | `linear` | USDC | USDC | `BTC-USDC`, `contractValue` `0.0001` |
| coin-M | 14 | `inverse` | USD | the base coin | `BTC-USD`, `contractValue` `1` |

The USDC-M rows are BTC, ETH, DOGE, SOL, XRP, BNB, SUI, ENA, LINK and ADA.
The coin-M rows are BTC, ETH, XRP, SUI, SOL, DOGE, ADA, LINK, UNI, BCH, DOT, ETC, FIL and LTC.
By `assetClass` the rows are 459 `Crypto`, 22 `Stocks`, 2 `Commodities` and 2 `Indices`, S2.
CoinGecko listed 482 perpetual pairs and returned 481 USDT tickers on 2026-09-22, S3.
460 of those match an archived USDT row, 21 do not, such as `QTUM-USDT`, `SMCI-USDT` and `TQQQ-USDT`, and the archived `ETHBTC-USDT` is missing from CoinGecko, so the live count is about 460 to 481 USDT-M perpetuals.

### How CCXT 4.5.68 maps it

`fetchMarkets` calls this endpoint without parameters at `server/node_modules/ccxt/js/src/blofin.js` lines 505 to 509, and `parseMarket` follows at lines 510 to 590.

| engine input | CCXT source | fits |
|---|---|---|
| `market.id` | `instId`, line 511 | yes on paper, the socket, `mark-price` and `funding-rate` all key by `instId`, S1 |
| `contractSize` | `contractValue`, line 560 | yes for linear rows, where book sizes are contracts of `contractValue` base units, S1 |
| `linear` | `quoteId === settleId`, line 558, where `settleId` is read from `quoteCurrency` at line 520 | no for coin-M, see below |
| `active` | `state === 'live'`, line 537 | yes |
| `type` and `swap` | `instType` lowercased, lines 512 to 515 | yes |
| `taker` | `fees.swap.taker`, 0.0006, see [`fees.md`](./fees.md) section 8 | yes |

CCXT takes the settlement currency from `quoteCurrency` and never reads `settleCurrency` or `contractType`.
So a coin-M row loads as a linear market settled in USD.
[`rest-probe.mjs`](../../../scripts/probes/venues/blofin/rest-probe.mjs) `ccxt` ran `parseMarket` offline on the documented `BTC-USDT` row and on the same row turned into the archived `BTC-USD` shape, P2.

```json
{"tag":"parse_market","input":"BTC-USD inverse settle BTC","id":"BTC-USD","symbol":"BTC/USD:USD","settle":"USD","linear":true,"inverse":false,"contractSize":100,"active":true,"taker":0.0006,"maker":0.0002}
```

The probe row carried a `contractValue` of 100 to make the mapping visible, while the archived `BTC-USD` row carries 1.
A `contractValue` of 1 on a contract whose `maxMarketSize` is 3,000,000 reads as one US dollar per contract and not one bitcoin, which is an inference.
CCXT would hand the engine `contractSize` 1 and `linear` true, so the engine would read each coin-M contract as one whole coin.
A `marketFilter` of `market.settle === 'USDT'` drops the coin-M rows, because CCXT labels them `USD`, and it also drops the USDC-M rows.

### Size unit, pairs listed twice, and price scale

Sixteen bases are listed more than once: BTC, ETH, DOGE, XRP, SOL, SUI, ADA and LINK three times, and BNB, ENA, UNI, BCH, DOT, ETC, FIL and LTC twice, S2.
The quote family treats USD, USDC and USDT as one family, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), so the `marketFilter` above leaves one market per pair.
Five bases carry their multiplier in the name, `1000BONK`, `1000FLOKI`, `1000LUNC`, `1000RATS` and `1000000MOG`, S2 and S3.
`1000BONK-USDT` has `contractValue` `1000` of `1000BONK` units, so one contract is one million BONK and the price is per thousand BONK.
CCXT's `base` is `1000BONK`, and whether another venue spells the same base the same way decides whether a price scale is needed at [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts).
`ETHBTC-USDT` is a ratio contract with base `ETHBTC`, and `4STOCK-USDT` is a crypto token despite its name, S2.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | bulk | reply and time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/market/mark-price` | `indexPrice` | `markPrice` | absent | absent | absent | `instId` optional, so every instrument when omitted, S1 | HTTP 403 in 23 and 26 ms, P1 |
| `GET /api/v1/market/funding-rate` | absent | absent | `fundingRate` | absent | `fundingTime`, Unix ms | `instId` optional, S1 | HTTP 403 in 24 and 36 ms, P1 |
| `GET /api/v1/market/funding-rate-history?instId=` | absent | absent | past `fundingRate` | the spacing of `fundingTime` | absent | one `instId` per call, up to 100 rows, S1 | HTTP 403, P1 |
| `GET /api/v1/market/tickers` | absent | absent | absent | absent | absent | best bid, ask and last for every instrument, S1 | HTTP 403, P1 |

Two calls per round carry four of the five `AnchorRow` columns, keyed by `instId`.
No documented call carries the funding interval, so it would come from the history call per instrument, refreshed rarely, or from the settlement times.
CCXT 4.5.68 declares `fetchFundingRates` false and threw `NotSupported` in P2, at `server/node_modules/ccxt/js/src/blofin.js` line 79, and its single `fetchFundingRate` leaves `markPrice`, `indexPrice` and `interval` undefined at lines 1044, 1045 and 1059.

### Row mapping

| `AnchorRow` column | field | unit on the wire, S1 | conversion |
|---|---|---|---|
| key | `instId` | string, `BTC-USDT` | none |
| `index` | `mark-price` `indexPrice` | decimal string | `Number()` |
| `mark` | `mark-price` `markPrice` | decimal string | `Number()` |
| `fundingRate` | `funding-rate` `fundingRate` | decimal string, `"0.000330372404346635"` | `Number()`, and whether it is per interval or per 8 h is Not verified |
| `fundingIntervalHours` | none | | from `funding-rate-history`, the gap between two `fundingTime` values |
| `nextFundingAt` | `funding-rate` `fundingTime` | string of Unix ms, `"1703462400000"` | `Number()` |

## 4. Anchor semantics

Nothing in this section could be measured, and the help center articles that define the formulas refuse this host and have no archived copy.

| number | what the readable sources say | not verified |
|---|---|---|
| index | BloFin publishes one per contract, and a delisting notice reserves the right of "changing the constituents of the price index", S4 | the basket, its weights, and a basket call, none of which S1 documents |
| mark | the same notice mentions "updating the Mark Price with the Last Price Protected mechanism", S4 | the formula and any clamp |
| funding rate | the rate has "the interest rate and capped funding rate" terms, S4 | the formula, the cap and the floor |
| interval | 8 h, 4 h and 1 h contracts exist, and BloFin changes a contract's interval by announcement, see [`fees.md`](./fees.md) section 6 | a bulk field for it |
| upcoming or settled | the API calls `fundingRate` the "Current funding rate" and `fundingTime` the "Settlement time", S1, and CCXT stores `fundingTime` as `fundingTimestamp` rather than `nextFundingTimestamp`, at `blofin.js` lines 1039 and 1051 | whether the pair names the coming settlement or the last one, and the settlement instant was not captured |
| change rate | the `funding-rate` socket channel pushes at most every 30 s, see [`websocket.md`](./websocket.md) section 2 | how often index and mark change per second |

The two shapes that have already produced false rows, a capped mark premium and an index basket built on the venue's own perpetual, cannot be ruled out for BloFin from here.

## 5. REST book snapshot

`GET /api/v1/market/books?instId=BTC-USDT&size=100`, where `size` is the depth per side, "Maximum 100", and defaults to 1, S1.
CCXT passes `limit` as `size` at `blofin.js` line 611.
Levels are `["price", "size"]` with the size in contracts, and the example lists asks ascending and bids descending, S1.
Caching and repeat reads are Not verified, since the call returned 403, P1.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| public REST | "up to 500 requests per minute" per IP, and a breach suspends the IP for 5 minutes | S1 |
| second window | "up to 1500 requests per 5 minutes", and a breach suspends the IP for 1 hour | S1 |
| trading | 30 requests per 10 s per user | S1 |
| limit reply | HTTP 429, "Too Many Requests" | S1, errors table |
| firewall | HTTP 403, a five minute ban in most cases | S1 |
| other errors | HTTP 200 with `code` and `msg` in the body, such as `152014` "Instrument ID does not exist" and `152015` "Number of instId values exceeds the maximum limit of 20" | S1, errors table |
| CCXT | maps 429 to `ExchangeNotAvailable` at `blofin.js` line 428, and 403 to `ExchangeNotAvailable` at `base/Exchange.js` line 2408 | CCXT 4.5.68 |

The engine treats 403 as a rate limit, at [`errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts) line 1, and pauses the poller at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) line 192.
From this host a BloFin poller would therefore pause after every round and never read a row.
A body with a non-zero `code` under HTTP 200 would need to fail the round, since the poller only pauses on the status.

## 7. Server time and clock offset

The API reference documents no public server time call, S1, so the clock offset is Not verified.
The `date` header on the 403 comes from Cloudflare's edge and not from BloFin's matching engine, so it is not a substitute.

## 8. Recommended poller shape

A recommendation for a host that BloFin serves, not a decision.
From this host no poller can run, because every call is refused.

| item | recommendation | reason |
|---|---|---|
| URLs | `https://openapi.blofin.com/api/v1/market/mark-price` and `https://openapi.blofin.com/api/v1/market/funding-rate`, both without `instId` | together they carry index, mark, rate and settlement time for every instrument, S1 |
| interval | 1,000 ms, the default | two calls a second is 120 a minute and 600 per 5 minutes, under both documented windows |
| funding interval | `funding-rate-history` per tracked instrument once an hour, spread across the hour | no bulk field exists, and 460 calls an hour stays far under the limit |
| row mapping | section 3, key `instId` | |
| skip | rows whose `instId` the catalog does not hold after the `marketFilter` | coin-M and USDC-M rows share the same replies |
| `marketFilter` | `market.settle === 'USDT'` | drops the 14 coin-M rows CCXT mislabels as linear and the 10 USDC-M duplicates |
| rate limit pause | `rateLimitPauseMs` 300,000 | a breach suspends the IP for 5 minutes |
| error body | treat `code` other than `"0"` as a failed round | errors arrive under HTTP 200 |
| verify first | the index basket, the mark clamp, the funding cap and whether `fundingTime` is the next settlement | none could be read from here |

Verdict for the engine: BloFin is blocked from this host.
Its catalog, feed and anchor all look usable on paper, with the `marketFilter` above and a separate interval source as the named changes, but `loadMarkets`, the socket upgrade and every anchor call return HTTP 403 to this machine near Seattle, and US persons may not trade, see [`fees.md`](./fees.md) section 1.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BloFin API Documents, Internet Archive copy of 2025-10-31 | https://web.archive.org/web/20251031005137/https://docs.blofin.com/index.html | 2026-09-22, live page HTTP 403 to this host and to WebFetch | BloFin, global | endpoints, fields, bulk parameters, book depth, rate limits, error table, sections 1 to 8 |
| S2 | `GET /api/v1/market/instruments?instType=SWAP`, Internet Archive copy of 2026-09-16 | https://web.archive.org/web/20260916172500/https://openapi.blofin.com/api/v1/market/instruments?instType=SWAP | 2026-09-22, live call HTTP 403 | BloFin | 485 rows, families, contract values, pairs listed twice, section 2 |
| S3 | CoinGecko derivatives exchange `blofin` with unexpired tickers | https://api.coingecko.com/api/v3/derivatives/exchanges/blofin?include_tickers=unexpired | 2026-09-22 | CoinGecko | 482 perpetual pairs, 481 USDT tickers, section 2 |
| S4 | "BloFin Will Delist FORTHUSDT and LRCUSDT Perpetual Contracts", copy of 2026-08-30 | https://web.archive.org/web/20260830150452/https://blofin.com/en/support/Announcement/Delisting/15504988317711-BloFin-Will-Delist-FORTHUSDT-and-LRCUSDT-Perpetual-Contracts | 2026-09-22 | BloFin | index constituents, Last Price Protected mark, interest rate and cap, section 4 |
| S5 | CCXT 4.5.68 `blofin.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/blofin.js` | 2026-09-22 | CCXT | market mapping, funding rate parsing, book size, error mapping, sections 2, 3, 5 and 6 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/blofin/rest-probe.mjs) `access` | | 2026-09-23 03:23 and 03:33 UTC | this host | DNS, the 403 on every path and host, times, sections 1, 3, 5 and 7 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/blofin/rest-probe.mjs) `ccxt` | | 2026-09-23 03:23 and 03:33 UTC | this host | `loadMarkets` `ExchangeNotAvailable`, `fetchFundingRates` `NotSupported`, offline `parseMarket`, sections 2 and 3 |
