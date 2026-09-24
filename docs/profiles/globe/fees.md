# Globe Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:12 to 04:39 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that exits in Canada (Cloudflare trace `loc=CA`, `colo=SEA`).

This profile covers the fees of Globe for its perpetual futures, the product the survey researches, since Globe lists perpetuals.
Globe has no CCXT class, see section 8.
Every access result below was seen from that Canadian VPN exit.
The dates in this profile are UTC unless they say otherwise, and the local date near Seattle was still 2026-09-22 during every probe.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Globe Derivative Trading INC, "a company incorporated in Republic of Panama under company number 155772232, trading as Globe" | S3 |
| governing law | Republic of Panama, courts of Panama City | S3 |
| terms version | "Last updated: 29 Oct 2025" | S3 |
| who may trade | a person 18 or over who is not "a resident of, or be established (including but not limited to holding a valid passport) in the United States of America or any other jurisdiction where our Services are restricted" | S3 |
| US persons | may not trade, by the eligibility clause above | S3 |
| supported countries | a list of 237 names, which includes Canada and does not include the United States, the United Kingdom, Iran, Cuba, North Korea, Syria or Afghanistan | S4 |
| CoinGecko context | "Globe (Derivatives)", country Panama, established 2021, 27 perpetual pairs, 24 h volume 240.11 BTC, open interest 749.26 BTC, read on 2026-09-23 at about 04:11 UTC | S9 |

The supported country list starts with Korea, Japan, Russia, China and Turkey and then runs alphabetically, and it carries no heading that explains the order.
Access from this host was not refused anywhere.
The home page, the fee page, the API documentation, the help articles, every public REST call and both WebSocket URLs answered normally, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| linear USD perpetuals | 0 %, 0 ppm | 0.05 %, 500 ppm | S1, S2, P2 |

The fee page says "Standard exchange fees of 0%/0.05% (Maker/Taker) apply." and the tier table it loads names that row "Base", S1 and S2.
The `product-detail` WebSocket channel reported `"maker_fee": 0` and `"taker_fee": 0.0005` for all 30 perpetuals, P2.
The API documentation calls both fields a "percentage", S6, but the wire value `0.0005` is a fraction, since the fee page's 0.05 % is 0.0005.
The help center FAQ still says "Takers pay a small fee of 0.075% of the notional trade value.", S7.
That page is older than the fee page and the wire, both of which read 0.05 %.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| linear perpetuals, quoted in USD with USD margin | yes, 30 listed, 28 `Active` and 2 `Suspended` | `GET /api/v1/ticker/contracts`, P1, and `product-list` on the socket, P2 |
| inverse perpetuals | no | every row has `contract_type` `Vanilla` on REST and `Linear` on `product-detail`, although the documentation examples show `Inverse`, S6 |
| quanto perpetuals | no | same rows |
| `BTC-VIX` volatility perpetual | no | named in S5 and S6, absent from the catalog and from `product-list` |
| dated futures | no | none in the catalog, and CoinGecko reports `number_of_futures_pairs` 0, S9 |
| options | no | none in the catalog or the documentation |
| spot | yes, 3 pairs: `BTC/USDT`, `ETH/USDT`, `GDT/USDT` | `GET /api/v1/ticker/pairs` and `product-list`, P1 and P2 |

The perpetuals are one family.
The help article says "Globe's perpetual futures are all settled in USD (US Dollars)" and "All margin is denominated in USD.", S5.
The two suspended contracts are `IOTA-PERP` and `ALPHA-PERP`.
CoinGecko's 27 is the 28 active contracts less `PEPE-PERP`, which had a 24 h quote volume of 0 on every read, P1 and S9.

## 4. Perpetual tiers

The tier table is the JSON that the fee page loads at `https://globe.exchange/app/fees/retail_fee_tiers`, S2.
It carries spot and perpetual rates side by side, and they are equal on every tier.

| tier | name | perpetual maker | perpetual taker | taker ppm | GDT holdings | or 30 day trading volume (USD) | liquidation |
|---|---|---|---|---|---|---|---|
| 1 | Base | 0 % | 0.05 % | 500 | none | none | 0.15 % |
| 2 | VIP 1 | 0 % | 0.047 % | 470 | 100 | 10,000 | 0.15 % |
| 3 | VIP 2 | 0 % | 0.045 % | 450 | 1,000 | 100,000 | 0.15 % |
| 4 | VIP 3 | 0 % | 0.04 % | 400 | 10,000 | 1,000,000 | 0.15 % |
| 5 | VIP 4 | 0 % | 0.035 % | 350 | 100,000 | 10,000,000 | 0.15 % |
| 6 | VIP 5 | 0 % | 0.03 % | 300 | 1,000,000 | 100,000,000 | 0.15 % |

The row for the Base tier, as served.

```json
{"tier":1,"name":"Base","spot_maker":0.0,"spot_taker":0.05,"perp_maker":0.0,"perp_taker":0.05,"liquidation":0.15,"gdt_holdings":null,"trading_volume":null}
```

### Qualification

The column headers of the rendered table are "GDT holdings", an unlabelled "or" column, and "30 day trading volume ($)", in the page script `/_next/static/chunks/pages/fees-dea226c1cd1a5f69.js`, S1.
So a tier is reached by either the GDT balance or the 30 day volume.
The fee page adds that "Both spot and derivatives trading volume count towards the trading volume requirement", and that "GDT holdings include all GDT held in Spot and Wealth accounts. Both staked and unstaked GDT held in your account count towards your GDT holdings.", S1.
How often the tier is recomputed is Not publicly specified.

## 5. Discounts that change the perpetual taker

| discount | rule | source |
|---|---|---|
| GDT holding | the GDT column of section 4, "applied to all spot and perpetual orders" | S1 |
| stacking | "GDT holding and VIP tier trading fee discounts do not stack. The highest fee discounts apply." | S1 |
| maker rebate | none, every tier's maker is 0 %, although a string in the site bundle `/_next/static/chunks/pages/_app-a09abba08c608a5c.js` says a maker "receive[s] a rebate" | S2 |
| referral and affiliate | an affiliate program is linked from the footer, and no page read here says it changes the referee's taker | not verified |
| market maker program | Not publicly specified | |
| zero fee promotion | none found on the fee page on 2026-09-23 | S1 |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| interval | every 8 hours, "three times a day, always at the following times: 00:00 UTC, 08:00 UTC and 16:00 UTC" | S5 |
| interval on the wire | `funding_period` 28800 s on all 30 contracts | P2 |
| next settlement on the wire | `next_funding_time` 1790164800000, 2026-09-23 12:00 UTC, on all 30 contracts at 04:20 and 04:27 UTC | P1, P2 |
| premium | `premium_rate = (mark_price − index_price) / index_price` | S5 |
| rate | `funding_rate = max(0.05 %, premium_rate) + min(−0.05 %, premium_rate)`, so a premium inside ±0.05 % gives 0 and a larger one is moved 0.05 % toward zero | S5 |
| averaging | "The final funding rate is then computed using a 8 8 hour time weighted average price over rates." | S5 |
| cap and floor | none published | S5 |
| payment | `funding_payment = number_of_contracts · index_price · funding_rate`, longs pay shorts when the rate is positive | S5 |
| who is charged | only positions held at the settlement instant | S5 |
| venue fee on funding | "Globe does not charge any fees on funding rates paid out or received." | S1 |
| unit on the wire | a percentage: the documentation says "Current funding rate percentage", S6, and `XTZ-PERP` read `-0.07333333333333333`, which is −733 ppm per 8 h as a percentage and would be −7.3 % per 8 h as a fraction | P1 |

The documented schedule and the wire disagree.
A next settlement of 12:00 UTC read at 04:20 UTC, with an 8 h period, puts the settlements at 04:00, 12:00 and 20:00 UTC, not at 00:00, 08:00 and 16:00 UTC.
The settlement instant itself was not captured, and no public funding history call is documented, see [`rest.md`](./rest.md) section 4.

Every published rate was an integer multiple of one three-hundredth of a percent, about 33 ppm, on all 30 contracts, P1.
CoinGecko multiplies the percentage by 100 once more, and shows `BTC-PERP` at `-0.667` where Globe publishes `-0.006666666666666667`, S9 and P1.

## 7. Liquidation, settlement and delisting

| charge | value | source |
|---|---|---|
| liquidation fee | 0.15 % on every tier, the `liquidation` field of the tier table | S2 |
| insurance fund | covers losses past zero equity, "you will never owe Globe money" | help article "Leverage", S8 |
| auto deleveraging | last resort when the liquidation engine cannot trade a position out, ranked by profit and leverage | S8 |
| settlement or delivery fee | none, since there is no dated product | |
| delisting | Not publicly specified. Two contracts are `Suspended` and still listed with empty books, see [`websocket.md`](./websocket.md) section 4 | P1, P2 |
| deposits and withdrawals | "Globe does not charge any fees on deposits and withdrawals." plus network fees | S1 |

## 8. CCXT

| check | result |
|---|---|
| `require('ccxt').exchanges` from `server/`, CCXT 4.5.68 | 104 ids, none matching `glob` |
| `server/node_modules/ccxt/js/src/` | no file matching `glob` |
| CCXT master on GitHub, `ts/src` listed through the GitHub contents API on 2026-09-23 | 112 entries, none matching `glob` |

So there is no `market.taker` to read, and no CCXT source line to cite.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 500 | the VIP 0 perpetual taker of 0.05 % on the fee page, S1, the Base row of the tier table, S2, and `taker_fee` 0.0005 on all 30 contracts, P2 |
| `ccxtTakerPpm` | none | there is no CCXT class, so the registry entry cannot be built on `createExchange` as it stands, see [`rest.md`](./rest.md) section 2 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Trading fees and VIP program | https://globe.exchange/fees | 2026-09-23 | Globe, global | sections 2, 4, 5, 6, 7 |
| S2 | Retail fee tiers, the JSON the fee page loads | https://globe.exchange/app/fees/retail_fee_tiers | 2026-09-23 | Globe, global | sections 2, 4, 5, 7 |
| S3 | Terms of Use, last updated 29 Oct 2025 | https://globe.exchange/legal/terms-of-use | 2026-09-23 | Globe Derivative Trading INC, Panama | section 1 |
| S4 | List of supported countries | https://globe.exchange/support/list-of-supported-countries | 2026-09-23 | Globe, global | section 1 |
| S5 | Perpetual Contracts | https://globe.exchange/support/perpetual-contracts | 2026-09-23 | Globe, global | sections 3 and 6 |
| S6 | Globe API documentation | https://globe.exchange/developers | 2026-09-23 | Globe, global | sections 2, 3, 6 |
| S7 | Trading on Globe FAQs | https://globe.exchange/support/trading-on-globe-faqs | 2026-09-23 | Globe, global | the stale 0.075 % taker, section 2 |
| S8 | Leverage and Auto Deleveraging | https://globe.exchange/support/leverage and https://globe.exchange/support/adl | 2026-09-23 | Globe, global | section 7 |
| S9 | CoinGecko derivatives exchange `globe_exchange_derivatives` | https://api.coingecko.com/api/v3/derivatives/exchanges/globe_exchange_derivatives?include_tickers=all | 2026-09-23 | CoinGecko | sections 1, 3, 6 |
| S10 | CCXT master source listing | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master | 2026-09-23 | CCXT | section 8 |
| P1 | `rest-probe.mjs catalog` and `anchor` | [`rest-probe.mjs`](../../../scripts/probes/venues/globe/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 3 and 6 |
| P2 | `ws-probe.mjs book` | [`ws-probe.mjs`](../../../scripts/probes/venues/globe/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 2, 3, 6 |
