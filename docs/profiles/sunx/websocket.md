# SunX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers SunX at `sunx.vip`, CoinMarketCap id 32686, see [`fees.md`](./fees.md) for why the namesake DEX at `sunx.io` is a different venue.
SunX publishes no WebSocket documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The protocol below is the one its own web bundle speaks, read from `app.86f4b977.js` on `sunx.vip`, S1.
It is the same white-label protocol as AIA Exchange's, see [`../aia/websocket.md`](../aia/websocket.md), and on SunX a socket does open from this host.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/sunx/ws-probe.py), P1, run three times.

## 1. Endpoints

The bundle builds its socket URL in this order, S1.

1. `wss://<host>/v1/np/ws` when a host is passed in.
2. `wss://<localStorage ws>/v1/np/ws` when a previous session stored a host.
3. The tenant config's `ws`.

Two configs in the bundle carry the SunX invitation image, P2 section 3.

| exId | config `ws` as written | config `oldws` |
|---|---|---|
| `FaJ6` | `wss://www.31976.me/v1/np/ws ` with a trailing space | `wss://ws.31976.me` |
| `Ch3Q` | `wss://www.sun3259.mev1/np/ws`, missing a slash | `wss://www.sun3259.me` |

| URL | result from this host, P1 sections 2 and 3 |
|---|---|
| `wss://www.31976.me/v1/np/ws` | opened in 264 to 349 ms through Cloudflare, and served every `FaJ6` channel |
| `wss://ws.31976.me` | no DNS record |
| `wss://www.sun3259.me/v1/np/ws` | opened in 220 to 335 ms, on the same address as `sunx.vip` |
| `wss://www.sun3259.me` | HTTP 200 instead of an upgrade |
| `wss://sunx.vip/v1/np/ws`, `wss://www.sunx.vip/v1/np/ws`, `wss://sunx.vip/v1/pusher/ws` | HTTP 403 "403 Forbidden" from a CDN page that names node `PS-SEA-04g2h113` and the client address |

A plain GET of `/v1/np/ws` without upgrade headers answered HTTP 400 `Bad Request` with `sec-websocket-version: 13` and an Envoy timing header on all three hosts, P1 section 1.
So the socket server sits behind each host, and on `sunx.vip` the CDN refuses the upgrade itself.
Whether that refusal is geographic is unknown, since no other exit was used.
One socket carries every product, because the bundle sends perpetual, spot and option channels on the same connection, S1.

## 2. Channel matrix for public market data

| data | channel for BTC | probed, P1 |
|---|---|---|
| perpetual book | `market_FaJ6.btcusdt_depth_step0` | received, a full book about once a second |
| perpetual trades | `market_FaJ6.btcusdt_trade_ticker` | received, 27 to 31 frames a minute |
| perpetual index | `market_btcusdt_index_price` | received, `{"ip":82653.30217391,"ts":1791606632003}`, 32 to 38 frames a minute |
| perpetual funding | `market_FaJ6.btcusdt_funding_rate` | received, `{"fr":0.00001841,"ts":1791606623771}`, 3 to 4 frames a minute |
| perpetual mark | channels containing `_mark_price`, routed by the bundle's handler | not subscribed |
| the `Ch3Q` channels | `market_Ch3Q.btcusdt_depth_step0` and the others | `"event_rep":"error"` on every one |
| spot book | `market_FaJ6.spot.btcusdt_depth_step0` | not subscribed |

Only one book depth, `step0`, appears in the bundle, S1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented, from the bundle S1 | probed, P1 |
|---|---|---|
| endpoint split axis | one URL for all products | one URL served book, trades, index and funding |
| subscribe frame shape | `{"event":"sub","params":{"channel":"...","cb_id":"10001001"}}` | accepted |
| unknown symbol expectation | not shown | `{"msg":"error","status":"error","event_rep":"error","channel":"market_FaJ6.nosuchusdt_depth_step0"}` |
| chunk unit and budget | not shown | eight channels in one burst were all answered |
| keepalive mechanism | server `{"ping": n}`, client `{"pong": n}` | `{"ping":"1791606637541"}` every 5 s, answered with `pong` |
| connection lifetime and maintenance notice | not shown | no close during 60 s |
| handshake and operation rate limits | not shown | none hit, and HTTP 403 on the `sunx.vip` origin |
| public market data authentication | none for market channels | none needed |
| message parse and routing | JSON with `channel`, `event_rep`, `data` or `tick` | the same |
| subscribe acknowledgement shape | not shown | `{"status":"ok","event_rep":"subed","cb_id":"","channel":"...","ts":...}` |
| symbol identifier format | lower case `btcusdt` after the exId | the same, matching the REST `symbol` |
| number representation | not shown | JSON numbers for book levels, strings for trade price and volume |
| timestamp representation | not shown | ms since the epoch, at the top and inside `tick` |
| size unit | not shown | lots, see section 4 |
| sequence semantics | not shown | `tick.sequence` rose by 42 to 85 between book frames, and every frame had a new value |
| idle repeat behaviour | not shown | a book frame every 200 to 1,679 ms, median 873 to 976 ms |

Every server frame is binary and zlib compressed inside the frame, and the bundle inflates it before `JSON.parse`, S1.
The probe inflated every frame with `zlib.decompress`, and no frame used permessage deflate, P1.

## 4. The book channel in detail

- Every book frame is a full book, not a delta.
  The first frame and every later one held 129 to 139 bids and 91 to 98 asks over three runs, P1 section 2.
- No `event` field marks a snapshot or an update, and the `tick` keys are `asks`, `bids`, `price`, `sequence`, `symbolName` and `ts`.
- Level order: bids descending and asks ascending in every frame checked.
- Sequence: `tick.sequence` grows by 42 to 85 per frame, and in one run it matched the trade channel's `seq-id` in the first frame, 23660092350.
  So it looks like a trade or match counter rather than a book version, and a gap rule is not needed for full books.
- Checksum: none.
- Size unit: the trade frame for 4106 at 82,613.7 carried `amount` 339,211,852.2, which is volume times price with no contract size.
  The catalog's `oneLotSize` for BTC is 0.001, see [`rest.md`](./rest.md) section 2, so 4106 is lots and the trade was about 4.1 BTC.
  Book sizes are read as lots too, which is an inference from the same field names.
- The book holds a level at every 0.1 USDT tick near the top, and the size of each top level printed changed from one frame to the next, P1 section 2.
  Best bid sat 4.0 to 4.8 bp below the socket index in the first frame of each run.
  CoinMarketCap excludes the price and volume of every SunX pair, see [`rest.md`](./rest.md) section 1.
- Unknown symbol: an error frame, see section 3.
- One-sided and empty books, closed symbols: Not verified.

## 5. Session

| item | value | source |
|---|---|---|
| keepalive | server `ping` every 5 s, client `pong` with the same value | P1 |
| client silence rule | the bundle closes and reconnects after four 5 s checks without a ping | S1 |
| compression | zlib inside each binary frame, no permessage deflate | P1 |
| handshake | open on `www.31976.me` and `www.sun3259.me`, HTTP 403 on `sunx.vip` | P1 |
| forced disconnect | none in 60 s | P1 |

## 6. Captured frames

Trimmed from P1, all inflated from binary frames.

```text
{"status":"ok","event_rep":"subed","cb_id":"","channel":"market_FaJ6.btcusdt_depth_step0","ts":1791606632749}
{"status":"ok","event_rep":"","cb_id":"","channel":"market_FaJ6.btcusdt_depth_step0","ts":1791606754159,"tick":{"bids":[[82611,1868],...],"asks":[[82611.1,5186],...],"price":82611,"sequence":23660092350,"symbolName":"btcusdt","ts":1791606754153}}
{"status":"ok","event_rep":"","cb_id":"","channel":"market_btcusdt_index_price","ts":1791606632078,"data":{"ip":82653.30217391,"ts":1791606632003}}
{"status":"ok","event_rep":"","cb_id":"","channel":"market_FaJ6.btcusdt_funding_rate","ts":1791606743778,"data":{"fr":0.00001832,"ts":1791606743771}}
{"ping":"1791606637541"}
{"msg":"error","status":"error","event_rep":"error","cb_id":"","channel":"market_FaJ6.nosuchusdt_depth_step0","ts":1791606632751}
```

## 7. Private channels

The bundle sends `{"event":"signin","params":{"token":...}}` and `{"event":"signout"}` on the same socket, S1.
Private channel names were not collected.

## 8. Recommended feed shape

None for the engine.
A feed could be written: one URL, `wss://www.31976.me/v1/np/ws`, one `sub` per channel, a `pong` to each `ping`, an inflate step per frame, and each book frame replacing the whole book.
It is not recommended, for these reasons.

- The site's own origin refuses the socket from this exit, and the host that works is an undocumented mirror on a numeric domain.
- The venue publishes no API documentation or terms for API use, and S7 of [`fees.md`](./fees.md) excludes Canadian residents.
- The book's sizes change on every level every frame, and CoinMarketCap excludes the venue's prices and volumes, so the book may not be executable as shown.

## Namesake

The SunX DEX at `sunx.io` documents `wss://api.sunx.io/ws/v1/market` with HTX style channels, N1.
A 15 s probe of `market.BTC-USDT.depth.size_20.high_freq` with `data_type` `incremental` gave one snapshot, then 92 to 99 updates whose `version` rose by exactly 1 each time, P1 section 4.
An unknown topic answered `{"status":"error","err-code":"bad-request","err-msg":"invalid topic ..."}`, and pings arrived as `{"ping":1791606822702}`.
It is not the surveyed venue.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | The live web bundle `https://sunx.vip/app.86f4b977.js`, 1,104,815 bytes, build 2026-10-09T08:41:38Z, project `sunx`: the socket module, the SunX tenant configs and the channel strings above | 2026-10-09 |
| N1 | SunX DEX documentation, `https://sunx.gitbook.io/sunx/developer/websocket-subscription/public-channel/subscribe-incremental-market-depth-data.md` | 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/sunx/ws-probe.py), run three times, about 80 s of socket time per run | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/sunx/rest-probe.py) section 3, which reads the tenant configs from the bundle | 2026-10-09 |
