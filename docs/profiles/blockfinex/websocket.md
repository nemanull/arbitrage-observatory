# Blockfinex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 02:22 to 02:45 UTC on 2026-10-10, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.

This profile covers the public futures socket of Blockfinex for its USDT-M linear perpetuals, the researched product, see [`fees.md`](./fees.md) section 3.
Blockfinex runs ChainUp's `kline-api` socket, the same platform as the engine's `chainup` members Aivora, FameEX, x.me and Koinbay, at [`chainup.rs`](../../../server/src/venues/chainup.rs).
Every probed value comes from [`ws-probe.py`](../../../scripts/probes/venues/blockfinex/ws-probe.py), run once in the first pass and once more in the second pass, P1 and P2.
The socket document is ChainUp's generic Open API v2 page, S1, which the Blockfinex homepage links, and it names the host only as `wss://ws.xxx.xx/kline-api/ws`.

## 1. Endpoints

| URL | what it carries | evidence |
|---|---|---|
| `wss://futuresws.blockfinex.com/kline-api/ws` | every futures contract, USDT-M and inverse on one socket | the `wsUrl` of the website's futures list, and P1, where `market_e_btcusd_depth_step0` and `market_e_btcusdt_depth_step0` streamed on one socket |
| `wss://ws.blockfinex.com/kline-api/ws` | spot only | the homepage source, S2, and P1 mode `spot`: `market_btcusdt_depth_step0` streamed, `market_e_btcusdt_depth_step0` stayed silent |

Both hosts resolve to the same two addresses, 35.78.139.104 and 52.195.57.47, through the CNAME `cloong-alb-internet-h5-v6-1615804683.ap-northeast-1.elb.amazonaws.com`, an AWS load balancer in Tokyo.
The handshake answered with `Server: webserver` and opened in 388 to 477 ms from this host.
No upgrade was refused, and no geoblock or challenge was met from the Canadian exit.

## 2. Channel matrix for public market data

| channel | documented, S1 | probed |
|---|---|---|
| `market_<sym>_depth_step0` | full depth, "A maximum of 30 orders are returned" | 30 levels per side on every frame of every contract probed, a whole book per frame |
| `market_<sym>_depth_step1` | not listed | 30 levels per side merged to a coarser step, BTC prices on whole USDT |
| best bid and ask | none | none. The touch is the first level of the depth frame |
| `market_<sym>_trade_ticker` | real time trades | `tick.data` holds trades with `price`, `vol`, `amount`, `side` `BUY` or `SELL`, `ts` in ms, and `ds` as a UTC+8 wall clock string |
| `market_<sym>_ticker` | 24 h market data | `open`, `close`, `high`, `low`, `vol`, `amount`, `rose`, all strings. No mark, index or funding |
| `mark_price_<sym>` | not in S1 | `tagPrice`, `indexPrice`, `currentFundRate`, `nextFundRate`, `nextSettlementTime` in ms and `symbol`, all strings, about once a second while it flows, see section 4 |
| `market_<sym>_kline_<period>` | sub and req | not probed |

`<sym>` is the socket spelling of the contract, `e_btcusdt` for the REST name `E-BTC-USDT`, which the website's list states as `subSymbol` on 80 of 80 rows, see [`rest.md`](./rest.md) section 2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for spot, one for futures, S1 | confirmed. USDT-M and inverse share the futures URL |
| subscribe frame shape | `{"event":"sub","params":{"channel":"...","cb_id":"1"}}`, one channel per frame | confirmed. 148 frames sent in 0.02 s were all served |
| unknown symbol expectation | Not publicly specified | `market_e_nopeusdt_depth_step0`, the spot spelling `market_btcusdt_depth_step0` and the REST spelling `market_E-BTC-USDT_depth_step0` got no frame and no error |
| chunk unit and budget | Not publicly specified | 74 books and 74 mark channels on one socket, no refusal and no close |
| keepalive mechanism | the server sends `{"ping": <seconds>}` every 10 s and the client should answer `{"pong": ...}`, S1 | server ping every 10.0 s as a gzip binary frame, `{"ping":1791598961}`. No protocol ping |
| connection lifetime and maintenance notice | "otherwise the server will close the connection", S1 | a socket that answered none of 4 pings stayed open for the whole 40 s test, in both passes |
| handshake and operation rate limits | Not publicly specified | more than 40 opens in the session, none refused |
| public market data authentication | none | none |
| message parse and routing | `channel` names the stream | envelope `{event_rep, channel, data, tick, ts, status, timezone}`, route by `channel` |
| subscribe acknowledgement shape | Not publicly specified | no acknowledgement. A frame with an unknown `event` is echoed back verbatim as a text frame |
| symbol identifier format | lower case pair, `btcusdt` in the example | `e_btcusdt` on futures, the first hyphen of `E-BTC-USDT` an underscore and the others gone |
| number representation | depth levels as numbers | depth `[price, size]` as JSON numbers, every `mark_price` and `ticker` value a string |
| timestamp representation | `ts` in ms | envelope `ts` in ms rounded down to the whole second, `1791598952000`. Ping value in seconds. Trade `ds` is UTC+8 wall clock |
| size unit | Not publicly specified | contracts, the same integers as REST `/fapi/v1/depth`, each worth `multiplier` of the base |
| sequence semantics | none documented | none on the wire. Every frame is a whole book |
| idle repeat behaviour | Not publicly specified | a book frame repeats whether or not it changed. The quietest of 74 contracts sent 33 frames in 30 s in the first pass and 27 in 20 s in the second |

## 4. The book channel in detail

### Snapshot on subscribe

The first depth frame arrived 0.134 to 0.141 s after the subscribe on all five contracts of mode `book` in the first pass, and 0.131 to 0.135 s in the second.
In mode `batch` the last of 74 books arrived 0.433 s and 0.394 s after the burst of subscribes.
Every frame is a full 30 level book, so the first frame is the snapshot and there is no separate snapshot message.

### Delta semantics

There are no deltas.
Each frame replaces the book, which is how the engine's `chainup` adapter reads it, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 385 to 418.

### Sequence and gap rule

No sequence number, no update id and no checksum appear in any frame.
So no gap rule exists, and the only failure a feed can detect is silence.
A socket that carries many books is never quiet for long, so a short `maxSilenceMs` detects a dead socket.

### Checksum

None.

### Level order on the wire

Asks ascend and `buys` descend on every frame: 82 of 82 BTC frames, 83 of 83 ETH, 69 of 69 ENJ, 110 of 110 XAU and 127 of 127 `e_btcusd` in mode `book` of the first pass, and 224 of 224 frames over the same five in the second.
The bid side is named `buys`, as on Koinbay, FameEX and x.me.

### Level window

30 per side on every frame of every contract probed.
That exceeds the engine's 20 levels.

### Size unit against the catalog

There is no CCXT `contractSize`.
The socket's sizes are contracts, and the top three levels of `market_e_btcusdt_depth_step0` equalled REST `/fapi/v1/depth?contractName=E-BTC-USDT&limit=30` price for price and size for size at the end of mode `book` in both passes, for example bid `[82613.4, 1787]` on both in the first, P1 and P2.
One contract is `multiplier` of the base, 0.0001 BTC on BTC, see [`rest.md`](./rest.md) section 2.
SHIB and PEPE are priced per 1,000 tokens, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

None was seen.
The XAU book showed levels of size 1 beside a 65,186 contract level at the ask, and its spread was 6.9 USDT while gold's spot market was shut for the weekend.

### Idle repeats

| contract, mode `book` | frames, first pass, 40 s | identical to the previous | frames, second pass, 20 s | identical to the previous |
|---|---|---|---|---|
| `e_btcusdt` | 82 | 43 | 48 | 30 |
| `e_ethusdt` | 83 | 24 | 42 | 17 |
| `e_enjusdt` | 69 | 56 | 12 | 4 |
| `e_xauusdt` | 110 | 6 | 60 | 5 |
| `e_btcusd`, inverse | 127 | 8 | 62 | 2 |

In mode `batch` every one of 74 books delivered in both passes, with 33 to 114 frames per stream in 30 s and a median of 70 in the first, and 27 to 78 in 20 s and a median of 53 in the second.
BTC's frames came a median 357 and 277 ms apart, at least 98 and 102 ms and at most 1,017 and 1,042 ms.

### Unknown, closed and wrong-level symbols

An unknown contract, a spot spelling and the REST spelling are each ignored in silence.
`depth_step1` is accepted and served.

### The mark_price channel

The mark channel is the anchor source the engine's Koinbay profile reads, `AnchorSource::MarkPrice` at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 150.
On a healthy socket, each subscribed contract's mark streams about once a second, and a depth subscribe alone is enough to start it.
On some sockets the mark frames stop after the subscribe snapshot while the books keep flowing, and on those sockets the server ping stops too.
The Koinbay profile records neither behaviour.

| socket | mark frames per contract | server pings | evidence |
|---|---|---|---|
| `book`, first pass, five books and one `mark_price` subscribe, 40 s | 37 to 39 on all five, in one burst per second | 4, every 10.0 s | P1 |
| `book`, second pass, the same subscribes, 20 s | 3 on BTC and 1 on each of the other four in 20 s | 0 | P2 |
| `batch`, first pass, 74 books and 74 marks, 30 s | 2, arriving together just after the subscribe, then none | 0 in 30 s | P1 |
| `batch`, second pass, the same, 20 s | 20 on every contract | 2, at 0.3 and 10.1 s | P2 |
| `mark` `depth_only`, one book, 8 s and 6 s | 1, then 6 | | P1 and P2 |
| `mark` `mark_only`, one mark, 8 s and 6 s | 7, then 6 | | P1 and P2 |
| `marks`, 74 books and 74 marks, six sockets of 6 s, first pass | 7 or 8 on five sockets, 2 and none after the first 2 s on one | | P1 |
| `marks`, four sockets of 5 s, second pass | 5 to 7 on three sockets, 2 and none after the first 2 s on one | | P2 |

So 5 of 18 sockets that should have streamed marks stopped soon after the subscribe, 3 of them among the 12 that subscribed every contract.
In mode `marks` both stalled sockets went to 35.78.139.104, which also served five healthy ones, and 52.195.57.47 served three healthy ones, so ten sockets do not tie the stall to one address.
A feed that anchors from this channel cannot assume the stream continues once it starts, and the engine's silence timer cannot see the stall, since the books keep the socket busy.

## 5. Session

| item | value |
|---|---|
| keepalive | the server sends `{"ping": <unix seconds>}` gzip compressed every 10.0 s on a healthy socket, the first at 0.85 s on one socket and at 7.5 s on another, so the cycle is not tied to the open. A stalled socket gets none, see section 4. The engine's `Keepalive::AnswerPing` answers `{"pong": n}` |
| silence tolerated | a socket that never answered stayed open through 4 pings and 40 s, in both passes. The documented close was not observed |
| forced disconnects | none in the session |
| maintenance notices | none seen. Not publicly specified |
| compression | every data and ping frame is gzip inside a binary frame, 850 of 851 frames in mode `book` of the first pass and 351 of 352 in the second. The one text frame was the echo of an unknown event. permessage-deflate is not negotiated: offered in mode `deflate` in both passes, the server answered with no `Sec-WebSocket-Extensions` |
| handshake and subscription limits | Not publicly specified, and none was met |

## 6. Captured frames

Each frame is trimmed to three levels where it holds a book.

A depth frame, the first after the subscribe, which is also the snapshot, mode `book`, P1:

```json
{"event_rep": "", "channel": "market_e_btcusdt_depth_step0", "data": null, "tick": {"asks": [[82637.4, 30972], [82638.1, 2164], [82638.2, 777]], "buys": [[82635.1, 24544], [82634.4, 2099], [82633.7, 629]]}, "ts": 1791598952000, "status": "ok", "timezone": ""}
```

A mark frame, P1:

```json
{"event_rep": "", "channel": "mark_price_e_ethusdt", "data": null, "tick": {"tagPrice": "2493.60607616000000000", "indexPrice": "2494.86000000000000000", "currentFundRate": "0.0000209616666667", "nextFundRate": "0.000035", "nextSettlementTime": "1791619200000", "symbol": "e_ethusdt"}, "ts": 1791598952000, "status": "ok", "timezone": ""}
```

A ticker frame, which carries no anchor field, P1:

```json
{"event_rep": "", "channel": "market_e_btcusdt_ticker", "data": null, "tick": {"vol": "93850625", "rose": "0.0084", "open": "81951.9", "low": "81866.6", "high": "83480.9", "close": "82636.2", "amount": "7760044391750"}, "ts": 1791598951000, "status": "ok", "timezone": ""}
```

A trade frame, P1:

```json
{"event_rep": "", "channel": "market_e_btcusdt_trade_ticker", "data": null, "tick": {"data": [{"amount": "8098347.6", "ds": "2026-10-10 10:22:32", "price": "82636.2", "side": "BUY", "ts": 1791598952675, "vol": "98"}], "ts": 1791598952000}, "ts": 1791598952000, "status": "ok", "timezone": ""}
```

The server ping, decompressed, P1:

```json
{"ping": 1791598961}
```

The echo of a frame with an unknown event, sent back as text, P1:

```json
{"event": "nope", "params": {"channel": "market_e_btcusdt_ticker"}}
```

No error frame was seen, since an unknown channel is ignored.

## 7. Private channels

ChainUp documents private futures order and position updates on separate pages, S1.
The futures web list reports `wsPushPosition` true.
Neither was probed.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| module | a fifth profile constant of the `chainup` module | the socket, the frames and the keepalive match the Koinbay profile, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 142 to 162 |
| URL | `wss://futuresws.blockfinex.com/kline-api/ws` | the `wsUrl` the website states |
| raw market id | `e_<base><quote>` lower case, the website's `subSymbol` | REST takes `E-BTC-USDT`, see [`rest.md`](./rest.md) section 2 |
| depth | `Depth::Step0` | 30 levels per side, every frame a whole book |
| markets per connection | 74, all trading USDT perpetuals on one socket | 74 books and 74 mark channels ran on one socket in mode `batch` |
| keepalive | `Keepalive::AnswerPing` | the server pings every 10 s |
| `maxSilenceMs` | 10 s | 74 books sent about 5,200 frames in 20 to 30 s on one socket, so ten seconds without a frame is a dead socket |
| resync | a reconnect, since a whole book arrives every frame | no sequence exists |
| anchor | the `mark_price` channel only with a guard that reopens a socket whose mark frames or pings stop while its books flow, or the REST sweep of [`rest.md`](./rest.md) section 8 | section 4, the mark stream stopped on 5 of 18 sockets |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ChainUp Open API v2, WebSocket page, linked from the Blockfinex homepage | https://exchangedocsv2.gitbook.io/open-api-doc-v2/websocket | 2026-10-10 UTC | ChainUp platform | channels, frame shapes, gzip, ping cadence, sections 2, 3 and 5 |
| S2 | Blockfinex homepage source | https://www.blockfinex.com/en_US | 2026-10-10 UTC | Blockfinex | the spot socket URL, section 1 |
| S3 | Blockfinex website futures list, `POST /fe-co-api/common/public_info` | https://futures.blockfinex.com/fe-co-api/common/public_info | 2026-10-10 UTC | Blockfinex | `wsUrl`, `subSymbol`, `wsPushPosition`, sections 1, 2 and 7 |
| P1 | `ws-probe.py book`, `batch`, `mark`, `deflate`, `spot`, `marks` and `silence`, first pass, 02:22 to 02:41 UTC | [`ws-probe.py`](../../../scripts/probes/venues/blockfinex/ws-probe.py) | 2026-10-10 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.py all`, second pass, 02:43 to 02:45 UTC | [`ws-probe.py`](../../../scripts/probes/venues/blockfinex/ws-probe.py) | 2026-10-10 UTC | this host | sections 3 to 5, the second readings |
