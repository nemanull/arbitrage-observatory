# MEXC REST Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

This profile covers the public futures REST API of MEXC, the CCXT id `mexc`, for the catalog, the anchor poller and the REST book.
Every probed number comes from [`../../../scripts/probes/mexc-rest-probe.mjs`](../../../scripts/probes/mexc-rest-probe.mjs), run from `server/`, unless a row names another probe.
Raw replies were kept outside the repository.
Times are UTC.

## 1. Host and latency from this machine

MEXC moved the documented futures REST host from `https://contract.mexc.com` to `https://api.mexc.com` on 2026-01-12, and announced that "support for the original domain will be officially discontinued" from 2026-01-19 16:00 UTC, see S2.
Both hosts still answered every public call on 2026-09-15 with the same replies.
A later feed should use `api.mexc.com`, because it is the documented one.

| host | resolved addresses | reverse name | label |
|---|---|---|---|
| `api.mexc.com` | 23.218.239.11, 23.218.239.40 | `a23-218-239-11.deploy.static.akamaitechnologies.com` | Probed |
| `contract.mexc.com` | 23.218.239.29, 23.218.239.37 | `a23-218-239-29.deploy.static.akamaitechnologies.com` | Probed |
| `www.mexc.com` | 23.218.239.38, 23.218.239.6 | `a23-218-239-38.deploy.static.akamaitechnologies.com` | Probed |

The reverse names, the `x-cache` header and the `ak_p` entry in `server-timing` say both API hosts answer from an Akamai edge.
Where MEXC's origin servers sit is an inference this probe cannot make, and it is `Not verified`.
A rerun at 18:52 UTC resolved each host to two other addresses in the same 23.218.239.0/24 range, so the edge addresses rotate.
`www.mexc.com` answered `curl` and Node `fetch` with HTTP 403 "Access Denied" on documentation pages, while both API hosts answered normally.

Latency at 07:11 to 07:13 on 2026-09-15, in milliseconds, with Node's global `fetch` as [`../../../server/src/feeds/anchor/AnchorPoller.ts`](../../../server/src/feeds/anchor/AnchorPoller.ts) line 222 uses it.
Cold is the first request to that host in the process, and warm is five later requests one second apart on the kept connection, two for the catalog.

| host | call | cold ms | warm min / med / max ms | decoded bytes | wire bytes and encoding |
|---|---|---:|---|---:|---|
| api | `GET /api/v1/contract/ping` | 170 | 114 / 118 / 119 | 46 | 46 identity |
| api | `GET /api/v1/contract/funding_rate`, every contract | 158 | 133 / 143 / 628 | 242,937 | 20,134 gzip |
| api | `GET /api/v1/contract/ticker`, every contract | 163 | 166 / 167 / 178 | 622,723 | 135,437 gzip |
| api | `GET /api/v1/contract/depth/BTC_USDT?limit=20` | 128 | 116 / 121 / 135 | 794 | 792 identity |
| api | `GET /api/v1/contract/detail`, the catalog | 205 | 504 / 697 | 2,264,952 | 170,645 gzip |
| contract | ping | 158 | 118 / 122 / 138 | 46 | 72 gzip |
| contract | funding_rate, every contract | 157 | 133 / 143 / 184 | 242,916 | 20,119 gzip |
| contract | ticker, every contract | 499 | 136 / 281 / 518 | 622,908 | 127,981 br |
| contract | depth BTC_USDT 20 | 121 | 120 / 122 / 125 | 793 | 348 gzip |
| contract | detail | 326 | 436 / 658 | 2,264,952 | 153,973 br |

A rerun at 18:52 to 18:55 UTC gave times of the same order on every call except the warm catalog on `api`, which took 255 and 2,543 ms.
These are one host on one date.
Every reply carried `cache-control: max-age=0, no-cache, no-store`.
The two hosts chose different encodings for the same request, gzip on `api` and brotli on `contract` for the large replies.

## 2. Catalog

### The instruments call

| item | value | label | source |
|---|---|---|---|
| Call CCXT uses | `GET https://api.mexc.com/api/v1/contract/detail`, public | Probed | `server/node_modules/ccxt/js/src/mexc.js` lines 156 and 1387 |
| Call the current docs name | `GET /api/v1/contract/detail/country`, which answered the same 2.26 MB list | Published, Probed | S3 |
| Documented limit | "10 time / 2 seconds" in the current docs, "1 times / 5 seconds" in the older docs | Published | S3, S4 |
| Status field | `state`: 0 enabled, 1 delivery, 2 delivered, 3 offline, 4 paused | Published | S3 |
| Status values in the reply | `state` 0 on every contract at 06:59 and 07:10 | Probed | P1 |
| API tradability | `apiAllowed` false on 41 active contracts at 07:09 | Probed | P2 |
| Contract kind | `futureType` 1 perpetual, 2 delivery, and 1 on every contract | Published, Probed | S3, P1 |
| Pair kind | `type` 1 normal, 2 "suspended", with `typeLabel` 2 "stock", and 425 contracts carried `type` 2 while trading | Published, Probed | S3, P1 |
| Index sources | `indexOrigin`, a list of source names without weights | Published, Probed | S3, P1 |

A contract that stops trading left the list rather than changing `state`.
15 contracts, among them `ALIGN_USDT`, `QUID_USDT` and 10 stock contracts, were in the 06:59 reply and gone from the 07:10 reply.
The reason was not published in any page read, and the book timestamp below says `ALIGN_USDT` stopped at 07:00:01.
Right after, `GET /api/v1/contract/detail?symbol=ALIGN_USDT` returned `{"success":false,"code":1001,"message":"Contract not exists"}`.
`GET /api/v1/contract/depth/ALIGN_USDT?limit=5` still returned success with an empty book and a timestamp frozen at 07:00:01.

```json
{"success":true,"code":0,"data":{"cts":null,"asks":[],"bids":[],"version":222542631,"timestamp":1789455601090}}
```

So an empty book whose `timestamp` does not advance is the sign of a contract that no longer trades, and it must not be written as an empty book.

### Active perpetuals by settlement asset

CCXT 4.5.68 `loadMarkets` at 07:09, filtered exactly like [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 188 to 194, took 1,588 ms and returned 3,166 markets, 1,184 of them active swaps.

| settlement | linear | active swaps |
|---|---|---:|
| USDT | yes | 1,061 |
| USDC | yes | 78 |
| USD1 | yes | 35 |
| BTC, ETH, SOL, XRP, SUI, DOGE, ADA, LTC, AVAX, LINK | no, quote USD | 1 each, 10 in total |

CCXT sets `options.fetchMarkets.types.swap.inverse` to false at `server/node_modules/ccxt/js/src/mexc.js` lines 491 to 494.
`fetchMarkets` calls `fetchSwapMarkets` unconditionally at line 1245, so the 10 inverse contracts load anyway, as the probe shows.

### How CCXT maps a contract

| field | CCXT source | line in `server/node_modules/ccxt/js/src/mexc.js` |
|---|---|---|
| `id` | `symbol`, as in `BTC_USDT` | 1437 and 1447 |
| `base`, `quote`, `settle` | `safeCurrencyCode` of `baseCoin`, `quoteCoin`, `settleCoin` | 1438 to 1443 |
| `linear` | `quote === settle` | 1445 |
| `active` | `state === '0'` | 1461 |
| `taker`, `maker` | `takerFeeRate`, `makerFeeRate` | 1465 and 1466 |
| `contractSize` | `contractSize` | 1467 |
| `precision.amount`, `precision.price` | `volUnit`, `priceUnit` | 1473 and 1474 |

| market | `id` | base / quote / settle | linear | `contractSize` | taker | precision price / amount | `indexOrigin` |
|---|---|---|---|---:|---:|---|---|
| BTC/USDT:USDT | `BTC_USDT` | BTC / USDT / USDT | true | 0.0001 | 0.0001, and 0.0002 at 18:55 | 0.1 / 1 | BITGET, BYBIT, BINANCE, HTX, UPBIT, OKX, MEXC, KUCOIN |
| BTC/USD:BTC | `BTC_USD` | BTC / USD / BTC | false | 100 | 0.0001, and 0.0002 at 18:55 | 0.1 / 1 | BITSTAMP, COINBASE, KRAKEN |
| BTC/USDC:USDC | `BTC_USDC` | BTC / USDC / USDC | true | 0.0001 | 0.0001, and 0.0002 at 18:55 | 0.1 / 1 | BITGET, BYBIT, BINANCE, OKX, MEXC, KUCOIN |
| RIF/USDT:USDT, thin | `RIF_USDT` | RIF / USDT / USDT | true | 10 | 0.0002 | 0.00001 / 1 | BITGET, LBANK, BINANCE, MEXC |
| CSPR/USDT:USDT, thin | `CSPR_USDT` | CSPR / USDT / USDT | true | 1 | 0.0002 | 0.000001 / 1 | BYBIT, OKX, MEXC, KUCOIN |

`market.id` against the socket and the anchor: every one of the 1,184 CCXT ids appeared, spelled identically, as a `symbol` in the bulk funding reply, and every id matched `^[A-Z0-9]+_[A-Z0-9]+$`.
The socket's `symbol` field uses the same spelling, see [`./websocket.md`](./websocket.md) section 3.
The bulk anchor replies also carried 8 rows with no catalog entry, `MX_USDT`, `TON_USDT`, `WBTC_USDT`, `STETH_USDT`, `USDE_USDT`, `USDGO_USDT`, `MXSOL_USDT` and `USD1_USDT`, each with `lastPrice` 0, so a poller keyed by catalog ids drops them naturally.

`contractSize` against the book unit: book sizes are contracts, and a contract is `contractSize` coins for a linear contract.
A REST book rebuilt from socket deltas matched the REST book at the same `version` level for level, and the best bid of 27,337 contracts on BTC_USDT is 2.7337 BTC at `contractSize` 0.0001, see [`./websocket.md`](./websocket.md) section 4.
Contract sizes in use run from 0.00001 to 10,000,000, with 261 contracts at 1 and 923 at other sizes, at 07:09.
For the 10 inverse contracts `contractSize` is USD per contract, 100 on BTC_USD and 10 on the other nine, and the funding page describes coin margined notional as "Position Size (Cont) × Contract Value / Fair Price", see [`./fees.md`](./fees.md) section 6.

### Pairs listed twice, price scales and aliases

| case | finding | label |
|---|---|---|
| One pair in several of USDT, USDC, USD | 76 pairs at 07:09, for example `BTC_USDT`, `BTC_USDC`, `BTC_USD` | Probed |
| Engine choice among them | USDT before USDC before USD, by [`../../../server/src/engine/cluster/quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 12 to 17 | Code |
| USD1 contracts | quote `USD1`, a cluster family of its own, so `BTC_USD1` never pairs with another venue's BTC USDT market | Probed, Code |
| Bases scaled in the name | `1000BONK_USDT`, `1000RATS_USDT`, `1000BTT_USDT`, `1000000BABYDOGE_USDT`, `1000000MOG_USDT` | Probed |
| Bases scaled by contract size only | `PEPE_USDT` at 10,000,000 per contract and `SHIB_USDT` at 1,000, both priced per coin | Probed |
| Stock and commodity bases that differ from the ticker | `NVIDIA` for NVDA, `TESLA` for TSLA, `COINBASE` for COIN, `FILECOIN` for FIL, `PUMPFUN` for PUMP, `TRUMPOFFICIAL` for TRUMP, from `baseCoinName` | Probed |
| CCXT aliases that rename a futures base | `GAS_USDT` becomes base `GASDAO`, `GMT_USDT` becomes `GMTTOKEN`, `FLUX_USDT` becomes `FLUX1` | Probed, `server/node_modules/ccxt/js/src/mexc.js` lines 904, 906 and 908 |

The CCXT aliases come from `commonCurrencies`, a spot era table at `server/node_modules/ccxt/js/src/mexc.js` lines 894 to 916.
`GASDAO|USDT`, `GMTTOKEN|USDT` and `FLUX1|USDT` would never cluster with the same coins on other venues, so they fail silently as missed pairs, not as false rows.
Whether `1000BONK` on MEXC clusters with the same base on other venues depends on how their CCXT classes spell it, which this profile does not check.
A ticker collision in the sense of `DENIED_PAIRS` was not audited, see the open questions.

## 3. Anchor

One call returns index, mark, funding rate, cap, interval and next settlement for every perpetual.

```text
GET https://api.mexc.com/api/v1/contract/funding_rate
```

The symbol path segment is documented as optional, and without it the reply is a list of every contract, see S5.
The documented limit is "20 times / 2 seconds", see S5.

One row, BTC_USDT at 06:59, trimmed from the 1,207 rows of that reply.

```json
{"symbol":"BTC_USDT","fundingRate":0.000067,"maxFundingRate":0.0018,"minFundingRate":-0.0018,"collectCycle":8,"nextSettleTime":1789459200000,"timestamp":1789455551670,"idxPrice":77271.6,"fairPrice":77240.4}
```

| `AnchorRow` column | field | unit and meaning | label |
|---|---|---|---|
| `index` | `idxPrice` | quote per coin, JSON number | Probed |
| `mark` | `fairPrice` | quote per coin, MEXC's mark, JSON number | Probed |
| `fundingRate` | `fundingRate` | fraction per interval for the upcoming settlement, see section 4 | Probed |
| `fundingIntervalHours` | `collectCycle` | hours, an integer, documented as "Collection cycle" | Published, Probed |
| `nextFundingAt` | `nextSettleTime` | Unix ms | Probed |

| item | value | label |
|---|---|---|
| Rows per reply | 1,192 at 07:12, every catalog id plus the 8 extra rows of section 2 | Probed |
| Reply size | 242,859 to 242,943 bytes decoded, 20,134 bytes gzip on the wire | Probed |
| Round trip over 60 polls at 1 Hz | min 127, median 138, max 424 ms | Probed |
| Row `timestamp` | the time the reply was built, arrival minus `timestamp` was 98 to 748 ms with median 133 ms, about the round trip | Probed |
| Symbol spelling | identical to CCXT `market.id` and to the socket `symbol` | Probed |
| Missing mark | no row had `fairPrice` 0 or `idxPrice` 0 at 06:59 | Probed |

`idxPrice` and `fairPrice` were added to the documented funding reply on 2026-04-18, see S6.

The bulk ticker is a second source and a worse one.

```text
GET https://api.mexc.com/api/v1/contract/ticker
```

It carries `indexPrice`, `fairPrice` and `fundingRate` but no interval, cap or next settlement.
It is 622 KB decoded and 135 KB on the wire, its documented limit is "10 times / 2 seconds", see S7, and its round trip was 161 / 175 / 810 ms.
Its rows republish less often, as section 4 shows, and each row's `timestamp` is the last trade, 376 to 4,973 ms old on arrival.

Per symbol calls exist and were not needed: `GET /api/v1/contract/index_price/{symbol}` and `GET /api/v1/contract/fair_price/{symbol}`.
For the inverse `BTC_USD` both answered with their own numbers, index 77,224.4 against 77,257.4 on `BTC_USDT`, because the inverse index uses a USD basket of Bitstamp, Coinbase and Kraken.

## 4. Anchor semantics

### Index

| item | value | label | source |
|---|---|---|---|
| Formula | "Index Price = (Weight % of Exchange A × Asset Price on Exchange A) + … + (Weight % of Exchange N × Asset Price on Exchange N)" | Published | S8 |
| Outlier rule | "If a Spot price from a specific exchange deviates by more than ±1% from the median price of all included exchanges, MEXC will exclude that exchange's price from the calculation." | Published | S8 |
| Slow sources | "If an exchange's market data updates slowly over an extended period or shows abnormal price deviations, its data will be excluded" | Published | S8 |
| Weights | shown on the web page per contract, which renders in the client and returned no table to WebFetch | Not publicly specified | S9 |
| Basket call | none documented, `indexOrigin` in the catalog lists sources without weights | Probed | P1 |
| Sources that are futures, not spot | `BINANCE_FUTURE`, `BITGET_FUTURE`, `BYBIT_FUTURE`, `OKX_FUTURE`, `GATEIO_FUTURE`, `MEXC_FUTURE` and others appear in `indexOrigin` | Probed | P1 |
| Venue's own perp in the basket | `MEXC_FUTURE` is a source on 252 of 1,199 contracts at 06:59, 73 of them crypto contracts | Probed | P1 |
| Venue's own perp as the only source | `YMTCSTOCK_USDT` and `KIMISTOCK_USDT`, both API tradable | Probed | P1 |
| MEXC spot as the only source | 12 contracts, all `apiAllowed` false, for example `NUDES_USDT`, `PURR_USDT`, `INDEX_USDT` | Probed | P1 |
| Single source of any kind | 82 contracts at 06:59, most of them stock contracts on `BITGET_FUTURE`, `BINANCE_FUTURE`, `INFOWAYSTOCK`, `ITICK` or `HYPERLIQUID` | Probed | P1 |

The doc's formula says spot exchanges, and the wire lists futures venues as sources on hundreds of contracts, including MEXC's own perpetual.
A contract whose only source is `MEXC_FUTURE` has the self index shape of [`../../research/2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
Whether `MEXC_FUTURE` means MEXC's perpetual book on the same contract is `Not verified`, because no doc defines the source names.

### Mark

| item | value | label | source |
|---|---|---|---|
| Formula | "Fair Price = Median (Funding Rate Premium, Mid-Price Basis Fair Price, Last Price)" | Published | S9, S8 |
| Funding rate premium | "Index Price × [1 + Latest Funding Rate × (Hours Until Next Funding Settlement / Funding Settlement Period in Hours)]" | Published | S9 |
| Mid-price basis | the index price plus a moving average over a "Specified Period" of the basis, where the basis is the mid of best bid and best ask minus the index price | Published | S9 |
| Moving average window | not given | Not publicly specified | S9 |
| Use | "The fair price only affects liquidation price and unrealized PNL. It does not affect realized PNL." | Published | S8 |
| Clamp field | `priceCoefficientVariation`, documented as "Fair price deviation coefficient from index price" | Published | S3 |
| Values of that field | 0.4 on 981 contracts, 0.1 on 107, 0.05 on 47, 0.2 on 41, 0.004 on 8, at 07:10, and 0.4 on 982, 0.2 on 123, 0.05 on 45, 0.1 on 26, 0.004 on 8 at 19:01 | Dynamic, Probed | P1, P7 |
| Clamp observed | `STANDARD_USDT` read a mark premium of +4.9956 % against a field of 0.05, a ratio of 0.999, while its book mid sat at +5.595 %, and no other contract exceeded a ratio of 0.651. At 19:01 no contract exceeded 0.26 | Probed | P3, P7 |

The median of three with a last price term means a mark can follow the last trade.
The one observation of `STANDARD_USDT` is consistent with a clamp of the mark to index × (1 ± `priceCoefficientVariation`), and MEXC does not document it as a clamp, so it is labelled an inference from one reading.
A capped mark reads a capped leg as fresh, which is the failure named in the design, so the later design should treat a mark premium at the field's bound as saturated.

### Funding

| item | value | label | source |
|---|---|---|---|
| Formula | "Funding Rate = Interest Rate + Clamped Premium Index (range: −0.05% to +0.05%)", and the worked example clamps a 0.1 % premium to 0.05 % | Published | S10 |
| Cap and floor | per contract `maxFundingRate` and `minFundingRate`, distribution in [`./fees.md`](./fees.md) section 6 | Probed | P3 |
| Intervals | 1, 2, 4, 8 and 24 hours in use, per contract | Probed | P3 |
| Settlement instant | 8 hour contracts at 00:00, 08:00 and 16:00, "may vary by Futures trading pair" | Published | S11 |
| Batch delay | up to 15 s after the instant | Published | S11 |
| Unit | fraction per interval | Probed | P3 |

The published rate is a live estimate for the upcoming settlement, and it keeps moving until the instant.
BTC_USDT last settled at 00:00 at 0.000035 per the history call, while the bulk call showed 0.000067 at 06:59, 0.000071 at 07:12 and 0.000072 at 07:13 for the 08:00 settlement.
RIF_USDT last settled at 04:00 at -0.00013, while the bulk call showed 0.00005 for 08:00.
The history call read at 18:53 shows that the 08:00 settlement of BTC_USDT charged 0.000062, not the 0.000072 displayed at 07:13.
At 18:53 BTC_USDT had settled 0.000098 at 16:00, and the bulk call showed 0.000081 for 00:00.
The history call is `GET /api/v1/contract/funding_rate/history?symbol=BTC_USDT&page_num=1&page_size=3`, documented at "20 times / 2 seconds", see S12.

### How often each number changed

60 polls one second apart, 07:12:31 to 07:13:31, 59 transitions each.

| contract | bulk funding call: index / mark / rate changes | bulk ticker call: index / mark / rate changes |
|---|---|---|
| BTC_USDT | 26 / 42 / 1 | 14 / 16 / 1 |
| ETH_USDT | 37 / 40 / 1 | 16 / 18 / 1 |
| BTC_USD, inverse | 20 / 24 / 1 | 12 / 12 / 1 |
| RIF_USDT, thin | 1 / 5 / 0 | 1 / 4 / 0 |
| CSPR_USDT, thin | 3 / 2 / 1 | 1 / 1 / 1 |

A rerun at 18:53 to 18:54 counted 59 / 49 / 0 on BTC_USDT and 59 / 50 / 0 on ETH_USDT on the funding call, and 17 / 17 / 0 on both on the ticker call.
The funding call republishes index and mark close to once a second on liquid contracts, and the ticker call about every three to four seconds.
The funding rate changed once a minute or less on every tracked contract.
`CSPR_USDT` moved from its cap of +0.0002 to -0.000143 in one step, so a rate at a ±0.02 % cap can flip sign between two readings a minute apart.

## 5. REST book snapshot

```text
GET https://api.mexc.com/api/v1/contract/depth/{symbol}?limit={n}
```

| item | value | label | source |
|---|---|---|---|
| Documented limit | "10 times / 2 seconds" in the current docs, "20 times /2 seconds" in the older docs | Published | S13, S4 |
| Level shape | `[price, contracts, order count]`, JSON numbers | Probed | P4 |
| `limit` omitted | 1,500 bids and 1,500 asks on BTC_USDT, 43,189 bytes | Probed | P4 |
| `limit` 5, 20, 100, 1000 | honoured exactly | Probed | P4 |
| Level order | bids strictly descending, asks strictly ascending, on every read | Probed | P4 |
| Sequence | `version`, the same counter as the socket's `version`, `begin` and `end` | Probed | [`./websocket.md`](./websocket.md) section 4 |
| Timestamp | `timestamp` Unix ms, and `cts` is `null` on REST | Probed | P4 |
| Caching | `cache-control: max-age=0, no-cache, no-store`, `x-cache: NotCacheable from child` | Probed | P4 |
| Symbol case | `btc_usdt` answered with the BTC_USDT book, `BTCUSDT` answered code 1001 | Probed | P6 |

The REST book can be served stale even though it is marked not cacheable.
Five reads of RIF_USDT one second apart returned the same `version` and `timestamp` twice in a row, and a later read carried an older `timestamp` than the read before it, 07:09:18.820 after 07:09:19.497.
The rerun at 18:55 again returned version 5220578270 on two reads one second apart, with timestamps 1 ms apart.
In one morning socket run, 16 REST reads of BTC_USDT and ETH_USDT arrived 1 to 415 versions behind the socket's book, and 3 of them 247 or more.
In the 18:52 run the `ETH_USDT` seed arrived 391 versions behind the newest delta.
A seed taken from REST must therefore be checked against the first buffered delta, as section 8 of [`./websocket.md`](./websocket.md) describes.

The documented recovery call returns the most recent level changes, newest first.

```text
GET https://api.mexc.com/api/v1/contract/depth_commits/BTC_USDT/20
```

It returned 20 entries, each `{cts, asks, bids, version}` with one changed level, from version 41770686747 down to 41770686728, in 1,439 bytes.

## 6. Rate limits, status codes and errors

| item | value | label | source |
|---|---|---|---|
| Limits per endpoint | ping, funding rate, funding history and depth commits "20 times / 2 seconds", ticker, depth and contract detail "10 times / 2 seconds" | Published | S3, S5, S7, S12, S13, S14, S16 |
| Scope of a limit | per IP, per account or per key is not stated | Not publicly specified | S3 |
| Rate limit headers | none on any reply from either host | Probed | P5 |
| `Retry-After` | never seen, and not documented | Probed | P5 |
| Documented limit error | code 510, "Requests are too frequent, please try again later" | Published | S15 |
| HTTP status for code 510 | not documented, and not triggered on purpose | Not publicly specified | S15 |
| CCXT's reading | maps both HTTP 429 and code 510 to `RateLimitExceeded` | `server/node_modules/ccxt/js/src/mexc.js` lines 927 and 932 |
| Unknown symbol | HTTP 200 with `{"success":false,"code":1001,"message":"Contract does not exist"}` on depth, funding rate, index price, ticker and detail | Probed | P6 |
| Delisted symbol | detail code 1001 "Contract not exists", depth success with an empty frozen book | Probed | section 2 |
| Error envelope | `{"success": false, "code": <int>, "message": <string>}` | Published, Probed | S1, P6 |

[`../../../server/src/shared/errors.ts`](../../../server/src/shared/errors.ts) line 1 pauses only on HTTP 403, 418 and 429.
A MEXC error with HTTP 200 and `success` false would not pause the poller, so a later poller has to check `success` and `code` itself.

## 7. Server time and clock offset

`GET https://api.mexc.com/api/v1/contract/ping` returns `{"success":true,"code":0,"data":<Unix ms>}`, documented at "20 times / 2 seconds", see S14.
Ten pings one second apart at 07:13 gave offsets of 6, 4, 5, 5, 4, 4, 4, 4, -1 and 21 ms, server minus the local midpoint.
The shortest round trip, 113 ms, gave +5.5 ms, so the server clock ran about 5 ms ahead of this host at 07:13.
The rerun at 18:52 gave offsets of -46 to -56 ms, and its shortest round trip, 109 ms, gave -54.5 ms.
So the offset moved by about 60 ms within the day, and whether the host clock or the server moved was not checked.

## 8. Recommended poller shape

These are recommendations for a later design, not decisions.

| item | recommendation | reason |
|---|---|---|
| URL | `https://api.mexc.com/api/v1/contract/funding_rate`, one call for every family | section 3 |
| Interval | the default 1 s | 138 ms median round trip, 20 KB on the wire, index and mark republished near once a second, a limit of 20 per 2 s |
| Row mapping | `index` = `idxPrice`, `mark` = `fairPrice`, `fundingRate` = `fundingRate`, `fundingIntervalHours` = `collectCycle`, `nextFundingAt` = `nextSettleTime`, keyed by `symbol` | section 3 |
| Reply check | throw when `success` is not true or `code` is not 0, and treat code 510 as rate limited | section 6 |
| Rate limit pause | the default 60 s, since no `Retry-After` is sent | section 6 |
| Rows to skip | rows whose `symbol` is not a tracked `rawMarketId`, which covers the 8 extra rows | section 2 |
| Mark saturation | flag a leg whose `fairPrice / idxPrice − 1` sits at `priceCoefficientVariation` from the catalog | section 4 |
| Self index | consider refusing contracts whose `indexOrigin` is only `MEXC_FUTURE` or only `MEXC` | section 4 |
| Not to use | the bulk ticker, which republishes every three to four seconds and lacks interval and next settlement | section 4 |

A sketch of the mapping, for the later design.

```ts
for (const r of reply.data) {
  rows.set(r.symbol, {
    index: r.idxPrice,
    mark: r.fairPrice,
    fundingRate: r.fundingRate,
    fundingIntervalHours: r.collectCycle,
    nextFundingAt: r.nextSettleTime,
  });
}
```

## Conflicts between documents and the wire

- The domain announcement retired `contract.mexc.com` from 2026-01-19, and the host still answered every public call on 2026-09-15.
  The wire is what a poller must handle, and `api.mexc.com` is the documented host.
- The current docs name the catalog `GET /api/v1/contract/detail/country` and CCXT calls `GET /api/v1/contract/detail`.
  Both answered the same list.
- The current docs give the depth call "10 times / 2 seconds" and the older docs "20 times /2 seconds".
  The lower number is the safe one.
- The docs describe `type` 2 as "suspended", and 425 contracts with `type` 2 carried live books and tickers.
- The current depth docs describe `[411.8, 10, 1]` with "10 is the order numbers of the contract ,1 is the order quantity", and the older docs with "10 is the volume of contracts for this price, 1 is the order quantity".
  The wire matches the older reading, contracts then order count, proven by the rebuilt book in [`./websocket.md`](./websocket.md) section 4.
- The index FAQ describes a basket of spot exchanges, and `indexOrigin` lists futures venues, including `MEXC_FUTURE`, on 252 contracts.

## 9. Source ledger

Retrieved 2026-09-15.
Pages on `www.mexc.com` were read with WebFetch, because that host answered `curl` from this machine with HTTP 403.

| id | title | URL | entity or region | sections supported |
|---|---|---|---|---|
| S1 | Integration guide, MEXC Futures API | https://www.mexc.com/api-docs/futures/integration-guide | MEXC, global | 6 |
| S2 | Futures API Access Domain Update | https://www.mexc.com/announcements/article/futures-api-access-domain-update-17827791532974 | MEXC, global | 1 |
| S3 | Get Contract Info | https://www.mexc.com/api-docs/futures/market-endpoints/get-contract-info | MEXC, global | 2, 4, 6 |
| S4 | MXC Contract API, older docs | https://mexcdevelop.github.io/apidocs/contract_v1_en/ | MEXC, global | 2, 5 |
| S5 | Get Funding Rate | https://www.mexc.com/api-docs/futures/market-endpoints/get-funding-rate | MEXC, global | 3, 6 |
| S6 | Futures API update log | https://www.mexc.com/api-docs/futures/update-log | MEXC, global | 3 |
| S7 | Get Ticker (Contract Market Data) | https://www.mexc.com/api-docs/futures/market-endpoints/get-ticker-contract-market-data | MEXC, global | 3, 6 |
| S8 | FAQ on Index Price, Fair Price, and Last Price | https://www.mexc.com/support/article/faq-on-index-price-fair-price-and-last-price-7950960183961 | MEXC, global, page dated 2026-02-16 | 4 |
| S9 | BTCUSDT Futures Fair Price and Market Price Calculation | https://www.mexc.com/futures/information/fair_price | MEXC, global | 4 |
| S10 | BTCUSDT Futures Funding Rate History & Updates | https://www.mexc.com/futures/information/funding_list/BTC_USDT | MEXC, global | 4 |
| S11 | MEXC Futures Funding Rate: Calculation Methods and How to View Funding Rates | https://www.mexc.com/support/article/mexc-futures-funding-rate-305432020820705280 | MEXC, global, page dated 2026-06-01 | 4 |
| S12 | Get Funding Rate History | https://www.mexc.com/api-docs/futures/market-endpoints/get-funding-rate-history | MEXC, global | 4, 6 |
| S13 | Get Contract Order Book Depth | https://www.mexc.com/api-docs/futures/market-endpoints/get-contract-order-book-depth | MEXC, global | 5, 6 |
| S14 | Get Server Time | https://www.mexc.com/api-docs/futures/market-endpoints/get-server-time | MEXC, global | 6, 7 |
| S15 | Error Codes, MEXC Futures API | https://www.mexc.com/api-docs/futures/error-code | MEXC, global | 6 |
| S16 | Get the Last N Depth Snapshots | https://www.mexc.com/api-docs/futures/market-endpoints/get-the-last-n-depth-snapshots | MEXC, global | 5, 6 |

| id | probe | observation |
|---|---|---|
| P1 | `curl --compressed https://contract.mexc.com/api/v1/contract/detail` at 06:59 and the same on `api.mexc.com` at 07:10 | catalog fields, `indexOrigin`, `priceCoefficientVariation`, delistings |
| P2 | `mexc-rest-probe.mjs catalog` at 07:09 | CCXT counts, mapped fields, id match against the bulk funding reply |
| P3 | `mexc-rest-probe.mjs anchor` at 07:12 to 07:14 | 60 polls, change counts, history, caps, intervals |
| P4 | `mexc-rest-probe.mjs book` at 07:09 | depth limits, order, repeats, depth commits |
| P5 | `mexc-rest-probe.mjs host` at 07:11 to 07:13 | DNS, latency, bytes, headers, clock |
| P6 | `mexc-rest-probe.mjs errors` at 07:09 | unknown symbols and symbol case |
| P7 | `mexc-rest-probe.mjs` with every default section, rerun at 18:52 to 18:56, and `curl` of the catalog and bulk funding calls at 19:01 | the second readings named in sections 1 to 7 |
