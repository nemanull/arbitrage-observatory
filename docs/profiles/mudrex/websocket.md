# Mudrex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:17 to 04:30 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada (Cloudflare loc=CA, SEA edge).

This profile covers the public market data WebSocket of Mudrex (CCXT id `mudrex`), which serves its USDT-quoted linear perpetuals.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/mudrex/ws-probe.mjs), and the capture is quoted beside the documented value.
The short answer is that Mudrex publishes no order book of any depth, over the socket or over REST.
The socket carries 1 s and 1 m candles of last and mark price and a ticker of last and mark price, and nothing a book feed can be built from.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-quoted linear perpetuals | `wss://trade.mudrex.com/fapi/v1/price/ws/linear`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/mudrex.js` line 23 | opened in 297 to 413 ms over 15 opens, HTTP 101, `server: mudrex.edge`, `via: 1.1 kong/3.9.0` and CloudFront |
| inverse | not documented | `wss://trade.mudrex.com/fapi/v1/price/ws/inverse` answered HTTP 404 `{"code":404,"text":"requested resource was not found"}` in both runs |
| spot | not documented | `wss://trade.mudrex.com/fapi/v1/price/ws/spot` answered the same 404 in both runs |

One socket carries every perpetual.
The ticker stream accepted 1,136 and then 1,204 candidate symbols in one subscription, and its snapshot returned 745 of them, all Bybit USDT perpetual symbols, see [`rest.md`](./rest.md) section 2.
No handshake to the documented URL was refused from the Canadian exit.

## 2. Channel matrix for public market data

| stream | name | documented cadence | probed on 2026-09-23 UTC |
|---|---|---|---|
| price kline 1 s | `kline@1s@<symbol>` | OHLCV candle | 37 and 38 BTC frames in about 42 s, median gap 1,000 ms, max 3,004 and 2,000 ms. `o`, `h` and `l` stayed fixed and `v` grew across frames, see section 4 |
| price kline 1 m | `kline@1m@<symbol>` | OHLCV candle | one frame in about 42 s in each run, carrying the candle that had just closed, 60 to 61 s after its open time |
| mark kline 1 s | `markKline@1s@<symbol>` | OHLC, no volume | 24 and 34 BTC frames in about 42 s, median gap 1,203 and 908 ms, max 3,903 and 2,102 ms |
| mark kline 1 m | `markKline@1m@<symbol>` | OHLC, no volume | one frame per run, the just-closed candle |
| ticker 1 s | `ticker@1s` plus an `assets` list | "Changed prices every 1 second" | 43 pushes in each run, median gap 1,000 and 1,001 ms, a 745 row snapshot, then a median of 62 and 64 changed rows per push |
| ticker 5 s | `ticker@5s` plus an `assets` list | "Changed prices every 5 seconds" | acknowledged, not measured |
| order book, best bid and ask, trades, index, funding | none documented | 13 guessed names refused with 400 `invalid stream name`, section 4 |

The stream table is from S1.
The ticker row carries `s`, `p` for last price and `mp` for mark price, with no bid, ask, size or timestamp, S1.
Every one of 3,701 and 3,763 ticker rows in the two runs carried `mp`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, `/price/ws/linear`, S1 | one URL served 745 perpetuals, and `/inverse` and `/spot` answered 404 |
| subscribe frame shape | `{"id": 1, "method": "SUBSCRIBE", "params": ["kline@1m@btcusdt"], "assets": ["btcusdt"]}`, where `assets` applies only to a ticker stream, S1 | four kline streams in one `params` array got one ack. A ticker frame with 1,204 `assets` got one ack |
| unknown symbol expectation | "Assets with no data yet are omitted from the snapshot.", S1 | `kline@1s@nopeusdt` and `ticker@5s` with `assets: ["nopeusdt"]` were both acknowledged `success`, listed by `LIST_SUBSCRIPTIONS`, and never delivered |
| chunk unit and budget | "Max 15 active subscriptions per connection." A ticker stream "counts as 1 regardless of asset count", and the "ticker asset count is unlimited", S1 | the 16th single-stream subscription on one socket got `{"code":429,"msg":"subscription limit reached"}` in both runs. 1,204 ticker assets counted as one |
| keepalive mechanism | "The server closes the connection after 40 seconds of inactivity. Any client message - a PING frame, `SUBSCRIBE`, `UNSUBSCRIBE`, or `LIST_SUBSCRIPTIONS` - resets the inactivity timer.", recommended every 20 s, S1. CCXT Pro sends `{"id": n, "method": "PING"}` every 20 s, `pro/mudrex.js` lines 30, 31 and 38 | a JSON `{"method": "PING"}` is answered `{"code":400,"msg":"unknown method"}`, which still counts as a client message. A protocol ping is answered with a pong in 70 and 73 ms and kept a socket open. No server ping arrived on any socket |
| connection lifetime and maintenance notice | Not publicly specified | none in 65 s, no notice frame seen |
| handshake and operation rate limits | "New connections: max 10 per minute per IP", and a breach "returns `HTTP 429 Too Many Requests`", S1, S2 | no refusal at up to three opens within a second. The limit was not tested |
| public market data authentication | none, the page calls the streams public with "no authentication required", S1 | none |
| message parse and routing | pushes are `{"stream": "<stream-name>", "data": <payload>}`, S1 | as documented. Kline `data` is one object with `s`, ticker `data` is an array of rows with `s` |
| subscribe acknowledgement shape | `{ "method": "SUBSCRIBE", "id": 1, "result": "success" }`, and an error carries `error: {code, msg}`, S1 | as documented, answered in 68 to 88 ms in the first run. A frame mixing a valid and an invalid stream is refused whole, as S1 says |
| symbol identifier format | lowercase, no slash, `btcusdt`, and "both upper & lowercase" accepted, S1, S2 | `kline@1s@ETHUSDT` was acknowledged and delivered as `kline@1s@ethusdt`. CCXT's `market.id` is the uppercase `BTCUSDT`, so a feed lowercases it |
| number representation | "Price and volume values are JSON numbers (floating)", S2 | JSON numbers on every ticker row and kline frame |
| timestamp representation | kline `t` is the "Candle open time (Unix seconds)", S1 | kline `t` in seconds. The ticker row has no timestamp |
| size unit | not applicable, no stream carries a book size | kline `v` only |
| sequence semantics | none documented | no stream carries a sequence or update id |
| idle repeat behaviour | the ticker sends "Only assets whose price changed since the previous window", and "If no subscribed asset changed, no message is sent.", S1 | no identical kline frame was repeated. `markKline@1s` skipped seconds, up to 3.9 s, while the mark did not move |

## 4. The book channel in detail

There is no book channel.
The documentation lists six streams and none is a book, S1.
The CCXT class sets `fetchOrderBook: false` at `server/node_modules/ccxt/js/src/mudrex.js` line 58, and CCXT Pro implements only `watchTicker`, `watchTickers` and `watchOHLCV`.
The probe asked for 13 names, each in its own frame: 12 guesses at book, trade, index and funding streams and one unsupported interval, and each got `{"code":400,"msg":"invalid stream name: …"}`.

| name tried | reply |
|---|---|
| `depth@btcusdt`, `depth20@btcusdt`, `depth@100ms@btcusdt` | 400 `invalid stream name` |
| `orderbook@btcusdt`, `orderBook@btcusdt`, `bookTicker@btcusdt` | 400 `invalid stream name` |
| `trade@btcusdt`, `aggTrade@btcusdt` | 400 `invalid stream name` |
| `markPrice@btcusdt`, `index@btcusdt`, `indexKline@1s@btcusdt`, `funding@btcusdt` | 400 `invalid stream name` |
| `kline@5m@btcusdt` | 400 `invalid stream name`, as S1 says for an unsupported interval |

REST offers no book either, see [`rest.md`](./rest.md) section 5.
So every item of the template's book checklist has one answer.
There is no snapshot on subscribe, no delta, no sequence, no checksum, no level order and no size unit to compare with CCXT's `contractSize`.
The engine's feed contract, `resetBook`, `setBid`, `setAsk` and `publish`, has nothing to consume.

What the socket does carry is recorded here because it bears on the anchor.

### `kline@1s` is a running longer candle

Consecutive `kline@1s@btcusdt` frames kept the same `o`, `h` and `l` while `t` advanced by one second and `v` grew, for example `t` 1790137601 to 1790137604 all carried `"o":87127.3,"h":87150`.
The REST 1 m candle opened at 1790137560 read `[1790137560,87127.3,87150,87073.2,87073.6,72.37]` in the later `rest-probe.mjs catalog` run.
So the 1 s price stream is the running 1 m candle stamped with the current second, and only its `c` is a 1 s reading.
`markKline@1s` behaves as a true 1 s candle, whose `o` equals the previous frame's `c`.

### Whose prices these are

The last price and the mark are Bybit's.
At one read 20 s into each `streams` run, the latest ticker `p` equalled Bybit's `lastPrice` on 705 of 745 symbols in both runs, while Gate's `last` equalled it on 26 and 28 of 660.
The `ws-probe.mjs mark` comparison polled Bybit's ticker once a second for 40 s on BTC, ETH and SOL.
The `markKline@1s` close equalled a Bybit `markPrice` seen in the previous 10 s on 27 of 28, 23 of 26 and 13 of 13 frames, then on 28 of 30, 33 of 33 and 28 of 33 in the rerun, with median lags of 321 to 888 ms.
It equalled Bybit's `indexPrice` on 1 of those 163 frames.
The ticker `mp` trails further, with median lags of 1,011 to 4,004 ms, because a row is pushed only when the last price changes.
Details and the mapping are in [`rest.md`](./rest.md) section 4.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | any client message, a PING frame recommended every 20 s | protocol ping answered in 70 and 73 ms. JSON `PING` answered with an `unknown method` error. No server ping |
| silence the server tolerates | 40 s of client inactivity | an idle socket closed at 39,985 and 39,988 ms with 1006 and no close frame. A socket subscribed to `ticker@1s` that received 37 and 41 frames but sent nothing after its subscribe closed at 40,073 and 40,076 ms, also 1006. Server pushes do not count as activity. A protocol ping every 15 s kept a subscribed socket open for the full 65 s in both runs |
| forced disconnect | Not publicly specified | none in 65 s |
| maintenance notice | Not publicly specified | none |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in any of three runs |
| handshake | | 297 to 413 ms from this host |
| subscription limits | 15 per connection, ticker counts as one, 10 new connections per minute per IP | 16th subscription refused with 429 |
| throughput | | `ticker@1s` over 745 symbols: one push a second, a median of 62 and 64 rows per push |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Where an array is cut, the sentence above the frame says so.

Subscribe to the ticker over every candidate symbol, with the `assets` array cut to three of 1,204 names, and its acknowledgement.

```json
{"id": 2, "method": "SUBSCRIBE", "params": ["ticker@1s"], "assets": ["0gusdt", "1000000babydogeusdt", "btcusdt"]}
```

```json
{"method":"SUBSCRIBE","id":2,"result":"success"}
```

Ticker snapshot, the first push after the acknowledgement, cut to three of its 745 rows.

```json
{"stream":"ticker@1s","data":[{"s":"0gusdt","p":0.2503,"mp":0.2502},{"s":"1inchusdt","p":0.10484,"mp":0.10486},{"s":"2zusdt","p":0.0547,"mp":0.05475}]}
```

Mark kline and price kline, 1 s.

```json
{"stream":"markKline@1s@btcusdt","data":{"s":"btcusdt","t":1790137601,"o":87140.7,"h":87140.7,"l":87139.36,"c":87139.36}}
```

```json
{"stream":"kline@1s@btcusdt","data":{"s":"btcusdt","t":1790137602,"o":87127.3,"h":87150,"l":87117.9,"c":87136.4,"v":41.271}}
```

List of subscriptions, which keeps an unknown symbol and the uppercase spelling, with `ticker_1s_assets` cut to two of 1,204 names.

```json
{"method":"LIST_SUBSCRIPTIONS","id":25,"result":{"subscriptions":["kline@1m@btcusdt","kline@1s@ETHUSDT","kline@1s@btcusdt","kline@1s@nopeusdt","markKline@1m@btcusdt","markKline@1s@btcusdt","ticker@1s","ticker@5s"],"ticker_5s_assets":["nopeusdt"],"ticker_1s_assets":["0gusdt","1000000babydogeusdt"]}}
```

Keepalive: the JSON ping that CCXT Pro sends, answered as an error.

```json
{"method":"PING","id":24,"error":{"code":400,"msg":"unknown method"}}
```

Errors.

```json
{"method":"SUBSCRIBE","id":4,"error":{"code":400,"msg":"invalid stream name: depth@btcusdt"}}
```

```json
{"method":"SUBSCRIBE","id":19,"error":{"code":400,"msg":"invalid stream name: depth@solusdt"}}
```

```json
{"method":"UNSUBSCRIBE","id":22,"error":{"code":400,"msg":"not subscribed: kline@1s@xrpusdt"}}
```

```json
{"method":"","id":0,"error":{"code":400,"msg":"invalid JSON"}}
```

```json
{"id":16,"error":{"code":429,"msg":"subscription limit reached"}}
```

The frame with id 19 asked for `kline@1s@solusdt` and `depth@solusdt` together, and neither was subscribed.
The 429 line is the probe's summary of the reply, which carries the same `error` object.

## 7. Private channels

None are documented.
The trading API is REST only, under `https://trade.mudrex.com/fapi/v1` with an `X-Authentication` secret, S3.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| book feed | none can be built | no book channel on the socket, section 4, and no book over REST, [`rest.md`](./rest.md) section 5 |
| if marks alone were ever wanted | one socket, one `ticker@1s` subscription with every symbol lowercased in `assets` | the ticker is one subscription whatever the asset count, and it carries `mp` |
| mark at 1 s | `markKline@1s@<symbol>`, at most 15 per socket | the ticker `mp` lagged Bybit's mark by a median of 1 to 4 s, the 1 s mark kline by a median under 1 s |
| keepalive | a protocol ping every 15 s | server pushes do not reset the 40 s timer, and the JSON `PING` is an unknown method |
| `maxSilenceMs` | 45,000, counting pongs | the server closes at 40 s without a client frame, and a quiet mark can skip seconds |
| routing | `stream`, then `data.s` or each `data[i].s`, uppercased to match `market.id` | the socket reports lowercase symbols |
| resync | nothing to resync | no sequence exists |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

A Mudrex book feed would in any case duplicate Bybit, because its last and mark prices are Bybit's.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Mudrex API docs, WebSocket Streams, updated 2026-06-26 | https://docs.trade.mudrex.com/docs/websocket-streams | 2026-09-22 | RPFAS Technologies, India | URL, streams, frames, keepalive, limits, errors, sections 1 to 6 |
| S2 | Mudrex API docs, Market Data and Authentication and Rate Limits | https://docs.trade.mudrex.com/docs/market-data | 2026-09-22 | RPFAS Technologies, India | symbol and number conventions, connection limit, section 3 |
| S3 | Mudrex API docs, Overview | https://docs.trade.mudrex.com/docs/overview | 2026-09-22 | RPFAS Technologies, India | trading API is REST with `X-Authentication`, section 7 |
| S4 | CCXT Pro 4.5.68 `mudrex.js` and CCXT 4.5.68 `mudrex.js` | `server/node_modules/ccxt/js/src/pro/mudrex.js`, `server/node_modules/ccxt/js/src/mudrex.js` | 2026-09-22 | CCXT | URL, JSON ping every 20 s, `fetchOrderBook: false`, sections 1, 3, 4 |
| P1 | `ws-probe.mjs streams`, runs at 04:17 and 04:26 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/mudrex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | sections 1 to 6 |
| P2 | `ws-probe.mjs silence`, runs at 04:18 and 04:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/mudrex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | section 5 |
| P3 | `ws-probe.mjs deflate`, runs at 04:19, 04:25 and 04:30 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/mudrex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | compression, `/inverse` and `/spot`, sections 1 and 5 |
| P4 | `ws-probe.mjs mark`, runs at 04:20 and 04:29 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/mudrex/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit, plus Bybit's public ticker | Mudrex mark against Bybit, section 4 |
