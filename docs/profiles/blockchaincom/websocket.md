# Blockchain.com WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:32 to 04:38 UTC, and the second pass at 04:44 to 04:52 UTC, from the development host near Seattle through the Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public socket of Blockchain.com Exchange (CCXT id `blockchaincom`), which lists spot only, so the book channel described is the spot `l2` channel, as template change 1 of the survey plan asks.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs), and the capture is quoted beside the documented value.
The headline finding is that the socket's books did not move once in 45 s on any of the 60 open symbols, and that its BTC-USD book is not the book the REST API serves at the same moment, see section 4.
The Exchange was documented as suspended for trading from 19 October 2025, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every channel | `wss://ws.blockchain.info/mercury-gateway/v1/ws`, with the header `Origin: https://exchange.blockchain.com`, S1 | open in 304 to 370 ms over four opens with the header. Cloudflare edge YVR or SEA |
| same URL without `Origin` | the header is documented as required, S1 | HTTP 400 `Request is missing required HTTP header 'Origin'` |
| same URL with `Origin: https://example.com` | | HTTP 400 `The value of HTTP header 'Origin' was malformed:` then a newline and `Invalid Origin header` |
| perpetuals | none listed | |

One socket carries every channel and symbol.
CCXT Pro uses the same URL and sends the same `Origin` header, at `server/node_modules/ccxt/js/src/pro/blockchaincom.js` lines 29 and 33 to 40.
`ws.blockchain.info` resolved to 104.16.117.55 and 104.16.118.55 on 2026-09-23, see [`rest.md`](./rest.md) section 1.

The engine opens every socket as `new WebSocket(plan.url, { perMessageDeflate: false })` with no header option, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81.
A feed for this venue would therefore need the handshake options to carry an `Origin` header, which no current venue needs.

## 2. Channel matrix for public market data

| channel | subscribe frame | documented | probed on 2026-09-23 |
|---|---|---|---|
| `l2` | `{"action": "subscribe", "channel": "l2", "symbol": "BTC-USD"}` | aggregated levels with `px`, `qty` and `num`, "All the price levels are retrieved with this channel" | ack and snapshot, then no update in 45 s on 5 symbols, or on 60 symbols in the batch run |
| `l3` | same with `"channel": "l3"` | one entry per order with `id`, `px`, `qty` | ack and a 31 bid, 4 ask snapshot on BTC-USD, then no update in 45 s |
| `ticker` | same with `"channel": "ticker"` | ticker messages | snapshot, then two frames a second repeating the same `mark_price` and the same `volume_24h`, 90 updates in 45 s |
| `trades` | same with `"channel": "trades"` | trade executions | ack only, no frame in 45 s |
| `prices` | `{"action": "subscribe", "channel": "prices", "symbol": "BTC-USD", "granularity": 60}` | candles | 4 updates and then 1 update in two 45 s runs, every candle volume 0, close equal to the REST book mid, section 4 |
| `symbols` | same with `"channel": "symbols"` | symbol status | one snapshot with the REST `symbols` fields plus `margin_enabled`, `margin_collateral` and `leverage_ratio` |
| `heartbeat` | `{"action": "subscribe", "channel": "heartbeat"}` | an `updated` frame every 5 s | 8 frames in 45 s, 5,083 to 5,107 ms apart |

The channel names and frames are from S1.
No depth or speed parameter exists, and no mark, index or funding channel exists.
The `ticker` frame carries a field named `mark_price`, and it is frozen, section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for every channel, S1 | one URL served every channel and all 60 open symbols |
| subscribe frame shape | `{"action": "subscribe", "channel": "l2", "symbol": "BTC-USD"}`, one symbol per frame, "Subscribing is done per symbol", S1 | as documented. A frame without `symbol` is rejected, section 4 |
| unknown symbol expectation | a `rejected` event with a `text` reason, S1 | `{"event": "rejected", "channel": "l2", "symbol": "NOPE-USD", "text": "invalid symbol identifier"}`. A closed symbol is acknowledged and gets an empty snapshot |
| chunk unit and budget | "a limit of 1200 messages per minute", then `rejected` with "Connection throttling enabled, your messages will be ignored." for a minute, S1 | 60 subscribe frames in one burst were all acknowledged, and the limit was not reached |
| keepalive mechanism | an optional `heartbeat` channel, S1 | the server also sends a WebSocket protocol ping every 974 to 1,066 ms, median 1,020 ms in both runs, which the `ws` library answers on its own |
| connection lifetime and maintenance notice | Not publicly specified | no close in 110 s, and no notice frame seen |
| handshake and operation rate limits | 1,200 messages a minute, S1 | handshakes took 304 to 370 ms, and no refusal |
| public market data authentication | anonymous for `heartbeat`, `l2`, `l3`, `prices`, `symbols`, `ticker`, `trades`, S1 | none, but the `Origin` header is required, section 1 |
| message parse and routing | every server message carries `seqnum`, `event` and `channel`, S1 | route on `channel` and `symbol`, then `event` of `subscribed`, `snapshot`, `updated`, `rejected` or `unsubscribed` |
| subscribe acknowledgement shape | `{"seqnum": 1, "event": "subscribed", "channel": "l2", "symbol": "BTC-USD"}`, S1 | the same plus `"batching": false` on `l2` and `granularity` on `prices` |
| symbol identifier format | `BTC-USD`, S1 | identical to CCXT `market.id` and to the REST `symbols` key on 194 of 194 symbols. Lower case is rejected |
| number representation | JSON numbers, S1 | JSON numbers for `px`, `qty` and `num`, for example `"qty": 22.66666666`. `l3` order ids are strings |
| timestamp representation | `YYYY-MM-DDTHH:MM:SS.ssssssZ` or with nine fraction digits, S1 | nine fraction digits on snapshots and heartbeats, `"2026-09-23T04:33:51.186347431Z"`. Candle times are Unix ms |
| size unit | base currency, not stated | base currency, `qty` 0.25 at `px` 87,700.11 on BTC-USD is bitcoin. CCXT `contractSize` is undefined for these spot markets, which the engine would read as 1 |
| sequence semantics | "Each message sent from the server will contain a sequence number seqnum which will be incremented by 1 with each message", and a skipped number means the client "is recommended to restart the websocket connection", S1 | one counter per connection across every channel, starting at 0, with 0 gaps over 121, 120 and 13 frames on three sockets, and over 118, 120 and 13 in the rerun |
| idle repeat behaviour | not documented | the `l2` and `l3` channels sent nothing after the snapshot. The `ticker` channel repeated identical values every second |

## 4. The book channel in detail

### Snapshot on subscribe

Every `l2` subscribe got a `subscribed` frame and a `snapshot` frame in the same millisecond, 188 to 204 ms after the frame was sent in the two `book` runs.
In the `batch` runs 60 of 60 open symbols were acknowledged and snapshotted within 189 and 183 ms.
The 60 snapshots of the rerun at 04:49 UTC were identical to those of 04:35 UTC apart from `seqnum` and `timestamp`.
The snapshot `timestamp` is the moment the server built it and not the time of the last book change.
The same unchanged BTC-USD book carried `04:33:51.186347431Z` in the `book` run and `04:35:13.185303119Z` in the `errors` run.

### Delta semantics

The documentation says an `updated` frame carries the changed levels, and "An update with qty equal to 0, means the price should be removed", S1.
No `updated` frame arrived on `l2` or `l3` in the probes: 0 on 5 symbols over 45 s in each `book` run and 0 on 60 symbols over 45 s in each `batch` run.
So the delta shape is documented only, and the documented example is quoted in section 6.

### Sequence and gap rule

```text
seqnum = previous + 1        accept the message, whatever its channel
seqnum ≠ previous + 1        a message was missed on this connection: restart the socket (documented), which is the engine's resync
```

The counter is per connection and not per symbol, so a gap on any channel invalidates every book on the socket.
It held with 0 gaps on every socket probed.
CCXT Pro reads `seqnum` into its comments and does not check it, at `server/node_modules/ccxt/js/src/pro/blockchaincom.js` lines 658 to 723.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| documented | "There is no ordering guarantee in bids and asks entries", S1 | same |
| socket snapshot | ascending, worst first, on all 30 snapshots in the `batch` run that had bids. BTC-USD starts at 0.01 and ends at 82,220 | ascending, best first |
| REST `l2` | one level per side, so no order to judge, see [`rest.md`](./rest.md) section 5 | |

A feed would sort by price and never read the best level by position.

### The socket book is not the REST book

| source, BTC-USD, read in the same second at 04:48:10 UTC | bids | asks |
|---|---|---|
| socket `l2`, 45 s after the snapshot, identical in both runs | 25 levels from 0.01 to 82,220, for example 201 BTC at 0.01 | 4 levels: 0.25 at 87,700.11, 0.00699371 at 101,000, 0.00450795 at 120,000, 0.00087739 at 149,999 |
| REST `GET /l2/BTC-USD` | one level, 0.002 at 86,271.02, and 0.002 at 86,369.23 in the first run at 04:34 | one level, 0.002 at 88,049.09, and 0.002 at 88,149.33 at 04:34 |

The socket ask at 87,700.11 is better than the REST ask, so the two cannot be views of one book.
The socket book did not change in any run, while the REST book changed 6 times in one minute of one second polls and not at all in another, see [`rest.md`](./rest.md) section 5.
The socket `l3` ids run from `451047911760` to `451066124005`, and the REST `l3` ids read `451066566476` and above.
So the two books appear to share one id sequence, and the socket holds only older orders.
The `prices` channel closed its 04:34 candle at 87,259.28, which is exactly the mid of the REST quote, (86,369.23 + 88,149.33) / 2.
In the rerun its 04:48 candle read 87,160.055, again exactly the REST mid, (86,271.02 + 88,049.09) / 2.
So the live quote reaches the `prices` channel and not the `l2` channel.
Whether the socket book is the order book frozen at the October 2025 suspension is an inference that this probe cannot prove.

### Size unit

`qty` is in the base currency, and these are spot markets with no contract.
CCXT sets `contractSize` undefined, at `server/node_modules/ccxt/js/src/blockchaincom.js` line 394, and the engine turns a missing contract size into 1, so base units would convert correctly.

### One-sided and empty books

In the `batch` run 30 of 60 open symbols had an empty snapshot, `"bids": [], "asks": []`, and 14 had bids and no asks, for example `LTC-GBP` with one bid at 0.01.
TRX-USDT, whose REST book answers HTTP 500, got an empty snapshot on the socket.
The engine's `resetBook` accepts an empty side.

### Idle repeats

`l2` and `l3` sent nothing after the snapshot.
`ticker` sent two frames every second, one with `"mark_price": 106523.7` and one with `"price_24h": 0.0, "volume_24h": 11209.249919398`, 45 of each in 45 s, all identical.
At 04:48:10 UTC the Kraken BTC/USD mid was 87,192.05, so the socket `mark_price` sat 221,713 ppm, about 22 %, above the market.
A value of 106,523.7 lies inside Kraken's BTC/USD daily range for 19 October 2025, 106,125.2 to 109,444.0, which is consistent with a number frozen at the suspension and does not prove it.

### Unknown, closed and malformed requests

| request | reply |
|---|---|
| `l2` `NOPE-USD` | `rejected`, `"text": "invalid symbol identifier"` |
| `l2` `btc-usd` | `rejected`, `"invalid symbol identifier"` |
| `l2` `TFUEL-USDC`, a `close` symbol | `subscribed`, then an empty `snapshot` |
| `l2` without `symbol` | `rejected`, `"missing symbol field"` |
| channel `nope` | `rejected`, `"Invalid channel"` |
| frame without `action` | `rejected`, `"Missing action"` |
| `hello`, not JSON | `rejected` with `"channel": ""`, `"Invalid json received"` |
| `l2` `BTC-USD` twice | the second is `rejected`, `"Already subscribed"` |
| `ticker` `NOPE-USD` | `rejected`, `"Invalid symbol"` |
| `unsubscribe` `l2` `BTC-USD` | `unsubscribed`, then no `l2` frame in 8 s |

No reply closed the socket.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | subscribe `heartbeat` for an `updated` frame every 5 s, S1 | heartbeat frames 5,083 to 5,107 ms apart. The server also pings at the protocol level every 974 to 1,066 ms |
| silence the server tolerates | Not publicly specified | a socket that subscribed nothing and sent nothing after the handshake, and a socket with one quiet `l2` subscription, both stayed open for the full 110 s in both runs. The `ws` library answered 108 and 107 protocol pings on them each time |
| forced disconnect | Not publicly specified | none in 110 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | `Origin: https://exchange.blockchain.com` required, S1 | 304 to 370 ms, and HTTP 400 without the header or with another origin, in both runs |
| subscription limits | 1,200 messages a minute, S1 | 60 `l2` subscriptions on one socket, all acknowledged |
| throughput | "The response and update messages are never delayed", S1 | 120 frames in 45 s for 60 symbols, all of them acknowledgements and snapshots, 23,532 bytes, the same in both runs |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays marked `…` are cut.

Acknowledgement.

```json
{"seqnum":1,"event":"subscribed","channel":"l2","symbol":"BTC-USD","batching":false}
```

Snapshot, first three levels per side kept, bids worst first.

```json
{"seqnum":2,"event":"snapshot","channel":"l2","symbol":"BTC-USD","bids":[{"num":2,"px":0.01,"qty":201},{"num":1,"px":0.03,"qty":22.66666666},{"num":1,"px":0.3,"qty":1.53333333}],"asks":[{"num":1,"px":87700.11,"qty":0.25},{"num":1,"px":101000,"qty":0.00699371},{"num":1,"px":120000,"qty":0.00450795}],"timestamp":"2026-09-23T04:33:51.186347431Z"}
```

Empty snapshot of an open symbol.

```json
{"seqnum":8,"event":"snapshot","channel":"l2","symbol":"STX-USD","bids":[],"asks":[],"timestamp":"2026-09-23T04:33:51.186698306Z"}
```

Delta, documented example only, since none arrived, S1.

```json
{"seqnum":4,"event":"updated","channel":"l2","symbol":"BTC-USD","bids":[{"px":8723.45,"qty":0.0,"num":0}],"asks":[]}
```

Heartbeat.

```json
{"seqnum":31,"event":"updated","channel":"heartbeat","timestamp":"2026-09-23T04:33:57.057675320Z"}
```

Errors.

```json
{"seqnum":0,"event":"rejected","channel":"l2","symbol":"NOPE-USD","text":"invalid symbol identifier"}
```

```json
{"seqnum":10,"event":"rejected","channel":"l2","text":"Already subscribed","symbol":"BTC-USD"}
```

Ticker snapshot and its repeating update.

```json
{"seqnum":14,"event":"snapshot","channel":"ticker","symbol":"BTC-USD","price_24h":0,"volume_24h":11209.249919398,"last_trade_price":86300,"mark_price":106523.7}
```

```json
{"event":"updated","channel":"ticker","symbol":"BTC-USD","mark_price":106523.7}
```

Candle, `[time ms, open, high, low, close, volume]`.

```json
{"seqnum":79,"event":"updated","channel":"prices","symbol":"BTC-USD","price":[1790138040000,87217.845,87217.845,87190.85,87190.85,0.0]}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
`auth` takes `{"token": "<API secret>", "action": "subscribe", "channel": "auth"}` on the same URL, then `balances` and `trading` become available.
CCXT Pro builds the same frames at `server/node_modules/ccxt/js/src/pro/blockchaincom.js` lines 66 to 69, 434 to 437 and 778 to 782.

## 8. Recommended feed shape

No feed is recommended.
The venue lists no perpetual, the Exchange was documented as suspended for trading, and the socket book is static and disagrees with the REST book, so a feed would publish a stale book.

If the venue ever came back as a live spot book, this is what the probes say a feed would need.

| item | value | reason |
|---|---|---|
| URL plan | one socket on `wss://ws.blockchain.info/mercury-gateway/v1/ws` | one URL carries every symbol |
| handshake | `Origin: https://exchange.blockchain.com` | HTTP 400 without it, and the engine sends no header today, section 1 |
| subscribe frames | one `{"action": "subscribe", "channel": "l2", "symbol": "<rawMarketId>"}` per symbol, plus one `heartbeat` subscription | subscription is per symbol |
| markets per connection | 60, every open symbol | tested with no refusal, and 61 frames is inside the 1,200 a minute limit |
| keepalive | none to send. Subscribe `heartbeat` and let `ws` answer protocol pings | the server pings every second |
| `maxSilenceMs` | 15,000, three missed heartbeats | books can be silent for longer than 45 s, so the heartbeat is the traffic the silence watch relies on |
| snapshot | `event` `snapshot`: `resetBook` with levels sorted by price | order is not guaranteed |
| delta | `event` `updated`: set each level, delete on `qty` 0 | documented |
| resync | any `seqnum` that is not the previous plus one: `resync` the whole socket | the counter is per connection |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Blockchain.com Exchange API, Websocket API sections | https://exchange.blockchain.com/api/ | 2026-09-22 | Blockchain.com Exchange | URL, `Origin` header, channels, events, `seqnum` rule, rate limit, heartbeat, `l2` and `l3` examples, private channel names, sections 1 to 7 |
| S2 | CCXT Pro 4.5.68 `blockchaincom.js` | `server/node_modules/ccxt/js/src/pro/blockchaincom.js` | 2026-09-22 | CCXT | URL, `Origin` option, order book handler, auth frames, sections 1, 4 and 7 |
| S3 | CCXT 4.5.68 `blockchaincom.js` | `server/node_modules/ccxt/js/src/blockchaincom.js` | 2026-09-22 | CCXT | `contractSize` undefined, section 4 |
| S4 | Kraken public OHLC and ticker, XBTUSD | https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440 | 2026-09-22 | Kraken | reference BTC/USD prices, section 4 |
| P1 | `ws-probe.mjs book`, 04:33 UTC, and the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | channels, snapshots, heartbeat, ticker, REST compare, sections 2 to 6 |
| P2 | `ws-probe.mjs errors`, 04:35 UTC, and the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | rejections and unsubscribe, sections 3, 4 and 6 |
| P3 | `ws-probe.mjs origin` and `deflate`, 04:33 UTC, and the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `Origin` refusals, compression, sections 1 and 5 |
| P4 | `ws-probe.mjs batch`, 04:35 UTC, and the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | 60 symbols on one socket, level order, empty books, sections 4 and 5 |
| P5 | `ws-probe.mjs silence`, 04:36 to 04:38 UTC, and the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/blockchaincom/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | silence tolerance and protocol ping cadence, sections 3 and 5 |
| P6 | `rest-probe.mjs books` and `poll` | [`rest-probe.mjs`](../../../scripts/probes/venues/blockchaincom/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | REST book changes, section 4 |
