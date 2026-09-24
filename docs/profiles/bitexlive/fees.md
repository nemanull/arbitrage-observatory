# Bitexlive Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:23 to 04:53 UTC on 2026-09-23, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers spot trading on Bitexlive, because the venue lists no perpetuals, see section 3.
No CCXT 4.5.68 class exists for it, see section 8.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitexlive/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitexlive/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 Pacific, 2026-09-23 UTC | this profile |
| operator | Bitex Trade LLC, registered in the Republic of Georgia under Registration No. 412795300, holding Kutaisi Free Zone Financial License No. L38-2025 as a Virtual Asset Service Provider | S3 |
| second entity | Bitex Pay LLC, Registration No. 412795284, Kutaisi Free Zone Financial License No. L37-2025, for electronic money, wallets and payments | S3 |
| terms date | "Last Updated: 22 October 2025" | S3 |
| CoinGecko listing | country "Germany", description "located in Kazakhstan", established 2017, trust score 4, trust score rank 121 on 2026-09-23 UTC, 19 pairs | S4 |
| who may trade | not stated beyond legal age and capacity | S3 |
| excluded regions | none listed. The licensed services of both entities are offered "exclusively to individuals who are neither residents nor citizens of Georgia" | S3 |
| US persons | not named anywhere in the terms, so neither admitted nor excluded in writing | S3 |
| governing law | the terms name "any jurisdiction" for governing law and disputes, an unfilled template value | S3 |
| access from this host | every public page, every documented REST call and the web app's WebSocket answered, with no refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 | P1, P2 |

The access results are from the Canadian VPN exit named above, reported by Cloudflare as `loc=CA` at the `SEA` and `YVR` edges, and not from a US address.
The survey list ranked the venue 117 by CoinGecko trust, and the CoinGecko exchange API returned `trust_score_rank` 121 at 04:23 UTC on 2026-09-23, S4.

The terms forbid accessing the platform "by any means other than the interface provided by us", S3.
The documented REST API is such an interface, S1.
The WebSocket is not documented, and it is only known from the site's own bundle, see [`websocket.md`](./websocket.md) section 1.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, every market | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | S2 |
| perpetuals | none listed | none listed | section 3 |

The Status/Fees page publishes one "Trade Commission" of 0.10 % for each of its three market groups, BTC, USDT and ALTS, S2.
It names no maker rate and no taker rate, so both are read as the single commission.
That reading is an inference from the absence of a split, and it is not confirmed by an account.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | the site menu holds exchange, market and dOTC only. `https://bitexlive.com/futures` returned 404. The API page documents four spot calls and account calls only, S1. The web app bundle holds no perpetual, leverage, derivative, funding rate, mark price or index price string, and its four case-insensitive `futures` matches are the icon library's `futureStyleIds`, S7 |
| USDC-M or coin-M perpetuals | absent | same evidence |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| perpetuals on CoinGecko | absent | the derivatives exchanges list held 214 venues on 2026-09-23 UTC, none of them Bitexlive, S5 |
| spot | present | 21 pairs, all quoted in USDT, all `tradesEnabled` true, P1 `catalog` |
| margin | absent | no margin product is offered, although the terms reserve the right to "impose margin or collateral requirements", S3 |
| dOTC marketplace | present, not researched | a separate site at `https://dotc.bitexlive.com` |
| deposit and withdrawal | one line only | the Status/Fees page lists a 0.10 % deposit commission for every coin and a 0.10 % or 1.00 % withdrawal commission per coin, S2 |

CoinGecko reported 18 tickers for the venue, and the venue's own ticker call returned 21, P1 `catalog`, S4.

## 4. Spot tiers

| tier | qualification | maker | taker |
|---|---|---|---|
| single tier | none | 0.10 % | 0.10 % |

No VIP table, no volume tier and no qualification rule is published, S2.
The words "VIP", "maker", "taker" and "discount" appear nowhere on the Status/Fees, listing, support or terms pages, S2, S3.
The API page uses "maker" only inside the trade field `isBuyerMaker`, S1.

## 5. Discounts that change the taker

None is published.
The venue lists its own pair `BTXK_USDT`, but no page ties a fee discount to holding BTXK, S2.
No referral, market maker or zero fee promotion was found.

## 6. Funding as a cost

Not applicable.
The venue lists no perpetual, so it charges no funding, and it publishes no index, mark or funding rate, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

No liquidation charge exists, since the venue offers no margin or derivative product, section 3.
No delisting rule or delisting charge is published.
Spot trades settle to the account balance, and the terms add only that the operator may "refuse or cancel any transaction, limit trading" at its sole discretion, S3.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange classes, none named like `bitexlive` or `bitex` | P1 `ccxt` |
| CCXT master on GitHub, `ts/src` | 105 files listed on 2026-09-23 UTC, none named like `bitexlive` or `bitex` | S6 |
| `ts/src/bitexlive.ts` on master | HTTP 404 | S6 |

So there is no `market.taker` to read, and `ccxtTakerPpm` has no CCXT source line.

## 9. Recommended registry values

None, because the venue should not enter [`registry.ts`](../../../server/src/venues/registry.ts).
The engine's catalog keeps only active swap markets at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196, and Bitexlive has neither a swap market nor a CCXT class.
If a spot survey ever used it, `takerPpm` would be 1,000 from S2 and `ccxtTakerPpm` would stay unset.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitexlive API | https://bitexlive.com/api | 2026-09-23 UTC | Bitexlive, global | public calls, no derivative calls, `isBuyerMaker`, sections 1, 3, 4 |
| S2 | Bitexlive Status/Fees | https://bitexlive.com/fees | 2026-09-23 UTC | Bitexlive, global | 0.10 % trade commission per market group, deposit and withdrawal commissions, no tiers, sections 2 to 5 |
| S3 | Bitexlive Terms of Use, last updated 22 October 2025 | https://bitexlive.com/terms | 2026-09-23 UTC | Bitex Trade LLC and Bitex Pay LLC, Georgia | entities, licences, eligibility, prohibited access means, governing law, sections 1, 3, 7 |
| S4 | CoinGecko exchange record `bitexlive` | https://api.coingecko.com/api/v3/exchanges/bitexlive | 2026-09-23 UTC | CoinGecko | country, trust score and rank, pair and ticker counts, sections 1 and 3 |
| S5 | CoinGecko derivatives exchanges list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 UTC | CoinGecko | 214 derivative venues, Bitexlive absent, section 3 |
| S6 | CCXT master `ts/src` listing and `ts/src/bitexlive.ts` | https://api.github.com/repos/ccxt/ccxt/contents/ts/src and https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/bitexlive.ts | 2026-09-23 UTC | CCXT | no class on master, section 8 |
| S7 | Bitexlive web app bundles | https://bitexlive.com/build/assets/app-DU8dfZ9k.js and https://bitexlive.com/build/assets/index-Cf4Q9gzi.js | 2026-09-23 UTC | Bitexlive | no derivative strings, socket configuration, section 3 |
| P1 | `rest-probe.mjs` modes `ccxt`, `host`, `catalog`, `book`, `trades`, `poll` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitexlive/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1, 3, 8 |
| P2 | `ws-probe.mjs` modes `book`, `errors`, `silence`, `deflate` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitexlive/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | section 1 |
