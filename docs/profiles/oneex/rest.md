# OneEx REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time (2026-10-10 02:18 to 02:50 UTC), from the development host near Seattle, through the user's Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada.

This profile covers the public REST calls of OneEx that a catalog, an anchor poller and a book resync would use, for its one live perpetual family, USDT-margined.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/oneex/rest-probe.py), run from the repository root with `uv run`, unless it names `curl`.
OneEx publishes no API documentation.
Every call below is one the website's own bundle `/static/index-Dnukw9wy.js` names, except `GET /api/quote/v1/indices`, which the bundle does not name and which was found by trying the name and confirmed on the wire.
None of them is a documented or supported API, so any of them may change without notice.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| web and REST host | `www.oneex.vip`, resolving to `103.183.198.103` and `103.24.55.139`, answering with `Server: CDN`. `getent hosts` names the edge `sj53-site-01.gocname.com`. | Probed |
| socket host | `ws.oneex.vip`, the same two addresses | Probed |
| broker OpenAPI host | `open-api.oneex.vip`, resolving to four CloudFront addresses in `143.204.1.0/24`, answering 403 to every path, see section 6 | Probed |
| `api.oneex.vip`, `openapi.oneex.vip` | no DNS record | Probed |
| cold request | 520 to 571 ms for `GET /api/quote/v1/time` over four runs | Probed |
| warm request | median 517 to 543 ms over 5 calls, and every timed call in the probe took 500 to 900 ms | Probed |

The latency is high for a CDN edge, and it bounds how fresh an anchor reading can be, see section 8.
No API documentation page exists: the footer, the help centre's 78 articles and the 10 help categories name none, and the site configuration has no API link.

## 2. Catalog

### The instruments call

`GET https://www.oneex.vip/s_api/basic/config_v2?tab=exchange&type=all` returns the site's whole configuration, about 368 KB in about 1.4 s.
Its `futuresSymbol` array is the perpetual catalog.

| field | meaning | BTC value |
|---|---|---|
| `symbolId` | the contract id used everywhere | `BTC-SWAP-USDT` |
| `exchangeId` | the prefix the socket and the REST book need, `301.` before the id | `301` on all 60 rows |
| `quoteTokenId` | settlement family | `USDT` |
| `status`, `canTrade` | open for trading | true, true |
| `showStatus` | shown on the site | true |
| `isReverse` | inverse contract | false |
| `baseTokenFutures.contractMultiplier` | base units per contract | `0.0001` |
| `minPricePrecision` | tick | `0.1` |
| `minTradeQuantity` | contracts | `1` |
| `baseTokenFutures.indexToken` | the index and mark key | `BTCUSDT` |
| `baseTokenFutures.riskLimits` | risk tiers with `maintainMargin` and `initialMargin` | first tier 80,000 USDT at 0.004 and 0.008 |
| `secondLevelUnderlyingId` | base coin | `BTC` |

Counts on 2026-10-10 UTC:

| group | rows |
|---|---:|
| USDT, `status` true, `canTrade` true, `showStatus` true | 28 |
| USDT, `status` true, `canTrade` true, `showStatus` false (`BANANA-SWAP-USDT`, `G-SWAP-USDT`) | 2 |
| USDH, `status` false, `canTrade` false, `showStatus` false | 30 |

So 30 USDT perpetuals are tradable, and every one settles in `USDT`.
No pair is listed twice among tradable rows, because every USDH twin is closed.

### How a catalog maps it

There is no CCXT class, see [`fees.md`](./fees.md) section 8, so a loader maps the rows itself.

| catalog field | source |
|---|---|
| raw market id | `symbolId`, `BTC-SWAP-USDT`, which is what the socket returns in `symbol` and the funding call returns in `tokenId` |
| subscribe symbol | `301.` + `symbolId`, see [`websocket.md`](./websocket.md) section 4 |
| base, quote | `secondLevelUnderlyingId` and `quoteTokenId` |
| linear | true on every row, `isReverse` false |
| active | `status` and `canTrade` both true |
| contract size | `baseTokenFutures.contractMultiplier`, from `0.0001` (BTC) and `0.01` (ETH, BCH) up to `10000.0` (DOGS) |
| anchor key | `baseTokenFutures.indexToken`, `BTCUSDT` for `BTC-SWAP-USDT` |

### Size unit and price scale

Book sizes are in contracts.
The BTC book's best levels carry sizes such as 65,897 contracts on the socket, which at a multiplier of 0.0001 is 6.59 BTC, while the ticker reports volume `v` 125,517,871 contracts and quote volume `qv` 1,037,267,059 USDT, which matches 12,552 BTC at about 82,600 USDT.
So a feed multiplies wire sizes by `contractMultiplier`.
Prices are per one base unit on every row, including `SHIB`, `DOGS` and `COS`, so no price scale is needed.

## 3. Anchor

No single call returns index, mark and funding together.

| column | call | reply | evidence |
|---|---|---|---|
| `fundingRate`, `nextFundingAt`, `fundingIntervalHours` | `GET /api/contract/funding_rates`, all 60 rows (30 USDT and 30 closed USDH) | about 11 KB, median about 560 ms, max 627 to 893 ms over 60 polls in each run | Probed |
| `index` | `GET /api/quote/v1/indices?symbol=BTCUSDT,ETHUSDT,...` with every `indexToken` in one comma list | 30 of 30 returned, about 670 bytes, median about 530 ms | Probed |
| `mark` | `GET /api/quote/v1/mark/klines?symbol=BTCUSDT&interval=1m&limit=1`, close `c`, one call per index token | about 130 bytes, median about 530 ms | Probed |

The funding row is `{"tokenId":"BTC-SWAP-USDT","curServerTime":"1791600155164","lastSettleTime":"1791576000000","settleRate":"-0.000004732006091229","nextSettleTime":"1791604800000","fundingRate":"-0.000002247578689185"}`.
The indices reply is `{"code":200,"data":{"<indexToken>":"<price>",...}}`, with `BTCUSDT` 82629.705 in one run, and without a `symbol` it answers 400 `{"code":-100003,"msg":"Symbol required!"}`.
The mark kline call refuses a comma list and a contract id, and answers `{"code":200,"data":[]}` for both.
`GET /api/quote/v1/markPrice` answers `{"code":200,"data":[]}` for every symbol form tried, and `GET /api/quote/v1/index` answers 404.
The index kline `GET /api/quote/v1/index/klines?symbol=BTCUSDT&interval=1m&limit=1` exists too, one call per index token.

### Row mapping

| `AnchorRow` field | value |
|---|---|
| `index` | `data[indexToken]` from the indices call, as a float |
| `mark` | `data[0].c` from the mark kline of `indexToken`, or the socket's `markKline_1m` push, see [`websocket.md`](./websocket.md) section 2 |
| `fundingRate` | `fundingRate`, the predicted rate for the coming settlement, see section 4 |
| `fundingIntervalHours` | (`nextSettleTime` - `lastSettleTime`) / 3,600,000, which was 8 on all 60 rows |
| `nextFundingAt` | `nextSettleTime`, Unix ms, 04:00 UTC on every row on 2026-10-10 |

## 4. Anchor semantics

### Index

S7 of [`fees.md`](./fees.md) says the index is "calculated by the platform using a weighted average of real-time prices from multiple mainstream spot markets", "(e.g., Binance, Coinbase, Kraken)".
No basket, weights or outlier rule are published, and no basket call was found.
Three reads of BTC put OneEx's `BTCUSDT` index 26, 6 and 6 ppm from OKX's `BTC-USDT` index, read from `GET https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USDT` right after.
The index changed on 37 to 45 of 60 one second polls in four runs.

### Mark

S7 gives "Mark Price=Index Price±Basis Deviation(or Funding Fee Impact)", where the basis deviation "reflects the short-term deviation of the futures price from the spot price", with no averaging window and no clamp.
On the wire the BTC mark sat a median 10 to 32 ppm and at most 102 ppm from the last traded price, and 510 to 571 ppm below the index, over four 60 s runs.
So the mark follows OneEx's own perp, not the index, which is the self-referential shape described in [`../../research/2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
The BTC mark changed on 26 to 37 of 60 one second polls.
The catalog's `marketPriceRange` of plus or minus 0.001 and `overPriceRange` of plus or minus 0.01 bound market and limit order prices, and no page ties either to the mark.

### Funding

S2 of [`fees.md`](./fees.md) says the rate is "Dynamically calculated by the platform based on the difference between the contract price and the index price, interest rates, and other factors" and gives no formula, cap or floor.
`fundingRate` is the predicted rate, because it moved during the period (1, 27, 1 and 7 changes in 60 one second polls on BTC), while `settleRate` is the last settled rate, which stayed at -0.000004732006091229 in every run.
With the perp about 510 to 570 ppm under the index, the predicted BTC rate stayed near -0.000002, so the rate does not track that premium one for one.
The two hidden tradable rows read `fundingRate` -0.02 and `settleRate` 0.0, and the 30 closed USDH rows read -0.003, which a poller must not read as live.
Every row reported the same `curServerTime` in one reply.

### How often each number changed

| number | changes in 60 one second polls, four runs |
|---|---|
| BTC `fundingRate` | 1, 27, 1 and 7 |
| BTC index from the indices call | 37, 45, 43 and 40 |
| BTC mark kline close | 28, 33, 37 and 26 |
| BTC last price from `GET /api/quote/v1/ticker?symbol=301.BTC-SWAP-USDT` | 20, 26, 31 and 20 |

## 5. REST book snapshot

`GET https://www.oneex.vip/api/quote/v1/depth?symbol=301.BTC-SWAP-USDT&limit=<n>` returns `{"code":200,"data":[{"e":301,"s":"BTC-SWAP-USDT","t":<ms>,"v":"<n>_18","b":[[price,size],...],"a":[...]}]}`.

| item | value |
|---|---|
| depth | `limit` 5 and 20 return 5 and 20 levels, and 100 and 500 returned 42 bids and 40 or 41 asks, which is the whole book the venue publishes |
| order | bids descending, asks ascending, on every reply |
| version | `v` is the same `<n>_18` the socket's `depth` topic carries |
| caching | the reply is cached for about 2 to 3 s per symbol: five calls 200 ms apart returned only two or three distinct `v` and `t` in each run |
| cache and limit | a cached reply serves later calls with another `limit`: ETH `limit` 100 and then `limit` 5 back to back returned the same `v` with 5 levels in three runs. A cached reply is cut down but not extended. In one run ETH `limit` 100 returned only 20 levels while the socket showed about 40, and in an earlier version of the probe without pauses BTC `limit` 20 right after `limit` 5 returned 5 levels with the same `v`. |
| symbol form | without the `301.` prefix the reply is `{"code":200,"data":[]}` |
| unknown or closed symbol | 400 `{"code":-100011,"msg":"Not supported symbols"}`, for `301.FOO-SWAP-USDT` and for the closed `301.BTC-SWAP-USDH` |

So a REST snapshot can hold fewer levels than asked and can be up to about 3 s old.

## 6. Rate limits and errors

No rate limit is published, and no reply carried a rate limit or `Retry-After` header.
The one minute poll ran four calls a second for 60 s and drew no refusal.
Errors come as JSON with a numeric `code` and `msg`, with the HTTP status set to match, such as 400 `{"code":-100011,"msg":"Not supported symbols"}`, 400 `{"code":-100003,"msg":"Symbol required!"}` and 404 `{"code":404,"msg":""}`.

The broker OpenAPI host refused every path from the Canadian exit, as the probe and `curl -D -` show:

```text
GET https://open-api.oneex.vip/openapi/v1/time
HTTP/2 403
server: CloudFront
x-cache: Error from cloudfront
x-amz-cf-pop: HIO52-P5
403 ERROR The request could not be satisfied. Request blocked. We can't connect to the server for this app or website at this time. There might be too much traffic or a configuration error.
```

The same body came back for `/openapi/v1/brokerInfo`, `/openapi/quote/v1/contract/index` and `/`.
CloudFront's generic "Request blocked" does not say whether the rule is a geoblock, an allow list or something else, and no other route was tried.
On `www.oneex.vip` the `/openapi/...` paths return the single page app shell with 200 and `text/html`.

## 7. Server time and clock offset

`GET /api/quote/v1/time` returns `{"code":0,"data":{"time":1791599123088}}`.
Over six calls per run the server clock ran 140 to 183 ms ahead of the local clock, medians 148, 179 and 152 ms in three runs, taking the midpoint of each request as the local reading.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

- Load the catalog from `futuresSymbol` in `GET /s_api/basic/config_v2?tab=exchange&type=all`, keep rows with `status` and `canTrade` true and `quoteTokenId` `USDT`, and keep `indexToken` per row.
- Poll `GET /api/contract/funding_rates` for funding, rate and next settlement, and skip any row whose `tokenId` is not tracked, which drops the USDH rows.
- Poll `GET /api/quote/v1/indices?symbol=<all index tokens>` for the index in one call.
- Take the mark from the socket's `markKline_1m` push per index token, as the Echobit adapter at [`../../../server/src/venues/echobit.rs`](../../../server/src/venues/echobit.rs) does, because no bulk mark call exists and 30 kline calls a second would be the alternative.
- Each call takes about 530 ms from this host, so one round of funding plus index fits in a 1 s interval only when both run in parallel.
- Treat a mark of OneEx as its own last price, see section 4, and gate it the way the self-index research says.

## 9. Source ledger

| id | title | URL | retrieved | supports |
|---|---|---|---|---|
| R1 | OneEx web bundle, the list of `/api/...` paths and the socket URL builder | https://www.oneex.vip/static/index-Dnukw9wy.js | 2026-10-09 | sections 1 to 5 |
| R2 | OneEx site configuration | https://www.oneex.vip/s_api/basic/config_v2?tab=exchange&type=all | 2026-10-09 | section 2 |
| R3 | OKX index tickers, BTC-USDT | https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USDT | 2026-10-09 | section 4 |
| R4 | Fee sources S1 to S7 | [`fees.md`](./fees.md) section 10 | 2026-10-09 | sections 3 and 4 |
