# LBank Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 02:37 to 03:06 UTC, from the development host near Seattle.

This profile covers the fees of LBank (CCXT id `lbank`) on its only perpetual family, the USDT-margined perpetuals.
Numbers come from the help center, from the fee table the public fee page loads, and from [`rest-probe.mjs`](../../../scripts/probes/venues/lbank/rest-probe.mjs).
The API and help center pages answered this host with HTTP 200, so every page below was read from here.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "LBK Exchange", which runs the platform at lbank.com | S3, clause defining "LBank" |
| governing law | British Virgin Islands | S3, governing law clause |
| country on CoinGecko | British Virgin Islands, established 2015, trust rank 30 | S12 |
| who may trade | registered members who pass real-name verification (KYC) before any trade | S3 |
| US persons | may not trade: "LBank does not provide personal account services to residents of the United States or Mainland China, nor does it provide corporate account services to entities incorporated, established, or operating in the United States or Mainland China." | S3 |
| regions refused registration | Afghanistan, Antigua and Barbuda, Azerbaijan, Bangladesh, Burkina Faso, Burundi, Central African Republic, Crimea, Cuba, Democratic Republic of the Congo, Donetsk, Egypt, Guinea-Bissau, Hong Kong SAR, Iran, Iraq, Kyrgyzstan, Lebanon, Lesotho, Libya, Luhansk, Macao SAR, Mainland China, Mali, Mauritania, North Korea, Somalia, South Sudan, Sudan and Darfur, Syria, United States, Uruguay, Venezuela, Yemen, and Canada | S3, "Important Notice" |
| regions refused service | a second list in the same agreement adds Belarus and omits Azerbaijan, Bangladesh, Burkina Faso, Kyrgyzstan, Lesotho, Mauritania and Uruguay | S3, termination clause |
| agreement date | 2026-07-22 14:19 | S3 |

The two region lists in S3 differ, and both name the United States and Canada.
So the perpetuals are not tradable by the operator of this repository from the US, whatever the public API answers.
The public REST and WebSocket endpoints answered this host near Seattle without any geoblock, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | S1, and the fee table S2 read by P1 |

The fee is charged on notional value, "Trading Fee = Notional Value × Fee Rate", S1.
VIP 1 keeps the 0.06 % taker, so a retail account pays 600 ppm until VIP 2, section 4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 845 contracts in the API on 2026-09-23, all `instrumentStatus` 2 | P2, and CoinGecko lists "LBank (Futures)" with 861 perpetual pairs, S12 |
| TradFi perpetuals inside USDT-M | yes, stock, index and commodity contracts such as `HK50USDT`, `GOLDUSDT`, `METASTOCKUSDT` and `COCOAUSDT` | P2, `symbolAlias` values in [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | no | the product groups `SwapB`, `SwapC`, `Swap`, `SwapUSDC` and an empty group all returned `data: []`, P2, and the web app names only `SwapU` |
| coin-M perpetuals | no | same evidence |
| dated futures | no | CoinGecko counts 0 futures pairs, S12 |
| options | no | none in the API or on CoinGecko |
| event contracts | web app only | the web app calls `/cfd/pevent/` paths and the kline topic pushed instruments such as `m3501100USDT`, none of which are in the API catalog, see [`websocket.md`](./websocket.md) section 2 |
| spot | yes, 1,366 CCXT spot markets | 2,211 CCXT markets less 845 swaps, P2 |

The API count of 845 and the CoinGecko count of 861 differ by 16, and the API is what CCXT and the engine read.

## 4. Perpetual tiers

The fee page https://www.lbank.com/fee renders its table in the browser from two public calls, and P1 read both.
Rates are percent per trade.

| level | 30-day spot volume, USDT | 30-day futures volume, USDT | 30-day average asset balance, USDT | futures maker | futures taker | taker ppm |
|---|---:|---:|---:|---:|---:|---:|
| VIP 0 | 0 | 0 | 0 | 0.02 | 0.06 | 600 |
| VIP 1 | 500,000 | 5,000,000 | 10,000 | 0.019 | 0.06 | 600 |
| VIP 2 | 2,000,000 | 10,000,000 | 50,000 | 0.016 | 0.04 | 400 |
| VIP 3 | 8,000,000 | 20,000,000 | 250,000 | 0.014 | 0.0375 | 375 |
| VIP 4 | 30,000,000 | 50,000,000 | 750,000 | 0.012 | 0.035 | 350 |
| VIP 5 | 50,000,000 | 100,000,000 | 2,000,000 | 0.01 | 0.032 | 320 |
| VIP 6 | 75,000,000 | 300,000,000 | 5,000,000 | 0.008 | 0.03 | 300 |
| SVIP (VIP 7) | 100,000,000 | 1,000,000,000 | 10,000,000 | 0 | 0.02 | 200 |

### Qualification

- The page's upgrade prompt reads "Meet any of the following conditions to upgrade to {0} and unlock more discounted fees", so one of the three columns is enough, S2.
- The "VIP Green Channel" upgrades a user by two levels, up to VIP 7, on proof of volume or assets at another exchange, S9.
- The page adds "The VIP trading fee discounts displayed on this page are for reference only. Please refer to the trading page for the actual applicable fee rates.", S2.
- The SVIP rates match the launch announcement of 2025-12-02, "0.00% Maker and 0.02% Taker fees for Derivatives", S9.

## 5. Discounts that change the perpetual taker

| discount | effect on the VIP 0 perpetual taker | source |
|---|---|---|
| token holding | none found | no LBK token discount appears in S1, S2 or S9 |
| referral | pays the referrer "a 30% commission", and no fee reduction for the trader is stated | footer of S1 and S9 |
| vouchers | fee deduction and trial vouchers exist, named in the help center article "LBank Voucher Types and Usage Instructions", not read further | S14 |
| per token exceptions | "Certain tokens may not apply this fee rate during specific periods, please refer to the actual transaction records" | S2 |
| market maker program | not publicly specified in the pages read | |
| zero fee promotions | none found in the pages read | |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| payment | "Funding Amount = Position Nominal Value × Funding Rate", with nominal value at the mark price | S4 |
| who pays | longs pay shorts when the rate is positive, shorts pay longs when negative, and "LBank charges no fees for Funding Rate transfers" | S4 |
| formula | "Funding Rate (F) = Premium Index (P) + clamp(0.01% − Premium Index (P), 0.05%, −0.05%)" | S4, S13 |
| interest component | "0.03% per day (0.01% per funding interval)" by default | S4 |
| premium index | "[Max(0, Impact Bid Price − Spot Price) − Max(0, Spot Price − Impact Ask Price)] / Spot Price", on an impact notional of 4,000 USDT, sampled every second and time weighted up to the funding time | S4 |
| cap and floor | Not publicly specified, the clamp above bounds only the step from the premium to the interest rate | S4, S13 |
| interval | per contract: 1 h on 1 contract, 4 h on 496, 8 h on 348 on 2026-09-23 | P2, `positionFeeTime` |
| settlement instants | `nextFeeTime` read 03:00 UTC on the 1 h contract, 04:00 UTC on the 4 h contracts and 08:00 UTC on the 8 h contracts at 02:50 UTC, which puts the 8 h settlements at 00:00, 08:00 and 16:00 UTC if the grid is regular, an inference | P2 |
| interval changes | announced per contract, for example 1 h to 4 h and 8 h to 4 h for a list of contracts on 2023-12-15 | S6 |
| observed range | the published rates ran from -0.480 % on `1000BTTCUSDT` to +0.345 % on `STONKUSDT` per interval at 03:05 UTC, see [`rest.md`](./rest.md) section 4 | P3 |

The settlement instant itself was not captured, and the public API has no funding history call, see [`rest.md`](./rest.md) section 4.
The rate is paid per interval and not per 8 h, so a 4 h contract at 0.01 % costs twice as much a day as an 8 h contract at the same rate.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | a "Liquidation Fee Rate" enters the liquidation price formula, 0.06 % in the worked BTCUSDT example | S7, dated 2024-12-26 |
| insurance fund | "primarily financed by additional fees paid by non-bankrupt users during forced liquidations" | S8 |
| settlement | perpetuals have no delivery | |
| delisting | handled by per contract announcements, Not publicly specified as a fee | |

## 8. CCXT

| item | value | source |
|---|---|---|
| `market.taker` on every swap without credentials | `0.001`, 1,000 ppm, on 845 of 845 swap markets | P2 |
| `market.maker` | `0.001`, 1,000 ppm | P2 |
| where it comes from | `fees.trading` `'maker': this.parseNumber('0.001')` and `'taker': this.parseNumber('0.001')` | `server/node_modules/ccxt/js/src/lbank.js` lines 209 and 210 |
| how it reaches each market | the base class merges `this.fees['trading']` into every market | `server/node_modules/ccxt/js/src/base/Exchange.js` line 3735 |
| the swap parser | sets no fee of its own | `server/node_modules/ccxt/js/src/lbank.js` lines 614 to 710 |

CCXT's constant is the spot schedule of a 2020 fee article, whose link CCXT keeps at `lbank.js` line 120, and it is not the perpetual rate.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the VIP 0 USDT-M perpetual taker, S1 and S2, which VIP 1 keeps |
| `ccxtTakerPpm` | 1000 | what CCXT 4.5.68 reports on every swap market, `lbank.js` line 210, so the connector's check expects it and the registry value overrides it |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | LBank Futures Trading Fee Instruction, 2023-08-04 | https://www.lbank.com/support/articles/21425760291097 | 2026-09-22 | LBank, global | VIP 0 perpetual maker and taker, fee formula, sections 2 and 5 |
| S2 | LBank fee page and the two calls it loads, `/lbk-vip-center/vip/rateDesc` and `/lbk-vip-center/vip/upgradeThresholdRate` on `ccapi.rerrkvifj.com` | https://www.lbank.com/fee | 2026-09-22 | LBank, global | tier table, thresholds, qualification text, per token note, sections 4 and 5 |
| S3 | LBank User Service Agreement, 2026-07-22 | https://www.lbank.com/support/articles/21436496711705 | 2026-09-22 | LBK Exchange, British Virgin Islands law | operator, KYC, US exclusion, region lists, section 1 |
| S4 | Funding Rate: Definition, Components, and Uses, 2023-08-04 | https://www.lbank.com/support/articles/21422922435353 | 2026-09-22 | LBank, global | funding formula, interest, premium index, payment, section 6 |
| S5 | Mark Price and Funding Rate in Futures, 2023-08-04 | https://www.lbank.com/support/articles/21423004948377 | 2026-09-22 | LBank, global | index and mark formulas, see [`rest.md`](./rest.md) section 4 |
| S6 | Important Updates on Settlement Frequency of USDⓈ-M Perpetual Contracts Funding Rate, 2023-12-15 | https://www.lbank.com/support/articles/26440731042457 | 2026-09-22 | LBank, global | per contract interval changes, section 6 |
| S7 | LBank Forced Liquidation Mechanism, 2024-12-26 | https://www.lbank.com/support/articles/41643668084889 | 2026-09-22 | LBank, global | liquidation fee rate in the example, section 7 |
| S8 | LBank Risk Insurance Fund, 2023-08-04 | https://www.lbank.com/support/articles/21422585376665 | 2026-09-22 | LBank, global | insurance fund financing, section 7 |
| S9 | LBank Launches VIP Program to Elevate the Trading Experience, 2025-12-02 | https://www.lbank.com/support/articles/1995404332685590528 | 2026-09-22 | LBank, global | seven tiers, SVIP rates, Green Channel, sections 4 and 5 |
| S10 | CCXT 4.5.68 `lbank.js` | `server/node_modules/ccxt/js/src/lbank.js` | 2026-09-22 | CCXT | fee constant and swap parser, section 8 |
| S11 | CCXT 4.5.68 base `Exchange.js` | `server/node_modules/ccxt/js/src/base/Exchange.js` | 2026-09-22 | CCXT | fee merge into markets, section 8 |
| S12 | CoinGecko API, `/api/v3/derivatives/exchanges` and `/api/v3/exchanges/lbank` | https://api.coingecko.com/api/v3/derivatives/exchanges | 2026-09-22 | CoinGecko | 861 perpetual pairs, 0 futures pairs, trust rank 30, country, sections 1 and 3 |
| S13 | Understanding Funding Rates, LBank Academy | https://www.lbank.com/academy/article/ar886q1703919944-understanding-funding-rates | 2026-09-22 | LBank, global | the same funding formula, no cap stated, section 6 |
| S14 | LBank Voucher Types and Usage Instructions | https://www.lbank.com/support/articles/42227167714585 | 2026-09-22 | LBank, global | named only, section 5 |
| P1 | `rest-probe.mjs misc`, three runs | [`rest-probe.mjs`](../../../scripts/probes/venues/lbank/rest-probe.mjs) | 2026-09-23 UTC | this host | the fee table and thresholds of S2, sections 2 and 4 |
| P2 | `rest-probe.mjs catalog`, two runs | [`rest-probe.mjs`](../../../scripts/probes/venues/lbank/rest-probe.mjs) | 2026-09-23 UTC | this host | contract count, intervals, settlement instants, CCXT fees, sections 3, 6 and 8 |
| P3 | `rest-probe.mjs anchor`, three runs | [`rest-probe.mjs`](../../../scripts/probes/venues/lbank/rest-probe.mjs) | 2026-09-23 UTC | this host | observed funding range, section 6 |
