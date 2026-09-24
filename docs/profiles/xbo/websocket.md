# XBO.com WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:34 UTC, second pass 04:44 UTC), from the development host near Seattle, through its Canadian VPN exit.

This profile covers the futures market data socket of XBO.com, which carries the USDT-margined perpetuals.
XBO has no CCXT class, see [`fees.md`](./fees.md) section 8.
The socket requires an API key on the upgrade request, and this survey sends none, so every probed value below is the refusal.
The documented values come from the Client API reference, S1, and are written so that a later keyed probe knows what to check.
XBO documents no spot socket and no unauthenticated socket of any kind.
Every probe claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/xbo/ws-probe.mjs).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| futures, perpetual and dated | `wss://api.xbo.com/ws/v1/futures`, with `XBO-API-KEY`, `XBO-API-TIMESTAMP` and `XBO-API-SIGN` headers on the upgrade, S1 | HTTP 401 with an empty body and no `www-authenticate` header on all six attempts over two runs, 321 to 521 ms after the request, P1 and P2 |
| spot | none, the Public API is REST only, S2 | not applicable |
| undocumented guess `wss://api.xbo.com/ws/v1/spot` | none | HTTP 404, empty body, P1 and P2 |
| undocumented guess `wss://api.xbo.com/ws/v1` | none | HTTP 404, P1 and P2 |
| undocumented guess `wss://api.xbo.com/ws` | none | HTTP 404, P1 and P2 |
| undocumented guess `wss://ws.xbo.com/` | none | `getaddrinfo ENOTFOUND`, the name does not resolve, P1 and P2 |

The documented catalog says a perpetual is spelled `BTC-USDT-PERP` and a dated future `BTC-USDT-260626`, and that "The same identifier is used as instrumentId in the futures WebSocket API", S1.
So one socket is documented to carry both perpetual and dated futures, which is an inference from the shared identifier space and was not probed.
The refusals came from Cloudflare, with `cf-ray` ending in `-SEA` or `-YVR`, and they are the documented answer to a missing signature: "A missing or invalid signature is rejected with 401 Unauthorized before the socket opens.", S1.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed |
|---|---|---|---|
| `books` | `{"channel": "books", "instrumentId": "BTC-USDT-PERP"}` | "Full order book data", snapshot then incremental updates, depth and push interval Not publicly specified | refused, 401 |
| `tickers` | `{"channel": "tickers", "instrumentId": "BTC-USDT-PERP"}` | "best bid, best ask, last trade, and mark price, pushed on every update", current values on subscribe | refused, 401 |
| trades, index, funding, kline | none documented | | |

The error table says a channel other than `tickers` or `books` answers `invalid-channel`, so these two are the whole list, S1.
The ticker carries a mark and no index and no funding rate, S1.
The channel list arrived in the API update of 02/07/2026, "Real-time futures market data", "over an HMAC-authenticated connection", S1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one futures URL, no spot socket, S1, S2 | futures URL refuses without a key, spot guesses answer 404, section 1 |
| subscribe frame shape | `{"operation": "subscribe", "id": "optional-correlation-id", "arguments": [{"channel": "tickers", "instrumentId": "BTC-USDT-PERP"}, …]}`, several arguments per frame, S1 | not reachable |
| unknown symbol expectation | an `error` event with `code` `invalid-instrument` and `message` `unknown instrument`, and "An error on one subscription does not close the connection.", S1 | not reachable |
| chunk unit and budget | per argument acknowledgement, and "Max inbound message size: 64 KB (larger closes the connection).", S1. No argument cap is published | not reachable |
| keepalive mechanism | client sends the literal text `ping`, server answers `pong`, every 10 to 15 s recommended. "A protocol-level WebSocket ping frame does not reset it.", S1 | not reachable |
| connection lifetime and maintenance notice | `{"event": "notice", "code": "reconnect", "message": "Please reconnect"}` before a shutdown, then a close. A lifetime cap is Not publicly specified, S1 | not reachable |
| handshake and operation rate limits | Not publicly specified. The upgrade needs a timestamp "within 60 seconds of server time", S1 seven upgrades to `api.xbo.com` within 7 s, four answered 401 and three 404, and none met a rate limit answer, P1 and P2 |
| public market data authentication | required. HMAC-SHA256 over `{timestamp}GET/ws/v1/futures`, base64, S1 | 401 on every attempt without a key, P1 and P2 |
| message parse and routing | `{"event": "data", "channel": "books", "action": "snapshot" or "update", "data": {"instrumentId": …}}`, S1 | not reachable |
| subscribe acknowledgement shape | `{"event": "ack", "operation": "subscribe", "id": "...", "argument": {"channel": …, "instrumentId": …}}`, one per argument, S1 | not reachable |
| symbol identifier format | `BTC-USDT-PERP`, and `BTC-USDT-260626` for a dated future, S1 | not reachable, and no CCXT `market.id` exists to compare |
| number representation | prices and amounts as strings, `[price, amount]` pairs, ticker fields `string` or `null`, S1 | not reachable |
| timestamp representation | no timestamp field in any documented frame, S1 | not reachable |
| size unit | Not publicly specified for the socket. The catalog gives order sizes "in base currency", S1 | not reachable |
| sequence semantics | "Each message carries a monotonically increasing version", buffer until the snapshot, drop versions at or below it, apply the rest in version order, S1. Whether the version steps by one is Not publicly specified | not reachable |
| idle repeat behaviour | Not publicly specified | not reachable |

## 4. The book channel in detail

Nothing in this section was probed, because the socket refused the upgrade.
It records the documentation, S1, and the questions a keyed probe must answer.

### Snapshot on subscribe

"On subscribe you get a snapshot, then incremental updates.", S1.
"A delta may arrive before the snapshot", so the client buffers `books` messages until the snapshot arrives, S1.
"If the server sends a fresh snapshot (a new action: "snapshot" frame), treat it as a reset and rebuild the book from it.", S1.

### Delta semantics

A delta is an `"action": "update"` frame "with the same shape" as the snapshot, S1.
"an amount of "0" (or "0.0") means remove that price level.", S1.
So a feed must compare the amount as a number and not as the string `"0"`.

### Sequence and gap rule

```text
before the snapshot          buffer every books frame
snapshot                     replace the book, last = version
update, version <= last      drop (documented)
update, version > last       apply in version order (documented), last = version
version steps by more than 1 unknown: a gap only if the version is consecutive, which S1 does not say
```

S1 also warns that when a client cannot keep up, "the oldest queued messages may be dropped", and it asks the client to "always rely on the order-book version to detect and recover from gaps".
That advice implies the version reveals a dropped message, which only holds if it steps by one per message, so it is Not verified.

### Checksum

None is documented.

### Level order on the wire

Not publicly specified.
The snapshot example lists bids descending and one ask, S1.

### Level window

Not publicly specified, the channel is described as "Full order book data", S1.

### Size unit against CCXT `contractSize`

No CCXT market exists, so there is no `contractSize` to compare.
The catalog fields `minVolumeTrade`, `maxVolumeTrade` and `volumeStep` are "in base currency", S1, which suggests book amounts in base currency, and that is an inference.

### One-sided and empty books

Not publicly specified.
The ticker sends `null` for a field "not yet known", and "Treat null as "no value yet", never as zero.", S1.

### Idle repeats

Not publicly specified.

### Unknown, closed and wrong symbols

| request | documented reply, S1 | probed |
|---|---|---|
| unknown `instrumentId` | `{"event": "error", "id": "...", "argument": {"channel": "books", "instrumentId": "XYZ"}, "code": "invalid-instrument", "message": "unknown instrument"}` | not reachable |
| channel other than `tickers` or `books` | `invalid-channel` | not reachable |
| malformed JSON, unknown operation, missing arguments | `invalid-request`, without `argument` | not reachable |
| server fault | `internal-error`, without `argument` | not reachable |
| binary frame | "binary frames will close the connection" | not reachable |

## 5. Session

| item | documented, S1 | probed |
|---|---|---|
| keepalive | literal `ping` text, answered by `pong`, at least every 30 s and 10 to 15 s recommended | not reachable |
| silence the server tolerates | "The server closes any connection that is idle for 30 seconds", where idle means nothing received from the client. "Receiving market data does not keep the connection open" | not reachable |
| forced disconnect | a `reconnect` notice, then a close | not reachable |
| maintenance notice | the same `reconnect` notice | not reachable |
| compression | "Text frames only". Permessage-deflate is Not publicly specified | an upgrade offering permessage-deflate got the same 401 in 406 and 555 ms, so the refusal comes before any negotiation, P1 and P2 |
| handshake | signed headers, timestamp within 60 s of server time | 401 in 321 to 521 ms, P1 and P2 |
| subscription limits | Not publicly specified | not reachable |
| slow consumer | "the oldest queued messages may be dropped" | not reachable |

## 6. Captured frames

No WebSocket frame was captured, because no socket opened.
The refusal of the futures upgrade, from P1 at 04:34:48 UTC, as the `ws` client reported it.

```text
HTTP/1.1 401 Unauthorized
server: cloudflare
cf-ray: a3f6d6cbbc9f89d5-YVR
content-length: 0
connection: keep-alive
date: Wed, 23 Sep 2026 04:34:48 GMT
```

The frames below are the documentation's examples, S1, not captures.
They are quoted so that a keyed probe can check them.

Subscribe.

```json
{"operation": "subscribe", "id": "optional-correlation-id", "arguments": [{"channel": "tickers", "instrumentId": "BTC-USDT-PERP"}, {"channel": "books", "instrumentId": "ETH-USDT-PERP"}]}
```

Acknowledgement.

```json
{"event": "ack", "operation": "subscribe", "id": "...", "argument": {"channel": "tickers", "instrumentId": "BTC-USDT-PERP"}}
```

Book snapshot.

```json
{"event": "data", "channel": "books", "action": "snapshot", "data": {"instrumentId": "BTC-USDT-PERP", "version": 1024, "bids": [["64980.5", "1.2"], ["64980.0", "3.0"]], "asks": [["64981.0", "0.8"]]}}
```

Ticker.

```json
{"event": "data", "channel": "tickers", "data": {"instrumentId": "BTC-USDT-PERP", "bid": "64980.5", "ask": "64981.0", "last": "64980.0", "mark": "64979.3"}}
```

Error.

```json
{"event": "error", "id": "...", "argument": {"channel": "books", "instrumentId": "XYZ"}, "code": "invalid-instrument", "message": "unknown instrument"}
```

Reconnect notice.

```json
{"event": "notice", "code": "reconnect", "message": "Please reconnect"}
```

## 7. Private channels

The futures socket documents no private channel, S1.
Orders, balances and order history are REST calls of the Client API under `/v1/spot-trading/`, and no futures order endpoint is documented, S1.
None was probed.

## 8. Recommended feed shape

No feed is recommended.
The socket refuses an unauthenticated client, the engine's `VenueFeed` sends no signed headers on the upgrade, and a key needs an XBO account whose customer type allows futures market data, S1.
XBO also has no CCXT class to supply the catalog, and the futures catalog itself needs the key, see [`rest.md`](./rest.md) section 2.

If a key is ever available, a later design would start from these documented facts, all untested.

| item | starting point | reason |
|---|---|---|
| URL plan | one plan on `wss://api.xbo.com/ws/v1/futures`, with the three signed headers on each upgrade | documented, S1 |
| channel | `books` per `instrumentId` | snapshot on subscribe and a version, S1 |
| subscribe frames | one frame per slice, one argument per market | several arguments per frame are documented, S1 |
| keepalive | the text `ping` every 10 s | a 30 s client idle timer that protocol pings do not reset, S1 |
| `maxSilenceMs` | unknown | the push rate of a quiet book is Not publicly specified |
| resync | a fresh snapshot resets, and a version gap resyncs only if the version proves consecutive | section 4 |
| deflate | keep `perMessageDeflate: false` | text frames only, S1 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | XBO Client API reference, section Futures Market Data and API update of 02/07/2026 | https://docs.xbo.com/ | 2026-09-22 | XBO, global | URL, authentication, channels, frames, errors, keepalive, limits, reconnect notice, sections 1 to 8 |
| S2 | XBO Exchange Public API reference | https://public-docs.xbo.com/ | 2026-09-22 | XBO, global | no socket in the unauthenticated API, sections 1 and 3 |
| P1 | `ws-probe.mjs all` at 04:34 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xbo/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | 401 on the futures socket, 404 on the guesses, deflate offer, sections 1, 3, 5 and 6 |
| P2 | `ws-probe.mjs all`, second pass at 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xbo/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | the same readings, sections 1 and 3 |
