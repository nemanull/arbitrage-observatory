# Blynex REST Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:50 to 04:10 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public REST API of Blynex for its spot market, because Blynex lists no order book perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): the spot catalog stands where the perpetual catalog would, and no anchor poller is recommended.
Every number comes from [`rest-probe.py`](../../../scripts/probes/venues/blynex/rest-probe.py), [`fees-probe.py`](../../../scripts/probes/venues/blynex/fees-probe.py), [`ws-probe.py`](../../../scripts/probes/venues/blynex/ws-probe.py) or a source ledger row.
The REST probe ran three times, and where the runs differ the range is given.
All traffic left through the Canadian exit, which geolocated to Vancouver.

Blynex documents one public API, an apidoc page at `https://api.blynex.com/` with base URL `https://api.blynex.com`, S1.
It lists eleven GET calls in the CoinMarketCap and CoinGecko aggregator shapes: `/v1/info`, `/v1/time`, `/v1/assets`, `/v1/market`, `/v1/ticker`, `/v1/orderbook`, `/v1/trades`, `/v1/klines`, `/v2/tickers`, `/v2/orderbook` and `/v2/historical_trades`.
The futures web app adds its own REST base, `https://futures.blynex.com/api`, which is undocumented, S2.

## 1. Host and latency from this machine

| host | resolved | result | evidence |
|---|---|---|---|
| `api.blynex.com` | Cloudflare, `104.26.4.227`, `104.26.5.227` and `172.67.71.89`, plus three IPv6 addresses | `/v1/time` cold 527 to 533 ms, warm median 194 to 205 ms over five more calls | P1 section `hosts` |
| `futures.blynex.com` | the same Cloudflare addresses | `/api/pairs/list` answered 200 in 503 to 548 ms | P1 section `catalog` |
| `blynex.com` | the same Cloudflare addresses | home, fee, terms and futures guide pages 200. `/spot/BTC_USDT` and `/spot/ETH_USDT` 403 with `cf-mitigated: challenge` and the title "Just a moment..." | P1 section `hosts` |
| `docs.blynex.com` | the same Cloudflare addresses | 301 to `https://api.blynex.com/` | P1 section `hosts` |
| `ws`, `wss`, `stream`, `socket`, `spot`, `trade` and `exchange` subdomains | no DNS record | | P1 section `hosts` |

No geoblock was met on any API call.
The Cloudflare challenge guards only the spot trading page, and it was not bypassed.

## 2. Catalog

### The instruments call

`GET https://api.blynex.com/v1/market` returns every spot pair in one reply, 221 rows, about 84 KB, in 663 to 751 ms, P1 section `catalog`.

| field | example | meaning |
|---|---|---|
| `id` | `BTC_USDT` | pair id, base and quote joined by an underscore, the same spelling the book call takes as `market_id` |
| `type` | `spot` | `spot` on all 221 rows |
| `base`, `quote` | `BTC`, `USDT` | asset codes |
| `lastPrice`, `askPrice`, `bidPrice`, `avgPrice` | `82584.14` | JSON numbers |
| `baseVolume`, `quoteVolume`, `tradesCount_24h` | | 24 hour statistics |
| `openTime`, `closeTime` | `1791517872` | Unix seconds, a rolling 24 hour window |
| `makerFee`, `takerFee` | `0.25` | percent, see [`fees.md`](./fees.md) section 4 |

| count | value |
|---|---|
| spot pairs | 221: 212 quoted in USDT, 7 in EUR and 2 in USDB |
| pairs with no bid or no ask | 4 |
| pairs with zero base volume | 2 |
| crossed rows | 0 |
| status field | none, no row says whether a pair is halted |

`/v2/tickers` returns the same 221 ids, about 59 KB, and `/v1/ticker` returns them as a map keyed by id, about 56 KB, P1 section `catalog`.
`/v1/assets` returns 216 assets with deposit, withdrawal and trade status flags and fees.
`/v1/info` reports the capabilities `markets`, `trades` and `ordersSnapshot` as true and `candles` and `ticker` as false, though `/v1/ticker` and `/v1/klines` are documented.

The futures pair list, `GET https://futures.blynex.com/api/pairs/list`, returns 20 instruments, 4,049 bytes: 16 Crypto, 3 Forex and 1 Commodities, with the fields `pair`, `category`, `spread`, `tickSize`, `decimal`, `initialMarginMultiplier`, and on two rows `openFee` and `closeFee`, P1 section `catalog`.
The ids have no separator, such as `BTCUSDT`.
It has no status, contract size, settlement or funding field.

### How CCXT 4.5.68 maps it

CCXT 4.5.68 has no Blynex class, and CCXT master at commit `f0aca06` has none either, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, `contractSize`, `linear` or `active` to compare.

### Size unit, pairs listed twice, and the settlement family

Spot book sizes are in the base asset, for example `0.00061` BTC on a BTC_USDT level, P1 section `book`.
XRP and JYAI are each listed against two quotes, `XRP_USDT` and `XRP_EUR`, `JYAI_USDT` and `JYAI_USDB`.
USDB is not one of the engine's USD, USDC and USDT settlement family.

## 3. Anchor

Blynex publishes no index price, no mark price and no funding rate for any spot pair, and none for its futures product.
No documented call returns one, S1, and the futures pair list has no such field, P1 section `catalog`.
The futures guide says "Blynex does not charge: Trading fees, Funding fees, Swap fees, or Overnight fees", so no funding interval or settlement time exists, S3.

The only reference prices Blynex publishes are its own.

| source | what it is | evidence |
|---|---|---|
| `/v1/market` `lastPrice` | the spot last trade | P1 section `catalog` |
| `/v1/ticker` `avgPrice` | a 24 hour average price | P1 section `catalog` |
| `https://blynex.com/api-chart/datafeed/last_day_prices` | hourly prices per pair for the home page charts | S4 |
| futures socket `BROADCAST_LAST_PRICE` | the dealer price of each futures instrument, about once a second | [`websocket.md`](./websocket.md) section 4 |

None is an index of other venues or the mark of a traded perpetual.
Nothing here can fill an `AnchorRow`, whose `mark` of 0 means the venue publishes none, at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) lines 27 to 34.
A leg with no anchor row is refused as `Missing`, at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) lines 25 to 27, and a leg with no mark as `NoMark`, at lines 37 to 39.
So a Blynex leg could never pass the open gate in the engine's current shape.

## 4. Anchor semantics

Not applicable, since no index, mark or funding exists.

The spot prices themselves were compared with OKX's public BTC-USDT, ETH-USDT, SOL-USDT and XRP-USDT tickers, read moments apart, P1 section `touch`.

| pair | REST book mid against OKX mid | `/v1/market` last against OKX mid | book mid against `/v1/market` bid and ask mid |
|---|---|---|---|
| BTC_USDT | 314 ppm below to 593 ppm above | 125 ppm below to 89 ppm above | 189 ppm below to 504 ppm above |
| ETH_USDT | 45 to 490 ppm above | 22 to 98 ppm above | 27 ppm below to 447 ppm above |
| SOL_USDT | 41 to 1,015 ppm above | 45 to 1,019 ppm above | 0 to 314 ppm above |
| XRP_USDT | 462 to 1,029 ppm above | 462 to 1,033 ppm above | 4 ppm below to 0 ppm |

On BTC and ETH the REST book and the `/v1/market` bid and ask disagreed by up to 504 ppm, so they are not the same book.
Over 30 one second polls, `/v1/market` BTC_USDT `lastPrice` changed 1 to 2 times and its bid and ask 0 to 1 times, while the REST book touch changed 3 times in every run, P1 section `polls`.
CoinMarketCap tags Blynex "Auto Order Book Exchange", S5.
Together these suggest an automatically generated book around an outside price, but Blynex does not say so, so the label stays Not publicly specified.

## 5. REST book snapshot

`GET https://api.blynex.com/v1/orderbook?market_id=BTC_USDT`, P1 section `book`.

| parameter | effect on the wire |
|---|---|
| none | the whole book, 67 to 69 bids and 71 to 73 asks, about 3 KB |
| `limit=N` | N levels in total, split evenly: `limit=10` gave 5 and 5, `limit=40` gave 20 and 20, `limit=100` gave 50 and 50, `limit=1000` gave the whole book |
| `limit=abc` | ignored, the whole book |
| `level=1` | the touch only, 1 and 1 |
| `level=2` | 47 bids and 47 to 49 asks |
| `level=3` | the whole book |

`/v2/orderbook?ticker_id=BTC_USDT&depth=40` returns the same levels with `ticker_id` and `timestamp` keys in place of `lastUpdated`.
Bids are descending and asks ascending, each level a two element array `[price, size]` of JSON numbers.
`lastUpdated` is Unix seconds and changed on 19 to 29 of 30 one second polls while the touch changed 3 times, so it tracks the server's clock and not the book's last change.
Two reads 300 ms apart were identical in two runs and differed in one.
The reply carries `cf-cache-status: BYPASS` and no `Cache-Control`.
Book calls took 505 to 639 ms in the parameter sweep and a median of 206 to 221 ms in the one second polls of one URL, with a maximum of 302 ms.
At the moment of the probe the BTC_USDT spread was 144 to 159 ppm, and the top 20 levels held about 46,000 to 68,000 USDT on the bid side and 58,000 to 72,000 USDT on the ask side.

## 6. Rate limits and errors

No rate limit is published, S1, and no reply carries a rate limit or `Retry-After` header, P1 section `limits`.
A burst of 20 calls at 4 a second all answered 200.

| request | status | body |
|---|---|---|
| `/v1/orderbook?market_id=NOPE_USDT` | 404 | `{"errorCode":404,"message":"Invalid Market"}` |
| `/v1/orderbook` with no market | 400 | `{"errorCode":400,"message":"Invalid Request. Please specify market_id parameter"}` |
| `/v1/market?pair=NOPE_USDT` | 404 | `{"errorCode":404,"message":"Invalid Pair"}` |
| `/v2/orderbook?ticker_id=NOPE_USDT` | 404 | `{"errorCode":404,"message":"Invalid Market"}` |
| `/v1/nope` | 404 | `Not Found` |
| `futures.blynex.com/api/pairs/NOPEUSDT` | 404 | `{"message":"pair not found","error":"error.not.found","statusCode":404}` |

## 7. Server time and clock offset

`GET https://api.blynex.com/v1/time` returns `{"serverTime":1791604719}`, Unix seconds.
The offset against this host's clock read -0.2 to -1.0 s, which is within the one second resolution plus the request time, P1 section `limits`.

## 8. Recommended poller shape

No anchor poller is recommended, because Blynex publishes no index, mark or funding, section 3.
The Gate adapter's anchor at [`anchor.rs`](../../../server/src/venues/gate/anchor.rs) shows what a fitting venue provides, and Blynex has no call that could feed one.

For a future spot leg, the catalog would be `/v1/market` filtered to USDT pairs with both a bid and an ask, and the per pair `takerFee` would set the taker.
The REST book would be the only book source, [`websocket.md`](./websocket.md) section 8.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Blynex API documentation, apidoc 1.0.0, and its bundle `assets/main.bundle.js` with the embedded call list | https://api.blynex.com/ | 2026-10-09 | Blynex | the eleven calls, parameters and fields, sections 1 to 6 |
| S2 | Blynex futures web app bundle chunks | https://blynex.com/futures/BTCUSDT | 2026-10-09 | Blynex | the futures REST base and paths, section 1 |
| S3 | "BLYNEX FUTURES Official User Guide & Product Specification, Version 1.2" | https://blynex.com/blynex-hybrid-forex-crypto-future/ | 2026-10-09 | Blynex | no funding, section 3 |
| S4 | Blynex home page chart data feed | https://blynex.com/api-chart/datafeed/last_day_prices | 2026-10-09 | Blynex | hourly reference prices, section 3 |
| S5 | CoinMarketCap data API, exchange `blynex` | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=blynex | 2026-10-09 | CoinMarketCap | the "Auto Order Book Exchange" tag, section 4 |
| P1 | `rest-probe.py`, sections `hosts`, `catalog`, `book`, `touch`, `polls`, `limits`, `bundle` and `app`, three runs | [`rest-probe.py`](../../../scripts/probes/venues/blynex/rest-probe.py) | 2026-10-09 | this host, Canadian exit | every probed row |
