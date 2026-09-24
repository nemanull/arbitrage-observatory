# Bitexlive REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:23 to 04:53 UTC on 2026-09-23, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of Bitexlive on its spot market, because the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
The API page documents four public calls, `currencies`, `tickers`, `recentTrades` and `orderBook`, under `https://prod.bitexlive.com/api/public`, S1.
Every number below was measured by [`rest-probe.mjs`](../../../scripts/probes/venues/bitexlive/rest-probe.mjs) unless a source row is named.
Where the documentation and the wire disagree, both are written.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| API host | `prod.bitexlive.com`, behind Cloudflare, `server: cloudflare`, `cf-cache-status: DYNAMIC`, `cache-control: no-cache, private` | P1 `host` |
| resolved addresses | `172.67.177.15`, `104.21.17.155`, `2606:4700:3033::ac43:b10f`, `2606:4700:3037::6815:119b`, the same four for `bitexlive.com` and `wss.bitexlive.com` | P1 `host` |
| egress | Cloudflare trace `loc=CA`, edge `SEA` for `prod.bitexlive.com` and `YVR` for `wss.bitexlive.com`, through the Canadian VPN exit | `curl https://prod.bitexlive.com/cdn-cgi/trace` at 04:40 UTC |
| origin | the site sends `x-powered-by: PHP/8.4.3` and sets a `bitexprod_session` cookie, a Laravel application | P1, headers of `https://bitexlive.com/` |
| cold request | `GET /tickers`, 1,527 ms and 1,458 ms in the rerun, about 5.5 KB | P1 `host` |
| warm request | `GET /orderBook?filter=BTC_USDT&limit=5`, 10 reads one second apart: min 215, median 224, max 493 ms, and 217, 222 and 239 ms in the rerun | P1 `host` |
| `GET /tickers` over 150 s | 66 reads at a 2 s target: min 951, median 1,400, p90 3,055, max 7,818 ms. The rerun made 74 reads: min 814, median 1,095, p90 2,056, max 2,521 ms | P1 `poll` |

No call was refused.
Every documented call answered 200 from this host, and the answers are from the Canadian VPN exit, not from a US address.
The ticker call is slow.
Its median of 1,095 to 1,400 ms is five to six times the order book's 222 to 224 ms, and one read in ten took over 2 s.

## 2. Catalog

### The instruments call

No instruments call exists.
The API page documents no markets or symbols call, and `GET /api/public/markets`, `/symbols` and `/time` answered 404 with an HTML page to `curl` at 04:25 UTC, and the probe's unknown path read the same, P1 `book`.
The catalog is the ticker list.

| call | reply | rows | fields |
|---|---|---|---|
| `GET /api/public/tickers` | JSON array, 5,539 to 5,542 bytes | 21 | `tradingPairs`, `LastPrice`, `percentChange`, `low24h`, `high24h`, `baseVolume24h`, `quoteVolume24h`, `lowestAsk`, `highestBid`, `lastUpdateTimestamp`, `tradesEnabled` |
| `GET /api/public/tickers?filter=BTC_USDT` | one row | 1 | same |
| `GET /api/public/currencies` | JSON array, 5,045 bytes | 22 | `symbol`, `name`, `isFiat`, `canDeposit`, `depositConfirmationCount`, `minDeposit`, `canWithdraw`, `minWithdrawal`, `maxWithdrawal`, `lastUpdateTimestamp` |

At 04:31 and 04:44 UTC on 2026-09-23 all 21 pairs were quoted in USDT, all had `tradesEnabled` true, and none had a null bid or ask, P1 `catalog`.
The documented field names differ from the wire: S1 names `lowDay`, `highDay`, `baseVolumeDay` and `quoteVolumeDay`, and the wire sends `low24h`, `high24h`, `baseVolume24h` and `quoteVolume24h`.
Deposits were closed on 10 of 22 currencies and withdrawals on 3, `USDF`, `SOL` and `VIT`, P1 `catalog`.

The two volume fields are swapped on the wire.
`BTC_USDT` read `baseVolume24h` 2,148,731 and `quoteVolume24h` 19.555 at 04:31 UTC, and 2,174,344 and 19.775 at 04:44 UTC, so the base field carries USDT and the quote field carries BTC, P1 `catalog`.
The trade call swaps the same pair of fields, section 5.

### How CCXT maps it

CCXT 4.5.68 has no class for the venue, and CCXT master has none either, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare.
The symbol a feed would use is `tradingPairs`, spelled `BTC_USDT`.
It is the `filter` value of `orderBook` and `recentTrades`, and it is the `market.title` inside every socket book frame, see [`websocket.md`](./websocket.md) section 4.
The socket channel is named by a market UUID instead, which only the exchange page publishes.
`window.pageData.pairs` on `https://bitexlive.com/exchange/BTC_USDT` listed the same 21 pairs as the ticker call, each with `id`, `title`, `price_decimals` and `amount_decimals`, P1 `catalog`.
No pair is listed twice, and no pair is a contract, so no size unit or price scale applies.

### Crossed tickers

At 04:31:22 UTC 6 of 21 tickers had `highestBid` at or above `lowestAsk`, and at 04:44:37 UTC 5 of 21 did, the same pairs without `XRP_USDT`, P1 `catalog`.

| pair | highestBid | lowestAsk |
|---|---|---|
| `ZRX_USDT` | 0.1252 | 0.06 |
| `BTXK_USDT` | 0.00966 | 0.002 |
| `APTM_USDT` | 0.24 | 0.08585 |
| `XRP_USDT` | 1.6487 | 1.6445 |
| `USDC_USDT` | 1.0007 | 1.0001 |
| `ETH_USDT` | 2784.63 | 2359.9 |

The `ETH_USDT` ask at 2359.9 sat about 15 % under the bid in every read from 04:25 to 04:47 UTC, P1 and P2, and CoinGecko showed the same ticker at 04:23 UTC with a bid and ask spread of -17.7 %, S3.
A matching engine would have filled it, so the published book is not a book a taker can cross, see [`websocket.md`](./websocket.md) section 4.

## 3. Anchor

The venue publishes no index price, no mark price and no funding rate, because it lists no perpetual, see [`fees.md`](./fees.md) section 3.
No call carries any `AnchorRow` column.
The only reference prices are the ticker's `LastPrice` and the socket's `market_data.updated` `last_price`, which are the venue's own last trade.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
How often the ticker changed is recorded instead, from two runs of `GET /tickers` every 2 s for 150 s, 66 reads from 04:32:14 UTC and 74 reads from 04:49:46 UTC, P1 `poll`.

| field | changes per pair in 150 s, first run | rerun |
|---|---|---|
| `highestBid` or `lowestAsk` | 2 to 5 | 2 to 9 |
| `lastUpdateTimestamp` | 3 or 4 | 6 |
| `LastPrice` | 0 to 3 | 0 to 3 |

`BTC_USDT` showed `lastUpdateTimestamp` values 9 to 52 s apart, and each was first read 1.8 to 6.2 s after the second it names, leaving aside the first value of each run.
The order book behind the ticker steps once per socket sweep, every 50 to 52 s, see [`websocket.md`](./websocket.md) section 4.
The timestamp is spelled `2026-09-23 04:32:04` with no zone, and it is UTC.

## 5. REST book snapshot

`GET /api/public/orderBook?filter=<pair>&limit=<n>` returns `{"LastUpdateTimestamp": <Unix s>, "bids": [[price, size], …], "asks": [[price, size], …]}`, S1.

| `limit` | documented | bids and asks on the wire, `BTC_USDT`, 04:31 UTC | rerun, 04:44 UTC |
|---|---|---|---|
| none | default 5 | 102 and 99, 6,480 bytes | 181 and 179, 11,568 bytes |
| 5 | | 5 and 5, 372 bytes | 5 and 5 |
| 50 | the documented maximum | 50 and 50, 3,252 bytes | 50 and 50 |
| 51 | above the maximum | 51 and 51 | 51 and 51 |
| 100 | above the maximum | 100 and 99 | 100 and 100 |
| 0 | | 102 and 99 | 101 and 100 |

The documented default of 5 and maximum of 50 do not hold on the wire.
Without a limit, or with 0, the call returned about 100 to 180 levels per side, P1 `book`.

| item | documented | probed |
|---|---|---|
| bid order | "sorted by price from highest to lowest" | descending, best first, at every limit |
| ask order | "sorted by price from lowest to highest" | descending, so the best ask is the last element, at every limit |
| number format | the example shows the price as a string and the size as a JSON number | both are strings with 8 decimals, and some prices carry a float artefact such as `"87233.50999999"` |
| `LastUpdateTimestamp` | "The UTC date and time of the trade execution." | Unix seconds equal to the reply's `Date` header on every read, so it is the reply time, not a book time, section 7 |
| caching | not documented | `cache-control: no-cache, private` and `cf-cache-status: DYNAMIC`, yet the top of book moved only within a few seconds of each socket sweep, see [`websocket.md`](./websocket.md) section 4 |

A reader must take the best ask as the minimum over `asks`, never `asks[0]`.
At 04:31 and 04:44 UTC `ETH_USDT` had 1 ask below its best bid and `ZRX_USDT` had 2, P1 `book`.
`BTC_USDT` and `LTC_USDT` were not crossed at those reads.
The REST sizes equalled the socket's `amount` within 1 % on 44 of 44 levels in each of three comparisons, so both carry the same rounded size, P2, see [`websocket.md`](./websocket.md) section 4.

The `BTC_USDT` book is also crossed for a few seconds in each refresh, because one side moves before the other.
Of 59 REST reads taken every 5 s beside the socket, 6 had the best bid above the best ask, one read in each of the six sweeps they spanned, P2.
At 11.4 s into the rerun the bid read 87,169.48 and the lowest ask 87,122.01, and 5 s later the bid had followed to 87,121.99.

The trade call is `GET /api/public/recentTrades?filter=<pair>&limit=<n>`, whose documented maximum is 50, S1.
`limit=100` returned 100 rows, P1 `trades`.
The 50 newest `BTC_USDT` rows held 25 distinct `tradeID` values at 04:32 UTC and 27 at 04:45 UTC, most printed once as `buy` and once as `sell`, and every `tradeID` equalled the Unix second of its `time`.
The gaps between consecutive trades were 48 to 52 s, apart from two gaps of 1 s in the rerun, and each trade was worth 1 to 13 USDT.
`baseVolume` carries the USDT amount and `quoteVolume` the BTC amount: `1.40287494` at price 87135.09 is 0.0000161 BTC, and `quoteVolume` read `0.0000161`.

## 6. Rate limits and errors

No rate limit is published, S1.
No reply carried a rate limit header or `Retry-After`, and no 429 or 403 was seen, with requests sent one at a time and every loop paced at one call per 1 to 2 s, P1.
The probe never went faster, so the limit itself is Not verified.

| request | status | content type | body |
|---|---|---|---|
| `orderBook?filter=NOPE_USDT` | 200 | `application/json` | `{"bids":null,"asks":null}` |
| `orderBook?filter=btc_usdt&limit=2` | 200 | `application/json` | the `BTC_USDT` book, so the filter ignores case |
| `orderBook?filter=BTC/USDT&limit=2` | 200 | `application/json` | `{"bids":null,"asks":null}` |
| `orderBook` without `filter` | 200 | `text/html; charset=utf-8` | `{"errorDescription":"Parameter 'filter' contains invalid value."}` |
| `recentTrades?filter=NOPE_USDT` | 200 | `text/html; charset=utf-8` | `{"errorDescription":"Parameter 'filter' contains invalid value."}` |
| `/api/public/nope` | 404 | `text/html; charset=utf-8` | a 3,484 byte HTML page |

An error never changes the status code, so a client has to read the body.

## 7. Server time and clock offset

No server time call exists, and `/api/public/time` answered 404 to `curl` at 04:25 UTC.
The order book's `LastUpdateTimestamp` and the `Date` header are both whole seconds, and on 9 of 10 reads in each run they named the same second, and on the tenth they were one second apart, P1 `host`.
Against the midpoint of each request on this host, the stamps read offsets of -972 to +35 ms, and -967 to +33 ms in the rerun.
That spread is what a whole second stamp gives over a 220 ms round trip, and it is consistent with a server clock within about 0.15 s of this host.
A finer offset cannot be measured from this API.

## 8. Recommended poller shape

None.
The engine's anchor poller needs an index, a mark and a funding rate per perpetual, and this venue publishes none of them, section 3.
The engine's catalog also needs an active swap market from CCXT, and there is neither a swap nor a CCXT class, see [`fees.md`](./fees.md) section 9.

If a spot reader were ever wanted, one `GET /api/public/tickers` every few seconds would carry every pair's top of book.
Its median reply of 1,095 to 1,400 ms and its crossed quotes make it a poor source, sections 1 and 2.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitexlive API | https://bitexlive.com/api | 2026-09-23 UTC | Bitexlive, global | public calls, field names, documented limits and order, sections 2, 5, 6 |
| S2 | Bitexlive exchange page with `window.pageData` | https://bitexlive.com/exchange/BTC_USDT | 2026-09-23 UTC | Bitexlive | pair UUIDs and decimals, section 2 |
| S3 | CoinGecko exchange record `bitexlive` | https://api.coingecko.com/api/v3/exchanges/bitexlive | 2026-09-23 UTC | CoinGecko | the `ETH_USDT` ticker's negative spread, section 2 |
| P1 | `rest-probe.mjs` modes `ccxt`, `host`, `catalog`, `book`, `trades`, `poll`, first runs 04:31 to 04:35 UTC and reruns 04:44 to 04:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitexlive/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | `ws-probe.mjs book` at 04:28, 04:34 and 04:45 UTC, REST order book reads every 5 s beside the socket and one after each `BTC_USDT` frame | [`ws-probe.mjs`](../../../scripts/probes/venues/bitexlive/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 2 and 5 |
