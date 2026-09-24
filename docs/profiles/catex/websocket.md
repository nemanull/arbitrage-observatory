# Catex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:32 to 04:46 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit Cloudflare places in Canada (`loc=CA`, edges SEA and YVR).

This profile covers the public spot WebSocket of Catex (catex.io), which has no CCXT class and lists no perpetuals, see [`fees.md`](./fees.md) section 3.
The socket speaks STOMP 1.2 over WebSocket, and the ERROR text it returns names the Spring framework STOMP broker.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/catex/ws-probe.mjs), and the capture is quoted beside the documented value.
The documentation is a GitHub wiki last edited on 2023-10-17, S1, and the web trading page's own client script, S2, fills what the wiki leaves out.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| spot, every pair and topic | `wss://www.catex.io/stream`, S1, and `brokerURL` at S2 line 834 | 101 in 92 to 162 ms over 17 timed opens, behind Cloudflare (`server: cloudflare`, `cf-ray` edges SEA and YVR) |
| perpetuals, futures, options | none | none exist, see [`fees.md`](./fees.md) section 3 |

One socket carries every pair and every public topic.
The multi mode subscribed both book sides of all 64 pairs, 128 subscriptions on one socket, and 68 and 69 destinations delivered within 30 s with no error.
The client offers the subprotocols `v10.stomp`, `v11.stomp` and `v12.stomp` as the web page's stompjs client does, and the server selects `v10.stomp`, while the CONNECTED frame then reports `version:1.2`.
A socket that offers no subprotocol also gets CONNECTED with `version:1.2`.

## 2. Channel matrix for public market data

| destination | payload | depth and speed | probed |
|---|---|---|---|
| `/topic/order/buy/{BASE}/{QUOTE}` | array of `{coinCode, baseCoinCode, type, price, amount, total}`, bids best first | the whole top 16 of one side on change, at most about every 0.5 s | 25 to 35 frames in 45 s on `BTC/USDT` over three runs, 0 on `COSA/BTC` |
| `/topic/order/sell/{BASE}/{QUOTE}` | same, asks best first | same | 27 to 31 frames in 45 s on `BTC/USDT` over three runs |
| `/topic/trading/{BASE}/{QUOTE}` | one trade `{price, amount, type, createTime}` | on trade | 6 to 10 frames in 45 s on `BTC/USDT` over three runs |
| `/topic/quote/{BASE}/{QUOTE}` | 24 h last, high, low, volume, change, `priceDecimal`, `amountDecimal` | on trade | 5 to 9 frames in 45 s on `BTC/USDT` over three runs |
| `/topic/quote-history/{BASE}/{QUOTE}/{period}` | one kline, period `5MINUTE`, `15MINUTE`, `30MINUTE`, `HOUR`, `4HOUR` or `DAY` | on update | not probed |

The destinations and payloads are from S1, and the book side split and the order of each side are from S2 lines 903 to 911.
There is no best bid and ask topic, no diff topic, and no mark, index or funding topic.
The wiki calls each order payload a "JSON Object", and the wire sends a JSON array.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one socket carried 128 subscriptions on 64 pairs of four quote assets, and the book socket carried order, trade and quote topics together |
| subscribe frame shape | a topic per pair and side, S1, sent by stompjs `subscribe` inside `onConnect`, S2 lines 844 to 853 | STOMP `CONNECT`, then one `SUBSCRIBE` frame per destination with `id` and `destination` headers |
| unknown symbol expectation | not documented | no ERROR and no frame for `NOPE/USDT`, `BTC_USDT`, `btc/usdt`, `/topic/nope/BTC/USDT` or `/topic/order/BTC/USDT` within 6 s, in two runs |
| chunk unit and budget | not publicly specified | 128 SUBSCRIBE frames sent in one burst, none refused |
| keepalive mechanism | STOMP heart-beat, the web client asks `4000,4000`, S2 lines 837 and 838 | the server answers `heart-beat:0,0` and sends no heart-beat. A client newline every 20 s keeps a quiet socket open |
| connection lifetime and maintenance notice | not documented | a socket with no traffic either way closes at 60.09 to 60.11 s with 1006. No cap reached in 75 s with traffic. No notice on the socket, maintenance is announced on the news page |
| handshake and operation rate limits | not publicly specified | 17 timed opens in 92 to 162 ms, no refusal |
| public market data authentication | none, S1 | `CONNECT` without login headers answers `CONNECTED` |
| message parse and routing | not documented | STOMP `MESSAGE`, route on the `destination` header, JSON body |
| subscribe acknowledgement shape | not documented | none. A `SUBSCRIBE` with a `receipt` header got no `RECEIPT`, and only `DISCONNECT` did |
| symbol identifier format | `BTC/USDT` inside the path, S1 | uppercase `BASE/QUOTE` as two path segments, the spelling of REST `api/order`, while the REST `cmc` calls spell `BTC_USDT` |
| number representation | JSON numbers, S1 | JSON numbers with 12 decimals, as in `87205.740000000000`, and 24 decimals on `total` |
| timestamp representation | `createTime` string on trades and klines, S1 | book frames carry no time at all. Trades carry `"2026-09-23 04:32:52"`, UTC, one second resolution |
| size unit | `amount`, S1 | base coin, and `total` is price times amount in quote |
| sequence semantics | none documented | none. The `message-id` header counter is shared across sessions, section 4 |
| idle repeat behaviour | not documented | a frame identical to the previous one on its topic: 0 to 14 of 18 to 35 frames per `BTC/USDT` or `ETH/USDT` side, and 7 of 9 on `QTUM/USDT` bids |

## 4. The book channel in detail

### Snapshot on subscribe

There is none.
`COSA/BTC` has 21 bids and 22 asks on REST, see [`rest.md`](./rest.md) section 5, and its two order topics sent 0 frames in each of three 45 s book runs, and its bid topic sent 0 frames on three sockets in each of two 75 s silence runs.
On busier pairs the first order frame came 164 ms to 6.4 s after the subscribe over three runs, which is the next change, not a reply.
The web page seeds each side from `GET /order/{BASE}/{QUOTE}/{buy|sell}/list` before it relies on the socket, S2 line 539.
A feed has to do the same with REST, see [`rest.md`](./rest.md) section 5.

### Delta semantics

There are no deltas.
Every frame is the complete top of one side, and the web page empties the side and redraws it on each frame, S2 lines 558 to 560 and 903 to 911.
Bids and asks arrive in separate frames on separate topics, so a feed pairs the newest list of each side.
Paired that way, 1 of 108 and 1 of 126 checks showed a locked top, `BTC/USDT` at 87103.31 and at 87151.14 on both sides, because the two lists come from different instants and carry no time.

### Sequence and gap rule

No frame carries a sequence number or a time.
The STOMP `message-id` header is `<session id>-<counter>`, and the counter is not per socket.
In the 04:43 run it rose from 11368751 to 11369094, 343 steps, while this socket received 145 frames, and 64 of the 144 steps between them were larger than 1.
In the 04:39 run it was 11367813 to 11368082 over 123 frames, with 54 of 122 steps larger than 1.
So a lost frame cannot be detected, and since each frame replaces a whole side, the next frame on that side repairs it.
The gap between two frames on one topic was never under 515 ms in either run, which suggests the server pushes a side at most about twice a second.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| source | bids | asks |
|---|---|---|
| `/topic/order/buy` and `/sell` | best first, descending, in every frame of both runs | best first, ascending, in every frame |
| REST `api/order` and `cmc/orderbook` | descending | ascending |

No frame held two levels at the same price.
The web page reverses the ask list only to draw it, S2 line 910.

### Level window

A side holds at most 16 levels.
In the multi runs 503 of 529 and 500 of 516 frames held exactly 16, and the rest held 3 to 15 on thin sides.
REST `api/order` returns up to 100 per side at the same time, see [`rest.md`](./rest.md) section 5.
The engine holds 20 levels per side, `DEPTH_LEVELS` at `server/src/engine/cluster/ClusterIndexBuilder.ts` line 17, so this socket cannot fill it.

### Size unit

`amount` is in the base coin and `total` equals price times amount in the quote coin.
This is spot, so there is no contract size.
At 20 s into each book run the 16 socket levels of `BTC/USDT` equalled the first 16 REST `api/order` levels position by position on both sides, 16 of 16 in all three runs.

### One-sided and empty books

No frame with an empty array was seen in 1,045 multi frames.
What a topic sends when its side empties is Not verified.
REST shows 4 of 64 pairs with one or no side in `cmc/summary`, see [`rest.md`](./rest.md) section 2.

### Idle repeats

A push can repeat the previous frame byte for byte.

| topic | 04:39 run | 04:43 run |
|---|---|---|
| `/topic/order/buy/BTC/USDT` | 4 of 25 | 14 of 35 |
| `/topic/order/sell/BTC/USDT` | 6 of 31 | 2 of 31 |
| `/topic/order/buy/ETH/USDT` | 0 of 18 | 3 of 26 |
| `/topic/order/sell/ETH/USDT` | 6 of 27 | 2 of 22 |
| `/topic/order/buy/QTUM/USDT` | 2 of 3 | 7 of 9 |

A repeat most likely reflects a change below the 16 levels shown, which is an inference.
A quiet side sends nothing at all, and `COSA/BTC` stayed silent for 75 s.

### Unknown, closed and misspelled symbols

| request | reply | then |
|---|---|---|
| `SUBSCRIBE` to `/topic/order/buy/NOPE/USDT`, `/topic/order/buy/BTC_USDT`, `/topic/order/buy/btc/usdt`, `/topic/nope/BTC/USDT`, `/topic/order/BTC/USDT` | nothing | nothing in 6 s, the socket stays usable |
| `SUBSCRIBE` with no `id` header | nothing | nothing in 2 s |
| text that is not STOMP | nothing until the next NUL | the next frame gets `ERROR` `No enum constant org.springframework.messaging.simp.stomp.StompCommand.hello, not stompSUBSCRIBE`, then close 1002 at 10.19 and 10.25 s |
| `SUBSCRIBE` before `CONNECT` | nothing in 3 s | after `CONNECT` it delivered 4 and 3 frames in 4 s |

No closed pair exists to probe, since `isFrozen` was `"0"` on all 64, see [`rest.md`](./rest.md) section 2.
Because a misspelled destination is accepted in silence, a feed has to notice a topic with no frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | stompjs with `heartbeatIncoming` and `heartbeatOutgoing` 4000, S2 lines 837 and 838 | `CONNECT` with `heart-beat:4000,4000` gets `heart-beat:0,0`, so neither side is owed heart-beats, and 0 arrived on any socket |
| silence the server tolerates | not documented | two runs of five sockets at once for 75 s. With no CONNECT, or connected and subscribed to quiet `COSA/BTC` and sending nothing, the socket closed at 60.09 to 60.11 s with 1006 and no close frame. Subscribed to busy `BTC/USDT` and sending nothing, it stayed open. Subscribed to `COSA/BTC` and sending a newline or a `SUBSCRIBE` every 20 s, it stayed open. So traffic in either direction resets a 60 s idle timer |
| forced disconnect | not documented | none in 75 s |
| maintenance notice | not documented | nothing on the socket. The news page posted "Important Security Notice: Scheduled Maintenance & Fraud Alert" on 2026-07-18, S3 |
| compression | not documented | text frames only with `perMessageDeflate: false`. A client that offers permessage-deflate gets `permessage-deflate;client_max_window_bits=15`, so the server does negotiate it when asked |
| handshake | | 92 to 162 ms to open, and `CONNECTED` follows the `CONNECT` at once |
| subscription limits | not documented | 128 on one socket with no error |
| throughput | | 128 subscriptions on all 64 pairs: 17.6 and 17.2 frames per second, 41.7 and 40.8 KB per second, about 2,370 bytes per frame, 29.2 and 22.3 µs `JSON.parse` per frame. Only 34 and 35 of 64 pairs sent any frame in 30 s |

The engine refuses deflate at `server/src/feeds/book/VenueFeed.ts` line 81, and Catex does not force it, so that is not a blocker.

## 6. Captured frames

Trimmed, from the book run at 04:32 UTC and the errors runs.
`^@` stands for the NUL byte that ends every STOMP frame.

Connect, and the server's answer.

```text
CONNECT
accept-version:1.2,1.1,1.0
heart-beat:4000,4000

^@
```

```text
CONNECTED
version:1.2
heart-beat:0,0

^@
```

Subscribe.

```text
SUBSCRIBE
id:sub-0
destination:/topic/order/buy/BTC/USDT

^@
```

Book message headers, then its body with the first two of 16 levels kept.

```text
MESSAGE
destination:/topic/order/buy/BTC/USDT
content-type:application/json
subscription:sub-0
message-id:5db65849-4ef6-4a4c-5b4c-a27cadb9c4f4-11365530
content-length:2272
```

```json
[{"coinCode":"BTC","baseCoinCode":"USDT","type":"BUY","price":87205.740000000000,"amount":0.002210000000,"total":192.724685400000000000000000},{"coinCode":"BTC","baseCoinCode":"USDT","type":"BUY","price":87173.050000000000,"amount":0.002430000000,"total":211.830511500000000000000000}]
```

```json
[{"coinCode":"BTC","baseCoinCode":"USDT","type":"SELL","price":87223.780000000000,"amount":0.003300000000,"total":287.838474000000000000000000},{"coinCode":"BTC","baseCoinCode":"USDT","type":"SELL","price":87232.840000000000,"amount":0.001590000000,"total":138.700215600000000000000000}]
```

Trade and quote bodies.

```json
{"price":87223.780000000000,"amount":0.002930000000,"type":"BUY","createTime":"2026-09-23 04:32:52"}
```

```json
{"coinCode":"BTC","coinName":"Bitcoin","baseCoinCode":"USDT","price":87223.780000000000,"dailyHighest":87239.120000000000,"dailyLowest":85112.760000000000,"dailyVolume":32.985840000000,"dailyVolumeBase":2841290.22337320,"dailyChange":0.0183,"priceDecimal":2,"amountDecimal":5}
```

Error after a text that was not STOMP, and the receipt a `DISCONNECT` with `receipt:bye` gets.

```text
ERROR
message:No enum constant org.springframework.messaging.simp.stomp.StompCommand.hello, not stompSUBSCRIBE
content-length:0

^@
```

```text
RECEIPT
receipt-id:bye

^@
```

## 7. Private channels

Named for a future execution stage, from S2, not probed.
The web page subscribes `/user/{userId}/order/{BASE}/{QUOTE}` and `/user/{userId}/trading/{BASE}/{QUOTE}` on the same socket after a web login, S2 lines 863 and 874.
Orders are placed over the web session with `POST /manager/order/buy/submit` and `/manager/order/sell/submit`, S2 lines 445 and 508, and the wiki says an account and trading API "will be available next", S1.

## 8. Recommended feed shape

Catex cannot be a perpetual leg, because it lists no perpetuals, so this is a note for a possible spot stage and not a recommendation for the engine.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://www.catex.io/stream`, subprotocols `v10.stomp`, `v11.stomp`, `v12.stomp` | one socket served 128 subscriptions |
| markets per connection | all 64 pairs, 128 subscriptions | 17 frames per second in total, no cap met |
| frames | `CONNECT` with `accept-version:1.2,1.1,1.0` and `heart-beat:0,0`, then one `SUBSCRIBE` per side and pair | the server grants no heart-beat anyway |
| seed | `GET /api/order?market={BASE}/{QUOTE}&limit=16` per pair after the subscribe, then replace each side on its next frame | no snapshot on subscribe, and REST matched the socket's 16 levels |
| apply | replace the whole side on every frame, never merge | frames are full lists |
| keepalive | send `\n` every 20 s | an idle socket dies at 60 s, and a client newline kept a quiet socket open |
| `maxSilenceMs` | 30,000 on a socket that carries `BTC/USDT` and `ETH/USDT` | the longest inbound gap on a four pair socket was 910 to 1,400 ms over three runs, the server sends no heart-beat, and quiet pairs send nothing |
| resync | none by sequence, since there is none. On reconnect resubscribe and reseed from REST, and reseed a side from REST when it has been silent for a set time | a quiet side may be stale with no signal |
| depth | 16 levels per side | the socket's cap, below the engine's 20 |
| receive time | stamp on arrival | frames carry no time |
| deflate | keep `perMessageDeflate: false` | text frames arrive uncompressed |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Catex exchange API wiki, "Catex Websocket API", last edited 2023-10-17 | https://github.com/catex/catex_exchange_api/wiki/Catex-Websocket-API | 2026-09-22 | Catex, global | URL, destinations, payload examples, kline periods, sections 1 to 3 and 7 |
| S2 | Catex web trading page script `trading.js?v=20240209` | https://www.catex.io/crypto/frontend/scripts/trading.js?v=20240209 | 2026-09-22 | Catex, global | stompjs config lines 832 to 859, `onConnect` lines 844 to 853, topic subscriptions lines 862 to 978, REST seed line 539, redraw lines 558 to 560, order entry lines 445 and 508, sections 1 to 8 |
| S3 | Catex announcement 713 | https://www.catex.io/announcement/713 | 2026-09-22 | Catex, global | maintenance notice, section 5 |
| P1 | `ws-probe.mjs book`, at 04:32, 04:39 and 04:43 UTC on 2026-09-23, the first on an earlier revision without the message-id and pairing counts | [`ws-probe.mjs`](../../../scripts/probes/venues/catex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 4 and 6 |
| P2 | `ws-probe.mjs multi`, at 04:34 and 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/catex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 4 and 5 |
| P3 | `ws-probe.mjs errors`, at 04:35 and 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/catex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3, 4 and 6 |
| P4 | `ws-probe.mjs silence`, at 04:37 and 04:45 UTC, and at 04:35 on an earlier two socket revision | [`ws-probe.mjs`](../../../scripts/probes/venues/catex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 and 5 |
| P5 | `ws-probe.mjs deflate`, at 04:32 and 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/catex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 and 5 |
