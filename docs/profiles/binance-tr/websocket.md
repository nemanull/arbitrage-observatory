# Binance TR WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 02:58 to 03:12 UTC, from the development host near Seattle, through the Surfshark WireGuard exit in Vancouver, Canada.

Binance TR lists no perpetual, so this profile covers its spot book channel, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Its stream host speaks Binance.com's spot stream protocol and carries Binance.com's TRY books, frame for frame.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/binance-tr/ws-probe.py), run 1 at 02:58 UTC and run 2 at 03:08 UTC in the second pass, which held sockets for about 4 minutes each.
Captured frames went to the gitignored `.claude/survey-work/binance-tr/ws-capture.jsonl`.

## 1. Endpoints

| URL | documented for | probed |
|---|---|---|
| `wss://stream-cloud.binance.tr/ws/<stream>` and `/stream?streams=<a>/<b>` | `type` 1 symbols, lower case and without the underscore, S1 | open, serves every TRY pair tried and also `btcusdt`, which is not a Binance TR market |
| `wss://stream.binance.com:9443` | the second entry of the web app's `binanceWssBaseUrlList`, S2 | Binance.com's own host, same frames as the TR host, section 4 |
| `wss://stream-tr.2meta.app` | `type` 3 "Nextme" symbols, S1 | opens, sends nothing for `btctry@depth20` in 4 s. The catalog has no `type` 3 symbol |
| `wss://www.binance.tr` | `type` 2 symbols in the 2023-08-16 change log, S1 | HTTP 404 on `/ws/btctry@depth20` |
| `wss://ws-api.binance.tr:443/ws-api/v3` | WebSocket API for user data, S1 | opens, sends nothing unprompted |

Binance TR has one market family, TRY spot, so one host carries everything.

## 2. Channel matrix for public market data

The docs list Binance.com's spot streams, S1.

| channel | stream name | speed | present |
|---|---|---|---|
| diff depth | `<symbol>@depth` or `<symbol>@depth@100ms` | 1000 ms or 100 ms | yes, probed |
| partial depth | `<symbol>@depth<5, 10 or 20>` or with `@100ms` | 1000 ms or 100 ms | yes, `depth20@100ms` probed |
| trades | `<symbol>@trade`, `<symbol>@aggTrade` | real time | documented, not probed |
| kline | `<symbol>@kline_<interval>` | 2000 ms | documented, not probed |
| mini ticker | `<symbol>@miniTicker`, `!miniTicker@arr` | 1000 ms | documented, not probed |
| best bid and ask | not in the Binance TR docs | | Not publicly specified |
| mark, index, funding | none, since there is no perpetual | | Not offered |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | by symbol `type`: 1 on `stream-cloud.binance.tr`, 3 on `stream-tr.2meta.app`, S1 | every listed symbol is `type` 1, so one host |
| subscribe frame shape | `{"method":"SUBSCRIBE","params":["btcusdt@aggTrade","btcusdt@depth"],"id":1}`, or streams in the URL, S1 | both work |
| unknown symbol expectation | not documented | `nopetry@depth@100ms` is acked `{"result":null,"id":3}`, appears in `LIST_SUBSCRIPTIONS`, and stays silent. A raw URL for it opens and sends nothing in 5 s |
| chunk unit and budget | not in the Binance TR docs | not probed. Binance.com allows 1,024 streams a connection, see [`../binance/websocket.md`](../binance/websocket.md) section "Spot session limits" |
| keepalive mechanism | "a ping frame every 3 minutes", and a disconnect without a pong "within a 10 minute period", S1 | a protocol ping every 20 s, with the server's ms clock as a 13 byte payload, answered by the client library's pong. That is Binance.com's current rule of 20 s and one minute, S3 |
| connection lifetime and maintenance notice | "only valid for 24 hours", S1 | not reached in holds of 202 and 203 s |
| handshake and operation rate limits | not in the Binance TR docs | Binance.com's 5 incoming messages per second and 300 connection attempts per 5 minutes per IP, S3. Not probed |
| public market data authentication | none | none |
| message parse and routing | combined frames `{"stream":"<name>","data":<payload>}`, S1 | as documented. A raw `depth20` payload carries no symbol, so routing needs the combined wrapper |
| subscribe acknowledgement shape | `{"result":null,"id":1}`, S1 | as documented |
| symbol identifier format | lower case, no underscore, `btctry`, S1 | the diff frame's `s` is upper case `BTCTRY`, CCXT `binance` `market.id`, and the catalog's `BTC_TRY` with the underscore removed |
| number representation | strings | price and size as strings |
| timestamp representation | `E` event time in ms | `E` in ms on diff frames. `depth20` frames carry no time |
| size unit | base asset quantity | base asset quantity, equal to the REST book |
| sequence semantics | each event's `U` equals the previous `u` plus 1, S1 | 0 gaps, see section 4 |
| idle repeat behaviour | not documented | no frame when the book does not change, on either stream, and 0 identical consecutive `depth20` frames |

## 4. The book channel in detail

### Snapshot on subscribe

The diff stream sends no snapshot.
The docs' recovery rule is Binance.com's: buffer the stream, fetch `https://api.binance.me/api/v3/depth?symbol=BNBBTC&limit=1000`, drop events with `u` at or below `lastUpdateId`, and start from the event whose `U` is at most `lastUpdateId` plus 1 and whose `u` is at least that, S1.
`depth20@100ms` is a whole 20 level snapshot on every push.

### Delta semantics

Each diff level is the absolute size at that price, and size 0 removes the level, S1.

### Sequence and gap rule

| run | stream | frames | `U` equal to previous `u` plus 1 | gaps |
|---|---|---|---|---|
| 1 | `btctry@depth@100ms` | 157 | 156 | 0 |
| 1 | `ethtry@depth@100ms` | 266 | 265 | 0 |
| 2 | `btctry@depth@100ms` | 235 | 234 | 0 |
| 2 | `ethtry@depth@100ms` | 180 | 179 | 0 |

Run 1 synced BTCTRY by the documented rule: snapshot `lastUpdateId` 5987819574, two events buffered, one dropped, first kept event `U` 5987819575 and `u` 5987819587.
Run 2 did the same from snapshot 5987824606, with 12 events buffered, 9 dropped, and the first kept event at `U` and `u` 5987824607.
The synced book then equalled the `depth20` frame at the same update id on 155 of 155 shared ids in run 1 and 223 of 223 in run 2.
3 and 13 `depth20` ids were never met by a diff `u`, and the probe did not establish why.

### Checksum

None documented, none on the wire.

### Level order on the wire

`depth20` bids descend and asks ascend, since they equalled the sorted synced book.
The order of diff levels was not checked, and it does not matter, since each level is absolute.

### Level window

`depth20` carried 20 levels a side on all 158 frames of run 1 and all 236 of run 2, which covers the engine's 20.

### Size unit against CCXT `contractSize`

Sizes are base asset quantities, for example `0.00418000` BTC at the BTCTRY bid of the first `depth20` frame of run 1, in the same unit as the REST book.
CCXT `binance` sets `contractSize` only for contract markets and leaves it undefined on spot, at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/binance.js` lines 3569 to 3586, and the engine reads a missing size as 1.

### One-sided and empty books

Not seen, since every pair probed had both sides.

### Idle repeats

BTCTRY is thin.
In run 1 its `depth@100ms` and `depth20@100ms` frames came at a median gap of 101 ms, but the 95th percentile gap was 8.1 s and the longest 14.1 s.
In run 2 the same streams had a median of 101 ms, a 95th percentile of 5.6 s and a longest gap of 20.7 s.
`ethtry@depth@100ms` had a median gap of 199 ms and a longest of 9.7 s in run 1, and 107 ms and 11.9 s in run 2.
No frame repeats an unchanged book, so silence on a quiet pair is normal and only the 20 s ping proves the socket is alive.

### Same frames as Binance.com

Section A2 of the probe read `btctry@depth20@100ms` from both hosts for 20 s at once.
In run 1 both sent 4 frames, and in run 2 both sent 15.
Every update id was on both hosts, and the levels at each id were identical, 4 of 4 and 15 of 15.
The TR frame arrived 0 to 6 ms before the Binance.com frame, which is noise at this sample size.

### Unknown, closed and wrong level symbols

An unknown symbol is acked and silent, as section 3 says.
A non TRY Binance.com symbol, `btcusdt@depth5`, is served on the TR host.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every 3 minutes, S1 | server ping every 20 s, first at 10.4 s after connect in run 1 and 7.5 s in run 2, then every 19.9 to 20.1 s, ten in each 195 s hold |
| silence tolerated | 10 minutes without a pong, S1 | not tested, since the client always answered |
| forced disconnect | at 24 hours, S1 | not reached |
| invalid JSON | `{"code":3,"msg":"Invalid JSON: ..."}`, S1 | the server closed the socket with 1008 "Invalid request" |
| bad method | code 2 "unknown variant", S1 | `` {"error":{"code":2,"msg":"Invalid request: unknown variant `SUBSCRIBEX`, expected one of ..."},"id":6} ``, and the socket stayed open |
| compression | not documented | no extension when the client offers none. When offered, the server accepts `permessage-deflate; server_no_context_takeover; client_max_window_bits=15`, so a client that refuses deflate is fine |

## 6. Captured frames

Subscribe acknowledgement and list, run 1 section B:

```json
{"result": null, "id": 1}
```

```json
{"result": ["btctry@depth20@100ms", "nopetry@depth@100ms"], "id": 4}
```

The first BTCTRY diff frame of run 1 on the combined stream, complete:

```json
{"stream": "btctry@depth@100ms", "data": {"e": "depthUpdate", "E": 1791601095998, "s": "BTCTRY", "U": 5987819573, "u": 5987819574, "b": [["4064231.00000000", "0.00995000"]], "a": [["4068795.00000000", "0.01100000"]]}}
```

The first `depth20` frame of run 1 carries only the id and the levels, trimmed here from 20 levels a side to one:

```json
{"stream": "btctry@depth20@100ms", "data": {"lastUpdateId": 5987819574, "bids": [["4065772.00000000", "0.00418000"]], "asks": [["4066381.00000000", "0.00996000"]]}}
```

The keepalive, as the client library logged it:

```text
< PING '1791601097665' [text, 13 bytes]
> PONG '1791601097665' [text, 13 bytes]
```

An error for a bad method:

```json
{"error": {"code": 2, "msg": "Invalid request: unknown variant `SUBSCRIBEX`, expected one of `SUBSCRIBE`, `UNSUBSCRIBE`, `LIST_SUBSCRIPTIONS`, `SET_PROPERTY`, `GET_PROPERTY`"}, "id": 6}
```

## 7. Private channels

User data uses a `listenToken` from the signed `POST /open/v1/user-listen-token`, subscribed on `wss://ws-api.binance.tr:443/ws-api/v3` with `userDataStream.subscribe.listenToken`, S1.
The older `listenKey` calls on `/open/v1/user-data-stream` were marked for decommissioning on 2026-04-30, S1.

## 8. Recommended feed shape

No feed is recommended, because Binance TR has no perpetual and its spot books are Binance.com's books.
A TRY spot feed, if one were ever wanted, should be built as a Binance.com spot feed on `wss://stream.binance.com:9443`, and it would serve Binance TR accounts unchanged.
For that case the probed facts are these.

| item | value | reason |
|---|---|---|
| channels | `<symbol>@depth@100ms` with `<symbol>@depth20@100ms` on the combined path | the diff chain had 0 gaps, and `depth20` equalled the synced book at every shared id |
| resync | `U` not equal to the previous `u` plus 1: `resync` | the documented rule |
| keepalive | answer the server's protocol ping with its payload | pings came every 20 s |
| `maxSilenceMs` | at least 60,000, with pings counted as traffic | a quiet pair went 20.7 s without a book frame, and only the ping marks a live socket |
| unserved stream | log a stream with no frame some seconds after its ack | an unknown symbol is acked and silent |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Binance TR API documentation, sections "General WSS information", "Detailed Stream information", "User Data Streams" and "WebSocket API" | https://www.binance.tr/apidocs/ | 2026-10-10 UTC, change log head 2026-08-28 | Binance TR | hosts, streams, keepalive text, recovery rule, errors, sections 1 to 7 |
| S2 | Binance TR web app `/v1/common/system-config` | https://www.binance.tr/v1/common/system-config | 2026-10-10 UTC | Binance TR | stream base list, section 1 |
| S3 | Binance spot WebSocket streams documentation, "WebSocket Limits" and the ping rule | https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md | 2026-10-10 UTC | Binance.com | 20 s ping, one minute pong, 5 messages per second, 1,024 streams, 300 connections per 5 minutes, section 3 |
| P1 | `ws-probe.py`, run 1 at 02:58 UTC and run 2 at 03:08 UTC | [`ws-probe.py`](../../../scripts/probes/venues/binance-tr/ws-probe.py) | 2026-10-10 UTC | this host | every probed row |
