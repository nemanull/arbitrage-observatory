# Biconomy.com REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:10 to 03:43 UTC), from the development host near Seattle.

This profile covers the public futures REST surface of Biconomy.com for its one perpetual family, USDT-margined.
The official API documentation, "Biconomy Open API V3", covers spot only, see [`fees.md`](./fees.md) S12.
The futures calls below are the ones the futures web app makes, read from its bundle, S1, under the base `https://openapi.biconomy.com/future/api/v1`.
They are public and unauthenticated, but no document describes or promises them.
Every number was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/biconomy/rest-probe.mjs) unless a source is named.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `openapi.biconomy.com`, from `PRIMARY_HOST` in S1. `api.biconomy.com`, the documented spot host, resolves to the same addresses and serves the same fee call |
| resolved | 104.26.14.129, 104.26.15.129 and 172.67.71.7, Cloudflare, with the edge answering from SEA and YVR |
| backup host | `openapi.biconomy.world`, from `BACKUP_HOST` in S1, resolved to 158.51.123.205, not probed |
| origin | "The biconomy server runs in Tokyo.", S2 |
| cold request | `ping` 328 and 201 ms, `ticker/list` 336 and 132 ms, `allFundingRate` 767 and 961 ms, `detailV2` 332 and 184 ms, in two runs of `latency` |
| warm request | `ping` 113 to 141 ms, `ticker/list` 131 to 179 ms, `detailV2` 170 to 224 ms, `allFundingRate` 113 to 129 ms with one outlier of 674 to 707 ms in each run |

No request from this host was refused, challenged or geoblocked.

## 2. Catalog

### The instruments call

`GET /future/api/v1/detailV2?client=web` returns every contract the venue has listed, in 370,898 bytes, in 775 and 794 ms.
The fields are short names, and their meaning below is inferred from values and from the web app, since nothing documents them.

| field | meaning | on `BTC_USDT` |
|---|---|---|
| `symbol` | contract id | `BTC_USDT` |
| `bc`, `qc`, `sc` | base, quote, settle | `BTC`, `USDT`, `USDT` |
| `cs` | contract size in base units | 0.0001 |
| `ft` | 1 on all 511 rows, perpetual | 1 |
| `pu`, `vu` | price tick, size step in contracts | 0.1, 1 |
| `minV`, `maxV` | order size bounds in contracts | 1, 12,091,000 |
| `mfr`, `tfr` | maker and taker fee rate | 0.0002, 0.0006 |
| `io` | index sources, section 4 | `OKEX_FUTURE`, `BYBIT_FUTURE`, `GATEIO_FUTURE`, `BINANCE`, `BITGET_FUTURE` |
| `state` | 0 trading, 3 delisted | 0 |
| `ih`, `ihd` | display flags, true on 5 and 1 active contracts | false, false |

| state | rows | evidence |
|---|---|---|
| 0 | 295 | exactly the 295 contracts in `ticker/list` and in `allFundingRate` |
| 3 | 216 | none is in `ticker/list`, and they include `LRC_USDT`, `BB_USDT` and `VANRY_USDT`, whose delisting the help center announced |

All 511 rows settle and quote in USDT, so the active count by settlement asset is USDT 295, USDC 0 and coin 0.
The 295 rows carried `mfr` 0.0002 and `tfr` 0.0006 without exception, and none has a base listed twice.

### How CCXT maps it

CCXT 4.5.68 has no class for Biconomy, and neither has CCXT master, see [`fees.md`](./fees.md) section 8.
`ccxt.mexc` cannot be reused with other URLs, as was possible for a MEXC-derived venue, because this API renamed MEXC's paths: `detail`, `ticker`, `funding_rate/{symbol}` and `index_price/{symbol}` all answer 404 under this base, and `detailV2` is not MEXC's `detail` shape.
So the catalog needs a loader that reads `detailV2` in place of `loadMarkets`, mapping as follows.

| engine field | from `detailV2` | check |
|---|---|---|
| `rawMarketId` | `symbol` | the socket's `s`, the ticker `symbol` and the funding `symbol` spell it identically on 295 of 295 contracts |
| `base`, `quote` | `bc`, `qc` | `symbol` equals `bc + "_" + qc` on 295 of 295 |
| `linear` | true | settle is USDT on every row |
| `contractSize` | `cs` | turnover recovers it, `amount24 / (volume24 * curPrice)` within 15 % on 294 of 295, the exception `NIL_USDT` at 0.79 to 0.82 against 1 |
| `active` | `state === 0` | 295 rows |
| `takerPpm` | `tfr` times 1,000,000 | 600 on every active row |

### Size unit, pairs listed twice, and price scale

Book sizes are contracts of `cs` coins, and the socket and the REST book use the same unit, see [`websocket.md`](./websocket.md) section 4.
Contract sizes range from 0.0001 (2 contracts) to 10,000,000 (1 contract), with 120 contracts at 0.01 and 47 at 0.1.
No contract name carries a multiplier prefix, and prices are per coin: `PEPE_USDT`, with a contract of 10,000,000 PEPE, read 0.000004918 while Gate's `PEPE_USDT` read 0.000004924.
So no price scale is needed.
No pair is listed twice.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time, 60 polls per run |
|---|---|---|---|---|---|---|---|
| `GET /future/api/v1/ticker/list?timezone=24H` | `indexPrice` | `fairPrice` | `fundingRate` | absent | absent | 87 KB, 295 rows | median 176 and 130 ms, p90 199 and 167, max 619 and 316, none over 1 s |
| `GET /future/api/v1/allFundingRate` | absent | absent | `fundingRate` | `cycle`, hours | `nextSettleTs`, ms | 32.7 KB, 295 rows | median 123 and 115 ms, p90 185 and 279, max 784 and 894, none over 1 s |

Two calls per round cover every `AnchorRow` column for all 295 contracts, keyed by `symbol`.
No `indexPrice` or `fairPrice` was 0 on any row.
Per contract, `GET /future/api/v1/fundingRate/{symbol}` returns the same row as `allFundingRate`.

The ticker reply is a snapshot taken about once a second.
Its BTC `ts` was 358 to 1,817 ms old on arrival by the local clock, median 1,194 and 1,399 ms.
The local clock was within 3 to 7 ms of the server's.
The BTC `ts` changed on 55 and 50 of 59 one-second intervals, so some polls got the previous snapshot again.
The reply carries `cache-control: max-age=2, public, s-maxage=5`, while Cloudflare reported `cf-cache-status: DYNAMIC`.

The rate in the two replies disagreed on 18 and 19 contracts at some poll in the two runs.
The two calls are separate snapshots, so a round should take the rate from one of them only.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTC_USDT` | none |
| `index` | `ticker/list` `indexPrice` | JSON number | none |
| `mark` | `ticker/list` `fairPrice` | JSON number | none |
| `fundingRate` | `allFundingRate` `fundingRate` | JSON number, a fraction per interval: `0.00007089` is 0.007089 % | none |
| `fundingIntervalHours` | `allFundingRate` `cycle` | integer hours: 8 on 293 contracts, 4 on `BASED_USDT`, 1 on `ONG_USDT` | none |
| `nextFundingAt` | `allFundingRate` `nextSettleTs` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

At 03:19, 03:30 and 03:42 UTC the 293 contracts on 8 h read 08:00 UTC and the two others read 04:00 UTC.

## 4. Anchor semantics

### Index

The help center defines the index as a "Weighted average price from multiple spot markets", where "exchanges with higher trading volumes have greater weight", S3.
The basket per contract is public as the `io` list of `detailV2`, without weights.

| sources per basket | contracts |
|---|---|
| 1 | 5 |
| 2 | 7 |
| 3 | 72 |
| 4 | 82 |
| 5 to 13 | 129 |

The source names are `BYBIT_FUTURE` 158 times, `BINANCECIP` 170, `OKEX_FUTURE` 150, `GATEIO_FUTURE` 134, `BINANCE` 108, `BITGET_FUTURE` 100, `HYPERLIQUID` 98, `BYBIT` 96, `HUOBI_FUTURE` 93, `OKEX` 88, `GATEIO` 72, `MEXC_FUTURE` 45, `MEXC` 29, `KUCOIN` 27, `BITGET` 27 and `HUOBI` 9.
Many of them are other venues' perpetuals, not the spot markets the help center describes.
No basket names Biconomy itself, so the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) does not arise.
The five single-source baskets are `ICP_USDT` on `BITGET_FUTURE`, `HANMI_USDT` on `BYBIT_FUTURE`, `KNC_USDT` on `GATEIO_FUTURE`, `THE_USDT` on `MEXC` and `XTZ_USDT` on `BITGET`.

The `ICP_USDT` index is frozen.
Its hourly index candles from `GET /future/api/v1/kline/indexPrice/ICP_USDT?interval=Min60` were flat at 2.944 for the 42 hours since 2026-09-21 10:00 UTC, in all four runs of `index`.
Over the same minutes Bybit's `ICPUSDT` read 3.043 with an index of 3.046, Bitget's `ICPUSDT` read 3.046, and Biconomy's own mark read 3.029 to 3.057.
So the mark sat 28,872 to 38,383 ppm above the index.
`ANTHROPIC_USDT`, with a basket of `BYBIT_FUTURE` and `BINANCECIP`, had its mark 24,115 to 24,539 ppm below its index without a flat index.
A poller has to skip both, or the engine has to deny the pairs.

### Mark

The help center says the mark is "Calculated based on index price and funding rate", is "generally the midpoint price of the order book", is "linked to the index price", and includes a "moving average basis", S3.
It gives no formula and no clamp.
On the wire, `fairPrice` equalled the last trade on 68 and 74 of 295 contracts, lay inside the touch on 137 and 157, and within 100 ppm of the mid on 102 and 120, in two runs of `index`.

| mark minus index | contracts, four reads |
|---|---|
| under 1,000 ppm | 199 to 222 |
| 1,000 to 5,000 ppm | 68 to 91 |
| 5,000 to 10,000 ppm | 3 |
| over 10,000 ppm | 2, `ICP_USDT` and `ANTHROPIC_USDT` |

No clamp tighter than 38,383 ppm is in force, since `ICP_USDT` read that far from its index.

### Funding

The formula and cap are Not publicly specified, see [`fees.md`](./fees.md) section 6.
In the third `catalog` run at 03:42 UTC, 124 of 295 contracts published exactly 0.0001, 10 published 0, 14 published exactly 0.0005 and 8 exactly -0.0005, and none was beyond 0.0005.

### Rate across a settlement

The help center calls the published number "the current upcoming funding rate", S4.
The settlement instant itself was not captured, because no probe waited for one.
`GET /future/api/v1/fundingRate/history?symbol=<id>&page_num=1&page_size=20` returns `settleTime`, `fundingRate` and `collectCycle` per settlement, newest first.

| contract | settlements on record | newest settled rate | live rate at 03:20 and 03:31 UTC |
|---|---|---|---|
| `BTC_USDT` | 2,795 | 0.00000592 at 00:00 UTC | 0.00007089 |
| `ETH_USDT` | 2,801 | 0.00008316 at 00:00 UTC | 0.00010377 |
| `ONG_USDT`, 1 h | 648 | 0.00001665 at 03:00 UTC | 0.00001665 |
| `BASED_USDT`, 4 h | 952 | 0.00005234 at 00:00 UTC | 0.00005234 |

On every twelfth active contract, 25 in all, the live rate equalled the newest settled rate on 19 in both runs, 12 of them at a round 0.0001, 0.0005 or 0.
So the published rate is not always the last settled one, as BTC and ETH show, but on most contracts it had not moved since the last settlement.
Whether the settled rate is the one published just before the instant is Not verified.

### How often each number changed

Over 59 one-second intervals of `anchor`, first run and rerun.

| contract | index changed | mark changed | rate changed |
|---|---|---|---|
| `BTC_USDT` | 12, 11 | 33, 30 | 0, 0 |
| `ETH_USDT` | 12, 12 | 25, 26 | 0, 0 |
| `ONG_USDT` | 7, 5 | 11, 10 | 0, 0 |
| `KNC_USDT` | 1, 0 | 1, 1 | 0, 0 |
| `NATGAS_USDT` | 1, 0 | 2, 0 | 0, 0 |

The index of the busiest contracts moves about once every 5 s, and the socket's `push.index.price` sent 4 and 5 BTC frames in 20 s, which agrees.
That is slower than the "few seconds" the design flags, and a 1,000 ppm index jump in one poll therefore covers about 5 s of market.
Rates do move between settlements on some contracts: `PONS_USDT` published 0.00023032 and then 0.00023086 on the socket eight minutes apart, and 18 and 19 contracts changed rate between the two calls of one poll round.

## 5. REST book snapshot

| call | depth | shape | probed |
|---|---|---|---|
| `GET /future/api/v1/depth/{symbol}` | whole book | `{asks, bids, version, timestamp}`, levels `[price, contracts, orders]` as JSON numbers | 1,231 to 1,236 bids and 984 to 995 asks on BTC, 170 and 171 bids on NATGAS, 147 to 149 on KNC, in 114 to 426 ms |
| `GET /future/api/v1/depth/{symbol}?limit=20` | 20 per side | same | 811 and 814 bytes, 20 and 20 |
| `GET /future/api/v1/depth/priceStep/{symbol}?priceStep=0.1` | 25 per side, aggregated | `{ct, s, t, asks, bids, version}` | 25 and 25 at steps 0.1 and 1 |
| `GET /future/api/v1/depth/BTC_USDT/20` | | | 404 |

Bids come descending and asks ascending on every read of four contracts.
The `version` is the counter the socket's depth channels carry, see [`websocket.md`](./websocket.md) section 4.
The depth replies carry no `cache-control`, and two reads 300 ms apart returned different versions in both runs, so the book is not cached.
A delisted contract returns `{"asks":[],"bids":[],"version":0,...}`, and a lowercase `btc_usdt` returns the BTC book.

## 6. Rate limits and errors

The futures limits are Not publicly specified.
The spot documentation publishes 5 requests per second per IP for `ping` and `time` and 20 for the market calls, and lists HTTP 429 "Too Many Requests", S2.
No reply from this host carried a rate limit or `Retry-After` header, and no limit was met at about 3 requests per second.

| request | HTTP | body |
|---|---|---|
| `fundingRate/NOPE_USDT` | 200 | `{"success":false,"code":1001,"message":"Contract does not exist!"}` |
| `depth/NOPE_USDT` | 200 | the same |
| `nope`, `contract/detail`, and the MEXC paths `detail`, `ticker`, `funding_rate/BTC_USDT`, `index_price/BTC_USDT` | 404 | `{"success":false,"code":404,"message":"Not Found"}` |
| `fundingRate/history?symbol=NOPE_USDT` | 200 | `success` true with an empty `resultList` |
| `fundingRate/LRC_USDT`, delisted | 200 | a row with rate -0.0005 and the 08:00 UTC settlement |
| `depth/LRC_USDT`, delisted | 200 | empty sides, version 0 |

An error arrives inside an HTTP 200 with `success` false, so a poller must check `success` and not the status alone.
What a limit hit returns on the futures host was not observed.

## 7. Server time and clock offset

`GET /future/api/v1/ping` returns `{"success":true,"code":0,"data":<ms>}`, the server time in ms.
Against it, the server clock read 7 ms and 3 ms ahead of this host at the best round trips of 117 and 110 ms, and 5 and 6 ms ahead in the two `book` runs of [`ws-probe.mjs`](../../../scripts/probes/venues/biconomy/ws-probe.mjs).

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URLs | `https://openapi.biconomy.com/future/api/v1/ticker/list?timezone=24H` and `https://openapi.biconomy.com/future/api/v1/allFundingRate`, fetched together each round | the ticker call has index and mark, the funding call has rate, interval and next settlement, and both cover all 295 contracts |
| interval | 2,000 ms | the ticker is a one-second snapshot that repeated on some polls, the index moves about every 5 s, and no futures limit is published |
| row mapping | section 3, key `symbol` | |
| rate source | `allFundingRate` only | the two calls are separate snapshots and disagreed on 18 and 19 contracts |
| success check | treat `success` false as an error | errors arrive as HTTP 200 |
| skip | `ICP_USDT`, whose index was frozen for 42 hours, and `ANTHROPIC_USDT`, whose mark sat 2.4 % under its index | a stale or detached index reads as a false premium |
| skip | contracts not in `ticker/list` | the 216 delisted rows still answer on the per contract calls |
| rate limit pause | `rateLimitPauseMs` 10,000 | no limit or `Retry-After` is published for this host |
| flag | the index republishes about every 5 s, and the ticker snapshot is up to 1.8 s old on arrival | the reader's move and age guards were sized for faster venues |

The two replies are about 120 KB per round, which is about 5 GB a day at one round every 2 s.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | biconomy.com futures web app bundle `index-54684f1e.js`, `baseConfig` and `http$1` calls | https://static.biconomy.com/site1/futures/static/js/index-54684f1e.js | 2026-09-22 | Biconomy.com | hosts, base path, every public call name, sections 1 to 5 |
| S2 | BiconomyOfficial/apidocs README, "Biconomy Open API V3", commit `f08b6c68` of 2026-08-25 | https://github.com/BiconomyOfficial/apidocs | 2026-09-22 | Biconomy.com | spot only, Tokyo origin, spot limits and 429, sections 1 and 6 |
| S3 | What Are Index Price, Mark Price, and Last Price?, updated 2025-03-27 | https://biconomy.zendesk.com/hc/en-us/articles/44426422000281-What-Are-Index-Price-Mark-Price-and-Last-Price | 2026-09-22 | Biconomy.com, global | index and mark definitions, section 4 |
| S4 | Funding Rate Explained, updated 2025-03-27 | https://biconomy.zendesk.com/hc/en-us/articles/30554671089177-Funding-Rate-Explained | 2026-09-22 | Biconomy.com, global | "the current upcoming funding rate", section 4 |
| S5 | Bybit and Bitget public tickers for `ICPUSDT` | https://api.bybit.com/v5/market/tickers?category=linear&symbol=ICPUSDT and https://api.bitget.com/api/v2/mix/market/ticker?symbol=ICPUSDT&productType=USDT-FUTURES | 2026-09-22 | Bybit, Bitget | the ICP market while the Biconomy index was frozen, section 4 |
| S6 | Gate public ticker for `PEPE_USDT` | https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=PEPE_USDT | 2026-09-22 | Gate | price per coin, section 2 |
| P1 | `rest-probe.mjs catalog`, `latency`, `history`, `book` and `errors`, two runs at 03:19 to 03:31 UTC on 2026-09-23, and a third `catalog` and `errors` run at 03:42 and 03:43 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/biconomy/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 2, 4, 5, 6 and 7 |
| P2 | `rest-probe.mjs anchor`, 60 polls at 03:21 and at 03:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/biconomy/rest-probe.mjs) | 2026-09-22 | this host | section 3 and the change counts of section 4 |
| P3 | `rest-probe.mjs index`, four runs at 03:29 to 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/biconomy/rest-probe.mjs) | 2026-09-22 | this host | the frozen ICP index, the mark statistics, section 4 |
| P4 | `ws-probe.mjs tickers` and `book` | [`ws-probe.mjs`](../../../scripts/probes/venues/biconomy/ws-probe.mjs) | 2026-09-22 | this host | index push cadence, the PONS rate move, the clock offset, sections 4 and 7 |
