# FOBLGATE Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:05 to 05:26 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers spot trading on FOBLGATE (CoinMarketCap rank 232, no CCXT id), because FOBLGATE lists no perpetual, see section 3.
It follows change 1 of the template in [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), so it records the spot VIP 0 fee.
FOBLGATE has no fee table of its own and publishes no API documentation.
Its fee page lists the `orderFee` field of the public market list call for every listed pair, so the fee is set per pair, S3.
Every number below was read by [`fees-probe.py`](../../../scripts/probes/venues/foblgate/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | source |
|---|---|---|---|
| retrieval date | 2026-10-09 | | S1 to S8 |
| legal entity | 주식회사 포블게이트, "FOBLGATE Co., Ltd." in the English footer | Published | S2 |
| who may trade | a Korean exchange with a Korean UI, Korean identity checks and KRW deposit limits, whose bundle carries both "외국인 회원은 이용하실수 없습니다." ("foreign members cannot use this") and a separate global member signup for foreigners | Region-specific | S2 |
| KRW market | none listed, and the fee page marks KRW deposit and withdrawal as "(원화 마켓 오픈 시 지원 예정)", planned for when a KRW market opens | Published | S3, S5 |
| access from the Canadian exit | the site, the market data calls and the stream all answered, with no geoblock, see [`rest.md`](./rest.md) section 1 | Probed | S5 |

## 2. Quick answer

FOBLGATE charges one fee per pair, the same on both sides of a trade, with no maker and taker split.
The trade page labels it "수수료(부가세 포함)", the fee including VAT, S4.

| pair group | fee | ppm | pairs | label |
|---|---|---|---|---|
| BTC/USDT, ETH/USDT, XRP/USDT, BNB/USDT, TRUMP/USDT, MELANIA/USDT | 0.04 % | 400 | 6 | Probed |
| APEPE/USDT, HYPE/USDT, XP/USDT | 0.1 % | 1000 | 3 | Probed |
| AIR/USDT, TTC/USDT | 0.2 % | 2000 | 2 | Probed |
| 37 of the 38 BTC pairs, every one but ROBO/BTC, and ZEUS, MOBIS, CONUT and five other USDT pairs | 0.25 % | 2500 | 45 | Probed |
| ROBO/BTC | 0 % | 0 | 1 | Probed |

The counts cover the 57 pairs with `listUse` ON out of 59 rows, S5.
The VIP 0 taker on BTC/USDT, the pair the engine would compare, is 400 ppm.
The three busiest pairs by 24 h value, ZEUS/USDT, MOBIS/USDT and CONUT/USDT, charge 2500 ppm.

## 3. Coverage matrix

| product | present | how established |
|---|---|---|
| USDT perpetual | no | CoinMarketCap lists 0 perpetual pairs, S8, the market list holds only spot pairs, S5, and the bundle's only futures-like words are "선물", which here means "gift" in a referral promotion, S2 |
| coin-margined perpetual | no | as above |
| dated futures | no | CoinMarketCap lists 0 futures pairs, S8 |
| options | no | no options route, call or word in the bundle, S2 |
| spot | yes | 59 pairs, 38 quoted in BTC and 21 in USDT, see [`rest.md`](./rest.md) section 2 |

## 4. Spot tiers

FOBLGATE publishes no volume tiers.
The fee page has three tabs, trading fees, withdrawal fees and deposit and withdrawal limits, and the trading tab shows only the per pair `orderFee`, S3.
The limits tab's levels are security levels for withdrawals, not fee tiers, S3.

## 5. Discounts that change the spot taker

| discount | rule | label | source |
|---|---|---|---|
| membership | a member whose `membershipType` is `PRIVATE` or `FOUNDATION` sees "수수료 할인율" with a `membershipDiscountRate`, and the order form computes the fee as `orderFee/100 * (1 - rate)` | Account-gated | S4 |
| token holding | none found | Not publicly specified | S2 |
| referral | the bundle carries a referral promotion of 2,000 KRW and a 0.0002 BTC gift, with no fee discount | Published | S2 |
| zero fee promotion | ROBO/BTC carries `orderFee` 0, with no end date in the reply | Probed | S5 |

## 6. Funding as a cost

Not offered.
FOBLGATE lists no perpetual, so it charges no funding.

## 7. Liquidation, settlement and delisting

Not offered for liquidation and settlement, because there is no margin product.
The market list carries a `delistingDt` field, and it was empty on all 59 rows, S5.
Two rows are switched off, `MAKE/USDT` with trading off and `TEST/USDT` with every flag off, see [`rest.md`](./rest.md) section 2.

## 8. CCXT

FOBLGATE has no class in CCXT 4.5.68.
No file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` contains "fobl", and `js/ccxt.js` does not name it, S6.
The current CCXT master, commit `f0aca06e` of 2026-10-08, has no `ts/src/foblgate.ts`, which returned HTTP 404, and `ts/ccxt.ts` does not contain "fobl", S7.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 400 | the BTC/USDT `orderFee` of 0.04 %, S5, with 2500 for the long tail of pairs |
| `ccxtTakerPpm` | none | no CCXT class, section 8 |

FOBLGATE is not recommended as an engine venue.
It has no perpetual, and its spot books did not change once during the probe, see [`rest.md`](./rest.md) section 5.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | site HTML, `https://www.foblgate.com/` | 2026-10-09 |
| S2 | web bundle `https://www.foblgate.com/assets/index-CLQxZdIW.js` | 2026-10-09 |
| S3 | fee page chunk `https://www.foblgate.com/assets/FeesPage-CGKnHVZp.js` | 2026-10-09 |
| S4 | trade page chunk `https://www.foblgate.com/assets/TradePage-Bkv6Mtpc.js` | 2026-10-09 |
| S5 | `POST https://api2.foblgate.com/ticker/marketList`, read by [`fees-probe.py`](../../../scripts/probes/venues/foblgate/fees-probe.py) mode `fees` and [`rest-probe.py`](../../../scripts/probes/venues/foblgate/rest-probe.py) mode `catalog` | 2026-10-09 |
| S6 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` and `js/ccxt.js`, searched for "fobl" | 2026-10-09 |
| S7 | `https://github.com/ccxt/ccxt`, master `ts/ccxt.ts` and `ts/src/foblgate.ts` | 2026-10-09 |
| S8 | CoinMarketCap market pairs, `https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=foblgate&category=spot` and the same with `perpetual` and `futures`, and the exchange detail `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=foblgate`, which gives `makerFee` 0 and `takerFee` 0 as placeholders | 2026-10-09 |
