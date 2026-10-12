# Binibit REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:58 to 04:17 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit in Canada.

This profile covers Binibit's perpetuals, a read-only preview of 27 USDT contracts with trading disabled, see [`fees.md`](./fees.md) section 3.
Their data is not in Binibit's documented API.
The docs at docs.binibit.com describe only a "Spot Market API", S1.
The futures terminal reads every number through the site's own route `https://binibit.com/api/futures-public/<name>`, found in its page chunk, S2.
Every number below was captured by [`rest-probe.py`](../../../scripts/probes/venues/binibit/rest-probe.py) over two full runs and a third run of its `mirror` mode, unless a source id says otherwise.
The source ids are listed in section 9, and `fees.md S<n>` points at the ledger of [`fees.md`](./fees.md).

## 1. Host and latency from this machine

| host | role | resolved to | request time | source |
|---|---|---|---|---|
| `binibit.com` | web site and the `/api/futures-public` route | Vercel, `216.150.1.129` and `216.150.16.129` in one run, `216.150.1.65` and `216.150.16.65` in the other | cold 91 and 286 ms, warm 74 to 87 ms | probed `host` |
| `public-api.binibit.com` | documented spot API | `91.134.37.248`, nginx on Ubuntu | 431 to 450 ms, cold and warm alike | probed `host` |
| `internal-api.binibit.com` | documented aggregator API | `91.134.37.248` | 573 to 590 ms | probed `host` |
| `internal-api-v2stage.binibit.com` | the web app's API | Cloudflare | 681 to 1,062 ms | probed `host` |
| `sockets-v2stage.binibit.com` | the web app's SignalR hubs | Cloudflare | 550 to 854 ms | probed `host` |

- The futures route answers with `x-vercel-id` `pdx1::fra1::...`, so the edge is Portland and the function runs in Frankfurt.
- No call was refused from the Canadian exit, and no geoblock or challenge was seen on any host.

## 2. Catalog

### The instruments call

`GET https://binibit.com/api/futures-public/contracts` returns every contract in one reply.

| item | value |
|---|---|
| reply | 11,588 bytes, 343 and 392 ms cold, about 90 ms warm |
| envelope | `{"data":[...],"meta":{"source":"rest","fetchedAt":"<ISO time>"}}` |
| rows | 27, all `isActive` true |
| by settlement asset | USDT 27 |
| fields | `routeSlug`, `symbol`, `baseCurrency`, `quoteCurrency`, `isActive`, `basePricePrecision`, `quantityPrecision`, `quotePricePrecision`, `minOrderSize`, `lotSize`, `lotStep`, `contractValue`, `makerFeeRate`, `takerFeeRate`, `maxLeverage`, `fundingRate`, `fundingStartsAt`, `fundingFinishesAt` |
| `contractValue` | 1 on all 27 |
| `maxLeverage` | 20 on 26, 15 on ETHUSDT |
| duplicate symbols | none |
| symbols | AAVE, ADA, APT, ARB, ATOM, AVAX, BCH, BNB, BTC, DOGE, DOT, ETC, ETH, FIL, HBAR, LINK, LTC, NEAR, ONDO, OP, SOL, SUI, TRX, UNI, WLD, XLM and XRP, each against USDT |

- `symbol` is Bybit's spelling, such as `BTCUSDT`, and `routeSlug` is `BTC_USDT`, equal to `<base>_<quote>` on 27 of 27.
  The data routes take `symbol` only, and `BTC_USDT` or `btcusdt` answer HTTP 400, section 6.
- `GET /api/futures-public/settings` returns `{"maxFuturesAccountsCount":15,"maxLeverage":100,"availableAccountCurrencies":["USDT"]}`.
  The menu's "×100" matches that `maxLeverage`, while no contract allows more than 20.
- CoinMarketCap lists 0 perpetual pairs for Binibit, `fees.md S8`.

### How the engine's catalog would map it

There is no CCXT class, so there is no `market.id`, `contractSize` or `linear` flag to compare, [`fees.md`](./fees.md) section 8.
`contractValue` 1 and book quantities that match Bybit's base coin sizes, section 5, mean sizes are in base coin.
All 27 contracts are linear USDT perpetuals that also exist on Bybit under the same symbol.

## 3. Anchor

There is no index or mark price anywhere on the futures route.
The ticker carries `last`, `price24hAgo`, `priceChangePercent`, `volume24h`, `low24h` and `high24h` only, and the contracts call names neither "mark" nor "index".
Five guessed routes, `mark-price`, `index-price`, `funding`, `funding-rate` and `premium-index`, answered the site's HTML 404 page.

Funding is in the contracts call, one row per contract, every 60 s in the terminal, S2.

| `AnchorRow` column | field | note |
|---|---|---|
| index | none | not published |
| mark | none | not published |
| funding rate | `fundingRate` | a decimal string fraction, such as `"-0.00001773"` |
| interval | `fundingFinishesAt` minus `fundingStartsAt` | 8 h on 26 contracts, 4 h on ONDOUSDT |
| next settlement | `fundingFinishesAt` | ISO 8601 in UTC, such as `2026-10-10T08:00:00.000Z` |

An anchor poller could fill three of the five columns, and the index and mark it cannot fill are not published anywhere.

## 4. Anchor semantics

- No index formula, mark formula, funding formula or cap is published, `fees.md S11`.
- The funding schedule is Bybit's, and the rate is near Bybit's but refreshed rarely.
  Against Bybit's `/v5/market/tickers?category=linear` taken in the same second, the rate was equal on 11, 10 and 9 of 27 contracts over three reads.
  The equal ones were the contracts at Bybit's 0.0001 rate, such as ADAUSDT, DOTUSDT and OPUSDT, and ONDOUSDT in the first read.
  BTCUSDT showed -0.00001773 from 04:01 to 04:16 UTC, while Bybit's estimate moved from -0.00001154 to -0.00000695.
  It is not Bybit's last settled rate either, which was -0.00001182 at 00:00 UTC by Bybit's funding history.
  The window equalled Bybit's `fundingIntervalHour` and the next settlement equalled Bybit's `nextFundingTime` on every contract except ONDOUSDT, whose fields went stale, as the next point shows.
- The funding fields go stale and flip between replies.
  At 04:01 UTC, after the 04:00 settlement had passed, ONDOUSDT still showed `fundingFinishesAt` 04:00 while Bybit showed 08:00.
  At 04:10 every contract showed 08:00, and replies at 04:12 and 04:16 showed ONDOUSDT at 04:00 again.
- Over 60 s of polls every 5 s, the contracts reply carried 2 distinct `fetchedAt` values and the BTCUSDT and ETHUSDT rates did not change.
  So the route caches the contracts list for tens of seconds.
- Whether the published rate is the upcoming one or the last settled one is not stated, and the instant of a settlement was not captured.

## 5. REST book snapshot

`GET https://binibit.com/api/futures-public/orderbook?symbol=BTCUSDT&depth=50` is the terminal's book call, S2.

| item | value |
|---|---|
| reply | `{"data":{"symbol":"BTCUSDT","asks":[{"price":"82560.2","quantity":"5.766"},...],"bids":[...]},"meta":{...}}`, decimal strings |
| depth | 1 to 50 levels a side, `depth=51` returns 50, no `depth` returns 50, and 200 or 1000 answer HTTP 400 |
| size at depth 50 | 3,970 and 3,984 bytes in 241 and 282 ms |
| level order | bids descending and asks ascending, best first, on every reply |
| crossed | never |
| caching | `Cache-Control: public, max-age=0` and `x-vercel-cache: MISS` |
| freshness | 13 distinct `fetchedAt` values in 15 polls 2 s apart, with the top of book changing 10 times |

### The book is Bybit's

Read in the same second, Binibit's tops mostly had Bybit's best bid and ask prices exactly, with quantities that differ the way a book a moment older would.

| time UTC | symbol | Binibit bid, ask | Bybit bid, ask |
|---|---|---|---|
| 04:01:55 | BTCUSDT | 82596.7 x 11.321, 82596.8 x 1.751 | 82596.70 x 11.347, 82596.80 x 1.012 |
| 04:01:57 | ETHUSDT | 2492.33 x 251.76, 2492.34 x 30.54 | 2492.33 x 254.65, 2492.34 x 12.13 |
| 04:10:17 | BTCUSDT | 82647 x 3.672, 82647.1 x 5.557 | 82647.00 x 3.667, 82647.10 x 5.557 |
| 04:10:19 | ETHUSDT | 2492.88 x 18.67, 2492.89 x 107.66 | 2492.88 x 17.28, 2492.89 x 107.40 |
| 04:01:58 | SOLUSDT | 109.74, 109.75 | 109.760, 109.770 |
| 04:10:20 | SOLUSDT | 109.8 x 240.6, 109.81 x 615.3 | 109.800 x 240.1, 109.810 x 724.3 |
| 04:16:08 | BTCUSDT | 82646.7 x 7.58, 82646.8 x 4.123 | 82646.70 x 5.206, 82646.80 x 5.799 |
| 04:16:09 | ETHUSDT | 2492.71, 2492.72 | 2493.08, 2493.09 |

- SOLUSDT at 04:01 and ETHUSDT at 04:16 were behind Bybit's price, which reads as a snapshot taken a moment earlier.
- The ticker's `volume24h` matched Bybit's BTCUSDT `turnover24h` within 0.1 %, 3,222,062,692 against 3,224,525,539, and `high24h` 83496.93 against Bybit's 83497.00.
- At 04:16 the BTCUSDT top was 82646.7 and 82646.8 on Binibit and Bybit, 82650.00 and 82650.10 on Binance, and 82654.6 and 82654.7 on OKX.

No trade is matched on this book, because futures trading is disabled, `fees.md S2`.

## 6. Rate limits and errors

- No limit is published for `/api/futures-public`.
  The docs set 60 requests a minute and 10 a second per IP for the spot API, with `X-RateLimit-*` headers on every reply and `Retry-After` on HTTP 429, S1.
  The spot API sent no `X-RateLimit-*` header on any reply in either run, so the wire disagrees with the docs.
- No 429 was provoked, with calls at least 1 s apart and the poll modes at one call every 2 s and 5 s.

| request | status | body |
|---|---|---|
| unknown symbol `FOOUSDT` | 400, `Cache-Control: no-store` | `{"error":{"code":"INVALID_REQUEST","message":"The Futures public data request is invalid."}}` |
| `symbol=BTC_USDT`, `symbol=btcusdt`, no symbol, `depth=200` | 400 | the same body |
| unknown route `/api/futures-public/nosuchroute` | 404 | the site's HTML not found page |
| `/api/futures-private` and `/api/futures-private/trading` with GET | 404 | the site's HTML not found page |

## 7. Server time and clock offset

There is no server time call, and the docs list `GET /api/time` as planned, S1.
The `Date` header of an uncached book reply was +0.17 s from the local clock at its 1 s resolution, and `meta.fetchedAt` agreed with it.
The spot API's `Date` was +0.33 s and -0.25 s from it over two runs.
The settings reply is served from the Vercel cache with `x-vercel-cache: HIT`, `age` 163 and its original `Date`, so a cached reply's `Date` is not a clock.

## 8. Recommended poller shape

No poller is recommended.
The perpetuals take no orders, the route publishes no index or mark, its funding is Bybit's with lag and stale flips, and its book is Bybit's book.
If Binibit enables futures trading, the question to answer first is whether its orders execute against Bybit, and the engine's Bybit legs already carry these prices.

### Spot, for the coverage matrix

- The documented spot API on `public-api.binibit.com` reports `"PublicApi v1.0.17.0"` at `/api/healthcheck`, but `/api/currencies/pairs` answered HTTP 500 with an empty body and `/api/currencies/commissions` answered `[]`.
- `/api/orderbook?currencyPairCode=BTC_USDT` returned 100 bid levels and 0 asks, with a best bid of 81437.13 while the market was near 82,600, so that book is stale.
- On the aggregator host, `/pairs` returned 100 pairs and `/tickers` answered HTTP 500.
- The web app reads its spot data from `internal-api-v2stage.binibit.com` and `sockets-v2stage.binibit.com` instead, [`websocket.md`](./websocket.md) section 1.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | Binibit API docs, `https://docs.binibit.com/llms.txt`, with `general/base-url.md`, `general/rate-limits.md`, `general/errors.md`, `api-reference/introduction.md`, `faq.md` and `changelog.md` | 2026-10-09 |
| S2 | futures page chunk, `https://binibit.com/_next/static/chunks/app/futures/%5Bpair%5D/page-536bcc3f24210dec.js` | 2026-10-09 |
| S3 | Bybit V5 public market data, `https://api.bybit.com/v5/market/orderbook` and `https://api.bybit.com/v5/market/tickers`, category linear | 2026-10-09 |
