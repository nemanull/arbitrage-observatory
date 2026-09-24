# Giottus Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:40 to 05:08 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the perpetual futures of Giottus, an Indian exchange with no CCXT class.
Giottus lists perpetuals that CoinGecko's derivatives list does not track, so the survey's spot fallback does not apply and the perpetual families are researched.
Both perpetual families are Binance USD-M contracts sold through a Giottus front end, see [`rest.md`](./rest.md) sections 2 to 4.
Giottus documents no futures API, so every futures number below comes from the fee page, the terms, and the public futures web page, read by [`rest-probe.mjs`](../../../scripts/probes/venues/giottus/rest-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Giottus Technologies Private Limited, CIN U74994TN2017PTC119501, registered office in Chennai | S3, clause 1.2 |
| registration | FIU-IND Reporting Entity, Registration ID VA00030979, which the terms say "is not a licence, authorisation, approval or endorsement" | S3, clauses 1.3 and 1.4 |
| who may open an account | "a natural person aged 18 or over with capacity to contract, or a legal entity duly constituted and authorised, and in each case are resident in India or in another jurisdiction we support" | S3, clause 3.1 |
| KYC | a valid Permanent Account Number, live video identity check, and bank account penny-drop validation | S3, clause 4.1 |
| who may trade the perpetuals | the derivatives addendum adds "We may impose or vary eligibility requirements", and names no region | S3, addendum D2.1 |
| excluded regions | no list of supported or excluded jurisdictions is published, and sanctioned persons are excluded | S3, clauses 3.1 and 4.7 |
| US persons | not named anywhere in the terms | S3 |
| regulator of the contracts | none: "not regulated by the Securities and Exchange Board of India or the Reserve Bank of India" | S3, addendum D1.3 |

The terms never name the United States.
A US resident without an Indian PAN and an Indian bank account cannot complete the KYC of clause 4.1, which is an inference from the listed checks and not a stated exclusion.
Every documented public call answered this host with HTTP 200 through the Canadian VPN exit, and no endpoint refused it or served a geoblock page, see [`rest.md`](./rest.md) section 1.
No account was opened, so what the platform does with a non-Indian applicant was not tested.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | with 18 % GST on the fee | source |
|---|---|---|---|---|
| USDT-M perpetuals | 0.018 %, 180 ppm | 0.048 %, 480 ppm | maker 212.4 ppm, taker 566.4 ppm | S1, "Regular User" row |
| INR-M perpetuals | 0.018 %, 180 ppm | 0.048 %, 480 ppm | maker 212.4 ppm, taker 566.4 ppm | S1, "Regular User" row |

The fee page says "Fees applies on order execution (18% GST on fees is applicable)", S1.
The support article also says "Giottus charges 18% GST on trading fees, not on the total trade amount.", S2.
So the cost a taker pays per fill is 480 ppm plus 18 % of it, 566.4 ppm.

The public futures page shows a visitor a fee of zero.
Its inline config sets `buyfee: '0.0%'` and `sellfee: '0.0%'`, and 1,065 of the 1,066 pairs carry `"deductibles": {"fees": {"long": {"maker": "0", "taker": "0"}, "short": {"maker": "0", "taker": "0"}}}`, probe P1.
The one other pair spells its long maker fee `"00"`, which is also zero.
The page script replaces those per-pair fees with `user_details.deductibles.fees` when a user is logged in, at the `Futures.futures.fees` assignment in `futures.min.js` version 2.3.42, S5.
The support article dates the zero fee offer: "Trade smarter with zero fees on all futures trades until October 31, 2025", S2.
That promotion has ended, so the published schedule of S1 is the number this profile records, and the zero on the page is what a logged-out visitor sees.
What a logged-in VIP 0 account is charged today was not verified, since no account was opened.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 533 pairs | `symbol_config` rows quoted in USDT on the futures page, P1 |
| INR-M perpetuals | yes, 533 pairs | the same 533 bases quoted in INR at a fixed 104 INR per USDT, P1 |
| coin-margined perpetuals | no | no pair on the futures page is quoted in anything but USDT or INR, P1 |
| dated futures | no | "Contracts have no expiry date.", S3, addendum D1.2, and no dated symbol in the catalog |
| options | no | the site navigation lists Futures Trading, Easy Buy / Sell, Spot Trading, Refer, Staking, Lend, Basket, SIP, Fixed Rewards, contests and OTC, and no options product, S6 |
| spot | yes, 774 symbols | `GET /api/v1/public/exchange/symbols`, P2, and CoinGecko lists 187 pairs with trust rank 142, S7 |

Each of the 533 bases is listed twice, once per quote.
Both rows of a pair map to one Binance USD-M symbol through `exchange_symbol`, and all 1,066 rows carry `exchange_id` 1, P1.
The support article says "Giottus offers Perpetual Futures with up to 10x leverage", S2, while the page config allows up to 150 on `BTC` and `ETH` in both families and 5 to 100 on the others, P1.

## 4. Perpetual tiers

The futures schedule of S1, retrieved 2026-09-22.
INR-M and USDT-M share every row.

| level | 30 day trade volume | maker | taker | maker ppm | taker ppm |
|---|---|---:|---:|---:|---:|
| Regular User | INR 0 to INR 4.5 crores | 0.018 % | 0.048 % | 180 | 480 |
| VIP 1 | INR 4.5 crores to INR 18 crores | 0.017 % | 0.045 % | 170 | 450 |
| VIP 2 | INR 18 crores to INR 135 crores | 0.016 % | 0.042 % | 160 | 420 |
| VIP 3 | INR 135 crores to INR 450 crores | 0.015 % | 0.039 % | 150 | 390 |
| VIP 4 | INR 450 crores to INR 900 crores | 0.012 % | 0.036 % | 120 | 360 |
| VIP 5 | INR 900 crores to INR 4500 crores | 0.010 % | 0.030 % | 100 | 300 |
| VIP 6 | above INR 4500 crores | 0.008 % | 0.025 % | 80 | 250 |

One crore is ten million rupees.

### Qualification

- "Transaction fees on Giottus is determined by your 30 day trade volume.", S1.
- "Transactions where the fee is 0 will not be included for computing the 30 day trading volume.", S1.
- "Trade volume is calculated daily in INR on a rolling basis", and the level is "updated on a daily basis", S1.
- "VIP fees and benefits gained from any VIP program will apply universally to all Giottus products", S1.
- The spot schedule on the same page is separate: a Regular User pays 0.4 % maker and taker on INR pairs and 0.30 % on crypto pairs, S1.

## 5. Discounts that change the perpetual taker

| discount | effect | status on 2026-09-22 | source |
|---|---|---|---|
| zero fee futures | maker and taker 0 | ended 2025-10-31 by its own wording | S2 |
| zero fee spot on INR pairs | spot only, announced 2023-10-30 | the fee page now lists 0.4 % on INR pairs, so it no longer applies as announced | S4, S1 |
| market maker or high volume | "reach out to us" by email | terms not published | S1 |
| token holding | none published | the fee page names no token discount | S1 |
| referral | a `/referral` page exists, and no effect on the futures fee is published | not verified | S6 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| who pays whom | "A funding payment is exchanged between holders of long and short positions at regular intervals (currently every few hours)." | S3, addendum D7.1 |
| formula | "The exact interval and calculation methodology are published on the Platform", and no such page was found | S3, addendum D7.1 |
| published rate | `funding_rate` equalled Binance `lastFundingRate` on 1,066 of 1,066 rows, in both runs | P1 |
| next settlement | `next_funding_time` equalled Binance `nextFundingTime` on 1,066 of 1,066 rows, in both runs | P1 |
| interval, USDT-M | `funding_frequency` 4 h on 397 pairs, 8 h on 131, 1 h on 5 | P1 |
| interval, INR-M | 4 h on 394 pairs, 8 h on 134, 1 h on 5 | P1 |
| interval against Binance | 5 USDT-M pairs disagree with Binance `fundingInfo`: `G/USDT` 4 h against 1 h, `SPY/USDT` 1 h against 8 h, and `MTL/USDT`, `ONE/USDT` and `T/USDT` 1 h against 4 h | P1 |
| cap and floor | not published by Giottus | none |

The funding rate Giottus shows is Binance's rate for the same contract, so Binance's formula, cap and floor are the ones that move it.
That reading rests on the equality above and on addendum D8.2, which says Giottus depends on third party venues "for reference pricing, liquidity and funding rates".
Whether Giottus charges its users exactly the Binance rate at the Binance instant is not published.
The settlement instant itself was not captured, and no funding history endpoint is public.
The two rows of one contract do not always agree.
`XAU`, `HMSTR` and `BZ` read 4 h on USDT-M and 8 h on INR-M, although both rows name the same Binance symbol, P1.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| liquidation fee | `deductibles.liquidation_fee` per pair, with GST on top: on USDT-M 0.015 on 333 pairs, 0.02 on 160, 0.025 on 28 and 0.0125 on 12, and `HYPE` and `KAS` read 0.015 on USDT-M and 0.02 on INR-M | P1, S3 addendum D6.1 |
| margin call | none: "We are not required to notify you before liquidating a position, and we will not do so." | S3, addendum D4.1 |
| liquidation trigger | "Liquidation is triggered when the Mark price breaches the liquidation price for the position." | S3, addendum D5.2 |
| settlement | none, the contracts have no expiry | S3, addendum D1.2 |
| delisting | 44 pairs listed under `delisted_contracts`, among them `ICX/USDT`, `DF/USDT`, `FUN/USDT` and `MLN/USDT`, and addendum D8.2 allows Giottus to "close positions" when a source delists an asset | P1, S3 |

The unit of `liquidation_fee` is not stated.
Read as a fraction of position value, 0.015 is 1.5 %.
The maintenance margin table of `BTC/USDT` also carries `"close_fee": "0.0006"` on every tier, which the page uses in its liquidation price estimate, P1.

## 8. CCXT

CCXT 4.5.68 has no Giottus class.
`require('ccxt').exchanges` run from `server/` lists 104 ids and none contains `giot`, and `server/node_modules/ccxt/js/src/` holds no such file, probe of 2026-09-23 04:40 UTC.
The current CCXT master, version 4.5.82 at commit `1d8b674434fde39ef282988b066812adf8d19b9e`, imports 105 exchange classes in `ts/ccxt.ts` and none is Giottus, and `ts/src/giottus.ts` returns 404, S8.
So no `market.taker` exists to report.

## 9. Recommended registry values

No registry entry is recommended.
Giottus has no CCXT class, no documented futures API, and its perpetual book and anchors are Binance USD-M's, which the engine already reads, see [`rest.md`](./rest.md) section 8.
If a later design adds it anyway, `takerPpm` should be 566, the 480 ppm VIP 0 taker plus 18 % GST, because the GST is charged on every fill.
`ccxtTakerPpm` stays unset, since there is no CCXT constant to watch.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Giottus Fees | https://www.giottus.com/docs/fees.html | 2026-09-22 | Giottus Technologies, India | spot and futures tiers, GST note, qualification, sections 2, 4 and 5 |
| S2 | Fees & Charges and Trading, Giottus support knowledge base, both modified 2025-11-03 | https://support.giottus.com/portal/en/kb/articles/fees-charges and https://support.giottus.com/portal/en/kb/articles/trading | 2026-09-22 | Giottus Technologies, India | zero fee futures until 2025-10-31, GST, 10x leverage, sections 2, 3 and 5 |
| S3 | User Terms and Conditions, with the Derivatives and Perpetual Futures addendum | https://www.giottus.com/docs/termsandconditions.html | 2026-09-22 | Giottus Technologies, India | entity, eligibility, KYC, funding, index, liquidation, sections 1, 6 and 7 |
| S4 | Giottus zero-fee trading announcement, 2023-10-30, updated 2026-01-09 | https://www.giottus.com/blog/article-zero-fee-trading | 2026-09-22 | Giottus Technologies, India | spot zero fee on INR pairs, section 5 |
| S5 | Giottus futures page script `futures.min.js` version 2.3.42 | https://www.giottus.com/js/pages/2.3.42/futures.min.js | 2026-09-22 | Giottus web front end | logged-in fee replaces the per-pair fee, section 2 |
| S6 | Giottus home page navigation config | https://www.giottus.com/ | 2026-09-22 | Giottus web front end | product list, section 3 |
| S7 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/giottus | 2026-09-22 | CoinGecko | 187 pairs, trust rank 142, and `derivatives/exchanges/giottus` answered 404 "market not found", section 3 |
| S8 | CCXT master `ts/ccxt.ts` | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts | 2026-09-22 | CCXT | no Giottus class, section 8 |
| P1 | `rest-probe.mjs futures` at 04:51 and 05:02 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/giottus/rest-probe.mjs) | 2026-09-22 | this host | page fee config, catalog, funding, liquidation fee, sections 2 to 7 |
| P2 | `rest-probe.mjs spot` at 04:51 and 05:02 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/giottus/rest-probe.mjs) | 2026-09-22 | this host | spot symbol count and access, sections 1 and 3 |
