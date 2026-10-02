# Young Platform WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:33 to 04:55 UTC, from the development host near Seattle, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public WebSocket of the Young Platform trader API for its spot market, since the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/young-platform/ws-probe.mjs), and the capture is quoted beside the documented value.
The book on this socket is not an exchange order book.
It is the Smart Order Router's view of liquidity aggregated from the external venues Young Platform routes to, and each frame is a whole eight level snapshot, see section 4.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every public and private topic | `wss://api.youngplatform.com/api/socket/ws` in the overview, S1, and `https://api.youngplatform.com/api/socket/ws` in the socket guide, S2 | open in 673 to 884 ms on the six sockets that logged it, P4 and P5 |
| One Trading futures stream, unreleased | `wss://streams.fast.onetrading.com/`, named in the Pro web app config beside `FUTURES_ENABLED:!1`, S5 | not probed, see [`../onetrading/`](../onetrading/) |

One socket carries every market and every topic kind.
A socket held `SOR.OB` streams quoted in EUR and in USDC together with `SOR.PI`, `SOR.T`, `SOR.PUB_TRADES` and `SOR.OHLCV` topics, P4.
`api.youngplatform.com` resolved to two Cloudflare IPv4 addresses, 104.20.1.155 and 104.20.2.155, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| topic | payload | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `SOR.OB.<pair>` | `data: [pair, bids, asks, timestampMs]` | a full replacement each message, no depth parameter | 8 levels per side, one frame about every 1,000 ms per pair, first frame 260 to 896 ms after the subscribe over both runs |
| `SOR.PI.<pair>` | `data: ["<price>"]` | "a single reference price aggregated across the SOR venues", S2 | 46 frames in about 46 s on BTC-EUR in each run, 27 and 19 of them a new value, first frame 1,224 and 748 ms after the subscribe. Its value was the midpoint of the `SOR.OB` touch in the median, see [`rest.md`](./rest.md) section 3 |
| `SOR.T.<pair>` | 24 h rolling ticker, one object | snapshot on subscribe "if cached", S2 | snapshot 256 and 188 ms after the subscribe, then 1 update in 45 s in each run |
| `SOR.PUB_TRADES.<pair>` | public fills, snapshot on subscribe, S2 | "not detailed below yet", S2 | a snapshot of the last 50 fills 258 and 189 ms after the subscribe, the newest about 9 h old and the oldest about 2.9 days old, sides `1` and `2`, and no new fill in 45 s |
| `SOR.OHLCV.<pair>.1m` | candle object | `1m` only, S2 | first frame 23,186 and 28,770 ms after the subscribe, each at a minute boundary, with `sor_qty` and `sor_amt` of `"0"` |
| best bid and ask, trades by venue, mark, index, funding | none | | the `help` reply lists no other public pattern |

The topic names and payloads are from S2, and the full list of patterns is the server's own `help` reply, quoted in section 6.
No mark, index or funding topic exists, because no derivative is listed.
`SOR.PI` is the one reference price, and [`rest.md`](./rest.md) section 3 says what it is and is not.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1, S2 | one socket carried EUR and USDC pairs and every topic kind |
| subscribe frame shape | `{"id": "...", "method": "subscribe", "events": ["TOPIC.1", "TOPIC.2"]}`, S2 | eight topics in one frame got one acknowledgement naming all eight, and each delivered |
| unknown symbol expectation | Not publicly specified | `SOR.OB.NOPE-EUR` and the lowercase `SOR.OB.btc-eur` are acknowledged as success and send nothing. An unknown topic kind, `SOR.NOPE.BTC-EUR`, gets the `help` reply with `"error": "ERR_INVALID_SUBSCRIPTION"` |
| chunk unit and budget | Not publicly specified | 20 topics per connection. The 21st is refused with `ERR_INSUFFICIENT_CREDITS`, a second socket from this host takes the refused ones, and an unsubscribe frees one |
| keepalive mechanism | client method `ping`, "Returns a pong message", S2 and the `help` reply | the server sends an application `{"type":"ping"}` every 30 s and no protocol ping. A client `ping` got `{"id":"p1","type":"pong"}` in 176 and 188 ms |
| connection lifetime and maintenance notice | Not publicly specified | no close by the server on any socket, the longest open 111 s, and no notice frame |
| handshake and operation rate limits | Not publicly specified | two sockets at once, 26 subscribe frames on one of them, most 150 ms apart, and no refusal other than the topic cap, in both runs |
| public market data authentication | none for `SOR.*` public topics, S2 | none. `LEDGER` without a login answers `ERR_UNAUTHORIZED` |
| message parse and routing | `{"id", "type", "data", "error", "message"}`, S2 | route on `type`, which is the topic name, `SOR.OB.BTC-EUR`. The book also repeats the pair in `data[0]` |
| subscribe acknowledgement shape | not shown, S2 | `{"id":"s1","type":"subscribe","message":"<topics joined by commas>"}`, and a refusal adds `"error"` |
| symbol identifier format | `BASE-QUOTE`, as `BTC-EUR`, S1 | identical to the REST `market` and `mkt` fields. No CCXT class exists to compare with |
| number representation | "Prices and amounts are decimal strings", S2 | strings for price and size, an integer for the time |
| timestamp representation | epoch milliseconds, S2 | `data[3]` in ms, 206 to 2,161 ms before arrival over both runs, median about 1,000 ms |
| size unit | base currency, S2 | base currency, section 4 |
| sequence semantics | "Each message is a complete replacement of the previous state, no incremental diffs", S2 | no sequence or id field in any book frame |
| idle repeat behaviour | not documented | about one book frame in three repeats the previous one exactly, with the same `data[3]` |

## 4. The book channel in detail

`SOR.OB.<pair>` is the only book topic, and every row below is about it.

### What the book is

The REST twin of this topic, `GET /public/liquidity/{market}`, is documented as "indicative liquidity aggregated across sources, not the order book of a single trading venue", S3.
Young Platform has run no order book of its own since 2026-07-01, see [`fees.md`](./fees.md) section 1.
The book is therefore the router's quote of what the external venues would fill, not resting orders of Young Platform clients.
On 2026-09-23 between 04:31 and 04:49 UTC its BTC-EUR touch sat 1,616 to 1,669 ppm under Kraken's bid and 1,500 to 1,586 ppm over Kraken's ask, and ETH-EUR and SOL-EUR sat 1,331 to 1,652 ppm outside Kraken, see [`rest.md`](./rest.md) section 5.
So the book is wide by construction, 2,947 to 4,362 ppm on every pair but `USDC-EUR` and `YNG-EUR` over three REST reads.
The REST book and the socket book read 3 s apart showed the same best bid, 76,161 EUR for 0.065 BTC, P5, so they appear to share one source.

### Snapshot on subscribe

The first frame for each pair is a full book, 260 to 787 ms after the subscribe frame on the five pairs of the first book run and 366 to 896 ms in the second.
That spread is consistent with a book published on a one second tick, where the first frame waits for the next tick.
Every later frame is also a full book, as S2 says, so there is nothing to align and nothing to fetch by REST.

### Delta semantics

None.
Each frame replaces the book.
A level missing from the new frame is gone.

### Sequence and gap rule

```text
every frame   replace the whole book with data[1] and data[2]
no id         no gap can be detected, only a silence
```

No frame carries a sequence number, an update id or a checksum.
`data[3]` did not increase on 14 to 18 of 43 to 47 frames per pair in the two book runs, and every one of those frames was an exact repeat of the frame before it.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket book | best first, descending, in every frame of the book and batch runs | best first, ascending, in every frame |
| REST `liquidity` | descending on 24 of 24 pairs | ascending on 24 of 24 pairs |

### Level window

Eight levels per side on every pair and every frame, except that `ADA-EUR` bids dropped to 5 and 6 in the two batch runs, `ONDO-EUR` bids to 6 in the second, and `ADA-EUR` bids read 6 and 7 by REST.
There is no depth parameter, S2 and S3.
Eight levels is less than the engine's `DEPTH_LEVELS` of 20 at [`ClusterIndexBuilder.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/ClusterIndexBuilder.ts) line 17.
The deepest bid of several pairs is not a plausible order.
On `AAVE-EUR` in the third REST run the eighth bid alone was worth 89,179,732 EUR and sat 39,809 ppm under the best bid, while the eight asks together came to about 1.1 million EUR in the second run, see [`rest.md`](./rest.md) section 5.
In the second pass the deepest bid alone exceeded 10 million quote units on 8 of 24 pairs, see [`rest.md`](./rest.md) section 5.

### Size unit

Sizes are in the base currency, "size is in base currency", S2, and the REST schema says the same, S3.
The BTC-EUR touch sizes of 0.023 and 0.215 BTC against a price near 76,200 EUR are plausible as bitcoin and not as euro.
There is no CCXT class, so there is no `contractSize` to compare, and a spot market needs a multiplier of 1.

### One-sided and empty books

No frame in either run had an empty side, and no book was crossed.
The one market with buy and sell disabled, `YNG-EUR`, still publishes a full two-sided book: 46 of its 47 frames, and 45 of 46 in the rerun, were exact repeats with round sizes of 1000, 4305 and 8610 YNG, and only `data[3]` moved.

### Idle repeats

Frames arrive about once a second whether or not the book changed.
In the first book run 18 of 47 BTC-EUR frames, 16 of 44 ETH-EUR, 17 of 47 SOL-USDC and 14 of 43 TRUMP-EUR frames repeated the previous frame exactly, and in the rerun 16 of 46, 15 of 43, 16 of 46 and 14 of 43.
Each repeat carried the previous `data[3]`.
In the batch runs every delivering pair sent 45 frames in 45 s with 13 to 17 repeats each, and then 40 frames with 12 to 14 repeats.

### Unknown, closed and wrong-form streams

| request | reply | then |
|---|---|---|
| `SOR.OB.NOPE-EUR` | `{"id":"s2","type":"subscribe","message":"SOR.OB.NOPE-EUR"}` | nothing |
| `SOR.OB.btc-eur` | acknowledged as success | nothing, and the REST liquidity call accepts the same spelling |
| `SOR.OB.BTC-EUR` a second time | acknowledged as success | frames are not doubled |
| `SOR.OB.TRUMP-EUR`, a pair with a ticker but not in the SOR catalog | acknowledged | an eight level book every second |
| `SOR.OB.YNG-EUR`, buy and sell disabled | acknowledged | a static book, see above |
| `SOR.NOPE.BTC-EUR` | the `help` reply with `"error":"ERR_INVALID_SUBSCRIPTION"` | |
| `LEDGER` without login | `{"id":"s6","type":"subscribe","error":"ERR_UNAUTHORIZED","message":"LEDGER"}` | |
| method `nope` | `{"id":"x1","error":"ERR_BAD_REQUEST"}` | |
| text that is not JSON | no reply | the socket stays open |
| a 21st topic | `{"id":"a20","type":"subscribe","error":"ERR_INSUFFICIENT_CREDITS","message":"SOR.OB.UNI-EUR"}` | nothing for that topic |

A pair that the catalog does not list was not available to probe as closed.
Because an unknown pair is acknowledged as success, a feed would have to notice a topic with no first frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"method":"ping"}` returns a pong, S2 | the server sent `{"type":"ping"}` at 11.1 s and 41.1 s after the open in the first book run and at 16.8 s and 46.8 s in the second, two in each 45 s batch run, and three and four in the two 111 s silence runs. No protocol ping on any socket. A client ping was answered in 176 and 188 ms |
| silence the server tolerates | Not publicly specified | a socket that subscribed nothing and sent nothing, not even an answer to the server pings, stayed open for the full 111 s in both runs |
| forced disconnect | Not publicly specified | none |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | optional `Authorization: Bearer` and `X-Api-Key-Id` headers, S2 | 673 to 884 ms to open, served by Cloudflare edges `YVR` and `SEA` |
| subscription limits | Not publicly specified | 20 topics per connection in both runs, section 3. A single frame of 24 topics got one refusal naming all 24, and the first 20 still delivered |
| throughput | | 20 pairs on one socket: 20 frames in the median second of both runs, 8,898 and 7,922 bytes per second, 443 and 444 bytes per frame, 26.5 and 23.2 µs `JSON.parse` per frame |

The client `ping` does not have to be sent for the socket to live, but it is the only way to see that the server still answers, since a pair's frames can be exact repeats.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Book frames keep the first three levels per side.

Subscribe, several topics in one frame.

```json
{"id": "s1", "method": "subscribe", "events": ["SOR.OB.BTC-EUR", "SOR.OB.ETH-EUR", "SOR.OB.SOL-USDC", "SOR.OB.YNG-EUR", "SOR.PI.BTC-EUR", "SOR.T.BTC-EUR", "SOR.PUB_TRADES.BTC-EUR", "SOR.OHLCV.BTC-EUR.1m"]}
```

Acknowledgement.

```json
{"id":"s1","type":"subscribe","message":"SOR.OB.BTC-EUR,SOR.OB.ETH-EUR,SOR.OB.SOL-USDC,SOR.OB.YNG-EUR,SOR.PI.BTC-EUR,SOR.T.BTC-EUR,SOR.PUB_TRADES.BTC-EUR,SOR.OHLCV.BTC-EUR.1m"}
```

Book, the first frame for BTC-EUR, where `data[3]` is 1790138016951, 2026-09-23 04:33:36.951 UTC.

```json
{"type":"SOR.OB.BTC-EUR","data":["BTC-EUR",[["76193","0.02293257"],["76189","0.09173518"],["76188","0.4083496"]],[["76432","0.21496832"],["76433","0.01310303"],["76434","0.01310293"]],1790138016951]}
```

Book of the disabled `YNG-EUR`, which repeats unchanged.

```json
{"type":"SOR.OB.YNG-EUR","data":["YNG-EUR",[["0.5064","1000"],["0.5046","4305"],["0.5017","4305"]],[["0.5072","1000"],["0.5091","4305"],["0.5121","4305"]],1790138016171]}
```

Price index and ticker.

```json
{"type":"SOR.PI.BTC-EUR","data":["76313"]}
```

```json
{"type":"SOR.T.BTC-EUR","data":[{"mkt":"BTC-EUR","o":"74519","h":"76317","l":"74137","c":"76291","qty":"2.53732204","amt":"189466.34437768","t":1790137981000}]}
```

Keepalive, the server's ping and the answer to a client ping.

```json
{"type":"ping"}
```

```json
{"id":"p1","type":"pong"}
```

Errors.

```json
{"id":"s6","type":"subscribe","error":"ERR_UNAUTHORIZED","message":"LEDGER"}
```

```json
{"id":"x1","error":"ERR_BAD_REQUEST"}
```

```json
{"id":"a20","type":"subscribe","error":"ERR_INSUFFICIENT_CREDITS","message":"SOR.OB.UNI-EUR"}
```

The `help` reply to an unknown topic kind, cut to its subscription patterns.

```json
{"id":"s7","type":"help","data":{"methods":[{"name":"subscribe","subscriptions":[{"pattern":"SOR.PI.{pair}"},{"pattern":"SOR.T.{pair}"},{"pattern":"SOR.OB.{pair}"},{"pattern":"SOR.OHLCV.{pair}.{timeframe}"},{"pattern":"SOR.ORDERS.{pair}","requiresAuth":true},{"pattern":"SOR.PUB_TRADES.{pair}"},{"pattern":"SOR.PRV_TRADES.{pair}","requiresAuth":true},{"pattern":"SOR.EXECUTIONS","requiresAuth":true},{"pattern":"SOR.EXECUTIONS.{pair}","requiresAuth":true},{"pattern":"LEDGER","requiresAuth":true}]}]},"error":"ERR_INVALID_SUBSCRIPTION"}
```

The full reply also lists the methods `help`, `ping`, `login`, `logout` and `unsubscribe`, each with a one line description.

## 7. Private channels

Named for a future execution stage, from S2 and the `help` reply, not probed.
They use the same URL and a login, either the `Authorization: Bearer <jwt>` header at connect time or `{"id": "1", "method": "login", "token": "<jwt>", "keyID": "<key id>"}` after it, S2.

- `SOR.EXECUTIONS` and `SOR.EXECUTIONS.<pair>`, updates to the account's own SOR orders.
- `SOR.ORDERS.<pair>` and `SOR.PRV_TRADES.<pair>`, the account's orders and fills.
- `LEDGER`, balance updates.

There is no order entry over the socket.
Orders go through the authenticated REST `POST /private/sor/orders`, see [`rest.md`](./rest.md) section 6.

## 8. Recommended feed shape

Not recommended for the engine.
Young Platform lists no perpetual, and its book is an eight level indicative quote of other venues, 1,300 to 1,700 ppm outside Kraken's touch on each side, republished about once a second with data about a second old.
If a spot study ever wants it, this is the shape the probes support.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://api.youngplatform.com/api/socket/ws` for all 24 SOR markets | one URL serves every topic |
| markets per connection | 20 | the server refuses the 21st topic |
| subscribe frames | one frame per slice, `{"id": "<slice>", "method": "subscribe", "events": ["SOR.OB.BTC-EUR", …]}` | a multi topic frame is acknowledged as one |
| keepalive | `{"id": "k", "method": "ping"}` every 15 s | the server sends its own ping every 30 s and never closed a silent socket, so the pong is only a liveness signal |
| `maxSilenceMs` | 5,000 | every subscribed pair sent a frame about once a second, and the longest gap seen in four runs was 1,479 ms |
| routing | `type.slice(7)` gives the pair, or read `data[0]` | the topic name wraps the pair |
| every frame | `resetBook` with `data[1]` and `data[2]`, then `publish` | each frame is a full replacement |
| resync | none on the wire. A pair with no frame for 5 s is a silence | no sequence exists |
| unserved topic | log a topic with no first frame 3 s after its acknowledgement | unknown pairs are acknowledged and stay silent |
| receive time | stamp on arrival, and keep `data[3]` for the age | `data[3]` was 206 to 2,161 ms old at arrival, and repeats carry the old value |
| sizes | `Number()` of the string, base currency | S2 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Young Platform API docs, `GUIDES/overview.md`, commit `0d92713` of 2026-07-30 | https://github.com/YoungAgency/youngplatform_api_docs/blob/main/GUIDES/overview.md | 2026-09-22 | Young Platform S.p.A. | hosts, `BASE-QUOTE` convention, section 1 |
| S2 | Young Platform API docs, `GUIDES/websocket.md` | https://github.com/YoungAgency/youngplatform_api_docs/blob/main/GUIDES/websocket.md | 2026-09-22 | Young Platform S.p.A. | message format, topics, snapshot semantics, login, sections 1 to 7 |
| S3 | `trader_openapi.json`, `GET /public/liquidity/{market}` and `TraderBookResponse` | https://github.com/YoungAgency/youngplatform_api_docs/blob/main/trader_openapi.json | 2026-09-22 | Young Platform S.p.A. | "indicative liquidity aggregated across sources", level order, size unit, section 4 |
| S4 | Notice on the new operating model of Young Platform Pro from 1 July 2026 | https://youngplatform.com/en/legal/ | 2026-09-22 | Young Platform S.p.A., Italy | no internal order book, section 4 |
| S5 | Pro web app bundle `ypp-2.26.1` | https://pro.youngplatform.com/assets/main-D2m9vOaS.min.js | 2026-09-22 | Young Platform | `SOCKET_BASE_URL`, `OT_SOCKET_BASE_URL`, `FUTURES_ENABLED:!1`, section 1 |
| P4 | `ws-probe.mjs book`, `batch`, `credits`, `silence` and `deflate`, 04:33 to 04:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/young-platform/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| P5 | `ws-probe.mjs book`, `batch`, `credits`, `silence` and `deflate`, rerun at 04:50 to 04:54 UTC in the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/young-platform/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the second readings, `SOR.PI` against the book mid, the REST and socket touch |
| P2 | `rest-probe.mjs all`, 04:31, 04:41 and 04:48 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/young-platform/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the Kraken comparison, REST spreads and level order, section 4 |
