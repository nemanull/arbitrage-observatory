# bitcastle WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:22 to 04:50 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public market data socket of bitcastle for its one perpetual family, USDT-M, with the book topic in detail.
The socket speaks MQTT 3.1.1 inside WebSocket binary frames, not JSON commands.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitcastle/ws-probe.mjs), which builds the MQTT packets by hand, and the capture is quoted beside the documented value.
The public API reference S1 documents the socket and three spot topics only.
The futures topic names come from the web app's runtime config S2 and its bundle S3, so every futures topic here is undocumented.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| every family, spot and futures | `wss://socket.bitcastle.io/mqtt`, S1, and `wss://socket.bitcastle.io:443/mqtt` in S2 | opened in 652 to 746 ms, CONNACK `0000` 905 to 1,418 ms after the socket was created |
| raw MQTT | `mqtt.bitcastle.io`, S1 | TCP 1883 accepted a connection, 8883 did not connect in 5 s, nothing further sent |

One socket carries every topic, spot and futures alike.
`socket.bitcastle.io` resolved to the same three addresses as `api.bitcastle.io`, all in AWS ap-southeast-1, see [`rest.md`](./rest.md) section 1.
The engine opens sockets with no subprotocol at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81, and this server answers such a handshake with HTTP 400, so the subprotocol `mqtt` is mandatory.
The engine also sends every subscribe frame through `JSON.stringify`, at lines 143, 152 and 161, and this socket needs binary MQTT packets.

## 2. Channel matrix for public market data

MQTT topics, subscribed at QoS 0.

| topic | payload | cadence probed on 2026-09-23 |
|---|---|---|
| `public/futures/orderbook/{coin}/{currency}/{precision}` | a whole book, up to 100 levels per side | one frame per pair, median gap 996 to 1,008 ms |
| `public/futures/markprice_update` | `[{symbol, mark_price}]` for 127 symbols | one frame every 4,808 to 5,212 ms |
| `public/futures/lastprice_update` | `[{symbol, last_price}]` for 127 symbols | median gap 999 or 1,000 ms, single gaps 73 to 1,974 ms |
| `public/futures/ticker_24h` | one pair's 24 h ticker per frame, without a mark | 20 to 21.6 frames per second over all pairs |
| `public/futures/market_trade/{coin}/{currency}` | one trade | trades 4,983 to 5,051 ms apart on `btc/usdt`, by `create_time` |
| `public/futures/funding_rate` | not seen | 0 frames in 70 s |
| `public/setting/update_futures_pair_category` | not seen | 0 frames in 70 s |
| `public/exchange/update_orderbook/{coin}/{currency}/{precision}` and the other spot topics | documented in S1 | spot, named only |

No index topic, best bid and ask topic or delta book topic exists in S2 or S3.
The mark and last price lists hold 127 symbols while the catalog holds 119, so a few delisted symbols such as `matic/usdt` are still published.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S1 | spot and futures topics delivered on one socket |
| subscribe frame shape | "Data format must using MQTT package structure", S1 | one MQTT SUBSCRIBE packet carried ten topic filters and was acknowledged by one SUBACK |
| unknown symbol expectation | Not publicly specified | `public/futures/orderbook/nope/usdt/0.1` got return code `00` and no frame in 70 s |
| chunk unit and budget | Not publicly specified | 119 book topics in one SUBSCRIBE, all acknowledged, all delivering. The wildcard filter `public/futures/orderbook/#` was also granted and delivered all 119 |
| keepalive mechanism | MQTT keepalive, S1 by reference to the MQTT spec. The web client connects with `keepalive: 0`, S3 | PINGREQ every 20 s under a 30 s keepalive got PINGRESP in 217 to 458 ms |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 120 s on a socket that had traffic, and no notice seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 119 topics in one packet |
| public market data authentication | none, S1 | CONNACK `0000` for a CONNECT with no username or password |
| message parse and routing | MQTT PUBLISH, the topic names the stream, S1 | one MQTT packet per WebSocket message on 1,778 and 1,780 messages in two runs, route on the topic |
| subscribe acknowledgement shape | MQTT SUBACK | `90` packet with the packet id and one return code per filter, always `00` in every run |
| symbol identifier format | `{coin}/{currency}` in lower case, S1 | `btc/usdt` in topics and in `symbol` fields, never the web route's `BTC_USDT` |
| number representation | strings, S1 | prices and sizes are strings. The book pads sizes to `ob_amount_scale`, as in `"0.32800"`, and trades carry 18 decimals |
| timestamp representation | `last_update` in ms, S1 | `last_update` is a string of ms on futures topics, and the spot example shows a number |
| size unit | Not publicly specified | base coin, see section 4 |
| sequence semantics | none | no sequence, update id or checksum on any topic |
| idle repeat behaviour | Not publicly specified | the book is resent whole every second, and 10 to 35 of about 70 frames on `pi/usdt` and `layer/usdt` equalled the previous frame over three runs |

## 4. The book topic in detail

### Snapshot on subscribe

Every frame is a whole book, and there are no deltas.
The first frame came 279 to 1,213 ms after the SUBSCRIBE packet was sent, and one frame followed about every second.
The median gap was 996 to 1,008 ms on four pairs in two runs, and single gaps ran from 555 to 1,272 ms in the first run and from 37 to 2,100 ms in the second.
A feed would call `resetBook` on every frame.

The topic's last segment is the price precision, and only the pair's `ob_default_price_scale` works, spelled as a decimal: `0.1` for scale 1, `0.0001` for scale 4.
`public/futures/orderbook/btc/usdt/1` and `/0.01` were acknowledged and never delivered.
Every catalog row lists exactly one scale in `ob_list_price_scale`, see [`rest.md`](./rest.md) section 2.

### Sequence, gaps and checksum

There is no sequence field and no checksum.
The frame carries `last_update`, `data.coin`, `data.currency`, `data.precision` and `data.orderbook` with `asks` and `bids` arrays of `{price, amount}`.
Since each frame replaces the book, a lost frame costs one second of staleness and nothing else.

### Level order on the wire

| pair and source | bids best first, runs 2 and 3 | asks best first, runs 2 and 3 | other |
|---|---|---|---|
| `btc/usdt`, Bybit | 69 of 70, 63 of 70 | 66 of 70 with 2 empty, 70 of 70 | no duplicate price |
| `eth/usdt`, Bybit | 39 of 70, 17 of 69 | 38 of 70, 27 of 69 | a bid below the best, such as `2784.04` for 16 ETH, sits at the head of the list |
| `pi/usdt`, MEXC | 0 of 70, 0 of 71 | 0 of 70, 0 of 71 | duplicate prices on every frame, and levels far from the market |
| `layer/usdt`, Binance | 0 of 70, 0 of 70 | 0 of 70, 0 of 70 | duplicate prices on every frame |

A feed has to sort by price and merge equal prices.
On `layer/usdt` Binance quotes five decimals, such as `0.07964`, and bitcastle cuts them to the 0.0001 precision without merging, so ten bids in a row read `0.0795`.
On `pi/usdt` the captured frame put bids from `0.0108` to `0.0842` and asks from `0.1955` to `5.0000` first, in ascending order of size, while the REST book's last price read `0.0915` three minutes later.

### The book is a thinned copy of the source venue's book

Each catalog row names a `target`: 109 Bybit, 7 MEXC and 3 Binance, see [`rest.md`](./rest.md) section 2.
The probe held Bybit's `orderbook.1` and `orderbook.200` streams for BTCUSDT and ETHUSDT beside the bitcastle topics and compared every bitcastle frame on arrival.

| measure, about 70 frames per pair per run | `btc/usdt`, runs 2 and 3 | `eth/usdt`, runs 2 and 3 |
|---|---|---|
| top 20 bitcastle levels whose price is on Bybit's book at the matched instant | median 100 % and 97.5 %, minimum 45 % and 80 % | median 100 % and 100 %, minimum 80 % and 85 % |
| of those, size equal to Bybit's | median 90 % and 85 % | median 87.5 % and 95 % |
| Bybit's top 20 bids that bitcastle shows | median 15 % and 15 %, maximum 40 % and 65 % | median 20 % and 30 %, maximum 65 % and 70 % |
| Bybit bid rank of bitcastle's 20th best bid | median 57 and 68, up to 182 and 127 | median 51 and 42, up to 125 and 88 |
| frames whose best bid and ask, with sizes, equal a Bybit state | 24 of 70 and 35 of 70 | 15 of 70 and 28 of 69 |
| how long before arrival that Bybit state began | 66 to 295 ms, median 144 ms, and 82 to 1,271 ms, median 195 ms | 50 to 281 ms, median 157 ms, and 51 to 1,246 ms, median 162 ms |
| bitcastle spread, run 3 | median 13 ppm, p90 179 ppm, maximum 231 ppm | median 58 ppm, p90 191 ppm, maximum 291 ppm |
| Bybit spread at the same arrivals, run 3 | median 1 ppm, maximum 3 ppm | 4 ppm on every frame |
| bitcastle best bid below Bybit's, run 3 | median 0 ppm, p90 143 ppm, maximum 218 ppm | median 0 ppm, p90 180 ppm, maximum 288 ppm |
| frames with no ask side | 2 and 0 | 0 and 0 |

Run 2 started at 04:25 UTC and run 3 at 04:45 UTC.
Run 1 at 04:22 UTC took the first array entry as the best level, a probe bug fixed before run 2, so its comparison is left out.

So bitcastle republishes a sample of Bybit's levels, keeps Bybit's sizes on most of them, drops most of the levels near the touch, and does so once a second, 144 to 195 ms after Bybit at the median.
The REST book shows the same thing, with 98 of 106 and 140 of 145 BTC levels priced on Bybit's book fetched at the same moment, see [`rest.md`](./rest.md) section 5.
Dropping levels near the touch made bitcastle's spread wider than Bybit's on most frames, up to 291 ppm where Bybit's stayed at 1 to 4 ppm, and a one-sided second was seen twice in 140 `btc/usdt` frames.
An arbitrage engine would read those gaps as crosses against Bybit that do not exist.

### Size unit

`amount` is in the base coin.
`btc/usdt` levels read sizes such as `"0.32800"` at a price where Bybit, whose linear size unit is BTC, showed `"0.328"`.
CCXT has no class, so there is no `contractSize` to compare, and a feed would use a size multiplier of 1.

### One-sided and empty books

`btc/usdt` sent 2 frames with an empty ask side in 70 in run 2, and a book of 27 bids at its thinnest.
In the two batch runs every one of 14,280 frames had both sides, with 16 to 100 levels on the thinner side.
An unknown pair is acknowledged and silent on the socket, and returns an empty book with status 200 on REST.

### Server timestamp

`last_update` was 108 to 1,300 ms older than the arrival time on the four pairs, with a median of 111 to 120 ms.
The REST body timestamp read within 6 ms of the local clock, so that age is transit and not clock skew, see [`rest.md`](./rest.md) section 7.
The tail above 300 ms came in run 3, together with the widest frame gaps, and whether it was the server or this host's network is not known.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | MQTT PINGREQ and PINGRESP under the CONNECT keepalive | PINGRESP in 217 to 458 ms |
| silence the server tolerates | Not publicly specified | the same in two runs. Keepalive 30 with no PINGREQ: closed at 45.91 s with 1005, which is 1.5 times the keepalive. Keepalive 0, no topic, nothing sent: closed at 60.67 and 60.69 s with 1006 and no close frame. Keepalive 0 with the mark topic, one frame per 5 s: open at 120 s. Keepalive 30 with PINGREQ every 20 s: open at 120 s |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | the server did not accept an offered permessage-deflate. MQTT payloads are plain JSON text |
| handshake | subprotocol `mqtt` | 652 to 746 ms to open. Without the subprotocol the upgrade answered HTTP 400 in both runs. A text frame of JSON instead of an MQTT packet closed the socket with 1000 |
| subscription limits | Not publicly specified | 119 book topics plus a wildcard on another socket, no refusal |
| throughput | | 119 book topics on one socket for 60 s, two runs: 119 frames per second, 840.4 and 843.5 KB per second, 7,231 and 7,258 bytes per frame, 124.5 and 106.8 µs `JSON.parse` per frame. The wildcard filter delivered 1,778 and 1,785 frames in 15 s |

At 119 frames per second and 106.8 to 124.5 µs each, parsing the whole catalog costs 13 to 15 ms of every second, because each frame is a book of up to 100 levels per side.

## 6. Captured frames

Trimmed, from the book run of 04:25 UTC on 2026-09-23, except the control packets, which every run returned alike.
MQTT control packets are shown in hex.

CONNACK, session present 0, return code 0.

```text
20 02 00 00
```

SUBACK for packet id 1 and ten filters, every one granted at QoS 0.

```text
90 0c 00 01 00 00 00 00 00 00 00 00 00 00
```

Book on `public/futures/orderbook/btc/usdt/0.1`, first three levels per side kept.

```json
{"last_update":"1790137532330","data":{"orderbook":{"asks":[{"price":"87155.6","amount":"1.00100"},{"price":"87156.7","amount":"0.70900"},{"price":"87156.8","amount":"0.82100"}],"bids":[{"price":"87142.6","amount":"1.03900"},{"price":"87142.1","amount":"0.30600"},{"price":"87141.8","amount":"0.55000"}]},"coin":"btc","currency":"usdt","precision":"0.1"}}
```

Book on `public/futures/orderbook/eth/usdt/0.01`, whose first bid is not the best.

```json
{"last_update":"1790137542045","data":{"orderbook":{"asks":[{"price":"2785.66","amount":"9.2500"},{"price":"2785.77","amount":"0.3700"},{"price":"2785.78","amount":"4.8600"}],"bids":[{"price":"2784.04","amount":"16.0000"},{"price":"2785.65","amount":"33.7400"},{"price":"2785.58","amount":"0.0500"},{"price":"2785.57","amount":"3.5600"}]},"coin":"eth","currency":"usdt","precision":"0.01"}}
```

Book on `public/futures/orderbook/pi/usdt/0.0001`, levels ordered by size and far from the mark.

```json
{"last_update":"1790137542133","data":{"orderbook":{"asks":[{"price":"3.9000","amount":"2.000"},{"price":"3.5000","amount":"3.000"},{"price":"5.0000","amount":"4.000"},{"price":"3.6000","amount":"5.000"}],"bids":[{"price":"0.0108","amount":"1.000"},{"price":"0.0214","amount":"2.000"},{"price":"0.0605","amount":"8.000"},{"price":"0.0505","amount":"9.000"}]},"coin":"pi","currency":"usdt","precision":"0.0001"}}
```

Book on `public/futures/orderbook/layer/usdt/0.0001`, with repeated prices.

```json
{"last_update":"1790137542175","data":{"orderbook":{"asks":[{"price":"0.0797","amount":"596.60"},{"price":"0.0797","amount":"2693.10"},{"price":"0.0797","amount":"2143.30"}],"bids":[{"price":"0.0796","amount":"67.90"},{"price":"0.0795","amount":"1055.90"},{"price":"0.0795","amount":"1523.40"},{"price":"0.0795","amount":"1093.40"}]},"coin":"layer","currency":"usdt","precision":"0.0001"}}
```

Mark, two of 127 rows.

```json
{"last_update":"1790137532712","data":[{"symbol":"bnb/usdt","mark_price":"797.5"},{"symbol":"eth/usdt","mark_price":"2786"}]}
```

Last price, two of 127 rows.

```json
{"last_update":"1790137532425","data":[{"symbol":"btc/usdt","last_price":"87155.300000000000000000"},{"symbol":"eth/usdt","last_price":"2785.940000000000000000"}]}
```

Ticker, one row per frame.

```json
{"last_update":"1790137531975","data":[{"coin":"fet","currency":"usdt","amount":"38323110","total":"7914730.574","high":"0.213400000000000000","low":"0.197100000000000000","price":"0.211100000000000000","price_change":"0.0097","price_percentage":"4.816285998013902681"}]}
```

Trade.

```json
{"last_update":"1790137534845","data":{"id":"1181510314","price":"87105.700000000000000000","gross_amount":"0.013000000000000000","create_time":"1790137534752","coin":"btc","currency":"usdt","order_type":1}}
```

Keepalive, PINGREQ and PINGRESP.

```text
c0 00
d0 00
```

No error packet exists in MQTT 3.1.1 for a topic that will never publish, and every bad filter the probe sent was granted.

## 7. Private channels

Named from S2 for a future execution stage, not probed.

- Futures: `private/user/futures/order`, `private/user/futures/position`, `private/user/futures/trigger_price`, `private/user/futures/user_settings`, `private/user/futures/error` and `private/user/futures/order_trigger_price`, each followed by `/{userId}` in S3.
- Spot: `private/user/exchange/update_order`, `private/user/exchange/update_trade_history` and `private/user/exchange/update_favorite`.

The web client connects with no credentials and subscribes these topics by user id, S3.
The first two runs of the probe sent one filter of this shape, `private/user/futures/order/1`, among its error cases.
It was granted with return code `00` and delivered nothing in 70 s.
The probe no longer sends it, since the survey subscribes no private channel.

## 8. Recommended feed shape

A description for a later design, not a recommendation to build it.
[`fees.md`](./fees.md) section 9 and [`rest.md`](./rest.md) section 8 explain why the venue should not join.

| item | what a feed would need | reason |
|---|---|---|
| VenueFeed change | a subprotocol argument and binary frames, or a subclass that owns its socket | the handshake needs `mqtt`, and CONNECT and SUBSCRIBE are binary |
| URL plan | one socket, `wss://socket.bitcastle.io/mqtt` | one socket carried 119 topics |
| CONNECT | clean session, a random client id, keepalive 30 | the web client uses keepalive 0, and an idle keepalive 0 socket died at 60.7 s |
| subscribe | one SUBSCRIBE with `public/futures/orderbook/{coin}/usdt/{precision}` per market, precision from `ob_default_price_scale` | any other precision is acknowledged and silent |
| keepalive | PINGREQ every 20 s | PINGRESP counts as traffic, and it kept an idle socket open for 120 s |
| `maxSilenceMs` | 5,000 | a book arrives every second on every pair, so five missed frames is a dead stream |
| routing | the topic's third and fourth segments give coin and currency | |
| every frame | sort each side by price, merge equal prices, `resetBook`, `publish` | whole book, unsorted, duplicated prices |
| resync | none needed, the next frame replaces the book | no sequence |
| unserved stream | log a topic with no frame 3 s after its SUBACK | unknown and wrong precision topics are granted and silent |
| receive time | stamp on arrival | |
| deflate | keep it off | not negotiated |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | bitcastle API docs 1.0.0, section Websocket | https://developer.bitcastle.io/document | 2026-09-22 | bitcastle | URLs, MQTT framing, three spot topics and their payloads |
| S2 | web app runtime config, `SOCKET_MQTT_URL` and `SOCKET_MQTT_TOPIC` | https://bitcastle.io/config.json | 2026-09-22 | bitcastle | futures topic names, private topic names |
| S3 | web app bundle `app.d64a015.js` | https://bitcastle.io/_nuxt/app.d64a015.js | 2026-09-22 | bitcastle | `connectMqtt` with `keepalive: 0`, `subscribeTopic` at QoS 0, topic suffixes `/{coin}/{currency}/{precision}` and `/{userId}` |
| P1 | `ws-probe.mjs book`, three runs at 04:22, 04:25 and 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitcastle/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 4 and 6 |
| P2 | `ws-probe.mjs batch` at 04:30 and 04:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitcastle/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 5 |
| P3 | `ws-probe.mjs silence` at 04:31 and 04:47 UTC, `deflate` at 04:33 and 04:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitcastle/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
