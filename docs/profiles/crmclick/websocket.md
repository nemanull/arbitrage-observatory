# CRMClick WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 04:19 to 04:31 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

This profile covers the public sockets behind CRMClick's USDT-margined perpetuals, see [`fees.md`](./fees.md) section 1.
CRMClick publishes no socket documentation.
Every URL and method below was found in the web app bundle at `crmclick.io`, source S5 of [`fees.md`](./fees.md) section 10.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/crmclick/ws-probe.py), whose parts are lettered A to F, and its frames were captured to `.claude/survey-work/crmclick/ws-capture.jsonl`.

The finding: CRMClick runs no perpetual socket.
Its perpetual page opens HTX's own swap sockets in the browser, and its one socket of its own carries only the 10 spot markets it matches in house.

## 1. Endpoints

| URL | who runs it | what the web app uses it for | evidence |
|---|---|---|---|
| `wss://api.hbdm.com/linear-swap-ws` | HTX | perpetual book (`market.<code>.depth.step<n>`), trades, ticker and klines, gzip frames | S5, part F |
| `wss://api.hbdm.com/ws_index` | HTX | perpetual mark price and index klines (`market.<code>.mark_price.*`, `market.<code>.index.*`) | S5 |
| `wss://api-aws.huobi.pro/ws` | HTX | book, trades and ticker of the 439 HTX-routed spot markets | S5 |
| `wss://ws.okx.com:8443/ws/v5/public` and `/business` | OKX | a second relay client in the bundle, with `okxMarketList` and an `okxBalance` call, and no OKX row in either catalog on 2026-10-10 | S5, [`rest.md`](./rest.md) section 2 |
| `wss://wss2.crmclick.io` | CRMClick, behind Cloudflare | book, trades, klines and tickers of the 10 markets with `"platform":"match"` | S5, parts A to E |

The bundle's socket client picks its decoder by URL: frames from a host containing `huobi`, `hbdm` or `htx` are gunzipped, and all others are parsed as plain JSON text, S5.
So no CRMClick host carries a perpetual book, and the engine would be reading HTX through a second hand.

## 2. Channel matrix for public market data

| channel | perpetuals | evidence |
|---|---|---|
| book, any depth | none of CRMClick's own. The web app subscribes HTX's `market.<code>.depth.step<n>` on HTX's host. | S5, part F |
| best bid and ask | none | S5 |
| trades | none of CRMClick's own, HTX's `trade.detail` | S5 |
| ticker | none of CRMClick's own, HTX's `ticker` and `overview` | S5 |
| mark, index | none of CRMClick's own, HTX's `ws_index` topics | S5 |
| funding | none. The trade page reads funding over REST from a login-only call, see [`rest.md`](./rest.md) section 3. | S5 |

`wss2.crmclick.io` speaks the JSON-RPC style protocol with `server.ping`, `server.time`, `depth.subscribe`, `deals.subscribe`, `today.subscribe` and `kline.subscribe`, S5.
A `depth.subscribe` there for `BTCUSDT`, `BTC-USDT` or `btcusdt` was acknowledged with `{"status":"success"}` and then sent no frame in 15 s each, part C.
So it carries no perpetual and no HTX-routed market.

## 3. The sixteen axes

The axes of [`../../research/2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The perpetual column has no CRMClick value, because CRMClick has no perpetual socket.
The probed column describes `wss2.crmclick.io` on its matched spot market ARCBUSDT, the only book CRMClick streams itself.

| axis | perpetuals | `wss2.crmclick.io`, probed |
|---|---|---|
| transport framing | none, HTX's socket | uncompressed JSON text frames, parts A and B |
| endpoint per family | none | one host for the 10 matched spot markets |
| subscribe frame | none | `{"id":4,"method":"depth.subscribe","params":["ARCBUSDT",30,"0.00000001"]}`, market, level limit and merge step, as the web app sends it, part B |
| subscribe acknowledgement | none | `{"error":null,"result":{"status":"success"},"id":4}` within 0.11 s, part B |
| snapshot on subscribe | none | yes, the first `depth.update` has `params[0]` true and came 0.1 s after subscribing with 30 asks and 17 to 20 bids, part B. A second full frame arrived unprompted 17.5 s later in the second pass. |
| delta semantics | none | `params[0]` false carries only changed levels, a size of `"0"` removes the level, and `params[0]` true replaces the whole book, part B |
| sequence and gap rule | none | no sequence, no update id and no timestamp in any frame, part B |
| checksum | none | none |
| level order | none | asks ascending from the best ask, then bids, as `[price, size]` string pairs, part B |
| size unit | none | base asset, the REST book prints the same sizes, see [`rest.md`](./rest.md) section 5 |
| symbol spelling | none | `ARCBUSDT`, the catalog's `market` field without a slash |
| keepalive | none | client sends `server.ping` and gets `{"result":"pong"}`, the web app does it every 12 s, parts A and B |
| silence tolerated | none | 40 s with no pings and no subscription did not close the socket, and a ping after it got `pong`, part E |
| compression | none | the permessage-deflate offer was not accepted, no `Sec-WebSocket-Extensions` header came back, connect |
| limits | none | none published |
| errors | none | `depth.subscribe` on `NOSUCHUSDT` was acknowledged as success, and an unknown method got no reply in 4 s, part D |

## 4. The book channel in detail

There is no CRMClick perpetual book channel.
The perpetual book a user sees is HTX's `market.BTC-USDT.depth.step0`, which part F opened on HTX's host: it acknowledged with `"subbed":"market.BTC-USDT.depth.step0"`, sent 150 levels per side with `mrid` and `version` fields, and pushed 78 ticks in 8 s.
That channel's semantics belong to HTX and are recorded in [`../htx/websocket.md`](../htx/websocket.md).

On `wss2.crmclick.io` the matched spot book sent its snapshot and then two deltas in 45 s, at 31.5 s and 32.0 s in the first pass and at 43.0 s and 43.5 s in the second, part B.
The second pass also got a full frame at 17.5 s, so a consumer must treat `params[0]` true as a replacement at any time.
ARCBUSDT is the most active of the 10 matched markets by the catalog's 24 hour volume, and eight of them show zero volume, see [`rest.md`](./rest.md) section 2.
With no sequence, a missed delta cannot be detected, and the only resync is a fresh subscribe or the `depth.query` call, which returned a five level book in part D.

## 5. Session

| item | value | evidence |
|---|---|---|
| handshake | 0.25 to 0.31 s to open through Cloudflare, edge YVR | connect line of the three runs |
| keepalive | `server.ping`, answered `pong`, no server-initiated ping seen | parts A, B, E |
| server time | `server.time` returned 1791606519 in the second pass, Unix seconds | part A |
| idle close | none within 40 s of silence | part E |
| forced disconnects, maintenance notices | none seen in about 2.5 minutes | parts A to E |
| compression | none | connect line |

## 6. Captured frames

Subscribe acknowledgement, part B:

```json
{"error": null, "result": {"status": "success"}, "id": 4}
```

Snapshot, part B, trimmed to two levels a side:

```json
{"method": "depth.update", "params": [true, {"asks": [["10.1093533", "1.94"], ["10.20639719", "8.31"]], "bids": [["9.94632249", "2.22"], ["9.80349018", "2.38"]]}, "ARCBUSDT"], "id": null}
```

Delta that removes a level, part B:

```json
{"method": "depth.update", "params": [false, {"bids": [["10.08799546", "0"]]}, "ARCBUSDT"], "id": null}
```

Keepalive answer, part B:

```json
{"error": null, "result": "pong", "id": 900}
```

Subscribe to an unknown market, part D, acknowledged like a real one:

```json
{"error": null, "result": {"status": "success"}, "id": 70}
```

## 7. Private channels

None found on a CRMClick host.
Orders, positions and balances go over REST calls such as `futuresOrder/openFuturesOrders`, `futuresOrder/huobiOrder` and `futuresAccount/okxBalance`, all login-only, S5.
Their names suggest the venue places user orders on HTX and OKX, and that was not tested.

## 8. Recommended feed shape

None.
CRMClick cannot join the engine as a perpetual leg in its current shape.
It has no perpetual socket, its REST perpetual book is HTX's book, and its funding call needs a login.
A leg built on it would be HTX seen a second time, and HTX already has its own profile in [`../htx/`](../htx/).

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S5 | `https://crmclick.io/assets/index.b5aeda38.js`, the web app entry bundle | every socket URL, the `wss2.crmclick.io` methods, the decoder rule, the HTX and OKX topics |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/crmclick/ws-probe.py) parts A to E | `wss2.crmclick.io` behaviour |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/crmclick/ws-probe.py) part F | HTX's swap book channel, the one the perpetual page shows |
