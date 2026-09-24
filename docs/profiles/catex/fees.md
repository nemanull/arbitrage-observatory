# Catex Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:23 to 04:46 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit Cloudflare places in Canada (`loc=CA`, edges SEA and YVR).

This profile covers Catex (catex.io), which has no CCXT class and lists no perpetuals.
Under template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), it is profiled on its spot market.
The probes are [`rest-probe.mjs`](../../../scripts/probes/venues/catex/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/catex/ws-probe.mjs), and their findings are in [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | the Terms of Use say "This agreement is between you and Catex" and name no company, registration number or address | S3 |
| founded and country | "Catex was founded in early 2018" on the home page, CoinGecko lists year 2018 and country China | S1, S7 |
| who may trade | anyone outside the restricted locations, and the Terms say identity verification may be requested | S3 |
| restricted locations | "The United States of America(Include all Territories of the United States), China(Include China Mainland, China Hong Kong, China Macao, China Taiwan), Singapore, Canada, France, Germany, Malaysia, Malta, Cuba, Iran, North Korea, Sudan, Syria, Crimea Region, Spain, Luhansk, Donetsk, Netherlands, Bolivia, UK, Myanmar, Venezuela, Uzbekistan, Austria and so on." | S3 |
| US persons | may not trade, the United States and all its territories are restricted | S3 |
| access from this host | every public REST call answered 200 and the WebSocket upgraded with 101, with no geoblock, see [`rest.md`](./rest.md) section 1 | P1, P2 |

Access results are from a Canadian VPN exit, and Canada is itself a restricted location in the Terms.
Public market data was served anyway, so the restriction is enforced at account level if at all, which was not tested because no account was opened.

CoinGecko on 2026-09-22 gave Catex trust score 5 and trust rank 113, 22 coins, 31 tracked pairs and 1,097.67 BTC of 24 h volume, and 75.5 million USD of that volume was one pair, `MPRA/USDT`, S7.
That pair's book had a best bid of 12,005,580 USDT against a best ask of 4,449,239,221 USDT, see [`rest.md`](./rest.md) section 2.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, every pair | 0.1 %, 1,000 ppm | 0.1 %, 1,000 ppm | fee page S2, and `maker_fee` 0.001 and `taker_fee` 0.001 on 100 of 100 assets in `GET /api/cmc/assets`, P1 |

The fee page has a single "Trading fee" column, and every one of its 280 rows reads `0.1 %`, S2.
It does not split maker from taker.
The CoinMarketCap feed endpoint does split them, and both numbers are 0.001 on every asset, P1.
Paying the fee in CATT lowers it by 30 %, to 700 ppm, see section 5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | no futures page or menu item: the site menu is Market, Trading, Asset, News, Staking and Faucet, S1. `/futures`, `/contract` and `/swap` answer 404 `{"code":1,"message":"Page Not Found"}`. `futures.catex.io` and `contract.catex.io` do not resolve |
| USDC-M or coin-M perpetuals | absent | same evidence |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| margin | absent | no mention on the fee, FAQ or Terms pages, S2, S3, S4 |
| spot | present | 64 pairs: 46 quoted in USDT, 11 in BTC, 6 in ETH, 1 in TRX, see [`rest.md`](./rest.md) section 2 |

CoinGecko's derivatives exchange list had 214 entries on 2026-09-22 and none of them is Catex, S8.
The API documentation covers only market data and says "The account API and trading API will be available next", S5.

## 4. Spot tiers

No tier table is published.
The fee page lists one flat rate per coin and no volume or holding tier, S2.
The VIP 0 rate in section 2 is therefore the only rate.

## 5. Discounts that change the spot taker

| discount | effect | source |
|---|---|---|
| pay the fee in CATT | "If you pay the fee in CATT, you will receive a 30% discount on the trading fee", so 700 ppm | home page, S1 |
| referral | "users will get 50% commission if they refer someone to trade", paid to the referrer and not a discount on the taker's own fee | home page, S1 |
| fee waivers | "There are also many events where the trading fee or withdrawal fee is waived", with no dated promotion named | home page, S1 |
| market maker program | none found | S1, S2, S4 |

The CATT discount was not verified on the wire, because it needs an account.
The home page title reads "Catex Exchange - 50% trading fee commission", and the FAQ still lists 2018 entries on transaction mining and daily CATT dividends, S1, S4.
Whether those programmes run today was not checked.

## 6. Funding as a cost

Not applicable.
Catex lists no perpetuals, so there is no funding rate, interval, cap or settlement, see section 3.

## 7. Liquidation, settlement and delisting

There is no liquidation or settlement charge, because Catex offers neither margin nor derivatives.
Delistings are announced on the news page, for example "Regarding the token delisting" on 2023-07-04, and no delisting fee is published, S6.
Withdrawal fees are per coin on the fee page, for example 5 USDT and 0.0005 BTC, S2.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 in `server/node_modules` | `ccxt.exchanges` has 104 ids and none contains `cat`, P1 catalog mode |
| CCXT master on GitHub, 2026-09-22 | the `ts/src` listing from the GitHub contents API has 105 files and none matches `cat`, and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/catex.ts` answers 404 |

So there is no `market.taker` to report and no source line to cite.

## 9. Recommended registry values

None.
Catex has no perpetuals, and the catalog at `server/src/ccxt/connector.ts` lines 196 to 203 keeps only active swaps, so the venue cannot enter [`registry.ts`](../../../server/src/venues/registry.ts) in its current shape.
If a spot stage ever uses it, the taker is 1,000 ppm at VIP 0 and 700 ppm with fees paid in CATT, and there is no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Catex home page | https://www.catex.io/ | 2026-09-22 | Catex, global | menu, founding year, CATT discount, referral, waivers, sections 1, 3 and 5 |
| S2 | Catex fees | https://www.catex.io/fee | 2026-09-22 | Catex, global | 0.1 % trading fee on 280 rows, withdrawal fees, sections 2, 4 and 7 |
| S3 | Catex Terms of Use | https://www.catex.io/term | 2026-09-22 | Catex, global | operator wording, identity verification, restricted locations, section 1 |
| S4 | Catex FAQ | https://www.catex.io/faq | 2026-09-22 | Catex, global | transaction mining and dividend entries, section 5 |
| S5 | Catex exchange API wiki, Home page, last edited 2023-10-17 | https://github.com/catex/catex_exchange_api/wiki | 2026-09-22 | Catex, global | market API only, section 3 |
| S6 | Catex announcements | https://www.catex.io/announcement | 2026-09-22 | Catex, global | delisting notice, section 7 |
| S7 | CoinGecko exchange record `catex` | https://api.coingecko.com/api/v3/exchanges/catex | 2026-09-22 | CoinGecko | trust score and rank, country, pairs, volume, section 1 |
| S8 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | no Catex entry, section 3 |
| P1 | `rest-probe.mjs catalog`, at 04:28 and 04:41 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/catex/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | `cmc/assets` fees, CCXT check, access, sections 1, 2 and 8 |
| P2 | `ws-probe.mjs book`, at 04:39 and 04:43 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/catex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | WebSocket access, section 1 |
