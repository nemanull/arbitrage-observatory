# Foxbit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:28 to 04:38 UTC, and the second pass 04:43 to 04:48 UTC, from the development host near Seattle through its Surfshark WireGuard exit, which Cloudflare places in Canada.

This profile covers the public WebSocket v3 of Foxbit (CCXT id `foxbit`) for its spot markets, with the order book channel in detail, because Foxbit lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/foxbit/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
CCXT Pro has no `foxbit` class, so nothing here comes from CCXT.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, public | `wss://api.foxbit.com.br/ws/v3/public`, S1 | open in 284 and 333 ms for the book runs, and 234 to 457 ms over every socket whose open time was logged, with no refusal |
| spot, private | `wss://api.foxbit.com.br/ws/v3/private`, S1 | not probed |
| WebSocket v2 | linked from S3, which says v3 "replaces the WebSocket v2" | not probed |
| perpetuals | none | none exist, see [`fees.md`](./fees.md) section 3 |

One public URL carries every spot market, the BRL and the USDT ones alike.
The host sits behind Cloudflare, and the upgrade reply named the `SEA` edge on some sockets and `YVR` on others.
Access results are from the Canadian VPN exit, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscribe entry | depth and speed | probed |
|---|---|---|---|
| `orderbook-100`, `orderbook-250`, `orderbook-500`, `orderbook-1000`, `orderbook` | `{"channel": "orderbook-100", "market_symbol": "btcbrl", "snapshot": true}` | snapshot of up to 300 levels per side, then deltas batched every 100, 250, 500 or 1,000 ms, and `orderbook` is the 1,000 ms default, S1 | all five delivered a snapshot and deltas on `btcbrl`, with a median gap of 105 to 109, 251 and 255, 501 and 502, and 1,000 or 1,001 ms between deltas, recommended at 100 |
| `orderbook-50` | shown in the documentation's own example | not in the documented interval list | refused with `Invalid interval '50' for channel 'orderbook'` and the socket closed with 1008, both runs |
| `ticker` | `{"channel": "ticker", "market_symbol": "btcbrl"}` | "updates every 1000ms", S1 | 19 and 22 frames in about 60 s on `btcbrl`, with best bid and ask prices, last trade and 24 h figures |
| `trades` | `{"channel": "trades", "market_symbol": "btcbrl"}` | on trade | 3 and 1 frames in about 60 s on `btcbrl` |
| `candle-<seconds>` | `{"channel": "candle-60", "market_symbol": "btcbrl"}` | 60 s to 1,209,600 s, S1 | not probed |
| `ping` | `{"type": "message", "params": [{"channel": "ping"}]}` | on request | pong in 77 to 89 ms |

No mark, index or funding channel exists, since there is no derivative.
The ticker carries no index or reference price, see section 6.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public and one private URL, S1 | one public URL served BRL, USDT and prediction markets on the same socket |
| subscribe frame shape | `{"type": "subscribe", "params": [{"channel", "market_symbol", "snapshot"}]}`, S1 | as documented, several entries per frame, each entry acknowledged on its own |
| unknown symbol expectation | an `error` event, and "the connection will be closed automatically when an error occurs", S1 | `{"type":"subscribe","event":"error","message":"Invalid market 'nopebrl' for channel 'orderbook'",…}` then close 1008 with the message as reason, 316 to 504 ms after the socket was created. A frame holding one valid and one unknown market also closed the socket, and the valid one never delivered |
| chunk unit and budget | 25 subscriptions per message and 50 per connection, S1 | 26 entries in one frame answered `MAX_SUBSCRIPTIONS_PER_MESSAGE`, and a 51st subscription answered `MAX_SUBSCRIPTIONS_REACHED`. Neither closed the socket |
| keepalive mechanism | application ping, "send a ping message every 20 seconds", S1 | no server protocol ping on any socket. The pong came back in 77 to 89 ms |
| connection lifetime and maintenance notice | status page and error codes 5001 to 5003 for REST, S2. Nothing for the socket | no notice seen, and no lifetime cap reached in 120 s |
| handshake and operation rate limits | 10 connections per 2 s, 10 messages per 2 s, 30 concurrent connections, per IP, S1 | each `channels` run opened 14 or 15 sockets at 300 ms spacing in two groups, with no refusal. Limits not tested |
| public market data authentication | none | none |
| message parse and routing | `{type, event, params: {channel, market_symbol}, data}`, S1 | route on `params.market_symbol`, and on `event` among `success`, `snapshot`, `update`, `error` |
| subscribe acknowledgement shape | `{"type":"subscribe","event":"success","params":{"channel":"orderbook-1000","market_symbol":"btcbrl"}}`, S1 | identical. The ack arrived 70 to 87 ms after the frame was sent, and the snapshot 0 to 75 ms after the ack |
| symbol identifier format | lower case `btcbrl`, S1 | identical to CCXT `market.id` on 133 of 133 markets. `BTCBRL` is refused on the socket and accepted by REST |
| number representation | strings, S1 | price and size as decimal strings in book frames. Trade `id` is a JSON number |
| timestamp representation | `data.ts` in ms on updates, S1 | `ts` integer ms on updates, ticker and trades. The snapshot carries no time at all |
| size unit | base currency, S1 examples | base currency, equal to the REST book size at the same sequence on 40 of 40 levels in both runs, section 4 |
| sequence semantics | `first_sequence_id` equals the previous `last_sequence_id + 1`, else restart, S2 | 0 gaps in 721 and 616 deltas on four markets over 60 s, and in 6,351 and 6,827 deltas on 50 markets over 60 s |
| idle repeat behaviour | not documented | a quiet market sends nothing after its snapshot. 1 delta in 1,337 over the two book runs repeated sizes already held |

## 4. The book channel in detail

`orderbook-100` with `"snapshot": true` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The snapshot comes only when the entry carries `"snapshot": true`, and the default is `false`, S1.
With `false`, `btcbrl` delivered deltas from its first frame and no snapshot, in both runs.
With `true`, each of four markets got exactly one snapshot, 147 to 153 ms after the subscribe frame was sent, and no further snapshot in 60 s.
The snapshot holds at most 300 levels per side, as documented: `btcbrl` sent 300 bids and 255 or 257 asks, `usdtbrl` 104 or 99 bids and 179 asks.
Its `data` holds only `sequence_id`, `bids` and `asks`.
Subscribing the same stream twice returned a second ack and a second snapshot, and the deltas that followed were not doubled: 27 deltas with 27 distinct sequence ids in 10 s.

### Delta semantics

A delta carries `ts`, `first_sequence_id`, `last_sequence_id`, `bids` and `asks`, and each level is `[price, size]` as strings.
A size of `"0"` deletes the level, S2.
The two arrays can be empty on one side, and no delta had both empty in either run.
One delta often covers several sequence ids: 164 of 273 `btcbrl` deltas in the first run and 109 of 197 in the second had `last_sequence_id` above `first_sequence_id`.

### Sequence and gap rule

```text
snapshot                                      replace the book, last = sequence_id
update, first_sequence_id = last + 1          apply, last = last_sequence_id
update, first_sequence_id != last + 1         gap: restart from the snapshot (documented), or terminate the socket (the engine's resync)
```

The sequence is per market: within two minutes `btcbrl` read 12,723,359, `usdtbrl` 8,716,355, `solusdt` 3,557,059 and the prediction market `pred11brl` 1.
The first delta after a snapshot had `first_sequence_id` equal to the snapshot's `sequence_id` plus one on 4 of 4 markets in both runs.
The chain held with 0 gaps on every delta of every run, see section 3.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | descending, on 4 of 4 markets in both runs, as documented | ascending, on 4 of 4 |
| delta | unordered: 72 and 48 of the `btcbrl` deltas had bids not descending | unordered: 0 on `btcbrl`, and 14 to 44 per run on the other three markets |
| REST `orderbook` | descending, 300 levels | ascending |

Over 50 markets, 1,559 and 1,662 delta arrays were out of order.
A feed applies deltas by price and never by position.

### Level window

The snapshot stops at 300 levels, but the deltas are not held to that window.
A `btcbrl` book built from the snapshot and every delta reached 302 and 303 bids, so levels beyond the 300th arrive as deltas.
A level that sat beyond the 300th when the snapshot was taken is not in the snapshot, so the deep end of a local book can miss levels until they change.
That is an inference from the counts, and it does not touch the engine's 20 levels.

### Size unit against CCXT `contractSize`

| market | CCXT `contractSize` | socket size at the touch | REST size at the same sequence |
|---|---|---|---|
| `btcbrl` | undefined | `"0.01387629"` BTC | `"0.01387629"`, sequence 12,723,359 |
| `btcbrl`, second run | undefined | `"0.00021411"` BTC | `"0.00021411"`, sequence 12,730,002 |

The socket and REST sizes were equal at every one of the 40 top levels in both runs, with the local book at exactly the REST `sequence_id`.
The unit is the base currency.
CCXT leaves `contractSize` undefined for every Foxbit market, at `server/node_modules/ccxt/js/src/foxbit.js` line 1651, and the engine turns a missing size into 1 at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 175 and 188 to 193.
So the engine's size multiplier would be right for Foxbit books.

### One-sided and empty books

The prediction market `pred11brl` sent a snapshot with 0 bids and 1 ask, in both runs.
The REST book of `ftmann08brl` held asks only, with a `timestamp` six hours old, see [`rest.md`](./rest.md) section 5.
So a one-sided snapshot is an empty `bids` or `asks` array, and the engine's `resetBook` accepts an empty side.

### Idle repeats

A quiet market sends nothing after the ack and the snapshot: `ftmann08brl` sent 2 frames in 60 s, and `brl1brl` sent a snapshot and 0 deltas in 60 s among 50 markets.
There is no heartbeat on the book channel.
1 of 1,337 deltas on the four markets of the two book runs set sizes the local book already held.

### Unknown, closed and wrong requests

| request | reply | then |
|---|---|---|
| `orderbook-100` on `nopebrl` | `"event":"error","message":"Invalid market 'nopebrl' for channel 'orderbook'"` | close 1008 with that reason |
| `ethbrl` and `nopebrl` in one frame | the same error for `nopebrl` | close 1008, and `ethbrl` never delivered |
| `orderbook-100` on `BTCBRL` | `Invalid market 'BTCBRL' for channel 'orderbook'` | close 1008 |
| `orderbook-50` on `btcbrl` | `Invalid interval '50' for channel 'orderbook'` | close 1008 |
| channel `nope` | `Invalid channel 'nope'` | close 1008 |
| text `hello` | `{"event":"invalid-input","message":"Unexpected token 'h', \"hello\" is not valid JSON","input":"hello"}` | close 1008 |
| `type` `nope` | `{"event":"invalid-input","message":"Invalid type on message.",…}` | close 1008 |
| 26 entries in one frame | `invalid-input` wrapping `MAX_SUBSCRIPTIONS_PER_MESSAGE` | stays open |
| a 51st subscription | `{"event":"error","error":{"code":"MAX_SUBSCRIPTIONS_REACHED",…}}` | stays open, the 50 keep delivering |
| the same stream twice | a second ack and a second snapshot | deltas not doubled |
| `unsubscribe` | a second `success` event | deltas stop |
| prediction market `pred11brl` | ack and snapshot | served, although it is not in the default catalog |

A closed or delisted market was not available to probe.
Since one bad entry closes the whole socket, a feed must subscribe only ids read from the catalog, and a delisting could drop every market on that socket.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | application ping every 20 s, S1 | pong in 77 to 89 ms, `{"type":"message","event":"success","params":{"channel":"ping"},"data":{"message":"pong"}}`. No server protocol ping on any socket |
| silence the server tolerates | "If the connection remains idle for too long, the server will close it", S1 | a socket with no traffic either way closed at 60.24 to 60.29 s with 1006 and no close frame, with or without a quiet subscription, in both runs. A busy `btcbrl` subscription with no client frame stayed open 120 s, and so did a socket that only pinged every 20 s |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified for the socket | not observed |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, in both runs |
| handshake | | 234 to 457 ms to open from this host over all runs |
| subscription limits | 25 per message, 50 per connection, S1 | both enforced, section 4 |
| throughput | | 50 BRL markets with the largest 24 h quote volume: 107 and 112 frames per second median, peak 164 and 185, 28 and 30 KB per second, 262 to 264 bytes per frame, 13.1 to 15.8 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe, four markets in one frame.

```json
{"type": "subscribe", "params": [{"channel": "orderbook-100", "market_symbol": "btcbrl", "snapshot": true}, {"channel": "orderbook-100", "market_symbol": "usdtbrl", "snapshot": true}, {"channel": "orderbook-100", "market_symbol": "btcusdt", "snapshot": true}, {"channel": "orderbook-100", "market_symbol": "solusdt", "snapshot": true}]}
```

Acknowledgement, one per entry.

```json
{"type":"subscribe","event":"success","params":{"channel":"orderbook-100","market_symbol":"btcbrl"}}
```

Snapshot, first three levels per side kept, from the first `book` run on `solusdt`, which held 23 bids and 25 asks.

```json
{"type":"subscribe","event":"snapshot","params":{"channel":"orderbook-100","market_symbol":"solusdt"},"data":{"sequence_id":3556657,"asks":[["119.74","16.029"],["119.75","45.799"],["119.76","1.938"]],"bids":[["119.49","5.142"],["119.48","1.516"],["119.45","1.801"]]}}
```

One-sided snapshot of a prediction market.

```json
{"type":"subscribe","event":"snapshot","params":{"channel":"orderbook-100","market_symbol":"pred11brl"},"data":{"sequence_id":1,"asks":[["0.52","0.02"]],"bids":[]}}
```

Delta covering two sequence ids, with bids in ascending order and one deletion.

```json
{"type":"subscribe","event":"update","params":{"channel":"orderbook-100","market_symbol":"btcbrl"},"data":{"ts":1790137953142,"first_sequence_id":12723019,"last_sequence_id":12723020,"bids":[["445755","0"],["446057","0.05327904"]],"asks":[]}}
```

Keepalive.

```json
{"type": "message", "params": [{"channel": "ping"}]}
```

```json
{"type":"message","event":"success","params":{"channel":"ping"},"data":{"message":"pong"}}
```

Errors.

```json
{"type":"subscribe","event":"error","message":"Invalid market 'nopebrl' for channel 'orderbook'","params":{"channel":"orderbook-100","market_symbol":"nopebrl","snapshot":true}}
```

```json
{"event":"error","error":{"code":"MAX_SUBSCRIPTIONS_REACHED","details":"Max subscriptions reached for this connection"}}
```

Ticker.

```json
{"type":"subscribe","event":"update","params":{"channel":"ticker","market_symbol":"btcbrl"},"data":{"best":{"ask":"446198","bid":"446092"},"last_traded":{"price":"446199","quantity":"0.00001114"},"rolling_24h":{"price_change":"8195","price_change_percent":"1.87098748","volume":"17.58295557","trades_count":"11353","low":"435982","high":"446199","open":"438004"},"ts":1790137955537}}
```

Trade.

```json
{"type":"subscribe","event":"update","params":{"channel":"trades","market_symbol":"btcbrl"},"data":[{"id":46508798,"quantity":"0.00000401","price":"446198.0","taker_side":"BUY","ts":1790137973604}]}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://api.foxbit.com.br/ws/v3/private` after a `login` message signed with an API key.

- `accounts`, with event types including `BALANCE` and `ORDER`, S1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Foxbit cannot join the engine as a perpetual leg, so this shape only matters if a spot leg is ever designed.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api.foxbit.com.br/ws/v3/public` | one URL serves every spot market |
| markets | the 5 USDT markets are the only ones in the engine's settlement family, and all 133 fit in 3 sockets | 128 of 133 markets quote BRL, see [`rest.md`](./rest.md) section 2 |
| channel | `orderbook-100` with `"snapshot": true` | snapshot on subscribe, a strict per market chain, the fastest documented interval |
| markets per connection | 50 | the documented cap, and a 51st is refused. 50 ran with 0 gaps at 107 to 112 frames per second |
| subscribe frames | two frames of 25 entries, at least 200 ms apart | 25 per message is enforced, and 10 messages per 2 s is the documented budget |
| keepalive | `{"type": "message", "params": [{"channel": "ping"}]}` every 20 s | the documented cadence, and a socket with no traffic either way dies at 60 s |
| `maxSilenceMs` | 45,000 | two missed pongs, and a quiet market sends nothing, so the pong has to count as traffic |
| routing | `params.market_symbol` is the `rawMarketId` | identical to CCXT `market.id` |
| snapshot | `event === 'snapshot'`: `resetBook` and store `sequence_id` | documented |
| delta | apply only when `first_sequence_id === last + 1`, then store `last_sequence_id` | documented rule, 0 gaps observed |
| resync | a gap, or a delta before the snapshot: `resync`, which terminates the socket and resubscribes | the engine's existing path, and restarting from the snapshot is what the documentation asks for |
| symbol hygiene | subscribe only ids from the current catalog, never upper case | one unknown id closes the socket with 1008 and takes the other 49 markets with it |
| receive time | stamp on arrival | the snapshot carries no time |
| sizes | `Number()` of the string, base currency | section 4 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Foxbit WebSocket API 3.0 | https://docs.foxbit.com.br/ws/v3/ | 2026-09-22 | Foxbit | URLs, channels, intervals, snapshot of 300 levels, subscribe and event shapes, rate limits, ping cadence, error closes, private channel names, sections 1 to 7 |
| S2 | Foxbit REST API 3.0, sections "Tutorials" and "API Codes" | https://docs.foxbit.com.br/rest/v3/ | 2026-09-22 | Foxbit | the sequence continuity rule and the zero size delete, maintenance codes, sections 3 and 4 |
| S3 | Foxbit API documentation index | https://docs.foxbit.com.br | 2026-09-22 | Foxbit | v3 replaces v2, section 1 |
| S4 | CCXT 4.5.68 `foxbit.js` | `server/node_modules/ccxt/js/src/foxbit.js` | 2026-09-22 | CCXT | `'ws': false` at line 70, `contractSize` undefined at line 1651, section 4 |
| P1 | `ws-probe.mjs book`, 04:32 and 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/foxbit/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | snapshot, chain, order, window, REST compare, ticker, trades, pong, sections 2 to 6 |
| P2 | `ws-probe.mjs channels`, 04:33 and 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/foxbit/ws-probe.mjs) | 2026-09-23 UTC | this host | intervals, snapshot false, errors and closes, duplicate and unsubscribe, sections 2 to 4 |
| P3 | `ws-probe.mjs batch`, 04:34 and 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/foxbit/ws-probe.mjs) | 2026-09-23 UTC | this host | 50 markets on one socket, the 51st and the 26 entry frame, throughput, sections 3 to 5 |
| P4 | `ws-probe.mjs silence` and `deflate`, 04:35 to 04:38 and 04:45 to 04:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/foxbit/ws-probe.mjs) | 2026-09-23 UTC | this host | 60 s idle close, keepalive, compression, section 5 |
