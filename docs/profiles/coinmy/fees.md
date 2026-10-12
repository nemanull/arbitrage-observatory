# CoinMy Fees Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:36 to 05:00 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

This profile covers the trading fees of CoinMy, the exchange at `www.coinmy.com` that CoinMarketCap lists at rank 204.
The researched product is its USDT margined perpetuals, which the venue still lists but which have not traded since late August 2026, see [`websocket.md`](./websocket.md) section 4.
CoinMy runs on the ChainUp white label platform, in the same newer web stack as Aivora, see [`rest.md`](./rest.md) section 1.
It has no CCXT class, see section 8.
Source ids are shared with [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | a centralized exchange incorporated in the British Virgin Islands, launched on 19/10/2024, as CoinMarketCap's description says | S3 |
| licences claimed | a U.S. Money Services Business registration and branches in Dubai, Malaysia and Singapore, as CoinMarketCap's description says, not verified here | S3 |
| who may trade | the web config lists one restricted country code, `limitCountryList` `["156"]`, which is the ISO numeric code of China | P1 `catalog` |
| regions excluded | China by that code. No terms page was read, so any other exclusion is Not publicly specified here | P1 `catalog` |
| access from this host | every public call in these profiles answered from the Canadian exit, with one exception: the root page `https://www.coinmy.com/en-us` answered HTTP 403 with Cloudflare's "Suspected Misleading Website" interstitial, see [`rest.md`](./rest.md) section 1 | P1 `access` |

The Cloudflare interstitial says the site "has been reported for potentially misrepresenting itself as a particular brand or service" and that Cloudflare has not validated the claim.
It is a phishing warning on the domain, not a geoblock.
The probes did not click through it, and every other page and API host answered normally.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT margined perpetuals | 0.02 %, 200 ppm | 0.05 %, 500 ppm | the "Regular User" row of the futures fee table, P1 `fees` |

The futures fee table comes from `POST https://api.cmgatewayapi.com/spot/api/membership/get_level_fee_config_list` with body `{"type":2}`, the call behind the "My Futures Fees" table of the fee page S5.
Neither the futures catalog nor the socket carries a per contract fee, so the table is the only source.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT margined perpetuals | listed, 53 contracts, but no book and no trade since late August 2026 | the futures web list, P1 `catalog`, and the socket, P2 `futures` and `history` |
| USDC margined perpetuals | no | `marginCoinList` is `["USDT"]` and every row has `marginCoin` USDT, P1 `catalog` |
| coin margined perpetuals | no | every row has `contractSide` 1, linear, P1 `catalog` |
| dated futures | no | every row has `contractType` E, perpetual, and `deliveryKind` "0", P1 `catalog` |
| options | no | no options call or page was found in the web bundle or the documentation S1 |
| spot | yes, 29 USDT pairs, with live books on the three probed, BTC, ETH and SOL, and none on CM | the spot web list, P1 `catalog`, and the spot socket, P2 `spot` |
| TradFi contracts | 23 of the 53 perpetuals are stocks, pre-IPO names, an ETF, metals and oil, such as `E-AAPL-USDT`, `E-XAU-USDT` and `E-CL-USDT` | P1 `catalog` |
| margin | no spot margin pair, `is_open_lever` 0 on all 29 | P1 `catalog` |

## 4. Perpetual tiers

A user qualifies by 30 day futures volume in USDT or by total assets in USDT, joined by `rule` `|,|`, which the fee page labels "and/or", S5.
The page also says that "Meeting VIP criteria in any trading type automatically qualifies for the same VIP level across all types", S5.

| level | futures volume, USDT | or total assets, USDT | maker | taker |
|---|---|---|---|---|
| Regular User | under 1,000,000 | under 1,000 | 0.0200 %, 200 ppm | 0.0500 %, 500 ppm |
| VIP1 | 1,000,000 | 1,000 | 0.0180 %, 180 ppm | 0.0480 %, 480 ppm |
| VIP2 | 5,000,000 | 10,000 | 0.0160 %, 160 ppm | 0.0440 %, 440 ppm |
| VIP3 | 8,000,000 | 50,000 | 0.0140 %, 140 ppm | 0.0400 %, 400 ppm |
| VIP4 | 20,000,000 | 200,000 | 0.0120 %, 120 ppm | 0.0375 %, 375 ppm |
| VIP5 | 50,000,000 | 1,000,000 | 0.0100 %, 100 ppm | 0.0350 %, 350 ppm |
| VIP6 | 100,000,000 | 2,000,000 | 0.0080 %, 80 ppm | 0.0315 %, 315 ppm |
| VIP7 | 200,000,000 | 3,000,000 | 0.0060 %, 60 ppm | 0.0300 %, 300 ppm |

All rows are from P1 `fees`, `type` 2.
The volume window is not in the reply, and the page text says levels update "each day at 2:00", S5.

For the coverage matrix only, the spot table, `type` 1, starts at maker 0.08 %, 800 ppm, and taker 0.1 %, 1,000 ppm, for a Regular User, and ends at maker 0.01 % and taker 0.0325 % at VIP7, P1 `fees`.
The spot web list carries a per pair `quoteFeeRate` of 0.0008 on 28 pairs and 0.001 on CM/USDT, P1 `catalog`, and what that field charges is Not publicly specified.

## 5. Discounts

| discount | value | source |
|---|---|---|
| platform token | `platformRate` 0.5 with `platformOpen` 0, so a 50 % token discount is configured but switched off. The web config's `fee_coin_rate` is "50.00" | P1 `fees`, P1 `catalog` |
| referral | an "Invite Friends" programme exists on the fee page, and its rebate is Not publicly specified | S5 |
| market maker | Not publicly specified | none found |
| zero fee promotions | none found | P1 `fees` |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | 8 h on all 53 contracts, `capitalFrequency` 8 | P1 `catalog` |
| next settlement | `nextCapitalSettTime` is 2026-09-09 08:00 UTC on all 53, a month in the past at the time of the probe | P1 `catalog` |
| rates | the socket ticker carries `funding_rate_last` and `funding_rate_next`, which were equal on every contract seen, such as -0.0000358508539389 on BTC and -0.02 on JELLYJELLY | P2 `futures` |
| formula, cap and floor | Not publicly specified. The help centre the web config links, `https://futuresdoc.gitbook.io/help-center/v/en/`, was not read | P1 `catalog` |
| when and to whom | Not publicly specified | none found |

With no trade since late August and a settlement time that stopped on 2026-09-09, the funding fields look frozen, see [`rest.md`](./rest.md) section 4.

## 7. Liquidation, settlement and delisting charges

Not publicly specified.
The documentation S1 is a generic ChainUp page and names no liquidation fee, and no CoinMy page with one was found.

## 8. CCXT

CCXT 4.5.68 has no CoinMy class.
No `coinmy.js` exists in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and no file there mentions `coinmy` or `cmgatewayapi`, P3.
The current CCXT source on GitHub, `ts/src` at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08, has 103 files, and none is named after CoinMy, S6.
So `market.taker` has no CCXT value, and a catalog would come from the venue's own futures web list.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 500 | the VIP 0 futures taker, P1 `fees` |
| `ccxtTakerPpm` | none | no CCXT class |

The engine's ChainUp family adapter carries the taker in its `Profile`, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 35.
These values matter only if the perpetuals trade again, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | source | URL | retrieved | entity | used for |
|---|---|---|---|---|---|
| S1 | ChainUp white label open API documentation, English pages "Documentation description", "Futures Trading API" and "Spot Trading API", which CoinMarketCap links as CoinMy's API | https://exchangeopenapi.gitbook.io/pri-openapi/openapi-doc/futures-trading-api | 2026-10-09 | generic, hosts written as `openapi.xxx.com` | sections 3 and 7 |
| S3 | CoinMarketCap exchange page for CoinMy | https://coinmarketcap.com/exchanges/coinmy/ | 2026-10-09 | CoinMarketCap | section 1 |
| S5 | CoinMy fee page and its bundle, which posts `type` to the fee table call | https://www.coinmy.com/en-us/my-rate | 2026-10-09 | CoinMy | sections 2, 4 and 5 |
| S6 | CCXT `ts/src` listing | https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src | 2026-10-09 | CCXT | section 8 |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/coinmy/rest-probe.py) modes `access`, `catalog` and `fees` | [`rest-probe.py`](../../../scripts/probes/venues/coinmy/rest-probe.py) | 2026-10-10 UTC | this host, Canadian exit | sections 1 to 6 |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/coinmy/ws-probe.py) modes `futures`, `history` and `spot` | [`ws-probe.py`](../../../scripts/probes/venues/coinmy/ws-probe.py) | 2026-10-10 UTC | this host, Canadian exit | sections 3 and 6 |
| P3 | a search of the installed CCXT 4.5.68 sources for `coinmy` and `cmgatewayapi`, with no match | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` | 2026-10-09 | CCXT 4.5.68 | section 8 |
