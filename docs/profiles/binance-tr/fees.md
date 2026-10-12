# Binance TR Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 02:52 to 03:12 UTC, from the development host near Seattle, through the Surfshark WireGuard exit in Vancouver, Canada.

Binance TR is CoinMarketCap's exchange rank 15, survey wave 42, and it has no CCXT class.
It lists no perpetual, so this profile covers its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
Every one of its 309 markets is a TRY pair whose order book is Binance.com's own book for the same pair, see [`rest.md`](./rest.md) section 2.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/binance-tr/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/binance-tr/rest-probe.py).

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-10-09 for every source row | source ledger |
| operator | BİNANCE TURKEY KRİPTO VARLIK ALIM SATIM PLATFORMU A.Ş., Şişli, İstanbul, Mersis no 178140451300001 | footer of the fee page, S2, printed by P1 section 4 |
| CoinMarketCap listing | "Binance TR", id 1375, launched 2020-09-08, fiat TRY, country TR, 24 h spot volume 212,249,136.61 USD in run 1 and 212,760,087.39 USD in run 2, perpetual and futures volume 0 | S4, P1 section 5 |
| CoinGecko listing | none. CoinGecko's exchange list of 1,503 rows has `binance`, `binance_futures` and `binance_us` as its only Binance ids, and its derivatives list of 216 rows has `binance_futures` only | S5, P1 section 6, added for run 2 |
| who may trade | "offering its services to residents of Turkey", in CoinMarketCap's venue text | S4. The operator's own user agreement was not read, so any rule for foreign nationals is Not verified |
| US persons and other regions | Not publicly specified in any page read here | |
| fiat | TRY only, and "Turkish Lira (TRY) deposit and withdrawals are free" | S2 |
| site and API from this host | the website, the documented REST hosts and the stream host all answer normally from the Canadian exit, with no geoblock and no challenge | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

Binance TR lists no perpetual, so there is no perpetual VIP 0 fee.
All 309 listed markets are TRY pairs, and the TRY pair schedule prices them.

| market | maker | taker | evidence |
|---|---|---|---|
| TRY pairs, 309 listed, VIP 0 below 10,000,000 TRY of 30 day volume | 0.10 %, 1,000 ppm | 0.20 %, 2,000 ppm | `/v1/commission/fiat/rule`, the call behind the "TRY Pair Trading Fee" table of the fee page, S1 and S2, P1 section 1 |
| crypto pairs, VIP 0 | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | `/v1/common/vip-rules`, S1 and S2, P1 section 2. No crypto pair is listed on 2026-10-09, so this row prices nothing today |

The same BTCTRY book costs a Binance.com Regular account a 0.100 % taker, see [`../binance/fees.md`](../binance/fees.md) section "Binance.com spot and margin trading tiers".
So Binance TR's door to that book charges twice the Binance.com taker at the base tier.

CoinMarketCap's venue text says "up to 0.1% apply for Maker positions and up to 0.15% for Taker positions on TRY trading pairs", S4.
The operator's own schedule says 0.20 % at VIP 0, so that text is out of date.
CoinMarketCap's `makerFee` and `takerFee` fields are both 0.0, which is a placeholder rather than a rate, P1 section 5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals, any settlement | absent | all 309 catalog rows have `permissions` `["SPOT"]` and `marginTradingEnable` 0, [`rest.md`](./rest.md) section 2. The API docs name no futures endpoint, S3. CoinMarketCap says "Binance TR does not offer Leverage, Margin, or Futures Trading on its platform" and reports 0 perpetual volume, S4. `/fapi/v1/premiumIndex` answers 403 on `api.binance.me` and 404 on `www.binance.tr` and `edge.binance.tr`, [`rest.md`](./rest.md) section 3 |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| margin | absent | `marginTradingEnable` 0 on every row, and CoinMarketCap's text |
| spot, TRY quote | present, 309 pairs, all `type` 1, the "Main" type that the docs route to Binance's own hosts | [`rest.md`](./rest.md) section 2 |
| spot, crypto quote | absent from the catalog, though a crypto pair VIP schedule is published | catalog and S1 |
| `type` 2 and `type` 3 symbols | none listed. The docs still describe a `type` 3 host pair on `2meta.app` for "Nextme" symbols | S3, [`websocket.md`](./websocket.md) section 1 |

Deposit and withdrawal fees are on the "Withdrawal & Deposit Fee" tab of the fee page, S2, and are not recorded here.
The page adds "Crypto withdrawals between Binance.com & Binance TR are free."

## 4. Spot tiers

### TRY pairs

The fee page evaluates TRY pair volume over 30 days "Everyday at 03:00 AM" and updates the tier "at 04:00 AM", S2.
The rows below are `/v1/commission/fiat/rule` as probed, P1 section 1.

| tier | 30 day TRY pair volume, TRY | maker | taker |
|---|---|---|---|
| 0 | below 10,000,000 | 0.10 %, 1,000 ppm | 0.20 %, 2,000 ppm |
| 1 | 10,000,000 to 50,000,000 | 0.09 %, 900 ppm | 0.15 %, 1,500 ppm |
| 2 | 50,000,000 to 100,000,000 | 0.08 %, 800 ppm | 0.15 %, 1,500 ppm |
| 3 | 100,000,000 to 150,000,000 | 0.04 %, 400 ppm | 0.15 %, 1,500 ppm |
| 4 | 150,000,000 and above | 0.02 %, 200 ppm | 0.10 %, 1,000 ppm |

The last row's `tradeMaxVolume` is `0.000000`, which reads as no upper bound.
The API docs added `fiatMakerCommission` and `fiatTakerCommission` to the signed account call on 2026-04-07, as the "commission rate for TRY (fiat) pairs", S3.

### Crypto pairs

The rows below are `/v1/common/vip-rules` as probed, P1 section 2.
Volume is in USD over 30 days, and every row has a BNB balance requirement of 0.

| VIP | 30 day volume, USD | maker | taker |
|---|---|---|---|
| 0 | 0 | 0.100 %, 1,000 ppm | 0.100 %, 1,000 ppm |
| 1 | 1,000,000 | 0.090 %, 900 ppm | 0.100 %, 1,000 ppm |
| 2 | 5,000,000 | 0.080 %, 800 ppm | 0.100 %, 1,000 ppm |
| 3 | 20,000,000 | 0.042 %, 420 ppm | 0.060 %, 600 ppm |
| 4 | 75,000,000 | 0.042 %, 420 ppm | 0.054 %, 540 ppm |
| 5 | 150,000,000 | 0.0252 %, 252 ppm | 0.0336 %, 336 ppm |
| 6 | 400,000,000 | 0.0210 %, 210 ppm | 0.0294 %, 294 ppm |
| 7 | 800,000,000 | 0.0192 %, 192 ppm | 0.0288 %, 288 ppm |
| 8 | 2,000,000,000 | 0.0165 %, 165 ppm | 0.0275 %, 275 ppm |
| 9 | 4,000,000,000 | 0.0120 %, 120 ppm | 0.0240 %, 240 ppm |

The reply carries each rate twice, as `makerCommission` and `takerCommission` and again as the misspelled `MakerCommossion` and `TakerComission`, with equal values.

## 5. Discounts that change the spot taker

| discount | rule | effect | evidence |
|---|---|---|---|
| paying fees in BNB | `/v1/common/system-config` returns `specificAsset` `BNB` and `specificAssetPayFeeDiscount` 0.75. The signed out fee page renders "BNB 0.00% Discount" above the TRY table and "BNB 100.00% Discount" above the crypto table | the factor 0.75 suggests a fee paid in BNB costs 75 % of the rate, but the page's two labels do not match it, so the effect on a TRY pair is Not verified | S1 and S2, P1 sections 3 and 4 |
| market maker programme | Not publicly specified | | |
| referral | `/v1/user/invite/info` exists in the web bundle and needs a session | Not publicly specified | S1 |
| zero fee promotion | none seen on the fee page or in the API change log | | S2 and S3 |

## 6. Funding as a cost

Binance TR has no perpetual, so there is no funding rate, interval, cap or settlement.

## 7. Liquidation, settlement and delisting

- There is no margin or derivative product, so there is no liquidation fee and no settlement charge.
- The catalog has no status field, so a halted pair cannot be told from a trading one by the catalog alone.
  Binance.com lists 59 TRY pairs in `BREAK` and none of them is in the Binance TR catalog, so a pair appears to leave the catalog when Binance halts it, see [`rest.md`](./rest.md) section 2.
- A delisting charge is Not publicly specified.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 | no class for Binance TR among the 104 exchange files in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and no file in that folder contains the strings `trbinance`, `binance.tr`, `binance.me` or `binancetr` |
| CCXT master on GitHub | `ts/src` holds 103 files at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08 09:28 UTC, and the only Binance files are `binance.ts`, `binancecoinm.ts`, `binanceus.ts` and `binanceusdm.ts`, S6 |
| open requests | issues 8122 "New Exchange tr.binance" and 11131 "New Exchange: trbinance (binance turkey)" are open, and 9289 and 17183 are closed, S6 |
| the `binance` class on the same book | it loads `BTC/TRY` with id `BTCTRY` from `https://api.binance.com/api/v3`, at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/binance.js` line 246, and reads the same book Binance TR sells, [`rest.md`](./rest.md) section 2. Its spot `taker` is `this.parseNumber('0.001')` at line 1240, which is the Binance.com rate and not the 0.002 a Binance TR account pays |
| `market.taker` for Binance TR | none, there is no class to report one |

## 9. Recommended registry values

No registry entry is recommended.
Binance TR has no perpetual and no CCXT class, so it cannot be a perpetual leg.
Its TRY books are Binance.com's books, which the `binance` class already reaches, so a separate Binance TR spot leg would add a second fee schedule on an existing book, not a new book.
If a TRY spot leg were ever built for a Binance TR account, `takerPpm` would be 2,000, and `ccxtTakerPpm` would be 1,000 only if it went through the `binance` class, from `binance.js` line 1240.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Binance TR web app calls behind the fee page, found in `main.c0752b46.js` | https://www.binance.tr/v1/commission/fiat/rule, https://www.binance.tr/v1/common/vip-rules and https://www.binance.tr/v1/common/system-config | 2026-10-10 UTC | Binance TR | TRY and crypto schedules, BNB factor, sections 2, 4 and 5 |
| S2 | Binance TR fee page, title "Ücret Tablosu" | https://www.binance.tr/en/fees | 2026-10-10 UTC | Binance TR | table names, evaluation times, BNB labels, free TRY transfers, operator line, sections 1 to 5 |
| S3 | Binance TR API documentation and change log | https://www.binance.tr/apidocs/ | 2026-10-10 UTC, change log head 2026-08-28 | Binance TR | no futures endpoints, symbol types, `fiatTakerCommission`, sections 3 and 4 |
| S4 | CoinMarketCap data API, exchange detail `binance-tr` | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=binance-tr | 2026-10-10 02:54 UTC | CoinMarketCap | listing, volumes, residents of Turkey, no futures, stale fee text, sections 1 to 3 |
| S5 | CoinGecko API exchange list and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/list | 2026-10-10 UTC | CoinGecko | no Binance TR entry, section 1 |
| S6 | CCXT repository, `ts/src` listing, master commit and issue search | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-10-10 UTC | CCXT | no Binance TR class, section 8 |
| P1 | `fees-probe.py`, run 1 at 02:56 UTC and run 2 at 03:07 UTC | [`fees-probe.py`](../../../scripts/probes/venues/binance-tr/fees-probe.py) | 2026-10-10 UTC | this host | sections 1 to 5 |
| P2 | `rest-probe.py`, run 1 at 02:55 UTC and run 2 at 03:07 UTC | [`rest-probe.py`](../../../scripts/probes/venues/binance-tr/rest-probe.py) | 2026-10-10 UTC | this host | catalog and shared book, sections 3 and 7 |
