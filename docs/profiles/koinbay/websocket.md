# Koinbay WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public futures WebSocket of Koinbay (no CCXT class) for its perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/koinbay/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The protocol is the kline-api socket shared by several white-label exchange platforms: gzip frames, `market_<symbol>_depth_step0` channels and a JSON ping.
Access results are from the Canadian VPN exit.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| all futures, USDT-M and the inverse `E-BTC-USD` | `wss://futuresws.koinbay.com/kline-api/ws` (S1, S2) | open in 730 to 781 ms on the four opens that logged a time, six opens in all, no refusal |
| spot | `wss://ws.koinbay.com/kline-api/ws` (S1) | not probed |

One socket carries every futures contract, and the symbol in the channel name selects the contract.
Both hosts resolve to the same AWS load balancer in `ap-northeast-1` (Tokyo), see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | probed on 2026-09-22 |
|---|---|---|
| `market_<symbol>_depth_step0` | full 30 level book per side, `asks` and `buys` | 2.3 to 3.4 frames a second on three contracts, recommended |
| `market_<symbol>_depth_step1` | the same book aggregated to a coarser price step (1 USD on BTC) | 2.96 frames a second on BTC, same cadence as step0 |
| `market_<symbol>_ticker` | 24 h `vol`, `rose`, `open`, `low`, `high`, `close`, `amount`, no bid or ask (S2) | 1.98 frames a second on BTC |
| `mark_price_<symbol>` | `tagPrice`, `indexPrice`, `currentFundRate`, `nextFundRate`, `nextSettlementTime`, `symbol`, all strings (S2) | 0.96 to 1 frame a second, and pushed unasked for every symbol whose depth is subscribed |
| `market_<symbol>_trade_ticker` | trades (S2) | not probed |
| `market_<symbol>_kline_<interval>` | klines (S2) | not probed |

No best bid and ask channel exists.
`mark_price_e_solusdt` delivered 43 frames on a socket that subscribed only `market_e_solusdt_depth_step0`, and in the batch run 93 depth channels brought 93 `mark_price_` channels with them.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for spot, one for futures (S1) | the futures URL carried USDT-M contracts, the inverse was not subscribed |
| subscribe frame shape | `{"event": "sub", "params": {"channel": "...", "cb_id": "1"}}`, one channel per frame (S2) | one channel per frame, 127 frames in one burst all delivered where the book moved |
| unknown symbol expectation | Not publicly specified | `market_e_nopeusdt_depth_step0` and the upper case `market_E-BTC-USDT_depth_step0` got no frame at all in 45 s |
| chunk unit and budget | Not publicly specified | 127 subscribe frames on one socket, no refusal and no close in 30 s |
| keepalive mechanism | "Server sends ping; client must reply pong or be disconnected", `{"ping": 1535975085052}` answered by `{"pong": 1535975085052}` (S2) | server ping `{"ping":1790232459}` in seconds, every 10 s, as a gzip binary frame. No protocol ping |
| connection lifetime and maintenance notice | Not publicly specified | a socket that never answered 7 pings stayed open for the whole 70 s test |
| handshake and operation rate limits | Not publicly specified | six opens in the session, no refusal |
| public market data authentication | none | none |
| message parse and routing | `channel` names the stream (S2) | envelope `{event_rep, channel, data, tick, ts, status, timezone}`, route by `channel` |
| subscribe acknowledgement shape | Not publicly specified | no acknowledgement frame for any `sub`, and none for a `req` or for a text frame `not json` |
| symbol identifier format | `{type}_{pair}` lowercase, `E-BTC-USDT` becomes `e_btcusdt` (S2) | confirmed, REST names differ from socket names |
| number representation | depth levels `[price, volume]` as numbers, `mark_price` values as strings (S2) | confirmed, sizes are integers |
| timestamp representation | Not publicly specified | envelope `ts` in ms rounded to the whole second, `1790232455000`. Ping value in seconds |
| size unit | Not publicly specified | contracts, the same integers as REST `/fapi/v1/depth`, one contract is `multiplier` coins from the catalog |
| sequence semantics | none documented | none on the wire, every frame is a whole book |
| idle repeat behaviour | Not publicly specified | a moving book repeats identical frames (56 of 133 on BTC, 93 of 103 on SSV), a static book sends nothing: 34 of 127 contracts were silent for 30 s |

## 4. The book channel in detail

`market_<symbol>_depth_step0` is the channel this profile recommends.

### Snapshot on subscribe

The first frame arrives within about 740 ms of the subscribe, and it is a whole 30 level book.
Every later frame is also a whole book, so there is no delta stream.

### Delta semantics

None.
Each `tick` replaces the book, so a feed calls `resetBook` and writes both sides on every frame.

### Sequence and gap rule

No sequence field exists, so no gap can be detected and no resync on gap is needed.
The envelope `ts` has whole second resolution, so it cannot order two frames within one second.

### Checksum

None.

### Level order on the wire

`asks` ascending and `buys` descending on every frame of three contracts over 45 s, probe tag `channel_stats` field `orderOk`.
Bids are named `buys` on the socket and `bids` on REST (S2).

### Level window

30 levels per side on every frame, in both step0 and step1.
The engine wants 20, so 30 covers it.

### Size unit against CCXT `contractSize`

There is no CCXT market, so the unit comes from the catalog.
Sizes are integer contracts, and one contract is `multiplier` units of `multiplierCoin`, for example 0.0001 BTC on `E-BTC-USDT` and 0.1 SOL on `E-SOL-USDT` (probe `book` in [`rest.md`](./rest.md) section 5).
The socket and REST top ask were both 84067.1 at the end of the book run, with sizes that differ because the reads were not simultaneous.

### One-sided and empty books

`E-BSV-USDT` is listed active with a REST book of no asks and one bid `[0.01, 100000]`, and its socket channel sent nothing in 30 s.
A one-sided or empty book must be dropped by the adapter.

### Idle repeats

A moving book pushes about three frames a second, and many are byte identical to the previous one.
A static book sends nothing, so a per symbol silence cannot tell a quiet book from a lost subscription.
34 of the 127 active USDT-M contracts sent no frame in 30 s, and 35 of 130 active contracts had no trade for more than seven days by `ticker_all`, see [`rest.md`](./rest.md) section 2.

### Unknown, closed and wrong-level symbols

No error is ever returned.
An unknown symbol and a REST-style name are silently ignored.

## 5. Session

- Keepalive: the server sends `{"ping": <seconds>}` about every 10 s, 7 pings in 70 s, gzip compressed like every other frame.
  The docs say ping and pong are text frames (S2), but the probe received the ping as a binary frame.
  The client answers `{"pong": <same value>}` as a text frame, as documented.
- Silence tolerated: a subscribed socket that never answered stayed open for the full 70 s, so the documented disconnect was not seen within that window.
- Forced disconnects and maintenance notices: none seen and none documented.
- Compression: every data frame is binary gzip inside the WebSocket frame (S2, and every frame in the probe).
  A request for permessage-deflate negotiated nothing, probe `deflate` printed `"negotiated":""`.
  So the socket needs no deflate, but every frame needs a gunzip before it can be parsed.
- Handshake and subscription limits: none documented and none hit.

## 6. Captured frames

The subscribe frame sent, as in S2:

```json
{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "E-BTC-USDT"}}
```

No acknowledgement arrives.
The first depth frame, gunzipped and cut to three levels per side:

```json
{"event_rep": "", "channel": "market_e_btcusdt_depth_step0", "data": null, "tick": {"asks": [[84067.1, 43647], [84067.4, 975], [84067.8, 53728]], "buys": [[84064.8, 37726], [84064.1, 14390], [84063.4, 1111]]}, "ts": 1790232455000, "status": "ok", "timezone": ""}
```

The mark and funding frame, pushed unasked for a depth subscription on SOL and on request for BTC:

```json
{"event_rep": "", "channel": "mark_price_e_btcusdt", "data": null, "tick": {"tagPrice": "84065.9", "indexPrice": "84105.06999999999533110", "currentFundRate": "0.0000370333333333", "nextFundRate": "0.000073", "nextSettlementTime": "1790236800000", "symbol": "e_btcusdt"}, "ts": 1790232455000, "status": "ok", "timezone": ""}
```

The keepalive, received as a gzip binary frame:

```json
{"ping": 1790232459}
```

An error frame: none exists, see section 4.

## 7. Private channels

The docs publish no private WebSocket channel (S2).
Order and position state is REST only, under `/fapi/v1/` with `X-CH-APIKEY`, `X-CH-TS` and `X-CH-SIGN` headers (S1).

## 8. Recommended feed shape

- URL plan: one URL, `wss://futuresws.koinbay.com/kline-api/ws`, for every USDT-M contract.
- Markets per connection: all 127 active USDT-M contracts fit on one socket in the probe.
- Subscribe frames: one `sub` frame per contract for `market_<socket name>_depth_step0`, where the socket name is the catalog `symbol` lower cased with the first dash turned into `_` and the others removed.
  The socket name differs from the REST name, so the adapter keeps a map between the two, and `rawMarketId` must be one of them consistently.
- Decoding: gunzip every frame, then parse JSON.
  The engine refuses permessage-deflate, which is fine here, but the in-frame gzip must be flagged as a change to the generic feed.
- Keepalive: answer every `{"ping": n}` with `{"pong": n}`.
- `maxSilenceMs`: 30 s at the socket level, since pings arrive every 10 s.
  No per symbol silence rule, because static books send nothing.
- Resync rule: none needed, since every frame is a whole book.
  On a socket close, reopen and resubscribe.
- Anchor: the `mark_price_` frames that ride along with each depth subscription carry index, mark, both funding fields and the next settlement at about one frame a second, see [`rest.md`](./rest.md) section 8.
- Drop contracts whose book is one-sided or whose last trade is older than a day.

## 9. Source ledger

- S1: API overview, https://docs.koinbay.com/api/overview.md, table "Live hosts" and section "Authentication & signing".
- S2: WebSocket (market streams), https://docs.koinbay.com/api/websocket-market-streams.md.
- S3: [`ws-probe.mjs`](../../../scripts/probes/venues/koinbay/ws-probe.mjs), modes `book` (45 s), `batch` (30 s, run twice), `silence` (70 s) and `deflate`, run 2026-09-22.
- The probes loaded `ws` from `server/node_modules`, which existed during the runs.
  During the second pass `server/` had been replaced by the Rust crate and `server/node_modules` was gone, so the socket probe cannot be rerun until `ws` is installed again.
- S4: [`rest-probe.mjs`](../../../scripts/probes/venues/koinbay/rest-probe.mjs), for the REST book compare and the catalog.
