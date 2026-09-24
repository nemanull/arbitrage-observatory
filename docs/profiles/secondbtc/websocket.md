# SecondBTC WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific evening (04:26 to 04:53 UTC on 2026-09-23), from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

SecondBTC lists no perpetual, see [`fees.md`](./fees.md) section 3, so this profile covers the public socket of its spot market.
SecondBTC documents no public WebSocket API.
The only public socket is the Socket.IO server that its own web page uses, found in the web app bundle and captured by [`ws-probe.mjs`](../../../scripts/probes/venues/secondbtc/ws-probe.mjs).
That server refuses every WebSocket upgrade from this host, so every frame below was read over the Engine.IO long-polling transport.
Access results are from the Canadian VPN exit named above.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| spot, Socket.IO v4 | `https://socket.secondbtc.com/socket.io/?EIO=4&transport=polling`, from the constant `https://socket.secondbtc.com` in S1 | handshake 200 in every run, `{"sid":…,"upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}` |
| same, WebSocket transport | `wss://socket.secondbtc.com/socket.io/?EIO=4&transport=websocket` | HTTP 400 `{"code":3,"message":"Bad request"}` without a session id, with an `Origin: https://secondbtc.com` header, with a deflate offer, and with the session id of a live polling session, in both runs of P1 |
| Engine.IO v3 | `…/socket.io/?EIO=3&transport=polling` | HTTP 400 `{"code":5,"message":"Unsupported protocol version"}`, P1 |
| socket host root | `wss://socket.secondbtc.com/` | HTTP 200 with the API's welcome body `{"message":"Welcome to secondbtc application.","Autor":"secondbtc"}`, so the socket host and `api.secondbtc.com` reach the same application, P1 |

The handshake advertises `websocket` as an upgrade, yet every upgrade gets Engine.IO error 3.
In Engine.IO that code is what a server returns when a WebSocket request arrives without the `Upgrade` header, which suggests the proxy in front of the application drops it.
That reading is an inference, and it does not depend on the VPN exit, because the refusal is the application's own JSON and Cloudflare served it from both the SEA and YVR edges.
The web client is created with `reconnectionDelay` 5000 and `reconnectionAttempts` 1 and no transport list, S1, so a browser also starts on long-polling and stays there when its upgrade fails.

## 2. Channel matrix for public market data

Socket.IO events, all pushed by the server after the client emits `createRoom` with a market id, S2 and P2.

| event | payload | cadence on `BTC_USDT` | probed |
|---|---|---|---|
| `EXCHANGE_ALL_DATA` | `{"data":{"bids":[[price,size],…],"asks":[…]}}`, 150 levels per side | about every 5.3 s, gaps of 5.15 to 5.52 s between regular pushes | the whole book each time, no symbol, no time, no sequence |
| `EXCHANGE_MARKET_INFO` | `{"data":{"marketInfo":{…},"burnList":…}}` | every 10.2 to 10.6 s | market settings, last price, 24 h stats, fees, and the venue's market maker settings |
| `EXCHANGE_TRADE_HISTORY` | `{"data":{"tradeHistory":[{symbol, price, qty, quoteQty, side, time}, …]}}`, 32 trades | every 10.2 to 10.6 s, together with market info | the last 32 trades |
| best bid and ask, ticker, mark, index, funding | none | | no such event name appears in the exchange page chunk, S2 |

The exchange page emits `createRoom`, then two more events whose names are obfuscated in S2, and it listens for the three events above.
Emitting `orderBookQueuing`, `EXCHANGE_ALL_DATA`, `EXCHANGE_TRADE_HISTORY` and `EXCHANGE_MARKET_INFO` with `BTC_USDT` after `createRoom` got 200 `ok` for each and made the server push extra book, market info and trade frames outside the regular cadence, P2.
Some of those extra book frames held 76, 77 or 52 levels instead of 150.

`EXCHANGE_MARKET_INFO` carries `marketInfo.mmSetting`, the configuration of the venue's own market maker.
Its keys are `userId`, `orderOuantity`, `volume`, `minA`, `maxA`, `priceSource`, `ratioLiq`, `bstatus`, `divideVolume`, `ostatus`, `vstatus`, `userSecretKey`, `userApiKey`, `divideOrder` and `liquidity`, and `priceSource` was `"binance"` in all 7 market info frames of the rerun, P2.
The values of `userApiKey` and `userSecretKey` are broadcast to every public client.
The probe reduces `mmSetting` to its key names and `priceSource` before logging, and this profile records no value of either field.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
SecondBTC documents none of them, so the documented column says what the handshake or the web app states.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one host for every spot market, S1 | one host, one room per market, section 4 |
| subscribe frame shape | the web page emits `createRoom` with the market id, S2 | Engine.IO POST body `42["createRoom","BTC_USDT"]`, answered `200 ok` |
| unknown symbol expectation | Not publicly specified | `createRoom` with `NOPE_USDT`, `BTCUSDT`, the disabled `MBASE_USDT`, the frozen `SOL_USDT` or the thin `SBTC_USDT` answers `200 ok` and sends nothing in 8 s, in both runs |
| chunk unit and budget | Not publicly specified | one book per session, section 4 |
| keepalive mechanism | Engine.IO server ping, `pingInterval` 25,000 ms and `pingTimeout` 20,000 ms in the handshake | server sends packet `2` at 25.2 to 26.4 s, the client answers `3` by POST |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 67 s sessions that answered pings, no notice seen |
| handshake and operation rate limits | Not publicly specified | no refusal across 6 sessions opened in 54 s |
| public market data authentication | none | none |
| message parse and routing | Socket.IO packet `42[event, payload]`, several packets per poll joined by `\x1e` | route on the event name, then by the session's room, since the book payload names no market |
| subscribe acknowledgement shape | none | no Socket.IO acknowledgement, only the HTTP `200 ok` of the POST |
| symbol identifier format | `BTC_USDT` in the page route `exchange/BTC_USDT`, S1 | room `BTC_USDT`, while `marketInfo.symbol` and trade `symbol` are `BTCUSDT` |
| number representation | Not publicly specified | prices and sizes are JSON numbers, with float artefacts such as `0.00030000000000000003` |
| timestamp representation | Not publicly specified | the book has no time. Trades carry `time` in ms, market info carries `closeTime` and `openTime` in ms and `updatedAt` as ISO text |
| size unit | Not publicly specified | base currency, the same numbers as the REST book, section 4 |
| sequence semantics | none | none, every book push is a whole book |
| idle repeat behaviour | Not publicly specified | the touch price often repeats across pushes while only sizes change, section 4 |

## 4. The book channel in detail

### Snapshot on subscribe

There is no separate snapshot.
Every regular `EXCHANGE_ALL_DATA` push is the whole book at 150 levels per side, and the first one arrived 0.9 to 4.9 s after `createRoom`, P2.
Nothing arrived in the 12.7 s before `createRoom` in either run.

### Delta semantics

None.
No push carried a zero size, a sequence field or a partial side over 13 and 14 pushes in the two runs of P2.
A feed replaces the whole book on each push.

### Sequence and gap rule

None exists.
A missed push is invisible, and the next push repairs the book because it is whole.

### Checksum

None.

### Level order on the wire

| source | bids | asks |
|---|---|---|
| socket push | best first, descending, in every push of both runs | best first, ascending |
| REST `depth` | descending | ascending |

No push held two levels at the same price.

### Level window

150 levels per side on `BTC_USDT` and `ETH_USDT`, P2 and P4, against 300 on the REST `depth` call, see [`rest.md`](./rest.md) section 5.
Some extra pushes that followed the extra emits held 76, 77 or 52 levels per side.

### Size unit and the REST book

Sizes are base currency, since there is no contract.
Each regular 150-level push equalled the REST book read after it at both the touch price and both touch sizes, in 10 of 10 reads in the first run and 9 of 10 in the rerun, P2.
The one mismatch fell between two extra pushes caused by the extra emits.
So the socket carries exactly the REST book, pushed about every 5.3 s.

### Freshness of the book

The venue's market maker copies Binance, `priceSource` `"binance"`.
The touch price of `BTC_USDT` often held for three to six consecutive pushes, up to 16 s, while only its sizes changed, P2.
The REST comparison against Binance is in [`rest.md`](./rest.md) section 4, where the `SOLUSDT` book sat frozen with every level listed twice, up to 1,004 ppm through the Binance touch.

### One-sided and empty books

No one-sided book was seen on the socket.
Rooms for the frozen `SOL_USDT` and the thin `SBTC_USDT` sent no book in 8 s, so a quiet or stalled market simply falls silent.

### Idle repeats

A push arrived about every 5.3 s, and consecutive pushes often repeated the touch price with new sizes.

### Unknown, closed and wrong-spelled symbols

| request | reply | then |
|---|---|---|
| `createRoom` `NOPE_USDT` | `200 ok` | nothing in 8 s |
| `createRoom` `MBASE_USDT`, a disabled market | `200 ok` | nothing in 8 s |
| `createRoom` `BTCUSDT` | `200 ok` | nothing in 8 s |
| an unknown event `nope_event` and then the malformed packet `42notjson` | `200 ok` for each POST | the server sent close packet `1` and the next poll got 400 `{"code":1,"message":"Session ID unknown"}` |

### Several markets on one session

A session that emitted `createRoom` for `SOL_USDT`, `ETH_USDT` and `BTC_USDT` in that order received market info and trades for all three, and books only for `BTC_USDT`: 7 and 9 books in two 35 s runs, P3.
A session that joined `BTC_USDT`, `ETH_USDT` and `SOL_USDT` in that order received no book at all in 35 s, while `SOL_USDT` was frozen.
So the book follows the last room joined, and since the book payload names no market, one session can carry one market's book.
That rule is inferred from these three runs.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Engine.IO ping every 25,000 ms, pong due within 20,000 ms, from the handshake | a session that answered pings stayed open for the whole 48 to 67 s runs |
| silence the server tolerates | 45 s from the handshake values | a session that ignored the ping at 25.5 and 25.6 s was closed with packet `1` at 45.5 and 45.6 s, and its next poll got 400 `Session ID unknown`, P5 |
| forced disconnect | Not publicly specified | none except the malformed packet case |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | the WebSocket transport is refused before any extension is negotiated. Polling replies were plain text |
| handshake | | the first polling handshake of a run returned 239 to 612 ms after the probe started, and the namespace connect `40{"sid":…}` came back in the next poll, under 0.6 s later |
| subscription limits | Not publicly specified | three rooms on one session were accepted |
| session affinity | | the handshake set no cookie, and polls carrying only the session id worked for the whole of every session |

## 6. Captured frames

Trimmed, from P2 at 04:49 UTC.
Book arrays are cut to three levels, and `mmSetting` shows what the probe keeps after redaction.

Engine.IO handshake.

```json
{"sid":"VF7_cOnMuU3Mbb1OAD2c","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
```

The client posts `40`, and the namespace connect comes back on the next poll as `40{"sid":"Pkbl8wWcecClDUkpAD2e"}`.
Subscribe, as the POST body.

```json
["createRoom","BTC_USDT"]
```

Book push, the payload after `42`.

```json
["EXCHANGE_ALL_DATA",{"data":{"bids":[[87207.96,1.296805],[87207.95,0.00015],[87207.94,0.00013]],"asks":[[87207.97,0.249165],[87207.98,0.00073],[87207.99,0.00006]]}}]
```

Market info, with `mmSetting` redacted by the probe.

```json
["EXCHANGE_MARKET_INFO",{"data":{"marketInfo":{"mmSetting":{"redactedKeys":["userId","orderOuantity","volume","minA","maxA","priceSource","ratioLiq","bstatus","divideVolume","ostatus","vstatus","userSecretKey","userApiKey","divideOrder","liquidity"],"priceSource":"binance"},"baseId":1,"quoteId":2,"symbol":"BTCUSDT","baseAsset":"BTC","quoteAsset":"USDT","lastPrice":87207.96,"volume":17745146.25151521,"quoteVolume":206.03637999999987,"low24h":85114,"high24h":87277,"change":1.9524020513723843,"status":true,"marketPriceDec":2,"marketAmountDec":6,"marketTotalDec":4,"tickSize":0.01,"tradeMinTotal":10,"tradeFeeMaker":0.2,"tradeFeeTaker":0.2,"marketMaker":true,"isBurn":false,"liquidityMaker":false,"usdtPrice":87207.96,"orderTypes":[],"createdAt":"2023-09-29T16:44:58.471Z","updatedAt":"2026-09-23T04:49:55.421Z","closeTime":1790138995416,"openTime":1790052595416,"id":"6516ff0a41ca0a3cb938b3a7"},"burnList":null}}]
```

Here `volume` holds the quote volume and `quoteVolume` holds the base volume, the reverse of their names.

Trades, cut to two.

```json
["EXCHANGE_TRADE_HISTORY",{"data":{"tradeHistory":[{"symbol":"BTCUSDT","price":87207.96,"qty":0.01008,"quoteQty":879.0562368000001,"side":"SELL","time":1790138995269},{"symbol":"BTCUSDT","price":87207.97,"qty":0.00006,"quoteQty":5.2324782,"side":"BUY","time":1790138984817}]}}]
```

Among the 26 trades that fit the trimmed capture, 19 of the 25 gaps between consecutive trade times fell between 10,400 and 10,520 ms, the same period as the market info push.
A trade print on a clock suggests the market maker's volume setting prints the trades, which is an inference.

Keepalive: the server's poll returns `2`, and the client POSTs `3`.

Refusals.

```json
{"code":3,"message":"Bad request"}
```

```json
{"code":1,"message":"Session ID unknown"}
```

## 7. Private channels

The exchange page listens for `USER_ORDER_DATA`, `USER_TRADE_INFO` and `USER_WALLET_DATA` on the same socket, S2.
They were not probed.

## 8. Recommended feed shape

No feed is recommended.

| item | finding | consequence |
|---|---|---|
| transport | WebSocket upgrade refused with 400 on every attempt | `VenueFeed` opens a WebSocket at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81, so it cannot carry this venue |
| markets per session | one book per session, and the book names no market | 56 enabled markets would need 56 long-polling sessions |
| cadence | a whole book every 5.2 to 5.5 s, equal to the REST book | polling the REST `depth` call gives the same data with no session state |
| content | a copy of Binance by the venue's own market maker, with frozen and duplicated books seen on `SOLUSDT` | a cross between SecondBTC and Binance is a stale copy, not a price another trader can be expected to stand behind |
| product | spot only | the engine trades perpetual legs |

If SecondBTC were ever wanted as a spot reference, the REST `depth` call with `limit=20` every 5 s per market is the simpler source, see [`rest.md`](./rest.md) section 8.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | SecondBTC web app bundle `app.bcfdac16.js` | https://secondbtc.com/js/app.bcfdac16.js | 2026-09-22 | SecondBTC | socket host, client options, page route `exchange/BTC_USDT`, sections 1 and 3 |
| S2 | SecondBTC exchange page chunk `180.fec704b1.js` | https://secondbtc.com/js/180.fec704b1.js | 2026-09-22 | SecondBTC | `createRoom`, the three public event names, the private event names, sections 2, 3 and 7 |
| P1 | `ws-probe.mjs transport`, runs at 04:38 and 04:49 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/secondbtc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | WebSocket refusals, Engine.IO v3 refusal, handshake, section 1 |
| P2 | `ws-probe.mjs book`, runs at 04:39 and 04:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/secondbtc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | events, cadence, book shape, socket against REST, market info, trades, sections 2 to 6 |
| P3 | `ws-probe.mjs multi`, runs at 04:40, 04:41 and 04:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/secondbtc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | several rooms on one session, section 4 |
| P4 | `ws-probe.mjs unknown`, runs at 04:42 and 04:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/secondbtc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | unknown, disabled, frozen and wrong-spelled rooms, the malformed packet, sections 3 and 4 |
| P5 | `ws-probe.mjs silence`, runs at 04:43 and 04:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/secondbtc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | ping and the 45 s close, section 5 |
