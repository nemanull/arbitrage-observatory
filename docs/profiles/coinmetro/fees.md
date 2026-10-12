# Coinmetro Fees Profile

**Status:** Done.
Coinmetro lists no perpetuals, and trading has been disabled since 2026-06-22, so the venue is profiled on its spot market as a defunct one.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:12 to 03:28 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the trading fees of Coinmetro, the Estonian exchange at `coinmetro.com` that CoinMarketCap lists at rank 124.
Coinmetro sells spot and spot margin, and no perpetuals, see section 3.
On 2026-06-22 it suspended registrations, deposits and withdrawals, disabled trading, and announced a reorganisation application to the Estonian court, S3.
Every public call still answers from this host, but every price, book and 24 hour figure is frozen, see [`rest.md`](./rest.md) sections 2 and 4.
CCXT 4.5.68 has no Coinmetro class, because CCXT delisted it on 2026-07-02, see section 8.
Source ids are shared with [`websocket.md`](./websocket.md) and [`rest.md`](./rest.md).

## 1. Scope and freshness

| item | value | source |
|---|---|---|
| operator | Coinmetro OÜ, Republic of Estonia, with a Financial Intelligence Unit licence for "providing a virtual currency services" in the site footer | S11 |
| status | registrations, deposits and withdrawals suspended from 2026-06-22, trading disabled, and a reorganisation application to the Estonian court | S3 |
| stated cause | "a failure of one of our financial service providers" | S3 |
| MiCA | an application with the Malta Financial Services Authority "is currently being reviewed", as of 2026-06-22 | S3 |
| press | Protos reported on 2026-06-30 that both Coinmetro OÜ and Coinmetro Group OÜ are past due on annual reports, and that the Prime Trust estate sued Coinmetro to claw back withdrawals | S10 |
| site banner on 2026-10-10 | "Announcement: Onboarding, trading, depositing and withdrawals paused." on the home page and the fee page | S11, S1, P1 |
| who may trade | nobody, trading is disabled for every account | S3, P2 |
| regions excluded | Not publicly specified, the help center that held the eligibility articles returns a Cloudflare 403 with error code 1014 from this host | P1, P2 |
| access from this host | every public API call answered with 200, no refusal and no region message, see [`rest.md`](./rest.md) section 1 | P2 |

The 2026-06-22 statement is the newest post on the blog listing, P1, and no later statement about trading was found on the site or in a web search on 2026-10-09.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, Level 0 "Regular Fee" | 0.10 %, 1,000 ppm | 0.20 %, 2,000 ppm | S1, P1 |
| perpetuals | Not offered | Not offered | section 3 |

These are the published rates of a market that does not trade today, so they are context and not a cost a route can incur.

## 3. Coverage matrix

| product | present | how it was established |
|---|---|---|
| perpetuals, any margin asset | no | the API documents no contract, funding or mark call, S4 and S5, the last CCXT class declared `'swap': false`, S7 line 30, and CoinMarketCap reports `perpetualVolume24h` 0, S9 |
| dated futures | no | the last CCXT class declared `'future': false`, S7 line 31, and none in S4 |
| options | no | none in S4, S5 or the site |
| spot | yes on paper, 130 pairs, all frozen | `GET /markets`, P2 |
| spot margin | yes on paper, 73 of the 130 pairs flagged `margin` true | `GET /markets`, P2, and the margin fee rows in S1 |
| swap widget, bundles, auto invest | named on the fee page | S1, not detailed |
| demo environment | a separate paper trading copy at `https://api.coinmetro.com/open` | S4, P2 |

## 4. Spot tiers

The tier is the account's Level, earned by points, 1 point per EUR equivalent traded on the exchange or margin and 2 per EUR on the swap widget, S2.
Points decay daily, at a rate that grows with the Level, S2.

| Level | points to enter | maker | taker | source |
|---|---|---|---|---|
| 0 | below 150 | 0.10 % | 0.20 % | S1, P1 |
| 1 | 150 | 0.10 % | 0.20 % | S1, S2, P1 |
| 2 | 5K | 0.10 % | 0.15 % | S1, S2, P1 |
| 3 | 50K | 0.05 % | 0.15 % | S1, S2, P1 |
| 4 | 150K | 0 % | 0.10 % | S1, S2, P1 |
| 5 | 300K | 0 % | 0.09 % | S1, S2, P1 |
| 6 | 500K | 0 % | 0.08 % | S1, S2, P1 |
| 7 | 1M | minus 0.005 % | 0.07 % | S1, S2, P1 |
| 8 | 5M | minus 0.005 % | 0.06 % | S1, S2, P1 |

The Levels page and the fee page agree on every maker and taker for Levels 1 to 8, P1.

| margin item | value | source |
|---|---|---|
| entry fee | 0.1 % | S1, P1 |
| exit fee | 0.1 % | S1, P1 |
| daily interest on borrowed margin | 0.08222 %, calculated every 4 hours | S1, P1 |

## 5. Discounts

| discount | effect on the spot taker | source |
|---|---|---|
| XCM staking | multiplies the points earned, so a higher Level comes sooner, and does not cut the fee directly | S2 |
| referral | a referral page exists, its fee effect is Not publicly specified | S11 |
| market maker | Not publicly specified | |
| zero fee promotion | a "Zero Fees" campaign rules page is in the sitemap, and no promotion is live while trading is disabled | S11, S3 |

## 6. Funding as a cost

Not offered.
Coinmetro has no perpetuals, so it has no funding.
The only periodic charge is the margin interest in section 4.

## 7. Liquidation, settlement and delisting charges

| item | value | source |
|---|---|---|
| liquidation | Not publicly specified, the margin help articles sit behind the refused help center | P1 |
| settlement | none, spot only | section 3 |
| delisting | an "Asset Delisting Update - April 2026" post is on the blog listing, and `GET /assets` shows 112 of 113 assets with `canTrade` false | P1, P2 |

## 8. CCXT

CCXT 4.5.68 has no Coinmetro class.
The installed folder `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 `.js` files, none has "metro" in its name, and none contains the string "coinmetro", P1.
So there is no installed file and line to cite.

The current CCXT source on GitHub at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` of 2026-10-08 lists 103 `ts/src` files and no `coinmetro.ts`, S8 and P1.
CCXT removed the class in commit `9d406980c0cf23b1329183ee56189fd14d2f8a31`, "fix(coinmetro)!: delist (#29069)", of 2026-07-02, which removed 28 files, S6 and P1.
The last `ts/src/coinmetro.ts`, at commit `aebca96c2a39599a2ccfc2a4dfe0b1a451c8e2a6`, declared `'swap': false` at line 30, `'future': false` at line 31, `'ws': false` at line 125, and a flat `'taker': this.parseNumber ('0.001')` with `'maker': this.parseNumber ('0')` at lines 206 and 207, S7 and P1.
That flat 0.1 % taker did not match the published Level 0 taker of 0.20 %, S1.
So CCXT reports no `market.taker` for this venue today.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | none | trading is disabled and there are no perpetuals, so the venue is not registered, and the published spot Level 0 taker would be 2000, S1 |
| `ccxtTakerPpm` | none | no CCXT class in 4.5.68 or on GitHub master |

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | What Are the Fees on Coinmetro? | https://coinmetro.com/what-are-the-fees-on-coinmetro | 2026-10-09 | Coinmetro OÜ | spot Levels, margin fees, sections 2 and 4 |
| S2 | Coinmetro Levels | https://coinmetro.com/levels | 2026-10-09 | Coinmetro OÜ | points and Level thresholds, section 4 |
| S3 | Announcement: Onboarding, trading, depositing and withdrawals paused | https://coinmetro.com/blog/announcement-onboarding-depositing-and-withdrawals | 2026-10-09 | Coinmetro OÜ, 2026-06-22 | suspension, disabled trading, reorganisation, MiCA application |
| S4 | COINMETRO API (PUBLIC), Postman collection | https://documenter.getpostman.com/view/3653795/SVfWN6KS | 2026-10-09 | Coinmetro | REST endpoints, read through `documenter.gw.postman.com/api/collections/3653795/SVfWN6KS` |
| S5 | CoinMetro API-DOCS README | https://github.com/CoinMetro/API-DOCS/blob/5edcc5caaaa4784d0ce5051072e8b1407ec087ef/README.md | 2026-10-09 | Coinmetro, last commit 2024-01-09 | rate limits, WebSocket, checksum |
| S6 | CCXT commit "fix(coinmetro)!: delist (#29069)" | https://github.com/ccxt/ccxt/commit/9d406980c0cf23b1329183ee56189fd14d2f8a31 | 2026-10-09 | CCXT | class removed on 2026-07-02 |
| S7 | CCXT `ts/src/coinmetro.ts` before the delist | https://github.com/ccxt/ccxt/blob/aebca96c2a39599a2ccfc2a4dfe0b1a451c8e2a6/ts/src/coinmetro.ts | 2026-10-09 | CCXT | the last class, section 8 |
| S8 | CCXT `ts/src` listing | https://github.com/ccxt/ccxt/tree/f0aca06eb7482f083bed8406fadfcc0c05e45b1c/ts/src | 2026-10-09 | CCXT | no class on master |
| S9 | CoinMarketCap exchange detail and market pairs | https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=coinmetro | 2026-10-09 | CoinMarketCap | status, fee URL, volumes |
| S10 | Coinmetro files for reorganization, blames failure of provider | https://protos.com/coinmetro-files-for-reorganization-blames-years-old-failure-of-provider/ | 2026-10-09 | Protos, 2026-06-30 | register status and the Prime Trust suit |
| S11 | Coinmetro home page and sitemap | https://coinmetro.com/ | 2026-10-09 | Coinmetro OÜ | banner, footer licence, sitemap pages |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/coinmetro/fees-probe.py) | `uv run scripts/probes/venues/coinmetro/fees-probe.py` | 2026-10-09 | this host, Canadian exit | fee and Levels pages, help center refusal, CCXT checks |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/coinmetro/rest-probe.py) | `uv run scripts/probes/venues/coinmetro/rest-probe.py` | 2026-10-09 | this host, Canadian exit | access, catalog and frozen market data |
