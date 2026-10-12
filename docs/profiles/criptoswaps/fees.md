# CriptoSwaps Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 04:15 to 04:45 UTC on 2026-10-10, from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

This profile covers the spot fees of CriptoSwaps, because the venue lists no perpetuals, see section 3.
CriptoSwaps publishes no API documentation and has no CCXT class, see section 8.
Its site runs the Openware OpenDAX stack, so the fee facts come from Peatio's public fee table call, the fee fields on resting orders, the fee table hard-coded in the web bundle, and CoinMarketCap's exchange record.
[`fees-probe.py`](../../../scripts/probes/venues/criptoswaps/fees-probe.py) reads all of them, and its sections are numbered 1 to 5.

## 1. Scope and freshness

CriptoSwaps runs `www.criptoswaps.com`, behind Cloudflare, see [`rest.md`](./rest.md) section 1.
CoinMarketCap's exchange record describes it as a centralized exchange based in Ankara, Turkey, launched in January 2021, not licensed by a financial authority, and offering no derivatives, futures, options or margin trading, S4.
No legal entity, terms page or restricted country list was found on the site.
The site's start script reads `GET /api/v2/sonic/public/config` and sends the browser to a `/restriction` page when that call answers HTTP 471, S3.
From the Canadian exit the call answered 200, so the exit is not restricted, see [`rest.md`](./rest.md) section 1.
Who may trade is therefore Not publicly specified.

Only four currencies accept deposits, all of them small tokens: `wg`, `csk`, `ordu` and `ldt`, see [`rest.md`](./rest.md) section 3.
BTC, ETH and USDT have `deposit_enabled` and `withdrawal_enabled` false.
An account could therefore not fund a trade in any of the major pairs, whatever the fee.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label |
|---|---|---|---|
| spot, every market except `wcswcp` | 0.2 %, 2,000 ppm | 0.2 %, 2,000 ppm | Probed, S1. The web table agrees on the taker and differs on the VIP-0 maker, section 4 |

`GET /api/v2/peatio/public/trading_fees` returns the row `group` `vip-0`, `market_id` `any`, `maker` `0.002`, `taker` `0.002`, last updated 2022-03-22, and the row `group` `any`, `market_id` `any` with the same two numbers.
Peatio's documentation types the fields as doubles without a unit, S6.
The web table in section 4 shows the `any` row as 0.2000 %, so the fields are fractions and `0.002` is 0.2 %.
Which group a new account lands in is Account-gated, but both candidate groups carry 0.2 % for maker and taker alike.
CoinMarketCap's record shows `makerFee` 0.0 and `takerFee` 0.0, fees probe section 4, which neither the fee table nor the web table supports.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot | yes, 103 markets, all `"type":"spot"` and `"state":"enabled"` | [`rest.md`](./rest.md) section 2 |
| perpetuals, any margin | no | `GET /api/v2/peatio/public/markets?type=qe` returns `[]`, `?type=futures` returns 422 `public.market.invalid_market_type`, and CoinMarketCap shows perpetual and futures volume 0 and says the venue offers no derivatives, S4 |
| dated futures | no | the same evidence |
| options | no | CoinMarketCap's description, S4 |
| margin | no | CoinMarketCap's description, S4 |

The landing page carries the strings "Hot Derivatives" and "Spot pairs or Futures contracts", S3.
They are template copy from the OpenDAX front end, and no derivative market or call stands behind them.

## 4. Spot tiers

The public fee table has seven rows, fees probe section 1.

| group | market | maker | taker | updated |
|---|---|---|---|---|
| `any` | `any` | 0.2 %, 2,000 ppm | 0.2 %, 2,000 ppm | 2021-11-20 |
| `vip-0` | `any` | 0.2 %, 2,000 ppm | 0.2 %, 2,000 ppm | 2022-03-22 |
| `vip-1` | `any` | 0.08 %, 800 ppm | 0.18 %, 1,800 ppm | 2021-11-20 |
| `vip-2` | `any` | 0.06 %, 600 ppm | 0.16 %, 1,600 ppm | 2021-11-20 |
| `vip-3` | `any` | 0 | 0 | 2021-12-11 |
| `any` | `wcswcp` | 20 %, 200,000 ppm | 20 %, 200,000 ppm | 2025-03-20 |
| `vip-0` | `wcswcp` | 20 %, 200,000 ppm | 20 %, 200,000 ppm | 2025-03-20 |

The two `wcswcp` rows read `"maker":"0.2"` and `"taker":"0.2"`.
In the unit of every other row that is 20 %, which looks like a percent typed into a fraction field.
The wire value is what Peatio would charge, so a feed of that market would have to take it at face value.

The fee page `/fee-detail` is a client-side route, and its table is hard-coded in the web bundle, fees probe section 3.

| ID | Group | Market | Taker | Maker |
|---|---|---|---|---|
| 5 | VIP-3 | ANY | 0.0000% | 0.0000% |
| 4 | VIP-2 | ANY | 0.0600% | 0.1600% |
| 3 | VIP-1 | ANY | 0.0800% | 0.1800% |
| 2 | VIP-0 | ANY | 0.1000% | 0.2000% |
| 1 | ANY | ANY | 0.2000% | 0.2000% |

The web table's column labels put Taker before Maker.
For VIP-1 and VIP-2 the numbers match the API only if the first column is the maker, so the labels are swapped.
Read that way, VIP-0 on the web is maker 0.1 % and taker 0.2 %, while the API's `vip-0` row says maker 0.2 % since 2022-03-22.
The two sources agree on the VIP 0 taker, 0.2 %, under that reading.

The qualification rule is the bundle's English text, fees probe section 3: "As your 30-day transaction volume increases to the next fee level, your maker / taker fee rate will decrease."
It goes on to say that the 30-day volume "and current TRX balance" are recalculated every 24 hours.
No volume thresholds are published, so the tier boundaries are Not publicly specified.

## 5. Discounts

CoinMarketCap's record names a referral program and staking rewards, S4.
No referral or token discount on the trading fee is published.
The TRX balance clause in section 4 names no amount.

Resting orders carry their own fee fields in `GET /api/v2/peatio/public/markets/<id>/order-book`, fees probe section 2.
Of 371 and 373 resting BTC/USDT orders in two runs, all but one carried `maker_fee` and `taker_fee` `"0.0"`, and that one carried `"0.002"`.
All 355 and 358 ETH/USDT orders and all 277 and 280 ZEC/BTC orders carried `"0.0"`.
So nearly every resting order belongs to an account in a zero-fee group such as `vip-3`.
CoinMarketCap tags the venue "Auto Order Book Exchange", S4, and [`rest.md`](./rest.md) section 5 shows the books sit within about 22 basis points of Binance's mid with a spread of 28 to 60 basis points.

## 6. Funding as a cost

Not offered.
CriptoSwaps lists no perpetuals, so it charges no funding, see section 3.

## 7. Liquidation, settlement and delisting charges

Not offered.
There is no margin or derivative product to liquidate or settle.
Deposit and withdrawal fees are in the `deposit_fee` and `withdraw_fee` fields of `GET /api/v2/peatio/public/currencies`.

## 8. CCXT

CCXT 4.5.68 has no CriptoSwaps class.
No file in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` matches `cripto`, `swaps`, `peatio` or `openware`, fees probe section 5.
The current CCXT source on GitHub has none either: the `ts/src` listing at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` holds no such file, S5.
`market.taker` is therefore not available.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 2000 | the `vip-0` and `any` rows of the public fee table, both 0.002 on every market but `wcswcp` |
| `ccxtTakerPpm` | none | no CCXT class |

These values only matter for a future spot leg.
The venue cannot join the engine as a perpetual leg, and the disabled deposits in section 1 make even a spot leg unfundable today.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | `GET https://www.criptoswaps.com/api/v2/peatio/public/trading_fees` and `/member-levels`, fees probe section 1 | 2026-10-09 |
| S2 | `GET https://www.criptoswaps.com/api/v2/peatio/public/markets/<id>/order-book?asks_limit=200&bids_limit=200` for `btcusdt`, `ethusdt` and `zecbtc`, fees probe section 2 | 2026-10-09 |
| S3 | The web start script `https://www.criptoswaps.com/public/assets/config.js` and the bundle `https://www.criptoswaps.com/public/assets/bundle.78aa1abaf20c890dfbec.js`, 21,646,909 bytes: the `FeeBuyOrSellTable` component, the `statusfee1` and `statusfee2` strings, the landing page copy | 2026-10-09 |
| S4 | CoinMarketCap exchange record `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=criptoswaps`, its description, fee fields, tags and volume quote, fees probe section 4 | 2026-10-09 |
| S5 | `https://api.github.com/repos/ccxt/ccxt/contents/ts/src` at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c`, fees probe section 5 | 2026-10-09 |
| S6 | Openware Peatio user API v2, branch 2-6-stable, section `/api/v2/peatio/public/trading_fees`: `https://raw.githubusercontent.com/openware/peatio/2-6-stable/docs/api/peatio_user_api_v2.md` | 2026-10-09 |
