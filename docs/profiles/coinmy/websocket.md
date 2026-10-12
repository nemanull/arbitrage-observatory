# CoinMy WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:36 to 05:00 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada (Cloudflare trace `loc=CA`, `colo=YVR`).
About three and a half minutes of socket time were used in each of the two probe runs, and about nine minutes in all with the first exploratory sessions.

This profile covers the public sockets of CoinMy, which has no CCXT class, for its USDT margined perpetuals.
The futures book channel carried no frame for any of the 53 contracts, so section 4 records the same protocol's spot book, the only live book on the venue, to show the shape a feed would meet.
Every measured number comes from [`ws-probe.py`](../../../scripts/probes/venues/coinmy/ws-probe.py), named by mode below.
Source ids are shared with [`fees.md`](./fees.md) and [`rest.md`](./rest.md).

## 1. Endpoints

| family | URL | source | probed |
|---|---|---|---|
| USDT perpetuals | `wss://api.cmgatewayapi.com/futures/ws` | `wsUrl` in the futures web list, P1 `catalog` | opened in 556 to 633 ms in both runs, no refusal |
| USDT perpetuals, web app | `wss://ws.coinmy.com/futures` | hard coded in the web bundle, which adds `?compress=1`, S7 | opened in 525 to 626 ms and served the same ticker frames |
| spot | `wss://api.cmgatewayapi.com/spot/ws` | `wsUrl` in the spot web list, P1 `catalog` | opened in 530 to 590 ms, no refusal |
| spot, web app | `wss://ws.coinmy.com/spot` | hard coded in the web bundle, S7 | not probed |
| documented | `wss://wspool.hiotc.pro/kline-api/ws` | S2, a generic ChainUp page whose URL belongs to no CoinMy host | not probed |

One socket carries only one product, and every perpetual is in the one USDT family.

## 2. Channel matrix

| channel | subscribe `params.channel` | probed |
|---|---|---|
| depth | `market_e_<sub>_depth_<step>`, where `<sub>` is `e_btcusdt` and `<step>` is a price step from the contract's `depthList`, from the web bundle's channel builder S7 | no frame on any of the 53 contracts at the finest step in 40 s in both runs, nor at `step0`, `0`, `1` or `10` on BTC or at `step0` or `2` on ETH in the second run, P2 `futures` |
| ticker | `market_e_<sub>` | about one frame a second on BTC, and frames on 31 of 53 contracts in 40 s in both runs. It carries `close`, `vol`, `sign_price` (mark), `index_price`, `funding_rate_last` and `funding_rate_next`, P2 `futures` |
| trades | `market_e_<sub>_deals` | no frame on any contract, and `market_e_btcusdt_trade_ticker` and `market_e_btcusdt_ticker` were silent too, P2 `futures` |
| candles | `market_e_<sub>_kline_<period>`, and `_mark_kline_` for the mark, S7 | `req` on `market_e_btcusdt_kline_1day` returns up to 301 daily bars, P2 `history` |
| spot depth | `market_<symbol>_depth_<step>`, where `<symbol>` is `btcusdt` and `<step>` is from the pair's `depth` list | 30 levels a side, about five pushes a second on BTC, P2 `spot` |
| spot ticker | `market_<symbol>` | about one frame a second on BTC, P2 `spot` |

The documented `market_$symbol_depth_step0`, `market_$symbol_trade_ticker` and `market_$symbol_ticker` of S2 were silent on the spot socket, P2 `spot`.
No best bid and ask channel, no dedicated mark, index or funding channel and no all market channel was found.
The web app uses the ticker as its only source of mark, index and funding, and it reads `last_fund_rate_third` instead of `funding_rate_last` when `admin_fund_rate_source` is `"third"`, S7.

## 3. Protocol axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The probed column is the futures socket unless it names the spot socket.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S2 | one futures URL and one spot URL |
| subscribe frame shape | `{"event":"sub","params":{"channel":…,"cb_id":"1"}}`, S2 | the same, one channel per frame. 159 frames in the first run and 168 in the second, each sent in one burst, were accepted with no error |
| unknown symbol expectation | Not publicly specified | silent, with no error frame, for `market_nosuchusdt_depth_0.01` on the spot socket and `market_e_nosuchusdt_depth_0.1` on the futures socket |
| chunk unit and budget | Not publicly specified | 168 subscriptions on one futures socket, no cap reached |
| keepalive mechanism | the server sends `{"ping":n}` and the client answers `{"pong":n}`, S2 | the server sends `{"ts":"…","ping":<unix s>}` as text every 10 s. The web app also sends `{"ping":<ms>}` every 5 s, S7 |
| connection lifetime and maintenance notice | Not publicly specified | none seen in 75 s |
| handshake and operation rate limits | Not publicly specified | none reached |
| public market data authentication | none, S2 | none |
| message parse and routing | `{channel, ts, tick}`, S2 | `{"eventResp":"sub","channel","tick","ts"}` on the first frame of a stream and `{channel, tick, ts}` after it. A `req` reply carries `"eventResp":"req"` with a list in `tick` |
| subscribe acknowledgement shape | not documented | no separate acknowledgement. The first data frame carries `"eventResp":"sub"`, and a silent channel gets nothing |
| symbol identifier format | `btcusdt`, S2 | `e_` plus the lower case base and quote, the web list's `subSymbol` on 53 of 53. The catalog spells it `E-BTC-USDT` and the ticker's `tick.symbol` spells it `E_BTCUSDT` |
| number representation | numbers in the S2 examples | strings, such as `"sign_price":"78007.4948918546621699"` |
| timestamp representation | ms in the S2 examples | the outer `ts` is an ISO string, `"2026-10-10T04:46:10Z"`, and `tick.timestamp` is in seconds |
| size unit | Not publicly specified | on the spot socket, base currency, such as `0.16953` BTC. Futures sizes could not be seen |
| sequence semantics | none documented | none: no update id in any frame |
| idle repeat behaviour | not documented | on the spot socket, no depth frame repeated the previous one, 0 of 411 and 0 of 421 in the two runs |

## 4. The book channel in detail

### The perpetual book is empty

All 53 futures depth streams and all 53 trade streams stayed silent for 40 s in both runs, while 31 ticker streams sent frames, P2 `futures`.
Every ticker frame showed `vol` "0", and `close` stood far from `index_price`, such as 80343.6 against 82677.8 on BTC.
The mark sat a median of 105,511 ppm from the index across the 31 contracts in the first run and 104,245 ppm in the second, and within 1,000 ppm on 8 of them in both, P2 `futures`.
The daily candles say when trading stopped.
BTC has 258 days with volume out of 301 from 2025-12-13, and its last day with volume was 2026-08-27, P2 `history`.
ETH's last day with volume was 2026-08-29, P2 `history`.
So the perpetual market is listed and its index still moves, but it has no orders and no trades.

### The spot book, for the protocol shape

| item | value | source |
|---|---|---|
| snapshot on subscribe | yes. The first frame carries `"eventResp":"sub"` and a whole book, 168 to 172 ms after the subscribe on BTC, ETH and SOL in the two runs | P2 `spot` |
| delta semantics | none. Every frame is the whole window, 30 levels a side, 24 to 30 on BTC | P2 `spot` |
| sequence and gap rule | no sequence, so no gap can be detected and none needs to be | P2 `spot` |
| checksum | none | P2 `spot` |
| level shape | `[price, size, cumulative size]`, all strings | P2 `spot` |
| side keys | `asks` and `bids`. The documentation S2 says `buys`, and the wire never sent it | P2 `spot` |
| level order | asks ascending and bids descending in 411 of 411 and 421 of 421 frames, none crossed | P2 `spot` |
| cadence | median 0.20 s between frames on BTC and ETH in both runs. SOL had gaps up to 5.2 s | P2 `spot` |
| size unit | base currency | P2 `spot` |
| empty book | the CM/USDT stream at its finest step sent no frame in 45 s | P2 `spot` |
| wrong step | `market_btcusdt_depth_0.5` and `market_btcusdt_depth_step0` were silent | P2 `spot` |

If the perpetuals traded again, the futures book channel would likely take the same shape, since the web app builds the futures and spot channel names in one function, S7.
That is an inference and was not probed.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | the server pings and the client answers, S2 | the server sends `{"ts":…,"ping":<unix s>}` every 10 s, first at 3.0 to 5.8 s after open. The client answers `{"pong":<same number>}`, P2 `silence` |
| silence tolerated, subscribed | Not publicly specified | a subscribed socket that never answered closed at 66.8 s and 64.0 s in the two runs, 11 s after its sixth unanswered ping. One that answered stayed open for the full 75 s, P2 `silence` |
| silence tolerated, unsubscribed | Not publicly specified | closed at 26.8 s and 24.0 s, 11 s after its second ping, P2 `silence` |
| close code | Not publicly specified | the server dropped the socket without a close frame |
| compression | "binary compressed except the heartbeat data", gzip, S2 | plain text frames by default. With `?compress=1` every frame, the pings included, is a binary zlib stream ended by a sync flush, P2 `compress` |
| permessage-deflate | Not publicly specified | not negotiated, no `Sec-WebSocket-Extensions` header came back |
| subscription limits | Not publicly specified | 168 on one socket, no cap reached |

## 6. Captured frames

The futures ticker, the only futures frame that arrives, trimmed, from P2 `futures`.

```json
{"eventResp":"sub","channel":"market_e_btcusdt","tick":{"symbol":"E_BTCUSDT","open":"80343.6","close":"80343.6","amount":"0","vol":"0","high":"80343.6","low":"80343.6","timestamp":1791607570,"utime":"2026-10-10T04:46:10Z","base":"BTC","quote":"USDT","sign_price":"78007.4948918546621699","index_price":"82678.146","funding_rate_last":"-0.0000358508539389","funding_rate_next":"-0.0000358508539389"},"ts":"2026-10-10T04:46:10Z"}
```

A spot book snapshot on subscribe, trimmed to three levels a side by the probe, from the second run of P2 `spot`.

```json
{"eventResp":"sub","channel":"market_btcusdt_depth_0.01","tick":{"asks":[["82716.10","0.17552","0.17552"],["82716.11","0.17773","0.35325"],["82716.12","0.23186","0.58511"]],"bids":[["82715.95","0.18646","0.18646"],["82715.92","0.21236","0.39882"],["82706.84","0.22657","0.62539"]],"ts":"2026-10-10T04:55:36Z"},"ts":"2026-10-10T04:55:36Z"}
```

A daily candle reply to `req`, trimmed to one bar, from P2 `history`.

```json
{"eventResp":"req","channel":"market_e_btcusdt_kline_1day","tick":[{"id":1765584000,"ts":"2025-12-13T00:00:00Z","open":"90229.6","close":"90196.9","high":"90597.4","low":"89776.9","vol":"38806562","amount":"631333766379.9545","symbol":"E_BTCUSDT"}]}
```

The server ping and the answer that keeps the socket open.

```json
{"ts":"2026-10-10T04:37:34Z","ping":1791607054}
```

```json
{"pong":1791607054}
```

## 7. Private channels

The web app sends `login` and `logout` events on the same socket, S7.
The documentation S2 lists no private channel.

## 8. Recommended feed shape

No feed is recommended, because the perpetual book channel carries nothing.
If the perpetuals trade again, the feed would be a profile in the engine's ChainUp family adapter, shaped like the Aivora profile at [`chainup.rs`](../../../server/src/venues/chainup.rs) lines 81 to 99.

| item | value | reason |
|---|---|---|
| URL | `wss://api.cmgatewayapi.com/futures/ws`, without `compress` | the web list names it, and text frames need no decoding |
| channel | `market_e_<sub>_depth_<depthList[0]>`, from the futures web list | the spot shape, where a wrong step is silent |
| subscribe frames | one `{"event":"sub","params":{"channel":…,"cb_id":"1"}}` per market, in one burst | one channel per frame |
| keepalive | answer each server `{"ping":n}` with `{"pong":n}` | the server drops a subscribed socket after six unanswered pings |
| `maxSilenceMs` | 25,000 | the 10 s server ping is traffic, so 25 s is two missed pings |
| routing | the text between `market_` and `_depth_` gives `<sub>`, and a map from `subSymbol` to `contractName` gives the `rawMarketId` | the socket and the catalog spell the contract differently |
| resync | none on sequence. Each frame replaces the book | whole window frames |
| deflate | keep it refused | the server does not negotiate it |

## 9. Source ledger

| id | source | URL | retrieved | entity | used for |
|---|---|---|---|---|---|
| S2 | ChainUp white label open API documentation, page "Websocket" | https://exchangeopenapi.gitbook.io/pri-openapi/openapi-doc/websocket | 2026-10-09 | generic, linked from CoinMarketCap as CoinMy's API | sections 1 to 5 |
| S7 | CoinMy web bundle: the socket URLs, the `compress` switch and the event names in chunk 9794, the channel name builder in chunk 335, the ticker field mapping in chunk 9551 | https://www.coinmy.com/_next/static/chunks/9794-b9177d30deaaff7d.js | 2026-10-09 | CoinMy | sections 1, 2, 4, 5 and 7 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/coinmy/rest-probe.py) mode `catalog` | [`rest-probe.py`](../../../scripts/probes/venues/coinmy/rest-probe.py) | 2026-10-10 UTC | this host, Canadian exit | `wsUrl`, `subSymbol`, `depthList` |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/coinmy/ws-probe.py) modes `futures`, `history`, `spot`, `silence` and `compress`, first run 04:46 to 04:50 UTC and second run 04:54 to 04:58 UTC | [`ws-probe.py`](../../../scripts/probes/venues/coinmy/ws-probe.py) | 2026-10-10 UTC | this host, Canadian exit | sections 1 to 6 |
