# Buda Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:41 to 05:16 UTC, from the development host near Seattle, through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada, so every access result below is from that Canadian exit.

This profile covers Buda (buda.com), a Chilean spot exchange with fiat markets in Chilean, Colombian and Peruvian pesos and soles.
Buda lists no perpetual, no dated future and no option, so the profile follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) and records the spot schedule.
CCXT 4.5.68 has no Buda class, see section 8.
Every buda.com web page tried answered this host with HTTP 403 and a Cloudflare "Just a moment..." challenge, and WebFetch got 403 too, so the documentation, fee page and terms were read from Wayback Machine snapshots, and the fee numbers come from the public API, which did answer.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Buda.com SpA, RUT 76.415.528-9, Los Conquistadores 2461, Providencia, Santiago, Chile | S3 |
| related entity | Buda Bridge SpA, RUT 77.615.126-2, executes the spread (quote) operations as intermediary | S3 |
| affiliates | the site's country menu lists Argentina, Chile, Colombia, Perú and Global, and the footer names "Buda.com SpA y sus empresas filiales" | S2 |
| markets served | spot in CLP, COP and PEN, plus BTC and USDC quoted pairs, 26 markets | P1 |
| regulation | the terms say Buda.com provides services regulated by the CMF under Ley 21.521 (Ley Fintec) | S3 |
| regulation, other wording | the fee page footer says "Buda.com SpA y sus empresas filiales no son entidades reguladas ante el regulador financiero local" | S2 |
| excluded | "El Servicio no se ofrece, comercializa ni se presta en los Estados Unidos de América, Canadá, ni para quienes pudieren ser considerados “US Persons” o “Canadian Persons”." | S3 |
| US persons | may not trade, by the clause above, and attempts from the US or Canada "podrá ser bloqueado" | S3 |
| sanctions | the user warrants not being on an economic sanctions list | S3 |
| access from this host | the public REST API and the WebSocket answered from the Canadian exit, and every HTML page including the API documentation answered 403 with a Cloudflare challenge | P1, P2, S4 |

The two regulation statements come from the same site, both in snapshots of 2026-07-12, and they disagree.
Both are written here, and neither was checked against a CMF register.

| context | value | source |
|---|---|---|
| CoinGecko trust score and rank | 3, rank 144 on 2026-09-23 at 04:51 UTC, against rank 139 in the survey's list | S7 |
| CoinGecko 24 h volume | 18.81 BTC over 15 tracked tickers, led by USDC-CLP at about 646,000 USD and BTC-CLP at about 407,000 USD | S7 |
| CoinGecko derivatives list | 214 entries, none is Buda | S7 |

## 2. Quick answer

| product | maker | taker | maker ppm | taker ppm | source |
|---|---|---|---|---|---|
| spot, crypto markets (BTC, ETH, BCH, LTC, SOL against CLP, COP, PEN, BTC and USDC) | 0.4 % | 0.8 % | 4,000 | 8,000 | `maker_fee` and `taker_fee` of `GET /markets`, and tier 1 of `GET /tiers`, P1 |
| spot, stablecoin against fiat (USDC and USDT against CLP, COP, PEN) | 0.2 % | 0.5 % | 2,000 | 5,000 | `GET /markets`, P1 |
| spot, `USDT-USDC` | 0 % | 0 % | 0 | 0 | 0.2 % and 0.5 % with `maker_discount_percentage` and `taker_discount_percentage` `"100.0"`, P1 |
| perpetuals | absent | absent | | | section 3 |

The VIP 0 number for this profile is the crypto spot taker, 8,000 ppm, since the only crypto market quoted in the engine's USD, USDC and USDT settlement family is `BTC-USDC`.
The market list states fees as percent numbers, so `"taker_fee": 0.8` is 0.8 %, and the documentation example writes the same field as the string `"0.8"`, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | absent | `GET /markets` lists 26 spot markets and no contract field, the documentation describes no derivative, and CoinGecko's derivatives list has no Buda, P1, S1, S7 |
| dated futures | absent | same |
| options | absent | same |
| spot | present | 26 markets: 7 against CLP, 7 against COP, 7 against PEN, 3 against BTC, 2 against USDC, none disabled or illiquid, P1 |
| OTC desk, remittances, crypto-backed loans | present on the site, out of scope | the site menu shows "OTC", the documentation has a "Cross Border Payments" section, and the site strings mention loans, S1, S2 |

The two USDC-quoted markets are `BTC-USDC` and `USDT-USDC`.
`BTC-USDC` traded 0.0 BTC in the 24 h before both catalog runs, with a quoted spread of 2.7 bps in the first run and 33.5 bps in the second, P1.

## 4. Spot tiers

`GET https://www.buda.com/api/v2/tiers` is public and not in the documentation, and it returned the same 13 rows in both runs, P1.
Tiers are set by the trailing monthly traded volume in USD.

| tier | monthly traded, USD | maker | taker | maker ppm | taker ppm | trading requests per minute |
|---|---|---|---|---|---|---|
| 1 | 0 to 1,000 | 0.40 % | 0.80 % | 4,000 | 8,000 | 100 |
| 2 | 1,000 to 2,500 | 0.36 % | 0.73 % | 3,600 | 7,300 | 100 |
| 3 | 2,500 to 6,000 | 0.32 % | 0.66 % | 3,200 | 6,600 | 100 |
| 4 | 6,000 to 15,000 | 0.28 % | 0.59 % | 2,800 | 5,900 | 100 |
| 5 | 15,000 to 40,000 | 0.24 % | 0.52 % | 2,400 | 5,200 | 100 |
| 6 | 40,000 to 100,000 | 0.20 % | 0.45 % | 2,000 | 4,500 | 100 |
| 7 | 100,000 to 250,000 | 0.16 % | 0.38 % | 1,600 | 3,800 | 250 |
| 8 | 250,000 to 600,000 | 0.12 % | 0.31 % | 1,200 | 3,100 | 250 |
| 9 | 600,000 to 1,500,000 | 0.10 % | 0.25 % | 1,000 | 2,500 | 250 |
| 10 | 1,500,000 to 3,800,000 | 0.08 % | 0.19 % | 800 | 1,900 | 250 |
| 11 | 3,800,000 to 9,500,000 | 0.07 % | 0.13 % | 700 | 1,300 | 250 |
| 12 | 9,500,000 to 24,000,000 | 0.06 % | 0.12 % | 600 | 1,200 | 250 |
| 13 | 24,000,000 and above | 0.05 % | 0.11 % | 500 | 1,100 | 250 |

The last column is `order_quota`, and it matches the documentation's trading rate limit, 100 requests per minute per market below tier 7 and 250 from tier 7, which is 100,000 USD in 30 days, S1.
Tier 1 equals the crypto market fee in `GET /markets`, but how the tiers apply to the stablecoin markets, whose base fee is 0.5 % and 0.2 %, is Not publicly specified in anything this host could read.
The fee page itself renders its table in the browser, and the archived HTML of 2026-07-12 holds no tier table, only the per market fee JSON, S2.

## 5. Discounts that change the taker

| discount | value | source |
|---|---|---|
| per market discount | `taker_discount_percentage` and `maker_discount_percentage` are `"0.0"` on 25 markets and `"100.0"` on `USDT-USDC`, P1 | P1 |
| per market tier discount | `taker_discount_tiers` and `maker_discount_tiers` are `{}` on 25 markets and `{"*": "0.0"}` on `USDT-USDC`. The documentation example shows `{"*": 0.0, "6": 0.2, "7": 0.3}`, a discount keyed by tier | P1, S1 |
| zero fee pair | `USDT-USDC` at 100 % discount, no end date in the API | P1 |
| token holding | none found in S1 or S2 | S1, S2 |
| referral | the footer links a "Programa referidos", terms Not verified | S2 |
| market maker program | Not publicly specified | |

## 6. Funding as a cost

None.
Buda lists no perpetual, so there is no funding rate, interval or settlement.

## 7. Liquidation, settlement and delisting

None of these apply to spot.
The terms name network fees on crypto withdrawals and bank or processor fees on fiat deposits and withdrawals as separate costs, S3.
Deposit and withdrawal fees are looked up per currency with `GET /currencies/<currency>/fees/withdrawal`, which returned `{"fee":{"name":"withdrawal","percent":0,"base":["0.00001984","BTC"]}}` for BTC to a single curl at 04:48 UTC.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | `ccxt.exchanges` has 104 ids and no `buda`, and `server/node_modules/ccxt/js/src/` has no `buda.js` | P1 |
| current CCXT master | `ts/src` at commit `1d8b674434`, 2026-09-22 12:48 UTC, lists 112 entries and none matches `buda` | S5 |
| history | `js/buda.js` exists at tag 1.95.1 and `ts/src/buda.ts` at tag 3.0.1, and `js/src/buda.js` is gone by tag 4.0.1 | S5 |
| old fee mapping | tag 3.0.1 `ts/src/buda.ts` line 295 sets `taker` to `taker_fee / 1000`, which reads 0.8 % as 0.0008, ten times too low | S5 |
| old fee constant | the same file, lines 148 to 175, carried a seven step table from 0.8 % to 0.2 % taker, which no longer matches `GET /tiers` | S5 |

So `market.taker` has no value to report for Buda in CCXT 4.5.68, and `ccxtTakerPpm` is null.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 8,000, only if a spot leg is ever modelled | tier 1 crypto taker, P1 |
| `ccxtTakerPpm` | none | no CCXT class exists |

Buda cannot join the engine today, because it lists no perpetual, has no CCXT class for the connector at [`registry.ts`](../../../server/src/venues/registry.ts) line 29 to build, and quotes only two markets in the USD, USDC and USDT settlement family, `BTC-USDC`, which traded nothing in 24 h, and the stablecoin pair `USDT-USDC`.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Buda.com API documentation, Wayback snapshot of 2026-05-18, whose changelog ends at 9 July 2025 | https://web.archive.org/web/20260518031808/https://api.buda.com/ | 2026-09-22 | Buda.com, all countries | market fields, rate limit tiers, discount tier example, sections 2, 4, 5 |
| S2 | Buda.com "Comisiones del servicio", Wayback snapshot of 2026-07-12 | https://web.archive.org/web/20260712071245/https://www.buda.com/comisiones | 2026-09-22 | Buda.com SpA and affiliates | country menu, regulation footer, embedded market fees, sections 1, 3, 5 |
| S3 | Términos y Condiciones Buda.com, Wayback snapshot of 2026-07-12 | https://web.archive.org/web/20260712071244/https://www.buda.com/terminos-y-condiciones | 2026-09-22 | Buda.com SpA, Chile | entity, CMF statement, US and Canada exclusion, sanctions, costs, sections 1 and 7 |
| S4 | live pages https://api.buda.com/, https://www.buda.com/comisiones, https://www.buda.com/terminos-y-condiciones, https://soporte.buda.com/ | same | 2026-09-23 04:41 to 04:47 UTC | this host | HTTP 403 with a Cloudflare "Just a moment..." page of about 5.3 KB each, so the snapshots above were used |
| S5 | CCXT on GitHub, `ts/src` listing at master and raw files at tags 1.95.1, 3.0.1, 3.1.1, 4.0.1, 4.1.1 | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | section 8 |
| S6 | Nchan documentation | https://nchan.io/ | 2026-09-22 | Nchan | named by S1 as the realtime server, see [`websocket.md`](./websocket.md) |
| S7 | CoinGecko API `exchanges/buda` and `derivatives/exchanges/list` | https://api.coingecko.com/api/v3/exchanges/buda | 2026-09-23 04:51 UTC | CoinGecko | trust rank, volume, no derivatives, section 1 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/buda/rest-probe.mjs) `catalog`, runs at 04:52 and 05:13 UTC on 2026-09-23 | | 2026-09-22 local | this host, Canadian exit | markets, fees, tiers, CCXT, per market spreads and volume |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/buda/ws-probe.mjs), all modes | | 2026-09-22 local | this host, Canadian exit | WebSocket access, see [`websocket.md`](./websocket.md) |
