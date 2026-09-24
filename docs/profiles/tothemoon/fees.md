# Tothemoon Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:20 to 03:56 UTC), from the development host near Seattle.

This profile covers the fees of Tothemoon, formerly Cryptology, for its one perpetual family, USDT-margined linear perpetuals.
CCXT 4.5.68 has no class for the venue, see section 8.
The WebSocket and REST sides are in [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).
Sources (S) and probe runs (P) are in section 10.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22, Seattle local time | this profile |
| venue name | Tothemoon, listed by CoinGecko under the id `cryptology` with the name Tothemoon, established 2018, country Lithuania, trust score 6, trust rank 86 on 2026-09-23 UTC (the survey prompt says 84) | S10 |
| perpetual entity | Tothemoon Global Inc., a company incorporated in the Republic of Panama, 34-20, 34th Street, Panama City | S2 |
| spot entity, EEA clients | Brilliantscope Trading Limited, Cyprus, registration HE 424435, authorised by CySEC as a crypto-asset service provider under MiCA | S3 section 2.2 |
| spot entity, outside the EEA | Tothemoon Global Inc., or another group entity named at onboarding | S3 section 2.3 |
| regions excluded from perpetuals | every EU member state, Iceland, Liechtenstein, Norway, Switzerland, the United Kingdom, the United States of America and its territories (American Samoa, Guam, Northern Mariana Islands, Puerto Rico, U.S. Virgin Islands), Canada, Japan, South Korea, China, the Russian Federation, Belarus, and sanctioned or conflict territories such as Iran, North Korea, Syria and occupied Ukraine | S2, "Restricted jurisdictions" paragraph |
| regions excluded from the platform | the Terms of Use list is shorter: it keeps the United States, the United Kingdom, Canada, Japan, China, Russia and the sanctioned territories, and does not list the EEA | S3 section 8.2 |
| may US persons trade the perpetuals | No. The United States of America is on both lists | S2, S3 |
| what this host saw | the public REST and WebSocket endpoints answered from the development host near Seattle with no refusal | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The Contracts T&Cs were last updated 2026-01-12, and parts of them are stale against the live catalog.
They say "the futures contracts only operate using BTC or ETH as the underlying asset" and "The face value of each futures contract is 1 USD", S2.
The live catalog lists 13 USDT-margined contracts on 13 underlyings with contract sizes in base coin, P1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M linear perpetuals | 0.05 %, 500 ppm | 0.05 %, 500 ppm | S2 "Trading Fees: Maker 0,05%, Taker 0,05%", S4 "Tothemoon has constant trading fees for perpetual futures. Taker fees: 0.05% Maker fees: 0.05%", and the fee config the fees page reads, `{"maker":0.05,"taker":0.05,"type":"Futures"}` in P7 |
| spot, for the coverage matrix only | 0.2 %, 2,000 ppm | 0.2 %, 2,000 ppm | S5 "Crypto to Crypto: 0,2%", and `{"maker":0.2,"taker":0.2,"type":"Spot"}` in P7 |

The same 0.05 % applies at every volume, because no tier table exists, see section 4.
The fees page itself renders its numbers in the browser from that config, and it hides the Futures row unless a client-side condition holds, in the page chunk `pages/fees-92c305a6157b4e6b.js` (`t.filter(e=>"Futures"!==e.type)`), S6.

## 3. Coverage matrix

| product | present | count and note | source |
|---|---|---|---|
| USDT-M linear perpetuals | yes | 13, all `is_enabled` true: ADA, ATOM, AVAX, BCH, BTC, DOGE, DOT, ETC, ETH, LTC, SOL, UNI and XAU (pair `XAUT_USDT`), each `*_USDT_PERPETUAL` | P1 |
| USDC-M perpetuals | no | none in the catalog | P1 |
| coin-margined perpetuals | no, retired | `BTC_PERPETUAL`, `ETH_PERPETUAL` and ten other `*_PERPETUAL` ids with no quote asset survive only in the `turboEmergencyMode.*` map. The FAQ describes the BTC one as a 1 USD contract with profit in BTC. The `BTC_PERPETUAL` book channel returns an empty book stamped 2023-12-15 13:59:51 UTC | P1, P4, S4 |
| dated futures | no, retired | `BTC_H22`, `BTC_M22` and `BTC_U22` survive only in the emergency map. The Contracts T&Cs still name "Futures contracts with expiration" | P1, S2 |
| options | no | none named anywhere | S1, P1 |
| spot | yes | 362 pairs in REST `get-trade-pairs` (USDT 221, USDC 113, USD 11, EUR 9, BTC 8), 379 on the socket's `photonInstruments.*` | P5, P1 |

CoinGecko's derivatives exchange list of 2026-09-23 UTC has 214 entries and none is Tothemoon or Cryptology, and CoinGecko tracks only its 100 spot tickers, S10.
So the perpetuals exist but CoinGecko does not track them.

## 4. Perpetual tiers

No tier table is published.
The FAQ says "Tothemoon has constant trading fees for perpetual futures", S4, and the Contracts T&Cs give one maker and one taker rate, S2.
The FAQ's worked examples still charge a 0.075 % taker on a 1 USD BTC contract, S4, which matches neither the stated rate nor the live contracts.

### Qualification

None, since there is one rate.

## 5. Discounts that change the perpetual taker

| discount | effect | source |
|---|---|---|
| Reward Center bonuses | "Bonuses earned through the Reward Center can cover up to 50% of your trading fees". This pays part of the fee with bonus balance and does not change the rate | S7, updated 2025-12-23 |
| futures deposit bonus | the landing page advertises a $100 bonus on a first futures deposit of $100, a margin bonus and not a fee change | S9 i18n strings |
| token holding, referral rebate, market maker program | none found in the Terms, the Contracts T&Cs, the fees FAQ or the web app strings | S2 to S5, S9 |
| zero fee promotions | only a spot promotion on `BTCZ/USDT`, with no end date in the strings | S9 i18n strings |
| wash trading | "your account will be penalized with an automatic transaction fee on the value of each transaction", with no rate given | S2 |

Three spot pairs carry a per-pair `maker_fee` and `taker_fee` of `0.001` in `photonInstruments.*`: `DOGE_BTC`, `SHIB_USD` and `SHIB_USDT`, and 376 carry null, P1.
Whether that 0.1 % overrides the 0.2 % spot rate is Not publicly specified.

## 6. Funding as a cost

| item | documented | on the wire, 2026-09-23 UTC | source |
|---|---|---|---|
| formula | Funding Rate = Interest Rate Differential + Premium Index. Premium Index = (max(0, Impact Ask Price minus Mark Price) minus max(0, Mark Price minus Impact Bid Price)) / Index Price, with impact prices as the VWAP for about 10 BTC | `premium_index` and `interest_rate` both zero, sent as `"0"` or `"0.000000000000000000"`, on every ticker frame of all 13 contracts | S4, P3 |
| interval | every 8 hours at 04:00, 12:00 and 20:00 UTC | `funding_interval` 28,800,000 ms on 11 contracts, 3,600,000 ms on `AVAX_USDT_PERPETUAL` and 21,600,000 ms on `LTC_USDT_PERPETUAL` | S2, S4, P3 |
| cap and floor | Not publicly specified | not observable, since every rate is 0 | S2, S4 |
| current rate | | `funding_rate` `"0"` or `"0.000000000000000000"` on every frame of all 13 contracts in two 45 s runs | P3 |
| is funding charged | yes, "longs pay shorts" when positive | `funding_disabled` is true on all 13 contracts in the catalog | S2, P1 |
| last settlement | | `last_funding_time` is 2026-09-08 between 08:00 and 15:00 UTC on 12 contracts and 2022-02-01 08:00 UTC on `SOL_USDT_PERPETUAL` | P3 |
| who pays whom | peer to peer between longs and shorts, "Tothemoon does not charge any fees on the Funding Rate amount" | | S2 |
| who is charged | "You will only pay or receive the Funding amount if you hold a position at one of these times" | | S2 |

So funding is switched off on every live contract, and it has not settled since 2026-09-08 on 12 of them.
With a zero rate the documented mark formula, Mark = Index × (1 + Funding Rate × Time to Funding / Funding Interval), collapses to Mark = Index, which is what every ticker frame shows, see [`rest.md`](./rest.md) section 4.
No public funding history call exists, and the settlement instant itself was not captured.

## 7. Liquidation, settlement and delisting

| item | rule | source |
|---|---|---|
| maintenance margin | 50 % of the initial margin, and it "includes commission for closing an open position and also include next funding" | S4 |
| liquidation | at the Liquidation Price when the Mark Price touches it. Losses beyond the Bankruptcy Price come from the Liquidation Fund, and a better fill feeds the fund | S2, S4 |
| liquidation fee | Not publicly specified | S2, S4 |
| auto-deleveraging | the most profitable positions are closed when the Liquidation Fund is short | S2, S4 |
| settlement or delivery fee | none, since no dated contract is live | P1 |
| delisting | no rule published. Four USDT contracts (`FTM`, `MATIC`, `SAND` and `SHIB`) survive in the emergency map but not in the catalog, so they were removed at some point | P1 |
| futures withdrawals | "processed everyday only one time per day at 10:00 UTC" | S4 |

## 8. CCXT

CCXT 4.5.68 has no Tothemoon or Cryptology class.
`require('ccxt').exchanges` run from `server/` lists 104 ids, and none matches `moon`, `ttm` or `cryptology`, P6.
The only hits for `tothemoon` in `server/node_modules/ccxt/js/src/*.js` are an example deposit address, `okbtothemoon`, in `server/node_modules/ccxt/js/src/okx.js` lines 5348 and 5466.
The current CCXT master has none either: `ts/src` at commit `1d8b674434` of 2026-09-22 12:48 UTC holds 105 `.ts` files and `ts/src/pro` holds 77, and no name matches, S11.
So `market.taker` cannot be read, because no market loads.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 500 | the one published perpetual taker, 0.05 %, S2 and S4, and the same number in the live fee config, P7 |
| `ccxtTakerPpm` | none | no CCXT class exists, so the connector has no constant to expect, and the venue needs its own catalog loader first, see [`rest.md`](./rest.md) section 2 |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tothemoon API Documentation | https://docs.tothemoon.com/ | 2026-09-22 | Tothemoon, global | fee pointer to the FAQ, data centres, sections 3 and 4 |
| S2 | Contracts T&Cs, updated 2026-01-12 | https://tothemoon.com/faq/contracts-t-cs-43000509174 | 2026-09-22 | Tothemoon Global Inc., Panama | perpetual entity, excluded regions, 0.05 % maker and taker, funding schedule, insurance fund, stale contract description, sections 1, 2, 5, 6 and 7 |
| S3 | Terms of Use, updated 2026-07-03 | https://tothemoon.com/faq/terms-of-use-43000509173 | 2026-09-22 | Brilliantscope Trading Limited, Cyprus, and Tothemoon Global Inc., Panama | entities by region, restricted countries, section 1 |
| S4 | Futures Trading Terminology, updated 2024-11-20 | https://tothemoon.com/faq/futures-trading-terminology-43000493594 | 2026-09-22 | Tothemoon, global | index, mark and funding formulas, constant 0.05 % fee, margin and liquidation, sections 2, 4, 6 and 7 |
| S5 | Tothemoon Fees FAQ, updated 2026-08-17 | https://tothemoon.com/faq/tothemoon-fees-43000475684 | 2026-09-22 | Tothemoon, global | spot 0.2 %, section 2 |
| S6 | Fees page and its page chunk | https://tothemoon.com/fees | 2026-09-22 | Tothemoon, global | client-rendered numbers, Futures row filter, section 2 |
| S7 | What percentage of trading fees can be covered with bonuses?, updated 2025-12-23 | https://tothemoon.com/faq/what-percentage-of-trading-fees-can-be-covered-with-bonuses-43000774586 | 2026-09-22 | Tothemoon, global | bonus coverage, section 5 |
| S8 | FAQ index | https://tothemoon.com/faq | 2026-09-22 | Tothemoon, global | the list of fee and futures articles read |
| S9 | tothemoon.com web app, `_app` chunk and the i18n store on the landing and fees pages | https://tothemoon.com/ | 2026-09-22 | Tothemoon, global | promotions and bonus strings, section 5 |
| S10 | CoinGecko exchange record and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/cryptology and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 UTC | CoinGecko | name, trust rank, spot tickers, absence from derivatives, sections 1 and 3 |
| S11 | CCXT GitHub master, `ts/src` and `ts/src/pro` listings | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 UTC | CCXT | no class in master, section 8 |
| S12 | CCXT 4.5.68 `okx.js` | `server/node_modules/ccxt/js/src/okx.js` | 2026-09-22 | CCXT | the only `tothemoon` string, section 8 |
| P1 | `ws-probe.mjs catalog`, at 03:27 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | catalog, flags, emergency map, spot pair fees, sections 1, 3, 5, 6 and 7 |
| P3 | `ws-probe.mjs anchor`, at 03:28 and 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | funding fields, section 6 |
| P4 | `ws-probe.mjs errors`, at 03:30 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | legacy `BTC_PERPETUAL` book, section 3 |
| P5 | `rest-probe.mjs catalog`, at 03:32 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tothemoon/rest-probe.mjs) | 2026-09-23 UTC | this host | spot pair count, section 3 |
| P6 | `node -e "console.log(require('ccxt').exchanges)"` from `server/` | none, a one-line command | 2026-09-22 | this host | CCXT 4.5.68 has 104 ids and no Tothemoon, section 8 |
| P7 | `rest-probe.mjs catalog`, the fee config read, at 03:32 and 03:46 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/tothemoon/rest-probe.mjs) | 2026-09-23 UTC | this host | `https://cryptology-prod.firebaseio.com/config/web/features/fees/tradeOptions.json`, the path the fees page chunk names, sections 2 and 9 |
