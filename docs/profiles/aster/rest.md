# Aster REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:16 to 22:28 UTC, with the second pass from 22:34 to 22:42 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

**Rechecked:** 2026-10-12 from 22:48 to 23:08 UTC, against the live venue while the Rust adapter was built, and each corrected line names that date.

This profile covers the public futures REST API of Aster (CCXT id `aster`) that a catalog, an anchor poller and a book resync would use, and Aster's decentralised layer in section 9.
The API is a copy of Binance's USD-M futures API on `https://fapi.asterdex.com`, with paths under `/fapi/v1/` and `/fapi/v3/`, and CCXT 4.5.68 calls the `/fapi/v3/` paths.
Every call here is a public GET with no key, no wallet and no signature.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/aster/rest-probe.py) or [`fees-probe.py`](../../../scripts/probes/venues/aster/fees-probe.py), and the runs are listed as P1, P2, P7 and R1 to R3 in section 10.
Fees and who may trade are in [`fees.md`](./fees.md), and the socket is in [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-12 | edge |
|---|---|---|---|
| `fapi.asterdex.com` | futures REST | 99.86.101.111, 99.86.101.123, 99.86.101.45 and 99.86.101.73 | CloudFront, `x-amz-cf-pop: SEA900-P13`, `x-cache: Miss from cloudfront` on every reply |
| `sapi.asterdex.com` | spot REST | the same four addresses | not called |

Every public call answered, and no reply was a refusal or a geoblock, although the terms list Canada as a Prohibited Jurisdiction, see [`fees.md`](./fees.md) section 1.

Latency in P1, one fresh client per call for the cold time, then five requests 200 ms apart on its kept connection.

| call | weight on the wire | cold ms | warm ms | reply bytes, decoded |
|---|---:|---:|---|---:|
| `GET /fapi/v3/time` | 1 | 133 | 102 to 293, median 277 | 28 |
| `GET /fapi/v3/exchangeInfo` | 1 | 155 | 115 to 397, median 198 | 865,369 |
| `GET /fapi/v3/premiumIndex`, every symbol | 10 | 138 | 108 to 356, median 116 | 169,903 |
| `GET /fapi/v3/fundingInfo`, every symbol | 10 | 147 | 103 to 280, median 111 | 108,499 |
| `GET /fapi/v3/depth?symbol=BTCUSDT&limit=20` | 2 | 138 | 100 to 180, median 103 | 883 |
| `GET /fapi/v3/ticker/bookTicker`, every symbol | 2 | 138 | 108 to 371, median 113 | 90,095 |

The second pass, R1, gave warm medians of 279, 205, 109, 107, 113 and 115 ms on the same six calls, and a cold `exchangeInfo` of 328 ms.
The weight column is the step of `x-mbx-used-weight-1m` per call, the same in P1 and R1.
S1 documents `premiumIndex` at weight 1 with no rule for the all-symbol form, while the wire charged 10 on every all-symbol call in P1 and P2.
Large replies came gzip-encoded when asked.
No reply took over 2 s, so the reader's 5 s skew and 10 s age limits at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) lines 4 and 5 are not at risk from this host.

## 2. Catalog

### The instruments call

`GET /fapi/v3/exchangeInfo`, weight 1, returns every futures row with its filters, S1.
`/fapi/v1/exchangeInfo` returned the same 629 symbols, P1.

| `status` | `contractType` | quote and margin | rows |
|---|---|---|---:|
| `TRADING` | `PERPETUAL` | USDT | 577 |
| `SETTLING` | `PERPETUAL` | USDT | 22 |
| `TRADING` | `PERPETUAL` | USD1 | 22 |
| `PENDING_TRADING` | empty | USDT | 6 |
| `TRADING` | `PERPETUAL` | `U` | 2 |

S1 documents the statuses `PENDING_TRADING`, `TRADING`, `PRE_SETTLE`, `SETTLING` and `CLOSE`.
So the kept set, `TRADING` linear perpetuals quoted in USDT, USDC or USD, is 577 markets, all USDT-settled, which matches CCXT's 577, P7.
No row carries `contractSize` or `unit`, P1.

Each row also carries flags that S1's example does not show, P1.

| field | values on 2026-10-12 | meaning, from the rows that carry each value |
|---|---|---|
| `symbolType` | 0 on 484 rows, 1 on 145 | 1 marks stocks, ETFs and commodities, the RWA fee class of [`fees.md`](./fees.md) section 4, on 121 kept markets |
| `tradingMode` | 0 on 494, 1 on 135 | 1 on most stocks, 0 on forex and commodities, not documented |
| `channel` | `{}` 355, empty 133, `nasdaq` 113, `forex` 13, `hkstock` 7, `krstock` 6, `astock` 2 | the stock or price venue of an RWA market |
| `underlyingSubType` | `STOCK`, `ETF`, `Commodities`, `Meme`, `AI`, `Top`, `Semiconductor`, `pre-launch`, `AOS2`, `USD1-RWA` | tags, and the only marker of AOS-2 listings and pre-launch contracts |
| `name` | empty except on 22 rows, such as `XAUUSDT` `Gold` and `币安人生USDT` `BIANRENSHENG` | a display name |

Special markets among the rows, P1.

| group | markets | kept |
|---|---|---|
| AOS-2 listings, `underlyingSubType` holds `AOS2` | `BTCU`, `ETHU` and 14 `…USD1` markets | none, every one is quoted in USD1 or `U` |
| pre-launch, `underlyingSubType` holds `pre-launch` | `OPENAIUSDT`, `ANTHROPICUSDT`, and three USD1 markets | `OPENAIUSDT` and `ANTHROPICUSDT` |
| ids that are not ASCII | `币安人生USDT`, `我踏马来了USDT`, `龙虾USDT`, `牛来USDT`, `哈基米USDT` | all five |
| an id with a hyphen | `B-MONEYUSDT`, base `B-MONEY` | kept, and its stream works, checked on 2026-10-12, see [`websocket.md`](./websocket.md) section 4 |
| `1000` and digit prefixed bases | `1000SHIBUSDT`, `1000PEPEUSDT`, `1000FLOKIUSDT`, `1000BONKUSDT`, `1000CHEEMSUSDT`, `1000LUNCUSDT`, `1000NEXUSDT`, `1000XECUSDT`, `1000RATSUSDT`, `1000CATUSDT`, and `0GUSDT`, `2ZUSDT`, `4USDT`, `4STOCKUSDT` | all fourteen |
| one base on two or three quotes | `BTC`, `ETH`, `SOL`, `XAU`, `XAG`, `CL`, `BZ`, `META`, `MU`, `QQQ`, `SKHYNIX`, `SNDK`, `SOXL`, `SPCX` | only the USDT row of each, so no pair is listed twice in the kept set |

### How CCXT 4.5.68 maps it

| item | CCXT 4.5.68 | consequence |
|---|---|---|
| calls | `fetchMarkets` reads spot and futures `v3/exchangeInfo` at `aster.js` lines 721 and 722, and calls `signIn` at line 724, whose body at lines 4241 to 4247 returns without a request when no key is set | a credential-free load works, 700 markets in 883 ms, P7 |
| row filter | rows with an empty `baseAsset` are skipped at lines 824 to 831 | none was empty on 2026-10-12 |
| `market.id` | `symbol` | the socket stream is this id lowercased, and the anchor rows key on it unchanged, see [`websocket.md`](./websocket.md) section 3 |
| `active` | `status === 'TRADING'` at line 841 | 601 active swaps, and the 22 `SETTLING` rows inactive, P7 |
| `linear` | `settle === quote` at line 859 | true on all 577 kept |
| `contractSize` | `contractSize`, then `unit`, then 1, at line 861 | 1 on all 577, which matches the base-coin sizes of the book |
| `commonCurrencies` | none in the class | ids pass through uppercased, so `1000PEPE` stays `1000PEPE`, as on Binance |

The six `PENDING_TRADING` rows with an empty `contractType` are not among CCXT's 623 swaps, P7.

### What the catalog needs

- Keep `TRADING` rows with `contractType` `PERPETUAL` and a quote in USDT, USDC or USD, which is 577 markets today.
- Leave out any row whose `underlyingSubType` holds `AOS2`, so that a future AOS-2 listing quoted in USDT stays out, as decision 7 of [`2026-10-12-dex-venues-design.md`](../../implemented/2026-10-12-dex-venues-design.md) asks for third-party markets.
  None is in the kept set today, section 9.
- Lowercase the id for the socket with a Unicode-aware lowercase, because five ids are not ASCII, and percent-encode it in a REST query.
- Set the taker per market from the three fee classes of [`fees.md`](./fees.md) section 9.
- Leave `OPENAIUSDT` and `ANTHROPICUSDT` out of the anchor rows, because each one's index is a single other venue's price, section 4.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /fapi/v3/premiumIndex`, no symbol | `indexPrice` | `markPrice` | `lastFundingRate` | absent | `nextFundingTime`, Unix ms | 781 rows, 169,903 bytes decoded | warm median 116 ms in P1 and 109 ms in R1, and over 60 polls 103 to 388 ms, median 356 ms, in P2 and 104 to 395 ms, median 364 ms, in R1 |
| `GET /fapi/v3/fundingInfo`, no symbol | | | | `fundingIntervalHours` | | 781 rows, 108,499 bytes | warm median 111 ms |
| `GET /fapi/v1/premiumIndex` | same fields | | | | | 781 rows | 111 ms |

Each `premiumIndex` row is `symbol`, `markPrice`, `indexPrice`, `estimatedSettlePrice`, `lastFundingRate`, `interestRate`, `nextFundingTime` and `time`, and each `fundingInfo` row is `symbol`, `interestRate`, `time`, `fundingIntervalHours`, `fundingFeeCap` and `fundingFeeFloor`, P1.
All 577 kept markets were in both replies, and none had a zero or empty mark or index, P1.
Of the 781 rows, 628 are catalog rows, every one but `MBLUSDT`, and 153 are symbols that no catalog row names, such as `BTCUSD`, `AAPLUSD` and `EURUSD`, P1.
Every row of one reply carried the same `time`, a whole second, on every poll of P2, while at least one reply in R1 carried two.
That `time` was 1,242 ms old at arrival in P1 and 1,609 ms in R1, and over 60 polls 150 to 1,432 ms old, median 1,151 ms, in P2 and 171 to 1,180 ms, median 1,148 ms, in R1.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `symbol` | string, as the catalog spells it, including `币安人生USDT` | none |
| `index` | `indexPrice` | decimal string | parse |
| `mark` | `markPrice` | decimal string, never 0 on a kept row | parse |
| `funding_rate` | `lastFundingRate` | a fraction for the coming settlement, despite its name, section 4 | parse |
| `funding_interval_hours` | `fundingIntervalHours` of `fundingInfo` | integer hours: 8 on 180 kept markets, 4 on 347 and 1 on 50 | as is, refreshed about hourly |
| `next_funding_at` | `nextFundingTime` | Unix ms, on the interval's UTC grid on all 577 | as is |

The binance anchor at [`binance/anchor.rs`](../../../server/src/venues/binance/anchor.rs) reads the same two calls with the same field names, so it carries over with Aster's host and `/fapi/v3/` paths.

## 4. Anchor semantics

### Index

S5 says the index is "a weighted average derived from major spot markets", and S6 says each validator computes "a weighted median spot price using data from 14 major exchanges": Binance, HTX, HitBTC, Gate.io, Poloniex, OKX, KuCoin, AscendEX, MEXC, Bitfinex, Coinbase, Bitstamp, Kraken and Bybit.
The basket call, `GET /fapi/v3/indexreferences?symbol=…`, weight 1, names the sources of one market, S1, and the wire disagrees with S6's list.

| market | sources and weights on the wire, P1 |
|---|---|
| `BTCUSDT` | binance 0.4348, okex 0.1304, coinbase 0.1304, gateio 0.0435, kucoin, mexc, bitget and bybit 0.0652 each |
| `ASTERUSDT` | binance 0.25, okex 0.1667, gateio, mexc and bybit 0.0833 each, and `aster` `ASTERUSDT` 0.3333, Aster's own market |
| `1000PEPEUSDT` | seven venues, each spelled `PEPE…*1000`, binance 0.5 |
| `AAPLUSDT` | `binance_future` `AAPLUSDT` 0.0074, databento 0.1103, dxfeed 0.2574, kaiko 0.2574, massive 0.1103, `pyth_pro` 0.2574 |
| `XAUUSDT` | `binance_future` 0.0104, dxfeed 0.3646, `hyperliquid` `xyz:GOLD` 0.1042, massive 0.1563, `pyth_pro` 0.3646 |
| `CLUSDT` | `binance_future` 0.0164, `hyperliquid` `xyz:CL` 0.1639, redstone 0.8197 |
| `SKHYNIXUSDT` | `binance_future` 0.0098, `hyperliquid` `xyz:SKHX` 0.0098, kaiko 0.4902, `pyth_pro` 0.4902 |
| `TENCENTUSDT` | `binance_future` 0.0099, kaiko 0.4950, `pyth_pro` 0.4950 |
| `币安人生USDT` | binance 0.625, kucoin 0.0938, mexc 0.0938, `pancakeswapV2` pool 0.1875 |
| `OPENAIUSDT`, `ANTHROPICUSDT` | `binance` with the same symbol, weight 1.0, the only source |

Four shapes matter to the engine.
`OPENAIUSDT` and `ANTHROPICUSDT` take their whole index from one Binance market, so a Binance and Aster route on either would judge the Aster leg against Binance's own price, the shape that blocked Batonex in [`2026-09-22-venue-survey.md`](../../research/2026-09-22-venue-survey.md).
`ASTERUSDT` puts a third of its index on Aster's own `ASTERUSDT` market, which the call does not say is spot or perpetual.
Stock and commodity indexes put 0.7 to 1.6 % on Binance's TradFi perpetuals, and four of them put 1 to 16 % on Hyperliquid's builder-dex `xyz` markets.
`OPENAIUSDT` and `ANTHROPICUSDT` are also pre-launch contracts, whose mark S7 defines as a 10 s average of Aster's own trades, capped at ±1 % a second.
So for those two the mark trails Aster's own trades, and the index is Binance's.

### Mark

S5 defines the mark as the median of the index times (1 + rate × hours to funding ÷ 8), the index plus a 5-minute average of the mid minus the index sampled each minute, and the last price.
Its safeguards zero a source more than 5 % from the median, fall back to the median when several deviate, drop a source silent for 3 s, and replace a last price more than 5 % off and 5 s old by the mark.
No premium clamp is published.
On the wire in P1 the premium, mark over index, was 387 ppm at the median of the 577 kept markets, 2,108 ppm at p90, and 68,630 ppm at most on `PEARLUSDT`, and 10 kept markets sat more than 1 % from their index.
In R1 the same figures were 379, 2,139 and 40,716 ppm, with 13 markets beyond 1 %.
Stocks use an EWMA of the last price in place of the last price outside market hours, S8.
At 22:19 UTC, after the US close, 19 kept markets had a mark equal to their index to the last digit, 16 of them RWA, among them `AAPLUSDT`, `NFLXUSDT` and `SPYUSDT`, P1.
At 22:34 UTC 20 did, 16 of them RWA, with `NFLXUSDT` and `SPYUSDT` still among them and `AAPLUSDT` no longer, R1.
Such a leg reads as carrying no premium at all.

### Funding

The formula, interest, sampling and cap are in [`fees.md`](./fees.md) section 6.
`lastFundingRate` is the running estimate for the coming settlement rather than the last settled rate.
At 22:19 UTC `BTCUSDT` read `0.00007813`, while the 16:00 settlement in `fundingRate` history was `0.00002395`, and `ASTERUSDT` read `0.00003722` against the 20:00 settlement's `0.00000484`, P1.
On the 1 h `ARGUSUSDT` both read `0.00001250`, which is the interest term alone.
`nextFundingTime` was 23:00 UTC on 50 kept markets and 00:00 UTC on 527, matching each market's interval, P1.
The settlement instant itself was not captured.

### How often each number changed

60 polls at one per second, counted over 59 transitions, from 22:19:42 UTC in P2 and from 22:34:47 UTC in R1, each cell P2 then R1.

| market | index | mark | rate | next funding |
|---|---:|---:|---:|---:|
| mean of 577 kept | 24.8 and 27.3 | 26.0 and 28.8 | 0.24 and 0.23 | 0 and 0 |
| `BTCUSDT` | 37 and 40 | 26 and 33 | 1 and 1 | 0 and 0 |
| `ETHUSDT` | 35 and 42 | 32 and 31 | 1 and 1 | 0 and 0 |
| `ASTERUSDT` | 17 and 21 | 20 and 25 | 1 and 0 | 0 and 0 |
| `AAPLUSDT` | 51 and 58 | 51 and 58 | 0 and 0 | 0 and 0 |
| `XAUUSDT` | 51 and 58 | 45 and 58 | 0 and 0 | 0 and 0 |
| `OPENAIUSDT` | 22 and 9 | 27 and 18 | 0 and 0 | 0 and 0 |

The mark of 32 kept markets in P2 and 31 in R1 never changed in the minute, `SUSHIUSDT` and `NOTUSDT` in P2 and `1000BONKUSDT` and `ARUSDT` in R1 among them.
So index and mark republish about every 1 to 2.5 s on a busy market and every 2 to 6.6 s on `OPENAIUSDT`, which fits the reader's 10 s age limit.

## 5. REST book snapshot

`GET /fapi/v3/depth?symbol=…&limit=…`, S1.

| item | documented, S1 | probed, P1 |
|---|---|---|
| limits | 5, 10, 20, 50, 100, 500 and 1000, default 500 | each returned exactly that many levels a side on `BTCUSDT`, and no limit returned 500 |
| weight | 2 up to 50, 5 at 100, 10 at 500, 20 at 1000 | the counter rose by 2, 2, 2, 5, 10 and 20 for the limits 10 to 1000 |
| order | | bids descending and asks ascending on every read |
| fields | `lastUpdateId`, `E`, `T`, `bids`, `asks` | as documented, with `E` 52 to 67 ms old at arrival in P1 and 53 to 145 ms in R1 |
| quiet book | | `B-MONEYUSDT` returned 6 bids and 3 asks with an `E` 3,374,998 ms old, so `E` is the time of the book's last change, R1 `book` |
| caching | | four reads 250 ms apart had four different `lastUpdateId` values |
| lowercase symbol | | `btcusdt` answered like `BTCUSDT` |
| settling or pending market | | `TONUSDT` and `AFEEUSDT` answered 400 `{"code":-4108,"msg":"Symbol is on delivering or delivered or settling or closed or pre-trading."}` |

`lastUpdateId` shares the socket's update counter, so S1's diff recipe can seed a book from this call, see [`websocket.md`](./websocket.md) section 4.

## 6. Rate limits and errors

| item | documented, S1 | probed |
|---|---|---|
| budget | `REQUEST_WEIGHT` 2,400 a minute per IP, also in `exchangeInfo.rateLimits` | not approached, the most seen was 290 in a minute during P2 |
| order limits | 1,200 a minute and 300 per 10 s per account | not relevant |
| statuses | 429 at a limit, 418 after continued requests, 403 on a WAF breach, bans from 2 minutes to 3 days | none seen |
| `Retry-After` | not documented | absent on every reply in P1 |
| weight header | `X-MBX-USED-WEIGHT-1M` on every reply | present, P1 |

| request | status | body |
|---|---:|---|
| `depth` for `NOPEUSDT` | 400 | `{"code":-1121,"msg":"Invalid symbol."}` |
| `depth` with `limit=7` | 400 | `{"code":-4021,"msg":"7 is not valid depth limit"}` |
| `premiumIndex` for `NOPEUSDT` | 400 | `{"code":-1121,"msg":"Invalid symbol."}` |
| `indexreferences` for `NOPEUSDT` | 400 | `{"code":-1000,"msg":"Invalid symbol."}` |
| `indexreferences` with no symbol | 400 | `{"code":-1102,"msg":"Mandatory parameter 'symbol' was not sent, was empty/null, or malformed."}` |
| an unknown path | 404 | an HTML page |
| `POST /fapi/v3/premiumIndex` | 405 | empty |

The poller pauses on 403, 418 and 429 at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 21, which covers every limit status S1 names.

## 7. Server time and clock offset

`GET /fapi/v3/time`, weight 1, returns `{"serverTime":…}` in ms.
On the fastest of ten calls, a 103 ms round trip, local time minus server time lay between −51 and +52 ms, so the two clocks agree within the round trip, P1.
The local clock is NTP synchronised.

## 8. Recommended poller shape

A recommendation for the builder, which answers decisions 18 to 20 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md).

| item | recommendation | reason |
|---|---|---|
| source | `GET https://fapi.asterdex.com/fapi/v3/premiumIndex` with no symbol, every round | one call carries index, mark, rate and next funding for every market |
| interval | 1,000 ms, the default | weight 10 a call is 600 a minute, a quarter of the 2,400 budget, and the rows are about 1.15 s old on arrival |
| funding interval | `GET /fapi/v3/fundingInfo` once an hour, as the binance anchor rereads its table | the interval is not in `premiumIndex`, and S3 says intervals change without notice |
| row mapping | section 3 | |
| skip | rows not in the tracked set, which drops the 204 rows outside the kept set, 153 of them outside the catalog | |
| leave out | `OPENAIUSDT` and `ANTHROPICUSDT` | each index is one Binance market, section 4, which decision 4 of the waves design treats like a self index |
| flag | `ASTERUSDT`, a third of whose index is Aster's own market, and the RWA markets whose mark equals the index off hours | section 4 |
| rate limit pause | the runtime's default, since S1 documents no `Retry-After` | |
| socket alternative | `!markPrice@arr@1s` through `SocketAnchors`, decision 13, if the REST round ever runs slow | it pushes the same fields for all 781 symbols every 1,001 ms, [`websocket.md`](./websocket.md) section 2 |

The reply is about 170 KB decoded, so a one-second poll moves about 15 GB a day before compression, which the design treats as free.

## 9. Decentralised layer

This section answers decision 3 of [`2026-10-12-dex-venues-design.md`](../../implemented/2026-10-12-dex-venues-design.md) and the questions of [`2026-09-23-hyperliquid-research-plan.md`](../../plans/2026-09-23-hyperliquid-research-plan.md).

### Chain and sequencer

| item | value | source |
|---|---|---|
| chain | Aster Chain, Aster's own layer 1, "designed specifically for derivatives trading" | S6 |
| consensus | Proof-of-Staked-Authority, with no external validators in Phase 1 | S6 |
| block time | 50 ms, up to 100,000 transactions a second, no gas | S6 |
| matching | V3 futures are "built on top of Aster L1", and "All order matching and trading logic are ultimately processed and stored onchain" | S2, S6 |
| bridge | deposits clear on 3 of 4 validator signatures, withdrawals on 2 of 3 | S6 |
| open source | bridge contracts are published, while the "Core chain contracts and RPC infrastructure will not be open-sourced at the moment" | S6 |
| privacy | Account Privacy hides balances and positions behind ZK-verified encrypted orders, and an order with time in force `HIDDEN` "is not visible in the order book", and S15 says every order is encrypted before it reaches the chain | S6, S15, S1 |
| chain RPC | JSON-RPC at `https://tapi.asterdex.com/info` with `aster_getBalance`, open orders and fills per address, and no book, index or mark | S9 |

No market data frame or reply carries a block height.
Book frames carry `E`, the event time, and `T`, the transaction time, 27 ms apart on the captured `BTCUSDT` frame, and `E` trailed arrival by about 55 ms, see [`websocket.md`](./websocket.md) section 3.
`premiumIndex` stamps every row of a reply with one whole second, and the mark stream stamps `E` on the whole second, so the anchor is computed once a second.
No node can be run in place of the API, since validators are closed in Phase 1 and the RPC serves account data only.
So the public API on `fapi.asterdex.com` is the only market data source.

### Who may use it and from where

The terms bar the United States, Canada, the United Kingdom, China, North Korea, Russia, Ukraine, Cuba, Iran, Venezuela and Syria, and they are governed by Hong Kong law, see [`fees.md`](./fees.md) section 1.
The docs index lists a login by Web3 wallet and a login by email address, S17, and the V3 API is signed by an API wallet, an agent, S2.
From 2026-09-01 every authenticated V3 endpoint needs a completed deposit into the main wallet, while public market data needs nothing, S2.
From this host every public REST call and socket answered with no geoblock, through CloudFront in Seattle.

### Oracle behind the index and the mark

S6 says each validator computes a weighted median spot price from 14 named exchanges, that this oracle serves funding, the mark and TP/SL triggers, and that liquidation uses the median oracle price weighted by validator stake.
`indexreferences` names a different and per-market basket on the wire, section 4.
It holds 8 venues for `BTCUSDT`, among them bitget, which S6 does not list, and data vendors such as `pyth_pro`, dxfeed, kaiko, databento, massive and redstone for stocks and commodities.
It also holds Binance's TradFi perpetuals, Hyperliquid's `xyz` builder-dex markets, a PancakeSwap pool, and Aster's own `ASTERUSDT`.
S8 names Pyth among the stock index providers.
The mark is the venue's median of three, section 4, computed by the venue rather than by a separate oracle network.

### Who can list a market

Two listing paths exist besides Aster's own listings.
AOS-2 lets a project list a perpetual by staking 1,000,000 $ASTER for four years, if its token is on Binance Alpha or a Tier 2 exchange and has at least $10,000,000 of circulating market cap, and if it names a market maker, S10.
A validator vote then decides, and Aster's risk team sets the parameters before the market goes live T+1, S10.
Separately, any active validator, one with at least 20,000,000 $ASTER staked, can propose a listing that passes on more than half of the active stake and more than half of the validators, S11.
An AOS-2 market enters the same catalog, under a plain symbol, with `AOS2` in `underlyingSubType`, P1.
All 16 on 2026-10-12 are quoted in USD1 or `U`, so none is in the kept set.
A future AOS-2 market quoted in USDT would carry a plain `<BASE>USDT` symbol, so its ticker could name another token than the other venues list under it.
The loader rule of section 2 leaves such rows out, and `live_identity` catches the rest.

### Routing

Aster's Pro mode book routes to no other venue.
Aster Code lets third-party front ends route orders into Aster's book for a builder fee, S12, and CCXT is one such builder, see [`fees.md`](./fees.md) section 5, so those are views of the same book rather than other books.
1001x trades against Aster's own ALP pool, and Shield mode has no order book, S13 and S14.
No venue in [`2026-09-22-venue-survey.md`](../../research/2026-09-22-venue-survey.md) was found to route to Aster.
The index baskets read Binance's and Hyperliquid's markets, section 4, which is a price dependency, not order routing.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Aster Futures API V3 | https://github.com/asterdex/api-docs/blob/master/V3(Recommended)/EN/aster-finance-futures-api-v3.md | 2026-10-12, repository head `eeddec8d97` of 2026-09-23 | Aster, API docs | endpoints, weights, limits, statuses, errors, sections 1 to 8 |
| S2 | API docs README, CHANGELOG and "Aster API V1 vs V3" | https://github.com/asterdex/api-docs | 2026-10-12 | Aster, API docs | V3 on Aster L1, agent signing, the deposit rule of 2026-09-01, section 9 |
| S3 | Funding Rate | https://docs.asterdex.com/trading/perpetuals/fees-and-specs/funding-rate.md | 2026-10-12 | Aster, docs | unannounced interval changes, section 8 |
| S4 | Pre-IPO Perpetuals | https://docs.asterdex.com/trading/perpetuals/pre-ipo-perpetuals.md | 2026-10-12 | Aster, docs | OPENAI and ANTHROPIC markets, section 4 |
| S5 | Mark price, for Pro mode | https://docs.asterdex.com/trading/perpetuals/fees-and-specs/mark-price-1.md | 2026-10-12 | Aster, docs | index and mark formula, safeguards, section 4 |
| S6 | Aster Chain, Overview | https://docs.asterdex.com/aster-chain/overview.md | 2026-10-12 | Aster, docs | chain, consensus, bridge, oracle, section 9 |
| S7 | Pre-Launch Contracts | https://docs.asterdex.com/trading/perpetuals/pre-launch-contracts.md | 2026-10-12 | Aster, docs | pre-launch mark, section 4 |
| S8 | Stock Perpetuals | https://docs.asterdex.com/trading/perpetuals/stock-perpetuals.md | 2026-10-12 | Aster, docs | EWMA mode and Pyth, sections 4 and 9 |
| S9 | Aster Chain RPC | https://github.com/asterdex/api-docs/blob/master/RPC/aster-chain-rpc.md | 2026-10-12 | Aster, API docs | the JSON-RPC methods, section 9 |
| S10 | AOS-2 Perpetual Listing | https://docs.asterdex.com/aster-open-standards/aos-2-perpetual-listing.md | 2026-10-12 | Aster, docs | listing stake, eligibility, vote, section 9 |
| S11 | Governance, Listing Vote | https://docs.asterdex.com/aster-chain/governance.md | 2026-10-12 | Aster, docs | validator proposals and thresholds, section 9 |
| S12 | Aster Code | https://docs.asterdex.com/program-and-rewards/aster-code.md | 2026-10-12 | Aster, docs | builder routing, section 9 |
| S13 | 1001x | https://docs.asterdex.com/trading/1001x.md | 2026-10-12 | Aster, docs | ALP pool, section 9 |
| S14 | Shield Mode, Mark Price | https://docs.asterdex.com/trading/shield-mode/mark-price.md | 2026-10-12 | Aster, docs | no order book, section 9 |
| S15 | What is Aster? | https://docs.asterdex.com/overview/what-is-aster.md | 2026-10-12 | Aster, docs | encrypted orders, section 9 |
| S16 | CCXT 4.5.68 `aster.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/aster.js` | 2026-10-12 | CCXT | catalog mapping, section 2 |
| S17 | Aster docs index, which lists the pages "Login via Web3 Wallet" and "Login via Email Address" | https://docs.asterdex.com/llms.txt | 2026-10-12 | Aster, docs | login methods, section 9 |
| P1 | `rest-probe.py` modes `host`, `catalog`, `anchor`, `refs`, `funding`, `book`, `errors` and `time`, 22:18:35 to 22:19:13 UTC | [`rest-probe.py`](../../../scripts/probes/venues/aster/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 7 and 9 |
| P2 | `rest-probe.py cadence`, 60 polls from 22:19:42 UTC | [`rest-probe.py`](../../../scripts/probes/venues/aster/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3, 4 and 6 |
| P7 | `fees-probe.py ccxt`, 22:27:45 UTC | [`fees-probe.py`](../../../scripts/probes/venues/aster/fees-probe.py) | 2026-10-12 | this host, Canadian exit | CCXT counts, section 2 |
| R1 to R3 | the second pass, every mode rerun, `rest-probe.py` from 22:34 UTC, `fees-probe.py` at 22:39:53 UTC, and `rest-probe.py book` again at 22:41:45 UTC with `B-MONEYUSDT` added | [`rest-probe.py`](../../../scripts/probes/venues/aster/rest-probe.py) and [`fees-probe.py`](../../../scripts/probes/venues/aster/fees-probe.py) | 2026-10-12 | this host, Canadian exit | every probed number |
