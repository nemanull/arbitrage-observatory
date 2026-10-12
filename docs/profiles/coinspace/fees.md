# COINSPACE Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:30 to 03:50 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

This profile covers the USDT-margined perpetual futures that COINSPACE sells at `www.coinspace.world`, and nothing else.
COINSPACE has no CCXT class, so the folder is the slug `coinspace`.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/coinspace/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/coinspace/rest-probe.py).

The finding that governs every section: COINSPACE has no order book of its own.
Its trade page draws Binance USD-M futures' book, trades and funding straight from Binance, and its public REST relays the same Binance data, see [`rest.md`](./rest.md) section 5 and [`websocket.md`](./websocket.md) section 1.
The admin pages in the same web app settle each user's realized PnL and fees to a sales organization, which reads as a house that takes the other side of every trade, S8.
The fee numbers below are what the venue publishes, and no fill can be observed without an account.

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-10-09 | this profile |
| legal entity | COINIA S.R.L., Costa Rica, legal registration number 3-102-909490, incorporated 2024-07-10, registered at San Rafael, Escazú, San José | S7, the web app's risk disclosure section 7 |
| CoinMarketCap record | id 12144, launched 2024-10-14, described as "primarily a spot exchange" at launch with derivatives planned | S1, `fees-probe.py` section "CoinMarketCap exchange detail" |
| what it sells now | "USDT-margined perpetual futures contracts", long or short, leverage up to 100x, no expiry, by FAQ Q7 dated 2026-06-05 | S4, `fees-probe.py` section "notices" |
| page title | "COINSPACE - Crypto Futures Trading", and the only trading route of the web app is `/trade`, which loads the `FutureTradev1.5` chunk | S5, S6 |
| who may trade | KYC is required for any trading, deposit or withdrawal by FAQ Q2, and `GET api.coinspace.world/api/settings/kyc` answered `{"kycRequiredForTrading":true,"kycRequiredForDeposit":false}` | S4, `rest-probe.py` section 5 |
| regions excluded | Not publicly specified. The terms of service and risk disclosure name no excluded country, and only ask users to obey Costa Rican law and the law of their country of residence. | S7 |
| access from this host | every COINSPACE host answered from the Canadian exit, with no geoblock and no refusal | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| family | maker | taker | evidence |
|---|---|---|---|
| USDT-margined perpetuals, all 32 rows of the fee list | 0.02% (200 ppm), `open_place_fee` and `close_place_fee` | 0.04% (400 ppm), `open_market_fee` and `close_market_fee` | Published, S3, `fees-probe.py` section "fees" |

The fee list names "market" and "place" fees rather than taker and maker.
FAQ Q13 maps them: "Maker Fee: 0.02% Taker Fee: 0.04%", S4.
All 32 rows carry the same four values, `deposit_fee` "0" and `withdraw_fee` "5USDT", by `fees-probe.py` section "fees".
CoinMarketCap's own record shows `makerFee` 0.0 and `takerFee` 0.0, which is CoinMarketCap's default and not a venue number, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | yes, 6 tradable symbols in the web app catalog, 28 in the CoinMarketCap feed, 32 in the fee list | [`rest.md`](./rest.md) section 2 |
| USDC-margined perpetuals | no, every symbol in all three lists ends in USDT | `rest-probe.py` section 2 |
| coin-margined (inverse) perpetuals | no | `rest-probe.py` section 2 |
| dated futures | no, FAQ Q7 says "No expiry date" | S4 |
| options | no, no route or call in the web app bundle | S5 |
| spot | no, the web app has no spot route, although its Binance helpers can build spot URLs and CoinMarketCap files the 28 pairs under `category=spot` | S2, S5, S6 |
| deposit, withdrawal | 5 USDT withdrawal fee on every row of the fee list, and deposits are free, S3. Withdrawals are reviewed in 1 to 3 hours by FAQ Q5, S4. | S3, S4 |

## 4. Perpetual tiers

The web app reads a user tier, `userTier`, and calls `GET /api/membership/tiers`, S6.
That call answered 401 `{"statusCode":401,"message":"Unauthorized"}` without a login, by `fees-probe.py` section "membership".
So any tier table is Account-gated, and only the base 0.02% and 0.04% are published.

## 5. Discounts

| discount | value | evidence |
|---|---|---|
| token holding | Not offered. The fee list and the FAQ name no fee token, and every row shows the same rate. | S3, S4 |
| referral | Not publicly specified. The web app has referral codes and a sales hierarchy of headquarters, distributor, branch, office and referral agent, and its admin pages settle fee and PnL amounts to each level. | S8 |
| market maker | Not publicly specified | S1, S3 |
| zero fee promotion | Not offered on 2026-10-09, all 32 rows show 0.04% taker | S3 |

## 6. Funding as a cost

FAQ Q14 says the funding fee is "Dynamic, calculated every 8 hours based on the price difference between long and short positions", S4.
COINSPACE publishes no formula, cap, floor or settlement instant, and no public call returns a COINSPACE funding rate, see [`rest.md`](./rest.md) section 3.
The trade page shows the funding rate and countdown it reads from Binance's `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=<SYMBOL>`, S6.
The ledger types `FUNDING_FEE` exist in the user and admin views, so funding is charged, S6, S8.
Whether COINSPACE charges Binance's rate, on Binance's interval, is Not publicly specified.
Binance funds MASKUSDT and MTLUSDT every 4 hours, so FAQ Q14 and the trade page disagree on those two of the 28 relayed symbols, see [`rest.md`](./rest.md) section 4.
No settlement instant was captured.

## 7. Liquidation, settlement and delisting charges

FAQ Q9 says a "Liquidation Fee Rate (LFR) is applied based on total position value", and Q14 calls it "a fixed percentage", S4.
The percentage itself is Not publicly specified.
The ledger also has `LIQUIDATION_SHORTFALL`, labelled in Korean as unrecovered liquidation cost, S8.
The risk disclosure asks users to avoid "high-frequency or abnormal trades" and lets COINSPACE freeze or terminate accounts without notice, S7.
FAQ Q12 adds that profits may be forfeited for market manipulation or system abuse, S4.
That clause matters to any automated taker on this venue.

## 8. CCXT

COINSPACE has no class in CCXT 4.5.68.
The installed source directory, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, holds 104 `.js` files.
None is named after COINSPACE or COINIA, and no file there contains the string "coinspace".
The nearest names, `coinsph.js` and `coinspot.js`, are Coins.ph and CoinSpot, other venues.
CCXT master at commit f0aca06 of 2026-10-08 has no `ts/src/coinspace.ts` (HTTP 404), and `ts/ccxt.ts` there does not mention it.
So there is no `market.taker` to read and no `ccxtTakerPpm`.

## 9. Recommended registry values

None.
The venue is blocked as a perpetual leg, see [`websocket.md`](./websocket.md) section 8.
If it were ever added, `takerPpm` would be 400 from the fee list and FAQ Q13, and `ccxtTakerPpm` would not apply because there is no CCXT class.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinspace` | id 12144, launch date, COINIA SRL, fee URL, zero fee placeholders |
| S2 | `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinspace&category=spot` | 28 pairs filed as spot |
| S3 | `https://www.coinspace.world/proxy/api/v1/fees`, the fee URL CoinMarketCap lists | 32 rows, 0.04% market, 0.02% place, 5 USDT withdrawal |
| S4 | `https://api.coinspace.world/api/notices`, the FAQ the web app shows, 16 entries dated 2026-06-05 | products, KYC, fees, funding, liquidation |
| S5 | `https://www.coinspace.world/assets/index-fccd3ab2.js`, the web app entry bundle | routes, API base `https://api.coinspace.world/api`, Socket.IO client |
| S6 | `https://www.coinspace.world/assets/FutureTradev1.5-6fa4af21.js`, the trade page chunk, and `useSymbolConfig-4eea8fbc.js`, its Binance URL builder | Binance book, trade and funding URLs, tier call, ledger types |
| S7 | `https://www.coinspace.world/assets/RiskDisclosure-d8dcba7f.js` and `TermsOfService-25113b56.js` | legal entity, user commitments, forfeiture clauses |
| S8 | `https://www.coinspace.world/assets/AdminSettlementUserDetailPage-7e90ada4.js` and `SettlementTable-552d2f46.js` | ledger types and the sales hierarchy settlement |
| S9 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` and `https://github.com/ccxt/ccxt` at f0aca06 | no COINSPACE class |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/coinspace/fees-probe.py) | every probed fee number |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/coinspace/rest-probe.py) | KYC setting, catalog counts |
