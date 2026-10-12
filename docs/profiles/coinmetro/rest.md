# Coinmetro REST Profile

**Status:** Done.
Coinmetro lists no perpetuals and trading has been disabled since 2026-06-22, so this profile records the spot REST surface, which answers with frozen data.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:12 to 03:28 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public REST API of Coinmetro at `https://api.coinmetro.com`, documented in a Postman collection, S4, and a GitHub README, S5.
Every public call answered 200 from this host.
The newest price in `/exchange/prices` is from 2026-07-01 10:18 UTC, the last BTCEUR trade is from 2026-06-22 16:02:15 UTC, and nothing changed over 30 one second polls, P2.
Source ids S1 to S11 and P1 to P2 are those of [`fees.md`](./fees.md), and P3 is that of [`websocket.md`](./websocket.md).

## 1. Host and latency from this machine

| item | value | source |
|---|---|---|
| host | `api.coinmetro.com`, behind Cloudflare, `cf-ray` suffix `YVR` | P2 |
| resolved | 104.20.34.77, 172.66.163.208 and two IPv6 addresses | P2 |
| first request | `/exchange/prices`, 570 ms in the first run and 175 ms in the second, 45,892 bytes | P2 |
| later requests | 173 to 200 ms, each on a new connection | P2 |
| access | 200 on every public market data call, no region message | P2 |
| site | `https://coinmetro.com/` answered 200 with the "trading paused" banner | P1, P2 |
| help center | `https://help.coinmetro.com/en/` answered 403 from Cloudflare with "error code: 1014" | P1, P2 |

Cloudflare error 1014 is a cross account CNAME refusal, so the help center looks broken rather than geoblocked.

## 2. Catalog

| call | reply | source |
|---|---|---|
| `GET /markets` | 130 pairs, each `{pair, precision, margin}`, 73 with `margin` true | P2 |
| `GET /assets` | 113 assets, 112 with `canDeposit`, `canWithdraw` and `canTrade` all false, and one with all three true | P2 |
| `GET /exchange/prices` | `latestPrices` and `24hInfo`, 130 rows each, the same pairs as `/markets` | P2 |

| quote | pairs |
|---|---|
| USDT | 85 |
| EUR | 21 |
| USD | 16 |
| GBP | 3 |
| USDC | 3 |
| AUD | 1 |
| BTC | 1 |

The counts are by the `quote` field of `/exchange/prices`, P2.
The second newest blog post says that from 25 June all USDT pairs would move to USDG, P1, and the frozen catalog still names USDT.
`/assets` carries messages such as "We're currently experiencing a technical problem with BTC trades. Please try again later", P2.
There are no perpetuals, so there is no contract size, no linear flag and no pair listed twice.
CCXT has no class to map the catalog, see [`fees.md`](./fees.md) section 8.

### Frozen state

| measure | value | source |
|---|---|---|
| newest `latestPrices` timestamp | 2026-07-01 10:18:00 UTC, about 100.7 days before the probe | P2 |
| oldest `latestPrices` timestamp | 2026-01-05 12:11:15 UTC | P2 |
| `qty` on 111 of 130 rows | `1e-12`, which looks like a synthetic price rather than a trade | P2 |
| last BTCEUR trade | 2026-06-22 16:02:15 UTC, price 56616.12 EUR, from `/exchange/ticks/BTCEUR/{from}`, and no tick after it | P2 |
| BTCEUR REST book | best bid 52000.00, best ask 59774.97, 44 bid and 54 ask levels | P2 |
| changes over 30 polls of `/exchange/prices`, one second apart | 0 | P2 |
| `24hInfo` | nonzero `v` on all 130 pairs, 100 days after trading stopped | P2 |

CoinMarketCap still shows the venue as active, with XCM/EUR at about 983 USD of 24 hour volume, S9.
That matches the frozen `24hInfo` row of XCMEUR, 43,854.09 XCM at 0.02001 EUR, about 877.52 EUR, P2.
So CoinMarketCap's volume for Coinmetro is a repeat of the last 24 hours before the halt.

## 3. Anchor

Coinmetro publishes no index, mark or funding, because it has no perpetuals, S4 and S5.
The nearest reference is `/exchange/prices`, whose `price`, `bid` and `ask` per pair are frozen, P2.
No anchor poller is recommended.

## 4. Anchor semantics

Not offered.
`/exchange/candles/BTCEUR/60000/1782000000000/1782030000000` returned 501 one minute candles for 2026-06-21 00:00 to 08:20 UTC with a single close value and zero volume, P2.
`/exchange/ticks` holds BTCEUR trades inside that window, from 00:36 UTC on, so the candle call does not reflect trades, P2.
A range over 1,000 candles returns 422 "No more than 1000 candles per call", P2.

## 5. REST book snapshot

| item | value | source |
|---|---|---|
| call | `GET /exchange/book/{pair}`, the full book with no depth parameter | S4, P2 |
| reply | `{book: {pair, base, quote, ask, bid, seqNumber, checksum}}`, prices as keys with fixed decimals, base quantities as numbers | P2 |
| checksum | the documented CRC32 rule reproduced the reply's `checksum`, 1112741473 for BTCEUR | S5, P2 |
| level order | object keys, asks rising and bids falling as returned | P2 |
| caching | `cache-control: no-cache,no-store,must-revalidate` | P2 |
| updates | `GET /exchange/bookUpdates/{pair}/{from}`, with `from` 0 documented as "the maximum range (100 updates)", returned 199 updates for BTCEUR | S4, P2 |
| sequence | the book's `seqNumber` was 312 above the last BTCEUR update, and ETHEUR update numbers interleave with BTCEUR ones, so the counter is shared across pairs | P2 |
| reply size and time | 1,941 bytes in about 160 ms for BTCEUR | P2 |

## 6. Rate limits and error shapes

| item | value | source |
|---|---|---|
| IP limit | 500 calls per 10 s, at Cloudflare | S5 |
| user limits | 100 calls per minute on `/book`, `/candles` and `/ticks`, and tighter ones on order and account calls | S5 |
| limit status | 429 with `{"message":"Too many attempts. Try again in 3 seconds"}`, as quoted in the last CCXT class | S7 line 320 |
| unknown pair | 404 `{"message":"Invalid Pair"}` | P2 |
| unknown path | 404 `{"statusCode":404,"message":"Cannot GET /exchange/nope","error":"Not Found"}` | P2 |
| oversized candle range | 422 `{"message":"No more than 1000 candles per call"}` | P2 |
| `Retry-After` | absent on every error seen | P2 |

The probe stayed far inside the limits, so no 429 was provoked.

## 7. Server time

No server time call exists, `/time` and `/exchange/time` return 404, P2.
The HTTP `Date` header was within about 0.8 s of the local clock on three reads, at one second resolution, P2.

## 8. Recommended poller shape

None.
There are no perpetuals and so no anchor, and the spot market is frozen while trading is disabled, S3.
The venue should be revisited only if Coinmetro announces that trading has resumed.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S3 | Announcement: Onboarding, trading, depositing and withdrawals paused | https://coinmetro.com/blog/announcement-onboarding-depositing-and-withdrawals | 2026-10-09 | Coinmetro OÜ | trading disabled, related USDG post |
| S4 | COINMETRO API (PUBLIC), Postman collection | https://documenter.getpostman.com/view/3653795/SVfWN6KS | 2026-10-09 | Coinmetro | endpoint list and book update range |
| S5 | CoinMetro API-DOCS README | https://github.com/CoinMetro/API-DOCS/blob/5edcc5caaaa4784d0ce5051072e8b1407ec087ef/README.md | 2026-10-09 | Coinmetro | rate limits, checksum rule |
| S7 | CCXT `ts/src/coinmetro.ts` before the delist | https://github.com/ccxt/ccxt/blob/aebca96c2a39599a2ccfc2a4dfe0b1a451c8e2a6/ts/src/coinmetro.ts | 2026-10-09 | CCXT | the 429 message |
| S9 | CoinMarketCap exchange detail and market pairs | https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinmetro&category=spot&start=1&limit=3 | 2026-10-09 | CoinMarketCap | listed volume |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/coinmetro/fees-probe.py) | `uv run scripts/probes/venues/coinmetro/fees-probe.py` | 2026-10-09 | this host, Canadian exit | site banner, help center refusal |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/coinmetro/rest-probe.py) | `uv run scripts/probes/venues/coinmetro/rest-probe.py` | 2026-10-09 | this host, Canadian exit | every probed number in this file |
| P3 | [`ws-probe.py`](../../../scripts/probes/venues/coinmetro/ws-probe.py) | `uv run scripts/probes/venues/coinmetro/ws-probe.py` | 2026-10-09 | this host, Canadian exit | the silent socket |
