# Feather Exchange WebSocket Profile

**Status:** Done.
Feather Exchange lists no perpetuals, so this profile covers its spot socket, as change 1 of the survey plan's template says.
The socket is undocumented and was read from the `ftrex.io` web app bundle.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:39 to 04:54 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada (Vancouver, AS212238).

Socket numbers come from [`ws-probe.py`](../../../scripts/probes/venues/feather/ws-probe.py), whose second pass run, from 04:48:57 UTC, is the one cited unless a line says run 1, which started at 04:40:39 UTC.
REST numbers come from [`rest-probe.py`](../../../scripts/probes/venues/feather/rest-probe.py) and are in [`rest.md`](./rest.md).
Sockets were held about 8 minutes in total across both runs and the first exploration.

## 1. Endpoints

- Raw WebSocket: `wss://ftrex.io/api/market/market-ws/websocket`, carrying STOMP 1.2 text frames.
- SockJS framed WebSocket: `wss://ftrex.io/api/market/market-ws/<server>/<session>/websocket`, the same STOMP frames wrapped in SockJS `o` and `a[...]` frames, and no `h` heartbeat frame came in the 10 s held.
  The web app uses this one through its SockJS client, and `GET /api/market/market-ws/info` answers `{"entropy":...,"origins":["*:*"],"cookie_needed":true,"websocket":true}`.
- One socket carries every spot pair.
  There is no perpetual socket, because there is no perpetual, see [`fees.md`](./fees.md) section 3.
- The edge is the same AWS load balancer as REST, and the handshake needs a browser User-Agent, see [`rest.md`](./rest.md) section 1.
  The probe also sends `Origin: https://ftrex.io`.

## 2. Channel matrix for public market data

The topics come from the web bundle, S1, and the ones marked probed were subscribed.

| topic | content | probed |
|---|---|---|
| `/topic/market/trade-plate/{symbol}` | one side of the book, 20 levels, full side every push | yes, all 10 pairs |
| `/topic/market/thumb` | 24 hour ticker for one pair per frame, all pairs on one topic | yes |
| `/topic/market/trade/{symbol}` | public trades as a JSON array | yes, BTC_USDT |
| `/topic/market/kline/{symbol}/{resolution}` | candles | no |
| `/topic/market/daily-price-limits/{symbol}` | price band | no |
| best bid and ask only | Not offered | no such topic in the bundle |
| mark, index, funding | Not offered | no perpetual |

## 3. The sixteen axes

The axes of [`../../research/2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The perpetual column has no Feather value, because Feather has no perpetual.
Nothing is documented, so the probed column is the only value.

| axis | perpetuals | spot `trade-plate`, probed |
|---|---|---|
| transport framing | none | STOMP 1.2 text frames on a raw WebSocket, or the same inside SockJS framing |
| endpoint per family | none | one URL for all 10 spot pairs |
| subscribe frame | none | STOMP `CONNECT` first, then `SUBSCRIBE` with `id:sub-<n>` and `destination:/topic/market/trade-plate/BTC_USDT`, one frame per topic |
| subscribe acknowledgement | none | none. `CONNECT` gets `CONNECTED` with `version:1.2` and `heart-beat:0,0`, and `SUBSCRIBE` gets no receipt unless one is asked for |
| snapshot on subscribe | none | every frame is a full side, and the first came 0.46 to 0.63 s after subscribing |
| delta semantics | none | none, each frame replaces one side |
| sequence and gap rule | none | no sequence and no timestamp in the body. The STOMP `message-id` ends in a counter shared by every session on the server, so it steps by 1 to 17 between one socket's frames and cannot detect a gap |
| checksum | none | none |
| level order | none | `items` as `{"price","amount"}` objects, bids (`"direction":"BUY"`) descending and asks (`"direction":"SELL"`) ascending, 119 of 119 frames per side in order |
| size unit | none | base asset, the same sizes as the REST book, which equals Binance's book |
| symbol spelling | none | `BTC_USDT`, the catalog's `symbol` |
| keepalive | none | the server answers `heart-beat:0,0` to a request for 10000,10000 and sends no heartbeats. A bare EOL from the client every 20 s kept an idle socket open 100 s |
| silence tolerated | none | 60.0 s. An idle socket with no subscription and nothing sent was closed with code 1006 after 60.0 s, in both runs |
| compression | none | permessage-deflate was offered and not accepted, no `Sec-WebSocket-Extensions` header came back |
| limits | none | none published. Thirteen subscriptions on one socket, 12 of them on real topics, all streamed |
| errors | none | an unknown symbol, `FOO_USDT`, is accepted silently and never sends a frame. No `ERROR` frame was seen |

## 4. The book channel in detail

- Each `trade-plate` frame is one side of one pair: `{"direction","symbol","items":[{"price","amount"}],"highestPrice","lowestPrice","maxAmount","minAmount"}`, prices and sizes as JSON numbers.
  `highestPrice` and `lowestPrice` are the ends of the 20 levels, and `maxAmount` and `minAmount` are the largest and smallest size among them.
- Every frame carried exactly 20 levels, on every pair and both sides, in both runs.
- Both sides of every pair are pushed on a timer, a median 0.503 s apart, from 0.477 to 0.529 s on most pairs and 0.322 s at the least.
  In 60 s each side sent 119 or 120 frames.
- The push repeats the side even when nothing changed.
  FTR_USDT repeated an identical side 118 of 119 times on bids and 116 times on asks, and BTC_USDT repeated 28 and 47 times.
- There is no sequence, no update id and no exchange timestamp in a book frame, so a feed cannot detect a missed frame.
  Because every frame is a full side, a missed frame only costs freshness.
- The two sides of a pair arrive as two frames, so a reader that joins them can see a bid from one push and an ask from the previous one.
  The first BTC_USDT pair of frames was not crossed, best bid 82668.39 and best ask 82668.40.
- A one-sided or empty book was not seen.
  An unknown symbol sends nothing, and the REST book answers an unknown symbol with two empty sides, see [`rest.md`](./rest.md) section 5.
- The externally matched books are Binance's spot books, see [`rest.md`](./rest.md) section 5, so this channel is Binance's top 20 resampled every 0.5 s.

## 5. Session

- Handshake: HTTP 101 in 686 ms, with two `AWSALB` load balancer cookies.
- STOMP heart-beating is refused, the server answers `heart-beat:0,0`, and no heartbeat frame came from the server.
- The load balancer closes a socket after 60 s with no traffic in either direction, code 1006 with no close frame, which fits an AWS load balancer's default idle timeout.
  A subscribed socket never goes silent, since every subscribed side pushes every 0.5 s.
- A bare `\n` sent every 20 s held an unsubscribed socket for 100 s, so a client keepalive works.
- `DISCONNECT` with `receipt:bye` got `RECEIPT` with `receipt-id:bye` in run 1, and in the second pass a queued `MESSAGE` arrived first.
- No maintenance notice, forced disconnect or compression was seen.

## 6. Captured frames

`CONNECT` answer, both runs:

```text
CONNECTED
version:1.2
heart-beat:0,0
```

A book frame, BTC_USDT asks, with the STOMP headers from the first exploration at 04:39 UTC and the body from the second pass, trimmed to the first two of 20 levels and reformatted onto two lines:

```text
MESSAGE
destination:/topic/market/trade-plate/BTC_USDT
content-type:application/json
subscription:sub-0
message-id:c6ef24db-804a-edff-2f92-ff4c1c61866f-61570246
content-length:1253

{"minAmount":0.00007,"highestPrice":82671.66,"symbol":"BTC_USDT","lowestPrice":82668.40,"maxAmount":13.48043,
 "items":[{"price":82668.40,"amount":13.48043},{"price":82668.41,"amount":2.92650}, ...],"direction":"SELL"}
```

A public trade frame on `/topic/market/trade/BTC_USDT`, with the reference order ids and null members that mark a trade copied from outside:

```json
[{"symbol":"BTC_USDT","price":82668.39,"amount":0.00028,"turnover":23.32,
  "buyOrderId":"REF-BUY-1791607740757","sellOrderId":"REF-SELL-1791607740757",
  "buyMemberId":null,"sellMemberId":null,"direction":"SELL","time":1791607740757,
  "buyerFee":null,"sellerFee":null}]
```

A thumb frame on `/topic/market/thumb`, one pair per frame:

```json
{"symbol":"XRP_USDT","open":1.3828,"high":1.4100,"low":1.3800,"close":1.4061,"guidancePrice":null,
 "chg":0.0169,"change":0.0233,"volume":5134802.1000,"turnover":7158845.7947,"lastDayClose":1.3828,
 "usdRate":1.4061,"baseUsdRate":1,"zone":1,"coinScale":1,"baseCoinScale":4}
```

SockJS framing of the same `CONNECTED`, in the `sockjs` mode:

```text
o
a["CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\u0000"]
```

No keepalive answer and no error frame exist to capture, see section 5 and the errors axis.

In 60 s the second pass saw 141 thumb frames and 27 trade frames for BTC_USDT.

## 7. Private channels

The bundle subscribes `/topic/market/order-accepted/{symbol}/{id}`, `/topic/market/order-completed/{symbol}/{id}`, `/topic/market/order-canceled/{symbol}/{id}` and `/topic/market/order-trade/{symbol}/{id}` on the same socket, S1.
The second segment is presumably the member id.
They were not probed.

## 8. Recommended feed shape

None for the engine, because Feather has no perpetual.
For a future spot leg it would be one raw WebSocket to `wss://ftrex.io/api/market/market-ws/websocket` with a browser User-Agent, STOMP `CONNECT`, one `SUBSCRIBE` per pair on `/topic/market/trade-plate/{symbol}`, and each frame replacing one side.
`maxSilenceMs` of about 5,000 would cover the 0.5 s push, and a bare EOL every 20 s covers the 60 s idle timeout.
There is no resync rule to write, because every frame is a full 20 level side.
The 8 EXTERNAL pairs would only repeat Binance's book.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://ftrex.io/_next/static/chunks/6120-56f17e2b10c808ea.js`, the web bundle on 2026-10-10 | the socket path, the STOMP client, every topic name |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/feather/ws-probe.py) | every probed line above |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/feather/rest-probe.py) | the REST book and the comparison with Binance |
