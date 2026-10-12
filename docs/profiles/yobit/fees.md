# YoBit Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, evening in Seattle (2026-10-10 03:43 to 04:07 UTC), from the development host near Seattle through the user's Surfshark WireGuard exit in Canada.

YoBit lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template asks.
YoBit has no CCXT 4.5.68 class, because CCXT delisted it on 2026-06-11, section 8.
The fee numbers come from the documented public calls `GET /api/3/info` and `GET /api/2/<pair>/fee`, read by [`rest-probe.py`](../../../scripts/probes/venues/yobit/rest-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | Not publicly specified. The rules page names only "Yobit.net Cryptocurrency Stock Exchange" and its "Stock Exchange Owners". CCXT's last class gave the country as RU. | Not publicly specified | S2, S7 line 22 |
| restricted locations | No list was found. The rules page makes each user responsible for the law of the country they live in. | Not publicly specified | S2 |
| who may trade spot | Any account holder, by the rules page. | Published | S2 |
| website from this exit | `https://yobit.net/` answered HTTP 302 to `/en/`, and `/en/`, `/en/api/`, `/en/fees/` and `/en/trade/BTC/USDT` answered 200, all behind DDoS-Guard. | Probed | [`rest-probe.py`](../../../scripts/probes/venues/yobit/rest-probe.py) section "Site access" |
| public API from this exit | Every documented public call answered 200 with JSON. No challenge page and no geoblock were seen. | Probed | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, every pair | 0.2%, 2000 ppm | 0.2%, 2000 ppm | Published, Probed | `fee`, `fee_buyer` and `fee_seller` are 0.2 on all 9033 pairs of `GET /api/3/info`, and `GET /api/2/btc_usdt/fee` answers `{"trade":0.2,"fee_buyer":0.2,"fee_seller":0.2}` |
| perpetuals | Not offered | Not offered | Not offered | section 3 |

The API page defines `fee` as the "pair commission", in percent, S1.
YoBit splits the fee by buyer and seller, not by maker and taker, and both are 0.2 on every pair, so maker and taker are the same 0.2%.
The signed-out trade page carries the same rate as `var fee_buyer = 0.00200000` and `var fee_seller = 0.00200000`, [`bundle-probe.py`](../../../scripts/probes/venues/yobit/bundle-probe.py).

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| perpetuals | no | The API page documents only spot methods, S1. The site's top menu is YoFarm, Trade, Market, InvestBox, Wallets and Support, and `/en/futures/` answers HTTP 404, [`rest-probe.py`](../../../scripts/probes/venues/yobit/rest-probe.py) sections "Site access" and "Coverage". CoinGecko's derivatives exchange list of 216 venues has no YoBit row, S9. CCXT's last class declared `swap` and `future` false, S7 lines 30 and 31. |
| dated futures | no | same evidence as perpetuals |
| options | no | same evidence as perpetuals |
| margin | no | no margin page or API method, and CCXT's last class declared `margin` false, S7 line 29 |
| spot | yes, 9033 pairs, none hidden | `GET /api/3/info`, [`rest.md`](./rest.md) section 2 |
| DeFi swap pools | yes, a separate AMM with its own 0.3% pool fee | `GET /api/defi/info` answers `"fee":"0.003"` per pool, S1, out of scope here |

Pair names such as "Futures Coin" (`FC/BTC`) and "LeverageCoin" (`LVG/BTC`) on the market page are spot tokens, not derivatives.

## 4. Spot tiers

None published.
The API page, the rules page and the fees page name no volume tier or VIP level, S1 to S3.
The fees page lists only deposit and withdrawal charges, S3.
Every pair carries the same 0.2 in `GET /api/3/info`, so there is no per-pair schedule either.

## 5. Discounts

None found.
The pages read name no token holding discount, referral rebate on trading fees, market maker program or zero fee promotion.
That is Not publicly specified rather than proven absent.

## 6. Funding as a cost

Not offered, because YoBit lists no perpetuals.

## 7. Liquidation, settlement and delisting charges

Not offered for liquidation and settlement, because there is no leveraged product.
The rules page says that when a coin is disabled, a user may request withdrawal within 14 days if its blockchain still works, S2.
No delisting fee is named.
Deposit and withdrawal charges sit on the fees page, `https://yobit.net/en/fees/`, S3, and are not recorded here.

## 8. CCXT

CCXT 4.5.68 has no YoBit class.
No file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` has "yobit" in its name, and `grep -rli yobit` over that folder matched nothing, on 2026-10-09.
The current CCXT source has none either: the listing of `ts/src` at master commit f0aca06 (2026-10-08) holds no name containing "yob", S8.
CCXT removed the class in commit 9ca9645 on 2026-06-11, pull request 28845 "delist yobit", whose body says "very little volume" and "very likely spoofing volume on some pairs", S6.

The last class before the removal, `ts/src/yobit.ts` at commit 3153a5c, S7, would have reported this for a spot market without credentials:

- `fees.trading.maker` and `fees.trading.taker` 0.002 at lines 165 and 166.
- Per market, `taker` and `maker` set from the pair's `fee` divided by 100 at lines 487, 488, 509 and 510, which gives 0.002 from today's `GET /api/3/info`.
- `swap` false, `future` false and `ws` false at lines 30, 31 and 129, and `rateLimit` 2000 at line 23.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 2000 | 0.2 percent on every spot pair, from `GET /api/3/info` and `GET /api/2/<pair>/fee` |
| `ccxtTakerPpm` | none | no CCXT 4.5.68 class exists |

These are spot values for the record.
YoBit has no perpetual, so the engine has no perpetual leg to register.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | [YoBit API page](https://yobit.net/en/api/), Public API v2 and v3, Trade API and DeFi Public API | 2026-10-09 |
| S2 | [YoBit rules](https://yobit.net/en/rules/), sections 1 to 9, including "Rules of use of Public API and Trade API" | 2026-10-09 |
| S3 | [YoBit fees page](https://yobit.net/en/fees/), deposit and withdrawal charges only | 2026-10-09 |
| S4 | [YoBit trade page for BTC/USDT](https://yobit.net/en/trade/BTC/USDT), with its `pair_id`, `fee_buyer` and `fee_seller` variables | 2026-10-09 |
| S5 | [YoBit web socket script](https://yobit.net/js/corews.js), obfuscated, decoded by [`bundle-probe.py`](../../../scripts/probes/venues/yobit/bundle-probe.py) | 2026-10-09 |
| S6 | [CCXT pull request 28845, "delist yobit"](https://github.com/ccxt/ccxt/pull/28845), merged 2026-06-11 as commit 9ca96451d7b379cea1e997350be847167bdcb893 | 2026-10-09 |
| S7 | [CCXT `ts/src/yobit.ts` at commit 3153a5c](https://github.com/ccxt/ccxt/blob/3153a5cc8023995353f7502a7593d1af93cb7dd4/ts/src/yobit.ts), the last version before the removal | 2026-10-09 |
| S8 | [CCXT `ts/src` on master](https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src), commit f0aca06 | 2026-10-09 |
| S9 | [CoinGecko derivatives exchange list](https://api.coingecko.com/api/v3/derivatives/exchanges/list), read by [`rest-probe.py`](../../../scripts/probes/venues/yobit/rest-probe.py) section "Coverage" | 2026-10-09 |
