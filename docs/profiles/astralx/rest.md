# AstralX REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, which is 2026-09-23 06:44 to 07:09 UTC, from the development host near Seattle through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST surface of AstralX for its USDT-margined perpetuals.
AstralX publishes no API documentation, section 2, so every call below is one the `www.astralx.com` web front makes, read out of its JavaScript on 2026-09-23 UTC, S14, and then probed.
Such calls are internal to the web front and can change with any deploy.
Every call was made through the Canadian VPN exit, and Cloudflare answered from its `SEA` and `YVR` edges.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/astralx/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs).

## 1. Host and latency from this machine

| host | resolved | notes |
|---|---|---|
| `www.astralx.com` | 104.18.6.45, 104.18.7.45 and two IPv6 addresses, Cloudflare | serves the web front and every public call below. `/cdn-cgi/trace` reported `loc=CA` and `colo=SEA` or `YVR` |
| `fws.astralx.com` | the same Cloudflare addresses | the perpetual WebSocket, see [`websocket.md`](./websocket.md) |
| `api.astralx.com` | 13.159.220.174 | 403 on every path with a 14,569 byte SafeLine WAF page. A made-up name such as `qqzzx93.astralx.com` resolves to the same address, so this is a wildcard record and not evidence of an API host |
| `support.astralx.com` | 216.198.53.11 and 216.198.54.11 | Zendesk help center |

| request | first run, 06:44 UTC | second run, 06:56 UTC |
|---|---|---|
| cold `GET /f_api/public/quote/time` | 276 ms | 192 ms |
| ten warm requests, min, median, p90, max | 107, 110, 130, 130 ms | 114, 117, 123, 123 ms |

From `rest-probe.mjs latency`.

## 2. Catalog

### API documentation

None was found.

| place checked | result |
|---|---|
| help center search for "API", through `support.astralx.com/api/v2/help_center/articles/search.json` | 49 results. The only API articles are the two notices in section "Cập nhật API AstralX": perpetual API trading suspended from 2026-04-15 14:00 to 2026-04-30 24:00, and "successfully completed" on 2026-05-07 at 12:00, S11 |
| help center search for "websocket" and "apidoc" | 0 results each |
| web front routes `/en-us/api`, `/en-us/apiDoc`, `/en-us/api-doc`, `/en-us/openapi` | 404 |
| `/apidoc` | 200, but the body is the home page in Chinese, not a document |
| `api.astralx.com` | 403 SafeLine page, section 1 |
| `www.astralx.com/openapi/<any path>` | HTTP 500 `{"code":20401,"msg":"Authentication failed, login again"}`, also for `/openapi/nope` |
| GitHub search for `astralx` | 21 repositories, none from the exchange, S17 |
| CCXT 4.5.68 and CCXT master | no class, see [`fees.md`](./fees.md) section 8 |
| CoinGecko exchange and derivatives exchange lists | no AstralX entry, S16 |

The web front does manage API keys, through `/user/security/api_keys`, `/user/security/api_key/create`, `/user/security/api_key/update_ips` and `/user/security/api_key/delete`, S14.
So an API exists for account holders, and its documentation, if any, is not public.
The routes above are from `rest-probe.mjs access` at 07:09 UTC, and the searches were `curl` calls on 2026-09-23.

### The instruments call

No catalog call was found.
The catalog below comes from three sources, and only the first carries contract specifications.

| source | reply | rows | what it carries |
|---|---|---|---|
| `GET /en-us/futures/BTCUSDT_PERP`, the server-rendered futures page | 4,167,326 bytes of HTML in 1,511 to 2,864 ms | 32 contracts in one embedded JSON map keyed by `symbolId` | `symbolId`, `baseTokenId`, `quoteTokenId`, `minPricePrecision` (tick), `basePrecision`, `minTradeQuantity`, `baseTokenFutures.contractMultiplier`, `baseTokenFutures.indexToken`, `maxLeverage`, `riskLimits`, the four fee rates, `canTrade`, `showStatus`, `category`, `isReverse` |
| `GET /f_api/public/quote/ticker` | 9,074 to 9,081 bytes | 51 | `s`, last `c`, `h`, `l`, `o`, `v`, `qv`, `m`, `ms`, `b`, `a`, `t` |
| `GET /futures/funding_rates` | 9,498 bytes | 51 | `tokenId`, `fundingRate`, `settleRate`, `nextSettleTime`, `lastSettleTime`, `curServerTime` |

All from `rest-probe.mjs catalog`, four runs at 06:44, 06:55, 07:05 and 07:07 UTC.
The 32 embedded contracts all have `category` 4, `quoteTokenId` `USDT`, `canTrade` true, `showStatus` true and `isReverse` null.
The 19 ids that the ticker and funding calls return beyond the 32 had zero volume in every run and deliver no book, see [`websocket.md`](./websocket.md) section 4.
No call carries a status field for them, so a catalog built from the futures page is the only one that excludes them.

### How a loader would map it

There is no CCXT class, so the engine would need its own loader in place of `loadMarkets`.

| engine field | source | note |
|---|---|---|
| `rawMarketId` | `symbolId`, as `BTCUSDT_PERP` | identical to the ticker `s`, the funding `tokenId` and the socket `symbol` |
| `base`, `quote` | `baseTokenId`, `quoteTokenId` | `quoteTokenId` is `USDT` on 32 of 32 |
| `linear` | true | `isReverse` null and the quote is USDT on 32 of 32 |
| `contractSize` | `baseTokenFutures.contractMultiplier` | 1 on 11 contracts, 10 on 3, 100 on 2, 1000 on 3, 0.01 on 5, 0.1 on 7, 0.001 on 1 |
| `active` | `canTrade` and `showStatus`, and membership of the futures page | the ticker and funding calls alone would add 19 dead ids |

Book sizes are contracts of `contractMultiplier` coins, see [`websocket.md`](./websocket.md) section 4.
The contract multiplier equals the OKX `ctVal`, and the tick equals the OKX `tickSz`, on 32 of 32 listed contracts, from the OKX instruments call in `rest-probe.mjs catalog` at 07:07 UTC.
One contract is listed per base, so no pair is listed twice.
Prices are per coin, for example `DOGEUSDT_PERP` at 0.1025, so no price scale is needed even where the multiplier is 1000.
`XAUUSDT_PERP` and `XAGUSDT_PERP` are gold and silver, and they would need a check against any venue whose `XAU` is a token.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | warm time over 60 polls, two runs |
|---|---|---|---|---|---|---|---|
| `GET /futures/funding_rates` | absent | absent | `fundingRate` | `nextSettleTime - lastSettleTime`, only where `lastSettleTime` is not 0 | `nextSettleTime`, Unix ms | 9,498 bytes, 51 rows | median 130 and 118 ms, p90 135 and 122 ms, max 342 and 273 ms |
| `GET /f_api/public/quote/ticker` | absent | absent | absent | absent | absent | 9,074 to 9,081 bytes, 51 rows | median 107 and 109 ms, p90 115 and 117 ms, max 513 and 349 ms |
| `GET /quote/indices`, `GET /quote/markPrice` | named in the web front's JavaScript | | | | | 404, the Next.js page | |
| `GET /ipublic/basic/indices?symbol=BTCUSDT` | | | | | | `{"code":"0","msg":"suc","data":null,"succ":true}` | |

No public REST call returns an index or a mark.
Both exist only as the per symbol WebSocket topics `index_price` and `mark_price`, one frame per second each, see [`websocket.md`](./websocket.md) section 2.
So the engine's REST `AnchorPoller` cannot be filled from AstralX, and an anchor would need 64 socket subscriptions for 32 contracts.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `tokenId`, and `symbol` on the socket | string, `BTCUSDT_PERP` | none |
| `index` | socket `index_price` `data.p` | JSON number | none, and it equals the mark, section 4 |
| `mark` | socket `mark_price` `data.price` | JSON number | none |
| `fundingRate` | `fundingRate` | decimal string, a fraction per interval: `"0.000022148304249300"` | `Number()` |
| `fundingIntervalHours` | `(nextSettleTime - lastSettleTime) / 3,600,000` | ms | 8 on the 10 rows with a last settlement, and unknown on the 41 rows whose `lastSettleTime` is 0 |
| `nextFundingAt` | `nextSettleTime` | Unix ms, `1790150400000` is 2026-09-23 08:00 UTC | none |

All 51 rows read `nextSettleTime` 1790150400000 in every run.
`fundingRate` equalled `settleRate` on 51 of 51 rows.

## 4. Anchor semantics

### Index

The help center describes a volume-weighted average over 15 exchanges, which it lists as Binance, Bybit, OKX, KuCoin, Huobi, Bitget, Bittrex, HitBTC, Gate.io, Ascendex, MEXC, Bitfinex, Coinbase, Bitstamp and Kraken, S7.
Its protection rules zero the weight of a source not updated within 10 seconds, drop a source more than 10 % from the median, clamp one more than 5 % to 5 %, and follow the platform's own price when a single source is left, S8.
No basket or weight call is public.

The wire disagrees.
In `ws-probe.mjs mirror` at 06:58 UTC the `index_price` and the `mark_price` of the same second were equal on 25 of 25 pairs on each of BTC, ETH, SOL, XRP and DOGE.
The AstralX mark equalled the OKX `markPx` of the same contract in 7 of 10 reads and was one tick away in the other 3.
The OKX index differed from both, for example 86,509.8 against 86,468.5 on BTC, 477 ppm.
So the value AstralX publishes as its index is OKX's mark price, not a basket of 15 exchanges.
This is the self-referential index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), made total: the index is the mark itself.

### Mark

The help center gives "Mark Price = Median(Price1, Price2, Contract Price)", with "Price1 = Index Price * (1 + Funding Rate * (Time until next funding rate collection (in hours) / 8))" and "Price2 = Index Price + Moving Average (30-minute basis)", S6.
On the wire the mark is OKX's mark, as above, and no clamp beyond OKX's own was seen.
The `overPriceRange` of ±0.005 and `marketPriceRange` of ±0.001 on `BTCUSDT_PERP` look like order price bands rather than mark clamps, `rest-probe.mjs catalog`, and no page explains them.

### Funding

The help center gives "Funding Rate = ((Bid1 + Ask1) / 2 - Index Price) / Index Price - Funding Rate Settlement Interest, calculated every minute", S6.
On the wire the `fundingRate` of BTC, ETH, SOL, DOGE, GIGGLE and ZKP equalled the OKX `fundingRate` digit for digit, and OKX's `fundingTime` equalled AstralX's `nextSettleTime` on all six, in `rest-probe.mjs compare` at 07:05 UTC.
OKX reported caps of 0.00375 on BTC and 0.0075 or 0.01 on the others, and AstralX publishes none, see [`fees.md`](./fees.md) section 6.
The published rate is the one for the coming settlement, since it moves during the interval and `lastSettleTime` is the previous instant.

### Rate across a settlement

Not captured.
The settlement instant was not waited for, and `GET /futures/history_funding_rates?tokenId=BTCUSDT_PERP` answered `{"code":"330001","msg":"Request failed, please try again later","data":null,"succ":false}` in both `catalog` runs.
Whether the displayed rate resets after 08:00 UTC is Not verified.

### How often each number changed

| number | BTC | ETH | SOL | GIGGLE | ZKP |
|---|---|---|---|---|---|
| `fundingRate`, changes in 59 intervals of the 1 s REST poll | 1 and 1 | 1 and 1 | 1 and 1 | 0 and 0 | 0 and 0 |
| ticker last `c`, changes in 59 intervals | 36 and 31 | 34 and 33 | 24 and 28 | 24 and 29 | 18 and 24 |
| socket mark, distinct values in 59 one second frames | 37 and 30 | | | 8 and 5 | |

The pairs are the first and second runs of `rest-probe.mjs anchor` at 06:44 and 06:56 UTC and `ws-probe.mjs book` at 06:48 and 06:57 UTC.
The ticker `t` was 593 to 600 ms old at the median and up to 1,574 ms old on arrival, so the ticker is refreshed about once a second.
The funding rate steps once a minute, which matches the "every minute" of S6.

### What the engine would read

`markPremium` is mark over index minus one, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 83, so an AstralX leg would always read a mark premium of 0.
The carried factor at line 59 would then treat every AstralX leg as a venue that has accepted no premium, whatever OKX's mark says.
The index gap at line 58 would compare OKX's mark, standing in for AstralX's index, against another venue's index.
And the touch is OKX's touch, see [`websocket.md`](./websocket.md) section 4, so `freshPremium` at line 84 reproduces OKX's own fresh premium about 50 ms late.
The anchor adds nothing to an OKX leg and misstates one of its two premiums.

## 5. REST book snapshot

No public REST book call was found.
`GET /quote/depth?symbol=BTCUSDT_PERP`, which the web front's JavaScript names, returned the Next.js 404 page, `GET /f_api/quote/depth` returned `{"status":404,"error":"Not Found","path":"/f_api/quote/depth"}`, and `GET /futures/quote/depth` returned HTTP 401 `{"code":400,"msg":"Authentication failed. Please log in again."}`, as every unknown path under `/futures/` does.
The book is only available as the `depth_full` socket topic, whose every frame is a whole book of up to 400 levels.

## 6. Rate limits and errors

No rate limit is published.
The `anchor` mode made two calls a second for 60 s in each of two runs, 240 calls in all, and every reply parsed with its `data` array.
No `Retry-After` header and no 429 was seen.

| reply | when |
|---|---|
| HTTP 200 `{"code":"0","msg":"suc","data":[…],"succ":true}` | `/futures/funding_rates` |
| HTTP 200 `{"code":"0","message":"Success","data":…}` | `/f_api/public/…` |
| HTTP 200 `{"code":"330001","msg":"Request failed, please try again later","data":null,"succ":false}` | `/futures/history_funding_rates` without the parameters the web front sends |
| HTTP 400 `{"timestamp":"…","status":400,"error":"Bad Request","path":"…"}` | a missing required parameter, for example `/f_api/public/trade/history?symbol=…`, which wants `symbolId` |
| HTTP 401 `{"code":400,"msg":"Authentication failed. Please log in again."}` | any unknown path under `/futures/` |
| HTTP 500 `{"code":20401,"msg":"Authentication failed, login again"}` | any path under `/openapi/` |
| HTTP 404 Next.js page of about 4.1 MB | any unknown top-level path |
| HTTP 403 SafeLine page of 14,569 bytes | any path on `api.astralx.com` |
| HTTP 403 Cloudflare "Just a moment..." | the HTML page of the help center VIP article |

The 400 on `/f_api/public/trade/history` and the size of the 404 page are from `curl` on 2026-09-23 UTC, and the rest are from `rest-probe.mjs access` and `catalog`.
A poller should check `code` and not only the HTTP status, because a failed call can be HTTP 200.

## 7. Server time and clock offset

`GET /f_api/public/quote/time` answers `{"code":"0","message":"Success","data":1790146559486,"msg":"SUCCESS","success":true}` with `data` in Unix ms.
Over ten warm requests the server clock minus the local midpoint was 1 ms at the median and 11 ms at the most in the first run, and 3 ms and 5 ms in the second.
The funding reply also carries `curServerTime` in ms.

## 8. Recommended poller shape

AstralX is not recommended as a venue, so no poller is recommended.
The reasons, each covered above:

| reason | evidence |
|---|---|
| no public API documentation and no CCXT class, so every call is an undocumented web front internal | section 2, [`fees.md`](./fees.md) section 8 |
| the book is the OKX book at the same prices with about 90 % of its size, so an AstralX leg duplicates an OKX leg | [`websocket.md`](./websocket.md) section 4 |
| the index is the mark, and the mark and the funding rate are OKX's | section 4 |
| no REST index or mark, only per symbol socket topics | section 3 |
| no catalog call, only a 4 MB server-rendered page | section 2 |
| the terms exclude persons located in the United States | [`fees.md`](./fees.md) section 1 |

If it were added anyway, the smallest shape is the funding call at 1 s for `fundingRate` and `nextSettleTime`, an interval of 8 h assumed where `lastSettleTime` is 0, and `index_price` and `mark_price` read from the book socket.
That last part does not fit the REST `AnchorPoller`, whose `fetchRound` returns one bulk reply per round at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts) line 245.
The ticker call carries nothing the anchor needs.

## 9. Source ledger

The ids are shared by the three AstralX files, so an id that one file does not use is missing from its table.

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S6 | Mark Price, updated 2026-08-25 | https://support.astralx.com/hc/en-001/articles/7249041373839 | 2026-09-23 | global | mark and funding formulas, section 4 |
| S7 | Index Price, updated 2026-09-15 | https://support.astralx.com/hc/en-001/articles/7246950662415 | 2026-09-23 | global | index basket, section 4 |
| S8 | Index Price Protection Mechanism, updated 2026-08-25 | https://support.astralx.com/hc/en-001/articles/7248887401743 | 2026-09-23 | global | index protection rules, section 4 |
| S11 | Perpetual Contract API Trading Interface Optimization and Upgrade Announcement, and its Completion Announcement | https://support.astralx.com/hc/en-001/articles/15816593214479 and https://support.astralx.com/hc/en-001/articles/16039843427983 | 2026-09-23 | global | an API for account holders exists, section 2 |
| S14 | `www.astralx.com` web front JavaScript, the futures API module in chunk `4092-0ba0ea7855d58e7b.js` | https://www.astralx.com/_next/static/chunks/4092-0ba0ea7855d58e7b.js | 2026-09-23 | global | call paths and prefixes, API key routes, sections 2, 3 and 5. Chunk names change with each deploy |
| S16 | CoinGecko exchange and derivatives exchange lists | https://api.coingecko.com/api/v3/exchanges/list and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 | global | no AstralX entry, section 2 |
| S17 | GitHub repository search for `astralx` | https://api.github.com/search/repositories?q=astralx | 2026-09-23 | global | no official repository, section 2 |
| S18 | OKX public REST: instruments, tickers, books, mark price, index tickers, funding rate | https://www.okx.com/api/v5/public/instruments | 2026-09-23 | OKX | the comparisons in sections 2 and 4 |
| P1 | `rest-probe.mjs catalog`, `access`, `latency`, `compare` and `anchor`, first run 06:44 to 06:45 UTC, second run 06:55 to 06:57 UTC, `compare` again at 07:04 and 07:05 UTC, `catalog` again at 07:05 and 07:07 UTC and `access` again at 07:09 UTC after fields were added | [`rest-probe.mjs`](../../../scripts/probes/venues/astralx/rest-probe.mjs) | 2026-09-23 | this host, Canadian exit | sections 1 to 8 |
| P4 | `ws-probe.mjs mirror` at 06:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | mark equals index, and both equal the OKX mark, section 4 |
| P2 | `ws-probe.mjs book` at 06:48 and 06:57 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/astralx/ws-probe.mjs) | 2026-09-23 | this host, Canadian exit | mark cadence, section 4 |
