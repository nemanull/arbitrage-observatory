# Tokpie WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Seattle time (04:39 and 04:45 UTC on 2026-09-23, the second run being the second pass), from the development host near Seattle through its Surfshark WireGuard exit, which geolocates to Canada (Cloudflare trace `loc=CA`, edge `SEA` or `YVR`).

This profile covers the public WebSocket of Tokpie, a spot only venue, see [`fees.md`](./fees.md) section 3.
The API page S1 documents one socket, and it carries trades only, with no book channel.
The documented socket did not open from this host.
Every upgrade request got HTTP 500 in [`ws-probe.mjs`](../../../scripts/probes/venues/tokpie/ws-probe.mjs).
So every protocol row below gives the documented value and says the probe could not reach it.
All access results are from the Canadian VPN exit.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| spot | `ws://tokpie.com:8222`, plain text, no TLS, S1 | TCP connects in 180 and 183 ms, and the upgrade answers `HTTP/1.1 500 Internal Server Error` with body `Internal Server Error` in 349 to 384 ms, on all ten attempts over two runs, P5 |
| spot, TLS on the same port | not documented | the opening handshake timed out after 20 s in both runs, P5 |
| spot, `wss://tokpie.com/ws` | not documented | 404 from `nginx/1.4.6 (Ubuntu)` with the site's HTML error page in both runs, P5 |

The ten 500 replies covered the paths `/`, `/ws`, `/websocket` and `/socket.io/?EIO=3&transport=websocket`, an `Origin: https://tokpie.com` header, and an offer of permessage-deflate, and every one was the same, P5.
A plain HTTP GET to the same port, with no upgrade headers, also answered 500 in 350 ms, P5.
The exchange's own login page at `tokpie.com` loads five script bundles, and neither the page nor the bundles hold a `ws://` or `wss://` URL, while the bundles name 24 `/ajax_…` routes, P5.
So nothing observed from this host uses a WebSocket at all.

## 2. Channel matrix for public market data

| channel | documented payload | depth and speed | probed |
|---|---|---|---|
| `tradeHistory:<pair>` | `{"op":"subscribe","args":["tradeHistory:OMG@ETH"]}`, or `{"sws_operation":"swsOperationSubscribe","sws_pair":"OMG@ETH"}`, S1 | on trade, after "a snapshot of the last 24 recent trades", S1 | not reached, the socket answered 500 |
| book, best bid and ask, ticker | not documented | | not reached. The probe was written to try a guessed `orderBook:<pair>` topic had the socket opened |
| mark, index, funding | none, spot only | | |

S1 gives two subscribe shapes for the same trade topic without saying which the server reads.
The REST book is the only book source Tokpie documents, see [`rest.md`](./rest.md) section 5.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The probed column is empty of protocol facts because no socket opened, P5.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, `ws://tokpie.com:8222`, S1 | the URL answers HTTP 500 to every upgrade |
| subscribe frame shape | `{"op":"subscribe","args":["tradeHistory:<pair>"]}`, and a second shape `{"sws_operation":"swsOperationSubscribe","sws_pair":"<pair>"}`, S1 | not reached |
| unknown symbol expectation | Not publicly specified | not reached |
| chunk unit and budget | Not publicly specified | not reached |
| keepalive mechanism | "send a ping frame before you reach the 90 second timeout", S1 | not reached |
| connection lifetime and maintenance notice | "Every WebSocket session is live for 90 seconds. After 90 seconds of inactivity, you will be disconnected.", S1. No maintenance notice documented | not reached |
| handshake and operation rate limits | Not publicly specified | not reached |
| public market data authentication | none, S1 | the refusal is HTTP 500, not 401 or 403 |
| message parse and routing | `{"topic": "tradeHistory:OMG@ETH", "data": [...]}`, route on `topic`, S1 | not reached |
| subscribe acknowledgement shape | Not publicly specified | not reached |
| symbol identifier format | `BASE@QUOTE`, "The market names can be obtained from ticker API", S1 | the REST spelling is `ETH@USDT`, see [`rest.md`](./rest.md) section 2 |
| number representation | `aht_volume` and `aht_price` as JSON numbers in the sample, S1 | not reached |
| timestamp representation | `aht_datetime` as `20.01.2021 10:54:18 UTC`, printed without quotes in the sample, so the sample is not valid JSON, S1 | not reached |
| size unit | base currency, S1 | not reached |
| sequence semantics | none documented, `aht_id` is a per pair trade id, S1 | not reached |
| idle repeat behaviour | Not publicly specified | not reached |

## 4. The book channel in detail

Tokpie documents no WebSocket book channel, S1.
So there is no snapshot on subscribe, no delta, no sequence and no checksum to describe.

The engine's feed contract needs a socket that delivers a book, with a snapshot on subscribe or a per symbol sequence, through the abstract members at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 387 to 390 and the resync at line 296, and Tokpie offers neither.
The nearest substitute is polling `GET /api_order_book_v2/?market=<pair>&depth=20`, which has no update id, lists both sides in descending price order, and returned 1, 1 and 2 distinct `ETH@USDT` books over three runs of 58 to 60 polls, see [`rest.md`](./rest.md) section 5.

| property | documented | observed on the REST book |
|---|---|---|
| snapshot on subscribe | no socket book | every REST reply is a whole snapshot |
| level order on the wire | | bids descending, asks descending, best ask last |
| size unit | base currency, S1 | base currency, and no contract size applies |
| one-sided and empty books | | 2 unfrozen pairs had no two sided book, and frozen pairs return `null` best prices in the ticker |
| unknown symbol | | `{"is_ok": false, "error_code": "API_ORDER_BOOK_V2_ERROR_MARKET_NOT_FOUND"}` with HTTP 200 |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | a client ping frame before 90 s, S1 | not reached |
| silence the server tolerates | 90 s of inactivity, S1 | not reached |
| forced disconnect | Not publicly specified | not reached |
| maintenance notice | Not publicly specified | not reached |
| compression | Not publicly specified | offering permessage-deflate got the same 500, so nothing was negotiated |
| handshake | plain `ws://`, S1 | TCP 180 to 183 ms, then HTTP 500 at 349 to 384 ms |
| subscription limits | Not publicly specified | not reached |

## 6. Captured frames

No WebSocket frame was captured, because no socket opened.
The reply to the documented upgrade, identical on every attempt of P5, as `curl -i` also printed it.

```text
HTTP/1.1 500 Internal Server Error
Connection: close
Content-Type: text/plain

Internal Server Error
```

The documented subscribe frame and trade message, from S1, are not captures.
The sample message is reproduced with `aht_datetime` quoted, since S1 prints it bare.

```json
{"op": "subscribe", "args": ["tradeHistory:OMG@ETH"]}
```

```json
{"topic": "tradeHistory:OMG@ETH", "data": [{"pair": "OMG@ETH", "aht_type": "SELL", "aht_volume": 100.07, "aht_price": 3.83, "aht_id": 225280, "aht_datetime": "20.01.2021 10:54:18 UTC"}]}
```

## 7. Private channels

No private WebSocket channel is documented, S1.
Order entry is a REST route, `add_order`, called as `https://tokpie.com/api_add_order/?api_key=…&pair=…&type=…&volume=…&price=…&expire_tm=…`, with the key in the query string, S1.
The page lists it as a POST but its call example is a GET URL.
It was not probed.

## 8. Recommended feed shape

None.
The documented socket answers HTTP 500, and the only channel it documents carries trades, so no WebSocket book feed can be built for Tokpie.
A REST polled book is possible on paper, see [`rest.md`](./rest.md) section 5, but it has no sequence, costs about 670 ms per read on the busiest pair, and would sit outside the engine's WebSocket book path.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tokpie API, section 10 "Websocket Messages", "Last updated on February 10, 2021". Same text as the Internet Archive capture of 2026-07-28 16:26 UTC | https://tokpie.io/api | 2026-09-22 | Graceful Globe S.A., Panama | URL, topics, frame shapes, 90 s rule, private route, sections 1 to 7 |
| P5 | `ws-probe.mjs`, runs at 04:39 and 04:45 UTC, the page check, plain GET and two extra paths added for the second | [`ws-probe.mjs`](../../../scripts/probes/venues/tokpie/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 2, 3, 5 and 6 |
| P1 | `rest-probe.mjs catalog`, `errors` and `poll` | [`rest-probe.mjs`](../../../scripts/probes/venues/tokpie/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the REST book rows of section 4 |
