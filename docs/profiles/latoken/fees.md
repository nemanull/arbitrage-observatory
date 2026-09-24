# LATOKEN Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, from the development host near Seattle, between 04:12 and 04:31 UTC on 2026-09-23, and again between 04:36 and 04:46 UTC in the second pass, through the Surfshark WireGuard tunnel whose exit geolocates to Canada.

LATOKEN (CCXT id `latoken`) lists no perpetual, no dated future and no option on 2026-09-22.
This profile therefore covers its spot market, as template change 1 of the venue survey plan says.
Deposit, withdrawal and refund schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/latoken/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs), run from `server/`.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| retrieval | fee page, API documentation and help center read on 2026-09-22 Pacific time | S1 to S6 |
| operator named on the fee page | the footer reads "ul. Hoza 8, unit 210, Warsaw, 00-682, Poland. Laws of Poland are applicable to the related services." and links "LATrade KYC & AML" and "XasPay Sp. z.o.o. KYC & AML" | S1 |
| CoinGecko | country "Cayman Islands", established 2017, `trust_score` 3, `trust_score_rank` 139 and 24 h volume 879 BTC on 2026-09-23 UTC, and rank 134 in the survey list of 2026-09-22 | S8 |
| terms of use | the help center links `https://go.latoken.com/terms-of-use`, which redirects to `https://cdn-new.latoken.com/common/files/terms-of-use-v12-LAtrade.pdf`, and that file answered HTTP 521 with `Retry-After: 120` to this host and to a fetch that does not originate here | S5 |
| excluded regions, article of 2024-12-08 | "LATOKEN does not accept investors (including residents, citizens, or individuals acting through an agent or representative) from the following jurisdictions: USA, Canada, Afghanistan, Bosnia and Herzegovina, Democratic People's Republic of Korea (DPRK)" | S3 |
| excluded regions, article of 2026-03-01 | "United States of America (USA), Afghanistan, Bosnia And Herzegovina, Democratic People's Republic of Korea (DPRK), Indonesia, Canada, Iran" | S4 |
| excluded regions, fee page footer | "Service unavailable in Germany and the Restricted countries." | S1 |
| US persons | may not trade, by both help center articles | S3, S4 |

The two help center articles disagree on Indonesia and Iran, and the fee page adds Germany, so the union is USA, Canada, Germany, Indonesia, Iran, Afghanistan, Bosnia and Herzegovina and North Korea.
The error a restricted user sees is named "Insufficient privileges" or "Unavailable for legal reasons", S4.
This host reaches LATOKEN through a VPN exit in Canada, which is a restricted country.
Every documented public REST path answered 200 through a Cloudflare edge whose `cf-ray` ends in `YVR`, and every socket upgrade answered 101 from Cloudflare, see [`rest.md`](./rest.md) section 1 and [`websocket.md`](./websocket.md) section 1.
No public endpoint refused this host, and no reply carried a region or legal refusal.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, standard pairs, level 1 (under 10,000 USD of 30 day volume) | 0.59 %, 5,900 ppm | 0.59 %, 5,900 ppm | S1, and `/v2/trade/feeLevels` first row and `/v2/trade/fee/BTC/USDT` without credentials, P1 |
| spot, "exclusive tokens" list, level 1 | 0.49 %, 4,900 ppm | 0.98 %, 9,800 ppm | S1 only, the wire did not show it, section 4 |
| perpetuals | absent | absent | section 3 |

The unauthenticated `/v2/trade/fee/{currency}/{quote}` reply is `"makerFee":"0.005900000000000000","takerFee":"0.005900000000000000"` on 9 of the 10 pairs asked, P1.
LA/USDT answered `0.0011` maker and `0.0014` taker, section 4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals | absent | the REST v2 OpenAPI file lists 56 paths and none names futures, swap, margin, funding, mark or index, S2. CCXT sets `'swap': false` at `server/node_modules/ccxt/js/src/latoken.js` line 29, and `loadMarkets` returned 1,245 spot markets and 0 swaps, P1 |
| coin-margined or USDC perpetuals | absent | same evidence |
| dated futures | absent | CCXT `'future': false` at line 30, and no futures path in S2 |
| options | absent | CCXT `'option': false` at line 31 |
| margin | absent | CCXT `'margin': false` at line 28, and no margin path in S2 |
| spot | present | 1,231 active pairs of 1,246 on `/v2/pair`, 1,182 of them quoted in USDT, P1 and [`rest.md`](./rest.md) section 2 |
| P2P | present | a separate P2P API is documented at `https://api.latoken.com/doc/p2p/`, S2, and it is not a market the engine could use |
| deposit, withdrawal and refund fees | out of scope | listed on `https://latoken.com/fees`, S1 |

The one trace of a derivative in S2 is an account type enum, repeated three times, that lists `ACCOUNT_TYPE_FUTURES` and `ACCOUNT_TYPE_GLOBAL_MARKETS` beside `ACCOUNT_TYPE_WALLET` and `ACCOUNT_TYPE_SPOT`.
No path lists, quotes or trades a futures instrument, and the catalog held no global markets currency, see [`rest.md`](./rest.md) section 2.
CoinGecko's derivatives exchange list held 214 entries and none for LATOKEN on 2026-09-23 UTC, S8.
Two web paths were checked because their names suggest a product.
`https://latoken.com/futures` answered 200 with 35,514 bytes, but so did `https://latoken.com/futuress` with 34,523 bytes, and both were a web app shell whose only text is "You need to enable JavaScript to run this app.", while `https://latoken.com/zzzz-not-a-page` answered 404.
So that 200 is a route prefix of the web app, not a futures page.
The web app bundles it loads contained no "perpetual" string and used "future" only in date picker code.
A help center search for "perpetual" returned 0 articles, and "futures" returned 5, none of which describes a futures product, S6.

## 4. Spot tiers

### Standard pairs, from the fee page on 2026-09-22

| level | 30 day volume, USD | maker | taker | taker ppm |
|---|---|---:|---:|---:|
| 1 | less than 10,000 | 0.59 % | 0.59 % | 5,900 |
| 2 | 10,000 to 100,000 | 0.49 % | 0.49 % | 4,900 |
| 3 | 100,000 to 250,000 | 0.34 % | 0.34 % | 3,400 |
| 4 | 250,000 to 500,000 | 0.12 % | 0.19 % | 1,900 |
| 5 | 500,000 to 1,000,000 | 0.07 % | 0.11 % | 1,100 |
| 6 | 1,000,000 to 2,500,000 | 0.06 % | 0.09 % | 900 |
| 7 | 2,500,000 to 10,000,000 | 0.04 % | 0.07 % | 700 |
| 8 | 10,000,000 to 20,000,000 | 0.02 % | 0.05 % | 500 |
| 9 | more than 20,000,000 | zero | 0.04 % | 400 |

`GET /v2/trade/feeLevels` returned the same nine rows as fractions, with `volume` thresholds `0`, `10000`, `100000`, `250000`, `500000`, `1000000`, `2500000`, `10000000` and `20000000`, P1.

```json
[{"makerFee":"0.0059","takerFee":"0.0059","volume":"0"},{"makerFee":"0.0049","takerFee":"0.0049","volume":"10000"},{"makerFee":"0.0034","takerFee":"0.0034","volume":"100000"},{"makerFee":"0.0012","takerFee":"0.0019","volume":"250000"},{"makerFee":"0.0007","takerFee":"0.0011","volume":"500000"},{"makerFee":"0.0006","takerFee":"0.0009","volume":"1000000"},{"makerFee":"0.0004","takerFee":"0.0007","volume":"2500000"},{"makerFee":"0.0002","takerFee":"0.0005","volume":"10000000"},{"makerFee":"0","takerFee":"0.0004","volume":"20000000"}]
```

### Exclusive tokens, from the fee page on 2026-09-22

The page says "Since the tokens are exclusively listed on LATOKEN, we need to spend additional funds to maintain their liquidity, as a result of which fees increase for the next tokens", and lists 85 pairs, among them `CADINUUSDT`, `LAUSDT`, `FONEUSDT` and `TREEUSDT`, S1.

| level | 30 day volume, USD | maker | taker |
|---|---|---:|---:|
| 1 | less than 10,000 | 0.49 % | 0.98 % |
| 2 | 10,000 to 50,000 | 0.39 % | 0.78 % |
| 3 | 50,000 to 100,000 | 0.29 % | 0.58 % |
| 4 | 100,000 to 250,000 | 0.12 % | 0.38 % |
| 5 | 250,000 to 1,000,000 | 0.07 % | 0.22 % |
| 6 | 1,000,000 to 2,500,000 | 0.06 % | 0.18 % |
| 7 | 2,500,000 to 10,000,000 | 0.04 % | 0.14 % |
| 8 | 10,000,000 to 25,000,000 | 0.02 % | 0.1 % |
| 9 | more than 25,000,000 | zero | 0.08 % |

### The per pair fee on the wire on 2026-09-23 UTC

`GET /v2/trade/fee/{currency}/{quote}` without credentials, P1.

| pair | on the exclusive list | makerFee | takerFee |
|---|---|---|---|
| BTC/USDT, ETH/USDT, SOL/USDT, TRX/USDT, ETH/BTC, BTC/USDC | no | 0.0059 | 0.0059 |
| CADINU/USDT, FONE/USDT, TREE/USDT | yes | 0.0059 | 0.0059 |
| LA/USDT | yes | 0.0011 | 0.0014 |

Every reply also carried `"type":"FEE_SCHEME_TYPE_PERCENT_QUOTE"` and `"take":"FEE_SCHEME_TAKE_PROPORTION"`.
The page and the wire disagree on the exclusive pairs: three of them answered the standard 0.59 %, and LA/USDT answered a rate lower than either table.
Which one a level 1 account is charged was not verifiable without an account.
The same call with currency ids in place of tags, `/v2/trade/fee/92151d82-…/0c3a106d-…`, gave the BTC/USDT answer.

### Qualification

The page says "Our system measures and updates your previous 30 day trading volume every minute including all trades across all crypto pairs.", S1.
It goes on "Then it is converted into a USDT equivalent using prices across 17 exchanges.", and "New fee level only applies to newly placed orders.", S1.

## 5. Discounts that change the spot taker

| discount | rule | source |
|---|---|---|
| LA staking | 10 % off from 10,000 LA staked, 15 % from 25,000, 20 % from 50,000, 30 % from 100,000, 40 % from 250,000 and 50 % from 500,000 | S1 |
| market maker or corporate client | "you are welcome to contact us", terms Not publicly specified | S1 |
| zero fee promotion | none found on the fee page | S1 |

The LA/USDT REST book stood at a bid of 0.00220 and an ask of 0.00280 USDT at 04:25, 04:40 and 04:45 UTC on 2026-09-23, in the REST compare of `ws-probe.mjs book`, P2, so the first staking level is about 28 USDT of LA at that ask.
Whether the staking discount applies before or after the level is Not publicly specified.

## 6. Funding as a cost

Not applicable.
LATOKEN lists no perpetual, so it charges no funding.

## 7. Liquidation, settlement and delisting

Not applicable to spot, and no liquidation or settlement charge exists.
The fee page names a refund fee for a token sent on an unsupported chain: the BNB equivalent of 30 USD on BSC, the ETH equivalent of 100 USD on Ethereum, and the MATIC equivalent of 30 USD on Polygon, S1.
A delisting charge is Not publicly specified.

## 8. CCXT

| item | value | source |
|---|---|---|
| `market.taker` on every one of the 1,245 markets | 0.0049, 4,900 ppm | P1, from `server/node_modules/ccxt/js/src/latoken.js` line 210 |
| `market.maker` | 0.0049 | line 209 |
| `tierBased`, `percentage`, `feeSide` | `false`, `true`, `'get'` | lines 206 to 208 |
| how it reaches the market | the class constant is merged into every market by `deepExtend(..., this.fees['trading'], value)` | `server/node_modules/ccxt/js/src/base/Exchange.js` line 3735 |
| swap markets | 0 of 1,245 | P1 |

CCXT's 0.49 % is the level 2 rate, not the level 1 rate of 0.59 % that the page and `/v2/trade/feeLevels` publish.
CCXT fetches a user's real rate only through `fetchTradingFee`, which defaults to the private endpoint, at lines 278 and 279.

## 9. Recommended registry values

LATOKEN cannot join the engine as a perpetual leg, so no registry entry is recommended.
The connector would find 0 active swap markets and skip the venue, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 79 and 196 to 202.
If a spot leg were ever modelled, the values would be `takerPpm: 5900`, the level 1 taker of S1 and P1, and `ccxtTakerPpm: 4900`, citing `server/node_modules/ccxt/js/src/latoken.js` line 210, because CCXT reports the level 2 rate.
An exclusive pair would need its own 9,800 ppm, or a deny line, until the page and the wire agree.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | LATOKEN Fees structure | https://latoken.com/fees | 2026-09-22 | LATOKEN, footer names Poland, LATrade and XasPay Sp. z.o.o. | tiers, exclusive tokens, staking, qualification, refund fee, Germany exclusion, sections 1, 2, 4, 5 and 7 |
| S2 | Latoken Public API V2, OpenAPI file behind the documentation page | https://api.latoken.com/doc/v2/swagger.json | 2026-09-22 | LATOKEN, global | 56 paths, no derivative path, P2P API link, section 3 |
| S3 | List of Temporarily Unsupported Countries, updated 2024-12-08 | https://latoken.zendesk.com/hc/en-us/articles/4404743664914-List-of-Temporarily-Unsupported-Countries | 2026-09-22 | LATOKEN, global | excluded regions, section 1 |
| S4 | Insufficient privileges, updated 2026-03-01 | https://latoken.zendesk.com/hc/en-us/articles/4406002317074-Insufficient-privileges | 2026-09-22 | LATOKEN, global | excluded regions and the refusal wording, section 1 |
| S5 | Terms of Use, help center article updated 2025-04-03, and the PDF it links | https://latoken.zendesk.com/hc/en-us/articles/360019022711-Terms-of-Use | 2026-09-22 | LATrade | the PDF answered HTTP 521, section 1 |
| S6 | LATOKEN help center search API, queries "futures" and "perpetual" | https://latoken.zendesk.com/api/v2/help_center/articles/search.json | 2026-09-22 | LATOKEN | no futures product, section 3 |
| S7 | CCXT 4.5.68 `latoken.js` | `server/node_modules/ccxt/js/src/latoken.js` | 2026-09-22 | CCXT | fee constant, market types, sections 3 and 8 |
| S8 | CoinGecko exchange API for `latoken`, and the derivatives exchange list at https://api.coingecko.com/api/v3/derivatives/exchanges/list | https://api.coingecko.com/api/v3/exchanges/latoken | 2026-09-23 UTC | CoinGecko | country, rank, volume, absence from the derivatives list, sections 1 and 3 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/latoken/rest-probe.mjs) `fees` and `catalog`, runs at 04:19 to 04:20 UTC and rerun at 04:37 UTC with identical fee replies | [`rest-probe.mjs`](../../../scripts/probes/venues/latoken/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | fee levels, per pair fees, CCXT `market.taker`, market counts, sections 2 to 4 and 8 |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs) `book`, REST compare at the end of each run | [`ws-probe.mjs`](../../../scripts/probes/venues/latoken/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | LA/USDT book, section 5 |
