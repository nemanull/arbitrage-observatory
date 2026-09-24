# KCEX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific time, which is 03:25 to 03:57 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public futures REST calls of KCEX for both perpetual families.
KCEX publishes no API documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
Every call below is one the futures web app at www.kcex.com makes, found in its JavaScript bundle, S1, and measured by [`rest-probe.mjs`](../../../scripts/probes/venues/kcex/rest-probe.mjs).
None of them is a published interface, so any of them can change without notice.
The User Agreement forbids automated access without KCEX's consent, see [`fees.md`](./fees.md) section 1.

## 1. Host and latency from this machine

### What was looked for

| place | result on 2026-09-22 and 2026-09-23 |
|---|---|
| `https://www.kcex.com/api`, `/openapi`, `/api-doc`, `/en-US/api`, `/user/api`, `/apidocs`, `/api-docs` | 404, the site's not-found page |
| `docs.kcex.com` | resolves to `10.192.41.51`, a private address that cannot be reached from the internet |
| `api-docs.kcex.com`, `futures.kcex.com`, `contract.kcex.com` | no address |
| `kcexapi.github.io`, `kcex-api.github.io` | 404 |
| `github.com/kcex` | an unrelated account created 2018-08-09 that links to kcash.io |
| help center search for "API" and "API key" | 8 and 26 results, none about a trading or market data API, S3 |
| `llms.txt`, sitemaps | no API page among 4,458 English sitemap paths, S4 |
| web bundle | "API Management" and "Create up to {max} APIKey" strings for logged-in users, and a sidebar string "API document" with no link target in the futures app, S1 |

### Hosts

| host | resolved to | answers |
|---|---|---|
| `www.kcex.com` | `18.238.238.3`, `.31`, `.44`, `.120`, CloudFront through `d19lksqi18evwf.cloudfront.net` | the web app and every `/fapi/v1` call, POP `SEA900-P5`, origin `openresty` |
| `api.kcex.com` | `3.165.160.48`, `.76`, `.81`, `.89` | 403 from CloudFront on every path tried, section 6 |
| `wbs.kcex.com` | the same four addresses as `www` | the spot socket, not probed |

### Latency

| call | first request | warm |
|---|---|---|
| `GET /fapi/v1/contract/ping` | 96, 113, 96 ms | 36 to 49 ms over five reads per run |
| `GET /fapi/v1/contract/detail`, 1.1 MB | 446, 446, 455 ms | |
| `GET /fapi/v1/contract/ticker`, 456 KB | 466, 440, 457 ms | median 24 ms, max 550 and 556 ms over 60 polls, because the reply is a cached snapshot, section 3 |
| `GET /fapi/v1/contract/funding_rate`, 138 KB | 196, 207 ms | median 119 and 121 ms, max 164 and 249 ms over 12 polls |

A request with no `User-Agent` header is refused with 403, and Node's `fetch` sends its own, so the engine's poller, which sets only `accept` at `server/src/feeds/anchor/AnchorPoller.ts` line 230, got 200 in P1.

## 2. Catalog

### The instruments call

`GET https://www.kcex.com/fapi/v1/contract/detail` returns every contract in one reply of 1.1 MB, P1.

| item | value on 2026-09-23 |
|---|---|
| rows | 846, CoinGecko reports 862 perpetual pairs, [`fees.md`](./fees.md) section 3 |
| `state` | 0 on all 846. Other values were not seen and are Not publicly specified |
| `settleCoin` | USDT 836, USDC 10 |
| `futureType` | 1 on all 846, and `automaticDelivery` 1 on 3 hidden contracts |
| `isHidden` | true on 4: `NET_USDT`, `DN_USDT`, `DMC_USDT`, `ASTEROID_USDT` |
| `apiAllowed` | true on all 846, with no public API to use it |
| `contractSize` | 12 distinct values: 10 on 247 contracts, 1 on 143, 100 on 140, 0.01 on 126, 0.1 on 124, 0.001 on 24, 1000 on 20, 10000 on 7, and 4 rarer values |
| symbol form | `<baseCoin>_<quoteCoin>` on all 846, with no `1000` prefix. `PEPE_USDT` has `contractSize` 100000 instead |
| index basket | `indexOrigin`, a list of source names per contract, section 4 |
| fees | `takerFeeRate` and `makerFeeRate` per contract, [`fees.md`](./fees.md) section 2 |

`GET /fapi/v1/contract/support_currencies` answers `["USDT","USDC"]`.

### How CCXT 4.5.68 maps it

It does not, because CCXT has no KCEX class.
The engine's catalog is CCXT `loadMarkets` at `server/src/ccxt/connector.ts` line 68, so KCEX needs its own catalog read before it can join.
The mapping such a read would use:

| engine field | catalog field | check |
|---|---|---|
| `rawMarketId` | `symbol`, `BTC_USDT` | the same 846 symbols in `detail`, in the bulk `ticker` and in the bulk `funding_rate`, 0 differences on three runs. The socket routes on the same string, [`websocket.md`](./websocket.md) section 3 |
| `base`, `quote` | `baseCoin`, `quoteCoin` | |
| `linear` | true for every row | every contract settles in its quote coin, USDT or USDC |
| `contractSize` | `contractSize` | socket and REST sizes are contracts of this many coins, 27 of 27 exact compares, [`websocket.md`](./websocket.md) section 4 |
| active | `state` 0 and `isHidden` false | |

### Size unit, pairs listed twice, and price scale

Sizes on every book call and on the socket are contracts, and one contract is `contractSize` coins.
Ten bases are listed twice, once per settlement coin: BTC, ETH, SOL, DOGE, PEPE, SUI, XRP, TRUMP, AVAX and ADA.
The quote family treats USDT and USDC as one, so a `marketFilter` would keep the USDT contract, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
No contract is quoted per 10 or per 1000 units, so no price scale is needed.

Against MEXC's catalog read at the same minute, 643 of KCEX's 846 symbols are also MEXC symbols, and the contract size is equal on 367 of those 643, P3.
`ETH_USDT` is 0.001 ETH on KCEX and 0.01 ETH on MEXC.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | freshness |
|---|---|---|---|---|---|---|---|
| `GET /fapi/v1/contract/ticker` | `indexPrice` | `fairPrice` | `fundingRate` | absent | absent | 456 KB, 846 rows | a cached snapshot, see the next subsection |
| `GET /fapi/v1/contract/funding_rate` | absent | absent | `fundingRate` | `collectCycle`, hours | `nextSettleTime`, Unix ms | 138 KB, 846 rows | built per request, `timestamp` 52 to 57 ms old on arrival |
| `GET /fapi/v1/contract/index_price/{symbol}` | `indexPrice` | | | | | 101 bytes, one contract | `timestamp` median 56 and 58 ms old |
| `GET /fapi/v1/contract/fair_price/{symbol}` | | `fairPrice` | | | | 100 bytes, one contract | `timestamp` median 53 and 54 ms old |
| socket `push.tickers` | `indexPrice` | `fairPrice` | absent | absent | absent | 262 to 847 rows per frame, every 2.2 s | the `BTC_USDT` row 0.2 to 3.2 s old on arrival, [`websocket.md`](./websocket.md) section 2 |

No single call is fresh and carries every `AnchorRow` column.

### The ticker snapshot is up to 17 s old

The bulk ticker is served from a cache that is refreshed every 8 to 16 s, P2.
Over two runs of 60 one second polls, the `BTC_USDT` row's `timestamp` took 6 distinct values per run, 8.0 to 16.0 s apart, and each reply arrived 1.6 to 16.7 s after its `timestamp`, median 8.2 and 8.6 s.
`GET /fapi/v1/contract/ticker?symbol=BTC_USDT` returns the same cached row, whose age grew from 1.0 to 10.1 s over six reads 1.7 s apart.
In the same polls the per-contract `index_price` call changed on 23 and 40 of 59 intervals, against 5 in each run for the bulk ticker.

The engine stamps a reading on arrival and refuses one older than 10 s, at `server/src/engine/opportunity/anchorReading.ts` line 5.
A reading from this ticker would be stamped fresh while its prices can be 17 s old, so it cannot be the anchor.

### Row mapping

For a poller that reads the funding bulk call and takes index and mark from a fresher source.

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, `BTC_USDT` | none |
| `index` | `indexPrice` of `push.tickers` or of `index_price` | JSON number | none |
| `mark` | `fairPrice` of `push.tickers` or of `fair_price` | JSON number, never 0 on 846 rows | none |
| `fundingRate` | `fundingRate` of `funding_rate` | JSON number, a fraction per interval: `0.00004` is 0.004 % | none |
| `fundingIntervalHours` | `collectCycle` | integer hours: 8, 4, 1 | none |
| `nextFundingAt` | `nextSettleTime` | Unix ms: `1790150400000` is 2026-09-23 08:00 UTC | none |

At 03:25, 03:39 and 03:52 UTC, the 318 contracts on 8 h read 08:00 UTC and the 528 on 4 h or 1 h read 04:00 UTC.
The ticker's `fundingRate` equalled the funding call's on 846, 844 and 846 of 846 contracts, the misses being the ticker's older snapshot.

## 4. Anchor semantics

### Index

The index article of 2026-08-26 defines the index as a weighted average of spot prices, S2.
Its formula is "Index Price = (Weight Percentage of Exchange A × Spot Price of the Underlying Asset on Exchange A) + …", and it is recomputed every second.
The sources are given as "including but not limited to KCEX, Binance, OKX, Bybit, Bitget, MEXC, and Gate.io".
A source whose data is delayed is removed, and a source more than ±1 % from the median of all sources is removed, a rule that "will not apply when fewer than three exchange prices are available".
KCEX "may update the index components and their weights from time to time", without prior notice.

The basket is public in two places.
The catalog's `indexOrigin` lists the source names per contract.
`GET /fapi/v1/contract/market_price_v2?symbol=BTC_USDT` returns each source's latest price, with `showIndexSymbolWeight` 0 and no weights.

```json
{"symbol":"BTC_USDT","showIndexSymbolWeight":0,"indexPrice":[{"marketName":"BYBIT","marketPrice":"86720.6"},{"marketName":"BINANCE","marketPrice":"86721.06000000"},{"marketName":"MEXC","marketPrice":"86713.91"},{"marketName":"OKX","marketPrice":"86728.7"},{"marketName":"GATEIO","marketPrice":"86727.4"}]}
```

The article says spot, and the wire shows perpetuals.
The catalog names `BINANCE_FUTURE` in 379 baskets, `MEXC_FUTURE` in 74, `OKX_FUTURE` in 49 and `GATEIO_FUTURE` in 2, P1.

| basket shape | contracts |
|---|---:|
| one source, and that source is another venue's perpetual | 239 |
| several sources, at least one of them a perpetual | 260 |
| spot sources only | 347 |

The 239 single-perpetual baskets are the 230 stock and commodity contracts, 192 on `BINANCE_FUTURE` and 38 on `OKX_FUTURE`, and nine crypto contracts: `ONE_USDT`, `H_USDT`, `ESPORTS_USDT`, `SIREN_USDT`, `STAR_USDT`, `RAVE_USDT` and `GUA_USDT` on `BINANCE_FUTURE`, and `BP_USDT` and `APM_USDT` on `MEXC_FUTURE`.
For those, the index is one other venue's perpetual price, so the ±1 % rule cannot apply and the mark follows a perp, not spot.
`ONE_USDT` indexes Binance's ONE perpetual alone, `{"marketName":"BINANCE_FUTURE","marketPrice":"0.00306170"}`, and Binance's own ONE index is that perpetual, see [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
KCEX's own market is in one basket, `ANSEM_USDT`, with `["KCEX","LBANK","MEXC_FUTURE","MEXC"]`.
Basket sizes: 1 source on 239 contracts, 2 on 26, 3 on 82, 4 on 176, 5 on 308, 6 on 15.

### Mark

The mark article of 2026-08-26 gives, S2:

```text
Mark Price = Median(Funding Rate Premium, Mid-Price Basis Fair Price, Latest Traded Price)
Funding Rate Premium = Index × [1 + Latest Funding Rate × (Time Until Next Settlement ÷ Settlement Interval)]
Mid-Price Basis Fair Price = Index + Moving Average[(Best Bid + Best Ask) ÷ 2 − Index]
```

No clamp on the mark is documented.
The catalog's `priceCoefficientVariation` is 0.5 on 827 contracts and 0.02 on 19, and its meaning is Not publicly specified.

| reading | 03:25 UTC | 03:39 UTC | 03:52 UTC |
|---|---|---|---|
| contracts with `fairPrice` equal to `lastPrice` | 266 | 211 | 226 |
| median of the absolute mark premium over the index | 342 ppm | 277 ppm | 276 ppm |
| 90th percentile | 2,387 ppm | 2,051 ppm | 2,060 ppm |
| largest, always `SWARM_USDT` | 35,533 ppm | 34,518 ppm | 39,394 ppm |

The median of three means the mark is the last trade whenever the last trade lies between the other two terms, which held on 25 to 31 % of the catalog.
These readings come from the cached ticker, so each one is up to 17 s old.

### Funding

| item | value | source |
|---|---|---|
| rate formula | Not publicly specified | S2 |
| cap and floor | per contract `maxFundingRate` and `minFundingRate`, ±0.02 on 814 contracts, see [`fees.md`](./fees.md) section 6 | P1 |
| published rate | a running value for the upcoming settlement: `BTC_USDT` published 0.000038 to 0.000041 between 03:25 and 03:42 UTC, while the history call's last settlement, 00:00 UTC, was 0.000009 | P1, P4 |
| settlement times | on the hour, from the history call `GET /fapi/v1/contract/funding_rate/history?symbol=BTC_USDT&page_num=1&page_size=10`, rows `{symbol, fundingRate, settleTime, collectCycle}` | P1 |
| rate across a settlement | not captured. Whether the settled rate equals the last published value is Not verified | |

### How often each number changed

| number | source | changes |
|---|---|---|
| `BTC_USDT` index | bulk ticker, 1 s polls | 5 of 59 intervals in each run |
| `BTC_USDT` index | `index_price` call, 1 s polls | 23 and 40 of 59 |
| `BTC_USDT` mark | `fair_price` call, 1 s polls | 27 and 33 of 59 |
| `BTC_USDT` index | socket `push.index.price` | median gap 852, 713 and 1,397 ms in three runs |
| `BTC_USDT` funding rate | funding call, every fifth second | 0 and 1 change in 60 s |
| index over all contracts | bulk ticker | 34.6 and 38.6 contracts changed per second on average, arriving in bursts at each cache refresh |

## 5. REST book snapshot

`GET https://www.kcex.com/fapi/v1/contract/depth/{symbol}?limit={n}`, P3.

| item | value |
|---|---|
| limits | 5, 20 and 100 are honoured. 1000, or no `limit`, returns the whole book: 805 to 822 bids and 528 to 530 asks on `BTC_USDT` |
| level shape | `[price, size, orderCount]`, JSON numbers, size in contracts |
| order | bids descending, asks ascending, at every limit on both runs |
| reply fields | `asks`, `bids`, `version`, `timestamp` |
| time | 111 to 292 ms |
| caching | none. `x-cache` was a CloudFront miss on every read, and `version` advanced between back-to-back reads. In the 03:31 run one read of six returned a `version` 4 lower than the read before it, so replies can come from backends a few updates apart |

The `version` equals the socket's `push.depth` version, which is how a feed seeds its book, [`websocket.md`](./websocket.md) section 4.

### KCEX against MEXC at the same instant

P3 read KCEX's and MEXC's REST books for `BTC_USDT`, `ETH_USDT`, `DOGE_USDT` and `CHR_USDT` in parallel, three times each per run.
All 20 price levels matched MEXC's on 8 of 12 reads at 03:31 UTC and on 2 of 12 at 03:40 UTC.
No level ever had the same size on both venues, in 24 reads.
KCEX's prices often coincide with MEXC's, and its sizes do not, so these reads neither show nor rule out that KCEX mirrors MEXC.

## 6. Rate limits and errors

| item | value |
|---|---|
| published limit | none, since nothing is published |
| observed | no 429, 403 or `Retry-After` at about three requests a second for 60 s in P2 |
| unknown contract | HTTP 200, `{"success":false,"code":1001,"message":"Contract [NOPE_USDT] not found"}`, on `funding_rate`, `index_price` and `depth` |
| unknown path under `/fapi/v1` | HTTP 404, `{"success":false,"code":404,"message":"Not Found"}` |
| `https://www.kcex.com/api/v1/contract/ping` | HTTP 404, the site's HTML not-found page |
| `https://api.kcex.com/api/v1/contract/ping` and `/fapi/v1/contract/ping` | HTTP 403 from CloudFront, body "403 ERROR The request could not be satisfied. Request blocked." Whether this is a geoblock, a firewall rule, or a retired host is unknown, and it was not worked around |
| no `User-Agent` header | HTTP 403 on REST and on the socket handshake |

## 7. Server time and clock offset

`GET https://www.kcex.com/fapi/v1/contract/ping` answers `{"success":true,"code":0,"data":1790133937905}`, the server time in Unix ms.
The server clock read 5 to 10 ms ahead of this host at the midpoint of the request on 14 of 15 reads, with a round trip of 39 to 46 ms, P1.
The fifteenth read had a round trip of 84 ms and read 28 ms ahead.

## 8. Recommended poller shape

A recommendation for a later design, not a decision, and it depends on KCEX's consent to automated access, see [`fees.md`](./fees.md) section 1.

| item | recommendation | reason |
|---|---|---|
| index and mark | `indexPrice` and `fairPrice` from the socket's `push.tickers`, one subscription for every contract | the only source that covers every contract and is at most a few seconds old. It is a socket, so the REST-only `AnchorPoller` would need a socket-fed variant |
| funding | `GET https://www.kcex.com/fapi/v1/contract/funding_rate` every 1,000 ms | fresh per request, median 119 to 121 ms, carries rate, interval and next settlement |
| do not use | `GET /fapi/v1/contract/ticker` for index or mark | a cached snapshot up to 16.7 s old, section 3 |
| do not use | the per-contract `index_price` and `fair_price` calls at scale | fresh, but 846 contracts would need 1,692 requests a second |
| row mapping | section 3, key `symbol` | |
| skip | `isHidden` true | 4 contracts, 3 of them marked for `automaticDelivery` |
| deny list input | the 239 single-perpetual baskets, and at least `ONE_USDT` | an index that is another venue's perp, section 4 |
| rate limit pause | a pause of 10,000 ms on 403, 418 or 429 | no limit and no `Retry-After` were seen |

The funding reply at one hertz is about 12 GB a day, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | KCEX futures web app, version 3.8.19, page chunk for `/futures/exchange/[symbol]` | https://www.kcex.com/main-static/web-futures/v3.8.19/_next/static/chunks/app/[locale]/futures/exchange/[symbol]/page-74b670118466f89c.js | 2026-09-22 | KCEX, global | every call path, `swapUrl` plus `/fapi/v1`, API strings, sections 1 to 5 |
| S2 | KCEX index price article and mark price article, both dated 2026-08-26 | https://www.kcex.com/support/articles/23961890721561 and https://www.kcex.com/support/articles/29293331155609 | 2026-09-22 | KCEX, global | index formula and protection rules, mark formula, section 4 |
| S3 | Help center search through the Zendesk help center API | https://kcex.zendesk.com/api/v2/help_center/articles/search.json?query=API | 2026-09-22 | KCEX, global | no API article, section 1 |
| S4 | KCEX `llms.txt`, `robots.txt` and sitemaps | https://www.kcex.com/llms.txt | 2026-09-22 | KCEX, global | no API page, section 1 |
| S5 | Funding rate article, dated 2026-08-26 | https://www.kcex.com/support/articles/29293431331865 | 2026-09-22 | KCEX, global | settlement times, section 4 |
| P1 | `rest-probe.mjs catalog`, three runs at 03:25, 03:39 and 03:52 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/kcex/rest-probe.mjs) | 2026-09-22 | this host | DNS, latency, catalog, anchor fields, baskets, history, errors, clock, sections 1 to 7 |
| P2 | `rest-probe.mjs poll`, two runs at 03:27 and 03:39 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kcex/rest-probe.mjs) | 2026-09-22 | this host | ticker cache, change counts, poll times, sections 1, 3 and 4 |
| P3 | `rest-probe.mjs book`, two runs at 03:31 and 03:40 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kcex/rest-probe.mjs) | 2026-09-22 | this host | depth limits, order, caching, MEXC compare, sections 2 and 5 |
| P4 | `ws-probe.mjs book`, three runs at 03:32, 03:41 and 03:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kcex/ws-probe.mjs) | 2026-09-22 | this host | `push.tickers` freshness, funding push, sections 3 and 4 |

The single-symbol ticker reads in section 3 were six curl requests at 03:29 UTC, and are the only figures here that no probe script reproduces.
