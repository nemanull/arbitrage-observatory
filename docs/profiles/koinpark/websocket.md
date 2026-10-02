# Koinpark WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:17 to 03:42 UTC, from the development host near Seattle.

Koinpark lists no perpetual, so this profile covers the spot book feed, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Koinpark documents no WebSocket.
Its API page lists REST calls only, S1.
The feed below is the one the koinpark.com trade page uses: MQTT 3.1.1 over a secure WebSocket, found in the page's script bundle, S2, and then probed with [`ws-probe.mjs`](../../../scripts/probes/venues/koinpark/ws-probe.mjs).
Every "documented" cell is therefore Not publicly specified, and every behaviour below is what the wire did.

## 1. Endpoints

| product | URL | probed |
|---|---|---|
| spot, every pair | `wss://konprklvewebsktwss.koinpark.com`, MQTT over WebSocket, from S2 | open in 766 to 812 ms, and 3,916 ms once, CONNACK code 0 at 990 to 1,690 ms after the socket was created |

One socket carries every pair and every topic.
The host resolved to `172.67.138.65` and `104.21.8.23`, which are Cloudflare, and the `cf-ray` of the upgrade named the Seattle or Vancouver edge.
The server answers the subprotocol `mqtt` when it is offered, and it also accepts a socket that offers none, P6.

The web client connects with `mqtt.connect(url, {reconnectPeriod: 5e3, connectTimeout: 1e4, keepalive: 30, clean: true, resubscribe: false})`, S2.

## 2. Channel matrix for public market data

An MQTT topic is the channel, and the pair is spelled `BTC_USDT`, the URL pair `BTC-USDT` with the dash replaced, S2.

| topic | payload | cadence probed |
|---|---|---|
| `orderbook_<pair>` | the whole book, 20 levels per side, on pairs whose ticker says `liq: 1` | every 10 s on a fixed cadence: gaps of 9,634 to 10,336 ms on 4 pairs over two 90 s runs, and a median gap of 10,002 to 10,135 ms over 61 pairs in the batch runs |
| `orderBookMatch_<pair>` | `l2update` deltas `[side, price, amount]` on pairs with `liq: 0` | only when the book changes: 3 frames in 90 s on `BTC_USDT` and on `ETH_USDT` in the first run and none in the rerun |
| `tradehistory_<pair>` | a list of 30 recent trades on `liq: 1` pairs | every 60 s, gaps of 59,929 to 59,977 ms. On `liq: 0` pairs nothing in two 90 s runs |
| `single_ticker_response_<pair>` | last, 24 h open, high, low, volume, INR and USDT value, `liq` | about every 30 s on `liq: 1` pairs, gaps of 29,918 to 33,319 ms. On `liq: 0` pairs 6 frames on `BTC_USDT` and 5 on `ETH_USDT` in the first 90 s run, and none in the rerun |
| `all_ticker_response` | one ticker message per pair, 101 pairs per burst, all `liq: 1` | a burst about every 30 s, 303 messages in each 90 s run |
| mark, index, funding | none, spot only | |

The web client subscribes `orderbook_<pair>` when the pair's `liq` is 1 and `orderBookMatch_<pair>` otherwise, and it replaces the whole book on the first and merges `changes` into the book on the second, S2.
The same topic namespace also carries `userBalance_<id>`, `openorder_<id>` and `comporderData_<id>` for the logged in user, see section 7.

### Two kinds of pair

The `liq` flag splits the catalog in two, and the two kinds are different markets.

| kind | pairs | book | evidence |
|---|---|---|---|
| `liq: 1`, whole book on `orderbook_` | 61 of 215 pairs delivered on this topic in each of four 45 s batch runs: the 4 BTC and 3 ETH quoted pairs, 38 INR pairs and 16 USDT pairs, such as `ETH_BTC`, `ZEC_USDT`, `FET_USDT` and `WIN_INR` | Binance's spot book at 0.8 times the size, republished every 10 s | below |
| `liq: 0`, deltas on `orderBookMatch_` | the other 154, including `BTC_USDT`, `ETH_USDT`, `BTC_INR` and `USDT_INR` | Koinpark's own book, which did not change once on `BTC_USDT` in each of two 60 s runs of 5 s REST polls | [`rest.md`](./rest.md) section 5 |

On each of 9 and then 10 `orderbook_ETH_BTC` frames in two P3 runs, all 20 bid prices and all 20 ask prices were levels of Binance's `ETHBTC` book fetched 126 to 150 ms later, and the median size ratio Koinpark over Binance was 0.8 on every frame.
On `ZEC_USDT` 0 to 20 of 20 prices per side matched per frame and the median size ratio was again 0.8 on every frame, which is what a copy of a faster moving book taken up to 10 s earlier looks like.
The flag and the topic agreed on all but three pairs in the rerun: 62 catalog pairs carried `liq: 1`, 60 of them delivered on `orderbook_`, one delivered on `orderBookMatch_` instead, one delivered nothing, and one pair missing from the ticker burst delivered on `orderbook_`.
The site's backend call for the initial book is named `binance/getOrderBook`, S2.
So a `liq: 1` book is a scaled copy of Binance spot that can be up to 10 s old, and a cross between it and Binance is the copy's age, not a price.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is empty because no WebSocket is documented, S1.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one URL for every pair and topic |
| subscribe frame shape | Not publicly specified | a binary MQTT SUBSCRIBE packet listing topics at QoS 0, after a binary MQTT CONNECT. A JSON text frame makes the server close the socket with 1006 241 to 255 ms later, P6 |
| unknown symbol expectation | Not publicly specified | `orderbook_NOPE_USDT` and `orderBookMatch_NOPE_USDT` are granted QoS 0 in the SUBACK and never deliver |
| chunk unit and budget | Not publicly specified | 431 topics in one SUBSCRIBE packet were all granted in 255 to 265 ms, P4 |
| keepalive mechanism | MQTT PINGREQ within the CONNECT keepalive, the web client uses 30 s | PINGRESP in 241 to 825 ms. A CONNECT with keepalive 10 s and no PINGREQ was closed with 1006 at 16.05 and 16.07 s, which is MQTT's one and a half keepalives after the CONNACK, P5 |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 90 s, and no notice topic seen |
| handshake and operation rate limits | Not publicly specified | none reached at 431 topics on one socket or 3 sockets opened at once |
| public market data authentication | none in the web client, which sends no username or password | CONNECT with a random client id and no credentials got code 0 |
| message parse and routing | MQTT PUBLISH, JSON payload | route on the MQTT topic. The payload of `orderbook_` also carries `pair_name`, and the payload of `orderBookMatch_` carries `productId` |
| subscribe acknowledgement shape | MQTT SUBACK | one SUBACK per SUBSCRIBE with one return code per topic, all 0 |
| symbol identifier format | `BTC_USDT` in the site bundle, S2 | `BTC_USDT`, identical to the REST `trading_pairs` |
| number representation | Not publicly specified | whole book: `price` and `amount` as decimal strings, `total` as a JSON number. Deltas: price and amount as decimal strings |
| timestamp representation | Not publicly specified | no book frame carries a time. Tickers carry `datetime` as Unix seconds, sometimes with a fraction, on `liq: 1` pairs, and as an ISO string on `liq: 0` pairs. Trades carry `datetime` in ms |
| size unit | Not publicly specified | base currency, the same as the REST book at the same price, section 4 |
| sequence semantics | Not publicly specified | none. No frame carries an update id |
| idle repeat behaviour | Not publicly specified | the whole book is pushed on a fixed 10 s cadence, and no frame equalled its predecessor. A quiet own book sends nothing |

## 4. The book channel in detail

### Snapshot on subscribe

Neither topic sends a snapshot on subscribe.
`orderbook_` delivers its next scheduled whole book, which arrived 10,287 to 10,520 ms after the SUBSCRIBE in the first P3 run and 342 to 511 ms after it in the rerun, and each of its frames is a whole book.
`orderBookMatch_` sends only deltas, so the starting book has to come from `GET /publicApi/orderbook`, [`rest.md`](./rest.md) section 5.

### Delta semantics

A delta frame is `{"type": "l2update", "productId": <pair>, "data": {"changes": [[side, price, amount], …]}}`, with `side` `buy` or `sell`.
The amount replaces the level, and `"0"` deletes it, which is how the web client's `mergeP2POrderBook` applies it, S2.
In the first P3 run, a REST book taken 1.1 to 1.3 s after the SUBSCRIBE, with the 7 and 8 later changes applied, equalled the REST book taken 90 s later on all top 20 levels per side and on the level count, 509 bids and 24 asks on `BTC_USDT`, and 632 and 37 on `ETH_USDT`.
In the rerun no delta came and the two REST books were equal on all 40 top levels of both pairs.

### Sequence and gap rule

```text
orderbook_<pair>        replace the book with the frame's 20 levels, no id to check
orderBookMatch_<pair>   apply each change by price, no id, so a lost frame cannot be detected
```

MQTT at QoS 0 over one TCP connection does not reorder, but a delta lost across a reconnect is invisible.
The only repair is to take a fresh REST book after every reconnect and at intervals.

### Checksum

None.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `orderbook_` whole book | best first, descending, on every frame of 4 pairs in both P3 runs | best first, ascending |
| `orderBookMatch_` delta | a list of changes, sells then buys in the frames seen, applied by price | same |
| REST book | descending | ascending |

### Level window

The whole book is 20 levels per side.
Every frame of 4 pairs over both P3 runs had 20 and 20, and the last frame of each of the 61 delivering pairs in P4 had a median of 20 per side and no empty side.
An own book pushes only the changed levels, and its depth is whatever the REST book holds, which for `BTC_USDT` was 507 to 513 bids and 23 to 28 asks, [`rest.md`](./rest.md) section 5.

### Size unit

Sizes are in the base currency.
On `BTC_USDT` the REST book and the delta-maintained book agreed exactly, and the web client computes `total` as price times amount, S2.
There is no contract size, since this is spot.

### One-sided and empty books

No one-sided or empty book was seen on either topic.

### Idle repeats

A whole book is sent on a fixed 10 s cadence.
No whole book frame equalled the one before it, over 76 frames on 4 pairs in the two P3 runs, because the Binance book it copies moved.
So whether an unchanged book is re-sent is Not verified.
A quiet own book sends nothing: `BTC_USDT` sent 3 delta frames in the first 90 s run and none in the rerun, and in the four batch runs 0, 18, 0 and 50 of the 154 delta topics delivered anything within 45 s.

### Unknown and wrong-kind topics

| request | reply | then |
|---|---|---|
| `orderbook_NOPE_USDT` | SUBACK code 0 | nothing in two 90 s runs |
| `orderBookMatch_NOPE_USDT` | SUBACK code 0 | nothing in two 90 s runs |
| `orderbook_BTC_USDT`, a `liq: 0` pair | SUBACK code 0 | nothing in two 90 s runs |
| `orderBookMatch_ETH_BTC`, a `liq: 1` pair | SUBACK code 0 | nothing in two 90 s runs |
| a JSON text frame instead of an MQTT packet | the server closes the socket with 1006 | |

A delisted pair was not available to probe.
Because every topic is granted, a feed has to notice a topic that never delivers on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | MQTT PINGREQ, the web client's keepalive is 30 s, S2 | PINGRESP in 241 to 825 ms over 10 pings in the two P3 runs |
| silence the server tolerates | Not publicly specified | CONNECT with keepalive 10 s and no PINGREQ: closed with 1006 at 16.07 and 16.05 s. CONNECT with keepalive 0 and a subscription that never delivered: closed with 1006 at 61.2 and 23.1 s. A socket that never sent CONNECT: closed with 1006 at 30.8 s both times. P5, two runs |
| forced disconnect | Not publicly specified | none in 90 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, P6. Payloads are plain JSON |
| framing | MQTT over WebSocket binary frames | MQTT packets span WebSocket frames: in the P3 rerun 1,808 frames carried 366 MQTT packets, and in the P4 rerun 2,740 frames carried 550, so a client must reassemble packets across frames |
| handshake | | 766 to 812 ms to open, once 3,916 ms, and CONNACK 246 to 888 ms after the open |
| subscription limits | Not publicly specified | 431 topics on one socket, all granted |
| throughput | | 215 pairs on one socket, P4: median 12 to 23 messages per second, peak 34 to 45, 13.7 to 16.3 KB per second, and 1.8 to 3.0 KB per message, where a whole book is about 2.9 KB and a delta about 130 bytes, P3 |

## 6. Captured frames

Trimmed, from P3 at 03:23 to 03:25 UTC.
MQTT control packets are shown decoded, and PUBLISH payloads are shown as the JSON they carry.

CONNECT sent, decoded: protocol `MQTT` level 4, clean session, keepalive 30, client id `probe_<8 hex>`, no username or password.
CONNACK received, decoded: return code 0.
SUBSCRIBE sent, decoded: packet id 1, 27 topics at QoS 0.
SUBACK received, decoded: packet id 1, 27 return codes, all 0.
PINGREQ sent every 15 s, PINGRESP received 241 to 255 ms later.

`orderbook_ETH_BTC`, a whole book, first two levels per side kept.

```json
{"status":"1","responseCode":"success","data":{"asks":[{"price":"0.03196000","amount":"33.15424000","total":1.0596095104},{"price":"0.03197000","amount":"18.34976000","total":0.5866418272}],"bids":[{"price":"0.03195000","amount":"46.89240000","total":1.4982121800000001},{"price":"0.03194000","amount":"51.81776000","total":1.6550592544000002}]},"pair_name":"ETH_BTC"}
```

`orderBookMatch_BTC_USDT`, a delta that deletes four asks and sets one bid.

```json
{"type":"l2update","productId":"BTC_USDT","data":{"changes":[["sell","86679.2","0"],["sell","86682.6","0"],["sell","86727.02","0"],["sell","86732.91","0"],["buy","86756.74","0.01004717"]]}}
```

`tradehistory_ETH_BTC`, 30 trades per frame, first two kept.

```json
{"status":"1","teststatus":"3","responseCode":"success","data":[{"price":"0.03195000","amount":0.00264,"isBuyerMaker":false,"datetime":1790133822105,"color_text":"text-danger"},{"price":"0.03195000","amount":1.23264,"isBuyerMaker":false,"datetime":1790133822105,"color_text":"text-danger"}]}
```

`single_ticker_response_ETH_BTC`, a `liq: 1` pair.

```json
{"lastprice":"0.03195000","perchange":"-0.094","volume":"48.96626074","pair_name":"ETH_BTC","high":"0.03209000","low":"0.03170000","quoteVolume":"1.56159453","type":"","price_length":8,"inr_value":"8796588.9156","usdt_value":"86674.44","datetime":1790133839,"open":"0.03198000","close":"0.03195000","quantity":"7.87940000","liq":1}
```

`single_ticker_response_BTC_USDT`, a `liq: 0` pair, whose `datetime` is an ISO string.

```json
{"volume":"30.08141690999862","pair_name":"BTC_USDT","type":"","price_length":2,"inr_value":"101.49000000","usdt_value":"1","datetime":"2026-09-23T03:24:10.000Z","open":"86593.84000000","liq":0,"quantity":0,"lastprice":"86756.74","close":"86756.74","perchange":"1.5268688854561685","high":"86757.93","low":"85138.55","quoteVolume":"2609765.6656923536"}
```

No error frame exists.
A malformed request ends in a socket close with 1006, and an unknown topic is granted and silent.

## 7. Private channels

Named from the web client, S2, not probed.
The client subscribes `userBalance_<id>`, `openorder_<id>`, `openorder_<id>_buy`, `openorder_<id>_sell`, `comporderData_<id>`, `comporderData_<id>_buy` and `comporderData_<id>_sell` on the same socket, where the id is the logged in user's id.
Orders are placed through the site's backend, `order/place_order` and `order/cancel_order`, and not over the socket, S2.
The probe never subscribed to any of these topics, and never to a wildcard.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Koinpark lists no perpetual, so this is the shape a spot feed would take.
It is not recommended for the engine, which trades perpetuals, and the last rows and [`fees.md`](./fees.md) section 1 give further reasons, among them Terms that prohibit scraper bots and unauthorized algorithmic scripts.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://konprklvewebsktwss.koinpark.com` | one socket carried 431 topics |
| protocol | MQTT 3.1.1: CONNECT, then one SUBSCRIBE listing every topic at QoS 0 | the server closes a socket that sends JSON |
| topics | `orderBookMatch_<pair>` for `liq: 0` pairs, seeded and reseeded from the REST book | the only topics that carry Koinpark's own book |
| markets per connection | all 154 own-book pairs | 431 topics were granted on one socket |
| keepalive | CONNECT keepalive 30, PINGREQ every 15 s | the broker closes at one and a half keepalives without a ping |
| `maxSilenceMs` | 45,000, with PINGRESP counted as traffic | an own book sent nothing for 90 s in the P3 rerun |
| resync | a REST book per pair on every reconnect, and no periodic reseed beyond what the budget allows | there is no sequence, and the REST budget of 1,440 requests a day covers 215 pairs about 6 times a day |
| engine change | `VenueFeed` sends every subscribe frame through `JSON.stringify` at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 143, 152 and 161, so a Koinpark feed needs a path that sends binary packets and reassembles MQTT packets across frames | the server accepts only MQTT |
| `liq: 1` pairs | do not treat as a venue book | they are Binance's book at 0.8 times the size, up to 10 s old |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Koinpark Market REST API Documentation | https://www.koinpark.com/api | 2026-09-23 03:14 UTC | Koinpark | REST calls only, no WebSocket documented |
| S2 | Koinpark trade page script bundle, chunks `0qzi67vkv4oc-.js` and `0ynbksm2cfg5e.js` | https://www.koinpark.com/trade/BTC-USDT | 2026-09-23 03:17 UTC | Koinpark | socket URL, MQTT options, topic names, `liq` routing, merge rules, backend call names, sections 1, 2, 4 and 7 |
| P3 | `ws-probe.mjs book` at 03:23 UTC and rerun at 03:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinpark/ws-probe.mjs) | 2026-09-23 | this host | topics, cadence, Binance comparison, REST seed and deltas, frames, sections 1 to 6 |
| P4 | `ws-probe.mjs batch` at 03:20, 03:21, 03:28 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinpark/ws-probe.mjs) | 2026-09-23 | this host | 215 pairs on one socket, which topics deliver, throughput, sections 2, 3 and 5 |
| P5 | `ws-probe.mjs silence` at 03:29 and 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinpark/ws-probe.mjs) | 2026-09-23 | this host | keepalive and silence, section 5 |
| P6 | `ws-probe.mjs deflate` at 03:18 and 03:41 UTC, and `engineway` at 03:32 and 03:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/koinpark/ws-probe.mjs) | 2026-09-23 | this host | no deflate, no subprotocol needed, JSON refused, sections 1, 3 and 5 |
