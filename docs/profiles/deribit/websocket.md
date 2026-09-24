# Deribit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 20:23 and 20:45 Pacific time, which is 2026-09-23 03:23 to 03:45 UTC.

This profile covers the public JSON-RPC WebSocket v2 of Deribit (CCXT id `deribit`) for both perpetual families, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/deribit/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation at `docs.deribit.com` answered this host with 200 and was read as Markdown, see section 9.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every family, public and private | `wss://www.deribit.com/ws/api/v2`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/deribit.js` line 36 | open in 437 to 519 ms over 19 sockets, P1 to P4 |
| testnet | `wss://test.deribit.com/ws/api/v2`, S1 | not probed |

One socket carries every family.
The book probe read `BTC_USDC-PERPETUAL`, `ETH_USDC-PERPETUAL`, `ALGO_USDC-PERPETUAL`, `NVDA_USDC-PERPETUAL` and the inverse `ETH-PERPETUAL` on one socket, and the batch probe read all 131 perpetuals on one socket, P1 and P2.
The host sits behind Cloudflare, which answered the upgrade with `server: cloudflare`, P4.
The matching engine is in London, "Deribit's primary servers are in London (Equinix LD4)", S7, so this host is about 145 ms of round trip away, see section 5.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| `book.{instrument}.{interval}` | snapshot then `change` deltas, `[action, price, amount]` | every level, interval `100ms` or `agg2`, and `raw` for authorised users only, S2 | 168, 159 and 164 frames in 57 s on BTC at `100ms` in three runs, 58, 59 and 56 at `agg2`, recommended |
| `book.{instrument}.{group}.{depth}.{interval}` | a whole window of `[price, amount]` pairs every time | depth `1`, `10` or `20`, group `none` or a price step, S3 | 166, 159 and 163 frames in 57 s on BTC at `none.20.100ms`, 20 levels a side |
| `quote.{instrument}` | best bid and ask with amounts | on change | 876 and 576 frames in 57 s on BTC |
| `ticker.{instrument}.{interval}` | mark, index, `current_funding`, `funding_8h`, `interest_value`, best bid and ask, stats | `100ms`, `agg2`, `raw` | 156 and 142 frames in 57 s on BTC at `100ms`, 50 and 43 on ALGO at `agg2` |
| `perpetual.{instrument}.{interval}` | `index_price`, `interest` (the instantaneous funding), `timestamp` | `100ms`, `agg2`, `raw`, "only for **perpetual** instruments", S4 | 83 and 105 frames in 57 s on BTC |
| `deribit_price_index.{index_name}` | index price | once a second | 61 and 60 frames in 57 s on `btc_usdc` |
| `deribit_price_ranking.{index_name}` | every index constituent with `enabled`, `weight`, `price`, `timestamp` | once a second | 60 or 61 frames in 57 s, the basket survey is in [`rest.md`](./rest.md) section 4 |
| `trades.{instrument}.{interval}`, `trades.{kind}.{currency}.{interval}` | trades | | acknowledged, not measured |
| `incremental_ticker.{instrument}`, `markprice.options.{index_name}`, `estimated_expiration_price.{index_name}`, `instrument.state.{kind}.{currency}`, `chart.trades.*` | | | not probed |
| `platform_state` | per index `locked` state, and `maintenance` when a break begins, S5 | on change | 151 frames in 57 s in both runs, each naming one index, such as `{"locked":false,"price_index":"alt_usdc","reasons":[]}` |

The channel names and intervals are from S1 to S5, and the frame counts from P1 and its reruns.
The ticker and perpetual channels carry the anchor numbers, but they are per instrument, so 131 ticker streams would be needed where one REST call serves all, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S1 | one socket served USDC linear and BTC or ETH inverse books together, section 1 |
| subscribe frame shape | JSON-RPC 2.0, `{"jsonrpc":"2.0","id":N,"method":"public/subscribe","params":{"channels":[...]}}`, and "you can break them into batches, e.g. 2 messages of 500 each", S6 | 17 channels in one call and 131 in one call, each acknowledged by one reply listing the channels |
| unknown symbol expectation | Not publicly specified for subscribe | `book.NOPE_USDC-PERPETUAL.100ms` answered `"result":[]` with no error and no frame. A call mixing it with a valid channel listed only the valid one |
| chunk unit and budget | `public/subscribe` costs 3,000 credits from a pool of 30,000, "~3.3 requests/second" sustained and a burst of 10, S8 | 131 channels in one call, all 131 snapshots within 624 ms and 603 ms of the call |
| keepalive mechanism | `public/set_heartbeat` with `interval` of at least 10 s. The server sends `heartbeat` and `test_request` messages, and the client answers a `test_request` with `public/test`, S9 | with interval 10 an idle socket got its first `test_request` 12.0 to 12.6 s after opening and then one every 10.6 to 10.7 s, each with a `heartbeat` frame beside it. A busy socket got 5 `test_request` frames in 57 s and no `heartbeat` frame, in all five busy runs |
| connection lifetime and maintenance notice | "WebSocket connections have no fixed expiration timer", S9. `platform_state` sends `maintenance: true` when a break begins, S5 | no lifetime cap in 122 s. No maintenance notice seen |
| handshake and operation rate limits | 32 connections per IP, "Any attempt to establish a 33rd connection from the same IP will be rejected with an HTTP 429", S9. Public requests are limited per IP at an unpublished rate, S8 | 437 to 519 ms per open, no refusal. The limits were not tested |
| public market data authentication | none, except `raw` intervals, S2 | `book.BTC_USDC-PERPETUAL.raw` answered error 13778 `raw_subscriptions_not_available_for_unauthorized` |
| message parse and routing | notifications are `{"jsonrpc":"2.0","method":"subscription","params":{"channel","data"}}` with no `id`, S10 | as documented. `params.data.instrument_name` names the instrument, and `params.channel` names the stream |
| subscribe acknowledgement shape | `result` is the list of subscribed channels, S6 | `{"jsonrpc":"2.0","id":3,"result":["ticker.BTC_USDC-PERPETUAL.100ms",...],"usIn":...,"usOut":...,"usDiff":1519,"testnet":false}`, in a different order from the request |
| symbol identifier format | `BTC_USDC-PERPETUAL`, `BTC-PERPETUAL`, S11 | identical to CCXT `market.id` and to the REST `instrument_name` on 131 of 131, see [`rest.md`](./rest.md) section 2 |
| number representation | JSON numbers | prices and amounts are JSON numbers, and deltas print them as floats such as `1054.0`, and at times in exponent form such as `2.2e3` |
| timestamp representation | `timestamp` in ms, "The timestamp of last change", S2 | integer ms. On the BTC `100ms` book the frame arrived a median 134 to 155 ms after its `timestamp` over three runs, and at most 1,416, 2,827 and 1,815 ms, see section 4 |
| size unit | "For perpetuals and futures, `amount` is in USD units", S2. The grouped channel's page says "For options and linear futures it is in the underlying base currency coin", S3 | base coin on the 129 linear perpetuals and USD on the 2 inverse perpetuals, section 4 |
| sequence semantics | "If `prev_change_id` equals the `change_id` of the previous message, it indicates that no messages were missed", S2 | 0 gaps in two 57 s runs on five books and in 9,626 and 11,436 frames on 131 books. A third run saw 1 gap each on the BTC, ETH and NVDA USDC books. `change_id` is one counter shared by many instruments, so it jumps between an instrument's frames |
| idle repeat behaviour | not documented | the full book channel sends nothing when a book is still, and `TOWNS_USDC-PERPETUAL` went 53.6 s without a frame. The grouped channel repeated an identical window 4, 2 and 1 times in 166, 159 and 163 frames |

## 4. The book channel in detail

`book.{instrument}.100ms` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each channel has `"type": "snapshot"`, a `change_id`, no `prev_change_id`, and every level of the book, each as `["new", price, amount]`.
In the first run the snapshot held 265 bids and 113 asks on `BTC_USDC-PERPETUAL`, 239 and 167 on `ETH_USDC-PERPETUAL`, 488 and 297 on `ETH-PERPETUAL`, 18 and 18 on `NVDA_USDC-PERPETUAL`, and 13 and 9 on `ALGO_USDC-PERPETUAL`.
The two reruns held 268 and 122, then 261 and 107, on BTC, and 490 and 307, then 473 and 309, on `ETH-PERPETUAL`.
Each channel got exactly one snapshot in 57 s.
In P2 all 131 perpetual snapshots arrived within 624 ms of the subscribe call, and within 603 ms in the rerun.
Subscribing the same channel a second time was acknowledged with the channel name and produced no second snapshot, so a feed cannot force a fresh snapshot by resubscribing on the same socket.

### Delta semantics

A delta has `"type": "change"`, `change_id`, `prev_change_id`, and `bids` and `asks` arrays of `[action, price, amount]`.
The action is `new`, `change` or `delete`, and a `delete` carries amount `0.0`.
On the BTC book in 57 s the deltas held 3,802 `new`, 971 `change` and 3,792 `delete` entries, and 3,274, 895 and 3,286 in the rerun, so most activity is levels appearing and disappearing.
A feed can apply every entry as "set the size at this price", deleting on a zero, and ignore the action word.
No delta arrived with both arrays empty.

### Sequence and gap rule

```text
type = snapshot                      replace the book, last = change_id
type = change, prev_change_id = last apply, last = change_id
type = change, prev_change_id ≠ last gap: resync
```

The rule held with 0 gaps on every delta of the first two book runs and of both batch runs.
The third book run, at 03:41 UTC, saw one gap on each of `BTC_USDC-PERPETUAL`, `ETH_USDC-PERPETUAL` and `NVDA_USDC-PERPETUAL`, and none on `ETH-PERPETUAL` or `ALGO_USDC-PERPETUAL`, so a feed has to expect a gap and resync.
`change_id` is not a per instrument counter.
The first snapshots in P1, whose timestamps lie within 301 ms of each other, read 193809616666 on NVDA, 193809618511 on ALGO, 193809618534 on ETH_USDC and 193809618858 on BTC_USDC, while `ETH-PERPETUAL` read 136069961946, so the USDC instruments share one counter and the inverse ETH book another.
The chain is kept per channel through `prev_change_id`, never by adding one.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 5 of 5 books | best first, ascending, on 5 of 5 |
| delta | descending, 0 unordered arrays on 5 books in three runs of 57 s | ascending, 0 unordered |
| grouped `none.20.100ms` | descending | ascending |
| REST `get_order_book` | descending, at depth 20 and 10,000 | ascending |

A feed still applies deltas by price, which the engine's `setBid` and `setAsk` do.

### Level window

The channel has no window.
"This channel delivers the complete order book with no depth restriction", S2, and the maintained BTC book held 268 bids and 120 asks at the end of P1.
The engine publishes its top 20 from the full book, so nothing is lost at the edge.

### Size unit against CCXT `contractSize`

| instrument | catalog `contract_size` | CCXT `contractSize` | socket size at the touch | what the size is |
|---|---:|---:|---|---|
| `BTC_USDC-PERPETUAL` | 0.0001 | 0.0001 | `0.0012` bid, `0.3001` ask | BTC |
| `NVDA_USDC-PERPETUAL` | 0.01 | 0.01 | `0.22` bid, `0.34` ask | shares |
| `ALGO_USDC-PERPETUAL` | 1 | 1 | `8` bid, `134051` ask in the REST read | ALGO |
| `ETH-PERPETUAL` | 1 | 1 | `2700` bid, `53` ask | USD |

On the linear perpetuals the amount is in the base coin, a multiple of `contract_size`, and not a count of contracts.
Every REST size on BTC was a multiple of 0.0001, 388 of 388 at depth 10,000, and the same held on NVDA and ALGO, P5.
The Linear Perpetual page says the same: "one BTC_USDC-PERPETUAL contract represents 0.0001 BTC. Order amounts are expressed in the same unit", S12.
The book channel page's "amount is in USD units" is wrong for the linear perpetuals.
On the inverse perpetuals the amount is USD, "an order amount of 1,000 on BTC-PERPETUAL is 1,000 USD, which is 100 contracts", S13.

CCXT sets `contractSize` to the catalog `contract_size` at `server/node_modules/ccxt/js/src/deribit.js` line 998.
The engine multiplies every book size by `contractSize`, so an unmodified Deribit feed would read the BTC touch of 0.0012 BTC as 0.00000012 BTC, 10,000 times too small, and every other linear book too small by its `contract_size`.
The fix is the registry's existing `contractSize: 1` pin, as Gemini uses, together with a `marketFilter` that keeps `linear === true`, since a pin of 1 would read the inverse books' USD as coins.
The quote family already ranks the linear `BTC_USDC-PERPETUAL` and `ETH_USDC-PERPETUAL` before the inverse contracts on the same pairs, see [`rest.md`](./rest.md) section 2.

### Delivery delay against REST

The third book run read a REST book of 20 levels every 5 s while the socket stayed open, eleven reads in all, and compared it with the book kept from the socket at that instant.
In 5 reads the two had the same touch, and 35 to 40 of 40 sizes matched at the same price, with the REST `timestamp` 10 to 110 ms after the last socket frame's `timestamp`.
In the other 6 the touch differed, 2 to 24 of 40 sizes matched, and the REST `timestamp` was 241 to 1,579 ms after the last socket frame's, while each REST reply was only 74 to 329 ms old on arrival.
So at those moments the `100ms` socket book trailed the REST book by a quarter of a second to one and a half seconds.
The frame ages say the same: on the BTC USDC book frames arrived a median 134 to 155 ms after their `timestamp` over three runs, but the p90 was 323, 1,311 and 652 ms and the maximum 1,416, 2,827 and 1,815 ms.
The inverse `ETH-PERPETUAL` book on the same socket never arrived more than 603 ms late, with a median of 83 to 92 ms and a p90 of 123 to 140 ms.
Whether the delay is Deribit's USDC publisher, Cloudflare, or the `100ms` aggregation, and whether the authenticated `raw` interval avoids it, is Not verified.

### One-sided and empty books

`ALGO_USDC-PERPETUAL` held 13 bids and 9 asks, the thinnest book read.
No one-sided or empty book was seen, so what the channel sends for a side with no orders is Not verified.
The snapshot's arrays are lists, so an empty side would presumably arrive as `[]`, which the engine's `resetBook` accepts.

### Idle repeats

The full book channel repeats nothing.
A still book sends no frame, and in P2 two instruments went more than 30 s without one, the longest `TOWNS_USDC-PERPETUAL` at 53.6 s.
The grouped channel resends its whole window when the book changes, and 4, 2 and 1 of 166, 159 and 163 BTC frames equalled the frame before, presumably after a change deeper than 20 levels.

### Unknown, closed and wrong-parameter channels

| request | reply | then |
|---|---|---|
| `book.NOPE_USDC-PERPETUAL.100ms` | `"result":[]` | nothing |
| `book.BTC_USDC-PERPETUAL.50ms` | `"result":[]` | nothing |
| `book.BTC_USDC-PERPETUAL.none.50.100ms` | `"result":[]` | nothing |
| `book.BTC_USDC-PERPETUAL.raw` without auth | error 13778 `raw_subscriptions_not_available_for_unauthorized` | |
| `book.BTC_USDC-PERPETUAL.100ms` a second time | `"result":["book.BTC_USDC-PERPETUAL.100ms"]` | the first stream keeps delivering, no new snapshot |
| `book.NOPE_USDC-PERPETUAL.100ms` with `trades.ALGO_USDC-PERPETUAL.100ms` in one call | `"result":["trades.ALGO_USDC-PERPETUAL.100ms"]` | |
| `public/nope` | error -32601 `Method not found` | |
| `private/subscribe` without auth | error 13009 `unauthorized`, reason `invalid_token` | |
| text that is not JSON | error 11050 `bad_request`, data `invalid json`, with no `id` | the socket stays open |
| a request without `id` | answered with a `result` and no `id` | the documentation says such a request is rejected, S10 |

A closed or expired perpetual was not available to probe.
The documented error for a closed book is 13019 `orderbook_closed`, S14.
Because a bad channel is dropped silently from `result`, a feed has to compare the acknowledged list with what it asked for.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `public/set_heartbeat` with `interval` of at least 10 s, and answer each `test_request` with `public/test`. "If your client fails to respond to a `test_request`, the API server immediately closes the connection", S9 | a socket that set interval 10 and never answered was closed 10.0 s after its first `test_request`, at 22.5 s and 22.6 s in two runs, with code 4000 and reason `heartbeat close`. `public/test` answers came back in 138 to 158 ms |
| silence the server tolerates | Not publicly specified | a socket that sent nothing and subscribed nothing closed at 60.5 s with code 1006 and no close frame, in three runs. A socket with one quiet `agg2` book subscription and no heartbeat stayed open for the whole hold of 122, 90 and 65 s, and a heartbeat socket that answered for 90 and 65 s |
| forced disconnect | a client too slow to read gets `connection_too_slow`, S9 | none seen |
| maintenance notice | `platform_state` with `maintenance: true`, S5 | not observed |
| compression | Not publicly specified | text JSON frames when deflate is refused. A client that offers permessage-deflate gets `permessage-deflate; client_max_window_bits=15` back, so the server negotiates it on request, P4 |
| handshake | | 437 to 519 ms to open |
| subscription limits | up to 500 channels per call suggested, S6. `public/subscribe` at about 3.3 calls per second sustained, burst 10, S8. 32 connections per IP, S9 | 131 channels in one call, acknowledged in one reply |
| throughput | | 131 perpetuals on `100ms`: 9,626 frames in 60 s, median 153 frames per second, peak 242, 68 KB per second, 437 bytes per frame, 8 µs `JSON.parse` per frame. The rerun: 11,436 frames, median 187, peak 392, 95 KB per second, 509 bytes, 11 µs |

The server clock read through `public/get_time` led the local clock by 1 to 34 ms, see [`rest.md`](./rest.md) section 7.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Level arrays are cut to their first entries.

Subscribe, trimmed to three of the probe's 17 channels.

```json
{"jsonrpc": "2.0", "id": 3, "method": "public/subscribe", "params": {"channels": ["book.BTC_USDC-PERPETUAL.100ms", "book.ETH-PERPETUAL.100ms", "book.BTC_USDC-PERPETUAL.none.20.100ms"]}}
```

Acknowledgement, trimmed to three channels.

```json
{"jsonrpc":"2.0","id":3,"result":["book.ETH-PERPETUAL.100ms","book.BTC_USDC-PERPETUAL.none.20.100ms","book.BTC_USDC-PERPETUAL.100ms"],"usIn":1790133840888348,"usOut":1790133840889867,"usDiff":1519,"testnet":false}
```

Snapshot, first three levels per side kept.
The amounts are shares of NVDA.

```json
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.NVDA_USDC-PERPETUAL.100ms","data":{"timestamp":1790133840448,"type":"snapshot","change_id":193809616666,"instrument_name":"NVDA_USDC-PERPETUAL","bids":[["new",228.51,0.22],["new",228.48,0.34],["new",228.43,0.43]],"asks":[["new",228.52,0.34],["new",228.54,87.94],["new",228.55,0.43]]}}}
```

Snapshot of the inverse book, whose amounts are USD.

```json
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.ETH-PERPETUAL.100ms","data":{"timestamp":1790133840638,"type":"snapshot","change_id":136069961946,"instrument_name":"ETH-PERPETUAL","bids":[["new",2772.65,2700],["new",2772.6,7414],["new",2772.55,7697]],"asks":[["new",2772.7,53],["new",2773.05,4200],["new",2773.1,35]]}}}
```

Two deltas.

```json
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.NVDA_USDC-PERPETUAL.100ms","data":{"timestamp":1790133845258,"type":"change","change_id":193809650259,"instrument_name":"NVDA_USDC-PERPETUAL","bids":[],"asks":[["change",228.58,91.89]],"prev_change_id":193809644396}}}
```

```json
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.ALGO_USDC-PERPETUAL.100ms","data":{"timestamp":1790133842703,"type":"change","change_id":193809634213,"instrument_name":"ALGO_USDC-PERPETUAL","bids":[["new",0.11374,1054.0],["new",0.11363,308897.0],["delete",0.11344,0.0]],"asks":[["new",0.11396,1054.0],["new",0.11411,1931.0]],"prev_change_id":193809631160}}}
```

Grouped 20 level window, three levels per side kept.

```json
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.BTC_USDC-PERPETUAL.none.20.100ms","data":{"timestamp":1790133841369,"change_id":193809623552,"instrument_name":"BTC_USDC-PERPETUAL","bids":[[86775.8,0.216],[86773.4,0.0477],[86772.9,0.0002]],"asks":[[86776.0,0.0009],[86778.0,0.3001],[86778.5,0.0361]]}}}
```

Keepalive: the heartbeat request, the server's test request, and the client's answer.

```json
{"jsonrpc": "2.0", "id": 1, "method": "public/set_heartbeat", "params": {"interval": 10}}
```

```json
{"params":{"type":"test_request"},"method":"heartbeat","jsonrpc":"2.0"}
```

```json
{"jsonrpc": "2.0", "id": 12, "method": "public/test", "params": {}}
```

Errors.

```json
{"jsonrpc":"2.0","id":5,"error":{"code":13778,"message":"raw_subscriptions_not_available_for_unauthorized"},"usIn":1790133842785065,"usOut":1790133842785140,"usDiff":75,"testnet":false}
```

```json
{"jsonrpc":"2.0","id":4,"result":[],"usIn":1790133842384561,"usOut":1790133842384654,"usDiff":93,"testnet":false}
```

```json
{"jsonrpc":"2.0","error":{"code":11050,"data":"invalid json","message":"bad_request"},"usIn":1790133844787014,"usOut":1790133844787041,"usDiff":27,"testnet":false}
```

Ticker and perpetual channels, which carry the anchor fields.

```json
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"ticker.BTC_USDC-PERPETUAL.100ms","data":{"timestamp":1790133840887,"state":"open","index_price":86744.11,"instrument_name":"BTC_USDC-PERPETUAL","last_price":86773.6,"settlement_price":85380.58,"min_price":85476.4,"max_price":88079.9,"open_interest":459.3409,"mark_price":86778.14,"interest_value":272719551.2863254,"current_funding":1.423e-4,"estimated_delivery_price":86744.11,"funding_8h":5.149e-5,"best_ask_price":86778.0,"best_bid_price":86775.9,"best_ask_amount":0.3001,"best_bid_amount":0.0645}}}
```

```json
{"jsonrpc":"2.0","method":"subscription","params":{"channel":"perpetual.BTC_USDC-PERPETUAL.100ms","data":{"index_price":86744.11,"interest":1.423032929843748e-4,"timestamp":1790133840887}}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL after `public/auth`.

- `user.orders.{instrument}.{interval}`, `user.orders.{kind}.{currency}.{interval}`, `user.trades.{instrument}.{interval}`, `user.trades.{kind}.{currency}.{interval}`, `user.changes.{instrument}.{interval}`, `user.portfolio.{currency}`, `user.access_log`, `user.lock`, `user.liquidation`, `user.mmp_trigger.{index_name}`.
- Order entry is `private/buy`, `private/sell`, `private/edit` and `private/cancel`, which CCXT lists at `server/node_modules/ccxt/js/src/deribit.js` lines 244 to 248 and calls at line 2150.
- Cancel on disconnect exists at connection or account scope, S9.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://www.deribit.com/ws/api/v2`, for the 129 linear perpetuals | one socket carries every family, and the inverse pair is filtered out, section 4 |
| channel | `book.<rawMarketId>.100ms` | snapshot on subscribe, a `prev_change_id` chain, every level, and no auth needed |
| alternative channel | `book.<rawMarketId>.none.20.100ms`, resetting the book on every frame | a whole 20 level window each time needs no gap rule, but a still book never resends, and a missed frame is invisible |
| markets per connection | all 129 on one socket | 131 books ran with 0 gaps at a median 153 and 187 frames per second in two runs, well under the 500 channel call size |
| subscribe frames | one `public/subscribe` call with every channel, sent after `public/set_heartbeat` | one reply acknowledges the list, and subscribe calls are limited to about 3.3 per second |
| acknowledgement check | compare `result` with the requested list and log any channel missing | an unknown or malformed channel is dropped without an error |
| keepalive | `{"jsonrpc":"2.0","id":N,"method":"public/set_heartbeat","params":{"interval":10}}` once per socket, then answer every `test_request` with `public/test` | the server closes a socket 10 s after an unanswered `test_request`, and an idle socket dies at 60 s |
| `maxSilenceMs` | 35,000 | a `test_request` arrives about every 10.6 s, so three missed is a dead socket, while a still book can go 53.6 s without a frame, so the heartbeat has to count as traffic |
| routing | `params.data.instrument_name` is the `rawMarketId` | identical to CCXT `market.id` |
| snapshot | `type === 'snapshot'`: `resetBook` from `[, price, amount]` and store `change_id` | documented |
| delta | apply only when `prev_change_id === last`, then store `change_id` | documented rule, 0 gaps in four runs and one gap on three books in a fifth |
| resync | `prev_change_id !== last`, or a `change` before any snapshot: `resync`, which terminates the socket and resubscribes | a second subscribe on the same socket does not resend the snapshot |
| sizes | the amount as is, with the registry's `contractSize: 1` pin and `marketFilter: (m) => m.linear === true` | linear amounts are base coins, and CCXT's `contractSize` would shrink them by up to 10,000 |
| receive time | stamp on arrival, never from `timestamp` | `timestamp` is the book's last change |
| staleness | expect the USDC books to trail the REST book by up to about 1.6 s at times | section 4, delivery delay against REST |
| other frames | ignore `platform_state` index lock frames unless a later design wants them, and log `maintenance` | 151 lock frames arrived in 57 s |
| deflate | keep `perMessageDeflate: false` | the server negotiates deflate only when the client asks |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Deribit API documentation index | https://docs.deribit.com/llms.txt and https://docs.deribit.com/_llms/production/api-reference.md | 2026-09-22 | Deribit, all | URLs, channel names, private channel names, sections 1, 2 and 7 |
| S2 | `book.(instrument_name).(interval)` | https://docs.deribit.com/subscriptions/orderbook/bookinstrument_nameinterval.md | 2026-09-22 | Deribit, all | snapshot, `prev_change_id`, no depth limit, unit claim, intervals, sections 2 to 4 |
| S3 | `book.(instrument_name).(group).(depth).(interval)` | https://docs.deribit.com/subscriptions/orderbook/bookinstrument_namegroupdepthinterval.md | 2026-09-22 | Deribit, all | grouped channel, depth 1, 10, 20, unit claim, sections 2 and 3 |
| S4 | `perpetual.(instrument_name).(interval)` | https://docs.deribit.com/subscriptions/market-data/perpetualinstrument_nameinterval.md | 2026-09-22 | Deribit, all | perpetual channel, section 2 |
| S5 | `platform_state` | https://docs.deribit.com/subscriptions/platform/platform_state.md | 2026-09-22 | Deribit, all | lock and maintenance fields, sections 2 and 5 |
| S6 | Market Data Collection Best Practices | https://docs.deribit.com/articles/market-data-collection-best-practices.md | 2026-09-22 | Deribit, all | batching up to 500 channels, gap detection, section 3 |
| S7 | same page, "Optimize your network location" | https://docs.deribit.com/articles/market-data-collection-best-practices.md | 2026-09-22 | Deribit, all | London LD4, section 1 |
| S8 | Rate Limits | https://docs.deribit.com/articles/rate-limits.md | 2026-09-22 | Deribit, all | subscribe credits, per IP public limit, sections 3 and 5 |
| S9 | Connection Management Best Practices | https://docs.deribit.com/articles/connection-management-best-practices.md | 2026-09-22 | Deribit, all | 32 connections per IP, heartbeats, `connection_too_slow`, no expiry, sections 3 and 5 |
| S10 | JSON-RPC overview | https://docs.deribit.com/articles/json-rpc-overview.md | 2026-09-22 | Deribit, all | notification shape, requests without `id`, sections 3 and 4 |
| S11 | `public/get_instruments` | https://docs.deribit.com/api-reference/market-data/public-get_instruments.md | 2026-09-22 | Deribit, all | instrument names, section 3 |
| S12 | Linear Perpetual | https://support.deribit.com/hc/en-us/articles/31424969384605-Linear-Perpetual, read through the help center JSON API | 2026-09-22 | Deribit, all | linear amounts in the coin, section 4 |
| S13 | Inverse Perpetual | https://support.deribit.com/hc/en-us/articles/31424954847133-Inverse-Perpetual, read through the help center JSON API | 2026-09-22 | Deribit, all | inverse amounts in USD, section 4 |
| S14 | Error codes | https://docs.deribit.com/articles/errors.md | 2026-09-22 | Deribit, all | 13019 `orderbook_closed`, section 4 |
| S15 | CCXT Pro 4.5.68 `pro/deribit.js` and CCXT 4.5.68 `deribit.js` | `server/node_modules/ccxt/js/src/pro/deribit.js`, `server/node_modules/ccxt/js/src/deribit.js` | 2026-09-22 | CCXT | WS URL at line 36, `contractSize` at line 998, private methods at lines 244 to 248 and 2150, sections 1, 4 and 7 |
| P1 | `ws-probe.mjs book` at 03:24, 03:39 and 03:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deribit/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs batch` at 03:27 and 03:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deribit/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P3 | `ws-probe.mjs silence`, runs at 03:28, 03:30 and 03:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deribit/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P4 | `ws-probe.mjs deflate` at 03:23 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deribit/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P5 | `rest-probe.mjs book` at 03:22 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deribit/rest-probe.mjs) | 2026-09-22 | this host | REST sizes against `contract_size`, section 4 |
