# Hyperliquid Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-23.

**Probed:** 2026-09-23 in the local evening, which is 2026-09-24 from 06:32 to 06:41 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark exit that ipinfo.io placed in British Columbia, Canada.

This profile covers perpetual trading on Hyperliquid (CCXT id `hyperliquid`), the first decentralised venue the observatory would read.
It covers the validator-operated perpetuals and the builder-deployed HIP-3 perpetual dexes, and names spot in one line.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`fees-probe.mjs`](../../../scripts/probes/venues/hyperliquid/fees-probe.mjs), run three times, at 06:32, 06:34 and 06:40 UTC.
The first run lacked the `fee_scale` and `ccxt_dexes` tags, so those come from the second and third runs.
Every number quoted below held in every run that measured it, unless a range is given.
The TypeScript server this profile cites sat under [`old_ts_server/`](../../../old_ts_server/) when it was written, and the research plan places it under `server/ts/`.
The socket is covered in [[`./websocket.md`](./websocket.md)](./websocket.md), the info calls and the anchor in [[`./rest.md`](./rest.md)](./rest.md), and the chain, the HIP-3 oracles and the venues that route to Hyperliquid in [[`../../research/2026-09-23-hyperliquid-dex.md`](../../research/2026-09-23-hyperliquid-dex.md)](../../research/2026-09-23-hyperliquid-dex.md).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-23 for every source row | | source ledger |
| what is being used | Hyperliquid is "a decentralized, permissionless, and community-driven blockchain". Trading, funding and liquidation run on it, "executed by a decentralized set of validators" | Published | S17 sections 1.1 and 1.2 |
| legal entity of the web interface | "The Interface is made available by Hyperliquid Corp.", at `app.hyperliquid.xyz`. "The Company does not own, control, or operate Hyperliquid" | Published | S17 preamble and 1.1 |
| core contributor | "Hyperliquid Labs is a core contributor supporting the growth of Hyperliquid" | Published | S20 |
| licensing | "Neither the Interface nor Hyperliquid are licensed, approved, authorized, endorsed, or registered by any governmental authority or regulatory body in any jurisdiction." | Published | S17 1.3 |
| restricted persons | "(a) persons or entities who reside in, are located in, are incorporated in, or have a registered office in the United States of America or Ontario, Canada; (b) persons or entities who reside in, are located in, are incorporated in, or have a registered office in jurisdictions subject to applicable economic and trade sanctions or export control laws and regulations (collectively, "Restricted Territories"); and (c) citizens of Restricted Territories, regardless of their location. Restricted Persons are strictly prohibited from accessing or using the Interface described herein." | Published, terms last updated 2026-06-15 | S17 1.6 |
| outcome markets | also closed to "Excluded Persons" in "certain jurisdictions that we designate from time to time" | Published | S17 1.7 and 1.8 |
| location concealment | "using technologies such as VPNs, proxies, or other methods to conceal your location" is a prohibited activity for users of the Interface | Published | S17 3.1.5 |
| governing law | the laws of England and Wales, with arbitration in London | Published | S17 11.4 |
| who may trade the perpetuals | a person who is not a Restricted Person, holding a non-custodial wallet. "To use the Interface, you must use a non-custodial wallet". No account or identity check is described | Published | S17 1.4 and 1.6 |
| scope of the terms | the terms govern the Interface, and "The Interface is not the exclusive means of accessing Hyperliquid." The API pages name no terms, no restricted region and no location rule | Published | S17 1.1, and S14, S15, S16 and S21, where a search for "terms", "restricted" and "jurisdiction" found nothing |
| location check in the web interface | The interface script has `ipBlocked` and `userIpBlocked` states that show a banner linking `/terms` and replace the deposit and withdrawal panel with `deposits.and.withdrawals.not.allowed` | Published in code | S18 |
| location check in the public API | none seen. Every `POST /info` call in the three probe runs answered 200, and the socket opened in 194 to 205 ms and delivered books. The one full header set kept, from a `perpDexs` call by `curl`, carried no location header. CloudFront served every call from its `YVR52-P3` edge | Probed from the British Columbia exit | [`fees-probe.mjs`](../../../scripts/probes/venues/hyperliquid/fees-probe.mjs), tags `http` and `ws_open` |

The exit is in British Columbia, which is neither the United States nor Ontario, so the probe cannot tell whether the API would refuse a restricted location.
The network was not changed to find out.
The development host itself sits in the United States, and a person located there is a Restricted Person under S17 1.6, so trading through the Interface from it is not allowed.
The observatory only reads public market data through the API, which the terms do not name, and it never trades.

## 2. Quick answer

| family | base-tier maker | base-tier taker | label | evidence |
|---|---|---|---|---|
| validator-operated perpetuals, 178 live | 0.015 % = 150 ppm | 0.045 % = 450 ppm | Published and probed | S1 tier 0, and `userFees` for the zero address reads `feeSchedule.cross` `"0.00045"`, `add` `"0.00015"`, `userCrossRate` `"0.00045"`, tag `userFees_zero` |
| HIP-3 perpetuals in growth mode at deployer fee scale 1.0, 138 live | 0.003 % = 30 ppm | 0.009 % = 90 ppm | Derived | S1 developer formula applied to `deployerFeeScale` `"1.0"` and `growthMode` `"enabled"` from `allPerpMetas`, tag `fee_scale` |
| HIP-3 perpetuals outside growth mode at scale 1.0, 9 live | 0.030 % = 300 ppm | 0.090 % = 900 ppm | Derived | same |
| HIP-3 perpetual outside growth mode at scale 0.5, 1 live | 0.0225 % = 225 ppm | 0.0675 % = 675 ppm | Derived | same |

The engine models a taker cross at the base tier, so 450 ppm is the number for every validator-operated perpetual.
A HIP-3 perpetual's taker depends on its dex's per asset settings, and no single venue rate describes it, see section 4.
The HIP-3 rows are the documented formula applied to the published settings, not a fee seen on a fill.

## 3. Coverage matrix

| product | present | count on 2026-09-24 UTC | evidence |
|---|---|---:|---|
| validator-operated perpetuals, USDC collateral | yes | 234 listed, 56 delisted, 178 live | Probed, `metaAndAssetCtxs`, tag `funding_main` |
| HIP-3 builder-deployed perpetuals | yes, on 10 dexes | 291 listed, 148 live, all live ones on USDC collateral | Probed, `perpDexs` and `allPerpMetas`, tags `perpDexs` and `fee_scale` |
| live HIP-3 dexes | `xyz` 109 of 124, `para` 27 of 36, `io` 8 of 10, `mkts` 4 of 24 | | tag `fee_scale` |
| HIP-3 dexes with no live market | `flx` and `vntl` (USDH collateral), `hyna` (USDE), `km` (USDH), `abcd` (USDC), `cash` (USDT0) | 0 live | tags `fee_scale` and `ccxt_dexes` |
| hyperps, pre-launch perps priced off their own mark average | yes, inside the validator-operated dex | not counted | S13 |
| dated futures | no listed product. A HIP-3 deployer can halt and recycle an asset, which "could be used to list dated contracts" | 0 | S8 |
| options | no | 0 | none in the docs index read |
| outcome markets | yes, not detailed | | S1, S11 |
| spot | yes, not detailed | 416 `@`-keyed spot mids and `PURR/USDC` in `allMids` | tag `allMids` |

The validator-operated perps post USDC but their oracle is "denominated in USDT", so they are "technically quanto contracts where USDT pnl is denominated in USDC", except PURR and HYPE, whose oracle is in USDC (S11).

Spot in one line: the base-tier spot taker is 0.070 % = 700 ppm and maker 0.040 % = 400 ppm, and the tiers step down to 0.025 % taker and 0 maker above 7B, S1 and `feeSchedule.spotCross` and `spotAdd` on the wire.

## 4. Perpetual tiers

### Validator-operated perpetuals

Tiers are set by "rolling 14 day volume" and "assessed at the end of each day in UTC", with `(14d weighted volume) = (14d perps volume) + 2 * (14d spot volume)` (S1).
"Sub-account volume counts toward the master account", and "Vault volume is treated separately" (S1).
There is "one fee tier across all assets, including perps, HIP-3 perps, and spot" (S1).

| tier | 14d weighted volume | taker | maker | wire `cross` and `add` |
|---|---|---|---|---|
| 0 | | 0.045 % = 450 ppm | 0.015 % = 150 ppm | `"0.00045"`, `"0.00015"` |
| 1 | > 5M | 0.040 % = 400 ppm | 0.012 % = 120 ppm | `ntlCutoff` `"5000000.0"`, `"0.0004"`, `"0.00012"` |
| 2 | > 25M | 0.035 % = 350 ppm | 0.008 % = 80 ppm | `"25000000.0"`, `"0.00035"`, `"0.00008"` |
| 3 | > 100M | 0.030 % = 300 ppm | 0.004 % = 40 ppm | `"100000000.0"`, `"0.0003"`, `"0.00004"` |
| 4 | > 500M | 0.028 % = 280 ppm | 0.000 % | `"500000000.0"`, `"0.00028"`, `"0.0"` |
| 5 | > 2B | 0.026 % = 260 ppm | 0.000 % | `"2000000000.0"`, `"0.00026"`, `"0.0"` |
| 6 | > 7B | 0.024 % = 240 ppm | 0.000 % | `"7000000000.0"`, `"0.00024"`, `"0.0"` |

The table is S1, and the last column is `feeSchedule.tiers.vip` from `userFees`, tag `userFees_zero`, which matched S1 on every row.
S1 also prints each tier with each staking discount applied, see section 5.

### HIP-3 builder-deployed dexes

A HIP-3 deployer sets a fee scale per asset, and the user pays the protocol fee plus a deployer fee on top.
S1 and S8 both say "HIP-3 deployers can configure an additional fee share between 0-300% (0-100% for growth mode)."
They add "If the share is above 100%, the protocol fee is also increased to be equal to the deployer fee."
The deployer action spells it out, with `x` the user's normal rate and `y` that rate after an aligned-collateral discount (S9).

```text
If x > 0 and scale < 1, P = y and D = scale * x
If x > 0 and scale > 1, P = y * scale and D = x * scale
If x < 0 and scale < 1, P = y / (1 + scale) and D = y * scale / (1 + scale)
If x < 0 and scale > 1, P = y / 2 and D = y / 2
```

Here `P` goes to the protocol and `D` to the deployer.
S1's developer formula gives the same totals as `scaleIfHip3 = deployerFeeScale < 1 ? deployerFeeScale + 1 : deployerFeeScale * 2`, times `growthModeScale = 0.1` when growth mode is on.
The deployer's share of what the user pays is `deployerFeeScale / (1 + deployerFeeScale)` below a scale of 1, and one half from a scale of 1, which matches "Spot and HIP-3 perp deployers may choose to keep up to 50% of trading fees generated by their deployed assets" (S1).
S9's worked table gives, for a user fee of 1 unit, protocol 1 and deployer 1 at scale `"1"` without growth mode, and protocol 0.1 and deployer 0.1 with it.

Growth mode cuts "protocol fees, rebates, volume contributions, and L1 user rate limit contributions" by 90 %, and S1 sums it as "the baseline all-in taker rate under growth mode will be between 0.0045%-0.009%".
Growth mode requires markets "entirely disjoint from existing validator-operated perps", so no crypto perp, crypto basket or gold perp qualifies, and it has "a 30 day cooldown per asset" (S1).
The allowed scale under growth mode is written three ways.
S1 says "0-100% for growth mode" in one paragraph and "The deployer fee scale must be set between 0 and 10" in another.
S9 types the field as "Decimal string in [0.0, 3.0], or [0.0, 10.0) when growthMode is true" and lists growth rows at `"3.01"` and `"9.99"`.
On the wire every live growth-mode asset sat at scale 1.0, so the disagreement does not change a live rate today.

The settings are public.
Each HIP-3 universe entry in `metaAndAssetCtxs` and `allPerpMetas` carries `growthMode`, `deployerFeeScale` and `lastFeeScaleChangeTime` (tag `funding_xyz`).
S15's HIP-3 `meta` example shows `growthMode` and `lastGrowthModeChangeTime` instead, with no fee scale, and the wire carried no `lastGrowthModeChangeTime`.
Validator-operated entries carry neither field.

| dex | live | `deployerFeeScale` | `growthMode` | derived base-tier taker |
|---|---:|---|---|---|
| `xyz` | 109 | `"1.0"` on 109 | `"enabled"` on 104, absent on 5 | 90 ppm on 104, 900 ppm on 5 |
| `para` | 27 | `"1.0"` on 26, `"0.5"` on 1 | `"enabled"` on 22, absent on 5 | 90 ppm on 22, 900 ppm on 4, 675 ppm on 1 |
| `io` | 8 | `"1.0"` on 8 | `"enabled"` on 8 | 90 ppm on 8 |
| `mkts` | 4 | `"1.0"` on 4 | `"enabled"` on 4 | 90 ppm on 4 |

The table is tag `fee_scale` of the second and third runs.
All four live dexes post USDC, `collateralToken` 0, so no aligned-collateral discount applies.
S9 adds "Note that there are currently no aligned quote assets on mainnet."

## 5. Discounts that change the perpetual taker

| discount | what it does | label | evidence |
|---|---|---|---|
| HYPE staking | 5 % off above 10 HYPE staked, 10 % above 100, 15 % above 1,000, 20 % above 10,000, 30 % above 100,000 and 40 % above 500,000. At tier 0 the taker becomes 427.5, 405, 382.5, 360, 315 and 270 ppm, which S1 prints rounded as 0.0428 %, 0.0405 %, 0.0383 %, 0.0360 %, 0.0315 % and 0.0270 % | Published and probed | S1. The wire states the thresholds as `bpsOfMaxSupply` `"0.0001"`, `"0.001"`, `"0.01"`, `"0.1"`, `"1.0"` and `"5.0"` with `discount` `"0.05"` to `"0.4"`, in the same ratios as S1's HYPE counts, tag `userFees_zero` |
| staking link | a staking address may lend its discount to a trading address "controlled by the same user", permanently, and the staking user can take the trading user's funds | Published | S1 |
| referral | "Using a referral code will give you a 4% discount on your fees for your first $25M in volume", so the tier 0 taker becomes 432 ppm. Not for vaults or sub-accounts | Published and probed | S7, `referralDiscount` `"0.04"` on the wire |
| maker rebates | -0.001 %, -0.002 % and -0.003 % maker fee for more than 0.5 %, 1.5 % and 3.0 % of 14 day weighted maker volume. "Maker rebates are paid out continuously on each trade directly to the trading wallet." | Published and probed | S1, and `tiers.mm` `makerFractionCutoff` `"0.005"`, `"0.015"`, `"0.03"` with `add` `"-0.00001"`, `"-0.00002"`, `"-0.00003"` |
| aligned quote assets | 20 % lower taker fees, 50 % better maker rebates and 20 % more volume contribution, for a spot pair quoted in, or a HIP-3 dex collateralised by, an aligned stablecoin under AQAv1. S10 says "There is no trading fee or volume contribution benefit to AQAv2." S9 says "there are currently no aligned quote assets on mainnet", and every live HIP-3 dex posts USDC | Published, not in effect on the live dexes | S1, S9, S10, tag `fee_scale` |
| stable spot pairs | 80 % lower taker fees between two spot quote assets. Spot only | Published | S1 |
| fee trial | `userFees` carries `trial`, `feeTrialEscrow` and `nextTrialAvailableTimestamp`. S14's example names `feeTrialReward` instead of `feeTrialEscrow`. No page read describes the trial | Not publicly specified | S14, tag `userFees_zero` field `otherKeys` |
| zero-fee promotion | none found in the pages read | Not publicly specified | |

Builder fees are a surcharge, not a discount.
A front end that routes a user's order may add "at most 0.1% on perps and 1% on spot", set per order in tenths of a basis point, after the user signs `ApproveBuilderFee` for that builder (S6).
So a perpetual taker reached through a third-party front end can cost up to 450 + 1,000 = 1,450 ppm at tier 0.
The official interface says "The Interface does not impose any fees" (S17 6.3).
The engine's cross has no front end, so the builder fee does not enter its number.

`userFees` answers for any address without a signature.
For the zero address it returned the base schedule with `userCrossRate` `"0.00045"` and `userAddRate` `"0.00015"`.
For the assistance fund system address `0xfefefefefefefefefefefefefefefefefefefefe`, which S1 names, it returned the same schedule with `userCrossRate` and `userAddRate` `"0.0"`, so the reply does reflect the address asked about.
CCXT reads the same call in `fetchTradingFee`, see section 8.

## 6. Funding as a cost

Source S2 is the formula of record, and the wire of 2026-09-24 UTC is quoted beside it.

```text
Funding Rate (F) = Average Premium Index (P) + clamp (interest rate - Premium Index (P), -0.0005, 0.0005)
premium = impact_price_difference / oracle_price
impact_price_difference = max(impact_bid_px - oracle_px, 0) - max(oracle_px - impact_ask_px, 0)
HIP-3 perps: premium = (0.5 * (impact_bid_px + impact_ask_px) / oracle_px) - 1
funding payment = position_size * oracle_price * funding_rate
```

| item | documented | probed | evidence |
|---|---|---|---|
| who pays | "If the contract's price is higher than the oracle price, the premium and hence the funding rate will be positive, and the long position will pay the short position." Funding "is purely peer-to-peer and no fees are collected on the payments" | 175 of 178 live validator-operated rates positive, 3 negative | S2, tag `funding_main` |
| interval | "The funding rate on Hyperliquid is paid every hour." The formula is an 8 hour rate, and each hour pays "one eighth of the computed rate". "The funding cap and funding interval do not depend on the asset." | the settlement instant was not captured, see [[`./rest.md`](./rest.md)](./rest.md) | S2 |
| sampling | "The premium is sampled every 5 seconds and averaged over the hour." | | S2 |
| interest term | "0.01% every 8 hours, which is 0.00125% every hour, or 11.6% APR paid to short" | 165, 165 and 164 of 178 live validator-operated perps showed `funding` exactly `"0.0000125"`, the interest term alone, in the three runs | S2, tag `funding_main` |
| cap | "Funding on Hyperliquid is capped at 4%/hour." | the largest absolute rate was 0.0001122 to 0.0001185 per hour, on `ATOM` in every run, and no asset was near the cap | S2, tag `funding_main` field `maxAbs` |
| impact notional | "20000 USDC for BTC and ETH", "6000 USDC for all other assets" | | S11 |
| notional basis | "the spot oracle price is used to convert the position size to notional value, not the mark price" | | S2 |
| HIP-3 funding | the premium uses the impact mid, so it is "more responsive", and deployers shape it "using the funding rate multiplier and interest rate" | on `xyz`, 0 of 109 live rates sat at `"0.0000125"`, 78 were positive, 30 negative and 1 zero, and the largest absolute rate was 0.000630 to 0.000670 per hour on `xyz:CVX` | S2, tag `funding_xyz` |
| HIP-3 per asset settings | | `perpDexs` lists `assetToFundingMultiplier`, for example `"0.5"` on 122 of 123 `xyz` entries and `"0.6"` on 26 `para` entries, `assetToFundingInterestRate`, for example `"0.0"` on `xyz:EUR`, `xyz:GBP`, `xyz:JPY` and `xyz:KRW`, and `assetToFundingClamp` `"0.005"` on `para:10Y`, `para:2Y` and `para:30Y`. The unit of the interest and clamp values is not stated in the pages read | tag `perpDexs` |
| hyperps | "Funding rate premium samples are computed as 1% of the usual clamped interest rate and premium formula", against an oracle that is the 8 hour average of the hyperp's own mark | | S13 |

So a validator-operated perpetual held across one settlement costs about 12.5 ppm of notional on a typical hour, paid by longs, and at most 40,000 ppm under the cap.
Whether the `funding` field of an asset context is the rate for the coming hour or the last one charged belongs to the anchor, see [[`./rest.md`](./rest.md)](./rest.md).

## 7. Liquidation, settlement and delisting

| charge | value | label | evidence |
|---|---|---|---|
| liquidation on the book | positions below maintenance margin are closed by market orders on the book, and "any remaining collateral remains with the trader". "Unlike CEXs there is no clearance fee on liquidations." | Published | S3 |
| maintenance margin | "half of the initial margin at max leverage", between 1.25 % and 16.7 % depending on the asset | Published | S3 |
| partial liquidation | above 100k USDC only 20 % of the position goes to the book, then a 30 s cooldown | Published | S3 |
| backstop through HLP | below 2/3 of maintenance margin the liquidator vault, "a component strategy of HLP", takes the position, and "the maintenance margin is not returned to the user". Its pnl goes "entirely to the community through HLP" | Published | S3, S5 |
| HLP | "a protocol vault that provides liquidity to Hyperliquid through multiple market making strategies, performs liquidations, supplies USDC in Earn, and accrues a portion of trading fees", with a 4 day deposit lock-up | Published | S5 |
| HIP-3 backstop | each dex has "a fully onchain strategy at `0x400..00 + {dex_index}`" that takes backstop liquidations, only on assets with cross margin enabled, and "falls back to ADL" | Published | S8 |
| auto-deleveraging | when an account goes negative, opposing users ranked by `(mark_price / entry_price) * (notional_position / account_value)` are closed "at the previous mark price" | Published | S4 |
| where fees go | "fees are entirely directed to the community (HLP, the assistance fund, and deployers)". The assistance fund converts fees to HYPE and burns it | Published | S1 |
| perpetual settlement fee | none, perpetuals do not expire | | S11 |
| delisting of a validator-operated perp | by validator vote, positions "settle to the 1 hour time weighted spot oracle price before the scheduled delisting voting time". No charge is named | Published | S12 |
| HIP-3 settlement | the deployer's `haltTrading` "cancels all orders and settles positions to the current mark price". No charge is named | Published | S8 |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | Probed, tag `env` |
| `market.taker` on every active swap without credentials | `0.00045` on 318 of 318, the 178 validator-operated and the 140 HIP-3 markets CCXT loaded | Probed, tag `ccxt_markets` |
| where it comes from | `parseMarket` reads `this.fees.swap` for every swap, validator-operated or HIP-3 | `server/node_modules/ccxt/js/src/hyperliquid.js` lines 1006 to 1008 and 1042 |
| the constant | `'taker': this.parseNumber('0.00045')` and `'maker': this.parseNumber('0.00015')` in the `swap` fee block | `server/node_modules/ccxt/js/src/hyperliquid.js` lines 182 to 186 |
| spot constant | `'taker': this.parseNumber('0.0007')` and `'maker': this.parseNumber('0.0004')` | same file, lines 187 to 190 |
| HIP-3 markets | the same 0.00045, although the derived takers are 90, 675 or 900 ppm, section 4. CCXT reads no `deployerFeeScale` or `growthMode` | Probed, and the code of `parseMarket`, lines 967 to 1074 |
| `fetchTradingFee` | posts `userFees` for a wallet address and returns `userCrossRate` as the taker for any symbol, so a HIP-3 or spot symbol gets the plain perpetual user rate | same file, lines 4253 to 4305 and 4347 |
| `market.id` | the asset index as a string, `"0"` for BTC and `"15"` for kPEPE, and `110000 + (dex position - 1) * 10000 + index` for HIP-3, so `"110000"` for `xyz:XYZ100`. Numeric on 318 of 318, equal to the coin name on 0 | Probed, tag `ccxt_ids`, and same file lines 1023, 737, 633 and 578 to 581. The Python SDK uses the same offsets, S19 |
| the coin name the info calls and the socket use | `BTC`, `kPEPE`, `xyz:XYZ100`. `allMids` is keyed by these names, and `l2Book` frames echoed each as `coin` with 20 levels per side | Probed, tags `allMids` and `ws_coins` |
| where CCXT keeps the coin name | `market.baseName` and `market.info.name`, both `kPEPE` and `xyz:XYZ100` | Probed, tag `ccxt_ids` |
| `base` | `BTC`, `KPEPE` and `XYZ-XYZ100`. CCXT upper-cases the k prefix and turns the HIP-3 colon into a dash | Probed, and same file lines 993 and 994 |
| `quote` | `USDC` for validator-operated perps by default, and the collateral token's name for HIP-3: `USDC` on `xyz`, `para`, `mkts` and `abcd`, `USDH` on `flx`, `vntl` and `km`, `USDE` on `hyna`, `USDT0` on `cash` | Probed, tag `ccxt_dexes`, and same file lines 637 to 647 and 990 |
| `contractSize` | `1` on 318 of 318, a literal, which matches "Contract: 1 unit of underlying spot asset" | Probed, same file line 1044, S11 |
| k-prefixed perps | `kPEPE`, `kSHIB`, `kBONK`, `kLUNC`, `kFLOKI` and `kNEIRO` count a thousand tokens per unit. `kPEPE`'s mid of 0.004405 was within 0.1 % of 1,000 times OKX's `PEPE-USDT` last of 0.000004409, read a minute later | Probed, tags `funding_main` and `allMids`, and one OKX public ticker call |
| `linear` | `true` on 318 of 318, a literal | same file line 1040 |
| `active` | `false` when the entry has `isDelisted`, which drops 197 of 515 swaps | Probed, same file lines 1017 to 1021 |
| HIP-3 dexes loaded | the `hip3` option `limit` of 10 and the loop `for (let i = 1; i < maxLimit; i++)` load `perpDexs` entries 1 to 9 only. On 2026-09-24 UTC `perpDexs` listed 10 builder dexes, so the tenth, `io`, with 8 live markets, never loaded | Probed, tag `ccxt_dexes` has no `io` key, and same file lines 249 and 597 |
| rate limit | `'rateLimit': 50` with the comment "1200 requests per minute, 20 request per second", while S16 budgets 1200 weight per minute and weighs most info calls at 20. By its code `loadMarkets` sends 13 info calls, about 260 weight, and it took 12.5 to 12.8 s | same file line 27, S16, tag `ccxt_markets` |

The CCXT constant is 450 ppm and matches the published tier 0 taker for validator-operated perpetuals.
It is wrong for every HIP-3 market.
It is five times the derived 90 ppm of a growth-mode market, and half the derived 900 ppm of a market outside growth mode at scale 1.0.
The connector copies `market.id` into `rawMarketId`, at [`connector.ts`](../../../old_ts_server/src/ccxt/connector.ts) line 170, so on this venue it would store `"0"` where the socket says `BTC`, and every book would miss its market.

## 9. Recommended registry values

```ts
hyperliquid: {
  takerPpm: 450,
  // ccxt/js/src/hyperliquid.js:184 hardcodes 0.00045 for every swap, which equals the published tier 0 taker of the validator-operated perps.
  marketFilter: (market) => market.info?.hip3 !== true, // HIP-3 takers are 90, 675 or 900 ppm per asset, which one venue rate cannot carry
}
```

`takerPpm: 450` is the published tier 0 taker, S1, and the wire's `feeSchedule.cross`.
`ccxtTakerPpm` stays unset, because CCXT's constant already equals 450 and the connector then expects 450, at [`connector.ts`](../../../old_ts_server/src/ccxt/connector.ts) line 38.
The `marketFilter` keeps the 178 validator-operated perpetuals and drops HIP-3, because a single `takerPpm` would misprice every HIP-3 market CCXT loads, 140 of the 148 live ones.

Two named changes are needed before the venue can load at all, and neither is a registry value.

1. `rawMarketId` must be the coin name, `market.info.name` or `market.baseName`, not `market.id`, because `market.id` is the numeric asset index, section 8.
   Today the connector has no per venue hook for this at [`connector.ts`](../../../old_ts_server/src/ccxt/connector.ts) lines 157 to 177.
2. The six k-prefixed perps quote a thousand tokens and carry base `KPEPE` and the like, so they need a price scale in the cluster overrides or they stay out of every cluster.

Adding HIP-3 later needs a per market taker, computed as 450 ppm times the scale factor and the growth factor of section 4, from the `deployerFeeScale` and `growthMode` that `allPerpMetas` publishes.
With HIP-3 kept, the CCXT constant of 450 no longer equals every market's rate, so `ccxtTakerPpm: 450` would then have to be declared.
It also needs CCXT's `hip3.dexes` option set to the full `perpDexs` list, or the tenth dex and any later one are silently missing.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees | 2026-09-23 | Hyperliquid docs, global | perp and spot tiers, staking, maker rebates, HIP-3 fee share, growth mode, developer fee formula, fee destinations, sections 2, 3, 4, 5 and 7 |
| S2 | Funding | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding | 2026-09-23 | Hyperliquid docs, global | funding formula, interval, interest, cap, payer, HIP-3 premium, section 6 |
| S3 | Liquidations | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations | 2026-09-23 | Hyperliquid docs, global | liquidation, backstop, liquidator vault, section 7 |
| S4 | Auto-deleveraging | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/auto-deleveraging | 2026-09-23 | Hyperliquid docs, global | ADL ranking, section 7 |
| S5 | Protocol vaults | https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults/protocol-vaults | 2026-09-23 | Hyperliquid docs, global | HLP, section 7 |
| S6 | Builder codes | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes | 2026-09-23 | Hyperliquid docs, global | builder fee caps, section 5 |
| S7 | Referrals | https://hyperliquid.gitbook.io/hyperliquid-docs/referrals | 2026-09-23 | Hyperliquid docs, global | referral discount, section 5 |
| S8 | HIP-3: Builder-deployed perpetuals | https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals | 2026-09-23 | Hyperliquid docs, global | deployer fee share, settlement, HIP-3 backstop, sections 3, 4 and 7 |
| S9 | HIP-3 deployer actions | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-3-deployer-actions | 2026-09-23 | Hyperliquid docs, global | `SetDeployerFees` rules and worked table, no aligned quote assets on mainnet, sections 4 and 5 |
| S10 | Aligned quote assets | https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/aligned-quote-assets | 2026-09-23 | Hyperliquid docs, global | aligned collateral, section 5 |
| S11 | Contract specifications | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/contract-specifications | 2026-09-23 | Hyperliquid docs, global | 1 unit per contract, impact notional, outcome markets, sections 3, 6 and 8 |
| S12 | Delisting | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/delisting | 2026-09-23 | Hyperliquid docs, global | delisting settlement, section 7 |
| S13 | Hyperps | https://hyperliquid.gitbook.io/hyperliquid-docs/trading/hyperps | 2026-09-23 | Hyperliquid docs, global | hyperp funding, sections 3 and 6 |
| S14 | Info endpoint, `userFees` | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint | 2026-09-23 | Hyperliquid docs, global | `userFees` fields, sections 1 and 5 |
| S15 | Info endpoint, perpetuals | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals | 2026-09-23 | Hyperliquid docs, global | `perpDexs`, `meta`, `allPerpMetas`, sections 1 and 4 |
| S16 | Rate limits and user limits | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits | 2026-09-23 | Hyperliquid docs, global | IP weight budget, sections 1 and 8 |
| S17 | Terms of Use, last updated 2026-06-15, read from the page's `TermsOfUse` script chunk because the page renders in the browser | https://app.hyperliquid.xyz/terms | 2026-09-23 | Hyperliquid Corp., the Interface | operator, restricted persons, VPN clause, governing law, section 1 |
| S18 | Interface script, `ipBlocked` and `userIpBlocked` states | https://app.hyperliquid.xyz/assets/index-58uVNh8f.js | 2026-09-23 | Hyperliquid Corp., the Interface | location check in the interface, section 1 |
| S19 | Python SDK, `hyperliquid/info.py` lines 56 to 63 | https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/info.py | 2026-09-23 | official SDK | HIP-3 asset offsets from 110000, section 8 |
| S20 | Core contributors | https://hyperliquid.gitbook.io/hyperliquid-docs/about-hyperliquid/core-contributors | 2026-09-23 | Hyperliquid docs, global | Hyperliquid Labs, section 1 |
| S21 | API | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api | 2026-09-23 | Hyperliquid docs, global | no terms or location rule on the API pages, section 1 |
