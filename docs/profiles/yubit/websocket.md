# YUBIT WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (2026-09-23 06:26 to 06:58 UTC), two runs of every probe mode, from the development host near Seattle, through the Surfshark WireGuard tunnel whose exit geolocates to Canada.

YUBIT documents no public WebSocket.
Its Open API documentation, which would name one, is sent "to each partner individually" by customer support, see [`fees.md`](./fees.md) S9.
This profile therefore describes the socket the www.yubit.com futures web app opens for an anonymous visitor, whose URL, topics and ping format were read from the web app's script bundle `https://www.yubit.com/trade/usdt/static/App-DkDO54Ej.js` and its loader `index-BzPeGZpF.js`, W0.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/yubit/ws-probe.mjs).
Because nothing is documented, the "documented" column of the axes table says what the web app's code does, and it is marked as such.
YUBIT's futures trading rules forbid "Probing, scanning, or accessing undisclosed APIs", see [`fees.md`](./fees.md) section 1, so this socket is described for the record and is not recommended for a feed.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals and the FreeU demo | `wss://www.yubit.com/realtime_public?v=2&bin=false` | opened in 180 to 490 ms over 19 sockets, and served every USDT-M contract subscribed |
| inverse perpetuals, `BTCUSD` and `ETHUSD` | `wss://www.yubit.com/realtime?v=2&bin=false` | opened in 185 and 199 ms, `books-25.BTCUSD` served |
| USDT-M, binary | `wss://www.yubit.com/realtime_public?v=2&bin=true` | protobuf frames, the web app's default |
| spot | `wss://www.yubit.com/ws/quote/v1` | not probed |

The web app builds the host from its own page host, so the socket lives on `www.yubit.com` behind Akamai, W0.
`bin=false` gives text JSON, and `bin=true`, which the web app sends unless a local setting turns it off, gives binary protobuf envelopes of type `safexpb.Envelope`, W0 and W5.
One socket carries one family.
On the USDT-M URL `books-25.BTCUSD` answers `error:topic: books-25.BTCUSD not exist`, and on the inverse URL `books-25.M1BTCUSDT` answers the same error, W1.

## 2. Channel matrix for public market data

The topic names are the web app's `PublicWsTopics` table, W0.

| topic | payload | depth and speed | probed |
|---|---|---|---|
| `books-25.<symbol>` | snapshot then deltas | 25 levels per side, pushed on a 500 ms grid | recommended if any, section 4 |
| `books-200.<symbol>` | snapshot then deltas | up to 400 levels per side, 500 ms grid | works. `ETHUSDT` snapshots held 400 and 400, `BTCUSDT` 400 bids and 337 and 339 asks |
| `books-20.`, `books-50.`, `books-80.` | | | `error:topic: books-20.M1BTCUSDT not exist`, and the same for 50 and 80, although the web app's table names `books-20.` and `books-80.` |
| `tickers.all` | every contract in one frame | about once a second | 519 rows per frame with last, mark and index, no funding fields, see [`rest.md`](./rest.md) section 3 |
| `tickers-100.<symbol>`, `tickers-1000.<symbol>` | snapshot then deltas | the web app calls them `InstrumentInfo_H` and `InstrumentInfo_M` | carry best bid and ask, mark, index, funding rate, predicted rate, interval and next funding time. On `BTCUSDT`, `tickers-100` sent 55 frames in 30 s and `tickers-1000` sent 31 and 32 |
| `trades-100.<symbol>` | snapshot of recent trades then deltas | | works |
| `index_quote_20.`, `index_quote_200.` | | | `index_quote_20.M1BTCUSDT` and `index_quote_20.BTCUSDT` both answer `not exist` |
| `public.notice` | | | not probed |

There is no dedicated mark, index or funding channel.
`tickers.all` carries mark and index for every contract in one frame, and the per contract ticker adds the funding fields.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is publicly documented, so the middle column is what the web app's code does, W0, or Not publicly specified.

| axis | web app code | probed |
|---|---|---|
| endpoint split axis | one path per family: `realtime_public` for USDT-M, `realtime` for inverse | a topic of the other family is refused as `not exist`, section 1 |
| subscribe frame shape | `{"op":"subscribe","args":[...topics]}` | 50 topics in one `args` array got one ack, and each delivered |
| unknown symbol expectation | Not publicly specified | `books-25.M1NOPEUSDT` answers `{"success":false,"ret_msg":"error:topic: books-25.M1NOPEUSDT not exist "}`. The alias spelling `books-25.BTCUSDT` answers `success: true` and never delivers |
| chunk unit and budget | Not publicly specified | 100 topics in two frames of 50 on one socket, all acked, 100 snapshots, first book frame 154 and 200 ms after the send |
| keepalive mechanism | the web app's heartbeat codec answers a server `{"op":"ping","args":["<ms>"]}` with `{"op":"pong","args":["<ms>"]}`, and its own ping is `{"op":"ping","args":[<ms>]}` | a server ping every 15,000 ms on every socket, the first 11.7 to 14.5 s after open. A client ping is answered with `ret_msg` `pong`. Sockets that never answered stayed open for 90 s, section 5 |
| connection lifetime and maintenance notice | `public.notice` topic exists | no notice seen and no forced close in 91 s |
| handshake and operation rate limits | Not publicly specified | no refusal at 100 topics on one socket |
| public market data authentication | none | none |
| message parse and routing | `{topic, type, data, cs, ts}` | book frames route on `topic`, spelled `books-25.<symbol>`, and `data.s` repeats the symbol |
| subscribe acknowledgement shape | `{success, ret_msg, conn_id, request}` | as written, one ack per subscribe frame. A frame with one bad topic is refused whole: the new good topic `books-25.M1SOLUSDT` beside `books-25.M1NOPE2USDT` never delivered |
| symbol identifier format | the catalog's `symbolName` | `M1BTCUSDT` on USDT-M, which is `M1` plus the catalog's `symbolAlias` on 509 of 514 contracts, and `BTCUSD` on inverse |
| number representation | strings | prices and sizes are decimal strings. Funding rates are JSON integers scaled by 1e6. The 1e6 scaled percentage `pP` is a JSON number on the per contract ticker and a string on `tickers.all` |
| timestamp representation | `ts` in microseconds | `ts` is integer Unix microseconds, on a 500 ms grid for book frames. Trades carry ISO strings |
| size unit | base coin on USDT-M, USD on inverse | `BTCUSDT` sizes such as `"0.633"` with a lot of 0.001 BTC, `ONDOUSDT` `"29556.1"` with a lot of 0.1, `BTCUSD` integers such as `"2248"` |
| sequence semantics | `cs` is the matching engine's cross sequence, as in the web app's `crossSeq` | `cs` never went backwards and never repeated on one stream. It is per symbol and shared by that symbol's book and ticker topics, and it skips, by 101 at least and by a median of 696 between `BTCUSDT` `books-25` deltas in the second run, so it gives no gap rule. Each delta carries `b1` and `a1`, the best bid and ask after the delta, which matched the local book on every delta |
| idle repeat behaviour | not specified | nothing is repeated. The quiet ETF perpetual `KWEBUSDT` sent 1 to 3 deltas in 60 s |

## 4. The book channel in detail

`books-25` is described here, and `books-200` behaves the same with a deeper window.

### Snapshot on subscribe

The first frame for each topic is `"type":"snapshot"` with the full window, 25 bids and 25 asks.
The snapshot is not current.
Its `ts` was 4.2 to 9.8 s older than its arrival on the four contracts of W1 over two runs, and it was followed in the same millisecond by up to 10 replayed deltas whose `ts` climbs back to the present.
Applying the snapshot and then every delta in order gave a book whose best bid and ask matched every delta's `b1` and `a1`, including the replayed ones.
No second snapshot arrived in 60 s on any of the six book topics of W1, or on any of the 100 topics of W3.

### Delta semantics

A delta carries `data.b` and `data.a` as arrays of `[price, size]` strings, and `data.b1` and `data.a1`.
The size is absolute, and `"0"` deletes the level.
The server keeps the window at 25 levels per side by sending a `"0"` for the level that falls out, since the local book never held more than 25 on any contract in W1 or W3.
No empty delta was seen.

### Sequence and gap rule

```text
type = snapshot        replace the book
type = delta           apply every level, then compare the local best bid and ask with data.b1 and data.a1
mismatch, or a delta before any snapshot    resync: terminate the socket and resubscribe
```

`cs` is not contiguous per topic, so it cannot drive a gap check.
`b1` and `a1` are the only integrity check the wire offers, and they matched on 1,433 and 1,455 deltas over 100 contracts in the two runs of W3 and on every delta of W1.
A missed delta that leaves the top of the book unchanged would not be caught, and that is Not verified.

### Checksum

None on the wire.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | worst first, ascending, on 4 of 4 `books-25` and 2 of 2 `books-200` snapshots in W1 and on 100 of 100 in W3 | best first, ascending |
| delta | best first, descending, or unordered: on `BTCUSDT` 34 and 44 of about 110 bid arrays were descending and 67 and 61 unordered | ascending or unordered |

A feed applies levels by price and never by position.
The snapshot's bid side reads worst first, which is the opposite of most venues.

### Push cadence

Book frames come on a 500 ms grid of `ts`.
On `BTCUSDT` and `ETHUSDT` the median step between deltas was 500 ms, and the longest was about 1 s.
On `ONDOUSDT` the median step was 2,000 and 2,500 ms, and the ETF perpetual `KWEBUSDT` went 55 and 60 s without a frame.
In W3, 32 and 28 of 100 contracts had a gap of more than 10 s between frames, and the longest was 26.5 and 29.9 s.
So the book is a conflated 2 Hz picture and not an event stream.

### Size unit against the catalog

There is no CCXT `contractSize`, since no CCXT class exists.
The web app's catalog has `lotSize`, `minQty` and no multiplier field.
`BTCUSDT` has `lotSize` `"0.001"`, and its book and trade sizes are multiples of 0.001, so a USDT-M size is in base coins, W1.
`BTCUSD` book sizes are integers such as `"2248"` and `"4498390"`, and `minQty` is `"1"`, so an inverse size is in USD, which is an inference from the numbers.

### One-sided and empty books

None was seen, so what the server sends for an empty side is Not verified.

### Unknown, closed and wrong-level symbols

| request | reply |
|---|---|
| `books-25.M1NOPEUSDT` | `{"success":false,"ret_msg":"error:topic: books-25.M1NOPEUSDT not exist "}` |
| `books-25.BTCUSDT`, the alias spelling | `{"success":true}` and nothing after |
| `books-20.M1BTCUSDT`, `books-50.`, `books-80.` | `error:topic: books-20.M1BTCUSDT not exist` and so on |
| `books-25.BTCUSD` on the USDT-M URL | `error:topic: books-25.BTCUSD not exist` |
| `books-25.M1BTCUSDT` a second time | `error:topic:already subscribed books-25.M1BTCUSDT` |
| `nope.M1BTCUSDT` | `error:topic: nope.M1BTCUSDT not exist` |
| `books-25.M1SOLUSDT` and `books-25.M1NOPE2USDT` in one frame | the whole frame refused, `error:topic: books-25.M1NOPE2USDT not exist`, and `books-25.M1SOLUSDT` never delivered |
| `{"op":"nope"}` | `error:invalid op` |
| text that is not JSON | `Failed to decode incoming data: ...`, and the socket stays open |

`tickers.all` also carried `M1STRKUSDT`, which is not in the catalog, with a mark of `0.1477` and an index of `0.0425` and `0.0426`, W2.

## 5. Session

| item | web app code | probed |
|---|---|---|
| keepalive | answer each server `ping` with a `pong` carrying the same `args` | a server ping every 15,000 ms on every socket, W1 and W4 |
| silence the server tolerates | Not publicly specified | four sockets, with and without a subscription, answering pings or not, all stayed open for the full 90 s, W4 |
| forced disconnect | Not publicly specified | none in 91 s |
| maintenance notice | `public.notice` | not observed |
| compression | the web app uses `bin=true` protobuf | with `bin=false` and no extension offered, text JSON. A client that offered permessage-deflate got `permessage-deflate; server_no_context_takeover; client_no_context_takeover`, so the server negotiates it when asked, W5 |
| handshake | | 180 to 490 ms to open from this host over 21 sockets |
| subscription limits | Not publicly specified | 100 topics on one socket without refusal |
| throughput | | 100 USDT-M contracts, every fifth in catalog order: 38 and 39 book frames per second, 18 and 19 KB per second, 469 and 497 bytes per frame, 32 and 49 µs `JSON.parse` per frame. `tickers.all`: one frame of about 155 KB per second, 6.5 to 8.1 ms `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from W1 on 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe.

```json
{"op": "subscribe", "args": ["books-25.M1BTCUSDT", "books-25.M1ETHUSDT", "books-25.M1ONDOUSDT", "books-25.M1KWEBUSDT"]}
```

Acknowledgement.

```json
{"success":true,"ret_msg":"","conn_id":"74712a77-cab2-4ec3-9543-6a8d7d92ef58","request":{"op":"subscribe","args":["books-25.M1BTCUSDT","books-25.M1ETHUSDT","books-25.M1ONDOUSDT","books-25.M1KWEBUSDT"]}}
```

Snapshot, first two and last three bids and first three and last two asks, with bids worst first.

```json
{"topic":"books-25.M1ONDOUSDT","type":"snapshot","data":{"s":"M1ONDOUSDT","b":[["0.4400","183650.5"],["0.4401","74810.1"],"…",["0.4422","29556.1"],["0.4423","15823.5"],["0.4424","12726.9"]],"a":[["0.4425","10796.5"],["0.4426","30358.6"],["0.4427","38206.4"],"…",["0.4448","99998.6"],["0.4449","247071.3"]]},"cs":50316880967,"ts":1790145595233971}
```

Delta with its best bid and ask.

```json
{"topic":"books-25.M1ONDOUSDT","type":"delta","data":{"s":"M1ONDOUSDT","b":[["0.4423","16489.2"],["0.4422","19584.4"],["0.4419","84153.8"],["0.4400","180016.5"],["0.4399","109398.5"],["0.4425","0"],["0.4424","0"]],"a":[["0.4424","15107.2"],["0.4425","27051.6"],["0.4426","57603.0"],["0.4427","49170.8"],["0.4441","186064.4"],["0.4446","167109.1"],["0.4449","0"],["0.4450","0"]],"b1":"0.4423","a1":"0.4424"},"cs":50316886700,"ts":1790145599734073}
```

Keepalive, the server ping and the answer.

```json
{"op":"ping","args":["1790145616148"]}
```

```json
{"op": "pong", "args": ["1790145616148"]}
```

A client ping and its answer.

```json
{"success":true,"ret_msg":"pong","conn_id":"74712a77-cab2-4ec3-9543-6a8d7d92ef58","request":{"op":"ping","args":["1790145605002"]}}
```

Errors.

```json
{"success":false,"ret_msg":"error:topic: books-25.M1NOPEUSDT not exist ","conn_id":"74712a77-cab2-4ec3-9543-6a8d7d92ef58","request":{"op":"subscribe","args":["books-25.M1NOPEUSDT"]}}
```

```json
{"success":false,"ret_msg":"error:topic:already subscribed books-25.M1BTCUSDT","conn_id":"74712a77-cab2-4ec3-9543-6a8d7d92ef58","request":{"op":"subscribe","args":["books-25.M1BTCUSDT"]}}
```

Per contract ticker snapshot, with the 1e6 scaled funding rate `fr`, the predicted rate `pf`, the interval `nh` in hours and the next funding time `ft`, percentage fields removed.

```json
{"s":"M1BTCUSDT","p":"86488.1","b1":"86487.7","a1":"86489.6","td":"-","p24":"85527.5","pP":11231,"h":"87247.9","l":"85131.5","to":"1269737099.4948027","v":"14729.971","ft":"2026-09-23T08:00:00Z","mp":"86489.0","ip":"86529.7","o":"986.526","frgs":"1","fr":-281,"pf":-281,"nh":8,"ds":"0"}
```

## 7. Private channels

The web app opens private sockets with a token from its logged-in session, W0.
They were not probed.

- Futures private socket: a `WSPATH` URL with `?v=2&token=<token>`, built by `createFuturesPrivateWs`.
- TradFi private: `/ws/tradfi/v1?v=2`.
- Prediction market: `/ws/prediction_pub_push?v=2` and `/ws/prediction_private_push`.

## 8. Recommended feed shape

No feed is recommended.
The socket is undocumented, YUBIT's rules forbid accessing undisclosed APIs, and no CCXT catalog exists to key it, see [`rest.md`](./rest.md) section 8.
If YUBIT grants written consent or publishes its Open API, this is what a feed on the socket above would look like.

| item | shape | reason |
|---|---|---|
| URL plan | `wss://www.yubit.com/realtime_public?v=2&bin=false` for USDT-M | the inverse family has two contracts |
| topic | `books-25.<symbolName>` | 25 levels covers the engine's 20, and `books-200` is up to 400 levels at the same cadence |
| markets per connection | 100 | tested, no cap published |
| subscribe frames | `{"op":"subscribe","args":[...]}` in slices of 50, with no unknown topic in a slice | one bad topic refuses the whole frame |
| keepalive | answer each server ping with `{"op":"pong","args":<same args>}` | what the web app does |
| `maxSilenceMs` | 45,000 | three server pings, and a quiet contract went 55 to 60 s without a book frame, so the ping has to count as traffic |
| snapshot | `type === 'snapshot'`: `resetBook` | the snapshot is 4 to 10 s old and the replayed deltas bring it forward |
| delta | apply every level by price, then compare the best bid and ask with `b1` and `a1` | the only integrity check |
| resync | a `b1` or `a1` mismatch, or a delta before a snapshot | `cs` has no gap rule |
| receive time | stamp on arrival | book `ts` is on a 500 ms grid and snapshots are seconds old |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when asked |

The engine would see this book at 2 Hz at best, and would hear nothing from a quiet contract for tens of seconds at a time.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| W0 | YUBIT futures web app bundle, `PublicWsTopics`, `buildWsPath`, heartbeat codec and ticker key map | `https://www.yubit.com/trade/usdt/static/App-DkDO54Ej.js` and `https://www.yubit.com/trade/usdt/static/index-BzPeGZpF.js` | 2026-09-22 | SafeTrading Ltd | URLs, topic names, ping and pong, protobuf envelope, ticker field names, sections 1 to 3 and 7 |
| W1 | `ws-probe.mjs book` | [`ws-probe.mjs`](../../../scripts/probes/venues/yubit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| W2 | `ws-probe.mjs tickers` | [`ws-probe.mjs`](../../../scripts/probes/venues/yubit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `tickers.all` and per contract tickers, sections 2 and 4 |
| W3 | `ws-probe.mjs batch` | [`ws-probe.mjs`](../../../scripts/probes/venues/yubit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | 100 contracts on one socket, sections 3 to 5 |
| W4 | `ws-probe.mjs silence` | [`ws-probe.mjs`](../../../scripts/probes/venues/yubit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | server ping cadence and tolerance, section 5 |
| W5 | `ws-probe.mjs deflate` | [`ws-probe.mjs`](../../../scripts/probes/venues/yubit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | deflate negotiation and the binary variant, sections 1 and 5 |
