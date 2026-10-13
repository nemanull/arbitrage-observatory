# Extended WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:20 to 22:40 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

**Rechecked:** 2026-10-12 at 23:00 UTC, against the live venue by the Rust adapter's probe, and each corrected line names that date.

This profile covers the public WebSocket streams of Extended (CCXT id `extended`), with the book stream in detail.
Every stream is its own URL, and a client subscribes by opening that URL, so nothing is sent after the handshake.
Every protocol claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/extended/ws-probe.py), and the capture is quoted beside the documented value, S1.
P1 is the first run of each mode and P2 the second pass, listed in section 9.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All times are UTC.
Fees are in [`fees.md`](./fees.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every market, mainnet | `wss://api.starknet.extended.exchange` as the host, with paths under `/stream.extended.exchange/v1/`, S1 | handshakes completed in 484 to 584 ms, P1 |
| testnet | `wss://api.starknet.sepolia.extended.exchange/stream.extended.exchange/v1`, CCXT `pro/extended.js` line 33 | not probed |

One URL carries one stream, either for one market or, with the market left out, for every market.
The all-markets book stream carried perpetuals of both execution models and the three spot markets on one socket, section 4.
The host resolved to three AWS Tokyo addresses, see [`rest.md`](./rest.md) section 1, and the upgrade reply carried only `Date`, `Connection`, `Upgrade` and `Sec-WebSocket-Accept`, P1.
CCXT builds the same URLs, `this.urls['api']['ws'] + '/orderbooks/' + market['id']` at `pro/extended.js` line 66.

## 2. Channel matrix for public market data

| stream | path | payload | documented cadence, S1 | probed |
|---|---|---|---|---|
| book, full depth | `orderbooks/{market}`, or `orderbooks` for every market | `SNAPSHOT` then `DELTA` frames | "Push frequency: 100ms", a snapshot first and then "every minute" | BTC-USD every 100 ms at the median on the all-markets stream, 8.5 frames a second, P1. The periodic snapshot came 60 s apart, section 4 |
| book, best bid and ask | `orderbooks/{market}?depth=1` | `SNAPSHOT` with one level a side | "Push frequency: 10ms", always snapshots | BTC-USD 68 and 69 frames in 15 s, gaps from 0 ms with a median of 22 to 40 ms, arrival 72 to 74 ms after `ts` at the median, P1 |
| real book of an RFQ market | `orderbooks/rfq/{market}` | same frames | same as the book | `AIA-USD`: a snapshot of 2 levels a side and 2 deltas in 15 s, P1 and P2. The same path on `BTC-USD` was closed at once, section 4 |
| trades | `publicTrades/{market}` | array of trades | not stated | not probed |
| funding | `funding/{market}` or `funding` | `{"m","T","f"}` | "The records include only those funding rates that were used for funding fee payments" | no frame in 15 s on the all-markets stream, P1 |
| candles | `candles/{market}/{candleType}` | OHLC | not stated | not probed |
| mark | `prices/mark/{market}` or `prices/mark` | `{"type":"MP","data":{"m","p","ts"}}` | "whenever a mark price changes" | 341 markets, one frame per market every 1,496 and 1,488 ms at the median whether or not the price moved, `data.ts` 0 on all 6,800 and 7,014 frames, P1 and P2 |
| index | `prices/index/{market}` or `prices/index` | `{"type":"IP","data":{"m","p","ts"}}` | not stated | 344 markets, one frame per market every 1,503 and 1,484 ms at the median, `data.ts` on whole seconds and 633 and 586 ms old at arrival at the median, max 1,131 and 1,245 ms, P1 and P2 |

The mark stream does not push only on a change, as S1 says.
On `BTC-USD` 20 mark frames in 30 s held 9 distinct prices, P1.
The funding stream carries applied rates only, so the running rate for the coming hour comes from REST, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per stream and market, or per stream for every market, S1 | as documented, P1 |
| subscribe frame shape | none, the path is the subscription | a client text frame `{"method":"subscribe","market":"ETH-USD"}` on the `BTC-USD` socket was ignored, with no reply and no `ETH-USD` frame in 6 s, P1 |
| unknown symbol expectation | Not publicly specified | `orderbooks/NOPE-USD`, `orderbooks/btc-usd` and `orderbooks/BTC-USDT` opened and stayed silent for 5 s with no error and no close. `prices/mark/NOPE-USD` and `orderbooks/BTC-USD?depth=5` ended without a close frame, code 1006. An unknown path answered 404 at the handshake, P1 and P2 |
| chunk unit and budget | Not publicly specified | the all-markets stream carried 390 markets on one socket, P1 |
| keepalive mechanism | "The server sends pings every 15 seconds and expects a pong response within 10 seconds", S1 | protocol pings every 1,117 to 1,273 ms, with single gaps of 1,467 and 1,780 ms, payload `[ping <64 hex digits> ping]`. An unanswered ping got no second ping and a close 1011 `Ping timeout` 14,998 ms later, P1. A client protocol ping got a pong in 136 ms, P1 |
| connection lifetime and maintenance notice | none on the socket. Planned maintenance is posted on Discord 24 h, 1 h and 10 minutes ahead, S4 | no forced close in 65 s, P1 |
| handshake and operation rate limits | Not publicly specified for sockets. REST is 1,000 requests a minute per IP, S1 | 21 handshakes between 22:20 and 22:30 in P1, none refused except the unknown path's 404 |
| public market data authentication | none. The User-Agent header "is required" for REST and WebSocket, S1 | none, but a handshake without any User-Agent got 403 from `awselb/2.0` with a 118-byte HTML body, P2 |
| message parse and routing | `type` `SNAPSHOT` or `DELTA` for books, `MP` and `IP` for prices, S1 | route on the URL first, then `data.m` for the market. Book frames carry `type` and also `data.t` with the same value, P1 |
| subscribe acknowledgement shape | none | none. The first frame is data, P1 |
| symbol identifier format | the market `name` of the catalog, `BTC-USD`, S1 | the same spelling, case sensitive, equal to CCXT `market.id`, P1 |
| number representation | prices and sizes as strings, S1 | strings, such as `"p":"82520"` and `"q":"19.11949"`, P1 |
| timestamp representation | `ts` in epoch ms, S1 | integer ms. On a `SNAPSHOT` `ts` is the time of the book's last change, not the send time, section 4 |
| size unit | base asset, see [`rest.md`](./rest.md) section 2 | base asset, which matches CCXT `contractSize` 1. A `k` market counts thousands, section 4 |
| sequence semantics | "Monothonic sequence number. '1' corresponds to the first snapshot", and a client that sees one out of order "should reconnect", S1 | `seq` counts frames per connection across all markets, from 1. It rose by exactly 1 on all 11,278 steps of an all-markets run and all 1,017 steps of a `BTC-USD` run in P1, and on all 13,891 and 694 in P2. The mark and index streams count the same way, 7,013 and 7,099 steps in P2. No checksum |
| idle repeat behaviour | not documented | an idle market sends nothing between snapshots. Before each periodic snapshot it sends a `DELTA` with no levels, section 4 |

## 4. The book channel in detail

### Snapshot on subscribe and the replay

The first frame for each market is a `SNAPSHOT` with `seq` 1 on a one-market socket, P1.
It is not taken at the subscribe instant.
It is the venue's last periodic snapshot, and the server then replays every delta since it in one burst before the live deltas.
On `BTC-USD` in P1 the snapshot arrived 56,753 ms after its `ts`, the next 400 deltas arrived within 125 ms with `ts` values spanning 45.8 s, and frame 500 arrived at 1,028 ms and 82 ms after its own `ts`.
On the all-markets stream 1,025 frames arrived within 1 s of the first frame, P1.
A book rebuilt from the replay matched the next snapshot exactly on all 390 markets of each all-markets run and on `BTC-USD`, P1 and P2, so the replay is complete.
On 2026-10-12 at 23:00 UTC the Rust adapter's probe showed that the replay runs one market after another.
Each market's snapshot came with all of its replayed deltas before the next market's snapshot, and no frame of another market came inside a replay, in the 13,892 replayed frames of that open and in the 3,139 of P2's all-markets capture.
So `BTC-USD`, which comes first, reaches deltas less than 1 s old while the other 389 markets still wait for their snapshots.
The live deltas queue behind the replay, which took 788 ms on that open and 334 ms in P2, and the first five arrived 1,271 to 1,311 ms after their `ts`.
But every replayed frame describes a book of up to 60 s ago, and a feed that publishes each one shows the engine a stale book with a fresh arrival time.

### Periodic snapshots

The documentation says snapshots repeat "every minute".
On a `BTC-USD` socket the later snapshots carried `ts` 59,998 and 119,999 ms after the first one, so the period is 60 s, P1.
On two all-markets sockets opened 94 s apart the periodic snapshot came 31.7 and 58.0 s after the open, so the clock is the venue's and not the connection's, P1.
In P2 it came 44.5 s after an all-markets open and 38.8 s after a one-market open, and every periodic snapshot of P1 and P2 arrived about 23 s past a whole minute.
All markets get their periodic snapshot in one burst, which spanned 38 ms for 390 markets, P1.
Each periodic snapshot is preceded by a `DELTA` with the same `ts`, and for an idle market that delta has no levels, P1.
A periodic snapshot takes the next `seq` on the connection, so it does not reset the count.

### Delta semantics

| field | documented, S1 | probed |
|---|---|---|
| `q` in a snapshot | "the absolute size" | absolute. Snapshot levels carry only `p` and `q` and no `c`, P1 |
| `q` in a delta | "the change in size" | the change: `q` equalled `c` minus the level's previous size on all 75,893 and 43,497 delta levels of two all-markets runs in P1, and on all 54,163 in P2 |
| `c` in a delta | "the absolute size" | absolute, and `"c":"0"` removes the level. 22,024 and 12,586 removals in the same runs, P1 |
| `data.d` | not documented | `"f"` on full-depth frames and `"1"` on `depth=1` frames, P1 |

So a feed reads `q` on a `SNAPSHOT` and `c` on a `DELTA`.
CCXT reads `c` first and falls back to `q` at `pro/extended.js` line 132, which gives the same result.

### Sequence and gap rule

`seq` is one counter per connection that every frame increments, whichever market it carries, P1.
On a one-market socket it is therefore also a per-market counter, which is how CCXT checks it, `nonce !== previousNonce + 1` per order book at `pro/extended.js` line 116.
On the all-markets socket a per-market check would see a gap on almost every frame, as 10,141 of 10,499 per-market steps did in P1.
The gap rule is therefore one counter per connection: a frame whose `seq` is not the previous frame's plus 1 ends the connection.

### Push cadence and age at arrival

| frame | arrival minus `ts`, P1 |
|---|---|
| `DELTA` on order book markets, all-markets stream | median 122 ms, p90 178 ms |
| `DELTA` on the one-market `BTC-USD` socket | min 75 ms, and 82 ms on the first live frame after the replay |
| `SNAPSHOT` | from 309 ms to days, because `ts` is the last change |
| `depth=1` `SNAPSHOT` | median 72 ms, p90 79 ms, max 101 ms |

Delta `ts` values on `BTC-USD` fell 21 to 25 ms after a whole 100 ms step, so the venue batches on a 100 ms clock, P1.
The host's clock was within 2 ms of two NTP servers, P1 mode `clock`.
The venue runs in AWS Tokyo, and no frame arrived sooner than 61 ms after its `ts`, P2, so about that much of every age is the path to this host.

### Level order on the wire

Snapshot bids were descending and asks ascending on all 780 snapshots of each all-markets run, P1.
Delta bids with two or more levels were descending on 4,460 of 4,460 frames, P1.

### Depth

A full-depth snapshot is the whole book.
`BTC-USD` carried 3,523 to 3,535 bids and 2,921 to 2,933 asks, and the largest frame on its socket was 181,218 bytes, P1.
Order book markets carried a median of 53 bids and 45 asks in their first snapshot, and 3 of 47 had fewer than 20 bids, P1.
RFQ markets carried a median of 2 levels a side, and 268 of 280 had fewer than 20 bids, P1.
There is no 20-level stream, so the feed takes full depth, which the 100 ms push keeps cheap: one all-markets socket carried 4.26 MB in 65 s, P1.

### Size unit against CCXT `contractSize`

Sizes are in units of the market's asset, and CCXT sets `contractSize` 1 on every perpetual at `extended.js` line 553.
On the `k` markets one unit is 1,000 tokens, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

Of the 280 ACTIVE RFQ markets on the stream, 46 had empty books in both snapshots, all of them RWA equities whose `tradingHours` are `NO_OVERNIGHT` or `WEEKDAYS`, P1.
Seven more ACTIVE RFQ markets had one-sided books, such as `SHOP-USD` with 1 bid and no ask, P1.
Every ACTIVE order book market had two sides.
Delisted, prelisted and reduce-only markets still stream: 53 delisted, 6 prelisted and 1 reduce-only market sent snapshots, 59 of them empty, and 17 of them carried `ts` 0, P1.

### Unknown, closed and wrong subscriptions

| path | result, P1 and P2 |
|---|---|
| `orderbooks/NOPE-USD`, `orderbooks/btc-usd`, `orderbooks/BTC-USDT` | opened, silent for 5 s, no close |
| `prices/mark/NOPE-USD` | ended without a close frame, 1006, 537 ms after the open began, so right after the handshake, P2 |
| `orderbooks/BTC-USD?depth=5` | ended without a close frame, 1006, 483 ms after the open began, P2 |
| `orderbooks/rfq/BTC-USD`, a non-RFQ market | no data, and a close frame 1000 556 ms after the open began, right after the handshake, P2 |
| an unknown path | 404 at the handshake |

So a misspelt market is silent, and the feed's first-book watch is the only thing that notices it.

### RFQ markets

For an RFQ market the default book stream "returns the indicative order book", which is "derived from market maker quotes and contains no user orders", S1.
The real book, where user orders rest and market makers pick them up, is only on `orderbooks/rfq/{market}`, S1.
On `AIA-USD` the indicative book held 32 levels a side and the real book 2, both with the same frame shapes, P1.
A taker on an RFQ market fills only if a market maker picks the order up within 11 child quotes of 100 ms, S1, so neither book is a firm price for a taker.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server pings every 15 s, pong within 10 s, S1 | server pings about every 1.13 s and waits for each pong. No pong closed the socket with 1011 `Ping timeout` 14,998 and 15,000 ms after the unanswered ping, P1 and P2 |
| client ping | "it will respond with a pong if one is received", S1 | pong in 136 and 131 ms, P1 and P2 |
| silence the server tolerates | Not publicly specified | the server only needs pongs. The client sends nothing else |
| forced disconnects | not documented | none in any socket of up to 65 s, P1 |
| maintenance notice | Discord, 24 h, 1 h and 10 minutes ahead, S4 | none on the socket |
| compression | not documented | a `permessage-deflate` offer was not accepted, with no `Sec-WebSocket-Extensions` in the reply, and every frame was text JSON, P1 |
| User-Agent | "the User-Agent header is required", S1 | required: a handshake without one got 403 from `awselb/2.0`, P2 |
| handshake limits | Not publicly specified | no refusal in P1 or P2 |

## 6. Captured frames

The first frame on a `BTC-USD` full-depth socket, trimmed to 4 levels a side, P1:

```json
{"type": "SNAPSHOT", "data": {"t": "SNAPSHOT", "m": "BTC-USD", "b": [{"q": "19.11949", "p": "82520"}, {"q": "0.60620", "p": "82519"}, {"q": "0.60608", "p": "82518"}, {"q": "0.74127", "p": "82517"}], "a": [{"q": "0.00020", "p": "82521"}, {"q": "0.02422", "p": "82524"}, {"q": "0.73523", "p": "82525"}, {"q": "0.73512", "p": "82526"}], "d": "f"}, "ts": 1791843803422, "seq": 1}
```

The next frame, a replayed delta from 100 ms after that snapshot, P1:

```json
{"type": "DELTA", "data": {"t": "DELTA", "m": "BTC-USD", "b": [{"q": "0.00028", "p": "82502", "c": "0.00046"}, {"q": "-0.10000", "p": "82454", "c": "0.00100"}, {"q": "0.0001", "p": "80044", "c": "0.00042"}], "a": [{"q": "0.00011", "p": "82541", "c": "0.00011"}], "d": "f"}, "ts": 1791843803522, "seq": 2}
```

A delta on the real book of `AIA-USD` that removes a level, P1:

```json
{"type":"DELTA","data":{"t":"DELTA","m":"AIA-USD","b":[{"q":"-6130","p":"0.078153","c":"0"}],"a":[],"d":"f"},"ts":1791844090000,"seq":2}
```

A best bid and ask frame, P1:

```json
{"type":"SNAPSHOT","data":{"t":"SNAPSHOT","m":"BTC-USD","b":[{"q":"10.33729","p":"82499"}],"a":[{"q":"4.33627","p":"82500"}],"d":"1"},"ts":1791844003539,"seq":1}
```

A mark frame and an index frame from the all-markets streams, P1:

```json
{"type":"MP","data":{"m":"EUR-USD","p":"1.115885","ts":0},"ts":1791844019294,"seq":1}
```

```json
{"type":"IP","data":{"m":"EUR-USD","p":"1.115885","ts":1791844019000},"ts":1791844019296,"seq":1}
```

The keepalive is a protocol ping whose payload is the text `[ping 2fd7510fcae329235c1b9b111023fd52ab4c34aa3cee45f8a269cc2116907d35 ping]`, answered by a protocol pong with the same payload, P1.
No subscription acknowledgement and no error frame exists, so none was captured.
An unanswered ping ended with the close frame code 1011 and reason `Ping timeout`, P1.

## 7. Private channels

The account updates stream is `GET /stream.extended.exchange/v1/account` with the header `X-Api-Key`, and it carries orders, trades, positions and balances, S1.
It is named here for a future execution stage and was not opened.

## 8. Recommended feed shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api.starknet.extended.exchange/stream.extended.exchange/v1/orderbooks`, holding every tracked market | one socket carries every market, section 1. A one-market URL per plan also works if the builder prefers small connections |
| markets | the order book markets only, see [`rest.md`](./rest.md) section 2 | RFQ books are indicative, section 4 |
| subscribe frames | none | the path is the subscription |
| headers | `User-Agent`, through `FeedSettings.headers` | the documentation requires it on every request |
| untracked markets | skip any `data.m` the plan does not hold before calling `position` | the all-markets stream also carries 53 delisted, 6 prelisted, 1 reduce-only and 3 spot markets, and `position` warns once per unknown symbol |
| snapshot | reset the book from `q`, best first on both sides | section 4 |
| delta | set each level to `c`, remove it at `c` 0, ignore `q`. A delta with no levels changes nothing | section 4 |
| gap rule | per connection: `seq` must be the previous frame's `seq` plus 1, whatever the market, or call `resync` | section 4 |
| replay | hold each market's book in the venue's `State` from its opening snapshot, apply its replayed deltas there, and publish it once a frame of any other market arrives. On 2026-10-12 the Rust adapter took this rule in place of the one first written here, which waited for the first `DELTA` within 1,000 ms of `frame_recv_ts` and then published every book | the opening replay carries up to 60 s of history at fresh arrival times, and it runs one market after another, so the first fresh delta belongs to the first market while the others are still to come, section 4. `reset_book` always publishes, so a held book stays in `State` |
| keepalive | answer the server's protocol pings, which tungstenite does, and send no ping of our own, `ping_every` `None` | section 5 |
| `max_silence` | 10 s | the all-markets socket carries frames many times a second and pings every 1.13 s |
| checksum | none exists | section 3 |
| anchor on the socket | not needed, the REST bulk call carries index, mark and funding together, see [`rest.md`](./rest.md) section 8 | the mark and index streams push every 1.5 s per market, so they are a working fallback |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Extended API documentation, sections "Mandatory headers", "Public WebSocket streams", "RFQ markets" and "Private WebSocket streams" | https://api.docs.extended.exchange/ | 2026-10-12 | Extended, API docs | sections 1 to 7 |
| S2 | CCXT 4.5.68 `pro/extended.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/extended.js` | 2026-10-12 | CCXT | URLs, gap check and level field, sections 1 and 4 |
| S3 | CCXT 4.5.68 `extended.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/extended.js` | 2026-10-12 | CCXT | `contractSize`, section 4 |
| S4 | Platform Outage | https://docs.extended.exchange/extended-resources/more/platform-outage.md | 2026-10-12 | Extended, docs | maintenance notices, sections 3 and 5 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/extended/ws-probe.py) modes `clock`, `bookall` (run twice), `bookone`, `bbo`, `prices`, `funding`, `rfq`, `errors` and `silence`, 22:20 to 22:30 UTC | [`ws-probe.py`](../../../scripts/probes/venues/extended/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 6 |
| P2 | every mode rerun in the second pass, 22:34 to 22:40 UTC. A second copy of the run, started by mistake, overlapped it and wrote into the same capture, so only intact lines are cited | [`ws-probe.py`](../../../scripts/probes/venues/extended/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 5 |
