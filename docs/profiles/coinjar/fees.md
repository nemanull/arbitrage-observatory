# CoinJar Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:24 to 03:34 UTC and again 03:43 to 03:49 UTC, from the development host near Seattle.

This profile covers spot trading on CoinJar Exchange, because CoinJar lists no perpetual, see section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md): spot VIP 0 fees and spot tiers stand where the perpetual numbers would.
CCXT 4.5.68 has no CoinJar class, and neither does the current CCXT master, see section 8.
Every number carries a source ledger row, a probe reference, or a file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/coinjar/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/coinjar/ws-probe.mjs).
The help centre at `support.coinjar.com` was read through its public Zendesk article API, `https://support.coinjar.com/api/v2/help_center/en-au/articles/<id>.json`, which answered 200 to this host.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | 2026-09-22, help centre articles updated between 2026-05-26 and 2026-09-22, developer docs updated 2025-09-22 and 2025-09-23 | S4 to S9, S11, S12 |
| operator in Australia | CoinJar Australia Pty Ltd ACN 648 570 807, "a registered digital currency exchange provider with AUSTRAC", registration DCE100749118-001 | S1, S17 |
| operator in the UK | CoinJar UK Limited, company number 8905988, registered with the FCA as a Cryptoasset Exchange Provider and Custodian Wallet Provider, Firm Reference No. 928767 | S3 |
| operator in the EU | CoinJar Europe Limited, "authorised by the Central Bank of Ireland as a crypto-asset service provider (registration number C496731)" | S16 |
| counterparty in the global terms | "Your sole and exclusive counterparty to these Terms of Service is CoinJar Australia Pty Ltd" | S10 |
| principal trading | "CoinJar acts as principal at all times", and "CoinJar is the counterparty to all trades that you enter into on CoinJar Exchange", terms 7.1.3 | S10 |
| house liquidity | "CoinJar or its related entities may participate in CoinJar Exchange as a market maker or taker to provide liquidity", terms 7.3.1 | S10 |
| regions where an account can be verified | Australia, Ireland, the United Kingdom with Guernsey, Jersey and the Isle of Man, Germany, and "Supported states in the U.S." | S6 |
| US persons | 20 states are supported: CA, HI, IL, IN, KS, MI, MS, MO, MT, NE, NH, NJ, OK, SC, TN, UT, VA, WV, WI and WY. Washington, New York, Texas, Florida and 26 other states are "coming soon", so not served | S7 |
| who may use the exchange | "Anyone with a verified CoinJar can join CoinJar Exchange for free", and in the same article "To become verified, you must be an Australian resident" | S9 |
| fiat pairs | "fiat trading pairs (e.g. BTC/AUD) are limited to verified CoinJar customers only" | S12 |
| excluded regions | 45 prohibited jurisdictions, among them Russia, Ukraine, Iran, North Korea, Cuba, Vietnam, Nigeria, Kenya, Monaco and the British Virgin Islands | S8 |

The sources disagree on who may trade on the exchange.
S6 and S7, updated 2026-09-21, admit Ireland, Germany and 20 US states to a CoinJar account.
S9, updated 2026-05-26, still says that verification requires Australian residence.
The exchange fee table is published on the global, Australian and UK fee pages, S1 to S3, and is absent from the Irish and German fee pages, S16.
The global terms say a US resident is governed by `www.coinjar.com/us/legal` instead, and that URL redirected this host to `/legal` and then to the global terms on 2026-09-22.
So whether a resident of a supported US state may use CoinJar Exchange, as opposed to the CoinJar app, is Not verified.
This host sits in Washington, which S7 lists as not yet served.

## 2. Quick answer

The markets that matter to the engine are those quoted in USDT, USDC or USD, the settlement family of [`2026-09-06-quote-family-design.md`](../../implemented/2026-09-06-quote-family-design.md).
The engine ranks USDT first and USDC second at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) line 13.
Every one of the 65 crypto bases has a USDT or USDC pair, 19 USDT and 46 USDC by that rank, so each would trade on a crypto-to-stablecoin pair, see [`rest.md`](./rest.md) section 2.

| schedule | VIP 0 taker | VIP 0 maker | source |
|---|---|---|---|
| crypto-to-crypto and crypto-to-stablecoin pairs, all volume | 0.06 %, 600 ppm | 0.00 %, 0 ppm | S1 to S4 |
| crypto against AUD, USD or GBP, lowest tier | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | S1 to S4 |
| stablecoin-to-fiat and stablecoin-to-stablecoin, all volume | 0.001 %, 10 ppm | 0.00 %, 0 ppm | S1 to S4 |

The Australian page quotes every rate "incl. GST", S2, and the global page uses the same heading, S1.
Fees are "always charged in the counter currency", terms 7.4, S10.
CCXT has no CoinJar class, so no `market.taker` exists to compare, see section 8.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | absent | 302 of 302 catalog rows are spot pairs of two currencies in P1, no id or name contains PERP, SWAP or FUT, and no margin, leverage or funding appears in the developer docs, S11 to S13 |
| dated futures | absent | no row in the catalog, and a help centre search for "perpetual", "margin", "leverage" and "derivatives" returned 0 articles on 2026-09-22 |
| options | absent | no row in the catalog and no mention in the docs |
| margin | absent | as above |
| spot | present, 302 products | `GET https://api.exchange.coinjar.com/products` in P1 |
| CoinJar app buy and sell, bundles, card | present, outside the exchange and its API | S1 |

The counter currencies on 2026-09-23 03:24 UTC were 70 `USD`, 69 `AUD`, 68 `GBP`, 67 `USDC`, 19 `USDT`, 7 `BTC` and 2 `DAI`, in P1.
CoinGecko's derivatives exchange list of 214 venues does not contain CoinJar, S14.
CoinGecko names the venue "CoinJar Exchange", country United Kingdom, established 2013, ranks it 95th by trust score with a score of 6, and gave it 41.47 BTC of 24 h volume on 2026-09-22, S14.
The 156 markets quoted in USD, USDC or USDT summed to about 2.15 and 2.16 million quote units of 24 h volume in the two runs, and 61 of them had none, in P2.
Of the 70 markets the engine would pick, 23 had no 24 h volume and 12 had more than 10,000 quote units, in P2.
Deposit, withdrawal, card and bundle fees are on the fee pages S1 to S3 and are not recorded here.

## 4. Spot tiers

Three schedules apply by pair type, and only the crypto against fiat schedule has volume tiers.
The tier thresholds differ by page, and the rates do not.

### Crypto against AUD, USD and GBP

| global page, S1 | Australian page and help centre, S2 and S4 | UK page, GBP pairs, S3 | taker | maker |
|---|---|---|---|---|
| $10 to $60,000 | $0 to $100,000 | £0 to £50,000 | 0.10 % | 0.10 % |
| $60,000 to $600,000 | $100,000 to $1m | £50,000 to £500,000 | 0.10 % | 0.08 % |
| $600,000 to $6m | $1m to $10m | £500,000 to £5m | 0.08 % | 0.04 % |
| $6m and over | $10m and over | £5m and over | 0.06 % | 0.02 % |

The global page does not name the currency of its dollar thresholds.

### Crypto-to-crypto and crypto-to-stablecoin

One rate for all volume on all three pages: taker 0.06 %, maker 0.00 %, S1 to S4.

### Stablecoin-to-fiat and stablecoin-to-stablecoin

One rate for all volume on all three pages: taker 0.001 %, maker 0.00 %, S1 to S4.

### Qualification

"Trading volume is calculated once every 24 hours (from 00:00 to 23:59 UTC), and the fees paid on all orders are determined by the total volume over the previous 30 calendar days (UTC)", S5.
A tier reached during a day applies from 00:00 UTC of the next day, S5.
The developer docs say "fees are charged everyday after 02:00 UTC for trades matched during the previous UTC day", S13.
The help centre says invoices "are generated each 24 hours at 12pm Melbourne time, for the 24 hour period up to 10am of that day", S4.
The two billing windows disagree, and neither changes the rate.

## 5. Discounts that change the taker

No token discount, referral discount, market maker programme or zero fee promotion for the exchange was found on the fee pages or in the help centre on 2026-09-22.
S9 says "There are also multiple upgradeable plans available with additional benefits", while S5 says the volume pricing "replaced the previous subscriptions model as of December 1, 2018".
The trading API lists a private `GET /plans` call, "List of all plans that support self-serve subscriptions", S12, which was not called.
So whether any plan lowers the taker today is Not verified.

## 6. Funding as a cost

None.
CoinJar lists no perpetual, so no funding rate, interval or settlement exists, see section 3 and [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

No liquidation charge exists on spot.
Trade settlement is the exchange of the two currencies after the match, "in most cases CoinJar Exchange ensures that settlement takes place within 10 seconds of the trade", and "settlement may be delayed by up to an hour" at extreme volume, S13.
Unsettled proceeds can fund new orders but cannot be withdrawn, S13.
The Trading Rules describe three sessions a day, each ending in an 8 minute auction, a 1 minute 55 second auction in which auction orders cannot be cancelled, and a 5 second "Closing Padding" in which "Orders are not accepted or matched", at 07:59:55, 15:59:55 and 23:59:55 UTC, S11.
At 03:24 and 03:43 UTC on 2026-09-23 every one of the 302 tickers read `status` `continuous`, `session` 72420 and `transition_time` null, and the public `GET /sessions` returned `[]`, in P1 and P2.
So whether the auctions and the closing padding still run was Not verified, and no session boundary was captured.
A new sell must be at least 80 % of the last price and a new buy at most 125 % of it, S11.
No delisting charge is published.
The six BNB products are listed with no order on either side, see [`rest.md`](./rest.md) section 2.

## 8. CCXT

| item | value | source |
|---|---|---|
| CCXT 4.5.68 in `server/node_modules` | no class: `require('ccxt').exchanges` has 104 ids and none contains `jar` | P1 |
| CCXT master | no file whose name contains `jar` among the 112 entries of `ts/src` or the 78 entries of `ts/src/pro` at commit `fbc5f2178f` of 2026-09-22, and `raw.githubusercontent.com/ccxt/ccxt/master/ts/src/coinjar.ts` answered 404 | S15 |
| CCXT issues | #9242 "New exchange: CoinJar", opened 2021-05-24 and open, and #7248 "Add CoinJar Exchange", opened 2020-07-10 and closed | S15 |
| `market.taker` | none, no class exists | |

## 9. Recommended registry values

None today.
A registration needs a CCXT class, `createExchange: () => ccxt.Exchange`, at [`registry.ts`](../../../server/src/venues/registry.ts) line 29, and CoinJar has none.
The connector also keeps only markets with `type === 'swap'`, `swap === true` and `active !== false`, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 203, and CoinJar lists no swap.

If a later design ever admits spot legs and writes a catalog without CCXT, the value would be `takerPpm: 600`, with no `ccxtTakerPpm`.
The reason is that every crypto base the engine would pick trades on a USDT or USDC pair, at the crypto-to-stablecoin taker of 0.06 %, S1 to S4.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Fees & Spread, global | https://www.coinjar.com/global/fees | 2026-09-22 | CoinJar Australia Pty Ltd, global | exchange fee tables, operator line, sections 1 to 4 |
| S2 | Fees & Spread, Australia | https://www.coinjar.com/au/fees | 2026-09-22 | Australia | exchange fee tables with the $0 to $100,000 tier, GST, sections 2 and 4 |
| S3 | Fees & Spread, United Kingdom | https://www.coinjar.com/uk/fees | 2026-09-22 | CoinJar UK Limited | GBP tiers, FCA line, sections 1 and 4 |
| S4 | Trading fees, invoices and negative balances, updated 2026-05-26 | https://support.coinjar.com/hc/en-au/articles/360000841023 | 2026-09-22 | all | fee table, invoice time, section 4 |
| S5 | CoinJar Exchange trading rates, updated 2026-05-26 | https://support.coinjar.com/hc/en-au/articles/360000826626 | 2026-09-22 | all | 30 day volume rule, subscriptions ended 2018-12-01, sections 4 and 5 |
| S6 | Supported regions, updated 2026-09-21 | https://support.coinjar.com/hc/en-au/articles/115004362186 | 2026-09-22 | all | supported countries, section 1 |
| S7 | Supported U.S. States, updated 2026-09-21 | https://support.coinjar.com/hc/en-us/articles/115004362186-Supported-U-S-States | 2026-09-22 | United States | supported and coming soon states, section 1 |
| S8 | Prohibited jurisdictions, updated 2026-09-22 | https://support.coinjar.com/hc/en-au/articles/11480525195801 | 2026-09-22 | all | 45 prohibited jurisdictions, section 1 |
| S9 | Introducing CoinJar Exchange, updated 2026-05-26 | https://support.coinjar.com/hc/en-au/articles/360000826586 | 2026-09-22 | all | who may join, plans, sections 1 and 5 |
| S10 | CoinJar Terms of Service, global | https://www.coinjar.com/global/legal | 2026-09-22 | CoinJar Australia Pty Ltd | counterparty, principal trading, fee currency, US and EU terms pointers, sections 1 and 2 |
| S11 | Trading Rules, updated 2025-09-23 | https://docs.exchange.coinjar.com/page/trading-rules | 2026-09-22 | CoinJar Exchange | sessions, auctions, price limits, section 7 |
| S12 | Market Status and the trading API reference | https://docs.exchange.coinjar.com/page/market-status | 2026-09-22 | CoinJar Exchange | fiat pairs for verified customers, `GET /plans`, sections 1 and 5 |
| S13 | Exchange Features, updated 2025-09-22 | https://docs.exchange.coinjar.com/docs/exchange-features | 2026-09-22 | CoinJar Exchange | settlement, fee billing, sections 4 and 7 |
| S14 | CoinGecko exchange API `coinjar` and derivatives exchange list | https://api.coingecko.com/api/v3/exchanges/coinjar | 2026-09-22 | CoinGecko | trust rank, score, volume, absence from the derivatives list, section 3 |
| S15 | CCXT on GitHub, `ts/src` and `ts/src/pro` listings and issue search | https://github.com/ccxt/ccxt | 2026-09-22 | CCXT | no class on master, issues #9242 and #7248, section 8 |
| S16 | Fees, Ireland and Germany | https://www.coinjar.com/ie/fees | 2026-09-22 | CoinJar Europe Limited | CBI line, no exchange fee table, section 1 |
| S17 | CoinJar's regulatory obligations, updated 2026-09-21 | https://support.coinjar.com/hc/en-au/articles/28814873312793 | 2026-09-22 | Australia | AUSTRAC registration number, section 1 |
| P1 | `rest-probe.mjs main` at 03:24 and 03:43 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/coinjar/rest-probe.mjs) | 2026-09-22 | this host | catalog, CCXT check, sessions, sections 3, 7 and 8 |
| P2 | `rest-probe.mjs scan` at 03:24 and 03:43 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/coinjar/rest-probe.mjs) | 2026-09-22 | this host | ticker status of every product, volume, sections 3 and 7 |
