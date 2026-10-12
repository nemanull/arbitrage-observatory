# FreiExchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:01 to 05:15 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

FreiExchange lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
The venue documents no WebSocket.
Its market pages open an undocumented socket that pushes trade notices and "order book changed" notices, never price levels, and the page then reloads the book over HTTP.
So FreiExchange has no book channel.
Probed values come from [`ws-probe.py`](../../../scripts/probes/venues/freiexchange/ws-probe.py) unless a source id says otherwise.

## 1. Endpoints

| item | value | evidence |
|---|---|---|
| documented socket | none, the API page names only `GET /public/ticker` and `GET /public/orderbook` and has no "websocket" word | S1, [`rest.md`](./rest.md) section 1 |
| BTC quoted pairs | `wss://freiexchange.com/wss2/`, opened by the script of `https://freiexchange.com/market/LTC/BTC` | S2 |
| LTC quoted pairs | `wss://freixlite.com/wss2/`, opened by the script of `https://freixlite.com/market/MAZA/LTC` on the sister site FreiXLite | S3 |
| families per socket | one socket per site, so the BTC and LTC quoted pairs need two sockets | S2, S3 |
| access from this host | both upgraded with HTTP 101 through Cloudflare, edge `YVR`, with and without a browser `Origin` header | `ws-probe.py connect`, `ws-probe.py listen` |

## 2. Channel matrix for public market data

| channel | present | evidence |
|---|---|---|
| order book levels, any depth | no | the page script handles only the two categories below, S2 |
| order book change notice | yes, `category` `orderbook`, payload not captured | S2, no such frame arrived in 390 s of listening, see section 4 |
| best bid and ask | no | S2 |
| trades with ticker fields | yes, `category` `updates`, one per trade | S2, one frame captured |
| ticker on its own | no, the ticker fields ride on the trade notice | S2 |
| mark, index, funding | no, spot only | [`fees.md`](./fees.md) section 3 |

The page script's comment on an `orderbook` frame says the order book changed and that only orders and balances are reloaded, and it calls `GET /market/getsellarray/LTC/BTC` and `GET /market/getbuyarray/LTC/BTC`, S2.
It reacts to an `updates` frame by writing the ticker fields into the page and reloading trades and the book the same way, S2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none documented, the page script uses one socket per site, S2 and S3 | `freiexchange.com/wss2/` for BTC quoted pairs and `freixlite.com/wss2/` for LTC quoted pairs |
| subscribe frame shape | none documented, the page script sends `{"action":"subscribe","pair":"LTC_BTC"}`, S2 | as the page script, several pairs on one socket were accepted without complaint |
| unknown symbol expectation | Not publicly specified | `NOPE_BTC` drew no reply and the socket stayed open |
| chunk unit and budget | Not publicly specified | one pair per frame, five pairs on one socket and four on the other, no refusal |
| keepalive mechanism | Not publicly specified, the page script sends no ping | a protocol ping got a pong in 159 to 164 ms in three runs, and the socket stayed open through 240 s with client pings off |
| connection lifetime and maintenance notice | Not publicly specified | no close and no notice within 240 s |
| handshake and operation rate limits | Not publicly specified | every open and every subscribe was accepted |
| public market data authentication | none in the page script, S2 | none needed |
| message parse and routing | the page script routes by `category`, S2 | as the page script, with `pair` naming the market |
| subscribe acknowledgement shape | Not publicly specified | none, a subscribe draws no reply |
| symbol identifier format | `COIN_BASE` in upper case, S2 and S3 | `LTC_BTC`, with `coin` and `basecoin` also in the frame |
| number representation | Not publicly specified | decimal strings with 8 decimal places for prices and volume |
| timestamp representation | Not publicly specified | `when` in Unix seconds, `1791608764` for a frame received at 05:06:05.068 UTC |
| size unit | Not publicly specified | no size field on the wire, the trade notice carries price and 24 hour volume only |
| sequence semantics | none documented | none on the wire |
| idle repeat behaviour | Not publicly specified | none, one frame in 240 s on nine pairs, and none in 150 s on two pairs in the first run |

## 4. The book channel in detail

There is no book channel, so most of this section records what is absent.

### Snapshot on subscribe

None.
No frame arrived within 5 s of opening either socket, and a subscribe drew no reply, `ws-probe.py connect` and `ws-probe.py listen`.

### Delta semantics

None.
An `orderbook` frame is a change notice that makes the page refetch the whole book over HTTP, S2.
No such frame arrived in 390 s of listening on freiexchange.com, 150 s on LTC_BTC and DOGE_BTC in the first run and 240 s on five BTC pairs in the second, so its payload is not known.
That matches the REST poll, which saw the LTC_BTC top of book unchanged across 13 polls over 40 s, [`rest.md`](./rest.md) section 4.

### Sequence and gap rule

None.
No frame carries a sequence number, and a missed notice cannot be detected.

### Checksum

None.

### Level order on the wire

Not applicable, the socket carries no levels.
The REST book is the only source of levels, see [`rest.md`](./rest.md) section 5.

### Size unit

Not applicable on the socket.
The REST book carries `amount` in units of the coin, see [`rest.md`](./rest.md) section 5.

### One-sided and empty books

Not applicable on the socket.

### Idle repeats

None seen.
The two sockets together sent one frame in 240 s, and the first run's socket sent none in 150 s.

### Unknown, closed and wrong-level symbols

`{"action":"subscribe","pair":"NOPE_BTC"}`, the bare text `hello`, `{"action":"orderbook","pair":"LTC_BTC"}`, `{"action":"unsubscribe","pair":"LTC_BTC"}` and `{"action":"ping"}` each drew no reply within 4 s, and the socket stayed open after all five, `ws-probe.py errors`.
So a feed cannot tell a mistyped pair from a quiet one.

### Data quality of the trade notice

The captured `updates` frame for LTC_BTC carried `high` `0.00077160` and `low` `0.00078999`, so its high was below its low.
The field `prosent` holds the 24 hour percent change, as the page script reads it, S2.

## 5. Session

| item | value | evidence |
|---|---|---|
| keepalive | none needed in 240 s, a protocol ping is answered | `ws-probe.py listen`, `ws-probe.py errors` |
| silence the server tolerates | at least 240 s of client silence with client pings off | `ws-probe.py listen` |
| forced disconnects | none seen in 240 s | `ws-probe.py listen` |
| maintenance notices | none seen | `ws-probe.py listen` |
| compression | Not publicly specified, the handshake reply named no `Sec-WebSocket-Extensions` | `ws-probe.py connect` |
| handshake time | 677 to 792 ms from this host over two runs | `ws-probe.py connect` |
| the page's reconnect rule | reconnect after 1 s, doubling to at most 30 s | S2 |

Whether the server sends protocol pings was not recorded, because the client library answers them without surfacing them.

## 6. Captured frames

Subscribe, as the page script sends it, S2.
No acknowledgement followed.

```json
{"action":"subscribe","pair":"LTC_BTC"}
```

The one `updates` frame of the second run, received at 05:06:05.068 UTC on 2026-10-10, 241 bytes.
`type` `BUY` is the taker side, and `price` is the trade price.

```json
{"category":"updates","when":1791608764,"coin":"LTC","basecoin":"BTC","pair":"LTC_BTC","price":"0.00078999","type":"BUY","prosent":"-0.09","volume":"0.00790010","low":"0.00078999","high":"0.00077160","volume_coin":"9.97","last":"0.00078999"}
```

No `orderbook` frame, keepalive frame or error frame was ever sent by the server.

## 7. Private channels

None found.
The socket carries no authentication step in the page script, and the page refreshes the user's orders and balances over HTTP after each notice, S2.
The API page has no private section, S1.

## 8. Recommended feed shape

No feed is recommended.
FreiExchange has no perpetuals, and its socket carries no levels, no sequence and no acknowledgement.
A spot feed could only use an `orderbook` notice as a trigger to refetch `GET /public/orderbook/{COIN}`, and that call is limited to 30 requests per 60 s per IP, see [`rest.md`](./rest.md) section 6.
A notice that is lost cannot be detected, so such a feed would also need a periodic REST refetch, and at the published limit that covers very few pairs.
The engine's feed shape, a book channel with a snapshot and deltas as in [`../gate/websocket.md`](../gate/websocket.md), does not fit.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.freiexchange.com/`, the page "FreiExchange / FreiXLite Api Documentation" | two public calls, no socket, no private section |
| S2 | `https://freiexchange.com/market/LTC/BTC`, the page script near "WebSocket connection (native)" | the socket URL, the subscribe frame, the `updates` and `orderbook` categories, the HTTP refetch and the reconnect rule |
| S3 | `https://freixlite.com/market/MAZA/LTC`, the same script on the sister site | `wss://freixlite.com/wss2/` and the pair `MAZA_LTC` |
