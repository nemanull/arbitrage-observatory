# Bitazza WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:19 to 03:35 UTC for run 1 and 03:42 to 03:47 UTC for run 2, from the development host near Seattle.

This profile covers the public WebSocket of the AlphaPoint gateway that serves Bitazza's spot market, the only public API Bitazza has, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitazza/ws-probe.mjs), run 1 and run 2, and the capture is quoted beside the documented value.
The documentation is the Bitazza API Reference, version 3.3, S1, which documents the calls as payloads and says little about the stream itself.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| gateway | documented URL | probed |
|---|---|---|
| Global | `wss://apexapi.bitazza.com/WSGateway/`, S1 | open in 694.8 to 1,507.7 ms over seven logged opens |
| Thailand | `wss://apexapi.bitazza.co.th/WSGateway/`, S1, behind Cloudflare | open in 558.6 and 570.4 ms |

One socket carries every instrument of the venue, whatever the quote, because the venue is one order management system, `OMSId` 1.
The two gateways front one engine.
Subscribed at the same instant to BTCUSDT, they returned the same touch both times, with ids `90493044` and `90493158` 153 ms apart in run 1 and the same id `90586242` in run 2.
No family split exists, and there is no perpetual to split.

## 2. Channel matrix for public market data

| call | payload | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `SubscribeLevel2` | `{"OMSId": 1, "InstrumentId": 7, "Depth": 20}`, or `Symbol` in place of `InstrumentId` | any `Depth`, then `Level2UpdateEvent` frames | snapshot in the reply, then deltas at about one frame a second on the books probed, recommended with a large `Depth` |
| `GetL2Snapshot` | `{"OMSId": 1, "InstrumentId": 7, "Depth": 2}` | one reply | answered on the socket like any request |
| `SubscribeLevel1` | `{"OMSId": 1, "InstrumentId": 7}` | reply, then `Level1UpdateEvent` | 2 events in 60 s in run 1 and 8 in 45 s in run 2 on BTCUSDT, gaps of 1.9 to 38 s |
| `SubscribeTrades` | `{"OMSId": 1, "InstrumentId": 7, "IncludeLastCount": 2}` | reply with the last trades, then `TradeDataUpdateEvent` | the reply carried 2 trades, and no trade event came in 60 s or 45 s |
| `SubscribeTicker` | instrument and interval | bars | not probed |
| `Ping` | `{}` | | `{"msg":"PONG"}` |

The call names, payloads and permissions are from S1.
S1 lists `Level2MarketData` and `Level1MarketData` permissions for the subscribe calls, yet every call above answered without a login.
No mark, index or funding channel exists, since the venue publishes none, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one Global and one Thailand URL, S1 | one engine behind both, and every instrument on either, section 1 |
| subscribe frame shape | `{"m": 0, "i": <even id>, "n": "SubscribeLevel2", "o": "<payload as a JSON string>"}`, one instrument per call, S1 | as documented. The payload must be a string inside `o` |
| unknown symbol expectation | Not publicly specified | reply `{"result":false,"errormsg":"Resource Not Found","errorcode":104,"detail":"Instrument not Found"}` with `m` 1 and the request's `i` |
| chunk unit and budget | Not publicly specified | 273 subscribe frames, one per instrument, 20 ms apart on one socket, all answered with snapshots in both runs |
| keepalive mechanism | `Ping`, "Used to keep a connection alive", S1 | no server protocol ping on any socket. `Ping` answered in 227.8 to 833.2 ms |
| connection lifetime and maintenance notice | Not publicly specified | no close in 120 s on any socket, and no notice seen |
| handshake and operation rate limits | Not publicly specified. The Market Maker section mentions "ip-address rate limits" set per operator | no refusal at 273 subscribes in 5.5 s |
| public market data authentication | S1 lists permissions for the subscribe calls | none needed |
| message parse and routing | the frame `n` names the call or event, `o` holds the payload as a string, S1 | parse the frame, then parse `o`. A `Level2UpdateEvent` frame holds one instrument, whose id is field 7 of every level, 0 mixed frames in 11,968 frames over both batch runs |
| subscribe acknowledgement shape | the reply echoes `n` and `i`, S1 | the reply is the snapshot itself, `m` 1, the request's `i`, `o` a string of level arrays. No separate acknowledgement |
| symbol identifier format | `BTCUSDT` or the numeric `InstrumentId`, S1 | both accepted on subscribe. Frames carry only the numeric id, which equals the `market.id` of CCXT `ndax` pointed at this gateway, see [`rest.md`](./rest.md) section 2 |
| number representation | numbers, S1 | JSON numbers inside the `o` string, with trailing zeros kept, as in `429.340` |
| timestamp representation | `ActionDateTime` in "POSIX format X 1000", S1 | integer ms. It is the time the level last changed, not the time of the frame, and it was up to 19.6 s old on arrival |
| size unit | "Quantity available at a given Bid or Ask price", S1 | base currency, 1.10678 BTC at the BTCUSDT touch, section 4 |
| sequence semantics | `MDUpdateId`, "This sequential ID identifies the order in which the update was created", S1 | per instrument, rising across frames but skipping values, so no gap rule, section 4 |
| idle repeat behaviour | not documented | none. A quiet book sends nothing, USDTTHB went 12.6 and 13.7 s without a frame, and run 2 counted 0 empty event frames |

## 4. The book channel in detail

`SubscribeLevel2` is the only book channel, and every row below is about it.

### Snapshot on subscribe

The reply to `SubscribeLevel2` is the snapshot, with `m` 1 and the request's `i`.
Every level in it carries the same `MDUpdateId`, `ActionType` 0, and the same `ActionDateTime`.
Bids come first, best first and descending, then asks, best first and ascending, on 4 of 4 books in both runs.
It arrived 263.4 to 1,433.2 ms after the subscribe frame in the run 1 batch, median 265.8, and 224.9 to 343 ms in run 2, median 226.9.

| book | `Depth` asked | levels in the snapshot |
|---|---:|---|
| BTCUSDT | 20 | 20 and 20 |
| SOLUSDT | 20 | 20 and 20 |
| BTCTHB, USDTTHB, STGUSDT | 20 | 16 and 16 |
| BTCUSDT | 500 | 140 entries in both runs |
| SOLUSDT | 500 | 68 to 70 entries |

A book whose `Depth` exceeds its levels returns all of them.
BTCTHB, USDTTHB and STGUSDT held exactly 16 levels a side in total, since a REST snapshot at `Depth` 500 returned 16 and 16 for each at 03:49 UTC.

### Delta semantics

A `Level2UpdateEvent` has `m` 3 and an `o` string holding an array of levels for one instrument.
Each level is ten fields.

| index | field, S1 and `server/node_modules/ccxt/js/src/pro/ndax.js` lines 389 to 398 | on the wire |
|---:|---|---|
| 0 | `MDUpdateId` | per instrument, section below |
| 1 | number of accounts at the level | 0 on a delete |
| 2 | `ActionDateTime`, ms | time the level last changed |
| 3 | `ActionType`: 0 new, 1 update, 2 delete | all three seen |
| 4 | last trade price | |
| 5 | number of orders at the level | 0 on a delete |
| 6 | price | |
| 7 | `ProductPairCode`, the `InstrumentId` | route on it |
| 8 | quantity, base currency | 0 on a delete |
| 9 | side: 0 buy, 1 sell | |

A changed level often arrives as a delete immediately followed by a new level at the same price and side.
That pair accounted for 399 of 1,028 BTCUSDT deletes in run 1 and 474 of 502 SOLUSDT deletes.
It also arrives as two updates in a row at the same price, the later one carrying the new size.
So a feed applies the levels in array order: 0 and 1 set the size, 2 removes the level, as CCXT does at `pro/ndax.js` lines 430 to 446.

### Sequence and gap rule

```text
MDUpdateId is per instrument: BTCUSDT near 90.5 M, SOLUSDT near 52.8 M, BTCTHB near 19.7 M, USDTTHB near 1.24 M
the smallest id of a frame is above the largest id of that instrument's previous frame: 0 exceptions in run 1 and in the run 2 book mode, 1 in 5,959 frames of the run 2 batch
ids skip: BTCUSDT delivered 2,107 levels over an id span of 5,714 in 60 s of run 1
ids are not sorted inside a frame: 294 BTCUSDT and 28 SOLUSDT levels in run 1 had an id at or below the one before
```

No per instrument chain exists, so a lost frame cannot be detected from the ids.
The frame's `i` on events is a socket wide counter that rose by 2 per event on the book probe's socket, 252 of 254 steps in run 1 and 162 of 170 in run 2, the rest being steps of 4 where a `Level1UpdateEvent` took a number.
On the 273 instrument batch of run 2 it was not monotonic: 5,520 steps of 2, 94 of 4, and 57 steps backwards.
So `i` is not a gap signal either, and S1 documents neither use.
The only check is a fresh snapshot, which `GetL2Snapshot` gives on the same socket.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending | best first, ascending |
| delta | unordered: 52 of 93 BTCUSDT frames in run 1 and 57 of 86 in run 2 had a bid rising | unordered: 39 of 93 and 50 of 86 |
| REST `GetL2Snapshot` | descending | ascending |

A feed applies deltas by price and never by position.

### Level window

A subscription with a small `Depth` does not keep a correct book on every instrument.
The `window` mode kept one book at `Depth` 20 and one at `Depth` 500 for BTCUSDT and SOLUSDT, and compared each every 10 s with `GetL2Snapshot` asked on its own socket.

| book | checks equal on the top 20 levels | worst reading |
|---|---|---|
| BTCUSDT at `Depth` 20 | 1 of 4 in run 1, 0 of 4 in run 2 | 15 bid levels inside the top 20 price range that the snapshot did not have, and the book grew to 40 bids at 20 s and 59 asks at 30 s |
| BTCUSDT at `Depth` 500 | 4 of 4, and 4 of 4 | none |
| SOLUSDT at `Depth` 20 | 4 of 4, and 4 of 4 | none, the book stayed at 20 levels a side |
| SOLUSDT at `Depth` 500 | 4 of 4, and 3 of 4 | 18 of 20 asks equal, with the snapshot 2 ids ahead of the book, a timing miss |

In the run 2 `book` mode the BTCUSDT book at `Depth` 20 grew to 66 bids and 61 asks in 45 s, and its touch read 86,897.85 and 86,909.08 while a REST snapshot 14 ids newer read 86,893.25 and 86,910.64.
So levels that leave the window are not always deleted, and they come back as phantom levels inside the touch.
The likely cause, an inference, is that the BTCUSDT ladder is re-quoted about every second, while SOLUSDT changed a few levels at a time and stayed correct.
A `Depth` above the whole book avoids the window, and BTCUSDT, the deepest book probed, held at most 72 levels a side.

### Size unit

The quantity is base currency.
The BTCUSDT touch read 1.10678 at 86,680.79 in run 1, which is plausible as bitcoin and not as dollars, and the REST snapshot reports the same unit.
There is no contract, and the CCXT `ndax` stand-in reports no `contractSize`, so the engine's default of 1 would be correct.

### One-sided and empty books

A running instrument with no orders, BUSDUSDT, and a stopped one, BNTUSDT, both answered with `"o":"[]"` and then sent nothing.
No book was seen losing one side, so what a delta does when a side empties is Not verified.

### Idle repeats

Nothing is repeated, and run 2 counted 0 empty event frames.
The books probed changed about once a second, and no two frames of one book came less than 97 ms apart.

| book | frames | gap between frames, ms |
|---|---:|---|
| BTCUSDT, run 1 and run 2 | 93 in 60 s, 86 in 45 s | min 98 and 97, median 700 and 500, max 2,414 and 1,586 |
| SOLUSDT, run 1 | 89 in 60 s | min 99, median 699, max 2,510 |
| BTCTHB, run 1 and run 2 | 58 and 45 | min 923 and 911, median 1,001 both, max 2,527 and 2,002 |
| USDTTHB, run 1 and run 2 | 15 and 16 | median 2,000 and 1,001, max 12,601 and 13,700 |
| STGUSDT, run 2 | 24 in 45 s | median 1,004, max 6,927 |

The median new or updated level was 114 to 211 ms old on arrival, per book and run, against a one way path of about 113 ms, half the REST round trip, see [`rest.md`](./rest.md) section 1.
So a change reaches this host about 0.1 to 0.2 s after its stamp on the local clock, and the once a second rhythm looks like the makers' refresh rather than a server delay, an inference.
Whether the server also batches changes into a floor of about 100 ms is Not verified.

### Unknown, closed and wrong requests

| request | reply | then |
|---|---|---|
| `SubscribeLevel2` `Symbol` `NOPEUSDT` | `m` 1, errorcode 104 `Resource Not Found`, `Instrument not Found` | the socket stays open |
| `SubscribeLevel2` `InstrumentId` 999999 | the same | |
| `SubscribeLevel2` with `OMSId` 2 | the same | |
| `SubscribeLevel2` without `Depth` | errorcode 100 `Invalid Request`, `OMSId, InstrumentId (or Symbol) and Depth are required fields` | |
| `SubscribeLevel2` BTCUSDT twice | errorcode 909 `Already Subscribed.` | the first keeps delivering |
| `SubscribeLevel2` on the stopped BNTUSDT | `"o":"[]"`, no error | nothing |
| unknown call `NoSuchFunction` | `m` 5, `o` `Endpoint Not Found` | |
| text that is not JSON | no reply | the socket stays open |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `Ping` with `{}`, S1 | `{"m":1,"i":30,"n":"Ping","o":"{\"msg\":\"PONG\"}"}` in 227.8 to 833.2 ms. The server sent no protocol ping on any socket, the longest 120 s |
| silence the server tolerates | Not publicly specified | three sockets in each run stayed open the full 120 s: one that neither subscribed nor sent, one subscribed to an empty book that got one frame and then 119.7 and 119.8 s of nothing, and one that sent `Ping` every 30 s |
| forced disconnect | Not publicly specified | none |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header from either gateway, in both runs |
| handshake | | 558.6 to 1,507.7 ms to open from this host |
| subscription limits | Not publicly specified | 273 subscriptions on one socket, every running instrument, with no error |
| throughput | | 273 instruments at `Depth` 20: 5,959 to 6,009 frames in about 36 s, a median of 169 and 181 frames per second, peak 258 and 376, 174 and 181 KB per second, 1,051 and 1,107 bytes per frame, 11.3 and 13.8 µs `JSON.parse` per frame. 219 and 221 instruments sent at least one delta in 30 s |

## 6. Captured frames

Trimmed from the run 1 captures, with the levels re-serialized, so trailing zeros inside `o` are dropped.

Subscribe.

```json
{"m": 0, "i": 2, "n": "SubscribeLevel2", "o": "{\"OMSId\":1,\"InstrumentId\":7,\"Depth\":20}"}
```

Snapshot, the reply, two bids and two asks kept.

```json
{"m":1,"i":2,"n":"SubscribeLevel2","o":"[[90493818,2,1790134049794,0,86754.79,2,86680.79,7,1.10678,0],[90493818,1,1790134049794,0,86754.79,1,86680.78,7,0.00054,0],[90493818,1,1790134049794,0,86754.79,1,86698.14,7,3.83789,1],[90493818,1,1790134049794,0,86754.79,1,86698.15,7,0.0003,1]]"}
```

Delta, a delete then a new level at the same two ask prices.

```json
{"m":3,"i":4,"n":"Level2UpdateEvent","o":"[[90493881,0,1790134050672,2,86754.79,0,86698.14,7,0,1],[90493882,1,1790134050672,0,86754.79,1,86698.14,7,3.83804,1],[90493883,0,1790134050672,2,86754.79,0,86703.1,7,0,1],[90493884,1,1790134050672,0,86754.79,1,86703.1,7,0.00018,1]]"}
```

Delta, two updates in a row at one SOLUSDT price, where the second wins.

```json
{"m":3,"i":6,"n":"Level2UpdateEvent","o":"[[52790726,0,1790134050672,1,119.18,1,119.14,89,90.359,1],[52790727,1,1790134050672,1,119.18,2,119.14,89,429.34,1]]"}
```

Empty book.

```json
{"m":1,"i":10,"n":"SubscribeLevel2","o":"[]"}
```

Keepalive.

```json
{"m":1,"i":30,"n":"Ping","o":"{\"msg\":\"PONG\"}"}
```

Errors.

```json
{"m":1,"i":22,"n":"SubscribeLevel2","o":"{\"result\":false,\"errormsg\":\"Already Subscribed.\",\"errorcode\":909,\"detail\":\"{\\\"OMSId\\\":1,\\\"Symbol\\\":\\\"BTCUSDT\\\",\\\"Depth\\\":20}\"}"}
```

```json
{"m":5,"i":26,"n":"NoSuchFunction","o":"Endpoint Not Found"}
```

Trades reply.

```json
{"m":1,"i":14,"n":"SubscribeTrades","o":"[[1677912,7,0.00200,86722.65,4613916155527,1216698119,1790133812302,1,1,0,0],[1677913,7,0.012,86754.79,1216698282,1216698283,1790133900105,1,1,1,0]]"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same gateways after `AuthenticateUser` or `WebAuthenticateUser`.

- `SubscribeAccountEvents`, which pushes order, trade and position events.
- `SendOrder`, `CancelOrder`, `GetOpenOrders` and `LogOut`.

## 8. Recommended feed shape

No feed is recommended for the engine, because Bitazza has no public perpetual and no CCXT class, see [`fees.md`](./fees.md) section 9.
If a later design ever models a spot leg, the probes support this shape.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket on `wss://apexapi.bitazza.com/WSGateway/` | every instrument is on one engine, and 273 ran on one socket |
| channel | `SubscribeLevel2` with `Depth` 500 | a small `Depth` leaves phantom levels on a ladder book, and 500 is above every book seen |
| markets per connection | all tracked instruments, one subscribe frame each | 273 ran with no error, and no cap is published |
| subscribe frames | `{"m": 0, "i": <even id>, "n": "SubscribeLevel2", "o": "{\"OMSId\":1,\"InstrumentId\":<id>,\"Depth\":500}"}` | one instrument per call |
| keepalive | `Ping` every 15 s | the server sends no ping, and the pong is the only traffic on a quiet socket |
| `maxSilenceMs` | 45,000 | three missed pongs, since an empty book stayed silent for the whole 120 s test |
| routing | field 7 of the first level, as a string, gives the `rawMarketId` | frames carry the numeric id only |
| snapshot | the `SubscribeLevel2` reply: `resetBook` | there is no other snapshot event |
| delta | apply every level in array order by price and side, then publish once per frame | delete then new pairs inside one frame |
| resync | no gap rule exists, so compare the book to `GetL2Snapshot` on the same socket on a timer, and resubscribe on a mismatch | ids skip and `i` is not monotonic |
| receive time | stamp on arrival, never from `ActionDateTime` | it is the level's age, not the frame's |
| freshness | expect a change 0.1 to 0.2 s after its stamp, and a quote that makers refresh about once a second | section 4, idle repeats |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitazza API Reference, version 3.3, `last-modified` 2026-09-18 | https://api-doc.bitazza.com/_index.html | 2026-09-23 03:25 UTC | both gateways | URLs, frame shape, call names and payloads, level fields, `Ping`, private call names, sections 1 to 7 |
| S2 | CCXT Pro 4.5.68 `ndax.js` | `server/node_modules/ccxt/js/src/pro/ndax.js` | 2026-09-22 | CCXT | level field names at lines 389 to 398, apply rule at lines 430 to 446, section 4 |
| P1 | `ws-probe.mjs deflate`, `book`, `window`, `batch` and `silence`, run 1 at 03:27 to 03:35 UTC, plus a 12 s hand session at 03:19 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitazza/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs`, every mode, run 2 at 03:42 to 03:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitazza/ws-probe.mjs) | 2026-09-23 UTC | this host | second readings, the stopped instrument, empty frame count, batch `i` order |
| P3 | curl of `GetL2Snapshot` at `Depth` 500 on BTCTHB, USDTTHB and STGUSDT | | 2026-09-23 03:49 UTC | this host | the 16 level books, section 4 |
