# BTC Markets REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:25 to 04:47 UTC for the first pass and 04:53 to 04:57 UTC for the second pass, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public REST API v3 of BTC Markets (CCXT id `btcmarkets`) on its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): section 3 states that the venue publishes no index, mark or funding, and section 8 recommends no anchor poller.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/btcmarkets/rest-probe.mjs), run from `server/`.
The API documentation at `https://docs.btcmarkets.net/v3/` refused this host and a fetch that does not originate here with HTTP 403 and a Cloudflare challenge, see [`websocket.md`](./websocket.md) section 9, so the documented limits and formulas of v3 are Not read, and every protocol number below is what the wire returned.

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| REST base | `https://api.btcmarkets.net/v3`, CCXT `urls.api.public` at `server/node_modules/ccxt/js/src/btcmarkets.js` line 129 | S2 |
| resolved addresses | `172.66.159.101`, `104.20.26.220`, `2606:4700:10::6814:1adc`, `2606:4700:10::ac42:9f65`, all Cloudflare, and `socket.btcmarkets.net` resolved to the same four | R1 |
| edge | `cf-ray` suffix `SEA` on most replies and `YVR` on some, and `/cdn-cgi/trace` reported `colo=YVR` and `loc=CA`, which is the Canadian VPN exit | R1, and a `curl` of the trace at 04:25 UTC |
| cold request | 240 and 230 ms for `GET /v3/time` on a new connection, with the first byte at 238 and 226 ms | R1, R5 |
| warm requests | 165 to 176 ms for `GET /v3/time` on a kept connection | R1, R5 |
| `curl` with a new TLS connection per call | 0.40 to 0.43 s | first look at 04:26 UTC |
| refusals | none: every public call answered 200 or a JSON error of its own, and no status 403 or challenge was seen on `api.btcmarkets.net` | R1 to R5 |

The website `www.btcmarkets.net` and the documentation host answered the same host with HTTP 403 and `cf-mitigated: challenge`, while the API host did not, see [`fees.md`](./fees.md) section 1.

## 2. Catalog

### The instruments call

`GET /v3/markets` returns every market in one array of 9,168 bytes in 173 and 165 ms, R1 and R5.
Each row carries `marketId`, `baseAssetName`, `quoteAssetName`, `minOrderAmount`, `maxOrderAmount`, `amountDecimals`, `priceDecimals` and `status`.

| item | value on 2026-09-23 |
|---|---|
| markets | 51 |
| `status` | `Online` 49, `Offline` 2: MCAU-AUD and RLUSD-AUD |
| quote currency | AUD 44, USDT 4 (AUDM-USDT, BTC-USDT, ETH-USDT, XRP-USDT), BTC 3 (ETH-BTC, LTC-BTC, XRP-BTC) |
| perpetuals, futures, options | none |

### How CCXT 4.5.68 maps it

| item | value | source |
|---|---|---|
| markets after `loadMarkets` | 51, all `type: 'spot'`, 0 swaps | R1, R5 |
| `market.id` | `marketId`, such as `BTC-AUD`, equal to the REST id on 51 of 51 and to the socket's `marketId` | R1, `btcmarkets.js` line 511, [`websocket.md`](./websocket.md) section 3 |
| `active` | `status === 'Online'`, so 49 active | `btcmarkets.js` line 539, R1 |
| `contractSize`, `linear` | `undefined` | `btcmarkets.js` lines 541 and 545 |
| `taker`, `maker` | AUD markets 0.0085 and 0.0085, USDT and BTC markets 0.002 and -0.0005, see [`fees.md`](./fees.md) section 8 | R1 |
| swap, future, option support | `'swap': false`, `'future': false`, `'option': false` | `btcmarkets.js` lines 30 to 32 |

The connector keeps only active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 202, so all 51 markets are dropped and the venue is skipped with `no usable swap markets; skipping the venue` at line 51.
The size unit is the base currency on every market, which is what a missing `contractSize` of 1 describes, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 175 and 188 to 191.

### Settlement family and pairs listed twice

Four markets are quoted in USDT, which is in the engine's USD, USDC and USDT family, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
The other 47 are quoted in AUD or BTC.
BTC is listed against AUD and USDT, ETH and XRP against AUD, USDT and BTC, and LTC against AUD and BTC, and each of those is a separate book with its own depth.
USDC and USDT are listed as base currencies against AUD, as `USDC-AUD` and `USDT-AUD`.
No price scale applies, since no market is quoted per 10 or per 1,000 units.

## 3. Anchor

BTC Markets publishes no index price, no mark price and no funding rate, because it lists no perpetual.

| `AnchorRow` column | field | call |
|---|---|---|
| key | none | none |
| `index` | none | none |
| `mark` | none | none |
| `fundingRate` | none | none |
| `fundingIntervalHours` | none | none |
| `nextFundingAt` | none | none |

CCXT marks `fetchFundingRate`, `fetchFundingRates` and `fetchMarkPrices` false, at `btcmarkets.js` lines 67, 69 and 87.
The reference prices it does publish are these, none of them an index.

| call | what it returns | size and time |
|---|---|---|
| `GET /v3/markets/tickers?marketId=…&marketId=…` | per market `bestBid`, `bestAsk`, `lastPrice`, 24 h volume, change, low and high, and `timestamp` | all 51 ids in one call: 51 rows, 12,583 bytes, min 201, median 239, p90 283, max 303 ms over 30 polls, and min 183, median 233, max 283 ms in the second run, R2 and R5 |
| `GET /v3/markets/{marketId}/ticker` | the same for one market | 169 ms, R4 |
| `GET /v3/markets/{marketId}/candles?timeWindow=1m` | OHLCV rows `[time, open, high, low, close, volume]` | 180 ms, R4 |

`GET /v3/markets/tickers` without `marketId` answers 400 `MissingArgument`, and one unknown id in the list answers 400 `InvalidMarketId` for the whole call, R2 and R4.
CCXT does not declare `fetchTickers`, and the call appears only in its endpoint list at `btcmarkets.js` line 146.

## 4. Anchor semantics

None.
With no index, mark or funding, there is no formula, basket, clamp or settlement to record.

What the bulk ticker did over 30 one second polls, in R2 and then R5:

| market | `bestBid` changed | `bestAsk` changed | `lastPrice` changed | `timestamp` changed |
|---|---:|---:|---:|---:|
| BTC-AUD | 8 and 0 of 29 steps | 20 and 29 | 0 and 0 | 21 and 29 |
| ETH-AUD | 24 and 23 | 18 and 2 | 2 and 0 | 27 and 23 |
| XRP-AUD | 20 and 17 | 18 and 10 | 0 and 0 | 27 and 22 |
| BTC-USDT | 2 and 2 | 1 and 2 | 0 and 0 | 2 and 2 |
| OMG-AUD | 0 and 0 | 0 and 0 | 0 and 0 | 0 and 0 |

The ticker `timestamp` is the time of the market's last book change, not the time of the reply.
Arrival minus `timestamp` over all rows was min 85 and 94 ms, median 2,838 and 3,531 ms, and max 5,302,675,706 and 5,303,171,842 ms, which is about 61 days on an offline market, R2 and R5.
A reader of this call has to stamp readings on arrival.

## 5. REST book snapshot

| call | depth | shape | age of `snapshotId` at arrival | caching |
|---|---|---|---|---|
| `GET /v3/markets/{marketId}/orderbook`, level 1, the default | the best 50 orders per side, which were 39 bid and 43 ask prices on BTC-AUD in both runs | `[price, amount]` strings, bids descending, asks ascending, 2,223 bytes, 176 ms | min 91 and 87, median 154 and 128, max 552 and 165 ms over 10 reads | 0 of 9 consecutive reads repeated a `snapshotId` in either run, R3 and R5 |
| `…/orderbook?level=2` | every resting order: 2,028 bids and 855 asks over 1,044 and 551 prices on BTC-AUD | same, 55,085 bytes, 179 ms | min 1,109 and 145, median 3,307 and 5,180, max 8,180 and 8,111 ms | 6 and 5 of 9 consecutive reads repeated a `snapshotId`, so the full book is served from a cache up to about 8 s old, R3 and R5 |
| `…/orderbook?level=3` | none | 400 `InvalidOrderbookLevel` | | R4 |
| `GET /v3/markets/orderbooks?marketId=…&marketId=…` | level 1 for each id | an array of `{marketId, snapshotId, asks, bids}`, 3 markets in 5,921 bytes and 175 ms, all 51 in 67,679 bytes and 232 ms, and 211 ms in the second run | | R3 and R5 |

Every REST book lists single orders, with no count field, so two orders at one price are two entries.
Only the socket's `orderbookUpdate` channel aggregates by price, see [`websocket.md`](./websocket.md) section 4.
The replies carry `cache-control: no-cache, no-store, must-revalidate` and `cf-cache-status: DYNAMIC`, which points to a cache at the origin rather than at Cloudflare.
CCXT's comment at `btcmarkets.js` line 24 says "market data cached for 1 second (trades cached for 2 seconds)".
The offline MCAU-AUD answers 200 with both sides empty and a `snapshotId` of 1750727357660000, which is 2025-06-24 01:09 UTC, R3.

## 6. Rate limits and errors

The v3 documentation that states the limits could not be read, see the introduction.
CCXT throttles to one request per second, `'rateLimit': 1000` at `btcmarkets.js` line 24.
The replies carry their own counters, R1 to R5:

| calls | `x-ratelimit-limit` | reset seen |
|---|---:|---|
| `/v3/markets`, `/v3/markets/tickers`, `/v3/markets/orderbooks`, `/v3/markets/{id}/candles` | 150 | 1 to 10 s ahead |
| `/v3/markets/{id}/ticker`, `/v3/markets/{id}/orderbook`, `/v3/markets/{id}/trades` | 300 | 1 to 10 s ahead |
| `/v3/time` | 100 | 4 s ahead, one `curl` at 04:59 UTC |
| the WebSocket upgrade | 20 | 2 to 9 s ahead |
| an unknown path | none | |

The reset was never more than 10 s ahead, which suggests a 10 s window, but that is an inference.
The probe stayed at about three requests a second at most, so no limit was reached, and the status code, body and `Retry-After` of a refusal are Not verified.

| request | status | body |
|---|---:|---|
| `/v3/markets/NOPE-AUD/orderbook` | 404 | `{"code":"MarketNotFound","message":"market not found"}` |
| `/v3/markets/btc-aud/orderbook` | 404 | `MarketNotFound`, so ids are case sensitive |
| `/v3/markets/BTC-AUD/orderbook?level=3` | 400 | `{"code":"InvalidOrderbookLevel","message":"invalid orderbook level"}` |
| `/v3/markets/tickers` without ids | 400 | `{"code":"MissingArgument","message":"missing marketId argument"}` |
| `/v3/markets/tickers` with one unknown id | 400 | `{"code":"InvalidMarketId","message":"invalid marketId"}` |
| `/v3/nope` | 404 | `{"code":"NotFound","message":"Not Found"}` |

## 7. Server time and clock offset

`GET /v3/time` answers `{"timestamp":"2026-09-23T04:45:22.416000Z"}`, an ISO string with microsecond digits that are always zero, R1.
Against the midpoint of each request, the server clock was 4 to 6 ms ahead of this host over five reads, and 2 to 3 ms ahead in the second run, R1 and R5.

## 8. Recommended poller shape

None.
BTC Markets publishes no index, mark or funding, so it has no anchor poller, and the connector drops all 51 markets before a poller could run.
If a later design admits spot legs, the book socket of [`websocket.md`](./websocket.md) section 8 carries everything a leg needs.
The bulk ticker is the only REST call worth polling for a cross check, one call for every market at about 240 ms, well inside its 150 counter, and its `timestamp` must not be read as the reading time.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BTC Markets API v3 documentation | https://docs.btcmarkets.net/v3/ | 2026-09-22, refused | BTC Markets | not read, HTTP 403 with a Cloudflare challenge |
| S2 | CCXT 4.5.68 `btcmarkets.js` | `server/node_modules/ccxt/js/src/btcmarkets.js` | 2026-09-22 | CCXT | URLs at lines 126 to 137, public endpoint list at lines 139 to 150, `rateLimit` and its comment at line 24, `has` flags, `parseMarket` at lines 508 to 575 |
| R1 | `rest-probe.mjs catalog` at 04:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcmarkets/rest-probe.mjs) | 2026-09-23 | this host | sections 1, 2 and 7 |
| R2 | `rest-probe.mjs poll` at 04:45 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcmarkets/rest-probe.mjs) | 2026-09-23 | this host | sections 3 and 4 |
| R3 | `rest-probe.mjs book` at 04:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcmarkets/rest-probe.mjs) | 2026-09-23 | this host | section 5 |
| R4 | `rest-probe.mjs errors` at 04:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcmarkets/rest-probe.mjs) | 2026-09-23 | this host | sections 3 and 6 |
| R5 | second pass: `rest-probe.mjs catalog`, `poll`, `book` and `errors` at 04:53 to 04:54 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/btcmarkets/rest-probe.mjs) | 2026-09-23 | this host | the second readings of sections 1 to 7 |
