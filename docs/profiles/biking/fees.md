# BiKing Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The survey is dated 2026-09-22, and the host clock read 2026-09-24 when these pages were read and probed.

This profile covers the USDT-margined perpetual futures of BiKing, the only perpetual family the venue describes.
BiKing publishes no API documentation, and its website's data endpoints return an encrypted body, see [`rest.md`](./rest.md) section 2.
So every fee below comes from the help center articles, and none of it could be checked against a market reply.

## 1. Scope and freshness

- The operator is named as BIKINGEX PTE.LTD, registered in Singapore under number 202120370C, in the definitions of the Service Agreement, S3.
- Disputes go to the Singapore International Arbitration Centre, S3.
- The Service Agreement excludes persons in "Countries listed on the Prohibited Countries List", S3.
  Its definition of that list reads "the list of countries accessible via." and gives no link, so the list itself could not be read.
- The only regions named in the agreement are Cuba, Iran, North Korea and Syria, as "jurisdictions deemed high risk by BiKing", S3.
- The agreement does not name the United States, Canada or mainland China anywhere, S3.
  Whether US persons may trade the perpetuals is Not verified.
- The official site named by CoinMarketCap is `https://www.bikingex.com/`, S6.
  The site's own config file names 26 distinct hosts for the apps, such as `https://www.bikingex0.com` and `https://fast.bkgtogo.com`, S7.
  `biking.com` is an unrelated parked domain that redirects to `/lander`, probed 2026-09-24.
- CoinMarketCap's derivatives ranking lists BiKing at rank 72 with 172 derivatives pairs and about 3,644M USD of open interest on 2026-09-23, as given in the survey brief.
  A fetch of S8 on 2026-09-24 showed BiKing only in the unranked list without numbers, so these figures were not re-verified.

## 2. Quick answer

| family | maker | taker | source |
|---|---|---|---|
| USDT-M perpetuals | 0.04 %, 400 ppm | 0.04 %, 400 ppm | S1 and S2 |

Maker and taker are the same rate, and no tier table or VIP program is published.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | yes | S2 describes "perpetual futures ... with USDT futures as the pricing unit and settlement unit", with BTCUSDT as the example |
| coin-margined perpetuals | Not verified, none described | no help center article describes one |
| USDC-M perpetuals | Not verified, none described | no help center article describes one |
| dated futures | Not verified | CoinMarketCap shows a "Futures" market type, S6, and no help center article describes a dated contract |
| options | yes, a third-party product | S4 cancels the options service fee from 2025-05-16 08:00 UTC, and the website bundle calls `/excellent/options/getSaasOptionUrl`, S7 |
| spot | yes | S5, USDT pairs, fee stated as both 0 and 0.12 % in the same article |
| simulated futures | yes | `simulatedContract` host in the site config, S7 |

## 4. Perpetual tiers

No tier table is published.
S1, updated 2026-06-22, gives a single rate: "Taker: 0.04% Maker: 0.04%".
S2, updated 2025-11-17, gives the same two numbers.
The fee formula is "Handling fee = transaction amount * handling fee rate", S1.

## 5. Discounts that change the perpetual taker

- No token holding discount, market maker program or zero fee promotion for perpetuals was found in the help center, searched on 2026-09-24 with the queries `API`, `open api`, `fee`, `funding` and `contract fee`, S9.
- A referral program pays commission to the referrer, "Earn 20% Commission with the Upgraded BiKing Referral Program!", article 28765291326097 in S9 results.
  As far as the title shows, it does not change the taker's own rate, and the body was not read.
- Spot has a zero fee section, article 21304917997969 in S9 results, which does not apply to perpetuals.

## 6. Funding as a cost

- Interval: every 8 hours, "at UTC+8 00:00, UTC+8 8:00 and UTC+8 16:00", S2 and S10, which is 16:00, 00:00 and 08:00 UTC.
- Who pays: "When the funding rate is positive, longs pay shorts. When the funding rate is negative, shorts pay longs.", S10.
  The exchange takes no share, S10.
- Only a position held at the instant pays or receives, and a hedged pair pays on the net position only, S10.
- Fee: "Funding fee = position notional value * funding rate", S10.
- Formula: "Funding rate (F) = premium index (P) + clamp (interest rate (I) - premium index (P), 0.05%, -0.05%)", S10.
- No cap or floor on F itself is published, only the clamp on the interest term.
- One announcement changed the settlement cycle for DOGS and ACT, "Announcement on Adjusting the Funding Fee Settlement Cycle for DOGS and ACT", article 30809318003857, 2024-12-10, in S9 results, so the interval is per contract and not always 8 hours.
  Its body was not read.
- The settlement instant itself was not captured, and no public funding history endpoint exists to read it from.

## 7. Liquidation, settlement and delisting

- A position is force closed when the risk rate falls below 10 %, where risk rate is position funds over opening margin, S2.
- The maximum leverage "can reach 125 times", S2.
- A "futures Risk Protection Fund" covers losses beyond the account balance, S2.
- No liquidation fee, settlement fee or delisting charge is published.

## 8. CCXT

CCXT 4.5.68 has no BiKing class.
`node -e "console.log(require('ccxt').exchanges)"` from `server/` returned no id matching `bik`, probe `ccxt` line of [`rest-probe.mjs`](../../../scripts/probes/venues/biking/rest-probe.mjs).
The current CCXT master, listed through `https://api.github.com/repos/ccxt/ccxt/contents/ts/src` on 2026-09-24, has 111 entries and none matches `bik`.
So there is no `market.taker` to report.

## 9. Recommended registry values

None.
The venue cannot be registered, because it has no CCXT class, no documented public API, and its website data endpoints return encrypted bodies, see [`rest.md`](./rest.md) section 2.
If it ever could be, `takerPpm` would be 400 from S1, and `ccxtTakerPpm` would stay unset.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | "Biking Perpetual Futures Product Parameter Details and Fee Rate Description", `https://biking.bkexchange.news/hc/en-us/articles/12123036811793`, read through `https://biking.zendesk.com/api/v2/help_center/en-us/articles/12123036811793.json`, updated 2026-06-22 | 2026-09-24 |
| S2 | "Perpetual Futures Product Details", article 11063882487825 on the same help center, updated 2025-11-17 | 2026-09-24 |
| S3 | "Service Agreement", article 11064572291473, updated 2026-07-15 | 2026-09-24 |
| S4 | "Announcement on the Cancellation of Option Service Fees", article 35327243671313, updated 2025-06-27 | 2026-09-24 |
| S5 | "BiKing Spot Trading Parameter Details", article 16351349621521, updated 2026-03-26 | 2026-09-24 |
| S6 | CoinMarketCap exchange page, `https://coinmarketcap.com/exchanges/biking/` | 2026-09-24 |
| S7 | Website bundles `https://biking-index.oss-accelerate.aliyuncs.com/biking-index/staticResource/js/app.68bf3e30797cdb1a03b1.js` and `.../biking-index/swaps/assets/js/app.2d502930.js`, and the config `https://biking-pod.oss-accelerate.aliyuncs.com/biking/domain.json` | 2026-09-24 |
| S8 | CoinMarketCap derivatives ranking, `https://coinmarketcap.com/rankings/exchanges/derivatives/` | 2026-09-24 |
| S9 | Help center search, `https://biking.zendesk.com/api/v2/help_center/articles/search.json?query=<q>&locale=en-us` | 2026-09-24 |
| S10 | "Funding Rate (Perpetual Futures)", article 11063905319185, updated 2025-11-17 | 2026-09-24 |
| P1 | [`rest-probe.mjs`](../../../scripts/probes/venues/biking/rest-probe.mjs), run 2026-09-24 | 2026-09-24 |
