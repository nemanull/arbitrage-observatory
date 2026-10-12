# Binance TH WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time (2026-10-10 UTC), from the development host near Seattle, through the Surfshark WireGuard exit in Vancouver, Canada.

This profile covers the public market streams of Binance TH, which carry spot only, because Binance TH lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every probed claim comes from [`ws-probe.py`](../../../scripts/probes/venues/binance-th/ws-probe.py), which refuses permessage-deflate as the engine does.
Run 1 started at 03:03 UTC and run 2, the second pass, at 03:12 UTC.
Run 1 held the diff sockets for 60, 40 and 20 s, and run 2 for 45, 30 and 15 s, so counts are given per run.
The documentation is section "Websocket Market Streams" of the API reference at `https://www.binance.th/api-docs/en/`, S1.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, public market streams | `wss://nbstream.binance.th/w3w/wsa/stream`, S1 | opens in 438 to 443 ms, one host for THB, USDT, USDC and FDUSD pairs |
| spot, private user data | `wss://nbstream.binance.th/w3w/wsa/stream?streams={listenKey}`, S1 | not probed |
| perpetuals, futures, options | none | none exist, see [`fees.md`](./fees.md) section 3 |

`nbstream.binance.th` is a CNAME of the same CloudFront distribution as the REST host, see [`rest.md`](./rest.md) section 1.
The upgrade reply carries `server: nginx`, `via: ... (CloudFront)`, `x-cache: Miss from cloudfront` and POP `HIO52-P1`.
The global Binance paths `/ws/<stream>` and `/stream?streams=` answer HTTP 404 on this host, and so does `/w3w/wsa/ws/<stream>`.
`stream.binance.th` does not resolve.

## 2. Channel matrix for public market data

| stream | payload | documented speed | probed |
|---|---|---|---|
| `<symbol>@depth` and `<symbol>@depth@100ms` | diff depth, `depthUpdate` | 1000 ms or 100 ms | delivers on `SITE` and `GLOBAL` pairs, section 4 |
| `<symbol>@depth<5,10,20>` and the same with `@100ms` | partial book, top 5, 10 or 20 levels | 1000 ms or 100 ms | delivers, with two payload shapes, section 4 |
| `<symbol>@bookTicker` | best bid and ask with sizes and `u` | real time | delivers on BTCTHB, BTCUSDT and ETHUSDT. 17 to 50 frames per pair in 6 s on the `GLOBAL` pairs |
| `!bookTicker` | all symbols | real time | 166 and 168 frames in 4 s, and it carries global Binance symbols that Binance TH does not list, such as `ALPHA_1228USDT` |
| `<symbol>@trade`, `@aggTrade` | trades | real time | 8 `btcusdt@trade` frames in 4 s in both runs. No frame in 4 s on `btcthb@trade` and `btcthb@aggTrade` |
| `<symbol>@ticker`, `@miniTicker`, `!miniTicker@arr` | 24 h statistics | 1000 ms | `!miniTicker@arr` gave 4 frames in 4 s. `btcthb@ticker` and `btcthb@miniTicker` gave none in 4 s |
| mark, index, funding | none | | spot only |

The `!bookTicker` content shows that the `GLOBAL` streams are the global Binance spot streams passed through, as the REST books in [`rest.md`](./rest.md) section 2 are.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one base URL for every stream, S1 | one host for every quote and both symbol types |
| subscribe frame shape | `?streams=<a>/<b>/<c>` in the URL, or `{"method":"SUBSCRIBE","params":[...],"id":1}`, S1 | a URL with one stream works. A URL with two or more streams, joined by `/`, by `%2F` or as repeated `streams=` parameters, is acknowledged and then silent for 6 s, in both runs. One `SUBSCRIBE` frame with several streams works, 4 streams in one frame delivered all 4 |
| unknown symbol expectation | not stated | `nopethb@depth`, `BTCTHB@depth5`, `btc_thb@depth5` and `btcthb@depth15` in the URL are each acknowledged `{"id":<n>,"result":null}` and then silent. In a `SUBSCRIBE` frame, `nopethb@depth` is acknowledged with the good stream and silently dropped |
| chunk unit and budget | "A single connection can listen to a maximum of 1024 streams", S1 | 300 diff depth streams in three `SUBSCRIBE` frames of 100 were acknowledged, and 259 and 285 distinct streams delivered within 10 s in runs 1 and 2. The cap itself was not tested |
| keepalive mechanism | a server ping frame "every 3 minutes", disconnect without a pong "within a 10 minute period", S1 | a protocol ping arrived about 30 s after the open on the BTCTHB socket held 45 s and on the BTCUSDT socket held 30 s in run 2, and none on a 15 s socket. That fits a 30 s cadence rather than 3 minutes. No socket was held long enough to see a second ping |
| connection lifetime and maintenance notice | "only valid for 24 hours", S1 | no socket closed on its own. No maintenance notice exists on the socket |
| handshake and operation rate limits | "5 incoming messages per second" per connection, counting pings, pongs and control frames, and disconnection beyond it, S1 | not provoked. The probe sends at most one control frame per 0.5 s |
| public market data authentication | none | none |
| message parse and routing | `{"stream":"<name>","data":<payload>}`, S1 | as documented on every stream |
| subscribe acknowledgement shape | `{"result":null,"id":<id>}`, S1 | as documented. A URL subscription also gets one, with an id the server picks, such as `{"id":1205252,"result":null}`. `LIST_SUBSCRIPTIONS`, a string `id`, an unknown method and a non JSON frame got no reply at all, where S1 documents error frames with `code` and `msg`. `GET_PROPERTY combined` answered `{"id":7,"result":true}` |
| symbol identifier format | "All symbols for streams are lowercase", S1 | lower case only, the REST `symbol` lowered, such as `btcthb` for `BTCTHB` |
| number representation | strings | prices and sizes are strings on every stream |
| timestamp representation | ms | `depthUpdate` carries `E` in ms. Partial depth and single symbol `bookTicker` carry no time. `!bookTicker` carries `E` and `T` |
| size unit | not stated | base asset. A rebuilt `SITE` book matched the REST book level for level, and the REST book is in base units, see section 4 |
| sequence semantics | `U` and `u` per event, each event's `U` equal to the previous `u` plus 1, S1 | holds on `GLOBAL` pairs. On `SITE` pairs `U` skips, and a `pu` field, absent from S1, chains the events instead, see section 4 |
| idle repeat behaviour | not stated | `btcusdt@depth20@100ms` repeated the previous book in 50 of 99 and 35 of 80 frames. `SITE` partial depth repeated it in 0 to 2 frames per run |

## 4. The book channel in detail

### Snapshot on subscribe

The diff stream sends no snapshot.
The partial depth stream sends a full top 5, 10 or 20 in every frame, with `lastUpdateId`.
S1's recipe seeds the diff stream from `GET /api/v1/depth?limit=1000`, see [`rest.md`](./rest.md) section 5.

### Delta semantics

Each `depthUpdate` lists absolute sizes per price, and a size of `0.00000000` removes the level, S1.
No event had both sides empty in either run.

### Sequence and gap rule

The two symbol types follow different rules on the same socket.

| item | `SITE`, BTCTHB `@depth@100ms` | `GLOBAL`, BTCUSDT `@depth@100ms` |
|---|---|---|
| keys | `e`, `E`, `s`, `U`, `u`, `pu`, `b`, `a` | `e`, `E`, `s`, `U`, `u`, `b`, `a` |
| events | 83 in 60 s in run 1, 48 in 45 s in run 2 | 402 in 40 s in run 1, 295 in 30 s in run 2 |
| `U` equal to the previous `u` plus 1 | broken in 43 of 82 and 13 of 47 steps, so it is not the rule | broken in 2 of 401 steps in run 1 and 0 of 294 in run 2 |
| `pu` equal to the previous `u` | 82 of 82 and 47 of 47 | no `pu` field |
| first event after the REST snapshot | its `pu` equals `lastUpdateId` on 2 of 2 `SITE` sockets in each run, while `U <= lastUpdateId + 1 <= u` failed on 1 of 2 in run 1 and 2 of 2 in run 2 | `U <= lastUpdateId + 1 <= u` held in both runs |
| rebuilt book against a second REST read | top 20 bids and asks equal, on 2 of 2 `SITE` sockets in each run, with the REST read at exactly the last applied `u` | not comparable, because the REST read was 27 to 39 updates ahead of the last event received |

The `SITE` update ids share one sequence across the `SITE` pairs, which is why `U` skips.
BTCTHB and USDTTHB books both carried ids near 3,406,010,450 at the same moment in [`rest.md`](./rest.md) section 5.
So a `SITE` feed checks `pu` against the previous `u`, and a `GLOBAL` feed checks `U` against the previous `u` plus 1, the global Binance spot rule.
The two breaks on BTCUSDT in run 1 were not captured in detail, and a 40 s check on the same stream between the runs saw none.
The event spacing on the `@100ms` streams was at least 100 ms on BTCTHB, and 99 to 200 ms with a median of 100 ms on BTCUSDT, apart from one pair of events 1 ms out of order in run 1.
`btcthb@depth`, documented at 1000 ms, delivered 30 events in 20 s and 14 in 15 s with a median spacing of 369 and 732 ms, so it is not a 1000 ms batch either.

### Checksum

None documented and none on the wire.

### Level order on the wire

| stream | bids | asks |
|---|---|---|
| `SITE` diff | ascending, 19 of 19 and 13 of 13 multi level events | ascending |
| `GLOBAL` diff | descending, 352 of 352 and 249 of 249 | ascending |
| partial depth, both types | descending in every frame | ascending in every frame |

The order of a diff event does not matter to a book that sets each level by price, but a feed must not assume the first bid is the best.

### Partial depth payload shapes

| type | keys | example |
|---|---|---|
| `SITE`, such as `btcthb@depth20@100ms` | `lastUpdateId`, `b`, `a` | `{"a":[["<price>","<size>"],...],"b":[...],"lastUpdateId":<id>}` |
| `GLOBAL`, such as `btcusdt@depth20@100ms` and `eththb@depth20@100ms` | `lastUpdateId`, `bids`, `asks` | `{"asks":[["<price>","<size>"],...],"bids":[...],"lastUpdateId":<id>}` |

The same channel name yields two key sets, so a parser keyed on one of them misses the other type.
`btcthb@depth20@100ms` delivered 9 and 10 frames in 15 and 12 s, a median spacing of 841 to 1,135 ms, and `usdtthb@depth20@100ms` delivered 3 and 4 frames in 12 and 15 s.
So `SITE` partial depth is pushed on change, not every 100 ms.
`btcusdt@depth20@100ms` delivered 99 frames in 10 s and 80 in 8 s, one every 100 ms.

### Size unit

Sizes are in the base asset on every stream, with no contract size, as on global Binance spot.

### One-sided and empty books

No `SITE` or `GLOBAL` book probed was one-sided, and `GET /api/v1/ticker/bookTicker` had both sides on all 512 symbols, see [`rest.md`](./rest.md) section 5.

### Idle repeats

See axis "idle repeat behaviour" in section 3.
A `GLOBAL` partial stream repeats an unchanged book every 100 ms, and a `SITE` one stays quiet instead.

### Unknown, closed and wrong-form streams

Every wrong stream is acknowledged with `result null` and then sends nothing, see axis "unknown symbol expectation".
A feed cannot tell a quiet `SITE` pair from a misspelled stream, so it validates names against `exchangeInfo` before subscribing.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every 3 minutes, pong within 10 minutes, unsolicited pongs allowed, S1 | one server ping about 30 s after the open on two sockets, answered by the client library |
| silence | | a quiet `SITE` diff stream went 4.6 to 6.9 s without an event at `@100ms`, and `usdtthb@depth20@100ms` went about 6 s between frames in run 2 |
| forced disconnect | after 24 hours, S1 | none seen within the longest hold of 60 s |
| compression | not stated | the server accepts a client that offers no permessage-deflate, and every frame was plain text JSON |
| bad frames | error frames with `code` and `msg`, S1 | no reply, and the socket stayed open |
| maintenance notices | none on the socket | none |

## 6. Captured frames

URL subscription acknowledgement, run 2, `?streams=btcthb@bookTicker`.

```json
{"id": 1181497, "result": null}
```

Single symbol book ticker, the next frame on the same socket.

```json
{"data": {"A": "0.00060000", "B": "0.07151000", "a": "2773647.00", "b": "2773472.00", "s": "BTCTHB", "u": 3406011016}, "stream": "btcthb@bookTicker"}
```

`SITE` diff event, run 2, with the `pu` field that chains it to the previous event.

```json
{"data": {"E": 1791602048332, "U": 3406011392, "a": [["2773475.00", "0.00000000"]], "b": [], "e": "depthUpdate", "pu": 3406011391, "s": "BTCTHB", "u": 3406011393}, "stream": "btcthb@depth@100ms"}
```

`SUBSCRIBE` frame acknowledgement.

```json
{"id": 1, "result": null}
```

`GET_PROPERTY` reply.

```json
{"id": 7, "result": true}
```

No error frame was captured, because the server sent none for any bad request.

## 7. Private channels

The user data stream uses a listen key from `POST /api/v1/listenKey`, kept alive with `PUT` and closed with `DELETE`, and is read at `wss://nbstream.binance.th/w3w/wsa/stream?streams={listenKey}`, S1.
S1 also documents a separate `wsaListenKey` set under `/api/v1/wsaListenKey`.
Its events are account, balance and order updates.
None of this was probed.

## 8. Recommended feed shape

Not recommended for the engine, which needs a perpetual leg, and Binance TH lists none.
The 507 `GLOBAL` pairs also repeat the global Binance spot book, so they add no venue.

For a future spot leg on the 5 `SITE` pairs:

- One socket at `wss://nbstream.binance.th/w3w/wsa/stream`, with no streams in the URL.
- One `SUBSCRIBE` frame naming `<symbol>@depth@100ms` for each `SITE` pair, because a URL with more than one stream delivers nothing.
- Seed each pair from `GET /api/v1/depth?symbol=<SYMBOL>&limit=1000`, drop events with `u <= lastUpdateId`, start at the event whose `pu` equals `lastUpdateId`, and resync when an event's `pu` differs from the previous `u`.
- Read bids from either key set, `b` or `bids`, and never take the first diff bid as the best.
- Keepalive is the server's ping, which the WebSocket library answers, and the venue documents no application ping.
- `maxSilenceMs` of 30,000, because a quiet `SITE` pair went almost 7 s without an event, and the server pings about every 30 s.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | API reference `https://www.binance.th/api-docs/en/`, sections "Websocket Market Streams", "Partial Book Depth Streams", "Diff. Depth Stream", "How to manage a local order book correctly" and "User Data Streams" | 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/binance-th/ws-probe.py), runs 1 and 2 | 2026-10-10 UTC |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/binance-th/rest-probe.py), for the REST snapshots and the shared `SITE` sequence | 2026-10-10 UTC |
