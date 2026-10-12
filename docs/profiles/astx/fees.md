# ASTX Fee Profile

**Status:** Done.
ASTX lists USDT-margined perpetuals, so this profile covers them, but its only site refuses every TLS handshake from this host and it publishes no API.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 05:13 to 05:33 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through the user's Surfshark WireGuard exit in Canada (Vancouver, AS212238 Datacamp Limited).

ASTX trades at `www.astx.io` and is rank 216 on CoinMarketCap.
It has no CCXT class, so the folder is the slug `astx`.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/astx/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/astx/rest-probe.py).

The finding that governs every section: `www.astx.io` and `astx.io` accept a TCP connection, read the TLS Client Hello, send nothing, and close the connection about 12 s later, on every address of the edge and with any SNI, see [`rest.md`](./rest.md) section 1.
So nothing on the trading site was read from this host.
The fee numbers below come from ASTX's help center, which is a Zendesk site at `support.astx.io` whose JSON API answers from this host, and from CoinMarketCap.

## 1. Scope and freshness

| item | value | evidence |
|---|---|---|
| retrieval date | 2026-10-09 | this profile |
| legal entity | Not publicly specified. The help center's Zendesk account is `astxtechltd`, which suggests a company named ASTX Tech Ltd, but no page that was read names a company, a registration number or a licence. The Terms of Use say ASTX "is governed by the laws and regulations of Singapore and those applicable to the user's place of residence". | S3, S6, P1 sections "help center article list" and "terms of use" |
| CoinMarketCap record | id 33178, `dateLaunched` 2021-11-07, status active, description "Founded in 2021 and headquartered in Singapore", no countries and no fiat listed | S1, P1 section "CoinMarketCap exchange record" |
| what it sells | USDT-margined perpetuals, spot, event contracts, copy trading and an OTC desk | S2, S4, S6 |
| who may trade | Not publicly specified. The Terms of Use name no eligible or excluded region. | S6 |
| regions excluded | Not publicly specified. No article among the 72 in the help center names a restricted country, the United States or Canada. | P1 sections "help center article list" and "terms of use" |
| access from this host | refused. Every TLS handshake to the trading site ends with the server closing the connection after about 12 s, and plain HTTP on port 80 gets 0 bytes and the same close. The help center answers 200. | [`rest.md`](./rest.md) section 1 |

CoinMarketCap's record and ASTX's own Platform Introduction article carry the same text, which claims "compliance registrations in multiple countries" and "legal licenses" without naming any, S1 and S6.

## 2. Quick answer

| product | maker | taker | evidence |
|---|---|---|---|
| USDT-margined perpetuals, VIP 0 | 0.04%, 400 ppm | 0.04%, 400 ppm | Published, every one of the 182 pairs in Perpetual Contract Parameter Tables (I) and (II) reads "maker:0.04% taker:0.04%", S2, P1 section "perpetual parameter tables" |
| spot, every pair | 0.1%, 1000 ppm | 0.1%, 1000 ppm | Published in the Spot Trading Fee Announcement, effective 2025-12-05, S4 |
| as CoinMarketCap records it | 0 | 0 | `makerFee 0.0`, `takerFee 0.0` in the record, S1 |

CoinMarketCap's zero is a missing value, not a rate, since ASTX's own tables name 0.04%.
The fee is charged on notional: "Fee = Position Value × Fee Rate (Open/Close Price × Quantity × Fee Rate)", S2.
No fill could be observed, because no account was opened and the trading site does not answer this host.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| USDT-margined perpetuals | present, 182 pairs in the parameter tables, 153 on CoinMarketCap | S2, S1 market pairs, P1 sections "perpetual parameter tables" and "CoinMarketCap market pairs" |
| USDC-margined perpetuals | Not offered | every pair in both tables and on CoinMarketCap is quoted in USDT |
| coin-margined perpetuals | Not offered | same evidence, and the delisting notices say "U-Margined" |
| dated futures | Not offered | CoinMarketCap's futures pair list is empty, and no help article names a delivery contract |
| options | Not offered | no help article names options |
| event contracts | present | the help articles "ASTX Event Contracts Product Description & Rules" and "ASTX Event Contract Explanation" say they are priced at the mark price, S3 |
| spot | present, 149 USDT pairs on CoinMarketCap | S1 market pairs |

All 153 perpetuals on CoinMarketCap appear in the parameter tables.
The 29 table pairs that CoinMarketCap does not list were not checked further, since no catalog could be read from ASTX itself.
Tables (I) and (II) were updated on 2026-08-24 and 2026-10-09, and the newest listing notice, for EKSUSDT and TRYVUSDT, is dated 2026-10-09, so the venue is live.

## 4. Every published perpetual tier

None published.
No article names a VIP level, a fee tier or a volume tier, P1 section "help center article list".
The parameter tables carry risk tiers instead, which set leverage and maintenance margin per notional band.
BTC/USDT has 11 risk tiers from 200x with 0.25% maintenance margin up to a notional of 100,000,000, to 1x with 50% maintenance margin, S2.
CoinMarketCap and The Grid describe a 50x cap, while the table offers 200x on BTC, ETH and SOL, S2 and S7.

## 5. Discounts that change the perpetual taker

| discount | value | evidence |
|---|---|---|
| token holding | Not offered, no ASTX token was found | S3 |
| referral and agent rebate | Published. The Perpetual Futures Referral Rebate Program returns 80% of referred users' fees above 3 million USDT of monthly volume, 85% above 20 million, 88% above 200 million and 90% above 500 million. It pays the agent, not the trader. | S5, P1 section "agent rebate programme" |
| market maker programme | Not publicly specified | S3 |
| zero fee promotion | Not publicly specified. The "2026 Mega Rewards Carnival" is a prize campaign and names no fee waiver. | S3 |

## 6. Funding as a cost

| item | value | evidence |
|---|---|---|
| formula | Not publicly specified. The help center says only that the rate is "typically based on the difference between the futures contract price and the spot market price". | S3 |
| interval | 8 h on 176 pairs and 4 h on 6 pairs (BINO, MONO, SJA, XP, EKS, TRYV), all from table (II) | S2, P1 section "perpetual parameter tables" |
| cap and floor | ±0.3% per interval on all 182 pairs | S2 |
| who pays | longs pay shorts when the rate is positive, shorts pay longs when it is negative | S2, S3 |
| settlement times | Not publicly specified | S3 |
| current rates | Not verified. CoinMarketCap shows `fundingRate` 0 on all 153 perpetuals, which reads as a missing feed field, not a rate. | P1 section "CoinMarketCap market pairs" |

## 7. Liquidation, settlement and delisting charges

No liquidation fee or insurance fund charge is named.
The liquidation articles say a long is liquidated when the mark price falls below the liquidation price and a short when it rises above, S3.
Delisting notices for XJO/USDT, JDB/USDT and IPUSDT say open positions are settled "in accordance with the applicable contract settlement rules", and name no fee or settlement price, S3.

## 8. CCXT

CCXT 4.5.68 has no ASTX class.
None of the 104 `.js` files in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` is named for ASTX, and none contains the word `astx`, P1 section "CCXT".
CCXT master on GitHub has no such class either, 103 `.ts` files in `ts/src` on 2026-10-10 and none named for ASTX, S8.
So there is no `market.taker` to read.

## 9. Recommended registry values

None.
The Rust adapters under [`../../../server/src/venues/`](../../../server/src/venues/) each read a perpetual catalog, a book socket and an anchor call, and ASTX offers none of them to this host.
If the site later answers and a public API turns up, `takerPpm` would be 400 from the parameter tables, and there is no `ccxtTakerPpm` to declare.

## 10. Source ledger

| id | source | what it gave |
|---|---|---|
| S1 | `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=astx` and `.../exchange/market-pairs/latest?slug=astx&category=<spot,perpetual,futures>`, read by `fees-probe.py` | id, launch date, description, the zero fee fields, 149 spot and 153 perpetual pairs, 0 futures pairs |
| S2 | Perpetual Contract Parameter Table (I) and (II), help articles 14834308052111 and 14832769069967, read through `https://support.astx.io/api/v2/help_center/en-us/articles/<id>.json` | maker and taker, contract value, price precision, funding cap and interval, risk tiers for 182 pairs |
| S3 | `https://support.astx.io/api/v2/help_center/en-us/articles.json`, all 72 articles | the funding text, liquidation and delisting rules, event contracts, the absence of any API, VIP or region article |
| S4 | ASTX Spot Trading Fee Announcement, article 14534137215887 | the uniform 0.1% spot fee from 2025-12-05 |
| S5 | ASTX Global Agent Recruitment, article 15727051822863 | the agent rebate bands |
| S6 | ASTX Terms of Use, article 14533480830223, and ASTX Platform Introduction, article 14528962097167 | governing law, the Singapore claim |
| S7 | `https://thegrid.id/profiles/astx` | a third-party description: spot and USDT-margined perpetuals up to 50x, event contracts, copy trading |
| S8 | `https://api.github.com/repos/ccxt/ccxt/contents/ts/src`, read by `fees-probe.py` | no ASTX class on CCXT master |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/astx/fees-probe.py) | every probed line above |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/astx/rest-probe.py) | the refused handshakes and the help center's 200 |
