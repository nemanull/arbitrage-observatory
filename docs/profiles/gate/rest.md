# Gate REST Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

This profile covers the public REST API v4 of Gate (CCXT id `gate`) that a catalog, an anchor poller and a book resync would use, for every perpetual family.
Every probed number comes from [`gate-venue-probe.mjs`](../../../scripts/probes/gate-venue-probe.mjs), run from `server/`.
Where the documentation and the wire disagree, both are written, and the wire is what a poller must handle.
The documentation pages refuse this host with HTTP 403, so they were read through a fetch that does not originate here, see [`fees.md`](./fees.md) section 1.
Where that fetch could not reach a section of the very long API reference, the endpoint descriptions come from Gate's generated Python SDK, labelled S3.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-15 | region, from Amazon's published ranges |
|---|---|---|---|
| `api.gateio.ws` | REST base `https://api.gateio.ws/api/v4`, S1 | CNAME `dualstack.balancer-gateio-ws-66098844.ap-northeast-1.elb.amazonaws.com`, eight A records | ap-northeast-1 on 8 of 8 |
| `fx-api.gateio.ws` | "Futures live trading alternative (futures only)", S1 | three A records | ap-northeast-1 on 3 of 3 |
| `fx-ws.gateio.ws` | futures WebSocket, see [`websocket.md`](./websocket.md) | eight A records | ap-northeast-1 on 8 of 8 |

The load balancer name and the ranges both place the public endpoints in AWS Tokyo.
That is an inference about where the addresses are announced, and it says nothing certain about where the matching engine runs.
The earlier hint of `3.115.230.238` was one of the rotating records and is not a fixed address.

Latency from the `main` run at 07:10 UTC, one process, Node `fetch` with a kept connection.
The first request of the process paid DNS and TLS, and later paths reused that connection.

| call | first request ms | next five, min / median / max ms | reply bytes | content-encoding |
|---|---:|---:|---:|---|
| `GET /spot/time` | 559 | 130 / 143 / 251 | 29 | gzip |
| `GET /futures/usdt/contracts` | 798 | 154 / 229 / 289 | 1,267,033 | none |
| `GET /futures/usdt/tickers` | 138 | 134 / 136 / 156 | 464,539 | none |
| `GET /futures/usdt/order_book?contract=BTC_USDT&limit=20&with_id=true` | 123 | 121 / 123 / 125 | 1,045 | none |

The server's own time from `x-in-time` to `x-out-time` was 4 to 9 ms for the bulk calls and about 1 ms for the book.
Node sent `accept-encoding` and the futures replies still came back uncompressed.
The same contracts call through `curl`, which opened a new TLS session each time, took 1.28 s at 06:57 UTC.
A rerun at 19:12 UTC gave the same order: first requests of 543, 872, 145 and 129 ms, and warm medians of 131, 161, 141 and 129 ms.
These are one host on one date.

## 2. Catalog

### The instruments call

`GET /futures/{settle}/contracts` lists every contract of one settlement currency, S1 and S3.
The SDK documents `limit` "default to 100" and `offset`.
On the wire a request without `limit` returned all 983 USDT contracts, and `limit=100` returned 100 in a `curl` check at 19:21 UTC, so a poller must not pass `limit`.

| settle path | rows | `type` | status values | intervals in seconds | CCXT loads it |
|---|---:|---|---|---|---|
| `usdt` | 983 | `direct` | `trading` 983 | 28800 on 593, 14400 on 382, 3600 on 8 | yes |
| `btc` | 1 (`BTC_USD`) | `inverse` | `trading` 1 | 28800 | yes |
| `usd1`, added in API v4.106.26, S1 | 9 | `direct` | `trading` 9 | 28800 on 9 | no |
| `usdc` | 400 `{"message":"Missing required header: Timestamp","label":"MISSING_REQUIRED_HEADER"}` | | | | no |

The documented status values are "prelaunch (pre-launch), trading (active), delisting (delisting), delisted (delisted), circuit_breaker (circuit breaker)", S3.
Every contract on 2026-09-15 read `trading`, `in_delisting` was false on all, and 11 carried `is_pre_market` true.
The pre-market contracts were `ANDURIL_USDT`, `ANTHROPIC_USDT`, `B200_USDT`, `BP_USDT`, `H100_USDT`, `KALSHI_USDT`, `KIMI_USDT`, `NEURALINK_USDT`, `OPENAI_USDT`, `POLYMARKET_USDT` and `QNTX_USDT`.
Of the 983 USDT contracts, `contract_type` was empty on 567 crypto contracts, `stocks` on 380, `indices` on 18, `metals` on 12, `commodities` on 3 and `forex` on 3.

### How CCXT 4.5.68 maps it

| item | value | evidence |
|---|---|---|
| calls | `publicFuturesGetSettleContracts` once per settle in `['usdt', 'btc']` | `server/node_modules/ccxt/js/src/gate.js` lines 839 to 843 and 1461 to 1479 |
| `market.id` | the reply's `name`, for example `BTC_USDT` | line 1603 |
| `base`, `quote` | `name` split on `_` | lines 1604 to 1608 |
| `linear` | `quote === settle` | line 1627 |
| `contractSize` | `quanto_multiplier`, and `"0"` becomes `"1"` | lines 1628 to 1632 |
| `active` | `status === 'trading'` | lines 1633 and 1649 |
| `taker` | the literal `0.0005` | line 1653 |
| `precision.amount` | the literal `1`, "all contracts have this step size" | line 1661 |
| `loadMarkets` time | 4.0 to 4.9 s, because it also loads 2,238 spot and 3,104 option markets | Probed |

Probed through the connector's filter, `type` swap, `swap` true and `active !== false`:

| result | value |
|---|---|
| active swaps | 984: 983 `USDT` linear and 1 `BTC` inverse |
| USD1 markets in CCXT | 0 |
| `market.id` against the reply's `name` | equal on 984 of 984 |
| `market.id` against the ticker reply's `contract` | the two replies list the same 983 names |
| `market.id` against the socket | `ob.<market.id>.50` delivered for every id tried, including `币安人生_USDT` |
| `contractSize` other than 1 | 787 of 984 |
| `contractSize` values | 0.0001 on 8, 0.001 on 27, 0.01 on 195, 0.1 on 208, 1 on 197, 10 on 206, 11 on 1, 100 on 117, 1000 on 14, 10000 on 6, 100000 on 1, 1000000 on 1, 10000000 on 3 |
| ids that are not ASCII | `哈基米_USDT`, `币安人生_USDT`, `牛来_USDT`, `龙虾_USDT` |
| `enable_decimal` true | 14: `ARIA_USDT`, `ESPORTS_USDT`, `ETH_USDT`, `LAB_USDT`, `M_USDT`, `PEPE_USDT`, `RAVE_USDT`, `RIVER_USDT`, `SIREN_USDT`, `SOL_USDT`, `SOXS_USDT`, `TRX_USDT`, `UB_USDT`, `XRP_USDT` |

Sample markets, as CCXT returned them.

| id | base | quote | settle | linear | contractSize | taker | precision.price | quanto_multiplier |
|---|---|---|---|---|---:|---:|---:|---|
| `BTC_USDT` | BTC | USDT | USDT | true | 0.0001 | 0.0005 | 0.1 | `"0.0001"` |
| `ETH_USDT` | ETH | USDT | USDT | true | 0.01 | 0.0005 | 0.01 | `"0.01"` |
| `CHR_USDT` | CHR | USDT | USDT | true | 10 | 0.0005 | 0.00001 | `"10"` |
| `INIT_USDT` | INIT | USDT | USDT | true | 10 | 0.0005 | 0.00001 | `"10"` |
| `PEPE_USDT` | PEPE | USDT | USDT | true | 10000000 | 0.0005 | 1e-9 | `"10000000"` |
| `BTC_USD` | BTC | USD | BTC | false | 1 | 0.0005 | 0.1 | `"0"` |

### Size unit, pairs listed twice, and price scale

Book sizes are contracts of `quanto_multiplier` coins, and CCXT's `contractSize` is that multiplier, so the engine's size multiplier is right for every USDT contract, see [`websocket.md`](./websocket.md) section 4.
Prices are per coin even on large multipliers: `PEPE_USDT` last traded at 0.000003394 with 10,000,000 coins per contract.
`precision.amount` of 1 is wrong for the 14 decimal contracts, and the engine does not read it.

No pair is listed twice inside CCXT's own keys.
The quote family folds `USD` into `USDT`, so `BTC_USD` and `BTC_USDT` land on one pair, and [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 12 to 16 rank the linear contract first.
That drop matters, because CCXT reports `BTC_USD` with `contractSize` 1, which the engine reads as 1 BTC per contract, while its book sizes look like US dollars, see [`websocket.md`](./websocket.md) section 4.

No Gate contract needs a price scale for the pairs checked.
`OPENAI_USDT` last traded at 1,455.74 and `ANTHROPIC_USDT` at 2,125.98 on Gate at 07:10 UTC, while okx's `OPENAI-USDT-SWAP` and `ANTHROPIC-USDT-SWAP` read 149.18 and 214.2 at 07:24 UTC.
Gate therefore quotes those two on the basis okx reaches after its price scale of 10 in [`clusterOverrides.ts`](../../../server/src/engine/cluster/clusterOverrides.ts) lines 20 to 23.
Both are pre-market contracts on Gate, with no index basket, see section 4.
Whether a Gate ticker names a different token than the same ticker on another venue was not surveyed, and `DENIED_PAIRS` needs that check before Gate joins.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /futures/usdt/contracts` | `index_price` | `mark_price` | `funding_rate` | `funding_interval`, seconds | `funding_next_apply`, Unix seconds | 1.27 MB, 983 rows | 60 polls: min 152, median 158, p90 240, max 1,043 ms, 1 poll over 1 s |
| `GET /futures/usdt/tickers` | `index_price` | `mark_price` | `funding_rate` | absent | absent | 465 KB, 983 rows | 60 polls: min 130, median 134, p90 157, max 554 ms |
| `GET /futures/btc/contracts` | same fields | | | | | 1.3 KB, 1 row | 471 ms first request |
| `GET /futures/usd1/contracts` | same fields | | | | | 11.5 KB, 9 rows | 122 ms first request |

One call per family carries every `AnchorRow` column, and the rows are keyed by `name`, which is CCXT's `market.id`.
The contracts reply is 2.7 times the ticker reply.
The index and mark in the contracts reply matched the ticker reply read at the nearest instant on 45 of 60 BTC polls, 48 ETH, 58 INIT and 60 CHR, and on 39, 32, 57 and 60 in the rerun at 19:13 UTC.
The two loops ran about 400 ms apart, so a miss is a number that moved between the two reads, and neither call leads the other.
The ticker reply also carries `funding_rate_indicative`, which the SDK marks "deprecated. use `funding_rate`", S3, and it equalled `funding_rate` on every poll.
`GET /futures/usdt/premium_index` answers only with `contract`, and without it returns 400 `MISSING_REQUIRED_PARAM`.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `name` | string, `BTC_USDT` | none |
| `index` | `index_price` | decimal string | `Number()` |
| `mark` | `mark_price` | decimal string, never 0 on 983 rows | `Number()` |
| `fundingRate` | `funding_rate` | decimal string, a fraction per interval: `"0.000072"` is 0.0072 % | `Number()` |
| `fundingIntervalHours` | `funding_interval` | integer seconds: 28800, 14400, 3600 | divide by 3,600 |
| `nextFundingAt` | `funding_next_apply` | integer Unix seconds: `1789459200` is 2026-09-15 08:00 UTC | multiply by 1,000 |

At 06:59 UTC the 975 contracts on 8 h or 4 h read `1789459200`, 08:00 UTC, and the 8 hourly contracts read `1789455600`, 07:00 UTC.
At 07:10 UTC all 983 read `1789459200`.
`funding_offset` was 0 on every contract, and its meaning is Not publicly specified.

The funding rate is a fraction per interval and not per 8 h.
The formula divides by `8 / N`, so a 1 h contract publishes one eighth of the 8 h equivalent, see [`fees.md`](./fees.md) section 6.

## 4. Anchor semantics

### Index

The index is a weighted basket of spot prices, and `GET /futures/{settle}/index_constituents/{index}` returns it, with the index name equal to the contract name.
The reply is `{"index", "time", "constituents": [{"exchange", "symbols", "price", "weight"}]}`, and a pre-market contract answers 400 `{"label":"INVALID_PARAM_VALUE","message":"invalid index"}`.

| index | basket on 2026-09-15 |
|---|---|
| `BTC_USDT` | Binance, Bitget, Bybit, Gate, MEXC, OKX spot, 0.1667 each |
| `ETH_USDT` | Binance, Bitget, Bybit, Gate, OKX spot, 0.2 each |
| `CHR_USDT` | Binance, Bitget, Gate, KuCoin, MEXC spot, 0.2 each |
| `BTC_USD` | Coinbase, Crypto.com, OKX spot `BTC_USD`, 0.3333 each |
| `BTC_USD1` | Binance, Bitget, Bybit, Gate, MEXC spot `BTC_USD1`, 0.2 each |
| `ONE_USDT` | BinanceFutures, GateFutures, OKXFutures `ONE_USDT`, 0.3333 each |
| `NVDA_USDT` | BinanceFutures, BinanceIndex, BitgetFutures, BybitFutures, GateFutures, Hyperliquid:XYZ, OKXFutures, OKXIndex, iTick `NVDA_USD`, about 0.111 each |
| `XAU_USDT` | BinanceFutures, BitgetFutures, BitgetIndex, BybitFutures, GateFutures, GateTradFi `XAU_USD`, Hyperliquid:XYZ `GOLD_USDT`, about 0.143 each |

A survey of every trading crypto contract that is not pre-market, 566 baskets at one request per second, found three shapes the engine has been burnt by before.

| shape | contracts |
|---|---|
| one source, a DEX pool or Gate's own web3 venue | 15: `AINVDA_USDT`, `BEN_USDT`, `BONER_USDT`, `DELTA_USDT`, `EMBER_USDT`, `FATCOIN_USDT`, `FONE_USDT`, `GIGGLEMAX_USDT`, `INDEX_USDT`, `LAPTOP_USDT`, `MICRODUCK_USDT`, `MOO_USDT`, `PAIR_USDT`, `PROLOGUE_USDT`, `SHROOM_USDT` |
| Gate's own perpetual inside the basket | 20: `NES_USDT` at 0.8, `EDGE_USDT` at 0.4999, `SCRT_USDT` and `SPACEHOOD_USDT` at 0.5, `ONE_USDT` and `TAIKO_USDT` at 0.3333, `BULLA_USDT`, `ESPORTS_USDT`, `GUA_USDT`, `PLAY_USDT` and `币安人生_USDT` at 0.25, `H_USDT`, `MEMECOIN_USDT`, `M_USDT`, `SIREN_USDT`, `SKYAI_USDT` and `UP_USDT` at 0.2, `EVAA_USDT` and `STBL_USDT` at 0.1667, `LAB_USDT` at 0.1429 |
| only Gate sources | `EDGE_USDT` (Gate spot 0.5001 and GateFutures 0.4999), `SCRT_USDT` (Gate spot and GateFutures, 0.5 each), `GT_USDT` (Gate `GT_USDT` 0.7 and Gate `GT_BTC` 0.3), `FONE_USDT` (GateWeb3 1.0) |

Source counts across the 566 baskets were 1 source on 15, 2 on 18, 3 on 50, 4 on 108, 5 on 213, 6 on 126, 7 on 34 and 8 on 2.
14 crypto baskets hold another venue's perpetual, named `BinanceFutures`, `OKXFutures`, `BybitFutures` or `HyperliquidFutures`.
`ONE_USDT` holds both Binance's and Gate's perpetual, which is the self-index shape in [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), on a third of the weight.
A basket weighted 0.8 on its own perpetual, like `NES_USDT`, makes the mark trail the perpetual in the same way.
The TradFi baskets follow.

A second survey covered the 406 trading TradFi contracts that are not pre-market.

| shape | count |
|---|---|
| one source | 76: 61 on `iTick` alone, 9 on `GateTradFi` alone (`AUS200_USDT`, `CITIC_USDT`, `GER40_USDT`, `HK50_USDT`, `HSCHKD_USDT`, `JPN225_USDT`, `SBP_USDT`, `TW88_USDT`, `UK100_USDT`), 4 on `Massive` alone, 2 on `GVol` alone |
| Gate's own perpetual inside the basket | 295, at weights from 0 to 0.3333, and none at 0.5 or more. `CLS_USDT`, `FUTUON_USDT`, `MARA_USDT`, `PG_USDT` and `SOFTBANK_USDT` list it at weight 0 |
| a member named `BinanceFutures`, `BitgetFutures`, `BybitFutures` or `OKXFutures` | 238 |

Source counts across the 406 were 1 source on 76, 2 on 9, 3 on 69, 4 on 50, 5 on 66, 6 on 43, 7 on 55, 8 on 22 and 9 on 16.
A typical stock basket is `AAPL_USDT`: BinanceFutures, BinanceIndex, BitgetFutures, BybitFutures, GateFutures, Hyperliquid:XYZ, OKXFutures, OKXIndex and iTick `AAPL_USD`, 0.1111 each.
So most TradFi indices on Gate are averages of perpetuals, Gate's own among them, plus a data vendor, and a TradFi route between Gate and binance, bybit or okx compares indices built partly from the same perpetuals.

### Mark

S4, dated 2021-08-25, is the formula of record.

```text
Mark Price = Median(Price 1, Price 2, Latest Traded Price)
Price 1 = Index Price × (1 + Funding Rate Basis Rate)
Funding Rate Basis Rate = Funding Rate × (Time to Next Funding Settlement / Funding Interval)
Price 2 = Spot Index + Moving Average Basis
Moving Average Basis = SUM(Sampled Basis) / Number of Samples
Basis = (Best Bid + Best Ask) / 2 - Index Price
```

| clamp | documented | probed |
|---|---|---|
| averaging window | "Sampled basis typically refers to the set of basis values calculated every second over the past 5 minutes." The window "can be shortened to as little as 1 minute" when the basis expands rapidly | |
| TradFi deviation | "For TradFi contracts, the mark price is limited to a maximum deviation of 3% from its index, while crypto contracts have a wider permitted range." | |
| crypto deviation | wider than 3 %, and no number is published | Not publicly specified |
| spike protection | "When the mark price experiences significant fluctuations relative to the past few minutes, the mark price will stop updating." It resumes if the price reverts | |
| `mark_type` | "internal - internal trading price, index - external index price", S3 | `index` on 983 of 983 |

The median with the last trade means the mark can equal the last price.
Over 60 polls `mark_price` equalled `last_price` on 6 to 8 BTC polls, 2 to 3 ETH polls, all 60 CHR polls and no INIT poll, and 432 of 983 contracts in one read.
The rerun at 19:13 UTC counted 3 to 7 BTC polls, 5 to 6 ETH polls, all 60 CHR polls, no INIT poll, and 345 of 983 contracts.
On `INIT_USDT` the mark equalled the index on 60 of 60 polls while the last trade sat 0.5 % above.
In the rerun it equalled the index on 0 of 60 polls, with index 0.067, mark 0.06697 and last 0.0659, so this pinning comes and goes.
A mark pinned to the last trade on a quiet contract reads a stale book as a fresh one, and a mark pinned to the index hides a real premium, so neither is a pure smoothed premium.
The mark premium is not capped by a published number on crypto contracts.
On TradFi contracts it is capped at 3 %, so a TradFi leg sitting more than 3 % off its index reads as a fresh premium, the same trap as a capped kraken mark.

### Funding

The rate formula, the interest term, the cap and the interval rules are in [`fees.md`](./fees.md) section 6.
The rate and the premium index are recalculated every 60 s, and the rate settled is the last calculation of the cycle, S5.
`GET /futures/usdt/premium_index?contract=BTC_USDT` returns one-minute candles of that premium index, `{"t", "o", "h", "l", "c"}` with `t` in seconds.
The SDK documents its `interval` "default to '5m'", S3, and the wire without `interval` returned candles 60 s apart.
`GET /futures/usdt/funding_rate?contract=BTC_USDT` returns settled rates `{"r", "t"}`, with `t` one or two seconds after the settlement instant, for example `1789430401` for 00:00:01 UTC.

### Rate across a settlement

`gate-venue-probe.mjs settlement` read four contracts every 5 s from 19:58:31 to 20:01:59 UTC, across the 20:00 settlement of the hourly `CVC_USDT` and `IOST_USDT`.

| contract | shown in the last minute before 20:00 | shown in the first minute after 20:00 | settled at 20:00, history call | shown from 20:01:03 |
|---|---|---|---|---|
| `CVC_USDT` | `-0.000978`, next `1789502400` (20:00) | `-0.000967`, next `1789506000` (21:00) | `{"r":"-0.000967","t":1789502400}` | `-0.000762` |
| `IOST_USDT` | `-0.000126`, next 20:00 | `-0.00012`, next 21:00 | `{"r":"-0.00012","t":1789502401}` | `-0.000063` |

The published rate is recalculated once a minute, and every change was first seen 2 to 5 s after a whole minute at a 5 s poll.
Before the instant the rate is the running estimate for the upcoming settlement, and the value shown in the last minute was not the one charged.
The rate charged was the calculation made at the instant, which fits S5's "last calculation in the current cycle".
For about one minute after the instant the reply shows that settled rate while `funding_next_apply` already names the next settlement.
So a reader in that minute sees the rate just charged labelled as the upcoming one, and the first estimate of the new cycle replaced it at 20:01:03.
`BTC_USDT` and `CHR_USDT`, which settle at 00:00, kept that next settlement, and only `BTC_USDT` changed its rate, on the minute.

### How often each number changed

60 polls at one per second from 07:10:46 UTC, both calls side by side.

| contract | call | index changed | mark changed | funding rate changed | last changed | interval or next changed |
|---|---|---:|---:|---:|---:|---:|
| `BTC_USDT` | tickers | 20 | 23 | 0 | 35 | |
| `BTC_USDT` | contracts | 20 | 23 | 0 | 32 | 0 |
| `ETH_USDT` | tickers | 18 | 19 | 0 | 35 | |
| `ETH_USDT` | contracts | 16 | 17 | 0 | 42 | 0 |
| `CHR_USDT` | tickers | 0 | 0 | 0 | 0 | |
| `CHR_USDT` | contracts | 0 | 0 | 0 | 0 | 0 |
| `INIT_USDT` | tickers | 2 | 2 | 0 | 0 | |
| `INIT_USDT` | contracts | 2 | 2 | 0 | 0 | 0 |

On BTC the index and mark changed on consecutive seconds during active stretches, and the longest wait between two index changes was 8 s on BTC and 11 s on ETH.
The rerun at 19:13 UTC counted 38 to 42 index changes on BTC and 43 to 46 on ETH, the funding rate changed once on both, and no index waited more than 3 s.
The republish cadence is therefore at least once a second, and a quiet contract can hold its index for the whole minute.
No reply took over 2 s, so the reader's 5 s skew and 10 s age limits are not at risk from this host.

## 5. REST book snapshot

`GET /futures/{settle}/order_book?contract=&interval=&limit=&with_id=`, S3: "Bids will be sorted by price from high to low, while asks sorted reversely".

| item | documented | probed |
|---|---|---|
| depth | `limit` "Number of depth levels", default 10 | 20, 100 and 300 answered in full on BTC. `limit=1000` answered 400 `{"label":"TOO_BIG","message":"limit 300"}` |
| order | bids high to low, asks low to high | bids descending and asks ascending at every limit on BTC and CHR |
| id | `with_id` adds `id`, "This ID increments by 1 each time depth changes" | `id` present only with `with_id=true`, and it is the socket's `u` space |
| timestamps | `current` "Response data generation timestamp", `update` "Order book changed timestamp" | seconds with millisecond decimals. On a quiet CHR book `update` was 49 s older than `current` |
| sizes | | JSON integers of contracts, prices as strings. On decimal contracts the size is rounded down, unless the request carries `X-Gate-Size-Decimal: 1`, which returns sizes as strings with decimals, see [`websocket.md`](./websocket.md) section 4 |
| aggregation | `interval` "0 means no aggregation" | not probed beyond the default |
| caching | | two reads 150 ms apart returned ids 156 apart and fresh `current`, so no edge cache showed |
| time | | 118 to 125 ms warm, about 1 KB at 20 levels, 4.9 KB at 100, 14 KB at 300 |

The recommended feed takes its snapshot from the socket and needs no REST book, see [`websocket.md`](./websocket.md) section 8.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public limit | public endpoints are limited "based on IP", S6. The per endpoint table is an image and the API reference section did not load through the fetch | every reply carried `x-gate-ratelimit-limit: 200`. `x-gate-ratelimit-requests-remain` never fell below 190 over 60 one second polls of one endpoint, fell by one per call over eight calls 1.1 s apart, and read 199 on the first request to another endpoint, which fits 200 requests per endpoint per 10 s. CCXT's comment reads "200 requests per 10 second" at `server/node_modules/ccxt/js/src/gate.js` line 23 |
| reset header | | `x-gate-ratelimit-reset-timestamp` in Unix seconds, equal to the second of the reply |
| status on limit | Not verified | no limit was reached |
| `Retry-After` | Not verified | absent on every reply |
| error shape | | `{"label": "...", "message": "..."}` with HTTP 400, and `message` can be absent |

| request | status | body |
|---|---:|---|
| `order_book?contract=NOPE_USDT` | 400 | `{"label":"CONTRACT_NOT_FOUND"}` |
| `tickers?contract=NOPE_USDT` | 400 | `{"label":"CONTRACT_NOT_FOUND"}` |
| `contracts/NOPE_USDT` | 400 | `{"label":"CONTRACT_NOT_FOUND"}` |
| `order_book?contract=BTC_USDT&limit=1000` | 400 | `{"label":"TOO_BIG","message":"limit 300"}` |
| `/futures/usdc/contracts` | 400 | `{"message":"Missing required header: Timestamp","label":"MISSING_REQUIRED_HEADER"}` |
| `premium_index` without `contract` | 400 | `{"label":"MISSING_REQUIRED_PARAM","message":"Missing required parameter: contract"}` |
| `index_constituents/OPENAI_USDT` | 400 | `{"label":"INVALID_PARAM_VALUE","message":"invalid index"}` |

The engine's poller pauses on 403, 418 and 429, at [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 191.
Which of those Gate sends at the limit is Not verified, so a Gate poller should also log any other non-200 status in full.

## 7. Server time and clock offset

`GET /spot/time` returns `{"server_time": 1789456236538}` in Unix milliseconds.
The reply arrived at local 1789456236591 after a 217 ms round trip, so the local clock minus the server clock lay between −164 and +53 ms.
That is consistent with no offset, and it cannot resolve anything finer than the round trip.
The rerun at 19:14 UTC had a 597 ms round trip and bounded the offset between −512 and +85 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.gateio.ws/api/v4/futures/usdt/contracts`, without `limit` | one call carries all five `AnchorRow` fields for all 983 contracts |
| second family | `https://api.gateio.ws/api/v4/futures/btc/contracts` only while a BTC-settled market is tracked | the one inverse contract is ranked out by the quote family |
| interval | 1,000 ms, the default | median 158 ms and max 1,043 ms over 60 polls, 10 of the 200 per 10 s budget, and the index moves at up to once a second |
| alternative | `tickers` every second for index, mark and rate, plus `contracts` every 60 s for interval and next settlement | 465 KB instead of 1.27 MB per second, at the cost of a `nextFundingAt` up to a minute stale after each settlement |
| row mapping | section 3, key `name` | |
| skip | `is_pre_market` true, whose index has no basket, and 10 of which carry a `funding_rate_limit` of 0.000001 | 11 contracts, among them `OPENAI_USDT` and `ANTHROPIC_USDT` |
| skip | rows whose `status` is not `trading` | documented states `delisting`, `delisted`, `circuit_breaker` |
| do not read | `maker_fee_rate`, `taker_fee_rate` | not the retail schedule, see [`fees.md`](./fees.md) section 5 |
| rate limit pause | `rateLimitPauseMs` 10,000 | the window is 10 s, and no `Retry-After` was seen |
| deny list input | the index survey in section 4 | `NES_USDT`, `EDGE_USDT`, `SCRT_USDT`, `SPACEHOOD_USDT`, `ONE_USDT`, `TAIKO_USDT`, `GT_USDT` and `FONE_USDT` have baskets that are mostly or only Gate, or a third or more Gate's own perpetual |

The bulk reply is about 110 GB a day at one hertz, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Gate API v4, API overview and changelog | https://www.gate.com/docs/developers/apiv4/en/ | 2026-09-15 | Gate, global | base URLs, `fx-api` host, `usd1` settle value, sections 1 and 2 |
| S2 | Gate Futures WebSocket v4.0.0 | https://www.gate.com/docs/developers/futures/ws/en/ | 2026-09-15 | Gate, global | socket cross references |
| S3 | Gate Python SDK docs, `FuturesApi.md`, `Contract.md`, `FuturesTicker.md`, `FuturesOrderBook.md`, `FuturesPremiumIndex.md`, `IndexConstituent.md`, `FundingRateRecord.md` (repository archived, last push 2026-07-16, generated from the API specification) | https://raw.githubusercontent.com/gateio/gateapi-python/master/docs/FuturesApi.md | 2026-09-15 | Gate, SDK | endpoint parameters and field descriptions, sections 2 to 5 |
| S4 | Mark Price Calculation, dated 2021-08-25 | https://www.gate.com/help/futures/logical/22067/instructions-of-dual-price-mechanism-mark-price-last-traded-price | 2026-09-15 | Gate, global | mark formula and clamps, section 4 |
| S5 | Contract Funding Rate and Funding Fee Explanation, dated 2022-08-17 | https://www.gate.com/help/futures/futures-logic/27569/funding-rate-and-funding-fee | 2026-09-15 | Gate, global | recalculation cadence, settled rate, section 4 |
| S6 | Gate.io Will Adjust API Rate Limits, published 2023-07-03 | https://www.gate.com/announcements/article/31282 | 2026-09-15 | Gate, global | public limits applied per IP, section 6 |
| S7 | AWS IP address ranges, `createDate` 2026-09-15-04-47-05 | https://ip-ranges.amazonaws.com/ip-ranges.json | 2026-09-15 | Amazon Web Services | region of the resolved addresses, section 1 |
| S8 | CCXT 4.5.68 `gate.js` | `server/node_modules/ccxt/js/src/gate.js` | 2026-09-15 | CCXT | catalog mapping, section 2 |
| P1 | `gate-venue-probe.mjs main`, 07:10 to 07:12 UTC, and a rerun at 19:12 to 19:15 UTC | [`gate-venue-probe.mjs`](../../../scripts/probes/gate-venue-probe.mjs) | 2026-09-15 | this host | sections 1 to 7 |
| P2 | `gate-venue-probe.mjs baskets crypto`, 07:15 to 07:25 UTC, and `baskets tradfi` | [`gate-venue-probe.mjs`](../../../scripts/probes/gate-venue-probe.mjs) | 2026-09-15 | this host | section 4 |
| P3 | `gate-venue-probe.mjs settlement`, 19:58 to 20:02 UTC | [`gate-venue-probe.mjs`](../../../scripts/probes/gate-venue-probe.mjs) | 2026-09-15 | this host | section 4 |
