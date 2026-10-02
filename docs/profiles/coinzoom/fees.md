# CoinZoom Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:21 to 04:56 UTC, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

This profile covers spot trading on CoinZoom, because CoinZoom lists no perpetual, see section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): spot VIP 0 fees and spot tiers stand where the perpetual numbers would.
CCXT 4.5.68 has no CoinZoom class, and neither does the current CCXT master, see section 8.
Every number carries a source ledger row, a probe reference, or a file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/coinzoom/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/coinzoom/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 local time, 2026-09-23 UTC | |
| legal entities | CoinZoom, Inc. for a U.S. resident or anyone outside the U.S. except Australia, and CoinZoom Australia PTY LTD for anyone located in Australia | S7 |
| registration | FinCEN Money Services Business in all 50 states, NMLS ID 1735216, MSB registration 31000258236203, AUSTRAC digital currency exchange DCE100590284-002 | S8 |
| New York | money transmitter licence "Pending", and New York cannot be selected at sign up | S8, S6 |
| who may trade | residents of every U.S. state except New York, and residents of most countries | S6, S5 |
| U.S. persons | yes, except New York residents | S6 |
| U.S. states without a CoinZoom licence | served, with fiat held by Cross River Bank in a custodial account under a three-party agreement | S7 |
| excluded countries | 38: Afghanistan, Angola, Azerbaijan, Bangladesh, Belarus, Burma (Myanmar), Burundi, Canada, Central African Republic, Cuba, Cyprus, Democratic Republic of the Congo, Ethiopia, Georgia, Guinea Bissau, Iran, Iraq, Ivory Coast, Kazakhstan, Lebanon, Liberia, Libya, Mali, Nicaragua, North Korea, Pakistan, Republic of Congo, Russia, Somalia, South Sudan, Sri Lanka, Sudan, Syria, United Kingdom, Venezuela, Western Sahara, Yemen, Zimbabwe | S5 |
| terms version | "Last updated November 11, 2025" | S7 |
| CoinGecko context | trust score 5, `trust_score_rank` 116 on the API read at 04:21 UTC (the survey list said 113), 24 h volume 23.96 BTC, 22 coins and 28 pairs tracked, established 2020, United States | S10 |

Canada is on the excluded list, and the probe host exits through a Canadian address.
The public REST and WebSocket endpoints still answered this host with 200 and 101, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
Every access result in these profiles is from that Canadian VPN exit.
A request with no `User-Agent` header got a Cloudflare 403 page titled "Access denied | CoinZoom", which is a header rule and not a region rule, see [`rest.md`](./rest.md) section 6.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, Pro mode order book | 0.44 %, 4,400 ppm | 0.60 %, 6,000 ppm | S3, and `maker_fee` 0.44 and `taker_fee` 0.6 on all 41 assets of `GET /marketwatch/assets`, P1 |
| spot, Lite mode instant buy, sell and conversion | not split | 0.75 % to 1.49 %, 7,500 to 14,900 ppm | S3 |
| perpetuals | absent | absent | section 3 |

The fees page gives Pro maker as "0.22% – 0.44%" and Pro taker as "0.30% – 0.60%", and says "Pro fees start at the higher end and drop with ZOOM token rewards.", S3.
So an account that holds no ZOOM and pays fees in the traded asset pays the higher end, 0.60 % taker.
The low ends equal the high ends less the 50 % Black discount of section 5.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | `GET /instruments` lists 73 instruments and every `instrumentType` is `SPOT`, P1 and P2 |
| USDC-margined perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | same, and no futures product among the site's links or the help centre's article titles, S3 and S9 |
| options | absent | same |
| spot | present, researched | 73 pairs: 40 quoted in USD and 33 in USDT, 41 base assets, P1 and P2 |
| margin | not offered as a product | `BTC/USD` and `ETH/USD` carry `supportsLeverage` true and `maxLeverage` 5 in the instruments reply, and `GET /currencies` marks USDT, USDC, USD, BTC and ETH `canBeCollateral`, P1. No margin product, fee or rule appears on the fees page, and the order types article lists only market, limit, stop market, stop limit and OCO orders, S3 and S9 |

CoinGecko's derivatives API answers `GET /api/v3/derivatives/exchanges/coinzoom` with 404 `{"error":"market not found"}`, S10.
The public API has no derivatives endpoint, S1 and S2.

## 4. Spot tiers

CoinZoom publishes no volume tiers.
The only tiers are the ZOOM holding levels below, which discount the fee when the fee is paid in ZOOM.

| level | ZOOM held | discount | Pro taker | Pro maker |
|---|---|---|---|---|
| none | under 10,000, or fee not paid in ZOOM | 0 % | 0.60 % | 0.44 % |
| Silver | 10,000 to 49,999 | 10 % | 0.54 % | 0.396 % |
| Gold | 50,000 to 149,999 | 20 % | 0.48 % | 0.352 % |
| Diamond | 150,000 to 299,999 | 30 % on the fees page, 35 % in the help article | 0.42 % or 0.39 % | 0.308 % or 0.286 % |
| Black | 300,000 or more | 50 % | 0.30 % | 0.22 % |

The holding bands and discounts are from S3 and S4, and the taker and maker columns are the base rate times one less the discount.
The two sources disagree on Diamond, and both are written.

### Qualification

"These levels and discounts apply only when trading fees are paid with Zoom Tokens.", S4.
The level "depends on the number of Zoom Tokens held in the account", S4.
The API order examples carry `"payFeesWithZoomToken": true`, S1.

## 5. Discounts that change the taker

| discount | effect | source |
|---|---|---|
| ZOOM holding, fee paid in ZOOM | 10 % to 50 %, section 4 | S3, S4 |
| referral | "Refer a Friend, Get ZOOM" pays ZOOM and is not a fee discount, named only | `https://support.coinzoom.com/en/articles/12773223-refer-a-friend-get-zoom` |
| market maker programme | none published | S3 |
| zero fee promotion | none published on 2026-09-22 | S3 |

The engine models a taker cross at the base retail rate, so 0.60 % is the number, and the ZOOM ladder is context.

## 6. Funding as a cost

Not applicable.
CoinZoom lists no perpetual, so there is no funding rate, interval, cap or settlement instant, see section 3.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation | no leveraged product is offered, so no liquidation fee applies to trading | section 3 |
| "Crypto liquidation" | 1.49 %, listed among the Visa card fees | S3 |
| settlement | no settlement fee is published for spot trades | S3 |
| delisting | the help centre has an article "Managing delisted or unlisted coins", named only | `https://support.coinzoom.com/en/articles/12814101-managing-delisted-or-unlisted-coins` |
| deposits and withdrawals | out of scope, see the Fees & Limits page | S3 |

## 8. CCXT

| item | result |
|---|---|
| CCXT 4.5.68 in `server/node_modules` | `ccxt.exchanges` has 104 ids and none matches `zoom`, run from `server/` on 2026-09-23 04:21 and again in `rest-probe.mjs catalog` at 04:36 and 04:44 UTC, P1 and P2 |
| files | no `coinzoom.js` under `server/node_modules/ccxt/js/src`, and no file there mentions `coinzoom` |
| current CCXT master | `ts/src` on GitHub holds 105 files and 7 folders on 2026-09-23 04:22 UTC, and none is named after CoinZoom, S11 |
| history | issue 8672 "New Exchange: CoinZoom", opened 2021-03-19, is closed, and is the only issue or pull request that GitHub search returns for `coinzoom` in the CCXT repository, S11 |
| `market.taker` | no market to read, so no CCXT constant exists |

## 9. Recommended registry values

None.
CoinZoom has no perpetual, so it cannot join the engine as a perpetual leg, and no entry in `server/src/venues/registry.ts` is recommended.
If a later spot stage adds it, `takerPpm` would be 6,000 from S3 and the assets reply, and `ccxtTakerPpm` would be unset because no CCXT class exists.
Such a stage would also need its own catalog loader, because the connector builds the catalog from CCXT `loadMarkets` filtered to active swaps, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 68, 79 and 196 to 201.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinZoom Public API, Postman documentation, collection JSON | https://api-docs.coinzoom.com/ and https://api-docs.coinzoom.com/api/collections/8443211/SW7XbVjM?segregateAuth=true&versionTag=latest | 2026-09-23 UTC | CoinZoom, Inc. | API hosts, rate limits, `payFeesWithZoomToken`, sections 2 and 4 |
| S2 | CoinZoom Market Watch, Postman documentation, collection JSON | https://api-markets.coinzoom.com/ and https://api-markets.coinzoom.com/api/collections/8443211/T1DniJK6?segregateAuth=true&versionTag=latest | 2026-09-23 UTC | CoinZoom, Inc. | public market data calls, section 3 |
| S3 | Fees & Limits | https://www.coinzoom.com/en/fees/ | 2026-09-23 UTC | CoinZoom, all users | Pro and Lite fees, ZOOM levels, card fees, sections 2 to 7 |
| S4 | How does the trading fee discount work | https://support.coinzoom.com/en/articles/12824111-how-does-the-trading-fee-discount-work | 2026-09-23 UTC | CoinZoom, all users | ZOOM levels with Diamond at 35 %, fee paid in ZOOM rule, sections 4 and 5 |
| S5 | In what countries is CoinZoom available | https://support.coinzoom.com/en/articles/12805667-in-what-countries-is-coinzoom-available | 2026-09-23 UTC | CoinZoom, all users | excluded countries, section 1 |
| S6 | What states can use CoinZoom | https://support.coinzoom.com/en/articles/12814864-what-states-can-use-coinzoom | 2026-09-23 UTC | CoinZoom, Inc., United States | all states except New York, section 1 |
| S7 | Terms of Service | https://www.coinzoom.com/en/terms/ | 2026-09-23 UTC | CoinZoom, Inc. and CoinZoom Australia PTY LTD | contracting entities, Cross River Bank custody, governing law of Utah, section 1 |
| S8 | Money Transmitter Licenses | https://www.coinzoom.com/en/licenses/ | 2026-09-23 UTC | CoinZoom, Inc. | FinCEN, NMLS, AUSTRAC and state licences, New York pending, section 1 |
| S9 | How to make advanced trades, order types | https://support.coinzoom.com/en/articles/12785897-how-to-make-advanced-trades-order-types-trading-pairs | 2026-09-23 UTC | CoinZoom, all users | order types, no margin, section 3 |
| S10 | CoinGecko exchange and derivatives API | https://api.coingecko.com/api/v3/exchanges/coinzoom and https://api.coingecko.com/api/v3/derivatives/exchanges/coinzoom | 2026-09-23 04:21 UTC | CoinGecko | trust rank, volume, derivatives 404, sections 1 and 3 |
| S11 | CCXT master `ts/src` listing and issue search | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master and https://github.com/ccxt/ccxt/issues/8672 | 2026-09-23 04:22 UTC | CCXT | no class in master, the 2021 request, section 8 |
| P1 | `rest-probe.mjs catalog`, first run at 04:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinzoom/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | instruments, assets fees, currencies, CCXT list, sections 2, 3 and 8 |
| P2 | `rest-probe.mjs catalog`, second pass at 04:44 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/coinzoom/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | the same numbers, unchanged |
