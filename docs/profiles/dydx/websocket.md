# dYdX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:26 to 22:39 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers the public WebSocket of the dYdX Indexer (CCXT id `dydx`), with the book channel in detail.
dYdX lists one perpetual family, USD-quoted markets settled in USDC, and one socket carries all of it.
Every probed claim comes from [`ws-probe.py`](../../../scripts/probes/venues/dydx/ws-probe.py), run from the repository root with `uv run`, and the runs are listed as P1 to P8 in section 9.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The Indexer source is cited at commit `bd2dd7d` of `dydxprotocol/v4-chain`, the head of `main` on 2026-10-12, and the deployed Indexer may run an older build.
Fees and access are in [`fees.md`](./fees.md), and the REST API, the anchor and the decentralised layer in [`rest.md`](./rest.md).
All times are UTC.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every perpetual, mainnet | `wss://indexer.dydx.trade/v4/ws`, S5, and CCXT Pro at `pro/dydx.js` line 29 | upgraded with 101 in 316 to 597 ms, P1 to P4 and P8, through Cloudflare (`server: cloudflare`, `cf-ray` ending `-SEA` or `-YVR`) |
| testnet | `wss://indexer.v4testnet.dydx.exchange/v4/ws`, S5 | not probed |

One socket carries every market and every public channel.
The upgrade reply carried no `geo-origin-*` header, while every REST reply did, see [`rest.md`](./rest.md) section 1.
No public channel refused this host, although the REST replies classify it as `restricted`.

## 2. Channel matrix for public market data

| channel | subscribe frame | payload | documented cadence | probed |
|---|---|---|---|---|
| `v4_orderbook` | `{"type":"subscribe","channel":"v4_orderbook","id":"BTC-USD"}` | a snapshot of up to 100 levels a side, then one delta per change, S1 and S3 | not stated | 7,716 to 7,926 frames a second and 1,492 to 1,535 KiB a second over all 73 books, P2, P3 and P8 |
| `v4_orderbook` batched | adds `"batched":true` | `channel_batch_data` whose `contents` is a list of deltas | S6 sends batches every `BATCH_SEND_INTERVAL_MS`, 250 ms by default | 120.8 to 123.5 frames a second for 32 books, 1 to 166 deltas a frame, P4 and P8 |
| `v4_markets` | `{"type":"subscribe","channel":"v4_markets"}`, no `id` | every market on subscribe, then `oraclePrices` and `trading` updates | "updates to all markets, including market parameters and oracle prices", S1 | subscribe reply 167,330 bytes for 296 markets. Each oracle frame carried one market, 56 frames in 30 s in P5 and 11 in P8 |
| `v4_block_height` | `{"type":"subscribe","channel":"v4_block_height"}` | `blockHeight` and `time` | "the last block height and time", S1 | one frame per block, block times 509 to 1,082 ms apart with a median of 613 and 626 ms, P5 and P8 |
| `v4_trades` | `{"type":"subscribe","channel":"v4_trades","id":"BTC-USD"}` | fills on the market | S1 | acknowledged in P6, not measured |
| `v4_candles` | `id` `BTC-USD/1MIN` | the open candle | S1 | not probed |

There is no channel for a mark price, an index other than the oracle, or a best bid and ask.
The oracle price and the predicted funding rate travel on `v4_markets`, and [`rest.md`](./rest.md) section 3 weighs them against the REST poll.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one mainnet URL, S5 | one socket carried all 73 books and the market and block channels, section 1 |
| subscribe frame shape | `{"type":"subscribe","channel":..., "id":..., "batched":...}`, one subscription per frame, S1 | one frame per market, sent 30 ms apart, all acknowledged, P2 to P8 |
| unknown symbol expectation | Not publicly specified | an `error` frame, `"Invalid subscription id for channel: (v4_orderbook-FOO-USD)"`, with no `channel` or `id` field, and the socket stays open. A lowercase id gets the same error, P6 and P8 |
| chunk unit and budget | Not publicly specified. S6 caps `v4_orderbook` and `v4_markets` at 32 subscriptions a connection | the 33rd book got `"Per-connection subscription limit reached for v4_orderbook (limit=32)."` and the socket stayed open, P6 and P8 |
| keepalive mechanism | "Every 30 seconds, the WebSockets API will send a heartbeat ping control frame", and no pong within 10 s disconnects, S2 | a protocol ping 30.0 s after each open, P2 to P4, P7 and P8, and a socket that did not answer was closed with 1011 `Heartbeat timeout` at 40.0 and 40.1 s, P7 and P8. An application frame `{"type":"ping"}` gets no reply, P6 |
| connection lifetime and maintenance notice | none documented. S12 defines close codes 1001 going away, 1012 service restart and 4008 subscription limit abuse | no close other than the heartbeat timeout of P7 and P8, and no socket lived past 41 s, so a lifetime cap was not tested |
| handshake and operation rate limits | "2 subscriptions per (connection + channel + channel ID) per second" and "2 invalid messages per connection per second", S2. Breaking the subscribe limit sends an error and closes the socket with 1008, S8 lines 446 to 455 | 73 subscribe frames over 3 sockets in about 1 s, and five invalid frames 0.7 s apart, without a close, P2 to P8 |
| public market data authentication | none | none |
| message parse and routing | `{type, connection_id, message_id, channel, id, version, contents}`, S1 | route on `type`, then `channel`, then `id`, which carries the ticker exactly as subscribed |
| subscribe acknowledgement shape | `type` `subscribed` with the initial `contents`, S1 | the acknowledgement is the snapshot itself, 107 to 1,225 ms after the subscribe frame, P2, P3 and P8 |
| symbol identifier format | the ticker, `BTC-USD`, S1 | `BTC-USD`, equal to CCXT `market.id` on 73 of 73, see [`rest.md`](./rest.md) section 2 |
| number representation | not stated | prices and sizes are decimal strings, `message_id` is an integer, P2 to P8 |
| timestamp representation | `effectiveAt` and `time` as ISO 8601 on `v4_markets` and `v4_block_height`, S1 | book frames carry no timestamp at all, P2 to P8 |
| size unit | Not publicly specified | base coins, the unit CCXT's `contractSize` 1 describes, section 4 |
| sequence semantics | `message_id` is the "Message sequence number sent on the subscription", S1 | one counter per connection over every frame it sends, section 4 |
| idle repeat behaviour | not documented | no frame for a book that did not change. Every one of the 73 books changed within each run, so the longest quiet spell was not measured |

## 4. The book channel in detail

### Snapshot on subscribe

The `subscribed` frame for `v4_orderbook` is the whole book that the Indexer's REST API would return, with up to 100 levels a side as `{"price","size"}` objects, S9 and P2.
Snapshots held 20 to 100 levels on the larger side, with `ZORA-USD` at 20 and `ZEC-USD` and others at 100, P2, P3 and P8.
Bids arrived highest first and asks lowest first in all 73 snapshots of every run.
The largest snapshot frame was 7,469 bytes, P8.
No snapshot was one-sided or empty in any run.

### Deltas

A `channel_data` frame carries `contents` with `bids`, `asks` or both, each a list of `[price, size]` string pairs, and each pair is the new total size at that price.
A size of `"0"` removes the level, and 53,986 to 65,608 removals arrived in each run of 30 to 35 s, P2, P3 and P8.
Almost every frame carried one level: 237,574 to 275,287 pairs arrived in about as many frames.
No pair carried a third element, although the docs' sample code reads an optional offset there, S3.
No delta for a market arrived before its snapshot in any run.

### Sequence and the gap rule

`message_id` is one counter per connection, and it counts the data frames, the acknowledgements and the errors that answer a subscribe, S7 lines 310 and 342, S8 and S10 lines 456 and 518.
The server takes the next number when it reads a subscribe frame, then fetches the snapshot, and sends it when the fetch returns, S7 lines 309 to 326 and S8 lines 469 to 471.
So a snapshot arrives with a number lower than the data frames already received, and the ids step backwards and forwards until the last snapshot of the connection is in, P2.
After that, every data frame stepped by exactly 1: 107,847, 98,052 and 27,965 frames on three connections in P3, 98,560, 113,132 and 28,129 in P8, and 3,670 and 3,585 batched frames in P4 and P8.
In P8 the first data frame after each connection's last snapshot jumped by 25, 52 and 1,409 from that snapshot's own number, which is the snapshot's stale number and not a loss.
P3 recorded one jump of 28 on one connection without its time, which fits the same shape.
So a feed re-anchors on the first data frame after the connection's last snapshot, then resyncs on any step that is not 1.
An error that refuses a subscribe takes the number its subscribe took, so in steady state it steps the chain by 1.
An error for a frame the server cannot use, such as an unknown channel, a missing channel or text that is not JSON, repeats the number of the frame before it, as S7's validation path sends `connection.messageId` without adding 1.
Corrected on 2026-10-12 at 23:16 UTC, when frames 921, error 921 and 922 came around an unknown channel and frames 1236, error 1237 and 1238 around an unknown ticker.
So a feed re-anchors after any error frame.

### Checksum

None documented and none on the wire.

### Crossed books

The docs warn that "sometimes, some of the bids will be higher than some of the asks", because the book is the view of the full node the Indexer listens to, not of the block proposer, and they recommend removing the older crossing level, S3.
Order book updates are sent "when the full-node the Indexer is listening to receives orders / cancels and not just when the block is finalized", S4.
A server task runs every 15 s and deletes crossing levels older than 10 s from the Indexer's own copy of the book, S11, and it sends no socket message, so a socket client never hears of it.
No book was crossed after any frame, over all 73 books for about 30 s in each of P2, P3 and P8, and over 32 books for 30 s in each of P4 and P8.
Two REST sweeps of all 73 books found none crossed either, see [`rest.md`](./rest.md) section 5.
The rule still has to exist, since the docs promise the case and a crossed level is a stale quote.
On 2026-10-12 the adapter's 90 s smoke over all 73 books dropped crossing levels 3 times from 23:07 UTC, the first an `ETH-USD` ask that a newer bid crossed, and none in a second 90 s run from 23:14 UTC.

### The snapshot window

The server fetches the snapshot before it adds the connection to the market's subscribers, S8 lines 469 to 605.
A change published between the fetch and that registration reaches no one on this connection, so its level keeps the snapshot's size until the price changes again.
That is a source reading, not a probe result.
Against a REST read taken while the socket ran, the touch matched on `BTC-USD`, `ETH-USD`, `SOL-USD` and `JTO-USD` in both unbatched runs, P3 and P8.
In those runs 14 to 20 of the top 20 levels matched with size, while the REST read itself took 339 to 453 ms.
The batched runs P4 and P8 each missed one bid at the touch, which batching delays by up to 250 ms.

### Level order on the wire

Snapshots are sorted, bids descending and asks ascending, P2 to P8.
Deltas are single levels in no order, so a feed keeps each side in a sorted map.

### Size unit against CCXT `contractSize`

Sizes are base coins: `BTC-USD` levels such as `0.0605` at 82,552 USD and `1INCH-USD` levels such as `21792690` at 0.02437 USD, P2 and P3.
CCXT sets `contractSize` 1 at `dydx.js` line 542 with the comment "trades seem in absolute size", and the venue's `stepSize` is in the same coins, see [`rest.md`](./rest.md) section 2.
So book size times 1 is base coins.

### One-sided and empty books

None of the 73 books was one-sided at snapshot time in any run.
A delta that empties a side leaves that side empty until a level arrives, and the feed publishes the one-sided book as it stands.

### Unknown, closed and malformed subscriptions

| case | reply | socket |
|---|---|---|
| unknown ticker `FOO-USD` | `{"type":"error","message":"Invalid subscription id for channel: (v4_orderbook-FOO-USD)","connection_id":...,"message_id":...}`, with no `channel` or `id` field, and the same text with `v4_trades` on that channel | stays open, P6 and P8 |
| lowercase `btc-usd` | the same error | stays open |
| unknown channel | `"Invalid channel: v4_nosuch"` | stays open |
| not JSON | `"Invalid message: could not parse"` | stays open |
| 33rd book on a connection | `"Per-connection subscription limit reached for v4_orderbook (limit=32)."` | stays open |
| duplicate below the cap | `"Invalid subscribe message: already subscribed (v4_orderbook-1INCH-USD)"`, the one error that carries `channel` and `id` fields, S8 line 561 | stays open, P8 |
| unsubscribe of something not subscribed | `{"type":"unsubscribed",...}` | stays open |

The socket checks ids against a market list it refreshes every 5 minutes, S6 line 100 and S8 from line 715, so a market listed in the last 5 minutes may be refused for that long.
A market in `FINAL_SETTLEMENT` was not subscribed, and the loader drops it before the feed sees it.

## 5. Session

| item | value | evidence |
|---|---|---|
| server ping | a protocol ping every 30 s | S2, S6 line 33, P2, P3, P7 and P8 |
| pong deadline | 10 s, then close 1011 `Heartbeat timeout` | S2, S6 line 34, close at 40.1 and 40.0 s in P7 and P8 |
| application ping | `{"type":"ping"}` is accepted and answered with nothing | S7 line 357, P6 |
| silence the server tolerates | a client that answers pings may stay silent, no other idle rule was found | P2 to P8 |
| compression | `permessage-deflate` was not negotiated even when offered, P1 and P8. S6 line 88 rolls it out to a percentage of offering clients, 0 by default, and a Rust client that offers nothing is unaffected | P1, P8, S6 |
| largest client frame | 65,536 bytes, larger closes with 1009 | S6 line 96 |
| subscriptions per connection | 32 for `v4_orderbook`, `v4_markets`, `v4_trades` and `v4_candles`, 256 for the account channels | S6 lines 115 to 120, P6 |
| subscribe pace | 2 a second for one channel and id on one connection | S2, S6 line 37 |
| abuse penalty | a client that keeps hitting the cap can be dropped with 4008 and refused with HTTP 429 for 30 s, behind a switch that is off by default | S6 lines 44 to 79 |
| handshake time | 316 to 597 ms | P1 to P4 and P8 |

## 6. Captured frames

Connection acknowledgement, P1:

```json
{"type":"connected","connection_id":"e279170f-a6af-4040-a1e9-d567a982ceb6","message_id":0}
```

Snapshot on subscribe, trimmed to three levels a side, P3:

```json
{"type":"subscribed","connection_id":"46b2e96a-3a8b-4764-aa89-e58cf229dea1","message_id":480,"channel":"v4_orderbook","id":"BTC-USD","contents":{"bids":[{"price":"82483","size":"0.0606"},{"price":"82467","size":"0.0001"},{"price":"82463","size":"0.1212"}],"asks":[{"price":"82510","size":"0.1211"},{"price":"82541","size":"0.1797"},{"price":"82543","size":"2.396"}]}}
```

Delta, P2:

```json
{"type":"channel_data","connection_id":"2a23783b-28bd-4df6-acc0-f31fd63b1895","message_id":3,"id":"1INCH-USD","channel":"v4_orderbook","version":"1.0.0","contents":{"bids":[["0.02437","21792690"]]}}
```

Batched delta, trimmed to two of 73 entries, P8:

```json
{"type":"channel_batch_data","connection_id":"7b64d9ef-0ca6-4a0f-924a-b55f3a5d3ba0","message_id":6,"id":"ADA-USD","channel":"v4_orderbook","version":"1.0.0","contents":[{"asks":[["0.2489","272420"]]},{"bids":[["0.2325","58860590"]]}]}
```

Oracle update on `v4_markets`, P8:

```json
{"type":"channel_data","connection_id":"5ce11f8f-16ce-4a73-97ed-dd5a4412fd75","message_id":18,"channel":"v4_markets","version":"1.0.0","contents":{"oraclePrices":{"NEAR-USD":{"oraclePrice":"5.163803435","effectiveAt":"2026-10-12T22:37:40.130Z","effectiveAtHeight":"109168425","marketId":16}}}}
```

Block height, P8:

```json
{"type":"channel_data","connection_id":"5ce11f8f-16ce-4a73-97ed-dd5a4412fd75","message_id":3,"id":"v4_block_height","channel":"v4_block_height","version":"1.0.0","contents":{"blockHeight":"109168410","time":"2026-10-12T22:37:30.468Z"}}
```

The cap error, rebuilt from the fields the probe kept, with the connection id left out, P6:

```json
{"type":"error","message":"Per-connection subscription limit reached for v4_orderbook (limit=32).","connection_id":"<id>","message_id":680}
```

The duplicate error, the one that names its channel and id, rebuilt the same way, P8:

```json
{"type":"error","message":"Invalid subscribe message: already subscribed (v4_orderbook-1INCH-USD)","connection_id":"<id>","message_id":8528,"channel":"v4_orderbook","id":"1INCH-USD"}
```

The keepalive is a protocol ping, so there is no application frame to show, and the close without a pong was code 1011 with the reason `Heartbeat timeout`, P7.

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- `v4_subaccounts`, with `id` `{address}/{subaccount-number}`, carries positions, orders and fills.
- `v4_parent_subaccounts` does the same for a parent subaccount, numbered 0 to 127.
- Neither takes a signature, so any address can be watched, and S8 passes the client's location headers to their initial fetch, which can refuse a restricted location.
- Orders are signed transactions sent to a full node or the Order Entry Gateway Service, not to the Indexer, see [`rest.md`](./rest.md) section 9.
  The observatory never sends one.

## 8. Recommended feed shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one URL, `wss://indexer.dydx.trade/v4/ws`, for every market | section 1 |
| markets per connection | 32 at most, so 73 markets make three connections of 32, 32 and 9, or three of about 25 | the 33rd book is refused, section 3 |
| channel | `v4_orderbook` unbatched | batching adds up to 250 ms, S6 line 29, and 7.9 thousand frames a second for 73 books is small for the Rust engine |
| subscribe frames | one `{"type":"subscribe","channel":"v4_orderbook","id":"<ticker>"}` per market, with `subscribe_gap` of 30 ms | sent this way in every run without a refusal |
| `rawMarketId` | the ticker, `BTC-USD`, which is CCXT `market.id` | section 3 |
| snapshot | on `subscribed`, `reset_book` with the `{price,size}` levels and publish | section 4 |
| delta | on `channel_data` (or each entry of `channel_batch_data`), set or remove each `[price,size]` and publish | section 4 |
| gap rule | per connection, count snapshots received, re-anchor `expected` on the first data frame after the last snapshot and after any `error` frame, then `resync` on any `message_id` other than `expected` | section 4 |
| crossed book | after applying a frame, while the best bid is at or above the best ask, drop the older of the two touching levels, judged by the `message_id` of its last change kept in the venue state, as S3 does. On equal age drop both | the docs promise crossings and the server never tells the socket it removed one, section 4 |
| keepalive | answer the server's protocol ping within 10 s, and `ping_every` of 20 s with a protocol ping keeps the socket writing | the server closes with 1011 at 40 s without a pong. `live_smoke` runs 90 s, so a missed pong shows up as that close |
| `max_silence` | 35 s | the server pings every 30 s whatever the books do, and the runtime counts a ping as traffic at `venue_feed.rs` line 621. A connection of 32 books carried about 3,300 to 3,800 frames a second, so a shorter limit is safe in a busy hour and is the builder's call after `live_smoke` |
| unknown market | log the error frame and carry on, and subscribe only tickers read from the live catalog | an unknown ticker is answered with an error and nothing closes |
| deflate | keep it off | the server did not negotiate it, section 5 |
| receive time | stamp on arrival | book frames carry no time |

The feed fits `BookVenue` at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 78 without a REST seed, because every subscription is answered with its snapshot.
The crossed book rule and the per connection id rule live in the venue's `State`, which the runtime resets at every connection in `begin` at `venue_feed.rs` line 158.
The engine holds 20 levels a leg, at [`index_builder.rs`](../../../server/src/engine/cluster/index_builder.rs) line 8, and every snapshot had at least 20 levels on its larger side.
A book that updates every block with every order needs a dYdX full node with streaming turned on, S13, which the decentralised layer in [`rest.md`](./rest.md) section 9 weighs.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | dYdX Documentation, WebSockets API | https://docs.dydx.xyz/indexer-client/websockets | 2026-10-12 | dYdX docs | frame schemas, channels, message types, sections 2 to 4 |
| S2 | dYdX Documentation, WebSockets guide | https://docs.dydx.xyz/interaction/data/feeds | 2026-10-12 | dYdX docs | the connected frame, rate limits, heartbeat, sections 3 and 5 |
| S3 | dYdX Documentation, Watch Orderbook | https://docs.dydx.xyz/interaction/data/watch-orderbook | 2026-10-12 | dYdX docs | snapshot reset, deltas, crossed books and the uncross rule, section 4 |
| S4 | dYdX Documentation, Onboarding FAQs | https://docs.dydx.xyz/concepts/onboarding-faqs | 2026-10-12 | dYdX docs | when book updates are sent, section 4 |
| S5 | dYdX Documentation, Connecting to dYdX | https://docs.dydx.xyz/interaction/endpoints | 2026-10-12 | dYdX docs | socket URLs, section 1 |
| S6 | Indexer socks `config.ts` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/socks/src/config.ts | 2026-10-12 | dYdX Chain source | batch interval, heartbeat, rate limits, compression, payload, channel caps, market refresh, sections 2 to 5 |
| S7 | Indexer socks `websocket/index.ts` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/socks/src/websocket/index.ts | 2026-10-12 | dYdX Chain source | `message_id` at subscribe and unsubscribe, ping handling, sections 3 to 5 |
| S8 | Indexer socks `lib/subscription.ts` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/socks/src/lib/subscription.ts | 2026-10-12 | dYdX Chain source | error texts, the per connection cap, the snapshot fetch before registration, sections 4 and 7 |
| S9 | Indexer comlink `config.ts` at `bd2dd7d`, `API_ORDERBOOK_LEVELS_PER_SIDE_LIMIT` 100 at line 30 | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/comlink/src/config.ts#L30 | 2026-10-12 | dYdX Chain source | the 100 level snapshot, section 4 |
| S10 | Indexer socks `lib/message-forwarder.ts` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/socks/src/lib/message-forwarder.ts | 2026-10-12 | dYdX Chain source | one `message_id` per forwarded frame at lines 456 and 518, section 4 |
| S11 | Indexer roundtable `uncross-orderbook.ts` and its `config.ts` lines 75 to 77 and 227, at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/roundtable/src/tasks/uncross-orderbook.ts | 2026-10-12 | dYdX Chain source | the server side uncross every 15 s for levels older than 10 s, with no socket message, section 4 |
| S12 | Indexer socks `lib/constants.ts` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/socks/src/lib/constants.ts | 2026-10-12 | dYdX Chain source | close codes, section 3 |
| S13 | dYdX Documentation, Full Node gRPC Streaming | https://docs.dydx.xyz/nodes/full-node-streaming | 2026-10-12 | dYdX docs | the node side order book stream, section 8 |
| S14 | CCXT Pro 4.5.68 `dydx.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/dydx.js` | 2026-10-12 | CCXT | URL at line 29, `message_id` as the book nonce at line 245, section 1 |
| P1 | `ws-probe.py connect` at 22:26 UTC | [`ws-probe.py`](../../../scripts/probes/venues/dydx/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 5 and 6 |
| P2 | `ws-probe.py book`, 73 books for 35 s from 22:26 UTC, before the steady state counters existed | [`ws-probe.py`](../../../scripts/probes/venues/dydx/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 4 and 6 |
| P3 | `ws-probe.py book`, 73 books for 30 s from 22:28 UTC, with steady state counters and a REST read while the sockets ran | [`ws-probe.py`](../../../scripts/probes/venues/dydx/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 4 and 6 |
| P4 | `ws-probe.py batched` at 22:29 UTC | [`ws-probe.py`](../../../scripts/probes/venues/dydx/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 and 4 |
| P5 | `ws-probe.py markets` at 22:30 UTC | [`ws-probe.py`](../../../scripts/probes/venues/dydx/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 2 |
| P6 | `ws-probe.py limits` at 22:31 UTC, which sent 33 books before the duplicate | [`ws-probe.py`](../../../scripts/probes/venues/dydx/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 to 6 |
| P7 | `ws-probe.py silence` at 22:31 UTC | [`ws-probe.py`](../../../scripts/probes/venues/dydx/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 and 5 |
| P8 | `ws-probe.py`, every mode, the second pass from 22:36 UTC, whose limits mode sends the duplicate below the cap | [`ws-probe.py`](../../../scripts/probes/venues/dydx/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 6 |
