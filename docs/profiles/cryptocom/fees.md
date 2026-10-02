# Crypto.com Exchange Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, which the venue's own geolocation placed in Canada.

This profile covers perpetual trading on the Crypto.com Exchange (CCXT id `cryptocom`), and nothing else.
Spot, dated futures, deposit, withdrawal, staking and card schedules are named once in the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/cryptocom/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/cryptocom/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entity | The derivatives terms are "Published by Foris DAX Limited", "As at 22 December 2025". | Published | S5 |
| who may trade the perpetuals | An account holder outside the restricted locations, and only where "the Service and specific Derivatives Products are available in your jurisdiction as specified by us from time to time". | Region-specific | S4, S5 |
| restricted locations | 93 locations on 2025-05-07, among them the United States, Puerto Rico, Guam, the US Virgin Islands, Canada, the United Kingdom, Australia, Japan, Hong Kong, Singapore, Taiwan, the People's Republic of China, Brazil, South Africa, Switzerland, Norway and all 27 member states of the European Union | Published | S4 |
| US persons | May not trade Exchange derivatives, since the United States and its territories are on the list | Published | S4 |
| this host, per the venue | The website's own feature call `GET https://exchange-fe.crypto.com/v3/feature-control?platform=web`, unauthenticated, placed this host at `"countryCode":"CAN"` and answered `"Derivative":false` and `"FCMDerivatives":false`, with `"Spot":true` | Probed | S3 |
| website from this host | The fee page rendered only its Spot table, because its derivatives tab is drawn only when `permissions.Derivative` is true. The footer names geo restrictions for "spot trading and on-chain staking" only | Probed | S1, S2 |
| public API from this host | `api.crypto.com` and `stream.crypto.com` answered every public call with HTTP 200 or a documented error, and no call was refused for location | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The fee page and the help centre answered this host directly, and the derivatives schedule was read from the page's own data file, because the page does not draw it for a Canadian visitor.
Trading from this host is not allowed under S4, since both the United States and Canada are restricted locations.
Reading public market data is not an account service, and the API hosts served it without a challenge.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USD-settled linear perpetuals, every product type | 0.020 % = 200 ppm | 0.040 % = 400 ppm | Published | S2, derivatives Level 1, 30D derivatives volume under 500,000 USD, without CRO balance |

Crypto.com calls its base retail tier Level 1, and Level 1 is the VIP 0 row of this survey.
The engine models a taker cross at the base retail tier, so 400 ppm is the number that matters.
One schedule covers every perpetual, crypto and TradFi alike, and no page read names a separate rate for equity, commodity or pre-IPO perpetuals outside promotions.
The derivatives table is not drawn from this host, so the rates come from the data module the fee page renders, S2.
The same module's spot rows match the spot table the page did draw from this host, Level 1 to 5, digit for digit, which is the check that the module is the page's source.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| USD-settled linear perpetuals, digital currencies | yes | 241 | Probed, `public/get-instruments`, `product_type` `DIGITAL_CURRENCIES` |
| USD-settled linear perpetuals, equities | yes | 118 | Probed, `product_type` `EQUITY` |
| USD-settled linear perpetuals, equity indices and ETFs | yes | 27 | Probed, `product_type` `EQUITY_IND` |
| USD-settled linear perpetuals, commodities | yes | 8 | Probed, `product_type` `COMMODITIES` |
| USD-settled linear perpetuals, pre-IPO | yes | 2 (`ANTHROPICIPOUSD-PERP`, `OPENAIIPOUSD-PERP`) | Probed, `product_type` `PRE_IPO` |
| USDT-settled, USDC-settled or coin-margined perpetuals | Not offered | 0 | Probed, every perpetual has `quote_ccy` `USD` |
| dated futures | yes, not detailed | 12 (BTC and ETH, six expiries each) | Probed |
| options (`WARRANT`) | Not offered today | 0 | Probed, CCXT maps `WARRANT` to options at `server/node_modules/ccxt/js/src/cryptocom.js` line 777 |
| spot | yes, not detailed | 571 | Probed |

The perpetual total is 396, all `tradable` true.
CoinGecko's derivatives list read the same day shows 401 perpetual pairs and 13 futures, S13, which is five perpetuals and one future more than the catalog held.
Margin is one USD-denominated account across collateral assets, and every perpetual settles in USD, so there is one perpetual family.
Spot, deposit, withdrawal and staking fees are looked up on the fee page at `https://crypto.com/exchange/document/fees-limits`, S1.

## 4. Perpetual tiers

The fee page draws five Level rows from the first five entries of the base arrays, and seven VIP rows from the VIP arrays, in `TradingFeeTable`, S2.
The 30D volume column is headed "30D Derivatives Volume (USD)".
The VIP share column is headed "% of {ex} {altcoin} Derivatives Volume", where "Altcoin refers to all tradeable instruments except for BTC and ETH as the underlying instrument."

### Levels, without CRO balance

| level | 30D derivatives volume (USD) | maker | taker |
|---|---|---|---|
| 1 | < 500,000 | 0.020 % = 200 ppm | 0.040 % = 400 ppm |
| 2 | ≥ 500,000 | 0.018 % = 180 ppm | 0.038 % = 380 ppm |
| 3 | ≥ 1,000,000 | 0.016 % = 160 ppm | 0.035 % = 350 ppm |
| 4 | ≥ 2,500,000 | 0.014 % = 140 ppm | 0.032 % = 320 ppm |
| 5 | ≥ 5,000,000 | 0.011 % = 110 ppm | 0.030 % = 300 ppm |

The base arrays hold two more entries, `≥ 25,000,000` at 0.008 % and 0.028 %, and `≥ 50,000,000` at 0 % and 0.026 %, which the table code does not draw.

### VIP, without CRO balance

| VIP | 30D derivatives volume | altcoin share | maker | taker |
|---|---|---|---|---|
| 1 | ≥ 6M USD | N/A | 0.008 % = 80 ppm | 0.028 % = 280 ppm |
| 2 | ≥ 25M USD | N/A | 0 % | 0.026 % = 260 ppm |
| 3 | ≥ 50M USD | N/A | 0 % | 0.024 % = 240 ppm |
| 4 | ≥ 100M USD | ≥ 0.10 % | 0 % | 0.022 % = 220 ppm |
| 5 | ≥ 250M USD | ≥ 0.25 % | 0 % | 0.020 % = 200 ppm |
| 6 | ≥ 500M USD | ≥ 0.5 % | 0 % | 0.018 % = 180 ppm |
| 7 | By Invitation | By Invitation | 0 % | 0.015 % = 150 ppm |

### Qualification

"Trading fee rates are updated at 04:00 UTC daily based on the user's trading volume, maker activity, and CRO Balance amount.", S1.
The VIP table also carries a `volumeAmount` array of 15e6, 5e7, 1e8, 25e7, 5e8 and 1e9 for derivatives, whose use the page does not state, S2.

## 5. Discounts that change the perpetual taker

| discount | what it does | label | evidence |
|---|---|---|---|
| CRO balance | Eight balance tiers change Level 1 to: 1K CRO 0.0194 % and 0.0388 %, 5K 0.0190 % and 0.0380 %, 10K 0.0184 % and 0.0368 %, 50K 0 % and 0.0352 %, 100K −0.0001 % and 0.0340 %, 500K −0.0002 % and 0.0320 %, 1M −0.0005 % and 0.0300 %, 5M −0.0010 % and 0.0280 %, maker then taker | Account-gated | S2 |
| CRO balance, stated as a rule | "Trading fee benefits are granted in the form of discounted fees, 0% Maker Fees, or Maker Fee rebates, depending on the CRO Balance amount." The largest tier takes 30 % off the taker | Account-gated | S1, S2 |
| Zero-Fee Token | "Enjoy 0% Maker Fees, 0.04% Taker Fees for Spot trading, and 0.02% Taker Fees for Derivatives trading on your selected token. Jurisdictional limitations apply." One token, for 12 months from activation, from a list of 48 base tokens. The feature call carries `"derivTakerBps":2` and `"duration":365` | Account-gated | S3, S12 |
| TradFi zero-maker promotion | 0.00 % maker and 0.02 % taker at Levels 1 to 5 on thirteen commodity, index and pre-IPO perpetuals, from 2026-05-13 to 2026-06-13, ended before this retrieval | Published, expired | S11 |
| market maker and VIP programmes | Named on the fee page, rates by agreement | Negotiated | S1 |
| referral | No perpetual rate found in the pages read | Not publicly specified | |

## 6. Funding as a cost

S7 is the formula of record, dated 2023-07-31, and S9 and S10 describe the published numbers.

```text
Premium Rate Per Minute = ((Mark Price - Index) / Index) * 100%
Average Premium Rate = MEAN (Premium Rate Per Minute) over the current 4-hour interval
Hourly Funding Rate = Average Premium Rate / 4
Hourly Funding Payment (USD) = Hourly Funding Rate * Position Size (USD)
```

| item | documented | probed | evidence |
|---|---|---|---|
| who pays | "When the Funding Rate is positive, long position holders pay short position holders. When the Funding Rate is negative, short position holders pay long position holders." | | S7 |
| intervals | "Funding intervals are 00:00 - 04:00, 04:00 - 08:00, 08:00 - 12:00, 12:00 - 16:00, 16:00 - 20:00, 20:00 - 00:00 UTC" | | S9 |
| settlement | hourly, "24 sessions per day at 00:00, 01:00, 02:00 … 23:00 UTC" | `funding_hist` rows sit on every whole hour | S8, [`rest.md`](./rest.md) section 4 |
| which rate is charged | `funding` returns the "Hourly funding rate that will settle at end of current hour", and `estimatedfunding` the "estimated hourly rate that will be effective at the end of each hour in the next interval" | 30 settled BTC rates came in runs of four equal values, 17:00 to 20:00, 13:00 to 16:00 and so on, so one rate is charged at the four hourly settlements that close each interval. The current `funding_rate` equalled the rate settled at 21:00 | S9, [`rest.md`](./rest.md) section 4 |
| how far ahead the rate is known | the rate for an interval is fixed when the interval starts | the published `funding_rate` did not change once in 60 one second polls on four perpetuals, and its point is stamped at second 5 of each minute | [`rest.md`](./rest.md) section 4 |
| interest term | none in the formula | | S7 |
| cap and floor | Not publicly specified in the pages read | | S7, S8 |
| mark in the premium | the premium uses the mark, and the mark is held within the index plus or minus a bandwidth of at least 0.5 %, see [`rest.md`](./rest.md) section 4 | | S7, S8 |

So the hourly rate over a four-hour interval is a quarter of the average premium, and four settlements charge the whole average premium once.
The rate the engine reads for the upcoming settlement is known up to four hours in advance.

## 7. Liquidation, settlement and delisting

| charge | value | label | evidence |
|---|---|---|---|
| liquidation fee | "A 0.5% Liquidation Fee applies to forced liquidations." and "these fees are automatically added to the Insurance Fund." | Published | S1, S6 |
| insurance fund and socialised loss | the insurance fund pays amounts owing, and a socialised loss mechanism applies when it cannot | Published | S5 |
| hourly session settlement | "The Average Price will be reset to the Mark Price at the end of that session, and the Unrealised PnL will be realised." No fee is named | Published | S7 |
| perpetual expiry fee | none, perpetuals do not expire | | |
| delisting charge | Not publicly specified in the pages read | Not publicly specified | |

## 8. CCXT

| item | value | evidence |
|---|---|---|
| version | 4.5.68 | Probed, `ccxt.version` |
| `market.taker` on every active swap without credentials | `0.005` on 396 of 396 | Probed, `rest-probe.mjs main`, tag `ccxt` |
| `market.maker` | `0.0025` on 396 of 396 | Probed, same tag |
| where it comes from | `fetchMarkets` sets no fee on a market, lines 815 to 863, so `setMarkets` copies the exchange-wide `fees.trading` onto every market | `server/node_modules/ccxt/js/src/cryptocom.js` lines 329 and 330, `server/node_modules/ccxt/js/src/base/Exchange.js` lines 3732 to 3735 |
| what the constant is | the spot Level 1 rate, 0.250 % maker and 0.500 % taker, with the spot tier table below it | `server/node_modules/ccxt/js/src/cryptocom.js` lines 331 to 358, and the spot table rendered in S1 |
| spot markets | `0.005` on 571 of 571 | Probed |
| funding in CCXT | `fetchFundingRate` reads `estimated_funding_rate`, the next interval's estimate, and not the rate being charged | `server/node_modules/ccxt/js/src/cryptocom.js` line 3083 |

The CCXT number is 5,000 ppm, and it is the spot Level 1 taker, twelve and a half times the perpetual Level 1 taker.
The connector compares CCXT's number to `ccxtTakerPpm` or, when that is unset, to the market's own `takerPpm`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 33 to 39.

## 9. Recommended registry values

```ts
cryptocom: {
  takerPpm: 400,
  // ccxt/js/src/cryptocom.js:330 sets the exchange-wide taker to 0.005, the spot Level 1 rate, and Exchange.js:3735 copies it onto every market.
  ccxtTakerPpm: 5000,
}
```

`takerPpm: 400` is the published Level 1 derivatives taker, S2.
`ccxtTakerPpm: 5000` declares CCXT's constant, so the connector stays quiet until a CCXT release changes it.
Without it the connector would warn on all 396 markets, since 5,000 is not 400.
The rate applies only to an account in an eligible jurisdiction, and this host is not in one, see section 1.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees & Limits, rendered from this host in headless Chrome, "Last Updated: Sep 22, 2026" | https://crypto.com/exchange/document/fees-limits | 2026-09-22 | Crypto.com Exchange, as served to a host placed in Canada | spot table, notes on CRO balance, 04:00 UTC update and liquidation fee, sections 1, 4, 5, 7 |
| S2 | The fee page's data module, arrays `Wt` (labels) and `Vt` (rates) and the CRO balance list, with `TradingFeeTable-iOCT1iE6.js` and `TradingFeeDocument-CGpq-TqK.js`, which draw five Level rows and gate the derivatives tab on `permissions.Derivative` | https://crypto.com/exchange/assets/constants-7giiyqF2.js | 2026-09-22 | Crypto.com Exchange | derivatives Levels, VIP and CRO tables, sections 2, 4, 5 |
| S3 | Website feature control, unauthenticated | https://exchange-fe.crypto.com/v3/feature-control?platform=web | 2026-09-22 | as served to this host | `Derivative` false, `countryCode` `CAN`, Zero-Fee Token config, sections 1 and 5 |
| S4 | Derivatives Trading Geo-Restrictions, dated 2025-05-07 | https://help.crypto.com/en/articles/4894470-derivatives-trading-geo-restrictions | 2026-09-22 | Crypto.com, global | 93 restricted locations, section 1 |
| S5 | Addendum, Derivatives Trading Terms and Conditions, Foris DAX Limited, as at 22 December 2025 | https://static2.crypto.com/exchange/assets/documents/derivatives-trading-tnc.pdf | 2026-09-22 | Foris DAX Limited | entity, jurisdiction clause, insurance fund, sections 1 and 7 |
| S6 | Applicable Fees, dated 2023-02-16 | https://help.crypto.com/en/articles/4894437-applicable-fees | 2026-09-22 | Crypto.com, global | derivatives use derivatives maker and taker rates, 0.50 % liquidation fee to the insurance fund, section 7 |
| S7 | Funding and Session Settlement, dated 2023-07-31 | https://help.crypto.com/en/articles/4894449-funding-and-session-settlement | 2026-09-22 | Crypto.com, global | funding formula, who pays, session settlement, sections 6 and 7 |
| S8 | Key Applicable Terms - Perpetuals, dated 2023-11-28 | https://help.crypto.com/en/articles/5338857-key-applicable-terms-perpetuals | 2026-09-22 | Crypto.com, global | hourly sessions, mark bandwidth, section 6 |
| S9 | `estimatedfunding.{instrument_name}` and `funding.{instrument_name}` channel pages | https://exchange-developer.crypto.com/exchange/v1/docs/api/websocket/ws-channel-estimatedfunding-instrument-name | 2026-09-22 | Crypto.com Exchange API v1 | intervals, which rate each channel carries, section 6 |
| S10 | `public/get-valuations` | https://exchange-developer.crypto.com/exchange/v1/docs/api/rest/public-get-valuations | 2026-09-22 | Crypto.com Exchange API v1 | `funding_rate`, `estimated_funding_rate` and `funding_hist` definitions, section 6 |
| S11 | Trade Perpetuals on Traditional Assets With 0% Maker Fees | https://crypto.com/en-no/events/exchange-tradfi-perps-zero-maker-fees | 2026-09-22 | Crypto.com, "Not available in all markets" | expired promotion, section 5 |
| S12 | Website locale strings, key `zeroFeeToken.description` | https://static2.crypto.com/exchange/locale/en-US.json | 2026-09-22 | Crypto.com Exchange | Zero-Fee Token terms, section 5 |
| S13 | CoinGecko derivatives exchanges, entry `crypto_com_futures` | https://api.coingecko.com/api/v3/derivatives/exchanges | 2026-09-22 | CoinGecko | 401 perpetual pairs and 13 futures listed, section 3 |
| S14 | CCXT 4.5.68 `cryptocom.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/cryptocom.js` | 2026-09-22 | CCXT | fee constants and their copy onto markets, section 8 |
| P1 | `rest-probe.mjs main`, `anchor` and `round`, 21:43 to 21:46 UTC, and a rerun at 22:08 to 22:10 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/cryptocom/rest-probe.mjs) | 2026-09-22 | this host | sections 3, 6, 8 |
