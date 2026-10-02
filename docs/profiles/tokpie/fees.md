# Tokpie Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Seattle time (04:34 to 04:53 UTC on 2026-09-23, first runs and the second pass), from the development host near Seattle through its Surfshark WireGuard exit, which geolocates to Canada (Cloudflare trace `loc=CA`, edge `SEA` or `YVR`).

This profile covers Tokpie, a centralized spot exchange at `tokpie.com` with its marketing and documentation site at `tokpie.io`.
Tokpie lists no perpetuals, so under template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) it is profiled on its spot market.
Every number below carries a source id from section 10 or a probe id from the same ledger.

## 1. Scope and freshness

The documentation site sits behind a Cloudflare challenge that depends on the client.
`https://tokpie.io/`, `/api`, `/fees` and `/terms` answered HTTP 403 with `cf-mitigated: challenge` to `curl` with its default user agent, and WebFetch got the same 403.
The same four URLs answered 200 to the probe, which sends the user agent `observatory-probe`, at 04:46 and 04:53 UTC, P1.
The live pages were then read with that user agent and compared with their newest Internet Archive captures.
The API text was identical to the capture of 2026-07-28, the five plan fees and TKP holds matched the fees capture of 2026-07-28, and the terms text was identical to the capture of 2026-05-06.

| item | value | source |
|---|---|---|
| operator | Graceful Globe S.A., Mossfon Building, East 54th Street, Panama City, Panama | S3 first paragraph, and the footer of S1 and S2 |
| governing law | the laws of the Republic of Panama, courts of Panama City | S3 |
| country on CoinGecko | Hong Kong, established 2018 | S4 |
| regions excluded | Not publicly specified. The terms of use name no excluded country and no sanctions list | S3 |
| US persons | Not publicly specified. Neither the terms of use nor the sign up page at `https://tokpie.com/regis/` mentions the United States, residency or citizenship, so nothing published bars them | S3, P1 |
| sign up | an email account with a checkbox for the terms of use and privacy policy, both linked to `tokpie.io`, and no word about countries, residency or citizenship on the page | P1 |
| privacy policy | names Panama, Georgia, Estonia, Russia, the United States and the United Kingdom as where personal data may be held, and no eligibility rule | S6 |
| public API from this host | every documented public REST route answered 200 from the Canadian exit, see [`rest.md`](./rest.md) | P1 |
| public WebSocket from this host | the documented `ws://tokpie.com:8222` answered HTTP 500 `Internal Server Error` to every upgrade, see [`websocket.md`](./websocket.md) | P5 |

The terms of use also say the site's information "should not be considered as an offer or solicitation to buy or sell financial instruments, provide financial advice, create a trading platform, facilitate or take deposits, or provide any other financial services of any kind in any jurisdiction", S3.
No licence or registration number is named in S1 to S3.

## 2. Quick answer

| product | maker | taker | source |
|---|---|---|---|
| spot, TRIAL plan (the base plan, no TKP held) | 0.10 %, 1,000 ppm | 0.10 %, 1,000 ppm | S2 |

The fee page publishes one "Trade fee" per plan and no maker and taker split, S2.
Its FAQ says "The amount of trade fees is calculated due to the formula: The amount of crypto-asset that is going to be received in the result of trade order execution X trade fee % (percent).", S2.
So a resting and a crossing order pay the same 1,000 ppm on the base plan, charged in the asset received.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetual swaps | absent | no pair in the 379 row catalog has a perpetual, swap or futures spelling, P1. The API page documents spot endpoints only, S1. CoinGecko's derivatives endpoint answers 404 `{"error":"market not found"}` for `tokpie`, S4 |
| dated futures | absent | same evidence |
| options | absent | same evidence |
| spot | present | 379 pairs, 194 frozen, 185 not frozen, 183 with a two sided book, P1 |
| other | named, not researched | the fee page ties each plan to a "Bounty collateral rate" and an "LTV (loan-to-value) Ratio" for bounty stakes and peer to peer lending, S2 |

Spot pairs by quote asset on 2026-09-23 UTC: USDT 150, TKP 113, ETH 88, USDC 11, BNB 5, YOUC 5, WBTC 4, SOL 1, TRX 1, XRP 1, P1.

## 4. Spot tiers

Tiers are plans bought by holding TKP, Tokpie's own token, and not by trading volume, S2.

| plan | trade fee | ppm | TKP in hold required |
|---|---|---:|---:|
| TRIAL | 0.10 % | 1,000 | 0 |
| LIGHT | 0.08 % | 800 | 20,000 |
| STANDARD | 0.06 % | 600 | 25,000 |
| PREMIUM | 0.04 % | 400 | 35,000 |
| ENTERPRISE | 0.02 % | 200 | 50,000 |

The page heads the table with "Choose a Plan to get up to 500% trade fee discount", which matches 0.10 % over 0.02 %, S2.
A plan is applied from the account, and TKP released by a downgrade "will come back on your account balance in 30 days after downgrade application submission", S2.
TKP appears only as a quote asset in the catalog, and no pair has TKP as its base, P1, so the cost of a plan in dollars is Not verified.

## 5. Discounts that change the spot taker

| discount | effect | source |
|---|---|---|
| TKP plan | section 4, down to 200 ppm at 50,000 TKP held | S2 |
| referral | each plan names a "Referral Bonus" of 20 % (TRIAL) up to 70 % (ENTERPRISE). The page does not say it lowers the referred user's own fee | S2 |
| market maker programme | Not publicly specified | S1, S2 |
| zero fee promotion | none named on the fee page | S2 |

## 6. Funding as a cost

Not applicable.
Tokpie lists no perpetual, so it publishes no funding rate, interval or settlement, see section 3.

## 7. Liquidation, settlement and delisting

No liquidation or settlement fee applies to spot.
A delisting charge is Not publicly specified.
A frozen market carries `isFrozen: 1` in the ticker, and 194 of 379 pairs were frozen on 2026-09-23 UTC, P1.
Deposit and withdrawal fees are listed per asset on the fee page, S2, and are not recorded here.

## 8. CCXT

Tokpie has no CCXT class.

| check | result | source |
|---|---|---|
| CCXT 4.5.68 `ccxt.exchanges` from `server/` | 104 ids, none matches `tok` or `pie` except `latoken` and `tokocrypto`, which are other venues | P1 |
| `server/node_modules/ccxt/js/src/` | no `tokpie.js`, by `ls` on 2026-09-22 | this host |
| CCXT master `ts/src` on GitHub | 112 entries, no Tokpie file, at commit `fbc5f21` of 2026-09-22 10:33 UTC | S5 |
| CCXT master `ts/src/pro` | 78 entries, no Tokpie file | S5 |
| GitHub issue search `tokpie repo:ccxt/ccxt` | 0 results | S5 |

So `market.taker` has no value to report, and `ccxtTakerPpm` is null.

## 9. Recommended registry values

None.
Tokpie cannot join the engine, which reads active swaps from CCXT at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196, and Tokpie has neither swaps nor a CCXT class.
For the record, the spot taker a spot leg would pay on the base plan is 1,000 ppm, S2.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tokpie API, "Last updated on February 10, 2021". Same text as the Internet Archive capture of 2026-07-28 16:26 UTC | https://tokpie.io/api | 2026-09-22 | Graceful Globe S.A., Panama | spot only endpoints, sections 1 and 3 |
| S2 | Tokpie Fees. Plan fees and TKP holds match the Internet Archive capture of 2026-07-28 14:05 UTC | https://tokpie.io/fees | 2026-09-22 | Graceful Globe S.A., Panama | plans, trade fee formula, TKP hold, referral, sections 2 to 5 and 7 |
| S3 | Tokpie Terms of Use. Same text as the Internet Archive capture of 2026-05-06 13:32 UTC | https://tokpie.io/terms | 2026-09-22 | Graceful Globe S.A., Panama | operator, governing law, no excluded regions, section 1 |
| S4 | CoinGecko API, `exchanges/tokpie` and `derivatives/exchanges/tokpie` | https://api.coingecko.com/api/v3/exchanges/tokpie | 2026-09-22 | CoinGecko | country Hong Kong, trust score 5, trust rank 111 in the reply against 108 on the survey's list, 95 coins, 106 pairs, 188.5 BTC in 24 h, derivatives 404, sections 1 and 3 |
| S5 | CCXT master tree and issues through the GitHub API | https://github.com/ccxt/ccxt/tree/master/ts/src | 2026-09-22 | CCXT | no Tokpie class, section 8 |
| S6 | Tokpie Privacy Policy | https://tokpie.io/privacy | 2026-09-22 | Graceful Globe S.A., Panama | data locations, section 1 |
| P1 | `rest-probe.mjs catalog`, runs at 04:34, 04:45 and 04:52 UTC, the documentation site and sign up checks in the second and third | [`rest-probe.mjs`](../../../scripts/probes/venues/tokpie/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | catalog counts, CCXT list, access, sections 1, 3, 4, 7 and 8 |
| P5 | `ws-probe.mjs`, runs at 04:39 and 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tokpie/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the WebSocket refusal, section 1 |
