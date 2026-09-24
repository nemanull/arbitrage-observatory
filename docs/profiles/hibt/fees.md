# HIBT Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 from 20:15 to 20:51 PDT (2026-09-23 03:15 to 03:51 UTC), from the development host near Seattle.

This profile covers the fees of HIBT's USDT-margined perpetuals, the only perpetual family the venue lists.
CCXT 4.5.68 has no HIBT class, and current CCXT master has none either, see section 8.
The help center pages at `support.hibt.com/hc/...` answer this host with a Cloudflare challenge (HTTP 403), so every article below was read through the help center's public article API, which answered HTTP 200, see [`rest.md`](./rest.md) section 1.
The article links in the ledger are the canonical URLs that API returned.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| venue | HIBT, `hibt.com`, CoinGecko trust rank 75, "registered in Canada in 2021" per CoinGecko | S17 |
| operating entity named in the registration disclosures | KAIXUAN NETWORK CO., LTD., FinCEN MSB 31000298581033 (registered April 2025), FINTRAC MSB M22503476 (registered 2022-01-04, expiring 2027-10-07) | S13, S14 |
| entity named for perpetuals in the terms | "Perpetual contracts, options, index tracking and margin loans provided by Seychelles registered company Aux Cayes FinTech Co. Ltd.", and the definitions also name "Hibt Bahamas, Hibt HK or Aux Cayes" | S11 |
| Australian licence | a disclosure cites AFSL 435823, "Current", effective 2013-04-30, without naming the licence holder | S15 |
| restricted areas, terms clause 2.2 | Hong Kong (derivatives for retail users), Cuba, Iran, North Korea, Crimea, Malaysia, Singapore, Syria, the United States and all its territories, the Bahamas, Canada, the Netherlands, the United Kingdom (derivatives for retail users), Bangladesh, Bolivia, Donetsk, Luhansk and Malta | S11, S12 |
| US persons | may not trade: the United States and its territories are restricted areas, although a US MSB registration is disclosed | S11, S13 |
| terms last updated | Terms of Service 2024-10-25, User Agreement 2024-05-06, per the article API | S11, S12 |

Aux Cayes FinTech Co. Ltd. is also the Seychelles entity named in OKX's own terms of service, S18.
The HIBT terms name no HIBT-specific perpetual entity besides it.
The terms exclude Canada, while the disclosures present a Canadian MSB registration as the operating basis.
Both statements are recorded as published, and which entity contracts with a perpetual trader is Not verified.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.03 %, 300 ppm | 0.05 %, 500 ppm | S2, S3, and the catalog reply in [`rest.md`](./rest.md) section 2 |

The rates have applied since 00:00 UTC+8 on 2025-08-15, S2.
HIBT publishes no perpetual fee tiers, so VIP 0 is the only rate.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 82 contracts listed and trading, 3 more listed with `supportTrade` false | P1 |
| USDC-M perpetuals | absent | every one of the 82 rows has `quote_currency` `USDT`, P1 |
| coin-M or inverse perpetuals | absent | the API documents one family at `fapi.hibt0.com`, S1 |
| dated futures | absent | every row has `product_type` `Perpetual` and no `expiry_timestamp`, P1 |
| options | not in the API | the terms name options, S11, and the help center describes "Event Contracts", which pay by a payout rate, S20 |
| spot | yes, 503 pairs, 488 against USDT, 13 against USDC and 2 against BTC, all `enable` 1, not detailed | `GET https://api.hibt0.com/user-open-api/v1/common/symbols`, P1 |

CoinGecko's derivatives venue list held 214 venues on 2026-09-22 and no HIBT, and `GET /api/v3/derivatives/exchanges/hibt` answered 404 `{"error":"market not found"}`, S17.
The perpetuals exist regardless, and the API serves them, see [`rest.md`](./rest.md) section 2.

By name, 45 of the 82 contracts are crypto and 37 are commodities, currency pairs, stock indices, single equities or pre-IPO names such as `gold`, `crude`, `eurusd_usdt`, `spx500_usdt`, `samsung_usdt` and `unitree_usdt`.

## 4. Perpetual tiers

HIBT publishes no tier table for perpetuals.
The futures fee notice sets one taker and one maker rate for all users, S2, and the contract fee article repeats them with no tier, S3.

The only tier table is the 2024 "Tiered Trading Fee Discount Program", S4.
It is headed "Trading fees - Spot", counts 30 day spot and futures volume in BTC together with the balance held, and runs from 0.10 % maker and 0.10 % taker at tier 1 down to 0.0125 % maker and 0.03 % taker at tier 10.
The article itself says "some of the following content may be outdated", and it predates the flat spot rate of 0.2 % in S5.
It is not a perpetual schedule and it is not current, so it is recorded here only as context.

The catalog reply carries per contract fee fields, see [`rest.md`](./rest.md) section 2.
`taker_fee` was `0.0005` on 82 of 82 contracts and `maker_fee` was `0.0003` on 81, with `unitree_usdt` at `0.0005`, P1.
Whether that one maker rate is charged is Not verified.

## 5. Discounts that change the perpetual taker

| discount | effect on the perpetual taker | source |
|---|---|---|
| token holding | none published, HIBT has no fee token | S2, S3 |
| referral | referral campaigns pay prizes and rebates, and none publishes a perpetual taker rate | S20 |
| market maker | the 2024 tier article names a "Market Making Incentive Scheme" and links no terms | S4 |
| zero fee promotion | no title among the 2,981 English help center articles on 2026-09-22 names one | S20 |

## 6. Funding as a cost

| item | documented | observed on the wire |
|---|---|---|
| formula | Funding Rate (F) = Premium Index (P) + clamp(Interest Rate (I) minus Premium Index (P), a, b), P and I sampled every minute and averaged over N hours, S7 | the published rate is not a premium average: 53 of 82 contracts read `0.0000129`, 17 read `-0.0000129` and 6 read `0`, identical in four runs, P1 |
| interest rate | "The interest rate (I) is 0.01%.", S7 | a rate equal to I would read `0.0001`, and no contract did |
| clamp a and b | Not publicly specified | |
| interval | 8 h, S6 and S7 | `next_funding_rate_timestamp` was `1790150400000`, 2026-09-23 08:00 UTC, on 82 of 82 contracts, P1 |
| settlement instants | 00:00, 08:00 and 16:00 UTC, S7, which S6 states as 08:00, 16:00 and 24:00 HKT | the instant itself was not captured |
| who pays | positive rate: longs pay shorts, negative: shorts pay longs, only positions held at the timestamp, S6 and S7 | |
| amount | Funding Fee = Position Value × Funding Rate, S6 | |
| cap and floor | Not publicly specified | |
| stability | not documented | `btc_usdt` read `-0.0000129` on every history row of two one-day windows, 288 rows each, ending 2026-09-21 03:20 and 03:45 UTC, and on the latest 100 rows in both runs, P2 |

The funding history endpoint returns one row every 300 s, not one row per settlement, and it marks no row as settled, see [`rest.md`](./rest.md) section 4.
So the rate actually charged at an instant is Not verified.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | Not publicly specified | S9 |
| liquidation trigger | the mark price per S8 and S10, and "a single index price" per S9, which also says the quote "is provided by ICE" | S8, S9, S10 |
| loss beyond margin | the insurance fund covers it, then ADL at the bankruptcy price ranked by profit and effective leverage | S9, S10 |
| delisting | open positions "will be subject to forced liquidation" at the delisting time, for example `RENDERUSDT`, `DOGSUSDT` and `PEOPLEUSDT` on 2026-07-02 08:00 UTC | S21 |
| maintenance | the help center holds 16 futures maintenance notices dated 2026, 15 of them at 22:00 UTC, the latest one 15 minutes long on 2026-09-22, during which orders pause and positions cannot be closed | S16, S20 |

## 8. CCXT

`node -e "console.log(require('ccxt').exchanges)"` from `server/` lists 104 exchanges for CCXT 4.5.68, and none matches `hibt` or `hbt`, P1.
The nearest names are `hibachi` and `hitbtc`, which are other venues.
CCXT master at commit `1d8b674` (2026-09-22 12:48 UTC) has 105 `.ts` files in `ts/src`, and none is a HIBT class, and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/hibt.ts` answered 404, S19.
So there is no `market.taker` to report and no source line to cite.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 500 | the published perpetual taker since 2025-08-15, S2, and the catalog's `taker_fee` on 82 of 82 contracts |
| `ccxtTakerPpm` | unset | no CCXT class exists to declare a constant for |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Hibt OpenApi Doc, Perpetual Contract Trading | https://apidoc.hibt.co/hibt-openapi-en/perpetual-contract-trading, full text at https://apidoc.hibt.co/hibt-openapi-en/llms-full.txt | 2026-09-22 | HIBT | the family, sections 3 |
| S2 | HiBT Futures Trading Fee Adjustment Notice, 2025-08-13 | https://support.hibt.com/hc/en-us/articles/13493971259919-HiBT-Futures-Trading-Fee-Adjustment-Notice | 2026-09-22 | HIBT | 0.05 % taker, 0.03 % maker from 2025-08-15, sections 2, 4, 5, 9 |
| S3 | Contract Trading Fee Description, updated 2025-09-03 | https://support.hibt.com/hc/en-us/articles/8274934631695-Contract-Trading-Fee-Description | 2026-09-22 | HIBT | maker 0.03 %, taker 0.05 %, fee on position value, sections 2, 4, 5 |
| S4 | Hibt Announcement on Tiered Trading Fee Discount Program, updated 2024-07-30 | https://support.hibt.com/hc/en-us/articles/8780665168655-Hibt-Announcement-on-Tiered-Trading-Fee-Discount-Program | 2026-09-22 | HIBT | the 2024 spot tier table, sections 4, 5 |
| S5 | Spot trading fees and minimum trading volume, and Spot Trading Fee Explanation | https://support.hibt.com/hc/en-us/articles/10339679085583-Spot-trading-fees-and-minimum-trading-volume and https://support.hibt.com/hc/en-us/articles/8274942789519-Spot-Trading-Fee-Explanation | 2026-09-22 | HIBT | spot 0.2 % maker and taker, section 4 |
| S6 | what is the funding fee？ | https://support.hibt.com/hc/en-us/articles/10378184497423-what-is-the-funding-fee | 2026-09-22 | HIBT | 8 h, HKT instants, who pays, section 6 |
| S7 | Overview of Perpetual Contracts | https://support.hibt.com/hc/en-us/articles/10907998752271-Overview-of-Perpetual-Contracts | 2026-09-22 | HIBT | funding formula, I of 0.01 %, UTC instants, section 6 |
| S8 | Latest Transaction Price, Index Price, and Mark Price | https://support.hibt.com/hc/en-us/articles/10908079637391-Latest-Transaction-Price-Index-Price-and-Mark-Price | 2026-09-22 | HIBT | mark formula, section 7 |
| S9 | Introduction for Liquidation | https://support.hibt.com/hc/en-us/articles/10908022276623-Introduction-for-Liquidation | 2026-09-22 | HIBT | index-triggered liquidation, insurance fund, section 7 |
| S10 | Hibt Announcement on "Liquidation/ADL Mechanism" | https://support.hibt.com/hc/en-us/articles/9106238361487-Hibt-Announcement-on-Liquidation-ADL-Mechanism | 2026-09-22 | HIBT | ADL ranking, section 7 |
| S11 | Terms of Service | https://support.hibt.com/hc/en-us/articles/8334595820815-Terms-of-Service | 2026-09-22 | HIBT | restricted areas, Aux Cayes FinTech Co. Ltd., section 1 |
| S12 | User Agreement | https://support.hibt.com/hc/en-us/articles/8334624997135-User-Agreement | 2026-09-22 | HIBT | the same restricted areas list, section 1 |
| S13 | HIBT U.S. MSB Registration Disclosure | https://support.hibt.com/hc/en-us/articles/16377494751759-HIBT-U-S-MSB-Registration-Disclosure | 2026-09-22 | KAIXUAN NETWORK CO., LTD., US | section 1 |
| S14 | HIBT Canada MSB Registration Disclosure | https://support.hibt.com/hc/en-us/articles/16376880011919-HIBT-Canada-MSB-Registration-Disclosure | 2026-09-22 | KAIXUAN NETWORK CO., LTD., Canada | section 1 |
| S15 | HIBT Australia Financial Services Licence Disclosure | https://support.hibt.com/hc/en-us/articles/16377529376399-HIBT-Australia-Financial-Services-Licence-Disclosure | 2026-09-22 | Australia | section 1 |
| S16 | Hibt Futures Trading Service Upgrade and Maintenance Notice (2026-09-22 22:00 UTC) | https://support.hibt.com/hc/en-us/articles/17712567390479 | 2026-09-22 | HIBT | a 15 minute futures maintenance, section 7 |
| S17 | CoinGecko exchange page and derivatives API | https://www.coingecko.com/en/exchanges/hibt, https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | trust rank, Canada 2021, no derivatives listing, sections 1, 3 |
| S18 | OKX Terms of Service, last updated 2026-09-17 | https://www.okx.com/help/terms-of-service | 2026-09-22 | OKX | Aux Cayes FinTech Co. Ltd. is OKX's Seychelles entity, section 1 |
| S19 | CCXT master `ts/src` listing at commit `1d8b674` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no HIBT class, section 8 |
| S20 | HIBT help center article index, 2,981 English articles | https://support.hibt.com/api/v2/help_center/en-us/articles.json | 2026-09-22 | HIBT | no zero fee promotion, event contracts, maintenance count, sections 3, 5, 7 |
| S21 | Notice of Removal of Futures Trading Pairs - 2026-07-02-08:00 (UTC) | https://support.hibt.com/hc/en-us/articles/16581450505871 | 2026-09-22 | HIBT | forced liquidation at delisting, section 7 |
| P1 | `rest-probe.mjs main`, four runs from 03:21 to 03:49 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/hibt/rest-probe.mjs) | 2026-09-22 | this host | catalog and fee fields, spot count, CCXT list, sections 3, 4, 6, 8 |
| P2 | `rest-probe.mjs funding`, two runs at 03:22 and 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/hibt/rest-probe.mjs) | 2026-09-22 | this host | funding history, section 6 |
