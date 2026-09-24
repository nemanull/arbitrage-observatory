# GMO Coin WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (2026-09-23 03:16 to 03:29 UTC), from the development host near Seattle.

This profile covers the public WebSocket of GMO Coin (no CCXT class) for its only perpetual family, the 12 `*_JPY` leverage symbols, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/gmo-coin/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Run P1 held one socket from 03:16:20 to 03:18:01 UTC and run P2, the second pass, from 03:25:31 to 03:27:13 UTC.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| JPY leverage and spot, public | `wss://api.coin.z.com/ws/public/v1`, S1 section "Endpoint" names `wss://api.coin.z.com/ws/public` and version v1, and every request example uses the `/v1` URL | open in 391 to 431 ms over nine sockets |
| private | `wss://api.coin.z.com/ws/private/v1/{token}`, S1 | not probed |

One socket carries every symbol, leverage and spot alike.
The P1 and P2 sockets each held the 12 leverage books and the spot `BTC` book together.
`api.coin.z.com` is a CloudFront distribution that resolved to four addresses, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscribe frame | depth and speed | probed |
|---|---|---|---|
| `orderbooks` | `{"command": "subscribe", "channel": "orderbooks", "symbol": "BTC_JPY"}` | a whole 30 level snapshot per side, mostly on a 505 ms grid, section 4 | 1,853 and 1,863 book frames on 13 books, each subscribed for 87 to 100 s of a 100 s run |
| `ticker` | `{"command": "subscribe", "channel": "ticker", "symbol": "BTC_JPY"}` | best bid, best ask, last, high, low, 24 h volume | 24 and 25 frames on `BTC_JPY` in about 85 s |
| `trades` | `{"command": "subscribe", "channel": "trades", "symbol": "BTC_JPY"}`, optional `"option": "TAKER_ONLY"` | one frame per trade | 54 and 58 frames on `BTC_JPY` in about 84 s |
| mark, index, funding | none | | the venue publishes none of the three, see [`rest.md`](./rest.md) section 3 |

The channel names and parameters are from S1.
The documentation names no depth and no push interval for `orderbooks`, and calls each push "an order book (snapshot)".

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | one socket carried leverage and spot books together |
| subscribe frame shape | `{"command": "subscribe", "channel": "orderbooks", "symbol": "BTC"}`, one symbol per frame, S1 | as documented, one symbol per frame |
| unknown symbol expectation | Not publicly specified | `{"error":"ERR-5106 Invalid request parameter. symbol"}`, the socket stays open |
| chunk unit and budget | "1 request (subscribe/unsubscribe) per second from each IP address", S1 section "API Limiting" | 19 subscribes 1.1 s apart on one socket, none refused, and the 13 books took 13.2 s to subscribe |
| keepalive mechanism | "A ping will be sent from the server to a client once per minute. If there's no response (pong) from a client 3 consecutive times, then the WebSocket will be disconnected automatically.", S1 | a protocol ping at 59,997 to 60,000 ms on the four sockets that lived past 60 s. A socket with no traffic either way was closed at 59,994 to 59,999 ms with 1006 and no ping, section 5 |
| connection lifetime and maintenance notice | HTTP 503 "when WebSocket API is called while the service is in maintenance", S1 | no maintenance during the probe, no lifetime cap reached in 100 s |
| handshake and operation rate limits | 1 subscribe or unsubscribe per second per IP | no refusal at one subscribe per 1.1 s. A faster burst was not tried, so the refusal shape is Not verified |
| public market data authentication | none | none |
| message parse and routing | `channel` and `symbol` at the top level | as documented, routing on `symbol` |
| subscribe acknowledgement shape | "There is no Response when unsubscribe is requested.", and nothing is documented for subscribe | no acknowledgement. The first book arrived 123 to 1,544 ms after the subscribe in P1 and 153 to 949 ms in P2 |
| symbol identifier format | `BTC_JPY` for leverage, `BTC` for spot | identical to the REST `symbol` on the 13 symbols subscribed |
| number representation | prices and sizes as strings | strings, as documented, plus an undocumented `"grouping":"1"` string on all 52 captured book frames |
| timestamp representation | ISO 8601 string with milliseconds | `"timestamp":"2026-09-23T03:25:35.843Z"`, the time the snapshot was stamped, 48 to 51 ms before arrival at the minimum |
| size unit | the base coin, as `取引単位 BTC` on the product page, S2 | the base coin: `BTC_JPY` sizes such as `"0.001"` BTC, equal to the REST book at the same price |
| sequence semantics | none | no sequence field and no checksum. Every frame is a whole snapshot |
| idle repeat behaviour | not documented | an identical snapshot is resent: 6 to 18 repeats per book per run, and on a quiet book a repeat follows a median 4.4 s and at most 5.2 s after the previous frame |

## 4. The book channel in detail

### Snapshot on subscribe

Every `orderbooks` frame is a snapshot of 30 bids and 30 asks, on all 13 books in both runs.
No frame held fewer or more levels, and none was one-sided.
There is no delta, so a feed replaces the book on every frame.
The first frame for each symbol arrived without an acknowledgement, see section 3.

### Delta semantics

None.
The REST `orderbooks` call returns the whole book, up to 500 levels per side, while the socket cuts it at 30, see [`rest.md`](./rest.md) section 5.

### Cadence

| symbol | frames P1, P2 | gap median, ms | gap p90, ms | gap max, ms | repeats P1, P2 |
|---|---|---|---|---|---|
| `BTC_JPY` | 198, 198 | 505, 504 | 521, 527 | 1,015, 1,018 | 11, 10 |
| `ETH_JPY` | 196, 187 | 504, 504 | 514, 536 | 1,018, 1,012 | 13, 6 |
| `XRP_JPY` | 179, 184 | 505, 505 | 517, 514 | 1,012, 1,012 | 7, 11 |
| `BCH_JPY` | 187, 179 | 504, 504 | 594, 1,006 | 1,012, 1,509 | 10, 13 |
| `LTC_JPY` | 156, 146 | 503, 504 | 1,005, 1,006 | 1,077, 1,523 | 11, 9 |
| `SOL_JPY` | 160, 151 | 503, 504 | 1,006, 1,005 | 2,572, 2,253 | 13, 7 |
| `DOGE_JPY` | 177, 173 | 505, 505 | 1,007, 1,007 | 1,116, 2,016 | 9, 10 |
| `SUI_JPY` | 169, 163 | 505, 505 | 646, 1,006 | 1,512, 2,080 | 8, 12 |
| `ADA_JPY` | 134, 139 | 521, 540 | 1,022, 1,014 | 2,521, 1,533 | 18, 16 |
| `LINK_JPY` | 77, 80 | 1,005, 1,004 | 2,509, 2,155 | 4,514, 5,107 | 16, 15 |
| `ATOM_JPY` | 40, 65 | 1,973, 1,012 | 5,081, 3,523 | 5,147, 4,983 | 17, 17 |
| `DOT_JPY` | 25, 40 | 5,072, 1,511 | 5,144, 5,107 | 5,156, 5,148 | 17, 18 |
| `BTC` spot | 155, 158 | 506, 507 | 1,009, 1,006 | 1,512, 1,639 | 11, 12 |

The book is pushed on a grid of about 505 ms when it changed.
In P2, 158 of 197 steps between consecutive `BTC_JPY` timestamps lay within 15 ms of a multiple of 505 ms, and 151 of 186 on `ETH_JPY`.
The shortest step was 7 to 159 ms depending on the symbol, so some frames fall between grid points.
The REST origin regenerates its replies on a grid of 505 to 507 ms too, see [`rest.md`](./rest.md) section 5.
So the freshest book GMO Coin publishes is up to about half a second old at its source, before the 48 to 51 ms of transit.

### Sequence and gap rule

```text
every orderbooks frame   resetBook(bids, asks), then publish
```

No sequence number exists, so no gap can be detected, and none needs to be, since each frame stands alone.
Frames travel over one TCP stream, so none is lost short of a disconnect, and each frame replaces whatever came before.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

Bids descending and asks ascending on every frame of both runs, 0 exceptions in 1,853 and 1,863 book frames, as S1 documents.
No frame was crossed.

### Size unit

Sizes are in the base coin.
The P1 `BTC_JPY` frame and a REST read 427 ms later matched on 20 of 20 bid levels and 20 of 20 ask levels, price and size as strings.
In P2 the REST read 157 ms later matched 17 bid levels and 20 ask levels, and the touch was identical on both sides.
No CCXT class exists, so there is no `contractSize` to compare, and a custom catalog would set it to 1, see [`rest.md`](./rest.md) section 2.

### Price resolution

`tickSize` is 1 JPY on `BTC_JPY`, `ETH_JPY`, `BCH_JPY`, `LTC_JPY`, `DOT_JPY`, `ATOM_JPY`, `LINK_JPY` and `SOL_JPY`, and 0.001 JPY on the other four, from `/v1/symbols`.
At a DOT price near 190 JPY one tick is about 5,250 ppm, and the `DOT_JPY` touch read 190 against 191 on every REST poll of both runs, see [`rest.md`](./rest.md) section 4.
The `DOT_JPY` snapshot in section 6 shows it.

### One-sided and empty books

None seen: 0 one-sided frames in both runs.
What the channel sends for an empty side is Not verified.

### Idle repeats

An identical snapshot, all 60 levels equal to the previous frame of the same symbol, arrived 6 to 18 times per book per run.
On quiet books the repeat is a heartbeat: `DOT_JPY` repeats came a median 4,448 ms apart and at most 5,148 ms apart in P2.
On busy books a repeat can follow 8 to 45 ms after the previous frame, so a repeat is not only a heartbeat.
The longest silence of any book was 5,156 ms, which bounds `maxSilenceMs` from below.

### Unknown, closed and duplicate subscriptions

| request | reply | then |
|---|---|---|
| `orderbooks` `NOPE_JPY` | `{"error":"ERR-5106 Invalid request parameter. symbol"}` | socket stays open |
| channel `nope` | `{"error":"ERR-5106 Invalid request parameter. channel"}` | socket stays open |
| text `not json` | `{"error":"ERR-5106 Invalid request parameter."}` | socket stays open |
| `orderbooks` `BTC_JPY` a second time | nothing | `BTC_JPY` kept one stream: 198 frames in P1 against 196 on `ETH_JPY` |

A delisted symbol was not available on the socket.
The REST `orderbooks` call answers 404 `ERR-5207` for `XTZ` and `DAI`, which the 2026 changelog removed from spot, see [`rest.md`](./rest.md) section 6.
The error frame names the bad parameter but not the symbol, so a feed that subscribes several symbols cannot tell which one failed from the frame alone.
With one subscribe per 1.1 s, the next frame arrives after the error, so pairing an error with the last sent subscribe works.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server protocol ping once a minute, three missed pongs close the socket, S1 | server ping at 59,998 and 59,999 ms on the book sockets, and at 59,997 and 60,000 ms on the client ping sockets. The `ws` library answered them. No application ping exists |
| silence the server tolerates | Not publicly specified | a socket that never subscribed and never sent was closed at 59,994, 59,997 and 59,999 ms in three runs, code 1006, no close frame, no ping first. The same socket sending a protocol ping every 20 s stayed open 100 s, twice, with pongs in 94 to 98 ms |
| forced disconnect | Not publicly specified | none in 100 s on a subscribed socket |
| maintenance notice | HTTP 503 on the socket during maintenance, S1. REST answers `ERR-5201` for regular and `ERR-5202` for emergency maintenance, S1 | not observed. `/v1/status` read `OPEN` |
| regular maintenance | the product page says trading stops during maintenance and the 10 minutes after it are a pre-open that allows only cancels, S2 | the weekly schedule is in a support article that answered this host with a 403 challenge, and a search summary gives Saturday 09:00 to 11:00 JST, Not verified |
| compression | Not publicly specified | text JSON frames with `perMessageDeflate` false. Offered permessage-deflate, the server negotiates `permessage-deflate; server_no_context_takeover; client_no_context_takeover`, twice |
| handshake | | 391 to 431 ms to open from this host over nine sockets |
| subscription limits | 1 subscribe or unsubscribe per second per IP, S1 | 13 books and 2 other channels on one socket at 1.1 s spacing, with no refusal. A per connection cap was not reached |
| throughput | | 13 books plus ticker and trades on one symbol: 1,934 and 1,949 frames per 100 s run, about 19 a second, median 2,070 and 2,071 bytes, max 2,287 bytes, 3.8 MB per run, and a median `JSON.parse` of 52 µs per frame |

The idle close at 60 s is not the documented three missed pongs, which would take three minutes.
It looks like an idle timeout in front of the server, and it cannot hit a subscribed socket, since every book frames at least every 5.2 s.
That reading is an inference.

## 6. Captured frames

Trimmed, from P2.
Arrays marked `…` are cut to three levels.

Subscribe.

```json
{"command": "subscribe", "channel": "orderbooks", "symbol": "BTC_JPY"}
```

Book snapshot, 30 levels per side on the wire.

```json
{"channel": "orderbooks", "asks": [{"price": "13660704", "size": "0.001"}, {"price": "13660910", "size": "0.012"}, {"price": "13661081", "size": "0.02"}], "bids": [{"price": "13658802", "size": "0.008"}, {"price": "13658299", "size": "0.03"}, {"price": "13658273", "size": "0.002"}], "symbol": "BTC_JPY", "timestamp": "2026-09-23T03:25:35.843Z", "grouping": "1"}
```

A quiet book with a one JPY tick.

```json
{"channel": "orderbooks", "asks": [{"price": "191", "size": "350"}, {"price": "192", "size": "1260"}, {"price": "193", "size": "1981"}], "bids": [{"price": "190", "size": "1423"}, {"price": "189", "size": "1550"}, {"price": "188", "size": "2341"}], "symbol": "DOT_JPY", "timestamp": "2026-09-23T03:25:38.734Z", "grouping": "1"}
```

Ticker.

```json
{"channel": "ticker", "ask": "13660265", "bid": "13658273", "high": "13685467", "last": "13659211", "low": "13540729", "symbol": "BTC_JPY", "timestamp": "2026-09-23T03:25:47.765Z", "volume": "963.33"}
```

Trade.

```json
{"channel": "trades", "price": "13659677", "side": "BUY", "size": "0.003", "symbol": "BTC_JPY", "timestamp": "2026-09-23T03:25:49.286Z"}
```

Errors.

```json
{"error": "ERR-5106 Invalid request parameter. symbol"}
```

```json
{"error": "ERR-5106 Invalid request parameter. channel"}
```

Keepalive: the server's protocol ping at 60 s carried an empty payload, and the acknowledgement of a subscribe does not exist, so neither has a JSON frame to show.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They need a token from `POST /private/v1/ws-auth`, which expires after 60 minutes, with at most 5 tokens per key.

- `executionEvents`, `orderEvents`, `positionEvents` and `positionSummaryEvents`, the last with an optional `PERIODIC` option that sends every 5 seconds.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It is moot until the blockers in [`rest.md`](./rest.md) section 8 are solved.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://api.coin.z.com/ws/public/v1` | one socket carries every symbol, and 13 books ran at about 19 frames per second |
| channel | `orderbooks`, one subscribe per `rawMarketId` | the only book channel |
| markets per connection | all 12 leverage symbols | 13 books ran on one socket with no refusal |
| subscribe frames | `{"command": "subscribe", "channel": "orderbooks", "symbol": <rawMarketId>}`, one frame every 1,100 ms | the limit is 1 per second per IP, so a reconnect takes about 13 s to resubscribe 12 books, and every socket from the same IP shares that budget |
| keepalive | let `ws` answer the server ping, and send a protocol ping every 20 s | the documented ping, and a client ping kept an idle socket open past the 60 s close |
| `maxSilenceMs` | 15,000 | a quiet book repeats at least every 5.2 s, so three missed repeats is a dead stream |
| snapshot | every frame: `resetBook(bids, asks)` then `publish` | every frame is a whole 30 level snapshot |
| resync | none needed for gaps. On an `error` frame, log it with the last sent subscribe | there is no sequence to break |
| receive time | stamp on arrival | the frame `timestamp` is the stamp, 48 to 51 ms before arrival at the minimum, and the book it describes can be up to a grid step older |
| sizes | `Number()` of the string, in the base coin | section 4 |
| deflate | keep `perMessageDeflate: false` | the server sends plain text when not offered |
| depth | 30 levels per side, above the engine's 20 | section 4 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | GMO Coin API documentation, English, sections "Endpoint", "API Limiting", "Public WebSocket API", "Private WebSocket API", "HTTP Status Codes" and "Error Codes" | https://api.coin.z.com/docs/en/ | 2026-09-22 | GMO Coin, Japan | URLs, channels, subscribe frames, ping rule, limits, error codes, sections 1 to 7 |
| S2 | 取引所（暗号資産の購入・売却・レバレッジ取引） | https://coin.z.com/jp/corp/product/info/exchange/ | 2026-09-22 | GMO Coin, Japan | size unit, maintenance and pre-open, sections 3 and 5 |
| P1 | `ws-probe.mjs book`, 03:16:20 to 03:18:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gmo-coin/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs book`, second pass, 03:25:31 to 03:27:13 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gmo-coin/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6, the timestamp grid and repeat gaps |
| P3 | `ws-probe.mjs silence`, three runs between 03:18 and 03:29 UTC, the first with one silent socket, the other two with a silent and a pinging socket | [`ws-probe.mjs`](../../../scripts/probes/venues/gmo-coin/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P4 | `ws-probe.mjs deflate`, twice | [`ws-probe.mjs`](../../../scripts/probes/venues/gmo-coin/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
