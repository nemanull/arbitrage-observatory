# Paymium REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:40 to 05:15 UTC on 2026-09-23, from the development host near Seattle through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST API of Paymium (CCXT id `paymium`) that a catalog, an anchor poller and a book seed would use.
Paymium lists no perpetual, so the plan's template change 1 applies and the market profiled is the one BTC/EUR spot book, see [`fees.md`](./fees.md) section 3.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/paymium/rest-probe.mjs), run from `server/` three times in full, at 04:56, 05:03 and 05:10 UTC, labelled P1, P2 and P3, and once in `errors` mode at 05:13 UTC, labelled P4.
Where the documentation and the wire disagree, both are written.
Access results are from the Canadian VPN exit named in the Probed line, and no public call was refused.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| REST base | `https://paymium.com/api/v1`, documented, and `https://paymium.com/api/v2`, undocumented | S1, P1 |
| resolved | `104.20.34.60`, `172.66.163.190`, `2606:4700:10::6814:223c`, `2606:4700:10::ac42:a3be`, all Cloudflare | P1 to P3 |
| edge | `CF-RAY` suffix `YVR` in P1 and P3 and `SEA` in P2, and the Cloudflare trace from this host said `loc=CA` | P1 to P3 |
| cold `GET /data/eur/ticker` | 241, 271 and 247 ms, including the TLS handshake | P1 to P3 |
| warm `GET /data/eur/depth`, 10 calls | min 367, 398, 391 ms, median 377, 438, 401 ms, max 871, 895, 947 ms | P1 to P3 |
| warm depth in the book loop, 20 calls | min 358 to 377 ms, median 370 to 394 ms, max 977 to 1,087 ms | P1 to P3 |
| warm ticker, 20 calls | min 233 to 246 ms, median 241 to 258 ms, max 290 to 445 ms | P1 to P3 |
| server time spent | `x-runtime` 0.048 to 0.058 s on depth | P1 to P3 |

The depth reply is 14.3 KB and its median is 130 to 180 ms above the 220 byte ticker's.
The `x-runtime` header says the origin spends about 50 ms, and the legal notice names ONLINE SAS in Paris as the host, so most of each call is the path between this host and Paris, which is an inference.

## 2. Catalog

### The instruments call

The documented v1 API has no instruments call.
Its public paths take a `currency` path parameter documented as `"eur"` or `"btc"`, S1.

| call | reply | probed |
|---|---|---|
| `GET /api/v2/markets`, undocumented | one row, `{"symbol":"BTC-EUR","base":"BTC","quote":"EUR","status":"running","features":[…]}` with the fee and minimum features quoted in [`fees.md`](./fees.md) | 462 bytes, P1 to P3 |
| `GET /api/v1/currencies` | 14 currencies, each with a `trading` list and a `swap` list | only `BTC/EUR` appears in any `trading` list, and 30 pairs appear in `swap` lists, P3 |

Active perpetuals by settlement asset: 0 USDT-M, 0 USDC-M, 0 coin-margined.
The `status` value seen was `running`, and the other values are Not publicly specified.

### How CCXT 4.5.68 maps it

| item | value | source |
|---|---|---|
| `loadMarkets` | returns one hard-coded market and makes no network call | `server/node_modules/ccxt/js/src/paymium.js` line 108, `base/Exchange.js` lines 1241 to 1248, P1 |
| `market.id` | `"eur"`, the v1 path parameter | `paymium.js` line 108 |
| `symbol`, `type`, `spot`, `swap` | `BTC/EUR`, `spot`, `true`, `false` | P1 |
| `linear`, `active`, `contractSize`, `taker`, `maker` | `undefined` | P1, see [`fees.md`](./fees.md) section 8 |
| `precision`, `limits` | empty objects | P1 |

The engine's connector keeps only markets with `type` `swap`, `swap` true and `active` not false, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 202.
Paymium's one market fails that filter, so the connector would log `no usable swap markets; skipping the venue` at line 51.

`market.id` `"eur"` against the socket and the anchor: the socket carries no symbol, see [`websocket.md`](./websocket.md) section 3, and there is no anchor.
The REST depth names its market `"BTC-EUR"`.
The depth path accepts `eur`, `btc` and `BTC-EUR` and returns the same book for all three, with `"market":"BTC-EUR"`, P1 to P3.

`contractSize` against the book unit: the book `amount` is BTC, and a missing contract size becomes 1 at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194, which is correct.

No pair is listed twice, since there is one pair.
Its quote is EUR, which is outside the USD, USDC and USDT settlement family of [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), so even a spot design would find no counterpart quoted in the same currency on the perpetual venues.

## 3. Anchor

Paymium publishes no index, no mark price and no funding rate, because it lists no perpetual.
No `AnchorRow` column has a source, and no anchor poller is recommended.

It does publish three reference prices.

| price | where | what it is |
|---|---|---|
| ticker `bid`, `ask`, `midpoint`, `price` | `GET /api/v1/data/eur/ticker` | the book's touch, its midpoint and the last trade, section 4 |
| v2 ticker `bestBid`, `bestAsk`, `latest` | `GET /api/v2/markets/BTC-EUR/ticker`, undocumented | the same numbers under other names, P1 to P3 |
| broker price `btceur` | the socket's `prices` object, every 10 s, see [`websocket.md`](./websocket.md) section 2 | `broker_price` and the `swap` buy and sell prices of Paymium's conversion service |

The broker price is Paymium's own quote for its conversion service, where it is the counterparty.
The terms say it "is established in real-time by Paymium based on Price data obtained from external liquidity sources (trading platforms, third-party liquidity providers)", plus a spread, S3 section 10.3.4.
No basket, weights or formula is published.
`GET /api/v1/prices` answered 404, so the broker prices were read only from the socket, P3.
In the one `btceur` entry printed, at 04:59:31 UTC, the broker `sale_price` was 76,234.52, which was the book's best bid in the P1 ticker two minutes earlier and a bid the socket deleted about 48 s later.
Whether the broker price tracks the book is Not verified beyond that one reading.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
The ticker is described here because it is the nearest thing to a reference.

| field | meaning on the wire | change over 20 polls a second apart |
|---|---|---|
| `bid`, `ask` | best bid and ask of the book | equal to the depth read just over a second earlier on 20 of 20 bids and 20 of 20 asks in P3 |
| `midpoint` | the mean of `bid` and `ask` | changed with them |
| `price`, `last` | the last trade, `75980.0` | constant, no trade in the window |
| `open`, `high`, `low`, `variation` | since the start of the UTC day: `open` 75,755.81, `high` 76,107.09 and `low` 75,755.81 equalled the first, highest and lowest of the 5 trades since 00:00 UTC, P4 | constant |
| `volume` | the trailing 24 h: 2.2427433 BTC equalled the sum of the 137 trades of the last 24 h, while the UTC day held 0.3156077 BTC, P4 | constant |
| `at` | `1790121600`, which is 2026-09-23 00:00 UTC | constant, it is the day's start and not the reading time |

In P1 the ticker's `bid` matched the depth on 20 of 20 polls and its `ask` on 15 of 20, and the misses were asks that moved between the two calls.
In P2 the string compare the probe then used failed on `"76280.0"` against `"76280.00"`, which is why P3 compares numbers.
CCXT takes the ticker's timestamp from `at`, at `paymium.js` line 235, so a CCXT ticker for Paymium is stamped with the start of the UTC day.
The documentation's socket example also shows a `vwap` field, S1, and the REST ticker carried none.

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| call | `GET https://paymium.com/api/v1/data/eur/depth` | S1 |
| depth | 200 bids and 129 to 131 asks on every one of 60 polls, down to a bid of 35,300 and up to an ask of 800,000 | P1 to P3 |
| depth parameter | none documented. `?limit=5` still returned 200 bids and 130 asks | P3 |
| shape | `{"bids":[{"price":"76166.25","amount":"0.02750500"},…],"asks":[…],"version":55484937,"market":"BTC-EUR"}`, prices and amounts as strings | P1 |
| order | bids descending and asks ascending, best first, on 60 of 60 polls | P1 to P3 |
| crossed | 0 of 60 polls | P1 to P3 |
| `version` | an undocumented integer that rose by 0 to 6, 0 to 22 and 0 to 9 between polls about 2.8 s apart, and never fell | P1 to P3 |
| caching | `cache-control: max-age=0, private, must-revalidate`, `cf-cache-status: DYNAMIC`, a weak `etag` | P1 to P3 |
| conditional read | `If-None-Match` with the last `etag` returned 304 with an empty body in 221, 223 and 230 ms | P1 to P3 |
| reply | 14,319 to 14,362 bytes | P1 to P3 |

Book state during the probes.

| run | spread at the touch | best bid notional | top 20 bid notional | touch changes between polls |
|---|---|---|---|---|
| P1, 04:57 UTC | 1,753 to 2,053 ppm | 2,095 EUR | 207,660 EUR | 3 of 19 |
| P2, 05:04 UTC | 0.13 ppm, a 10 EUR bid at 76,280.00 under an ask at 76,280.01 | 10 EUR | 207,595 EUR | 1 of 19 |
| P3, 05:11 UTC | 0.1 ppm, the same 10 EUR bid | 10 EUR | 207,595 EUR | 1 of 19 |

The venue traded 2.24 BTC in 137 trades over the 24 h before the probe, P4, and CoinGecko shows the same 2.24 BTC, S4.
`GET /api/v1/data/eur/trades` returned 1,000 trades from 2026-09-17 14:53 UTC to 2026-09-23 04:30 UTC, about 180 a day, P1 to P3.
`GET /api/v2/markets/BTC-EUR/trades` returned 500 rows, P3.
`GET /api/v1/data/eur/ohlcv?interval=1m` returned 1,440 rows from 2026-09-03 12:15 UTC to 2026-09-23 04:30 UTC, so it lists only minutes that traded, which is an inference from the span, P1 to P3.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| limit | "API calls are rate-limited by IP to 86400 calls per day (one per second on average)", with `X-RateLimit-Limit` and `X-RateLimit-Remaining`, S1 | `x-ratelimit-limit: 864000`, ten times the documented number, and `x-ratelimit-remaining` fell by one per call, from 863,965 to 863,956 over nine calls in P1 |
| limit scope | "per API key and/or IP address, depending on the endpoint", S2 section 4.2 | not reached |
| status on a limit | Not publicly specified | no limit reached in about 250 calls across the survey |
| `Retry-After` | Not publicly specified | not seen |
| error shape | HTTP 422 or 400 with `{"errors": [...]}`, S1 | `GET /data/nope/depth` gives 422 `{"errors":["Invalid currency code"]}` |
| a currency with no book | not documented | `GET /data/eth/ticker` gives 500 `{"status":500,"error":"Internal Server Error"}` after 1.7 to 2.3 s |
| unknown v1 path | not documented | 404 with the site's HTML page |
| unknown v2 path | not documented | 404 `application/problem+json`, `{"type":"about:blank","title":"Not Found","status":404}` |
| CCXT | `rateLimit` 2,000 ms | `paymium.js` line 24 |

The engine's poller pauses on 403, 418 and 429, and none was seen here.

## 7. Server time and clock offset

No server time call exists in the documentation, S1.
The `Date` header against the midpoint of each request gave offsets of -670 to +20 ms in P1, -848 to -135 ms in P2, -751 to -34 ms in P3 and -689 to +1 ms in P4, over five calls each.
The header has one second resolution, so these readings only bound the offset to about one second.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.
No anchor poller is recommended, since Paymium publishes no index, mark or funding and lists no perpetual.

If a later design wants the BTC/EUR spot book, the REST side is a book seed and a check, not an anchor.

| item | recommendation | reason |
|---|---|---|
| seed | `GET https://paymium.com/api/v1/data/eur/depth` on every socket open and every resync | the socket sends no snapshot |
| check | the same call every 60 s, comparing the top 20 levels with the kept book | the socket has no gap rule, and one call a minute is far inside the limit |
| budget | at most one call a second in total | the documented limit is 86,400 a day per IP |
| skip | `GET /api/v1/data/{other}/…` | only `eur`, `btc` and `BTC-EUR` name a book, and `eth` returns 500 |
| rate limit pause | `rateLimitPauseMs` 60,000 | no `Retry-After` is documented and the daily limit would recover slowly |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Paymium API 1.1.1 | https://paymium.github.io/api-documentation/ | 2026-09-22 | Paymium SAS | paths, parameters, error shape, rate limit, sections 2 to 7 |
| S2 | Rules of the Trading Platform, July 6, 2026 | https://paymium-public-files.s3.fr-par.scw.cloud/rules/rules_of_the_trading_platform.pdf | 2026-09-22 | Paymium SAS | rate limit scope, section 6 |
| S3 | Terms and Conditions, July 6, 2026 | https://paymium-public-files.s3.fr-par.scw.cloud/TOS/Paymium_TOS.pdf | 2026-09-22 | Paymium SAS | broker price determination, section 3 |
| S4 | CoinGecko public API, `/exchanges/paymium` | https://api.coingecko.com/api/v3/exchanges/paymium | 2026-09-22 | CoinGecko | one ticker BTC/EUR, 2.24 BTC 24 h volume, section 5 |
| S5 | CCXT 4.5.68 `paymium.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/paymium.js` | 2026-09-22 | CCXT | catalog mapping, ticker timestamp, `rateLimit`, sections 2, 4, 6 |
| P1 | `rest-probe.mjs all` at 04:56 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paymium/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | `rest-probe.mjs all` at 05:03 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/paymium/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 7 |
| P3 | `rest-probe.mjs all` at 05:10 UTC, after the probe gained the v2 trades, v1 prices and limit cases and the numeric ticker compare | [`rest-probe.mjs`](../../../scripts/probes/venues/paymium/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 7 |
| P4 | `rest-probe.mjs errors` at 05:13 UTC, after the probe gained the ticker window check | [`rest-probe.mjs`](../../../scripts/probes/venues/paymium/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 4, 5, 7 |
