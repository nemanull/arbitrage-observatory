# Koinpark Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:13 to 03:44 UTC, from the development host near Seattle.

Koinpark is CoinGecko's trust rank 70 in the survey list and rank 71 in CoinGecko's API on 2026-09-23 03:14 UTC.
It lists no perpetual and it has no CCXT class, so this profile covers the spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Fee numbers come from the official fee page, whose per pair table is embedded in the page's server rendered payload and was parsed from it, S1.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/koinpark/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/koinpark/ws-probe.mjs).

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-09-22 local time for every source row | source ledger |
| operator | Koinpark Private Limited, company registration number `U62099TN2023PTC162115`, governed by Indian law | S3 introduction and section 25, S4, the footer of every page |
| CoinGecko listing | "Koinpark", country India, established 2023, trust score 7, trust rank 71, 82 coins, 136 pairs, 24 h volume 254.3 BTC | S7, read 2026-09-23 03:14 UTC |
| products | spot only, with INR, USDT, BTC and ETH quotes | section 3 |
| who may trade | anyone 18 or older whose registration and KYC the company approves at its sole discretion | S3 section 5 |
| excluded regions | none named in the Terms, which only require users to be absent from sanctions lists | S3 section 14 |
| US persons | not excluded by name. The sign-up form offers a country dial code picker that defaults to +91, and the fiat rails are Indian (UPI, IMPS, NEFT, RTGS). Whether KYC accepts a US person is Not verified | S3 section 10, S12 |
| Indian regulatory registration | the site names none, and the FIU-IND list could not be read from this host or the fetch tool, so it is Not verified | S13 |
| automated trading | the Terms prohibit "Deploying scraper bots, spiders, or miners" and "Utilizing unauthorized algorithmic high-frequency scripts" | S3 section 12.2 (k) and (o) |
| public API access from this host | REST and WebSocket both answered, no refusal, through Cloudflare's Seattle or Vancouver edge | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | evidence |
|---|---|---|---|
| spot, `BTC/USDT`, `ETH/USDT`, `BTC/INR`, `USDT/INR` and 175 other pairs | 0.4 %, 4,000 ppm | 0.4 %, 4,000 ppm | S1 |
| spot, 37 small token pairs such as `XDC/USDT` and `USDG/INR` | 0.25 %, 2,500 ppm | 0.25 %, 2,500 ppm | S1 |
| spot, `PEPE/INR` | 0.5 %, 5,000 ppm | 0.5 %, 5,000 ppm | S1 |

The fee is charged per pair, and maker equals taker on every one of the 217 pairs the fee page lists.
The fee page's banner reads "New Fee Model Is Officially Live", and it says trading fees "will now be deducted from the quote currency", S1.

The public API disagrees.
`GET /publicApi/asset` returns `"maker_fee":"0.25","taker_fee":"0.25"` on all 209 assets, including BTC and USDT, in P1.
It is keyed by asset rather than by pair, and it does not match the 0.4 % the fee page shows for `BTC/USDT`.
This profile takes the fee page as the schedule and records the API field as a disagreement.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | no futures page in the site map, S10, no futures entry in the menu, and CoinGecko's derivatives list of 214 venues has no Koinpark, S8 |
| USDC-M perpetuals | absent | same |
| coin-M perpetuals | absent | same |
| dated futures | absent | same |
| options | absent | same |
| margin | absent | no margin page in the site map, S10 |
| spot | present, 215 pairs in `/publicApi/markets`: 115 INR, 93 USDT, 4 BTC, 3 ETH | P1 |
| demo trade | present at `expo.koinpark.com`, not researched | S10, the site bundle names it `demotrade` |

## 4. Spot tiers

The fee page publishes no volume tier, VIP level or token holding tier, S1.
Its table has one maker and one taker rate per pair and a minimum trade, which is 200 INR on 110 of 115 INR pairs, 2 USDT on 93 of 95 USDT pairs, 0.0005 BTC on the 4 BTC pairs and 0.006 ETH on the 3 ETH pairs.

| rate, maker and taker | pairs on 2026-09-22 | quotes |
|---|---:|---|
| 0.4 % | 179 | 93 INR, 79 USDT, 4 BTC, 3 ETH |
| 0.25 % | 37 | 21 INR, 16 USDT |
| 0.5 % | 1 | `PEPE/INR` |

The 0.25 % pairs are small or venue local tokens, among them `ABCDS/USDT`, `BCOINPLUS/INR`, `METAKPK/INR`, `XDC/INR` and `XDC/USDT`.

## 5. Discounts that change the spot taker

| programme | effect on the taker | evidence |
|---|---|---|
| market maker programme | "Reduced trading fees" for makers with 30 day volume of 5 million USDT or more, spot only, rates not published | S5 |
| affiliate programme | the referrer earns "Up to 50% Share" of fees, and no discount to the referred trader is stated | S6 |
| franchise | a franchisee earns 60 % of trading fees, which is a revenue share and not a discount | the site menu, S1 |
| token holding | none published | S1 |
| zero fee promotion | none on the fee page on 2026-09-22 | S1 |

## 6. Funding as a cost

Koinpark lists no perpetual, so it charges no funding.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement fee.
A delisting policy page exists in the footer and was not researched.
Deposit and withdrawal fees are listed per network on the fee page's second tab, S1, and `GET /publicApi/asset` also returns `min_withdraw` and `max_withdraw` per asset, P1.

## 8. CCXT

CCXT 4.5.68 has no Koinpark class.
`node -e "console.log(require('ccxt').exchanges)"` run from `server/` printed 104 ids and none matched `koin` or `park`, and `grep -rli koinpark server/node_modules/ccxt/js/src/` found nothing.
The current CCXT master on GitHub has 105 TypeScript files in `ts/src`, none named after Koinpark, and `ts/src/koinpark.ts` returned 404 from `raw.githubusercontent.com`, S9.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
Koinpark has no perpetual, so it has nothing to put in [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts).
If the engine ever took spot legs, the number would be `takerPpm` 4,000 for the major pairs, from the fee page, with no `ccxtTakerPpm`, since no CCXT class exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Koinpark, Trading, Deposit and Withdrawal Fees | https://www.koinpark.com/fees | 2026-09-23 03:13 UTC | Koinpark Private Limited, India | per pair maker and taker, minimum trade, fee from the quote currency, sections 2, 4, 5 and 7 |
| S2 | Koinpark Market REST API Documentation | https://www.koinpark.com/api | 2026-09-23 03:14 UTC | Koinpark | the public endpoints, read from the page's script bundle because the page renders in the browser, see [`rest.md`](./rest.md) |
| S3 | Terms and Conditions, "Last Updated: May 2026" | https://www.koinpark.com/terms-and-conditions | 2026-09-23 03:33 UTC | Koinpark Private Limited, Indian law | operator, eligibility, fiat rails, restricted activities, section 1 |
| S4 | Risk Disclosure Statement | https://www.koinpark.com/risk-disclosure-agreement | 2026-09-23 03:33 UTC | Koinpark Private Limited | operator name, section 1 |
| S5 | Market Maker Program | https://www.koinpark.com/market-maker-program | 2026-09-23 03:33 UTC | Koinpark | reduced fees above 5 million USDT a month, section 5 |
| S6 | Affiliate Program | https://www.koinpark.com/affiliate-program | 2026-09-23 03:35 UTC | Koinpark | referral share, section 5 |
| S7 | CoinGecko exchange API, `koinpark` | https://api.coingecko.com/api/v3/exchanges/koinpark | 2026-09-23 03:14 UTC | CoinGecko | trust rank, country, volume, section 1 |
| S8 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 03:31 UTC | CoinGecko | 214 venues, no Koinpark, section 3 |
| S9 | CCXT `ts/src` on master | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 03:12 UTC | CCXT | no Koinpark class, section 8 |
| S10 | Koinpark site maps | https://www.koinpark.com/static/sitemap.xml | 2026-09-23 03:14 UTC | Koinpark | 42 static pages, none for futures or margin, section 3 |
| S11 | Corporate Account | https://www.koinpark.com/corporate-account | 2026-09-23 03:34 UTC | Koinpark | entity PAN and CIN for corporate sign-up, section 1 |
| S12 | Koinpark sign-up page script bundle | https://www.koinpark.com/register | 2026-09-23 03:35 UTC | Koinpark | a country dial code list loaded from the backend with +91 as default, section 1 |
| S13 | FIU-IND page for registered reporting entities | https://fiuindia.gov.in/files/Compliance_Orders/vda.html | 2026-09-23 03:34 UTC | FIU-IND | returned "The requested URL was rejected", so the registration is Not verified |
| P1 | `rest-probe.mjs catalog`, runs at 03:26 and 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/koinpark/rest-probe.mjs) | 2026-09-23 | this host | pair counts, the `asset` fee field, sections 2 and 3 |
