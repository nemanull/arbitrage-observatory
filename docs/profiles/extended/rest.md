# Extended REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:15 to 22:35 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

**Rechecked:** 2026-10-12, against the live venue by the builder of the Rust adapter, and each added line names that date.

This profile covers the public REST API of Extended (CCXT id `extended`) that a catalog, an anchor poller and a book check would use.
Every call is a GET under `https://api.starknet.extended.exchange/api/v1/`, and nothing here signs, holds a key or places an order.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/extended/rest-probe.py), whose runs are P1 and P2 in section 10, unless a line names another probe.
Where the documentation and the wire disagree, both are written.
Fees and who may trade are in [`fees.md`](./fees.md), and the socket is in [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-12 | edge |
|---|---|---|---|
| `api.starknet.extended.exchange` | REST and WebSocket, D1 | three A records, `13.159.94.114`, `13.193.112.197` and `54.95.5.135`, and no CNAME | no CDN header. Replies carried only `date`, `content-type`, `content-length`, `connection` and `cache-control` |

D1 says "The exchange servers are hosted in AWS Tokyo region", `ap-northeast-1`, availability zone `apne1-az4`.
Every public GET answered from this host, and no GET was a refusal or a geoblock.

| call | one request ms | repeated requests ms | reply bytes |
|---|---:|---|---:|
| `info/markets?market=BTC-USD`, first of its process | 566 and 562, P1 and P2 | ten warm calls: min 140, median 141, max 165 and 149, P1 and P2 | 5,571 |
| `info/markets/BTC-USD/stats` | 139 | | 837 |
| `info/markets`, every market | 290 to 1,121 | 60 polls at 1 s: median 173 and 167 ms, p90 222 and 192 ms, max 1,307 and 1,330 ms, P1 and P2 | 1,004,173 to 1,004,526 |
| `info/markets` with the 47 order book markets named | | 10 polls: min 139, median 141, max 922 ms, P2 | 176,125 |
| `info/{market}/funding`, 26 h | 137 to 143 | | |
| `info/markets/BTC-USD/orderbook` | 125 | | 219,537 |

No reply was compressed.
A request with `Accept-Encoding: gzip` got `content-length: 1004338` and no `content-encoding`, P1.
The 406-row reply took 26 to 32 ms more at the median than a one-market reply over a kept connection, P1 and P2.

## 2. Catalog

### The instruments call

`GET /api/v1/info/markets` returns every market in one reply, perpetual and spot, D2.
The query `market` may repeat to select markets, `?market=BTC-USD&market=ETH-USD`, D2, and CCXT sends it that way at `extended.js` line 769.

| status, D2 | meaning, D2 | perpetual rows, P1 |
|---|---|---:|
| `ACTIVE` | "all types of orders are permitted" | 328 |
| `REDUCE_ONLY` | "only reduce only orders are allowed" | 1 |
| `DELISTED` | "trading is no longer permitted" | 61 |
| `PRELISTED` | "trading not yet available" | 13 |
| `DISABLED` | "trading is not allowed" | 0 |

The reply held 406 rows, 403 with `type` `PERPETUAL` and 3 with `type` `SPOT`, P1 and P2.
The boolean `active` is not the trading flag: it was true on 54 delisted, 13 prelisted and 1 reduce-only perpetual, P1.
`status` is the flag, and CCXT reads it, `const active = (status === 'ACTIVE')` at `extended.js` line 530.
Every perpetual has `collateralAssetName` `USD`, which is USDC collateral, D3, and CCXT turns the quote into `USDC` at `extended.js` lines 526 and 527.

### Execution model and asset class

| ACTIVE perpetuals, P1 | order book, `isRfq` false | RFQ, `isRfq` true |
|---|---:|---:|
| `category` `Crypto` | 32 | 163 |
| `category` `RWA` | 15 | 118 |
| total | 47 | 281 |

An RFQ market has an indicative book built from market maker quotes, and a taker fills only if a market maker picks the order up, see [`websocket.md`](./websocket.md) section 4.
Its index and mark come from another venue, section 4.
`tradingHours` was `CONTINUOUS` on 273, `NO_OVERNIGHT` on 42 and `WEEKDAYS` on 13 ACTIVE perpetuals, and `isOffHours` was true only on `XBR-USD`, P1.
D2 says that "While isOffHours is true, order placement and execution are unavailable", and that an `ACTIVE` market stays `ACTIVE` while it is closed.
`referenceMarket` names the underlying market of an RWA row: `us_equity` on 116, `commodity_cme` on 7, and `kr_equity`, `always_open`, `fx`, `us_index_fut` and `jp_equity` on 2 each, P1.
The 47 order book markets are the 32 crypto markets `AAVE`, `ADA`, `ASTER`, `AVAX`, `BNB`, `BTC`, `CRV`, `DOGE`, `ENA`, `ETH`, `FARTCOIN`, `HYPE`, `JUP`, `KAITO`, `LINK`, `LIT`, `LTC`, `NEAR`, `ONDO`, `PUMP`, `SOL`, `SUI`, `TAO`, `TIA`, `UNI`, `WLD`, `XLM`, `XMR`, `XPL`, `XRP`, `ZEC` and `ZRO`, and the 15 RWA markets `EUR`, `MSTR_24_5`, `MU_24_5`, `NVDA_24_5`, `SNDK_24_5`, `SPX500m`, `TECH100m`, `USDJPY`, `WTI`, `XAG`, `XAU`, `XBR`, `XCU`, `XNG` and `XPT`, each followed by `-USD`, P1.

### Names and units

- Every perpetual name is `<assetName>-USD`, except the delisted `PLACE_JPY-USD_1-USD`, P1.
- RWA names may carry a suffix that is part of the asset name, such as `NVDA_24_5-USD` with `assetName` `NVDA_24_5`, P1.
  D2 warns that "a _24_5 suffix in a market name does not mean WEEKDAYS".
- Nine ACTIVE perpetuals carry a `k` prefix, `kBOME`, `kDOGS`, `kFLOKI`, `kHMSTR`, `kLUNC`, `kNEIRO`, `kNOT`, `kPTB` and `kXEC`, and "k-prefixed markets (e.g. kFLOKI) reference 1,000 units of the underlying token", D5.
  On `kFLOKI` the day's quote volume over base volume was 0.027457 against a last price of 0.027675, so sizes count units of 1,000 tokens, P1.
- Three ACTIVE perpetuals carry a `1000` prefix, `1000BONK`, `1000PEPE` and `1000SHIB`, and on `1000PEPE` the same ratio was 0.004211 against a last price of 0.004020, P1.
- On `BTC-USD` the ratio was 83,081 against 82,544, so sizes are coins, P1.
- No `assetName` is listed twice among ACTIVE perpetuals, P1.

Sizes on the socket and the REST book are in these units, so `contractSize` 1 is right on every market.

### How CCXT 4.5.68 maps it

| item | CCXT | wire |
|---|---|---|
| `market.id` | the row's `name`, `extended.js` line 518 | the socket's `data.m` and the anchor row's `name`, P1 |
| `type` | `swap` unless `type` reads `spot`, `extended.js` lines 541 to 549 | `PERPETUAL` or `SPOT` |
| `active` | `status === 'ACTIVE'`, line 530 | as the table above |
| `contractSize` | 1, line 553 | units of the asset, section 2 |
| `linear` | true, line 554 | USDC collateral |
| base | `safeCurrencyCode(assetName)`, which upper-cases | `kFLOKI` becomes `KFLOKI`, `SPX500m` becomes `SPX500M` and `TECH100m` becomes `TECH100M`, `fees-probe.py` P1 |
| spot base | `SPOT` is removed from `assetName`, line 521 | `BTCSPOT` becomes `BTC` |

`fees-probe.py` found 405 CCXT markets, 328 of them active linear swaps quoted and settled in USDC, which is the CCXT count of the DEX design, P1 and P2.
CCXT keeps the 281 RFQ markets, because it never reads `isRfq`.

### Ticker identity

Extended lists equities, indices, FX and commodities under short tickers, and some name a different asset than the same ticker on a crypto venue, P1.

| market | Extended's asset, `description` | the same ticker elsewhere |
|---|---|---|
| `QNT-USD` | Quantinuum, RWA, RFQ | Quant, a crypto token |
| `BB-USD` | BlackBerry, RWA, RFQ | BounceBit, a crypto token |
| `PURR-USD` | Hyperliquid Strategies Inc., RWA, RFQ | PURR, Hyperliquid's token |
| `US-USD` | Talus, crypto, RFQ | not checked |

All four are RFQ markets, as are all nine `k` markets and all three `1000` markets, so a loader that keeps only order book markets drops them, P1.

### What the catalog needs changed

- Keep only perpetuals whose `status` is `ACTIVE` and whose `isRfq` is false, 47 markets on 2026-10-12.
  RFQ books are indicative, and RFQ indexes and marks are Binance's or Hyperliquid's, section 4.
- If RFQ markets are ever kept, the nine `k` markets need a price scale of 0.001, as `thousands_token` gives in [`hyperliquid/markets.rs`](../../../server/src/venues/hyperliquid/markets.rs), and `QNT`, `BB` and `PURR` need denials.
- The taker is 250 ppm for `category` `Crypto` and 100 ppm for `RWA`, see [`fees.md`](./fees.md) section 9.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /api/v1/info/markets` | `marketStats.indexPrice` | `marketStats.markPrice` | `marketStats.fundingRate` | absent, 1 h on every market, D4 | `marketStats.nextFundingRate`, a timestamp despite its name | 1.0 MB for 406 rows | median 173 and 167 ms, P1 and P2 |
| the same with `market` repeated for the 47 order book markets | same fields | | | | | 176 KB | median 141 ms, P2 |
| `GET /api/v1/info/markets/{market}/stats` | `indexPrice` | `markPrice` | `fundingRate` | | `nextFundingRate` | 837 bytes, one market | 139 ms |

The prices are decimal strings, and `nextFundingRate` is an integer in epoch ms.
D2's example shows `nextFundingRate` as `1701563440`, in seconds, while the wire sent `1791846000000`, in milliseconds, on all 328 ACTIVE perpetuals, P1 and P2.
That value is 2026-10-12 23:00:00 UTC, the next whole hour.
No ACTIVE perpetual had a zero mark or a zero index, P1.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `name` | `BTC-USD` | as is |
| `index` | `marketStats.indexPrice` | decimal string, USD | parse |
| `mark` | `marketStats.markPrice` | decimal string, USD | parse |
| `fundingRate` | `marketStats.fundingRate` | a fraction per hour, `"0.000013"` is 0.0013 % | parse |
| `fundingIntervalHours` | none | the constant 1, D4 | 1 |
| `nextFundingAt` | `marketStats.nextFundingRate` | epoch ms | as is |

## 4. Anchor semantics

### Index

The index source depends on the market, D5 and D6.

| markets | index and mark source | basket |
|---|---|---|
| crypto order book | "obtained from 5 nodes of an independent Oracle Provider, Stork", USD denominated, D5 | Not publicly specified |
| crypto RFQ | "provided by RedStone, referencing Binance Index and Mark Prices", D5 | Binance's index basket, and Binance's mark |
| RWA order book | RedStone or Stork per asset during oracle hours, with CME and ICE "futures equivalent" feeds for indices, energy and copper, D6 | the oracle reference table of D6 |
| RWA order book, oracle stale for more than 5 minutes | "derived from order book liquidity", an EWMA toward Extended's own impact bid and ask, capped at `1 / max_leverage` from the last oracle price, D6 | Extended's own book |
| RWA RFQ | Stork, from "Binance perpetual market prices" or "Hyperliquid perpetual market prices", D6 | another venue's perpetual |
| Prime RWA | "a single price feed: Index Price = Mark Price", D6 | Stork equity mids |
| pre-market | 45-minute EWMAs of Extended's own mark and book, D7 | Extended's own book |

So only the 32 crypto order book markets have an index that is neither Extended's own book nor another venue's copied price.
The oracle hours of RWA feeds are 23/5 or 24/5, D6, while most RWA markets trade 24/7, so each weekend their index comes from Extended's own book.
The asset index call `GET /api/v1/info/assets/{asset}/price` returned `"0"` for `BTC`, which D2 says means "no published index price", P1.

### Mark

The crypto order book mark comes from Stork, D5, and neither Extended nor Stork publishes its formula, so it is Not publicly specified.
On the 47 order book markets the premium of mark over index had a median magnitude of 578 and 547 ppm, a p90 of 975 and 1,016 ppm and a max of 1,282 and 1,275 ppm, P1 and P2.
On `BTC-USD` the mark sat about 500 ppm under the index while the book's mid sat between them, P1.

The RWA order book mark is the index most of the time.
In P1's last poll the mark string equalled the index string on all 15 RWA order book markets.
In P2 it equalled the index on every one of 60 polls on 8 of them, `EUR`, `MSTR_24_5`, `NVDA_24_5`, `SNDK_24_5`, `USDJPY`, `WTI`, `XBR` and `XPT`.
Across all ACTIVE perpetuals 76 had mark equal to index in P1's last poll, and 65 on every poll of P2.
A premium that reads 0 whatever the book does cannot explain a standing basis, which is the shape decision 19 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) guards against.

### Funding

The formula, the interest rate and the caps are in [`fees.md`](./fees.md) section 6.
`fundingRate` is "calculated every minute" and applied once an hour, D2 and D4.
It is the running rate for the coming settlement, not the last applied one.
On `AIA-USD` the live rate read `0.000002` in P1 and `0.000001` in P2, while the rate applied at 22:00 read `0.000004`, P1 and P2.
The cap per hour is in `tradingConfig.hourlyFundingRateCap` in percent, `"0.25"` on `BTC-USD`, P1.
Applied rates in `GET /api/v1/info/{market}/funding` are hourly and stamped 849 to 2,094 ms after the whole hour, with 26 rows in 26 hours on each of five markets, P1 and P2.
That call needs `startTime` and `endTime` in ms, or it answers 400 with code 1006.

### How often each number changed

| field | share of 1 s polls on which it changed, median over 328 markets | markets that never changed in 60 s |
|---|---|---|
| `markPrice` | 0.36 in P1, 0.25 in P2 | 46 and 35 |
| `indexPrice` | 0.44 in P1, 0.32 in P2 | 46 and 35 |
| `fundingRate` | 0.00, with a p90 of 0.02 in P1 | 281 and 309 |
| `nextFundingRate` | 0.00 | 328 and 328 |

`BTC-USD` showed 33 marks and 37 indexes in 60 polls in P1, and 19 and 25 in P2.
The socket streams push mark and index about every 1.5 s per market, see [`websocket.md`](./websocket.md) section 2, so a 1 s poll sees most changes.
Consecutive replies were identical once in 59 pairs in P1 and never in P2, so `cache-control: max-age=60` did not serve stale replies to this client.

## 5. REST book snapshot

`GET /api/v1/info/markets/{market}/orderbook` returns the whole book, D2.

| market | bids | asks | bytes | ms |
|---|---:|---:|---:|---:|
| `BTC-USD` | 3,513 | 2,935 | 219,537 | 125 |
| `ETH-USD` | 970 | 1,173 | 70,222 | 122 |
| `MU_24_5-USD` | 122 | 55 | 5,848 | 122 |
| `AIA-USD`, RFQ | 32 | 32 | 2,264 | 128 |
| `SHOP-USD`, RFQ | 10 | 9 | 702 | 122 |

These are P1, and P2 matched in shape.
Levels are `{"qty","price"}` strings, bids descending and asks ascending, P1.
`limit=5` and `depth=1` were ignored, and the whole book came back, P1.
Replies carry `cache-control: max-age=2`, and two reads with no pause between them were identical, P1.
For an RFQ market it returns the indicative book, D2.
The socket sends its own snapshot, so the feed never needs this call.

## 6. Rate limits and errors

| item | value | source |
|---|---|---|
| budget | 1,000 requests a minute per IP by default, higher tiers by request | D1, Published |
| over budget | status 429 | D1 |
| `Retry-After` | not documented, and no rate limit header on any reply | D1, P1 |
| geoblock | status 451, "Country is geoblocked" | D1 error table |
| CCXT pacing | `rateLimit` 600 ms | `extended.js` line 24 |

| request | answer, P1 and P2 |
|---|---|
| any GET without a User-Agent, or with an empty one | 403 with an HTML body `403 Forbidden` |
| `POST /api/v1/info/markets` | 451 with an empty body |
| `GET /api/v1/info/nothing` | 404 with an empty body |
| `info/markets?market=NOPE-USD` | 400 `{"status":"ERROR","error":{"code":1001,"message":"Market not found"}}` |
| `info/markets?market=BTC-USD&market=NOPE-USD`, on 2026-10-12 | the same 400, so one unknown name fails the whole call |
| `info/markets?market=BTC-USD&market=PLACE_JPY-USD_1-USD`, a delisted market, on 2026-10-12 | 200 with both rows, since a delisted market stays in the catalog |
| `info/NOPE-USD/funding` | 400 with code 1001 |
| `info/BTC-USD/funding` with no `startTime` | 400 with code 1006, "Request parameter startTime is missing" |
| `info/markets/NOPE-USD/orderbook` | 200 `{"status":"OK"}` with no `data` |
| `info/markets/NOPE-USD/stats` | 200 with every field `"0"` |

So an unknown market answers 200 on the book and stats calls, and a loader must not read a 200 as proof that a market exists.
The 451 on a POST from this Canadian exit fits D3, which lists Canada as restricted, while every GET answered.

## 7. Server time and clock offset

No time call exists, and CCXT declares `'fetchTime': false` at `extended.js` line 129.
The `date` header is whole seconds.
The socket's `ts` is the best reference: live deltas arrived 61 ms after their `ts` at the least, which is about the one-way path from Tokyo, see [`websocket.md`](./websocket.md) section 4.
The host's clock was within 2 ms of two NTP servers, `ws-probe.py` mode `clock`.

## 8. Recommended poller shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| source | `GET https://api.starknet.extended.exchange/api/v1/info/markets` with `market` repeated for each tracked market | one call carries index, mark, rate and next settlement, section 3 |
| header | `User-Agent` | without it every call is 403, section 6 |
| interval | 1,000 ms | 60 requests a minute is 6 % of the budget, and the reply took 141 ms at the median for 47 markets |
| row mapping | section 3 | |
| `fundingIntervalHours` | 1 | D4, and every funding history row was 60 minutes apart |
| `nextFundingAt` | `nextFundingRate` | it is the next whole hour in ms |
| skip | the 15 RWA order book markets, so the engine refuses their routes | their mark equals their index most of the time, and their index comes from Extended's own book whenever the oracle is closed, section 4 |
| keep | the 32 crypto order book markets | their index and mark come from Stork, section 4 |
| rate limit pause | the default pause on 429 and 451 | no `Retry-After` is documented |
| catalog | section 2, `status` `ACTIVE` and `isRfq` false | |

At 1 s the 47-market reply is about 15 GB a day, and the every-market reply would be about 87 GB.

## 9. Decentralised layer

### Chain and sequencer

Extended is "a perpetuals DEX built on Starknet", whose trades, funding payments, transfers and liquidations are "validated and settled on Starknet", D8.
Matching runs on Extended's own servers in AWS Tokyo, D1, and D8 describes decentralised sequencing as future work on "a purpose-built, application-specific chain".
So book and anchor times are Extended's server stamps, `ts` on the socket, and no public payload carries a block number or a chain time.
No node or chain read replaces the API for books, because the order book is not on chain.
From 2026-10-22 12:00 UTC the settlement network moves from Starknet to Arc, Circle's layer 1, and "Trading will continue without interruption", D9.
The API host is `api.starknet.extended.exchange`, CCXT hard codes `https://api.starknet.{hostname}` at `extended.js` line 169, and neither the API docs nor D9 name a host for after the migration.
`api.extended.exchange` resolved, but `GET /api/v1/info/markets?market=BTC-USD` there answered 404 from an AWS load balancer, on 2026-10-12.

### Who may use it and from where

Restricted Persons may not use the website, the API or the services, and they include residents of Canada, the United Kingdom and the United States, D3.
The terms forbid using a VPN to evade these restrictions, see [`fees.md`](./fees.md) section 1.
From this host's Canadian exit every public GET and every socket answered, and a POST answered 451, section 6.
That is the venue's own geoblock status, so trading from this host would most likely be refused.

### Oracles

Stork serves the crypto order book index and mark, RedStone serves the crypto RFQ markets by referencing Binance's index and mark, and RWA markets use RedStone or Stork per asset, section 4, D5 and D6.
Funding on crypto RFQ markets and on Binance-sourced RWA markets is "sourced directly from Binance funding", see [`fees.md`](./fees.md) section 6.
Pre-market and off-hours RWA prices come from Extended's own book, section 4.

### Listings and ticker collisions

Extended lists every market itself, and no permissionless or third-party listing is documented, D2 and D10.
Builder codes let a third-party front end charge its own fee on orders it routes, and they do not list markets, D11.
So the only collisions are Extended's own RWA tickers that match crypto tickers elsewhere, such as `QNT`, `BB` and `PURR`, section 2.

### Routing

Extended's RFQ markets route each order to market makers, who pick it up from the real book, D2.
Their prices and funding come from Binance, and for `JP225`, `BB`, `PURR` and `KIOXIA` from Hyperliquid, D6.
Front ends with builder codes route user orders to Extended, D11.
No venue of the survey was found to route its own perpetuals to Extended, but this was not checked venue by venue.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| D1 | Extended API documentation, sections "Mandatory headers", "Server Location", "Rate Limits" and "Error responses" | https://api.docs.extended.exchange/ | 2026-10-12 | Extended, API docs | sections 1, 6 and 9 |
| D2 | Extended API documentation, sections "RFQ markets", "Get markets", "Get asset index price", "Get market order book" and "Get funding rates history" | https://api.docs.extended.exchange/#get-markets | 2026-10-12 | Extended, API docs | sections 2 to 6 and 9 |
| D3 | Restricted Countries | https://docs.extended.exchange/extended-resources/legal/restricted-countries.md | 2026-10-12 | Extended, legal | sections 2, 6 and 9 |
| D4 | Funding Payments | https://docs.extended.exchange/extended-resources/trading/funding-payments.md | 2026-10-12 | Extended, docs | sections 3 and 4 |
| D5 | Oracle Prices, Crypto Markets | https://docs.extended.exchange/extended-resources/trading/oracle-prices/crypto-markets.md | 2026-10-12 | Extended, docs | sections 2 and 4 |
| D6 | Oracle Prices, RWA Markets | https://docs.extended.exchange/extended-resources/trading/oracle-prices/rwa-markets.md | 2026-10-12 | Extended, docs | sections 4 and 9 |
| D7 | Pre-Market Listings | https://docs.extended.exchange/extended-resources/trading/crypto-markets/pre-market-listings.md | 2026-10-12 | Extended, docs | section 4 |
| D8 | Technical Architecture | https://docs.extended.exchange/about-extended/technical-architecture.md | 2026-10-12 | Extended, docs | section 9 |
| D9 | Migration from Starknet to Arc, published 8 October 2026 | https://docs.extended.exchange/about-extended/migration-from-starknet-to-arc.md | 2026-10-12 | Extended, docs | section 9 |
| D10 | Crypto Markets, supported markets | https://docs.extended.exchange/extended-resources/trading/crypto-markets.md | 2026-10-12 | Extended, docs | section 9 |
| D11 | Builder Codes | https://docs.extended.exchange/extended-resources/builder-codes.md | 2026-10-12 | Extended, docs | section 9 |
| C1 | CCXT 4.5.68 `extended.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/extended.js` | 2026-10-12 | CCXT | sections 2, 6, 7 and 9 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/extended/rest-probe.py) modes `host`, `catalog`, `anchor`, `funding`, `book` and `errors`, 22:17 to 22:19 UTC, with [`fees-probe.py`](../../../scripts/probes/venues/extended/fees-probe.py) at 22:30 UTC | [`rest-probe.py`](../../../scripts/probes/venues/extended/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 8 |
| P2 | every mode rerun in the second pass, with the anchor mode's filtered poll added, from 22:33 UTC | [`rest-probe.py`](../../../scripts/probes/venues/extended/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 6 |
