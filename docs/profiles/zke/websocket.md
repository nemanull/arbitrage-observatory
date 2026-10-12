# ZKE WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:10 to 04:25 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures WebSocket of ZKE, which has no CCXT class, for its USDT margined perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py) in two passes unless a source id says otherwise.
Source ids are shared with [`fees.md`](./fees.md) and [`rest.md`](./rest.md).
The socket is the ChainUp kline-api socket, the same protocol the engine already reads for FameEX, x.me and Koinbay in [`chainup.rs`](../../../server/src/venues/chainup.rs), with the same `e_btcusdt` spelling.
The one problem is the `mark_price_` stream, which stopped on half the sockets probed while books kept flowing, section 2.
Nothing was refused from the Canadian exit.

## 1. Endpoints

| family | URL | where it is named | probed |
|---|---|---|---|
| USDT and coin margined perpetuals | `wss://futuresws.zke.com/kline-api/ws` | `wsUrl` of the futures web list, P3 | 101 and open in 383 to 472 ms on every open in two passes, P7 to P11 |
| spot | `wss://ws.zke.com/kline-api/ws` | the API document, S14, and `wsUrl` of the web config, S15 | 101, and `market_btcusdt_depth_step0` sent 5 books in 3 s, P7, not detailed |

ZKE's WebSocket document names only the spot URL, S14.
One futures socket carries every perpetual, and the symbol in the channel name selects the contract.
The futures socket host resolves to the same two AWS addresses in Tokyo as the REST host, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | probed |
|---|---|---|
| `market_<sub>_depth_step0` | the unaggregated book, 30 levels per side, `asks` and `buys` | 86 and 67 BTC frames in 35 s and 30 s, recommended, P7 |
| `market_<sub>_depth_step1` | the same 30 level book on a whole dollar step on BTC | 86 and 67 BTC frames, P7 |
| `market_<sub>_ticker` | 24 h `vol`, `rose`, `open`, `low`, `high`, `close`, `amount`, and no bid or ask | 52 and 45 BTC frames, P7 |
| `mark_price_<sub>` | `tagPrice`, `indexPrice`, `currentFundRate`, `nextFundRate`, `nextSettlementTime`, `symbol`, all strings | about one a second when it flows, see below, P7 to P9 |
| `market_<sub>_trade_ticker` | trades with price, size, side, ms time and a GMT+8 `ds` | 46 and 38 BTC frames, P7 |

No best bid and ask channel exists, S14.
ZKE's document lists depth, trades, kline and ticker, and not the mark channel, which was found from the ChainUp pattern, S14.

### The mark stream stalls

The `mark_price_` stream sent its first frame within a second of every subscription, and on many sockets nothing after the first two or three frames.

| socket | channels | mark frames per contract | probe |
|---|---|---|---|
| basic, pass 1 and 2 | 5 depth, 4 marks, ticker and trades | BTC 33 in 35 s, then 23 in 30 s | P7 |
| all, pass 1 | 205 depth and 205 marks | 2 on every contract in 60 s | P8 |
| all, pass 2 | 205 depth and 205 marks | 3 on every contract in 45 s | P8 |
| 10 contracts, depth and mark | 20 channels | 2 on every contract in 40 s | P9 |
| BTC depth and mark, two sockets | 2 channels | 25 in 25 s on one, 2 in 25 s on the other | P9 |
| BTC mark only, two sockets | 1 channel | 23 and 22 in 25 s | P9 |
| every mark, no depth, three sockets | 205 channels | 20 in 40 s, then 9 and 22 in 25 s | P9 |

So 6 of the 12 sockets stopped sending marks partway or right after the first frames, while their books and the server pings went on.
Sockets that also carried depth stalled more often, 4 of 7, than mark only sockets, 2 of 5.
No pattern by time was visible within the 15 minutes probed.
[`../blockfinex/`](../blockfinex/) reported the same stall on another ChainUp venue.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one spot URL in the document, S14, and a separate futures host in the web list, P3 | one futures URL for every perpetual, with the inverse `e_btcusd` served beside the USDT contracts |
| subscribe frame shape | `{"event":"sub","params":{"channel":"...","cb_id":"1"}}`, one channel per frame, S14 | 410 frames in one burst, every one delivered, in two passes, P8 |
| unknown symbol expectation | Not publicly specified | `market_e_nopeusdt_depth_step0`, `mark_price_e_nopeusdt` and the REST spelling `market_E-ETH-USDT_depth_step0` got no frame, P7 |
| chunk unit and budget | Not publicly specified | 410 subscriptions on one socket, no refusal and no close in 60 s and 45 s, P8 |
| keepalive mechanism | the server pushes `{"ping": <seconds>}` every 10 s, and a `{"pong": <seconds>}` reply is recommended but not strictly checked, S14 | `{"ping":1791605452}` as a gzip binary frame, on a 10 s beat with some beats skipped, P10 and P11 |
| connection lifetime and maintenance notice | Not publicly specified | a socket that never answered a ping stayed open for 90 s and 60 s, P10 |
| handshake and operation rate limits | Not publicly specified | 20 opens over the session, up to three at once, no refusal |
| public market data authentication | none, S14 | none |
| message parse and routing | `channel` names the stream, S14 | envelope `{event_rep, channel, data, tick, ts, status, timezone}`, route by `channel` |
| subscribe acknowledgement shape | Not publicly specified | no acknowledgement for any `sub` |
| symbol identifier format | `market_$symbol_depth_step0`, with `btcusdt` as the spot example, S14 | `e_btcusdt`, the web list's `subSymbol`, which is the REST name lower cased with the first dash turned into `_` and the others removed, on all 213 rows, P3 |
| number representation | numbers in the document's examples, S14 | depth levels `[price, size]` as JSON numbers, `mark_price_` and ticker values as strings |
| timestamp representation | ms in the document's examples, S14 | envelope `ts` in ms rounded to the whole second, ping value in seconds |
| size unit | Not publicly specified | contracts, the same integers as REST `/fapi/v1/depth`, P7, and one contract is `multiplier` of the base, see section 4 |
| sequence semantics | none documented | none on the wire, every frame is a whole book |
| idle repeat behaviour | Not publicly specified | BTC repeated the previous book on 34 of 86 and 42 of 67 frames, and every one of 205 contracts sent at least 56 book frames in 45 s, P7 and P8 |

## 4. The book channel in detail

`market_<sub>_depth_step0` is the channel this profile recommends.

### Snapshot on subscribe

All 205 contracts delivered their first book within 0.5 s and 0.6 s of the subscribe burst, in two passes, P8.
Every frame is a whole book, so there is no delta stream.

### Delta semantics

None.
Each `tick` replaces the book.

### Sequence and gap rule

No sequence field exists, so no gap can be detected and no resync on gap is needed.
The envelope `ts` has whole second resolution, 34 distinct values over 86 BTC frames and 29 over 67, so it cannot order two frames within one second, P7.

### Checksum

None.

### Level order on the wire

`asks` ascending and `buys` descending on every BTC frame of two passes, P7.
Bids are named `buys` on the socket and `bids` on REST.

### Level window

30 levels per side on every BTC frame of two passes, P7, as the document says, S14.
Over all 205 contracts, 26,965 of 27,059 and 20,168 of 20,233 depth frames had 30 levels on their smaller side, and the rest had 16, P8.
`E-RSR-USDT` had 16 levels a side on REST as well, see [`rest.md`](./rest.md) section 5, so it is the one contract below the engine's 20 levels, which is an inference.
REST gives up to 100, see [`rest.md`](./rest.md) section 5.

### Size unit

There is no CCXT market, so the unit comes from the catalog.
The socket's top three bids and asks equalled a REST read made during the run, prices and sizes, in both passes, P7.
So sizes are integer contracts, and one contract is `multiplier` units of `multiplierCoin`, 0.0001 BTC on `E-BTC-USDT`, see [`rest.md`](./rest.md) section 2.
That reading is an inference, since no document states the unit.

### One-sided and empty books

None among the 205 scheduled contracts on the socket, P8.
`E-BSV-USDT` and `E-LUNA-USDT`, one sided and empty on REST, are outside the schedule and were not subscribed, see [`rest.md`](./rest.md) section 2.

### Idle repeats

A BTC frame came every 308 and 341 ms at the median in two passes, and 34 of 86 and 42 of 67 repeated the previous book, P7.
Every contract sent between 75 and 221 book frames in 60 s, median 135, and between 56 and 167 in 45 s, median 100, in the rerun, P8.
So a silent contract on ZKE means a lost subscription.

### Unknown, closed and other tenants' symbols

No error is returned for an unknown or wrongly spelled channel, P7.
An unknown `event`, such as `{"event":"nope",...}`, is echoed back unchanged as a plain JSON binary frame, not gzip, P7.
`market_usdt1858_btcusdt_depth_step0` and `mark_price_usdt1858_btcusdt`, CZR's spelling, did return a book and a mark on ZKE's socket in both passes, with a different book and a funding rate of 0.00001 against 0.000039 on `e_btcusdt`, but the same index, P7.
So the socket serves contracts that are not in ZKE's catalog, which reads as a socket shared between ChainUp tenants, and that is an inference.
A feed must subscribe only the `subSymbol` values of ZKE's own catalog.

## 5. Session

- Keepalive: the server sends `{"ping": <seconds>}` on a 10 s beat, gzip compressed like every other frame, P10 and P11.
  The 90 s silence run got 5 pings, with gaps of 30 s and 20 s, and the 60 s rerun got all 6, while book frames kept arriving.
  The pong runs answered each ping with `{"pong": n}`, the pings went on, and a client `{"ping": ms}` got no answer of its own beyond the next scheduled ping, P11.
  The document says the client "needs to reply" or the server closes the connection, and also that the server "does not perform strict one-to-one verification", S14.
  So the engine's `AnswerPing` mode fits, where the client answers each server ping with `{"pong": n}`, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 77.
- Silence tolerated: a subscribed socket that never sent anything after the subscription stayed open for 90 s and 60 s, P10.
- Forced disconnects and maintenance notices: none seen and none documented.
- Compression: every data frame is binary gzip inside the WebSocket frame, as S14 says.
  The handshake reply carried no `Sec-WebSocket-Extensions` header, so permessage deflate was not negotiated.
  The adapter gunzips a frame that starts with the gzip magic and parses any other frame as JSON, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 292 to 296 and 384, which covers the echoed plain frame.
- Handshake and subscription limits: none documented and none hit.

## 6. Captured frames

The subscribe frame sent, as in S14:

```json
{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "market_e_btcusdt_depth_step0"}}
```

No acknowledgement arrives.
The first SOL depth frame, gunzipped and cut to three levels per side:

```json
{"event_rep": "", "channel": "market_e_solusdt_depth_step0", "data": null, "tick": {"asks": [[109.75, 1977], [109.77, 24845], [109.82, 66556]], "buys": [[109.64, 2225], [109.63, 6205], [109.62, 11533]]}, "ts": 1791606072000, "status": "ok", "timezone": ""}
```

The mark and funding frame:

```json
{"event_rep": "", "channel": "mark_price_e_btcusdt", "data": null, "tick": {"tagPrice": "82650", "indexPrice": "82687.57999999999540970", "currentFundRate": "0.0000390000000000", "nextFundRate": "0.000039", "nextSettlementTime": "1791619200000", "symbol": "e_btcusdt"}, "ts": 1791606072000, "status": "ok", "timezone": ""}
```

The keepalive, received as a gzip binary frame:

```json
{"ping": 1791606080}
```

The echo of an unknown event, received as a plain binary frame:

```json
{"event": "nope", "params": {"channel": "market_e_btcusdt_depth_step0"}}
```

## 7. Private channels

ZKE's WebSocket document lists no private channel, S14.
The ChainUp convention pushes orders and positions through a separate authenticated socket, which was not probed.

## 8. Recommended feed shape

The engine's ChainUp family adapter already has this shape, as its Koinbay profile, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 142 to 162.

- URL plan: one URL, `wss://futuresws.zke.com/kline-api/ws`, the one the web list names, for every perpetual.
- Markets per connection: all 205 with their depth and their mark ran on one socket, so one socket is enough for the books.
- Subscribe frames: one `sub` per contract for `market_<sub>_depth_step0`, with `Depth::Step0`.
- Anchor: the `mark_price_<sub>` stream cannot be trusted alone, because it stalled on half the sockets, section 2.
  Either the anchor comes from the REST sweep of `/fapi/v1/index`, see [`rest.md`](./rest.md) section 8, or the feed reopens a socket whose mark frames stop.
- Decoding: gunzip a frame that starts with the gzip magic, else parse it as JSON.
- Keepalive: `Keepalive::AnswerPing`.
- `maxSilenceMs`: 10 s, since every contract pushes its book several times a second, and a skipped ping does not leave the socket silent while books flow.
- Resync rule: none needed, since every frame is a whole book, and on a close the adapter reopens and resubscribes.
- Catalog: the raw id `e_btcusdt` comes out of the adapter's `socket_name` rule unchanged, see [`rest.md`](./rest.md) section 2.

## 9. Source ledger

| id | title | URL | retrieved | supports |
|---|---|---|---|---|
| S14 | ZKE API Docs, WebSocket | https://help.zke.com/api_en/websocket.md | 2026-10-09 | spot URL, subscribe shape, channels, ping, gzip, 30 levels |
| S15 | ZKE web config | https://www.zke.com/fePublicInfo/en_US | 2026-10-09 | the spot `wsUrl` |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) mode `catalog` | | 2026-10-09 | the futures `wsUrl` and `subSymbol` |
| P7 | [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py) modes `hosts` and `basic`, 3 s per host and 35 s, then 30 s | | 2026-10-09 | hosts, channels, frames, order, size against REST, unknown and other tenants' symbols |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py) mode `all`, 60 s, then 45 s | | 2026-10-09 | 205 contracts on one socket, mark frames |
| P9 | [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py) mode `marks`, 40 s on two sockets, then 25 s on three sockets twice | | 2026-10-09 | the mark stall |
| P10 | [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py) mode `silence`, 90 s, then 60 s | | 2026-10-09 | server pings, silence tolerated |
| P11 | [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py) mode `pong`, 50 s, then 35 s | | 2026-10-09 | answered pings and a client ping |
