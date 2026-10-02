# Independent Reserve REST Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:21 to 03:58 UTC, first pass and second pass, from the development host near Seattle.

This profile covers the public REST API of Independent Reserve (CCXT id `independentreserve`) for its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every number below comes from [`rest-probe.mjs`](../../../scripts/probes/venues/independentreserve/rest-probe.mjs), whose runs are the P rows of section 9, or from a source row or a CCXT file and line.

## 1. Host and latency from this machine

| host | resolves to | behind |
|---|---|---|
| `api.independentreserve.com` | CNAME `lbapiweb-1187875995.ap-southeast-2.elb.amazonaws.com`, A `15.134.255.163` and `15.135.50.203` | an AWS load balancer in Sydney |
| `websockets.independentreserve.com` | CNAME `lbpushservice-1094309711.ap-southeast-2.elb.amazonaws.com`, A `52.62.107.2` and `52.62.123.140` | an AWS load balancer in Sydney |
| `www.independentreserve.com` | A `104.18.20.197` and `104.18.21.197` | not a load balancer name, the documentation host |

| request | P1 | P4 |
|---|---|---|
| cold `GET /Public/GetValidPrimaryCurrencyCodes`, with DNS and TLS | 656 ms | 661 ms |
| warm, five requests one second apart | 153, 153, 154, 154 and 156 ms | 153, 153, 155, 156 and 156 ms |

Every public call answered 200 without a key, and no reply carried a refusal, a challenge or a region notice.
A reply carries only `connection`, `content-type`, `date` and `transfer-encoding` headers, so no rate limit header, server name or cache header is exposed, P1 and P4.
The DNS answers were the same in both passes.

## 2. Catalog

### The instruments call

The API has no instruments call.
The catalog is two lists of currency codes, S1.

| call | reply on 2026-09-22 |
|---|---|
| `GET https://api.independentreserve.com/Public/GetValidPrimaryCurrencyCodes` | 42 codes: `Xbt`, `Eth`, `Sol`, `Xrp`, `Usdc`, `Usdt`, `Aave`, `Ada`, `Audm`, `Audx`, `Ausd`, `Avax`, `Bat`, `Bch`, `Bonk`, `Comp`, `Dai`, `Doge`, `Dot`, `Etc`, `Grt`, `Hype`, `Link`, `Ltc`, `Mana`, `Pengu`, `Pepe`, `Pol`, `Render`, `Rlusd`, `Sand`, `Shib`, `Sky`, `Snx`, `Trump`, `Trx`, `Uni`, `Wif`, `Xaut`, `Xlm`, `Yfi`, `Zrx` |
| `GET https://api.independentreserve.com/Public/GetValidSecondaryCurrencyCodes` | `["Aud","Usd","Nzd","Sgd"]` |
| `GET https://api.independentreserve.com/Public/GetOrderMinimumVolumes` | 42 entries, `Xbt` 0.000007 |

No call returns a status, a tick size or a per pair flag.
The API page lists price and volume decimal places per currency in a table, for example 8 and 2 for `Xbt` and 0 and 8 for `Pepe`, S1.
Every one of the 168 combinations answered `GetMarketSummary` with 200 and a bid and an ask, in P2 and P4.

### How CCXT 4.5.68 maps it

| field | CCXT | source |
|---|---|---|
| market list | the cross product of the 42 primary and 4 secondary codes, 168 markets, 42 per quote | `server/node_modules/ccxt/js/src/independentreserve.js` lines 324 to 400, P1 |
| `market.id` | `baseId + '/' + quoteId`, for example `Xbt/Aud` | line 347 |
| `symbol` | `BTC/AUD`, because CCXT renames `Xbt` to `BTC`, the only renamed code | P1 |
| `type`, `spot`, `swap` | `spot`, `true`, `false` on all 168 | lines 357 to 360, P1 |
| `active` | `undefined` on all 168 | line 363 |
| `linear`, `contractSize` | `undefined` on all 168, so the connector would take a contract size of 1 | lines 365 and 367, and [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 188 to 191 |
| `precision` | `amount` and `price` both `undefined` | lines 372 to 375, P1 |
| `limits.amount.min` | from `GetOrderMinimumVolumes`, 0.000007 for `BTC/AUD` | line 343, P1 |

`market.id` is spelled neither as the socket subscription nor as the socket channel.
The socket takes `xbt-aud` or `btc-aud` in any case and answers on channel `orderbook/<depth>/btc/aud`, see [`websocket.md`](./websocket.md) section 3.
A feed would map `Xbt/Aud` to `btc/aud` by lower casing and renaming `xbt` to `btc`.
The book size unit is the base currency, "Order volume in primary currency", S1, which matches the contract size of 1.

### One book per base currency, shown in four fiat currencies

The four quotes of a base currency are one pool of orders shown in each fiat at a conversion rate.
In P1 the `Xbt/Usd` REST book held 1,028 bids, and 1,004 of their volumes also appeared in the `Xbt/Aud` book, read one second earlier.
In P4 it was 1,004 of 1,027.
The USD price of those shared orders divided by their AUD price was 0.707 at the median in P4, which was the `GetFxRates` AUD to USD rate read the same second.
In P1 the top of the USD book held two orders that were only in the USD book, `86573.79` for 0.12797299 and `86543` for 0.02, above the converted AUD best bid of `86296.42`.
In P4 the top three USD bids were all converted AUD orders.
The socket shows the same pooling: every order event arrives once on each of the four fiat channels of its base currency, see [`websocket.md`](./websocket.md) section 4.

So the 168 CCXT markets are 42 order pools, and the USD, NZD and SGD books move with the venue's FX rate as well as with orders.
A secondary code the catalog does not list also answers: `GetMarketSummary` for `Xbt` in `Eur` returned 200 with a EUR bid and ask, and the socket served `xbt-eur`, see [`websocket.md`](./websocket.md) section 4.
The first 200 characters of the EUR summary, which hold the 24 h figures, the bid of 75,477.8 and the ask of 75,486.1, were the same at 03:22 and 03:54 UTC, P1 and P4, so the REST EUR view is not live.

### Settlement family and pairs listed twice

No market is quoted in USDT or USDC.
USDT, USDC, RLUSD, AUSD, AUDM, AUDX and DAI are base currencies quoted in the four fiat currencies.
The 42 `Usd` markets are the only ones near the engine's USD, USDC and USDT family, see [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md), and the `Xbt/Usd` book is mostly converted AUD orders.
No pair is listed twice within one quote.

| quote | listed | two-sided in `GetMarketSummary` | crossed | traded in this fiat in the last 24 h | 24 h notional in AUD |
|---|---:|---:|---:|---:|---:|
| AUD | 42 | 42 | 0 | 40 | 7,349,760 |
| USD | 42 | 42 | 0 | 23 | 9,753,574 |
| NZD | 42 | 42 | 0 | 19 | 679,357 |
| SGD | 42 | 42 | 0 | 25 | 1,607,617 |

The table is the second sweep, P4, at 03:54 UTC.
The notional is `DayVolumeXbtInSecondaryCurrrency` times `LastPrice`, converted to AUD at `GetFxRates`.
`Rlusd/Usd` was 9,245,941 AUD of the USD total, and the next USD pairs were `Usdt/Usd` at 230,986 AUD, `Usdc/Usd` at 106,594 AUD and `Xbt/Usd` at 49,042 AUD.
The largest pair after it was `Xbt/Aud` at 2,877,868 AUD.

`DayVolumeXbt` in `GetMarketSummary` is the base currency's volume over every fiat, so it is the same number on all four quotes of a base, and `DayVolumeXbtInSecondaryCurrrency` is the part traded in the pair's own fiat, in base units, P2.
The USD quoted spreads at the touch in P2 ran from 200 ppm on `Ausd/Usd` to 438,188 ppm on `Pepe/Usd`, with 1,223 ppm on `Xbt/Usd` and 1,300 ppm on `Eth/Usd`.
In P4 they ran from 200 to 235,963 ppm with a median of 20,316 ppm, 861 ppm on `Xbt/Usd` and 1,298 ppm on `Eth/Usd`.

## 3. Anchor

Independent Reserve publishes no index price, no mark price and no funding rate, because it lists no perpetual.

| `AnchorRow` column | field | call |
|---|---|---|
| key | none | none |
| `index` | none | none |
| `mark` | none | none |
| `fundingRate` | none | none |
| `fundingIntervalHours` | none | none |
| `nextFundingAt` | none | none |

The reference prices it does publish are these.

| call | what it returns | cache | P1 |
|---|---|---|---|
| `GET /Public/GetFxRates` | the fiat rates "used by Independent Reserve when depositing funds or withdrawing funds", 30 rows among AUD, EUR, HKD, NZD, SGD and USD | "caches return values for 1 minute", S1 | 154 ms |
| `GET /Public/GetMarketSummary?primaryCurrencyCode=xbt&secondaryCurrencyCode=aud` | one pair: `CurrentHighestBidPrice`, `CurrentLowestOfferPrice`, `LastPrice`, `DayAvgPrice`, the 24 h high, low and volumes | "caches return values for 1 second", S1 | 153 ms |

There is no bulk ticker, so a reading of every pair takes 168 calls, which took 194 s in P2 and 168 s in P4 at one call per second.
CCXT marks `fetchFundingRate`, `fetchMarkPrice` and `fetchMarkPrices` false, at `independentreserve.js` lines 63, 83 and 84.

## 4. Anchor semantics

None.
With no index, mark or funding, there is no formula, basket, clamp or settlement to record.

What the two cached calls did over 30 one second rounds on `Xbt/Aud`, in P3 and then P4:

| call | `CreatedTimestampUtc` changed | best bid changed | best ask changed | receive time minus `CreatedTimestampUtc` |
|---|---:|---:|---:|---|
| `GetOrderBook` | 20 and 22 of 29 steps | 17 and 14 of 29 | 3 and 7 of 29 | min 229 and 133, median 1,259 and 1,027, max 2,433 and 1,869 ms |
| `GetMarketSummary` | 29 and 29 of 29 steps | 21 and 18 of 29 | 3 and 5 of 29 | min 75 and 76, median 76 and 76, max 82 and 93 ms |

Two `GetOrderBook` requests for `Eth/Aud` 335 ms apart returned the same `CreatedTimestampUtc`, `2026-09-23T03:41:10.0120719Z`, in P3, and two 300 ms apart did the same in P4, which is the documented one second cache.

## 5. REST book snapshot

| call | reply for `Xbt/Aud` in P1 | order | depth |
|---|---|---|---|
| `GET /Public/GetOrderBook?primaryCurrencyCode=xbt&secondaryCurrencyCode=aud` | 1,048 bid rows and 547 ask rows, 97,852 bytes, 450 ms. In P4 1,047 and 537, 97,137 bytes, 454 ms | bids descending, asks ascending | every price level, one row per price |
| same with `maxDepthVolume=1` | 3 bids and 21 asks. In P4 5 bids and 4 asks | same | "Limit the results to a maximum cumulated volume", S1 |
| `GET /Public/GetAllOrders?primaryCurrencyCode=xbt&secondaryCurrencyCode=aud` | 1,689 bids and 767 asks, each with a `Guid`, 204,078 bytes, 303 ms. In P4 1,690 and 760, 203,525 bytes, 301 ms | same | every order |

Each `GetOrderBook` row is `{"OrderType": "LimitBid", "Price": 122071, "Volume": 0.0423}`, with prices and volumes as JSON numbers.
Every price appeared once per side, 1,048 prices in 1,048 bid rows, so the call aggregates orders by price, and `GetAllOrders` lists them one by one.
`Eth/Usd` held 266 bids and 390 asks in 40,538 bytes, and `Zrx/Nzd` 106 and 104 in 13,443 bytes, P1, and 266 and 389, and 105 and 103, in P4.
`maxDepthVolume=abc` answered 400 `{"ErrorCode":"ValidationError","Message":"maxDepthVolume has invalid value"}`.
The documented cache is one second, S1, and section 4 shows the book's `CreatedTimestampUtc` up to 2.4 s behind its arrival.

## 6. Rate limits and errors

No rate limit is published on the API page, S1.
CCXT spaces calls 1,000 ms apart, `'rateLimit': 1000` at `independentreserve.js` line 24.
The probes stayed at one call per second with one pair of calls 335 ms apart, and saw no 429 and no `Retry-After`, so the real limit is Not publicly specified and not measured.

| request | status | body |
|---|---|---|
| `GetMarketSummary` with `primaryCurrencyCode=nope` | 400 | `{"ErrorCode":"ValidationError","Message":"Invalid Primary Currency Code"}` |
| `GetMarketSummary` with `secondaryCurrencyCode=usdt` | 400 | `{"ErrorCode":"ValidationError","Message":"Invalid Secondary Currency Code"}` |
| `GetMarketSummary` with no parameter | 400 | `{"ErrorCode":"ValidationError","Message":"Invalid Primary Currency Code"}` |
| `GetMarketSummary` with `secondaryCurrencyCode=eur` | 200 | a EUR summary that did not change in 32 minutes, although `Eur` is not a listed secondary code |
| `GET /Public/GetNope` | 404 | empty |
| `POST /Public/GetValidPrimaryCurrencyCodes` | 405 | empty |

The documented error codes are `UnexpectedError`, `ValidationError`, `AccessDenied`, `RequestDuplicated`, `RecordDoesNotExist`, `RecordNotWhitelisted`, `UserSuspended`, `UserInactive`, `UserFrozen`, `OrderLimitExceeded` and `WithdrawalDisabled`, carried with status 400, S1.

## 7. Server time and clock offset

No server time call exists, S1.
`GetMarketSummary` stamps `CreatedTimestampUtc` with up to seven decimal places, and it arrived 78 ms after that stamp on a 153 ms request in P1, and 76 ms after it on a 154 ms request in P4.
A stamp taken when the request reaches Sydney, half a round trip before arrival, would read about 76 ms, so the two clocks agree within a few milliseconds.
That reading is an inference, and section 4 shows 75 to 93 ms over 60 more requests.
The `date` header has whole seconds only.

## 8. Recommended poller shape

None.
Independent Reserve publishes no index, mark or funding, so it has no anchor poller, and the connector would drop all 168 spot markets before a poller could run, see [`fees.md`](./fees.md) section 9.
If a later design admits spot legs, the book socket of [`websocket.md`](./websocket.md) section 8 carries everything a leg needs, and `GetFxRates` once a minute would be the only REST call worth polling, to watch the rate that converts the pooled orders.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | API | https://www.independentreserve.com/features/api, redirected with 301 from https://www.independentreserve.com/API | 2026-09-22 | Independent Reserve, all regions | public calls, parameters, caches, decimal places, volume unit, error codes, no rate limit or time call, sections 2 to 7 |
| S2 | CCXT 4.5.68 `independentreserve.js` | `server/node_modules/ccxt/js/src/independentreserve.js` | 2026-09-22 | CCXT | market mapping, `rateLimit`, capability flags, sections 2, 3 and 6 |
| P1 | `rest-probe.mjs main` at 03:21 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/independentreserve/rest-probe.mjs) | 2026-09-22 | this host | sections 1 to 7 |
| P2 | `rest-probe.mjs sweep` at 03:23 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/independentreserve/rest-probe.mjs) | 2026-09-22 | this host | 168 pairs, spreads, sections 2 and 3 |
| P3 | `rest-probe.mjs poll` at 03:40 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/independentreserve/rest-probe.mjs) | 2026-09-22 | this host | cache and change counts, section 4 |
| P4 | second pass: `main` at 03:53, `sweep` at 03:54 and `poll` at 03:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/independentreserve/rest-probe.mjs) | 2026-09-22 | this host | the second readings, the per quote table of section 2 |
