# Figure Markets Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:23 to 04:39 UTC for the first pass and 04:45 to 04:53 UTC for the second pass, from the development host near Seattle, through its Surfshark WireGuard exit that geolocates to Canada.

This profile covers spot trading on Figure Markets, because the venue lists no perpetual, see section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): spot VIP 0 fees stand where the perpetual numbers would.
CCXT 4.5.68 has no class for the venue, so every fee below comes from the venue's own API and pages, see section 8.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/figure-markets/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/figure-markets/ws-probe.mjs), and the probe ledger rows are in [`rest.md`](./rest.md) section 9 and [`websocket.md`](./websocket.md) section 9.

The venue is winding down the crypto pairs that overlap the engine.
Its live web app configuration read `"IS_WINDDOWN_ALERTS_ENABLED": true` and `"WINDDOWN_DATE": "2026-09-23T12:00:00Z"` on 2026-09-23 at 04:25, at 04:38, twice at 04:48 and at 04:52 UTC, S14 and P1.
The FAQ behind that flag says "Trading for BTC, ETH, SOL, LINK, UNI, and XRP ends" on that date, and that after it "you won't be able to buy or sell BTC, ETH, SOL, LINK, UNI, and XRP on Figure Markets", S15.
So every number in this profile about those six bases describes a market that closes about seven hours after the probe.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22 local time, 2026-09-23 UTC | all rows below |
| brand | Figure Markets, owned by Figure Technology Solutions, Inc. | S12, S20 |
| crypto operator, United States | Figure Payments Corporation, NMLS 2033432, 100 West Liberty Street, Suite 600, Reno, NV, which "offers self-directed investors and traders cryptocurrency services" and "is neither licensed with the SEC or the CFTC nor is it a Member of NFA" | S11, S20 |
| other entities under the brand | Figure Securities, Inc., which runs the Alternative Trading System for the `FGRS-YLDS` equity market, Figure Certificate Company, Figure Investment Advisors LLC, Figure Markets Credit LLC, Figure Markets Ireland Limited and Figure Markets, Inc. | S20 |
| terms last updated | July 8, 2026 | S12 |
| who may trade | "The Service is intended for visitors located within the United States" in the general terms, and the exchange terms say the services "are made available for users in many states and countries, subject to eligibility requirements and geographic availability" | S12 |
| US persons | may trade crypto spot, except in New York: the fee article says "Cryptocurrency trading is not available in NY", and the New York money transmitter licence is listed as "Pending" | S11, S13 |
| excluded regions | sanctioned or embargoed jurisdictions and "any other jurisdiction where we may restrict or limit use of the Exchange Services", no list is published for the exchange | S12 |
| market location | every one of the 17 crypto markets lists `marketLocations` `["US"]`, and only `FGRS-YLDS` adds `CAYMAN` | P1 |
| account gates | the USD crypto markets require the on-chain attributes `figure.kyc.passport.pb` and `figuremarkets.fiat.pb`, the USDC and USDT markets require `figure.kyc.passport.pb` | P1, `requiredAttributes` in the markets reply |
| crypto wind-down | trading for BTC, ETH, SOL, LINK, UNI and XRP ends 2026-09-23 12:00 UTC, and "Eligible HASH, YLDS, FGRS, USD, USDC, and USDT assets remain available" | S14, S15 |

The FAQ is titled "FAQ: Updates to Crypto Trading and Flex Rate Loans" and dated "August 24, 2026 at 5:30 PM" in the page bundle, S15.
It gives the reason as "Figure Markets is focusing on Democratized Prime, OPEN, YLDS, and other key areas", and says "Open orders for affected assets will be canceled when trading ends".

The public REST API and the public socket answered this host with HTTP 200 and 101 and no refusal, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
Every access result in this profile is from the Surfshark exit in Canada, and none was retried through another route.
The help center HTML at `https://support.figuremarkets.com/hc/en-us` returned 403 with a Cloudflare "Just a moment..." challenge to plain `curl`, and `figuremarkets.zendesk.com/hc/en-us` returned 403 as well.
The same help center's public Zendesk API returned 200, so the articles in the ledger were read through it, S11.
`https://docs.figuremarkets.com/` did not answer, curl code 000, and the API documentation lives at `https://www.figuremarkets.dev/api-docs/`, which answered 200.

CoinGecko returned trust score 5, `trust_score_rank` 106, 16 tickers and 2,292.43 BTC of 24 h volume for `figure_markets` on 2026-09-23 at about 04:31 UTC, S17.
The survey list ranked it 103.
Of that volume, the `FIGR_HELOC/USD` loan pool token carried about 188.8 million USD, and the largest crypto ticker, XRP/USD, about 0.33 million USD, S17.

## 2. Quick answer

| product | VIP 0 taker | VIP 0 maker | source |
|---|---|---|---|
| crypto spot, 14 markets on BTC, ETH, SOL, LINK, UNI, XRP and HASH | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | `takerFee.rate` and `makerFee.rate` `0.001`, `minBasisPoints` 10, on every one of the 14, P1 |
| stablecoin spot, `USDC-USD`, `USDT-USD`, `USDC-USDT` | 0 | 0 | `rate` `0`, P1 |
| `FGRS-YLDS`, the tokenized Figure share on the ATS | 0.03 %, 300 ppm | 0.03 %, 300 ppm | `rate` `0.0003`, P1 |
| fund and loan pool markets, `YLDS-*` and the eight `CONNECT` markets | no fee object | no fee object | P1 |

The Public API documents the fee object as "Fee structure (rate, basis points, minimum notional). Applied when orders execute.", S2.
The OpenAPI schema describes `rate` as "The fee rate as a percentage (e.g. 0.001 for 0.1%)", `maximumRate` as "The maximum fee rate that can be applied to an order", and `minimumNotional` as "The minimum fee amount that must be charged per order", S9.
The 14 fee-charging crypto markets carried `maximumRate` 0.001 and `minimumNotional` 0.000001, so the maker and taker are one flat 1,000 ppm.
The web app configuration had `"IS_TRADING_FEES_ENABLED": true`, so the fee is charged, S14 and P1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | absent | 0 of 29 markets are contracts in P1, and the documented `market_type` values are `ATS`, `CRYPTO`, `FUND`, `VIRTUAL_YLDS` and `CONNECT`, S9. The help center search for "perpetual" returned 0 articles, S11. CoinGecko's derivatives list does not show the venue |
| dated futures | absent | no market type for it, S9, and the help center search for "futures" returned only three loan and share articles, S11 |
| options | absent | no market type for it, S9 |
| spot crypto | present until 2026-09-23 12:00 UTC for six of seven bases: 17 `CRYPTO` markets, 9 quoted in USD, 7 in USDC and 1 in USDT | P1, S14, S15 |
| spot crypto after the wind-down | `HASH-USD`, `HASH-USDC`, `USDC-USD`, `USDT-USD` and `USDC-USDT`, going by the FAQ list of assets that remain | S15, inference from the asset list |
| margin and short selling on spot | present as Flex Rate and margin loans, and "New Flex Rate and margin borrowing are no longer available" | S15 |
| tokenized funds and loan pools | present: 3 `FUND` markets on YLDS and 8 `CONNECT` markets on loan pool tokens | P1 |
| equity | present: `FGRS-YLDS` on the ATS of Figure Securities, Inc. | P1, S20 |

No market in the catalog pairs with the engine's perpetual families after the wind-down, because HASH is the only volatile base left.
Deposit and withdrawal fees are shown per transaction in the app, and the help center article "Exchange - Gas Fees Provenance Blockchain - Hash" covers chain fees, S11.

## 4. Spot tiers

No tier table is published.

| place looked | result |
|---|---|
| help center article "Exchange-Trading Fees on the Exchange", updated 2026-09-01 | says the fee appears in the order preview with "the dollar amount of the fee as well as the percentage", and gives no rate or tier, S11 |
| `https://www.figuremarkets.com/disclosures/fees/`, `/disclosures/fee-schedule/` and `/fees/` | HTTP 200 with the site's generic body of 61,457 bytes, the same body `/robots.txt` returns, and no fee table |
| general terms | "Before you pay any fees, you will have an opportunity to review and accept the fees that you will be charged", S12 |
| markets reply | one fee object per market with no volume field, P1 |

### Qualification

None is published.
The fee object carries `minBasisPoints` and `maxBasisPoints`, which were both 10 on the crypto markets, so no range was visible from a public read, P1.

## 5. Discounts that change the taker

| discount | status | source |
|---|---|---|
| token holding | Not publicly specified | S2, S11 |
| referral | a "Refer" item exists in the web app navigation, and its terms were not read | S15 bundle |
| market maker | partners trade over FIX, and their REST rate limits are "negotiated based on customer need", fees for them are Not publicly specified | S7, S19 |
| zero fee promotion | the three stablecoin pairs carry a rate of 0, with no end date published | P1 |

## 6. Funding as a cost

None.
Figure Markets lists no perpetual, so it charges no funding.
The margin and Flex Rate loans charged interest, and new borrowing ended with the FAQ of August 24, 2026, S15.

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| settlement | trades settle on the Provenance blockchain, and non-native assets are held in an MPC wallet "to enable atomic settlement of transactions on the Provenance Blockchain" | S12 |
| delisting of the six bases | open orders "will be canceled when trading ends", and holders "can continue to hold, send, receive, deposit, and withdraw affected assets" | S15 |
| margin loans after the wind-down | "Your existing Flex Rate or margin loan remains active", subject to "standard loan-health and liquidation rules" | S15 |
| liquidation fee | Not publicly specified | S12, S15 |

## 8. CCXT

CCXT 4.5.68 has no class for Figure Markets.
`require('ccxt').exchanges` in `server/` listed 104 ids and none matched `figure` or `provenance`, in P1.
The CCXT master branch on GitHub at commit `1d8b674` lists 112 entries under `ts/src`, and none matches `figure` or `provenance`, S18.
A search of the CCXT repository's issues and pull requests for "figure markets" returned 8 results, none about this venue, S18.

So `market.taker` cannot be read, and `ccxtTakerPpm` has no value.

## 9. Recommended registry values

None.
The venue lists no perpetual, the connector keeps only active swaps at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 203, and every registry entry builds a CCXT class, as at [`registry.ts`](../../../server/src/venues/registry.ts) line 92 for Gate.
Figure Markets has no CCXT class to build, and six of its seven volatile bases stop trading on 2026-09-23 at 12:00 UTC.

If a later design admitted spot legs and the venue kept a market worth trading, `takerPpm` would be 1,000 from the markets reply, and `ccxtTakerPpm` would stay unset because no CCXT class exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Public API, REST | https://www.figuremarkets.dev/api-docs/public-api/rest/ | 2026-09-23 UTC | Figure Markets | REST base, read-only, sections 1 and 2 |
| S2 | Public API, Markets | https://www.figuremarkets.dev/api-docs/public-api/markets/ | 2026-09-23 UTC | Figure Markets | fee object, market locations, section 2 |
| S7 | Rate limits and best practices, and Exchange APIs Limits | https://www.figuremarkets.dev/api-docs/reference/rate-limits/ and https://www.figuremarkets.dev/api-docs/exchange/Index/Limits/ | 2026-09-23 UTC | Figure Markets | partner limits negotiated, section 5 |
| S9 | Public API OpenAPI spec, version 1.0.0 | https://storage.googleapis.com/markets-exchange-docs/combined-public-spec.json | 2026-09-23 UTC | Figure Markets | fee schema, `market_type` values, section 2 and 3 |
| S11 | Help center: "Exchange-Trading Fees on the Exchange", article 50417029962899, and searches for "fee", "perpetual" and "futures" | https://support.figuremarkets.com/hc/en-us/articles/50417029962899-Exchange-Trading-Fees-on-the-Exchange, read through https://support.figuremarkets.com/api/v2/help_center/en-us/articles/50417029962899.json and https://support.figuremarkets.com/api/v2/help_center/articles/search.json | 2026-09-23 UTC | Figure Payments Corporation, US | fee shown in preview, no crypto in NY, operator, no perpetual article, sections 1 to 4 |
| S12 | Terms of Service, last updated July 8, 2026 | https://www.figuremarkets.com/disclosures/terms-of-service/ | 2026-09-23 UTC | Figure, US | US intent, exchange eligibility, fees accepted per order, settlement, sections 1, 4 and 7 |
| S13 | Money transmission disclosures | https://www.figuremarkets.com/disclosures/money-transmission-disclosures/ | 2026-09-23 UTC | Figure Payments Corporation, US | New York licence "Pending", section 1 |
| S14 | Exchange web app configuration | https://www.figuremarkets.com/exchange/api/config/current | 2026-09-23 04:25 UTC | Figure Markets | `WINDDOWN_DATE`, `IS_WINDDOWN_ALERTS_ENABLED`, `IS_TRADING_FEES_ENABLED`, sections 1 and 2 |
| S15 | "FAQ: Updates to Crypto Trading and Flex Rate Loans", dated August 24, 2026, in the marketing app bundle served at `/c/home/exchange-update` | https://www.figuremarkets.com/c/assets/index-C5Tt80s2.js | 2026-09-23 UTC | Figure Markets | wind-down assets, date source, open orders, loans, sections 1, 3, 6 and 7 |
| S17 | CoinGecko exchange API, `figure_markets` | https://api.coingecko.com/api/v3/exchanges/figure_markets | 2026-09-23 04:31 UTC | CoinGecko | trust score, rank, tickers, volume, section 1 |
| S18 | CCXT GitHub, `ts/src` listing on master at `1d8b674`, and issue search | https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref=master and https://api.github.com/search/issues?q=repo:ccxt/ccxt+%22figure+markets%22 | 2026-09-23 UTC | CCXT | no class, section 8 |
| S19 | Partner API overview | https://www.figuremarkets.dev/api-docs/partner-api/ | 2026-09-23 UTC | Figure Markets | FIX for market makers, section 5 |
| S20 | Cryptocurrency risk disclosure | https://www.figuremarkets.com/disclosures/cryptocurrency/ | 2026-09-23 UTC | Figure Technology Solutions, Inc. | entities, operator of crypto services, section 1 |
| P1 | `rest-probe.mjs catalog`, first pass 04:38 UTC, and second pass twice at 04:48 UTC and once at 04:52 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/figure-markets/rest-probe.mjs) | 2026-09-23 UTC | this host | fees per market, catalog counts, config flags, CCXT id list, sections 1 to 4 and 8 |
