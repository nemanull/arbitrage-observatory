# idax WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:26 to 02:46 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public futures WebSocket of idax, which has no CCXT class, for its USDT margined perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/idax/ws-probe.py) unless a source id says otherwise.
Source ids are shared with [`fees.md`](./fees.md) and [`rest.md`](./rest.md).
The socket is the ChainUp kline-api socket, the same protocol the engine already reads for FameEX, x.me and Koinbay in [`chainup.rs`](../../../server/src/venues/chainup.rs).
Nothing was refused from the Canadian exit.

## 1. Endpoints

| family | URL | where it is named | probed |
|---|---|---|---|
| USDT margined perpetuals | `wss://futuresws.idax.exchange/kline-api/ws` | `wsUrl` of the futures web list, P3 | open in 328 to 1,334 ms, and under 380 ms on all but one of ten opens, no refusal, P7 to P10 |
| spot | `wss://ws.idax.exchange/kline-api/ws` | `wsUrl` of the web config, S11 | not probed |

One socket carries every perpetual, and the symbol in the channel name selects the contract.
`futuresws.idax.exchange` resolves to Cloudflare, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | probed |
|---|---|---|
| `market_<sub>_depth_step0` | the unaggregated book, 30 levels per side, `asks` and `buys` | 72, 48 and 105 BTC frames in 35 s in three runs, recommended |
| `market_<sub>_depth_step1` | the same 30 level book on a coarser step, whole dollars on BTC | 72, 75 and 104 BTC frames in 35 s |
| `market_<sub>_ticker` | 24 h `vol`, `rose`, `open`, `low`, `high`, `close`, `amount`, and no bid or ask | 48, 43 and 60 BTC frames in 35 s |
| `mark_price_<sub>` | `tagPrice`, `indexPrice`, `currentFundRate`, `nextFundRate`, `nextSettlementTime`, `symbol`, all strings | 26 and 56 frames per contract in 60 s on all 204 in two runs, and it rides along with a depth subscription |
| `market_<sub>_trade_ticker` | trades with price, size, side and ms time | 42, 35 and 53 BTC frames in 35 s |
| `market_<sub>` with no suffix | none | no frame |

No best bid and ask channel exists, S9.
`mark_price_e_solusdt` sent 18 and 33 frames in two runs on a socket that subscribed only `market_e_solusdt_depth_step0` for SOL, P7.
The `mark_price_` channel is not in the ChainUp document, S9, and is on the wire.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | `wss://ws.<domain>/kline-api/ws` in the document, S9, and a separate futures host in the web list, P3 | one futures URL for all 204 contracts |
| subscribe frame shape | `{"event":"sub","params":{"channel":"...","cb_id":"..."}}`, one channel per frame, S9 | 408 frames in one burst, every one delivered, P8 |
| unknown symbol expectation | Not publicly specified | `market_e_nopeusdt_depth_step0`, `mark_price_e_nopeusdt` and the REST spelling `market_E-ETH-USDT_depth_step0` got no frame in 35 s, in every run that sent them, P7 |
| chunk unit and budget | Not publicly specified | 408 subscriptions on one socket, no refusal and no close in 60 s, in two runs, P8 |
| keepalive mechanism | the server pushes `{"ping": <seconds>}` every 10 s, the client "can decide whether to process it", and a reply of `{"pong": <seconds>}` is recommended, S9 | `{"ping":1791599207}` as a gzip binary frame, mostly 10 s apart with some slots skipped, P7, P9 and P10 |
| connection lifetime and maintenance notice | Not publicly specified | a socket that never answered a ping stayed open for the whole 90 s test, in two runs, P9 |
| handshake and operation rate limits | Not publicly specified | about ten opens over the session, no refusal |
| public market data authentication | none, S9 | none |
| message parse and routing | `channel` names the stream, S9 | envelope `{event_rep, channel, data, tick, ts, status, timezone}`, route by `channel` |
| subscribe acknowledgement shape | Not publicly specified | no acknowledgement for any `sub` |
| symbol identifier format | `market_$symbol_depth_step0`, S9 | `e_btcusdt`, the web list's `subSymbol`, which is the REST name lower cased with the first dash turned into `_` and the other removed on all 205 rows, P3 |
| number representation | Not publicly specified | depth levels `[price, size]` as JSON numbers, `mark_price_` and ticker values as strings |
| timestamp representation | Not publicly specified | envelope `ts` in ms rounded to the whole second, ping value in seconds |
| size unit | Not publicly specified | contracts, the same integers as REST `/fapi/v1/depth`, P7, and one contract is `multiplier` of the base, see section 4 |
| sequence semantics | none documented | none on the wire, every frame is a whole book |
| idle repeat behaviour | Not publicly specified | BTC repeated the previous book on 51 of 72, 23 of 48 and 41 of 105 frames, and every one of 204 contracts sent at least 75 book frames in 60 s, P7 and P8 |

## 4. The book channel in detail

`market_<sub>_depth_step0` is the channel this profile recommends.

### Snapshot on subscribe

All 204 contracts delivered their first book within 0.4 s and 0.6 s of the subscribe burst in two runs, P8.
Every frame is a whole 30 level book, so there is no delta stream.

### Delta semantics

None.
Each `tick` replaces the book.

### Sequence and gap rule

No sequence field exists, so no gap can be detected and no resync on gap is needed.
The envelope `ts` has whole second resolution, 25 distinct values over 48 BTC frames and 36 over 105, so it cannot order two frames within one second.

### Checksum

None.

### Level order on the wire

`asks` ascending and `buys` descending on every BTC frame of three runs, P7.
Bids are named `buys` on the socket and `bids` on REST.

### Level window

30 levels per side on every BTC frame of three runs, P7.
The engine wants 20, so 30 covers it.
REST gives up to 100, see [`rest.md`](./rest.md) section 5.

### Size unit

There is no CCXT market, so the unit comes from the catalog.
In two of three runs the socket's top three bids and asks had the same prices and sizes as a REST read made during the run, and in the other one bid size differed, P7.
So sizes are integer contracts, and one contract is `multiplier` units of `multiplierCoin`, 0.0001 BTC on `E-BTC-USDT`, see [`rest.md`](./rest.md) section 2.
`E-SHIB-USDT` and `E-PEPE-USDT` quote a price per 1,000 tokens, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

None seen among the 204 contracts on the socket.
`E-BSV-USDT`, live in the open API catalog and absent from the web list, was not subscribed, see [`rest.md`](./rest.md) section 2.

### Idle repeats

A BTC frame came every 0.28 to 0.46 s at the median in three runs, and 39 % to 71 % of them repeated the previous book.
In 60 s every contract sent between 75 and 225 book frames, median 139, and between 79 and 223, median 143, in the rerun, P8.
So a silent contract on idax means a lost subscription, unlike Koinbay, where a static book sends nothing, as the adapter notes at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 154.

### Unknown, closed and wrong-level symbols

No error is returned for an unknown or wrongly spelled channel, P7.
An unknown `event`, such as `{"event":"nope",...}`, is echoed back unchanged as a plain JSON binary frame, not gzip, P7.

## 5. Session

- Keepalive: the server sends `{"ping": <seconds>}` on a 10 s beat, gzip compressed like every other frame, P9 and P10.
  Some beats carry no ping, so gaps of 14, 20 and 30 s were seen, and the 50 s pong run got 6 pings in the first pass and 3 in the second.
  A client `{"pong": <ms>}` sent every 15 s got no answer of its own, and the server's pings went on, P10.
  So the engine's `AnswerPing` mode fits, where the client answers each server ping with `{"pong": n}`, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 77.
- Silence tolerated: a subscribed socket that never sent anything after the subscription stayed open for the whole 90 s, in two runs, P9.
- Forced disconnects and maintenance notices: none seen and none documented.
- Compression: every data frame is binary gzip inside the WebSocket frame, as S9 says.
  The handshake reply carried no `Sec-WebSocket-Extensions` header, so permessage deflate was not negotiated.
  The adapter gunzips a frame that starts with the gzip magic and parses any other frame as JSON, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 294 to 305, which covers the echoed plain frame.
- Handshake and subscription limits: none documented and none hit.

## 6. Captured frames

The subscribe frame sent, as in S9:

```json
{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "market_e_btcusdt_depth_step0"}}
```

No acknowledgement arrives.
The first SOL depth frame, gunzipped and cut to three levels per side:

```json
{"event_rep": "", "channel": "market_e_solusdt_depth_step0", "data": null, "tick": {"asks": [[109.81, 850], [109.86, 36052], [109.88, 53846]], "buys": [[109.7, 11029], [109.69, 12680], [109.68, 14887]]}, "ts": 1791599630000, "status": "ok", "timezone": ""}
```

The mark and funding frame:

```json
{"event_rep": "", "channel": "mark_price_e_btcusdt", "data": null, "tick": {"tagPrice": "82592", "indexPrice": "82633.79999999999541280", "currentFundRate": "0.0000290000000000", "nextFundRate": "0.000029", "nextSettlementTime": "1791619200000", "symbol": "e_btcusdt"}, "ts": 1791599205000, "status": "ok", "timezone": ""}
```

The keepalive, received as a gzip binary frame:

```json
{"ping": 1791599207}
```

The echo of an unknown event, received as a plain binary frame:

```json
{"event": "nope", "params": {"channel": "market_e_btcusdt_depth_step0"}}
```

## 7. Private channels

The ChainUp document lists private socket pages for asset changes, orders and positions, S7.
They were not probed.

## 8. Recommended feed shape

The engine's ChainUp family adapter already has this shape, as its Koinbay profile, at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 142 to 162.

- URL plan: one URL, `wss://futuresws.idax.exchange/kline-api/ws`, for every perpetual.
- Markets per connection: all 204 with their depth and their mark ran on one socket, so 100 per socket as on Koinbay leaves room.
- Subscribe frames: one `sub` per contract for `market_<sub>_depth_step0`, with `Depth::Step0`.
  The mark rides along, so no second subscription is needed, and the adapter subscribes `mark_price_<sub>` anyway for the `MarkPrice` anchor.
- Decoding: gunzip a frame that starts with the gzip magic, else parse it as JSON.
- Keepalive: `Keepalive::AnswerPing`.
- `maxSilenceMs`: 10 s would do, since every contract pushes about twice a second, and the book frames keep a socket busy when a ping is skipped.
- Resync rule: none needed, since every frame is a whole book, and on a close the adapter reopens and resubscribes.
- Anchor: the `mark_price_` frames, see [`rest.md`](./rest.md) section 8.

## 9. Source ledger

| id | title | URL | retrieved | supports |
|---|---|---|---|---|
| S7 | ChainUp Open API v2, overview | https://exchangedocsv2.gitbook.io/open-api-doc-v2/ | 2026-10-09 | private socket pages, section 7 |
| S9 | ChainUp Open API v2, WebSocket | https://exchangedocsv2.gitbook.io/open-api-doc-v2/websocket | 2026-10-09 | subscribe shape, channels, ping, gzip |
| S11 | idax web config | https://www.idax.exchange/fePublicInfo/en_US | 2026-10-09 | the spot `wsUrl` |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/idax/rest-probe.py) mode `catalog` | | 2026-10-09 | the futures `wsUrl` and `subSymbol` |
| P7 | [`ws-probe.py`](../../../scripts/probes/venues/idax/ws-probe.py) mode `basic`, 35 s | | 2026-10-09 | channels, frames, order, size against REST, unknown symbols |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/idax/ws-probe.py) mode `all`, 60 s | | 2026-10-09 | 204 contracts on one socket, mark frames |
| P9 | [`ws-probe.py`](../../../scripts/probes/venues/idax/ws-probe.py) mode `silence`, 90 s | | 2026-10-09 | server pings, silence tolerated |
| P10 | [`ws-probe.py`](../../../scripts/probes/venues/idax/ws-probe.py) mode `pong`, 50 s | | 2026-10-09 | client pong behaviour |
