# Lighter REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:18 to 22:48 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that ipinfo.io placed in Vancouver, British Columbia, Canada.

This profile covers the public REST API of Lighter (CCXT id `lighter`) that a catalog, an anchor and a book resync would use, and the decentralised layer behind it.
Every call is a `GET` under `https://mainnet.zklighter.elliot.ai/api/v1/`, and nothing here signs, names an account, or calls `sendTx`.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py), [`fees-probe.py`](../../../scripts/probes/venues/lighter/fees-probe.py) or [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py), run with `uv run` from the repository root, and the runs are listed in section 10.
An unauthenticated caller counts as a Standard account, which may send 60 requests a rolling minute per IP, S3, so the REST probe spaced its requests at least 2 s apart.
Fees and who may trade are in [`fees.md`](./fees.md), and the socket is in [`websocket.md`](./websocket.md).
Where the documentation and the wire disagree, both are written.

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-12 | edge |
|---|---|---|---|
| `mainnet.zklighter.elliot.ai` | REST under `/api/v1/`, the status call at `/`, the socket at `/stream`, S1 | four A records, `52.85.129.12`, `52.85.129.76`, `52.85.129.92` and `52.85.129.115`, and no CNAME, R1 and R8 | CloudFront: `via: 1.1 ….cloudfront.net (CloudFront)`, `x-amz-cf-pop: SEA900-P10`, R1 to R14 |

The edge is a CloudFront point of presence in Seattle.
S1 names AWS Tokyo, `ap-northeast-1`, as the place to run for the lowest latency, and the socket's envelope timestamps arrive about 50 ms after they were written, [`websocket.md`](./websocket.md) section 4, which fits an origin in Tokyo.
No REST market data call was geoblocked, while the trading socket refused this exit, see [`websocket.md`](./websocket.md) section 1.

| call | one request ms | repeated requests ms | reply bytes | edge cache |
|---|---|---|---:|---|
| `GET /`, the status call | 158.1 and 164.9, each the first of its process, with DNS and TLS, R1 and R8 | 125.6 to 132.2 over five more in R1, and 26.2 to 130.4 in R8 | 52 | `Hit from cloudfront` on 11 of 12 |
| `GET /info` | 129.1 and 130.2 | | 65 | Miss |
| `orderBookDetails?filter=perp` | 170.0 and 160.1 on a miss, R1 and R8 | 26.2 to 76.7 on four hits. Over 20 polls: 139 to 552 on a miss and 22.8 to 40.2 on a hit, R4, and 137.2 to 404.3 on a miss and 23.4 to 28.8 on a hit, R11 | 366,631 to 366,676 | cached about 5 s, section 3 |
| `orderBookDetails`, every type | 185.4 | | 377,130 and 377,137 | Hit, `age: 2`, R2 |
| `priceOracleInfo` | 177.8 | | 81,569 | Miss, R3 |
| `orderBookOrders`, 100 orders a side | 188.3 and 168.8 | | 45,283 and 45,440 | Miss and Hit, R5 and R13 |
| `funding-rates` | 147.3 | | 52,875 | Hit, R4 |

No reply was compressed.
`httpx` offers `gzip`, every reply came back without `content-encoding`, and the bytes on the wire equalled the body, R1 to R14.
No reply took over 0.6 s, so the reader's 5 s skew and 10 s age limits at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) lines 4 and 5 are not at risk from this host.
The bulk call is cached at the edge, see section 3.

## 2. Catalog

### The instruments call

`GET /api/v1/orderBookDetails` returns `{code, order_book_details, spot_order_book_details}`, S4.
It takes an optional `filter` of `all`, `spot` or `perp`, and an optional `market_id`, S4.
With `filter=perp` the spot array comes back empty, R2.

| item | value, R2 |
|---|---|
| perpetual rows | 239: 213 `active` and 26 `inactive`, and no other status |
| spot rows | 11: 10 `active` and `AZTEC/USDC` `inactive` |
| `market_type` | `perp` on all 239 perpetual rows |
| `market_id` | integers: 0 to 233 for the perpetuals listed first, then 4095 to 4099 for `STONK`, `OURA`, `PRL`, `VARIATIONAL` and `DRV`. Spot ids run from 2048 |
| `quote_asset_id` | 0 on all 239, the USDC collateral |
| `quote_multiplier` and `multiplier` | 1 and `"1.000000000000000000"` on all 239 |
| `size_decimals` | 0 to 6 |
| `market_config.hidden` | false on all 239 |
| `market_config.trading_hours` | empty on all 239, and S16 says RWA markets trade around the clock |
| `market_config.force_reduce_only` | true on 16 active rows: `BYD`, `BE`, `ARM`, `GME`, `AVGO`, `WDC`, `VARIATIONAL`, `KIOXIA`, `USDHKD`, `AAOI`, `SOXS`, `POPMART`, `KORU`, `NOK`, `AXTI` and `QCOM` |
| books of the `force_reduce_only` rows | 14 of the 16 had an empty or one-sided book over 137 s on the socket, W4, see [`websocket.md`](./websocket.md) section 4 |
| names priced per 1,000 tokens | `1000PEPE`, `1000SHIB`, `1000BONK`, `1000FLOKI` and `1000NOT` active, `1000TOSHI` inactive. `1000PEPE` read an index of 0.003984 and a minimum order of 1,500 units |
| `funding_premium_multiplier` | 100 on 117 active rows, 50 on 92 RWA rows, 1 on the 4 Pre-IPO rows, see [`fees.md`](./fees.md) section 3 |
| duplicate symbols | none |
| symbols that are not ASCII letters and digits | none among the perpetuals. Spot uses `BASE/USDC` |
| `mark_price` or `index_price` of zero | only `MKR`, which is inactive |

The perpetual fields are `symbol`, `market_id`, `market_type`, `base_asset_id`, `quote_asset_id`, `status`, `taker_fee`, `maker_fee`, `is_taker_fee_enabled`, `is_maker_fee_enabled`, `liquidation_fee`, `min_base_amount`, `min_quote_amount`, `order_quote_limit`, the size, price and quote decimals, `created_at`, `multiplier`, `quote_multiplier`, the four margin fractions, `mark_price`, `index_price`, `last_trade_price`, the daily volume and price fields, `open_interest`, `daily_chart`, `market_config`, `strategy_index`, `market_flags`, `funding_premium_multiplier`, `funding_clamp_small`, `funding_clamp_big` and `base_interest_rate`.
The wire also carries fields S4 does not list: `start_timestamp`, `end_timestamp`, `outcome`, `operator_account_index`, `settlement_cap`, `settlement_type`, `settlement_price`, `default_price` and `is_frozen`, which read 0 or false on all 239 rows except `operator_account_index`, which was 1 on 218 rows and 0 on 21 inactive ones, R2.
`orderBooks` is a smaller metadata call of 246 rows and 167,770 bytes without prices, R5, and S17 recommends `orderBookDetails` for discovery.

### How CCXT 4.5.68 maps it

| item | value | evidence in `lighter.js` |
|---|---|---|
| call | `publicGetOrderBookDetails` with no filter, after `assetDetails` for currencies | lines 1091 and 1261 to 1262 |
| `market.id` | `market_id` as a string, `"1"` for `BTC` | line 1178 |
| `type` | `perp` mapped to `swap` | line 1180 |
| `base` | the `symbol` field, cut at `/` for spot, `BTC` | lines 1181 to 1187 |
| `quote` and `settle` | the literal `USDC` | lines 1185 and 1186 |
| `linear` | true on every swap | line 1216 |
| `contractSize` | `quote_multiplier`, 1 on every row | lines 1198 and 1220 |
| `active` | `status === 'active'` | line 1214 |
| `taker` | `taker_fee` read as a fraction, see [`fees.md`](./fees.md) section 8 | line 1218 |

Probed through CCXT 4.5.68 in Python, F1 and F2:

| result | value |
|---|---|
| `load_markets` | 1.07 s and 1.17 s, two REST calls, CCXT pacing itself at a `rateLimit` of 1,000 ms, at `lighter.js` line 27 |
| markets | 250: 11 spot and 239 swap |
| active linear swaps quoted in USDT, USDC or USD | 213, all `USDC/USDC` |
| inactive swaps | 26 |
| `market.id` equal to `info.market_id` | 239 of 239 |
| `base` equal to `info.symbol` | 239 of 239 |
| `contractSize`, `linear`, `taker` | 1.0, true and 0.0 on 239 of 239 |
| pairs listed twice | none |

`market.id` is the integer the socket subscribes as `order_book/{id}` and spells back as `order_book:{id}`, and the key of every `market_stats` row, [`websocket.md`](./websocket.md) section 3.
So `rawMarketId` can be CCXT's `market.id` unchanged.
Book sizes are in coins of the base: the `BTC` socket book showed sizes such as `0.13224` at a price near 82,546, W2, and REST `orderBookOrders` the same unit in `remaining_base_amount`, R5.
So the contract size is 1, as CCXT reports.

### What the catalog needs

- Keep `status` `active` only.
  A subscribe to an inactive market, `order_book/28` for `MKR`, answered error 30005, W3.
- Leave out the 16 `force_reduce_only` markets, a rule CCXT does not have.
  A reduce-only market cannot open a position, which is what a route needs, and 14 of them held an empty or one-sided book, W4.
  The CCXT parity dump will then differ by those 16 rows, and the plan records why, as waves design decision 7 allows.
- `BB` on Lighter is an RWA row priced from a single Pyth Lazer feed at an index of 8.4350, R2 and R3, which fits BlackBerry stock, while other venues list the BounceBit token as `BB`.
  Checked on 2026-10-12, binance, bybit, gate and mexc listed `BB` at about 0.0091, 920 times below Lighter's, so the adapter denies market 211, B1.
  `WEN` is an RWA at an index of 6.3116, most likely Wendy's stock, priced internally at the time, R3.
  Corrected on 2026-10-12: binance, okx and gate list `WEN` within 2 percent of Lighter's price, so the reference venues read it as the same stock, and the adapter keeps it, B1.
  The 92 RWA rows use real-world tickers, such as `BOT` at 26.260, `NOW` at 140.24 and `GME` at 27.079 on a single Pyth Lazer feed, R3, and any of them may name a token on another venue.
  The live identity check of waves design decision 15 settles each, and a denial goes through `catalog::finish`.
- Two crypto rows name other tokens than the reference venues list, as the identity check found on 2026-10-12, B1.
  `PRL`, market 4097, is priced from a single Uniswap pool at 1.65, while binance, bybit, gate and mexc list a `PRL` at 0.11.
  `AI`, market 232, is priced from a Uniswap pool times USDG over USDT at 0.088, while okx lists an `AI` at 0.0196.
  The adapter denies both.
- `LIT` is Lighter's own token, at an index of 3.5128, R3, which several surveyed venues list as `LIGHTER`, see [`../bingx/rest.md`](../bingx/rest.md) line 89 and [`../pionex/rest.md`](../pionex/rest.md) line 72.
  Checked on 2026-10-12, binance, bybit, okx, gate and mexc all list it as `LIT` within 2 percent of Lighter's price, so the adapter keeps CCXT's base `LIT`, B1.
- The five `1000` names quote per 1,000 tokens, as other venues' `1000PEPE` contracts do, so they need no price scale when the other side also lists `1000PEPE`.
- The five ids above 4094 show that `market_id` is not dense, so a loader must not assume ids below 256.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| socket `market_stats/all` | `index_price` | `mark_price` | `current_funding_rate`, percent per hour, the estimate for the coming payment, S5 | absent, one hour by S6 | absent. `funding_timestamp` is the last settlement, in ms | a first frame of every market, about 147 KB, then one frame about every 1,000 ms with the markets that changed | see [`websocket.md`](./websocket.md) section 2 |
| `orderBookDetails?filter=perp` | `index_price` | `mark_price` | absent | absent | absent | 366,631 to 366,676 bytes, 239 rows | 22.8 to 552.2 ms, R4 and R11 |
| `funding-rates` | | | one `rate` per market and exchange, for `lighter`, `binance`, `bybit` and `hyperliquid` | absent | absent | 52,875 bytes, 735 rows | 147 ms, R4 |
| `fundings?market_id=&resolution=1h` | | | settled history, `rate` unsigned with a `direction` | hourly rows | the last row's `timestamp` is the last settlement, in seconds | 26 rows for 26 hours | R4 |

The REST bulk call is cached at the CloudFront edge.
Over 20 polls 2 s apart, the edge answered `Miss`, then `Hit` with `age: 2`, then `Hit` with `age: 4`, in a cycle of 6 s, and 13 of 19 consecutive replies were identical, R4.
Over 20 polls 3 s apart it alternated `Miss` and `Hit` with `age: 2`, and 10 of 19 consecutive replies were identical, R11.
So one copy is served for between 4 and 6 s.
`BTC`'s index and mark changed once per cache miss, on 6 of 19 transitions in R4 and 9 of 19 in R11.
A query parameter that changes on every request, `_`, was not part of the cache key: the first such poll was a `Hit` with `age: 4` in both runs, R4 and R11.
So a REST reading can be about 5 s old before it leaves the edge, and a Standard IP may poll at most once a second in total, S3.

The socket has no such cache.
On `market_stats/all` a row for `BTC` arrived in 54 of 60 one-second frames, and its index changed 39 times and its mark 51 times, W2.
The rerun saw 56 rows in 59 frames, with 42 index and 52 mark changes, W8.
The frame carries only the markets whose stats changed: 52 to 235 per frame, median 83 and 87, W2 and W8.
The first frame named 235 markets, the 213 active perpetuals and 22 inactive ones that never sent a second row, so rows outside the catalog must be skipped, W8 and W9.
A row comes only when the market's stats change.
Over 137 s the longest wait between two rows of one active market was p10 4.0 s, p50 13.0 s, p90 43.6 s and max 80.4 s, and 123 of 213 markets waited more than 10 s at least once, W9.
The per market channel `market_stats/{id}` waited exactly as long, up to 20.3 s on `1000SHIB`, W11, see [`websocket.md`](./websocket.md) section 2.
A row stamped on its own arrival therefore ages past the engine's 10 s limit on a quiet market, see section 8.

### Row mapping

| `AnchorRow` column | field on `market_stats/all` | unit on the wire | conversion |
|---|---|---|---|
| key | the object key, equal to `market_id` | string, `"1"` | as is, it equals CCXT's `market.id` |
| `index` | `index_price` | decimal string | parse |
| `mark` | `mark_price` | decimal string | parse |
| `funding_rate` | `current_funding_rate` | signed percent per hour: `"0.0006"` is 0.0006% | divide by 100 |
| `funding_interval_hours` | none | one hour on every deployed market, S6 | 1 |
| `next_funding_at` | none. `funding_timestamp` is the last settlement, `1791842400000` at 22:28 UTC, which is 22:00 | Unix ms | `funding_timestamp + 3_600_000`, or the next whole UTC hour after arrival |
| `ts` | none per market. The envelope `timestamp` is the API server's send time in ms, S7 | | the frame's arrival, as `SocketAnchors` stamps it |

`funding_rate` on the same row is the rate of the last settlement, S5.
At 22:28 UTC `BTC` read `funding_rate` `"0.0011"` and `funding_timestamp` 22:00 UTC, W2, and the `fundings` history held `rate` `"0.0011"` with `direction` `long` at 22:00 UTC, R4.

## 4. Anchor semantics

### Index

S8 says Lighter "uses a combination of oracles (Chainlink, Stork, Pyth) to determine the index price".
`priceOracleInfo` names the sources in use for every market at once, S9, and it answered for 221 markets, R3.

| index source on 2026-10-12 22:20 UTC | markets | examples |
|---|---:|---|
| median of `pythlazer / usdt`, `stork / usdt`, `chainlink / usdt`, `binance` and `okx` | 58 | `BTC`, `ETH`, `HYPE`, `1000PEPE` |
| `pythlazer` alone | 72 | `XAU`, `SPY`, `NVDA`, `BB`, `EURUSD` |
| other medians that include `binance`, `okx`, `mexc` or `hyperliquid` | 43 | `S` and `STRK` include `hyperliquid` |
| `pythlazer / usdt` alone | 6 | `ADI`, `ANSEM`, `CASHCAT`, `FOGO`, `PONS`, `STONK` |
| median of `chainlink / usdt`, `pythlazer / usdt` and `stork / usdt` | 6 | `LIT`, `CRO`, `MNT`, `MON`, `CC`, `VVV` |
| `redstone` alone | 5 | `US500`, `US100`, `WTI`, `NATGAS`, `XCU` |
| one exchange or one pool alone | 9 | `binance` for `CTR`, `DUSK` and `FOLKS`, `mexc` for `APEX`, `hyperliquid * usdc / usdt` for `DRV`, `uniswap` for `PRL`, `uniswap * eth` for `RAIL`, `uniswap * usdg / usdt` for `AI`, `ornn` for `H100` |
| `internal_price`, Lighter's own book | 19 | `ANTHROPIC`, `OPENAI`, `OURA`, `VARIATIONAL`, `BRENTOIL`, `SAMSUNGUSD`, `SKHYNIXUSD`, `HYUNDAIUSD`, `TENCENT`, `XIAOMI`, `SMIC`, `CXMT`, `MINIMAX`, `ZHIPU`, `SHEIN`, `UNITREE`, `STABLECOINX`, `US10Y` and `WEN` |
| median with an empty source list | 3 | `BYD`, `KIOXIA`, `POPMART` |

No source list names Lighter itself, R3.
`DRV`'s index is Hyperliquid's own price, so a `DRV` route between Lighter and Hyperliquid would compare a book with the price its index copies.

Internal pricing is an EMA of Lighter's own impact price, with τ of 30 minutes for the index and 2 minutes for the mark, S10.
RWA markets switch to it "when oracle data becomes stale", and back as soon as a feed returns, S10.
Pre-IPO markets are priced "only by the internal pricing mechanism", S11.
So 19 indexes were Lighter's own perpetual at 22:20 UTC, a Monday evening in New York when most of those RWA markets were closed.
Checked on 2026-10-12 at 23:20 UTC, 16 were, since `SAMSUNGUSD`, `SKHYNIXUSD` and `HYUNDAIUSD` had gone back to their oracles, B2.
The same reply held no row for the active `DATA` and `GRAM`, B2.
An internal index is capped within one over the leverage of the last oracle price, S10, and S10 lists 31 markets whose caps were removed on 2026-07-10.
`priceOracleInfo` carries `price_cap_bps`: 0 on 156 indexes, 1,000 on 44, and 200 to 4,000 on the rest, R3.
Its `computed_at_ms` was 5,299 ms old on arrival, R3.

### Mark

S8 defines the mark as the median of three prices.

- The impact price, the mean of the impact bid and ask for 500 USDC divided by the initial margin fraction.
- The index plus an 8 minute EMA of the impact price minus the index, clamped to ±0.5% of the index.
- The median of the mark prices of several centralised exchanges.

`priceOracleInfo` names the third set as `chainlink / usdt`, `binance` and `okx` for `BTC` and `ETH`, and `pythlazer` alone for most RWA rows, R3.
For RWA markets the third component is replaced by the RWA methodology, S10.
The ±0.5% clamp caps only one of three components, so the mark can still leave the band when the impact price and the exchange marks agree.
On 18 markets the mark equalled the index on all 20 REST polls of R4, and on 19 in R11, among them 15 of the 16 `force_reduce_only` rows in both runs.
The rest changed between the runs: `MSFT`, `HOOD` and `CBRS` in R4, and `CTR`, `IBM`, `STONK` and `US10Y` in R11.

### Funding

| item | value | source |
|---|---|---|
| premium | sampled once a minute at a random second, from the impact bid and ask against the index | S6 |
| rate | the hourly average premium times the multiplier, pulled toward the interest rate by a ±0.05% clamp, clamped at ±4%, divided by 8 | S6 |
| interval | one hour, on every deployed market | S6 and S12 |
| the published rate | `current_funding_rate` is "an estimation of the upcoming funding payment", and `funding_rate` "the last funding payment", S5 | S5 |
| history | `fundings` returns `timestamp` in seconds on the whole hour, an unsigned `rate` in percent and a `direction` of `long` or `short`, R4 | Probed |
| cross-venue table | `funding-rates` returned 213 `lighter`, 193 `binance`, 195 `bybit` and 134 `hyperliquid` rows, R4 | Probed |

On 208 of 208 markets compared at 22:42 UTC, the `lighter` `rate` of `funding-rates` equalled the socket's `current_funding_rate` divided by 100 and multiplied by 8, W8.
So that call publishes an 8 hour equivalent as a fraction: `BTC` read 5.6e-05 against 0.0007% an hour on the socket.
The socket's rates are signed: 28 of 235 `current_funding_rate` values were negative and 16 zero, from -0.2073% to 0.0758% an hour, W8.
The `fundings` history instead gives an unsigned `rate` and a `direction`, R4 and R11.
`funding_timestamp` read 22:00 UTC on 213 rows, and older instants on the rest, some of them one millisecond past the hour, such as `1781100000001`, W8.

### How often each number changed

| source | `BTC` index | `BTC` mark | all active markets | runs |
|---|---|---|---|---|
| REST, 20 polls 2 s apart | 6 of 19 transitions | 6 of 19 | median 4 index and 4 mark changes, 37 indexes and 27 marks never changed | R4 |
| REST, 20 polls 3 s apart | 9 of 19 transitions | 9 of 19 | median 5 index and 6 mark changes, 20 indexes and 20 marks never changed | R11 |
| socket, 60 one-second frames | 39 of 53 rows | 51 of 53 rows | 64 to 235 markets a frame | W2 |
| socket, 59 one-second frames | 42 of 55 rows | 52 of 55 rows | 52 to 235 markets a frame | W8 |

## 5. REST book snapshot

`GET /api/v1/orderBookOrders?market_id=1&limit=100`, S13.

| item | documented | probed |
|---|---|---|
| depth | `limit` required. CCXT caps it at 100, at `lighter.js` lines 1342 to 1345 | 100 and 250 were accepted, 1,000 and a missing `limit` answered 400 with code 20001, R5 and R6 |
| unit | orders, not levels | 100 `BTC` bids spanned 81 prices and 100 asks 92, R5. Each order carries `order_index`, `order_id`, `owner_account_index`, `initial_base_amount`, `remaining_base_amount`, `price`, `order_expiry` and `transaction_time` |
| order | | bids descending and asks ascending in every reply, R5 |
| sequence | none | no nonce or offset, so a REST read cannot be stitched to socket deltas |
| `transaction_time` | "currently not populated and returns 0", S7 | 0, R5 |
| caching | | the same URL answered `Hit` and then `Miss` two seconds apart, with different bodies, R5 |
| unknown market | | HTTP 200 with `total_asks` 0 and two empty arrays, R6 |

The socket sends the whole book on subscribe, [`websocket.md`](./websocket.md) section 4, so no REST seed is needed.

## 6. Rate limits and errors

| item | documented, S3 | probed |
|---|---|---|
| budget | Standard accounts: "60 requests per rolling minute", per IP and per L1 address. Plus and Premium: 24,000 weighted requests a minute. A weight of 300 for "Other endpoints" | not reached. The REST probe stayed under 30 requests in any minute |
| shared with the socket | "When you're rate-limited on REST, WebSocket connections also get rate-limited, and vice versa" | not reached |
| status at the limit | "HTTP 429, or HTTP 405" | not reached |
| cooldown | 60 s at the firewall, or the endpoint weight over the per-second budget at the API servers | not reached |
| `Retry-After` | Not publicly specified | absent on every reply, R1 to R14 |
| limit headers | Not publicly specified | none on any reply |
| WebSocket | 255 connections, 500 subscriptions a connection, 5,000 an IP, 255 new connections a minute, 200 client messages a minute and 50 in flight | see [`websocket.md`](./websocket.md) section 5 |

| request | status | `x-cache` | body |
|---|---:|---|---|
| `orderBookDetails?market_id=9999` | 400 | `Error from cloudfront` | `{"code":21602,"message":"invalid market index"}` |
| `orderBookDetails?market_id=abc` | 400 | `Error from cloudfront` | `{"code":20001,"message":"invalid param "}` |
| `orderBookOrders?market_id=9999&limit=10` | 200 | Miss | `{"code":200,"total_asks":0,"asks":[],"total_bids":0,"bids":[]}` |
| `orderBookOrders?market_id=1` with no `limit` | 400 | `Error from cloudfront` | `{"code":20001,"message":"invalid param "}` |
| `orderBookOrders?market_id=1&limit=1000` | 400 | `Error from cloudfront` | `{"code":20001,"message":"invalid param "}` |
| `priceOracleInfo?symbol=NOPE` | 400 | `Error from cloudfront` | `{"code":20001,"message":"invalid param : unknown market: NOPE"}` |
| `GET /api/v1/nope` | 403 | `FunctionGeneratedResponse from cloudfront` | empty |
| `POST /api/v1/orderBookDetails` | 404 | `Error from cloudfront` | empty |

These came from R6, and the rerun R12 repeated them.
One more 403 with an empty body answered the first request of the first errors run, `orderBookDetails?market_id=9999` at 22:22:27 UTC, R6, while the same URL answered 400 with code 21602 at 22:25:02 and 22:41:00, R6 and R12.
The probe had sent about 8 requests in the minute before it, so it was not the documented budget, and its headers were not kept.
A poller should treat a 403 with an empty body as a refusal and log it whole, since an unknown path and that one request both produced it.
The poller pauses on 403, 418 and 429 at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 21, so a 405 at the limit, which S3 also names, would not pause it.

## 7. Server time and clock offset

`GET /` returns `{"status":200,"network_id":1,"timestamp":1791843532}`, with `timestamp` in whole seconds, R1.
CCXT reads it with `safeTimestamp`, at `lighter.js` line 1080.
On 5 of 5 calls in R14 the `timestamp` equalled the whole second of the local clock at the request, with round trips of 31.6 to 203.7 ms.
A one second resolution cannot measure an offset below a second, so the socket is the better clock.
The socket's envelope `timestamp`, the API server's send time in ms, S7, arrived 49.1 to 51.2 ms later from p0 to p90 on 2,713 book frames, W2, and 48.9 to 52.0 ms on 3,021, W8.
The local clock was synchronised by `systemd-timesyncd` with an offset of +1.7 ms at 22:17 UTC.
So the API server's clock and the one way trip together come to about 50 ms, and the two cannot be separated.
The sequencer's own time, `last_updated_at` in µs, was 51.7 ms old at the least and 72.2 ms at the median on arrival, W2.

## 8. Recommended poller shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| source | `SocketAnchors` at [`socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs), fed by `market_stats/all` subscribed on the book socket, as waves design decision 13 describes | the REST reply is cached at the edge for about 5 s, and a Standard IP may make 60 requests a minute, section 3 |
| publishes mark | `SocketAnchors::new(true)` | every row carries `mark_price` |
| row mapping | section 3: `index_price`, `mark_price`, `current_funding_rate` divided by 100, interval 1, next funding `funding_timestamp` plus one hour | `funding_timestamp` is the last settlement |
| key | the object key of `market_stats`, which equals `market_id` and CCXT's `market.id` | section 2 |
| skip | rows of markets outside the catalog, among them inactive and spot ids, and the four Pre-IPO markets `ANTHROPIC`, `OPENAI`, `OURA` and `VARIATIONAL` | Pre-IPO indexes are Lighter's own book by design, S11, which waves design decision 4 leaves out of the anchor rows |
| internal price | optional: read `priceOracleInfo` once a minute and leave out any market whose index `source` is `internal_price` | 19 indexes were Lighter's own book on a Monday evening, section 4, and a REST call a minute is 2% of the budget |
| quiet markets | keep the honest stamp: a market with no new row keeps the arrival of its last row, so its routes are refused once that row is 10 s old | 123 of 213 markets waited more than 10 s for a row at least once in 137 s, section 3. Re-stamping the last values on every frame would assert a freshness no frame shows, since rows also skip changes of the best bid and ask, W11 |
| REST refresher | optional: `orderBookDetails?filter=perp` every 3 s, setting each market's index and mark with `ts` from the reply's `date` header, which kept the origin's time on cached copies, R4 | a cached copy is up to about 5 s old, so a REST reading is up to about 9 s old just before the next poll and often fails the 5 s skew against a fresh leg. 20 requests a minute is a third of the Standard budget |
| rate limit pause | keep the runtime's default, and log any 403 or 405 whole | section 6 |

## 9. Decentralised layer

### Chain, sequencer and clocks

Lighter Core is an exchange-specific zero knowledge rollup anchored on Ethereum, S14.
A sequencer orders transactions first in, first out, gives soft finality, and feeds the API servers, while a prover batches execution proofs that Ethereum verifies before the state root moves, S14.
The Ethereum contract is `0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7`, S1, and `GET /info` returned the same address, R1.
A priority queue on Ethereum lets users force withdrawals and reduce-only orders, and the contract freezes into an escape hatch if the sequencer ignores them, S14.

| clock | where it shows | unit | probed |
|---|---|---|---|
| block time | `Trade.timestamp` and `Tx.executed_at` | ms | not used by the feed |
| execution time | `transaction_time`, and `last_updated_at` on book and ticker frames as the newest execution in the 50 ms batch | µs | 51.7 ms old at least on arrival, W2 |
| API server send time | the envelope `timestamp` on `order_book`, `ticker`, `market_stats` and `height` | ms | about 50 ms old on arrival, W2 |
| block height | the `height` channel | integer | pushed every 500 ms, rising by 1 to 15 blocks and by 2 at the median in W2, and by 1 to 17 and 3 at the median in W8 |
| matching engine order | `nonce` on book and ticker frames | integer | continuous by the `begin_nonce` rule, [`websocket.md`](./websocket.md) section 4 |
| oracle computation | `computed_at_ms` on `priceOracleInfo` | ms | 5,299 ms old on arrival, R3 |

S7 sets these apart and warns that subtracting timestamps from different services includes an unknown clock offset.
A `market_stats` row carries no oracle time of its own, so an anchor reading is stamped on arrival.
Lighter posts each state update to Ethereum as compressed data blobs with its proof, S14, so the book can be rebuilt from Ethereum only after the fact.
No public node streams the book, so the API servers behind CloudFront are the only live source, unlike Hyperliquid, whose non-validator node could replace its API, see [`2026-09-23-hyperliquid-research-plan.md`](../../plans/2026-09-23-hyperliquid-research-plan.md).
The explorer API at `explorer.elliot.ai` serves blocks and batches at 90 weighted requests a minute, S3, and was not probed.

### Who may use it and from where

The operator, Elliot Technologies, Inc., bars residents of the United States, Canada, the United Kingdom and eleven other countries, see [`fees.md`](./fees.md) section 1.
The trading socket enforces it by IP: from this Canadian exit it answered HTTP 400 with code 20558, "You are accessing Lighter from a restricted jurisdiction", W1.
S1 and S2 document `?readonly=true` as the socket for restricted regions to read market data, and it opened from the same exit, W1.
REST market data answered from the same exit, apart from the one unexplained 403 of section 6, R1 to R14.
Reading is therefore open from here, and trading is not.

### Oracles

The index and the mark are medians of oracle networks and exchange prices, chosen per market, section 4.
The networks named on the wire are Pyth Lazer, Stork, Chainlink and RedStone, and the exchange and pool sources are Binance, OKX, MEXC, Hyperliquid, Uniswap and ORNN, R3.
19 markets ran on Lighter's internal price at 22:20 UTC, R3.

### Who lists markets

S12 says "Lighter Governance will continuously add new markets", and no permissionless listing for perpetuals is documented.
`operator_account_index` read 1 on every active row, R2, and S4 does not document the field.
Lighter names RWA markets by their stock tickers, so `BB`, `WEN`, `BOT`, `NOW` and `GME` can name another asset than the token other venues list under the same ticker, section 2.
On 2026-10-12 `BB`, `PRL` and `AI` did, while `WEN` matched the reference venues, section 2.

### Routes to and from other venues

- Lighter on Robinhood Chain is a separate exchange with its own books, accounts and fees at `api.rh.lighter.xyz`, S2, and CCXT's class reads only mainnet, at `lighter.js` line 148.
- `DRV`'s index is Hyperliquid's price, and 13 more indexes include Hyperliquid in their median, R3.
- `funding-rates` republishes Binance, Bybit and Hyperliquid funding rates beside Lighter's, R4.
- No surveyed venue was found to route its book to Lighter.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Lighter API Docs, Environments and endpoints | https://apidocs.lighter.xyz/docs/environments | 2026-10-12 | Lighter, API docs | hosts, contract, read-only socket, Tokyo colocation, sections 1 and 9 |
| S2 | Lighter API Docs, Lighter on Robinhood Chain | https://apidocs.lighter.xyz/docs/lighter-rh | 2026-10-12 | Lighter, API docs | the separate exchange, the read-only socket, section 9 |
| S3 | Lighter API Docs, Rate Limits | https://apidocs.lighter.xyz/docs/rate-limits | 2026-10-12, page updated 2026-10-08 | Lighter, API docs | budgets, weights, status codes, cooldown, sections 3 and 6 |
| S4 | Lighter API Docs, orderBookDetails reference | https://apidocs.lighter.xyz/reference/orderbookdetails | 2026-10-12 | Lighter, API docs | catalog call and fields, section 2 |
| S5 | Lighter API Docs, WebSocket reference | https://apidocs.lighter.xyz/docs/websocket-reference | 2026-10-12, page updated 2026-10-07 | Lighter, API docs | `market_stats` fields and the meaning of each funding field, sections 3 and 4 |
| S6 | Lighter Docs, Funding | https://docs.lighter.xyz/trading/funding | 2026-10-12 | Lighter, docs | funding formula and interval, sections 3 and 4 |
| S7 | Lighter API Docs, Timestamps | https://apidocs.lighter.xyz/docs/timestamps | 2026-10-12 | Lighter, API docs | clocks and units, `transaction_time` 0, sections 3, 5, 7 and 9 |
| S8 | Lighter Docs, Fair Price Marking | https://docs.lighter.xyz/trading/fair-price-marking | 2026-10-12 | Lighter, docs | mark formula, oracle names, section 4 |
| S9 | Lighter API Docs, priceOracleInfo reference | https://apidocs.lighter.xyz/reference/priceoracleinfo | 2026-10-12 | Lighter, API docs | oracle source call, section 4 |
| S10 | Lighter Docs, RWA Pricing Mechanism | https://docs.lighter.xyz/trading/real-world-assets-rwas/rwa-pricing-mechanism | 2026-10-12 | Lighter, docs | internal pricing, caps, the 2026-07-10 cap removal, section 4 |
| S11 | Lighter Docs, Pre-IPO Markets | https://docs.lighter.xyz/trading/real-world-assets-rwas/pre-ipo-markets | 2026-10-12 | Lighter, docs | Pre-IPO pricing, sections 4 and 8 |
| S12 | Lighter Docs, Contract Specifications | https://docs.lighter.xyz/trading/contract-specifications | 2026-10-12 | Lighter, docs | one hour funding period, listing by governance, sections 4 and 9 |
| S13 | Lighter API Docs, orderBookOrders reference | https://apidocs.lighter.xyz/reference/orderbookorders | 2026-10-12 | Lighter, API docs | REST book call, section 5 |
| S14 | Lighter Docs, Technical Architecture: Lighter Core | https://docs.lighter.xyz/about-lighter/technical-architecture-lighter-core | 2026-10-12 | Lighter, docs | rollup, sequencer, prover, escape hatch, section 9 |
| S15 | CCXT 4.5.68 `lighter.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/lighter.js` | 2026-10-12 | CCXT | catalog mapping, pacing, time call, sections 2, 5 and 7 |
| S16 | Lighter Docs, Real World Assets (RWAs) | https://docs.lighter.xyz/trading/real-world-assets-rwas | 2026-10-12 | Lighter, docs | RWA markets trade 24/7, section 2 |
| S17 | Lighter API Docs, Market data | https://apidocs.lighter.xyz/docs/market-data | 2026-10-12 | Lighter, API docs | `orderBookDetails` for discovery, section 2 |
| R1 | `rest-probe.py host p1` at 22:18 UTC | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 7 and 9 |
| R2 | `rest-probe.py catalog p1` at 22:19 UTC | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | section 2 |
| R3 | `rest-probe.py oracle p1` at 22:20 UTC | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2, 4 and 9 |
| R4 | `rest-probe.py anchor p1` at 22:20 UTC, 20 polls 2 s apart, then `funding-rates` and `fundings` | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 and 4 |
| R5 | `rest-probe.py book p1` at 22:22 UTC | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 and 5 |
| R6 | `rest-probe.py errors p1` at 22:22 UTC, stopped by a 403, and `errors p1b` at 22:25 UTC | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 5 and 6 |
| R7 | `rest-probe.py time p1` at 22:22 UTC | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | section 7 |
| R8 to R14 | the second pass, `rest-probe.py host`, `catalog`, `oracle`, `anchor` with 20 polls 3 s apart, `book`, `errors` and `time`, all with label `p2`, from 22:39 to 22:41 UTC | [`rest-probe.py`](../../../scripts/probes/venues/lighter/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 7, as R8 host, R9 catalog, R10 oracle, R11 anchor, R12 errors, R13 book and R14 time |
| F2 | `fees-probe.py p2` at 22:41 UTC | [`fees-probe.py`](../../../scripts/probes/venues/lighter/fees-probe.py) | 2026-10-12 | this host, Canadian exit | section 2 |
| F1 | `fees-probe.py p1` at 22:24 UTC | [`fees-probe.py`](../../../scripts/probes/venues/lighter/fees-probe.py) | 2026-10-12 | this host, Canadian exit | section 2 |
| W1 | `ws-probe.py deflate p1` at 22:27 UTC | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 9 |
| W2 | `ws-probe.py book p1` at 22:27 UTC | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2, 3, 4, 7 and 9 |
| W3 | `ws-probe.py errors p1` at 22:29 UTC | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 2 |
| W4 | `ws-probe.py batch p1` at 22:30 UTC, 213 books on one socket | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | section 2 |
| W8 | `ws-probe.py book p2` at 22:42 UTC, with one REST `funding-rates` call | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 and 4 |
| W9 | `ws-probe.py batch p2` at 22:43 UTC, with the wait between `market_stats` rows per market | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 2 and 3 |
| W11 | `ws-probe.py quiet p2` at 22:47 UTC | [`ws-probe.py`](../../../scripts/probes/venues/lighter/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 3 and 8 |
| B1 | the Rust adapter's `live_identity` with `LIVE_VENUES=lighter` from 23:10 to 23:26 UTC, against one anchor round of binance, bybit, okx, gate and mexc, and their `live_catalog` | [`live_tests.rs`](../../../server/src/venues/live_tests.rs) | 2026-10-12 | this host, Canadian exit | sections 2 and 9 |
| B2 | one `GET /api/v1/priceOracleInfo` for every market by the builder at 23:20 UTC | https://mainnet.zklighter.elliot.ai/api/v1/priceOracleInfo | 2026-10-12 | this host, Canadian exit | section 4 |
