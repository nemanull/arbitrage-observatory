# INX One WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:52 to 05:05 UTC, from the development host near Seattle through its Canadian VPN exit.

This profile covers the streaming API of INX One, now served under Republic's name, which has no CCXT class and lists no perpetuals, so the spot book channel is the subject, see [`fees.md`](./fees.md) section 3.
INX documents one socket URL, and connecting to it needs a websocket token that only a keyed REST call can create, S1.
So no market data frame could be captured, and every protocol value below is documented unless its row says probed.
Every probe claim comes from [`ws-probe.mjs`](../../../scripts/probes/venues/inx-one/ws-probe.mjs), and the results are from the Canadian VPN exit that this laptop's traffic leaves through.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot crypto and security tokens, one URL for all | `wss://gw-client-api-ws.trading.republic.com`, S1 | refused before the upgrade on every attempt, see below |
| perpetuals, futures, options | none listed | |

| attempt | upgrade reply | time to reply |
|---|---|---|
| no headers at all, as the engine opens a socket | 403 from Cloudflare, HTML titled "Attention Required! \| Cloudflare" with "Sorry, you have been blocked" and "You are unable to access republic.com" | 57 to 82 ms over four runs |
| a User-Agent naming the probe, no token | 401 from the origin, `text/html` body `This websocket token or api key invalid` | 105 to 159 ms over three runs |
| the same with permessage-deflate offered | 401, same body | 106 and 124 ms, two runs |

The documented connection carries two headers, `authorization` set to the websocket token and `apiKey` set to the API key id, S1.
A token is made by `POST /api/createToken`, which needs the signed REST headers, see [`rest.md`](./rest.md) section 2.
The token "must be used within 30 seconds after creating it", "can be used only by one connection per client", and a previous one has to be revoked with `POST /api/revokeToken` before a new one is made, S1.

## 2. Channel matrix for public market data

| channel, as the subscribe `event` | payload `data` | depth and speed | probed |
|---|---|---|---|
| `orderBook/subscribeOrderBook` | `{marketName: "BTC-USD", depth: 20, clientRequestId}` | "A possible "depth" example value is 20.", other depths and the push interval Not publicly specified | not reachable |
| `allTrades/subscribeAllTrades` | `{marketName, clientRequestId}` | on trade | not reachable |
| best bid and ask, ticker, mark, index, funding | none documented | | |

Both channels need the token, so none of INX One's streaming market data is public.
The documentation lists no unsubscribe event.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for every market, S1 | not reachable |
| subscribe frame shape | `{"event": "orderBook/subscribeOrderBook", "data": {"marketName": "BTC-USD", "depth": 20, "clientRequestId": "<uuid>"}}`, one market per frame, S1 | not reachable |
| unknown symbol expectation | Not publicly specified | not reachable |
| chunk unit and budget | "Websocket connections are limited to 5 subscriptions per key.", S1 | not reachable |
| keepalive mechanism | the server "sends a 'ping' message periodically" and "expects a 'pong' message as a response", and without one "within a few seconds" it unsubscribes every channel and kills the connection, S1. Whether that ping is a protocol frame or a text message is Not publicly specified | not reachable |
| connection lifetime and maintenance notice | Not publicly specified | not reachable |
| handshake and operation rate limits | one token per connection, each used within 30 s of its creation, and the REST limits of 10 requests per second and 100 per minute per key, S1 | not reachable |
| public market data authentication | required: a websocket token and the API key id in the upgrade headers, S1 | confirmed: 401 `This websocket token or api key invalid` without them, and 403 from Cloudflare when the request also lacks a User-Agent |
| message parse and routing | the pushed frame names its channel in `event`, such as `ORDER_BOOK` or `ALL_TRADES`, and its market in `marketName`, S1 | not reachable |
| subscribe acknowledgement shape | Not publicly specified | not reachable |
| symbol identifier format | `BTC-USD`, base and quote joined by a hyphen, S1 | not reachable |
| number representation | JSON numbers, `"price": 44`, `"amount": 27.6726853`, S1 | not reachable |
| timestamp representation | `sentTime` in Unix ms, S1 | not reachable |
| size unit | `amount`, which the example gives as 27.6726853 against a price of 44 and which reads as the base asset, S1. Not stated in words | not reachable |
| sequence semantics | none: the book frame documents no update id, sequence number or checksum, S1 | not reachable |
| idle repeat behaviour | Not publicly specified | not reachable |

## 4. The book channel in detail

Everything in this section is documented in S1 and was not probed, because the socket refused this host before the upgrade.

### Snapshot on subscribe

"Upon successful subscription, the INX system will send a snapshot of the order book."
The documented example frame has the event `ORDER_BOOK`, and the documentation does not say whether the snapshot and the deltas carry different events or a flag that tells them apart.

### Delta semantics

"The channel will continue to update with changes in the orders book, aka "deltas"."
The documented recipe is "If the price exist in your order book, override it with the new amount" and "If the amount is 0, remove the tier from your order book".
So a delta is a level replacement keyed by price, and a size of 0 deletes the level.

### Sequence and gap rule

None is possible from the documented fields.
The frame carries `event`, `sentTime`, `marketName`, `buy` and `sell`, and nothing that chains one frame to the next.
The documentation names no way to ask for a fresh snapshot other than the one sent on subscribe.

### Checksum

None is documented.

### Level order on the wire

Not publicly specified.
The documented example holds one level per side, `buy` at 44 and `sell` at 42, which is a crossed book and so an illustration rather than a real capture.

### Level window

`depth` sets the number of levels, and 20 is the only value the documentation names.
Whether the server sends a level leaving the window as a 0 amount is Not publicly specified.

### Size unit against the catalog

Spot has no contract size.
`amount` appears to be in the base asset from the example values, and the documentation does not say so in words.
This could not be checked against a live book.

### One-sided and empty books

Not publicly specified, and not probed.

### Idle repeats

Not publicly specified, and not probed.

### Unknown and closed symbols

Not publicly specified, and not probed.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server sends `ping`, client answers `pong` within a few seconds, S1 | not reachable |
| silence the server tolerates | Not publicly specified | not reachable |
| forced disconnect | a missed pong unsubscribes every channel and kills the connection, S1 | not reachable |
| maintenance notice | Not publicly specified | not reachable |
| compression | Not publicly specified | not observable, since the upgrade was refused with 401 before any extension could be negotiated |
| handshake | token and key id in the upgrade headers, S1 | refused in 57 to 159 ms. A client with no User-Agent, which is how the engine's [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 opens a socket, is stopped by Cloudflare before it reaches the origin |
| subscription limits | 5 subscriptions per key, and up to 10 API keys per user, S1 | not reachable |

## 6. Captured frames

No market data frame was captured.
These are the upgrade refusals from the probe runs of 2026-09-23 and, marked as such, the documented frames.

Upgrade refused by the origin, a User-Agent sent and no token, HTTP 401 with `content-type: text/html`.

```text
This websocket token or api key invalid
```

Upgrade refused by Cloudflare, no User-Agent, HTTP 403 with `content-type: text/html; charset=UTF-8`, headings of the page.

```text
Attention Required! | Cloudflare
Sorry, you have been blocked
You are unable to access republic.com
```

Documented subscribe frame, from S1, where the client puts a fresh UUID in `clientRequestId`.

```json
{"event": "orderBook/subscribeOrderBook", "data": {"marketName": "BTC-USD", "depth": 20, "clientRequestId": "<uuid>"}}
```

Documented book frame, from S1, with the trailing comma of the original removed so that it parses.

```json
{"event": "ORDER_BOOK", "sentTime": 1626785654804, "marketName": "BTC-USD", "buy": [{"price": 44, "amount": 27.6726853}], "sell": [{"price": 42, "amount": 29.6726853}]}
```

Documented public trade frame, from S1, with the trailing comma removed.

```json
{"event": "ALL_TRADES", "sentTime": 1626785654804, "trades": [{"marketName": "BTC-USD", "executedPrice": 50000, "executedQuantity": 1, "takerSide": "BUY"}]}
```

No acknowledgement, keepalive or error frame is documented in a form that could be quoted.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL and token.

- `orderNotification/subscribeOrderNotification`, pushing `ORDER_NOTIFICATION`.
- `myTrades/subscribeMyTrades`, pushing `MY_TRADES`, which also fires when a security token trade settles.
- `executionReport/subscribeExecutionReport`, pushing `EXECUTION_REPORT`, which the documentation calls the fastest trade notification.
- A FIX 4.4 API with a market data request, `35=V`, for order book updates, authenticated by the same signed context in tags 553 and 554, host Not publicly specified.

## 8. Recommended feed shape

No feed is recommended.
INX One lists no perpetual, its book channel needs an approved API key and a fresh token per connection, and its book frames carry no sequence, so a gap cannot be detected.

If a keyed spot feed were ever designed, these constraints would shape it.

| item | constraint | reason |
|---|---|---|
| URL plan | one URL, `wss://gw-client-api-ws.trading.republic.com` | S1 |
| upgrade headers | `authorization: <token>` and `apiKey: <apiKeyId>`, plus a User-Agent | S1, and the Cloudflare 403 without a User-Agent, section 1 |
| token | `POST /api/createToken` within 30 s before each connection, `POST /api/revokeToken` before the next | S1 |
| markets per connection | at most 5 subscriptions per key, so the 10 crypto pairs CoinGecko lists would need 2 keys, and 3 with NOTE-USD | S1, [`fees.md`](./fees.md) section 3 |
| keepalive | answer the server's `ping` with `pong` at once | S1 |
| resync | no gap can be seen in the frame, and the only documented snapshot comes on subscribe, so a refresh means subscribing again | section 4 |
| deflate | unknown, keep `perMessageDeflate: false` | section 5 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Digital Assets Trading Platform API, OpenAPI 3.0.3, version V1, sections INX Websockets, Websocket authentication and FIX API | https://apidoc.inx.co/ | 2026-09-23 04:49 UTC | INX, global | URL, token rules, channels, frames, limits, keepalive, sections 1 to 8 |
| P4 | `ws-probe.mjs connect`, runs at 04:52, 04:54, 05:02 and 05:04 UTC, the first without the User-Agent attempt | [`ws-probe.mjs`](../../../scripts/probes/venues/inx-one/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | upgrade refusals with and without a User-Agent, sections 1, 3, 5 and 6 |
| P5 | `ws-probe.mjs deflate`, runs at 04:55 and 05:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/inx-one/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | deflate not observable, section 5 |
