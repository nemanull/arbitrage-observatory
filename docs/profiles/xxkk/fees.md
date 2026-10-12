# XXKK Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 03:38 to 04:06 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the fees of XXKK's perpetual futures, which come in two families, USDT-M and USDC-M.
XXKK has no CCXT class and says on its own developer page that it has no public API, see section 8 and [`rest.md`](./rest.md) section 1.
The fee facts come from the fee page, the VIP page, the contract information page, and the per-contract fee fields of the website's own contract list call.
[`fees-probe.py`](../../../scripts/probes/venues/xxkk/fees-probe.py) reads all of them.

## 1. Scope and freshness

XXKK runs `www.xxkk.com`.
Its site and app downloads still carry the older Y-MEX name, for example `download.y-mex999.com` and `y-mexlenew.oss-ap-southeast-1.aliyuncs.com` in the site's main script, S6.
The compliance page names two registrations and no operating company: a FinCEN money services business registration, number 31000290292969, dated 2025-01-10, and a FINTRAC money services business registration, number M22420435, dated 2022-08-09, S5.
No legal entity, governing law or restricted country list was found.
The terms and the help center live on `support.xxkk.com`, which answered HTTP 403 with a Cloudflare "Just a moment..." challenge page to a plain request from this host.
The website's country list call `GET /api/home/country/list` returns 212 countries with `"active":true` on every one, including the US, Canada, mainland China, Singapore, Iran and North Korea, so it is no evidence of a restriction either way.
Who may trade the perpetuals is therefore Not publicly specified as far as a public page shows.

From the Canadian exit no page or call was refused.
The website's own location call `GET /api/public/location` placed the exit in the United Kingdom: `{"code":"GB","nameEn":"United Kingdom",…,"ip":"149.22.81.161","iso":"GB"}`.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label |
|---|---|---|---|
| USDT-M perpetual, 114 contracts | 0.02 %, 200 ppm | 0.06 %, 600 ppm | Published, S1, and Probed in the catalog, S4 |
| USDC-M perpetual, 26 contracts | 0.02 %, 200 ppm | 0.06 %, 600 ppm | Probed in the catalog, S4. The fee page names only "all perpetual pairs" |

The fee page's USDT-M tab has one row, "all perpetual pairs", with maker 0.02 % and taker 0.06 %, S1.
Its text says a maker pays 0.02 % and a taker 0.06 %.
Every one of the 140 rows of `GET https://www.xxkk.com/api/swap/public/common/exchangeInfo` carries `"feeRateMaker":0.0002` and `"feeRateTaker":0.0006`, USDC rows included, S4.
The same rows carry `"liqFeeRate":0.0006`.

## 3. Coverage matrix

| product | present | note |
|---|---|---|
| USDT-M linear perpetual | yes | 114 contracts, of which 36 are in the `Tradfi` zone: stocks, ETFs and commodities such as `nvda-usdt`, `spy-usdt` and `copper-usdt`, see [`rest.md`](./rest.md) section 2 |
| USDC-M linear perpetual | yes | 26 contracts, every one of them a base also listed against USDT except 8 |
| coin-M inverse perpetual | no | no row with `"reverse":true` and no settle asset other than USDT and USDC in the catalog |
| dated futures | no | every catalog row has `"contractType":2`, and no expiry field is filled |
| options | no | no product page or call found |
| "TradFi" CFD-style contracts | yes, not detailed | the `lite` product, 91 symbols such as `BTCUSDT1808`, `CL` and `AAPL`, with a fee of 0.04 % to 0.08 % of margin times leverage and a deferral fee of 0.008 %, S1. |
| spot | yes, not detailed | 139 spot pairs, maker and taker 0.1 %, S1 |

## 4. Perpetual tiers

XXKK publishes no tier table.
The VIP page says users of VIP 1 and above get "up to 50% off Futures trading fees", and elsewhere "Up to 60% trading fee discount", S2.
Its header says "Deposit $50K", and its rules qualify a level by 30-day perpetual trading volume or by daily asset snapshots at 00:00 UTC+8, S2.
The levels, their thresholds and their rates are not on the page, so they are Not publicly specified.
VIP status can also be granted on application with screenshots of a VIP level on another exchange, S2, which makes it Negotiated in part.

## 5. Discounts that change the perpetual taker

No token discount, referral discount or zero-fee promotion for the perpetual taker was found on the fee page or the VIP page.
The site links bonus campaigns such as `/en/activity/welcome-bundle` and `/en/activity/summer-boost`, S6.
Their terms were not read for this profile.

## 6. Funding as a cost

The contract information page gives the formula as funding rate = premium index + clamp(base rate - premium index, 0.05 %, -0.05 %), S3.
No cap or floor on the rate itself is published.
On the wire, 32 of the 140 contracts showed an upcoming `fundRate` of exactly 0.00375 in every run, which is 0.375 % per interval, and the lowest was -0.00265234 in run 2, S4 and [`rest.md`](./rest.md) section 4.
That 0.00375 looks like an unpublished cap.
The interval is per contract, `"fundRateInterval":8` on 110 contracts and `4` on 30, and the next settlement instants were 08:00 UTC and 04:00 UTC on 2026-10-10.
Who pays whom and when is not stated on any public page found.
The instant of a settlement was not captured.

## 7. Liquidation, settlement and delisting

Every catalog row carries `"liqFeeRate":0.0006`, the same as the taker rate.
No public page describes a liquidation fee, an insurance fund contribution rule or a delisting procedure.
The contract information page has a tab for the risk protection fund balance, served by `/api/swap/public/common/risk/list` and `/api/swap/public/future/risk/days`, which were not probed.
No catalog row had `delistTime` set on 2026-10-10.

## 8. CCXT

CCXT 4.5.68 has no XXKK class.
No file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` is named after XXKK or Y-MEX, and no source file there contains the string `xxkk`.
The current CCXT source on GitHub has none either.
The `ts/src` listing of `ccxt/ccxt` at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c`, dated 2026-10-08, holds 110 entries, and none contains `xxkk`.
The CCXT README on master does not mention XXKK.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 600 | the published VIP 0 perpetual taker, S1, equal to `feeRateTaker` on all 140 contracts, S4 |
| `ccxtTakerPpm` | none | there is no CCXT class, so there is no constant to expect |

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `https://www.xxkk.com/en/fee`, tabs "Spot Fee", "USDT-M Fee" and "TradFi Fee", whose numbers live in the script chunk `/_next/static/chunks/pages/%5Blocale%5D/fee-90043f62d9a8e8a8.js` | 2026-10-09 |
| S2 | `https://www.xxkk.com/en/vip` | 2026-10-09 |
| S3 | `https://www.xxkk.com/en/swap-info`, whose funding formula lives in `/_next/static/chunks/pages/%5Blocale%5D/swap-info-fc3f05a7272dcec9.js` | 2026-10-09 |
| S4 | `GET https://www.xxkk.com/api/swap/public/common/exchangeInfo`, probed by [`fees-probe.py`](../../../scripts/probes/venues/xxkk/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/xxkk/rest-probe.py) | 2026-10-09 |
| S5 | `https://www.xxkk.com/en/supervision` | 2026-10-09 |
| S6 | `https://www.xxkk.com/_next/static/chunks/pages/_app-adf470e5459135fc.js`, the site's main script | 2026-10-09 |
| S7 | `https://www.xxkk.com/en/developers` | 2026-10-09 |
| S8 | `https://github.com/ccxt/ccxt/tree/master/ts/src` at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` | 2026-10-09 |
