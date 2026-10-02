# BTC Markets WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:28 to 04:47 UTC for the first pass and 04:53 to 04:57 UTC for the second pass, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public WebSocket of BTC Markets (CCXT id `btcmarkets`) on its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): the spot book channel is recorded on the same axes a perpetual book channel would be.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/btcmarkets/ws-probe.mjs), and the capture is quoted beside the documented value.
The current API documentation at `https://docs.btcmarkets.net/v3/` answered this host, and a fetch that does not originate here, with HTTP 403 and a Cloudflare challenge page (`cf-mitigated: challenge`), so it was not read.
The documented column therefore quotes the older official sources that are readable: the WebSocket v2 page of the venue's GitHub wiki, S1, whose first line says "Please find the latest and most up to date documentation here: https://docs.btcmarkets.net", and the checksum reference repository of `ngin-io`, S2, whose client libraries S1 lists as sample code.
CCXT 4.5.68 ships no CCXT Pro class for BTC Markets, since `server/node_modules/ccxt/js/src/pro/` holds no `btcmarkets.js`.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every market and quote currency | `wss://socket.btcmarkets.net/v2`, S1 | opened in 501 to 632 ms over 20 sockets, and all 49 online markets delivered on one socket, P3 and P7 |
| perpetuals, dated futures, options | none | none exist, see [`fees.md`](./fees.md) section 3 |

One socket carries every market: AUD, USDT and BTC quoted markets were served on the same connection, P1.
`socket.btcmarkets.net` resolved to the same four Cloudflare addresses as the REST host, see [`rest.md`](./rest.md) section 1.
The upgrade replies carried `cf-ray` suffixes `SEA` and `YVR`, so the handshake ends at a Cloudflare edge in Seattle or Vancouver.
The Cloudflare trace of the REST host reported `loc=CA`, which is the Canadian VPN exit, and nothing refused the connection.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `orderbookUpdate` | price levels `[price, volume, count]` | the whole book as a snapshot on subscribe, then one changed level per frame with a CRC32 checksum | 8,722 and 6,518 BTC-AUD deltas in 75 s in two runs, recommended, P1 and P6 |
| `orderbook` | single orders `[price, volume]` | the best 50 orders per side, resent whole on every change | no frame on subscribe, the first BTC-USDT frame came 31.9 s and 13.9 s after the subscribe, P1 and P6 |
| `tick` | best bid, best ask, last price, 24 h fields and `snapshotId` | on every change of those | 1,619 and 1,360 BTC-AUD frames in about 71 s, P1 and P6 |
| `trade` | one trade | on trade | not probed |
| `heartbeat` | the list of current subscriptions | every 5 s, S1 | gaps of 4,971 to 5,019 ms, P1 and P6 |
| `orderChange`, `fundChange` | private | | not probed, section 7 |

No mark, index or funding channel exists, because the venue has no derivative.
The `orderbook` channel lists orders and not price levels.
The REST level 1 book lists orders the same way and spread its 50 BTC-AUD bids over 39 prices, see [`rest.md`](./rest.md) section 5.
An ETH-BTC `orderbook` frame held 35 to 37 bids where the `orderbookUpdate` book held 12 to 14 price levels, P1.
Summed per price, the ten best prices of every `orderbook` frame equalled the `orderbookUpdate` book at the same `snapshotId` on 2,107 of 2,107 frames compared over seven markets, P6.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL for all 51 markets and three quote currencies, section 1 |
| subscribe frame shape | `{"marketIds": [...], "channels": [...], "messageType": "subscribe"}`, and `addSubscription` or `removeSubscription` to change one part, S1 | as documented. A `subscribe` replaces every earlier subscription on the socket, `addSubscription` adds, `removeSubscription` removes silently, P2 |
| unknown symbol expectation | `{"messageType": "error", "code": 3, "message": "invalid marketIds"}`, S1 | as documented, and one unknown id in a list rejects the whole frame, so the valid market in it is not subscribed either, P2 |
| chunk unit and budget | Not publicly specified in S1 | 49 markets in one frame on one socket, all 49 snapshots within 614, 625 and 762 ms, P3 and P7 |
| keepalive mechanism | subscribe the `heartbeat` channel for a frame every 5 s, S1 | no server protocol ping on the 14 sockets that counted them. Heartbeats every 4,971 to 5,019 ms. A client protocol ping gets a pong, P4 |
| connection lifetime and maintenance notice | "From time to time your WebSocket connection may be disconnected (e.g. as we upgrade software on our servers). We recommend adding logic to your client in order to refresh your connection every 24 hours", S1 | no forced close in 117 s, and no maintenance frame seen, P4 |
| handshake and operation rate limits | "New connections to the WebSocket feed are rate limited to 3 attempts per 10 seconds per IP", S1 | the upgrade reply carries `x-ratelimit-limit: 20` and a reset 2 to 9 s ahead. The probe never opened more than one socket per 4 s, so no refusal was provoked |
| public market data authentication | none | none |
| message parse and routing | every frame carries `messageType`, S1 | route on `messageType`, then on `marketId` |
| subscribe acknowledgement shape | "Once a new subscription request is confirmed, a single heartbeat event is published to the client", S1 | no acknowledgement arrived. The first `orderbookUpdate` frame of each market is its snapshot, 161 to 762 ms after the subscribe. A socket that subscribed only `orderbookUpdate` received no heartbeat at all, P2 and P7 |
| symbol identifier format | `BTC-AUD`, S1 | identical to CCXT `market.id` and to REST `marketId` on 51 of 51 markets, see [`rest.md`](./rest.md) section 2. Lower case `bat-aud` is refused as `invalid marketIds`, P2 |
| number representation | prices and volumes as strings, S1 | price and volume strings, `count` a JSON integer, `snapshotId` a 16 digit JSON integer, `checksum` a decimal string |
| timestamp representation | ISO 8601, S1 | `timestamp` ISO with milliseconds. On 9,724 of 9,754 captured deltas `snapshotId` equals the `timestamp` in microseconds, P6 |
| size unit | Not publicly specified in S1 | base currency: a BTC-AUD volume of `"0.05"` at 122,668.05 AUD is 0.05 BTC, P6. CCXT gives no `contractSize`, section 4 |
| sequence semantics | the checksum lets a client compare its book, S2 | no sequence number. `snapshotId` is a millisecond clock in microseconds, and the CRC32 checksum on every delta is the only gap detector, section 4 |
| idle repeat behaviour | not documented | a quiet book sends nothing: six markets sent no delta in 60 s in each of two runs. 39 of 24,846 deltas left the book unchanged, P3 and P7 |

## 4. The book channel in detail

`orderbookUpdate` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each market carries `"snapshot": true` and the whole book, not a window.
BTC-AUD snapshots held 1,040 bids and 550 asks, and 1,041 bids and 549 asks, in the two book runs, and the largest snapshot in the three batch runs held 1,039, 1,043 and 1,045 levels on one side, P1, P3, P6 and P7.
Every market got exactly one snapshot per subscription, 161 to 762 ms after the subscribe frame was sent, P1, P3, P6 and P7.
`addSubscription` for a market already subscribed sends a new snapshot and does not double the deltas: no delta was delivered twice after it, P2 and P7.
A snapshot frame carries `"channel": "orderbookUpdate"` and no `checksum` key, while a delta carries `checksum` and no `channel` key.

### Delta semantics

A delta carries one changed level in `bids` or `asks` and an empty array on the other side.
Every delta in P1, P6 and P7, 61,230 in all, changed exactly one level.
The level is absolute: `volume` is the new total at that price, and `count` is the number of resting orders at it.
A volume of `"0"` with `count` 0 deletes the level, and no delta paired a zero volume with a nonzero count or the reverse, P1, P6 and P7.
`count` equals the number of orders the REST level 2 book lists at that price on 29 of 33 ETH-BTC prices read 564 ms apart, P6.

### Sequence and gap rule

There is no sequence number, so a gap cannot be seen from the ids.
`snapshotId` rises strictly per market once the first few deltas after a snapshot have passed: in the second pass no later delta carried a stamp below or equal to the one before it, P7, and the batch run of 04:43 UTC had one such repeat, P3.
Around the snapshot the stream is not clean.
In the three batch runs 3, 12 and 33 deltas arrived after the snapshot although they were stamped before it, by up to 124 ms, and 10 deltas in the second pass carried the snapshot's own `snapshotId`, P3 and P7.
Some of them were delivered twice with identical content, P3.
The checksum on a delta stamped before the snapshot described a book that the snapshot does not hold.
It failed on 32 of 33 such deltas when every delta was applied, and on 33 of 33 when those deltas were skipped, P7.
On every delta stamped at or after the snapshot the checksum matched, whether the earlier deltas were applied or skipped: 0 mismatches over 24,846 deltas in P7, and 0 over 19,348 and 17,036 deltas in the book runs, where no delta was stamped before a snapshot, P1 and P6.

```text
snapshot = true                         reset the book, snap = snapshotId
delta, snapshotId <  snap               ignore it: its checksum describes an older book
delta, snapshotId >= snap               apply the level, then compare the checksum
checksum differs on such a delta        gap: resubscribe the market for a new snapshot
```

The rule is drawn from the batch run of the second pass, P7, which counted the mismatches on deltas stamped at or after the snapshot directly.

### Checksum

The checksum is documented in S2, a repository of `ngin-io`, the GitHub organisation whose client libraries the WebSocket page lists as sample code, S1.
Take the best 10 bids from high to low, then the best 10 asks from low to high, and for each level write the price and the volume with the decimal point and leading zeros removed.
Concatenate those strings and take the CRC32 in decimal.
The probe's implementation of that rule, with Node's `zlib.crc32`, matched every checksum stamped at or after a snapshot in every run.
The rule works on the strings as sent.
`"0.00000013"` on ETH-BTC and `"0.00000002"` on XRP-BTC turn into `1.3e-7` and `2e-8` through a number round trip, so a feed that keeps only numbers, as the engine's `OrderBook` does, has to keep the ten best strings per side as well, P3 and P6.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every snapshot of the book runs, P1 and P6 | best first, ascending |
| delta | one level, so order does not arise | one level |
| `orderbook` channel | best first, orders at one price listed one after another | best first |
| REST `orderbook` | descending, see [`rest.md`](./rest.md) section 5 | ascending |

### Level window

No window is kept.
The book built from the snapshot and the deltas held up to 1,047 levels on one side, and a level far from the touch changes like any other, P7.
The engine's `publish` takes `topBids(levels)` and `topAsks(levels)` from the book, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 280 to 294, so a full depth book is cut to 20 levels there.

### Size unit against CCXT `contractSize`

The unit is the base currency, as on any spot book.
CCXT sets `contractSize` to `undefined` for every market, at `server/node_modules/ccxt/js/src/btcmarkets.js` line 545, and the connector turns a missing size into 1, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 175 and 188 to 191, which is correct for a spot book.
REST level 2 summed per price agreed with the socket book: on ETH-BTC 29 of 33 sizes were equal with the REST reply 564 ms older than the socket book, and on BTC-AUD 27 of 40 with the REST reply 3,151 ms older, since the REST full book is cached, P6 and [`rest.md`](./rest.md) section 5.

### One-sided and empty books

The offline market MCAU-AUD answered a subscription with a snapshot whose `bids` and `asks` were both empty, whose `timestamp` was `2026-07-23T19:48:04.884Z`, and whose `snapshotId` was the current time, P2.
No online market had an empty side in its snapshot in the batch runs, P3.
Thin books are common: BTC-USDT held 26 bids and 10 asks, and ETH-BTC 12 to 14 bids, P1 and P6.

### Idle repeats

Nothing is repeated.
Six markets sent no delta in each of the 60 s batch runs of 04:43 and 04:55 UTC, among them AUDM-AUD, BSV-AUD, FLR-AUD and OMG-AUD, P3 and P7.
BTC-USDT went 35.9 s and 18.2 s without a frame in the book runs, P1 and P6.
Two small markets are not quiet: BAT-AUD and POWR-AUD sent about 5 to 14 deltas a second, P2 and P7.
In the batch run of the second pass 39 of 24,846 deltas left the book unchanged, at most 8 of them on one market, P7.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| channel `nope` | `{"messageType":"error","code":3,"message":"invalid channel names"}` | the socket stays open |
| market `NOPE-AUD` | `{"messageType":"error","code":3,"message":"invalid marketIds"}` | |
| markets `NOPE-AUD` and `BAT-AUD` in one frame | `invalid marketIds` | BAT-AUD is not subscribed either |
| market `bat-aud` | `invalid marketIds` | |
| market `MCAU-AUD`, offline | an empty snapshot | nothing more |
| `messageType` `nope` | `{"messageType":"error","code":3,"message":"invalid message type"}` | earlier subscriptions keep delivering |
| no `marketIds` key | `invalid marketIds` | |
| text that is not JSON | `{"messageType":"error","code":3,"message":"Unable to parse JSON, please validate the format."}` | the socket stays open |
| `subscribe` to `heartbeat` only | a heartbeat 2.2, 4.3 and 1.3 s later in the three runs | the earlier book subscriptions stop |

All from P2 twice and P7 once, with the same replies each time.
Because an unknown id rejects the whole frame, a feed must subscribe only ids read from `/v3/markets`, and a market delisted between the catalog read and the subscribe could silence a whole slice.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `heartbeat` channel, a frame every 5 s, S1 | no server protocol ping on the 14 sockets that counted them, the longest open 118 s. Client protocol pings every 20 s got 5 pongs, P4 |
| silence the server tolerates | Not publicly specified in S1 | 60 s. A socket that sends and receives nothing closed at 60,531 and 60,518 ms with code 1006 and no close frame. A socket subscribed to OMG-AUD, which sent its snapshot at 696 ms and nothing after, closed at 60,696 ms with 1006. A socket subscribed to `heartbeat` only, a busy BAT-AUD book, or a client protocol ping every 20 s stayed open for the full 108 to 118 s, P4 |
| forced disconnect | possible during upgrades, reconnect every 24 h, S1 | none within 118 s |
| maintenance notice | none documented | none seen |
| compression | Not publicly specified in S1 | no extension with `perMessageDeflate: false`. A client that offers permessage-deflate gets `permessage-deflate;client_max_window_bits=15`, twice, so the server negotiates it only on request, P5 and P7 |
| handshake | 3 new connections per 10 s per IP, S1 | 501 to 632 ms to open. The upgrade reply carries `x-ratelimit-limit: 20` |
| subscription limits | Not publicly specified in S1 | 49 markets on one socket, two channels, no refusal |
| throughput | | all 49 online markets on one socket in three runs: 448, 427 and 415 frames per second on average, median 441, 401 and 402, peak 706, 608 and 757, 197 or 198 bytes per frame, 7.6, 8.6 and 10.9 µs `JSON.parse` per frame, P3 and P7 |
| delivery delay | | arrival minus the `snapshotId` stamp on 9,754 captured deltas of seven markets: min 80, median 85, p99 150, max 377 ms, with the server clock 2 to 6 ms ahead of this host, P6 and [`rest.md`](./rest.md) section 7 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays marked `…` are cut, and every frame except the error, the offline snapshot and the tick is from the P6 capture.

Subscribe.

```json
{"marketIds": ["BTC-AUD", "ETH-AUD", "XRP-AUD", "SOL-AUD", "BTC-USDT", "ETH-BTC", "BAT-AUD"], "channels": ["orderbookUpdate", "heartbeat"], "messageType": "subscribe"}
```

Snapshot, the first three levels per side kept out of 14 bids and 172 asks.

```json
{"marketId":"BAT-AUD","snapshot":true,"timestamp":"2026-09-23T04:41:37.492Z","snapshotId":1790138497492000,"bids":[["0.122","106796",1],["0.1219","123051.68170631",1],["0.11","150",1]],"asks":[["0.1491","57263.35531493",1],["0.159","9",1],["0.1598","324.68382543",1]],"channel":"orderbookUpdate","messageType":"orderbookUpdate"}
```

Deltas: a new level, and a deletion.

```json
{"marketId":"BTC-AUD","timestamp":"2026-09-23T04:41:37.570Z","snapshotId":1790138497570000,"bids":[["122668.05","0.05",1]],"asks":[],"messageType":"orderbookUpdate","checksum":"844822657"}
```

```json
{"marketId":"BTC-AUD","timestamp":"2026-09-23T04:41:37.689Z","snapshotId":1790138497689000,"bids":[],"asks":[["122861.75","0",0]],"messageType":"orderbookUpdate","checksum":"1114195264"}
```

Empty snapshot of the offline market, with a `timestamp` two months older than its `snapshotId`, P2.

```json
{"marketId":"MCAU-AUD","snapshot":true,"timestamp":"2026-07-23T19:48:04.884Z","snapshotId":1790138074722000,"bids":[],"asks":[],"channel":"orderbookUpdate","messageType":"orderbookUpdate"}
```

Heartbeat.

```json
{"messageType":"heartbeat","channels":[{"name":"heartbeat"},{"name":"orderbookUpdate","marketIds":["BAT-AUD","BTC-AUD","BTC-USDT","ETH-AUD","ETH-BTC","SOL-AUD","XRP-AUD"]}]}
```

Errors, P2.

```json
{"messageType":"error","code":3,"message":"invalid marketIds"}
```

```json
{"messageType":"error","code":3,"message":"Unable to parse JSON, please validate the format."}
```

The `orderbook` channel lists single orders: the two entries at `0.00000013` are one level in `orderbookUpdate`.
This frame held 36 bids and 34 asks.

```json
{"marketId":"ETH-BTC","timestamp":"2026-09-23T04:41:42.113Z","bids":[["0.02650693","0.79137487"],["0.0265069","10"],"…",["0.00000013","70"],["0.00000013","200"]],"asks":[["0.0329703","2.52"],["0.03297033","10"],"…"],"messageType":"orderbook","snapshotId":1790138502113000}
```

Tick, P1.

```json
{"marketId":"ETH-BTC","timestamp":"2026-09-23T04:31:09.259Z","bestBid":"0.02647376","bestAsk":"0.03300226","lastPrice":"0.03325715","volume24h":"0","volumeQte24h":"0","price24h":"0","pricePct24h":"0.00","messageType":"tick","low24h":"0","high24h":"0","snapshotId":1790137869258000}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- `orderChange` publishes each step of an order's life, and `fundChange` each deposit and withdrawal.
- Both need `key`, `signature` and `timestamp` in the subscribe frame, where the signature is an HMAC SHA-512 of `/users/self/subscribe`, a newline and the timestamp, with the base64 decoded secret, S1.
- Authentication failure answers `{"messageType": "error", "code": 1, "message": "authentication failed. invalid key"}`, S1.

## 8. Recommended feed shape

A recommendation for a later design that admits spot legs, not a decision.
Today the connector keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 202, so it drops all 51 BTC Markets markets and logs `no usable swap markets; skipping the venue` at line 51 before any feed starts.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan on `wss://socket.btcmarkets.net/v2` | one URL serves every market |
| channel | `orderbookUpdate` plus `heartbeat` | full snapshot on subscribe, a checksum on every delta, and a frame every 5 s |
| markets per connection | all of them, 49 today | 49 ran on one socket at 415 to 448 frames a second with no refusal, three times |
| subscribe frames | one frame, `{"marketIds": [...], "channels": ["orderbookUpdate", "heartbeat"], "messageType": "subscribe"}`, with ids read from `/v3/markets` only | one unknown id rejects the whole frame |
| keepalive | none beyond the `heartbeat` subscription | the server closes a socket after 60 s without traffic, and a quiet market sends nothing |
| `maxSilenceMs` | 15,000 | three missed heartbeats |
| routing | `messageType === 'orderbookUpdate'`, then `marketId`, which is the `rawMarketId` | |
| snapshot | `snapshot === true`: `resetBook` with every level and keep `snapshotId` | full depth, one snapshot per subscription |
| delta | skip it when its `snapshotId` is below the snapshot's, otherwise set or delete the one level | deltas stamped before the snapshot arrive after it |
| checksum | CRC32 of the ten best string levels per side after every applied delta | the only gap detector, 0 mismatches on deltas stamped at or after the snapshot in every run |
| resync | on a mismatch, `addSubscription` for that market alone gets a new snapshot without closing the socket. The engine's `resync` terminates and reopens instead | the documented handshake budget is 3 per 10 s, so reopening the socket for each bad market can run into it |
| receive time | stamp on arrival | a snapshot's `timestamp` can be months old |
| deflate | keep `perMessageDeflate: false` | the server compresses only when asked |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTC Markets API wiki, WebSocket v2, last edited 2022-09-11 | https://github.com/BTCMarkets/API/wiki/WebSocket-v2 | 2026-09-22 | BTC Markets, Australia | URL, channels, subscribe, heartbeat, errors, connection rate limit, 24 h refresh, private channels |
| S2 | ngin-io websocket-checksum, README and `checksum.js`, last pushed 2020-12-18 | https://github.com/ngin-io/websocket-checksum | 2026-09-22 | `ngin-io`, whose client libraries S1 lists | the `orderbookUpdate` checksum rule, section 4 |
| S3 | BTC Markets API v3 documentation | https://docs.btcmarkets.net/v3/ | 2026-09-22, refused | BTC Markets | not read: HTTP 403 and a Cloudflare challenge to this host and to WebFetch, and the Internet Archive holds no copy |
| S4 | CCXT 4.5.68 `btcmarkets.js` | `server/node_modules/ccxt/js/src/btcmarkets.js` | 2026-09-22 | CCXT | `contractSize` undefined at line 545 |
| P1 | `ws-probe.mjs book` at 04:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcmarkets/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs errors`, two runs at 04:33 and 04:34 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcmarkets/ws-probe.mjs) | 2026-09-23 | this host | sections 3 and 4 |
| P3 | `ws-probe.mjs batch`, two runs at 04:35 and 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcmarkets/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 5 |
| P4 | `ws-probe.mjs silence`, two runs at 04:36 and 04:39 UTC, the quiet book BAT-AUD in the first and OMG-AUD in the second | [`ws-probe.mjs`](../../../scripts/probes/venues/btcmarkets/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
| P5 | `ws-probe.mjs deflate` at 04:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcmarkets/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
| P6 | `ws-probe.mjs book` at 04:41 UTC, with the per price compares | [`ws-probe.mjs`](../../../scripts/probes/venues/btcmarkets/ws-probe.mjs) | 2026-09-23 | this host | sections 2 to 6 |
| P7 | second pass: `ws-probe.mjs batch`, `errors` and `deflate` at 04:55 to 04:57 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/btcmarkets/ws-probe.mjs) | 2026-09-23 | this host | section 4 gap rule, and the second readings of sections 3 to 5 |
