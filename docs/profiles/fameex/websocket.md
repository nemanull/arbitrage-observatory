# FameEX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:17 to 04:46 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public futures WebSocket of FameEX, which carries its only perpetual family, USDT-M linear perpetuals.
FameEX has no CCXT class, so there is no CCXT Pro reference either, see [`fees.md`](./fees.md) section 8.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/fameex/ws-probe.mjs), run twice per mode, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation is the Slate source of the official OpenAPI docs, S1, whose host names are template variables filled from S2.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://futuresws.fameex.com/kline-api/ws`, S1 and S2 | open in 255 to 924 ms over the 37 sockets whose open time was logged, and all 213 active contracts deliver |
| USDT-M perpetuals, backup | `wss://futuresws.fameex.net/kline-api/ws`, S1 and S2 | resolves to the same address, 45.60.107.210, not opened |
| spot | `wss://wsapi.fameex.com/v1/ws/stream/public`, S1 section "Spot" | open in 318 and 537 ms, text frames, named only |
| spot, per the locale file | `ws.fameex.com` and `ws.fameex.net`, S2 | `ws.fameex.com` does not resolve, not opened |

FameEX lists no other perpetual family, so one URL covers every market the engine could use.
Every futures host resolves to one Imperva address, and the upgrade reply sets three Imperva cookies, `nlbi_3171514`, `visid_incap_3171514` and `incap_ses_1837_3171514`, with header `x-cdn: Imperva`, W5.
No refusal came back from this host, although the Terms exclude Canada, see [`fees.md`](./fees.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `market_e_<base>usdt_depth_step0` | `{"event":"sub","params":{"channel":"market_e_btcusdt_depth_step0","cb_id":"1"}}` | documented as "full depth", no speed given | a whole book every 500 ms, 13 to 184 levels per side, recommended |
| `market_e_<base>usdt_depth_step1` | same shape | not documented | delivers, 16 and 17 frames in about 9 s, not examined further |
| `market_e_<base>usdt_trade_ticker` | same shape | on trade, S1 | not probed |
| `market_e_<base>usdt_ticker` | same shape | 24 h ticker, S1 | 88 and 89 frames in 45 s on BTC, one every 500 ms, fields `amount`, `close`, `high`, `low`, `open`, `rose`, `vol` |
| `market_e_<base>usdt_kline_1min` | same shape | candles, S1 | not probed |
| `event: req` on kline and trade channels | history request, up to 300 candles, S1 | | not probed |

No mark, index or funding channel is documented, and the ticker carries none of the three.
So the anchor has to come from REST, see [`rest.md`](./rest.md) section 3.
The channel names use the contract without the `E-` hyphens and in lowercase, so `E-BTC-USDT` is `e_btcusdt`, and `E-1000PEPE-USDT` is `e_1000pepeusdt`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one futures URL and one spot URL, S1 | the futures URL serves every USDT-M contract |
| subscribe frame shape | `{"event":"sub","params":{"channel":"market_$symbol_depth_step0","cb_id":"1"}}`, one channel per frame, S1 | one channel per frame. 213 frames sent in one burst were all served, W3 |
| unknown symbol expectation | Not publicly specified | nothing at all: no error frame, no data, the socket stays open, for an unknown symbol, a closed contract, a spot style symbol, an uppercase symbol and an unknown channel, W2 |
| chunk unit and budget | Not publicly specified | 213 channels on one socket, all delivered, W3 |
| keepalive mechanism | "send the string 'ping'" and expect `{"pong": 15359750}`, S1 | a bare `ping` closes the socket with 1000 `Bye`, and so does `{"ping": <ms>}`. `{"pong": <ms>}` draws one gzip frame `{"ping": <unix seconds>}` back. The server never pings on its own, W2 and W4 |
| connection lifetime and maintenance notice | Not publicly specified | no lifetime cap in 75 s and no notice seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 13 sockets opened at once or at 213 subscribe frames in one burst |
| public market data authentication | none | none |
| message parse and routing | `{"channel", "ts", "tick"}`, S1 | `{"channel","event_rep":"","status":"ok","tick","ts"}`, route on `channel` |
| subscribe acknowledgement shape | Not publicly specified | none: the first frame after a subscribe is data, and `cb_id` is never echoed |
| symbol identifier format | `btcusdt` in the prose, `e_btcusdt` in the futures comments, S1 | `market_e_btcusdt_depth_step0`. REST and the catalog spell `E-BTC-USDT` |
| number representation | numbers in the examples, S1 | book prices and sizes are JSON numbers, some sizes carry `.0`, and prices keep trailing zeros such as `2778.60`. The ticker sends strings |
| timestamp representation | `ts` in ms, S1 | `ts` integer ms, 105 to 112 ms old on arrival at the median, with the server clock 8 to 11 ms ahead of this host, see [`rest.md`](./rest.md) section 7 |
| size unit | Not publicly specified | contracts of `multiplier` coins, an inference, section 4 |
| sequence semantics | none documented for futures | none: no update id, no sequence, every frame is a whole book |
| idle repeat behaviour | not documented | the book is pushed every 500 ms whether or not it changed. 171 and 175 of 213 contracts sent at least one frame identical to the one before in 40 s, and `E-TUT-USDT` sent 59 identical frames of 78 or 79 in each run |

Every data frame on the futures socket is a binary WebSocket frame holding gzip.
S1 says "The returned data, except for heartbeat data, will be compressed in binary format (users need to decompress it using the Gzip algorithm)."
On the wire the `{"ping": …}` reply to a client pong was also a binary gzip frame, W2 and W4.

## 4. The book channel in detail

`market_e_<base>usdt_depth_step0` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

Every frame is a snapshot.
The first one arrived 598 to 719 ms after the subscribe frame on BTC, ETH and SOL, and 271 and 698 ms on ZIL, W1.
Over 213 channels, the first frame arrived 923 and 1,271 ms after the burst at the median, and 1,142 and 1,776 ms at the latest, W3.

### Delta semantics

There are no deltas.
Each frame carries `tick.asks` and `tick.buys` as whole sides, and a feed replaces its book with each frame.
A level missing from the next frame is gone.

### Sequence and gap rule

```text
every frame   resetBook(asks, buys), publish
```

Nothing identifies a missed frame, since frames carry only `ts`.
The push clock is fixed: the gap between two frames of one contract was 499 to 501 ms at the median on every contract probed, with a minimum of 330 to 400 ms and a maximum of 606 to 752 ms, W1.
In the 40 s batch every contract received 78 or 79 frames, W3.
So a gap well over 500 ms on one contract is the only sign of loss a feed can use.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids (`buys`) | asks |
|---|---|---|
| WebSocket `depth_step0` | best first, descending, on every frame of four contracts in two 45 s runs | best first, ascending, on every frame |
| REST `/fapi/v1/depth` | descending at limits 5, 20, 100, 101 and 1000 | ascending |

The bid side is named `buys` on the socket and `bids` on REST.

### Level window

The socket sends a variable number of levels, far more than 20 on liquid contracts.
BTC held 152 to 184 levels per side, ETH 111 to 177, SOL 121 to 149 and ZIL 81 to 101, W1.
Over all 213 contracts, the shallower side of a frame held 13 or 14 levels at the least, 77 or 78 at the tenth percentile and 90 or 91 at the median, and 79 and 78 frames of about 16,800 had a side under 20 levels, W3.
The ETH book of the first capture ran from 2,777.59 to 3,047.14 on the ask side, so the window reaches about 10 % from the touch.
The engine keeps 20 levels, so a feed takes the first 20 of each side.

### Size unit against CCXT `contractSize`

CCXT has no FameEX class, so there is no `contractSize` to compare with.
The catalog field `multiplier` is the contract size in `multiplierCoin`, see [`rest.md`](./rest.md) section 2.

| contract | `multiplier` | socket size at the touch | coins |
|---|---:|---|---|
| `E-BTC-USDT` | 0.001 | bids 485 and 665, asks 468 and 209 | 0.209 to 0.665 BTC |
| `E-ETH-USDT` | 0.01 | 1,599 ask, 1,484 bid | 15.99 and 14.84 ETH |
| `E-ZIL-USDT` | 500 | 110 ask, 4 bid | 55,000 and 2,000 ZIL |

The unit is read as contracts, and that is an inference.
If the BTC sizes were coins, the touch would hold 18 to 58 million USDT on a venue whose whole 24 h spot volume on CoinGecko is about 18,347 BTC, S10.
The ticker's `vol` of 40,335,896 on BTC fits contracts of 0.001 BTC, since as coins it would exceed the BTC supply, and its `amount` divided by `vol` is about 86,044, the price, so `amount` is contracts times price and not USDT, see section 6.
The socket and the REST book report the same size at the same price: 16 of the top 20 levels per side were identical in the first run, 62 ms apart, W1.
In the second run, 53 ms apart, 0 levels were identical and the REST best bid, 87,067.5, sat 11.7 below the socket's 87,079.2, while 15 and 16 of the 20 prices appeared in both.
One reading cannot tell a fast market from a lagging REST book.

Six active contracts have `multiplierCoin` `USDT` instead of the base: `E-BSB-USDT`, `E-BABA-USDT`, `E-PTB-USDT`, `E-MEITUAN-USDT`, `E-KUAISHOU-USDT` and `E-LGELECTRONICS-USDT`, P1.
Their size unit in coins is Not verified, so a feed should skip them.

### One-sided and empty books

No frame of any of the 213 active contracts was one-sided in either batch, W3.
The closed contract `E-HIFI-USDT` sends nothing on the socket, W2, while REST still returns a one level book for it, see [`rest.md`](./rest.md) section 5.
What the socket sends for an empty side of an open contract is Not verified.

### Idle repeats

The book is pushed on a 500 ms clock, not on change.
171 and 175 of 213 contracts sent a frame identical to the previous one within 40 s, W3.
None of the four contracts watched in W1 did, so a liquid book changes between most pushes.
The ticker is also pushed every 500 ms, W1.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `market_e_nopeusdt_depth_step0` | nothing | socket stays open, no frame in 9 s |
| `market_e_hifiusdt_depth_step0`, status 0 | nothing | no frame in 9 s |
| `market_btcusdt_depth_step0`, the spot spelling | nothing | no frame in 9 s |
| `market_e_BTCUSDT_depth_step0` | nothing | no frame in 9 s |
| `market_e_btcusdt_nope` | nothing | no frame in 9 s |
| the same ticker channel twice | nothing | one stream, 16 frames in about 9 s |
| `{"event":"unsub", …}` | nothing | no frame later than 1.5 s after it |
| `hello`, not JSON | close 1000 `Bye` | 227 and 231 ms after open |
| `ping`, the documented heartbeat | close 1000 `Bye` | 343 and 193 ms after it was sent |
| `{"ping": <ms>}` | close 1000 `Bye` | 310 and 218 ms after it was sent |
| `{"pong": <ms>}` | binary gzip `{"ping":1790137304}` | socket stays open |
| `{"event":"heartbeat","params":{"channel":"ping"}}`, the spot heartbeat | nothing | socket stays open |

Because the server never refuses a channel, the feed has to notice a stream with no frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client sends `ping` when no message came for N seconds, N under 30, and expects `pong`, S1 | the documented `ping` kills the socket. `{"pong": <ms>}` every 20 s drew one `{"ping": <seconds>}` each time, about 240 ms later, at 20,495, 40,476 and 60,478 ms after open, W4 |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame closed at 60.41 and 60.27 s with 1006 and no close frame. A subscribed socket that sent nothing stayed open for the full 75 s, twice, W4 |
| server ping | Not publicly specified | none, neither a protocol ping nor an application ping, on any socket |
| forced disconnect | Not publicly specified | none in 75 s |
| maintenance notice | Not publicly specified | none |
| compression | gzip inside each binary data frame, S1 | gzip inside the frame on every data frame. A client that offered permessage-deflate got `sec-websocket-extensions: permessage-deflate` back, W5. The engine refuses deflate at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81, and the frames stay gzip either way |
| handshake | | 255 to 924 ms to open from this host |
| subscription limits | Not publicly specified | none reached at 213 channels |
| throughput | | 213 perpetuals on one socket: 426 frames per second at the median in both runs, peak 462 and 493, 435 and 437 KB per second on the wire, 1,178 and 1,185 KB per second of JSON after gunzip, 1,064 and 1,065 bytes per frame on the wire and 2,884 and 2,885 after gunzip, 42 and 43 µs gunzip plus `JSON.parse` per frame at the median and 145 and 168 µs at p99, W3 |

A book frame of the four contracts in W1 averaged about 1,570 bytes gzipped, against 1,065 over all 213, and a W1 frame took 120 and 137 µs at the median to gunzip and parse, W1.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Book arrays are cut to three levels per side.

Subscribe.

```json
{"event": "sub", "params": {"channel": "market_e_zilusdt_depth_step0", "cb_id": "E-ZIL-USDT"}}
```

No acknowledgement is sent.
The first frame is the book, gunzipped, from a frame of 101 asks and 89 bids.

```json
{"channel":"market_e_zilusdt_depth_step0","event_rep":"","status":"ok","tick":{"asks":[[0.003882,110],[0.003883,43],[0.003886,101]],"buys":[[0.003881,4],[0.00388,34],[0.003879,97]]},"ts":1790137244364}
```

Every later frame has the same shape, so there is no separate delta to show.

Ticker, gunzipped.

```json
{"channel":"market_e_btcusdt_ticker","event_rep":"","status":"ok","tick":{"amount":"3470662879699.5","close":"86849.6","high":"86928.1","low":"85070.2","open":"85494.7","rose":"0.0155698","vol":"40335896"},"ts":1790137244812}
```

Keepalive, the client frame as the probe builds it, and the gunzipped reply that followed it in W2.

```text
{"pong": <Date.now() in ms>}
```

```json
{"ping":1790137304}
```

The spot socket, for comparison, sends text and opens with a system frame.

```json
{"event_rep":"","channel":"system","data":{"status":"ready"},"tick":null,"ts":"1790137475781","status":"ok"}
```

The close after a bare `ping` or a non-JSON frame is a WebSocket close with code 1000 and reason `Bye`, and no JSON.
No error frame exists to capture.

## 7. Private channels

S1 documents no private WebSocket channel for futures or spot.
Orders, positions, leverage and margin mode are REST calls under `/fapi/v1` signed with `X-CH-APIKEY`, `X-CH-SIGN` and `X-CH-TS`, see [`rest.md`](./rest.md) section 6.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan on `wss://futuresws.fameex.com/kline-api/ws` | the only perpetual family |
| channel | `market_e_<base lowercase>usdt_depth_step0`, built from `rawMarketId` by dropping the `E-` prefix and the hyphens and lowercasing | the only documented book channel |
| markets per connection | 213, every active contract | 213 ran on one socket with every contract delivering, and no cap is published |
| subscribe frames | one frame per channel, `{"event":"sub","params":{"channel":…,"cb_id":…}}` | one channel per frame is the documented shape, and a burst of 213 was served |
| decode | `gunzipSync` of every binary frame before `JSON.parse`, in `handleMessage`, which already receives a `Buffer` at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 209 | the data is gzip inside the frame. This is the change the design flags for compression inside the frame |
| routing | a map from channel name to `rawMarketId`, built at subscribe time | the channel lowercases the contract and drops its hyphens |
| snapshot | every frame: `resetBook` with the first 20 of `asks` and of `buys`, then `publish` | every frame is a whole book |
| sequence | none | no id exists. A per contract gap far above 500 ms is the only loss signal |
| keepalive | `{"pong": <ms>}` every 20 s, and never `ping` | the documented `ping` closes the socket, the pong is answered, and the server sends no ping to rely on |
| `maxSilenceMs` | 10,000 | a subscribed socket gets two frames a second per contract, so ten silent seconds is about twenty missed pushes |
| resync | on close or on silence, reopen and resubscribe. No per symbol resync exists | there is no gap to detect |
| unserved stream | log a channel with no frame 5 s after its subscribe | the server acknowledges nothing and refuses nothing |
| receive time | stamp on arrival, never from `ts` | the engine rule, and `ts` is about 110 ms old on arrival here |
| skip | the six contracts whose `multiplierCoin` is `USDT` | their size unit in coins is unknown |
| deflate | keep `perMessageDeflate: false` | the server would negotiate it, and it would only wrap gzip in deflate |

The 500 ms push clock is slower than any feed the engine runs today.
A book that is up to 500 ms old at the moment a cross is read is a freshness limit the design should weigh, since a cross against a stale FameEX book is exactly what the book age safeguards are for.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | FameEX OpenAPI Docs, Slate source `source/includes/_doc.en.md` at commit `7c8ed3c1` of 2026-08-12 | https://github.com/fameexDocs/docs-v1, rendered at https://fameexdocs.github.io/docs-v1/en/ | 2026-09-22 | FameEX, global | URLs, channel names, gzip, heartbeat, book example, sections 1 to 7 |
| S2 | FameEX OpenAPI Docs, `locales/en.yml` | https://github.com/fameexDocs/docs-v1/blob/main/locales/en.yml | 2026-09-22 | FameEX, global | the host names behind `t(:futures_ws_url)` and the others, section 1 |
| S10 | CoinGecko API, `exchanges/fameex` | https://api.coingecko.com/api/v3/exchanges/fameex | 2026-09-22 | CoinGecko | 24 h volume of 18,347 BTC, section 4 |
| P1 | `rest-probe.mjs catalog`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/fameex/rest-probe.mjs) | 2026-09-23 UTC | this host | `multiplier` and `multiplierCoin`, section 4 |
| W1 | `ws-probe.mjs book`, runs at 04:20 and 04:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fameex/ws-probe.mjs) | 2026-09-23 UTC | this host | cadence, levels, order, sizes, REST compare, ticker, sections 2 to 6 |
| W2 | `ws-probe.mjs errors`, runs at 04:21 and 04:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fameex/ws-probe.mjs) | 2026-09-23 UTC | this host | unknown and closed symbols, step1, heartbeat variants, unsubscribe, sections 3 to 6 |
| W3 | `ws-probe.mjs batch`, runs at 04:23 and 04:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fameex/ws-probe.mjs) | 2026-09-23 UTC | this host | 213 channels on one socket, repeats, level counts, throughput, sections 3 to 5 |
| W4 | `ws-probe.mjs silence`, runs at 04:22 and 04:37 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fameex/ws-probe.mjs) | 2026-09-23 UTC | this host | silence, server pings, pong replies, sections 3 and 5 |
| W5 | `ws-probe.mjs deflate`, runs at 04:24 and 04:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fameex/ws-probe.mjs) | 2026-09-23 UTC | this host | deflate negotiation, Imperva cookies, sections 1 and 5 |
| W6 | `ws-probe.mjs spot`, runs at 04:24 and 04:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fameex/ws-probe.mjs) | 2026-09-23 UTC | this host | the spot socket, sections 1 and 6 |
