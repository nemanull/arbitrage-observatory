# dYdX REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:19 to 22:24 UTC, and the second pass from 22:34 to 22:36 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers the public Indexer API of dYdX (CCXT id `dydx`) that a catalog, an anchor poller and a book check would use, and the public full node reads behind its fees and its oracle.
The Indexer is `https://indexer.dydx.trade/v4`, and every call here is an unauthenticated GET.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/dydx/rest-probe.py), run from the repository root with `uv run`.
P1 is the first run of each mode and P2 the second pass, listed in section 10.
Where the documentation and the wire disagree, both are written.
The Indexer and chain source is cited at commit `bd2dd7d` of `dydxprotocol/v4-chain`, the head of `main` on 2026-10-12, and the deployed services may run an older build.
Fees and access are in [`fees.md`](./fees.md), and the socket in [`websocket.md`](./websocket.md).
Section 9 holds the decentralised layer that [`2026-10-12-dex-venues-design.md`](../../implemented/2026-10-12-dex-venues-design.md) decision 3 asks for.

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-12 | edge |
|---|---|---|---|
| `indexer.dydx.trade` | Indexer REST and socket, S1 | `104.20.40.161`, `172.66.166.30`, `2606:4700:10::6814:28a1` and `2606:4700:10::ac42:a61e`, P1 and P2 | Cloudflare, `server: cloudflare`, `cf-ray` ending `-YVR` or `-SEA` |
| `dydx-ops-rest.kingnodes.com` | a public full node's REST gateway, listed with "350 req/m", S2 | not recorded | answered every read in 107 to 646 ms, P1 and P2 |

| call | first request ms, with DNS and TLS | warm requests ms | reply bytes |
|---|---:|---|---:|
| `GET /v4/time` | 343.6 and 338.7 | ten each run: min 108.4 and 112.4, median 114.4 and 117.3, max 133.7 and 128.1 | 57 |
| `GET /v4/height` | | 298.1 and 302.3 | 56 |
| `GET /v4/perpetualMarkets` | | 232.7 and 614.2 on a cache miss, and a median of 42.6 and 29.5 over 60 polls, section 3 | 167,128 to 167,212 |
| `GET /v4/orderbooks/perpetualMarket/BTC-USD` | | about 305 to 311 on a cache miss, 14 to 37 on a hit, with `JTO-USD` alike | 6,718 to 6,775 |

Every Indexer reply carried `geo-origin-country: CA`, `geo-origin-region: CA-BC` and `geo-origin-status: restricted`, P1 and P2.
The status reads `restricted`, and S3 treats any status other than its `OK` value as a restricted country, yet every public market data call answered 200.
Two cached replies in P2 carried `geo-origin-country: US` and `geo-origin-region: US-WA` with `cf-cache-status: HIT`, so Cloudflare caches these headers with the body, and on a hit they describe whoever filled the cache.
No reply was compressed, and none was refused.

## 2. Catalog

### The instruments call

| call | returns | evidence |
|---|---|---|
| `GET /v4/perpetualMarkets` | `{"markets":{"<ticker>":{...}}}`, every market keyed by its ticker | S1, P1 and P2 |
| `GET /v4/perpetualMarkets?market=BTC-USD` | the same shape with one market, 563 to 564 bytes | P1 and P2 |
| `GET /v4/perpetualMarkets?limit=1000` | 296 rows, the same as with no `limit`, so the default returns every market | P1 and P2 |

| item | value, P1 and P2 alike |
|---|---|
| rows | 296 |
| `status` | `ACTIVE` 73, `FINAL_SETTLEMENT` 223. S4 lists `Active`, `Paused`, `CancelOnly`, `PostOnly`, `Initializing` and `FinalSettlement` |
| `marketType` | every active market is `CROSS`. The 223 settled split into 43 `CROSS` and 180 `ISOLATED` |
| fields on every row | `clobPairId`, `ticker`, `status`, `oraclePrice`, `priceChange24H`, `volume24H`, `trades24H`, `nextFundingRate`, `initialMarginFraction`, `maintenanceMarginFraction`, `openInterest`, `atomicResolution`, `quantumConversionExponent`, `tickSize`, `stepSize`, `stepBaseQuantums`, `subticksPerTick`, `marketType`, `openInterestLowerCap`, `openInterestUpperCap`, `baseOpenInterest`, `defaultFundingRate1H` |
| ticker shape | `BASE-USD` on every active market, and the map key equals `ticker` on 296 of 296 |
| tickers of another shape | six settled markets named `BASE,VENUE,ADDRESS-USD`, such as `FARTCOIN,RAYDIUM,9BB6NFECJBCTNNLFKO2FQVQBQ8HHM13KCYYCDQBGPUMP-USD` and `OCEAN,UNISWAP_V3_BASE,0X1D8148823C46B9C55B678CA84BEB82BC3523ADB1-USD` |
| a base listed twice | none |
| bases that start with a digit | `1INCH` |
| active markets with `volume24H` 0 | `ATH-USD`, `JTO-USD`, `LIT-USD`, `MON-USD`, `ORDI-USD`, `RUNE-USD`, `WTI-USD`, `ZEN-USD` and `ZORA-USD` |
| active margin pairs | initial and maintenance 0.02 and 0.012 (`BTC-USD`), 0.05 and 0.03, 0.1 and 0.05, 0.2 and 0.1 |
| `defaultFundingRate1H` on active markets | `"0"` on 72, `"0.0000125"` on `MON-USD` |

The 73 active markets are `1INCH`, `AAVE`, `ADA`, `ALGO`, `APE`, `APT`, `ARB`, `ASTER`, `ATH`, `ATOM`, `AVAX`, `BCH`, `BLUR`, `BNB`, `BONK`, `BTC`, `CHZ`, `COMP`, `CRV`, `DOGE`, `DOT`, `DYDX`, `DYM`, `EIGEN`, `ENA`, `ETC`, `ETH`, `FIL`, `HBAR`, `HYPE`, `ICP`, `IMX`, `INJ`, `JTO`, `JUP`, `LDO`, `LINK`, `LIT`, `LTC`, `MON`, `NEAR`, `ONDO`, `OP`, `ORDI`, `PAXG`, `PENDLE`, `PENGU`, `PEPE`, `POL`, `PUMP`, `PYTH`, `RENDER`, `RUNE`, `SEI`, `SOL`, `STRK`, `SUI`, `TAO`, `TIA`, `TRUMP`, `TRX`, `UNI`, `WIF`, `WLD`, `WLFI`, `WTI`, `XAG`, `XLM`, `XMR`, `XRP`, `ZEC`, `ZEN` and `ZORA`, each against `USD`, P1 and P2.
`WTI-USD` and `XAG-USD` are the commodity tickers for West Texas crude and silver, each priced from one Pyth feed, see section 4, and `PAXG-USD` follows the gold token with CoinMarketCap id 4705.
Settled markets keep `oraclePrice` and show `volume24H` `"0"`, such as `MATIC-USD` at 0.3932407381, so a loader that skips `status` would list dead books.

The chain agrees: its `perpetuals` query lists 296, 116 cross and 180 isolated, and its `clob_pair` query lists 73 `STATUS_ACTIVE` and 223 `STATUS_FINAL_SETTLEMENT`, P1 and P2.

### Size and price units

`stepSize` and `tickSize` are in base coins and USD, such as `0.0001` and `1` on `BTC-USD` and `10000000` and `0.0000000001` on `PEPE-USD`, P1.
Book sizes on REST and on the socket are in the same base coins, see [`websocket.md`](./websocket.md) section 4.
Every market is priced per one coin, so `PEPE-USD` at an oracle of 0.0000039855 and `BONK-USD` at 0.0000032563 need no price scale, P1.
`atomicResolution` and `quantumConversionExponent` are the chain's integer units, which the Indexer has already converted, so a loader ignores them.

### How CCXT 4.5.68 maps it

| item | value | evidence in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/dydx.js` |
|---|---|---|
| call | one `GET perpetualMarkets`, no paging | `fetchMarkets` at line 585, the call at line 589 |
| `market.id` | `ticker`, `BTC-USD`, equal to the socket `id` and the anchor key | line 525, and 73 of 73 in [`fees.md`](./fees.md) section 8 |
| base | the ticker before the first `-`, through `safeCurrencyCode`, with an empty `commonCurrencies` | lines 506 to 510 and 345 |
| quote and settle | hard coded `USDC`, so the symbol is `BTC/USDC:USDC` | lines 505 and 512 |
| `active` | true only when `status` is `ACTIVE` | lines 519 to 523 |
| `contractSize` | 1, "trades seem in absolute size" | line 542 |
| `linear` | true | line 543 |
| `taker` and `maker` | `undefined` | lines 545 and 546 |
| active swaps loaded | 73, all linear, quote `USDC`, `contractSize` 1 | [`fees.md`](./fees.md) section 8, P1 and P2 of `fees-probe.py` |

The loader keeps `status == "ACTIVE"`, takes `rawMarketId` from `ticker`, the base from the part before `-`, the quote `USDC` as CCXT does, and `contractSize` 1.
That matches CCXT's 73 markets, and the quote family folds USDC under USDT with USD.

### Tickers that need the identity check

dYdX's market map names a CoinMarketCap id for the markets listed in recent years, which says which token a ticker follows, P1 and P2 `chain`.
These deserve a look in `live_identity`, because their sources are few or their names are common.

| ticker | oracle sources on 2026-10-12 | note |
|---|---|---|
| `LIT-USD` | one, `gate_ws` `LIT_USDT`, with `min_provider_count` 1 and CoinMarketCap id 39125 | a single source, so which LIT the other venues mean is worth the check |
| `WTI-USD` | one, `pyth_api` feed `3063` | a commodity, whose ticker differs from venue to venue |
| `XAG-USD` | one, `pyth_api` feed `3154` | silver |
| `MON-USD` | five, `bybit_ws`, `coinbase_ws`, `kraken_api`, `kucoin_ws`, `mexc_ws`, CoinMarketCap id 30495 | |
| `HYPE-USD` | three, `bybit_ws`, `kucoin_ws`, `mexc_ws`, CoinMarketCap id 32196 | |
| `ZEN-USD` | five, `binance_ws`, `bybit_ws`, `coinbase_ws`, `kucoin_ws`, `mexc_ws`, CoinMarketCap id 1698 | |

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /v4/perpetualMarkets` | `oraclePrice` | none, see section 4 | `nextFundingRate` | absent | absent | 167,128 to 167,212 bytes, 296 rows | 60 polls a run at 1 s: min 17.5 and 22.4, median 42.6 and 29.5, p90 142.2 and 141.9, max 429.7 and 615.5 ms |

Cloudflare caches this reply for a second, `cache-control: public, max-age=1`, and in 60 one-second polls it answered `HIT` 32 and 36 times, `EXPIRED` 24 and 18 times and `REVALIDATED` 4 and 6 times, P1 and P2.
So a reading can be up to a second older than its arrival, and a hit costs no rate limit point, section 6.
The socket channel `v4_markets` carries the same `oraclePrice` and `nextFundingRate`, and a REST read every 5 s matched the socket's latest oracle for `BTC-USD`, [`websocket.md`](./websocket.md) P5.
The socket sends an oracle price only when it changes, so a socket anchor row would age past the engine's 10 s limit on any market whose oracle rests, and the REST poll is the better source.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | the map key, equal to `ticker` | `BTC-USD` | none |
| `index` | `oraclePrice` | decimal string, USD | parse |
| `mark` | none | | 0, see section 4 |
| `funding_rate` | `nextFundingRate` | decimal string, a fraction per hour, such as `"-0.00220427604166666667"` on `BLUR-USD` | parse |
| `funding_interval_hours` | none in the reply | the `funding-tick` epoch of 3,600 s, P1 and P2 `chain`, and S5 | 1 |
| `next_funding_at` | none in the reply | the `funding-tick` epoch's `next_tick` read 1791846000, 23:00:00 UTC, at 22:22 UTC | the next whole UTC hour after the round's arrival |
| skip | `status` other than `ACTIVE` | | 223 settled rows |

## 4. Anchor semantics

### Index, the oracle

The oracle price is set by the chain, not by the Indexer.
Each validator runs a price sidecar, "Slinky", which "pulls price data from external sources", and each validator votes its prices in every block, S6.
"The block after VE are submitted, Slinky deterministically aggregates all VE from the previous block and proposes a new updated price which is voted into consensus", and so "prices within Slinky are committed on a one-block delay", S6.
"Price updates happen when over 2/3 of validators are correctly running the Slinky sidecar", S6.

The sources per market live in the chain's market map at `GET /slinky/marketmap/v1/marketmap` on a full node, P1 and P2.
The path `/connect/marketmap/v2/marketmap` answered 501 `Not Implemented` on the same node.
The map holds 248 markets, 74 of them enabled, and the 73 live markets use 1 to 10 sources each with a median of 7.
`BTC-USD` reads `binance_ws` `BTCUSDT`, `bybit_ws` `BTCUSDT`, `coinbase_ws` `BTC-USD`, `huobi_ws` `btcusdt`, `kraken_api` `XXBTZUSD`, `kucoin_ws` `BTC-USDT`, `mexc_ws` `BTCUSDT` and `okx_ws` `BTC-USDT`, with every USDT price normalised by the `USDT/USD` market.
The sources across the map are `binance_ws`, `mexc_ws`, `kucoin_ws`, `gate_ws`, `bybit_ws`, `okx_ws`, `coinbase_ws`, `kraken_api`, `huobi_ws`, `crypto_dot_com_ws`, `bitstamp_api`, `uniswapv3_api-ethereum`, `polymarket_api`, `bitfinex_ws`, `raydium_api`, `pyth_api` and `uniswapv3_api-base`.
No live market lists dYdX itself as a source, so no index here is the venue's own perpetual.

The chain moves an oracle price only when the new price differs from the stored one by at least the market's `min_price_change_ppm`, S7 and S8.
That is 500 ppm on 28 live markets, `BTC-USD` and `ETH-USD` among them, and 800 ppm on the other 45, P1 and P2 `chain`.
So the index is a staircase with steps of at least 0.05 % or 0.08 %, and between steps it can sit up to that far from the sources.
`BTC-USD` kept one oracle price through 60 one-second polls in both runs, the median market changed once a minute, and 21 and 35 of 73 never changed, P1 and P2.
An unchanged oracle is therefore a current reading, not a stale one.

On the socket an oracle price arrived 746 to 1,541 ms after its block's `effectiveAt`, [`websocket.md`](./websocket.md) P5 and P8.

### Mark

dYdX publishes no mark price.
The oracle price is the price the venue marks positions at: margin uses "P is the oracle price for the market", and "Oracle Price is used to estimate the value of an account’s positions" for liquidation, S9 and S10.
So the venue's mark and its index are one number.
Under decision 19 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md), a copy of the index as mark would read every dYdX premium as fresh, so the adapter sends mark 0 and the engine refuses dYdX routes at open as a markless leg, as HIBT's adapter does at [`hibt/anchor.rs`](../../../server/src/venues/hibt/anchor.rs) line 39.

### Funding

| item | value | evidence |
|---|---|---|
| premium and rate | "Funding Rate = (Premium Component / 8) + Interest Rate Component", averaged over the hour from one-minute samples | S5 |
| what `nextFundingRate` is | the average of the samples received since the last settlement plus `defaultFundingRate1H`, so the running estimate of the coming hourly settlement | S11 lines 21 to 47 |
| how often it changed | at most once in 60 one-second polls on any market, P1 and P2, and one `trading` frame on the socket in 30 s carried it for 21 markets | P1, P2, [`websocket.md`](./websocket.md) P8 |
| values at 22:21 UTC | `"0"` on 52 of 73, which the premium formula gives whenever the index sits between the impact bid and the impact ask | P1, S5 |
| settled rates | `historicalFunding` rows such as `BTC-USD` `"0.000000125"` at 22:00 and `"0.000002125"` at 21:00 | P1 and P2 |
| settlement times | 48 rows 3,599 to 3,601 s apart, each 27 to 812 ms after the hour | P1 and P2 |
| default interest | `MON-USD` settled `"0.0000125"` in each of 48 hours, its `defaultFundingRate1H` | P1 and P2 |
| clamps | `funding_rate_clamp_factor_ppm` 6,000,000, `premium_vote_clamp_factor_ppm` 60,000,000, `min_num_votes_per_sample` 15, and the 8-hour cap is "600% * (Initial Margin - Maintenance Margin)" | P1 and P2 `chain`, S5 |
| epochs | `funding-sample` every 60 s and `funding-tick` every 3,600 s | P1 and P2 `chain` |

The published rate is therefore the upcoming one, read as a fraction per hour, which is what `funding_rate` asks for.
The instant of a settlement was not captured, because the probes never wait for a clock event.

### How often each number changed

| number | changes per market in 60 one-second polls | evidence |
|---|---|---|
| `oraclePrice` | min 0, median 1, max 11 in P1 and 6 in P2 | P1 and P2 |
| `nextFundingRate` | min 0, median 0, max 1 | P1 and P2 |
| block height | 1.52 to 1.6 blocks a second, the height time 786 to 1,960 ms old on arrival | P1 and P2 |

## 5. REST book snapshot

| item | value | evidence |
|---|---|---|
| call | `GET /v4/orderbooks/perpetualMarket/{ticker}` | S1 |
| depth | up to 100 levels a side, `API_ORDERBOOK_LEVELS_PER_SIDE_LIMIT` 100, and no depth parameter | S12 line 30, `BTC-USD` 100 and 100 in P1 and P2 |
| level shape | `{"price":"82566","size":"0.1797"}` | P1 |
| order | bids descending and asks ascending | P1 and P2 |
| caching | `cache-control: public, max-age=1`. Reads 300 ms apart got `HIT` with `age: 0` in 14 to 37 ms | P1 and P2 |
| crossed or one-sided | none of 73 books in either sweep | P1 and P2 |
| thin book | `JTO-USD` held 38 and 35 levels in P1 and 23 and 22 in P2 | P1 and P2 |

The socket's snapshot is this same reply, see [`websocket.md`](./websocket.md) section 4, so the feed needs no REST seed.

## 6. Rate limits and errors

| item | value | evidence |
|---|---|---|
| Indexer budget | 100 requests per 10 s per client, from the headers `ratelimit-limit: 100`, `ratelimit-remaining` and `ratelimit-reset`, a Unix time in ms about 10 s ahead | P1 and P2, S13 lines 53 and 54 |
| cache hits | a Cloudflare hit leaves `ratelimit-remaining` unchanged, such as 98 on three reads of `BTC-USD` | P1 |
| over the budget | HTTP 429 with the message `Too many requests` and `Retry-After` set to `msBeforeNext`, which is milliseconds | S14 lines 62 to 68, not triggered |
| node REST budget | 300 to 350 requests a minute on the listed public nodes | S2 |
| unknown market on the book call | 404 `{"errors":[{"msg":"FOO-USD not found in markets of type PERPETUAL"}]}`, and the same for `btc-usd` | P1 and P2 |
| unknown market on the markets and funding calls | 400 `{"errors":[{"value":"FOO-USD","msg":"ticker must be a valid ticker (BTC-USD, etc)","param":"market","location":"query"}]}` | P1 and P2 |
| unknown path | 404 `{"error":"Not Found","errorCode":404}` | P1 and P2 |

The runtime's `retry_after` at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 130 reads an all digit value up to 10^9 as seconds, so a `Retry-After` of `9500` meant as 9.5 s would pause the poller for 9,500 s.
A 1 s poll spends 10 of the 100 points, so a 429 should not come, but the venue can map its own 429 if the builder wants the pause right.

## 7. Server time and clock offset

`GET /v4/time` returns `{"iso":"2026-10-12T22:21:06.019Z","epoch":1791843666.019}`, with `epoch` in seconds and a millisecond fraction, S1 and P1.
Over ten warm requests the server clock sat 0.3 to 12.5 ms ahead of the midpoint of each request in P1 and -1.2 to 7.9 ms in P2, with medians of 2.3 and 3.6 ms.
`GET /v4/height` returns the latest block the Indexer has, `{"height":"109166830","time":"2026-10-12T22:21:08.409Z"}`, and that block was 786 to 1,960 ms old on arrival over P1 and P2.

## 8. Recommended poller shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL | `GET https://indexer.dydx.trade/v4/perpetualMarkets` | one call carries the index and the rate for all 296 markets, section 3 |
| interval | 1,000 ms, the default | 10 of the 100 points per 10 s, and Cloudflare serves half the polls from its 1 s cache |
| row mapping | section 3: `index` from `oraclePrice`, `mark` 0, `funding_rate` from `nextFundingRate`, `funding_interval_hours` 1, `next_funding_at` the next whole UTC hour after the round's arrival | |
| skip | rows whose `status` is not `ACTIVE`, and rows with an empty or zero `oraclePrice` | section 2 |
| move guard | none needed in the adapter, but an oracle step can be 800 ppm, close to the engine's 1,000 ppm move guard at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) line 6 | section 4 |
| rate limit | `rate_limit_pause` 10 s, and a 429 mapped inside the venue if its `Retry-After` must be read as ms | section 6 |
| ts | the round's arrival, as the runtime stamps it | the oracle is about 1 s behind its block and up to 1 s more behind on a cache hit, which fits the 10 s age and 5 s skew limits at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) lines 4 and 5 |

At a 1 s interval the reply is about 14 GB a day, which the design treats as free.
Because the mark is 0, every dYdX route is refused at open until the engine learns to judge a venue that marks to its oracle, and that is the named change of the survey note.

## 9. Decentralised layer

### The chain and how it stamps time

dYdX is its own chain, the dYdX Chain, a Cosmos chain with CometBFT consensus, chain id `dydx-mainnet-1` at CCXT `dydx.js` line 240, S6.
Validators "take turns proposing blocks of trades every ~1 second", and "the proposer uses its mempool orderbook to propose a block of matches", S6.
Blocks came 509 to 1,082 ms apart on the socket, with medians of 613 and 626 ms, [`websocket.md`](./websocket.md) P5 and P8, and 1.52 to 1.6 blocks a second through `/v4/height`, P1 and P2.
The chain's `next_block_delay` parameter is 0.200 s, P1 and P2 `chain`.
Short-term orders live off chain in each node's memory and are matched by the proposer, so there is no single canonical book between blocks, S15.

The Indexer is a read service fed by the full node it listens to.
Book updates are sent "when the full-node the Indexer is listening to receives orders / cancels and not just when the block is finalized", S6, and book frames carry no timestamp.
Oracle prices carry `effectiveAt`, the block time, and `effectiveAtHeight`, and arrived 746 to 1,541 ms after `effectiveAt`.
Funding settlements carry the `effectiveAt` of the first block after the hour, 27 to 812 ms after it.
So a book reading is the Indexer's node's view at arrival, and an anchor reading is about a second behind its block.

### Who may use it, and from where

The dYdX Software Terms of Use bar persons of the United States, Canada and the United Kingdom from the perpetuals, and VPN use to get around that, [`fees.md`](./fees.md) section 1.
The Indexer labels this host `restricted` from its Canadian exit and still serves every public market data call and every public socket channel, section 1.
The account channels pass the client's location headers to their first fetch, which can refuse a restricted location, [`websocket.md`](./websocket.md) section 7.
The observatory reads only public market data.

### The oracle behind the index and the mark

The index is the chain's oracle price, built from the market map's sources as section 4 describes, with steps of at least 500 or 800 ppm.
The venue has no separate mark, and margin and liquidation use the same oracle price, section 4.
`WTI-USD` and `XAG-USD` take one Pyth feed each, and `LIT-USD` one Gate book, so those three indexes have no second source.

### Who can list a market

Listing is partly permissionless.
The software terms carry an annex for the "instant market listing software feature on dYdX protocol (“Instant Listing”)", S16, and the chain's listing module caps the market count at 500, `markets_hard_cap`, P1 and P2.
The 180 isolated markets are all in final settlement now, section 2.
Six settled tickers spell a source pool, five isolated and one cross, such as `CIG,RAYDIUM,EXRQAUXS967FDKYMNXO4EQZEQIHEUBSTBCXPXXWPUMP-USD`, so a listed ticker names whatever its market map entry follows.
A new isolated market can therefore carry a ticker that names another token than the other venues list under it, and the market map's CoinMarketCap id, where present, says which token it is.
All 73 live markets are cross markets, so today the risk sits in the few tickers of section 2.

### Venues that route to dYdX, and where dYdX routes

dYdX routes to no other venue, since its book and matching are its own chain's.
No profile in this repository records a venue that routes its perpetuals to dYdX, and a search of the survey doc and every profile for dYdX found only `DYDX` token pairs.
The `dydx.trade` web front end reads this Indexer, and its configuration names "Greave Cayman Limited" as the operator of MegaVault, the protocol's vault feature, S17.
Order entry goes to full nodes or the Order Entry Gateway Service, `oegs.dydx.trade`, which carries orders, not market data, S2.

### A node as the data source

A full node can stream the order book itself, with `grpc-streaming-enabled` and an optional websocket server, sending L3 order updates, fills and taker orders, S18.
The docs "recommend you use this exclusively with your own node", and "the orderbook state can vary slightly between nodes due to dYdX's offchain orderbook design", S18.
That route would replace the Indexer's one node view with the observatory's own, at the cost of running a node, and it is out of scope here.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | dYdX Documentation, Indexer HTTP API | https://docs.dydx.xyz/indexer-client/http | 2026-10-12 | dYdX docs | routes and parameters, sections 2, 5 and 7 |
| S2 | dYdX Documentation, Connecting to dYdX | https://docs.dydx.xyz/interaction/endpoints | 2026-10-12 | dYdX docs | Indexer and node hosts, node rate limits, OEGS, sections 1, 6 and 9 |
| S3 | Indexer `compliance/src/geoblocking/restrict-countries.ts` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/packages/compliance/src/geoblocking/restrict-countries.ts | 2026-10-12 | dYdX Chain source | the `geo-origin-status` rule, section 1 |
| S4 | dYdX Documentation, `PerpetualMarketStatus` | https://docs.dydx.xyz/types/perpetual_market_status | 2026-10-12 | dYdX docs | status values, section 2 |
| S5 | dYdX Documentation, Funding | https://docs.dydx.xyz/concepts/trading/funding | 2026-10-12 | dYdX docs | formula, hourly tick, cap, sections 3 and 4 |
| S6 | dYdX Documentation, Onboarding FAQs | https://docs.dydx.xyz/concepts/onboarding-faqs | 2026-10-12 | dYdX docs | the oracle sidecar and its one-block delay, block time, when book updates are sent, sections 4 and 9 |
| S7 | v4-chain `x/prices/keeper/validate_market_price_updates.go` at `bd2dd7d`, lines 187 to 198 | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/protocol/x/prices/keeper/validate_market_price_updates.go#L187-L198 | 2026-10-12 | dYdX Chain source | an update below the minimum change is rejected, section 4 |
| S8 | v4-chain `prices/market_param.proto` at `bd2dd7d`, lines 31 to 33 | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/proto/dydxprotocol/prices/market_param.proto#L31-L33 | 2026-10-12 | dYdX Chain source | "The minimum allowable change in `price` value that would cause a price update on the network", section 4 |
| S9 | dYdX Documentation, Margin | https://docs.dydx.xyz/concepts/trading/margin | 2026-10-12 | dYdX docs | the oracle price in margin, section 4 |
| S10 | dYdX Documentation, Liquidations | https://docs.dydx.xyz/concepts/trading/liquidations | 2026-10-12 | dYdX docs | the oracle price in liquidation, section 4 |
| S11 | Indexer `redis/src/caches/next-funding-cache.ts` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/packages/redis/src/caches/next-funding-cache.ts#L21-L47 | 2026-10-12 | dYdX Chain source | what `nextFundingRate` holds, section 4 |
| S12 | Indexer comlink `config.ts` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/comlink/src/config.ts | 2026-10-12 | dYdX Chain source | the 100 level book cap at line 30, section 5 |
| S13 | the same comlink `config.ts`, `RATE_LIMIT_GET_POINTS` 100 per `RATE_LIMIT_GET_DURATION_SECONDS` 10 | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/comlink/src/config.ts#L53-L54 | 2026-10-12 | dYdX Chain source | the request budget, section 6 |
| S14 | Indexer comlink `lib/rate-limit.ts` at `bd2dd7d` | https://github.com/dydxprotocol/v4-chain/blob/bd2dd7dabc2cc171a4c243206602234585754613/indexer/services/comlink/src/lib/rate-limit.ts#L62-L68 | 2026-10-12 | dYdX Chain source | the 429 answer and its `Retry-After` in ms, section 6 |
| S15 | dYdX Documentation, Watch Orderbook | https://docs.dydx.xyz/interaction/data/watch-orderbook | 2026-10-12 | dYdX docs | "a new canonical orderbook every block", section 9 |
| S16 | dYdX Software Terms of Use, last updated March 12, 2026 | https://dydx.exchange/v4-terms | 2026-10-12 | dYdX Trading Inc. | Instant Listing, restricted persons, section 9 |
| S17 | `dydx.trade` front end bundle `assets/main-C4a5wKE5.js` | https://dydx.trade/assets/main-C4a5wKE5.js | 2026-10-12 | the `dydx.trade` deployment | its Indexer endpoints, the MegaVault operator, and its reading of the `geo-origin-*` headers, sections 1 and 9 |
| S18 | dYdX Documentation, Full Node gRPC Streaming | https://docs.dydx.xyz/nodes/full-node-streaming | 2026-10-12 | dYdX docs | the node side stream, section 9 |
| S19 | CCXT 4.5.68 `dydx.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/dydx.js` | 2026-10-12 | CCXT | catalog mapping, section 2 |
| P1 | `rest-probe.py`, modes `host` and `catalog` at 22:21 UTC, `funding` and `errors` at 22:21, `book` at 22:21 to 22:22, `chain` at 22:22 and again with the market map at 22:23, and `anchor` and `funding` from 22:23:39 to 22:24:41 | [`rest-probe.py`](../../../scripts/probes/venues/dydx/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 7 and 9 |
| P2 | `rest-probe.py`, every mode, the second pass from 22:34:28 to 22:36:28 UTC | [`rest-probe.py`](../../../scripts/probes/venues/dydx/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 7 and 9 |
