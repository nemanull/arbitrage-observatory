# idax Fees Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 02:21 to 02:41 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the trading fees of idax, the Mongolian exchange at `www.idax.exchange` that CoinMarketCap lists as "idax exchange" at rank 184.
The researched product is its USDT margined perpetuals.
idax runs on the ChainUp white label platform, the same one as FameEX, x.me and Koinbay, see [`rest.md`](./rest.md) section 1.
It has no CCXT class, see section 8.
Source ids are shared with [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | idax Exchange, a limited liability company under the laws of Mongolia, a licensed Virtual Asset Service Provider | S5, S10 |
| group | Ard Financial Group JSC, as CoinMarketCap's description says | S10 |
| regulator | the Financial Regulatory Commission of Mongolia, as CoinMarketCap's description says | S10 |
| who may trade | KYC is required for every product, "All users are required to complete the KYC process" | S6 |
| regions | the terms address "an adult citizen of Mongolia", and say that for a citizen of another country the provider "is not responsible for checking whether the customer has eligibility according to the laws of his/her country" | S5 |
| regions excluded | Not publicly specified, no country list was found in the terms | S5, P1 |
| access from this host | every public call answered, no refusal and no region message, see [`rest.md`](./rest.md) section 1 | P2 |

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT margined perpetuals | 0.05 %, 500 ppm | 0.1 %, 1,000 ppm | S1, and `openMakerFee` 0.0005 and `openTakerFee` 0.001 on all 205 live contracts, P1 |

The open and close fields agree, `closeMakerFee` 0.0005 and `closeTakerFee` 0.001 on all 205, P1.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT margined perpetuals | yes, 204 tradable in the web list and the contract config, 205 live in the open API catalog | P3, see [`rest.md`](./rest.md) section 2 |
| USDC margined perpetuals | no | every catalog row has quote USDT, P3 |
| coin margined perpetuals | no | `side` is 1, linear, on all 252 catalog rows, P3 |
| dated futures | no | `deliveryKind` "0" and `settlementFrequency` 1 on every web list row, and no type other than `E`, `S` and one odd `FILCOIN` row, P3 |
| options | no | none in the catalog or the site navigation, S1 |
| test contract | `S-BTC-USDT`, margined in `EXUSD` | P3, and S8 says type `S` is "test futures" |
| spot | yes, 377 symbols, 327 quoted in USDT | `GET /sapi/v1/symbols`, P3, named here and not detailed |
| margin, ETF, P2P, copy and grid trading | named on the help center menu | S1, not detailed |

Of the 204 tradable perpetuals, 75 are equity contracts such as TSLA, MSTR and SONY, 5 are metals such as XAU and XAG, and 2 are oil, BZ and CL, by the web list's `assetClass`, P3.
None is flagged in the contract name.

## 4. Perpetual tiers

| tier | maker | taker | qualification |
|---|---|---|---|
| all users | 0.05 % | 0.1 % | none, S1 |

The fee page shows one futures row per role and no VIP table, S1.
Whether larger accounts get lower rates is Not publicly specified.

## 5. Discounts

| discount | effect on the perpetual taker | source |
|---|---|---|
| paying with ARDX | spot only, 0.20 % to 0.18 %, and the futures table has no such column | S1 |
| referral | a referral page exists, and its effect on the futures fee is Not publicly specified | S1 |
| market maker | Not publicly specified | |
| zero fee promotion | none found | S1 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| who pays | longs pay shorts when the rate is positive, shorts pay longs when it is negative, and "the platform does not charge any fees" | S2 |
| amount | position value times the rate, where position value is positions times face value times mark price | S2 |
| documented interval | every 8 hours at 00:00, 08:00 and 16:00, which the page calls "GMT-8 time" | S2 |
| interval on the wire | 8 h on 184 contracts, 4 h on 19 and 1 h on 2, by `capitalFrequency` | P3 |
| next settlement on the wire | 08:00 UTC on the 184 at 8 h, 04:00 UTC on the 19 at 4 h and 03:00 UTC on the 2 at 1 h, read at 02:24 UTC | P3 |
| formula | clamp(average premium index + clamp(interest rate minus average premium index, 0.05 %, minus 0.05 %), cap, floor), with an interest rate of 0.01 % per period | S2 |
| documented cap and floor | 0.375 % and minus 0.375 % | S2 |
| cap on the wire | `capitalIntervalMax` of 2 % on 133 rows, 0.75 % on 42, 3 % on 14, and 12 other values down to 0.08 % | P3 |
| when the rate is fixed | "determined at the beginning of the current period, will not change during the period" | S2 |

The documented 00:00, 08:00 and 16:00 are the same three instants in UTC whether "GMT-8" or the server's GMT+8 is meant, since the two are 16 hours apart.
The wire disagrees with the page in two ways.
Not every contract runs on 8 hours, and the per contract cap is wider than the documented 0.375 % on most rows.
The published rate also moved within the period, see [`rest.md`](./rest.md) section 4.
The settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting charges

| item | value | source |
|---|---|---|
| liquidation | `liquidationRate` 0.001 on all 205 web list rows, whose meaning is Not publicly specified | P3 |
| settlement | none, the perpetuals do not expire | S2 |
| delisting | Not publicly specified, 45 catalog rows sit at `status` 0 | P3 |

## 8. CCXT

CCXT 4.5.68 has no idax class.
The installed source folder, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, holds 104 `.js` files, the only names containing "dax" are `indodax.js` and `ndax.js`, and no other file contains the string "idax", P1.
So there is no file and line to cite.
The current CCXT source on GitHub, `ts/src` at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08, lists 110 entries, and the only names containing "dax" are `indodax.ts` and `ndax.ts`, S13 and P1.
So CCXT reports no `market.taker` for this venue.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 1000 | the published 0.1 % futures taker, S1, which `openTakerFee` repeats on every live contract, P1 |
| `ccxtTakerPpm` | none | no CCXT class |

The engine's ChainUp family adapter carries the taker in its `Profile`, at [`chainup.rs`](../../../server/src/venues/chainup.rs) line 35, so an idax profile would set `taker_ppm: 1000`.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fee structure | https://support.idax.exchange/docs/fee-structure/ | 2026-10-09 | idax help center | fees, sections 2, 4 and 5 |
| S2 | Funding rate | https://support.idax.exchange/docs/funding-rate/ | 2026-10-09 | idax help center | funding, section 6 |
| S3 | Mark price | https://support.idax.exchange/docs/mark-price/ | 2026-10-09 | idax help center | mark formula, [`rest.md`](./rest.md) section 4 |
| S4 | Index price | https://support.idax.exchange/docs/index-price/ | 2026-10-09 | idax help center | index rules, [`rest.md`](./rest.md) section 4 |
| S5 | Terms and Conditions | https://support.idax.exchange/docs/terms-and-conditions/ | 2026-10-09 | idax Exchange, Mongolia | operator and eligibility, section 1 |
| S6 | Can I Trade Without KYC? | https://support.idax.exchange/docs/kyc-trade/ | 2026-10-09 | idax help center | KYC rule, section 1 |
| S7 | ChainUp Open API v2, overview | https://exchangedocsv2.gitbook.io/open-api-doc-v2/ | 2026-10-09 | ChainUp, linked as `openApiDocUrl` in S11 | limits and HTTP codes, [`rest.md`](./rest.md) section 6 |
| S8 | ChainUp Open API v2, futures | https://exchangedocsv2.gitbook.io/open-api-doc-v2/futures | 2026-10-09 | ChainUp | endpoints and contract types |
| S9 | ChainUp Open API v2, WebSocket | https://exchangedocsv2.gitbook.io/open-api-doc-v2/websocket | 2026-10-09 | ChainUp | socket protocol, [`websocket.md`](./websocket.md) |
| S10 | CoinMarketCap exchange detail | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=idax-exchange | 2026-10-09 | CoinMarketCap | description, group, licence, site and fee URLs |
| S11 | idax web config | https://www.idax.exchange/fePublicInfo/en_US | 2026-10-09 | idax | `coUrl`, `wsUrl` and `openApiDocUrl` |
| S13 | CCXT `ts/src` listing | https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src | 2026-10-09 | CCXT | no idax class, section 8 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/idax/fees-probe.py) | `uv run scripts/probes/venues/idax/fees-probe.py` | 2026-10-09 | this host, Canadian exit | the help center pages, the per contract fee fields and the CCXT checks |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/idax/rest-probe.py) mode `host` | | 2026-10-09 | this host | access, section 1 |
| P3 | [`rest-probe.py`](../../../scripts/probes/venues/idax/rest-probe.py) mode `catalog` | | 2026-10-09 | this host | catalog, web list and contract config, sections 3, 6 and 7 |
