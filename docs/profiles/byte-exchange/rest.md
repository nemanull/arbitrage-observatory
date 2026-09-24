# Byte Exchange REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:08 to 03:50 UTC, from the development host near Seattle.

This profile covers the public REST API v1 of Byte Exchange (bexc.io), which is spot only, see [`fees.md`](./fees.md) section 3.
The documentation is a Postman collection the web app renders at `https://bexc.io/api-docs`, S1.
It names seven public market data calls, and the web app calls a few more public ones, S2.
Every number below was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/byte-exchange/rest-probe.mjs) unless it names another source.

## 1. Host and latency from this machine

The documented base URL is `https://api.bexc.io/api/v1`, and the collection says `https://engine-v3.bexc.io/api/v1` "is the same origin and keeps working", S1.
The web app itself calls `https://bexc.io/api/v1`.

| host | resolved on 2026-09-23 | note |
|---|---|---|
| `api.bexc.io` | `104.21.6.100`, `172.67.134.180`, `2606:4700:3032::ac43:86b4`, `2606:4700:3037::6815:664` | Cloudflare, every reply stamped `cf-ray` `…-SEA` |
| `bexc.io`, `engine-v3.bexc.io` | the same four addresses | |
| `docs.bexc.io` | the same two IPv4 addresses | 302 to a Cloudflare Access staff login |

| measure | result |
|---|---|
| `curl -4`, five cold `/perp/status` calls | DNS 7 to 23 ms, TCP connected by 13 to 31 ms, TLS done by 29 to 47 ms, first byte at 202 to 581 ms |
| `curl` dual stack, same call | connected at 212 to 215 ms, about 200 ms later than IPv4 alone, so the IPv6 path from this host does not connect and curl falls back |
| Node `fetch` with `Connection: close`, 10 calls to `/perp/status`, two runs | min 201, median 229 and 531, max 583 and 608 ms |
| Node `fetch` warm, 20 calls to `/markets`, 449,943 bytes, two runs | min 186 and 204, median 190 and 213, max 973 and 1,343 ms |
| Node `fetch` warm, 10 calls to `https://bexc.io/api/v1/markets`, two runs | min 200 and 195, median 203 and 199, max 1,386 and 1,333 ms |
| round trip of a small warm call, 10 `/perp/status`, two runs | min 172 and 190, median 175 and 194, max 261 and 560 ms |

The Cloudflare edge is in Seattle and connects in a few milliseconds, and the remaining 170 ms or so is the trip to the origin.
The WebSocket's trade stamps arrived 81 to 86 ms after the trade by the median of three runs, which fits a one way trip of about 85 ms, see [`websocket.md`](./websocket.md) section 5.

## 2. Catalog

### The instruments call

`GET /api/v1/markets` returns `{"count": 851, "markets": [...]}`, 449,943 bytes, in both runs.

| field | value on 2026-09-23 |
|---|---|
| rows | 851, every one `"is_active": true` |
| quote assets | USDT 460, USDC 334, BTC 42, ETH 15 |
| `symbol` | `BASE_QUOTE` in capitals on all 851, always equal to `base_asset` + `_` + `quote_asset` |
| fees | `maker_fee` 0.001 on all, `taker_fee` 0.002 on 804 and 0.001 on 47, see [`fees.md`](./fees.md) section 2 |
| other keys | `allowed_buy_order_types`, `allowed_sell_order_types`, `allowed_tifs`, `force_post_only_sell`, `id`, `min_quantity`, `price_precision`, `quantity_precision`, `protected_pair` |
| special | `BEXC_USDT`, the house token, is the only `protected_pair` and the only `force_post_only_sell` market |
| bases | 472 distinct, 324 of them listed against two or more quotes |
| perpetual-like symbols | none |

No status other than active is documented or seen.
`GET /api/v1/currencies` returned 842 assets with their networks.

### How the engine's catalog would map it

There is no CCXT 4.5.68 class, so the engine's catalog cannot load this venue at all, see [`fees.md`](./fees.md) section 8.
The unmerged CCXT pull request 28769 maps `id` to `symbol`, `BTC_USDT`, and marks every market `spot`, S3.
That `id` is exactly the socket's `symbol` and the REST book's path segment, see [`websocket.md`](./websocket.md) section 3.
There is no `contractSize` and no `linear` flag, since nothing is a contract.
324 bases trade against both USDT and USDC or more, so the quote family would have to pick one market per base.

### The bulk tickers

| call | rows | bytes | fields | note |
|---|---|---|---|---|
| `GET /api/v1/ticker` | 851 | 191,237 to 191,378 | `symbol`, `base_asset`, `quote_asset`, `last_price`, `change_24h`, `high_24h`, `low_24h`, `volume_24h`, `quote_volume_24h` | no bid or ask |
| `GET /api/v1/ticker/24h` | 851 | 289,520 and 289,608 | adds `open_price`, `price_change`, `weighted_avg_price`, `trade_count_24h` | `trade_count_24h` was 0 on all 851 |

By 24 h quote volume at 03:18 UTC the top ten were `BTC_USDT` 38.8 million, `ETH_USDT` 23.1 million, `SOL_USDT` 10.7 million, `XRP_USDT`, `USDC_USDT`, `DOGE_USDT`, `NEAR_USDT`, `BTC_USDC`, `PEPE_USDT` and `UNI_USDT` 2.2 million, in the same order at 03:42 UTC.
70 markets traded over 100,000 in quote volume and 60 under 1,000, in both runs.

### The busiest books against Bybit spot

`rest-probe.mjs mirror` read the Byte REST book with a cache busting nonce and Bybit's spot book at the same instant, ten times a second apart, at 03:19 and again at 03:43 UTC.

| market | Byte mid minus Bybit mid, ppm, 03:19 | the same, 03:43 | Byte spread, ppm, 03:19 and 03:43 | Bybit spread, ppm |
|---|---|---|---|---|
| `BTC_USDT` | -45 to 47, median -43 | 48 to 222, median 93 | 1 to 4, then 21 to 234 | 1 |
| `ETH_USDT` | -146 to 183, median 60 | -176 to 306, median 191 | 7 to 87, then 176 | 4 |
| `SOL_USDT` | -321 to -153, median -237 | 119 to 360, median 203 | 231, then 136 to 174 | 84 |
| `XRP_USDT` | -469 to 657, median 282 | 216 to 1,081, median 587 | 375 to 751, then 740 to 1,483 | 62 and 63 |
| `DOGE_USDT` | 193 to 1,161, median 677 | -337 to 531, median -48 | 97 to 1,257, then 579 | 96 to 193 |

The books sit near the global price but not on it, and outside `BTC_USDT` in the first run their spread was several times Bybit's.
Almost every level holds one order, see [`websocket.md`](./websocket.md) section 4.

## 3. Anchor

The spot market publishes no index, no mark and no funding, so no `AnchorRow` can be built and no anchor poller is recommended.

The venue does publish perpetual numbers, all for the demo product or its status.

| call | status | what it carries |
|---|---|---|
| `GET /api/v1/perp/status` | 200, 643 bytes | `byte_systems.state` `operational`, `clearing_rail.state` `pending`, `price_feed` with `markets_priced` 124 and `freshness_window_secs` 60, an insurance fund of 25,000 USDT |
| `GET /api/v1/perp/disclosures` | 200, 2,901 bytes | seven texts: counterparty, auto-deleveraging, early liquidation, funding, fairness with the 5 bps taker, geo, degraded mode |
| `GET /api/v1/perp-demo/markets` | 200, 43,973 and 43,976 bytes | 124 demo markets with `current_funding_rate`, `funding_interval_secs` 3600, `mmr_bps`, `max_leverage` 100, `taker_fee_bps` 5, and `mark_source_symbol` on 2 of them |
| `GET /api/v1/perp-demo/klines` | 400 without `perp_market_id`, and `interval` must be `15m`, `1h` or `1d` | demo candles, not probed further |
| `GET /api/v1/perp/eligibility`, `/perp-demo/status` | 401 `{"code":"AUTH_REQUIRED","error":"Unauthorized"}` | |
| `GET /api/v1/perp/markets`, `/perp/ticker`, `/perp/funding`, `/perp/mark`, `/perps/status`, `/futures/markets` | 404 `{"error":"Not Found"}` | |

None of these carries a mark or an index number, and every market they list is paper.

## 4. Anchor semantics

Nothing is published to anchor a spot leg.

For the record, the perpetual disclosures describe a house book, S4.
"Your fill price is the validated mark price for the market", Byte Exchange is the counterparty on every fill, and funding "tracks the market rate for the same instrument, steepened by the balance of our own book".
The demo list names `BTC_USDT_PERP` and `ETH_USDT_PERP` as the `mark_source_symbol` of its BTC and ETH contracts, and which venue those names belong to is Not publicly specified.
No index basket, mark clamp or funding cap is published.
When a market's price feed runs behind, opening and closing pause on that market until "its next validated price lands", S4.
A real contract of this shape would have no order book for an arbitrage leg to cross, see [`fees.md`](./fees.md) section 3.

## 5. REST book snapshot

`GET /api/v1/orderbook/{symbol}` returns `{"asks": [...], "bids": [...], "last_update_id": <int>, "symbol": <id>}`, each level `{"order_count": <int>, "price": <string>, "quantity": <string>}`.

| check | result |
|---|---|
| `limit` | documented as "Depth per side (optional)", S1, and ignored in all three runs: none, 5, 20, 50, 100, 200, 1000, `abc` and 0 all returned 100 bids and 100 asks on `BTC_USDT`, 11,863 bytes |
| aggregation | documented as "L2 aggregated order book for a market", S1, yet the `ALLO_USDT` book with `last_update_id` 1712, read at 03:42 UTC and served again from the cache at 03:44 UTC, listed two bid levels at 0.3063 and two ask levels at 0.3070 |
| level order | bids descending and asks ascending on `BTC_USDT`, `ETH_USDT`, `ALLO_USDT`, `EUL_USDC` and `SUI_ETH`, apart from those repeated prices, with no inversion in three runs |
| thin books | `ALLO_USDT` 28 or 29 levels a side, `EUL_USDC` and `SUI_ETH` 28 |
| `last_update_id` | the socket's `update_id`, level by level equal at the same id, see [`websocket.md`](./websocket.md) section 4. `SUI_ETH` read 0 in every run |
| `order_count` | 1 on every level of the five books in all three runs |
| spread | `BTC_USDT` 12, 542 and 98 ppm in three runs, `ALLO_USDT` 1,623 and 1,631, `EUL_USDC` 1,253 and 903, `SUI_ETH` 1,060 and 1,514 |
| reply time | 185 to 282 ms |

### Caching

Replies carry `cache-control: public, max-age=3` and an origin cache header `x-cache-status`, while Cloudflare reports `cf-cache-status: DYNAMIC`.
The cache serves a stale entry while it revalidates, so the first plain read after a pause returns whatever the previous plain read cached.

- Eight reads of `BTC_USDT` 400 ms apart returned one id for one or two reads and a newer id for the remaining six or seven, spanning 2.0 to 2.4 s, in each of three runs, while the socket moves the id several times a second.
- `ETH_USDT` answered two plain reads about 100 s apart, in the book runs at 03:42 and 03:44 UTC, with the same `last_update_id` 359006 and the same 57 and 58 levels, while nonce reads shortly after returned 359461 and on.
- At 03:45 UTC a plain read returned 359358 marked `STALE`, and a nonce read in the same second returned 359526, 168 updates newer.
- A read with a query nonce, `?n=<ms>`, always returned `MISS` and the newest id.

So a plain REST book can be tens of seconds old, and only a nonce read is current.
The 460 ppm `ETH_USDT` spread of the second and third runs was that stale entry.

### Trades

`GET /api/v1/trades/{symbol}?limit=5` returns `{"trades": [...]}` with `price`, `quantity`, `taker_side`, `created_at` in ISO 8601 with nanoseconds, and `"buyer_fee_model":"inclusive"`.
The order and user ids in public trades are all zero UUIDs, and `sequence` is 0.
An unknown market returns 200 with `{"trades":[]}`.

## 6. Rate limits and errors

No REST rate limit is published in the documentation read, S1.
The CCXT pull request sets `'rateLimit': 34` with the comment "published limit is 30 req/s per IP / per key", S3, and maps a message `API key rate limit exceeded` to `RateLimitExceeded`.
No call in any run was refused at the probes' pace of at most five requests a second, and no reply carried a rate limit or `Retry-After` header.
The socket's limits are in [`websocket.md`](./websocket.md) section 5.

| request | status | body |
|---|---|---|
| `/orderbook/NOPE_USDT` | 404 | `{"error":"Market not found"}` |
| `/orderbook/btc_usdt` | 404 | `{"error":"Market not found"}` |
| `/orderbook/BTC-USDT` | 400 | `{"error":"Invalid symbol"}` |
| `/orderbook/BTC_USDT?limit=abc` | 200 | the full book |
| `/trades/NOPE_USDT` | 200 | `{"trades":[]}` |
| `/klines?symbol=BTC_USDT&interval=7m` | 400 | `{"error":"Invalid interval. Valid: 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M"}` |
| an unknown path | 404 | `{"error":"Not Found"}` |
| `/perp/eligibility` | 401 | `{"code":"AUTH_REQUIRED","error":"Unauthorized"}` |

Every error is JSON with an `error` string, and some add a `code`.

## 7. Server time and clock offset

There is no time call: `/time`, `/server-time`, `/ping`, `/status`, `/system/status` and `/health` all returned 404 `{"error":"Not Found"}` to curl at 03:12 UTC.

| clock source | offset from this host, 10 reads |
|---|---|
| HTTP `Date` header, whole seconds | median -534 and -388 ms in two runs, -912 to 1, which is the truncation to the second |
| `/perp/status` `as_of`, nanoseconds | median -5 and 0 ms in two runs, -11 to 182 ms, against round trips of 172 to 560 ms |

The venue's clock agrees with this host to within a few milliseconds, as far as a 170 ms round trip can tell.

## 8. Recommended poller shape

No anchor poller is recommended, because there is no index, mark or funding to poll.

If a spot reference were ever wanted, `GET /api/v1/ticker` is the only bulk call.
It returned in 170 to 313 ms, median 174 and 196, over two runs of 30 polls a second apart, 191 KB each.
Its rows changed only twice in each run, 544 rows at poll 11 and 561 at poll 21, then 557 at poll 10 and 546 at poll 20, so it refreshes every 10 s.
It carries no bid or ask, so it can neither anchor nor cross check a book.
The socket's `ticker_update` carries the same rows every 3 s, see [`websocket.md`](./websocket.md) section 2.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Byte Exchange API (V3) Postman collection, rendered by the API page | https://bexc.io/data/spot.json?v=v3 and https://bexc.io/api-docs | 2026-09-22 | Byte Exchange, global | base URLs, public calls, `limit` wording, auth scheme, sections 1, 5, 6 |
| S2 | Web app bundles that call the public perpetual endpoints | https://bexc.io/assets/perpPublic-BsOy5D6S.js and https://bexc.io/assets/ticketTheme-CIqTDYF7.js | 2026-09-22 | Byte Exchange, global | `/perp/status`, `/perp/disclosures`, `/perp-demo/*` paths, section 3 |
| S3 | CCXT pull request 28769, `ts/src/byteexchange.ts` at head `0f63de1` | https://github.com/ccxt/ccxt/pull/28769 | 2026-09-22 | CCXT | `id` mapping, spot only, rate limit comment, sections 2 and 6 |
| S4 | Perpetual disclosures endpoint | https://api.bexc.io/api/v1/perp/disclosures | 2026-09-22 | Byte Exchange, global | mark fills, funding wording, degraded mode, section 4 |
| P1 | `rest-probe.mjs latency`, `catalog`, `perp`, `book`, `poll` and `mirror` at 03:17 to 03:20 UTC, all rerun at 03:41 to 03:44 UTC, `book` again at 03:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/byte-exchange/rest-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 8 |
| P2 | curl: the time call paths at 03:12 UTC, timings at 03:21 UTC, and plain against nonce book reads at 03:44 and 03:45 UTC | none kept | 2026-09-23 UTC | this host | sections 1 and 5 |
