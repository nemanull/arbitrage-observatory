# Metal X Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:49 to 05:11 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Metal X is the order book DEX of the XPR Network, run by Metallicus, and it lists no perpetuals, so this profile covers its spot market, as change 1 of the survey plan's template says.
That market is 18 spot pairs of wrapped tokens on the XPR chain, 14 of them quoted in XMD, see [`rest.md`](./rest.md) section 2.
The VIP 0 spot taker is 0.10 %, which is 1,000 ppm, and the XBTC_XMD pair charges nothing.
CCXT has no Metal X class, neither in 4.5.68 nor on the current master.
Fee and coverage numbers come from [`fees-probe.py`](../../../scripts/probes/venues/metal-x/fees-probe.py) unless a source id says otherwise.
Run 1 is the first run and run 2 is the second pass.

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | "Metal X may be made available by Metallicus to you", in addition to the WebAuth.com and Metallicus, Inc. terms | Published | S3 |
| what it is | "smart contracts (Order Book + matching engine) and APIs to fetch Metal X data", on the `dex` contract of the XPR Network | Published | S3, S4 |
| custody | non-custodial, orders are held on chain and funds stay in the user's WebAuth wallet | Published | S5 |
| restricted locations | "Residents in OFAC Prohibited Territories, Russia, Ukraine, New York NY U.S.A, and any other territories or states within the United States where digital asset ownership, trading or similar activities are restricted, may not use or access Metal X" | Region-specific | S3 |
| docs and app from this host | the fee page on `docs.metalx.com` and the app at `app.metalx.com` loaded in both runs, and the API reference was read from `api.dex.docs.metalx.com` | Probed | `fees-probe.py docs`, `ws-probe.py bundle`, S6 |
| public API from this host | every public call answered from nginx, at a Linode address in Frankfurt in run 1 and a Hetzner address in Helsinki in run 2, with no challenge and no geoblock | Probed | [`rest.md`](./rest.md) section 1 |

Canada is not on the restricted list, and the public market data calls take no account and no key.
Trading needs an XPR Network account that signs each order as a chain transaction, so there is no API key in the usual sense, S4 and S6.

## 2. Quick answer

| market | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, 17 pairs | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | Published and Probed | S1, `fees-probe.py markets` and `docs` |
| spot, XBTC_XMD | 0 %, 0 ppm | 0 %, 0 ppm | Published and Probed | S1, `fees-probe.py markets` |

`markets/all` carries `maker_fee` and `taker_fee` on every row, 0.1 on 17 rows and 0 on XBTC_XMD, so the unit is percent.
The fee page says "The XBTC/XMD trading pair on the DEX has zero trading fees for ALL users regardless of your level/tier", S1.
On the wire the fee is taken from what the taker receives, so `bid_amount` is `bid_total` less `bid_fee`.
One XPR_XMD trade, a taker buy, carried `bid_total` 43,572.9847 XPR, `bid_fee` 43.5729 and `bid_amount` 43,529.4118, which is 0.10 %, while the maker side paid 0, `fees-probe.py trades`.
Across the last 100 trades on each pair, XPR_XMD sides paid 0 % 153 times, 0.01 % 37 times and other rates 7 times in run 1, and 154, 36 and 7 times in run 2, while all 200 XBTC_XMD sides paid 0 % in both runs, `fees-probe.py trades`.
The 0 % rows are mostly the `metallicus` account, which the market maker tier explains.
The 0.01 % rows match the VIP volume tier or a DEX Key holder, and which one cannot be told from a trade.
CoinMarketCap carries `makerFee` 0.0 and `takerFee` 0.0 for Metal X, which is its placeholder for an unknown fee and not a quote, `fees-probe.py coverage`.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| spot | yes, 18 pairs, all `type` `spot` | `fees-probe.py markets`, [`rest.md`](./rest.md) section 2 |
| perpetuals | no | no non spot row in `markets/all`, no derivatives call in the API reference, CoinMarketCap shows 0 perpetual pairs, CoinGecko's derivatives list of 216 venues has no Metal X |
| dated futures | no | CoinMarketCap shows 0 futures pairs, and the docs name none |
| options | no | the docs and the API reference name none |
| margin | no | the docs and the order types name none, S4 |
| swap pools and farms | yes, Metal X Swap, an automated market maker outside the order book | S2 |
| lending | yes, Metal X Lending at `lending.metalx.com` | the docs sidebar |

The API reference lists 21 operations under `/dex/v1`, for markets, depth, trades, charts, orders, history, referrals, leaderboard, tax and status, and none of them is a perpetual, funding, index or mark call, S6.
CoinMarketCap lists 13 spot pairs for Metal X under id 1003, all quoted in XMD, against 18 in the venue's catalog, `fees-probe.py coverage`.

## 4. Spot tiers

The volume tier uses the user's 30 day average trading volume in US dollars, S1.

| tier | 30 day volume | maker | taker |
|---|---|---|---|
| I | under $250,000 | 0.10 % | 0.10 % |
| II | $250,000 or more | 0.08 % | 0.08 % |
| III | $500,000 or more | 0.06 % | 0.06 % |
| IV | $750,000 or more | 0.04 % | 0.04 % |
| V | $1,000,000 or more | 0.02 % | 0.02 % |
| VIP | $1,250,000 or more | 0.01 % | 0.01 % |
| Market Maker | by arrangement | 0 % | 0 % |

Maker and taker are equal at every tier.
The oracles page says token prices from oracles turn volume into the 30 day dollar average, S7.
The contract keeps a `fees` table per account with `volume_avg_30d` and `volume_avg_last_update`, which the web app reads to show the user's tier, S12.

## 5. Discounts that change the spot taker

"The highest discount between the volume tier, staking tier, and DEX Key is applied", S1.

| discount | rule | effect | label | evidence |
|---|---|---|---|---|
| staking | XPR staked on the XPR Network: under 1,000,000 pays 0.10 %, 1,000,000 or more 0.08 %, 10,000,000 0.06 %, 20,000,000 0.04 %, 60,000,000 0.02 %, 100,000,000 or more 0 % | maker and taker alike | Published | S1, `fees-probe.py docs` |
| NFT DEX Key | holders of a limited edition DEX Key NFT | 100 % off | Published | S1 |
| referral | for new accounts only, the referee gets 5 % off for one year and the referrer receives 25 % of the referee's fee | 0.10 % becomes 0.095 % for the referee | Published | S8 |
| XBTC_XMD | every user, every tier | 0 % | Published and Probed | S1, `fees-probe.py markets` |

No promotion with an end date was found.

## 6. Funding as a cost

Not offered, because Metal X lists no perpetual.

## 7. Liquidation, settlement and delisting

No liquidation or settlement exists on a spot venue without margin.
The bridge charges no deposit fee and a fixed withdrawal fee per token, such as 0.01 SOL, 1 USDC or 0.5 XRP, and XPR withdraws free, S1.
Trading carries no gas fee, because the XPR Network charges none to users, S5.
No delisting charge is published.

## 8. CCXT

CCXT 4.5.68 has no Metal X class.
`fees-probe.py ccxt` listed the 104 class files in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` and found none whose name holds `metal`, `proton` or `xpr`.
The current CCXT master on GitHub, commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08, has 103 TypeScript class files under `ts/src/` and none for Metal X either.
The second pass first drew HTTP 403 from the GitHub API, and a retry returned the same commit and the same result.
So there is no `market.taker` to report and no CCXT constant to cite.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, and Metal X has no perpetual.
It cannot enter the registry as a perpetual leg.
If a later design adds spot legs, `takerPpm` would be 1,000 from the published tier I taker, with 0 on XBTC_XMD, and there is no `ccxtTakerPpm`, because CCXT has no class.
The catalog would also have to come from the venue's own `markets/all`, since the connector's CCXT catalog has nothing to load.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://docs.metalx.com/dex/what-is-metal-x/dex-fees-and-discounts.md` | the volume and staking tier tables, the highest discount rule, the DEX Key, the zero fee XBTC_XMD pair, the bridge fees |
| S2 | `https://docs.metalx.com/llms.txt` | the docs index, including Metal X Swap, pools, farms, staking and lending |
| S3 | `https://metalx.com/terms` | Metallicus as operator, the scope of the DEX service, the restricted locations |
| S4 | `https://docs.metalx.com/developers-dex/contract-mappings/order-types.md` and the other contract mapping pages | order types, fill types, order status and market status codes, the `dex` contract |
| S5 | `https://api.dex.docs.metalx.com/reference/what-is-metal-x.md` and `https://docs.metalx.com/dex/what-is-metal-x.md` | non-custodial order book, orders on chain, no gas fees |
| S6 | `https://api.dex.docs.metalx.com/reference`, a ReadMe site, with one OpenAPI page per operation such as `.../reference/orderscontroller_getdepth.md` | the 21 operations, the mainnet and testnet servers, the depth parameters, the rate limits page |
| S7 | `https://docs.metalx.com/developers-dex/oracles.md` | oracles price tokens for the 30 day volume |
| S8 | `https://docs.metalx.com/dex/what-is-metal-x/referral-program.md` | the 25 % and 5 % referral split |
| S9 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=metal-x` and `.../exchange/market-pairs/latest?slug=metal-x` with `category` `spot`, `perpetual` and `futures` | id 1003, fee fields 0.0, 13 spot pairs, 0 perpetual and 0 futures pairs |
| S10 | `https://api.coingecko.com/api/v3/derivatives/exchanges/list` | 216 derivatives venues, none for Metal X |
| S11 | `https://api.github.com/repos/ccxt/ccxt/contents/ts/src` at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` | the current CCXT class list, with no Metal X class |
| S12 | `https://app.metalx.com/assets/frontend-Brn12Vhf.js` and `https://app.metalx.com/assets/dex-0zEL4Yp6.js`, the web app bundle | the API and socket hosts, the `fees` table read, the socket client, see [`websocket.md`](./websocket.md) section 1 |
