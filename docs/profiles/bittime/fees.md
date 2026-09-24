# Bittime Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:09 and 03:44 UTC on 2026-09-23.

This profile covers the fees of the Bittime USDT-margined perpetuals, the only perpetual family the venue lists.
Bittime has no CCXT 4.5.68 class, and CCXT master on GitHub has none either, see section 8.
Bittime publishes no futures fee schedule, so the perpetual taker below comes from the contract list the futures web page loads, which is not part of the API documentation.
Every number carries a source from the ledger in section 10, a probe run of [`rest-probe.mjs`](../../../scripts/probes/venues/bittime/rest-probe.mjs), or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | PT Utama Aset Digital Indonesia, trading as Bittime, founded 2021-09-28 | S8 |
| licence | Izin Usaha Pedagang Aset Keuangan Digital number KEP-11/D.07/2025 of 2025-05-22, issued by Otoritas Jasa Keuangan (OJK), Indonesia | S8 |
| other registrations | TD PSE 001528.01/DJAI.PSE/11/2021 from the Indonesian ministry for communication, member of ASPAKRINDO and the Asosiasi Blockchain Indonesia | S8 |
| who may register | Indonesian citizens with a KTP identity card, and foreign nationals with a passport or a KITAS residence permit, after KYC with a liveness check | S8 |
| excluded | individuals, companies and countries on the UN and OFAC sanctions lists | S8 |
| US persons | the terms name no country beyond the sanctions lists, so they do not exclude US persons by name | S8 |
| perpetuals | "futures perpetual USDT dengan lebih dari 100 pasangan", while the API listed 49 on 2026-09-22 | S6, P1 |
| CoinGecko | trust score 7, trust rank 57, Indonesia, 564 coins, 642 pairs, 206.65 BTC of 24 h volume, spot only in its derivatives list | S10 |

Nothing was traded, and no account was opened, so whether a foreign or US resident actually passes Bittime's KYC is Not verified.
The website and help centre are written for Indonesian customers, and fees are quoted in rupiah where they are fixed amounts, S3.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals, 48 of 49 contracts | Not publicly specified | 0.06 %, 600 ppm | `openTakerFeeRate` and `closeTakerFeeRate` of 0.0006 in the web contract list, P1 |
| `E-ARB-USDT` | Not publicly specified | 0.10 %, 1,000 ppm | the same list, P1 |

The web contract list carries only taker rates, one for opening and one for closing, and they are equal on every contract.
No maker rate appears anywhere public, so makerPpm is unknown.
The help centre fee article covers spot only, S3.
Whether Indonesian tax or a CFX bourse levy is added to a futures trade, as it is to spot, is Not publicly specified.

Spot, for context only, S3.

| spot market | taker | maker | tax | CFX fee | all-in taker | all-in maker |
|---|---|---|---|---|---|---|
| buy against IDR | 0.20 % | 0.10 % | 0 % | 0.02 % | 0.22 % | 0.12 % |
| sell against IDR | 0.20 % | 0.10 % | 0.21 % | 0.02 % | 0.43 % | 0.33 % |
| buy or sell against USDT or crypto | 0.06 % | 0.03 % | 0.21 % | 0.04 % | 0.31 % | 0.28 % |

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 49 contracts, all `type` `E` and `status` 1 | `GET https://fapi.bittime.com/fapi/v1/contracts`, P1 |
| coin-margined perpetuals | no | `GET https://fapi.bittime.com/dapi/v1/contracts` answered `[]` with HTTP 200, P5 |
| dated futures | no | no other `type` in the contract list, and the web list shows `contractShowType` `Perpetual` on 49 of 49, P1 |
| options | no | nothing in the API docs, S1, or the web page |
| spot | yes, 806 symbols: 572 trading and 135 halted against IDR, 82 trading and 14 halted against USDT, and one each against `vusd`, `oidr` and `vidr` | `GET https://openapi.bittime.com/api/v1/exchangeInfo`, P1 |
| margin coin `VUSD` | listed beside USDT in the web list's `marginCoinList` | trial funds, S9 and the "Dana Uji Coba" articles of the Futures help section |

## 4. Perpetual tiers

None is published.
The VIP programme's table is an image of spot IDR tiers only, from Regular at 0.20 % taker and 0.10 % maker to VIP9 at 0.075 % taker and 0.032 % maker, qualified on monthly spot volume in rupiah, S4.
It says nothing about futures.

## 5. Discounts that change the perpetual taker

| item | effect on the perpetual taker | source |
|---|---|---|
| VIP programme | spot only as published, reviewed every 30 days | S4 |
| position experience coupons, "Kupon Pengalaman Posisi" | a trial position funded by Bittime, not a fee rate | Futures help section, S9 |
| trial funds, "Dana Uji Coba", margin coin `VUSD` | trial margin, not a fee rate | Futures help section |
| token holding, referral, market maker programme | Not publicly specified | |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | funding paid = position value × funding rate, position value = mark price × position size | S5 |
| direction | a positive rate means longs pay shorts, and Bittime keeps no share | S5 |
| interval, documented | every 8 h at 00:00, 08:00 and 16:00 UTC | S5 |
| interval, on the wire | 35 contracts on 8 h and 14 on 4 h | `capitalFrequency` in the web list, P1, and `remainingSecond` of `/fapi/v1/index`, P2 |
| next settlement, on the wire | 08:00 UTC for the 35 contracts on 8 h, 04:00 UTC for 13 of the 14 on 4 h, and 05:00 UTC for `E-XAUT-USDT`, read at 03:22 and 03:38 UTC | P2 |
| cap and floor | Not publicly specified | |
| rates seen | from -0.00001513 on `E-XAUT-USDT` to 0.00023094 across the 49 contracts at 03:22 UTC, and from -0.00000681 to 0.00022452 at 03:38 UTC | P2 |
| rate published | `currentFundRate` equalled `nextFundRate` on 49 of 49 contracts in both rounds, and both moved about every 5 s | P2 |

The 4 h contracts are `E-TAO-USDT`, `E-PUMP-USDT`, `E-ASTER-USDT`, `E-HYPE-USDT`, `E-XPL-USDT`, `E-ONDO-USDT`, `E-ENA-USDT`, `E-RENDER-USDT`, `E-KAS-USDT`, `E-POL-USDT`, `E-WLFI-USDT`, `E-PENGU-USDT`, `E-XAUT-USDT` and `E-ZRX-USDT`, P1.
So the article's 8 h schedule is out of date for 14 contracts.
No public funding history call was found, and the settlement instant itself was not captured.
What rate is charged at the instant, the displayed one or a separately settled one, is Not verified.
[`rest.md`](./rest.md) section 4 has the rate's behaviour over a minute.

## 7. Liquidation, settlement and delisting

Liquidation is triggered on the mark price, S7, and in cross margin when the maintenance margin ratio reaches 100 %, S9.
A liquidation fee, an insurance fund charge and delisting terms are Not publicly specified.
Every contract allows 25× leverage at most, `maxLever` 25 on 49 of 49, P1.

## 8. CCXT

| check | result |
|---|---|
| `ccxt.exchanges` in `server/`, CCXT 4.5.68 | no `bittime`, P1 |
| CCXT master, `ts/src` on GitHub at commit `1d8b674` of 2026-09-22 12:48 UTC | no `bittime.ts`, the raw file answers 404, and the directory lists only `bitteam.ts` and `bittrade.ts` near the name |
| CCXT issues and pull requests mentioning Bittime | none found by `gh search` on 2026-09-22 |

Bittime's futures REST API has the same paths and fields as Bitrue's, which CCXT supports as `bitrue`, see [`rest.md`](./rest.md) section 2.
The probe pointed a CCXT 4.5.68 `bitrue` instance at `fapi.bittime.com` and `openapi.bittime.com` to see what a catalog would read, P1.
It loaded all 49 swaps with `market.taker` 0.00098, which is the spot constant at `server/node_modules/ccxt/js/src/bitrue.js` line 303, not the futures constant of 0.0004 at line 311.
It also marked all 49 inactive, see [`rest.md`](./rest.md) section 2.
So no CCXT number describes Bittime's perpetual taker.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 600 | the taker the web contract list carries for 48 of 49 contracts, the only published perpetual taker |
| `ccxtTakerPpm` | none | there is no CCXT class, and a repointed `bitrue` class would report 980 ppm from its spot constant |

`E-ARB-USDT` charges 1,000 ppm, so a registry holding one taker per venue understates it by 400 ppm.
The 600 ppm figure is read from an undocumented call, so it should be rechecked before use.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bittime USDⓈ-M Futures API docs | https://www.bittime.com/api_docs_includes_file/futures/index.html, linked from https://www.bittime.com/api-docs | 2026-09-22 | Bittime | futures endpoints, no fee or funding call, sections 3 and 8 |
| S2 | Public Rest API for Bittime (2022-12-30), spot | https://bittime-docs.github.io/ | 2026-09-22 | Bittime | spot API, section 3 |
| S3 | Informasi Biaya transaksi di Bittime, updated 2026-07-25 | https://support.bittime.com/hc/id/articles/5913382228367 | 2026-09-22 | Indonesia | spot fees, tax and CFX fee, section 2 |
| S4 | Unlock Exclusive Benefits with Bittime VIP Membership Program, updated 2026-05-12 | https://support.bittime.com/hc/id/articles/15296671056655 | 2026-09-22 | Indonesia | spot VIP tiers, sections 4 and 5 |
| S5 | Memahami Funding Rate, 2026-08-10 | https://support.bittime.com/hc/id/articles/17168808963215 | 2026-09-22 | Indonesia | funding formula, direction and schedule, section 6 |
| S6 | Panduan Pemula untuk USDT Futures, updated 2026-07-22 | https://support.bittime.com/hc/id/articles/13510213176079 | 2026-09-22 | Indonesia | USDT perpetuals offered, section 1 |
| S7 | Mark Price vs Last Price, 2026-08-28 | https://support.bittime.com/hc/id/articles/17403367663887 | 2026-09-22 | Indonesia | liquidation on mark, section 7 |
| S8 | Syarat & Ketentuan, updated 2026-07-29 | https://support.bittime.com/hc/id/articles/5786767795343 | 2026-09-22 | Indonesia | operator, licence, KYC, sanctions, section 1 |
| S9 | Pengenalan ke Akun Trading Futures Terpadu Bittime, updated 2026-05-27, and the Futures help section | https://support.bittime.com/hc/id/articles/13515769428751 and https://support.bittime.com/hc/id/sections/13506985780623 | 2026-09-22 | Indonesia | cross margin liquidation, trial funds, sections 3, 5 and 7 |
| S10 | CoinGecko exchange record and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/bittime and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | volume and listing context, section 1 |
| S11 | CCXT master `ts/src` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Bittime class, section 8 |
| S12 | CCXT 4.5.68 `bitrue.js` | `server/node_modules/ccxt/js/src/bitrue.js` | 2026-09-22 | CCXT | fee constants at lines 303 and 311, section 8 |
| P1 | `rest-probe.mjs catalog`, 03:18 and 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bittime/rest-probe.mjs) | 2026-09-22 | this host | contract lists, web taker rates, funding intervals, spot count, CCXT, sections 1 to 9 |
| P2 | `rest-probe.mjs anchor`, 03:22 and 03:38 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bittime/rest-probe.mjs) | 2026-09-22 | this host | next settlement, rate range and cadence, section 6 |
| P5 | one `curl` of `https://fapi.bittime.com/dapi/v1/contracts` at 03:43 UTC | | 2026-09-22 | this host | no coin-margined family, section 3 |
