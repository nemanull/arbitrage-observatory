# Kanga Global REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:52 to 05:17 UTC, from the development host near Seattle.

This profile covers the public REST API of Kanga Global for its spot market, because Kanga lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): the spot catalog stands where the perpetual catalog would, and no anchor poller is recommended.
Every number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/kanga/rest-probe.mjs) or a source ledger row.
All traffic from this host leaves through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada, so every access result below is from that Canadian VPN exit.

Kanga documents two public APIs.
The Kanga Global API documentation at `https://apidoc.kanga.global/` names the base `https://api.kanga.global` and six public market calls, S1.
The CoinGecko and CoinMarketCap format API at `https://public.kanga.exchange/` names `https://pulbic.kanga.global` as its server, a misspelling that does not resolve, and the same paths answer on `public.kanga.global`, S2 and P1.
The web app adds listing calls of its own under `https://trade.kanga.global/api/`, S3.

## 1. Host and latency from this machine

| host | addresses on 2026-09-23 UTC | first request | warm requests |
|---|---|---|---|
| `api.kanga.global` | 172.66.158.195, 104.20.38.228, 2606:4700:10::6814:26e4, 2606:4700:10::ac42:9ec3 | 174 and 198 ms | 68 to 101 ms over 10 |
| `public.kanga.global` | the same four | 126 and 160 ms | 71 to 102 ms over 10 |
| `trade.kanga.global` | the same four | 141 and 132 ms | 70 to 88 ms over 10 |
| `ws.kanga.global` | the same four | see [`websocket.md`](./websocket.md) | |
| `public.kanga.exchange` | 104.20.21.239, 172.66.158.188 and two IPv6 | serves S2 | |
| `trade.kanga.exchange` | the same as `public.kanga.exchange` | HTTP 302 to `https://kanga.exchange` | |

The three `kanga.global` hosts returned byte-identical `pairs` replies, P1.
They differ on the book paths: `orderbook/raw?market=` answers on `api` and `trade` but gives 400 on `public`, and the CoinGecko form `orderbook/BTC_USDT` answers on `public` but gives 404 on `api`, P1.
Every reply came through Cloudflare with `cf-cache-status: DYNAMIC` from the Seattle or the Vancouver edge, P1.
Nothing refused this host: every documented public call answered 200, P1.
The one refusal-shaped answer was `trade.kanga.exchange`, which redirected every path to the `kanga.exchange` landing page, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

| call | reply | markets | id format | notes |
|---|---|---|---|---|
| `POST https://api.kanga.global/api/markets` with body `{}` | 118,789 and 118,810 bytes, 127 and 177 ms | 322, `result` `"ok"` | `BTC-USDT` | documented as "This call will be deprecated in the near future.", S1. Carries `pricePrecision`, `minAmount`, `type`, `kycRequired`, `bidsAvailableSince`, `asksAvailableSince`, `lastPrice`, `volume` |
| `POST https://trade.kanga.global/api/market/view/list` with body `{}` | 94,282 bytes | 322 | `BTC-USDT` | the web app's own list, adds `hidden` and `customMarketFeeRate`, S3 |
| `GET https://api.kanga.global/api/v2/market/pairs` | 18,058 bytes, 88 ms | 322 | `BTC_USDT` | CoinGecko format, and the `oPLN`, `oEUR` and `oUSD` quotes are renamed `PLN`, `EUR` and `USD` |
| `GET https://api.kanga.global/api/v2/market/ticker` | 29,826 bytes, 72 ms | 312 keys | `BTC-USDT`, with the same renames | last price and 24 h volumes |
| `GET https://api.kanga.global/api/v2/market/tickers` | 68,527 bytes, 89 ms | 312 | `BTC_USDT` | adds `bid`, `ask`, `high`, `low` |
| `GET https://api.kanga.global/api/v2/market/summary` | 77,667 bytes, 78 ms | 312 | `BTC-USDT` | CoinMarketCap format, adds `highest_bid` and `lowest_ask` |

The numbers are from the first P1 run at 04:53 UTC, and the rerun at 05:14 UTC gave the same counts.
Every market in `POST /api/markets` has `type` `NORMAL`, and every one had both `bidsAvailableSince` and `asksAvailableSince` in the past, P1.
Five markets carry `kycRequired` true: `BAR-USDC`, `GFK-USDC`, `INTER-USDC`, `LEG-USDC` and `SAM-USDC`, P1.
The web app hides three: `kERA-oEUR`, `kAMCA-oUSD` and `HERB-USDT`, P1 tag `view`.
There is no status field such as trading, halted or delisted.
`POST /api/markets` answers `GET` with 404 and an empty body, P1.

The market id of `POST /api/markets` is the id the socket takes, and the socket ignores the underscore form, see [`websocket.md`](./websocket.md) section 4.
The REST book accepts both forms, section 5.
Of the 322 CoinGecko pairs, 272 match a market id once the first underscore becomes a dash, and the other 50 are the renamed `oPLN`, `oEUR` and `oUSD` markets, P1.

### How CCXT 4.5.68 maps it

It does not.
CCXT 4.5.68 has no Kanga class, and the current CCXT master has none either, see [`fees.md`](./fees.md) section 8.
So there is no `market.id`, no `contractSize`, no `linear` and no `active` flag to compare, and the engine's catalog, which is CCXT `loadMarkets` filtered to swaps at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 68 and 200 to 201, has nothing to load.

### Size unit, pairs listed twice, and the settlement family

Sizes are in the base currency on the REST book and on the socket, see [`websocket.md`](./websocket.md) section 4.
There is no contract size and no price scale.

The USD settlement family, USDT, USDC and `oUSD`, holds 265 markets on 197 base assets, and 67 bases are listed in more than one of those quotes, mostly as both `-USDT` and `-USDC`, P1 tag `usd family`.
A spot integration would pick one market per base, as `marketFilter` does for perpetuals at [`types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/types.ts) lines 14 to 16.

`POST /api/markets` also carries `indexedMarket` and `indexedPayingCurrency` on every market, for example `"indexedPayingCurrency":"USDC","indexedMarket":"BTC-USDC"` on `BTC-USDT` and `"indexedMarket":"AAVE-EURC"` on `AAVE-oPLN`, P1.
No documentation explains these fields, S1, and they are not an index price.

## 3. Anchor

Kanga publishes no index price, no mark price and no funding rate for any spot market.
No call in S1 or S2 returns one, and no spot market is a derivative.

The only reference price Kanga publishes is the price of its operator-quoted leveraged futures, see [`fees.md`](./fees.md) section 3.

| call | reply | fields |
|---|---|---|
| `POST https://trade.kanga.global/futures/api/markets/list` with body `{}` | 8,208 and 8,204 bytes, 85 and 83 ms, 22 markets | `market`, `buyingCurrency`, `payingCurrency`, `minimumOrderValue`, `pricePrecision`, `longsAvailableSince`, `shortsAvailableSince`, `positionSizePrecision`, `feeRates`, `price` |
| `POST https://trade.kanga.global/futures/api/markets/price/get` with body `{"market":"BTC-USDC"}` | 34 bytes | `{"price":"87125.63","result":"ok"}` |

That price is the operator's settlement rate for its own contracts, not an index of other venues and not a mark of a traded perpetual.
It read 867 ppm below the `BTC-USDC` spot mid at 04:53 UTC and 1,016 ppm below it at 05:14 UTC, P1 tag `futures price vs spot`.
The spot mid there comes from the REST book, which can be up to 120 s old, section 5.
No call names its source or formula.

Nothing here can fill an `AnchorRow`.
A route with no anchor row is refused as `anchor_missing`, at [`anchorReading.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/anchorReading.ts) lines 25 and 26, and a row with a mark of 0 as `anchor_no_mark`, at lines 37 and 38.
So a Kanga leg could never pass the open gate in the engine's current shape.

## 4. Anchor semantics

None exist, see section 3.
For context, this is how often the one reference number and the REST book changed.

| number | polls | changes | source |
|---|---|---|---|
| futures `price` of `BTC-USDC` | 130, one a second | 40, about every 3.2 s | P2 at 05:05 UTC |
| the same, rerun | 130 | 28, about every 4.6 s | P2 at 05:15 UTC |
| `orderbook/raw` timestamp of `BTC-USDT` | 130, twice | 1 in each run | P2 |
| `orderbook/raw` timestamp of `ETH-USDC` | 130, twice | 1 in each run | P2 |
| `orderbook/raw` timestamp of `NEAR-USDT` | 130, twice | 1 in each run | P2 |

A futures price that changes every 3 to 5 s on average fits the cycle of about 3 s the socket pushes on, see [`websocket.md`](./websocket.md) section 4.
The settlement instant of the futures Funding Fee was not captured, and no public call returns its schedule, see [`fees.md`](./fees.md) section 6.

## 5. REST book snapshot

| call | depth | level order | reply | timestamp |
|---|---|---|---|---|
| `GET /api/v2/market/orderbook/raw?market=BTC-USDT` | 50 per side, no depth parameter | bids descending, asks ascending, `[price, size]` strings | 2,511 and 2,632 bytes, 67 to 164 ms over the three poll runs | Unix ms of the snapshot |
| `GET /api/v2/market/orderbook/BTC_USDT` on `public.kanga.global` | the same reply | the same | the same bytes | the same |
| `GET /api/v2/market/depth?market=BTC-USDT` | the whole book, 623 bids and 112 asks, then 622 and 135 | bids descending, asks descending with the worst first, `{"quantity","price"}` strings | 30,795 and 31,781 bytes, 67 and 97 ms | ISO string with nanoseconds |

The numbers are from P1 and P2.

### The REST book is a two minute cache

The `orderbook/raw` snapshot is rebuilt about every 120 s, and in between every request returns the same bytes.
In P2 each of three markets changed its timestamp once in 130 one-second polls, and the step between the old and the new timestamp was 120,205 ms on `NEAR-USDT`, 120,766 ms on `BTC-USDT` and 120,894 ms on `ETH-USDC`.
The last age seen before each refresh was 119,201 to 119,930 ms, and the first age after it 31 to 33 ms.
The three markets refreshed at different instants, 05:06:43, 05:07:03 and 05:07:20 UTC.
The rerun at 05:14 UTC gave steps of 120,567 to 120,774 ms, last ages of 119,615 to 119,830 ms and first ages of 52 to 54 ms, P2.
In the earlier 60-poll run no timestamp changed at all, and the age reached 85,089 ms, P2.
Meanwhile the socket pushed `BTC-USDT` changes every 3 to 10 s, see [`websocket.md`](./websocket.md) section 4.

The `depth` call is also stale: its timestamp read 108,301 ms old at 04:53 UTC and 73,305 ms old at 05:14 UTC, and its best bid differed from the `orderbook/raw` best bid read a moment before, P1.
The `changes` call read 58,319 and 25,265 ms old, P1.
The bulk `tickers` and `summary` calls agreed with each other and not with the book: at 05:14 UTC both gave 86844.61 and 87060.19 for `BTC-USDT` while `orderbook/raw` gave 86847.9 and 87064.19, P1 tag `bulk bid and ask against raw`.
A query parameter the call does not know, such as `nonce` or `depth`, turns the reply into HTTP 400 with an empty body, so a cache cannot be bypassed that way, P1.
So no Kanga REST call gives a current book, and the socket is the only live source.

## 6. Rate limits and errors

No rate limit is published in S1 or S2, and no reply carried a rate limit or `Retry-After` header, P1.
Twenty requests to `GET /api/v2/market/changes?market=BTC-USDT` at five a second all answered 200, with a median of 72 ms and a maximum of 104 ms, and 93 ms and 110 ms in the rerun, P1.
No 429 or 403 was seen in any run.

| request | status | body |
|---|---|---|
| `orderbook/raw?market=NOPE-USDT` | 200 | `{"timestamp":…,"bids":[],"asks":[],"ticker_id":"NOPE-USDT"}` |
| `orderbook/raw?market=BTC_USDT` | 200 | the `BTC-USDT` book |
| `orderbook/raw` without `market` | 400 | empty |
| `orderbook/raw?market=BTC-USDT&nonce=…` | 400 | empty |
| `orderbook/BTC_USDT?depth=5` on `public.kanga.global` | 400 | empty |
| `orderbook/raw?market=BTC-USDT` on `public.kanga.global` | 400 | empty |
| `orderbook/BTC_USDT` on `api.kanga.global` | 404 | empty |
| `depth?market=NOPE-USDT` | 200 | `{"timestamp":"…","bids":[],"asks":[]}` |
| `changes?market=NOPE-USDT` | 200 | `{"result":"fail"}` |
| `trades?market=NOPE-USDT` | 200 | `{"timestamp":…,"trades":[]}` |
| `GET /api/markets` | 404 | empty |
| `GET /api/v2/market/nope` | 404 | empty |

An unknown market is not an error on the book calls, it is an empty book with status 200.
The signed calls in S1 answer with a `result` and a `code`, and S1 lists a "Limit value exceeded" code for them, which a public call never returned here.

## 7. Server time and clock offset

No server time call exists in S1 or S2.
The `Date` header matched this host's clock to the second on 9 of 10 reads over two runs, P1 tag `clock`.
The tenth read one second ahead, with this host's request midpoint 37 ms before the second boundary, which still fits an offset under one second.
The book timestamps are snapshot times, not reply times, so they cannot measure the offset, section 5.

## 8. Recommended poller shape

No anchor poller is recommended, because Kanga publishes no index, mark or funding rate, section 3.
No REST book poller is recommended either, because the REST book is a snapshot up to 120 s old, section 5.
If Kanga spot were ever wired in, its catalog would come from `POST https://api.kanga.global/api/markets`, keyed by `id`, with `pricePrecision` kept for the socket, see [`websocket.md`](./websocket.md) section 8.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Kanga Global API documentation, OpenAPI 3.0.3 file `api.json`, `last-modified` 2026-06-30, server `https://api.kanga.global` | https://apidoc.kanga.global/assets/api.json | 2026-09-22 | Kanga Global | public calls, deprecation note, signed error codes, no rate limit, sections 2, 3, 6 and 7 |
| S2 | Public kanga.exchange API, OpenAPI 3.0.3 file `openapi.yaml`, `last-modified` 2026-07-20, server `https://pulbic.kanga.global` | https://public.kanga.exchange/openapi.yaml | 2026-09-22 | Kanga | CoinGecko and CoinMarketCap format calls, sections 2, 5 and 6 |
| S3 | Kanga Global web app bundle | https://trade.kanga.global/main.300e4a41cf127ad1a85e.bundle.js | 2026-09-22 | Kanga Global | the web app's listing call, section 2 |
| S4 | Kanga Futures web app bundle | https://trade.kanga.global/futures/assets/index-DYh-NeI9.js | 2026-09-22 | Kanga Global | the futures list and price calls, section 3 |
| P1 | `rest-probe.mjs main`, runs at 04:52 and 05:14 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kanga/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 7 |
| P2 | `rest-probe.mjs poll`, a 60-poll run of an earlier version at 04:53 UTC, and the 130-poll runs at 05:05 and 05:15 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/kanga/rest-probe.mjs) | 2026-09-22 | this host | sections 4 and 5 |
