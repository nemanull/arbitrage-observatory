# Bitexen REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 04:53 and 05:12 UTC on 2026-09-23, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of Bitexen at `https://www.bitexen.com/api/v1/`, documented at S1.
Bitexen lists no perpetual, so this profile records the spot catalog and book per template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), and it recommends no anchor poller.
Every number was captured by [`rest-probe.mjs`](../../../scripts/probes/venues/bitexen/rest-probe.mjs) unless a source is named.
Every access result is from the Canadian VPN exit.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `www.bitexen.com`, behind Cloudflare | P1 |
| resolved addresses | `104.18.14.27`, `104.18.15.27`, `2606:4700::6812:f1b`, `2606:4700::6812:e1b` | P1 |
| Cloudflare edge | `YVR` and `SEA` in `cf-ray` | P1 |
| cold request, `GET /api/v1/ticker/` | 687 ms and 704 ms in the rerun, 384 and 385 bytes | P1 |
| warm requests, ten, 1.5 s apart | min 163, median 166, max 172 ms, and 165, 170 and 214 ms in the rerun | P1 |
| cache | `cf-cache-status: DYNAMIC` on every reply, no `cache-control` or `age` header | P1, P3 |

Access: every documented public call answered 200 to this host, and nothing asked for a login or a captcha.
`docs.bitexen.com` and the help center at `destek.bitexen.com` also answered 200.

## 2. Catalog

### The instruments call

`GET https://www.bitexen.com/api/v1/market_info/` returned one market in 606 bytes, P2.

| field | `USDTTRY` |
|---|---|
| `market_code` | `USDTTRY` |
| `base_currency`, `counter_currency` | `USDT`, `TRY` |
| `minimum_order_amount`, `maximum_order_amount` | `"50.000"`, `"1000000.000"` |
| `base_currency_decimal`, `counter_currency_decimal` | 2, 3 |
| `resell_market` | `false` |
| `maker_fee_ratio`, `taker_fee_ratio` | `"0.00150000"`, `"0.00250000"` |

No status field exists.
The list holds only markets with an order book.
`GET /api/v1/market_info/<code>/` also answers for instant buy and sell pairs, which the list leaves out, P2.

| code | `resell_market` | `minimum_order_amount` | ticker | order book |
|---|---|---|---|---|
| `BTCTRY` | `true` | `"300.0000000000000000"` | `null` | `null` |
| `ETHTRY` | `true` | `"300.0000000000000000"` | `null` | `null` |
| `BTCUSDT` | `true` | `"6.7000000000000000"` | `null` | `null` |
| `USDTTRY` | `false` | `"50.000"` | present | present |

So the active order book count is 1, quoted in TRY, and there are 0 perpetuals in any settlement asset.
CoinGecko also showed 1 pair, see [`fees.md`](./fees.md) section 3.

### How CCXT maps it

CCXT 4.5.68 has no Bitexen class, and the current master has none, see [`fees.md`](./fees.md) section 8.
There is no `market.id`, `contractSize`, `linear` or `active` to compare.
The code `USDTTRY` is the same string in `market_info`, in the ticker key, in the order book path and in the socket subscription, see [`websocket.md`](./websocket.md) section 3.
The engine's catalog keeps active swaps only, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 200, so Bitexen would contribute nothing even with a class.

## 3. Anchor

None.
Bitexen publishes no index, mark or funding, because it has no derivative.
The only reference-like numbers are the ticker's `avg_24h` and `last_price`, which are the venue's own trades and not an index.

| `AnchorRow` column | field |
|---|---|
| `index` | none |
| `mark` | none |
| `fundingRate` | none |
| `fundingIntervalHours` | none |
| `nextFundingAt` | none |

`GET /api/v1/ticker/` carries every order book market at once, which is one row here: `bid`, `ask`, `last_price`, `last_size`, `volume_24h`, `change_24h`, `low_24h`, `high_24h`, `avg_24h` and `timestamp` in Unix seconds as a string, P2.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
The sibling platform `global.bitexen.com` flags derivatives on, and its derivatives host `gmod-api.bitexen.com` answered HTTP 530 with Cloudflare error 1016, see [`fees.md`](./fees.md) section 3.

## 5. REST book snapshot

`GET https://www.bitexen.com/api/v1/order_book/USDTTRY/` takes no depth parameter, S1.

| item | value | source |
|---|---|---|
| keys | `market_code`, `ticker`, `buyers`, `sellers`, `last_transactions`, `timestamp` | P3 |
| level shape | `{"orders_total_amount": "469.64", "orders_price": "48.357"}`, size in USDT and price in TRY, both strings | P3 |
| depth | up to 50 levels per side: 50 bids with 45 asks, and 50 with 42, in the two P3 runs, and 50 with 48, 47 with 44, and 50 with 41 in the socket probe's REST reads | P3, W1 |
| level order | bids descending and asks ascending, best first | P3 |
| trades | 50 `last_transactions`, each `amount`, `price`, `time`, `type` `"B"` or `"S"` | P3 |
| size | 10,471 and 10,291 bytes | P3 |
| time over 30 polls, 2 s apart | min 188, median 238, max 824 ms, and 161, 210 and 307 ms in the rerun, all 200 | P3 |
| caching | the reply `timestamp` changed on 9 of 29 successive polls, and on 16 of 29 in the rerun. Arrival minus `timestamp` was min 104, median 6,822 and max 31,052 ms, and 272, 2,238 and 8,751 ms in the rerun | P3 |
| change rate | the top of book changed on 6 of 29 polls in both runs, and both sides were identical to the previous poll on 21 and on 14 | P3 |

The reply `timestamp` is not the time of the request.
It stayed fixed for up to 31 s while polls returned the same book, so it reads as the time the server last rebuilt the book.
A feed stamps on arrival.
The socket's last book frame equalled this call on the top 10 levels of each side, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

The documentation says: "Do not make more than 60 requests per 1 minute or you will get a rate limit error(HTTP 429).", S1.
It names no `Retry-After` header and no scope for the count.
No reply carried a rate limit header, P1.
The limit was not tested, and every probe mode stayed under 40 requests a minute.

| request | status | body | source |
|---|---|---|---|
| `order_book/NOPETRY/` | 200 | `{"status":"success","data":null}` | P4 |
| `ticker/NOPETRY/` | 200 | `{"status":"success","data":{"ticker":null}}` | P4 |
| `market_info/NOPETRY/` | 500 | empty, `text/html` | P4 |
| `order_book/BTCTRY/`, a resell market | 200 | `{"status":"success","data":null}` | P4 |
| `order_book/usdttry/`, lowercase | 200 | `{"status":"success","data":null}` | P4 |
| `order_book/USDTTRY` without the trailing slash | 404 | an HTML "Not Found" page | P4 |
| `POST ticker/` | 405 | empty | P4 |

The documentation requires the trailing slash on every path, S1.
Its error list names 400, 401, 403, 404, 405, 429, 500 and 503, and private errors carry `reason` and `status_code` in the body, S1.

## 7. Server time and clock offset

No server time call is documented, S1, and `GET /api/v1/time/` returned 404, P4.
The HTTP `Date` header minus the local clock was min −921, median −446 and max −6 ms over 30 replies, and −980, −430 and −5 ms in the rerun, P3.
`Date` has one second resolution and truncates, so that range is what a clock offset of about zero produces.

## 8. Recommended poller shape

None.
Bitexen publishes no index, mark or funding, so there is nothing for an `AnchorPoller` to read.
The engine refuses a route whose mark is 0 at open, so even a spot leg would need a different anchor source.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitexen API Reference | https://docs.bitexen.com/ | 2026-09-22 | Bitexen, Turkey | endpoints, trailing slash rule, rate limit, error codes, sections 2 to 7 |
| P1 | `rest-probe.mjs latency` at 04:57 and 05:08 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitexen/rest-probe.mjs) | 2026-09-22 | this host | section 1 |
| P2 | `rest-probe.mjs catalog` at 04:57 and 05:09 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitexen/rest-probe.mjs) | 2026-09-22 | this host | sections 2 and 3 |
| P3 | `rest-probe.mjs book` at 04:58 and 05:09 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitexen/rest-probe.mjs) | 2026-09-22 | this host | sections 1, 5 and 7 |
| P4 | `rest-probe.mjs errors` at 04:59 and 05:11 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitexen/rest-probe.mjs) | 2026-09-22 | this host | sections 6 and 7 |
| W1 | `ws-probe.mjs book`, which reads one REST book at its end | [`ws-probe.mjs`](../../../scripts/probes/venues/bitexen/ws-probe.mjs) | 2026-09-22 | this host | depth, section 5 |
