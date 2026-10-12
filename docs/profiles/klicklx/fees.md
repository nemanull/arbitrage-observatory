# KlicklX Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:14 to 04:44 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the fees of KlicklX's USDT-margined perpetual futures, the one perpetual family it lists.
KlicklX is the exchange CoinMarketCap used to list as IDCM, and its CoinMarketCap page still lives at the slug `idcm`, S1.
KlicklX publishes no futures fee schedule that this survey could find, so the VIP 0 taker is unknown.
[`fees-probe.py`](../../../scripts/probes/venues/klicklx/fees-probe.py) reads the help center, the restrictions notice, the terms, the risk tiers and the account fee call.

## 1. Scope and freshness

The website is `www.klicklx.com`, with spot on `trade.klicklx.com` and perpetuals on `futures.klicklx.com/futures`, S2.
CoinMarketCap names it KlicklX, exchange id 421, with the website `https://www.klicklx.com/` and a launch date of 2018-04-02, S1.
The help center's regional restrictions notice says KlicklX "currently operates under two verification entities: the Poland Entity and the UAE Entity", S3.
The Poland entity restricts, among others, the United States of America, Bulgaria, Russia and Ukraine.
The UAE entity restricts a shorter list: Afghanistan, North Korea, Iran, Myanmar, Yemen, Belarus, Russia, Ukraine, the Democratic Republic of the Congo, Libya, South Sudan, Haiti, Venezuela and Vanuatu.
Canada is on neither list, S3.
The user terms in the help center are those of Klickl International Limited, regulated by the ADGM Financial Services Regulatory Authority under permission number 220070, S4.
Those terms never use the words futures, perpetual, derivative or leverage, so no public document names the entity that runs the perpetuals or who may trade them.
The futures page carries a `contract-beta` style class and a testnet host, `testnet.klicklx.com`, S2.
Who may trade the perpetuals is therefore Not publicly specified.

From the Canadian exit no page or call was refused.
Every host answered through Cloudflare, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label |
|---|---|---|---|
| USDT-margined linear perpetual, 20 contracts | unknown | unknown | Not publicly specified, and Account-gated behind `POST /api/account/GetMyHandlingFee`, S5 |

None of the 41 help center articles names futures, contracts, or a maker or taker fee, S3.
The one article titled "Fee Schedule" sits under the Bank Account category, S3.
The futures web client reads the user's own rate from `POST https://ctapi.klicklx.com/api/account/GetMyHandlingFee`, S2.
Without a login that call answers `{"success":false,"errorCode":40003,"msg":"token invalid."}`, S5.
The futures scripts hold no fee number and no maker or taker text, S2.
The catalog rows of `GetContracts` carry no fee field, see [`rest.md`](./rest.md) section 2.
CoinMarketCap shows `"makerFee":0,"takerFee":0` for the venue, which is CoinMarketCap's empty value and not a published rate, S1.

## 3. Coverage matrix

| product | present | note |
|---|---|---|
| USDT-margined linear perpetual, crypto | yes | 14 contracts, `symbolType` 0, such as `BTCUSDT`, `ETHUSDT` and `1000SHIBUSDT`, see [`rest.md`](./rest.md) section 2 |
| USDT-margined linear perpetual, stocks, ETFs and commodities | yes | 6 contracts, `symbolType` 5: `XAUUSDT`, `TSLAUSDT`, `QQQUSDT`, `SPYUSDT`, `CLUSDT` and `SPCXUSDT` |
| coin-margined inverse perpetual | no | `GetCoins` returns USDT as the only margin coin, and every contract name ends in `USDT` |
| USDC-margined perpetual | no | same evidence |
| dated futures | no | the catalog has no expiry field, and every row has a funding interval in the ticker |
| options | no | no product page or call found in the site scripts |
| spot | yes, not detailed | `trade.klicklx.com`, with pairs such as `BTC/USDT`, `KLK/USDT` and `USDC/USDT` on CoinMarketCap, S1. The 2018 IDCM-era REST API for spot still answers, see [`rest.md`](./rest.md) section 1 |

## 4. Perpetual tiers

No fee tier table is published.
The only tier table the futures site serves is the risk tier list, `POST /api/baseinfo/GetPositionGearList`, which sets margin and leverage, not fees, S5.
For `BTCUSDT` it has 12 gears, from gear 1 with volume 1 to 500, maintenance margin 0.004, initial margin 0.008 and 125x, to gear 12 with volume 6000001 to 9000000, maintenance margin 0.5 and 1x.
The volume unit of those gears is not stated.

## 5. Discounts that change the perpetual taker

No token discount, referral discount or zero fee promotion for the perpetual taker was found.
The site has an agent programme with `GetUserAgentFeesDescribes` and `GetAgentSetableRateRange` calls, S2, which suggests rebates set per agent.
Those calls were not probed.
The exchange token KLK trades on spot, S1, and no page links it to a futures fee discount.

## 6. Funding as a cost

No public page states the funding formula, a cap or a floor, or who pays whom.
On the wire every contract carried `intervalHour` 8, and settlements fall at 00:00, 08:00 and 16:00 UTC, see [`rest.md`](./rest.md) section 4.
The funding history of `BTCUSDT` had 1144 entries on 2026-10-10.
The largest magnitude seen was on `TRXUSDT`, with a last settled rate of -0.0004026 and a forecast of -0.00044614 per interval.
The instant of a settlement was not captured.

## 7. Liquidation, settlement and delisting

No public page describes a liquidation fee, an insurance fund rule or a delisting procedure.
`GetRiskReserveList` reports a risk reserve of 100004515.6021895 USDT for `BTCUSDT` on each of the last 7 days, the same amount every day, S5.
The catalog row's `riskReserverAmount` holds the same number.
The liquidation order list `GetLiquidationOrderList` exists in the site scripts and was not probed, S2.

## 8. CCXT

CCXT 4.5.68 has no KlicklX class.
No file in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` is named after KlicklX, Klickl or IDCM, and none of the 104 source files there contains `klickl` or `idcm`, S5.
The current CCXT source on GitHub has none either.
The `ts/src` listing of `ccxt/ccxt` at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c`, dated 2026-10-08, holds 110 entries, and none contains `klick` or `idcm`, S6.
The CCXT README on master does not mention either name, S6.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | none yet | no published VIP 0 perpetual taker exists, and the account fee call needs a login. An adapter has to establish the rate from an account first |
| `ccxtTakerPpm` | none | there is no CCXT class, so there is no constant to expect |

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://coinmarketcap.com/exchanges/idcm/`, whose page data names KlicklX, exchange id 421 | 2026-10-09 |
| S2 | The site scripts: `https://www.klicklx.com/client/static/js/Page.c725b912.chunk.js`, and the futures app `https://futures.klicklx.com/assets/index.7f891b75.js` with its chunks `index.554fb3b4.js`, `index.b3ce3fab.js`, `index.d8852ced.js` and `index.ae7c2640.js` | 2026-10-09 |
| S3 | `POST https://api.klicklx.com/api/idcm/foundation/app/HelpCenter/GetHelpCenterCategoryShowList`, and the article "KlicklX Regional Restrictions Notice", id `839431674366701568ff42`, read by [`fees-probe.py`](../../../scripts/probes/venues/klicklx/fees-probe.py) | 2026-10-09 |
| S4 | The help center article "User Terms & Conditions", id `774213904318771200d0b9`, read by [`fees-probe.py`](../../../scripts/probes/venues/klicklx/fees-probe.py) | 2026-10-09 |
| S5 | `GetMyHandlingFee`, `GetPositionGearList` and `GetRiskReserveList` on `https://ctapi.klicklx.com/api/`, and the CCXT 4.5.68 file listing, probed by [`fees-probe.py`](../../../scripts/probes/venues/klicklx/fees-probe.py) | 2026-10-09 |
| S6 | `https://github.com/ccxt/ccxt/tree/master/ts/src` at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c`, and `https://raw.githubusercontent.com/ccxt/ccxt/master/README.md` | 2026-10-09 |
