# C-Patex Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09, for the venue survey of 2026-09-22, CoinMarketCap addition at rank 73, wave 42.

**Probed:** 2026-10-10 between 02:52 and 03:14 UTC, the evening of 2026-10-09 in local time, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.

This profile covers the spot market of C-Patex, the exchange at `c-patex.com`.
C-Patex lists no perpetuals, see section 3, so change 1 of the survey plan's template applies and every section below is about spot.
CCXT 4.5.68 has no C-Patex class, see section 8.
Every probed value comes from [`fees-probe.py`](../../../scripts/probes/venues/c-patex/fees-probe.py) unless a row names another probe.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "DLT Swap Technologies Ltd, a company, established under the laws of Seychelles, having registered address at House of Francis, Room 303, Ile Du Port, Mahe, Seychelles." | S3, `terms` mode |
| token and airdrop entity | the CPEX airdrop terms name "CPEX DLT Inc., a BVI business company" | S4 |
| excluded regions | the terms' Prohibited Jurisdiction list: Argentina, Bolivia, Colombia, Mexico, Chile, El Salvador, Uruguay, North Korea, Iran, Syria, South Sudan, the United Arab Emirates, the United States and its territories, Cuba, Crimea and Sevastopol, and the Donetsk and Luhansk regions | S3, `terms` mode |
| Canada | not on the Prohibited Jurisdiction list | S3, `terms` mode |
| who may trade spot | a registered user outside the list above, with KYC limits on withdrawals of 0 USD for a new account, 500 USD per 24 h for a basic account and 100,000 USD per day for an enhanced account | S2 |
| access from this host | every public page and API host answered HTTP 200 or a documented error, with no geoblock, from the Canadian exit | [`rest-probe.py`](../../../scripts/probes/venues/c-patex/rest-probe.py), [`ws-probe.py`](../../../scripts/probes/venues/c-patex/ws-probe.py) |

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, every pair except PLC and USDN | 0.2 %, 2,000 ppm, Not publicly specified as a separate maker rate | 0.2 %, 2,000 ppm | `{"fee":0.002,"fee_otc":0.002,"fee_plc":"0.20","fee_plc_buy":"0"}` from `GET https://back.c-patex.com/v2/trade/settings`, `fees` mode |

The homepage S4 says "Trading fees are determined based on trading activity and do not exceed 0.2%" and "Fees start from 0.2%".
The web order form applies the one `fee` value of 0.002 to both buy and sell orders on every pair whose base asset is not PLC or USDN, see section 5.
No document splits maker from taker, so the maker figure is the order form's value and not a published maker rate.
The two special tokens are not listed in the current catalog of 26 pairs, see [`rest.md`](./rest.md) section 2, so the 2,000 ppm figure covers every live pair.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals, any margin asset | absent | no route with futures, perp, swap, contract, deriv, margin or leverage among the 779 paths of the web app's route table, `scope` mode |
| dated futures | absent | same route table. The homepage roadmap names "Launching Bitcoin Futures Trading" for March 2020, and no such product exists today, `scope` mode |
| options | absent | same route table, and no option market in the catalog |
| margin | absent as a product | the web store holds a `getWalletMarginBalances` call, S4, but there is no margin route and no margin market tab, `scope` mode |
| spot | yes, 26 pairs: 23 USDT, 2 USDC and 1 BTC | `GET https://api.c-patex.com/api/v1/public/markets`, [`rest-probe.py`](../../../scripts/probes/venues/c-patex/rest-probe.py) `catalog` |

The website's market list `GET https://back.c-patex.com/marketlist` has two top tabs, `Spot` and `Defi`, and no futures tab.
CoinGecko's derivatives exchange list returned 111 venues on 2026-10-09 and none of them matches "patex".
CoinGecko's full exchange list returned 1,503 venues and none matches "patex" either, and `GET /api/v3/exchanges/c_patex` answered HTTP 404 `{"error":"exchange not found"}`, although the C-Patex homepage still links a CoinGecko page for `c_patex`.
The survey plan's table records "perps on CoinGecko: no" for this venue, and the probes agree.

## 4. Spot tiers

No tier table is published.
S2, the fee page, renders a "Trading Fees" box whose figure comes from the quick buy and sell setting, not from a tier table, see section 5.
The homepage S4 says fees "are determined based on trading activity", which implies tiers, but no volume tier, threshold or rate is published.
The level system behind `GET https://back.c-patex.com/v2/ticket/levels` and `v2/ticket/info` answers HTTP 302 to `https://back.c-patex.com` without a session, so its awards are Account-gated.
The site's strings list "Trading Fees (trading commission)" as one of the "All levels awards", S4, so a level may lower the taker, but by how much is not public.

## 5. Discounts that change the spot taker

| discount | state | source |
|---|---|---|
| special tokens PLC and USDN | the order form uses `fee_plc` on a sell and `fee_plc_buy` on a buy when the base asset is PLC or USDN, and `fee` otherwise. `fee_plc_buy` is `"0"` and `fee_plc` is `"0.20"`, whose unit is not stated | web bundle function `w(e,t,r)` and the list `["PLC","USDN"]`, `fees` mode |
| level awards | Account-gated, see section 4 | `fees` mode |
| custom fee setting | the web store has a private `POST /v2/settings/customfee` call whose effect is not documented | web bundle, S4 |
| referral | a referral program exists, its effect on the taker is not published | S4 |
| zero fee promotion | none found | S2, S4 |

The fee page S2 shows "Trading Fees 0%" in its server-rendered HTML.
Its component formats `100 * this.fee` from the `buySell` store, which starts at 0 and is filled by the client from `/v2/trade/settings`, so the 0 % is the state before that call returns, not a fee.
The `fees` mode confirms that formula in the page's chunk `/_nuxt/6eb77de.js`.

## 6. Funding as a cost

Not offered.
C-Patex has no perpetuals, see section 3.

## 7. Liquidation, settlement and delisting charges

Not offered for liquidation and settlement, since there is no leveraged product.
No delisting charge is published.
Deposit and withdrawal fees are listed per currency by `GET https://back.c-patex.com/v2/fee-schedule`, 49 currencies on 2026-10-09, and are out of scope for this survey.

## 8. CCXT

CCXT 4.5.68 has no C-Patex class.
There is no `cpatex.js` or `c-patex.js` under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and no key containing "patex" in the `exchanges` map that starts at line 232 of `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js`.
The current CCXT source on GitHub, master commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08, has 103 TypeScript files under `ts/src/` and none of them names C-Patex.
`market.taker` is therefore not available for any C-Patex pair.

The closest CCXT class is `p2b`, which speaks the same API family.
It signs with the same `X-TXC-APIKEY`, `X-TXC-PAYLOAD` and `X-TXC-SIGNATURE` headers, at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/p2b.js` line 1350, and its socket subscribes with `depth.subscribe`, at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/p2b.js` line 246.
A future C-Patex adapter could borrow its parsing, but `p2b` is hard-wired to P2B's hosts and does not load C-Patex.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 2000 | `fee` 0.002 from `/v2/trade/settings` applies to every live pair, and the homepage caps trading fees at 0.2 % |
| `ccxtTakerPpm` | none | no CCXT class, section 8 |

These values only matter if the engine gains a spot leg.
As a perpetual venue C-Patex has nothing to register.

## 10. Source ledger

| id | source | used for |
|---|---|---|
| S1 | C-Patex API documentation, `https://github.com/PatexGit/api-docs/blob/main/API.md`, last commit `565474b` of 2023-08-04, linked from the site footer as "API Documentation" | API family and hosts |
| S2 | fee page, `https://c-patex.com/fees`, read 2026-10-09 | withdrawal limits, the "Trading Fees" box |
| S3 | terms of use embedded in the web bundle served by `https://c-patex.com/`, read 2026-10-09 | operator, Prohibited Jurisdiction list |
| S4 | homepage and web bundle, `https://c-patex.com/`, read 2026-10-09 | fee phrases, roadmap, level awards, fee rule for PLC and USDN |
| S5 | `GET https://back.c-patex.com/v2/trade/settings` and `/v2/fee-schedule`, probed 2026-10-09 | the 0.002 fee |
| S6 | CoinGecko public API, `/api/v3/derivatives/exchanges` and `/api/v3/exchanges/list`, read 2026-10-09 | no perpetuals tracked |
| S7 | CCXT 4.5.68 at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/`, and CCXT master on GitHub at commit `f0aca06` | section 8 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/c-patex/fees-probe.py), modes `fees`, `scope` and `terms` | sections 1 to 5 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/c-patex/rest-probe.py), mode `catalog` | section 3 |
