# Aster WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:20 to 22:28 UTC, with the second pass from 22:36 to 22:41 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

**Rechecked:** 2026-10-12 from 22:48 to 23:08 UTC, against the live venue while the Rust adapter was built, and each corrected line names that date.

This profile covers the public market socket of Aster's order book perpetuals (CCXT id `aster`), with the book channel in detail.
The protocol is Binance USD-M futures' market stream protocol, frame for frame, on Aster's own host.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/aster/ws-probe.py), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All times are UTC, and the probe runs are listed as P3 to P6 and R2 in section 9.
Fees and access are in [`fees.md`](./fees.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every perpetual family, combined streams | `wss://fstream.asterdex.com/stream?streams=<a>/<b>` or `/stream` with `SUBSCRIBE` frames, S1 | `/stream` opened with 101 in 303 to 386 ms, P3 to P6 |
| every perpetual family, raw streams | `wss://fstream.asterdex.com/ws/<stream>`, S1 | `/ws/btcusdt@depth20@100ms` sent bare events with no `stream` wrapper, P5 |
| spot | `wss://sstream.asterdex.com/stream`, CCXT Pro `pro/aster.js` line 49 | not probed |

`fstream.asterdex.com` resolved to 99.86.101.28, 99.86.101.32, 99.86.101.37 and 99.86.101.61, P1, and every upgrade reply carried `via: … (CloudFront)` and `x-amz-cf-pop: SEA900-P13`.
So the socket terminates at a CloudFront edge in Seattle from this exit, and the origin behind it was not identified.
All USDT, USD1 and `U` perpetuals share one catalog and one host, but only USDT markets were subscribed here.

## 2. Channel matrix for public market data

Cadences are on `BTCUSDT` over 40 s in P3 and again in R2, each pair P3 then R2, unless named otherwise.

| channel | stream name | payload | documented speed, S1 | probed |
|---|---|---|---|---|
| diff book | `<s>@depth@100ms` | `depthUpdate` with `U`, `u`, `pu` and changed levels | 100 ms | 9.15 and 8.85 frames a second, gap p50 103 and 105 ms, max 163 and 211 ms |
| diff book | `<s>@depth` | the same | 250 ms | 3.83 and 3.8 a second, gap p50 255 ms in both |
| diff book | `<s>@depth@500ms` | the same | 500 ms | 1.95 a second in both, gap p50 505 and 506 ms |
| diff book, undocumented | `<s>@depth@0ms` | the same | not documented | acknowledged, 16.7 and 15.8 a second over 10 s, gap p50 55 and 54 ms, max 97 and 206 ms, `pu` chained on 166 of 166 and 157 of 157 |
| partial book | `<s>@depth20@100ms` | `depthUpdate` with `U`, `u`, `pu` and the whole top 20 a side | 100 ms | 9.0 and 8.7 a second, gap p50 105 and 107 ms, every frame 20 by 20, 975 bytes a frame |
| partial book | `<s>@depth20` | the same | 250 ms | 3.83 and 3.8 a second, every frame 20 by 20 |
| partial book | `<s>@depth10@500ms`, `<s>@depth5@100ms` | top 10 or top 5 | 500 ms, 100 ms | 1.95 and 1.9 a second at 10 by 10, and 6.62 and 7.05 a second at 5 by 5 |
| best bid and ask | `<s>@bookTicker` | `u`, `b`, `B`, `a`, `A`, `T`, `E` | real time | 13.95 and 4.65 a second, gap p50 7 and 56 ms, max 1,392 and 4,904 ms |
| mark, index, funding | `<s>@markPrice@1s` | `p` mark, `i` index, `P` estimated settle, `r` rate, `T` next funding | 1 s or 3 s | 1.0 a second in both, `E` on the whole second |
| mark, index, funding, all markets | `!markPrice@arr@1s` | an array of the same rows | 1 s or 3 s | one frame each 1,001 ms in P5 and 998 ms in R2 at p50, each with 781 rows covering all 577 kept markets |
| trades, klines, tickers, liquidations, `!bookTicker` | as in S1 | | | not probed |

The partial and diff streams of one market at 100 ms carry the same `U`, `u` and `pu` on the same instant.
The first `btcusdt@depth@100ms` and `btcusdt@depth20@100ms` frames both read `U` 599002991170, `u` 599002993110 and `pu` 599002990736 in P3, and both read `u` 599022780955 in R2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one host for every perpetual, `/stream` combined and `/ws/` raw, S1 | as documented, section 1 |
| subscribe frame shape | `{"method":"SUBSCRIBE","params":[…],"id":1}`, S1 | as documented, with raw UTF-8 names accepted, P3 |
| unknown symbol expectation | Not publicly specified | acknowledged with `"result":null` and then silent, for an unknown, an uppercase and a settling name alike, in P4 and R2 |
| chunk unit and budget | 200 streams a connection, S1 | 200 streams in two frames of 100 accepted. A single frame of 199, 200 or 201 streams closed the socket with 3001 `illegal request`, while one of 150 was accepted, in P4 and again in R2 |
| keepalive mechanism | a server ping frame every 5 minutes, and a close after 15 minutes without a pong, S1 | a client protocol ping got its pong in 95.0 to 96.6 ms in P6 and 97.7 to 100.5 ms in R2. No server ping arrived, since no socket lived 5 minutes |
| connection lifetime and maintenance notice | "A single connection is only valid for 24 hours", S1. No notice channel | no forced close in any run, the longest about 63 s, P5 |
| handshake and operation rate limits | 10 incoming messages a second per connection, over that a close and repeated closes may ban the IP, S1 | 12 frames sent within 0.1 ms and 1.4 ms in P4, and within 0.2 ms in R2, were all answered, with no close in the next 4 s |
| public market data authentication | none | none |
| message parse and routing | `{"stream":…,"data":…}` on `/stream`, S1 | route on `stream`, whose suffix is the only thing that tells a diff from a partial frame, since both carry `"e":"depthUpdate"` |
| subscribe acknowledgement shape | `{"result":null,"id":1}`, S1 | `{"id":1,"result":null}`, in 98 ms in P3, before the first data frame |
| symbol identifier format | lowercase symbol, S1 | `market.id` lowercased, including the five ids that are not ASCII, such as `币安人生usdt@depth20@100ms`. Data frames spell `s` as the catalog does, `币安人生USDT`, P3 |
| number representation | prices and sizes as strings, S1 | as documented. `U`, `u`, `pu`, `E` and `T` are integers |
| timestamp representation | `E` event time and `T` transaction time in ms, S1 | `E` trailed local arrival by p50 54 to 56 ms on book streams in P3, 58 to 60 ms in R2 and 61 ms in P5, within a measured clock offset of ±51 ms, see [`rest.md`](./rest.md) section 7 |
| size unit | base asset, the `quantity` of a symbol, S1 section "Terminology" | coins of the base asset, which matches CCXT's `contractSize` 1, section 4 |
| sequence semantics | each event's `pu` equals the previous event's `u`, and a break means start again from a REST snapshot, S1 | 0 breaks in 39,933 diff and 37,106 partial transitions over 100 markets in 60 s in P5, and in 39,562 and 36,344 in R2 |
| idle repeat behaviour | not documented | none. A stream is silent while its book does not change, up to 28,446 ms on one partial stream in P5 and 26,885 ms in R2, and 7 of the 100 quietest markets sent nothing in 30 s, R2 `quiet` |

## 4. The book channel in detail

### Snapshot semantics

A diff stream sends no snapshot.
S1's recipe buffers the diffs, reads `GET /fapi/v3/depth?symbol=…&limit=1000`, drops events whose `u` is below its `lastUpdateId`, starts at the event whose `U` ≤ `lastUpdateId` ≤ `u`, and then requires `pu` to equal the previous `u`.
A partial stream sends the whole top N on every push, so a feed resets the book on every frame.
The REST `lastUpdateId` lives in the same counter as the socket's `u`, about 599,000,000,000 on 2026-10-12, P1 and P3.

### Delta semantics

Each diff level is an absolute quantity, and a quantity of 0 removes the level, S1 steps 7 and 8.
S1 also says a removal of a level the local book does not hold "can happen and is normal".

### Sequence and gap rule

`U` and `u` count one venue-wide sequence, not one per symbol.
The first frames of `BTCUSDT`, `ETHUSDT` and `EWZUSDT` in P3 ended at `u` 599002993110, 599002993288 and 599002993135, which are 178 apart at most.
So the gap rule is per stream: `pu` must equal the `u` of the previous frame of that stream.
It held on 365 of 365 `btcusdt@depth@100ms` transitions and 359 of 359 `btcusdt@depth20@100ms` transitions in P3, on 353 of 353 and 347 of 347 in R2, and on every transition of 200 streams in P5.

### Checksum

None is documented, and no frame carried one.

### Level order on the wire

Partial frames list bids best first, descending, and asks best first, ascending, on every frame in P3 and P5.
Diff frames do not.
The captured `btcusdt@depth@100ms` frame listed both sides by ascending price, and 319 of 366 such frames in P3 and 272 of 354 in R2 failed a bids-descending check.
A diff must be applied level by level, never read as best first.

### Size unit against CCXT `contractSize`

`exchangeInfo` has no `contractSize` or `unit` field on any of 629 rows, P1, so CCXT falls back to 1 at `aster.js` line 861, P7.
Book sizes are base coins.
`BTCUSDT` levels read 4.787 and 0.141 at 82,590.9 and 82,591.0, P1, and `币安人生USDT` levels read whole tokens such as 144 at 0.5753, P3.
Prices are per one base coin, with no 1,000 multiplier hidden in the size: `1000PEPEUSDT` is priced per 1,000 PEPE, which its index basket confirms with `PEPEUSDT*1000` on every source, P1.

### One-sided and empty books

`EWZUSDT` held 14 bids and 12 asks on 337 of 340 partial frames in P3, and 12 to 14 bids and 10 or 11 asks on all 347 in R2, so a depth20 frame can be short.
Among the 100 busiest markets, `COINUSDT` and `LITEUSDT` sent 6 short frames of 37,206 in P5, and `LITEUSDT` 2 of 36,444 in R2.
No one-sided or empty frame was seen.

### Idle repeats

None.
A stream is silent while its book is unchanged.
Over 60 s on the 100 busiest markets the longest silence was 28,446 ms on a partial stream and 20,119 ms on a diff stream in P5, and 26,885 and 13,397 ms in R2.
Over 30 s on the 100 kept markets with the least volume, 7 sent no frame at all, the others sent their first frame p50 1,262 ms and p90 4,489 ms after the first subscribe frame, and 13,497 of their 15,334 frames held fewer than 20 levels on a side, R2 `quiet`.
The REST book of one silent market, `B-MONEYUSDT`, carried an `E` 56 minutes old, so its book had not changed in that time, R1 `book`.
So a book that does not change never reaches the engine from the socket, and a quiet market can leave a whole connection silent.

### Unknown, closed and malformed subscriptions

| subscription or frame | reply | then |
|---|---|---|
| `nopeusdt@depth20@100ms` | `{"id":11,"result":null}` | no frame, and `LIST_SUBSCRIPTIONS` lists it |
| `BTCUSDT@depth20@100ms`, uppercase | `{"id":12,"result":null}` | no frame |
| `tonusdt@depth20@100ms`, `SETTLING` | `{"id":13,"result":null}` | no frame |
| `{not json` | `{"id":null,"error":{"code":3,"msg":"Invalid json"}}` | the socket stays open |
| method `NOPE` | `{"id":14,"error":{"code":2,"msg":"Invalid request: unknown method, expected one of SUBSCRIBE, UNSUBSCRIBE, LIST_SUBSCRIPTIONS, SET_PROPERTY, GET_PROPERTY"}}` | the socket stays open |
| one frame of 199 or more streams | no reply | close 3001 `illegal request` |

A misspelt, uppercase or closed market costs only its own silence, never the socket, P4.
The five ids that are not ASCII each streamed 8 to 48 frames in 8 s, R2 `odd`.
`B-MONEYUSDT`, the one kept id with a hyphen, was acknowledged and sent nothing in 8 s or in 30 s, while its book was unchanged.
On the recheck of 2026-10-12, `b-moneyusdt@depth20@100ms` stayed open from 22:50:21 to 23:00:21 UTC and sent 7 frames, the first about 400 s after the subscribe, with `pu` chained on 6 of 6 transitions.
So the hyphenated stream name works, checked on 2026-10-12.
The first of those frames carried `pu` 599034807833, the `lastUpdateId` of the REST book read at 22:49:02 UTC, so a quiet book's REST id is the id of its last change on the socket's counter.

### REST snapshot against the socket

`GET /fapi/v3/depth` takes limits 5, 10, 20, 50, 100, 500 and 1000, with bids descending and asks ascending, and reads made 250 ms apart all differed, so no edge cache showed, see [`rest.md`](./rest.md) section 5.

## 5. Session

| item | value | source |
|---|---|---|
| keepalive | server ping every 5 minutes, close after 15 minutes without a pong, unsolicited pongs allowed | S1 |
| client ping | a protocol ping is answered with a pong in 95 to 101 ms, and `LIST_SUBSCRIPTIONS` is answered too | P6, R2 |
| silence tolerated | 60 s with no client frame after the subscribe frames, P5, and 15 minutes without a pong by S1 | P5, S1 |
| forced close | at 24 h | S1 |
| compression | permessage-deflate is negotiated only when the client offers it, and plain text JSON otherwise | P5 `deflate`, P3 |
| frames | text frames of JSON | P3 |
| handshake | no header needed, 101 in 303 to 386 ms | P3 to P6 |
| per-connection cap | 200 streams, S1, and a single frame of 199 or more streams closes the socket | S1, P4 |
| message rate | 10 client frames a second documented, a burst of 12 tolerated | S1, P4 |
| maintenance | no notice channel documented | S1 |

## 6. Captured frames

Subscribe acknowledgement and listing, P3:

```json
{"id": 1, "result": null}
```

```json
{"id": 2, "result": ["btcusdt@depth10@500ms", "ewzusdt@depth@100ms", "btcusdt@depth@100ms", "btcusdt@bookTicker"]}
```

The listing is trimmed from 15 names.

A diff frame, P3, complete:

```json
{"stream": "btcusdt@depth@100ms", "data": {"e": "depthUpdate", "E": 1791843654327, "T": 1791843654300, "s": "BTCUSDT", "U": 599002991170, "u": 599002993110, "pu": 599002990736, "b": [["82607.0", "0.000"], ["82625.7", "0.428"]], "a": [["82629.9", "0.060"], ["82642.4", "7.199"], ["82701.2", "0.700"]]}}
```

A partial frame of the same instant, P3, trimmed to three levels a side from 20:

```json
{"stream": "btcusdt@depth20@100ms", "data": {"e": "depthUpdate", "E": 1791843654327, "T": 1791843654300, "s": "BTCUSDT", "U": 599002991170, "u": 599002993110, "pu": 599002990736, "b": [["82627.5", "1.069"], ["82626.6", "0.002"], ["82625.8", "0.128"]], "a": [["82627.6", "0.030"], ["82629.9", "0.060"], ["82633.3", "0.004"]]}}
```

A market whose id is not ASCII, P3, trimmed to one level a side:

```json
{"stream": "币安人生usdt@depth20@100ms", "data": {"e": "depthUpdate", "E": 1791843654325, "T": 1791843654250, "s": "币安人生USDT", "U": 599002991039, "u": 599002992478, "pu": 599002989917, "b": [["0.5753000", "144"]], "a": [["0.5763000", "18"]]}}
```

Best bid and ask, and the mark stream, P3:

```json
{"stream": "btcusdt@bookTicker", "data": {"e": "bookTicker", "u": 599002995335, "s": "BTCUSDT", "b": "82627.5", "B": "1.169", "a": "82627.6", "A": "0.030", "T": 1791843654400, "E": 1791843654424}}
```

```json
{"stream": "btcusdt@markPrice@1s", "data": {"e": "markPriceUpdate", "E": 1791843655000, "s": "BTCUSDT", "p": "82627.50000000", "P": "82760.94957023", "i": "82662.43521739", "r": "0.00007788", "T": 1791849600000}}
```

Errors, P4:

```json
{"id": null, "error": {"code": 3, "msg": "Invalid json"}}
```

A frame of 200 streams ends the socket with close code 3001 and reason `illegal request`, and no JSON reply comes first, P4 and P5.

## 7. Private channels

User data streams take a `listenKey` from `POST /fapi/v3/listenKey`, valid 60 minutes and extended by `PUT`, and are read at `wss://fstream.asterdex.com/ws/<listenKey>`, S1 section "User Data Streams".
The V3 private endpoints are signed by an API wallet, an agent, rather than an HMAC key, S2.
None was called.

## 8. Recommended feed shape

A recommendation for the builder, which follows decisions 21 and 22 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md).

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://fstream.asterdex.com/stream`, with streams sent in `SUBSCRIBE` frames | the raw `/ws/` path cannot name the stream on each frame |
| book channel | `<id lowercased>@depth20@100ms` only, and on every frame `reset_book` with its levels and `publish` | the partial frame is the whole top 20, decision 22's depth, and decision 21 says a whole-book push replaces the book |
| seed | a REST seed, decision 14, from `GET /fapi/v3/depth?symbol=<id>&limit=20`, queued for every market on the connection's first frame as [`backpack.rs`](../../../server/src/venues/backpack.rs) does, and applied only while no socket frame with a larger `u` than its `lastUpdateId` has been applied | a book that does not change sends nothing, section 4, and the REST book shares the socket's counter |
| `snapshot_gap` | 400 ms or more | each seed weighs 2, so three connections at 400 ms spend 900 weight a minute, which with the 600 of the anchor stays under the 2,400 budget, and 193 markets a connection seed in about 77 s |
| sequence | keep `u` per market, and log a `pu` that is not the previous `u` without a resync | each frame is whole, so a missed push costs freshness only. P3 and P5 saw 0 breaks |
| markets per connection | 200, one stream each, so 577 markets take 3 connections | the cap is 200 streams a connection, S1, and P4 held 200. One socket of 100 busy markets with two streams each carried 1,287 and 1,268 frames and 786 and 764 KiB a second in P5 and R2 |
| subscribe frames | 50 streams a frame, `subscribe_gap` 250 ms | a frame of 199 streams closed the socket, a frame of 150 passed, and the documented rate is 10 frames a second |
| catalog guard | subscribe only `TRADING` ids from the loader, lowercased with `to_lowercase` | an unknown or closed name is acknowledged and then silent, so `first_book_wait` is the only place it shows |
| keepalive | the runtime's default protocol ping, `ping_every` 30 s | the pong came back in 95 to 101 ms, P6 and R2, and a pong counts as traffic at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 621 |
| `max_silence` | 60 s | books fall silent when unchanged, up to 28 s seen on one stream, but the 30 s ping keeps a live connection talking |
| `retire_after` | 23 h with 30 minutes of jitter, as binance sets | S1's 24 hour cap |
| deflate | not offered, which the runtime already does | P5 showed the server negotiates it only when offered |
| receive time | stamp on arrival, and keep `E` | `E` trailed arrival by about 55 ms from this host |
| reuse | the frame structs and `apply_snapshot` of [`binance.rs`](../../../server/src/venues/binance.rs) parse Aster's frames unchanged | same field names and the same `"e":"depthUpdate"` on both stream kinds |

A faster option exists for a later change.
The binance adapter's shape, `@depth@0ms` diffs reseeded by `@depth20@100ms` snapshots inside the snapshot's price window, works on Aster's wire, since `@depth@0ms` was acknowledged and chained 166 of 166 frames in P3 and 157 of 157 in R2 at a gap of about 55 ms.
It is undocumented on Aster, so the documented `@depth20@100ms` is the recommendation, and the diff upgrade is a choice for the main session.
With two streams a market the cap gives 100 markets a connection, so 577 markets would take 6 connections.

The socket could also carry the anchor, because `!markPrice@arr@1s` sends index, mark, rate and next funding for every market once a second.
[`rest.md`](./rest.md) section 8 recommends the REST poll instead, since the funding interval is not in the stream and the REST call is one request a second.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Aster Futures API V3, sections "Websocket Market Streams", "Partial Book Depth Streams", "Diff. Book Depth Streams", "How to manage a local order book correctly" and "User Data Streams" | https://github.com/asterdex/api-docs/blob/master/V3(Recommended)/EN/aster-finance-futures-api-v3.md | 2026-10-12, repository head `eeddec8d97` of 2026-09-23 | Aster, API docs | URLs, limits, stream names and payloads, sections 1 to 7 |
| S2 | Aster API V1 vs V3 | https://github.com/asterdex/api-docs/blob/master/Aster%20API%20Overview.md | 2026-10-12 | Aster, API docs | agent signing for private calls, section 7 |
| S3 | CCXT Pro 4.5.68 `pro/aster.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/aster.js` | 2026-10-12 | CCXT | URLs at lines 49 to 54, depth 5, 10 or 20 at lines 942 to 948, section 1 |
| S4 | CCXT 4.5.68 `aster.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/aster.js` | 2026-10-12 | CCXT | `contractSize` fallback at line 861, section 4 |
| P1 | `rest-probe.py` modes `host`, `catalog`, `book` and `refs`, 22:18:35 to 22:19:13 UTC | [`rest-probe.py`](../../../scripts/probes/venues/aster/rest-probe.py) | 2026-10-12 | this host, Canadian exit | DNS, REST book and ids, sections 1 and 4 |
| P3 | `ws-probe.py basic` and `zero`, 22:20:53 to 22:21:44 UTC | [`ws-probe.py`](../../../scripts/probes/venues/aster/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 6 |
| P4 | `ws-probe.py errors`, 22:22:09 and 22:23:31 UTC | [`ws-probe.py`](../../../scripts/probes/venues/aster/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 to 6 |
| P5 | `ws-probe.py batch`, `markarr` and `deflate`, 22:25:04 to 22:26:34 UTC, 100 markets and 200 streams for 60 s | [`ws-probe.py`](../../../scripts/probes/venues/aster/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 5 |
| P6 | `ws-probe.py ping`, 22:27:17 UTC | [`ws-probe.py`](../../../scripts/probes/venues/aster/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 5 |
| P7 | `fees-probe.py ccxt`, 22:27:45 UTC | [`fees-probe.py`](../../../scripts/probes/venues/aster/fees-probe.py) | 2026-10-12 | this host, Canadian exit | CCXT `contractSize`, section 4 |
| R2 | the second pass of `ws-probe.py`, every mode, 22:36:00 to 22:39:50 UTC, plus the new modes `odd` at 22:39:59 and `quiet` at 22:40:09 UTC | [`ws-probe.py`](../../../scripts/probes/venues/aster/ws-probe.py) | 2026-10-12 | this host, Canadian exit | every number above, and the quiet and odd markets of section 4 |
| R1 `book` | `rest-probe.py book`, rerun at 22:41:45 UTC with `B-MONEYUSDT` added | [`rest-probe.py`](../../../scripts/probes/venues/aster/rest-probe.py) | 2026-10-12 | this host, Canadian exit | the age of a quiet REST book, section 4 |
