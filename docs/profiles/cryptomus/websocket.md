# Cryptomus WebSocket Profile

**Status:** Done, with no probed socket.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 Pacific time, 03:15 to 03:30 UTC on 2026-10-10, from the development host near Seattle through a Surfshark WireGuard tunnel whose exit geolocates to Canada.
No market data socket could be opened, because both socket host names returned NXDOMAIN from the system resolver, from Cloudflare and Google DNS over HTTPS, and from the zone's authoritative server.

This profile covers the spot book channel of Cryptomus (CCXT id `cryptomus`), because the venue lists no perpetual, see [fees.md](./fees.md) section 3.
The plan's template change 1 applies.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/cryptomus/ws-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/cryptomus/rest-probe.py).
Everything below about frame shapes is `Published` from the documentation or read from the web app's bundles, and none of it is `Probed`.

## 1. Endpoints

| socket | URL | auth | source | probed |
|---|---|---|---|---|
| documented API socket | `wss://api-ws.cryptomus.com/ws?token=<one-time token>` | a one-time token from the signed call `GET https://api.cryptomus.com/v2/user-api/exchange/account/web-socket/token`, valid 5 minutes or until first use | S1 | `api-ws.cryptomus.com` is NXDOMAIN, P1 |
| web app market data socket | `wss://exchange-ws.cryptomus.com/ws` | none in the bundle | S2 | `exchange-ws.cryptomus.com` is NXDOMAIN, P1 |
| web app account socket | `wss://exchange-ws.cryptomus.com/ws-dash?token=<session token>` | a logged-in session | S2 | same host, NXDOMAIN, P1 |
| web app Pusher socket | `wss://api-app.cryptomus.com/app/o6h25g2n8v3set` with `/broadcasting/auth` for channels | Bearer session for private channels | S2 | resolves to 91.216.220.72, and the upgrade answers HTTP 400 with an empty body and `x-powered-by: Laravel Reverb`, P1 |

The authoritative server `pdns1.registrar-servers.com` answered NXDOMAIN for both socket hosts, and Cloudflare and Google reported zone SOA serial 1791580927, P1.
That serial reads as Unix time 2026-10-09 21:22 UTC, about six hours before the probe, so the zone was edited that day.
Whether the socket hosts existed before that edit is not known from this host.
The certificate transparency log at crt.sh lists no certificate naming either socket host, only a wildcard `*.cryptomus.com` renewed 2026-09-20, so a wildcard certificate would have covered them, S3.
The REST hosts `api.cryptomus.com` and `api-app.cryptomus.com` resolve and serve, P1.

One socket would carry every spot pair.
The documented socket takes `"all"` as a subscription parameter for every channel, S1.

## 2. Channel matrix for public market data

All rows are `Published` in S1 for the documented socket, and none was probed.

| channel | subscribe method | parameter | update method | content |
|---|---|---|---|---|
| depth | `depth_subscribe` | `"<SYMBOL>:<scale_index>"`, or `"all"` | `depth_update` | `full_reload` true for a whole book, false for a partial update, `asks` and `bids` as `[price, value]` string pairs, a zero value removes a level |
| last price | `lastprice_subscribe` | symbols or `"all"` | `lastprice_update` | `symbol`, `timestamp`, `price` |
| ticker | `ticker_subscribe` | symbols or `"all"` | `ticker_update` | price, open, high, low, volume, quote volume, change |
| trades | `trade_subscribe` | symbols or `"all"` | `trade_update` | trades with numeric `price` and `quantity`, `timestamp`, `direction` |
| best bid and ask | none | | | `Not offered` as a separate channel |
| mark, index, funding | none | | | `Not offered`, no derivatives |

The scale index comes from `GET https://exchange-ws.cryptomus.com/api/v2/symbol-scales?symbol={symbol}`, which returns `scale` and `index` pairs, S1.
That host is the same NXDOMAIN host, P1.

The web app's market data socket speaks a different protocol, read from its bundle, S2.
It sends `{"command":"subscribe","params":{"interval":...,"scale":...,"symbol":...}}` and `{"command":"unsubscribe","params":{}}`.
Its events carry an `e` field with one of `depth`, `kline`, `lastprice`, `ticker` and `trade`, and a `d` field.
A depth event's `d.t` is 0 for `FULL_RELOAD` and 1 for `PARTIAL_UPDATE`, with levels in `d.a` and `d.b`.
The unsubscribe takes no symbol, so the web app holds one symbol per socket.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is the documented API socket, S1.
Every probed cell is the same: the host does not resolve, P1.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for every pair and every channel, S1 | not reachable, NXDOMAIN |
| subscribe frame shape | `{"id":<int>,"method":"depth_subscribe","params":["BTC_USDT:0"]}`, S1 | not reachable |
| unknown symbol expectation | not documented | not reachable |
| chunk unit and budget | not documented, `"all"` subscribes every pair at once | not reachable |
| keepalive mechanism | client sends `{"id":0,"method":"ping","params":[]}` every 50 seconds and gets `"method":"pong"`, S1 | not reachable |
| connection lifetime and maintenance notice | the server closes after 60 seconds without a client request, no maintenance notice documented, S1 | not reachable |
| handshake and operation rate limits | `Not publicly specified`, and each connection needs a fresh one-time token, S1 | not reachable |
| public market data authentication | required, the token comes from a signed call, S1 | not reachable, and no token was requested |
| message parse and routing | route on `method`, for example `depth_update`, S1 | not reachable |
| subscribe acknowledgement shape | `{"id":0,"method":"depth_subscribe","data":{"status":"success"},"error":null}`, S1 | not reachable |
| symbol identifier format | `BTC_USDT`, the catalog `symbol` and CCXT `market.id`, S1 | not reachable, the REST catalog uses the same form, [rest.md](./rest.md) section 2 |
| number representation | depth prices and sizes as strings, trade prices and sizes as JSON numbers, S1 | not reachable |
| timestamp representation | Unix seconds, "All endpoints return time in the Unix timestamp format", S1 | not reachable |
| size unit | base asset, the depth `value` beside a price, S1 | not reachable, the REST book's `quantity` is base asset, [rest.md](./rest.md) section 5 |
| sequence semantics | none documented, the depth event carries no sequence or previous id, S1 | not reachable |
| idle repeat behaviour | not documented | not reachable |

## 4. The book channel in detail

### Snapshot on subscribe

Not documented.
The `full_reload` flag says a depth event may carry the whole book, S1.
Whether the first event after a subscribe is a full reload could not be probed.

### Delta semantics

A partial update lists changed levels, and a zero size removes the level, S1.
Absolute sizes are implied by the example, which shows a size and not a change.

### Sequence and gap rule

`Not offered`.
The documented depth event has `symbol`, `timestamp`, `full_reload`, `scale_index`, `asks` and `bids`, and nothing that orders events, S1.
A feed could only detect a gap by waiting for the next full reload.

### Checksum

`Not offered`, no checksum field is documented, S1.

### Level order on the wire

Not documented for the socket.
The REST book lists bids from best to worst and asks from best to worst, [rest.md](./rest.md) section 5.

### Level window

Not documented for the socket.
The REST book returns 50 levels per side at scales 0 to 3, [rest.md](./rest.md) section 5.
The scale index aggregates price levels, so a scale above 0 is a coarser book.

### Size unit against CCXT `contractSize`

Spot has no contract size, and CCXT sets `contractSize` to `undefined` at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/cryptomus.js` line 342.
The socket's `value` and the REST `quantity` are base asset amounts, S1 and [rest.md](./rest.md) section 5.

### One-sided and empty books

Not probed on the socket.
The REST book returns empty `bids` and `asks` arrays for a symbol that does not exist, [rest.md](./rest.md) section 5.

### Idle repeats

Not probed.

### Unknown, closed and wrong-level symbols

Not probed.
The documented errors are code 1 "Invalid message format" and code 2 "Other errors", and the server terminates the connection on invalid JSON, S1.

## 5. Session

| item | value | source |
|---|---|---|
| keepalive | application `ping` every 50 seconds | S1 |
| silence tolerated | 60 seconds without a client request, then the server closes | S1 |
| forced disconnects | `Not publicly specified` | S1 |
| maintenance notices | `Not publicly specified` | S1 |
| compression | not documented, and the probe offered none | S1, P1 |
| handshake | one-time token per connection, valid 5 minutes | S1 |
| subscription limits | `Not publicly specified`, and "Resubscribing to the same data type will be canceled" | S1 |

## 6. Captured frames

No frame was captured, because no socket host resolved, P1.
The probe's output for each target was:

```text
== documented API socket, no token: wss://api-ws.cryptomus.com/ws
failed after 40 ms: gaierror: [Errno -2] Name or service not known

== web app market data socket: wss://exchange-ws.cryptomus.com/ws
failed after 3 ms: gaierror: [Errno -2] Name or service not known

== web app Pusher socket: wss://api-app.cryptomus.com/app/o6h25g2n8v3set?protocol=7&client=js&version=8.4.0&flash=false
failed after 431 ms: InvalidStatus: server rejected WebSocket connection: HTTP 400
refusal headers={'server': 'nginx', ..., 'x-powered-by': 'Laravel Reverb'} body=b''
```

The DNS lines of the same run:

```text
api-ws.cryptomus.com {'system': 'unresolved: [Errno -2] Name or service not known', 'cloudflare': 'NXDOMAIN [] zone SOA serial 1791580927', 'google': 'NXDOMAIN [] zone SOA serial 1791580927', 'authoritative': 'pdns1.registrar-servers.com. NXDOMAIN []'}
exchange-ws.cryptomus.com {'system': 'unresolved: [Errno -2] Name or service not known', 'cloudflare': 'NXDOMAIN [] zone SOA serial 1791580927', 'google': 'NXDOMAIN [] zone SOA serial 1791580927', 'authoritative': 'pdns1.registrar-servers.com. NXDOMAIN []'}
```

The documented frames, from S1, trimmed:

```json
{"id": 0, "method": "depth_update", "data": {"symbol": "BTC_USDT", "timestamp": 1750952911, "full_reload": false, "scale_index": 0, "asks": [["107043.93", "0.304313"]], "bids": [["106976.11", "0"]]}, "error": null}
```

## 7. Private channels

The documented socket carries `order_subscribe` with `order_update` events of type `created`, `updated` and `finished`, and `balance_subscribe` for balances, S1.
The web app opens `wss://exchange-ws.cryptomus.com/ws-dash?token=...` for orders, OCO orders, TP and SL orders and balances, and a Laravel Reverb Pusher socket on `api-app.cryptomus.com` for account broadcasts, S2.

## 8. Recommended feed shape

No feed is recommended.
The engine has no use for a spot-only venue, and the book socket cannot be reached from this host today.
If the hosts come back and a spot leg is ever built, the documented shape would be one connection on a fresh one-time token, `depth_subscribe` with `"<SYMBOL>:0"` per pair, a `ping` every 50 seconds, `maxSilenceMs` near 60,000, and a resync by reconnecting with a new token whenever a partial update arrives before a full reload.
The token needs an account and a signed REST call, which the survey's scope guard rules out probing.

## 9. Source ledger

| id | source |
|---|---|
| S1 | `https://doc.cryptomus.com/methods/exchange/websockets`, "WebSocket Streams", retrieved 2026-10-09 |
| S2 | the trading web app at `https://cryptomus.com/exchange/trading/BTC_USDT` and its Next.js chunks under `https://cryptomus.com/_next/static/chunks/`, retrieved 2026-10-09, which name `wss://exchange-ws.cryptomus.com/ws`, `/ws-dash`, the `command` frames, the `e` event names and the Pusher key `o6h25g2n8v3set` |
| S3 | `https://crt.sh/?q=%25.cryptomus.com`, certificate transparency search, retrieved 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/cryptomus/ws-probe.py), run 2026-10-10 UTC |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/cryptomus/rest-probe.py), run 2026-10-10 UTC |
