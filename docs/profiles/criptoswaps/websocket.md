# CriptoSwaps WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:15 to 04:45 UTC on 2026-10-10, from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

This profile covers the public spot socket of CriptoSwaps, because the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
The socket is Openware's Ranger, the market data server of the OpenDAX stack the site runs.
CriptoSwaps publishes no socket documentation of its own, so the documented column below is Openware's Peatio WebSocket API, S1, and the Rango README, S2.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/criptoswaps/ws-probe.py), whose sections are A to C, run twice.
Its sockets were open for about 3.7 minutes per run.

## 1. Endpoints

| product | URL | probed |
|---|---|---|
| spot, public | `wss://www.criptoswaps.com/api/v2/ranger/public/` | HTTP 101 through Cloudflare on every open, no `Sec-WebSocket-Extensions` header, so no compression |
| spot, private | `wss://www.criptoswaps.com/api/v2/ranger/private/` | not probed, see section 7 |

The web bundle builds the URL as the origin plus `/api/v2/ranger` plus `/public` or `/private`, S3.
One socket carries every market.
There is no perpetual endpoint.
No open was refused from the Canadian exit.

## 2. Channel matrix

| stream | payload | probed |
|---|---|---|
| `<market>.ob-inc` | a full `<market>.ob-snap` snapshot on subscribe, then `<market>.ob-inc` increments | delivers on all 6 markets tried, section 4 |
| `<market>.ob-snap` | named as a stream by nobody | acked as subscribed and silent for 18 s, section B |
| `<market>.trades` | `{"trades":[{"amount","date","price","taker_type","tid"}]}` | one frame in run 1 and none in run 2, 75 s each, on BTC/USDT |
| `<market>.kline-<period>` | k-line points, periods `1m` to `1w`, S1 | not probed |
| `global.tickers` | a 24 hour ticker per market in one frame, S1 | one frame every 6.8 to 7.8 s |
| best bid and ask, mark, index, funding | none | Not offered: S1 lists no such stream, and spot has no mark, index or funding |

There is no separate best bid and ask stream.
The top of an `ob-inc` book is the best bid and ask.

## 3. The sixteen axes

The axes are those of [`../../research/2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | one public URL for all 103 spot markets |
| subscribe frame shape | streams as repeated `stream` query parameters on the URL, or `{"event":"subscribe","streams":[...]}` on an open socket, S1, S2 | both work. Seven streams in the URL got one ack naming all seven |
| unknown symbol expectation | not documented | `nosuchusdt.ob-inc` and `ADAUSDT.ob-inc` are acked as subscribed and send nothing |
| chunk unit and budget | Not publicly specified | seven streams in one URL and single-stream frames were all accepted, no larger batch was tried |
| keepalive mechanism | not documented | no server ping and no close over 120 s idle with client pings off. A protocol ping got a pong in 190 to 195 ms. A text `ping` gets a text `pong` |
| connection lifetime and maintenance notice | Not publicly specified | no notice seen and no forced close in about 3.7 minutes per run |
| handshake and operation rate limits | Not publicly specified | none met at three opens per run |
| public market data authentication | none for public streams, S1 | none |
| message parse and routing | one JSON object keyed by `<market>.<stream>`, S1 | the same: route on the single key, for example `btcusdt.ob-inc` |
| subscribe acknowledgement shape | `{"success":{"message":"subscribed","streams":[...]}}`, S1 | the same, and it lists every stream the socket now holds, not only the new ones. The snapshot and its replayed increments arrive before the ack |
| symbol identifier format | lowercase base plus quote, such as `ethusd`, S1 | `btcusdt`, equal to `id` in `GET /api/v2/peatio/public/markets` on all 103 markets, see [`rest.md`](./rest.md) section 2 |
| number representation | prices and amounts as strings, S1 | strings in snapshots and increments. A deleted level carries the empty string `""` as its amount |
| timestamp representation | not documented for the book | book frames carry no timestamp. Trades carry `date` in seconds, tickers `at` in seconds as a string |
| size unit | base asset amount | base asset amount, such as BTC on `btcusdt`, the same unit as the REST book |
| sequence semantics | S1 shows no sequence on branch 2-6-stable | every snapshot and increment carries an integer `sequence` per market, and each increment is the previous plus one. 0 gaps in 23 and 18 increments over two 75 s runs on 5 markets |
| idle repeat behaviour | not documented | no repeats. BTC/USDT sent 6 and 5 increments in 75 s, 3 of them replayed at the open in run 2, and 4 frames in the 120 s idle window of section C |

## 4. The book channel in detail

| item | value | evidence |
|---|---|---|
| snapshot on subscribe | yes, `<market>.ob-snap` with `asks`, `bids` and `sequence`, the whole book | BTC/USDT snapshots held 151 asks and 208 to 210 bids, and REST `depth?limit=1000` read in the same half hour held 150 to 152 asks and 208 to 210 bids, section A and [`rest.md`](./rest.md) section 5 |
| replayed increments | right after the snapshot the server sends the last 2 or 3 increments, numbered from the snapshot's sequence plus one | 3 on BTC, ETH, ZEC/BTC and QNT, 2 on DOGE, within 1 s of the open, section A run 2. Section C got snapshot 108582, then 108583 to 108585 |
| delta semantics | an increment carries `asks` or `bids` as one `[price, amount]` pair, which replaces that level. Amount `""` removes it | 41 increments over two runs, every one a single pair on one side, 15 of them deletes |
| documented delta shape | `asks` as a list of pairs, zero volume removes, S1 | the wire sends one bare pair, not a list, and `""` instead of zero |
| sequence and gap rule | per market, increment sequence equals the last sequence plus one | no gap seen, so the recovery rule is a design choice: resubscribe on any other step |
| checksum | none | no checksum field in any frame |
| level order | snapshot asks ascending, bids descending | 10 of 10 snapshots over two runs |
| reconciled against REST | the book built from snapshot plus increments matched the REST book read right after a 75 s window on the top 10 levels of all 5 markets, in both runs | section A |
| known divergence | DOGE/USDT REST held 35 asks against the socket book's 34 in both runs, and run 2 named the missing level, `0.1034` at `282.15` | section A. Its sequence had no gap, so the level was never sent on these sockets, neither in a snapshot nor as an increment |
| one-sided and empty books | not seen | the 5 markets probed all had both sides |
| unknown or closed symbol | acked and silent | `nosuchusdt.ob-inc`, section B |
| case | market ids are lowercase. `ADAUSDT.ob-inc` is acked and silent | section B |

The size unit is the base asset, and CriptoSwaps has no CCXT class to compare a `contractSize` with.

## 5. Session

| item | value | evidence |
|---|---|---|
| keepalive | none required in 120 s. A client may send a protocol ping or the text `ping` | section C, both runs |
| server silence | a BTC/USDT book sent 4 frames in 120 s, so gaps of 30 s and more are normal. `global.tickers` arrives every 6.8 to 7.8 s if subscribed | sections A and C |
| forced disconnects | none seen | sections A to C |
| maintenance | the site start script sends browsers to `/maintenance` when the config call answers 472, 503 or 513, S3 | that call answered 200 from the Canadian exit, [`rest.md`](./rest.md) section 1 |
| compression | none negotiated | handshake headers |
| errors | `{"error":"Could not parse Type: Invalid event"}` for an unknown event, `{"error":"Could not parse message: ..."}` for a frame that is not JSON. The socket stays open | section B |
| reconnect | the web config sets `rangerReconnectPeriod` to 1, S3 | not probed |

## 6. Captured frames

Subscribe acknowledgement, section A run 2, trimmed:

```json
{"success":{"message":"subscribed","streams":["btcusdt.ob-inc","ethusdt.ob-inc","zecbtc.ob-inc","qntusdt.ob-inc","dogeusdt.ob-inc","btcusdt.trades","global.tickers"]}}
```

Snapshot, trimmed to two levels a side:

```json
{"btcusdt.ob-snap":{"asks":[["82724.94","0.003674"],["82726.15","0.015326"]],"bids":[["82445.93","0.01925"],["82437.19","0.012464"]],"sequence":108579}}
```

Replayed increment that followed it at 0.0 s:

```json
{"btcusdt.ob-inc":{"asks":["82926.69","0.0167"],"sequence":108580}}
```

A set and a delete on one level, section B run 2:

```json
{"adausdt.ob-inc":{"bids":["0.2506","276.62"],"sequence":77493}}
```

```json
{"adausdt.ob-inc":{"bids":["0.2506",""],"sequence":77494}}
```

Unsubscribe acknowledgement, which lists what remains:

```json
{"success":{"message":"unsubscribed","streams":["nosuchusdt.ob-inc","adausdt.ob-snap"]}}
```

Errors:

```json
{"error":"Could not parse Type: Invalid event"}
```

A trade, section A run 1:

```json
{"btcusdt.trades":{"trades":[{"amount":"0.007982","date":1791606130,"price":"82685.25","taker_type":"buy","tid":106750421}]}}
```

The text `ping` answer is the bare text `pong`.

## 7. Private channels

The private Ranger URL is `wss://www.criptoswaps.com/api/v2/ranger/private/`, S3.
Peatio documents the private streams `order` and `trade`, with a JWT sent as `{"jwt":"Bearer <Token>"}`, S1.
The bundle also handles a `rangerUserOrderUpdate` event, S3.
None of this was probed.

## 8. Recommended feed shape

CriptoSwaps cannot join the engine as a perpetual leg, because it lists no perpetuals.
For a future spot leg the socket is simple and well behaved, and this is the shape it would take.

| item | value |
|---|---|
| URL plan | one socket to `wss://www.criptoswaps.com/api/v2/ranger/public/`, with every market's `<id>.ob-inc` as a `stream` query parameter, or sent as `{"event":"subscribe","streams":[...]}` after the open |
| markets per connection | all 103, untested above seven streams in one URL, so batch the subscribe frames |
| book state | take `ob-snap` as the book, then apply each `ob-inc` pair, removing a level whose amount is `""` |
| resync rule | any `ob-inc` whose `sequence` is not the last plus one, or any increment before a snapshot, triggers unsubscribe and resubscribe of that market |
| reconciliation | compare against `GET /api/v2/peatio/public/markets/<id>/depth` every few minutes, because of the DOGE/USDT divergence in section 4 |
| keepalive | a protocol ping every 30 s, which the server answers |
| `maxSilenceMs` | a per market silence limit does not fit, because a book can go well over 30 s without a frame. Liveness should come from `global.tickers` on the same socket, about every 7 s, with a 30,000 ms socket silence limit |

A spot leg would still be blocked by funding: BTC, ETH and USDT deposits are disabled, see [`fees.md`](./fees.md) section 1.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | Openware Peatio WebSocket API, branch 2-6-stable: `https://raw.githubusercontent.com/openware/peatio/2-6-stable/docs/api/websocket_api.md` | 2026-10-09 |
| S2 | Openware Rango README, "Subscribe to a stream list": `https://raw.githubusercontent.com/openware/rango/master/README.md` | 2026-10-09 |
| S3 | The web start script `https://www.criptoswaps.com/public/assets/config.js`, the config call `GET https://www.criptoswaps.com/api/v2/sonic/public/config` with `rangerReconnectPeriod`, `incrementalOrderBook` `"true"` and `finex` `"false"`, and the bundle `https://www.criptoswaps.com/public/assets/bundle.78aa1abaf20c890dfbec.js` with `rangerUrl` built as origin plus `/api/v2/ranger` | 2026-10-09 |
| S4 | [`ws-probe.py`](../../../scripts/probes/venues/criptoswaps/ws-probe.py), two runs | 2026-10-09 |
