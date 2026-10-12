# NEX Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:07 to 04:28 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public sockets behind the NEX Exchange web app, the futures socket for its USDT-M perpetuals in detail and the spot socket for context.
NEX publishes no WebSocket documentation, so the documented column below holds what the web bundle does, labelled as such, and the probed column holds what the wire did.
Every probed claim comes from [`ws-probe.py`](../../../scripts/probes/venues/nex/ws-probe.py), whose final version and its second pass rerun each held five sockets for about 127 s in total, after an earlier version and a short exploration held about 300 socket seconds.

## 1. Endpoints

| family | URL, from the bundle | probed |
|---|---|---|
| USDT-M perpetuals, all five | `wss://api.allinpro.com/futures/wsf` | upgraded in 0.67 to 0.77 s, `server: APISIX` |
| spot | `wss://ws.allinpro.com/ws` | upgraded in 0.68 to 1.00 s, `server: APISIX` |

Both URLs are constants in `https://n-exchange.io/assets/index-D4ICEk_G.js`, S1.
One futures socket carries all five perpetuals, since `update.state` delivers every market in each frame.
Neither socket asks for a token on public channels.
The web client sends a `login` frame only when a user is signed in.

## 2. Channel matrix for public market data

| channel | subscribe frame, from the bundle | futures socket, probed | spot socket, probed |
|---|---|---|---|
| book | `{"method":"subscribe.depth","params":{"market":"BTCUSDT","merge":"0"},"id":0}` on futures, and `{"method":"subscribe.depth","params":{"market":"BTC-USDT","merge":"step0"},"id":1}` on spot | acked with `"result":"success"`, then no frame in 30 to 40 s on BTCUSDT at merge `0` or ETHUSDT at merge `0.01` | acked, then a full book about every 0.2 s |
| trades | `subscribe.trade` with `market` | acked, no frame | acked, no frame in 30 s |
| ticker, mark, index, funding | `subscribe.state` on futures | `update.state` with all five markets in every frame, about one per second, median gap 0.92 to 0.94 s | |
| all tickers | `subscribe.all_quote` on spot | | `update.all_quote` with all 38 pairs, median gap 2.4 s |
| kline | `subscribe.kline` | not probed | not probed |
| best bid and ask | none | | |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column says what the web bundle sends or expects, because no documentation exists.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one futures URL and one spot URL, S1 | the futures socket carries all five perpetuals |
| subscribe frame shape | JSON-RPC style `{"method","params","id"}`, one market per frame, S2 and S3 | each frame acked on its own |
| unknown symbol expectation | not handled in the bundle | a depth subscription to `FOOUSDT` or `FOO-USDT` drops the whole socket with no close frame and no error, within about 0.3 s, on both sockets and in both runs |
| chunk unit and budget | not stated | not probed beyond five subscriptions per socket |
| keepalive mechanism | the client sends `{"method":"ping"}` every 10 s, `checkHeartbeat` in S1 | the futures socket closed with no close frame about 29 s after the client's last frame, 30.9 s after the connect began in both runs, while the server was still pushing `update.state`. The spot socket stayed open through 60 s of client silence in both runs and through 120 s in an earlier run |
| connection lifetime and maintenance notice | none in the bundle | none seen |
| handshake and operation rate limits | not stated | no refusal at five sockets at once |
| public market data authentication | none | none |
| message parse and routing | the client routes on `method`, then on `result.market` for futures and on `result.data.symbol` for spot | as the bundle says |
| subscribe acknowledgement shape | `{"id","method","result","error"}` | futures `{"id":0,"method":"subscribe.depth","result":"success","error":null}`. Spot adds `"timestamp"` and spells `"Success"` |
| symbol identifier format | `BTCUSDT` on futures and `BTC-USDT` on spot | identical to the REST market list and state call ids on futures, and to the spot ticker list on spot |
| number representation | strings | prices and sizes are strings on both sockets |
| timestamp representation | not stated | futures `server_time` and `next_funding_timestamp` in whole Unix seconds. Spot `timestamp` in seconds with up to seven decimals |
| size unit | base coin | futures not observable on an empty book. Spot `quantity` is base coin |
| sequence semantics | none | no sequence field on either socket. The spot frame's `tpp` stayed constant per topic, 13 on BTC-USDT and 14 on ETH-USDT, over 155 to 157 frames each, so it is not a sequence |
| idle repeat behaviour | not stated | the spot book is resent about five times a second even when unchanged: only 2 of 157 and 3 of 155 BTC-USDT pushes differed from the one before. The futures state is resent every second |

## 4. The book channel in detail

### Perpetuals

The futures depth channel acks a subscription and then sends nothing, on BTCUSDT and on ETHUSDT, at merge `0` and at merge `0.01`.
The REST depth call shows the same books with zero bids and zero asks, see [`rest.md`](./rest.md) section 5.
So snapshot behaviour, delta semantics, level order and the size unit of the perpetual book channel could not be observed.
The bundle's handler in `index-CdSPOuAy.js`, S2, keys the frame on `result.market` and `result.merge`, and replaces both sides with `result.asks` and `result.bids` as `[price, quantity]` pairs on every frame.
It reads no sequence and no checksum, so the channel is written by the web app as a full book per push.

### Spot, for context

| item | probed |
|---|---|
| snapshot on subscribe | yes, the first `update.depth` followed the ack within 0.01 s, in the same batch of frames |
| delta semantics | none. Every push is the whole aggregated book, 11 bids and 5 asks on BTC-USDT, the same levels the REST depth call returns |
| cadence | a median of 0.195 to 0.204 s, pushed whether or not the book changed |
| level order | asks ascending, bids descending, as objects `{"price","quantity"}` |
| sequence and checksum | none |
| routing key | `result.data.topic`, spelled `depth:step0:BTC-USDT`, and `result.data.symbol` |

## 5. Session

| item | probed |
|---|---|
| keepalive | `{"method":"ping","params":{},"id":0}` on futures and `{"method":"ping"}` on spot. Both answer `{"id":0,"method":"ping","result":"success","error":null}`, and spot adds `timestamp` |
| silence tolerated | futures about 29 s of client silence before a drop with no close frame. Spot at least 60 s in both runs, and 120 s in an earlier run |
| forced disconnects | an unknown market in any depth subscription drops the socket at once |
| maintenance notices | none seen |
| compression | a `permessage-deflate` offer was not negotiated on either socket, and every frame was text JSON |
| handshake and subscription limits | not published, and none reached |

## 6. Captured frames

Futures subscription ack and ping answer:

```json
{"id": 0, "method": "subscribe.depth", "result": "success", "error": null}
{"id": 0, "method": "ping", "result": "success", "error": null}
```

Futures `update.state`, one of five markets, with `prices` removed:

```json
{"id": 0, "method": "update.state", "result": {"BTCUSDT": {"market": "BTCUSDT", "amount": "0.00", "high": "79180.30", "last": "79180.30", "low": "79180.30", "open": "79180.30", "period": 86400, "volume": "0", "change": "0", "funding_time": 222, "position_amount": "0.0308", "funding_rate_last": "-0.00375", "funding_rate_next": "-0.00375", "funding_rate_predict": "-0.00375", "insurance": "166166.98784476", "sign_price": "76656.89", "index_price": "82691.20", "sell_total": "0.6146", "buy_total": "1.1123", "orgin_sign_price": "76656.89324500", "next_funding_timestamp": 1791619200, "server_time": 1791605836}}}
```

Spot `update.depth`, trimmed to two levels per side:

```json
{"id": 1, "method": "update.depth", "result": {"data": {"asks": [{"price": "82746.68", "quantity": "0.48126"}, {"price": "82870.71", "quantity": "0.60158"}], "bids": [{"price": "82581.30", "quantity": "0.45495"}, {"price": "82457.27", "quantity": "0.56869"}], "symbol": "BTC-USDT", "timestamp": 1791605836.2861485, "topic": "depth:step0:BTC-USDT", "tpp": 13}, "merge": "step0"}, "error": null, "timestamp": 1791605836.2861795}
```

An unknown market produced no error frame to capture, because the server drops the socket instead.

## 7. Private channels

The bundle subscribes `subscribe.position`, `subscribe.order` and `subscribe.asset` on the futures socket, and `subscribe.asset`, `subscribe.orders` and `subscribe.change` on the spot socket, after a `login` frame carrying the session token.
They were not probed.

## 8. Recommended feed shape

No feed is recommended, because every perpetual book is empty and the futures depth channel sends nothing.
If the perpetuals trade again, the shape the web app implies is one socket to `wss://api.allinpro.com/futures/wsf` for all five markets, one `subscribe.depth` frame per market at merge `0`, a `{"method":"ping"}` every 10 s, and a full book replace on each `update.depth`.
`maxSilenceMs` would need to come from a live book, since the channel's cadence could not be measured.
A feed must never subscribe to a market that is not in the current market list, because one unknown market drops every subscription on that socket.
All of this rests on undocumented web app frames.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://n-exchange.io/assets/index-D4ICEk_G.js`, the socket URLs, the client class with `checkHeartbeat` every 10 s and the `onMessage` router | 2026-10-09 |
| S2 | `https://n-exchange.io/assets/index-CdSPOuAy.js`, the futures book and trade subscriptions | 2026-10-09 |
| S3 | `https://n-exchange.io/assets/index-daDCG0yP.js`, the spot book and trade subscriptions | 2026-10-09 |
| S4 | `https://n-exchange.io/assets/use-futures-data-B4H8DHFW.js`, `subscribe.state`, `subscribe.position` and `subscribe.order` | 2026-10-09 |
