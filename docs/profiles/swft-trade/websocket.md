# SWFT Trade WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 03:20 to 03:26 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada.

SWFT Trade lists no perpetuals, so the researched product is its spot market, see [`fees.md`](./fees.md) section 3.
The venue documents no WebSocket at all, and none was found.
Its only market data interface is the partner REST API described in [`rest.md`](./rest.md), which needs an issued channel number and key for every call.
Every probed fact below comes from [`ws-probe.py`](../../../scripts/probes/venues/swft-trade/ws-probe.py), which held sockets for a few seconds in total.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| perpetuals | Not offered | not applicable |
| spot | none documented | no `ws://` or `wss://` URL and no use of the word "websocket" in the documentation index, the `swft.pro` page and bundle, or the `swftc.info` page and its two scripts, S1 and S2 |

Four guessed paths on the API host `www.swftc.info` were each tried with one opening handshake, S2.

| guessed URL | result |
|---|---|
| `wss://www.swftc.info/ws` | HTTP 404 from `nginx/1.24.0`, body `{"timestamp":"...","path":"/ws","status":404,"error":"Not Found",...}` |
| `wss://www.swftc.info/websocket` | HTTP 404, same shape |
| `wss://www.swftc.info/market/ws` | HTTP 404, same shape |
| `wss://www.swftc.info/marketApi/ws` | HTTP 200 with body `{"resCode":"901","resMsg":"请求参数不全"}`, "request parameters incomplete", which is the partner API's parameter check answering every `/marketApi/` path, not an upgrade |

No guessed path upgraded to a WebSocket.

## 2. Channel matrix for public market data

None.
No book, best bid and ask, trade, ticker, mark, index or funding channel is documented or was found.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Every row has the same answer, so the table is collapsed into one statement.
Documented value: none, since the venue documents no WebSocket.
Probed value: none, since no handshake upgraded.
That holds for the endpoint split axis, subscribe frame shape, unknown symbol expectation, chunk unit and budget, keepalive mechanism, connection lifetime and maintenance notice, handshake and operation rate limits, public market data authentication, message parse and routing, subscribe acknowledgement shape, symbol identifier format, number representation, timestamp representation, size unit, sequence semantics and idle repeat behaviour.

## 4. The book channel in detail

There is no book channel.
The nearest thing is the partner REST call `POST /marketApi/depth`, which returns `buyOrders` and `sellOrders` as `[price, amount]` string pairs at a chosen aggregation level, S3.
It carries no sequence, checksum or timestamp in its documented reply, see [`rest.md`](./rest.md) section 5.

## 5. Session

Not applicable, since no socket exists.

## 6. Captured frames

No frame was captured.
The refusal bodies in section 1 are the whole capture.

## 7. Private channels

None documented.
The TRADE API serves balances, orders and cancels over the same signed REST calls, S3.

## 8. Recommended feed shape

No feed can be built.
The venue has no perpetuals, no WebSocket, and no public REST book.
A spot book could only be polled through `POST /marketApi/depth` by a partner holding an issued `channelId` and key, and this survey uses no credentials.

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S1 | SWFT API documentation index, `https://docs-swft.en.swft.pro/llms.txt`, and its 29 pages, read by [`ws-probe.py`](../../../scripts/probes/venues/swft-trade/ws-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/swft-trade/rest-probe.py) | 2026-10-10 UTC | no WebSocket documented |
| S2 | `https://www.swft.pro/`, `https://www.swft.pro/assets/index-D2dAJI4F.js`, `https://www.swftc.info/swft-v3/swft-v3-pc/index.html`, `/swft-v3/js/index/index.js`, `/swft-v3/main/js/all.min.js`, and the four handshakes, read by [`ws-probe.py`](../../../scripts/probes/venues/swft-trade/ws-probe.py) | 2026-10-10 UTC | no socket URL in the front ends, the handshake refusals |
| S3 | `https://docs-swft.en.swft.pro/trade-api/get-market-depth.md` and `trade-api/swft-trade-interface.md` | 2026-10-10 UTC | the REST depth call and the partner requirement |
