# Deribit Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 20:20 and 20:45 Pacific time, which is 2026-09-23 03:20 to 03:45 UTC.

This profile covers the perpetual fees of Deribit (CCXT id `deribit`), which CoinGecko lists as "Deribit Spot" at trust rank 72 and as a derivatives venue with 129 perpetual pairs.
Deribit lists perpetuals, so the perpetual families are researched and spot is only named in the coverage matrix.
The help center pages refuse this host with HTTP 403, and a WebFetch of the same pages was refused with 403 as well.
The Zendesk JSON API behind the help center answers this host with 200, so every help center article below was read through `https://support.deribit.com/api/v2/help_center/en-us/articles/<id>.json`, and the article URL is cited.
The fee page linked by CCXT, `https://www.deribit.com/pages/information/fees`, redirects with 301 to `https://www.deribit.com/kb/fees`, a 17,275 byte single page app shell with no fee text.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | 2026-09-22, the fee article was last edited 2026-09-22T15:41:58Z | S1 |
| exchange | Deribit FZE, "a Virtual Asset Service Provider (VASP) regulated by the Dubai Virtual Assets Regulatory Authority (VARA) with license number L-2994" | S4 |
| retail broker | DRB Panama Inc, Panama City, which places orders for execution on Deribit | S5 |
| institutional broker | "Institutional clients who trade through Coinbase Bermuda Limited (CBBM) as their broker pay fees that match the rates shown on this page." | S1 |
| owner | CoinGecko describes Deribit as "a subsidiary of Coinbase (NASDAQ: COIN)", and the site title reads "Deribit by Coinbase" | S11, [`rest.md`](./rest.md) section 1 |
| who may trade perpetuals | Qualified and Institutional Investors onboard to Deribit FZE, and "Retail Investors who are eligible to trade derivative products are onboarded directly with Deribit Panama" | S3 |
| excluded regions | Belarus and Russia (nationals of the EEA and Switzerland exempt), Canada, Central African Republic, Congo, Cuba, Guam, Iran, Iraq, Japan, North Korea, Libya, Myanmar, Puerto Rico, American Samoa, Somalia, South Sudan, Sudan, Syria, the sanctioned regions of Ukraine, the United States, the US Virgin Islands, Yemen | S2 |
| partly excluded | Panama and the United Arab Emirates: "Retail Investors may only trade spot products". United Kingdom: "Retail Clients not allowed" | S2 |
| US persons | may not trade, the United States is on the restricted list | S2 |

The public REST and WebSocket endpoints served this host without any refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

| family | VIP 0 ("Standard") maker | VIP 0 taker | source |
|---|---|---|---|
| USDC-settled linear perpetuals, 129 contracts | 0.015 %, 150 ppm | 0.035 %, 350 ppm | S1 "1.5 / 3.5" bps, and `maker_commission` 0.00015, `taker_commission` 0.00035 on all 131 perpetuals in `get_instruments`, P1 |
| BTC and ETH inverse perpetuals, 2 contracts | 0.015 %, 150 ppm | 0.035 %, 350 ppm | same row and same catalog fields |

The fee article sets one "Perpetuals and futures" column for every perpetual, so the two families pay the same rate.
The catalog agrees on every perpetual: `taker_commission` 0.00035 and `maker_commission` 0.00015 on 131 of 131, P1.

## 3. Coverage matrix

Counted from `public/get_instruments` without parameters on 2026-09-23 at 03:37 UTC, 5,930 rows, P1.

| product | present | count on 2026-09-22 | note |
|---|---|---|---|
| USDC-settled linear perpetuals | yes | 129, all `open` and `is_active` | 97 crypto, 23 equity, 5 equity ETF, 4 commodity, 1 crypto index, 1 pre-IPO by `underlying_type` |
| BTC inverse perpetual `BTC-PERPETUAL` | yes | 1 | contract of 10 USD, settled in BTC |
| ETH inverse perpetual `ETH-PERPETUAL` | yes | 1 | contract of 1 USD, settled in ETH |
| USDT-settled perpetuals | no | 0 | `get_instruments?currency=USDT&kind=future` returned an empty list |
| dated futures | yes | 67, of which 45 USDC linear and 22 BTC or ETH inverse | daily, weekly and monthly expiries |
| future combos (spreads) | yes | 132 | |
| options | yes | 5,488, of which 3,660 USDC linear, 972 BTC and 856 ETH | |
| option combos | yes | 57 | |
| spot | yes | 55, of which 54 `open` and 1 `locked` | "Selected spot pairs on Deribit are routed to Coinbase Exchange (CBE)", S10 |

## 4. Perpetual tiers

The fee article's table, "Perpetuals and futures" column, in basis points, S1.

| tier | criteria | maker bps | taker bps | maker ppm | taker ppm |
|---|---|---:|---:|---:|---:|
| Standard | none | 1.5 | 3.5 | 150 | 350 |
| VIP1 | $100k USDC equity, or $250k total equity | 0 | 3 | 0 | 300 |
| VIP2 | $100m on futures, or $100m on options | 0 | 2.5 | 0 | 250 |
| VIP3 | $500m on futures, or $500m on options | 0 | 2 | 0 | 200 |
| VIP4 | $1b on futures, or $1b on options | -0.2 | 1.85 | -20 | 185 |
| VIP5 | $1.5b on futures, or $1.5b on options | -0.3 | 1.75 | -30 | 175 |
| VIP6 | $3b on futures, or $3b on options | -0.4 | 1.7 | -40 | 170 |
| VIP7 | $15b on futures, or $15b on options, "Only available for trading for your own account, not as a broker" | -0.4 | 1.7 | -40 | 170 |

A negative number is a rebate.

### Qualification

- "Volumes are dollar-equivalent notionals measured over the last 30 days.", S1.
- "Equity is calculated as the daily average over the past 30 days.", S1.
- The VIP1 equity threshold "must be satisfied specifically with USDC and cannot be met using the equivalent value of other currencies", S1.
- Futures and options volumes are judged separately, and the higher level reached applies to both product types, S1.
- "Upgrades happen once per day at 12:00 UTC", and downgrades happen one level at a time on the 1st of each month, S1.
- Spot trades do not count toward volume, S1.
- The article introduces the table as "the upcoming fee levels", and names no effective date, so whether the table is already in force on 2026-09-22 is Not verified.
  The catalog's live `taker_commission` of 0.00035 equals the Standard taker in that table.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| affiliate link | "New users that sign up through a valid affiliate link will get a 10% discount on trading fees for the first 6 months." CCXT records the same `discount: 0.1` at `server/node_modules/ccxt/js/src/deribit.js` line 139 | S12, S13 |
| stacking | "Volume based discounts and Affiliate discounts do not stack", and the volume discount always wins | S1 |
| fee balance | a promotional credit that pays trading, liquidation and delivery fees, and "cannot be withdrawn" | S1 |
| futures spread | a taker pays nothing on the cheaper leg | S1 |
| token holding | none, Deribit has no exchange token | S1 lists none |
| zero fee promotion | none published for perpetuals on 2026-09-22 | S1 |
| market maker | not published in S1 beyond the VIP rebates, and a Liquidity Support Program exists for liquidations | S1, S8 |

A retail taker at VIP 0 with an affiliate link would pay 3.15 bps, 315 ppm, for six months.
The engine models the base tier, so 350 ppm is the number that matters.

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| direction | positive rate: longs pay shorts | S6 |
| premium | `Premium Rate = ((Mark Price - Deribit Index) / Deribit Index) * 100%` | S6 |
| damper | a premium inside plus or minus 0.025 % gives 0, and outside it the rate is the premium less 0.025 % toward zero. PAXG uses 0.1 %, S7. OPENAI and ANTHROPIC use 0.1 %, S8 | S6, S7, S8 |
| cap | BTC-PERPETUAL plus or minus 0.5 %, ETH-PERPETUAL plus or minus 1 %, USDC perpetuals plus or minus 5 %, pre-IPO perpetuals plus or minus 2 % | S6, S8, S9 |
| expressed as | an 8 hour rate | S6 |
| accrual | "funding is actually calculated and paid/received continuously and can be seen in real time in the realised session profit (RSPL)", "Funding payments are calculated every millisecond" | S6, S9 |
| payment | `Funding Payment = Funding Rate * Position Size * Time Fraction`, with `Time Fraction = Funding Rate Time Period / 8 hours` | S6 |
| cash settlement | "the cash balance is only updated with funding during daily settlement at 08:00 UTC every day" | S6 |
| fee on funding | "Deribit does not charge any fees on funding" | S6 |

So Deribit has no funding instant.
A position pays the rate of each millisecond it is held, and nothing is charged at a boundary, so the settlement dip seen on venues with a discrete instant cannot happen here.
The probe did not capture the 08:00 UTC daily settlement, and it does not need to, since that settlement moves already accrued funding into cash.
The funding history endpoint returns one row per hour with `interest_1h` and a trailing `interest_8h`, see [`rest.md`](./rest.md) section 4.

On 2026-09-23 at 03:22 UTC the published instantaneous rate `current_funding` was 0 on 33 of 129 USDC perpetuals, and its largest magnitude was 0.00833 on `1000MOG_USDC-PERPETUAL`, P2.
At 03:37 UTC it was 0 on 31, and the largest was 0.00755 on the same contract.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| liquidation, BTC futures and perpetuals | 1 % total fee | S1 |
| liquidation, ETH futures and perpetuals | 1 % total fee | S1 |
| liquidation, USDC futures and perpetuals | 1 % total fee | S1 |
| definition | "TotalFee = TradingFee + LiquidationFee", and "Fee discounts do not apply to the total fee charged during a liquidation" | S1 |
| delivery | perpetuals have no expiry. Dated BTC and ETH futures and USDC settled futures on BTC and ETH pay 0.025 %, weekly futures 0 % | S1 |
| daily settlement | 08:00 UTC, on a 30 minute TWAP of the index between 07:30 and 08:00 UTC, with no fee named | S7 |
| delisting | Not publicly specified in the articles read | |
| catalog field | `max_liquidation_commission` is 0.01 on every perpetual | P1 |

## 8. CCXT

| item | value |
|---|---|
| class | `deribit`, `server/node_modules/ccxt/js/src/deribit.js`, CCXT 4.5.68 |
| catalog call | `fetchMarkets` calls `publicGetGetInstruments` with no currency when the option `fetchAllMarkets` is true, its default, at lines 805 to 808 |
| `market.taker` | `this.safeNumber(market, 'taker_commission')` at line 996, so the live catalog value |
| `market.maker` | `maker_commission` at line 997 |
| no fallback | the class describes no `fees.trading` block, so a market with no `taker_commission` would have `taker` undefined |
| probed value | `taker` 0.00035 and `maker` 0.00015 on all 131 active swaps, without credentials, P1 |

CCXT's `market.taker` for a swap is therefore 350 ppm, and it follows any change Deribit makes to the catalog.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 350 | the Standard perpetual taker of 3.5 bps in S1, which the live catalog repeats on all 131 perpetuals |
| `ccxtTakerPpm` | 350 | CCXT copies `taker_commission`, 0.00035, at `server/node_modules/ccxt/js/src/deribit.js` line 996, so the connector's check warns if Deribit changes the catalog rate |

Pinning `takerPpm` keeps the engine on the published schedule even if the catalog one day carries a different number.
The two values agree today, so leaving `takerPpm` unset would give the same 350 ppm from CCXT.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees | https://support.deribit.com/hc/en-us/articles/25944746248989-Fees, read through `https://support.deribit.com/api/v2/help_center/en-us/articles/25944746248989.json` | 2026-09-22 | Deribit, all | tiers, qualification, discounts, liquidation and delivery fees, CBBM, sections 1 to 7 |
| S2 | Restricted Jurisdictions | https://support.deribit.com/hc/en-us/articles/25944487427741-Restricted-Jurisdictions | 2026-09-22 | Deribit, all | excluded regions, section 1 |
| S3 | Investor classification | https://support.deribit.com/hc/en-us/articles/26327903944221-Investor-classification | 2026-09-22 | Deribit FZE, DRB Panama | who onboards where, section 1 |
| S4 | Deribit Exchange Membership Terms, Deribit FZE | https://support.deribit.com/hc/en-us/articles/25944532191645 | 2026-09-22 | Deribit FZE, Dubai | VARA licence L-2994, section 1 |
| S5 | Terms of Service, DRB Panama Inc. | https://support.deribit.com/hc/en-us/articles/25944471089437 | 2026-09-22 | DRB Panama | retail broker, section 1 |
| S6 | Funding Specifications | https://support.deribit.com/hc/en-us/articles/31424939178397-Funding-Specifications | 2026-09-22 | Deribit, all | funding formula, damper, caps, continuous accrual, section 6 |
| S7 | Linear Perpetual | https://support.deribit.com/hc/en-us/articles/31424969384605-Linear-Perpetual | 2026-09-22 | Deribit, all | 5 % cap, PAXG damper, daily settlement, section 6 and 7 |
| S8 | RWA Perpetual | https://support.deribit.com/hc/en-us/articles/38325634622493-RWA-Perpetual | 2026-09-22 | Deribit, all | pre-IPO damper and cap, section 6 |
| S9 | Inverse Perpetual | https://support.deribit.com/hc/en-us/articles/31424954847133-Inverse-Perpetual | 2026-09-22 | Deribit, all | inverse caps, millisecond accrual, section 6 |
| S10 | Spot Instruments | https://support.deribit.com/hc/en-us/articles/31424969480093-Spot-Instruments | 2026-09-22 | Deribit, all | spot routing to Coinbase Exchange, section 3 |
| S11 | CoinGecko derivatives exchange entry | https://api.coingecko.com/api/v3/derivatives/exchanges/deribit | 2026-09-22 | CoinGecko | 129 perpetual pairs, owner, section 1 |
| S12 | Affiliate Program | https://support.deribit.com/hc/en-us/articles/25944777728797-Affiliate-Program | 2026-09-22 | Deribit, all | 10 % for six months, section 5 |
| S13 | CCXT 4.5.68 `deribit.js` | `server/node_modules/ccxt/js/src/deribit.js` | 2026-09-22 | CCXT | lines 139, 805 to 808, 996 and 997, section 8 |
| P1 | `rest-probe.mjs catalog` at 03:20 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deribit/rest-probe.mjs) | 2026-09-22 | this host | catalog counts, catalog fees, CCXT values, sections 2, 3, 7 and 8 |
| P2 | `rest-probe.mjs funding` at 03:22 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/deribit/rest-probe.mjs) | 2026-09-22 | this host | the spread of `current_funding`, section 6 |
