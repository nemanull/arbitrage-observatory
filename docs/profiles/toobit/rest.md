# Toobit REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers the public REST API of Toobit (CCXT id `toobit`) that a catalog, an anchor poller and a book resync would use, for both perpetual families, USDT-M and USDC-M.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/toobit/rest-probe.mjs), run from `server/`.
The `main` mode ran twice, at 21:34 and 21:59 UTC, and the two readings are written side by side where they differ.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-22 |
|---|---|---|
| `api.toobit.com` | REST base `https://api.toobit.com`, S1 | CNAME `api.toobit.com.cdn.cloudflare.net`, A `104.18.18.168` and `104.18.19.168` |
| `stream.toobit.com` | WebSocket, see [`websocket.md`](./websocket.md) | CNAME `stream.toobit.com.cdn.cloudflare.net`, the same two addresses |
| `www.toobit.com`, `api-docs.toobit.com` | website and API documentation | Cloudflare, the same two addresses |
| `support.toobit.com` | the old help center | NXDOMAIN |

Every host sits behind Cloudflare, so the addresses say nothing about where the matching engine runs.
The `cf-ray` header named the Seattle edge, `SEA`, in the first run and the Vancouver edge, `YVR`, in the rerun.
No API reply refused this host, and none carried a challenge.

Latency, one process, Node `fetch` with a kept connection, five warm requests 1.1 s apart after the first.
Reply sizes are decoded bytes, and every reply was sent with `content-encoding: br`.

| call | first request ms | warm min / median / max ms, first run | warm min / median / max ms, rerun | reply bytes |
|---|---|---:|---:|---:|
| `GET /api/v1/time` | 211, 194 | 128 / 133 / 140 | 116 / 118 / 122 | 28 |
| `GET /api/v1/exchangeInfo` | 266, 173 | 79 / 101 / 281 | 54 / 59 / 346 | 2,578,915 to 2,579,107 |
| `GET /quote/v1/index` | 154, 130 | 147 / 148 / 156 | 128 / 130 / 132 | 38,068 to 38,192 |
| `GET /quote/v1/markPrice` | 161, 140 | 161 / 169 / 178 | 136 / 140 / 147 | 75,531 to 75,552 |
| `GET /api/v1/futures/fundingRate` | 201, 164 | 189 / 196 / 503 | 160 / 164 / 181 | 135,611 to 135,620 |
| `GET /quote/v1/depth?symbol=BTC-SWAP-USDT&limit=20` | 128, 117 | 127 / 128 / 162 | 115 / 119 / 121 | 793 to 812 |

`exchangeInfo` is cached at the edge: every reply carried `cache-control: public, max-age=10` and `cf-cache-status: HIT`, with `age` up to 9 s.
Every other call answered `cf-cache-status: DYNAMIC`.
These are one host on one date.

## 2. Catalog

### The instruments call

`GET /api/v1/exchangeInfo`, weight 1, returns spot in `symbols`, perpetuals in `contracts`, an empty `options`, `coins` and `rateLimits` in one reply, S1.

| item | value on 2026-09-22 |
|---|---|
| `contracts` | 767: `marginToken` `USDT` on 757 and `USDC` on 10 |
| `inverse` | false on 767 |
| `status` | `TRADING` on 767. The documented contract states are `TRADING`, `ONLINE` "not tradable", `API_TRADE_FORBIDDEN`, `OPEN_FORBIDDEN` and `CLOSE_FORBIDDEN`, S1 |
| id shape | `<BASE>-SWAP-USDT` or `<BASE>-SWAP-USDC` on 767 of 767, and `symbolName` equal to `symbol` on all |
| `contractMultiplier` | `1` on 391, `0.01` on 236, `0.1` on 105, `0.001` on 26, `0.0001` on 5, `10` and `100` on 2 each |
| stock contracts | `isRwa` true and `rwaType` `STOCK` on 244 |
| `closingStartTime`, `closingEndTime` | `"0"` on every contract |
| `symbols` | 530 spot pairs, not detailed |

Contracts that left the catalog still appear elsewhere: `REN-SWAP-USDT`, `WAVES-SWAP-USDT`, `LOOM-SWAP-USDT` and `KLAY-SWAP-USDT` answer in the mark reply, and `REN-SWAP-USDT` answers an empty book, section 6.

### How CCXT 4.5.68 maps it

| item | value | evidence |
|---|---|---|
| calls | `commonGetApiV1ExchangeInfo`, and `symbols` and `contracts` are parsed together | `server/node_modules/ccxt/js/src/toobit.js` lines 801 and 939 |
| `market.id` | the contract's `symbol`, for example `BTC-SWAP-USDT` | line 974 |
| `base` | `baseAsset` cut at the first `-`, so `BTC-SWAP-USDT` gives `BTC` | lines 954 to 956 |
| `type` swap | any row that has `contractMultiplier` | line 968 |
| `linear` | not `inverse` | lines 969 and 990 |
| `contractSize` | `contractMultiplier` | line 992 |
| `active` | `status === 'TRADING'` | line 961 |
| `taker`, `maker` | not set, so `undefined`, see [`fees.md`](./fees.md) section 8 | lines 950 to 1030 |
| `loadMarkets` time | 368 to 557 ms, one call | Probed |

Probed through the connector's filter, `type` swap, `swap` true and `active !== false`:

| result | value |
|---|---|
| active swaps | 767: 757 `USDT` linear and 10 `USDC` linear |
| `market.id` against the raw `symbol` | equal on 767 of 767 |
| `market.id` against the mark `symbolId` and the funding `symbol` | every catalog id is present in both replies |
| `market.id` against the socket | every id tried delivered, see [`websocket.md`](./websocket.md) section 3 |
| `contractSize` equal to `contractMultiplier` | 767 of 767 |
| `taker` | `undefined` on 767 |

Sample markets, as CCXT returned them.

| id | base | quote | settle | linear | contractSize | precision.price | precision.amount | `stepSize` |
|---|---|---|---|---|---:|---:|---:|---|
| `BTC-SWAP-USDT` | BTC | USDT | USDT | true | 0.001 | 0.1 | 0.0001 | `"0.0001"` |
| `ETH-SWAP-USDT` | ETH | USDT | USDT | true | 0.01 | 0.01 | 0.001 | `"0.001"` |
| `BTC-SWAP-USDC` | BTC | USDC | USDC | true | 0.001 | 0.1 | 0.001 | `"0.001"` |
| `DOGE-SWAP-USDT` | DOGE | USDT | USDT | true | 1 | 0.00001 | 1 | `"1"` |
| `1000PEPE-SWAP-USDT` | 1000PEPE | USDT | USDT | true | 1 | 1e-7 | 1 | `"1"` |
| `AAPL-SWAP-USDT` | AAPL | USDT | USDT | true | 0.01 | 0.01 | 0.01 | `"0.01"` |

The `LOT_SIZE` filter is in coins, "token quantity not contracts", S1, so `precision.amount` is in coins while book sizes are in contracts.
The engine does not read `precision.amount`.

### Size unit, pairs listed twice, and names

Book sizes are contracts of `contractMultiplier` coins, and CCXT's `contractSize` is that multiplier, so the engine's size multiplier is right for every contract, see [`websocket.md`](./websocket.md) section 4.

Ten pairs are listed twice once the quote family folds `USDC` into `USDT`: `BTC`, `ETH`, `SOL`, `DOGE`, `XRP`, `LTC`, `ADA`, `LINK`, `UNI` and `SUI`.
[`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 13 to 17 rank `USDT` before `USDC`, so every USDC-M contract is ranked out and the venue trades USDT-M only.

31 contracts carry a base that differs from their own index token.

| shape | contracts |
|---|---|
| a scale prefix, where the index token drops it | `1000PEPE`, `1000SHIB`, `1000BONK`, `1000LUNC`, `1000RATS`, `1000FLOKI`, `1000SATS`, `1000XEC`, `1000CAT`, `1000CHEEMS`, `1000000MOG` |
| a digit suffix or a longer name on the base | `ID2`, `LUNA2`, `SONIC2`, `PI2`, `PUMP2`, `LIT2`, `O1`, `CAPAPP`, `HOOD2`, `GME2`, `XPB2`, `RTX2`, `SLVON2`, `DFDVX2`, `WDC2`, `GLW2`, `PENG2`, `RDW2` |
| a different name | `TON-SWAP-USDT` on index `GRAMUSDT`, and `NEIRO-SWAP-USDT` on index `NEIRO1USDT` |

The scale prefix is priced per 1,000 or 1,000,000 coins and so is its index: the mark sat within 0.8 to 1.25 times the index on 767 of 767 contracts in one read, so no Toobit contract needs a price scale against its own index.
A suffixed base such as `PI2` will not cluster with `PI` on another venue, so the pair is lost rather than mispaired.
The mark reply still lists the retired `ID-SWAP-USDT`, `SONIC-SWAP-USDT` and `NEIRO1-SWAP-USDT`, which suggests the suffixed ids replaced older contracts, an inference.
`TON-SWAP-USDT` is the case that needs a check: its index basket is Binance `GRAMUSDT` alone, section 4, Binance USD-M answered `GRAMUSDT` at 1.453 and an empty reply for `TONUSDT`, okx answered code `51001` for `TON-USDT-SWAP`, and bybit listed no linear `TONUSDT`, while Toobit's own last price was 1.452.
So Toobit's `TON` tracks what Binance calls `GRAM`, and a `DENIED_PAIRS` line for `TON|USDT` is worth adding before Toobit joins, in case another venue lists a different token as `TON`.
Whether any other Toobit ticker names a different token than the same ticker elsewhere was not surveyed.

## 3. Anchor

### The bulk calls

| call | carries | reply | warm time over 60 polls, first run | rerun |
|---|---|---|---|---|
| `GET /quote/v1/index`, weight 1 | `index` and `edp`, each a map from index token to a decimal string | 779 index tokens, 38 KB | min 138, median 147, p90 187, max 222 ms | min 124, median 131, p90 207, max 400 ms |
| `GET /quote/v1/markPrice`, "up to 5 requests per second" | an array of `{exchangeId, symbolId, price, time}` | 878 rows, 76 KB | min 152, median 163, p90 301, max 491 ms | min 289, median 306, p90 335, max 419 ms |
| `GET /api/v1/futures/fundingRate`, weight 1 | an array of `{symbol, rate, period, nextFundingTime, interest, fundingRateCap, fundingRateFloor}` | 815 rows, 136 KB | min 146, median 171, p90 400, max 434 ms | min 166, median 185, p90 279, max 407 ms |

Three calls carry every `AnchorRow` column, and none took more than 1 s.
The index reply is keyed by the index token and not by the contract, so the poller needs the catalog's `indexToken` to join it, and no two contracts shared an index token.
The mark reply carries 111 rows that are not in the catalog, 69 `TBV_` rows and 42 others such as the delisted `REN-SWAP-USDT`, test rows such as `TESTDOGE-SWAP-TESTX8Z9`, and dated ids such as `KITE2511030000`.
The funding reply carries 48 rows that are not in the catalog, all `TBV_`.
Every catalog contract appears in all three replies.
CCXT weighs `quote/v1/markPrice` at 10, "5 requests per second", at `server/node_modules/ccxt/js/src/toobit.js` line 120.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbolId` in the mark reply, `symbol` in the funding reply | string, `BTC-SWAP-USDT` | none |
| `index` | `index[<indexToken>]` | decimal string, `"86268.05543478"`, with up to 18 decimals on stock indices | `Number()` |
| `mark` | `price` | decimal string, never 0 on 878 rows | `Number()` |
| `fundingRate` | `rate` | decimal string, a fraction per period: `"-0.00002794"` | `Number()` |
| `fundingIntervalHours` | `period` | `"8H"`, `"4H"` or `"1H"` | `parseInt` |
| `nextFundingAt` | `nextFundingTime` | Unix ms as a string, `"1790121600000"` is 2026-09-23 00:00 UTC | `Number()` |

The mark reply's `time` was one value for all 878 rows, on a whole second, and the reply arrived 320 to 661 ms after that second in the first run and 786 to 994 ms after it in the rerun.
At 21:34 UTC, 764 contracts named 2026-09-23 00:00 UTC as the next settlement and the three hourly contracts named 22:00 UTC.
`interest` is the interest term of the funding formula, and `fundingRateCap` and `fundingRateFloor` are the per contract clamps, see [`fees.md`](./fees.md) section 6.

## 4. Anchor semantics

### Index

S3, dated 2026-09-05, names the sources as "Toobit, Binance, OKX, Bybit, Bitget, Coinbase, KuCoin, and MEXC", weights each spot price, drops a source that "deviates by more than 5% from the median price of all sources", and zeroes a source that "has not updated its data for more than 10 minutes".
During disruptions a "last price protection" may base the index on "the latest traded price of the futures contract within a specified range", S3.
`GET /quote/v1/indexPriceComponents?symbol=<indexToken>` returns `{index, edp, components: [{exchange, spotPair, weight}], time}`, and the WebSocket `index` topic carries the same basket as a `formula` string.

`rest-probe.mjs baskets` read the basket of every one of the 767 index tokens the catalog uses, two requests a second, from 21:49 UTC and again from 22:06 UTC.

| item | first run | rerun |
|---|---|---|
| sources per basket | 1 on 264, 2 on 82, 3 on 108, 4 on 122, 5 on 103, 6 on 71, 7 on 12, 8 on 5 | 1 on 264, 2 on 79, 3 on 109, 4 on 113, 5 on 106, 6 on 76, 7 on 13, 8 on 7 |
| members by venue | Binance 525, KuCoin 452, Bitget 403, Bybit 247, OKX 195, MEXC 182, Gate 162, Coinbase 135, Kraken 4 | Binance 525, KuCoin 452, Bitget 403, Bybit 262, OKX 195, MEXC 185, Gate 162, Coinbase 146, Kraken 4 |
| Toobit itself in a basket | none | none |
| unequal weights | none | none |
| basket reply older than 60 s | none | none |

Every basket weights its members equally, and every sample read `"1.0"`.
An unknown token answers HTTP 200 with `{}`.

The rerun counted 29 more members, 15 of them Bybit and 11 Coinbase, so a basket gains and loses members within minutes, which fits S3's rules for outlying and stale sources.
The 264 single source baskets were the same tokens in both runs.

| basket | members |
|---|---|
| `BTCUSDT` | Coinbase, KuCoin, Bitget, OKX, Binance, Bybit |
| `ETHUSDT` | Bybit, Coinbase, KuCoin, OKX, Binance, Bitget |
| `LSKUSDT` | OKX, Binance, KuCoin |
| `AAPLUSDT` | Bybit, Gate, MEXC |
| `XAUUSDT` | Binance alone |
| `GRAMUSDT`, used by `TON-SWAP-USDT` | Binance alone |

Of the 264 single source baskets, 227 belong to stock contracts and 37 to crypto contracts.
The crypto ones sit on Binance alone for 19, KuCoin alone for 11, Bitget alone for 4, MEXC alone for 2 and Bybit alone for 1, and include `MTLUSDT`, `STEEMUSDT`, `POWRUSDT`, `XMRUSDT`, `HOTUSDT`, `SPELLUSDT` and `GRAMUSDT`.
A single source basket makes Toobit's index that one venue's price, so a route between Toobit and that venue compares a Toobit book against the other venue's own quote, the shape [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) describes.
The stock baskets name Bybit, Gate, MEXC and Binance in a field called `spotPair`, while those venues list stocks as perpetuals, so reading them as other venues' perpetuals is an inference that was not checked.
The 264 single source contracts are the deny list input this survey offers.

### Mark

S4, dated 2026-09-04, is the formula of record.

```text
Final mark price = Median of Price 1, Price 2, and Price 3
Price 1 = Last price on the Toobit Futures market
Price 2 = Price index × [1 + Last funding rate × (Time until next funding ÷ Funding period)]
Price 3 = Price index + 5-minute moving average of the order book basis
5-minute moving average = Σ[((Bid1_i + Ask1_i) ÷ 2) − PI_i] ÷ 60
```

S4 names no clamp on the mark premium, and no cap was found.
Because the last price is one of three medians, the mark equalled the last trade on 350 of 767 contracts in the first run's single read and 338 in the rerun.
Over 60 polls the mark equalled the last trade on 14 and 28 BTC polls, 2 and 24 ETH polls, 33 and 15 DOGE polls, 56 and 7 LSK polls, and 0 and 57 AAPL polls, so the pinning comes and goes.
A mark pinned to the last trade on a quiet contract reads a stale book as a fresh one, and [`fees.md`](./fees.md) section 7 records a past mark price incident on this venue.

### Funding

The formula, the interest term, the caps and the intervals are in [`fees.md`](./fees.md) section 6.
`GET /api/v1/futures/historyFundingRate?symbol=` returns settled rates `{id, symbol, settleTime, settleRate, period}`, and without `symbol` it answered HTTP 200 with rows of several contracts, though S1 marks `symbol` mandatory.

### Rate across a settlement

`rest-probe.mjs settlement` read the funding reply every 5 s from 21:58:30 to 22:02:00 UTC, across the 22:00 settlement of the three hourly contracts, and again from 22:58:30 to 23:02:00 UTC across the 23:00 settlement.

| contract | shown at 90 s before | shown from 45 s before until 75 s after, with the past instant as next | settled, history call | shown from 75 s after, with the next hour |
|---|---|---|---|---|
| `LSK-SWAP-USDT`, 22:00 | `-0.00023792` | `-0.00023909` | `-0.00023909` | `-0.00023998` |
| `G-SWAP-USDT`, 22:00 | `-0.0005008` | `-0.00050083` | `-0.00050083` | `-0.00049758` |
| `LRCX-SWAP-USDT`, 22:00 | `0.00012035` | `0.00011825` | `0.00011825` | `0.00011504` |
| `LSK-SWAP-USDT`, 23:00 | `-0.00022732` | `-0.00022732` | `-0.00022732` | `-0.00023336` |
| `G-SWAP-USDT`, 23:00 | `-0.00044339` | `-0.00044339` | `-0.00044339` | `-0.00044194` |
| `LRCX-SWAP-USDT`, 23:00 | `0.00017657` | `0.0001769` | `0.0001769` | `0.00017874` |

The rate charged was the last estimate published before the instant on 6 of 6 settlements, first seen 45 s before it.
For about 75 s after the instant the reply still named the instant just past as the next settlement and showed the rate just charged, and both moved together at 22:01:15 and at 23:01:15.
So a reader in that window sees a `nextFundingAt` in the past, which a poller can use to tell the stale rows apart.
The published rate changed at most once a minute, and every change was first seen 15 s after a whole minute at a 5 s poll, so each happened 10 to 15 s after the minute.

### How often each number changed

60 polls at one per second, from 21:34:44 UTC and from 22:00:31 UTC.

| contract | index changed | mark changed | funding rate changed | last changed | longest index hold |
|---|---:|---:|---:|---:|---:|
| `BTC-SWAP-USDT` | 37, 44 | 34, 46 | 1, 1 | 43, 43 | 3 s, 1 s |
| `ETH-SWAP-USDT` | 34, 36 | 24, 46 | 1, 1 | 40, 48 | 4 s, 3 s |
| `DOGE-SWAP-USDT` | 35, 42 | 20, 19 | 0, 0 | 27, 35 | 5 s, 2 s |
| `LSK-SWAP-USDT` | 11, 11 | 21, 18 | 1, 1 | 19, 24 | 15 s, 15 s |
| `AAPL-SWAP-USDT` | 6, 6 | 16, 7 | 0, 0 | 1, 6 | 15 s, 13 s |

The mark republishes once a second on a whole second, and the index of a busy contract changes on most seconds.
A quiet contract held its index for up to 15 s.
No reply took over 1 s, so the reader's 5 s skew and 10 s age limits are not at risk from this host, although the mark reaches the poller up to about 1 s after its own timestamp.

## 5. REST book snapshot

`GET /quote/v1/depth?symbol=&limit=`, weight 1 up to `limit` 100, 5 at 500 and 10 at 1,000, "Default 100", and "If limit=0 is set, a lot of data will be returned", S1.

| item | documented | probed |
|---|---|---|
| depth | 5, 10, 20, 50, 100, 500, 1000 by weight | 5, 20, 100 and 200 answered in full on BTC. 500 and 1000 answered 240 to 243 levels per side, the whole book. `limit=0` answered 100 per side, and `limit=5000` answered HTTP 200 with a book |
| order | bids high to low, asks low to high, S1 | as documented at every limit |
| time | `t` "Matching time" | the BTC book's `t` was 93 to 353 ms old on arrival, and the quiet `LSK-SWAP-USDT` book's 437 and 664 ms |
| sizes | | decimal strings in contracts, fractional on BTC |
| caching | | two reads 150 ms apart returned different `t` and bodies, with `cf-cache-status: DYNAMIC` |
| time per call | | 115 to 162 ms warm, 0.8 KB at 20 levels, 4.1 KB at 100, 9.9 KB for the whole book |

Between those two reads, 36 of the 40 prices both carried moved by within 1 % of one common factor, 0.970, in the rerun.
The whole ladder is rescaled at once, as the socket shows, see [`websocket.md`](./websocket.md) section 4.
`rest-probe.mjs mirror` compared the top 20 levels of four Toobit books with Binance USD-M read at the same moment, five rounds each, at 21:50 and 22:06 UTC.
Both touch prices equalled Binance's on BTC in 9 of 10 rounds and on ETH in 9 of 10, on DOGE in 2 of 10 and on SOL in none, and in the other rounds a Toobit touch price sat 1 to 14 ticks from Binance's.
Sizes at shared prices were not proportional to Binance's, with a coefficient of variation of the size ratio between 0.98 and 4.04 per side, so the Toobit book is not a scaled copy of Binance's.
Toobit's touch was the larger, for example 59,107.3 BTC contracts, 59.1 BTC, against Binance's 10.92 BTC at the same bid.

The recommended feed takes its snapshot from the socket and needs no REST book, see [`websocket.md`](./websocket.md) section 8.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public limit | "3000 weight per 1 minute" as `REQUEST_WEIGHT`, and `rateLimits` in `exchangeInfo` "will be removed in future iterations", S2 | `rateLimits` read `REQUEST_WEIGHT` `MINUTE` 1, `limit` 3000, `burst` 3000 |
| scope | per IP for public calls is implied by "the same IP", S5 | Not verified |
| status on limit | "HTTP 429 with error code -1003 TOO_MANY_REQUESTS", and 403 "when the WAF Limit (Web Application Firewall) has been violated", S2 | no limit was reached |
| reset | "retry only after the time indicated by the X-Api-Limit-Reset-Timestamp response header", S2 and S5 | Not verified |
| usage headers | "Every REST response (v1 and v2) includes the following headers": `X-Api-Limit-Status`, `X-Api-Limit`, `X-Api-Limit-Reset-Timestamp`, S2 | absent on every public reply in both runs |
| `Retry-After` | not documented | absent on every reply |
| abuse rule | "A high volume of repeated failed or invalid requests from the same IP within a short period, including but not limited to HTTP 404 and 429, may be classified as abnormal traffic and may result in a temporary IP ban", S5 | |
| error shape | Not publicly specified in the pages read. CCXT's error map quotes `{"code":-1004,"msg":"Missing required parameter 'xyz'"}` at `server/node_modules/ccxt/js/src/toobit.js` line 235 | `{"code": <negative number>, "msg": "..."}` with HTTP 400 |

| request | status | body |
|---|---:|---|
| `depth?symbol=NOPE-SWAP-USDT` | 400 | `{"code":-100011,"msg":"Not supported symbols"}` |
| `depth` without `symbol` | 400 | `{"code":-100012,"msg":"Parameter symbol [String] missing!"}` |
| `depth?symbol=REN-SWAP-USDT`, delisted | 200 | `{"t":1790114396163,"b":[],"a":[]}` |
| `fundingRate?symbol=NOPE-SWAP-USDT` | 400 | `{"code":-1130,"msg":"Data sent for paramter 'symbol' is not valid."}` |
| `markPrice?symbol=NOPE-SWAP-USDT` | 200 | an empty body |
| `index?symbol=NOPEUSDT` | 200 | `{"index":{},"edp":{}}` |
| `indexPriceComponents?symbol=NOPEUSDT` | 200 | `{}` |
| `/api/v1/nope` | 404 | `<html><body><h2>404 Not found</h2></body></html>` |

The engine's poller pauses on 403, 418 and 429, at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 194 and [`errors.ts`](../../../server/src/shared/errors.ts) line 1.
Toobit documents 403 for its firewall and 429 for its limit, so both land in that pause, and the documented reset header is absent today.
A mark reply with an empty body would fail to parse, so a poller has to treat a non-JSON 200 as a failed round.

## 7. Server time and clock offset

`GET /api/v1/time` returns `{"serverTime": 1790112378318}` in Unix milliseconds.
Three reads in each run had round trips of 120 to 126 ms and 115 to 116 ms, and bounded the local clock minus the server clock between −68 and +58 ms and between −55 and +61 ms.
That is consistent with no offset, and it cannot resolve anything finer than the round trip.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs | `https://api.toobit.com/quote/v1/index`, `https://api.toobit.com/quote/v1/markPrice` and `https://api.toobit.com/api/v1/futures/fundingRate`, each without `symbol`, fetched together each round | the three calls together carry every `AnchorRow` column for every contract |
| join | the index reply by the catalog's `indexToken`, the other two by contract id | the index reply is keyed by index token |
| interval | 1,000 ms | medians of 131 to 306 ms and a maximum of 491 ms, and the mark republishes once a second. Three calls a second, weight 1, 10 and 1 by CCXT's count, is 720 of the 3,000 per minute |
| row mapping | section 3 | |
| skip | rows not in the catalog, which drops the 48 `TBV_` contracts and the delisted ones | the mark and funding replies carry them |
| skip | rows whose `nextFundingTime` is in the past | for about 75 s after a settlement the row shows the rate just charged |
| catalog | refresh at most every 10 s | the edge caches `exchangeInfo` for 10 s |
| rate limit pause | `rateLimitPauseMs` 60,000 | the window is one minute, and the documented reset header is absent |
| deny list input | the 264 single source baskets of section 4, and the `TON` pair on USDT | a single source index is another venue's price, and Toobit's `TON` is Binance's `GRAM` |
| registry | `takerPpm: 600`, see [`fees.md`](./fees.md) section 9 | CCXT reports no fee |

The three bulk replies are about 250 KB a second at one hertz, about 22 GB a day, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Toobit API, USDT-M Market Data | https://api-docs.toobit.com/api/usdt-m-market-data.html | 2026-09-22, read here with `curl` | Toobit, global | endpoints, weights, fields, status values, depth limits, sections 2 to 5 |
| S2 | Toobit API, Basic Information | https://api-docs.toobit.com/api/basic-information.html | 2026-09-22, read here with `curl` | Toobit, global | rate limits, 403 and 429, limit headers, section 6 |
| S3 | Perpetual Futures: What is index price in future trading, dated 2026-09-05 | https://www.toobit.com/en-US/support/perpetual-futures-what-is-index-price-in-future-trading | 2026-09-22 | Toobit, global | index sources, outlier and staleness rules, section 4 |
| S4 | Perpetual Futures: What is mark price in futures trading, dated 2026-09-04 | https://www.toobit.com/en-US/support/perpetual-futures-what-is-mark-price-in-futures-trading | 2026-09-22 | Toobit, global | mark formula, section 4 |
| S5 | Toobit API, Introduction, API Usage Notice | https://api-docs.toobit.com/api/introduction.html | 2026-09-22, read here with `curl` | Toobit, global | abuse rule and reset header, section 6 |
| S6 | CCXT 4.5.68 `toobit.js` | `server/node_modules/ccxt/js/src/toobit.js` | 2026-09-22 | CCXT | catalog mapping and weights, sections 2 and 3 |
| P1 | `rest-probe.mjs main`, 21:34 to 21:36 UTC, and a rerun at 21:59 to 22:02 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/toobit/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs baskets`, 21:49 to 21:57 UTC, and a rerun at 22:06 to 22:14 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/toobit/rest-probe.mjs) | 2026-09-22 | this host | section 4 |
| P3 | `rest-probe.mjs settlement`, 21:58 to 22:02 UTC, and a rerun at 22:58 to 23:02 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/toobit/rest-probe.mjs) | 2026-09-22 | this host | section 4 |
| P4 | `rest-probe.mjs mirror`, 21:50 and 22:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/toobit/rest-probe.mjs) | 2026-09-22 | this host, and the public Binance USD-M depth call | section 5 |
| P5 | one-off `curl` of Binance USD-M `ticker/price` for `GRAMUSDT` and `TONUSDT`, okx `market/ticker` for `TON-USDT-SWAP`, bybit `market/tickers` for linear `TONUSDT`, and Toobit `contract/ticker/price` for `TON-SWAP-USDT`, 21:59 UTC | none | 2026-09-22 | this host | the `TON` and `GRAM` check, section 2 |
