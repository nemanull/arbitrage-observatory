# AIA Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
AIA Exchange publishes no WebSocket documentation and has no CCXT class, see [`fees.md`](./fees.md) section 8.
The only socket protocol known is the one its own web bundle speaks, read from `app.87b0b8bc.js` on `aianalysisexchange.com`, S1.
No socket the bundle can pick opened from this host.
The configured host fails its TLS handshake, and the site's own origin answers every handshake with HTTP 403 from its CDN's access control.
So every probed column below says what was refused, and the documented column holds what the bundle shows.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/aia/ws-probe.py).

## 1. Endpoints

The bundle builds its socket URL in this order, S1.

1. `wss://<host>/v1/np/ws` when a host is passed in, which the bundle does only from a services value `mzd5` that nothing in it ever sets.
2. `wss://<localStorage ws>/v1/np/ws` when a previous session stored a host.
3. The tenant config's `ws`, `wss://www.cryptoex.aianalysis.co.uk/v1/np/ws`, for exId `expf`.

| URL | role | result from this host, P1 |
|---|---|---|
| `wss://www.cryptoex.aianalysis.co.uk/v1/np/ws` | config `ws` | TLS alert `unrecognized name` from `13.248.213.45` and `76.223.67.189`, so no HTTP reply |
| `wss://www.cryptoex.aianalysis.co.uk` | config `oldws` | the same TLS alert |
| `wss://aianalysisexchange.com/v1/np/ws` | the page's own origin | HTTP 403 in about 420 ms |
| `wss://www.aianalysisexchange.com/v1/np/ws` | the same origin with `www` | HTTP 403 |
| `wss://aianalysisexchange.com/v1/pusher/ws` | the older path other tenants use | HTTP 403 |
| `wss://ws.aianalysisexchange.com/v1/np/ws` | a wildcard DNS name on the same CDN address | certificate does not cover the name |

Every 403 carries the CDN headers `x-via: 1.1 PS-LHR-... (Cdn Cache Server V2.0)` and `x-ws-request-id`, which name a London edge node of the CDN.
Its HTML body says "The access control configuration prevents your request at this time."
The body goes on "Please contact your service provider if you feel this is incorrect."
The handshake was tried with no `Origin`, with each of the three site origins, and with a desktop Chrome user agent, and each answered 403.
A plain GET of `/v1/np/ws` without the upgrade headers does reach a server behind the CDN, which answers HTTP 400 `Bad Request` with `sec-websocket-version: 13` and an Envoy timing header, P1 section 1.
So a socket server exists, and the CDN refuses the upgrade itself.
This research cannot tell whether the rule is geographic, since no other exit was used, per design decision 5.

One socket would carry every product, because the bundle sends perpetual, spot and option channels on the same connection, S1.

## 2. Channel matrix for public market data

From the bundle only, none received, S1.

| data | channel name for BTC | frame the bundle sends |
|---|---|---|
| perpetual book | `market_expf.btcusdt_depth_step0` | `sub` |
| perpetual trades | `market_expf.btcusdt_trade_ticker` | `req` with `top: "20"`, then `sub` one second later |
| perpetual index | `market_btcusdt_index_price` | `sub` |
| perpetual funding | `market_expf.btcusdt_funding_rate` | `sub` |
| perpetual mark candles | `market_expf.markprice.btcusdt_kline_15min` | `req` with `pageSize` |
| last and mark tickers | channels containing `usdt_ticker`, with `markprice` in the mark one | routed by the bundle's message handler |
| all-market summary | channels starting `market_review_`, keyed by symbol, with `MARKPRICE.` entries for marks | routed by the message handler |
| spot book | `market_expf.spot.btcusdt_depth_step0` | `sub` |

Only one book depth, `step0`, appears in the bundle.
Its level count is Not verified.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented, from the bundle S1 | probed, P1 |
|---|---|---|
| endpoint split axis | one URL for all products | no socket opened |
| subscribe frame shape | `{"event":"sub","params":{"channel":"market_expf.btcusdt_depth_step0","cb_id":"10001001"}}` | not sent, handshake refused |
| unknown symbol expectation | not shown | Not verified |
| chunk unit and budget | not shown | Not verified |
| keepalive mechanism | the server sends `{"ping": n}` and the client answers `{"pong": n}`, and the client reconnects after four 5 s checks without a ping | Not verified |
| connection lifetime and maintenance notice | not shown | Not verified |
| handshake and operation rate limits | not shown | HTTP 403 on every handshake from this exit |
| public market data authentication | none for market channels, a `signin` event with a token for private ones | Not verified |
| message parse and routing | JSON with `channel`, `event_rep`, `data` or `tick` | Not verified |
| subscribe acknowledgement shape | not shown | Not verified |
| symbol identifier format | lower case `btcusdt` inside the channel, prefixed by the tenant exId, matching the REST `symbol` | Not verified |
| number representation | not shown | Not verified |
| timestamp representation | not shown | Not verified |
| size unit | not shown | Not verified |
| sequence semantics | not shown | Not verified |
| idle repeat behaviour | not shown | Not verified |

Every frame from the server is binary and compressed inside the frame, since the bundle sets `binaryType = "arraybuffer"` and inflates each message with an inflate function from the vendor bundle, which holds pako, before `JSON.parse`, S1.
The engine refuses permessage deflate but would have to inflate each frame itself, see section 8.

## 4. The book channel in detail

Not verified, because no book frame was received.

- Snapshot on subscribe: Not verified.
  The bundle clears its book to empty sides before it subscribes, S1, which suggests the first frame is a full book.
- Delta semantics, sequence and gap rule, checksum: Not verified.
- Level order on the wire: Not verified.
- Size unit against CCXT `contractSize`: no CCXT class exists.
  The REST catalog's `oneLotSize` gives the contract size per symbol, from 0.001 BTC to 1,000 PEPE, see [`rest.md`](./rest.md) section 2.
- One-sided and empty books, idle repeats, unknown or closed symbols: Not verified.

## 5. Session

| item | value | source |
|---|---|---|
| keepalive | server `ping`, client `pong` with the same value | S1 |
| client silence rule | the client closes and reconnects after four 5 s checks without a ping, about 20 s | S1 |
| reconnect backoff | 1, 2, 4 and 8 s, then reset | S1 |
| compression | zlib or deflate inside each binary frame | S1 |
| handshake from this host | HTTP 403 from the CDN, or a TLS failure on the configured host | P1 |

## 6. Captured frames

No frame was captured.
The closest evidence is the refusal itself, trimmed from P1:

```text
wss://aianalysisexchange.com/v1/np/ws: HTTP 403 in 421 ms {'Content-Type': 'text/html', 'Content-Length': '2002', 'x-via': '1.1 PS-LHR-04wPd207:5 (Cdn Cache Server V2.0)'}
  body text: The following error was encountered: Invalid Request The access control configuration prevents your request at this time.
wss://www.cryptoex.aianalysis.co.uk/v1/np/ws: SSLError: [SSL: TLSV1_UNRECOGNIZED_NAME] tlsv1 unrecognized name
```

## 7. Private channels

The bundle sends `{"event":"signin","params":{"token":...}}` and `{"event":"signout"}` on the same socket, S1.
Private channel names were not collected.

## 8. Recommended feed shape

None.
No socket opened from this host, so no feed can be written or checked.
If the socket opened, the bundle's shape would need one URL, one `sub` frame per channel, a `pong` answer to each `ping`, and an inflate step before parsing, since the compression is inside the frame.
Its sequence rule is unknown, so a resync rule cannot be named.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | The live web bundle `https://aianalysisexchange.com/app.87b0b8bc.js`, 7,875,370 bytes: the socket module that exports `init`, `subscribe`, `subscribeSub` and `unsubscribe`, the tenant config module 623, and the channel strings above | 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/aia/ws-probe.py), run twice, eight requests and no open socket | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/aia/rest-probe.py) section 3, which reads the tenant config and the socket host logic from the bundle | 2026-10-09 |
