# BiFinance Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 (2026-10-10 UTC), from the development host near Seattle, through the Surfshark WireGuard exit in Vancouver, Canada.

This profile covers perpetual trading on BiFinance (CoinMarketCap rank 44, no CCXT id), and nothing else.
BiFinance publishes no futures API and no fee page outside its web app.
Every number below comes from the web app's own API, read by [`fees-probe.py`](../../../scripts/probes/venues/bifinance/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/bifinance/rest-probe.py), or from the web app's JS bundle, which the source ledger names.
The perpetual calls answer only with the web app's MD5 request signature, whose key ships in the public bundle, as [`rest.md`](./rest.md) section 6 shows.

## 1. Scope and freshness

| item | value | label | source |
|---|---|---|---|
| retrieval date | 2026-10-09 | | probes |
| legal entity | not named in the web app bundle or the help centre search | Not publicly specified | S2, S8 |
| who may trade perpetuals | not stated beyond the region notice below | Not publicly specified | S2 |
| regions excluded | the bundle's "Region Access Restriction Notice" says access "is restricted in certain countries and regions, including but not limited to the People's Republic of China" | Published | S2, key `ipRestrictBody` |
| access from the Canadian exit | every public call answered, and no geoblock or refusal was seen | Probed | `rest-probe.py host`, `errors` |

The web app's About page claims regulatory licences and a United States licence badge.
This survey did not verify them, and the bundle names no licence number.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label |
|---|---|---|---|
| USDT-margined linear perpetuals, crypto, commodity and US stock contracts alike | 0.04 %, 400 ppm | 0.06 %, 600 ppm | Probed, Published in the web app |

The web app's Fees page reads the table from `POST /api/contract/tradeFee/list`, and its first row, `Lv.1`, is the base tier (S5, S1 `getfuturesFeeLevelsData` sets `v1TakerFee` from row 0).
`POST /api/contract/tradeFee/currentUserTradeFee` with no token returned `uid -1`, `levelName Lv.1`, maker `0.0004` and taker `0.0006`, which confirms `Lv.1` as the default tier (`fees-probe.py`).
No call returned a per contract fee, and the catalog has no fee field, so every contract pays the same tier.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT-margined linear perpetuals | yes, 55 contracts, all `onDealing 1` | `rest-probe.py catalog`, `POST /api/contract-market/get-all-contract-coinmarket` |
| of which US stock perpetuals | 18, `stockType US` on the contract tickers | `rest-probe.py catalog` |
| coin-margined or USDC-margined perpetuals | absent, `marketCoinName` is `USDT` on 55 of 55 | `rest-probe.py catalog` |
| dated futures | absent from the contract catalog, which has no expiry field | `rest-probe.py catalog` |
| options | absent from the contract catalog and from the futures web app calls in the bundle | S1, S4 |
| spot | present, 309 pairs: 244 USDT, 62 HKD, 2 ETH, 1 USDC | `rest-probe.py catalog`, `POST /api/market/coinMarkets` |

Spot is named here and not detailed.
Its VIP 0 maker and taker are both 0.2 %, 2,000 ppm (`fees-probe.py`, `POST /api/order/get-exchange-fee-levels`).

## 4. Perpetual tiers

From `POST /api/contract/tradeFee/list`, probed three times on 2026-10-10 between 02:36 and 02:48 UTC with identical values.
The rows were created in July 2023 and last updated between 2023-09-18 and 2023-10-24, by their `createTime` and `updateTime` fields.

| level | 30 day futures volume, USDT | 30 day average BFT holding | maker ppm | taker ppm |
|---|---|---|---|---|
| Lv.1 | 2,000,000 | 2,000 | 400 | 600 |
| Lv.2 | 5,000,000 | 5,000 | 380 | 580 |
| Lv.3 | 10,000,000 | 10,000 | 350 | 550 |
| Lv.4 | 20,000,000 | 20,000 | 300 | 500 |
| Lv.5 | 50,000,000 | 50,000 | 250 | 450 |
| Lv.6 | 100,000,000 | 100,000 | 200 | 400 |
| Lv.7 | 200,000,000 | 200,000 | 100 | 300 |
| Lv.8 | 500,000,000 | 500,000 | 0 | 200 |

### Qualification

The bundle's fee remarks say the tier is recalculated daily at 00:00 UTC+8 (S2, keys `feesRemark1` to `feesRemark32`).
The volume column is the last 30 days of futures volume in USDT, and the holding column is the 30 day average BFT balance (S2, keys `futuresTradeVolume` and `holdingBFT`).
"If both trading volume and holding amount conditions are met simultaneously, the more favorable fee is applied."
The `Lv.1` row carries thresholds although it is the default tier, and the bundle does not say what a lower volume earns, so this profile reads `Lv.1` as VIP 0 because the no-token call returns it.

## 5. Discounts that change the perpetual taker

| discount | effect | label |
|---|---|---|
| BFT holding | moves the account up the same table, see section 4 | Published |
| referral and partner rebates | the bundle names contract rebate transaction types and a partner programme, with no rate | Not publicly specified |
| coupons | the futures account has coupon calls (`/contract-account/coupons-use` and siblings) behind login | Account-gated |
| market maker programme | the only documented API is a market maker spot API keyed by `appKey` (S3), with no published fee | Negotiated |
| zero fee promotions | none found in the bundle or the help centre search | Not publicly specified |

## 6. Funding as a cost

| item | value | label | source |
|---|---|---|---|
| formula, cap and floor | not published in the bundle or the help centre | Not publicly specified | S2, S8 |
| interval | 8 hours, settlements at 00:00, 08:00 and 16:00 UTC by the history's `historyTime` steps of 28,800 s | Probed | `rest-probe.py funding` |
| current rate | `0` on 55 of 55 contracts, and also `0` for the unknown symbol `NOPEUSDT` | Probed | `rest-probe.py anchor`, `errors` |
| last settled record | 2026-04-27 16:00 UTC on BTCUSDT, ETHUSDT, SOLUSDT, TSLAUSDT and PAXGUSDT, and no BTCUSDT record after 2026-04-28 00:00 UTC | Probed | `rest-probe.py funding` |
| who pays | a ledger type "Funding fee" and "Funding costs" exists in the bundle, with no direction rule | Not publicly specified | S2 |

The published rate is a default value today, not a computed one, because the server returns the same `0` for a contract that does not exist.
The history shows funding was charged every 8 hours until 2026-04-27 and has not been recorded since.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

The bundle names the ledger types "Liquidation clearance" and "Liq.Compensation" and a counterparty insurance fund in its risk disclosure (S2).
No liquidation fee rate, settlement fee or delisting rule is published.
All three are Not publicly specified.

## 8. CCXT

BiFinance has no class in CCXT 4.5.68.
The installed source directory `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds no `bifinance.js`, and no other file there mentions BiFinance.
The current CCXT master, commit `f0aca06eb7` of 2026-10-08 (package version 4.5.85), has no `ts/src/bifinance.ts` either, which the GitHub contents listing of `ts/src` and a 404 on the raw file both showed (S7).
So there is no `market.taker` to read.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | the `Lv.1` default taker, probed with no token |
| `ccxtTakerPpm` | none | no CCXT class exists |

The venue is not recommended for the engine, as [`rest.md`](./rest.md) section 8 explains, so these values are for the survey record only.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | web app bundle `https://www.bifinance.com/assets/index-411dd017.js`, API paths, request signing, socket topics | 2026-10-09 |
| S2 | English locale chunk `https://www.bifinance.com/assets/index-e2dd252d.js`, fee remarks, region notice, ledger types | 2026-10-09 |
| S3 | API documentation chunk `https://www.bifinance.com/assets/DocsApi-96558f87.js`, the market maker spot API | 2026-10-09 |
| S4 | futures page chunks `https://www.bifinance.com/assets/Futures-f5abc5a8.js` and `CoinStockFutures-94efea10.js` | 2026-10-09 |
| S5 | Fees page chunk `https://www.bifinance.com/assets/Fees-e9a29e9c.js` | 2026-10-09 |
| S7 | CCXT master `https://api.github.com/repos/ccxt/ccxt/contents/ts/src` and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/bifinance.ts` (404) | 2026-10-09 |
| S8 | help centre search `https://bifinance.zendesk.com/api/v2/help_center/articles/search.json`, queries API, funding, fee, perpetual and restricted | 2026-10-09 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/bifinance/fees-probe.py) | 2026-10-10 UTC |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/bifinance/rest-probe.py) | 2026-10-10 UTC |
