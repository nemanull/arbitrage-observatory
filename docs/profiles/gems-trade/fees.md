# Gems Trade Fee Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard tunnel that geolocates to Canada.

The host clock read 2026-10-10 UTC during the probes, which is the evening of 2026-10-09 in Seattle.
This profile covers Gems Trade, CoinMarketCap exchange id 12467 and rank 189, at `www.gems.trade`, which has no CCXT class.
Gems Trade lists no perpetuals, so the researched product is its spot market, per design decision 3 and change 1 of the survey plan's template.
Probe numbers come from [`fees-probe.py`](../../../scripts/probes/venues/gems-trade/fees-probe.py) and [`rest-probe.py`](../../../scripts/probes/venues/gems-trade/rest-probe.py).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-10-09 for every source row | | source ledger |
| operator | Gems Exchange Ltd, incorporated in the Island of Anjouan, Union of Comoros, registration number 16226, serving customers outside the European Economic Area | Published | P1 section 5, S3 |
| operations | CoinMarketCap's description says the main operations are "registered in Poland", and the terms name no Polish entity | Published | P1 section 4, S1 |
| platform | the Openware OpenDAX stack: Barong, Peatio and Ranger paths under `/api/v2/`, with a `binance_engine` flag on 73 of 80 markets | Probed | P2 sections 2 and 3, [`rest.md`](./rest.md) section 2 |
| launch | CoinMarketCap gives 2025-04-12 | Published | S1 |
| who may trade spot | an account at level 2 or higher, from `/public/member-levels`, which reads as identity verification. The terms bar persons whose home law forbids foreign virtual asset providers. CoinMarketCap names Syria, Lebanon, Iran, North Korea, Myanmar, Afghanistan, South Sudan, Yemen and sanctioned regions as restricted. Canada and the United States are not named. | Published and Probed | P1 sections 2, 4 and 5 |
| website and API from this host | HTTP 200 with a full browser user agent, and a CloudFront 403 "Request blocked" page for a bare `Mozilla/5.0`, a Python user agent or the `websockets` library's default | Probed | [`rest.md`](./rest.md) section 1, [`websocket.md`](./websocket.md) section 1 |

The 403 is a header rule in CloudFront's firewall, not a geoblock, because the same exit gets 200 once the request carries a full browser or `curl` user agent.
The probes send a Firefox user agent string, which is what the venue's own web page sends.

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | label | evidence |
|---|---|---|---|---|
| spot, every market | 0.40 %, 4,000 ppm | 0.60 %, 6,000 ppm | Published on the fee page and Probed in the public fee table | P1 sections 1 and 3 |

The fee page calls this level "Standard User" for 30 day volume under $100K.
The public fee table at `/api/v2/peatio/public/trading_fees` gives the same 4,000 and 6,000 ppm for both the `vip-0` and the `Standard` groups, on market `any`.
CoinMarketCap's detail gives `makerFee` 0 and `takerFee` 0, which reads as unset rather than as a zero fee, S1.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| perpetuals | absent. No route, page or stream name for them in the web app, CoinMarketCap counts 0 perpetual pairs, and the configured `/api/v2/future/public/` base answers HTTP 503 `no healthy upstream` | P1 section 4, P2 section 3 |
| dated futures | absent, CoinMarketCap counts 0 futures pairs, and the same 503 | P1 section 4, P2 section 3 |
| options | absent, no route or call in the web app | [`rest.md`](./rest.md) section 2 |
| spot | yes, 80 `enabled` markets, 78 quoted in USDT and 2 in BTC | P2 section 2 |

CoinMarketCap lists 76 Gems Trade spot pairs and marks every one `priceExcluded` and `volumeExcluded`, so it uses neither their prices nor their volumes, P1 section 4.

## 4. Spot tiers

The fee page `/tradingfees` is a page of the web app, and its table is hard-coded in the page's script chunk, P1 section 3.

| level | 30 day volume | regular maker | regular taker | premium maker | premium taker | API group |
|---|---|---|---|---|---|---|
| Standard User | under $100K | 4,000 ppm | 6,000 ppm | 3,000 ppm | 4,500 ppm | `vip-0` and `Standard` |
| VIP 1 | $100K to $2M | 3,000 ppm | 5,000 ppm | 2,250 ppm | 3,750 ppm | `vip-1` |
| VIP 2 | $2M to $20M | 2,000 ppm | 4,000 ppm | 1,500 ppm | 3,000 ppm | `vip-2` |
| VIP 3 | $20M to $100M | 1,000 ppm | 3,000 ppm | 750 ppm | 2,250 ppm | `vip-3` |
| VIP 4 | $100M to $200M | 800 ppm | 2,000 ppm | 600 ppm | 1,500 ppm | `vip-4` |
| VIP 5 | $200M to $500M | 600 ppm | 1,800 ppm | 450 ppm | 1,350 ppm | `vip-5` |
| VIP 6 | $500M and over | 0 ppm | 1,500 ppm | 0 ppm | 1,130 ppm | `vip-6` |

The regular columns match the public fee table group for group, P1 section 1.
The public table has no group for the premium columns.
It also holds a `Zero Fee` group at 0 and 0, and two groups named `Custom fixed fee - ID...` at 1,350 ppm and 2,000 ppm on both sides, which read as negotiated rates for single accounts.
The page adds that fees may change "in response to changes in the fees imposed by its liquidity providers".

## 5. Discounts that change the spot taker

| discount | effect | label | evidence |
|---|---|---|---|
| Premium User | about 25 % off both sides at every level, for example 4,500 ppm taker at Standard | Published, qualification Not publicly specified | P1 section 3 |
| zero fee campaigns and referral rewards | named in CoinMarketCap's description, with no numbers or dates | Not publicly specified | P1 section 4 |
| negotiated fixed fees | the two `Custom fixed fee` groups | Negotiated | P1 section 1 |

The fee page does not say who counts as a Premium User.
The main web bundle shows a launchpad message "You are a premium user", which suggests the GEMS launchpad's premium access, and that link is Not verified.

## 6. Funding as a cost

Not offered, because Gems Trade lists no perpetuals.

## 7. Liquidation, settlement and delisting

Not offered for spot.
The fee page lists a flat $5 withdrawal fee and a 0 % convert fee, P1 section 3, and the page `/tradingfees` is the official lookup for both.

## 8. CCXT

CCXT 4.5.68 has no class for this venue.
The installed source folder `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/` holds 104 `.js` files, the only name containing "gem" is `gemini.js`, and no file mentions "gems".
CCXT's `master` head on 2026-10-09, commit `f0aca06e`, lists 103 ids in `exchanges.json`, and the only id containing "gem" is `gemini`, S2.
Its `ts/src` folder holds 110 entries, and the only one containing "gem" is `gemini.ts`, S2.
So `market.taker` cannot be read, and `ccxtTakerPpm` has no source line.

## 9. Recommended registry values

| key | value | reason |
|---|---|---|
| `takerPpm` | 6000 | the spot VIP 0 taker, the same on the fee page and in the public fee table |
| `ccxtTakerPpm` | none | no CCXT class |

The venue lists no perpetuals, so these values are context for a future spot leg only.

## 10. Source ledger

| id | source | retrieved |
|---|---|---|
| S1 | CoinMarketCap exchange detail, `https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=gems-trade`, and the page `https://coinmarketcap.com/exchanges/gems-trade/` | 2026-10-09 |
| S2 | CCXT `master` at `https://github.com/ccxt/ccxt`, `exchanges.json` and the `ts/src` folder listing at commit `f0aca06eb7482f083bed8406fadfcc0c05e45b1c` | 2026-10-09 |
| S3 | Gems Trade terms, the page `https://www.gems.trade/term-condition`, read from its script chunk because the page renders in the browser | 2026-10-09 |
| S4 | Gems Trade fee page, `https://www.gems.trade/tradingfees`, read from its script chunk | 2026-10-09 |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/gems-trade/fees-probe.py), run three times, the last after section 5 gained its Poland count | 2026-10-09 |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/gems-trade/rest-probe.py), run twice | 2026-10-09 |
