# AEGET Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:53 to 03:10 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers USDT-margined perpetual trading on AEGET, which has no CCXT class, see section 8.
Spot, event contracts and everything else are named once in the coverage matrix.
Every number carries a source id from section 10 or a probe reference.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/aeget/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/aeget/rest-probe.py).
The REST and socket details are in [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

- AEGET says it was founded in 2023, is headquartered in the United States and holds a US MSB registration, S7.
  CoinMarketCap lists it with launch date 2023-10-18 and country `KR`, S8.
- No legal entity is named in the User Agreement, which calls the operator "AEGET" throughout, S6.
- The User Agreement says it is concluded under the laws of Canada, S6.
- It bars residents of Hong Kong (China), Cuba, Iran, North Korea, Crimea, Sudan, Malaysia, Syria, the United States, Puerto Rico, American Samoa, Guam and the Northern Mariana Islands, S6.
  The same sentence ends with "entering into contracts at Deception", which looks like a template left over from another venue.
- So US residents may not trade, although the venue says it is headquartered in the United States.
  Canada is not on the list.
- The help center has no API, VIP or WebSocket article.
  Its search returned 2 hits for "API", the Chinese privacy policy and glossary, and 0 hits for "VIP" and "websocket", in `fees-probe.py`.
- The fee pages were last updated between 2025-07-02 and 2025-08-03, S1 to S3.
  The live catalog agrees with them on 2026-10-10, see section 2.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.04 %, 400 ppm | 0.04 %, 400 ppm | S1, S2, and `makerFee` and `takerFee` `"0.0004"` on 241 of 241 perpetual rows in `fees-probe.py` |

CoinMarketCap's exchange record reads `makerFee 0.0004` and `takerFee 0.0004`, S8.
The fee is "Position Value × Fee Rate" on both opening and closing, S2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes, 240 trading and 1 halted | `symbol/list` in `rest-probe.py`, see [`rest.md`](./rest.md) section 2 |
| USDC-M perpetuals | no | every catalog row has quote `usdt` |
| coin-M perpetuals | no | the `/futures/dapi` symbol list returned 0 rows |
| event contracts | yes, `btcevent_usdt` and `ethevent_usdt` | catalog rows with `contractType` `EVENT`, not detailed |
| dated futures | no | no other `contractType` in the catalog |
| options | no | none found in the web app or the help center |
| spot | yes, 55 USDT pairs at 0 maker and 0 taker | S3 says "Spot trading is currently fee-free", and `/pro/p/symbol/list` returned 55 rows, all with `makerFee` and `takerFee` `"0"` |

The perpetual list includes US stocks such as `nvda_usdt` and `tsla_usdt`, metals such as `xau_usdt` and `xag_usdt`, and Korean and Hong Kong names such as `samsung_usdt` and `hk1810_usdt`.
Withdrawal fees are on the help center article 53374330723225, titled 平台提币网络支持范围及手续费标准, and are not recorded here.

## 4. Perpetual tiers

There is no published tier table.
S1 and S2 give one flat rate for every listed pair, 0.04 % maker and 0.04 % taker.
S2 lists 143 contracts, all at `0.0004` taker and `0.0004` maker, 2 with leverage up to 200 and 141 up to 150, in `fees-probe.py`.
S1 lists 61 pairs, all at "0.04% / 0.04%".
The help center search for "VIP" returned nothing.
The web bundle has user calls named `/v1/user/step-rate/getStepRates` and `userStepApply`, S10, which suggests a private fee tier application.
Those calls need a login and were not probed.
Not publicly specified.

## 5. Discounts that change the perpetual taker

- No token discount and no published referral discount was found.
- The help center runs promotions that refund fees or pay rebates, such as a 10 % trading rebate for the Mid-Autumn festival and loss subsidies on perpetuals, found by the help center search for fee terms on 2026-10-09.
  They are time limited campaigns and do not change the base rate.
- No market maker programme was found.

## 6. Funding as a cost

- Funding settles every 8 hours at 08:00, 16:00 and 00:00 UTC+8, S4.
  That is 00:00, 08:00 and 16:00 UTC.
- A positive rate means longs pay shorts, a negative rate means shorts pay longs, and only positions held at the timestamp pay or receive, S4.
- The glossary defines the funding rate as "paid/received every 8 hours" and names a premium index, weighted bid and ask prices and an impact depth, S5.
- No formula, cap or floor is published.
- The live funding call returned `fundingRate`, `collectionInterval` and `nextCollectionTime` all `null` on 5 of 5 contracts, and the funding history was empty on each, in `rest-probe.py`.
  So the current rate and the next settlement cannot be read from the public API, see [`rest.md`](./rest.md) section 3.
- No settlement instant was captured.

## 7. Liquidation, settlement and delisting

- Maintenance margin is tiered by leverage, from 0.25 % at 200x to 50 % at 1x for the 200x contracts, and from 0.40 % at 150x to 50 % at 1x for the 150x contracts, S1.
- The catalog's `liquidationFee` is `"0"` on 237 rows, `"0.0001"` on 5 rows including `btc_usdt`, and `"0.015"` on 1 row, in `rest-probe.py`.
  No help center page explains that field.
- There is no expiry settlement, because there are no dated futures.
- Delistings are announced in the help center, such as "[Contract Delisting] MYROUSDT and Other Contract Trading Pairs".
  No delisting fee was found.

## 8. CCXT

- CCXT 4.5.68 has no AEGET class.
  There is no `aeget.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and no file there contains the string `aeget`.
- The current CCXT source has no class either.
  The listing of `ts/src` at master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08 holds 110 entries and none starts with `ae` or names AEGET, S11.
- So there is no `market.taker` to read, and the catalog would come from the venue's own `symbol/list`.

## 9. Recommended registry values

- `takerPpm`: 400, from S1, S2 and the live catalog.
- `ccxtTakerPpm`: none, because there is no CCXT class.
  The registry shape assumes a CCXT class, so an adapter would set the fee from the catalog's `takerFee` instead.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [AEGET Platform Fee Schedule](https://support.aeget.com/hc/en-001/articles/46899657787417-AEGET-Platform-Fee-Schedule), updated 2025-07-02 | 2026-10-09, through the help center API at `aeget25doc.com` |
| S2 | [AEGET Perpetual Contract Parameters & Fees](https://support.aeget.com/hc/en-001/articles/46934316427417-AEGET-Perpetual-Contract-Parameters-Fees), updated 2025-07-05 | 2026-10-09 |
| S3 | [Spot Trading Parameters and Fee Structure](https://support.aeget.com/hc/en-001/articles/47058256228377-Spot-Trading-Parameters-and-Fee-Structure), updated 2025-08-03 | 2026-10-09 |
| S4 | [AEGET Perpetual Contract Essentials Guide](https://support.aeget.com/hc/en-001/articles/46912814315929-AEGET-Perpetual-Contract-Essentials-Guide), updated 2025-07-05 | 2026-10-09 |
| S5 | [Perpetual Contract Trading Glossary](https://support.aeget.com/hc/en-001/articles/46956795338649-Perpetual-Contract-Trading-Glossary), updated 2025-07-05 | 2026-10-09 |
| S6 | [User Agreement](https://support.aeget.com/hc/en-001/articles/46862688860697-User-Agreement), updated 2026-05-12 | 2026-10-09 |
| S7 | [Who We Are](https://support.aeget.com/hc/en-001/articles/46900974126489-Who-We-Are), updated 2026-05-08 | 2026-10-09 |
| S8 | CoinMarketCap exchange record, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=aeget` | 2026-10-09, in `fees-probe.py` |
| S9 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=aeget` | 2026-10-09, in `rest-probe.py` |
| S10 | AEGET web bundle `https://aeget.io/static/js/main.2cc29413.chunk.js` | 2026-10-09 |
| S11 | [CCXT `ts/src` at `f0aca06`](https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src) | 2026-10-09 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/aeget/fees-probe.py) | 2026-10-10 UTC |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/aeget/rest-probe.py) | 2026-10-10 UTC |
