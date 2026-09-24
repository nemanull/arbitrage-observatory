# FMFW.io Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:43 UTC and a second pass at 04:48 to 04:54 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocates to Canada (Cloudflare `loc=CA`, edge `colo=YVR` on cloudflare.com, and `cf-ray` ending in `SEA` and later `YVR` on api.fmfw.io).

This profile covers the perpetual contracts of FMFW.io (CCXT id `fmfwio`), and nothing else.
FMFW.io runs the HitBTC API v3 platform, and CCXT's `fmfwio` class is a subclass of `hitbtc` that changes only the URLs and the fee constants, at `server/node_modules/ccxt/js/src/fmfwio.js` lines 8 to 33.
FMFW.io lists one perpetual family, USDT-margined linear contracts named `<BASE>USDT_PERP`, and spot is named once in the coverage matrix.
CoinGecko's derivatives list does not show FMFW.io, per the survey plan, but the venue's own catalog lists 24 perpetuals, 23 of them working.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/fmfwio/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/fmfwio/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local time, 2026-09-23 UTC | this profile |
| operator | FMFW Ltd, named as the party in the user agreement, last updated 2023-01-05 | S3 |
| jurisdiction | Not publicly specified in the retrieved agreement text. CCXT lists `countries: ['KN']`, Saint Kitts and Nevis, at `fmfwio.js` line 15, and CoinGecko lists Bahamas, established 2019 | S3, S7, S9 |
| CoinGecko | exchange id `bitcoin_com`, name FMFW.io, trust score 5, trust rank 119 on the API read of 2026-09-23 (the survey list said 116), 24 h volume 1,985 BTC | S9 |
| who may use the exchange | nobody located in, incorporated in, or a citizen or resident of the United States, Iran, North Korea, Sudan, Crimea and Sevastopol, Nicaragua, Syria, Ghana, the Democratic Republic of Congo, China, Cambodia, Myanmar, Libya, Iraq, Guinea Bissau, Lebanon, Somalia, Yemen, Afghanistan, Venezuela, Burundi, Zimbabwe, Haiti, the Central African Republic, Uzbekistan, or a US embargoed jurisdiction, agreement clause 2.1.5 | S3 |
| restricted countries article | the same list plus Bahamas, dated 2023-02-15, and a KYC-required list of 13 countries | S4 |
| who may trade the perpetuals | "Derivatives trading is restricted for residents of these countries and regions: Australia, Canada, Germany, Hong Kong, Italy, Japan, Netherlands, Ontario (Canada region), UK" | S4 |
| US persons | may not open an account at all | S3, S4 |
| this host | the Canadian exit is a derivatives-restricted region, and the site carries the message "Unfortunately, Margin and Futures trading is not available in your country yet". Public REST answered 200 and the public socket opened on every call, see [`rest.md`](./rest.md) section 1 | S2, P1 |

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.04 %, 400 ppm | 0.08 %, 800 ppm | S2 "Futures Trading fees are fixed for all tiers at 0.04% for Maker Fees and 0.08% for Taker Fees.", S5, and `take_rate` `"0.0008"` and `make_rate` `"0.0004"` on 24 of 24 futures rows of `/public/symbol`, P1 |
| spot, context only | 0.15 %, 1,500 ppm | 0.20 %, 2,000 ppm | `take_rate` `"0.002"` and `make_rate` `"0.0015"` on 619 of 645 rows of `/public/symbol`, and `"0.03"` on 2 FLOKI rows, P1 |

The `/public/symbol` reply documents `take_rate` and `make_rate` as the default rates, S1.
The engine models a taker cross at the base tier, so 800 ppm is the number that matters.

## 3. Coverage matrix

| product | present | count on 2026-09-23 | evidence |
|---|---|---|---|
| USDT-M linear perpetuals | yes | 23 `working`, 1 `expired` (`LUNAUSDT_PERP`) | `/public/symbol` rows with `type` `futures` and `contract_type` `perpetual`, P1 |
| USDC-M perpetuals | no | 0 | every futures row has `quote_currency` and `fee_currency` `USDT`, P1 |
| coin-margined or inverse perpetuals | no | 0 | same |
| dated futures | modelled, none listed | 0 | the API documents `contract_type` `cash_settled` with an `expiry`, example `UFO-1217` expiring 2024-12-17, S1, and none is in the catalog, P1 |
| options | no | 0 | CCXT `hitbtc` declares `option: false` at `hitbtc.js` line 33 |
| spot | yes | 618 `working`, 3 `suspended` | P1 |
| spot margin | yes | isolated and cross margin endpoints | S1 |

The site's embedded instrument list also names `EOSUSDT_PERP`, `MATICUSDT_PERP`, `KNCUSDT_PERP`, `FTMUSDT_PERP` and `FTTUSDT_PERP` with leverage `"0"`, which the API catalog no longer lists, S6.

## 4. Perpetual tiers

No perpetual tier table exists.
The fee page says the futures fees "are fixed for all tiers", S2, and the futures help article says "the fees for futures trading are the following: taker = 0.08%, maker = 0.04%", S5.

### Qualification

The spot tiers depend on 30-day volume in USDT, recalculated at 00:00 UTC daily and updated within one hour, S8.
The spot tier table is loaded by script on `https://fmfw.io/fee-tier` and was not captured, and it does not change the perpetual fee.

## 5. Discounts that change the perpetual taker

| discount | applies to perpetuals | evidence |
|---|---|---|
| token holding | Not publicly specified for futures. The fee page has a holder table "For General accounts, and Tier 1 and 2 traders" and "For Tier 3 to 10 traders", and the page's embedded feature flags set `feeTier.discounts` to `false` | S2, S6 |
| referral | "50% trading fee rebate for your referrals (7 days after signup)", with no product named | S2 |
| market maker | "Become a Market Maker!" and an application form "I want to apply for a lower commission", terms Not publicly specified | S2 |
| zero fee promotions | none current. The newest found, a 50 % discount on all fees, ran from 2021-09-29 to 2021-10-29, and older ones ran in 2020 | S10 |
| manual rates | the fee page string "Trading Fees for your account were set up manually" shows per account overrides exist | S2 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| payment | "Funding = Mark Value * Funding Rate", with Mark Value = price times quantity | S5 |
| formula | "Funding Rate = Average Premium Index + clamp (Average Interest Rate - Average Premium Index, - 0.05%, 0.05%)" | S5 |
| premium index | "(max(0, Impact Bid Price - Mark Price) - max(0, Mark Price - Impact Ask Price)) / Mark Price + current Funding Rate", sampled every minute | S5 |
| interest rate | `interest_rate` `"0.0001"` per 8 h period on 24 of 24 contracts | P1 `anchor` |
| check | `BCHUSDT_PERP` read `avg_premium_index` `-0.001441823352507007` and `funding_rate` `-0.000941823352507007`, which is the average plus the clamp's upper bound of 0.0005, so the published rate follows the formula | P1 `anchor` |
| interval | 8 h, at 00:00, 08:00 and 16:00 UTC. The article says "currently set to 8 hours". Successive history rows are 8.000 h apart on all 24 contracts, and 1,000 BTC rows fall 334, 333 and 333 at hours 0, 8 and 16 | S5, P1 `funding` |
| settlement stamp | the 2026-09-23 00:00 UTC history rows are stamped 4 to 40 ms after the hour, for example `2026-09-23T00:00:00.004Z` on BTC | P1 `funding` |
| cap and floor | Not publicly specified beyond the clamp on the interest term. The widest rates in the last 1,000 settlements of each contract, 23,470 rows, are `-0.003` on `LUNAUSDT_PERP` in May 2022 and `0.001626667` on `MANAUSDT_PERP` on 2026-05-29 | P1 `funding` |
| typical rate | 977 of the last 1,000 BTC settlements, 2025-10-25 to 2026-09-23, paid exactly 0.0001, and the maximum was 0.000157 | P1 `funding` |
| who pays | a positive rate is paid by longs to shorts, a negative rate by shorts to longs | S5 |
| who is charged | positions open when the countdown reaches zero. "If traders enter their position right after the counter starts and it is realized (closed) prior to the counter reaching 0 they will not have to make a payment nor receive any funding." | S5 |
| exchange share | "FMFW.io does not charge any commissions associated with funding rates, all payments are made between traders." | S2 |

The settlement instant itself was not captured, and the history and the documentation are the evidence here.
Whether the `funding_rate` the anchor call shows is the rate already settled or the rate the next settlement pays is disputed between the two doc pages, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| liquidation fee, fee page | "a Liquidation Fee in the amount of 0.5% of the position's value is charged in the quote currency", for margin and for futures | S2 |
| liquidation penalty, help article | "a certain amount of penalty is debited from the user (0.5% of the position volume)" | S5 |
| liquidation fee, site instrument data | `liquidationFeeRate` `"0.003"`, 0.3 %, on each of the 23 tradable perpetuals | S6 |
| after liquidation | collateral covers the loss, a surplus is returned, a shortfall goes to an internal "BEA" mechanism and then to ADL | S5 |
| settlement or delivery fee | none, since no dated contract is listed | P1 |
| delisting | `LUNAUSDT_PERP` has status `expired` with its last funding on 2022-05-13 and still sits in the catalog. `CELUSDT_PERP` is `working` with an empty book, no `max_initial_leverage`, and leverage `"0"` in the site data | P1, S6 |

The fee page and the site's instrument data disagree on the liquidation fee, 0.5 % against 0.3 %, and both are written here.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `fmfwio`, extends `hitbtc` | `server/node_modules/ccxt/js/src/fmfwio.js` lines 8 and 10 |
| class fee constant | `maker` and `taker` `0.005` | `fmfwio.js` lines 29 and 30 |
| parent fee constant | `taker` `0.0009` | `server/node_modules/ccxt/js/src/hitbtc.js` line 269 |
| per market `taker` | read from each row's `take_rate`, so `0.0008` on every swap | `hitbtc.js` line 877 |
| per market `maker` | read from `make_rate`, so `0.0004` on every swap | `hitbtc.js` line 878 |
| what `market.taker` reports | `0.0008`, 800 ppm, on 24 of 24 swaps from `loadMarkets` without credentials | P1 `catalog` |

The class constant of 0.005 never reaches a market, because `fetchMarkets` sets `taker` and `maker` from the catalog row.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 800 | the published VIP 0 perpetual taker, S2 and S5, and the catalog's `take_rate` |
| `ccxtTakerPpm` | 800 | what CCXT 4.5.68 reports on every swap, from `take_rate` at `hitbtc.js` line 877 |

Leaving `takerPpm` unset would give the same 800 ppm from CCXT, but a registry value guards against a catalog row that changes `take_rate`.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | FMFW.io API Documentation, v3 | https://api.fmfw.io/ | 2026-09-22 | FMFW.io | `take_rate` and `make_rate` as default rates, `cash_settled` contracts, margin endpoints |
| S2 | Fees and Limits page, embedded strings `fees_schedules.*`, `residence_restriction_popup.header` and `affiliate.advantages.discount` | https://fmfw.io/fees-and-limits | 2026-09-22 | FMFW.io | futures fees, liquidation fee, funding commission, discounts, access message |
| S3 | User Agreement, embedded in the site as `user_agreement_policy_confirmation.text`, `updated_at` 2023-01-05 | https://fmfw.io/fees-and-limits | 2026-09-22 | FMFW Ltd | operator, clause 2.1.5 restricted jurisdictions |
| S4 | List of restricted countries, 2023-02-15 | https://support.fmfw.io/en/articles/5535199-list-of-restricted-countries | 2026-09-22 | FMFW.io | excluded countries, derivatives-restricted regions |
| S5 | Futures, help article, 2021-10-18 | https://support.fmfw.io/en/articles/5534983-futures | 2026-09-22 | FMFW.io | funding formula, interval, who pays, liquidation penalty, futures fees |
| S6 | Fee tier page, embedded instrument list and feature flags | https://fmfw.io/fee-tier | 2026-09-22 | FMFW.io | `liquidationFeeRate`, leverage, delisted perpetual names, `feeTier.discounts` |
| S7 | CCXT 4.5.68 `fmfwio.js` and `hitbtc.js` | `server/node_modules/ccxt/js/src/fmfwio.js`, `server/node_modules/ccxt/js/src/hitbtc.js` | 2026-09-22 | CCXT | class constants, per market fee mapping, `countries` |
| S8 | Trading Fees, help article, 2022-06-21 | https://support.fmfw.io/en/articles/5534928-trading-fees | 2026-09-22 | FMFW.io | 30-day USDT volume qualification |
| S9 | CoinGecko exchange API, id `bitcoin_com` | https://api.coingecko.com/api/v3/exchanges/bitcoin_com | 2026-09-23 UTC | CoinGecko | trust rank, volume, country, year |
| S10 | Help articles 5608522, 5537432, 5534729 and 5537475 on fee promotions | https://support.fmfw.io/en/articles/5608522-50-trading-fee-discount-promotion | 2026-09-22 | FMFW.io | promotion dates |
| P1 | `rest-probe.mjs catalog`, `anchor` and `funding` at 04:31 to 04:33 UTC, rerun at 04:48 to 04:50 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/fmfwio/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | catalog counts, fee fields, CCXT `taker`, funding history, interest rate |
