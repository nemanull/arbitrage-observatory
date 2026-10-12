# Blockfinex REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 02:19 to 02:49 UTC on 2026-10-10, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.

This profile covers the public futures REST API of Blockfinex at `https://futuresopenapi.blockfinex.com/fapi/v1`, for its USDT-M linear perpetuals.
Blockfinex runs ChainUp's `fapi/v1` open API, whose generic document is S1, linked from the Blockfinex homepage with the host written as `futuresopenapi.xxx.xx`.
Three calls used below come from the futures web app rather than S1, `/v1/inner/contract_config`, `POST /fe-co-api/common/public_info` and `POST /fe-co-api/common/funding_rate_list`, and each answered without a login.
Every number below comes from [`rest-probe.py`](../../../scripts/probes/venues/blockfinex/rest-probe.py), run once in the first pass and once more in the second pass, unless a source is named.

## 1. Host and latency from this machine

| host | resolved | role |
|---|---|---|
| `futuresopenapi.blockfinex.com` | 35.78.139.104 and 52.195.57.47, CNAME `cloong-alb-internet-h5-v6-1615804683.ap-northeast-1.elb.amazonaws.com` | the open API and `/v1/inner/contract_config` |
| `futures.blockfinex.com` | the same load balancer | the futures web page and its `/fe-co-api/` |
| `futuresws.blockfinex.com`, `ws.blockfinex.com` | the same two addresses | sockets, see [`websocket.md`](./websocket.md) |
| `www.blockfinex.com` | CNAME `cloong-alb-internet-v7-home-1543493242.ap-northeast-1.elb.amazonaws.com` | the homepage |

Every reply carried `Server: webserver`.
The load balancer sits in AWS Tokyo, and the server's `/fapi/v1/time` names its zone `GMT+08:00`.

| call | cold, three new connections | warm, ten calls on one connection |
|---|---|---|
| `GET /fapi/v1/time` | 439 to 486 ms, then 411 to 433 ms | min 144, median 160, max 384 ms, then 144, 147 and 205 ms |
| `GET /fapi/v1/index?contractName=E-BTC-USDT` | 416 to 467 ms, then 411 to 662 ms | min 143, median 183, max 304 ms, then 150, 167 and 185 ms |
| `GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=100` | 394 to 712 ms, then 465 to 651 ms | min 145, median 207, max 379 ms, then 142, 162 and 595 ms |

## 2. Catalog

### The instruments call

`GET /fapi/v1/contracts`, public, S1, returned 41,308 bytes in 933 ms with 82 rows.

```json
{"symbol": "E-BTC-USDT", "pricePrecision": 1, "side": 1, "maxMarketVolume": 5000000, "multiplier": 0.0001, "maxLever": 150, "minOrderVolume": 1, "maxMarketMoney": 5000000.0, "marginCoin": "USDT", "openMakerFee": 0.00025, "type": "E", "closeMakerFee": 0.00025, "closeTakerFee": 0.0008, "maxLimitVolume": 10000000, "maxValidOrder": 20, "multiplierCoin": "BTC", "openTakerFee": 0.0008, "minOrderMoney": 11.001, "maxLimitMoney": 20000000.0, "contractId": 1, "minLever": 0, "status": 1}
```

| group | rows |
|---|---|
| `type` E, `side` 1, `status` 1, margin and quote USDT | 74, the researched family |
| `type` E, `side` 1, `status` 0 | 2, `E-TON-USDT` and `E-PAXG-USDT` |
| `type` E, `side` 0, inverse, margined in the base, quote USD | 5, `E-BTC-USD`, `E-ETH-USD`, `E-SOL1-USD`, `E-DOGE-USD`, `E-LTC-USD` |
| `type` S, margined in `EXUSD` | 1, `S-BTC-USDT`, a test contract in S1's terms |

S1 documents `type` E as perpetual and S as test, `side` 1 as linear, and `status` 1 as tradable.
`multiplierCoin` equals the base on 74 of 74 trading USDT contracts, and no base is listed twice.
Base and quote are not fields, so they come from splitting `symbol` on `-`.

### The schedule calls

| call | reply | what it adds |
|---|---|---|
| `GET https://futuresopenapi.blockfinex.com/v1/inner/contract_config` | `{"code":"0","msg":"Success","data":{"contractList":[…]}}`, 80 rows, 944 ms | `capitalFrequency` in hours, `capitalPremiumMin` and `capitalPremiumMax`, `status`, and no next settlement field |
| `POST https://futures.blockfinex.com/fe-co-api/common/public_info` with a body such as `{"uaTime":"2026-10-09 19:34:00"}` and header `futures-version: 101` | `code` "0", 80 rows, 872 ms, 123,699 bytes | `subSymbol`, `capitalFrequency`, `nextCapitalSettTime` in ms, `capitalIntervalMin` and `capitalIntervalMax`, `feeRateVo`, `assetClass`, and `wsUrl` |

The website's call refuses an empty body.
`POST public_info` with `{}` answered HTTP 200 `{"code":"200004","msg":"parameter illegal","data":null,"msgData":null,"succ":false}` in both passes.
The web bundle adds `uaTime`, a local wall clock string, to every body it posts, and the call answered once that field was present, S2.

Both lists hold the 74 trading USDT contracts, and `subSymbol` equals the socket name rule on 80 of 80 rows.
At 02:35 UTC the intervals were 8 h on 63 contracts, 4 h on 10 and 1 h on `E-LAB-USDT`, and the next settlements 08:00, 04:00 and 03:00 UTC.

### How the engine's `chainup` loader would map it

CCXT has no Blockfinex class, see [`fees.md`](./fees.md) section 8.
The engine's `chainup` members load their catalog from `/fapi/v1/contracts` and keep a row when `type` is E, `side` 1, `status` 1, the quote is a profile quote, the margin coin equals the quote, `multiplierCoin` equals the base, and the schedule call lists the contract, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 56 to 115.

| item | Blockfinex |
|---|---|
| kept with quotes `["USDT"]` | 74 of 82 rows |
| raw market id | `e_btcusdt`, the socket spelling and the website's `subSymbol`, from `socket_name` at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 131 to 139 |
| REST name | `E-BTC-USDT`, which `/index`, `/depth` and `/ticker` take. `e_btcusdt` there answers `-1121 BAD_SYMBOL` |
| contract size | `multiplier`, from 0.0001 on BTC to 500 on PEPE, the unit the books count, see the next subsection |
| linear | true on all 74 |
| taker | `openTakerFee` of each row, 750 to 1,000 ppm, see [`fees.md`](./fees.md) section 2 |
| `Schedule::ContractConfig` | answers in the shape the loader reads, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 158 to 187, with no next settlement |
| `Schedule::PublicInfo` | as written it posts `{}`, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) line 160, which Blockfinex refuses with code 200004 |

### Size unit, pairs listed twice, and price scale

Book sizes on the socket and in REST are contracts of `multiplier` coins, and the two agreed level for level, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice.

`E-SHIB-USDT` and `E-PEPE-USDT` name the plain coin but quote 1,000 of it.
In the first pass SHIB's best bid read 0.005487 and its index 0.005495, against a mark of 0.005492 and an index of 0.005496 on Binance's `1000SHIBUSDT`, P4.
Read as price times size times `multiplier`, the top ten bid levels held 1,158 to 4,921 USDT on SHIB and 1,868 to 20,027 USDT on PEPE over both passes, against 4,843 to 146,157 on DOGE and 33 to 6,404 on TRX, P4.
Single tokens would make those SHIB and PEPE levels a thousand times smaller, so `multiplier` counts bundles of 1,000 tokens and the two contracts need a price scale of 0.001, as Koinbay's identical pair has at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 161.

The website lists 14 equity and pre-IPO contracts, 3 metals and 2 energy contracts among the 74, see [`fees.md`](./fees.md) section 3.
Probed on a Saturday in UTC, XAU's index changed once in 60 s in each pass while its mark moved 41 and 45 times and sat 2,256 to 2,307 ppm above the index.

## 3. Anchor

### The calls

There is no bulk call.
`GET /fapi/v1/index?contractName=E-BTC-USDT` answers for one contract, S1, with fields that differ from S1's example.
The reply below is a one-off read at 02:20 UTC, P5.

```json
{"currentFundRate": 0.0000320000000000, "tagPrice": 82630.2, "indexPrice": 82670.31666666666207740, "nextFundRate": 0.000032}
```

S1 documents `markPrice`, `indexPrice`, `lastFundingRate`, `contractName` and `time`, and the wire carries `tagPrice`, `indexPrice`, `currentFundRate` and `nextFundRate`, with no contract name and no time.
Without `contractName`, or with the socket spelling, the call answers HTTP 200 `{"code":"-1121","msg":"BAD_SYMBOL","data":null}`.

| round over the 74 trading USDT contracts, 8 in flight | first pass | second pass |
|---|---|---|
| wall time | 4,649 ms | 4,627 ms |
| per call, min, median, max | 404, 452, 914 ms | 394, 451, 767 ms |
| errors | 0 | 0 |
| `currentFundRate` equal to `nextFundRate` | 72 of 74 | 72 of 74 |

The same five fields arrive on the socket's `mark_price_<sym>` channel, with `nextSettlementTime` added, see [`websocket.md`](./websocket.md) section 4.

### Row mapping

| `AnchorRow` column | REST `/index` | socket `mark_price` | conversion |
|---|---|---|---|
| key | the `contractName` of the request | `symbol`, `e_btcusdt` | none |
| `index` | `indexPrice`, JSON number | `indexPrice`, string | none |
| `mark` | `tagPrice`, JSON number | `tagPrice`, string | none |
| `fundingRate` | `currentFundRate` or `nextFundRate`, see section 4 | the same two, strings | none, a fraction per interval |
| `fundingIntervalHours` | absent | absent | `capitalFrequency` of either schedule call |
| `nextFundingAt` | absent | `nextSettlementTime`, ms as a string | from the socket, or `nextCapitalSettTime` of `public_info` |

### Other calls tried

| call | answer |
|---|---|
| `fundingRate`, `premiumIndex`, `nope` under `/fapi/v1/`, and `/nope` at the root | HTTP 200, `{"code":"-1002","data":null,"msg":"UNAUTHORIZED","msgData":null,"succ":false}` |
| `GET /fapi/v1/ticker_all`, documented | every contract's `last`, `high`, `low`, `vol`, `rose` and `time`, keyed by socket name. No index, mark or funding |
| `POST /fe-co-api/common/funding_rate_list` with `{"contractId":1,"page":1,"limit":10,"uaTime":…}` | the settled history, see section 4 |

An unknown path and a path that needs a key give the same `-1002` reply.

## 4. Anchor semantics

### Index

The formula and basket are Not publicly specified, and the web bundle names an `index_price_weight_list` call that was not probed.
BTC's index carries eleven or more decimals, such as 82667.28333333332874430, which suggests a mean of several prices.
Beside Binance USD-M's `premiumIndex` read in the same second, the index sat −55, +38, +47 and −196 ppm from Binance's on BTC, ETH, SOL and SHIB in the first pass, and +10, +118, +34 and +29 ppm in the second, P4.

### Mark

The mark is `tagPrice`, and its formula is Not publicly specified.
On BTC it is often off the price tick, such as 82620.04411700333, and over 60 polls it equalled the ticker's `last` on 24, lay inside the touch on 47, and never equalled the bid or the ask, in the first pass, and 49, 51 and 0 times in the second.
Beside Binance's mark read in the same second, it sat 0, −4, −54 and +68 ppm away on BTC, ETH, SOL and SHIB in the first pass, and +11, +79, +37 and −87 ppm in the second, P4.
BTC's mark equalled Binance's `82593.60000000` exactly at 02:35:30 UTC.
The median gap of mark to index over the 74 contracts was −451 ppm, from −2,342 ppm on VVV to +2,307 ppm on XAU, in the first round, and −482 ppm, from −3,371 ppm on VVV to +2,256 ppm on XAU, in the second.

### Funding

`currentFundRate` and `nextFundRate` are equal on most contracts and differ on a few.
Which one is charged at the next settlement is Not verified, because no settlement was captured.

| comparison, `funding` mode, 74 contracts | first pass | second pass |
|---|---|---|
| `currentFundRate` equal to the last settled rate | 57 | 57 |
| `nextFundRate` equal to the last settled rate | 56 | 56 |
| the two equal to each other | 72 | 72 |

Most matches are contracts that sit at 0.0001, such as ENJ and SHIB.
On ETH, `currentFundRate` carried many decimals and moved twice in 60 polls, from 0.0000204866666667 to 0.00002008875, while `nextFundRate` stayed at 0.000034, in the first pass, which looks like a running average beside a rounded estimate.
`E-LAB-USDT` settles hourly, and its history listed 0.0000125 at 00:00, 01:00 and 02:00 UTC, which its `currentFundRate` equalled while `nextFundRate` read 0.000012.
That is the pattern the Koinbay profile records, and it makes `currentFundRate` the better candidate, as the engine's Koinbay profile reads it.

The history call returned BTC settlements every 8 h at 00:00, 08:00 and 16:00 UTC, with a `count` of 21 and a `brokenLineList` of 21 points.
The cap and floor of each contract's rate are `capitalIntervalMin` and `capitalIntervalMax`, see [`fees.md`](./fees.md) section 6.

### How often each number changed

Sixty one second polls of `/index` on five contracts, with the BTC ticker read in the same second.

| contract | `indexPrice` changes | `tagPrice` changes | `currentFundRate` changes | `nextFundRate` changes | largest index step | largest mark step | mark against index |
|---|---|---|---|---|---|---|---|
| `E-BTC-USDT` | 15, then 9 | 36, then 11 | 0, then 0 | 0, then 0 | 110 ppm | 97 ppm | −498 to −327 ppm |
| `E-ETH-USDT` | 11, then 2 | 39, then 48 | 2, then 2 | 0, then 1 | 74 ppm | 88 ppm | −517 to −355 ppm |
| `E-ENJ-USDT` | 14, then 15 | 19, then 48 | 0 | 0 | 860 ppm | 363 ppm | −1,162 to +67 ppm |
| `E-XAU-USDT` | 1, then 1 | 41, then 45 | 2 | 2 | 2 ppm | 10 ppm | +2,297 to +2,307 ppm |
| `E-SHIB-USDT` | 7, then 9 | 16, then 24 | 0 | 0 | 520 ppm | 245 ppm | −576 to +67 ppm |

The steps and ranges are the first pass.
In the second pass ENJ's index moved 5,980 ppm and its mark 3,589 ppm in one poll, past the engine's 1,000 ppm move guard at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) line 6, so a thin contract like ENJ will meet that guard.

## 5. REST book snapshot

`GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=100`, documented as default 100 and max 100, S1.

| item | seen |
|---|---|
| levels | `limit` 5 and 30 cut to that many. 100, 200 and none returned 100 per side |
| order | bids descending and asks ascending on every read |
| numbers | JSON numbers, sizes in contracts |
| `time` | `null` on every read, although S1 documents a ms timestamp |
| against the socket | the top three levels equalled the socket's last BTC frame on both sides, in both passes, see [`websocket.md`](./websocket.md) section 4 |
| repeats | 10 reads of ENJ 0.5 s apart returned 2 distinct books in the first pass and 4 in the second |
| against Binance | 1 to 3 of the top 20 bid prices of BTC and ETH were shared with Binance's book over six paired reads in each pass, with no size equal, so the book is not a copy of Binance's. Its touch sat within about 1 USDT of Binance's on BTC |

## 6. Rate limits and errors

S1 publishes no limit for the public futures calls, and names "20 times/ 2 seconds" only on order cancel.
No reply carried a rate limit header or a `Retry-After`.
The probes kept at most eight requests in flight and were never refused.

| request | HTTP | body |
|---|---|---|
| unknown contract on `/index`, `/depth` or `/ticker`, missing `contractName`, or the socket spelling | 200 | `{"code":"-1121","msg":"BAD_SYMBOL","data":null}` |
| unknown path, or a path that needs a key | 200 | `{"code":"-1002","data":null,"msg":"UNAUTHORIZED","msgData":null,"succ":false}` |
| unknown path under `futures.blockfinex.com/fe-co-api/` | 404 | `{"timestamp":"2026-10-10T02:35:11.621+00:00","status":404,"error":"Not Found","message":"No message available","path":"/common/nope"}` |
| `public_info` with an empty body | 200 | `{"code":"200004","msg":"parameter illegal",…}` |

Errors arrive as HTTP 200, so a poller reads `code` in the body.

## 7. Server time and clock offset

`GET /fapi/v1/time` returns `{"timezone":"GMT+08:00","serverTime":1791599757979}`, and `GET /fapi/v1/ping` returns `{}`.
On one kept-alive connection, the three samples with the shortest round trips, 140 to 141 ms, put the server 2.0 to 3.1 ms ahead of this host's clock, in the second pass.
The first pass timed each sample on a new connection, which puts the handshake inside the round trip, so its figure is not used.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

Two shapes fit the engine's `chainup` module, and each needs one change beyond a new profile constant.

| item | socket anchored, Koinbay's shape | REST swept, FameEX's shape |
|---|---|---|
| anchor source | `AnchorSource::MarkPrice`, the `mark_price_<sym>` channel | `AnchorSource::Rest`, one `/index` call per contract |
| schedule | `Schedule::ContractConfig("https://futuresopenapi.blockfinex.com/v1/inner/contract_config")`, since the socket frame carries the next settlement | `Schedule::PublicInfo("https://futures.blockfinex.com/fe-co-api/common/public_info")`, since `/index` carries no next settlement |
| change needed | a guard that reopens a socket whose mark frames stop while its books keep flowing, see [`websocket.md`](./websocket.md) section 4 | a `uaTime` field in the schedule POST body, since `{}` answers 200004 |
| round cost | no request but the schedule's | 74 calls, 4.6 s at 8 in flight in the first pass. The module's 24 in flight was not tried |
| funding field | `FundingField::Current`, section 4 | the same |
| price scales | `("e_shibusdt", 0.001)` and `("e_pepeusdt", 0.001)` | the same |

The engine refuses an anchor older than 10 s, at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) line 5, so a socket whose mark stream stops leaves every market on it without an anchor until the socket reopens.
Errors arrive under HTTP 200 with a `code`, which `read_index` already treats as a failure, at [`anchor.rs`](../../../server/src/venues/chainup/anchor.rs) lines 236 to 243.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ChainUp Open API v2, Futures, Errors and FAQ pages, linked from the Blockfinex homepage | https://exchangedocsv2.gitbook.io/open-api-doc-v2/futures | 2026-10-10 UTC | ChainUp platform | calls, fields, type and side values, limits, sections 2 to 6 |
| S2 | Blockfinex futures web bundle `chunk-common.17813666.js` | https://futures.blockfinex.com/futures/js/chunk-common.17813666.js | 2026-10-10 UTC | Blockfinex | `fe-co-api` paths, the `uaTime` body field and the `futures-version` header, section 2 |
| P1 | `rest-probe.py catalog`, `errors`, `depth` and `latency`, first pass 02:35 to 02:36 UTC | [`rest-probe.py`](../../../scripts/probes/venues/blockfinex/rest-probe.py) | 2026-10-10 UTC | this host | sections 1, 2, 5, 6 and 7 |
| P2 | `rest-probe.py anchor` and `funding`, first pass 02:36 to 02:39 UTC | [`rest-probe.py`](../../../scripts/probes/venues/blockfinex/rest-probe.py) | 2026-10-10 UTC | this host | sections 3 and 4 |
| P3 | `rest-probe.py all`, second pass, 02:45 to 02:48 UTC | [`rest-probe.py`](../../../scripts/probes/venues/blockfinex/rest-probe.py) | 2026-10-10 UTC | this host | sections 1 to 7, the second readings |
| P4 | `rest-probe.py outside` and `depth`, both passes, with Binance USD-M `premiumIndex` and `depth` | https://fapi.binance.com/fapi/v1/premiumIndex | 2026-10-10 UTC | Binance | sections 2, 4 and 5 |
| P5 | one-off `curl` reads of `/fapi/v1/index` for BTC, `/fapi/v1/ticker_all`, `/fapi/v1/ping` and `public_info` with an empty body, 02:19 to 02:21 UTC | | 2026-10-10 UTC | this host | sections 2, 3 and 7 |
