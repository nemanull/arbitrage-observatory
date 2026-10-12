# TRIV WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:25 to 03:41 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

TRIV publishes no WebSocket documentation.
Everything here comes from the scripts of its logged-out futures page, S1, and from [`ws-probe.py`](../../../scripts/probes/venues/triv/ws-probe.py).
The perpetual feed is not TRIV's own socket but that of the CFX crypto bourse, and it refuses every public channel to a client that has not authenticated.

## 1. Endpoints

| family | URL | source |
|---|---|---|
| USDT-margined perpetuals | `wss://ws-exchange.cfx.co.id`, a Centrifuge server behind Cloudflare | `gon.ws_endpoint` on the futures page, S1 |
| spot, TRIV's own ActionCable socket | `wss://ws.triv.co.id/cable?key=...`, used for the stock market page | `gon.ws_url`, S1 |
| spot, crypto pairs | upstream venues' sockets, such as `wss://stream-cloud.binanceru.net/ws/btcusdt@depth` for BTC_IDR | `/markets/BTC_IDR/settings`, [`rest.md`](./rest.md) section 2 |

One CFX socket would carry every perpetual, since channel names carry the symbol.
That was not observed, because no channel could be joined.

## 2. Channel matrix for public market data

| channel | content per the page's handler | probed |
|---|---|---|
| `orderbook.<symbol>` | `{symbol, bids, asks, action}`, levels as `[price, size]` | `{"code":101,"message":"unauthorized"}` |
| `ticker.<symbol>` | `mark_price`, `last_price`, `funding_rate`, `prev_price_24h` | `{"code":101,"message":"unauthorized"}` |
| `trade.<symbol>` | trade history rows | `{"code":101,"message":"unauthorized"}` |
| `tickers` | `{tickers: [...]}` with `symbol`, `last_price`, `prev_price_24h` for every perpetual | `{"code":101,"message":"unauthorized"}` |
| best bid and ask only | none named in the scripts | |
| index | none. The page writes `last_price` into the element labelled `index-price`. | |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
TRIV documents nothing, so the documented column is Not publicly specified on every row and is left out.

| axis | probed |
|---|---|
| endpoint split axis | one URL for all perpetuals, from the page |
| subscribe frame shape | Centrifuge JSON protocol, `{"id": 2, "subscribe": {"channel": "orderbook.BTCUSDT-PERP"}}` after `{"id": 1, "connect": {...}}` |
| unknown symbol expectation | `orderbook.NOPEUSDT-PERP` drew the same code 101 "unauthorized" as a real symbol |
| chunk unit and budget | not reached |
| keepalive mechanism | The connect reply says `"ping":25,"pong":true`. The server sends `{}` every 25 s and the client must answer `{}`. |
| connection lifetime and maintenance notice | A socket that answered two pings and then stopped was closed 10.2 s after the unanswered ping with code 3012, reason "no pong", in both runs. No maintenance frame was seen. |
| handshake and operation rate limits | not reached, one socket at a time |
| public market data authentication | required. Every subscribe answered code 101 "unauthorized", with and without an Origin header, immediately after connect and again 3 s later. |
| message parse and routing | Centrifuge replies keyed by `id`, publications carry `res.data.data` per the page |
| subscribe acknowledgement shape | only the error shape was seen, `{"id":2,"error":{"code":101,"message":"unauthorized"}}` |
| symbol identifier format | `BTCUSDT-PERP`, the same string as the page's catalog |
| number representation | strings in the REST trade rows, [`rest.md`](./rest.md) section 5. The socket's was not seen. |
| timestamp representation | not seen |
| size unit | not seen. The page renders sizes as base coin amounts with `basePrecision` decimals. |
| sequence semantics | none in the page's handler, which keys levels by price only |
| idle repeat behaviour | not seen |

## 4. The book channel in detail

No book frame was received, so every subsection below is read from the page's handler, S1, and none is probed.

### Snapshot on subscribe

The page first loads `/futures/<symbol>/settings`, whose `orderbooks` was empty for BTC, ETH and SOL in every run, and then applies socket frames.
Whether the socket sends a snapshot on subscribe is unknown.

### Delta semantics

The handler upserts each `[price, size]` level, deletes a level whose size is 0, and keeps 20 levels a side for display and 50 for the depth chart.
It also drops bids at or above, and asks at or below, the last trade price.

### Sequence and gap rule

None.
The handler reads no sequence, version or timestamp field.

### Checksum

None in the handler.

### Level order on the wire

Unknown.
The handler sorts by price descending itself.

### Size unit

Base coin, by the page's formatting with `basePrecision`, such as 4 for BTC.

### Display noise

Before rendering, the page multiplies each level's size by a random factor, `random=(Math.random()<0.5?-0.2:1.0)/100.0`, so a displayed size is the wire size plus 1% or minus 0.2%.
A reading of the rendered page is therefore not the book.

### One-sided, empty, unknown and closed symbols

An unknown symbol is refused like a real one, code 101.
The settings call redirects an unknown symbol with 302 to the BTCUSDT-PERP page, [`rest.md`](./rest.md) section 6.

## 5. Session

| item | probed |
|---|---|
| handshake | The upgrade at `wss://ws-exchange.cfx.co.id` succeeded with and without an Origin header. A plain HTTPS GET answered 400 "Bad Request". |
| connect reply | `{"id":1,"connect":{"client":"<uuid>","ping":25,"pong":true}}` in about 0.18 s |
| server ping | `{}` at 25 s spacing. The first came between 0.4 s and 23.9 s after connect over four sockets in two runs. |
| silence tolerated | The close came 10.2 s after the first unanswered ping in both runs, code 3012 "no pong". |
| compression | none negotiated, text JSON frames |
| RPC | `{"rpc": {"method": "public/time"}}` answered code 107 "bad request". The page's only RPC is `private/auth`. |

## 6. Captured frames

From [`ws-probe.py`](../../../scripts/probes/venues/triv/ws-probe.py), run 2026-10-10 03:34 UTC.

Connect reply, which also announces the ping period:

```json
{"id":1,"connect":{"client":"db283c47-6ec5-4d4f-aeac-4aa5fc7ae103","ping":25,"pong":true}}
```

Subscribe refusal for `orderbook.BTCUSDT-PERP`, identical for every channel tried:

```json
{"id":2,"error":{"code":101,"message":"unauthorized"}}
```

RPC refusal for an unknown method:

```json
{"id":30,"error":{"code":107,"message":"bad request"}}
```

Server ping, answered with the same empty object:

```json
{}
```

No snapshot or delta exists to capture.

## 7. Private channels

The page streams user positions, margin, orders and trades on the same socket after the RPC `private/auth`, whose payload of `key_id`, `params` and `signature` comes from TRIV's backend at `/futures/<symbol>/cfx/private/auth`.
The page subscribes to the public channels only after that RPC, which matches the refusal in section 3.
One manual request during exploration showed that the auth call answers a logged-out client with a signed payload for a numbered key.
It is not in the probe and was not used, because joining with it would mean authenticating as TRIV.

## 8. Recommended feed shape

No feed is recommended.
The only perpetual book stream is the CFX socket, which refuses public channels without an authenticated session that only a CFX member or TRIV's backend can sign.
TRIV publishes no API through which an account holder could obtain such a credential, and CFX's REST host refused this exit with "Blocked by CFX Security Rules".

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [TRIV futures page for BTCUSDT-PERP](https://triv.co.id/en/futures/BTCUSDT-PERP), its `gon` variables and its scripts `perpetuals/centrifuge-connect`, `markets/futures/order_books`, `order_book_depth`, `mark_price`, `trade_histories` and `all_ticker_24h` | 2026-10-09 |
| S2 | [Centrifuge JavaScript client 5.0.1](https://unpkg.com/centrifuge@5.0.1/dist/centrifuge.js), which the page loads | 2026-10-09 |
