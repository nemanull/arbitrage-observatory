# Paradex REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:17 to 22:34 UTC for the first runs and from 22:38 to 22:45 UTC for the second pass, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public REST API of Paradex (CCXT id `paradex`) that a catalog, an anchor poller and a book check would use, and the decentralised layer behind it in section 9.
Every call is an unauthenticated `GET` on `https://api.prod.paradex.trade/v1`, and nothing here signs, authenticates or trades.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/paradex/rest-probe.py) or [`fees-probe.py`](../../../scripts/probes/venues/paradex/fees-probe.py), run with `uv run` from the repository root.
P1 is the first run of each mode and P2 the second pass, as section 10 lists.
The probe stayed near 6 requests a second at its busiest, under the documented 1,500 a minute per IP.
Where the documentation and the wire disagree, both are written.
Fees and who may trade are in [`fees.md`](./fees.md), and the socket, its binary encoding and the recommended feed are in [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-12 | edge |
|---|---|---|---|
| `api.prod.paradex.trade` | REST API | `35.71.137.239` and `52.223.12.40`, no CNAME, P1 and P2 | AWS Global Accelerator in front of AWS `ap-northeast-1`, Tokyo, S9 and S19. No `server` or `via` header came back |
| `ws.api.prod.paradex.trade` | WebSocket API | `13.248.249.50` and `3.33.130.209`, P1 and P2 | the same, S9 and S19 |

| call | first request of a process, ms | repeated requests, ms | reply bytes | evidence |
|---|---:|---|---:|---|
| `GET /system/time` | 393 and 411, with DNS and TLS | ten each run: min 97.0 and 101.6, p50 100.1 and 104.7, max 124.2 and 126.5 | 32 | P1 and P2 mode `host` |
| `GET /markets`, identity | 1,126 and 1,172 | | 14,331,930 | P1 and P2 mode `catalog` |
| `GET /markets`, gzip | 184 and 182 | | 366,484 on the wire | P1 and P2 mode `catalog` |
| `GET /markets/summary?market=ALL`, identity | 984 and 1,190 | | 6,322,921 and 6,324,394 | P1 and P2 mode `anchor` |
| `GET /markets/summary?market=ALL`, gzip | | twelve each run: 232 to 392 ms | 1,152,279 to 1,159,279 on the wire | P1 and P2 mode `anchor` |
| `GET /markets/summary?market=<one>` | | 120 each run: p50 97.6 and 100.1, max 360.5 and 353.9 | one row | P1 and P2 mode `anchor` |
| `GET /orderbook/<market>` | 407 and 388 | 96 to 132 | 968 to 973 at depth 20 | P1 and P2 mode `book` |

Every public call answered 200 or a documented 4xx, and none was a refusal or a geoblock.
The REST API sends gzip when asked, and httpx asked by default.

## 2. Catalog

### The instruments call

`GET /v1/markets` returns every market in one reply, about 14.3 MB, or 0.37 MB with gzip, P1 and P2.
`GET /v1/markets?market=BTC-USD-PERP` returns one row of 1,034 bytes, P1.

| `asset_kind`, quote, settlement, `trading_mode`, `market_kind` | count, P1 and P2 |
|---|---:|
| `OPTION`, `USD`, `USDC`, `STANDARD`, `cross` | 9,440 |
| `PERP`, `USD`, `USDC`, `STANDARD`, `cross` | 66 |
| `SPOT`, `USD`, `USDC`, `STANDARD`, `cross`: `DIME-USD` and `ETH-USD` | 2 |

The response has no status or active field: `enableTrading` was absent from 9,508 of 9,508 rows, and the documented fields are `open_at`, `expiry_at` and `trading_mode`, S1.
No perpetual had an `open_at` in the future, every perpetual had `expiry_at` 0, and every one was `STANDARD`, which accepts on-book orders, while `RFQ_ONLY` would refuse them, S1.
Every perpetual symbol is `<base>-USD-PERP`, 66 of 66, and no base is listed twice.
Two bases start with a lowercase `k`, `kPEPE` and `kSHIB`.
23 perpetuals carry the tag `RWA`: BZ, CL, CRCL, DRAM, EWY, GOOGL, INTC, META, MRVL, MSFT, MSTR, MU, NG, NVDA, SNDK, SPCX, TSLA, US100, US500, XAG, XAU, XCU and XPT, P1.
`max_order_size` and `position_limit` are "in base currency", S1, and the books on the socket are in base coins too, see [`websocket.md`](./websocket.md) section 4.

### How CCXT 4.5.68 maps it

| item | value | evidence in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/paradex.js` |
|---|---|---|
| call | one `publicGetMarkets` | `fetchMarkets` at lines 490 to 527 |
| type | `option` for `OPTION` and `PERP_OPTION`, `swap` for every other kind, spot included | lines 605 to 609 |
| `market.id` | `symbol`, `BTC-USD-PERP`, which the socket and the summary spell the same way | line 635, and 67 of 67 kept ids equalled `info.symbol` in P1 and P2 |
| `base` | `safeCurrencyCode(base_currency)`, so `kPEPE` becomes `KPEPE` and `kSHIB` becomes `KSHIB` | line 615, P1 mode `ccxt` |
| `quote`, `settle` | `USD`, `USDC` | lines 612 to 618, P1 mode `ccxt` |
| `linear` | the literal `true` | line 651 |
| `contractSize` | the literal `1` | line 655 |
| `active` | `safeBool(market, 'enableTrading')`, which is `undefined` on every row because the field does not exist | line 649, P1 mode `ccxt` |
| `taker` | the literal `0.0003` | line 622, see [`fees.md`](./fees.md) section 8 |
| markets loaded | 9,507 of the 9,508 rows, because `ETH-USD` spot and `ETH-USD-PERP` both become `ETH/USD:USDC` and the perpetual keeps the symbol | P1 and P2 mode `ccxt` |
| pacing | `rateLimit` 50 ms, so 20 calls a second, and `loadMarkets` took 1.3 and 1.5 s | line 29, P1 and P2 mode `ccxt` |

Probed through the swap filter the main session used, type `swap`, `swap` true, `linear` true, `active` not false, and quote in USD, USDC or USDT:

| result | P1 and P2 alike |
|---|---|
| kept | 67: the 66 perpetuals and the spot market `DIME-USD` |
| `quote`, `settle`, `contractSize`, `taker`, `maker` | `USD`, `USDC`, 1, 0.0003 and -0.00005 on 67 of 67 |
| `active` | `None` on 67 of 67 |
| pairs listed twice | 0 |

### What the catalog needs changed

- Keep only `asset_kind` `PERP`.
  CCXT's rule turns the spot market `DIME-USD` into a swap, so a parity dump holds 67 markets where the venue lists 66 perpetuals.
- `rawMarketId` is CCXT's `market.id` unchanged, because the socket channels, the binary frames' `market` string and the summary rows all spell `BTC-USD-PERP` and `kPEPE-USD-PERP` exactly so.
- `kPEPE` and `kSHIB` are priced per 1,000 tokens.
  `kPEPE-USD-PERP` marked 0.00399674 while binance and bybit marked `1000PEPEUSDT` at 0.9993 and 0.9999 of that, and `kSHIB-USD-PERP` marked 0.00522223 against binance `1000SHIBUSDT` at 0.9987, P1 mode `identity`.
  The Hyperliquid loader already moves such a base to the token with a price scale of 0.001, at [`markets.rs`](../../../server/src/venues/hyperliquid/markets.rs) lines 14 to 17 and 48 to 61, and the same rule fits here.
  CCXT's `KPEPE` and `KSHIB` would cluster with nothing.
- No ticker names another token on the reference venues.
  62 of 66 perpetuals had a binance or bybit mark for the same base, and every one of 121 mark ratios lay between 0.9954 and 1.001, with a median of 0.9989, P1 and P2 mode `identity`.
  NG, US100, US500 and XCU had no reference there.
- The `RWA` perpetuals are kept under decision 4 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md), and section 4 records the closing-hours index that partly follows their own mark.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /v1/markets/summary?market=ALL` | `underlying_price` | `mark_price` | `funding_rate`, per 8 h | absent | none, funding is continuous | 9,509 rows, 66 of them perpetuals. 6.3 MB, or 1.15 MB with gzip | 232 to 392 ms with gzip, P1 and P2 |
| `GET /v1/markets/summary?market=<symbol>` | same fields | | | | | one row | p50 about 100 ms |
| `GET /v1/markets` | | | | `funding_period_hours`, 8 on 66 of 66 | | 14.3 MB | see section 2 |
| `GET /v1/funding/data?market=<symbol>` | | | `funding_rate` and `funding_rate_8h` | `funding_period_hours` | | 100 rows a page, one row every 5 s | about 100 to 430 ms |
| socket `markets_summary.<symbol>` | `indexPrice` | `markPrice` | `fundingRatePrecise`, else `fundingRate` | | | one 263-byte binary frame a second per market | arrives 405 to 1,125 ms after its `ts`, see [`websocket.md`](./websocket.md) section 2 |

Every perpetual summary row carried `mark_price`, `underlying_price`, `funding_rate`, `external_fair_price`, `bid`, `ask`, `created_at` and the other fields of S2, and no row had a zero or empty mark or index, P1 and P2.
The bulk call has no perpetuals-only filter: `market` takes one symbol or `ALL`, and a comma list is refused as a market that "does not exist", P1 and P2 mode `errors`.

### The REST summary is a 5 s snapshot

| measure | P1 | P2 |
|---|---|---|
| `created_at` steps between consecutive values | 5,000 ms on every step but one | the same |
| a step backwards | `-5000` once on BTC in 40 per-market polls | the same |
| age of `created_at` at arrival, `market=ALL`, 12 polls | 3,423 to 6,082 ms | 2,469 to 7,603 ms |
| age of `created_at` at arrival, one market, 120 polls | 1,000 to 7,795 ms, p50 3,990 | 1,438 to 7,537 ms, p50 4,439 |
| `cache-control` | `private, max-age=5` | the same |

So a REST reading is up to about 8 s old when it lands, and two reads in a row can come from different snapshots, one of them older.
The socket's `markets_summary` carries the same fields on a 1 s grid, with `ts` at the same 156 ms past the second as REST's `created_at`, and lands 0.4 to 1.1 s after its `ts`, see [`websocket.md`](./websocket.md) section 2.

### Row mapping

| `AnchorRow` column | socket field, recommended | REST field, fallback | unit and conversion |
|---|---|---|---|
| key | the frame's trailing `market` string | `symbol` | `BTC-USD-PERP` |
| `index` | `indexPrice`, block offset 24 | `underlying_price` | mantissa × 10^-8, or a decimal string |
| `mark` | `markPrice`, block offset 16 | `mark_price` | the same. Never 0 on a live perpetual in P1 or P2 |
| `funding_rate` | `fundingRatePrecise` at offset 232, mantissa × 10^-12, else `fundingRate` at offset 56 | `funding_rate` | a fraction per 8 h: `"0.00005949350098"` on BTC in P2 is 0.0059 % |
| `funding_interval_hours` | 8 from the catalog's `funding_period_hours` | the same | 8 on 66 of 66, and `fundingPeriodHours` 8 on every funding frame |
| `next_funding_at` | 0, unknown | 0 | funding accrues every second and has no settlement instant, see [`fees.md`](./fees.md) section 6 |
| `ts` | the frame's arrival, as decision 13 of the waves design sets for socket rows | the venue's `created_at` rather than the round's arrival, if REST is used | REST's `created_at` is 1 to 8 s old on arrival, so an arrival stamp would overstate its freshness |

The funding rate is the published, smoothed rate for the instrument's own period, which S2 calls "not a normalized 8h funding rate", and that period is 8 h on every perpetual today.

## 4. Anchor semantics

### Index, the spot oracle

For a crypto perpetual the index is the "Spot Oracle Price", "an external oracle price of the underlying coin obtained via the Pyth & Stork Networks", S3.
Each market names a Pyth price account in `price_feed_id`, S1, and `GET /v1/system/config` names an on-chain `oracle_address`, P1.
For TradFi perpetuals the index is a weighted median of sources, S4.

| source | score in open hours | score in closing hours | note |
|---|---:|---:|---|
| Pyth, stocks and FX | 3 | | open hours only |
| Pyth, commodities and equity indices | 1 | 1 | 24/7 |
| Stork | 2 | | open hours only |
| Binance | 1 | | the index price of its TradFi perpetual, open hours only |
| Bybit, Hyperliquid, OKX | 1 each | 1 each | the index price of their TradFi perpetuals |
| Lighter | 0.7 | 0.7 | the same |
| Closing Price, the oracle at the close | | 0.5 | |
| Internal Price, an EMA of Paradex's own mark with a 1-hour half-life | | 0.5 | |

US500 and US100 use only Pyth, Hyperliquid's `xyz:SP500` and `xyz:XYZ100` index prices and Lighter's, plus the two closing sources, S4.
In closing hours the Internal Price weighs 10.64 % of a commodity or stock index and 13.51 % of US500 and US100, S4, so that part of the index follows the venue's own perpetual.
This is the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md), in a diluted form that switches on outside market hours.
Commodities trade 23/5 from Sunday 18:00 to Friday 17:00 ET with a daily break at 17:00, and single stocks 24/5 from Sunday 20:00 to Friday 20:00 ET, S4.
The CL, NG and BZ indices track the active front future and roll between the 5th and 10th business day of the month, S4.
The per-asset basket for a crypto index is Not publicly specified beyond "Pyth & Stork".

### Mark

`Mark Price = Spot Oracle Price × (1 + Fair Basis)`, S3.
The fair basis blends `ExternalMedian`, the median basis of the Binance, Bybit, OKX, Hyperliquid and Lighter marks against spot, with a `LiquidBasis` built from Paradex's own EWMA-smoothed bid, ask, trade and mid, using a liquidity weight `w` that moves between 0 and 1 over 30 minutes of tight or wide books, S3.
S3 says that sustained thinness drives `w` to 0, and that the fair basis then follows the external consensus.
So on a thin market the mark is the oracle times other venues' basis, and a cross against Paradex's own book is not visible in its mark.
Price bands cap aggressive orders around the mark, from 5 % to 20 % by market, `price_bands_width` 0.05 on 3, 0.1 on 13, 0.15 on 8 and 0.2 on 42, S5 and P2 mode `catalog`.
No clamp on the mark itself is published.
Mark over index ranged from -3,027 ppm on BZ to +5,718 ppm on NG in P1, and from -2,087 to +5,407 ppm on the same two in P2, mode `anchor`.

### Funding

The formula, the 8 h period, the caps and the continuous accrual are in [`fees.md`](./fees.md) section 6, from S6.
The published rate is the current smoothed rate, recomputed every second, S6, and the summary carries the value of its own snapshot.
`GET /v1/funding/data` keeps one row every 5 s, with `funding_rate_8h` equal to `funding_rate` on 100 of 100 rows because the period is 8 h, P1 and P2 mode `funding`.

### How often each number changed

| source | mark | index | funding | evidence |
|---|---|---|---|---|
| REST `market=ALL`, 11 transitions 2.5 s apart | 6 in P1 and 5 in P2 on each of six markets | the same, except 5 on XAU in P1 | the same as the mark | P1 and P2 mode `anchor` |
| REST one market, 39 transitions 1 s apart | 8 to 10 in P1 and 7 to 9 in P2 | the same, except 7 on kPEPE in P1 | the same as the mark | P1 and P2 mode `anchor` |
| socket `markets_summary`, 49 transitions | 30 to 49 changes, 49 of 49 on BTC, ETH and XAU in P4 of [`websocket.md`](./websocket.md) | 30 to 45 | | P4 and P7 of [`websocket.md`](./websocket.md) |

Every REST change landed on a new `created_at`, so the REST numbers move only when the 5 s snapshot moves.
The longest run of unchanged REST index readings was 5 to 10 one-second polls, P1 and P2.

## 5. REST book snapshot

`GET /v1/orderbook/{market}?depth=<n>`, S7.

| item | documented, S7 | probed, P1 and P2 |
|---|---|---|
| depth | default 20 | 15, 20 and 50 returned that many levels on BTC. 100 returned 84 and 59, then 79 and 63, fewer than asked, so the whole API book of that moment. 200 and 1,000 were refused with 400 `"Depth: must be no greater than 100."` |
| order | | bids descending and asks ascending on every read |
| level | `[price, size]` strings | as documented |
| sequence | `seq_no` | the socket's `seq`, see [`websocket.md`](./websocket.md) section 4 |
| timestamp | `last_updated_at` in ms, the last change | 79 to 2,581 ms before arrival, growing while the book was quiet |
| caching | | `cache-control: public, max-age=1, stale-while-revalidate=2`. Ten reads 0.25 s apart saw 8 distinct `seq_no` values in P1, and one value for seven reads in a row while the book was quiet in P2 |
| RPI | the API book leaves RPI out, S8 | `/orderbook/{market}/interactive` adds RPI levels: at depth 20 it returned 35 and 29, then 34 and 33 levels on BTC, against 20 and 20 on the API book |
| aggregation | `price_tick` | `price_tick=10` returned 20 levels on a 10 USD grid |

### The API book against the interactive book

Mode `books` read both books of every perpetual at depth 20, at 22:22 UTC in P1 and 22:40 UTC in P2.

| measure | P1 | P2 |
|---|---:|---:|
| API books with a spread up to 1,000 ppm | 2, BTC and ETH | 1, BTC |
| API books with a spread up to 10,000 ppm | 2 | 5 |
| API books wider than 100,000 ppm | 56 | 55 |
| API books with a single level on at least one side | 27 | 26 |
| interactive books with a spread up to 1,000 ppm | 48 | 44 |
| interactive books with a spread up to 10,000 ppm | 64 | 63 |
| books whose API touch equalled the interactive touch | 0 | 1 |
| crossed books | 0 | 0 |

On XAU and NVDA the API book held one far order a side, and on US500 one bid and two or three asks, such as `2097.4` against `12585.0` on XAU, while the interactive book quoted `4172.7` against `4174.6`, P1, P2 and [`websocket.md`](./websocket.md) section 4.
So on 2026-10-12 nearly all liquidity near the mark was RPI, which only Retail orders can take, S8.
An engine that reads the API book will see usable legs on BTC and perhaps ETH, and wide or one-level books elsewhere, which the identity check of decision 15 compares by mark rather than by mid.

## 6. Rate limits and errors

| item | documented | probed |
|---|---|---|
| public REST budget | 1,500 requests a minute per IP, S10 | not reached |
| algorithm | a leaky bucket refilled continuously, so there is no fixed cooldown, S11 | |
| headers | not documented | `x-ratelimit-limit: 50`, `x-ratelimit-remaining`, `x-ratelimit-reset` in Unix seconds and `x-ratelimit-window: 1` on public calls, and `x-ratelimit-limit: 2000` on calls that failed authentication, P1 and P2 |
| status at the limit | Not publicly specified | not reached |
| `Retry-After` | Not publicly specified | absent on every reply |
| timeout | 30 s, then a 503, S11 | |
| maintenance | weekdays at 04:30 UTC for about 15 minutes, through `CANCEL_ONLY` and `POST_ONLY`, S12 | `GET /v1/system/state` read `{"status":"ok"}`, P1 and P2 |

| request | status | body |
|---|---:|---|
| `/orderbook/NOPE-USD-PERP` or `/orderbook/btc-usd-perp` | 400 | `{"error":"INVALID_REQUEST_PARAMETER","message":"market not found: NOPE-USD-PERP",…}` |
| `/markets/summary?market=NOPE-USD-PERP` | 400 | `"market: NOPE-USD-PERP does not exist."` |
| `/markets/summary` with no market | 400 | `"required market param is missing, for all available markets use market=ALL"` |
| `/markets?market=NOPE-USD-PERP` | 404 | `{"error":"MARKET_NOT_FOUND","message":"Market not found"}` |
| `/funding/data?market=NOPE-USD-PERP` | 200 | `{"next":null,"prev":null,"results":[]}` |
| `/funding/data` with no market | 400 | `"market: market is required"` |
| `/orderbook/BTC-USD-PERP?depth=abc` | 400 | `"strconv.ParseInt: parsing \"abc\": invalid syntax"` |
| an unknown path, `/account`, or `POST /markets` | 401 | `{"error":"INVALID_TOKEN","message":"invalid or expired jwt"}` |

Every shape held in both runs, P1 and P2 mode `errors`.
An unknown market on `funding/data` is a 200 with no rows, so a poller must check for empty results.
The runtime pauses on 403, 418 and 429 at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 21, and which status Paradex sends at its limit is unknown.

## 7. Server time and clock offset

`GET /v1/system/time` returns `{"server_time":"1791843450819"}`, Unix ms as a string, S13.
On the ten warm calls of each run, local time minus `server_time` lay between -47 and -64 ms at send and between +49 and +75 ms at arrival, with round trips of 97 to 127 ms, P1 and P2.
The midpoint offset is therefore within a few ms of 0, and `timedatectl` reported the local clock synchronised with NTP active.
The servers advise syncing with the Amazon Time Sync Service, S9.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| source | the socket's `markets_summary.<symbol>` for every perpetual, through `SocketAnchors` at [`socket_anchors.rs`](../../../server/src/venues/socket_anchors.rs) | one frame a second per market with index, mark and funding, 0.4 to 1.1 s old on arrival. REST is a 5 s snapshot that lands up to 8 s old, which leaves little room under the 10 s `ANCHOR_MAX_AGE_MS` and often breaks the 5 s `ANCHOR_SKEW_MS` against a fresher leg, at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) lines 4 and 5 |
| row mapping | section 3, with interval 8 from the catalog and next funding 0 | the summary has no interval, and funding never settles at an instant |
| REST fallback | `GET /v1/markets/summary?market=ALL` with gzip, every 5 s, `ts` from `created_at` | 1.15 MB a call and one new snapshot every 5 s, so faster polls read the same numbers |
| skip | everything but the 66 `PERP` symbols | `ALL` also returns 9,440 options and 2 spot markets |
| flag | the 23 `RWA` perpetuals in closing hours | 10.64 to 13.51 % of their index is an EMA of their own mark then, section 4 |
| flag | the mark on thin books | it follows other venues' basis as `w` falls to 0, section 4 |
| rate limit pause | the runtime default of 60 s, at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 20 | no `Retry-After` and no limit status were seen |
| catalog | `GET /v1/markets` with gzip, keep `asset_kind` `PERP`, `rawMarketId` from `symbol`, and the thousands rule for `kPEPE` and `kSHIB` | section 2 |

## 9. Decentralised layer

The questions are those of [`2026-09-23-hyperliquid-research-plan.md`](../../plans/2026-09-23-hyperliquid-research-plan.md) and decision 3 of [`2026-10-12-dex-venues-design.md`](../../implemented/2026-10-12-dex-venues-design.md).

### Chain, sequencer and time stamps

| item | value | label | evidence |
|---|---|---|---|
| chain | Paradex Chain, an appchain on the Starknet stack, a zero-knowledge rollup that posts encrypted state diffs to Ethereum | Published | S14 and S15 |
| chain id | `PRIVATE_SN_PARACLEAR_MAINNET`, with RPC at `https://rpc.api.prod.paradex.trade/rpc/v0_10` | Probed | `GET /v1/system/config`, P1 mode `tiers` of `fees-probe.py` |
| order book | "Orders are only stored on the Paradex Cloud and are only known to the operators of Paradex Cloud", and matching runs there | Published | S15 and S16 |
| settlement | each fill is sent to the chain, which checks margin again and can reject it as a "trade bust", reverting the fill off chain | Published | S16 |
| privacy | the RPC masks position and account fields for anyone but the owner, so the chain cannot rebuild other accounts' positions, and it carries no order book | Published | S15 and S17 |
| book times | `ts` and `last_updated_at` are the cloud's publish and change times in ms, with a per-market `seq` from the cloud book, and no block number | Probed | [`websocket.md`](./websocket.md) section 4, section 5 here |
| anchor times | mark, index and funding are stamped on a 1 s grid at 156 ms past the second, arrive on the socket 0.4 to 1.1 s after that stamp, and are kept by REST every 5 s | Probed | section 3, P1 and P2 |
| servers | AWS `ap-northeast-1`, Tokyo, behind AWS Global Accelerator, with `apne1-az1` as the primary zone | Published | S9 and S19 |
| releases | weekdays at 04:30 UTC, about 15 minutes, `CANCEL_ONLY` then `POST_ONLY` then `OK`, orders in those modes held within ±5 bps of the External Fair Price | Published | S12 |

So every price the engine would read comes from the operator's cloud in Tokyo, not from a block, and running a node would not replace the API as a data source.

### Who may use it and from where

Paradex Corp. bars US persons, Canadian persons and residents of sanctioned territories, and lists Canada and the United States as restricted territories, see [`fees.md`](./fees.md) section 1.
The terms cover the APIs as well as the web interface, and forbid a VPN used to get around a restriction.
From the Canadian exit every public REST call and every socket with the SBE parameters answered, and neither `GEO_IP_BLOCK` nor socket code `40112` appeared, P1 and P2.

### Oracle behind the index and the mark

The index is Pyth and Stork for crypto, and a weighted median of Pyth, Stork, Binance, Bybit, Hyperliquid, OKX and Lighter, plus a closing price and an EMA of the venue's own mark in closing hours, for TradFi, section 4.
The mark is the index times a fair basis built from Binance, Bybit, OKX, Hyperliquid and Lighter marks and Paradex's own quotes, section 4.
Funding uses impact premiums on Paradex, Binance, Bybit, OKX, Hyperliquid and Lighter, see [`fees.md`](./fees.md) section 6.
So Paradex's index, mark and funding all depend on prices from venues the engine also reads.

### Who can list a market

The catalog carries no deployer, builder, creator or owner field, every perpetual is `<base>-USD-PERP` with a Paradex `price_feed_id`, and no documentation describes listing by third parties, S1 and P2 mode `catalog`.
Permissionless listing is therefore Not publicly specified, and none was seen.
Every one of the 62 perpetuals with a binance or bybit reference marked within 0.5 % of it, so no ticker named another token on 2026-10-12, section 2.

### Routing

No documented route sends Paradex orders to another venue, and no venue in the survey routes its perpetuals to Paradex.
The dependency runs the other way, because Paradex reads Binance, Bybit, OKX, Hyperliquid and Lighter for its mark, its funding and its TradFi index, see section 4 here and [`fees.md`](./fees.md) section 6.
The marks of the 62 referenced perpetuals sat 0.9954 to 1.001 times binance and bybit, with a median of 0.9989, P1 and P2, which fits USD-quoted marks beside USDT-quoted ones.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | List available markets | https://docs.paradex.trade/api/prod/markets/get-markets | 2026-10-12 | Paradex, API docs | market fields, `trading_mode`, units, sections 2 and 9 |
| S2 | List available markets summary | https://docs.paradex.trade/api/prod/markets/get-markets-summary | 2026-10-12 | Paradex, API docs | summary fields and `market=ALL`, section 3 |
| S3 | Mark Price Calculation | https://docs.paradex.trade/risk/mark-price-calculation | 2026-10-12 | Paradex, docs | spot oracle and fair basis, section 4 |
| S4 | TradFi Price Oracle | https://docs.paradex.trade/trading/tradfi-markets | 2026-10-12 | Paradex, docs | TradFi index sources, scores, hours and rolls, section 4 |
| S5 | Price Bands | https://docs.paradex.trade/risk/price-bands | 2026-10-12 | Paradex, docs | price bands around the mark, section 4 |
| S6 | Funding Mechanism | https://docs.paradex.trade/risk/funding-mechanism | 2026-10-12 | Paradex, docs | funding formula and cadence, sections 3 and 4 |
| S7 | Get market orderbook | https://docs.paradex.trade/api/prod/markets/get-orderbook | 2026-10-12 | Paradex, API docs | REST book, section 5 |
| S8 | Retail Price Improvement | https://docs.paradex.trade/trading/rpi | 2026-10-12 | Paradex, docs | the API book leaves out RPI, section 5 |
| S9 | Server Location | https://docs.paradex.trade/docs/getting-started/architecture-overview/server-location | 2026-10-12 | Paradex, docs | Tokyo, `apne1-az1`, Amazon Time Sync, sections 1, 7 and 9 |
| S10 | Rate Limits, API | https://docs.paradex.trade/api/general-information/rate-limits/api | 2026-10-12 | Paradex, API docs | 1,500 a minute per IP, section 6 |
| S11 | Rate Limits, Common Questions | https://docs.paradex.trade/api/general-information/rate-limits/common-questions | 2026-10-12 | Paradex, API docs | leaky bucket, 30 s timeout, section 6 |
| S12 | Maintenance & Releases | https://docs.paradex.trade/docs/maintenance-mode | 2026-10-12 | Paradex, docs | release window and modes, sections 6 and 9 |
| S13 | Get time | https://docs.paradex.trade/api/prod/system/get-time-unix-milliseconds | 2026-10-12 | Paradex, API docs | server time, section 7 |
| S14 | Paradex Chain | https://docs.paradex.trade/chain/overview | 2026-10-12 | Paradex, docs | Starknet stack appchain, section 9 |
| S15 | Privacy Perps | https://docs.paradex.trade/trading/privacy | 2026-10-12 | Paradex, docs | cloud order storage, RPC masking, encrypted diffs, section 9 |
| S16 | Trade flow and busts | https://docs.paradex.trade/risk/trade-busts | 2026-10-12 | Paradex, docs | off-chain matching and on-chain validation, section 9 |
| S17 | Paradex Chain RPC Node | https://docs.paradex.trade/chain/paradex-chain-rpc-node | 2026-10-12 | Paradex, docs | masked data for unauthenticated RPC calls, section 9 |
| S18 | CCXT 4.5.68 `paradex.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/paradex.js` | 2026-10-12 | CCXT | catalog mapping, section 2 |
| S19 | API Server Location | https://docs.paradex.trade/api/general-information/server-location | 2026-10-12 | Paradex, API docs | AWS Global Accelerator in front of Tokyo, sections 1 and 9 |
| P1 | `rest-probe.py` modes `host` and `catalog` at 22:19, `anchor` at 22:20, `funding` at 22:21, `book` and `errors` at 22:21, `books` at 22:22 and `identity` at 22:33 UTC, and `fees-probe.py` at 22:23 UTC | [`rest-probe.py`](../../../scripts/probes/venues/paradex/rest-probe.py), [`fees-probe.py`](../../../scripts/probes/venues/paradex/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 9 |
| P2 | every mode of `rest-probe.py` from 22:38 to 22:40 UTC and `fees-probe.py` at 22:40 UTC, the second pass, plus `catalog` again at 22:45 UTC after it learned to print the funding caps, price bands and owner fields | [`rest-probe.py`](../../../scripts/probes/venues/paradex/rest-probe.py), [`fees-probe.py`](../../../scripts/probes/venues/paradex/fees-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 9 |
