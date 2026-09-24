# Giottus WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:46 to 05:08 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

Giottus documents no WebSocket.
Its API reference lists only REST sections: Introduction, Setup, API Rate Limits, Public endpoints, Authentication, Wallet, Spot, Easy Buy/Sell and FAQ, S1.
The futures web page streams its book, trades, tickers and anchors over an undocumented Socket.IO server at `socket.giottus.com`, and this profile records that socket as found, captured by [`ws-probe.mjs`](../../../scripts/probes/venues/giottus/ws-probe.mjs).
Every "documented" cell below therefore reads Not publicly specified, and the probed cell describes an internal interface that Giottus may change without notice.
The book on that socket is Binance USD-M's book for the same contract, see section 4.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | none | `wss://socket.giottus.com/socket.io/?EIO=4&transport=websocket`, namespace `/futures`, opened in 975 to 1,145 ms over all runs |
| INR-M perpetuals | none | the same URL and namespace, the pair is chosen in the subscribe event |
| spot | none | namespace `/trade` on the same host, named in the home page script and not probed, since spot is out of scope |

The web client is Socket.IO v4.7.2, loaded from `https://www.giottus.com/lib/2.3.42/socket.io/socket.io.min.js`, and it connects with `transports: ['websocket']` and `withCredentials: true`, S2.
The home page names the namespaces `/basket`, `/ctsession`, `/dashboard`, `/fd`, `/futures`, `/home`, `/p2p`, `/sbs`, `/sip`, `/stake`, `/trade` and `/tradingview` on `https://socket.giottus.com/`, S3.
The chart of the futures page does not use this socket.
Its config sets `"wsUrl": "wss://fstream.binance.com/market/ws"` and `"baseUrl": "https://fapi.binance.com/fapi/v1"`, and a worker opens Binance kline streams directly, S2.
`socket.giottus.com` resolved to the three Cloudflare addresses of `api.giottus.com`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

Event names are those the page worker registers, S2, and every row was received by the probe.

| event | how it is requested | content | probed rate |
|---|---|---|---|
| `futurestopbidask_<pair>` | emit `init2` with `{"coinpair": "<pair>"}` | a full top 10 per side, prices and sizes as strings with a unit suffix | one frame about every 2 s, median 2,026 to 2,038 ms over four runs, extremes 1,324 and 2,172 ms |
| `futurestradehistory_<pair>` | the same `init2` | the latest trades, each id ending in `-BN` | 36 frames in 74 s on `BTC/USDT` in each of four runs |
| `tickerdata` | none, every socket in `/futures` gets it | a 24 h ticker for one pair per frame, with `top_bid` and `top_ask` | 17,276 to 23,450 frames in 74 s over five runs, all pairs |
| `markprice` | none, every socket in `/futures` gets it | `mark_price`, `index_price`, `settle_price`, `funding_rate`, `next_funding_time`, `exchange_id`, `exchange_symbol`, `ets` | 25,584 to 26,650 frames in 74 s over five runs, one per pair about every 3 s, median 2,995 to 3,005 ms, extremes 2,629 and 3,202 ms |
| `connection` | sent once after the namespace connects | an empty string | 1 |

No depth beyond 10 levels, no delta channel and no dedicated funding channel were found.
The `markprice` event carries all the anchor fields, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one host, one Socket.IO namespace per product, `/futures` for both perpetual families |
| subscribe frame shape | Not publicly specified | Socket.IO event with an ack id: `42/futures,0["init2","{\"coinpair\":\"BTC/USDT\"}"]`, the payload a JSON string inside the JSON array |
| unknown symbol expectation | Not publicly specified | `init2` for `NOPE/USDT` is acked with `43/futures,0[]`, the same ack as a real pair, and no book frame followed in 75 s, in four runs |
| chunk unit and budget | Not publicly specified | one pair per socket: a second `init2` on the `BTC/INR` socket 40 s in stopped `BTC/INR` book frames and started `ETH/INR`, 19 frames before and 0 after in each of four runs |
| keepalive mechanism | Not publicly specified | Engine.IO v4 server ping `2`, client pong `3`, with `pingInterval` 25,000 and `pingTimeout` 20,000 from the handshake |
| connection lifetime and maintenance notice | Not publicly specified | a socket that answered pings stayed open 60 s until the probe closed it, in two runs, and no notice event was seen |
| handshake and operation rate limits | Not publicly specified | three or four sockets opened in the same second were all accepted in every run, and no refusal was seen |
| public market data authentication | Not publicly specified | none, and no `Origin` header is needed: a socket without one joined `/futures` |
| message parse and routing | Not publicly specified | Engine.IO text frames, `42/futures,[event, payload]`, where `payload` is a JSON string to parse a second time, routed on the event name, which embeds the pair |
| subscribe acknowledgement shape | Not publicly specified | `43/futures,0[]`, returned in 247 to 541 ms, with no status and no error |
| symbol identifier format | Not publicly specified | `BTC/USDT` and `BTC/INR` in the event name, and the Binance id `BTCUSDT` in `exchange_symbol` of `markprice` |
| number representation | Not publicly specified | book prices and sizes are strings with a unit, `"87182.5 USDT"` and `"4.379 BTC"`, and anchor fields are plain decimal strings |
| timestamp representation | Not publicly specified | `ets` in Unix seconds on `markprice` and `tickerdata`, and trade `timeline` as `"2026-09-23 10:25:44"` in India time, UTC plus 5:30. The book frame carries no time |
| size unit | Not publicly specified | base coin, `"4.379 BTC"`, the same number Binance USD-M shows at that price |
| sequence semantics | Not publicly specified | none, every book frame is a complete top 10 |
| idle repeat behaviour | Not publicly specified | a full frame on a 2 s clock, and no `BTC` frame equalled its predecessor, see section 4 |

## 4. The book channel in detail

### Snapshot on subscribe

The first `futurestopbidask_<pair>` frame arrived 1 to 757 ms after the ack, over four subscriptions in two runs, which fits a push on a 2 s clock rather than a snapshot sent on subscribe.
Every later frame is again a complete top 10 per side.
There are no deltas, so a feed would call `resetBook` on every frame.

### Sequence and gap rule

None.
The frame has three keys, `topbids`, `topasks` and `coin_pair`, and no update id, timestamp or checksum.
A missed frame is invisible, and the next one replaces the book anyway.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `BTC/USDT`, 37 frames in each of four runs | descending on every frame | ascending on every frame |
| `BTC/INR`, 19 or 20 frames in each of four runs | descending on every frame | ascending on every frame |

### Level window

Every frame held exactly 10 bids and 10 asks.
The engine holds 20 levels per side, `DEPTH_LEVELS` at `server/src/engine/cluster/ClusterIndexBuilder.ts` line 17, read by `server/src/engine/Engine.ts` line 73, so this channel covers half of that.

### The book is Binance's

The probe opened Binance USD-M `btcusdt@bookTicker` and `btcusdt@depth20@100ms` beside the Giottus sockets and compared every Giottus frame with them, INR prices divided by 104.

| measure | `BTC/USDT` 04:56 UTC | `BTC/USDT` 05:05 UTC | `BTC/INR` 05:05 UTC |
|---|---|---|---|
| top bid and ask equal to Binance's current top at arrival | 35 of 37 | 32 of 37 | 16 of 20 |
| top bid and ask equal to some Binance top of the run | 37 of 37 | 37 of 37 | 20 of 20 |
| age at arrival of the Binance depth20 snapshot sharing the most levels, median | 570 ms | 661 ms | 675 ms |
| same, range | 52 to 872 ms | 56 to 743 ms | 68 to 944 ms |
| levels of 20, price and size, shared with that snapshot, median | 19 | 19 | 19 |

Two other runs agree where their probe was sound.
At 04:49 UTC 34 of 37 tops equalled Binance's current top, and the best snapshot was 36 to 773 ms old, over the last 20 s only.
At 05:03 UTC the best snapshot was 177 to 1,197 ms old on `BTC/USDT` and 191 to 1,313 ms on `BTC/INR`, with a median of 20 of 20 levels shared, while its top counts are void because the probe dropped the older Binance tops.
Prices and sizes on the Giottus book are Binance's, with INR prices multiplied by 104, and the Giottus copy is about 0.6 s older than Binance's own 100 ms depth stream at the median.
The trade tape agrees: `BTC/USDT` and `BTC/INR` delivered the same trade ids, such as `1790139344500-BN`, with the same quantities, and 9,059,960.00 INR is exactly 104 times 87,115.0 USDT.

### Size unit against CCXT `contractSize`

Giottus has no CCXT class, so there is no `contractSize` to compare.
Sizes are in base coin, `"4.379 BTC"` at the top of both the `BTC/USDT` and the `BTC/INR` book in the same second.
That is the unit of the Binance USD-M `BTCUSDT` book.

### One-sided and empty books

None was seen on `BTC/USDT`, `BTC/INR` or `ETH/INR`.
What a pair with an empty side sends is Not verified.

### Idle repeats

The server pushes the top 10 on a 2 s clock.
No `BTC/USDT` or `BTC/INR` frame equalled the one before it, 0 of 36 and 0 of 18 or 19 in two runs, but `BTC` changes within 2 s anyway.
A quiet pair was not subscribed, so whether an unchanged book is sent again is Not verified.
The page worker hashes each frame and drops one equal to the last, S2, which suggests that repeats occur.

### Unknown and closed symbols

| request | reply | then |
|---|---|---|
| `init2` `NOPE/USDT` | `43/futures,0[]` | no book frame in 75 s |
| a second `init2` on one socket | `43/futures,0[]` | the first pair stops and the second starts |

The 44 pairs in `delisted_contracts` were not subscribed.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | Engine.IO ping `2` from the server at 26.0 or 26.1 s and at 51.2 or 51.4 s in two runs, answered with `3` |
| silence the server tolerates | Not publicly specified | a socket that joined `/futures` and never answered a ping was closed by the server at 46.06 and 46.11 s with code 1005 in two runs, one `pingInterval` plus one `pingTimeout` |
| forced disconnect | Not publicly specified | none in 75 s on three sockets per run, or in 60 s on the answering socket |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, in two runs |
| handshake | Not publicly specified | 975 to 1,145 ms to open through Cloudflare, colo `YVR` or `SEA` in `cf-ray`, then `0{"sid":…,"upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}` |
| namespace join | Not publicly specified | `40/futures,` answered with `40/futures,{"sid":…}` about 250 ms later |
| throughput per socket | Not publicly specified | 252 to 306 KB per second on one `/futures` socket over five runs, almost all of it the `tickerdata` and `markprice` broadcast for all 1,066 pairs |

Every `/futures` socket receives the full broadcast whatever pair it asks for.
So a feed with one socket per pair would take 250 to 300 KB per second per socket, and 533 sockets would take about 130 to 160 MB per second, to read a 10 level book every 2 s.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Engine.IO open, then the namespace join and its answer.

```text
0{"sid":"hZu9r49qBaGJDkZ5CJPx","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40/futures,
40/futures,{"sid":"9rpB7xSho-rbMxp9CJPy"}
42/futures,["connection",""]
```

Subscribe and acknowledgement.

```text
42/futures,0["init2","{\"coinpair\":\"BTC/USDT\"}"]
43/futures,0[]
```

Book frame, three levels per side kept, with its payload parsed once.

```json
{"topbids": [{"price": "87182.5 USDT", "amount": "4.379 BTC", "total": "381772.2 USDT"}, {"price": "87182.4 USDT", "amount": "0.002 BTC", "total": "174.4 USDT"}, {"price": "87182.3 USDT", "amount": "0.001 BTC", "total": "87.2 USDT"}], "topasks": [], "coin_pair": "BTC/USDT"}
```

The same second on the INR row.

```json
{"topbids": [{"price": "9066980.00 INR", "amount": "4.379 BTC", "total": "39704305.42 INR"}, {"price": "9066969.60 INR", "amount": "0.002 BTC", "total": "18133.94 INR"}], "topasks": [], "coin_pair": "BTC/INR"}
```

In both, `topasks` was cut here and held 10 levels on the wire.

Anchor broadcast, parsed once.

```json
{"symbol": "BTC/USDT", "mark_price": "87188.2", "settle_price": "87165.3", "index_price": "87222.5", "funding_rate": "0.00004038", "next_funding_time": "1790150400000", "template": "mark_price_ws_v1", "exchange_id": 1, "exchange_symbol": "BTCUSDT", "ets": 1790139384}
```

Ticker broadcast, parsed once and cut.

```json
{"symbol": "ETH/USDT", "price_change": "53.40", "price_change_percent": "1.957", "last_price": "2782.00", "top_bid": "2781.99", "top_ask": "2782.00", "ets": 1790138760}
```

Trade history, parsed once, first trade kept.

```json
[{"coin_pair": "BTC/USDT", "id": "1790139344500-BN", "timeline": "2026-09-23 10:25:44", "quantity": "0.010", "price": "87115.0", "total": "871.1", "type": "Buy"}]
```

Keepalive, server first.

```text
2
3
```

No error frame was produced by any request.

## 7. Private channels

Not publicly specified.
The page connects with `withCredentials: true`, so a logged-in session presumably receives its own events over the same socket, and none were probed.
The documented API offers no private stream, and private data is REST only, S1.

## 8. Recommended feed shape

No feed is recommended.

| item | finding | consequence |
|---|---|---|
| interface | undocumented Socket.IO namespace of the web page | Giottus can change it without notice, and no terms cover its use by a program |
| content | Binance USD-M's top 10, about 0.6 s older than Binance's own depth stream at the median | the engine's Binance feed already carries the same book, fuller and sooner |
| depth | 10 levels | half of the engine's 20 |
| cadence | one full frame every 2 s, no sequence | staleness is invisible between frames |
| cost | one pair per socket, and each socket carries about 250 KB per second of broadcast | 533 pairs would need 533 sockets |

If a later design wanted Giottus quotes anyway, the INR-M row is Binance times 104 and the USDT-M row is Binance itself, so both can be derived from the Binance feed without a Giottus socket.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Giottus API Reference | https://api.giottus.com/docs/ | 2026-09-22 | Giottus Technologies, India | no WebSocket documented, sections 1, 3 and 7 |
| S2 | Giottus futures page, its inline config, `futures.min.js`, `futuressocketworker.min.js` and `futuresbinancesocketworker.min.js`, version 2.3.42 | https://www.giottus.com/futures | 2026-09-22 | Giottus web front end | socket URL, `init2`, event names, Socket.IO version, Binance chart streams, frame hashing, sections 1, 2 and 4 |
| S3 | Giottus home page | https://www.giottus.com/ | 2026-09-22 | Giottus web front end | Socket.IO namespaces, section 1 |
| P1 | `ws-probe.mjs book`, runs at 04:47, 04:49, 04:56, 05:03 and 05:05 UTC on 2026-09-23, the first without book frames because three pairs shared one socket | [`ws-probe.mjs`](../../../scripts/probes/venues/giottus/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs session` at 04:52 and 05:07 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/giottus/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P3 | exploratory 15 s socket read at 04:46 UTC on 2026-09-23, kept only in the scratchpad | none | 2026-09-22 | this host | first look at the event names, section 2 |
