# OmniX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 06:39 to 06:59 UTC), from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public futures market socket of OmniX, the rebranded CoinChief, which has no CCXT class, see [`fees.md`](./fees.md) section 8.
The socket is the ChainUP futures socket that the venue's own contract config names, see [`rest.md`](./rest.md) section 1.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/omnix/ws-probe.mjs), and the capture is quoted beside the documented value.
Source ids are shared with [`fees.md`](./fees.md) and [`rest.md`](./rest.md).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals, the only family | `wss://futuresws.<domain>/kline-api/ws`, S8, and `wsUrl` `wss://futuresws.coinchief.live/kline-api/ws` in the web contract list, P2 | open in 274 to 304 ms over four sockets, all 45 contracts deliver |
| spot | `wss://ws.coinchief.live/kline-api/ws`, the `wsUrl` of the OmniX site config, S4 | not probed |
| an OmniX host | none | `futuresws.omnix.vin` resolves by the Cloudflare wildcard of `omnix.vin`, and `https://futuresws.omnix.vin/kline-api/ws` answered nginx 404 to `curl` at 06:29 UTC |

One socket carries the whole futures catalog, since the venue has one family.
Both hosts resolve to Alibaba Cloud's edge, see [`rest.md`](./rest.md) section 1.
Nothing was refused from the Canadian VPN exit.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed |
|---|---|---|---|
| `market_e_<coin>usdt_depth_step0` | `{"event":"sub","params":{"channel":…,"cb_id":…}}` | "A maximum of 30 orders are returned", S8 | a full 30 level book per frame, 1.3 to 1.7 frames a second on a busy contract, recommended |
| `market_e_<coin>usdt_depth_step5` | same | not documented | one frame with empty `asks` and `buys`, then nothing |
| `market_e_<coin>usdt_trade_ticker` | same | on trade | trades with a millisecond `ts` |
| `market_e_<coin>usdt_ticker` | same | 24 h statistics | `amount`, `close`, `high`, `low`, `open`, `rose`, `vol`. The first 30 non-book frames of each 60 s BTC run held 19 and 20 ticker frames and 10 and 9 trade frames |
| `market_e_<coin>usdt_kline_<period>` | same | kline | not probed |
| best bid and ask, mark, index, funding | none | | no such channel is documented, S5, S7 and S8 |

The channel names come from S5 and S8, and the futures prefix `e_` from S8, "合约:e_btcusdt".
Mark, index and funding are only on REST, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one futures URL per domain, S8 | one URL carries all 45 contracts |
| subscribe frame shape | `{"event":"sub","params":{"channel":"market_$symbol_depth_step0","cb_id":"1"}}`, one channel per frame, S8 | as documented, 45 frames on one socket were all served |
| unknown symbol expectation | Not publicly specified | `market_e_nopeusdt_depth_step0` gets one frame with empty `asks` and `buys` and `"status":"ok"`, then nothing, so it looks like an empty book |
| chunk unit and budget | Not publicly specified | 45 subscriptions on one socket, all delivering |
| keepalive mechanism | "The server actively pushes ping messages every 10 seconds", `{"ping": timestamp (seconds)}`, answered by `{"pong": …}`, S5 | a gzipped `{"ping":1790145583}` every 9,998 to 10,002 ms, only on a socket that has subscribed |
| connection lifetime and maintenance notice | Not publicly specified | no notice seen, and no socket was closed by the server in 120 s once it had subscribed |
| handshake and operation rate limits | Not publicly specified | no refusal at 45 subscribe frames in one burst |
| public market data authentication | none | none |
| message parse and routing | every frame "will be binary compressed", gunzip it, S5 and S8 | every server frame, ping included, is a binary gzip member. Route on `channel` |
| subscribe acknowledgement shape | not documented | no acknowledgement frame is sent. The first data frame arrived 202 to 209 ms after the subscribe |
| symbol identifier format | `btcusdt` for spot and `e_btcusdt` for futures, S8 | `e_btcusdt`, the web list's `subSymbol`, not the REST `E-BTC-USDT` |
| number representation | numbers in the examples, S8 | depth price and size are JSON numbers. Ticker and trade fields are strings |
| timestamp representation | `ts` in ms | depth `ts` is always a whole second. Trade `ts` inside `tick.data` has milliseconds |
| size unit | Not publicly specified | contracts of `multiplier` coins, an inference, section 4 |
| sequence semantics | none | no sequence, update id or checksum field in any frame |
| idle repeat behaviour | not documented | 0 to 2 frames per minute repeated the previous book exactly on a busy contract |

## 4. The book channel in detail

`market_e_<coin>usdt_depth_step0` is the only depth channel that served data, and every row below is about it.

### Snapshot on subscribe

Every frame is a whole book, so the first frame is a snapshot and so is each later one.
Every frame on BTC, ETH, SOL and SYNX held exactly 30 bids and 30 asks, in both book runs.
The first frame arrived 202 to 209 ms after the subscribe frame was sent.

### Delta semantics

There are no deltas.
Each frame replaces the book.
The documentation calls the channel "Subscription Full Depth", S8.

### Sequence and gap rule

No sequence exists, so a gap cannot be detected.
Frames came at a median `ts` step of 1,000 ms, and the longest wait between two frames on a busy contract was 1,011 to 1,449 ms.
A feed replaces the book on every frame and relies on the silence watch for a dead stream.

### Checksum

None documented and none on the wire.

### Level order on the wire

| frame | bids, `buys` | asks |
|---|---|---|
| socket | best first, descending, on every frame of every contract | best first, ascending, on every frame |
| REST `depth` | descending | ascending |

The bid side is named `buys`, not `bids`.

### Level window

Thirty levels per side, which covers the engine's 20, at [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61.

### Size unit against the contract multiplier

No CCXT `contractSize` exists to compare against, see [`rest.md`](./rest.md) section 2.
At one instant the socket's BTC book, 286 ms old, and a REST book of 30 levels shared 58 of 60 prices, and 50 of those 58 had the same size.
In the rerun the socket's book was 257 ms old, and 49 of 55 shared prices had the same size.
Both reads of the first run showed a best bid of 1,527,788 at 86,488.6 and a best ask of 414,341 at 86,488.7.
As contracts of 0.0001 BTC the best bid is 152.8 BTC, and as coins it would be 1.5 million BTC, so the unit is contracts, an inference no document states.
The trade channel's `amount` is `vol` times price with no multiplier, `131` at `86491.7` giving `11330412.7`, so `amount` is not a quote amount.

### One-sided and empty books

`E-GNO-USDT`, `E-MATIC-USDT` and `E-YFI-USDT` sent 3 frames each in 60 s in both batch runs.
The REST books of `E-MATIC-USDT` and `E-YFI-USDT` held one bid and one ask, see [`rest.md`](./rest.md) section 5, and `E-GNO-USDT` was not read on REST.
An unknown contract gets a frame whose `asks` and `buys` are both empty, so an empty frame cannot be told from an unknown symbol.
The engine's `resetBook` accepts an empty side, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 263.

### Idle repeats

A busy book repeats itself rarely.
In the first run 1 of 102 BTC frames, 2 of 97 ETH frames and 1 of 80 SYNX frames were identical to the previous frame, and in the rerun 1 of 99, 0 of 96 and 0 of 81.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `market_e_nopeusdt_depth_step0` | one frame, empty `asks` and `buys`, `"status":"ok"` | nothing |
| `market_e_btcusdt_depth_step5` | one frame, empty `asks` and `buys` | nothing |
| `market_btcusdt_depth_step0`, a spot name on the futures socket | one frame of 30 levels a side | nothing more in 58 s |
| `market_e_btcusdt_depth_step0` a second time | nothing | the first subscription keeps delivering |
| `market_e_btcusdt_nope` | nothing | |
| text that is not JSON | nothing | the socket stays open |
| `unsub` of `market_e_solusdt_depth_step0` | no reply | the last frame came 657 ms before the `unsub` was sent in one run and 192 ms after it in the other, and none later |

No error frame was ever sent.
A feed has to notice on its own a stream whose frames are empty.

### Freshness

In the rerun, 10 trades arrived 99 to 165 ms after their own `ts`, median 101 ms, with the server clock within 9 ms of this host's, see [`rest.md`](./rest.md) section 7.
Depth frames arrived 103 to 1,248 ms after their whole-second `ts`, so `ts` cannot place the book's own delay more closely than that.
The book itself was not compared against another venue's book for lateness.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server `{"ping": <seconds>}` every 10 s, client `{"pong": <same>}`, "the server does not perform strict one-to-one verification", S5 | pings every 9,998 to 10,002 ms, gzipped, only after a subscription |
| silence the server tolerates | Not publicly specified | a socket that never subscribed closed at 29,997 to 30,007 ms with code 1006 and no close frame, whether or not it was ready to pong, and it received no ping. A subscribed socket that never answered a ping stayed open for the full 120 s with 12 pings |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | gzip inside every frame, S5 and S8 | every server frame is a gzip member in a binary frame, about 2.15 times smaller than its JSON. The client's permessage-deflate offer was not negotiated, since the reply had no `sec-websocket-extensions` header |
| handshake | | 274 to 304 ms |
| subscription limits | Not publicly specified | none reached at 45 channels |
| throughput | | all 45 contracts on one socket, two runs: 3,723 and 3,749 frames in 60 s, median 61 and 62 and peak 92 and 89 frames a second, 28.2 and 28.5 KB a second on the wire and 59.2 and 59.6 KB a second after gunzip, 466 bytes per frame on the wire, 64.4 and 91.7 µs to gunzip and 26.2 and 37.4 µs to parse a frame |

The gzip layer is inside the frame, so the engine's refusal of permessage-deflate at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 does not avoid it.
A feed must gunzip every message in `handleMessage`, which cost about 2.5 times the parse on this host.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays are cut to three levels per side.

Subscribe.

```json
{"event":"sub","params":{"channel":"market_e_btcusdt_depth_step0","cb_id":"1"}}
```

Book frame, the first after the subscribe, after gunzip.

```json
{"event_rep":"","channel":"market_e_btcusdt_depth_step0","data":null,"tick":{"asks":[[86491.7,359384],[86491.8,375],[86492.5,118]],"buys":[[86491.6,323995],[86491.5,18763],[86491.4,28111]]},"ts":1790145581000,"status":"ok"}
```

The next book frame, one second later, a whole book again.

```json
{"event_rep":"","channel":"market_e_btcusdt_depth_step0","data":null,"tick":{"asks":[[86491.7,359384],[86491.8,375],[86492.5,118]],"buys":[[86491.6,323995],[86491.5,2025],[86491.4,28111]]},"ts":1790145582000,"status":"ok"}
```

Keepalive, the server's ping after gunzip, and the client's pong.

```json
{"ping":1790145583}
```

```json
{"pong":1790145583}
```

An unknown or unsupported channel, here `depth_step5`.

```json
{"event_rep":"","channel":"market_e_btcusdt_depth_step5","data":null,"tick":{"asks":[],"buys":[]},"ts":1790145583000,"status":"ok"}
```

Ticker.

```json
{"event_rep":"","channel":"market_e_btcusdt_ticker","data":null,"tick":{"amount":"296141005889.9","close":"86491.6","high":"87245.8","low":"85142.4","open":"85504.8","rose":"0.01154087","vol":"3436794"},"ts":1790145580000,"status":"ok"}
```

Trade.

```json
{"event_rep":"","channel":"market_e_btcusdt_trade_ticker","data":null,"tick":{"data":[{"amount":"11330412.7","ds":"2026-09-23 06:39:45","price":"86491.7","side":"BUY","ts":1790145585695,"vol":"131"}],"ts":1790145585000},"ts":1790145585000,"status":"ok"}
```

No acknowledgement and no error frame exists to capture.

## 7. Private channels

Not documented on the socket.
The ChainUP documents describe private data and orders only on REST, with the `X-CH-APIKEY` header, S5 and S7.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The venue is not recommended today, because its anchor is frozen, see [`rest.md`](./rest.md) section 8.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://futuresws.coinchief.live/kline-api/ws` | one family, and the venue names this URL itself |
| channel | `market_e_<coin>usdt_depth_step0`, built as `e_` plus the lowercased `multiplierCoin` plus `usdt` | the web list's `subSymbol` |
| markets per connection | all 43 web list contracts on one socket | 45 ran on one socket at a median of 61 and 62 frames a second |
| subscribe frames | one `sub` frame per contract | the documented shape takes one channel |
| keepalive | answer every server `ping` with `{"pong": <same value>}` | documented, though not enforced within 120 s |
| `maxSilenceMs` | 15,000 | a subscribed socket gets a ping every 10 s, so the ping counts as traffic |
| decode | gunzip every binary message before `JSON.parse` | every frame is gzipped |
| routing | `channel`, mapped back to `rawMarketId` through the `subSymbol` table | the socket does not use the REST spelling |
| snapshot | every frame: `resetBook` from `buys` and `asks`, then `publish` | each frame is a whole 30 level book |
| delta and resync | none, there is no sequence | nothing to check |
| unserved stream | log a contract whose frames stay empty | an unknown channel looks like an empty book |
| receive time | stamp on arrival, never from `ts` | `ts` is a whole second |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it, and the gzip layer is separate |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S4 | OmniX site config, `POST /fe-ex-api/common/public_info` | https://www.omnix.vin/fe-ex-api/common/public_info | 2026-09-22 | OmniX, served from the CoinChief backend | spot `wsUrl`, section 1 |
| S5 | CoinChief open API document, English | https://www.coinchief.live/openapi/open-api-en.html | 2026-09-22 | CoinChief | gzip, ping every 10 s in seconds, channel names, sections 2, 3, 5 and 7 |
| S7 | ChainUP Pri-openapi, Futures Trading API | https://exchangeopenapi.gitbook.io/pri-openapi/openapi-doc/futures-trading-api | 2026-09-22 | ChainUP | no market channel for mark, index or funding, sections 2 and 7 |
| S8 | ChainUP Pri-openapi, WebSocket, Chinese edition | https://exchangeopenapi.gitbook.io/pri-openapi/zhong-wen-wen-dang/websocket-tui-song | 2026-09-22 | ChainUP | `futuresws` URL pattern, `e_btcusdt`, 30 levels, gzip, sections 1 to 4 |
| P2 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/omnix/rest-probe.mjs) | 2026-09-22 | this host | the web list's `wsUrl` and `subSymbol`, section 1 |
| W1 | `ws-probe.mjs book`, 06:39 and 06:54 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/omnix/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| W2 | `ws-probe.mjs batch`, 06:41 and 06:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/omnix/ws-probe.mjs) | 2026-09-22 | this host | throughput, thin contracts, sections 4 and 5 |
| W3 | `ws-probe.mjs silence`, 06:42 and 06:56 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/omnix/ws-probe.mjs) | 2026-09-22 | this host | silence and pings, section 5 |
| W4 | `ws-probe.mjs deflate`, 06:39 and 06:54 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/omnix/ws-probe.mjs) | 2026-09-22 | this host | permessage-deflate, section 5 |
