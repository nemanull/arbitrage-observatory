# Bilaxy REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:43 to 05:10 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare loc=CA, SEA edge).

This profile covers the public REST API of Bilaxy, which has no CCXT class, on its spot market, because Bilaxy lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bilaxy/rest-probe.mjs), run from `server/`.
Where the documentation and the wire disagree, both are written, and the wire is what a client must handle.
The documentation is `restapi.md` in the official repository `bilaxy-exchange/bilaxy-api-docs`, S1, whose last dated change is 2020-12-12, S2.
Every access result comes from the Canadian VPN exit.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| base URL | `https://newapi.bilaxy.com`, S1 | |
| resolved address | four CloudFront IPv4 addresses, 18.172.170.50, .52, .89 and .109, and eight IPv6 addresses in `2600:9000:24ec::/48`. `newapi`, `api` and `www` are CNAMEs of `d29qb9owyakbch.cloudfront.net` | `rest-probe.mjs host`, and `dig` at 04:43 UTC |
| edge | `x-amz-cf-pop: SEA73-P3`, `x-cache: Miss from cloudfront` on every reply, and `server: nginx` from the origin | same |
| cold request | `GET /health` 299, 317 and 323 ms in three runs | same |
| warm requests | bimodal: 81 to 99 ms or 206 to 277 ms. Ten requests at 04:56 UTC gave 208, 85, 211, 274, 83, 209, 82, 81, 88 and 88 ms, and ten at 05:02 UTC gave 209, 85, 207, 99, 207, 208, 206, 210, 81 and 271 ms | same |
| request without a `User-Agent` | HTTP 403 from CloudFront, `x-cache: Error from cloudfront`, title "403 ERROR", on `newapi.bilaxy.com/health` and on `bilaxy.com/`. Any value works, curl sent `x` and got 200 | `rest-probe.mjs host` with `node:https`, and curl with `-A ''` and `-A x` at 04:44 UTC |
| Node `fetch` with no headers | 200, because `fetch` sends a default `User-Agent`. [`AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) line 225 uses `fetch`, so a REST poller would pass | `rest-probe.mjs host` |
| old API host | `https://api.bilaxy.com/v1/ticker?symbol=1` and `/v1/coins` answer HTTP 502 from nginx | `rest-probe.mjs host`. The old API is documented at `https://api.bilaxy.com`, S3 |

## 2. Catalog

### The instruments call

`GET /v1/pairs` returns one object keyed by pair name, 204 rows and 53,471 bytes, in 123 and 132 ms in two runs.

| field | example | note |
|---|---|---|
| key | `BTC_USDT` | always `<base>_<quote>`, on 204 of 204 rows |
| `pair_id` | `113` | the id the WebSocket takes as `symbol`. 203 distinct ids over 204 rows: `GAMMA_ETH` and `VISR_ETH` share 1296 |
| `base`, `quote` | `BTC`, `USDT` | |
| `price_precision`, `amount_precision` | `2`, `5` | decimal places |
| `min_amount`, `max_amount`, `min_total`, `max_total` | `"0.000000000000000"`, `"-1.000000000000000"`, `"5.000000000000000"`, `"-1.000000000000000"` | strings. The document shows `"+∞"` for no maximum, S1, and the wire sends `-1` |
| `trade_enabled` | `true` | 96 of 204 |
| `closed` | `false` | `false` on all 204, so it marks nothing |

| quote | trade-enabled | disabled |
|---|---:|---:|
| ETH | 85 | 55 |
| USDT | 11 | 6 |
| BNB | 0 | 45 |
| BTC | 0 | 1 |
| USDC | 0 | 1 |

`GET /v1/pairs?pair=NOPE_USDT` answers 404 `{"code":404,"msg":"Not found pair.","detail":null}`.

`GET /v1/ticker/24hr` returns 202 rows in about 33,770 bytes, with `height` for the high, `open`, `low`, `close`, `base_volume`, `quote_volume`, `price_change` and `trade_enabled`.
`RE_ETH` and `XNK_ETH` are in the pairs reply and not in the ticker reply.
One of `GAMMA_ETH` and `VISR_ETH`, which share an id, carries a `trade_enabled` in the ticker that differs from the pairs reply, and which one changed between runs.
40 to 42 of the trade-enabled rows show zero 24 h volume.

Valued at the `ETH_USDT` close, the 24 h volume was about 15.8 million USDT at 05:02 UTC, and `BTC_USDT` and `ETH_USDT` were 87.7 % of it, the same share as in the run before.
`CRV_ETH` was next at about 234,000 USDT, and the ETH-quoted pairs together about 1.67 million.
The 24 h numbers are not trustworthy.
`DOT_USDT` shows 141,010.64 DOT of 24 h volume, while its last trade in `GET /v1/trades` is dated 2026-06-11 17:33 UTC and its book has no bids, see [`websocket.md`](./websocket.md) section 4.

### How a catalog would map it

There is no CCXT class, so nothing maps it today, and the connector's swap filter at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 202 would find no market in any case.
A spot catalog built by hand would take the key as the REST pair and `pair_id` as the WebSocket symbol, which are two spellings of one market.
The amount is in base currency, so the contract size is 1, see [`websocket.md`](./websocket.md) section 4.
No base is listed against two trade-enabled quotes.
Two markets deserve a caution before any use.
The `CRV_ETH` touch was 0.00012199 and 0.00012511 while Binance `CRVETH` traded at 0.0002078 at about 04:58 UTC, so the Bilaxy price is about 40 % lower, which was not investigated further.
`DOT_USDT` has no bids and asks at 9.999 and 10 while Binance `DOTUSDT` traded at 1.198.

## 3. Anchor

Bilaxy publishes no index, no mark and no funding rate, because it lists no perpetual.
The closest reference price is `GET /v1/valuation`, S1, which returns `btc_value`, `usd_value` and `cny_value` for 95 currencies in 10,017 bytes.

| reading | `usd_value` | against the ticker `close` of the USDT pair |
|---|---|---|
| BTC at about 04:57 UTC | `87223.619999999995343` | 0 ppm |
| ETH at about 04:57 UTC | `2783.099999999999909` | 0 ppm |
| DOT and OP at about 04:57 UTC and at 05:02 UTC | | 0 ppm |
| BTC at 05:02 UTC | `87014.460000000006403` | 0 ppm |
| ETH at 04:56 UTC | `2542.570120000000315`, with `btc_value` `0.029180000000000` | the `ETH_USDT` book stood near 2,784, so about 8.7 % under it |
| ETH at 05:02 UTC | `2539.081942800000434`, with `btc_value` `0.029180000000000` again | −84,814 ppm |
| BTC, five polls one second apart at 04:56 UTC | `87134.000000000000000` each time | equal to the last `BTC_USDT` trade, 87,134.00 |
| BTC, five polls one second apart at 05:02 UTC | `87014.460000000006403` each time | equal to the last `BTC_USDT` trade, 87,014.46 |

So the valuation is the venue's own last trade price, and for ETH usually the BTC price times a fixed `btc_value` of 0.02918, which is not an index.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable.
There is no index basket, no mark formula, no clamp and no funding rate.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /v1/orderbook?pair=BTC_USDT&limit=30` | S1 |
| documented depth | "the maximum is 200, the default is 30", S1, since the 2020-12-12 change, S2 | |
| probed depth | `limit=5` returned 5 and 5 levels. Every larger limit returned the whole book, which held 14 to 23 bids and 11 to 20 asks as the maker requoted between calls. `limit=201` and `limit=0` were accepted and not refused | `rest-probe.mjs book` at 04:56 and 05:02 UTC |
| number representation | price and amount as strings, `["87199.95","0.02858"]`, and no total | same |
| level order | bids descending and asks ascending in every reply | same |
| `timestamp` | integer ms, 40 to 49 ms before local arrival in two runs, so it is the reply time, not the book time | same |
| caching | `cache-control: no-cache, no-store, max-age=0, must-revalidate`, `x-cache: Miss from cloudfront`. Six `ETH_USDT` polls one second apart gave 6 distinct timestamps and 4 distinct books, in both runs | same |
| unknown pair | 404 `{"code":404,"msg":"Not found pair.","detail":null}`, also for lowercase `btc_usdt` | same |
| missing pair | 400 `` {"code":400,"msg":"`pair` is required.","detail":null} `` | same |
| disabled pair | `ACH_ETH` returns a book | same |
| empty side | `DOT_USDT` returns `"bids":[]` | same |

`GET /v1/trades?pair=BTC_USDT&limit=3` returns `price`, `amount`, `total`, `ts` and `direction`, and no `id`, although S1 documents one.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| published limit | `GET /ratelimits` returns three groups, `default`, `public` and `private`, each `"by": "ip"`, `"period": "1s"`, `"max_times": 10` | `rest-probe.mjs host`, matching S1 and the 2020-04-20 change in S2 |
| headers | `x-ratelimit-limit: 10`, `x-ratelimit-remaining`, and `x-ratelimit-reset` in Unix seconds on `/v1/*` replies. `/health` and `/ratelimits` carry none | same |
| path | `/v1/ratelimits`, the path the 2020-04-20 change in S2 names, answers 404 with an empty body, and `/ratelimits`, the path S1 lists, answers 200 | same |
| over the limit | Not verified. The probe sent at most a few requests a second, `x-ratelimit-remaining` never fell below 7, and no 429 or `Retry-After` was seen | `rest-probe.mjs book` |
| error shape | `{"code": <int>, "msg": <string>, "detail": null}`, with the HTTP status equal to `code` | S1 and the probe |
| CloudFront refusal | HTTP 403, HTML, for a request without a `User-Agent` | section 1 |

## 7. Server time and clock offset

`GET /health` returns `{"human_time":"2026-09-23T04:55:52.153","timestamp":1790139352153,"timezone":"UTC"}`.
On the warm requests faster than 150 ms the server clock read −1 to +1 ms from the midpoint of the local request at 04:56 UTC, six requests, and −3 to +5 ms at 05:02 UTC, three requests.
The slower requests put the midpoint rule off by up to 95 ms, because their extra time is not symmetric.

## 8. Recommended poller shape

No poller is recommended.
Bilaxy publishes nothing an anchor poller reads, and its only reference price is its own last trade, section 3.
If a spot leg were ever built, the catalog would come from `GET /v1/pairs` filtered to `trade_enabled`, refreshed a few times an hour, and every request would carry a `User-Agent`.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bilaxy REST API, `restapi.md` | https://github.com/bilaxy-exchange/bilaxy-api-docs/blob/master/restapi.md | 2026-09-22 | Bilaxy | base URL, endpoints, fields, limits, error shape, sections 1 to 6 |
| S2 | Bilaxy API `CHANGELOG.md` | https://github.com/bilaxy-exchange/bilaxy-api-docs/blob/master/CHANGELOG.md | 2026-09-22 | Bilaxy | `limit` on the order book, the `/ratelimits` move, sections 5 and 6 |
| S3 | Bilaxy old API, `oldapi.md` | https://github.com/bilaxy-exchange/bilaxy-api-docs/blob/master/oldapi.md | 2026-09-22 | Bilaxy | the old base URL, section 1 |
| S4 | Binance spot `ticker/price` for `DOTUSDT`, `OPUSDT`, `CRVETH` | https://api.binance.com/api/v3/ticker/price | 2026-09-23 about 04:58 UTC | Binance | the CRV and DOT comparisons, section 2 |
| P1 | `rest-probe.mjs host`, runs at 04:55, 04:56 and 05:02 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bilaxy/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 1, 6 and 7 |
| P2 | `rest-probe.mjs catalog`, four runs from 04:55 to 05:02 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bilaxy/rest-probe.mjs) | 2026-09-23 | this host | sections 2 and 3 |
| P3 | `rest-probe.mjs book`, runs at 04:56 and 05:02 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bilaxy/rest-probe.mjs) | 2026-09-23 | this host | section 5 |
| P4 | curl without and with a `User-Agent`, and `dig` | `curl -A '' https://newapi.bilaxy.com/health` | 2026-09-23 04:43 to 04:44 UTC | this host | section 1 |
