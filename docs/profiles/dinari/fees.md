# Dinari Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:44 to 04:59 UTC, from the development host near Seattle, through the Surfshark WireGuard exit that geolocates to Canada.

Dinari lists no perpetuals, so this profile covers its spot product per template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
That product is dShares, ERC-20 tokens backed one to one by US stocks and ETFs that Dinari buys on the public market, S6 and S7 section 3.7.
Dinari is not an exchange with a public order book.
It is an issuer and a broker that business partners reach through a keyed Enterprise API, and the homepage sends traders to those partners, S2 and S6.
No CCXT class exists for it, see section 8.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | 2026-09-22, documentation pages fetched as markdown by appending `.md` to each URL | S1 to S9 |
| issuer | Dinari, Inc., which sells and repurchases the tokens, with the underlying shares held in a Bermuda segregated accounts company | S7 sections 3.6 and 3.7 |
| US broker | Dinari Securities, LLC, SEC and FINRA registered broker-dealer, CRD 329672, which holds every US customer account | S8 |
| who may trade | end users of an approved Dinari partner, since the homepage tells traders to "Find a partner near you". The homepage also links a web app at `app.dinari.com` whose code has onboarding and order routes, and whether that app onboards individuals directly was not checked, because it needs an account | S6, [`rest.md`](./rest.md) section 2 |
| who may integrate | a business that passes KYB and pays for API access, from $2,000 a month, with a free sandbox for evaluation | S2 |
| US persons | excluded from the Regulation S tokens, S3 and S7. They may hold dShares only through Dinari Securities, LLC, under a supplemental partner agreement, fully disclosed accounts and non-transferable tokens | S8 |
| excluded regions | the terms name the United States, Canada, North Korea, Cuba, Syria, Iran, Sudan, Crimea and FATF listed jurisdictions as Excluded Jurisdictions, S7. The docs name Canada as pending licensing and list 31 unsupported countries, among them Russia, Ukraine, Belarus, Serbia, Croatia and Slovenia, S3 | S3, S7 |
| this host | the web app's `GET https://app.dinari.com/api/region` answered `{"countryCode":"CA","source":"cf-ipcountry"}`, so Dinari sees this host as Canada, an unsupported region | P1 |

Access results in these profiles are from that Canadian VPN exit, and a host elsewhere may see different answers.
The documented REST API refused every call without keys with HTTP 401, and the documented WebSocket answered every subscribe with `Authentication required`, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 3.
Neither refusal was a geoblock.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| dShares spot, any order type | 0 %, 0 ppm | 0 %, 0 ppm | "Dinari does not collect transaction fees from our partners or their end users.", S2 |

The per order cost is a flat network fee, not a rate.
The standard network fee is $0.20 per order, and on Ethereum mainnet it follows gas, S2.
A partner may instead be billed network fees in arrears and set its own customer fee in the `fee` field of each order, a non-negative USD decimal with up to 6 places and a default of $0.20, S2 and S9.
So $0.20 is 200 ppm of a $1,000 order and 2,000 ppm of a $100 order, and the engine's fixed ppm model cannot express it exactly.
What a partner's end user pays is set by that partner and is Not publicly specified.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M, USDC-M or coin-margined perpetuals | absent | no perpetual, future, margin or leverage product in the documentation index of 121 lines, S1, or on the homepage, S6. CoinGecko's derivatives exchange list of 214 venues, read at 2026-09-23 04:50 UTC, does not include Dinari, S10 |
| dated futures | absent | same |
| options | absent | same |
| spot, tokenized US stocks and ETFs (dShares) | present | 719 stocks in the catalog, all `is_tradable`, P1. CoinGecko shows 89 pairs, all quoted in USD, and its API returned 79 tickers with $261,168 of 24 h volume, trust score 2 and `trust_score_rank` 376, S10 |
| Alloys, index tokens such as the S&P Digital Markets 50 | present | `GET /api/v2/market_data/alloys/` in S1, and the homepage names `$SPDM`, S6 |
| crypto spot | absent | the catalog holds only stocks and ETFs, P1 |

## 4. Spot tiers

Dinari publishes no maker or taker tier, and no volume ladder.
The partner schedule has four fee types, S2, and the network fee comes in two forms.

| fee | amount | when |
|---|---|---|
| API access | from $2,000 per month, basic and enterprise plans | every partner, billed monthly |
| network fee, flat | $0.20 per order, Ethereum mainnet at gas cost | per order, added to the order total |
| network fee, in arrears | at cost, billed monthly | partners that choose it, and they then pass their own `fee` |
| USDT conversion | oracle rate plus 3 bps, which is 300 ppm, billed monthly | orders paid or settled in USDT |
| OTC | spread quoted per trade, "typically up to 10 bps", which is 1,000 ppm, minimum $25,000 | partners only |

## 5. Discounts that change the taker

None is published.
There is no token discount, referral rebate, market maker program or zero fee promotion in the pages read, S1 and S2.
The partner sets the end user's fee, so the real cost to a retail user differs by partner and is Not publicly specified.
Deposit, withdrawal and card fees are not recorded here, and the official lookup is the "Partner Fees" page, S2.

## 6. Funding as a cost

None.
dShares are spot tokens and carry no funding rate.
Cash dividends are paid in the USD+ stablecoin on the issuer's schedule, S6.

## 7. Liquidation, settlement and delisting

There is no leverage, so there is no liquidation charge.
Each order settles on chain, and the network fee in section 4 is its settlement charge, S2.
The repurchase price Dinari pays deducts third party transaction costs, including exchange fees and brokerage commissions, and any repurchase fees set out on the Dinari website, S7 section 6.2.
Splits and mergers of the underlying stock are applied to the token as the docs describe, S1 "Stock Splits" and "Mergers", with no fee named there.

## 8. CCXT

| check | result |
|---|---|
| CCXT 4.5.68 in `server/node_modules` | `ccxt.exchanges` has 104 ids and none matches `dinari` or `dshare`, P1 `ccxt` line |
| class file | no `dinari.js` under `server/node_modules/ccxt/js/src/` |
| current CCXT master | `ts/src` holds 105 `.ts` files at commit `1d8b674434fde39ef282988b066812adf8d19b9e` of 2026-09-22 12:48 UTC, and none matches `dinari` or `dshare`, S11 |

So `market.taker` has no value to report, and the engine's catalog, `loadMarkets` filtered to active swaps at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 68 and 79, has nothing to load.

## 9. Recommended registry values

None.
Dinari should not be added to [`registry.ts`](../../../server/src/venues/registry.ts).
It lists no perpetual, has no CCXT class, and every documented market data call needs a paid partner key.
If a spot stage ever wants it, `takerPpm` would be 0 plus a per order $0.20 that a ppm constant cannot hold, and `ccxtTakerPpm` would stay unset.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Dinari documentation index | https://docs.dinari.com/llms.txt | 2026-09-22 | Dinari, Inc. | page list, no derivatives, Alloys, sections 3 and 5 |
| S2 | Partner Fees, updated 2026-08-27 | https://docs.dinari.com/docs/fees.md | 2026-09-22 | Dinari, Inc., partners | no transaction fee, API access, network fee, USDT conversion, OTC, `fee` field, sections 2, 4 and 5 |
| S3 | Restrictions, updated 2026-07-09 | https://docs.dinari.com/docs/restrictions.md | 2026-09-22 | Dinari, Inc. | Regulation S, Canada, unsupported countries, section 1 |
| S4 | Order Types and Behaviors | https://docs.dinari.com/docs/order-type.md | 2026-09-22 | Dinari, Inc. | sessions and marketable limit orders, see [`rest.md`](./rest.md) |
| S5 | Pricing and Quotes | https://docs.dinari.com/docs/pricing-quotes.md | 2026-09-22 | Dinari, Inc. | price and quote semantics, see [`rest.md`](./rest.md) |
| S6 | Dinari homepage | https://dinari.com | 2026-09-22 | Dinari, Inc. | partner routing for traders, USD+ dividends, `$SPDM`, sections 1, 3 and 6 |
| S7 | Dinari, Inc. Terms and Conditions, revised 2025-12-26 (PDF) | https://cdn.prod.website-files.com/656fd13bce08f2dc3bc50573/695ee673aa80e179e884fafc_Dinari-dShares-Terms-and-Conditions-Revised-12-26-25-CLEAN-with-links.pdf | 2026-09-22 | Dinari, Inc., non-US | Excluded Jurisdictions, pricing methodology, custody, repurchase costs, sections 1 and 7 |
| S8 | US Customers, last updated 2026-06-22 | https://docs.dinari.com/docs/us.md | 2026-09-22 | Dinari Securities, LLC, US | US broker, CRD 329672, US customer requirements, section 1 |
| S9 | Create Market Buy Managed Order Request | https://docs.dinari.com/reference/createmarketbuymanagedorderrequest.md | 2026-09-22 | Dinari, Inc. | `fee` field, section 2 |
| S10 | CoinGecko exchange API for `dinari`, and the derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/dinari and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 04:50 UTC | CoinGecko | 89 pairs, USD quote, 24 h volume, trust score 2, no derivatives listing, section 3 |
| S11 | CCXT master `ts/src` listing through the GitHub API | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 | CCXT | no Dinari class, section 8 |
| P1 | `rest-probe.mjs all`, at 04:46 UTC and in the second pass at 04:57 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dinari/rest-probe.mjs) | 2026-09-23 | this host, Canadian exit | region answer, catalog count, CCXT check |
