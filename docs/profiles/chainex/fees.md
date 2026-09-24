# ChainEX Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:48 to 05:01 UTC, and the second pass 05:06 to 05:13 UTC, from the development host near Seattle.

ChainEX is a South African spot exchange with no CCXT class and no perpetual, futures, options or margin product.
This profile therefore covers ChainEX spot, as the survey plan's template change 1 asks, and names every other product in the coverage matrix.
Deposit and withdrawal fees are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/chainex/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/chainex/ws-probe.mjs).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieved | 2026-09-22 Pacific time | all rows of section 10 |
| legal entity | ChainEX (Pty) Ltd, a South African private company, registration number 2017/439541/07 | S8 |
| licence | the site footer reads "ChainEX (Pty) Ltd is a licensed financial services provider, FSP number 53799." | S9 |
| licence, older wording | the risk disclosure in the terms still reads "ChainEX is not licensed as Financial Services Provider in terms of the Financial Advisory and Intermediaries Services Act" | S8 |
| who may trade | individuals of legal age and legal entities who pass verification, in South Africa and internationally, and the ZAR markets open only after full verification | S5, S8 |
| excluded regions | United States of America, Algeria, Bolivia, Ecuador, Kyrgyzstan, Bangladesh, Nepal, Cambodia and Macedonia, from a help article last updated "3 years ago" | S4 |
| US persons | may not trade, the United States is the first entry of the blocked list | S4 |
| sanctions | the terms require that a user is on no embargo or sanctions list, and reserve the right to refuse service "in certain countries or regions" | S8 |
| product researched | spot, 26 markets: 21 quoted in ZAR and 5 in USDT | P1 |

Access from this host, which reaches the internet through a Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare `loc=CA`, SEA and YVR edges).
Every result below is from that Canadian VPN exit, and nothing was routed around a refusal.

| endpoint | result on 2026-09-23 UTC |
|---|---|
| `https://api.chainex.io/market/summary/` and every other public REST call of [`rest.md`](./rest.md) | HTTP 200, behind Cloudflare, `cf-ray` suffix `YVR` in the first pass and `SEA` in the second |
| `wss://push.chainex.io:443/` | HTTP 101, WAMP v1 welcome, see [`websocket.md`](./websocket.md) section 1 |
| `https://app.chainex.io/action/getMarkets` and `/getScalingFees`, the calls the fees page makes | HTTP 200 without a session |
| `https://app.chainex.io/action/getCountries` | HTTP 200 with a 76 byte body whose `response` is `failure`, so the signup country list needs a session |
| `https://chainex.io/fees`, `/api`, `/terms`, `/maker` | HTTP 200, the same 1.1 MB single page shell for every path, so the page text was read from the site's JavaScript bundles |
| `https://support.chainex.io/kb/...` | HTTP 200 |

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, base tier, all 26 markets | 0 % fee, and the maker receives 10 % of the fee its taker pays: -0.01 %, -100 ppm, against a base tier taker | 0.10 %, 1,000 ppm | S2, S3, P1 |
| instant ("quick") trading, not the order book | | 0.70 %, 7,000 ppm | S2, P1 |

The maker figure in ppm is derived.
The wire carries `maker_fee` `"-0.10000000"` for every market, and the fees page renders it as `-10.00 %` by multiplying by 100, S2.
The market maker page explains the sign: "When you place a maker order and a taker order is traded against it, you will receive up to 15% of the total fee paid by the taker.", S3.
So the base tier maker earns 10 % of 1,000 ppm, which is 100 ppm of notional, only when the taker is also on the base tier.

## 3. Coverage matrix

| product | present | note |
|---|---|---|
| perpetual swaps, any margin | absent | no route, API method or bundle string names perpetuals, futures, leverage, funding, index or mark price, S12 |
| dated futures | absent | same check |
| options | absent | same check |
| margin or lending | absent | same check |
| spot | present | 26 markets on 2026-09-23: 21 against ZAR, and BTC, ETH, LTC, TITANX and XRP against USDT, P1 |
| instant trading | present | 0.7 % fee, "your scaling fee percentage does not apply to quick trading", S2 |
| earn | present | an `earn` page route exists, not researched |
| deposits and withdrawals | present | withdrawal fees per coin come from the same fees page, via `https://app.chainex.io/action/getWithdrawFees`, not recorded here |

CoinGecko lists no ChainEX derivatives, and its exchange record shows a 24 h volume of 0.0325 BTC, trust score 3 and trust rank 141 on 2026-09-23, S10.
The survey's CoinGecko list of 2026-09-22 had ChainEX at trust rank 136.

## 4. Spot tiers

### Base tier, per market

| field on the wire | value on all 26 markets | rendered on the fees page |
|---|---|---|
| `taker_fee` | `"0.00100000"`, a fraction | `0.10 %` |
| `maker_fee` | `"-0.10000000"`, a share of the taker's fee | `-10.00 %` |
| `quick_trading_fee` | `"0.007"`, one value for the whole venue | `0.7 %` |

Read from `https://app.chainex.io/action/getMarkets` and `https://api.chainex.io/market/stats/BTC/ZAR`, which carry the same two fields, P1 and P2.

### Scaling tiers, 30 day volume in BTC

| 30 day volume | taker | maker, share of the taker's fee received |
|---|---|---|
| less than 1 BTC | base market fee, 0.10 % | base market fee, 10 % |
| 1 BTC or more | 0.08 % | 11 % |
| 3 BTC or more | 0.06 % | 12 % |
| 6 BTC or more | 0.04 % | 13.5 % |
| 10 BTC or more | 0.03 % | 15 % |

`https://app.chainex.io/action/getScalingFees` returned these rows, P1.

```json
{"timestamp":1790138940,"response":"success","data":[{"min":"0","taker_fee":"0.1","maker_fee":"0"},{"id":"11","min":"1.00000000","taker_fee":"0.08000000","maker_fee":"-11.00000000"},{"id":"12","min":"3.00000000","taker_fee":"0.06000000","maker_fee":"-12.00000000"},{"id":"13","min":"6.00000000","taker_fee":"0.04000000","maker_fee":"-13.50000000"},{"id":"14","min":"10.00000000","taker_fee":"0.03000000","maker_fee":"-15.00000000"}]}
```

The fees page renders `min` as "Less than 1 BTC" for the first row and "Greater or equal to `min` BTC" for the others, shows "Default market fee" in the first row, and prints the other fees as percentages without scaling, S2.
So the tier taker is in percent while the market `taker_fee` is a fraction, and the tier maker is a share of the taker's fee in percent.
The page header says "Showing current trading and withdrawal fees as of February 2026", S2.

### Qualification

"Based on your last 30 day trading volume, your trading fees will be adjusted on a sliding scale", S2.
A scaling tier "will overwrite" the market fee, S2.

### Where the docs disagree

The help article on scaling fees, last updated "3 years ago", says "The trading fees for both makers and takers are set at a base rate of 0.25%", and that the sliding scale starts at 100 BTC of 30 day volume, S6.
The live fee data of 2026-09-23 says 0.10 % taker, a negative maker, and tiers from 1 BTC, P1.
This profile takes the live data, since it is what the fees page renders today.

## 5. Discounts that change the spot taker

| discount | effect on the taker | source |
|---|---|---|
| scaling tiers | down to 0.03 % at 10 BTC of 30 day volume | S2 |
| token holding | none published | |
| referral | pays the referrer a share of the referred user's fees, and does not lower the taker's own fee | S7 |
| market maker program | changes the maker side only | S3 |
| zero fee promotions | none found in the fees page or the help centre on 2026-09-22 | S2 |

## 6. Funding as a cost

Not applicable.
ChainEX lists no perpetual, so there is no funding rate, interval, cap or settlement, S12.

## 7. Liquidation, settlement and delisting

No liquidation or settlement fee exists on a spot only venue.
No delisting charge is published.
Fees are charged on the order: "if you place a buy order for 1 BTC at a fee of 0.25%, the net total of the order would be 1.25 BTC", in the older help article, S7.
The fees route description says "All trading fees are collected in BTC. The buy order fee is added to the BTC order value, whereas the sell order fee is taken away from the BTC order value.", S2.
The referral article says "ZAR market fees are paid in the traded digital currency and not ZAR", S7.
Those two statements disagree, and which asset a ZAR market fee is taken in is Not verified.

## 8. CCXT

CCXT 4.5.68 has no ChainEX class.
`ccxt.exchanges` run from `server/` lists 104 ids, and none is `chainex`, P1.
The current CCXT master on GitHub has no ChainEX class either.
`https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts`, at version `4.5.82`, imports 105 exchange classes and no `chainex`, and `https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/chainex.ts` returns 404, S11.
The GitHub contents API refused the listing with 403 `API rate limit exceeded` for this host, so the check used the raw files.
So `market.taker` has no value to report.

## 9. Recommended registry values

None.
ChainEX is spot only, and the engine takes perpetuals only, through `loadMarkets` filtered to active swaps at [`connector.ts`](../../../server/src/ccxt/connector.ts) line 79.
With no CCXT class there is no connector to register either.
If the venue were ever wired as a spot leg by hand, `takerPpm` would be 1,000 from section 4, and `ccxtTakerPpm` would have no CCXT constant to declare.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ChainEX API page, rendered from the web bundle chunk `15.ea62880822effc364b7a.js` | https://chainex.io/api | 2026-09-22 | ChainEX, global | public market methods, rate limit, see [`rest.md`](./rest.md) |
| S2 | ChainEX fees page, its rendering code in the same chunk, and the data it loads from `https://app.chainex.io/action/getMarkets` and `/getScalingFees` | https://chainex.io/fees | 2026-09-22 | ChainEX, global | sections 2, 4, 5 and 7 |
| S3 | ChainEX market maker program page, text in the same chunk | https://chainex.io/maker | 2026-09-22 | ChainEX, global | the maker receives up to 15 % of the taker's fee, sections 2 and 4 |
| S4 | Help article "Are there any countries that are blocked from using ChainEX?" | https://support.chainex.io/kb/general/are-there-any-countries-that-are-blocked-from-using-chainex | 2026-09-22 | ChainEX, global | excluded regions, section 1 |
| S5 | Help article "Are the ZAR Markets Opened to Anyone?" | https://support.chainex.io/kb/general/are-the-zar-markets-opened-to-anyone | 2026-09-22 | ChainEX, global | South African and international users, section 1 |
| S6 | Help article "What are scaling fees and how does it work?" | https://support.chainex.io/kb/functionality/what-are-scaling-fees-and-how-does-it-work | 2026-09-22 | ChainEX, global | the older 0.25 % schedule, section 4 |
| S7 | Help articles "How will my fees be deducted?" and "How do I receive my referral reward fees?" | https://support.chainex.io/kb/functionality/how-will-my-fees-be-deducted and https://support.chainex.io/kb/functionality/how-do-i-receive-my-referral-reward-fees | 2026-09-22 | ChainEX, global | fee collection and referral, sections 5 and 7 |
| S8 | ChainEX terms of use, text in chunk `15.ea62880822effc364b7a.js` | https://chainex.io/terms | 2026-09-22 | ChainEX (Pty) Ltd, South Africa | entity, registration number, eligibility, sanctions, the FAIS sentence, section 1 |
| S9 | ChainEX home page footer, in the prerendered shell and in `main.227bb1402baa35b3f0a0.js` | https://chainex.io/ | 2026-09-22 | ChainEX (Pty) Ltd | FSP number 53799, section 1 |
| S10 | CoinGecko exchange record | https://api.coingecko.com/api/v3/exchanges/chainex | 2026-09-23 UTC | CoinGecko | volume and trust rank, section 3 |
| S11 | CCXT master `ts/ccxt.ts` and `ts/src/chainex.ts` | https://raw.githubusercontent.com/ccxt/ccxt/master/ts/ccxt.ts | 2026-09-23 UTC | CCXT | no ChainEX class, section 8 |
| P1 | `rest-probe.mjs catalog` at 04:48 and 05:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/chainex/rest-probe.mjs) | 2026-09-23 UTC | this host | catalog, fee fields, scaling rows, CCXT id check |
| P2 | `rest-probe.mjs book` at 04:49, 04:58 and 05:06 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/chainex/rest-probe.mjs) | 2026-09-23 UTC | this host | `market/stats` fee fields |
| S12 | a search of all 17 chainex.io JavaScript bundles for perpetual, futures, leverage, funding, index price and mark price | https://chainex.io/main.227bb1402baa35b3f0a0.js and the chunks its runtime lists | 2026-09-22 | ChainEX | the only hits were a password strength word list, a funding sentence about ZAR deposits and the terms, section 3 |
