# IndoEx REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:13 to 03:30 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

This profile covers the public REST API of IndoEx spot, since the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
The API is documented at `https://api.indoex.io/`, S2, and every documented public call answered this host.
Every probed value comes from [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py), run once while writing and once more in the second pass, and the second pass numbers are the ones written when the two differ.
IndoEx has no CCXT class, see [`fees.md`](./fees.md) section 8.
Source ids are shared with [`fees.md`](./fees.md) and [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| API host | `api.indoex.io`, an Express server, `X-Powered-By: Express`, behind Cloudflare | P2 |
| resolved addresses | `104.21.58.223` and `172.67.209.24`, plus two Cloudflare IPv6 addresses, the same for `www`, `socket`, `proxysocket`, `websocket` and `masternode` | P2 |
| edge | Cloudflare `YVR`, every `CF-RAY` ending in `-YVR` | P2 |
| cold request | `GET /info/` 169 to 209 ms | P2, two runs |
| warm requests | 170 to 239 ms | P2, two runs |
| CORS | `access-control-allow-origin: *` | P2 |
| access | 200 on every documented call, with no challenge and no refusal | P2 to P7 |

## 2. Catalog

### The instruments call

| call | rows | notes |
|---|---|---|
| `GET /markets/` | 231 pairs as `{"id":"BTC_USDT","base":"BTC","quote":"USDT"}` | the same 231 ids as `/getavailablepairs/` and `/coingecko/pairs` |
| `GET /getMarketDetails/` | 178 pairs with a 24 hour row | every one of them in `/markets/` |
| `GET /getCompleteMarkets/` | 190 pairs, "with or without trade", S2 | 12 more than `getMarketDetails`, such as `GOOGLE_USDT`, `POLY_USDT` and `RADX_BTC` |
| `GET /coingecko/tickers` | 178 pairs | the CoinGecko integration shape |
| `GET /info/` | `capability` reports `"tradesSocket":false`, `"ordersSocket":false` and `"ordersSnapshot":false` | the venue's own statement that it streams nothing |

The 231 listed pairs split by quote asset as USDT 120, BTC 24, ETH 23, BNB 16, USDC 16, EUR 9, USD 9, LTC 6, BSV 5 and XRP 3, P3.
The 178 with a 24 hour row split as USDT 97, BTC 21, ETH 20, USDC 14, BNB 12, LTC 6, BSV 5 and XRP 3, so no EUR or USD pair has a row, P3.
No status field exists, so a pair's presence on `getMarketDetails` is the only sign that it trades.
No id looks like a derivative, P3.

### Mapping without CCXT

There is no CCXT class, so an adapter would build markets from `/markets/` itself.
`id` is the `BASE_QUOTE` string that every book, ticker and trade call takes in its path, and that the documented socket takes in `join`, S2 and S3.
`base` and `quote` are given, and spot needs no `contractSize`, so 1.
`min_buy` and `min_sell` on `getMarketDetails` are 10 for BTC_USDT, read as a minimum order in the quote asset, which is an inference.

### Size unit, pairs listed twice, and price scale

Book sizes are in the base asset, since a BTC_USDT level reads 0.25 to 0.51 at a price near 82,590, P4.
No pair is listed twice.
Prices carry up to 18 decimals on the wire, as strings, P4.

## 3. Anchor

IndoEx publishes no index, mark or funding, because it lists no perpetuals.
The only reference numbers a public client can read are last trade prices: `last` on `getMarketDetails`, `LastPrice` on `/ticker/<pair>` and `last` on the book calls.
No anchor poller is recommended.

## 4. Anchor semantics

Not applicable, since no index, mark or funding exists.
What follows is context on the spot data a future spot leg would read.

| observation | value | evidence |
|---|---|---|
| `getMarketDetails` best prices | `bid` equals `ask` equals `last` on 178 of 178 rows, so these fields are the last trade, not a quote | P3 |
| ticker best prices | `/ticker/BTC_USDT` gives `lowestAsk` 82560.07 and `highestBid` 86944.91, equal to the 24 hour `lowsale` and `highsale` of `getSelectedMarket`, so these fields are the 24 hour low and high, not a quote | P4 |
| ticker freshness | `lastUpdateTimestamp` read 02:23:02 in the first run and 03:23:02 in the second, which suggests an hourly refresh | P7 |
| trade freshness | the newest BTC_USDT trade was 422 s old in the first run and 11 s old in the second, with 500 trades spanning about 2 h 20 min | P7 |
| trade field names | in the newest trade, `quoteVolume` is 0.000617 and `baseVolume` is 50.96 at a price of 82591.3, so the two labels are swapped against the usual meaning | P7 |
| mid against an outside venue | BTC_USDT mid 82591.25 against Kraken XBTUSD mid 82510.95, +973 ppm in the second run and +936 ppm in the first | P5 |

The book's top moved once in about 66 s of two second polls for each of BTC_USDT and ETH_USDT, in both runs, P5.
Each BTC_USDT move shifted both sides by a round 1 to 3 USDT, and the spread stayed at 0.00403157 USDT in every read, P4 and P5.
A fixed sub cent spread, round steps about once a minute and a mid about 0.1 % away from Kraken read as a quoting program rather than a market, which is an inference.

## 5. REST book snapshot

| call | depth | order | notes |
|---|---|---|---|
| `GET /depth/<pair>` | 5000 asks and 5000 bids for BTC_USDT and ETH_USDT | asks ascending, bids descending | levels are not aggregated, BTC_USDT repeats 1187 prices per side and ETH_USDT 1437, the reply is 491 to 523 KB and took 0.5 to 2.8 s |
| `GET /coingecko/orderbook?ticker_id=<pair>&depth=N` | N/2 per side: 10 gave 5, 20 gave 10, 30 gave 15, 40 gave 20, 50 gave 25, 100 gave 50 | asks ascending, bids descending | `level=2` gave 50 per side. It took 0.4 to 0.7 s, and at depth 100 one price repeated per side |
| `GET /getOrderBook/<pair>` | every resting order, 25250 for BTC_USDT, 12625 per side | | 3.48 MB, each row an order id, `coins` and `cost` |

Every level is `{"price":"<string>","quantity":"<string>"}` in the base asset, and the reply also carries `last` and `ticker_id`, P4.
No call returns a sequence number or an update id, so a poller replaces the whole book each time.
`cf-cache-status` is `DYNAMIC` on every book reply, so Cloudflare does not cache them, P4.
`depth=40` is the call that yields the engine's 20 levels per side, though repeated prices mean it can hold one or two levels fewer at distinct prices, as ETH_USDT did in two reads.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| published limit | none published. The error code list includes `4 Too many attempts`. | S2 |
| ten ticker calls at about four a second | 10 replies with 200, and no rate limit or `Retry-After` header | P6 |
| HTTP status of errors | always 200, with the error in the body's `status` | P6 |
| unknown pair on `/ticker/` | `{"status":0,"message":"Invalid Request"}` | P6 |
| unknown pair on `/depth/` and `/coingecko/orderbook` | `{"status":0,"message":"Invalid Vendor","orderbook":[]}` | P6 |
| unknown pair on `/getSelectedMarket/` | `{"status":1,"message":"Success","marketdetails":[]}`, a success with no row | P6 |
| unknown path | `{"status":0,"message":"Under Maintanance"}` | P6 |
| documented error codes | 0, 2 and 3 invalid request, 1 success, 4 too many attempts, 5 to 7 currency not supported, 8 empty params, 9 internal error, 10 invalid user | S2 |

Several calls answer JSON with `Content-Type: text/html`, such as `/markets/` and `/getMarketDetails/`, P3.

## 7. Server time and clock offset

No server time call is documented, S2.
The `Date` header against the local clock read +0.00 to -0.46 s at one second resolution with round trips of 169 to 248 ms, which is consistent with no offset, P7.

## 8. Recommended poller shape

No anchor poller, since there is no index, mark or funding.
For a future spot leg, the book would come from REST, because no socket sends one, see [`websocket.md`](./websocket.md) section 8.
A poller would call `GET https://api.indoex.io/coingecko/orderbook?ticker_id=<BASE>_<QUOTE>&depth=40` per pair, replace the whole book with the 20 levels per side, and keep the catalog from `/markets/` limited to the pairs that `/getMarketDetails/` lists.
The book's top moved about once a minute, so a poll every 5 to 10 s per pair would miss little, and with no published limit it should stay near one call a second in total.
That poller would sit outside the engine's socket feed, since [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 96 offers a REST snapshot only beside a socket that sends deltas.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S2 | IndoEx public API documentation | https://api.indoex.io/ | 2026-10-09 | IndoEx | calls, response shapes, error codes |
| S3 | IndoEx WebSocket API documentation | https://api.indoex.io/websocket.html | 2026-10-09 | IndoEx | the pair id in `join` |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `host` | `uv run scripts/probes/venues/indoex/rest-probe.py host` | 2026-10-09 | this host, Canadian exit | section 1 |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `catalog` | `uv run scripts/probes/venues/indoex/rest-probe.py catalog` | 2026-10-09 | this host | section 2 and the `getMarketDetails` fields of section 4 |
| P4 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `book` | `uv run scripts/probes/venues/indoex/rest-probe.py book` | 2026-10-09 | this host | sections 4 and 5 |
| P5 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `poll` | `uv run scripts/probes/venues/indoex/rest-probe.py poll` | 2026-10-09 | this host | the book change rate and the mid against Kraken |
| P6 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `limits` | `uv run scripts/probes/venues/indoex/rest-probe.py limits` | 2026-10-09 | this host | section 6 |
| P7 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `time` | `uv run scripts/probes/venues/indoex/rest-probe.py time` | 2026-10-09 | this host | section 7 and the freshness rows of section 4 |
