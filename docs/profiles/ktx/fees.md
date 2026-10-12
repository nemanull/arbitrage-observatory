# KTX Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 02:44 to 03:11 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers perpetual trading on KTX, `www.ktx.com`, which has no CCXT id, so the folder is the slug `ktx`.
KTX is a centralised exchange, and it is not the KTX.Finance perpetual DEX, whose `ktx.finance` host failed the TLS handshake after 12 s from this exit.
KTX lists one perpetual family, USDT-margined linear perpetuals, which the API calls market `lpc`.
Spot, the prediction market and the on-chain product are named once in the coverage matrix.
Every number carries a source ledger row or a probe reference.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/ktx/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/ktx/rest-probe.py) and [`anchor-probe.py`](../../../scripts/probes/venues/ktx/anchor-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | Not publicly specified. The Terms of Service call the operator "KTX (the "Company," "we," "our," or "us")" and name no company, registration or governing law. | Not publicly specified | S9 |
| restricted regions | "the United States, Mainland China, Hong Kong, Macau, Singapore, Canada, France, the United Kingdom, North Korea, Cuba, Iran, Uzbekistan, Russia-controlled areas of Ukraine (currently Crimea, Donetsk, and Luhansk), Sevastopol, Sudan, Syria", plus sanctioned parties | Published | S9 |
| who may trade the perpetuals | an account holder of at least 18 outside the excluded jurisdictions | Region-specific | S9 |
| public API from this exit | every documented public call answered 200 with data, with no challenge and no region check | Probed | [`rest.md`](./rest.md) sections 1 and 6 |
| website and docs from this exit | `www.ktx.com`, `support.ktx.com` and the API docs at `ktx-private.github.io/api-en/` answered 200 | Probed | `fees-probe.py`, and `curl` on 2026-10-09 |

The exit geolocates to Vancouver, Canada, and Canada is an excluded jurisdiction under S9.
So trading from this exit is not allowed, while public market data was served without any refusal.
The development host itself sits in the United States, which is excluded too.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-M linear perpetuals | 0.04 % = 400 ppm | 0.06 % = 600 ppm | Published and Probed | S2, S3, S4, and `makerFee` `0.0004` and `takerFee` `0.0006` on all 263 contracts of the public catalog |

The engine models a taker cross at the base retail tier, so 600 ppm is the number that matters.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals | yes, 263 contracts in `GET /api/v1/products?market=lpc`, 234 with `active` 1 and 29 with `active` 0, every id ending `_USDT_SWAP` | Probed, [`rest.md`](./rest.md) section 2 |
| MINI contracts | a taker-only order mode on 26 of the same contracts, flagged `mini` 1. It shares the book and funding of the perpetual and charges the account's contract taker rate. | S7, Probed |
| coin-margined perpetuals | absent. `market=ipc` answers 200 with an empty list. | Probed |
| dated futures | absent. `market=lfc` and `market=ifc` answer 200 with empty lists. | Probed |
| options | absent, none in the API docs or on the rate list page | S1, S3 |
| spot | present, 185 pairs, 153 active, at 0.1 % maker and 0.2 % taker on 182 of them. Not detailed here. | Probed, S2 |
| prediction market | present, `market=forecast`, 1,022 rows, with its own fee table of 0 % maker and 2.00 % taker at VIP 0. Not detailed. | Probed, S3 |
| on-chain trading | a separate "KTX Onchain Trading" product in the help center. Not detailed. | help center search, 2026-10-09 |
| deposit and withdrawal | named only. S2 says KTX charges no deposit fee and passes on the network fee for withdrawals, and the help center article "KTX Withdrawal/Deposit Fee Standards" holds the list. | S2 |

## 4. Perpetual tiers

The rate list page `https://www.ktx.com/en/rate-list` renders its tables in the browser.
The numbers are constants in its script chunk `https://res.camelhash.com/ktx-web-ssr/Dqu7Vikn.js`, which [`fees-probe.py`](../../../scripts/probes/venues/ktx/fees-probe.py) locates by the class name `rate-list-container` and parses, S3.
The tab is labelled 合约交易, contract trading, and its only qualification column is 近30日交易量, 30-day trading volume.

| level | 30-day volume, USDT | maker | taker | taker ppm |
|---|---|---|---|---|
| VIP 0 | < 5,000,000 | 0.040 % | 0.060 % | 600 |
| VIP 1 | ≥ 5,000,000 | 0.020 % | 0.055 % | 550 |
| VIP 2 | ≥ 20,000,000 | 0.018 % | 0.045 % | 450 |
| VIP 3 | ≥ 50,000,000 | 0.015 % | 0.040 % | 400 |
| VIP 4 | ≥ 100,000,000 | 0.012 % | 0.035 % | 350 |
| VIP 5 | ≥ 200,000,000 | 0.008 % | 0.032 % | 320 |
| VIP 6 | ≥ 500,000,000 | 0.005 % | 0.030 % | 300 |
| VIP 7 | ≥ 1,000,000,000 | 0.000 % | 0.028 % | 280 |
| VIP 8 | ≥ 5,000,000,000 | -0.002 % | 0.026 % | 260 |

The volume unit is not printed on the page.
USDT is the only settlement asset, so the thresholds are read as USDT.

### Qualification

The contract tab has one condition, 30-day volume.
The spot tab adds total assets, joined by the label 且/或, "and/or", so whether one or both spot conditions qualify a level is not stated, S3.
The help center article S4 gives the same range, "0.04% to -0.002%" maker and "0.06% to 0.026%" taker across "VIP 0-VIP 8", on each of the 26 contracts it lists.
The fee structure article S2, updated 2026-04-16, gives only the base rates, 0.04 % and 0.06 %.

### Per contract rates in the catalog

`GET /api/v1/products?market=lpc` carries `feeMode` 0, "Unified fee rate", `makerFee` `0.0004` and `takerFee` `0.0006` on all 263 contracts, active or not, per [`rest-probe.py`](../../../scripts/probes/venues/ktx/rest-probe.py) section 2.
So the catalog agrees with the VIP 0 row and shows no per contract exception.

## 5. Discounts that change the perpetual taker

| discount | effect | label | evidence |
|---|---|---|---|
| platform token | "Users holding KTX platform tokens may receive reduced trading fees." No token, rate or table is named. | Not publicly specified | S2 |
| referral | the inviter receives a rebate of 20 % at Lv.1 up to 50 %, plus a 10 % second-level rebate, and can pass part of it to the invitee. Special-rate users such as market makers and VIPs produce no rebate. | Published | S10, S3 |
| fee cashback vouchers | promotional vouchers, described in the help center article "Fee Cashback Voucher Instructions" | Published, not detailed | help center search, 2026-10-09 |
| market maker | special-rate users exist, per the rebate exclusions on the rate list page. No public programme or rate. | Negotiated | S3 |
| zero fee promotions | none found for perpetuals. A USDC/USDT spot promotion at 0.01 % is announced in the help center. | Not offered for perpetuals | help center search, 2026-10-09 |

None of these changes the VIP 0 taker that the engine models.

## 6. Funding as a cost

| item | value | label | evidence |
|---|---|---|---|
| formula | "Funding Fee = Position Value × Funding Rate", with "Position Value = Mark Price × Contract Position Size" | Published | S5 |
| interval | 8 hours at 00:00, 08:00 and 16:00 UTC, and 4 hours on some pairs, "e.g., HYPEUSDT" | Published | S5 |
| interval on the wire | 141 contracts every 8 h, 120 every 4 h and 2 every 1 h, KAIA and ICX, from `nextFundingTime` minus `prevFundingTime` and from `funding_interval` | Probed | [`rest.md`](./rest.md) section 4 |
| who pays | longs pay shorts when the rate is positive, shorts pay longs when it is negative | Published | S5 |
| cap and floor | Not publicly specified. The largest absolute rate among active contracts was 0.003235. | Not publicly specified, Probed | `rest-probe.py` section 3 |
| interest component | the catalog carries `baseInterest` 0.0003 and `quoteInterest` 0.0006 on every contract, and the most common rates are 0.0001 on 8 h contracts and 0.00005 on 4 h contracts. That fits a daily interest of 0.0003 split across the day's settlements, which is an inference, not a published rule. | Probed, inference | `rest-probe.py` sections 2 and 3 |
| copied rates | 146 contracts carry `followFundingRate` 1. On those also listed on Binance USD-M, the KTX rate equalled Binance's `lastFundingRate` on 97 of 126 and sat within 0.000002 of it on 103, against 36 of 108 for the other contracts, see [`rest.md`](./rest.md) section 4. | Probed | `anchor-probe.py` |

The funding settlement instant itself was not captured, because the survey does not wait for clock events.

## 7. Liquidation, settlement and delisting

| item | value | label | evidence |
|---|---|---|---|
| liquidation trigger | the mark price reaching the liquidation price | Published | S6, S8 |
| liquidation fee | Not publicly specified. The liquidation price formulas subtract "Fees", and any surplus above the bankruptcy price goes to the insurance fund. | Not publicly specified | S8 |
| insurance fund and ADL | an insurance fund covers negative balances, and ADL follows when it cannot | Published | S8, S7 |
| settlement or delivery fee | Not offered, since there are no dated futures | Not offered | section 3 |
| delisting | 29 contracts carry `active` 0 and still answer the book call with an empty book stamped 2025-05-22. No delisting fee is published. | Probed, Not publicly specified | [`rest.md`](./rest.md) section 5 |

## 8. CCXT

KTX has no class in CCXT 4.5.68.
No file named `ktx.js` exists under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and no class there names the KTX hosts.
CCXT master at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c`, dated 2026-10-08, has no `ts/src/ktx.ts` and no `js/src/ktx.js`, both answering 404, and its README does not mention KTX, S11.
So there is no `market.taker` to read, and no `ccxtTakerPpm` constant exists.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the published VIP 0 contract taker, S2, S3 and S4, equal to `takerFee` on every catalog row |
| `ccxtTakerPpm` | none | no CCXT class exists, so the adapter holds 600 as a constant, as the Rust adapters without a class do |

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | KTX API doc (v4), `https://ktx-private.github.io/api-en/`, changelog top entry "2026-07-07 v4.2" | 2026-10-09 |
| S2 | "KTX Digital Asset Exchange Fee Structure", `https://support.ktx.com/hc/en-001/articles/4662605130654`, updated 2026-04-16 | 2026-10-09 |
| S3 | rate list page `https://www.ktx.com/en/rate-list` and its script chunk `https://res.camelhash.com/ktx-web-ssr/Dqu7Vikn.js` | 2026-10-09 |
| S4 | "USDT-Margined Perpetual Contracts", `https://support.ktx.com/hc/en-001/articles/4781242650654`, updated 2026-08-17 | 2026-10-09 |
| S5 | "Funding Rate", `https://support.ktx.com/hc/en-001/articles/4782607314078`, updated 2026-04-16 | 2026-10-09 |
| S6 | "Mark Price", `https://support.ktx.com/hc/en-001/articles/4775423250462`, updated 2026-04-16 | 2026-10-09 |
| S7 | "MINI Contract Introduction", `https://support.ktx.com/hc/en-001/articles/4962860007710`, updated 2026-06-22 | 2026-10-09 |
| S8 | "KTX Contract Forced Liquidation Mechanism Explanation", `https://support.ktx.com/hc/en-001/articles/5378989010462`, updated 2026-05-22 | 2026-10-09 |
| S9 | "Terms of Service for KTX", `https://support.ktx.com/hc/en-001/articles/4733818896670`, updated 2026-06-03, section "RESTRICTED JURISDICTIONS" | 2026-10-09 |
| S10 | "Invitation Rebate", `https://support.ktx.com/hc/en-001/articles/4818411758878`, updated 2026-06-30 | 2026-10-09 |
| S11 | CCXT master on GitHub, `https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src` | 2026-10-09 |

The help center articles were read through the public Zendesk API, `https://support.ktx.com/api/v2/help_center/en-001/articles/<id>.json`, by [`fees-probe.py`](../../../scripts/probes/venues/ktx/fees-probe.py).
