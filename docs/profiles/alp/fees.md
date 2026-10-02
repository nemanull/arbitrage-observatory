# ALP.COM Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:40 to 05:03 UTC, and the second pass 05:04 to 05:12 UTC, from the development host near Seattle.

ALP.COM is the former BTC-Alpha, a spot exchange with a spot margin wallet and no perpetual market.
CoinGecko lists it under the id `btc_alpha` with the notice "BTC-Alpha has rebranded to ALP.com", S7.
No CCXT 4.5.68 class exists for it, see section 8.
This profile therefore covers ALP.COM spot, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks, and names every other product in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/alp/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/alp/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 | all rows of section 10 |
| operator | "ALPCOM (hereinafter referred to as the company) is a company which operates the website https://alp.com". The terms name no legal form, registration number or jurisdiction | S3 |
| licences | CoinGecko states El Salvador as the country and says the platform "operates under European (Polish) and El Salvador licenses". Not verified against a register | S7 |
| who may trade | registered members, who give their real name and identity documents where applicable law requires it, and margin needs a separate acceptance of the margin agreement | S3, S4 |
| excluded regions | "United States of America [including all U.S.A. territories like Puerto Rico, American Samoa, Guam, Northern Mariana Island, and the US Virgin Islands (St. Croix, St. John and St. Thomas)] the Balkans, Burma, Cote D Ivoire (Ivory Coast), Cuba, Democratic Republic of Congo, Iran, Iraq, Liberia, North Korea, Sudan, Syria, Zimbabwe, the Crimea, Belarus, Afghanistan, Central African Republic, Russian Federation and states with limited recognition" | S3, and the same list in the risk warning S4 |
| US persons | may not use the services, since the United States is the first Restricted Location | S3 |
| terms dates | the terms article carries `date` 1660913827, which is 2022-08-19, and the risk warning 1660915659, the same day | S3, S4 |

Access from this host was open.
Every public REST call and every WebSocket upgrade answered 200 or 101, and nothing was refused for location, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 5.
This laptop sends all traffic through a Surfshark WireGuard tunnel whose exit geolocates to Canada, and Cloudflare's trace reported `loc=CA` with the `SEA` or `YVR` edge.
So every access result in this profile is from that Canadian VPN exit, not from a US address.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, every pair | 0.095 %, 950 ppm | 0.15 %, 1,500 ppm | S1, tier `REGULAR` |
| perpetuals | none listed | none listed | section 3 |

The public tier table carried `"pairs": []`, so no pair had its own rate on 2026-09-22, S1.
The fee example in the API documentation shows `"taker_fee_rate": 0.002` and `"maker_fee_rate": 0.0015`, S5.
That example is a shape for the authenticated `GET /api/v3/accounts/feeinfo` and not the schedule, so the tier table wins.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | no endpoint, channel or page for them in the API documentation S5, and the site bundle labels its "Futures" menu entry "Coming soon", S6 |
| USDC-margined perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | same |
| options | absent | no mention in S5 or S6 |
| spot | present | 22 pairs, 11 quoted in USDT and 11 in USDC, from `GET /api/v3/pairs`, [`rest.md`](./rest.md) section 2 |
| spot margin | present | wallet types `CROSS_MARGIN` and `ISOLATED_MARGIN` in S5, and the margin trading agreement S4 |
| P2P, staking | present | wallet type `P2P` in S5, and the site's `web/p2p` and `web/staking` routes in S6 |

CoinGecko's derivatives exchange list of 2026-09-22 holds 214 entries and none is ALP.COM or BTC-Alpha, S7, and the probe found no perpetual anywhere, so the absence is confirmed rather than assumed.
`GET /api/v3/futures` answered 401 `UNAUTHORIZED`, but so did the made-up path `GET /api/v3/nope`, so the 401 is the API's reply to any unknown path and not a hidden futures route, [`rest.md`](./rest.md) section 6.
Deposit and withdrawal fees are published per method at `https://www.alp.com/api/web/finance/payment-fees`, which backs the page `https://www.alp.com/en/fees`, and are not recorded here.

## 4. Spot tiers

The table is the reply of `https://www.alp.com/api/web/spot/trading-fees` without credentials, which backs the page `https://www.alp.com/en/trading-fees`, S1.

| tier | code | 30 day volume, USDC | or balance, USDC | maker | taker | taker ppm |
|---|---|---:|---:|---:|---:|---:|
| REGULAR | 0 | 0 | 0 | 0.095 % | 0.15 % | 1,500 |
| VIP-1 | 1 | 50,000 | 100,000 | 0.085 % | 0.10 % | 1,000 |
| VIP-2 | 2 | 200,000 | 250,000 | 0.078 % | 0.09 % | 900 |
| VIP-3 | 3 | 500,000 | 500,000 | 0.0675 % | 0.085 % | 850 |
| VIP-4 | 4 | 1,000,000 | 1,000,000 | 0.065 % | 0.08 % | 800 |
| VIP-5 | 5 | 2,000,000 | 3,000,000 | 0.0625 % | 0.075 % | 750 |
| VIP-6 | 6 | 5,000,000 | 5,000,000 | 0.05 % | 0.06 % | 600 |
| VIP-7 | 7 | 10,000,000 | 8,000,000 | 0.04 % | 0.055 % | 550 |
| VIP-8 | 8 | 20,000,000 | 10,000,000 | 0.04 % | 0.05 % | 500 |
| VIP-9 | 9 | 50,000,000 | 20,000,000 | 0.03 % | 0.045 % | 450 |
| PRO-1 | 10 | 100,000,000 | 0 | 0.05 % | 0.06 % | 600 |
| PRO-2 | 11 | 300,000,000 | 0 | 0.04 % | 0.05 % | 500 |
| PRO-3 | 12 | 500,000,000 | 0 | 0.03 % | 0.045 % | 450 |

### Qualification

The reply gives each tier a `min_volume` and a `min_equity`, S1.
The page's own render code prints them as "≥ `min_volume` USDC", then the word "or", then "≥ `min_equity` USDC" under the heading "On Balance", S6.
So a tier is reached by either the volume or the balance.
The page labels the volume "30-Day Spot/Margin Trading Volume" and "Spot trading volume (30 days in USDC)", and the balance "Total Equity", S6.
The PRO tiers carry a balance of 0, so they are reached by volume alone.
PRO-1 and PRO-2 charge more than VIP-9 and PRO-3 charges the same, which suggests a separate track, and the rule that assigns it is Not publicly specified.

## 5. Discounts that change the spot taker

| discount | effect on the VIP 0 taker | source |
|---|---|---|
| paying fees in the ALP token | the switch reads "Use fees in ALP (discount 20%)", and the tier table's ALP column is the rate times 0.8, so 0.12 %, 1,200 ppm | S6 |
| ALP discount plus cashback | the column "Fee Rate ALP (Discount 20% + Cashback 20%)" is the rate times 0.64, so 0.096 %, 960 ppm. When the cashback is paid is Not publicly specified | S6 |
| referral | "A 50% discount on the trading commission charged by the exchange for trading operations", and "This option is also only available within 30 days of the referral's first trade" | S6 |
| market maker, zero fee promotion | none published | S1, S6 |

The public reply carried `"min_token_balance": null` and, for an anonymous caller, `"is_token_deduction": false`, S1.
So the ALP holding that the discount requires is not in the public reply.
The ALP token did not trade on ALP.COM in the 24 h before the probe: `ALP_USDT` had one bid at 0.00001 and a 24 h volume of 0, see [`rest.md`](./rest.md) section 2.

## 6. Funding as a cost

Spot has no funding.
Margin borrowing carries interest, whose schedule sits behind `https://www.alp.com/api/web/margin/loan-conditions`, which returned `[]` without credentials, and `web/margin/options`, which returned 401, S6.
No perpetual exists, so no funding formula, interval or cap applies.

## 7. Liquidation, settlement and delisting

Spot carries no liquidation or settlement charge.
Margin positions are liquidated under the margin trading agreement, S4, whose charges are not recorded here because margin is outside this profile's scope.
No delisting fee is published.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, and the only id matching "alp" is `alpaca`, a different broker whose URLs do not mention alp.com | [`rest-probe.mjs`](../../../scripts/probes/venues/alp/rest-probe.mjs) `ccxt`, both runs |
| `server/node_modules/ccxt/js/src/*.js` | no file mentions `alp.com` or `btcalpha` | grep on 2026-09-22 |
| CCXT master, `ts/src` | 112 entries, and the only one matching "alp" is `alpaca.ts`. `ts/src/alp.ts` answers 404 | S8 |
| history | `ts/src/btcalpha.ts` was renamed `ts/src/alp.ts` in commit `99dc5b32b1`, "feat(alp): migrate btc-alpha to alp.com (#27571)", on 2026-01-15 | S8 |
| history | `ts/src/alp.ts` was removed in commit `fb1502d929`, "fix!(alp): delist (#28221)", on 2026-03-23 | S8 |
| reason | the pull request says "exchange api was reorganized to new (V3) version", that CCXT had "v1 implemented and they were shut down in these last days", and that the exchange "is totally unfunctional now" | S8 |
| last class | `alp.ts` at the parent of `fb1502d929` declared `'version': 'v1'`, `'swap': false`, `'future': false`, and `'maker'` and `'taker'` of `0.002` at lines 178 and 179 | S8 |

So `market.taker` has no value to report: there is no class, no market and no constant.
The retired v1 API that the old class called answered 404 `Not Found` at `https://www.alp.com/api/v1/pairs/`, and `https://btc-alpha.com/api/v1/pairs/` redirects there with 301, see [`rest.md`](./rest.md) section 6.

## 9. Recommended registry values

None.
The engine builds its catalog from CCXT `loadMarkets` filtered to active swaps, at `server/src/ccxt/connector.ts` lines 68 and 79.
ALP.COM has no CCXT class and no swap, so it cannot enter [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) as a perpetual leg.
If a later design ever adds spot legs from a hand-built catalog, the taker is `takerPpm` 1,500, the `REGULAR` tier, and there is no `ccxtTakerPpm` to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ALP.COM trading fee tiers, public JSON behind the trading fees page | https://www.alp.com/api/web/spot/trading-fees | 2026-09-22 | ALP.COM, global | tiers, rates, `pairs: []`, `min_token_balance`, sections 2, 4 and 5 |
| S2 | ALP.COM trading fees page | https://www.alp.com/en/trading-fees | 2026-09-22 | ALP.COM, global | the page S1 feeds, rendered client side, sections 4 and 5 |
| S3 | ALP.COM Terms of Use, article `terms_of_use` | https://www.alp.com/en/terms-of-use, served from https://www.alp.com/api/web/article/terms_of_use | 2026-09-22 | ALPCOM, global | operator, Restricted Locations, section 1 |
| S4 | ALP.COM Risk Warning and Margin Trading Agreement, articles `risk_warnings` and `margin_agreement` | https://www.alp.com/en/risk-warning, served from https://www.alp.com/api/web/article/risk_warnings and https://www.alp.com/api/web/article/margin_agreement | 2026-09-22 | ALPCOM, global | prohibited jurisdictions, margin, sections 1, 3 and 7 |
| S5 | ALP.COM API v3 documentation, pages Introduction, Constants & Enums, Accounts, Balances & Fees | https://docs.alp.com/introduction, https://docs.alp.com/constants, https://docs.alp.com/accounts-and-balances | 2026-09-22 | ALP.COM, global | wallet types, the fee info example, sections 2 and 3 |
| S6 | ALP.COM web app bundle `index.CmRstlDy.js` | https://www.alp.com/s/static/js/index.CmRstlDy.js | 2026-09-22 | ALP.COM, global | "Futures" "Coming soon", fee table columns and multipliers, the "or" between volume and balance, ALP discount and referral strings, `web/` routes, sections 3 to 6 |
| S7 | CoinGecko exchange `btc_alpha`, and the derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/btc_alpha and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | rebrand notice, country, licences claim, trust score 4 and rank 132, 11 tracked pairs, no derivatives entry, sections 1 and 3 |
| S8 | CCXT repository history for `ts/src/btcalpha.ts` and `ts/src/alp.ts`, and pull request 28221 | https://github.com/ccxt/ccxt/pull/28221 and https://github.com/ccxt/ccxt/commits/master/ts/src/alp.ts | 2026-09-22 | CCXT | rename, delisting, reason, last class constants, section 8 |
| P1 | `rest-probe.mjs` `ccxt`, `catalog`, `book`, `errors`, `clock`, then `latency` and `poll`, first pass 04:47 to 05:02 UTC and `all` in the second pass at 05:04 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/alp/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1, 3 and 8 |
| P2 | `ws-probe.mjs` every mode, 04:52 to 05:12 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/alp/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 1 |
