# BitDelta Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:27 to 03:53 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the derivatives of BitDelta, which the venue's terms call perpetual contracts, and names every other product once in the coverage matrix.
BitDelta has no CCXT class, and its public API documentation covers spot only, so every derivatives number below comes from the calls the venue's own website makes for a visitor who is not logged in.
Those calls are undocumented, and this profile labels them as such.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/bitdelta/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/bitdelta/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 local time for every source row | | source ledger |
| legal entity | "Lionheart Limited S.R.L", "a Company incorporated under the laws of Romania", in the general terms. The derivative terms name only "BITDELTA". CoinGecko lists the country as Vanuatu and the year established as 2023. | Published, two sources that disagree | S3, S2, S7 |
| restricted jurisdictions | "Mainland China, the United States of America, Canada, United Arab Emirates, Cuba, Iran, North Korea, Sudan, Syria", in section 39 of the general terms and section 19 of the derivative terms | Published | S2, S3 |
| prohibited persons for derivatives | any "U.S. Person", any "South African Person", a citizen or resident of Canada, Seychelles or the British Virgin Islands, "the Government of Venezuela", any resident or official of a prohibited jurisdiction, and any sanctioned person, derivative terms clause 2.10 | Published | S2 |
| website footer | "These services are not directed at, and are not available to, residents or citizens of the United Arab Emirates." | Published | S4 |
| who may trade the derivatives | an account holder who is not a prohibited person and not in a restricted jurisdiction. A US person may not. | Region-specific | S2 |
| terms dates | the derivative terms PDF was created 2024-04-04 and the general terms PDF 2024-03-21, by their PDF metadata. Neither carries an effective date in its text. | Published | S2, S3 |
| website from this host | `bitdelta.com` pages and `media.bitdelta.com` PDFs answered 200. `help.bitdelta.com` answered 403 with a Cloudflare challenge (`cf-mitigated: challenge`) to curl and to a fetch that does not originate here, so no help article was read. | Probed | `curl` and WebFetch on 2026-09-22, S8 |
| public API from this host | `api.bitdelta.com` answered every public REST call and the Socket.IO endpoint, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1 | Probed | P1, W4 |

The development host sits in the United States, which is a restricted jurisdiction, so trading from it is not allowed under S2 and S3.
Reading public market data needs no account, and nothing refused it.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USD-quoted crypto perpetuals, 74 contracts | 0.05 % = 500 ppm | 0.05 % = 500 ppm | Probed from undocumented website calls | P2, `buy_commission` and `sell_commission` are `0.05` on all 90 contracts |
| cross-crypto perpetuals quoted in BTC, ETH, LTC or BCH, 16 contracts | 0.05 % = 500 ppm | 0.05 % = 500 ppm | Probed from undocumented website calls | P2 |
| spot, for comparison only | 0.15 % = 1,500 ppm | 0.15 % = 1,500 ppm | Probed from the documented pairs call | P2, `mfee` and `tfee` on 386 of 387 pairs, and 0.1 % on `BDTUSDC` |

The derivatives commission is published per side, as `buy_commission` and `sell_commission`, and not per role.
No maker rate distinct from the taker rate is published for derivatives, so the maker column repeats the one commission the contract carries.
The website describes it as "Applied while placing the order, calculated on order value", S5.
The fee page's "Maker Fee" and "Taker Fee" columns belong to its holding level table, S4.

## 3. Coverage matrix

| product | present | count on 2026-09-22 | evidence |
|---|---|---:|---|
| USD-quoted crypto perpetuals | yes, researched | 74, 73 `Active` and `STOUSD` `Not active` | P2, `futures/market/snapshot` field `currency2` |
| cross-crypto perpetuals (`BCHBTC`, `ETHBTC`, `BTCETH`, `BNBLTC` and others) | yes, researched | 16, quote BTC 4, ETH 4, LTC 4, BCH 4 | P2 |
| USDT- or USDC-margined perpetuals | no | 0 | P2, every contract is quoted in USD or a coin |
| dated futures | no | 0 | no dated contract in the snapshot or the sitemap |
| options | institutional only, not detailed | an "OTC Options Desk" is named on the institutional page | S11 |
| "24-Hour Leverage" with "daily resets", the `otc-leverage` pages | yes, not detailed | 8 pages in the sitemap | S11, sitemap `https://bitdelta.com/sitemap/sitemap_en.xml` |
| MetaTrader 5 "Gold & FX" | yes, not detailed | not counted | menu label `"mt5":"Gold & FX"` in S5 |
| spot | yes, not detailed | 387 pairs, 378 quoted in USDT and 9 in USDC, all `trading` | P2, `open/api/v1/pairs` |

CoinGecko's derivatives exchange list on 2026-09-22 held 214 venues and none was BitDelta, S7.
The venue's own derivative terms define "Derivative Products" as "the derivative products available at the Website from time to time, including perpetual contracts", S2 clause 2.2.
Spot, deposit, withdrawal and card fees are looked up on `https://bitdelta.com/en/fees-conditions`, which renders its tables in the browser from the pairs call and `public/holding-level`, S4.

## 4. Perpetual tiers

No derivatives tier table is published.
The one commission of 0.05 % applies to all 90 contracts, P2.

The fee page publishes a "Holding Level" table keyed to the BDT token, served by `https://api.bitdelta.com/api/v1/public/holding-level`, S6 and P2.

| level | BDT held | maker | taker |
|---|---:|---:|---:|
| VIP Level 1 | 1,000 | 0.15 % | 0.15 % |
| VIP Level 2 | 5,000 | 0.145 % | 0.145 % |
| VIP Level 3 | 10,000 | 0.14 % | 0.14 % |
| VIP Level 4 | 25,000 | 0.13 % | 0.13 % |
| VIP Level 5 | 50,000 | 0.125 % | 0.125 % |
| VIP Level 6 | 100,000 | 0.12 % | 0.12 % |
| VIP Level 7 | 150,000 | 0.115 % | 0.115 % |
| VIP Level 8 | 200,000 | 0.11 % | 0.11 % |
| VIP Level 9 | 500,000 | 0.1 % | 0.1 % |
| VIP Level 10 | 1,000,000 | 0.09 % | 0.09 % |
| VIP Level 11 | 10,000,000 | 0.05 % | 0.05 % |

Level 1 equals the spot rate of 0.15 %, so the table reads as a spot schedule.
Whether a holding level changes the derivatives commission is Not publicly specified.

## 5. Discounts that change the perpetual taker

| discount | effect on the derivatives commission | label | evidence |
|---|---|---|---|
| BDT holding level | Not publicly specified, see section 4 | Not publicly specified | S4, S6 |
| referral | the website offers "Refer A Friend!" and an affiliate page. No rate reduction for the referred account is stated in the pages read. | Not publicly specified | S5, sitemap |
| market maker | the institutional page offers "Deep-Pooled Liquidity" and a trading desk. No fee schedule is published. | Not publicly specified | S11 |
| zero fee promotion | none found. A "trade-a-thon" campaign ranks users by volume and pays rewards, and its leaderboard streams on the public socket as `campaign_leaderboard`. | Probed | W1, home page banner |
| tax | the fee page says "Tax applicable to maker and taker fees" and "The fee is inclusive of all taxes". `tax_details` was `null` on all 90 contracts and empty on all 387 spot pairs. | Published and Probed | S4, P2 |

## 6. Funding as a cost

Each contract carries a `buy_funding_fee` and a `sell_funding_fee` in percent, read from `futures/market/pair`, P2.

| value on both sides | contracts |
|---|---:|
| -0.05 | 50 |
| -0.44 | 17 |
| -0.43 | 5 |
| -0.45 | 5 |
| -0.01 | 3 (`SANUSD`, `VECUSD`, `YFIUSD`) |
| -0.18, -0.48, -0.49, -1.33, -1.49, -2.24, -3.72, -4.36, -4.38, -4.47 | 1 each, the largest on `FLWUSD`, `CEOUSD`, `FILUSD` and `IOSUSD` |

On all 90 contracts the long and the short value are equal and negative, P2.
The website's tooltips say two things about it, S5.

- "The funding fee is a periodic payment between long and short positions, where longs pay shorts if positive, shorts pay longs if negative, and it resets daily at 12:00 AM UTC."
- "Funding fee is applied to open positions at 12 PM UTC. Funding charges may apply to both long and short positions, depending on market conditions or the type of asset. A negative funding rate means you will be charged, while a positive rate means you will receive a payment."

A third string in the same page text, "Fees Applied every 24 hours on trade value", carries no key that ties it to the derivatives, so it may belong to the 24-hour leverage product.

Read together with the wire, a negative value on both sides means both a long and a short are charged, which is a holding charge and not a transfer between longs and shorts.
That reading is an inference from the second tooltip and the equal signs.
The first tooltip says the fee resets daily at 00:00 UTC, and the second applies it at 12:00 UTC, so the settlement instant is disputed in the venue's own text.
The instant itself was not captured, and no public funding history call exists to check it.
No cap, floor or formula is published.
The derivative terms say a funding payment is debited from margin collateral as "governed by the terms set forth in the Funding Payment Summary", S2 clause 5.2, and no such summary is public.

At -0.05 % a day a position held one day costs 500 ppm, the same as one commission, and at -4.47 % a day it costs 44,700 ppm.

## 7. Liquidation, settlement and delisting

| charge | value | label | evidence |
|---|---|---|---|
| liquidation fee | 0.07 % on both sides, all 90 contracts, fields `buy_liquidation_fee` and `sell_liquidation_fee` | Probed from undocumented website calls | P2 |
| settlement or delivery fee | none, the contracts have no expiry | Not publicly specified | |
| delisting | Not publicly specified | Not publicly specified | |
| role of the venue | "BITDELTA does not serve as a principal, counterparty, or market-maker in the transactions conducted via trading on the Site, including transactions involving Derivative Products" | Published | S2 clause 12.1 |

The wire shows only a two-sided quote per contract with no depth and no sizes, see [`websocket.md`](./websocket.md) section 4, and the liquidity page says the platform aggregates "liquidity from various providers", S11.
How that squares with clause 12.1 is Not publicly specified.

## 8. CCXT

| check | result | evidence |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | no BitDelta class among 104 ids. The only near match is `delta`, which is Delta Exchange, whose `urls.www` is `https://www.delta.exchange` at `server/node_modules/ccxt/js/src/delta.js` line 125. | S9 |
| CCXT master on 2026-09-22 | no BitDelta class. `exchanges.json` at commit `1d8b674434fde39ef282988b066812adf8d19b9e` lists 105 ids with only `delta` matching, the `ts/src` listing has no `bitdelta.ts`, and `ts/src/bitdelta.ts` and `ts/src/pro/bitdelta.ts` answered 404 on raw.githubusercontent.com. | S10 |
| `market.taker` for a derivatives market | none, since no class exists | |

## 9. Recommended registry values

None.
The venue cannot join the engine in its current shape, because it has no CCXT class, no public depth book for its derivatives, and no index, mark or funding rate, see [`websocket.md`](./websocket.md) section 8 and [`rest.md`](./rest.md) section 8.
If it were ever added through a custom catalog, `takerPpm` would be 500 from P2, and `ccxtTakerPpm` would have no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitdelta Public API, a Postman collection published 2024-04-04 | https://api-docs.bitdelta.com/, collection at https://api-docs.bitdelta.com/api/collections/29064556/2s9Xy3rWSo | 2026-09-22 | BitDelta, global | the public API is spot only, sections 3 and 8 |
| S2 | Derivative Terms and Conditions, PDF created 2024-04-04 | https://media.bitdelta.com/pdf/terms-and-conditions-derivatives.pdf | 2026-09-22 | BitDelta | perpetual contracts, prohibited persons, restricted jurisdictions, funding payments, role of the venue, sections 1, 3, 6 and 7 |
| S3 | Terms and Conditions, PDF created 2024-03-21 | https://media.bitdelta.com/pdf/terms-and-conditions.pdf | 2026-09-22 | Lionheart Limited S.R.L, Romania | legal entity and restricted jurisdictions, section 1 |
| S4 | Fees and Conditions page | https://bitdelta.com/en/fees-conditions | 2026-09-22 | BitDelta, global | fee page tabs, tax notes, footer, sections 1, 4 and 5 |
| S5 | Derivatives trade page and its script bundle under `/derivatives/_next/static/chunks/` | https://bitdelta.com/en/trade/derivatives/btc-usd | 2026-09-22 | BitDelta, global | funding and commission tooltips, the undocumented calls, sections 2, 3 and 6 |
| S6 | Holding level tiers | https://api.bitdelta.com/api/v1/public/holding-level | 2026-09-22 | BitDelta, global | the BDT tier table, section 4 |
| S7 | CoinGecko exchange record and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/bitdelta and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | country, year, absence from the derivatives list, sections 1 and 3 |
| S8 | BitDelta help center | https://help.bitdelta.com/hc/en-us | 2026-09-22 | BitDelta | refused with HTTP 403 and a Cloudflare challenge, section 1 |
| S9 | CCXT 4.5.68 `exchanges` and `delta.js` | `server/node_modules/ccxt/js/src/delta.js` | 2026-09-22 | CCXT | no class, section 8 |
| S10 | CCXT master `exchanges.json` and `ts/src` | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no class in master, section 8 |
| S11 | Institutional and Liquidity pages | https://bitdelta.com/en/institutional and https://bitdelta.com/en/liquidity | 2026-09-22 | BitDelta, global | options desk, 24-hour leverage, liquidity providers, sections 3, 5 and 7 |
| P1 | `rest-probe.mjs host` and `time` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitdelta/rest-probe.mjs) | 2026-09-22 | this host | the API host answers, section 1 |
| P2 | `rest-probe.mjs catalog` | [`rest-probe.mjs`](../../../scripts/probes/venues/bitdelta/rest-probe.mjs) | 2026-09-22 | this host | commissions, funding fees, liquidation fees, tiers, counts, sections 2 to 7 |
| W1 | `ws-probe.mjs prices` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitdelta/ws-probe.mjs) | 2026-09-22 | this host | `campaign_leaderboard`, section 5 |
| W4 | `ws-probe.mjs handshake` | [`ws-probe.mjs`](../../../scripts/probes/venues/bitdelta/ws-probe.mjs) | 2026-09-22 | this host | the socket answers, section 1 |
