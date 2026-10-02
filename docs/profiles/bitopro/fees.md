# BitoPro Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:14 and 03:45 UTC on 2026-09-23.

This profile covers the trading fees of BitoPro (CCXT id `bitopro`), a Taiwan exchange.
BitoPro lists no perpetual, dated future or option, see section 3, so this is its spot market, as the survey plan's template change 1 asks.
Every probed number comes from [`rest-probe.mjs`](../../../scripts/probes/venues/bitopro/rest-probe.mjs), run from `server/`, in the `main` runs at 03:16, 03:29, 03:32 and 03:44 UTC and the `pages` runs at 03:30 and 03:32 UTC.
Where the documentation and the wire disagree, both are written.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row, which was 2026-09-23 in UTC | | source ledger |
| CoinGecko listing | "BitoPro", country Taiwan, established 2018, trust score 7, trust score rank 64, 325.5 and 325.1 BTC of 24 h volume in two reads | Probed | S7, `rest-probe.mjs pages`, tag `coingecko_exchange` |
| CoinGecko derivatives list | no venue whose id or name contains "bito" among the 113 derivatives venues returned | Probed | S7, `rest-probe.mjs pages` at 03:32 UTC, tag `coingecko_derivatives`. The first read at 03:30 UTC was throttled with the plain text reply `Throttled` |
| legal entity | "BitoPro Technology Co., Ltd. Tax ID Number: 90577481", named on the fee page as the company that issues fee invoices | Published | S1, tag `fee_page`, `termList4` |
| registration | the Securities and Futures Bureau of Taiwan's FSC lists "BitoPro Technology Co., Ltd. (Unified Business Number: 90577481)" among the enterprises that completed anti-money-laundering registration under the VASP Registration Regulations, on a page updated 2025-12-18 | Published | S6 |
| governing law | the Terms of Use, "Version Date: March 30, 2026", are governed by the laws of the Republic of China (Taiwan) with the Taipei District Court as the court of first instance, Chapter 10 | Published | S2, tag `terms_page` |
| who may trade | an individual or entity with full legal capacity who completes identity verification, Terms of Use Chapter 1. Whether a person who is not resident in Taiwan can complete verification is Not publicly specified in the pages read | Published | S2 |
| excluded regions | "Currently, BitoPro does not accept registrations from individuals with citizenship from China, Hong Kong, Macau, and the United States, as well as login activities from the countries listed on the black list of the Financial Action Task Force (FATF).", Chapter 1, Section 1, Article 5 | Published | S2, tag `terms_page`, `chapter1Section1Article5` |
| whether US persons may trade | No. A US citizen may not register | Published | S2 |
| fee page from this host | `https://www.bitopro.com/ns/en-US/fees` answered 200. `https://www.bitopro.com/fees`, the URL CCXT names at `server/node_modules/ccxt/js/src/bitopro.js` line 158, answered 404 | Probed | `rest-probe.mjs pages`, tag `fee_page`, and `curl` on 2026-09-22 |
| public API from this host | every public REST and WebSocket call answered, with no challenge and no refusal | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

Reading public market data is not an account service, and BitoPro did not refuse it.
Trading is another matter: a US citizen may not register at all, wherever they connect from.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, all 35 pairs | 0.1 % = 1,000 ppm | 0.2 % = 2,000 ppm | Probed from the public fee table | S3, `rest-probe.mjs main`, tag `fee_tier` rank 0 |
| spot, fee paid in BITO | 0.08 % = 800 ppm | 0.16 % = 1,600 ppm | Probed | S3, rank 0 `makerBitoFee` and `takerBitoFee` |
| perpetuals | Not offered | Not offered | | section 3 |

The engine models a taker cross, so 2,000 ppm is the number that matters.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot | yes, 35 pairs: 15 quoted in USDT, 19 in TWD, 1 in BTC, none under maintenance | `rest-probe.mjs main`, tag `catalog`, and [`rest.md`](./rest.md) section 2 |
| margin, called "Credit" | yes, borrowing against collateral for long and short spot trades, with the site's guide saying "Borrow, leverage up to 3x assets" | S1, its `margin` strings, and tag `fee_page` `nav`, which lists "Spot", "Credit", "Earn" and "Grid Bot" |
| perpetual swaps, every family | absent | the site navigation above, the API index S4 lists spot, account and wallet calls only, CCXT's capability flags set `'swap': false` at `server/node_modules/ccxt/js/src/bitopro.js` line 31, and CoinGecko's derivatives list does not carry the venue |
| dated futures | absent | the same sources, CCXT `'future': false` at line 32 |
| options | absent | the same sources, CCXT `'option': false` at line 33 |

## 4. Spot tiers

The live table from `GET https://api.bitopro.com/v3/provisioning/limitations-and-fees`, field `tradingFeeRate`, identical in the four `main` runs.
Each rate is a fraction of the traded amount.

| rank | 30 day volume in TWD | condition | BITO balance | maker | taker | maker with BITO | taker with BITO |
|---|---|---|---|---|---|---|---|
| 0 | < 3,000,000 | or | < 3,000 | 0.001 | 0.002 | 0.0008 | 0.0016 |
| 1 | >= 3,000,000 | or | >= 3,000 | 0.0009 | 0.0018 | 0.00072 | 0.00144 |
| 2 | >= 10,000,000 | or | >= 10,000 | 0.0007 | 0.0014 | 0.00056 | 0.00112 |
| 3 | >= 30,000,000 | or | >= 20,000 | 0.0006 | 0.0012 | 0.00048 | 0.00096 |
| 4 | >= 150,000,000 | or | >= 30,000 | 0.000125 | 0.001 | 0.0001 | 0.0008 |
| 5 | >= 300,000,000 | and | >= 40,000 | 0.000125 | 0.000875 | 0.0001 | 0.0007 |
| 6 | >= 600,000,000 | and | >= 50,000 | 0.000125 | 0.00045 | 0.0001 | 0.00036 |

Every rank also carries `gridBotMakerFee` and `gridBotTakerFee` of 0.0005, the rate for orders placed by the site's grid bot.

### Qualification

- "Your VIP Trading Fee Level will be based on your past 30-day trading volume or your BITO balance from the previous day. Whichever qualifies for higher discounted fees will be chosen as your Trading Fee Level.", S1, `termList` item 1.
- The API's `rankCondition` says `or` for ranks 0 to 4 and `and` for ranks 5 and 6, so the two top ranks need both the volume and the balance, S3.
- Volume and balance are computed daily at 00:00 UTC+8, the balance includes BITO held in open orders, and the level updates daily at 04:00 UTC+8, S1 `termList` items 2, 3 and 5.
- Volume is converted into TWD, S1 `termList` item 2.

## 5. Discounts that change the spot taker

| discount | effect | label | evidence |
|---|---|---|---|
| paying fees in BITO | 20 % off both sides, "Maker / Taker (BITO Discount 20%)". The table's BITO columns are 0.8 times the plain columns on every rank | Published and Probed | S1 `BITODiscount`, S3 |
| fee rebate coupon | an article titled 【BitoPro 手續費回饋券】教學, updated 2026-03-24, whose terms were not read | Published | S5 |
| market making program | "Please inquire about our market making program which offers volume-based fees." | Published | S1 |
| zero fee promotions | the fee page carries the labels "During the event, maker 0 fee" and "Grid Bot USDT/TWD trading fee is 0.02% during promotion period". Whether either event runs now is Not verified. The live table on 2026-09-23 shows no zero rate | Published, status Not verified | S1 tag `fee_page` `promo`, S3 |

Quick Order, Regular Purchase and Small Balance Exchange prices "all include fees", S1 `termList` item 10, and those channels are not the order book.

## 6. Funding as a cost

Not applicable, since BitoPro lists no perpetual.
Credit borrowing charges interest, whose rates and limits the fee page shows under "Interest Rates and Limits", S1.

## 7. Liquidation, settlement and delisting

- Credit positions are liquidated when the A/D ratio, "total assets / (borrowed + interest)", falls to the platform's minimum, S1 `margin` strings.
  The liquidation fee is Not publicly specified in the pages read.
- Spot has no settlement.
- Delisting charges are Not publicly specified.
- Deposit and withdrawal fees and limits are published per currency by the same `GET /v3/provisioning/limitations-and-fees` call, in its sections `restrictionsOfWithdrawalFees`, `cryptocurrencyDepositFeeAndConfirmation`, `ttCheckFeesAndLimitationsLevel1` and `ttCheckFeesAndLimitationsLevel2`, and on the fee page.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| `market.taker` without credentials | 0.002 on all 35 markets, which is 2,000 ppm | `rest-probe.mjs main`, tag `ccxt` |
| `market.maker` without credentials | 0.001 on all 35 markets | the same tag |
| where it comes from | the exchange constant `'taker': this.parseNumber('0.002')` at `server/node_modules/ccxt/js/src/bitopro.js` line 211, and `'maker'` at line 210. `parseMarket` sets no fee, lines 438 to 498, so `setMarkets` merges `this.fees['trading']` into every market at `server/node_modules/ccxt/js/src/base/Exchange.js` line 3735 | CCXT 4.5.68 |
| CCXT tier table | taker 0.002, 0.00194, 0.0015, 0.0014, 0.0013, 0.0012, 0.0011 at 0, 3M, 5M, 30M, 300M, 550M and 1.3B, lines 213 to 221, and maker 0.001 down to 0.0003 at lines 222 to 230 | CCXT 4.5.68 |
| CCXT against the wire | the VIP 0 pair 0.001 and 0.002 matches. The rest of CCXT's tier table does not match the live one in section 4, which steps at 3M, 10M, 30M, 150M, 300M and 600M TWD | S3 |
| `fetchTradingFees` | returns 35 symbols with `taker` and `maker` undefined, because line 784 reads the `tradingFeeRate` array with `safeDict`, which returns the default `{}` for an array, and line 785 then finds no element 0 | `rest-probe.mjs main` at 03:29, 03:32 and 03:44 UTC, tag `ccxt_fetchTradingFees` |
| swap markets | 0, every market has `type` `spot` | tag `ccxt` |

## 9. Recommended registry values

None, because the venue has no perpetual.
The connector keeps only active swap markets, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 79 through `isActiveSwapMarket` at line 196, and a venue with none is skipped with `no usable swap markets; skipping the venue` at line 51.
If a spot leg were ever modelled, `takerPpm` 2,000 and `ccxtTakerPpm` 2,000 would be right, since the constant CCXT reports equals the live VIP 0 taker.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BitoPro Limitations and Fees page, English, read from the page's `__NEXT_DATA__` string store | https://www.bitopro.com/ns/en-US/fees | 2026-09-22 | BitoPro Technology Co., Ltd., Taiwan | legal entity, qualification rules, BITO discount, promotion labels, market making, Credit, sections 1 to 7 |
| S2 | BitoPro Terms of Use, Version Date March 30, 2026 | https://www.bitopro.com/ns/en-US/terms | 2026-09-22 | BitoPro, Taiwan | who may register, excluded citizenships, governing law, section 1 |
| S3 | BitoPro API, Get Limitations and Fees, live reply | https://api.bitopro.com/v3/provisioning/limitations-and-fees | 2026-09-22 | BitoPro | tier table, rank conditions, BITO and grid bot rates, sections 2, 4 and 5 |
| S4 | BitoPro Official Open API Document, README and Get Limitations and Fees page | https://github.com/bitoex/bitopro-offical-api-docs/blob/master/README.md | 2026-09-22 | BitoPro | endpoint list with no derivatives call, section 3 |
| S5 | BitoPro help center search for 手續費, public Zendesk API | https://support.bitopro.com/api/v2/help_center/articles/search.json?query=手續費 | 2026-09-22 | BitoPro | fee rebate coupon article 47411265708313, fee explanation article 360001215132 that points to the fee page, section 5 |
| S6 | Securities and Futures Bureau, Enterprises or Persons Providing Virtual Asset Services | https://www.sfb.gov.tw/en/home.jsp?id=286&parentpath=0,117 | 2026-09-22 | FSC, Taiwan | AML registration of BitoPro Technology Co., Ltd., section 1 |
| S7 | CoinGecko public API, `exchanges/bitopro` and `derivatives/exchanges` | https://api.coingecko.com/api/v3/exchanges/bitopro | 2026-09-22 | CoinGecko | listing context, section 1 |
| S8 | CCXT 4.5.68 `bitopro.js` and `base/Exchange.js` | `server/node_modules/ccxt/js/src/bitopro.js` | 2026-09-22 | CCXT | fee constants, tier table, `fetchTradingFees`, market types, section 8 |
| P1 | `rest-probe.mjs main`, runs at 03:16, 03:29, 03:32 and 03:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitopro/rest-probe.mjs) | 2026-09-22 | this host | tier table, CCXT fields, catalog counts |
| P2 | `rest-probe.mjs pages`, runs at 03:30 and 03:32 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitopro/rest-probe.mjs) | 2026-09-22 | this host | fee and terms page strings, CoinGecko reads |
