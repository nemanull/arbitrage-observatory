# Aivora REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 in Pacific time, which is 2026-09-23 04:14 to 04:45 UTC, from the development host near Seattle.
All traffic left through the laptop's Surfshark WireGuard tunnel, whose exit geolocates to Canada (Cloudflare trace `loc=CA`, `colo=YVR`), so every access result below is what a Canadian address saw.

This profile covers the public futures REST API of Aivora Exchange, which has no CCXT class, for its USDT-M and USDC-M perpetuals.
Every measured number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/aivora/rest-probe.mjs).
Runs are named by their UTC start: `latency` at 04:23 and 04:42, `catalog` at 04:24 and 04:43, `anchor` at 04:24, 04:34 and 04:43, `sweep` at 04:25 and 04:44, `book` at 04:26 and 04:43, `errors` at 04:26 and 04:43.
The documentation, S1, is a Chinese page for a white-label open API, and where it and the wire disagree, both are written.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://openapi.aivora.com/futures/open/fapi/v1`, S1. The old host `api.aivora.com` stopped serving the open API on 2026-03-20 18:00 UTC+8, S1 "更新日志", and `https://api.aivora.com/futures/open/fapi/v1/time` answered 404 from nginx in both `errors` runs |
| DNS | `openapi.aivora.com` is a CNAME into Huawei Cloud CDN, `openapi.aivora.com.9cfb689e.cdnhwcllh11.com`, and resolved to `98.98.253.34`, `98.98.253.82`, `128.14.165.168` and `128.14.165.172` |
| edge | replies carry `Server: CW`, a Huawei WAF cookie `HWWAFSESID`, and `via` headers naming CDN edges in Mexico, `LA-MEX-queretaro-EDGE3` and `LA-MEX-mexicocity-EDGE3` |
| cold request | `GET /time` 1,474 and 1,220 ms |
| warm request | `GET /time` ten times: median 384 and 393 ms, p90 1,280 and 1,476 ms |
| access | every public call in this profile answered 200 from the Canadian exit, with no geoblock, challenge or refusal |

Every futures call pays about 0.4 s of round trip from here.
Single calls took up to 2.4 s in the `anchor` runs, and one book call took 7.5 s, see section 5.

## 2. Catalog

### The instruments call

`GET /contracts` returns every perpetual in one array, S1 "合约列表".

| item | 04:24 | 04:43 |
|---|---|---|
| reply | 83,968 bytes in 1,712 ms | 83,968 bytes in 1,913 ms |
| rows | 241 | 241 |
| `status` 1, "可交易" (tradable) | 77: USDT 72, USDC 5 | the same |
| `status` 0, "不可交易" (not tradable) | 164, all USDT | the same |
| `type` | `E` on all 241, "永续合约" (perpetual) | the same |
| `side` | 1 on all 241, "正向" (linear) | the same |

Each row carries `symbol`, `pricePrecision`, `side`, `multiplier`, `multiplierCoin`, `minOrderVolume`, `minOrderMoney`, `maxMarketVolume`, `maxMarketMoney`, `maxLimitVolume`, `maxLimitMoney`, `maxValidOrder`, `type`, `contractId` and `status`.
`multiplierCoin` equalled the base in `symbol` on all 241 rows.

The 72 tradable USDT-M contracts include 24 TradFi contracts: `E-XAU-USDT`, `E-XAG-USDT`, `E-XPT-USDT`, `E-XPD-USDT`, `E-CL-USDT`, `E-BZ-USDT`, `E-NATGAS-USDT`, `E-SPY-USDT`, `E-QQQ-USDT`, `E-AAPL-USDT`, `E-AMZN-USDT`, `E-COIN-USDT`, `E-CRCL-USDT`, `E-GOOGL-USDT`, `E-HOOD-USDT`, `E-INTC-USDT`, `E-MSFT-USDT`, `E-MSTR-USDT`, `E-MU-USDT`, `E-NVDA-USDT`, `E-PLTR-USDT`, `E-SNDK-USDT`, `E-TSLA-USDT` and `E-TSM-USDT`.

### The web futures list

`POST https://api.aivora.com/futures/api/common/public_info_v2` with body `{}` is the call the web app makes, S3, and it needs no login.
It answered `"code":"0"` with 76,452 bytes in 1,654 and 1,359 ms, and it lists the same 77 tradable contracts with the same `multiplier` on 77 of 77.
It adds what the open API lacks:

| field | meaning | observed |
|---|---|---|
| `subSymbol` | the socket spelling, `e_btcusdt` | `e_` plus lower case base and quote on 77 of 77 |
| `coinResultVo.depthList` | socket depth steps, finest first, `["0.1","1","10","50","100"]` on BTC | the first step equals `10^-symbolPricePrecision` on 77 of 77 |
| `capitalFrequency` | funding interval in hours | 8 on 77 of 77 |
| `nextCapitalSettTime` | next settlement, Unix ms | 1790150400000, 2026-09-23 08:00 UTC, on 76, and 1790164800000, 12:00 UTC, on `E-XAG-USDT` |
| `capitalStartTime` | settlement offset in hours | 0 on 76, 4 on `E-XAG-USDT` |
| `maxLever` | | 10 to 150 |
| `wsUrl` | | `wss://futuresws.aivora.com/kline-api/ws`, which is NXDOMAIN, see [`websocket.md`](./websocket.md) section 1 |

### How a loader would map it

CCXT 4.5.68 has no Aivora class, and neither does the current CCXT master, see [`fees.md`](./fees.md) section 8.
So the engine's catalog, which is `loadMarkets` at `server/src/ccxt/connector.ts` line 68, cannot load this venue, and a loader outside CCXT is needed.

| engine field | source | note |
|---|---|---|
| `rawMarketId` | `symbol`, `E-BTC-USDT` | this is the anchor call's `contractName`. The socket spells the same contract `e_btcusdt` and the socket ticker `E_BTCUSDT`, so the feed needs a map from `subSymbol` to `symbol` |
| `base`, `quote` | the second and third parts of `symbol` | `multiplierCoin` equals the base on every row |
| `linear` | `side` 1 | all rows |
| `contractSize` | `multiplier` | BTC 0.0001, ETH 0.01, SOL 0.1, XAU 0.001, AAPL 0.01, FARTCOIN 1, and the book sizes are in these contracts, see [`websocket.md`](./websocket.md) section 4 |
| active | `status` 1 | 77 rows |

Five pairs are listed twice, once per quote: BTC, ETH, SOL, XRP and DOGE on USDT and USDC.
The quote family treats USD, USDC and USDT as one family, so a `marketFilter` or the family ranking picks one of each pair.
No contract is quoted per 10 or per 1000 units, since every `multiplierCoin` is the plain base.

## 3. Anchor

### The calls

No call returns index, mark and funding for every contract at once.

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /index?contractName=E-BTC-USDT` | `indexPrice` | `tagPrice` | `currentFundRate`, and `nextFundRate` | absent | absent | about 105 bytes, one contract | 240 replies in four contracts at 1 Hz: median 380, 385 and 398 ms, p90 469 to 483 ms, max 1,885, 1,781 and 2,353 ms |
| the same over all 77 tradable contracts, one at a time | | | | | | 77 replies | a round took 29.1 and 32.2 s, median reply 343 and 393 ms, max 1,284 and 1,505 ms |
| `POST public_info_v2`, S3 | | | | `capitalFrequency`, hours | `nextCapitalSettTime`, Unix ms | 76 KB, 77 rows | 1,359 to 1,654 ms |
| `GET /index` without `contractName` | | | | | | `{"code":"-1121","msg":"无效的合约","data":null}` (invalid contract) | |
| `GET /ticker_all`, `/premiumIndex`, `/fundingRate` | | | | | | `-1002` "requires an API key", the same reply as any unknown path such as `/nope` | |

The documentation's reply for `/index` is `{"markPrice", "indexPrice", "lastFundingRate", "contractName", "time"}` on the host `futuersopenapi.aivora.com`, S1.
That host is NXDOMAIN, and the wire at `openapi.aivora.com` answers `{"currentFundRate", "indexPrice", "tagPrice", "nextFundRate"}` with numbers, no contract name and no time.
`GET /ticker?contractName=` answers `{"high","vol","last","low","buy","sell","rose","time"}` and carries no anchor field.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the `contractName` the poller asked for | the reply does not echo it | none |
| `index` | `indexPrice` | JSON number | none |
| `mark` | `tagPrice` | JSON number, never 0 on 77 contracts in either sweep | none, but see section 4 on marks equal to the index or the last trade |
| `fundingRate` | `currentFundRate` | JSON number, a fraction per interval, `-0.00001` | none |
| `fundingIntervalHours` | `capitalFrequency` from the web list | integer hours, 8 | none |
| `nextFundingAt` | `nextCapitalSettTime` from the web list | Unix ms | none |

## 4. Anchor semantics

### Index

The help center the site links, S6, says the index is a weighted mean of spot prices from OKX, Huobi and Binance at 33.3 % each for `BTCUSDT` and `ETHUSDT`, sampled every second.
A source not updated within 40,000 ms is dropped, and a source more than 3 % from the median of all sources is held at the median plus or minus 3 %, S6.
No basket is published for any other contract, and no basket call exists in the open API.
Index values such as `86854.7266666666666667` and `2780.5366666666666667` end in repeating thirds, which fits a mean of three prices, but that reading is an inference.

### Mark

S6 says "Marked Price= Median number (latest price, reasonable price, moving average price)", where the latest price is the median of best bid, best ask and last trade, the reasonable price is the index times one plus the funding basis, and the moving average price is the index plus a 5-minute average of the spread between the venue's median price and the index.
No clamp on the mark is published.

What the wire shows:

| check | 04:34 run | 04:43 run |
|---|---|---|
| `tagPrice` equal to the `/ticker` `last` read in the same second, `E-BTC-USDT` | 29 of 60 polls | 40 of 60 |
| the same, `E-FARTCOIN-USDT` | 48 of 60 | 53 of 60 |
| `tagPrice` between the `/ticker` `buy` and `sell`, BTC and FARTCOIN | 56 and 55 of 60 | 60 and 60 of 60 |
| socket `sign_price` equal to the ticker `close`, BTC | not counted | 56 of 60 frames at 04:38, [`websocket.md`](./websocket.md) P2 |

So the mark is usually Aivora's own last trade or mid, which is the median rule landing on its first term.
A mark that tracks the venue's own touch says little about whether the touch is fair, and the engine's fresh gate reads each leg's premium from the mark and the index.

| check | 04:25 sweep | 04:44 sweep |
|---|---|---|
| `tagPrice` exactly equal to `indexPrice` | 22 of 77 | 21 of 77: 17 equities and ETFs, `E-BZ-USDT`, `E-CL-USDT`, `E-XPD-USDT` and `E-RAVE-USDT` |
| largest mark premium over index | `E-NAORIS-USDT` +7,344 ppm, `E-SOON-USDT` +5,982 ppm | `E-ZEREBRO-USDT` +5,304 ppm, `E-THE-USDT` +3,755 ppm, `E-AVAX-USDT` -3,701 ppm |

The sweeps ran at about 04:25 and 04:44 UTC on a Wednesday, when US equity markets were closed.
A mark pinned to its index reads a zero premium whatever the book does.
That is the blind spot of a capped mark, one of the two shapes that have already produced false rows, see section "What the engine needs from a venue" of [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md).

### Funding

S6 gives the formula as "Funding rate = clamp (average premium index + clamp (composite rate – average premium index, ...), funding rate upper limit, funding rate lower limit)", with a composite rate of 0.01 % per 8 h and a premium index sampled every 5 s, and it publishes no cap numbers.
The wire says the rate comes from somewhere else.
The socket ticker carries `"admin_fund_rate_source":"\"third\""` and a `last_fund_rate_third` field, see [`websocket.md`](./websocket.md) section 6.

| REST `/index` | socket `market_<sub>` ticker | BTC at about 04:38:34 UTC | FARTCOIN at about 04:38:34 UTC |
|---|---|---|---|
| `currentFundRate` | `last_fund_rate_third` | -0.00001 and "-0.00001" | 0.00005 and "0.00005000" |
| `nextFundRate` | `funding_rate_next` | 0.00008 and "0.0000800000000000" | 0.0006450783160691 on both |
| none | `funding_rate_last` | "-0.0000525627429384" | "0.0001000000000000" |

`funding_rate_last` did not change over 60 s in either socket run, so it is probably the last settled rate.
`currentFundRate` changed at most once a minute, and since it equals `last_fund_rate_third`, it reads as the third party's rate that `admin_fund_rate_source` points at.
Which third party is Not publicly specified.
BTC read -0.00001 here while Binance, OKX, Bybit, Gate and HTX published 0.0000173 to 0.0000758 for their own BTC perpetuals in the same minutes, so it matches none of them.
`nextFundRate` read 0.0001, the documented composite rate, on 55 and 53 of 77 contracts, and a moving value elsewhere, such as FARTCOIN at 0.00062 to 0.00070.
The documentation calls the rate field "本期资金费率" (this period's funding rate), S1, which makes `currentFundRate` the best candidate for the rate charged at the next settlement.
That is Not verified, since the settlement instant was not captured and no public funding history call exists.

### How often each number changed

Sixty polls a second apart, counting polls whose value differed from the previous poll.

| contract | field | 04:24 | 04:34 | 04:43 |
|---|---|---:|---:|---:|
| `E-BTC-USDT` | `indexPrice` | 54 | 58 | 50 |
| | `tagPrice` | 49 | 38 | 30 |
| | `currentFundRate` | 1 | 0 | 1 |
| `E-ETH-USDT` | `indexPrice` | 54 | 51 | 48 |
| | `tagPrice` | 50 | 44 | 30 |
| | `currentFundRate` | 1 | 0 | 1 |
| `E-FARTCOIN-USDT` | `indexPrice` | 13 | 1 | 10 |
| | `tagPrice` | 13 | 8 | 11 |
| | `nextFundRate` | 1 | 1 | 1 |
| `E-XAU-USDT` | `indexPrice` | 25 | 36 | 34 |
| | `tagPrice` | 25 | 38 | 35 |
| | `currentFundRate` | 1 | 0 | 1 |

`nextFundRate` never changed on BTC, ETH or XAU.
A liquid index republishes about once a second, and a quiet one can hold for most of a minute.

## 5. REST book snapshot

`GET /depth?contractName=E-BTC-USDT&limit=<n>`, S1 "订单薄".

| item | documented | observed |
|---|---|---|
| depth | `limit` `默认100; 最大100` (default 100, max 100) | 5 levels at `limit=5`, and 30 levels at `limit=30`, `100` and `150`, in both runs |
| reply keys | `time`, `bids`, `asks` | `asks`, `bids`, and `time` always `null` |
| levels | `[price, size]` | `[price, size, cumulative size, cumulative price * size]`, all strings, the same four columns as the socket |
| order | "由最优价格从上倒下排列" (best price first) | bids descending and asks ascending in every reply |
| `limit=0` | | `{"asks":[],"bids":[],"time":null}` |
| delisted contract | | `E-AR-USDT` returned empty `bids` and `asks` |
| caching | | two requests sent together returned different books at 04:26 and identical books at 04:43, so a short edge cache is possible but not shown |
| time | | 314 to 1,217 ms in the 04:43 run, and one request at 04:26 took 7,468 ms |

## 6. Rate limits and errors

| item | documented | observed |
|---|---|---|
| limits | "在每个接口下面会有限频的说明" (each endpoint states its limit), S1, but no futures endpoint states one. Public data is limited per IP, S1 "常见问题" | no limit hit at up to six requests a second |
| over the limit | HTTP 429 is a warning, and HTTP 418 follows if requests continue, S1 | not observed |
| `Retry-After` | not documented | not observed, and no rate limit header on any reply |
| error shape | `{"code": -1121, "msg": "Invalid symbol."}`, S1 | HTTP 200 with `{"code":"-1121","msg":"无效的合约","data":null}`, the code as a string and the message in Chinese |
| unknown contract | | `-1121` on `/index`, `/depth` and `/ticker`, and for `BTCUSDT` without the `E-` form |
| bad parameter | | `limit=abc` gives `-1000` "处理请求时发生未知错误" (unknown error) |
| unknown path | | `-1002` "您无权执行此请求。请求需要发送API Key" (an API key is required), with `"succ":false` |

Every error arrives as HTTP 200, so a poller must read `code` before trusting a reply.

## 7. Server time and clock offset

`GET /time` answers `{"timezone":"协调世界时","serverTime":1790137430984}`, where the time zone reads "Coordinated Universal Time".
The documentation's example says "中国标准时间" (China Standard Time), S1.
Against the midpoint of each warm request, the server was ahead by a median of 35 ms at 04:23 and 31 ms at 04:42, with a round trip near 390 ms, so the offset is known only to within about 195 ms.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
Every poller written so far makes one bulk call per round.
The engine's `AnchorPoller` runs one `fetchRound` per tick and counts a tick as `skipped` while the previous round is still in flight, at `server/src/feeds/anchor/AnchorPoller.ts` lines 89 to 103.
So a fan-out of many calls fits inside one `fetchRound`, and a round slower than the interval shows up as `skipped` rather than as a pile of overlapping rounds.

| item | recommendation | reason |
|---|---|---|
| URL | `GET https://openapi.aivora.com/futures/open/fapi/v1/index?contractName=<symbol>`, one call per tracked contract | no bulk call exists |
| interval and fan-out | a round of up to 77 calls, at most about 10 in flight, every 2,000 ms | a sequential round took 29 to 32 s, so the calls must overlap. Ten in flight is 8 rounds of about 400 ms, and no rate limit is published, so the fan-out is a guess to check in a run |
| second call | `POST public_info_v2` every 60 s for `capitalFrequency` and `nextCapitalSettTime` | the open API has no interval or settlement time. A 60 s refresh leaves `nextFundingAt` up to a minute stale after a settlement |
| alternative | subscribe `market_<sub>` beside the book streams and read `sign_price`, `index_price` and `last_fund_rate_third` | the socket pushes the same numbers about once a second on BTC, but the engine has no socket-fed anchor today, and a quiet ticker went 12 s between frames |
| row mapping | section 3 | |
| skip | contracts with `status` 0 | 164 rows, and their `/index` still answers, such as `E-AR-USDT` |
| treat as markless | a reply whose `tagPrice` equals `indexPrice` | 21 and 22 of 77 contracts, mostly TradFi, section 4 |
| error handling | read `code` on every HTTP 200 and drop the row | errors are HTTP 200, section 6 |
| rate limit pause | `rateLimitPauseMs` 10,000 on 429 or 418 | no window or `Retry-After` is published |

The engine's reader refuses legs read more than 5 s apart and readings older than 10 s, at `server/src/engine/opportunity/anchorReading.ts` lines 4 and 5.
A 2 s round with replies near 400 ms, and a p90 under 500 ms, stays inside both, but a round that meets a 7 s reply would not.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Aivora API documentation, pages 更新日志, 基本信息, 合约交易, 错误码, 常见问题 | https://kaisensei34.gitbook.io/aivora-docs/he-yue-jiao-yi | 2026-09-22 | Aivora, global | base URL, host migration, contracts, depth, ticker, index, time, error and limit rules, sections 1 to 7 |
| S2 | Aivora API doc pointer page, which links S1 | https://www.aivora.com/en-us/cms/apidoc | 2026-09-22 | Aivora, global | that S1 is the official documentation |
| S3 | Aivora web futures list, called with `POST` and body `{}` | https://api.aivora.com/futures/api/common/public_info_v2 | 2026-09-23 UTC | Aivora, global | `subSymbol`, `depthList`, funding interval and next settlement, sections 2 and 3 |
| S6 | Futures help center: Index Price, Mark Price, Funding Rate | https://futuresdoc.gitbook.io/help-center/perpetual/overview/index-price.md | 2026-09-22 | white-label platform, no exchange named | index basket and exception rules, mark formula, funding formula, section 4 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/aivora/rest-probe.mjs) `latency`, `catalog`, `anchor`, `sweep`, `book`, `errors`, first runs at 04:23 to 04:26 UTC and the `anchor` rerun at 04:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/aivora/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | sections 1 to 7 |
| P2 | [`rest-probe.mjs`](../../../scripts/probes/venues/aivora/rest-probe.mjs), all six modes, second runs at 04:42 to 04:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/aivora/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | sections 1 to 7, the second readings |
| P3 | [`ws-probe.mjs`](../../../scripts/probes/venues/aivora/ws-probe.mjs) `book` at 04:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/aivora/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | REST `/index` against the socket ticker at the same moment, section 4 |
| P4 | one-off `curl` of Binance `fapi/v1/premiumIndex`, OKX `public/funding-rate`, Bybit `v5/market/tickers`, Gate `futures/usdt/contracts/BTC_USDT` and HTX `swap_funding_rate` for BTC | not kept as a script | 2026-09-23 UTC 04:15 to 04:36 | this host, Canadian exit | the third-party rate matches none of them, section 4 |
