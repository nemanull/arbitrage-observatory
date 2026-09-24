# Flipster WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 06:33 to 06:51 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the WebSocket of the Flipster Trading API, which has one documented endpoint for public and private topics.
That endpoint refused the handshake from this host with HTTP 401 `{"error":"api.unauthorized"}`, because the documentation requires API key headers on the handshake itself and no key was sent, P1.
So no documented book frame was captured, and every documented axis below is the documentation's word only.
For context, the profile also records the stream that the flipster.io website opens for logged out visitors, which accepted an anonymous handshake, P2 and P3.
That stream is not part of the published API, and this profile does not recommend it as a feed.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every perpetual and spot market, public and private topics | `wss://trading-api.flipster.io/api/v1/stream`, S1 | 401 on the upgrade in 559 ms and 463 ms, with `x-prex-error-type: api.unauthorized`, P1 |
| website stream, not documented | `wss://api.flipster.io/api/v2/stream/r230522-public?mode=subscription`, read from the web client bundle, S3 | opened in 475 to 518 ms over four runs with no key, cookie or Origin header, P2, P3 |

One documented socket carries every family, since the topics are per symbol and the documentation names no second URL, S1.
All results are from the Canadian VPN exit named above.

## 2. Channel matrix for public market data

| channel | documented payload | probed |
|---|---|---|
| `orderbook.{symbol}` | "Real-time depth snapshots of the order book for a symbol", rows shaped like the REST orderbook, S1 | not reachable, 401 |
| `ticker.{symbol}` | "Real-time ticker updates (price, volume)", rows shaped like the REST ticker, which carries bid, ask, last, mark, index, funding rate, next funding time and interval, S1, S2 | not reachable, 401 |
| `kline.{interval}.{symbol}` | candlesticks, interval `1`, `15`, `1D` and others, S1 | not reachable, 401 |
| best bid and ask, trades, dedicated mark, index or funding channels | none documented | |

The website stream offered the tables `market/orderbooks-v2`, `market/orderbooks`, `market/tickers`, `market/pswaps`, `market/pswap-details`, `market/spots`, `market/spot-details`, `market/spot-tickers`, `market/currency-details` and `market/interval-data`, as its subscription echo listed them, P2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is the Trading API stream, which refused this host.
The last column is the website stream, which is undocumented and shown only to describe what Flipster serves.

| axis | documented | probed on the Trading API | website stream, undocumented |
|---|---|---|---|
| endpoint split axis | one URL for everything, S1 | 401 | one URL for every public table |
| subscribe frame shape | `{"op": "subscribe", "args": ["<topic_name>"]}`, and `unsubscribe` the same way, S1 | not reachable | `{"s": {"<table>": {"rows": ["BTCUSDT.PERP", ...]}}}`, a map of every wanted table to its rows, and `["*"]` asks for every row |
| unknown symbol expectation | Not publicly specified | not reachable | not tested |
| chunk unit and budget | Not publicly specified | not reachable | not tested beyond three symbols and one `["*"]` table |
| keepalive mechanism | Not publicly specified | not reachable | no server ping in 30 s, and no client ping was sent |
| connection lifetime and maintenance notice | Not publicly specified | not reachable | none in 30 s |
| handshake and operation rate limits | REST limits are per key in RPS and RPM, S4, and the socket's are Not publicly specified | the handshake itself is refused | not tested |
| public market data authentication | required: `api-key`, `api-expires` and `api-signature`, an HMAC-SHA256 of `GET`, the path and the expiry, sent as handshake headers, S1 | 401 `{"error":"api.unauthorized"}` | none |
| message parse and routing | `topic`, `ts`, and `data` as an array of `{actionType, rows}`, S1 | not reachable | `t.<table>.s.<symbol>`, plus `p` |
| subscribe acknowledgement shape | Not publicly specified | not reachable | an echo of the whole subscription map, `{"s": {...}, "p": ...}`, 102 to 104 ms after the subscribe |
| symbol identifier format | `BTCUSDT.PERP` inside the topic, as in `kline.1.BTCUSDT.PERP`, S1 | not reachable | `BTCUSDT.PERP` |
| number representation | decimal strings, the `Decimal` schema, S2 | not reachable | decimal strings for prices and sizes |
| timestamp representation | `ts` "high-precision", and the `Timestamp` schema is a nanosecond integer as a string, S2 | not reachable | `p` in nanoseconds as a string, such as `"1790146242043296305"` |
| size unit | Not publicly specified | not reachable | coins, see section 4 |
| sequence semantics | Not publicly specified, the book topic is described as "depth snapshots" | not reachable | none, every book frame was a whole snapshot |
| idle repeat behaviour | Not publicly specified | not reachable | a snapshot every 200 ms whether or not the book changed |

## 4. The book channel in detail

### Documented `orderbook.{symbol}`

The documentation says only that the topic pushes "Real-time depth snapshots", and that its rows match the REST orderbook, `[price, quantity]` pairs of decimal strings, S1 and S2.
Snapshot or delta semantics, depth, update id, checksum and level order are Not publicly specified, and none could be probed.
The `actionType` field is documented with the example `UPDATE`, and its other values are Not publicly specified.

### Website `market/orderbooks-v2`, for context

Measured over 25 s per run, in three runs that started at 06:43, 06:46 and 06:50 UTC, on BTC and ETH in all three and on PYTH in the last, P2 and P3.

| item | BTC | ETH | PYTH |
|---|---|---|---|
| frame parts | whole snapshot `s` only, 124 or 125 per run | same | same, 125 |
| interval between snapshots | 172 to 233 ms, median 200 | same frames | same frames |
| levels per side | 103 to 158 bids, 88 to 138 asks | 85 to 93 bids, 75 to 77 asks | 40 to 43 bids, 39 to 43 asks |
| spread at the touch | 1.2 ppm in the median snapshot, one tick of 0.1 | 3.6 ppm, one tick of 0.01 | 148.5 ppm, one tick of 0.00001 |
| notional of the smaller touch side | 150 to 760 USDT, median 253 to 257 | 151 to 446 USDT, median 229 to 237 | 28 to 96 USDT, median 57 |
| gap from the touch to the second level | median 39.3 ppm | median 54.4 to 54.5 ppm | median 148.4 ppm, one tick |
| snapshots identical to the one before, last run only | 0 of 125 | 0 of 125 | 104 of 125 |
| level order | bids descending and asks ascending in every snapshot | same | same |

Every book frame carried one table with every subscribed symbol in it, so the three books arrived together.
No sequence number or checksum was present.

### The touch of a zero spread contract

Flipster advertises "zero spreads" on its major perpetuals, defined as "Bid = Ask = Mid Price", S5.
On the wire the BTC and ETH touches were one tick wide and held 150 to 760 USDT, while the next level sat 39 ppm away on BTC and 54 ppm away on ETH.
In the frame below the BTC touch held 0.00443 BTC at 86,476.6, and the second bid held 52.03 BTC at 86,473.2.
The capture of the first run, at 06:40 UTC, held 2 BTC snapshots of 124 with bid equal to ask, and the three later runs, which counted it, held none.
PYTH, which is not on the zero spread list, showed an ordinary one tick book with no thin level in front.
If the documented topic carries the same book, the engine would read a thin quote as the touch, and its walk would reach the real book only past it.
The engine refuses a profitable region below 1,000 quote units at [`OpportunityManager.ts`](../../../server/src/engine/opportunity/OpportunityManager.ts) line 9, so a cross made only of these touches would be refused as `thin_book`.

### Size unit against CCXT `contractSize`

CCXT has no Flipster class, so there is no `contractSize` to compare, see [`fees.md`](./fees.md) section 8.
The website book's sizes are coins, since `0.00443` BTC at 86,476.6 is 383 USDT and `2690` PYTH at 0.06739 is 181 USDT, which are plausible touch sizes and implausible as contracts of any other unit.
That reading is an inference, and the documented topic's unit is Not publicly specified.

### One-sided, empty, unknown and closed symbols

None was observed or tested on either stream.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | Trading API not reachable. The website stream sent no protocol ping in 30 s |
| silence the server tolerates | Not publicly specified | not tested |
| forced disconnect | Not publicly specified | none on the website stream in 30 s |
| maintenance notice | Not publicly specified | none |
| compression | Not publicly specified | the website stream sent text JSON with `perMessageDeflate` off, and negotiated no extension |
| handshake | HMAC headers on the upgrade, S1 | 401 on the Trading API, 475 to 518 ms opens on the website stream |
| subscription limits | Not publicly specified | not tested |
| throughput | | website stream, three books and three tickers: 251 frames and 1.43 MB in 25 s, about 5.7 KB per frame |

## 6. Captured frames

Trimmed, from the website stream run at 06:50 UTC, P3.
Nothing from the documented stream could be captured beyond its refusal.

Handshake refusal from the documented stream.

```json
{"status": 401, "headers": {"content-type": "application/json", "x-prex-error-type": "api.unauthorized", "server": "cloudflare"}, "body": {"error": "api.unauthorized"}}
```

Website subscribe frame.

```json
{"s": {"market/orderbooks-v2": {"rows": ["BTCUSDT.PERP", "ETHUSDT.PERP", "PYTHUSDT.PERP"]}, "market/tickers": {"rows": ["BTCUSDT.PERP", "ETHUSDT.PERP", "PYTHUSDT.PERP"]}}}
```

Website subscription echo, private tables cut.

```json
{"s":{"market/interval-data":{"rows":[]},"market/pswaps":{"rows":[]},"market/tickers":{"rows":["PYTHUSDT.PERP","BTCUSDT.PERP","ETHUSDT.PERP"]},"market/orderbooks":{"rows":[]},"market/orderbooks-v2":{"rows":["ETHUSDT.PERP","PYTHUSDT.PERP","BTCUSDT.PERP"]},"private/account":{"rows":[]}},"p":"1790146242000776153"}
```

Website book snapshot, first three levels per side kept.

```json
{"t":{"market/orderbooks-v2":{"s":{"PYTHUSDT.PERP":{"bids":[["0.06739","2690"],["0.06738","3110"],["0.06737","8660"]],"asks":[["0.06742","420"],["0.06743","350"],["0.06744","490"]]},"ETHUSDT.PERP":{"bids":[["2754.96","0.137"],["2754.81","199.55"],["2754.8","0.684"]],"asks":[["2754.97","0.069"],["2755.12","60.808"],["2755.13","0.403"]]},"BTCUSDT.PERP":{"bids":[["86476.6","0.00443"],["86473.2","52.03014"],["86473.1","0.09325"]],"asks":[["86476.7","0.00351"],["86480.1","1.99858"],["86480.2","0.87207"]]}}}},"p":"1790146242043296305"}
```

Website ticker, one symbol kept.

```json
{"t":{"market/tickers":{"s":{"BTCUSDT.PERP":{"midPrice":"86476.65","markPrice":"86501.3","indexPrice":"86505.3","fundingRate":"0.000061310383795137","fundingTime":"1790150400000000000","priceChange24h":"1061.5","priceChangePct24h":"1.242753773774324578","high24h":"87255.95","low24h":"85134.6","volume24h":"545.53802","turnover24h":"47067598.1579882","openInterest":"234.584098","openInterestInUsdt":"20286046.9383117"}}}},"p":"1790146242038985677"}
```

No keepalive answer or error frame was seen on the website stream.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL and the same signed handshake.

- `account`, `account.margin`, `account.balance` and `account.position`.
- No order entry over the socket is documented.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| now | no feed | the only documented stream refuses a handshake without a key, and keys come only from the private launch, S1 and S4 |
| website stream | do not use it for the engine | it is not a published API, its protocol belongs to the web client, and it can change with any web release |
| with a read key | first capture `orderbook.{symbol}` for its snapshot, delta, id and depth rules | none of them is documented |
| handshake | the base `VenueFeed` opens a socket with no headers at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81, so a Flipster feed would need signed `api-key`, `api-expires` and `api-signature` headers on every connect | S1 |
| touch | treat a one tick touch on a zero spread contract as the thin quote it is, and check how the walk and the `thin_book` rule see it | section 4 |
| deflate | keep `perMessageDeflate: false` | nothing is known about the documented stream |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Flipster API Documentation, Web Socket | https://api-docs.flipster.io/web-socket.md | 2026-09-23 UTC | Flipster Corp | URL, signed handshake, topics, envelope, private topics, sections 1 to 8 |
| S2 | Flipster API Documentation, Get Orderbook and Get Tickers | https://api-docs.flipster.io/api-reference/market/get-orderbook.md | 2026-09-23 UTC | Flipster Corp | row shapes, `Decimal` and `Timestamp` schemas, sections 2 to 4 |
| S3 | flipster.io web client, release `release-web-3.38.101`, read with curl | https://flipster.io/trade/perpetual/BTCUSDT.PERP | 2026-09-23 UTC | Flipster Corp | the website stream URL, its tables and its subscribe shape, sections 1 to 3 |
| S4 | Flipster API Documentation, Introduction | https://api-docs.flipster.io/readme.md | 2026-09-23 UTC | Flipster Corp | private launch, rate limit policy, sections 3 and 8 |
| S5 | Understanding Zero Spreads Trading, updated 2026-02-15 | https://support.flipster.io/hc/en-us/articles/13270529471247-Understanding-Zero-Spreads-Trading | 2026-09-23 UTC | Flipster Corp | the zero spread promise and pair list, section 4 |
| P1 | `ws-probe.mjs api`, runs at 06:40 and 06:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/flipster/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | the 401 refusal, sections 1, 3 and 6 |
| P2 | `ws-probe.mjs web`, runs that started at 06:40, 06:43 and 06:46 UTC, and `catalog` at 06:41 and 06:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/flipster/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | website tables, book shape, sections 1 to 5 |
| P3 | `ws-probe.mjs web`, the second pass run that started at 06:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/flipster/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | book table and frames quoted, sections 4 to 6 |
