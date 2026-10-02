# HIBT REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 from 20:15 to 20:51 PDT (2026-09-23 03:15 to 03:51 UTC), from the development host near Seattle.

This profile covers the public perpetual REST API of HIBT at `https://fapi.hibt0.com/open-api`, for the USDT-M perpetuals, the venue's only perpetual family.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/hibt/rest-probe.mjs) unless a source is named.
CCXT has no HIBT class, see [`fees.md`](./fees.md) section 8, so section 2 describes the catalog a loader outside CCXT would read.

## 1. Host and latency from this machine

| host | resolved on 2026-09-22 | reply to this host |
|---|---|---|
| `fapi.hibt0.com` | 172.66.40.123, 172.66.43.133, Cloudflare, `cf-ray` suffix `SEA` | HTTP 200 on every public call |
| `api.hibt0.com` | the same two addresses | HTTP 200 on the spot catalog |
| `api.hibt0.co`, named once in the market maker section of S1 | does not resolve | |
| `hibt.com`, `www.hibt.com` | 172.66.41.10, 172.66.42.246 | HTTP 403 with `cf-mitigated: challenge`, a browser challenge page |
| `support.hibt.com/hc/en-us` | Cloudflare | HTTP 403 with `cf-mitigated: challenge`, while `support.hibt.com/api/v2/help_center/...` answers HTTP 200 |
| `apidoc.hibt.co` | 104.18.40.47, 172.64.147.209, a GitBook site | HTTP 200 |

| call | cold | warm, 10 sequential requests |
|---|---|---|
| `GET /v2/server/time` | 284, 360, 291 and 297 ms in four runs | min 186 to 192, median 199 to 213, p90 212 to 372 ms |

Most perpetual calls answered in 180 to 240 ms warm, see sections 3 and 5.
The edge is in Seattle, so most of that time is the path from Cloudflare to the origin, whose location is not published.

## 2. Catalog

### The instruments calls

| call | reply | rows | what it holds |
|---|---|---|---|
| `GET /v2/market/symbols` | 11.2 KB, 186 to 218 ms | 85 | `symbol`, `supportTrade`, `volumePrecision`, `pricePrecision`, `marketMiniAmount`, `limitMiniAmount` |
| `GET /v2/market/contracts` | 46.8 KB, 191 to 219 ms | 82 | a CoinGecko-style derivatives row: `ticker_id`, `base_currency`, `quote_currency`, prices, volume, open interest, `index_price`, `funding_rate`, `next_funding_rate`, `next_funding_rate_timestamp`, `maker_fee`, `taker_fee`, `contract_price` |
| `GET /v2/market/tickers` | 16.8 KB | 78 | 24 h ticker, missing the four contracts whose `last_price` is `0` |
| `GET /v2/market/contractSpecifications` | 7.3 KB | 82 | `contract_type` (the id), `contract_price`, `contract_price_currency` |

`symbols` lists 82 contracts with `supportTrade` true and 3 with false: `sse_usdt`, `gcei_usdt` and `jets_usdt`.
The three are absent from `contracts`, so `supportTrade` is the status field and `contracts` holds only tradable rows.
Every contract settles in USDT: 82 of 82 rows read `quote_currency` `USDT`, `product_type` `Perpetual` and `contract_type` `Vanilla`, in all four runs.

### How a catalog outside CCXT would map it

| engine field | source | note |
|---|---|---|
| `rawMarketId` | `ticker_id`, for example `btc_usdt` | identical to the `symbols` row, the socket topic prefix and every REST `symbol` parameter. Lowercase only: `BTC_USDT` answers 400 `param error` |
| `base`, `quote` | `base_currency`, `quote_currency`, uppercase | for 76 ids `ticker_id` equals `base_quote` in lowercase, and the six others have no underscore: `gold`, `crude`, `silver`, `lco`, `platinumu`, `chiwheat` |
| `linear` | true | USDT margined |
| `contractSize` | 1 | book, trade and order sizes are base asset units, see [`websocket.md`](./websocket.md) section 4 |
| `active` | `supportTrade` from `symbols` | |
| precision | `pricePrecision`, `volumePrecision` from `symbols` | `btc_usdt` has 1 price decimal, 3 size decimals and a minimum order of `0.008` BTC, `shib_usdt` 9 price decimals, 0 size decimals and a minimum of `50000000` SHIB |

`contract_price` is labelled "Contract Face Value" in S1, but it equalled `last_price` on 78 of 82 rows, and it is empty on the four rows whose `last_price` is `0`.
It is not a face value, and the loader ignores it.

### Pairs listed twice, and names that need a check

HIBT lists no two contracts with the same base.
It does list the same underlying under two bases: `gold` and `xau_usdt`, `silver` and `xag_usdt`, `platinumu` and `xpt_usdt`, `chiwheat` and `wheat_usdt`, and `crude` beside `cl_usdt` and `lco`.
The six ids without an underscore had zero 24 h volume and zero open interest in every run, four of them have `last_price` `0`, and all six hold a one-level book, section 5.
A base such as `GOLD`, `DRAM`, `SPCX` or `O` can name a different token on another venue, so these bases need a `DENIED_PAIRS` check before they cluster, see [`clusterOverrides.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/clusterOverrides.ts).
Small coins are quoted per coin, not per thousand: `shib_usdt` and `pepe_usdt` carry 9 price decimals in `symbols`, and `shib_usdt` arrives in exponent notation (`"6.186e-06"`), so no price scale is needed and `Number()` parses it.

### Volume against open interest

| contract | 24 h volume, USD, four runs | open interest, USD, four runs |
|---|---|---|
| `btc_usdt` | 2.90 to 2.94 billion | 3.84 to 4.08 million |
| `eth_usdt` | 1.74 to 1.78 billion | 0.96 to 1.26 million |
| `sol_usdt` | 763 to 773 million | 1.57 to 1.58 million |
| all 82 | 8.63 to 8.73 billion | 7.56 to 8.14 million |

34 of 82 contracts reported zero open interest in every run.
Among them, `spcx_usdt` reported 109 million USD of 24 h volume, `skhynix_usdt` 69 million, `hk50_usdt` 54 million, `mu_usdt` 50 million and `aave_usdt` 43 million, in the run at 03:49 UTC.
Reported volume runs at more than a thousand times the open interest, and the probe cannot say how much of it is real.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time |
|---|---|---|---|---|---|---|---|
| `GET /v2/market/contracts` | `index_price` | absent | `funding_rate` | absent | `next_funding_rate_timestamp`, Unix ms | 46.8 KB, 82 rows | three runs of 60 polls: min 188 to 191, median 199 to 214, p90 242 to 370, max 376 to 1,159 ms, 1 poll of 180 over 1 s |
| `GET /v2/market/index?symbol=<id>`, documented as "Query Trading Pair Mark Price" | | `marketPrice` | | | | 83 bytes, 1 row | four sweeps of 82 calls: median 192 to 209, max 209 to 368 ms |

The mark call is documented with an optional `symbol`, S1, but without it the server answers HTTP 400 `{"code":210001,"msg":"param error"}` in every run, so the mark needs one call per contract.
That is 82 calls a second at the engine's 1 s cadence, against no published perpetual rate limit, see section 6.

The mark call returns the index.
In two runs of 60 rounds that sent the contracts call and three mark calls at the same instant, `marketPrice` equalled `index_price` exactly on 120 of 120 rounds for each of `btc_usdt`, `eth_usdt` and `unitree_usdt`, P2.
The socket's `btc_usdt.index` price also equalled the REST `index_price` and the REST mark on 8 of 8 compares, see [`websocket.md`](./websocket.md) section 2.
The sequential sweep in P1 found `marketPrice` equal to the catalog's `index_price` on 21 to 29 of 82 contracts, because it read each mark up to about 33 s after the catalog, and the same-instant compare above found no difference.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `ticker_id` | string, `btc_usdt` | none |
| `index` | `index_price` | decimal string, sometimes in exponent form | `Number()` |
| `mark` | `marketPrice` from the per contract call, which equals `index_price` | decimal string | see section 8 |
| `fundingRate` | `funding_rate` | decimal string, a fraction per 8 h: `"-0.0000129"` is -0.00129 % | `Number()` |
| `fundingIntervalHours` | absent | 8 h per S6 and S7 of [`fees.md`](./fees.md) | constant 8 |
| `nextFundingAt` | `next_funding_rate_timestamp` | integer Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

`next_funding_rate` equalled `funding_rate` on 76 of 82 rows in three runs and on 77 in the fourth, so it moves on its own.
Whether it predicts the following interval is Not publicly specified.

## 4. Anchor semantics

### Index

The help center describes the index as "calculated based on the weighted prices from at least three major exchanges, such as Binance, OKX, Coinbase, Bybit, and Huobi", S8 of [`fees.md`](./fees.md), and as "a weighted average price derived from several spot exchanges", S7 there.
No basket, weight or source list is published, and no basket call exists in S1.
The commodity, index and equity contracts name no source, and the liquidation article says quotes come from ICE, S9 of [`fees.md`](./fees.md).
HIBT's own notice says its BTC/USDT market data showed a "temporary price discrepancy due to short-term fluctuations in an external market data source" from 23:37 to 23:43 UTC+8 on 2026-08-11, and that users whose BTC/USDT orders opened and closed in that window at a loss received compensation and bonus worth 200 % of the order amount, S2.

Two reads of Binance's public USD-M premium index, each sent together with the HIBT contracts call, P1:

| read | `btc_usdt` against Binance `BTCUSDT` index | `eth_usdt` | absolute gap over the 59 bases both list | over 1,000 ppm |
|---|---|---|---|---|
| 03:40 UTC | +19 ppm | +9 ppm | median 316, p90 1,116, max 2,731 ppm | 8, mostly equities: `dram`, `rklb`, `slx`, `o`, `skhynix`, `cxmt`, `popmart`, `mu` |
| 03:49 UTC | -116 ppm | -93 ppm | median 250, p90 1,004, max 4,162 ppm | 6: `slx`, `o`, `arb`, `popmart`, `skhynix`, `cxmt` |

Over 40 s on the socket, the HIBT index sat below the Binance spot mid by a median 69 ppm on BTC (-101 to -18) and 48 ppm on ETH (-129 to +40), with a best lag of 0 to 50 ms, P5.

### The book sits on the index

The mid of HIBT's own book is centred on its index.
A bulk book call and a contracts call sent together gave the absolute mid minus index over 82 contracts, P1.

| run | median | p90 | max | within 1 ppm |
|---|---|---|---|---|
| 03:38 UTC | 0 ppm | 297 ppm | 1,166 ppm, `arb_usdt` | not counted |
| 03:40 UTC | 1 ppm | 160 ppm | 577 ppm | 43 of 82 |
| 03:49 UTC | 0 ppm | 90 ppm | 1,130 ppm, `cxmt_usdt` | 57 of 82 |

On the socket, the mid minus the latest index had a median of 0 ppm on `btc_usdt` (-188 to +85), -3 ppm on `eth_usdt` (-328 to +294) and 0 ppm on `gold` (-67 to +60) over 45 s, P4.

Beside Binance over 40 s, the HIBT book tracked Binance spot and not the Binance perpetual, P5.

| contract, run | HIBT mid minus Binance spot mid | HIBT mid minus Binance USD-M mid | best lag behind Binance spot |
|---|---|---|---|
| `btc_usdt`, 03:26 UTC | median -70 ppm, -194 to -36 | median +379 ppm, +236 to +513 | 0 ms |
| `btc_usdt`, 03:42 UTC | median -68 ppm, -331 to +115 | median +433 ppm, +161 to +654 | 1,000 ms, mean gap 72 ppm against 93 at 0 ms |
| `eth_usdt`, 03:26 UTC | median -23 ppm, -193 to +172 | median +428 ppm, +251 to +623 | 1,000 ms, 44 ppm against 50 |
| `eth_usdt`, 03:42 UTC | median -49 ppm, -1,146 to +584 | median +383 ppm, -1,232 to +944 | 1,300 ms, 65 ppm against 150 |

The Binance perpetuals traded about 430 to 500 ppm under Binance spot in both runs, and HIBT did not follow them.
In the busier second run the HIBT book trailed Binance spot by 1 to 1.3 s while the HIBT index kept pace, and the ETH mid strayed up to 1,146 ppm from Binance spot before it caught up.
So a cross between HIBT and a venue whose perpetual trades at a basis is mostly that venue's basis against the HIBT index, and in a fast move it is also the second the HIBT book spends catching up.
No price level of the HIBT book copied a Binance USD-M level: of 7,960 HIBT levels per contract in the second run, 11 BTC and 508 ETH prices also sat in the Binance USD-M depth, none with the same size.

### Mark

The documentation gives two formulas.
S8 of [`fees.md`](./fees.md) says Mark Price = Index Price + Basis Moving Average, where the basis is the mid minus the index over "a specific time period".
S7 there says Mark Price = Index Price + N-minute Moving Average of the mid minus the index, sampled every second.
On the wire the mark equals the index, section 3, which is what either formula gives when the book's mid sits on the index.
No clamp is published.

For the engine this is the capped mark shape at its limit.
`freshPremium` is the touch against the mark, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 84, so with the mark equal to the index every HIBT premium reads as fresh.

### Funding

The documented formula is F = P + clamp(I minus P, a, b) with I = 0.01 % and a and b not published, see [`fees.md`](./fees.md) section 6.
The published rates are flat instead: 53 contracts at `0.0000129`, 17 at `-0.0000129`, 6 at `0` and 6 others, identical in all four runs, P1.

`GET /v2/market/fundingRate?symbol=<id>` returns the current rate sampled every 300 s, newest first, 100 rows by default.
It accepts `startTime`, `endTime` and `limit=1000`, and a window of one day returned 288 rows.
The documentation gives no minimum for `limit`, and `limit=5` answered 400 `param error`.
`gold` returned no rows at all.

| contract | latest 100 rows, two runs | 288 rows of one day, two runs |
|---|---|---|
| `btc_usdt` | `-0.0000129` on 100 and 100 | `-0.0000129` on 288 and 288 |
| `eth_usdt` | `-0.0000129` on 74 and 79, `0.0000129` on 26 and 21 | `-0.0000129` on 100 and 105, `0.0000129` on 188 and 183 |
| `ltc_usdt` | `0.0002609` on 99 and 99, `0.0001899` on 1 and 1 | `0.0002609` on 278 and 278, `0.0003319` on 10 and 10 |

The latest 100 rows ran from 2026-09-22 19:05 to 2026-09-23 03:20 UTC and from 19:30 to 03:45 UTC, and the one-day windows from 2026-09-20 03:25 to 2026-09-21 03:20 UTC and from 03:50 to 03:45 UTC, P3.
No row is marked as settled, so the rate charged at 00:00, 08:00 or 16:00 UTC is Not verified, and the settlement instant itself was not captured.

### How often each number changed

Three runs of 60 polls at 1 s of the contracts call, with three mark calls sent beside each in the second and third, P2.

| contract | `index_price` changes | `marketPrice` changes | `funding_rate` changes | `last_price` changes |
|---|---|---|---|---|
| `btc_usdt` | 42, 35, 42 | 43, 35, 42 | 0 | 46, 40, 40 |
| `eth_usdt` | 46, 41, 36 | 45, 41, 36 | 0 | 45, 42, 45 |
| `unitree_usdt` | 17, 4, 11 | 17, 4, 11 | 0 | 1, 5, 3 |
| `gold` | 43, 49, 48 | not polled | 0 | 44, 50, 48 |
| `crude` | 0 | not polled | 0 | 0 |

Over all 82 contracts, 70, 71 and 69 changed their index at least once in the minute, with medians of 14, 15 and 12 changes, and no funding rate changed.
`next_funding_rate_timestamp` held `1790150400000` on every poll.
The socket's index topic pushes once a second, see [`websocket.md`](./websocket.md) section 2, which matches the REST change rate.
`gold` moved its index and its `last_price` about once a second with zero 24 h volume, so its `last_price` is not a trade price.

## 5. REST book snapshot

| call | documented | on the wire |
|---|---|---|
| `GET /v2/market/depth?symbol=<id>&limit=<n>` | `limit` 5, 10, 20, 50, 100 or 200, S1 | 5 and 20 return that many levels. 100 and 200 return 50. 30 and 500 answer HTTP 200 with `{"code":220017,"msg":"limit error"}` |
| `GET /v2/market/orderBook?symbol=<id>&depth=<n>` | `depth` 1 to 100, `symbol` optional, S1 | 50 levels at most. Without `symbol` it returns every contract, 82 rows at `depth=5` in 21.4 KB and 190 to 218 ms, all rows carrying one `timestamp` in ms |

Bids are descending and asks ascending on both calls.
`gold`, `crude`, `silver`, `lco`, `platinumu` and `chiwheat` hold one level per side.
`crude` read bid 7,583.6 and ask 7,585.2 in all four runs while its sizes changed, and `silver` read 6,624.9 and 6,626.3 in all four.
The REST book and the socket book matched on 18 to 20 of the top 20 BTC bid levels, see [`websocket.md`](./websocket.md) section 4, so the REST book is not cached behind the socket.

## 6. Rate limits and errors

HIBT publishes no rate limit for the perpetual API, S1.
Its spot API documents 100 requests a second for server time and 2 to 20 a second for the other calls, S1.
No reply carried a rate limit, `Retry-After` or remaining-weight header, and the probe never went above about 5 requests a second, so no limit was reached.

| request | status | body |
|---|---|---|
| unknown or uppercase symbol, on `depth`, `index` or `tickers` | 400 | `{"code":210001,"msg":"param error"}` |
| `fundingRate` without `symbol`, or with `limit=5` | 400 | `{"code":210001,"msg":"param error"}` |
| `depth` with `limit=30` or `500` | 200 | `{"code":220017,"msg":"limit error"}` |
| unknown path `/v2/market/nope` | 404 | `{"ErrCode":"ERR_NOT_FOUND","Args":null}` |

The documentation lists code 220017 as "Too many requests", S1, and the server also uses it for a bad `limit` with HTTP 200.
A poller that reads 220017 as a rate limit pauses on a malformed request, and one that reads only the HTTP status misses it.

## 7. Server time and clock offset

`GET /v2/server/time` returns `{"code":0,"msg":"success","data":{"serverTime":1724916869475}}` in the documented example, S1, and the same shape on the wire.
The offset of the server clock from this host, taken at the midpoint of each request, was -2 to 87 ms over 20 reads in four runs, and 18 of the 20 were within 15 ms, P1.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `https://fapi.hibt0.com/open-api/v2/market/contracts` without `symbol` | one call carries index, funding rate and next settlement for all 82 contracts |
| interval | 1,000 ms, the default | median 199 to 214 ms, and the index changes about once a second |
| mark | 0 by default, so routes through HIBT are refused as `anchor_no_mark` | the published mark is the index, section 3, so a mark read from it would pass every HIBT premium as fresh |
| mark, if a design accepts it | `index_price` from the same reply | identical to `marketPrice` on 360 of 360 same-instant reads, and it saves 82 calls a second |
| row mapping | section 3, key `ticker_id`, `fundingIntervalHours` constant 8, `nextFundingAt` as given in ms | |
| skip | `gold`, `crude`, `silver`, `lco`, `platinumu`, `chiwheat` | one-level books, zero volume and zero open interest, and four have `last_price` `0` |
| skip | rows absent from `contracts` or with `supportTrade` false in `symbols` | not tradable |
| error handling | treat HTTP 200 with a non-zero `code` as a failed round | 220017 arrives with HTTP 200 |
| rate limit pause | 10,000 ms, a guess | no limit, status or header is published or was observed |

The bulk reply is about 47 KB, about 4 GB a day at one hertz.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hibt OpenApi Doc: Perpetual Contract Trading and Spot Trading | https://apidoc.hibt.co/hibt-openapi-en/perpetual-contract-trading, full text at https://apidoc.hibt.co/hibt-openapi-en/llms-full.txt | 2026-09-22 | HIBT | base URL, endpoints, parameters, error codes, spot rate limits, sections 1 to 7 |
| S2 | Hibt Notice on the Temporary BTC/USDT Price Discrepancy and User Compensation, 2026-08-12 | https://support.hibt.com/hc/en-us/articles/17184393619343 | 2026-09-22 | HIBT | external market data source, section 4 |
| P1 | `rest-probe.mjs main`, four runs at 03:21, 03:38, 03:40 and 03:49 UTC on 2026-09-23, the last two with the Binance index compare | [`rest-probe.mjs`](../../../scripts/probes/venues/hibt/rest-probe.mjs) | 2026-09-22 | this host, and Binance's public premium index | sections 1 to 7 |
| P2 | `rest-probe.mjs poll`, three runs at 03:22, 03:31 and 03:48 UTC, the last two with the same-instant mark compare | [`rest-probe.mjs`](../../../scripts/probes/venues/hibt/rest-probe.mjs) | 2026-09-22 | this host | sections 3, 4 |
| P3 | `rest-probe.mjs funding`, two runs at 03:22 and 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hibt/rest-probe.mjs) | 2026-09-22 | this host | section 4 |
| P4 | `ws-probe.mjs book`, second run at 03:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hibt/ws-probe.mjs) | 2026-09-22 | this host | section 4 |
| P5 | `ws-probe.mjs mirror`, runs at 03:26 and 03:42 UTC, HIBT beside Binance spot and USD-M public book streams, the second with the HIBT index | [`ws-probe.mjs`](../../../scripts/probes/venues/hibt/ws-probe.mjs) | 2026-09-22 | this host, Binance public streams | section 4 |
