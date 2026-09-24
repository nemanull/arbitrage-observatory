# KuCoin REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers the public futures REST API of KuCoin (CCXT ids `kucoinfutures` and `kucoin`) that a catalog, an anchor poller and a book resync would use, for every perpetual family.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/kucoin/rest-probe.mjs), run from `server/`.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-22 |
|---|---|---|
| `api-futures.kucoin.com` | futures REST base, S1 | CNAME `api-futures.kucoin.com.cdn.cloudflare.net`, two Cloudflare addresses, `cf-ray` suffix `SEA` |
| `api.kucoin.com` | spot and UTA REST base, S1 | CNAME `api.kucoin.com.cdn.cloudflare.net`, the same two addresses |
| `ws-api-futures.kucoin.com` | classic futures socket, see [`websocket.md`](./websocket.md) | CNAME `d24mrwuwr4a2xv.cloudfront.net`, four addresses, CloudFront `x-amz-cf-pop` `SEA900` |
| `x-push-futures.kucoin.com` | UTA futures socket | CNAME `d2zxrn4tk0lxwp.cloudfront.net`, four addresses, CloudFront `SEA900` |

Every host answers through a CDN edge in Seattle, and one early `curl` to the futures API went through Vancouver (`cf-ray` suffix `YVR`), so the addresses say nothing about where the matching engine runs, which is Not publicly specified.

Latency from the `main` run at 21:42 UTC, one process, Node `fetch` with a kept connection.
The first request of the process paid DNS and TLS, and later paths reused that connection.

| call | first request ms | next five, min / median / max ms | reply bytes, decoded | content-encoding |
|---|---:|---:|---:|---|
| `GET /api/v1/timestamp` | 388 | 116 / 119 / 126 | 38 | none |
| `GET /api/v1/contracts/active` | 286 | 212 / 255 / 429 | 1,402,535 | gzip |
| `GET /api/v1/allTickers` | 136 | 124 / 133 / 154 | 153,833 | gzip |
| `GET /api/v1/level2/depth20?symbol=XBTUSDTM` | 129 | 122 / 124 / 131 | 633 | br |

A rerun at 22:06 UTC gave first requests of 202, 288, 172 and 155 ms and warm medians of 124, 295, 146 and 122 ms.
The server's own time from `x-in-time` to `x-out-time` was 5 to 10 ms for the catalog and about 1 to 2 ms for the book.
The catalog reply is 137 KB on the wire under gzip, measured with `curl` at 21:49 UTC, and 1.40 MB without it.
These are one host on one date.

## 2. Catalog

### The instruments call

`GET /api/v1/contracts/active` lists every open futures contract of every family in one reply, weight 3 in the public pool, S1.

| family | rows | `type` | `status` | intervals in hours | CCXT loads it |
|---|---:|---|---|---|---|
| USDT-M perpetuals | 673 | `FFWCSX` | `Open` 673 | 8 on 242, 4 on 429, 1 on 2 | yes, `linear` |
| USDC-M perpetuals | 5 | `FFWCSX` | `Open` 5 | 8 on 5 | yes, `linear` |
| coin-margined inverse perpetuals | 4 | `FFWCSX` | `Open` 4 | 8 on 4 | yes, `inverse` |
| inverse dated futures | 2 | `FFICSX` | `Open` 2 | none | yes, type `future` |

The documented `status` values are `Init`, `Open`, `BeingSettled`, `Settled`, `Paused`, `Closed` and `CancelOnly`, S2.
Every row read `Open` on 2026-09-22, and 3 read `marketStage` `PRE_MARKET`: `ANTHROPICUSDTM`, `BPUSDTM` and `OPENAIUSDTM`.
The USDT-M rows split into 518 crypto, 6 metal, 3 commodity and 146 stock contracts, see [`fees.md`](./fees.md) section 3.

### How CCXT 4.5.68 maps it

| item | value | evidence |
|---|---|---|
| class | `kucoinfutures` loads contracts only, and `kucoin` loads 992 spot markets and the spot tickers as well | `server/node_modules/ccxt/js/src/kucoinfutures.js` lines 36 and 37, and `server/node_modules/ccxt/js/src/kucoin.js` lines 908 and 909 |
| call | `futuresPublicGetContractsActive` | `server/node_modules/ccxt/js/src/kucoin.js` line 1848 |
| `market.id` | the reply's `symbol`, for example `XBTUSDTM` | line 1915 |
| swap or future | a row without `nextFundingRateTime` is a future | line 1917 |
| `base`, `quote` | `baseCurrency` and `quoteCurrency` through the common currency map, so `XBT` becomes `BTC` and `ALT` becomes `APTOSLAUNCHTOKEN` | `server/node_modules/ccxt/js/src/base/Exchange.js` line 2419 and `server/node_modules/ccxt/js/src/kucoin.js` line 892 |
| `active` | `status === 'Open'` | line 1965 |
| `linear` | `!isInverse` | line 1967 |
| `taker` | the row's `takerFeeRate` | line 1969 |
| `contractSize` | the absolute value of `multiplier` | line 1971 |
| `loadMarkets` time | 1.1 s and 0.7 s for `kucoinfutures`, 1.0 s and 0.8 s for `kucoin`, over two runs | Probed |

Probed through the connector's filter, `type` swap, `swap` true and `active !== false`:

| result | value |
|---|---|
| active swaps | 682: 673 `USDT` linear, 5 `USDC` linear, 4 inverse settled in `BTC`, `ETH`, `SOL` and `XRP` |
| `market.id` against the reply's `symbol` | equal on 682 of 682 |
| `market.id` against the socket | `d.s` on the UTA socket spelled the same id on every stream, see [`websocket.md`](./websocket.md) section 3 |
| `contractSize` against `multiplier` | equal to its absolute value on 682 of 682 |
| `contractSize` values | 0.0001 on 2, 0.001 on 14, 0.01 on 123, 0.1 on 86, 1 on 166, 10 on 200, 100 on 67, 1000 on 17, 10000 on 2, 100000 on 4, 520000 on 1 |
| base renamed by CCXT | `XBTUSDTM`, `XBTUSDCM`, `XBTUSDM` from `XBT` to `BTC`, and `ALTUSDTM` from `ALT` to `APTOSLAUNCHTOKEN` |
| ids that are not ASCII | none |

Sample markets, as CCXT returned them.

| id | base | quote | settle | linear | contractSize | taker | precision.price | multiplier |
|---|---|---|---|---|---:|---:|---:|---:|
| `XBTUSDTM` | BTC | USDT | USDT | true | 0.001 | 0.0006 | 0.1 | 0.001 |
| `ETHUSDTM` | ETH | USDT | USDT | true | 0.01 | 0.0006 | 0.01 | 0.01 |
| `XBTUSDCM` | BTC | USDC | USDC | true | 0.0001 | 0.0006 | 0.1 | 0.0001 |
| `XBTUSDM` | BTC | USD | BTC | false | 1 | 0.0006 | 0.1 | -1 |
| `CHRUSDTM` | CHR | USDT | USDT | true | 1 | 0.0006 | 0.00001 | 1 |
| `AAPLUSDTM` | AAPL | USDT | USDT | true | 0.01 | 0.0006 | 0.01 | 0.01 |

### Size unit, pairs listed twice, price scale and tickers

Book sizes are lots of `multiplier` coins, and CCXT's `contractSize` is that multiplier, so the engine's size multiplier is right for every linear contract, see [`websocket.md`](./websocket.md) section 4.
The inverse rows carry `multiplier` -1, which S2 defines as "each XBTUSDM contract, correspond to 1 USD", and CCXT reports them as one coin per contract.

No pair is listed twice inside CCXT's own keys.
The quote family folds `USD` and `USDC` into `USDT`, so `BTC`, `ETH`, `SOL`, `XRP` and `SUI` each land on one pair two or three times, and [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 12 to 17 rank the USDT-M linear contract first.
Every USDC-M and inverse perpetual therefore loses to a USDT-M twin, which is why [`fees.md`](./fees.md) section 9 filters to `settle === 'USDT'`.

`OPENAIUSDTM` traded at 1,657.99 and `ANTHROPICUSDTM` at 2,121.96 at 22:07 UTC.
That is the basis Gate uses and ten times okx's, whose two contracts carry a price scale of 10 in [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) lines 20 to 23.
Both are pre-market on KuCoin, with an index that is KuCoin's own perpetual, see section 4, so a poller skips them.

The three tickers that `DENIED_PAIRS` denies for naming two tokens, at [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) lines 7 to 12, were checked against KuCoin's index baskets from the survey in section 4.
`.KBBUSDT` averages Binance, Bybit, Bitget, Gate and MEXC spot, `.KQNTUSDT` averages Binance, KuCoin, MEXC, Bybit and Bitget spot, and `.KONUSDT` averages MEXC, Binance Futures, Gate and Binance Alpha.
So KuCoin names Binance's token under all three, and the existing denials already cover the pairs.
`.KALTUSDT` prices `ALT` on Binance, Gate, KuCoin, MEXC and Bybit spot within 0.3 % of each other, while CCXT renames the base of `ALTUSDTM` to `APTOSLAUNCHTOKEN`.
That pair never meets another venue's `ALT|USDT`, which loses one pair and produces no false row.
No wider survey of shared tickers naming different tokens was run.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/contracts/active` | `indexPrice` | `markPrice` | `fundingFeeRate` | `fundingRateGranularity`, ms | `nextFundingRateDateTime`, Unix ms | 1.40 MB decoded, 137 KB gzip, 684 rows | 60 polls: min 162, median 215, p90 250, max 287 ms, and 165, 223, 287 and 325 ms in the rerun |
| `GET https://api.kucoin.com/api/ua/v2/market/funding-rate` | absent | absent | `nextFundingRate` | `currentGranularity`, ms | `fundingTime`, Unix ms | 154 KB, 682 rows | 365 ms, one `curl` |
| `GET /api/v1/allTickers` | absent | absent | absent | absent | absent | 154 KB, 685 rows | best bid, ask and last only |

One call carries every `AnchorRow` column for every family, and its rows are keyed by `symbol`, which is CCXT's `market.id`.
The per symbol calls `/api/v1/mark-price/{symbol}/current`, `/api/v1/funding-rate/{symbol}/current` and `/api/v1/index/query` carry the same numbers one contract at a time, S3 to S5.
The UTA funding call returns every perpetual when neither `symbol` nor `productType` is passed, S6, and it carries no index or mark.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `XBTUSDTM` | none |
| `index` | `indexPrice` | JSON number | none |
| `mark` | `markPrice` | JSON number, never 0 on 684 rows | none |
| `fundingRate` | `fundingFeeRate` | JSON number, a fraction per interval: `-0.000081` is -0.0081 % | none |
| `fundingIntervalHours` | `fundingRateGranularity` | integer ms: 28800000, 14400000, 3600000 | divide by 3,600,000 |
| `nextFundingAt` | `nextFundingRateDateTime` | integer Unix ms: `1790121600000` is 2026-09-23 00:00 UTC | none |

`nextFundingRateTime`, which S2 describes as "Next funding rate time (milliseconds)", is a countdown on the wire: 8192636 at 21:43:27 UTC is the 2.28 h left to 00:00 UTC.
`predictedFundingFeeRate` was null on 684 of 684 rows.
`lastTimeFundingRate` is the last settled rate, and it equalled `fundingFeeRate` on 524 of 682 perpetuals at 22:07 UTC.
The dated futures carry no funding fields at all.

## 4. Anchor semantics

### Index

The index is a weighted basket of spot prices, and `GET /api/v1/index/query?symbol={indexSymbol}&maxCount=1&reverse=true` returns it with its members under `decomposionList`, spelled that way, S5.
The row's `indexSymbol` names the index, for example `.KXBTUSDT`, and every perpetual had its own index on 2026-09-22.

| index | basket on 2026-09-22 |
|---|---|
| `.KXBTUSDT` for `XBTUSDTM` | Binance 0.4115, OKX 0.3293, KuCoin, Bybit and Gate 0.0864 each |
| `.KETHUSDT` for `ETHUSDTM` | Binance 0.3226, OKX 0.2258, KuCoin, Gate, Bybit and Bitget 0.1129 each |
| `.KXBTUSDC` for `XBTUSDCM` | Binance 0.3636, OKX 0.2545, Kraken, KuCoin and Bybit 0.1273 each |
| `.BXBT` for `XBTUSDM` | Binance 0.4, Coinbase 0.28, Kraken 0.14, Crypto.com 0.12, Bitstamp 0.06 |
| `.KCHRUSDT` for `CHRUSDTM` | Binance 0.4878, KuCoin 0.1708, Gate 0.1707, Bitget 0.1707 |
| `.KAAPLUSDT` for `AAPLUSDTM` | `binance_index` 0.3448, `finnhub` 0.3018, `okx_index` 0.3017, `binance_futures` 0.0517 at 21:44 UTC, and `binance_index` 0.4938, `okx_index` 0.4321, `binance_futures` 0.0741 at 22:09 UTC |

A survey of all 682 baskets at four requests a second, `rest-probe.mjs baskets` at 21:46 UTC, found these shapes.

| shape | contracts |
|---|---|
| one source | 3, each `kucoin_futures` at weight 1: `ANTHROPICUSDTM`, `BPUSDTM`, `OPENAIUSDTM`, all pre-market |
| two sources | 2, both holding KuCoin's own perpetual: `LUNRUSDTM` (`okx_index` 0.8537, `kucoin_futures` 0.1463) and `MPUSDTM` (`bitget_index` 0.8333, `kucoin_futures` 0.1667) |
| KuCoin's own perpetual inside the basket | 32. Weight 1 on the three pre-market contracts, 0.2632 on `GUAUSDTM`, 0.1333 on `ESIMUSDTM`, and 0.0566 to 0.1667 on 27 stock contracts, `MPUSDTM` and `LUNRUSDTM` highest |
| another venue's perpetual inside the basket | 166 hold `binance_futures`, at 0.5263 on `GUAUSDTM`, 0.4285 on `SIRENUSDTM`, 0.2059 on `TSTBSCUSDTM`, 0.1385 on `TAIKOUSDTM`, and 0.1333 or less elsewhere, at 22:09 UTC |

Source counts across the 682 were 1 source on 3, 2 on 2, 3 on 163, 4 on 229, 5 on 174, 6 on 92 and 7 on 19.
Member names across all baskets were `kucoin` 441, `gateio` 403, `binance` 348, `bitget` 323, `mexc` 322, `bybit` 250, `okex` 223, `binance_futures` 166, `binance_index` 145, `okx_index` 124, `binance_alpha` 74, `finnhub` 53, `kucoin_futures` 32, `bitget_index` 17, `coinbase` 13, `kraken` 12, `lbank` 9, `crypto` 4, `bitstamp` 3, `bitfinex` 3 and `bingx` 2.
The rerun at 22:09 UTC found `finnhub` in 60 baskets, so 3 sources on 156 and 4 on 236, and the stock weights of four baskets that hold KuCoin's perpetual had moved, so stock baskets change during the day.
A basket that is KuCoin's own perpetual at weight 1 is the self-index shape in [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), and only the three pre-market contracts have it.
`GUAUSDTM` is the one normal contract with more than half its weight on perpetuals, Binance's at 0.5263 and KuCoin's at 0.2632.

### Mark

S7, modified 2025-12-30, is the formula of record.

```text
Mark Price = Median (Price 1, Price 2, Contract Price)
Price 1 = Index Price × [1 + Latest Funding Rate × (Time Until Next Funding / Funding Interval)]
Price 2 = Index Price + Basis Moving Average
Basis Moving Average = moving average of (Mid-Price − Index Price) over the last 300 seconds, sampled once a second
Contract Price = Latest Traded Price
```

| clamp | documented | probed |
|---|---|---|
| premium cap | none published for the mark itself | Not publicly specified |
| index source guard | "correction rules (e.g., median × 1.05 limits)" on an abnormal source quote | |
| last 30 minutes before delisting | the mark becomes the average index since the start of that window, blended over 180 s | |
| pre-market | the mark is a moving average of the last traded price | the three pre-market indices are KuCoin's own perpetual, see above |
| publication | the mark call "Update snapshots once per second", S3 | `timePoint` on a whole second, 581 to 1,646 ms old on arrival with a median of 651 ms, and 361 to 1,483 ms with a median of 440 ms in the rerun |

The median with the last trade means the mark can equal the last price, and on quiet contracts it did.
Over 60 polls at 21:43 UTC `markPrice` equalled `lastTradePrice` on 32 `XBTUSDTM` polls, 13 `ETHUSDTM` polls, and 60 of 60 on `XBTUSDCM` and `XBTUSDM`, and on no `CHRUSDTM` or `AAPLUSDTM` poll.
On `XBTUSDCM` and `XBTUSDM` the mark did not change once in that minute while the index changed six times.
In the rerun at 22:07 UTC the pinning had moved: `AAPLUSDTM` equalled its last trade on 56 of 60 polls, `XBTUSDCM` on 1 and `XBTUSDM` on none, and `CHRUSDTM` equalled its index on 58.
A mark pinned to the last trade on a quiet contract reads a stale book as a fresh one, the same trap as Gate's, and it is worth a guard at open.
A mark pinned to the index hides a real premium, and on `CHRUSDTM` the index itself held for 58 s.

### Funding

The rate formula, the interest term, the cap and the interval rules are in [`fees.md`](./fees.md) section 6.
`GET /api/v1/funding-rate/{symbol}/current` returns `value`, `timePoint` (the start of the current interval), `fundingTime` (the next settlement), `granularity`, `fundingRateCap`, `fundingRateFloor`, `dailyInterestRate` and `lastTimeFundingRate`, S4.
Its `symbol` is the rate's own name, for example `.XBTUSDTMFPI8H`, and not the contract.
`GET /api/v1/premium/query?symbol=.XBTUSDTMPI` returns one-minute premium index points, and `GET /api/v1/contract/funding-rates?symbol=&from=&to=` returns settled rates `{"symbol", "fundingRate", "timepoint"}` with `timepoint` on the settlement instant.

### Rate across a settlement

`rest-probe.mjs settlement` read `contracts/active` every 5 s from 21:58:30 to 22:01:55 UTC, across the 22:00 settlement of the hourly `GUSDTM` and `ONEUSDTM`, and read `GUSDTM`'s current funding call beside it.
The rerun did the same across 23:00 UTC, where the four-hour `TRUSTUSDTM` also settled.

| contract and instant | shown in the last minute before the instant | shown from 0.1 s after it | first poll showing the settled rate | settled rate, history call | next estimate shown from |
|---|---|---|---|---|---|
| `GUSDTM`, 22:00 | `fundingFeeRate` -0.000285, `lastTimeFundingRate` -0.000453, next 22:00 | -0.000285, next already 23:00 | 22:00:05.1, `fundingFeeRate` and `lastTimeFundingRate` both -0.000279 | `{"symbol":"GUSDTM","fundingRate":-0.000279,"timepoint":1790114400000}` | 22:01:05.1, -0.000281 |
| `ONEUSDTM`, 22:00 | -0.000642, last -0.000515, next 22:00 | -0.000642, next already 23:00 | 22:00:20.1, both -0.000645 | `{"symbol":"ONEUSDTM","fundingRate":-0.000645,"timepoint":1790114400000}` | 22:01:10.1, -0.000663 |
| `GUSDTM`, 23:00 | -0.000022, last -0.000279, next 23:00 | -0.000022, next already 00:00 | 23:00:10.1, both -0.000018 | `{"symbol":"GUSDTM","fundingRate":-0.000018,"timepoint":1790118000000}` | 23:01:15.1, -0.000015 |
| `ONEUSDTM`, 23:00 | -0.00014, last -0.000645, next 23:00 | -0.00014, next already 00:00 | 23:00:10.1, both -0.000126 | `{"symbol":"ONEUSDTM","fundingRate":-0.000126,"timepoint":1790118000000}` | 23:01:10.1, -0.000112 |
| `TRUSTUSDTM`, 23:00 | 0.00005, last 0.00005, next 23:00 | 0.00005, next 03:00 | unchanged | `{"symbol":"TRUSTUSDTM","fundingRate":0.00005,"timepoint":1790118000000}` | unchanged in the window |

Before the instant `fundingFeeRate` is the running estimate for the upcoming settlement, and the value shown in the last minute was not the one charged.
The rate charged was a fresh calculation at the instant, which fits the 2023 upgrade plan's "at the end of a cycle, the calculated value is the Funding Rate used for settlement", S12.
For 5 to 20 s after the instant, over both runs, the reply kept the old estimate while `nextFundingRateDateTime` already named the next settlement.
It then showed the settled rate in both fields for about a minute, until the first estimate of the new cycle replaced `fundingFeeRate`.
So a reader in the first minute after a settlement sees either the stale estimate or the rate just charged, labelled as the upcoming one.
`fundingFeeRate` equal to `lastTimeFundingRate` does not mark that minute, since the two were equal on 524 of 682 perpetuals at 22:07 UTC.
The current funding call moved its `timePoint` and `fundingTime` on at the instant, and it showed the settled rate at 22:00:05 and at 23:00:05, one poll ahead of the bulk reply in the second run.
`TRUSTUSDTM` settled at 23:00 on a four-hour cycle and named 03:00 UTC next, so its grid is offset from the 00:00 grid of the other four-hour contracts.
`XBTUSDTM`, which settles at 00:00, changed its rate once in the first run, and in the rerun it read -0.000063, -0.000064 and -0.000063 on three polls 5 s apart after 23:01:10, which suggests, without proof, two backends answering from different minutes.

### How often each number changed

60 polls of `contracts/active` at one per second from 21:43:27 UTC, and the rerun from 22:07:22 UTC after the slash.

| contract | index changed | mark changed | funding rate changed | last changed | interval or next changed | longest index hold |
|---|---:|---:|---:|---:|---:|---:|
| `XBTUSDTM` | 35 / 42 | 27 / 31 | 0 / 3 | 14 / 22 | 0 / 0 | 7.0 s / 3.0 s |
| `ETHUSDTM` | 27 / 30 | 27 / 15 | 1 / 3 | 27 / 9 | 0 / 0 | 7.0 s / 9.0 s |
| `XBTUSDCM` | 6 / 6 | 0 / 6 | 1 / 0 | 0 / 0 | 0 / 0 | 10.0 s / 11.0 s |
| `XBTUSDM` | 6 / 6 | 0 / 6 | 1 / 0 | 0 / 0 | 0 / 0 | 10.0 s / 11.0 s |
| `CHRUSDTM` | 3 / 1 | 4 / 1 | 0 / 0 | 1 / 5 | 0 / 0 | 38.0 s / 58.0 s |
| `AAPLUSDTM` | 2 / 3 | 2 / 1 | 1 / 1 | 10 / 0 | 0 / 0 | 10.0 s / 30.0 s |

The index publishes on a one second grid, S5, and a busy contract changed it on half to two thirds of the polls.
Three funding rate changes in one minute on `XBTUSDTM` and `ETHUSDTM` in the rerun is more than one recalculation a minute, and whether the reply flips between two backends was not established.
No reply took over 1 s, so the reader's 5 s skew and 10 s age limits are not at risk from this host.

## 5. REST book snapshot

| call | depth | probed |
|---|---|---|
| `GET /api/v1/level2/depth20?symbol=` | 20 per side | 20 and 20 on `XBTUSDTM`, 633 to 648 bytes, 122 to 134 ms warm |
| `GET /api/v1/level2/depth100?symbol=` | 100 per side | 100 and 100, 2.8 KB |
| `GET /api/v1/level2/snapshot?symbol=` | the full book, S8 | 1,000 and 1,000 on `XBTUSDTM` in both runs, 25 KB, and 43 and 144, then 42 and 142, on `CHRUSDTM` |
| `GET /api/v1/level2/depth50?symbol=` | not documented | 404 `{"code":"404","msg":"not exist"}` |

| item | probed |
|---|---|
| order | bids descending and asks ascending on every call |
| fields | `{"sequence", "symbol", "bids", "asks", "ts"}`, prices and sizes as JSON numbers, sizes in lots, `ts` in nanoseconds |
| sequence | the same per contract sequence as the socket's `O` and `C`, and the socket book at that sequence matched 40 of 40 levels, see [`websocket.md`](./websocket.md) section 4 |
| caching | two reads 150 ms apart returned sequences 116 apart, and 42 apart in the rerun, and every reply read `cf-cache-status: DYNAMIC` |

The recommended feed takes its snapshot from the socket and needs no REST book, see [`websocket.md`](./websocket.md) section 8.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public limit | the public pool is counted per IP, 2,000 per 30 s at every VIP level, S9 | every futures reply carried `gw-ratelimit-limit: 2000` |
| weights | all symbols 3, all tickers 5, `level2/depth{size}` 5, full book 3, spot index 2, current funding 2, mark price 3, server time 2, public token 10, S1, S3 to S5, S8, S11. CCXT's cost table at `server/node_modules/ccxt/js/src/kucoin.js` lines 377 to 403 counts twice each | `gw-ratelimit-remaining` fell by 3 per `contracts/active` call and by 5 per `allTickers` and `depth20` call. `/api/v1/timestamp` replies carried no rate limit header |
| reset header | `gw-ratelimit-reset` is the countdown to the next quota reset in ms, S9 | values from 1,178 to 29,488 ms, and `gw-ratelimit-remaining` rose again after it, for example from 1,967 to 1,995 |
| status on limit | HTTP 429 with code `429000`, S9 | no limit was reached. The anchor loop held `gw-ratelimit-remaining` between 1,823 and 1,997 |
| server overload | 429000 without the rate limit headers, S9 | not seen |
| `Retry-After` | Not publicly specified | absent on every reply |
| error shape | `{"code", "msg"}` | HTTP 200 carrying a non `200000` code for a bad symbol, and HTTP 404 or 400 only for a bad path or a private call |

| request | status | body |
|---|---:|---|
| `level2/depth20?symbol=NOPEUSDTM` | 200 | `{"msg":"Invalid symbol.","code":"200003"}` |
| `level2/snapshot?symbol=NOPEUSDTM` | 200 | `{"msg":"Invalid symbol.","code":"200003"}` |
| `ticker?symbol=NOPEUSDTM` | 200 | `{"msg":"Invalid symbol.","code":"200003"}` |
| `contracts/NOPEUSDTM` | 200 | `{"msg":"The contract information you requested does not exist.","code":"404000"}` |
| `mark-price/NOPEUSDTM/current` | 200 | `{"msg":"mark price is not supported","code":"415000"}` |
| `funding-rate/NOPEUSDTM/current` | 200 | `{"msg":"funding rate is not supported","code":"415000"}` |
| `index/query?symbol=.NOPE` | 200 | `{"code":"200000","data":{"dataList":[],"hasMore":false}}` |
| `level2/depth50?symbol=XBTUSDTM` | 404 | `{"code":"404","msg":"not exist"}` |
| `/api/v1/nope` | 404 | `{"code":"404","msg":"Not Found","retry":false,"success":false}` |
| `/api/v1/trade-statistics` | 400 | `{"code":"400001","msg":"Please check the header of your request for KC-API-KEY, KC-API-SIGN, KC-API-TIMESTAMP, KC-API-PASSPHRASE."}` |

A poller must check `code` as well as the HTTP status, because KuCoin reports a bad request with HTTP 200.
The engine's poller pauses on 403, 418 and 429, at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 194 and [`errors.ts`](../../../server/src/shared/errors.ts) line 1, which covers the documented 429.
If KuCoin ever sends `429000` inside an HTTP 200 body, the poller has to throw `RateLimitReplyError` from the same file, lines 17 to 28, as the MEXC poller does.

## 7. Server time and clock offset

`GET /api/v1/timestamp` returns `{"code":"200000","data":1790113494904}` in Unix milliseconds.
Three reads with round trips of 160, 123 and 118 ms bounded the local clock minus the server clock between -60 and +58 ms at the tightest, and the rerun, at 119 to 121 ms, between -58 and +60 ms.
That is consistent with no offset, and it cannot resolve anything finer than the round trip.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api-futures.kucoin.com/api/v1/contracts/active` | one call carries all five `AnchorRow` fields for every family |
| interval | 1,000 ms, the default | median 215 and 223 ms and max 287 and 325 ms over two runs of 60 polls, weight 3 or 90 of the 2,000 per 30 s budget, and the index publishes on a one second grid |
| row mapping | section 3, key `symbol` | |
| skip | `marketStage` other than `NORMAL` | the three pre-market indices are KuCoin's own perpetual at weight 1, and their funding is fixed |
| skip | rows whose `status` is not `Open`, and rows without `nextFundingRateDateTime` | documented closing states, and the dated futures |
| do not read | `makerFeeRate` and `takerFeeRate` as a fee source for the anchor | the registry owns the fee, see [`fees.md`](./fees.md) section 9 |
| error check | treat any `code` other than `"200000"` as a failed round | HTTP 200 carries errors |
| rate limit pause | `rateLimitPauseMs` 30,000 | the window is 30 s, and no `Retry-After` was seen |
| deny list input | the basket survey in section 4 | `GUAUSDTM` holds perpetuals for 79 % of its weight, and `LUNRUSDTM` and `MPUSDTM` rest on one index source plus KuCoin's own perpetual |
| mark guard | treat a leg whose `markPrice` equals `lastTradePrice` on consecutive polls as unanchored | the median formula pins the mark to the last trade on quiet contracts |

The gzip reply is about 137 KB a poll, or about 12 GB a day at one hertz, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Get All Symbols, Classic Futures REST, weight 3 | https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-all-symbols | 2026-09-22 | KuCoin, global | the catalog call, sections 2 and 6 |
| S2 | Get All Symbols, OpenAPI export with field descriptions | https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-all-symbols.md | 2026-09-22 | KuCoin, global | status values, `multiplier`, `nextFundingRateTime`, sections 2 and 3 |
| S3 | Get Mark Price, modified 2026-09-08 | https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-mark-price | 2026-09-22 | KuCoin, global | per symbol mark, once a second, weight 3, sections 3, 4 and 6 |
| S4 | Get Current Funding Rate, Classic Futures, weight 2 | https://www.kucoin.com/docs-new/rest/futures-trading/funding-fees/get-current-funding-rate | 2026-09-22 | KuCoin, global | per symbol funding fields, sections 3, 4 and 6 |
| S5 | Get Spot Index Price, Classic Futures | https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-spot-index-price | 2026-09-22 | KuCoin, global | basket call, sections 3 and 4 |
| S6 | Get Current Funding Rate, UTA REST V2, modified 2026-09-16 | https://www.kucoin.com/docs-new/v2/rest/ua/get-current-funding | 2026-09-22 | KuCoin, global | the all symbols funding call, section 3 |
| S7 | Mark Price for USDT-Margined Futures, modified 2025-12-30 | https://www.kucoin.com/support/26684973273625 | 2026-09-22 | KuCoin, global | mark formula and guards, section 4 |
| S8 | Get Full OrderBook, Classic Futures | https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-full-orderbook | 2026-09-22 | KuCoin, global | the full REST book, section 5 |
| S9 | Rate Limit Rule (Classic), modified 2026-08-27 | https://www.kucoin.com/docs-new/rate-limit-rule-classic | 2026-09-22 | KuCoin, global | public pool per IP, headers, 429000, section 6 |
| S10 | CCXT 4.5.68 `kucoin.js` and `kucoinfutures.js` | `server/node_modules/ccxt/js/src/kucoin.js` | 2026-09-22 | CCXT | catalog mapping, section 2 |
| S11 | Get Server Time and Get Part OrderBook, Classic Futures | https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-server-time | 2026-09-22 | KuCoin, global | weights of the time and partial book calls, section 6 |
| S12 | KuCoin Futures Funding Rate Upgrades Plan, published 2023-10-18 | https://www.kucoin.com/announcement/en-kucoin-futures-funding-rate-upgrades-plan | 2026-09-22 | KuCoin, global | settled rate wording, section 4 |
| P1 | `rest-probe.mjs main`, 21:42 to 21:45 UTC, and the rerun at 22:06 to 22:09 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kucoin/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs baskets`, 21:46 to 21:49 UTC, and the rerun at 22:09 to 22:12 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kucoin/rest-probe.mjs) | 2026-09-22 | this host | section 4 |
| P3 | `rest-probe.mjs settlement`, 21:58 to 22:02 UTC, and the rerun at 22:58 to 23:02 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kucoin/rest-probe.mjs) | 2026-09-22 | this host | section 4 |
