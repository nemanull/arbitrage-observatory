# Flipster Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 06:33 to 06:51 UTC, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the fees of Flipster's perpetual swaps, the only derivative family the venue lists.
Flipster has no CCXT class, and its Trading API serves market data only to holders of an API key, see [`rest.md`](./rest.md) section 2.
So every fee number below comes from the published schedule and the help center, not from an endpoint.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | help center articles through the Zendesk JSON API and the fee page at `flipster.io/support/guide/fees`, read with curl on 2026-09-23 UTC | S1 to S12 |
| legal entity | Flipster Corp, "a company incorporated under the laws of the Republic of Panama", Terms of Use last updated 24 June 2026 | S13 |
| other registration | CoinGecko lists the country as Seychelles and the year established as 2021 | S16 |
| who may trade | anyone not a national or resident of a Prohibited Jurisdiction, and not present in one | S13, S14 |
| excluded regions | 62 entries on the country restrictions page, updated 2026-09-02, among them the United States of America, American Samoa, Guam, the US Virgin Islands, China, Singapore, the United Arab Emirates, Poland except users onboarded before 23 January 2026, Iran, North Korea, Cuba, Syria and Venezuela | S14 |
| US persons | may not trade, the United States of America is on the list | S14 |
| Canada | not on the list | S14 |
| API trading | "currently available through a private launch and is accessible to a limited group of selected users", access by request to the Support Center | S15 |

All access results in these profiles were read from this laptop through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada.
The Trading API echoed that exit back as `x-prex-ipcountry: CA` and `x-prex-ipcity: Vancouver`, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-margined perpetual swaps, crypto and TradFi | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S1, S2, S3 |
| USD1-margined perpetual swaps | 0.02 %, 200 ppm | 0.06 %, 600 ppm, the fee article says USD1 pairs are charged "in the same way" | S2 |

The schedule has one column for maker, headed "Maker Fee (Futures Only)", and one for taker, headed "Taker Fee (Spot & Futures)", S1 and S2.
The same numbers appear on the fee guide page, on the "Trading Fees Explained" article updated 2026-09-09, and in the notice of the schedule that took effect on 21 January 2026 at 07:00 UTC, S1 to S3.
The zero spreads article still gives "0.05% at the Basic tier" as an example, which is the taker of the schedule that ran from 4 August 2025 to 21 January 2026, S9 and S10.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetual swaps | yes, 242 contracts named `<BASE>USDT.PERP` | the website's own stream on 2026-09-23, [`rest.md`](./rest.md) section 2 |
| TradFi perpetual swaps on commodities, equities, ETFs and indices | yes, inside the same USDT family, for example `XAUUSDT.PERP`, `CLUSDT.PERP`, `NVDAUSDT.PERP`, `SPYUSDT.PERP` | S11, and the same stream |
| USD1-margined perpetual swaps | documented, none listed | the fee, funding and zero spread articles name USD1 pairs, S2, S6, S9, and the stream listed no USD1 contract |
| coin-margined or USDC-margined perpetuals | absent | no document names one, and the stream listed none |
| dated futures | absent | CoinGecko lists 0 futures pairs, S16 |
| options | absent | no document names one |
| spot | present, 6 pairs on the website stream | the Trading API documentation names spot and perpetual markets, S15 |

## 4. Perpetual tiers

One table covers every perpetual, effective 21 January 2026 at 07:00 UTC, S1 to S3.
The tier is reached by 30 day trade volume or by 24 hour average asset balance, whichever qualifies.

| tier | 30 day volume, million USDT | 24 h average balance, USDT | maker % | maker ppm | taker % | taker ppm |
|---|---:|---:|---:|---:|---:|---:|
| VIP 0 (Basic) | | | 0.02 | 200 | 0.06 | 600 |
| VIP 1 | 0.5 | 10,000 | 0.02 | 200 | 0.058 | 580 |
| VIP 2 | 1 | 20,000 | 0.019 | 190 | 0.056 | 560 |
| VIP 3 | 5 | 40,000 | 0.019 | 190 | 0.052 | 520 |
| VIP 4 | 10 | 100,000 | 0.018 | 180 | 0.048 | 480 |
| VIP 5 | 30 | 200,000 | 0.018 | 180 | 0.044 | 440 |
| VIP 6 | 50 | 400,000 | 0.015 | 150 | 0.04 | 400 |
| VIP 7 | 75 | 500,000 | 0.015 | 150 | 0.038 | 380 |
| VIP 8 | 100 | | 0.013 | 130 | 0.036 | 360 |
| VIP 9 | 300 | | 0.011 | 110 | 0.035 | 350 |
| VIP 10 | 500 | | 0.011 | 110 | 0.033 | 330 |
| VIP 11 | 1,000 | | 0.01 | 100 | 0.025 | 250 |

### Qualification

- USD1 balances count toward the balance column, converted to USDT at the market rate, S1 and S4.
- "Only the portion of trading fees paid with a user's own capital will be counted toward the VIP tier Trading Volume calculations.", S4.
- The fee is "Filled Quantity * Executed Price * Taker Fee or Maker Fee", S2.

### Spot, for the coverage matrix only

The spot article, updated 2026-09-11, says spot is charged taker only and that "a Taker fee of 0.05% applies to all Spot trades" for basic users, S5.
The VIP table puts spot under the 0.06 % taker column, S1 and S2.
The two sources disagree, and neither was checked against a fill.

## 5. Discounts that change the perpetual taker

| discount | effect on the VIP 0 taker | source |
|---|---|---|
| token holding | none, Flipster has no exchange token in its fee schedule | S1 to S4 |
| referral | none for the trader, the referrer earns 25 % of the referee's fees for 365 days | S10 |
| fee vouchers | vouchers pay fees, and the part paid by voucher does not count toward the tier | S4, S12 |
| market maker program | Not publicly specified | |
| zero fee promotion | the TradFi Zero-Fee Trading Carnival refunded fees as vouchers to new users from 13 July to 22 July 2026, and it has ended | S12 |
| VIP boost | existing VIP users got a one-time 90 day tier boost from 21 January 2026, which has lapsed | S3 |

No promotion that lowers the VIP 0 taker was running on 2026-09-22.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| payment | "Notional Value of Positions * Funding Rate", notional = contracts times mark price | S6 |
| direction | a positive rate is paid by longs to shorts, and a negative rate by shorts to longs | S6 |
| who is charged | holders at the funding timestamp only, and "Funding fees are transferred directly between position holders without additional platform costs." | S6 |
| settlement window | about 5 s around the timestamp, and opening or closing within 5 s before or after "does not ensure eligibility" | S6 |
| interval | "typically charged every 8 hours", and "it varies between the contracts traded", published as `fundingIntervalHours` in the contract, ticker and funding calls that need a key | S19, S20 |
| formula | `[Avg(P) + clamp(Avg(I) - Avg(P), 0.05%, -0.05%) + small adjustment term] / (8/N)`, with `N` the interval in hours, since 18 September 2025 08:01 UTC | S6, S8 |
| averaging | minute samples over an 8 h window, linearly weighted, `(1*x(1) + ... + 480*x(480)) / (1 + ... + 480)` | S6 |
| interest term | flat 0.01 % per 8 h, 0.03 % a day | S6 |
| premium index | `[max(0, impact bid - index) - max(0, index - impact ask)] / index` | S6 |
| cap and floor | `abs(rate) <= 75% * maintenance margin rate`, so ETH at 0.5 % maintenance margin is capped at plus or minus 0.375 %, and Flipster may change it "in extreme market conditions" | S6 |
| adjustment term | "designed to help correct extreme position skewness", formula not published | S6 |
| TradFi when the market is closed | the funding rate is "Frozen at last available rate" | S11 |
| settlement currency | USDT for USDT pairs, USD1 for USD1 pairs | S6 |

The settlement instant itself was not captured, because no public call returns funding history, see [`rest.md`](./rest.md) section 4.
On 2026-09-23 at 06:41 and 06:51 UTC the website stream showed a next funding time of 08:00 UTC on 240 contracts and 16:00 UTC on 2, `RDDTUSDT.PERP` and `INFQUSDT.PERP`, P5.
That table carries no interval, so which interval each contract uses was not read.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation trigger | mark price reaching the liquidation price, while TP and SL orders trigger on the mid price | S17 |
| liquidation fee | Not publicly specified in the liquidation articles read | S17 |
| delisting settlement | positions left open are closed at a mark equal to the 1 h time weighted average of the index, sampled each second and weighted linearly, over the hour before trading support ends | S7 |
| delisting fee | "Auto-settlement Fee = Qty * Mark Price * Taker Fee", at the user's own taker | S7 |
| deposit | no fee | S1 |
| withdrawal | per network, listed on the fee guide page, for example 1 USDT on Ethereum and 0.3 USDT on Tron | S1 |

## 8. CCXT

CCXT 4.5.68 has no Flipster class.
`require('ccxt').exchanges` run from `server/` lists 104 ids, and none matches `flip`, P1.
The CCXT master branch at commit `1c996ee07ed6f5c03c7097b2d46d8a8c0eeb5adb`, committed 2026-09-23 05:45 UTC, has 105 TypeScript files in `ts/src` and no `flipster.ts`, the raw URL returns 404, and a GitHub search of `repo:ccxt/ccxt flipster` returns 0 issues and pull requests, S18.
So there is no `market.taker` to report and no CCXT source line to cite.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 perpetual taker, 0.06 %, S1 to S3 |
| `ccxtTakerPpm` | none | no CCXT class exists, so the connector has nothing to compare |

The values only matter once Flipster can be catalogued and fed, which the current access rules prevent, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees guide, section 7 | https://flipster.io/support/guide/fees | 2026-09-23 UTC | Flipster Corp | tier table, deposit and withdrawal fees, sections 2 to 4 and 7 |
| S2 | Trading Fees Explained, updated 2026-09-09 | https://support.flipster.io/hc/en-us/articles/7377678029327-Trading-Fees-Explained | 2026-09-23 UTC | Flipster Corp | tier table, fee formula, USD1 pairs, sections 2 and 4 |
| S3 | Important Flipster VIP Program Updates, January 6, 2026 | https://support.flipster.io/hc/en-us/articles/14799610565263-Important-Flipster-VIP-Program-Updates-January-6-2026 | 2026-09-23 UTC | Flipster Corp | effective date 21 January 2026, boost, sections 2, 4 and 5 |
| S4 | Trading Fees and the VIP Tier System, updated 2026-02-13 | https://support.flipster.io/hc/en-us/articles/13335286933263-Trading-Fees-and-the-VIP-Tier-System | 2026-09-23 UTC | Flipster Corp | qualification, vouchers, section 4 |
| S5 | How Trading Fees Are Charged in Spot Trading, updated 2026-09-11 | https://support.flipster.io/hc/en-us/articles/13401934214799-How-Trading-Fees-Are-Charged-in-Spot-Trading | 2026-09-23 UTC | Flipster Corp | spot 0.05 % taker, section 4 |
| S6 | Funding Fees Explained, updated 2026-09-09 | https://support.flipster.io/hc/en-us/articles/7352897276687-Funding-Fees-Explained | 2026-09-23 UTC | Flipster Corp | funding formula, cap, window, section 6 |
| S7 | Delisting of Contracts, updated 2025-09-18 | https://support.flipster.io/hc/en-us/articles/7376922453519-Delisting-of-Contracts | 2026-09-23 UTC | Flipster Corp | delisting mark and fee, section 7 |
| S8 | Changes to funding rate and mark price calculation, September 18, 2025 | https://support.flipster.io/hc/en-us/articles/13803308706319-Changes-to-funding-rate-and-mark-price-calculation-September-18-2025 | 2026-09-23 UTC | Flipster Corp | the `/(8/N)` scaling, section 6 |
| S9 | Understanding Zero Spreads Trading, updated 2026-02-15 | https://support.flipster.io/hc/en-us/articles/13270529471247-Understanding-Zero-Spreads-Trading | 2026-09-23 UTC | Flipster Corp | the 0.05 % example, USD1 pairs, sections 2 and 3 |
| S10 | Trading Fees, VIP Tiers, Referral Update, and Zero Spreads, effective August 4 | https://support.flipster.io/hc/en-us/articles/13257079157647-Trading-Fees-VIP-Tiers-Referral-Update-and-Zero-Spreads-Effective-August-4 | 2026-09-23 UTC | Flipster Corp | the 2025 schedule, referral share, sections 2 and 5 |
| S11 | TradFi Trading Hours & Pricing, updated 2026-04-29, and TradFi Contracts Available & Specifications | https://support.flipster.io/hc/en-us/articles/15957330955407-TradFi-Trading-Hours-Pricing | 2026-09-23 UTC | Flipster Corp | TradFi family, frozen funding, sections 3 and 6 |
| S12 | 10,000 USDT Pool TradFi Zero-Fee Trading Carnival, 260713 | https://support.flipster.io/hc/en-us/articles/16791909745167-10-000-USDT-Pool-TradFi-Zero-Fee-Trading-Carnival-260713 | 2026-09-23 UTC | Flipster Corp | ended promotion, section 5 |
| S13 | Terms of Use, last updated 24 June 2026 | https://flipster.io/policies/terms | 2026-09-23 UTC | Flipster Corp, Panama | entity, Prohibited Jurisdictions clauses 1.5 and 5.2, section 1 |
| S14 | Flipster Country Restrictions, updated 2026-09-02 | https://support.flipster.io/hc/en-us/articles/7377472797967-Flipster-Country-Restrictions | 2026-09-23 UTC | Flipster Corp | excluded regions, section 1 |
| S15 | Flipster API Documentation, Introduction | https://api-docs.flipster.io/readme.md | 2026-09-23 UTC | Flipster Corp | private launch, spot and perpetual markets, section 1 |
| S16 | CoinGecko derivatives exchange `aqx_derivatives` | https://api.coingecko.com/api/v3/derivatives/exchanges/aqx_derivatives?include_tickers=unexpired | 2026-09-23 UTC | CoinGecko | 243 perpetual pairs, 0 futures, Seychelles, 2021, sections 1 and 3 |
| S17 | Liquidation of Position Explained, updated 2026-09-10 | https://support.flipster.io/hc/en-us/articles/9385026733071-Liquidation-of-Position-Explained | 2026-09-23 UTC | Flipster Corp | mark and mid triggers, section 7 |
| S18 | CCXT master, `ts/src` listing and search | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 UTC | CCXT | no Flipster class, section 8 |
| S19 | Funding Fees FAQ, updated 2025-08-04 | https://support.flipster.io/hc/en-us/articles/8677390412303-Funding-Fees-FAQ | 2026-09-23 UTC | Flipster Corp | funding interval, section 6 |
| S20 | Flipster API Documentation, Market pages | https://api-docs.flipster.io/api-reference/market.md | 2026-09-23 UTC | Flipster Corp | `fundingIntervalHours` field, section 6 |
| P1 | `rest-probe.mjs access` | [`rest-probe.mjs`](../../../scripts/probes/venues/flipster/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | CCXT 4.5.68 class list, section 8 |
| P5 | `ws-probe.mjs catalog` at 06:41 and 06:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/flipster/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | contract count and next funding times, sections 3 and 6 |
