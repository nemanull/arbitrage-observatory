# Hibachi REST Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:15 to 22:42 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public market data API of Hibachi (CCXT id `hibachi`) that a catalog, an anchor poller and a book resync would use, and the decentralised layer behind it.
Every call is a public `GET` on `https://data-api.hibachi.xyz`, and nothing here uses a key, signs or calls the trading host `https://api.hibachi.xyz`.
Every probed number comes from [`rest-probe.py`](../../../scripts/probes/venues/hibachi/rest-probe.py) or [`fees-probe.py`](../../../scripts/probes/venues/hibachi/fees-probe.py), run with `uv run` from the repository root, and the runs are listed as R1 to R4 in section 9.
Where the documentation and the wire disagree, both are written.
Fees and who may trade are in [`fees.md`](./fees.md), and the socket is in [`websocket.md`](./websocket.md).
The work follows [`2026-10-12-dex-venues-design.md`](../../implemented/2026-10-12-dex-venues-design.md), whose decision 3 sets the section "Decentralised layer".
All times are UTC.

## 1. Host and latency from this machine

| host | role | resolved on 2026-10-12 | edge |
|---|---|---|---|
| `data-api.hibachi.xyz` | public market data, REST and socket, S1 | `104.18.4.102`, `104.18.5.102`, `2606:4700::6812:466` and `2606:4700::6812:566` | Cloudflare, `cf-ray` ending `-SEA` on REST in R2 and `-YVR` on the socket and on one early REST call |
| `api.hibachi.xyz` | trading and account API, S1 | the same four addresses | not called |

Latency over one kept connection, R2 and R4.

| call | first request ms | repeated requests ms | reply bytes |
|---|---:|---|---:|
| `/exchange/utc-timestamp` | 190 and 381, cold, with TLS | ten warm per run: min 117 and 122, median 119 and 127, max 181 and 182 | 29 |
| `/market/exchange-info` | 125 and 157 | | 9,419 to 9,423 |
| `/market/inventory` | 152 and 158 | 60 polls a second apart per run: min 116 to 120, median 130 and 132, p90 142 and 148, max 226 and 325, R3 and R4 | 61,718 to 61,723, or 6,304 to 6,309 with `Accept-Encoding: gzip` |
| `/market/data/prices?symbol=BTC/USDT-P` | 147 and 120 | | 274 |
| `/market/data/orderbook?symbol=BTC/USDT-P` | 121 and 129 | | 1,967 |
| `/market/data/funding-rates?symbol=BTC/USDT-P&limit=5` | 124 and 152 | | 555 |
| `/market/data/stats`, `/open-interest`, `/trades` | 119 to 145, 123 to 298 and 120 to 164 | | 100, 33 and about 9,150 |

No reply came close to 2 s, so the reader's 5 s skew and 10 s age limits at [`anchor_reading.rs`](../../../server/src/engine/opportunity/anchor_reading.rs) lines 4 and 5 are not at risk from this host.
No reply was a refusal or a geoblock.

## 2. Catalog

### The instruments call

`GET /market/exchange-info` returns `futureContracts`, one row per tradable contract, beside `feeConfig`, `maintenanceWindow`, `maxSlippageLimit`, `instantWithdrawalLimit` and a top-level `status` of `"NORMAL"`, R2.
`GET /market/inventory` returns every contract ever listed, 67 of them, each as `{contract, info}`, where `contract` is the same row and `info` holds the prices of section 3, R2.
The documented `status` values are `LIVE`, `PAUSED` and `CLOSED`, S1.
Every row also carries `symbolStatus` and `nextOpenTimestamp`, which neither the API documentation, S1, nor the official SDK names.
At 22:48 UTC on 2026-10-12 `symbolStatus` read `OPEN` on all 67 rows, the closed ones included, and `nextOpenTimestamp` was null on all, as the builder found.

| status | category | count, R2 |
|---|---|---:|
| `LIVE` | `CRYPTO`: BTC, ETH, SOL, SUI, XRP, BNB, HYPE and PAXG | 8 |
| `LIVE` | `FX`: AUD, GBP, EUR, NZD, JPY, CAD and XAG | 7 |
| `CLOSED` | `CRYPTO`, only in `/market/inventory` | 52 |

Every row has `settlementSymbol` `USDT` and a symbol of the form `BASE/USDT-P`, except one closed row named `EUR_CLOSED_20250408/USDT-P`, R2.
Each base appears once among the `LIVE` rows, so no pair is listed twice.
The documentation's trading page still lists only seven crypto and three FX markets, S2, while the wire lists fifteen.

The FX rows carry a schedule: `marketOpenTimestamp`, and `nextCloseTimestamp` of 2026-10-16 21:00, the Friday close, on the six currencies.
`XAG/USDT-P` showed `nextCloseTimestamp` 2026-10-13 21:00, a daily close, R2.
Its funding row of 2026-10-12 22:00 settled at 0, as every FX row does while paused, so silver most likely stops from 21:00 to 22:00 each day, see section 4.
The design counted 14 active perpetuals earlier the same day, while CCXT loaded 15 at 22:21, R1.
A load inside XAG's daily hour would read it as not `LIVE`, which most likely explains the difference, but no load was made during that hour.

### How CCXT 4.5.68 maps it

| CCXT field | source | line in `hibachi.js`, S15 | fits the engine |
|---|---|---|---|
| `id` | `symbol`, as `BTC/USDT-P` | 284 | yes. The socket `symbol`, the inventory `contract.symbol` and every REST `symbol` parameter spell it the same, R2 and [`websocket.md`](./websocket.md) section 3 |
| `base` | `underlyingSymbol` | 287 | yes, with `commonCurrencies` empty at line 266 |
| `quote` and `settle` | `settlementSymbol`, `USDT` on every row | 288 and 291 | yes |
| `active` | `status === 'LIVE'` | 311 | yes. Only `/market/exchange-info` is read, at line 355, so the 52 closed rows of the inventory never appear |
| `linear` | `true` | 313 | yes |
| `contractSize` | `1` | 315 | yes. Book quantities are coins of the underlying, [`websocket.md`](./websocket.md) section 4 |
| `precision.price` | the first `orderbookGranularities` entry divided by 10,000 | 322 | not the tick size, for example 1e-05 on BTC whose `tickSize` is `0.1`, R1. The engine does not read it |
| `taker` and `maker` | the class constants 0.00045 and 0.00015 | 195 and 196 | see [`fees.md`](./fees.md) section 8 |

CCXT's `fetchFundingRate` reports `interval` `'8h'` at line 2293, while the venue settles every hour, section 4.
CCXT reads the next funding time from `nextFundingTimestamp` times 1,000 at line 2274, which matches the wire.

### Identity against other venues

`rest-probe.py identity` read the marks of binance, bybit, okx, gate and mexc for the bases that are not plain crypto, R3 and R4.

| base | Hibachi mark | references | ratio to Hibachi |
|---|---|---|---|
| `XAG` | 60.412 and 60.398 | binance, bybit, okx and gate | 1.0000 to 1.0005 |
| `PAXG` | 4,170.86 and 4,170.74 | binance, bybit twice, gate and mexc | 1.0001 to 1.0022 |
| `EUR`, `GBP`, `AUD`, `JPY` and `CAD` | 1.11622, 1.32214, 0.69648, 0.006307 and 0.70061 in R3 | mexc only | 0.9998 to 1.0035, the widest `JPY` at 1.0029 and 1.0035 |
| `NZD` | 0.55926 | none | |

So every base that a reference lists names the same asset at the same unit, and no `price_scale` or denial is needed.
`JPY` is quoted per yen, 0.0063 USDT, the same way as mexc's `JPY_USDT`.

## 3. Anchor

### The bulk call

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `GET /market/inventory` | `info.spotPrice` | `info.markPrice` | `info.estimatedFundingRate` | absent | absent | 61.7 KB, or 6.3 KB gzipped, 67 rows | median 130 and 132 ms, max 226 and 325 ms over 60 polls, R3 and R4 |
| `GET /market/data/prices?symbol=<id>`, one market a call | `spotPrice` | `markPrice` | `fundingRateEstimation.estimatedFundingRate` | absent | `fundingRateEstimation.nextFundingTimestamp`, in seconds | 274 bytes | 120 to 147 ms, R2 and R4 |

On the 15 `LIVE` rows no mark or index was null, and on the 52 `CLOSED` rows the mark is null, R2 and R4.
`/market/data/prices` gave `nextFundingTimestamp` 1791846000, 2026-10-12 23:00, on all 15 markets at 22:25 and at 22:38, the next whole hour, R3 and R4.
Its `timestampMs` trailed arrival by min 72 to 186, median 740 to 1,021 and max 2,981 to 3,934 ms over 15 calls a second apart per run, R3 and R4, so that call serves a value up to about 4 s old.
The `info` of `/market/inventory` also carries `bestBidPrice`, `bestAskPrice`, `tags` and a display `category`, among others.

### Row mapping

| `AnchorRow` field | source | unit on the wire | conversion |
|---|---|---|---|
| key | `markets[i].contract.symbol` | string, `BTC/USDT-P` | as is, equal to `market.id` |
| `index` | `info.spotPrice` | decimal string | parse |
| `mark` | `info.markPrice` | decimal string, never null on a `LIVE` row | parse |
| `funding_rate` | `info.estimatedFundingRate` | a fraction per hour: `"0.000019"` is 0.0019 % | parse |
| `funding_interval_hours` | none in the reply | the constant 1, S3, and 80 hourly rows with no gap in R2 | 1 |
| `next_funding_at` | none in the reply | the next whole UTC hour | `(ts / 3_600_000 + 1) * 3_600_000` in integer ms |
| `ts` | none in the reply | the arrival of the reply | the runtime's stamp |

The fields are those of `AnchorRow` at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 27.

## 4. Anchor semantics

### Index

"To calculate spot price, Hibachi finds the average price from both Pyth and Stork", S4.
The funding page calls the settlement index "the median across oracle sources", S3, which for two sources is the same average.
Neither page names the Pyth or Stork feed behind each market, so the per-market basket is Not publicly specified.
No source is Hibachi's own book, so the index never contains Hibachi's perpetual.

The FX and XAG index freezes while the market is paused.
In the funding history the `EUR/USDT-P` index stayed at 1.1201625 and the `XAG/USDT-P` index at 60.822595 from Friday 2026-10-09 22:00 to Sunday 2026-10-11 20:00, R2.
So a paused market's anchor reads as an unmoving index, which no anchor guard flags.

### Mark

S4 gives the mark as the median of three prices.

```text
Mark Price = Median(Price1, Price2, Last Traded Price)
Price1 = Index Price * (1 + Last Funding Rate * Time Until Funding / 8)
Price2 = Index Price + Moving Average (5min)
Moving Average (5min) = Moving Average((Bid1 + Ask1) / 2 - IndexPrice)
```

The moving average "is computed every second over a 5 min interval", S4.
No clamp on the mark's premium is published.
Because the last trade is one of the three, a thin market's mark can sit on its last trade.
At 22:25 and 22:38 the gap between mark and index was 1,531 and 1,562 ppm on `XAG/USDT-P`, 866 and 870 on `GBP/USDT-P`, 726 and 725 on `AUD/USDT-P`, 696 and 737 on `PAXG/USDT-P`, and 2 to 492 on the crypto markets, R3 and R4.

### Funding

The rate is `(1/8) × mean(ρ_t)` over the trailing hour, with `ρ_t = clamp((M_t - S_t) / S_t, -1, +1)`, `M_t` the mid and `S_t` the index, settled every hour, S3.
The published rate is capped at -10 % and 10 %, S5.
`estimatedFundingRate` is the running estimate for the upcoming settlement, since `nextFundingTimestamp` beside it names the next whole hour, R3 and R4.
The settled rates are in `GET /market/data/funding-rates?symbol=<id>&startTime=<s>&endTime=<s>&limit=<n>`, which returns `{contractId, fundingTimestamp, fundingRate, indexPrice}` rows in ascending order, starting 7 days back when no `startTime` is given, R2.
Every FX and XAG row of the weekend settled at 0, S6 and R2.
The largest hourly rate seen was `XAG/USDT-P` at -0.007986 at 2026-10-12 07:00, R2.
The settlement instant itself was not captured.

### How often each number changed

Over 60 polls of `/market/inventory` a second apart, out of 59 chances, in each of R3 and R4:

| market | mark changed | index changed | funding changed |
|---|---:|---:|---:|
| `ETH/USDT-P`, `XRP/USDT-P`, `HYPE/USDT-P` | 35 to 49 | 44 to 49 | 0 |
| `SOL/USDT-P`, `BNB/USDT-P`, `SUI/USDT-P`, `PAXG/USDT-P`, `XAG/USDT-P` | 28 to 49 | 31 to 44 | 0 to 3 |
| `BTC/USDT-P` | 11 to 16 | 44 to 46 | 1 |
| `GBP/USDT-P`, `CAD/USDT-P`, `JPY/USDT-P`, `EUR/USDT-P` | 9 to 26 | 16 to 29 | 0 to 2 |
| `AUD/USDT-P`, `NZD/USDT-P` | 4 to 23 | 20 to 21 | 1 to 2 |

The socket pushes the same numbers every 302 ms, and the REST mark matched the socket's latest value on 234 of 330 market polls in [`websocket.md`](./websocket.md) run W3 and on 287 of 412 in W4.
A REST mark that trailed had been superseded on the socket for a median of 529 ms and at most 1,053 ms, so the bulk call is at most about a second behind the socket.
In W4, 3 polls held a mark the socket had not shown yet, so the REST reply is sometimes the newer one.

## 5. REST book snapshot

`GET /market/data/orderbook?symbol=<id>&depth=<1 to 100>&granularity=<one of orderbookGranularities>` returns `{bid, ask}`, each `{startPrice, endPrice, levels}` with `levels` of `{price, quantity}` strings, R2.
Without parameters it returns 20 levels at the finest granularity, the same window as the socket's default.

| query | bids | asks | order |
|---|---:|---:|---|
| `BTC/USDT-P` | 20 | 20 | bids descending, asks ascending |
| `BTC/USDT-P`, `depth=100` | 74 | 52 | the same, with a stray bid at 1.0 |
| `ETH/USDT-P`, `depth=100` | 50 | 33 | the same |
| `JPY/USDT-P` | 15 | 15 | the same |
| `XAG/USDT-P`, `depth=100` | 12 | 10 | the same |

All from R2, and R4 found 75 and 48, 51 and 33, 14 and 15, and 12 and 11 on the same queries.
Of six reads of `BTC/USDT-P` 0.2 s apart, 0 and then 2 equalled the read before, R2 and R4, so the reply is at most briefly cached.
A closed market answers 400 `{"errorCode":4,"message":"Unable to get orderbook for Closed market","status":"failed"}`, R2.
The feed does not need this call, because the socket sends its own snapshot.

## 6. Rate limits and errors

"There is an overall rate limit of 350 requests / 10 seconds per IP", S5.
No reply carried a rate limit header, and no limit was reached, so the status and the `Retry-After` of a refusal are not known, R2 and R4.
A poll a second spends 10 of the 350.

| request | status | body, R2 and R4 |
|---|---|---|
| `prices` for an unknown symbol, or one in lower case | 404 | `{"message":"Could not find symbol \"FOO/USDT-P\".","status":"failed"}` |
| `prices` for a closed symbol | 200 | every field null |
| `prices` with no `symbol` | 400 | `text/plain`: `Failed to deserialize query string: missing field \`symbol\`` |
| `orderbook` with a granularity not listed | 400 | `{"errorCode":4,"message":"Invalid order book granularity 0.5. Valid granularities: [\"0.1\", \"1\", \"100\", \"10\"]","status":"failed"}` |
| `orderbook` with `depth` 0 or 101 | 400 | `{"errorCode":4,"message":"Depth 101 must be between 1 and 100","status":"failed"}` |
| `funding-rates` for an unknown symbol | 400 | `{"errorCode":4,"message":"Invalid symbol: FOO/USDT-P","status":"failed"}` |
| an unknown path | 200 | an empty body with `content-type: application/grpc` |

The scheduled maintenance is published ahead in `/market/exchange-info` as `maintenanceWindow`, which listed `begin` 2026-10-13 18:00 and `end` 20:00 with the note "Updating system", R2.
During maintenance "the exchange is down", S7, and trading resumes through a call auction, S8.

## 7. Server time and clock offset

`GET /exchange/utc-timestamp` returns `{"timestampMs":1791843820709}`, R2.
Over ten calls the server minus the midpoint of the local request was min 0, median 9 and max 114 ms with a median round trip of 145 ms in R2, and min -5, median 4 and max 13 ms with 123 ms in R4.

## 8. Recommended poller shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| source | `GET https://data-api.hibachi.xyz/market/inventory` | one call carries index, mark and funding for every market, section 3 |
| interval | 1,000 ms, the default of `AnchorVenue::poll_every` at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 57 | median reply 130 ms, at most about 1 s behind the socket, and 10 of the 350 requests allowed per 10 s |
| request | `get_json` at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 73 | a plain `GET` with no body. gzip cuts the reply from 61.7 KB to 6.3 KB if the client asks for it |
| rows | only `markets[i]` whose `contract.status` is `LIVE` in the same reply | 52 closed rows have null prices, and a paused market's index is frozen, section 4 |
| mapping | section 3 | |
| interval and next settlement | `funding_interval_hours` 1, and `next_funding_at` the next whole UTC hour after the arrival stamp | neither is in the reply, and `/market/data/prices` named the next whole hour on all 15 markets |
| rate limit pause | the runtime's default 60 s at [`anchor_poller.rs`](../../../server/src/feeds/anchor_poller.rs) line 20 | no `Retry-After` and no refusal were seen |
| flag | `XAG/USDT-P` | its mark sat 1,531 ppm from its index, and one hourly rate reached -0.8 %, section 4 |
| catalog | follow CCXT: `futureContracts` rows with `status` `LIVE`, `id` from `symbol`, `base` from `underlyingSymbol`, `quote` from `settlementSymbol`, `contract_size` 1 and `price_scale` 1 | section 2 |

At a 1 s interval with gzip the reply is about 0.5 GB a day, and about 5.3 GB without it.

## Decentralised layer

### The chain, the engine and its clock

Hibachi runs its own order book and matching engine, which its terms list beside the smart contracts as software Hibachi developed, S9.
It calls itself "a decentralized perps exchange" that uses "zk technology" to deliver "sub-millisecond execution", S10.
Collateral settles on Arbitrum, where `/market/inventory` marks chain 42161 `isSettlementChain` true and lists USDT at `0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9`, R4.
Base, chain 8453, and Arc, chain 5042, are enabled for USDC, and Ethereum mainnet is listed but disabled, R4.
Collateral moves on chain only after a zero knowledge proof validates the movement, S11, and the terms name the RISC Zero service as part of the system, S9.
A taker order waits 25 ms before it can match, while resting orders and cancels are not delayed, S12.

No market data carries a block number or a chain time.
Book frames carry `timestamp_ms` from Hibachi's servers, about 65 ms before arrival here, [`websocket.md`](./websocket.md) section 5.
The anchor values carry no time on the socket or in `/market/inventory`, so the engine's arrival stamp is the only time an anchor reading has.
The engine judges book and anchor freshness by arrival, and nothing on the chain delays either.

### Who may use it and from where

The terms of Hibachi PTE. LTD., dated 2024-10-10, block persons in the United States and the United Kingdom from the interface, bar the sanctioned territories from every service, and say no Blocked Person may enter into perpetual contracts, S9.
They also forbid a VPN used to get around those rules, S9.
Sign-up takes a wallet or an email address and no identity check is described, see [`fees.md`](./fees.md) section 1.
Every public call answered from the Canadian exit without a refusal, R1 to R4.

### The oracle behind the index and the mark

The index is the average of the Pyth and Stork prices, and the mark is the median of the three prices of section 4, S4.
Funding settles against the index at the hour, S3.
The per-market Pyth and Stork feeds are Not publicly specified.
The FX and XAG oracle prices froze across the weekend, section 4.

### Who can list a market

Only Hibachi lists markets.
"Additional markets may be added over time based on market demand, liquidity, and risk parameters", S2, and temp markets are introduced and rotated out by Hibachi, S13.
No contract carries a deployer field, and all 67 contracts share one namespace, R4.
So no third party can list a ticker here, and decision 7 of [`2026-10-12-dex-venues-design.md`](../../implemented/2026-10-12-dex-venues-design.md), which keeps only the venue's own listings, keeps all 15.
A ticker can return as another contract, since contract 42, an earlier EUR market in the `CRYPTO` category that closed on 2025-04-15, now carries the symbol `EUR_CLOSED_20250408/USDT-P`, and `EUR/USDT-P` is now contract 62, an FX perpetual opened on 2026-05-26, R4.
Section 2 found every base that a reference venue lists to name the same asset there.

### Venues that route to Hibachi, and where Hibachi routes

No profile in this repository names Hibachi as a liquidity source, and Hibachi names no outside venue that its orders route to.
Its outside inputs are the Pyth and Stork oracles only, S4.
Its vaults are managed accounts on Hibachi, whose curators trade the deposited capital with strategies that may include market making and arbitrage, S14.

### What the halts mean for the engine

FX markets pause from Friday 17:00 to Sunday 17:00 New York time, with two minutes of liquidations before the pause, S6.
`XAG/USDT-P` most likely stops from 21:00 to 22:00 UTC each day, section 2.
The whole exchange stops for scheduled maintenance, section 6.
While a market is paused its index freezes and its funding is 0, and it reopens through a call auction in which the book may cross and nothing trades, S8.
A paused market whose anchor row is still sent would look current to the engine, so the poller should send rows only for markets that the same reply shows as `LIVE`, see section 8.
A market left out of a round has no anchor reading, and the engine then refuses its routes, as decision 19 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) relies on.
Whether `status` turns `PAUSED` at the FX close is documented, S6, and was not seen on the wire.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hibachi API documentation, Market API | https://api-doc.hibachi.xyz/ | 2026-10-12 | Hibachi, Postman documenter | hosts, every market call, the `status` values, sections 1, 2 and 5 |
| S2 | Hibachi Docs, Trading | https://docs.hibachi.xyz/hibachi-docs/trading | 2026-10-12 | Hibachi, docs | the listed markets and who adds them, section 2 and the decentralised layer |
| S3 | Hibachi Docs, Funding | https://docs.hibachi.xyz/hibachi-docs/trading/funding | 2026-10-12 | Hibachi, docs | funding formula, hourly settlement, the settlement index, sections 3 and 4 |
| S4 | Hibachi Docs, Pricing | https://docs.hibachi.xyz/hibachi-docs/trading/pricing | 2026-10-12 | Hibachi, docs | index from Pyth and Stork, the mark formula, section 4 |
| S5 | Hibachi Docs, Limits | https://docs.hibachi.xyz/hibachi-docs/trading/limits | 2026-10-12 | Hibachi, docs | 350 requests per 10 s per IP, funding limits, sections 4 and 6 |
| S6 | Hibachi Docs, FX trading | https://docs.hibachi.xyz/hibachi-docs/trading/fx-trading | 2026-10-12 | Hibachi, docs | weekend pause and no funding while paused, section 4 and the decentralised layer |
| S7 | Hibachi Docs, FAQ | https://docs.hibachi.xyz/faq | 2026-10-12 | Hibachi, docs | the exchange is down during maintenance, section 6 |
| S8 | Hibachi Docs, Call auctions | https://docs.hibachi.xyz/hibachi-docs/trading/call-auctions | 2026-10-12 | Hibachi, docs | reopening auctions and the crossed book, section 6 and the decentralised layer |
| S9 | Hibachi Terms of Service, dated 2024-10-10 | https://hibachi.xyz/terms | 2026-10-12 | Hibachi PTE. LTD., Singapore | order book and matching engine, RISC Zero, who may use it, the decentralised layer |
| S10 | Hibachi web app, page description | https://hibachi.xyz/ | 2026-10-12 | Hibachi | self-description, the decentralised layer |
| S11 | Hibachi Docs, Verification | https://docs.hibachi.xyz/hibachi-docs/verification | 2026-10-12 | Hibachi, docs | zero knowledge proofs on collateral moves, the decentralised layer |
| S12 | Hibachi Docs, Taker Speed Bump | https://docs.hibachi.xyz/hibachi-docs/trading/taker-speed-bump | 2026-10-12 | Hibachi, docs | 25 ms delay on taker orders, the decentralised layer |
| S13 | Hibachi Docs, Temp Markets | https://docs.hibachi.xyz/hibachi-docs/trading/temp-markets | 2026-10-12 | Hibachi, docs | listing and rotation by Hibachi, the decentralised layer |
| S14 | Hibachi Docs, How Vaults Work | https://docs.hibachi.xyz/hibachi-docs/vaults/how-vaults-work | 2026-10-12 | Hibachi, docs | vaults as curated accounts on Hibachi, the decentralised layer |
| S15 | CCXT 4.5.68 `hibachi.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/hibachi.js` | 2026-10-12 | CCXT | catalog mapping and the funding interval, section 2 |
| R1 | `fees-probe.py ccxt`, 22:21 UTC | [`fees-probe.py`](../../../scripts/probes/venues/hibachi/fees-probe.py) | 2026-10-12 | this host, Canadian exit | CCXT's 15 markets and their fields, section 2 |
| R2 | `rest-probe.py host catalog funding book errors time`, 22:23 UTC | [`rest-probe.py`](../../../scripts/probes/venues/hibachi/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1, 2 and 4 to 7, and the decentralised layer |
| R3 | `rest-probe.py anchor identity`, 22:24 to 22:26 UTC | [`rest-probe.py`](../../../scripts/probes/venues/hibachi/rest-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 4 |
| R4 | the second pass, every mode of both probes rerun from 22:37 to 22:39 UTC, and `rest-probe.py catalog` once more at 22:42 UTC with the chain fields printed | [`rest-probe.py`](../../../scripts/probes/venues/hibachi/rest-probe.py) and [`fees-probe.py`](../../../scripts/probes/venues/hibachi/fees-probe.py) | 2026-10-12 | this host, Canadian exit | every section |
