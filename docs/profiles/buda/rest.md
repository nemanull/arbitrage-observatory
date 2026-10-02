# Buda REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:41 to 05:16 UTC, from the development host near Seattle, through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada, so every access result below is from that Canadian exit.

This profile covers the public REST API v2 of Buda, which is spot only, see [`fees.md`](./fees.md) section 3.
Buda publishes no index, mark or funding rate, so section 3 records the reference prices it does publish and recommends no anchor poller.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/buda/rest-probe.mjs) unless a source id says otherwise.
The documentation at https://api.buda.com/ answered this host with a Cloudflare challenge, so it was read from the Wayback snapshot of 2026-05-18, S1.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://www.buda.com/api/v2`, S1. A `.json` suffix is optional, and `/markets/btc-clp/order_book.json` answered like the plain path |
| resolved address | 104.16.121.50 and 104.16.122.50, plus 2606:4700::6810:7a32 and 2606:4700::6810:7932, which are Cloudflare. `realtime.buda.com` resolved to the same four |
| edge | `cf-ray` suffixes `SEA` and `YVR` on the API replies |
| `GET /markets`, first request of a process | 449 and 509 ms, 9,244 bytes |
| `GET /markets`, next five | 373 to 553 ms, and 293 to 915 ms. The server reported `x-runtime` 0.265 and 0.323 s, so the slowness is the origin and not the path |
| `GET /markets/<id>/ticker`, 26 markets | 87 to 165 ms, median 110, and 85 to 246 ms, median 93 |
| `GET /markets/<id>/volume`, 26 markets | 128 to 266 ms, median 146, and 120 to 199 ms, median 134 |
| `GET /tickers` | 711 and 90 ms, 2,991 and 2,989 bytes |
| `GET /tiers` | 126 and 112 ms |
| `GET /markets/btc-clp/order_book` | 326 and 287 ms, 18,608 and 18,548 bytes |

Each pair of numbers is the first run, at 04:52 to 04:54 UTC, then the rerun, at 05:13 to 05:15 UTC.
The public API answered every request of both runs with 200 or the 404s of section 6, and no request was refused for access.
The HTML pages of the same host, including the documentation and the fee page, answered 403 with a Cloudflare "Just a moment..." challenge, see [`fees.md`](./fees.md) section 10.

## 2. Catalog

### The instruments call

`GET /markets` returns every market in one reply, S1.

| field | example | use |
|---|---|---|
| `id` | `BTC-CLP` | identical to the socket's `mk`, and the socket channel is `id` lower cased without the dash, `btcclp` |
| `name` | `btc-clp` | the path segment of the per market calls. The path also accepted `BTC-CLP` |
| `base_currency`, `quote_currency` | `BTC`, `CLP` | |
| `minimum_order_amount` | `["0.00002", "BTC"]` | in base currency |
| `disabled`, `illiquid` | `false` | the only status fields, false on all 26 markets in both runs |
| `rpo_disabled` | `true` on `BTC-USDC` only, `false` on the other 25 | meaning Not publicly specified |
| `taker_fee`, `maker_fee` | `0.8`, `0.4` | percent, see [`fees.md`](./fees.md) section 2 |
| `max_orders_per_minute` | `100` | trading rate limit per market |
| `maker_discount_percentage`, `taker_discount_percentage`, `maker_discount_tiers`, `taker_discount_tiers` | `"0.0"`, `{}` | see [`fees.md`](./fees.md) section 5 |

The reply carries no tick size, no lot step and no price precision.

| quote | markets |
|---|---|
| CLP | `BTC-CLP`, `ETH-CLP`, `BCH-CLP`, `LTC-CLP`, `USDC-CLP`, `USDT-CLP`, `SOL-CLP` |
| COP | `BTC-COP`, `ETH-COP`, `BCH-COP`, `LTC-COP`, `USDC-COP`, `USDT-COP`, `SOL-COP` |
| PEN | `BTC-PEN`, `ETH-PEN`, `BCH-PEN`, `LTC-PEN`, `USDC-PEN`, `USDT-PEN`, `SOL-PEN` |
| BTC | `ETH-BTC`, `BCH-BTC`, `LTC-BTC` |
| USDC | `BTC-USDC`, `USDT-USDC` |

There are 26 spot markets and 0 perpetuals.
No pair is listed twice.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no Buda class, so there is no `market.id`, `contractSize`, `linear` or `active` to compare, see [`fees.md`](./fees.md) section 8.
The engine's catalog is `loadMarkets` filtered to active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 68 and 79, and the registry builds the CCXT instance at [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) line 29, so Buda would need a hand written catalog even for spot.

### Size unit and the settlement family

Sizes are base currency throughout: the book, the socket and `minimum_order_amount`.
There is no contract, so a spot leg would carry a size multiplier of 1.
Only `BTC-USDC` and the stablecoin pair `USDT-USDC` are quoted in the USD, USDC and USDT settlement family of [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), and `BTC-USDC` traded 0.0 BTC in the 24 h before each run.

| market | 24 h quote volume, first run | same, rerun | quoted spread, first run | same, rerun |
|---|---|---|---|---|
| `BTC-CLP` | 382,904,440 CLP | 387,759,863 CLP | 39.2 bps | 71.8 bps |
| `USDC-CLP` | 611,524,282 CLP | 611,552,985 CLP | 42.3 bps | 42.3 bps |
| `USDT-CLP` | 229,148,495 CLP | 229,140,365 CLP | 42.1 bps | 42.1 bps |
| `BTC-USDC` | 0 USDC | 0 USDC | 2.7 bps | 33.5 bps |
| `USDT-USDC` | 15,641 USDC | 15,641 USDC | 77.9 bps | 77.9 bps |

The volume is `bid_quote_volume_24h` plus `ask_quote_volume_24h` of `GET /markets/<id>/volume`, and the spread is `min_ask` against `max_bid` of the ticker.
At about 945 CLP per USDC, the busiest market, `USDC-CLP`, traded about 647,000 USD in the 24 h, in line with CoinGecko, see [`fees.md`](./fees.md) section 1.
Five markets, `ETH-BTC`, `BCH-BTC`, `LTC-BTC`, `BCH-PEN` and `BTC-USDC`, traded nothing.

## 3. Anchor

Buda publishes no index price, no mark price and no funding rate, S1.
There is no bulk call that carries any `AnchorRow` column, and no anchor poller is recommended.

The reference prices it does publish are these.

| call | fields | coverage | time |
|---|---|---|---|
| `GET /tickers` | `market_id`, `last_price`, `price_variation_24h`, `price_variation_7d` | all 26 markets in one reply, but no bid or ask | 90 to 711 ms |
| `GET /markets/<id>/ticker` | `last_price`, `max_bid`, `min_ask`, `volume`, `quote_volume`, `price_variation_24h`, `price_variation_7d` | one market per call | 85 to 246 ms |
| `GET /markets/<id>/volume` | bid and ask base and quote volume over 24 h and 7 d | one market per call | 120 to 266 ms |
| `GET /markets/<id>/quotations`, documented in S1 | a simulated order against the book | one market per call | not probed |

`last_price` is the last trade, and on thin markets it sat far from the book: `ETH-BTC` last 0.02995999 against a bid of 0.01833 and an ask of 0.03999999.

## 4. Anchor semantics

None of the anchor semantics apply.
With no mark, a Buda leg would read as mark 0, and the reader refuses such a route as `anchor_no_mark` at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 37 and 38, see [`fees.md`](./fees.md) section 9 for the rest of the verdict.

## 5. REST book snapshot

| item | value |
|---|---|
| call | `GET /markets/<id>/order_book`, S1 |
| reply | `{"order_book": {"asks": [[price, amount], …], "bids": […], "market_id": "BTC-CLP"}}`, prices and amounts as strings |
| depth | the whole book, 419 to 422 bids and 256 asks on `BTC-CLP`. A `limit=20` argument is ignored and still returned 421 and 419 bids |
| level order | bids descending and asks ascending on `BTC-CLP`, `BTC-USDC`, `USDC-CLP` and `LTC-COP`, 0 violations in both runs |
| id or timestamp | none, so a snapshot cannot be aligned with the socket stream, see [`websocket.md`](./websocket.md) section 4 |
| caching | `cache-control: max-age=0, private, must-revalidate`, `cf-cache-status: DYNAMIC`, a weak `etag`. The `BTC-CLP` book changed on every one of 9 polls 1.5 s apart, in both runs |
| time | 10 polls of `BTC-CLP`: 196 to 547 ms, then 206 to 398 ms |

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| unauthenticated | 120 requests per minute per IP | S1 |
| authenticated | 375 requests per minute per API key | S1 |
| windows | one minute and one second, and under 20 requests a second "no debieras gatillar el límite" | S1 |
| trading | 100 requests per minute per market below tier 7, 250 from tier 7 | S1 |
| status on a limit | 429 | S1 |
| rate limit headers | none: the replies carried no `ratelimit`, `x-ratelimit` or `retry-after` header | P1 |
| observed | never limited. The catalog mode, the densest, made at most about 55 requests in any minute | P1 |

| request | status | body |
|---|---|---|
| `GET /markets/nope-clp/order_book` | 404 | `{"message":"Not found","code":"not_found"}` |
| `GET /markets/nope-clp` | 404 | `{"message":"Not found","code":"not_found"}` |
| `GET /nope` | 404 | `{"code":"not_found","message_code":"not_found","message":"Not found"}` |
| documented example | 403 | `{"code": "forbidden", "message": "You dont have access to this resource"}`, S1 |

The documentation lists 400, 401, 403, 404, 405, 406, 410, 422, 429, 500 and 503, S1.
A future poller would pause on 429 without a `Retry-After` to read, so a pause of one minute window is the safe value.

## 7. Server time and clock offset

There is no server time call, S1.
The `Date` header has one second resolution, so the probe compared it with the local midpoint of five requests per run.
The midpoint led the header by 151 to 923 ms and 160 to 910 ms, which is inside one second, so no offset larger than the resolution exists.
The socket's `ts` has microseconds, and arrival minus `ts` had a minimum of 45 and 48 ms, see [`websocket.md`](./websocket.md) section 5.
So the local clock is at most 45 ms ahead of the venue's event clock, and the `Date` header shows it is not a whole second behind.

## 8. Recommended poller shape

None.
Buda has no index, mark or funding to poll, and the book feed is the only source a spot leg would need.
If a reference price were ever wanted, `GET /tickers` carries the last trade of all 26 markets in one call of about 3 KB, and nothing else is bulk.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Buda.com API documentation, Wayback snapshot of 2026-05-18, changelog to 9 July 2025 | https://web.archive.org/web/20260518031808/https://api.buda.com/ | 2026-09-22 | Buda.com | endpoints, fields, rate limits, error codes, sections 1 to 7 |
| S2 | live https://api.buda.com/ | https://api.buda.com/ | 2026-09-23 04:41 UTC | this host | 403 Cloudflare challenge |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/buda/rest-probe.mjs) `catalog` at 04:52 and 05:13 UTC, `book` at 04:53 and 05:15 UTC | | 2026-09-23 | this host, Canadian exit | sections 1, 2, 5, 6, 7 |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/buda/ws-probe.mjs) `book` | | 2026-09-23 | this host, Canadian exit | socket spelling of `id`, arrival minus `ts`, sections 2 and 7 |
