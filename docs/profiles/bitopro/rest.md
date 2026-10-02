# BitoPro REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:14 and 03:45 UTC on 2026-09-23.

This profile covers the public REST API v3 of BitoPro (CCXT id `bitopro`) that a catalog and a book read would use.
BitoPro lists no perpetual, see [`fees.md`](./fees.md) section 3, so this is its spot market, and it publishes no index, mark or funding.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bitopro/rest-probe.mjs), run from `server/`, in the `main` runs at 03:16, 03:29, 03:32 and 03:44 UTC and the `poll` runs at 03:26 and 03:32 UTC.
Where the documentation and the wire disagree, both are written.
The documentation is a GitHub repository, whose raw files answered this host with 200.

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-23 | edge |
|---|---|---|---|
| `api.bitopro.com` | REST base `https://api.bitopro.com/v3`, S1, and CCXT at `server/node_modules/ccxt/js/src/bitopro.js` line 152 | `75.2.65.107` and `99.83.140.188` in all four `main` runs | no header names the edge. The addresses sit in ranges that AWS Global Accelerator assigns, which is an inference |
| `stream.bitopro.com` | WebSocket, see [`websocket.md`](./websocket.md) | `15.197.251.122` and `3.33.217.164` | the same kind of range |
| `www.bitopro.com` | website and fee page | `35.71.175.152` and `52.223.35.101` | the same kind of range |

| call | reply | cold | warm, 4 sequential requests per run |
|---|---|---|---|
| `GET /provisioning/trading-pairs` | 10,594 bytes | 336 to 374 ms in four runs, the first request of each process | 104 to 119 ms |
| `GET /tickers` | 5,806 to 5,811 bytes | 106 to 110 ms | 104 to 129 ms |
| `GET /order-book/btc_usdt?limit=20` | 2,893 to 2,946 bytes | 104 to 110 ms | 103 to 129 ms |

Every reply of the latency step carried the same eight headers: `access-control-allow-origin`, `connection`, `content-type`, `date`, `transfer-encoding`, `vary`, `x-request-id` and `x-response-time`.
`x-response-time` read 1 to 5 ms in the `main` runs, so almost all of the 105 ms is the path.
There is no `server`, cache, rate limit or `Retry-After` header.

Over two `poll` runs of 60 one second polls, `tickers` took median 110 and 111 ms, max 345 and 350 ms, and the book took median 102 and 104 ms, max 320 and 340 ms, with 0 errors.

## 2. Catalog

### The instruments call

`GET https://api.bitopro.com/v3/provisioning/trading-pairs` returns every pair in one reply, S3.

| field | meaning | on 2026-09-23 |
|---|---|---|
| `pair` | lowercase id, `btc_usdt` | 35 rows, all lowercase |
| `base`, `quote` | lowercase codes | 15 quoted in `usdt`, 19 in `twd`, 1 in `btc` |
| `maintain` | a pair under maintenance | false on all 35 |
| `basePrecision`, `quotePrecision` | decimals of the order amount and price | `btc_usdt`: 8 and 2 |
| `amountPrecision` | the decimals the socket rounds book amounts to after its first frame | `btc_usdt`: 4. 29 pairs have 4, and 2 pairs each have 3, 2 and 0, see [`websocket.md`](./websocket.md) section 4 |
| `orderBookQuotePrecision`, `orderBookQuoteScaleLevel` | price decimals of the book and the highest `scale` the book call takes | `btc_usdt`: 2 and 5. Scale levels 2 to 7 across pairs |
| `minLimitBaseAmount`, `maxLimitBaseAmount`, `minMarketBuyQuoteAmount`, `orderOpenLimit` | order limits | `btc_usdt`: 0.0001, 100000000, 7, 200 |

The 15 USDT pairs are `kaia_usdt`, `btc_usdt`, `bito_usdt`, `ada_usdt`, `pol_usdt`, `doge_usdt`, `xaut_usdt`, `ton_usdt`, `bch_usdt`, `sol_usdt`, `ltc_usdt`, `shib_usdt`, `ape_usdt`, `eth_usdt` and `usdc_usdt`.
The one BTC pair is `eth_btc`, and the rest are TWD pairs.

### How CCXT 4.5.68 maps it

| item | CCXT | against the wire |
|---|---|---|
| markets | 35, all `type` `spot`, 0 swaps, 35 active | the catalog's 35 rows |
| `market.id` | `btc_usdt`, the catalog `pair` on all 35, line 440 | REST calls use it as is. The socket spells `BTC_USDT`, so a feed maps `pair.toLowerCase()` to the id |
| `active` | `!maintain`, line 439 | true on all 35 |
| `linear`, `contractSize` | undefined, lines 482 and 484 | the engine would take a contract size of 1, which is right for base currency amounts |
| amount precision | `1e-8`, from `basePrecision` at line 492 | CCXT never reads `amountPrecision`, the precision of the socket's book amounts after its first frame |
| `taker` | 0.002 | the live VIP 0 taker, see [`fees.md`](./fees.md) section 8 |

The engine's connector keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 79, so it would take 0 BitoPro markets and skip the venue.

### Pairs listed twice and the quote family

No base is listed twice under one quote.
Bases listed under both USDT and TWD, like BTC, ETH and SOL, would reach the engine once, because TWD is outside the USD, USDC and USDT family of [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
No pair needs a price scale.

## 3. Anchor

BitoPro publishes no index, no mark and no funding, since it lists no perpetual.
It publishes two reference prices, and neither is an index.

| call | what it returns | on 2026-09-23 |
|---|---|---|
| `GET /v3/price/otc/{currency}`, S4 | the OTC desk's buy and sell swap quotation against TWD, `{"currency","buySwapQuotation":{"twd":{"pricingCurrency","exchangeRate"}},"sellSwapQuotation":{…}}` | `usdt` buy 31.878004 to 31.904108 and sell 31.5732 to 31.617024 TWD, a spread of 0.8 to 1.0 %, over four runs. `btc` buy 2,777,440.41 to 2,787,600 and sell 2,714,491.22 to 2,725,007.55 TWD, a spread of 2.1 to 2.3 %. An unknown currency answers 422 `{"error":"Cannot list price, please try again later"}` |
| the ticker stream, see [`websocket.md`](./websocket.md) section 6 | `lastPriceUSD` and `lastPriceTWD` next to `lastPrice` | a conversion of the last trade, whose source rate is Not publicly specified |

No call returns a mark, and no `AnchorRow` column has a source.
A leg with a mark of 0 is refused at open, at [`types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/types.ts) line 34 and [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) line 38.

## 4. Anchor semantics

Nothing to record for an index, a mark or a funding rate.
The OTC quotation is a dealer price whose formula is Not publicly specified, S4.

## 5. REST book snapshot

`GET https://api.bitopro.com/v3/order-book/{pair}?limit=&scale=`, S2.

| request | reply |
|---|---|
| no `limit`, or `limit=0` | 200, 5 levels a side, the documented default |
| `limit` 1, 5, 10, 20, 30 or 50 | 200, that many levels a side |
| `limit` 7, 100 or 1000 | 422 `{"error":"Invalid limit: 100"}` |
| `scale` 0, 1 or 3 on `btc_usdt` | 200, prices grouped into coarser steps: best bid `86496.04` at 0, `86496.0` at 1 and `86490` at 3 in the first run |
| `scale=9` on `btc_usdt`, whose `orderBookQuoteScaleLevel` is 5 | 422 `{"error":"Invalid scale: 9"}` |
| `order-book/BTC_USDT` | 200, so the path is case blind |
| `order-book/nope_usdt` | 422 `{"error":"Unsupported trading pair nope_usdt."}` |

The reply has only `bids` and `asks`, each level `{"price","amount","count","total"}` as strings except the integer `count`.
It carries no time, no sequence and no id.
Bids come best first descending and asks best first ascending at every limit, and `total` is the running sum of `amount`, in all four runs.
Amounts are exact, up to 8 decimals, unlike the socket after its first frame.
No cache header is sent, and the `btc_usdt` book at 20 levels changed on 41 and 39 of 59 one second polls.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public limit | "600 requests per minute per IP", S1 | not approached: each mode stayed under 4 requests a second and under 150 requests in all |
| status on a limit | 429 "Too Many Requests", S1 | not triggered |
| `Retry-After` | Not publicly specified | not sent on any reply |
| CCXT | `rateLimit` 100 ms, one request per 100 ms, at line 25, which is the 600 per minute | |
| error shape | a status code table, S1 | 422 with `{"error": "<text>"}` for a bad pair, limit, scale or currency. 404 with `{"message":"404 NOT FOUND"}` and a trailing newline for an unknown path |

## 7. Server time and clock offset

No server time call exists, and CCXT sets `'fetchTime': false` at line 115.
The `Date` header has one second resolution, and its offset from this host's clock read between -11 and -956 ms over 20 reads in four runs, which fits an offset well under one second.
The socket's `timestamp` arrived 45 to 168 ms after its value, while a REST round trip took about 105 ms, so the venue clock agrees with this host's to within a few tens of milliseconds, which is an inference.

## 8. Recommended poller shape

None.
There is no index, mark or funding to poll, and a mark of 0 refuses every route at open, so an anchor poller would only confirm that.
A later spot design would read `GET /v3/provisioning/trading-pairs` at start for the ids, `maintain` and `amountPrecision`, and the socket for books.
Skip the TWD pairs and `eth_btc`, which fall outside the quote family.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BitoPro Official Open API Document, README | https://github.com/bitoex/bitopro-offical-api-docs/blob/master/README.md | 2026-09-22 | BitoPro | REST base, rate limit, status codes, sections 1 and 6 |
| S2 | BitoPro Get OrderBook Data | https://github.com/bitoex/bitopro-offical-api-docs/blob/master/api/v3/public/get_orderbook_data.md | 2026-09-22 | BitoPro | limits 1 to 50, default 5, `scale`, section 5 |
| S3 | BitoPro Get Trading Pair Info | https://github.com/bitoex/bitopro-offical-api-docs/blob/master/api/v3/public/get_trading_pair_info.md | 2026-09-22 | BitoPro | catalog fields, section 2 |
| S4 | BitoPro Get OTC Price | https://github.com/bitoex/bitopro-offical-api-docs/blob/master/api/v3/public/get_otc_price.md | 2026-09-22 | BitoPro | OTC buy and sell quotation, sections 3 and 4 |
| S5 | CCXT 4.5.68 `bitopro.js` | `server/node_modules/ccxt/js/src/bitopro.js` | 2026-09-22 | CCXT | `rateLimit`, `fetchTime`, REST URL, `parseMarket`, sections 1, 2, 6 and 7 |
| P1 | `rest-probe.mjs main`, runs at 03:16, 03:29, 03:32 and 03:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitopro/rest-probe.mjs) | 2026-09-22 | this host | DNS, latency, headers, catalog, CCXT mapping, book limits and errors, OTC price, `Date` offset |
| P2 | `rest-probe.mjs poll`, runs at 03:26 and 03:32 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitopro/rest-probe.mjs) | 2026-09-22 | this host | poll times, book change counts, section 1 and 5 |
| P3 | `ws-probe.mjs book` and `batch` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitopro/ws-probe.mjs) | 2026-09-22 | this host | socket `timestamp` lag, section 7 |
