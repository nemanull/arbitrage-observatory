# OmniX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 06:36 to 06:59 UTC), from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public futures REST API of OmniX, the rebranded CoinChief, which has no CCXT class, see [`fees.md`](./fees.md) section 8.
Every claim below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) unless a source id says otherwise.
Source ids are shared with [`fees.md`](./fees.md) and [`websocket.md`](./websocket.md).
The short answer is that the catalog and the book are live, while the index and the mark that the anchor needs are frozen on most contracts, see section 4.

## 1. Host and latency from this machine

### Where the API lives

OmniX publishes no API of its own.
The site `www.omnix.vin` is a static page on Cloudflare, and its `POST /fe-ex-api/common/public_info` answers with the ChainUP exchange config of "Coin Chief", whose `base_url` is `https://www.coinchief.live`, S4.
The CoinChief web front links its own API documents, `https://www.coinchief.live/openapi/open-api-en.html` and `https://www.coinchief.live/CMC-api/`, S5 and S6.
They follow the ChainUP pattern, `futuresopenapi.<domain>` for futures REST and `futuresws.<domain>` for the futures socket, S7 and S8.

### Access, from the Canadian VPN exit

| request | status | reply |
|---|---|---|
| `GET https://www.omnix.vin/` | 200 | 1,312 bytes of static HTML, `cf-ray` edge `YVR` |
| `POST https://www.omnix.vin/fe-ex-api/common/public_info` | 200 | 65,589 bytes, the Coin Chief config, in 4,374 and 5,126 ms |
| `POST https://www.omnix.vin/fe-co-api/common/public_info` | 405 | nginx `405 Not Allowed` |
| `GET https://openapi.omnix.vin/sapi/v1/ping` | 404 | nginx `404 Not Found`, the name resolves by a Cloudflare wildcard, edge `SEA` then `YVR` |
| `GET https://futuresopenapi.omnix.vin/fapi/v1/ping` | 404 | nginx `404 Not Found` |
| `GET https://futuresopenapi.coinchief.live/fapi/v1/ping` | 200 | `{}` |
| `GET https://futuresopenapi.coinchief.work/fapi/v1/ping` | 200 | `{}`, the host the CMC-api page names, S6 |
| `GET https://openapi.coinchief.live/sapi/v1/ping` | 200 | `{}`, spot |
| `POST https://www.coinchief.live/fe-co-api/common/public_info` | 200 | 38,267 bytes, the web contract list, in 677 to 879 ms |
| `wss://futuresws.coinchief.live/kline-api/ws` | 101 | open in 274 to 304 ms, see [`websocket.md`](./websocket.md) section 1 |

Nothing was refused, and no reply carried a region message.
Who may trade is Not publicly specified, see [`fees.md`](./fees.md) section 1.

### Resolution and time

| host | resolved on 2026-09-23 | note |
|---|---|---|
| `futuresopenapi.coinchief.live` | CNAME `all.coinchief.live.a1.initac.com`, `155.102.56.26` by `dig` at 06:27 UTC, then `155.102.56.52` and `155.102.56.51` in the two probe runs | `Server: ESA`, Alibaba Cloud's edge |
| `futuresws.coinchief.live` | the same CNAME and address | |
| `futuresopenapi.coinchief.work` | `alb-glh6z0cpj6a830klhl.ap-southeast-1.alb.aliyuncsslbintl.com`, `139.95.10.147` and `139.95.11.74` | an Alibaba load balancer in Singapore |
| `www.omnix.vin` | `104.21.44.135`, `172.67.200.147` | Cloudflare, and every subdomain tried resolves the same way |

The `via` header of each `coinchief.live` reply names the Alibaba cache nodes `us30`, `l2jp2`, `l2hk12` and `l2sg7`, with `x-site-cache-status: DYNAMIC`.
That reads as an edge in the United States relaying to an origin in Singapore, which is an inference from the node names.

| call | first request | warm requests |
|---|---|---|
| `GET /fapi/v1/time` | 355 and 501 ms | 233 to 472 ms over ten reads |
| `GET /fapi/v1/index`, one contract | | 59 polls per contract in each of three runs: min 217, median 293 to 341, max 1,439 ms |
| `GET /cmc/specifications` | | 12 polls per run over three runs: min 551, median 652 to 660, max 990 ms |

## 2. Catalog

### The instruments call

`GET https://futuresopenapi.coinchief.live/fapi/v1/contracts` returned 45 rows in 15,397 bytes, in 519 and 479 ms.

| field | values on 2026-09-23 | meaning, S7 |
|---|---|---|
| `symbol` | `E-BTC-USDT` and 44 more | "Uppercase contract name" |
| `status` | 1 on all 45 | "0: not tradable, 1: tradable" |
| `type` | `E` on all 45 | "E: Perpetual contract, S: Simulated contract, others are mixed contracts" |
| `side` | 1 on all 45 | "0: reverse, 1: forward" |
| `multiplier` | 1 on 18, 0.1 on 9, 0.01 on 7, 10 on 6, 100 on 3, 0.0001 on 2 | "Contract value" |
| `multiplierCoin` | the base coin | |

So the venue lists one family, 45 linear USDT perpetuals.
The web front's `POST /fe-co-api/common/public_info` lists 43, without `E-MATIC-USDT` and `E-YFI-USDT`.
Those two had a book of one bid and one ask and an index of 0 and 2,176 respectively, see sections 4 and 5, so a catalog should take the web list or drop them.
The web list adds `capitalFrequency` 8, `settlementFrequency` 1, `maxLever` from 20 to 300, and three more spellings of each contract.

### Symbol spellings

| where | BTC contract |
|---|---|
| REST `contracts`, `index`, `depth`, `ticker` | `E-BTC-USDT`, and `depth` also accepts `e-btc-usdt` |
| web list `subSymbol`, and the socket channel | `e_btcusdt`, inside `market_e_btcusdt_depth_step0` |
| web list `symbol`, and the CMC feed `ticker_id` | `BTC-USDT` |
| web list `contractOtherName` | `BTCUSDT` |

`GET /fapi/v1/depth?contractName=BTC-USDT` answers `-1121`, so only the `E-` form works on REST.
A feed would key the book on `E-BTC-USDT` and build the channel name from it, see [`websocket.md`](./websocket.md) section 8.

### How CCXT maps it

It does not.
No CCXT class exists, so the engine's catalog path, `loadMarkets` at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68, has nothing to call.
A custom catalog would set `rawMarketId` to `symbol`, `base` to `multiplierCoin`, `quote` to `USDT`, `linear` to true, and `contractSize` to `multiplier`.

### Size unit, pairs listed twice, and price scale

Book sizes on REST and on the socket are whole numbers of contracts, and one contract is `multiplier` coins.
That reading is an inference, since no document states the unit.
The BTC touch read 1,527,788 on both REST and the socket at the same moment, see [`websocket.md`](./websocket.md) section 4.
As contracts of 0.0001 BTC that is 152.8 BTC, and as coins it would be 1.5 million BTC, which is not possible.
No base is listed twice, so no `marketFilter` is needed.
No contract is quoted per 10 or per 1000 units, so no price scale is needed.

The BTC best bid on REST was 4,723,093 contracts in the first book run, 472 BTC or about 41 million USDT at one price level, and 134,158 contracts in the rerun.
The CMC feed reported BTC `base_volume` 3,426,279 against `quote_volume` 295,248,780,498.8, which is volume times price with no multiplier applied, S6.
Both numbers are what the venue publishes, and neither was verified further.

## 3. Anchor

### The calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /fapi/v1/index?contractName=E-BTC-USDT` | `indexPrice` | `tagPrice` | `currentFundRate` and `nextFundRate` | absent | absent | about 140 bytes, one contract | median 293 to 341 ms |
| `GET /cmc/specifications` | `index_price` | absent | `funding_rate` | absent | `next_funding_rate_timestamp`, Unix ms | 24,928 to 24,936 bytes, 45 rows | median 652 to 660 ms |
| `POST https://www.coinchief.live/fe-co-api/common/public_info` | absent | absent | absent | `capitalFrequency`, hours | absent | 38,267 bytes, 43 rows | 677 to 879 ms |

No call returns all five `AnchorRow` columns for every contract at once.
`/fapi/v1/index` requires `contractName`, and without it answers `-1121`.
One round over all 45 contracts, three at a time, took 9,925, 7,830 and 7,401 ms in three runs.
The CMC feed is the only bulk call, and it carries no mark.

The documented `index` reply differs between the two documents.
The ChainUP page shows `currentFundRate`, `indexPrice`, `tagPrice` and `nextFundRate`, S7.
The CoinChief page shows `markPrice`, `indexPrice`, `lastFundingRate`, `contractName` and `time`, S5.
The wire matched the ChainUP page on all 45 contracts in both runs.

```json
{"currentFundRate":0.0001200000000000,"indexPrice":63050.0200000000000000,"tagPrice":63091.8891539062500000,"nextFundRate":0.0037500000000000}
```

`funding_rate` in the CMC feed equalled `currentFundRate`, and `next_funding_rate` was `null` on every row.
`index_price` in the CMC feed equalled `indexPrice` on 38, 41 and 37 of 45 contracts, and the rest moved between the two reads.

### Row mapping, if a poller were built

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` of the request, `E-BTC-USDT` | string | none |
| `index` | `indexPrice` | JSON number | none, and 0 on `E-MATIC-USDT` |
| `mark` | `tagPrice` | JSON number | none |
| `fundingRate` | `currentFundRate` | fraction per 8 h period, "used for settlement in this period", S7 | none |
| `fundingIntervalHours` | `capitalFrequency` of the web list | hours, 8 on all 43 | none |
| `nextFundingAt` | computed | | the next of 00:00, 08:00 and 16:00 UTC |

`next_funding_rate_timestamp` cannot be used for `nextFundingAt`.
At 06:44 UTC it read 2026-09-23 16:00 UTC on 23 contracts, 2025-12-28 16:00 UTC on 21 and 2025-07-01 08:00 UTC on 1.
The documented schedule puts the next settlement at 08:00 UTC, S9, and the mark agrees with it, see section 4.

## 4. Anchor semantics

### Index

The help center says the index is a weighted average of "the latest transaction price of the standard currency pair of the mainstream exchange in the market and the median buy-to-sell median", S11.
A source not updated within 40,000 ms is set aside, and a source more than 3 % from the median is clamped to the median plus or minus 3 %, S11.
The basket, its weights and a basket call are Not publicly specified.

The published index is frozen on most contracts.
Against one read of Gate's public USDT perpetual index, S17, the OmniX index was 3.9 % to 67.7 % below Gate's on 26 of the 39 contracts that both venues list, in both runs that made the comparison, at 06:44 and 06:52 UTC.

| contract | OmniX `indexPrice` | below Gate's index, two runs | OmniX last price at 06:52 UTC | Gate's index at 06:52 UTC |
|---|---:|---:|---:|---:|
| `E-BTC-USDT` | 63,050.02 | 27.2 % and 27.1 % | 86,440.5 | 86,474.22 |
| `E-ETH-USDT` | 1,757.8 | 36.3 % and 36.2 % | 2,753.59 | 2,754.72 |
| `E-SOL-USDT` | 78.35 | 34.2 % and 34.1 % | 118.893 | 118.972 |
| `E-UNI-USDT` | 3.359 | 67.7 % and 67.7 % | 10.402 | 10.399 |
| `E-AAVE-USDT` | 88.59 | 41.7 % and 41.7 % | 152.04 | 151.994 |
| `E-DYDX-USDT` | 0.13622 | 4.1 % and 3.9 % | 0.142 | 0.1417 |

Over 59 one-second polls the BTC, ETH and SOL index did not change once, in any of three runs.
The same values were published at 06:36, 06:44 and 06:52 UTC.
The venue's last price was within 1 % of Gate's index on 38 of those 39 contracts, so the book is live and the index is not.

The other 13 contracts had an index within 0.53 % of Gate's, 44 to 5,309 ppm off at 06:44 UTC and 55 to 2,914 ppm off at 06:52 UTC.
Their index moves: `E-SYNX-USDT` published 6, 10 and 8 distinct values in 59 polls in three runs.
On 9 and 8 of those 13 the index equalled the venue's own last price exactly in the CMC feed read a few seconds earlier.
That hints at an index that is the venue's own price, the shape described in [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), and it is an inference that was not verified.
`E-MATIC-USDT` publishes an index and a mark of 0.
Six contracts have no Gate counterpart, `E-CTC-USDT`, `E-GNO-USDT`, `E-SKN-USDT`, `E-MATIC-USDT`, `E-SYNX-USDT` and `E-BUT-USDT`.

### Mark

The help center gives the mark as the median of the latest price, a reasonable price and a moving average price, S10.
The reasonable price is `index price * (1 + funding rate * time to settlement / interval)`, S9 and S10.

On the wire `tagPrice` followed the reasonable price and so followed the frozen index.
At 06:44 UTC it sat 1,187 or 1,188 ppm above the index on 19 of the 20 contracts with `nextFundRate` 0.0075, 594 ppm on the 3 at 0.00375, 2,375 ppm on the 2 at 0.015, and 16 ppm on 7 of the 19 at 0.0001.
Each of those is `nextFundRate` times about 0.158, which is 76 of the 480 minutes of the period left until 08:00 UTC.
At 06:52 UTC the contracts at 0.0075 read 1,062 or 1,063 ppm, the factor having decayed to about 0.142, 68 minutes.
Of the other 12 at 0.0001, 9 had a mark within 1 ppm of the index, and `E-VIRTUAL-USDT`, `E-SKN-USDT` and `E-YFI-USDT` sat 88, 209 and 554 ppm above.
`E-DYDX-USDT`, the twentieth at 0.0075, had a mark of 0.142 against an index of 0.13622, 42,431 ppm above, which is its own last price.
The BTC, ETH and SOL mark took 2 distinct values in 59 polls in each run, which is that time factor decaying.
So the mark is not an independent reading of the market on the frozen contracts, and it sits 27 % to 36 % below the BTC, ETH and SOL book.
No clamp on the mark premium is published.

### Funding

The formula, interval and times are in [`fees.md`](./fees.md) section 6.
The two published rates split the documented meanings, S7.
`currentFundRate` is "Funding rate price for the previous period (used for settlement in this period)", and `nextFundRate` is "Funding rate price".
The mark above used `nextFundRate`.
`currentFundRate` read 0.0001 on 23 contracts, 0.0075 on 10, 0.00375 on 1, 0 on 1, and 10 other values, and `nextFundRate` read 0.0001 on 19, 0.0075 on 20, 0.00375 on 3, 0.015 on 2 and 0 on 1.
Neither rate changed in 59 polls on any watched contract.
Which of the two is settled, and what was settled at past instants, could not be checked, because no public funding history call exists, S5 and S7.
The settlement instant itself was not captured.

### How often each number changed

Three runs of 59 polls at one second, at 06:37, 06:45 and 06:53 UTC.

| contract | `indexPrice` | `tagPrice` | `currentFundRate` | `nextFundRate` | CMC `last_price`, 12 polls at 5 s |
|---|---:|---:|---:|---:|---:|
| `E-BTC-USDT` | 1, 1, 1 | 2, 2, 2 | 1 | 1 | 6, 5, 8 |
| `E-ETH-USDT` | 1, 1, 1 | 2, 2, 2 | 1 | 1 | 7, 7, 7 |
| `E-SOL-USDT` | 1, 1, 1 | 2, 2, 2 | 1 | 1 | 12, 12, 10 |
| `E-SYNX-USDT` | 6, 10, 8 | 11, 22, 14 | 1 | 1 | 4, 8, 7 |

## 5. REST book snapshot

`GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=N`.

| item | value |
|---|---|
| depth | `limit` 5, 20 and 100 returned that many per side, `limit` 200 returned 100, no `limit` returned 100. The documented maximum is 100, S7 |
| level order | bids descending and asks ascending on every read |
| numbers | price and size as JSON numbers, `[86488.8,4723093]` |
| time | `time` in ms, always a whole second |
| repeat reads | six ETH reads about 0.55 s apart changed the touch on 2 of 5 steps in one run and 4 of 5 in the rerun. Two reads carrying the same whole-second `time` returned different sizes, so the reply is not one cached snapshot per second |
| thin books | `E-SYNX-USDT` 100 bids and 57 or 55 asks, `E-YFI-USDT` 1 bid and 1 ask, `E-MATIC-USDT` 1 bid and 1 ask 15,625 ppm apart |
| reply | 183 to 187 bytes at 5 levels, 3,230 to 3,249 bytes at 100, 253 to 778 ms |

## 6. Rate limits and errors

The CoinChief document says "The total weight of single interface weight according to IP statistics is 12,000 per minute" and 60,000 per minute per account, S5.
It lists 429 for a limit breach and 418 for an IP ban "from a minimum of 2 minutes to a maximum of 3 days", and one line also names HTTP 410 for a limit breach, S5.
It gives weights for spot endpoints only, and the futures endpoints carry no weight, S5.
No reply carried a rate limit header or `Retry-After`.
The anchor run made about 300 requests in 70 s and met no limit.

Every error came back as HTTP 200 with a JSON code.

| request | status | body |
|---|---|---|
| `/fapi/v1/index?contractName=E-NOPE-USDT` | 200 | `{"code":"-1121","msg":"无效的合约","data":null}`, "invalid contract" |
| `/fapi/v1/index` with no contract | 200 | the same `-1121` |
| `/fapi/v1/depth?contractName=BTC-USDT` | 200 | the same `-1121` |
| `/fapi/v1/ticker` with no contract | 200 | the same `-1121` |
| `/fapi/v1/nope` | 200 | `{"code":"-1002","data":null,"msg":"您无权执行此请求。请求需要发送API Key，…","succ":false}`, "you are not authorised, send an API key" |
| `/cmc/summary/NOPE-USDT` | 200 | an empty body |

A poller would have to check `code` on a 200 itself, since `getJson` returns any 2xx body as data, at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) lines 233 to 242.
The pause path keys on 403, 418 and 429, at [`errors.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/shared/errors.ts) line 1, or on a `RateLimitReplyError` that a venue poller throws, at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 191.

## 7. Server time and clock offset

`GET /fapi/v1/time` answered `{"timezone":"Coordinated Universal Time","serverTime":1790145388453}`.
The server clock was 1 ms behind and 9 ms ahead of the midpoint of a 323 ms and a 287 ms round trip.
The ChainUP document's example says "China Standard Time", S7, and this venue reports UTC.

## 8. Recommended poller shape

Not recommended.
The index is frozen on 26 of the 39 contracts that could be checked and the mark is derived from it, so an anchor built on it would judge the BTC, ETH and SOL legs against a price 27 % to 36 % below the market.
The engine's move guard would not catch it, because a frozen index never moves, see [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 6.

If the venue ever repairs its index, this is the shape that would fit.

| item | recommendation | reason |
|---|---|---|
| URL | `https://futuresopenapi.coinchief.live/fapi/v1/index?contractName=<symbol>`, one call per tracked contract | no bulk call carries the mark |
| interval | 1,000 ms, all contracts in parallel | a round three at a time took 7.4 to 9.9 s, and one call has a median near 300 ms |
| budget | 45 calls a second is 2,700 a minute | inside 12,000 weight a minute if a call weighs 4 or less, and the futures weight is not published |
| row mapping | section 3 | |
| `nextFundingAt` | computed from the 00:00, 08:00 and 16:00 UTC schedule | the published timestamp is stale on 22 of 45 |
| skip | `E-MATIC-USDT`, `E-YFI-USDT`, and any contract whose `indexPrice` is 0 | absent from the web list, index 0 |
| errors | treat a JSON `code` on HTTP 200 as a failed read | section 6 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S4 | OmniX site config, `POST /fe-ex-api/common/public_info` | https://www.omnix.vin/fe-ex-api/common/public_info | 2026-09-22 | OmniX, served from the CoinChief backend | the Coin Chief config and `base_url`, section 1 |
| S5 | CoinChief open API document, English | https://www.coinchief.live/openapi/open-api-en.html | 2026-09-22 | CoinChief | rate limits, error codes, the `index` reply as documented, sections 3, 4 and 6 |
| S6 | CoinChief CMC interface document | https://www.coinchief.live/CMC-api/ | 2026-09-22 | CoinChief | `/cmc/specifications` and its host, sections 1 to 3 |
| S7 | ChainUP Pri-openapi, Futures Trading API | https://exchangeopenapi.gitbook.io/pri-openapi/openapi-doc/futures-trading-api | 2026-09-22 | ChainUP | endpoints, field meanings, depth limit, sections 2 to 5 and 7 |
| S8 | ChainUP Pri-openapi, WebSocket, Chinese edition | https://exchangeopenapi.gitbook.io/pri-openapi/zhong-wen-wen-dang/websocket-tui-song | 2026-09-22 | ChainUP | `futuresws.<domain>` pattern, section 1 |
| S9 | Help center, Funding Rate | https://coinchief.freshdesk.com/en/support/solutions/articles/154000126070-funding-rate | 2026-09-22 | CoinChief help center | settlement times, reasonable price, section 4 |
| S10 | Help center, Mark Price | https://coinchief.freshdesk.com/en/support/solutions/articles/154000126229-mark-price | 2026-09-22 | CoinChief help center | mark formula, section 4 |
| S11 | Help center, Index Price | https://coinchief.freshdesk.com/en/support/solutions/articles/154000126230-index-price | 2026-09-22 | CoinChief help center | index rules, section 4 |
| S17 | Gate public USDT perpetual tickers, used as an outside index reference | https://api.gateio.ws/api/v4/futures/usdt/tickers | 2026-09-22 | Gate | Gate's `index_price` per contract, section 4 |
| P1 | `rest-probe.mjs host`, 06:36 UTC and the rerun | [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | access, DNS, latency, clock, sections 1 and 7 |
| P2 | `rest-probe.mjs catalog`, 06:36 UTC and the rerun | [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) | 2026-09-22 | this host | contracts, web list, CMC feed, section 2 |
| P3 | `rest-probe.mjs anchor`, 06:36, 06:44 and 06:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) | 2026-09-22 | this host | index round, Gate compare, one-second polls, sections 3 and 4 |
| P4 | `rest-probe.mjs book`, 06:38 UTC and the rerun | [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) | 2026-09-22 | this host | REST book, section 5 |
| P5 | `rest-probe.mjs errors`, 06:38 UTC and the rerun | [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) | 2026-09-22 | this host | error shapes and headers, section 6 |
