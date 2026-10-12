# EasiCoin WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 Pacific time (2026-10-10 02:24 to 02:37 UTC), two runs of every probe mode, from the development host near Seattle, through the Surfshark WireGuard tunnel whose exit geolocates to Vancouver, Canada.

EasiCoin documents no public WebSocket.
API access is enabled by support on request, see [`fees.md`](./fees.md), and no API documentation is public.
This profile therefore describes the socket the www.easicoin.io futures web app opens for an anonymous visitor, whose URL, topics and ping format were read from the web app's script bundles, W0 and W1.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/easicoin/ws-probe.py).
Because nothing is documented, the middle column of the axes table says what the web app's code does, and it is marked as such.
EasiCoin's terms forbid "unauthorized data scraping, extraction, or mining", see [`fees.md`](./fees.md) section 1, so this socket is described for the record and is not recommended for a feed.
The platform is the one YUBIT runs, see [`../yubit/websocket.md`](../yubit/websocket.md), with one difference that matters: the book topic here is `ob_depth.<symbol>`, a full snapshot on every frame, and the YUBIT `books-25.` topics answer `not exist`.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals, demo and block trade contracts | `wss://www.easicoin.io/realtime_public?v=2&bin=false` | upgraded with 101 in 615 to 1,638 ms over 14 sockets, and served every contract subscribed, P1 to P5 |
| home page ticker strip | `wss://www.easicoin.io/realtime_public?v=9` with topic `tickers.all.new` | not probed, W1 |
| inverse perpetuals | none listed, see [`rest.md`](./rest.md) section 2 | not probed |
| spot | not identified in the bundles read | not probed |

The web app builds the socket host from its own page host, so the socket lives on `www.easicoin.io` behind Cloudflare, W1.
The name `ws2.easicoin.io` appears in the host helper and does not resolve, see [`rest.md`](./rest.md) section 1.
One socket carried every family in the catalog: `ob_depth.BTCUSDX` (demo) and `ob_depth.XAUUSD` (block trade) were acknowledged and delivered on the same socket as the USDT-M topics, P1.
The probe sent `bin=false` throughout and every frame was text JSON.

## 2. Channel matrix for public market data

The topic names are the futures web app's topic table, W0.

| topic | payload | depth and speed | probed |
|---|---|---|---|
| `ob_depth.<symbol>` | a full snapshot on every frame | 25 levels per side, every 100 ms on `BTCUSDT` and `ETHUSDT`, every 500 ms on the other 98 of 100 contracts tried | recommended if any, section 4 |
| `books-20.`, `books-25.`, `books-80.`, `books-200.` | | | all answer `error:topic: books-25.BTCUSDT not exist` and the like, although the web app's table names them |
| `ob_snap_shot.<symbol>` | | | answers `error:topic:  not exist ` with an empty topic name |
| `tickers.all` | every contract in one frame | every 3 s | 435 rows per frame with last, best bid and ask, mark and index, and no funding fields, see [`rest.md`](./rest.md) section 3 |
| `tickers-100.<symbol>` | snapshot then deltas | the web app calls it `InstrumentInfo_H` | carries best bid and ask, mark `mp`, index `ip`, funding rate `fr`, predicted rate `pf`, interval `nh` and next funding time `ft`. On `BTCUSDT` it sent 1 snapshot and 79 deltas in 60 s, and 1 and 67 in the second run |
| `tickers-1000.<symbol>` | snapshot then deltas | `InstrumentInfo_M` in the table | not probed |
| `trades-100.<symbol>` | recent trades | `RecentlyTrade_H` in the table | not probed |
| `index_quote_200.`, `public.notice`, `dynamic-symbol`, `market-close-time` | | named in the table | not probed |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is publicly documented, so the middle column is what the web app's code does, W0, or Not publicly specified.

| axis | web app code | probed |
|---|---|---|
| endpoint split axis | `realtime_public` for the public topics | one URL carried USDT-M, USDX demo and USD block trade contracts, section 1 |
| subscribe frame shape | `{"op":"subscribe","args":[...topics]}` | 50 topics in one `args` array got one ack, and each delivered |
| unknown symbol expectation | Not publicly specified | `ob_depth.NOPEUSDT` answers `{"success":false,"ret_msg":"error:topic: ob_depth.NOPEUSDT not exist "}`. Lower case and `BTC_USDT` spellings answer the same |
| chunk unit and budget | Not publicly specified | 100 topics in two frames of 50 on one socket, both acked, all 100 delivering, first book frame 147 to 587 ms after the send over two runs |
| keepalive mechanism | the server sends `{"op":"ping","args":["<ms>"]}` and the web app answers `{"op":"pong","args":["<ms>"]}`. The home page app also sends its own `{"op":"ping","args":[<ms>]}` every 10 s | a server ping arrived every 15.0 s on every socket, the first 2.6 to 6.3 s after the upgrade |
| connection lifetime and maintenance notice | `public.notice` topic exists | no notice seen and no forced close in 60 s, even on sockets that never answered a ping |
| handshake and operation rate limits | Not publicly specified | no refusal at 100 topics on one socket, or with three sockets opened at once |
| public market data authentication | none | none |
| message parse and routing | `{topic, type, cs, ts, data}` | book frames route on `topic`, spelled `ob_depth.<symbol>`, and `data.s` repeats the symbol |
| subscribe acknowledgement shape | `{success, ret_msg, conn_id, request}` | one ack per subscribe frame. A frame with one bad topic is refused whole: `ob_depth.SOLUSDT` beside `ob_depth.NOPE2USDT` never delivered |
| symbol identifier format | the catalog's `symbolName` | `BTCUSDT`, which equals base plus quote on 413 of 413 USDT-M contracts |
| number representation | strings | prices and sizes are decimal strings. Funding rates `fr` and `pf` are JSON integers scaled by 1e6, so `100` is 0.01 % |
| timestamp representation | `ts` in microseconds | `ts` is integer Unix microseconds, on a fixed per symbol phase of the 100 ms or 500 ms grid. Trades carry ISO strings |
| size unit | base coin | `BTCUSDT` sizes such as `"0.294"` with a lot of 0.001 BTC, section 4 |
| sequence semantics | `cs` is the matching engine's cross sequence | `cs` never went backwards. It repeats on frames whose book did not change and skips by up to thousands on others, so it gives no gap rule |
| idle repeat behaviour | not specified | every frame repeats the whole book. 500 of 600 `BTCUSDT` frames in 60 s were identical to the previous one, and 6,363 of 8,703 frames over 100 contracts in 40 s |

## 4. The book channel in detail

### Snapshot on subscribe

The first frame for each topic is `"type":"snapshot"` with 25 bids and 25 asks, 147 to 587 ms after the subscribe frame, P1 and P3.

### Delta semantics

There are none.
Every one of 1,440 and 1,441 frames on four topics in the book mode and 8,703 and 8,706 frames on 100 topics in the batch mode was `"type":"snapshot"` with 25 bids and 25 asks, P1 and P3.
A feed replaces the whole book on each frame and keeps no state between frames.

### Sequence and gap rule

`cs` never went backwards on any topic in either run, P1 and P3.
On `BTCUSDT` it stayed the same on 412 and 432 consecutive frame pairs of about 600, rose by 1 on 84 and 66, and rose by more on the rest, such as 46, 64 and 100, P1.
On `TSLAUSDT` it stayed the same on 103 of 120 pairs in both runs, and the rises included 377, 902 and 3,185.
Since each frame is a full picture, a skipped `cs` loses nothing, and no gap rule is needed.

### Checksum

None.
No frame carried a checksum field, P1.

### Level order on the wire

Bids and asks are both ascending by price on every frame, P1 and P3.
Bids therefore run worst first and the best bid is the last element, and asks run best first.
The last bid of the captured `BTCUSDT` book frame, 82591.1, matched the `b1` of the `tickers-100.BTCUSDT` snapshot captured 0.7 s earlier.
No frame of about 20,000 was crossed.

### Push cadence

`ts` advanced by a median of 100.0 ms on `BTCUSDT` and `ETHUSDT`, with a 95th percentile of 100.8 ms and a maximum of 107.1 ms, P1.
Every other contract tried, 98 of 100 in the batch mode and `TSLAUSDT` and `PROMUSDT` in the book mode, advanced by a median of 500.0 ms with a maximum of 590.0 ms, P1 and P3.
The frame is sent on that grid whether or not the book changed, see the idle repeat row in section 3.
One `BTCUSDT` frame is about 1,120 bytes, and 100 contracts on one socket came to about 253,000 bytes per second, P1 and P3.

### Size unit against the catalog

Sizes are in the base coin, P1.
`BTCUSDT` sizes such as `"0.294"` and `"72.465"` sit on the catalog's lot of 0.001 BTC, and the catalog's `contractSize` is `"0"` on all 413 USDT-M contracts, see [`rest.md`](./rest.md) section 2.
The engine turns a missing or non-positive contract size into 1, so base coin sizes and a size of 1 agree.

### One-sided and empty books

Not observed.
Every frame captured carried 25 levels on each side, on the quietest contracts too, P3.

### Unknown, closed and wrong-level symbols

| subscribe | reply |
|---|---|
| `ob_depth.NOPEUSDT` | `{"success":false,"ret_msg":"error:topic: ob_depth.NOPEUSDT not exist "}` |
| `ob_depth.BTC_USDT`, `ob_depth.btcusdt` | the same error with that spelling |
| `books-25.BTCUSDT` | `error:topic: books-25.BTCUSDT not exist ` |
| `ob_snap_shot.BTCUSDT` | `error:topic:  not exist ` |
| `ob_depth.BTCUSDT` a second time | `error:topic:already subscribed {ob_depth.BTCUSDT }` |
| `nope.BTCUSDT` | `error:topic: nope.BTCUSDT not exist ` |
| `ob_depth.SOLUSDT` and `ob_depth.NOPE2USDT` in one frame | the whole frame refused, `error:topic: ob_depth.NOPE2USDT not exist `, and `ob_depth.SOLUSDT` never delivered |
| `{"op":"unsubscribe","args":["ob_depth.BTCUSDT"]}` | `success: true`, and one or two frames already in flight arrived after it |

## 5. Session

| item | finding | source |
|---|---|---|
| keepalive | the server sends `{"op":"ping","args":["<ms>"]}` every 15.0 s, and the web app answers `{"op":"pong","args":["<ms>"]}` | P1, P4, W0 |
| silence tolerated | three sockets, one idle that answered pings, one idle that never answered, and one subscribed that never answered, all stayed open for the full 60 s in both runs | P4 |
| forced disconnects | none on any of the 14 sockets of the two runs, the longest held about 89 s | P1 to P5 |
| maintenance notices | `public.notice` exists in the web app's table, and none arrived | W0 |
| compression | permessage-deflate is negotiated when offered, as `permessage-deflate; server_no_context_takeover; client_no_context_takeover`, and not otherwise | P5 |
| handshake | upgrade in 615 to 672 ms on most sockets and up to 1,638 ms, through Cloudflare | P1 to P5 |
| subscription limits | Not publicly specified, and 100 topics on one socket were accepted | P3 |

## 6. Captured frames

Subscribe acknowledgement, P1:

```json
{"success":true,"ret_msg":"","conn_id":"d54dfd84-5f67-45da-9d84-68598d557d26","request":{"op":"subscribe","args":["ob_depth.BTCUSDT","ob_depth.ETHUSDT","ob_depth.TSLAUSDT","ob_depth.PROMUSDT","tickers-100.BTCUSDT"]}}
```

Book frame, trimmed to the two outer levels of each side, P1.
Every frame looks like this one.

```json
{"topic":"ob_depth.BTCUSDT","type":"snapshot","cs":20013010474,"ts":1791599197250378,"data":{"s":"BTCUSDT","b":[["82585.9","0.294"],["82586.2","0.423"],"…",["82590.9","0.270"],["82591.1","2.619"]],"a":[["82593.0","72.465"],["82593.1","17.631"],"…",["82596.4","6.048"],["82596.5","3.276"]]}}
```

Per contract ticker snapshot, trimmed, P1:

```json
{"topic":"tickers-100.BTCUSDT","type":"snapshot","data":{"s":"BTCUSDT","p":"82591.8","b1":"82591.1","a1":"82593.0","ft":"2026-10-10T08:00:00Z","mp":"82592.6","ip":"82632.3","fr":100,"pf":100,"nh":8},"cs":20013010431,"ts":1791599196550087}
```

Server ping, P1:

```json
{"op":"ping","args":["1791599207436"]}
```

Error, P1:

```json
{"success":false,"ret_msg":"error:topic: ob_depth.NOPEUSDT not exist "}
```

## 7. Private channels

The futures web app reads a `websocketPath` from a signed in call and opens `<websocketPath>?v=2&token=<token>`, W0.
Neither was probed, and no documented private API exists.

## 8. Recommended feed shape

No feed is recommended, because the socket is undocumented and the terms forbid unauthorized scraping, see [`rest.md`](./rest.md) section 8.
If EasiCoin ever documents this socket or grants written consent, the shape would be this.

| item | value | reason |
|---|---|---|
| URL plan | `wss://www.easicoin.io/realtime_public?v=2&bin=false` | one URL carries every contract |
| topic | `ob_depth.<symbolName>` | the only book topic that answers, 25 levels covers the engine's 20 |
| markets per connection | 100 or more | 100 were accepted on one socket, at about 253,000 bytes per second |
| subscribe frames | `{"op":"subscribe","args":[...]}` in slices of 50, with no unknown topic in a slice | one bad topic refuses the whole frame |
| keepalive | answer each `{"op":"ping","args":[x]}` with `{"op":"pong","args":[x]}` | what the web app does, although unanswered sockets were not closed in 60 s |
| book handling | replace the whole book on each frame, reverse the bids | every frame is a full snapshot with bids ascending |
| `maxSilenceMs` | 5,000 | every subscribed contract sends a frame at least every 590 ms, even when idle |
| resync rule | none needed beyond reconnect and resubscribe | there is no delta state to lose |

The cadence is the limit of this feed: two contracts are pushed every 100 ms and every other contract every 500 ms, so the book is conflated.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| W0 | EasiCoin futures web app bundles: topic table, socket class, ping and pong, private socket path | `https://www.easicoin.io/trade/usdt/static/js/defaultVendors~main~6e8b5f81.8668dad8.chunk.js`, `https://www.easicoin.io/trade/usdt/static/js/main~6709df1a.c0d2d71c.chunk.js` and `https://www.easicoin.io/trade/usdt/static/js/main~991f4369.76a95a23.chunk.js`, loaded by https://www.easicoin.io/trade/usdt/BTCUSDT | 2026-10-09 | EasiCoin, global | topics, URL path, keepalive, private path, sections 1 to 3, 5 and 7 |
| W1 | EasiCoin home page bundles: host helper with `API_HOST` `/mapi` and the `ws2` host key, and the `tickers.all.new` socket | `https://www.easicoin.io/_next/static/chunks/633-f1736998207d3ee8.js` and `https://www.easicoin.io/_next/static/chunks/pages/index-ee27e8d11cf0b9c2.js` | 2026-10-09 | EasiCoin, global | host plan, home page socket, section 1 |
| P1 | `ws-probe.py book` | [`ws-probe.py`](../../../scripts/probes/venues/easicoin/ws-probe.py) | 2026-10-09 | this host, Canadian VPN exit | book frames, cadence, order, sequence, errors, ticker fields, sections 1 to 6 |
| P2 | `ws-probe.py tickers` | [`ws-probe.py`](../../../scripts/probes/venues/easicoin/ws-probe.py) | 2026-10-09 | this host, Canadian VPN exit | `tickers.all` rows and fields, section 2 |
| P3 | `ws-probe.py batch` | [`ws-probe.py`](../../../scripts/probes/venues/easicoin/ws-probe.py) | 2026-10-09 | this host, Canadian VPN exit | 100 topics on one socket, cadence, bytes, sections 3 and 4 |
| P4 | `ws-probe.py silence` | [`ws-probe.py`](../../../scripts/probes/venues/easicoin/ws-probe.py) | 2026-10-09 | this host, Canadian VPN exit | ping interval and silence, section 5 |
| P5 | `ws-probe.py deflate` | [`ws-probe.py`](../../../scripts/probes/venues/easicoin/ws-probe.py) | 2026-10-09 | this host, Canadian VPN exit | compression, section 5 |
