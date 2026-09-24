# BitBNS Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (04:41 to 05:10 UTC on 2026-09-23), from the development host near Seattle, through its Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the fees of BitBNS (CCXT id `bitbns`) for its one perpetual family, USDT-settled linear perpetuals, and names spot only in the coverage matrix.
CCXT 4.5.68 models BitBNS as spot only, so every perpetual fact below comes from the venue's own pages, its web app and [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs).
The perpetual market is close to dead: 1 of 20 listed perpetuals traded in the 24 hours before the probe, 0.0006 BTC in total, see [`rest.md`](./rest.md) section 2.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Buyhatke Internet Pvt. Ltd., "A Product of Buyhatke Internet Private Ltd." on every page | S1, S3 |
| governing law | Karnataka, India | S3 |
| terms date | "Last updated: 11 January 2026" | S3 |
| country on CoinGecko | Estonia, established 2017, trust score 3, trust rank 158 on 2026-09-23 | S7 |
| who may trade | the terms exclude only people who "belong to any FATF sanctioned countries" | S3 |
| US persons | Not publicly specified, the terms name no US exclusion | S3 |
| INR rails | deposits and withdrawals in INR go to a "verified and registered bank account", which is an Indian bank account | S3 |
| perpetual access | the futures API and the futures wallet need a logged in account, and the public web routes used here are those of the web app | S4, S5 |

The terms of 11 January 2026 let BitBNS "liquidate or convert any crypto assets, digital assets, or balances held in the User's account into INR" on suspension or termination, "without requiring any separate withdrawal request", S3.
The spot books traded at roughly half of the global price on the probe date, see [`rest.md`](./rest.md) section 2, and the cause is not established by any public source read here.
Public REST and WebSocket endpoints all answered this host, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
Those access results are from the Canadian VPN exit, not from a Seattle address.

## 2. Quick answer

| family | maker | taker | maker ppm | taker ppm |
|---|---|---|---:|---:|
| USDT-M perpetuals, list price | 0.1 % | 0.1 % | 1,000 | 1,000 |
| USDT-M perpetuals, as published on 2026-09-22 | ~~0.1 %~~ 0 % "(Introductory Offer)" | 0.1 % | 0 | 1,000 |

The fee page shows the perpetual maker as `<s>0.1%</s> 0% (Introductory Offer)` and the taker as `<b>0.1%</b>`, S1.
No end date is given for the offer.
The web app's futures store starts from `future_makerTakerFees:{makerFee:.1,takerFee:.1}`, in percent, S5.
The engine models a taker cross, so the number that matters is 1,000 ppm.

## 3. Coverage matrix

| product | present | detail | source |
|---|---|---|---|
| USDT-M linear perpetuals | yes, 20 instruments listed | `usdt_settled` 1 and `status` 0 on all 20, the web app shows instruments 2 to 11 | P1, S4 |
| coin-margined perpetuals | no | no instrument has `usdt_settled` other than 1 | P1 |
| USDC-M perpetuals | no | | P1 |
| dated futures | no | the app has only perpetual routes, `/futures/` and `/futures-testnet/` | S5 |
| options | "Coming Soon" on the fee page, and an options socket exists in the web app | not researched | S1, S5 |
| spot | yes, 186 INR pairs and 38 USDT pairs, all `active` | VIP 0 maker and taker 0.25 %, the only product CCXT models | P1, S1, S6 |
| margin | yes, lending with a 15 % lender fee | not researched | S1 |

CoinGecko's derivatives list does not show BitBNS, and its derivatives exchange API answered `{"error":"market not found"}` with 404 for `bitbns`, S7.

## 4. Perpetual tiers

None are published.
The fee page gives one flat futures rate, "Fees are applicable for both Makers and Takers", with no volume tier and no BNS holding tier, S1.
The VIP 0 to VIP 9 table on the same page is titled "Spot Trading Fees" and is not repeated here.

## 5. Discounts that change the perpetual taker

| discount | applies to the perpetual taker | source |
|---|---|---|
| "Pay with BNS" VIP refunds | no evidence, the table is headed "Spot Trading Fees" and is paid as a daily refund at 12 PM IST | S1 |
| maker "Introductory Offer" | maker only, 0 %, no end date | S1 |
| referral | a referral program is linked from the footer, terms not read | S1 |
| market maker program | Not publicly specified | |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | "FR = (LTP - Index price)/Index price . Logged every 15 minutes. Linear average every 8 hrs." | S2 |
| cap | "FFR = simple average of 8hrs subject to 0.5% max." | S2 |
| mark used for funding | "Right now the Mark price used for funding rate calculations is same as the Index Price" | S2 |
| interval | 8 h, every gap between the 50 newest history rows of BTC and ETH was 8 h | P2 |
| settlement times | 00:00, 08:00 and 16:00 UTC, stamped 2 to 15 s after the hour over 100 rows | P2 |
| who pays | a positive rate means longs pay shorts, from the venue's general perpetual guide | S2 |
| unit on the wire | percent per 8 h, an inference: ETH read `0.326367`, which as a fraction would exceed the 0.5 % cap 65 times | P2 |

The funding follows the last traded price, and the perpetuals barely trade.
`BTCUSDTP` published the same rate, `-0.009573`, on all 50 settlements from 2026-09-06 16:00 UTC to 2026-09-23 00:00 UTC.
`ETHUSDTP` published three distinct values between `0.313105` and `0.326367` over the same span.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation trigger | "Liquidation starts when margin ratio hits 95%" | S2 |
| liquidation price basis | the web app labels it "Based on Last Index price." | S5 |
| maintenance margin | 2.5 % at 10x, 5 % at 5x, 10 % at 3x, 20 % at 1x on BTC, ETH and IC15, "may be updated very frequently" | S2 |
| platform position cap | "Upto margin of 10,000 USDT" | S2 |
| price band | "+-5% around Underlying Index Price" | S2 |
| liquidation fee | Not publicly specified | |
| delisting | Not publicly specified | |

The price band is not what the wire shows.
`BTCUSDTP` traded 0.0003 BTC at 7,841.26 USDT at 02:54 UTC on 2026-09-23, while the venue's own index read about 86,900, see [`rest.md`](./rest.md) section 4.

## 8. CCXT

CCXT 4.5.68 has no BitBNS perpetual market.
`describe()` sets `'swap': false` and `'future': false` at `server/node_modules/ccxt/js/src/bitbns.js` lines 32 and 33, and `features.swap` carries the comment "todo: implement swap methods" at line 204.
`fetchMarkets` reads only `order/fetchMarkets` and stamps every row `'type': 'spot'`, lines 262 to 355.
So `loadMarkets` returned 224 spot markets and 0 swaps, and the connector's `isActiveSwapMarket` filter at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 196 keeps none of them, P1.

For spot, `market.taker` and `market.maker` are 0.0025 on all 224 markets, from the flat `fees.trading` block at `bitbns.js` lines 141 to 148, with the taker at line 146, P1.
That is 2,500 ppm, and it matches the fee page's spot VIP 0 rate of 0.25 %, S1.

## 9. Recommended registry values

None.
BitBNS should not be registered as a perpetual venue in its current shape.
CCXT yields no swap market to register, the perpetual catalog and book exist only behind the web app's undocumented routes, and 19 of the 20 perpetuals had no trade in 24 hours.
Should that change, the taker would be `takerPpm: 1_000` from S1, and `ccxtTakerPpm` would stay unset because CCXT reports no perpetual taker.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitbns Fees | https://bitbns.com/fees/ | 2026-09-22 | Buyhatke Internet Pvt. Ltd., India | spot VIP table, "Pay with BNS", futures maker and taker, options "Coming Soon", margin lending fee, sections 2 to 5 |
| S2 | Bitbns Beginner's Guide, futures pages: Index Price Calculations, How is Funding Rate Calculated, Margining System, How to track liquidation price, Bitbns Futures Beginner's Guide | https://docs.bitbns.com/bitbns-beginners-guide/guides/bitbns-futures-beginners-guide | 2026-09-22 | BitBNS | funding formula and cap, mark equals index, liquidation at 95 %, margins, price band, position cap, sections 6 and 7 |
| S3 | Bitbns Terms and Conditions | https://bitbns.com/terms-and-conditions/ | 2026-09-22 | Buyhatke Internet Pvt. Ltd., Karnataka law | operator, FATF clause, liquidation to INR clause, section 1 |
| S4 | Bitbns API docs, Futures, Active Markets | https://docs.bitbns.com/bitbns/futures/active-markets | 2026-09-22 | BitBNS | `POST https://api.bitbns.com/api/trade/v1/futuresInstList` with API key headers, sections 1 and 3 |
| S5 | Bitbns web app bundles `App.74a4014e.js`, `index.c7bf753d.js`, `index.90dda0f6.js` | https://bitbns.com/trade/assets/ | 2026-09-22 | BitBNS | futures routes, default fee store, "Based on Last Index price.", sections 1 to 3 and 7 |
| S6 | CCXT 4.5.68 `bitbns.js` | `server/node_modules/ccxt/js/src/bitbns.js` | 2026-09-22 | CCXT | spot only, flat 0.25 %, section 8 |
| S7 | CoinGecko API `exchanges/bitbns` and `derivatives/exchanges/bitbns` | https://api.coingecko.com/api/v3/exchanges/bitbns | 2026-09-22 | CoinGecko | country, trust rank, 0.023 BTC of 24 h volume, no derivatives listing, sections 1 and 3 |
| P1 | `rest-probe.mjs catalog` at 04:56 and 05:09 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | instrument list, spot catalog, CCXT markets and fees, sections 3 and 8 |
| P2 | `rest-probe.mjs funding` at 04:57 and 05:10 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbns/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | funding history of `BTCUSDTP` and `ETHUSDTP`, section 6 |
