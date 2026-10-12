# ZKE Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:02 to 04:35 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

This profile covers perpetual trading on ZKE, which has no CCXT class, see section 8.
ZKE is a ChainUp white label, and its USDT margined perpetuals are the researched product.
Every number carries a source ledger row or a probe reference.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/zke/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py).
Source ids are shared with [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | "operated by ZKE Global Limited, registered in the Bahamas", founded October 2022 | Published | S3, S6 |
| registrations | a US FinCEN MSB number and a Canadian FINTRAC MSB number are listed on the Business Licenses page, which were not checked against the registers | Published | S4 |
| restricted locations | Not publicly specified. The Service Agreement holds no country list, and the words country, region, territory, United States and Canada do not appear in it | Not publicly specified | S5, P1 |
| eligibility | "You must have full legal capacity", and KYC, AML and sanctions screening may restrict access | Published | S5 |
| who may trade the perpetuals | an account holder who passes KYC and sanctions screening, with no published list of excluded regions | Not publicly specified | S5 |
| website from this host | `www.zke.com` answered 200 from AWS Tokyo with no challenge | Probed | P2, see [`rest.md`](./rest.md) section 1 |
| public API from this host | `futuresopenapi.zke.com`, `openapi.zke.com` and both socket hosts answered every public call | Probed | P2, see [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md) |

The development host's traffic exits in Canada, and no host refused a call or showed a region message.
CoinMarketCap lists ZKE as active, launched 2022-09-30, with no country and no volume in its detail call, S1 and P1.
The About page names spot trading, market data and API services as the core products, and it does not mention futures, S3.
The futures product is live all the same, with 42 perpetual listing and delisting notices in the support centre, P1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | source |
|---|---|---|---|---|
| USDT margined perpetuals, "U-Based Contracts" | 0.025 %, 250 ppm | 0.075 %, 750 ppm | Published | S2 |
| the same, per contract on the open API | `openMakerFee` 0.00025 on all 209 trading | `openTakerFee` 0.00075 on all 209 trading | Probed | P1, P3 |
| the same, per contract on the web list | `openMakerFeeRate` 0.00025 on all 213 rows | `openTakerFeeRate` 0.00075 on all 213 rows | Probed | P1 |
| coin margined perpetuals | `openMakerFee` 0.00025 on all 7 trading | `openTakerFee` 0.00075 on all 7 trading | Probed, not on the fee page | P1 |

The fee page and both catalog calls agree on 750 ppm for the taker.
The close rates equal the open rates on every row, P1.
The spot schedule, for context, is 0.200 % maker and 0.200 % taker, S2, which matches CoinMarketCap's 0.2 and 0.2, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT margined linear perpetuals | yes, 209 trading in the open API catalog, 205 of them in the funding schedule, see [`rest.md`](./rest.md) section 2 | P3 |
| the same, by asset class | of the 205 scheduled, 125 crypto, 74 equities, ETFs and pre-IPO names such as `ANTHROPIC` and `OPENAI`, 4 metals and 2 energy, by the web list's `assetClass` | P3 |
| coin margined inverse perpetuals | yes, 7 trading (`E-BTC-USD`, `E-ETH-USD`, `E-BCH-USD`, `E-LTC-USD`, `E-DOGE-USD`, `E-SOL1-USD`, `E-FILCOIN-USD`), `side` 0, 10 USD a contract, not detailed | P3 |
| `S-BTC-USDT`, a simulated contract margined in `EXUSD` | listed, `contractShowType` "模拟合约", which reads as simulated contract | P3 |
| USDC margined perpetuals | absent from every catalog call | P3 |
| dated futures | absent, `deliveryKind` 0 on all 213 web list rows | P3 |
| options | absent | P3 |
| spot | present, 435 symbols on `openapi.zke.com`, not detailed here | P3 |
| margin, copy trading, grid, earn, loans | named on the site, not detailed here | S2 |

## 4. Perpetual tiers

No tier table is published.
The fee page shows one maker and one taker for U-Based Contracts, and the word VIP does not appear on it, S2 and P1.
The page's four uses of "Tier" belong to the KYC withdrawal limit table, P1.
So any rate below VIP 0 is Negotiated or does not exist.

## 5. Discounts

| discount | effect on the perpetual taker | source |
|---|---|---|
| volume | none published | S2 |
| token holding | the web config lists a `ZKB` "ZKE Token", and no fee discount for holding it was found | S15, S2 |
| referral and affiliate | the site advertises a referral bonus and "up to 70% commission rewards" for affiliates, and their effect on the taker is Not publicly specified | S2 |
| market maker | Not publicly specified | |
| zero fee promotion | none running. The RWA cashback event refunded 100 % of fees on 69 futures pairs from June 30 to July 30 at 23:59 UTC+8, in 2026 by the article date, and the New Year event of 2023 to 2024 covered spot only | S8, P1 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | Not publicly specified, the support centre holds no funding article and the fee page has no funding section | S10, S2 |
| interval on the wire | `capitalFrequency` 8 h on 181 of the 205 USDT perpetuals, 4 h on 22 and 1 h on 2, and 8 h on the 7 coin margined ones | P3 |
| interval in a listing notice | "Funding Fee Settlement Frequency: Every 4 hours" for MINIMAXUSDT, which the web list matches | S7, P1 |
| next settlement on the wire | `nextCapitalSettTime` on every web list row, and `nextSettlementTime` on every socket mark frame, equal on 205 of 205 | P3, P8 |
| interest rate | `capitalRate` 0.0001 on every row, read as the usual 0.01 % per 8 h interest term, which is an inference | P3 |
| cap and floor on the wire | `capitalIntervalMax` and `capitalIntervalMin`, plus and minus 2 % on 135 of the 205 USDT perpetuals, 0.75 % on 42, 3 % on 14 and other values from 0.08 % to 1.5 % on the other 14 | P3 |
| cap in a listing notice | "Funding Rate Cap: +1.00% / -1.00%" for MINIMAXUSDT, which the web list's `capitalIntervalMax` 0.01 matches | S7, P1 |
| premium clamp on the wire | `capitalPremiumMax` 0.0005 and `capitalPremiumMin` minus 0.0005 on every contract config row | P3 |
| who pays | Not publicly specified, the usual rule that longs pay shorts when the rate is positive is assumed by the engine | |

The two published rates, `currentFundRate` and `nextFundRate`, usually agree, and where they differ is in [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting charges

| item | value | source |
|---|---|---|
| liquidation | `liquidationRate` 0.00075 on all 213 web list rows, whose meaning is Not publicly specified | P1 |
| insurance fund | the site links an Insurance Fund page, not read here | S2 |
| settlement | none, the perpetuals do not expire | P3 |
| delisting | notices such as STORJUSDT (260821) and TONUSDT (260615) announce delistings, and their charges are Not publicly specified. Four contracts trade in the open API catalog with no funding schedule, see [`rest.md`](./rest.md) section 2 | S10, P3 |

## 8. CCXT

CCXT 4.5.68 has no ZKE class.
The installed source folder, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, holds 104 `.js` files, no file name contains "zke", and no file contains the word "zke", P1.
So there is no file and line to cite.
The current CCXT source on GitHub, `ts/src` at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08, lists 110 entries, and none contains "zke", S11 and P1.
So CCXT reports no `market.taker` for this venue.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 750 | the published 0.075 % futures taker, S2, which `openTakerFee` repeats on every trading contract, P1 |
| `ccxtTakerPpm` | none | no CCXT class |

The engine's ChainUp family adapter carries the taker in its `Profile`, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 35, and reads the per contract `openTakerFee` first, at [`markets.rs`](../../../server/src/venues/chainup/markets.rs) lines 123 to 129.
A ZKE profile would set `taker_ppm: 750`.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinMarketCap exchange detail | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=zke | 2026-10-09 | CoinMarketCap, id 9665 | status, launch date, fee URL, spot fees |
| S2 | Rate Standards, the fee page | https://pages.zke.com/en_US/fees, reached from CoinMarketCap's fee URL https://support.zke.com/fee/ | 2026-10-09 | ZKE | spot and U-Based Contracts maker and taker, the KYC table, the product menu, sections 2, 4, 5 and 7 |
| S3 | About ZKE Exchange | https://support.zke.com/api/public/articles/about-us | 2026-10-09 | ZKE Global Limited, created 2025-09-14 | entity, registration, products, section 1 |
| S4 | Business Licenses | https://support.zke.com/api/public/articles/license | 2026-10-09 | ZKE, created 2025-09-14 | the MSB registrations, section 1 |
| S5 | Service Agreement | https://support.zke.com/api/public/articles/service-agreement | 2026-10-09 | ZKE, created 2025-09-06 | eligibility, KYC and sanctions screening, no country list, section 1 |
| S6 | Disclaimer | https://support.zke.com/api/public/articles/disclaimer | 2026-10-09 | ZKE Global Limited and its affiliates, created 2025-09-14 | the operating entity, section 1 |
| S7 | ZKE will list MINIMAXUSDT perpetual contract | https://support.zke.com/api/public/articles/minimaxusdt | 2026-10-09 | ZKE, created 2026-09-19 | interval and cap of one contract, section 6 |
| S8 | RWA and Contract Trading Cashback | https://support.zke.com/api/public/articles/rwa260630 | 2026-10-09 | ZKE, created 2026-05-02 | the ended fee refund event, section 5 |
| S10 | Support centre article index | https://support.zke.com/api/public/cms/data | 2026-10-09 | ZKE | 302 articles, none on funding or a fee schedule, sections 6 and 7 |
| S11 | CCXT `ts/src` listing | https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src | 2026-10-09 | CCXT | no ZKE class, section 8 |
| S15 | ZKE web config | https://www.zke.com/fePublicInfo/en_US | 2026-10-09 | ZKE | the `ZKB` token, section 5 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/zke/fees-probe.py) | `uv run scripts/probes/venues/zke/fees-probe.py` | 2026-10-09 | this host, Canadian exit | the fee page, the articles, the per contract fee fields, CoinMarketCap and the CCXT checks |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) mode `host` | | 2026-10-09 | this host | access, section 1 |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/zke/rest-probe.py) mode `catalog` | | 2026-10-09 | this host | catalog, web list and contract config, sections 3, 6 and 7 |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/zke/ws-probe.py) mode `all` | | 2026-10-09 | this host | socket next settlement, section 6 |
