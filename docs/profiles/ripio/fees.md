# Ripio Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time, 2026-10-10 03:00 to 03:21 UTC, from the development host near Seattle, through the user's Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada, so every access result below is from that Canadian exit.

This profile covers Ripio Trade (trade.ripio.com), the order book exchange of the Argentine Ripio group, which grew out of BitcoinTrade in Brazil.
Ripio Trade lists no perpetual, no dated future and no option, so the profile follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) and records the spot schedule.
CCXT 4.5.68 has no Ripio class, and the class CCXT once had pointed at a host that no longer resolves, see section 8.
The public API, the WebSocket stream and the documentation all answered this host.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator in Argentina | Moonbird S.R.L., CUIT 30-71453554-0, Bouchard 680, piso 19, Ciudad Autónoma de Buenos Aires, administers the platform at https://trade.ripio.com/ "en Argentina" with its affiliates | S2, P1 |
| operator in Brazil | the Brazilian Ripio wallet terms name Ripio Brasil Sociedade Prestadora de Serviços de Ativos Virtuais Ltda. A Brazilian Ripio Trade terms page was not found, since `https://terms.ripio.com/br/ripio-trade` answered 404 | S3, P1 |
| countries served | `GET /v4/public/countries` lists Uruguay, Chile, Argentina, Colombia, México, Brazil, Spain and Peru. Each pair carries a `countries` list, so the catalog differs by country of residence | P2 |
| pairs per country | Brazil 17, Argentina 14, Chile 11, Uruguay 8, Spain 8, Colombia 7, México 7, Peru 1 | P2 |
| excluded | the Argentine terms refuse residents of sanctioned territories, naming Crimea, Cuba, Iran, Syria and North Korea, and people on the OFAC or United Nations lists | S2 |
| US and Canadian persons | not named as excluded in the Argentine Ripio Trade terms. Canada is not among the eight countries the catalog serves, so a Canadian resident has no pair to trade | S2, P2 |
| access from this host | the public REST API, the WebSocket stream, the documentation page and the terms pages answered from the Canadian exit with no geoblock | P1, P2, P3 |
| terms date | "Última actualización: 5/4/2026" on the Argentine Ripio Trade terms | S2, P1 |

| context | value | source |
|---|---|---|
| CoinMarketCap rank | 118, from the survey's CoinMarketCap list | [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) |
| CoinGecko | neither `exchanges/list` nor `derivatives/exchanges/list` has an entry matching "ripio", out of 216 derivatives venues, on 2026-10-10 at 03:08 UTC | S6 |
| 24 h activity at 03:09 UTC | `USDC_BRL` 65,460 trades and 9.35 million BRL, `USDT_ARS` 5,618 trades and 1.88 billion ARS, `BTC_USDC` 2,870 trades and 352,782 USDC, `ETH_USDC` 873 trades and 371,241 USDC | P2 |

## 2. Quick answer

| product | maker | taker | maker ppm | taker ppm | source |
|---|---|---|---|---|---|
| spot, level 1 (0 to 1,000 USD in 30 days) | 0.25 % | 0.50 % | 2,500 | 5,000 | the fee table in the Argentine Ripio Trade terms, section 9.2.5, S2, P1 |
| perpetuals | absent | absent | | | section 3 |

The VIP 0 number for this profile is the level 1 spot taker, 5,000 ppm.
The schedule is published only as a screenshot inside the terms, a PNG whose file name says it was captured on 2024-08-31, so the numbers were read from that image, P1.
No public endpoint returns a fee.
`GET /v4/public/pairs` has no fee field, and the per account call `GET /v4/user/trading-fees?pair=BTC_USDC` answered 401 with `{"error_code":40100,"message":"Invalid token"}` without credentials, P1, P2.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | absent | the v4 API documents spot pairs, spot orders and spot books only, `GET /v4/public/pairs` returns 20 spot pairs with no contract field, no ticker carries an index, mark or funding field, and CoinGecko's derivatives list has no Ripio, S1, P2, S6 |
| dated futures | absent | same |
| options | absent | same |
| spot | present | 20 pairs, all `enabled`: 11 against USDC, 5 against BRL, 2 against ARS, 1 against USDT and 1 against COP, P2 |
| wallet, earn, card, OTC and B2B products | present in the group, out of scope | the menu of the terms site links Wallet, Ripio Trade, Ripio Portal, Ripio Select, Swap and Ripio B2B, S3 |

The pairs in the engine's USD, USDC and USDT settlement family are `BTC_USDC`, `ETH_USDC`, `LTC_USDC`, `LINK_USDC`, `UNI_USDC`, `WLD_USDC`, `HYPE_USDC`, `LAC_USDC`, `RPC_USDC`, `PYUSD_USDC`, `EURC_USDC` and `USDC_USDT`, twelve in all, P2.
`EURC_USDC` showed no trade in 24 h and a bid of 0.1528 against an ask of 1.17, P2.

## 4. Spot tiers

The Argentine terms set the level from the user's trading volume in USD over the last 30 days, and say the level and the fees are updated daily between 22:00 and 24:00, S2.

| level | 30 day volume, USD | maker | taker | maker ppm | taker ppm |
|---|---|---|---|---|---|
| 1 | 0 to 1,000 | 0.25 % | 0.50 % | 2,500 | 5,000 |
| 2 | over 1,000 to 5,000 | 0.21 % | 0.45 % | 2,100 | 4,500 |
| 3 | over 5,000 to 10,000 | 0.17 % | 0.40 % | 1,700 | 4,000 |
| 4 | over 10,000 to 100,000 | 0.13 % | 0.35 % | 1,300 | 3,500 |
| 5 | over 100,000 to 500,000 | 0.09 % | 0.30 % | 900 | 3,000 |
| 6 | over 500,000 to 1,500,000 | 0.05 % | 0.25 % | 500 | 2,500 |
| 7 | over 1,500,000 to 5,000,000 | 0.03 % | 0.20 % | 300 | 2,000 |
| 8 | over 5,000,000 | 0.00 % | 0.10 % | 0 | 1,000 |

The table is image `fee_table.png`, 1096 by 762 pixels, 111,163 bytes, SHA-256 `50fca7ad440c893d583bbdd2c1c86b4c1179b4edc4c0e9bfceae9e653018cc85`, as fetched by P1.
The terms do not say whether the schedule applies to every pair or only to Argentine accounts.
The Brazilian fee page the trade app links, `https://www.ripio.com/br/limites-e-taxas-operacionais-exchange/`, now redirects to `https://www.ripio.com/pt/produtos/ripio-trade/taxas`, which answered 404, P1.
The Wayback availability API listed a snapshot of that page at 2026-05-18, and in the first run one of the older address at 2024-06-15, but every snapshot fetch from this host answered 429 Too Many Requests, so the Brazilian schedule is Not verified, P1.

## 5. Discounts that change the taker

| discount | value | source |
|---|---|---|
| volume tiers | section 4 | S2 |
| token holding | none found. Ripio's own token RPC is listed as `RPC_USDC`, and no fee discount for holding it appears in the terms | S2, P2 |
| referral | the terms site lists a "Promoción Referidos 2.0" page, and the Ripio Trade terms name no referral discount | S2, S3 |
| market maker program | Not publicly specified | |
| zero fee promotions | none in the Ripio Trade terms. The Argentine wallet terms carry a USDT weekend promotion that ended on 26 October 2025 and applies to the wallet, not to the order book | S3 |

## 6. Funding as a cost

None.
Ripio Trade lists no perpetual, so there is no funding rate, interval or settlement.

## 7. Liquidation, settlement and delisting

None of these apply to spot.
Withdrawal fees are looked up per currency with the private call `GET /v4/withdrawals/estimate-fee/{currency_code}`, S1.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` has no `ripio.js`, and the `exchanges` map at `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` line 232 has no `ripio` key | local file listing |
| current CCXT master | `ts/src` at commit `f0aca06eb7`, 2026-10-08 09:28 UTC, lists 110 entries and none contains "rip" | S5 |
| history | `js/ripio.js` exists at tags 1.95.1, 2.0.1 and 2.5.1, and `ts/src/ripio.ts` at tag 3.0.1. It is gone by tag 3.1.1 | S5 |
| old host | tag 3.0.1 `ts/src/ripio.ts` lines 71 to 79 set the API to `https://api.exchange.ripio.com/api` and the fee page to `https://exchange.ripio.com/en/fee`. `api.exchange.ripio.com` has no DNS address from this host | S5, P2 |
| old fee constant | the same file, lines 110 and 111, sets `taker` and `maker` to 0.0, and lines 215 and 216 read per pair `taker_fee` and `maker_fee` from the old API | S5 |

So `market.taker` has no value to report for Ripio in CCXT 4.5.68, and `ccxtTakerPpm` is null.
The retired class served the old Ripio Exchange API, not the Ripio Trade v4 API this profile describes.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 5,000, only if a spot leg is ever modelled | level 1 taker of the Argentine schedule, S2 |
| `ccxtTakerPpm` | none | no CCXT class exists |

Ripio Trade cannot join the engine as a perpetual leg, because it lists no perpetual and publishes no index, mark or funding.
Its spot book feed is usable, as [`websocket.md`](./websocket.md) shows, but the catalog would need a hand written loader, since no CCXT class exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Ripio Trade API Documentation v4.0, a Redoc page whose OpenAPI document is embedded in the HTML | https://apidocs.ripiotrade.co/ | 2026-10-10 03:00 UTC | Ripio Trade, all countries | endpoints, limits, errors, WebSocket topics, sections 2, 3 and 7 |
| S2 | Ripio Trade Términos y Condiciones, Argentina, last updated 5/4/2026, with the fee table image | https://terms.ripio.com/ar/ripio-trade | 2026-10-10 03:14 UTC | Moonbird S.R.L., Argentina | operator, sanctions, fee table, tier rule, sections 1, 2, 4 and 5 |
| S3 | Ripio wallet terms for Argentina and Brazil, and the terms index | https://terms.ripio.com/ar/wallet | 2026-10-10 03:06 UTC | Moonbird S.R.L. and Ripio Brasil Ltda | Brazilian entity name, wallet promotions, product menu, sections 1 and 5 |
| S4 | Traders Union and Gainium fee pages, third party | https://tradersunion.com/brokers/crypto/view/ripio/fees/ | 2026-10-10 | third party | not relied on. Traders Union says 0.5 % maker and taker, and Gainium lists BitcoinTrade at 0.25 % maker and 0.5 % taker, which matches level 1 of S2 |
| S5 | CCXT on GitHub, `ts/src` listing at master and raw files at tags 1.95.1, 2.0.1, 2.5.1, 3.0.1, 3.1.1, 3.1.60 and 4.0.1 | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-10-10 | CCXT | section 8 |
| S6 | CoinGecko API `exchanges/list` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-10-10 03:08 UTC | CoinGecko | no Ripio entry, sections 1 and 3 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/ripio/fees-probe.py) | | 2026-10-10 UTC | this host, Canadian exit | terms date, entity, fee image hash, Brazilian page status, Wayback 429, private fee call 401 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/ripio/rest-probe.py), all modes | | 2026-10-10 UTC | this host, Canadian exit | catalog, countries, tickers, DNS, see [`rest.md`](./rest.md) |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/ripio/ws-probe.py), all modes | | 2026-10-10 UTC | this host, Canadian exit | WebSocket access, see [`websocket.md`](./websocket.md) |
