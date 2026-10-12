# Dzengi Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 04:07 to 04:30 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Vancouver, Canada.

Dzengi.com is the former Currency.com, run by Dzengi Com CJSC in Minsk, Belarus, S1.
It lists no perpetual futures.
Its "Leverage" mode is a margin operation against the company or a market maker, with a daily or eight-hourly leverage fee, and no funding, index or mark price, see section 3.
So this profile follows change 1 of the survey plan's template and covers the spot market, which Dzengi calls the "Exchange" mode.
Dzengi has no CCXT 4.5.68 class, see section 8.
Probed numbers come from [`rest-probe.py`](../../../scripts/probes/venues/dzengi/rest-probe.py).

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| legal entity | Dzengi Com CJSC (Dzengi closed joint stock company), TIN 193665666, Minsk, Republic of Belarus | `Published`, footer of S1 |
| regulator | "Authorised and regulated under the Legislation of the Republic of Belarus" | `Published`, S1 |
| who may trade | Anyone outside the excluded regions who opens an account. The licence covers "the territories of the Republic of Belarus and other countries provided that this does not contradict to the acts of legislation of these countries". | `Published`, S1 and S5 page 4 |
| excluded regions | "creating an account or using the crypto platform is not available to clients who are residents or citizens of the United States and the Russian Federation" | `Region-specific`, S1 and S6 |
| Canada | not named as excluded | `Not publicly specified` |
| account types | Individual, Legal entity and Market maker, each with its own fee column | `Published`, S4 |
| fee unit | one commission per trade, with no maker and taker split | `Published`, S4 |

From the Canadian exit no page or public call was refused or geoblocked, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

Spot, Individual account, the base tier.
Dzengi charges one commission on every exchange trade, so maker and taker are the same number.

| spot pair class | maker | taker | ppm | evidence |
|---|---|---|---|---|
| cryptocurrency against cryptocurrency, which includes USDT and BTC quoted pairs | 0.2% | 0.2% | 2,000 | `Published` S4, and `Probed`: `exchangeFee` 0.2 on all 30 USDT and 18 BTC quoted pairs |
| cryptocurrency against a currency token (USD, EUR, BYN) | 1.5% | 1.5% | 15,000 | `Published` S4, and `Probed`: `exchangeFee` 1.5 on 52 of 56 USD, all 3 EUR and all 5 BYN quoted pairs |
| the four USD pairs MELANIA/USD, TRUMP/USD, MEW/USD and POPCAT/USD | 0.2% | 0.2% | 2,000 | `Probed` only, `exchangeFee` 0.2, which the fee page does not explain |

For a Legal entity the crypto against currency rate is 1.95%, and the crypto against crypto rate stays 0.2%, S4.

## 3. Coverage matrix

| product | present | how established |
|---|---|---|
| perpetual futures | no | No perpetual is listed in the catalog, the Swagger has no funding, mark or index call, and `GET /api/v2/premiumIndex`, `/api/v2/fundingRate` and `/api/v2/markPrice` answered 404, S3 and [`rest.md`](./rest.md) section 3. |
| Leverage mode (margin operations) | yes, 75 TRADING crypto symbols such as `BTC/USD_LEVERAGE` | `Probed`, `marketType` `LEVERAGE` in `exchangeInfo`. The terms define a Leverage-operation as a purchase or a borrowing and sale of tokens with "the Counterparty", which "means the Company or the Market Maker", S5, definitions of "Leverage-operation" and "Counterparty". The book is a single dealer quote, see [`rest.md`](./rest.md) section 5. |
| dated futures | no dated crypto contract | The terms define "Tokenised futures", tokens priced from futures traded on other exchanges, S5. The catalog's asset types are EQUITY, CURRENCY, CRYPTOCURRENCY, COMMODITY and INDEX, and no symbol carries an expiry. |
| options | no | not in the catalog or the Swagger |
| spot ("Exchange" mode) | yes, 112 TRADING crypto pairs | `Probed`, this profile |
| tokenised shares, indices, commodities and currencies | yes, on both modes, all in status `BREAK` at probe time, which was a Saturday | `Probed` |

The Leverage mode is named here and not detailed, as design decision 3 says for a non-perpetual product.
Its fees are still recorded in section 5, because they show why it is not a perpetual leg.

## 4. Spot tiers

Individual accounts have no volume tiers, S4.
Market maker accounts get a discount on the Individual or Legal entity rate by executed volume, S4.

| market maker volume | discount | crypto against crypto | crypto against currency, Individual |
|---|---|---|---|
| above $0.5B | 30% | 0.14% | 1.05% |
| above $1B | 40% | 0.06% as printed | 0.9% |
| above $2B | 50% | 0.08% as printed | 0.75% |

The page prints 0.06% and 0.08% for the crypto against crypto column at 40% and 50% off, which does not match 0.2% less 40% and 50%, 0.12% and 0.1%.
Both are written as published.
Currency against currency pairs cost 0%, and stocks, ETFs, indices and commodities cost 0.05% on the exchange mode, S4.

### Qualification

The page names the measure only as "executed trading volume" and gives no window, S4.
The Market maker account type is `Negotiated`.

## 5. Discounts that change the taker

| discount | effect | evidence |
|---|---|---|
| token holding | none found | `Not offered` on S4 |
| referral | none found on the fee page | `Not publicly specified` |
| market maker | 30% to 50% off, section 4 | `Published`, S4 |
| zero fee promotion | none found | `Not publicly specified` |

## 6. Funding as a cost

Dzengi has no funding.
The nearest charge is the Leverage mode's "leverage fee", which the venue charges on a position held past a fixed time, S4.

| item | value | evidence |
|---|---|---|
| when | "3 times per day, 00:00, 08:00, 16:00" UTC+3 for cryptocurrencies, once per day at 00:00 UTC+3 for the rest | `Published`, S4 |
| interval on the wire | `swapChargeInterval` 480 minutes on BTC/USD, BTC/EUR, ETH/USD and ETH/EUR, and 1440 minutes on the other 71 TRADING crypto leverage symbols | `Probed`, which disagrees with the page for those 71 |
| amount | "Number of tokens × Token price × Fee rate", on the full leveraged size | `Published`, S4 |
| rate on the wire | `longRate` -0.01 and `shortRate` 0.01 on BTC/USD_LEVERAGE. Across the 75 TRADING crypto leverage symbols `longRate` runs from -0.101 to -0.01 and `shortRate` from -0.0684932 to 0.01. | `Probed`, unit `Not publicly specified` |
| to whom | charged by the venue to the position holder, not exchanged between longs and shorts | `Published`, S4 and S5 |

Spot has no holding cost.

The Leverage mode also charges a trade fee at opening and again at closing, S4.
The page gives 0.06% for BTC/USD, BTC/EUR, ETH/USD and ETH/EUR and 0.075% for other cryptocurrencies.
On the wire `tradingFee` is 0.06 on 12 TRADING crypto leverage symbols, which add TON/USD, PEPE/USD, MELANIA/USD, QNT/BTC, TRUMP/USD, TWT/BTC, MEW/USD and POPCAT/USD to the four the page names, and 0.075 on the other 63.
The Leverage counts in this section come from the 1,230 row catalog that four of five runs got.
The fifth run got a 925 row catalog with 78 TRADING crypto Leverage symbols, 0.075 on 66 of them and 1440 minutes on 74, see [`rest.md`](./rest.md) section 2.

## 7. Liquidation, settlement and delisting

| item | value | evidence |
|---|---|---|
| spot liquidation | not applicable | |
| Leverage mode closeout | The counterparty may close positions when the loss reaches the margin, "at their sole and absolute discretion". No closeout fee is published. | `Published`, S5 definition of "Closeout" |
| settlement | none, spot settles on trade | |
| delisting | no published charge | `Not publicly specified` |
| deposits and withdrawals | card deposits and withdrawals 2.5%, bank transfers in USD and EUR 0% in and 8 units out, crypto withdrawal fees per coin and "dynamic" | `Published`, S4 |

## 8. CCXT

CCXT 4.5.68 has no Dzengi class.
`node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds no `dzengi.js` and no `currencycom.js`, and no file there mentions `dzengi` or `currency.com`.
CCXT had a `currencycom` class for Currency.com, the venue's former name and API host.
It was removed on 2025-03-03 by commit `d218563` "remove currencycom (#25394)", S7, the same day as issue #25391, which showed `GET https://api-adapter.backend.currency.com/api/v2/exchangeInfo fetch failed`, S8.
The current CCXT master on GitHub has no `ts/src/currencycom.ts` and no `ts/src/dzengi.ts`, both 404 on 2026-10-09.
Two pull requests that add a `dzengi` class are open and unmerged: #25976 "new exchange: dzengi.com", opened 2025-05-16, and #26259 "implement dzengi", opened 2025-06-20 and last updated 2026-07-29, S9.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 2000 for USDT and BTC quoted spot pairs, 15000 for USD, EUR and BYN quoted pairs | the published Individual commission, confirmed by `exchangeFee` on the wire |
| `ccxtTakerPpm` | none | no CCXT class |

The engine has no spot leg, and Dzengi has no CCXT class, so no registry entry is recommended.
A future spot adapter would read `exchangeFee` per symbol from `exchangeInfo`, which already carries the 0.2 and 1.5 split and the four USD exceptions.
It should not use `GET /api/v2/tradingFees`, which answers without credentials but reports 0.075 for BTC/USDT and ETH/USDT, and its row count changed between calls, see [`rest.md`](./rest.md) section 3.

## 10. Source ledger

| id | source | used for |
|---|---|---|
| S1 | <https://dzengi.com/api>, retrieved 2026-10-09 | entity, regulator, excluded regions |
| S2 | <https://dzengi.com/general-websocket-api-information>, retrieved 2026-10-09 | socket URL, see [`websocket.md`](./websocket.md) |
| S3 | <https://apitradedoc.dzengi.com/v2/api-docs?group=public-api>, the Swagger behind <https://apitradedoc.dzengi.com/swagger-ui.html>, retrieved 2026-10-09 | the list of public calls |
| S4 | <https://dzengi.com/fees-charges>, retrieved 2026-10-09 | every fee, tier, discount and leverage fee |
| S5 | <https://dzengi.com/terms-and-conditions>, a PDF, "The text (version) as of April 8, 2026", retrieved 2026-10-09 | territory, Leverage-operation, Counterparty, Closeout |
| S6 | <https://dzengi.com/agreement>, retrieved 2026-10-09 | excluded regions |
| S7 | <https://github.com/ccxt/ccxt/commit/d218563105fe3086b97d8a1323ea2e2f79fd2608> | removal of `currencycom` |
| S8 | <https://github.com/ccxt/ccxt/issues/25391> | the failing Currency.com host |
| S9 | <https://github.com/ccxt/ccxt/pull/25976> and <https://github.com/ccxt/ccxt/pull/26259> | open Dzengi pull requests |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/dzengi/rest-probe.py) | `exchangeFee`, `tradingFee`, `swapChargeInterval`, rates, `tradingFees` |
