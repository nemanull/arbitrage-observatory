# IMBX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:20 to 04:35 UTC on 2026-09-23, from the development host near Seattle through a Surfshark WireGuard exit that geolocates to Canada, and the second pass at 05:04 to 05:06 UTC was refused by a load balancer block, see [`rest.md`](./rest.md) section 6.

This profile covers the public futures socket of IMBX, which carries all 29 USDT-margined perpetuals, with the book channel in detail.
IMBX publishes no API documentation, see [`fees.md`](./fees.md) section 8.
The URL, the frames and the channel names are the ones IMBX's own web client uses, read from its bundles, S1, and every behaviour below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/imbx/ws-probe.mjs).
So the "documented" column of section 3 is the web client's code where it shows something, and Not publicly specified otherwise.
The second pass could not rerun the probe, because the load balancer refused every socket from 04:37 UTC, see [`rest.md`](./rest.md) section 6, so every number here was checked against the first runs' output instead.
The protocol is the one of the ChainUP white label exchange platform, a reading from the `kline-api/ws` path, the `market_<symbol>_depth_step<n>` channel names and the `e_` futures prefix, which no IMBX page confirms.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://futuresws.imbx.io/kline-api/ws`, the `futures` entry of the client's socket map and the `wsUrl` of the futures `public_info`, S1 | 101 in 362 to 420 ms with `User-Agent: node`, 403 with none or with a curl one, P1. All 29 contracts delivered on one socket, P3 |
| spot | `wss://ws.imbx.io/kline-api/ws`, S1 | 101 with `User-Agent: node`, 403 without, P1. Not probed further |
| private, protobuf | `wss://newws.imbx.io/ws/v3`, opened with an `authenticate` message carrying the `accessToken` cookie, S1 | not probed |

One socket carries every perpetual, since there is one futures family.
The hosts resolve to the same two addresses as the REST hosts, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscribe `params` | depth and speed | probed |
|---|---|---|---|
| `market_e_<sym>_depth_step0` | `{"channel": "market_e_btcusdt_depth_step0", "cb_id": "e_btcusdt"}` | 30 levels per side, a whole book per push, 3.1 to 3.5 pushes a second on BTC and ETH, 1.6 to 1.9 on COPPER and NVDA | recommended, section 4 |
| `market_e_<sym>_depth_step1` | same, step 1 | 30 levels aggregated to the next price step, `87108` and `87106` against a 0.1 tick | 12 to 14 pushes in 4 s |
| `market_e_<sym>_depth_step5` | same, step 5 | none | one frame with empty `asks` and `buys` |
| `market_e_<sym>_ticker` | `{"channel": "market_e_btcusdt_ticker", "cb_id": "e_btcusdt"}` | 24 h `open`, `high`, `low`, `close`, `vol`, `amount`, `rose` as strings | 1.4 to 1.7 frames a second on BTC, no mark, index or funding |
| `market_e_<sym>_trade_ticker` | same | trades with `price`, `vol`, `amount`, `side`, `ts` in ms and `ds` | 1.2 to 1.5 frames a second on BTC |
| `market_e_<sym>_kline_<period>` | same shape, S1 | candles | not probed |

No mark, index or funding channel exists in the client, S1.
The futures page reads those from REST every 4 s, see [`rest.md`](./rest.md) section 3.
The `<sym>` is the catalog's `subSymbol`, lower case, such as `e_btcusdt`, see [`rest.md`](./rest.md) section 2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | spot and futures on separate hosts, S1 | one futures URL for all 29 perpetuals |
| subscribe frame shape | `{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "e_btcusdt"}}`, one channel per frame, S1 | 29 frames sent back to back on one socket, all 29 delivered within 243 ms, P3 |
| unknown symbol expectation | Not publicly specified | `market_e_nopeusdt_depth_step0` answers one frame with `"status": "ok"` and empty `asks` and `buys`, then nothing. An unknown channel type `market_e_btcusdt_nope` answers nothing, P2 |
| chunk unit and budget | Not publicly specified | 29 subscriptions on one socket, no refusal, P3 |
| keepalive mechanism | the client answers a server `{"ping": n}` with `{"pong": n}` and also sends `{"ping": <ms>}` every 5 s, S1 | server `{"ping": <unix s>}` every 10.0 s on a subscribed socket, none on an unsubscribed one. A client `{"ping": <ms>}` is answered `{"pong": <same>}` in 135 to 137 ms, P2, P4 |
| connection lifetime and maintenance notice | Not publicly specified | a socket that answers pings stayed open the full 120 s. No maintenance frame seen, P4 |
| handshake and operation rate limits | Not publicly specified | the load balancer refuses the upgrade with 403 when the User-Agent is missing or curl's, and refused every upgrade from 04:37 UTC after a burst of REST calls, section 5 |
| public market data authentication | none | none |
| message parse and routing | gzip inside a binary frame, then JSON routed on `channel`, S1 decodes before parsing | 782 and 789 frames per 60 s run, every one a gzip member in a binary message, P2 |
| subscribe acknowledgement shape | none in the client | no acknowledgement. The first data frame arrives 136 to 147 ms after the subscribe, P2 |
| symbol identifier format | `market_` + `e_` + lower case `subSymbol` + `_depth_step0`, S1 | `e_btcusdt` for the catalog's `E-BTC-USDT`, three spellings in all, see [`rest.md`](./rest.md) section 2 |
| number representation | Not publicly specified | depth levels are JSON numbers `[87024.6, 8629]`. Ticker and trade fields are strings |
| timestamp representation | Not publicly specified | envelope `ts` in ms, truncated to the whole second on 100 % of 1,557 frames over two runs. Trade `ts` has full ms |
| size unit | Not publicly specified | contracts of the catalog's `multiplier`, an inference from the ticker, section 4 |
| sequence semantics | none | no sequence number, update id or checksum in any frame |
| idle repeat behaviour | Not publicly specified | the whole book is pushed again when nothing changed: 18 and 19 identical consecutive frames on COPPER per 60 s, 14 and 23 on NVDA, 6 to 8 on BTC |

## 4. The book channel in detail

`market_e_<sym>_depth_step0` is the only book channel with the finest step, and every row below is about it.

### Snapshot on subscribe

Every frame is a snapshot.
The first frame arrives 136 to 147 ms after the subscribe, and each later frame is again 30 bids and 30 asks, P2.
There is no delta, so a feed replaces the book on every frame.

### Delta semantics

None.
A frame holds `tick.buys` and `tick.asks`, each an array of `[price, size]` number pairs, and `buys` is IMBX's name for bids.

### Sequence and gap rule

No frame carries a sequence number, an update id, or a checksum, P2.
A lost frame is invisible, and the next frame repairs the book, since it is whole.
A frame older than the last one applied cannot be recognised either, because `ts` has one second resolution.

### Checksum

None.

### Level order on the wire

| side | order | evidence |
|---|---|---|
| `buys` | best first, descending | 0 frames out of order in 1,211 depth frames over two runs on four contracts, P2 |
| `asks` | best first, ascending | 0 frames out of order in the same frames, P2 |

### Crossed tops

Some frames are crossed at the top.
BTC had 6 and 2 frames per 60 s run whose best bid was at or above the best ask, and ETH had 5 and 1, while COPPER and NVDA had none, P2.
In each captured case only the top one or two bids were at or above the best ask, and the other 29 bids, or 28 on ETH, were below it.
The probe's log line for the first BTC case, with three levels per side kept, follows.

```json
{"ch":"market_e_btcusdt_depth_step0","ts":1790137853000,"bids":[[87072,22554],[87069.1,7877],[87069,18902]],"asks":[[87071.4,9683],[87071.5,8909],[87071.6,11940]],"bidsBelowBestAsk":29}
```

A crossed venue book is exactly the reading an arbitrage engine mistakes for an opportunity, so a feed would have to drop or uncross such a frame.

### Level window

30 per side on every frame of every contract, including COPPER and NVDA, P2 and P3.
That covers the engine's 20 levels at [`../../../server/src/engine/Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61.

### Size unit

No CCXT class exists to compare with, see [`fees.md`](./fees.md) section 8.
The catalog gives each contract a `multiplier` in its `multiplierCoin`, such as 0.0001 BTC for `E-BTC-USDT`, 0.01 ETH, 0.1 COPPER and 0.01 NVDA, see [`rest.md`](./rest.md) section 2.
The socket sizes are contracts, an inference from two frames.
The BTC ticker reported `vol` 56,678,287 and `amount` 4,878,765,577,786.4 over 24 h, whose ratio 86,078 lies inside that day's range of 85,080 to 87,205.4, so `vol` counts units whose `amount` is `vol × price`, and 56.7 million BTC in a day is not possible.
A BTC trade read `vol` "4", `price` "87034" and `amount` "348136", which is 4 times the price.
So a BTC size of 8,629 at the touch is 0.8629 BTC, if the book uses the ticker's unit.
No REST book with sizes exists to confirm it, see [`rest.md`](./rest.md) section 5.
The best bid and ask prices matched the REST `price_list` `buyOne` and `sellOne` on 8 of 8 reads, P2.

### One-sided and empty books

No live contract was one-sided or empty in two runs, P2.
The delisted `E-STX-USDT`, still listed by the funding endpoints, answered `"asks":[[0.6923,5]]` and `"buys":[[0,0]]`, a zero price placeholder rather than an empty side, P2.

### Idle repeats

The whole book is resent unchanged, section 3.
COPPER and NVDA went at most 2,278 and 1,952 ms between frames, P2.

### Unknown, closed and wrong-step symbols

| request | reply | then |
|---|---|---|
| `market_e_nopeusdt_depth_step0` | one frame, `"tick":{"asks":[],"buys":[]}`, `"status":"ok"` | nothing |
| `market_e_btcusdt_depth_step5` | one empty frame, `"status":"ok"` | nothing |
| `market_e_stxusdt_depth_step0`, delisted | one frame with `[[0,0]]` bids | nothing in 4 s |
| `market_e_btcusdt_nope` | nothing | |
| the same `sub` twice | no second stream, no identical twin frames within 5 ms in 4 s | the first keeps delivering |
| `{"event": "unsub", …}` on ETH | no reply | ETH stops, one frame in 4 s |
| `{"event": "nope", …}` | the request echoed back unchanged | the socket stays open |
| `{"event": "req", …}` on a depth channel | nothing beyond the running stream | |
| text that is not JSON | nothing | the socket stays open |

A feed has to treat an empty first frame as an unknown symbol, since the status says ok.

## 5. Session

| item | client code, S1 | probed |
|---|---|---|
| keepalive | answers `{"ping": n}` with `{"pong": n}`, sends `{"ping": Date.now()}` every 5 s and reconnects when no data arrives within 3 s of it | server pings every 10.0 s, first 1.9 to 8.9 s after the subscribe, values in Unix seconds such as `{"ping":1790137476}`, P2, P4 |
| silence the server tolerates | Not publicly specified | a subscribed socket that did not answer pings was closed at 60.56 s with 1006 and no close frame. A socket with no subscription got no ping and was closed at 60.41 s with 1006. A socket answering pings stayed 120 s, P4 |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | the client sets `binaryType` `arraybuffer` and decodes every frame, S1 | every frame is gzip inside a binary message. A client that offered permessage-deflate got `permessage-deflate; server_no_context_takeover; client_no_context_takeover`, and the payload was still gzip inside, P1 |
| handshake | | 362 to 420 ms to open with `User-Agent: node`. A missing or curl User-Agent gets HTTP 403 from `awselb/2.0` with a `403 Forbidden` HTML body, P1 |
| volume block | Not publicly specified | from 04:37 UTC the upgrade got the same 403 with `User-Agent: node`, after the REST burst of [`rest.md`](./rest.md) section 6, and it still did at 05:05 UTC, P5 |
| subscription limits | Not publicly specified | 29 on one socket, no cap reached, P3 |
| throughput | | 29 perpetuals on one socket: 66.1 frames per second, median 64, peak 87, 25.8 KB per second on the wire and 62.3 KB per second after gunzip, 400 bytes per wire frame, gunzip plus `JSON.parse` 71 µs at the median and 270 µs at p99, P3 |

## 6. Captured frames

Decoded from gzip, from the runs of 2026-09-23.
Level arrays are cut to three levels.

Subscribe, and there is no acknowledgement.

```json
{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "e_btcusdt"}}
```

Book frame, every push has this shape with 30 levels per side.

```json
{"event_rep":"","channel":"market_e_btcusdt_depth_step0","data":null,"tick":{"asks":[[87024.6,8629],[87024.7,4460],[87024.8,6359]],"buys":[[87023.5,21503],[87023.4,18788],[87023.3,19473]]},"ts":1790137812000,"status":"ok"}
```

Unknown symbol.

```json
{"event_rep":"","channel":"market_e_nopeusdt_depth_step0","data":null,"tick":{"asks":[],"buys":[]},"ts":1790137872000,"status":"ok"}
```

Delisted symbol.

```json
{"event_rep":"","channel":"market_e_stxusdt_depth_step0","data":null,"tick":{"asks":[[0.6923,5]],"buys":[[0,0]]},"ts":1790137884000,"status":"ok"}
```

Server ping, and the answer the client sends.

```json
{"ping":1790137476}
```

```json
{"pong":1790137476}
```

Client ping, and the server's answer.

```json
{"ping":1790137857652}
```

```json
{"pong":1790137857652}
```

Unknown event, echoed back.

```json
{"event":"nope","params":{"channel":"market_e_ethusdt_depth_step0","cb_id":"e_ethusdt"}}
```

Ticker and trade.

```json
{"event_rep":"","channel":"market_e_btcusdt_ticker","data":null,"tick":{"amount":"4878765577786.4","close":"87024","high":"87205.4","low":"85080","open":"85520.1","rose":"0.0176","vol":"56678287"},"ts":1790137812000,"status":"ok"}
```

```json
{"event_rep":"","channel":"market_e_btcusdt_trade_ticker","data":null,"tick":{"data":[{"amount":"348136","ds":"2026-09-23 04:30:13","price":"87034","side":"SELL","ts":1790137813067,"vol":"4"}],"ts":1790137813000},"ts":1790137813000,"status":"ok"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They run on `wss://newws.imbx.io/ws/v3` as protobuf messages after an `authenticate` message with the session's access token.
The client decodes `FuturesAccountMessage`, `FuturesOrderListMessage`, `FuturesOrderMessage`, `SpotAccountMessage`, `SpotAccountDataMessage`, `SpotAssetListMessage`, `SpotAssetMessage`, `SpotOrderListMessage` and `SpotOrderMessage`.
No order entry over a socket and no API key scheme is public, since the open API host does not answer, see [`rest.md`](./rest.md) section 1.

## 8. Recommended feed shape

A sketch for a later design, not a decision, and not a recommendation to build it, see [`rest.md`](./rest.md) section 8 for the verdict.

| item | sketch | reason |
|---|---|---|
| URL plan | one plan, `wss://futuresws.imbx.io/kline-api/ws` | one family |
| handshake | send a `User-Agent` header | the load balancer refuses a socket without one, and the engine opens sockets with only `{ perMessageDeflate: false }` at [`../../../server/src/feeds/book/VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81, so this is a change to shared code |
| channel | `market_<subSymbol>_depth_step0` | the finest step, 30 levels |
| markets per connection | 29, all of them | one socket carried all 29 at 66 frames per second |
| subscribe frames | one `{"event": "sub", "params": {"channel": …, "cb_id": <subSymbol>}}` per market | the client sends one channel per frame |
| decode | `zlib.gunzipSync` on the `Buffer` before `JSON.parse` in `handleMessage` | every frame is gzip inside, and `handleMessage` already receives a `Buffer` at [`../../../server/src/feeds/book/VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 209 |
| keepalive | answer `{"ping": n}` with `{"pong": n}` inside `handleMessage`, and no timer in `startKeepalive` | an unanswered socket dies at 60 s |
| `maxSilenceMs` | 30,000 | the server pings every 10 s once subscribed, and the ping counts as traffic |
| routing | strip `market_` and `_depth_step0` from `channel` to get `subSymbol`, then map to the catalog key | three spellings of one contract |
| snapshot | every frame: `resetBook`, `setBid` and `setAsk` for 30 levels, `publish` | no deltas |
| sequence | none, no `resync` on a gap | there is no gap to see |
| crossed frame | drop a frame whose best bid is at or above its best ask | 1 to 6 crossed frames per minute on BTC and ETH |
| unserved stream | log a stream whose first frame is empty | unknown symbols answer an empty ok frame |
| receive time | stamp on arrival, never from `ts` | `ts` is truncated to the second |
| sizes | multiply by the catalog `multiplier`, once confirmed | the unit is an inference |
| deflate | keep `perMessageDeflate: false` | the payload is gzip anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | IMBX web client bundles, chunks `4313-f76e79e21745dc68.js` (socket URLs), `2666-faf07c25c3e5980f.js` (futures socket manager, subscribe frames, ping and pong, timers), `1318-b540e31a5c5eabeb.js` (ticker socket), `661-afe77b9893bfeab8.js` (private protobuf socket) | https://www.imbx.io/_next/static/chunks/ | 2026-09-23 | IMBX web client | URLs, frame shapes, channel names, keepalive, private messages, sections 1 to 7 |
| P1 | `ws-probe.mjs ua` at 04:24 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/imbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | User-Agent refusals, deflate offer, sections 1, 3 and 5 |
| P2 | `ws-probe.mjs book`, two runs at 04:24 and 04:30 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/imbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | book frames, order, crossed tops, repeats, errors, pings, sections 2 to 6 |
| P3 | `ws-probe.mjs batch` at 04:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/imbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | 29 streams on one socket, throughput, section 5 |
| P4 | `ws-probe.mjs silence` at 04:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/imbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | silence tolerance, ping cadence, section 5 |
| P5 | `ws-probe.mjs` all four modes, second pass at 05:04 to 05:05 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/imbx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | the block: every upgrade 403 whatever the User-Agent, section 5 |
