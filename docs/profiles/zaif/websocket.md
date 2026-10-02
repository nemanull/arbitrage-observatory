# Zaif WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:27 to 04:47 UTC), from the development host near Seattle, through the Canadian VPN exit named in [`fees.md`](./fees.md) section 1.

This profile covers the public spot WebSocket of Zaif (CCXT id `zaif`), because Zaif lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/zaif/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
CCXT Pro 4.5.68 has no `zaif` class, since `server/node_modules/ccxt/js/src/pro/` holds no `zaif.js`.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| spot, one pair per socket | `wss://ws.zaif.jp/stream?currency_pair={currency_pair}`, S1 | opened in 465 to 589 ms over every single-socket run, and 56 of 56 catalog pairs opened in both batch runs, P1 to P5 |
| spot, plain text | `ws://ws.zaif.jp/stream?currency_pair={currency_pair}`, S1 | not probed |
| perpetuals, futures | none | the retired futures had no WebSocket in S1 or in the legacy document S2 |

The pair is chosen by the query string, so one socket carries exactly one pair.
There is no subscribe message and no way to add a second pair to a socket.
`ws.zaif.jp` resolved to `zaif-alb-websocket-772524234.ap-northeast-1.elb.amazonaws.com`, an AWS load balancer in Tokyo, at 13.197.17.181 and 3.115.50.174, see [`rest.md`](./rest.md) section 1.
No handshake was refused from the Canadian VPN exit, and the only non-101 answer was 404 for a wrong path, section 4.

## 2. Channel matrix for public market data

| stream | payload | depth and speed | probed |
|---|---|---|---|
| `/stream?currency_pair=<pair>` | one JSON object per push: `asks`, `bids`, `trades`, `last_price`, `timestamp`, `currency_pair`, plus the undocumented `target_users`, `itayose_data` and, on some pairs, `market_status` | top 20 levels per side, pushed on change, no fixed cadence | the only public stream, P1 |
| best bid and ask, trades, ticker | none as separate streams | | the book push carries the last 21 trades and `last_price` |
| mark, index, funding | none | | spot only |

The documentation describes a single stream "websocketを利用したリアルタイム板情報と終値のAPI", real-time book and last price, S1.
It names no depth and no push rate.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, the pair in the query string, S1 | one socket per pair, 56 sockets for 56 pairs in each batch run, P5 |
| subscribe frame shape | none, the URL subscribes, S1 | none. Any client text frame, JSON or not, closes the socket with 1006 115 to 168 ms later, P2 |
| unknown symbol expectation | Not publicly specified | the handshake succeeds and nothing arrives: `nope_jpy` and `BTC_JPY` stayed open and silent for about 10 s, P2 |
| chunk unit and budget | one pair per socket. "１つのIPアドレスからの接続開始が4回/秒程度におさまるようにしてください", keep connection starts to about 4 per second per IP address, S1 | 56 sockets opened at 3 per second, none refused, P5 |
| keepalive mechanism | Not publicly specified | the server sends no ping. It answers a protocol ping with a pong in 114 to 139 ms. A socket on which nothing moves for 60 s is closed, P3 |
| connection lifetime and maintenance notice | Not publicly specified | a busy socket stayed open for the full 121 s in both runs. A socket with no traffic either way closed at 60.47 to 60.56 s with 1006, P1 and P3. No maintenance message exists on the stream |
| handshake and operation rate limits | about 4 connection starts per second per IP, S1 | no refusal at 3 per second for 56 sockets, twice, P5 |
| public market data authentication | none, S1 | none |
| message parse and routing | one object with `currency_pair`, S1 | every push carries `currency_pair`, spelled like the URL parameter and the CCXT `market.id` |
| subscribe acknowledgement shape | none | none. The first frame is the stored book, within 2 ms of the socket opening |
| symbol identifier format | `btc_jpy`, S1 | lower case `base_quote`, identical to CCXT `market.id` and to the REST path on 56 of 56 pairs, see [`rest.md`](./rest.md) section 2 |
| number representation | JSON numbers, `[30000.0, 0.1]`, S1 | JSON numbers with a trailing `.0` on whole values, printed in exponent form when small: 7 of 58 and 0 of 16 `btc_jpy` frames, 3 of 18 and 4 of 17 `eth_jpy` frames, and every `xem_btc` frame held a number such as `1e-08` |
| timestamp representation | `"timestamp":"2015-04-01 18:16:01.739990"`, zone not stated, S1 | the same string, in Japan time (UTC+9) with microseconds. Trades carry `date` in Unix seconds |
| size unit | Not publicly specified | base currency units, the REST depth unit, section 4 |
| sequence semantics | none | no sequence number, no update id. Each push is a whole top-20 book |
| idle repeat behaviour | not documented | a quiet pair sends nothing after the first frame. 8 of 57 and 5 of 15 `btc_jpy` pushes repeated the previous top 20 unchanged |

## 4. The book channel in detail

### Snapshot on subscribe

Every push is a snapshot of the top 20 levels, so a feed never holds deltas.
The first frame arrives within 2 ms of the socket opening, and it is the last book the server pushed for that pair, with that push's `timestamp`.
On a quiet pair that timestamp can be old: `mona_jpy`'s first frame carried a timestamp 21.7 and 32.0 minutes before arrival in two runs, and `xem_btc`'s 13.5 and 13.7 hours, P1.
On `btc_jpy` and `eth_jpy` it was 0.07 to 6.2 s old.
After the first frame, busy pushes arrived 62 to 92 ms after their `timestamp`, median 68 and 81 ms on `btc_jpy` and 80 and 66 ms on `eth_jpy`.

### Delta semantics

There are no deltas.
A level that leaves the top 20 is simply absent from the next push.
A feed replaces both sides on every push with `resetBook`.

### Sequence and gap rule

```text
every push       replace the book with bids[0..19] and asks[0..19]
no push          nothing to detect: the stream has no sequence, and a quiet book is legitimately silent
socket closed    reconnect, and the first frame restores the book
```

No gap can be detected, because nothing is numbered.
The documentation names no ordering guarantee, S1.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket push | best first, descending, 0 violations in 58 and 16 `btc_jpy` frames and 18 and 17 `eth_jpy` frames, P1 | best first, ascending, 0 violations |
| REST `depth` | descending, "買い情報は価格の降順", S3, and 0 violations on four pairs, see [`rest.md`](./rest.md) section 5 | ascending, "売り情報は価格の昇順" |

No crossed book was seen in any frame.

### Level window

The socket holds at most 20 levels per side, and a pair with more resting orders always sent exactly 20, P1 and P5.
The REST `depth` call returns up to 150 per side, S3.
The top 20 of the socket equalled the REST book, read 257 and 373 ms after the socket frame, on 39 and 40 of 40 levels by price and size, P1.

### Size unit against CCXT `contractSize`

Sizes are in base currency units: `[13653505.0, 0.0075]` is 0.0075 BTC at 13,653,505 JPY, the same unit as the REST depth and the trades `amount`.
CCXT sets `contractSize` to `undefined` on every Zaif market, at `server/node_modules/ccxt/js/src/zaif.js` line 290, and the connector turns a missing contract size into 1, so the unit would be read correctly.

### One-sided and empty books

Both batch runs found every shape on the wire, P5.

| shape | pairs | frame |
|---|---|---|
| both sides empty | `polygon.mv_jpy`, `polygon.mv_btc`, `polygon.rond_jpy`, `polygon.rond_btc`, `dep_jpy`, `dep_btc` | `"asks": [], "bids": []` |
| no bids | `xem_btc`, `cot_btc`, `zaif_btc`, `klay_btc` and `skeb_btc` | `"bids": []` with asks |
| no asks | `joc_btc`, `bora_btc` | `"asks": []` with bids |
| no frame at all | the six event pairs `cs*`, and `zpg_jpy`, `zpgag_jpy`, `zpgpt_jpy` | the socket opens and stays silent |

A feed must accept an empty side, and must not treat a silent socket as broken while it answers pings.

### Idle repeats

A quiet pair sends nothing after its first frame: 42 and 43 of 47 delivering pairs sent only that frame in 50 s, P5.
On `btc_jpy` the gap between pushes had a median of 585 and 1,378 ms, a minimum of 367 and 373 ms and a maximum of 7.8 and 9.9 s, P1, and a passive `btc_jpy` socket went up to 7.3 and 11.2 s without a push, P3.
8 of 57 and 5 of 15 `btc_jpy` pushes, and 7 of 17 and 2 of 16 `eth_jpy` pushes, carried the same top 20 as the previous push, P1.
Of those, 1 and 2 on `btc_jpy` and 3 and 1 on `eth_jpy` differed from the previous push only in `timestamp` and the undocumented fields.
So some pushes are driven by changes outside the top 20 or by the extra fields.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `currency_pair=nope_jpy` | 101, socket opens | nothing for about 10 s |
| `currency_pair=BTC_JPY` | 101 | nothing |
| `currency_pair=zaif_jpy`, an `is_token` true pair | 101 | a book, although S1 says only `is_token` false pairs may be named |
| `currency_pair=csbtc_btc`, an event pair | 101 | nothing |
| `currency_pair=zpg_jpy`, whose ticker has no bid, ask or volume | 101 | nothing |
| no `currency_pair` | 101 | close 1006 within 1 ms of the open |
| path `/nope` | HTTP 404, `<html><title>404: Not Found</title><body>404: Not Found</body></html>` | |

The documentation limits the stream to pairs with `is_token` false, which are only `btc_jpy`, `mona_jpy`, `mona_btc`, `xem_jpy` and `xem_btc`, S1.
On the wire 42 `is_token` true pairs delivered books, including `eth_jpy`, the second largest pair by volume, P5.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | the server sent no ping on any socket, the longest open 121 s. A protocol ping every 20 s kept a quiet `mona_btc` socket open for 120 s in both runs, and each pong came back in 114 to 139 ms, P2 and P3 |
| silence the server tolerates | Not publicly specified | 60 s of no traffic in either direction: a passive `mona_jpy`, `xem_btc` or `mona_btc` socket closed at 60.47 to 60.56 s with code 1006 and no close frame, P1 and P3. This matches the 60 s default idle timeout of an AWS load balancer, which is an inference from the DNS name |
| client messages | none documented | any text frame closes the socket 115 to 168 ms later with 1006, whether it is JSON or not, P2 |
| forced disconnect | Not publicly specified | none on a busy socket in 121 s |
| maintenance notice | none on the stream. Notices are posted at https://corp.zaif.jp/maintenance, S5 | not observed |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, P4 |
| handshake | about 4 connection starts per second per IP, S1 | 465 to 589 ms to open on single sockets, and 463 to 716 ms from socket creation to first frame in the batch runs |
| subscription limits | one pair per socket | 56 sockets from one IP address, none refused, in two runs, P5 |
| throughput | | all 56 catalog pairs together: 0.8 and 0.9 frames per second and 3 and 4 KB per second over 31 s, P5. `btc_jpy` pushes are 4,387 and 4,393 bytes on average and parse in a median of 19 and 25 µs, P1 |

## 6. Captured frames

Trimmed, from the second run of 2026-09-23 UTC, with the key order and number formatting of the wire kept.
Each level array is cut to the first entries named, and the JSON inside each block is valid.

A `btc_jpy` push, the first frame on a new socket, three levels per side, one trade and three `itayose_data` entries kept.
The `timestamp` 13:42:22.571070 is Japan time, 04:42:22.571070 UTC.

```json
{"asks": [[13690000.0, 0.0017], [13690490.0, 0.0014], [13699900.0, 0.003]], "last_price": {"action": "bid", "price": 13690000.0}, "target_users": ["1a50aacc17"], "trades": [{"currenty_pair": "btc_jpy", "trade_type": "bid", "price": 13690000.0, "currency_pair": "btc_jpy", "date": 1790138502, "amount": 0.0037, "tid": 180628427}], "bids": [[13653505.0, 0.0075], [13653500.0, 0.058], [13653000.0, 0.058]], "currency_pair": "btc_jpy", "timestamp": "2026-09-23 13:42:22.571070", "itayose_data": [{}, {}, {}]}
```

The `trades` array held the last 21 trades, newest first, on 55 of 57 captured frames, and fewer on pairs with fewer trades.
Each trade names the pair twice, under `currenty_pair`, the typo S1 also prints, and under `currency_pair`.
`itayose_data` held 20 empty objects on all 57 captured frames, and `target_users` held one to four ten-character hex strings that changed between pushes.
Neither field is documented, and a feed ignores both.

An `eth_jpy` push, one level per side kept, trades and `itayose_data` emptied.
It carries the undocumented `"market_status": 0`.

```json
{"asks": [[435635.0, 0.1]], "last_price": {"action": "bid", "price": 435650.0}, "target_users": ["93146fa284"], "trades": [], "bids": [[434100.0, 0.002]], "currency_pair": "eth_jpy", "timestamp": "2026-09-23 13:42:21.629242", "market_status": 0, "itayose_data": []}
```

A book with no bids, `xem_btc`, with numbers in exponent form, three asks kept, trades and `itayose_data` emptied.
Its `timestamp` is 13.7 hours before arrival.

```json
{"asks": [[1e-08, 52606.0], [2e-08, 2511.0], [3e-08, 6021.0]], "last_price": {"action": "bid", "price": 1e-08}, "target_users": ["5a846b01f6"], "trades": [], "bids": [], "currency_pair": "xem_btc", "timestamp": "2026-09-23 00:01:19.226691", "itayose_data": []}
```

A book with no asks, `joc_btc`, three bids kept.

```json
{"asks": [], "last_price": {"action": "ask", "price": 2.6e-07}, "target_users": ["7654724120", "b12c733707"], "trades": [], "bids": [[2.5e-07, 2020.0], [2.4e-07, 3030.0], [2.3e-07, 1010.0]], "currency_pair": "joc_btc", "timestamp": "2026-09-17 18:56:08.525160", "market_status": 0, "itayose_data": []}
```

An empty book with `"market_status": 1`, `polygon.mv_jpy`, whose last push is dated 2026-01-29.

```json
{"asks": [], "last_price": {"action": "bid", "price": 0.595}, "target_users": ["abef3308eb"], "trades": [], "bids": [], "currency_pair": "polygon.mv_jpy", "timestamp": "2026-01-29 15:06:43.341147", "market_status": 1, "itayose_data": []}
```

`market_status` is absent on the five `is_token` false pairs, 0 on 36 pairs, and 1 on exactly the six pairs with an empty book and a last push on 2026-01-29, P5.
That reads as a suspension flag, which is an inference, since the field is not documented.

Keepalive: a protocol ping frame from the client and a protocol pong from the server, with no payload, in 114 to 139 ms.

Errors: none is ever sent as a message.
A bad path is refused at the handshake with HTTP 404 and the HTML body quoted in section 4.
A missing pair and a client text frame both end in a close with code 1006 and no close frame.

## 7. Private channels

None.
Zaif has no private WebSocket.
Account data and orders go through the REST trading API at `https://api.zaif.jp/tapi`, with methods such as `get_info2`, `active_orders`, `trade`, `cancel_order` and `trade_history`, S4, and CCXT's `private` block at `zaif.js` lines 121 to 135.

## 8. Recommended feed shape

A recommendation for a later design that adds spot legs, not a decision.
Zaif cannot join the engine as a perpetual leg, so no feed is recommended today.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan per market, `wss://ws.zaif.jp/stream?currency_pair=<rawMarketId>` | the pair lives in the URL |
| markets per connection | 1 | the stream serves one pair per socket |
| connect stagger | `connectStaggerMs` 334, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 25 | the documented limit is about 4 connection starts per second per IP, and 3 per second ran clean |
| subscribe frames | none, `getSubscribeFrames` returns `[]` | a client text frame closes the socket |
| keepalive | `c.socket.ping()` every 20 s, as the Binance feed does at `server/src/venues/binance/binance.ts` line 92 | the server cuts a socket after 60 s with no traffic, and a quiet pair sends nothing for hours |
| `maxSilenceMs` | 45,000 | two missed pongs. `VenueFeed` counts a pong as traffic at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 98 |
| routing | the connection's single market, cross-checked against `currency_pair` | every push names its pair |
| every push | `resetBook(pair, bids, asks)`, which publishes, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 263 to 278 | each push is a whole top-20 book |
| resync | none needed on data. Reconnect on close, and the first frame restores the book | no sequence exists, so no gap can be seen |
| unserved market | expect the `book_unserved` warning for the nine pairs that never send a frame | the socket stays open and silent |
| receive time | stamp on arrival, never from `timestamp` | the first frame of a quiet pair carries a timestamp hours old |
| sizes | use the JSON numbers as they parse, since some are in exponent form such as `1e-08` | section 3 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Zaif API document v2.1.0, WebSocket API | https://zaif-api-document.readthedocs.io/ja/latest/WebSocket_API.html | 2026-09-22 | Zaif Inc., Japan | URLs, the frame example, the `is_token` rule, 4 connection starts per second, sections 1 to 4 |
| S2 | Zaif api document v1.1.1, legacy, ストリーミング API | https://techbureau-api-document.readthedocs.io/ja/latest/public/3_streaming.html | 2026-09-22 | techbureau, 2017 | the same stream text, section 1 |
| S3 | Zaif API document v2.1.0, 現物公開API | https://zaif-api-document.readthedocs.io/ja/latest/PublicAPI.html | 2026-09-22 | Zaif Inc., Japan | REST depth order and its 150 level cap, section 4 |
| S4 | Zaif API document v2.1.0, 現物取引API | https://zaif-api-document.readthedocs.io/ja/latest/TradingAPI.html | 2026-09-22 | Zaif Inc., Japan | trading API endpoint and methods, section 7 |
| S5 | メンテナンス情報 (maintenance notices) | https://corp.zaif.jp/maintenance | 2026-09-22 | Zaif Inc., Japan | where maintenance is announced, section 5 |
| S6 | CCXT 4.5.68 `zaif.js` | `server/node_modules/ccxt/js/src/zaif.js` | 2026-09-22 | CCXT | `contractSize` at line 290, the private methods at lines 121 to 135, sections 4 and 7 |
| P1 | `ws-probe.mjs book`, at 04:32 and 04:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zaif/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs errors`, at 04:33, 04:34 and 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zaif/ws-probe.mjs) | 2026-09-23 UTC | this host | unknown and wrong symbols, client frames, sections 3 and 4 |
| P3 | `ws-probe.mjs silence`, at 04:34 and 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zaif/ws-probe.mjs) | 2026-09-23 UTC | this host | idle cut, pong time, section 5 |
| P4 | `ws-probe.mjs deflate`, at 04:33 and 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zaif/ws-probe.mjs) | 2026-09-23 UTC | this host | compression, section 5 |
| P5 | `ws-probe.mjs batch`, at 04:37 and 04:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zaif/ws-probe.mjs) | 2026-09-23 UTC | this host | every pair at once, empty and one-sided books, throughput, sections 3 to 5 |
