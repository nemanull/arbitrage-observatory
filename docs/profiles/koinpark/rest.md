# Koinpark REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:15 to 03:44 UTC, from the development host near Seattle.

Koinpark lists no perpetual, so this profile covers the spot REST API, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The API page renders in the browser, so its content was read from the page's script bundle, S1.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/koinpark/rest-probe.mjs), and the book comparison with the socket from [`ws-probe.mjs`](../../../scripts/probes/venues/koinpark/ws-probe.mjs).
The API allows 1,440 requests a day per client, so every probe here was sized to that budget, section 6.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| base URL | `https://api.koinpark.com/publicApi/`, "This method can be accessed without an account or API key." | S1 |
| resolved address | `172.67.138.65`, `104.21.8.23`, `2606:4700:3035::6815:817`, `2606:4700:3035::ac43:8a41`, which are Cloudflare | P1 |
| edge | `server: cloudflare`, `cf-ray` ending `-SEA`, `cf-cache-status: DYNAMIC` | P1 |
| cold request | 824 and 1,358 ms for `markets`, 53.8 to 53.9 KB, in two runs | P1 |
| warm requests | 267 to 1,202 ms for `markets`, 262 and 264 ms for `ticker`, 269 to 543 ms for `orderbook` | P1 |
| 5 s polls of the book | median 589 and 684 ms and max 2,324 and 1,077 ms on `BTC_USDT`, median 281 and 278 ms and max 1,003 and 829 ms on `ETH_BTC`, over 13 polls each in two runs | P2 |
| refusals | none. Every documented call answered 200 | P1 |

## 2. Catalog

### The instruments call

`GET /publicApi/markets` returns every pair in one reply, S1.

```json
{"trading_pairs":"BTC_USDT","last_price":86690.98,"base_volume":30.329032939998694,"quote_volume":2629253.588020768,"lowest_ask":87557.88979999999,"highest_bid":85824.0702,"price_change_percent_24h":1.5716181948575925,"highest_price_24h":86593.84,"lowest_price_24h":85167.31}
```

| item | value | evidence |
|---|---|---|
| rows | 215 pairs, no duplicate | P1 |
| by quote | 115 INR, 93 USDT, 4 BTC, 3 ETH | P1 |
| zero 24 h quote volume | 30 pairs | P1 |
| status field | none in `markets`. `GET /publicApi/ticker` carries `isFrozen`, and it was 0 on all 215 | P1 |
| `lowest_ask` and `highest_bid` | exactly `last_price` times 1.01 and times 0.99 on all 215 rows, so they are not the book | P1 |
| tick size, lot size, minimum | not in the API. The fee page has a minimum trade per pair, see [`fees.md`](./fees.md) section 4 | S1, S2 |

`GET /publicApi/ticker` returns the same 215 pairs keyed by pair, with `base_id`, `quote_id`, `last_price`, `quote_Volume`, `base_volume` and `isFrozen`, in 29.3 KB, P1.
`GET /publicApi/asset` returns 209 assets with deposit and withdrawal flags and limits, and a `maker_fee` and `taker_fee` of `"0.25"` on every one, which the fee page contradicts, see [`fees.md`](./fees.md) section 2.
`Single_trade_pair` and `single_trade_tickers` return one pair's row from `markets` and `ticker`, S1.

### How the engine's catalog would map it

The engine's catalog is CCXT `loadMarkets` filtered to active swaps, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 68 and 79.
CCXT 4.5.68 has no Koinpark class and Koinpark has no swap, so the catalog would be empty, see [`fees.md`](./fees.md) section 8.
For a spot use, the pair id `BTC_USDT` is spelled the same in `markets`, `ticker`, `orderbook` and every socket topic, [`websocket.md`](./websocket.md) section 3.
The `orderbook` call also accepts `btc_usdt` in lower case, and refuses `BTC-USDT`.
Sizes are in the base currency, so a contract size would be 1.

### Two kinds of pair

The socket's ticker gives each pair a `liq` flag, and 61 pairs with `liq: 1` carry Binance's book at 0.8 times the size, see [`websocket.md`](./websocket.md) section 2.
The REST book shows the same split.
`ETH_BTC` returns exactly 20 levels per side, and all 20 bid prices were levels of Binance's `ETHBTC` book, read right after, on 25 of 26 polls over two runs, and 19 on the other, P2.
Its top three sizes were 0.78 to 0.86 of Binance's in the first run, and 0.39 to 1.85 in the rerun when Binance moved between the two reads, with most at 0.8.
`BTC_USDT` returns Koinpark's own book, with 508 bids and 26 asks, and 513 and 24 in the rerun, P1.
No REST call exposes the flag.

## 3. Anchor

Koinpark publishes no index, no mark and no funding rate, because it lists no perpetual.
The only reference prices it publishes are in the socket tickers: `inr_value` and `usdt_value`, which convert a pair's quote into INR and USDT, [`websocket.md`](./websocket.md) section 6.
No anchor poller is recommended.

## 4. Anchor semantics

None, see section 3.

## 5. REST book snapshot

`GET /publicApi/orderbook?market_pair=BTC_USDT`, S1.

```json
{"status":1,"responsecode":"success","message":"Order List Details","timestamp":1790133981587,"data":{"timestamp":1790133981587,"bids":[[86689.68,0.00002493]],"asks":[[86693.74,0.0007097]]}}
```

The arrays are cut to one level each.

| item | documented | probed |
|---|---|---|
| parameters | `market_pair` required, `limit` of 5, 10, 20, 50, 100 or 500, `level` of 1, 2 or 3, "Level 1 – Only the best bid and ask, Level 2 – Arranged by best bids and asks, Level 3 – Complete order book, no aggregation", S1 | `limit` 5, 7, 20 and 500 and `level` 1 and 3 all returned the same 508 bids and 26 asks on `BTC_USDT`, and 513 and 24 in the rerun, so both are ignored |
| depth | as above | the whole own book, 507 to 513 bids and 23 to 28 asks on `BTC_USDT` and 630 to 633 bids and 37 to 41 asks on `ETH_USDT`, over both runs of P1 and P3. On `liq: 1` pairs exactly 20 per side |
| level shape | `[price, size]` | JSON numbers, not strings |
| level order | Not publicly specified | bids descending and asks ascending on every call |
| time | `timestamp` in ms | `timestamp` in ms, 126 to 388 ms before the reply arrived on single calls, and 125 to 548 ms over the polls |
| caching | Not publicly specified | no `Cache-Control`, `cf-cache-status: DYNAMIC`, and a new weak `ETag` and `timestamp` on every call |
| change rate | Not publicly specified | over 13 polls 5 s apart, in each of two runs, the `BTC_USDT` book did not change once, and the `ETH_BTC` book changed on 6 of 12 intervals, which fits its 10 s republish, P2 |
| agreement with the socket | | a REST book with every later socket delta applied equalled a fresh REST book on all top 20 levels per side, [`websocket.md`](./websocket.md) section 4 |

`GET /publicApi/trades?market_pair=BTC_USDT` returned 421 trades from 2026-04-10 to 2026-09-22 18:06 UTC, ascending by `trade_id`, and every one of them carried the same `base_volume` of `"1.18342839"` and the same `quote_volume`, so that field is not the trade's size, P1.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| limit | Not publicly specified | `RateLimit-Policy: 1440;w=86400`, `RateLimit-Limit: 1440`, on every `publicApi` reply, P1 |
| scope | | one counter across every `publicApi` path: `RateLimit-Remaining` fell by one on each call whatever the path |
| window | | `RateLimit-Reset` read 86400 on the first call, at 03:15:02 UTC, and counted down in seconds after it, which reads as a fixed 24 h window from the first request |
| counter restart | | the counter did not last the day: `RateLimit-Remaining` was 1,377 at 03:27 UTC and then 1,439, with `RateLimit-Reset` 86400, on the first call at 03:36 UTC. The cause is Not publicly specified |
| budget used | | 64 requests before the restart and 55 after it, 119 in all, for the whole research. At 03:43:27 UTC `RateLimit-Remaining` read 1,385 and `RateLimit-Reset` 85,985, so the new window began at 03:36:32 UTC |
| status at the limit | Not publicly specified | not tested, since reaching it would take the whole day's budget |
| `Retry-After` | Not publicly specified | not seen |
| unknown pair | | HTTP 200, `{"status":0,"message":"This pair not active"}`, also for `BTC-USDT` |
| missing pair | | HTTP 200, `{"status":0,"responseCode":"fail","message":"The market pair field is mandatory."}` |
| unknown path | | HTTP 404 with an HTML "Not Found" page |

The success flag is `status`, and it is 1 on success and 0 on failure with HTTP 200 either way.
Its type drifts: `markets` and `orderbook` send the number `1`, and the socket payloads send the string `"1"`.

## 7. Server time and clock offset

No server time call exists, S1.
The book's `timestamp` fell inside every request window: over 6 calls in two runs, with round trips of 509 to 543 ms, it was 114.5 to 119.5 ms before the window's midpoint, P1.
So the server clock is within half a round trip, about 270 ms, of this host's clock.

## 8. Recommended poller shape

None.
Koinpark has no index, mark or funding to poll.
A spot feed would also need REST books to seed and repair the own-book deltas, since the socket has no snapshot and no sequence, [`websocket.md`](./websocket.md) section 4.
The 1,440 requests a day allow about one call a minute in total, so a REST book per pair per reconnect is affordable only a few times a day for 215 pairs.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Koinpark Market REST API Documentation, script bundle chunk `0jk6gq4.2cahr.js` | https://www.koinpark.com/api | 2026-09-23 03:14 UTC | Koinpark | base URL, calls, parameters, sections 1, 2 and 5 |
| S2 | Koinpark fee page | https://www.koinpark.com/fees | 2026-09-23 03:13 UTC | Koinpark | minimum trade per pair, section 2 |
| P1 | `rest-probe.mjs catalog` at 03:26 UTC and rerun at 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/koinpark/rest-probe.mjs) | 2026-09-23 | this host | sections 1, 2, 5, 6 and 7 |
| P2 | `rest-probe.mjs poll` at 03:26 UTC and rerun at 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/koinpark/rest-probe.mjs) | 2026-09-23 | this host | poll timings, change rate, Binance comparison, sections 1, 2 and 5 |
| P3 | `ws-probe.mjs book` at 03:23 and 03:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinpark/ws-probe.mjs) | 2026-09-23 | this host | REST seed books of `BTC_USDT` and `ETH_USDT`, section 5 |
