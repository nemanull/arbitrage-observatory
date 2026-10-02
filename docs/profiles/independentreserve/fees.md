# Independent Reserve Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:18 to 03:58 UTC, first pass and second pass, from the development host near Seattle.

This profile covers spot trading on Independent Reserve (CCXT id `independentreserve`), because the venue lists no perpetual, see section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): spot VIP 0 fees and spot tiers stand where the perpetual numbers would.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/independentreserve/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/independentreserve/ws-probe.mjs), and the probe ledger rows are in [`rest.md`](./rest.md) section 9 and [`websocket.md`](./websocket.md) section 9.
Every page in the ledger answered this host with HTTP 200 through plain `curl`, the API page after one 301 redirect, so nothing was read through a third party.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 local time, 2026-09-23 UTC | all rows below |
| operator, Australia and New Zealand | Independent Reserve Pty. Ltd., ABN 46 164 257 069, and the courts of New South Wales have jurisdiction | S2, S5 |
| operator, Singapore | Independent Reserve SG Pte. Ltd., UEN 201942383Z, Major Payment Institution licence PS20200517 | S4 |
| terms last updated | 16 August 2026 for the Australian, New Zealand and Singapore terms | S2, S4, S5 |
| who may trade | residents of the countries listed on the getting started page, individuals of 18 or over and entities | S2, S3 |
| listed countries | Australia, Austria, Belgium, British Virgin Islands, Canada, Cayman Islands, Czech Republic, Denmark, Finland, France, Germany, Greenland, Hong Kong, Hungary, Iceland, Ireland, Isle Of Man, Italy, Japan, Liechtenstein, Luxembourg, Macao, Malaysia, Monaco, Netherlands, New Zealand, Norway, Portugal, Singapore, Slovakia, Slovenia, South Korea, Spain, Sweden, Switzerland, Taiwan, United Arab Emirates, United Kingdom | S3 |
| US persons | may not trade: the United States is not on the list, and the terms say the platform "is not intended to be offered or made available to any person who resides outside of these countries" | S2, S3 |
| Singapore terms | the platform "is available only to users and sub-users with no nexus to high-risk and/or sanctioned jurisdictions" | S4 |

The getting started page says the listed countries are those it can verify instantly, and "being a citizen of one of the aforementioned nations does not automatically entitle you to trade", S3.
The public REST API and the book socket answered this host near Seattle without any refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
CoinGecko gave Independent Reserve a trust score of 7, trust rank 80, and 72.05 BTC of 24 h volume on 97 tickers on 2026-09-22, S7.

## 2. Quick answer

Independent Reserve charges one "brokerage fee" on every trade, with no maker and taker split, S1.

| product | VIP 0 taker | VIP 0 maker | lowest tier | source |
|---|---|---|---|---|
| spot, every pair | 0.50 %, 5,000 ppm | 0.50 %, 5,000 ppm | 0.02 %, 200 ppm, from 200,000,000 AUD of 30 day volume | S1 |

The fee page gives its own example: "if you bought $100 of Bitcoin, you'd pay a standard fee of $0.50", S1.
CCXT reports a taker and a maker of 0.005, 5,000 ppm, for every market, see section 8.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | absent | CCXT sets `'swap': false` at `server/node_modules/ccxt/js/src/independentreserve.js` line 30, and 168 of 168 CCXT markets are `spot` in P1. The API method list has no contract endpoint, S6 |
| dated futures | absent | CCXT `'future': false` at line 31 |
| options | absent | CCXT `'option': false` at line 32 |
| margin, "Leveraged trading" | present on the website only, as a loan against collateral on BTC/AUD, ETH/AUD, XRP/AUD, DOGE/AUD and SOL/AUD, at 2x to 5x, with interest and no funding rate | S8, S9. No leveraged method is in the API method list, S6, and CCXT sets `'margin': false` at line 29 |
| spot | present, 42 base currencies times 4 fiat quotes, AUD, USD, NZD and SGD, 168 markets | P1, P2 |
| OTC desk | present, "from $50,000", by contact | S1 |

The 168 spot markets are one multi-currency book per base currency shown in four fiat currencies, not 168 separate books, see [`rest.md`](./rest.md) section 2.
None is quoted in USDT or USDC: `GetValidSecondaryCurrencyCodes` returns `["Aud","Usd","Nzd","Sgd"]`, and USDT, USDC, RLUSD, AUSD and DAI are base currencies, P1.
Deposit and withdrawal fees are on the fee page, S1, and through the public calls `GetDepositFees`, `GetFiatWithdrawalFees` and `GetCryptoWithdrawalFees2`, S6, and are not recorded here.

## 4. Spot tiers

The discount follows the account's past 30 day trading volume in AUD, S1.

| 30 day volume from, AUD | fee | ppm |
|---:|---:|---:|
| 0 | 0.50 % | 5,000 |
| 50,000 | 0.48 % | 4,800 |
| 100,000 | 0.46 % | 4,600 |
| 200,000 | 0.44 % | 4,400 |
| 300,000 | 0.42 % | 4,200 |
| 400,000 | 0.40 % | 4,000 |
| 500,000 | 0.38 % | 3,800 |
| 600,000 | 0.36 % | 3,600 |
| 800,000 | 0.34 % | 3,400 |
| 1,000,000 | 0.32 % | 3,200 |
| 1,200,000 | 0.30 % | 3,000 |
| 1,400,000 | 0.28 % | 2,800 |
| 1,600,000 | 0.26 % | 2,600 |
| 1,800,000 | 0.24 % | 2,400 |
| 2,000,000 | 0.22 % | 2,200 |
| 2,500,000 | 0.20 % | 2,000 |
| 3,000,000 | 0.18 % | 1,800 |
| 3,500,000 | 0.16 % | 1,600 |
| 4,000,000 | 0.14 % | 1,400 |
| 4,500,000 | 0.12 % | 1,200 |
| 5,000,000 | 0.10 % | 1,000 |
| 10,000,000 | 0.08 % | 800 |
| 15,000,000 | 0.07 % | 700 |
| 30,000,000 | 0.06 % | 600 |
| 50,000,000 | 0.05 % | 500 |
| 100,000,000 | 0.04 % | 400 |
| 150,000,000 | 0.03 % | 300 |
| 200,000,000 | 0.02 % | 200 |

### Qualification

"The trading volume is re-calculated every 4 hours", S1.
"Order fees are calculated at the time the order is placed."
"Existing, open orders will not have their fees adjusted when the trade volume is re-calculated."
The page names no separate schedule for a region, a stablecoin pair or a fiat currency, so the table applies to all 168 markets as far as the page says.
The private `GetBrokerageFees` call returns one fee per base currency code, as CCXT reads it at `independentreserve.js` lines 854 to 884, so a per currency fee is possible for an account, and nothing public shows one.

## 5. Discounts that change the taker

| discount | exists | source |
|---|---|---|
| volume tiers | yes, section 4 | S1 |
| token holding | none published on the fee page | S1 |
| maker rebate or maker schedule | none, one fee for both sides | S1 |
| referral, market maker programme, zero fee promotion | none published on the fee page | S1 |

## 6. Funding as a cost

None on spot.
Independent Reserve lists no perpetual, so no funding rate, interval or settlement exists, see section 3 and [`rest.md`](./rest.md) section 3.

The website's leveraged trading charges interest instead, S1 and S8.
A leveraged buy pays 0.1 % a day and a leveraged sell 0.03 % a day, "accrued every 10 seconds" and "Applied when your position is closed", S1.
It is a loan on the spot book, with a margin call at 15 % and mandatory liquidation below 10 %, S9, and it has no API, so it is not a perpetual leg.

## 7. Liquidation, settlement and delisting

No liquidation or settlement charge exists on spot.
Leveraged trading charges a "Mandatory liquidation fee" of "1% of the total loan amount at closing or partially liquidating the position", S1.
Position open and close fees are free, and the trading fee of section 4 applies to the opening and closing trades, S1.
The public `GetNetworks` call carries `IsDelisted`, which the API page describes as "a permanent delisting has occurred", S6.
The same page adds "Only withdrawals are allowed, no further deposits or trading may occur".
No delisting charge is published.

## 8. CCXT

| item | value | source |
|---|---|---|
| exchange level fees | `'taker': this.parseNumber('0.005')`, `'maker': this.parseNumber('0.005')`, `'percentage': true`, `'tierBased': false` | `server/node_modules/ccxt/js/src/independentreserve.js` lines 180 to 186, taker at line 182, maker at line 183 |
| how a market gets them | `deepExtend(this.safeMarketStructure(), {...}, this.fees['trading'], value)` | `server/node_modules/ccxt/js/src/base/Exchange.js` lines 3732 to 3735 |
| `market.taker` for `BTC/AUD` without credentials | `0.005`, 5,000 ppm, and the same on all 168 markets | P1 |
| `market.maker` for `BTC/AUD` without credentials | `0.005`, and the same on all 168 markets | P1 |
| per account fee | `fetchTradingFees` calls the private `GetBrokerageFees` and sets maker and taker to the one returned `Fee` | `independentreserve.js` lines 850 to 888, the call at line 854 |

CCXT's constant equals the published VIP 0 fee.
CCXT marks the schedule `tierBased: false`, which the 28 tiers of section 4 contradict, and only the VIP 0 value is used by the engine.

## 9. Recommended registry values

None today.
The connector keeps only markets with `type === 'swap'`, `swap === true` and `active !== false`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 203, and logs `no usable swap markets; skipping the venue` when none remain, at lines 49 to 52.
Independent Reserve would contribute zero markets, so a registry entry would do nothing.

If a later design ever admits spot legs, the values would be `takerPpm: 5000` and `ccxtTakerPpm: 5000`.
The reason is that CCXT's constant at `independentreserve.js` line 182 equals the published VIP 0 fee, S1.
A spot leg quoted in USD would fall in the USD, USDC and USDT settlement family, and the `Xbt/Usd` book is mostly converted AUD orders, see [`rest.md`](./rest.md) section 2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees | https://www.independentreserve.com/fees | 2026-09-22 | Independent Reserve, all regions | fee, tiers, qualification, leveraged trading fees, OTC floor, sections 2 to 7 |
| S2 | Terms and conditions, Australia | https://www.independentreserve.com/help/terms-and-conditions | 2026-09-22 | Independent Reserve Pty. Ltd. | entity, eligibility, jurisdiction, last updated, section 1 |
| S3 | Getting Started | https://www.independentreserve.com/au/help/getting-started | 2026-09-22 | Independent Reserve, all regions | country list, section 1 |
| S4 | Terms and conditions, Singapore | https://www.independentreserve.com/sg/help/terms-and-conditions | 2026-09-22 | Independent Reserve SG Pte. Ltd. | Singapore entity, licence, eligibility, section 1 |
| S5 | Terms and conditions, New Zealand | https://www.independentreserve.com/nz/help/terms-and-conditions | 2026-09-22 | Independent Reserve Pty. Ltd. | New Zealand operator, section 1 |
| S6 | API | https://www.independentreserve.com/features/api, redirected from https://www.independentreserve.com/API | 2026-09-22 | Independent Reserve, all regions | public and private method list, `GetBrokerageFees`, `GetNetworks` `IsDelisted`, sections 3, 4 and 7 |
| S7 | CoinGecko exchange API, `independent_reserve` | https://api.coingecko.com/api/v3/exchanges/independent_reserve | 2026-09-22 | CoinGecko | trust score, trust rank, 24 h volume, ticker count, section 1 |
| S8 | Leveraged trading | https://www.independentreserve.com/features/leveraged-trading | 2026-09-22 | Independent Reserve, Australia | the five AUD pairs, section 3 |
| S9 | Leveraged Trading Terms and Conditions, last updated 29 June 2026 | https://www.independentreserve.com/help/leveraged-trading-terms-and-conditions | 2026-09-22 | Independent Reserve Pty. Ltd. | loan structure, leverage of 2x to 5x, margin call at 15 % and liquidation below 10 %, sections 3 and 6 |
| S10 | CCXT 4.5.68 `independentreserve.js` | `server/node_modules/ccxt/js/src/independentreserve.js` | 2026-09-22 | CCXT | fee constants, `fetchTradingFees`, product flags, sections 3 and 8 |
| P1 | `rest-probe.mjs main` at 03:21 and 03:53 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/independentreserve/rest-probe.mjs) | 2026-09-22 | this host | CCXT market count, `market.taker` and `market.maker`, secondary codes, sections 3 and 8 |
| P2 | `rest-probe.mjs sweep` at 03:23 and 03:54 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/independentreserve/rest-probe.mjs) | 2026-09-22 | this host | every listed pair answers with a two-sided book, section 3 |
