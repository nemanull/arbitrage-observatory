# Gems Trade REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

Gems Trade lists no perpetuals, so this profile covers the spot catalog and the spot REST book, per change 1 of the survey plan's template.
Gems Trade publishes no API documentation that this research could find.
The routes below are Openware OpenDAX routes, found in the live web bundle and probed with [`rest-probe.py`](../../../scripts/probes/venues/gems-trade/rest-probe.py).

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| host | `www.gems.trade`, a CNAME to CloudFront `d3aw6d1wmj327d.cloudfront.net` | P1 section 1 |
| resolved addresses | `3.169.173.105`, `3.169.173.108`, `3.169.173.121` and `3.169.173.49` | P1 section 1 |
| CloudFront edge | `HIO52-P4` | P1 section 1 |
| user agent rule | HTTP 403 with CloudFront's "Request blocked" page for a bare `Mozilla/5.0` or `Python-urllib/3`, and HTTP 200 for `curl/8.14.1` or a full Firefox string | P1 section 1 |
| cold request | 528 ms and 207 ms over two runs, for `/public/timestamp` including TLS | P1 section 1 |
| warm request | median 467 ms and 463 ms over five requests on one connection | P1 section 1 |
| caching | every API reply was `Miss from cloudfront`, so each call reaches the origin | P1 sections 1 and 4 |

The 403 is a firewall rule on request headers, not a geoblock, because the same exit gets 200 once the user agent looks like a browser or `curl`.
`gems.trade` without `www` also answers 403 to a bare `Mozilla/5.0` and 200 to the Firefox string, and the blog at `blog.gems.trade`, behind Cloudflare, served a maintenance page to both, P1 section 1.

## 2. Catalog

The web bundle's config names the API bases, S1:

| base | path | probed |
|---|---|---|
| Peatio, trading | `https://www.gems.trade/api/v2/peatio` | yes |
| Barong, identity | `https://www.gems.trade/api/v2/barong` | `/identity/ping` answers `{"ping":"pong"}` |
| futures | `https://www.gems.trade/api/v2/future` | HTTP 503 `no healthy upstream` on every path tried |
| Ranger, socket | `wss://www.gems.trade/api/v2/ranger` | see [`websocket.md`](./websocket.md) |

The catalog call is `GET /api/v2/peatio/public/markets`, about 67 KB in 1.5 to 1.7 s from this host, with no paging headers, P1 section 2.
`?limit=1000` returns the same 80 rows, and `?limit=10&page=2` returns rows 11 to 20, so the default page holds at least 80 rows.

| count on 2026-10-09 | value |
|---|---|
| rows | 80, every one `state` `enabled` and `trading_enabled` true |
| quoted in USDT | 78 |
| quoted in BTC | 2, `ethbtc` and `solbtc` |
| `binance_engine` and `upstream` true | 73 |
| neither flag | 7: `gemsusdt`, `tomiusdt`, `rainusdt`, `luckusdt`, `dop2usdt`, `aviciusdt`, `rvvusdt` |
| perpetual, futures or option rows | none, and no row has a `type` field |

The `id` is always lower case base plus quote, such as `btcusdt`, and it is the stream prefix the socket uses, see [`websocket.md`](./websocket.md) section 3.
Each row carries `price_precision`, from 1 to 14 decimals, which the socket's raw book stream name needs.
Each row also carries `min_allowed` and `max_allowed`, a price band of 1 % either side of the current price, set by `min_price_percentage` and `max_price_percentage`.
CCXT has no class for this venue, see [`fees.md`](./fees.md) section 8, so there is no `market.id`, `contractSize`, `linear` or `active` mapping to check.
Book sizes are in the base currency.

## 3. Anchor

Gems Trade publishes no index, mark or funding, because it lists no perpetuals.
The futures base the bundle configures answers HTTP 503 `no healthy upstream`, and `/public/markets/btcusdt/funding_rate` answers 404, P1 section 3.
`GET /public/markets/tickers` returns all 80 markets in about 45 KB, with `last`, `open`, `high`, `low`, `total_volume` and USD conversions, P1 section 3.
Its `buy` and `sell` fields were 0 on 75 of 80 markets, so it is no source of best bid and ask.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered.
The only reference prices are the ticker's `last` and the catalog's 1 % price band.
For the 73 `upstream` markets the book follows Binance spot, see section 5.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /api/v2/peatio/public/markets/<id>/depth?limit=<n>` | P1 section 4 |
| default depth | 400 levels per side | P1 section 4 |
| largest depth | 400 levels per side for `limit=1000`, and HTTP 422 `public.market_depth.invalid_limit` for `limit=5000` | P1 section 4 |
| reply keys | `asks`, `bids` and `timestamp` in whole Unix seconds | P1 section 4 |
| level order | asks ascending, bids descending, not crossed | P1 section 4 |
| freshness | ten polls about 1 s apart showed ten distinct timestamps, and two and three distinct tops over two runs | P1 section 4 |
| caching | none seen, every reply `Miss from cloudfront` with no `Cache-Control` | P1 section 4 |
| `/public/markets/<id>/order-book` | answers `{"asks":[],"bids":[]}` | P1 section 4 |
| thin market | `gemsusdt` had 35 and 34 asks and 12 bids over two runs | P1 section 4 |

The top of book against Binance spot, read from `data-api.binance.vision` a fraction of a second later, from run 1 of P1 section 5:

| market | Gems bid and ask | Binance bid and ask | mid gap |
|---|---|---|---|
| btcusdt | 82609.7 and 82609.8 | 82598.0 and 82598.01 | +1.42 bp |
| ethusdt | 2492.53 and 2492.54 | 2492.82 and 2492.83 | -1.16 bp |
| solusdt | 109.73 and 109.74 | 109.75 and 109.76 | -1.82 bp |
| xrpusdt | 1.4048 and 1.4049 | 1.4048 and 1.4049 | 0.00 bp |

Run 2 gave mid gaps of +1.27, -0.64, 0.00 and 0.00 bp for the same four markets.
The spreads match Binance's to the tick in both runs, and the top sizes are a fraction of Binance's, for example 1,862.7 against 29,753.5 XRP on the bid in run 1.
So the `upstream` books read as a scaled copy of Binance's book, and an arbitrage reading between Gems Trade and Binance on these markets would mostly measure the copy's lag.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| published limit | none found | |
| limit headers | none on a depth reply | P1 section 6 |
| limit status | none hit at about two requests per second | P1 |
| unknown market | HTTP 422 `{"errors":["public.market.doesnt_exist"]}` | P1 section 6 |
| bad parameter | HTTP 422 `{"errors":["public.market_depth.non_integer_limit","public.market_depth.invalid_limit"]}` | P1 section 6 |
| unknown path | HTTP 404 with the plain text `404 Not Found` | P1 section 6 |
| firewall refusal | HTTP 403 HTML from CloudFront | P1 section 1 |

## 7. Server time

`GET /api/v2/peatio/public/timestamp` returns an ISO string in whole seconds, such as `"2026-10-10T04:01:17+00:00"`, P1 section 7.
The server minus the local midpoint read between -0.81 s and +0.15 s over ten calls in two runs, with medians of -0.41 s and -0.32 s, which is within the one second resolution of the reply.

## 8. Recommended poller shape

No anchor poller is recommended, because the venue publishes no index, mark or funding.
A future spot leg needs only the catalog call, refreshed every few minutes for `id`, `price_precision` and `state`, since the socket sends a full book in every frame.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | The live web bundle `https://www.gems.trade/static/js/main.8509b138.js`: the config with `REACT_APP_BASE_URL`, the API base map with `tradeUrl`, `futureUrl` and `rangerUrl`, and the calls to `public/markets/summary`, `/public/markets/<id>/depth` and `public/trading_fees` | 2026-10-09 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/gems-trade/rest-probe.py), run twice, with the `gems.trade` and blog checks of section 1 added before the second run | 2026-10-09 |
