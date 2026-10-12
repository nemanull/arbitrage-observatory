# Ulink WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
Ulink publishes no WebSocket documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The protocol below is the one its own web bundle speaks, read from `app.e941a78f.js` on `ulinkex.com`, S1.
It is the same white-label protocol as SunX's, see [`../sunx/websocket.md`](../sunx/websocket.md), with Ulink's own tenant config.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/ulink/ws-probe.py), P1, run twice for about 75 s of socket time each.

## 1. Endpoints

The bundle builds its socket URL in this order, S1.

1. `wss://<host>/v1/np/ws` when a host is passed in, which only the Tauri desktop app does, through `plugin:tinytrader-view|get_socket_base_url`.
2. `wss://<localStorage ws>/v1/np/ws` when a previous session stored a host.
3. The tenant config's `ws`.

After a socket opens, the bundle stores its host in `localStorage` under `ws`, so step 2 repeats whatever host step 3 gave, S1.

The bundle's default config is module 696, brand Ulink, exId `Pu8g`, because module 7 imports it and exports it as `default`, P2 section 3.
Three more configs carry the Ulink brand with exId `GjFt`, and none of them is the default.

| URL | role | result from this host, P1 |
|---|---|---|
| `wss://www.yyy23hjkk.com/v1/np/ws` | config `ws` of module 696 | opened in 241 to 303 ms and served every channel below |
| `wss://www.yyy23hjkk.com/pusher/ws` | config `oldws` | HTTP 200 with an empty body instead of an upgrade |
| `wss://ulinkex.com/v1/np/ws`, `wss://www.ulinkex.com/v1/np/ws`, `wss://ulinkex.com/v1/pusher/ws` | the page's own origin | HTTP 403 "403 Forbidden" from a CDN page that names node `PS-SEA-04g2h113` and the client address |

`www.yyy23hjkk.com` resolves to the same CDN address as `ulinkex.com`, `174.35.100.116`, and serves the same page, see [`rest.md`](./rest.md) section 1.
A plain GET of `/v1/np/ws` without upgrade headers answered HTTP 400 `Bad Request` with `sec-websocket-version: 13` and an Envoy timing header on both hosts, P1 section 1.
So the socket server sits behind both names, and on `ulinkex.com` the CDN refuses the upgrade itself.
Whether that refusal is geographic is unknown, since no other exit was used.
One socket carries every product, because perpetual, spot and option channels were all served on the same connection, P1 section 2.

## 2. Channel matrix for public market data

| data | channel for BTC | probed, P1 section 2 |
|---|---|---|
| perpetual book, 0.1 USDT levels | `market_Pu8g.btcusdt_depth_level0` | acknowledged as `market_saas.btcusdt_depth_level0`, 63 to 68 frames a minute |
| perpetual book, 1 and 10 USDT levels | `market_Pu8g.btcusdt_depth_level1`, `_depth_level2` | the same, 64 to 69 frames a minute each |
| full perpetual book | `market_Pu8g.btcusdt_depth_step0`, the option module's channel name | the same, 64 to 69 frames a minute |
| perpetual trades | `market_Pu8g.btcusdt_trade_ticker` | acknowledged as `market_sas8.btcusdt_trade_ticker`, 21 to 26 frames a minute |
| perpetual index | `market_btcusdt_index_price` | `{"ip":82669.34369565,"ts":1791608786003}`, 32 frames a minute |
| perpetual mark | `market_btcusdt_mark_price` | `{"mp":82629.2952971,"ts":1791608785}`, 11 frames a minute, with `ts` in seconds |
| perpetual funding | `market_Pu8g.btcusdt_funding_rate` | `{"fr":-0.00002022,"ts":1791608783772}`, 3 frames a minute |
| spot book | `market_Pu8g.spot.btcusdt_depth_level0` | acknowledged as `market_saas.spot.btcusdt_depth_level0`, 72 to 79 frames a minute |
| the `GjFt` channels | `market_GjFt.btcusdt_depth_level0` | `"event_rep":"error"` |

The level index picks an entry of the catalog's `orderBookLevel`, which is `[0.1, 1, 10]` for BTC, see [`rest.md`](./rest.md) section 2.
The bundle subscribes `_depth_level<n>` for the perpetual book, S1.
The server answers the `Pu8g` book channels under the name `saas` and the trade channel under `sas8`, so a feed must route by the acknowledged name, not the requested one.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented, from the bundle S1 | probed, P1 |
|---|---|---|
| endpoint split axis | one URL for all products | one URL served perpetual, spot, index, mark and funding |
| subscribe frame shape | `{"event":"sub","params":{"channel":"...","cb_id":"10001001"}}` | accepted |
| unknown symbol expectation | not shown | `{"msg":"error","status":"error","event_rep":"error","cb_id":"","channel":"market_saas.nosuchusdt_depth_level0",...}` |
| chunk unit and budget | not shown | eleven channels in one burst were all answered |
| keepalive mechanism | server `{"ping": n}`, client `{"pong": n}` | `{"ping":"1791608790354"}` every 5 s, 12 in 60 s, answered with `pong` |
| connection lifetime and maintenance notice | not shown | no close during 60 s |
| handshake and operation rate limits | not shown | none hit, and HTTP 403 on the `ulinkex.com` origin |
| public market data authentication | none for market channels | none needed |
| message parse and routing | JSON with `channel`, `event_rep`, `data` or `tick` | the same |
| subscribe acknowledgement shape | not shown | `{"status":"ok","event_rep":"subed","cb_id":"","channel":"market_saas.btcusdt_depth_level0","ts":...}` |
| symbol identifier format | lower case `btcusdt` after the exId | the same, matching the REST `symbol` |
| number representation | not shown | JSON numbers for book levels, strings for trade price and volume |
| timestamp representation | not shown | ms since the epoch, except the mark channel's `ts` in seconds |
| size unit | not shown | lots on the perpetual book, base units on the spot book, see section 4 |
| sequence semantics | not shown | `tick.sequence` rose by 42 to 86 between perpetual book frames, the same value on all four perpetual book channels |
| idle repeat behaviour | not shown | a perpetual book frame every 180 to 1,658 ms, median 1,008 ms |

Every server frame is binary and zlib compressed inside the frame, and no frame used permessage deflate, P1.
The probe inflated every frame with `zlib.decompress`.

## 4. The book channel in detail

- Every book frame is a full book, not a delta.
  The `_depth_level<n>` channels hold 22 bids and 22 asks in every frame, and `_depth_step0` holds 619 to 627 bids and 383 to 393 asks, P1 section 2.
- No `event` field marks a snapshot or an update, and the `tick` keys are `asks`, `bids`, `sequence`, `symbolName` and `ts`, plus `price` on `_depth_step0`.
- Level order: bids descending and asks ascending in every frame checked.
- Sequence: `tick.sequence` grows by 42 to 86 per frame and carries the same value on all four perpetual book channels at the same instant.
  It looks like a match counter rather than a book version, and a gap rule is not needed for full books.
- Checksum: none.
- Size unit: the trade frame for `vol` 22 at 82,629 carried `amount` 1,817,838, which is volume times price with no contract size.
  The catalog's `oneLotSize` for BTC is 0.001, see [`rest.md`](./rest.md) section 2, so 22 is lots and the trade was 0.022 BTC.
  Perpetual book sizes are read as lots too, which is an inference from the same field names.
  Spot book sizes are fractions such as 0.00004 and 0.92718, so they are BTC.
- Every one of the top ten bid sizes changed between consecutive perpetual frames at an unchanged price, median share 1.00 in both runs, P1 section 2.
  Best bid sat 4.06 to 4.88 bp below the socket index in the first frame of each run, while the catalog mark sat within 0.5 bp of OKX's BTC mark, see [`rest.md`](./rest.md) section 3.
  CoinMarketCap excludes the price and volume of every Ulink pair, see [`fees.md`](./fees.md) section 3.
- Unknown symbol: an error frame, see section 3.
- One-sided and empty books, closed symbols: Not verified.

## 5. Session

| item | value | source |
|---|---|---|
| keepalive | server `ping` every 5 s, client `pong` with the same value | P1 |
| client silence rule | the bundle closes and reconnects after four 5 s checks without a ping | S1 |
| compression | zlib inside each binary frame, no permessage deflate | P1 |
| handshake | open on `www.yyy23hjkk.com`, HTTP 403 on `ulinkex.com` and `www.ulinkex.com` | P1 |
| forced disconnect | none in 60 s | P1 |

## 6. Captured frames

Trimmed from P1, all inflated from binary frames.

```text
{"status":"ok","event_rep":"subed","cb_id":"","channel":"market_saas.btcusdt_depth_level0","ts":1791608786344}
{"status":"ok","event_rep":"","cb_id":"","channel":"market_saas.btcusdt_depth_level0","ts":1791608787519,"tick":{"bids":[[82629,4104],[82628.9,2788],...],"asks":[[82629.1,5931],...],"sequence":24166830421,"symbolName":"btcusdt","ts":1791608787513}}
{"status":"ok","event_rep":"","cb_id":"","channel":"market_btcusdt_mark_price","ts":1791608785929,"data":{"mp":82629.2952971,"ts":1791608785}}
{"status":"ok","event_rep":"","cb_id":"","channel":"market_Pu8g.btcusdt_funding_rate","ts":1791608783836,"data":{"fr":-0.00002022,"ts":1791608783772}}
{"status":"ok","event_rep":"","cb_id":"","channel":"market_sas8.btcusdt_trade_ticker","ts":1791608785491,"tick":{"mrid":24166830253,"ts":1791608785491,"data":[{"order-id":-3,"seq-id":24166830253,"side":"SELL","price":"82629","vol":"22","amount":"1817838"}]}}
{"ping":"1791608790354"}
{"msg":"error","status":"error","event_rep":"error","cb_id":"","channel":"market_GjFt.btcusdt_depth_level0","ts":1791608786347}
```

## 7. Private channels

The bundle sends `{"event":"signin","params":{"token":...}}` and `{"event":"signout"}` on the same socket, S1.
Private channel names were not collected.

## 8. Recommended feed shape

None for the engine.
A feed could be written: one URL, `wss://www.yyy23hjkk.com/v1/np/ws`, one `sub` per `_depth_level0` channel, a `pong` to each `ping`, an inflate step per frame, and each book frame replacing the whole book.
It is not recommended, for these reasons.

- The site's own origin refuses the socket from this exit, and the host that works is an undocumented config host on an unrelated domain.
- The venue publishes no API documentation, its Service Agreement forbids bots and page scraping, and it excludes US and Canadian residents from contract trading, see [`fees.md`](./fees.md) section 1.
- Every top level size changes on every frame, and CoinMarketCap excludes the venue's prices and volumes, so the book may not be executable as shown.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | The live web bundle `https://ulinkex.com/app.e941a78f.js`, 1,091,923 bytes, build 2026-08-04T09:20:38Z, project `ulian`: the socket module, the Ulink tenant configs and the channel strings above | 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/ulink/ws-probe.py), run twice, about 75 s of socket time per run | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/ulink/rest-probe.py) section 3, which reads the tenant configs from the bundle | 2026-10-09 |
