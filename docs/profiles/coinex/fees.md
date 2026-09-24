# CoinEx Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:18 to 03:36 UTC, from the development host near Seattle.

This profile covers CoinEx (CCXT id `coinex`) and its USDT-margined, USDC-margined and coin-margined perpetuals.
CoinEx announced an orderly cessation of operations, and its futures service ceased on 2026-09-22, the day this survey reached it, S1.
The fee schedule below is recorded for completeness, but no perpetual on CoinEx can be traded any more, so none of it applies to the engine.
Every number carries a source from section 10, a probe from [`rest.md`](./rest.md), or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | CoinEx, country Samoa and established 2017 according to CoinGecko | S7 |
| cessation | announced 2026-09-14 04:07 UTC, last edited 2026-09-15 02:49 UTC, titled "Important Notice on CoinEx's Orderly Cessation of Operations" | S1 |
| futures from 2026-09-15 | "All futures markets will enter Reduce-Only Mode, and users may only close existing positions" | S1 |
| futures from 2026-09-22 | "Futures services will cease, and all unfilled futures orders will be canceled", and open positions "will be forcibly settled by the platform, with the settlement price based on the index price" | S1 |
| spot | trading ceases 2026-09-29, and non-USDT balances are converted from 02:00 UTC that day | S1 |
| withdrawals | until 02:00 UTC on 2026-12-22 | S1 |
| new users | registrations ceased on 2026-09-15 | S1 |
| prohibited jurisdictions | United States, mainland China, Hong Kong, Canada, the European Economic Area, the United Kingdom, Switzerland, Kazakhstan, Iran, North Korea, Cuba, and sanctioned jurisdictions, last edited 2026-09-03 | S2 |

No one may open a perpetual position on CoinEx today.
US persons were excluded before the cessation, S2.
The legal entity behind the terms of service was not researched, because the product it would govern no longer trades.

What the wire showed on 2026-09-23 between 03:18 and 03:36 UTC is in [`rest.md`](./rest.md) section 2.
Every one of the 221 listed futures books was empty, the last BTCUSDT futures trade was at 03:17:52 UTC on 2026-09-22, and the index had not moved since 03:10 UTC that day.

## 2. Quick answer

The schedule that applied until the cessation, identical for both perpetual families, S3 and S4.

| family | VIP 0 maker | VIP 0 taker |
|---|---|---|
| USDT-margined and USDC-margined linear perpetuals | 0.030 %, 300 ppm | 0.050 %, 500 ppm |
| coin-margined inverse perpetuals | 0.03 %, 300 ppm | 0.05 %, 500 ppm |

The public catalog agrees, with `maker_fee_rate` `"0.0003"` and `taker_fee_rate` `"0.0005"` on all 221 contracts, `rest-probe.mjs catalog` in [`rest.md`](./rest.md) section 2.

## 3. Coverage matrix

| product | present | notes |
|---|---|---|
| USDT-margined linear perpetuals | ceased 2026-09-22 | 201 contracts still listed as `online`, every book empty |
| USDC-margined linear perpetuals | ceased 2026-09-22 | 18 contracts still listed, every book empty |
| coin-margined inverse perpetuals | ceased 2026-09-22 | `BTCUSD` and `ETHUSD` still listed, both books empty |
| dated futures | absent | CoinGecko lists 0 futures pairs, S6 |
| options | absent | the v2 API documentation covers account, asset, spot, futures and referral only, S10 |
| spot | present until 2026-09-29 | `BTCUSDT` spot book held 50 levels per side at probe time, [`websocket.md`](./websocket.md) section 4 |

CoinGecko's derivatives page still showed "CoinEx (Futures)" with 223 perpetual pairs and a 24 h volume of 0.0 BTC at probe time, S6.

## 4. Perpetual tiers

VIP tiers, S3 and S4.

| level | maker | taker |
|---|---|---|
| VIP 0 | 0.030 % | 0.050 % |
| VIP 1 | 0.028 % | 0.048 % |
| VIP 2 | 0.026 % | 0.046 % |
| VIP 3 | 0.024 % | 0.044 % |
| VIP 4 | 0.022 % | 0.042 % |
| VIP 5 | 0.020 % | 0.040 % |

Market maker tiers, ranked by share of volume, S3.

| level | ranking | maker | taker |
|---|---|---|---|
| LV 5 | ≤ 10 % | -0.01 % | 0.025 % |
| LV 4 | ≤ 25 % | -0.008 % | 0.025 % |
| LV 3 | ≤ 45 % | -0.006 % | 0.025 % |
| LV 2 | ≤ 70 % | 0 % | 0.025 % |
| LV 1 | bottom 30 % | 0 % | 0.03 % |
| LV 0 | none | 0.03 % | 0.05 % |

### Qualification

A VIP level is reached on any one of CET holding, total asset value, 30-day spot volume or 30-day futures volume, S8.
VIP 1 needed 2,000 CET, 10,000 USD of assets, 20,000 USD of spot volume or 200,000 USD of futures volume, and VIP 5 needed 1,000,000 CET, 500,000 USD, 1,000,000 USD or 10,000,000 USD, S8.
The snapshot was taken at 00:00 UTC and the level updated at 01:00 UTC daily, S8.

## 5. Discounts that change the perpetual taker

"Use CET as Fees" was not available for futures trading, S3.
Referral rebates ceased on 2026-09-15, S1.
No zero fee promotion was found.

## 6. Funding as a cost

Funding was calculated every minute and charged every 8 hours by default, and "When the premium rate is too high, it can be dynamically adjusted to 2h or 4h", S5.
All 221 contracts read an 8 h interval from `futures/funding-rate` at probe time, and the cap was ±0.015 on 158 contracts, ±0.0075 on 59 and ±0.00375 on 4, including `BTCUSDT`, [`rest.md`](./rest.md) section 4.
A positive rate had longs pay shorts, S5.
The cessation notice said funding would "continue to operate normally" during the reduce-only week, S1.
The `BTCUSDT` funding history shows the reduce-only week at or near its floor of -0.00375, between -0.00348955 and -0.00374996 on the five settlements from 2026-09-20 16:00 to 2026-09-22 00:00 UTC, [`rest.md`](./rest.md) section 4.
It kept writing rows at -0.00375 at 16:00 on 2026-09-22 and 00:00 on 2026-09-23, after trading stopped.
No settlement instant was captured.

## 7. Liquidation, settlement and delisting

The final settlement of every open position used the index price, S1.
The last `BTCUSDT` trades printed at 85,618 at 03:17:52 UTC on 2026-09-22, against a frozen index of 85,618.24, which is consistent with a forced settlement at the index rounded to the `BTCUSDT` tick of 1, [`rest.md`](./rest.md) section 2.
Liquidation fees were not researched.

## 8. CCXT

CCXT 4.5.68 reports `taker` 0.001 and `maker` 0.001 on every swap market without credentials.
The constant is `'taker': 0.001` at `server/node_modules/ccxt/js/src/coinex.js` line 448, with `'maker': 0.001` on line 447, and `fetchContractMarkets` copies it into each swap at line 971.
`rest-probe.mjs catalog` read 0.001 on all 221 swaps.
CCXT does not read the catalog's own `taker_fee_rate`, which said 0.0005.

## 9. Recommended registry values

None.
CoinEx should not be added to the registry, because its futures ceased on 2026-09-22 and the whole exchange stops trading on 2026-09-29, S1.
Had it stayed open, the values would have been `takerPpm` 500 from S3 and `ccxtTakerPpm` 1,000 from line 448.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Important Notice on CoinEx's Orderly Cessation of Operations | https://coinex-announcement.zendesk.com/hc/en-us/articles/53539656293908 | 2026-09-22 | CoinEx, global | cessation timeline, reduce-only, settlement at index, sections 1, 5, 6, 7 and 9 |
| S2 | List of Prohibited Jurisdictions | https://support.coinex.com/hc/en-us/articles/59334070059417 | 2026-09-22 | CoinEx, global | excluded regions, section 1 |
| S3 | Fee Structure for USDⓈ-Margined Contracts | https://support.coinex.com/hc/en-us/articles/7112450560921 | 2026-09-22 | CoinEx, global | VIP and market maker tiers, CET not usable for futures, sections 2, 4 and 5 |
| S4 | Fee Structure for Coin-Margined Contracts | https://support.coinex.com/hc/en-us/articles/48212842672537 | 2026-09-22 | CoinEx, global | inverse tiers, sections 2 and 4 |
| S5 | Get Market Funding Rate, CoinEx API v2 | https://docs.coinex.com/api/v2/futures/market/http/list-market-funding-rate | 2026-09-22 | CoinEx, global | funding fields, sign, 8 h default, section 6 |
| S6 | CoinGecko derivatives exchange `coinex_futures` | https://api.coingecko.com/api/v3/derivatives/exchanges/coinex_futures | 2026-09-22 | CoinGecko | 223 perpetual pairs, 0 futures pairs, 0.0 BTC volume, section 3 |
| S7 | CoinGecko exchange `coinex` | https://api.coingecko.com/api/v3/exchanges/coinex | 2026-09-22 | CoinGecko | country, year, section 1 |
| S8 | Introduction to CoinEx VIP Discount | https://support.coinex.com/hc/en-us/articles/360007575213 | 2026-09-22 | CoinEx, global | VIP qualification, section 4 |
| S9 | CCXT 4.5.68 `coinex.js` | `server/node_modules/ccxt/js/src/coinex.js` | 2026-09-22 | CCXT | fee constant lines 447 and 448, applied at line 971, section 8 |
| S10 | CoinEx API v2, API Introduction | https://docs.coinex.com/api/v2/ | 2026-09-22 | CoinEx, global | product modules, section 3 |
| P1 | `rest-probe.mjs catalog`, `anchor` and `depth` | [`rest-probe.mjs`](../../../scripts/probes/venues/coinex/rest-probe.mjs) | 2026-09-22 | this host | catalog fees, funding caps, the frozen state, sections 1, 2, 6, 7 and 8 |
