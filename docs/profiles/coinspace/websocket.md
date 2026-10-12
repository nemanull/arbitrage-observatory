# COINSPACE WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:40 to 03:58 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

This profile covers the public sockets of COINSPACE, a USDT-margined perpetual futures venue, see [`fees.md`](./fees.md) section 1.
COINSPACE publishes no socket documentation.
Every URL and event below was found in the web app bundle at `www.coinspace.world`, sources S5 and S6 of [`fees.md`](./fees.md) section 10.
Probe numbers come from [`ws-probe.py`](../../../scripts/probes/venues/coinspace/ws-probe.py), whose parts are lettered A to H, and its frames were captured to `.claude/survey-work/coinspace/ws-capture.jsonl`.

The finding that governs every section: COINSPACE has no public book channel.
Its own socket is a Socket.IO 4 server for logged-in account events, and its public `/market` namespace carries only a market status and system notices.
The trade page draws its order book, trades and klines from Binance USD-M futures, by opening Binance's socket in the browser, S6.

## 1. Endpoints

| URL | what it is | evidence |
|---|---|---|
| `wss://api.coinspace.world/socket.io/?EIO=4&transport=websocket` | COINSPACE's Socket.IO 4 server, default namespace for account events after `authenticate`, and `/market` for public status | parts A and B, S5 |
| `wss://api.coinspace.world/socket.io/` namespace `/chat` | support chat, needs a token | S5 |
| `wss://fstream.binance.com/public/ws/<symbol>@depth` | the order book the trade page shows, Binance USD-M diff depth | S6, part G |
| `wss://fstream.binance.com/market/ws/<symbol>@aggTrade` and `@kline_<interval>` | the trades and candles the trade page shows | S6 |
| `https://fapi.binance.com/fapi/v1/depth?symbol=<SYMBOL>&limit=1000` | the snapshot the trade page seeds its Binance book from | S6 |

The trade page builds its Binance URLs with the bundle's `buildBinanceFuturesWsUrl`, `wss://fstream.binance.com/<route>/ws/<stream>`, S6.
It also has a code path that charts a symbol `CTR/USDT` from COINSPACE's own server at `wss://api.coinspace.world`, with events of type `ctr_chart_update`, S6.
CTR/USDT is in none of the three symbol lists of [`rest.md`](./rest.md) section 2.
A plain WebSocket upgrade at `wss://api.coinspace.world` and at `/ws` answered 502 Bad Gateway from the load balancer (`Server: awselb/2.0`), part H.

## 2. Channel matrix for public market data

| channel | COINSPACE socket | evidence |
|---|---|---|
| order book, any depth | Not offered | parts B and C |
| best bid and ask | Not offered | parts B and C |
| trades | Not offered | parts B and C |
| ticker | Not offered | parts B and C |
| mark, index, funding | Not offered | parts B and C |
| `/market` `system_notifications` and `market_status` | the two channels the namespace advertises on connect | part B |

On connecting `/market` the server sends two events at once, captured in part B:

```text
42/market,["market_connection_established",{"socketId":"AaMj8m_0hx0mwYXpAB3J","timestamp":"2026-10-10T03:40:19.438Z","message":"공개 시장 데이터 서비스에 연결되었습니다.","availableChannels":["system_notifications","market_status"]}]
42/market,["initial_market_status",{"marketStatus":"ACTIVE","tradingEnabled":true,"timestamp":"2026-10-10T03:40:19.438Z","serverTime":1791603619438,"activeSymbols":[],"marketInfo":{"totalVolume24h":0,"totalTrades24h":0,"activeTraders":1}}]
```

The message reads "connected to the public market data service".
Its own status reports `totalVolume24h` 0, `totalTrades24h` 0 and no `activeSymbols`, while CoinMarketCap shows about 7.4 billion USD a day for the venue, S1.
No other frame than server pings arrived in 60 s, in part B of each of three runs.
Part C sent `subscribe` and `join` with each of `market_status`, `system_notifications`, `BTCUSDT`, `BTC/USDT`, `ticker:BTCUSDT`, `orderbook:BTCUSDT`, `depth:BTCUSDT`, `market:BTCUSDT`, `market` and `ticker`, on both namespaces, plus `["subscribe","btcusdt@depth"]`.
Nothing but pings came back in 15 s.
The client's only `subscribe` sends the user's `personalChannel`, which arrives with a login, S5.

## 3. The sixteen axes

The axes of [`../../research/2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md), for COINSPACE's own socket.
The book axes have no COINSPACE value because there is no book channel.

| axis | documented | probed |
|---|---|---|
| transport framing | none published | Socket.IO 4 over Engine.IO 4, text frames, `0` open, `40` connect, `42` event, part B |
| endpoint per family | none published | one host for all, part A |
| subscribe frame | none published | no public market data subscription exists, part C |
| subscribe acknowledgement | none published | none for any guessed channel, part C |
| snapshot on subscribe | none published | no book channel |
| delta semantics | none published | no book channel |
| sequence and gap rule | none published | no book channel |
| checksum | none published | no book channel |
| level order | none published | no book channel |
| size unit | none published | no book channel |
| symbol spelling | none published | no book channel. The REST catalog spells `BTC/USDT`, [`rest.md`](./rest.md) section 2. |
| keepalive | none published | server sends `2` every 25 s and the client answers `3`, part B |
| silence tolerated | none published | no `3` answer closes the socket about 45 s after open, code 1005, part F |
| compression | none published | the permessage-deflate offer was not accepted, no `Sec-WebSocket-Extensions` header, part E |
| limits | none published | `maxPayload` 1,000,000, part A |
| errors | none published | an `authenticate` with an empty token got no reply in 6 s and no close, part D |

## 4. The book channel in detail

COINSPACE has none.
The book the trade page shows is Binance's `<symbol>@depth` diff stream, seeded from Binance's 1000 level REST snapshot, S6.
Part G opened that exact URL, `wss://fstream.binance.com/public/ws/btcusdt@depth`, and received 39 frames in 10 s, the first a `depthUpdate` carrying Binance's `U`, `u` and `pu`.
The engine's Binance leg is the place that book belongs.

## 5. Session

| item | value | evidence |
|---|---|---|
| handshake | `GET https://api.coinspace.world/socket.io/?EIO=4&transport=polling` answers `0{"sid":...,"upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}` | part A |
| old protocol | `EIO=3` answers 400 `{"code":5,"message":"Unsupported protocol version"}` | part A |
| edge | CloudFront, `X-Amz-Cf-Pop: HIO52-P3`, in front of the Socket.IO server | part E |
| forced disconnects | none seen in 60 s of part B | part B |
| maintenance notices | the `/market` `system_notifications` channel exists, and none arrived | part B |

## 6. Captured frames

Open packet and namespace connect, part B:

```text
0{"sid":"SYk96pnptacK2dl1AB3H","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40{"sid":"d9n4cC6n5umYE8k2AB3I"}
40/market,{"sid":"AaMj8m_0hx0mwYXpAB3J"}
```

The server ping is the single frame `2`, and the client answer is `3`.
The `/market` events are in section 2.
No subscribe acknowledgement, snapshot, delta or error frame exists to capture.

## 7. Private channels

The default namespace takes `authenticate` with `{"token": <JWT>, "deviceId": <fingerprint>}` and answers `authentication_success` or `authentication_error`, S5.
Account events then include `order_update`, `trade_update`, `portfolio_update`, `balance_update`, `liquidation_price_update`, `liquidation_warning`, `liquidation_executed` and `tpsl_*`, and the client emits `request_portfolio`, `cancel_order` and `request_liquidation_price`, S5 and S6.
Take-profit and stop-loss orders go through REST at `https://api.coinspace.world/api/v1/tpsl`, S6.

## 8. Recommended feed shape

None, and the venue is blocked as a perpetual leg in its current shape.

- It has no book channel, so the engine has nothing to subscribe.
- Its REST book, trades and ticker are Binance USD-M's, relayed, see [`rest.md`](./rest.md) section 5.
- It has no index, mark or funding of its own, see [`rest.md`](./rest.md) section 3.
- A COINSPACE leg built on Binance's socket would be the Binance leg seen twice, as the survey found for other relays such as [`../zebpay/`](../zebpay/).

A taker fill on COINSPACE presumably executes at or near Binance's price against the house, but that cannot be confirmed without an account.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinspace` | the reported volume |
| S5 | `https://www.coinspace.world/assets/index-fccd3ab2.js` | Socket.IO client, namespaces, account events, `authenticate` |
| S6 | `https://www.coinspace.world/assets/FutureTradev1.5-6fa4af21.js` and `useSymbolConfig-4eea8fbc.js` | Binance stream URLs and builder, the CTR/USDT path, liquidation events |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/coinspace/ws-probe.py) | every probed value here |

The ids match [`fees.md`](./fees.md) section 10.
