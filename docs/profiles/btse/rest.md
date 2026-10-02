# BTSE REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:15 to 03:50 UTC), from the development host near Seattle.

This profile covers the public REST API of BTSE that a catalog, an anchor poller and a book resync would use, for its one perpetual family.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/btse/rest-probe.mjs), run from `server/`.
BTSE serves two public market APIs side by side: the markets API under `/public-api/market/v1`, which CCXT uses, and the legacy futures API under `/futures/api/v2.3`, S1, S2.
They spell a perpetual differently, and they differ in freshness, so both are recorded.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api.btse.com`, a CNAME to `api.btse.com.cdn.cloudflare.net` |
| addresses | `104.18.8.160` and `104.18.9.160`, resolved in 10.5 and 7 ms |
| edge | `server: cloudflare`, with a `cf-ray` suffix of `YVR`, Vancouver, in the first run and `SEA`, Seattle, in the second |
| cold request | 257 and 230 ms for `GET /spot/api/v3.3/time`, including TLS |
| warm request | 115 to 305 ms over 5 time calls in the first run, and 121 to 139 ms in the second |
| refusals | none. Every public call in this profile answered 200 or a documented 400 |

The documentation lists no regional host for the API.

## 2. Catalog

### The instruments call

`GET https://api.btse.com/public-api/market/v1/markets` returns every market, 1,315 rows and 472 KB in 201 and 145 ms, S1.
With `types=["FuturesPerpetual"]` it returns the 211 perpetuals only, in 107 KB.

| `type` | `category` | active rows on 2026-09-23 |
|---|---|---:|
| `FuturesPerpetual` | `CRYPTO` | 131 |
| `FuturesPerpetual` | `STOCK` | 74 |
| `FuturesPerpetual` | `COMMODITIES` | 6 |
| `FuturesTimeBased` | `CRYPTO` | 4 |
| `Spot` | `CRYPTO` | 1,100 |

Every row had `active` true.
No other status value appeared, and the documentation names only the `active` boolean, S1.
Every perpetual has `quoteCurrency` `USDT` and an `availableSettlement` list of 17 or 19 currencies, so the venue has one perpetual family.

The legacy `GET https://api.btse.com/futures/api/v2.3/market_summary` returns 215 rows, 153 to 157 KB in 128 and 134 ms: the same 211 perpetuals plus the 4 dated futures, with `contractSize` equal to the markets reply on 211 of 211.

### How CCXT maps it

CCXT 4.5.68 has no `btse` class.
The class exists from CCXT 4.5.74, and this mapping is read from `ts/src/btse.ts` of CCXT master at commit `1d8b674`, S3.

| engine field | CCXT source | BTSE value for BTC | line in master |
|---|---|---|---|
| `rawMarketId` from `market.id` | markets `symbol` | `BTC-PERP-USDT` | 721 |
| `base` | `baseCurrency` | `BTC` | 722 |
| `quote` and `settle` | `quoteCurrency` | `USDT` | 723 |
| `linear` | always true for a contract | true | 768 |
| `active` | `active` | true | 732 and 766 |
| `contractSize` | `contractSize` | 0.00001 | 738 and 772 |
| `taker` | `fees.contract.taker` | 0.00055 | 512 and 770 |

The engine keys the socket and the anchor by `rawMarketId`, and BTSE spells the same perpetual three ways.

| source | spelling |
|---|---|
| markets `symbol`, CCXT `market.id` | `BTC-PERP-USDT` |
| markets `tradeCurrency`, the socket topic and `data.symbol`, legacy `market_summary` and `price` | `BTC-PERP` |
| an error reply's echo of the symbol | `NOPEPFC-USDT`, the pre-v3 name |

`symbol` equals `tradeCurrency + '-USDT'` on 211 of 211 perpetuals, so the translation is a suffix, see [`websocket.md`](./websocket.md) section 4.

### Size unit, pairs listed twice, and price scale

| item | finding |
|---|---|
| size unit | contracts of `contractSize` coins, and the socket and REST books agree with it, see [`websocket.md`](./websocket.md) section 4. Sizes in use: 0.00001 (1), 0.0001 (3), 0.001 (12), 0.01 (65), 0.1 (51), 1 (79) |
| pairs listed twice | none. Each `baseCurrency` appears once among the perpetuals |
| thousand-unit bases | `1KPEPE`, `1KSHIB`, `1KFLOKI`, `1KBONK` and `1KCAT` quote a price per 1,000 tokens, `1KPEPE` at an index of 0.00493. CCXT keeps the base as `1KPEPE`, since `commonCurrencies` is empty at line 585, so these match no other venue's `1000PEPE` or `PEPE` and simply stay unclustered |
| renamed base | `TRUMP-PERP-USDT` has `baseCurrency` `TRUMPSOL`, so it will not cluster with `TRUMP` elsewhere |
| stock and commodity bases | 80 perpetuals whose base is a stock or commodity ticker. `GAS` is "Natural Gas" and `QNT` is "Quantinuum Inc.", while elsewhere those tickers name NEO's GAS token and Quant. `QNT|USDT` is already in `DENIED_PAIRS` at [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts) line 10, and `GAS` is not |

A `marketFilter` that keeps `info.category === 'CRYPTO'` removes every stock and commodity base at once, see [`types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/types.ts) line 23.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time, three runs of 60 polls |
|---|---|---|---|---|---|---|---|
| `GET /futures/api/v2.3/price` | `indexPrice` | `markPrice` | absent | absent | absent | 19.0 KB, 215 rows | median 118.5 to 128.7 ms, max 304 to 367 ms, none over 1 s |
| `GET /public-api/market/v1/ticker/indices?types=["FuturesPerpetual"]` | `indexPrice` | `markPrice` | absent | absent | absent | 17.8 KB, 211 rows | median 125.9 to 131.8 ms, max 165 to 307 ms except one poll of 2,286 ms |
| `GET /public-api/market/v1/ticker/24hr?types=["FuturesPerpetual"]` | absent | absent | `fundingRate` | `fundingIntervalMinutes` | `nextFundingTime`, Unix ms | 95.5 KB, 211 rows | median 130.0 to 143.0 ms, max 279 to 399 ms |
| `GET /futures/api/v2.3/market_summary` | absent | absent | `fundingRate` | absent | absent | 153 to 157 KB, 215 rows | 128 and 134 ms, single reads |

No single call carries all five `AnchorRow` fields.
The markets `ticker/indices` call looks like the natural anchor, and it is stale by design.
In each of three runs its index and mark changed on at most 2 of 59 consecutive one second polls on every perpetual, at 03:24:30.9 and 03:25:00.9 UTC in one run and 03:41:00.7 and 03:41:30.7 UTC in another, so it republishes every 30 s on the half minute.
At each refresh its BTC and ETH index equalled a legacy `price` index read in the same round in one run, and one round, about 1 s, earlier in the other.
Its reply `time` is the time the reply was built, a median of 61 and 76 ms before arrival, so nothing in the reply shows its age.
A poller stamping that reply on arrival would hand the engine numbers up to 30 s old as fresh, and each refresh would land as one jump that the 1,000 ppm move guard reads as a moving anchor.

The legacy `price` call republishes about once a second: the BTC index changed on 41 and 50 of 59 polls in two runs, and ETH on 54 and 52.
It is the call to poll.
Its rows are keyed by the legacy spelling `BTC-PERP`, and its numbers are JSON numbers, not strings.

Both calls publish the same mark.
At the two refreshes of the 03:40 run the markets mark equalled the legacy mark read in the same round on 129 and 127 of 211 perpetuals, with a median difference of 0 ppm and a maximum of 15 ppm, and the rest had moved between the two reads.

### Row mapping

| `AnchorRow` column | call and field | unit on the wire | conversion |
|---|---|---|---|
| key | `price` `symbol` | `BTC-PERP` | append `-USDT` to get `rawMarketId` |
| `index` | `price` `indexPrice` | JSON number | none |
| `mark` | `price` `markPrice` | JSON number, never 0 on 211 perpetuals | none |
| `fundingRate` | `ticker/24hr` `fundingRate` | decimal string, a fraction per interval: `"0.0001"` is 0.01 % | `Number()` |
| `fundingIntervalHours` | `ticker/24hr` `fundingIntervalMinutes` | integer minutes, 480 or 240 | divide by 60 |
| `nextFundingAt` | `ticker/24hr` `nextFundingTime` | Unix ms, `1790150400000` is 2026-09-23 08:00 UTC | none |

At 03:23 UTC the 144 perpetuals on 480 minutes read `1790150400000`, 08:00 UTC, and the 67 on 240 minutes read `1790136000000`, 04:00 UTC.
The `ticker/24hr` documentation says "Data refreshes every minute", S1.
Its `fundingRate` did not change in any of three 60 s runs, while its `closeTime` moved on 58 or 59 of 59 polls and the BTC `lastPrice` on 8 and 15, so the other fields refresh faster than once a minute.
The same rate read from `market_summary` every 10 s did not change within a run either.

## 4. Anchor semantics

### Index

"BTSE Perpetual Futures Index Price = Best Spot Liquidity Mid Price of Major Exchanges", where the mid is (best bid + best ask) / 2, S4.
The venues named are BTSE, Binance, Bitget, Bybit, Gate, MEXC and OKX, "and others if needed", S4.
The basket is spot books, and BTSE's own spot is in it, but not its perpetual.
A source more than 3 % from the median is capped and its weight halved, and one that stays out for about 30 s is excluded, S4.
No public call returns the basket or its weights, and S4 points to an "Index page" on the website that is rendered by script.
The older perpetual article names Bitfinex, Bitstamp, Bittrex, Coinbase Pro and Kraken instead, S5, which S4 supersedes.
Stock and commodity perpetuals have no documented index source, S6.
`SNDK-PERP-USDT` moved its index on 8 and 9 of 59 legacy polls at 03:22 and 03:40 UTC, when its US market was closed.

### Mark

"BTSE Perpetual Futures Mark Price = Median (Price 1, Price 2, Last Price)", S4, where:

- Price 1 = Index × (1 + Latest Funding Rate × (Time Until Next Funding / Funding Interval)).
- Price 2 = Index + the 5 minute simple moving average of (best bid + best ask) / 2 minus Index, sampled every second.
- Last Price is the perpetual's last trade.

So the mark is the perpetual's own last trade whenever that trade sits between Price 1 and Price 2.
On the last poll of each of three runs the legacy mark equalled the legacy last price on 32, 22 and 25 of 211 perpetuals, `BTC-PERP` among them in one run.
The mark sits on Price 1 just as often, and the markets `ticker/indices` reply shows it as a premium shared by many perpetuals.

| read at, UTC | premium shared by 8 h perpetuals | Price 1 premium for a rate of `0.0001` | premium shared by 4 h perpetuals | Price 1 premium for a rate of `0.00005` |
|---|---|---:|---|---:|
| 03:23:47 | 58 ppm on 8 | 57.5 ppm | 8 ppm on 14 | 7.5 ppm |
| 03:25:19 | 57 ppm on 5 | 57.2 ppm | 7 ppm on 5 | 7.2 ppm |
| 03:41:40 | 54 ppm on 27 | 53.8 ppm | 4 ppm on 15 | 3.8 ppm |

The Price 1 premium is the rate times the time left to the next settlement over the interval, with the next settlement at 08:00 UTC for 8 h and 04:00 UTC for 4 h, and 0 ppm, the Price 1 premium for a rate of 0, was shared by 13 to 17 perpetuals.
So the premium of such a mark is the funding carry, and it decays to 0 at each settlement.
S4 publishes no other clamp on the mark.
Across 211 perpetuals the premium of mark over index had a median absolute value of 141 to 190 ppm and a 90th percentile of 823 to 1,031 ppm over three runs, with extremes from -3,835 ppm on `RAVE-PERP-USDT` to +4,251 ppm on `CASHCAT-PERP-USDT`.
A mark that is the perpetual's last trade reads the perpetual's own dislocation as mark premium, the shape the engine has already met on Coinbase, so a BTSE leg's fresh edge carries that caveat.

### Funding

Funding Rate = Average Premium Index + Clamp(Interest Rate - Average Premium Index, 0.05 %, -0.05 %), with the premium index averaged over the funding period, S7.
No cap on the final rate is published, see [`fees.md`](./fees.md) section 6.

### Rate across a settlement

The published `fundingRate` is the running estimate for the upcoming settlement.

| perpetual | last settled, `recentFundingHistory` | published at 03:26 UTC | equal |
|---|---|---|---|
| `BTC-PERP-USDT` | `0.00005416` at 00:00:00.529 UTC | `0.00006072` | no |
| `ETH-PERP-USDT` | `0.0001` | `0.0001` | yes, both at the interest rate |
| `SNDK-PERP-USDT` | `0` | `0` | yes |
| `ENA-PERP-USDT`, 4 h | `0.00005` | `0.00005` | yes |

BTC read `0.00006016` at 03:15 UTC, `0.00006072` at 03:24 and 03:26 UTC, and `0.00006016` again at 03:41 UTC, so the estimate moves inside the period.
`recentFundingHistory` with `period=7D` returned 21 rows 8 h apart for an 8 h perpetual and 42 rows 4 h apart for a 4 h one, stamped 0.2 to 1.0 s after the hour.
It accepts both `BTC-PERP-USDT` and `BTC-PERP`.
The settlement instant itself was not captured, and whether the published rate resets at the hour is Not verified.

### How often each number changed

Changes between consecutive polls, out of 59, in the runs at 03:22 and 03:40 UTC.
The third pick is the perpetual at three quarters down the crypto volume ranking, which was `CHZ-PERP` in the first run and `ZORA-PERP` in the second.

| perpetual | legacy index | legacy mark | legacy last | markets index | markets mark | 24hr rate |
|---|---|---|---|---|---|---|
| `BTC-PERP` | 41 and 50 | 29 and 39 | 8 and 14 | 2 and 2 | 2 and 2 | 0 and 0 |
| `ETH-PERP` | 54 and 52 | 51 and 43 | 11 and 15 | 2 and 2 | 2 and 2 | 0 and 0 |
| `CHZ-PERP`, then `ZORA-PERP` | 13, then 43 | 56, then 47 | 1, then 1 | 2, then 2 | 2, then 2 | 0, then 0 |
| `1KCAT-PERP`, the least traded crypto perpetual | 24 and 23 | 45 and 46 | 0 and 0 | 2 and 2 | 2 and 2 | 0 and 0 |
| `SNDK-PERP`, the most traded stock | 8 and 9 | 42 and 38 | 2 and 5 | 1 and 2 | 2 and 2 | 0 and 0 |
| `SILVER-PERP` | 28 and 33 | 44 and 29 | 1 and 3 | 2 and 2 | 2 and 2 | 0 and 0 |

Across all 211 perpetuals the largest one poll move of the markets index was 6,757, 6,996 and 7,300 ppm in three runs, each a 30 s step.

## 5. REST book snapshot

| call | depth | level order | notes |
|---|---|---|---|
| `GET /public-api/market/v1/orderbook?symbol=BTC-PERP-USDT&depth=N` | 5, 20 or 50. `depth=51`, 100 and 500 answer 400 `Invalid depth`. No `depth` gives 10 | bids descending, asks descending with the best ask last | S1 says asks are "sorted by price ascending", and the wire disagrees |
| `GET /futures/api/v2.3/orderbook/L2?symbol=BTC-PERP&depth=N` | up to 50, and `depth=100` returns 50 | `buyQuote` descending, `sellQuote` ascending with the best ask first | levels are `{"price", "size"}` objects of strings |

Two markets reads 240 ms apart carried different `timestamp` values, with `cache-control: no-cache` and `cf-cache-status: DYNAMIC`, so the book is not cached.
The markets book accepts both spellings of the symbol.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| markets API | 50 requests per 2 s per IP, one bucket for every markets endpoint | S1 |
| legacy futures query | 15 per second per API and 30 per second per user | S2 |
| breach | a tiered block of 1 s, then 5 minutes, then 15 minutes, reset after an hour without a breach | S1, S2 |
| `Retry-After` | the authentication page says it holds "the unlock timestamp", the error page says "the number of seconds" | S1 |
| rate limit headers on a 200 | none. The reply headers were `cache-control`, `cf-cache-status`, `cf-ray`, `content-encoding`, `content-type`, `date`, `server`, `vary` and `x-request-id` | P1 errors |

No limit was provoked, so the 429 body and the `Retry-After` format are Not verified.
The format matters, because the poller at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) line 269 reads an all-digit header as seconds, and a Unix timestamp read that way would pause the poller for decades.

| request | status | body |
|---|---|---|
| markets `orderbook?symbol=NOPE-PERP-USDT` | 400 | `{"code":10010004,"msg":"Request parameter is invalid: Invalid symbol format NOPEPFC-USDT","success":false,"time":…,"data":[]}` |
| markets `orderbook` with no symbol | 400 | empty |
| markets `ticker/indices?symbol=NOPE-PERP-USDT` | 400 | code 10010004, the same message |
| markets `ticker/indices?types=NOPE` | 400 | `{"success":false,"code":10010004,"msg":"Invalid json format",…}` |
| markets `recentFundingHistory` with no `period` | 400 | empty |
| markets unknown path | 404 | empty |
| legacy `price?symbol=NOPE-PERP` | 400 | `{"status":400,"errorCode":-2,"message":"Unsupported symbol: NOPEPFC","extraData":null}` |
| legacy `orderbook/L2?symbol=NOPE-PERP` | 400 | `{"status":400,"errorCode":-7006,"message":"Coin pair does not exist","extraData":null}` |

## 7. Server time and clock offset

`GET https://api.btse.com/spot/api/v3.3/time` returns `{"iso":"2026-09-23T03:26:14.269Z","epoch":1790133974}`.
`/futures/api/v2.3/time` and `/public-api/market/v1/time` answer 404.
Over five reads the server clock led the local clock by 2.5 to 4 ms at a round trip near 115 ms, and by 33.5 ms on a first read at 191 ms.
The second run read 4.5 to 11.5 ms at round trips of 117 to 131 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| index and mark | `GET https://api.btse.com/futures/api/v2.3/price` every round, no `symbol` | one 19 KB call carries index and mark for every perpetual, republished about once a second |
| funding | `GET https://api.btse.com/public-api/market/v1/ticker/24hr?types=["FuturesPerpetual"]` every 30th round, cached between reads | it alone carries rate, interval and next settlement, the documentation says it refreshes once a minute, and the rate did not move within a minute |
| do not use | `public-api/market/v1/ticker/indices` | it republishes every 30 s and carries no data time |
| interval | 1,000 ms, the default | median 118.5 to 128.7 ms and max 367 ms, 1 of the 15 legacy queries per second allowed |
| row mapping | section 3, key `symbol + '-USDT'` | the legacy spelling drops the quote |
| skip | rows whose symbol has no `-PERP` suffix | the 4 dated futures are in the same reply |
| skip | stock and commodity perpetuals, if the catalog does not already drop them | their bases collide with crypto tickers, section 2 |
| rate limit pause | `rateLimitPauseMs` 10,000, and a guard that reads a `Retry-After` above 900 s as a Unix timestamp | the first block is 1 s and the next is 5 minutes, so a pause well past the first block is the safer side, and the `Retry-After` format is in dispute |
| deny list input | none from the index survey, since the basket is not published | |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTSE API documentation, full text for LLMs: Markets API, Authentication rate limits, Error Codes | https://docs.btse.com/llms-full.txt | 2026-09-22 | BTSE, global | markets endpoints and fields, rate limits, `Retry-After`, error format |
| S2 | BTSE Futures API v2.3 (legacy) | https://btsecom.github.io/docs/futuresV2_3/en/ | 2026-09-22 | BTSE, global | `price`, `market_summary`, `orderbook/L2`, legacy rate limits |
| S3 | CCXT master `ts/src/btse.ts`, commit `1d8b674` | https://github.com/ccxt/ccxt/blob/master/ts/src/btse.ts | 2026-09-22 | CCXT | market mapping, `commonCurrencies` |
| S4 | Index Price and Mark Price | https://support.btse.com/en/support/solutions/articles/43000557589 | 2026-09-22 | BTSE, global | index basket and outlier rule, mark formula |
| S5 | Perpetual Contracts | https://support.btse.com/en/support/solutions/articles/43000460017 | 2026-09-22 | BTSE, global | older index venue list |
| S6 | Introduction to Stock and Commodity Perps on BTSE | https://support.btse.com/en/support/solutions/articles/43000779697 | 2026-09-22 | BTSE, global | stock perpetuals trade around the clock, no index source named |
| S7 | Funding Fees | https://support.btse.com/en/support/solutions/articles/43000460020 | 2026-09-22 | BTSE, global | funding formula |
| P1 | `rest-probe.mjs` modes `host`, `catalog`, `anchor`, `funding`, `book`, `errors` and `time`, runs from 03:22 to 03:26 UTC, with a further `anchor` run at 03:24 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btse/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs all`, the second pass, 03:40 to 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btse/rest-probe.mjs) | 2026-09-23 UTC | this host | the second readings in sections 1 to 7 |
