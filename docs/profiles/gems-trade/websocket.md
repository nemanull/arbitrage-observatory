# Gems Trade WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

Gems Trade lists no perpetuals, so this profile covers the spot book channel, per change 1 of the survey plan's template.
Gems Trade publishes no API documentation that this research could find, and no web search turned any up.
Everything below comes from the live web bundle and from [`ws-probe.py`](../../../scripts/probes/venues/gems-trade/ws-probe.py), which held sockets for about three and a half minutes per full run and about seven and a half minutes in all.
The socket server is Openware's Ranger, part of the OpenDAX stack, see [`rest.md`](./rest.md) section 2.
[`../safetrade/websocket.md`](../safetrade/websocket.md) describes another OpenDAX venue, whose socket was refused from this host.

## 1. Endpoints

| URL | role | result from this host, P1 section 1 |
|---|---|---|
| `wss://www.gems.trade/api/v2/ranger/public/?stream=<name>&stream=<name>` | public market data, every spot market | HTTP 101 with a full Firefox user agent, through CloudFront to an `envoy` server |
| the same URL with a bare `Mozilla/5.0` user agent | | HTTP 403, CloudFront's "Request blocked" page |
| the same URL with the `websockets` library's default user agent | | HTTP 403, the same page |
| `wss://www.gems.trade/api/v2/ranger/private/` | private streams, used by the web app when signed in | not opened |

The bundle builds the URL from `REACT_APP_WSS_BASE_URL` `wss://www.gems.trade` plus `/api/v2/ranger`, S1.
One socket carries every spot market, since the venue has no other product.

## 2. Channel matrix for public market data

| data | stream name for BTC/USDT | probed |
|---|---|---|
| order book, raw, 25 levels per side | `btcusdt.update-1`, in general `<market>.update-<price_precision>` | yes, P1 sections 2 and 3 |
| order book, raw, 400 levels per side | `btcusdt.update`, in general `<market>.update` | yes, P1 section 3b |
| order book, price-grouped | `<market>.update-<n>` with `n` below the market's `price_precision`, and `<market>.update-10` | yes, P1 section 3 |
| buy and sell volume totals | `btcusdt.d-v`, two numbers that the web app draws as a buy and sell ratio bar | yes, P1 section 6 |
| ticker | `btcusdt.ticker` | yes, P1 section 6 |
| trades | `btcusdt.trades` | yes, P1 section 6 |
| candles | `btcusdt.kline-<period>`, periods `1m` to `1w` | named in the bundle only, S1 |
| all-market tickers | `global.tickers` | yes, P1 section 6 |
| mark, index, funding | Not offered | no perpetuals |

The web app subscribes `<market>.update-<selected precision>` on a socket of its own, after a REST depth call with `limit=30`, and replaces its whole book with each frame, S1.
Openware's documented incremental stream names `ob-inc` and `ob-snap`, and the name `depth`, were acknowledged and then silent for 6 s, P1 section 3b.
The plain `<market>.update`, which the bundle never uses, sends a whole book of 400 levels per side in each frame, P1 section 3b.

## 3. The sixteen axes

| axis | documented | probed, P1 |
|---|---|---|
| endpoint split axis | none published. The bundle uses one public URL. | one URL for every market |
| subscribe frame shape | none published. The bundle puts streams in the URL query. | `?stream=a&stream=b` in the URL, or `{"event":"subscribe","streams":["ethusdt.update-2"]}` on an open socket |
| unknown symbol expectation | not documented | `foousdt.update-1` is acknowledged as subscribed and then silent, and so are unserved names such as `btcusdt.ob-inc` |
| chunk unit and budget | not documented | 20 streams in one 529 character URL all delivered, a higher cap was not tested |
| keepalive mechanism | not documented | a protocol ping gets a pong in about 160 ms, and a text `ping` gets the text `pong` |
| connection lifetime and maintenance notice | not documented | a socket with no stream and no client ping stayed open for 75 s, longer lifetimes were not tested |
| handshake and operation rate limits | not documented | none hit, and the CloudFront firewall refuses a bare or library user agent |
| public market data authentication | none | none |
| message parse and routing | not documented | JSON text frames, one object whose single key is the stream name |
| subscribe acknowledgement shape | not documented | `{"success":{"message":"subscribed","streams":[...]}}`, listing every stream asked for |
| symbol identifier format | not documented | the catalog `id`, lower case base and quote, `btcusdt` |
| number representation | not documented | on `update-<n>`, prices and sizes are strings, sizes often in exponent notation such as `"1.02e-05"`, and grouped sizes carry float noise such as `"0.046654640000000004"`. On the plain `update`, prices are JSON numbers, `82706` or `82705.6`, and sizes are strings with no exponent. |
| timestamp representation | not documented | no timestamp in a book frame |
| size unit | not documented | base currency, the same as the REST depth |
| sequence semantics | not documented | none, every frame is a whole book, 25 levels per side on `update-<price_precision>` and 400 on `update` |
| idle repeat behaviour | not documented | 44 of 266 and 62 of 232 btcusdt `update-1` frames repeat the previous frame exactly, none of 90 `update` frames did, and quiet markets send a frame about every 3 s |

## 4. The book channel in detail

| item | value | evidence |
|---|---|---|
| snapshot on subscribe | yes, every frame is a full book | P1 section 2 |
| delta semantics | none, a frame replaces the book | P1 section 2, S1 |
| sequence and gap rule | none, so no gap can be detected and none needs a resync | P1 section 2 |
| checksum | none | P1 section 2 |
| depth | 25 levels per side on `btcusdt.update-1` in every frame of both runs, and 400 per side on `btcusdt.update` in every one of 90 frames | P1 sections 2 and 3b |
| frame size | median about 1,210 to 1,230 characters on `update-1`, and about 17,670 on `update` | P1 sections 2 and 3b |
| level order | asks ascending and bids descending in every frame, with no crossed frame | P1 section 2 |
| cadence | on btcusdt `update-1`, 266 and 232 frames in 30 s over two runs, median gap 100 ms, 90th percentile 197 and 201 ms, longest 398 and 700 ms. The plain `update` came at the same rate, 90 frames beside 90 in 10 s. | P1 sections 2 and 3b |
| suffix rule | `update-<price_precision>` is the raw book: `update-1` for btcusdt at precision 1, `update-2` for ethusdt at 2, `update-4` for xrpusdt at 4. A smaller `n` groups prices to `n` decimals, and one or two more than the precision sends nothing. `update-10` groups btcusdt and ethusdt prices to tens and sent nothing for xrpusdt. | P1 section 3, catalog `price_precision` in [`rest.md`](./rest.md) section 2 |
| size unit | base currency, matching the REST depth sizes | P1 section 2 |
| thin books | the non-upstream `gemsusdt` had 34 or 35 asks and 12 bids in REST, and its stream sent 7 frames in 20 s in both runs | [`rest.md`](./rest.md) section 5, P1 section 4 |
| unknown or closed symbol | acknowledged, then silent, so a feed must validate against the catalog | P1 section 5 |
| agreement with REST | the last btcusdt frame and a REST depth call right after had the same best bid and ask prices in both runs | P1 section 2 |
| agreement between streams | the last `update` and `update-1` frames had the same top prices and sizes, with the price as a number in one and a string in the other | P1 section 3b |

The 73 markets flagged `upstream` track Binance spot within about 2 bp at the top of the book, with smaller sizes, see [`rest.md`](./rest.md) section 5.

## 5. Session

| item | value | source |
|---|---|---|
| keepalive | protocol ping and pong, or the text `ping` answered by `pong` | P1 section 7 |
| server silence tolerance | at least 75 s with no stream and no client ping | P1 section 7 |
| forced disconnects | none seen in about seven and a half minutes of sockets | P1 |
| maintenance notices | none seen | P1 |
| compression | permessage-deflate offered and not accepted, frames are plain text | P1 section 1 |
| handshake | needs a browser-like user agent because of the CloudFront firewall | P1 section 1 |
| bad input | a frame that is not JSON gets `{"error":"Could not parse message: ..."}` and the socket stays open | P1 section 5 |
| web client reconnect | 3 s after an unclean close | S1 |

## 6. Captured frames

From P1, trimmed.

Subscribe acknowledgement, for streams in the URL:

```json
{"success":{"message":"subscribed","streams":["btcusdt.update-1"]}}
```

A book frame, which is also the snapshot, cut to three of 25 levels per side, from run 2:

```json
{"btcusdt.update-1":{"asks":[["82712.8","1.21096646"],["82713.0","0.3534745"],["82713.1","0.25414902"]],"bids":[["82712.7","0.15633187"],["82712.6","0.52666451"],["82711.0","0.06151307"]]}}
```

The plain `btcusdt.update` frame has the same shape with 400 levels per side and numeric prices, such as `[82706,"0.21384715"]`.

Unsubscribe acknowledgement, which lists the streams left:

```json
{"success":{"message":"unsubscribed","streams":[]}}
```

Keepalive answer to the text `ping`:

```text
pong
```

Error for a frame that is not JSON:

```json
{"error":"Could not parse message: invalid character 'o' in literal null (expecting 'u')"}
```

## 7. Private channels

The web app opens `wss://www.gems.trade/api/v2/ranger/private/` when signed in and subscribes `order`, `trade`, `balance`, `deposit`, `withdraw`, `position` and about twenty more names, S1.
They need a Barong session and were not opened.

## 8. Recommended feed shape

No feed is recommended, because the venue lists no perpetuals.
A future spot leg could use this shape.

| item | value |
|---|---|
| URL plan | `wss://www.gems.trade/api/v2/ranger/public/?stream=<id>.update-<price_precision>&...`, with a full browser user agent |
| markets per connection | 20 verified, which covers 20 of 80, so four sockets or a test of the URL length cap |
| subscribe frames | none needed beyond the URL, or `{"event":"subscribe","streams":[...]}` |
| keepalive | a protocol ping every 30 s |
| book handling | `resetBook` and every level on each frame, then `publish` |
| `maxSilenceMs` | about 15 s, because quiet markets send a frame about every 3 s |
| resync | reconnect on close or silence, there is no sequence to check |
| depth | 25 levels per side, which covers the engine's 20 |
| alternative | `<id>.update` gives 400 levels per side with no `price_precision` lookup, at about 14 times the bytes, and its prices are JSON numbers |

The feed would need the catalog's `price_precision` per market to build the stream name, and it must drop markets the catalog does not list, since an unknown name fails silently.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | The live web bundle `https://www.gems.trade/static/js/main.8509b138.js`, 7,834,291 bytes: the config with `REACT_APP_WSS_BASE_URL`, the stream list builder, and the order book socket hook in chunk `https://www.gems.trade/static/js/861.bf321517.chunk.js` | 2026-10-09 |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/gems-trade/ws-probe.py), run twice in full, and section 3b, added after the first run, run twice more on its own | 2026-10-09 |
