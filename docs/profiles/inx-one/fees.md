# INX One Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:41 to 05:05 UTC, from the development host near Seattle through its Canadian VPN exit.

This profile covers INX One, the trading platform of INX, which has no CCXT class.
INX One lists no perpetuals, so it is profiled on its spot market, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) says.
The platform now answers under Republic's name: `one.inx.co` redirects to `trading.republic.com`, and INX is a subsidiary of OpenDeal Inc., doing business as Republic, S1.
Every API call INX documents needs an approved API key, including the market list and the book socket, so no market data could be read from this host, see [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).
All access results below are from the Canadian VPN exit that this laptop's traffic leaves through, which Cloudflare placed at `loc=CA`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| crypto operator | INX Digital, Inc., registered with FinCEN and multiple U.S. states as a money transmitter, NMLS #2094630 | S1 |
| security token operator | INX Securities, LLC, a broker-dealer and alternative trading system registered with the SEC, member of FINRA and SIPC | S1 |
| holding and technology entities | The INX Digital Company, Inc., incorporated in Canada, and INX Limited, incorporated in Gibraltar | S1 |
| parent | OpenDeal Inc., doing business as Republic | S1 |
| who may trade | The General Terms say INX "makes no representation that materials on the Site or the Services are appropriate, lawful or available for use in any location other than the United States of America" | S2 |
| U.S. persons | may trade, since the crypto entity is a U.S. money transmitter and the disclaimers page carries state regulator complaint notices | S1, S3 |
| excluded regions | Not publicly specified on the pages this host could read. The help center that might say refused this host, see below | S2, P1 |
| country on CoinGecko | Canada, established 2020 | S6 |
| CoinGecko trust rank | 149 per the survey on 2026-09-22, 156 in the API reply at 04:52 UTC on 2026-09-23, trust score 3 | S6, P3 |
| CoinGecko size | 13 pairs, 11 tickers returned, 24 h volume 0.348 BTC, of which USDT-USD is 28,228 USD and every other ticker is under 312 USD. BTC-USD showed a bid and ask spread of 0.251 % and 0.237 % in two reads | S6, P3 |
| CoinGecko derivatives list | INX absent from all 214 derivatives exchanges at 04:58 UTC on 2026-09-23 | S7 |

What this host got back, on 2026-09-23 between 04:41 and 05:05 UTC:

| URL | status | what answered |
|---|---|---|
| `https://www.inx.co/fee-schedules` | 200 | the fee page, S1 |
| `https://apidoc.inx.co/` | 200 | the API documentation, `Last-Modified: Tue, 08 Sep 2026 18:09:36 GMT`, S4 |
| `https://one.inx.co/trading/BTC-USD` | 301 to `https://trading.republic.com/trading/BTC-USD` | Cloudflare |
| `https://trading.republic.com/trading/BTC-USD` | 403 | Cloudflare page "Sorry, you have been blocked" and "You are unable to access republic.com", with curl's User-Agent and with the probe's own |
| `https://crypto-support.inx.co/hc/en-gb` | 403 | Cloudflare page "Edge IP Restricted", error code 1034 |

A fetch that does not originate here also got 403 from `trading.republic.com/trading/BTC-USD` and from the help center, W1.
So the refusal is not shown to be specific to the Canadian exit, and whether a U.S. browser would pass is Not verified.

## 2. Quick answer

INX One lists no perpetuals, so there is no perpetual maker or taker.

| product | maker | taker | source |
|---|---|---|---|
| spot crypto, VIP 0 and only tier | 0.3 %, 3,000 ppm | 0.4 %, 4,000 ppm | S1, "Maker fee 0.3% of the notional amount", "Taker fee 0.4% of the notional amount" |
| security tokens, brokerage | 1.5 % seller commission and 1.5 % buyer commission, plus a 1 USD network service fee per order | same | S1, effective June 3, 2026 |

The crypto trading fee carries no effective date on the page.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M, USDC-M or coin-M perpetuals | absent | no perpetual in the fee page, S1, the API documentation, S4, or the CoinGecko derivatives list, S7 |
| dated futures | absent | same sources |
| options | absent | same sources |
| margin | absent | no margin, borrow or leverage wording in S1 or S4 |
| spot crypto | present | 10 crypto pairs against USD on CoinGecko: USDT, USDC, BTC, ETH, XRP, LTC, SOL, AVAXC, POL and DOT, S6. The fee page lists crypto withdrawal fees for 13 assets, S1 |
| security tokens | present | NOTE-USD, which CoinGecko also lists and marks stale, and ANIMOCA-USD, both linked from the INX home page, whose buy link for NOTE goes through the security token flow `buy-assets/security`, S9. The 2024 web app market list names the `DIGITAL_SECURITIES` asset class, S5, S6 |

The live market list could not be read, because the documented call needs a key and the web app refused this host, see [`rest.md`](./rest.md) section 2.
A 2024 archive of the web app's market call held 16 crypto and 5 security token markets, S5.

## 4. Spot tiers

None is published.
The fee page gives one maker and one taker rate for crypto, with no volume tiers and no qualification rule, S1.

### Qualification

Not applicable, since there is one tier.

## 5. Discounts that change the spot taker

None is published for crypto, S1.
For security tokens only, "The Firm may, at its sole discretion, reduce the commission paid by the Buyer or Seller.", S1.
No token holding, referral, market maker or zero fee programme is named on the pages read.

## 6. Funding as a cost

Not applicable.
INX One lists no perpetual, so there is no funding rate, interval, cap or settlement.

## 7. Liquidation, settlement and delisting

No liquidation charge exists, since there is no margin or perpetual.
No settlement or delisting charge is published for crypto.
Deposit and withdrawal fees are listed per asset on the fee schedule page, S1.

## 8. CCXT

| check | result | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `inx` or `republic` | P3 |
| CCXT master, commit `1d8b674` of 2026-09-22 12:48 UTC | 105 files in `ts/src`, none named after INX or Republic | S8 |
| `market.taker` | none, since no class exists | |

## 9. Recommended registry values

Do not register INX One.
It lists no perpetual, it has no CCXT class, and every market data call needs an approved API key.
If a spot leg were ever wanted, `takerPpm` would be 4,000 from S1, and there is no CCXT constant for `ccxtTakerPpm`.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | INX Fee Schedules | https://www.inx.co/fee-schedules | 2026-09-23 04:41 UTC | INX Digital, Inc. and INX Securities, LLC, United States | fees, entities, parent, sections 1 to 7 |
| S2 | INX General Terms | https://www.inx.co/general-terms | 2026-09-23 04:44 UTC | INX, United States | jurisdiction and eligibility, section 1 |
| S3 | INX Disclaimers | https://www.inx.co/disclaimers | 2026-09-23 04:44 UTC | INX Digital, Inc., United States | state money transmission notices, section 1 |
| S4 | Digital Assets Trading Platform API, OpenAPI 3.0.3, version V1 | https://apidoc.inx.co/ | 2026-09-23 04:49 UTC | INX, global | products and endpoints, sections 3 and 8 |
| S5 | Wayback Machine capture of `one.inx.co/exchange/market/getAllMarkets`, 2024-07-02 20:35 UTC | https://web.archive.org/web/20240702203516/https://one.inx.co/exchange/market/getAllMarkets | 2026-09-23 | INX web app | 2024 market list, section 3 |
| S6 | CoinGecko exchange API, `inx_one` | https://api.coingecko.com/api/v3/exchanges/inx_one | 2026-09-23 04:52 UTC | CoinGecko | trust rank, pairs, volume, section 1 |
| S7 | CoinGecko derivatives exchange list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-23 04:58 UTC | CoinGecko | no derivatives listing, sections 1 and 3 |
| S8 | CCXT `ts/src` on master | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-23 04:45 UTC | CCXT | no class on master, section 8 |
| S9 | INX home page, titled "INX One Platform" | https://www.inx.co/ | 2026-09-23 04:41 UTC | INX, United States | trading links for security tokens, section 3 |
| W1 | the same two URLs read through a web fetch tool whose requests do not leave from this host | `https://trading.republic.com/trading/BTC-USD`, `https://crypto-support.inx.co/hc/en-gb` | 2026-09-23 about 04:45 UTC | unknown egress | both answered 403, section 1 |
| P1 | `rest-probe.mjs access`, runs at 04:51 and 05:01 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/inx-one/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | status codes and refusals, section 1 |
| P3 | `rest-probe.mjs ccxt`, runs at 04:52 and 05:02 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/inx-one/rest-probe.mjs) | 2026-09-23 | this host | CCXT ids and CoinGecko tickers, sections 1 and 8 |
