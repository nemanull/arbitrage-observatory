# Webot Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:06 to 03:37 UTC, from the development host near Seattle.

This profile covers spot trading on Webot, formerly Pionex.US, because Webot lists no perpetual, see section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): spot VIP 0 fees and spot tiers stand where the perpetual numbers would.
Webot has no CCXT class, see section 8, and publishes no API documentation, see [`rest.md`](./rest.md) section 2.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/webot/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/webot/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval date | 2026-09-22, every source in section 10 | |
| brand | Webot, "formerly known as Pionex US" | S3 |
| US operator | registered as a Money Services Business with FinCEN, NMLS #2284360, "MTL compliant licensed in 48 US states" | S3, S5 |
| US legal entity | Pionex Inc., the holder of NMLS #2284360 on the Pionex.US license page | S6 |
| EU operator | "Pionew Ireland Limited, operating under the name 'Webot', is regulated by the Central Bank of Ireland", company number 723206, regulatory reference C496936, a MiCA crypto-asset service provider passported across the EEA | S2, S3 |
| products | spot trading and 11 built-in trading bots, among them a Margin Grid Bot that borrows | S3, S4 |
| US persons | may trade, since the US service is built for them, but only residents of the states Webot currently serves | S4 |
| excluded US states | the license page lists Alaska as "Denied" and has no row for Hawaii or New York | S6 |
| served US states | "the state count is served dynamically", and identity verification refuses a resident of an unlisted state | S4 |
| other regions | the EU service serves the EEA through Pionew Ireland Limited, and nothing on either site offers the service elsewhere | S2, S3 |
| region restrictions inside a served region | "certain trading tools, coins, and leveraged token trading can be restricted based on a user's KYC region/IP location" | S4 |
| API trading | Not offered as far as the public record shows, see below | S7, [`rest.md`](./rest.md) section 6 |

The Pionex US Help Center holds an article titled "Unavailability of API Key Feature on Pionex.US", S7.
Its body returned HTTP 403 with a Cloudflare "Just a moment..." challenge to `curl`, to a web fetch that does not originate here, and to one headless Chrome on 2026-09-22.
A web search summary of it read "Pionex.US currently doesn't support creating API keys", which is not a first-hand reading.
Neither `llms.txt` nor `llms-full.txt` of Webot mentions an API, S3 and S4, and the sitemap lists no API page.
The public market data endpoints do answer without a key, and private paths answer `INVALID_APIKEY` or `APIKEY_LOST`, in P1.
Whether a Webot account can create an API key today is an open question.

CoinGecko ranks Webot 47th by trust score, gives the country as United States and the year as 2022, and counts 199 coins, 292 pairs and 129.7 BTC of 24 h volume, S8.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, every pair, US | 0.1 %, 1,000 ppm | 0.5 %, 5,000 ppm | S1 |
| spot, every pair, EU | 0.1 %, 1,000 ppm | 0.5 %, 5,000 ppm | S2 |
| perpetuals | Not offered | Not offered | section 3 |

The fee page says "Transaction fees: taker 0.5%, maker 0.1%", S1.
The site summary adds that the fees "may vary by trading pair", S3, and no page names a pair with another rate.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | `GET /api/v1/common/symbols?type=PERP` returns `{"symbols":null}`, and `GET /api/v1/market/tickers?type=PERP` returns `{"tickers":null}`, in P1 |
| USDC-margined perpetuals | absent | same |
| coin-margined perpetuals | absent | same, and no page of S1 to S5 names a perpetual |
| dated futures | absent | `type=FUTURES` answers `MARKET_PARAMETER_ERROR` `type error`, in P1, and no page names one |
| options | absent | no page names one |
| spot | present | 384 symbols, all `type` `SPOT`: 152 quoted in USD, 218 in USDT and 14 in USDC, of which 298 traded in the last 24 h, in P1 |
| leveraged tokens | named, not listed | the site names "leveraged token trading" as region restricted, S4, and no catalog base ends in a digit and `L` or `S`, in P1 |
| margin | inside a bot only | the Margin Grid Bot "users pay interest on borrowed funds while the bot is running", S4 |

CoinGecko's derivatives list of 214 venues on 2026-09-22 names neither Webot nor Pionex, S8.
The Pionex international venue does list perpetuals under the same API shape, S10, but Webot's host answers none of its futures paths, see [`rest.md`](./rest.md) section 3.

## 4. Spot tiers

None are published.
The fee page shows one maker and one taker rate and no volume or balance tier, S1 and S2.
The site keeps the right to change the fee: "We reserve the right to change the trading fee.", S1.

### Qualification

Not applicable, since there is one rate.

## 5. Discounts that change the taker

None are published.
No token discount, referral rebate, market maker program or zero fee promotion appears on the fee pages or in the site summaries, S1 to S4.
The trading bots are free, and "only normal trading fees apply to the trades they place", S4.

## 6. Funding as a cost

Not applicable, because Webot lists no perpetual.
The Margin Grid Bot charges interest on its borrowed funds, S4, and the rate is not published outside an account.

## 7. Liquidation, settlement and delisting

Spot has no liquidation or settlement charge.
The Pionex US Help Center has an article titled "Webot (formerly Pionex.US) Will Delist Partial Spot Trading Pairs", S7, whose body could not be read from this host, see section 1.
Of the 384 catalog symbols, 86 had no trade in 24 h on 2026-09-22, and `ACX_USDT` served an empty book on both sides, in P1 and [`websocket.md`](./websocket.md) section 4.
Asset recovery for an unsupported deposit costs at least $20 and at most $65, S1.
Deposit and withdrawal fees are on the fee page, S1 and S2.

## 8. CCXT

| item | value | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | 104 exchange ids, none matching `webot`, `pionex` or `pionew` | `node -e "console.log(require('ccxt').exchanges)"` from `server/`, S9, and P1 |
| CCXT master | `exchanges.json` holds 105 ids and `ts/src` holds 112 entries, none matching, at commit `1d8b674` of 2026-09-22, version 4.5.82 | S9 |
| `market.taker` | Not applicable, no class exists | |

CCXT has no class for the Pionex international venue either, so no sibling class could be reused.

## 9. Recommended registry values

None today.
The registry builds each venue from a CCXT class, `createExchange: () => new ccxt.<id>()`, at [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts) lines 40, 50, 56, 65 and 77, and Webot has none.
The connector also keeps only markets with `type === 'swap'`, `swap === true` and `active !== false`, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 196 to 202, and logs `no usable swap markets; skipping the venue` at line 51 when none remain.
Webot would contribute zero markets.

If a later design ever admits spot legs, `takerPpm` would be 5,000 from S1.
`ccxtTakerPpm` has no value, because no CCXT class exists.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Webot Trading Fee, US | https://www.webot.com/us/en/fees | 2026-09-22 | Webot, US | maker and taker, the right to change fees, asset recovery charge, sections 2, 4, 5 and 7 |
| S2 | Webot Trading Fee, EU | https://www.webot.com/eu/en/fees | 2026-09-22 | Pionew Ireland Limited, EEA | EU maker and taker, the EU entity, company and regulatory numbers, sections 1 and 2 |
| S3 | Webot `llms.txt` | https://www.webot.com/llms.txt | 2026-09-22 | Webot, US and EU | former name, FinCEN MSB, the EU operator under MiCA, "may vary by trading pair", sections 1 and 2 |
| S4 | Webot `llms-full.txt` | https://www.webot.com/llms-full.txt | 2026-09-22 | Webot, US | NMLS number, state by state rollout, KYC state list, regional restrictions, bots, margin interest, sections 1, 3, 5 and 6 |
| S5 | Webot US home page | https://www.webot.com/us/en | 2026-09-22 | Webot, US | "MTL compliant licensed in 48 US states", NMLS #2284360, section 1 |
| S6 | Pionex.US Licenses | https://www.pionex.us/blog/license-information/ | 2026-09-22, page modified 2026-04-10 | Pionex Inc., US | legal entity, per state licenses, Alaska denied, no Hawaii or New York row, section 1 |
| S7 | Pionex US Help Center, articles 18239055214873 "Unavailability of API Key Feature on Pionex.US", 52925985304473 "Pionex.US is Upgrading to Webot", 53026246448665 "Pionex.US & Webot are now Two Separate Apps", 55900268141081 "Webot (formerly Pionex.US) Will Delist Partial Spot Trading Pairs" | https://pionexus.zendesk.com/hc/en-us/articles/18239055214873 | 2026-09-22, titles only, bodies answered HTTP 403 | Pionex Inc., US | API key unavailability and a delisting notice exist, sections 1 and 7 |
| S8 | CoinGecko API, exchange `webot` and the derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/webot | 2026-09-22 | CoinGecko | rank, country, year, coin and pair counts, volume, absence from the derivatives list, sections 1 and 3 |
| S9 | CCXT 4.5.68 and CCXT master | `server/node_modules/ccxt`, https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json and https://api.github.com/repos/ccxt/ccxt/contents/ts/src | 2026-09-22 | CCXT | no class, section 8 |
| S10 | Pionex open API docs, for the Pionex international venue | https://www.pionex.com/docs/api-docs | 2026-09-22 | Pionex, international | the path and frame shapes tried on Webot's hosts, section 3 |
| P1 | `rest-probe.mjs main` at 03:12 UTC, `rest-probe.mjs all` at 03:30 UTC and `rest-probe.mjs main` at 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/webot/rest-probe.mjs) | 2026-09-22 | this host | catalog counts, `type=PERP`, private path replies, CCXT ids, sections 1, 3, 7 and 8 |
