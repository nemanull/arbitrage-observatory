# Cryptal WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific, which is 2026-09-23 from 04:45 to 04:56 UTC, from the development host near Seattle through its Surfshark WireGuard exit, which geolocates to Canada.

Cryptal lists no perpetual, so this profile covers the spot market data socket, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Cryptal documents no WebSocket API.
Its API reference, S1, covers REST only, and names no socket, channel or stream.
The only socket found is the one the trading web client opens, `wss://wss.cryptal.com/gex`, read out of the public bundle at `https://cryptal.com/ex/` by [`ws-probe.mjs`](../../../scripts/probes/venues/cryptal/ws-probe.mjs) `client`.
That socket accepted the upgrade from this host and then closed every connection from the server side with code 1002, 0 to 21 ms after open and before any market data, in 12 of 12 trials over two runs.
So every protocol row below that is not about the refusal comes from the client code, and is marked as such.

## 1. Endpoints

| product | documented URL | web client bundle, W1 | probed |
|---|---|---|---|
| spot market data | none, S1 | `wss://wss.cryptal.com/gex`, constructed as `new ql("wss://wss.cryptal.com/gex",{maxAttempts:3,pingMessage:"ping.connection",timeOute:5e3})` | HTTP 101, then a server close frame 1002 `Protocol error` 0 to 21 ms after open, on both addresses, P1 and P2 |
| spot, signed in | none | the same URL with `?listenKey=<key>`, the key from `POST https://wss.cryptal.com/gex` with the user's bearer token | not probed, private |
| perpetuals, futures, options | none | none | not applicable |

`wss.cryptal.com` resolved to `3.78.135.93` and `18.196.190.233`, the same two AWS eu-central-1 addresses as the REST host, see [`rest.md`](./rest.md) section 1.
A plain `GET https://wss.cryptal.com/` answers 200 with a page titled "Web Socket Test" whose script opens `ws://matching-engine-svc:7777/websocket`, an internal cluster name, and `GET https://wss.cryptal.com/gex` answers 503 `upstream connect error or disconnect/reset before headers. reset reason: connection termination`, P1 and P2.
That test page is left alone.

## 2. Channel matrix for public market data

All from the web client bundle, W1, and none delivered a frame to this host.

| channel | subscribe frame in the client | depth and speed | probed |
|---|---|---|---|
| `ORDER_BOOK` | `{action:"SUBSCRIBE",channel:"ORDER_BOOK",depth:25,pair:e}` | 25 is the only depth the client asks for. Speed Not publicly specified | refused, no frame |
| `TICKER` | `{action:"SUBSCRIBE",channel:"TICKER",pair:e}` | the fields the client reads, `maxPrice`, `minPrice`, `lastTradePrice`, `baseVolume`, `priceChange`, match REST `GET /ticker` | refused |
| `LIVE_TRADE` | `{action:"SUBSCRIBE",channel:"LIVE_TRADE",pair:e}` | an array with `timestamp`, `side` `BID` or `ASK`, `price`, `quoteVolume`, `volume`, like REST `GET /trades` | refused |
| `CANDLE_STICK` | `{action:"SUBSCRIBE",channel:"CANDLE_STICK",pair:e}` | `data` with `D`, `O`, `H`, `L`, `C`, `V` and `closeTime` | refused |
| best bid and ask, mark, index, funding | none | none | none |

The client's pair object carries `pairDisplayName` like a `GET /pairs` row, so `pair` is most likely the REST pair id such as `BTC-USD`.
The client subscribes one pair at a time, the one on screen, and unsubscribes it with the same frames with `action` `UNSUBSCRIBE`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is documented, so the middle column is the web client bundle, W1, which is what the client sends and how it reads the reply, not a wire capture.

| axis | documented, S1 | web client bundle, W1 | probed, P1 and P2 |
|---|---|---|---|
| endpoint split axis | Not publicly specified | one URL for every pair | one URL answered, and refused |
| subscribe frame shape | Not publicly specified | one JSON object per channel and pair, `{"action":"SUBSCRIBE","channel":"ORDER_BOOK","depth":25,"pair":"BTC-USD"}` | sent at open. The close frame arrived 0 to 8 ms after it, far less than the round trip of about 150 ms, so the server had closed before the frame reached it |
| unknown symbol expectation | Not publicly specified | the client ignores an `ORDER_BOOK` frame whose `pair` is not the one on screen | Not verified |
| chunk unit and budget | Not publicly specified | one pair per socket, four frames | Not verified |
| keepalive mechanism | Not publicly specified | `{"action":"PING"}` every 10,000 ms, `this._pingMessageInterval=1e4` | Not verified, the socket closed first |
| connection lifetime and maintenance notice | Not publicly specified | close code 4001 makes the client refresh its login token and reconnect. Any code but 1000 reconnects after a wait of 3 s, 60 s once the socket has opened ten times, or 180 s once it has opened twenty times, plus the 5 s `timeOute` | every socket closed at once with 1002 |
| handshake and operation rate limits | Not publicly specified | none in the client | the upgrade reply carries `x-ratelimit-burst-capacity: 10`, `x-ratelimit-replenish-rate: 10` and `x-ratelimit-remaining: 9` |
| public market data authentication | Not publicly specified | none for a visitor who is not signed in, the bare URL | refused, with no reason beyond `Protocol error`. The web client also connects without credentials, so the check is on something other than a login, see section 5 |
| message parse and routing | Not publicly specified | `JSON.parse`, route on `channel`, then `pair` for `ORDER_BOOK` | Not verified |
| subscribe acknowledgement shape | Not publicly specified | the client handles no acknowledgement | Not verified |
| symbol identifier format | Not publicly specified | most likely the REST pair id, `BTC-USD`, section 2 | Not verified |
| number representation | Not publicly specified | the book reducer compares `volume` with `0` and sorts by `Number(price)`, which fits the REST strings | Not verified |
| timestamp representation | Not publicly specified | `LIVE_TRADE` `timestamp`, copied to `time` | Not verified |
| size unit | Not publicly specified | base currency, like the REST book `volume` | Not verified |
| sequence semantics | Not publicly specified | the client reads no sequence or update id | Not verified |
| idle repeat behaviour | Not publicly specified | nothing in the client depends on it | Not verified |

## 4. The book channel in detail

Nothing in this section was seen on the wire, because no book frame arrived.
The rows below describe how the web client consumes `ORDER_BOOK`, W1, which is the best available evidence of what the server sends.

### Snapshot on subscribe

Not verified.
The client clears its book on a pair change and on a socket close, and then only merges frames, so the first frame after a subscribe has to carry the whole visible book for the screen to fill, which suggests a snapshot on subscribe.

### Delta semantics

The client reducer merges each frame's `bids` and `asks` into a map keyed by `price`, deletes a level whose `volume` is `0`, and keeps `{price, amount: volume, total: totalCost}` otherwise.
That is price keyed upsert semantics with a zero size delete, W1.
The frame may also carry `bidDepths` and `askDepths`, which the reducer stores whole.

### Sequence and gap rule

None.
The client reads no sequence number, update id or checksum from `ORDER_BOOK`, W1, so a feed built on this socket could not detect a lost frame.

### Checksum

None in the client.

### Level order on the wire

Not verified.
The client sorts both sides itself, bids by descending and asks by ascending `Number(price)`.
The REST book arrives already sorted, see [`rest.md`](./rest.md) section 5.

### Size unit

Base currency, if the socket matches the REST book, whose `volume` times `price` equals `totalCost` on every level probed, see [`rest.md`](./rest.md) section 5.
CCXT has no Cryptal class, so there is no `contractSize` to compare with, and a spot pair would have 1.

### One-sided and empty books, idle repeats, unknown and closed symbols

Not verified.

## 5. Session

| item | documented | probed, P1 and P2 |
|---|---|---|
| handshake | Not publicly specified | HTTP 101 in 442 to 488 ms over 12 sockets |
| refusal | Not publicly specified | the server sent the 18 byte close frame `88 10 03 ea` followed by `Protocol error` 0 to 21 ms after open, whether the client sent nothing, a subscribe, a `PING`, a deflate offer or a self identifying `User-Agent`. Where the client sent a frame, the close arrived 0 to 8 ms after it, sooner than the frame could reach Frankfurt, so the refusal is decided at the handshake. The client saw the close complete 147 to 167 ms after open |
| keepalive | Not publicly specified | not reached |
| silence the server tolerates | Not publicly specified | not measurable, since no socket lived past its first 21 ms |
| forced disconnect | Not publicly specified | every connection |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client offering permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it |
| subscription limits | Not publicly specified | not reached |
| front end | | `server: istio-envoy` on the upgrade, the same as REST |

What differs between this probe and a browser that is not signed in is the `Origin: https://cryptal.com` header, the browser's `User-Agent` and any cookies of `cryptal.com`, since the client passes the bare URL.
A self identifying `User-Agent` did not change the refusal.
The probe never sent an `Origin` header, because claiming `https://cryptal.com` as the origin would impersonate the website to get past its check.
So whether the check is on `Origin` is Not verified, and it is an open question for the user rather than something to test around.

## 6. Captured frames

From the probe runs of 2026-09-23 UTC.

Subscribe, sent at open in the `subscribe ORDER_BOOK on open` trial, spelled as the web client spells it.

```json
{"action": "SUBSCRIBE", "channel": "ORDER_BOOK", "depth": 25, "pair": "BTC-USD"}
```

Keepalive, sent at open in the `PING on open` trial.

```json
{"action": "PING"}
```

Upgrade reply, trimmed to the headers that matter.

```text
HTTP/1.1 101
upgrade: websocket
server: istio-envoy
x-ratelimit-burst-capacity: 10
x-ratelimit-replenish-rate: 10
x-ratelimit-remaining: 9
vary: Origin,Access-Control-Request-Method,Access-Control-Request-Headers
```

The only frame the server ever sent, as raw bytes: FIN and opcode 8 (close), an unmasked 16 byte payload, status 1002 (`03ea`), reason `Protocol error`.

```text
88 10 03 ea 50 72 6f 74 6f 63 6f 6c 20 65 72 72 6f 72
```

No acknowledgement, snapshot, delta, pong or error object was received.

## 7. Private channels

Named for a future execution stage, from the web client bundle, W1, not probed.

- `{action:"SUBSCRIBE",channel:"OPEN_ORDERS"}` and `{action:"SUBSCRIBE",channel:"BALANCE"}`, sent only when signed in.
- The signed in socket is `wss://wss.cryptal.com/gex?listenKey=<key>`, where the key is the reply to `POST https://wss.cryptal.com/gex` with `Authorization: Bearer <token>` from `auth.cryptal.com`.
- Close code 4001 means the token expired, and the client refreshes it and reconnects.

## 8. Recommended feed shape

No feed is recommended.
Cryptal has no perpetual, documents no socket, and the web client's socket refuses a plain client, so it cannot join the engine as a book feed in its current shape.
If a spot stage ever wants Cryptal, the public REST book at `GET /api/v1/public/orderbook/{pair}?limit=25` is the documented route, see [`rest.md`](./rest.md) section 5, and a socket needs Cryptal to publish or permit one first.
Even then the client code shows no sequence number, so gaps could not be detected.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Cryptal Exchange API, OpenAPI 3.0.1, Last-Modified 2023-03-28 | https://api.cryptal.com/openapi.json, rendered at https://api.cryptal.com/ | 2026-09-23 UTC | Cryptal | no socket documented, sections 1 to 3 |
| W1 | Cryptal trading web client, `main.94c6929fbaefe0739e94.bundle.js`, 2,740,021 bytes | https://cryptal.com/ex/main.94c6929fbaefe0739e94.bundle.js, loaded by https://cryptal.com/ex/ | 2026-09-23 UTC | Cryptal | socket URL, subscribe and ping frames, reconnect rules, book reducer, private channels, sections 1 to 4 and 7 |
| P1 | `ws-probe.mjs refusal` and `client` at 04:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cryptal/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | the refusal, handshake time, headers, close frame, sections 1, 3, 5 and 6 |
| P2 | `ws-probe.mjs refusal` and `client`, rerun at 04:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cryptal/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | the second readings |
