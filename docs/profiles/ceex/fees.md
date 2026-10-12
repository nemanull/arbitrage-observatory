# CEEX Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers the USDT-margined perpetuals on CEEX exchange, CoinMarketCap rank 221, at `www.ceex.com`.
CEEX runs on the BlueHelix broker platform (`orgId` 6066, image paths under `/bhop/`), and its site carries two contract systems side by side.
The live one is a newer engine whose REST paths sit under `/api/v3/triggerContract/` and whose socket channels start with `TRIGGER_CONTRACT_`.
The older BlueHelix swaps (`BTC-SWAP-USDT` and eight more) are still listed but have not traded for months, see [`rest.md`](./rest.md) section 2.
CEEX publishes no API documentation and has no CCXT class, see section 8.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/ceex/fees-probe.py), cited as F with a section number, and from the REST and socket probes named in [`rest.md`](./rest.md) and [`websocket.md`](./websocket.md).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| legal entity | Not publicly specified in anything read. CoinMarketCap says CEEX launched in 2019 and is headquartered in Singapore. | Not publicly specified | S5 |
| restricted locations | Not publicly specified. The user agreement and the help center were not readable, see the next rows. | Not publicly specified | S3, S4 |
| help center | `ceexglobal.zendesk.com` answered the fee article and the `en-001` root with a 301 to Zendesk's "Help Center Closed" page in two runs, and with a Cloudflare 403 challenge, "Just a moment...", in a first `curl` and in the third run | Probed | F3 |
| fee article CoinMarketCap links | `CEEX-Fees-Overview`, article 33783887284761, is closed with the help center. The Wayback Machine lists a capture from 2026-03-04, and every fetch of it from this exit answered 429 "Too Many Requests". | Probed | F3, S3 |
| who may trade the perpetuals | An account holder. Nothing read names the regions that may not. | Not publicly specified | |
| website from this host | `www.ceex.com` and `ceex.com` answered HTTP 200 with no challenge | Probed | [`rest.md`](./rest.md) section 1 |
| public API from this host | Every public call and the socket answered from this Canadian exit | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

## 2. Quick answer

| family | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| USDT-margined perpetuals, `/api/v3/triggerContract/` engine | 0.02 % = 200 ppm | 0.05 % = 500 ppm | Published | S1, the announcement of 2026-06-09, F1b |
| legacy BlueHelix swaps (`*-SWAP-USDT`) | Not publicly specified | Not publicly specified | Not publicly specified | no source names a rate, and the books are dead, see [`rest.md`](./rest.md) section 2 |

S1 reads, in full: "Effective immediately, the futures trading fee discount campaign has ended. Futures trading fees will return to the standard rates: Taker: 0.05% Maker: 0.02% Users who invite others to participate in futures trading will be eligible to receive higher trading fee commissions."
It was published 2026-06-09 16:00 UTC and names no tiers.
The engine models a taker cross at the base retail tier, so 500 ppm is the number that matters.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-margined perpetuals, new engine | yes, 11 contracts, all `enabledState` 1 and `tradingState` 1 | [`rest.md`](./rest.md) section 2 |
| USDT-margined perpetuals, legacy BlueHelix | listed, 9 contracts with `status` TRADING, but no trade since 2026-06-03 on ETH and 2026-03-19 on BTC | [`rest.md`](./rest.md) section 2 |
| coin-margined or USDC-margined perpetuals | no, every contract settles in USDT | [`rest.md`](./rest.md) section 2 |
| dated futures | no, none in either catalog | [`rest.md`](./rest.md) section 2 |
| options | no, `optionSymbol` is empty in the site config | [`rest-probe.py`](../../../scripts/probes/venues/ceex/rest-probe.py) section 3 |
| margin | no, `functions.margin` is false and `marginSymbol` is empty | [`rest-probe.py`](../../../scripts/probes/venues/ceex/rest-probe.py) section 3 |
| spot | yes, 170 symbols with `status` TRADING in `/openapi/v1/brokerInfo` | [`rest.md`](./rest.md) section 2 |
| copy trading | yes, under `/api/v3/copy/`, account calls only | the site bundle |
| deposit, withdrawal and earn schedules | not covered, the account pages behind login are the official lookup | |

## 4. Perpetual tiers

No tier table is published.
`GET /api/user/get_userlevel_configs` is public and returns one level, `Lv.0`, with every spot, option and contract maker and taker discount set to `1`, which means no discount, F1.
S1 names one standard rate and no tiers.
The account fee rate the trade page reads (`takerBuyRate`, `takerSellRate`) comes from `/api/v3/triggerContract/pageCalculate/getContractAccountInfo`, which answers 400 `{"code":30002,"msg":"Bad request"}` without a session, F2.

## 5. Discounts that change the perpetual taker

| discount | value | label | evidence |
|---|---|---|---|
| user levels | one level, `Lv.0`, discount `1` on every contract side | Probed | F1 |
| token holding | holding 0.001 ETH gives a discount of `0.4`, with `spotSwitch` true and `contractSwitch` false, so it does not apply to perpetuals | Probed | F1 |
| launch promotion | "New Perpetual Contracts Launched with Fee Promotion as Low as 0.001%", 2026-03-10. The details sit on a Lark wiki page that redirects to a login. | Published title only | S2, F1b |
| end of the promotion | ended 2026-06-09, see section 2 | Published | S1 |
| referral | "higher trading fee commissions" for users who invite others, no rate given | Published | S1 |

## 6. Funding as a cost

The socket ticker publishes `fundingRate` and `nextFundingTime` per contract, see [`websocket.md`](./websocket.md) section 2.
In all three socket runs every contract showed exactly `0.00010` or `-0.00010`, which is ±0.01 %, and `nextFundingTime` 2026-10-10 08:00:00 UTC.
The rate never changed within a run, but its sign flipped between runs on XRPUSDT, AVAXUSDT and DOGEUSDT, see [`websocket.md`](./websocket.md) section 2.
No document gives the formula, the interval, the cap or the floor.
The catalog's `fundingFeeRate` is an empty string and `fundingInterval` is 0 on every contract, see [`rest.md`](./rest.md) section 3.
The settlement instant itself was not captured, because the survey does not wait for clock events.

## 7. Liquidation, settlement and delisting charges

Not publicly specified.
The catalog carries ten maintenance margin tiers per contract (nine on SUIUSDT), with tier 1 at 0.4 % for BTC, ETH and XRP, 0.5 % for SOL and 0.66 % to 0.67 % for the rest, see [`rest.md`](./rest.md) section 2.
No liquidation fee or insurance fund rule was readable.

## 8. CCXT

CCXT 4.5.68 has no CEEX class.
No file under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` matches `ceex`, F4.
The current CCXT master has none either: `ts/src/ceex.ts` and `js/src/ceex.js` both answer 404 on `raw.githubusercontent.com`, and `exchanges.json` lists no id containing `ceex`, F4.
So there is no `market.taker` to read.

## 9. Recommended registry values

| value | recommendation | reason |
|---|---|---|
| `takerPpm` | 500 | the standard futures taker in S1, the only published rate, unchanged since 2026-06-09 |
| `ccxtTakerPpm` | none | no CCXT class exists, and the Rust adapters do not load markets through CCXT |

## 10. Source ledger

| id | source | retrieved | what it gave |
|---|---|---|---|
| S1 | `https://www.ceex.com/api/ceex/basic/announcement?id=1680`, "Announcement on the End of the Futures Trading Fee Discount Campaign", published 2026-06-09 | 2026-10-09 | futures maker 0.02 % and taker 0.05 % |
| S2 | `https://www.ceex.com/api/ceex/basic/announcement?id=1635`, "New Perpetual Contracts Launched with Fee Promotion as Low as 0.001%", published 2026-03-10 | 2026-10-09 | the promotion title, and a Lark wiki link that answers 302 to a login |
| S3 | `https://ceexglobal.zendesk.com/hc/en-001/articles/33783887284761-CEEX-Fees-Overview` | 2026-10-09 | 301 to "Help Center Closed" or a Cloudflare 403 challenge, and a Wayback capture of 2026-03-04 that answered 429 from this exit |
| S4 | `https://www.ceex.com/api/user/get_userlevel_configs` | 2026-10-09 | one user level with no discount, and an ETH holding discount for spot only |
| S5 | `https://coinmarketcap.com/exchanges/ceex-exchange/` | 2026-10-09 | the website, the launch year 2019, Singapore, and the link to S3 |
| S6 | `https://www.ceex.com/s_api/basic/announcements?type=0&page=1` | 2026-10-09 | the 16 newest announcements, including S1, S2 and the contract system upgrade of 2026-03-02 |
