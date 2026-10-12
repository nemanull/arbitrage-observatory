# Binibit Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:58 to 04:17 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit in Canada.

This profile covers Binibit's "CEX Futures" perpetuals (CoinMarketCap rank 210, no CCXT id), because the site lists 27 USDT perpetual contracts, see section 3.
Those perpetuals are a read-only preview.
The futures terminal says "READ-ONLY PREVIEW", "No execution" and "Trading disabled", and it tells a guest to "continue when Futures trading is enabled", S2.
So every futures fee below is a configured value on a product that takes no orders today.
Every number comes from [`fees-probe.py`](../../../scripts/probes/venues/binibit/fees-probe.py) or [`rest-probe.py`](../../../scripts/probes/venues/binibit/rest-probe.py), unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | source |
|---|---|---|---|
| retrieval date | 2026-10-09 | | S1 to S11 |
| legal entity | Binibit S.A., Panama, Mercantile Folio No. 155781130, Global Bank Tower, Panama City | Published | S6 |
| terms in force | Terms of Service version 1.1, effective 1 September 2026 | Published | S6 |
| who may trade | adults of 18 or more who are not a Restricted Person | Published | S6 section 2.1 |
| regions excluded | the United States and "any other country or territory we designate as restricted", and sanctioned persons | Published | S6 sections 2.2 and Definitions |
| restricted list | not published, and section 2.3 says Binibit maintains it and may update it at any time | Not publicly specified | S6 |
| Canada | not named as restricted on either legal page | Not publicly specified | S6 |
| launch | 2025-11-14 by CoinMarketCap | Published | S7 |
| futures trading | disabled, the terminal is a read-only preview called stage "F1.5" in the bundle | Probed | S2, S3 |
| access from the Canadian exit | every public call answered, with no geoblock and no refusal | Probed | [`rest-probe.py`](../../../scripts/probes/venues/binibit/rest-probe.py) `host`, `errors` |

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | source |
|---|---|---|---|---|
| USDT perpetuals, all 27 contracts | 0.20 %, 2000 ppm | 0.50 %, 5000 ppm | Probed, configured but not chargeable while trading is disabled | S1 |
| spot, every pair | 0.10 %, 1000 ppm | 0.10 %, 1000 ppm | Probed and Published | S5, S7 |

- Each row of the contracts call carries `"makerFeeRate":"0.002"` and `"takerFeeRate":"0.005"`, the same on all 27 contracts, S1.
- The rates are fractions of notional.
  The terminal's order preview computes `fee = notional * rate` in the function that returns `{quantity, notional, initialMargin, fee, requiredMargin}`, S2.
- No published futures fee schedule exists.
  The `/en/fees` page names only "Spot trading fees" and "Withdrawal fees", S4.
- The spot rate is `dealBid` 0.1 and `dealAsk` 0.1, in percent, on all 118 pair-level trade rows of the commissions call the web app reads, S5.
  CoinMarketCap's description says "a flat 0.10% maker and 0.10% taker fee across all spot pairs", S7.
  CoinMarketCap's own `makerFee` and `takerFee` fields are 0, which are unfilled fields rather than a zero fee, S7.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT-margined perpetuals | listed, 27 contracts, all `isActive` true, trading disabled | S1, S2, [`rest.md`](./rest.md) section 2 |
| USDC-margined perpetuals | no | every contract's `quoteCurrency` is USDT, and `/settings` lists `availableAccountCurrencies` USDT only, S1 |
| coin-margined perpetuals | no | every contract has `contractValue` 1 and quote USDT, S1 |
| dated futures | no | no route, call or contract type in the bundle, S2 |
| options | no | no route or call in the bundle, S2 |
| spot | yes, 94 pairs on CoinMarketCap and 118 pair-level fee rows | S8, S5 |
| copy trading | menu entry "Discover and follow Futures traders" | S4 |
| DEX futures | "SOON" in the menu | S4 |

CoinMarketCap lists 0 perpetual and 0 futures pairs for Binibit, S8.
Its description says Binibit "does not support ... derivatives, futures, options, margin trading", S7.
The site disagrees, because its menu offers "CEX Futures ×100" as "Perpetual contracts" with a "NEW" badge, S4.
The two agree in practice, since the futures terminal accepts no orders, S2.

The preview's market data is Bybit's linear market passed through.
The book mostly carried Bybit's best bid and ask prices in the same second, and the funding window and next settlement matched Bybit's on every contract but one whose fields went stale, [`rest.md`](./rest.md) sections 4 and 5.

## 4. Perpetual tiers

None published.
Every contract carries the same two rates, S1, and no VIP table, volume rule or tier call appears in the bundle, S2.

## 5. Discounts that change the perpetual taker

None published for futures.
The spot commissions call carries `dealBidDiscountFraction` 0.0 and `dealAskDiscountFraction` 0.0, S5.
No BINI token fee discount appears on the fee page, S4.

## 6. Funding as a cost

- Nothing is charged, because no position can be opened while trading is disabled, S2.
- The contracts call carries `fundingRate`, `fundingStartsAt` and `fundingFinishesAt` per contract, S1.
  The window is 8 hours on 26 contracts and 4 hours on ONDOUSDT, the same as Bybit's interval for each, [`rest.md`](./rest.md) section 4.
- No funding formula, cap, floor or payer rule is published, and the docs at docs.binibit.com cover only the spot API, S11.

## 7. Liquidation, settlement and delisting

Not publicly specified for futures, and moot while trading is disabled.
Withdrawal fees are on the `/en/fees` page, loaded in the browser, S4.

## 8. CCXT

- CCXT 4.5.68 has no Binibit class.
  `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 `.js` files and no `binibit.js`, and a case-insensitive search for "binibit" over that folder matched no file, S9.
- The current CCXT source on GitHub has none either, S10.
  Master was at commit `f0aca06eb7` of 2026-10-08, version 4.5.85, and `ts/src/binibit.ts` returned 404, and no file name in `ts/src/` contains "bini".
- So `market.taker` has no CCXT value to compare.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 5000, if futures trading opens with the configured rate | `takerFeeRate` 0.005 on all 27 contracts, S1 |
| `ccxtTakerPpm` | none | no CCXT class, section 8 |

Binibit is not recommended as an engine venue today.
Its perpetuals take no orders, and their book and funding are Bybit's passed through with a delay, so a Binibit leg would add no price that a Bybit leg does not already carry.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | futures contracts call, `https://binibit.com/api/futures-public/contracts`, and `/api/futures-public/settings` | 2026-10-09 |
| S2 | futures page chunk, `https://binibit.com/_next/static/chunks/app/futures/%5Bpair%5D/page-536bcc3f24210dec.js` | 2026-10-09 |
| S3 | futures page, `https://binibit.com/en/futures/BTC_USDT` | 2026-10-09 |
| S4 | fee page and site menu, `https://binibit.com/en/fees` | 2026-10-09 |
| S5 | spot commissions call the web app reads, `https://internal-api-v2stage.binibit.com/api/currency-pairs/commissions` | 2026-10-09 |
| S6 | Terms of Service `https://binibit.com/en/legal/terms` and Prohibited Use `https://binibit.com/en/legal/prohibited-use` | 2026-10-09 |
| S7 | CoinMarketCap exchange detail, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=binibit` | 2026-10-09 |
| S8 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=binibit&category=spot` and the same with `perpetual` and `futures` | 2026-10-09 |
| S9 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, searched for "binibit" | 2026-10-09 |
| S10 | `https://github.com/ccxt/ccxt`, master `package.json` and `ts/src/` | 2026-10-09 |
| S11 | Binibit API docs, `https://docs.binibit.com/llms.txt` and the pages it lists | 2026-10-09 |
