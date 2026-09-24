# Bitbegin WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:47 to 05:10 UTC on 2026-09-23, from the development host near Seattle through its Canadian VPN exit.

This profile covers the only WebSocket Bitbegin exposes, the Pusher protocol socket its web client configures, for the spot market, since the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
Bitbegin publishes no WebSocket documentation.
Every documented value below is what the web client's JavaScript bundle configures, S1, and every probed value comes from [`ws-probe.mjs`](../../../scripts/probes/venues/bitbegin/ws-probe.mjs).
The short answer is that the socket accepts a connection and then refuses the web client's own app key, so it delivers no market data to anyone who uses that key.

## 1. Endpoints

| family | URL from the web client | probed |
|---|---|---|
| spot, every pair | `wss://api.bitbegin.io/app/test?protocol=7&client=js&version=7.0.6&flash=false` | opens in 491 to 515 ms, then sends `pusher:error` code 4001 "Could not find app key `test`." and nothing else, P1 |
| perpetuals | none | the venue lists none |

The bundle builds the URL through Laravel Echo with `broadcaster: "pusher"`, `key: "test"`, `wsHost: "api.bitbegin.io"`, `wssPort: 443`, `cluster: "mt1"` and pusher-js 7.0.6, S1.
`api.bitbegin.io` is the same Cloudflare fronted host as the REST API, see [`rest.md`](./rest.md) section 1.
Ports 6001 and 6006, the usual self hosted Pusher ports, timed out on TCP connect after 6 s when tried once with curl, C1.
A plain HTTPS GET of `/app/test` with curl answered 426, which is an upgrade required reply, C1.

## 2. Channel matrix for public market data

| channel | event | payload in the web client's handler | probed |
|---|---|---|---|
| `dashboard-<base_coin_id>-<trade_coin_id>` | `order_place` | `orders.order_type` is `buy`, `sell` or `buy_sell`, with `orders.orders`, or `orders.buy_orders` and `orders.sell_orders`, each replacing a whole side of the book | subscribed for five pairs, nothing arrived in 90 s |
| `trade-info-<base_coin_id>-<trade_coin_id>` | `process` | `trades.transactions`, `last_trade.price`, `last_trade.time`, `order_data` | subscribed for five pairs, nothing arrived |
| `bitbegin_public_chanel` | not used by the bundle | the name is the site setting `public_chanel_name` | subscribed, nothing arrived |
| best bid and ask, ticker, mark, index, funding | none | | |

The ids are internal coin ids, not symbols.
USDT is coin 2, and the landing page data gives BTC 1, ETH 13, SHIB 6, USDC 3 and LTC 11, so BTC/USDT is `dashboard-2-1`, see [`rest.md`](./rest.md) section 2.
The `.order_place` handler calls `setOpenBookBuy` and `setOpenBooksell`, which assign the payload to the side wholesale, S1.
So by design the channel pushes whole sides, not deltas.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Bundle" means the web client's configuration, S1, since no documentation exists.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified. Bundle: one URL for every pair, one channel per pair | one URL, and it serves nothing |
| subscribe frame shape | Not publicly specified. Bundle: Pusher protocol 7, `{"event":"pusher:subscribe","data":{"auth":"","channel":"dashboard-2-1"}}` | 14 subscribe frames for 13 channels, one of them a repeat, got no reply, P1 |
| unknown symbol expectation | Not publicly specified | `dashboard-2-999` and `trade-info-2-999` got no reply, like the known pairs |
| chunk unit and budget | Not publicly specified | not measurable, nothing was accepted |
| keepalive mechanism | Not publicly specified. Bundle: pusher-js defaults, `activityTimeout` 120,000 ms and `pongTimeout` 30,000 ms, client `pusher:ping` | client `pusher:ping` answered `{"event":"pusher:pong"}` in 150 to 169 ms, no server ping and no protocol ping in 90 to 91 s |
| connection lifetime and maintenance notice | Not publicly specified | none seen. The site setting `maintenance_mode_status` was `"0"` |
| handshake and operation rate limits | Not publicly specified | opens took 491 to 515 ms, one socket at a time |
| public market data authentication | Not publicly specified. Bundle: public channels with an empty `auth` | the app key check fails before any channel is served |
| message parse and routing | Pusher envelope `{event, channel, data}` with `data` a JSON string | only `pusher:error` and `pusher:pong` arrived, neither with a channel |
| subscribe acknowledgement shape | Pusher `pusher_internal:subscription_succeeded` | never sent |
| symbol identifier format | Bundle: `<base_coin_id>-<trade_coin_id>` numeric coin ids, not the `BTC_USDT` pair string the REST routes use | not observed on the wire |
| number representation | Not publicly specified | not observed |
| timestamp representation | Bundle reads `last_trade.time` | not observed |
| size unit | Not publicly specified | not observed |
| sequence semantics | none in the bundle, which replaces each side wholesale | not observed |
| idle repeat behaviour | Not publicly specified | not observed |

## 4. The book channel in detail

Nothing in this section could be observed on the wire, because the socket served no channel, P1.
What follows is the web client's handling, S1, which is the only description that exists.

| item | web client | probed |
|---|---|---|
| snapshot on subscribe | none. The page first fetches the book over REST with `get-exchange-all-orders-app` at `per_page` 50 and `order_type` `buy_sell` | not observed |
| delta semantics | none. Each `order_place` event carries a whole side, or both sides, and replaces what the page holds | not observed |
| sequence and gap rule | none. No id, no sequence, no timestamp is read from the book event | not observed |
| checksum | none | not observed |
| level order | Not publicly specified | not observed |
| size unit | Not publicly specified, spot base units presumed | not observed |
| one-sided and empty books | Not publicly specified | not observed |
| idle repeats | Not publicly specified | not observed |
| unknown or closed symbol | Not publicly specified | no reply, like every other subscribe |

A feed built on this channel would have to take every event as a full replacement of the side it names.
Without a sequence, a missed event could not be detected except by the next one.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | pusher-js client ping, S1 | `{"event":"pusher:ping","data":{}}` answered with `{"event":"pusher:pong"}` in 150 to 169 ms on six pings over three runs |
| silence the server tolerates | Not publicly specified | a socket that sent nothing and one that only subscribed closed at 60,490 to 60,583 ms with 1006 and no close frame, four sockets over two runs, P2. A socket that pinged every 30 s stayed open for 90 to 91 s until the probe closed it |
| forced disconnect | Not publicly specified | none in 90 to 91 s |
| maintenance notice | Not publicly specified | none |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, P3 |
| handshake | | 491 to 515 ms to open |
| subscription limits | Not publicly specified | not measurable |
| throughput | | zero market data frames |

A 60 s idle close with no close frame is the shape of a reverse proxy read timeout rather than a Pusher `activity_timeout`, which is an inference.

## 6. Captured frames

From the probe runs of 2026-09-23 UTC.

Subscribe, as sent to the socket.

```json
{"event": "pusher:subscribe", "data": {"auth": "", "channel": "dashboard-2-1"}}
```

The first and only unsolicited frame, 1 ms after the socket opened, in all three book runs.
No `pusher:connection_established` preceded it, so the socket never got a `socket_id`.

```json
{"event": "pusher:error", "data": {"message": "Could not find app key `test`.", "code": 4001}}
```

Keepalive.

```json
{"event": "pusher:ping", "data": {}}
```

```json
{"event": "pusher:pong"}
```

No acknowledgement, snapshot, delta or error frame followed any subscribe, and the text frame `not json` got no reply either.

## 7. Private channels

Named from the bundle for a future execution stage, not probed.

- `usernotification_<user_id>` with event `receive_notification`.
- Events `process-<user_id>` and `order_place_<user_id>` on the same `dashboard-<base>-<trade>` channel, carrying a user's orders, stop limit orders and balances.
- The site setting `private_chanel_name` is `bitbegin_private_chanel`.

The per user events ride on channel names without a `private-` prefix, which in the Pusher protocol means no channel auth, an inference from the names.

## 8. Recommended feed shape

None.
The only socket refuses the app key its own web client ships, so no public book stream exists to build a `VenueFeed` on.
If the venue ever fixed its key, the shape would be one URL, one Pusher subscribe per pair on `dashboard-<base_coin_id>-<trade_coin_id>`, a client `pusher:ping` every 30 s against the 60 s idle close, `maxSilenceMs` near 45,000, and every `order_place` event taken as a whole side with no gap rule.
That shape would also need a coin id map, which only the refused REST API serves, see [`rest.md`](./rest.md) section 2.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitbegin web client bundle, `_app` chunk | https://www.bitbegin.io/_next/static/chunks/pages/_app-4d755e7858755c43.js | 2026-09-22 | Bitbegin | Echo and pusher-js config, channel and event names, book reducers, `per_page` 50, sections 1 to 7 |
| S2 | Landing page data | https://www.bitbegin.io/_next/data/JX8hCEZb_I5hxo6OapA8c/index.json | 2026-09-22 | Bitbegin | coin ids, `public_chanel_name`, `private_chanel_name`, `maintenance_mode_status`, sections 2, 3 and 7 |
| P1 | `ws-probe.mjs book`, three runs at 04:47, 04:50 and 04:59 UTC on 2026-09-23, the first of which waited for a `connection_established` that never came and so sent no subscribe | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbegin/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | app key error, silent subscribes, ping and pong, sections 1 to 6 |
| P2 | `ws-probe.mjs silence` at 04:51 and 05:00 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbegin/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | 60 s idle close, section 5 |
| P3 | `ws-probe.mjs deflate` at 04:47 and 04:59 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbegin/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | no deflate negotiated, section 5 |
| C1 | manual `curl` checks at 04:49 UTC on 2026-09-23 | `https://api.bitbegin.io:6001/`, `https://api.bitbegin.io:6006/` and `https://api.bitbegin.io/app/test` | 2026-09-22 | this host, Canadian VPN exit | port timeouts and the 426 reply, section 1 |
