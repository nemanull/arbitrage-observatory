# BlueBit Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:18 to 04:42 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

BlueBit (`bluebit.io`) advertises USD-M futures, but its futures product is switched off and its futures backend answers HTTP 502, so this profile covers its spot market, as change 1 of the survey plan's template says.
That market is 20 pairs, all quoted in USDT, see [`rest.md`](./rest.md) section 2.
The VIP 0 spot taker is 0.100 %, which is 1,000 ppm, on 18 of the 20 live pairs, read from the call the venue's own fee page makes.
BTC/USDT is at 0 and BLUESPARROW/USDT at 900 ppm.
The site is a ChainUP white-label build, recognisable by `/fePublicInfo`, `/fe-ex-api/` and `/fe-co-api/` paths and the `open/api` REST family.
The server already runs four ChainUP futures venues through one adapter, so a revived BlueBit futures product would likely be a fifth profile there, see [`websocket.md`](./websocket.md) section 8.
Numbers come from [`fees-probe.py`](../../../scripts/probes/venues/bluebit/fees-probe.py) unless a source id says otherwise.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | "owned and operated by BlueBit LTD and is headquartered in Saint Vincent and the Grenadines", per CoinMarketCap's venue description. The Terms of Service say they "are governed by the laws of Saint Vincent and the Grenadines". No company number was found. | Published | S3, S2 |
| restricted locations | "Belarus, Cuba, Democratic Republic of the Congo, Iran, Iraq, Mainland China, North Korea, Nigeria, Sudan, Syria, the United States, and Zimbabwe", a list the Terms call "not exhaustive" | Published | S2 |
| who may trade spot | an account holder outside the prohibited countries, with an API key made in the user center for API orders | Account-gated | S1 section "Generate an API Key", S2 |
| country block in the web config | `limitCountryList` is an empty list in both `fePublicInfo` and `fe-ex-api/common/public_info` | Probed | `fees-probe.py` |
| website from this host | `www.bluebit.io` served `/fePublicInfo` and the `/fe-ex-api/` calls with HTTP 200 and no challenge | Probed | `fees-probe.py` |
| public spot API from this host | every public `openapi.bluebit.io/open/api/` call answered HTTP 200 | Probed | [`rest.md`](./rest.md) section 1 |
| futures hosts from this host | `futures.bluebit.io` serves its web shell with HTTP 200, but every `/fe-co-api/` call and every `futuresopenapi.bluebit.io/fapi/v1/` call answered HTTP 502 "The page is temporarily unavailable" | Probed | [`rest.md`](./rest.md) section 3 |

The development host sits in the United States, which the Terms list as prohibited, while the Canadian exit is not on the list.
Reading public market data is not an account service, and no host refused it with a geoblock or a challenge.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, 18 of 20 live USDT pairs | 0.100 %, 1,000 ppm | 0.100 %, 1,000 ppm | Published | `fees-probe.py`, `POST /fe-ex-api/fee_info`, S4 |
| spot BTC/USDT | 0 %, 0 ppm | 0 %, 0 ppm | Published | same call, `btcusdt` row |
| spot BLUESPARROW/USDT | 0.090 %, 900 ppm | 0.090 %, 900 ppm | Published | same call, and the fee page text "Enjoy a generous 10% discount on fees for spot trading", S4 |
| USD-M futures | not live | not live | Not offered | the fee page loads it from `futures.bluebit.io/fe-co-api/common/getMakerAndTaker`, which answered HTTP 502, section 3 |

The same three rates appear as `quoteFeeRate` on every live symbol of `fePublicInfo`, and the probe found the two sources equal on all 20 symbols.
CoinMarketCap's description agrees: "The exchange charges a flat 0.10% maker and taker fee for spot trading", S3.
CoinMarketCap's record carries `makerFee` 0.02 and `takerFee` 0.05, which match its description's futures sentence, "For futures, the maker rates are 0.02%, and taker fees are 0.05%", and not the spot schedule, S3.
A BlueBit spot taker at 1,000 ppm costs twice Gate's 500 ppm perpetual taker, see [`../gate/fees.md`](../gate/fees.md) section 2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | advertised, not live | the fee page has a "USD-M Futures" tab and CoinMarketCap describes "perpetual swaps with up to 125X leverage", S3 and S4. The web config sets `contractOpen` to `"0"`, and every futures data call answered HTTP 502, [`rest.md`](./rest.md) section 3 |
| coin-margined perpetuals | not seen | no page or config names one |
| dated futures | not seen | CoinMarketCap's description says "futures trading and perpetual swaps", but no futures call answers, so no contract list could be read |
| options | no | no page, config or bundle names options |
| spot order book | yes, 20 USDT pairs | [`rest.md`](./rest.md) section 2 |
| margin | switched on, not detailed | `lever_open` is `"1"` and `is_open_lever` is 1 on some symbols, such as BTC/USDT and ETH/USDT, in `fePublicInfo`, `fees-probe.py` |
| OTC and P2P | switched on, not detailed | `otcOpen` is `"1"` in `fe-ex-api/common/public_info`, `fees-probe.py` |
| staking, IEO, NFT marketplace | named on the site, not detailed | the footer links of the site bundle, S4 |
| deposits and withdrawals | deposits free, withdrawals a flat fee per coin from `POST /fe-ex-api/coins_fee`, not detailed | S4 |

Three outside checks agree that no BlueBit perpetual is live.
CoinMarketCap's pair list for BlueBit holds 20 pairs, all of category `spot`, S3.
CoinGecko's derivatives venue list holds 216 venues and none named BlueBit, S5.
CCXT has no BlueBit class, section 8.

## 4. Spot tiers

`POST https://www.bluebit.io/fe-ex-api/fee_info` returns `pairMapList`, one row per pair with `TRADE_MAKER_VIP0` and `TRADE_TAKER_VIP0` as fractions, S4.
No other VIP key appears in any of its 492 rows, so no tier above VIP 0 is published.
The 492 rows include pairs that are not listed for trading.
Among them, 484 rows carry 1,000 ppm on both sides, one carries 900 ppm (`bluesparrowusdt`), one carries 0 (`btcusdt`), and six carry no fee at all: `bluesparroweth`, `musdtusdt` and four `test11` pairs.
The fee page filters the table to the live symbols before it renders, per the `calFeeList` function of its bundle, S4.

## 5. Discounts that change the spot taker

| discount | effect | label | evidence |
|---|---|---|---|
| BLUESPARROW/USDT | 10 % off, 900 ppm | Published | S4 page text and `fee_info` |
| BlueSparrow paired with BTC or ETH | the page says "Experience fee-free transactions" for BlueSparrow/BTC and BlueSparrow/ETH. Neither pair is listed for trading, and `fee_info` gives `bluesparrowbtc` 1,000 ppm and `bluesparroweth` no fee at all | Published, not live | S4 |
| BlueSparrow holding | the token page says holders get "a discount of 10% on trading fees" | Published | S4, token page bundle |
| BTC/USDT at 0 | `fee_info` and `quoteFeeRate` both give 0, and no page names it a promotion or gives an end date | Probed | `fees-probe.py` |
| referral, market maker | `is_invite_open` and `agentUserOpen` are `"0"` in the web config. No market maker programme was found | Not publicly specified | `fees-probe.py` |

## 6. Funding as a cost

Not offered.
Spot carries no funding, and the futures product that would carry it does not answer, see section 3.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement charge.
No delisting charge is published.
Margin liquidation is out of scope for a spot profile.

## 8. CCXT

BlueBit has no class in CCXT 4.5.68.
The installed `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 `.js` files, none named `bluebit.js`, and none of them contains the string "bluebit", `fees-probe.py`.
The current CCXT source on GitHub, master at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08, holds 103 `.ts` files in `ts/src`, and none has "blue" in its name, S6.
So `market.taker` cannot be read from CCXT, and a catalog would come from the venue's own `common/symbols` call.

## 9. Recommended registry values

None, because BlueBit offers no live perpetual and the engine runs perpetual legs only.
If a spot leg is added later, `takerPpm` is 1,000 for every live pair except BTC/USDT at 0 and BLUESPARROW/USDT at 900, so a per-pair override is needed.
`ccxtTakerPpm` has no value, since there is no CCXT class.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | BlueBit API document, `https://github.com/bluebitltd/bluebitfile/blob/main/api_doc_en.md`, last commit `81e6c9f` of 2023-10-08, linked as "API" from the site footer | 2026-10-09 |
| S2 | Terms of Service text in the site bundle `https://www.bluebit.io/js/chunk-5164956a.2878b75f.js`, page `/en_US/footerPage/termsOfService` | 2026-10-09 |
| S3 | CoinMarketCap venue page, `https://coinmarketcap.com/exchanges/bluebit/`, its description, its `makerFee` and `takerFee` fields and its pair list | 2026-10-09 |
| S4 | Fee page `/en_US/footerPage/fees`, rendered by the bundle `https://www.bluebit.io/js/chunk-7664aa22.191f37b0.js`, which calls `POST /fe-ex-api/fee_info`, `coins_fee` and `borrow_rule` and `GET https://futures.bluebit.io/fe-co-api/common/getMakerAndTaker`. The token page is in `https://www.bluebit.io/js/chunk-06bca967.869b5483.js` | 2026-10-09 |
| S5 | CoinGecko derivatives venue list, `https://api.coingecko.com/api/v3/derivatives/exchanges/list` | 2026-10-09 |
| S6 | CCXT `ts/src` listing at master, `https://api.github.com/repos/ccxt/ccxt/contents/ts/src` | 2026-10-09 |
