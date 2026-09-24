# CoinZoom REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:21 to 04:56 UTC, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public spot REST API of CoinZoom, because CoinZoom lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): section 3 states that the venue publishes no index, mark or funding, and section 8 recommends no anchor poller.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/coinzoom/rest-probe.mjs), first run at 04:36 to 04:38 UTC and second pass at 04:44 to 04:45 UTC, with a third `latency` run at 04:52 UTC that added the Cloudflare edge and a third `errors` run at 04:55 UTC that listed the summary rows lacking a side.
CoinZoom has no CCXT class, see [`fees.md`](./fees.md) section 8, so nothing below is compared with CCXT.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| REST base, production | `https://api.coinzoom.com/api/v1/public` | S1 |
| REST base, testing | `https://api.stage.coinzoom.com/api/v1/public`, not probed | S1 |
| resolved address | `104.18.22.213`, `104.18.23.213`, `2606:4700::6812:16d5`, `2606:4700::6812:17d5`, Cloudflare | P1, three runs |
| DNS lookup | 11.7, 12.3 and 12.3 ms | P1 |
| edge | `cf-ray` ending in `YVR` on the first run and `SEA` on the second and third. `/cdn-cgi/trace` answered `colo=SEA`, `loc=CA`, HTTP/1.1, TLSv1.3 | P1 |
| cold request, `GET /marketwatch/ticker` | 177, 337.2 and 390.8 ms | P1 |
| warm requests, 10 ticker polls 2 s apart | min 83.2, median 84.6, max 85.9 ms in the first run. Min 102.1, median 103.4, max 107.4 ms in the second. Min 113.1, median 114.9, max 123.8 ms in the third | P1 |
| order book call | 130 to 595 ms over 26 reads, slower than the ticker | P2 |

Every call in this profile answered this host, which exits through Canada, with the status written beside it.
Canada is a country CoinZoom does not serve, see [`fees.md`](./fees.md) section 1, and the public API did not refuse that exit.

## 2. Catalog

### The instruments call

| call | rows | reply | fields |
|---|---|---|---|
| `GET /instruments` | 73 | 20,266 bytes in 312 and 285.7 ms | `symbol`, `baseCurrencyCode`, `termCurrencyCode`, `instrumentType`, `minTradeAmt`, `maxTradeAmt`, `maxPricePrecision`, `maxQuantityPrecision`, `supportsLeverage`, `issueOnly`, and `maxLeverage` on two rows |
| `GET /marketwatch/ticker` | 73 | 12.5 KB in 84.3 and 82.1 ms | keyed `BTC_USD`, with `isFrozen`, `base_id`, `quote_id`, `last_price`, `base_volume`, `quote_volume` |
| `GET /marketwatch/summary` | 73 | 19.1 KB in 104.7 and 86 ms | `trading_pairs`, `last_price`, `lowest_ask`, `highest_bid`, `base_volume`, `quote_volume`, `price_change_percent_24h`, `highest_price_24h`, `lowest_price_24h` |
| `GET /currencies` | 48 | 4,182 bytes | `currencyCode`, `fullName`, `canBeCollateral` |
| `GET /marketwatch/assets` | 41 | 7,395 bytes | keyed by asset, with `name`, `unified_cryptoasset_id`, `can_withdraw`, `can_deposit`, `maker_fee`, `taker_fee` |

The numbers are from P3, both runs.
Every instrument has `instrumentType` `SPOT` and `issueOnly` false.
40 pairs are quoted in USD and 33 in USDT, over 41 base assets, and 32 bases are listed against both.
The ticker lists the same 73 pairs, every one with `isFrozen` `"0"`, and 29 of them had any volume in the last 24 h.
The instruments reply has no status field, so `isFrozen` in the ticker is the only state flag.

The largest 24 h quote volumes in the first run were USDT_USD 1,321,269, USDC_USD 491,779, BTC_USD 167,933, JGGL_USD 37,730, TEKI_USDT 20,361, XRP_USD 15,487, BTC_USDT 15,313 and ETH_USDT 7,701, in the quote currency, P3.
CoinGecko reported 23.96 BTC of 24 h volume over the whole venue, see [`fees.md`](./fees.md) section 1.

S2 documents `marketwatch/summary` as a POST, but a POST with an empty JSON body got 405 and a GET got the 73 rows, in both runs of P4.

### Symbol spelling

| source | spelling |
|---|---|
| `instruments` `symbol` | `BTC/USD` |
| WebSocket `symbol`, `ob` and `oi` | `BTC/USD` |
| `marketwatch/ticker` key and `marketwatch/summary` `trading_pairs` | `BTC_USD` |
| `marketwatch/orderbook/{pair}` path | `BTC_USD`, and `btc_usd` or `BTC-USD` answer 400 |

A loader would take `rawMarketId` from `instruments` `symbol`, which is the socket's spelling, and swap `/` for `_` on the REST market watch calls.

### How CCXT maps it

It does not, because CCXT 4.5.68 and the current master have no CoinZoom class, see [`fees.md`](./fees.md) section 8.
The engine builds its catalog from CCXT `loadMarkets` filtered to active swaps, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 68, 79 and 196 to 201, so CoinZoom would need a hand written catalog even as a spot venue.

### Size unit, pairs listed twice, and price scale

Sizes are in the base asset on the REST book and on the socket, see [`websocket.md`](./websocket.md) section 4, and there is no contract size.
32 bases trade against both USD and USDT, and the engine treats USD, USDC and USDT as one settlement family, so a loader would keep one pair per base, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
No pair is quoted per 10 or per 1,000 units.
`BTC/USD` and `ETH/USD` carry `supportsLeverage` true and `maxLeverage` 5, with no margin product documented, see [`fees.md`](./fees.md) section 3.

## 3. Anchor

CoinZoom publishes no index price, no mark price and no funding rate, because it lists no perpetual.
No call in S1 or S2 returns one, and neither does any field of the five catalog calls above.

The reference prices it does publish are all taken from its own book or trades:

| field | call | meaning |
|---|---|---|
| `last_price` | `marketwatch/ticker`, `marketwatch/summary` | last trade |
| `highest_bid`, `lowest_ask` | `marketwatch/summary` | best bid and ask, null on an empty side, as `lowest_ask` was on USG_USD and USG_USDT in the third `errors` run at 04:55 UTC, P4 |
| fifth value of `ms` | WebSocket ticker | midpoint of the best bid and ask, see [`websocket.md`](./websocket.md) section 2 |

None of these is an index over other venues, so none can serve as an anchor.

## 4. Anchor semantics

Not applicable, since section 3 found no index, mark or funding.
There is no basket, no clamp and no settlement to describe.

## 5. REST book snapshot

`GET /marketwatch/orderbook/{pair}[/{depthLimit}[/{level}]]`, S2.
S2 says the default is "an unlimited level 2 order book (aggregated by price)", that a `depthLimit` of 0 means no limit, that it "should be an even positive number" split between the sides, and that `level` is 1, 2 or 3.

| path | status | bids | asks | bytes | notes |
|---|---|---|---|---|---|
| `/BTC_USD` | 200 | 107 | 15 | 1,760 and 1,761 | level 2, every level |
| `/BTC_USD/0` | 200 | 107 | 15 | 1,759 and 1,761 | the same |
| `/BTC_USD/20` | 200 | 10 | 10 | 342 and 344 | 20 split as 10 per side |
| `/BTC_USD/40/2` | 200 | 20 | 15 | 567 and 569 | the ask side had only 15 levels |
| `/BTC_USD/20/1` | 200 | 1 | 1 | 74 and 75 | the touch only |
| `/BTC_USD/0/3` | 200 | 214 | 15 | 2,894 and 2,895 | level 3, one `[price, amount]` row per order and no order id, 107 distinct bid prices in the second run |
| `/BTC_USD/7` | 200 | 3 | 3 | 134 and 135 | an odd limit rounds down per side |
| `/ETH_USD/0/2` | 200 | 36 | 21 and 20 | 853 and 838 | |
| `/BTC_USD/20/4` | 400 | | | 26 | `"Invalid order book level"` |
| `/BTC_USD/-2` | 400 | | | 0 | empty body |

The table is P2 and P4, both runs.
The reply is `{"timestamp": <Unix ms>, "bids": [[price, amount], …], "asks": [[price, amount], …]}` with numbers, bids descending and asks ascending on every read.
The level 3 book has 214 bid orders against the socket's window of 100, see [`websocket.md`](./websocket.md) section 4.

Caching: every reply carried `cf-cache-status: DYNAMIC` and no `cache-control` or `age` header.
Five reads 1.5 s apart returned five distinct `timestamp` values in both runs, and the timestamp was 69 to 390 ms old on arrival over all 26 book reads.
The socket book's top 20 levels equalled this call's on BTC/USD and ETH/USD in both WebSocket book runs, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| total | "Total requests to the API endpoints are limited to 120 RPM.", S1 | about 40 requests a minute at most, no limit reached |
| per call | `Get pairs` 12 RPM, `Get currencies` "12 RPS" as written, `Query open orders` 30 RPM, orders and ledger 60 RPM, streaming 30 RPM, S1 | not tested |
| market watch calls | no own limit listed, S1 and S2 | not tested |
| over the limit | "Repeatedly violating CoinZoom's API rate limits and/or failing to back off after receiving 429's can result in an automated IP ban.", S1 | no 429 provoked, no `Retry-After` or rate limit header on any reply |
| `User-Agent` | "Requests to the API with a missing User-Agent header will be rejected.", and it should carry the `ZoomMe:` handle, S1 | a request with no `User-Agent` got 403 and a 50,878 byte Cloudflare HTML page titled "Access denied | CoinZoom". Any `User-Agent` string was accepted, without a `ZoomMe:` handle |
| API key header | "Each API must include the HTTP header 'Coinzoom-Api-Key'", S1 | not needed on the public market watch calls, which all answered 200 without it |

Error shapes, from P4, both runs:

| request | status | body |
|---|---|---|
| `GET /marketwatch/orderbook/NOPE_USD` | 400 | the JSON string `"NOPE_USD unsupported"`, `application/json` |
| `GET /marketwatch/orderbook/btc_usd` | 400 | `"btc_usd unsupported"` |
| `GET /marketwatch/orderbook/BTC-USD` | 400 | `"BTC-USD unsupported"` |
| `GET /marketwatch/orderbook/BTC_USD/20/4` | 400 | `"Invalid order book level"` |
| `GET /marketwatch/orderbook/BTC_USD/-2` | 400 | empty |
| `GET /nope` | 404 | empty |
| `GET /time` | 404 | empty |
| `POST /marketwatch/summary` with `{}` | 405 | empty |
| `GET /marketwatch/ticker` with no `User-Agent` | 403 | Cloudflare HTML page |

A poller would treat 403 as the `User-Agent` rule first and a block second, since both come back as the same Cloudflare page.
The engine's poller pauses on 403, 418 and 429, at [`errors.ts`](../../../server/src/shared/errors.ts) line 1 and [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) lines 189 to 192, for 60 s when no `Retry-After` comes, at line 9, which would suit the documented ban risk.

## 7. Server time and clock offset

There is no server time call, and `GET /time` answered 404, P4.
The order book `timestamp` is in Unix ms and the `Date` header in whole seconds.
Over ten reads of `/marketwatch/orderbook/BTC_USD/2/1`, the book `timestamp` minus the local midpoint of the request was 216, -87, 68, -17 and -88 ms in the first run and -91, 45, 77, 68 and -106 ms in the second, with requests taking 116 to 600 ms, P5.
So the server clock sits within about 0.2 s of this host's, which is as close as the request time allows the probe to tell.

## 8. Recommended poller shape

No anchor poller.
CoinZoom has no index, mark or funding to poll, and no perpetual for the engine to trade.

If a later spot stage wants a REST cross-check of the socket books, `GET /marketwatch/summary` returns the best bid and ask of all 73 pairs in about 19 KB and 86 to 105 ms.
One read every 5 s is 12 requests a minute, a tenth of the documented total.
It must send a `User-Agent` header, and it should key rows by `trading_pairs` with `_` swapped back to `/`.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinZoom Public API, Postman documentation, collection JSON | https://api-docs.coinzoom.com/ and https://api-docs.coinzoom.com/api/collections/8443211/SW7XbVjM?segregateAuth=true&versionTag=latest | 2026-09-23 UTC | CoinZoom, Inc. | hosts, headers, rate limits, catalog calls, sections 1, 2 and 6 |
| S2 | CoinZoom Market Watch, Postman documentation, collection JSON | https://api-markets.coinzoom.com/ and https://api-markets.coinzoom.com/api/collections/8443211/T1DniJK6?segregateAuth=true&versionTag=latest | 2026-09-23 UTC | CoinZoom, Inc. | summary, ticker, assets, order book path and its depth and level rules, sections 2, 3 and 5 |
| P1 | `rest-probe.mjs latency`, runs at 04:36, 04:44 and 04:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinzoom/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | DNS, edge, cold and warm times, section 1 |
| P2 | `rest-probe.mjs book`, runs at 04:37 and 04:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinzoom/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | book variants, order, caching, timestamp age, sections 1 and 5 |
| P3 | `rest-probe.mjs catalog`, runs at 04:36 and 04:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinzoom/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | catalog calls, counts, volumes, section 2 |
| P4 | `rest-probe.mjs errors`, runs at 04:37, 04:45 and 04:55 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinzoom/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | `User-Agent` refusal, error shapes, GET and POST summary, `/time`, sections 2, 5, 6 and 7 |
| P5 | `rest-probe.mjs time`, runs at 04:38 and 04:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinzoom/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | clock offset, section 7 |
