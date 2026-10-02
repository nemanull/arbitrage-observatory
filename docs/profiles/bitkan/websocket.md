# BitKan WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:14 to 03:34 UTC, from the development host near Seattle.

BitKan publishes no WebSocket API, no documentation and no CCXT Pro class, see [`fees.md`](./fees.md) section 8.
This profile records the one socket this host could reach, which is the socket BitKan's own website opens for every visitor.
Its URL and frame shapes come from the website bundles on `cdn.bitkan.net`, S1 and S2, and every claim about it was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitkan/ws-probe.mjs).
Only its public market data subscriptions were used, never a login channel.
It carries no order book channel that the bundles name, and it relays Binance USD-M data, so it is evidence about BitKan and not a feed candidate.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| any perpetual | none published | |
| website socket, futures | `wss://s.btckan.com:8080/contract`, the production `socket` value plus `contract`, S1 and S2 | open in 727 to 803 ms over ten sockets |
| website socket, other paths | `wss://s.btckan.com:8080/` for market data, and `shift`, `chat`, `config` and `strategy` beside `contract`, S2 | not probed |

`s.btckan.com` resolved to one address, 190.92.253.49, and answers a plain HTTPS request on port 8080 with 426 `Upgrade Required` and header `Server: elb`, see [`rest.md`](./rest.md) section 1.
One socket carries every perpetual, since each subscription names its contract and its underlying venue.

## 2. Channel matrix for public market data

The subscription names are every `sub:` value in the website bundles read, S2 and S3.

| channel | payload | probed on 2026-09-23 UTC |
|---|---|---|
| `contract_mark_price` | `{"sub":"contract_mark_price","trade_pair":"BINANCE-BTC-USDT","exchange":"binance","type":"add"}` | acknowledged, then one frame every 1,314 to 1,718 ms median over four runs, carrying mark, index, funding rate, next and previous settlement |
| `contract_trade` | same shape | acknowledged, then one frame per Binance USD-M aggregated trade, 301 to 347 frames in 30 s on BTC in three runs and 24 in a quiet one |
| order book | none found | no bundle read names a depth channel over the socket. The guessed `contract_depth` got no acknowledgement and no frame in 30 s |
| best bid and ask, ticker | none found for futures | `trade_ticker` exists on the spot `shift` path, S3, not probed |

The website draws its futures book from the REST call `/proxy/v2/contract/quote/depth`, which this host cannot reach, see [`rest.md`](./rest.md) section 5.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is empty on every row because BitKan documents nothing, so it reads "none" once here and the rows give the probed value.

| axis | documented | probed on the website socket |
|---|---|---|
| endpoint split axis | none | one URL per website area, and the underlying venue is a field of each subscription |
| subscribe frame shape | none | `{"sub": <channel>, "trade_pair": <contract>, "exchange": "binance", "type": "add"}`, one contract per frame. The website unsubscribes with `"type": "cancle"`, spelled so, S3 |
| unknown symbol expectation | none | `BINANCE-NOPE-USDT` is acknowledged with `"status": "success"` and then silent. An unknown channel gets no reply at all |
| chunk unit and budget | none | not probed beyond five subscriptions on one socket |
| keepalive mechanism | none | the website sends `{"ping":18212558000}` every 15 s, S3, and the server answers `{"pong":18212558000}`. The server also sends `{"ping":<ms>}` every 30 s |
| connection lifetime and maintenance notice | none | no forced close in 90 s. No notice channel named |
| handshake and operation rate limits | none | not reached |
| public market data authentication | none | none needed for `contract_mark_price` and `contract_trade` |
| message parse and routing | none | route on `sub` and `trade_pair` of the inflated JSON |
| subscribe acknowledgement shape | none | a text frame echoing the request with `"status": "success"` added |
| symbol identifier format | none | `<VENUE>-<BASE>-<QUOTE>`, as `BINANCE-BTC-USDT` |
| number representation | none | prices, sizes and rates as decimal strings, times as integer ms |
| timestamp representation | none | `time` in Unix ms. On mark frames it arrived here 95 to 168 ms after its value, with medians of 96 to 100 ms, matching the 95 and 98 ms by which the server ping's own timestamp trailed arrival, so it is BitKan's send time and not Binance's event time |
| size unit | none | trade `volume` is in coins, equal to Binance's aggTrade `q` on every matched trade, section 4 |
| sequence semantics | none | no sequence field on any frame |
| idle repeat behaviour | none | not measured, since no book channel exists |

## 4. The book channel in detail

There is no book channel on this socket that this host could find, so the rows of the template have no subject.
What the two public channels carry shows whose market it is.

### Trades are Binance's aggregated trades

| run, UTC | BitKan trades | matched to a Binance `aggTrades` row by price and quantity | side agrees, `type` `"1"` is a buy | Binance rows in the window found on BitKan | BitKan `time` minus Binance `T` |
|---|---:|---:|---:|---|---|
| 03:14 | 301 | 301 | 301 | 299 of 304 | median 188 ms, range -41 to 499 ms |
| 03:22 | 24 | 24 | 24 | 23 of 23 | median 179 ms, range 36 to 497 ms |
| 03:27 | 331 | 331 | 331 | 328 of 328 | median 178 ms, range 8 to 1,158 ms |
| 03:31 | 347 | 347 | 347 | 348 of 363 | median 197 ms, range -358 to 526 ms |

Every trade BitKan published was a Binance USD-M aggregated trade on `BTCUSDT`, and 96 to 100 % of Binance's trades in each window appeared on BitKan.
A negative offset means the nearest Binance row with the same price and quantity was another trade, since such pairs repeat.
In the 03:31 run, the one that measured it, BitKan's trade frames reached this host a median 392 ms after Binance's trade time `T`, range -258 to 624 ms.
A Binance sweep through many price levels shows up as a burst of BitKan frames at consecutive 0.1 steps within a few milliseconds, which is Binance's own tape.
BitKan's `originalPrice` equalled `price` on every frame seen.

### Mark frames are Binance's premium index

The comparison polled Binance `GET /fapi/v1/premiumIndex` once a second beside the socket.

| run, UTC | contract | frames | mark equal to the nearest Binance poll rounded to BitKan's decimals | index equal, rounded | `rate` equal to `lastFundingRate` | `next_time` equal to `nextFundingTime` |
|---|---|---:|---:|---:|---:|---:|
| 03:22 | BTC | 20 | 14 | 19 | 20 | 20 |
| 03:22 | ETH | 20 | 17 | 18 | 20 | 20 |
| 03:27 | BTC | 21 | 16 | 15 | 21 | 21 |
| 03:27 | ETH | 22 | 17 | 18 | 22 | 22 |
| 03:31 | BTC | 19 | 11 | 11 | 19 | 19 |
| 03:31 | ETH | 19 | 11 | 10 | 19 | 19 |

The mismatches fit timing: BitKan republishes every 1.3 to 1.7 s and the poll ran every second, and the largest gap between a BitKan mark and the nearest poll was 2 to 135 ppm per run.
`prev_rate` read `0.00001021` for BTC and `0.00009373` for ETH, which are Binance's settled rates at 2026-09-23 00:00 UTC from `GET /fapi/v1/fundingRate`.
`settle_price` tracked Binance's `estimatedSettlePrice`, `86510.7` against `86511.44327367` read seconds apart.

### Size unit

Trade `volume` equalled Binance's `q` in BTC on every matched trade, so the unit is coins.
The 2023 catalog copy gives `contract_size` `"0.001"` for `BINANCE-BTC-USDT`, which is Binance's quantity step, see [`rest.md`](./rest.md) section 2.

### Unknown and closed symbols

| request | reply | then |
|---|---|---|
| `contract_mark_price` `BINANCE-NOPE-USDT` | `{"status": "success", …}` | nothing in 30 s |
| `contract_depth` `BINANCE-BTC-USDT` | nothing | nothing in 30 s |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | none | client `{"ping":18212558000}` answered by `{"pong":18212558000}` 179 to 189 ms after the 15 s tick. Server `{"ping":<ms>}` every 30 s, first seen 6.8 to 26.4 s after open |
| silence the server tolerates | none | a socket that subscribed nothing and sent nothing got a server ping at 19.4 s and 26.4 s in two runs, did not answer, and closed with 1006 at 49.4 s and 56.4 s, each 30.0 s after that ping. A socket that sent only the client ping every 15 s, and never answered the server's, stayed open the full 90 s in both runs |
| forced disconnect | none | none in 90 s |
| maintenance notice | none | none named in the bundles read |
| compression | none | every data frame is a binary WebSocket frame holding zlib-deflated JSON, which the website inflates with pako, S3. Acknowledgements and keepalives are text. A client that offered permessage-deflate got no extension back |
| handshake | none | 727 to 803 ms to open over ten sockets. A plain HTTPS request to the same port took 747 and 761 ms cold and 211 and 190 ms warm |
| subscription limits | none | not reached |
| throughput | | in the 03:27 run, BTC mark 22 frames in 30 s, 5,003 bytes on the wire and 8,372 inflated, and BTC trades 332 frames, 47,292 bytes on the wire and 57,047 inflated. The 03:31 run read 4,541 and 7,586 bytes for 20 mark frames, and 49,584 and 59,799 bytes for 348 trade frames |

The compression inside the frame is the shape [`../../implemented/2026-09-15-five-venue-research-design.md`](../../implemented/2026-09-15-five-venue-research-design.md) section 3 asks a profile to flag.
The engine's `VenueFeed` would need a zlib inflate per frame for this socket.

## 6. Captured frames

From the probe runs of 2026-09-23 UTC, inflated where the wire frame was binary.

Subscribe.

```json
{"sub": "contract_mark_price", "trade_pair": "BINANCE-BTC-USDT", "exchange": "binance", "type": "add"}
```

Acknowledgement, a text frame.

```json
{"status": "success", "sub":"contract_mark_price", "trade_pair":"BINANCE-BTC-USDT", "exchange":"binance", "type":"add"}
```

Mark, a binary zlib frame.

```json
{"rate":"0.00003906","mark_price":"86649.9","index_price":"86698.5","settle_price":"86548.8","next_time":1790150400000,"depth_info":[{"key":"rate","value":"0.0039%"},{"key":"next_time","value":"1790150400000"}],"trade_pair":"BINANCE-BTC-USDT","sub":"contract_mark_price","exchange":"binance","time":1790134054070,"prev_time":1790121600000,"prev_rate":"0.00001021","type":"contract_mark_price"}
```

Trade, a binary zlib frame.

```json
{"time":1790134052990,"price":"86644.80","originalPrice":"86644.80","volume":"0.010","type":"2","trade_pair":"BINANCE-BTC-USDT","sub":"contract_trade","exchange":"binance"}
```

Keepalive, client ping, server answer, and the server's own ping.

```json
{"ping":18212558000}
```

```json
{"pong":18212558000}
```

```json
{"ping":1790133279512}
```

Unknown contract, acknowledged and then silent.

```json
{"status": "success", "sub":"contract_mark_price", "trade_pair":"BINANCE-NOPE-USDT", "exchange":"binance", "type":"add"}
```

## 7. Private channels

Named for completeness from the website bundle, S2, not probed.
`contract_login` with `user_id` and `socket_token`, then `contract_account`, `contract_order` and `margin_call` on the `contract` path, and `web_notify`, `set_info` and `trade_order_all` elsewhere.
BitKan offers no API keys, so a future execution stage has no documented route.

## 8. Recommended feed shape

None.
BitKan has no documented socket, and the website socket has no book channel, carries undocumented and zlib-compressed frames, and relays Binance USD-M trades a median 392 ms after Binance's own trade time.
The engine already reads the same contracts from Binance directly through [`binance.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/binance/binance.ts).

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | website config bundle `config-CiXgh45W.js` | https://cdn.bitkan.net/cdn/static/js/config-CiXgh45W.js | 2026-09-22 | BitKan | production `socket` value `wss://s.btckan.com:8080/`, section 1 |
| S2 | website entry bundle `index-BO53GTFl.js` | https://cdn.bitkan.net/cdn/static/js/index-BO53GTFl.js | 2026-09-22 | BitKan | socket paths, private channel names, sections 1 and 7 |
| S3 | website bundles `useServiceFactory-DTGi92t3.js`, `futures.mark.price-gZEehEJO.js`, `futures.ticker-Dhaoketr.js`, `config-w78AJc77.js` | https://cdn.bitkan.net/cdn/static/js/ | 2026-09-22 | BitKan | subscribe and cancel shape, ping literal and 15 s interval, pako inflate, channel names, sections 2, 3 and 5 |
| S4 | Wayback capture of `bitkan.com/help/fee`, 2026-07-25, which names the bundles above | https://web.archive.org/web/20260725033829/https://bitkan.com/help/fee | 2026-09-22 | BitKan | the bundle file names, section 1 |
| S5 | Binance USD-M `premiumIndex`, `fundingRate` and `aggTrades` | https://fapi.binance.com/fapi/v1/premiumIndex | 2026-09-22 | Binance | comparison values, section 4 |
| P1 | `ws-probe.mjs mark`, runs at 03:14, 03:22, 03:27 and 03:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkan/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs silence` and `deflate` at 03:20 and 03:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitkan/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
