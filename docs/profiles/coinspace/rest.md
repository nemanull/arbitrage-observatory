# COINSPACE REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:30 to 03:55 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

This profile covers the public REST calls of COINSPACE, a USDT-margined perpetual futures venue run by COINIA S.R.L. of Costa Rica, see [`fees.md`](./fees.md) section 1.
COINSPACE publishes no API documentation.
Every call below was found in the web app bundle at `www.coinspace.world`, or is the fee URL CoinMarketCap lists for the venue, which shares its `/proxy/api/v1/` prefix.
Probe numbers come from [`rest-probe.py`](../../../scripts/probes/venues/coinspace/rest-probe.py), whose sections are numbered 1 to 5.
COINSPACE has no CCXT class, see [`fees.md`](./fees.md) section 8.

The finding that governs every section: the public market data is Binance USD-M futures data, relayed.
All 500 rows of `GET /proxy/api/v1/trades?symbol=BTCUSDT` carried a Binance USD-M `trade_id` with Binance's price and quantity, in each of three runs.
The best bid and ask of `GET /proxy/api/v1/depth?symbol=BTCUSDT` equalled Binance's own REST book read about 280 ms later on 95 of 96 polls over three runs.
Unknown symbols return Binance's own error code, `-1121 "Invalid symbol."`, wrapped in a 500.
The web app's trade page does not use these calls at all, and reads Binance's REST and socket directly, see [`websocket.md`](./websocket.md) section 1.

## 1. Host and latency from this machine

| item | value | evidence |
|---|---|---|
| hosts | `www.coinspace.world` (web app and `/proxy/api/v1/` relay) and `api.coinspace.world` (web app API base `https://api.coinspace.world/api` and Socket.IO) | S5 |
| resolved address | both names resolve to the same four CloudFront addresses, 3.175.34.6, .41, .82 and .92, edge `HIO52-P3` | section 1, response header `x-amz-cf-pop` |
| caching | every reply carried `x-cache: Miss from cloudfront`, so CloudFront passes calls through | section 4 |
| request time | cold 206 to 490 ms, warm 182 to 395 ms with medians 244 to 314 ms, over three runs | section 1 |
| access | no call was refused or geoblocked from the Canadian exit | sections 1 to 5 |

## 2. Catalog

### The calls

There are three symbol lists, and they disagree.

| call | rows | what it is | evidence |
|---|---|---|---|
| `GET https://api.coinspace.world/api/public/symbols` | 6, all `is_active: true`: BNB/USDT, BTC/USDT, DOGE/USDT, ETH/USDT, SOL/USDT, XRP/USDT | the web app's public symbol list, with tick sizes, quantity limits and `max_leverage` 100, 75 (SOL) or 50 (XRP) | section 2, S5 |
| `GET https://www.coinspace.world/proxy/api/v1/markets` | 28, every row `"type":"FUTURES"` | the feed CoinMarketCap reads, a 24 hour ticker per symbol | section 2, S2 |
| `GET https://www.coinspace.world/proxy/api/v1/fees` | 32 | the fee list, the 28 above plus ANKRUSDT, AXSUSDT, MKRUSDT and QTUMUSDT | section 2, [`fees.md`](./fees.md) section 2 |

The 6 catalog symbols are a subset of the 28, and all 28 are TRADING Binance USD-M perpetuals by `GET https://fapi.binance.com/fapi/v1/exchangeInfo`, section 2.
All 6 catalog tick sizes equal Binance's `PRICE_FILTER` `tickSize`, section 2.
Which list governs what a user can trade could not be settled without an account.
The 6 symbol catalog is the one the web app loads, so it is the active perpetual count used here: 6 USDT-margined, 0 USDC-margined, 0 inverse.

### One catalog row

```json
{"symbol_id": 1, "symbol": "BTC/USDT", "min_price": 556.8, "max_price": 4529764, "price_tick_size": 0.1, "min_quantity": 0.001, "max_quantity": 1000, "quantity_tick_size": 0.001, "market_min_quantity": 0.001, "market_max_quantity": 120, "min_notional": 50, "max_leverage": 100, "max_position_size": null, "is_active": true, "created_at": "2026-06-04T15:37:19.704130+00:00", "updated_at": "2026-06-04T15:37:24.503572+00:00"}
```

### Mapping

| item | value |
|---|---|
| `market.id` | No CCXT market exists. The catalog spells `BTC/USDT`, and the relay and Binance spell `BTCUSDT`. |
| contract size | Not publicly specified. Quantities are in the base coin (BTC step 0.001), as on Binance USD-M, so a contract size of 1 base unit is implied. |
| `linear` | yes, USDT-margined |
| status | `is_active` only |
| pair listed twice | no |

## 3. Anchor

COINSPACE publishes no index, mark or funding rate of its own, on any public call.

| tried | result | evidence |
|---|---|---|
| `/proxy/api/v1/premiumIndex`, `/funding`, `/fundingRate`, `/markPrice`, `/index`, `/time` | 404 `{"statusCode":404,"message":"Cannot GET ...","error":"Not Found"}` | section 5 |
| `api.coinspace.world/api/public/funding` and `/api/public/markets` | 404 | section 5 |
| Socket.IO `/market` namespace | advertises only `system_notifications` and `market_status` | [`websocket.md`](./websocket.md) section 2 |

The trade page shows mark, funding rate and countdown from `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=<SYMBOL>`, fetched by the browser, S6.
That call answered 200 from this host, section 5.
So the only anchor a COINSPACE leg could poll is Binance's, which the engine would already hold for its Binance leg.

## 4. Anchor semantics

FAQ Q14 says funding is "calculated every 8 hours based on the price difference between long and short positions", S4.
No formula, clamp, cap, index basket or mark rule is published.
Binance's `GET /fapi/v1/fundingInfo` puts MASKUSDT and MTLUSDT on 4 hours and the other 26 of the 28 relayed symbols on the default 8, section 5.
The 6 catalog symbols are all on 8 hours, so FAQ Q14 and Binance agree for them.
How the house computes its liquidation price is client code, `request_liquidation_price` on the user socket, and not a public number, S6.

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET https://www.coinspace.world/proxy/api/v1/depth?symbol=BTCUSDT` | section 3 |
| shape | `{"time": <ms>, "bids": [{"price": 82556.8, "volume": 7.67}, ...], "asks": [...]}`, numbers not strings | section 3 |
| depth | 10 levels per side by default, and `limit=50` and `limit=1000` return 50 and 1000, which is Binance's `limit` parameter passed through | section 3 |
| level order | bids descending, asks ascending | section 3 |
| sequence | none, Binance's `lastUpdateId` is dropped | section 3 |
| relay | over three runs of about 32 polls, best bid and ask equal to Binance's REST book on 31 of 31, 33 of 33 and 31 of 32, all 10 prices per side on 21, 26 and 27, and prices and sizes on 1, 2 and 6, with Binance read about 280 ms after COINSPACE | section 4 |
| freshness | the `time` field was 72 to 134 ms older than the local clock on arrival | section 4 |
| error | unknown or missing symbol: HTTP 500 `{"statusCode":500,"message":"HTTP 400: {\"code\":-1121,\"msg\":\"Invalid symbol.\"}"}` | section 5 |

The trades call returns 500 rows with `timestamp` in seconds and Binance's `trade_id`, and the ticker returns Binance's 24 hour statistics, section 3.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| published limits | none in documentation, but every reply carries `x-ratelimit-limit-short: 100` (reset 60 s), `x-ratelimit-limit-medium: 500` (900 s) and `x-ratelimit-limit-long: 1000` (3600 s) | section 2 headers |
| counters | `x-ratelimit-remaining-short` read 99 on several calls inside one minute and 67 after the 60 s poll, so the counters seem to be kept per backend instance | sections 3 and 4 |
| limit breach | not tested, the probe stayed under 40 calls a minute | this profile |
| unknown path | 404 with the NestJS shape `{"statusCode":404,"message":"Cannot GET <path>","error":"Not Found"}` | section 5 |
| login required | 401 `{"statusCode":401,"message":"Unauthorized"}`, for example `/api/membership/tiers` | section 5 |
| kept-alive connections | the edge closed a kept-alive connection left idle for over a minute without a reply, so the probe reconnects once | section 5 |

## 7. Server time

No time call exists, `/proxy/api/v1/time` is 404, section 5.
The `Date` header was within its one second resolution of the local clock, minus 0.53 to plus 0.01 s over three runs.
The ticker's `time` lagged the local clock by 1.7 to 6.2 s, which looks like Binance's last trade time rather than a server clock.

## 8. Recommended poller shape

None.
COINSPACE has no anchor of its own, its catalog is 6 Binance USD-M symbols, and its book and trades are Binance's.
A poller would read Binance's `premiumIndex` under a COINSPACE label.
If the house ever publishes its own book, a poller would start from `/api/public/symbols` for the catalog and would need a COINSPACE funding source that does not exist today.

## 9. Source ledger

| id | source | what it gave |
|---|---|---|
| S2 | `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinspace&category=spot` | 28 pairs, the same 28 as `/proxy/api/v1/markets` |
| S4 | `https://api.coinspace.world/api/notices`, FAQ Q14 | funding every 8 hours |
| S5 | `https://www.coinspace.world/assets/index-fccd3ab2.js` and `publicAPI-a3a9fbb0.js` | API base, `/public/symbols` |
| S6 | `https://www.coinspace.world/assets/FutureTradev1.5-6fa4af21.js` | Binance `premiumIndex`, `depth` and stream URLs, liquidation price socket event |
| S9 | Binance USD-M public REST, `https://fapi.binance.com/fapi/v1/exchangeInfo`, `/depth`, `/trades`, `/premiumIndex` and `/fundingInfo` | the comparison side of every relay check |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/coinspace/rest-probe.py) | every probed number here |

The ids match [`fees.md`](./fees.md) section 10.
