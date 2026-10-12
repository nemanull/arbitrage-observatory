# BlueBit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:25 to 04:52 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

BlueBit lists no live perpetual, see [`fees.md`](./fees.md) section 3, so this profile covers the public spot WebSocket, as change 1 of the survey plan's template says.
The socket is the ChainUP `kline-api` socket, documented in section "Subscription" of the venue's API document, S1.
Every probed claim comes from [`ws-probe.py`](../../../scripts/probes/venues/bluebit/ws-probe.py), run twice, and the figures below give both runs where they differ.
The futures socket check is [`futures-ws-probe.py`](../../../scripts/probes/venues/bluebit/futures-ws-probe.py), also run twice.
Socket time across both runs and the first exploration was about nine and a half minutes.

## 1. Endpoints

| market | documented URL | probed |
|---|---|---|
| spot, every pair | `wss://ws.bluebit.io/kline-api/ws`, in the Java demo of S1 and as `wsUrl` in `fePublicInfo`, S2 | HTTP 101 in 773 to 811 ms, on `52.74.184.139`, the address every BlueBit host resolves to |
| futures | none published. `wss://futuresws.bluebit.io/kline-api/ws` follows the host pattern of three of the four ChainUP futures members the server runs, FameEX, x.me and Koinbay, S3 | the name resolves to `52.74.184.139`, and the handshake was refused with HTTP 502 "The page is temporarily unavailable" after 3,828 and 3,814 ms |

One socket carries every spot pair.
All 20 live pairs delivered on one socket in mode `many`.

## 2. Channel matrix for public market data

| channel | documented | probed |
|---|---|---|
| `market_<symbol>_depth_step0` | full book at full price precision, S1 "Subscription - Deep Port" | full snapshots of 25 to 52 levels a side, section 4 |
| `market_<symbol>_depth_step1`, `_step2` | the same book merged to coarser price steps, S1 | 25 levels a side in run 1 and 33 bids and 40 asks in run 2, with BTC/USDT prices rounded to 0.1 and to 1 |
| best bid and ask | no separate channel | none. The top of `depth_step0` is the only live best bid and ask |
| `market_<symbol>_trade_ticker` | trades, S1 "Subscription-Real-time Transaction Information" | trade frames with `price`, `vol`, `side` and a millisecond `ts` |
| `market_<symbol>_ticker` | 24 hour ticker, S1 | 3 frames in 15 s in each run, with no bid or ask field |
| `market_<symbol>_kline_<period>` | candles from `1min` to `1month`, S1 | delivers |
| `review` request | 24 hour data for every pair, S1 | not probed |
| mark, index, funding | none | none, spot only |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL for every spot pair |
| subscribe frame shape | `{"event":"sub","params":{"channel":"market_btcusdt_depth_step0","cb_id":"custom","asks":150,"bids":150}}`, S1 | the same frame without `asks` and `bids` works. Whether `asks` and `bids` change the depth is not established, section 4. One channel per frame |
| unknown symbol expectation | not documented | `market_nosuchusdt_depth_step0` got no frame in 4 s, and the socket stayed open |
| chunk unit and budget | not documented | 20 depth channels on one socket all delivered. No cap was found, and none was looked for beyond the 20 live pairs |
| keepalive mechanism | the server sends `{"ping":<ts>}` and the client answers by replacing "ping" with "pong", in the Java demo of S1 | the server sent `{"ping":<unix seconds>}` every 10.0 s. A client that never answered stayed connected for 150 s in run 1 and 120 s in run 2 |
| connection lifetime and maintenance notice | not documented | no forced close and no notice in any socket of up to 150 s |
| handshake and operation rate limits | not documented | 18 handshakes across the exploration and both runs, none refused |
| public market data authentication | none, S1 | none |
| message parse and routing | gzip, in the Java demo's `uncompress`, S1 | every server frame is a binary frame holding gzip-compressed JSON. Route on `channel`, or on a `ping` key |
| subscribe acknowledgement shape | `{"event_rep":"subed",...,"status":"ok"}`, S1 | no acknowledgement frame. The first data frame arrives with `"event_rep":""` |
| symbol identifier format | lower case base and quote joined, such as `btcusdt`, S1 | the same, matching `common/symbols` |
| number representation | strings, S1 "Numbers" | JSON numbers for book prices and sizes and for kline fields. Trade and ticker fields are strings |
| timestamp representation | milliseconds | `ts` in milliseconds on every data frame, ping values in seconds |
| size unit | not documented | base currency, such as BTC on `btcusdt` |
| sequence semantics | none documented | none. No sequence or update id field exists |
| idle repeat behaviour | "the server will regularly push a full amount of data", S1 | the full book is resent every 0.5 to 11 s, often unchanged, section 4 |

## 4. The book channel in detail

### Snapshot on subscribe

The documentation says "The first successful subscription will immediately return a full amount of data", S1.
On the wire the first `depth_step0` frame came 195 ms after the subscribe frame in run 1 and 196 ms in run 2.
Every later frame is also a full snapshot, so a feed replaces the whole book on each frame.

### Delta semantics

S1 documents an incremental frame with `side`, `price` and `volume`, under the "High Frequency" heading.
No such frame was seen on any channel in either run.
Every book frame carried `tick.asks` and `tick.buys` arrays and nothing else.

### Sequence and gap rule

No sequence exists, because each frame is a full replacement.
`ts` rose strictly from frame to frame in both runs.
A feed needs no gap rule, and staleness is the only failure to watch.

### Checksum

None documented and none on the wire.

### Level order on the wire

Bids, under the key `buys`, are strictly descending and asks strictly ascending in every frame of both runs.
No crossed frame was seen.

### Depth

The number of levels varies from frame to frame, and no fixed cut-off was seen.
In run 1 the BTC/USDT book had 25 to 35 bids and 25 to 28 asks, with 25 bids in six of eight frames and 25 asks in seven.
In run 2 it had 25 to 40 bids and 25 to 40 asks, with 25 bids in seven of thirteen frames.
The documented subscribe with `"asks":150,"bids":150` on ETH/USDT gave 51 or 52 bids and 25 asks in five frames, so whether the parameters do anything is not established.
No BTC/USDT or ETH/USDT frame of either run had fewer than 25 levels a side, which meets the engine's 20-level depth.

### Size unit

Sizes are base currency, so a `btcusdt` level of 0.01 is 0.01 BTC.
There is no contract size on spot.
The book is thin and regular.
In run 2, 542 of the BTC/USDT levels seen held exactly 0.01 BTC and 104 held 0.03 BTC.
The top of book was 82,247.77 bid and 83,143.47 ask in run 1, a spread of 10,831 ppm, and 81,749.66 bid and 83,223.01 ask in run 2, a spread of 17,862 ppm.
In run 2 the REST `get_ticker` read right after the last frame gave the same `buy` and `sell`, so the ticker's bid and ask are this book's top.

### One-sided and empty books

`tonusdt` delivered 4 frames in mode `many` of run 1 and 3 in run 2, all one-sided or empty.
The REST ticker also had no `buy` or `sell` for it, see [`rest.md`](./rest.md) section 5.

### Idle repeats

The cadence changed between the runs.
In run 1, BTC/USDT frames came every 3.02 to 8.05 s, median 6.51 s, and 5 of 7 consecutive frames repeated the tick before them.
In run 2 they came every 0.52 to 11.06 s, median 1.02 s, and 3 of 12 repeated.
Over 25 s in mode `many`, pairs delivered between 3 and 13 frames each in run 1 and between 3 and 14 in run 2.

### Unknown and malformed subscriptions

In both runs an unknown symbol and an unknown channel suffix each got silence for 4 s.
An unknown `event` value was echoed back verbatim, as a binary frame of plain JSON without gzip.
A plain text frame `hello` got silence.
None of them closed the socket.

## 5. Session

| item | probed |
|---|---|
| compression | permessage-deflate offered, and the server answered no `Sec-WebSocket-Extensions` header, so it is not negotiated. The payload is gzip inside each binary frame instead |
| server ping | `{"ping":1791607361}` every 10.0 s, gzip like every other frame |
| client pong | `{"pong":<same value>}` answered every ping in mode `book` without any error frame |
| silence tolerated | a client that never answered a ping was not closed within 150 s in run 1 or 120 s in run 2 |
| client-sent ping | sending `{"ping":<ts>}` made the server drop the connection within 0.2 s without a close frame, in both runs |
| forced disconnect | none seen |
| maintenance notice | none seen |

## 6. Captured frames

Each frame is shown after gzip decompression, and long frames are trimmed.

The subscribe frame sent by the probe:

```json
{"event": "sub", "params": {"channel": "market_btcusdt_depth_step0", "cb_id": "btcusdt"}}
```

The first book frame of run 2, trimmed by the probe to three levels a side:

```json
{"event_rep": "", "channel": "market_btcusdt_depth_step0", "data": null, "tick": {"asks": [[83140.09, 0.01], [83414.46, 0.01], [83461.58, 0.01]], "buys": [[81664.38, 0.01], [80668.16, 0.01], [80576.89, 0.01]]}, "ts": 1791607358000, "status": "ok"}
```

A trade frame, run 2:

```json
{"event_rep": "", "channel": "market_btcusdt_trade_ticker", "data": null, "tick": {"data": [{"amount": "1852.7693841", "ds": "2026-10-10 12:43:39", "id": 9096808, "price": "82676.01", "side": "BUY", "ts": 1791607419000, "vol": "0.02241"}], "ts": 1791607419000}, "ts": 1791607419000, "status": "ok"}
```

The `ds` field reads 12:43:39 while `ts` is 04:43:39 UTC, so `ds` is in UTC+8.

A server ping, run 2:

```json
{"ping": 1791607361}
```

The echo of an unknown event, sent back as a binary frame without gzip in both runs:

```json
{"event": "nosuch", "params": {"channel": "market_btcusdt_depth_step0", "cb_id": "x"}}
```

No subscribe acknowledgement and no error frame exist to capture.

## 7. Private channels

S1 documents no private WebSocket channel.
Orders and balances go through signed REST calls under `/open/api/`, S1.

## 8. Recommended feed shape

No perpetual feed is recommended, because BlueBit lists no live perpetual.
If its futures return on `futuresws.bluebit.io`, BlueBit would likely be a fifth profile of the ChainUP adapter, which already handles gzip frames, whole-book depth frames with no sequence, and the server ping, S3.
That is an expectation from the shared platform, and nothing on the futures side could be probed.
If a spot leg is added later, the shape is short.

- One socket to `wss://ws.bluebit.io/kline-api/ws` for every pair.
- One `{"event":"sub","params":{"channel":"market_<symbol>_depth_step0","cb_id":"<symbol>"}}` frame per pair.
- Gunzip every binary frame before parsing, as `wire::gunzip` already does for the ChainUP futures adapter, S3.
- Answer each `{"ping":n}` with `{"pong":n}`, and never send a ping of its own.
- Replace the whole book on every frame, and keep the top 20 levels.
- `maxSilenceMs` of 20,000, since the longest book gap seen was 11.06 s and pings come every 10 s.
- No resync rule beyond reconnecting on silence, since there is no sequence.

The book is not a useful price source in its current shape.
The spread on BTC/USDT was 10,831 and 17,862 ppm in the two runs, most levels hold a uniform 0.01 BTC, and the book is resent up to 11 s apart.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | BlueBit API document, `https://github.com/bluebitltd/bluebitfile/blob/main/api_doc_en.md`, sections "Subscription - K Line Market" to "Request - 24 Market Data on Home Page" and the Java demo, last commit `81e6c9f` of 2023-10-08 | 2026-10-09 |
| S2 | `https://www.bluebit.io/fePublicInfo`, field `market.wsUrl` | 2026-10-09 |
| S3 | [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 1 to 3 and 25 to 28 for the family and its four members, lines 81 to 162 for their `futuresopenapi` and `futuresws` hosts, lines 292 to 303 for the gzip check, and [`wire.rs`](../../../server/src/venues/wire.rs) lines 29 to 34 for `gunzip` | 2026-10-09 |
