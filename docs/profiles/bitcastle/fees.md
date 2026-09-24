# bitcastle Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:22 to 04:50 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the USDT-margined perpetuals of bitcastle, which CCXT does not list and CoinGecko's derivatives list does not show.
The venue does list perpetuals, 119 of them, so the survey researches them and names spot only in the coverage matrix.
Every number below carries a source from section 10, a probe run of [`rest-probe.mjs`](../../../scripts/probes/venues/bitcastle/rest-probe.mjs) or [`ws-probe.mjs`](../../../scripts/probes/venues/bitcastle/ws-probe.mjs), or a file and line.
The fee is not what decides this venue.
Each perpetual names a source venue in its catalog row, 109 Bybit, 7 MEXC and 3 Binance, and the published book is a thinned copy of that source's book, see [`websocket.md`](./websocket.md) section 4 and [`rest.md`](./rest.md) section 5.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | bitcastle LLC, registered in St Vincent and the Grenadines under number 900 LLC 2021, First Floor, First St. Vincent Bank Ltd Building, James Street, Kingstown | S11 |
| other address named | 10F Block A, Song Da Building, Pham Hung Street, Hanoi, Vietnam, in the MT5 company block of the web app | S3 |
| CoinGecko country | Lithuania, established 2019, trust score 4, trust rank 126 on 2026-09-23 | S13, `rest-probe.mjs main` |
| excluded regions | "Currently, bitcastle does not offer any service or product for Users (including residents and citizens, or through agency or representation) in certain jurisdictions (including, but not limited to): United States, Canada, UK, Australia, France, Japan, Singapore, Vietnam, People's Republic of China." | S11 |
| further exclusion | citizens or residents of countries blacklisted by FATF | S11 |
| US persons | may not trade, and the identity form asks the user to promise "your residence is not in the United States" | S11, S3 |
| who may trade the perpetuals | a registered user who has reached identity verification Level 4 and accepted the futures terms in a pop-up | S9 |
| futures terms | the user warrants "you do not reside in the prohibited countries and territories as per set out in Terms of Use" | S8 |
| access from this host | every public REST call and the MQTT socket answered, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 | probes |

The tunnel exit geolocates to Canada, which the terms exclude, and no public endpoint refused it.
That is a fact about the public endpoints and not a statement that a Canadian may trade.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | pairs | source |
|---|---|---|---|---|
| USDT-M perpetuals | 0.02 %, 200 ppm | 0.06 %, 600 ppm | 114 of 119 | S4, S3, `rest-probe.mjs main` |
| USDT-M perpetuals, five exceptions | 0.02 %, 200 ppm | 0.02 %, 200 ppm | `io/usdt`, `melania/usdt`, `eigen/usdt`, `turbo/usdt`, `ach/usdt` | `rest-probe.mjs main` |

The help center article S4 states "Maker Fee: 0.02%" and "Taker Fee: 0.06%".
The catalog call splits each fee into parts, and the web app adds them the same way in its `tradingFee` and `feeRateSum` getters, S3.

| field of `GET /futures/v1/settings/pair` | value on 114 pairs | value on the five exceptions |
|---|---|---|
| `order_maker_fee_rate` | `"0.00015"` | `"0.00015"` |
| `order_taker_fee_rate` | `"0.00055"` | `"0.00015"` |
| `insurance_fee_rate` | `"0.00005"` | `"0.00005"` |
| `margin_fee_rate` | `"0"` | `"0"` |
| `position_maker_fee_rate`, equal to maker plus insurance | `"0.0002"` | `"0.0002"` |
| `position_taker_fee_rate`, equal to taker plus insurance | `"0.0006"` | `"0.0002"` |

So the taker a trade pays is `order_taker_fee_rate + margin_fee_rate + insurance_fee_rate`, which is 0.0006 on 114 pairs.
`GET /futures/v1/settings/trading-fees` returns the same fee fields for the same 119 pairs, and they equalled the catalog on every row.
Both calls answer without a key, and neither is in the public API reference S1, which documents only spot calls.

## 3. Coverage matrix

| product | present | detail |
|---|---|---|
| USDT-M perpetuals | yes | 119 pairs, all quoted and settled in USDT, the page title reads "BTCUSDT Perpetual", S7, S12 |
| USDC-M perpetuals | no | the catalog has no other `currency` than `usdt` |
| coin-margined perpetuals | no | same |
| dated futures | no | none in the catalog or the web app routes |
| options | no | the "High & Low" product is a binary option with expiries as short as 5 s, not a listed option book, S13 |
| spot | yes | 144 pairs in the CoinGecko pairs call and 248 rows in the spot ticker, `rest-probe.mjs main`. `GET /setting/v2/global-setting` gives `buy_fee` and `sell_fee` `"0.0002"` on `btc/usdt` and on 155 of 194 USDT pair settings, and 0, 0.001, 0.002 or 0.01 on the others |
| FX and CFD | yes | bitcastleFX "which provides Forex and CFD trading" through MetaTrader 5, out of scope, S3 |

## 4. Perpetual tiers

No tier table is published.
The fees page S10 shows one "Standard" maker and taker column and one "BCE Discount Fee" column per pair, filled from the calls in section 2.
A search of the help center for "VIP" returned 0 articles, S14.

## 5. Discounts that change the perpetual taker

| discount | state on 2026-09-23 | source |
|---|---|---|
| BCE fee deduction | `deduction_fee_rate` `"0"` on all 119 pairs, and `use_deduction_fee` true only on `spcx/usdt`. The web app multiplies the fee by one minus that rate, so no pair gets a discount today | S3, `rest-probe.mjs main` |
| CASTLE token | CoinGecko's description says holding CASTLE reduces fees "by up to 60%", which the catalog does not reflect | S13 |
| referral and affiliate | "commissions of up to 70% from both Spot and Futures trading" paid to the partner, and no change to the payer's rate is stated | S15 |
| futures bonus | a non-withdrawable credit "used for margin, loss compensation, and fee deductions", so it can pay a fee without changing the rate | S16 |
| market maker program | none published | |
| zero fee promotion | none on a perpetual. The five pairs at 200 ppm taker carry no end date | `rest-probe.mjs main` |

## 6. Funding as a cost

The documentation and the wire disagree.

| item | documented | on the wire |
|---|---|---|
| rate | "Currently, bitcastle operates with a 0% funding fee." S7. Collateral interest is 0 % in both margin modes, S6 | `funding_rate` is `"0"` on all 119 catalog rows, and yet `GET /futures/v1/funding-rate/history` shows nonzero rates at every settlement |
| formula | "Funding rates calculation consists of the interest rate and the premium." S17 | not published, see [`rest.md`](./rest.md) section 4 |
| interval | not stated | `funding_interval` `"8"` hours on all 119 pairs and on every history row |
| settlement instants | not stated | 00:00, 08:00 and 16:00 UTC for 54 pairs, and 01:00, 09:00 and 17:00 UTC for 65 pairs, from `funding_start_time` and the history's `calculation_time` |
| cap and floor | not published | the latest settlement page had 88 of 119 pairs at `0.01`, 29 at `0.0001`, one at `-0.00001` and one at `-0.01`, so 0.01 looks like a bound, which is an inference |
| who pays | "When Futures Price ＞ Spot Price: Traders holding long positions pay funding fees", and the reverse, S5 | history rows carry `long_amount` and `short_amount`, nonzero on 9 of the 119 latest rows |
| unit | | a fraction per interval, since the web app shows `funding_rate` times 100 with a percent sign, S3 |

`btc/usdt` settled at `0.0001` on each of its last 50 settlements, from 2026-09-06 16:00 to 2026-09-23 00:00 UTC, while Bybit's BTCUSDT rate read `0.00003714` and `0.00004901` in the two probe runs.
So bitcastle's rate is not Bybit's rate.
Whether a history row was actually debited from a position cannot be seen without an account.
The settlement instant itself was not captured, and the table comes from the history call and the documentation.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| insurance charge | `insurance_fee_rate` 0.00005 on every trade, already inside the 600 ppm taker | S3, `rest-probe.mjs main` |
| liquidation fee | none stated in the Forced Liquidation article | S18 |
| maintenance margin | `maintenance_margin_rate` `"0.05"` on all 119 pairs | `rest-probe.mjs main` |
| maximum leverage | 25 on 5 pairs, 50 on 68, 75 on 31, 100 on 12, 150 on 3 | `rest-probe.mjs main` |
| settlement | none, the contracts are perpetual | S7 |
| delisting | bitcastle "may delist any trading pairs from the Platform either temporarily or on a permanent basis without giving any explanation or prior notice" | S8, clause 1.4 |
| dormant account | a futures account idle for 30 calendar days may be closed | S8, clause 12.2 |
| deposit and withdrawal | see https://bitcastle.io/en/fees | S10 |

## 8. CCXT

CCXT 4.5.68 has no bitcastle class.
`require('ccxt').exchanges` from `server/` lists 104 ids and none matches `castle`, in `rest-probe.mjs main`.
The CCXT master branch on GitHub had no bitcastle file either, read on 2026-09-23 when the newest commit was `1d8b674` of 2026-09-22.
Its `ts/src` listing held 112 entries without one, and its `exchanges.json` and `README.md` do not mention the venue, S19.
So `market.taker` has no value to report, and `ccxtTakerPpm` is null.

## 9. Recommended registry values

None.
The venue should not be added to [`registry.ts`](../../../server/src/venues/registry.ts), because the connector loads every catalog through a CCXT class at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 68, and the book it would read is a copy of another venue's book.
If a later design adds it anyway, `takerPpm` is 600, the sum of `order_taker_fee_rate`, `margin_fee_rate` and `insurance_fee_rate`, and there is no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | bitcastle API docs 1.0.0, Redoc page with an OpenAPI 3.0.0 spec | https://developer.bitcastle.io/document | 2026-09-22 | bitcastle | spot calls only, API key limit, sections 2 and 8 |
| S2 | web app runtime config | https://bitcastle.io/config.json | 2026-09-22 | bitcastle | API and socket hosts, topic names |
| S3 | web app bundle `app.d64a015.js`, 7.87 MB | https://bitcastle.io/_nuxt/app.d64a015.js | 2026-09-22 | bitcastle | `tradingFee`, `bceTradingFee` and `feeRateSum` getters, funding shown as rate times 100, the MT5 company block, the Level 4 residence promise |
| S4 | Futures Trading Fees, updated 2026-01-29 | https://support.bitcastle.io/hc/en-us/articles/30079747305369-Futures-Trading-Fees | 2026-09-22 | bitcastle | maker 0.02 %, taker 0.06 % |
| S5 | bitcastle Futures Trading: About Funding Fees, updated 2026-02-14 | https://support.bitcastle.io/hc/en-us/articles/22875545062809-bitcastle-Futures-Trading-About-Funding-Fees | 2026-09-22 | bitcastle | who pays |
| S6 | Interest Rate and Funding Fee Specifications, updated 2026-02-16 | https://support.bitcastle.io/hc/en-us/articles/29241400468377-bitcastle-Futures-Trading-Interest-Rate-and-Funding-Fee-Specifications-Cross-Isolated-Margin | 2026-09-22 | bitcastle | 0 % collateral interest |
| S7 | USDT-M Futures Contract Specifications, updated 2026-02-16 | https://support.bitcastle.io/hc/en-us/articles/20504150629785-USDT-M-Futures-Contract-Specifications | 2026-09-22 | bitcastle | perpetual, USDT settled, "0% funding fee" |
| S8 | bitcastle Futures Terms and Conditions, updated 2026-02-11 | https://support.bitcastle.io/hc/en-us/articles/21402117325977-bitcastle-Futures-Terms-and-Conditions | 2026-09-22 | bitcastle | residence warranty, delisting, dormancy |
| S9 | Unable to Use Futures Trading on bitcastle, updated 2026-01-26 | https://support.bitcastle.io/hc/en-us/articles/20502858841753-Unable-to-Use-Futures-Trading-on-bitcastle | 2026-09-22 | bitcastle | Level 4 verification |
| S10 | Fees page | https://bitcastle.io/en/fees | 2026-09-22 | bitcastle | Standard and BCE Discount columns, deposit and withdrawal lookup |
| S11 | Terms of Use, rendered from S3 | https://bitcastle.io/en/terms | 2026-09-22 | bitcastle LLC, St Vincent and the Grenadines | operator, excluded jurisdictions, FATF clause |
| S12 | futures trading page | https://bitcastle.io/en/futures/BTC_USDT | 2026-09-22 | bitcastle | "BTCUSDT Perpetual" title |
| S13 | CoinGecko exchange record and derivatives exchange list, read at 04:28 UTC, while the 04:43 UTC rerun got 429 from both | https://api.coingecko.com/api/v3/exchanges/bitcastle | 2026-09-23 | CoinGecko | country, trust rank, CASTLE description, High & Low, absence from the 214 derivatives exchanges |
| S14 | help center search for "VIP" | https://support.bitcastle.io/api/v2/help_center/articles/search.json?query=VIP&locale=en-us | 2026-09-22 | bitcastle | no tier article |
| S15 | bitcastle Affiliate Program Terms and Conditions, updated 2026-01-27 | https://support.bitcastle.io/hc/en-us/articles/27423023468185 | 2026-09-22 | bitcastle | commissions of up to 70 % |
| S16 | What is the Futures Bonus, updated 2025-12-04 | https://support.bitcastle.io/hc/en-us/articles/25036781168921 | 2026-09-22 | bitcastle | bonus pays margin, losses and fees |
| S17 | Definition of Futures technical terms, updated 2026-02-17 | https://support.bitcastle.io/hc/en-us/articles/20503714500121-Definition-of-Futures-technical-terms | 2026-09-22 | bitcastle | funding is interest rate and premium |
| S18 | bitcastle Futures Trading: Forced Liquidation | https://support.bitcastle.io/hc/en-us/articles/53399151176089-bitcastle-Futures-Trading-Forced-Liquidation | 2026-09-22 | bitcastle | no liquidation fee stated |
| S19 | CCXT master, `ts/src` listing and `exchanges.json` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 | CCXT | no bitcastle class |
| P1 | `rest-probe.mjs main` and `poll`, at 04:28 and 04:29 UTC and again at 04:43 and 04:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitcastle/rest-probe.mjs) | 2026-09-22 | this host | catalog fees, funding history, spot fee settings, CCXT, CoinGecko |
