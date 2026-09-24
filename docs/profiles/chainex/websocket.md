# ChainEX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:51 to 05:01 UTC, and the second pass 05:08 to 05:13 UTC, from the development host near Seattle.

This profile covers the public push socket of ChainEX, a spot only venue with no CCXT class, see [`fees.md`](./fees.md) section 3.
ChainEX documents no WebSocket at all.
The API page describes a REST API only, S1, and the socket below was found in the chainex.io web bundle, which names it `PUSH_SERVER` and opens it with Autobahn's WAMP v1 client, S2.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/chainex/ws-probe.mjs), and where the web client's code says something, it is quoted beside the capture.
Every result is from this host's Surfshark WireGuard exit, which geolocates to Canada, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| product | URL | probed |
|---|---|---|
| spot, every market | `wss://push.chainex.io:443/`, `PUSH_SERVER` in `main.227bb1402baa35b3f0a0.js`, S2 | HTTP 101 through Cloudflare, open in 666 to 800 ms over 16 sockets in both passes |

One socket carries every market, both the 21 ZAR and the 5 USDT markets.
The server speaks WAMP v1, the protocol of Autobahn 0.8, whose `ab.Session` the web client constructs with `{skipSubprotocolCheck: true}`, S2.
With the `wamp` subprotocol offered, the server echoes `wamp` and sends a WAMP welcome before anything else.

```json
[0, "2bbce2191f9fe96f7217575290de7105", 1, "ChainEXWamp/v0.1"]
```

Without a subprotocol, the way [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 opens a socket, the server answers 101 with no protocol, sends no welcome, and still delivers every subscribed topic.
That socket received 2 `order`, 2 `order-delete` and 4 chart events and 3 pings in 26 s, and 4 `order`, 2 `order-delete` and 6 `MARKET_SUMMARY` events and 3 pings in the rerun, P5.
`push.chainex.io` resolved to the same three Cloudflare addresses as the REST host, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

Topics come from the web client, S2, and payload fields from the capture, P1.

| topic | `messageType` or `topic` in the payload | what it carries | probed on 2026-09-23 |
|---|---|---|---|
| `marketUpdates-<market_id>` | `order` | one new resting order: `order` side, `price`, `amount`, `total`, `time` | 50 in 90 s over 26 markets, and 37 in 75 s in the rerun |
| `marketUpdates-<market_id>` | `order-delete` | one order removed, with the same fields and `type` `delete`, and `time` is when that order was placed | 40 in 90 s, and 39 in 75 s |
| `marketUpdates-<market_id>` | `trade` | one trade, with `order`, `price`, `time`, used by the web client's trade list, S2 | none in any run |
| `marketUpdates-<market_id>` | `sidebar`, `topic` `MARKET_SUMMARY` | `topBid`, `topAsk`, `lastPrice`, `high`, `low`, `volume`, `volumeAmount`, `change`, `pair` | every subscribed market at once, about once a minute: 26 in 90 s, and 52 in 75 s |
| `marketUpdates-<market_id>` | no `messageType`, `topic` `NEW_TRADE_BUCKET`, `type` `chart` | one candle: `date`, `open`, `high`, `low`, `close`, `volume` | 21 in 90 s and 19 in 75 s, about once a minute per market with recent trades |
| `topBar` | `topBar` | venue wide 24 h volume, top gainer and loser, trade count | 1 in 90 s, and 2 in 75 s |
| `sidebarStats` | | subscribed by the web client | nothing in either run |
| `chat` | | the site chat | not probed |

No channel sends a book snapshot, a depth level list, a best bid and ask on change, a mark, an index or a funding rate.
The web client does not build its book from the socket.
On every `marketUpdates` event for the open market it calls `getOrderDepth` again, `this.marketService.getOrderDepth({perPage:50,pageNo:0,orderBy:"price",market:...})`, S2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
ChainEX documents none of them, so the documented column quotes the web client where it shows the behaviour.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one `PUSH_SERVER` URL, S2 | 26 market topics and two venue topics on one socket, all delivering |
| subscribe frame shape | WAMP v1 `SUBSCRIBE`, one topic per call, `this.pushHost.subscribe(t, ...)`, S2 | `[5, "marketUpdates-57"]`, 28 frames sent in one burst, all served |
| unknown symbol expectation | Not publicly specified | `[5, "marketUpdates-999999"]` and `[5, "nope"]` get no reply and nothing after, and the socket stays open |
| chunk unit and budget | Not publicly specified | one topic per frame, 28 topics on one socket without a refusal, which covers the whole catalog |
| keepalive mechanism | Not publicly specified, and WAMP v1 has no heartbeat | the server sends a protocol ping every 8.0 s, 7,952 to 8,020 ms apart over both passes, and `ws` answers each one on its own |
| connection lifetime and maintenance notice | Not publicly specified | no forced close and no notice, the longest socket held 91 s |
| handshake and operation rate limits | Not publicly specified for the socket | none hit, 16 sockets opened over 22 minutes, at most two at once |
| public market data authentication | none, the web client subscribes market topics before login, S2 | none |
| message parse and routing | WAMP v1 `EVENT`, `[8, topicURI, payload]` | route on element 1, `marketUpdates-<market_id>`, then on `payload.messageType`, or on `payload.topic` for the chart candle |
| subscribe acknowledgement shape | WAMP v1 has no subscribe acknowledgement | none arrives, the first event is the only sign a topic is live |
| symbol identifier format | numeric `market_id` from `https://app.chainex.io/action/getMarkets`, S2 | `57` is BTC/ZAR, and the REST API spells the same market as the path `BTC/ZAR`, see [`rest.md`](./rest.md) section 2 |
| number representation | | decimal strings: 8 decimals on `order` (`"16.28000000"`), trimmed on `order-delete` (`"16.29"`). `topBar` mixes JSON numbers and strings |
| timestamp representation | | `time` is `"YYYY-MM-DD HH:MM:SS"` in UTC, to the second. On `order-delete` it is the placement time of the order, 5 s to 77 minutes before the frame in the rerun |
| size unit | | `amount` in the base asset and `total` in the quote asset, `total` equal to `price` times `amount` rounded to the quote's decimals |
| sequence semantics | none | no sequence, order id, update id or checksum field in any payload |
| idle repeat behaviour | | the `MARKET_SUMMARY` frame repeats for every subscribed market about once a minute even when nothing changed, as on ZARP/ZAR with no trade for 51 days |

## 4. The book channel in detail

No book channel exists, so this section describes the `order` and `order-delete` events on `marketUpdates-<market_id>`, which are the only book information the socket carries.

### Snapshot on subscribe

None.
A subscribe returns no frame of its own.
In the rerun the first event came 245 ms after the 28 subscribe frames, and the first four were three `order-delete` and one `order` placed within about a second of the subscribe, P1.
That is live traffic, not a snapshot.
A feed must seed each book from REST, `GET https://api.chainex.io/market/orders/<COIN>/<QUOTE>/ALL/200`, see [`rest.md`](./rest.md) section 5.

### Delta semantics

Each event is one order, not one level.
`order` adds `amount` at `price` on the `order` side, and `order-delete` removes `amount` at `price`.
A level book seeded from REST after subscribing, with every later `order` added and every `order-delete` subtracted, matched a fresh REST book level for level in 22 of 24 comparisons over six active markets and 77 s, and in 24 of 24 in the rerun, P2.
Each of the two misses was one level, on XRP/USDT in the first comparison and on ETH/ZAR in the last, and the XRP/USDT level matched again 18 s later.
Both fit an event that crossed the REST read in flight.
How a fill appears is Not verified, because no `trade` event arrived during any socket run.
The web client handles a `trade` message, S2, and whether a partial fill also sends an `order-delete` and a smaller `order` is unknown.

### Sequence and gap rule

None exists.
No payload carries a sequence, an update id or an order id, so a lost event is invisible and cannot trigger `resync` at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 296.
The only recovery is a periodic REST reseed.

### Checksum

None.

### Level order on the wire

Not applicable, each event holds one price.
The REST book lists bids descending and asks ascending, see [`rest.md`](./rest.md) section 5.

### Size unit

`amount` is in the base asset, for example `"0.02372625"` BTC on BTC/ZAR at `"1427702.00000000"` ZAR, with `total` `"33874.01000000"` ZAR, P1.
No CCXT `contractSize` exists to compare with, and a spot size in the base asset needs none.

### One-sided and empty books

An empty side happens.
In the rerun, SHIB/ZAR received six `order-delete` events on the buy side within 6 s and no new bid, and two REST reads 0.3 s after its events returned no bid at all, P1.
The next `MARKET_SUMMARY` for SHIB/ZAR carried `"topBid": "0.00000000"`, so the summary spells an empty side as zero.
No other frame marks the empty side, and the level book of section 4 simply holds no bid.
14 and 13 of the 26 books held 5 or fewer levels on at least one side in the two depth scans, and BTC/USDT, TITANX/USDT and ZARP/ZAR had 1 or 2 levels per side, see [`rest.md`](./rest.md) section 5.

### Idle repeats

The `MARKET_SUMMARY` frame is a once a minute repeat of each market's touch, not a change notice.
It carries the same `topBid` and `topAsk` as the REST book at that moment, for example `"1400164.60000000"` and `"1402182.67000000"` on BTC/ZAR, P1.
`order` and `order-delete` events are not repeated.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `[5, "marketUpdates-999999"]` | none | nothing in 1.2 s, the socket stays open |
| `[5, "nope"]` | none | nothing |
| `[5, "marketUpdates-57"]` twice | none | not distinguishable from one subscribe |
| `[6, "marketUpdates-57"]` | none | |
| `[2, "probe-call-1", "getOrderBook", "BTC/ZAR"]`, a WAMP call | none, where WAMP v1 expects a `CALLERROR` | |
| `[1, "cx", "http://chainex.io/"]`, a WAMP prefix | none | |
| `[99, "x"]` | none | |
| `hello`, not JSON | none | the socket stays open |

The first errors run also sent one WAMP `PUBLISH` to the unknown topic `marketUpdates-999999`, which got no reply.
It was removed from the probe, because publishing is not a read.
The errors socket received no protocol ping in 15 s and in 14 s in the rerun, while every other socket got its first ping 4.9 to 8.9 s after opening, P3.
So one of the frames above appears to stop the server's pings for that socket, and which one is Not verified.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | server protocol ping every 8.0 s on subscribed, unsubscribed and subprotocol-less sockets alike, the first one 4.9 to 8.9 s after opening, and no client ping needed |
| silence the server tolerates | Not publicly specified | a socket that never subscribed and never sent a frame stayed open for the full 70 s in both passes, and so did one subscribed only to ZARP/ZAR, P4 |
| forced disconnect | Not publicly specified | none in any run |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. When offered, the server negotiates `permessage-deflate; client_no_context_takeover; server_no_context_takeover`, so it is optional and the engine's refusal is honoured |
| handshake | | 666 to 800 ms to open over 16 sockets |
| subscription limits | Not publicly specified | 28 topics on one socket, no cap reached |
| throughput | | 28 topics: 139 frames and 30,145 bytes in 90 s, and 150 frames and 35,363 bytes in 75 s in the rerun, about 1.5 to 2 frames per second |

## 6. Captured frames

Trimmed only where marked, from the runs of 2026-09-23 UTC.

Welcome, the first frame on a socket that offered `wamp`.

```json
[0, "b2dc9061f740bf9ba766b1f8d2ea7433", 1, "ChainEXWamp/v0.1"]
```

Subscribe, one topic per frame.
No acknowledgement follows.

```json
[5, "marketUpdates-57"]
```

A new order on BTC/ZAR.

```json
[8, "marketUpdates-57", {"feed": "marketUpdates-57", "messageType": "order", "order": "sell", "time": "2026-09-23 04:52:10", "amount": "0.02372625", "price": "1427702.00000000", "total": "33874.01000000"}]
```

A removed order on BTC/ZAR, whose `time` is when the order was placed, not when it was removed.

```json
[8, "marketUpdates-57", {"feed": "marketUpdates-57", "type": "delete", "order": "sell", "time": "2026-09-23 04:51:21", "amount": "0.00009500", "price": "1427674.00", "total": "135.62", "messageType": "order-delete"}]
```

The once a minute market summary.

```json
[8, "marketUpdates-57", {"feed": "marketUpdates-57", "topic": "MARKET_SUMMARY", "type": "stats", "pair": "BTC/ZAR", "topBid": "1400164.60000000", "topAsk": "1402182.67000000", "high": "1408685.89000000", "lastPrice": "1402182.67000000", "low": "1396388.80000000", "volume": "1879.96", "volumeAmount": "0.00", "change": "+0.05", "messageType": "sidebar"}]
```

A chart candle.

```json
[8, "marketUpdates-59", {"feed": "marketUpdates-59", "topic": "NEW_TRADE_BUCKET", "type": "chart", "date": "2026-09-23 04:52", "open": "44775.57000000", "close": "44775.57000000", "high": "44775.57000000", "low": "44775.57000000", "volume": "0.00000000"}]
```

The venue wide bar.

```json
[8, "topBar", {"btczar": 1879.96, "btcusdt": 0, "24hbtcvol": 0, "24husdtvol": 2795.19018459, "hvol": "8423.20000000", "hvolmarketid": "161", "hchange": "+150.00", "hchangemarketid": "194", "lvol": 0, "lvolmarketid": 0, "lchange": "-1.25", "lchangemarketid": "53", "feed": "topBar", "type": "stats", "volume": {"USDT": "2795.20"}, "trades": 107, "messageType": "topBar"}]
```

Keepalive and errors have no frames to show.
The keepalive is a WebSocket protocol ping, and no error case produced a reply, section 4.

## 7. Private channels

Named for a future execution stage, from the web client, S2, not probed.
A logged in client calls `https://app.chainex.io/action/getPushSession`, subscribes the returned session id as a topic on the same socket, and receives `update-balance`, `deposit`, `withdraw`, `order-created`, `order-cancel`, `specific-user-trade` and `pending-order-cancel` messages there.
Orders are placed over REST only, `POST /trading/order` on `https://api.chainex.io`, S1.

## 8. Recommended feed shape

ChainEX is spot only, so this venue cannot be a perpetual leg, and no feed is recommended for the engine.
If a spot book feed were ever wanted, this is the shape the capture supports, as a recommendation for a later design and not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket for all 26 markets, `wss://push.chainex.io:443/`, offering the `wamp` subprotocol | one socket serves every market, and 28 topics ran on one |
| market ids | `market_id` from `https://app.chainex.io/action/getMarkets`, mapped to `BTC/ZAR` style names | the REST API does not publish the id |
| subscribe frames | `[5, "marketUpdates-<market_id>"]`, one frame per market | WAMP v1 subscribes one topic per message |
| snapshot | after subscribing, `GET /market/orders/<COIN>/<QUOTE>/ALL/200` per market, then `resetBook` | the socket sends no snapshot |
| delta | `order` adds `amount` at `price` on `order`'s side, `order-delete` subtracts it, and a level at 0 is deleted | 46 of 48 REST comparisons matched over two runs |
| resync | reseed from REST every 30 s, and whenever a `MARKET_SUMMARY` touch disagrees with the local touch | no sequence exists to detect a gap |
| keepalive | none sent, `ws` answers the server's pings | the server pings every 8 s |
| `maxSilenceMs` | 30,000 | [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 97 counts a ping as traffic, and 30 s is three missed pings plus margin |
| receive time | stamp on arrival, never from `time` | `time` is seconds, and on `order-delete` it is the placement time |
| deflate | keep `perMessageDeflate: false` | the server offers it only when asked |

The feed would still depend on REST for every seed and reseed, and trades were not observed, see section 4.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ChainEX API page, text in the web bundle chunk `15.ea62880822effc364b7a.js` | https://chainex.io/api | 2026-09-22 | ChainEX, global | REST only API, order entry over REST, sections 1 and 7 |
| S2 | ChainEX web bundle `main.227bb1402baa35b3f0a0.js` and chunk `9.e7372661ee16c638a9a2.js` | https://chainex.io/main.227bb1402baa35b3f0a0.js | 2026-09-22 | ChainEX, global | `PUSH_SERVER`, `ab.Session`, topic names, message types, the `getOrderDepth` reload, the session topic, sections 1 to 7 |
| P1 | `ws-probe.mjs book` at 04:51 UTC, 90 s, and the rerun at 05:09 UTC, 75 s | [`ws-probe.mjs`](../../../scripts/probes/venues/chainex/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs replay` at 04:54 and 05:10 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/chainex/ws-probe.mjs) | 2026-09-23 UTC | this host | the REST seeded book check, section 4 |
| P3 | `ws-probe.mjs errors` at 04:55 and 05:08 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/chainex/ws-probe.mjs) | 2026-09-23 UTC | this host | section 4 |
| P4 | `ws-probe.mjs silence` at 04:56 and 05:12 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/chainex/ws-probe.mjs) | 2026-09-23 UTC | this host | keepalive and silence, sections 3 and 5 |
| P5 | `ws-probe.mjs deflate` at 04:51, 05:00 and 05:08 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/chainex/ws-probe.mjs) | 2026-09-23 UTC | this host | compression and the socket without a subprotocol, sections 1 and 5 |
