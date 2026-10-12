# MGBX Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 Pacific time, which is 02:24 to 03:10 UTC on 2026-10-10, from the development host near Seattle, through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.
The first run of 2026-09-23 UTC used [`rest-probe.mjs`](../../../scripts/probes/venues/mgbx/rest-probe.mjs), which stays as frozen evidence, and every number below was read again on 2026-10-10 UTC with [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py).

This profile covers the USDT-margined perpetuals of MGBX Global, formerly Megabit, which is the only perpetual family the venue lists.
MGBX publishes no API documentation, so the fee numbers come from its help center and from the per-contract fields of the catalog call its web app uses, see [`rest.md`](./rest.md) section 2.
There is no CCXT class for MGBX, so section 8 has no CCXT constant to record.

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | "MGBX Global Company", "registered and operates in British Virgin Islands (BVI)" | S4 |
| other entity named | "MSB Registration Number: 31000309132641", "Legal Name: MGBX TECH LTD." | S6 |
| governing law | "governed, interpreted and enforced in accordance with the laws of Canada" | S5 |
| excluded from positions and contracts | Hong Kong, Cuba, Iran, North Korea, Crimea, Sudan, Malaysia, Syria, United States, Puerto Rico, American Samoa, Guam, Northern Mariana Islands | S5 |
| excluded from contract trading | "You declare and guarantee that you are not from the United States or Canada" | S7 |
| US persons | may not trade the perpetuals, by S5 and S7 | S5, S7 |
| automated access | the User Agreement forbids "any system or automatic data collection activities related to this website (including but not limited to data scraping ...)" without MGBX's written consent | S5 |
| sanctions screening | OFAC, UN Security Council and Hong Kong lists | S8 |

The Zendesk `edited_at` field gives the last edit of each article: the two perpetual fee articles on 2026-04-03, the User Agreement on 2026-04-07, the Service Agreement on 2026-04-13, the Deduction Bonus rules on 2026-08-03 and the User Terms of Use on 2026-08-04.
None of them changed between the first run and 2026-10-09.
Every help center page was read through the public Zendesk articles API at `https://support.mgbx.com/api/v2/help_center/en-us/articles.json`, which returned all 75 English articles to this host with HTTP 200 on 2026-10-09, the same count as on 2026-09-22.
The public market data calls answered this host from the Canadian exit with HTTP 200, although S7 excludes Canada from contract trading, see [`rest.md`](./rest.md) section 1.

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| USDT-M perpetuals, documented | 0.03 %, 300 ppm | 0.05 %, 500 ppm | S1 |
| USDT-M perpetuals, `symbol/list` on 274 contracts | 0.03 % on 39, 0.05 % on 223, 0.06 % on 3, 0.1 % on 9 | 0.05 % on 261, 0.1 % on 12, 0.005 % on 1 | P1 |

`btc_usdt` and `eth_usdt` carry maker `"0.0003"` and taker `"0.0005"` in the catalog, the documented pair.
The fee is per contract, and the catalog is the only complete list, see section 4.
No VIP ladder is published, so the retail rate is the only rate, see section 4.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M linear perpetuals, crypto | yes, 167 contracts, `targetType` 1 | P1 |
| USDT-M linear perpetuals, stocks, ETFs, metals and energy | yes, 107 contracts, `targetType` 2, for example `xau_usdt`, `aapl_usdt`, `qqq_usdt`, `cl_usdt` | P1 |
| coin-margined perpetuals | absent: the web app's coin-M path `futures/dapi/market/v1/public/symbol/list` answers `{"code":0,"msg":"success","data":[]}` | P1 |
| USDC-margined perpetuals | absent: every contract has `quoteCoin` `usdt` | P1 |
| dated futures | absent: every contract has `contractType` `PERPETUAL` | P1 |
| options | absent: no product or help article names one | S1 to S9 |
| event contracts | announced, up or down predictions over a fixed period, not probed | S10 |
| spot | present, 281 pairs in `https://www.mgbx.com/pro/p/symbol/list`, maker and taker 0.1 % | P1, S9 |

The venue listed 267 perpetuals on 2026-09-23 and 274 on 2026-10-10 UTC, all with `state` 0 and `tradeSwitch` true, P1.
The newest five were listed up to 2026-10-09 10:00 UTC, among them `nke_usdt`.
MGBX is not on CoinGecko's exchange list of 1,503 ids or its derivatives exchange list of 216 ids, which returned no id matching `mgbx` or `megabit` on 2026-10-09, S15.

## 4. Perpetual tiers

No VIP or volume tier is published.
No help center article mentions "VIP", and the fee articles name one maker and one taker rate, S1.

The rate differs per contract instead.
S2 is a table of 162 contracts with a taker and a maker column, and the live catalog carries `makerFee` and `takerFee` on each of its 274 rows, P1.

| taker | maker | contracts on 2026-10-10 UTC | examples |
|---|---|---:|---|
| 0.0005 | 0.0003 | 39 | `btc_usdt`, `eth_usdt`, `sol_usdt`, `doge_usdt` |
| 0.0005 | 0.0005 | 222 | most contracts listed after 2024, every `targetType` 2 contract |
| 0.001 | 0.0006 | 3 | `bch_usdt`, `aave_usdt`, `avax_usdt` |
| 0.001 | 0.001 | 9 | `jto_usdt`, `act_usdt`, `1000cheems_usdt`, `akt_usdt`, `morpho_usdt`, `chillguy_usdt`, `the_usdt`, `sand_usdt`, `mana_usdt` |
| 0.00005 | 0.0005 | 1 | `mega_usdt` |

The catalog and S2 disagree on some rows.
S2 lists `aave` at taker 0.0005 and maker 0.0003, while the catalog gives `aave_usdt` taker `0.001` and maker `0.0006`.
The catalog is what the web app shows, so it is taken as current.
The 12 contracts at taker 0.001 and `mega_usdt` at 0.00005 were the same contracts on 2026-09-23 and 2026-10-10 UTC.

### Qualification

None is published.

## 5. Discounts that change the perpetual taker

| discount | terms | effect on the taker |
|---|---|---|
| Deduction Bonus | trial funds from the Rewards Center that "can only be used to offset futures trading fees, closing losses and funding fees", and cannot be withdrawn | pays part of a fee from a promotional balance, the rate itself is unchanged, S3 |
| token holding | none published | none |
| referral | a Referral Commission page exists in the account menu, terms not published in the help center | not established |
| market maker | none published | none |
| zero fee promotion | none found in the 75 English articles | none |

## 6. Funding as a cost

| item | value | source |
|---|---|---|
| formula | Not publicly specified. The help center says only that the rate keeps "the perpetual contract price aligned with the spot price" | S11 |
| charge | "Funding Fee = Position Value (Actual Notional Value of the Position) × Current Funding Rate" | S11 |
| who pays | positive rate: longs pay shorts. Negative rate: shorts pay longs. "The funding fee is settled entirely between users, and the platform does not charge any fee" | S2, S11 |
| documented interval | every 8 hours "at 08:00, 16:00, and 24:00 (UTC+8)", which is 00:00, 08:00 and 16:00 UTC | S11 |
| probed interval | `collectionInterval` 8 on 141 contracts, 4 on 132 and 2 on `xdp_usdt` | P2 |
| next settlement | 141 contracts read 2026-10-10 08:00 UTC and 133 read 04:00 UTC, at 02:58 UTC | P2 |
| cap and floor | per contract `fundingRateUpperLimit` and `fundingRateLowerLimit`: ±0.03 on 265 contracts, ±0.005 on `pepe_usdt`, `sats_usdt`, `bonk_usdt` and `core_usdt`, ±0.001 on `mask_usdt`, `babydoge_usdt` and `sand_usdt`, and ±0.00001 on `btc_usdt` and `eth_usdt` | P2 |
| rates at the cap | 7 contracts, among them `btc_usdt` −0.00001, `eth_usdt` +0.00001, `pepe_usdt` +0.005 and `shib_usdt` +0.03 | P2 |
| position held at the instant | "Fees are only charged or paid if a position is held at these times" | S2 |

The documented interval is 8 h, and the wire says 4 h for 132 contracts and 2 h for one, so the per contract field is the one to trust.
The `btc_usdt` and `eth_usdt` cap of 0.001 % per 8 h is 1 % of the 0.03 cap on most other contracts.
The last ten `btc_usdt` settlements were −0.00001 four times, +0.00001 five times and −0.00000759 once, and the last ten `eth_usdt` settlements were +0.00001 nine times, P2.
A cap that tight makes the published rate a saturated number on the two largest contracts.
`shib_usdt` published +0.03, 3 % per 4 or 8 h, on both 2026-09-23 and 2026-10-10 UTC, P2.
The settlement instant itself was not captured, and the history call is described in [`rest.md`](./rest.md) section 4.
S2 names another platform in its funding paragraph: "Funding fees are collected between users, and Sunbit does not charge any funding fees."

## 7. Liquidation, settlement and delisting

| item | value | source |
|---|---|---|
| liquidation fee | the catalog field `liquidationFee` is `0` on 146 contracts, `0.0001` on 126, `0.015` on `btc_usdt` and `0.01` on one other. Its meaning is Not publicly specified | P1 |
| maintenance margin | a tier table exists, S12, not recorded here | S12 |
| price protection | when "the deviation between the mark price and the latest price exceeds the system-defined threshold", market orders may fill partly and market stop orders may not trigger | S13 |
| delisting | no delisting article and no procedure published | S1 to S13 |
| deposit and withdrawal | see the official lookup in the help center withdrawal guide | S14 |

## 8. CCXT

MGBX has no CCXT class.
The installed CCXT 4.5.68 has 104 class files in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`, and none is named `mgbx` or `megabit`, P1.
Its exchanges map in `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/ccxt.js` lines 232 to 337 has 104 keys, and none matches either name.
The GitHub contents listing of `ts/src` on the CCXT master branch returned 110 entries on 2026-10-09, and none matches either name.
So there is no `market.taker` to read and no source line to cite.

## 9. Recommended registry values

| field | value | reason |
|---|---|---|
| `takerPpm` | 500 | the documented VIP 0 taker, S1, and the catalog taker on 261 of 274 contracts, P1 |
| `ccxtTakerPpm` | none | no CCXT class exists |
| per contract taker | read `takerFee` from `symbol/list` if MGBX is ever added | 12 contracts charge 1,000 ppm and `mega_usdt` 50 ppm, P1 |

The Rust server keeps a venue's taker as a constant in its own markets module, as Gate does at [`gate/markets.rs`](../../../server/src/venues/gate/markets.rs) line 10.
MGBX would need such a module that reads `symbol/list`, see [`rest.md`](./rest.md) section 8.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Perpetual Futures Trading Fee Description | https://support.mgbx.com/hc/en-us/articles/15686595945999-Perpetual-Futures-Trading-Fee-Description | 2026-10-09 | MGBX Global | taker 0.05 %, maker 0.03 %, sections 2 and 4 |
| S2 | Perpetual Futures Parameters and Fee Explanation | https://support.mgbx.com/hc/en-us/articles/15686585782543-Perpetual-Futures-Parameters-and-Fee-Explanation | 2026-10-09 | MGBX Global | per contract fee table, funding times and payer, sections 4 and 6 |
| S3 | MGBX Futures Deduction Bonus Usage Rules and Risk Control Rules 2026 | https://support.mgbx.com/hc/en-us/articles/15686443797775-MGBX-Futures-Deduction-Bonus-Usage-Rules-and-Risk-Control-Rules-2026 | 2026-10-09 | MGBX Global | section 5 |
| S4 | User Terms of Use | https://support.mgbx.com/hc/en-us/articles/15688358755343-User-Terms-of-Use | 2026-10-09 | MGBX Global, BVI | section 1 |
| S5 | User Agreement | https://support.mgbx.com/hc/en-us/articles/15710613237007 | 2026-10-09 | MGBX Global | excluded residents, governing law, automated access, section 1 |
| S6 | Introduction to MGBX Global Exchange | https://support.mgbx.com/hc/en-us/articles/15685507064207 | 2026-10-09 | MGBX TECH LTD. | MSB registration, section 1 |
| S7 | Service Agreement | https://support.mgbx.com/hc/en-us/articles/15710565483919 | 2026-10-09 | MGBX Global | United States and Canada excluded from contract trading, section 1 |
| S8 | Disclaimer | https://support.mgbx.com/hc/en-us/articles/15688397762191 | 2026-10-09 | MGBX Global | sanctions screening, section 1 |
| S9 | Spot parameters and rate description | https://support.mgbx.com/hc/en-us/articles/15685658408079 | 2026-10-09 | MGBX Global | spot 0.1 %, section 3 |
| S10 | Announcement on the Launch of Event Contracts | https://support.mgbx.com/hc/en-us/articles/15711329650319 | 2026-10-09 | MGBX Global | section 3 |
| S11 | Common Questions about Perpetual Contracts | https://support.mgbx.com/hc/en-us/articles/15686576397327 | 2026-10-09 | MGBX Global | funding charge and times, section 6 |
| S12 | Futures Maintenance Margin Tier Information Table | https://support.mgbx.com/hc/en-us/articles/15686541015311 | 2026-10-09 | MGBX Global | section 7 |
| S13 | Explanation of the Price Protection Mechanism | https://support.mgbx.com/hc/en-us/articles/15686517081103 | 2026-10-09 | MGBX Global | section 7 |
| S14 | Withdrawal Step-by-Step Guide | https://support.mgbx.com/hc/en-us/articles/15723376917647 | 2026-10-09 | MGBX Global | section 7 |
| S15 | CoinGecko exchange and derivatives exchange lists | https://api.coingecko.com/api/v3/exchanges/list and https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-10-09 | CoinGecko | section 3 |
| P1 | `rest-probe.py catalog` | [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py) | 2026-10-10 02:24 UTC and the second pass | this host | fees, families, CCXT, sections 2 to 4, 7 and 8 |
| P2 | `rest-probe.py funding` | [`rest-probe.py`](../../../scripts/probes/venues/mgbx/rest-probe.py) | 2026-10-10 02:47 UTC and the second pass | this host | intervals, caps, rates at the cap, history, section 6 |
| P0 | `rest-probe.mjs catalog`, `funding` and `mirror`, the first run | [`rest-probe.mjs`](../../../scripts/probes/venues/mgbx/rest-probe.mjs) | 2026-09-23 06:42 to 07:12 UTC | this host | the 267 contracts and the `shib_usdt` reading of 2026-09-23, sections 3, 4 and 6 |
