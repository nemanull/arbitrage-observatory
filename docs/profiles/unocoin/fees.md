# Unocoin Fee Profile

**Status:** Done.
Unocoin lists 14 INR-quoted perpetuals, routed to Pi42 and priced from Binance USD-M, with a flat published 0.05% maker and 0.10% taker.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:13 to 04:31 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada, and every Cloudflare reply carried a `YVR` (Vancouver) ray id.

Unocoin lists perpetuals, so this profile covers them, as design decision 3 asks.
Unocoin has no CCXT class, see section 8.
Every number carries a source id from section 10 or a probe reference.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/unocoin/fees-probe.py), [`rest-probe.py`](../../../scripts/probes/venues/unocoin/rest-probe.py) and [`ws-probe.py`](../../../scripts/probes/venues/unocoin/ws-probe.py).
The REST and socket details are in [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

- The operator is Unocoin Technologies Private Limited, incorporated in India, registered office in Tumkur, Karnataka, S3.
- The terms say "Unocoin Services are strictly available for use only within India or for Indians", S3.
  KYC needs a PAN card, which only an Indian taxpayer holds, S3.
  So US persons, and every other non-Indian, are excluded in practice.
- The futures section of the terms calls the product a brokerage model, S3.
  It says "Orders may be routed via third-party providers such as Pi42", and lists trading fees, funding fees, liquidation fees and "Third-party charges", S3.
- Futures trading is "available only to users who meet eligibility criteria as determined by Unocoin from time to time", S3.
- CoinMarketCap lists Unocoin as exchange id 378, country `IN`, with 0 perpetual and 0 futures volume, S5.
  Its `makerFee` and `takerFee` read `0.0`, and its fee link `https://www.unocoin.com/post/92` answers `404`, in `fees-probe.py`.
- Nothing refused this host.
  Every page and API call named here answered from the Canadian exit, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| INR-quoted, INR-margined linear perpetuals (14) | 0.05%, 500 ppm | 0.10%, 1,000 ppm | `maker_fee` and `taker_fee` in `GET /v1/futures/app-pairs`, equal on all 14 contracts, which the fee page S1 renders as "Maker Fee (%)" and "Taker Fee (%)", in `fees-probe.py` |

The fee page S1 ships its futures table empty and fills it in the browser from `GET https://api.unocoin.com/api/v1/futures/app-pairs`.
The page's script fetches that path and prints `Number(t.taker_fee).toFixed(2)` under "Taker Fee (%)", in `fees-probe.py`.
So the published taker is the API's `"0.10000000"` read as a percent.

The fee page says that "A government levied IGST of 18% will be charged on the transaction fee", S1.
That note sits under the instant buy and sell table, and no Unocoin page says whether it also applies to futures fees.
If it does, the effective taker is 0.118%, 1,180 ppm.
Not publicly specified.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| INR-quoted perpetuals, INR margin | yes, 14 contracts, all `contract_type` `PERPETUAL` and `status` 1 | `GET /v1/futures/app-pairs`, in `rest-probe.py`, and the support article S2 says "all contracts are quoted and settled in Indian Rupees (INR)" |
| USDT-quoted or USDT-margined perpetuals | no | `markets` is `["INR"]` and `margin_assets_supported` is `["INR"]` on all 14, in `rest-probe.py` |
| inverse (coin-margined) perpetuals | no | the same catalog |
| dated futures | no | the support article S2 says "All contracts on the platform are Perpetual" |
| options | no | no menu entry, page or API path was found in the web app bundle |
| spot | yes, named only | `GET /exchange/app-pairs` lists 261 pairs under INR, BTC and USDT, of which 6 have `trading_enabled` 1, in `rest-probe.py` |

The Pi42 deployment behind Unocoin carries 216 INR contracts in `GET /v1/futures/market/marketInfo`, but Unocoin's catalog, REST book and socket serve only its 14, see [`rest.md`](./rest.md) section 2.
CoinGecko's derivatives list does not track Unocoin, and CoinMarketCap shows 0 perpetual volume, S5.

## 4. Perpetual tiers

No tier table is published.
The fee page S1 shows one maker and one taker per contract, and the catalog carries one `maker_fee` and one `taker_fee` per contract, in `fees-probe.py`.
No volume tier, VIP programme or market maker schedule was found.

Leverage is published three different ways, and they disagree.

| source | BTCINR maximum leverage |
|---|---|
| catalog `max_leverage`, which the fee page S1 renders | 150 |
| catalog `unocoin_max_leverage` | 5, on all 14 contracts |
| support article S2 | "Upto 75x" |

The catalog also carries `maintenance_margin_config` by leverage band, 5% at 1x to 5x up to 30% at 101x to 150x on BTCINR, in `fees-probe.py`.

## 5. Discounts that change the perpetual taker

None found.
No token holding discount, referral rebate or promotion is published on the fee page S1 or in the futures terms S3.

## 6. Funding as a cost

- Funding is charged on perpetual positions, S3.
- `funding_fee_interval` is 8 on all 14 contracts, in `fees-probe.py`.
- The socket's `markPrice` channel gave the next settlement as `T` 1791619200000, 08:00 UTC on 2026-10-10, the same instant as Binance's `nextFundingTime` for BTCUSDT, in `rest-probe.py` and `ws-probe.py`.
- The published rate is `upcomingFundingRate`.
  For BTCINR it read 0.000016398 in both runs, against Binance's BTCUSDT predicted `lastFundingRate` of 0.00001845 and then 0.00001773, ratios of 0.89 and 0.92, in `rest-probe.py`.
- Unocoin publishes no funding formula, cap or floor.
  Not publicly specified.
- The settlement instant was not captured, because the survey never waits for a clock event.

## 7. Liquidation, settlement and delisting

- `liquidation_fee` is `"0.02000000"` on all 14 contracts, read as 0.02% in the same unit as the trading fee, in `fees-probe.py`.
  No page states its base.
- No settlement or delisting fee is published.
- The terms add "Third-party charges" without a number, S3.

## 8. CCXT

- CCXT 4.5.68 has no Unocoin class and no Pi42 class.
  There is no `unocoin.js` or `pi42.js` among the 104 files under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and no file there contains `unocoin` or `pi42`, in `fees-probe.py`.
- Current CCXT on GitHub has neither class.
  The 110 entries of `ts/src` on master, listed on 2026-10-10, contain no name matching `unocoin` or `pi42`, in `fees-probe.py`.
- So no `market.taker` exists to read.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 1000 | the published flat 0.10% taker, section 2 |
| `ccxtTakerPpm` | none | there is no CCXT class |

If the 18% IGST is confirmed to apply to futures fees, `takerPpm` becomes 1180.
The venue is not recommended as a leg, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | source | label |
|---|---|---|
| S1 | [Unocoin fee page](https://unocoin.com/in/support/fees/), retrieved 2026-10-10, with its futures table filled from `GET /v1/futures/app-pairs` | Published |
| S2 | [Unocoin support, "How to Trade Futures"](https://support.unocoin.com/portal/en/kb/articles/how-to-trade-on-futures-27-4-2026), retrieved 2026-10-10 | Published |
| S3 | [Unocoin terms of use](https://unocoin.com/in/policy/termsofuse/), sections on eligibility, KYC and "Futures Service Usage", retrieved 2026-10-10 | Published |
| S4 | `GET https://api.unocoin.com/api/v1/futures/app-pairs`, in [`fees-probe.py`](../../../scripts/probes/venues/unocoin/fees-probe.py) | Probed |
| S5 | CoinMarketCap `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=unocoin`, in `fees-probe.py` | Probed |
| S6 | CCXT 4.5.68 under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` and [CCXT `ts/src` on GitHub](https://github.com/ccxt/ccxt/tree/master/ts/src), in `fees-probe.py` | Probed |
