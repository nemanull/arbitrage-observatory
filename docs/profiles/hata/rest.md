# Hata REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:24 to 05:00 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada (`loc=CA`, `colo=SEA`).

This profile covers the public REST API of Hata's two spot platforms, since Hata lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every probe number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/hata/rest-probe.mjs), and every documented claim from the OpenAPI file S1.
All access results below were seen from the Canadian VPN exit, not from a Seattle address.

## 1. Host and latency from this machine

| item | Hata Global | Malaysia platform | evidence |
|---|---|---|---|
| base URL | `https://api.hata.io`, which also serves every `/auth` call for both platforms | `https://my-api.hata.io` | S1, "General API Information" |
| DNS | `104.18.28.103` and `104.18.29.103`, Cloudflare | the same two addresses | P2 |
| edge | `server: cloudflare`, `cf-cache-status: DYNAMIC` on every public call | same | P2, P3 |
| `exchange-info`, cold | 1,093 and 823 ms, 2,803 bytes | 926 and 911 ms, 11,148 bytes | P2, two runs |
| `exchange-info`, warm, 10 reads one second apart | min 225 and 205, median 227 and 207, max 244 and 217 ms | min 248 and 245, median 253 and 249, max 265 and 265 ms | P2, two runs |
| `orderbook`, warm | median 219 and 197 ms on `BTCUSDT` | median 234 and 232 ms on `XRPMYR` | P2, two runs |
| status codes | 200 on every public call, 404 on an unknown pair or path, 400 on a missing parameter | same | P3, section 6 |

The first call on a new connection takes 0.8 to 1.1 s, P1 and P2, and later calls on the same connection about 0.2 s.
No refusal, geoblock or challenge was met on any REST host.
The public WebSocket token call returned a token whose claims carry `user_ip` `216.246.31.78`, the VPN exit, see [`websocket.md`](./websocket.md) section 1.

## 2. Catalog

### The instruments call

`GET /orderbook/api/v2/exchange-info` on each base URL returns `{"data": [...], "status": "success"}` with one row per active pair, S1 and P1.

| field | example | meaning |
|---|---|---|
| `txpair` | `BTCUSDT` | the pair id, always `base` followed by `quote` on 29 of 29 rows |
| `base`, `quote` | `BTC`, `USDT` | |
| `price` | `"85113"` | last trade |
| `min_price`, `max_price` | `"84855"`, `"85113"` | documented as order price bounds, S1, and on the wire they bracketed `price` like a 24 h low and high |
| `percentage` | `"5.077791"` | 24 h change in percent |
| `base_volume`, `quote_volume` | `"0.00353"`, `"300.44889"` | 24 h volume |
| `tick_size`, `min_step` | `"0.01"`, `"0.00001"` | price and quantity increments |
| `min_qty`, `max_qty`, `min_notional`, `max_notional` | `"0.00011"`, `"0.57509"`, `"10"`, `"50000"` | order limits, with `min_notional` 10 quote units on every pair, and `max_notional` 50,000 or 1,000,000 |
| `labels` | `["Shariah"]`, `["DEX"]` | Malaysia only |

There is no status field, since the call lists only active pairs.

| platform | pairs | quotes | 24 h quote volume, all pairs |
|---|---:|---|---:|
| Hata Global | 6 | USDT 5, USD 1 | 1,511 USDT and USD in both runs |
| Malaysia | 23 | MYR 23 | 1,474,724 and 1,468,510 MYR |

From `rest-probe.mjs catalog` at 04:40 and 04:57 UTC, P1.
The Global volume and every Global last price were the same in both runs, 17 minutes apart, so no Global pair traded in between.

### How the engine's catalog would map it

There is no CCXT class, so `loadMarkets` cannot build the catalog, see [`fees.md`](./fees.md) section 8.
A custom catalog would take `txpair` as `rawMarketId`, and the socket channel `public:<txpair>@depth` spells the same id, see [`websocket.md`](./websocket.md) section 3.
Sizes are base asset units on REST and on the socket, so a contract size of 1 applies.
No pair is listed twice on one platform.
`BTCMYR` exists only on the Malaysia host and `BTCUSDT` only on the Global host, and each host answers 404 for the other's pair, P3.

### The Global book beside Binance spot

The four Global pairs that Binance lists were read beside Binance's `bookTicker` at 04:40 and 04:57 UTC, P1 and S2.

| pair | Hata last against Binance mid | Hata bid | Hata ask | Hata spread |
|---|---:|---:|---:|---:|
| `SOLUSDT` | -3,977 and -5,643 ppm | -3,642 and -5,308 ppm | -3,559 and -5,225 ppm | 84 ppm in both |
| `BTCUSDT` | -22,840 and -23,975 ppm | -8,047 and -8,564 ppm | +9,036 and +9,167 ppm | 17,222 and 17,885 ppm |
| `ETHUSDT` | -22,747 and -23,583 ppm | -8,749 and -9,108 ppm | +7,077 and +6,215 ppm | 15,965 and 15,464 ppm |
| `XRPUSDT` | -51,701 and -50,142 ppm | -129,874 and -16,105 ppm | -129,814 and -128,383 ppm | 70 ppm, then crossed by 114,116 ppm |

`XRPUSDT` was crossed on 21 and 16 of 30 reads at 1 Hz in two runs, P3.
A bid of about 108 XRP near 1.62 sat above an ask of 71.1 XRP at 1.4315 without trading, while Binance's mid was 1.64.
The socket showed the same crossing on 42 of 96 `XRPUSDT` pushes, see [`websocket.md`](./websocket.md) section 4.

```json
{"bids":[{"price":"1.6225","qty":"107.7"},{"price":"1.4314","qty":"1746.5"},{"price":"1.15","qty":"23"}],"asks":[{"price":"1.4315","qty":"71.1"},{"price":"1.6652","qty":"144"},{"price":"1.6902","qty":"118.1"}]}
```

The Global book is a few small quotes around the market, and one of its six books does not match.

## 3. Anchor

Hata publishes no index price, no mark price, no funding rate, no funding interval and no settlement time, because it lists no perpetual.
The OpenAPI file has two public market calls, `exchange-info` and `orderbook`, and neither carries a reference price other than the last trade, S1.
No ticker call exists, and `/orderbook/api/v2/ticker` and `/orderbook/api/v2/tickers` answer 404, P4.
The WebSocket `@ticker` channel carries the last trade, the 24 h high, low and volume, and nothing else, see [`websocket.md`](./websocket.md) section 2.
So no anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since there is no index, mark or funding.
`USDTUSD` on Hata Global traded at 0.991 with 57 USDT of 24 h volume, P1, and it is a pair, not an index.

## 5. REST book snapshot

`GET /orderbook/api/orderbook?pair_name=<txpair>` returns `{"data": {"asks": [...], "bids": [...]}, "status": "success"}`, with each level `{"price": "…", "qty": "…"}` as strings, S1 and P3.

| item | value | evidence |
|---|---|---|
| depth | up to 100 levels a side: `XRPMYR` and `SOLMYR` held 100 and 100 in both runs, and no depth parameter exists | P3 |
| Global depth | the whole book: 7 to 27 bids and 8 to 79 asks over the six pairs | P3 |
| side filter | `is_buy=true` returns only `bids`, `is_buy=false` only `asks` | P3 |
| level order | bids descending and asks ascending on 18 of 18 books read over two runs | P3 |
| sequence or update id | none | S1, P3 |
| caching | none seen: `cf-cache-status: DYNAMIC`, and 30 reads at 1 Hz gave 18 and 24 distinct replies on `BTCUSDT`, 11 and 17 on `XRPUSDT`, and 26 and 30 on `XRPMYR` | P3, two runs |

The socket sends 30 levels a side, so the REST book is the deeper of the two, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

No rate limit is published.
S1 says only that HTTP 429, Too Many Requests, is "Returned when **rate limits** are exceeded".
Twenty `exchange-info` reads at four per second all answered 200 with no rate header, in both runs, P4.

| request | status | body |
|---|---|---|
| unknown pair `NOPEUSDT` | 404 | `{"code":4016,"error":"Symbol Not Found"}` |
| lowercase `btcusdt` | 404 | `{"code":4016,"error":"Symbol Not Found"}` |
| a Malaysia pair on the Global host | 404 | `{"code":4016,"error":"Symbol Not Found"}` |
| no `pair_name` | 400 | `{"code":-2000,"error":"failed request validation"}` |
| unknown path | 404 | `404 page not found`, plain text |

S1 lists codes 4052 "pair not found" and 4053 for this call, while the wire answered 4016, P3.

## 7. Server time and clock offset

No server time call exists in S1, and `/orderbook/api/time`, `/orderbook/api/v2/time` and `/api/v1/time` answer 404, P4.
The HTTP `Date` header has one second resolution, and five reads bounded the offset between this host and the server to between -51 and +507 ms in one run and between -151 and +396 ms in the other, P4.
WebSocket pushes carry `ts` in whole seconds, see [`websocket.md`](./websocket.md) section 3.

## 8. Recommended poller shape

None.
Hata has no perpetual, no index, no mark and no funding, so there is nothing for an anchor poller to read.
The Global catalog has 6 pairs with 1,511 USDT and USD of combined 24 h volume, P1, which is not a leg the engine can use.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hata API Documentation, OpenAPI 3.0 file, changelog last updated 2026-07-03 | https://developers.hata.io/openapi.generated.yaml | 2026-09-22 | both platforms | base URLs, market calls, 429, error codes, sections 1 to 7 |
| S2 | Binance spot `bookTicker` | https://api.binance.com/api/v3/ticker/bookTicker | 2026-09-23 | Binance | reference mid, section 2 |
| P1 | `rest-probe.mjs catalog`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/hata/rest-probe.mjs) | 2026-09-23 04:40 and 04:57 UTC | this host | catalog, Global prices beside Binance, section 2 |
| P2 | `rest-probe.mjs latency`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/hata/rest-probe.mjs) | 2026-09-23 04:42 and 04:58 UTC | this host | DNS and latency, section 1 |
| P3 | `rest-probe.mjs book`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/hata/rest-probe.mjs) | 2026-09-23 04:40 and 04:57 UTC | this host | REST book, caching, crossing, errors, sections 2, 5 and 6 |
| P4 | `rest-probe.mjs limits` and `time`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/hata/rest-probe.mjs) | 2026-09-23 04:43 and 04:59 UTC | this host | rate test, time paths, clock, token expiry, sections 3, 6 and 7 |
