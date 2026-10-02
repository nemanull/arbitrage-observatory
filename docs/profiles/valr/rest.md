# VALR REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 in Seattle time, which was 03:05 to 03:24 UTC and again 03:33 to 03:37 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public REST API of VALR for its four USDT-margined perpetuals.
VALR has no CCXT class, see [`fees.md`](./fees.md) section 8, so the catalog and the anchor below are read from VALR's own replies.
Every call here was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/valr/rest-probe.mjs), public, unauthenticated and read-only.
VALR documents its public GET routes at 30 requests a minute per IP, S1, so the probe spaced its calls 3 to 4 s apart and never measured a one second poll.

## 1. Host and latency from this machine

| host | resolved | reply to this host |
|---|---|---|
| `api.valr.com` | 34.120.100.150 only, a Google Cloud address, and replies carry `via: 1.1 google` | 200 on every public route |
| `docs.valr.com` | 172.66.157.134 | 200, a Postman documenter page whose collection JSON holds the whole reference |
| `support.valr.com` | not recorded | 403 with a Cloudflare "Just a moment..." challenge on the HTML pages, 200 on the Zendesk JSON API of the same host |
| `www.valr.com` | not recorded | 200, a 7.8 KB single page app shell with no content |

| call | cold | warm |
|---|---|---|
| `GET /v1/public/time` | 246 and 256 ms | 167 to 173 ms over eight calls |
| `GET /v1/public/marketsummary`, 51.5 KB | 175 and 172 ms in the catalog runs | median 175 and 186 ms, p90 189 and 194 ms, max 325 and 273 ms over 21 polls in each run |
| `GET /v1/public/futures/info`, 593 bytes | 1,772 ms with `x-valr-upstream-service-time: 1569` on the first call at 03:11 UTC, then 339 and 180 ms | 19 to 23 ms when served from cache, 256 and 358 ms on a cache miss, over 10 polls in each run |
| `GET /v1/public/<pair>/orderbook` | 167 to 172 ms | |

## 2. Catalog

### The instruments call

`GET /v1/public/pairs` returned 409 rows, 128.6 KB, `cache-control: max-age=60,public`, in both runs, P1.

| `currencyPairType` | active | inactive |
|---|---:|---:|
| `SPOT` | 205 | 179 |
| `FUTURE` | 4 | 21 |

`GET /v1/public/pairs/FUTURE` returned the same 25 `FUTURE` rows, 4 active, P1.
Each row carries `symbol`, `baseCurrency`, `quoteCurrency`, `shortName`, `active`, `minBaseAmount`, `maxBaseAmount`, `minQuoteAmount`, `maxQuoteAmount`, `tickSize`, `baseDecimalPlaces`, `marginTradingAllowed`, `currencyPairType` and three margin fractions.
The status is the boolean `active`, and no other status field exists.

| symbol | base | quote | tick | min and max base | initial and maintenance margin |
|---|---|---|---|---|---|
| `BTCUSDTPERP` | BTC | USDT | 1 | 0.0001 to 7 | 0.0166 and 0.0083 |
| `ETHUSDTPERP` | ETH | USDT | 0.1 | 0.001 to 32 | 0.0166 and 0.0083 |
| `XRPUSDTPERP` | XRP | USDT | 0.0001 | 2 to 100,100 | 0.0166 and 0.0083 |
| `SOLUSDTPERP` | SOL | USDT | 0.01 | 0.01 to 300 | 0.0166 and 0.0083 |

Active perpetuals by settlement asset: USDT 4, USDC 0, ZAR 0.
The 21 inactive `FUTURE` rows include `BTCUSDCPERP`, `ETHUSDCPERP`, `BTCZARPERP`, `ETHZARPERP`, `USDTZARPERP`, `DOGEUSDTPERP`, `AVAXUSDTPERP`, `1MPEPEUSDTPERP` and `1000PEPEUSDTPERP`.

### How a catalog maps it, without CCXT

CCXT 4.5.68 has no VALR class, so there is no `loadMarkets` and no CCXT `market` object.
The engine's catalog path calls `loadMarkets` at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 68 and keeps active swaps at line 79, and the registry types `createExchange` as `() => ccxt.Exchange` at [`../../../server/src/venues/registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) line 29.
A VALR catalog therefore has to be written by hand from `/v1/public/pairs`, and the mapping it would use is below.

| engine field | VALR source | check |
|---|---|---|
| `rawMarketId` | `symbol`, `BTCUSDTPERP` | identical to the socket's `ps`, to `currencyPair` in `futures/info` and in `marketsummary` on 4 of 4, P1 and [`websocket.md`](./websocket.md) section 3 |
| `base`, `quote` | `baseCurrency`, `quoteCurrency` | |
| `linear` | true, PnL settles in the quote currency, S3 | |
| `contractSize` | 1 | the socket and the REST book report base coins, see [`websocket.md`](./websocket.md) section 4 |
| active | `active === true` and `currencyPairType === 'FUTURE'` | |

No pair is listed twice among the active perpetuals, P1.
No active perpetual needs a price scale today.
`1MPEPEUSDTPERP`, `1MSHIBUSDTPERP`, `1MBONKUSDTPERP` and `1000PEPEUSDTPERP` are inactive, and would need one if they return.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /v1/public/marketsummary` | absent | `markPrice` | absent | absent | absent | 51.5 KB, 177 rows of which 4 are perpetuals, `max-age=5` on the wire and 60 in S1 | median 175 and 186 ms over 21 polls |
| `GET /v1/public/futures/info` | absent | absent | `estimatedFundingRate` | absent | `nextFundingRun`, Unix ms | 593 bytes, 4 rows, `max-age=60` | 19 to 23 ms from cache, 180 to 1,772 ms from the origin |
| `GET /v1/public/<pair>/marketsummary` | absent | `markPrice` | absent | absent | absent | 297 bytes, one pair, `max-age=5` on the wire and 10 in S1 | 210 ms, one call |
| socket `MARK_PRICE_UPDATE` | absent | `data.price` every 3 s | absent | absent | absent | see [`websocket.md`](./websocket.md) section 2 | |

No public call and no socket event publishes an index price.
The API reference holds no field whose name contains "index", S1.
CoinGecko's derivatives tickers do show an `index` for these contracts, 86,463 for `BTCUSDTPERP` beside a last of 86,355, S5, and where CoinGecko reads it is not public.
`futures/info` also carries `openInterest` in base coins and `nextPnlRun`, the next 4 hour PnL realisation.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `currencyPair` | string, `BTCUSDTPERP` | none |
| `index` | none | | no source, see section 8 |
| `mark` | `markPrice` of `marketsummary`, or `data.price` of `MARK_PRICE_UPDATE` | decimal string | `Number()` |
| `fundingRate` | `estimatedFundingRate` of `futures/info` | decimal string, a fraction per hour: `"-0.000018"` is -0.0018 % | `Number()` |
| `fundingIntervalHours` | none on the wire | documented as hourly, S3 | the constant 1 |
| `nextFundingAt` | `nextFundingRun` of `futures/info` | integer Unix ms: `1790136000000` is 2026-09-23 04:00 UTC | none |

At 03:20 UTC every row read `nextFundingRun` and `nextPnlRun` 1790136000000, 04:00 UTC, P1.
Two calls with different caches are needed for one row, and neither carries a publish time for the mark.

## 4. Anchor semantics

### Index

"All index constituents are equally weighted and updated every 3 seconds", S4.
"A central measure is used to determine the index price", S4.
The guide adds that outliers are excluded and that cross rates may stand in for a direct pair, S3 "Indices".
The index is published nowhere, see section 3, so the baskets below are the only view of it.

| perpetual | index basket, S4 |
|---|---|
| `BTCUSDTPERP` | Binance BTCUSDT, Bybit BTCUSDT, Kraken BTCUSDT, Kucoin BTCUSDT, OKX BTCUSDT |
| `ETHUSDTPERP` | Binance ETHUSDT, Bybit ETHUSDT, Kraken ETHUSDT, Kucoin ETHUSDT, OKX ETHUSDT |
| `SOLUSDTPERP` | Binance SOLUSDT, Bybit SOLUSDT, Kraken SOLUSDT, Kucoin SOLUSDT, OKX SOLUSDT |
| `XRPUSDTPERP` | Binance XRPUSDT, Bybit XRPUSDT, Kucoin XRPUSDT, OKX XRPUSDT, Coinbase XRPUSDT |

The baskets are named by the underlying spot pair, and S3 says the mark is the index "of the underlying spot market".
No basket of the four names VALR, so the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md) does not apply.
Whether "Binance BTCUSDT" means the spot or the perpetual market is not stated, and S3 speaks of spot prices.
No basket call exists, and the basket list is a help center article last edited 2025-10-29.

### Mark

"Mark price = median (Market price, Price1, Price2)", S3, where:

- Market price is `median(best bid, best offer, last traded price)` of the perpetual.
- Price1 is `Index price * (1 + Estimated Funding rate * Remaining time till Funding payment / Length of Funding interval)`.
- Price2 is `Index price + 5 minute average futures basis`, the time weighted gap between the perpetual's market price and the index.

The clamp is "a max mark price deviation vs spot index", which "is currently set to 1.5%", S3.
A perpetual that trades more than 1.5 % from its index therefore reads a mark held at 1.5 %, which is the capped premium shape named in [`2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md), and without a published index the cap cannot be detected from the anchor.
On the wire the mark sat at the touch: one `BTCUSDTPERP` summary read `markPrice` 86,438 with a bid of 86,438 and an ask of 86,453, P1, and the socket's first mark, 86,476, equalled the snapshot's best bid, see [`websocket.md`](./websocket.md) section 6.

### Funding

The rate is the 24 hour time weighted premium of the market price over the index, divided by 24, floored to 0 below 0.0001 % per hour and capped at 1 % per hour, S3, see [`fees.md`](./fees.md) section 6.
The interval is one hour, and settlement is at the start of every hour, S1 and S3.

### Rate across a settlement

The settlement instant was not captured.
At 03:20 UTC, 20 minutes after the 03:00 run, `estimatedFundingRate` equalled the `fundingRate` of the 03:00 row of `GET /v1/public/futures/funding/history` on 4 of 4 perpetuals, P1.
Over each of two 120 s anchor runs the rate did not change on any of 10 polls, P2, and the history moves by about 0.000001 an hour.
So whether `estimatedFundingRate` is recomputed within the hour, or is the rate settled at the last run carried forward, is Not verified.
The history returns 100 rows by default, newest first, with `fundingTime` on the hour, P1.

### How often each number changed

Over 120 s, one call every 4 s, in two runs at 03:21 and 03:34 UTC, P2:

| pair | `marketsummary` polls | `markPrice` changes | `futures/info` polls | rate changes |
|---|---:|---:|---:|---:|
| `BTCUSDTPERP` | 21 | 6 and 8 | 10 | 0 |
| `ETHUSDTPERP` | 21 | 8 and 9 | 10 | 0 |
| `XRPUSDTPERP` | 21 | 10 and 11 | 10 | 0 |
| `SOLUSDTPERP` | 21 | 8 and 10 | 10 | 0 |

`futures/info` was served from a shared cache: its `age` header read 12, 24, 36 and 48 s in the first run, and from 12 to 56 s in the second, P2.
So a poll of it can return a rate and a `nextFundingRun` up to 60 s old.
`marketsummary` showed an `age` of 1 to 4 s, P1 and P2, and the `created` stamp of its perpetual rows was a median 5.0 and 4.8 s and at most 41.2 and 47.4 s behind arrival, P2.
The socket's `MARK_PRICE_UPDATE` came every 3 s and changed on 5 to 25 of the 25 frames after the first over two runs, see [`websocket.md`](./websocket.md) section 3.

## 5. REST book snapshot

| call | depth | order | cache | probed |
|---|---|---|---|---|
| `GET /v1/public/<pair>/orderbook` | "top 41 bids and asks", aggregated by price, S1 | bids descending, asks ascending, S1 | `max-age=30` | 27, 20, 41 and 37 bids and 17, 18, 21 and 20 asks on BTC, ETH, XRP and SOL in the first run, 27, 20, 41 and 35 bids and 16, 18, 21 and 19 asks in the second, order as documented, P1 |
| `GET /v1/public/<pair>/orderbook/full` | every order, not aggregated, S1 | as above | `max-age=30` | 43 order rows on the bid side of `BTCUSDTPERP`, each with an order `id` and `positionAtPrice`, P1 |
| `GET /v1/marketdata/<pair>/orderbook` | as the public book, authenticated | | `max-age=1`, S1 | not probed |

Each level is `{"side", "quantity", "price", "currencyPair", "orderCount"}` with string price and quantity in base coins.
The reply also carries `LastChange`, an ISO time, and `SequenceNumber`, which is not the socket's `sq`, see [`websocket.md`](./websocket.md) section 4.
A 30 s cache makes this book unfit to seed or check the socket, and the socket needs neither.

## 6. Rate limits and errors

| limit | documented, S1 | probed |
|---|---|---|
| REST per IP | 1,200 requests a minute | not approached |
| REST per API key | 2,000 requests a minute | no key used |
| `/v1/public/*` GET | 30 a minute | not approached, the probe stayed at 20 a minute or less |
| `/v1/public/time`, `/v1/public/status`, `/v1/public/*/buckets` | 20 a second each | |
| WebSocket new clients, `/ws` | 60 a minute per IP | |
| reset | every limit resets at the start of each minute, and the per second routes at the start of each second | |
| excess | HTTP 429 on REST, `{"type": "RATE_LIMIT_EXCEEDED"}` on a socket, and "We may reduce limits when the system is under severe pressure." | not triggered, so `Retry-After` was not seen |

Whether the 30 a minute budget is shared by every `/v1/public/*` path or counted per path is Not publicly specified.

| request | status | body |
|---|---|---|
| `/v1/public/NOPEUSDTPERP/orderbook` | 400 | `{"code":-21,"message":"Unsupported Currency Pair"}` |
| `/v1/public/DOGEUSDTPERP/orderbook`, inactive | 200 | `{"Asks":[],"Bids":[],"LastChange":"2026-09-18T12:28:40.275Z","SequenceNumber":9725552044}` |
| `/v1/public/DOGEUSDTPERP/marketsummary`, inactive | 404 | `{"code":-111,"message":"Market summary not found"}` |
| `/v1/public/futures/funding/history?currencyPair=NOPEUSDTPERP` | 400 | `{"code":-21,"message":"Unsupported Currency Pair"}` |
| `/v1/public/pairs/NOPE` | 400 | `{"code":-11,"message":"Invalid Request, please check your request and try again"}` |
| `/v1/perps/status`, `/v1/perps/pairs`, `/v1/perps/mark-prices?pairs=BTCUSDC`, `/v1/perps/orderbook/BTCUSDC`, no key | 400 | `{"code":-11268,"message":"API key header missing: X-VALR-API-KEY"}` |

Errors are cached like the route, for example `max-age=30` on the unknown pair book.

## 7. Server time and clock offset

`GET /v1/public/time` answers `{"epochTime":1790133597,"time":"2026-09-23T03:19:57.710853735Z"}`, seconds in `epochTime` and nanoseconds in `time`, P1.
Against the midpoint of each request, the server clock read 33 and 34 ms ahead on the cold calls and 1 to 4 ms ahead on the eight warm calls, P1.
The Perps v1 `status` route also returns `serverTime`, but it needs a key, S1.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
VALR cannot fill the `AnchorRow` the engine reads today, because it publishes no index.
Every other venue's poller fills `index`, and the reader divides by it for `touchPremium` and `markPremium`, at [`../../../server/src/engine/opportunity/anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 82 and 83.
The open gate itself reads the mark, through `freshPremium` at line 84, so a poller without an index is a named change to the anchor contract, not a missing gate.

| item | recommendation | reason |
|---|---|---|
| mark | `GET https://api.valr.com/v1/public/marketsummary`, `markPrice` of the four `PERP` rows | one call for all four, 175 ms median |
| interval | 3,000 ms, `intervalMs` overridden as the Bybit poller does | 20 calls a minute plus the funding call stays under the documented 30, and the 5 s cache makes a faster poll return the same numbers |
| funding | `GET https://api.valr.com/v1/public/futures/info` once every 20 rounds, about once a minute | it is cached for 60 s anyway, and `nextFundingRun` moves once an hour |
| interval column | the constant 1 | hourly, S3, and no field carries it |
| index | none, and the design has to decide how the reader treats a leg without one | section 3 |
| alternative mark | the socket's `MARK_PRICE_UPDATE`, every 3 s, on the book socket | fresher than the cached REST summary and free of the REST budget, at the cost of an anchor that is not a REST poller |
| skip | rows whose `currencyPair` does not end in `PERP`, and pairs not `active` in the catalog | the summary holds 173 spot rows |
| rate limit pause | `rateLimitPauseMs` 60,000 | the budget resets each minute and no `Retry-After` is documented |
| capped mark | the design decides whether a VALR leg whose touch sits far from its mark is refused | the mark cannot move more than 1.5 % from an index that is not published, so a capped mark cannot be told from a fresh one |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | VALR API documentation, Postman collection, sections "Public APIs", "Futures", "Perps", "Rate limiting" and "Caching" | https://docs.valr.com/ and https://docs.valr.com/api/collections/7185612/S1Lr5XDq | 2026-09-22 | VALR | routes, fields, caches, limits, error codes, sections 2 to 7 |
| S2 | VALR Perps - Technical Guide | https://support.valr.com/hc/en-us/articles/28651439052572 | 2026-09-22, updated 2026-08-27 | VALR DAM, Hyperliquid | the Perps family is out of scope, section 6 |
| S3 | Perpetual Futures Trading Guide | https://support.valr.com/hc/en-us/articles/11078306427420 | 2026-09-22, updated 2026-09-14 | VALR DAM | mark formula, 1.5 % clamp, funding, linear settlement, sections 2 to 4 |
| S4 | Index price sources | https://support.valr.com/hc/en-us/articles/12616208965532 | 2026-09-22, updated 2026-06-18 | VALR | baskets and weighting, section 4 |
| S5 | CoinGecko API, derivatives exchange `valr-futures` with tickers | https://api.coingecko.com/api/v3/derivatives/exchanges/valr-futures?include_tickers=all | 2026-09-22 | CoinGecko | the index CoinGecko shows, section 3 |
| P1 | `rest-probe.mjs catalog` at 03:19 and 03:33 UTC, plus single `curl` reads of `status`, `time`, `pairs`, `marketsummary`, `futures/info` and one book at 03:05 to 03:11 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/valr/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs anchor` at 03:21 and 03:34 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/valr/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 3 and 4 |
| P3 | `rest-probe.mjs errors` at 03:23 and 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/valr/rest-probe.mjs) | 2026-09-23 UTC | this host | section 6 |
