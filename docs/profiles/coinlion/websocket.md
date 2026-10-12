# CoinLion WebSocket Profile

**Status:** Done.
CoinLion's only socket is the web app's anonymous ASP.NET Core SignalR hub, whose `Book` stream sends one full snapshot on subscribe and no update in 150 s, over books that were empty on 129 of 132 instruments.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:38 to 04:57 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada, which geolocated to Vancouver.

CoinLion lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book channel, per change 1 of the survey plan's template.
CoinLion publishes no API documentation, so every documented value below is Not publicly specified.
The hub, its method names and its arguments were read from the web app bundle, S1, and every probed value comes from [`ws-probe.py`](../../../scripts/probes/venues/coinlion/ws-probe.py), whose sections are A, B and C.

## 1. Endpoints

| surface | URL | evidence |
|---|---|---|
| negotiate | `POST https://ursa.coinlion.com/marketdata/info/negotiate?negotiateVersion=1` | S1, section C |
| socket | `wss://ursa.coinlion.com/marketdata/info?id=<connectionToken>` | S1, section A |

The hub is an ASP.NET Core SignalR hub.
The bundle builds it with the Microsoft SignalR client as `new HubConnectionBuilder().withUrl(COINLION_API_URL + "marketdata/info")`, where `COINLION_API_URL` is `https://ursa.coinlion.com/` in `config.js`, S1.
The negotiate reply offers the `WebSockets`, `ServerSentEvents` and `LongPolling` transports, section A.
One socket carries every instrument and every stream.
There is no perpetual endpoint, because there are no perpetuals.

## 2. Channel matrix

The hub exposes streaming methods, called with a SignalR StreamInvocation, rather than channels.

| method | argument | what it streams | evidence |
|---|---|---|---|
| `Book` | an instrument id such as `lion_usdc` | the full book of one instrument, one snapshot on subscribe | S1, section A |
| `Trades` | an instrument id | the last 100 trades on subscribe | S1, section A |
| `MiniTicker` | `"3"`, as the web app sends it | 24 hour open, high, low, close and volume for all 132 instruments, about once a second | S1, section A |
| `Depth` | an instrument id | not a method, the hub answers "Method does not exist" | section A |
| best bid and ask, mark, index, funding | none | Not offered | S1 |

The meaning of the `MiniTicker` argument `"3"` is Not publicly specified.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is documented, so every documented value is Not publicly specified, and the probed column is the spot `Book` stream.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one hub for every instrument and stream, section A |
| subscribe frame shape | Not publicly specified | SignalR StreamInvocation `{"type":4,"invocationId":"1","target":"Book","arguments":["lion_usdc"],"streamIds":[]}` followed by the record separator `0x1E`, section A |
| unknown symbol expectation | Not publicly specified | a Completion with an error, `{"type":3,"invocationId":"9","error":"An unexpected error occurred invoking 'Book' on the server."}`, and the socket stays usable, section C |
| chunk unit and budget | Not publicly specified | not reached, six streams on one socket worked, section A |
| keepalive mechanism | Not publicly specified | SignalR ping `{"type":6}` from the server every 15 to 16 s, section A |
| connection lifetime and maintenance notice | Not publicly specified | a socket that sent nothing after the handshake stayed open 75 s, section B, and no close or notice arrived on the 150 s socket, section A |
| handshake and operation rate limits | Not publicly specified | Not verified |
| public market data authentication | Not publicly specified | none, negotiate and the socket take no token, section A |
| message parse and routing | Not publicly specified | every frame carries `invocationId`, and a `Book` item carries `instrument`, section A |
| subscribe acknowledgement shape | Not publicly specified | none, the first StreamItem arrives 240 to 250 ms after the invocation, section A |
| symbol identifier format | Not publicly specified | lowercase `base_quote`, such as `btc_usd`, the same as the REST catalog |
| number representation | Not publicly specified | JSON numbers for prices and amounts |
| timestamp representation | Not publicly specified | none on a `Book` item, ISO 8601 strings with no zone on trades, such as `2026-10-10T03:14:27.71766`, and with `Z` on `MiniTicker` rows |
| size unit | Not publicly specified | base asset, `amount` 0.137 SOL at `executionPrice` 109.55126 on `sol_usd` |
| sequence semantics | Not publicly specified | a per instrument integer `version`, 69217595 on `lion_usdc`, 166525725 on `btc_usd` and 130 on `sol_usd`, unchanged for the whole probe, so its step rule is Not verified |
| idle repeat behaviour | Not publicly specified | `Book` sends nothing when nothing changes, and `MiniTicker` repeated identical close and volume values in 147 of 147 and 149 of 150 consecutive frames in two runs, section A |

## 4. The book channel in detail

- Snapshot on subscribe: yes.
  Each `Book` item carries `instrument`, `bids`, `asks`, `version`, `bidTotalAmount`, `askTotalAmount` and `snapshot`, and the first one has `snapshot: true`, section A.
- Depth: the full book.
  The `lion_usdc` snapshot held 1 bid and 1,511 asks in one 49,869 character frame, section A.
- Delta semantics: Not verified.
  No `Book` stream sent a second frame in 150 s, on `lion_usdc`, `btc_usd` or `sol_usd`, section A.
  The `snapshot` flag suggests that later items may be deltas with `snapshot: false`, but none was seen.
- Sequence and gap rule: Not verified, for the same reason.
  `version` did not change over 150 s on the socket or over 20 REST polls in 30 s, [`rest.md`](./rest.md) section 4.
- Checksum: none in the frame.
- Level order on the wire: both sides ascending by price.
  The `lion_usdc` asks run from 0.15 to 342.2023, and the `btc_usd` bids run from 7,733.77 up to 25,833.77, so the best bid is the last bid level, section A.
- Size unit: base asset, see section 3.
  There is no CCXT class, so there is no `contractSize` to compare.
- One-sided and empty books are the normal state.
  `sol_usd` arrived as `{"bids":[],"asks":[],"version":130,"snapshot":true}`, and `btc_usd` held four bids from 7,733.77 to 25,833.77 and no ask, section A.
  Across the REST catalog, 129 of 132 books were empty, 2 held bids only and 1 was two-sided, [`rest.md`](./rest.md) section 5.
- Trades without a book: `sol_usd` showed an empty book while its `Trades` stream returned 100 trades, the newest at 03:14:27 UTC and the oldest at 06:00:25 UTC the day before, section A.
  Its `MiniTicker` row reported 5,164.042 SOL of 24 hour volume, section A.
  The 100 trades sum to 5,163.64 SOL, 37 with `side` 0 and 63 with `side` 1, at 25 distinct prices, section A.
  So the `Trades` snapshot holds about the whole day's volume.
  So whatever liquidity fills these trades is not visible in the public book.
- Unknown or missing symbol: a Completion with an error, section C and section A.
  `Book` with no argument answers "Failed to invoke 'Book' due to an error on the server.", section A.
  A plain Invocation of `Book` answers "The client attempted to invoke the streaming 'Book' method with a non-streaming invocation.", section C.

## 5. Session

- Handshake: after the socket opens, the client sends `{"protocol":"json","version":1}` and the record separator, and the server answers `{}`, section A.
- Keepalive: the server sends `{"type":6}` every 15 to 16 s, nine times in 141 s, section A.
  The web app sets no custom interval, so the client side sends the SignalR default ping every 15 s, S1.
- Silence tolerated: a socket that sent no ping and no invocation after the handshake was still open after 75 s, section B.
  So the server's client timeout, 30 s by SignalR default, S2, is either longer or not enforced here.
  The probe did not wait longer.
- Forced disconnects and maintenance notices: none seen in 150 s.
- Compression: the server negotiated no `permessage-deflate` extension when the client offered none, section A.
- Cancel: a CancelInvocation `{"type":5,"invocationId":"0"}` stops `MiniTicker`, after the frames already in flight, section A.
- Handshake and subscription limits: Not publicly specified, and none reached with six streams.

## 6. Captured frames

Subscribe acknowledgement: none.
The first answer to a `Book` invocation is its snapshot, section A.

Snapshot, `btc_usd`, whole:

```json
{"type":2,"invocationId":"2","item":{"instrument":"btc_usd","bids":[{"amount":0.905121,"price":7733.77},{"amount":0.8922,"price":7845.77},{"amount":2.530705,"price":19757.34},{"amount":2,"price":25833.77}],"asks":[],"version":166525725,"askTotalAmount":0,"bidTotalAmount":6.328026,"snapshot":true}}
```

Snapshot, `lion_usdc`, trimmed to the first three asks:

```json
{"type":2,"invocationId":"1","item":{"instrument":"lion_usdc","bids":[{"amount":292066.40,"price":0.001}],"asks":[{"amount":93.11,"price":0.15},{"amount":1618.25,"price":0.195},{"amount":999.52,"price":0.197}],"version":69217595,"snapshot":true}}
```

Delta: none was received, see section 4.

Keepalive, from the server:

```json
{"type":6}
```

Error, unknown instrument:

```json
{"type":3,"invocationId":"9","error":"An unexpected error occurred invoking 'Book' on the server."}
```

Trade, the newest `sol_usd` row of the `Trades` snapshot:

```json
{"tradeId":1713870,"tradeTime":"2026-10-10T03:14:27.71766","amount":0.137,"executionPrice":109.55126,"side":0}
```

## 7. Private channels

None found on this hub.
The web app's account and order calls go to `https://ursa.coinlion.com/frontoffice-v2/api/v2/` with an Auth0 bearer token, S1.
The bundle has an `apikeys` path for user API keys, S1, but no documentation of what those keys can call.

## 8. Recommended feed shape

No perpetual feed is recommended, because CoinLion lists no perpetuals.

For a future spot leg, the shape would be one socket to `wss://ursa.coinlion.com/marketdata/info` after a negotiate call, the SignalR JSON handshake, one `Book` StreamInvocation per instrument, and a client ping every 15 s.
`maxSilenceMs` could not be a book silence limit, because `Book` sends nothing while the book is unchanged.
It would have to rest on the server ping, about 16 s apart, so 40,000 ms.
The resync rule cannot be written until a delta and a `version` step are seen.
Such a feed would show almost nothing today, since 129 of 132 books are empty.
SignalR framing would also be a new transport for the engine's feeds.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | The web app at [`trade.coinlion.com`](https://trade.coinlion.com/), its `config.js` with `COINLION_API_URL`, and its bundle `/assets/index-B6TAsugn.js`, where `MZ` wraps the SignalR client and calls `subscribe("Book", ...)`, `subscribe("Trades", ...)` and `subscribe("MiniTicker", "3", ...)` on `marketdata/info` | 2026-10-09 |
| S2 | The ASP.NET Core SignalR hub protocol, as implemented by the client in S1 | 2026-10-09 |
