# Digitalexchange.id WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:40 to 05:25 UTC), from the development host near Seattle, through its Surfshark WireGuard exit that Cloudflare geolocates to Canada (`loc=CA`).

Digitalexchange.id publishes no WebSocket API and no API documentation of any kind.
What exists is the Socket.IO feed that its own web trading page reads, and this profile describes that feed from the page's script and from [`ws-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/ws-probe.mjs).
The venue lists no perpetual, so the book channel below is the spot book, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every documented value in the tables is what the page's script does, cited as S1 or S2, because no other documentation exists.

## 1. Endpoints

| host | what the web page reads from it | probed |
|---|---|---|
| `wss://socket-market.digitalexchange.id/socket.io/?EIO=4&transport=websocket` | `tradedata-<PAIR>@depth` for the 89 listed pairs in the page's `integrasi` list, S1 | open in 613 to 804 ms, books deliver |
| `wss://socket.digitalexchange.id/socket.io/?EIO=4&transport=websocket` | ticker, trades, chat and the market summary, and `@depth` for the two pairs outside `integrasi`, S1 and S2 | open in 627 to 743 ms, the same `integrasi` books deliver here too |

Both hosts sit behind Cloudflare on the same two addresses as `digitalexchange.id`, see [`rest.md`](./rest.md) section 1.
The server is Socket.IO 3, since both hosts serve the Socket.IO v3.1.2 client at `/socket.io/socket.io.js`, and it speaks Engine.IO protocol 4.
The long polling transport is refused: `GET /socket.io/?EIO=4&transport=polling` answered 400 `{"code":0,"message":"Transport unknown"}` on both hosts, and so did `EIO=3`, P5.
The page passes an `extraHeaders` entry `"socket-digitalexchange": "10d8b60322a6bd5b"` to the client, S1, but a browser cannot set headers on a WebSocket, so the page never sends it.
The probe sent no header and no cookie, and both hosts served it.
There is one market family, spot IDR, so no socket split by family exists.

## 2. Channel matrix for public market data

| event | how to get it | cadence | probed |
|---|---|---|---|
| `tradedata-<PAIR>@depth` | subscribe `guest.tradedata-<PAIR>@graph` for an `integrasi` pair | a whole book about every 2 s | 25 or 26 levels a side on liquid pairs, section 4 |
| `tradedata-<PAIR>@depth` for DCTIDR and VEXIDR | subscribe `guest.tradedata-<PAIR>` on the main host, S2 | on change, by inference | nothing in 30 to 45 s on DCTIDR in four runs, while its REST book held 10 bids and 25 asks |
| `tradedata-<PAIR>@ticker` | same subscription | about every 5 s, and 1 to 10 s apart on USDTIDR | `c`, `lp`, `b`, `a`, `h`, `l`, `S`, `P`, `v`, section 6 |
| `tradedata-market` | none needed, every connected socket gets it, though the home page subscribes `guest.tradedata-market`, S3 | every 5 s | bid, ask, last, high, low and volume of all 91 listed pairs in one frame of 14,952 to 16,078 bytes |
| `tradedata-<PAIR>` | same subscription | on trade, by the page's handler | not seen, trades are rare, see [`rest.md`](./rest.md) section 5 |
| `chatroom`, `marketsummary` | the page listens for both | | not seen in any run |

No mark, index or funding event exists, because the venue has no derivative.
`tradedata-market` is a bulk best bid and ask feed for every pair at once, but its 5 s cadence is slower than the depth event.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is the web page's script, because the venue documents nothing.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | two hosts by data kind, depth on `socket-market`, the rest on `socket`, S1 | the main host also serves `integrasi` depth, with the same frame count, sizes and touches as `socket-market` in three runs |
| subscribe frame shape | `socket.emit('subscribe', 'guest.tradedata-BTCIDR@graph')`, one string, S1 | on the wire `42["subscribe","guest.tradedata-BTCIDR@graph"]` after the namespace join `40` |
| unknown symbol expectation | Not publicly specified | `guest.tradedata-NOPEIDR@graph` gets no error and no frame, only the market summary |
| chunk unit and budget | one pair per socket, S1 | a second subscribe on the same socket, sent 5 s after the first, is ignored: DOGEIDR delivered 36 frames and SOLIDR none, in three runs. Ten sockets from this host opened and all delivered |
| keepalive mechanism | Engine.IO: the server sends `2` every `pingInterval`, the client answers `3` | handshake `"pingInterval":25000,"pingTimeout":5000`. A joined socket that did not answer was closed 30.6 s after opening, 5 s after the first ping, in both runs |
| connection lifetime and maintenance notice | Not publicly specified | none seen in 55 s |
| handshake and operation rate limits | Not publicly specified | ten sockets opened in one burst, 613 to 726 ms each over two runs, none refused |
| public market data authentication | none, the room prefix is `guest.` | none, no header, cookie or token sent |
| message parse and routing | Socket.IO event arrays, `42["<event>", <payload>]` | route on the event name, `tradedata-BTCIDR@depth` |
| subscribe acknowledgement shape | none | no acknowledgement. The first depth frame came 305 to 2,637 ms after the subscribe |
| symbol identifier format | `BTCIDR`, base and quote run together in capitals, S1 | same in every event name. No CCXT `market.id` exists to compare with |
| number representation | the page parses `total` by removing `.` and swapping `,` for `.`, S1 | depth prices, amounts and totals are strings formatted the Indonesian way, `"1.551.234.578"` and `"0,07548"`. Ticker and summary values are JSON numbers or plain strings, and PEPE's bid arrived as `0.08971000000000001` |
| timestamp representation | none | no depth, ticker or summary frame carries a timestamp, so receive time is the only clock |
| size unit | `amount` in the base asset and `total` in IDR, S1 | `amount` is base units, and it is rounded for display: USDTIDR sizes carry one decimal on the socket and two on REST |
| sequence semantics | none | no sequence, update id or checksum in any frame. Every depth frame is a whole book |
| idle repeat behaviour | Not publicly specified | every refresh sends the previous book again and then the new one a few ms later, so about half the frames repeat the one before |

## 4. The book channel in detail

### Snapshot on subscribe

Every depth frame is a whole book, `{"ask": [...], "bid": [...]}`, and there is no delta form.
The first frame came 305 to 2,637 ms after the subscribe frame on the `integrasi` pairs in three book runs, P1.
A feed would call `resetBook` on every frame.

### Refresh cadence and repeats

A new book arrives about every 2 s, and each refresh is two frames a few ms apart, P1.
The first of the two repeats the book already sent, byte for byte, and the second is new.
On BTCIDR the gaps alternated between 5 to 17 ms and 1,972 to 2,001 ms in the first two runs, and 17 of 36, 16 of 34 and 17 of 36 frames were identical to the frame before in three runs.
In the second and third runs, new books on BTCIDR, PEPEIDR and DOGEIDR came 1,889 to 2,111 ms apart.
The batch runs saw 16 to 26 depth frames per pair in 25 s on ten pairs, of which 7 to 12 per pair repeated the previous frame, P2.
USDTIDR was slower and irregular, with new books 868 to 9,012 ms apart.

### Sequence and gap rule

None.
No frame carries an update id, a sequence number or a timestamp, so a lost or late frame cannot be detected, and the next whole book simply replaces it.

### Checksum

None is sent.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket `@depth` | best first, descending, on every frame of every pair probed | best first, ascending, on every frame |
| REST `/api/<pair>/depth` | descending | ascending |

### Level window

Liquid pairs carried 25 or 26 levels a side, which covers the engine's 20.
Thinner pairs carried fewer: DOGEIDR 13 to 22 and HBARIDR 15 to 19 levels a side at most, P1 and P2.

### Size unit against CCXT `contractSize`

No CCXT class exists, so there is no `contractSize` to compare.
`amount` is in the base asset, so 1 unit is 1 BTC on BTCIDR and 1 PEPE on PEPEIDR.
`total` is the IDR value, and it is computed from the unrounded amount: USDTIDR `"amount":"5,8"` at `"price":"17.863"` carried `"total":"102.712"`, which is 5.75 USDT, so the socket amount is display rounded, P1.
The REST book read 84 ms from a socket frame gave USDTIDR sizes to two decimals and the socket to one, `2257.11` against `"2.257,1"` at the same 17,819 bid, P1.
On BTCIDR the socket and REST books matched in price and size at 541, 497 and 309 ms apart in three runs, both carrying five decimals, and every REST price on each side was also on the socket book, P1.

### One-sided, locked and crossed books

No empty side was seen on the ten liquid pairs.
Locked touches, where the best bid equals the best ask, are frequent: 19, 9 and 11 of 34 PEPEIDR frames and 26, 9 and 17 of 36 DOGEIDR frames were locked in three book runs, P1.
The REST ticker was locked on 18 and 21 of 91 pairs in two reads, see [`rest.md`](./rest.md) section 2.
Crossed books, with the best bid above the best ask, reach the socket too.
BTCIDR was crossed in 0 of 36, 25 of 34 and 32 of 36 frames in three runs, and DOGEIDR in 14 of 36 frames in the third, P1.
The last crossed BTCIDR frame of the second run held a bid of 1,547,440,508 against an ask of 1,547,206,260, crossed by 151 ppm.
That bid is Binance's BTCUSDT price 86,934.86 times 17,800, which the `mirror` run read as Binance's bid two minutes earlier, and the ask is 86,921.70 times 17,800.
No Binance book has its bid above its ask, so the two sides were converted from different moments, and one was stale.
The `integrasi` books are Binance books scaled by a rate near 17,800 IDR per USDT, see [`rest.md`](./rest.md) section 4.
Why touches lock or cross is Not publicly specified.
A crossed touch here is not a trade anyone can take.

### Unknown, closed and wrong-form symbols

| request | reply |
|---|---|
| `guest.tradedata-NOPEIDR@graph` | nothing, no error |
| `guest.tradedata-ETHIDR`, an `integrasi` pair without `@graph` | no depth in 35 s, in three runs |
| `guest.tradedata-DCTIDR`, a pair outside `integrasi`, on either host | no depth in 30 to 45 s, in four runs |
| a second subscribe on a socket that already subscribed | ignored |

A feed therefore has to notice on its own a pair that never delivers.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Engine.IO ping `2` from the server every 25 s, pong `3` from the client | a socket that answered stayed 55 s through two pings. One that did not answer closed at 30.6 s with code 1005, in both runs |
| silence the server tolerates | `pingInterval` plus `pingTimeout`, 30 s | as documented, P3. A socket that completed the Engine.IO handshake but never joined the namespace was closed at 45.6 and 45.7 s, which matches Socket.IO's default `connectTimeout` of 45 s |
| forced disconnect | Not publicly specified | none in 55 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text frames only. An offer of permessage-deflate got no `sec-websocket-extensions` header back from either host, P4 |
| handshake | Engine.IO `0{"sid":…,"upgrades":[],"pingInterval":25000,"pingTimeout":5000}`, then the client sends `40` | 613 to 804 ms to open, and the namespace join answered about 200 ms later |
| subscription limits | one pair per socket, S1 | confirmed by the ignored second subscribe. Ten sockets at once were served |
| throughput | | ten liquid pairs on ten sockets: 12.9 and 12.5 events per second, 57.5 and 50.7 KB per second, 62 and 58 µs `JSON.parse` per event, in two runs, P2 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays are cut to the first levels shown.

Engine.IO handshake from the server, and the namespace join answer.

```text
0{"sid":"N_YAy_D4dXtgOkNjIsPb","upgrades":[],"pingInterval":25000,"pingTimeout":5000}
40{"sid":"yrQibmiKrfCqU-uLIsPj"}
```

Subscribe, sent by the client after the join.

```text
42["subscribe","guest.tradedata-BTCIDR@graph"]
```

Depth, a whole book, first three levels a side kept of 26 asks and 25 bids.

```json
["tradedata-BTCIDR@depth",{"ask":[{"amount":"0,07548","price":"1.551.234.578","total":"117.087.185"},{"amount":"0,00014","price":"1.551.259.320","total":"217.176"},{"amount":"0,02350","price":"1.551.270.178","total":"36.454.849"}],"bid":[{"amount":"6,30863","price":"1.551.234.400","total":"9.786.163.872"},{"amount":"0,00012","price":"1.551.234.222","total":"186.148"},{"amount":"0,00206","price":"1.551.222.652","total":"3.195.518"}]}]
```

Depth with a locked touch, PEPE at 0.08971 IDR on both sides.

```json
["tradedata-PEPEIDR@depth",{"ask":[{"amount":"2.216.897.822","price":"0,08971","total":"198.882.337"},{"amount":"18.699.273.081","price":"0,09025","total":"1.687.534.598"}],"bid":[{"amount":"10.320.793.825","price":"0,08971","total":"925.899.055"},{"amount":"26.191.205.934","price":"0,08918","total":"2.335.679.362"}]}]
```

Depth with a crossed touch, from the rerun, bid 1,547,440,508 above ask 1,547,206,260.

```json
["tradedata-BTCIDR@depth",{"ask":[{"amount":"3,40508","price":"1.547.206.260","total":"5.268.361.091"},{"amount":"0,02304","price":"1.547.211.778","total":"35.647.759"}],"bid":[{"amount":"8,18596","price":"1.547.440.508","total":"12.667.286.100"},{"amount":"0,00012","price":"1.547.440.330","total":"185.692"}]}]
```

Depth with sizes rounded to one decimal.

```json
["tradedata-USDTIDR@depth",{"ask":[{"amount":"10.247,3","price":"17.819","total":"182.596.460"},{"amount":"34.786,9","price":"17.820","total":"619.902.023"}],"bid":[{"amount":"5.142,2","price":"17.818","total":"91.623.006"},{"amount":"1.000,0","price":"17.817","total":"17.817.000"}]}]
```

Ticker.

```json
["tradedata-BTCIDR@ticker",{"c":1551234400,"lp":"1.942","b":1551234400,"a":1551234578,"h":1553558012,"l":1515029200,"S":"BTC","P":"IDR","v":10637521}]
```

Market summary, two of the pairs kept, showing that one frame mixes numbers and strings.

```json
["tradedata-market",{"DOGEIDR":{"symbol":"DOGE","pair":"IDR","decimal_market":false,"last_percentage":3.016,"last":1848,"bid":1848,"ask":1848,"high":1857,"low":1729,"vol":406419,"int":1,"beta":0},"GALAIDR":{"last_percentage":"3.172","last":"38","ask":"38","bid":"38","high":"38","low":"36","vol":"0","int":"1","beta":"0"}}]
```

Keepalive, server ping and client pong.

```text
2
3
```

Refusal of the polling transport, over HTTPS.

```json
{"code":0,"message":"Transport unknown"}
```

No error frame exists for a bad subscription, which is answered with silence.

## 7. Private channels

The guest page shows no private channel name, S1.
A logged in page presumably subscribes with a prefix other than `guest.`, which was not probed.
A commented out Pusher client in the page names `https://digitalexchange.id/websocket/auth` as its auth endpoint, S1, so an older private feed existed.

## 8. Recommended feed shape

None for the engine, because the venue has no perpetual and no CCXT class.

For the record, a spot feed of this venue would look like this, and it would be weak.

| item | shape | reason |
|---|---|---|
| URL plan | `socket-market` for the 89 `integrasi` pairs, the main host for DCTIDR and VEXIDR | where the page reads each book |
| markets per connection | 1 | a second subscribe is ignored |
| subscribe frames | `40`, then `42["subscribe","guest.tradedata-<PAIR>@graph"]` | the page's form |
| keepalive | answer every `2` with `3` | Engine.IO closes a silent client at 30 s |
| `maxSilenceMs` | 15,000 | a book arrives every 2 s on a liquid pair, but USDTIDR went 9 s without a new book, and the market summary also arrives every 5 s |
| snapshot | every frame, `resetBook` | whole books only |
| resync | none possible | no sequence exists |
| numbers | strip `.` and swap `,` for `.` before `Number()` | Indonesian formatting |
| sizes | take them from REST if exact sizes matter | socket sizes are display rounded |
| receive time | stamp on arrival | frames carry no time |

The `integrasi` books are Binance books scaled to IDR, so such a leg would mostly replay Binance about 2 s late, and its crossed touches would read as false edges, see [`rest.md`](./rest.md) section 4.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTCIDR trading page and its inline script | https://digitalexchange.id/basic-trading/BTCIDR | 2026-09-22 | PT Indonesia Digital Exchange | hosts, subscribe strings, event names, one pair per socket, `extraHeaders`, the commented Pusher client, sections 1 to 7 |
| S2 | DCTIDR trading page and its inline script | https://digitalexchange.id/basic-trading/DCTIDR | 2026-09-22 | same | a pair outside `integrasi` reads `@depth` from the main host, sections 1 and 2 |
| S3 | Home page | https://digitalexchange.id/ | 2026-09-22 | same | the market room subscription, section 2 |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/ws-probe.mjs) `book` | | 2026-09-22 | this host | sections 1 to 6 |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/ws-probe.mjs) `batch` | | 2026-09-22 | this host | ten sockets, throughput, sections 3 to 5 |
| P3 | [`ws-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/ws-probe.mjs) `silence` | | 2026-09-22 | this host | ping timeout and join timeout, section 5 |
| P4 | [`ws-probe.mjs`](../../../scripts/probes/venues/digitalexchange-id/ws-probe.mjs) `deflate` | | 2026-09-22 | this host | no permessage-deflate, the market summary, sections 2 and 5 |
| P5 | curl of `/socket.io/?EIO=4&transport=polling` and `EIO=3` on both hosts | | 2026-09-22 | this host | polling refused, section 1 |
