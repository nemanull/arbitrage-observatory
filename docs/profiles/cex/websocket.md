# CEX.IO WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:24 to 03:49 UTC, from the development host near Seattle, whose traffic Cloudflare's trace places in Canada (`loc=CA`, colo `YVR`).

This profile covers the public WebSocket of CEX.IO Spot Trading (CCXT id `cex`), for spot, since CEX.IO lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/cex/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation (S1) redirects this host to a Canadian notice, so it was read as the Internet Archive copy of 2026-05-09, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| spot, public | `wss://trade.cex.io/api/spot/ws-public`, S1 | open in 551 to 860 ms over the 14 sockets that logged it, greeting `{"e":"connected"}` |
| spot, private | `wss://trade.cex.io/api/spot/ws`, S1 | not probed, needs an API key |
| legacy exchange | `wss://ws.cex.io/ws`, the URL CCXT Pro 4.5.68 uses, at `server/node_modules/ccxt/js/src/pro/cex.js` line 40 | open in 492 to 634 ms, greeting `{"e":"connected"}`. Its book refuses an anonymous client, section 4 |
| perpetuals, futures, options | none | CEX.IO lists none |

One public socket carries every pair of every quote currency.
The batch run held 30 pairs quoted in `USD`, `USDT` and `USDC` on one socket.
`trade.cex.io` and `ws.cex.io` resolved to the Cloudflare addresses 104.20.25.69 and 172.66.166.209, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| request `e` | payload | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `order_book_subscribe` | `{"pair": "BTC-USD"}`, one pair per request | a 20 level snapshot in the reply, then `order_book_increment` at most once a second per pair | recommended, sections 3 and 4 |
| `order_book_unsubscribe` | `{"pair": "BTC-USD"}` | | acked with `"ok": "ok"` |
| `get_order_book` | `{"pair": "BTC-USD"}` | one snapshot | not probed on the socket, the REST twin returns 20 levels, see [`rest.md`](./rest.md) section 5 |
| `trade_subscribe` | `{"pair": "BTC-USD"}` | documented `tradeHistorySnapshot` then `tradeUpdate` | acked with a `reqId`, and no `tradeHistorySnapshot` or `tradeUpdate` came for `BTC-USD` in 60 s in three runs |
| `get_ticker` | `{"pairs": ["BTC-USD"]}` | request and reply, no ticker stream | answered with `bestBid`, `bestAsk`, `last`, `volume`, `volumeUSD`, `priceChangePercentage` |
| `get_candles`, `get_trade_history`, `get_server_time`, `get_pairs_info`, `get_currencies_info`, `get_processing_info` | | request and reply | not probed on the socket |
| `ping` | `{"e": "ping"}` | | answered `{"e": "pong"}` |

The names, payloads and costs are from S1, and every public request costs 1 point except `get_processing_info` at 10.
No best bid and ask stream, ticker stream, mark, index or funding channel exists.
S1 says the private connection offers "more frequent order book updates", which matches the one second pace of the public book in section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL and one private URL for all spot pairs, S1 | 30 pairs across three quote currencies on one socket |
| subscribe frame shape | `{"e": "order_book_subscribe", "oid": "16147857398591_order_book_subscribe", "data": {"pair": "BTC-USD"}}`, one pair per request, S1 | as documented, and 30 requests sent in one burst were each answered |
| unknown symbol expectation | "If this field is present, then request is not successful", the `error` field in `data`, S1 | `{"e":"order_book_subscribe","oid":"…","data":{"error":"Currency pair NOPE-USD is not supported"}}`, the socket stays open. A lowercase `btc-usd` and a slash `BTC/USD` are refused the same way |
| chunk unit and budget | one pair per request at 1 point, public calls limited to "maximum of 100 points per minute" per IP, and past it the server "replies with error, sends disconnected event to Client and closes WS connection afterwards", S1 | 30 subscribes in one burst, all answered with snapshots within 425 and 438 ms. No larger burst was tried, because the documented budget is 100 a minute |
| keepalive mechanism | the client must send "any valid message" at least every 10 s, and `{"e":"ping"}` is answered `{"e":"pong"}`, S1 | pong in 152 to 254 ms. No server ping and no server protocol ping. A socket that sent nothing closed after about 60 s, not 10 s, section 5 |
| connection lifetime and maintenance notice | "Either Client or CEX.IO Spot Trading can terminate WebSocket connection at any time", a `{"e":"disconnected"}` notice precedes a server close, and maintenance errors read like "market_data is on maintenance", S1 | no forced disconnect on a pinging socket in 110 s, no maintenance message seen |
| handshake and operation rate limits | 100 points a minute per IP for public calls, S1 | opens took 551 to 860 ms, and no socket was refused. REST `get_ticker` drew 429 on this IP, see [`rest.md`](./rest.md) section 6 |
| public market data authentication | none on `ws-public`, S1 | none. The legacy socket answers its book request with `"Please Login"` |
| message parse and routing | `{"e": <type>, "oid", "ok", "data"}`, S1 | route on `e`, then on `data.pair` for `order_book_subscribe` and `order_book_increment` |
| subscribe acknowledgement shape | the reply to `order_book_subscribe` is the snapshot, S1 | `{"e":"order_book_subscribe","oid":"…","data":{"seqId":…,"pair":"BTC-USD","bids":[…],"asks":[…]},"ok":"ok"}`, no separate ack |
| symbol identifier format | `BTC-USD`, two upper case codes and a hyphen, "Pair should be listed in traditional direction", S1 | identical to CCXT `market.id` and to the REST ticker keys on 898 of 898 pairs, see [`rest.md`](./rest.md) section 2 |
| number representation | `[price, amount]` strings, S1 | strings on every level of every frame, prices trimmed (`"86875"`), sizes padded to the pair's precision (`"0.04301025"`, `"2952.800000"`) |
| timestamp representation | none on the book frames, S1 | neither the snapshot nor any increment carries a time. The REST book carries `timestamp` in ms |
| size unit | "amount of the Order Book entry", S1 | base currency, equal to the REST book's amounts, and CCXT's `contractSize` is `undefined`, section 4 |
| sequence semantics | `seqId` per pair, each increment the previous plus one, and a lower `seqId` means an internal restart that needs a resubscribe, S1 | 0 gaps and 0 lower ids in 232, 222 and 255 increments on the book runs and 1,331 and 1,329 on the batch runs |
| idle repeat behaviour | not documented | no empty increment and no increment that changed nothing, in 3,369 increments. A quiet pair simply sends nothing, up to 7.3 s |

## 4. The book channel in detail

`order_book_subscribe` is the only book channel on the public socket, and every row below is about it.
The book runs held `BTC-USD`, `ETH-USDT`, `XRP-USD` and `MSTRX-USDC` for 60 s each at 03:24, 03:38 and 03:44 UTC, and the last run added `COW-USD`, whose book had no bid.

### Snapshot on subscribe

The reply to `order_book_subscribe` is a snapshot of up to 20 levels per side with the pair's `seqId`.
It came 159 to 168 ms after the subscribe in the first run, 194 ms in the second and 198 to 230 ms in the third.
One snapshot per subscribe was seen, and none arrived unasked in 60 s.
A second `order_book_subscribe` for a pair already held returns a fresh snapshot whose `seqId` equals the last increment's `seqId`, and the stream carries on, seen on `ADA-USD` in both error runs.

### Delta semantics

An `order_book_increment` carries `seqId`, `pair`, `bids` and `asks`, each an array of `[price, size]` string pairs, and `"ok": "ok"`.
A size of zero deletes the level, spelled with the pair's decimals, as in `"0.00000000"` or `"0.000000"`.
S1 says either array "can be an empty array" when that side did not change, and `COW-USD` sent `"bids": []` on every increment.

### Sequence and gap rule

```text
snapshot (reply to order_book_subscribe)   replace the book, last = seqId
increment, seqId = last + 1                apply, last = seqId
increment, seqId > last + 1                gap: resubscribe the pair (documented), or terminate the socket (the engine's resync)
increment, seqId <= last                   internal restart: resubscribe (documented)
```

The first increment after each snapshot had `seqId` equal to the snapshot's plus one on every pair of every run.
Every later increment chained, with 0 gaps and 0 lower ids, see the sequence row of section 3.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every pair of every run | best first, ascending, on every pair of every run |
| increment | unordered: 59 of 60, 59 of 59 and 59 of 59 `BTC-USD` bid arrays were not descending in the three runs | unordered: 60, 56 and 54 of 59 or 60 `BTC-USD` ask arrays were not ascending |
| REST `get_order_book` | descending | ascending |

A feed applies increments by price and never by position.

### Level window and pace

The server keeps each pair at 20 levels per side.
A book kept from the snapshot and every increment never held more than 20 levels on any pair, and levels leaving the window arrive as zero sizes: 863 to 1,032 deletions on `BTC-USD` in 60 s.
After 60 s the kept `BTC-USD` book equalled one REST `get_order_book` read right after on 20 of 20 levels per side, prices and sizes, in all three runs.

Increments come at most once a second per pair, which is the conflation S1 hints at for the public connection.

| pair | increments in 60 s, three runs | median interval | longest silence |
|---|---|---|---|
| `BTC-USD` | 60, 59, 59 | 1,002 and 1,000 ms | 1,074 to 1,129 ms |
| `ETH-USDT` | 59, 59, 58 | 1,002 ms | 1,151 to 1,281 ms |
| `XRP-USD` | 59, 60, 59 | 1,001 and 1,000 ms | 1,037 to 1,114 ms |
| `MSTRX-USDC` | 54, 44, 47 | 1,011 and 1,004 ms | 2,001 to 4,194 ms |
| `COW-USD` | 32 | 1,025 ms | 7,285 ms |

Intervals were measured in the second and third runs.
Each pair keeps its own phase inside the second: `BTC-USD` increments arrived between 417 and 556 ms past the UTC second in the second run, while `XRP-USD` arrived between 490 and 672 ms.
So a CEX.IO book is up to about one second old by construction, before any network delay.

### Size unit against CCXT `contractSize`

The size is the amount in the base currency, the same number the REST book reports, see the REST comparison above.
CCXT reports `contractSize` as `undefined` on all 898 markets, and the connector turns a missing contract size into 1, at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 175 and lines 188 to 194, so the unit would convert correctly.

### One-sided and empty books

`COW-USD` answered with `"bids": []` and 20 asks, and every one of its 32 increments carried `"bids": []`.
50 of 898 pairs had no `bestBid` in `get_ticker` in both catalog runs, and none lacked a `bestAsk`, see [`rest.md`](./rest.md) section 2.
`COW` is one of the 19 assets whose purchases stopped on 2026-09-21 ahead of delisting, see [`fees.md`](./fees.md) section 7.
The engine's `resetBook` hands both arrays to `OrderBook.reset` without a length check, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 263 to 278, so an empty side is accepted.

### Idle repeats

Nothing is repeated.
Every one of the 3,369 increments over all book and batch runs changed at least one level.
A quiet pair sends nothing until its top 20 changes, and `COW-USD` went 7.3 s without a frame.

### Unknown, closed and malformed requests

Each case ran on its own socket, twice.

| request | reply | then |
|---|---|---|
| `order_book_subscribe` `NOPE-USD` | `{"e":"order_book_subscribe","oid":"…","data":{"error":"Currency pair NOPE-USD is not supported"}}` | the socket stays open |
| `order_book_subscribe` `btc-usd` | `"Currency pair btc-usd is not supported"` | open |
| `order_book_subscribe` `BTC/USD` | `"Currency pair BTC/USD is not supported"` | open |
| `order_book_subscribe` without `oid` | `{"e":"disconnected"}` | closed with 1000, 150 to 180 ms after the request |
| `order_book_subscribe` twice, then `order_book_unsubscribe` | a second snapshot, then `{"e":"order_book_unsubscribe","oid":"…","data":{"pair":"ADA-USD"},"ok":"ok"}` | open |
| text that is not JSON | `{"e":"disconnected"}` | closed with 1000 |
| `{"e":"nope_method"}` | `{"e":"nope_method","oid":"…","data":{"error":"Unsupported message type nope_method"}}` and `{"e":"disconnected"}` | closed with 1000, as S1 documents |
| legacy `wss://ws.cex.io/ws`, `order-book-subscribe` without login | `{"e":"order-book-subscribe","data":{"error":"Please Login"},"oid":"…","ok":"error"}` | open |

A delisted pair was not probed, because none was known to be absent from the catalog while still having a book.
The catalog carries no status field, see [`rest.md`](./rest.md) section 2.
The replies above show that a malformed frame ends the whole socket, so a feed must build every request exactly.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | "Maximum allowed period between two closest Client's messages is 10 seconds", and `{"e":"ping"}` gets `{"e":"pong"}`, S1 | `{"e":"pong"}` in 152 to 254 ms. No server ping of any kind |
| silence the server tolerates | 10 s, and the server "can terminate the connection", S1 | a socket that neither subscribed nor sent closed at 60.66, 60.67 and 60.59 s after creation with 1006 and no `disconnected` notice. A socket that subscribed once and then sent nothing got `{"e":"disconnected"}` and a 1000 close at 60.83 and 60.87 s, and was still open at 60 s in the first, shorter run. A socket that pinged every 5 s stayed open for 60, 110 and 75 s, the full length of each run |
| forced disconnect | at any time, S1 | none seen |
| maintenance notice | error text such as "market_data is on maintenance", and WS connections may be closed, S1 | not observed |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back from either URL, twice |
| handshake | | 551 to 860 ms to open from this host |
| subscription limits | each subscribe costs 1 point of 100 a minute per IP, S1 | 30 in one burst were answered |
| throughput | | 30 pairs on one socket: median 30 frames a second, peak 31 and 32, 28,114 and 29,444 bytes a second, 923 and 969 bytes a frame, 8.6 and 13.4 µs `JSON.parse` a frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays are cut to their first levels.

Greeting on open.

```json
{"e":"connected"}
```

Subscribe.

```json
{"e": "order_book_subscribe", "oid": "1790135070649_1_order_book_subscribe", "data": {"pair": "BTC-USD"}}
```

Snapshot, which is also the acknowledgement, three levels per side kept.

```json
{"e":"order_book_subscribe","oid":"1790135070649_1_order_book_subscribe","data":{"seqId":8676229,"pair":"BTC-USD","bids":[["86875","0.04301025"],["86850","0.05000000"],["86825","0.05000000"]],"asks":[["86875.1","3.40529629"],["86875.2","0.12122756"],["86876.9","0.40000000"]]},"ok":"ok"}
```

The first increment, four of 18 bid and four of 11 ask levels kept, with bids out of order.

```json
{"e":"order_book_increment","data":{"seqId":8676230,"pair":"BTC-USD","bids":[["86775","0.05005228"],["86788.7","0.08928571"],["86786.1","0.06250000"],["86782.7","0.05000000"]],"asks":[["86875.1","3.95751531"],["86876.1","0.13000000"],["86891.9","0.01926295"],["86892.7","0.00109384"]]},"ok":"ok"}
```

A one-sided book and its increment, with a zero size deleting a level.

```json
{"e":"order_book_subscribe","oid":"1790135070650_5_order_book_subscribe","data":{"seqId":4435739,"pair":"COW-USD","bids":[],"asks":[["0.15454","2952.800000"],["0.15464","6615.500000"]]},"ok":"ok"}
```

```json
{"e":"order_book_increment","data":{"seqId":4435740,"pair":"COW-USD","bids":[],"asks":[["0.15517","905.000000"],["0.15522","99.800000"],["0.15528","0.000000"]]},"ok":"ok"}
```

Keepalive.

```json
{"e":"ping"}
```

```json
{"e":"pong"}
```

Errors.

```json
{"e":"order_book_subscribe","oid":"1790134178819_1_x","data":{"error":"Currency pair NOPE-USD is not supported"}}
```

```json
{"e":"nope_method","oid":"1790135284171_7_x","data":{"error":"Unsupported message type nope_method"}}
```

```json
{"e":"disconnected"}
```

Trade subscription, which delivered nothing further in 60 s.

```json
{"e":"trade_subscribe","oid":"1790135070650_6_trade_subscribe","data":{"reqId":"public-107_1789565815005_145911"},"ok":"ok"}
```

Ticker on request.

```json
{"e":"get_ticker","oid":"1790135070650_7_get_ticker","data":{"BTC-USD":{"bestBid":"86875.0","bestAsk":"86875.1","last":"86875.1","volume":"51.55342986","volumeUSD":"4438140.14","priceChangePercentage":"1.63"}},"ok":"ok"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://trade.cex.io/api/spot/ws` and an `auth` request with an API key, and trading through the API runs only on sub-accounts since 2023-11-13 (S2).

- Requests: `get_my_current_fee`, `get_fee_strategy`, `get_my_volume`, `do_create_account`, `get_my_account_status_v3`, `get_my_wallet_balance`, `get_my_orders`, `do_my_new_order`, `do_cancel_my_order`, `do_cancel_all_orders`, `get_my_transaction_history`, `get_my_funding_history`, `do_my_internal_transfer`, `get_deposit_address`, `do_deposit_funds_from_wallet`, `do_withdrawal_funds_to_wallet`, and the public book, ticker, candle and trade requests.
- Events: `executionReport`, `orderCancelReject`, `account_update`, `tradeHistorySnapshot`, `tradeUpdate`.
- CCXT Pro 4.5.68 calls `authenticate` before `watchOrderBook`, at `server/node_modules/ccxt/js/src/pro/cex.js` line 947, against the legacy URL, so CCXT Pro cannot watch a CEX.IO book without keys.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
CEX.IO lists no perpetual, so no feed is recommended for the engine as it stands.
If a later design adds spot legs, the feed would look like this.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://trade.cex.io/api/spot/ws-public` | one socket serves every pair |
| channel | `order_book_subscribe` per `rawMarketId` | snapshot on subscribe, a strict `seqId` chain, 20 levels matches the engine's `depthLevels` of 20 at [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61 |
| markets per connection | 30 to start, a larger slice untested | 30 ran with 0 gaps at 30 frames a second |
| subscribe frames | one frame per pair, `{"e": "order_book_subscribe", "oid": "<ms>_<n>_order_book_subscribe", "data": {"pair": "BTC-USD"}}`, paced under 100 a minute for the whole IP | one pair per request at 1 point, and an overrun closes the socket. The 792 `USD`, `USDT` and `USDC` pairs would take about 8 minutes to subscribe, and so would a full reconnect |
| keepalive | `{"e": "ping"}` every 5 s | the documented tolerance is 10 s, the wire's about 60 s |
| `maxSilenceMs` | 15,000 | three missed pongs. A quiet pair can go 7 s without a book frame, so the pong has to count as traffic |
| routing | `data.pair` is the `rawMarketId` | identical to CCXT `market.id` |
| snapshot | `e === 'order_book_subscribe'` with `data.seqId`: `resetBook` and store `seqId` | the reply is the snapshot |
| delta | apply only when `seqId === last + 1`, by price, and a zero size deletes | documented rule, 0 gaps observed |
| resync | `seqId !== last + 1`, or an increment before any snapshot: `resync`, which terminates the socket and resubscribes | a lower `seqId` is a documented restart, and a gap needs a new snapshot either way |
| request hygiene | every request carries `oid`, and only documented `e` values are sent | a missing `oid`, text that is not JSON, or an unknown `e` closes the socket |
| receive time | stamp on arrival | the book frames carry no time |
| staleness | treat a CEX.IO book as up to 1 s old | the public book is conflated to one increment a second per pair |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CEX.IO Spot Trading API documentation, "Last updated: 2026-03-19", sections "WebSocket", "Public API Calls" and "Private API Calls" | `https://trade.cex.io/docs/`, read as `https://web.archive.org/web/20260509143348/https://trade.cex.io/docs/` because the live page answers this host with 302 | 2026-09-22 | CEX.IO, global | URLs, request names and costs, keepalive, rate limit, book rules, maintenance, private names, sections 1 to 8 |
| S2 | Changes in API trading experience | https://support.cex.io/en/articles/8537084-changes-in-api-trading-experience | 2026-09-22 | CEX.IO, global | API orders only on sub-accounts from 2023-11-13, section 7 |
| S3 | CCXT Pro 4.5.68 `cex.js` | `server/node_modules/ccxt/js/src/pro/cex.js` | 2026-09-22 | CCXT | legacy URL, authenticate before `watchOrderBook`, sections 1 and 7 |
| P1 | `ws-probe.mjs book`, runs at 03:24, 03:38 and 03:44 UTC, the last with `COW-USD` | [`ws-probe.mjs`](../../../scripts/probes/venues/cex/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs batch`, runs at 03:30 and 03:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cex/ws-probe.mjs) | 2026-09-23 | this host | sections 3 and 5 |
| P3 | `ws-probe.mjs silence`, runs at 03:26 (60 s), 03:27 (110 s) and 03:46 (75 s) UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cex/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
| P4 | `ws-probe.mjs errors`, runs at 03:29 and 03:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cex/ws-probe.mjs) | 2026-09-23 | this host | sections 3 and 4 |
| P5 | `ws-probe.mjs deflate` and `legacy`, runs at 03:30 and 03:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cex/ws-probe.mjs) | 2026-09-23 | this host | sections 1, 4 and 5 |
