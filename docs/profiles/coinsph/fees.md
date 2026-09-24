# Coins.ph Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, from the development host near Seattle, between 03:15 and 03:40 UTC on 2026-09-23.

This profile covers the trading fees of Coins.ph (CCXT id `coinsph`, CoinGecko id `coinspro`, trust rank 48).
Coins.ph lists no perpetual, so this profile follows change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) and records the spot market.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/coinsph/rest-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| legal entities | Betur, Inc. and DCPay Philippines, Inc., operating together as "coins.ph" | S5, S6 |
| licences | Betur is registered with the Bangko Sentral ng Pilipinas as a virtual asset service provider, remittance and transfer company, money changer, foreign exchange dealer and virtual currency exchange. DCPay is an electronic money issuer | S6, S7 |
| who may trade | account holders of legal age who pass identity checks. The help center describes the platform as "primarily for users in the Philippines" | S5, S8 |
| excluded regions | residents, personal accounts and entities of 17 listed territories: Central African Republic, Cuba, North Korea, Democratic Republic of Congo, Guinea-Bissau, Iran, Iraq, Libya, Mali, Pakistan, Russia, Somalia (written "Somali"), South Sudan, Sudan, Syria and Yemen, plus any jurisdiction under Philippine, AMLC, ATC, UN or OFAC sanctions | S5, S8 |
| US persons | not named in the restriction language of the user agreement effective 2026-04-16, and the United States is not on the help center list | S5, S8 |
| products | spot order book (branded Spot Trade), convert, OTC for business accounts, fiat cash in and out | S1, S5 |
| perpetuals | none, see section 3 | P1 |
| retrieval date | 2026-09-22 | |

The user agreement mentions no futures, derivatives, margin or perpetual contract, S5.
The account requirement for residency outside the Philippines was not verified, since no account was opened.

Access from this host was open.
`api.pro.coins.ph`, `wsapi.pro.coins.ph` and `www.coins.ph` resolved to the Cloudflare addresses 104.18.22.77 and 104.18.23.77, and the `cf-ray` headers named the Seattle edge `SEA`, and in the second pass also Vancouver `YVR`, P1.
No REST call returned 403, 418 or 429, and every WebSocket upgrade returned 101, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 5.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, every pair | 0.10 %, 1,000 ppm | 0.15 %, 1,500 ppm | S2 and S3, and `/biz-api/v1/public/spot/user-level` in P1 |

The schedule has applied since 2025-08-08 08:00 PHT, when Coins.ph lowered spot fees across all VIP tiers, S2.
The same numbers came back from the public fee call the fee page itself uses, `GET https://www.coins.ph/biz-api/v1/public/spot/user-level`, as `spotBuyMakerDiscount` `"0.001"` and `spotBuyTakerDiscount` `"0.0015"` for `VIP 0`, P1.
The fee is taken from the asset received, "Fee = Fee rate × Amount of bought crypto when order was filled", S4, and CCXT agrees with `'feeSide': 'get'` at `server/node_modules/ccxt/js/src/coinsph.js` line 298.

## 3. Coverage matrix

| product | Coins.ph | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | the API reference S1 has no futures section, and the web app's futures catalog `GET https://www.coins.ph/future-api/v1/public/config/exchange-info` returned `{"status":0,"error":"OK","data":{"symbolList":[],"marketList":[],"tokenList":[]}}`, P1 |
| USDC-margined perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | same |
| options | absent | same |
| margin | absent | CCXT `'margin': false` at `coinsph.js` line 29 |
| spot | present, 71 pairs `trading` and 113 `break` of 184, researched here | P1, [`rest.md`](./rest.md) section 2 |

The web front end is shared across the group's brands, and its fee page code requests the futures tier table for the `GLOBAL`, `AU`, `EU` and `PH` brokers, S4.
For Coins.ph that table is empty: `GET https://www.coins.ph/future-api/v1/public/fee/user-level` returned `{"status":0,"error":"OK","data":[]}`, P1.
The sister brand Coins.xyz does list three USDT perpetuals, `BTCUSDT`, `ETHUSDT` and `SOLUSDT`, with a VIP 0 taker of `"0.0008"` and maker of `"0.00025"`, from `https://www.coins.xyz/future-api/v1/public/config/exchange-info` and `/future-api/v1/public/fee/user-level`, P1.
Coins.xyz is a separate brand and venue outside this profile, and CCXT 4.5.68 has no class for it.
CoinGecko's derivatives list of 2026-09-22 does not show Coins.ph either.

## 4. Spot tiers

| tier | 30 day spot volume, PHP | maker | taker | taker ppm |
|---|---:|---:|---:|---:|
| VIP 0 | below 500,000 | 0.10 % | 0.15 % | 1,500 |
| VIP 1 | 500,000 | 0.09 % | 0.13 % | 1,300 |
| VIP 2 | 2,000,000 | 0.08 % | 0.12 % | 1,200 |
| VIP 3 | 5,000,000 | 0.07 % | 0.11 % | 1,100 |
| VIP 4 | 10,000,000 | 0.06 % | 0.10 % | 1,000 |
| VIP 5 | 100,000,000 | 0.05 % | 0.09 % | 900 |
| VIP 6 | 500,000,000 | 0.05 % | 0.08 % | 800 |
| VIP 7 | 1,000,000,000 | 0.04 % | 0.07 % | 700 |
| VIP 8 | 2,000,000,000 | 0.04 % | 0.06 % | 600 |
| VIP 9 | 5,000,000,000 | 0.03 % | 0.05 % | 500 |

The table is S2, and the public fee call returned the same ten rows with the same thresholds in PHP under the condition key `30dSpotTradeAmountBtc`, P1.

### Qualification

- The tier follows the spot trading volume of the last 30 days, across all pairs, valued in PHP, S2 and S3.
- The tier is recalculated daily, S9.
- Cash in and cash out do not count toward the volume, S3.
- No maker rebate is published in the tiers, but the fee page carries the note "All Maker rebates will be distributed within 7 working days after the end of each month.", S4, which implies an unpublished rebate arrangement.

## 5. Discounts that change the taker

| discount | effect | source |
|---|---|---|
| token holding | none published | S1 to S3 |
| referral | a user who signs up with a referral code may "get rebates or discounts on trading fees", with no rate stated. CCXT records a referral discount of 0.2 at `coinsph.js` lines 186 to 189 | S10 |
| market maker | the monthly maker rebate note in section 4, terms not published | S4 |
| zero fee promotion | none current. CCXT still carries the comment "zero fees for USDT, ETH and BTC markets till 2023-04-02" at `coinsph.js` line 296, a promotion that ended in 2023 | CCXT |

## 6. Funding as a cost

None.
Coins.ph lists no perpetual, so there is no funding rate, interval, cap or settlement, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

Spot has no liquidation, margin call or settlement charge.
A delisting follows a notice in the help center.
For WLD the notice gave a deposit suspension on 2026-08-24, a convert buy suspension on 2026-08-28, and the end of convert sell and of the token on 2026-08-31, all at 15:00 PHT, while withdrawals stayed open "until further notice", S11.
`WLDPHP` read `break` in `exchangeInfo` on 2026-09-23 UTC, P1.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `coinsph`, spot only: `'spot': true`, `'swap': false`, `'future': false`, `'option': false` | `server/node_modules/ccxt/js/src/coinsph.js` lines 28 to 32 |
| per market `taker` and `maker` | `undefined` on every market, set explicitly by `fetchMarkets` | `coinsph.js` lines 841 and 842, and `takerValues: ["undefined"]` over 184 markets in P1 |
| exchange default | `fees.trading.taker` 0.003 and `maker` 0.0025, tier based | `coinsph.js` lines 301 and 302, and the tier table at lines 303 to 328 |
| swap markets after `loadMarkets` | 0 of 184 | P1 |
| CCXT Pro class | none, `server/node_modules/ccxt/js/src/pro/` has no `coinsph.js` | |

So `market.taker` reports nothing, and the connector would drop the market at `server/src/ccxt/connector.ts` lines 162 to 166 even if the swap filter at lines 196 to 203 let a spot market through.
The exchange level default of 0.003, 3,000 ppm, is twice the published VIP 0 taker of 1,500 ppm, and its ten tiers are an older schedule that no longer matches S2.

## 9. Recommended registry values

None today.
The engine takes active swaps only, and Coins.ph has none, so there is nothing to register.
If a later design adds a spot leg, the value to register is `takerPpm: 1_500` from S2 and P1, with `ccxtTakerPpm` left unset because CCXT reports no per market taker.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Coins.ph API documentation, Rest-Api, change log to 2026-09-09 | https://docs.coins.ph/rest-api/ | 2026-09-22 | Coins.ph | product list, no futures section, sections 1 and 3 |
| S2 | How are my trading fees calculated based on the VIP level setup?, updated 2025-08-07 | https://support.coins.ph/hc/en-us/articles/11620285112217-How-are-my-trading-fees-calculated-based-on-the-VIP-level-setup | 2026-09-22 | Coins.ph | VIP 0 to VIP 9 maker and taker, the 2025-08-08 reduction, sections 2 and 4 |
| S3 | How are my trading fees calculated?, updated 2026-05-12 | https://support.coins.ph/hc/en-us/articles/4407185668633-How-are-my-trading-fees-calculated | 2026-09-22 | Coins.ph | 30 day volume, cash in and out excluded, sections 2 and 4 |
| S4 | Fee rates page and its front end bundle | https://www.coins.ph/en-ph/fees | 2026-09-22 | Coins.ph and sister brands | fee call paths, futures tab brokers, maker rebate note, fee on the bought asset, sections 2 to 5 |
| S5 | Coins.ph User Agreement, effective 2026-04-16 | https://www.coins.ph/en-ph/user-agreement | 2026-09-22 | Coins.ph | entities, eligibility, sanctioned jurisdictions, no derivatives, section 1 |
| S6 | Betur Inc., DCPay, and Coins.ph: An Overview, updated 2026-09-15 | https://support.coins.ph/hc/en-us/articles/41270848797593-Betur-Inc-DCPay-and-Coins-ph-An-Overview | 2026-09-22 | Coins.ph | entities and licences, section 1 |
| S7 | How is Coins.ph regulated?, updated 2024-08-23 | https://support.coins.ph/hc/en-us/articles/360000274101-How-is-Coins-ph-regulated | 2026-09-22 | Coins.ph | registrations since 2016 and 2017, section 1 |
| S8 | What are the supported countries and Geo-Restrictions for Spot Trade?, updated 2024-12-02 | https://support.coins.ph/hc/en-us/articles/11616157145369-What-are-the-supported-countries-and-Geo-Restrictions-for-Spot-Trade | 2026-09-22 | Coins.ph | restricted territories, section 1 |
| S9 | What is the Coins VIP center?, updated 2025-10-22 | https://support.coins.ph/hc/en-us/articles/11617908800025-What-is-the-Coins-VIP-center | 2026-09-22 | Coins.ph | daily recalculation, section 4 |
| S10 | How to Use a Referral Code and Get Rewards, updated 2026-08-16 | https://support.coins.ph/hc/en-us/articles/57926712614425 | 2026-09-22 | Coins.ph | referral fee discount, section 5 |
| S11 | WLD Delisting on August 31, 2026, updated 2026-09-19 | https://support.coins.ph/hc/en-us/articles/61489606543257-WLD-Delisting-on-August-31-2026 | 2026-09-22 | Coins.ph | delisting timeline, section 7 |
| S12 | CoinGecko exchange record `coinspro` | https://api.coingecko.com/api/v3/exchanges/coinspro | 2026-09-22 | CoinGecko | trust rank 48, trust score 7, 1,211 BTC of 24 h volume, country Philippines |
| C1 | CCXT 4.5.68 `coinsph.js` | `server/node_modules/ccxt/js/src/coinsph.js` | 2026-09-22 | CCXT | sections 2, 3, 5 and 8 |
| P1 | `rest-probe.mjs catalog`, 03:15 UTC on 2026-09-23, and `rest-probe.mjs all` in the second pass at 03:33 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinsph/rest-probe.mjs) | 2026-09-22 | this host | fee calls, futures catalogs, CCXT readings, DNS and access |
