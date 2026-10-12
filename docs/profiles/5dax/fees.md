# 5DAX Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:06 to 05:33 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

5DAX lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That market is 77 pairs, 63 of them quoted in USDT, see [`rest.md`](./rest.md) section 2.
The published VIP 0 rate is 0.005 % maker and 0.005 % taker, which is 50 ppm, and the unauthenticated fee call the fee page makes returns the same base rate.
The venue's terms exclude residents of the United States and of Canada, so neither the development host nor the exit may trade there.
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/5dax/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | "Owner: Bitprotos LLC", and the terms say 5DAX operates "under the laws of the State of Wyoming, United States" | Published | S3, S4 |
| launch | 2021-11-09, by CoinMarketCap's record | Published | S7 |
| restricted locations | 55 entries on a named list, among them the United States, Canada, China, Japan, South Korea, Hong Kong and Russia, and the terms call VPN use to hide residency a material breach | Region-specific | S4 section 3.4, `fees-probe.py page` |
| who may trade spot | a verified 5DAX account holder outside the restricted list | Account-gated | S4 |
| fee page from this host | `https://5dax.com/trading-rule.html` and its view template answered HTTP 200 behind Cloudflare, edge `YVR` | Probed | `fees-probe.py page` |
| public API from this host | every documented public call on `api.5dax.com` answered, and the socket on `socket.5dax.com` upgraded | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

Market data reached this host without any refusal.
The restriction is a rule of the terms for account holders, and no page or call refused the Canadian exit.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, all 77 pairs | 0.005 %, 50 ppm | 0.005 %, 50 ppm | Published | S1 VIP table, row VIP 0 |
| spot, paying with FDX | 0.0040 %, 40 ppm | 0.0040 %, 40 ppm | Published | S1 VIP table, columns "(FDX)" |

The fee page's base rate is filled at run time from `POST https://5dax.com/exchange/getTradeFeeDefault`.
Without a session that call answered HTTP 200 with `{"fee":"0.005"}`, `fees-probe.py api`.
The page renders the value as `{{trade_fee_default}}%`, so `0.005` is a percentage and not a fraction.
A reader that took it as a fraction would get 0.5 %, a hundred times too high.
The policy heading says "Applicable to all Spot Trading Pairs", and no per pair rate was seen.
CoinMarketCap's record carries `makerFee` 0.0 and `takerFee` 0.0 with an empty fee URL list, which is its placeholder for an unknown fee, S7.

At 50 ppm a 5DAX spot taker costs a tenth of Gate's 500 ppm perpetual taker, see [`../gate/fees.md`](../gate/fees.md) section 2.
The depth that rate buys is tiny, see [`rest.md`](./rest.md) section 2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | no | no futures, perpetual or contract route among the app's 41 routes, and `/fapi/v1/*` on the API host answers 404 |
| coin-margined perpetuals | no | same, and `/dapi/v1/exchangeInfo` answers 404 |
| dated futures | no | same |
| options | no | same |
| margin | no | the only derivative-like route is `/margin-trading.html`, whose view reads "Margin Trading" and "To be completed" |
| spot order book | yes, 77 pairs, all `TRADING` | [`rest.md`](./rest.md) section 2 |
| launchpad, staking, P2P, OTC | named in the app's scripts and routes, not detailed | S2 |

Four more checks agree that 5DAX has no perpetuals.
The terms list the services as spot trading, deposits and withdrawals, listings, API access and account management, S4 section 2.4.
CoinMarketCap's record shows `perpetualVolume24h` 0 and `futuresVolume24h` 0 against a spot volume of about 11,590 USD, and its perpetual pair list for the venue holds 0 pairs, S7.
CoinGecko's derivatives list holds 216 venues and none named 5DAX, and its list of 1,503 exchanges has no 5DAX row at all, S8.
The API document describes only spot calls, S5.

## 4. Spot tiers

The tiers come from the 30-day spot volume, "updated daily at 00:00 UTC", S1.
The page does not name the volume currency, and its "Volume: $" label suggests USD.

| VIP | 30-day volume | maker | taker | maker with FDX | taker with FDX |
|---|---|---|---|---|---|
| 0 | | 0.005 % | 0.005 % | 0.0040 % | 0.0040 % |
| 1 | ≥ 10,000 | 0.004 % | 0.004 % | 0.0032 % | 0.0032 % |
| 2 | ≥ 50,000 | 0.003 % | 0.003 % | 0.0024 % | 0.0024 % |
| 3 | ≥ 200,000 | 0.0025 % | 0.0025 % | 0.0020 % | 0.0020 % |
| 4 | ≥ 1,000,000 | 0.002 % | 0.002 % | 0.0016 % | 0.0016 % |
| 5 | ≥ 5,000,000 | 0.0015 % | 0.0015 % | 0.0012 % | 0.0012 % |
| 6 to 9 | ≥ 10-100M | 0 % | 0 % | 0 % | 0 % |

Maker and taker are equal at every tier, and there is no rebate.
The FDX columns are the plain columns less 20 %.

## 5. Discounts that change the spot taker

| discount | value | label | evidence |
|---|---|---|---|
| hold FDX, at least 24 hours in the spot wallet | 50 % from 500 FDX, 75 % from 1,000, 95 % from 2,000, 100 % from 5,000 | Published | S1 |
| pay fees in FDX | a further 20 % off maker and taker | Published | S1 |
| combination rules | holding cannot be combined with a VIP discount, paying in FDX can be combined with either, and the total never passes 100 % | Published | S1 |
| worked example on the page | "Fee = 30% × 0.005% = 0.0015%" for a holder of 500 FDX who pays in FDX | Published | S1 |
| promotions | "Fees may vary during promotional events", with none named | Not publicly specified | S1 |
| referral | an `/invite` module exists in the app, and its effect on fees is Not publicly specified | Not publicly specified | S2 |

FDX balances are snapshotted three times a day, and the discounts apply in the order VIP, holding, then paying in FDX, S1.
The page says a large portion of users "may meet the conditions to achieve" a discount of 95 to 100 %.
So the effective taker of a funded account can be zero.

## 6. Funding as a cost

Not offered.
5DAX lists no perpetual, so there is no funding, see section 3.

## 7. Liquidation, settlement and delisting

Not offered.
There is no leveraged product, so there is no liquidation or settlement charge.
A delisting charge is Not publicly specified.
Deposits are free unless the token itself burns on transfer, and withdrawals carry a flat per network fee listed on the fee page, S6.

## 8. CCXT

CCXT 4.5.68 has no 5DAX class.
There is no `5dax.js` or `fivedax.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, which holds 104 classes, and the only names containing "dax" are `indodax.js` and `ndax.js`.
The `exchanges` map that opens at line 232 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` names `indodax` at line 302 and `ndax` at line 317, and nothing for 5DAX.
The current CCXT source agrees: `exchanges.json` on the `master` branch, at commit `f0aca06` of 2026-10-08, lists 103 ids and none for 5DAX, and `ts/src/5dax.ts`, `js/src/5dax.js` and `ts/src/fivedax.ts` answer 404, S9.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, and 5DAX has no perpetual and no CCXT class.
It cannot enter the registry as a perpetual leg.
If a later design adds spot legs from a hand-built catalog, `takerPpm` would be 50 from S1, and there is no `ccxtTakerPpm` to declare.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://5dax.com/trading-rule.html`, whose content is the view `https://5dax.com/public/common/views/trading.rule.html?v=1.0.8` | the "5DAX Trading Fee Policy", the VIP table, the FDX discounts and rules, the Wyoming MSB line |
| S2 | `https://5dax.com/` and the scripts it loads, among them `public/common/common.js?v=1.0.26` and `public/common/controller/master.controller.js?v=1.0.34` | the 41 routes, the fee call `POST /exchange/getTradeFeeDefault`, the socket host setting, the launchpad, staking, P2P, OTC and invite modules |
| S3 | `https://5dax.com/public/common/views/about.html?v=1.0.4` | "Owner: Bitprotos LLC", and that the platform "has been deployed on 20+ exchange platform already" |
| S4 | `https://5dax.com/public/common/views/terms.of.use.html?v=1.0.15` | Wyoming, the services in section 2.4, the restricted list of 55 entries and the VPN clause in section 3.4 |
| S5 | `https://5dax.com/public/common/views/api.html?v=1.0.1`, "Public Rest API for 5DAX", last updated March 1, 2019 | the base URL `https://api.5dax.com/api/v1`, 14 public GET paths, the call limits |
| S6 | `https://5dax.com/public/common/views/fees.html?v=1.0.4` | the deposit and withdrawal rules, and a trading fee block that is commented out and points to S1 |
| S7 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=5dax` and `.../exchange/market-pairs/latest?slug=5dax` with `category=spot` and `category=perpetual` | id 7729, launched 2021-11-09, fee fields 0.0, spot volume, 10 spot pairs tracked, 0 perpetual pairs |
| S8 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` and `https://api.coingecko.com/api/v3/exchanges/list` | 216 derivatives venues and 1,503 exchanges, no 5DAX in either |
| S9 | `https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json`, `https://api.github.com/repos/ccxt/ccxt/commits/master` and the three class paths | 103 CCXT ids, no 5DAX, three 404s |
