# Picol WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:34 to 03:49 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

Picol documents no socket.
Its API documentation, S1, lists three REST calls and nothing else, see [`rest.md`](./rest.md) section 2.
The host `ws.picol.com` follows the Pionex host name pattern, and it answers the Pionex public socket protocol of [`../pionex/websocket.md`](../pionex/websocket.md).
[`ws-probe.py`](../../../scripts/probes/venues/picol/ws-probe.py) subscribed the same books on `wss://ws.picol.com/wsPub` and `wss://ws.pionex.com/wsPub` at once.
Every `ORDERBOOK` frame carried the same `number`, the same prices and the same sizes on both, so the Picol socket is a second address for the Pionex book.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every perpetual family and spot, public | none by Picol. `wss://ws.pionex.com/wsPub` is the Pionex address, see [`../pionex/websocket.md`](../pionex/websocket.md) section 1 | `wss://ws.picol.com/wsPub` opened in 105 to 137 ms, with `server: APISIX/3.13.0`, and carried `BTC_USDT_PERP`, `ETH_USDT_PERP`, `SOL_USDT_PERP` and the spot `BTC_USDT` on one socket, P1 |
| private | not documented by Picol | not probed |

`ws.picol.com` resolved to `143.204.1.22`, `.33`, `.106` and `.123`, see [`rest.md`](./rest.md) section 1.
Its handshake answered `server: APISIX/3.13.0`, while the Pionex socket answered `server: cloudflare`.
The identical frames of section 4 suggest one backend behind two different edges.

## 2. Channel matrix for public market data

The frames are the Pionex frames, documented in [`../pionex/websocket.md`](../pionex/websocket.md) section 2.

| topic | subscribe frame | probed on `ws.picol.com` |
|---|---|---|
| `ORDERBOOK` | `{"op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": "BTC_USDT_PERP"}` | a 100 level snapshot, then deltas every 206 to 210 ms median on `BTC_USDT_PERP` and `ETH_USDT_PERP`, recommended |
| `DEPTH` | `{"op": "SUBSCRIBE", "topic": "DEPTH", "symbol": "BTC_USDT_PERP", "limit": 20}` | 129 whole books in each of three 80 s runs, about one every 620 ms |
| `INDEX` | `{"op": "SUBSCRIBE", "topic": "INDEX", "symbol": "BTC_USDT_PERP"}` | 169 to 182 frames in 80 s, with `indexPrice`, `markPrice`, `nextFundingRate`, `nextFundingTime` and `updateTime` |
| `TRADE` | `{"op": "SUBSCRIBE", "topic": "TRADE", "symbol": "BTC_USDT_PERP"}` | 24 to 33 frames in 80 s, with the same `tradeId` values as the Pionex REST trades |

All counts are from P1 to P3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Picol documents none of them, so the documented column is "none" throughout, and the Pionex documentation applies.

| axis | probed on `ws.picol.com` |
|---|---|
| endpoint split axis | one URL for every perpetual family and for spot |
| subscribe frame shape | one symbol per frame. A comma list in `symbol` answered `INVALID_SYMBOL` |
| unknown symbol expectation | `{"type":"ERROR","code":"INVALID_SYMBOL","message":"invalid \`symbol\`","timestamp":…}` |
| chunk unit and budget | not tested beyond 7 streams. The probe kept to about 4 client frames a second, inside the 5 a second Pionex documents |
| keepalive mechanism | a server `{"op":"PING","timestamp":…}` every 14,998 to 15,001 ms, answered with `PONG`. Whether a client `PING` gets an answer was not recorded |
| connection lifetime and maintenance notice | no forced close in 80 s, and no maintenance frame |
| handshake and operation rate limits | not provoked |
| public market data authentication | none |
| message parse and routing | `{topic, symbol, timestamp, data}`. Control frames carry `type` or `op` |
| subscribe acknowledgement shape | `{"type":"SUBSCRIBED","topic":"ORDERBOOK","symbol":"BTC_USDT_PERP"}`, 18 to 31 ms after the frame left, with the key order varying |
| symbol identifier format | `BTC_USDT_PERP`, identical to the REST catalog `symbol` |
| number representation | levels `[price, size]` as strings, trailing zeros kept, such as `"82557.0"` |
| timestamp representation | `ORDERBOOK` `data.timestamp` in ms, -4 to 74 ms old on arrival, median -2 to 1 ms on the local clock. The `INDEX` top level `timestamp` read `179142410839`, which is not Unix ms |
| size unit | base currency, the same numbers as the Pionex socket book and the Pionex REST trades, section 4 |
| sequence semantics | every `UPDATE` carried `prevNumber` equal to the previous `number` on that symbol, with 0 gaps over 1,239, 1,249 and 1,292 updates in three runs |
| idle repeat behaviour | a quiet book sends an empty `UPDATE`: 6, 14 and 11 on `SOL_USDT_PERP`, 14, 13 and 8 on `BTC_USDT`, with gaps between frames up to 10,052 ms |

## 4. The book channel in detail

### Snapshot on subscribe

`ORDERBOOK` sends a `SNAPSHOT` of 100 bids and 100 asks 18 to 23 ms after the subscribe frame, on every symbol of all three runs, P1 to P3.

### Delta semantics and sequence

An `UPDATE` lists changed levels, with the delta rules of [`../pionex/websocket.md`](../pionex/websocket.md) section 4.
`data.number` steps by more than one, and `data.prevNumber` names the previous frame's `number` on that symbol.
The chain held with 0 gaps on all four symbols in all three runs.

### The same book as Pionex

| symbol | frames on both sockets with the same `number` | same price list | Picol size over Pionex size | Picol arrival minus Pionex arrival |
|---|---|---|---|---|
| `BTC_USDT_PERP` | 392, 393 and 392 | all | 1.0000 on every level of size 0.01 or more, 40,948, 42,599 and 42,256 levels | median -1 to 0 ms, range -61 to 38 ms |
| `ETH_USDT_PERP` | 391, 343 and 392 | all | 1.0000, 40,743, 36,244 and 41,097 levels | median -1 to 0 ms |
| `SOL_USDT_PERP` | 120, 215 and 137 | all | 1.0000, 7,177, 10,961 and 8,094 levels | median -1 to 0 ms |
| `BTC_USDT`, spot | 339, 301 and 375 | all | 1.0000, 31,558, 27,584 and 37,107 levels | median -1 to 0 ms |

The second column counts frames shared by both sockets, in P1, P2 and P3.
Each socket saw at most one frame per symbol that the other did not.
So a feed on `ws.picol.com` and a feed on `ws.pionex.com` would build the same book at the same instant.

### Size unit and the REST book

The socket sizes are base currency, as on Pionex.
The 38 and 33 `TRADE` sizes of P2 and P3 equalled the Pionex REST trade sizes on every trade, matched by `tradeId`.
The Picol REST trades read 0.880 to 0.886 of them, median 0.8820 and 0.8818.
So `api.picol.com` scales its REST sizes and the socket does not, see [`rest.md`](./rest.md) section 5.
A feed that mixes a Picol REST snapshot with Picol socket deltas would mix two size scales.

### Checksum, level order and window

No checksum is sent.
Bids arrived in descending and asks in ascending price order in every `ORDERBOOK` frame of P3.
The Pionex profile's notes on the 100 level window and on stalls of busy books apply unchanged, see [`../pionex/websocket.md`](../pionex/websocket.md) section 4.

### Unknown and malformed subscriptions

| frame sent | reply |
|---|---|
| `ORDERBOOK` on `NOPE_USDT_PERP` | `{"type":"ERROR","code":"INVALID_SYMBOL","message":"invalid \`symbol\`","timestamp":1791603251312}` |
| `ORDERBOOK` on `"BTC_USDT_PERP,ETH_USDT_PERP"` | `INVALID_SYMBOL`, the same shape |
| `DEPTH` with `limit` 500 | `{"type":"ERROR","code":"PARAMETER_ERROR","message":"invalid \`limit\`","timestamp":1791603251832}` |

## 5. Session

| item | probed |
|---|---|
| keepalive | a server `PING` every 14,998 to 15,001 ms, 5 per 80 s run. The probe answered each with `PONG` and the socket stayed open |
| frame type | every frame was a binary WebSocket frame holding UTF-8 JSON: 1,589, 1,612 and 1,636 frames, none text |
| compression | with no extension offered, the reply named none. With `permessage-deflate` offered, the server answered `permessage-deflate; server_no_context_takeover; client_no_context_takeover` and delivered a snapshot and 38 or 39 updates in 8 s |
| forced disconnects and maintenance | none in the runs |
| socket time used | about 8.5 socket minutes over three runs, two sockets of 80 s and one of 8 s each, half of it on the Pionex host |

## 6. Captured frames

From P2 at 03:36 UTC, trimmed to three levels, in the key order the server sent.

```json
{"type":"SUBSCRIBED","topic":"ORDERBOOK","symbol":"BTC_USDT_PERP"}
```

```json
{"topic":"ORDERBOOK","symbol":"BTC_USDT_PERP","n":"","timestamp":1791603409804,"data":{"action":"SNAPSHOT","bids":[["82520.0","11.4263"],["82519.9","6.4057"],["82519.8","3.9087"]],"asks":[["82520.1","7.0854"],["82520.2","4.3692"],["82520.3","3.1144"]],"number":14646334303,"prevNumber":0,"timestamp":1791603409804}}
```

```json
{"topic":"ORDERBOOK","symbol":"BTC_USDT_PERP","n":"100080483132217","timestamp":1791603409900,"data":{"action":"UPDATE","bids":[["82520.0","11.4333"],["82519.9","8.3806"],["82519.8","6.2356"]],"asks":[["82520.1","7.0896"],["82520.2","3.8867"],["82520.3","6.0378"]],"number":14646334340,"prevNumber":14646334303,"timestamp":1791603409900}}
```

```json
{"topic":"INDEX","symbol":"BTC_USDT_PERP","data":[{"symbol":"BTC_USDT_PERP","indexPrice":"82572.10969","markPrice":"82520.72771","nextFundingRate":"0.0000298016","nextFundingTime":1791619200000,"updateTime":1791603410600}],"timestamp":179142426874}
```

```json
{"op":"PING","timestamp":1791603424783}
```

```json
{"type":"ERROR","code":"INVALID_SYMBOL","message":"invalid `symbol`","timestamp":1791603411637}
```

## 7. Private channels

Picol documents none.
The Pionex private socket is `wss://ws.pionex.com/wsUA`, see [`../pionex/websocket.md`](../pionex/websocket.md) section 7, and whether `ws.picol.com/wsUA` serves Picol accounts was not tested.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

The Pionex adapter at [`../../../server/src/venues/pionex.rs`](../../../server/src/venues/pionex.rs) already speaks this protocol.
A Picol feed is that adapter with `PUBLIC_URL` at line 25 set to `wss://ws.picol.com/wsPub`, and every other rule of [`../pionex/websocket.md`](../pionex/websocket.md) section 8 unchanged.
It would deliver the Pionex book frame for frame, so it adds no liquidity and no price the Pionex feed does not already carry.
A cross between a Picol leg and a Pionex leg is one book against itself.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://ws.picol.com/wsPub`, one URL | one socket carries every family |
| channel | `ORDERBOOK` | snapshot on subscribe and a strict `prevNumber` chain |
| keepalive | answer each server `PING` with `PONG` | as on Pionex |
| `maxSilenceMs` | 35,000 | a server `PING` every 15 s and an empty `UPDATE` every 10 s on a quiet book |
| deflate | keep it off | it is negotiated only when offered |
| sizes | base currency, `contractSize` 1, from the socket only | the Picol REST book is scaled, section 4 |
| admit | only if the engine wants a second fee level on the Pionex book | the book is the Pionex book |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Picol APIDocs index | https://picol-doc.gitbook.io/apidocs/llms.txt | 2026-10-09 | Picol | the opening |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/picol/ws-probe.py), first run at 03:34 UTC | | 2026-10-10 UTC | this host | sections 1 to 5 |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/picol/ws-probe.py), second run at 03:36 UTC, with the trade check | | 2026-10-10 UTC | this host | sections 1 to 6 |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/picol/ws-probe.py), second pass run at 03:47 UTC, with the level order check | | 2026-10-10 UTC | this host | sections 3 to 5 |
