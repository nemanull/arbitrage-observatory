# NBX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:57 to 05:08 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that Cloudflare places in Canada (`loc=CA`, edges `YVR` and `SEA`).

This profile covers the public WebSocket of NBX, the Norwegian Block Exchange, which lists spot markets only, see [`fees.md`](./fees.md) section 3.
No socket opened from this host.
Every handshake got HTTP 522 from Cloudflare after about 19.5 s, which means Cloudflare could not reach the NBX origin, in [`ws-probe.mjs`](../../../scripts/probes/venues/nbx/ws-probe.mjs).
So every "probed" cell below records that refusal, and the documented values come from the NBX Public API 1.0.0 spec, S1.
The spec was read from the live developer page with Node's fetch on 2026-09-23 and matched the Wayback capture of 2025-12-14 in every field except one private endpoint's description, see [`rest.md`](./rest.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, one market per socket | `wss://api.nbx.com/markets/${market_id}/events`, S1 | 522 for `BTC-NOK`, `PALM-USDM` and `NOPE-NOK` on ten handshakes over two runs, 19,431 to 19,808 ms, body `error code: 522` |
| perpetuals, futures, options | none, NBX lists none | |

One socket carries one market, and the market is in the URL.
There is no multiplexed endpoint and no subscribe frame.
`api.nbx.com` resolved to the Cloudflare addresses `172.66.173.5` and `104.20.31.122`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed |
|---|---|---|---|
| market events socket | `ORDER-OPENED`, `ORDER-CLOSED` and `TRADE-CREATED` events, one per order or trade, S1 | every order, no aggregation, no documented rate | refused with 522 |
| aggregated book channel | none documented | | |
| best bid and ask | none documented | | |
| ticker | none documented, `GET /tickers` is REST only | | |
| mark, index, funding | none, spot only | | |

The spec says "There are only **three types of events**", and "WebSockets are `READ-ONLY` and do not support any actions.", S1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per market, `wss://api.nbx.com/markets/${market_id}/events`, S1 | every handshake refused with 522 |
| subscribe frame shape | none, the socket is read-only and the market is in the path, S1 | not reached |
| unknown symbol expectation | Not publicly specified | `NOPE-NOK` got the same 522 as real markets, so the origin never saw it |
| chunk unit and budget | one market per socket, no cap on sockets published | not reached |
| keepalive mechanism | Not publicly specified | not reached |
| connection lifetime and maintenance notice | Not publicly specified. Cancel-only mode during maintenance is flagged per market in the REST catalog, S1 | not reached |
| handshake and operation rate limits | the global 1,000 requests per minute per IP, plus undisclosed WAF rules, S1 | three sequential handshakes per run, then two at once, each 522 |
| public market data authentication | none | none asked, the refusal came before the origin |
| message parse and routing | `{"type": ..., "data": {...}}`, routed by socket, since the frame carries no market id, S1 | not reached |
| subscribe acknowledgement shape | none, there is no subscribe | not reached |
| symbol identifier format | `BTC-NOK`, case insensitive in REST paths, S1 | not reached |
| number representation | price and quantity as decimal strings, S1 | not reached |
| timestamp representation | ISO 8601 with microseconds, `"2021-09-09T10:32:40.325000+00:00"`, S1 | not reached |
| size unit | base asset quantity, S1 | not reached |
| sequence semantics | none. The `checksum` field "is always null at the moment and is reserved for the future use", S1 | not reached |
| idle repeat behaviour | Not publicly specified | not reached |

## 4. The book channel in detail

There is no book channel.
The events socket is an order by order stream, so a feed would have to build the book itself.

### Snapshot on subscribe

None is documented.
A book would start from the REST call `GET /markets/{market_id}/orders`, which lists every open order, is paginated, and is cached for up to 3 s, with stale answers allowed for 10 s while the cache revalidates, S1 and [`rest.md`](./rest.md) section 5.
No event carries an id or sequence that ties it to that snapshot, so there is no documented way to align the two.

### Delta semantics

- `ORDER-OPENED` adds one order with `id`, `side`, `price`, `quantity` and `timestamp`, S1.
- `ORDER-CLOSED` removes one order by `id` and repeats its side, price and quantity, S1.
- `TRADE-CREATED` gives `price`, `quantity`, `timestamp` and the `id` and `side` of the maker and the taker, S1.

No event reports a partial fill as a change of an order's quantity.
Whether a feed must subtract each trade from the maker order, and whether `ORDER-CLOSED` carries the original or the remaining quantity, is Not publicly specified and could not be probed.

### Sequence and gap rule

None.
No field orders the events, and the checksum is always null, S1.
A missed event cannot be detected.

### Level order on the wire

Not applicable to single-order events.
The REST snapshot is sorted best first, `BUY` by price descending and `SELL` ascending, with equal prices by creation time, S1.
The archived `CGT-NOK` book of 2021-05-14 held 36 orders at 35 distinct prices, so two orders at one price arrive as two rows, see [`rest.md`](./rest.md) section 5.

### Size unit

Quantity is in the base asset, as `"0.02819644"` BTC in the documented example, S1.
There is no CCXT class, so there is no `contractSize` to compare.

### One-sided and empty books

Not probed.
By 2026-06-27 most markets no longer showed a customer order book, see [`fees.md`](./fees.md) section 3, so what the socket sends for those markets is unknown.

### Unknown and closed symbols

`NOPE-NOK` received the same 522 as `BTC-NOK`, so the origin's answer to an unknown market is unknown.
A disabled market cancels every open order, S1.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | not reached |
| silence the server tolerates | Not publicly specified | not reached |
| forced disconnect | Not publicly specified | not reached |
| maintenance notice | none on the socket, the REST `cancelOnly` flag instead, S1 | not reached |
| compression | Not publicly specified | the handshake that offered permessage-deflate got the same 522 after 19,650 and 19,629 ms in two runs, so nothing was negotiated |
| handshake | | 522 after 19,431 to 19,808 ms on ten handshakes, `SEA` and `YVR` edges |
| subscription limits | Not publicly specified | not reached |

## 6. Captured frames

No frame was received.
The refusal to every handshake was an HTTP 522 response with the body below.

```text
error code: 522
```

The documented examples, from S1, trimmed.

```json
{"type": "ORDER-OPENED", "data": {"id": "26ff4ec4-1159-11ec-a8b4-1ab0226c1bea", "checksum": null, "timestamp": "2021-09-09T10:31:54.610000+00:00", "side": "BUY", "quantity": "0.05013267", "price": "398788.75"}}
```

```json
{"type": "TRADE-CREATED", "data": {"price": "404301.83", "quantity": "0.02819644", "checksum": null, "timestamp": "2021-09-09T10:32:40.325000+00:00", "maker": {"id": "18f8f3ca-1159-11ec-b572-06dbe52d8672", "side": "SELL"}, "taker": {"id": "423bf44e-1159-11ec-8eb5-9af6ef12221b", "side": "BUY"}}}
```

## 7. Private channels

None over the socket.
The spec documents private data only over REST, under `/accounts/{account_id}/...`, with a bearer token made from an HMAC signed request, S1.

## 8. Recommended feed shape

None.
NBX cannot be a book feed in its current shape, for four reasons.

1. It lists no perpetual.
2. Every handshake from this host was refused with 522, so no feed could run here.
3. The socket has no snapshot, no sequence and a null checksum, so a local book can drift without the feed knowing, and the engine's `resync` has no gap to trigger on.
4. Most markets had lost their customer order book by 2026-06-27, and the remaining book markets are VT, GNRC, PALM, FGLD and FSLVR.
   PALM, the only one of them on CoinGecko, is quoted in USDM and EUR, which are outside the USD, USDC and USDT quote family.

If the origin became reachable, a spot feed would need one socket per market, a REST snapshot per market, trade driven decrements of maker orders, and a periodic REST reseed in place of a gap rule.
That is a design question the probes could not answer, and it is recorded here as an open question only.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | NBX Public API 1.0.0, Redoc spec in `main.b707d6c60c5d57ab49d3.js` | https://app.nbx.com/developers | 2026-09-23 04:57 UTC, read with Node's fetch | NBX, global | the events URL, event types, read-only socket, null checksum, timestamps, the order book call and its caching, sections 1 to 7 |
| S2 | NBX Public API 1.0.0, Wayback capture of the earlier bundle | https://web.archive.org/web/20251214013924/https://app.nbx.com/developers/main/main.1a1c770078ca98dee557.js | 2026-09-22 | NBX, global | the same spec, identical to S1 except the cancel order description |
| P1 | `ws-probe.mjs open`, 04:57 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/nbx/ws-probe.mjs) | 2026-09-23 UTC | this host | the 522 refusals, sections 1, 3, 5 and 6 |
| P2 | `ws-probe.mjs deflate`, 04:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/nbx/ws-probe.mjs) | 2026-09-23 UTC | this host | compression, section 5 |
| P3 | `ws-probe.mjs open`, `deflate` and `listen`, second pass at 05:06 to 05:08 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/nbx/ws-probe.mjs) | 2026-09-23 UTC | this host | the same 522 on six more handshakes, sections 1, 3 and 5 |
