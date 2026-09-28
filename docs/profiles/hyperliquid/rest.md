# Hyperliquid REST Profile

**Status:** Done.

**Retrieved:** 2026-09-23.

**Probed:** 2026-09-23 in the local evening, which is 2026-09-24 from 06:33 to 06:50 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that geolocates to Canada.

This profile covers the public info API of Hyperliquid (CCXT id `hyperliquid`) that a catalog, an anchor poller and a book resync would use.
It covers the validator-operated perpetuals, which the API calls the first perp dex, and the builder-deployed HIP-3 perp dexes.
Every call is `POST https://api.hyperliquid.xyz/info` with a JSON body naming a `type`, and nothing here signs or calls `/exchange`.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/hyperliquid/rest-probe.mjs), run from `server/`.
P1 is the first run of each mode, from 06:33 to 06:37 UTC, and P2 is the rerun, from 06:38 to 06:50 UTC.
The probe held itself to 600 weight in any rolling minute, half the published budget, because the other Hyperliquid probes shared the address.
Where the documentation and the wire disagree, both are written.
The TypeScript server this profile cites sat under [`old_ts_server/`](../../../old_ts_server/) when it was written, and the research plan places it under `server/ts/`.
Fees and who may trade are in [`fees.md`](./fees.md), the socket in [[`./websocket.md`](./websocket.md)](./websocket.md), and HyperCore blocks and the HIP-3 oracles in [[`../../research/2026-09-23-hyperliquid-dex.md`](../../research/2026-09-23-hyperliquid-dex.md)](../../research/2026-09-23-hyperliquid-dex.md).

## 1. Host and latency from this machine

| host | role | resolved on 2026-09-24 UTC | edge |
|---|---|---|---|
| `api.hyperliquid.xyz` | info and exchange API, S1 | four A records, `3.175.64.60`, `3.175.64.74`, `3.175.64.84`, `3.175.64.89`, and no CNAME | CloudFront: `via: 1.1 ….cloudfront.net (CloudFront)`, `x-amz-cf-pop: YVR52-P3`, `server: nginx/1.22.1`, `x-cache: Miss from cloudfront` |

The edge is a CloudFront point of presence in Vancouver, which fits the Canadian exit.
Where the origin runs is not visible from here.
Every public call answered, and no reply was a refusal or a geoblock.

Latency, one Node process per mode, with a kept connection after the first request.

| call | weight, S3 | one request ms, P1 and P2 | repeated requests ms | reply bytes |
|---|---:|---:|---|---:|
| `exchangeStatus` | 2 | 157 and 316, each the first request of its process, with DNS and TLS | ten each run: min 104, median 110, max 131 in P1, and medians 108 and 119, max 167 and 244 in P2 | 45 |
| `meta` | 20 | 296 and 255 | | 17,628 |
| `perpDexs` | 20 | 142 | | 20,981 |
| `allPerpMetas` | 20 | 208, 208 and 234 | | 81,202 |
| `spotMeta` | 20 | 206 and 115 | | 136,567 |
| `metaAndAssetCtxs`, first dex | 20 | 367 and 292 | 30 polls a run: min 115, median 285, p90 341, max 464 in P1, and min 107, median 279, p90 328, max 683 in P2 | 72,160 to 72,412 |
| `metaAndAssetCtxs` per HIP-3 dex | 20 | 104 to 284 in P1, 104 to 193 in P2 | | 537 (`abcd`) to 55,923 (`xyz`) |
| `predictedFundings` | 20 | 235 and 257 | | 64,002 and 63,997 |
| `fundingHistory`, 24 h | 20, plus 1 per 20 rows | 106 to 194 | | 2,124 (`BTC`) and 2,315 (`xyz:XYZ100`) |
| `l2Book` | 2 | 92 to 155 | | 1,440 to 1,730 |

No reply was compressed.
Node's `fetch` sends `accept-encoding`, and `curl --compressed` on `metaAndAssetCtxs` got `Content-Length: 72336` with no `content-encoding` in 0.295 s.
The first-dex bulk call takes about 170 ms more than `exchangeStatus` over the same connection, which most likely is the server building the reply.
No reply took over 2 s, so the reader's 5 s skew and 10 s age limits at [`anchorReading.ts`](../../../old_ts_server/src/engine/opportunity/anchorReading.ts) lines 4 and 5 are not at risk from this host.

## 2. Catalog

### The instruments calls

| call | body | returns |
|---|---|---|
| `meta` | `{"type":"meta"}`, `dex` defaults to `""`, the first perp dex, S2 | `{universe, marginTables, collateralToken}` |
| `perpDexs` | `{"type":"perpDexs"}` | `[null, {name, …}, …]`, entry 0 standing for the first dex |
| `allPerpMetas` | `{"type":"allPerpMetas"}` | one `meta` object per dex, in `perpDexs` order |
| `metaAndAssetCtxs` | `{"type":"metaAndAssetCtxs","dex":"xyz"}` | `[meta, ctxs]`, see section 3 |
| `spotMeta` | `{"type":"spotMeta"}` | spot pairs and tokens, used here only to name collateral tokens |

S2's `allPerpMetas` example shows each entry as `[meta, ctxs]`.
On the wire each of the 11 entries was a plain object with the keys `universe`, `marginTables` and `collateralToken`, and it carried no contexts, in P1 and P2.
So `allPerpMetas` replaces one `meta` call per dex for the catalog, and it does not replace `metaAndAssetCtxs` for the anchor.
Its universes matched each dex's own `metaAndAssetCtxs` universe name for name on 10 of 10 builder dexes in both runs.

### The first dex

| item | value, P1 and P2 alike |
|---|---|
| assets | 234 |
| `isDelisted: true` | 56, among them `MATIC`, `RNDR`, `FTM`, `MKR`, `LOOM` and `TON`. The key is present only when true |
| live assets | 178 |
| fields | `name`, `szDecimals`, `maxLeverage` and `marginTableId` on 234, `onlyIsolated` and `marginMode` (`strictIsolated`) on 8 |
| `szDecimals` | 0 on 134, 1 on 66, 2 on 24, 3 on 6, 4 on 2, 5 on 2 |
| `maxLeverage` | 3 on 130, 5 on 63, 10 on 35, 20 on 4, 25 on 1 (`ETH`), 40 on 1 (`BTC`) |
| `collateralToken` | 0, which `spotMeta` names `USDC` |
| names priced per 1,000 tokens | `kPEPE`, `kSHIB`, `kBONK`, `kLUNC`, `kFLOKI`, `kDOGS` (delisted) and `kNEIRO` |
| names that are not ASCII | none |

A perp is keyed by its `name` everywhere in the info API and on the socket, S1 and S11.
Order actions use an integer asset id instead, which is the index in `meta` on the first dex and `100000 + perp_dex_index * 10000 + index_in_meta` on a builder dex, S10.

### Builder-deployed dexes

`perpDexs` listed 10 builder dexes in both runs, each with `name`, `fullName`, `deployer`, `oracleUpdater`, `feeRecipient`, `assetToStreamingOiCap`, `subDeployers`, `assetToFundingMultiplier`, `assetToFundingInterestRate` and `assetToFundingClamp`.
S2's example shows neither `subDeployers`, `assetToFundingInterestRate` nor `assetToFundingClamp`.
A builder dex names every asset `{dex}:{coin}`, for example `xyz:TSLA`, S10.

| dex | `fullName` | collateral | assets | delisted | live | CCXT loads it |
|---|---|---|---:|---:|---:|---|
| `xyz` | XYZ | 0 `USDC` | 124 | 15 | 109 | yes |
| `flx` | Felix Exchange | 360 `USDH` | 16 | 16 | 0 | yes, all inactive |
| `vntl` | Ventuals | 360 `USDH` | 15 | 15 | 0 | yes, all inactive |
| `hyna` | HyENA | 235 `USDE` | 25 | 25 | 0 | yes, all inactive |
| `km` | Markets by Kinetiq | 360 `USDH` | 23 | 23 | 0 | yes, all inactive |
| `abcd` | ABCDEx | 0 `USDC` | 1 | 1 | 0 | yes, all inactive |
| `cash` | dreamcash | 268 `USDT0` | 17 | 17 | 0 | yes, all inactive |
| `para` | Paragon | 0 `USDC` | 36 | 9 | 27 | yes |
| `mkts` | Markets By Kinetiq | 0 `USDC` | 24 | 20 | 4 | yes |
| `io` | EntropyIO | 0 `USDC` | 10 | 2 | 8 | no |

The builder dexes held 291 assets, 143 delisted and 148 live.
Six dexes were wholly delisted, and their contexts still carry a `markPx` and `oraclePx` with `midPx` null, for example `hyna:BTC` at mark 76,888 against the first dex's `BTC` near 84,150.
Which HIP-3 assets could join a cluster, and whose oracle each one follows, is the subject of [[`../../research/2026-09-23-hyperliquid-dex.md`](../../research/2026-09-23-hyperliquid-dex.md)](../../research/2026-09-23-hyperliquid-dex.md).

### How CCXT 4.5.68 maps it

| item | value | evidence in `server/node_modules/ccxt/js/src/hyperliquid.js` |
|---|---|---|
| calls | `spotMetaAndAssetCtxs`, `metaAndAssetCtxs`, `perpDexs`, then `metaAndAssetCtxs` per builder dex, plus `spotMeta` for currencies | `fetchMarkets` types at line 247 and lines 522 to 545, `fetchCurrencies` at line 439 |
| builder dexes loaded | the first 9 of `perpDexs`, because `hip3.limit` is 10 and the loop runs from 1 below it | lines 249, 588 and 597 |
| `market.id` | `baseId`, the asset index as a string: `"0"` for `BTC`, `"110000"` for `xyz:XYZ100` | lines 737, 581, 633 and 1023 |
| `base` | `name` uppercased, with `:` replaced by `-`: `KPEPE`, `XYZ-XYZ100` | line 994 |
| `quote`, `settle` | the dex collateral name, else `USDC` | lines 968 to 970 |
| `linear` | the literal `true` | line 1040 |
| `contractSize` | the literal `1` | line 1044 |
| `active` | `!isDelisted` | lines 1017 to 1020 |
| `taker` | `fees.swap.taker`, the literal `0.00045` | lines 184 and 1007, see [`fees.md`](./fees.md) section 8 |
| pacing | `rateLimit` 50 ms times an info cost of 20 is one call per second, so `loadMarkets` took 12.5 s in P1 and 12.7 s in P2 | lines 27, 163 and 4906 |

Probed through the connector's filter, `type` swap, `swap` true and `active !== false`, at [`connector.ts`](../../../old_ts_server/src/ccxt/connector.ts) lines 196 to 203:

| result | P1 and P2 alike |
|---|---|
| markets | 818: 303 spot and 515 swap |
| active swaps | 318: 178 on the first dex and 140 HIP-3 (`xyz` 109, `para` 27, `mkts` 4) |
| inactive swaps | 197, the 56 delisted first-dex assets and 141 delisted HIP-3 assets |
| `io` markets | 0, although 8 are live |
| `market.id` equal to `info.name` | 0 of 318, and 318 of 318 are numeric |
| `quote`, `settle`, `linear`, `contractSize`, `taker` | `USDC`, `USDC`, true, 1 and 0.00045 on 318 of 318 |
| pairs listed twice | 0 |

### What the catalog needs changed

- The connector copies `market.id` into `rawMarketId`, at [`connector.ts`](../../../old_ts_server/src/ccxt/connector.ts) line 170.
  On Hyperliquid that is the numeric asset index, while the info replies and the socket key everything by `name`.
  Hyperliquid needs `rawMarketId` from `market.info.name`, or no anchor row and no book would ever match a market.
- Book sizes are coins of the underlying, because a contract is "1 unit of underlying spot asset", S7, and `l2Book` on `BTC` returned sizes such as `13.2533`.
  CCXT's `contractSize` of 1 is therefore right.
- The oracle is "denominated in USDT, but the collateral is USDC", so the perps are quanto contracts, S7.
  Only `PURR` and `HYPE` have USDC-denominated oracles.
  The quote family already folds USDC and USDT into one pair, so CCXT's `USDC` quote needs no change.
- One unit of each of the six live `k` names is 1,000 tokens, so price and size are both per 1,000: `kPEPE` read 0.004409 per unit and its book sizes are in `kPEPE`.
  CCXT's `KPEPE` clusters with nothing, as on Backpack, see [`../backpack/rest.md`](../backpack/rest.md) line 74.
  Renaming the base to `1000PEPE` would join other venues' `1000PEPE` contracts without a price scale, see [`../phemex/rest.md`](../phemex/rest.md) lines 65 and 66.
- HIP-3 bases such as `XYZ-TSLA` cluster with nothing either, which is safe by default and hides those markets from the engine.
- The `io` dex is not loaded at CCXT's default limit, so a HIP-3 catalog needs `options.fetchMarkets.hip3.dexes` set explicitly or the limit raised.

## 3. Anchor

### The bulk calls

| call | index | mark | funding rate | interval | next settlement | reply | time |
|---|---|---|---|---|---|---|---|
| `metaAndAssetCtxs`, first dex | `oraclePx` | `markPx` | `funding` | absent | absent | 72.2 KB, 234 rows | 30 polls a run, median 285 and 279 ms, max 464 and 683 ms |
| `metaAndAssetCtxs` with `dex` | same fields | | | | | 0.5 to 55.9 KB per dex | 104 to 284 ms |
| `predictedFundings`, first dex only, S2 | | | `HlPerp` `fundingRate` | `fundingIntervalHours` | `nextFundingTime`, see below | 64 KB, 234 coins | 235 and 257 ms |
| `allPerpMetas` | none, it carries no contexts | | | | | 81 KB | 208 to 234 ms |

`metaAndAssetCtxs` returns `[meta, ctxs]`, and `ctxs[i]` belongs to `meta.universe[i]`, because a context carries no name.
The universe order equalled `meta`'s on 234 of 234 in both runs.
Every context carried `funding`, `openInterest`, `prevDayPx`, `dayNtlVlm`, `premium`, `oraclePx`, `markPx`, `midPx`, `impactPxs` and `dayBaseVlm`.
On the 56 delisted assets `midPx`, `impactPxs` and `premium` were null, `funding` and `openInterest` were `"0.0"`, and the mark and oracle held the same values in both catalog runs, for example `MATIC` at oracle 0.3754 and mark 0.37621.
No live row had a zero or null `oraclePx` or `markPx`.

Each call weighs 20, S3, so one call a second on one dex is 1,200 weight a minute, which is the whole budget of the address.

### Row mapping

| `AnchorRow` column | field | unit on the wire | conversion |
|---|---|---|---|
| key | `meta.universe[i].name` | string, `BTC` or `xyz:XYZ100` | join by index |
| `index` | `oraclePx` | decimal string | `Number()` |
| `mark` | `markPx` | decimal string, never 0 on a live row | `Number()` |
| `fundingRate` | `funding` | a fraction per hour: `"0.0000125"` is 0.00125 % | `Number()` |
| `fundingIntervalHours` | none in the context | the constant 1, S6. `predictedFundings` said 1 on 234 of 234 | 1 |
| `nextFundingAt` | none in the context | the next whole UTC hour | `(Math.floor(ts / 3_600_000) + 1) * 3_600_000` |

`predictedFundings` gave `HlPerp` `nextFundingTime` `1790229600000`, 06:00 UTC, on 234 of 234 coins at 06:36 and again at 06:40 UTC.
That is the settlement that had already happened, while the next one was 07:00, so it must not be used as `nextFundingAt`.
Its `BinPerp` and `BybitPerp` rows for `BTC` named 08:00 UTC, which is the next 8 hour settlement on those venues.
The floor-plus-one form keeps a poll that lands exactly on the hour pointing at the next settlement, because settlements landed 1 to 118 ms after the hour, see section 4.
On a builder dex `funding` already includes the deployer's multiplier: `xyz` read `0.00000625`, half the interest-only rate, on 30 and 32 live assets.

## 4. Anchor semantics

### Index, the oracle

S4 is the formula of record.

> The validators are responsible for publishing spot oracle prices for each perp asset every 3 seconds.
> The spot oracle prices are computed by each validator as the weighted median of Binance, OKX, Bybit, Kraken, Kucoin, Gate IO, MEXC, and Hyperliquid spot mid prices for each asset, with weights 3, 2, 2, 1, 1, 1, 1, 1 respectively.

The final oracle is "the weighted median of each validator's submitted oracle prices, where the validators are weighted by their stake", S4.
An asset whose primary spot liquidity is on Hyperliquid, such as `HYPE`, uses no external source "until sufficient liquidity is met", and an asset whose liquidity is elsewhere, such as `BTC`, excludes Hyperliquid spot, S4.
So the first dex's index never contains its own perp.
`HYPE`'s index uses only Hyperliquid's own spot book until its external liquidity counts as sufficient, and no call reports which state it is in.
No documented info call returns which of the eight venues list a given asset, so the per-asset basket is Not publicly specified.

Two other oracle shapes exist.
A hyperp's oracle is "an 8 hour exponentially weighted moving average of the last day's minutely mark prices", capped at 4 times the initial mark, S12, which is the self-index shape of [`2026-09-15-one-self-index-fresh-gate.md`](../../research/2026-09-15-one-self-index-fresh-gate.md).
No info call read here flags a hyperp: `perpCategories` and `perpConciseAnnotations` returned 206 entries each with categories such as `crypto`, `stocks` and `preipo`, and none mentioned a hyperp or pre-launch, in both runs of the `hyperps` mode.
The same mode read the first dex twice 20 s apart, and 14 of 138 and then 21 of 157 live assets whose mark moved kept the same oracle.
A quiet asset on the 3 s oracle does the same, so that check could not single out a hyperp either.
A builder dex's oracle is whatever its `oracleUpdater` posts with `setOracle`, at most once per 2.5 s and expected every 3 s, S8.

On the wire the oracle ticked on 10 of 29 poll-to-poll transitions in each run, at gaps of 3, 3, 4, 2, 3, 3, 3, 3 and 3 polls in P1 and 2, 4, 3, 3, 3, 3, 4, 3 and 2 in P2.
Each tick moved 31.5 % to 77.5 % of the 178 live assets at once, and the polls between ticks moved none.
So validators republish about every 3 s, as documented, and a quiet asset can keep its oracle through several ticks.
Oracle strings never had more than `6 - szDecimals` decimals over 5,340 asset-polls in P2, while 690 of them had more than 5 significant figures, for example `SOL` at 115.035.

### Mark

S5 is the formula of record for the first dex.

> Mark price is the median of the following prices:
> 1. Oracle price plus a 150 second exponential moving average (EMA) of the difference between Hyperliquid's mid price and the oracle price
> 2. The median of best bid, best ask, last trade on Hyperliquid
> 3. Median of Binance, OKX, Bybit, Gate IO, MEXC perp mid prices with weights 3, 2, 2, 1, 1, respectively

If exactly two of the three exist, "the 30 second EMA of the median of best bid, best ask, and last trade on Hyperliquid is also added to the median inputs", S5.
The EMA updates as `numerator * exp(-t / 2.5 minutes) + sample * t` over `denominator * exp(-t / 2.5 minutes) + t`, S5.
"Mark price is updated whenever validators publish new oracle prices", S5.

| clamp | documented | probed |
|---|---|---|
| first dex, mark against oracle | none published, the median of three inputs is the only bound | on the last poll of each run, the median distance was 594 and 602 ppm, p90 1,814 and 1,820, max 5,945 and 6,945 ppm |
| first dex, cadence | with the oracle, about every 3 s | `markPx` changed on exactly the polls where the oracle ticked, in both runs |
| hyperp | "capped at 3x the 8-hour mark price EMA", and at "1.5x the median external perp price" when one exists, S12 | |
| builder dex, inputs | the median of the deployer's `markPxs`, 0 to 2 lists, and the local mark median of best bid, best ask and last trade, S8 | |
| builder dex, step | "markPx moves are clamped to 1% from previous markPx", S8 | |
| builder dex, range | "All prices are clamped to 10x the start of day value", S8 | |
| builder dex, staleness | "Stale mark prices will be updated to the local mark price after 10 seconds of no updates", S8 | |

Input 3 means the first-dex mark leans on the Binance, OKX, Bybit, Gate and MEXC perpetual books, so a route between Hyperliquid and one of those venues compares a book against a mark partly built from the other leg's venue.
By the formula, when only Hyperliquid's book moves, inputs 1 and 3 hold the median, so the move shows as a gap between Hyperliquid's book and its mark.
The mark sat on the mid on quiet books: 28 of 30 polls on `NOT`, 11 on `kPEPE`, 5 on `DOGE` and 0 on `BTC` in P1.

Two properties matter to the open guard at [`anchorReading.ts`](../../../old_ts_server/src/engine/opportunity/anchorReading.ts) line 6, which refuses an index or mark that moved more than 1,000 ppm in one poll.
A 1 s poll sees a whole 3 s move in one step, and P2 counted 14 of 5,162 live asset transitions over 1,000 ppm, on 11 assets, the largest 4,199 ppm.
The price grid is coarse on cheap assets: the oracle and mark step is `10^-(6 - szDecimals)`, S9, which was under 1 ppm to 5,747 ppm of the price, median 19 ppm, and over 100 ppm on 39 of 178 live assets.
On `HMSTR` (5,747 ppm), `NOT` (2,119), `MEME` (1,647) and `XAI` (1,245) a single step exceeds the guard, and `MEME` and `XAI` were among P2's 11.
The book tick adds the 5 significant figure rule, median 43 ppm, and the same four assets exceed 1,000 ppm.

### Funding

S6 is the formula of record, and [`fees.md`](./fees.md) section 6 treats funding as a cost.

```text
Funding Rate (F) = Average Premium Index (P) + clamp (interest rate - Premium Index (P), -0.0005, 0.0005)
premium = impact_price_difference / oracle_price
impact_price_difference = max(impact_bid_px - oracle_px, 0) - max(oracle_px - impact_ask_px, 0)
HIP-3 perps: premium = (0.5 * (impact_bid_px + impact_ask_px) / oracle_px) - 1
```

The formula is an 8 hour rate, paid every hour "at one eighth of the computed rate", the premium is "sampled every 5 seconds and averaged over the hour", and funding "is capped at 4%/hour" for every asset, S6.
The interest term is 0.01 % per 8 hours, and the impact notional is 20,000 USDC for `BTC` and `ETH` and 6,000 USDC for other assets, S6 and S7.
A builder dex sets per asset a multiplier from 0 to 10, an 8 hour interest rate from -0.01 to 0.01, and an 8 hour clamp from 0 to 0.01 that "Defaults to 0.0003", S8.

| check | P1 | P2 |
|---|---|---|
| context `premium` against the impact formula on the same row | 178 of 178 within 5e-8 | 178 of 178 |
| `BTC` settled rows over 24 h equal to `(P + clamp(0.0001 - P, ±0.0005)) / 8`, with the row's own `premium` | 24 of 24 | 24 of 24 |
| `xyz:XYZ100` settled rows equal to `0.5 × (P + clamp(0.0001 - P, ±0.0003)) / 8` | not run | 24 of 24 |
| live assets at exactly `"0.0000125"`, the interest term alone | 165 of 178 | 164 of 178 |
| live assets over the 4 % cap | 0 | 0 |
| context `funding` equal to `predictedFundings` `HlPerp` | 234 of 234 | 220 of 234, because the two calls ran back to back and straddled a 5 s update, for example `BTC` `0.0000026718` against `0.0000028029` |

The `xyz:XYZ100` check used the multiplier 0.5 from `perpDexs`, and the defaults 0.0001 and 0.0003 because `xyz` lists no interest or clamp entry for that asset.
So `fundingHistory`'s `premium` is the hour's average premium in 8 hour units, and its `fundingRate` is the hourly rate actually charged.
Settled rows landed 1 to 118 ms after each whole hour, median 39 ms, on both coins.

The context `funding` is the running estimate for the coming settlement.
It changed every 5 polls in both runs, on 6.7 % to 7.9 % of live assets at a time, which matches the 5 s premium sample.
At 06:36 UTC `BTC` read `0.0000039391` while the 06:00 settlement had charged `0.0000001554`.
Whether the last estimate before the hour equals the rate charged was Not verified, because waiting for a settlement was out of scope.
`predictedFundings` also carries Binance and Bybit predicted rates for the same coins, with 24 `BinPerp` and 45 `BybitPerp` entries null, which is context and not an anchor source.

### How often each number changed

30 polls at one per second from 06:34:38 UTC in P1, counted over 29 transitions.

| coin | oracle | mark | mid | premium | funding | open interest | impact prices | mark equal to mid, of 30 polls | longest oracle hold, polls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `BTC` | 6 | 8 | 1 | 7 | 6 | 20 | 1 | 0 | 4 |
| `ETH` | 6 | 6 | 6 | 11 | 0 | 9 | 16 | 0 | 12 |
| `SOL` | 8 | 6 | 7 | 10 | 0 | 12 | 9 | 0 | 6 |
| `HYPE` | 8 | 8 | 18 | 23 | 0 | 7 | 26 | 0 | 5 |
| `kPEPE` | 3 | 3 | 8 | 6 | 0 | 2 | 15 | 11 | 17 |
| `DOGE` | 4 | 4 | 15 | 19 | 0 | 1 | 26 | 5 | 7 |
| `NOT` | 0 | 0 | 2 | 0 | 0 | 0 | 2 | 28 | no change |
| `TNSR` | 3 | 3 | 5 | 0 | 0 | 0 | 16 | 3 | 15 |

`NOT` and `TNSR` were the two live assets with the least 24 hour notional, 49,365 and 52,448 USDC.
Across all live assets, `midPx` and `premium` changed on every poll, the oracle and mark on about every third, and `funding` on every fifth, in both runs.
P2 repeated the aggregate counts, and its per coin lines were not recorded.
The republish cadence of the index and mark is therefore about 3 s, which fits the reader's 10 s age limit.

## 5. REST book snapshot

`{"type":"l2Book","coin":"BTC"}`, weight 2, "Returns at most 20 levels per side", S1.

| item | documented, S1 | probed, P1 and P2 |
|---|---|---|
| depth | at most 20 levels per side, which equals the engine's `DEPTH_LEVELS` of 20 at [`ClusterIndexBuilder.ts`](../../../old_ts_server/src/engine/cluster/ClusterIndexBuilder.ts) line 17 | 20 and 20 on `BTC`, `kPEPE`, `xyz:XYZ100`, `PURR/USDC` and `@107` |
| order | | bids descending and asks ascending on every read |
| level | `{px, sz, n}`, `n` the number of orders | strings for `px` and `sz`, integer `n` |
| aggregation | `nSigFigs` 2 to 5 or null, `mantissa` 1, 2 or 5 only with `nSigFigs` 5 | both accepted, and an aggregated reply adds a `spread` key |
| timestamp | `time` in ms | `time` trailed local arrival by 291 to 828 ms over 18 reads |
| caching | | two `BTC` reads about 0.5 s apart differed, with `time` 458 and 538 ms apart, so no edge cache showed |
| unknown coin | | HTTP 200 with body `null` |
| delisted coin | | `LOOM` returned HTTP 200 with two empty level arrays, 53 bytes |

The book has no sequence number, so a REST snapshot cannot be stitched to socket deltas by id.
The recommended feed takes its book from the socket, see [[`./websocket.md`](./websocket.md)](./websocket.md).

## 6. Rate limits and errors

| item | documented, S3 | probed |
|---|---|---|
| budget | "REST requests share an aggregated weight limit of 1200 per minute", per IP address | not reached, at no more than about 600 in any minute |
| weight 2 | `l2Book`, `allMids`, `clearinghouseState`, `orderStatus`, `spotClearinghouseState`, `exchangeStatus` | |
| weight 20 | "All other documented `info` requests", so `meta`, `metaAndAssetCtxs`, `allPerpMetas`, `perpDexs`, `predictedFundings` and `fundingHistory` | |
| weight 60 | `userRole` | |
| surcharge | one more weight per 20 items returned on `fundingHistory`, `recentTrades` and 11 other types, and per 60 on `candleSnapshot` | 24 hourly rows add 1 |
| WebSocket | 10 connections, 30 new connections a minute, 1,000 subscriptions, 2,000 messages sent a minute | see [[`./websocket.md`](./websocket.md)](./websocket.md) |
| status at the limit | Not publicly specified | Not verified, no limit was reached |
| `Retry-After` | Not publicly specified | absent on every error reply and on the `exchangeStatus` headers dumped in P1 and P2 |
| limit headers | | none among the `exchangeStatus` headers dumped in P1 and P2 |

| request | status | content type | body |
|---|---:|---|---|
| `{"type":"nope"}` | 422 | `text/plain` | `Failed to deserialize the JSON body into the target type` |
| `fundingHistory` without `startTime` | 422 | `text/plain` | same |
| `metaAndAssetCtxs` with `dex` `nope` | 500 | `application/json` | `null` |
| `fundingHistory` for coin `NOPE` | 500 | `application/json` | `null` |
| `l2Book` for coin `NOPE` | 200 | not recorded | `null` |
| body `{"type":` | 400 | `text/plain` | `Failed to parse the request body as JSON` |
| `content-type: text/plain` | 415 | `text/plain` | ``Expected request with `Content-Type: application/json` `` |
| `GET /info` | 405 | none | empty |

S13 documents only order and cancel errors, so these shapes come from the wire alone, and they held in both runs.
An unknown dex, and an unknown coin on `fundingHistory`, is a 500 with a JSON `null` rather than a 4xx, so a poller that treats 5xx as transient would keep retrying it.
The poller pauses on 403, 418 and 429 at [`AnchorPoller.ts`](../../../old_ts_server/src/feeds/anchor/AnchorPoller.ts) lines 188 to 192, and which status Hyperliquid sends at its limit is unknown, so a Hyperliquid poller should also log any other non-200 in full.

## 7. Server time and clock offset

There is no time call, but `exchangeStatus`, weight 2, returns `{"specialStatuses":null,"time":1790231586439}` in Unix ms.
On the call with the smallest round trip, local time minus that `time` lay between +165 and +268 ms in P1 (103 ms round trip), and between +149 and +252 ms and +128 and +233 ms in the two P2 runs.
The local clock reported NTP synchronised through `timedatectl`, so the reported `time` most likely trails the wall clock by somewhere between 128 and 268 ms, rather than the local clock running ahead.
`l2Book`'s `time` trailed arrival by 291 to 828 ms, see section 5.
Both fit a server that reports the time of the latest state it holds, and HyperCore's block timing is in [[`../../research/2026-09-23-hyperliquid-dex.md`](../../research/2026-09-23-hyperliquid-dex.md)](../../research/2026-09-23-hyperliquid-dex.md).
The engine stamps an anchor reading on arrival, so a Hyperliquid reading is older than its stamp by at least that lag, and the clock offset cannot be separated from it.

## 8. Recommended poller shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| source | the socket subscription `allDexsAssetCtxs`, which S11 types as contexts across all dexes, if [[`./websocket.md`](./websocket.md)](./websocket.md) confirms it carries `oraclePx`, `markPx` and `funding` keyed by coin | a 1 s REST poll of one dex costs the whole 1,200 weight a minute |
| REST fallback | `POST https://api.hyperliquid.xyz/info` with `{"type":"metaAndAssetCtxs"}` | one call carries index, mark and rate for all 234 first-dex assets |
| interval | 3,000 ms | the index and mark republish about every 3 s, and 20 weight every 3 s is 400 a minute, a third of the budget |
| builder dexes | one more call per tracked dex, `{"type":"metaAndAssetCtxs","dex":"xyz"}` | at 3 s the first dex plus `xyz` is 800 a minute, and the five dexes with live assets would be 2,000, over budget |
| request | a POST helper beside `getJson`, which sends a GET, at [`AnchorPoller.ts`](../../../old_ts_server/src/feeds/anchor/AnchorPoller.ts) lines 224 to 243 | every info call is a POST with a JSON body and `content-type: application/json`, or it gets 405 or 415 |
| row mapping | section 3, key `universe[i].name` joined to `ctxs[i]` by index | contexts carry no name |
| interval and next settlement | `fundingIntervalHours` 1, and `nextFundingAt` the next whole UTC hour after the arrival stamp | neither is in the context, and `predictedFundings` names the hour just settled |
| skip | `isDelisted` true: 56 on the first dex and 143 on builder dexes | their mark and oracle are frozen and `midPx` is null |
| flag | `HMSTR`, `NOT`, `MEME`, `XAI` | one price step exceeds the 1,000 ppm move guard |
| rate limit pause | `rateLimitPauseMs` 60,000, the default at [`AnchorPoller.ts`](../../../old_ts_server/src/feeds/anchor/AnchorPoller.ts) line 9 | the budget is per minute and no `Retry-After` is documented |
| catalog | `rawMarketId` from `market.info.name`, and the HIP-3 dex list set explicitly in CCXT | section 2 |

At a 3 s interval the first-dex reply is about 2.1 GB a day, which the design treats as free.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Info endpoint | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint.md | 2026-09-23 | Hyperliquid, docs | base URL, naming, `l2Book`, section 5 |
| S2 | Info endpoint, Perpetuals | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals.md | 2026-09-23 | Hyperliquid, docs | `meta`, `perpDexs`, `allPerpMetas`, `metaAndAssetCtxs`, `predictedFundings`, `fundingHistory`, sections 2 and 3 |
| S3 | Rate limits and user limits | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits.md | 2026-09-23 | Hyperliquid, docs | weights and budget, section 6 |
| S4 | Oracle | https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/oracle.md | 2026-09-23 | Hyperliquid, docs | oracle formula and cadence, section 4 |
| S5 | Robust price indices | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/robust-price-indices.md | 2026-09-23 | Hyperliquid, docs | mark formula, section 4 |
| S6 | Funding | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding.md | 2026-09-23 | Hyperliquid, docs | funding formula, interval and cap, sections 3 and 4 |
| S7 | Contract specifications | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications.md | 2026-09-23 | Hyperliquid, docs | contract unit, USDT oracle, impact notional, sections 2 and 4 |
| S8 | HIP-3 deployer actions | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions.md | 2026-09-23 | Hyperliquid, docs | `setOracle` rules and clamps, funding parameters, section 4 |
| S9 | Tick and lot size | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size.md | 2026-09-23 | Hyperliquid, docs | price grid, section 4 |
| S10 | Asset IDs | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids.md | 2026-09-23 | Hyperliquid, docs | asset ids and `dex:coin` names, section 2 |
| S11 | WebSocket subscriptions | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md | 2026-09-23 | Hyperliquid, docs | `allDexsAssetCtxs`, section 8 |
| S12 | Hyperps | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/hyperps.md | 2026-09-23 | Hyperliquid, docs | hyperp oracle and mark caps, section 4 |
| S13 | Error responses | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/error-responses.md | 2026-09-23 | Hyperliquid, docs | only order and cancel errors are documented, section 6 |
| S14 | Python SDK `info.py`, request bodies and the builder dex offset `110000 + i * 10000` at lines 62 and 63 | https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/info.py | 2026-09-23 | Hyperliquid, SDK | field names, section 2 |
| S15 | CCXT 4.5.68 `hyperliquid.js` | `server/node_modules/ccxt/js/src/hyperliquid.js` | 2026-09-23 | CCXT | catalog mapping and pacing, section 2 |
| P1 | `rest-probe.mjs` modes `host`, `catalog`, `ccxt`, `anchor`, `dexes`, `funding`, `book` and `errors`, 06:33 to 06:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hyperliquid/rest-probe.mjs) | 2026-09-24 UTC | this host, Canadian exit | sections 1 to 7 |
| P2 | the same modes rerun, plus `hyperps` twice, 06:38 to 06:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hyperliquid/rest-probe.mjs) | 2026-09-24 UTC | this host, Canadian exit | sections 1 to 7 |
