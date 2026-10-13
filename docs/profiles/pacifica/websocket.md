# Pacifica WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:21 to 22:28 UTC and in the second pass from 22:32 to 22:37 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers the public WebSocket API of Pacifica (CCXT id `pacifica`), with the book channel in detail.
Pacifica has one perpetual family, USDC-margined linear perpetuals, and one socket URL carries it together with the one spot market.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/pacifica/ws-probe.py), run with `uv run` from the repository root, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All times are UTC, and the probe runs are listed as P1 to P8 in section 9.
Fees and access are in [`fees.md`](./fees.md), and the catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every market, mainnet | `wss://ws.pacifica.fi/ws`, S1 | opened in 288 and 292 ms in P1 and P5, and served every perpetual and `SOL-USDC`, P1 to P7 |
| testnet | `wss://test-ws.pacifica.fi/ws`, S1 | not probed |

One socket carries every market, perpetual or spot, P2.
The upgrade reply carried no `server`, `via` or `x-amz-cf-pop` header, P1 and P5.
`ws.pacifica.fi` resolved to `15.197.142.252` and `3.33.159.53` under the CNAME `a14329370ad35a6b4.awsglobalaccelerator.com`, P5, so the socket enters AWS Global Accelerator, while the REST host is behind CloudFront.

## 2. Channel matrix for public market data

| channel | subscription, S2 to S6 | payload | documented cadence | probed |
|---|---|---|---|---|
| `book` | `{"method":"subscribe","params":{"source":"book","symbol":"BTC","agg_level":1}}` | the whole book, 10 levels per side, with `s`, `t` and `li` | "updates once every 250ms", S3. The changelog of 2025-10-25 says the interval improved "from 500ms to 100ms", S8 | 4.0 frames a second on every symbol, p50 interval 250 ms, 10 and 10 levels on every frame, P1, P3, P5 and P7 |
| `book` aggregated | `agg_level` 10, 100, 1,000 or 10,000, S3 | 10 levels in price buckets | | level 7 is refused, section 4 |
| `bbo` | `{"method":"subscribe","params":{"source":"bbo","symbol":"BTC"}}` | best bid and ask with sizes, `i`, `li`, `t` | "sent whenever the top of book changes", S4 | 7.1 to 8.8 frames a second on `BTC` and 10.6 to 11.8 on `ETH`, never repeating the previous touch, age at arrival p50 50 to 51 ms, P1 and P5 |
| `prices` | `{"method":"subscribe","params":{"source":"prices"}}` | every market's `oracle`, `mark`, `mid`, `funding`, `next_funding`, `open_interest`, `volume_24h`, `yesterday_price` and `timestamp` | "as they update", S5 | one frame of all 78 markets every 3,000 ms, age at arrival p50 57 ms, P1 and P5 |
| `trades` | `{"method":"subscribe","params":{"source":"trades","symbol":"SOL"}}` | trades with `h`, `a`, `p`, `d`, `tc`, `t`, `li`, `it` | "as they occur", S6 | one frame on `BTC` in 60 s of P1 and four in P5 |
| `candle`, `mark_price_candle` | `source` with `symbol` and `interval` from `1m` to `1M`, S2 | candles of trades or of the mark | | not probed |

No dedicated index or funding channel exists apart from `prices`, which carries index, mark and funding for every market in one frame.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one mainnet URL, S1 | one socket carried perpetuals and `SOL-USDC`, P2 |
| subscribe frame shape | `{"method":"subscribe","params":{…}}`, one stream per frame, S1 | as documented. `book` without `agg_level` is refused with `Invalid subscription parameters.`, P2 and P6 |
| unknown symbol expectation | Not publicly specified | `book` on `NOPE` or `btc` answers `{"error":"Symbol not found"}`, which names no symbol, and the socket stays open and keeps its other streams. `bbo` on `NOPE` is acknowledged and then silent, P2 and P6 |
| chunk unit and budget | "Max 20 subscriptions per channel per connection" and "Max 100 concurrent connections per IP", S7 | 25 `book` streams on one socket were all acknowledged and all served, and so were 20 `book` plus 20 `bbo`, P2 and P6. The limit was not enforced at 25 |
| keepalive mechanism | client sends `{"method":"ping"}`, server answers `{"channel":"pong"}`, S1 | pong in 92 and 105 ms, P1 and P5, and at 30 and 60 s on the pinging socket, P4 and P8 |
| connection lifetime and maintenance notice | closed "if no message is sent for the past 60 seconds, or the connection has been alive for 24 hours", S1 | a subscribed socket that sent nothing after its subscribes was closed at 60.3 s with code 1001 while it was receiving 4 frames a second, P3 and P7. The 24 h close was not waited for. No maintenance notice seen |
| handshake and operation rate limits | 100 connections per IP, S7 | at most four sockets at once, with no refusal |
| public market data authentication | none. An API Config Key in a `PF-API-KEY` header only raises limits, S7 | none |
| message parse and routing | `{channel, data}`, S2 | route on `channel`, then `data.s` for `book` and `bbo`, `data[i].s` for `trades`, and `data[i].symbol` for `prices`. Errors carry no `channel`, section 4 |
| subscribe acknowledgement shape | not documented | `{"channel":"subscribe","data":{"source":"book","symbol":"BTC","agg_level":1}}` before the first data frame, 93 to 182 ms after the first subscribe, P1 and P5 |
| symbol identifier format | case-sensitive catalog symbols, `kBONK` and `kPEPE` with a lowercase prefix, S9 | `BTC`, `kPEPE`, `SOL-USDC`, spelled on data frames exactly as subscribed, and equal to CCXT's `market.id`, section 4 |
| number representation | decimal strings for prices and sizes, integers for `n`, `t` and `li`, S3 | as documented |
| timestamp representation | `t` in ms, S3 | integer ms. On a quiet book `t` does not advance between frames, section 4 |
| size unit | tokens of the base asset, S10 | base units, which matches CCXT `contractSize` 1. A `k` prefix means thousands, section 4 |
| sequence semantics | `li`, documented as "Monotonically increasing" and for use "to order updates and detect gaps", S3 and S11 | every `book` frame is a whole book, so no gap rule applies. `li` never went backwards over 18,557 and 18,480 frames, and it stayed the same on 13,035 of 18,480 and 13,133 of 18,403 transitions, P3 and P7 |
| idle repeat behaviour | not documented | an unchanged book is resent every 250 ms, on 13,778 of 18,480 and 14,005 of 18,403 transitions over all 77 perpetuals, P3 and P7. `bbo` never repeats itself, P1 and P5 |

## 4. The book channel in detail

### Snapshot semantics

Every `book` frame is the whole book at `agg_level` 1, 10 bids and 10 asks, on 1,440 of 1,440 frames in P1, 18,557 of 18,557 in P3, 1,443 of 1,443 in P5 and 18,480 of 18,480 in P7.
There is no delta, no checksum and no separate snapshot message, and CCXT Pro treats every frame as a reset, at `pro/pacifica.js` lines 521 to 531.
So a feed replaces the book on every frame, and a lost frame costs only freshness.
The first frame arrives 95 to 111 ms after the subscribe burst begins, P1 and P5.

### Cadence and the book's own time

Frames arrive on a 250 ms clock per symbol, p10 239 to 242 ms and p90 258 to 259 ms, whether the book changed or not, P1 and P5.
`t` is the time of the book's last change, not of the push.
On `BTC`, `ETH` and `SOL` the median step of `t` between frames was 214 to 248 ms, while on `kPEPE`, `XAU` and `BP` it was 0, P1 and P5.
So arrival minus `t` measured 55 to 58 ms at the least on an active book, and grew to 20.8 s on a quiet one in P1 and 40.2 s in P3.
A feed must not read `t` as the age of the data it holds, because an unchanged book is as fresh as its last push.

| stream | arrival minus `t` | runs |
|---|---|---|
| `book`, 6 symbols | min 56 and 58, p50 254 and 313, p90 5,097 and 7,900, max 20,810 and 20,475 ms | P1 and P5 |
| `book`, 77 perpetuals | min 54 and 55, p50 1,000 and 1,044, p90 9,198 and 8,442, max 40,215 and 32,391 ms | P3 and P7 |
| `bbo`, `BTC` and `ETH` | min 48 to 50, p50 50 to 51, p90 52 to 58, max 70 to 266 ms | P1 and P5 |
| `prices`, 78 markets | min 54 and 56, p50 57, p90 59 and 61, max 1,158 and 2,209 ms | P1 and P5 |

The `BTC` book's best levels equalled the latest `bbo` received before it on 236 of 237 frames in P1 and 238 of 239 in P5.

### Last ID

`li` is the venue's "Last ID", S11.
Its values on `BTC`, `ETH` and `SOL` were within 12 of each other at 14,138,413,929 to 14,138,413,941, so it is one exchange-wide event counter, stamped on each symbol by its latest event.
Between two frames of one symbol it stepped by p50 64 and 8 and max 22,827 and 13,273 on six symbols, P1 and P5, and it never went backwards, P1, P3, P5 and P7.
Because each frame is whole, a feed may drop a frame whose `li` is lower than the last one it applied, and has no gap to detect.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| every `book` frame | best first, descending, with 0 exceptions in 39,920 frames, P1, P3, P5 and P7 | best first, ascending, with 0 exceptions |
| crossed book | 0 frames with the best bid at or above the best ask, P1, P3, P5 and P7 | |
| empty side | 0 frames on the 77 perpetuals, P3 and P7 | |

### Size unit against CCXT `contractSize`

| symbol | CCXT `contractSize` | size at the touch | meaning |
|---|---:|---|---|
| `BTC` | 1 | `"0.27557"` at 82,681 | 0.27557 BTC |
| `kPEPE` | 1 | `"5141380"` at 0.003991, from the REST book in [`rest.md`](./rest.md) section 5 | 5,141,380 kPEPE, which is 5.14 billion PEPE at 0.000003991 each |

Sizes are units of the named asset, S10, and CCXT sets `contractSize` 1 for every swap at `pacifica.js` line 690.
`kPEPE`, `kBONK` and `kSHIB` are priced and sized per 1,000 tokens, see [`rest.md`](./rest.md) section 2.

### Market id against the socket symbol

CCXT's `market.id` is the catalog `symbol`, at `pacifica.js` lines 665 and 710, and it equalled `info.symbol` on 77 of 77 swaps, see [`fees.md`](./fees.md) section 8.
The socket takes and returns that same spelling, so `rawMarketId` is `market.id` with no change.
CCXT's `base` uppercases the `k` names to `KPEPE`, `KBONK` and `KSHIB`, which cluster with nothing, see [`rest.md`](./rest.md) section 2.

### Unknown, closed and malformed subscriptions

| request | reply | socket |
|---|---|---|
| `book` on `NOPE`, or on `btc` | `{"error":"Symbol not found"}` | stays open |
| `book` with `agg_level` 7 | `{"error":"Invalid aggregation level"}` | stays open |
| `book` without `agg_level` | `{"code":400,"err":"Invalid subscription parameters.","t":…}` | stays open |
| `bbo` on `NOPE` | acknowledged, then nothing | stays open |
| unknown `source` | `Invalid subscription parameters.` as above | stays open |
| text that is not JSON | `{"code":400,"err":"Invalid JSON body.","t":…}` | stays open |
| unknown `method` | `{"code":400,"err":"Unknown request. Use 'subscribe', 'unsubscribe', or 'ping' as method, or provide 'id' and 'params' for trades.","t":…}` | stays open |
| `book` on `BTC` twice | one acknowledgement, and frames still 4 a second | stays open |
| unsubscribe of a stream never subscribed | `{"channel":"unsubscribe","data":{…}}` | stays open |
| `book` on `NOPE`, then `book` on `BTC` | the error, then `BTC` acknowledged and served | stays open |
| `book` on `SOL-USDC` | acknowledged and served | stays open |

These held in P2 and in the rerun P6.
An error frame names neither the symbol nor the request, so a feed that subscribes in a burst cannot tell which symbol failed except by the order of the replies or by a symbol that never books.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"method":"ping"}` answered by `{"channel":"pong"}`, S1. CCXT Pro pings every 20 s with that frame, at `pro/pacifica.js` lines 59 to 61 and 1370 to 1374 | pong in 92 and 105 ms, P1 and P5, and on every ping of P4 and P8 |
| silence the server tolerates | 60 s without a client message, S1 | a socket that subscribed nothing and sent nothing closed at 60.3 s with code 1006 and no close frame, P4 and P8. Subscribed sockets that sent nothing after subscribing were closed at 60.3 to 60.4 s with code 1001 while frames were arriving, four in P3 and one in P7, whose other three ended at the probe's own 60 s first. A socket that pinged every 30 s stayed open for 75 s, P4 and P8. So the clock counts client messages, and data from the server does not reset it |
| forced disconnect | after 24 h, S1 | not waited for |
| maintenance notice | none documented | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, P1 and P5 |
| handshake | | 288 and 292 ms to open, P1 and P5 |
| subscription limits | 20 per channel per connection, 100 connections per IP, S7 | not enforced at 25, section 3 |
| throughput, 77 perpetuals | | 310.6 and 309.3 frames a second and 227.6 and 226.7 KiB a second over four sockets, 749 and 751 bytes a frame at p50, and 23.9 and 18.3 µs of Python `json.loads` a frame, P3 and P7 |


## 6. Captured frames

Trimmed, from the probe runs of 2026-10-12.
Level arrays are cut to three per side, the `prices` frame to two of its 78 rows, and the values are as received.

Subscribe and acknowledgement, P1.

```json
{"method":"subscribe","params":{"source":"book","symbol":"BTC","agg_level":1}}
```

```json
{"channel":"subscribe","data":{"source":"book","symbol":"BTC","agg_level":1}}
```

Book, P5, whose 10 levels per side are cut to 3 and whose other keys are as received.

```json
{"channel":"book","data":{"s":"BTC","l":[[{"p":"82669","a":"0.0012","n":1},{"p":"82666","a":"0.00735","n":1},{"p":"82651","a":"0.03613","n":1}],[{"p":"82670","a":"1.96694","n":21},{"p":"82671","a":"0.1931","n":3},{"p":"82672","a":"1.19434","n":3}]],"t":1791844355028,"li":14138827444}}
```

Best bid and offer, P1.

```json
{"channel":"bbo","data":{"s":"ETH","i":13489125699,"li":14138414191,"t":1791843700425,"b":"2491","B":"4.4767","a":"2491.1","A":"3.3302"}}
```

Prices, P5, cut to the `kPEPE` and `BTC` rows of 78.

```json
{"channel":"prices","data":[{"symbol":"kPEPE","funding":"0.0000125","next_funding":"0.0000125","oracle":"0.004006","mark":"0.004001","mid":"0.004","yesterday_price":"0.00419","open_interest":"7244448","volume_24h":"24720.007348","timestamp":1791844353313},{"symbol":"BTC","funding":"0.0000125","next_funding":"0.0000125","oracle":"82672.679431","mark":"82669","mid":"82669.5","yesterday_price":"83614","open_interest":"599.86197","volume_24h":"346919247.45286","timestamp":1791844353313}]}
```

Trade, P1.

```json
{"channel":"trades","data":[{"h":298216231,"s":"BTC","a":"0.00087","p":"82660","d":"open_short","tc":"normal","t":1791843742600,"li":14138452529,"it":0}]}
```

Keepalive.

```json
{"method":"ping"}
```

```json
{"channel":"pong"}
```

Errors, P2.

```json
{"error":"Symbol not found"}
```

```json
{"error":"Invalid aggregation level"}
```

```json
{"code":400,"err":"Invalid subscription parameters.","t":1791843778499}
```

```json
{"code":400,"err":"Invalid JSON body.","t":1791843787694}
```

## 7. Private channels

Named for a future execution stage, from S2, not probed.

- The account channels are `account_margin`, `account_leverage`, `account_info`, `account_positions`, `account_order_updates`, `account_trades` and `account_transfers`, S2.
- Order entry over the socket sends signed actions with an `id` and `params`, as CCXT Pro builds them at `pro/pacifica.js` lines 109 to 125 and 1387 to 1398.
  The observatory never sends one.
- Market, GTC and IOC orders wait through a speed bump of about 200 ms, S8, so a taker leg here reaches the book about 200 ms after it is sent.

## 8. Recommended feed shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.pacifica.fi/ws`, for every perpetual | one socket carries every market |
| book channel | `book` with `agg_level` 1 | 10 levels is the deepest Pacifica offers, which decision 22 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) accepts, and `agg_level` is required |
| merge | on every `book` frame, `reset_book` with its 10 levels and `publish` | each frame is the whole book |
| markets per connection | 20, so four connections for 77 perpetuals | the published cap is 20 per channel per connection, S7, and 25 worked in P2, so 20 keeps inside the published limit |
| subscribe frames | one frame per market, `{"method":"subscribe","params":{"source":"book","symbol":"<symbol>","agg_level":1}}` | the documented shape, and a missing `agg_level` is refused |
| catalog guard | subscribe only `perpetual` symbols from the live `GET /api/v1/info`, spelled as listed | the symbols are case-sensitive, and an unknown one answers an error that names no symbol |
| keepalive | the text frame `{"method":"ping"}` every 30 s through `ping_every`, overriding the default protocol ping of `BookVenue::ping` at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 88 | the server closes a socket 60 s after the client's last message, however much data it is sending |
| `max_silence` | 5 s | every symbol pushes a book every 250 ms even when unchanged |
| connection lifetime | `retire_after` a little under 24 h, as binance does | the documented 24 h close |
| routing | `channel`, then `data.s` | the symbol is spelled as subscribed |
| sequence and resync | no gap rule. Optionally skip a frame whose `li` is below the last applied one, which never happened in P1, P3, P5 or P7 | every frame is whole |
| error frames | log the frame whole, with the symbols subscribed in the last second | an error names no symbol |
| deflate | keep it refused | the server does not negotiate it |
| anchor | the REST poll of [`rest.md`](./rest.md) section 8, or the `prices` channel as a socket anchor | `prices` carries every market's oracle, mark and funding every 3 s at about 57 ms of age |
| `bbo` | not needed for a first version | the book is at most 250 ms behind the touch, and a `bbo` merge would double the subscriptions |

The feed fits `BookVenue` at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 78 without new runtime code.
`plan` makes four plans of at most 20 markets, `subscribe_frames` returns one frame per market, `ping` returns the text ping, and `handle` calls `reset_book` and `publish`, at lines 204 and 214.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Websocket | https://docs.pacifica.fi/api-documentation/api/websocket | 2026-10-12 | Pacifica, API docs | URLs, frame shapes, ping, 60 s and 24 h rules, sections 1, 3 and 5 |
| S2 | Subscriptions | https://docs.pacifica.fi/api-documentation/api/websocket/subscriptions | 2026-10-12 | Pacifica, API docs | channel list, account channels, sections 2 and 7 |
| S3 | Orderbook | https://docs.pacifica.fi/api-documentation/api/websocket/subscriptions/orderbook | 2026-10-12 | Pacifica, API docs | `book` shape, `agg_level`, 250 ms, `li`, sections 2 to 4 |
| S4 | Best Bid Offer (BBO) | https://docs.pacifica.fi/api-documentation/api/websocket/subscriptions/best-bid-offer-bbo | 2026-10-12 | Pacifica, API docs | `bbo` shape, section 2 |
| S5 | Prices | https://docs.pacifica.fi/api-documentation/api/websocket/subscriptions/prices | 2026-10-12 | Pacifica, API docs | `prices` shape, section 2 |
| S6 | Trades | https://docs.pacifica.fi/api-documentation/api/websocket/subscriptions/trades | 2026-10-12 | Pacifica, API docs | `trades` shape, section 2 |
| S7 | Rate Limits | https://docs.pacifica.fi/api-documentation/api/rate-limits | 2026-10-12 | Pacifica, API docs | socket limits and API Config Keys, sections 3 and 5 |
| S8 | Changelog | https://docs.pacifica.fi/api-documentation/changelog | 2026-10-12 | Pacifica, API docs | 100 ms book interval of 2025-10-25, `li` added to `book` on 2026-01-01, the 200 ms speed bump of 2025-11-12, sections 2 and 7 |
| S9 | Market Symbols | https://docs.pacifica.fi/api-documentation/api/market-symbols | 2026-10-12 | Pacifica, API docs | case-sensitive symbols, section 3 |
| S10 | Contract Specifications | https://docs.pacifica.fi/trading-on-pacifica/contract-specifications | 2026-10-12 | Pacifica, docs | "1 unit of underlying spot asset", sections 3 and 4 |
| S11 | Last ID | https://docs.pacifica.fi/api-documentation/api/last-id | 2026-10-12 | Pacifica, API docs | `li` semantics, sections 3 and 4 |
| S12 | CCXT Pro 4.5.68 `pacifica.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/pacifica.js` | 2026-10-12 | CCXT | URL, 20 s ping, book reset, routing, sections 4, 5 and 7 |
| S13 | CCXT 4.5.68 `pacifica.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pacifica.js` | 2026-10-12 | CCXT | `market.id` and `contractSize`, section 4 |
| P1 | `ws-probe.py deflate book` at 22:21 UTC | [`ws-probe.py`](../../../scripts/probes/venues/pacifica/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 6 |
| P2 | `ws-probe.py errors` at 22:22 UTC | [`ws-probe.py`](../../../scripts/probes/venues/pacifica/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3, 4 and 6 |
| P3 | `ws-probe.py batch` at 22:25 UTC on 77 perpetuals over four sockets. An earlier start at 22:23 ended on the same 60 s close before it printed | [`ws-probe.py`](../../../scripts/probes/venues/pacifica/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 to 5 |
| P4 | `ws-probe.py silence` at 22:26 UTC | [`ws-probe.py`](../../../scripts/probes/venues/pacifica/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 5 |
| P5 | `ws-probe.py deflate book`, the second pass | [`ws-probe.py`](../../../scripts/probes/venues/pacifica/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 to 6 |
| P6 | `ws-probe.py errors`, the second pass | [`ws-probe.py`](../../../scripts/probes/venues/pacifica/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 and 4 |
| P7 | `ws-probe.py batch`, the second pass | [`ws-probe.py`](../../../scripts/probes/venues/pacifica/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 to 5 |
| P8 | `ws-probe.py silence`, the second pass | [`ws-probe.py`](../../../scripts/probes/venues/pacifica/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 5 |
