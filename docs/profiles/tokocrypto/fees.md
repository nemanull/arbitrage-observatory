# TokoCrypto Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 03:15 to 03:39 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the spot market of TokoCrypto (CCXT id `tokocrypto`), because the venue lists no perpetuals, see section 3.
The survey plan's template change 1 applies: spot VIP 0 fees and the spot tiers stand where perpetual fees would.
Every number carries a source from the ledger in section 10, a probe run, or a CCXT file and line.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| legal entity | PT Aset Digital Berkat, trading as Tokocrypto, founded 2017 | S4 |
| platform | "Tokocrypto 2.0 Powered by Binance Cloud", launched May 2020 after a Binance investment | S6 |
| execution venue | the agreement names third party liquidity providers, among them the ADGM recognised bodies Nest Exchange Limited ("Binance RIE") and Nest Clearing and Custody Limited ("Binance RCH") | S4 |
| governing law | Republic of Indonesia | S4 |
| individuals | aged 17 or over, with a KTP for Indonesian citizens, or a passport of the home country and/or a KITAP or KITAS residence permit for foreign citizens | S4 |
| companies | must hold an Indonesian business licence and be domiciled in Indonesia | S4 |
| excluded parties | anyone under sanctions of Indonesia, the United States (OFAC), the European Union, the United Kingdom or another sanctions authority | S4 |
| US persons | the agreement names no excluded country list beyond sanctions, and registration asks for bank account details and a KTP, KITAP, KITAS or other identity number | S4 |
| retrieval | fee help article updated 2026-06-18, agreement updated 2026-03-02, fee schedule data read on the wire 2026-09-23 03:17 UTC | S2, S3, S4 |

Whether a US resident without an Indonesian residence permit can pass the KYC is Not verified, since no account was opened.
The web app has a foreigner branch in its KYC flow (`/usercenter/identity-verification/kyclevel1/step2/foreigner` in its route table, S5), which is consistent with the passport clause.

Every public page and endpoint used here answered this host with HTTP 200, apart from the paths listed in [`rest.md`](./rest.md) section 6.
No geoblock or refusal was seen.

## 2. Quick answer

The researched product is spot, since there are no perpetuals.
The fee has three parts on every fill: the Tokocrypto commission, the Indonesian final income tax (PPh Final) and the ICEx bourse fee, S3.

| pair family | side | commission | tax | ICEx fee | all-in | all-in ppm |
|---|---|---|---|---|---|---|
| quoted in USDT or another crypto | taker | 0.15 % | 0.21 % PPh Final | 0.0444 % | 0.4044 % | 4,044 |
| quoted in USDT or another crypto | maker | 0.15 % | 0.21 % PPh Final | 0.0444 % | 0.4044 % | 4,044 |
| quoted in IDR, buy | taker | 0.20 % | 0 % PPN | 0.0222 % | 0.2222 % | 2,222 |
| quoted in IDR, buy | maker | 0.10 % | 0 % PPN | 0.0222 % | 0.1222 % | 1,222 |
| quoted in IDR, sell | taker | 0.20 % | 0.21 % PPh Final | 0.0222 % | 0.4322 % | 4,322 |
| quoted in IDR, sell | maker | 0.10 % | 0.21 % PPh Final | 0.0222 % | 0.3322 % | 3,322 |

The commission alone at VIP 0 on a crypto quoted pair is 1,500 ppm for taker and maker.
The fee schedule endpoint agrees: its VIP 0 row reads `takerCommission` `"0.001500"` and `takerTax` `"0.004044"`, and every row's `takerTax` equals its commission plus 0.002544, which is 0.21 % plus 0.0444 %, see section 4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot | yes, 850 pairs, all with `spotTradingEnable` 1 | `GET /open/v1/common/symbols` in P1 and P2, see [`rest.md`](./rest.md) section 2 |
| margin | Not verified | 715 catalog rows carry `marginTradingEnable` 1 and `permissions` `["SPOT","MARGIN"]`, and CCXT sets `has.margin` true at `server/node_modules/ccxt/js/src/tokocrypto.js` line 31, but the web app's route table has no margin page and the fee article names no margin fee |
| USDT-M, USDC-M or coin-M perpetuals | absent | CCXT `has.swap` false at line 32 and every market `swap: false` at line 815, `/fapi/v1/premiumIndex` answers 404 on both hosts, `https://www.tokocrypto.com/futures/BTCUSDT` returns a 666 byte "Welcome to nginx!" page, and the web app's route table has no futures route, P1 |
| dated futures | absent | CCXT `has.future` false at line 33, same probes |
| options | absent | CCXT `has.option` false at line 34 |

The web bundle still carries strings such as "This setting only applies to Perpetual Futures." and an empty `futures` store, which belong to the shared Binance Cloud interface and lead to no product.
CoinGecko's derivatives list on 2026-09-22 does not show TokoCrypto either.

## 4. Spot tiers

From `GET https://www.tokocrypto.com/v1/common/vip-rules`, the call the fee schedule page S2 renders its table from, read in P1 and P2 and by hand at 03:17 UTC.
The page labels the columns "30 hari Volume Dagang (IDR) Dan/ATAU Saldo TKO", that is 30 day volume in IDR and/or TKO balance.
The "all-in" columns are the page's "Biaya Taker TKO termasuk Pajak dan Biaya Bursa", the fee including tax and bourse fee.

| level | 30 day volume, IDR | TKO balance | taker | maker | taker all-in | maker all-in | taker paid in TKO |
|---|---:|---:|---:|---:|---:|---:|---:|
| VIP 0 | 1,500,000,000 | 10,000 | 0.1500 % | 0.1500 % | 0.4044 % | 0.4044 % | 0.1125 % |
| VIP 1 | 1,500,000,000 | 10,000 | 0.1444 % | 0.1419 % | 0.3988 % | 0.3963 % | 0.1083 % |
| VIP 2 | 3,750,000,000 | 50,000 | 0.1444 % | 0.1394 % | 0.3988 % | 0.3938 % | 0.1083 % |
| VIP 3 | 7,500,000,000 | 100,000 | 0.1444 % | 0.1344 % | 0.3988 % | 0.3888 % | 0.1083 % |
| VIP 4 | 15,000,000,000 | 200,000 | 0.1344 % | 0.1244 % | 0.3888 % | 0.3788 % | 0.1008 % |
| VIP 5 | 37,500,000,000 | 400,000 | 0.1244 % | 0.1144 % | 0.3788 % | 0.3688 % | 0.0933 % |
| VIP 6 | 75,000,000,000 | 600,000 | 0.1044 % | 0.0944 % | 0.3588 % | 0.3488 % | 0.0783 % |
| VIP 7 | 150,000,000,000 | 1,000,000 | 0.1024 % | 0.0904 % | 0.3568 % | 0.3448 % | 0.0768 % |
| VIP 8 | 375,000,000,000 | 1,500,000 | 0.0984 % | 0.0864 % | 0.3528 % | 0.3408 % | 0.0738 % |
| VIP 9 | 750,000,000,000 | 2,000,000 | 0.0924 % | 0.0804 % | 0.3468 % | 0.3348 % | 0.0693 % |

The VIP 0 row carries the same thresholds as VIP 1 on the wire, so it reads as the level below them, which is an inference.
The `legalMoney` parameter the page sends (0, and 1 to 3 tried by hand) did not change the reply, so the endpoint serves the crypto quoted schedule only.
The IDR commission of 0.20 % taker and 0.10 % maker comes from the help article S3, and no IDR tier table was found.

### Qualification

The English strings of the fee page bundle say "Everyday at 00:00 AM (UTC), your trading volume over the past 30-day period and TKO balance will be evaluated.", S2.
The same strings continue "Your Tier level and corresponding maker/taker fees are updated at 01:00AM (UTC).", S2.

## 5. Discounts that change the spot taker

| discount | effect | source |
|---|---|---|
| paying fees in TKO | the commission is multiplied by 0.75: `specificAsset` `"TKO"` and `specificAssetPayFeeDiscount` `0.75` in the system config, and the VIP 0 `takerSpecificAssetPayFeeDiscount` is `"0.001125"`, which is 0.0015 times 0.75 | S5, P1 |
| TKO balance | a TKO balance alone can qualify a tier, section 4 | S2 |
| referral, market maker, zero fee promotion | none found on the fee page or in the fee article | S2, S3 |

Whether the TKO discount also reduces the tax or the ICEx fee is Not publicly specified.
CCXT's comment "zero fees for all trading pairs before November 1" at `server/node_modules/ccxt/js/src/tokocrypto.js` line 235 describes a past promotion, and the venue shows no such offer now.

## 6. Funding as a cost

Not applicable.
TokoCrypto lists no perpetual, so there is no funding rate, interval, cap or settlement.
The venue publishes no index or mark either, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

No liquidation or settlement fee applies to spot.
Withdrawal costs Rp10,000, and a deposit through QRIS or an e-wallet (GoPay, OVO, ShopeePay, LinkAja) costs 2 %, S3.
Staking income is taxed at 5 % PPh and DCA purchases at 0 %, S3.
No delisting charge is published.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `tokocrypto`, no CCXT Pro class | `server/node_modules/ccxt/js/src/tokocrypto.js` line 25 `'pro': false`, and no `tokocrypto` file under `server/node_modules/ccxt/js/src/pro/` |
| `fees.trading.taker` | `0.0075`, 7,500 ppm | line 235 |
| `fees.trading.maker` | `0.0075`, 7,500 ppm | line 236 |
| `market.taker` without credentials | `0.0075` on all 850 markets, `BTC/USDT` and `BTC/IDR` included | P1 and P2, `loadMarkets` on CCXT 4.5.68 |
| swap markets | 0 of 850 | P1 and P2 |

CCXT's 7,500 ppm is five times the real commission and almost twice the all-in 4,044 ppm.

## 9. Recommended registry values

The connector keeps only active swaps at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 195 to 201, and TokoCrypto has none, so the venue cannot be registered as a perpetual leg.
If a spot leg is ever modelled, these are the values.

| field | value | reason |
|---|---|---|
| `takerPpm` | 4,044 | the VIP 0 commission of 1,500 ppm plus 2,100 ppm PPh Final and 444 ppm ICEx fee, all charged on every crypto quoted fill, S3 and the `takerTax` field in section 4 |
| `ccxtTakerPpm` | 7,500 | what CCXT 4.5.68 reports, `server/node_modules/ccxt/js/src/tokocrypto.js` line 235 |

A spot leg on a pair quoted in USDT, USDC, USD1, U, BTC, ETH, BNB or SOL is a read of Binance's own spot book, see [`websocket.md`](./websocket.md) section 4, so it adds no independent price to the engine.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tokocrypto API documentation | https://www.tokocrypto.com/apidocs/ | 2026-09-22 | PT Aset Digital Berkat, Indonesia | endpoints and symbol types, sections 3 and 8 |
| S2 | Tokocrypto fee schedule page and its data call | https://www.tokocrypto.com/fees/newschedule and https://www.tokocrypto.com/v1/common/vip-rules | 2026-09-22 | Indonesia | tier table, column labels, qualification, sections 4 and 5 |
| S3 | Informasi Biaya Transaksi di Tokocrypto, updated 2026-06-18, read through the Zendesk help center API | https://support.tokocrypto.com/hc/id/articles/360004044591-Informasi-Biaya-Transaksi-di-Tokocrypto | 2026-09-22 | Indonesia | commission, PPh Final, ICEx fee, IDR fees, deposit and withdrawal charges, sections 2, 5 and 7 |
| S4 | Perjanjian Pelanggan Tokocrypto, updated 2026-03-02, read through the Zendesk help center API | https://support.tokocrypto.com/hc/id/articles/360004044971-Perjanjian-Pengguna-Tokocrypto | 2026-09-22 | Indonesia | entity, eligibility, sanctions, Binance RIE liquidity, section 1 |
| S5 | Tokocrypto system config and web bundle | https://www.tokocrypto.com/v1/common/system-config | 2026-09-22 | Indonesia | TKO discount factor, route table, sections 1, 3 and 5 |
| S6 | About Tokocrypto | https://about.tokocrypto.com | 2026-09-22 | Indonesia | Binance Cloud platform, section 1 |
| S7 | CCXT 4.5.68 `tokocrypto.js` | `server/node_modules/ccxt/js/src/tokocrypto.js` | 2026-09-22 | CCXT | flags, fees, market shape, sections 3 and 8 |
| S8 | CoinGecko exchange record `toko_crypto` | https://api.coingecko.com/api/v3/exchanges/toko_crypto | 2026-09-22 | CoinGecko | trust score 6, trust score rank 87, 24 h volume 144.3 BTC, context only |
| P1 | `rest-probe.mjs main` and `poll`, 03:23 to 03:25 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/tokocrypto/rest-probe.mjs) | 2026-09-22 | this host | catalog, CCXT, vip-rules, system config, sections 3 to 8 |
| P2 | `rest-probe.mjs main` and `poll`, second pass, 03:33 to 03:35 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/tokocrypto/rest-probe.mjs) | 2026-09-22 | this host | the same readings, repeated |
