# Vindax REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:41 to 05:24 UTC), from the development host near Seattle, in two passes, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public spot REST API of VinDAX (no CCXT class), because Vindax lists no perpetual, see [`fees.md`](./fees.md) section 3.
The API is a Binance v1 style interface at `https://api.vindax.com/api/v1`, documented only by a 2019 page, S1.
Every number below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/vindax/rest-probe.mjs) unless it names another source.
Where the 2019 document and the wire disagree, both are written.

## 1. Host and latency from this machine

| item | value |
|---|---|
| host | `api.vindax.com`, behind Cloudflare, `server: cloudflare` and `x-powered-by: Express` |
| resolved addresses | `104.26.9.68`, `104.26.8.68`, `172.67.73.7`, and three IPv6 addresses in `2606:4700:20::`, P1 |
| exit and edge | the Cloudflare trace read `loc=CA` and `colo=YVR` on 2026-09-23 at 04:41 UTC |
| cold request, `GET /time` | 891 ms in the first pass and 2,623 ms in the second, P1 |
| warm requests, `GET /time`, 10 in a row | min 226 and 228, median 254 and 356, max 871 and 872 ms, P1 |
| `GET /exchangeInfo` | 769 and 1,230 ms, 205,884 bytes, P1 |
| `GET /ticker/24hr` for every symbol | 1,385 and 929 ms, about 226 KB, P1 |
| `GET /ticker/bookTicker` for every symbol | 12,019 and 5,788 ms, about 55 KB, P1, and 11.2 s in an earlier curl |

`socket.vindax.com` resolves to the same three IPv4 addresses.
The website `vindax.com` answers this host with a Cloudflare challenge, and the API host does not, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET https://api.vindax.com/api/v1/exchangeInfo` returns `timezone`, `serverTime`, `rateLimits`, `exchangeFilters` and a `symbols` array, P1.

| field | value on 2026-09-23 |
|---|---|
| symbols | 628 |
| `status` | `TRADING` on all 628 |
| quote asset | USDT 432, BTC 94, ETH 75, VD 27 |
| symbol spelling | base then quote in upper case, as `BTCUSDT`, on 628 of 628 |
| filters | `PRICE_FILTER` with `tickSize`, and `LOT_SIZE` with `stepSize`, as JSON numbers |
| other keys | `baseAssetPrecision`, `quotePrecision`, `icebergAllowed`, `orderTypes` `LIMIT` and `MARKET` |

The status does not separate live markets from dead ones.
`GET /ticker/24hr` without a symbol returned 628 rows, of which 103 had any quote volume, 57 had more than 10,000 USD, and 40 more than 100,000 USD, converting BTC and ETH quotes at the venue's own last price and leaving out the 27 VD pairs, P1.
The top five were BTCUSDT at 7.40 million USD, ETHUSDT at 4.21 million, DOGEUSDT at 2.66 million, XRPUSDT at 2.29 million and BNBUSDT at 2.24 million, and the sum was 41.2 million USD, in both passes, P1.
CoinGecko put the venue at 374.6 BTC of 24 h volume and counts 87 pairs, S3.
363 of 628 rows had no bid, 48 had no ask, and 25 had neither, and one row, GECUSDT, had its bid of 0.25195 above its ask of 0.22, P1.

`GET /returnTicker` keys the same 628 markets as `BTC_USDT`, with the fields `last`, `highestBid`, `lowsetAsk` (spelled so), `baseVolume`, `quoteVolume`, `high24hr`, `low24hr` and `isFrozen`, which was `0` on all 628, P1.
`GET /ticker/bookTicker` returns `symbol`, `bidPrice`, `bidQty`, `askPrice` and `askQty` as strings for all 628, P1.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no Vindax class, and neither has CCXT master, see [`fees.md`](./fees.md) section 8.
The engine builds its catalog only from CCXT `loadMarkets` filtered to active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 67 and 196 to 199, so Vindax has no catalog path today.

| engine need | Vindax |
|---|---|
| `market.id` against the socket symbol | the socket namespace is `/btcusdt` and its payload `s` is `BTCUSDT`, which equals the `exchangeInfo` symbol |
| `market.id` against an anchor symbol | no anchor exists, section 3 |
| `contractSize` against the book unit | spot, sizes in the base asset on REST and socket, so 1 |
| `linear` | not applicable, spot |
| `active` | `status` is `TRADING` on every row, so activity has to come from volume or a two-sided book |
| pairs listed twice | none: each `exchangeInfo` symbol is a distinct base and quote pair |

The price, a market's last trade, tracks the wider market for liquid pairs.
Against Gate spot last prices read in the same minute, 82 USDT pairs listed on both had a median absolute difference of 0.2 %, and 61 were within 1 %, with BTCUSDT at -0.02 %, P2.

## 3. Anchor

None.
Vindax publishes no index, no mark and no funding rate, because it lists no perpetual.
The words `index`, `funding` and `premium` appear nowhere in the `exchangeInfo`, `ticker/24hr`, `returnTicker` and `bookTicker` replies, and `mark` appears only inside the order type `MARKET`, P1.
`/api/v1/premiumIndex`, `/api/v1/fundingRate`, `/fapi/v1/premiumIndex` and `/fapi/v1/exchangeInfo` return the host's 55 byte welcome page, P2.

The reference prices it does publish are the last trade, in `GET /ticker/price`, `GET /ticker/24hr` and `GET /returnTicker`, and a `weightedAvgPrice` in `ticker/24hr`, which read `0` on BTCUSDT, P1.
None of them is an index built from other venues, so none can anchor a leg.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since section 3 found no index, mark or funding.

## 5. REST book snapshot

`GET https://api.vindax.com/api/v1/depth?symbol=BTCUSDT&limit=100`, P1.

| item | documented, S1 | probed |
|---|---|---|
| limits | 5, 10, 20, 50, 100, 500 or 1000, default 100, "max 1000" | 5, 10, 20, 50 and 100 answer. 500 and 1000 answer HTTP 400 `{"code":-1100,"msg":"Illegal characters found in parameter 'limit'; legal range is '5, 10, 20, 50, 100'."}` |
| default | 100 | without `limit`, BTCUSDT returned 80 bids and 57 asks, then 47 and 27 in the second pass, its whole book at those moments |
| weight | 1 up to 100, 5 at 500, 10 at 1000 | every call took 1 from `x-ratelimit-remaining`, section 6 |
| reply | `lastUpdateId`, `bids`, `asks`, with a hex string id in the example | `lastUpdateId` is a JSON number, as `1133728048`, and levels are `[price, size]` string pairs |
| level order | not stated | bids descending and asks ascending at every limit |
| symbol spelling | not stated | upper case only: `btcusdt` answers `-1100` "legal range is '/^[A-Z0-9_]{1,20}$/'", and `BTC_USDT` answers `-1121` `Invalid symbol.` |
| caching | not stated | two back-to-back ETHUSDT reads returned the same `lastUpdateId` and identical bodies in both passes, which a quiet quarter second explains as well as a cache would |

The `lastUpdateId` is the id space of the socket's `U` and `u`, and a book replayed from it matched a later REST book on every level whenever that later id fell on a frame boundary, see [`websocket.md`](./websocket.md) section 4.
The REST book is sometimes locked on one level: 3 of the 20 reads whose best levels the probes logged showed the same price and size as both best bid and best ask.
They were BTCUSDT `["87101.86","0.00783"]` at limit 100 in the first pass and `["86943.11","0.00983"]` at limit 10 in the second, P1, and SUIUSDT `["1.0266","102.0"]` in the second pass of the socket book run, see [`websocket.md`](./websocket.md) section 4.
The books kept from the socket for the four aligned symbols never crossed or locked after any applied frame in either pass, so the REST reply seems to catch an order in the middle of matching.
The book is thin at the touch.
The BTCUSDT limit 20 read held 348 USD on the best bid and 12 USD on the best ask in the first pass, and 5 and 12 USD in the second, P1.
Over five levels it held about 44,700 and 54,100 USD, then 770 and 58,900 USD, and over twenty levels about 212,000 and 92,000 USD, then 43,400 USD of bids against 60,900 USD on the only 12 ask levels there were, P1.

A thin book reads as such: `SCUSDT` held 20 bids and 16 asks, `BFCV2USDT` 0 bids and 13 asks, and `CZWUSDT` nothing, in both passes, P1.
`DOGECUBEUSDT` held nothing either, in a curl at 05:11 UTC.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| request budget | `exchangeInfo` `rateLimits` says `REQUEST_WEIGHT` 1200 per `MINUTE`, and the 2019 page says "Every IP can send request to API 432.000 calls (5 times * 24h * 60m * 60s ) with a frequency at once a day" and "making more than 6 calls per second to the public API ... can result in your IP being banned", S1 | headers `x-ratelimit-limit: 50`, `x-ratelimit-remaining` and `x-ratelimit-reset` in Unix seconds. The window reset 61 s after the first counted call and then refilled to 49 at once, so it is a fixed window of about 60 s, P1 |
| weight | `ticker/24hr` without a symbol weighs 40 | it took 1 from `x-ratelimit-remaining`, like every other counted call, P1 |
| uncounted calls | | `/ping` and `/time` carry no rate limit header and did not change `remaining`, P1 |
| ban | "The banned IP will be removed from the banning list after about 2 minutes to 1 days", S1 | not triggered, since the probe kept below 35 counted calls in any window |
| `Retry-After` | not stated | not seen, and no 429 was provoked |
| error shape | `{"code": -1121, "msg": "Invalid symbol."}`, S1 | the same, with HTTP 400 and `application/json` |
| missing parameter | | HTTP 400 `{"code":-1102,"msg":"Mandatory parameter 'symbol' was not sent, was empty/null, or malformed."}` |
| unknown path | | HTTP 200 with `text/html`, the 55 byte "WELCOME TO VinDAX API" page, so a wrong path looks like success to a client that does not check the content type |

The engine's anchor poller pauses on 403, 418 and 429, at [`AnchorPoller.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/anchor/AnchorPoller.ts), which is moot with no anchor.
A spot feed's REST resync would share the 50 per minute window with anything else on the same IP.

## 7. Server time and clock offset

`GET https://api.vindax.com/api/v1/time` answers `{"serverTime":1790139703746}`, integer Unix ms, P1.
Over ten reads the server ran 33 to 115 ms ahead of this host, median 44 ms, measured at the midpoint of round trips of 253 to 479 ms, P1.
The second pass read 19 to 31 ms ahead, median 28 ms, over round trips of 230 to 249 ms.

## 8. Recommended poller shape

None.
Vindax has no index, mark or funding, so there is nothing for an anchor poller to read.
If a spot design ever needs a REST call, it is the book resync in [`websocket.md`](./websocket.md) section 8, and it should avoid `ticker/bookTicker`, which took 5.8 to 12 s.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | VinDAX API Document, "Last updated: March 1, 2019", Internet Archive capture of 2019-06-07 | https://web.archive.org/web/20190607002214/https://vindax.com/public/common/views/api.html | 2026-09-23 | VinDAX | base URL, endpoints, limits, weights, depth limits, error shape, sections 5 and 6 |
| S2 | Cloudflare trace from this host | https://www.cloudflare.com/cdn-cgi/trace | 2026-09-23 04:41 UTC | this host | exit `loc=CA`, edge `YVR`, section 1 |
| S3 | CoinGecko API `exchanges/vindax` | https://api.coingecko.com/api/v3/exchanges/vindax | 2026-09-23 | CoinGecko | 374.6 BTC 24 h volume, 87 pairs, section 2 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/vindax/rest-probe.mjs) `all`, at 05:00 and 05:17 UTC | this host | 2026-09-23 UTC | this host, Canadian exit | sections 1 to 7 |
| P2 | curl of `/fapi`, `/dapi`, `premiumIndex` and `fundingRate` paths, and a comparison of Vindax `ticker/price` with Gate `spot/tickers` in one node one-liner | this host | 2026-09-23 UTC | this host, Canadian exit | sections 2 and 3 |
