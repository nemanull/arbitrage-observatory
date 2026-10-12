# B2Z Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:43 to 05:54 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures WebSocket of B2Z Exchange for its one perpetual family, with the book channel in detail.
B2Z documents no socket.
The URLs come from the web app bundle, and the protocol is BTSE's, recorded in full in [`../btse/websocket.md`](../btse/websocket.md).
This profile records what was probed on the B2Z host and what it shares with BTSE.
Every claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/b2z/ws-probe.py).

## 1. Endpoints

| endpoint | source | probed |
|---|---|---|
| futures OSS, book topics | `wss://ws.b2z.exchange/ws/oss/futures`, the web app's `futuresOss` path | open in 352 to 476 ms over the 8 sockets whose open time was logged. Every one of the 218 perpetuals delivered |
| futures main, trades and private topics | `wss://ws.b2z.exchange/ws/futures`, the web app's `futures` path | `tradeHistoryApiV3:BTC-PERP` delivered 4 frames in 15 s in the first run and 1 in the second. `update:BTC-PERP_0` sent to it was left out of the acknowledgement and never delivered |
| spot OSS, spot main, OTC | `/ws/oss/spot`, `/ws/spot`, `/ws/otc` on the same host | named in the web app bundle and not probed |

`ws.b2z.exchange` resolves to the same four CloudFront addresses as `api.b2z.exchange`, see [`rest.md`](./rest.md) section 1.
No socket was refused from the Canadian exit.

## 2. Channel matrix for public market data

The topics are BTSE's, see [`../btse/websocket.md`](../btse/websocket.md) section 2.

| topic | endpoint | probed on B2Z |
|---|---|---|
| `update:<symbol>_<grouping>` | OSS | snapshot of 50 levels per side, then deltas. Recommended |
| `tradeHistoryApiV3:<symbol>` | main | trades, 4 and 1 frames in two 15 s runs on `BTC-PERP` |
| mark, index, funding or ticker topic | | none in BTSE's protocol, so the anchor comes from REST, see [`rest.md`](./rest.md) section 3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is BTSE's documentation, since B2Z publishes none.

| axis | documented by BTSE | probed on B2Z |
|---|---|---|
| endpoint split axis | book topics on OSS, the rest on main | the same, section 1 |
| subscribe frame shape | `{"op": "subscribe", "args": [...]}` | accepted, 100 topics in one frame acknowledged in one reply |
| unknown symbol expectation | error code 1000 | `{"severity":"ERROR","errors":[{"arg":"update:NOPE-PERP_0","error":{"code":1000,"message":"Market pair provided is currently not supported."}}]}` |
| chunk unit and budget | 100 topics per connection, 50 connections per IP | 218 perpetuals on three sockets of at most 100 topics, all booked |
| keepalive mechanism | text `ping` every 15 s, answered by `pong` | `pong` in 105 to 151 ms on every socket |
| connection lifetime and maintenance notice | idle 60 s without a ping is dropped | a socket with no subscription and no ping closed at 60.4 s with no close frame. No maintenance message seen |
| handshake and operation rate limits | 50 connections per IP | no refusal at 3 sockets at once |
| public market data authentication | none | none |
| message parse and routing | `{"topic", "data"}` | as documented. Route on `data.symbol` |
| subscribe acknowledgement shape | `{"event": "subscribe", "channel": [...]}` | as documented, and the snapshots arrived before the acknowledgement |
| symbol identifier format | `BTC-PERP` | `BTC-PERP` in `data.symbol`. The catalog `symbol` is `BTC-PERP-USDT` |
| number representation | strings | strings on every level |
| timestamp representation | `timestamp` in ms | integer ms. The BTC and ETH snapshots were 53 to 76 ms old on arrival over two runs, and the quietest of the 218 was 1,391 ms old |
| size unit | Not publicly specified | contracts of `contractSize` coins, as on BTSE, since the levels equal BTSE's, section 4 |
| sequence semantics | `seqNum` is one after `prevSeqNum`, resubscribe on a break | 0 gaps in 2,555 and 2,695 deltas on BTC and ETH in two runs, and 0 in 35,720 and 35,816 deltas across 218 perpetuals |
| idle repeat behaviour | not documented | no repeated `seqNum` |

## 4. The book channel in detail

`update:<symbol>_0` on the OSS URL is the recommended channel.

### Snapshot, deltas and the gap rule

All 218 perpetuals sent exactly one snapshot each in both 45 s batch runs, and none sent a second.
Snapshots held 50 bids and 50 asks on BTC and ETH, bids best first and asks worst first, so the best ask is the last element, as on BTSE.
The first delta after each snapshot had `prevSeqNum` equal to the snapshot's `seqNum`.
A level of size `"0"` deletes it, and a book kept from the snapshot and every delta never held more than 50 levels per side and never crossed.
The gap rule, the unordered levels inside deltas and the 50 level window are BTSE's, see [`../btse/websocket.md`](../btse/websocket.md) section 4.

### One feed for two venues

The probe held a B2Z socket and a BTSE socket open side by side for 40 s on `update:BTC-PERP_0` and `update:ETH-PERP_0`, twice.

| run | symbol | `seqNum` values on B2Z | on BTSE | shared | B2Z arrival minus BTSE arrival, median |
|---|---|---:|---:|---:|---:|
| first | `BTC-PERP` | 1,212 | 1,211 | 1,207 | 8.7 ms |
| first | `ETH-PERP` | 1,345 | 1,345 | 1,339 | 8.8 ms |
| second | `BTC-PERP` | 1,355 | 1,355 | 1,354 | 6.2 ms |
| second | `ETH-PERP` | 1,342 | 1,343 | 1,342 | 6.1 ms |

The few values not shared fall at the edges of the window, where one socket subscribed a moment before the other.
Both snapshots carried the same levels: BTC opened with `["82737.7","2797"]` as best bid and `["82780.4","442200"]` as worst ask on both hosts.
So B2Z relays BTSE's book feed with the same sequence numbers, under 10 ms behind BTSE's own socket as seen from this host.

### Checksum

None, as on BTSE.

## 5. Session

| item | probed |
|---|---|
| keepalive | text `ping` every 15 s, `pong` in 105 to 151 ms |
| idle close | 60.4 s in both runs for a socket with no subscription and no ping, with no close frame, so a client sees 1006 |
| compression | a client that offered permessage-deflate got `permessage-deflate;client_max_window_bits=15`. A client that offered nothing got no extension and plain text frames. The server negotiates it and does not force it |
| maintenance notice | none seen |

## 6. Captured frames

Subscribe acknowledgement, from the B2Z OSS socket:

```json
{"event": "subscribe", "channel": ["update:ETH-PERP_0", "update:BTC-PERP_0"]}
```

Snapshot, trimmed to two levels per side:

```json
{"topic": "update:BTC-PERP_0", "data": {"bids": [["82737.7", "2797"], ["82677.3", "134762"]], "asks": [["82780.4", "442200"], ["82779.9", "312650"]], "seqNum": 28296700, "prevSeqNum": 28296699, "type": "snapshot", "symbol": "BTC-PERP", "timestamp": 1791610991192}}
```

Delta, trimmed:

```json
{"topic": "update:BTC-PERP_0", "data": {"bids": [["82673.0", "343900"], ["82659.8", "103650"]], "asks": [["82781.6", "442200"], ["82781.2", "312650"]], "seqNum": 28296701, "prevSeqNum": 28296700, "type": "delta", "symbol": "BTC-PERP", "timestamp": 1791610991222}}
```

Unknown symbol:

```json
{"severity": "ERROR", "errors": [{"arg": "update:NOPE-PERP_0", "error": {"code": 1000, "message": "Market pair provided is currently not supported."}}]}
```

The keepalive answer is the bare text `pong`, which is not JSON.

## 7. Private channels

On the main URL, as on BTSE: `notificationApiV4`, `fillsV2`, `allPositionV4` and `positionsV3`, see [`../btse/websocket.md`](../btse/websocket.md) section 7.
None was probed.

## 8. Recommended feed shape

The BTSE feed of [`../../../server/src/venues/btse.rs`](../../../server/src/venues/btse.rs) with one change, the URL `wss://ws.b2z.exchange/ws/oss/futures`.
Topic `update`, grouping `0`, 100 markets per connection, text `ping` every 15 s, and a resync on any `prevSeqNum` break all carry over.

The feed would duplicate the BTSE leg message for message, see section 4.
The engine should carry one of BTSE and B2Z, never both, see [`rest.md`](./rest.md) section 8.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://www.b2z.exchange/static/js/ZwG30tV1.js`, a chunk of the web app | the socket path table `futures`, `futuresOss`, `spot`, `spotOss`, `otc`, joined to the API host |
| S2 | [`../btse/websocket.md`](../btse/websocket.md) | BTSE's documented protocol, gap rule, level order and private topics |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/b2z/ws-probe.py) modes `book` and `main` at 05:43 UTC, `batch` and `idle` at 05:44 to 05:46 UTC, and the second pass at 05:50 to 05:54 UTC on 2026-10-10 | every probed row |
