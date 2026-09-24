# Indodax REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:28 to 04:49 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`).

This profile covers the public REST API of Indodax (CCXT id `indodax`), a spot only venue, see [`fees.md`](./fees.md) section 3.
It follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): it records the spot catalog, states that no index, mark or funding exists, and recommends no anchor poller.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/indodax/rest-probe.mjs) unless a source is named.

## 1. Host and latency from this machine

| item | value |
|---|---|
| base URL | `https://indodax.com`, S1 |
| `indodax.com` resolved to | 104.18.246.104, 104.18.247.104, 2606:4700::6812:f668 and 2606:4700::6812:f768, which are Cloudflare |
| Cloudflare edge | `cf-ray` ended in `YVR` on every probe request, and `/cdn-cgi/trace` answered `colo=YVR`, `loc=CA` in P1 and P2. One manual `curl` of the trace before the probes answered `colo=SEA` |
| `ws3.indodax.com` resolved to | 34.107.188.9, a Google Cloud address, see [`websocket.md`](./websocket.md) section 1 |
| first request, new connection | 668 and 767 ms for `/api/server_time`, 593 and 636 ms for `/api/server_time?n=<nonce>` |
| warm request that reaches the origin | `/api/server_time?n=<nonce>`: 588 to 608 ms, median 603, and 589 to 692 ms, median 607, over 7 requests each |
| warm request served by the Cloudflare cache | 16 to 18 ms, `cf-cache-status: HIT` |
| other calls, warm | `/api/depth/<pair>` 573 to 695 ms over 46 requests, `/api/ticker_all` 951 to 1,269 ms over 42, `/api/pairs` 1,334 and 1,344 ms, `/api/summaries` 1,159 and 1,133 ms |
| access | every public call answered HTTP 200, except the deliberate error cases of section 6, with no geoblock, challenge or refusal, from the Canadian VPN exit |

A warm request that reaches the origin costs about 600 ms from this host, so the origin is far from the Cloudflare edge in Vancouver.
The help center pages on `help.indodax.com` are a different matter: they answer this host with HTTP 403 and a Cloudflare challenge, see [`fees.md`](./fees.md).

## 2. Catalog

### The instruments call

`GET /api/pairs` returns one array of every spot pair, S1.

| run | status | time | bytes | pairs | IDR | USDT | `is_maintenance` 1 | `is_market_suspended` 1 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| P1, 04:28 UTC | 200 | 1,334 ms | 345,335 | 484 | 472 | 12 | 19, all IDR | 0 |
| P2, 04:47 UTC | 200 | 1,344 ms | 345,341 | 484 | 472 | 12 | 19, all IDR | 0 |

The 12 USDT pairs are `btcusdt`, `bonkusdt`, `bttusdt`, `ethusdt`, `flokiusdt`, `idxusdt`, `luncusdt`, `pepeusdt`, `pundixusdt`, `shibusdt`, `xecusdt` and `vcgusdt`.
Their 24 h volumes from `/api/ticker_all` in P2 ran from 116,253 USDT on `btc_usdt` down to 0 on `idx_usdt` and `vcg_usdt`, and all 12 together made 158,649 USDT.
The documented example of the reply lacks `is_maintenance` on the first row, but every row on the wire carried it.

Each row carries `id` (`btcusdt`), `symbol` (`BTCUSDT`), `ticker_id` (`btc_usdt`), `base_currency` (the quote, `usdt`), `traded_currency` (the base, `btc`), `traded_currency_unit`, `description`, `price_round`, `pricescale`, `price_precision`, `quantity_increment`, `volume_precision`, `trade_min_base_currency`, `trade_min_traded_currency`, `trade_fee_percent`, `trade_fee_percent_taker`, `trade_fee_percent_maker`, `is_maintenance`, `is_market_suspended`, `disable_deposit`, `has_memo`, `memo_name`, `coingecko_id`, `cmc_id` and logo URLs.
The naming is inverted: `base_currency` is the quote currency and `traded_currency` is the base.
`id` equals `traded_currency` followed by `base_currency` on all 484 rows.

### How CCXT 4.5.68 maps it

CCXT reads the same call in `fetchMarkets`, at `server/node_modules/ccxt/js/src/indodax.js` line 339.

| CCXT field | source | probed |
|---|---|---|
| `id` | `id`, line 376 | `btcusdt`, which is the WebSocket channel suffix and the REST depth path, see [`websocket.md`](./websocket.md) section 3 |
| `base`, `quote` | `traded_currency` and `base_currency`, lines 370 to 373 | `BTC/USDT` |
| `type` | `'spot'`, line 384 | 484 of 484 spot, 0 swap |
| `active` | `is_maintenance` false, line 390 | 465 of 484 active, the 19 under maintenance inactive |
| `linear`, `contractSize` | `undefined`, lines 392 and 395 | the connector turns a missing size into 1, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194, which is right for base coin sizes |
| `taker` | `trade_fee_percent`, line 394 | a percent read as a fraction, see [`fees.md`](./fees.md) section 8 |
| `maker` | the class default 0, line 185 | 0 on all 484 |

CCXT reported 484 markets in 114 and 170 ms, with no duplicate symbol.

The connector filters to active swap markets, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 200, so it would find none on Indodax.

### Size unit, pairs listed twice, and price scale

Sizes are base coins on the REST depth and on the socket, see [`websocket.md`](./websocket.md) section 4.
No pair is listed twice within one quote currency.
Each base that trades against both IDR and USDT is two pairs with different quotes, and only the USDT pair belongs to the engine's USD family.
No pair is quoted per 10 or per 1000 units.

One id names a different token than CCXT's symbol suggests.
`idxusdt` and `idxidr` have `traded_currency` `idx`, but the symbols `IDRXUSDT` and `IDRXIDR`, `traded_currency_unit` `IDRX` and `coingecko_id` `idrx`, so the asset is IDRX and not a token called IDX.
CCXT names it `IDX/USDT`, which would cluster it with any other venue's `IDX`, so it would need a `DENIED_PAIRS` line if a spot leg were ever added.

## 3. Anchor

Indodax publishes no index price, no mark price and no funding rate, because it lists no derivative, see [`fees.md`](./fees.md) section 3.

| call | fields | reply | time |
|---|---|---|---|
| `GET /api/ticker_all` | per `ticker_id`: `buy`, `sell`, `last`, `high`, `low`, `vol_<base>`, `vol_<quote>`, `server_time` in seconds | 76,391 and 76,403 bytes, 484 rows | 983 and 966 ms |
| `GET /api/summaries` | the same `tickers`, plus `prices_24h` and `prices_7d` keyed by pair id | 102,426 and 102,444 bytes, 484 rows | 1,159 and 1,133 ms |
| `GET /api/ticker/<pair>` | one pair of the above | one row | 603 and 613 ms |

None of these is an index or a reference price.
`buy` and `sell` are the venue's own best bid and ask, and `last` its own last trade.
The CoinGecko and CoinMarketCap ids in `/api/pairs` are listing metadata, not a price source.
No `AnchorRow` column can be filled, and a mark of 0 would make the engine refuse every route through this venue at open.

## 4. Anchor semantics

Not applicable.
There is no index basket, mark formula, clamp or funding formula to record.
The only prices the venue publishes are its own book and trades, section 3 and section 5.

## 5. REST book snapshot

`GET /api/depth/<pair>` returns `{"buy": [[price, size], …], "sell": [[price, size], …]}`, S1.

| pair | P1 levels, bids and asks | P2 levels | time | bytes |
|---|---|---|---|---|
| `btcusdt` | 150 and 150 | 150 and 150 | 592 and 599 ms | 8,300 and 8,297 |
| `btcidr` | 150 and 150 | 150 and 150 | 590 and 597 ms | 8,419 and 8,419 |
| `vcgusdt` | 12 and 114 | 12 and 114 | 581 and 611 ms | 3,248 and 3,248 |

- Level order: `buy` descending and `sell` ascending on all three pairs in both runs.
- Numbers: price and size are both strings on the wire, although the documented example shows the price as a JSON number, S1.
- Depth: 150 levels a side, and no `limit` parameter is documented. CCXT's `fetchOrderBook` sends only the pair id, at lines 506 to 515.
- Against the socket: the top 20 levels of `btcusdt` equalled the last socket push in price and size on both sides in both runs, see [`websocket.md`](./websocket.md) section 4.
- The id is case insensitive: `/api/depth/BTCIDR` returned the book, while `/api/depth/btc_idr` returned `invalid_pair`.

### Caching

Every reply carries `cache-control: public, max-age=30` and an `expires` 30 s later.

| call | 20 polls a second apart | body changed | time |
|---|---|---|---|
| `/api/depth/btcidr` | `cf-cache-status: EXPIRED` on 20 of 20, in both runs | 15 of 19 times, in both runs | 573 to 695 ms, and 583 to 610 ms |
| `/api/ticker_all` | `EXPIRED` on 20 of 20, in both runs | 19 of 19 times, in both runs | 951 to 1,031 ms, and 953 to 1,269 ms |
| `/api/server_time` | `EXPIRED` 4 and `HIT` 4 of 8 plain requests, in both runs | a `HIT` returned a time up to 30 s old | 16 to 18 ms on a `HIT` |
| `/api/server_time?n=<nonce>` | `MISS` on 8 of 8, in both runs | | 588 to 692 ms |

The book and ticker calls were revalidated at the origin on every poll, so no stale book was served, although the headers allow 30 s.
`/api/server_time` was served from the Cloudflare cache half the time, and a query nonce avoids that.

## 6. Rate limits and errors

The public limit is "180request/minute", S1.
The limit counts per IP address on the Trade API v2, S3, and the public document does not say how it counts.
No rate limit header, such as `x-ratelimit-limit` or `retry-after`, appeared on any reply.
The probes stayed at one request a second or less, so no refusal was provoked, and the status code of a public limit is Not verified.
The Trade API v2 documents HTTP 429 with code `-1003` "Too many requests.", S3.

| request | status | body |
|---|---|---|
| `GET /api/depth/nopeidr` | 200 | `{"error":"invalid_pair","error_code":"invalid_pair","error_description":"Invalid Pair"}` |
| `GET /api/depth/btc_idr` | 200 | the same `invalid_pair` body |
| `GET /api/ticker/nopeidr` | 200 | `{"error":"invalid_pair","error_description":"Invalid Pair"}` |
| `GET /api/nope` | 404 | `{"error":"API method not found","is_error":true}` |
| `POST /api/depth/btcidr` | 405 | `{"message":"Method Not Allowed"}` |

An unknown pair is an HTTP 200 with an `error` field, so a client has to read the body.
CCXT maps `invalid_pair` to `BadSymbol`, at line 191.
The error replies carry the same `max-age=30` header as a good reply.

## 7. Server time and clock offset

`GET /api/server_time` returns `{"timezone":"UTC","server_time":<ms>}`, S1.
Measured against the midpoint of each request, with a nonce so the reply came from the origin:

| run | requests | offset, server minus local |
|---|---:|---|
| 04:30 UTC | 8 | +191 to +200 ms, median +196 |
| 04:47 UTC | 8 | +187 to +211 ms, median +198 |

The plain requests that missed the cache read +190 to +262 ms.
At a round trip near 600 ms, an asymmetric path between the edge and the origin can explain an offset of this size, so the server clock itself may be closer than 0.2 s.
A reply served from the cache carried a time up to 30 s old, which is why the nonce matters.

## 8. Recommended poller shape

No anchor poller is recommended.
Indodax has no index, mark or funding to poll, section 3, and no perpetual for the engine to anchor.

If a spot leg is ever modelled, the REST side would be reference data only.

| item | recommendation | reason |
|---|---|---|
| catalog | `/api/pairs` at boot, keep rows with `is_maintenance` 0 and `is_market_suspended` 0 | the 19 maintenance pairs are inactive in CCXT too |
| book seed | `/api/depth/<id>` when a socket channel has no history, section 5 | 150 levels, revalidated at the origin, about 600 ms |
| deny | `idxusdt`, section 2 | CCXT calls IDRX by the ticker `IDX` |
| clock | `/api/server_time?n=<nonce>` if ever needed | the plain call can be 30 s stale |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Indodax official API docs, Public REST API | https://github.com/btcid/indodax-official-api-docs/blob/master/Public-RestAPI.md | 2026-09-22, repo last changed 2026-09-10 | Indodax | base URL, calls, 180 requests a minute, reply shapes |
| S2 | CCXT 4.5.68 `indodax.js` | `server/node_modules/ccxt/js/src/indodax.js` | 2026-09-22 | CCXT | section 2 mapping, `fetchOrderBook`, `BadSymbol` |
| S3 | Indodax official API docs, INDODAX Trade API 2.0 | https://github.com/btcid/indodax-official-api-docs/blob/master/INDODAX-TradeAPI-2.md | 2026-09-22 | Indodax | per IP rate limits of the private API, HTTP 429 code `-1003` |
| P1 | `rest-probe.mjs all` at 04:28 to 04:30 UTC 2026-09-23, and its `host` mode again at 04:30 UTC with the nonce requests | [`rest-probe.mjs`](../../../scripts/probes/venues/indodax/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | `rest-probe.mjs all`, rerun at 04:47 to 04:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/indodax/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the second readings |
