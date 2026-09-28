# Venue survey

One row per venue researched under [`../plans/2026-09-22-venue-survey-design.md`](../plans/2026-09-22-venue-survey-design.md), in the order of the waves in [`../plans/2026-09-22-venue-survey-plan.md`](../plans/2026-09-22-venue-survey-plan.md).
Each row is the researcher's summary, and the venue's profile folder holds the evidence.
Rows are added as waves finish, so a venue missing here has not been researched yet.

**Status:** In progress.

**Started:** 2026-09-22.

## Answer

151 of the 151 venues of the CoinGecko list are recorded.
2 fit the engine as it stands: HashKey Global, KuCoin.
39 fit with a named change: Aivora Exchange, Backpack Exchange, Biconomy.com, BigONE, BingX, Bitfinex, BitMart, Bitunix, BTSE, BYDFi, Changelly PRO, CoinW, Crypto.com Exchange, Deepcoin, Delta Exchange, Deribit Spot, DigiFinex, FameEX, FMFW.io, Globe, Hibt, HitBTC, Hotcoin, HTX, Niza.io, Nonkyc.io, OrangeX, Ourbit, Phemex, Pionex, Poloniex, Toobit, Tothemoon, VALR, WEEX, WhiteBIT, WOO X, XT.COM, Zoomex.
72 list no perpetual and are spot only.
24 list perpetuals but are blocked: Azbit, BitBNS, bitcastle, BitDelta, bitFlyer, Bitrue, Bittime, BloFin, Bullish, BVOX, CoinDCX, CoinUp.io, GMO Coin Japan, Icrypex, KoinBX, LBank, Mudrex, One Trading, PointPay, Tapbit, WazirX, Websea, XBO.com, ZebPay.
12 have no usable public API: Bitbaby, BitKan, BTCC, Coinstore, Dinari, Giottus, IMBX, INEX, INX One, KCEX, LeveX, Ondo Stocks.
2 are defunct: CoinEx, EXMO.
CoinEx futures ceased on 2026-09-22, and EXMO has been winding down since 2026-07-14.

The named changes repeat across venues, so a few pieces of engine work unlock most of them.

- A catalog loader outside CCXT for the fitting venues with no CCXT 4.5.68 class, which is 18 of 41.
  Five venues speak another venue's API, so an existing CCXT class pointed at their host loads them: Ourbit and BYDFi with `mexc`, Zoomex with `bybit`, Changelly PRO with `hitbtc` and Niza with `woofipro`.
- A registry `takerPpm` wherever CCXT reports no taker or a wrong one.
  CCXT reports none on Toobit, Phemex's linear perps, Backpack, Poloniex and BigONE, its BYDFi class fails since BYDFi's migration, and it reports a stale or wrong one on Crypto.com, Bitfinex, BitMart, DigiFinex, WOO X, Delta, Deepcoin and HTX.
  Indodax's class reads a percent as a fraction, so its takers are 100 times too large, and BTCBOX's never matches its BTC market.
- A registry `contractSize: 1` where CCXT's contract size is not the unit the book speaks, on WhiteBIT, WEEX and Deribit.
- An anchor fed by the socket where no REST call returns index, mark and funding in bulk, on Crypto.com and CoinW.
- A book seeded from REST where the depth channel sends no snapshot, on Backpack, WOO X and BigONE.
- Frame decompression on HTX (gzip), DigiFinex (zlib) and FameEX (gzip).

Several venues are not independent markets, and a cross between one of them and its source is the same book seen twice.

- Zoomex relays Bybit's book on 693 of 697 perps, and PointPay, Azbit and bitcastle copy Bybit too.
- BitKan, CoinDCX, ZebPay, WazirX and KoinBX broker or relay Binance USD-M perps.
- CoinW's funding rate equalled Binance's on 164 of 165 shared contracts.
- Niza.fun and NonKYC's perpetuals are front ends on Orderly's shared book.
- Digitalexchange.id republishes Binance spot ladders at a fixed 17,800 IDR per USDT.

Every access result was recorded from a Surfshark exit that geolocates to Canada, as the section "Table" explains, so a refusal such as BloFin's may depend on that exit.
Hyperliquid, the first decentralised venue, was researched under its own plan and fits with a named change, see its row.
13 CoinMarketCap additions are recorded so far, all chosen from its derivatives ranking: 6 fits with a named change, 3 blocked, 4 no public API.

## Verdicts

The verdict answers one question: can this venue join the engine as a perpetual leg in its current shape, a CCXT catalog, a WebSocket book feed and a REST anchor poller.

- **fits as is** means every part the engine needs exists and was probed.
- **fits with a named change** means one or more parts need a change the notes name.
- **spot only** means the venue lists no perpetuals, so it has no leg to offer the engine as it stands.
- **blocked** means the venue lists perpetuals but something the notes name stops it, such as no public book or no anchor.
- **no public API** means the venue publishes no usable public market data interface.
- **defunct** means the venue no longer operates.

## Table

Taker is the VIP 0 taker in ppm on the researched product.
Access is what the public endpoints returned to the host near Seattle.

The development laptop sends all of its internet traffic through a Surfshark WireGuard tunnel, `surfshark_wg`, selected by a policy routing rule rather than by the main route table.
On 2026-09-23 the tunnel's exit address geolocated to Canada, and Cloudflare's trace endpoint answered `loc=CA` through its Seattle edge.
So every access result in this table is what a Canadian VPN exit received, not what the laptop's own connection would receive.
A venue that refuses Canada, such as BloFin, may answer a different location differently, and a venue that answered here may refuse a US address.
The Backpack researcher found the tunnel in wave 13, and the waves before it recorded the same exit without naming it.

| wave | venue | CCXT 4.5.68 | product | perpetuals | taker ppm | book channel | anchor | access | verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Crypto.com Exchange, [`../profiles/cryptocom/`](../profiles/cryptocom/) | cryptocom | perpetuals | USD-settled linear 396 (241 crypto, 118 equity, 27 equity index/ETF, 8 commodity, 2 pre-IPO). No USDT-M, no USDC-M, no coin-M. Also listed: 12 dated BTC/ETH futures, 571 spot, 0 options. CoinGecko shows 401 perps and 13 futures. | 400 | book.{id}.50 on wss://stream.crypto.com/exchange/v1/market with book_subscription_type SNAPSHOT_AND_UPDATE and book_update_frequency 10. Depth 10 also works. Depth 150 with deltas is refused. Snapshot on subscribe arrives 1.0 to 1.14 s after the ack. After that come deltas of [price,size,count] strings every 10 ms. Sequence rule: each delta's pu must equal the previous u. The first delta's pu equals the snapshot's u. 0 gaps in about 91k deltas over two runs, and u is not a step-by-one counter. Checksum: a cs int32 is sent, but the algorithm is unpublished and 576 CRC32 layouts did not match it, so the feed ignores it. Compression: deflate is not negotiated. Quiet books send an empty delta with u == pu every 5 s. Cap of 400 channels per connection (40107 past that). The app heartbeat every 30 s must be answered, or the server closes the socket at the third heartbeat. Protocol pings come every 5 s. | No bulk anchor call. get-tickers has no index, mark or funding. public/get-valuations takes one instrument and one type per call: mark_price, index_price (perp or -INDEX symbol) and funding_rate. With count=1 it returns the live 1 s point, about 1.0 s old. One mark-only round over 396 perps took 10.1 s at 40 req/s. Mark plus index for every perp needs at least 7.9 s per round at the 100/s per-method limit. The socket covers it: mark.X and index.{X}-INDEX push once a second, funding.X once a minute. That is 1,188 channels, so 3 connections. Funding interval is 1 h for every perp and is not a field, so the next funding time is derived as the next whole hour. The published funding_rate is fixed per 4-hour interval, charged at its 4 hourly settlements and known ahead. No funding cap is published. The mark is clamped to index ± a bandwidth of at least 0.5% (a capped premium). The index basket PDF is public. ANTHROPICIPO is indexed 100% to the okx and Gate perps, OPENAIIPO 66.66% to perps, and 151 TradFi baskets use other venues' indices or oracles. | Exchange derivatives (terms by Foris DAX Limited, 2025-12-22) are barred in 93 locations: the US and its territories, Canada, the UK, all 27 EU states and others. US persons may not trade them. The venue's own feature call placed this host in Canada (countryCode CAN) and returned Derivative:false. The fee page drew only its spot table. Public REST (Cloudflare edges SEA and YVR) returned 200 or documented 400 JSON on every call, and the market WS served every channel. No refusal and no geoblock on market data. | fits with a named change |
| 1 | OSL Exchange, [`../profiles/osl/`](../profiles/osl/) | none | spot | none tradable. OSL HK lists spot only. OSL Global (OSL Bermuda Ltd) USDC-M: 25 rows still in /openapi/v1/symbols, 0 tradable, 0 live books (21 delisted in July 2026, BTC-PERP delisted 2026-09-16) | 500 | OSL HK v4 wss://trade-hk.osl.com/ws/v4?subscribe=orderBook:SYM,... (acked as channel depthDiff, no subscribe frame). A partial snapshot on connect of up to 100 levels per side, then insert/update/delete rows keyed by price and side, about 1 to 2 publishes per second. One change spans several messages that share a bookVersionId. bookVersionId only rises within a pair but jumps up to 6,466 (one engine-wide counter), so no gap rule is possible. No checksum, no deflate. The server sends {"action": "ping"} every 5 s. Alternative: v5 wss://stream-hk.osl.com/ws/v5/public books15 sends a whole 15-level snapshot on each push (median gap 257 to 1,010 ms, repeated even when unchanged), with no sequence and no checksum | none. OSL HK spot publishes no index, mark or funding, only the last trade and a ±3/5/10 % price band in /api/v4/instrument. OSL Global's GET /openapi/v1/price (mark, index and last for every perp in one call) and its !markPrice@arr socket still answer, but every perpetual is delisted | OSL HK: KYC clients of OSL Digital Securities Ltd (SFC Type 1/7, VASP). The API is only for corporate, institutional, PI and omnibus clients. Whether US persons may trade is not publicly specified (terms: sanctions plus OSL discretion). OSL Global (OSL Bermuda Ltd): the supported-country list names neither the US nor Canada. From this host every public REST call answered 200 and every socket 101, through Cloudflare SEA/YVR, with no refusal. One v4 handshake out of 21 never completed. The docs index apidocs.bct.host answered 302 to Cloudflare Access (real_country CA) | spot only |
| 1 | KuCoin (KuCoin Futures), [`../profiles/kucoin/`](../profiles/kucoin/) | kucoinfutures, kucoin | perpetuals | USDT-M 673 (518 crypto, 6 metal, 3 commodity, 146 stock. 3 of them pre-market), USDC-M 5, coin-M inverse 4. 682 active perps on the wire and in CCXT vs 689 on CoinGecko. Plus 2 inverse dated futures | 600 | Tokenless UTA socket wss://x-push-futures.kucoin.com, channel obu, tradeType FUTURES, depth increment@10ms ("Increment Best 500"). Sends a snapshot of up to 500 levels per side on subscribe, arriving 0.5 to 6.2 s after the subscribe frame. Then deltas aggregated per 10 ms, each covering sequence O..C. O equalled last C + 1 on every delta: 0 gaps in 8,650 deltas on 6 contracts and none on 100 contracts in the batch runs. No checksum. Frames are uncompressed JSON sent in binary WebSocket frames, and permessage-deflate is not negotiated. One symbol per subscribe frame (a symbols array is refused), 300 client messages per 10 s and at most 600 topics per connection. Unknown symbols are acked result:true and then stay silent. Sizes are lots of multiplier coins, equal to CCXT contractSize. Classic token socket alternatives: /contractMarket/level2, real time with no snapshot, one level per frame, sequence +1 per frame. And level2Depth50, a full 50 levels every 100 ms. | One bulk call, GET https://api-futures.kucoin.com/api/v1/contracts/active (weight 3, 1.40 MB or 137 KB gzip, warm median 215 to 223 ms, max 325 ms). It carries index (indexPrice), mark (markPrice, never 0), funding (fundingFeeRate, the running estimate for the upcoming settlement), interval (fundingRateGranularity in ms: 8 h on 251, 4 h on 429, 1 h on 2) and next funding (nextFundingRateDateTime, Unix ms) for every family. A per-contract fundingRateCap equals minus fundingRateFloor (0.02 on 608 contracts, 0.003 on XBTUSDTM). Mark is median(index × funding basis, index + 300 s basis average, last trade) with no published premium clamp, so on quiet contracts it pins to the last trade or to the index. For 5 to 20 s after a settlement the reply keeps the old estimate under the new next time, then shows the settled rate for about a minute. Errors come back as HTTP 200 with a code other than 200000. | Terms (Turks and Caicos law) bar the US and its territories, Singapore, mainland China, Hong Kong, Malaysia, Kazakhstan, Uzbekistan, Ontario, British Columbia, France, the Netherlands and occupied Ukraine regions. US persons may not trade: Peken Global pleaded guilty on 2025-01-27 and agreed to exit the US for at least two years, and a CFTC order of 2026-03-30 permanently bars US participants. From this Seattle host every public REST call answered HTTP 200 (Cloudflare SEA edge), and both public sockets opened normally (CloudFront SEA900). No geoblock or refusal was seen, and the website also served 200. | fits as is |
| 1 | Toobit, [`../profiles/toobit/`](../profiles/toobit/) | toobit | perpetuals | USDT-M 757 (244 of them stock contracts, isRwa STOCK), USDC-M 10 (all duplicate USDT-M pairs, ranked out by the quote family), coin-M 0. All 767 TRADING on 2026-09-22 | 600 | diffDepth on wss://stream.toobit.com/quote/ws/v1 (one URL for USDT-M, USDC-M and spot), params {binary:false}: whole book (~240 levels per side on BTC) as an f:true snapshot on subscribe, then absolute-size deltas about 3 per second. Sequence is the undocumented per-symbol delta counter `o` (0 on snapshot, +1 per delta, take the first delta after a snapshot as base): 0 gaps in 19,627 deltas over 300 contracts. No checksum. Levels ordered on the wire. Text JSON (binary:true switches to gzip frames), permessage-deflate not negotiated. No ack, errors {code,desc} name no symbol. Client {"ping":ms} needed, a socket with no traffic closes at 60 s. The depth topic sends the whole book every push, ignores limit, and costs about 5x the parse time | Three bulk calls, all five AnchorRow fields present: GET /quote/v1/index (index and 10-min edp, keyed by the catalog's indexToken, not the contract id), GET /quote/v1/markPrice (mark on a 1 s grid, 878 rows incl. 69 TBV_ and delisted), GET /api/v1/futures/fundingRate (rate, period 8H/4H/1H, nextFundingTime ms, interest, per-contract fundingRateCap/Floor, 0.02 on 575 contracts). Median 131 to 306 ms, none over 1 s. Mark = median(last, index-based, index+5 min basis MA) with no documented clamp, equal to the last trade on 338 to 350 of 767 contracts. Settled rate = last published estimate (6 of 6 settlements), and nextFundingTime stays on the past instant for about 75 s after each settlement. 264 of 767 index baskets have a single source (227 stock, 37 crypto), none includes Toobit itself | Hopeful Technology Co. Ltd. (Cayman) for non-EU/EEA users and Elyndret Sp. z o.o. (Poland) for EU/EEA users. Restricted list in Terms 13.3. US users may not trade (services to the US ended 2024-08-01), so trading from the host is not allowed. From this host, every public REST call to api.toobit.com and the WS at stream.toobit.com (both Cloudflare) answered normally, with no geoblock or challenge. support.toobit.com is NXDOMAIN, and www.toobit.com/fee redirects to itself and ends in 429 | fits with a named change |
| 1 | WhiteBIT, [`../profiles/whitebit/`](../profiles/whitebit/) | whitebit | perpetuals | USDT-M crypto 304, USDT-M TradFi 93 (region-gated, CCXT 4.5.68 loads them as spot), USDC-M 0, coin-M 0. /futures lists 397, CoinGecko says 398 | 550 | depth on wss://wss.whitebit.com/ws (JSON-RPC depth_subscribe [market, limit, "0", true], one market per request, limit 1/5/10/20/30/50/100): snapshot on subscribe (params[0] true, exactly limit levels), 100 ms deltas with a side omitted when unchanged, full keepalive snapshot after 10 s idle. Sequence rule past_update_id == previous update_id (update_id is a per-market full-book counter and jumps), 0 gaps in about 54k deltas incl. 397 perps on one socket. No checksum. Text JSON, permessage-deflate not negotiated. Client JSON ping needed (client-silent idle socket closed at 60.5 s). Multi_depth false drops every other depth subscription. CCXT Pro 4.5.68 still uses the legacy host api.whitebit.com, which rejects connections from 2027-03-01 | GET /api/v4/public/futures, one bulk call (255 KB decoded, br, warm median 219 to 298 ms) for all 397 perps with index_price, mark_price, funding_rate (fraction per interval, predicted for next settlement), funding_interval_minutes (240 or 480), next_funding_rate_timestamp (ms as string), plus funding_cap/floor (±0.02 on 378, ±0.0075 on 6, ±0.00375 on 13). All five AnchorRow fields exist. Values step about every 5 s and the REST reply twice stepped back to an older snapshot within a minute. Mark formula and clamps not published, crypto mark seen up to 4.5% off index. Index falls back to spot last then perp last, and TradFi index equals the perp's own last with mark equal to index. PremiumIndex WS pushes the same fields for all perps every 0.5 s. CCXT fetchFundingRates drops mark, index and interval | US persons may not trade (WhiteBIT US, Inc. terms: "not currently available in the US"). First-party docs give the restricted list only via compliance@, third-party lists about 30 incl. US, UK, Canada, Russia. From this host (Cloudflare trace loc=CA, colo YVR/SEA): public REST /futures, /markets, /ticker, /orderbook, /funding-history 200. /collateral/markets HTTP 451 {"errors":[],"message":"Margin trading is not available in your country.","success":false}. WS wss.whitebit.com and legacy api.whitebit.com both opened and served. Whitebit.com website, fee, VIP, terms and help pages HTTP 403 Cloudflare "Security check" (cf-mitigated: challenge), also 403 via WebFetch. Docs.whitebit.com and institutional.whitebit.com answered 200 | fits with a named change |
| 2 | Bitvavo, [`../profiles/bitvavo/`](../profiles/bitvavo/) | bitvavo | spot | none (CCXT 4.5.68 loadMarkets: 438 spot, 0 swap. No derivatives call in REST or WS spec v2.10.0. Absent from CoinGecko's 214 derivatives venues. App-only margin trading is spot borrowing, not a perpetual) | 2500 | `book` on wss://ws.bitvavo.com/v2/ (one socket for all 437 trading EUR and USDC markets). It streams full-depth deltas batched about every 100 ms per market. No snapshot on subscribe: use the getBook action (1 to 1,000 levels, default 1,000) or REST /v2/{market}/book, 1 weight point each. The per-market `nonce` must equal last + 1 (0 gaps in about 4,900 events over 3 book runs and 89,029 events over 2 batch runs of 437 markets). The snapshot nonce is the newest event already sent, and REST equals WS at the same nonce on 25 of 25 levels. The nonce resets on a matching engine restart while the socket stays open. No checksum. Plain text frames unless the client offers deflate. Delta prices are padded ("75516.00") and snapshot prices are not, so levels must be keyed by Number(). The server sends a protocol ping every 50 s, and idle sockets stayed open 100 s. | none: Bitvavo publishes no index, mark or funding. The only spot references are GET /v2/ticker/book (all 438 markets, 1 weight, median 197 ms), /ticker/price, /ticker/24h (25 weight without market) and the MiCA /report/{market}/book | Only residents of 24 listed SEPA countries may trade, through Bitvavo B.V. (AFM MiCAR CASP). No account is possible from outside SEPA, so no US residents. From this host near Seattle, public REST api.bitvavo.com (Cloudflare, colo YVR) and wss://ws.bitvavo.com/v2/ answered 200 and opened with no challenge. bitvavo.com, including the fee page, answered 403 with cf-mitigated: challenge (a Cloudflare browser challenge), and so did WebFetch. wss://ws-mdpro.bitvavo.com/v2/ opens but answers every subscribe or getBook with errorCode 300 "Authentication is required for this endpoint." | spot only |
| 2 | Bitunix, [`../profiles/bitunix/`](../profiles/bitunix/) | none | perpetuals | USDT-M 685 (plus 35 OPEN equity/ETF/pre-market contracts with isApiSupported false, and 1 PREVIEW), USDC-M 25, coin-M (quote USD) 15 | 600 | depth_book15 on wss://fapi.bitunix.com/public/ (one URL for all three families). Each push is a whole 15-level window on a timer of about 310 ms (3.05 to 3.28 pushes a second, even on quiet books). No deltas, no sequence or update id, no checksum, no subscribe ack. An unknown symbol gets one frame of empty "" levels. Capped at 300 streams per socket (the 301st is refused). No compression: deflate is not negotiated. No 20+ level channel exists: depth_books is the whole book (462 KB a frame on BTCUSDT). Sizes are base coin on USDT-M and USDC-M. Coin-M sizes look like USD. | One bulk call, GET https://fapi.bitunix.com/api/v1/futures/market/funding_rate/batch: 186 KB, 894 rows (133 of them delisted, with rate 0), median 150 to 190 ms. It carries all five fields: indexPrice. MarkPrice. FundingRate in PERCENT (divide by 100). FundingInterval in hours (1, 4 or 8). NextFundingTime in ms, which is off the hour on delisted rows. Clamps: per-contract maxFundingRate/minFundingRate in percent, symmetric, 0.3% to 3.75% (2% on 646 contracts). The mark is median(mark1, mark2, last) with no other clamp documented, and it equalled the last trade on 382 of 760 rows. The index basket is unpublished. It is not verified whether the REST rate is the one charged at the next settlement or a prediction for the period after. The WS price channel fr is the last settled rate. | Bitunix's Prohibited Jurisdictions notice (2026-08-05) excludes the United States and all its territories, Canada, Mainland China, Hong Kong, Singapore, France, UAE, Malaysia, Seychelles and sanctioned states, and forbids VPN access. So US persons may not trade. No official page names the contracting entity, and CoinGecko lists Saint Vincent and the Grenadines. From this host, public REST on fapi.bitunix.com answered HTTP 200 through Cloudflare SEA/YVR, and the public WS upgraded with 101, with no refusals. Only the help center at support.bitunix.com answered 403: a Cloudflare bot challenge, "Just a moment...", with cf-mitigated: challenge. | fits with a named change |
| 2 | BingX, [`../profiles/bingx/`](../profiles/bingx/) | bingx | perpetuals | USDT-M 1,220 rows. CCXT counts 1,070 of them active: 909 or 910 with status 1 and the API open, plus 160 or 161 with status 25 (no new positions). 490 of the active ones are NC-prefixed TradFi contracts. USDC-M 49, all active. Coin-M 20, all inactive in CCXT. | 500 | <symbol>@incrDepth on wss://open-api-swap.bingx.com/swap-market, which carries USDT-M and USDC-M. It sends a snapshot on subscribe (action "all", up to 1,024 levels per side, 169 to 280 ms after the subscribe), then updates. Each symbol has its own lastUpdateId. The docs say +1, but ids skip forward by 2 to 9 on most streams (475 to 490 skips in a minute across 199 streams). No skipped id ever arrived later, and the books still matched REST. No checksum. Every frame, the Ping included, is binary gzip, and permessage-deflate is not negotiated. Pushes every 200 ms on BTC and ETH and every 400 to 800 ms on other symbols. 200 topics per socket (error 80403). The server sends a text Ping every 5 s and closes a client that sends no Pong at 30.5 s. | GET /openApi/swap/v2/quote/premiumIndex without symbol: 1,036 or 1,037 rows (every status 1 contract), 244 KB, median 375 to 378 ms, max 641 ms. It carries indexPrice, markPrice, lastFundingRate (the running rate for the upcoming settlement, not the last settled one), fundingIntervalHours (1, 4 or 8), nextFundingTime (absolute Unix ms, though the docs say remaining time) and per-contract minFundingRate and maxFundingRate caps (±0.0005 to ±0.06, ±0.02 on 747 rows). Mark is the median of index, index plus a 5-minute basis average, and last trade, with no clamp against the index (ONE-USDT mark 42% under its index). Index is an equal-weight average of external venues with a 3% median filter, and no basket is published. The coin-M twin /openApi/cswap/v1/market/premiumIndex has no interval field. | Who may trade: the Customer Agreement (Nieve Cruz PA Corporation, updated 2026-09-02) excludes US and Canada users. The Disclaimer's restricted list includes the US, UK, Canada, Netherlands, Singapore, Hong Kong and mainland China. What this Seattle host saw: every public REST call returned HTTP 200 through CloudFront SEA73 or YVR52, except one coin-M contracts call sent without a timestamp, which got 400 with code 104414. Every WebSocket opened in 505 to 669 ms with no refusal. | fits with a named change |
| 2 | Bullish, [`../profiles/bullish/`](../profiles/bullish/) | bullish | perpetuals | USDC-M linear 22. The count is from CoinGecko's production listing, which returned tickers for 19. Production refused the catalog call. SimNext has 22 enabled of 47. There are no USDT, USD or coin-settled perps. | 200 | l2Orderbook on wss://api.exchange.bullish.com/trading-api/v1/market-data/orderbook, one symbol per JSON-RPC subscribe frame. Every frame is a full snapshot with up to 200 levels per side on the wire (the spec says 100), including the first frame after subscribe. Sequence rule: sequenceNumberRange [lower, upper] with lower = previous upper + 1. There were 0 gaps on SimNext and l1 shares the same sequence space. No checksum. Deflate is not negotiated. keepalivePing is required, because SimNext closed a socket after about 60 s with no frame. All of this was probed on SimNext only. Production returned 403 on every socket. | There is no bulk call for mark or funding. GET /trading-api/v1/index-prices returns the index for every asset in one reply, in USD, keyed by asset. Mark and fundingRate come only per symbol, from GET /v1/markets/{symbol}/tick or the tick WebSocket. The tick fundingRate is in percent (divide by 100), while the funding history is a fraction. Interval (1 h) and next funding (the top of each hour) appear in no reply and must be hardcoded from the docs. Clamps: funding is at most ±0.625 bp per hour (each minute ±5 bp after a ±2 bp dead zone, divided by 8, then 59 minutes averaged). Mark = clamp(index*(1+EMA30s premium), min(bid,index), max(ask,index)). The index is a median that includes Bullish's own price and the last index, and its basket is private. | Only professional-investor customers of Bullish GI (Gibraltar) may trade perps. The GI terms bar US citizens, residents and anyone located in the US, and the HK, EU and US entities offer no perps. From this Seattle host, every production REST and WS path returned HTTP 403 from Cloudflare (SEA/YVR edges) with the page "The Bullish platform is not currently available in your location." The SimNext test environment and the docs sites returned 200. | blocked |
| 2 | Bitso, [`../profiles/bitso/`](../profiles/bitso/) | bitso | spot | none (54 spot books: 26 usd, 12 mxn, 5 usdt, 4 brl, 3 ars, 2 cop, 1 usds, 1 btc. No dated futures and no options. A "Perps" entry in the web app looks like Hyperliquid routed through Bitso Onchain, which is not a Bitso order book and has no Trading API endpoint.) | 3600 | wss://ws.bitso.com, one URL and one socket for all 54 books. `diff-orders` is an order-level feed: {o, r, a, t, s} over the whole book, with a per-book sequence that steps by exactly 1. It had 0 gaps in about 55k diffs over two runs. No snapshot on subscribe: the documented seed is REST order_book?aggregate=false (every order with its oid, about 520 KB for btc_usd), then discard diffs at or below its sequence. That recipe matched the orders channel on 1,727 of 1,727 frames. There is no checksum. A modify arrives as cancelled then open with the same oid. `orders` sends the top 20 orders (not levels, 6 to 20 prices), replaced whole on each change, with no sequence. Quiet books send nothing on either channel. Keepalive is a server {"type":"ka"} every 20 s. Compression only if the client asks: permessage-deflate is negotiated on request and never forced. | none. Bitso publishes no index, mark, funding rate, interval or next funding. The undocumented bulk GET https://api.bitso.com/v3/ticker/ (no book parameter) returns all 54 books in 14.4 KB with a median of about 95 ms. It carries only bid, ask, last, 24 h vwap, high, low and change_24. An AnchorRow would have mark 0, which the engine refuses as anchor_no_mark. | Who may trade: Bitso International (Gibraltar, GFSC DLT licence FSC1348B, registration 117775) and the Nvio entities in MX, BR, AR and CO. Its terms of 2026-04-14 list 35 Prohibited Jurisdictions, including the United States and the United Kingdom, so US persons may not open accounts. Margin is available only on request. From this host near Seattle, every public REST call answered 200 through Cloudflare (YVR and SEA) with no challenge (public limit 60 requests a minute per IP, documented 420 lockout, not triggered). Every WS socket opened in 311 to 369 ms with no refusal. The help center article pages answered 403, but its JSON API answered 200. | spot only |
| 3 | HashKey Exchange, [`../profiles/hashkey-exchange/`](../profiles/hashkey-exchange/) | none | spot | none live. The HK site lists 1 staging USD-M contract, BBTCUSD-PERPETUAL: base BBTC, book empty, last trade 2026-01-28, and the docs mark fundingFee and futuresTrade as "To be released". Sister sites, which are separate venues: the MENA site on the same host (site=MENA) has 6 USDT-M perps (BTC, ETH, QQQ, SOXL, SKHYNIX, SPCX), and HashKey Global (api-glb, site BMU) has 2 USDT-M perps. | 2900 | Recommended: V2 `depth` on wss://stream-pro.hashkey.com/quote/ws/v2, one subscribe frame per pair. Each push is a full 100-level book, about every 100 ms, sent only when the book changes. There is no snapshot on subscribe: 5 of 38 pairs sent nothing in 15 s, so each pair needs a REST seed. The version `v` never went backwards. No checksum, and data age at arrival had a median of 92 to 105 ms. Alternative: V1 `diffMergedDepth` (needs dumpScale). It sends a snapshot on subscribe (f true, o 0), then deltas whose per-pair `o` must step by exactly 1: 0 gaps in about 4,300 deltas. It holds 100 levels, a "0" size deletes a level, and it pushes about every 300 ms. V1 `depth` sends full 100-level books every 300 ms, with a snapshot on subscribe. Compression: deflate is not negotiated, and binary:true sends gzip. Keepalive: the client sends {"ping":ms} every 10 s. The server never pings, and a socket with no traffic is closed with 1006 at about 60.3 s. | none. HK spot publishes no index, mark or funding. The only mark call is /quote/v2/markPrice?symbol=, one contract per call. It answers only for the dormant BBTCUSD-PERPETUAL, stamped on a 1 s grid and tracking BTC spot. /quote/v2/index and /quote/v1/index return 404 "No static resource", although v2/index is documented. /api/v1/futures/fundingRate and historyFundingRate return an HTML 404. No bulk call exists, and there is no interval or next-funding field. | Hash Blockchain Ltd holds SFC Type 1 and Type 7 licences. Retail clients can trade 7 of 38 pairs, and PI, corporate and omnibus clients all 38. The group's 2026-07-27 release says HashKey Exchange "does not provide services to users in Mainland China, the United States, and certain other jurisdictions", so US persons may not trade. Under the SFC framework of 2026-02-11, any future perps would be for PIs only. From this host near Seattle, through CloudFront POP SEA900: every public REST call answered 200 or a documented 4xx, with no geoblock and no rate-limit headers. WS V1 and V2 opened in 317 to 364 ms, and twelve concurrent sockets were all accepted. | spot only |
| 3 | Ourbit, [`../profiles/ourbit/`](../profiles/ourbit/) | none | perpetuals | USDT-M 735 (529 crypto, 206 TradFi by conceptPlate: stocks, ETFs, indices, commodities, forex, pre-IPO), USDC-M 0, coin-M 0. All 735 in state 0 on 2026-09-23 UTC. CoinGecko shows 770. Spot has 862 symbols and is not detailed. | 400 | Recommended: sub.depth.full with limit 20 on wss://futures.ourbit.com/edge. The documented wss://contract.ourbit.com/edge is NXDOMAIN. Every push is a whole top-20 book, JSON numbers [price, contracts, orders], sorted best first. So there is a snapshot every frame, no sequence rule and no REST seed, and version only grows. Pushes come every 171 ms median on BTC and up to 5.6 s apart on quiet books, with identical repeats. Limit 50 is also accepted, 30 is refused. It was only tested on 2 or 3 symbols per socket. Alternative: sub.depth plain deltas carry one absolute level per frame, removal [p,0,0], and a per-symbol version that is +1 per frame (0 gaps in about 800k frames over all runs). They send no snapshot, so a REST /depth seed aligned by version is needed. They run about 40 frames/s per contract (6,073/s median for 150 contracts on one socket), too many for the Node loop across 735. compress:true is not compression: it merges deltas into begin/end frames about every 210 ms (156/s for 150 contracts, 0 gaps), with unordered levels. No checksum. permessage-deflate is not negotiated. Text JSON. Client {"method":"ping"} is needed: with no ping, an unsubscribed socket closes at 45 s and a subscribed one at about 67 to 70 s. Pong round trip is 102 to 113 ms. | Two bulk calls cover all five AnchorRow fields for all 735. GET futures.ourbit.com/api/v1/contract/ticker gives indexPrice, fairPrice and fundingRate (387 KB, median 93 to 112 ms). GET /api/v1/contract/funding_rate gives fundingRate, collectCycle in hours (4h on 452, 8h on 280, 1h on 2, 24h on 1), nextSettleTime in ms, and per-contract symmetric maxFundingRate/minFundingRate (0.02 on 616, 0.002 on BTC and ETH) (120 KB, about 123 ms). Rows are keyed by symbol, which equals the id. The ticker is a snapshot refreshed about every 2 s, with rows 1.2 to 1.3 s old at the median and up to 3.2 s. Per-symbol index_price and fair_price calls are fresh but would be 74x over the limit. The index formula and weights are not published. indexOrigin lists the source names, including OURBIT itself in 71 baskets (DRV_USDT is GATEIO+OURBIT). 3 baskets have a single source, and the CIP-suffixed sources are unexplained. The fair price (mark) formula is not published. The mark follows the perp's own last trade: equal to it on 218 to 300 of 735, and up to 3% off the index (CATE_USDT). priceCoefficientVariation ("fair price coefficient variation") is 0.004 on BTC and ETH and 0.4 on 697, and never bound, so a possible 0.4% mark clamp on BTC/ETH is open. The funding rate is a live estimate for the next settlement, updated in batches, with no published formula. Settlement history is at /funding_rate/history. The settlement instant itself was not captured. | Ourbit Holdings Ltd. (BVI, No. 2138612). Excluded: the US, China, Singapore, North Korea, Cuba, Iran, Sudan, France, Germany, the Netherlands, Spain, Italy, Austria, Portugal, Ontario, and Russian-held Ukraine, so US persons may not trade. The futures API order endpoints have been "under maintenance" since 2022-07-25, and the current 2026-07-08 contract doc lists only history endpoints. Public market data is documented only in an unserved 2021 to 2024 v1 doc. From this host near Seattle, every public call to futures.ourbit.com (Cloudflare YVR/SEA, trace loc=CA) returned HTTP 200. Errors came back as a 200 JSON body with success false, and unknown paths as a 404 HTML page. The WS opened in 328 to 419 ms and served every channel. No refusal and no geoblock. The website, fee page, terms and help pages also returned 200. | fits with a named change |
| 3 | Bitkub, [`../profiles/bitkub/`](../profiles/bitkub/) | none | spot | none | 2500 | wss://api.bitkub.com/websocket-api/orderbook/<pairing_id>. The documented form orderbook.<id> gets HTTP 200 with no upgrade. One pair per socket, because two ids in one path return 404. There is no subscribe frame. The depthchanged event carries the whole aggregated book, 100 levels per side on THB pairs and 50 on USDT broker pairs, as JSON numbers in base units. No book arrives on connect: the first depthchanged came 4.3 to 4.8 s after open on BTC_THB. There is no sequence, no timestamp and no checksum. The server did not negotiate permessage-deflate. Every socket also gets about 200 global.ticker frames per second, which are 98.5 to 98.7 % of its traffic. The socket also misses book states: of 26 and 32 distinct REST books seen in 30 s, only 10 and 8 ever arrived as frames. | none. There is no index, mark or funding. The only bulk call is GET /api/v3/market/ticker (366 active rows, 82 KB, median reply about 945 ms), which gives last, bid and ask with no clamps. | Bitkub Online Co., Ltd. holds Thai exchange and broker licences. Accounts are open to Thai nationals and to foreigners who live or work in Thailand and can show documents for it. No document names US persons, but a US person living in the US cannot meet the residence documents. From this host near Seattle, REST at api.bitkub.com answered 200 on every public call, with errors returned as 200 {error:N}. The WebSocket upgraded (101) on valid paths, and there was no geoblock. www.bitkub.com and support.bitkub.com returned 403 with a Cloudflare challenge (cf-mitigated: challenge) at 01:25 and 01:58 UTC. | spot only |
| 3 | Luno, [`../profiles/luno/`](../profiles/luno/) | luno | spot | none | 1000 | wss://ws.luno.com/api/1/stream/<pair>, one pair per socket, full order-level book with no depth limit (every order with its id, 16 KB on XBTUSDT, 1.1 MB on XBTZAR) sent as a snapshot after the first client frame, then per-order create, delete, trade and status updates, string sequence must equal last + 1 (0 gaps in 9,653 updates), reconnect on a gap, no checksum, permessage-deflate not negotiated, text JSON only, keepalive is a server protocol ping every 13.5 s plus a "" text frame every 20 s. Documented as requiring an API key first frame, but an empty {} got the book with no key on 2026-09-22. | none. Luno is spot only and publishes no index, mark, funding rate, interval or next funding. The only bulk call is GET https://api.luno.com/api/1/tickers (pair, bid, ask, last_trade, rolling_24_hour_volume, status, timestamp for 145 markets, about 22 KB, median 216 to 237 ms). The only index Luno names is the Blue Chip+ index behind its Bundles product, not a per-market reference price. | Accounts only for residents of South Africa, Nigeria, Kenya, Malaysia and Indonesia (business accounts also Uganda), contract with Luno (Pty) Ltd of South Africa (FSP 53314), 33 countries excluded, US persons cannot open an account. From this host near Seattle: api.luno.com (Cloudflare) answered 200 to every public call (warm ticker about 175 ms, markets about 2 s), no geoblock. wss://ws.luno.com answered 101 in 606 to 748 ms, closed a silent client after 10 s with auth_timeout and a non-JSON frame with invalid_credentials, and served the book after {}. Help centre guide.luno.com answered 403 with a Cloudflare challenge, so it was read through its public Zendesk article API. | spot only |
| 3 | Bitbank, [`../profiles/bitbank/`](../profiles/bitbank/) | bitbank | spot | none (62 spot pairs only: 47 JPY-quoted, 15 BTC-quoted, 44 JPY pairs tradable. The other 18 are suspended with empty books. Margin trading at 2x on 5 JPY pairs trades against the spot market and pays a fixed 0.04% per day interest, with no funding.) | 1200 | Socket.IO 4 over Engine.IO 4 at wss://stream.bitbank.cc/socket.io/?EIO=4&transport=websocket. Two rooms per pair: depth_whole_{pair} and depth_diff_{pair}. depth_whole carries about 200 levels per side (186 to 210 seen). A full book arrives 98 to 203 ms after the join, then one every 15 s, even when the book is empty. depth_diff carries absolute sizes (0 deletes a level), batched about every 350 ms, with unordered levels. Snapshot on subscribe: yes. Sequence: diff s and whole sequenceId are strings on one counter shared by all pairs. They never went backwards, but a pair's steps were never 1 in 2,209 diffs, so no gap can be detected. The only repair is the 15 s whole. Rebuilding from a whole plus its diffs matched the next whole on 59 of 59 intervals. No checksum. No compression: a permessage-deflate offer was not negotiated, and frames are plain text. Frames need Engine.IO framing: send 40, then 42["join-room",room], and answer the server ping 2 with 3. | none. There is no index, mark or funding for any product. The only reference price is the circuit breaker band in GET public.bitbank.cc/{pair}/circuit_break_info: upper and lower trigger prices around the close of 10 minutes earlier, 20% on BTC, ETH, XRP, DOGE and SOL against JPY and 50% on other pairs. It is per pair and null outside normal mode. The bulk GET /tickers (62 rows, 9.9 KB) has only bid, ask, last and 24 h stats. A quiet pair's row can be up to about 60 s old. No anchor poller is recommended. | Who may trade: bitbank, inc. (Kanto Local Finance Bureau crypto exchange No. 00004) serves residents of Japan in practice. ToS Article 15 lets it force-close accounts registered from a non-Japan IP. Support-page search snippets say non-residents are usually refused. So US persons living in the US cannot trade. What this host saw: public.bitbank.cc (S3 behind CloudFront SEA73), api.bitbank.cc (nginx behind CloudFront) and wss stream.bitbank.cc (CloudFront SEA73-P1) all returned HTTP 200 and data to this host near Seattle, with no geoblock. Unknown paths return 404 {"success":0,"data":{"code":10000}}. Only support.bitbank.cc answered 403 with a Cloudflare challenge. | spot only |
| 4 | CoinW, [`../profiles/coinw/`](../profiles/coinw/) | none | perpetuals | USDT-M 385, USDC-M 2 (BTC_USDC, ETH_USDC), coin-M 0. All 387 are online on 2026-09-23 UTC in GET /v1/perpum/instruments, including equity-named contracts such as SAMSUNG, DELL and MSTR with no tradfi flag. The tickers call adds 17 …PROPW contracts that are not in the catalog. CoinGecko shows 455, and 70 of those (mostly equities such as AVGO, AMAT, ARM) are missing from the API catalog, though AVGO still answers the REST book and funding calls. No dated futures, no options. Spot exists and is not detailed. | 600 | depth on wss://ws.futurescw.com/perpum. One URL serves USDT-M, USDC-M and private data. Every push is the whole book: up to 200 levels per side (the docs say 100), with price and size as strings. Sizes are in base currency, not contracts (all 413,013 sizes were whole multiples of oneLotSize). Levels are sorted best first. Busy books push about 4.6 times a second (median 219 ms), and quiet books push only on change, with gaps up to 6 s. The first frame is the snapshot and arrives 185 to 267 ms after the subscribe. There are no deltas, no sequence or update id and no checksum. data.t is about 190 ms old on arrival. Frames are plain JSON unless the client offers permessage-deflate, which the server then negotiates. The engine does not offer it. You subscribe one contract per frame. The docs limit depth subscriptions to 10 per 2 s per IP, but a burst of 12 drew no refusal. Unknown, misspelled or joined symbols are acknowledged with result true and never served. Each connection serves only its first 513 subscriptions, and later ones are acknowledged but stay silent. Weight: 100 contracts on one socket gave 260 to 274 frames/s, 2.4 to 2.5 MB/s and 9.3 KB per frame, at 281 to 310 µs per parse on this laptop. Keepalive is a client {"event":"ping"} answered by {"event":"pong"}, and the server sends no ping of its own. A socket with no subscriptions and no traffic closes at 60.0 s with code 1006. | No REST call returns index, mark or the upcoming funding rate in bulk. GET /v1/perpum/instruments (517 KB, 387 rows, median 225 ms) has only settledPeriod (interval in hours: 8 h on 211, 4 h on 175, 1 h on 1) and settledAt (next funding, ms). The tickers fair_price is documented as the index but tracks the last price. GET /v1/perpum/fundingRate works one contract at a time and returns only the last settled rate. It refuses BTC_USDC. All five AnchorRow fields exist only on the socket, per contract: index_price p and mark_price p every 238 to 320 ms median, and funding_rate every 5 s with r (upcoming rate as a fraction per interval), h (hours) and nt (ms). h and nt matched the catalog on 171 of 171. On 164 of 165 shared contracts, r equalled Binance USD-M lastFundingRate exactly. The index is not Binance's (median gap 260 to 300 ppm). The help center snippet names a basket of Binance, HTX, OKX, Bybit, Gate and KuCoin, a 5% source guard, and a mark equal to index plus a 30-minute moving basis. No mark or funding clamp is published: the help center returned 403. ONE's mark sat 10.6% to 12.2% under its index, so ONE had no tight premium clamp. | Who may trade: CoinW accounts outside its restricted list, after a futures risk quiz. A secondary source (Datawallet, citing CoinW's Legal Statement) lists the United States, Canada, Japan, Singapore, Hong Kong, the UAE, mainland China and about 38 others, so US persons may not trade. The official legal statement, fee page, trading rules and help center returned HTTP 403 with a Cloudflare 'Just a moment...' challenge, both to curl from this host and to the fetch tool. Only /api-doc/ returned 200. From this host near Seattle, REST api.coinw.com returned HTTP 200 through Cloudflare (YVR/SEA edges), 174 to 214 ms warm and 209 to 281 ms cold. WS wss://ws.futurescw.com/perpum returned 101 through a 'Cdn Cache Server V2.0' CDN (whecloud.com, server wswaf), opened in 291 to 756 ms, with about 240 ms round trip. No refusal and no rate-limit reply was seen. | fits with a named change |
| 4 | Coinstore, [`../profiles/coinstore/`](../profiles/coinstore/) | none | perpetuals | USDT-M 58 linear (current catalog GET futures.coinstore.com/api/v1/public/web/instruments, all status 3. QNTXUSDT has a book and fee row but no instrument row. A legacy catalog /api/configs/public still lists 35 dead contracts), USDC-M 0, coin-M 0. Spot 376 to 377 pairs | 600 | wss://ws-futures.coinstore.com/v1/market, stream "depth". It is undocumented and was found in the futures web app bundle. Frames are binary protobuf (BaseWsDTO wrapping WsDepthDTO). Each price gear arrives in its own frame, and the finest gear equals tickSize. It carries the whole book, not a window (BTCUSDT held about 300 bids per side-level count, matching REST). There is no snapshot on subscribe. The recipe that works is: subscribe, read REST /api/v1/market/depth after the first frame, drop frames at or below the REST lastDepthId, then chain. The sequence rule is previousDepthId = last lastDepthId + 1 per symbol, and no gap was seen over 17 streams and 157 streams. There is no checksum. Deflate is not negotiated. Keepalive is a text PING answered by PONG, and a silent unsubscribed socket closes at 30 s. Pushes are batched: about 1 s on BTC and ETH, 3 to 6 s on 32 of 58 symbols, and one symbol sent nothing in 45 s. Sizes are in coins (whole multiples of ctVal), so contractSize must be 1. | No REST bulk call exists. Index, mark, fundingRate and nextFundRateTime (Unix ms) come only from the WS "index" stream: one protobuf frame per symbol per second, and all 58 fit in one subscribe. The funding interval is not on the wire. It is 8 h from the per-symbol history call GET /api/v1/public/funding/web/fundingRate, with the last 100 settlements at 00:00, 08:00 and 16:00 UTC. The meaning of lastFundingRate is unclear. The current funding formula and cap are unpublished: 4,823 of 5,510 settlements were ±0.00005, and the range ran from -0.005 to +0.005. The mark sat nearer the last trade than the index on 17 of 24 readings. Per-symbol markPriceGreaterRatio bands run from 0.005 to 0.2, and no reading reached one. The index basket is unpublished. | Operator is Veraxa Ltd. (CoinGecko lists BVI). The User Agreement (archived 2025-09-08, updated 2025-07-01) prohibits persons located in the United States and Japan, and the FCA has listed Coinstore Pte. Ltd. as unauthorised since 2024-11-20. From this host near Seattle: every public futures and spot REST call returned HTTP 200 (errors come as HTTP 200 with a nonzero code), and the market WS upgraded through the Cloudflare SEA edge. The help center returned 403 (Cloudflare error 1034 on support.coinstore.vip, a challenge page on the zendesk host). The legacy socket.io WS returned 404 from nginx, and futures.api.coinstore.com does not resolve (NXDOMAIN). | no public API |
| 4 | LBank, [`../profiles/lbank/`](../profiles/lbank/) | lbank | perpetuals | USDT-M 845 (product group SwapU, all instrumentStatus 2, 9 flagged needSuspend). CoinGecko says 861. USDC-M 0 and coin-M 0: the groups SwapB, SwapC, Swap and SwapUSDC all returned data: [] | 600 | Undocumented web-app protocol on wss://lbkperpws.lbank.com/ws (the docs give only the URL). Subscribe with {"SendTopicAction":{"Action":"1","LocalNo":n,"TopicID":"25","FilterValue":"Exchange_BTCUSDT","ResumeNo":-1}}. On subscribe it sends a snapshot of 25 or 26 levels per side (a PushMarketOrder with no bNo). After that, deltas arrive as conflated batches every 626 to 764 ms at the median. Each batch holds rows for many contracts that were never subscribed (about 30 KB a frame) with absolute sizes, and size 0 deletes a level. There is no per-symbol sequence: bNo is a shared batch number, so gaps cannot be detected. No checksum. Plain JSON text with no compression, and permessage-deflate is not negotiated. The book is only correct for busy contracts. Quiet contracts (CTK, HK50, STORJ) got 1 or 2 batches and then went stale while their REST book moved: touch matched REST on only 0 to 2 of 12 to 20 reads. In one run DOGE's ask side went stale and the book stayed crossed for 65 of 67 frames. Limits seen: 20 subscribe frames per window of about one second, and on topic 25 errorCode 51 MoreThan3TimesPerSecond at 10 subscribes a second. Keepalive is a text ping answered by pong, and the server sends no ping. | One bulk call, GET https://lbkperp.lbank.com/cfd/openApi/v1/pub/marketData?productGroup=SwapU, returns all 845 rows (305 KB, median 171 to 185 ms, max 612 ms). Fields: index underlyingPrice, mark markedPrice, fundingRate (equal to positionFeeRate, a running estimate for the upcoming settlement), interval positionFeeTime in seconds (1 h on 1 contract, 4 h on 496, 8 h on 348), and next funding nextFeeTime in Unix ms. The docs list prePositionFeeRate, which the wire does not have. No published cap or clamp on funding or on the mark premium. Mark premium median about 1,000 to 1,100 ppm, with 14 to 17 contracts beyond 10,000 ppm and max 97,875 ppm (MOOUSDT). The index updates about every 5 s (BTC index changed on 12 of 59 one-second polls in all three runs). No public index basket call. 7 rows have no fundingRate field, and 1000XECUSDT has index 0.0. Errors come back as HTTP 200 with success:false. | The User Service Agreement dated 2026-07-22 (operator LBK Exchange, BVI law) refuses registration and service to US residents and US entities, plus Canada, Mainland China, Hong Kong, Macao and about 30 other regions, and KYC is required before trading. From this host near Seattle, all public REST calls returned HTTP 200 through Cloudflare with no geoblock. The perp WebSocket opened (HTTP 101) in 421 to 457 ms with no refusal. Refusals seen were errors of our own making: an unknown path gave 403 openresty, a missing symbol gave 500, and an unknown symbol gave HTTP 200 with error_code 20156. | blocked |
| 4 | Bit2Me, [`../profiles/bit2me/`](../profiles/bit2me/) | none | spot | none (a futures WebSocket for BTCUSDC_PERP is documented but not live: it is silent like a bogus path, and it has no REST call and no instrument list) | 6000 | Pro spot `order-book` on wss://ws.bit2me.com/v1/trading, one symbol per subscribe frame, acked with "result":"subscribed". Every frame is a whole book: 100 levels per side on most markets, and 138 bids with 35 asks on BTC/USDC. Most markets are conflated to about 1 frame per second (BTC/EUR median 1,059 to 1,063 ms), and 9 to 13 markets on a second source send about every 500 ms. There is no snapshot on subscribe: a quiet book sends nothing (B2M/EUR 0 frames in 40 s, 22 to 29 of 281 markets silent), so every market has to be seeded from REST. There is no sequence: nonce is fixed per book or clock-like, and every frame replaces the book. No checksum. Plain JSON numbers when perMessageDeflate is false, and the server negotiates deflate only when a client offers it. The server sends a protocol ping every 20 s, and {"event":"ping"} gets {"event":"pong"}. 281 markets ran on one socket at a median 137 to 145 frames/s and about 2.9 KB per frame. | none. There is no index, mark or funding anywhere. Guessed futures REST paths return the same 404 HTML as a bogus path. GET /v2/trading/tickers (bulk, 61 KB, about 250 ms) is trade driven, with bid and ask up to tens of seconds stale. /v3/currency/ticker/{symbol} is a broker reference price, documented with ApiKeyAuth, and it answers 200 without a key. No anchor poller is recommended. | BITCOINFORME S.L. (Spain) is a CNMV-authorised MiCA CASP. It accepts residents of 71 listed territories. The US is not listed, so US persons may not trade, and Canada, Japan, the UK, Singapore and Cyprus are also absent. From this host near Seattle, every public REST call on gateway.bit2me.com answered 200 through Cloudflare SEA, and the spot WS opened in 259 to 336 ms and streamed, with no refusal. The documented futures WS upgraded with 101 and then sent nothing, exactly like the path /v1/nope. | spot only |
| 4 | Niza.io, [`../profiles/niza/`](../profiles/niza/) | none | perpetuals | USDC-M 80. These are the shared Orderly PERP_<BASE>_USDC markets, all ACTIVE, and they match CoinGecko's 80 for Niza.fun symbol for symbol. Orderly also lists 59 builder-suffixed markets (57 _mythos, 1 _alpix, 1 _fastx) that are not Niza's. No USDT-M, coin-M, dated futures or options. | 500 | wss://ws-evm.orderly.org/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY is the only served path, a constant hardcoded in the Orderly SDK and CCXT Pro. Other path segments are closed within ms, and a missing segment gets HTTP 404. `{symbol}@orderbookupdate` sends full-depth deltas on a 200 ms grid, only when the book changes. It sends no snapshot on subscribe. Seed the book from `{symbol}@orderbook`: the whole book, up to about 500 levels per side although the docs say depth 100, pushed 124 to 174 ms after subscribe and then at most once a second on change. A `request` orderbook event also works. Sequence rule: data.prevTs equals the previous frame's ts, with 0 gaps in 671 plus 9,145 deltas. The snapshot ts lines up with the chain. Levels are sorted, prices and sizes are JSON numbers, and sizes are in base units (contractSize 1). No checksum. permessage-deflate is not negotiated. The server pings every 10 s and closes a socket that ignores pings 110 s after the first ping. 80 markets fit on one socket at 72 to 81 frames/s. | GET https://api.orderly.org/v1/public/futures is one bulk call, 60 KB and 139 rows, median 159 and 179 ms, max 360 ms over 120 polls. It carries index_price, mark_price, est_funding_rate (the predicted rate for the upcoming settlement, per funding period, updated on 15 s marks) and next_funding_time in Unix ms. The interval exists only in GET /v1/public/info funding_period: 8 h on 40 shared markets and 4 h on 40. last_funding_rate equals the newest settled history row. Clamps: the mark is clamped to index times a per-symbol band on the wire (±5.25% on 48 markets, BTC ±3%, ETH ±2.4%), and funding is capped per symbol (±2% on 52 markets, BTC and ETH ±0.3%). The index is a spot VWAP with a 5% clamp to the median, and its basket is public via /v1/public/index_price_source. 23 baskets include another venue's perp, BZ and CL use perps only, and none uses Orderly itself. The RWA index freezes while the underlying market is closed. The 10 req/s per IP limit is not reached at 1 Hz. | Orderly's terms exclude US Persons (Reg S), access from US IPs and sanctioned or restricted persons, and they bind integrators such as Niza.fun, so US persons may not trade. Niza.fun publishes no entity or terms (/terms, /privacy and /faq return 404), and CoinGecko lists it as United Kingdom. From this host, every public Orderly REST call returned 200 and the WS was served, with no geoblock. Orderly's /v1/ip_info placed the host in Canada with checked:false. On the Niza side, niza.io returned 402 DEPLOYMENT_DISABLED (Vercel), api.niza.io fails TLS (it presents a Cloudflare Origin cert), app.niza.io/trade/v1/markets returned 200 with 1,305 spot pairs, and niza.fun returned 200. | fits with a named change |
| 11 | BitoPro, [`../profiles/bitopro/`](../profiles/bitopro/) | bitopro | spot | none (35 spot pairs: 15 USDT, 19 TWD, 1 BTC. Also "Credit" margin up to 3x. No perpetuals, dated futures or options. CCXT has swap/future/option false at bitopro.js lines 31 to 33. Not on CoinGecko's 113-venue derivatives list.) | 2000 | No subscribe frame: the URL is the subscription, wss://stream.bitopro.com:443/ws/v1/pub/order-books?pairs=BTC_USDT:20,... with limits 1, 5, 10, 20, 30 or 50 (default 5). Any unknown limit, such as 100 or 7, silently serves 5. Every frame is a full snapshot of the requested depth, pushed on a 200 ms grid when the book changed and sometimes when it did not. No deltas, no sequence number (eventID is a random UUID), no checksum. Bids descending, asks ascending. The first frame carries exact amounts, and every later frame rounds amounts to the catalog amountPrecision (4 on most pairs). Plain text JSON. The server negotiates permessage-deflate only if the client offers it. The server sends a protocol ping every 1 s and closes a socket that does not pong at 60 s with code 1006. All 35 pairs fit on one socket (median 37 frames/s, 111 KB/s). A quiet pair can go 84 s without a frame. Frames spell BTC_USDT, while the CCXT id is btc_usdt. | none. Spot only, so there is no index, mark, funding rate, interval or next funding time. The only reference prices are GET /v3/price/otc/{currency}, an OTC desk buy and sell quote in TWD (spread 0.8 to 1.0 % on USDT), and lastPriceUSD and lastPriceTWD on the ticker stream. A mark of 0 refuses the route at open, so no anchor poller is recommended. | Operator is BitoPro Technology Co., Ltd. (Taiwan, UBN 90577481), listed on the Taiwan FSC/SFB AML VASP registration page (updated 2025-12-18). Terms of Use (version 2026-03-30), Ch.1 S.1 Art.5, refuse registration to citizens of China, Hong Kong, Macau and the United States, and refuse logins from FATF blacklist countries, so US persons may not trade. Whether non-residents of Taiwan can complete KYC is not stated. From this host near Seattle: REST api.bitopro.com answered 200 on every call (warm about 105 ms, via AWS Global Accelerator-range addresses). WS stream.bitopro.com upgraded with 101 in 290 to 460 ms. There was no geoblock, challenge or 429. An unknown pair in the WS path gets HTTP 200 with an empty body instead of 101. | spot only |
| 11 | Max Maicoin, [`../profiles/max-maicoin/`](../profiles/max-maicoin/) | none | spot | none (74 active spot markets: 41 TWD, 32 USDT, 1 BTC quoted. No futures, mark or funding endpoint exists in the v3 API. CoinGecko's 214-entry derivatives list has no MAX entry. Spot margin, the M-wallet, is available on 6 markets.) | 1600 | wss://max-stream.maicoin.com/ws, one URL for all markets on AWS Singapore. The spot `book` channel takes depth 1/5/10/20/50 (default 50) and sends a snapshot on subscribe, then updates. Sequence: per market fi/li plus a version v, apply when fi = stored li + 1, drop when li <= stored, resubscribe on a gap or a v change. There is no checksum. Frames are text JSON unless the client offers permessage-deflate, which the server then negotiates. Snapshot bids arrive worst first and update arrays are unsorted. Frames carry no depth field. Updates showed 0 gaps on 4-market subscribes. A 74-market single-frame subscribe had 3 to 5 first updates skip exactly one id, plus updates arriving before the snapshot, in 2 of 3 runs. The socket closes after 60 s with no traffic, not the documented 130 s. The undocumented {"action":"ping"} gets a {"e":"pong"} reply. | none. MAX publishes no perp index, mark or funding. The only reference price is GET /api/v3/wallet/m/index_prices, an M-wallet collateral index with 13 keys that changes once a minute and has no published formula. No anchor poller is recommended, and a mark of 0 would be refused as anchor_no_mark. | The operator is Modernity Financial Holdings, Ltd. (Cayman), which authorizes Modernity Financial Technologies Co., Ltd. (Taiwan) to run the site. Terms §2.2 say persons may be unable to use part or all of the service by citizenship or location, "including but not limited to Japan, United States and European Economic Area". Whether US residents can open accounts is not verified. From this host: REST max-api.maicoin.com answered 200 through Cloudflare SEA, and WS max-stream.maicoin.com opened in 646 to 710 ms with no refusal. The website max.maicoin.com, including the fee page /docs/fees, returned Cloudflare 403 "MaiCoin block the request by the security rule". support.maicoin.com also returned 403, and WebFetch got 403 on both. | spot only |
| 11 | BtcTurk / Kripto, [`../profiles/btcturk/`](../profiles/btcturk/) | btcturk | spot | none | 1400 | obdiff on wss://ws-feed-pro.btcturk.com/ (one URL for all 379 pairs). The subscribe frame is [151,{type:151,channel:"obdiff",event:"BTCUSDT",join:true}]. A 431 snapshot of up to 100 levels per side arrives on subscribe, 191 to 383 ms after the subscribe frame. After that come 432 deltas: CP 0 replaces the amount, CP 1 adds a level, CP 3 deletes one. The window is a fixed 100 levels. CS goes up by exactly 1 per frame within one subscription, with 0 gaps in about 24k frames. CS is not shared across channels or connections, and the REST book has no sequence, so the only way to start a book is to subscribe. There is no checksum and no timestamp on book frames. Deflate is not negotiated. The server sends a protocol ping every 15 s and closes a socket that does not answer at about 45 s. Both book channels batch to about 764 ms per pair. Unknown or lowercase pairs get ok:true and then nothing. 379 pairs ran on one socket at about 166 frames per second. | none: there is no index, mark or funding. The only reference prices are the bulk GET /api/v2/ticker (379 rows, about 110 KB, median about 265 to 279 ms, rows 0.25 to 1.65 s old on arrival) and the graph-api OHLC candles. Neither is an index. | Operator: BtcTurk Kripto Varlık Alım Satım Platformu A.Ş. (Turkey). It serves Turkish citizens (NVI-verified) and 'Global accounts'. The public register-countries call lists 62 countries, and the US is not among them. TRY and EUR can only move through Turkish bank accounts in the holder's own name. From this host: api.btcturk.com gave 200 on every public call, and wss://ws-feed-pro.btcturk.com gave 101. docs.btcturk.com, kripto.btcturk.com and pro-bff.btcturk.com gave 200. www.btcturk.com and the btcturkpro.zendesk.com help center gave 403 Cloudflare challenges (cf-mitigated: challenge, and 'Just a moment...'), and WebFetch got 403 as well. | spot only |
| 11 | BitTrade, [`../profiles/bittrade/`](../profiles/bittrade/) | bittrade | spot | none (CCXT bittrade.js line 34 swap false and 0 swap markets in loadMarkets. The only leveraged product is a BTC/JPY CFD at up to 2x that the API does not serve) | 1000 | Recommended: market.<symbol>.mbp.150, which BitTrade does not document but CCXT Pro uses. It carries 150 levels per side as deltas in 100 ms batches, with no snapshot on subscribe. The snapshot comes from a {"req"} on the same socket, answers in 103 to 133 ms and lags the stream, so deltas must be cached and aligned. A burst of 45 reqs got 21 refusals with 429, while 44 of 45 were answered with no refusal when paced at 10 a second, and daijpy never answered. Sequence rule: prevSeqNum equals the previous seqNum, with steps of 1 to 81. There was 0 gap over about 13k deltas in all runs but one, which had 1 unexplained gap. There is no checksum. Every frame, pings included, is gzip inside a binary frame, and permessage-deflate is not negotiated. Alternatives: mbp.refresh.20 sends a whole 20-level book on change every 100 ms and matched the mbp.150 top 20. The documented depth.step0 sends a whole 150-level snapshot on subscribe and then about every 1 s. mbp.5 and mbp.20 are acknowledged and then stay silent. | none: no index, no mark, no funding rate, interval or next funding, and no clamps. The only bulk call is GET /market/tickers (45 rows, 8.2 KB, about 114 to 122 ms median), which has only last, bid and ask. The only reference price is the dealer's own buy and sell quote on wss://api-cloud.bittrade.co.jp/retail/ws, which was not probed. No anchor poller is recommended. | Only people living in Japan may open accounts. Anyone with a US tax obligation and foreign PEPs are refused, so US persons may not trade. Public REST api-cloud.bittrade.co.jp returned 200 on every call through the Cloudflare YVR edge, with a warm time of about 108 ms and no geoblock. Public WS wss://api-cloud.bittrade.co.jp/ws opened in 427 to 503 ms on all 29 sockets with no refusal. The help center bittrade.zendesk.com returned 403 with a Cloudflare challenge. | spot only |
| 11 | Digital X, [`../profiles/digital-x/`](../profiles/digital-x/) | none | spot | none. It has 227 KRW spot pairs only (193 launched, 34 stopped). The Open API has no derivatives endpoint, the site's page manifest has no futures page, and it is not in CoinGecko's derivatives list of 113 exchanges | 0 | `orderbook` on wss://ws-api.digitalx.miraeasset.com/v2/public (the old wss://ws-api.korbit.co.kr/v2/public also works). 30 levels a side. The first frame carries snapshot:true. After that every frame is a full top-30 replacement: no deltas, no zero-qty levels, frames at least about 100 ms apart. No sequence or update id and no checksum. Bids come descending and asks ascending. Sizes are in base coins. Frames are plain JSON text and permessage-deflate is not negotiated. The server sends a protocol ping every 30.0 s. All 193 launched pairs fit on one socket at about 150 frames/s and 2.2 KB/frame. A stopped pair sends one empty snapshot. An unknown symbol returns fail INVALID_SYMBOL | none. No index, mark, funding, interval or next-funding value exists, because there are no perpetuals. The only bulk price call is GET /v2/tickers: 227 rows, about 60 KB, about 266 ms. It carries last price and best bid/ask prices without sizes, so no anchor poller is recommended | Only verified Korean residents with a linked real-name bank account (Shinhan) can trade. Terms Art. 5 ③ 1 lets it refuse applicants under 19, non-residents and foreign corporations. FAQ Q5 and Q10 say new KYC is restricted for foreigners and non-residents, so US persons cannot trade (an inference: no rule names the US). From this host near Seattle through Cloudflare: every public REST call returned 200 and the public WS opened with 101 in 548 to 737 ms. No geoblock and no refusal | spot only |
| 5 | HashKey Global, [`../profiles/hashkey/`](../profiles/hashkey/) | hashkey | perpetuals | USDT-M 2 (BTCUSDT-PERPETUAL, ETHUSDT-PERPETUAL). The USD-margined BTCUSD-PERPETUAL was delisted on 2026-09-04, and it is the stale third pair on CoinGecko. There are no USDC-M or coin-M perpetuals, no dated futures and no options. Spot has 31 USDT pairs. | 600 | v2 `depth` on wss://stream-glb.hashkey.com/quote/ws/v2 sends the whole book in every frame, at 25 to 91 levels a side because these books are shallow. The documented cap is 200 levels. Frames come about every 100 ms and stop for up to 5.6 s on a quiet book. There is no snapshot on subscribe: the first frame arrives on the next book change, 203 ms to 3 s later. The version `v` always rose, but no gap rule is needed. There is no checksum. Frames are JSON text and deflate is not negotiated. v2 takes one symbol per subscribe frame. The client must send {"ping":ms} every 10 s, because v2 closes the socket after about 31 s without it. v1 (/quote/ws/v1) sends the same full book at about 300 ms, with an f:true snapshot about 100 ms after subscribe, but it arrives about 130 to 160 ms later than v2. | Three calls. GET /quote/v1/index is bulk but keyed by index name (BTCUSDT = underlying + index field), not by the market id. GET /quote/v1/markPrice?symbol=<id> needs one call per contract, because there is no bulk mark. GET /api/v1/futures/fundingRate?timestamp=<ms> is bulk and returns the upcoming `rate` and `nextSettleTime`. It is documented with an API-key header but answered with no key. Index, mark and funding rate exist on the wire. Next settlement exists. The interval does not: it is 8 h at 00, 08 and 16 UTC from the docs and 100 history rows. The index is an equal-weight basket of Binance, OKX, Bybit, Coinbase and Kraken, so it is not self-referential. The basket appears only in the undocumented v1 WS `index` topic. The mark is the median of three prices: Price 1 (index times the funding-adjusted term), Price 2 (index plus a 5-minute basis) and the last trade. No clamp on the mark premium is named. The mark ran 440 to 924 ppm under the index on BTC in both polls. The funding cap is ±0.75 × the maintenance margin rate, about ±0.37 %. The rate is interest 0.01 %/8 h plus a premium clamp of ±0.05 %. The funding rate changed about once a minute. | The operator is HashKey Bermuda Limited, under a BMA Class F licence. Account opening refuses 91 of 253 regions, including the US, Puerto Rico, Hong Kong and mainland China, so US persons may not trade. The perpetuals also need HBML's own eligibility. From this host near Seattle, api-glb.hashkey.com (CloudFront SEA) answered HTTP 200 to every public call. The only 4xx replies were the probes' own bad requests. Both public WS versions opened in 314 to 529 ms with no refusal. The help centre HTML at help.hashkey.com returned a 403 Cloudflare "Just a moment..." challenge, but its Zendesk JSON API answered 200. | fits as is |
| 5 | Bitazza, [`../profiles/bitazza/`](../profiles/bitazza/) | none | spot | none on the public API. GetInstruments lists 307 instruments, all InstrumentType Standard spot (273 running), and GetProducts shows MarginEnabled false on 157 of 157. Bitazza Global does sell USDT-margined futures in its app (launched 2023-05-25, "up to 125x" and "funding rates" in 2025 blog posts, and a "Futures Trading" FAQ tab still there on 2026-09-23), plus CFD derivatives (XAU/USD up to 200x, 24/5). Neither has a public API, catalog or fee page, so their count could not be probed. | 2500 | SubscribeLevel2 on wss://apexapi.bitazza.com/WSGateway/, an AlphaPoint gateway with {m,i,n,o} frames whose payload is a JSON string. Depth can be any number, and one instrument goes in each call. The snapshot is the subscribe reply itself (m 1, bids descending then asks ascending, one MDUpdateId). Updates arrive as Level2UpdateEvent frames, one instrument each, with ActionType 0/1/2 levels applied in array order. A changed level often comes as a delete then a new level at the same price. MDUpdateId is per instrument and rises but skips values, so no gap rule exists. The socket-wide event i counter went backwards 57 times across 273 subscriptions. There is no checksum and no compression. Books change about once a second, with a minimum gap of 97 ms. At Depth 20 the BTCUSDT book keeps phantom levels inside the touch (0 to 1 of 4 checks exact). Depth 500 matched an in-socket GetL2Snapshot in 15 of 16 checks, and the one miss was a 2-id timing gap. There is no server ping, and client Ping gets {"msg":"PONG"}. Sockets stayed open 120 s even when silent. | none. Bitazza publishes no index, mark, funding, interval or next funding on any call or channel. The only bulk calls are Level 1: GET /AP/GetLevel1Summary?OMSId=1 returns 334 rows, about 240 KB, median 435 to 440 ms, and /AP/summary returns 307 rows, 85 KB. Instruments carry undocumented PriceCollarPercent 3 and PriceCollarIndexDifference 5 fields, but no index endpoint exists. No anchor poller is recommended. | Global is run by Bitazza International Limited (BVI). Its User Agreement of 18 Sep 2026 excludes only sanctioned persons and names no country, so US persons are not publicly specified. Thai residents are sent to Bitazza Thailand (Bitazza Company Limited, which describes itself as licensed by the Thai MoF and regulated by the SEC, and trades THB books). Both entities run on one AlphaPoint engine. From this host near Seattle, REST at https://apexapi.bitazza.com:8443/AP answered 200 (warm about 220 ms, no rate-limit headers, 20 calls in about 4.9 s all 200). Both WS gateways opened (apexapi.bitazza.com and apexapi.bitazza.co.th behind Cloudflare) with no geoblock. The bitazza.com web pages returned 403 Cloudflare "Sorry, you have been blocked" to curl and WebFetch but 200 to a Node request with user agent "Mozilla/5.0 (probe)", so this is a user-agent rule, not a geoblock. futures.bitazza.com returned 404 "Not Found!". | spot only |
| 5 | Bitfinex, [`../profiles/bitfinex/`](../profiles/bitfinex/) | bitfinex | perpetuals | USDt-settled 75 (includes 8 equity index, 2 volatility index, EUR, GBP, XAUT, XAG, XPT, XPD and UKOIL perps), BTC-settled 4, paper-trading TESTUSDT 14. The conf list has 93 in total and the status call returns 91. All live on 2026-09-23 03:14 UTC. | 0 | wss://api-pub.bitfinex.com/ws/2, channel book with prec P0 (5 significant figures, which is full price precision), freq F0, len 25 (1/25/100/250 allowed). A snapshot arrives 0 to 33 ms after the subscribe ack, followed by single-level updates [price,count,amount] (count 0 with amount 1 or -1 deletes). There is no per-symbol sequence. Conf flags 196608 turn on OB_CHECKSUM (signed CRC32 of the top 25 levels per side, sent about every 2.5 s on a live book, 972 of 972 matched) and SEQ_ALL (beta, one counter per socket across all channels plus hb and cs, 0 gaps). Heartbeat every 15 s per channel. A socket with no subscription is closed at 60 s. The wire accepts 36 subscriptions per socket, and the docs say 25 and 30. No permessage-deflate. | GET /v2/status/deriv?keys=ALL returns 91 rows (about 18 KB) in one call, 90 req/min. mark = MARK_PRICE (pos 15, the BFX Composite Index). There is no separate index: SPOT_PRICE is stale or a copy of the mark. fundingRate = CURRENT_FUNDING (pos 12), the rate for the next settlement, fixed 8 h ahead and verified on 3 settlements. nextFundingAt = NEXT_FUNDING_EVT_MTS (pos 8, ms). No interval field, 8 h constant for every contract. Clamps: ±0.05% dead band, cap 0.25% on 86 rows, 2.5% SOL, 0.5% CRV, none on 3 index perps. The origin writes every 3 s. Cloudflare caches the plain URL for about 5 s, so rows arrive up to 9.8 s old. A changing query parameter gives rows at most 5.0 s old, with a median of 206 ms per request. | Operator is Bitfinex Derivatives El Salvador S.A. de C.V. (since 2025-01-07, BVI law). Open only to Intermediate-verified users in eligible jurisdictions. Prohibited: US persons, Canadian, Spanish and South African persons, non-exempt UK and Japanese persons, BVI citizens and residents, the Venezuelan government, and sanctioned jurisdictions. US persons may not trade. From this host (near Seattle), REST api-pub answered 200 on every call (behind Cloudflare, errors are documented 500 [error,10020,...]) and WS opened in 509 to 572 ms with no refusal. The Help Center HTML answered 403 (Cloudflare challenge) and was read via its public Zendesk API. | fits with a named change |
| 5 | GroveX, [`../profiles/grovex/`](../profiles/grovex/) | none | spot | none | 8000 | market_<symbol>_depth_step0 on wss://ws.grovex.io/kline-api/ws, one sub frame per channel with no ack. It sends a whole-book snapshot on subscribe, then another whole snapshot when the book changes (at most about once a second) and an unchanged republish about every 11 s. It never sends the incremental frames the docs describe: 0 across two 75 s runs, and 1,091 of 1,091 frames were snapshots across 100 markets. btcusdt held 46 to 61 levels per side, and the asks/bids parameter does not cap it. No sequence number, no checksum. Bids arrive under the key `buys`, sorted descending. Every data frame is a binary gzip stream inside the frame, and permessage-deflate is never negotiated. | none: GroveX publishes no index, mark, funding rate, interval or next funding. For pairs Binance also lists, the REST market_dept and newOrderBook books are a copy of Binance's spot book refreshed every 420 s, which is not GroveX's own book and not an anchor. | The Terms of Service (effective 2026-02-11, section 3.1) exclude US persons, US and US-territory residents, and anyone in a jurisdiction where the service would be unlawful. The operator is GROVEX PTY LTD, ABN 13 667 226 459, Victoria, Australia. From this host near Seattle, public REST at openapi.grovex.io returned 200 and the WebSocket upgrade returned 101, both through Cloudflare SEA, with no geoblock, challenge or refusal. | spot only |
| 5 | Upbit, [`../profiles/upbit/`](../profiles/upbit/) | upbit | spot | none | 500 | `orderbook` on wss://api.upbit.com/websocket/v1. Every frame is a whole 30-level book, SNAPSHOT first and then REALTIME, with no deltas, no sequence id and no checksum. The `.{n}` suffix narrows it to 1, 5 or 15 levels, and an unsupported n falls back to 30. Busy KRW pairs publish on a fixed 100 ms grid, while USDT-BTC does not. Thin sides are padded with price 0 and size 0 slots. Frames are binary and hold JSON, with numbers such as 1.16539E8. Deflate is used only if the client asks for it. There is no ack. Unknown or lower-case codes are ignored silently, a bad frame gets an error and a close with 1000, and a second subscribe replaces the first. 855 pairs ran on one socket at about 790 frames/s. An idle socket closed at about 60 s, although the docs say 120 s. A text PING starts {"status":"UP"} every 10 s. | none. There is no index, mark or funding. The only prices published are last-trade tickers from GET /v1/ticker/all?quote_currencies=KRW/BTC/USDT: 227 KB for the 289 KRW rows, median about 180 ms. The pair catalog also carries a per-pair GLOBAL_PRICE_DIFFERENCES caution flag, and the threshold behind it is not published. | Who may trade: residents of Korea only. An account needs a phone on a Korean carrier and a Korean bank account in the member's own name, plus identity checks with a Korean ID or an alien registration card and proof of residence (passports are not accepted). KRW trading also needs a K Bank account. People from FATF, UN or OFAC high-risk countries are excluded. No rule names US persons, but a US person without Korean residence documents cannot pass the checks. From this host: every public REST call returned 200 with no geoblock (api.upbit.com is a CNAME of api.upbitit.cool, cold about 540 ms, warm about 171 to 176 ms). The WebSocket opened in 490 to 566 ms with no refusal. A request with an Origin header is moved into a group=origin limit of one request per 10 s. | spot only |
| 6 | Byte Exchange, [`../profiles/byte-exchange/`](../profiles/byte-exchange/) | none | spot | none with real funds. The only perps are 124 demo paper markets under /api/v1/perp-demo (102 USDT perps, 11 USD index, 10 tokenized equity or gold, ETHBTC), all quoted in USDT with 1 h funding and a 5 bps taker. The real "Byte book" perp is a house-counterparty product filled at the venue's own mark. /perp/status shows clearing_rail "pending", /futures redirects to /demo, and access opens "region by region". Not in CoinGecko's derivatives list of 214 venues. | 2000 | No named channel. Each market is subscribed with {"action":"subscribe","symbol":"BTC_USDT"}. Every book_update frame is the whole book, up to 100 levels a side, and only the first frame carries snapshot:true. There are no deltas. update_id rises by exactly 1 per frame per market (0 jumps in about 24k frames) and equals the REST last_update_id, with REST levels matching WS levels at the same id. No checksum. Frames arrive in bursts about once a second, 3 to 5 per second per market. Compression is raw deflate inside binary frames (a 2.2 KB wire frame inflates to 11.9 KB) and permessage-deflate is not negotiated. Inflate plus parse costs 143 to 172 µs median per frame. Ten default books are pushed to every socket unasked. The cap is 30 subscriptions per connection, defaults included, and about 10 subscribes per second are accepted. A price can appear twice on one side. | none. The spot market publishes no index, mark or funding. The perp endpoints (/perp/status, /perp/disclosures, /perp-demo/markets) carry only status, text, and demo funding rates with a 3600 s interval. No mark or index number exists, and /perp/mark, /perp/funding and /perp/ticker return 404. No anchor poller is recommended. | The ToS entity is "ByteExchange Limited" under Turkish law, and CoinGecko names Bytedex Technologies OU of Estonia. The ToS excludes the USA, mainland China, Cuba, Iran, North Korea, Syria, Crimea, Donetsk and Luhansk, so US persons may not trade. No region can trade real perps yet. From this host, REST answered 200 on every public call via Cloudflare SEA (warm median about 190 to 213 ms, since the origin is about 170 ms away). The WS handshake is refused with 403 "Origin header required" when no Origin is sent and 403 "Origin not allowed" for a foreign origin. It opens with 101 when Origin: https://bexc.io is sent. docs.bexc.io answers 302 to a Cloudflare Access staff login whose metadata geolocates this host as CA. No region refusal was met. | spot only |
| 6 | Phemex, [`../profiles/phemex/`](../profiles/phemex/) | phemex | perpetuals | USDT-M 116, USDC-M 10, coin-M 8 | 600 | orderbook_p on wss://ws.phemex.com, 30 levels at about 20 ms (the depth argument also takes 1, 5 or 10, and [sym,true] gives the full book at about 100 ms). A snapshot on subscribe, then a fresh snapshot for each symbol every 60.0 s. sequence is a counter shared by groups of symbols. Per symbol it only rises, and usually by more than 1, so no gap rule exists. No checksum. Plain JSON text, and permessage-deflate is not negotiated. Deltas are not always sorted, so apply them by price. | Two bulk calls. GET /md/v3/ticker/24hr/all (41 KB, 127 rows) has indexRp, markRp and fundingRateRr. GET /contract-biz/public/real-funding-rates?pageSize=200 (27 KB, 134 rows) has fundingRate, fundingInterval in seconds (8 h or 4 h), nextfundingTime in ms, and a per-contract cap and floor (±2% on 106 rows, ±0.02% on 14 TradFi rows). The rate is the running estimate for the next settlement. The mark is median(index×(1+F×τ), index + 15-minute average basis, last price), so inside that band it is the contract's own last trade: equal to last on 29-42% of rows. No other mark clamp is published. The public basket call /public/index-sources shows 11 single-source baskets that are another venue's perp, and Binance futures sits in 64 baskets. CloudFront served 30 of 60 ticker polls from cache in the rerun. | Terms (Phemex Poland sp. z o.o., updated Jul 10, 2025) exclude 45 Restricted Territories, among them the US, UK, UAE, Australia, Hong Kong and four Canadian provinces. US persons must declare they are not US persons, so they may not trade. From this Seattle host every public REST call returned 200 through CloudFront SEA73, apart from deliberate error cases: bad symbol gave 500 with 6001, unknown path gave 403, and the signed fee-rate call gave 401 "Miss Api Key". WebSocket wss://ws.phemex.com returned 101 on all 34 probe sockets, with no geoblock. | fits with a named change |
| 6 | P2B, [`../profiles/p2b/`](../profiles/p2b/) | p2b | spot | none (173 spot markets: USDT 114, USDC 29, BTC 13, USD 12, ETH 3, BNB 2. No perpetual, dated future, option or margin on the site, API docs, CCXT flags or CoinGecko derivatives list) | 2000 | depth.subscribe with params [market, limit 1 to 100, interval "0"] on wss://apiws.p2pb2b.com/. One market per socket, because a second depth.subscribe replaces the first (seen in 4 runs). Up to 100 levels. A full book (params[0]=true) arrives on subscribe, then a refresh every ~60 s on busy books only. Partial level changes come batched on a fixed 1 s tick, and "0" deletes a level. No sequence, checksum or timestamp, so gaps cannot be detected. Levels are best first. Sizes are strings in the base currency. No compression: deflate is not negotiated. | none. P2B publishes no index, mark, funding rate, interval or next funding. The only reference is REST tickers (bid, ask, last, 24 h stats), served from a ~10 s Varnish cache. There are no clamps. No anchor poller is recommended. | Terms of Use (operators TECHTONIC SOFTWARE S.A., SMART DIGITAL SOLUTIONS LIMITED, DIGITAL ONE SOFTWARE LIMITED, P2B SOLUTIONS LLC, Estonian law) bar 26 Restricted Locations, including Russia and Belarus. P2B also "may restrict" the US, Canada, UK, Australia, France, Japan and China. US persons are not barred outright but may not trade tokens that could be securities. From this host near Seattle, REST api.p2pb2b.com answered 200 on every public call and WS apiws.p2pb2b.com opened in 352 to 495 ms. There was no geoblock or challenge, via the Cloudflare SEA/YVR edge. | spot only |
| 6 | WEEX, [`../profiles/weex/`](../profiles/weex/) | weex | perpetuals | USDT-M 995 (577 crypto PERPETUAL, 418 TradFi TRADIFI_PERPETUAL: 350 stocks, 40 indices, 14 metals, 7 forex, 4 commodities, 3 pre-IPO). No coin-M or USDC-M perps, no dated futures, no options. Only 239 of the 995 accept API orders (apiTradingSymbols: 174 crypto, 65 TradFi). CoinGecko shows 1,048 perps against 995 in the catalog. | 800 | <SYMBOL>@depth200 on wss://ws-contract.weex.com/v3/ws/public, 200 levels per side (depth15 is the only other level and is below the engine's 20). A depthSnapshot arrives on subscribe, then deltas conflated to one frame per 500 ms (median E gap 500 ms). The chain rule is U == previous u, not u+1: 0 exceptions in 27,146 deltas. No checksum. Levels arrive ordered, "0" deletes, and a quiet book sends nothing. Sizes are base coins, equal to REST at the same update id. Frames are plain JSON text, and deflate is used only when the client offers it. Docs cap 100 streams per connection (101 was accepted) and 20 connections per IP. The server sends a ping once a minute, answered with {"method":"PONG","id":n}. The docs require a User-Agent header, but a socket opened and delivered without one on 2026-09-23. | GET /capi/v3/market/premiumIndex (bulk, weight 1, 228 KB) returns indexPrice, markPrice, forecastFundingRate (the upcoming rate), lastFundingRate (the last settled rate), collectCycle (60, 240 or 480 minutes) and nextFundingTime (Unix ms). Its mark and index refresh only once a minute, but its `time` field advances every second, so a reader that trusts `time` takes minute-old prices as fresh. Live index and mark come only from GET /capi/v3/market/ticker/24hr (bulk, weight 40), so the poller should read both calls every 2 s, which is 205 of the 500 weight per 10 s. No mark clamp was seen: premiums ran up to ±30% (HUND +31%, ONE −24%). The mark equals the last trade on about 44% of contracts. TradFi indexes stayed frozen while the US market was closed (AAPL +15.7%, META +23%). Funding floors and ceilings are not published. DALUSDT reads nextFundingTime 28800000, which is 1970. | The Terms (7 Jul 2026, Saint Vincent and the Grenadines law) exclude the US, Canada, South Korea, mainland China, Hong Kong, Singapore, the UAE and sanctioned regions, so US persons may not trade. From the Seattle host every public REST call returned 200 via CloudFront SEA with no key, and every socket upgraded (101) and delivered, with or without a User-Agent. No geoblock was seen. | fits with a named change |
| 6 | GMO Coin Japan, [`../profiles/gmo-coin/`](../profiles/gmo-coin/) | none | perpetuals | JPY leverage (exchange margin, no expiry, no funding) 12: BTC/ETH/BCH/LTC/XRP/DOT/ATOM/ADA/LINK/DOGE/SOL/SUI _JPY. CoinGecko counts 5. There are no USDT-M, USDC-M or coin-M perpetuals and no dated futures or options. Spot has 17 symbols | 0 | wss://api.coin.z.com/ws/public/v1 `orderbooks`, one subscribe frame per symbol ({"command":"subscribe","channel":"orderbooks","symbol":"BTC_JPY"}). The server sends no acknowledgement. Every frame is a whole snapshot of 30 levels per side, pushed on a grid of about 505 ms when the book changes. An identical snapshot is resent 6 to 18 times per book per run, and on quiet books every 4.4 to 5.2 s. There is no sequence and no checksum. Bids descend and asks ascend. Sizes are base-coin strings. An undocumented "grouping":"1" field appears on every frame. Plain text arrives when deflate is not offered. If deflate is offered, the server negotiates permessage-deflate with no context takeover. Subscribes are limited to 1 per second per IP. The server sends a protocol ping at 60 s. A socket with no traffic is closed at 60 s with code 1006 | none. No public call returns an index, mark or funding rate. GET /v1/ticker (4.4 KB, 29 rows) carries only bid, ask, last, high, low, volume and a reply timestamp. Funding is replaced by a flat leverage fee of 0.04 % a day on every long and short held across 06:00 JST (21:00 UTC), valued at the trading day's close. That fee has no clamp or cap. The engine would refuse every GMO Coin leg as anchor_missing or anchor_no_mark. Leverage mids sat a median 301 to 1,484 ppm above GMO Coin's own spot mids on the five fee-free symbols | Only individuals aged 20 or over who reside in Japan, or Japanese-registered companies whose representative and trader reside in Japan, may trade. US persons may trade only if they reside in Japan. From this host near Seattle, public REST at api.coin.z.com (CloudFront, SEA edge) returned 200 on every call, with no geoblock and no challenge. Unknown symbols and paths returned 404 {"status":2,"messages":[{"message_code":"ERR-5207","message_string":"Not found"}]}. The WebSocket opened in 391 to 431 ms over nine sockets. The support site support.coin.z.com returned 403 with a Cloudflare challenge | blocked |
| 8 | Coins.ph, [`../profiles/coinsph/`](../profiles/coinsph/) | coinsph | spot | none. Checked three ways: (1) the API docs at docs.coins.ph have no futures section. (2) The Coins.ph web app's own futures catalog, GET www.coins.ph/future-api/v1/public/config/exchange-info, returned an empty symbolList. (3) CCXT 4.5.68 reports swap false and loads 0 swap markets. The sister brand Coins.xyz lists 3 USDT perpetuals (BTCUSDT, ETHUSDT, SOLUSDT), but it is a separate venue and CCXT has no class for it. | 1500 | Recommended: <lowercase symbol>@depth20@100ms on wss://wsapi.pro.coins.ph/openapi/quote/stream. Each frame is a full top 20 per side with lastUpdateId, and the first frame arrives 108 to 117 ms after subscribe, a cached push whose E can be up to 5.6 s old. It pushes only on a top-20 change (min interval about 200 ms, bursts on thin books). No sequence to track. Each frame equalled the book rebuilt from the diff stream at the same id on every check (both runs). A diff stream <sym>@depth@100ms also exists, paced at about 200 ms with U = previous u + 1 and 0 gaps, but it needs a REST snapshot, and the documented straddle check failed on USDTPHP in 2 of 3 runs. No checksum. Plain text JSON with perMessageDeflate off. The server negotiates deflate only when asked. Frames are not wrapped even on the ?streams= URL, so route on s (uppercase, equals CCXT market.id) and e. Unknown, closed and uppercase streams are acked with result null and stay silent. Keepalive: server protocol ping every 30 s, and {"ping":ms} is answered with {"pong":ms}. 71 symbols on one socket ran at 83 to 135 frames/s. | none. There is no index, mark, funding, interval or next funding. The docs mention an internal index for the PERCENT_PRICE_INDEX order filter, but no symbol carries that filter (0 of 184) and no call returns it. Only a per-symbol 5 minute avgPrice exists. No anchor poller is recommended. | Who may trade: Betur, Inc. and DCPay Philippines, Inc. (both registered with the Bangko Sentral ng Pilipinas) serve account holders of legal age with identity checks, "primarily for users in the Philippines". Excluded are 17 listed territories plus sanctioned jurisdictions (OFAC, UN and others). US persons are not named in the user agreement of 2026-04-16. Residency rules for foreigners were not verified. From this host: REST api.pro.coins.ph and WS wsapi.pro.coins.ph (Cloudflare, Seattle and Vancouver edges) returned 200 and 101 on every public call, with no 403, 418 or 429. | spot only |
| 8 | Zoomex, [`../profiles/zoomex/`](../profiles/zoomex/) | none | perpetuals | USDT-M 697 (234 tagged Stock, 4 Commodity, 73 Innovation Zone), USDC-M 0, coin-M (inverse, quote USD) 4: BTCUSD, ETHUSD, SOLUSD, XRPUSD. All Trading. CoinGecko shows 702. No dated futures, no options. Spot has 95 pairs. | 600 | orderbook.50.<symbol> on wss://stream.zoomex.com/v5/public/linear, with inverse on /v5/public/inverse and one family per socket. This is Bybit's v5 public protocol. Depths 1, 50, 200 and 1000 are accepted and 500 is refused. It sends a 50/50 snapshot on subscribe (175 to 191 ms), then deltas of [price,size] strings where size "0" deletes a level. Rule: u = last+1. There were 0 gaps in 144,461 and 165,011 deltas across all 697 perps on one socket, and no u=1 restart. No checksum. Levels arrive sorted (bids descending, asks ascending), with a window of 50. Sizes are in base coin, so contractSize 1 is right. Inverse sizes are in USD contracts, which contractSize 1 misdescribes. Frames are text JSON. permessage-deflate is negotiated only when the client offers it. The args cap is documented at 21,000 chars, but 28,028 were accepted. Throughput for 697 perps was a median 3.5k to 4.0k frames/s. One refused topic fails its whole subscribe frame. The server closes any socket that has sent nothing for about 10 s, so a feed needs {op:ping} every 5 s, not Bybit's 20 s. On 693 of 697 perps the stream IS Bybit's book relayed: same u, seq, ts, cts and levels, arriving a median of -5 to +10 ms against Bybit's own socket. Only BTCUSDT, ETHUSDT, SOLUSDT and GMTUSDT carry Zoomex's own book, with bursty updates and p90 gaps near 1 s. | GET https://openapi.zoomex.com/cloud/trade/v3/market/tickers?category=linear returns 353 KB and 697 rows, with a median of 299 ms and a max of 864 ms over 60 polls. It carries indexPrice, markPrice, fundingRate (fraction per interval, the upcoming rate), fundingIntervalHour (1, 4 or 8), nextFundingTime (Unix ms) and fundingCap (a per-contract cap, 19 values from 0.0025 to 0.05). Mark = median(index×(1+last rate×time to funding/8), index + 2.5 min MA basis, last trade), with no other clamp, and mark equals last on about 22 to 26 of 60 polls. Funding F = P + clamp(I−P, ±0.05%) with I = 0.01%/8h. There is no index basket endpoint (index-price-components answers 404), and the index equals Bybit's. Caveats: the bulk row holds Bybit's numbers for all 697, including the 4 own markets. Their own mark, rate, cap and OI come only from tickers?symbol=. For example BTCUSDT rate 0.00001427 against the bulk and Bybit 0.00002534, and cap 0.0027 against 0.00333. The inverse bulk call returns an empty list, so inverse is per-symbol only. The 403 limit means a 10 minute ban (600 requests per 5 s per IP). Several refusals are HTTP 400 text/plain rather than JSON. | Nobody from the US may trade, since the United States is on the excluded list. The other excluded regions are the EU, Singapore, Hong Kong, mainland China, Quebec, Seychelles, North Korea, Cuba, Iran, Crimea, Sevastopol, Sudan, Syria and Luhansk (Help Center, updated 2026-06-17). The operator is zoomex Technology Limited, CoinGecko gives the country as Seychelles, and Zoomex advertises "No KYC required for trading". From this host near Seattle: REST openapi.zoomex.com (Akamai) answered 200 on every public call, with a cold time to first byte of 235 ms. WS stream.zoomex.com (CloudFront) opened in 682 to 836 ms, with no geoblock or refusal. The retired wss://stream.zoomex.com/v3/public answered HTTP 404. The Help Center HTML pages answered 403, while the Zendesk Help Center API answered 200. | fits with a named change |
| 8 | CoinTR, [`../profiles/cointr/`](../profiles/cointr/) | none | spot | none. The API docs describe USDT-FUTURES, COIN-FUTURES and USDC-FUTURES, copied from Bitget V2. On 2026-09-22 every /api/v2/mix/market call answered HTTP 400 {"code":"40404","msg":"Request URL NOT FOUND"}, and a socket subscribe with instType USDT-FUTURES answered 30001 "doesn't exist". CoinGecko's derivatives list carries "CoinTR Pro (Derivatives)" (id cointr_derivatives), but that record answers 404 "market not found". Spot has 263 symbols: 134 USDT, 128 TRY and 1 SUSDT. 261 are online and 2 are gray. | 1200 | Spot "books" on wss://ws.cointr.com/v2/ws/public, argument {"instType":"SPOT","channel":"books","instId":"BTCUSDT"}. It sends a full snapshot on subscribe (up to 200 levels per side, seen 3 to 200) and then updates. There is no sequence number (no seq or pseq key). Each update carries a CRC32 checksum over the top 25 levels, interleaved and computed on the wire strings, and it matched on every update: about 51k over 2 batch runs of 134 pairs, 2 book runs and 3 sync runs. The snapshot's own checksum is 0. Levels are ordered best first. Some updates carry no levels. Frames are plain JSON text and the server does not negotiate permessage-deflate. Keepalive is the string "ping" answered by "pong". A socket with no client traffic closed at 60 s with code 1006, although the docs say 30 s. One socket served all 134 USDT pairs at 414 to 415 frames/s, about 1 MB/s. books1/5/15 exist with checksum 0. | none. CoinTR publishes no index, mark or funding. The documented mix calls (contracts, tickers, current-fund-rate, funding-time, symbol-price, history-index/mark-candles) all return 40404. The only reference prices are the spot ticker's lastPr, bidPr and askPr. | Only people who can pass CoinTR's KYC can trade: a new-type Turkish Republic ID card read by NFC plus an e-Devlet residence address code. No other ID path is documented, so a US person without a Turkish ID cannot open an account, and no page names a US exclusion. The operator is COİNTR Kripto Varlık Alım Satım Platformu A.Ş. (formerly METX). It is on SPK's "Faaliyette Bulunanlar Listesi", which SPK says does not mean it is authorised. From this host, public REST at api.cointr.com (Cloudflare, YVR then SEA edge) returned HTTP 200 at about 200 ms. The public WS opened in 779 to 993 ms and delivered with no refusal or geoblock. The legacy api.cointr.pro answers 404 on every path and stream.cointr.pro does not resolve. | spot only |
| 8 | Bithumb, [`../profiles/bithumb/`](../profiles/bithumb/) | bithumb | spot | none (493 spot markets: KRW 480, BTC 13, no USDT or USDC quote. CCXT swap false at bithumb.js line 30. Not among CoinGecko's 113 derivatives venues) | 2500 | orderbook on wss://ws-api.bithumb.com/websocket/v1 (Akamai). Every frame is a whole book of at most 15 levels, first SNAPSHOT then REALTIME. The ".30" suffix still gives 15, short of the engine's 20. There are no deltas, no sequence id and no checksum. Units pair the i-th ask with the i-th bid. A thin side is padded with price 0 and size 0, and sizes print with 4 decimals, so a live price can show size 0 (1,457 such sides in 509 KRW-BTC frames). The ticket-array request gets no ack, and a second request replaces the first. Frames are binary and hold UTF-8 JSON. Deflate applies only when the client offers it. One socket served all 493 markets at a median of 936 to 968 frames/s. | none. There is no index, mark or funding anywhere. The nearest reference is GET /v1/market/virtual_asset_warning: a PRICE_DIFFERENCE_HIGH (gap to the global price) flag with no price, 2 to 3 markets flagged. A KRW to USDT conversion exists only through the KRW-USDT book, whose 1 KRW tick is about 745 ppm. | Trading is limited to adults (19+) with a Korean phone in their own name, a completed customer verification and one real-name KB Kookmin Bank account. Foreigners, including residents of Korea, cannot sign up, so a US person who is not a Korean national cannot trade. From this host, REST api.bithumb.com answered every call (errors come back as HTTP 200 bodies, plus 404 for an unknown path and 414 for a 4,264-character query). The public WebSocket opened in 312 to 848 ms with no refusal. Help center HTML pages returned 403, while the help center's Zendesk API returned 200. | spot only |
| 8 | HTX, [`../profiles/htx/`](../profiles/htx/) | htx | perpetuals | USDT-M 353 active (130 crypto, 223 TradFi: stocks, indices, metals, commodities) plus 4 suspended, coin-M 5 (BTC, ETH, XRP, TRX, DOGE). No USDC-M. Also 4 USDT-M and 8 coin-M dated futures, 605 spot, no options. | 600 | market.<code>.depth.size_20.high_freq with data_type incremental on wss://api.hbdm.com/linear-swap-ws (same IP as api.hbdm.vn). 20 levels, or 150 with size_150. Snapshot on subscribe about 280 to 290 ms after the subscribe frame. Sequence rule per stream: version must equal the previous version plus 1, including empty deltas. 0 gaps in 4,797 and 7,936 deltas on 6 streams and in 28,496 and 34,176 deltas on 150 streams. No checksum. Levels ordered, prices and sizes are JSON numbers counted in contracts, which equals CCXT contractSize. Compression: every frame is a binary gzip member (the server does not negotiate permessage-deflate). gunzip costs a median of 18 to 41 µs per frame, about 3 times JSON.parse. The server sends {ping} every 5 s and closes with 1003 'ping check expired' at about 20 s if no {pong} comes back. Client pings are never answered. A suspended symbol is acked ok and stays silent. | No single bulk call. Index: GET /linear-swap-api/v1/swap_index returns index_price and index_ts for every contract, republished about once a second, and readings were 0.6 to 2.2 s old on arrival. It also keeps 16 frozen rows for delisted contracts. Funding: GET /linear-swap-api/v1/swap_batch_funding_rate returns funding_rate for all contracts (the live current-period rate, moving about every 5 s) and funding_time (the next settlement, equal to settlement_date on 357 of 357 rows). estimated_rate and next_funding_time are null on all rows. Interval: settlement_period in hours from swap_contract_info (8 h on 248, 4 h on 93, 1 h on 16). Mark: no bulk call. The mark is only available per contract, as the 1-minute kline close from /index/market/history/linear_swap_mark_price_kline or from ws_index market.<code>.mark_price.1min. Reading the 130 crypto marks took 4.5 to 4.7 s at 10 requests in flight. The mark tracks the perp's own bbo mid, not the index, and its formula and clamp are not published. Funding clamps: documented BTC cap ±0.375% against ±0.3% on the wire (/v5/market/funding_rate, up to about 10 codes per call). Other contracts ±0.4875% to ±2%. The index basket is not public. | The HTX Platform User Agreement (description dated 2026-06-18, operator is an unnamed 'HTX Operators', HKIAC arbitration seated in Hong Kong) prohibits all services to users from mainland China, the US, the UK, every EU member state, Singapore, Hong Kong, Cuba, Iran, North Korea, Sudan, Syria, Venezuela, Myanmar, Crimea, Donetsk, Luhansk and Sevastopol, so US persons may not trade. From this host near Seattle every public REST call returned HTTP 200 (errors come back as 200 with status error, and only unknown paths returned 404), and every WebSocket URL opened (linear-swap-ws, swap-ws, ws_index, linear-swap-notification). There was no geoblock, refusal, 429 or Retry-After. | fits with a named change |
| 12 | BloFin, [`../profiles/blofin/`](../profiles/blofin/) | blofin | perpetuals | USDT-M 461, USDC-M 10, coin-M (inverse, settled in the base coin) 14. Counts come from an Internet Archive copy of the instruments reply dated 2026-09-16, because the live call is refused here. CoinGecko showed 482 perpetual pairs and 481 USDT tickers on 2026-09-22. | 600 | Documented only, because the handshake is refused here. `books` on wss://openapi.blofin.com/ws/public sends a 200-level snapshot on subscribe (prevSeqId 0), then deltas every 100 ms. Per instId, a delta's prevSeqId must equal the previous seqId, and ids skip values. No checksum and no compression are documented. books5 sends 5-level snapshots every 100 ms. Sizes are in contracts of contractValue base units, which is CCXT contractSize. The docs disagree on whether levels are strings or JSON numbers. Keepalive is the text 'ping' before 30 s of silence. The limits are 1 new connection per second per IP and 4,096 bytes of args per subscribe frame. | Documented only. GET /api/v1/market/mark-price without instId returns indexPrice and markPrice for every instrument. GET /api/v1/market/funding-rate without instId returns fundingRate and fundingTime (Unix ms). No bulk call carries the funding interval, which has to come from funding-rate-history one instId at a time (8 h, 4 h and 1 h contracts exist). The index basket, the mark clamp ('Last Price Protected' mechanism), the funding cap and whether fundingTime is the next settlement are not readable from here. CCXT fetchFundingRates is NotSupported. Both calls returned 403 from this host. | Operator is BLF Global Limited. Its 2024 Terms name the United States, Canada, Singapore, China Mainland and about 35 other places as Restricted Locations, so US persons may not trade. From this host near Seattle, every public REST path (live and demo), both public WS URLs, docs.blofin.com, blofin.com/en/fees and www.blofin.com returned HTTP 403 from Cloudflare (SEA or YVR edge, cfOrigin dur=0), in 22 to 170 ms. Each refusal was a 5,313-byte restricted-region page ('your IP address is from one of BloFin's restricted countries or regions'). CCXT loadMarkets throws ExchangeNotAvailable. | blocked |
| 12 | Deepcoin, [`../profiles/deepcoin/`](../profiles/deepcoin/) | deepcoin | perpetuals | USDT-M 348, coin-M inverse 5 (LTC, ETH, XRP, BCH, LINK), all 353 live, no USDC-M, no dated futures or options | 600 | TopicID 25 on wss://stream.deepcoin.com/streamlet/trade/public/swap?platform=api, FilterValue DeepCoin_<BTCUSDT>_<info.tickSz> (only the exact tick size is served, CCXT Pro hardcodes _0.1), up to 60 levels pushed every 200 ms. It sends a snapshot (t=f) on subscribe, also sends one mid-stream, and a repeated subscribe forces a fresh one in about 170 ms. Deltas apply by price, V=0 deletes, arrays are unordered. There is no sequence number and no checksum. Frames are plain JSON unless the client offers permessage-deflate, which the server then accepts. Sizes are contracts, matching CCXT contractSize=ctVal on 20 of 20 levels in 24 REST compares. Pushes are sometimes dropped: with all 348 contracts on one socket, 8 to 26 books crossed per 45 s. With 35 per socket, 0 crossed. Keepalive is a text ping, and the server closes the socket 20 s after the last ping. | Three REST bulk calls. GET /deepcoin/market/mark-price?instType=SWAP returns mark only (markPx, 360 rows, median about 245 ms, row ts 0.5 to 5.3 s old at arrival). GET /deepcoin/trade/fund-rate/current-funding-rate?instType=SwapU returns the upcoming rate per interval, keyed BTCUSDT, 598 rows including 250 dead names. GET /deepcoin/trade/funding-rate?instType=SwapU returns settleInterval in seconds (8h 201, 4h 146, 1h 1) and nextSettleTime in Unix seconds. No REST call returns a live index: index-candles is per instrument and only the last completed minute. The index is published only as D on the WS TopicID 7 ticker, which also carries M (equals REST mark), E (equals the upcoming rate, although documented as previous) and PF (next settle). No mark clamp is documented. Funding F = P + clamp(I-P, ±0.05%), capped at (IM-MM)*75%. | DEEPCOIN LIMITED terms (H14) prohibit residents of the United States and its territories, Hong Kong, Malaysia, Cuba, Iran, North Korea, Crimea, Sudan and Syria, and a 2026-09-16 notice says no products are offered to US users. From this host near Seattle, www.deepcoin.com and its /docs answered HTTP 403 with the CloudFront body "Request blocked", and support.deepcoin.com does not resolve. api.deepcoin.com REST answered 200 through CloudFront POP SEA73 (warm 174 to 221 ms), and stream.deepcoin.com WS upgraded with 101 (open 551 to 660 ms) with no challenge. | fits with a named change |
| 12 | Koinpark, [`../profiles/koinpark/`](../profiles/koinpark/) | none | spot | none (no futures, margin or derivatives page in the site map or menu, and not among the 214 venues in CoinGecko's derivatives list) | 4000 | No documented WebSocket. The web client uses undocumented MQTT 3.1.1 over wss://konprklvewebsktwss.koinpark.com, one socket for all pairs. There are two kinds of pair. 154 own-book pairs (liq 0, including BTC_USDT, ETH_USDT and USDT_INR) use topic orderBookMatch_<pair>, which sends l2update deltas [side, price, amount] only on change, with amount 0 meaning delete. It sends no snapshot on subscribe, so it must be seeded from REST /publicApi/orderbook (full depth, 500+ bids). It has no sequence id, no checksum and no timestamp, so gaps cannot be detected. 61 pairs (liq 1) use orderbook_<pair>, which pushes a whole 20-level book every 10 s. That book is Binance spot at 0.8 times the size. Deflate is not negotiated. MQTT packets span WebSocket frames. A JSON text frame gets the socket closed with 1006, and every topic, unknown ones included, is granted QoS 0. | none. It is spot only, with no index, mark or funding. Socket tickers carry only inr_value and usdt_value, which convert the quote currency. No anchor poller is recommended. | Koinpark Private Limited (India, CIN U62099TN2023PTC162115, Indian law, INR rails UPI/IMPS/NEFT/RTGS) lets anyone 18+ trade once KYC is approved at its discretion. The Terms name no excluded region and do not exclude US persons by name, but whether KYC accepts a US person is not verified. FIU-IND registration is not verified. Terms 12.2 (k) and (o) forbid scraper bots and unauthorized algorithmic high-frequency scripts. From this host (Cloudflare SEA/YVR edge) every documented REST call on api.koinpark.com/publicApi returned 200, with RateLimit-Policy 1440;w=86400: one counter across all paths, which restarted after 21 minutes. The WebSocket upgrade returned 101 with subprotocol mqtt and CONNACK code 0. Nothing was refused. | spot only |
| 12 | BTSE, [`../profiles/btse/`](../profiles/btse/) | none | perpetuals | USDT-quoted multi-collateral 211 (131 crypto, 74 stock, 6 commodity), plus 4 dated futures. No inverse or USDC family. | 550 | update:<tradeCurrency>_0 (e.g. update:BTC-PERP_0) on wss://ws.btse.com/ws/oss/futures. It sends a snapshot of up to 50 levels per side on subscribe, then deltas. A delta applies only when prevSeqNum equals the last seqNum, and seqNum is always prevSeqNum+1. One batch run out of three had 8 gaps in 37,001 deltas. The docs also say to resubscribe on a crossed book. There is no checksum. Asks arrive worst-first in snapshots and unordered in deltas. Frames are plain-text JSON with string levels. The server never forces compression and negotiates deflate only when the client offers it. Text ping every 15 s gets a pong. An idle socket closes at 60 s. | Two calls. GET /futures/api/v2.3/price is legacy, 19 KB, 215 rows keyed BTC-PERP, and gives index and mark. Both republish about once a second (BTC index moved on 41 to 50 of 59 polls). GET /public-api/market/v1/ticker/24hr?types=["FuturesPerpetual"] (95 KB) gives fundingRate (the running estimate for the upcoming settlement), fundingIntervalMinutes (480 or 240) and nextFundingTime in ms. The obvious call, /public-api/market/v1/ticker/indices, is a 30 s cache and must not be used. Mark = median(Price1, Price2, last trade), where Price1 = index x (1 + rate x time left / interval). No clamp on the mark premium is published, and many marks sit exactly on Price1's funding carry. Funding = avg premium + clamp(interest - avg premium, +/-0.05%). No cap on the final rate is published. The index is a mid of spot books on BTSE, Binance, Bitget, Bybit, Gate, MEXC and OKX, with a 3% outlier rule. No basket call exists. | Access from this host: every public REST call on api.btse.com (Cloudflare) answered 200 or a documented 400, and both WS URLs opened in 325 to 446 ms with no refusal. Who may trade: the operating entity was not verified (CCXT and CoinGecko say British Virgin Islands). Services are unavailable in the US, Canada, Taiwan, the UK, Malaysia and Singapore, the EU is reverse-solicitation only, and 21 jurisdictions are prohibited. So US persons may not trade. | fits with a named change |
| 12 | Deribit Spot, [`../profiles/deribit/`](../profiles/deribit/) | deribit | perpetuals | USDC-M linear 129 (97 crypto, 23 equity, 5 equity ETF, 4 commodity, 1 crypto index, 1 pre-IPO), BTC inverse 1 (BTC-PERPETUAL), ETH inverse 1 (ETH-PERPETUAL), USDT-M 0. All 131 open and is_active on 2026-09-23 03:37 UTC. | 350 | book.{instrument}.100ms (raw needs auth, error 13778): every level with no depth limit, a snapshot on subscribe (type "snapshot", entries [new, price, amount]), then "change" deltas with new/change/delete. Sequence rule: prev_change_id must equal the last change_id of that channel. change_id is a counter shared across instruments, so never check +1. No checksum. Deltas arrive sorted (bids desc, asks asc). No compression unless the client offers deflate, which the server then accepts. 0 gaps in four runs, including 9,626 and 11,436 frames on all 131 books over one socket. One gap each on three USDC books in a fifth run. Linear amounts are base coins, and inverse amounts are USD. The USDC books arrived up to 2.8 s late at times and trailed REST by 241 to 1,579 ms in 6 of 11 reads. Alternative: book.{id}.none.20.100ms sends a full 20-level window each frame with no chain. | GET /public/get_book_summary_by_currency?currency=USDC&kind=future: one call, 73.7 KB, 174 rows, 129 perps, median 154 ms. It has index (estimated_delivery_price, equal to the ticker index_price), mark_price, and current_funding (the instantaneous 8 h rate as a fraction). funding_8h is the funding realised over the trailing 8 h, not the upcoming rate. Neither interval nor next funding exists, because funding accrues every millisecond and cash settles daily at 08:00 UTC, so the row takes fundingIntervalHours 8 and nextFundingAt 0. Damper is ±0.025% (±0.1% for PAXG and pre-IPO). Caps are ±5% USDC, ±0.5% BTC, ±1% ETH and ±2% pre-IPO. The reply republishes only about every 2 s (31 distinct creation_timestamp values in 60 polls) and is a median 1.4 s old on arrival. The inverse contracts need currency=BTC and currency=ETH calls. The basket is public via WS deribit_price_ranking, but 122 of 131 resolve to an opaque mda_index_source at weight 100. | Who may trade: Deribit FZE (Dubai, VARA licence L-2994) for qualified and institutional investors, DRB Panama for eligible retail, and Coinbase Bermuda as the institutional broker. Excluded: the United States, Canada, Japan, Russia, Belarus and others, with UK retail excluded and Panama and UAE retail limited to spot, so US persons may not trade. From this host: public REST at www.deribit.com/api/v2 returned 200 via Cloudflare SEA (cold 223 to 229 ms, warm 148 to 161 ms), with errors as HTTP 400 JSON-RPC bodies and no refusal. WS wss://www.deribit.com/ws/api/v2 opened in 437 to 519 ms on 19 sockets with no refusal. docs.deribit.com returned 200. The support.deribit.com help-center HTML returned 403 to curl and WebFetch, but its Zendesk JSON API returned 200. | fits with a named change |
| 7 | BitKan, [`../profiles/bitkan/`](../profiles/bitkan/) | none | perpetuals | USDT-M 723. That is the CoinGecko ticker count, and CoinGecko's headline says 726. All 723 are Binance USD-M contracts that BitKan brokers: 720 are TRADING on Binance and 3 are SETTLING. Coin-M is named in a help article, but 0 coin-M contracts were observed. There are no USDC-M contracts and no dated futures. | unknown | None. BitKan documents no WebSocket. The website's own socket, wss://s.btckan.com:8080/contract, offers only contract_mark_price and contract_trade to anonymous users, and no bundle names a book channel. A guessed contract_depth got no ack and no frames. The website loads its book from REST /proxy/v2/contract/quote/depth, which sits behind a Cloudflare challenge and refused this host. Socket data frames are zlib-deflated JSON inside binary frames, and permessage-deflate is not negotiated. Frames carry no sequence field and no checksum. Unknown pairs are acked with success and then stay silent. | No public bulk call. The undocumented website socket channel contract_mark_price works per contract, not in bulk. It carries index_price, mark_price, rate, next_time, prev_time, prev_rate and settle_price, and has no interval field (next_time minus prev_time gives 8 h). All of it is Binance's: rate equals Binance lastFundingRate and next_time equals nextFundingTime on 121 of 121 frames. Mark matches Binance rounded on 86 of 121 frames and index on 91 of 121, and the misses are timing. BitKan republishes every 1.3 to 1.7 s median, at most 2.5 s apart. Clamps are Binance USD-M's. The /proxy/v2 REST calls are behind the challenge. | Who may trade: a BitKan account holder (British Virgin Islands per CoinGecko) who also passes Binance futures KYC, because BitKan is Binance's official partner broker. Mainland China ID is accepted. BitKan's terms and restricted-region list are unreadable. US persons are not verified, but Binance's US exclusion would apply by inference. What this host got: every bitkan.com page and /proxy/v2 path returned 403 cf-mitigated challenge ("Just a moment...", SEA/YVR edges), including with a browser user agent and through WebFetch. help.bitkan.com returned 403 Cloudflare error 1034 Edge IP Restricted. api, docs and openapi.bitkan.com do not resolve (ENOTFOUND). The website socket wss://s.btckan.com:8080/contract opened in 727 to 803 ms and served public mark and trade subscriptions without auth. A plain GET on that port returned 426. | no public API |
| 7 | VALR, [`../profiles/valr/`](../profiles/valr/) | none | perpetuals | USDT-M 4 on VALR's own book (BTCUSDTPERP, ETHUSDTPERP, XRPUSDTPERP, SOLUSDTPERP), plus 21 inactive FUTURE rows (USDC, ZAR and delisted USDT perps). A separate product, VALR Perps, is USDC and routed to Hyperliquid. VALR says it has 200+ markets, but they could not be counted because every Perps route needs an API key. It is Hyperliquid's book, so it is out of scope. | 700 | OB_L1_DIFF on wss://api.valr.com/ws/trade carries the whole aggregated book with no level cap (XRP held 52 bids). An OB_L1_SNAPSHOT arrives 158 to 182 ms after subscribe. The per-pair sq must be exactly last+1: 0 gaps in 1,120 deltas over two runs. Every frame carries a CRC32 `cs` over the top 25 levels a side, built from the wire strings, and it matched on 1,128 of 1,128 frames. Frames are plain JSON unless the client offers deflate. No auth is needed, but unauthenticated sockets are documented to close after 15 minutes. A second SUBSCRIBE for the same event replaces its pair list. A silent socket closes at 60 s, so the client pings. | No single bulk call. GET /v1/public/marketsummary gives markPrice for all 4 perps (cached 5 s). GET /v1/public/futures/info gives estimatedFundingRate (a fraction per hour) and nextFundingRun in Unix ms (cached 60 s, cache age up to 56 s seen). The funding interval is not on the wire, and the docs say hourly. No REST route or socket event publishes an index. The socket's MARK_PRICE_UPDATE comes every 3 s. Clamps: the mark stays within 1.5% of the index, and funding is capped at 1% per hour with a floor that zeroes rates under 0.0001% per hour. /v1/public/* is documented at 30 requests per minute per IP, so a 1 s poll is not allowed. | Who may trade: futures come from VALR DAM (Pty) Ltd (FSP 54897) and are open to fully verified users in 'qualifying jurisdictions', which VALR does not list. VALR serves no residents of the US, Canada, India, Russia, Ukraine and 9 other countries, so US persons may not trade. From this host near Seattle: every /v1/public/* call returned 200. The WS at /ws/trade opened without a key in 209 to 240 ms over 12 opens, with no refusal. The Perps v1 routes returned 400 {"code":-11268,"message":"API key header missing: X-VALR-API-KEY"}. support.valr.com HTML pages returned 403 with a Cloudflare challenge, while its Zendesk JSON API returned 200. | fits with a named change |
| 7 | Bitrue, [`../profiles/bitrue/`](../profiles/bitrue/) | bitrue | perpetuals | USDT-M 726 (550 crypto shown on the web page, 176 TradFi equities, ETFs, indices, metals and pre-IPO names such as OPENAI and ANTHROPIC), USDC-M 38, coin-M 21 (inverse, quoted in USD). All are type E and status 1. No dated futures, no options. Spot is present with 1,697 CCXT markets. | 600 | Channel market_e_<base><quote>_depth_step0 on wss://fmarket-ws.bitrue.com/kline-api/ws. One socket carries USDT-M, USDC-M and coin-M. Every frame is a full snapshot of 30 bids and 30 asks, with no deltas, no sequence number and no checksum. The ts field is not monotonic and steps back by up to 7.6 s. There is no subscribe ack and no error reply for bad requests. Every frame, the ping included, is gzip inside a binary frame, and permessage-deflate is not negotiated. The server pings {"ping":<s>} every 10 s, and sockets that never answered the ping stayed open. Up to 100 streams per socket are recommended, and 100 ran without trouble. BTC books arrive about 6.9 s after the REST book shows them, and about 11.6 s on the web page's URL futuresws.bitrue.com. Only the first frame after a subscribe is fresh. | No bulk call exists. The official GET /fapi/v1/index?contractName=E-BTC-USDT (and /dapi for coin-M) serves one contract per call, with indexPrice, tagPrice (the mark), currentFundRate (the upcoming rate, always equal to nextFundRate) and remainingSecond. It has no interval field, and it answers in a median 193 ms. The undocumented web call futures.bitrue.com/fe-co-api/common/funding_rate_real_time?symbol=USDT returns rate, capitalFrequency (1, 4 or 8 h) and remainingSecond for all 726 USDT rows (38 for USDC, none for USD) in about 1 s, with no index or mark. The listed ±0.00375 funding limit is not a cap: KERNEL settled at -0.013178 per 4 h. The mark premium has no clamp: NESA read +44 % with its index frozen. The index includes Bitrue itself and its basket is not public. TradFi contracts show a frozen index and zero funding while their markets are closed. Funding intervals change without notice (ONE went 1 h to 3 h to 4 h). The socket carries no mark, index or funding channel. | The terms of straLink Innovations Technologies Limitada (Costa Rica, updated 2026-08-21) exclude the United States, Canada, China Mainland, Hong Kong, India, Singapore, the EEA and OFAC regions, so US persons may not trade. From this host near Seattle, every public REST call (fapi.bitrue.com through CloudFront SEA900, and futures.bitrue.com) returned HTTP 200. Both WebSocket hosts (Singapore ALBs) opened in 656 to 984 ms with no refusal. Help center HTML pages returned a Cloudflare 403 challenge, and the same articles returned 200 through the Zendesk article API. The docs page delivery.html returned 403 "your region is not supported", but a made-up path returned the identical page, so that page is the site's missing-file page and not a geoblock. | blocked |
| 7 | Pionex, [`../profiles/pionex/`](../profiles/pionex/) | none | perpetuals | 606 perpetuals, all TRADING: USDT-M 561 (<BASE>_USDT_PERP, includes tokenized stocks like AAPLX and commodities like XAU/WTI), coin-quoted 23 (9 ETH, 11 BTC, 3 SOL, e.g. BTC_ETH_PERP), USDT priced in a coin 22 (USDT_<COIN>_PERP, e.g. USDT_BTC_PERP). No USDC-M, no dated futures, no options. Spot also present (410 symbols, 338 enabled). | 500 | ORDERBOOK on wss://ws.pionex.com/wsPub (one URL for every family and spot): 100 levels per side, SNAPSHOT on subscribe 20 to 29 ms after the frame, then UPDATE deltas every 204 to 211 ms median on BTC/ETH. Sequence rule: UPDATE.prevNumber must equal the last number (number is a counter shared across symbols, it steps 13 to 58, not +1), 0 gaps over about 22,500 updates. No checksum. Payloads are uncompressed UTF-8 JSON sent as binary WS frames. permessage-deflate is negotiated only when the client offers it. Doc and wire differ in three places: deltas never refill levels past 100 (BTC book shrank to 80 to 91 levels), busy books stall about 10 s with the chain intact, and the field is data.timestamp, not timeStamp. One symbol per subscribe frame, limit 5 client messages per second per connection and 10 connections per IP. | GET https://api.pionex.com/api/v1/market/indexes (no symbol) returns 605 perps in one call: 99.8 KB decoded or 14.1 KB gzip, median 48 to 56 ms, weight 5. It has index (indexPrice), mark (markPrice, never 0), funding rate (nextFundingRate, the estimate for the next settlement) and next funding (nextFundingTime in Unix ms). It has no funding interval: intervals are 1, 4 or 8 h per contract (sample of 76: 29 on 8 h, 44 on 4 h, 3 on 1 h), read per symbol from GET /api/v1/market/fundingRates?symbol=&limit=2. Clamps: the index clamps each source to within 3% of the median. The mark has no published clamp (premiums seen up to 6,023 ppm). Mark = index + 5-minute moving average of Pionex's own perp basis. Funding = P + clamp(I - P, +/-0.05%) with no cap on the result (KERNEL settled -1.2358% on a 4 h interval). The WS topic INDEX carries the same fields, one symbol per subscription. | Operator is Marketa Trading Inc. Restricted Jurisdictions are Mainland China, Hong Kong, United States, Singapore, Afghanistan, Cuba, Iran, North Korea, Syria, UK, Canada, Netherlands, Spain and France, so US persons may not trade. KYC also refuses Japan, Austria and others. From this host near Seattle, api.pionex.com (Cloudflare) answered every public call: 200, with errors as HTTP 200 result:false bodies and unknown routes as 404. wss://ws.pionex.com/wsPub opened in 100 to 201 ms with no refusal. www.pionex.com pages (/en/fees, /en/vip, /blog/) and support.pionex.com answered 403 with a Cloudflare managed challenge, which also blocked WebFetch and headless Chrome. The support Zendesk API answered 403 'error code: 1034'. The docs site www.pionex.com/docs/*.md answered 200, so fee and help articles were read from Wayback snapshots. | fits with a named change |
| 7 | Webot, [`../profiles/webot/`](../profiles/webot/) | none | spot | none (GET /api/v1/common/symbols?type=PERP returns symbols null, type=FUTURES returns MARKET_PARAMETER_ERROR, and all 384 catalog rows are SPOT: 152 quoted in USD, 218 in USDT and 14 in USDC, with 298 traded in the last 24 h. CoinGecko's derivatives list of 214 venues does not name Webot) | 5000 | DEPTH on wss://ws.pionex.us/wsPub, which is undocumented by Webot and uses the Pionex-doc frame {"op":"SUBSCRIBE","topic":"DEPTH","symbol":"BTC_USDT","limit":20}. limit must be a number from 1 to 100 and cannot be left out on the wire. Every frame is a whole top-N book. There are no deltas, no sequence id and no checksum. There is no immediate snapshot: the first frame is the next push, 48 ms to 890 ms after subscribing on busy books and up to 9.5 s on an empty one. Busy books push about once a second (median gap 0.66 to 1.2 s), quiet ones up to 5.2 s apart, with identical repeats. The frame timestamp is 40 to 718 ms old on arrival. Levels come best first. Sizes are in base currency and matched the REST book on all 40 levels. The server PINGs every 15 s and closes at 60 s without a PONG. Each connection takes 100 topics, and a burst of more than 10 subscribes closes the socket for "rate limit". No compression unless permessage-deflate is offered. | none. Spot only: there is no index, mark or funding. Every Pionex futures anchor path answers 404 on api.webot.com (indexes, fundingRates, markKlines, indexKlines, openInterests, riskTable, bookTicker and bookTickers). The only bulk call is GET /api/v1/market/tickers, 384 rows of 24 h OHLC, volume and count with no bid or ask, so a Webot route would be refused as anchor_missing. | Who may trade: US residents of the states Webot serves, through Pionex Inc. (FinCEN MSB, NMLS #2284360). Its license page lists Alaska as Denied and has no row for Hawaii or New York, and the served-state list for KYC is dynamic. EEA residents trade through Pionew Ireland Limited (MiCA CASP, Central Bank of Ireland ref C496936). US persons may trade. A Pionex.US help center article is titled "Unavailability of API Key Feature on Pionex.US", but its body returned a 403 Cloudflare challenge to curl, WebFetch and headless Chrome. What this host got: REST on api.webot.com (Cloudflare SEA) and api.pionex.us (CloudFront SEA900-P10) answered 200 in 63 to 132 ms warm, with no geoblock. wss://ws.pionex.us/wsPub opened in 80 to 137 ms without auth. Private paths answered INVALID_APIKEY or APIKEY_LOST. ws.webot.com does not resolve, and stream.webot.com/wsPub and api.webot.com/wsPub return 404. | spot only |
| 13 | Backpack Exchange, [`../profiles/backpack/`](../profiles/backpack/) | backpack | perpetuals | USDC-M 91 open (74 crypto, 17 equity or equity index RWA perps), plus 1 PostOnly and 11 Closed. No USDT-M, coin-M, dated futures or options (IPERP, DATED and RFQ types each list 0 markets). | 500 | depth.<symbol> on wss://ws.backpack.exchange sends realtime deltas of absolute sizes at changed levels across the whole book, not a window. depth.200ms, 600ms and 1000ms are aggregated variants, and depth.100ms returns error 4008. There is no snapshot on subscribe, so a feed must seed from REST GET /api/v1/depth?limit=1000 and align on lastUpdateId. Note that REST bids come ascending, so the best bid is last. The sequence rule is per market: U = previous u + 1, and the docs say to requery REST on a gap. 0 gaps in about 330k deltas. No checksum. No subscribe ack. permessage-deflate is used only when the client offers it. | GET /api/v1/markPrices is one bulk call (13.8 KB, 92 rows, served from the CloudFront cache at about 1 s age) with indexPrice, markPrice, fundingRate and nextFundingTimestamp (Unix ms). fundingRate is the running estimate for the current 1 h interval. The interval is absent from this call: take fundingInterval from /api/v1/markets, which is 3600000 ms on 103 of 103 perps. Clamps: the mark is bounded to the index by a threshold that is not published per market. Each mark and index update is capped at 0.25% (BTC, ETH, SOL), 0.5% (85 perps) or 0.75% (2). Funding cap and floor are ±150 bps per hour (±100 on 3 perps). The crypto index basket is not public. | US persons may not trade perpetuals. The public /wapi/v1/country/permissions list sets isPerpEnabled false for US, GB, CA, JP, AU, NZ, AE, CK, CU, IR, KP and VI. The other 200 countries can trade perps. The VARA entity is spot only, and Washington is 'Coming Soon' for spot. From this host every public REST call returned 200 or a documented 4xx. The host routes through a pre-existing Surfshark WireGuard default route, and CloudFront answered from its Seattle POP. WS wss://ws.backpack.exchange (AWS Tokyo) opened in 471 to 639 ms. Nothing was refused and no 429 was seen. | fits with a named change |
| 13 | One Trading, [`../profiles/onetrading/`](../profiles/onetrading/) | onetrading | perpetuals | USD 5-Year Crypto Dated Futures with 4 h funding, which One Trading calls its perpetuals (type DATED_FUTURE, expiry 2031-04-20): 10 active. EUR true perpetuals (type PERP): 0 active, 4 CLOSED. USD equity dated futures: 2 active, 1 POST_ONLY. Spot: 3 active. No USDT-M, USDC-M or coin-M perpetuals, and no options. | 150 | ORDER_BOOK on wss://streams.fast.onetrading.com. It sends the whole visible book and ignores the depth field. At most 16 levels per side were ever seen, so the engine's 20 are not available. It sends a snapshot on subscribe. Every update carries unum_bids, which rose by exactly +1 per update on 15,344 of 15,344 steps. The snapshot's own unum failed to chain to the first update on 12 of 30 snapshots, so the feed seeds its counter from the first update. Even then, the book matched REST level 2 at the same unum on 36 of 36 reads. There is no checksum. Frames are plain JSON, and permessage-deflate is not negotiated. The server sends a HEARTBEAT every 10 s on every socket. All 10 contracts fit on one socket at 55 to 85 frames/s. One non-JSON frame makes the server close the socket with code 4000. | GET /fast/v1/market-ticker is one bulk call (7.4 KB, median reply 390 to 401 ms). It carries mark_price, funding_rate (the preliminary rate for the next 4 h settlement, as a fraction) and next_funding_payment (ISO time). The funding interval comes from instruments funding_schedule.period_minutes = 240. No public index price exists anywhere, REST or WS: the index is a licensed Kaiko benchmark (KK_BRR_*). The mark is the median of the venue's own last price, best bid and best ask, and it changes once a minute. Funding caps: clamp 0.0005, cap 0.001 per 4 h, plus a 4%/yr interest term. Settlement is at 00/04/08/12/16/20 UTC. | One Trading Exchange B.V. (Amsterdam, AFM-supervised MiFID II OTF and MiCA CASP) lets professional clients trade the dated futures after KYC, and retail clients after an appropriateness test. It excludes persons from the USA (citizens, residents, entities) and from sanctioned countries (GTC 1.7 clause 6.1.2), so US persons may not trade. From this host near Seattle, every valid REST request returned 200 and every WS open returned 101 through Cloudflare SEA or YVR, with no geoblock and no refusal. | blocked |
| 13 | Hibt, [`../profiles/hibt/`](../profiles/hibt/) | none | perpetuals | USDT-M 82: 45 crypto and 37 commodity, FX, index, equity or pre-IPO names such as gold, crude, eurusd_usdt, spx500_usdt and unitree_usdt. 3 more (sse, gcei, jets) are listed with supportTrade false. USDC-M 0, coin-M 0, no dated futures. Options are named in the terms but are not in the API. Spot has 503 pairs and is not detailed. CoinGecko's derivatives list (214 venues) does not show HIBT, and /derivatives/exchanges/hibt returns 404. | 500 | Topic <id>.20deep on wss://fapi.hibt0.com/v2/ws, subscribed with {"event":"sub","topic":"btc_usdt.20deep"}. Depths 5, 10 and 20 exist. Every frame is a whole book of 20 levels per side as flat [price,size,...] string arrays, with exponent form on small coins. It pushes every 200 ms on BTC and ETH and every 500 to about 800 ms on other contracts. There are no deltas, no sequence and no checksum, so a feed does resetBook on every frame. About a third of busy frames repeat the previous one exactly. Unknown or unsupported topics are acked ok and then stay silent. The server sends a protocol ping every 54 s. A JSON frame without an "event" key drops the socket with 1006. No compression: permessage-deflate is not negotiated. All 82 contracts ran on one socket at 204 frames/s. The six no-underscore commodity ids (gold, crude, silver, lco, platinumu, chiwheat) carry a one-level book. | Bulk call GET https://fapi.hibt0.com/open-api/v2/market/contracts: 46.8 KB, about 200 ms, 82 rows. It has index_price, funding_rate and next_funding_rate_timestamp in Unix ms. It has no mark field and no interval field (8 h is documented, at 00/08/16 UTC). The mark only comes from GET /v2/market/index?symbol=<id>, one contract per call, and the bulk form returns 400 param error. Its marketPrice equals index_price on 360 of 360 same-instant reads, so there is no independent mark. Funding is flat: 53 contracts at 0.0000129, 17 at -0.0000129, 6 at 0, and BTC unchanged for days. That contradicts the documented formula (I = 0.01%, clamp a and b unpublished). The history call returns 5-minute samples with no settled marker. No index basket is published. | Terms clause 2.2 restricts the US and its territories, Canada, the Netherlands, Singapore, Malaysia, the Bahamas, Malta, sanctioned areas, and Hong Kong and UK derivatives for retail, so US persons may not trade. The terms attribute perpetuals to Aux Cayes FinTech Co. Ltd. (Seychelles, the entity name OKX's terms use), while the disclosures name KAIXUAN NETWORK CO., LTD. (FinCEN MSB and FINTRAC MSB). From this host near Seattle, fapi.hibt0.com REST returned HTTP 200 on every public call and the WS upgraded with 101 via Cloudflare SEA, with no refusal. hibt.com and support.hibt.com/hc pages return 403 with a Cloudflare challenge (cf-mitigated: challenge), while the help center API returns 200. | fits with a named change |
| 13 | SAFEbit, [`../profiles/safebit/`](../profiles/safebit/) | none | spot | none (no futures, perpetual, leverage or funding word on the site or in 30 web app script chunks. Not in CoinGecko's 214-venue derivatives list. The public API has no contract call. Spot: 123 pairs, 114 TRY and 9 USDT) | 5000 | No public WebSocket is documented. The web app's socket at wss://ws.safebit.com.tr/connection/websocket (inferred Centrifugo v2 JSON protocol) accepted an anonymous upgrade (101, no extension). No frames arrived in 5 s. Channel names are <AppId>_<MarketQueueName>_tickerv3, and both parts come from internal calls that returned 403 to this host, so nothing was subscribed. In the client code, each order-ticker push replaces the whole book, sent as "price,size/..." strings, with no sequence and no checksum. Depth is unknown. | none. No index, mark or funding. The only reference prices are spot tickers (/api/Spot/tickers, /api/CoinMarketCap/summary, /api/ReturnTicker). On 3 pairs the ticker ask sat below the book's best bid, and USDT_TRY showed a bid and ask while its book was empty. | Operator is Safebit Kripto Varlık Alım Satım Platformu A.Ş., under Turkish Capital Markets Law 6362 and CMB crypto asset rules. Foreign nationals are contemplated, no country is excluded by name, and US persons are not excluded by name. Sanctioned persons are excluded. The agreement bans automated access through interfaces SAFEbit does not provide. From this host, public REST at api.safebit.com.tr (Cloudflare) answered 200 on all public calls, with no rate-limit headers and no 429 at 2 req/s. Web-internal calls (GetProvider, GetMarketCurrencyCoinMatches, GetCoinRates) answered 403 with an empty body. wss://ws.safebit.com.tr/ returned the Cloudflare 403 "Sorry, you have been blocked" page, /connection/websocket returned 101, api root 404, www root 502. | spot only |
| 13 | CEX.IO, [`../profiles/cex/`](../profiles/cex/) | cex | spot | none | 2500 | order_book_subscribe on wss://trade.cex.io/api/spot/ws-public, one pair per request, each costing 1 point of a documented 100 points a minute per IP. The reply is itself a 20-level snapshot with seqId, with no separate ack. After it come order_book_increment deltas, at most one per second per pair (median interval 1,000 to 1,011 ms, so books can be up to about 1 s old). The sequence rule is seqId = previous + 1 per pair: 0 gaps in 3,369 increments, and a lower seqId means a documented server restart that needs a resubscribe. There is no checksum. Delta levels arrive unordered, sizes are base-currency strings, and book frames carry no timestamp. The server never negotiates permessage-deflate. The docs say to ping at least every 10 s, and on the wire an idle socket closed at about 60 s. | none. CEX.IO has no index, mark or funding. The only bulk reference call is POST get_ticker with {}, which returns 898 pairs (bestBid, bestAsk, last, volume) in 131 KB. Its "last" is an indicative price that tracked bestAsk in every sampled row. From this IP it was served only about twice a minute and otherwise answered 429. No poller is recommended, because the reader refuses a mark of 0 as anchor_no_mark. | Who may trade: CEX.IO Corp. (NMLS 1804170) serves US residents in licensed states (Hawaii deposits stopped in 2023), and 30 countries are unsupported, including Canada, Japan, Singapore, India and Russia. What this host saw: Cloudflare's trace places its traffic in Canada, and every cex.io and trade.cex.io web page (docs, fee schedule, terms) answered 302 to cex.io/canadian-regulations. The public REST API at trade.cex.io/api/spot/rest-public answered 200, and both wss://trade.cex.io/api/spot/ws-public and the legacy wss://ws.cex.io/ws opened normally. The only refusals were 429 {"error":"API rate limit reached"} on get_ticker and "Please Login" on the legacy socket's book. | spot only |
| 15 | Ondo Stocks, [`../profiles/ondo-stocks/`](../profiles/ondo-stocks/) | none | spot | none. The venue is the primary mint and redeem market for 347 tokenized US stocks and ETFs quoted in USDon, and it lists no perpetual, dated future or option. CoinGecko lists a separate venue, Ondo Perps (id ondo-perps, Panama, app.ondoperps.xyz), with 65 perpetual pairs. It is not Ondo Stocks and was not researched. | unknown | No public book channel and no WebSocket. The only depth is gRPC StreamSoftQuoteDepth on grpc.gm.ondo.finance:443, and it needs x-api-key. It is a synthetic ladder built from Ondo's own mint (ask) and redeem (bid) quotes. Per the docs it sends a snapshot on connect and then replaces the whole ladder for a symbol at most about every 250 ms. It has no sequence number and no checksum, its level count is not published, and it uses protobuf over gRPC. Without a key, all nine gRPC calls got HTTP 403 with an empty body from awselb/2.0 in three runs. Those calls included HealthCheck, which the schema says needs no key. | none. The venue publishes no index, mark or funding. The key-gated GET https://api.gm.ondo.finance/v1/assets/all/prices/latest (1 s cache) carries the token price (primaryMarket.price) and the underlying stock price (underlyingMarket.price). The token price equals the stock price times a shares-per-token multiplier that grows with reinvested dividends. Without a key the call answered 403. | Only KYC-onboarded non-US persons may mint or redeem, with Ondo Global Markets (BVI) Limited under Regulation S. The US, Canada, Russia, Belarus, Iran, North Korea, Cuba, Syria and others are prohibited. The EEA, UK, Switzerland, Hong Kong, Singapore, Malaysia and Brazil are limited to professional, qualified or accredited investors. API keys are issued only after onboarding. From this host near Seattle on 2026-09-23 03:21 to 03:28 UTC, all 17 documented REST GET paths plus undefined paths answered 403 {"message":"Forbidden"} (x-amzn-errortype ForbiddenException, through CloudFront, no Retry-After) in 73 to 213 ms. All gRPC calls got a 403 from the load balancer, which AWS documents as a WAF block. WebSocket upgrades got 403 on api.gm.ondo.finance and 464 on the gRPC host. The public web pages (status, app, docs, openapi.json) answered 200. | no public API |
| 15 | Tothemoon, [`../profiles/tothemoon/`](../profiles/tothemoon/) | none | perpetuals | USDT-M 13 (ADA, ATOM, AVAX, BCH, BTC, DOGE, DOT, ETC, ETH, LTC, SOL, UNI and XAU on the XAUT_USDT pair, all is_enabled), USDC-M 0, coin-M 0. Twelve retired *_PERPETUAL ids and three 2022 dated futures appear only in the turboEmergencyMode map. CoinGecko's derivatives list does not include the venue. | 500 | contractsOrderbookVolumes.<instrument_id> on wss://octopus-prod-ws.cryptology.com/v1/connect. The documented host, octopus.tothemoon.com, does not resolve (NXDOMAIN). About 15 levels a side (13 to 18 seen), which is below the engine's 20. On subscribe, nonce 1 carries the whole window but is up to 1.2 s stale. In 17 of 19 subscriptions nonce 2 was a second, fresher whole window, and the book has to be reset on it: a plain merge left 7 of 19 books crossed, reset left 0. After that come price-map deltas at 4.3 to 6.1 frames a second, and "0" deletes a level. There is no per-contract sequence: offset is a counter shared across channels, and it went backwards once, at nonce 2 or 3, in most subscriptions. payload.nonce counts frames per subscription with 0 gaps and is the only gap signal. No checksum. Permessage-deflate is not negotiated. Sizes are in contracts of contract_size, and extended_volumes.base gives the size in coins exactly. | No REST call carries index, mark or funding. The socket channel turboTickers.* (one subscription covers all 13 contracts, about one frame a second each) carries: index_price. Mark_price, equal to index_price and fair_price on every frame. Funding_rate, always 0, with funding_disabled true on all 13. Funding_interval in ms (8 h on 11 contracts, 1 h on AVAX, 6 h on LTC). There is no next-funding field. last_funding_time is 2026-09-08, and 2022 for SOL. No clamp is published. Mark = Index × (1 + FR × t/T). The index is an unpublished average of several exchanges. ATOM's index sat about 140,000 ppm and ETC's about 40,000 ppm above both Gate's index and Tothemoon's own book. The other 11 were within −1,265 to +446 ppm of Gate. | Perpetuals are offered by Tothemoon Global Inc. (Panama). The Contracts T&Cs exclude US persons and US territories, the whole EEA, the UK, Switzerland, Canada, Japan, South Korea, China, Russia and sanctioned regions. EEA spot goes through Brilliantscope Trading Limited (Cyprus, MiCA CASP). From this host near Seattle nothing was refused: api.tothemoon.com answered 200 (and 404 or 400 on wrong paths), and octopus-prod-ws.cryptology.com and octopus.cryptology.com answered 101. The documented octopus.tothemoon.com, octopus-sandbox.tothemoon.com and contracts-api.tothemoon.com are NXDOMAIN, and the documented /v1/public/time returns 404. | fits with a named change |
| 15 | TokoCrypto, [`../profiles/tokocrypto/`](../profiles/tokocrypto/) | tokocrypto | spot | none | 4044 | wss://stream-cloud.tokocrypto.site/stream, `<sym>@depth@100ms` diff over the whole book with no snapshot, chained on U = previous u + 1 (0 gaps on 4 symbols and on 200 symbols, both runs), no checksum. `<sym>@depth20@100ms` gives 20 levels per side with a lastUpdateId equal to a diff u (490 of 490), so it can seed and reseed like the engine's Binance futures feed. Plain text JSON. Deflate is negotiated only when the client offers it. Server protocol ping every 20 s, and an unanswered socket closes with 1008 at 76 to 86 s. This is Binance's own spot stream: same update ids, arrival median 0 to 2 ms from stream.binance.com. | none. No index, mark or funding: /fapi/v1/premiumIndex returns 404 on both hosts. Only per-symbol /api/v3/referencePrice (trade SMA over 80 x 3,750 ms = 300 s, no bulk form, 400 without symbol), /api/v3/avgPrice (5 min), and bulk /api/v3/ticker/price (3,710 rows, 157 KB) on www.tokocrypto.site. | PT Aset Digital Berkat, Indonesia. Individuals 17+ with a KTP, or a passport and/or KITAP/KITAS. Companies must be Indonesian-licensed and domiciled. Parties sanctioned by Indonesia, US OFAC, EU or UK are excluded. The US is not named, and whether a non-resident US person can pass KYC is not verified. From Seattle every REST host answered 200 (only cloudme-toko.2meta.app/api/v1/time got a CloudFront 403 edge page while depth on that host worked). WS opened in 350 to 450 ms (type 3 socket 474 to 627 ms). No geoblock. | spot only |
| 15 | Coinone, [`../profiles/coinone/`](../profiles/coinone/) | coinone | spot | none (KRW spot only: 363 pairs, all trade_status 1. The markets reply for USDT, BTC and USDC quotes is empty. CCXT has swap, future and option false at coinone.js lines 31 to 33. The docs index has no derivative endpoint. CoinGecko's 214 derivatives exchanges do not include Coinone) | 200 | ORDERBOOK on wss://stream.coinone.co.kr, one frame per topic {"request_type":"SUBSCRIBE","channel":"ORDERBOOK","topic":{"quote_currency":"KRW","target_currency":"BTC"}}. Every frame is the whole book at a fixed 16 levels per side, below the engine's 20. A snapshot comes on subscribe (ack at 168 to 171 ms, first frame at 170 to 330 ms), then a full book on every change, with no deltas. The id is ms time plus a 3-digit counter. It rises strictly but not consecutively, so no gap rule is needed: drop a frame whose id is not above the last one. There is no checksum. Asks arrive worst first and bids best first. The first frame's timestamp is about 10 s stale, so stamp frames on arrival. Frames are text JSON, and permessage-deflate is not negotiated. A SHORT key format exists. All 363 pairs ran on one socket at 189 to 234 frames/s. Client PING and PONG. An unsubscribed idle socket closed at 60.7 s with 1006. | none. Spot only: no index, mark, funding, interval or next funding, and no reference or basket endpoint. The only bulk call is GET /public/v2/ticker_new/KRW (363 rows, about 117 KB, median 157 ms). It carries last price, 24 h statistics and one level of best bid and ask. | Only Korean nationals aged 19+ with a real-name KakaoBank account may trade. Foreign nationals, non-residents included, cannot register. People living abroad cannot complete KYC, and 32 FATF/OFAC nationalities are refused. So US persons are excluded, and corporate accounts go through an inquiry. From this host near Seattle, public REST api.coinone.co.kr (Cloudflare) answered HTTP 200 with data on every call. The WS stream.coinone.co.kr (AWS ELB in Seoul) opened in 669 to 718 ms and delivered data on every socket. The marketing site coinone.co.kr answered curl's default UA with HTTP 403 and cf-mitigated: challenge (a Cloudflare bot check, not a geoblock), and answered HTTP 200 to a browser User-Agent. | spot only |
| 15 | Bitlo, [`../profiles/bitlo/`](../profiles/bitlo/) | none | spot | none | 3500 | STOMP 1.2 over wss://api4.bitlo.com/ws/websocket, which also works with no subprotocol. Destination /topic/market/<BASE-QUOTE>, or /topic/market/* for every market. It sends deltas only, with no snapshot on subscribe. Each book must be seeded from REST GET api4.bitlo.com/market/orderbook (50 levels per side plus a per-market sequenceId). The chain rule is beginSequenceId = previous endSequenceId + 1, and the first delta after the seed starts at sequenceId + 1. That rule showed 0 gaps in two runs over 5 markets, 299 markets and the wildcard. Sizes are absolute base-asset amounts and size 0 deletes a level. There is no checksum and no RECEIPT or ERROR frame for anything. The server negotiates permessage-deflate only when offered, otherwise plain text. | none. There is no index, mark or funding. Reference prices only: REST /market/ticker/all (last, VWAP, bid and ask, with the bid and ask rebuilt about every 61 s), WS /topic/ticker-price {symbol, price in USDT by inference, tryPrice}, and klines on api3.bitlo.com. | Every account is opened with Bitlo Kripto Varlık Alım Satım Platformu A.Ş. (Istanbul, regulators named are SPK and MASAK). Users declare they are over 18 and allowed to transact under Turkish law, and give a T.C. or foreign identity number. TRY withdrawals go only to a Turkish bank account. The global host bitlo.exchange (Bitlo Corporation, Panama) sends sign-ups to www.bitlo.com. No document names US persons or lists excluded countries. From this host near Seattle, public REST on api4 and api answered 200 through Cloudflare SEA, the WS upgraded with 101, docs.bitlo.com answered 200, and there was no geoblock. api.bitlo.com/ root answered 403 with {"code":0,...}. | spot only |
| 16 | KCEX, [`../profiles/kcex/`](../profiles/kcex/) | none | perpetuals | USDT-M 836, USDC-M 10 (each also listed as a USDT-M pair), coin-M 0. That is 846 rows from GET www.kcex.com/fapi/v1/contract/detail, all state 0, 4 isHidden. The USDT-M count includes 230 stock and commodity contracts. CoinGecko says 862. | 100 | sub.depth on wss://www.kcex.com/fapi/edge. This is an undocumented web-app socket that speaks the MEXC contract protocol, and one URL serves USDT-M and USDC-M. The handshake needs a User-Agent header, and without one it gets 403. Deltas are unmerged [price,size,orderCount] over the whole book (no level window). There is no snapshot on subscribe. The seed is REST /fapi/v1/contract/depth/{s}?limit=100, which carries the same version: drop deltas at or below it. Sequence rule: version equals last+1. There was 1 gap in about 493k deltas over 3 book runs and 2 runs of 100 contracts. 27 of 27 REST reads at an exact version matched 40 of 40 levels. No checksum. compress:true is acknowledged and then silent. sub.depth.full at limit 10, 50 or 100 gives whole books, conflated. Frames are text JSON, and permessage-deflate is not negotiated. The client must send {"method":"ping"}, because the server closes a socket whose client has been silent 15 s (closes seen at 19 to 25 s). 100 contracts on one socket ran about 3,400 frames a second. | No fresh bulk call has all five fields. GET /fapi/v1/contract/funding_rate is fresh per request (138 KB, median about 120 ms). It has fundingRate (the running value for the upcoming settlement), collectCycle in hours (8 h on 318 contracts, 4 h on 526, 1 h on 2), nextSettleTime in ms, and a per-contract cap (plus or minus 0.02 on 814, up to 0.05). GET /fapi/v1/contract/ticker has indexPrice, fairPrice (the mark) and fundingRate, but it is a cached snapshot refreshed every 8 to 16 s that arrives 1.6 to 16.7 s old. Fresh index and mark exist only per contract (index_price/{s}, fair_price/{s}) or on WS push.tickers (all contracts about every 2.2 s, index and fair, no funding). Mark is the median of three terms: index times (1 + rate times the time to settlement over the interval), index plus a moving average of the mid-price basis, and the last trade. No clamp is documented, and the mark equals the last trade on 25 to 31% of contracts. The docs call the index weighted spot with a 1% outlier rule. But 239 baskets are a single other venue's perp: 230 stocks on BINANCE_FUTURE or OKX_FUTURE, plus ONE_USDT and 8 more. 260 other baskets include a perp. The basket is public at /fapi/v1/contract/market_price_v2?symbol=, without weights. | KCEX is registered in Seychelles and names no legal entity, and its terms are under Singapore law. The User Agreement refuses the US, Canada, Mainland China, Hong Kong, Singapore, Iran and 13 others, so US persons may not trade. It also forbids scripts, robots and scraping without KCEX's consent. From this host near Seattle: www.kcex.com /fapi/v1 REST returned 200 via CloudFront SEA900-P5. The WS returned 101 when a User-Agent was sent, and 403 (an AmazonS3 maintenance page) without one. REST without a User-Agent was also 403. api.kcex.com gave a CloudFront 403 "Request blocked." on every path. support.kcexhelp.com gave 403. docs.kcex.com resolves to the private address 10.192.41.51. | no public API |
| 16 | OrangeX, [`../profiles/orangex/`](../profiles/orangex/) | none | perpetuals | USDT-M 578 (all is_active true in get_instruments?currency=PERPETUAL on 2026-09-23 UTC). At least 41 of them are equity, ETF, commodity or pre-IPO contracts with no flag, such as TSLA, SPY, XAUT, CL, OPENAI and ANTHROPIC. USDC-M 0, coin-M 0. Also listed: 348 spot, 10 demo SANDBOX contracts, 0 dated futures, 0 options. CoinGecko's API showed 579 perps. | 600 | book.{instrument}.raw on wss://api.orangex.com/ws/api/v1, subscribed with the JSON-RPC method /public/subscribe. Only the raw interval exists: 100ms and grouped forms are refused with code 3401. Deltas cover the whole depth as [new/delete, price, amount], about 4 to 5 frames a second on BTC. No snapshot on subscribe: each market must be seeded from REST get_order_book depth=100, whose version is the same counter as change_id (depth=0 lags by up to 22 versions). change_id rises by exactly 1 per frame per instrument: 0 gaps in 1,836 frames on 4 contracts and in 17,785 and 18,188 frames on all 578 on one socket. The seeded book matched REST on 40 of 40 levels at the same version. No checksum. Deflate is not negotiated. Sizes are in the base coin (contractSize 1). The socket pads number strings, so levels must be keyed by Number(price). One bad channel fails the whole subscribe frame. | Two bulk GETs, both fine at a 1 s cadence. First, /api/v1/public/tickers?currency=PERPETUAL, an undocumented bulk form (278 KB, median about 206 ms): mark_price, plus underlying_price as the index. Second, /api/v1/public/get_all_capital_rate, undocumented and used by the website (143 KB, 769 rows of which 191 are dead contracts, median about 160 ms): capitalRate (the upcoming rate, a fraction per interval), the interval as endTime minus startTime (1 h on 5, 4 h on 379, 8 h on 194), and next funding as endTime in ms. The documented cmc_contracts duplicates index, rate and next settlement. Funding is clamped to ±0.75 % with an inner ±0.05 % clamp. The mark formula and index basket are unpublished. The mark equals the last trade on 78 to 79 % of ticker rows. No mark clamp was seen: marks sat up to 32,258 ppm from the index. The bulk ticker reply can be up to 3.2 s old on arrival. | The terms (revised 2026-07-15) name OrangeX Fintech s.r.o. (Czech Republic) as the default contracting party, alongside Australian, BVI and SVG group entities. They exclude the US, UK, Panama, Australia, Singapore, Hong Kong, mainland China, India, Israel, Slovakia, Ukraine, Russia and others, so US persons may not trade. From the host near Seattle, the website, the docs, REST api.orangex.com (34.111.170.13, behind a Google front end) and wss://api.orangex.com/ws/api/v1 all answered 200 or 101 with no refusal or challenge. Every API error came back as HTTP 200 with a JSON-RPC error code. | fits with a named change |
| 16 | BitDelta, [`../profiles/bitdelta/`](../profiles/bitdelta/) | none | perpetuals | Derivatives with no expiry, which the derivative terms call perpetual contracts: 74 quoted in USD (73 Active, STOUSD Not active) and 16 cross-crypto quoted in BTC, ETH, LTC or BCH, 4 each. No USDT- or USDC-margined contracts and no dated futures. The venue quotes the price itself (one bid and one ask, no depth). CoinGecko's derivatives list (214 venues) does not include it. | 500 | None for derivatives. The socket is Socket.IO 4 over wss://api.bitdelta.com/socket.io/?EIO=4&transport=websocket (polling is refused, and the guest token or no auth both work). prices_futures_v2 is pushed with no join at about 12 frames/s: whole top-of-book quotes (symbol, bid, ask, status, closed, mid, ts) with no sizes, no depth, no snapshot/delta split, no sequence and no checksum. 67 to 73% of rows repeat the previous quote with a new ts. The median quoted spread is about 4,560 ppm (BTCUSD 45 to 49). Per-room futures_prices runs at about 9.5/s. Deflate is not negotiated, and EIO=3 sends RSV1 frames that ws rejects. The only book is spot orderbook_limited: whole 45 to 125 level snapshots per push, no sequence | none. There is no index, no mark and no funding rate, and the only price is the quote mid. Undocumented website calls: futures/market/snapshot (73.6 KB bulk quotes, median 406 ms) and futures/market/pair?slug= (one contract per call), which carries buy_funding_fee equal to sell_funding_fee, negative on all 90 contracts (-0.01 to -4.47 % a day). That is a holding charge on both sides, not a rate between longs and shorts. It is daily, and the page's own tooltips disagree on the instant (00:00 vs 12:00 UTC). No clamp, formula, cap or history call exists | Terms (Lionheart Limited S.R.L, Romania. CoinGecko says Vanuatu) bar US persons, Canada, Mainland China, UAE, South Africa, Seychelles, BVI, Cuba, Iran, North Korea, Sudan, Syria and the Venezuelan government, so US persons may not trade. From this host: api.bitdelta.com (Cloudflare, YVR) answered 200 on every public REST call, and the socket opened in 574 to 644 ms. help.bitdelta.com answered 403 with a Cloudflare challenge to curl and to WebFetch | blocked |
| 16 | Dex-Trade, [`../profiles/dex-trade/`](../profiles/dex-trade/) | none | spot | none (no futures route in API docs v1.1.7, 0 hits for perpetual or funding in the 46 web app scripts, not on CoinGecko derivatives. Spot margin exists in code but is switched off: ticker-margin [], margin-settings state -1) | 2000 | Socket.IO room book_<numeric pair id> on wss://socket.dex-trade.com/socket.io/?EIO=4&transport=websocket, subscribed with the text frame 42["subscribe",{"type":"book","event":"book_<id>"}] after 40. Each frame carries one level for the whole book, with no depth window: a level with fields is the new total, {} deletes it, and values are integers scaled by 10^rate_decimal and 10^base_decimal per pair. No snapshot on subscribe: the snapshot is REST /v1/public/book, full depth, sharing the socket's per-room sequenceId. Rule is sequenceId = last+1, else reload REST: 0 gaps in 761 and 681 frames. Across two runs, 10 of 10 rebuilt books matched REST exactly. REST lagged the socket by 1 to 2 ids on one snapshot per run. No checksum. Deflate is not negotiated. | none: no index, mark, funding, interval or next funding. Only a per-pair ticker (/v1/public/ticker, key misspelt percent_сhange with Cyrillic с), plus an undocumented site bulk ticker /api/default/ticker (48 rows, ~51 KB, ~500 ms) whose rate_usd is the site's own conversion price. | Operator is CoreLead Technologies Ltd (Seychelles). The terms exclude the US, UK, Canada, EU members, Russia and Crimea, Cuba, Iran, Iraq, North Korea, Syria, Algeria, Pakistan, Sudan, Singapore, Japan, Belarus and Kazakhstan, so US persons may not trade. KYC is optional, but withdrawals above 5 BTC per 24h need it. From this host near Seattle, via Cloudflare with no geoblock: public REST returned 200 (bad pairs 400 {"status":false,"error":"Incorrect pair"}) and every socket upgraded with 101 in 507 to 559 ms. | spot only |
| 16 | Tapbit, [`../profiles/tapbit/`](../profiles/tapbit/) | none | perpetuals | USDT-M 116 (CoinGecko tapbit-futures count, since the venue's own catalog refused this host with 403). No USDC-M, coin-M, dated futures or options. The 116 include about 59 TradFi and pre-IPO contracts, among them OPENAI and ANTHROPIC | 600 | Documented only. usdt/orderBook.{BTC-SWAP}.{5/10/50/100/200} on wss://ws-openapi.tapbit.com/stream/ws, which one URL serves for spot and perps. Documented shape: action insert first, then update. version is "strictly increasing", and a step of +1 is not stated. No checksum is documented. The docs example update is not price-sorted. Compression is unknown. The server pings every 5 s, and two missed pongs disconnect. Limits: 1 connection per second and 240 subscriptions per hour. Every handshake from this host was refused with 403, so nothing was verified on the wire | No bulk REST anchor. ticker_list has mark_price only. funding_rate is one contract per call at 3 calls a second, so about 39 s per round of 116. No REST call returns the index. The only bulk index, mark and funding source is the WS topic usdt/ticker.all (indexPrice, markPrice, fundingRate). No field carries the funding interval or the next funding time: the default is 8 h at 00, 08 and 16 UTC, with 1 h and 4 h contracts announced one by one. Mark = median(index-based Price1, index plus the 2-min basis MA, last trade), with no explicit clamp. The index falls back to Tapbit's own spot price when a source price cannot be retrieved. Funding = P + clamp(I - P, +-0.05%), capped at 75% of (IMR - MMR). All anchor calls refused this host with 403 | Who may trade: US persons may not. The United States is one of 38 restricted jurisdictions (Location Restrictions, updated 2026-06-25), although another article claims FinCEN MSB registration. The futures API needs an emailed application, KYC, and at least 5,000,000 USDT of perpetual volume with at least 50% maker per 14-day cycle, else it is revoked. From this host: every perpetual REST path, every spot v1 path, an unknown path and / on openapi.tapbit.com returned CloudFront 403 "Request blocked" (POP SEA900-P13, 11 to 92 ms, no Retry-After). The WebSocket handshake returned the same 403 on 14 of 14 attempts (SEA73-P3). This is the documented firewall whitelist of 2024-12-13. Only /spot-v2/ REST answered 200. www.tapbit.com returns a Cloudflare challenge (403) | blocked |
| 9 | Websea, [`../profiles/websea/`](../profiles/websea/) | none | perpetuals | USDT-M 246 (155 crypto, 85 TradFi, 6 CFD per the web symbol list), USDC-M 0, coin-M 0. No dated futures or options. Spot 106 USDT pairs. CoinGecko's derivatives list (214 entries) does not include Websea, but the perpetuals exist and are live. | 600 | The documented socket (wss://oapi.websea.com/ws/v1/futures/market) has no book: `depth` answers errno 50009. The only book is the web app's undocumented socket, wss://cws.websea.com/ws/realTime_depth?compress=0, type 1, subscribed with {subs:[{symbol, depth: merge step, level: 50, type: 1, version: 1}]}. It gives up to 50 levels a side, keyed by `gear`, which is the level's position from the touch and not its price. A shift resends the whole tail, and number "0" deletes a gear. Each socket carries one depth subscription, since a later one replaces the earlier one, so the full catalog needs 246 sockets. No snapshot is guaranteed on subscribe: both sides were complete after 0.2 to 3.0 s. There is no sequence or update id and no checksum. Frames come about every 200 ms, prices and sizes are strings, and sizes are in contracts. With compress=1 the frames are gzip bytes carried inside text frames, and compress=0 gives plain JSON. permessage-deflate is never negotiated. An idle unsubscribed socket closes at about 30.8 s, and the web app keeps it alive by sending the Unix seconds as text every 5 s, which the server echoes. | No bulk call gives a fresh index. GET /v1/futures/index_price is a bulk call (246 rows, 13.9 KB, median about 288 ms), but it actually carries the MARK: a median 0 ppm from the web markerPrice. It reads "0" on up to 11 new contracts. GET /v1/futures/24hr (89 KB, median about 375 ms, one spike of about 3.9 s per 60 polls) has index_price, funding_rate as a fraction and next_funding_rate_times, which is the settlement time minus 1 s. It is cached and changes only 2 to 5 times a minute, and its index sat 326 to 459 ppm (median) below the Binance index. The funding interval is in no bulk reply: the per-contract feeCycle shows 8 h on 135 contracts and 4 h on the three of the other 111 that were read. The true index, which tracks Binance within a median of 2 ppm, is only per contract: capi.websea.com/webApi/market/getSymbolDetail, or the undocumented type 8 socket stream, which can cover all 246 on one socket. The funding clamp formula is published, and the cap is per contract (±2 % on BTC and ETH, ±3 % on the others read). The mark formula and its clamp are not published. | Who may trade: the terms name no legal entity. They are governed by English law and refer to Seychelles and Bahamas law, and CoinGecko gives the country as the British Virgin Islands. Restricted Locations include the USA and its territories (so US persons may not trade), Canada (Ontario and Quebec), the UK and Hong Kong for retail derivatives, Singapore, Malaysia, Malta, the Bahamas, Cuba, Iran, North Korea, Syria, Crimea, Donetsk, Luhansk, Bangladesh and Bolivia. Withdrawals have been suspended since April 2026 and are rationed in rounds. The 4th round was announced 2026-08-18, and no full reopening had been announced by 2026-09-22. From this host near Seattle: every public REST call on oapi.websea.com and capi.websea.com (Cloudflare, Vancouver point of presence) returned HTTP 200. Both sockets (cws and oapi) upgraded with 101. There was no geoblock, challenge or refusal. Errors come back as HTTP 200 with an errno. | blocked |
| 9 | LeveX, [`../profiles/levex/`](../profiles/levex/) | none | perpetuals | USDT-M 254, USDC-M 22, coin-M 10. These are the active contracts (mark above 0) on the web client socket's all-market ticker, out of 298, 22 and 12 listed. They match CoinGecko's 286 (254/22/10). USDT-M includes stock, ETF and commodity perps (XAUUSDT, CLUSDT, KOUSDT, SOXLUSDT). | 600 | No public channel. The undocumented web client socket wss://ws100.levex.com takes orderbook.subscribe {symbol} and sends 25 levels. It sends a snapshot on subscribe, then re-sends snapshots at irregular times, and these matched the kept book in 24 of 24 cases. Incrementals are [price,size] strings, and size "0" deletes a level. The client must also prune crossed levels, because SOLUSDT crossed without pruning. There is no sequence or update id and no checksum. Permessage-deflate is not negotiated. | None public. The REST funding-rate history call on api100.levex.com returns 403 to this host. The web client socket's perp24HTicker pushes indexPrice, markPrice, fundingRate and lastFundingRate for all 332 contracts in about one frame per second. It has no funding interval and no next funding time. The docs say 8 h at 00:00, 08:00 and 16:00 UTC. The fundingCap and fundingFloor are in the refused catalog. The mark formula is not published and leans on index plus funding: MTLUSDT's mark sat 3.4% above its book. | Both LeveX agreements list the United States as a Prohibited Country, and the 2023 Terms of Use adds Europe and the UK. Both forbid bots and scripts that access or monitor the site. From this host: levex.com gave 200. api100.levex.com gave 403 CloudFront "Request blocked" (POP SEA900-P9) on every path, with no Retry-After, and the cause (geo or WAF) is not verified. data.levex.com gave 403 S3 AccessDenied. The ws100.levex.com WebSocket upgrade gave 101 and served data. | no public API |
| 9 | Biconomy.com, [`../profiles/biconomy/`](../profiles/biconomy/) | none | perpetuals | USDT-M 295 active (detailV2 lists 511, and 216 are state 3, delisted), USDC-M 0, coin-M 0. The help center says coin-M and USDC contracts are "under development". CoinGecko shows only 6 pairs. | 600 | subscribe.depth.full {symbol, limit:20} on wss://openapi.biconomy.com/future/websocket. The socket is undocumented and was taken from the futures web app. It is a renamed copy of the MEXC contract protocol. Each push is the whole top 20 per side as JSON numbers [price, contracts, orders], bids descending and asks ascending, on a ~365 ms tick, sent only when the book changed. There is NO snapshot on subscribe: 4 of 295 contracts sent nothing in 45 s and one first frame took 32 s, so each market needs a REST depth?limit=20 seed. Limits 5, 10, 20, 50 and 100 work, 30 is refused, and no limit gives 100. push.depth.full shares its version counter with the incremental push.depth. push.depth carries one level per frame with an absolute size, and 0 deletes the level. Its version steps by exactly +1, with 0 gaps in about 11k BTC deltas. A book seeded from REST and kept with the deltas matched depth.full 302 of 302 times. No checksum. Text JSON. permessage-deflate is negotiated only if the client offers it. A socket with no traffic closes at 60 s (code 1006), and {"method":"ping"} gets a pong. 295 streams on one socket ran at ~377 frames/s. | Two bulk calls under https://openapi.biconomy.com/future/api/v1 (undocumented web-app API). (1) ticker/list?timezone=24H has indexPrice, fairPrice (the mark) and fundingRate: 87 KB, 295 rows, median 130 to 176 ms. (2) allFundingRate has fundingRate, cycle in hours (8 on 293 contracts, 4 on BASED, 1 on ONG) and nextSettleTs in ms: 33 KB, median 115 to 123 ms. All five AnchorRow fields exist, no index or mark is 0, and no poll took over 1 s in 120 polls. The ticker is a ~1 s snapshot whose ts is 0.4 to 1.8 s old on arrival. The BTC index changes only about every 5 s. No clamp is documented. The mark sat 28,872 to 38,383 ppm above ICP_USDT's index, which has been frozen at 2.944 for 42 h on a single source, BITGET_FUTURE. ANTHROPIC_USDT's mark is 2.4% below its index. The funding cap is undocumented: 22 contracts sat at exactly ±0.0005 and none were beyond. Per-contract index baskets (io, no weights) are in detailV2, and none includes Biconomy itself. | Operator: BICONOMY PTE.LTD (CoinGecko lists the British Virgin Islands). Perpetuals need at least Level 1 KYC. Sanctioned jurisdictions are excluded (OFAC, UN, EU, UK HMT). China, Turkey, Kazakhstan and Indonesia are named as example restricted countries, and Iran and North Korea as sanctioned. No page names the United States, so whether US persons may trade is not publicly specified. From this host near Seattle, every futures REST call answered 200 or its documented error, and the WS upgraded with 101 through Cloudflare (SEA and YVR edge), with no geoblock or challenge. The fee page, the fee data call and the spot v3 API answered 200. The help center HTML pages answered 403, and its JSON API answered 200. | fits with a named change |
| 9 | Bittime, [`../profiles/bittime/`](../profiles/bittime/) | none | perpetuals | USDT-M 49, coin-M 0 (fapi.bittime.com/dapi/v1/contracts returns []) | 600 | market_<id>_depth_step0 (id e_btcusdt, not E-BTC-USDT) on wss://fmarket-ws.bittime.com/kline-api/ws. Every push is a whole 30-level book, bids descending, asks ascending. The first frame arrives about 270 ms after subscribing, with no ack. No sequence and no checksum, so no gap rule is needed. Frames are gzip inside binary WS frames, deflate is not negotiated, and the server pings every 10 s. BTC pushes a median 145 to 205 ms apart. Book ts sits 0.53 to 0.75 s before arrival, against 0.15 s for ticker frames. The web page's host futuresws-cfx.bittime.com serves a different, thin book. | No bulk call. Per contract only: GET fapi.bittime.com/fapi/v1/index?contractName=E-BTC-USDT, public but not documented. It returns indexPrice, tagPrice (the mark, rounded to the price tick and tracking the book's last trade), currentFundRate (always equal to nextFundRate, a live estimate that changes about every 5 s) and remainingSecond (gives nextFundingAt). The interval (8 h for 35 contracts, 4 h for 14) comes only from capitalFrequency in the undocumented POST futures.bittime.com/fe-co-api/common/public_info. A 49-call round took about 5.1 s at 5 concurrent calls. No clamp, cap or basket is published. The index matched Bitrue's on BTC and ETH only. | The operator is PT Utama Aset Digital Indonesia, OJK licence KEP-11/D.07/2025. Indonesians register with a KTP, foreigners with a passport or KITAS. UN and OFAC-sanctioned parties are barred, and US persons are not excluded by name (actual KYC not verified). From this host near Seattle: fapi.bittime.com and futures.bittime.com (CloudFront SEA POP, always a cache miss) and openapi.bittime.com all returned 200. Both WS hosts upgraded with 101 in 803 to 882 ms. There were no refusals or geoblocks, and errors come back as HTTP 200 with a code in the body. | blocked |
| 9 | Hotcoin, [`../profiles/hotcoin/`](../profiles/hotcoin/) | none | perpetuals | USDT-M 567 (364 crypto, 197 us_stock including anthropicusdt and openaiusdt, 3 hk_stock, 2 forex, 1 bond), USDC-M 9 (all duplicates of USDT-M pairs), coin-M inverse 9 (quote USD). That is 585 active in GET /api/v1/perpetual/public on 2026-09-23 UTC, the same 585 in every read. CoinGecko shows 598. There are no public dated futures (the deliver/delivery paths return nginx 404) and no options. Spot has 363 symbols, not detailed. | 600 | The only book channel is `depth` on wss://wss-ct.hotcoin.fit, one URL for all families. The subscribe frame is {"event":"subscribe","params":{"biz":"perpetual","type":"depth","contractCode":"btcusdt","zip":false,"serialize":false}}, one topic per frame. Every push is a whole 50-level window per side, string triples [price, contracts, cumulative], best first. That makes every frame a snapshot, so resetBook runs each frame. The first frame comes 0 to 1 ms after the ack. There is no sequence or update id and no checksum. Push rate is about 4 a second on BTC and 0.4 on quiet books, which went up to 4.6 s without a frame. About 3 to 17 per ~120 frames are identical repeats. Sizes are contracts of unitAmount (coins on linear, USD on coin-M), and the socket matched REST on 38 to 40 of the top 40 sizes. The server does not negotiate permessage-deflate and sends plain JSON by default. serialize:true switches to gzip protobuf. An unknown code is acked as a success and then stays silent. | GET https://api-ct.hotcoin.fit/api/v1/perpetual/public is one call for all 585 contracts. It carries indexPrice, markPrice, fund and liquidationTime (the next settlement in Unix ms). But `fund` is the LAST SETTLED rate: it equalled premiumIndex lastFeeRate 26 of 26 times. There is no funding interval anywhere: history spacing shows 8 h on 321 contracts and 4 h on 264, so read the interval from /{code}/fee-rate at boot. The upcoming rate is only in the per-contract /{code}/premiumIndex (estimateFeeRate) and in the public WS `fund_rates` channel. That channel carries one 131 KB frame every 2.5 to 3.5 s with mark, index, settled and estimated rate, and a countdown to settlement for all rows, including 383 delisted ones. The catalog reply is 555 KB with no gzip and took 669 to 5,817 ms (7 of 80 polls over 2 s), so poll every 2 s, not 1 s. No mark clamp is published, and the mark ran up to 6.9% from the index (bpusdt). The indexInfo basket call is stale (2023-12-26 data) or null, so the index basket cannot be checked. | Only Hotcoin FZE (Dubai, VARA) and Australian Hotcoin Global Exchange Pty Ltd are named. The Legal Statement lists the USA among 32 countries marked High-Risk and Not Accepted, so US persons may not trade. 58 more countries need enhanced due diligence. From this host near Seattle, public REST (api-ct.hotcoin.fit through a LAX CDN edge) and WS (wss-ct.hotcoin.fit, 8.214.79.123) returned HTTP 200 and live data on every call, with no geoblock or refusal. | fits with a named change |
| 14 | Gate US, [`../profiles/gate-us/`](../profiles/gate-us/) | none | spot | none. On api.gate.us the futures/usdt, futures/btc, delivery/usdt and options paths return 404 (openresty HTML), and margin/currency_pairs returns []. Spot has 385 pairs, all tradable: 354 quoted in USDT and 31 in USD. | unknown | Recommended: spot.order_book with payload [pair,"20","100ms"] on wss://ws.gate.us/v4/. It sends the whole top 20 levels, bids descending and asks ascending, on subscribe (129 to 130 ms) and again on every change. lastUpdateId only grows, with 0 repeats and no sequence to track. The alternative, spot.order_book_update, sends 100ms diffs only and no snapshot. Its rule is U = previous u + 1 (0 gaps in 10,097 and 8,821 diffs across 385 pairs). Its diff levels arrive unordered, and it has to be seeded from a REST with_id book that is cached for up to 29 s, so the documented recipe failed on BTC_USD in both passes. No checksum. The server does not negotiate permessage-deflate. All 385 pairs ran on one socket at a median of about 200 frames/s. spot.obu does not exist ("Unknown channel spot.obu"). | none. There are no index, mark or funding endpoints because there are no perpetuals, and the futures paths return 404. The spot ticker `last`, high_24h and low_24h do not come from Gate US trades. The BTC_USD last trade was 8 h old, and a BTC_USDT ticker `last` sat above its own lowest ask. They appear to track global Gate, which is an inference. No poller is recommended. | Who may trade: Gate US, Inc. (NMLS 2272810) serves natural persons aged 18 or over who live in the US. It "does not currently operate" in Alaska, Texas, Louisiana, the US Virgin Islands, New York, Washington or North Carolina, so this host's state (Washington) is excluded. What this host got: the website (www.gate.com/en-us, us.gate.com, the docs) returned 403 to curl and an Akamai "Access Denied" page to headless Chrome, so the docs were read through WebFetch. api.gate.us REST answered 200 in 71 to 85 ms warm, and wss://ws.gate.us/v4/ opened in 208 to 322 ms. | spot only |
| 14 | Independent Reserve, [`../profiles/independentreserve/`](../profiles/independentreserve/) | independentreserve | spot | none. CCXT sets swap false at independentreserve.js line 30, and all 168 CCXT markets are spot. The only leverage is website-only margin loans: 2x to 5x on BTC/ETH/XRP/DOGE/SOL against AUD, with interest of 0.1 %/day long and 0.03 %/day short, no funding rate and no API. | 5000 | Undocumented by the venue: wss://websockets.independentreserve.com/orderbook/<depth>?subscribe=xbt-aud,... (CCXT Pro pro/independentreserve.js lines 29 and 146). Any positive depth works, and depth 50 was measured. A snapshot comes on subscribe, then OrderBookChange deltas where Volume 0 deletes. No sequence or nonce exists, and the only integrity check is a per-frame CRC32 of the top 10 levels per side, sent unsigned. CCXT compares it signed, so it fails on about half the frames. No compression. Two problems: (1) books diverge when one socket carries 168 pairs at about 2,000 frames/s (5,610 to 38,859 bad checksums per run), while 42 pairs is clean. (2) the BTC/AUD and ETH/AUD socket books are always crossed by stale asks that no REST book shows, which stayed at least 26 minutes. The documented order-level protocol at the root path closed every socket 0 to 4 ms after the upgrade. | none. No index, mark or funding exists, and no bulk ticker: GetMarketSummary takes one call per pair, 168 calls. GetFxRates (fiat rates, cached 1 min) is the only published reference rate. | Only residents of 38 listed countries may trade. The US is not listed, so US persons may not. Entities are Independent Reserve Pty. Ltd. (AU and NZ) and Independent Reserve SG Pte. Ltd. (MAS licence PS20200517). From this host near Seattle, public REST (AWS Sydney ELB) returned 200 with no refusal: 656/661 ms cold, 153 to 156 ms warm. The /orderbook WS opened in 610 to 696 ms and delivered. The documented root WS path upgraded (101) and then dropped the connection with 1006 and no frame, and a plain GET on the root returned 500. | spot only |
| 14 | bitFlyer, [`../profiles/bitflyer/`](../profiles/bitflyer/) | bitflyer | perpetuals | JPY-margined Crypto CFD 1 (FX_BTC_JPY, successor of Lightning FX since 2024-03-28), USDT-M 0, USDC-M 0, USD-M 0, coin-M 0 | 0 | JSON-RPC 2.0 at wss://ws.lightstream.bitflyer.com/json-rpc. A book needs two channels. lightning_board_snapshot_FX_BTC_JPY sends 300 bids and 300 asks about every 5 s (4,898 to 5,111 ms apart). It is not sent on subscribe: the first one came 0.6 to 3.7 s after subscribing. lightning_board_FX_BTC_JPY sends only changed levels plus mid_price, at 7.1 to 7.7 frames/s, and size 0 deletes a level. There is no sequence id, no timestamp and no checksum. Delta levels arrive unordered. A book fed only deltas misses some deletions, so the feed must reset on every snapshot. mid_price matched the local mid on every delta (456 of 456). No permessage-deflate. The server sends a protocol ping every 15 s. Unknown products are acked true and then stay silent. | No index and no mark: /v1/getindex and /v1/getmarkprice return 404, and CCXT fetchFundingRate returns markPrice and indexPrice undefined. GET /v1/getfundingrate?product_code=FX_BTC_JPY returns current_funding_rate (a fraction per 8 h, fixed at the previous settlement, so it is known 8 h ahead) and next_funding_rate_settledate (UTC with no Z). The interval is not a field. Funding history shows 8 h settlements at 05:00, 13:00 and 21:00 UTC. There is no bulk call. The only proxies are the venue's own: the spot BTC_JPY ticker and the CFD's ltp, which is what positions are valued at. Price clamps act on trading, not on a mark: a 5% divergence breaker against bitFlyer's dealer spot mid and a 15% breaker against the last trade 10 minutes earlier. The REST limit is 500 requests per 5 minutes per IP. getticker and getboard are edge-cached for about 1 s. | Crypto CFD is an OTC derivative with bitFlyer, Inc. as counterparty (Japan: Kanto LFB crypto No. 00003, FIBO No. 3294). It is listed only in the JP region. The US and EU market lists (/v1/getmarkets/usa and /eu) return 4 Spot rows each and no FX product, so US persons cannot trade it through bitFlyer USA. The residency rule is not verified: bitflyer.com (fee, terms and funding-rule pages) closed the TLS session with an unexpected EOF for curl on this host and returned HTTP 403 to WebFetch. From this host near Seattle, the public REST api.bitflyer.com (Akamai edge, IPv4 only) answered 200 with no refusal. The WebSocket ws.lightstream.bitflyer.com (Azure Japan East) opened in 336 to 392 ms with no refusal, and so did lightning.bitflyer.com. | blocked |
| 14 | Azbit, [`../profiles/azbit/`](../profiles/azbit/) | none | perpetuals | USDT-M linear 161 (157 xxxUSDT, the index pair $BTC_TOP, and TSLA, BRENT and EURUSD). No USDC-M, coin-M, dated futures or options. Spot has 448 pairs. CoinGecko's derivatives list of 214 venues does not include Azbit. | 500 | wss://ws.azbit.com/futures/orderbooks-snapshots with {"Method":"subscribe","CurrencyPairs":["BTCUSDT",...]}. Every frame is a full replace of 20 levels per side and carries no sequence, timestamp or checksum, so gaps cannot be detected. It is not a snapshot-then-delta channel, and futures has no delta channel. Frames come every 290 to 382 ms at the median on busy pairs (as little as 39 ms apart, although the docs say at most every 500 ms). A quiet pair went up to 23.7 s without a frame. Sizes are base-asset JSON numbers. Deflate is not negotiated. 161 pairs ran on one socket at 240 to 289 frames per second. Unknown pairs are acknowledged and then stay silent. Every frame matched a Bybit linear orderbook.50 state the probe had already received, with a median lag of 90 to 168 ms. | One bulk call, GET https://data.azbit.com/api/futures/exchange-data/pairs (45 KB, 161 rows, median 312 to 332 ms). It has fundingRate plus fundingRateStartTimestamp and fundingRateFinishTimestamp (UTC strings with no Z), which give the interval (87 contracts at 8 h, 74 at 4 h) and the next settlement. There is no index and no mark in any public REST call or WS channel, so mark would be 0 and every route would be refused as anchor_no_mark. No cap or formula is published, and there is no funding history call. The rate matched Bybit's current rate on 116 and 119 of 154 shared contracts. It did not change within 60 one-second polls but did change between two runs 20 minutes apart. | Operated by AZ Strategic Ltd, whose AML policy cites Belize. CoinGecko lists Seychelles. The limits page marks 47 countries noAccess for all services, including the US, CA, GB and most EU/EEA states, so US persons may not trade, and futures need KYC. From this host near Seattle, every public REST call returned 200 and every public WS route returned 101 through Cloudflare SEA/YVR, with no geoblock. The documented /time WS route returns 404. | blocked |
| 14 | BVOX, [`../profiles/bvox/`](../profiles/bvox/) | none | perpetuals | USDT-M: 383 CoinGecko tickers on 2026-09-23, against 97 in BVOX's own web-app config archived 2026-08-02. USD-quoted (-SWAP-USD): 5 CoinGecko tickers. CoinGecko's API counts 389 perpetuals and 0 dated futures. None of these was probed live, because every host refused this machine. | 600 | Could not be checked: every socket handshake was refused (21 over three runs). The candidates were wss://www.bvox.com/ws/quote/v1 (404, taken from the archived web-app bundle) and wss://wsapi.bvox.com/openapi/quote/ws/v1 (503 nginx, taken from the BHEX template). The BHEX template, which BVOX never confirmed, names depth and diffDepth topics. It sends "f":true on the first entry, uses a version string v with no documented gap rule and no checksum, and offers an optional binary payload. Level count, compression and the snapshot were all Not verified. | None. The BHEX template bulk calls /openapi/quote/v1/contract/index and /openapi/contract/v1/fundingRate, and the web app's /api/contract/funding_rates, all return 404 on api.bvox.com, www.bvox.com and api.bitvenus.me. CoinGecko rows show an index and a funding rate for each contract, so BVOX computes both. No mark source is known. Funding interval, next funding and clamps are Not verified. | BVOX's registration country list (archived 2025-04-21, 197 countries) leaves out the US, Canada, mainland China, Singapore, the UK, the Netherlands, Russia, North Korea, Iran, Cuba, Syria and Myanmar, so US persons may not trade. Its archived web config of 2026-08-02 put an Internet Archive address in the United States under riskIpDisabled (enableStatus "1", meaning undocumented). Cloudflare places this host in Canada (loc=CA, colo YVR). What it returned: www.bvox.com, futures.bvox.com, www.bvox.io and www.bitvenus.me all serve a static 200 page of 33,223 bytes that reads "Services are temporarily unavailable in your region. Current IP: Not Support Region." (Last-Modified 2026-08-24). Every API and docs path answers 404 (a 335-byte page on the site hosts, a 146-byte nginx page on api.*), and the BHEX socket paths on wsapi.* answer 503. No reply carried Retry-After and no 429 appeared. The Internet Archive has also been served the refusal page since 2026-09-02. | blocked |
| 10 | BYDFi, [`../profiles/bydfi/`](../profiles/bydfi/) | bydfi | perpetuals | USDT-M 255, USDC-M 3, coin-M 8 (all state 0 in the post-upgrade catalog on 2026-09-22. CoinGecko still shows 271, which looks like pre-upgrade data) | 600 | wss://futures.bydfi.com/edge, which uses MEXC's contract protocol. The channel is sub.depth.full with limit 20, pushed as push.depth.full, and every frame carries the whole top 20 per side. No snapshot or seed is needed, and a frame whose version is below the last applied one is dropped. Limit 5 was accepted and limit 30 was refused. The alternative is sub.depth: merged deltas with no snapshot, which need a REST seed and chain as begin = previous end + 1, with 0 gaps on 150 contracts. There is no checksum. Frames are JSON text only and permessage-deflate is not negotiated. A client ping is required, because the socket closes at about 60 s without one. | Two bulk calls on https://api.bydfi.com/api/v1/contract. /ticker gives indexPrice, fairPrice (the mark) and fundingRate for all 266 contracts, about 142 KB with a median of 121 to 127 ms. /funding_rate gives fundingRate, collectCycle (8 h on 105 contracts, 4 h on 161), nextSettleTime in ms and a cap of ±0.02 (±2%), about 44 KB with a median of 116 to 123 ms. Neither call alone has all five AnchorRow fields, and unlike MEXC's reply, the funding reply has no index or mark. The published rate is the upcoming one. No mark premium clamp is published. The index uses 1 to 10 external sources per contract and never BYDFi itself, but ONE_USDT uses Binance alone and 11 contracts are indexed only on other venues' futures. | The User Agreement (2026-09-18) bars residents of the US, Canada, UK, Singapore, Hong Kong, Mainland China, Kazakhstan, the Russian-controlled regions of Ukraine and sanctioned or FATF-listed countries, so US persons may not trade. It names no legal entity, only "BYDFi Trading Platform", with HKIAC arbitration. From this Seattle host, every documented public path on https://api.bydfi.com/api/v1/fapi/... and v1/public/api_limit(s) returned HTTP 404 {"code":404,"msg":"Not Found"}. developers.bydfi.com and stream.bydfi.com have no A record, so the documented WebSocket fails with ENOTFOUND. The same host's new paths (/api/v1/contract/*, /api/v3/*) and wss://futures.bydfi.com/edge returned 200 and delivered data, with no geoblock or region notice. | fits with a named change |
| 10 | DigiFinex, [`../profiles/digifinex/`](../profiles/digifinex/) | digifinex | perpetuals | USDT-M 103, coin-M 8 (inverse, 1 USD per contract, including TRXPERP, which has no USDT-M twin). Also 7 simulated contracts, returned only with type=1. The USDT-M list includes 36 TradFi or pre-IPO contracts of 0.01 units, plus XAUT and XAG. No dated futures, no options. | 500 | depth.subscribe on wss://openapi.digifinex.com/swap_ws/v2/ (one URL for linear and inverse), level 10, 20 or 100, with no speed option. The first frame is a snapshot flagged by an undocumented top-level "full_data":true. Later frames are deltas applied by price (amount 0 deletes), and the venue keeps the level window. Delta bids arrive ascending. There is no sequence field and no checksum, so a lost delta cannot be detected. In about 13,500 depth frames no book crossed, and books matched REST 40/40 and 200/200. Every frame is a binary message carrying zlib data (header 78da), which needs inflating (median 38 to 47 µs per frame). Permessage-deflate is not negotiated. The hard cap is 30 channels per connection: a 31st closes the socket with 1006 and no reply. The server closes a socket after 60 s without any client message, even while it is pushing, so the client pings with server.ping. | GET /swap/v2/public/tickers (weight 1, 111 rows, about 50 KB, median 187 to 206 ms) gives index_price and mark_price in bulk. No call returns funding in bulk. The per-instrument funding_rate call returns the last settled rate (111 of 111 matched history), and it reports an 8 h interval and 08:00 UTC even for the 8 four-hour contracts. The upcoming rate and its correct time come only from per-instrument funding_rate_history?start_timestamp=now&limit=1 (weight 10) or the WS fund_rate channel. The interval comes from the history steps: 8 h on 103 contracts, 4 h on 8. Index is a weighted multi-venue basket, and no basket endpoint exists. Mark is the median of a funding-basis price, a mid-basis moving average and the last price, with no published mark clamp. The observed mark-to-index gap had a median of about 500 to 560 ppm and a max of 5,076. The order band is about ±5 % of the index (max_buy_price and min_sell_price). The only funding clamp is ±0.05 % on the interest term. The IP budget is 6,000 weight per minute. | Terms (edited 2026-09-21) list 16 countries and regions not served, among them the US, Canada, the UK, Singapore and Hong Kong, and say US and Singapore citizens are not accepted, so US persons may not trade. This host's public IP geolocates to Vancouver, CA (ipinfo), and DigiFinex's own headers say country: CA. Even so, every well-formed public REST call returned 200 with ip-weight headers, and the WS upgraded with 101 and streamed. The website answered 302 to digifinex.ca. The help center HTML returned 403 to this host and to WebFetch, and was read through the Zendesk help center API, which returned 200. | fits with a named change |
| 10 | XT.COM, [`../profiles/xt/`](../profiles/xt/) | xt | perpetuals | USDT-M 691 (1,096 listed, 728 trading, 691 trading and open to the API), coin-M 30 (78 listed, inverse, USD-sized contracts) | 600 | depth_update@<id>,100ms on wss://fstream.xt.com/ws/market (both families on one socket). Levels: full-book deltas, not capped at 50. No snapshot on subscribe. Seed options: REST q/depth (levels 5 to 1000), or a depth@<id>,50 frame whose id is in the same sequence, as long as it can be bridged to the first delta. Gap rule: fu == prev u + 1 (pu == prev u). 0 gaps in 3,371 deltas. A 400-stream socket saw 0, 0 and 574 breaks in three runs. No checksum. Plain text JSON: permessage-deflate is not negotiated even when offered. | No single bulk call has all five fields, so the poller needs three. q/index-price gives index for 729 rows (40 KB, about 190 ms). q/mark-price gives mark for 731 rows (36 KB, about 190 ms). cg/contracts gives funding_rate, collection_internal in hours (1/4/8) and next_funding_rate_timestamp in ms for 732 rows (454 KB, median 392 to 553 ms, max 1,090 ms). Its index copy refreshes only about every 2 s. The published rate is the upcoming estimate and moves 1 to 2 times a minute. Clamps: funding interest term ±0.05%. Per-contract funding caps exist (FTT ±2.5% in 2022) but are unpublished. The mark is documented as capped at 1% from the index, but 4 contracts sat beyond 1% (NFLX index 10x its price). The mark equals the last trade on 268 of 691 contracts. XT's own spot is in the index basket. | Users in the US, Canada, mainland China, Cuba, North Korea, Singapore (IPs blocked since 2025-06-20), Sudan, Venezuela and Crimea are prohibited, and the UAE since 2026-04-14. US persons may not trade. Entity not named, Seychelles per CCXT and CoinGecko. From this host, every public REST call on fapi and dapi returned 200 via CloudFront SEA900 and wss://fstream.xt.com/ws/market opened in 365 to 444 ms, with no geoblock. Refusals seen: wss://fstream.xt.com/ws returned HTTP 404, dstream.xt.com gave ENOTFOUND, and help-center HTML gave 403 (Cloudflare) while its Zendesk JSON API gave 200. | fits with a named change |
| 10 | OKJ, [`../profiles/okj/`](../profiles/okj/) | none | spot | none (instruments SWAP, FUTURES and MARGIN return empty data, OPTION answers 51014 "Index doesn't exist". 47 spot pairs, all quoted in JPY) | 1400 | V5 public `books` on wss://ws.okj.com:443/ws/v5/public: snapshot on subscribe with prevSeqId -1, holding the whole book (400-level cap, the deepest pair had 149 bids). Deltas every 100 ms, chained per pair by prevSeqId === previous seqId, with 0 gaps in about 7,500 deltas. A signed CRC32 checksum over the top 25 levels matched on all 7,641 frames. Frames are plain text JSON. The server grants permessage-deflate only when the client offers it, so the engine's refusal is fine. Text ping and pong keepalive. A socket with no subscription and no client frames is closed at exactly 30 s with code 4004. The legacy V3 socket (wss://connect.okj.com/ws/v3) deflates inside every binary frame and has no sequence id. | none: public/mark-price, funding-rate, funding-rate-history, price-limit, estimated-price and open-interest return 404. market/index-tickers returns empty data or code 52000, and index-components returns 500 with code 50026. No mark, index or funding WS channel exists (all answer 60018). The only index is the off-API daily OKJ BTC Index (bid, ask and average, stamped 16:00 JST), so a recommended poller is not applicable. | Accounts are for residents of Japan only (operator OKCoin Japan K.K., Kanto Local Finance Bureau crypto-asset exchange registration No. 00020, JVCEA member). US persons cannot trade, and the United States is also on the withdrawal declaration list. From this host near Seattle, REST on api.okj.com (AWS Tokyo) answered HTTP 200 with a warm median of 122 to 146 ms. The WS opened in 470 to 623 ms on 18 sockets, with no geoblock. The only refusal was the support.okcoin.jp help center HTML, which returned a Cloudflare 403 challenge. Its Zendesk JSON API answered 200. | spot only |
| 10 | PointPay, [`../profiles/pointpay/`](../profiles/pointpay/) | none | perpetuals | USDT-M 172, every one a Bybit linear perpetual that is Trading on Bybit (57 crypto, 9 innovation, 89 stock, 13 ETF, 4 commodity). No USDC-M, no coin-M, no dated futures, no options. Spot is separate, with 148 markets. | 850 | orderbook.50.<symbol> (1 and 200 also offered, 30 refused) on wss://ws-futures.pointpay.io/v5/public/linear. This socket is undocumented and was taken from the web terminal's systemParams FUTURES_WS_HOST. It relays Bybit v5 public linear unchanged: Bybit's update ids, and the same frame and byte counts in run 1. One snapshot on subscribe, then deltas. data.u rises by one per delta, with 0 gaps in 5,042 and 5,495 deltas over 60 s and in 43,168 and 50,406 deltas on 172 topics. No checksum. permessage-deflate is negotiated only when offered. It arrives 69 to 82 ms (median) after Bybit's own socket. An idle socket is closed at about 61 s. | GET https://api.pointpay.io/public/coingecko/futures/contracts gives index_price, funding_rate and next_funding_rate_timestamp (Unix ms) for all 172 contracts, in about 104 KB with a median reply of about 505 ms. It has no mark and no interval. The mark is only per pair (pair-data or full-pair-data, and full-pair-data also has fundingIntervalHour), under a 500 per 60 s x-ratelimit. Every value is Bybit's, served from caches of about 6 s (pair-data), at least 20 s (full-pair-data) and 30 to 60 s (bulk), so readings differed from live Bybit by up to 2,813 ppm (mark) and 2,706 ppm (index). Intervals are 8 h on 143 contracts and 4 h on 29. The per-contract funding cap is Bybit's, for example 0.00333 on BTCUSDT and 0.02 on ZMUSDT. | Operator is PointPay Limited, under the courts of Saint Vincent and the Grenadines. The terms exclude domiciles in Iran, Syria, North Korea, Iraq, Sudan, Afghanistan, Libya, Cuba, Somalia, Myanmar, Yemen, Lebanon, Venezuela, South Sudan, CAR, Cote d'Ivoire, Eritrea, Liberia, Russia, Belarus, Crimea, Luhansk and Donetsk, and PRC users. EU service ceased on 2026-07-01. The US is not named, and the futures terms exclude any jurisdiction needing a licence PointPay lacks without saying which, so whether US persons may trade is not stated. Every REST call returned HTTP 200 and every WS socket opened for this host near Seattle, through Cloudflare (cf-ray YVR or SEA), with no refusal. | blocked |
| 17 | CoinJar Exchange, [`../profiles/coinjar/`](../profiles/coinjar/) | none | spot | none. All 302 active products are spot pairs (452 with ?all=true). The docs mention no margin, leverage or funding, and CoinGecko's derivatives list of 214 venues does not include CoinJar. | 600 | Phoenix channel `book:{id}` on wss://feed.exchange.coinjar.com/socket/websocket, joined one topic per phx_join frame. It shows 40 levels per side and includes implied levels, and about 90% of the displayed levels are implied only. An `init` snapshot arrives on join, then [price,size] string deltas in no set order, where size 0 deletes a level. There is no sequence number, no timestamp and no checksum, so a gap cannot be detected. Resync is the `request_snapshot` event, and the maintained book differed from that snapshot in 0 of 40 levels in 44 checks. Text JSON frames. Deflate is negotiated only if the client asks. The client must send a heartbeat every 45 s, or the socket closes after 60 to 66 s. A `native_book:{id}` channel gives native levels only, uncoalesced. | none. No index, mark or funding exists, and there is no bulk ticker (data.exchange.coinjar.com/products returns 404). The per-product ticker has an undocumented `mark_price` that is usually near median(bid, ask, last), but its rule is not verified. That ticker is edge-cached for about 1 s, with stale-while-revalidate=15. | Operators are CoinJar Australia Pty Ltd (AUSTRAC) and CoinJar UK Ltd (FCA-registered). The exchange fee table appears only on the global, AU and UK fee pages, not the IE or DE pages. The help centre lists AU, IE, UK, DE and 20 US states as supported, with Washington among 30 "coming soon" states and 45 prohibited jurisdictions, while the Exchange intro article says verification requires Australian residence, so whether a US person can trade on the exchange is not verified. From this host near Seattle, all public REST calls returned 200 through Cloudflare SEA/YVR edges and every socket open got 101, with no geoblock or challenge. | spot only |
| 17 | CoinEx, [`../profiles/coinex/`](../profiles/coinex/) | coinex | perpetuals | Ceased on 2026-09-22. The catalog still lists USDT-M 201, USDC-M 18 and coin-M 2 (BTCUSD, ETHUSD), all marked "online", but all 221 books are empty. CoinGecko still shows 223 perpetual pairs with 0.0 BTC of 24 h volume. | 500 | wss://socket.coinex.com/v2/futures carries all three families. depth.subscribe takes [market, limit 5/10/20/50, merge interval, if_full] and sends a full push on subscribe, then pushes every 200 ms when the book changes, plus a full push every minute. The frames carry no sequence id. A signed CRC32 checksum of the full book stands in for one. Every frame is gzip inside a binary frame and permessage-deflate is not negotiated, so a feed would have to gunzip each frame. On 2026-09-23 UTC all 221 futures books came back as full pushes with empty arrays and checksum 0. | Before the cessation, two bulk calls covered every column. GET /v2/futures/ticker (221 rows, 55 KB) has index_price and mark_price. GET /v2/futures/funding-rate (221 rows, 53 KB) has latest_funding_rate, next_funding_time and latest_funding_time. The interval is next minus latest, 8 h on all 221. Caps were ±0.015, ±0.0075 or ±0.00375. GET /v2/futures/index has the baskets (BTC: Binance 0.5, OKX 0.2, KuCoin 0.15, Bybit 0.15). All of it has been frozen since 2026-09-22 03:10 UTC. The BTCUSDT mark sits 28,782 ppm below its index, and next_funding_time is 2026-09-22 16:00 UTC, in the past. The median gap between CoinEx and Binance index prices is about 40,000 ppm. | CoinEx announced an orderly cessation (notice created 2026-09-14). New registrations stopped and futures went reduce-only on 2026-09-15. Futures ceased on 2026-09-22 and open positions were force-settled at the index price. Spot ceases on 2026-09-29 and withdrawals end on 2026-12-22. The US, mainland China, Hong Kong, Canada, the EEA, the UK, Switzerland and a few other places were prohibited even before this. From this host, api.coinex.com (CloudFront SEA73) answered HTTP 200 on every public call in 99 to 184 ms. wss://socket.coinex.com opened in 327 to 404 ms with no refusal, but it serves only empty futures books and frozen state. | defunct |
| 17 | Poloniex, [`../profiles/poloniex/`](../profiles/poloniex/) | poloniex | perpetuals | USDT-M 18 (all linear, all OPEN). No USDC-M, coin-M, dated futures or options. Spot is 870 CCXT markets, 831 active. | 600 | book_lv2 on wss://ws.poloniex.com/ws/v3/public. It sends 20 levels a side and a snapshot on subscribe. An update applies when lid equals the previous id, and ids skip. There were 0 gaps in 50,763 and 61,811 updates over two 61 s runs with all 18 perps on one socket, at a median of 808 and 969 frames/s. There is no checksum. Server deflate was not negotiated. Frames are JSON text, sizes are in contracts (ctVal = CCXT contractSize). One update arrived before its snapshot, once in 36 subscriptions. The server closes a socket after 30 s with no client message, so a {"event":"ping"} is needed every 15 s. symbols ["all"] is refused. | Index and mark come from bulk calls: GET /v3/market/indexPrice (iPx) and GET /v3/market/markPrice (mPx). Each returns 18 rows of about 730 B with a median of 111 ms. tickers also carries both, but its iPx is undocumented. There is no bulk funding call, because fundingRate needs a symbol. The poller maps nFR (the predicted upcoming rate) and nFT (next settlement in ms), and derives the interval as nFT minus fT, which is 8 h on all 18. fR is the last settled rate. The funding cap exists in the formula, but its values are not published. There is no published clamp on mark premium. The mark is median(index-based Price1, Price2, last trade), and it equalled the last trade on 259 of 1,080 readings. The index is a spot basket of Binance, OKX and Poloniex spot (0.055 to 0.292), plus KuCoin and huobi on 5 or 6 contracts. The bulk basket call is public. | The user agreement (revised 2026-04-01) bars the US and its territories, the UK, all EU states, Singapore, Hong Kong, mainland China and sanctioned regions, and bars futures only for Burundi and Morocco. US persons may not trade. From this host near Seattle, every public REST call returned HTTP 200 via CloudFront POP SEA900 with no refusal, and the v3 public WS opened in 400 to 429 ms. | fits with a named change |
| 17 | BitMart, [`../profiles/bitmart/`](../profiles/bitmart/) | bitmart | perpetuals | USDT-M 354 (92 crypto and 3 TradFi traded in the last 24 h), USDC-M 1 (BTCUSDC), coin-M 4 (BTCUSD, ETHUSD, XRPUSD, SOLUSD). Of the 359 contracts marked Trading, 259 had zero 24 h volume and many have null books, so the live set is 100. There are also 856 Delisted rows, and CoinGecko's 933 matches neither count | 600 | futures/depthIncrease50:<symbol>@100ms on wss://openapi-ws-v2.bitmart.com/api?protocol=1.1, one socket for every family. 50 levels. Snapshot on subscribe (type snapshot), then updates where version must equal last + 1 (0 gaps in 10,462 updates on 100 contracts). No checksum. Plain text frames: deflate is negotiated only if the client asks. Every book channel pushes once a second at every depth and speed, despite @100ms. The subscribe frame is capped near 2 KB, since 2,186 bytes got close 1009, not the documented 4,096. Keepalive is {"action":"ping"}, because the text ping is refused | GET /contract/public/details (1.05 MB, all contracts, refreshes about every 2 s) has index_price, expected_funding_rate (the upcoming settlement), funding_rate (the last settled), funding_interval_hours (8, 4 or 1) and funding_time in ms. GET /contract/public/funding-rate-v2 (18 KB, the 96 live linear contracts, estimate refreshes once a minute) has expected_rate, rate_value, funding_time and a cap of ±3.75 %. No REST call returns the mark in bulk. The mark comes only from WS futures/ticker without a symbol (mark_price and index_price, each live contract every 1.9 to 6.0 s) or from per-symbol markprice-kline, which is limited to 12 per 2 s. No clamp is published for crypto marks. TradFi contracts have mark_price_bound_ratio 0.05 | Contracting entity is GBM Global Inc. (Marshall Islands). US persons are excluded: no new US registrations since May 2022, and existing US accounts were told to close all positions by 2026-08-08. Mainland China futures have been suspended since 2021. No other public list of excluded regions was found. From Seattle, every public REST call (Cloudflare edge YVR, HTTP 200, code 1000) and every WS socket answered, with no 403 and no 40047. The help center HTML returned 403, but its Zendesk API returned 200 | fits with a named change |
| 17 | CoinDCX, [`../profiles/coindcx/`](../profiles/coindcx/) | none | perpetuals | USDT-M 504 (the same 504 B-<base>_USDT contracts under USDT or INR margin, 6 of them Binance TradFi commodity perps). No inverse contracts, no dated futures. Options and INR stock/index Global Futures exist in the product but have no public API | 590 | Socket.IO v4 on wss://stream.coindcx.com/socket.io/?EIO=4&transport=websocket, join `<id>@orderbook@{10/20/50}-futures`. Events are depth-snapshot (the full window) and depth-update (Binance @depth@500ms diff, E equal to Binance's event time, filtered to the window, plus CoinDCX zeros), one frame per 500 ms tick. No snapshot on join (the first frame was an update on 3 to 5 of 6 streams). Seed from the REST orderbook of the same depth, whose vs matched the stream on 6 of 6. vs steps +1 per pair and depth, 0 gaps in about 69k frames. No checksum, no compression (deflate not negotiated). data is a double-encoded JSON string routed on s spelled BTCUSDT plus pr. 504 streams on one socket | GET public.coindcx.com/market_data/v3/current_prices/futures/rt (126 KB, 541 keys, median 45 to 70 ms). Mark: mp, equal to Binance markPrice. Funding: efr (upcoming, equal to Binance lastFundingRate on 504 of 504) and fr (last settled, which caught up with the 04:00 UTC settlement on 502 of 504 pairs by 04:04 UTC). No index, no bulk interval (per-pair funding_frequency of 1, 4 or 8 h), no next funding time. The mark arrives about 1.6 to 2 s after Binance stamped it, and the clamps are Binance's | Only Indian citizens or residents may trade (Neblio Technologies Pvt Ltd, FIU VA00030982), so US persons are excluded. From this host near Seattle: api.coindcx.com and public.coindcx.com (Cloudflare) returned 200, and stream.coindcx.com (AWS Mumbai) returned 101. The coindcx.com web pages returned 403 with a Cloudflare block (Ray a3f66d3cbd6776f2). docs.coindcx.com and support.coindcx.com returned 200 | blocked |
| 32 | BigONE, [`../profiles/bigone/`](../profiles/bigone/) | bigone | perpetuals | USDT-M 97 active (43 crypto, 49 stock, 2 metal, 3 commodity, plus 4 disabled: EOS, MATIC, XIN, TON), coin-M inverse 2 (BTCUSD, ETHUSD). 99 active in total, which matches CoinGecko's 99. | 600 | wss://api.big.one/ws/contract/v2/depth@{symbol}. The URL is the subscription, so each socket carries one symbol and there is no subscribe frame. It sends the whole book with no window, which is thin: 8 to 30 levels per side and often under 20. A snapshot comes on connect (from 0, no symbol key), then deltas. On the wire each delta's from equals the previous to (757 of 757 checked), not the documented to+1, and the ids are one global sequence. Size 0 deletes a level. There is no checksum and no timestamp. Prices are object keys, unordered. Sizes are JSON numbers in contracts of multiplier coins (the inverse books count 1 USD contracts). Frames are text JSON with no compression (deflate not negotiated). The server sends no ping, and a protocol ping or {"ping":n} is answered. The rebuilt book equalled the REST snapshot at the same id on every level. | GET https://big.one/api/contract/v2/instruments returns all 99 contracts in one call (42 KB, median 190 to 293 ms). It carries indexPrice, markPrice, fundingRate (fixed per interval, inferred to be the upcoming settlement's rate) and nextFundingTime in Unix ms. The funding interval is in no public call: 8 h by default, 4 h for 24 contracts announced 2026-09-02 plus 5 more found from the mark formula, and 1 h for SKRUSDT. The mark is index*(1+fundingRate*timeUntil/interval), so its premium is only the funding basis (median 40 to 45 ppm, max 660). The index republishes every 5 s. Funding cap is 75%*(IM-MM), which is 0.375% on BTCUSDT, with TradFi caps of +/-2% and +/-0.5%. No public funding history or index basket call exists. The WS instruments channel carries the same rows. | Global operator (Bigone Investment Ltd., AIFC Kazakhstan, for Eurasia users). The User Agreement excludes US citizens and residents. The Restricted Locations list was not found. From this host through the Canadian VPN exit (loc=CA, colo YVR): contract REST 200, contract WS 101, API docs 200, help center API 200. The help center HTML returned 403 with a Cloudflare challenge. wss://api.big.one/ws/v2 returned 403 Akamai Access Denied. | fits with a named change |
| 32 | WOO X, [`../profiles/woo/`](../profiles/woo/) | woo | perpetuals | USDT-M linear 223 (PERP_*_USDT, all TRADING, 4 h or 8 h funding). No USDC-M, coin-M, dated futures or options. Spot is 88 USDT and 2 USDC pairs. CoinGecko lists 224 perps. | 300 | wss://wss.woox.io/v3/public, orderbookupdate@PERP_X_USDT@50 (also 200 and 500). It carries only non-RPI orders, the only ones an API taker can fill. No snapshot on subscribe: the first frame is a delta. Sequence: data.prevTs must equal the previous data.ts, with 0 gaps in 108 book frames and 173 batch frames. Seeding is from REST /v3/public/orderbook with prevTs equal to the snapshot timestamp. That worked on ETH and SOL but never on BTC, because the BTC REST book lagged the socket by up to 46.6 s. No checksum. Levels are strings in base coin (contractSize 1), bids descending, asks ascending. Real caps are 10 topics per request (11 to 21 refused, docs say 20) and 100 topics per connection. The server closes a socket after 60 s with no client frame, so a PING is needed. Permessage-deflate is not negotiated, so frames arrive as plain text JSON. Unknown or duplicate topics are acked success with data []. | Two bulk calls. GET /v3/public/futures (223 rows, about 126 ms, 10 KB gzip) gives indexPrice, markPrice, estFundingRate (upcoming, re-estimated each minute), lastFundingRate and nextFundingTime in ms. GET /v3/public/fundingRate adds estFundingIntervalHours (4 or 8). Clamps: funding = clamp(avg premium/(8/N), per-symbol cap and floor, mostly ±0.02), but 190 and 188 of 223 rates sat exactly on 0.0001×N/8, a baseline the docs do not mention. The mark is the median of three prices, and it is forced to the index when book liquidity is below the impact notional. On every poll, 53 to 90 of 223 perps had mark exactly equal to index, which is the capped-mark trap. The index averages Binance, OKX, WOO X spot, Gate, Bybit and KuCoin. No public basket call. SOLV index is null, and EWT funding has been frozen in the past. | WOOTECH Limited Corp, Panama law. Excluded for all services: the US, Canada and 22 other jurisdictions, so US persons may not trade. EEA users can trade but lose referrals and promotions. From this host (Surfshark exit in Canada, SEA edge), every public REST v3 call returned 200 and the v3 and legacy v1 sockets served data with no geoblock. support.woox.io HTML returned 403 with a Cloudflare challenge to curl, WebFetch and headless Chrome. Its Help Center API returned 200 JSON. | fits with a named change |
| 32 | Delta Exchange, [`../profiles/delta/`](../profiles/delta/) | delta | perpetuals | USDT-M 6 on global (BTC, ETH, SOL, XRP, DOGE, PAXG. All linear, all active in CCXT). No USDC-M, coin-M or dated futures. Delta Exchange India (api.india.delta.exchange) is a separate residents-of-India platform with 220 USD perps and no CCXT 4.5.68 class. | 300 | ob_updates on wss://public-socket.delta.exchange (the legacy l2_updates on wss://socket.delta.exchange is identical apart from longer key names). Whole-book snapshot on subscribe, 20 to 51 levels per side, arriving 105 to 115 ms after the subscribe. Then diffs where seq must equal last+1: 0 gaps over two 60 s runs and one 30 s run. A CRC32 cs of the top 10 levels per side matched every frame. Bids descend and asks ascend on the wire. Sizes are integer strings in contracts, which equals CCXT contractSize. Cap of 100 symbols per connection. Unknown symbols are acked but never deliver. The compact URL negotiates no deflate, and the legacy URL negotiates it only when offered. A socket with no activity is closed at 60 s. A ping gets a pong, and enable_heartbeat sends a heartbeat every 5 s. | GET /v2/tickers?contract_types=perpetual_futures (about 6.9 KB, 6 rows) returns spot_price (index), mark_price, and funding_rate in percent per interval (a running estimate, divide by 100). There is no interval and no next funding time in it. The interval is in GET /v2/products as product_specs.rate_exchange_interval (8 h, PAXG 4 h). nextFundingAt must be computed on the 00/08/16 UTC grid, or read from the WS funding_rate channel (nfr). The origin republishes about every 2.5 to 3.2 s, and CloudFront caches for 2 s. A nonce query parameter bypasses the cache. Timestamps are 0.6 to 5.5 s old on arrival. Mark = index + fair basis, where the fair basis is a 60 s moving average. The mark premium is capped by basis_factor_max_limit: 1% for BTC and ETH, 2% for XRP and DOGE, 3% for PAXG, 52% for SOL. Funding = avg premium + clamp(0.01% − avg premium, ±0.05%), with a cap from annualized_funding (1% per 8 h for BTC and ETH). Index baskets are binance, okex, bybit and kucoin spot, and none includes Delta's own market. | Global is run by Bit Protocol S.A (Panama), a subsidiary of Protocol Labs Pte Ltd (Singapore). Its terms exclude US citizens and residents, and residents of Canada, India, the UK, most EU states, UAE and others. Hong Kong persons may not trade spot, and Singapore natural persons are excluded. The India platform (Excelium Technologies) serves residents of India only. From this host's Canadian Surfshark exit (SEA CloudFront edge), every well-formed public REST call returned 200 and both public sockets opened in 404 to 577 ms, with no geoblock or refusal. The global docs host docs-global.delta.exchange does not resolve (NXDOMAIN), so a Wayback capture from 2026-01-30 was used. | fits with a named change |
| 32 | CoinUp.io, [`../profiles/coinup/`](../profiles/coinup/) | none | perpetuals | USDT-M 59 (CoinGecko lists 97 USDT perpetual tickers and a summary of 98, but 38 of the 97 were delisted by the venue on 2026-09-20). No catalog call could be probed, because every CoinUp host answered with a Cloudflare challenge. A coin-margined family appears in the 2024 guide but is not in CoinGecko's list, so it is not verified. | 600 | Not verified. Every WebSocket upgrade (7 URLs on futuresws, ws, futures and www.coinup.io, in the ChainUp kline-api/ws shape) was refused with HTTP 403 and cf-mitigated: challenge in 41 to 63 ms, before any frame. The API doc page is behind the same challenge. By inference from the ChainUp platform (bittime profile), the channel would be market_e_<sym>_depth_step0 with gzip-in-binary frames, but none of this was observed on CoinUp. | None readable. /fapi/v1/index, /ticker and /contracts on futuresopenapi.coinup.io all returned 403 challenge. On the ChainUp shape the index call serves one contract per request, so no bulk anchor would exist even with access. The only formula text is an archived 2024 guide, which still lists FTX in the index. It says: mark = median(latest, reasonable, index + 60-minute MA of basis), 8 h funding, rate clamped to ±0.375% with a ±0.05% interest clamp, and the rate is fixed one period ahead. CoinGecko shows index and funding per perp but no mark, interval or next settlement. | Who may trade is not verified. The user agreement, fee page and API doc all return a Cloudflare challenge. A help-center article refers to a restricted countries list that could not be read. CoinGecko lists Singapore. From this host (Surfshark exit that Cloudflare places in Canada, SEA and YVR edges), all 22 REST URLs on 13 coinup.io hosts and all 7 WebSocket URLs returned HTTP 403, server cloudflare, cf-mitigated: challenge, and a 5.4 KB "Just a moment..." page with no Retry-After. WebFetch from outside this host also got 403. The Wayback Machine holds challenge captures dated 2025-06-28 to 2026-09-12. Only the Zendesk help-center API (helpcenter-coinup.zendesk.com) answered 200. | blocked |
| 32 | HitBTC, [`../profiles/hitbtc/`](../profiles/hitbtc/) | hitbtc | perpetuals | USDT-M linear 50 working, plus 4 suspended and 1 expired still listed (CoinGecko shows 48). USDC-M 0, coin-M 0. No dated futures or options. Spot has 1,170 working markets. | 700 | orderbook/full on wss://api.hitbtc.com/api/3/ws/public, one URL for spot and perps. On subscribe it sends a snapshot of the whole book (BTC about 297 bids and 181 asks, no 20-level window). After that come per-symbol updates of changed [price,size] strings, where "0" deletes a level and an unchanged side is an empty array. Sequence rule: s must equal the previous s + 1, including after the snapshot. There were 0 gaps in 17,719 updates over two runs, and 50 perps on one socket ran at about 170 to 194 frames/s. No checksum. Text JSON, and permessage-deflate is not negotiated. Sizes are in the base coin, matching CCXT contractSize 1, and the socket book equalled REST on 20 of 20 levels. An unknown symbol is acked with no error and never delivers. The alternative, orderbook/D20/100ms, sends whole 20-level frames only on change. The server sends a protocol ping every 30 s, and a client that does not pong is closed at 60 s with code 4002. | GET /public/futures/info is one bulk call for all 55 contracts (18.8 KB, median 144 ms). It carries index_price, mark_price, funding_rate and next_funding_time (ISO). There is no interval field: every contract settles every 8 h at 00, 08 and 16 UTC, so the interval is the constant 8. The reply is regenerated only every 3 s. The mark is index × (1 + funding_rate × time-to-next / 8 h), rounded to the tick. It held within half a tick on 3,000 of 3,000 row polls, so the mark premium is capped by the funding rate and never sees the book (mark equalled index on 1,920 of 3,000). The funding rate is avg premium + clamp(0.01% − avg premium, ±0.05%), with no overall cap. funding_rate stays fixed for the interval and is read as upcoming, although the docs contradict each other on this. The index is a last-trade average over 7 venues including HitBTC, with no basket call. The HIT index equals HitBTC's own spot last price. The 5 non-working rows carry mark 0 or a next funding time in the past. The CELUSDT_PERP row is refreshed only about once a minute and its book is empty. | The operator is Htechno Business LTD (Saint Vincent and the Grenadines law). The terms bar the US, Canada, UK, EEA, Japan, Australia, Hong Kong, Singapore, South Korea, Brazil, Russia, Ukraine, Cambodia, sanctioned regions and US-embargoed places, so US persons may not trade. From the Canadian VPN exit: the hitbtc.com website (fees, futures, terms) answered 403 with a Cloudflare page saying "IP address of a restricted region", Location CA, and WebFetch also got 403. support.hitbtc.com answered 200. api.hitbtc.com REST answered 200 on every public call (edge YVR). The public WS opened in 604 to 1,202 ms (edge SEA) and served every channel. There was no refusal on market data. | fits with a named change |
| 28 | BTCBOX, [`../profiles/btcbox/`](../profiles/btcbox/) | btcbox | spot | none | 500 | No WebSocket exists. The docs name an HTTP API only, CCXT sets ws false (btcbox.js line 118) and ships no Pro class, the web client polls AJAX every 3,000 ms, and six wss:// upgrade attempts on www.btcbox.co.jp were refused (HTTP 200 HTML or HTTP 500). The only book is REST GET /api/v1/depth?coin=<id>: a whole snapshot each call, with no sequence, no timestamp, no checksum and no compression. BTC holds 4 levels per side, BCH and LTC 15/15, ETH 18/21. On the wire asks and bids are both descending, while the docs claim bids run low to high. | none. There is no index, mark, funding, interval or next funding, and no reference price. Only the ticker fields buy, sell and last exist, and the bulk GET /api/v1/tickers carries all 7 JPY markets in one call. | BtcBox Co., Ltd. (Kanto FSB registration No. 00008). Terms Article 2 (revised 2025-06-24) bar residents or persons located in the United States and in AML-uncooperative jurisdictions, and anyone who may not hold a bank account in Japan, so US persons may not trade. Through the Canadian Surfshark exit (Cloudflare loc=CA, SEA and YVR edges), every public REST call returned HTTP 200 with data, and no WebSocket endpoint exists. support.btcbox.co.jp (Zendesk) returned HTTP 403. | spot only |
| 33 | Aivora Exchange, [`../profiles/aivora/`](../profiles/aivora/) | none | perpetuals | USDT-M 72 (48 crypto, 24 TradFi: 4 metals, 3 energy, 17 equities/ETFs), USDC-M 5 (BTC, ETH, SOL, XRP, DOGE, each also listed on USDT), coin-M 0. Counted from GET openapi.aivora.com/futures/open/fapi/v1/contracts: 241 rows, 77 status 1, 164 status 0. All linear (side 1), all perpetual (type E). No dated futures or options. Spot (42 pairs) and margin exist. CoinGecko's derivatives id list has aivora-exchange-futures, but its detail call answers 404 "market not found" and the ranked list of 113 derivatives venues leaves it out. | 500 | market_e_<base><quote>_depth_<tick> (for example market_e_btcusdt_depth_0.1, with the tick taken from depthList[0] in the web public_info_v2) on wss://openapi.aivora.com/futures/ws. One URL serves USDT-M and USDC-M, one channel per sub frame, and 77 streams on one socket worked. Every push is a whole window of 30 levels per side, best first. Each level has four string columns: price, contracts, cumulative contracts, cumulative price*contracts. The first frame carries eventResp:"sub" and comes 360 to 670 ms after the subscribe. No deltas, no sequence or update id, no checksum. BTC pushes about 2.2 to 2.5 times a second, quiet books about 0.5 times a second, and the longest silence seen was 6.6 s. Frames arrive as text JSON, although the docs say gzip binary, and permessage-deflate is not negotiated. Unknown, delisted and wrong-step channels, and non-JSON input, all get silence. The server pings {ts,ping} every 10 s and needs {pong:n} back. A subscribed socket closes about 10 s after its sixth unanswered ping, and an unsubscribed socket closes after about 20 s whatever it sends. The documented client {"ping":"ping"} does not count as a pong. | No bulk call. Per contract, GET https://openapi.aivora.com/futures/open/fapi/v1/index?contractName=E-BTC-USDT returns indexPrice, tagPrice (the mark), currentFundRate and nextFundRate as JSON numbers, with no time and no contract name. Median reply 380 to 400 ms, max 2.4 s. A one-at-a-time sweep of all 77 took 29 to 32 s. Interval and next settlement are not in the open API. They come only from the web call POST https://api.aivora.com/futures/api/common/public_info_v2: capitalFrequency 8 h on all 77, nextCapitalSettTime in ms (08:00 UTC, with E-XAG-USDT offset to 12:00 UTC). The docs' reply shape and host (futuersopenapi.aivora.com, NXDOMAIN) are wrong. Index: the white-label help center gives OKX, Huobi and Binance at 1/3 each for BTC and ETH, with a ±3% outlier clamp. No other basket is published. Mark: median(latest, reasonable, moving average). It equalled Aivora's own last trade on 29 to 53 of 60 polls, and it equalled the index exactly on 21 to 22 of 77 contracts, mostly TradFi. No mark clamp is published. Funding: the socket says admin_fund_rate_source "third", and REST currentFundRate equals the socket's last_fund_rate_third. The third party is unnamed and matches none of Binance, OKX, Bybit, Gate or HTX. No cap numbers, no public funding history, and the rate charged at settlement is not verified. The socket ticker market_<sub> carries the same numbers about once a second. | Operator named Aivora Ltd. (Hong Kong governing law, claims a FinCEN MSB registration, and CoinGecko lists the UAE). Futures are not offered to the US, UK, Canada, China, Hong Kong, Macau, Taiwan, Iraq, Cuba, Iran, North Korea, Sudan, Syria, Bangladesh, Ecuador, Kyrgyzstan and the US territories. The User Agreement also bars the US, Canada (Alberta), Singapore, the Netherlands and others, so US persons may not trade. From this host through the Canadian Surfshark exit (Cloudflare loc=CA, colo YVR): every open API REST call returned HTTP 200 (Huawei CDN via Mexico edges, about 0.4 s round trip), the futures WS returned 101 on all 15 opens, and the fee data call and website returned 200, with no refusal. The web app's wsUrl futuresws.aivora.com is NXDOMAIN, and the old api.aivora.com open API path returns 404. | fits with a named change |
| 33 | Bitbaby, [`../profiles/bitbaby/`](../profiles/bitbaby/) | none | perpetuals | USDT-M 335 (this includes E-XAU-USDT and E-PAXG-USDT, the two contracts tagged Tradfi), USDC-M 23 (each of the 23 is also listed against USDT), coin-M 0. The count comes from the web catalog POST web-api.bitbaby.com/futures/api/common/public_info_v2, where every contract is linear and perpetual. There are no dated futures or options. Spot has 83 pairs and is named only. | 600 | The book channel is market_e_<sym>_depth_<tick> on wss://web-api.bitbaby.com/futures/ws. This socket is undocumented and was found in the web app bundle, and one URL serves USDT-M and USDC-M. Each frame carries 40 levels per side, and every frame is a whole book. The first frame after a sub carries "eventResp":"sub" and serves as the snapshot, and there are no deltas. There is no sequence field and no checksum, so a lost frame cannot be detected. Pushes come on change at about 200 ms on busy contracts and up to 3.6 s apart on quiet ones. All 358 contracts fit on one socket at 447 to 472 frames/s. Without a query, frames are text JSON. With ?compress=1 they are binary zlib flushed without a trailer, which needs a Z_SYNC_FLUSH inflate. permessage-deflate is not negotiated. The server sends {"ping":n} every 10 s and the client answers {"pong":n}. A subscribed socket that never answers is closed at 66 s. Unknown symbols and wrong steps get no reply at all. | None in bulk. The per-contract call POST /futures/api/common/public_market_info {"contractId":n} returns indexPrice, tagPrice (the mark), currentFundRate and nextFundRate, with a median of about 125 ms, so the full catalog would take 358 calls per round. Interval (capitalFrequency, in hours: 8 on 91 contracts, 4 on 260, 1 on 7) and next funding (nextCapitalSettTime, Unix ms) appear only in the 358 KB catalog, which takes 1.6 to 2.7 s. The WS ticker market_e_<sym> carries index_price, sign_price and funding for every contract on one socket, but 180 to 197 of the 358 contracts went more than 10 s without a frame (max 53 s). Funding appears copied from a third venue: admin_fund_rate_source is "third" on every frame, and currentFundRate sat within 3 ppm of Binance lastFundingRate on BTC and ETH. The BTC REST tagPrice equalled the index on every poll. No clamps or basket calls are published, and no funding history endpoint was found. | Who may trade: the User Agreement names ECO-CYBER, Inc (CoinGecko lists the UAE) and lists no excluded regions. However, the site's POST /spot/api/common/is_us_ip answered isUS:true with the text "restricted region where Bitbaby does not provide products or services" for this Canadian VPN exit (216.246.31.78, Cloudflare loc=CA). So US persons are refused, and this exit is treated as US. What this host got: every web-api.bitbaby.com REST call returned HTTP 200 and the futures WS upgraded with 101 via Cloudflare SEA/YVR. The documented docs.bitbaby.com/en/ returned nginx 404, as did openapi.bitbaby.com and /en-us/exchange-open-api. futures.bitbaby.com is ENOTFOUND. The configured wsUrl api.influencelab.xyz fails TLS because its certificate is for symini.com. | no public API |
| 33 | BTCC, [`../profiles/btcc/`](../profiles/btcc/) | none | perpetuals | USDT-M 346, USDC-M 11, coin-M 6, TradFi USDX 21. Counts come from the web quote socket dictionary, because the OpenAPI product list needs a login. 35 to 41 of the USDT contracts carry a trading schedule. Dated futures and options are absent from the dictionary, and spot exists. | 480 | No public book channel exists. The Nov 2023 OpenAPI quote socket (wss://kapi1.btloginc.com:9082) needs an account login, fails its hostname certificate check (*.btcc.com) and answers the documented path with 404. The web page socket wss://wkd2.btloginc.com/quot/reqloginNew works after an anonymous login with a constant key from the page bundle. It sends tickinfo_deep: a full book of 7 levels per side about every 274 ms. There is no snapshot/delta split, no sequence number, no checksum, and T is in 1 s resolution. Only one `deep` contract fits per ReqSubcri, so one socket carries depth for one contract. Bids arrive descending and asks ascending. Text JSON with no permessage-deflate. KeepLive is needed about every 10 s, or the socket closes at about 30.5 s with code 1006. | No bulk call exists. There is no index and no mark: liquidation and PnL use the platform's two-way bid/ask, and the rules say futures do not use a mark or average price. The only anchor field is funding. It comes from an undocumented web call, POST https://www.btcc.com/v2/symbol/getFundrate {"symbol":"BTCUSDT"}, which takes one symbol per call and no login. It returns {"fundrate":463,"fundratetm":"0,8,16"}. The value appears to be in units of 1e-6 (inferred) and is an estimate, not the last settled rate. Settlement is every 8 h at 00, 08 and 16 UTC, with no next-funding field. The clamp bounds a and b are not published. History is at POST /v2/symbol/getFundrateLog. | The operator is BTCC Limited, Hong Kong (CR 1956541). The terms exclude sanctioned persons and anyone barred by applicable law, and they publish no region list. Whether US persons may trade is not publicly specified. All results below come from a Surfshark exit in Canada (Cloudflare loc=CA, SEA edge). www.btcc.com returned HTTP 200 to every call the probe made. The web IP limit config came back all null. The web quote socket upgraded with 101. The documented OpenAPI REST host api1.btloginc.com:9081 timed out, and port 443 returned 503 with an empty body. The documented quote host failed TLS hostname verification. The API guide help articles returned 404 RecordNotFound to anonymous Zendesk reads. | no public API |
| 33 | FameEX, [`../profiles/fameex/`](../profiles/fameex/) | none | perpetuals | USDT-M 213 active of 246 listed (33 status 0), all linear, type E, multiplier is the contract size. They include unflagged equity, commodity and index perps (AAPL, NVDA, XAU, NATGAS, HK0700). USDC-M 0, coin-M 0, no dated futures, no options. Spot has 95 USDT symbols and is named only. | 600 | market_e_<base lowercase>usdt_depth_step0 on wss://futuresws.fameex.com/kline-api/ws. Every data frame is binary gzip inside the WS frame. Each push is a whole book of 13 to 184 levels per side, sent every 500 ms (p50 499 to 501 ms) whether or not it changed, so it is a snapshot every push with no deltas. No ack, no sequence, no checksum. Asks ascending, buys descending, numbers not strings, size in contracts (inferred). Unknown and closed symbols are silently ignored. The documented 'ping' heartbeat closes the socket with 1000 Bye. {"pong":ms} is the working keepalive. Server negotiates permessage-deflate if offered. 213 contracts on one socket: 426 frames/s, 435 KB/s gzipped. | No bulk call. GET /fapi/v1/index?contractName=E-BTC-USDT (documented, one contract, ~250 ms) has indexPrice, tagPrice (mark), nextFundRate and currentFundRate. Interval comes only from the undocumented GET /v1/inner/contract_config (capitalFrequency: 4 h on 124, 8 h on 87, 2 h on 1, 1 h on 1). Next funding is absent but computable, since 213 of 213 settle on multiples of the interval from 00:00 UTC. Formula and caps are unpublished. capitalPremiumMin/Max ±0.0005 is not a rate cap (KERNEL settled -1.2858% per 4 h). Mark equals last trade on 65 to 77 of 213. BTC index changed only 2 to 3 times per minute. | Operator FAMEEX INTERNATIONAL PTY LTD (Australia, AUSTRAC DCE registered). The Terms restrict the US, Canada, the UK (retail), Hong Kong (retail derivatives), Singapore, Malaysia, the Netherlands, Malta and others, so US persons may not trade. From this host via the Canadian Surfshark exit, every public REST and WS endpoint answered 200 with no refusal, behind the Imperva CDN. | fits with a named change |
| 33 | Globe, [`../profiles/globe/`](../profiles/globe/) | none | perpetuals | USD-margined linear 28 active (30 listed, IOTA-PERP and ALPHA-PERP Suspended). No inverse, quanto, BTC-VIX, dated futures or options. Spot is 3 pairs, named only. | 500 | wss://globe.exchange/api/v1/ws, channel "depth" with {"command":"subscribe","channel":"depth","instrument":"BTC-PERP"}, one instrument per frame. Every frame is a whole book of up to 25 levels per side, sent every 100 ms (the docs say twice a second) on one 100 ms tick shared by all perps. An unchanged book is resent (about 55 to 70% of frames). No sequence, no checksum, no ack. The server sends a protocol ping every 4 s and closes with 1008 if there is no pong. Deflate is not negotiated. Sizes are in the base currency, so contractSize must be 1. The touch is dust, median 2 to 16 USD. | GET https://globe.exchange/api/v1/ticker/contracts returns index_price, mark_price, funding_rate (a percentage, so divide by 100) and next_funding_time (Unix ms) for all 30 perps in one reply of about 25 KB, median 116 ms. The interval is only in the WS product-detail channel (funding_period 28800 s, 8 h on all 30). The mark is a 30 s EMA of the 10k USD impact price in Globe's own book, and inserted levels hold it inside index ±2% (BTC, ETH), ±5.75% or ±10%, so the premium is capped. Funding has a ±0.05% dead band, an 8 h TWAP and no cap, and the published rate moves between settlements. The REST limit is 1 request per second, so poll at 2 s. | Operator is Globe Derivative Trading INC, Panama. The terms exclude US residents and US passport holders. The 237-country supported list includes Canada but not the US, UK, Iran, Cuba, North Korea, Syria or Afghanistan. From this host through the Canadian Surfshark exit (Cloudflare loc=CA, colo SEA/YVR), every public REST call returned 200, apart from the deliberate 400/404 error cases, and both WS URLs opened in 433 to 749 ms. Nothing was refused. | fits with a named change |
| 20 | Orbix, [`../profiles/orbix/`](../profiles/orbix/) | none | spot | none. There is no perpetual, dated future, option or margin product: isMarginTradingAllowed is false on all 111 symbols, /api/v3/premiumIndex and /api/v3/fundingRate return 404, and CoinGecko's derivatives list of 214 exchanges does not include Orbix. Spot has 111 pairs, all quoted in THB: 104 TRADING and 7 BREAK. | 2500 | Recommended: <pair>@depth20@100ms on its own raw socket, wss://www.orbixtrade.com/ws/<pair>@depth20@100ms. Every frame is a full 20-level book. It arrives about 10 times a second and is resent even when unchanged (528 to 614 of about 620 frames a minute repeat the id). Empty books are sent too. The frame names no symbol, so it needs one socket per pair, and it needs no sequence. Levels 5, 10 and 20 are served. 50, 100 and the documented @1000ms speed open but send nothing. Alternative: diff <pair>@depth@100ms, subscribed with SUBSCRIBE on /ws/stream. It carries s. The documented /stream?streams= redirects with 307, and /ws/stream?streams= is ignored. The diff stream sends no snapshot, so a REST /api/v3/depth limit=1000 snapshot is needed first. The first frame has U equal to the snapshot's lastUpdateId. Chain rule: U equals the previous u, not u+1 (1,380 of 1,380 frames). The id counter is shared by every pair. A book built this way matched depth20 on 4,521 of 4,521 comparisons. No checksum. permessage-deflate is not negotiated, and frames are text JSON. A client frame over about 2 KB gets close code 1009 (2,030 bytes accepted, 2,211 refused). An unknown method or non-JSON text closes the socket. The server pings at about 60 s. A socket that has received nothing and never written is closed at about 60 s. A client ping every 20 s kept a socket open for 120 s. | none. There is no index, mark or funding: /api/v3/premiumIndex, /api/v3/fundingRate, /api/v1/premiumIndex and /api/fapi/v1/premiumIndex all return 404. The only reference prices are in ticker/24hr (lastPrice, weightedAvgPrice, bidPrice, askPrice): one 36 KB reply covering 104 pairs. Its btc_thb lastPrice and bidPrice did not change over 2 x 59 one-second polls while the book did. No anchor poller is recommended. | Who may trade: operator is Orbix Trade Company Limited (Thai SEC-licensed digital asset exchange, owned by Unita Capital, part of Kasikornbank). Individuals must be 20 or older, live in Thailand and hold a Thai bank account and phone number. A US person is admitted only while living in Thailand and showing FATCA compliance. The public configs call returns kyc.foreigner_use_version "closed". From this host, through the Surfshark exit that geolocated to Canada (Cloudflare loc=CA, colo=YVR): all public REST returned 200, served by Akamai and then CloudFront KUL62 in Kuala Lumpur. Cold ping took 354 to 779 ms, warm 209 to 473 ms, and depth polls had a median of 243 to 252 ms. The WebSocket opened in 260 to 990 ms. Nothing was geoblocked. Errors seen: unknown or halted symbol gives HTTP 500 internal_server_error, per-pair fees give 401, and the /api/broker/* and /ws/broker paths give 404. | spot only |
| 20 | Catex, [`../profiles/catex/`](../profiles/catex/) | none | spot | none. There is no futures, perpetual, options or margin product: the site menu is Market, Trading, Asset, News, Staking and Faucet, /futures, /contract and /swap return 404, futures.catex.io does not resolve, and Catex is not among the 214 entries on CoinGecko's derivatives list. Spot has 64 pairs: 46 USDT, 11 BTC, 6 ETH, 1 TRX | 1000 | STOMP 1.2 over WebSocket at wss://www.catex.io/stream (Spring STOMP broker). The book comes on /topic/order/buy/{BASE}/{QUOTE} and /topic/order/sell/{BASE}/{QUOTE}, each frame the full top 16 levels of one side, best first. There is no snapshot on subscribe: COSA/BTC sent 0 frames in 45 to 75 s, so the web page seeds each side from REST. There are no deltas, no sequence, no timestamp and no checksum. The message-id counter is shared across sessions. A side is pushed at most about every 0.5 s (minimum gap 515 ms), and identical repeats occur. The server grants heart-beat 0,0 and drops a socket that carries no traffic either way at 60 s (code 1006). A client newline every 20 s keeps it open. There is no compression unless the client offers permessage-deflate. 128 subscriptions (all 64 pairs) ran on one socket at about 17 frames/s | none. There is no index, mark or funding, and no interval or next funding. The only reference prices are last_price in /api/cmc/summary and /api/cmc/ticker and priceByUSD in /api/token/list. cmc/summary is rebuilt only every 30 s. No anchor poller is recommended | The Terms bar the US and all its territories, China incl. HK/Macao/Taiwan, Singapore, Canada, France, Germany, Malaysia, Malta, Spain, Netherlands, UK, Austria, Bolivia, Venezuela, Uzbekistan, Myanmar and sanctioned regions. US persons may not trade. The operator is named only as "Catex", and CoinGecko lists its country as China. From this host's Canadian VPN exit (Cloudflare loc=CA, SEA/YVR edges), every public REST call returned HTTP 200 JSON (errors come as code 1 inside a 200, an unknown route as 404) and the WebSocket upgraded 101 in 92 to 162 ms. There was no geoblock or challenge, even though Canada is a restricted location | spot only |
| 20 | BTCMarkets, [`../profiles/btcmarkets/`](../profiles/btcmarkets/) | btcmarkets | spot | none (51 spot markets: 44 AUD, 4 USDT, 3 BTC quoted, 49 Online. CCXT swap/future/option false at btcmarkets.js lines 30 to 32. Absent from CoinGecko's 214-venue derivatives list) | 8500 | orderbookUpdate on wss://socket.btcmarkets.net/v2, one URL for every market. It sends the whole book as a snapshot on subscribe (about 1,040 bids on BTC-AUD, no window), then one absolute [price, volume, count] level per delta. There is no sequence number, because snapshotId is a millisecond clock in microseconds. Up to 33 deltas stamped as much as 124 ms before the snapshot arrive after it and have to be skipped. Every delta carries a CRC32 checksum of the top 10 levels per side, built from the strings as sent, with 0 mismatches on deltas stamped at or after the snapshot over 61k deltas. No compression unless the client offers permessage-deflate. There is no ack: an unknown id rejects the whole frame. Keepalive is the heartbeat channel (every 5 s), and the server closes a socket after 60 s without traffic. addSubscription gives a fresh snapshot without reconnecting. The orderbook channel lists single orders (top 50) and sends no snapshot on subscribe. | none. No index, mark, funding, interval or next settlement exists. The only bulk call is GET /v3/markets/tickers?marketId=... (bestBid, bestAsk, lastPrice, 24 h fields, last-change timestamp), which returns all 51 ids in one call, 12.6 KB, median about 235 ms. CCXT fetchFundingRate(s) and fetchMarkPrices are false. No anchor poller is recommended. | Per ToS v1.1 (28 Apr 2026, BTC Markets Pty Ltd, AUSTRAC VASP), traders must be Australian residents unless BTC Markets accepts them at its discretion as Approved Overseas Users or Liquidity Providers. US persons are not named, so they can trade only if accepted that way. Sanctioned jurisdictions are excluded, and Broker Services are for Australian residents only. From this host (Canadian Surfshark exit, Cloudflare loc=CA, SEA/YVR edges): api.btcmarkets.net answered 200 on every public call, and socket.btcmarkets.net upgraded 101 on all 20 sockets. www.btcmarkets.net (fees, terms), docs.btcmarkets.net/v3 and support.btcmarkets.net/hc answered HTTP 403 with a Cloudflare 'Just a moment...' challenge (cf-mitigated: challenge) to curl and WebFetch, and to headless Chrome on /fees. Fees and terms were therefore read from Internet Archive copies. | spot only |
| 20 | Mercado Bitcoin, [`../profiles/mercado/`](../profiles/mercado/) | mercado | spot | none | 7000 | `orderbook` on wss://ws.mercadobitcoin.net/ws. One subscribe frame per market, id = CCXT market.id (BRLBTC). Allowed limits are 10, 20, 50, 100 and 200, and the most recent subscribe sets the depth for every stream on the socket. Each frame is the whole top-N book, pushed only when the book changes. There is no snapshot on subscribe: 162 and 166 of 401 books stayed silent for 40 and 30 s. There is no sequence number and no checksum. Bids are descending and asks ascending, all as JSON numbers, with sizes in base currency. The server negotiates permessage-deflate only when the client offers it. | none. The venue publishes no index, mark, funding, interval or next funding. The only reference prices are ticker buy/sell/last. The bulk call is GET /api/v4/tickers?symbols=<list>, where symbols is required: 409 CRYPTO rows in one call of 73 KB, median 113 to 129 ms. No anchor poller is recommended, since mark 0 means anchor_no_mark. | Accounts need a Brazilian CPF, and foreigners also need a Brazilian address, or a CNPJ, at Mercado Bitcoin CTVM S.A. under Banco Central do Brasil rules. US persons are not named, but anyone without a CPF and a Brazilian address is excluded. From this host through the Canadian Surfshark exit (Cloudflare SEA edge), api.mercadobitcoin.net v4 and www.mercadobitcoin.net v3 returned 200 on every valid public call, and wss://ws.mercadobitcoin.net/ws opened in 203 to 295 ms. www.mercadobitcoin.com.br (fee page and docs) returned 403 with the Cloudflare page 'Sorry, you have been blocked' to this host and also 403 to WebFetch. | spot only |
| 20 | Coinzoom, [`../profiles/coinzoom/`](../profiles/coinzoom/) | none | spot | none | 6000 | OrderBookRequest (aggregate false, depth 0. One pair per frame, ack {"OrderBookResponse":{...,"result":"subscribed"}}) on wss://api.coinzoom.com/api/v1/public/market/data/stream. It sends one `ob` snapshot on subscribe, never repeated, then `oi` deltas about every 260 ms. The entries are level 3 orders [id, price, amount]: an id alone deletes, a full entry adds. Ids are recycled across sides, so keep orders per side and sum them into levels. The window is 100 orders per side (67 levels on BTC/USD). There is no sequence, update id, checksum or timestamp, so gaps cannot be detected. Probe checks found the book matched the ms ticker (321 of 321 frames) and REST top 20 levels. aggregate true is acked but silent. A nonzero depth gets no reply. Text JSON, permessage-deflate not negotiated. The server pings every 10 s and closes a socket that does not answer at about 36 s (4000 Pong Timeout). | none: spot only, no index, mark, funding, interval or next funding anywhere in the public API. The only reference prices come from its own book: last_price (GET /marketwatch/ticker), highest_bid/lowest_ask (GET /marketwatch/summary, 73 pairs, about 19 KB), and the ms ticker mid. | Who may trade: CoinZoom, Inc. (FinCEN MSB, NMLS 1735216) serves US residents and non-US users except in Australia, and CoinZoom Australia PTY LTD serves Australia. US persons may trade in every state except New York (licence pending, New York cannot be selected at sign up). 38 countries are excluded, including Canada and the UK. What this host saw: all calls went out through the Canadian VPN exit (Cloudflare colo SEA or YVR, trace loc=CA). Every public REST call answered 200 and all 14 probe WS opens answered 101, with no geoblock. The only refusal was a Cloudflare 403 'Access denied / CoinZoom' HTML page for a request sent with no User-Agent header. | spot only |
| 22 | Foxbit, [`../profiles/foxbit/`](../profiles/foxbit/) | foxbit | spot | none | 5000 | orderbook-100 (also -250, -500, -1000, and plain orderbook at 1000 ms. orderbook-50 is refused with close 1008 even though the docs use it in an example) on wss://api.foxbit.com.br/ws/v3/public. With "snapshot": true it sends one snapshot of up to 300 levels per side about 150 ms after subscribe. Without that flag there is no snapshot. Deltas are per-market sequenced: first_sequence_id must equal the previous last_sequence_id + 1, and the first delta is the snapshot sequence_id + 1. 0 gaps in 721+616 deltas on 4 markets and 6,351+6,827 deltas on 50 markets. No checksum and no compression (deflate is not negotiated). Delta arrays are unordered, so apply them by price. Size "0" deletes a level. Sizes are base currency and match REST 40 of 40 at the same sequence. Caps: 25 subscriptions per frame, 50 per connection. One unknown symbol closes the whole socket with 1008. | none: no index, mark or funding exists. The nearest bulk call is GET /rest/v3/markets/ticker/24hr (133 rows, 53.6 KB, best bid/ask prices and last trade only, cached 10 s). /markets/quotes only simulates a fill. No anchor poller is recommended. | Only Foxbit Serviços Digitais Ltda (Brazil) accounts may trade. Registration needs a CPF, a Brazilian address and an own bank account, or a CNPJ for companies. The terms name no excluded region, and a FATCA clause implies US persons holding a CPF are accepted. From this host (Surfshark exit, Cloudflare loc=CA, colo SEA/YVR) every public REST call returned 200 (unknown ids 404) and every WS upgrade returned 101, with no 403, 451 or geoblock. | spot only |
| 22 | Young Platform, [`../profiles/young-platform/`](../profiles/young-platform/) | none | spot | none. The Pro web app bundle ypp-2.26.1 contains a futures module that uses One Trading's API, but its config sets FUTURES_ENABLED false, bff /api/status has no futures flag, and /api/futures/markets returns 404. CoinGecko's list of 214 derivatives venues does not include Young Platform. | 4000 | SOR.OB.<pair> on wss://api.youngplatform.com/api/socket/ws. Each frame is a full 8-level snapshot per side (5 to 7 bids on ADA-EUR and ONDO-EUR at times), sent about once a second: [pair, bids, asks, tsMs]. The first frame arrives 260 to 896 ms after subscribe. There are no deltas, no sequence or id and no checksum. About 1 frame in 3 exactly repeats the previous one with the same ts, and ts is 0.2 to 2.2 s old on arrival. Sizes are in base currency. Bids are descending and asks ascending. The cap is 20 topics per connection. A 21st gets ERR_INSUFFICIENT_CREDITS. The server sends an app {"type":"ping"} every 30 s, no protocol ping, and a client ping gets a pong. Compression: permessage-deflate is not negotiated. The book is indicative liquidity from external venues, not a venue order book. | none. There is no index, mark or funding. The only reference price is the WS SOR.PI.<pair> 'price index', which has no REST twin and reads as the router's own book mid (median 0 ppm from the SOR.OB touch midpoint, -138 to 39 ppm range). REST liquidity also returns mid_price. No anchor poller is recommended. | Young Platform S.p.A. (Turin) is a MiCAR CASP authorised by Consob and Banca d'Italia on 2026-06-30. It does not operate a trading platform. Residents of the US and its territories may not register, so US persons may not trade. No other country list is published beyond EU high-risk AML countries. From the Canadian VPN exit (Cloudflare YVR/SEA edges), every public REST call returned 200 (401 on private, 400/404 on bad input) and every WS open returned 101 in 673 to 884 ms. There were no refusals or challenges. | spot only |
| 22 | Changelly PRO, [`../profiles/changelly-pro/`](../profiles/changelly-pro/) | none | perpetuals | USDT-M 18 working (plus LUNAUSDT_PERP expired since 2022-05-13). No USDC-M, coin-M, dated futures or options. Spot 328 working in the coverage matrix only | 500 | orderbook/full on wss://api.pro.changelly.com/api/3/ws/public (one socket for all 18 perps and spot): every level (133 to 301 per side, no window), snapshot on subscribe arriving with the ack in 136 to 145 ms, per symbol sequence s = previous + 1 on every update (0 gaps in 2,210 updates on 4 perps and 4,876 on all 18), no checksum, levels sorted on the wire, size "0" deletes, sizes in underlying coins with CCXT contractSize 1, no compression (permessage-deflate not negotiated), server protocol ping every 30 s and close 4002 at 60 s if unanswered. Unknown symbol is acked with an empty subscriptions list. Orderbook/D20/100ms is the alternative (whole 20-level snapshot per frame, about 60 to 70 ms later) | GET https://api.pro.changelly.com/api/3/public/futures/info, one bulk call, 6.6 KB, median 142 to 144 ms: index_price, mark_price, indicative_funding_rate (next settlement. Funding_rate is the LAST settled one, and CCXT hitbtc maps that to fundingRate), next_funding_time as ISO. No interval field, 8 h at 00/08/16 UTC from 30 days of history. The numbers move on a 3 s grid and a quiet row lagged up to 5.5 s (one 11 s reading). Mark = index x (1 + funding_rate x time to next settlement / 8 h), 18 of 18 rows, so the mark carries no book premium. Funding = P + clamp(I - P, +-0.05%), with I = 0.0001, fitting 1,604 of 1,620 rows. Unpublished per contract floors at -0.3% (BCH) and -0.29% (MANA). Cap and index basket not published | Operator is Alqentra LLC (jurisdiction unstated. The footer says Changelly PRO Solution Inc., CoinGecko says Seychelles). The terms (updated 2026-09-16) exclude US citizens, residents and entities, Spain, Crimea and Sevastopol, Cuba, North Korea, Sudan, Syria and US-embargoed territories. Futures need KYC and 2FA, and the app blocks futures in some countries whose list is not published. From this host, via the Canadian Surfshark exit (Cloudflare colo=YVR, loc=CA): every public REST call answered 200 or a documented 400/404 error, and all 14 sockets opened in 467 to 1,194 ms with no refusal. The support site sent 302 to a login page. | fits with a named change |
| 22 | Emirex, [`../profiles/emirex/`](../profiles/emirex/) | none | spot | none (checked five ways: no derivatives in the API docs, config margin_pair_list is [], /api/default/ticker-margin returns empty data, CoinGecko's 214-venue derivatives list has no Emirex entry, /v1/public/fundingRate returns 404). Spot has 12 pairs: 11 against USDC plus USDCUSDT | 8000 | socket.io (Engine.IO 4) on wss://socket.emirex.com/socket.io/?EIO=4&transport=websocket. The client sends "40" to join the namespace, then 42["subscribe",{"type":"book","event":"book_<pairId>"}]. The feed covers the whole book with no level window, one level per message, and rate and volume as integers of 1e-8. volume is the absolute level size and {} deletes a level. There is no snapshot on subscribe, so the book is seeded from REST /v1/public/book, whose sequenceId is the same counter. sequenceId is per room and rose by exactly 1 each message: 0 gaps in 464 and 453 steps. The rebuilt book matched a fresh REST read at the same sequenceId in both runs. No checksum. No permessage-deflate is negotiated. The server pings "2" every 25 s and closes at 45 s without a "3" reply. Unknown rooms are acknowledged and then stay silent. USDCUSDT sent nothing in 60 s. | none. Emirex publishes no index, mark or funding. The only reference prices are the last trade (rate and main.rate_usd in GET /api/default/ticker, and last in /v1/public/ticker), so no anchor poller is recommended | Operator is Emiverse SVG LLC (Saint Vincent and the Grenadines). The Terms bar users "located in a restricted jurisdiction" but publish no list, and US persons are not mentioned (Not publicly specified). emirex.ee does not resolve in DNS. From this host, which exits through a Canadian Surfshark VPN, all public REST calls returned 200 and the socket upgrade returned 101 via Cloudflare SEA/YVR edges. There was no geoblock and no rate-limit or Retry-After header. Warm REST median was 178 to 192 ms. The only non-200 replies were 400 {"status":false,"error":"Incorrect pair"} and 404 HTML, both to deliberately wrong requests | spot only |
| 22 | GoPax, [`../profiles/gopax/`](../profiles/gopax/) | none | spot | none (spot only: 111 KRW pairs and 11 USDC pairs. The REST and WS docs have no derivative endpoint, the catalog has no contract field and the site's route table has no futures route.) | 2000 | wss://wsapi.gopax.co.kr, no API key needed since 2022-10-25. SubscribeToOrderBook {tradingPairName} with one pair per frame, 50 pairs per socket at most (the 51st got err 10321). The reply is the whole book (every level, up to about 1,000 per side, e.g. 113,559 bytes for XRP-KRW) plus maxEntryId, and it doubles as the ack. Deltas are OrderBookEvent entries {entryId, price, volume, updatedAt} applied by price, and volume 0 deletes the level. entryId is one counter for the whole exchange, not per pair, so gaps cannot be detected. The documented order rule is (updatedAt, entryId). No checksum. The limit parameter (20 or more) still sends changes outside the window, so a limited book cannot be kept. The server sends a primus text ping every 30 s and closes the socket (code 1000) 30.2 s after an unanswered pong, even while data flows. No compression is offered. The book matched REST level 2 on 20 of 20 levels per side on 4 pairs in both runs. | none: GoPax publishes no index, mark or funding. The nearest numbers are the /tickers last price and the touch at the last trade, /trading-pairs/stats close (updated every minute) and a boolean isGlobalPriceDifference caution flag. No anchor poller is recommended. | Only Korean-verified users can trade: KYC under the Korean Specified Financial Information Act, and foreigners need a Korean alien registration card or a domestic residence report. The site says foreign and corporate customers cannot use the API at all, and KRW moves through a Jeonbuk Bank real-name account. No page read names the US or lists excluded countries (the terms page is loaded from a CMS and was not read), and no verification path for a US person without Korean documents was found. From this host, via the Surfshark exit that geolocates to Canada (Cloudflare loc=CA, colo=SEA): REST api.gopax.co.kr (AWS ALB in Seoul) answered 200 on every call, with a warm median of 169 to 224 ms. WS wsapi.gopax.co.kr answered 101 on all 16 opens, taking 732 to 834 ms, and delivered data. www.gopax.co.kr answered 200 from CloudFront, and /API answered 404 because the docs live on gopax.github.io. | spot only |
| 34 | bitcastle, [`../profiles/bitcastle/`](../profiles/bitcastle/) | none | perpetuals | USDT-M 119 (no USDC-M, no coin-M, no dated futures, no options). The catalog is GET api.bitcastle.io/futures/v1/settings/pair, which is not in the public API reference but answers without a key. Each row names a source venue in `target`: 109 Bybit, 7 MEXC, 3 Binance. | 600 | MQTT 3.1.1 carried in binary WebSocket frames at wss://socket.bitcastle.io/mqtt. The subprotocol `mqtt` is mandatory: a handshake without it gets HTTP 400. The topic is public/futures/orderbook/{coin}/usdt/{precision}. Precision must be the pair's default scale written as a decimal (e.g. 0.1 or 0.0001). Any other precision, and any unknown pair, gets SUBACK code 00 and then no frames. Each frame is the whole book, up to 100 levels per side, about once per second (median gap 996 to 1,008 ms). A snapshot arrives on subscribe and every frame is one, so there are no deltas, no sequence number and no checksum. Levels are often unsorted. Pairs sourced from MEXC and Binance repeat the same price many times, because the source's 5-decimal prices are cut to 4 decimals. Sizes are in the base coin. The server did not negotiate permessage-deflate, and the payloads are plain JSON. The topic is undocumented: the API reference covers only the spot topics. | One bulk call has the mark: GET /futures/v1/ticker/24h returns mark_price for all 119 pairs (30 KB, replies took 449 to 2,306 ms). The MQTT topic public/futures/markprice_update also pushes the mark every 5 s. No index exists in any call, topic or web-app field. Funding comes from separate calls. settings/pair gives funding_rate "0" on every row, funding_interval "8" (hours) and funding_start_time, from which the next funding time can be derived. Settlements are at 00/08/16 UTC for 54 pairs and one hour later for 65. funding-rate/history gives only the last settled rate. It is nonzero: BTC 0.0001 on its last 50 settlements, and at the newest settlement 88 pairs sat at 0.01. The docs say funding is 0%. No upcoming rate is published anywhere. The mark is the source venue's mark sampled every 5 s: all 56 socket values tested had appeared on Bybit's stream 1.1 to 5.7 s earlier, and single reads equalled MEXC fairPrice and were within 6 ppm of Binance markPrice. No clamps are published. | Operator is bitcastle LLC, St Vincent and the Grenadines, reg. 900 LLC 2021 (CoinGecko lists Lithuania). The Terms of Use exclude the US, Canada, UK, Australia, France, Japan, Singapore, Vietnam, the PRC and FATF-blacklisted countries. Futures need identity verification Level 4, and US persons may not trade. The probes ran through the Surfshark Canada VPN exit. Every public REST call gave its expected status (200, or the 400/401/404 of deliberate error calls). The MQTT socket answered CONNACK 0 with no credentials. Nothing was geoblocked. The hosts are in AWS ap-southeast-1. | blocked |
| 34 | LATOKEN, [`../profiles/latoken/`](../profiles/latoken/) | latoken | spot | none (checked: REST v2 OpenAPI has 56 paths and no futures, mark, index or funding path, only an ACCOUNT_TYPE_FUTURES value in an account type enum. CCXT has swap/future/option false at latoken.js lines 29 to 31, and loadMarkets gave 1,245 spot markets and 0 swaps. CoinGecko's derivatives list has 214 entries and none is LATOKEN. The help center has 0 'perpetual' articles. latoken.com/futures is only a JS app shell, since /futuress answers the same way) | 5900 | STOMP 1.2 over wss://api.latoken.com/stomp (vertx-stomp/3.9.6, binary WS frames), SUBSCRIBE destination /v1/book/{baseCurrencyId}/{quoteCurrencyId} (the tag form gets an empty snapshot and no deltas). Snapshot on subscribe with nonce 0 and up to 100 levels per side, then deltas carrying absolute level sizes ('quantity', 0 deletes) over the whole book, not just the top 100. A delta can repeat a price within one frame, so entries are applied in array order. Sequence: a nonce per subscription, +1 per frame. That gave 0 gaps on 5 pairs x 60 s x 3 runs and on 100 pairs x 45 s x 2 runs. A resubscribe restarts at 0. No checksum. No compression unless the client offers permessage-deflate. Keepalive is STOMP heart-beat: a silent client that asked for heart-beats is closed at 30.7 s, and a socket with no traffic at 60.5 s | none: no index, mark, funding, interval or next funding exist. Reference prices only: REST /v2/ticker lastPrice/bestBid/bestAsk/updateTimestamp (616 KB bulk, max-age=1) and WS /v1/rate/{base}/{quote} 'rate' (formula not published). No clamps apply. No anchor poller recommended | Excluded from trading, per two help center articles (2024-12-08, 2026-03-01) and the fee page footer: USA, Canada, Germany, Indonesia, Iran, Afghanistan, Bosnia and Herzegovina and North Korea. US persons may not trade. The operator named is Warsaw, Poland (LATrade, XasPay Sp. z.o.o.), and CoinGecko says Cayman Islands. The Terms of Use PDF returned HTTP 521. From this host's Canadian Surfshark exit, every documented public REST path returned 200 (Cloudflare edge YVR) and every WS upgrade returned 101. There was no geo refusal, even though Canada is on the restricted list | spot only |
| 34 | Mudrex, [`../profiles/mudrex/`](../profiles/mudrex/) | mudrex | perpetuals | USDT-M linear 745 (lower bound from the public ticker@1s snapshot, which omits assets with no data. All 745 are Bybit USDT perp symbols, i.e. 745 of Bybit's 777). USDC-M 0, coin-M 0, dated futures 0. The catalog itself (GET /fapi/v1/futures) is private and could not be counted directly. | 500 | None. The only public socket is wss://trade.mudrex.com/fapi/v1/price/ws/linear, and it carries just kline@1s/1m, markKline@1s/1m and ticker@1s/5s (last and mark only, no bid, ask or size). 13 guessed names (depth, depth20, orderbook, bookTicker, trade, aggTrade, markPrice, index, funding, etc.) got 400 "invalid stream name". There is no snapshot, sequence or checksum. Frames are plain JSON with no compression, and deflate is not negotiated. Limits are 15 subscriptions per connection and 10 new connections per minute per IP. The server closes after 40 s with no client frame, and server pushes do not reset that timer. A protocol ping keeps the socket open. The JSON PING that CCXT Pro sends gets 400 "unknown method". There is no REST book either (CCXT fetchOrderBook false at mudrex.js line 58). | None usable. There is no public index, funding rate, interval or next funding time. The only public REST mark is GET /fapi/v1/price/mark-kline (25 assets per call, 300 req/min per IP). It returns only closed 1 m candles, so the close is 1 to 60 s old and changes once a minute, at 1,445 bytes and a median of 281 to 294 ms for 25 assets. A faster mark is only on the socket: markKline@1s, or ticker mp, which lags further. Funding exists only in the private asset detail (funding_fee_perc, max/min_funding_rate, and funding_interval, which is the next funding time in Unix seconds). Mudrex publishes no mark formula and no clamp. On the wire the mark is Bybit's markPrice: it matched within 10 s on 63 of 67 and then 89 of 96 one-second frames, with median lags of 321 to 888 ms. | Only KYC-verified users may trade through the API, and the key needs PAN and Aadhaar (Indian IDs), so in practice only Indian residents. The entities are RPFAS Technologies Pvt Ltd (India), Mudrex TR UAB (Lithuania/EU, named as pricing and executing derivatives) and Mudrex INC (Delaware). The Terms' Restricted Locations include the USA and Canada, so US persons may not trade. From this host (Canadian Surfshark exit, CloudFront SEA POP), public /fapi/v1/price REST answered 200 and the /price/ws/linear socket answered 101. The catalog (GET /fapi/v1/futures and /futures/BTCUSDT?is_symbol) answered 401 {"success":false,"errors":[{"text":"Invalid Authentication","code":3100}]}. The /ws/inverse and /ws/spot paths answered 404. | blocked |
| 34 | ZebPay, [`../profiles/zebpay/`](../profiles/zebpay/) | zebpay | perpetuals | USDT-quoted 248, INR-quoted 177 (425 active, all status Open). Every symbol is a Binance USD-M symbol (243 PERPETUAL, 5 TRADIFI_PERPETUAL). The INR contracts are the same Binance contract priced at about 95.55 INR per USDT. No inverse contracts, dated futures or options. | 590 | Undocumented Socket.IO 4 feed, taken from the zebpay.com futures web app bundle, at wss://futuresws.zebpay.com/socket.io/?EIO=4&transport=websocket. The client sends 40, then 42["subscribe",{"params":["btcusdt@depth_0.1"]}]. Each depthUpdate event is a full 20-level window, so there is no separate snapshot and the book resets on every frame. Each frame is a forwarded Binance depth20@100ms frame (same E and u on 114 of 114), about every 500 ms, carrying Binance's U, u and pu. pu never chains across frames, so there is no gap rule. Bids arrive ascending (best last). No checksum, no compression (deflate is not negotiated), no subscribe ack. Unknown pairs get silence, and any non-42 or malformed frame closes the socket. 425 streams ran on one socket at 578 to 638 frames/s. | Bulk REST call GET https://futuresbe.zebpay.com/api/v1/market/marketInfo: 109 KB, 592 rows, median 211 to 284 ms, max 1,345 ms. It carries marketPrice (Binance mark rounded up to the tick) and upcomingFundingRate (Binance rate times 0.9, 1.0 or 1.1, held between resamples). The interval is fundingFeeInterval from GET /api/v1/exchange/exchangeInfo (1, 4 or 8 h, equal to Binance's on 425 of 425). REST has no index and no next funding time. The socket's <pair>@markPrice stream carries index i and next funding T, both Binance's. ZebPay publishes no clamps, so Binance's are the only ones. | Only residents of India may trade (Awlencan Innovations India Limited, FIU-IND registered, and ZebPay itself is the counterparty), so US persons are excluded. From this host through the Canadian VPN exit: futuresbe.zebpay.com (Cloudflare SEA edge) and sapi.zebpay.com (AWS ap-southeast-1) returned 200 on every call. futuresws.zebpay.com (CloudFront) returned 101 on the Socket.IO path and 502 on the bare host. The zebpay.com pages and the help centre returned 200, and nothing refused this host. | blocked |
| 34 | IMBX, [`../profiles/imbx/`](../profiles/imbx/) | none | perpetuals | USDT-M 29 (9 stock, 5 commodity, 15 crypto), USDC-M 0, coin-M 0. Also 8 USDT spot pairs. CoinGecko's derivatives list does not carry IMBX. | 500 | market_e_<sym>_depth_step0 on wss://futuresws.imbx.io/kline-api/ws (all 29 perps on one socket, 66 frames/s). 30 levels a side. Every frame is a full snapshot, with no deltas, no sequence and no checksum. ts is truncated to the whole second. Every frame is gzip inside a binary message (permessage-deflate is also negotiated if offered). BTC and ETH push 3.1 to 3.5 times a second. The top of the book is crossed on 1 to 6 BTC/ETH frames a minute. There is no subscribe ack, and an unknown symbol gets one empty "ok" frame. Server sends {"ping":s} every 10 s and the socket dies at 60 s unless answered {"pong":s}. | No bulk index. POST lf-api.imbx.io/common/price_list gives a bulk mark (tagPrice) for 36 rows, including 7 delisted, and has no index. POST /common/public_market_info {contractId} works one contract at a time and returns indexPrice, tagPrice, currentFundRate (fixed hours ahead for the next settlement), nextFundRate, and the cap and floor. A 29-contract sweep took 4.3 s. Interval (capitalFrequency: 8 h, or 4 h on commodities) and next funding (nextCapitalSettTime, ms) are in /common/public_info. Clamps: the funding cap is ±0.375% on most rows (TRX 0.4875%, SUI and TRUMP 0.75%, PEPE 2%, STX 3%). Documented mark = median(last price, index×(1+rate×t/T), index + 2.5 min book basis), capped at ±3 to 8% from the index on TradFi perps. Observed mark sat within 50 ppm of IMBX's own book mid and 151 to 492 ppm off the index. | Who may trade: the United States and its territories are Prohibited Countries in the Terms, so US persons may not trade. The operator is Bull Market labs UAB (Lithuania) in the web copy and IMBX S.A. de C.V. (El Salvador) in the help-center copy. From this host (Canadian Surfshark exit): REST returned 200 and WS 101 only with a User-Agent. curl's or an empty one got 403 from awselb/2.0. From 04:37 UTC, after about 250 REST requests in 5 minutes, every REST call and socket upgrade got 403 even with User-Agent node. The block still held at 05:06 UTC. The openapi/futuresopenapi hosts never answered on port 443. | no public API |
| 18 | Icrypex, [`../profiles/icrypex/`](../profiles/icrypex/) | none | perpetuals | USDT-M 53, all Running (23 on crypto bases, 30 on venue-specific synthetic equity, FX, index and commodity tokens such as NVDX and EURX), USDC-M 0, coin-M 0. Symbols look like BTCUSDT/P with marketTypes PERPETUAL in /v1/exchange/info. CoinGecko does not list them as derivatives. | 2500 | wss://istream.icrypex.com, text frames of the form type/json. Subscribe with subscribe/{"c":"orderbook@btcusdt/p","s":true}, one channel per frame, and all 53 perps fit on one socket. Up to 50 levels per side. A full snapshot (type orderbook) arrives on subscribe, then obd differences whose cs rises by 1 per pair. Rows carry t: 1 insert, 2 update, 3 remove, and a removal carries "0" or the last quantity. channel-data-request/{"c":...} resends a snapshot on a gap. No checksum and no timestamps. Differences were sorted and the top 20 matched the REST book exactly on 6 of 6 pairs. Gaps: 1 in 2,569 differences on the first 53-pair run, 0 in 2,529 on the second. Deflate is not negotiated. The server never pings, a socket with no traffic dies at 60 s, and a client ping every 20 s keeps it open. | none. No public index, mark, funding rate, interval or next-funding call exists. /v1/tickers carries only last, bid, ask, high, low, avg, change, qty and volume. The funding rate is only available from authenticated GET /v1/future/get-future-settings (401 Bearer). Guessed mark, funding and index paths return 404. The web app shows the /P pair's last trade price as its Mark Price. Funding is interest on borrowed funds, announced by ICRYPEX: every 4, 8, 12 or 24 h per the FAQ, three times daily per the position help text. No cap, formula or public history is published. | Operator of www.icrypex.com is Icrypex S.A. de C.V., regulated under El Salvador's Digital Assets Law. Traders must be 18 or older and not Restricted Persons. They must not be in Cuba, Iran, North Korea, Syria or Crimea, or on an unpublished ICRYPEX prohibited-country list. US persons are not named as excluded, and the sign-up form offers US nationality. From this host through the Canadian Surfshark exit, every public REST call to api.icrypex.com answered 200 (401 on auth paths, 404 on unknown paths, 500 on /v1/orderbook without a symbol). wss://istream.icrypex.com upgraded (101) with no refusal. The Turkish sister API api.icrypex.com.tr returned 0 pairs and has no futures endpoint. | blocked |
| 18 | Blockchain.com, [`../profiles/blockchaincom/`](../profiles/blockchaincom/) | blockchaincom | spot | none. No perpetual symbol on the Exchange, and CCXT declares swap false at blockchaincom.js line 31. The Blockchain.com app's Perps tab trades on Hyperliquid through a non-custodial wallet, so it is not a Blockchain.com order book. | 4500 | l2 on wss://ws.blockchain.info/mercury-gateway/v1/ws, which needs the header Origin: https://exchange.blockchain.com. Without it the handshake gets HTTP 400. Subscription is one frame per symbol, and each subscribe returns a snapshot of every level (no depth parameter). Deltas are documented: qty 0 deletes a level. seqnum is one counter per connection across all channels, and a gap means restart the socket. There is no checksum and no compression, and deflate is not negotiated. Bids arrive worst first and order is not guaranteed. Server protocol ping about every 1.02 s, heartbeat channel every 5.1 s. In practice the book is static: 0 updates in 45 s on 60 symbols in each of two runs, and the snapshots were identical at 04:35 and 04:49 UTC. It is also not the book the REST API serves. | none. Spot only, and no index, mark or funding is published. REST /tickers has only price_24h, volume_24h and last_trade_price. The socket ticker's mark_price is stuck at 106,523.7, about 22 % above the market. The socket prices candles close at the REST quote mid with volume 0. No anchor poller is recommended. | Trading: the help center says Exchange trading was suspended on 19 October 2025. The User Agreement (27 August 2026) still has an Exchange section and picks the entity by residence: Malta Ltd for the EEA and rest of world, Blockchain.com, Inc. for the US, UK Ltd, and others. Restricted Locations are sanctioned countries, and a banner pauses exchange services for Canadian residents. Whether US persons could use the Exchange book is not stated. Network: every result is from the Canadian Surfshark VPN exit. REST returned HTTP 200 on every public call (Cloudflare SEA). WS returned 101 only with the documented Origin header, and 400 without it or with a foreign Origin. The fees page returned 404 to curl and 403 to a web fetch, so fees come from the 2025-11-16 Wayback copy, which matches CCXT. | spot only |
| 18 | Hata, [`../profiles/hata/`](../profiles/hata/) | none | spot | none. The OpenAPI spec has no futures, margin, funding, index or mark path. The site pages and the app bundle never mention them. CoinGecko's derivatives list of 214 venues has no Hata. Spot is two separate platforms: Hata Global with 6 pairs (5 USDT, 1 USD) and Malaysia with 23 MYR pairs | 2500 | Centrifugo 6.0.1 channel public:<txpair>@depth. Each push is a full snapshot of at most 30 levels a side, while REST gives up to 100. Nothing is pushed on subscribe, and the history command answers 103 permission denied, so a feed needs a REST seed. Sequence is the Centrifugo pub.offset, +1 per publication, with 0 gaps seen. The first push is the ack offset +1. No checksum. Bids descending, asks ascending, sizes in base units as strings. No compression unless offered: permessage-deflate is negotiated if asked. Books arrive late: about 1.3 to 6.2 s on Global BTCUSDT, and 2 to 55 s on a socket with 27 Malaysia channels. The delay grows through a run, and two sockets share one throughput ceiling of about 14 to 28 KB/s | none. There is no index, mark, funding, interval or next funding, and no ticker REST call. exchange-info carries only last price and 24 h stats. The undocumented WS @ticker (every 5 s) carries only high, low, close and volume. No anchor poller is recommended | Hata Global is Hata Capital Limited (Labuan, LFSA). It excludes the United States and Ontario (Canada) plus sanctioned persons, so US persons may not trade. The Malaysia platform is Hata Digital Sdn Bhd (SC Malaysia), and its eligibility is not verified. From the Canadian Surfshark exit (Cloudflare loc=CA, colo=SEA), every public REST call answered 200, or the documented 404/400 on bad input, with no geoblock. The public WS token POST answered 200 with a JWT that embeds the exit IP. WS opens: 27 of 28 upgraded with 101 after 5 to 6 s, and one Global open got HTTP 525 from Cloudflare | spot only |
| 18 | Zaif, [`../profiles/zaif/`](../profiles/zaif/) | zaif | spot | none. The JPY perpetual AirFX (fapi group 1, btc_jpy, use_swap true) is retired: empty book, last trade 2021-09-28 06:00:27 UTC, swap history ends 2021-09-27 with all rates 0. Dated BTC/JPY futures (groups 2 to 5) ended 2017 to 2018. Margin trading is also gone. | 1000 | wss://ws.zaif.jp/stream?currency_pair=<pair>. One pair per socket, chosen in the URL. There is no subscribe message, and any client text frame, JSON or not, closes the socket with 1006 115 to 168 ms later. Every push is a full top-20 book per side (the REST depth call gives up to 150) plus the last 21 trades and last_price. There are no deltas, no sequence and no checksum. On open, the first frame is the server's last stored push, and on a quiet pair it can be hours old. Values are JSON numbers, some in exponent form such as 1e-08. The server does not negotiate compression and sends no ping. It cuts a socket after 60 s with no traffic. A client protocol ping every 20 s keeps the socket alive, with a pong in 114 to 139 ms. Documented limit: about 4 connection starts per second per IP. 47 of 56 pairs deliver, including 42 is_token pairs the docs say are not streamable. Some books are empty or one-sided. | none. Zaif has no index, mark or funding, and no bulk price call. Only per-pair GET /api/1/ticker/{pair} (last, vwap over 24 h, bid, ask), /last_price/{pair} and /trades/{pair} exist, all from Zaif's own trading. The retired AirFX /fapi/1 endpoints still answer with frozen 2021 data. | Individuals may trade at ages 18 to 79 if they clearly do not live in the EEA, the US or another country Zaif designates (the list is not published), and they must not be US citizens or permanent residents. Corporations must be registered in Japan. So no US person may trade. From this host through the Surfshark exit in Canada (Cloudflare loc=CA, colo=YVR), api.zaif.jp REST answered 200 with data on every documented call. ws.zaif.jp answered 101 and streamed. The only non-2xx replies were HTTP 404 for a wrong WS path and an empty REST path. No geoblock or refusal was seen. | spot only |
| 18 | SecondBTC, [`../profiles/secondbtc/`](../profiles/secondbtc/) | none | spot | none. exchangeInfo has no contract, funding, mark or index fields. The web app has no futures route. CoinGecko's derivatives list (214 venues) has no SecondBTC entry, and /derivatives/exchanges/secondbtc returns 404. | 2000 | Socket.IO v4 event EXCHANGE_ALL_DATA on socket.secondbtc.com, subscribed by emitting createRoom "BTC_USDT". WebSocket is refused with 400 {"code":3}, so only Engine.IO long-polling works. Each regular push is the whole book at 150 levels per side about every 5.3 s (after the first, which came 0.9 to 4.9 s after subscribing). It carries no symbol, timestamp, sequence or checksum. One book per session, following the last room joined. There is no compression, and the push equals the REST depth book. | none. The venue publishes no index, mark or funding and has no funding interval or next funding time. The market info event names its own market maker's priceSource as "binance", so the book is a copy of Binance. No anchor poller is recommended. | Who may trade is not verified: the terms page renders client-side, and one headless render timed out after 60 s. CoinGecko lists India, and the site mentions Turkish lira deposits. From this host through the Canadian Surfshark exit (Cloudflare SEA and YVR), every public REST call on api.secondbtc.com returned 200, except the recent-trades call, which never answered (8 s timeout). There was no geoblock. The Socket.IO polling handshake returned 200, and every WebSocket upgrade returned 400 {"code":3,"message":"Bad request"}. | spot only |
| 21 | Paribu, [`../profiles/paribu/`](../profiles/paribu/) | none | spot | none on Paribu's own exchange: 0 of 278 catalog markets. The mobile app's "DeFi" perpetuals are an interface to a third-party protocol's HyperCore (Hyperliquid by name, an inference), with no Paribu API, book or anchor | 2800 | orderbook:<market> on wss://api.paribu.com/v1/wapi/stream, which the docs mark as beta. It sends an in-band snapshot on subscribe with up to 100 levels per side, then diffs. The per-market sq must equal last+1, and a gap means the server closes with 4003 and the client resubscribes. A heartbeat restating sq comes about every 5 s while the book is idle. No checksum, plain-text JSON, permessage-deflate not negotiated. Probed: 0 gaps over about 52k diffs, 267 books plus 64 tickers (331 channels) on one socket. Server pings every 30 s (docs say 20 s) and closes with 1006 about 11 s after an unanswered ping | none. No index, mark or funding. The only reference prices are GET /market/ticker (24 h last and average), GET /cg/tickers (bid, ask, last) and the match-price socket channel | Trading: KYC-verified customers of Paribu Kripto Varlık Alım Satım Platformu A.Ş. (Istanbul, SPK). The web app says identity verification is only for Turkish citizens, with a courier path for foreigners. A public whitelist_country list has 42 entries and excludes US and CA. No document names US persons. From this host (Canadian Surfshark exit near Seattle): public REST 200 through Cloudflare SEA and YVR, both WS endpoints upgraded with 101, no geoblock. The help center HTML got a 403 Cloudflare challenge, while its Zendesk JSON API returned 200 | spot only |
| 21 | EarnBIT, [`../profiles/earnbit/`](../profiles/earnbit/) | none | spot | none (help center "Futures Trading (Coming Soon)" pages are empty headings, six futures API paths answer 404, futures hostnames do not resolve, site MARGIN_LIST is empty). Spot: 26 markets, 24 USDT-quoted and 2 BTC-quoted | 2000 | wss://ws.earnbit.com/ depth.subscribe ["BTC_USDT",100,"0"] (limit 1/5/20/50/100 only), one market per socket because a second subscribe replaces the first. The first depth.update has params[0]=true and carries the full 100x100 book, sent with the ack about 150 ms after subscribe. A full book comes again at the top of every wall-clock minute. Deltas (params[0]=false) carry [price,amount] strings, "0" deletes, and arrive on a 1 s tick. No sequence id, checksum or timestamp, so gaps cannot be detected. Bids are ascending on the wire, best last. Frames are uncompressed JSON text: the server negotiates permessage-deflate only when the client offers it and does not force it. Keepalive is server.ping, and inbound traffic does not reset the 60 s inactivity rule | none. No index, mark, funding rate, interval or next funding exists on REST or WS, so there are no clamps to record. The only reference prices are GET /api/v1/public/tickers (last, bid, ask and 24 h stats for all 26 markets in one call) and WS price.update and state.update. No anchor poller is recommended | Operator is Earnbit LLC, Saint Vincent and the Grenadines, reg 2180LLC2022. CoinGecko lists Lithuania with a Vilnius address. The Terms of Use (July 2022) exclude no country by name. Sign-up checks a country list loaded at run time from back.earnbitech.cloud, which never completed a TLS handshake from this host. Launchpad excludes US persons, and whether US persons may trade spot is not publicly specified. From this host, on the Canadian Surfshark VPN exit (Cloudflare loc=CA, edges SEA/YVR), every public REST call answered 200/400/404 in its documented shape and every WS handshake answered 101. No geoblock seen | spot only |
| 21 | FMFW.io, [`../profiles/fmfwio/`](../profiles/fmfwio/) | fmfwio | perpetuals | USDT-M 23 working plus 1 expired (LUNAUSDT_PERP). No USDC-M or coin-M. CELUSDT_PERP is listed as working but its book is empty, so 22 are live. CoinGecko's derivatives list does not show them, but /public/symbol does. | 800 | orderbook/full on wss://api.fmfw.io/api/3/ws/public, the same URL as spot. It carries every level (BTC about 300 bids and 188 asks) and sends a snapshot on subscribe 135 to 158 ms after the frame. The per-symbol s rises by exactly 1 per frame: 0 gaps in 2,452 book-run and 7,279 batch updates. No checksum. Levels arrive sorted. Sizes are in base coin (CCXT contractSize 1). There is no compression and permessage-deflate is not negotiated. The server pings every 30 s and closes a socket that misses one pong with code 4002. orderbook/D20/100ms shares s. | One bulk call, GET /public/futures/info: 24 rows, about 8 KB, median 143 and 153 ms. It has index_price, mark_price, funding_rate (plus indicative_funding_rate) and next_funding_time (ISO). The interval is missing and is a fixed 8 h (00, 08 and 16 UTC). The mark is index x (1 + funding_rate x t/8h) rounded to tick (1,377 of 1,380 rows), so it carries no perp-book basis and has no clamp beyond the rate clamp of +/-0.05% on the interest term. The data republishes every 3 s and is 0.4 to 3.0 s old on arrival. The index basket is not published. The index is rounded to contract tick, and one tick is over 1,000 ppm on GMT and MANA. A futures/info WS channel pushes the same fields every 3 s. | Operator is FMFW Ltd. US persons and 24 other jurisdictions are barred outright. Derivatives are restricted for residents of Australia, Canada (including Ontario), Germany, Hong Kong, Italy, Japan, the Netherlands and the UK. Through the Canadian Surfshark exit (Cloudflare loc=CA, SEA and YVR edges), every public REST call returned 200 (errors only for bad inputs) and the public WS opened in 545 to 1,243 ms. There was no geoblock or refusal. | fits with a named change |
| 21 | Bitexlive, [`../profiles/bitexlive/`](../profiles/bitexlive/) | none | spot | none (spot only: 21 USDT pairs. There are no futures, options or margin. https://bitexlive.com/futures returned 404, the API documents only spot calls, the app bundle has no derivative strings, and Bitexlive is absent from CoinGecko's derivatives list of 214 venues) | 1000 | No WebSocket API is documented. The web app's own socket is a Pusher protocol 7 server (x-powered-by Ratchet, Laravel Echo client) at wss://wss.bitexlive.com/app/fiac7yamhonzmyhqokgp?protocol=7. Its book channel is exchange.public.<market UUID> with event order.book.updated. Each frame replaces the whole book with 22 levels per side, pushed once every 49.6 to 51.7 s in a sweep over all 21 pairs. Nothing is sent on subscribe, so the first book arrives with the next sweep, up to about 52 s later. There is no sequence, no checksum, no timestamp, and permessage-deflate is not negotiated. SELL is sent descending, so the best ask is last. The amount is rounded to the pair's amount_decimals, and total/price disagrees on 13 to 28 of 44 BTC levels. Any channel name is acked, including unknown ones. | none. There is no index, mark, funding rate, funding interval or next funding time on any call or channel. The only reference prices are the ticker's LastPrice and the socket's market_data.updated last_price, both the venue's own last trade. No anchor poller is recommended. | Operator is Bitex Trade LLC, Georgia reg. 412795300, Kutaisi Free Zone VASP licence L38-2025 (terms updated 22 Oct 2025). The terms exclude only Georgian residents and citizens from licensed services, never name US persons, and forbid access other than through the provided interface. From this host, via a Surfshark exit that geolocates to Canada (Cloudflare loc=CA, SEA and YVR edges), every documented REST call on prod.bitexlive.com returned 200 with no rate-limit headers. The socket upgraded 101 with no refusal. | spot only |
| 21 | XBO.com, [`../profiles/xbo/`](../profiles/xbo/) | none | perpetuals | USDT-M exists, but the active count is unknown. GET /v1/futures/trading-pairs answered 401 without a key, and the site claims "Over 100 assets" and 125x leverage. USDC-M and coin-M are not publicly specified. Dated "Expiry Futures" exist (weekly, monthly, quarterly), and there are no options. | 600 | Documented only, because the upgrade is refused with 401 without a key: channel "books" on wss://api.xbo.com/ws/v1/futures, which needs HMAC headers on the upgrade. Depth and push interval are not specified ("full order book"). A snapshot comes on subscribe. Each message carries a "monotonically increasing version": buffer until the snapshot, drop versions at or below it, and reset on a fresh snapshot. The docs do not say whether the version steps by 1. No checksum. Text frames only, and deflate is not specified (an offer got the same 401). There is no spot socket at all. | none: no index, funding rate, interval or next funding in any XBO API, whether public or keyed. The only mark is a field on the keyed futures "tickers" socket channel. There is no REST anchor call, so no poller is recommended. | CLICKJOINT B.V. (Curaçao) operates the service and excludes residents of the US, Iran, Russia "and others", and does not serve the UK. Other countries are not publicly specified, and US persons may not trade. From the Canadian VPN exit, the public spot REST on api.xbo.com (/trading-pairs, /trading-pairs/stats, /orderbook, /trades, /currencies) answered 200. /v1/futures/trading-pairs and the futures WebSocket upgrade answered 401 with an empty body, which is the documented missing-key answer and not a geoblock. | blocked |
| 19 | Figure Markets, [`../profiles/figure-markets/`](../profiles/figure-markets/) | none | spot | none | 1000 | ORDER_BOOK on wss://www.figuremarkets.com/service-hft-exchange-websocket/ws/v1, one stream per SUBSCRIBE frame, routed by the client-chosen channelUuid. Every frame is the whole book, sent 84 to 135 ms after subscribe. There is no depth cap, and no side held more than 22 levels. Frames carry no sequence number, no timestamp and no checksum, and no ack is sent. The whole book is republished on one global tick of about 340 ms when it changed, and about every 5.1 s when it did not. One side or the whole book can be empty for one to three ticks. Frames are plain text with perMessageDeflate false, but the server does negotiate permessage-deflate if the client offers it. The documented 50-subscription cap is not enforced: 52 were accepted. The server sends no ping, and a client protocol ping every 20 s keeps the socket open. | No perpetual anchor exists: there is no mark, no funding rate, no interval and no next funding. GET https://api.figuremarkets.com/public/v1/markets returns indexPrice, described as "Oracle index price", for all 29 markets in one call (43 KB, or 28 KB with market_type=CRYPTO, 141 to 147 ms median). There is one index per base asset, and the BTC index was within 0.5 bps of the Coinbase mid. exchangePrice equals indexPrice on the six majors. The MARKET WS channel carries the same indexPrice. No clamps are published. Pyth as the oracle source is only inferred from the web bundle. | Crypto spot is offered by Figure Payments Corporation (NMLS 2033432). US persons may trade except in New York ("Cryptocurrency trading is not available in NY", and the NY licence is pending). The terms say the service is intended for US visitors, and all 17 crypto markets are marketLocation US. Every public REST call returned 200 and every WS upgrade returned 101 (18 sockets) from the Canadian Surfshark exit near Seattle, with no geoblock. The help center HTML returned 403 behind a Cloudflare challenge, but its Zendesk API returned 200. docs.figuremarkets.com did not answer, and the API docs at figuremarkets.dev/api-docs returned 200. | spot only |
| 19 | Coincheck, [`../profiles/coincheck/`](../profiles/coincheck/) | coincheck | spot | none | 0 | `<pair>-orderbook` on wss://ws-api.coincheck.com/ carries every pair on one socket. It sends diffs only, with no snapshot on subscribe. Each level is an absolute size and "0" deletes it. An active pair gets about one frame every 365 ms (209 to 831 ms), and a quiet pair sends nothing. There is no sequence id, no checksum, and no ack or error frame. Each subscribe frame takes one channel, and unsubscribe is ignored. Levels are strings in base coin. Deflate is not negotiated. The server sends no ping and drops a silent socket at 60 s, and a client protocol ping keeps it open. A feed must seed from REST order_books (200 levels) and cannot detect a lost diff. The kept book trails the live REST book by up to about 4 s on some levels. | None. There is no index, mark, funding, interval or next settlement, because there is no derivative. The only reference prices are GET /api/rate/{pair}, a per-pair "standard rate" within 108 ppm of the book mid (formula not published), a per-pair ticker whose timestamp was up to 10.7 s stale, and a daily closing price page. No bulk call exists and no clamp applies. | Coincheck, Inc. (Kanto Local Finance Bureau crypto registration 00014) verifies only residents of Japan aged 18 to 74, so US persons and every non-Japan resident are excluded. From this host through the Canadian Surfshark exit, every public REST call answered via CloudFront SEA with 200, or 400/404 for bad pairs, and there was no geoblock. The public WebSocket opened in 487 to 582 ms from AWS Tokyo, and the docs, fee page and terms all returned HTTP 200. | spot only |
| 19 | Indodax, [`../profiles/indodax/`](../profiles/indodax/) | indodax | spot | none (help center articles updated 2026-09-03 and 2026-09-15 say futures are not supported and Indodax is spot only. CCXT has.swap false and 0 swap markets. Spot: 484 pairs, 472 IDR and 12 USDT) | 600 | market:order-book-<pair> on wss://ws3.indodax.com/ws/ (Centrifugo 2.8.7, JSON text frames). A connect command carrying the static public token from the docs must come first. Every push is the whole book, up to 50 levels a side, with no deltas. There is no snapshot on subscribe: the first push came 0.36 to 3.1 s after the ack, and a quiet pair (xecusdt) sent nothing for 45 s. Resubscribing with recover from ack offset minus 1 returns the last book from channel history, or REST /api/depth can seed it. The sequence rule is a per-channel offset that rises by 1 per push: 0 gaps in both runs, and the first push is the ack offset plus 1. No checksum. The server does not negotiate permessage-deflate. The cap is 128 channels per connection (error 106 beyond it). Some frames carry several newline-separated messages. | none: no index, mark, funding rate, interval or next funding exists. /api/ticker_all (76 KB, 484 rows, about 970 ms) and /api/summaries carry only the venue's own buy, sell and last. No anchor poller is recommended. | Operator is PT Indodax Nasional Indonesia, an OJK-licensed PAKD. Members must be 17 or older with a KTP (Indonesian citizens) or a passport plus KITAS/KITAP (foreigners). US persons are not named, but one without an Indonesian residence permit cannot register. From this host through the Canadian Surfshark exit (Cloudflare loc=CA, edge YVR): every public REST call on indodax.com returned HTTP 200 with no refusal, and wss://ws3.indodax.com/ws/ opened with 101 in about 250 ms. wss://indodax.com/ws/ returned 404. The help.indodax.com HTML pages returned 403 with a Cloudflare challenge, while their Zendesk JSON API returned 200. | spot only |
| 19 | WazirX, [`../profiles/wazirx/`](../profiles/wazirx/) | none | perpetuals | INR-quoted INR-margined 229, USDT-quoted INR-margined 221 (450 total, all PERPETUAL, no status field. Spot 407 markets named only) | 400 | `<symbol>@depth` on wss://fstreamx.wazirx.com/stream (both families on one socket): the docs describe deltas at about 1000 ms, but on the wire every frame is a full 20 bid plus 20 ask book about every 510 ms, so each frame is a snapshot (resetBook). There is no sequence id, no checksum, and no deflate is negotiated. Only 185 of 450 contracts are served, and unserved or unknown streams are acknowledged with "streams": null and no error. No other depth or best bid and ask spelling is accepted. The book is Binance USD-M's top 20 sizes by rank on a gap-free tick grid, with the touch pushed out a fixed number of ticks per side (BTCUSDT 2 ticks or 2.3 ppm, ETHUSDT 10 ticks or 36 ppm). Frames arrive a median 395 to 457 ms after their own E. | Bulk GET /fapi/v1/premiumIndex returns 450 rows in 96.5 KB, 274 to 284 ms median warm. It has indexPrice, markPrice, lastFundingRate and nextFundingTime (ms), and no funding interval (Binance's fundingInfo interval would have to be used). Index and mark are Binance's rounded up to the tick, and INR contracts apply a fixed per-contract multiplier of 95.00 to 95.60. Funding is WazirX's own running estimate near 0.9 or 1.1 times Binance's predicted rate, with no formula or cap published. nextFundingTime equals Binance's on 450 of 450. The same fields come over the socket on !markPrice@arr about once a second. REST refused with {"code":2136,"message":"Too many api request"} on the 53rd premiumIndex call in 3 min 19 s, never more than 30 in one minute, which is under the documented 60 per minute. | Only Indian nationals with Indian KYC who access from India may trade (Zanmai Labs Private Limited terms, foreign KYC refused), sanctioned persons are excluded, so US persons cannot. Futures also require an in-app quiz and separate Futures T&C that are not public. From this host, through the Canadian Surfshark VPN exit, every public REST call returned 200 and every WS socket opened with no geoblock. The only refusals were 403 openresty HTML on undocumented paths (/fapi/v1/fundingRate, fundingInfo, ticker/bookTicker) and one JSON code 2136 rate-limit body on premiumIndex, whose HTTP status was not captured. | blocked |
| 19 | Tokpie, [`../profiles/tokpie/`](../profiles/tokpie/) | none | spot | none (no perpetual, futures or options in the 379 pair catalog or the API docs. CoinGecko derivatives/exchanges/tokpie returns 404 market not found) | 1000 | No WebSocket book channel exists. The one documented socket, ws://tokpie.com:8222 (plain ws, API doc last updated 2021-02-10), carries only tradeHistory:<pair>, and it answered HTTP 500 "Internal Server Error" to all 10 upgrade attempts (4 paths, Origin header, deflate offer). wss on port 8222 timed out and wss://tokpie.com/ws gave 404. The only book source is REST GET /api_order_book_v2/?market=ETH@USDT&depth=20: a full snapshot every time, with no sequence and no checksum. Both sides come back in descending price order, so the best ask is the LAST element. Levels are [price, size] as JSON numbers, with size in the base asset. A read takes about 670 ms median on the busiest pair, and the book changed at most once per minute. | none. Spot only, with no index, mark, funding, interval or next funding. The ticker's last, avg, highestBid and lowestAsk come from a snapshot refreshed about every 4 minutes that lags the live book, so no anchor poller is recommended. | Operator is Graceful Globe S.A., Panama. CoinGecko lists the country as Hong Kong. The terms, privacy policy and sign-up page name no excluded region and say nothing on US persons (not publicly specified). From the Canadian Surfshark exit near Seattle, every public REST route on tokpie.com (nginx/1.4.6, Selectel RU address 95.213.151.243) returned 200 with no refusal. The docs site tokpie.io returned 403 with a Cloudflare challenge to curl's default user agent and to WebFetch, and 200 to a custom user agent. The WebSocket ws://tokpie.com:8222 returned HTTP 500 on every attempt. | spot only |
| 27 | BTC Trade UA, [`../profiles/btc-trade-ua/`](../profiles/btc-trade-ua/) | none | spot | none (checked: no perpetuals, futures, options or margin in the ticker, trading page, fee page, FAQ, terms or API docs. Not on CoinGecko's derivatives list of 214 venues. The old CCXT class set swap and future to false.) | 1000 | none. There is no public market-data WebSocket. The only socket, wss://btc-trade.com.ua/ws/time, is undocumented. It answers {"ping":true} with a time_object and pushes nothing. Its book requests ({"get":"api/trades/buy/sell/<pair>"}) are acknowledged with {"status": true} and never answered. The book exists only over REST: GET /api/trades/buy/<pair> and /api/trades/sell/<pair> return the full per-order lists (not aggregated), bids descending and asks ascending. There is no sequence and no checksum, and a 1 s edge cache sits in front. The server does not negotiate deflate. A silent socket is closed with 1006 after 60 s. | none. There is no index, mark, funding, interval or next-funding field, and no clamps apply. The only reference number is the ticker's usd_rate, a fixed local UAH per USD rate of 42.4, while usdt_uah traded at 45.63 to 45.894. /api/market_prices answered 502 {"status":"wait","timeout":1000} on every read. | Anyone who registers and accepts the user agreement may trade. The agreement is governed by Ukrainian law and names no legal entity, no excluded region and no US-person rule. Clause 7.4 requires identification when asked. From this host (Canadian Surfshark exit, near Seattle), every public REST call returned 200 except its own error cases (404 {"status":"false"} for an unknown pair, and 502 on market_prices). Every /ws/time upgrade on btc-trade.com.ua and btc-trade.app returned 101. The server is nginx on Hetzner Falkenstein with no CDN, and there was no geoblock. | spot only |
| 27 | Bitbegin, [`../profiles/bitbegin/`](../profiles/bitbegin/) | none | spot | none. The site settings served to anonymous visitors carry enable_future_trade 0, and /futures/exchange answers 307 to /404. The futures routes exist in the white-label build but are switched off. CoinGecko's 214 derivatives venues do not include Bitbegin. CoinGecko's description claims perps, but the site does not bear that out. | 1000 | No working public book channel. The web client configures Laravel Echo/pusher-js 7.0.6 at wss://api.bitbegin.io/app/test (key "test"). The server answers pusher:error 4001 "Could not find app key `test`." 1 ms after open, never sends connection_established, and ignores every subscribe. Per the bundle, the channel would be dashboard-<base_coin_id>-<trade_coin_id> with event order_place carrying whole book sides that replace the page's copy. It would have no snapshot on subscribe (the page fetches 50 levels over REST first), no sequence, no checksum, and no deflate negotiated. An idle socket is closed at about 60.5 s with 1006. pusher:ping gets a pong in 150 to 169 ms. | none. There is no index, mark or funding because there are no perps. The only public reference number is last_price for 12 pairs in the landing page's Next.js data (/_next/data/<buildId>/index.json), which is a page render (68 KB, median about 1 s) and not an API. No anchor poller is recommended. | Who may trade: the Terms require only that users be legally permitted in their jurisdiction and name no excluded region. CoinGecko's description lists 19 restricted countries, and the US is not among them. So US persons are not excluded by any page read. REST from this host (Canadian Surfshark exit, Cloudflare loc=CA via SEA/YVR): every api.bitbegin.io/api route the web client uses (common-settings, app-dashboard, get-exchange-all-orders-app, get-exchange-market-trades-app) answered 403 {"error":"Unaccessable","success":false,"message":"Access denied"}, with x-ratelimit-limit 600 and no Retry-After. Common public-API paths return 404. The web client passes that gate only by sending a fixed userapisecret header from its bundle. The probe deliberately did not send it: the Terms forbid bypassing security controls, and the settings say api_access_enable "0". Web pages load with 200. WS: the socket opens in 491 to 515 ms and then refuses its own app key. | spot only |
| 27 | SafeTrade, [`../profiles/safetrade/`](../profiles/safetrade/) | none | spot | none | 1000 | SafeTrade's official example client documents `<market>.depth`, for example `qubicusdt.depth`, on wss://safe.trade/api/v2/websocket/public with the subscribe frame {"event":"subscribe","streams":[...]} (the Openware Rango shape). Level count, snapshot on subscribe, sequence rule, checksum and compression are not published and not verified, because every handshake from this host got HTTP 403 before the upgrade. | None. SafeTrade is spot only, with no index, mark, funding, interval or next funding. The web app state holds only reference prices: global_price (USDT to fiat) and a per-currency `price` field. Neither is an index basket, and no anchor poller is recommended. | The archived Terms (SafeTrade Limited Co., SVG law) exclude unnamed Restricted Locations and require users to certify professional blockchain activity. Canada has been barred from trading and signup since 2020-06-01. The Terms do not name the US. They also define arbitrage and unapproved bots as Abusive Trading, which can lead to suspension. From this host's Canadian Surfshark exit (Cloudflare loc=CA), every REST path and WS URL on safe.trade and safetrade.com returned HTTP 403 text/html with the notice "you may be from Canada ... Safetrade does not currently allow trading or new signups for Canadians". safe.trade added cf-mitigated: challenge (interactive captcha). No Retry-After was sent. Refusals took 19 to 214 ms. | spot only |
| 27 | Bilaxy, [`../profiles/bilaxy/`](../profiles/bilaxy/) | none | spot | none | 2000 | wss://bilaxy.com/stream?symbol=<numeric pair_id>, one pair per socket, no subscribe message. The 'depth' method pushes the whole book every second, about 2 to 24 levels per side. Every frame is a full snapshot, so there is no sequence and no checksum. The book is repeated unchanged between requotes, 59 of 59 frames on quiet pairs. Plain JSON text frames, no deflate negotiated. Any client frame, including a protocol ping, closes the socket with 1006 within 73 to 93 ms. CloudFront returns 403 to an upgrade that has no User-Agent header. | none. There is no index, mark or funding. GET /v1/valuation (95 currencies) is the venue's own last trade price. For ETH it is usually BTC times a fixed btc_value of 0.02918, which read -84,814 ppm against the ETH_USDT close. | Terms of Service exclude United States, Mainland China and Singapore users, and no legal entity is named (CoinGecko lists Seychelles). From the Canadian Surfshark exit, SEA73 CloudFront edge: REST newapi.bilaxy.com and wss://bilaxy.com/stream answer 200 and 101. Any request without a User-Agent header gets HTTP 403 'Error from cloudfront', on REST and WS alike. The old api.bilaxy.com and the site's socket.io path return 502. 96 sockets from one IP were all accepted. | spot only |
| 27 | Dinari, [`../profiles/dinari/`](../profiles/dinari/) | none | spot | none (tokenized US stocks and ETFs only: 719 dShares plus Alloy index tokens, with no perpetuals, futures, options or margin in the docs, and Dinari is absent from CoinGecko's list of 214 derivatives exchanges) | 0 | wss://ws.api.dinari.com, data types stock_dfn_l2 (the docs example shows MaxDepth 30, likely Dinari's own DFN book) and stock_dfn_quotes (top of book). The docs page is a beta DRAFT and every subscribe needs the authenticate command with a partner key. Without keys the socket answered {"event_type":"error","data":{"msg":"Authentication required"}}. From the docs example, each L2 frame carries full Bids and Asks arrays, so whether it sends a snapshot on subscribe is not verified. It shows no sequence and no checksum, prices and sizes as JSON numbers, and sizes in shares. The server sends a protocol ping about every 20 s and closed no socket idle for 90 s. permessage-deflate is negotiated only when the client offers it, and the server does not force it. | none. Dinari publishes no index, mark or funding. The only reference prices are per stock and need keys: current_price (a blended fair market value, which trailed the clock by 15 to 21 min in the overnight session) and current_quote (bid and ask in shares, with a paid SIP NBBO option). There is no bulk call and no clamps. | Retail users trade through approved Dinari partners. The Reg S tokens (Dinari, Inc.) exclude US persons, Canada, OFAC and FATF jurisdictions and 31 listed countries. US persons may hold non-transferable dShares only through Dinari Securities, LLC (CRD 329672) via approved partners. API access needs KYB and costs from $2,000 a month. From this host, through the Canadian Surfshark exit (Cloudflare SEA and YVR edges): every documented Enterprise API market data GET returned 401 {"message":"Unauthorized"} on both live and sandbox. The WS opened with status 101 and a welcome frame, then refused every subscribe with "Authentication required". The web app's /api/region answered countryCode CA. The app's undocumented routes /api/dinari/market/* returned 200 without keys. There was no geoblock. | no public API |
| 24 | Digitalexchange.id, [`../profiles/digitalexchange-id/`](../profiles/digitalexchange-id/) | none | spot | none | 3600 | No documented WebSocket API. The web page's own Socket.IO 3 (Engine.IO 4, websocket only, polling refused with 400) feed on wss://socket-market.digitalexchange.id sends event tradedata-<PAIR>@depth after 42["subscribe","guest.tradedata-<PAIR>@graph"]. Each frame is a whole book of 25 or 26 levels a side (bids descending, asks ascending), sent about every 2 s as a repeat of the previous book followed a few ms later by the new one. There is no delta, no sequence, no timestamp and no checksum. Numbers are Indonesian-formatted strings ("1.551.234.578", "0,07548"), and sizes are display-rounded (USDT to 1 decimal). Only one pair per socket works, because a second subscribe is ignored. Unknown symbols get silence. Books were locked or crossed often: BTCIDR was crossed in 25 of 34 and 32 of 36 frames in two of three runs. The two non-integrasi pairs (DCTIDR, VEXIDR) pushed no depth in 30 to 45 s. The server does not negotiate permessage-deflate. | none: no index, mark, funding, interval or next funding, because the venue lists no perpetual. The only reference is a per-pair price filter on the trading page (price_filter_source "binance", bid/ask multipliers 0.5 to 2.0). No poller is recommended. | Entity is PT Indonesia Digital Exchange. The home page says it is OJK-licensed, and the terms name BAPPEBTI registration 008/BAPPEBTI/CP-AK/05/2020. Accounts are verified with a KTP, driving licence, passport or KITAS, and funding is IDR through Indonesian banks. The terms name no excluded regions and say nothing about US persons (Not publicly specified). From this host, through the Surfshark exit in Canada (Cloudflare loc=CA, SEA/YVR edge), every public page, /api/<pair>/ticker/depth/trades (200) and both Socket.IO hosts (101) answered with no refusal. A 20-request burst at 5/s returned 200 on all 20, with no rate-limit headers. | spot only |
| 24 | Paymium, [`../profiles/paymium/`](../profiles/paymium/) | paymium | spot | none (0 perpetuals, 0 dated futures, 0 options. The only order book is BTC/EUR spot, per /api/v2/markets, /api/v1/currencies trading lists, and CCXT swap:false at paymium.js line 30) | 6000 | socket.io 1.x on Engine.IO 3 at wss://paymium.com/ws/socket.io/?EIO=3&transport=websocket. Join with the text frame 40/public. Events arrive as 42/public,["stream",{bids/asks:[{amount,price,category,currency,timestamp}]}]. Full-book changes of absolute levels as strings in BTC, amount 0 deletes. No snapshot on join, so the book is seeded from REST /api/v1/data/eur/depth (200 bids, 129 to 131 asks). No sequence, no checksum. A REST-seeded book plus the stream matched a later REST depth on 20 of 20 levels per side in both runs. Server negotiates permessage-deflate only if offered. An idle unjoined socket is closed at 60 s (1006), so the client sends '2' every 10 s (pingInterval 10000). prices and announcement frames arrive every 10 s. | none: no index, mark, funding, interval or next funding exists. Reference prices only: the v1 ticker bid/ask/midpoint/last (its 'at' is the UTC day start), the undocumented v2 ticker, and the broker 'prices' object on the socket, which the terms describe as external sources plus a spread with no published formula. | Paymium SAS (France, RCS Nanterre 533 264 800), a MiCA CASP authorised by the AMF in June 2026 (PSAN since March 2021). Only KYC-verified clients may trade. /api/v1/countries accepts 181 of 250 countries, and US is accepted:false, so US persons cannot trade. Canada, France, UK and Switzerland are accepted. From this host (Canadian Surfshark exit, Cloudflare loc=CA, CF edge YVR or SEA): every public REST call returned 200 and every WebSocket opened (21 sockets, 101 then stream). No refusals. Error codes seen were 422 for an unknown currency, 500 for an eth ticker and 404 for unknown paths. The only 403 came from GitHub's own API rate limit, not from Paymium. | spot only |
| 24 | ChainEX, [`../profiles/chainex/`](../profiles/chainex/) | none | spot | none | 1000 | No documented WebSocket. The web bundle's undocumented push socket is wss://push.chainex.io:443/, speaking WAMP v1 (server ident ChainEXWamp/v0.1). Topic marketUpdates-<numeric market_id> carries per-order 'order' (add) and 'order-delete' (remove) events plus a once-a-minute MARKET_SUMMARY touch. There are no depth levels and no snapshot on subscribe. There is no sequence, order id or checksum, so a gap cannot be detected. A level book seeded from REST /market/orders/{COIN}/{QUOTE}/ALL/200 and updated from the events matched REST in 46 of 48 comparisons. Uncompressed text JSON. Permessage-deflate is negotiated only when the client offers it. The server sends a protocol ping every 8 s. Subscribing works without the wamp subprotocol. | none. No index, mark, funding, interval or next-funding field exists, because there is no perpetual. The only reference prices are spot summary fields (last_price, spread_price as the mid, yesterday_price at midnight UTC) from GET https://api.chainex.io/market/summary/. | Trading is run by ChainEX (Pty) Ltd, South Africa (FSP 53799), and is open to South African and international users after verification. Its help centre blocks the US, Algeria, Bolivia, Ecuador, Kyrgyzstan, Bangladesh, Nepal, Cambodia and Macedonia, so US persons may not trade. From this host's Canadian Surfshark VPN exit (Cloudflare SEA and YVR edges), every public REST call to api.chainex.io returned HTTP 200. The web backend app.chainex.io/action getMarkets and getScalingFees also returned 200 without a session. The push socket wss://push.chainex.io:443/ returned 101 on all 16 sockets. Nothing was refused. | spot only |
| 24 | Giottus, [`../profiles/giottus/`](../profiles/giottus/) | none | perpetuals | USDT-M 533, INR-M 533. They are the same 533 Binance USD-M contracts (exchange_id 1, exchange_symbol BTCUSDT), with the INR row priced at a fixed 104 INR per USDT. No coin-M, dated futures or options. CoinGecko's derivatives list does not track them (derivatives/exchanges/giottus returns 404). | 480 | There is no documented WebSocket. The web page uses an undocumented Socket.IO v4 socket: wss://socket.giottus.com/socket.io/?EIO=4&transport=websocket, namespace /futures, emit init2 {"coinpair":"BTC/USDT"}, event futurestopbidask_<pair>. It sends a full snapshot of 10 levels per side about every 2 s, with no deltas, no sequence and no checksum. Prices and sizes are strings with units ("87182.5 USDT", "4.379 BTC"). There is no deflate, and one socket carries one pair. Each socket also gets a 250 to 300 KB/s broadcast for all pairs. The content is Binance USD-M's depth, about 0.6 s behind Binance's own depth20@100ms at the median. | There is no documented anchor call. The public /futures web page (4.07 MB HTML, embedded Futures.init JSON) and the socket's markprice event carry index_price, mark_price, settle_price, funding_rate and next_funding_time (Unix ms), and the page adds funding_frequency (hours: 4 h on 397 USDT-M pairs, 8 h on 131, 1 h on 5). All of these equal Binance premiumIndex: funding rate and next funding matched on 1066 of 1066 rows in both runs, and the socket mark matched Binance's in 23 to 25 of 25 frames. The socket republishes each pair every 3 s. The page snapshot is up to 2.5 s old. Clamps and formulas are not published, so Binance's apply. INR values are the USDT values times 104. | Operator is Giottus Technologies Pvt Ltd (Chennai, FIU-IND VA00030979). Accounts are open to residents of India or 'another jurisdiction we support' (no list published). KYC needs a PAN, a live video check and an Indian bank penny drop. US persons are not named. From this host (Canadian Surfshark exit): every documented api.giottus.com call returned 200 with x-ratelimit-limit 1, the /futures page returned 200, and socket.giottus.com upgraded with 101. Nothing was refused or geoblocked. | no public API |
| 24 | Bit2c, [`../profiles/bit2c/`](../profiles/bit2c/) | bit2c | spot | none. No perpetual, dated future, option or margin product on the site, the fee page or the API page. CCXT has.swap, has.future and has.option are false at bit2c.js lines 30 to 32. The spot market has 4 live NIS pairs (BtcNis, EthNis, LtcNis, UsdcNis) and 6 dead pair codes (BchabcNis, BchsvNis, EtcNis, BtgNis, GrinNis, LtcBtc). | 12500 | No WebSocket API is documented, and CCXT marks the class pro false and has.ws false. The only push feed is the site's own ASP.NET SignalR hub, tradeHub. It needs a negotiate call, then wss://bit2c.co.il/signalr/connect?transport=webSockets&connectionToken=..., then a start call. There is no subscribe frame: every anonymous socket gets UpdateOrderBook_<pair> for all 4 pairs. Each push is a whole top-10 snapshot of bids and asks as {Price, Amount} JSON numbers in base units. There is no sequence, no checksum and no timestamp. Pushes come at a median gap of 273 to 830 ms per pair, and some repeat the previous book unchanged (34 to 54 of 165 to 256 BtcNis pushes). All 10 levels on both sides matched REST orderbook-top.json on 20 of 20 compares. The server sends a {} keepalive every 10 s. The server does not negotiate permessage-deflate. The site interface is undocumented, and its 10 levels fall short of the engine's 20. | none. There is no bulk call and no index, mark, funding rate, funding interval or next funding time. The only public calls are per pair: Ticker.json (ll last, av 24 h average, h best bid, l best ask, a volume), orderbook.json (full book, docs say cached 1 s), orderbook-top.json (10 levels) and trades. No anchor poller is recommended. | Who may trade: only residents of Israel who hold an Israeli identity card and are 18 or older, with registration and service in Hebrew only (terms of use). The operator is company 517169447, licence 72080 from the Israel Capital Market Authority. US persons who are not such Israeli residents may not open an account. From this host, through the Surfshark exit that geolocates to Canada (Cloudflare trace loc=CA, colo=SEA): every documented REST call returned 200 through Imperva on bit2c.co.il, with a warm response time of 211 to 537 ms. SignalR negotiate returned 200 and the socket upgrade returned 101. No geoblock, challenge or refusal was seen in about 500 requests at 1 request per second or slower. | spot only |
| 23 | ALP.COM, [`../profiles/alp/`](../profiles/alp/) | none | spot | none | 1500 | market_depth.<PAIR> on wss://www.alp.com/ws: each frame (type p) is the whole book up to 20 levels a side, sent on a whole-second grid only when the book changed, about 0.6 s after its second. No snapshot on subscribe (10 of 22 pairs silent for 75 s). No sequence and no checksum, since each frame replaces the book. Text JSON with deflate not negotiated. The documented diff.<PAIR> sent 0 frames. 20 valid topics per connection, and a frame over about 800 bytes is closed with 1009. | none: ALP.COM publishes no index, mark, funding, interval or next funding. The only reference is GET /api/v3/currency-rates, a valuation rate that changed 0 and 1 times in two 60 s one-second polls and sat 954 to 2,416 ppm above the BTC_USDC bid. No anchor poller recommended. | The terms bar the US and its territories, the Balkans, Burma, Cote d'Ivoire, Cuba, DR Congo, Iran, Iraq, Liberia, North Korea, Sudan, Syria, Zimbabwe, Crimea, Belarus, Afghanistan, CAR, Russia and states with limited recognition. The operator is named only as ALPCOM (CoinGecko claims El Salvador and Polish licences, not verified). From this host through the Canadian Surfshark exit (Cloudflare loc=CA, SEA or YVR edge), every public REST call returned 200 (median about 180 ms) and every WS upgrade returned 101, with nothing refused. | spot only |
| 23 | Kinesis Money, [`../profiles/kinesis/`](../profiles/kinesis/) | none | spot | none | 2200 | Undocumented Socket.IO 5 over Engine.IO 4. This is the web app's namespace wss://fastapi.kinesis.money/notifications/market-data/v2/depth/?symbolId=<pair>&EIO=4&transport=websocket, with one pair per socket and no subscribe event. On connect, onInit sends the whole book, every level, up to 104 bids seen. REST caps the book at 100 levels. After that, onChange replaces one whole side, bid or ask, at most about once a second per side. The shortest same-side gap seen was 692 ms. There is no sequence or update id, so a missed frame cannot be detected. There is no checksum and no timestamp. permessage-deflate is not negotiated. The server pings every 25 s and closes the socket at 45 s if no pong comes. An unknown or lowercase pair gets an empty onInit and no error. | none. The venue is spot only, with no index, mark, funding rate, interval or next funding. It publishes only reference prices from undocumented web backend calls: the snapshots socket (latestMidPrice, plus a bidPrice/askPrice that was crossed on 6 to 17 rows per 30 s), GET /api/market-data/trendlines (5 min points) and GET /api/market-data/ohlc/v2. No anchor poller is recommended. | The operator is Kinesis Cayman, a Cayman VASP registered with CIMA under ref 1877923. Terms clause 4.1 lets Kinesis exclude any jurisdiction at its discretion but publishes no list. The site says it is not for UK-based persons. No text found excludes US persons: the card is offered in the US. Whether US residents may use the exchange itself is not stated. From this host, through the Canadian Surfshark exit: the documented client-api.kinesis.money returned 403 {"message":"Forbidden resource"} to every unsigned call, which is a key check, not a geoblock. The web backend's public REST calls at fastapi.kinesis.money returned 200 (catalog, depth, fee rate, trendlines, OHLC). Its sockets upgraded and delivered data. A bad socket path returned 502. | spot only |
| 23 | INEX, [`../profiles/inex/`](../profiles/inex/) | none | spot | none (one USDT spot market with 11 pairs. is_open_lever is 0 on all of them, so there is no margin. No futures or options, no KRW market, and INEX is absent from CoinGecko's 214 derivatives exchanges) | 0 | The documented Open API channel is orderbook_{symbol} on wss://api.inexcoin.com/open-api/ws. The docs call it public, but the upgrade was refused with HTTP 400 empty_token. The website's own socket works but is undocumented: wss://socket.inexcoin.com/kline-api/ws, subscribe {"event":"sub","params":{"channel":"market_btcusdt_depth_step0","cb_id":"btcusdt"}}. Every frame is a whole book, not a delta: 8 to 20 bids and 8 to 17 asks were seen, bids descending and asks ascending, sizes in base coin as 8-decimal strings. A book comes on subscribe (the last push, up to 35 s old) and on every change. Each pair's book is also re-sent on a fixed cycle of about 60 s. No sequence, no update id, no checksum. Every frame is binary zlib-compressed JSON (bytes 78 9c), and permessage-deflate is not negotiated. The server sends a protocol ping every 15.0 to 15.2 s and closes a socket that does not answer at the third ping (45.5 to 45.7 s, code 1000 "Bye"). An unknown pair is acked "ok" and then stays silent. | none. INEX has no index, mark or funding, and no funding interval or next funding time, since it lists no perpetual. The only reference price is the last trade: "close" in the undocumented website call GET www.inexcoin.com/client-api/service/market/tickers (11 rows, median 217 to 395 ms). It changed on only 2 or 3 of the 11 pairs in a minute of 1 s polls. | Operator is Infinity Exchange Korea Co., Ltd. (Korean VASP registration 2024-03). Only Korean nationals who pass KYC can trade. Corporate accounts have been accepted since 2025-11-07. Per the help center, foreigners may sign up but cannot pass KYC or use the exchange, so US persons cannot trade. The US and Canada are not on the 30-country IP block list (updated 2026-05-11, lists China, Russia, Vietnam, Thailand, the BVI, Ukraine and others). A 2025-05-13 notice blocked all non-Korean IPs "temporarily". API keys are issued only to KYC'd accounts. Results from this host, seen through the Canadian VPN exit (Cloudflare trace loc=CA, colo=YVR): every documented REST path on api.inexcoin.com (AWS Seoul) returned HTTP 400 {"error":{"name":"empty_token",...}} in about 157 to 901 ms, with no Retry-After. That includes /v1/symbol/all, which the docs call public, and an undefined path. The documented WS upgrade got the same 400. The website (CloudFront SEA900-P6), docs.inex.im and the Zendesk help center answered 200. The undocumented website calls /client-api/service/market-coins and market/tickers answered 200 without login, 120 of 120 polls. The website socket wss://socket.inexcoin.com/kline-api/ws opened (101) in 496 to 547 ms. | no public API |
| 23 | Bitexen, [`../profiles/bitexen/`](../profiles/bitexen/) | none | spot | none | 2500 | Bitexen documents no WebSocket. The web app uses an undocumented socket.io v2 feed at wss://www.bitexen.com/v2/socket.io/?EIO=3&transport=websocket. The client emits 42["s_m","USDTTRY"]. The server answers once with an sd snapshot (up to 50 levels per side as [size, price] strings, plus 50 trades and a ticker), then pushes m_b and m_s. Each of those is a whole side that replaces the last one, sent on a grid of about 500 ms when the book changes, with gaps of up to 15 s. There are no deltas, no sequence and no checksum. The server does not negotiate permessage-deflate. The client must send "2" every 25 s, or the server closes the socket at 45.6 to 45.8 s. | none. Bitexen publishes no index, mark or funding. The only bulk call is GET /api/v1/ticker/, which gives bid, ask, last and 24 h stats for its one order book market. | The operator is Bitexen Kripto Varlık Alım Satım Platformu A.Ş. in Turkey, under the SPK regime. Verification needs a Turkish Republic ID, held by a Turkish national or by a foreigner with a temporary residence permit, so US persons without Turkish residence are excluded. From the Canadian VPN exit (Cloudflare edges YVR and SEA), every documented REST call answered 200, with warm times of 163 to 214 ms. The socket opened in 601 to 769 ms across 13 opens, and nothing was refused. | spot only |
| 23 | Kanga Global, [`../profiles/kanga/`](../profiles/kanga/) | none | spot | none (only 22 operator-quoted, dated, KXT-settled USDC "leveraged futures" with no order book, not perpetuals) | 2000 | Undocumented Socket.IO v4 (EIO=4) at wss://ws.kanga.global/socket.io/?EIO=4&transport=websocket, used by the web app. You send `40`, then `42["subscribe market","BTC-USDT"]`. Frames are `bid` and `ask`, each a whole side of up to 30 levels per price grouping (keys "0" up to pricePrecision, only the pricePrecision key is exact), with levels as [size, price] JSON numbers. Snapshot on subscribe, then whole-side pushes on a server cycle of about 3 s (min gap 2,994 ms, median 3,557 ms). No sequence, no checksum, no timestamp. Only the last subscribed market on a socket keeps updating, so it is one socket per market. Server ping every 3 s with a 5 s pong timeout. A malformed packet closes the socket. Deflate not negotiated, text frames only. | none: no index, mark or funding exists. The only reference price is the operator's futures settlement price (POST trade.kanga.global/futures/api/markets/price/get), which changes every 3 to 5 s and read 867 to 1,016 ppm below spot mid. The REST book (orderbook/raw, 50 levels) is a cache rebuilt about every 120 s. | Current terms name 3-102-93-8308 SRL (Costa Rica) as operator. Until 2026-07-01, ALL4ONE sp. z o.o. (Gdańsk, RDWW-1709) ran EEA users. US persons and US residents are excluded, as are UN-listed persons and countries where use is illegal. Futures also exclude Iran and North Korea. Canada is not named. From this host (Canadian Surfshark exit, Cloudflare SEA/YVR edges), every documented public REST call answered 200 on api/trade.kanga.global with no rate-limit headers, and 20 requests at 5/s all returned 200. The WS opened in 128 to 189 ms and 10 parallel sockets were accepted. trade.kanga.exchange returned 302 to kanga.exchange on every path. | spot only |
| 26 | Vindax, [`../profiles/vindax/`](../profiles/vindax/) | none | spot | none (no futures DNS hosts. The /fapi, /dapi, premiumIndex and fundingRate paths on api.vindax.com return the catch-all welcome page. The live app bundle has no futures or margin route. Vindax is not on CoinGecko's 214-venue derivatives list. Spot has 628 symbols: USDT 432, BTC 94, ETH 75, VD 27. Only 103 had any 24 h volume, and 40 had more than 100k USD) | unknown | Undocumented Socket.IO 2 stream over Engine.IO 3 at wss://socket.vindax.com/socket.io/?EIO=3&transport=websocket. Each symbol is its own lower-case namespace (text frame "40/btcusdt"), and all 627 servable namespaces multiplex on one socket. It sends Binance-style depthUpdate diffs {E,e,s,z,U,u,b,a}. Levels are [number price, string size or number 0, []], in no order. Frames are bundled per symbol every 1.1 to 1.6 s. There is no snapshot on subscribe: the client reads REST /api/v1/depth (max 100 levels), drops frames with u <= lastUpdateId, and requires the first kept frame to have U <= L+1. After that, U = previous u + 1. At every frame boundary tested (7 of 7), a book replayed from REST matched the REST book on every level. There were 0 gaps in two 8-namespace runs and 3 gaps in 3,727 frames across three all-symbol runs. No checksum and no compression: permessage-deflate is not negotiated. The client must ping ("2") within about 45 s or the socket closes with code 1005. Unknown or upper-case namespaces get 44/..."Invalid namespace" | none: no index, mark, funding, interval or next funding. The only reference prices are last-trade prices (ticker/price, ticker/24hr, returnTicker). weightedAvgPrice is 0 on BTCUSDT. No anchor poller is recommended | An archived vindax.com/forbidden.html (captured 2025-01-11) refuses US and Canadian citizens and residents wherever they live. The legal entity is not publicly specified, and CoinGecko lists Vietnam. From this host's Canadian Surfshark exit (Cloudflare loc=CA, colo=YVR), api.vindax.com returned HTTP 200 on all public REST calls and socket.vindax.com upgraded (101) and streamed data. No API or stream refusal was seen. Every vindax.com page (/, /fees, /api-docs, /terms, /forbidden.html and others) returned 403 cf-mitigated: challenge, a Cloudflare "Just a moment..." page. It did so to curl, to WebFetch and to one headless Chrome load. | spot only |
| 26 | Cryptal, [`../profiles/cryptal/`](../profiles/cryptal/) | none | spot | none (no perpetual, dated future, option or margin product in the API reference, the 2.74 MB trading client bundle or the site. CoinGecko's 214-venue derivatives list does not include Cryptal) | 2500 | No documented WebSocket. The web client's undocumented socket wss://wss.cryptal.com/gex uses {"action":"SUBSCRIBE","channel":"ORDER_BOOK","depth":25,"pair":"BTC-USD"} with depth 25 only. Per the client code it merges levels by price and deletes on volume 0. The client reads no sequence number and no checksum. Whether it sends a snapshot on subscribe is not verified. The server does not negotiate compression. The server closed 12 of 12 plain-client sockets with 1002 "Protocol error" 0 to 21 ms after open, before any frame, so nothing was captured on the wire. | none: no index, mark, funding, interval or next funding. The only reference prices are Cryptal's own spot ticker bid, ask and last (GET /api/v1/public/ticker, 69 rows, timestamp always 0). No anchor poller recommended. | Operator is Digital Ledger Technologies LLC (Georgia), holding a Georgian VASP licence and a Lithuanian FCIS licence. Trading needs a verified account, and citizens of 42 countries cannot be verified, including the United States, so US persons may not trade. Canada is not on the list. From this host (Canadian Surfshark VPN exit, SEA edge), public REST at exchange.cryptal.com (AWS Frankfurt) answered 200 on all six documented calls with no auth, at a median of about 155 to 160 ms. The WS at wss.cryptal.com/gex returned HTTP 101 and then a server close 1002 "Protocol error" on both addresses. The support country-list page returned a Cloudflare 403 challenge but was readable through the Zendesk API. No reply named a geoblock. | spot only |
| 26 | INX One, [`../profiles/inx-one/`](../profiles/inx-one/) | none | spot | none. INX One lists no perpetuals, futures, options or margin. It has spot crypto against USD: CoinGecko shows 10 crypto pairs plus NOTE-USD, 0.348 BTC of volume in 24 h, and USDT-USD alone is 28k USD. It also lists security tokens through INX Securities. INX is absent from CoinGecko's 214 derivatives exchanges. | 4000 | orderBook/subscribeOrderBook on wss://gw-client-api-ws.trading.republic.com. Per the docs it takes a depth value (20 is the only example), sends a snapshot on subscribe, then sends price-keyed deltas where amount 0 deletes the level. It has no sequence or update id and no checksum. Frames are plain JSON numbers with no documented compression. It is 5 subscriptions per key. The socket needs an approved API key plus a websocket token in the upgrade headers. None of this was probed because every upgrade was refused (see access). | none. The venue is spot only and publishes no index, mark, funding, interval or next funding. The only reference price is lastPrice in the keyed POST /api/market/getMarkets. No anchor poller is recommended. | The operator is INX Digital, Inc., a US money transmitter (NMLS 2094630). The General Terms say the service is not represented as available outside the USA. US persons may trade. Excluded regions are not published on the readable pages. From this host (Canadian VPN exit, Cloudflare loc=CA): the fee and API doc pages returned 200. trading.republic.com (web app) returned a Cloudflare 403 "Sorry, you have been blocked". The help center returned a Cloudflare 403 with error 1034. The REST gateway gw-client-api-rest returned 401 JSON "Request headers are invalid ... nonce, timestamp, apiKeyId, signedContext required" on getMarkets, ping and createToken. The WS gateway returned 401 "This websocket token or api key invalid" when a User-Agent was sent, and a Cloudflare 403 block without one (VenueFeed sends none). | no public API |
| 26 | BitBNS, [`../profiles/bitbns/`](../profiles/bitbns/) | bitbns | perpetuals | USDT-M 20 listed by the web app's route getInstDetails?network=mainnet, all with status 0. Only 1 (BTCUSDTP, 0.0006 BTC) traded in 24 h. CCXT 4.5.68 has 0 swaps (spot only, 224 markets). | 1000 | No public perp stream is documented. The web app uses Socket.IO 4 at wss://socket.bitbns.com/bnsFuturesSocket: emit switchRoom news_<coin_name> (for example news_BTCUSDTP) and it returns event news. On join it sends a snapshot of three frames 180 to 217 ms later: buyList and sellList as whole sides (at most 11 levels seen, the spot sibling caps at 15) plus tradeList. There is no sequence, no checksum and no timestamp, and frames do not name the instrument. permessage-deflate is not negotiated. The server pings every 25 s and closes at 45.6 to 45.9 s without a pong. No perp update was seen in 38 s. | None over REST. Index: only the web-app socket /bnsIndexSocket, event index_price_all, keyed by coin_id, covering 18 of 20 instruments, in a burst every 5.0 s. Mark: not published (docs say mark equals index). Funding: only the last settled rate per instrument, from an unauthenticated POST to futures-testnet/fundingRateHistory. It is in percent (inferred), 8 h at 00/08/16 UTC, capped at 0.5 %, and BTC showed the same -0.009573 for 16 days. Interval and next funding are not published as fields. The documented +-5 % price band did not hold: BTC traded 91 % below its index. | Operator: Buyhatke Internet Pvt. Ltd. (India, Karnataka law). CoinGecko lists the country as Estonia. The terms exclude only FATF-sanctioned countries and do not name US persons. INR rails need an Indian bank account. From this host through the Canadian Surfshark exit, every public bitbns.com route answered 200 via Cloudflare SEA. api.bitbns.com v1 answered 403 {"error":"invalid api key","code":401}, which is a missing key, not a geoblock. All Socket.IO hosts opened in 570 to 848 ms. | blocked |
| 26 | NBX, [`../profiles/nbx/`](../profiles/nbx/) | none | spot | none (no perpetual, dated future or option in the API spec, the archived 2025-06-07 catalog of 41 spot markets, or CoinGecko's 21 spot tickers) | 7000 | No book channel. The only socket is wss://api.nbx.com/markets/{market_id}/events, one market per socket and read-only with no subscribe frame. It sends order-level ORDER-OPENED, ORDER-CLOSED and TRADE-CREATED events. There is no snapshot on connect (a feed would seed from REST /markets/{id}/orders, which is paginated and cached up to 3 s), no sequence, and a checksum that is always null. Compression is not documented. Every handshake from this host got HTTP 522 (10 handshakes, 19,431 to 19,808 ms). | none. NBX is spot only and publishes no index, mark or funding. The only bulk price call is GET /tickers (NBX's own last trade and best bid and ask, cached 3 s, not paginated), and it returned 522 on all 6 polls from this host. | Operator is Norwegian Block Exchange AS, registered with Finanstilsynet, with a MiCA CASP application pending. It serves KYC'd customers aged 18 or over from "190 countries". Neither US nor Canadian persons are excluded by name, but the countries it serves are not listed. From this host (Surfshark WireGuard exit that Cloudflare places in Canada, loc=CA, edges YVR and SEA), every api.nbx.com REST path and WS handshake sent with Node's default client got Cloudflare 522 "Connection timed out" (origin unreachable) after about 19.5 s: 29 plus 6 REST requests and 10 handshakes, 04:47 to 05:08 UTC on 2026-09-23. The same URLs sent with curl's User-Agent got a 403 Cloudflare firewall block ("Sorry, you have been blocked"), and so did app.nbx.com with curl. WebFetch from its own network also got 522. | spot only |
| 25 | EXMO, [`../profiles/exmo/`](../profiles/exmo/) | exmo | spot | none | 10000 | spot/order_book_updates:<pair> on wss://ws-api.exmo.com:443/v1/public, documented as the top 400 levels at 100 ms. It sends a snapshot on subscribe (24 of 24 pairs, 217 to 222 ms, equal to REST). There is no sequence, update id or checksum, so the only resync is a reconnect. Deltas (by price, "0" deletes) are documented but none arrived in 2 x 100 s because the books are frozen. The server does not negotiate deflate. The server protocol-pings every 30 s (the docs say 3 min), and a socket with no subscription is closed at 30.7 s with 1006. | none. There is no index, mark, funding rate, interval or next funding. The only bulk call is GET /v1.1/ticker (24 rows of the venue's own book and last trade), so no anchor poller. | Nobody new may trade: EXMO.com (Blue Isthmus Technologies CORP, Panama) has been winding down since 2026-07-14, citing UK sanctions, with registrations and deposits closed and trading kept only for asset conversion. The terms bar sanctioned or unauthorized jurisdictions but name no country, US included. From this host (Canadian Surfshark exit), all public REST calls to api.exmo.com returned 200, and every WS socket opened in about 1 s behind a ddos-guard server header, with no refusal. | defunct |
| 25 | Nonkyc.io, [`../profiles/nonkyc/`](../profiles/nonkyc/) | none | perpetuals | USDC-M 80. These are the shared Orderly PERP_<BASE>_USDC markets, all ACTIVE, traded through perp.nonkyc.io, which is the Orderly builder `nonkyc`. Orderly also lists 59 markets under other builders' suffixes (57 _mythos, 1 _alpix, 1 _fastx), and none carries _nonkyc. There are no USDT-M, coin-M, dated futures or options. NonKYC's own spot exchange has 323 markets and appears only in the coverage matrix. | 1500 | wss://ws-evm.orderly.org/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY, one socket for every perp. {symbol}@orderbookupdate sends full-depth deltas on a 200 ms grid, only when the book changes, and no snapshot. The snapshot comes from {symbol}@orderbook: the whole book, up to 428 levels per side although the docs say 100, 112 to 168 ms after subscribe, then again on change, usually a second or more apart. Its ts sits on the delta chain. Sequence rule: data.prevTs equals the previous delta's ts, with 0 gaps over three book runs and two 80-market batch runs. A book rebuilt from the snapshot and deltas matched every later snapshot's top 20 levels. No checksum. Levels are sorted, prices and sizes are JSON numbers in base units (contractSize 1). permessage-deflate is not negotiated. The server caps a socket at 100 topics ("your subscribed topics have reached limit"), so both topics for 80 markets need two sockets. The server pings every 10 s and closes a socket that never answers with 1006, 110 s after the first ping. | GET https://api.orderly.org/v1/public/futures is one bulk call: 59.9 KB, 139 rows, medians 153 and 158 ms and max 246 ms over two runs of 60 polls. It carries index_price, mark_price, est_funding_rate (the predicted rate for the upcoming settlement, per period. Last_funding_rate equals the newest settled history row) and next_funding_time in Unix ms. The interval is only in GET /v1/public/info funding_period: 8 h on 40 markets and 4 h on 40. Clamps: the mark is clamped to a per-market band on the wire, mark_index_price_deviation_cap and _floor. BTC is ±3%, ETH ±2.4% where the docs say 3%, and 46 markets ±5.25%. On most markets that band is not the docs' factor times cap_funding. No mark sat outside or on its band edge. Funding is capped per market: ±2% on 52, ±0.3% on BTC and ETH. The index is a spot VWAP with a 5% clamp to the median. Basket source names (no weights) are public at /v1/public/index_price_source. No basket uses Orderly itself. 9 baskets include hyperliquidperp, and CL and BZ use only binancefuturesindex and hyperliquidperp. | US persons may not trade. Orderly Network Ltd.'s terms (Panama law) exclude US Persons (Reg S), access from US IPs and sanctioned or restricted persons, and they bind integrators such as NonKYC. NonKYC's own terms name no entity and exclude no region. CoinGecko lists it as Seychelles, and the perp front end config sets VITE_RESTRICTED_REGIONS to an empty string. From this host, through the Surfshark exit that geolocates to Canada, every public Orderly REST call returned 200. The Orderly socket opened in 155 to 255 ms. /v1/ip_info returned Vancouver, Canada, checked:false. nonkyc.io, perp.nonkyc.io and api.nonkyc.io returned 200, and wss://ws.nonkyc.io opened in about 700 ms. There was no refusal or geoblock. | fits with a named change |
| 25 | Upbit Indonesia, [`../profiles/upbit-indonesia/`](../profiles/upbit-indonesia/) | upbit (only with the option hostname: 'id-api.upbit.com', upbit.js line 97. CCXT 4.5.68 and master 4.5.82 have no class of their own for Upbit Indonesia) | spot | none (444 spot pairs: 32 IDR, 262 BTC, 150 USDT. No perpetuals, futures, options or margin. CoinGecko's derivatives list of 214 venues has no Upbit entry) | 5100 | orderbook on wss://id-api.upbit.com/websocket/v1: 30 levels by default, and the code suffixes .1/.5/.15/.30 pick the count. A snapshot arrives on subscribe (SNAPSHOT), then every REALTIME frame is the whole book again, so a feed replaces the book on each frame. No sequence and no checksum. Short sides are padded with price 0, size 0 slots. Frames are binary opcode holding UTF-8 JSON. Permessage-deflate is negotiated only when the client offers it, never forced. All 444 pairs ran on one socket at about 440 frames/s. The idle timeout is about 61 s on the wire, against 120 s in the docs. A protocol ping every 20 s or a text PING keeps the socket open. | none. There is no index, mark, funding, interval or next funding, since the venue lists no perpetual. The only bulk price call is /v1/ticker/all?quote_currencies=IDR/BTC/USDT, which gives the last trade (0 of 608 IDR rows changed over 20 polls). | Operator is PT Upbit Exchange Indonesia, licensed and supervised by OJK. Users need Indonesian KYC. Foreigners must hold a KITAS or KITAP Indonesian stay permit. Residents of sanctioned and FATF grey list countries are excluded. So a US person not resident in Indonesia cannot trade (the terms name no US ban, and the web app's 125-country list has no US entry). From this host, through the Canadian Surfshark exit, the public REST at id-api.upbit.com (AWS Jakarta) answered 200 on every call (warm about 356 to 361 ms). The WebSocket upgraded (101) in 887 to 1,195 ms. There was no geoblock or refusal. | spot only |
| 25 | Buda, [`../profiles/buda/`](../profiles/buda/) | none | spot | none. GET /markets lists 26 spot markets and no contracts, the docs describe no derivative, and CoinGecko's derivatives list (214 entries) has no Buda. | 8000 | Nchan socket wss://realtime.buda.com/sub?channel=book%40<id lower case, no dash>. You subscribe by listing comma-separated channels in the URL: no subscribe frame, no ack. Full-depth book with no level window. No snapshot on subscribe. book-changed carries one level as a signed size increment [side, price, amount], not the new size. A book-sync full snapshot comes for all markets at once every 178 to 179 s (the docs say 5 min). No payload sequence and no checksum. The ws+meta.nchan subprotocol adds per-channel Nchan ids that chain: 0 breaks in 38,328 ids. last_event_id replays up to about 200 buffered messages. Server protocol ping every 10 s, and a missed pong closes the socket at 20.3 s. The server offers permessage-deflate but it is optional. Unknown channels get 101 and then silence. | none. There is no index, no mark, no funding, no interval and no next funding. Only GET /tickers (last price for all 26 markets, no bid or ask) and GET /markets/<id>/ticker (one market per call) exist, so no anchor poller is recommended. | Trading: Buda.com SpA (Chile, RUT 76.415.528-9) and affiliates serve CL, CO, PE and AR. The terms exclude the US, Canada, US persons and Canadian persons, so US persons may not trade. Tested through the Canadian VPN exit: the public REST API returned 200 (404 only for bad paths) and the WS returned 101 on every attempt. Every HTML page, including api.buda.com docs, the fee page, the terms and the support site, returned 403 with a Cloudflare "Just a moment..." challenge, so the docs were read from Wayback snapshots. | spot only |
| 25 | KoinBX, [`../profiles/koinbx/`](../profiles/koinbx/) | none | perpetuals | 558 INR-margined linear perpetuals, every one a Binance USD-M contract: 329 quoted in USDT (300 crypto PERPETUAL, 29 TRADIFI_PERPETUAL stocks, metals and energy such as NVDAUSDT, XAUUSDT, CLUSDT) and 229 quoted in INR (200 crypto, 29 TradFi), all Open. marginAssetsSupported is ["INR"] on all 558, including the USDT-quoted ones. No USDT-M or coin-M margin, no dated futures, no options. Spot: 277 pairs (134 INR, 130 USDT, 7 BTC, 6 ETH). Launched 2026-08-15. CoinGecko lists KoinBX (id koinbazar) as spot only. | 500 | Book topic: <pair>@depth_<depthGrouping[0]> (event depthUpdate), for example btcusdt@depth_0.1, on the undocumented hub wss://kbx-futures-prod.webpubsub.azure.com/clients/socketio/hubs/KoinBX_Trade_Hub/?EIO=4&transport=websocket. The hub speaks Socket.IO 4 over Engine.IO 4 on Azure Web PubSub, and it was found in the web app bundle. One socket carries the USDT, INR and TradFi contracts. What a frame is: each frame is a whole 20-level book, with no snapshot and delta split, about every 500 ms. It is Binance USD-M's @depth20@100ms frame with the same u, one frame in five. U and pu equalled Binance's on every frame of the 06:22 UTC run. Frames arrive 131 to 872 ms after Binance's, with a median of 209 to 255 ms on busy contracts. Prices: levels are laid on a contiguous grid of one depthGrouping step and moved outward by a fixed number of steps per contract. BTCUSDT 2 steps (2.3 ppm), ETHUSDT 10 (36 ppm), XAUUSDT 20 (46 ppm), DOGEUSDT 6 (about 590 ppm), IRYSUSDT 2 (about 1,200 ppm), BTCINR 5 steps of 0.1 USDT times 95.55. Sizes: Binance's base-coin sizes, so contractSize would be 1. A few extra levels at fixed, often round prices are merged in, probably KoinBX's own resting orders. Wire format: U, u and pu are Binance's ids with no chain (pu equalled the previous u on 0 or 1 of about 150 BTCUSDT frames per run). No checksum. Bids ascending with the best last, asks ascending with the best first. Prices and sizes are strings. No permessage-deflate. Subscribing: send 42["subscribe",{"params":[...]}] and get 42["subscriptionStatus",{subscribed,alreadySubscribed}] back. Unknown, uppercase or wrong-grouping topics are acknowledged and never deliver. Keepalive: the server sends Engine.IO ping 2 every 25 s and the client must answer 3. An unanswered socket closed at 45.9 to 46.0 s, and a socket that never joins with 40 closed at 46 s. Capacity: 329 topics in one 8,088-byte frame on one socket gave 426 to 456 frames per second, about 400 KB per second, 966 bytes per frame and 36 to 38 µs to parse each. Stall: a subscribe whose params was a string stalled the hub for this host for 26 to 39 s. | No documented anchor. REST: the only bulk call is GET https://futures-api.koinbx.com/api/v1/market/marketInfo, 103 KB with 558 rows. It carries marketPrice (the mark) and upcomingFundingRate, but no index and no next settlement. It replied in 0.5 to 16.4 s, with a median of 3.1 s and timeouts at 10, 15 and 30 s. exchangeInfo carries fundingFeeInterval in hours (8 h on 156 contracts, 4 h on 400, 1 h on 2) and takes 27 s to over 150 s for 715 KB. The REST premiumIndex and fundingRate calls answer 404. Socket: the index lives only on the socket. Each contract has its own <pair>@markPrice topic, one frame a second, carrying p, ap, i, P, r, T, lr and st. The bulk !markPrice@arr topic is acknowledged and silent. Values: the mark and index are Binance's, rounded, within 1 ppm on BTCUSDT and 4 ppm on ETHUSDT, and E equals Binance's premiumIndex time. INR contracts are Binance's USDT values times a fixed 95.55. The funding rate is KoinBX's own, while T equals Binance's nextFundingTime. No clamp or funding formula is published. rest.md recommends no poller. | Operator: Kooz Advisors and Technologies Private Limited (KoinBX, India), registered with FIU-IND as a Virtual Digital Asset Service Provider. Who may trade: futures are open only to Indian residents with KYC-verified KoinBX (India) accounts. KoinBX Global futures are "launching soon" and publish no US policy, so US persons cannot trade today. From this host, through a Surfshark exit that geolocates to Canada: every public page, api.koinbx.com, futures-api.koinbx.com (Cloudflare, colos YVR and SEA) and the Azure Web PubSub socket answered with no refusal. Every socket upgraded with 101. Large futures REST replies trickle in over seconds to minutes. | blocked |
| 35 | OmniX, [`../profiles/omnix/`](../profiles/omnix/) | none | perpetuals | USDT-M 45 in the open API (43 in the web contract list, which leaves out E-MATIC-USDT and E-YFI-USDT). There are no USDC-M, coin-M, dated futures or options. Spot has 65 USDT pairs. | 600 | The channel is market_e_<coin>usdt_depth_step0 on wss://futuresws.coinchief.live/kline-api/ws, with one sub frame per channel. Every frame is a full book of 30 levels per side, arriving about 1.3 to 1.7 times a second on busy contracts. The first frame is therefore the snapshot, and it arrives 202 to 209 ms after the subscribe. There is no subscribe ack and no deltas. There is no sequence number, no checksum, and ts is floored to whole seconds. Bids are called "buys". Every server frame, pings included, is gzip compressed inside a binary frame. Unzipping costs 64 to 92 µs per frame. permessage-deflate is not negotiated. An unknown symbol gets back one empty-book frame with status ok. Sizes are in contracts of `multiplier` coins, which is inferred. 45 contracts ran on one socket at about 61 frames a second. | No bulk call returns a mark. GET https://futuresopenapi.coinchief.live/fapi/v1/index?contractName=E-BTC-USDT works one contract at a time and returns indexPrice, tagPrice (the mark), currentFundRate and nextFundRate. It has no interval and no next funding time. A 45-call round, 3 calls at a time, took 7.4 to 9.9 s. GET /cmc/specifications is bulk (45 rows, about 650 ms) and returns index_price, funding_rate and next_funding_rate_timestamp, but no mark. That timestamp is stale on 22 of 45 rows. The 8 h interval comes only from capitalFrequency in the web list. The index is frozen on 26 of the 39 contracts I checked against Gate. It sits 3.9% to 67.7% below Gate's index, for example BTC at 63,050.02 against about 86,470. Across three runs of 59 one-second polls, the BTC, ETH and SOL index values never changed. The mark tracks index × (1 + nextFundRate × fraction of the period left), so it follows the frozen index. No funding caps are published. The next rates shown go up to 0.015 per 8 h. There is no public funding history. | Who may trade: no legal entity, terms, excluded regions or US-person rule is published anywhere. omnix.vin is a static mockup, its config says only "Coin Chief", and the help-center legal pages still name BitonEx and cite Singapore AML law. What this host saw: from the laptop's Canadian Surfshark VPN exit, every public REST call answered 200. That covers futuresopenapi.coinchief.live, futuresopenapi.coinchief.work, openapi.coinchief.live and the www.omnix.vin config POST. The futures WebSocket opened in 274 to 304 ms. The openapi and futuresopenapi subdomains of omnix.vin return nginx 404. Nothing was geoblocked or refused. | blocked |
| 35 | YUBIT, [`../profiles/yubit/`](../profiles/yubit/) | none | perpetuals | USDT-M 514 (all contractStatus Trading, includes stock/ETF/commodity perps), USDC-M 0, coin-M/inverse USD 2 (BTCUSD, ETHUSD). Also 2 FreeU demo perps that cannot be traded for money, 0 dated futures, 0 options, 278 USDT spot pairs. Counts come from the undocumented web-app catalog GET www.yubit.com/mapi/trade/public/v1/market/dynamic_symbol | 800 | books-25.<symbolName> (e.g. books-25.M1BTCUSDT) on the undocumented web-app socket wss://www.yubit.com/realtime_public?v=2&bin=false, subscribed with {op:"subscribe",args:[...]}. Inverse contracts use /realtime?v=2. 25 levels per side (books-200 gives up to 400, books-20/50/80 answer "not exist"). A snapshot arrives on subscribe, but it is 4 to 10 s old and is followed at once by replayed deltas. After that come absolute-size deltas ("0" deletes) on a 500 ms ts grid, so the book is 2 Hz conflated and quiet contracts go 25 to 60 s without a frame. There is no contiguous sequence: cs is a per-symbol cross sequence that skips. Each delta carries b1/a1 (best bid/ask after the delta), and they matched the local book on every delta (1,433 and 1,455 deltas over 100 contracts), so they are the only integrity check. No checksum. Snapshot bids are worst-first ascending, asks ascending, and deltas are unordered. bin=false gives text JSON (bin=true, the web default, gives protobuf). permessage-deflate is negotiated only when offered. The server sends an app ping every 15 s, and sockets that never answered stayed open for 90 s | No REST bulk anchor call. Socket tickers.all pushes 519 rows about every 1 s with mp (mark) and ip (index) but no funding fields. Funding is per contract only: socket tickers-1000.<symbolName> (fr and pf scaled 1e6, nh interval hours, ft ISO next funding time), or REST funding-rate-history?symbol= (settled valueE8, history only). Index: 495 of 514 contracts have a single indexSource, BinanceFuture (432) or BitgetFuture (63). By its name that is another venue's perpetual, not spot, and weights are unpublished. Mark is a "weighted average of prices from multiple sources" with no published clamp. It equalled the last price on 335 of 514 contracts, and /mark-index/ had a median of 862 ppm. Funding = Clamp(MA(mid - spot index)/spot index - 0, a, b), with a and b unpublished. Interval is 8 h at 00/08/16 UTC, 4 h on some contracts. Majors' index changed about every 5 to 6 s and mark about every 2 to 3 s | SafeTrading Ltd (Seychelles IBC, reg. 240257). Terms exclude only persons on the FATF/OFAC SDN/UN sanctions lists and name no excluded country, so US persons are not excluded by name. The terms forbid automated scraping without written consent, and the futures rules forbid accessing undisclosed APIs and VPNs and list small-spread arbitrage as abnormal trading. From this host, through the Canadian Surfshark exit: www.yubit.com (Akamai) pages and the /mapi public calls answered 200. The web app's region check answered banned:false, accessDecision:allow, country CA. The web sockets upgraded 101 in 180 to 490 ms over 21 sockets. The Open API host openapi.yubit.com (Tencent EdgeOne) answered 403 "Forbidden" on every path tried except /mapi/. The yubit.com apex answered 307 in one run and timed out on connect in the other | no public API |
| 35 | UZX, [`../profiles/uzx/`](../profiles/uzx/) | none | perpetuals | USDT-M 60 (including XAUUSDT gold and UZXUSDT, the venue's own token), USDC-M 0, coin-M 6 (BTC/ETH/DOGE/XRP/SOL/LTC USD at 100 USD a contract). All 66 have status 1 in /v2/info/swap-usdt/symbols and swap-base/symbols. The bulk ticker also returns 8 delisted zero-price rows. Also listed: 85 spot, no dated futures, no options in the API. CoinMarketCap shows 38 derivatives pairs, and CoinGecko does not list UZX. | 500 | swap.orderbook with interval "0" on wss://stream.uzx.com/notification/ws (one URL for both perpetual families). Subscribe frame: {"event":"sub","params":{"biz":"market","type":"swap.orderbook","symbol":"BTCUSDT","interval":"0"},"zip":false}, one symbol per frame. Every push is the whole sorted book as string pairs, up to 500 levels per side (ETHUSDT always 500). Busy books push every ~100 ms. Quiet books push every 100 to 400 ms and resend identical books (XAUUSDT: 102 to 108 of about 180 frames). No deltas, so resetBook on every frame. There is no gap rule: the undocumented per-contract seqId never decreased and repeated only on identical books, and id/version is a global counter, not a book version. The REST book with the same seqId was identical level for level. Sizes are integer contract counts of swap_value coins, inferred from magnitudes and the whole-contract order unit. No checksum. permessage-deflate is not negotiated. zip:true switches the whole socket to Zstandard binary frames (magic 28b52ffd), although the docs say gzip. The server sends {"ping":ms} every 5 s. Four unanswered pings close the socket at exactly 20 s with code 1006. The documented 30 s idle close was not reproduced. Limits: 1 connection per second and 240 subscriptions per hour. 60 USDT-M contracts on one socket: 414 to 416 frames/s, 1.9 MB/s, 142 to 170 µs JSON.parse per frame. | One documented bulk call, GET https://api-v2.uzx.com/notification/swap/tickers (20 per 2 s per IP): about 34.5 KB, median 70 to 95 ms over 180 polls, none over 1 s. It carries index (index.close), mark (tag.close), funding_rate (a fraction per interval, always equal to pre_funding_rate) and next funding (funding_next_time, Unix s) for all 66 live perpetuals. It has no interval field. The only public interval source is the undocumented per-contract GET https://api.uzx.com/v2/info/swap/history/funding?symbol=X&page=1&size=1, field cycle in hours (8 h on 58, 4 h on 8). The WS swap.overview channel pushes the same rows every 1 s. Neither the index basket nor the mark formula is published. No mark clamp is published, and mark minus index reached 6,299 ppm. The published funding formula is Binance-style: Clamp[avg premium + Clamp(interest - premium, ±0.05%), cap, floor], recalculated once a minute, and the cap values are not published. But the live funding_rate equalled Binance USD-M lastFundingRate on 56 to 57 of 58 shared contracts, and on 7/7, 6/7 and 6/7 of the non-clamp rates, so UZX republishes Binance's rate. The largest settled rate in the last 100 settlements was -1.086% (ARKUSDT). | The terms (UZX Operators, with UZX.COM registered in the Cayman Islands) name the United States, Malaysia and Ontario (Canada) as restricted areas, so US persons may not trade. Contract trading is otherwise open after registration. All results are from this host near Seattle, through the Surfshark Canadian VPN exit (Cloudflare loc=CA, colo SEA/YVR). Every public REST call to api-v2.uzx.com and api.uzx.com returned HTTP 200 or a documented error (404 on bad paths, 422 code 100400 on missing params), with no geoblock or challenge. Every WS opened with 101 in 117 to 158 ms, except the bare wss://stream.uzx.com host, which returns HTTP 404. Only the web client's region check, POST /content/limit/region/judgeByIp, answered 401 "The current login status has expired". | fits with a named change |
| 35 | Echobit, [`../profiles/echobit/`](../profiles/echobit/) | none | perpetuals | USDT-M 124 visible (98 crypto, 26 TradFi such as AAPL, NVDA, SPY, XAU, CL), plus 74 hidden rows (delisted or scheduled) and 2 TUSDT simulation rows in GET /uapi/contract/list. No USDC-M, no coin-M, no dated futures, no options. Spot 249 rows, not detailed. | 600 | topic `depth` on wss://uapi.echobit.com/uapi/exchange/ws, one frame per symbol {"id","topic":"depth","event":"sub","symbol":"BTC-SWAP-USDT","params":{}}. Every push is the whole book, up to 200 levels per side (limit params ignored), pushed on change about every 300 ms at most. The first frame after subscribe is a whole book, but 20 of 124 first frames in one batch run were cut to exactly 1 or 20 levels (BTC once 5/5). Version v "<n>_18" strictly rises with conflated steps of up to 58, so there is no gap rule and nothing to resync except on close. No checksum. Bids descending, asks ascending. Sizes in contracts of the catalog multiplier. Plain text JSON (params.binary true gives gzip, permessage-deflate not negotiated). diffDepth exists but carries no previous version and its rebuilt ETH book kept dropped levels. 124 streams on one socket: 26 to 33 frames/s, 58 to 69 KB/s. | No bulk mark or index anywhere. Mark and index exist only per contract, keyed by indexId (BTCUSDT): the undocumented REST GET /uapi/exchange/{mark/index}/klines?symbol=<indexId>&interval=1m&limit=1 (close c), or the documented socket topics markKline_1m (a push every 1 to 2 s) and indexKline_1m (one a second). Funding is available in bulk from the documented socket fund_rates on wss://uapi.echobit.com/uapi/ws/inform, which pushes all 200 rows every ~2 s with no key, or from the website's undocumented GET www.echobit.com/mainapi/contract/fund/rates (32.7 KB, median ~475 ms). Both give fundRate (predicted), settleRate, settleTime and nextSettleTime in ms. Interval = nextSettleTime - settleTime: 66 visible rows on 4 h, 57 on 8 h in two phases, and 1 (AAPL) on 12 h. The index is an equal-weight average of undisclosed external exchanges after dropping anything more than 3% from the median, and BTC read within 6 ppm of OKX. Mark = median(index, index + 5 min MA of (mid - index), last). No mark cap is published, and the mark tracks the last price. No funding cap is published, and 12 hidden rows read -0.02. The ENA mark moved 1,006 ppm in one poll. | The user agreement (updated 2026-09-21) bars 33 countries, including China, Russia, the UAE, Ukraine, Indonesia and South Africa. The US and Canada are not on the list, and no page says whether US persons may trade derivatives. No legal entity is named. The site claims FinCEN and FINTRAC MSB registrations and a Czech VASP registration, none verified, and CMC lists the country as SG. From the Canadian Surfshark exit, every public REST call to uapi.echobit.com (CloudFront SEA) returned 200. Both public sockets returned 101 in 499 to 862 ms with no API key, although the socket docs list X-EC-APIKEY as required. Nothing was refused. A private call without a key returned 400 code -1002. | fits with a named change |
| 36 | CrypFine, [`../profiles/crypfine/`](../profiles/crypfine/) | none | perpetuals | USDT-M only. The venue's catalog call returned 403, so no count could be probed. CoinMarketCap's page on 2026-09-23 at 06:12 UTC listed 31 USDT perps (BTC-SWAP to GOLD(XAUT)-SWAP) with 197M USD open interest. The brief quotes 28 pairs and 188M. No USDC-M, no coin-M, no dated futures, no options. Spot exists. | 600 | Documented only, since the socket refused this host. Topic usdt/orderBook.{BTC-SWAP}.[5/10/50/100/200]. The first frame is action "insert" (snapshot) and later frames are "update" deltas. A `version` field is documented as "strictly increasing", but its step rule and whether it counts per topic are not specified. No checksum. Compression and push speed are not specified. The doc example's bids are out of order despite its comment. | No bulk REST index. GET /api/usdt/instruments/ticker_list has mark_price only. GET /api/usdt/instruments/funding_rate takes one contract per call at 3 per second, about 10 s per round for 31 contracts. Only the WS topic usdt/ticker.all carries indexPrice, markPrice and fundingRate together. Interval and next funding appear in no reply: the schedule is a fixed 8 h at 00, 08 and 16 UTC per the help center. Mark is the median of index plus time-weighted funding, index plus the 2-minute basis average, and the last trade. Funding is clamped at ±0.05% on (I minus P), with a 75% margin-based absolute cap and a change cap. The index basket is not published. Every call returned 403 here. | Operator is Crypfine LLC (Colorado). Its Terms exclude the US, Canada, the UK, France, Singapore, Hong Kong, the Chinese Mainland and sanctioned regions, so US persons may not trade. Futures API access needs KYC, an emailed application with a UID, and 5M USDT of futures volume per 14 days with at least 50% maker. From this host near Seattle, through the Canadian Surfshark exit (Cloudflare loc=CA), every documented REST path under openapi.crypfine.com/backend/exchange/{swap,spot}/ returned an HTTP 403 Cloudflare "Sorry, you have been blocked" page in 11 to 39 ms. The WS upgrade to wss://ws-openapi.crypfine.com/backend/exchange/stream/ws also got 403 in 51 to 90 ms. Other openapi paths reach the origin, which answers 200 with body {"code":403,"message":"禁止访问 ！！！"}. The docs themselves say "You must apply for a whitelist to access all APIs!" and give a firewall allow-list change on 2026-05-13. | blocked |
| 36 | Flipster, [`../profiles/flipster/`](../profiles/flipster/) | none | perpetuals | USDT-M 242. All are named <BASE>USDT.PERP and include TradFi perps such as XAU, CL, NVDA and SPY. The count comes from the flipster.io website's undocumented public stream, read twice on 2026-09-23, because the documented catalog calls return 401 without a key. The docs name USD1-M perps, but none were listed (0). There are no coin-M, dated futures or options. CoinGecko shows 243 perps. | 600 | Documented topic orderbook.{symbol} on wss://trading-api.flipster.io/api/v1/stream is described only as "real-time depth snapshots". Its depth, sequence and checksum are not specified. The handshake needs signed api-key/api-expires/api-signature headers and returned 401 {"error":"api.unauthorized"} to this host, so nothing was captured. The website's undocumented stream (market/orderbooks-v2) sends a whole uncompressed JSON snapshot every ~200 ms, with 40 to 158 levels, no sequence and no checksum, and sizes in coins. On zero-spread pairs (BTC, ETH) the touch is a thin 150 to 760 USDT quote one tick wide, and the real book starts 39 ppm (BTC) or 54 ppm (ETH) away. | The documented bulk call is GET /api/v1/market/ticker with no symbol. It carries indexPrice, markPrice, fundingRate, fundingIntervalHours and nextFundingTime (in ns), which covers all five AnchorRow fields, plus fundingRateCap. GET /api/v1/market/funding-info adds fundingRate (upcoming estimate) and lastFundingRate. Both return 401 without an API key. Mark = median(index*(1+lastRate*timeLeft/period), index + 30 s average basis, last trade), and "may" be forced to the list price in extreme conditions. The index is an equal-weight average of constituent exchanges, each capped to within 3% of the median, and the basket is not published. Funding = [Avg(P) + clamp(Avg(I)-Avg(P), ±0.05%) + an unpublished skew term]/(8/N). The cap is /rate/ <= 75% of the maintenance margin rate. The default interval is 8 h. | Flipster Corp (Panama. CoinGecko says Seychelles) excludes 62 jurisdictions, including the US, its territories, China, Singapore and the UAE, so US persons may not trade. Canada is not on the list. API access is a "private launch" for selected users on request. Results below are from a Surfshark exit that geolocates to Canada (x-prex-ipcountry CA, origin region tokyo). REST: /api/v1/public/ping and /api/v1/public/time return 200. Every market and trade call returns 401 {"error":"api.unauthorized"} with header x-prex-error-type: api.unauthorized. The documented WS upgrade also returns 401 with the same body. Only the website's undocumented stream wss://api.flipster.io/api/v2/stream/r230522-public accepted an anonymous connection. | no public API |
| 36 | x.me Exchange, [`../profiles/x-me/`](../profiles/x-me/) | none | perpetuals | USDT-M 266 active (343 listed, 77 status 0), USDC-M 0, coin-M 0, no dated futures, no options. At least 41 of the 266 are unflagged equity, ETF, commodity or pre-IPO perps (OPENAI, QQQ, SPY, TQQQ, SOXL/SOXS, NVDA, TSLA, SAMSUNG, SKHYNIX, XAU, XAG, CL, BZ, COPPER, SPCX, ZHIPU and others). Spot has 200 symbols and is named only. | 600 | market_e_<base lowercase>usdt_depth_step0 (the website's subSymbol, e.g. e_btcusdt against REST E-BTC-USDT) on wss://futuresws.x.me/kline-api/ws. Every push is a whole book of exactly 30 levels per side, sent every 500 ms (p50 500, p90 502 to 506 ms) whether or not it changed. Quiet books repeat identical frames (TRX 33 to 42 of 91, DOS 58 to 61 of 91). No ack, no sequence, no checksum: every frame is a snapshot, so the only failure signal is silence. Buys descending, asks ascending. Numbers are JSON numbers and sizes are integer contracts of `multiplier` coins. REST matched at 54/57 and 57/59 shared prices. Envelope ts is ms, 155 to 205 ms before arrival. Every frame is gzip inside a binary WS frame, and permessage-deflate is not negotiated. The server sends {"ping":<unix s>} every 10 s on subscribed sockets only. An unanswered subscribed socket lived 100 s, and an unsubscribed silent one closed at 60.8 to 60.9 s with 1006. Unknown symbol: one empty-book frame then silence. Closed contract: one stale book, never refreshed. All 266 on one socket: 532 frames/s, 242 KB/s gzipped, all served. | No bulk REST call. Per contract only: GET futuresopenapi.x.me/fapi/v1/index?contractName=E-BTC-USDT (undocumented, median 199 to 223 ms) or POST www.x.me/fe-co-api/common/public_market_info {"contractId":48} (median 160 to 166 ms), each giving indexPrice, tagPrice (the mark), currentFundRate (the upcoming rate) and nextFundRate (equal to it on 480/480 samples). Interval (capitalFrequency: 8 h on 103, 4 h on 163) and next funding (nextCapitalSettTime, Unix ms) come in bulk from POST fe-co-api/common/public_info. /tickers, /premiumIndex and /fundingRate answer -1002, the same reply as any unknown path. A full REST round of 266 took 26.3 to 26.7 s at 2 in flight. The WS market_<sym>_ticker channel carries mark, index and funds_rate for all 266 on one socket, with gaps median 1.2 to 1.8 s and worst 4.5 s. Index baskets (index_price_weight_list) weight other venues heavily, often Binance futures: BTC is okex 3 / binancefutures 8. The help article's OKX/HTX/Binance thirds disagree with this. No x.me self-index. Mark = median(last-ish price, reasonable price, index + 5 min MA basis), with no published premium clamp (seen -1,143 to +1,782 ppm). Funding caps are per contract by announcement (HYPER ±1.5%). KERNEL settled -1.288% per 4 h. Settled history comes from POST fe-co-api/common/funding_rate_list {"contractId","page":1,"limit":n}. The settlement instant was not captured. | Operator VOOX Limited (User Agreement, jurisdiction not stated. CMC country SG). Restricted Regions (help article edited 2026-07-01): Afghanistan, Mainland China, Cuba, Crimea, Iran, North Korea, South Sudan, Syria, Zimbabwe, Myanmar, Cambodia, United States. The User Agreement's older list omits the US. So US persons may not trade, and Canada is not listed. KYC is not required to trade. From this host through the Canadian Surfshark exit, every public REST call (futuresopenapi.x.me, openapi.x.me, www.x.me fe-co-api and fe-ex-api) answered 200 and every WS upgrade answered 101, with no refusal, challenge or geoblock. All sit behind Tencent EdgeOne at 43.169.25.48. public_info_v4 reports limitCountryList []. | fits with a named change |
| 36 | AstralX, [`../profiles/astralx/`](../profiles/astralx/) | none | perpetuals | USDT-M 32 listed (plus 19 hidden ids in the ticker and funding calls with zero volume and no book), USDC-M 0, coin-M 0. The 32 include XAUUSDT_PERP and XAGUSDT_PERP. | 600 | depth_full on wss://fws.astralx.com/future/websocket. This is the web front's own socket and is not documented. Subscribe with {id, topic:"depth_full", event:"sub", symbol:"BTCUSDT_PERP", params:{binary:false}}, one symbol per frame. Every frame is the whole book, up to 400 levels per side, pushed about every 200 ms (median 200 to 400 ms) as about 17.6 KB of JSON. The first frame arrives before the ack, with bids ascending and some numbers unpadded. Later frames have bids descending. There is no sequence field and none is needed, because each frame replaces the book. No checksum. The server never negotiates permessage-deflate, and binary:true only switches to a binary opcode carrying plain JSON. Text ping gets {"pong":ms} back. An idle unsubscribed socket closes at 60 s. Unknown or hidden ids are acked as success and then stay silent, and non-JSON text closes the socket. The top 20 prices matched OKX's book 20 of 20 on 5 contracts in 4 reads, with sizes about 0.9x OKX's. | One bulk call: GET https://www.astralx.com/futures/funding_rates (51 rows, 9,498 B, median 118 to 130 ms). It returns fundingRate, which equalled OKX's rate digit for digit on 6 of 6 contracts, plus nextSettleTime and lastSettleTime. The interval can only be derived where lastSettleTime is nonzero: 8 h on 10 rows, and 41 rows have 0. No REST call returns index or mark: /quote/indices and /quote/markPrice give 404. Index and mark exist only as per-symbol WS topics index_price and mark_price, one frame per second each. The published index equalled the mark on 25 of 25 pairs on 5 contracts, and the mark equalled OKX's markPx (7 of 10 exact, 3 one tick off). So the index is OKX's mark, not the documented 15-exchange basket. No clamp or cap is published. | Who may trade: the terms (AstralX Sp. z o.o., Poland, Singapore law) prohibit anyone located in the United States, and no other excluded-region list was found, so US persons may not trade. What this host saw, near Seattle through a Surfshark exit in Canada (Cloudflare loc=CA, colo SEA/YVR): www.astralx.com public calls answered 200 and wss://fws.astralx.com upgraded 101, with no challenge. api.astralx.com answered 403 with a SafeLine WAF page on every path, and its DNS is a wildcard. www.astralx.com/openapi/* answered HTTP 500 {"code":20401,"msg":"Authentication failed, login again"}, and unknown /futures/* paths answered 401. The help center JSON API answered 200, but the VIP article HTML got a 403 Cloudflare challenge and the API returned RecordNotFound. | no public API |
| H | Hyperliquid, [`../profiles/hyperliquid/`](../profiles/hyperliquid/) | hyperliquid | perpetuals | USDC settled: 178 main-dex perps, plus live builder-dex (HIP-3) perps on xyz, para, mkts and io | 450 | `l2Book` sends the whole 20-level book about every 5.4 s by default, or 5 levels about every 0.54 s with `fast`. No sequence or checksum. One unknown coin closes the whole socket | `metaAndAssetCtxs` in one call: `oraclePx` as index, `markPx`, hourly `funding` for the coming hour. It weighs 20 of a 1,200 a minute IP budget, so poll every 3 s at most | From the Canadian VPN exit, REST and socket answered with no refusal. The Interface terms bar US persons and Ontario | fits with a named change |
| 37 | Koinbay, [`../profiles/koinbay/`](../profiles/koinbay/) | none | perpetuals | USDT-M 127 active (plus 47 status 0), coin-M 1 (E-BTC-USD inverse), plus 2 odd BTC contracts (S-BTC-USDT margined in EXUSD, FILCOIN-BTC-USDT dead since 2021). 35 of 130 active contracts had no trade in over 7 days | 750 | market_<e_btcusdt>_depth_step0 on wss://futuresws.koinbay.com/kline-api/ws: every frame is a whole 30-level book (asks and "buys"), about 3 frames a second, first frame within about 740 ms, no deltas, no sequence, no checksum, no subscribe ack, unknown symbols silently ignored, static books send nothing (34 of 127 silent for 30 s), every frame is gzip inside a binary frame, permessage-deflate not negotiated, server JSON ping {"ping":sec} every 10 s | No bulk call: /fapi/v1/index?contractName=X returns indexPrice, tagPrice (mark), currentFundRate, nextFundRate for one contract (p50 273 ms), with no interval and no next funding time. The socket channel mark_price_<symbol> carries the same fields plus nextSettlementTime (08:00 UTC) at about 1 Hz and is pushed along with every depth subscription. Interval, cap and which rate is upcoming are undocumented and not verified. No clamp published. Small-contract index sat still for 60 s (SSV). | Operator KOINBAY LTD (DIFC arbitration). Terms Schedule 1 prohibit USA and US territories, China, Russia and others, and refuse service to EU, EEA and UK residents. Canada not named. From this host (Canadian Surfshark exit), every public futures REST call returned HTTP 200 (API on AWS Tokyo ALB) and the futures WS opened in 730 to 781 ms with no refusal. | fits with a named change |
| 37 | BITmarkets, [`../profiles/bitmarkets/`](../profiles/bitmarkets/) | none | perpetuals | USDT-M 129, from CoinMarketCap only (market-pairs category=perpetual, 2026-09-24). BITmarkets itself exposes no catalog this host can reach. No USDC-M or coin-M pairs seen. | 1000 | none: no documented socket. wss://platform-api.bitmarkets.com:8443 and :2096 (web app config) upgrade 101, send no frame, and close with 1000 about 250 ms after any client text frame. wss://ws.bitmarkets.com returns a stored block JSON (HTTP 200) instead of upgrading. Levels, snapshot, sequence, checksum: Not verified. No deflate offered. | none: no public index, mark or funding call. CoinMarketCap's copy has indexPrice and fundingRate per pair (62 of 129 at exactly 0.0001, range -0.00010348 to 0.0001), with no mark, interval or next funding. Formula and clamps are not published. | Futures are offered by Unicorn Technologies Limited (St. Vincent and the Grenadines) and spot by UAB BITmarkets (Lithuania). US and UK are on the restricted list, so US persons may not trade. From this host, via the Canadian Surfshark exit: bitmarkets.com gives 403 cf-mitigated challenge on every page except /en/api (404). api.bitmarkets.com has a TLS certificate that expired 2023-12-21, and behind it is 200 {"code":44444444,"msg":"block"}, which ws.bitmarkets.com also returns and WebFetch also got. platform-api /v1/* gives 404, myzone-api /api/v2 gives 401 or 404. | no public API |
| 37 | Batonex, [`../profiles/batonex/`](../profiles/batonex/) | none | perpetuals | USDT-M 119 (all TRADING, linear, contract size from contractMultiplier. No coin-M, no USDC-M, no options, no dated futures. Spot 30 pairs) | 700 | v1 topic `depth` on wss://wsapi.batonex.com/openapi/quote/ws/v1 with a comma-separated symbol list: every frame is a full book of up to 200 levels per side (docs say 300) at about 2.5 frames/s, so each frame resets the book. No deltas, no ack on v1, version `v` = "<n>_18" rises on every frame but skips numbers, so there is no gap rule and none is needed. No checksum. Plain JSON text: permessage-deflate was not negotiated, and binary is an opt-in flag. Sizes are contracts of contractMultiplier coins. One socket carried all 119 perps at 151 frames/s, 723 KB/s and 47.5 us parse per frame. Client sends {"ping":ms} (docs: at least every 5 min). A socket with no subscription was closed at 61 s. | Bulk GET /openapi/v1/contracts (119 rows, 250 ms warm) carries indexPrice, nextFundingRate (upcoming), fundingRate (last settled) and nextFundingRateTs in seconds. Interval is 8 h at 00/08/16 UTC, from /openapi/contract/v1/fundingRate (116 rows. The three INDEX* contracts are missing). No mark price is published: the markPrice call returns an empty 200 and the WS markPrice topic is refused. The index is another venue's perp mark: 107 of 119 are formula MARK_PRICE_BINANCE, equal to the Binance fapi markPrice to the last digit (83 of 113 exactly equal in a parallel fetch, 110 of 113 within 500 ppm). No funding cap or formula is published. | Operator is Pointex LLC under Seychelles law. The United States is absent from the 214-country registration list, and the terms name no other excluded country. From this host through the Canadian Surfshark exit: api.batonex.com REST and the wsapi.batonex.com WebSocket (AWS Tokyo) returned 200 and delivered with no refusal. The site returned 200. The help centre pages returned HTTP 403 with a Cloudflare challenge but were readable through the Zendesk API. | blocked |
| 37 | TruBit Pro Exchange, [`../profiles/trubit-pro/`](../profiles/trubit-pro/) | none | perpetuals | USDT-M 40 (no USDC-M, no coin-M. Includes TSLAUSDT, NVDAUSDT, XAGUSDT, PAXGUSDT, 1000PEPEUSDT and TBTCTUSDT, a second BTC contract with an index identical to BTCUSDT) | 600 | depthUpdate on wss://api-futures.trubit.com/ws/market, one {"op":"subscribe","key":"<SYM>","channel":"depthUpdate"} frame per symbol. Up to 20 levels per side. Each frame holds changed levels by price, qty 0 deletes, and trades ride along. Frames come every 200 to 800 ms. No snapshot on subscribe, so the book must be seeded from REST GET /depth/list level 20. No sequence number, update id or timestamp, so gaps cannot be detected. No checksum. qty is integer USDT notional, not contracts. Plain text when deflate is off, and deflate is accepted when offered. Text ping gets text pong. A REST seed plus deltas matched REST depth on 60 of 60 checks. | Three bulk calls cover all 40 perps: GET /basic/indexPrice (index), GET /basic/markPrice (mark) and GET /kLine/fundingRate?symbols=<all 40> (rate). The funding call fails with code 1 if symbols is omitted. Warm replies are about 258 ms median, 509 ms max. The API publishes no funding interval and no next funding time. Docs say 8 h, but the equity-perp article says 4 h. The rate's date field read 06:00 UTC and did not change for the whole minute. Documented funding cap is ±0.375% (125x contracts) or ±0.75% (50x contracts). No mark clamp or index basket is published. The MASKUSDT index kept the same time value for at least 892 s while its mark moved. | Operator is Lunexa Limited (St Vincent and the Grenadines). The user agreement excludes US citizens and residents, plus North Korea, Iran, Iraq, Syria, Yemen and Zimbabwe. Argentina service is being discontinued. From this host (Canadian Surfshark exit, loc=CA, colo YVR), all public futures REST calls on api-futures.trubit.com and the market WS returned 200 or opened. Errors come back as HTTP 200 with a nonzero code. help.trubit.com answered with a JS challenge and 403, so articles were read through the help.trubit.live Zendesk API (200). api.trubit.com answered 500 on every path tried. | fits with a named change |
| 37 | BitradeX, [`../profiles/bitradex/`](../profiles/bitradex/) | none | perpetuals | USDT-M 56 (72 listed, 56 with tradeSwitch true, one SOL-quoted xaut_sol switched off). A coin-M path exists in the web app but was not probed. | 600 | wss://fws.bitradex.ai/public (from the web app bundle, not documented). depth@<sym>,20 sends a full 20x20 snapshot about once a second (repeats with an unchanged id when the book is still). depth_update@<sym>,100ms sends deltas only, with string pu/fu/u where pu equals the previous u. The first delta's pu equalled the snapshot id on 3 of 3 symbols, with 0 gaps in 225 plus 1,111 deltas. No checksum, no compression (deflate not negotiated). Text ping/pong keepalive. A silent socket dies at 60 s. Bad topics or symbols get no reply. 56 symbols on one socket gave 94 frames/s. | GET www.bitradex.ai/v1/future-u/market/public/q/agg-tickers gives index (i) and mark (m) for all symbols in one call (65 rows, 12 KB, median 119 ms, p90 148 ms). Funding has no bulk call: q/funding-rate?symbol= per contract gives the predicted upcoming rate (fraction), interval in hours (8 h on 55, 4 h on trump_usdt) and nextCollectionTime. History settles at 00/08/16 UTC. Index, mark and funding formulas, basket and caps are not published. Observed funding range was +0.007166 to -0.006461. Mark minus index median is 516 ppm. | The ToS disclaimer excludes the United States and all US territories, Canada and others (the user agreement lists only Canada (Alberta)). Derivatives are also restricted in the UK and Australia. The operator is BITRADEX FINTECH LIMITED (UK), and the ToS names BitradeX Singapore as counterparty. From the Canadian Surfshark exit (Cloudflare loc=CA, colo=YVR, IPv6), every public REST path and the WS handshake returned 200/101 from Node. The only refusal is HTTP 456 with body "xxx", sent to the curl/8.14.1 user agent on any agent-independent URL. That is a UA filter, not a geoblock. api.bitradex.ai and api.bitradex.com return 401. | fits with a named change |

## Notes per venue

Blockers and open questions, as each researcher reported them.

### Crypto.com Exchange

Verdict: fits with a named change.
The CCXT catalog fits: 396 active swaps, market.id equals the socket and REST symbol, contractSize is 1 and matches the base-unit book sizes.
The book socket fits: snapshot on subscribe, a strict pu chain, 50 levels, 396 perps ran clean on one socket.
The REST anchor poller does not fit, because no REST call returns mark, index or funding in bulk and per-instrument polling cannot cover 396 perps at 1 Hz within 100 req/s.
The named change is a socket-fed anchor: mark, index and funding channels on 3 connections, read by an AnchorPoller subclass from an in-memory map.
Registry values would be takerPpm 400 and ccxtTakerPpm 5000.
Trading is barred for US and Canadian persons.

Blockers:

- No bulk REST anchor: get-tickers has no mark, index or funding, and get-valuations is per instrument and per type, so the engine's REST AnchorPoller cannot cover 396 perps at 1 Hz (one mark-only round took 10.1 s at 40 req/s).
  A socket-fed anchor is required.
- Derivatives are not offered in the US or Canada (both on the 93-location list), and the venue geolocates this host to Canada with Derivative:false.
  Observation works, trading from this host does not.
- The mark is clamped to the index plus or minus a bandwidth of at least 0.5% (per-instrument width unpublished), so legs beyond the band read a capped premium as fresh.
  A saturated-mark rule is needed.

Open questions:

- The derivatives fee table was read from the fee page's JS data module (constants-7giiyqF2.js) because the page hides it for this host.
  Its spot rows match the rendered spot table exactly, but a render from an eligible region was not possible.
- The algorithm behind the book checksum cs is unpublished and was not reproduced.
- What the book channel sends for an empty side is not verified.
  The REST ticker shows null sides on some TradFi perps, but the socket books checked held both sides.
- The per-instrument mark bandwidth and the fair impact size are not published.
  No funding cap or floor is published.
- The status and body at the REST rate limit (documented as 429 / 42901) and any Retry-After are not verified.
- The change log names a 'Market Data Websocket Subscription Limits' section that the current pages lack.
  The cap was probed at 400 channels per connection.
- The DENIED_PAIRS survey of Crypto.com base tickers against other venues was not done.
  Whether to cluster the 155 TradFi perps is open.
- Every WS error reply (40003 No such method, 40107) arrived 8 times, and why is unknown.

### OSL Exchange

Verdict: spot only.
OSL has no perpetual that can be traded.
OSL HK (the CoinGecko volume) is a spot-only exchange with 22 published pairs.
OSL Global's USDC-margined perps were all delisted: 21 in July 2026 and BTC-PERP on 2026-09-16.
There is no CCXT class in 4.5.68 or on master, so even a spot leg would need a catalog that does not come from CCXT.

Blockers:

- No perpetual: OSL HK lists spot only, and OSL Global delisted all its USDC-M perps (21 in July 2026, BTC-PERP on 2026-09-16). 25 stale rows remain with no live book.
- No CCXT class in 4.5.68 (104 ids) or on master (105 ids in exchanges.json).
  PR ccxt/ccxt#14820 has been open and unmerged since 2022-08-29.
- No index, mark or funding on OSL HK, so an anchor poller has nothing to read.
- API trading on OSL HK is limited to corporate, institutional, PI and omnibus clients.
  OSL Global does not onboard the US or Canada.
- The v4 book stream has no sequence that can reveal a gap, and v5 books15 gives only 15 levels against the engine's 20.

Open questions:

- Whether US persons may open an OSL HK account: the OSLDS terms v2.4 leave it to OSL's discretion beyond sanctions.
- Whether answering the v4 {"action": "ping"} matters: never tested successfully, and a socket that ignored the pings stayed open 76 s.
- The v4 heartbeat action documented every 30 s per instrument never appeared.
- What limit triggers OSL Global spot error 30007 'request over limit': seen once on two back-to-back subscribe frames, not reproduced twice.
- What reference price the v4 minPrice/maxPrice band centres on: it equals the last trade on 1 of 22 pairs.
- OSL Indonesia (13 IDR tickers on CoinGecko) has no public API link on osl.com and was not researched.

### KuCoin (KuCoin Futures)

Verdict: fits as is.
Every part of the engine's current shape is covered without changing it.
The CCXT kucoinfutures catalog gives market.id equal to the socket and REST symbol, and contractSize equal to the lot multiplier on 682 of 682.
The taker is 600 ppm per contract, which matches the published VIP 0.
The UTA obu increment@10ms channel gives a snapshot on subscribe plus a strict per-contract sequence, which VenueFeed can consume using its existing subscribeGapMs and connectStaggerMs.
One bulk REST call carries all five AnchorRow fields for every perpetual.
The registry needs only takerPpm 600 and a marketFilter of linear with settle USDT, because the 5 USDC-M and 4 inverse contracts all lose to a USDT-M twin and the inverse ones are 1 USD per contract.
The poller must also treat a non-200000 body code as a failed round, as the MEXC poller already does.

Open questions:

- The mark is median(price1, price2, last trade) with no published clamp, and it pinned to the last trade on quiet contracts (60 of 60 polls on XBTUSDCM and XBTUSDM in one run, 56 of 60 on AAPLUSDTM in the next) or to the index (CHRUSDTM 58 of 60).
  A guard at open is needed, the same trap as Gate.
- The three pre-market contracts (ANTHROPICUSDTM, BPUSDTM, OPENAIUSDTM) have an index that is KuCoin's own perpetual at weight 1, and should be skipped.
  GUAUSDTM holds 79 % of its weight on perpetuals (Binance 0.5263, KuCoin 0.2632), and 27 stock baskets hold KuCoin's own perp at 0.06 to 0.17.
  Stock basket weights changed within the evening.
- fundingFeeRate on XBTUSDTM changed 3 times in one minute and alternated -0.000063, -0.000064, -0.000063 on consecutive polls.
  Whether the bulk reply is served by out-of-sync backends was not established.
- The VIP tier qualification thresholds are rendered only in a browser session and were not verified.
  The support fee table (modified 2026-05-07) still shows the VIP 4 taker at 0.053 %, which an announcement raised to 0.060 % on 2026-05-18.
- UTA snapshot delay reached 6.2 s (INITUSDTM), and ESIMUSDTM got no frame within 12 s in one run.
  The unserved-stream timeout should be about 15 s.
- The UTA socket stayed open 90 s with a subscription and no client pings.
  Its limit beyond 90 s is unknown, while unsubscribed sockets and the classic socket close at about 60 s without pings.
- The deprecated obu depth 'increment' (deprecation announced for 2026-07-15) was still served on 2026-09-22.
  When it is switched off is unknown.
- Not observed: what obu sends for an empty book side, and how it handles a closed or delisted symbol.
- The docs disagree on the funding interest: 0.01 % per interval (help page) against a 0.06 % daily rate in the 2023 plan.
  The wire shows dailyInterestRate 0.0003, which is 0.01 % per 8 h.
  The 2023 cap formula (IM − MM) × 0.75 reproduces fundingRateCap on only 45 of 682 contracts.
- CCXT renames ALTUSDTM's base to APTOSLAUNCHTOKEN, so KuCoin's ALT perpetual never clusters with other venues.
  One pair is lost, and no false row results.
- The documented connection limits conflict: UTA public futures allows 250 or 300 new connections per 5 min on the same page, and the error page lists 'max session count limitation of 50' against 800 on the rate-limit page.

### Toobit

Verdict: fits with a named change.
CCXT 4.5.68 lists all 767 perpetuals, with market.id equal to the socket and REST symbol and contractSize equal to the book's contract unit. diffDepth gives a snapshot plus a gap-checkable counter, and three bulk REST calls fill every AnchorRow column.
The named change: CCXT sets no taker (market.taker is undefined on 767 of 767, toobit.js parseMarket lines 950 to 1030), so the registry must carry takerPpm 600 or the connector skips every market.
An optional marketFilter settle === 'USDT' drops the 10 redundant USDC-M contracts.

Blockers:

- US persons may not trade: Toobit discontinued US services on 2024-08-01, and the development host is in the US.
  Public market data is served normally.

Open questions:

- The diffDepth gap rule rests on the undocumented `o` counter.
  The docs only say version `v` is not unique, so a later release could drop or change `o`.
- 264 of 767 index baskets are single source (Binance alone on 176, 227 of them stock contracts).
  A route between Toobit and that venue compares against the other venue's own price.
  The deny-list decision is open.
- TON-SWAP-USDT is indexed on Binance GRAMUSDT alone, and Binance, okx and bybit list no TON perp.
  A DENIED_PAIRS line for TON|USDT is suggested.
  Other same-ticker, different-token cases were not surveyed.
- Private commissionRate returns separate open and close fees (documented example: 0.01% open taker, 0.04% close taker), against the published single 0.06% VIP 0 taker.
  What a VIP 0 account actually pays is account-gated.
  A 500 USDT balance already reaches VIP 1 at 500 ppm.
- Each push rescales the whole book ladder by one common factor (36 of 40 levels within 1% of 0.970 between two reads 150 ms apart), so the displayed depth looks like one automated quoter.
  How much of it a taker can reach is unknown.
  It is not a scaled copy of Binance's book.
- fundingRate keeps the just-settled rate with a past nextFundingTime for about 75 s after each settlement, so the poller should skip or flag those rows.
- The mark has no documented clamp and is often pinned to the last trade.
  A 2025-05-29 mark price deviation caused liquidations on PI, HYPE and XAUT.
- The documented X-Api-Limit-* headers were absent on every public reply.
  Behaviour at 429 or 403 was not reached.
- TBV_ contracts (69 in the mark reply, 48 in funding) sit outside the catalog, probably demo trading (inference).
- The USDC-M WS subscription works on the same URL.
  The docs name no USDC-specific stream.

### WhiteBIT

Verdict: fits with a named change.
CCXT loads 304 active linear USDT swaps whose market.id (BTC_PERP) equals the socket key and the /futures ticker_id, CCXT's taker of 550 ppm is read from the reply and matches the published VIP 0 default, the depth channel gives a snapshot plus a strict past_update_id chain with 0 gaps for all 397 perps on one socket, and /futures carries every AnchorRow field in one call.
The named change is a registry contractSize: 1, because CCXT sets contractSize to the amount step (0.001 on BTC_PERP, 1,000,000 on PEPE_PERP, 110 of 304 not 1) while books and volumes are in base coins.

Blockers:

- CCXT 4.5.68 whitebit.js:501 copies the amount step into contractSize, so 110 of 304 perps would be mis-scaled by 1e-3 to 1e6 unless the registry sets contractSize: 1 (Gemini precedent).

Open questions:

- Which funding rate is charged at settlement and what /futures shows in the minute after the instant: not captured, the only settlement in reach was 2026-09-23 00:00 UTC, two hours after probing.
  The `rest-probe.mjs` settlement mode is ready for a later run.
- Mark formula, averaging window and any clamp are not published in readable pages (help center refused).
  Crypto mark was seen 3.5 to 4.5 percent off the index.
- Index basket is not published.
  The documented fallback to spot last then perp last may explain crypto perps whose index equalled their own last on five reads (SUSHI, CVC, MANTRA, OPEN).
- Anchor values move in about 5 s steps and the REST reply can step back to an older snapshot.
  The 1,000 ppm move guard and arrival-stamped age see 5 s of movement or a false reversal at once.
  Consider a stale-reply filter or the premiumIndex socket.
- Futures VIP tier table unreadable (fee and VIP pages Cloudflare-challenged).
  Only the VIP 0 API default and the market-maker floor (-0.012% maker, 0.025% taker) are verified.
- Legal entity of the global platform not stated in any readable page (CCXT says EE, CoinGecko Lithuania, a third party UAB Clear White Technologies).
- A socket that subscribed and then sent nothing stayed open past 75 s despite the documented 60 s client-inactivity rule.
  Longer holds untested.
- Thin touch: BTC_PERP best level was usually 0.013 BTC (about 1,120 USDT), near the engine's 1,000 quote-unit thin_book guard.
- Price scale and ticker collision surveys against the running venues not done.
  BB_PERP is BounceBit and QNT_PERP is Quant by index_name.

### Bitvavo

Verdict: spot only.
Bitvavo lists no perpetual, future or option.
CCXT 4.5.68 builds all 438 markets as spot (bitvavo.js lines 32 and 493 to 498), so the connector's active-swap filter keeps 0 and skips the venue, and there is no index, mark or funding for an anchor.
Its spot WebSocket book is clean: a nonce chain with 0 gaps and a getBook snapshot on the same socket.

Blockers:

- No perpetual: CCXT 4.5.68 returns 438 spot and 0 swap markets, so connector.ts lines 196 to 203 keep nothing and lines 49 to 51 skip the venue.
- No index, mark or funding exists, so no AnchorRow can be filled and every route would be refused as anchor_no_mark.
- 427 of 438 markets are EUR-quoted, outside the USD/USDC/USDT quote family.
  Only 11 USDC spot markets could even cluster.
- Trading is limited to residents of SEPA countries, and US residents cannot open an account.
- VIP 0 spot taker is 2,500 ppm (category A), five times a typical 500 ppm perpetual taker.

Open questions:

- The live fee page answers 403 with a Cloudflare challenge.
  The tier tables come from the Internet Archive capture of 2025-11-13, and only the 0.25 % first-tier taker is confirmed current, by a help article updated 2026-09-22.
- The API's feeCategory letters (A 422, B 10 USDC markets, C 5 stablecoin pairs, D EURC-EUR) no longer match the 2025-11-13 page's letters, so the current VIP 0 rate of the USDC markets is not verified.
- CCXT reports maker 0.002 on every market, while its own tier table and the published first tier say 0.0015.
- What book or getBook sends for an empty side was not observed, since all 438 ticker/book rows had both sides.
- The nonce reset after a matching engine restart is documented but was not observed.
- Whether a client protocol ping costs a weight point is not documented.
- Market Data Pro (non-conflated, about 47.5 ms sooner) needs an API key and was probed only for its refusal.

### Bitunix

Verdict: fits with a named change.
The socket and the anchor fit the engine: one public URL, whole-window depth_book15 frames that need no sequence handling, and one bulk REST call with all five AnchorRow fields.
But CCXT has no Bitunix class, so the catalog needs a loader that reads /api/v1/futures/market/trading_pairs instead of loadMarkets.
That loader must also take the base from the symbol prefix on 13 scaled contracts.
Caveats: the book has 15 levels, not 20, and refreshes on a timer of about 310 ms.
Funding arrives in percent.
REST errors come back as HTTP 200 with a JSON code.

Blockers:

- No CCXT class in 4.5.68 or master, and the engine builds every catalog from CCXT loadMarkets (connector.ts line 68, registry.ts lines 40 to 77), so a non-CCXT catalog loader is required.
- US persons may not trade (Prohibited Jurisdictions notice 2026-08-05).
  Reading public data works from this host.

Open questions:

- Is the REST fundingRate the rate charged at the next settlement, or (per the help article) a prediction for the period after?
  Not verified, and no settlement was waited for.
- Coin-M size unit: book sizes and minTradeVolume 100 on BTCUSD look like US dollars, but no document states it.
- The index basket and its constituents are unpublished, and the Spot Index Price and Mark Price article sits behind a Cloudflare challenge.
- Does the single futures fee column (0.02%/0.06% at VIP 0) apply to USDC-M and coin-M as well?
  The fee page does not split by family.
- Liquidation fee not published.
- No official page read names the contracting legal entity.
- Two limits were not tested to avoid an IP block: the WS 5 messages per second, and the REST limit replies (codes 10005 and 10006, HTTP 200).
- Size unit on the 12 scaled contracts other than 1000PEPEUSDT was not compared.

### BingX

Verdict: fits with a named change.
The CCXT catalog, the one bulk anchor call and a snapshot-plus-update book all exist, and sizes are coins, matching contractSize 1.
Three changes are needed.
The feed must gunzip every frame in handleMessage and answer the text Ping with Pong.
It must accept any forward jump in lastUpdateId instead of the strict +1 rule, which would resync most streams about once a minute.
The registry needs a marketFilter on info.status === 1, because CCXT keeps 160 or 161 status-25 contracts active that have no book and no anchor row.
Books for symbols other than BTC and ETH push only every 400 to 800 ms.

Blockers:

- Trading only: the Customer Agreement excludes US and Canada users, so an account for a US-based operator is not permitted.
  Public market data is not blocked from this host.

Open questions:

- The live VIP tier table at bingx.com/en/support/costs renders client side and was not read.
  Tiers come from the 2023-10-25 article plus the 2026-06-26 Elite and Supreme changes, and where Elite sits against VIP 1 to 5 is unknown.
- Whether skipped lastUpdateIds ever carry real level changes under heavier load.
  The evidence is about three minutes of batch runs plus REST comparisons.
- What lastFundingRate does across a settlement instant.
  It was not captured.
- The per-contract index basket is not published, so a self-referential index cannot be ruled out.
- The first bookTicker frame of one run was 22 minutes stale (T versus E, bid 212.7 above the live book).
  The cause and frequency are unknown, and the channel is not recommended.
- One contract flipped between status 25 and 1 across reads 26 minutes apart.
  Unclear whether TradFi status follows market hours.
- The TradFi taker is region dependent and cannot be pinned without an account.
- What incrDepth sends for an empty book side.
- The coin-M depth field v reads as 100 USD contracts.
  This is an inference, and CCXT reads the coin amount a instead.

### Bullish

Verdict: blocked.
The production API refuses this US host with a geoblock 403 on every REST and WebSocket path, and the Bullish GI terms bar US persons from perpetuals.
The protocol itself would fit: the CCXT catalog maps ids and contractSize 1 cleanly, and the book socket sends full snapshots.
Even from an eligible host, though, the anchor would need a named change: a per-symbol tick fan-out or a WS tick feed, since no bulk mark/funding call exists.

Blockers:

- Production REST and WebSocket answer HTTP 403 'not currently available in your location' to this host on every path, so neither the catalog, the book nor the anchor can be read.
- Bullish GI terms clause 6.1.1 bars US citizens, residents and persons located in the US, and Bullish US offers spot only.
- No bulk mark or funding call exists: the anchor needs 22 per-symbol tick calls per round, or a WebSocket tick subscription, which the engine's REST AnchorPoller does not support.
- AnchorPoller treats 403 as a rate limit, so from this host it would pause forever instead of failing.

Open questions:

- The frame rate of production l2Orderbook, and whether production sequenceNumberRange widens (conflates several events into one frame).
  SimNext always had lower equal to upper.
- The exact production perpetual list and which ones are enabled.
  CoinGecko shows 22 pairs with 19 tickers, and the SimNext list differs.
- The production idle timeout: docs say 5 min, CCXT 100 s, SimNext closed at about 60 s.
- Whether the production mark respects the documented clamp.
  SimNext marks sat below the bid on three reads.
- The index constituents per asset, and how much weight the Bullish market price carries in the median.
- Whether production uses TON or GRAM as the ticker for the Toncoin perp.
- Why 6 of 24 SimNext funding hours read 0.
- Whether a host in an eligible jurisdiction (the docs suggest GCP asia-southeast1-a) would be served.
  Not tested, since that would route around the refusal from here.

### Bitso

Verdict: spot only.
Bitso lists no perpetual.
All 54 CCXT 4.5.68 markets are type spot, bitso.js sets 'swap': false, the connector keeps 0 swaps, and there is no index, mark or funding for an anchor.
Its VIP 0 spot taker is 3,600 ppm on the USD and USDT books and 7,800 on MXN.
Even as a spot leg, the socket has no snapshot and would need an order-level book with one REST seed per book under a 60 request a minute per IP limit.

Blockers:

- No perpetuals: all 54 markets are spot, and connector.ts isActiveSwapMarket (lines 196 to 203) keeps 0, so the venue is skipped with 'no usable swap markets'.
- No index, mark or funding anywhere, so every route would be refused as anchor_no_mark (anchorReading.ts lines 36 to 38).
- VIP 0 spot taker is 3,600 ppm on usd and usdt books (7,800 on mxn), 7.2 times Gate's 500 ppm perpetual taker.
- US and UK residents and citizens are Prohibited Jurisdictions under the Bitso International terms, so no account is possible from the US.
- The WS has no snapshot: a feed needs a per-order map, a REST seed of the whole book per book, and a per-book resync.
  That fits badly with the public limit of 60 requests a minute per IP and with VenueFeed.resync, which terminates the whole socket.

Open questions:

- Whether the Bitso Onchain 'Perps' feature (web bundle flag defi-alpha-hyperliquid-perps-support, Perps Aggregator announced for Q1 2026) is live, and for which regions.
  It would be Hyperliquid's book, not Bitso's.
- What the orders channel sends when one side of a book empties.
  No one-sided book was seen on the socket.
- Connection or handshake caps and maintenance notices on the WS are not published and were not reached.
- The rate-limit reply (documented as HTTP 420, code 0801) was deliberately not triggered, so its body and any Retry-After are unverified.
- The shape of completed diff entries rests on 3 samples (no a and no v).

### HashKey Exchange

Verdict: spot only.
HashKey Exchange has no live perpetual.
Its one contract, BBTCUSD-PERPETUAL, is a staging instrument with an empty book and no funding or index endpoint.
There is no CCXT class for this venue, and no anchor exists to poll.
The spot book feeds are sound but the engine takes no spot legs: V2 depth gives full 100-level books at about 100 ms, and V1 diffMergedDepth has a strict per-pair sequence.
The VIP 0 spot taker of 0.29 %, plus a USD 1.99 minimum fee per order, would also be expensive.

Blockers:

- No live perpetual on the HK site: BBTCUSD-PERPETUAL has an empty book and no trades since 2026-01-28, and the docs list futures fund-statement types as 'To be released'.
- No CCXT class for HashKey Exchange: `hashkey` targets HashKey Global at api-glb.hashkey.com with Global's fee constants (spot 1,200 ppm, swap 600 ppm).
- No anchor: /quote/v2/index and /quote/v1/index return 404, there is no funding endpoint, and mark is only per symbol.
- If `hashkey` were pointed at api-pro, CCXT would load BBTC/USD:USD as an active linear swap (status TRADING), so the connector would need a filter.
- Spot VIP 0 taker is 2,900 ppm (0.29 %), plus a USD 1.99 minimum fee per fully executed order, which binds below about USD 686 notional.
- US persons are excluded, and any HK perps would be professional investors only.

Open questions:

- When and whether HashKey Exchange launches PI-only perpetuals under the SFC framework of 2026-02-11.
  The site script has isFuturesWhiteList and a Derivatives menu.
- Whether the MENA site's 6 USDT-M perps on the same host (site=MENA) should get their own profile.
  Their books were live, but api-pro serves no public index or funding call for them.
- Whether the USD 1.99 minimum fee is still the current amount: the live fee page fills that number in by script.
- What BBTC is.
  Its mark tracks BTC spot to within about 30 USD while its book is empty.
- Why warm REST latency is bimodal on every endpoint (about 160 ms or about 440 ms).
  The offsets suggest the delay sits on the request leg between the edge and the origin.
- One silence run started alongside a book run ended before any socket reported open, close or an HTTP refusal.
  It was not reproduced, and 12 sequential sockets all opened.

### Ourbit

Verdict: fits with a named change.
CCXT has no Ourbit class in 4.5.68 or on master (commit 1d8b674).
Ourbit's futures API copies the MEXC contract API v1, so the named change is the catalog: createExchange returns new ccxt.mexc({id:'ourbit', name:'Ourbit', urls:{api:{spot:{public:'https://api.ourbit.com'}, contract:{public:'https://futures.ourbit.com/api/v1/contract'}}}}).
That loads 735 active linear swaps. id equals the socket and anchor symbol, and contractSize is correct (checked against turnover on 735 of 735). market.taker is 0.0004 from takerFeeRate (mexc.js:1465).
The id override is needed because the connector keys venues by exchange id.
The book feed fits VenueFeed with sub.depth.full 20 (a whole top 20 on every push).
The anchor poller fits with two bulk calls per round and one flag: the bulk ticker is a 2 s snapshot up to 3.2 s old.
The poller must also treat HTTP 200 bodies with success false as failures.
Registry: takerPpm 400, ccxtTakerPpm unset.
Eight 1000x/1000000x contracts need price scales.

Open questions:

- Sub.depth.full was tested on only 2 or 3 symbols per socket.
  Only sub.depth (plain and merged) was tested at 150 per connection.
  Run a depth.full batch before activation.
- PriceCoefficientVariation is documented only as 'fair price coefficient variation'.
  If it is a mark clamp, BTC_USDT and ETH_USDT premiums would saturate at 0.4% (a capped premium reading as fresh).
  It never bound in three snapshots.
- The meaning of the index sources is unknown: the CIP-suffixed ones (BINANCECIP, BINANCECIP_INDEX, GATEIOCIP and others), OURBIT (spot or own perp?), and 'REAL-TIME US STOCK QUOTE2', which also sits in crypto baskets.
  DRV_USDT (GATEIO+OURBIT), seven 3-source baskets with OURBIT, and APM, CVXSTOCK and VOLX (single source) are deny-list candidates.
- Whether the settled funding rate equals the last published estimate was not captured.
  No settlement instant was waited on.
- One push.tickers frame carried 808 rows against 735 in the catalog, and CoinGecko shows 770.
  The extra rows were not identified.
- One 150-symbol plain-delta socket closed with 1006 after 14.6 s at a peak of 7,565 frames/s.
  The rerun held 60 s.
  Cause unknown.
- The HTTP status and body of a rate-limit refusal (documented code 510) are not verified.
  The documented limits are 20 per 2 s per endpoint and 1 per 5 s on /detail, from an unserved doc.
- The public market API is documented only in the unserved 2021 to 2024 v1 doc, whose host contract.ourbit.com no longer resolves.
  The live host futures.ourbit.com may change without notice.
- The current general VIP tier table is browser-rendered and was not read.
  The profile uses the March 2025 table and the Taiwanese table (VIP 0 taker 500 ppm there).

### Bitkub

Verdict: spot only.
All 473 catalog rows are market_segment SPOT, and CoinGecko's derivatives list has no Bitkub entry, so there is no perpetual leg.
There is no CCXT class in 4.5.68 or on master (commit 1d8b674), and no index, mark or funding for an anchor poller.
The spot market is 356 active THB pairs, and THB is outside the USD/USDC/USDT quote family.
The 10 USDT pairs are 'broker' books that copy Bybit spot with about 1,400 ppm added to each side.
The only streamed book has no sequence and no snapshot, and it misses most book states.

Blockers:

- No perpetuals: 473 of 473 symbols are SPOT, and CoinGecko's derivatives list has no Bitkub entry.
- No CCXT class in 4.5.68 or on CCXT master (commit 1d8b674, 2026-09-22).
  New-exchange PRs 5860 and 7021 and issue 4488 are still open.
- No index, mark or funding, so no anchor poller is possible.
- The order book stream allows one pair per socket and sends no snapshot on connect.
  It has no sequence or timestamp, and only 8 to 10 of the 26 to 32 REST books seen in 30 s ever arrived on the socket.
- Every order book socket carries about 200 global.ticker frames per second.
  For all 356 THB pairs that scales to about 71,000 frames and 17 to 19 MB per second.
- The main market is quoted in THB, which is outside the quote family, so THB pairs would form clusters with no other venue.
- The 10 USDT pairs are broker markets that copy Bybit spot (volumes within 0.5 % of Bybit's, sizes often identical) with about 1,400 ppm added to each side.

Open questions:

- The current official fee page returns a Cloudflare 403 to this host and to WebFetch.
  The 0.25 % THB fee comes from a Wayback copy of 2025-08-14.
  The 0.1 % fee on USDT pairs comes only from the search index of the current page.
- A 0.1 % tier at 5M USD of 30-day volume appears on Traders Union only.
  No official source confirms it.
- No Bitkub document names Bybit as the source of the broker books.
  That is an inference from prices, sizes and volumes.
- It is not known why depthchanged fires on some book changes and not others, or whether the ticker or the depth frame is older when their touches disagree (they matched about half the time).
- The broker bids and asks calls return error 59, which is not documented.
  The docs list 61 for broker coins.
- Market.trade.thb_btc, documented as closed on 2026-05-18, still delivered one trade frame in one of three 8 s holds.
- Orderbook/99999 streamed global.ticker in both run 1 holds but was silent in run 2.
- US persons are not explicitly named as excluded or allowed.
  The residence rule for foreigners was read only through search-index snippets of support articles that return 403.

### Luno

Verdict: spot only.
Luno lists 145 spot markets and no perpetual, dated future, option or margin product (CCXT swap false, 145 of 145 markets spot), so the connector, which keeps swap markets only, would load zero markets and skip the venue.
It also publishes no index, mark or funding, so every route would be refused at open.
Its only book stream is order by order, one socket per pair, and documented as needing an API key.

Blockers:

- No perpetuals: 145 of 145 markets are spot, and the connector keeps only active swap markets (server/src/ccxt/connector.ts lines 196 to 203), so it logs no usable swap markets and skips the venue (lines 49 to 52).
- No anchor: no index, mark or funding exists, so readAnchorPair refuses every route as anchor_missing or anchor_no_mark (server/src/engine/opportunity/anchorReading.ts lines 25 to 27 and 36 to 38).
- The market stream is documented as requiring an API key as the first frame.
  A keyless {} worked on 2026-09-22, but that path is undocumented.
- The stream is per order, with one pair per socket and a documented cap of 50 simultaneous sessions, so a feed needs an order-id map that it aggregates per price, and trade updates must reduce order volume because a filled order gets no delete.
- US persons cannot trade: accounts are limited to residents of South Africa, Nigeria, Kenya, Malaysia and Indonesia.

Open questions:

- Whether facts measured through the undocumented keyless {} stream path are acceptable, or the book should be re-verified with a read-only API key.
- Which REST rate limit the origin enforces: the docs say 300 calls per minute, and every reply header says x-ratelimit-limit 5000;w=1.
  No 429 was provoked.
- Whether the 50 session stream cap counts per API key, per IP or globally: not stated, and not probed beyond 12 sockets at once.
- Which legal entities serve Malaysian, Indonesian, Nigerian and Kenyan accounts: the licence page on www.luno.com renders by script and was not read.
- The general fee article's Tier 6 example (R16 million) disagrees with the South Africa tier bands.
  The per-country table, edited 2026-09-17, was taken as current.
- Quiet books seem to get one empty sequenced update every five minutes (PAXGUSDT timestamps 01:30:00.562 and 01:35:00.561 UTC, sequence +1).
  This is an inference from two readings.
- Status_update (POSTONLY during the 5 minute circuit breaker halt) and a one-sided book were not observed on the stream.

### Bitbank

Verdict: spot only.
Bitbank lists no perpetual, dated future or option.
CCXT 4.5.68 loads 62 spot markets and 0 swaps, so the connector's active-swap filter (connector.ts lines 195 to 202) leaves nothing, and there is no index, mark or funding to anchor on.
Even as a spot leg, every quote is JPY or BTC, which the quote family does not merge with USDT, so no cross-venue cluster would form.
Spot fees: VIP 0 taker 0.12% (1,200 ppm) and maker -0.02% (-200 ppm) on 43 JPY pairs.
BTC/JPY has been 0.10% taker (1,000 ppm) and 0% maker since 2026-02-02.
The pairs API and CCXT market.taker report the same values.

Blockers:

- No perpetual product: CCXT bitbank has swap false (bitbank.js line 29) and loadMarkets yields 62 spot markets, 0 swaps.
- No index, mark or funding anywhere, so no AnchorRow can be built.
- Every market is quoted in JPY or BTC, outside the USD/USDC/USDT quote family (quoteFamily.ts lines 3 to 6).
- Socket.IO text framing (40, 42[...], ping 2 and pong 3) cannot be sent through VenueFeed's JSON.stringify subscribe path (VenueFeed.ts line 143) without a handleMessage-driven handshake.
- Depth_diff sequence is global across pairs and never consecutive, so a lost diff is undetectable until the next 15 s whole.
- Accounts are in practice limited to residents of Japan, and US persons abroad cannot trade.

Open questions:

- The residency rule was read only from search snippets, because support.bitbank.cc answered 403 (Cloudflare challenge) to this host and to WebFetch.
  ToS Articles 3, 4 and 15 were read in full.
- The VIP programme (ビットバンクVIPプログラム) publishes no thresholds or rates.
- A REST depth snapshot's sequenceId matched a socket rebuild at that id in only 6 of 12 comparisons.
  Why the REST id does not fall on a diff boundary is unexplained.
- No public REST rate limit is published (the documented 10 QUERY/s is per user, for the private API), and no 429 was provoked.
- Circuit breaker auctions (up to 400 levels, crossed books, side-based fee types) were not captured live, because only mkr_jpy sat in FULL_RANGE_CIRCUIT_BREAK, with an empty book.
- It was not measured whether diffs are ever lost in practice over a long session.

### CoinW

Verdict: fits with a named change.
CoinW has 387 live perpetuals, a public book socket and a public anchor, but two parts need named changes.
First, CCXT has no CoinW class in 4.5.68 or on master (commit 1d8b674), so the catalog needs a loader from GET /v1/perpum/instruments.
That loader uses rawMarketId = name (BTC, BTC_USDC), keeps the 1000 prefix, and sets contractSize to 1 because book sizes are base currency.
Second, the anchor exists only on the socket, because no REST call returns a mark or the upcoming funding rate.
The REST poller has to become a socket-fed anchor: index_price, mark_price and funding_rate for each contract, 3 subscriptions per contract, at most about 171 contracts per connection.
The depth channel fits as is: every frame is a whole book, so there is no sequence handling.
But it is heavy, with 200 levels per side about 4.6 times a second per busy contract.
That extrapolates to about 1,000 frames/s and roughly 0.3 s of parse per second for the full catalog.

Blockers:

- No CCXT class (4.5.68 or master): the engine's loadMarkets catalog cannot load CoinW until a loader reads /v1/perpum/instruments.
- No REST bulk mark or upcoming funding rate: the REST anchor poller cannot be filled, so the anchor must come from the index_price, mark_price and funding_rate socket channels.

Open questions:

- Funding formula, cap and floor, and any mark premium clamp: the help center articles returned 403, and ONE's mark sat 12% under its index.
- Maker fee: the API reports 0.02% on all 387 contracts, while a 2024-11-15 press release and CoinGecko's description say 0.01%.
- Do the per-contract openSpread (mostly 0.0003) and closeSpread (mostly 0.0002) fields charge a market order on top of the 0.06% taker?
  No order was placed.
- Legal entity and the official restricted-country list: the Legal Statement page returned 403, and the US exclusion comes from a secondary source.
- Is the 513-subscriptions-per-connection cap fixed?
  Depth was only tested to 100 contracts per socket.
- The HTTP status and Retry-After of a 29001 'API access frequently' refusal: no limit was reached.
- What the 17 …PROPW contracts in tickers are, and why about 70 equity contracts that CoinGecko lists are missing from the API catalog while AVGO's book and funding still answer.
- The socket funding rate equalled Binance's current rate on 164 of 165 shared contracts, and the BTC best bid equalled Binance's on 6 of 6 reads.
  Does CoinW copy Binance's rate, and are its majors books hedged against Binance?
- A subscribe with biz 'FUTURES' is refused with errorCode 1007 yet still delivers LINK frames, in both runs.
- The documented 30 to 40 s trading halt during each funding settlement was not observed.

### Coinstore

Verdict: no public API.
Coinstore lists 58 USDT-M perpetuals, but on 2026-06-12 it deleted its perpetual API documentation (commit b7bcf588), and CCXT has no Coinstore class.
The only working perpetual endpoints are the futures web app's undocumented calls, and joining the engine through them would take three code changes together.
First, a catalog loader outside CCXT.
Second, an anchor fed by the WS index stream instead of a REST round, since no REST call gives mark or index.
Third, a protobuf decoder in the feed.
The book itself is batched at 1 to 6 s per push, far staler than the 100 ms cross age the engine waits for, and US persons may not trade.

Blockers:

- No documented perpetual API: the Perpetual Swap docs were deleted from coinstore-openapi.github.io on 2026-06-12, so every perpetual endpoint is an undocumented web-app call that can change without notice.
- No CCXT class in 4.5.68 or master, so the catalog (connector.ts line 68 loadMarkets) needs a custom loader, and contractSize must be 1 because sizes are in coins, not ctVal.
- No REST source of index, mark or upcoming funding: they arrive only on the WS index stream, which does not fit AnchorPoller's REST fetchRound.
- WS frames are binary protobuf (google.protobuf.Any), and VenueFeed hands handleMessage a Buffer without the binary flag. protobufjs is not a server dependency.
- Book pushes are batched at about 1 s on BTC and ETH and 3 to 6 s on most symbols, with one symbol silent for 45 s.
- There is no WS snapshot, so every (re)subscribe needs a REST depth read after the first frame.
  A REST read taken before subscribing missed a push on 3 of 4 symbols and left a crossed ETH book.
- Persons located in the US and Japan are prohibited by the User Agreement.

Open questions:

- Current funding formula, interest rate and cap: the only formula found is a 2022 legacy article (0.01 % interest, ±0.05 % clamp, 0.75 × MMR cap), and the current settlements do not follow it.
- Mark formula: the mark sits nearer the last trade than the index on most readings, and what the per-symbol markPriceGreaterRatio/LessRatio bands (0.005 to 0.2) bound is unknown.
- What lastFundingRate holds: it differed from the last settled rate on 6 of 17 and 6 of 16 compared symbols (for example MUUSDT).
- Meaning of instrument status 3, and why QNTXUSDT has a book, ticker and fee row but no instrument row.
- The index basket per perpetual.
  The archived 2023 article's weight table did not survive, and no basket call was found.
- Liquidation, settlement and delisting charges, and any futures VIP tiers: the help center refuses this host and no post-launch archive copy was found.
- What the depth stream sends for a one-sided or empty book was not seen.
- The funding settlement instant itself was not captured, by design.

### LBank

Verdict: blocked.
The CCXT catalog fits: 845 active linear swaps, market.id equals the REST and socket symbol, and contractSize is 1, which matches coin sizes.
The REST anchor poller fits: one bulk call carries all five AnchorRow fields.
The WebSocket book feed does not fit.
LBank documents no public perpetual book channel.
The only incremental book is topic 25 of an undocumented web-app protocol, which has no per-symbol sequence and no checksum.
In two runs it left quiet contracts, and one side of DOGEUSDT, stale against the REST book, with no signal a feed could use to trigger a resync.
Polling the REST book instead would take 845 requests a second, against CCXT's assumed limit of 20 a second.

Blockers:

- No documented public perpetual WebSocket channel exists: https://www.lbank.com/docs/contract.html names only wss://lbkperpws.lbank.com/ws, and CCXT Pro's only LBank socket is spot (pro/lbank.js line 32).
- The undocumented book topic 25 has no per-contract sequence (bNo is a shared batch number) and no checksum, so the engine's gap-then-resync rule cannot work.
- Topic 25 books went stale against REST: CTK, HK50 and STORJ matched the REST touch on 0 to 2 of 12 reads (and 2 to 16 of 20), and DOGE asks stayed crossed for 65 of 67 frames in one run.
- Subscribe pacing: at most 20 subscribe frames per window of about one second, and topic 25 refused 5 to 10 % of subscribes sent at 10 a second (errorCode 51 MoreThan3TimesPerSecond).
  At a safe 2 a second, 100 contracts take 50 s.
- US persons may not trade LBank at all, per the User Service Agreement.

Open questions:

- Does the web app's newer v3 socket (wss://ccws.rerrkvifj.com/ws/V3/, op:sub protocol) carry a correct per-symbol book?
  Not probed.
- Why do topic 25 batches stop for quiet contracts?
  Server-side conflation per instrument group is suspected, not proven.
- Which venues are in each contract's index basket today?
  The 2023 help article lists Bitfinex, Binance, Huobi, OKEx, Bittrex and HitBTC, and no basket call is public, so the self-index trap cannot be checked.
- The funding settlement instant was not captured, and the public API has no funding history call.
  It is also unconfirmed whether the 0.01 % interest is per 8 h and scaled to the interval (the 4 h median is 50 ppm against 100 ppm on 8 h contracts).
- What do needSuspend=1 (9 TradFi contracts, which CCXT still marks active) and instrumentStatus=2 mean?
- The 16-contract gap between the API count (845) and CoinGecko's 861 is unexplained.
- The public REST rate limit is not published (CCXT assumes 20 requests a second, and the docs list error code 183).

### Bit2Me

Verdict: spot only.
Bit2Me lists no tradable perpetual.
Its only futures trace is a documented WebSocket for BTCUSDC_PERP that behaves like a nonexistent path, with no futures REST, no instrument list and no fee schedule.
Bit2Me's own site says it focuses on spot, Earn and Card under MiCA, and CoinGecko's derivatives list does not include it.
It also has no CCXT class in 4.5.68 or in master, so the engine has no catalog to load.
Its spot book is snapshot-only, has no sequence and is conflated to about one frame a second, and the spot taker is 6,000 ppm.

Blockers:

- No perpetual market is live: the futures WS at wss://ws.bit2me.com/v1/futures/connection/websocket is silent to the documented frames and to Centrifugo frames, like a bogus path, and has no REST or catalog.
- No CCXT class in 4.5.68 or in ccxt master.
  PR #22639 (bit2me-devs, spot only, unmerged since 2024-05-28) and issue #26464 are open.
- No index, mark or funding, so no AnchorRow can be built.
- Spot VIP 0 taker is 0.6 % (6,000 ppm) on crypto pairs, 10 to 12 times the perpetual takers in the registry.
- US residents are not accepted, and only 31 of 281 enabled markets are in the USD/USDC/USDT quote family (30 USDC plus XAUT/USD).
- The spot book has no snapshot on subscribe and no sequence, and it is conflated to about 1 s, so a feed would need REST seeding and would carry books up to a second old.

Open questions:

- When, and whether, the documented USDC perpetual product (BTCUSDC_PERP, ETHUSDC_PERP) goes live.
  The doc examples are dated 2026-06-19, and nothing names its entity, fees or funding.
- Why 9 to 13 markets (BTC/USDC, ETH/USDC, FLOCK/EUR, the EURCV markets and others) come from a second book source with a clock-like nonce, no timestamp, a fixed 138 by 35 level count and a 39 to 45 USDC spread on BTC/USDC.
- What the feeMakerPercentage and feeTakerPercentage fields in market-config mean: they are 0 on all 287 markets, against a published 0.5 %/0.6 %.
- What the socket sends when one side of a book empties.
  It was not observed in about 12,700 batch frames.
- Whether PR #22639 merges as it stands.
  Its default taker is 0.0026, the third tier, which would understate the base taker by 3,400 ppm.
- Connection lifetime beyond 100 s and the behaviour at the 50 connections per IP and 50 messages per second limits, which were not approached.

### Niza.io

Verdict: fits with a named change.
Niza.fun has no book of its own.
It is the Orderly builder `niza` on Orderly's shared order book, lists no own markets, and did 0 USDC of its own volume in the last 7 days (3,566 USDC lifetime, 28 users).
CoinGecko's Niza.fun volume is Orderly's whole book.
The Orderly book does fit the engine's shape.
The named change is to register it with createExchange `new ccxt.woofipro()`, since no Niza class exists, plus a marketFilter that keeps only /^PERP_[A-Z0-9]+_USDC$/, because woofipro sets active undefined and would otherwise pass the builder and REDUCE_ONLY markets.
The book feed is @orderbookupdate seeded by @orderbook with a strict prevTs chain, on the SDK's constant socket path.
The anchor poller reads /v1/public/futures every second and /v1/public/info for the interval.
The engine should carry at most one Orderly leg, since every Orderly builder shares this book.

Blockers:

- US persons may not trade: Orderly's terms exclude US Persons and US IP access, and that binds builders such as Niza.fun.
- Niza's charged perpetual fee is unpublished.
  The 500 ppm taker is only the niza.fun order form's hardcoded 5e-4 estimate, bounded below by Orderly's 300 ppm Public-tier base fee.
  The real default rate is readable only through the builder's private API or a per-wallet query, which was not done.

Open questions:

- What default user taker and maker rate Niza actually set on Orderly, and whether it stakes ORDER for a lower base tier.
- Whether the survey should record this venue as Orderly rather than Niza, since every Orderly builder (WOOFi Pro included) shares the same book and Niza's own flow is nil.
- Whether the public socket path constant OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY is a supported contract.
  The docs say an account id, but only this constant is served.
- What @orderbook and @orderbookupdate send for a one-sided or empty book, and for a delisted market (none was available).
- How the RWA markets (EURUSD, NAS100, SPX500, GOOGL, NVDA, TSLA, XAU, XAG, CL, BZ, USDJPY) behave at the anchor gate while the index is frozen off-market.
- Whether Niza Global (niza.io) is winding down: its web front is disabled with a 402 while app.niza.io still answers.
- The funding settlement instant was not captured.
  Settlement behaviour is taken from funding_rate_history and the docs.

### BitoPro

Verdict: spot only.
BitoPro lists no perpetual in any family: CCXT 4.5.68 loads 35 spot markets and 0 swaps, the site offers only Spot, Credit margin, Earn and Grid Bot, and CoinGecko's derivatives list does not carry it.
The connector would keep 0 markets and skip the venue, and there is no index, mark or funding for an anchor poller.

Blockers:

- No perpetual swaps: the connector keeps active swaps only (server/src/ccxt/connector.ts line 79), and BitoPro has 0.
- No index, mark or funding, so every route would be refused at open as anchor_no_mark.
- Only 15 of 35 pairs are USDT-quoted.
  The 19 TWD pairs and eth_btc are outside the USD/USDC/USDT quote family.
- US citizens may not register (Terms of Use, Chapter 1, Section 1, Article 5), so the operator cannot trade there if a US citizen.

Open questions:

- What the book stream sends for a level whose exact amount rounds to zero at amountPrecision, and for an empty side.
  Neither was observed in about 3,300 frames.
- Whether a non-Taiwan resident who is not a US, China, Hong Kong or Macau citizen can complete identity verification.
- Whether the fee page's 'maker 0 fee' event and 'Grid Bot USDT/TWD 0.02%' promotion are running now.
  The live fee table shows neither.
- Whether the socket enforces a handshake or connection cap.
  None is published, and about 35 handshakes drew no refusal.
- CCXT 4.5.68 fetchTradingFees returns undefined maker and taker, because it reads the tradingFeeRate array with safeDict (bitopro.js lines 784 and 785).
  CCXT's tier table beyond VIP 0 is stale against the live table.

### Max Maicoin

Verdict: spot only.
MAX lists no perpetual, dated future or option, only 74 spot markets and spot margin.
It has no CCXT class in 4.5.68 or master, so the connector could not even load its catalog.
Spot VIP 0 fees are 800 ppm maker and 1,600 ppm taker, and most volume is on TWD markets, outside the USD settlement family.

Blockers:

- No perpetuals: the catalog holds 74 spot markets only, and the v3 API has no futures, mark, index-for-perp or funding endpoint.
- No CCXT class in 4.5.68 or in master 4.5.82, so the connector's loadMarkets path has nothing to load.
- No anchor: no mark or funding, and the only index is an M-wallet collateral price updated once a minute.

Open questions:

- The official fee page max.maicoin.com/docs/fees and the help center refused this host with 403.
  Fees come from the public GET /api/v2/vip_levels and the campaign VIP page, which agree on all ten levels.
  Any per-quote or MAX-token-payment discount (the `fd` flag) is unverified.
- Whether US residents may open an account: the terms name the United States as a place where the service may be limited, but the help center could not be read.
- Whether the one-id skips on the first update after a snapshot, seen with 74-market subscribe frames, hide real level changes.
  A 51-level book side appeared in the same runs, which suggests they can.
- Whether subscribe frames between 4 and 74 markets avoid the first-update skip race.
  Only 4 (clean) and 74 (racy in 2 of 3 runs) were probed.

### BtcTurk | Kripto

Verdict: spot only.
BtcTurk lists no perpetual, dated future, option or margin product. exchangeinfo returns 379 spot pairs, all TRADING: 190 quoted in TRY and 189 in USDT.
CCXT btcturk declares swap false (btcturk.js line 30) and has no Pro class.
CoinGecko's derivatives list of 214 entries does not include it.
So the connector's active-swap filter would load zero markets, and there is no index, mark or funding for an anchor poller.
On the spot side, the USDT pairs could be streamed cleanly through obdiff, but its book batches to about 764 ms per pair.

Blockers:

- No perpetual market exists: 379 spot pairs only, CCXT btcturk has swap false, so connector.ts isActiveSwapMarket (lines 79 and 196 to 202) keeps zero markets and the venue is skipped.
- No index, mark or funding is published, so no AnchorRow can be filled and no anchor poller is possible.

Open questions:

- The operator's regulatory licence could not be read, because www.btcturk.com and the help center return 403 Cloudflare challenges.
- US persons are excluded only on indirect evidence: the US is absent from api/v2/help/register-countries.
  It is an inference that this list backs the web app's 'provides services to the citizens of the following countries' text.
- Fees come from the web app's public pro-bff.btcturk.com/v1/buy-sell-commissions list (USDT pairs 1000/1400 ppm, TRY pairs 1200/2400 ppm).
  The official commissions article could not be read to confirm them or to say whether a tax is added on top.
- Which pairs, if any, are zero-fee (the web app's internal noFee ticker flag) was not found, because the public ticker does not carry that flag.
- What the A field of a CP 3 delete carries was not checked, and neither was what obdiff sends for an empty book side (none was seen).
- The task gave CoinGecko trust rank 65, but the CoinGecko API returned trust_score_rank 66 on 2026-09-22 local time.

### BitTrade

Verdict: spot only.
BitTrade lists no perpetual, dated future or option.
CCXT 4.5.68 marks all 95 markets as spot, and the connector's active-swap filter (connector.ts lines 196 to 202) keeps none of them.
Its only leveraged product is a BTC/JPY CFD at up to 2x, which the API explicitly does not serve.
The spot market is 45 online pairs, all quoted in JPY. 17 of them are on the order-book fee table at maker 0 % and taker 0.10 %.

Blockers:

- No perpetual on any family.
  CCXT has swap false and 0 swap markets, so the connector would skip the venue with 'no usable swap markets'.
- No index, mark or funding endpoint exists, so an anchor poller has nothing to read.
- Every online pair is quoted in JPY, which is outside the USD/USDC/USDT settlement family, so even a spot leg would cluster with no other venue.
- Every WS frame is gzip-compressed inside a binary frame.
  A feed would need zlib.gunzipSync in handleMessage, measured at 51 to 61 µs per frame, about 3 times the JSON.parse cost.
- The recommended mbp.150 book has no snapshot on subscribe, and the req snapshot is rate limited: a burst of 45 got 21 refusals with 429.
- Accounts are for residents of Japan only, and US taxpayers are refused.

Open questions:

- What the 28 pairs are that are online but have api-trading disabled (such as soljpy, dogejpy, bnbjpy).
  They are outside the exchange fee table, yet they publish books and small periodic trades.
- Whether leverage trading (the BTC/JPY CFD) still accepts new users.
  The site bundle holds the line 'レバレッジ取引は現在、新規でのサービスはご利用いただけません。', and when that line is shown was not verified.
- The exact limit on WS req snapshots: a burst of 45 got 21 refusals with 429, and pacing at 10 a second passed.
- Why the req for daijpy (online) got no reply in 58 s.
- The cause of the one mbp.150 sequence gap in 3,964 deltas in the first paced batch run.
  The next run showed 0 gaps in 4,019.
- What mbp.150 sends for an empty book side.
  No one-sided book was seen.
- The units of the volume and holding thresholds in the fee discount rank table (/-/x/hbg/v1/fee/fee-rate).
  The taker multiplier is 1 at every level.
- The help center (bittrade.zendesk.com) returned 403 with a Cloudflare challenge, so none of its articles were read.

### Digital X

Verdict: spot only.
Digital X (Korbit rebranded) lists no perpetuals, only 227 KRW spot pairs.
It has no CCXT class and publishes no index, mark or funding.
Its spot book feed is clean (full 30-level frames, snapshot on subscribe, server pings), but it cannot be a perpetual leg, and a KRW quote falls outside the engine's USD/USDC/USDT quote family.

Blockers:

- No perpetual swaps (spot KRW only), so it cannot join as a perpetual leg.
- No CCXT class in 4.5.68 or current master, so the connector's loadMarkets catalog cannot be used.
- Every pair quotes KRW, which quoteFamily.ts (lines 3 to 6) does not map to USDT, so no market would cluster with a USDT perpetual.
- No index, mark or funding, so there is nothing for an anchor poller to read.
- Trading is limited to verified Korean residents.
  Foreigners and non-residents (including US persons) are restricted from new KYC.

Open questions:

- What fees apply after the one-year free promotion (2026-08-24 to 2027-08-24): the notice says previous rates return and details come later.
  The free plan was maker 0 / taker 0.2 % (2,000 ppm).
  Other plans were not shown on the rendered fee page.
- The notices contradict each other on the VIP maker incentive: the 2026-08-23 promotion notice says none is paid during the free period, but the 2026-09-15 notice (updated 2026-09-21) starts it on 2026-09-17.
- What a one-sided book sends on the socket was not observed.
- Whether a second subscribe to the same symbol doubles the frames was not measured.
- Whether the server drops a client that ignores protocol pings was not tested (the ws library always answers).
- The WS grouped book names its quote amount `quoteVolume` while the docs and REST say `amt`.
  This only matters if grouping is ever used.

### HashKey Global

Verdict: fits as is.
CCXT 4.5.68 `hashkey` loads both swaps as active and linear.
Each market id (BTCUSDT-PERPETUAL) is spelled exactly as the socket and the mark and funding replies spell it. contractSize is 0.001, which matches the socket and REST size unit (integer contracts of 0.001 base).
The v2 depth topic is a whole-book snapshot about every 100 ms, which maps to resetBook on every frame with no sequence logic.
An anchor poller can fan out 1 index + 1 mark per contract + 1 funding call per round, the same way the OKX poller does, with an 8 h interval constant.
The registry takerPpm is 600, and CCXT's constant is also 600.
The value is small: only BTC and ETH are listed, 24 h volume is about 1.4M USDT per contract, the mark sits at a standing discount to the index, and US persons may not trade.

Open questions:

- Whether the depth topics cut a deeper book at the documented 200 levels.
  Both perp books held under 100 levels, so this could not be tested.
- The funding cap in numbers for BTCUSDT and ETHUSDT.
  It is 0.75 × MMR, but which tier's MMR applies is not published.
  The wire says 0.0049, which gives ±0.3675 %.
  The Aug 2026 tier notice says 0.5 %, which gives ±0.375 %.
- What fundingRate returns across a settlement instant.
  It was not captured.
- The funding endpoint is documented with an X-HK-APIKEY header but answered without one, so it could be gated later.
  The same holds for coinInfo, which CCXT lists as private.
- The WS topics `markPrice` (v1 and v2) and `index` (v1 only, on the index name) are undocumented.
- The meaning of the suffix of the depth version field `v` (_18 on v1, _1 or _2 on v2).
- The per-IP limit for public REST calls is not published.
  The only published limit is 2 requests per second per API key for query calls. 186 requests in 59 s passed twice.
- Whether the BTC mark's standing discount to the index (-440 to -924 ppm in both polls) persists.
  It would make every HashKey leg a basis route at the fresh gate.
- The index weights were equal in every frame, which contradicts the help centre wording 'based on their trading volumes'.

### Bitazza

Verdict: spot only.
The only public API is an AlphaPoint spot gateway.
Bitazza's in-app USDT futures and CFD derivatives have no public API, catalog, index, mark or funding.
No CCXT class exists in 4.5.68 or on master, and PR #15091, a 2022 ndax subclass, is still unmerged.
So Bitazza cannot join as a perpetual leg.
For spot, its book stream works unauthenticated but needs a large Depth and has no gap rule.

Blockers:

- No public perpetual: the app futures and CFD derivatives have no API, catalog or fee schedule.
- No CCXT class in 4.5.68 or on master at 1d8b674.
  PR ccxt/ccxt#15091 (an ndax subclass, flat 0.25%) has been open since 2022-09-23.
- No index, mark or funding anywhere, so no AnchorRow can be built.
- Spot book stream: a small Depth leaves phantom levels on ladder books, MDUpdateId skips values and the socket i counter is not monotonic, so no gap detection exists beyond re-reading GetL2Snapshot.

Open questions:

- Is Bitazza Futures still live in 2026?
  What are its contract list, fees, funding formula, interval, cap and settlement instant?
  These are only visible in the app, which was not installed.
- Which Bitazza entity may a US person or a non-Thai resident use?
  No official page names excluded countries beyond sanctions lists.
- Which books may a Global account trade, compared with a Thailand account, given that both share one engine and fee schedules differ (Global 0.15%/0.25%, Thailand 0.25% flat)?
- What are the ten Q-prefixed duplicate THB instruments (QBTCTHB and others)?
- Does the gateway batch changes into a floor of about 100 ms, and what does a delta do when a book side empties?
- What do the PriceCollarIndexDifference and PriceCollarPercent fields mean on this spot engine, and does an internal index exist?

### Bitfinex

Verdict: fits with a named change.
The CCXT catalog, the book feed and the bulk anchor call all exist and worked from this host.
CCXT market.id equals the socket symbol and the status key on 93 of 93, and contractSize 1 matches base-unit book amounts.
The named change is the anchor.
Bitfinex publishes no index separate from the mark, and the mark is the BFX Composite Index with no premium in it.
So index = mark = MARK_PRICE, and a Bitfinex leg always reads a mark premium of 0 (the capped-mark shape, taken to the limit).
The poller must also bust a 5 s Cloudflare edge cache, and the origin only writes every 3 s.
Smaller changes: the feed sends conf flags for checksum and SEQ_ALL, a marketFilter drops the 14 TESTUSDT paper contracts, and registry takerPpm is 0 with ccxtTakerPpm 2000.

Open questions:

- Should the engine accept a Bitfinex mark with no premium (a standing Bitfinex basis would read as fresh edge), or build one as MARK_PRICE x (1 + NEXT_FUNDING_ACCRUED), the running 8 h average basis?
- BFXCI constituents are not published and no basket call exists.
  SPOT_PRICE equals MARK_PRICE exactly on 36 to 48 of 91 rows, so whether some marks are single-source cannot be told from outside.
- CCXT maps the perps ALGF0, ATOF0 and IOTF0 to bases ALG, ATO and IOT (commonCurrencies is applied before F0 is stripped, bitfinex.js lines 517, 519, 530, 654, 656).
  They will not cluster with ALGO, ATOM or IOTA, and could cluster with a different token that uses those tickers.
  They need a rename or a denial.
- SEQ_ALL is marked beta.
  Should the feed rely on it for gap detection, or only on the documented checksum, which arrives about every 2.5 s?
- The subscription cap per connection is documented as 25 (limitations page) and 30 (ws-general), and the wire enforced 36.
  The recommendation is 25.
- Books are thin: the BTC touch held 0.035 and 0.0005 BTC, and 24 or more of the first 36 contracts have fewer than 25 levels on a side.
  Capturable size is likely small.
- The documented trading pause of several seconds at each funding time, and the settlement instant itself, were not captured.
- The wire shape of a one-sided or empty book was not observed.

### GroveX

Verdict: spot only.
GroveX lists no perpetual: /futures reads 'Futures trading is coming soon', the About page says it offers no futures or margin, and futuresopenapi.grovex.io has no DNS (its only certificates expired 2025-08-27).
It has no CCXT class in 4.5.68 or in master.
So it cannot be a perpetual leg.
Its spot book reaches the socket only as gzip whole-book snapshots, and its REST book for Binance pairs is a 7-minute-old copy of Binance.

Blockers:

- No perpetuals: futures page says coming soon, About page says no futures or margin, futures API host has no DNS and only expired 2025 certificates.
- No CCXT class in 4.5.68 (104 ids) or in CCXT master ts/src at 1d8b674, so the engine's catalog path has nothing to load.
- WebSocket frames are gzip inside binary frames and the book is whole snapshots only (no deltas, no sequence), which would need a gunzip step in handleMessage.
- REST market_dept and newOrderBook for Binance-listed pairs serve a Binance book copy refreshed every 420 s, not GroveX's own book, and the bulk ticker takes 5.6 to 9.5 s.
- Terms section 9.3 prohibit exploiting latency differences and stale quotes, and US persons may not trade.

Open questions:

- Fee actually charged: GroveX's own fee page and quoteFeeRate say 0.80% maker and taker on 423 of 433 markets (0.10% on 9, 1.00% on AUDUSDT).
  CoinGecko's description and a third-party review say 0.1%.
  Every market carries openQuoteFee 0, whose meaning is unpublished.
  Settling it needs an account.
- AUSTRAC digital currency exchange registration is claimed by a third-party review and was not checked on the AUSTRAC register.
- All 7 btcusdt trades in the second book run, plus the one captured in the first, printed strictly inside GroveX's own spread, and 6 of the 7 at Binance's touch price.
  This suggests the prints do not come from the displayed book, which matters for any volume-based trust reading.
  It is an inference from 8 trades.
- The API doc's Java demo answers server 'ping' frames, but no server ping of any kind arrived on any socket.
  Sending {"ping":ms} closed the socket, and a client protocol ping got a pong.
- Whether GroveX Futures will launch, and on which host.
  The fee page says the futures schedule will appear when available.

### Upbit

Verdict: spot only.
Upbit Korea lists only spot: 855 pairs (289 KRW, 328 BTC, 238 USDT) and no perpetual, dated future, option or margin.
CCXT has swap false, and the connector's active-swap filter (connector.ts lines 79 and 196 to 201) keeps none of the 855.
There are no tiers.
The spot fee is 0.05% maker and taker (500 ppm) on KRW, and 0.25% (2,500 ppm) on the BTC and USDT markets, cut to 0.05% by an event that runs until 2026-11-20 23:59:59 KST.
The USDT market is the only one in the engine's quote family, and it turned over about 1.07 M USDT in 24 h, against about 1,745 M USDT-equivalent on the KRW market.
With no index, mark or funding, there is nothing to poll as an anchor.

Blockers:

- No perpetual product: the connector keeps only active swap markets and Upbit has none.
- No index, mark or funding rate, so no anchor poller is possible.
- Trading requires Korean residency (Korean-carrier phone, Korean bank account, Korean ID or alien registration card).
  A US person abroad cannot open an account.
- The only USD-family market (USDT) is thin: about 1.07 M USDT turnover in 24 h, roughly 0.06% of the KRW market.

Open questions:

- The {"status":"UP"} 10 s cycle was only seen on an unsubscribed socket.
  Whether it runs on a subscribed socket, and whether client protocol pings reset the idle timer, is not verified.
- The docs give a 120 s idle timeout, but the wire closed idle sockets at 60.5 to 60.7 s in every run.
- No 429 was provoked, so whether a 429 carries Retry-After is not verified.
- The notice wraps the BTC/USDT fee event's end date in ~~ markup.
  The profile reads that as emphasis, with the end at 2026-11-20 23:59:59 KST (the compliance approval runs 26.08.28 to 26.11.20).
- What the socket sends for a delisted pair is not verified, because none was available to probe.
- Why USDT-BTC book frames are not on the 100 ms grid is unknown.
  The BTC and USDT markets are cross-traded with Upbit Indonesia and Thailand, which may explain it.
- The threshold behind the GLOBAL_PRICE_DIFFERENCES caution flag is not published.
- Ubcindex.com, the site of Upbit's UBCI index family, did not resolve from this host.

### Byte Exchange

Verdict: spot only.
Byte Exchange lists no perpetual that trades with real funds.
Its perp product is a demo, and the planned real one is a house-counterparty book filled at the venue's own mark, with no order book to cross.
There is also no CCXT 4.5.68 class, so the catalog cannot load it.
The spot socket would need three engine changes: an Origin header in VenueFeed.openConnection, raw-inflate decoding, and a 30-per-connection plan that first unsubscribes the ten default books.

Blockers:

- No real-money perpetual: only 124 demo paper perps.
  The real 'Byte book' perp shows clearing rail 'pending' and opens region by region.
- Even when open, the real perp is house-quoted, with fills at Byte's validated mark and Byte as counterparty on every fill, so there is no book an arbitrage leg can cross.
- No CCXT 4.5.68 class and none in master.
  PR #28769 is unmerged and spot only.
- The WS handshake requires the header Origin: https://bexc.io, which VenueFeed.ts line 81 cannot send today.
- Book frames are raw-deflate compressed inside binary frames, at about 150 µs per frame to inflate and parse, roughly 12 to 14 times Gate's cost.
- US persons are excluded by the ToS.

Open questions:

- The spot VIP 0 taker is unresolved. /api/v1/fees, /wallet/volume-discount-tiers and the legal fee page all say 0.10% (1000 ppm). /api/v1/markets says taker_fee 0.002 (2000 ppm) on 804 of 851 markets and 0.001 on 47.
  The takerPpm of 2000 reported here is the conservative per-market figure.
  Settling it needs an account.
- The legal fee page (2026-04-12) shows a 5-tier ladder recalculated daily.
  The live /fees shows 8 tiers snapshotted monthly.
- The Byte book is not publicly aggregated per price: ALLO_USDT showed two levels at one price on REST and WS despite the 'L2 aggregated' docs.
- Update_id is not always a unique label: ALLO_USDT id 1712 carried two different books three minutes apart.
  SUI_ETH reads id 0 with a 28-level book.
- The public bundle ships admin pages for an in-house market-making engine and a 'Chaos Engine' that can inject target-price milestones.
  Which markets it quotes is not public. order_count is 1 on nearly every level.
- A plain REST book read can be tens of seconds stale because the origin cache serves stale-while-revalidate.
  Only a query nonce read is current.
- The REST rate limit is not published.
  The only figure is a CCXT PR comment of 30 req/s per IP.
  The per-IP WS connection cap was not tested beyond 4 concurrent sockets.
- The entities were not checked against the Estonian or Turkish registries, because the web search budget was exhausted.

### Phemex

Verdict: fits with a named change.
Every piece exists.
CCXT lists 116 active USDT-M markets whose ids match the socket and ticker spelling, sizes are in base coin, and contractSize is 1.
There is a 30-level book channel with a snapshot, and two bulk REST calls cover all five AnchorRow fields.
The named change is the book feed.
It cannot use a sequence gap rule, because sequence is shared across symbols, so it must resync on the server's 60 s snapshot and trim each side to 30.
It needs at least two sockets, because 101 subscriptions per socket are accepted and the 102nd is refused.
Two smaller registry changes: set takerPpm 600, because CCXT reports no taker on USDⓈ-M markets and the connector would otherwise skip all of them, and add a USDT-linear marketFilter.
The poller merges two calls, and the mark is the contract's own last price inside a band.

Open questions:

- A lost delta cannot be detected and stays wrong until the next 60 s snapshot.
  Is a feed with no gap rule acceptable, or should it re-subscribe more often?
- The documented caps (20 subscriptions per socket, 5 sockets per client) are not what the wire enforces (101 per socket, 6 sockets accepted).
  Which caps will Phemex enforce later?
- The mark equals the contract's own last trade inside a band (median of index×(1+F×τ), index + 15-minute basis, and last).
  How should the fresh gate read a Phemex leg whose fresh premium is small by construction?
- CloudFront cached 30 of 60 one-second ticker polls in the rerun, and 1 of 60 in the first run.
  What is the cache TTL, and does a unique query string bypass it?
  Not tested.
- Eleven TradFi index baskets are a single Binance or Gate futures perp.
  SPYXUSDT, NGUSDT and MUXUSDT reference differently spelled tickers (SPYUSDT, NATGASUSDT, MUUSDT).
  Do these need DENIED_PAIRS lines?
- The settlement instant was not captured, so it is not verified that the last published estimate equals the settled rate.
- No liquidation, settlement or delisting fee was found in the sources read.

### P2B

Verdict: spot only.
P2B lists no perpetual in any family.
The connector keeps only active swaps (connector.ts lines 79 and 196 to 202), and CCXT p2b maps all 173 markets as spot with swap false (p2b.js lines 30 and 392 to 397), so the engine would load 0 markets.
There is also no index, mark or funding for an anchor.

Blockers:

- No perpetual market exists, so the swap-only CCXT catalog yields 0 markets and there is no anchor (index, mark, funding) to poll.
- Even for a spot stage, the depth channel carries one market per socket (173 sockets for the catalog).
  Its partial frames come on a 1 s tick with no sequence, so a lost frame is only repaired by the ~60 s full book.
- CCXT market.taker is the whole tier array in percent units ([[0, 0.2], ...]), which the connector's toPpm reads as null.
  A registry takerPpm of 2000 would be required and ccxtTakerPpm cannot be set.

Open questions:

- The per-token extra fee unit is unstated: UTOPIA 0.05, PIT 0.04, TREAT 0.02, so 0.05 could mean 5 % or 0.05 %.
  Only UTOPIA_USDT is listed.
- Price, state, deals and kline channels acked but sent no frame in 20 s over 2 to 3 runs, while REST showed 100 BTC_USDT trades in 3 s.
  Are these channels broken or host-specific?
- Sockets close 60 s after the last server frame, not the documented 100 s of inactivity.
  This looks like a proxy idle timeout and is not confirmed by the venue.
- A book kept from partial frames drifted from the next full book (98 of 100 bids, 95 of 100 asks in pass 2).
  It is unknown whether partials miss changes or the full book is cut at a different instant.
- What the depth channel sends for an empty book side was not observed.
- What signup does with a US address was not verified.
  No account was opened.
- A third-party review (tradingfinder.com) claims P2B offers futures.
  No official source supports it.

### WEEX

Verdict: fits with a named change.
The CCXT catalog works: market.id matches the socket and the anchor on 995 of 995, all markets are linear, and the taker is 800 ppm.
Four named changes are needed to join.
(1) The registry must pin contractSize: 1, an existing option in ccxt/types.ts line 22, because CCXT sets contractSize to contractVal while book and order sizes are base coins.
Without it BTC sizes would read 10,000 times too small.
(2) The WEEX feed must chain deltas on U === last u instead of last+1.
(3) VenueFeed.openConnection should accept a User-Agent header, since the docs say requests without one are blocked.
(4) The anchor poller needs two calls per round every 2 s: ticker/24hr for index and mark, and premiumIndex only for the funding columns, because premiumIndex prices are a minute old.
TradFi contracts (and JP225USDT, which is filed as crypto) should be skipped, because their index freezes while the mark follows the last trade.
The book is conflated to 500 ms, so crosses are seen at most twice a second.

Blockers:

- Needs a registry pin contractSize: 1 (existing option).
  CCXT's contractSize (contractVal, weex.js line 1060) misdescribes WS and REST sizes, which are base coins.
- Needs an anchor poller reading ticker/24hr (weight 40) for index and mark. premiumIndex mark and index are minute-old snapshots stamped with a live time field.
- Needs a feed sequence rule U === last u (not last+1).
  A Gate/Binance-style rule would resync on every frame.
- Needs VenueFeed to send a User-Agent header.
  Documented as required (403 without it), but the wire accepted none on 2026-09-23.
- US persons are excluded by the Terms of Use.
  This does not block public data.

Open questions:

- Why CoinGecko counts 1,048 WEEX perps when exchangeInfo lists 995.
  The 51 demo SUSDT contracts may explain part of the gap.
- Should the engine restrict WEEX to the 239 API-tradable contracts? apiTradingSymbols is not in CCXT, so a marketFilter would need a static list or a boot fetch.
- The 500 ms depth conflation is the only public book cadence found.
  V2 sunsets Sep 30, and no faster channel is documented.
- Will the documented User-Agent requirement be enforced later?
  The engine currently sends no headers.
- The mark formula, the index basket and the per-contract funding floors and ceilings are not published.
  The funding settlement instant was not captured.
- Is TONUSDT (displayed as GRAMUSDT) the same token other venues call TON?
  Could TradFi tickers (AAPL, META, KO, JD and others) collide with crypto bases on other venues and need DENIED_PAIRS lines?
- 133 crypto contracts carry a catalog makerFeeRate above the published 0.020% (up to 0.08%), and USDCUSDT carries a 0.16% taker.
  Any extra WXT discount is unverified.

### GMO Coin Japan

Verdict: blocked.
The leverage product is perpetual-like but cannot join the engine in its current shape.
No CCXT class exists in 4.5.68 or master, and the open PR types these symbols as spot.
The 12 symbols settle in JPY, which the USD/USDC/USDT quote family cannot cluster with any other venue.
There is no index, mark or funding, so every route would be refused at open.
Only residents of Japan may open an account.
The book is a 30-level snapshot on a grid of about 505 ms.

Blockers:

- No CCXT class in 4.5.68 or master.
  PR #27965 (open) models all 29 symbols as spot and collides BTC with BTC_JPY, so the swap filter at server/src/ccxt/connector.ts lines 196 to 203 would keep none.
- JPY settlement: quoteFamily.ts lines 3 to 6 joins only USD and USDC to USDT, so BTC_JPY would sit alone in a BTC|JPY cluster.
  Joining it would need a live USD_JPY leg and would add FX risk.
- No index, mark or funding rate is published.
  The reader refuses such legs as anchor_missing (anchorReading.ts line 26) or anchor_no_mark (lines 37 and 38).
- Accounts are limited to residents of Japan (individuals aged 20 or over, or Japanese-registered companies with representatives resident in Japan).
- Book freshness: the WebSocket pushes 30-level snapshots on a grid of about 505 ms.
  The REST origin regenerates replies on the same grid, and CloudFront caches them about 1 s despite no-cache headers.

Open questions:

- The weekly maintenance schedule could not be verified.
  The support article returned 403 with a Cloudflare challenge.
  A search summary says Saturday 09:00 to 11:00 JST.
- The WebSocket refusal when subscribes exceed 1 per second per IP was not tried, so its frame shape is unknown.
- What 現在値 (the current price used to judge loss cut) means is undefined in the docs.
  No mark exists to judge it against.
- What the undocumented orderbooks field grouping:"1" means.
- The leverage fee settlement instant was not captured.
  It is taken from the fee page and from the private exchangeFee/history doc example, which books it at 21:01 UTC.
- Only 2 of 5 perpetual tickers appear in CoinGecko's GMO futures record, and CoinGecko's count of 5 differs from the API's 12 leverage symbols.

### Coins.ph

Verdict: spot only.
Coins.ph lists no perpetual, dated future, option or margin product, so the engine has nothing to take.
CCXT loads 184 spot markets (71 trading) and 0 swaps, reports market.taker undefined, and Coins.ph publishes no mark, index or funding for an anchor.
The spot socket works cleanly for a possible future spot leg: the depth20 snapshot stream, all trading symbols on one socket.
Spot VIP 0 fees are maker 1,000 ppm and taker 1,500 ppm, in effect since 2025-08-08.

Blockers:

- No perpetual product on Coins.ph: the API docs have no futures section, the web futures catalog for the PH broker is empty, and CCXT has swap false.
- No mark, index or funding is published, so no anchor poller is possible.
- CCXT market.taker is undefined on every coinsph market (coinsph.js line 841), so connector.ts would drop the market at lines 162 to 166 even if a spot filter existed.
- The quote side is mostly PHP (42 of 71 trading pairs), with 22 USDT and 7 USDC pairs.

Open questions:

- Whether non-Philippine residents, and US persons in particular, can complete Coins.ph onboarding.
  The user agreement names only sanctioned jurisdictions, and no account was opened.
- The terms of the monthly maker rebate the fee page mentions, and the rate of the referral fee discount (CCXT says 0.2), are not published.
- The documented 5 minute silence limit was not tested.
  Sockets were held 100 s, and the survey caps a socket at 120 s.
- What a depth20 frame sends for an empty side was not seen.
- Why the REST snapshot's lastUpdateId sometimes sits below the first diff U on USDTPHP (2 of 3 runs).
  The rebuilt book was still correct each time.
- The bulk ticker replies repeat 24 USDT and USDC symbols, and one set of copies disagreed (SHIBUSDT).
  Possibly shared with the Coins.xyz broker, which was not verified.

### Zoomex

Verdict: fits with a named change.
Every part exists and was probed, but three changes are needed.
First, CCXT has no Zoomex class, and a ccxt.bybit subclass loads 701 active swaps with id equal to the socket and anchor symbol.
The subclass sets host openapi.zoomex.com, rewrites paths in sign() from v5/ to cloud/trade/v3/, and sets fetchMarkets types to linear and inverse.
Second, the book feed is bybit.ts with the URLs made parameters and a 5 s ping.
Third, the anchor is the Bybit poller mapping, except that the 4 own markets need per-symbol ticker calls.
The decisive finding: 693 of 697 perps are Bybit's own order book, trades, index, mark and funding, relayed.
Beside Bybit they would add only duplicate routes at a higher taker (600 against 550 ppm) and a Zoomex and Bybit pair that can never cross.
The recommendation is therefore to keep Zoomex out while Bybit is a venue.
If it is added, the marketFilter should keep only BTCUSDT, ETHUSDT, SOLUSDT and GMTUSDT, the four books Zoomex runs itself.
Their mids sat a median of 0 to 229 ppm from Bybit's, well under the 1,150 ppm the two takers cost together.
Registry: takerPpm 600, and ccxtTakerPpm 600, the bybit.js:2219 fallback reached through the subclass.

Blockers:

- 693 of 697 USDT perps are Bybit's own book relayed: 687 or 688 frame for frame on u and seq, the rest all but 1 to 7 frames.
  CHRUSDT and ZILUSDT matched on ts, cts and levels too.
  Trade execution ids are identical (60 of 60), and index, mark and funding are identical.
  As a venue beside Bybit these markets are duplicate routes that can never cross Bybit, so only BTCUSDT, ETHUSDT, SOLUSDT and GMTUSDT are worth a marketFilter.
- No CCXT class in 4.5.68 or on master at commit 1d8b674, and issue #26609 'zoomex support' is open since 2025-08-08.
  The catalog needs a ccxt.bybit subclass with urls.api pointed at https://openapi.zoomex.com, sign() rewriting v5/ to cloud/trade/v3/, and fetchMarkets types linear and inverse, because category=option answers HTTP 400.
  Through it, market.maker falls back to 0.0001, which is wrong because Zoomex charges 0.0002.
  The 73 Innovation Zone contracts charge a 1,100 ppm taker.
- The bulk tickers row carries Bybit's mark, fundingRate, fundingCap and OI even for the 4 own markets, so the poller must call tickers?category=linear&symbol=<symbol> for each own market.
  The inverse bulk tickers call returns an empty list.
- The server closes a WebSocket after about 10 s without a server-sent frame, even on a subscribed quiet book.
  BybitFeed's 20 s ping is too slow, and a 5 s ping (application or protocol) kept every socket open.

Open questions:

- Does a Zoomex taker order on a relayed perp fill against Bybit's book at Bybit's prices?
  Testing that needs an order and was not done.
- Why did 5 or 6 relayed perps per run (a different set each time) have 1 to 7 frames with no Bybit twin?
- The funding settlement instant was not captured, and whether the settled rate equals the last published estimate was not checked.
- For the 4 own markets: they use Bybit's index but their own mark and funding.
  Their own-book cadence varied between runs (BTCUSDT median frame gap 1,000 ms in one run and 22 ms in another, p90 near 1 s), so a longer look is needed before relying on them.
- The VIP discount reads as a monthly rebate paid to the Rewards Hub rather than a lower rate at the fill.
  That reading is an inference from the VIP page wording.
- No index basket endpoint exists on Zoomex, and using Bybit's index-price-components as the basket source is an inference from equal index values.
- The place of incorporation of zoomex Technology Limited is not stated in the documents read, and CoinGecko says Seychelles.

### CoinTR

Verdict: spot only.
CoinTR has no perpetual, no index, mark or funding, and no CCXT class.
Its futures section is copied Bitget V2 documentation that the server does not serve (40404 on REST, 30001 on WS).
The engine's catalog is active swaps only (connector.ts line 79), so CoinTR contributes nothing.
The spot book channel itself is clean: snapshot plus checksummed updates, and all USDT pairs on one socket.

Blockers:

- No perpetual: every documented /api/v2/mix futures call answers HTTP 400 code 40404, and WS instType USDT-FUTURES answers 30001.
- No index, mark or funding, so there is nothing for an anchor poller.
- No CCXT 4.5.68 class and none in CCXT master (ts/src at commit 1d8b674, 2026-09-22).
  CCXT's bitget class pointed at api.cointr.com fails because fetchDefaultMarkets calls /api/v2/margin/currencies (bitget.js line 2022), which CoinTR does not serve.
  With that call stubbed it loads 263 spot markets.
- Account opening needs a Turkish ID card and e-Devlet residence, so the venue is not tradable from the US.

Open questions:

- Trade prints fall inside the visible spread: 76/77, 69/69 and 63/63 BTCUSDT prints and 54/67, 61/69 and 66/73 ETHUSDT prints over three 60 s runs.
  The source of that liquidity (internal, OTC or Easy Buy/Sell) is not published.
- The catalog's takerFeeRate/makerFeeRate is 0.001 on all 263 pairs, while the 2026-08-05 schedule says USDT 0.10%/0.12% and TRY 0.12%/0.20%.
  The account-level fee could not be checked because /api/v2/spot/market/vip-fee-rate returns HTTP 500 code 40725.
- The CoinTR Pro termination article (coin1.zendesk.com) returned 403 to curl and to web fetch, so the date its derivatives ended is unconfirmed.
- Rate-limit refusal status and Retry-After were not tested.
  Docs: 20/s per endpoint and 6000/IP/min.
- What a books snapshot holds for an empty side was not recorded.

### Bithumb

Verdict: spot only.
Bithumb lists no perpetual, dated future or option, so the connector (active swaps only) would load zero markets and there is nothing for an anchor poller to read.
Its spot markets quote in KRW, which maps to itself in quoteFamily.ts, so a KRW book could never cluster with a USDT perp without an FX leg.
The only FX leg is the KRW-USDT book, whose tick is about 745 ppm.
The fee is 0.25% (2,500 ppm) maker and taker on KRW markets with no action.
It falls to 0.04% (400 ppm) after a free app application that lasts 30 days.
BTC markets charge 0.

Blockers:

- No perpetual of any family: CCXT swap false, the API index has no derivative endpoint, and Bithumb is absent from CoinGecko's derivatives list.
- Every liquid market quotes in KRW, outside the USD/USDC/USDT settlement family.
  The only conversion is the KRW-USDT book with a 1 KRW tick of about 745 ppm.
- No index, mark or funding, so no AnchorRow column can be filled.
- The CCXT market.id is the base alone ('BTC'), shared by 13 KRW/BTC pairs, while the socket and /v1 spell 'KRW-BTC'.
- The socket book caps at 15 levels, below the engine's 20.
- Only Korean nationals may trade.
  Foreigners are excluded, so US persons cannot.

Open questions:

- The operating legal entity name was not confirmed from an official page: the terms page timed out and the help articles do not name it.
- The membership grade thresholds are published only as an image, and the maker reward rate is not in the articles read.
- The status code and Retry-After of a REST rate-limit refusal were not observed, because no limit was hit (the headers show burst 150, replenish 150).
- The documented idle timeout is 120 s, but the wire closed idle and quiet-subscribed sockets at 60 s with 1006.
  It is unknown whether the documentation or the server will change.
- Zero printed sizes at live prices are inferred to be dust below 0.0001 of the base, since only the rounded size is visible.
- The behaviour of a closed or delisted market on the socket was not probed, since all 493 listed markets were trading.
- From 2026-10-13 the ticker call will cap markets at 200 (announced).
  Today the URL length limit alone rejects all 493 in one call.

### HTX

Verdict: fits with a named change.
Several parts fit the engine as they are: the CCXT catalog (market.id equals the socket and anchor code, contractSize equals the book unit), the size_20 incremental depth channel (snapshot plus a strict per-stream version chain with 0 gaps), and the bulk index and funding calls.
Three changes are needed first.
The feed must gunzip every binary frame and answer the server's {ping} inside handleMessage.
The anchor poller needs a per-contract mark source, because HTX publishes no bulk mark.
A marketFilter must keep only linear crypto swaps, dropping the 5 coin-M contracts (USD face value) and the 223 TradFi contracts.
The registry also needs takerPpm 600, since CCXT reports 500.

Blockers:

- No bulk mark price call: the mark exists only per contract (REST mark kline, or a ws_index mark_price.1min subscription), so the anchor poller needs about 130 to 353 calls per round or a WebSocket mark source.
- Every WebSocket frame is gzip inside a binary frame, and no engine feed decodes compressed frames today.
  VenueFeed passes the raw Buffer at line 209, so a subclass can call gunzipSync (18 to 41 µs median per frame here).
- 223 of the 353 active USDT-M perps are TradFi (stocks, indices, metals), and some tickers are spelled like crypto tokens (BNC, BOT, META, PENG, PURR), so a marketFilter on info.tradfi_labels or DENIED_PAIRS lines are needed.
  PAXG and XAUT are labelled Metals.
- The coin-M perps BTC, ETH, DOGE, XRP and TRX duplicate the USDT-M pairs, and CCXT reports their contractSize as USD face value (100 or 10) with linear false, so a marketFilter must keep only linear markets.

Open questions:

- The current official futures fee schedule could not be read: htx.com/fee is client-rendered, and a 25 s headless render left linearLevel empty.
  The 600 ppm Prime 0 taker rests on an HTX help article example labelled 'for illustration only' plus a third-party table (BitDegree, 2026-05-14), which agree.
- The mark price formula and clamp are not published anywhere reachable.
  The wire shows the mark following the perp's own bbo mid (BTC mark minus mid -345 to +32 ppm while mark minus index was -694 to -348 ppm), so a fresh reading built from the HTX mark may measure the perp's own book.
  Should the engine treat it as self-referential?
- The index basket and weights have no public call, so a self-index basket cannot be screened.
  NVDA's index kept moving at 03:39 UTC while US markets were closed, and its source is unknown.
- What happens across a settlement was not captured (whether the published rate resets after settlement).
- What a rate-limit hit returns was not provoked.
  The docs name code 1032 in the body and HTTP 429 in the WS error table.
- /v5/market/funding_rate was found by probing, and its contract (batch cap between 10 and 19 codes) is not in any documentation reachable here.
- Documentation and wire disagree: depth.step6 returns 30 levels (documented 20), the BTC funding cap is 0.3% on the wire against 0.375% in the article, and swap_contract_info is documented as market data but carries the 240 per 3 s non-market rate-limit headers.
- The HTX token 25% futures fee discount is stated only by a third party.
- Is the gzip decode cost (about 10 ms of loop time per second per 150 streams at the observed rate) acceptable at 353 markets, given the Node event-loop saturation findings?

### BloFin

Verdict: blocked.
BloFin geoblocks this host, and the United States is a Restricted Location in its Terms.
CCXT loadMarkets, the WebSocket upgrade and both anchor calls all return a Cloudflare 403 restricted-region page, so the engine running here can load no catalog, open no feed and poll no anchor.
On paper the venue would fit with named changes: a marketFilter of settle === 'USDT' (CCXT labels the 14 inverse contracts as linear, settle USD, contractSize 1), a books feed checked by prevSeqId, and a two-call anchor with the interval taken from funding history.
None of that could be verified.

Blockers:

- Every BloFin host (openapi, demo-trading-openapi, docs, apex, www) returns HTTP 403 with the restricted-region page to this host near Seattle, for REST and for the WebSocket upgrade, measured 2026-09-23 03:23 to 03:38 UTC.
- Terms of Use (BLF Global Limited, 2024-09-11 archived copy) list the United States of America and Canada as Restricted Locations, so US persons may not trade.
- CCXT 4.5.68 loadMarkets fails with ExchangeNotAvailable (403 mapped at base/Exchange.js line 2408), so the connector gets no catalog.
- The engine treats 403 as a rate limit (server/src/shared/errors.ts line 1), so a BloFin anchor poller here would pause after every round and never read a row.
- Even from a permitted host: CCXT parseMarket reads settle from quoteCurrency (blofin.js line 520), so the 14 coin-M inverse contracts load as linear, settle USD, contractSize 1, and need marketFilter settle === 'USDT'.
- No bulk call publishes the funding interval, so the poller needs funding-rate-history once per instrument.

Open questions:

- The protocol facts come from an Internet Archive copy of docs.blofin.com dated 2025-10-31, fees from a copy dated 2026-06-11, and the catalog from an archived instruments reply dated 2026-09-16, because the live pages refuse this host and WebFetch.
  The main session should decide whether archive-sourced facts are acceptable.
  No proxy or VPN was used.
- Whether the 2026 Terms of Use still list Canada and Venezuela as restricted.
  Only the 2024 copy is readable.
- Index basket and weights, the mark formula and its clamp (a 'Last Price Protected' mechanism is mentioned), the funding formula, cap and floor, and whether funding-rate fundingTime is the next or the last settlement.
- Whether the books wire sends levels as strings or JSON numbers (the docs show both), whether idle books send id-only deltas, and the per-connection subscription cap.
- Whether BloFin serves the homeserver run host, which can only be checked from that host, and the probes are ready to rerun there.
- CoinGecko lists 21 USDT perps not in the 2026-09-16 archived catalog (such as QTUM, SMCI, TQQQ), so the live USDT-M count is 460 to 481.

### Deepcoin

Verdict: fits with a named change.
The CCXT catalog loads 353 active swaps with contractSize equal to ctVal, and that matches the socket's contract sizes.
The TopicID 25 book matched the REST top 20 exactly when at most 35 contracts share a socket.
Mark, funding rate, interval and next settlement each come from one bulk REST call.
The named change is the index: no REST call returns a live index, so the anchor must read D from the WS TopicID 7 ticker (or take the whole row from it), which the REST-only AnchorPoller cannot do today.
The book feed also needs venue-specific handling.
It has no sequence number, so the rule is: resubscribe on a crossed book, 35 markets per socket (10 sockets is the whole per-IP allowance), paced subscribes, the tickSz suffix and compact ids.

Blockers:

- No live index over REST: the anchor needs a socket source, D on TopicID 7, one subscription per contract, so AnchorPoller as a REST-only poller cannot fill AnchorRow.index.
- The book channel has no sequence number, and dropped 200 ms pushes left stale levels that crossed 8 to 26 of 348 books per 45 s with all contracts on one socket.
  The feed needs at most 35 contracts per socket (10 sockets, the full 10-per-IP allowance) and a crossed-book resync, preferably a same-socket resubscribe, which returns a fresh snapshot.
- Subscribes must be paced (20 per 100 ms worked).
  A burst of 348 in 5 ms lost acknowledgements and then the whole socket.
- FilterValue needs the compact id (BTC-USDT-SWAP becomes BTCUSDT) plus the info.tickSz string.
  The funding calls key by the compact id and the mark call by instId, so the feed and poller need an id map.
- The 5 inverse USD contracts duplicate USDT pairs and need a marketFilter. 1000CHEEMS-USDT-SWAP has baseCcy truncated to 1000CHEE in CCXT and needs an override to cluster.

Open questions:

- The retail VIP fee table beyond VIP 0 was not readable (the fee page is an SPA and the site blocks this host).
  The help center VIP image lists volume thresholds only, and its text says VIP1 is 1,000,000 USDT while the image says 10k.
- A 2023-12-27 notice put 19 USDT pairs (NEAR, ATOM, AAVE, AVAX and others) at 0.12% taker.
  Whether that still holds is unknown, and it needs the authenticated account/trade-fee endpoint.
- Seven instruments outside the catalog appear in the tickers and mark replies (1BTC-USD-SWAP, 2BTC-USDT-SWAP, dBTC-USDT-SWAP, dETH-USDT-SWAP and others). dETH-USDT-SWAP showed about 78 billion of 24h quote volume, and what these are is unknown.
- Push loss was measured at 4, 35 and 348 contracts per socket only.
  The safe slice size between 35 and 348 is untested, and whether loss depends on per-socket load or on server hiccups is unproven.
- Index basket constituents and weights are not published, so a self-referential index cannot be screened.
- The documented ?version=v2 socket answers ping but ignores v1 subscribe frames, and its format is undocumented.
- The over-limit status code and Retry-After were not observed, because every probe stayed well inside the published limits.
- The funding settlement instant was not captured.
  History rows show 00:00, 08:00 and 16:00 UTC for 8h contracts.
- Mark rows carry a ts 0.5 to 5.3 s old at arrival, so whether the poller should stamp readings with ts rather than arrival time is a design choice.
- The venue announced 96 stock and ETF perpetuals.
  Their mark is frozen and funding paused outside US market hours, so they may need a skip rule.

### Koinpark

Verdict: spot only.
Koinpark lists no perpetual and publishes no index, mark or funding, and CCXT has no class for it, so it cannot be an engine leg.
Even as a spot venue it would need work.
The feed is undocumented binary MQTT, which VenueFeed cannot send because it JSON-stringifies every subscribe frame.
The deltas carry no sequence.
The REST budget is 1,440 requests a day. 61 of 215 pairs are a 10 s old copy of Binance's book.
Its own books barely move: BTC_USDT did not change across two 60 s poll runs.

Blockers:

- No perpetual futures, and no index, mark or funding to anchor.
- No CCXT class in 4.5.68 or master, so the catalog would be empty.
- Book feed is undocumented MQTT over WebSocket.
  VenueFeed JSON-stringifies subscribe frames (VenueFeed.ts lines 143, 152, 161) and the server closes on JSON.
- Own-book deltas (orderBookMatch_) have no snapshot, sequence or timestamp, so a lost delta is undetectable.
- REST limit is 1,440 requests a day per client (RateLimit-Policy 1440;w=86400), about one call a minute across all paths.
- 61 liq 1 pairs are Binance spot at 0.8 times the size republished every 10 s, so crosses against Binance there are the copy's age.
- Terms 12.2 prohibit scraper bots and unauthorized algorithmic high-frequency scripts.

Open questions:

- Whether KYC accepts US persons (the sign-up country list comes from a backend call that was not made).
- FIU-IND registration status (the FIU-IND page refused the fetch).
- Why the REST rate-limit counter restarted 21 minutes into its 24 h window, and what status a client gets at the limit (not tested, to protect the budget).
- The fee page lists 0.4% maker and taker on BTC/USDT and most pairs, but /publicApi/asset reports 0.25% on all 209 assets.
  The fee page was taken as the schedule.
- Whether an unchanged liq 1 whole book is re-sent, since the copied Binance book always moved within 10 s.
- Idle cutoff with keepalive 0 was 61.2 s in one run and 23.1 s in the other.

### BTSE

Verdict: fits with a named change.
BTSE has everything the engine needs: a WS book with a snapshot on subscribe, a sequence chain and 50 levels, a 1 s REST index and mark, and a funding feed.
The named change is that CCXT 4.5.68, which server/ pins, has no btse class.
The class first shipped in CCXT 4.5.74 (2026-08-17), and its market.taker is 0.00055.
The adapter also needs three details.
First, CCXT's market.id is BTC-PERP-USDT while the socket and legacy anchor use BTC-PERP, so the feed must route on data.symbol + '-USDT'.
The server folds both spellings into one subscription and sends deltas on the other spelling's topic.
Second, the poller merges legacy /price (1 s) with ticker/24hr (about 30 s) and avoids the 30 s-cached ticker/indices.
Third, a marketFilter keeping info.category == 'CRYPTO' drops the 80 stock and commodity perps, whose tickers collide with crypto ones (GAS = Natural Gas, QNT = Quantinuum).

Blockers:

- CCXT 4.5.68 in server/ has no btse class, so the catalog cannot load until CCXT is upgraded to 4.5.74 or later.

Open questions:

- The Retry-After format on a 429 is disputed in the docs (unlock timestamp or seconds) and was not provoked.
  AnchorPoller.ts line 269 would read a Unix timestamp as seconds and pause for decades.
- The first of three batch runs had 8 sequence gaps on ETH, SOL and SUI, but the jump size was not recorded (the probe now logs it).
  How often gaps happen is uncertain.
- The funding settlement instant was not captured, so whether the published rate resets at the hour is not verified.
- The index basket weights are not public (the website Index page is script-rendered), and stock and commodity perps have no documented index source.
- The operating legal entity is not verified: the terms page is script-rendered.
- The documented 100-topic cap per connection was not enforced at 111 topics.
  Whether it will be is unknown.
- Settle-family check: BTSE perps are USDT-quoted but settle in any of 17 or 19 currencies.
  The profile does not confirm that the quote family treats this as a plain USDT market.

### Deribit Spot

Verdict: fits with a named change.
CCXT's catalog, one public WS book channel with a snapshot and a prev_change_id chain, and one bulk REST anchor call all fit the engine's shape.
The named change: linear book amounts are base coins while CCXT contractSize is the coin contract size (0.0001 on BTC), so the registry needs contractSize: 1 plus marketFilter linear === true to drop the two USD-sized inverse contracts.
Without it, sizes read up to 10,000x too small.
The anchor poller also needs fundingIntervalHours 8 and nextFundingAt 0, because funding is continuous.
A 2 s poll interval matches the summary's republish cadence. takerPpm 350 and ccxtTakerPpm 350.

Open questions:

- The USDC 100ms socket books sometimes trail REST by up to about 1.6 s, and frame ages reach up to 2.8 s, while the inverse ETH book never exceeded 0.6 s.
  It is Not verified whether Deribit's USDC publisher, Cloudflare or the aggregation causes this, or whether the authenticated raw interval avoids it.
- The bulk anchor snapshot is a median 1.4 s old on arrival and republishes about every 2 s.
  Should the poller stamp creation_timestamp instead of arrival time?
- 122 of 131 perpetual indices resolve to mda_index_source at weight 100, which the public API does not break down.
  It is presumably the Coinbase Index, but that is an inference.
- OPENAI_USDC-PERPETUAL index can fall back to a one-hour EMA of its own mark, which makes it a deny-list candidate.
  Its price (about 1,658 USDC) has not been checked against OKX's OPENAI, which carries a price scale of 10.
- The 23 equity, 5 equity ETF and 4 commodity perps switch to an internal index built on an EMA of their own mark while the underlying market is closed.
  The engine needs a weekend or off-hours guard or a deny rule for them.
- The fee article calls its table 'the upcoming fee levels' and gives no effective date.
  The live catalog's taker_commission 0.00035 matches the Standard 3.5 bps.
- Not observed: what the book channel sends for a one-sided or empty book, and for a closed perpetual (documented error 13019 orderbook_closed).
- The public per-IP REST limit is unpublished, and the HTTP status of a breach was not provoked.
  A breach may terminate the session (10028).

### BitKan

Verdict: no public API.
BitKan publishes no REST or WebSocket API and no API docs, and it has no CCXT class in 4.5.68 or master.
Its website and help center refuse this host with Cloudflare 403s.
The only reachable socket is the website's own undocumented one, which has no book channel and zlib-compresses its frames inside the WebSocket frame.
The deeper problem is that BitKan's perpetuals are Binance USD-M contracts it brokers.
All 723 CoinGecko symbols are Binance USD-M symbols, and the 2023 catalog copy reads exchange binance on 169 of 169 rows.
The socket's trades matched Binance aggTrades by price, quantity and side (301/301, 24/24, 331/331 and 347/347), arriving a median 392 ms after Binance's trade time.
The funding fields are Binance's.
So even a working feed would duplicate the Binance leg the engine already has.

Blockers:

- No public API, no API documentation and no API host (api, docs and openapi.bitkan.com do not resolve).
- No CCXT class in 4.5.68 or current master.
- Bitkan.com (site and /proxy/v2 calls) returns a 403 Cloudflare JS challenge to this host, and help.bitkan.com returns 403 error 1034.
- No book channel on the only reachable socket, and that socket is undocumented with zlib-compressed binary frames and no sequence field.
- Perpetuals are Binance USD-M contracts brokered through BitKan, so prices, marks and funding are Binance's own and duplicate the existing binance leg.
- Perpetual fee schedule unreadable (loaded per user from /proxy/v2/contract/account/fees behind the challenge).

Open questions:

- BitKan's VIP 0 perpetual maker and taker, and whether it marks up Binance's 200/500 ppm (the fee page shows separate Binance and OKX rate rows).
- BitKan's legal entity and its restricted-region list, since the terms page cannot be read from this host.
- Whether the coin-margined perpetuals the help article names, and any OKX-routed contracts, are still offered (0 of either observed on CoinGecko).
- Whether BitKan's own book (REST /proxy/v2/contract/quote/depth) is identical to Binance's book, since the depth endpoint was unreachable.

### VALR

Verdict: fits with a named change.
The book feed fits as is: snapshot on subscribe, strict per-pair sequence, checksum on every frame, and no auth.
Two named changes are needed.
First, there is no CCXT class, so a hand-written catalog from /v1/public/pairs has to replace CCXT loadMarkets.
It would have 4 markets, rawMarketId equal to symbol, and contractSize 1 because sizes are base coins.
Second, the anchor row has no index, because VALR publishes none.
The poller also needs intervalMs of about 3 s because of the documented limit of 30 public requests per minute.
The venue adds little: 4 thin books (BTC has 27 bid levels and about 5,200 USDT at the best ask) and a 700 ppm taker.

Blockers:

- No CCXT class exists in 4.5.68 or in current master (commit 1d8b674, 2026-09-22).
  PR 23445 'New exchange: Valr' has been open since 2024-08-16.
  The registry types createExchange as () => ccxt.Exchange (server/src/venues/registry.ts line 29), so VALR needs a catalog that does not come from CCXT.
- No index price is published by any REST route or socket event.
  So AnchorRow.index cannot be filled, and the reader divides by it for touchPremium and markPremium (server/src/engine/opportunity/anchorReading.ts lines 82 and 83).
  The freshPremium gate reads only the mark.
  Because the mark is clamped to within 1.5% of the index, a capped mark cannot be told apart from a fresh one.

Open questions:

- Is estimatedFundingRate recomputed within the hour, or is it the last settled rate carried forward?
  At 03:20 and 03:34 UTC it equalled the 03:00 settled rate on 4 of 4 perps and did not change over two 120 s runs.
  The settlement instant was not captured.
- The funding history skips some hours (a 6 h step on BTC, 2 and 3 h steps on ETH and SOL) and has no zero-rate rows.
  That the skipped hours are hours floored to 0 is an inference.
- Which jurisdictions qualify for futures is not published.
- Is the documented limit of 30 per minute on /v1/public/* shared across all paths or counted per path?
  This was not tested.
- The index baskets list 'Binance BTCUSDT' and so on without saying whether that is spot or the perp.
  CoinGecko shows an index for these contracts (86,463 for BTC), and where it gets that number is not public.
- The documented 15-minute close of unauthenticated sockets was not observed, because sockets were held at most 110 s.
  It is also unknown whether the 60 s idle close comes from VALR or from the Google load balancer.
- Futures/info and marketsummary are served from a shared cache (max-age 60 s and 5 s).
  A REST poller stamps readings on arrival, so it would record stale data as fresh.
  The alternative is the socket's MARK_PRICE_UPDATE every 3 s, but that is an anchor that is not a REST poller.

### Bitrue

Verdict: blocked.
Bitrue cannot join as a perpetual leg in its current shape, for three reasons.
First, the public book socket runs about 7 s behind the REST book in every probe run, so every Bitrue book would reach the engine 7 s stale while looking fresh.
Second, no call returns index and mark in bulk, so the anchor poller would need one request per market per second against an unpublished rate limit.
Third, CCXT 4.5.68 marks all 785 swaps active=false, so the connector loads zero markets.
Only the third of these can be fixed on our side.

Blockers:

- Book delay: on wss://fmarket-ws.bitrue.com/kline-api/ws, BTC depth and trade frames arrive a median 6.8 to 6.9 s after the REST book shows the same top five levels (two lag runs, 44 matched books).
  Median frame age is 7.4 to 7.9 s, and only the first frame after a subscribe is fresh.
  The web page's URL futuresws.bitrue.com is worse at about 11.6 s.
  This is on the venue side and a feed cannot fix it.
- No bulk anchor: index and mark come only from GET /fapi/v1/index?contractName=<id>, one contract per call, so a 1 s AnchorPoller round needs one request per tracked market (726 for USDT-M).
  The futures rate limit is not published.
  The bulk web funding list has no index or mark and takes about 1 s.
- Catalog: CCXT 4.5.68 bitrue.js line 1006 sets active = (status === 'TRADING'), but the contracts reply sends status as the number 1.
  All 785 swaps are active=false, and connector.ts lines 79 and 196 to 202 then drop every one ('no usable swap markets'). marketFilter runs after that filter and cannot restore them.
  CCXT master is unchanged.
  Named change: a connector option that treats info.status === 1 as active.
- Feed decode (small change): every frame is gzip inside a binary frame, so a feed must call zlib.gunzipSync in handleMessage (median 23 to 29 µs per frame).

Open questions:

- Is the roughly 7 s socket delay global, or specific to this host's path or time of day?
  A probe from a host in Asia would settle it.
- What is the actual rate limit of the public futures REST API?
  No limit is published. 5 requests per second drew no refusal, and CCXT assumes about 416 per second, derived from the spot limit.
- Which exchanges and weights make up the index, and what is Bitrue's own share?
  The guide says the index includes Bitrue itself.
- Which closing taker applies: 0.02 % from the 2024-03-04 announcement, or 0.06 % from the live web contract list?
  The profile recommends 600 ppm for both open and close.
- Does the BTR 20 % fee discount apply to futures?
- What is the funding rate formula?
  What is the real settlement cap, given that the listed ±0.375 % limit is exceeded?
  When does the interval change?
- What is the liquidation fee?
  It is not published.
- What happens above 100 streams per socket?
  Does the server ever enforce the documented rule of a pong within 1 s?
  The wire showed pings every 10 s and no enforcement.

### Pionex

Verdict: fits with a named change.
The ORDERBOOK channel (snapshot on subscribe plus a strict prevNumber chain) fits the VenueFeed shape.
It needs a PONG reply in handleMessage and subscribeGapMs 250.
The one bulk indexes call fits the AnchorPoller shape.
The named change: CCXT has no Pionex class in 4.5.68 or in master, so the connector needs a stand-in exchange object whose loadMarkets maps GET /api/v1/common/symbols?type=PERP to CCXT-shaped swap markets (contractSize 1, taker 0.0005).
Smaller additions: a funding interval source, since the bulk reply has none, and a check of result:false in 200 bodies.

Blockers:

- No CCXT class in 4.5.68 or CCXT master (only an unmerged Go-only PR #27466), so the connector cannot load the catalog without a hand-written stand-in loadMarkets adapter.
- US persons may not trade: the United States is a Restricted Jurisdiction in the Terms of Service, which matters for any execution stage.

Open questions:

- Busy ORDERBOOK streams went about 10 s silent and then resumed with one large update, prevNumber chain intact.
  This hit 3 of 10 BTC/ETH stream runs and 16 of 95 busy streams in one 60 s batch, and DEPTH stalled at the same time.
  The sequence check cannot see it, so what staleness guard should apply, and does a resubscribe during a stall return a fresher snapshot?
- The mark is the index plus a 5-minute average of Pionex's own perp basis, so the mark trails the Pionex book.
  Does the fresh gate (mark over index premium) misjudge Pionex legs the way it did the Binance ONE self-index case?
- Where should the funding interval come from: per-market fundingRates history at boot (560 calls at weight 5, about 19 minutes paced beside the anchor poll) or inference from nextFundingTime stepping at the first settlement?
- Built books lose levels past 100 because the server does not refill the window.
  Is a periodic or threshold resubscribe needed to keep 20 levels during long trends?
- Which base spelling should pairing use for the 17 rows where baseCurrency differs from the symbol prefix (1INCH as INCH, NEIRO as NEIROCTO, LIT as LIGHTER, WTI as CL, five Chinese-named symbols), and which X-suffixed tokenized-stock tickers need DENIED_PAIRS lines?
- The live fee page is unreadable behind a Cloudflare challenge.
  The 0.02%/0.05% schedule comes from the 2025-10-22 VIP article (effective 2025-11-01) as archived 2026-05-21, so a newer change cannot be excluded.
- The index basket weights per contract are not public, and the index source for tokenized stock and commodity perps is undocumented (AAX index frozen at 44.68 while its market was closed).
- Which asset margins the coin-quoted and USDT_<coin> families is undocumented.
  These families are outside the USD quote family anyway.
- The 5 msg/s per connection and 10 connections per IP WS limits, and the IP REST ban behaviour (429, 60 s ban, Retry-After), were not provoked, so their exact enforcement is unverified.

### Webot

Verdict: spot only.
Webot lists no perpetual, futures or options, only 384 spot pairs.
It also has no CCXT class for the catalog and no index, mark or funding for the anchor poller.
It publishes no API documentation, and its public data comes from undocumented Pionex.US hosts that answer the Pionex open API shapes.
So it cannot join the engine as a perpetual leg in any form.

Blockers:

- No perpetuals: all 384 symbols are SPOT and type=PERP returns null.
- No CCXT class in 4.5.68 or in master at 1d8b674, so there is no loadMarkets catalog and the connector's swap filter would keep zero markets.
- No index, mark or funding endpoint (all 404), so any route is refused as anchor_missing or anchor_no_mark.
- No official API documentation from Webot.
  The REST host api.webot.com / api.pionex.us and the socket host ws.pionex.us are undocumented Pionex.US leftovers and could disappear without notice.
- API keys are reported unavailable on Pionex.US, from a help center article title and a search summary.
  The body could not be read, so execution by API is doubtful.
- The book feed is whole top-N snapshots at about 1 Hz with no sequence id, which is slow next to the engine's other venues.
- Wide spreads: BTC_USDT was 534 to 1,356 ppm across the touch, with a sub-dollar best bid in one read.

Open questions:

- Can a Webot account create an API key today?
  The Pionex.US help center article body was behind a Cloudflare challenge.
- What does the catalog field enable mean?
  It is true on only 6 of 384 symbols, yet 292 enable-false symbols traded in 24 h.
  It may mark API-tradable pairs.
- Why do subscriptions refused with SUBSCRIBED_TOPICS_EXCEED_LIMIT still deliver DEPTH frames? 220 of 284 did so in two runs.
- The per-IP connection cap was not probed.
  The Pionex docs say 10.
- Do the EU service (Pionew Ireland) and the US service share this order book?
  The catalog has no EUR pairs.
- Which pairs, if any, have fees that differ from 0.1% maker and 0.5% taker?
  The site says fees may vary by trading pair.
- Which states are currently served?
  The list is served dynamically, and the homepage says 48 states.
- The contents of the delisting notice 'Webot (formerly Pionex.US) Will Delist Partial Spot Trading Pairs' (403 challenge).
- Is there a connection lifetime cap beyond 110 s?
  None was seen.

### Backpack Exchange

Verdict: fits with a named change.
The CCXT catalog maps cleanly: market.id is the socket and markPrices symbol, contractSize 1 matches base-unit sizes, and there are no duplicate pairs.
The markPrices bulk call covers every AnchorRow column except the interval, which is a constant 1 h.
Two changes are needed.
First, the registry must set takerPpm 500, because CCXT sets market.taker to undefined and the connector otherwise drops every market.
Second, the book feed needs a REST-seeded depth path, because depth.<symbol> never sends a snapshot and no existing feed has one.
The 17 equity perps should be skipped: off-session their index can be an EWMA of their own book.

Blockers:

- CCXT 4.5.68 sets market.taker to undefined (backpack.js line 758), so without takerPpm: 500 in the registry connector.ts maps every market to null and skips the venue.
- The depth stream sends no snapshot, so the feed needs per-market REST seeding (GET /api/v1/depth?limit=1000, buffer deltas, align on lastUpdateId), which VenueFeed and no current venue feed implement.

Open questions:

- This host's default route is a Surfshark WireGuard tunnel (interface surfshark_wg, exit at the CloudFront Seattle POP).
  It was not set up for this research and nothing was refused, but the survey's 'host near Seattle' premise should note it for every venue.
- Per-market mark-to-index bound threshold is not published, and the crypto index basket is not public, so self-index risk on crypto perps cannot be checked.
- Equity perps off-session: the docs say the index 'defaults to the perp index' or an EWMA of the market's own book mid. 7 to 10 equity perps held 3 or fewer distinct index values per minute.
  Deny or skip them.
- The funding formula as written (/8 after an interest add-on of 0.03% x hours/24) gives one eighth of the observed quiet-market rate 0.0000125.
- The settlement instant was not captured, and whether nextFundingTimestamp rolls exactly on the hour is not verified.
- The kSHIB top-20 rebuild matched 18 to 19 of 20 bid positions on a book of about 15 bids.
  Mismatch or short book is not verified.
- Public REST rate limits are not published (a 429 exists in the spec).
  Seeding 91 books at 5 per second drew no refusal.
- Realtime depth on 91 perps averaged 2,812 to 3,161 frames per second, peaking at 10,359. depth.200ms caps each market at 5 per second but adds up to 200 ms.
- The 100 ms taker speed bump on every non-post-only order affects whether a cross can be captured.
- KPEPE, kBONK and kSHIB are priced per 1,000 tokens with CCXT bases KPEPE, KBONK and KSHIB, so they cluster with nothing unless renamed.

### One Trading

Verdict: blocked.
The WebSocket book feed fits, but the other two parts do not.
There is no public index price on any REST call or WS channel, and Engine.ts rejects an anchor row without a positive index as index_invalid, so every route through this venue would be refused.
CCXT 4.5.68 types the DATED_FUTURE contracts as spot (only type PERP becomes a swap, onetrading.js lines 537 and 551), and master 4.5.82 does the same.
That leaves the connector with 0 active swaps, so it skips the venue.
The product is legally a 5-year dated future with 4 h funding and an own-book mark that moves once a minute.
It is also very thin: BTC_USD_P trades about 6 times an hour and turned over about $149k in 24 h.

Blockers:

- No public index price: the index is a licensed Kaiko benchmark that One Trading does not publish, and the engine rejects index 0 (server/src/engine/Engine.ts lines 558 to 561).
- CCXT 4.5.68 (and master 4.5.82) maps DATED_FUTURE to spot, so loadMarkets yields 0 active swaps and the connector logs 'no usable swap markets' (connector.ts lines 50 to 52 and 79).
  This needs a parseMarket override typing DATED_FUTURE with FIXED_INTERVAL funding as a linear USD swap with contractSize 1.
- The mark is the median of the venue's own last price, best bid and best ask, published once a minute.
  The move guard would see a whole minute's move in one poll, and the fresh gate would compare the live touch with a minute-old median of the same book.
- US persons are excluded from the venue entirely (GTC 1.7 clause 6.1.2).

Open questions:

- Does the API trading schedule (-0.005% maker, 0.015% taker, 'All' volumes, per fees page and two help articles) apply to a new account's API orders from the first trade?
  The public GET /fees shows only SPOT and FUTURES groups at 0.20% taker / 0.10% maker (2000/1000 ppm).
  If API pricing does not apply, takerPpm is 2000.
- Is the 16 levels per side a server cap?
  Both REST depth and WS books never exceeded 16, and spot books sat at exactly 16/16, but no dated future was seen deeper.
- Why does the WS snapshot's unum sometimes differ from the update stream by thousands (-16,999 to +12,143)?
  No gap was ever seen, so server behaviour after a dropped update is not verified.
- Which of market-ticker and funding-rate publishes the new mark first?
  In one logged run the ticker led by 14 to 27 s, while the other runs disagreed on BTC.
- The settlement instant itself was not captured, including whether the ticker's rate resets right after the hour.
- Whether the closed EUR PERP contracts or the short-term dated futures described in the spec will be listed.
  The supplemental lists LTC's index as KK_BRR_KTCUSD, which looks like a typo.

### Hibt

Verdict: fits with a named change.
HIBT has 82 live USDT-M perpetuals, a public socket whose 20deep topic sends a whole book on every frame (this fits the feed), and one bulk REST call that carries index, funding rate and next settlement.
Two changes are needed.
First, CCXT has no HIBT class, so the catalog needs a loader from /v2/market/contracts plus /v2/market/symbols: rawMarketId = lowercase ticker_id, contractSize 1 because sizes are base units, and active = supportTrade.
Second, HIBT's mark is its index, so the poller must either set mark 0, which refuses every HIBT route as anchor_no_mark, or accept the index as mark, which makes every HIBT premium read as fresh (the capped-mark failure).
Data-quality warnings for whoever decides: the book mid sits on HIBT's own index (median absolute gap 0 to 1 ppm over 82 contracts), and it trailed Binance spot by 1 to 1.3 s in a busy minute.
Funding rates are flat placeholders.
Reported daily volume is 8.6 to 8.7B USD against 7.6 to 8.1M USD of open interest, and 34 contracts show zero open interest.

Blockers:

- No CCXT class in 4.5.68 or on master 1d8b674, so the catalog needs a loader outside CCXT from GET /v2/market/contracts and /v2/market/symbols.
- No independent mark: GET /v2/market/index returns index_price exactly (360 of 360 same-instant reads, 8 of 8 against the socket index) and only per contract (the bulk form returns 400).
  The anchor must either set mark 0, so every HIBT route is refused as anchor_no_mark, or use the index as mark, so every HIBT premium reads as fresh.
- No fundingIntervalHours field.
  It must be the documented constant of 8 h.

Open questions:

- Which entity contracts with perpetual traders: the terms name Aux Cayes FinTech Co.
  Ltd.
  (OKX's Seychelles entity name) and exclude Canada, while the disclosures name KAIXUAN NETWORK CO., LTD. with a Canadian MSB.
- Whether the volume is real: 34 of 82 contracts report zero open interest with up to 109M USD of 24 h volume (spcx_usdt), and BTC reports 2.9B USD of volume on about 4M USD of open interest.
- Whether the book is an independent market: its mid sits on HIBT's own index (43 to 57 of 82 contracts within 1 ppm), it tracks Binance spot rather than Binance perps (which traded 430 to 500 ppm under spot), and it lagged Binance spot by 1 to 1.3 s in a busy run.
  HIBT's own 2026-08-12 notice blames an 'external market data source' for a BTC price discrepancy.
- Which funding rate is actually charged at 00:00, 08:00 and 16:00 UTC: published rates are flat at +/-0.0000129 for days, contradicting the documented formula with I = 0.01%.
  The history has only 5-minute samples, and the settlement instant was not captured.
- Index basket and weights are unpublished, and commodity and equity sources are unnamed.
  The HIBT index differed from Binance's USD-M index by a median 250 to 316 ppm over 59 shared bases (BTC +19 and -116 ppm in two reads).
- No perpetual rate limit is published and none was reached.
  Code 220017 means 'Too many requests' in the docs, but it also comes back with HTTP 200 for a bad depth limit.
- Unitree_usdt shows maker_fee 0.0005 in the catalog against the published 0.03% maker.
- Whether the six no-underscore commodity contracts are tradable: one-level books, zero volume, zero open interest, four with last_price 0, and crude's best bid and ask never moved in about 35 minutes of reads.

### SAFEbit

Verdict: spot only.
SAFEbit is a small Turkish spot exchange.
It has no perpetual, dated future or option.
It has no CCXT class, no documented WebSocket, and no index, mark or funding.
Its only public API is a REST feed for price aggregators.
About 3.44M TRY (about 79k USDT) a day trades across 123 mostly TRY pairs, and 83 of those pairs had zero 24 h volume.

Blockers:

- No perpetual product of any family.
- No CCXT 4.5.68 or master class, so loadMarkets cannot load it.
- No public WebSocket.
  The web app socket needs an AppId and MarketQueueName that only 403-refused internal calls provide, and borrowing the web app's embedded ApiToken would route around a refusal.
- No index, mark or funding for an anchor poller.
- The user agreement forbids automated access through interfaces SAFEbit does not provide.
- Liquidity is TRY-quoted and thin: 3.44M TRY a day, median two-sided spread about 6,870 ppm, BTC_TRY 24 h volume about 388 TRY.

Open questions:

- Which pairs currently carry the 0 Fee, 0 Maker, 0 Taker or SAFE Arena tags.
  That list comes from an internal call that answered 403.
- The amount of the annual commission fee the user agreement describes.
- Whether the web socket requires a token at connect.
  Only the upgrade was tried and no frame was sent.
- What the one /api/Spot/orderbook reply without a bids array was, during the scan started at 03:32:59 UTC.
  Its status was not logged, and the rerun had 0 failures.
- Whether the other brands in the same web build (SAFEbit Espana, Brasil, Georgia, Global, Cryptorium, Izzyex) run separate venues.
- Whether onboarding accepts a non-Turkish phone number or ID, since no account was opened.

### CEX.IO

Verdict: spot only.
CEX.IO lists no perpetual, dated future or option.
CCXT 4.5.68 marks the class swap false (cex.js line 30), the API docs never mention perpetuals, futures or funding, and CoinGecko's derivatives list omits it.
The connector would load 898 spot markets and keep 0.
Its spot market does work end to end: the catalog id BASE-QUOTE matches the socket and ticker keys on 898 of 898 pairs, and the book channel has a snapshot and a strict seqId chain.
Even as a spot leg it would be weak.
The public book is conflated to one update a second per pair.
Subscribing costs 1 point per pair of 100 a minute.
It publishes no index or mark.
Its fee is 2,500 ppm on both sides.

Blockers:

- No perpetual of any family: every CCXT market is type spot, so isActiveSwapMarket keeps 0 of 898 and the venue is skipped with 'no usable swap markets'.
- No index, mark or funding: an AnchorRow would carry mark 0 and every route would be refused anchor_no_mark.
- The public order book is conflated to at most one increment per second per pair, and the docs reserve 'more frequent order book updates' for the private API.
- Each order_book_subscribe costs 1 point of a documented 100 points a minute per IP, and an overrun closes the socket, so the 792 USD, USDT and USDC pairs take about 8 minutes to subscribe and every full reconnect repeats that.
- Get_ticker was served only about twice a minute from this IP (29 of 33 fast calls answered 429 with no Retry-After).
- CCXT reports no taker fee, so a registry takerPpm would be mandatory or every market is skipped.
- The development host egresses through Canada, which CEX.IO does not serve and whose IPs the website blocks, so no account could be opened from here.

Open questions:

- Does a new account pay 0.25 % on both sides, per the single-rate 2026 fee strategy in the archived limits page and API docs, or 0.25 % taker and 0.15 % maker, per the 2025 legacy maker-taker page?
  The live fee page redirects this host.
- Are get_ticker's 429s a hidden cost weight far above the documented 1 point, or a per-endpoint counter of about two a minute?
  Telling them apart needs more refusals, so it was not probed.
- Does the 2023 offer of 0.10 % on 67 pairs, declared permanent in 2024, still apply beside the 2026 list of 0.01 % stablecoin pairs?
- How many subscribes can one socket take in a burst beyond the 30 tested before the 100-point budget disconnects it?
- Is the private socket's book real time, or only faster than 1 s?
- Trade_subscribe was acked with a reqId but delivered no tradeHistorySnapshot or tradeUpdate for BTC-USD in 60 s across three runs.
  Why?

### Ondo Stocks

Verdict: no public API.
Ondo Stocks cannot join as a perpetual leg or as a data source.
It lists no perpetuals, since it is a primary mint and redeem venue for tokenized US stocks against USDon, so it would be spot only in any case.
Every documented REST and gRPC endpoint needs an API key issued only after KYC onboarding, and US persons are excluded from onboarding.
It has no WebSocket, no CCXT class, no order book and no index, mark or funding.
There is also no published fee, because the fee sits inside a proprietary 30 s quote spread.

Blockers:

- Every REST path at api.gm.ondo.finance requires x-api-key, and without one each answered 403 {"message":"Forbidden"}.
- The gRPC streaming host answers 403 to every keyless call, including HealthCheck, which is documented as needing no key.
- API keys come only through KYC onboarding with Ondo Global Markets (BVI) Limited, which excludes US persons and anyone inside the United States.
- No perpetuals, so there is no index, mark or funding for an AnchorRow.
- No WebSocket.
  The only book is a synthetic quote ladder over gRPC with no sequence, which VenueFeed (WebSocket only, VenueFeed.ts line 81) cannot consume.
- No CCXT class in 4.5.68 or in current master.
- No published maker or taker fee.
  The cost is a per-order proprietary spread inside the signed quote.

Open questions:

- Ondo Perps (CoinGecko id ondo-perps, Panama, app.ondoperps.xyz, established 2026, 65 perpetual pairs, open interest 1,030 BTC, 24 h volume 2,074 BTC at 03:26 UTC) is a separate perpetual venue.
  It is not in the survey tracker, and its relation to Ondo Finance and its API were not checked.
  It may deserve its own row.
- Whether the 403 on api.gm.ondo.finance and on the gRPC load balancer also applies an address or country rule is not verified, because no key was sent.
- The docs promise 401 MISSING_API_KEY and gRPC Unauthenticated, but the wire gave a gateway or WAF 403.
  Why they differ is unknown.
- The only public view of the quote spread is CoinGecko's bid_ask_spread_percentage: 0.011% to 4.15%, median 0.105% to 0.113%, across 100 pairs.
  It is not a fee and was not converted to ppm.

### Tothemoon

Verdict: fits with a named change.
A public socket carries the 13 USDT-M perpetuals, with a book that has a snapshot and a ticker that has index, mark and funding.
But none of the three engine parts fits as is, and each needs a named change.
(1) Catalog: CCXT has no class and REST lists only spot, so a loader has to read turboFutureInstruments.* from the socket.
(2) Book feed: use the documented contractsOrderbookVolumes channel on the web app's host octopus-prod-ws.cryptology.com, because the documented host is dead.
Reset the book on nonce 1 and again on the second whole window.
Use nonce for gaps, since there is no sequence or checksum.
Expect about 15 levels a side, not 20.
(3) Anchor: no REST call carries it, so it has to be socket-fed from turboTickers.*.
Funding is disabled (rate 0, mark = index, no next-funding time), and ATOM and ETC must be denied because their index is 14 % and 4 % off the market.
Fees are a flat 0.05 % maker and taker (500 ppm), with no tiers.

Blockers:

- No CCXT class (4.5.68 or master) and no REST perpetual catalog.
  Catalog must be loaded from the undocumented socket channel turboFutureInstruments.*.
- No REST index/mark/funding call.
  The anchor must be socket-fed from turboTickers.* (undocumented) or contractsTickers.<id>.
- Documented Octopus host wss://octopus.tothemoon.com is NXDOMAIN.
  The working host octopus-prod-ws.cryptology.com is undocumented for API users.
- Book stream has no per-contract sequence and no checksum.
  A naive merge left BTC, ETH, BCH and DOGE crossed in one run until the second whole-window frame is treated as a reset.
- ATOM_USDT_PERPETUAL and ETC_USDT_PERPETUAL index sits about 14% and 4% above the market (and above their own book).
  Both need a DENIED_PAIRS or anchor skip.
- Funding disabled on all 13 contracts (rate 0, no next settlement), so mark equals index and nextFundingAt is unavailable.
- Book window about 15 levels a side, below the engine's 20.
- US persons and the whole EEA are excluded from the perpetuals by the Contracts T&Cs.

Open questions:

- What the catalog flag reversed: true means on all 13 USDT-margined contracts (the wire behaves linearly).
- Whether funding will be re-enabled, and whether a next-funding time will then be published anywhere.
- Why the ATOM and ETC indices sit 14% and 4% off the market.
  The index basket is unpublished.
- Whether octopus-prod-ws.cryptology.com and the turbo* channels are a stable interface for API users, given the documented host no longer resolves.
- Whether a second whole-window frame always follows the snapshot (seen in 17 of 19 subscriptions), and whether the reset rule holds over long runs and fast markets.
- Whether payload.nonce would expose frames the server drops, or only counts frames it sends.
- The WS THROTTLING behaviour and the REST TOO_MANY_REQUESTS behaviour were not triggered or tested.
- The Contracts T&Cs (updated 2026-01-12) still describe BTC/ETH-only 1 USD contracts, unlike the live catalog.
  Which contract terms apply is unclear.
- Three spot pairs carry a 0.1% per-pair maker/taker in photonInstruments against the 0.2% spot rate.

### TokoCrypto

Verdict: spot only.
TokoCrypto lists 850 spot pairs and no perpetual, future or option.
CCXT 4.5.68 has swap false (tokocrypto.js line 32) and 0 of 850 markets are swaps, so the connector's active-swap filter keeps nothing.
Its 833 type 1 books are Binance's global spot books (it is "Powered by Binance Cloud": same lastUpdateId sequence on api.binance.com, same stream frames), so even a spot leg would add no independent price.
VIP 0 spot fee on crypto-quoted pairs is a 1,500 ppm commission plus 0.21% PPh Final tax and a 0.0444% ICEx bourse fee, 4,044 ppm all-in for both taker and maker.
IDR pairs are 0.20% taker / 0.10% maker commission (all-in 2,222/1,222 ppm on a buy, 4,322/3,322 ppm on a sell).
CCXT reports 0.0075 (7,500 ppm).

Blockers:

- No perpetuals: CCXT swap/future/option false (tokocrypto.js lines 32 to 34), /fapi/v1/premiumIndex 404 on www.tokocrypto.site and www.tokocrypto.com, /futures/BTCUSDT is a bare 666 byte nginx page, no futures route in the web app, connector.ts lines 195 to 201 keep 0 markets.
- Type 1 books (833 of 850) are Binance's own spot books with identical update ids, so the venue adds no independent price.
- No index, mark or funding for an anchor poller, and the engine refuses a route whose anchor has no mark.
- CCXT market.id is BTC_USDT while the socket needs btcusdt and the REST book BTCUSDT, so a feed would need an id mapping.

Open questions:

- Whether a US resident without an Indonesian KITAP/KITAS can open an account (no account opened).
- Whether margin is offered to TokoCrypto users: 715 catalog rows carry marginTradingEnable 1 and CCXT has margin true, but the site has no margin route and no margin fee.
- Whether the 25% TKO fee-payment discount also lowers the PPh Final tax and ICEx fee.
- Whether takerPpm for a survey row should be the all-in 4,044 ppm or the 1,500 ppm commission alone.
  The profile recommends 4,044 because tax and bourse fee are charged on every fill.
- Ping cadence of the type 3 socket wss://stream-toko.2meta.app (one ping in about 50 s in one run, none in the other).
- What the partial depth stream sends for an empty side (no one-sided book seen).

### Coinone

Verdict: spot only.
Coinone lists no perpetual, dated future or option, only 363 KRW spot pairs.
The connector keeps only active swaps, so it would load zero markets, and there is no index, mark or funding for an anchor poller.
As a spot venue the socket fits the engine's feed shape easily: each frame is a full 16-level book, no sequence handling is needed, and one socket carries every pair.
The catalog, quote and depth do not fit: CCXT market.id is a changing numeric ticker id, the only quote is KRW, and the book stops at 16 levels.

Blockers:

- No perpetual, dated future or option: CCXT swap/future/option false at coinone.js lines 31 to 33, no derivative endpoint in the docs, absent from CoinGecko's derivatives list.
- Every pair is quoted in KRW, which is outside the engine's USD/USDC/USDT quote family.
- CCXT 4.5.68 sets market.id to the ticker row's numeric id (coinone.js lines 414 and 420).
  It changes between loads and several pairs can share it (114 and 199 distinct values across 363 markets in the first run, 358 in the rerun).
  As rawMarketId it would never match the socket's target_currency.
  A spot design would need to key on baseId.
- The book is 16 levels per side on both the socket and REST (REST size is limited to 5, 10, 15 or 16), below the engine's 20.
- Only Korean nationals may trade, so US persons and foreign nationals, including residents of Korea, are excluded.

Open questions:

- The HTTP status of the over-limit reply was not provoked.
  The documented body is error_code 4 'Blocked user access', and no Retry-After was seen.
- The documented 30 minute idle rule counted from the last PING was not tested.
  A subscribed socket with no PING was still open at 120 s, and an unsubscribed idle socket closed at 60.7 s.
- Not verified: what the socket sends for an empty book side, and for a suspended or maintenance pair.
  None existed during the probe.
- The documented cap of 20 connections per IP and the 4290 close code were not tested.
- The pair-specific variable fees on the fee event page were not read.
- The Open API zero-fee promotion (since 2026-08-21) and the app/web voucher (since 2026-08-26) have no end date.
- CoinGecko's trust score rank read 88 on 2026-09-23 UTC, not the 86 in the task.

### Bitlo

Verdict: spot only.
The /config catalog holds 376 spot markets: 227 TRY and 72 USDT trading, 77 disabled.
There are no perpetuals, futures, options or margin, and CoinGecko's 214 derivatives exchanges do not include Bitlo.
There is no CCXT class in 4.5.68 or in master (commit 1d8b674) and no anchor data.
The socket is STOMP with no snapshot, so even a spot feed would need a per-market REST seed path that no engine feed has today.

Blockers:

- No perpetuals: the catalog is spot only (TRY and USDT pairs).
- No CCXT class in 4.5.68 or CCXT master, so the connector's active-swap catalog cannot load it.
- No index, mark or funding, so no anchor poller is possible.
- The WebSocket is STOMP over a Spring SockJS endpoint with no snapshot on subscribe, so a feed would have to seed every market from REST /market/orderbook and reseed on each gap.
- Mostly TRY-quoted: only 72 USDT pairs fall in the USD family, with a median quoted spread near 10,000 ppm and about 290k USDT of 24 h notional across all of them.
- The server closes a socket silent in both directions at about 61 s and never answers a client EOL, so a quiet socket gives the silence watch no liveness signal.

Open questions:

- The fee page says some markets have rates that differ from the VIP level, but that list (customer/fee-schedules) is shown only to a signed-in account.
- Rate limits are unpublished, and the status code a limit produces was not reached with 20 back-to-back reads.
- Vip/levels and the legacy /config exchangeFeeSchedule disagree above the entry band.
  They agree on VIP 0 at 0.35% maker and taker.
- Eligibility terms for the Bitlo Corporation (Panama) global host were not found, and US persons are not named anywhere.
- The shape of a delta that empties one side of a book was not captured.
- How long the whole-catalog socket stays silent in quiet hours was not probed.
  The worst gap seen was 940 ms at 03:49 UTC.

### KCEX

Verdict: no public API.
KCEX publishes no API documentation and has no CCXT class.
Its only market data interfaces are the futures web app's undocumented /fapi/v1 REST calls and the wss://www.kcex.com/fapi/edge socket, and the User Agreement forbids reading them with a program without KCEX's consent.
On the wire the socket is sound: the MEXC protocol with a strict version chain and REST-verified sizes.
Joining would still take four changes together: a custom catalog in place of loadMarkets, a User-Agent on the socket, a REST seed path, and a socket-fed anchor.
US persons may not trade.

Blockers:

- No published API and no CCXT class.
  Every endpoint is an undocumented web-app call that can change without notice.
- User Agreement forbids automated access (robots, scripts, scraping) and commercial use of data without KCEX's prior consent.
- US persons may not trade.
  The United States and Canada are on the refused list, although KCEX's own About page and llms.txt claim US and Canadian licences.
- Catalog: the engine's catalog is CCXT loadMarkets (server/src/ccxt/connector.ts line 68), so KCEX needs its own read of /fapi/v1/contract/detail.
- Socket handshake without a User-Agent is refused with 403.
  VenueFeed.openConnection passes no headers (server/src/feeds/book/VenueFeed.ts line 81).
- No snapshot on subscribe.
  Each contract must be seeded from REST depth, and a resync of a 100-contract socket means 100 REST reads at an unpublished rate limit.
- No fresh bulk anchor.
  The bulk ticker is cached up to 16.7 s old, so index and mark must come from WS push.tickers while funding comes from REST, which needs a socket-fed AnchorPoller variant.
- 239 index baskets are a single other venue's perpetual (including ONE_USDT on Binance's self-indexed ONE perp), which is deny-list input.

Open questions:

- Whether KCEX grants consent or offers an official API: the web bundle has API Management and APIKey strings, and every catalog row has apiAllowed true, but no public docs exist.
- Whether the sub.depth.full version aligns with the sub.depth delta versions, which would allow seeding from the socket instead of REST.
- Where the one BTC_USDT sequence gap in the 03:41 UTC run fell.
  The probe logs gap details since then, and no gap recurred.
- Whether the settled funding rate equals the last published running value.
  The settlement instant was not captured.
- Meaning of priceCoefficientVariation (0.5 on 827 contracts, 0.02 on 19), and whether any mark clamp exists.
- Why api.kcex.com answers CloudFront 403 'Request blocked' to this host: a geoblock, a WAF rule, or a retired host.
  It was not worked around.
- KCEX price ladders matched MEXC's at all 20 levels on 8 of 12 and 2 of 12 same-instant reads, but sizes never matched.
  Whether KCEX mirrors MEXC liquidity is unresolved.
- CoinGecko lists 862 perpetual pairs against 846 catalog rows. push.tickers carries BUN_USDT, which the catalog lacks.
- The 108 zero-taker meme contracts (promotion until 2027-03-24) make a single venue takerPpm of 100 conservative for them.

### OrangeX

Verdict: fits with a named change.
The public data is complete and clean.
The full-depth deltas are strictly sequenced and matched REST exactly, and two bulk REST calls return all five AnchorRow fields for every perp.
Two changes are still needed.
First, there is no CCXT class, so the engine needs a catalog loader that does not use CCXT, built on get_instruments.
Second, the book channel sends no snapshot on subscribe, so the feed needs a REST seed per market (get_order_book depth=100, aligning change_id to version), which no existing feed has.
The anchor has caveats: the mark follows the last trade, and the index basket is unpublished.

Blockers:

- No CCXT class in 4.5.68 or in master at 1d8b674: the catalog needs a loader that does not use CCXT, built from get_instruments?currency=PERPETUAL (id = instrument_name, base = quote_currency because the fields are swapped, contractSize 1, active = is_active and creation_timestamp in the past).
- No snapshot on subscribe: the feed must seed each market from REST get_order_book depth=100 and align change_id to version, which is a new step in VenueFeed.

Open questions:

- No REST rate limit is published.
  Seeding 578 books at startup, and reseeding after a gap, was not tested above 3 requests a second.
- The mark formula and index basket are unpublished.
  The mark tracks the last trade, and on a quiet contract (CHR) it jumped about 4,600 ppm from the index in one poll, above the reader's 1,000 ppm limit.
  A self-referential basket cannot be ruled out.
- The settlement instant was not captured, so it is unknown whether the charged rate equals the last displayed capitalRate.
- What the book channel sends for a one-sided, empty or delisted contract was not seen.
  OURA was is_active in the catalog before its listing time.
- The meaning of close_only_limit_value (non-zero on 16 contracts) is unpublished.
- The anchor relies on undocumented calls (the bulk tickers form, get_all_capital_rate, v2 funding history) that could change without notice.
- CCXT pull requests and issues for OrangeX were not searched: GitHub rate-limited this host and web search was unavailable.
- Contracts named with a coin multiple (1000SHIB and 5 others) are assumed to count sizes in that multiple, which was not checked against a book.

### BitDelta

Verdict: blocked.
The derivatives are perpetual-style contracts that the venue prices as a two-sided quote.
They have no CCXT class, no documented API (the public docs cover spot only), no depth or sizes on the wire, no sequence, and no index, mark or funding rate.
The engine has nothing to build a catalog, book feed or anchor poller from.

Blockers:

- No CCXT class in 4.5.68 or master, so the catalog path (loadMarkets plus isActiveSwapMarket) has no markets.
- The public API documentation (Postman collection, 2024-04-04) covers spot only.
  All derivatives data comes from undocumented website calls with no stability promise.
- The derivatives stream only a top-of-book bid and ask with no sizes and no depth, and there is no REST book, so there is nothing for depthLevels or the ladder walk to use.
- No sequence or checksum on any event, so resync cannot be triggered.
- No index, mark or funding rate.
  A mark of 0 means the engine refuses every route at open.
- The per-contract 'funding fee' is a daily charge on both sides (-0.01 to -4.47 %/day), not a long/short rate.
  It is readable only through 90 per-contract calls.
- Wide quotes: the median spread over 89 contracts is about 4,560 ppm, and SNXUSD sits at 240,000 to 274,510 ppm.
- US persons are prohibited.

Open questions:

- When is the funding charge applied: 00:00 UTC (first tooltip) or 12:00 UTC (second tooltip)?
  Not captured, and no public history call exists.
- Does the BDT holding-level table (0.15 % down to 0.05 %) apply to the derivatives commission, or only to spot?
- What unit are min_amount and max_amount in?
  They look like base-asset units, but that is an inference.
- How does the venue's own quote (it aggregates liquidity providers) fit the derivative terms clause 12.1 saying BitDelta is not a counterparty or market maker?
- Do the undocumented futures/* calls count against the documented 2,500 per 5 min per IP limit?
- The spot BTCUSDT book repeatedly showed only 3 bids (best 70000) on both REST and WS.
  Not followed up because spot is out of scope.

### Dex-Trade

Verdict: spot only.
Dex-Trade lists no perpetual, so it cannot join as a perpetual leg.
Its spot market would not fit as is either: there is no CCXT class for the catalog, and the socket is Socket.IO (40/42 framing, server pings, no snapshot on subscribe) where VenueFeed sends only JSON.stringify objects.
The catalog is 46 small-cap pairs with no BTC, ETH or SOL base, and only VRT shares a base name with Bybit's 845 perpetuals.

Blockers:

- No perpetual product of any family: spot only, and spot margin is switched off.
- No CCXT class in 4.5.68 or current master, so the connector's loadMarkets catalog cannot load it.
- The socket is Socket.IO/Engine.IO v4.
  Subscribes must be raw text 42[...] frames sent after the 40 namespace join, and VenueFeed.getSubscribeFrames only sends JSON.stringify objects (VenueFeed.ts lines 117 to 165).
- No snapshot on subscribe: every pair needs a REST /v1/public/book snapshot, and a reload on gap, instead of the engine's terminate-and-resubscribe resync.
- Terms exclude US persons, and the operator is in Seychelles.
- The catalog has 46 illiquid small-cap pairs with no major base, and 28 of 46 rooms were silent for 76 to 78 s.

Open questions:

- Whether a limit order that crosses the book pays the limit rate (1,000 ppm) or the market rate (2,000 ppm): fees are charged by order type, not maker or taker role, and checking needs an account.
- How total_discount_percent 10 on VIP 4 changes the charged rate, and whether the monthly BTC turnover window is calendar or rolling.
- What site ticker status 3 means (GTCUSDT, US7USDT are absent from /v1/public/symbols).
- Whether the REST book's sequenceId trailing the socket (seen once per run) means its content is ahead of its id.
  This is inferred from exact end-of-run matches, not proven.
- Whether Dex-Trade VRT is the same token as Bybit VRT.
- No rate limit is published, and none was hit at up to 2 requests per second.
- Seen from this host, the socket had no forced lifetime cap in 110 s, but longer holds were not tested.

### Tapbit

Verdict: blocked.
The perpetual market data API refuses this host.
Every /swap/ REST path and the WebSocket handshake return CloudFront 403 under a documented IP whitelist, which only approved KYC accounts get, and only while they trade 5M USDT per 14 days.
US persons are excluded.
There is also no CCXT class for the catalog.
Even with access, the anchor would need a socket-fed ticker.all, because no REST call carries the index, and funding is per contract with no interval or next-time field.

Blockers:

- Perpetual REST (/swap/) and the WebSocket return HTTP 403 from CloudFront to any host outside the API whitelist (changelog of 2024-12-13).
  This host was refused on every attempt.
- The futures API is granted only on application, to KYC-verified accounts that keep 5,000,000 USDT of perpetual volume with at least 50% maker per 14 days, and it is revoked otherwise with no reapplication.
- US persons are excluded by the Location Restrictions list.
- There is no CCXT class in 4.5.68 or in master 4.5.82, and the engine's catalog is a CCXT exchange instance (server/src/ccxt/connector.ts lines 21 and 68).
- No bulk REST anchor exists: the index is only on the WS ticker, funding is one call per contract at 3 calls a second, and no field gives the interval or the next funding time.
  So the AnchorPoller shape does not fit without a socket-fed anchor.
- The engine treats 403 as a rate limit (server/src/shared/errors.ts line 1), so a poller behind the whitelist would pause and retry forever.

Open questions:

- Is the CloudFront rule purely an IP whitelist, or also a country rule?
  One host cannot tell, and no other route was tried.
- Is the VIP 1 to VIP 5 perpetual fee table on www.tapbit.com/en/vip?
  It sits behind a Cloudflare challenge and has no Wayback capture.
- Does the WS version step by exactly 1 per update?
  Does the pushed topic keep the depth suffix?
  Is the server ping a protocol frame or a text frame?
  Is permessage-deflate negotiated?
- Is the published funding_rate the upcoming or the last settled rate?
  What is its unit on the wire?
- Does the REST instrument_id take BTC or BTC-SWAP?
  The docs describe it as BTC but the replies use BTC-SWAP.
- How are the TradFi and pre-IPO contracts indexed?
  How often does the index fall back to Tapbit's own spot price?
- Is the 2025-12-29 Fees article's 0.02% maker and 0.06% taker the VIP 0 rate?
  The site shows the rate only to a logged-in account.

### Websea

Verdict: blocked.
Websea lists 246 live USDT perpetuals, but it has no CCXT class for the catalog.
Its only book is an undocumented web-app socket that carries one market per socket, keys deltas by position, guarantees no snapshot and has no sequence.
No bulk REST call gives a fresh index for the anchor poller.

Blockers:

- No CCXT class in 4.5.68 or in CCXT master (ts/src at commit 1d8b674, 2026-09-22).
  The engine's catalog, loadMarkets at server/src/ccxt/connector.ts line 68, cannot load Websea, so a custom catalog is needed from /v1/futures/symbols (contract_size is in coins, 10 distinct sizes, no status field).
- No documented book channel.
  The web-app socket wss://cws.websea.com/ws/realTime_depth carries one depth subscription per socket (246 sockets for the catalog).
  Deltas are keyed by gear position, not price.
  No snapshot is guaranteed on subscribe, and there is no update id or checksum, so gaps cannot be detected.
  The only integrity checks are gear holes, order, crossing, and a REST depth_merged compare.
- No bulk fresh index. /v1/futures/index_price returns the mark, not the index. /v1/futures/24hr index_price is cached (changes 2 to 5 times a minute) and sits hundreds of ppm from both the mark and the Binance index.
  The true index is per contract (capi getSymbolDetail) or only on the undocumented type 8 socket stream.
- Counterparty and operations: withdrawals have been rationed in rounds since April 2026 with no full reopening announced, and positions and fills were rolled back after an AWS failure on 2026-05-16.

Open questions:

- Whether a VIP level needs both the 30-day volume and the WBS holding, or either one.
  The fee table is an image and the web fee call needs a login.
- The mark price formula and its clamp, and the meaning of premiumPriceRatio (0.005 on BTC and ETH, 0.1 on LAPTOP) and liquidationRate (1.25 % on BTC).
- The index formula and basket.
  The indexSource string is a fixed label, sent even for the pre-listing OPENAI contract.
- Whether any contract is on the hourly funding schedule today.
  The three contracts sampled from the 04:00 group were 4-hourly.
- What the depth socket sends for an empty side or a delisted contract.
  Neither was available to probe.
- Whether the undocumented cws sockets and capi calls have per-IP limits beyond the 20 concurrent depth sockets tested.
- How the engine should treat the same underlying under two bases (XAU/XAU500/XAUT, NVDA/NVDA500, TSLA/TSLA500, XAG/XAG500, CL/CL500, COPPER/COPPER500) and the three non-ASCII symbols.

### LeveX

Verdict: no public API.
LeveX's help center (updated 2025-04-30) says "We don't currently offer an API".
No documentation host resolves, and CCXT has no class in 4.5.68 or in master.
The only data surfaces are its own web client's: a REST host that refuses this machine with 403, and a socket with a 25-level book that has no sequence number.
The Terms of Use and User Agreement also forbid scripts and exclude US persons.
So none of the three engine pieces (CCXT catalog, book feed, REST anchor poller) can be built on a published interface.

Blockers:

- LeveX states it offers no API (support FAQ, last updated 2025-04-30). docs.levex.com, api-docs, developers and openapi all return ENOTFOUND.
- No CCXT class in 4.5.68 or in CCXT master at commit fbc5f21 (2026-09-22). raw levex.ts returns 404 and a GitHub issue search finds 0 results, so connector.ts has no loadMarkets to call.
- The web client REST host api100.levex.com returns 403 CloudFront 'Request blocked' to this host on every path, including /public/pairs (catalog, contractSize, fundingInterval, fundingCap) and the VIP tier table.
- The User Agreement (2024-10-25) and Terms of Use (2023-10-26) forbid bots, scripts and automatic devices that access or monitor the site.
- US persons are prohibited in both agreements, and Europe and the UK are also prohibited in the Terms of Use.
- The web client book stream has no sequence or update id and no checksum, so VenueFeed cannot detect gaps.
  Snapshots are re-sent on no fixed schedule.

Open questions:

- Is the api100.levex.com 403 a CloudFront geo restriction or a WAF rule?
  Nothing was tried around it.
- Per-contract fundingInterval, fundingCap/fundingFloor, contractSize and status values: these sit in the refused /public/pairs catalog.
  Does the 0.00005 group (132 contracts) settle every 4 h?
- The mark formula: it matched index*(1+rate*time-left-in-8h) within 20 ppm on 64 of 286 rows, equalled last on 17, and sat inside bid/ask on 113.
  The index basket is also unknown.
- The VIP tier table (seven levels since 2026-07-13) is loaded only from the refused host.
  The lowest published perpetual rates are 0.006%/0.03%.
- The web bundle has API-key management endpoints (api-key create/list, create-for-copy-kol-order).
  Whether LeveX grants keyed API access on request is unknown.
- Book size unit: linear and coin-M units are inferred from ticker turnover/volume (base coins and USD) and were not verified against a catalog.

### Biconomy.com

Verdict: fits with a named change.
The book socket and the anchor fit the engine.
The socket is one URL whose depth.full limit 20 frames are whole windows that need no sequence state.
The anchor is two bulk REST calls that together carry all five AnchorRow fields for all 295 perps.
The named change is the catalog.
CCXT has no Biconomy class in 4.5.68 or on master (1d8b674, issue #23685 open). ccxt.mexc cannot be pointed at it the way Ourbit was, because the paths are renamed: detail, ticker and funding_rate answer 404.
So a loader must read GET /future/api/v1/detailV2 with id=symbol, contractSize=cs, active=state 0 and taker=tfr 0.0006.
The size unit checks out against turnover on 294 of 295.
Caveats: every futures endpoint is the web app's undocumented API.
The feed needs a REST seed per market because no snapshot comes on subscribe.
The book ticks at 365 ms.
The index moves about every 5 s.
ICP_USDT and ANTHROPIC_USDT have to be skipped.

Blockers:

- No CCXT class in 4.5.68 or on master, and ccxt.mexc with URL overrides fails because detail, ticker, funding_rate/{symbol} and index_price/{symbol} answer 404.
  The catalog needs a loader that reads detailV2.
- The futures REST and WebSocket APIs are undocumented.
  The official docs (github.com/BiconomyOfficial/apidocs, V3) cover spot only, and these are the futures web app's own endpoints, so they can change without notice.
- Push.depth.full sends no snapshot on subscribe, and a quiet contract stays silent: 4 of 295 for 45 s, and NATGAS went 30.5 s between frames.
  Each market needs a REST depth?limit=20 seed and a pong-based silence watch.
- The ICP_USDT index has been frozen at 2.944 for 42 h on a single-source basket (BITGET_FUTURE), and the ANTHROPIC_USDT mark sits 2.4% under its index.
  The poller must skip both, or they must be denied.
- The index republishes only about every 5 s and the ticker snapshot is up to 1.8 s old on arrival.
  The reader's 1,000 ppm per-poll move guard therefore spans about 5 s of market.

Open questions:

- Whether US persons may trade.
  No page names the US as restricted, and no page says US persons are allowed.
- The funding formula and cap are unpublished. 22 contracts sat at exactly ±0.0005 and none were beyond, which suggests a 0.05% cap.
  The settlement instant was not captured, so it is unknown whether the settled rate equals the rate published just before it.
  The live rate equalled the newest settled rate on 19 of 25 sampled contracts but not on BTC or ETH.
- Futures REST rate limits are unpublished.
  No 429 and no limit code inside a 200 body was seen at about 3 requests/s.
  The spot docs say 5 to 20 requests/s per IP.
- The mark formula and any clamp are unpublished.
  The mark sat 3.8% from a frozen index, so no clamp tighter than that is in force.
- VIP plans bought monthly with BIT discount fees by an unpublished amount.
- The meanings of the detailV2 short fields (ih, ihd, ct, state 3) and of the BINANCECIP index source are inferred from the data, not documented.

### Bittime

Verdict: blocked.
The documented API (REST and fmarket-ws) shows a deep BTC book one tick wide, about 5,600 BTC a day.
The Bittime web page's socket shows a thin book 67 to 85 USDT wide, about 16.5 BTC a day.
Which book an order fills against cannot be found out without an account.
On top of that there is no CCXT class: CCXT's bitrue class, pointed at Bittime, marks all 49 swaps inactive.
There is no bulk anchor call, and the mark is the book's own last trade rounded to the tick.

Blockers:

- The book the documented REST and fmarket-ws socket serve differs from the one the Bittime futures web page shows (futuresws-cfx.bittime.com).
  BTC best bid and ask were 86,668.9 and 86,669.0 on one, 86,626.5 and 86,711.5 on the other, and ZRX had 30 levels on one and 11 on the other.
  Which is executable is unknown without an account.
- CCXT 4.5.68 has no Bittime class, and master had none at commit 1d8b674.
  CCXT bitrue pointed at fapi.bittime.com loads 49 swaps, but active is false on all of them (bitrue.js line 1006 compares status to 'TRADING' and Bittime sends 1), so connector.ts line 201 keeps zero markets.
- The anchor has no bulk call.
  Index, mark and funding come per contract from the undocumented /fapi/v1/index, 49 requests per round.
  The funding interval comes only from the undocumented web call common/public_info.
- The mark (tagPrice) is the book's last trade rounded to the tick.
  One ZRX tick is 804 ppm, so the mark moved 1,608 to 1,609 ppm in one poll and trips the 1,000 ppm anchor_moving guard.
  Its premium to the index is the venue's own book premium.
- No futures fee schedule or maker fee is published.
  The 600 ppm taker (1,000 ppm on E-ARB-USDT) comes from an undocumented web API field.

Open questions:

- Which order book does a Bittime futures order fill against: the documented fmarket-ws/REST book or the futuresws-cfx book the web page uses?
- Maker fee, and whether Indonesian tax or the CFX levy (0.21% and 0.02 to 0.04% on spot) applies to futures.
- Funding cap and floor, the rate actually settled at the instant (not captured), and whether the help article's 8 h schedule or the wire's 4 h interval for 14 contracts is authoritative.
- Index basket and formula.
  It matched Bitrue's index on BTC and ETH but differed on HYPE, ZRX and XAUT.
- Why book frames carry a ts about 0.6 s before arrival while ticker frames carry one about 0.15 s before.
- The futures REST rate limit (none published).
  Whether the spot 20,000 per minute IP limit covers fapi.
- Whether non-Indonesian and US residents actually pass KYC.
  The help guide says 100+ USDT perpetual pairs but the API lists 49.
- Whether the documented 1 s pong deadline is ever enforced.
  No socket closed in 40 s without a pong.

### Hotcoin

Verdict: fits with a named change.
The book fits as it is.
One public WS URL serves every family with whole 50-level `depth` frames, so the feed calls resetBook each frame and needs no sequence logic.
The anchor mostly fits: one REST call has index, mark, next settlement and a settled rate for all 585 contracts.
The named change is the catalog.
CCXT has no Hotcoin class in 4.5.68 or on master, so a loader must read GET /api/v1/perpetual/public directly.
It would use code as rawMarketId, underlying as base, unitAmount as contractSize, and direction 0 as linear.
That loader would also carry takerPpm 600.
Anchor caveats: the bulk rate is the last settled rate, not the upcoming one.
The interval must come from the funding history.
The 555 KB reply needs a 2 s cadence.

Blockers:

- CCXT 4.5.68 and master (commit 1d8b674) have no Hotcoin class, so the connector's loadMarkets path cannot build the catalog.
  A direct loader for GET /api/v1/perpetual/public is needed.
- US persons are not accepted (Legal Statement Article 8 lists the USA as High-Risk, Not Accepted).

Open questions:

- Which entity contracts with a non-UAE user: the User Agreement names Hotcoin FZE (VARA) and the About page names Australian Hotcoin Global Exchange Pty Ltd.
- Whether the upcoming funding rate matters enough to justify a WS `fund_rates` anchor over the REST catalog, whose `fund` is the last settled rate.
- The live index basket is unknown: indexInfo returns 2023 data (BTC was binance_contract at weight 1) or null, so a self-index check is impossible.
- The mark formula and any clamp are unpublished, and the mark sat 6.8 to 6.9% above the index on bpusdt.
- The documented 5-minute no-heartbeat rule was not tested (sockets held at most 120 s).
  An idle unsubscribed socket closed at 60 s.
- What depth sends for an empty or one-sided book was not verified: every book seen, even the thinnest, had 100 REST and 50 WS levels a side.
- No REST rate limit number is published and no 429 was provoked.
- The settlement instant was not captured.
  History rows are stamped 4 to 213 s after the hour.
- AssetCategory mislabels several TradFi contracts (jpn225usdt, gbpusdusdt, hschkdusdt, gvzusdt read crypto).
  TradFi contracts go reduce-only while their market is closed.

### Gate US

Verdict: spot only.
Gate US is a US-licensed spot-only exchange.
It has no perpetuals, no index, mark or funding, no margin pairs and no CCXT class, so it cannot join the engine as a perpetual leg.
Its spot books are also nearly untraded: 350 of 385 pairs showed zero 24 h volume, and CoinGecko puts total 24 h volume at about $188k.

Blockers:

- No perpetual product: every futures, delivery and options REST path returns 404, and the Gate US API docs cover spot only.
- No CCXT class in 4.5.68 or on master.
  The engine catalog keeps active swaps only (connector.ts lines 79 and 196 to 202), so Gate US would load 0 markets.
- No index, mark or funding data, so an anchor poller has nothing to read.
- Washington is one of Gate US's seven excluded jurisdictions, and the website refused this host's Canadian VPN exit with an Akamai 403.

Open questions:

- The Gate US VIP 0 spot maker and taker rates are not verified.
  The fee page and VIP page build their tables with JavaScript, and those tables were refused to this host.
  The public catalog `fee` field reads 0.2 % (2,000 ppm) on 383 of 385 pairs and 0.1 % on USDT_USD and USDC_USDT, and a gateeu-style CCXT class would report exactly those values.
  On global Gate, though, the same field reads 0.2 while the published VIP 0 spot fee is 0.100 % / 0.100 %, so the field is not the schedule.
- Whether Gate US honours a GT holding discount, and what its VIP tier thresholds are.
- The REST rate limit: the docs say 900 r/s per IP for public spot, but the x-gate-ratelimit-limit header reads 200, and the counters fit 200 per 10 s per path.
  The status code and Retry-After returned when the limit is hit were not provoked.
- What source feeds the ticker's last, change_percentage, high_24h and low_24h.
  They appear to follow global Gate, which is an inference.
- What spot.order_book sends for a book with only one empty side.
  Only fully empty books were seen, and those got one empty snapshot, or nothing in the case of CP_USDT.

### Independent Reserve

Verdict: spot only.
The venue lists no perpetual: spot only, 42 bases times 4 fiat quotes (AUD, USD, NZD, SGD).
The quotes are one order pool per base shown in each fiat at the venue's FX rate, and no market is quoted in USDT or USDC.
The connector would find zero swap markets.
Spot fee is a flat 0.50 % for maker and taker at VIP 0.

Blockers:

- No perpetual swaps: CCXT swap false and 168 of 168 markets spot, so the connector keeps zero markets.
- No index, mark or funding, so no anchor poller is possible.
- Book socket is undocumented, has no sequence, and its checksum broke when one socket carried 168 pairs at about 2,000 frames/s.
- AUD socket books carry stale crossed levels that no REST book shows, and they stayed at least 26 minutes.
- US persons excluded: the US is not among the 38 eligible countries.

Open questions:

- Why the aggregated socket keeps the crossed stale asks (for example BTC/AUD 121721.98 for 0.01105704) that no REST book shows.
- Whether the documented root-path order-level socket is retired or only refuses this host: it closed with 1006 whatever headers were sent.
- The real REST and WS rate limits: none published, no rate-limit headers, and nothing was tested above 1 req/s.
- Whether the checksum loss at 168 pairs is a server-side drop or a coalescing of events.

### bitFlyer

Verdict: blocked.
The only perpetual, FX_BTC_JPY, is JPY-settled, and the engine's quote family has no JPY, so it would form a BTC|JPY cluster with no partner leg. bitFlyer also publishes no index and no mark, so every route would be refused as anchor_no_mark.
The only possible proxies are the venue's own spot ticker and the CFD's own last trade.
On top of that, the book feed has no sequence and is healed only by snapshots every 5 s.

Blockers:

- JPY settlement: quoteFamily.ts folds only USD and USDC into USDT, so FX_BTC_JPY has no second venue to pair with.
- No index price and no mark price in any public call. mark 0 refuses the route at open (anchorReading.ts lines 37 to 38).
- The only anchor proxies are the venue's own spot BTC_JPY and the CFD's own ltp, a self-referential reference.
- Book channels have no sequence, timestamp or checksum.
  The snapshot is not sent on subscribe and comes only every 5 s.
  Deltas can miss deletions, so a gap can only be healed by the next snapshot, not detected.
- Trading is limited to customers of bitFlyer, Inc. in the JP region, with bitFlyer as OTC counterparty and 2x leverage for individuals.
  The US and EU regions list no CFD.
- The REST limit of 500 requests per 5 minutes per IP rules out a 1 s poll of two calls.

Open questions:

- Funding formula, cap, floor, and which side pays at a positive rate (on bitflyer.com, which refused this host). 279 of the last 500 rates are exactly 0.0001, which suggests a default band.
- Leverage point rate charged on open positions (the Crypto CFD user guide is on bitflyer.com).
- Whether the Lightning FX SFD (Special Fee for Deviation) is still charged on the Crypto CFD.
- Account residency rule for the Crypto CFD, and whether the bitflyer.com refusal is a geoblock or bot filtering.
- Status code and body when the 500 per 5 minutes limit is exceeded (not provoked).
- Tick size (not in any public call.
  Every observed price was a whole yen).
- Maintenance schedule and what the book channels send during maintenance or Itayose (a price 0 delta is documented but was not seen).

### Azbit

Verdict: blocked.
Azbit's perpetual market is a delayed republication of Bybit's linear market, not an independent venue. 154 of its 161 contracts appear on Bybit with the same lot step, funding interval and next settlement.
Every WS book frame probed (1,033 over two runs) matched a Bybit top-five state that had arrived 90 to 168 ms earlier at the median.
The API error codes name an "upstream venue".
The three contracts Bybit does not list have no book.
Separately, there is no CCXT class to build the catalog from, and no public mark or index, so the engine would refuse every route at open.

Blockers:

- The perpetual book is Bybit's linear book republished about 90 to 170 ms later at the median, so an Azbit leg would trade Bybit against a delayed copy of itself.
- No CCXT class in 4.5.68 or master, and the engine's catalog is CCXT loadMarkets (server/src/ccxt/connector.ts lines 68 and 79).
- No public index or mark in any REST call or WS channel.
  Mark would be 0, and anchorReading.ts lines 37 and 38 refuse the route as anchor_no_mark.
- The WS book frame has no sequence or timestamp, so gaps and staleness cannot be detected.
  Unknown pairs are acknowledged and then stay silent.
- US persons and 46 other countries are excluded by the limits page (noAccess), and futures require KYC.

Open questions:

- How Azbit derives its published fundingRate: it tracks Bybit's current rate with a delay slower than one minute, and 6 checked contracts matched neither Bybit's current rate nor its last three settled rates.
  The settlement instant was not captured.
- The mark Azbit uses for liquidation.
  The web UI shows a Mark Price label, but no public API exposes it.
- How much of the 90 to 168 ms lag is Azbit's own republishing and how much is network path from this host.
  It was not measured from a host close to both venues.
- What spot fee types 3 and 4 in /api/currencies/commissions mean.
  They were read as buy and sell fees at 0.2%, which is an inference.
- The source of the fees page's VIP paragraph.
  It mentions BGB (Bitget's token) and publishes no tier table, so it looks copied.

### BVOX

Verdict: blocked.
BVOX refuses this host outright.
Its site serves a region refusal page, and every public REST and WebSocket path answers 404 or 503, so no catalog, book or anchor could be read.
Its registration list leaves out the US and Canada.
There is also no CCXT class, and the API documentation link (bitvenus.me/docs/v1/intro) is dead.
CoinGecko still gets live data (last trade 2026-09-23 03:27:52 UTC), so the venue is running for other regions.

Blockers:

- Region refusal: every site host serves the 'Not Support Region' page to this host (Cloudflare loc=CA), and every API and socket path answers 404 or 503.
- Registration list (archived 2025-04-21) leaves out the United States and Canada.
- No CCXT class in 4.5.68 or on master 4.5.82, so there is no catalog path.
- No live public API documentation: the CoinGecko-linked docs URL returns 404, and the archived copy is an app shell with no text.
- No mark price source known, so an anchor would read mark 0 and every route would be refused at open.

Open questions:

- Is the refusal page served to every region, or only to North America?
  The Internet Archive crawler also gets it since 2026-09-02, and checking from elsewhere would need a route this survey forbids.
- Why does CoinGecko list 389 perpetuals (388 ticker rows) when BVOX's own web config listed 97 on 2026-08-02?
  Its page also says 1,352 trading pairs.
- Is feeConfig maker 0.0002 and taker 0.0006, found on every archived contract, the retail VIP 0 rate?
  CoinGecko's page says 'Fees: 0.1%'.
- Which backend and public host does CoinGecko read?
  Its ticker trade URLs point at www.bitvenus.me.
- The five -SWAP-USD contracts on CoinGecko (BCH, ETH, LINK, LTC, XRP) do not appear in BVOX's config.
  Is their margin asset inverse or linear?
- Funding interval, cap, the index basket and mark formula, and the legal entity name were all unreadable.

### BYDFi

Verdict: fits with a named change.
BYDFi moved to a new trading system on 2026-09-22, the same day as this research.
The documented API and docs site died with the move, and the CCXT 4.5.68 bydfi class now throws on loadMarkets.
The new platform serves MEXC's contract API on the same host, with the same paths and reply shapes.
So a leg can be built with three named changes.
First, the catalog: new ccxt.mexc() with every https://api.mexc.com URL replaced by https://api.bydfi.com, which loaded 266 swap markets with correct ids, contractSize and a taker of 0.0006.
Second, the book feed: the existing MEXC feed with its URL changed to wss://futures.bydfi.com/edge, since sub.depth.full at 20 levels behaved like MEXC's.
Third, the anchor: a new two-call poller (ticker plus funding_rate), because BYDFi's funding reply lacks the index and mark that the MEXC poller reads.

Blockers:

- CCXT 4.5.68 class bydfi is dead: loadMarkets throws ExchangeError 'bydfi {"code":404,"msg":"Not Found"}'.
  CCXT master on GitHub still points at the same dead v1/fapi paths and at wss://stream.bydfi.com, which has no DNS record.
- BYDFi documents no part of the working API. developers.bydfi.com has no DNS record, and the site links to no API document.
  The endpoints were found through the web app's bundle and through MEXC's path layout, so BYDFi could change them without notice.
- The platform was one day old when probed.
  The migration skipped the 08:00 UTC funding settlement on 2026-09-22, and behaviour may still be settling.
- The MEXC anchor poller cannot be reused as is: BYDFi's /funding_rate has no idxPrice or fairPrice, so the poller needs /ticker plus /funding_rate each round.
- US and Canadian persons are prohibited by the User Agreement.

Open questions:

- Will BYDFi publish documentation or rate limits for the new API?
  Nothing is published now.
  MEXC's stack signals a limit with body code 510, and that was never triggered here.
- The mark (fair price) formula and any premium clamp are not published.
  On the evening of 2026-09-22 the whole BTC book traded about 400 to 600 ppm under the index.
- The BTC_USDT book stood still for up to 7 s at a time and then rewrote hundreds of levels.
  BTC_USD REST sizes were mirrored on both sides in one read.
  Both look like a quoting program, so is the liquidity real?
- Coin-M contracts have contractSize 1 and sizes that look like USD.
  The engine would read them as coins, but the quote family ranks them after USDT anyway.
- Nothing was observed for an empty book side or for a closed contract.
  All 266 contracts were in state 0.
- The settlement instant itself was not captured, and how often the upcoming rate is recomputed is unknown (it moved once in one of two one-minute windows).

### DigiFinex

Verdict: fits with a named change.
CCXT lists every perpetual with market.id equal to the socket and REST instrument_id, and contractSize equal to contract_value on 109 of 109 markets.
The depth channel gives a snapshot on subscribe and a venue-kept 20-level window that matched REST.
The tickers call carries index and mark in bulk at 1 Hz.
Five changes are needed:
- handleMessage must zlib-inflate every frame.
- Keep at most 25 to 30 markets per socket and ping every 20 s.
- The feed has no sequence, so resync only on a crossed book.
- The anchor poller needs a per-instrument funding source: a funding_rate_history round-robin at weight 10, or WS fund_rate.
The funding_rate call is last-settled and mislabels the 4 h contracts.
- A marketFilter must keep linear contracts only and name the ETH contract, since CCXT collapses ETHUSDTPERP, BETHUSDTPERP and OETHUSDTPERP into one symbol and keeps OETHUSDTPERP.

Blockers:

- No bulk upcoming funding: fundingRate and nextFundingAt need per-instrument funding_rate_history (start_timestamp=now&limit=1, weight 10), for example 2 calls per second, which uses 1,200 of the 6,000 weight per minute.
  The funding_rate call returns the last settled rate and puts all 8 four-hour contracts on the 8 h grid.
- Every WebSocket frame is zlib-compressed inside a binary message, so the feed subclass must call zlib.inflateSync before JSON.parse.
- The depth channel has no sequence number and no checksum.
  A lost delta is undetectable, so the only resync triggers are a delta before a snapshot or a crossed book.
- Cap of 30 channels per connection, enforced by closing the socket with every book on it.
  The server also drops a socket after 60 s without a client message, so the feed pings every 20 s.
- CCXT symbol collision: ETHUSDTPERP, BETHUSDTPERP and OETHUSDTPERP all map to ETH/USDT:USDT, and Object.values(markets) keeps only OETHUSDTPERP.
  The 8 inverse contracts have contractSize 1 (1 USD), so a marketFilter must require linear and name the ETH contract.
- CCXT market.taker is 0.002 (2,000 ppm) on every swap (digifinex.js line 351), against a documented 500 ppm, so the registry needs takerPpm 500 and ccxtTakerPpm 2000.

Open questions:

- The funding settlement instant was not captured.
  Whether the last value of the future history entry (and of WS fund_rate) is the rate actually charged is inferred from the docs and from 111 of 111 last-settled matches, not observed.
- What distinguishes BETHUSDTPERP and OETHUSDTPERP from ETHUSDTPERP is not publicly specified.
  All carry base ETH, with index prices within 0.1.
- Live index baskets are not published, and the only example (Coinbase Pro, Bitstamp, Kraken, Gemini, Bittrex, itbit) looks out of date.
  Self-referential baskets cannot be screened.
- The TradFi promotion (maker 0 %, taker 0.02 % until 09/30 23:59) gives no time zone and does not say whether it applies to API orders.
- No perpetual VIP tier table is published.
  The private trading_fee_rate call example shows 0.00005/0.00003, while CCXT's comment shows 0.0005/0.0003.
- This host's egress geolocates to Canada, a country not served, so behaviour from a US IP was not tested.
- The 36 TradFi or pre-IPO tickers (e.g.
  OPENAI, ANTHROPIC, SPCX, QNTX, SKHY beside SKHYNIX, and the single-letter A) need a DENIED_PAIRS check against the other venues.
- The documented 24 h connection lifetime was not reached.
  The 429 body was not provoked.

### XT.COM

Verdict: fits with a named change.
The CCXT catalog, market.id, contractSize and the 600 ppm taker all line up with the socket and the REST replies.
The book stream is public, uncompressed and strictly chained.
A three-call REST poll supplies every AnchorRow field for all contracts at about 1 Hz.
The named change is a marketFilter: linear && settle === 'USDT' && info.tradeSwitch === true.
CCXT's active flag reads isOpenApi only, so it keeps 68 delisted contracts.
Coin-M contracts are USD-sized and duplicate 32 bases.
The feed must also seed the book itself, from REST or a depth@50 frame, because depth_update sends no snapshot.

Open questions:

- The first 400-stream batch run saw 574 fu breaks in 33,109 frames.
  Two reruns saw 0.
  The cause (skips or repeats, server or client) is unknown.
- Depth@<id>,50 frames are not exact at their own id on busy books (BTC 19 of 38 matched the kept book).
  Is a socket seed acceptable, or should the feed seed from REST at 10/s?
- Kept books matched REST at the same update id on 27 of 39 align reads.
  The misses may be REST replies stitched from two instants or level changes the stream skipped.
- The mark is documented as clamped within 1% of the index, but it is not.
  NFLX's index is 10x its price (pre-split).
  Should nflx_usdt be denied, and should the 217 TradFi contracts be screened against other venues' tickers?
- About a third of marks equal the leg's own last trade.
  How should the fresh gate treat an XT mark premium?
- Funding caps per contract are not published, and the settlement instant was not captured.
- Rate limit: headers say burst 10/s on depth and 1000 on funding (docs say 1/s).
  No 429 or Retry-After was seen.
  The documented penalty is a 10-minute account lock, and its effect on public IP calls is unknown.
- The symbol list's makerFee is 0.0004 on 554 markets, against the 0.02% VIP 0 in the fee schedule. skr_usdt has takerFee 0.
- The help center says all perpetuals settle every 8 h, but the wire shows 435 contracts on 4 h and lsk_usdt on 1 h.
- Mark and index socket frames arrive about 0.92 s after their t.
  REST replies carried t 0.1 to 1.1 s old.

### OKJ

Verdict: spot only.
OKJ lists no perpetual, future, option or margin product, only 47 JPY-quoted spot pairs, so it cannot be a perpetual leg.
Its V5 public API is an OKX V5 clone that is technically clean: the books channel has a snapshot, a prevSeqId chain and a live checksum, and the existing OKX feed shape would fit it.
But there is no CCXT class, no index, mark or funding, the JPY quote meets no other venue in the quote family, and the Lv1 spot taker is 0.14% (1,400 ppm).

Blockers:

- No perpetual of any family: public/instruments returns empty data for SWAP, FUTURES and MARGIN.
- Every pair is quoted in JPY, and the engine's quote family (quoteFamily.ts lines 3 to 6) merges only USD and USDC into USDT, so an OKJ pair would meet no other venue.
- No CCXT class in 4.5.68 or on master.
  The okcoin class delisted on 2025-10-13 targeted okcoin.com.
  The okx class with hostname api.okj.com does load the 47 spot pairs, but it reports OKX fees (taker 0.0015 against OKJ's 0.0014).
- No index, mark or funding endpoint or channel, so every route would be refused as markless.
- Trading requires residence in Japan, so US persons are excluded.
- Tiny venue: about 208 million JPY of 24 h volume, CoinGecko trust score 7 and rank 62 on 2026-09-23.
  The BTC-JPY touch spread was about 1,384 ppm.

Open questions:

- API V5 was released on 2026-09-16 and, per the docs, is 'only available for upgraded accounts'.
  V3 (REST at www.okj.com/api/spot/v3, WS connect.okj.com) still answers, and no V3 retirement date was found.
- The documented idle keepalive for the books channel (an empty update with seqId equal to prevSeqId) was never observed, even when a quiet pair went 32.7 s without a frame.
- Not captured: whether the server closes a subscribed socket at 30 s when its book pushes nothing and the client sends no ping.
  The quiet books tested (QTUM-JPY, BERA-JPY) pushed at least every 15.1 s.
- What books sends for an empty side is not verified: all 47 pairs had both sides.
- Retry-After on a 50011 or 429 reply is not verified, because the probes stayed inside every limit.
  Reply headers advertise a gateway limit of 300 per second.
- Not publicly specified: whether the cap of 480 subscribe requests per connection per hour counts frames or args.

### PointPay

Verdict: blocked.
PointPay futures are a relay of Bybit's USDT linear perpetuals, not an independent venue.
All 172 symbols are Bybit's, and every instrument field tested (filters, caps, launchTime) is identical.
The REST book carries Bybit's u and seq.
The futures socket re-serves Bybit's stream with the same update ids, about 70 to 80 ms late.
Index, mark and funding equal Bybit's whenever the cache is fresh.
A PointPay leg would duplicate the Bybit leg the engine already runs, later and at an 850 ppm taker against Bybit's 550.
A PointPay against Bybit route would compare a book with itself.
On top of this, there is no CCXT class, no documented futures WebSocket, and no bulk mark.

Blockers:

- No independent liquidity: the book, socket stream, update ids, index, mark and funding are Bybit's, relayed unchanged (REST cached, WS about 70 to 80 ms behind Bybit's own socket).
- No CCXT class in 4.5.68 or in current master, so the catalog would have to be built by hand from GET /fapi/v1/public/trade/pairs.
- The futures WebSocket (wss://ws-futures.pointpay.io/v5/public/linear) is undocumented.
  It was found in the web terminal's config, and the terminal falls back to wss://stream.bybit.com.
- No bulk mark: the CoinGecko and CMC bulk replies lack mark and interval.
  The per-pair mark would need about 20 times the 500 per 60 s limit.
  REST values are cached from 6 s up to about 60 s, and the engine's arrival stamp would hide that age.

Open questions:

- Whether a PointPay futures order executes on Bybit's book at Bybit's prices (a broker or white-label arrangement) cannot be verified without an account.
- Whether US persons may trade PointPay futures is not publicly specified.
- Whether PointPay charges Bybit's settled funding rate at Bybit's settlement instant is unverified, and the instant itself was not captured.
- The Knowledge Base says 0.055% taker and 0.02% maker (Bybit's VIP 0), while the live fee schedule, the CoinGecko reply and the CMC reply all say 0.085% taker and 0.05% maker.
  The profile takes 850 ppm.
- The REST replies, including the CoinGecko and CMC feeds, report Bybit's volume, turnover and open interest divided by 100, while the WS relays the full numbers.
  The reason is unknown.
- The meaning of the pairs-list field modificator (1 on all 172 pairs) is unknown.

### CoinJar Exchange

Verdict: spot only.
CoinJar lists no perpetual or derivative of any kind, and has no CCXT class, so the connector cannot load it.
Its only market is spot: 302 products, 65 crypto bases on USDT or USDC.
It has no index, mark or funding, so every route would be refused as anchor_missing.
Even as a spot venue it is thin: the median spread of the 70 USD-family picks is about 31,000 ppm, 23 of those 70 had no volume in 24 h, CoinGecko put total venue volume at 41 BTC for 24 h, and most displayed book levels are implied rather than native.

Blockers:

- No perpetual products, so there is nothing for the engine's swap filter (connector.ts lines 196 to 203) to keep.
- No CCXT class in 4.5.68 or master, and registry.ts line 29 requires createExchange to return a ccxt.Exchange.
- No index, mark or funding, and no bulk ticker call, so no AnchorRow can be built and every route is refused as anchor_missing.
- The book feed has no sequence numbers, so a gap cannot be detected, and resync is request_snapshot or a rejoin rather than the engine's socket-terminating resync.

Open questions:

- Whether residents of the 20 supported US states may use CoinJar Exchange itself, since the Exchange intro article says verification needs Australian residence and www.coinjar.com/us/legal redirects to the global terms.
- Whether the documented three daily sessions, with auctions and a 5 s closing padding in which orders are not matched, still run: every ticker read session 72420 with transition_time null, and GET /sessions returned [] (no session boundary was captured).
- The rule behind the undocumented ticker mark_price: it matched median(bid, ask, last) on 237 and 250 of 296 products but not on every WS reading.
- Whether any upgradeable exchange plan lowers the taker below 0.06% (GET /plans is private and was not called).
- The crossed-book behaviour when two implied orders sit at the top, which the docs describe but no probe observed.

### CoinEx

Verdict: defunct.
CoinEx futures ceased on 2026-09-22 under the exchange's own cessation notice, and the whole exchange stops spot trading on 2026-09-29.
The wire agrees with the notice.
The last BTCUSDT futures trade was at 2026-09-22 03:17:52 UTC, at the index price.
All 221 books are empty over REST and WS, and index, mark and funding have been frozen since 03:10 UTC that day.
No perpetual leg can be traded.

Blockers:

- The exchange is shutting down: futures ceased on 2026-09-22 (reduce-only from 2026-09-15), spot ceases on 2026-09-29 and withdrawals end on 2026-12-22.
- All 221 futures books are empty on REST and WS.
  The anchor endpoints serve an index, mark and funding frozen since 2026-09-22 03:10 UTC, with next_funding_time in the past.
- The catalog flags hide the shutdown: status is still online and is_api_trading_available is still true.
  CCXT sets active to undefined (coinex.js line 967), so the connector's active !== false filter would still load all 221 dead contracts.
- CCXT mislabels the settle currency of all 18 USDC-margined contracts as USDT (coinex.js line 948), so it names them BTC/USDC:USDT.
- Even if the venue were live, WS frames are gzip inside binary frames and the depth channel has no sequence id, only a CRC32 checksum.
  The engine's VenueFeed would need a gunzip step and a checksum-based resync.

Open questions:

- CoinGecko's API reported a trust rank of 96 for CoinEx at probe time, while the survey tracker says 94.
- The funding-rate-history endpoint still recorded BTCUSDT settlements at -0.00375 at 2026-09-22 16:00 and 2026-09-23 00:00 UTC, after trading had stopped.
  Whether any positions were really charged was not established.
- The mark formula, its clamps and the legal entity were not researched, because the product has ceased.

### Poloniex

Verdict: fits with a named change.
CCXT 4.5.68 loads all 18 perps as active linear swaps. market.id matches the socket and REST symbols, and contractSize equals ctVal. book_lv2 fits VenueFeed as is: snapshot on subscribe, a strict lid/id chain and 20 levels.
Two changes are needed.
First, the registry must set takerPpm (600), because CCXT reports market.taker undefined for swaps, so without takerPpm the connector drops every market.
Second, the anchor poller must make one fundingRate call per contract (18) beside the two bulk index and mark calls.
That is about 20 req/s against a published 300/s.

Open questions:

- VIP 0 perp taker: the rendered fee page (unified table) says 0.0600% (600 ppm) and 0.0200% maker.
  The futures system rank table user-rank-fee, which the site fetches but does not render, says 0.05% (500 ppm) and 0.015% maker.
  Only the authenticated queryUserFeeRate would show which one is charged.
- The mark equals the contract's own last trade on about 24% of readings, and the last trade changed only 1 to 3 times a minute.
  A leg's premium may therefore read as fresh on a stale trade.
- The funding cap, the floor and the interest rate values are not published.
  The 2026-04-30 formula also defines N in two conflicting ways.
- Settlement instants on the wire are 00:00, 08:00 and 16:00 UTC, but the 2020 help article says 04:00, 12:00 and 20:00 UTC.
  The instant itself was not captured.
  With the dynamic interval, nFT minus fT right after an interval change is not verified.
- One book_lv2 update arrived before its snapshot, and its ids were not logged.
  The recommendation is to drop such updates rather than resync.
- There are only 18 perps, with 13.48M USDT total 24 h quote volume, so the venue adds little breadth to the engine.

### BitMart

Verdict: fits with a named change.
The CCXT catalog and the WS book feed fit.
The book channel sends a snapshot on subscribe and chains a strict version with 0 gaps, and sizes are in contracts that match CCXT contractSize for linear contracts.
The anchor does not fit the REST-only AnchorPoller, because no REST call returns the mark in bulk, so every route would get mark 0 and be refused.
The named change is a mark source fed by the WS futures/ticker without a symbol, alongside REST details or funding-rate-v2 for index and funding.
A marketFilter is also required: m.quote === 'USDT' with a nonzero 24 h volume.
It drops the 4 coin-M contracts that CCXT mislabels as linear with settle USDT and contractSize 100 or 10 (USD), the BTCUSDC duplicate, and the 259 dead Trading contracts.
Registry values should be takerPpm 600 and ccxtTakerPpm 4000.
One caveat: every book channel updates only once a second.

Blockers:

- No bulk REST mark: the REST-only AnchorPoller would give mark 0 and every BitMart route would be refused at open.
  The mark has to come from the WS futures/ticker without a symbol.
- Every public book channel (depthIncrease, depthAll, depth, bookticker) pushes once a second whatever @100ms or @200ms asks for, so a BitMart leg can be up to about 1 s old.
- CCXT 4.5.68 hardcodes linear true and settle USDT (bitmart.js lines 1145 and 1117), so the coin-M BTCUSD would be read as 100 BTC per contract unless a marketFilter drops quote USD.
- US persons may not trade: no US registrations since May 2022, and US accounts were wound down by 2026-08-08.

Open questions:

- Whether the last expected_rate before a settlement equals the rate then written to funding-rate-history (no settlement instant was captured).
- Whether the 1 s book cadence is universal or only for unauthenticated sockets or this IP.
- The index basket composition and weights: no basket endpoint exists, the help article's source list is outdated, and whether any basket references BitMart's own market is unknown.
- The fee page futures tab shows maker 0.04 % to a signed-out visitor, while its tier data and the VIP guide show 0.02 %.
  The taker is 0.06 % everywhere.
- Whether the 25 % BMX fee deduction applies to perpetuals.
- Why 259 contracts read Trading with zero volume, and why 127 of them still carry a delist_time of 2026-07-25.
- The exact subscribe frame size cap: 2,020 bytes was accepted and 2,186 was closed with 1009, while the docs say 4,096.
- Whether the server closes a socket that does not answer its protocol ping, which came about 54.4 s after open.
  The ws library always answered it, and the documented 5 s and 20 s idle closes never happened in 75 s.
- ANTHROPICUSDT is a live synthetic pre-listing contract about 3 % from OKX's scaled price, a candidate for DENIED_PAIRS.

### CoinDCX

Verdict: blocked.
Every CoinDCX perpetual is a brokered relay of a Binance USD-M perpetual.
The terms say futures orders are placed with third-party exchanges.
On the wire, mark, efr and fr equal Binance's on all 504 pairs, and each book update carries a Binance diff event's E.
So as a leg it would duplicate Binance, 130 ms to 2 s late, at a 590 ppm taker.
It also has no CCXT class, a Socket.IO-only socket, no index or next funding in its anchor, and only Indian residents may trade.

Blockers:

- Books, marks and funding are Binance USD-M's, relayed: a cross against Binance would come from relay latency, and against other venues it adds nothing Binance does not already give.
- No CCXT class in 4.5.68 or master, so the catalog would need a custom loader from active_instruments plus 504 per-pair detail calls.
- WebSocket is Socket.IO v4 only: Engine.IO framing, a double-encoded data string, and book frames keyed by the Binance spelling (BTCUSDT) rather than the pair id (B-BTC_USDT).
- The anchor reply has no index (the engine divides by the index at anchorReading.ts line 58) and no next funding time.
- Only Indian citizens or residents may trade (terms clause 11.1), so US persons are excluded.
- Unknown pairs fail silently: the REST instrument call returns B-LAB_USDT with 200, and WS joins get no reply.

Open questions:

- VIP tier table: coindcx.com/fees refuses this host, so tiers below VIP 0 are Not verified.
- Whether the USDT-margin VIP 0 fee equals the INR-margin standard 0.02%/0.05% (the API shows 0.0236/0.059, read as including 18% GST).
- Unit of the liquidation_fee field (1 or 1.5).
- Meaning of the skw, ctRT and cmRT fields and of spot ecode G.
- Binance is inferred from the wire as the third-party exchange.
  No CoinDCX document names it.
- The funding settlement instant was not captured, and fr lagged the 04:00 UTC settlement by up to about 4 minutes.
- Whether INR Global Futures (stock and index perps) have any public market data.

### BigONE

Verdict: fits with a named change.
The CCXT catalog maps cleanly: market.id equals the socket and anchor symbol, and contractSize equals multiplier on 99 of 99 markets.
The depth socket gives a snapshot plus a strict per-stream id chain that rebuilt the venue's book exactly.
One bulk call carries index, mark, rate and next settlement.
Five changes are needed.
(1) A feed with one EndpointPlan and one socket per market with no subscribe frames, routed by the connection because the snapshot has no symbol, using the chain rule from===previous to.
(2) Registry takerPpm 600, because CCXT 4.5.68 leaves market.taker undefined and the connector would skip all 99 markets.
(3) A derived fundingIntervalHours.
(4) A linear-only marketFilter.
(5) A DENIED_PAIRS review of the pre-IPO and stock tickers.
This rests on the unverified question below: whether the venue accepts about 97 anonymous sockets against its documented 5 connections per user.

Blockers:

- The docs publish 'WebSocket Connections: 5 connections per user', and the contract book socket serves one symbol per connection, so covering the 97 linear perpetuals needs about 97 sockets.
  No probe went past 4 open sockets, to stay inside the published limit.
  If the cap applies to anonymous IPs, no public path serves the whole catalog: the undocumented v3 socket answered no book topic, and polling 97 REST books a second is 970 requests per 10 s against the 500 limit.

Open questions:

- Does BigONE accept about 97 concurrent anonymous depth sockets from one IP?
  This needs a user-approved probe or an answer from BigONE.
- Is fundingRate the rate charged at nextFundingTime?
  It is inferred from its not changing over 180 polls and from the mark formula, and was not confirmed across a settlement.
- The documented 8 h schedule is 02:00, 10:00 and 18:00 UTC, but the wire showed the next settlement at 08:00 UTC for 98 contracts, implying 00:00, 08:00 and 16:00.
- The mark is index plus funding basis only, which is the capped-mark shape the design warns reads a leg as fresh.
  The index republishes every 5 s, so one step may exceed the 1,000 ppm per poll guard.
  The design must decide how BigONE legs are judged.
- Index baskets are unpublished, so the self-index screen cannot be run.
- Half the catalog is stock, metal and commodity perps, including pre-IPO names (OPENAI, SPCX, ZHIPU, UNITREE, CXMT, SKHY) and small tokens (A, RE, ARX, PONS, HAJIMI, NIULAI).
  These need a DENIED_PAIRS review before activation.
- The Restricted Locations list referenced by the Eurasia agreement was not found, so region exclusions beyond the US are unknown.
- The fundingIntervalHours source: the announcement table is already incomplete (5 contracts found at 4 h that it does not list), so the poller should learn the interval from the nextFundingTime step.

### WOO X

Verdict: fits with a named change.
The CCXT catalog fits as is: market.id PERP_BTC_USDT matches the socket and anchor symbols on 223 of 223, contractSize 1 matches base-coin sizes, and the class is linear.
The anchor fits with two bulk calls a second (futures plus fundingRate).
The book feed needs a named change: orderbookupdate sends no snapshot on subscribe, so each symbol must be seeded from REST and chained by prevTs, which no current VenueFeed does.
It also needs a fallback for a REST snapshot that lags the socket, which happened on BTC in both runs.
Technical fit is not the main problem.
Nearly all WOO X liquidity is RPI (retail-only) and an API taker cannot hit it.
The non-RPI book spread was 3,652 to 6,140 ppm on BTC and ETH and 22,267 ppm on SOL, against 11 to 84 ppm with RPI.
It sat unchanged for tens of seconds, and 94 of the 100 busiest perps sent no book frame in 60 s.
So as a leg, WOO X adds wide, stale quotes and little real edge.

Blockers:

- RPI: RPI orders match only GUI and copy-trading orders, so an API taker sees only the non-RPI book.
  That book was 3,652 to 6,140 ppm wide on BTC and ETH, 22,267 ppm on SOL and 203,177 ppm on TAO.
  It barely changes: 94 of the 100 busiest perps sent no frame in 60 s, TAO's REST book was last changed 4.8 h earlier, and 0G's on 2026-08-29.
- No snapshot on subscribe.
  The feed needs a REST seed per symbol at 10 requests per second.
  The documented prevTs alignment failed on BTC in both runs because the REST book lagged the socket by up to 46.6 s.
- Mark is pinned to the index when liquidity is below the impact notional (53 to 90 of 223 perps per poll).
  The fresh gate would read such a leg as fresh.
- Access: US and Canadian residents are excluded from all services, so the operator cannot legally trade it from the US.
- PERP_EWT_USDT is not Energy Web Token (index about 114.6), so it needs a DENIED_PAIRS line.
  SOLV has a null index and EWT funding has been frozen since 2026-09-22 02:17 UTC while still TRADING.

Open questions:

- Why the BTC REST orderbook timestamp trails the socket prevTs chain, by up to 46.6 s, while ETH and SOL align.
  Is there a documented way to get a REST snapshot that matches the chain?
- Whether the mark's liquidity-below-impact-notional rule measures the book with or without RPI orders.
- The funding term that puts 188 to 190 of 223 rates exactly on 0.0001×N/8 is not in the published formula.
  The three perps whose floor equals the cap (+0.02) publish rates far below it.
- Whether a My WOO tier needs WOO holdings and 30-day volume together or either one.
- The index rule for three or more valid exchanges is not stated.
  The component table (2025-03-04) has no rows for EWT, SNDK, GRAM or SOLV.
- Retry-After and the 429 shape on v3 were not observed, because the probes stayed under the 10 per second limit.
- The funding settlement instant was not captured.
  Behaviour comes from fundingRateHistory only.

### Delta Exchange

Verdict: fits with a named change.
The CCXT catalog works: 6 active linear USDT swaps whose ids match the socket and REST symbols exactly, and contractSize is right. ob_updates is a clean book feed (snapshot, seq chain, CRC32).
The anchor poller needs these changes:
- Divide the ticker funding_rate by 100.
- Take the interval from /v2/products product_specs.rate_exchange_interval.
- Compute nextFundingAt on the interval grid.
- Add a nonce to skip the 2 s edge cache.
- Treat readings as up to about 3 s stale, because the origin republishes every 2.5 to 3.2 s.
The registry needs takerPpm 300 with ignoreCcxtTakerPpm true.
CCXT market.taker is the web (non-API) rate, 100 ppm on BTC and ETH, while API orders pay 300 ppm (PAXG is 200 in the catalog).
The venue adds little: 6 majors only, and XRP and DOGE showed 0 USD of 24 h turnover.

Blockers:

- US persons and residents of Canada (this host's VPN exit), India, UK, most EU and UAE may not trade on global, per global.delta.exchange/terms-of-use.
- Only 6 perpetuals, all majors listed everywhere. 24 h turnover was 4.9M USD ETH, 1.5M BTC, 117k SOL, 585 PAXG, 0 XRP and 0 DOGE.
- The anchor reply is a snapshot republished every 2.5 to 3.2 s, and CloudFront serves 31 to 40 of 60 one-second polls from a 2 s cache unless a nonce is added.
  The reading's own timestamp was 0.6 to 5.5 s old on arrival.
- The mark is the index plus a 60 s moving-average fair basis, capped at 1% on BTC and ETH, so the fresh gate would read a lagging premium that can saturate.

Open questions:

- Which rate is charged at a settlement?
  The guide text says the average over the preceding 8 h, which matches the published running estimate.
  The guide's worked example charges the previous interval's rate, which matches the FUNDING: history value.
  No settlement instant was captured.
- Wss://public-socket.delta.exchange with compact channel names works on global but is documented only for India.
  Will global follow India's plan to remove legacy public channels from socket.*?
- What exactly is the ticker field mark_basis?
  It matched mark/spot−1 on 4 of 6 rows in one poll and on 0 of 6 in another.
- PAXGUSDT fee: the catalog says 0.02% (API and non-API), but the fee page's USDT linear row says 0.03%.
- How does Delta tell API orders from web orders, and do DETO, Delta Cash or referral discounts apply to API orders?
  The discount percentages are template placeholders and are not published.
- Do CloudFront cache hits count against the 10,000 per 5 minute public weight quota?
- The user guide is now titled 'Faida - User Guide & Rule Book'.
  Is the global platform being rebranded?
- The global docs host docs-global.delta.exchange is NXDOMAIN, so the Wayback capture from 2026-01-30 is the latest global API doc.

### CoinUp.io

Verdict: blocked.
Every CoinUp REST and WebSocket host, including futuresopenapi.coinup.io and futuresws.coinup.io, answers this host with a Cloudflare managed challenge (HTTP 403, cf-mitigated: challenge), so no catalog, book or anchor could be read.
CCXT has no class in 4.5.68 or on master.
Even with access, the ChainUp-shaped API has no bulk anchor.
The engine also treats 403 as a rate limit, so a poller would pause forever.

Blockers:

- Cloudflare managed challenge (HTTP 403, cf-mitigated: challenge) on every coinup.io host, covering REST, WebSocket, website and API docs.
  Signs point to a site-wide block rather than one aimed at the Canadian VPN exit (WebFetch also got 403, and Wayback shows challenge captures since 2025-06-28), but no other network was tested.
- No CCXT class in 4.5.68 or CCXT master, and the registry builds every venue on a CCXT class (server/src/venues/registry.ts line 29).
- No readable API documentation: www.coinup.io/en_US/cms/apidoc and doc.coinup.io are behind the same challenge.
- If the venue runs the ChainUp API shape, which is inferred from its E-BTC-USDT ids and futuresopenapi host, index and mark come one contract per call, so no bulk anchor exists.
- The engine treats 403 as a rate limit (server/src/shared/errors.ts line 1), so an anchor poller would pause and retry indefinitely against the challenge.

Open questions:

- Is the Cloudflare challenge site-wide for every non-browser client, or tied to IP reputation?
  It was not tested from any network other than the Canadian VPN exit.
- Legal entity, restricted countries list, and whether US persons may trade: the user agreement is unreadable.
- VIP tier table: the fee schedule at www.coinup.io/en_US/cms/fee is unreadable.
  The 0.06% taker and 0.02% maker come from a help article that names no tier.
- Current funding interval, cap and index basket: the only source is a 2024 guide that still lists FTX.
- Does CoinUp's API actually match the ChainUp fapi/v1 and kline-api shape?
  That is inferred, not observed.
- Does a coin-margined perpetual family still exist?
  It is documented in 2024 and absent from CoinGecko.
- CoinGecko reports $7.2B of 24 h volume on E-BTC-USDT but open interest of 0.
  Nobody has checked how much real liquidity the venue has.

### HitBTC

Verdict: fits with a named change.
All three parts exist.
There is a CCXT catalog with market.id equal to the socket and anchor key, a full-book socket with a snapshot and a strict s+1 chain, and a one-call REST anchor.
The named change is a registry marketFilter (m) => m.info.status === 'working'.
CCXT hard-codes active true at hitbtc.js line 873, so without the filter it loads 5 suspended or expired contracts that have empty books and mark 0.
The poller also hard-codes fundingIntervalHours 8.
Caveats that do not block: the mark is the index plus the prorated funding rate, which is a funding-capped premium, so a HitBTC book sitting off its index reads as fresh edge.
The anchor republishes only every 3 s. 29 of 50 perps showed zero 24 h volume, and total perp volume is about 21 M USDT a day.

Open questions:

- Is funding_rate charged at next_funding_time (upcoming) or at the last settlement?
  The bulk-call doc says 'paid in the previous funding period' and the per-contract doc says 'paid after the end of current funding interval'.
  The mark formula and the help article favour upcoming.
  Settling it needs an account statement or a capture across a settlement, and none was taken.
- Index basket weights per contract are not public.
  HITUSDT_PERP's index is HitBTC's own spot last price, and CELUSDT_PERP's index is frozen at 0.0060 against spot 0.002115.
  Which other contracts depend on HitBTC alone is unknown.
- CoinGecko shows 48 perpetual pairs and the catalog lists 50 working.
  The difference was not reconciled.
- The fee tier table's volume column header says BTC while its rows say USDT.
  It is also unknown whether futures volume pools with spot, and whether the HIT holding discount applies to futures at all.
- Connection lifetime beyond 75 s, 429 behaviour and Retry-After on REST, and the WS rate limit of 10/s plus a burst of 10 were not tested.
- Socket budget: about 6.3 min of wall time holding sockets, but about 11 socket-minutes, because the silence test ran three 75 s sockets in each of two runs.

### BTCBOX

Verdict: spot only.
BTCBOX is a Japanese spot-only venue with no perpetual, future, option or margin product.
Evidence: CCXT has swap, future and margin all false, the fee page and company profile show an exchange licence only, and none of CoinGecko's 214 derivatives exchanges is BTCBOX.
It has 4 tradable order-book markets, all quoted in JPY (BTC, BCH, ETH, LTC).
It also has no WebSocket and no index, mark or funding.
Published VIP 0 spot fees are flat with no tiers: BTC/JPY 0.05% maker and taker (500 ppm), and BCH, ETH and LTC 0.10% (1,000 ppm).
CCXT 4.5.68 reports 0.001 on every market because line 260 compares the lowercase id to 'BTC'.

Blockers:

- No perpetual product of any kind, so the connector's active-swap filter (server/src/ccxt/connector.ts lines 199 to 201) drops every market.
- No WebSocket, public or private.
  The engine's VenueFeed is WebSocket only.
- No index, mark or funding, so no anchor poller is possible.
- Every market is quoted in JPY, outside the USD/USDC/USDT quote family (server/src/engine/cluster/quoteFamily.ts lines 3 to 6).
- US persons are barred by terms Article 2, and an account in practice needs a Japanese bank account.
- Very thin book: BTC/JPY has 4 levels per side, a touch size of 0.0015 to 0.0025 BTC, and a 24 h volume of about 1.31 BTC.

Open questions:

- The English fee page that CCXT cites (support.btcbox.co.jp) returned 403 to curl and to WebFetch, so the fees come from the Japanese blog page blog.btcbox.jp/fees-introduction-3 only.
- The public request limit is unpublished.
  The docs say public calls have no cap but BTCBOX may restrict abusive clients.
  Error 402 means 'Request is too frequent'.
  A burst of 10 sequential calls got all HTTP 200.
- S3 says the fee rate may be changed for some customers, with no criterion given.
- The web /ajax/coin/depth call omitted the farthest BTC ask (+5%) that /api/v1/depth returned.
  Why is unknown.
- CCXT fee bug: the btcbox.js line 260 comparison id === 'BTC' never matches the lowercase id, so BTC/JPY taker reads 1,000 ppm against the published 500 ppm.
  It could be reported upstream.

### Aivora Exchange

Verdict: fits with a named change.
The book socket fits: one public URL for both families, whole 30-level windows that need no sequence handling, and 77 streams on one connection.
The venue cannot join in its current shape for two reasons.
CCXT has no class, so the catalog needs a loader that reads /contracts (rawMarketId E-BTC-USDT, contractSize = multiplier, active = status 1) plus a subSymbol map for the socket.
There is no bulk anchor call, so fetchRound must fan out 77 /index calls, which fits inside AnchorPoller's one-round-per-tick loop, and add the web public_info_v2 call for interval and next settlement.
Caveats: the mark is usually Aivora's own last trade and is pinned to the index on 21 to 22 contracts, which weakens the fresh gate.
The book refreshes every 400 ms or slower.
The funding rate comes from an unnamed third party.
US persons may not trade.

Blockers:

- No CCXT class in 4.5.68 or current master: a catalog loader outside CCXT is required.
- No bulk anchor call: 77 per-contract GET /index calls per round (about 0.4 s each, sequential round 29 to 32 s) with no published rate limit, and funding interval and next settlement only from the undocumented web call public_info_v2.
- Mark (tagPrice) usually equals Aivora's own last trade (29 to 53 of 60 polls) and equals the index exactly on 21 to 22 of 77 contracts, so a fresh-gate premium read from it is weak or blind.
- US, UK and Canadian persons may not trade Aivora futures.

Open questions:

- Which rate is charged at the next settlement: REST currentFundRate (equal to the socket's last_fund_rate_third, source 'third') or nextFundRate?
  The settlement instant was not captured, and no public funding history call exists.
- Which third party supplies currentFundRate?
  BTC read -0.00001 while Binance, OKX, Bybit, Gate and HTX were at 0.0000173 to 0.0000758.
- Funding cap and floor numbers, and any mark clamp, are not published.
- Public REST rate limits are per IP but not stated for any futures endpoint.
  Is a fan-out of about 10 concurrent /index calls every 2 s safe?
- The BTC book holds 46,000 to 69,000 contracts (5 to 7 BTC) on every tick across 30 levels.
  Is that mirrored liquidity or resting orders?
- The index basket is published only for BTCUSDT and ETHUSDT, and only in a white-label help center that names no exchange.
  What are the baskets for other contracts and the TradFi perps, whose mark equals the index while their market is closed?
- The docs promise gzip binary frames, but the wire sent text.
  Could a future change switch to binary?
- The REST depth caps at 30 levels despite the documented max of 100.
- Does the platform token fee discount (platformRate 0.4, platformOpen 0) ever switch on?

### Bitbaby

Verdict: no public API.
Bitbaby's only API documentation link, https://docs.bitbaby.com/en/, returns 404 on every path.
It returned 404 from this host, through WebFetch and in the Wayback Machine, and the ChainUp-style openapi host and the configured open_api_url also return 404.
CCXT 4.5.68 and CCXT master have no class.
What works is the website's private backend: POST calls on web-api.bitbaby.com and its market socket.
That backend has a usable 40-level full-book channel, but it is undocumented, has no bulk anchor call, and can change without notice.
That is the same standing that gave KCEX, Coinstore and BitKan their no public API verdict.

Blockers:

- No documented public API: docs.bitbaby.com/en/ answers 404, openapi.bitbaby.com answers 404, and the configured open_api_url www.bitbaby.com/en-us/exchange-open-api answers 404.
- No CCXT class in 4.5.68 or in master (commit 1d8b674, 2026-09-22), so the engine's catalog path cannot load it without a custom loader.
- No bulk anchor call: public_market_info takes one contractId per request, and interval and next settlement exist only in the 358 KB catalog.
- The socket ticker as an anchor leaves 180 to 197 of 358 contracts older than the reader's 10 s limit, and the engine has no socket-fed anchor.
- The BTC REST mark (tagPrice) equals the index on every poll, so a poller would read a zero BTC premium.
- The site classifies this host's Canadian VPN exit as a US address and says it does not serve that region.

Open questions:

- Which rate is charged at settlement: currentFundRate (third-party, tracks Binance lastFundingRate) or nextFundRate (differed from it on every poll)?
  No funding history endpoint was found, and the settlement instant was not captured.
- What funding_rate_last on the socket means.
  It read 0.00008 on BTC, while Binance's last settled BTC rate was 0.00001021.
- The size unit of E-CHIP-USDT, the one contract whose multiplierCoin is USDT rather than its base.
- What the depth channel sends for an empty or one-sided book.
  None was seen.
- Why Bitbaby's index sat up to 1,566 ppm away from Binance's index (ETH), when the help center says BTC and ETH use a one-third OKX, Huobi and Binance basket.
  Baskets for the other contracts are unpublished.
- The unit of the VIP volume thresholds (USD or USDT), since the reply prints only numbers.

### BTCC

Verdict: no public API.
BTCC has perpetuals but no public market data API.
Its only market data API docs are a Nov 2023 OpenAPI whose calls need an account token and md5 signature, and whose quote socket needs an account number and a registered key.
Both documented hosts fail from here, and the current API guide is not public.
CCXT has no class.
Market data an anonymous client can reach comes only from undocumented web client endpoints.
Depth there is 7 levels, one contract per socket, with no sequence number.
There is no index or mark at all, so every BTCC route would be refused at open.

Blockers:

- No CCXT class in 4.5.68 or on master, so there is no catalog, market.id or contractSize.
- No public market data API.
  The OpenAPI (Nov 2023 PDF attached to CCXT issue 22623) needs an account login and a key.
  The current API guide article returns 404 to anonymous readers.
- Documented OpenAPI hosts fail from this host: api1.btloginc.com:9081 times out, and kapi1.btloginc.com:9082 fails its certificate check and returns 404 on the documented path.
- The book is 7 levels per side, below the engine's 20.
  It is a full snapshot every frame with no sequence number, and one depth contract per socket (346 sockets for USDT-M alone).
- There is no index price and no mark price.
  Liquidation uses the platform's two-way quotes, so the anchor reader refuses every BTCC route at open.
- Funding is available only per symbol, from an undocumented web POST, with no bulk call and no next-settlement field.

Open questions:

- The unit of getFundrate `fundrate` is inferred as 1e-6: CHZUSDT read 100 against a settled +0.0100%.
  The inference is unconfirmed, as is whether the value is the estimate for the next settlement.
- Size unit and contract_size of current contracts are not verified, because the product list needs a login token.
  The sizes read as coins.
- Whether US persons may trade is not publicly specified.
  A 2024 CCXT issue requester says BTCC allows US futures trading.
- Whether the current API guide (help article 53597049859737) documents a different, working host is unknown, because the article is not public.
- A 2025-12-02 user report in CCXT issue 22623 says futures API keys are read-only.
  This is unverified.
- The funding clamp bounds a and b are not published.
- The end date of the TradFi zero-fee promotion was not read.

### FameEX

Verdict: fits with a named change.
A public book and an anchor both exist, but three parts need changes.
First, a hand-written catalog from /fapi/v1/contracts replaces the missing CCXT class.
Second, the book feed has to gunzip each binary frame and resetBook on every 500 ms full snapshot, with no sequence to detect loss.
Third, the anchor poller has to call /index once per contract (213 calls per round against an unpublished limit) and take the interval from the undocumented contract_config.

Blockers:

- No CCXT class in 4.5.68 or master, so the connector's loadMarkets catalog has nothing to load and a hand-written catalog is needed.
- No bulk anchor call: index, mark and funding come one contract per /fapi/v1/index call, 213 calls for a full round, and futures market data has no published rate limit.
- Funding interval exists only in the undocumented /v1/inner/contract_config, and next settlement must be computed.
- Book frames are gzip inside binary WS frames, full snapshots every 500 ms with no sequence, which is a freshness limit of up to 500 ms per leg.
- US persons and Canada are restricted areas in the Terms.

Open questions:

- The funding formula, the rate cap and who pays whom are unpublished.
  Is nextFundRate the rate for the upcoming settlement? currentFundRate matched the last settled rate on only 145 of 213 contracts.
- What do capitalPremiumMin/Max ±0.0005 and priceRange mean?
- What is the index basket and formula?
  The BTC index sat flat for at least 21 s while the last price moved.
- What sustained per-IP rate is allowed on /fapi/v1/index, and does a 429 carry Retry-After?
- What is one contract worth in base for the six contracts whose multiplierCoin is USDT (BSB, BABA, PTB, MEITUAN, KUAISHOU, LGELECTRONICS)?
  KUAISHOU index and last differ by about 88,000 ppm.
- Does the 2023 help article's 'trading suspended during settlement' still apply?
  The settlement instant was not captured.
- In one run REST best bid sat 11.7 USD below the socket 53 ms apart.
  Is that a fast market or a lagging REST book?

### Globe

Verdict: fits with a named change.
The WS depth feed (whole 25-level book every 100 ms, one socket for all 28 perps at 280 frames/s) and a bulk REST anchor (index, mark, funding, next settlement in one call) both fit the engine.
But no CCXT class exists in 4.5.68 or master, and VenueRegistration.createExchange must return a ccxt.Exchange (server/src/venues/registry.ts line 29).
So Globe needs a catalog loaded from /api/v1/ticker/contracts outside CCXT.
It also needs contractSize pinned to 1, funding_rate divided by 100, and a 2 s poll.

Blockers:

- No CCXT class in 4.5.68 or CCXT master: the catalog path (loadMarkets via createExchange) cannot load Globe without a non-CCXT market loader or a small ccxt.Exchange subclass reading /api/v1/ticker/contracts.
- Published REST limit is 1 request per second, so the AnchorPoller default 1 s cadence sits exactly on the limit.
  Poll at 2 s.
- Mark premium is capped by inserted book levels at index ±2%, ±5.75% or ±10%, the capped-mark shape that reads a saturated leg as fresh.

Open questions:

- The funding schedule disagrees: the help article says 00:00, 08:00 and 16:00 UTC, but next_funding_time read 12:00 UTC at 04:20 to 04:38 UTC with an 8 h period, which implies 04:00, 12:00 and 20:00.
  The settlement instant was not captured.
- Is funding_rate the upcoming or the last settled rate?
  XTZ-PERP moved from -0.0733% to -0.07% 38 minutes after a settlement, which suggests a running value, but that rests on one change.
  No public funding history endpoint is documented.
- The index basket and weights per instrument are not public, and the help article's exchange list still names FTX.
- The HTTP status code and Retry-After of a REST rate-limit refusal are unknown.
  This was not tested because the probe stayed under 1 request per second.
- Why the books carry dust at the touch (median 2 to 16 USD) with about 0.1 BTC per level from the third level on, and whether they are market-maker books only.
- The docs say depth updates twice a second, but the wire sends every 100 ms.
  It is unknown whether this will stay.

### Orbix

Verdict: spot only.
Orbix is a Thai, THB-only spot exchange.
It has no perpetual, index, mark or funding, and it has no CCXT class in 4.5.68 or in master.
Its 111 pairs all quote THB, which the engine's quote family (quoteFamily.ts lines 3 to 6) does not merge with USDT, so no pair would share a cluster.
Its public spot WebSocket and REST work from this host.

Blockers:

- No perpetuals or any derivative product, so there is no perpetual leg and no anchor.
- No CCXT class in 4.5.68 or on CCXT master, so the engine's loadMarkets catalog (connector.ts lines 68 and 79) cannot load it.
- All 111 pairs quote THB, which is outside the USDT, USDC and USD quote family, so no Orbix pair clusters with other venues.
- Trading is open only to residents of Thailand with a Thai bank account and phone number, and configs report foreigner KYC as closed.
- Liquidity is very thin: 18 of 104 trading pairs traded in 24 h (about 10.4 M THB, roughly 315k USDT), and 45 books are empty, 11 bid-only and 12 ask-only.

Open questions:

- Whether a socket that receives book frames but never writes is also closed at about 60 s.
  The probe only saw this on silent sockets, and every busy socket was closed by the probe at about 61 s.
- The exact inbound frame limit: 2,030 bytes was accepted and 2,211 bytes was closed with 1009.
  It may be 2,048 bytes.
- Whether a spot tier or VIP table exists.
  The trading rule page is rendered from a CMS this host did not read, the public /api/trading-fees/ call returns only maker 0.25 and taker 0.25, and the per-account /api/fees/?pair= needs auth.
- Whether the brokerage product that the web app names (default pair BTC_USDT) has any public API.
  Its REST and WS paths return 404.
- What kyc.foreigner_use_version "closed" means exactly.
  This profile reads it as foreign onboarding being closed, which is an inference.

### Catex

Verdict: spot only.
Catex lists no perpetuals of any kind, and CCXT has no Catex class.
The engine's catalog keeps only active CCXT swaps, so Catex cannot be a perpetual leg.
Even as spot it would need a custom STOMP feed with no snapshot, no sequence and 16 levels per side, below the engine's 20.
It also publishes no anchor data.
The flat spot fee is 0.1% maker and taker (1000 ppm), or 700 ppm when paid in CATT.

Blockers:

- No perpetual product of any family, so there is nothing for the swap-only catalog (server/src/ccxt/connector.ts lines 196 to 203) to load.
- No CCXT class in 4.5.68 or in master.
- No index, mark or funding endpoint, so no AnchorRow can be built.
- The WebSocket book has no snapshot on subscribe, no sequence and no timestamp.
  Each side arrives separately with at most 16 levels.
  A quiet side sends nothing, so staleness cannot be detected.
- Canada and the US are restricted locations in the Terms.

Open questions:

- The real REST rate limit is unknown: none is published, and the probe never sent more than three requests in one second.
- What the order topic sends when a side becomes empty was not verified.
- Whether the CATT 30 percent fee discount and the transaction-mining and dividend programmes still run today was not verified without an account.
- Most reported volume is on MPRA/WMPRA/RPWMPRA/MFUND/MPRD pairs with spreads of 1.4 to 2.0 million ppm (MPRA bid 12,005,580 vs ask 4,449,239,221), and CoinGecko counts 75.5M USD of it for MPRA/USDT.
  Whether that volume is genuine was not examined.
- Whether an account from a restricted location is refused at signup was not tested, since no account was opened.

### BTCMarkets

Verdict: spot only.
BTC Markets lists no perpetual, future, option or margin product.
CCXT 4.5.68 loads 51 spot markets and 0 swaps, so the connector's active-swap filter (connector.ts lines 196 to 202) drops the whole venue.
The venue publishes no index, mark or funding for an anchor poller.
Its spot book socket is clean and would suit a later spot-leg design.

Blockers:

- No perpetuals: all 51 markets are spot, and CCXT reports swap false and 0 swaps, so the connector skips the venue.
- No index, mark or funding exists, so there is nothing for the anchor poller or the fresh gate.
- Only 4 markets (AUDM-USDT, BTC-USDT, ETH-USDT, XRP-USDT) are in the engine's USD/USDC/USDT quote family.
  The other 47 are AUD or BTC quoted, and BTC-USDT is thin (26 bids, 10 asks).
- Trading is limited to Australian residents unless BTC Markets approves an overseas user at its discretion.
- VIP 0 spot fee is 0.85 % (8,500 ppm) for maker and taker alike on AUD and USDT pairs.

Open questions:

- The v3 API docs (docs.btcmarkets.net/v3) could not be read because of the Cloudflare challenge, so the documented REST rate limits and the v3 WebSocket channel docs are unknown.
  The profile uses the 2022 GitHub wiki (WebSocket v2) and the ngin-io checksum repo instead.
- The status code, body and Retry-After of a REST or WebSocket rate-limit refusal were not provoked and are unverified.
  The headers show 150, 300 and 100 per call with resets of 10 s or less, and 20 on the WS upgrade.
  The wiki documents 3 new connections per 10 s per IP.
- The fee schedule is from the Internet Archive copy of 2025-12-05, because the live page returns 403.
  It matches CCXT's AUD 0.0085, but a change after December 2025 cannot be ruled out.
- CCXT gives USDT markets 0.002/-0.0005 (the flat BTC-pair rate), while the fee page puts USDT pairs on the 0.85 % tiered schedule.
  A registry override would be needed if spot legs are ever admitted.
- Referral discounts and Liquidity Provider fee terms are not published or could not be read.

### Mercado Bitcoin

Verdict: spot only.
Mercado Bitcoin lists no perpetual, dated future, option or margin product.
CCXT has swap false at mercado.js line 30 and returns 1,451 spot BRL markets.
The v4 catalog holds only CRYPTO, DIGITAL_ASSET, DIGITAL_VARIABLE_INCOME and UTILITY_TOKEN rows.
So the connector's active-swap filter keeps nothing.
Its markets are quoted in BRL, which the quote family does not join to USDT.
It has no index or mark for an anchor.
Its WebSocket gives full top-N books but no snapshot on subscribe.

Blockers:

- No perpetual of any family: CCXT 'swap': false at server/node_modules/ccxt/js/src/mercado.js line 30, and 0 of 1,451 CCXT markets are swaps.
- Every CCXT market is quoted in BRL, and QUOTE_FAMILY in server/src/engine/cluster/quoteFamily.ts lines 3 to 6 joins only USD and USDC to USDT.
- No index, mark or funding exists, so any route would be refused with anchor_no_mark.
- The WebSocket orderbook sends no snapshot on subscribe, and REST seeding is limited to 1 request per second per public endpoint.

Open questions:

- The fee schedule (VIP 0 maker 0.30 %, taker 0.70 %) comes from an Internet Archive capture of 2026-07-27, because the live fee page returns 403 to this host and to WebFetch.
  The current schedule is unconfirmed, though it matches the CCXT constants and the API doc example.
- It is not known what resets the 60 s WebSocket idle close (the docs say 5 s).
  No socket that sent client pings was held past 60 s.
- The HTTP status code and any Retry-After on a REST rate-limit refusal were not provoked, and none is documented.
- The docs do not say whether a US person holding a CPF and a Brazilian address may open an account.

### Coinzoom

Verdict: spot only.
CoinZoom lists no perpetual, dated future or option.
GET /instruments returns 73 pairs (40 USD, 33 USDT), every one with instrumentType SPOT, and CoinGecko's derivatives API returns 404 for it.
It therefore cannot join the engine as a perpetual leg.
There is also no CCXT class for a catalog and no index, mark or funding for an anchor.
Its spot book feed works, but it carries no sequence and no checksum.

Blockers:

- No perpetuals: all 73 instruments are instrumentType SPOT, the site and help centre list no derivatives, and CoinGecko derivatives returns 404.
- No CCXT class in 4.5.68 (104 ids) or in current master ts/src.
  The only CCXT trace is issue 8672, 'New Exchange: CoinZoom' (2021, closed).
  So the CCXT swap-based catalog in connector.ts cannot load it.
- No index, mark or funding, so no anchor poller is possible.
- Book feed has no sequence number, update id or checksum, so a dropped frame cannot be detected.
- The docs warn that repeated socket opens and closes may trigger an automatic IP ban, and they cap the streaming API at 30 requests per minute.
  With one subscribe frame per pair, 73 pairs take about 3 minutes to subscribe.
- Its own help centre excludes Canada and the UK, and New York residents cannot sign up.

Open questions:

- The Diamond ZOOM discount is 30 % on the fees page but 35 % in the help article.
- Does the 'Streaming Websocket API: 30 RPM' cap count subscribe frames per connection or per IP, and what happens above it?
  Only 24 per minute was tried.
- How many socket opens trigger the documented automatic IP ban? 16 opens in 25 minutes were not refused.
- BTC/USD and ETH/USD report supportsLeverage true with maxLeverage 5, and five currencies are marked canBeCollateral, yet no margin product, fee or rule is documented.
- The 0.60 % Pro taker is the top of the published 0.30 to 0.60 % range, and the assets endpoint confirms it with taker_fee 0.6.
  It was not confirmed by a trade.
- The Market Watch docs call marketwatch/summary a POST, but POST returns 405 and GET works.
- Can the level 3 book window of 100 orders per side hide depth on thin pairs where one market maker holds more than 100 resting orders?
  It did not matter for the top 20 levels on BTC/USD.

### Foxbit

Verdict: spot only.
Foxbit lists no perpetual, future, option or margin product.
The REST v3 OpenAPI file has no derivatives path or funding field, CoinGecko's 214 derivatives exchanges do not include it, and CCXT 4.5.68 maps all 133 markets as spot (foxbit.js 1642/1646).
So the engine's swap filter (connector.ts 79, 196-202) would skip the venue at boot.
Its spot market has 128 BRL pairs and only 5 USDT pairs (btcusdt, ethusdt, usdcusdt, xrpusdt, solusdt.
Maker 200 ppm, taker 1,500 ppm).
The WebSocket book (snapshot plus sequenced deltas) is clean enough for a future spot leg.

Blockers:

- No perpetuals: CCXT loads 0 swap markets, so the connector skips the venue.
- No index, mark or funding anywhere, so a route with a Foxbit leg would be refused at open for want of a mark.
- 128 of 133 markets quote BRL, which is outside the USD/USDC/USDT settlement family.
  Only 5 USDT spot pairs could ever cluster.
- CCXT Pro has no foxbit class ('ws': false at foxbit.js line 70), so a feed would be written from scratch.

Open questions:

- Why 25 BRL markets carry default_fees that differ from the published 0.25%/0.50% (0/0, 0.25/0.25, 0.5/0.5, 0/0.5), and whether any of these are promotions with an end date: not published.
- Whether the VIP tier table also lowers the crypto-against-crypto (USDT) 0.02%/0.15% rates: not stated.
- How a 429 looks on the wire (documented header x-fb-rate-limit-retry-after, not the standard Retry-After): not provoked.
- WS deltas run past the 300-level snapshot window (book reached 303 bids), so the deep end of a local book may miss levels.
  Irrelevant at 20 levels, inferred only.
- Behaviour when a subscribed market is delisted, and whether that closes the socket like an unknown symbol does: not observable.
- Server clock offset only bounded to about +/-150 ms, because system/time has a round trip near 300 ms.

### Young Platform

Verdict: spot only.
No perpetual is listed and there is no CCXT class in 4.5.68 or master.
The spot 'market' is also not an exchange book.
Since 2026-07-01, Young Platform has run no internal order book.
Pro and the new trader API route FOK-only limit orders through a Smart Order Router to external venues.
The public book is an indicative 8-level aggregate, republished about every 1 s, sitting 1,331 to 1,669 ppm outside Kraken's touch on each side.
A cross also pays a 0.40% (4,000 ppm) Level 0 commission.

Blockers:

- No perpetual listed.
  The futures module in the Pro web app is disabled and would be One Trading's contracts.
- No CCXT class, so the engine's loadMarkets catalog cannot be built.
- No internal order book since 2026-07-01.
  The SOR.OB book is an indicative aggregate of external venues, not resting orders.
- Book depth is 8 levels per side, below the engine's 20.
  The deepest bid on 8 of 24 markets is a single level worth 22 to 159 million quote units, 0.6% to 8% from the touch, so it is not a plausible order.
- No index, mark or funding for an anchor poller.
- Level 0 commission is 4,000 ppm on top of the external venue price, and only FOK limit orders are allowed.

Open questions:

- Which external venues feed SOR.OB and SOR.PI, and whether the roughly 0.15% per side gap to Kraken is a router markup or other venues' touch.
  Neither is published.
- Whether YNG club fee discounts (5% to 90%) apply to the SOR commission, as the OpenAPI sor_discount_percentage text implies, and what the volume cap and non-club discount are.
  The sor_tiers ladder is available only from authenticated /private/profile.
- Whether fee_fixed is non-zero on any SOR tier.
- The fees pages exchange.youngplatform.com/en/fees and pro.youngplatform.com/fees render only in a browser and were not read.
  The fees come from T&C Annex A dated 30/06/2026.
  The help center still shows the pre-July 0.2%/0.2%, and the legacy /api/v4/public/markets still shows makerFee 0.20 and takerFee 0.30.
- Whether and when the futures (One Trading) module will ship.
  Young Platform says the new API set will be complete by end of 2026.

### Changelly PRO

Verdict: fits with a named change.
Every part the engine needs exists.
CCXT 4.5.68 has no Changelly class, but hitbtc speaks the same API v3. new ccxt.hitbtc({id: 'changellypro', urls: {api: {public and private: 'https://api.pro.changelly.com/api/3'}}}) loaded 19 swaps whose market.id matches the socket and anchor ids, with contractSize 1 and market.taker 0.0005. orderbook/full gives a snapshot plus a strict per symbol sequence.
One futures/info call carries index, mark, next rate and next settlement for all perps.
The named change is that registry entry, plus a marketFilter on info.status === 'working', because CCXT marks the expired LUNAUSDT_PERP active.
The poller must also take fundingRate from indicative_funding_rate and use a constant 8 h interval.
Caveats: the books, trades, open interest and anchor are HitBTC's (the same matching engine), the list is only 18 thin perps, and the mark carries no book premium.

Blockers:

- US persons may not use Changelly PRO at all (terms updated 2026-09-16), and Spain and several sanctioned regions are also excluded.
- Changelly PRO fronts HitBTC's matching engine: trade ids, book levels (timestamps equal to the millisecond), open interest, index and mark are identical to api.hitbtc.com.
  Registering it next to HitBTC would duplicate one book, and a cross between the two would compare a book with itself.
- The mark is index plus funding carry (index x (1 + last settled rate x time to settlement / 8 h)) with no book input.
  The engine's freshPremium (touch over mark) would read a standing basis as fresh, which is the same trap as a capped mark.
  BCHUSDT_PERP has settled negative on 90 of 90 periods.

Open questions:

- Jurisdiction of Alqentra LLC, and which named entity (Alqentra LLC, Changelly PRO Solution Inc., or the Seychelles listing on CoinGecko) is the futures counterparty.
- Index basket composition and weights, including whether HitBTC's own prices are in it.
  No basket call exists.
- Funding cap and floor per contract, which are unpublished (floors of -0.003 and -0.0029 were observed and no cap was reached), and which side pays.
- The published VIP 0 perpetual fee comes only from the catalog's default take_rate and make_rate (500/200 ppm).
  The fee tier page shows dashes for every futures level, so a personal rate needs the private futures/fee call.
- Which countries the app blocks from futures.
  The message exists but the list is not published.
- Headers of a 429 (Retry-After) were not observed.
  The documented limit is a rate of 30 a second with a burst of 50 on /public/*.
- Whether to prefer HitBTC itself (50 perps, catalog taker 700 ppm) or Changelly PRO (18 perps, 500 ppm) if this engine is ever added, since both are one book.

### Emirex

Verdict: spot only.
Emirex lists no perpetual, dated future, option or margin pair.
It has only 12 thin spot pairs, charges 8,000 ppm maker and taker with no tiers, has no CCXT class, and publishes no index, mark or funding.
Its socket.io book feed would also need changes to VenueFeed, which JSON.stringifies every subscribe frame at lines 143, 152 and 161 and has no REST seed step.
The book sits 200 to 1,400 ppm around Binance spot's touch and looks like one market maker quoting that venue.

Blockers:

- No perpetual product of any kind: no swap, dated future or option, and no margin pairs (config margin_pair_list [] and ticker-margin data []).
- No CCXT class in 4.5.68 or in CCXT master, so the connector has no catalog to load.
- No index, mark or funding published, so an AnchorRow has no source and a mark of 0 is refused at open.
- Spot fee is 0.8% maker and taker (8,000 ppm) on every pair, about 11 times the ~700 ppm BTCUSDC spread.
- The book feed is socket.io text framing (40, 42[...], 2/3 heartbeat) with no snapshot on subscribe.
  VenueFeed sends only JSON.stringify'd objects and its resync has no REST seed step.

Open questions:

- Restricted jurisdictions are not listed: the Terms defer 'Restricted Person' to the AML/KYC Policy, which does not define it.
  So whether US or Canadian persons may trade is Not publicly specified.
- The fee page https://emirex.com/fees/ is an empty Tilda export.
  The 0.8% comes only from the public config call POST /api/default/config (trade_commission) and the web app code that renders it with a % sign.
- Commission_percent_limit_hidden is 0 on every pair, and whether hidden limit orders trade free is not documented.
- The bulk ticker's rate changed at most once per pair in 30 s while BTCUSDC traded about every 12 s.
  That suggests a refresh or cache interval, but this is an inference.
- Whether the book is one market maker mirroring Binance is an inference from count 1 levels, 5 s burst silences and a quote that straddles Binance's touch, not a stated fact.

### GoPax

Verdict: spot only.
GoPax is a Korean spot exchange (Streami, Inc.) with no perpetual, dated future or option.
It has no CCXT class since 2021, so it has no catalog path into the engine and no anchor.
Its public spot socket is usable without a key but gives no per-pair sequence for gap detection.
Activity is tiny: CoinGecko shows 3.66 BTC in 24 h, the listed KRW pairs total about 586M KRW in 24 h, and BTC-KRW has a live spread of about 17,500 ppm.

Blockers:

- No perpetual of any kind: spot only, 111 KRW and 11 USDC pairs.
- No CCXT 4.5.68 class and none on master.
  CCXT removed gopax in 2021, so the engine's loadMarkets catalog has no path.
- No index, mark or funding, so every GoPax leg would be refused as anchor_no_mark.
- EntryId is global across the exchange, so the book feed cannot detect a lost delta.
  Resync can only be a reconnect or a REST comparison at 1 book call per second per IP.
- KRW quote is outside the engine's USD/USDC/USDT quote family, and the USDC books are nearly dead (24 h volumes of 1 to 65 USDC, ETH-USDC spread 38,462 ppm).
- Foreign and corporate customers cannot use the API, according to the site, and a US person has no verification path in the pages read.

Open questions:

- The terms of service at https://www.gopax.co.kr/terms load from a CMS in the browser and were not read.
  So the full list of excluded countries and US-person eligibility were not confirmed.
- Whether a snapshot always reflects every change up to its maxEntryId is inferred from one capture (a deletion with entryId equal to maxEntryId arrived 289 ms after the snapshot).
  The skip rule in websocket.md section 8 rests on that assumption.
- What the order book channel sends for a pair with an empty side was not observed.
- The keyless WebSocket connection limit is not published (the docs give 20 per API key and 20 opens per second), and no 429 or Retry-After was triggered on REST or WS.
- No PublicTradeEvent arrived in 30 s on XRP-KRW, so its live shape is documented but not captured.
- The fee and membership tables were read from the site's JavaScript bundles (feeinfo page chunk and chunk 6557 function DZ, membership chunk 7676), not from rendered HTML.

### bitcastle

Verdict: blocked.
The perpetuals are not an independent market.
Each pair's book and mark are copied from a named source venue (Bybit on 109 pairs).
The socket republishes a thinned sample of Bybit's levels once a second, 144 to 195 ms after Bybit at the median.
It shows only 15 to 30% of Bybit's top 20 bids.
Its spread reached 291 ppm while Bybit's stayed at 1 to 4 ppm.
So any cross the engine saw against the source would be an artifact.
On top of that: CCXT has no class, so there is no catalog.
The socket is binary MQTT, which VenueFeed cannot open or send.
There is no index.
Funding is documented as 0% while the history shows nonzero rates.

Blockers:

- The book and mark are copies of the source venue named in `target`: 109 Bybit, 7 MEXC, 3 Binance.
  The book is a thinned 1 Hz sample delayed about 150 to 200 ms.
  Crosses against Bybit would be artifacts of the copying.
- No CCXT class in 4.5.68 or on master (commit 1d8b674). connector.ts line 68 builds the catalog from a CCXT loadMarkets, so there is no catalog.
- The socket is MQTT 3.1.1 over WebSocket and needs the `mqtt` subprotocol.
  VenueFeed.ts line 81 opens sockets without a subprotocol, and lines 143/152/161 JSON.stringify every subscribe frame.
- No index price anywhere.
  The mark republishes only every 5 s and is 1.1 to 5.7 s old on arrival.
  The only bulk mark call took up to 2.3 s.
- The whole futures API is undocumented: the public API reference covers spot only.
- Terms exclude US, Canada and more, and futures need KYC Level 4.

Open questions:

- Are the nonzero funding-rate/history rows (BTC 0.0001 every 8 h, 0.01 on 88 pairs) actually debited, when the help center and the catalog say 0%?
  This cannot be checked without an account.
- What does the pair-model field mark_price_random_oscillation (seen in the web bundle) do, and is it applied to the published mark?
- Are the far-off levels on pi/usdt (bids 0.0108 to 0.0842, asks up to 5.0) and the odd head-of-list bids on eth/usdt internal bitcastle orders merged into the copied book?
- Does bitcastle hedge fills on the source venue (the bundle has ob_external_* fields), or is it a pure B-book?
- Is the 0.01 rate on 88 pairs a cap, or a placeholder for pairs with no open interest?
- The first two ws-probe book runs subscribed private/user/futures/order/1 as an error case, with no credentials.
  It was granted with code 00 and delivered nothing in 70 s.
  The probe no longer sends it.
  Is this worth flagging to the venue?

### LATOKEN

Verdict: spot only.
LATOKEN lists no perpetual, dated future or option.
CCXT loadMarkets returns 1,245 spot markets and 0 swaps, so the connector would log 'no usable swap markets' and skip the venue (connector.ts line 51).
There is no index, mark or funding for an anchor poller.
Its spot market is documented at spot VIP 0 of 0.59% maker and taker, with a clean snapshot-plus-nonce STOMP book feed.
That feed would need raw STOMP frames sent outside getSubscribeFrames and a baseId/quoteId rawMarketId.

Blockers:

- No perpetuals: 0 swaps among 1,245 CCXT markets, so ccxt/connector.ts skips the venue.
- No index, mark or funding, so there is nothing for an AnchorPoller, and a mark of 0 refuses the route.
- The book socket is STOMP text, and VenueFeed JSON.stringifies every subscribe frame (VenueFeed.ts lines 141 to 161), so a feed would send CONNECT and SUBSCRIBE itself from startKeepalive.
- CCXT market.id is a pair UUID the socket never uses. rawMarketId would have to be '<baseId>/<quoteId>'.
- US and Canadian persons may not trade (also Germany, Indonesia, Iran, Afghanistan, Bosnia and Herzegovina, North Korea).
- Most books are dead: 767 of 1,231 tickers had 0 volume over 24 h and 410 had not updated in more than a day.
  BTC/USDT sat at 77,000 bid and 79,000 ask.

Open questions:

- The fee page lists 85 'exclusive token' pairs at a 0.98% level 1 taker.
  The unauthenticated /v2/trade/fee answered 0.59% for CADINU, FONE and TREE, and 0.11%/0.14% for LA/USDT.
  Which rate a level 1 account pays was not verifiable without an account.
- CCXT's constant is 0.49% (level 2), not the 0.59% level 1 rate.
- Whether the LA staking discount (10% to 50%) stacks with the volume level is not published.
- The formula and sources behind the WS /v1/rate 'rate' are not published.
- What a book subscription on an inactive or closed pair sends was not probed.
- The 60 s close with code 1006 on a socket with no traffic looks like an idle timeout.
  The cause is inferred, not documented.
- The Terms of Use PDF (terms-of-use-v12-LAtrade.pdf) returned HTTP 521, so the legal entity and full exclusion list were not read from it.
- The OpenAPI account enum lists ACCOUNT_TYPE_FUTURES and ACCOUNT_TYPE_GLOBAL_MARKETS with no matching product.

### Mudrex

Verdict: blocked.
Mudrex does list 745 USDT-quoted linear perpetuals, but it cannot be a perpetual leg for four reasons.
First, it publishes no order book at any depth, on the socket or over REST.
Second, the catalog, and so CCXT loadMarkets, needs an API secret that only a KYC-verified Indian account can create.
CCXT throws AuthenticationError before sending any request.
Third, there is no public index or funding, and the only REST mark is a closed 1 m candle up to 60 s old.
Fourth, its last price equals Bybit's (705 of 745 symbols at one read, in both runs) and its mark is Bybit's mark about a second late, so it would add no independent quote.
The VIP 0 fee is 0.02% maker and 0.05% taker, and 18% GST makes the taker 590 ppm all in, which equals CCXT's 0.00059.

Blockers:

- No public order book: the WebSocket offers only klines, mark klines and a last/mark ticker, and 13 book-like stream names were refused with 400 invalid stream name.
  There is no REST depth path and CCXT has fetchOrderBook false.
- The catalog is private: GET /fapi/v1/futures returns 401 code 3100 without a key, and CCXT 4.5.68 loadMarkets throws AuthenticationError (requires secret) at mudrex.js lines 195 and 450.
- The API key requires Indian KYC (PAN and Aadhaar), and the Terms list the United States and Canada as Restricted Locations.
- No public index, funding rate, funding interval or next funding time.
  The REST mark is the close of the last completed 1 m candle (1 to 60 s old), which cannot fill an AnchorRow within the engine's 10 s age rule.
- Prices mirror Bybit: the ticker last equals Bybit lastPrice on 705 of 745 symbols, and markKline@1s equals Bybit markPrice with a median lag under 1 s, so the leg would duplicate Bybit rather than add an independent book.

Open questions:

- Whether Mudrex routes orders to Bybit (the prices say it passes Bybit's prices through), or whether Mudrex TR fills them itself at those prices.
  The Terms say only that derivative prices and execution are offered by Mudrex TR.
- Funding formula, interval, cap and whether funding_fee_perc is Bybit's rate passed through.
  None of it is public and it could not be read without a KYC key.
  The settlement instant itself was not captured.
- Whether the 32 Bybit USDT perpetuals absent from the socket snapshot (mostly equity and ETF tickers) are unlisted on Mudrex or only had no data yet.
  The snapshot omits assets without data.
- Whether the survey row should carry 500 ppm (the published Non-Alpha taker) or 590 ppm (with 18% GST, which equals CCXT's constant) as the taker.
  The profile recommends takerPpm 590 if Mudrex were ever registered.

### ZebPay

Verdict: blocked.
ZebPay perpetuals relay Binance USD-M.
Every book frame is a Binance depth20@100ms frame, arriving about 210 to 230 ms after Binance's own copy reached this host.
The sizes are unchanged, and each side is pushed a fixed 0 to 20 ticks away from Binance's touch (2 ticks on BTCUSDT, 10 on ETHUSDT).
The mark, index, settle price, interval and next funding time are Binance's, and the funding rate is Binance's times 0.9 to 1.1.
As a leg it would duplicate Binance at a worse price, so only relay lag could produce a cross.
The venue also lacks a REST index and next funding time, speaks Socket.IO only, and is open to Indian residents only.

Blockers:

- Books, mark, index, interval and next funding are Binance USD-M's, relayed about 210 to 230 ms late with a per-pair tick markup, so a leg duplicates Binance and a cross against Binance could only come from the delay.
- The REST anchor (market/marketInfo) has no index and no next funding time.
  The engine divides by the index at anchorReading.ts line 58, and those fields exist only per pair on the socket's @markPrice stream.
- The public socket is undocumented Socket.IO 4.
  VenueFeed JSON-stringifies subscribe frames, which closes the socket, so the subclass would have to send 40 and 42[...] text itself and answer Engine.IO pings.
  That is a named change.
- CCXT 4.5.68 reads the percent fee field as a fraction (market.taker 0.06 on 78 swaps, 0.1 on 347, zebpay.js line 1712), so registry takerPpm plus ignoreCcxtTakerPpm would be required.
- Only residents of India may use ZebPay, and ZebPay is the counterparty to every futures trade.
- The INR contracts (177) cluster with no other venue and would need marketFilter quote === 'USDT'.

Open questions:

- Which fee applies to a VIP 0 account: the pricing page's 0.050% taker and 0.020% maker plus 18% GST, or the public API's 0.06/0.02 (78 pairs) and 0.1/0.05 (347 pairs)?
  Whether the API figures include GST is not stated.
- Which pairs take which funding factor (0.9, 1.0 or 1.1), why INR and USDT twins can differ, and how often ZebPay resamples Binance's rate (BTCUSDT changed three times between 04:17 and 04:41 UTC).
- The liquidation clearance fee is 0.5% on the pricing page but liquidationFee is 0.02 in exchangeInfo, and the API does not state that unit.
- XRPUSDT REST book sizes matched Binance on only 0 to 5 of 20 levels, and the transform is unknown.
- ZebPay's best ask sat below Binance's at the same E on 1 of 114 BTC frames and 12 to 16 of 114 ETH frames, which is unexplained.
- The Zero Fees category (help article of 13 May 2026) is not visible in the public fee call.
  The meaning of the st field and the FEE_DISCOUNT transaction type is also unknown.
- The settlement instant was not captured, and ZebPay has no public funding history call.

### IMBX

Verdict: no public API.
IMBX publishes no API documentation: its "API Docs" help article says only "Contact us - support@imbx.io".
CCXT has no class, and the open API host named in IMBX's own config does not answer.
Only the web client's undocumented endpoints work.
They do list 29 USDT-M perps, but using them would need a catalog outside CCXT, a User-Agent on sockets, gunzip of every frame, and dropping crossed frames.
The anchor would need 29 per-contract index calls per round, against a load balancer that blocked this host after about 250 requests.
The mark also tracks IMBX's own book.

Blockers:

- No CCXT class in 4.5.68 or in CCXT master (commit 1d8b674, 2026-09-22).
  The engine's catalog is a CCXT class (server/src/ccxt/connector.ts lines 21 and 68).
- No published API documentation, and the open API hosts (openapi.imbx.io, futuresopenapi.imbx.io, openapi.iambit.com) drop TCP 443.
  Every usable endpoint is an undocumented web-client call that can change without notice.
- The AWS load balancer refuses requests with no User-Agent or a curl one.
  VenueFeed opens sockets with only { perMessageDeflate: false } (VenueFeed.ts line 81), so the shared feed code would need a headers option.
- A volume block after about 250 requests in 5 minutes refused both REST and socket from 04:37 UTC, and was still in force 29 minutes later.
  A 1 s anchor round needs 30 requests.
- No bulk index call: the index is only in per-contract public_market_info.
- Every book frame is gzip inside a binary message, and some BTC/ETH frames are crossed at the top.
- The mark is a median that includes IMBX's last price and book basis, so it reads the perp rather than the index (the self-index shape).

Open questions:

- How long the load balancer's volume block lasts, and what its threshold is (still 403 at 05:06 UTC, 29 minutes in).
- Whether the per-contract catalog fees apply over the VIP table: ETH shows 750 ppm taker, TRUMP 50 ppm to open and 500 to close.
- Whether socket sizes are contracts of `multiplier` coins.
  This is inferred from the ticker's vol×price=amount, and there is no REST book with sizes to confirm it.
- The funding cap on 4 h contracts: the bulk funding call says ±0.375%, public_market_info says 0.1875% for COPPER.
- Which operator contracts with users: the web Terms name Bull Market labs UAB, the help-center Terms name IMBX S.A. de C.V.
- The index basket constituents and weights are not published.
- NextFundRate is taken to be the estimate for the settlement after next.
  That is an inference.
- The settlement instant was not captured.

### Icrypex

Verdict: blocked.
Icrypex does list 53 USDT pairs typed PERPETUAL (BTCUSDT/P), each with its own order book, and its public book socket is sound: snapshot on subscribe, strict per-pair change-set chain, 50 levels, sizes in base asset matching REST exactly.
Three things still block it as an engine perpetual leg.
There is no CCXT class, so the catalog cannot load.
There is no public index, mark or funding, so no anchor poller is possible, and the engine would refuse every route as anchor_no_mark.
The product is a borrow-based leveraged position whose "funding" is interest ICRYPEX announces, not a premium-anchored rate.

Blockers:

- No CCXT 4.5.68 class and none in CCXT master, so loadMarkets cannot build the catalog.
- No public index, mark or funding endpoint or channel.
  The funding rate sits behind authenticated /v1/future/get-future-settings (401), and the web app's Mark Price is the pair's last trade.
- The product is a borrow-based leveraged position whose funding is interest set by ICRYPEX, not a premium-anchored perpetual rate.
- 30 of 53 perpetuals are venue-specific synthetic tokens (NVDX, EURX, OILX and others) whose tickers would not match other venues.

Open questions:

- Fees: the fee page shows Beginner at 0.20 % maker and 0.25 % taker and API customers at 0.35 % both ways.
  The live /v1/trades/fees returns 0 on all six levels on 2026-09-23 UTC, 34 days after the zero-fee campaign's stated end of 20.08.2026.
  Which one applies to perpetual API orders is unconfirmed.
- The ICRYPEX List of Prohibited Countries is named in the usage agreement but was not found publicly, so US and Canadian eligibility for futures is unconfirmed.
- The funding settlement instant, formula, cap and the side that pays were not captured, and no public funding history exists.
- The first 53-pair batch run saw 1 change-set gap and 1 removal at a missing price, and the pair was not recorded.
  The second run, which logs it, saw 0.
- The usage agreement forbids bots and automated monitoring of the platform while also advertising an API, so whether automated market-data use is allowed is unclear.
- PriceLimitFactor (1.3 on perps, 5 on SPCXUSDT/P, 3 on spot) is undocumented.

### Blockchain.com

Verdict: spot only.
There are no perpetuals, so it cannot be a perpetual leg.
Even as spot it is a wound-down venue.
Its own FAQ says Exchange trading was suspended on 2025-10-19.
Of 60 open REST books, 21 return HTTP 500, 11 or 13 are empty, and 26 to 28 hold one quote per side of about 0.002 BTC (89 to 316 quote units) at about 2 % spread.
The WebSocket l2 book is static and differs from the REST book.
CCXT reports no taker.

Blockers:

- No perpetual market on the Exchange.
  CCXT swap is false and the engine's catalog keeps only active swaps (connector.ts line 79).
- Blockchain.com's help center says trading on the Exchange was suspended on 2025-10-19, and users were moved to the in-app Trading Account.
- The WebSocket l2 and l3 books got no update over any probe.
  The 60 snapshots were identical 14 minutes apart.
  They differ from the REST book: the socket BTC-USD ask of 0.25 at 87,700.11 is better than the REST ask, so a feed would publish a stale book.
- REST /l2 returns HTTP 500 'Internal server error' on 21 of 60 open symbols, and the two-sided books are one 0.002 BTC-sized quote about 1 % either side of the market.
- The WS handshake needs an Origin: https://exchange.blockchain.com header, and VenueFeed.ts line 81 opens sockets with no header option.

Open questions:

- Is the static WebSocket book the order book frozen at the October 2025 suspension?
  The socket ticker mark_price of 106,523.7 falls inside Kraken's BTC range for 2025-10-19, but that does not prove it.
- What still matches on the REST side?
  BTC-USD volume_24h rose from 0.12205461 to 0.13035325 and last_trade_price moved from 86,000 to 86,300 during the probes, but the WS trades channel sent nothing.
- Whether US persons were ever allowed to trade the Exchange order book is not stated on the pages read.
- No REST rate limit is published for the public calls, and none was hit at two requests a second.

### Hata

Verdict: spot only.
Hata lists no perpetual and has no CCXT class, and it publishes no index, mark or funding.
Its spot is also unusable as a leg.
Global has 6 pairs with about 1,511 USD of 24 h volume in total, and no Global pair traded between runs 17 minutes apart.
Its XRPUSDT book was crossed on 16 to 21 of 30 REST reads and on 42 of 96 WS pushes, and its last prices sit 0.4 to 5 percent below Binance.
The WebSocket delivers books seconds to tens of seconds late from this host.

Blockers:

- No perpetual product on either platform.
- No CCXT class in 4.5.68 or current master.
- No index, mark or funding anywhere, so no anchor.
- WS book delivery delayed about 1 to 55 s from this host, and the delay grows with the number of subscribed channels.
- Hata Global order book has 6 pairs with about 1,511 USD of 24 h volume, and XRPUSDT is persistently crossed.
- Hata Global excludes US persons and Ontario.

Open questions:

- Whether the WS throughput ceiling of about 14 to 28 KB/s shared across sockets is per client IP, per server, or on Cloudflare's path to the origin.
- Who may open an account on the Malaysia platform: its terms table names Hata Capital Limited for all countries, while the Global terms say Hata Digital Sdn Bhd runs it.
- Whether the affiliate programme changes the effective taker (page not read).
- What @depth sends for an empty side, since none was seen.

### Zaif

Verdict: spot only.
Zaif lists no perpetual.
CCXT 4.5.68 loads 56 spot markets and 0 swaps, so the connector's swap filter keeps nothing.
Its only perpetual, AirFX, stopped trading on 2021-09-28 and survives only as frozen futures API data.
The spot market is JPY and BTC quoted (outside the USD quote family), and it is thin: about 57 million JPY in 24 h across all JPY pairs.
Its socket is one pair per connection with full top-20 pushes and no sequence.

Blockers:

- No perpetual of any family.
  AirFX (JPY perpetual) and the dated futures are retired, and margin trading is gone.
- Every market is quoted in JPY, BTC or a Zaif token, none in the USD/USDC/USDT quote family.
- No index, mark or funding, so no anchor poller is possible.
- Account eligibility excludes US citizens, US permanent residents and US and EEA residents.
  Corporations must be registered in Japan.
- The WebSocket carries one pair per socket and rejects any client text frame, so a feed needs one socket per market, protocol pings every 20 s and connect pacing under 4 per second.
- The catalog reply is unstable: 4 of 21 reads over about 20 minutes returned 50 rows instead of 56, dropping the six suspended (market_status 1) pairs.
  CCXT market.active is undefined for every market.

Open questions:

- What do the undocumented socket fields market_status (absent, 0, or 1 on the six empty suspended pairs), target_users and itayose_data (always 20 empty objects) mean?
- Which countries besides the EEA and US does Zaif exclude?
  The designated-country list is not published, and the standards do not say outright that an individual must live in Japan.
- What taker fee applies to the 15 catalog pairs absent from the fee page (six cs* event pairs, dep, polygon.mv, polygon.rond, zpg, zpgag, zpgpt)?
- The fee page gives 3,000 ppm taker on 38 pairs, but CCXT reports 1,000 ppm on all 56.
  A spot design would need per-pair overrides.
- What status code or body does a REST client get when it exceeds the documented 10 calls per second?
  The probe did not test beyond that limit.
- Is the socket timestamp (Japan time, microseconds) stamped at send?
  Busy pushes arrived 62 to 92 ms after it, against a 114 to 139 ms ping round trip, so clock agreement within about 30 ms is only an inference.
- The 60 s idle cut is attributed to an AWS load balancer default from the DNS name.
  That is an inference and is undocumented.

### SecondBTC

Verdict: spot only.
SecondBTC lists no perpetual of any kind, so it cannot be a perpetual leg.
Its spot market would not fit either: there is no CCXT class, no working WebSocket (only a Socket.IO long-polling transport, one market per session, with no symbol or sequence in the payload), and no index, mark or funding.
The book is a copy of Binance made by the venue's own market maker (priceSource "binance").
Against Binance it lagged (ETH touch moved 7 times while Binance moved 12, SOL 2 times against 12).
The SOL book sat frozen with every level listed twice, up to 1,004 ppm through the Binance touch, so its crosses are stale copies rather than tradable prices.

Blockers:

- No perpetuals: spot only (56 enabled of 65 symbols: 47 USDT, 6 USDC, 3 FDUSD).
- No CCXT class in 4.5.68 or in current master, so the catalog would need a hand-written loader.
- No usable WebSocket: every upgrade on socket.secondbtc.com returns HTTP 400 Engine.IO code 3, so VenueFeed (which opens a WebSocket) cannot carry it.
  Socket.IO polling gives one book per session with no symbol, sequence or timestamp.
- No index, mark or funding, so there is nothing for an anchor poller to read.
- The book is a delayed copy of Binance by the venue's own market maker.
  SOLUSDT was frozen and duplicated for over a minute and crossed Binance by up to 1,004 ppm.
  Trade prints come about every 10.44 s (19 of 25 gaps), which suggests bot-printed volume (an inference).
- REST rate limit is x-ratelimit-limit 300 per 60 s, apparently shared with other clients.
  One depth read per market every 5 s would be 672 per minute.

Open questions:

- Fee unit: tradeFeeMaker, tradeFeeTaker, maker_fee and taker_fee return a bare 0.2 with no unit.
  The profile reads it as 0.2 % (2,000 ppm).
  The home page advertises 'Zero Fee', and PEPEAIUSDT shows 10000.
  No official fee page could be read.
- Legal entity, eligible regions and whether US persons may trade were not verified, because the terms page is client-rendered and the one headless render timed out.
- The token commission discount of up to 50 % is written in the future tense.
  Whether it is live was not checked without an account.
- Venue security: the public EXCHANGE_MARKET_INFO socket event sends every client the venue market maker's userApiKey and userSecretKey fields.
  The probe redacts them, and no value was stored anywhere.
  The main session may want to note this as a counterparty risk.
- The rule that a session's book follows the last room joined is inferred from three runs.
  The server's code was not seen.

### Paribu

Verdict: spot only.
Paribu's exchange lists only spot: 278 markets, 242 TRY and 36 USDT, 267 open.
It has no CCXT class and publishes no index, mark or funding, so it cannot be a perpetual leg.
Its perpetual product is a mobile-app interface to a third-party on-chain protocol (HyperCore), not a Paribu book.
Spot fees are 0.12%/0.28% maker/taker (1,200/2,800 ppm) at TRY level 1, and a fixed 0.01%/0.10% (100/1,000 ppm) on every USDT market.
The USDT markets traded only about 4.4M USDT in 24 h.
The spot WebSocket book would suit the VenueFeed shape well.

Blockers:

- No perpetual on Paribu's own exchange, and the engine loads only active CCXT swaps (connector.ts lines 79 and 196 to 202).
- No CCXT class in 4.5.68 or in master.
  PR #30536 is open and spot only, with fees undefined.
- No index, mark or funding for an anchor poller.
- The mobile-app DeFi perpetuals route to a third-party HyperCore protocol with no Paribu API.
- Only the 36 USDT markets fall in the USD quote family, and together they traded about 4.4M USDT in 24 h.

Open questions:

- What config whitelist_country (42 entries, no US) gates, and whether anyone outside Türkiye without Turkish citizenship can trade.
- Meaning of loyalty_discount_rates {taker:{2:0.05,...,5:0.2}}: read as a taker cut by years in crypto, an inference.
- Market maker entry threshold: two help articles edited 2026-06-15 say 1 billion TRY and 50 million USD.
- The v2 socket is beta.
  The docs say ping every 20 s and close 4002, but the wire showed a 30 s ping and a 1006 close about 11 s after an unanswered ping.
  The documented 256-subscription cap was not enforced at 331.
- An unknown market answered code 5004 in one run and 2003 in the next.
- Refusal shape of the anonymous per-second limit (x-ratelimit-limit 100 or 300) not provoked.
- Provider fee of the DeFi perpetuals not published, and the protocol behind HyperCore not named in the terms.

### EarnBIT

Verdict: spot only.
EarnBIT lists only 26 spot markets.
Futures are "Coming Soon" with empty pages, and there is no futures route, host or margin list.
There is also no CCXT class, no index, mark or funding, and no sequenced book feed, so it cannot be a perpetual leg.
Its visible books are also a zero-fee market maker's 100-order ladder quoted around Bybit's spot mid.

Blockers:

- No perpetual, future or margin product: gitbook 'Futures Trading (Coming Soon)' pages hold only headings, six candidate futures API paths return 404, ws-futures/futures/api-futures.earnbit.com return ENOTFOUND, site state MARGIN_LIST is [].
- No CCXT class in 4.5.68 or master, so the engine's loadMarkets catalog path does not exist and a custom loader would be needed.
- No index, mark or funding anywhere, so no AnchorPoller is possible.
- No official trading fee schedule: the gitbook Trading Fees page is empty and /fees has only deposit/withdrawal and P2P tabs. 0.2% (2000 ppm) comes only from CoinGecko's single 'Fees' value and the site's affiliate calculator assumption, and maker is unknown.
- WS depth has no sequence id, checksum or timestamp, allows one market per socket, and a delta can exceed the subscribed limit.
- Every visible order (5,194 to 5,200 per scan, 98 to 100 per side) has takerFee and makerFee 0.
  EarnBIT mid equalled Bybit's spot mid exactly on 9 to 16 of 24 shared markets, within 451 to 649 ppm on the rest.
  REST ticker 24 h volume is 5.4 to 7.0 times the matching engine's own state.update volume.

Open questions:

- The VIP 0 maker and taker are not published.
  The web app reads them from a logged-in fee-settings call (fee, fee_plc, fee_plc_buy), and the EBT-payment discount size is also behind login.
- The registration country exclusion list loads at run time from back.earnbitech.cloud, which accepted TCP but never answered TLS from this host, so excluded regions and US eligibility for spot are unverified.
- Whether EarnBIT will launch futures: the web bundle carries FUTURES_TRANSFER, FUTURES_LIQUIDATION and 'Futures Commission' strings shared with PointPay's platform.
- Server inactivity rule is inconsistent.
  An unsubscribed silent socket closed at 60.5 to 60.6 s (1006) in both runs.
  Subscribed-silent and protocol-ping-only sockets closed at 81 to 83 s (1000) in one run but survived 100 s in the other.
  Only server.ping every 20 s was safe in both.
- The 429 status and Retry-After for the x-ratelimit-limit 500 per 60 s were not observed.
- CoinGecko's exchange page says 'Margin Trading: Yes', but the site shows an empty MARGIN_LIST and only Spot and Defi tabs.

### FMFW.io

Verdict: fits with a named change.
The venue has everything the engine needs: a CCXT catalog with market.id equal to the WS and anchor keys, a clean snapshot-plus-sequence book feed, and one bulk anchor call.
The named change is a marketFilter that keeps market.info.status === 'working' and drops CELUSDT_PERP, because CCXT hard-codes active: true (hitbtc.js line 873) and would include the expired LUNAUSDT_PERP.
A poller also has to supply fundingIntervalHours = 8, since no reply carries it.
Things to weigh: thin books (spreads 240 to 108,496 ppm), a 3 s anchor republish, a mark derived from the index, and GMT renamed by CCXT.
Canadian and US persons cannot trade the perpetuals.

Open questions:

- The two doc pages disagree on which settlement funding_rate belongs to.
  The info page says it was paid in the previous period.
  The history page, CCXT (hitbtc.js lines 3439 to 3442) and the mark formula treat it as the rate the next settlement pays.
  The settlement instant was not captured.
- The mark is index x (1 + funding_rate x t/8h), so it carries none of FMFW's own book basis.
  A standing FMFW basis would read as fresh edge, not as carried premium.
- The index basket and its sources are unpublished.
  The index is rounded to contract tick and republished every 3 s.
  One tick is 1,131 ppm on GMT and 1,127 ppm on MANA, which trips anchor_moving (MAX_ANCHOR_MOVE_PPM 1,000) on every index step.
- CCXT commonCurrencies (hitbtc.js line 750) renames FMFW's GMT (STEPN) to 'GMT Token', so GMTUSDT_PERP stays unpaired unless the connector gets a way to pass CCXT options.
- Liquidity is thin.
  Perp spreads were 240 to 108,496 ppm, and GMT, APE and ATOM showed zero 24 h volume, with ATOM's spread about 10%.
  Rows on these contracts would likely be dust.
- The liquidation fee is 0.5% on the fee page and in the help article, against liquidationFeeRate 0.003 in the site's instrument data.
- 429 behaviour and Retry-After were not observed, since probes stayed at about 5 rps against the documented 30 rps plus 50 burst.

### Bitexlive

Verdict: spot only.
Bitexlive lists no perpetual or other derivative, so it cannot be a perpetual leg.
There is also no CCXT class for the catalog and no index, mark or funding for an anchor poller.
Its only socket is undocumented.
That socket re-sends every pair's whole 22-level book about every 50 s with no sequence, and 5 or 6 of 21 books stay crossed.
For example, an ETH_USDT ask at 2359.9 sat 15 % under the bid through every read.

Blockers:

- No perpetuals, futures, options or margin.
  Spot only, 21 USDT pairs.
- No CCXT class in 4.5.68 or on CCXT master, so the engine's catalog cannot load it.
- No index, mark or funding published, so no AnchorRow can be built.
- WebSocket is undocumented.
  It was taken from the web app bundle, and the terms forbid access other than through the provided interface.
- The book refreshes once per 49.6 to 51.7 s sweep as a whole-book replace, with no snapshot on subscribe and no sequence.
- Standing crossed books: 5 or 6 of 21 pairs on every sweep.
  REST BTC_USDT was also transiently crossed on 6 of 59 reads during refreshes.
- Book channels are keyed by a market UUID that only the exchange page's window.pageData maps to BTC_USDT.

Open questions:

- Does a third party using the undocumented Pusher socket breach the terms' clause against access other than the provided interface?
- Which size is executable: the rounded amount (also what REST reports) or total/price?
- Is the book real liquidity?
  The standing crossed levels, one $1 to $13 trade per pair every ~50 s, and whole-book sweeps suggest a synthetic or mirrored book.
- The REST rate limit is unpublished and was not tested beyond one call per 1 to 2 s.
- May US persons trade?
  The terms neither admit nor exclude them, and governing law reads 'any jurisdiction'.
- Would the server close a subscribed socket that ignores its pusher:ping (seen at 77 s and 87 s)?
  Not tested.
- Is the 60.5 s close of an idle unsubscribed socket (1006) a proxy read timeout?
  This is inferred, not confirmed.

### XBO.com

Verdict: blocked.
XBO lists USDT perpetuals, but its futures catalog and its only futures book socket both require an HMAC API key, and both answered 401 without one.
The venue also publishes no index or funding anywhere, and CCXT has no class, so no catalog, feed or anchor poller can be built unauthenticated.
The only public API is spot REST with no socket.

Blockers:

- Perpetual market data needs an account API key.
  GET /v1/futures/trading-pairs and the wss://api.xbo.com/ws/v1/futures upgrade both answered 401 with an empty body.
  A documented 403 'Forbidden customer type' means a key alone may not be enough either.
- No CCXT class in 4.5.68 or on master, so the engine's loadMarkets catalog has nothing to load.
- No index, funding rate, funding interval or next settlement is published in either API.
  Mark exists only on the keyed tickers channel, so an XBO leg would be refused as anchor_missing.
- No public WebSocket of any kind.
  The spot Public API is REST only.
- US persons are excluded by the site footer and the terms.
  The terms also say related parties may act as counterparty to users' trades.

Open questions:

- The active perpetual count and settlement families.
  The catalog needs a key, and the site claims over 100 assets.
- Does the books version step by exactly 1 per message, so that a gap is detectable?
  The docs only say 'monotonically increasing'.
- Book depth, push rate, size unit (probably base currency, an inference from the catalog fields), and behaviour on idle or one-sided books.
- Funding formula, interval, cap and settlement instants.
  Only generic help text exists ('often every 8 hours').
- Index and mark formulas, and whether the mark premium is clamped.
- Which countries besides the US, Iran, Russia and the UK may trade futures.
- Whether the XBO token discount applies to the futures taker, and by how much.
  No rate is published.

### Figure Markets

Verdict: spot only.
Figure Markets lists no perpetual.
Its 29 markets are 17 CRYPTO spot, 8 CONNECT loan-pool tokens, 3 YLDS FUND and 1 ATS equity.
It has no CCXT class in 4.5.68 or on master.
Its live config sets WINDDOWN_DATE 2026-09-23T12:00:00Z, about 7 hours after the probe, and its FAQ says trading in BTC, ETH, SOL, LINK, UNI and XRP ends then.
After that only HASH and stablecoin pairs remain.

Blockers:

- No perpetual in any form: market_type values are ATS, CRYPTO, FUND, VIRTUAL_YLDS and CONNECT, and a help center search for 'perpetual' returned 0 articles.
- No CCXT class in 4.5.68 or CCXT master (ts/src at 1d8b674), so the connector's loadMarkets catalog cannot see it.
- Crypto trading for BTC, ETH, SOL, LINK, UNI and XRP ends 2026-09-23 12:00 UTC per the live web config and the FAQ of August 24, 2026.
  Only HASH, YLDS, FGRS, USD, USDC and USDT remain.
- Books are thin market-maker ladders of about 10 levels, and the last trades were hours old (BTC-USD 01:15 UTC, UNI-USD 21:27 UTC the day before).
- Book updates are conflated to a 340 ms publish tick and carry no timestamp.

Open questions:

- What REST status and WS behaviour the six delisted bases show after 2026-09-23 12:00 UTC (CLOSED, removed, or silent).
- The source and basket behind indexPrice: the spec says only 'Oracle index price', and Pyth is inferred from the web bundle's chart datafeed.
- The documented 30-minute session cap was not tested, because no socket was held beyond 100 s.
- Whether any subscription cap exists above the 52 accepted.
- What the -2S suffix on BTC-USD-2S and BTC-USDC-2S means.
- Whether non-US residents such as Canadians can open exchange accounts: the terms say the service is intended for the US, and exchange eligibility is 'subject to geographic availability'.

### Coincheck

Verdict: spot only.
Coincheck lists no perpetual, dated future, option or margin product.
CCXT has swap, future and option false at coincheck.js lines 28 to 30, and the docs, the account menu and CoinGecko's derivatives list name none.
It is a JPY-only spot exchange with 26 pairs, and BTC/JPY maker and taker are 0.
So it cannot be a perpetual leg.
Its JPY quotes also sit outside the engine's USD, USDC and USDT quote family.

Blockers:

- No perpetuals, dated futures, options or margin.
  Spot only, 26 pairs, all quoted in JPY, which is outside the engine's USD/USDC/USDT quote family.
- CCXT 4.5.68 has no fetchMarkets for coincheck and returns 5 hard-coded spot markets (coincheck.js lines 170 to 195). 3 are live, fct_jpy and etc_btc are delisted, and 23 live pairs are missing. market.taker, contractSize and active are undefined.
- The WebSocket orderbook channel has no snapshot on subscribe, no sequence id and no checksum.
  A feed must seed from REST and cannot detect a lost diff.
  The stream is conflated to about 365 ms and trails the REST book by up to about 4 s on some levels.
- Account opening is limited to residents of Japan aged 18 to 74.

Open questions:

- The formula of the standard rate (GET /api/rate/{pair}) is not published.
  It tracks the book mid, and it also answers for etc_btc, which the exchange does not list.
- Not verified: whether the orderbook stream covers levels beyond the REST book's 200 per side.
- Only levels the kept book held and REST lacked were followed (all 15 were later deleted or resized on the socket).
  Whether levels REST held and the kept book lacked arrive later was not followed.
- The public REST rate limit is unpublished.
  No 429 or rate-limit header was seen, including 20 edge-cached ticker calls in 0.44 s.
- Socket behaviour for a pair in the itayose or stop state was not observed, because all 26 pairs were available.
- Process note: one SEC full-text search request (efts.sec.gov, which answered HTTP 500) was sent with the user's email address in its User-Agent header, against the rule on email use.
  No other request carried it.

### Indodax

Verdict: spot only.
Indodax lists no perpetual, dated future, option or margin product, so the CCXT connector, which keeps only active swap markets, finds 0 markets and skips the venue.
The spot market itself is mostly IDR (472 of 484 pairs).
The 12 USDT pairs traded about 155,000 to 159,000 USDT a day in total.
The USDT service fee is taker 0.06% (600 ppm) and maker 0.03% (300 ppm), against 0.2% and 0.1% on IDR pairs.
On top come the CFX fee (0.0222% on USDT pairs, 0.0111% on IDR) and 0.21% PPh on sales, so the all-in taker is 822 ppm on a buy and 2,922 ppm on a sale.
The venue publishes no index, mark or funding for an anchor.

Blockers:

- No perpetuals of any family: the connector's swap filter (server/src/ccxt/connector.ts lines 79 and 196 to 200) finds 0 of 484 markets.
- No index, mark or funding, so no AnchorRow can be filled and a mark of 0 would make the engine refuse every route at open.
- CCXT market.taker is trade_fee_percent, a percent read as a fraction (indodax.js line 394): 60,000 ppm on 11 USDT pairs, 200,000 on IDR pairs and 300,000 on bonkusdt, while CCXT maker is 0 everywhere.
- No snapshot on subscribe: a feed must seed from channel-history recover or REST /api/depth, and a quiet pair can be silent past 45 s.
- Some frames carry several newline-separated messages, so the handleMessage in each existing venue feed, which parses the whole frame with one JSON.parse, would throw on them.
- Only 12 USDT-quoted pairs, about 0.16M USDT a day in total, fall in the engine's USD quote family.
- Idxusdt is the IDRX token but CCXT names it IDX/USDT, so a DENIED_PAIRS line would be needed.

Open questions:

- Whether the 0.21% PPh also applies to a USDT-market buy (crypto for crypto).
  The 2023 table taxed both sides, and the exact all-in fee is shown only in a logged-in account screen.
- The maker/taker help article 4416657645465 returned HTTP 403 both from this host and from outside, so any tier detail in it is unread.
  No volume tier is published anywhere else.
- The status code and body of a public REST rate-limit refusal (180 requests a minute) were not provoked.
  No rate-limit headers were seen.
- What a book push carries for an empty side was not observed.
- Whether the +190 to +210 ms server_time offset is the server clock or path asymmetry at a 600 ms origin round trip.

### WazirX

Verdict: blocked.
WazirX has live perpetuals, but every one of its 450 contracts is a Binance USD-M contract under the same name.
Its ticker is Binance's verbatim, its index and mark are Binance's rounded, and its book is Binance's top 20 by rank, widened outward and delayed about 400 ms.
So it adds no independent price and can only show crosses that are stale Binance quotes.
On top of that there is no CCXT class (removed 2025-02-13), the socket serves only 185 of 450 contracts, the REST anchor is rate-limited below 1 Hz, and only Indian residents may trade.

Blockers:

- No CCXT 4.5.68 class and none in master: the wazirx spot class was delisted in CCXT PR 25277 on 2025-02-13, so the catalog would have to be hand built from /fapi/v1/exchangeInfo.
- The book, mark, index and 24 h ticker are Binance USD-M's (widened book, rounded mark and index), so WazirX adds no independent price to the engine.
- The WebSocket depth stream serves only 185 of 450 contracts, and 59 of 61 tokenized stock, metal and energy contracts are left out.
- REST premiumIndex refused this host with code 2136 at an average of 16 calls a minute, so a 1 s REST anchor poll is not possible and !markPrice@arr would be needed.
- 229 contracts are INR-quoted, outside every quote family in server/src/engine/cluster/quoteFamily.ts, and they are only the USDT contracts times a fixed multiplier.
- Only Indian nationals with Indian KYC in India may trade, so no US or foreign person can use it.

Open questions:

- HTTP status of the code 2136 rate-limit reply (429 or 200), which decides whether AnchorPoller would pause at all, and the real public per-IP limit on premiumIndex.
- Whether WazirX futures orders execute on Binance or against WazirX's own synthetic book: no document says so, and the Binance link is an inference from the wire.
- The funding formula, cap and interval: WazirX's rate sits near 0.9 or 1.1 times Binance's predicted rate and INR and USDT twins differ, and the settlement instant was not captured.
- Whether the 18 % GST on commission (GST_ON_COMMISSION income type) is charged at 18 % on futures, which would make the effective taker 472 ppm, and who bears GST_ON_FUNDING_FEE.
- Whether the WazirX ZERO flat-fee plan covers futures, and the size of CLEARANCE_FEE.
- Why the socket serves only 185 of 450 contracts, and whether the documented 30 minute connection cut is enforced (sockets were held at most 123 s).
- The Futures Terms and Conditions are not public (the config key futuresTermsOfService is missing from the public config).

### Tokpie

Verdict: spot only.
Tokpie is a spot-only exchange (379 pairs, 183 with two-sided books), with no perpetual, index, mark or funding, and no CCXT class.
Its only documented WebSocket carries trades and answers HTTP 500, so it has no book feed and cannot be an anchor leg.
Even as spot context, its books barely move: ETH@USDT changed once in about 3 minutes of 1 s polls, and its mid sat 5,000 to 7,500 ppm below Gate's.

Blockers:

- No perpetuals: spot only, so there is no index, mark or funding for an anchor poller.
- No CCXT class in 4.5.68 or in master, so the engine's catalog (connector.ts line 68 loadMarkets, filtered to active swaps) cannot load it.
- The documented WebSocket ws://tokpie.com:8222 answers HTTP 500 to every upgrade, and even on paper it carries only tradeHistory, with no book channel.
- REST book has no sequence id, the best ask is last in the ask array, and a read takes about 670 ms median on the busiest pair.
- Books are nearly still and sit far from the market: ETH@USDT mid was -7,534 and -5,122 ppm against Gate spot, and its ask was below Gate's bid in both reads.

Open questions:

- Excluded regions and US eligibility are not publicly specified anywhere: the terms, privacy policy and sign-up page have no country clause, and there is no licence number.
- Whether ws://tokpie.com:8222 is down only now or for good, and whether it would serve anything beyond trades, is unknown.
  Only the HTTP 500 was observed.
- TKP has no pair priced in it as base, so the dollar cost of the discounted plans (20,000 to 50,000 TKP held) is not verified.
- Whether the fees page's single 'Trade fee' really applies equally to maker and taker was not confirmed by any account-side source, since the FAQ formula implies one rate for both.

### BTC Trade UA

Verdict: spot only.
BTC Trade UA is a small Ukrainian hryvnia spot exchange with 36 pairs: 25 quoted in UAH, 7 in BTC and 4 in USDT.
It lists no perpetual, so it has no index, mark or funding.
CCXT 4.5.68 and CCXT master have no class for it.
It has no public WebSocket book feed.
The flat fee is 0.1% per deal on both sides, 1,000 ppm.
The four USDT pairs had zero 24 h volume, and the btc_usdt spread was about 10% (100,082 to 100,113 ppm).
CoinGecko 24 h volume was 0.0139 BTC.

Blockers:

- No perpetual of any family, so no swap market for the connector and nothing for an anchor poller.
- No CCXT class in 4.5.68 or master (btctradeua was removed in 4.1.52), so createExchange in server/src/venues/registry.ts cannot build it.
- No public WebSocket book channel: /ws/time carries no market data, and its book requests go unanswered.
- No index, mark or funding published.
- Its only USD-family markets (btc_usdt, sol_usdt, trx_usdt, eos_usdt) had zero 24 h volume, with btc_usdt about 10% wide.

Open questions:

- Terms of the loyalty programme that the fee page says reduces the 0.1% commission (no page describes it).
- What the socket's time_object.state stamp counts: it moved 7 times in 20 minutes at 14 s to 420 s gaps and does not track book changes.
- Whether /ws/time answers book get requests for a logged-in session (not probed, since that needs auth).
- What /api/market_prices would return: it answered 502 wait on every read.
- The legal entity operating the venue: none is named on any page read.

### Bitbegin

Verdict: spot only.
Bitbegin lists no perpetuals (futures module disabled, futures route redirects to 404), so it has no leg for the engine.
Its spot market has no usable public interface either.
There is no CCXT class.
The REST API returns 403 to any client without the web client's header.
The only WebSocket rejects its own app key and delivers nothing.
Fees are published only as CoinGecko's single "Fees 0.1%" figure.

Blockers:

- No perpetuals: enable_future_trade is 0 and /futures/exchange returns 307 to /404.
- No CCXT class in 4.5.68 or master.
- REST API returns 403 Access denied without the web client's fixed userapisecret header, and the settings carry api_access_enable "0".
- Public Pusher WebSocket answers error 4001 'Could not find app key `test`' and serves no channel.
- No API documentation and no fee page.
  The only fee figure is CoinGecko's single 'Fees 0.1%'.

Open questions:

- Maker and taker split and any tiers: no venue page states them, and CoinGecko's 0.1% is the only figure.
- How CoinGecko reads Bitbegin tickers when no public route answers.
  Its LINK/USDT ticker showed a -0.084% (crossed) spread at 04:44 UTC.
- Whether Bitbegin's book follows the market: at 05:04:42 UTC its BTC/USDT last trade was 87127 against Gate 86945.8 and Kraken 86949, about 2,000 ppm above, ten minutes after they moved.
- The full pair list: the landing data shows 12 pairs, CoinGecko shows 12, and together they make 13 (LINK/USDT appears only on CoinGecko, USDT/ETH only in the landing data).
- Whether the Pusher server has a working app key that the web client is simply not configured with.
  No keys were guessed.

### SafeTrade

Verdict: spot only.
SafeTrade lists no perpetual, dated future or option. 264 markets appear in the web app state of 2026-09-07 (101 enabled), none derivative.
CoinGecko's derivatives list of 214 venues has no SafeTrade.
So it has no perpetual leg to offer.
It also has no CCXT class in 4.5.68 or master, no published REST or WS documentation, and it refuses this host's Canadian exit on every endpoint.

Blockers:

- No perpetuals: spot only (264 markets, 101 enabled on 2026-09-07, none derivative).
- No CCXT class in 4.5.68 (104 ids) or in CCXT master (ts/src/safetrade.ts returns 404 at commit 1d8b674, and a code search for safe.trade in ccxt/ccxt returns 0).
- Canada geoblock: every safe.trade and safetrade.com REST path and WS URL returns HTTP 403 to this host's Canadian VPN exit, so no book, catalog or clock reading was possible.
- No published API documentation.
  REST paths come from the example client and third-party integrations, and the book stream's snapshot, sequence and keepalive are unknown.
- The Terms list arbitrage and unapproved robots as Abusive Trading, grounds for suspension and withheld funds.

Open questions:

- Does the `<market>.depth` stream send a snapshot on subscribe, and does it carry a sequence id?
  Only a probe from a host SafeTrade serves can settle this.
- Does SafeTrade still serve the Openware `ob-snap` and `ob-inc` streams, or the Peatio `/depth` and `/order-book` REST calls under `/api/v2/trade`?
- How does a member qualify for the `og` group (500 ppm) or the `mm` group (0 ppm)?
- Which Restricted Locations apply beyond Canada?
  The Terms name none, and US persons are not mentioned.
- The fee rows come from Internet Archive captures (2025-08-10 and 2026-09-07).
  They were not read live.

### Bilaxy

Verdict: spot only.
Bilaxy lists no perpetual, dated future, option or margin product.
There are 204 spot pairs, 96 trade-enabled, 85 of them ETH-quoted.
The site's 'Swap' is an on-chain DEX router.
It has no CCXT class in 4.5.68 or on master (4.5.82), and no index, mark or funding.
Its busy books (BTC_USDT and ETH_USDT, about 88% of volume) track Binance about 2.5 to 5 s late.
Even as a spot leg, VenueFeed would need a User-Agent header option (VenueFeed.ts line 81 sends none).

Blockers:

- No perpetual product of any kind, so it cannot be a perpetual leg.
- No CCXT class in 4.5.68 or on CCXT master 4.5.82, and CCXT issue 18053 is closed.
- No index, mark or funding endpoint, so there is nothing for an anchor poller.
- CloudFront refuses a WebSocket upgrade that has no User-Agent header (403), and VenueFeed.ts line 81 sends no headers.
- One socket per market, and any client frame or protocol ping closes the socket, so VenueFeed's keepalive must stay empty.

Open questions:

- Maker and taker fee for a logged-in account: the site's getFee returns 0.0 to anonymous callers even for a nonexistent pair, so only the help-center 0.2% flat rate is evidenced.
- The behaviour past 10 requests per second per IP (status code and Retry-After) was not tested.
- Why CRV_ETH trades about 40% below Binance CRVETH was not investigated.
- The ETH valuation's fixed btc_value 0.02918 (a stale ETH/BTC cross) matched the ETH_USDT close only once in three reads.

### Dinari

Verdict: no public API.
Dinari cannot be a perpetual leg.
It lists no perpetuals, only tokenized US stocks and ETFs issued against shares bought on US exchanges.
It has no CCXT class.
Every documented REST and WebSocket market data call needs a paid partner API key, so even its spot book and quotes are not public.
Only its own web app's undocumented routes answer without keys.

Blockers:

- No perpetual, future or option product. dShares are spot tokens of US equities.
- No CCXT class in 4.5.68 or in current master.
- Every documented REST market data path returns 401 without X-API-Key-Id and X-API-Secret-Key.
  Keys come with partner onboarding (KYB) and API access from $2,000 a month.
- The WebSocket book (stock_dfn_l2) and quotes (stock_dfn_quotes) require an authenticate command with a partner key, and the docs mark the socket as a beta DRAFT.
- There is no index, mark or funding, so no anchor poller is possible.
- The fee is a flat $0.20 network fee per order, or a partner-set fee, not a ppm rate, so the engine's ppm fee model cannot express it.
- This host's Canadian exit is in an unsupported region (Canada is excluded by the terms and pending licensing in the docs).

Open questions:

- Whether app.dinari.com onboards individuals directly, or only partners serve retail.
  The app's code has onboarding and order routes, but checking needs an account.
- What DFN stands for, and whether stock_dfn_l2 is Dinari's own order book (the docs mention orders resting on the Dinari order book in the 24/7 session).
  Its cadence, snapshot semantics and level order are unverified without a key.
- Whether current_price refreshes faster during the regular session.
  It was only observed in the overnight session, where it trailed the clock by 15 to 21 min.
- Rate limits are not published anywhere in the docs index.
- The fee an end user actually pays is set by each partner and is not published.

### Digitalexchange.id

Verdict: spot only.
The venue is spot only, with 91 IDR pairs and no perpetual, future, option or margin (terms: "physical crypto asset trading".
Not in CoinGecko's 214-entry derivatives list).
It has no CCXT class in 4.5.68 or master 4.5.82, and it publishes no API docs.
Its undocumented feeds are also poor spot data. 89 of 91 books are Binance ladders multiplied by exactly 17,800 IDR/USDT, refreshed every 2 s, and often locked or crossed.

Blockers:

- No perpetual, dated future, option or margin product: spot IDR pairs only (91 on /market).
- No CCXT class in 4.5.68 (104 ids) or in master 4.5.82 (105 imports).
  Ts/src/digitalexchange*.ts answer 404.
- No published API or documentation.
  The only REST routes are undocumented /api/<pair>/ticker|depth|trades, found by trying Indodax's path shape.
  There is no bulk ticker and no instruments call.
- The WebSocket is the web page's Socket.IO feed: one pair per socket, whole-book frames every ~2 s, no sequence or timestamp, display-rounded sizes.
- Every pair is quoted in IDR, which the quote family does not merge with USD/USDC/USDT, so no cluster could form.
- Integrasi books are Binance ladders times 17,800 IDR/USDT and are frequently crossed (REST BTCIDR 4 of 12 rounds, by 22 to 351 ppm.
  Socket BTCIDR up to 32 of 36 frames), so they would produce false edges.

Open questions:

- Whether a US person or any non-Indonesian resident may open an account: the terms are silent.
  KITAS and passport are accepted, but funding needs an Indonesian bank.
- How the all-in 0.36% splits in practice.
  On all 91 pairs taker_fee + lp_taker_fee = 0.36 and maker_fee + lp_maker_fee = 0.36 (0.26 + 0.10 on 87 pairs), but no order was placed to confirm the charge.
- The rule that scales Binance sizes into the venue's book, and whether the 17,800 IDR/USDT conversion rate is fixed or updated on a schedule (it was exact at the BTCIDR touch on 2026-09-23 05:13 UTC).
- Whether DCTIDR and VEXIDR (native, non-integrasi) push @depth on change only.
  No frame arrived in 30 to 45 s over four runs, although REST showed a book.
- What the web page subscribes to when logged in (private rooms): not probed, and only a commented-out Pusher auth endpoint is visible.

### Paymium

Verdict: spot only.
Paymium lists no perpetual or derivative, only one BTC/EUR spot order book with about 2.24 BTC of daily volume.
So it cannot be a perpetual leg: the connector drops its only CCXT market (type spot) and there is no index, mark or funding to anchor.
Its EUR quote is also outside the USD/USDC/USDT family.

Blockers:

- No perpetuals: the only market is BTC/EUR spot, and connector.ts lines 196 to 202 keep only active swap markets.
- No index, mark or funding, so the AnchorPoller has nothing to read.
- Quote is EUR, outside the USD/USDC/USDT settlement family.
- Socket is socket.io 1.x (Engine.IO 3 text prefix) with no snapshot, no sequence and no checksum, so a feed needs a REST seed and periodic REST checks.
- CCXT market.taker is undefined (the hard-coded market overrides the fee), so the registry would need takerPpm 6000.
- Very thin book: 2.24 BTC per 24 h, about 180 trades a day, touch notional 10 to 2,095 EUR.

Open questions:

- Whether the REST depth bid side is cut at 200 levels server side (200 bids on all 60 polls, while asks were 129 to 131).
- What the undocumented REST depth 'version' counts: it rose by 32 over 32 streamed updates in run 1 and by 41 over 40 in run 2.
- The URL of the web app's newer socket (PAYMIUM_ENV_SOCKET_URL) and its public/bids, public/asks, public/ticker and public/prices endpoints were not read.
- Stream ticker and trades keys were not observed because no trade printed during the probes.
- The cause of the 60 s idle close (an inference points to a proxy read timeout).
- Share capital differs between the terms (EUR 21,250) and the legal notice (EUR 16,270), both dated July 6, 2026.

### ChainEX

Verdict: spot only.
ChainEX lists no perpetual, futures, options or margin product.
It has 26 spot markets, 21 against ZAR and 5 against USDT.
No CCXT class exists in 4.5.68 or in current master.
It publishes no index, mark or funding.
Its only socket is an undocumented WAMP v1 per-order event stream with no snapshot and no sequence.
Liquidity is tiny: CoinGecko shows 0.0325 BTC over 24 h, only ETH/ZAR has 20 or more levels per side, the median spread is 160 to 211 bps, and 11 of 26 markets had not traded for a day.

Blockers:

- No perpetuals of any kind, so the venue cannot be a perpetual leg.
- No CCXT class in 4.5.68 or in CCXT master (ts/ccxt.ts at 4.5.82), so loadMarkets has nothing to load.
- No index, mark or funding, so no anchor poller is possible.
- The push socket has no snapshot, sequence or order id.
  Gaps are undetectable, and a book needs a REST seed plus periodic REST reseeds.
- Books are too thin for the engine's 20 levels: 1 of 26 markets had 20 or more levels per side, and 13 to 14 had 5 or fewer on a side.
- US persons are blocked by the venue's help centre list.

Open questions:

- How a fill appears on the socket: the web client handles a 'trade' message, but no trade event arrived during any socket run, so whether a partial fill also sends order-delete plus a smaller order is unknown.
- The errors-mode socket got no server ping in 14 and 15 s in two runs, while every other socket was pinged within 4.9 to 8.9 s.
  Which malformed or unknown frame stops the pings is not isolated.
- The published 10 requests per second limit with HTTP 503 was not tested, so the 503 body and whether it carries Retry-After are unverified.
- The REST book cap above 200 levels is untested, because no book had more than 50 levels per side.
- Fee docs disagree: the live fees data (as of February 2026) says 0.10 % taker and a maker rebate of 10 % of the taker's fee, with scaling tiers from 1 BTC over 30 days.
  A three-year-old help article says 0.25 % maker and taker with a sliding scale from 100 BTC.
  Which asset a ZAR-market fee is taken in is also contradictory.
- MakerPpm -100 is derived: the maker pays 0 % and receives 10 % of the taker's fee, which is 100 ppm of notional only when the taker is on the base tier.
- The terms' FAIS sentence says ChainEX is not a licensed FSP, while the footer states FSP number 53799.

### Giottus

Verdict: no public API.
Giottus does list perpetuals, but its documented public API (api.giottus.com) is spot only, and guessed futures paths return 404.
There is also no CCXT class.
The futures catalog, book and anchors are public only through the web page and its undocumented Socket.IO feed.
That feed gives 10 levels every 2 s, with no sequence and one pair per socket.
Its contents are Binance USD-M's book, mark, index and funding for the same contract, about 0.3 to 0.6 s late.
So even a scraped feed would duplicate the engine's existing Binance leg rather than add an independent one.

Blockers:

- No documented futures REST or WebSocket API: api.giottus.com documents spot only, and /api/v1/public/futures/* returns 404 -1404.
- No CCXT class in 4.5.68 or in current master 4.5.82.
- The only futures book is an undocumented internal Socket.IO feed: 10 levels, a full snapshot every 2 s, no sequence, one pair per socket, and about 250 to 300 KB/s of broadcast per socket.
- The perpetuals are Binance USD-M contracts behind a broker front end (exchange_id 1, -BN trade ids, terms D8.1).
  Book and anchors equal Binance's, so this is no independent price source.
- The INR-M family is Binance times a fixed 104 INR/USDT (since 2026-08-07), while spot USDT/INR was about 99.2.
- Access is limited to residents of India or unnamed supported jurisdictions, with PAN and Indian bank KYC.

Open questions:

- What a logged-in VIP 0 futures account pays today.
  The fee page says 0.048% taker plus 18% GST (566.4 ppm), but the page shows visitors 0, and the zero-fee futures promotion was dated to end 2025-10-31.
- Whether Giottus settles funding to users at exactly Binance's rate and instant.
  There is no funding history endpoint, and the settlement instant was not captured.
- Why funding_frequency differs from Binance fundingInfo on 5 USDT pairs (G, MTL, ONE, SPY, T), and between the USDT and INR rows of XAU, HMSTR and BZ.
- Whether an unchanged book is re-sent on the 2 s clock for a quiet pair (only BTC was subscribed).
- Unit of deductibles.liquidation_fee (0.0125 to 0.025), read here as a fraction of position value.

### Bit2c

Verdict: spot only.
Bit2c lists no perpetuals, only 4 live spot pairs quoted in NIS.
NIS is outside the engine's USD, USDC and USDT family.
The connector keeps only active swaps (connector.ts line 79, with the filter at lines 196 to 203), so Bit2c would load an empty catalog and be skipped.
The venue also has no documented WebSocket, and it publishes no index, mark or funding.

Blockers:

- No perpetual product of any kind, so CCXT returns zero swap markets and connector.ts lines 49 to 51 skip the venue.
- Every live market is quoted in NIS, outside the USD, USDC and USDT settlement family.
- No documented WebSocket API.
  The only push feed is the site's undocumented SignalR hub, which gives 10 levels per side against the engine's 20.
  It needs a negotiate token per connection, but VenueFeed.ts line 81 opens a fixed plan.url.
- No index, mark or funding, so any route with a Bit2c leg would have mark 0 and be refused at open.
- CCXT 4.5.68 market.taker is undefined on all four markets. safeMarketStructure in bit2c.js lines 167 to 170 overwrites fees.trading through deepExtend (Exchange.js lines 3732 to 3735).
  Without a registry takerPpm, the connector drops every market.
- Trading is limited to Israeli residents with an Israeli identity card.

Open questions:

- No rate limit is published.
  CCXT paces the class at 3,000 ms, and about 500 requests at 1 per second or slower were never refused, so the real limit and how a refusal looks are unknown.
- Whether using the site's SignalR hub from an API client is allowed or stable is not documented.
  Token reuse across connections was not tested.
- The CCXT exchange-level fee constants (taker 0.03, maker 0.025, 12 tiers) use the same NIS thresholds as the live page but different rates (1.25% to 0.05%).
  They are probably an older schedule.
- The account API returns FeeMaker and FeeTaker separately per pair, but the public page shows one rate for both.
  Whether they differ for an account needs a key.
- The Date header clock bounds from two runs did not overlap (-1,029 to -539 ms, then -397 to +128 ms), so the server clock offset is unknown below about 1 s.
- The FIX API (/FixAPI/index) sits behind a login and was not examined.
- The payload shapes of TradesUpdated_<pair> and UpdateLastKline_<pair> were not captured (one of each was seen in 300 s).

### ALP.COM

Verdict: spot only.
ALP.COM lists no perpetual of any family: its web app labels "Futures" as "Coming soon", and CoinGecko's derivatives list (214 entries) has no entry for it.
It also publishes no index, mark or funding.
It has no CCXT class either: CCXT renamed btcalpha to alp on 2026-01-15 (#27571) and delisted it on 2026-03-23 (#28221) after the v1 API shut down, and v3 was never implemented.
Its spot market is 22 pairs (11 USDT, 11 USDC) at a VIP 0 taker of 0.15%.
The spot book is a one-second 20-level snapshot feed, and some books are stubs or phantom quotes.

Blockers:

- No perpetual market in any family (USDT-M, USDC-M, coin-M), and no dated futures or options.
- No CCXT class in 4.5.68 or current master (alp was delisted 2026-03-23), so the engine's loadMarkets swap catalog cannot load the venue.
- No index, mark or funding, so there is nothing for an AnchorPoller to read.
- The book feed is a 1 s whole-book snapshot of 20 levels with no snapshot on subscribe, and the documented diff channel is silent.
- DOGE_USDT shows a phantom ask of 59,511 DOGE at 0.08368, about 19% below where every recent trade printed, which is a false-cross hazard.

Open questions:

- The legal entity and licences: the terms name only 'ALPCOM' with no jurisdiction, and CoinGecko's claim of El Salvador and Polish licences was not checked against a register.
- Whether the DOGE_USDT ask at 0.08368 can actually be hit, which would need an order.
- Why the server sends WebSocket protocol pings instead of the documented text '1', and drops a client that sends text '1' or '2'.
  Also whether the documented 30 s pong timeout is enforced at all: a socket that never ponged stayed open for 120 s.
- The REST rate limit, since the docs list only a 429 TOO_MANY_REQUESTS slug with no window and no Retry-After.
- How /api/v3/currency-rates is computed and how often it refreshes.
- What market_depth sends when a book side empties (not observed).
- Why the PRO fee tiers charge more than VIP-9 or the same, and what assigns an account to them.

### Kinesis Money

Verdict: spot only.
Kinesis lists no perpetuals, dated futures or options.
It has 162 spot pairs, mostly quoted in its own Currency One stablecoins and in KAU (gold) and KAG (silver).
CoinGecko lists no Kinesis derivatives either.
So it cannot be a perpetual leg.
As a spot venue it would also need a hand-written connector, because CCXT has no class.
Its only keyless market data is the web app's undocumented backend, and its terms forbid automated data feeds without written consent.

Blockers:

- No perpetual, future or option of any kind: 162 spot pairs only.
- No CCXT class in 4.5.68 or in CCXT master (commit 1d8b674, 2026-09-22), so loadMarkets cannot build the catalog.
- The documented API (client-api.kinesis.money, published only as example code in github.com/bullioncapital/kinesis-api) needs an account API key even for pairs, depth and mid-price.
  Unsigned calls get 403.
- Keyless market data exists only on the web app's undocumented backend (fastapi.kinesis.money REST and Socket.IO), which can change with any web release.
- Terms of Use Schedule 7 clause 5.1.4 prohibits 'Data feed or data stream services that make use of any market data from Kinesis' without written consent.
  Clause 5.1.6 prohibits robot or script access.
- The depth socket carries one pair per connection and has no sequence number.
  Updates arrive at most about once a second per side, with quiet sides silent for up to 41 s.
- Only 8 of 162 pairs quote in USDT or USDC.
  The rest quote in C1 stablecoins, KAU, KAG or BTC.
- Thin volume: about 1.0M USD in 24 h across 34 CoinGecko tickers.

Open questions:

- The exchange's excluded countries are not published, and US-resident eligibility for the exchange is not stated.
- The terms say the 0.22% fee is debited in the base currency, but the catalog's fee field names the quote currency on all 162 pairs.
  This was not verified, because checking it needs a trade.
- The meaning of the catalog's orderRange field (0.1 to 0.5) is not documented.
- No rate limit is published for either API.
  The probe stayed at or under 2 requests per second and was never refused.
- Every pair has at least 8 levels a side with regular price steps, which suggests one house liquidity provider.
  The terms say Kinesis is the immediate counterparty.
  The book's independence is unverified.
- The capacity of 162 simultaneous depth sockets (one per pair) was not tested. 40 opened without refusal.

### INEX

Verdict: no public API.
INEX lists no perpetual: it is one 11-pair USDT spot market.
Its documented Open API refuses every REST call and the WebSocket handshake without a JWT, and a JWT needs a KYC'd account that only Korean nationals can open.
That includes the endpoints the docs call public.
The only readable data is the website's own undocumented socket and ticker.
The book is a thin market-maker ladder: touch levels of at most 34.40 USDT, 70 to 242 USDT per side, spreads of 1,582 to 9,229 ppm.
The fee is 0 % maker and taker (policy from 2026-09-23 00:00 KST, 0.1 % before that), and there is no CCXT class.

Blockers:

- No perpetuals: one USDT spot market with 11 pairs, no margin, no derivatives.
- The documented Open API (REST and WebSocket) returns HTTP 400 empty_token without a JWT, even for /v1/symbol/all and the WS channels the docs call public.
  A JWT needs an API key, and a key needs an account that has passed KYC.
  The FAQ says foreigners cannot pass KYC.
- No CCXT class in 4.5.68 or in master 4.5.82, so there is no catalog.
- No index, mark or funding, so no anchor exists.
- The only readable book is the undocumented website socket.
  Its frames are zlib-compressed, which no current VenueFeed subclass decodes, and it sends whole books with no sequence.
- The books are too thin to trade: no touch above 34.40 USDT, and far below the engine's MIN_EDGE_NOTIONAL of 1,000 quote units.

Open questions:

- The zero-fee policy (S4) has no end date.
  What was the fee for regular members between the 0.1 % in the trading guide and the per-member 0 % from 2025-04-23?
  Only the 0.1 % general-order rate is documented.
- Why does the Open API refuse /v1/symbol/all and the WS channels without a token when the docs call them public?
  A doc error and a gateway misconfiguration were not told apart.
- Does depth_step0 cut a deeper book to a window?
  No public REST book exists to compare against, and at most 20 levels were seen.
- Is the book frames' roughly 500 ms stamp-to-send delay (acks arrive about 90 ms after their ts, books 592 to 603 ms, up to 2,200 ms in one bundle) server batching or clock skew between hosts?
  This is inferred, not verified.
- Is the Pro-Trader program still running?
  Its event-end notice of 2025-05-19 was not read.
- Can a Korean national living in the US trade?
  The help center does not say.

### Bitexen

Verdict: spot only.
Bitexen TR lists no perpetual, futures or options product, and its feature flags carry no derivatives flag.
Its public API lists exactly one order book market, USDT/TRY.
Other coins trade only as instant resell pairs, which have no public book.
The one market is quoted in TRY, which the quote family does not merge with USDT.
No CCXT class exists in 4.5.68 or in current master.
The socket is undocumented.
The published spot fee is 0.15% maker and 0.25% taker.
Turkish VAT (KDV) of 20% is added on top, so the all-in cost is 1,800 ppm maker and 3,000 ppm taker.
The sibling global.bitexen.com flags derivatives on, but its derivatives host gmod-api.bitexen.com answered HTTP 530 with Cloudflare error 1016 (origin DNS error), so no Bitexen perpetual was reachable.

Blockers:

- No perpetuals: /api/v1/market_info/ lists one spot market (USDTTRY), and feature_status on www.bitexen.com has no derivatives flag.
- The only order book market is quoted in TRY, which is outside the USD/USDC/USDT quote family.
- No CCXT class in 4.5.68 or in master commit 1d8b674 of 2026-09-22.
- No documented WebSocket: the socket.io v2 feed is the web app's internal feed and can change without notice.
- Trading needs a Turkish Republic ID document, so only Turkish nationals and foreign residents of Turkey can verify.
- No index, mark or funding for an anchor poller.
- Bitexen Global's derivatives backend gmod-api.bitexen.com returned HTTP 530 with Cloudflare error 1016 on 2026-09-22.

Open questions:

- The terms of the referral and commission rebate programme ('Yeni Referans ve Komisyon İade Programı', feature flag reference_fee_rebate_v2) were not read.
- Pricing of the instant buy and sell (resell_market) pairs was not researched.
- Who operates global.bitexen.com (the help center has a 'Bitexen ADGM' category), and whether its derivatives backend will come back.
- The documented REST limit of 60 requests per minute (HTTP 429) was not tested, and whether a Retry-After header comes with it is unknown.
- Subscribing to several markets on one socket was not tested, because only one order book market exists.

### Kanga Global

Verdict: spot only.
Kanga lists no perpetual.
Its "Futures" are leveraged contracts against the operator: one operator price, maturity dates with optional rollover, a flat Funding Fee, settlement in the internal unit KXT, and no order book.
There is also no CCXT class (4.5.68 or master 4.5.82), no index, mark or funding for an anchor, and a spot socket that keeps only one market live per connection on a 3 s push cycle.

Blockers:

- No perpetual contract: the only derivative is an operator-quoted, dated, KXT-settled leveraged futures product with no order book.
- No CCXT class in 4.5.68 or in current master 4.5.82 (ts/src/kanga.ts is 404), so the CCXT swap catalog loads nothing.
- No index, mark or funding rate anywhere, so every route would be refused as anchor_missing or anchor_no_mark.
- The WebSocket is undocumented Socket.IO: only the last subscribed market per socket updates (one socket per market, about 245 for the USD family), pushes come on a cycle of about 3 s, there is no sequence, and VenueFeed JSON-stringifies subscribe frames, so raw Socket.IO packets would have to be sent from handleMessage.
- The REST book is a snapshot cached for about 120 s, so it is useless for freshness checks.

Open questions:

- What the socket sends for a market with an empty side, and for a delisted market, was not observed (no status field in the catalog).
- Whether `unsubscribe market` stops a live market was not verified.
- How many parallel sockets one host may hold beyond the 10 tested, which matters if a spot feed ever needs about 245.
- The futures Funding Fee settlement interval and the maturity dates live in a Fee Table that no public call returns.
  The settlement instant was not captured.
- Whether the 302 from trade.kanga.exchange is a geographic rule for the Canadian exit or a retired host.
- The meaning of the `indexedMarket` and `indexedPayingCurrency` fields in POST /api/markets is undocumented.

### Vindax

Verdict: spot only.
Vindax lists no perpetual, dated future, option or margin product, so it cannot be a perpetual leg.
It also has no CCXT class, so the engine has no catalog path for it.
Its only book feed is an undocumented Socket.IO stream bundled at about 1.4 s.
No spot fee could be verified, because the fee page and its API sit behind a Cloudflare challenge.

Blockers:

- No perpetuals of any family: spot only.
- No CCXT class in 4.5.68 or master, so the engine's loadMarkets catalog cannot load it.
- No index, mark or funding, so there is nothing for an anchor poller.
- Book stream is an undocumented Socket.IO 2 / Engine.IO 3 protocol with per-symbol namespaces and no snapshot.
  A feed would need a Socket.IO framing layer and a REST snapshot resync within 50 counted REST requests per minute.
- Depth frames are bundled every 1.1 to 1.6 s per symbol, slow next to the engine's current venues.
- Fee schedule unverifiable from this host: vindax.com pages and /bapi/public/exchange/getFeeLevels return a Cloudflare challenge.
- The venue excludes US and Canadian persons.

Open questions:

- Spot VIP 0 maker and taker, the tier table and any VD token discount: they need a browser that passes the vindax.com Cloudflare challenge, or an account.
- Legal entity and full list of excluded regions: the terms page could not be read.
- Cause of the 3 sequence gaps in the all-symbol one-socket runs (TRXBTC skipped 2 ids, ASTERUSDT 9): dropped frames on a crowded socket, or ids never published.
- Whether server data alone keeps an Engine.IO socket open without client pings.
  Only an idle socket and one on a quiet book were tested, and both closed at about 46 s.
- REST depth sometimes shows the same price and size as both best bid and best ask (3 of 20 logged reads).
  The cause is unconfirmed, and it may be an order caught mid-match.
- CoinGecko's API gave trust_score_rank 154 on 2026-09-23, while the task named rank 147.
- Whether a ticker or book-ticker namespace exists: the 2021 mktdatastream.factory.js was not archived, and 15 guessed names were all refused.

### Cryptal

Verdict: spot only.
Cryptal is a small Georgian spot and broker exchange (69 tradable pairs, about 10.65 BTC of 24 h volume on CoinGecko) with no perpetual of any family, no CCXT class and no index, mark or funding.
Its only socket is the web client's undocumented one, and that socket refuses a plain client.
Its books are wide quoting ladders: median ticker spread about 33,000 ppm across 69 pairs, BTC-USD about 29,000 ppm.
Its USD quote is Cryptal's own TOUSD balance token (BEP20), not a bank dollar or a major stablecoin.

Blockers:

- No perpetuals of any family: nothing for the engine's swap-only catalog (connector.ts isActiveSwapMarket) to load.
- No CCXT class in 4.5.68 or in master, so the connector has no catalog source.
- No documented WebSocket.
  The web client's socket wss://wss.cryptal.com/gex closes every plain-client connection with 1002 'Protocol error' right after the upgrade, and the client code shows no sequence number for gap detection.
- No index, mark or funding for an anchor poller.
- US persons cannot be verified (the 42-country citizenship exclusion list includes the USA).

Open questions:

- Is the WS refusal an Origin check?
  The probe never sent Origin: https://cryptal.com, because that would impersonate the website to get past its check.
  The user should decide whether that test is acceptable, or whether Cryptal should be asked for API socket access.
- Should a TOUSD-quoted pair (Cryptal's 'USD', a Cryptal-issued BEP20 fiat token) ever join the USD/USDC/USDT quote family?
  USDT-USD traded at 0.9901 bid / 0.9960 ask on 2026-09-23 UTC.
- What the REST limit returns when exceeded is unknown: status, body, Retry-After.
  The headers advertise a 20/20 token bucket, and it was not provoked.
- Which regulator issued the footer's 'license 0002-9404' is not stated on the site.

### INX One

Verdict: no public API.
INX One cannot join as a perpetual leg.
It lists no perpetuals, so it is spot only.
It has no CCXT class, and every documented market data call needs an account and an approved API key: the REST market list, the ping, and the book socket token.
Its book frames also carry no sequence, so gaps cannot be detected.

Blockers:

- No perpetuals: spot crypto against USD and security tokens only.
- No public market data: POST /api/market/getMarkets, GET /api/ping and the websocket all need an approved API key with signed headers (401 without them).
- No CCXT class in 4.5.68 or in current master.
- The book socket needs a websocket token from a keyed REST call, used within 30 s, one per connection, and it allows 5 subscriptions per key.
- Book frames carry no sequence or checksum, so a feed cannot detect a gap.
- Cloudflare blocks requests with no User-Agent on both API gateways, and the engine's VenueFeed opens sockets with no User-Agent.
- Web app host trading.republic.com and the help center return Cloudflare 403 to this host.

Open questions:

- Whether non-US residents may open an account: not published on the pages this host could read, and the help center refused this host with Cloudflare error 1034.
- Whether the trading.republic.com 403 is a geoblock or bot protection: a fetch that does not leave from this host also got 403.
- Level order, idle behaviour, unknown-symbol reply, how snapshot and delta frames are told apart, and whether the keepalive ping is a protocol or text frame: not documented and not probeable without a key.
- The crypto trading fee (0.3 % maker, 0.4 % taker) has no effective date on the fee page.

### BitBNS

Verdict: blocked.
BitBNS lists 20 USDT-M perpetuals, but CCXT 4.5.68 models only spot, so the connector finds 0 swaps.
The perp catalog, book and funding exist only as undocumented web-app routes and Socket.IO rooms.
The book has no sequence and its frames name no instrument.
No REST index, mark or funding bulk call exists.
The market is effectively dead: 19 of 20 perps did not trade in 24 h, 6 books are empty, and BTC last traded at 7,841 against an index near 86,900.

Blockers:

- CCXT 4.5.68 bitbns is spot only ('swap': false at bitbns.js line 32), so loadMarkets yields 0 swap markets.
- The perp catalog is either a signed POST (futuresInstList) or an undocumented web-app GET (futures-testnet/getInstDetails?network=mainnet).
- The perp book is an undocumented Socket.IO room: no sequence, no checksum, no timestamp, and frames name no instrument, so one socket per instrument is needed.
- No REST anchor: the index comes only from a socket every 5 s, the mark is not published (it equals the index), and funding is only a per-instrument history of settled rates.
- The market is dead: 1 of 20 perps traded in 24 h (0.0006 BTC), 6 books are empty, and BTC printed 91 % below its index.
- BNSUSDTP has a self-referential index (BitBNS's own BNS spot price), and 1000SHIBUSDTP is quoted per 1,000 SHIB.

Open questions:

- Does switchRoom leave the previous room, or can one socket hold several perp rooms?
  Frames name no instrument, so this was not determined.
- Perp book updates were never observed (no activity in 38 s).
  Whole-side replacement is inferred from the spot sibling and from the web app code.
- The perp size unit (base coins) and the funding unit (percent) are inferred from magnitudes and from the 0.5 % cap.
  No page states either.
- Spot trades at roughly 35 to 80 % of the global price (BTC/INR bid at 47.5 %).
  The published config says crypto transfers are enabled, so the cause of the discount is not established.
- The perp level window was not reached (at most 11 levels).
  The spot socket caps at 15, below the engine's 20.
- The futures maker is 0 % as an introductory offer with no end date.
  The list price is 0.1 %, and the web app's default store still says 0.1 %.

### NBX

Verdict: spot only.
NBX lists no perpetual.
It is a small NOK, EUR and USDM spot venue with no CCXT class, whose events socket has no snapshot, sequence or checksum.
Since about June 2026 most of its markets show no order book to customers (an article says only VT, GNRC, PALM, FGLD and FSLVR keep one) and carry a flat 0.70 % brokerage fee.
Its API origin also timed out (522) for every request from this host.

Blockers:

- No perpetual futures of any family, so there is nothing for the engine's perpetual leg.
- No CCXT class in 4.5.68 or in master 4.5.82, so the catalog would need a custom loader.
- Api.nbx.com REST and WebSocket returned Cloudflare 522 (origin connection timeout) to every request from this host and to WebFetch, and returned a 403 firewall block to curl's User-Agent.
- The socket is order-level with no snapshot, no sequence and an always-null checksum, so a local book cannot detect a gap or resync.
- The order book was phased out for most markets by 2026-06-27, and those markets now trade at a 0.70 % brokerage fee.
  The remaining book markets (VT, GNRC, PALM, FGLD, FSLVR) are quoted in EUR and USDM, outside the USD, USDC and USDT quote family.
- The 0.70 % VIP 0 taker (7,000 ppm) is flat, with no volume tiers.
  Only qualified market makers pay 0.20 %.

Open questions:

- Does the api.nbx.com origin answer non-North-American Cloudflare colos, or only allowlisted fetchers?
  CoinGecko's record showed last_fetch_at 2026-09-23T04:51:40Z while this host got 522.
  Testing this would need another network, which is not allowed.
- Whether ORDER-CLOSED carries the original or the remaining quantity, and whether partial fills must be subtracted from maker orders using TRADE-CREATED, is not documented and could not be probed.
- Which markets still have a public API order book after the June 2026 change?
  CoinGecko still reported a 1.21 % BTC-NOK spread on 2026-09-22.
- The jurisdictions NBX serves are not published.
  The operating rules say only that access is limited to jurisdictions where NBX offers its services.

### EXMO

Verdict: defunct.
EXMO lists no perpetual, dated future or option (CCXT swap false at exmo.js line 30, 0 swaps from loadMarkets).
The exmo.com platform announced an orderly wind-down on 2026-07-14: registrations and deposits are closed, 29.4 % of balances became a non-tradable claim token, and trading remains only as asset conversion.
Its 24 remaining pairs are all quoted in USDC at a flat 1 % maker and taker.
Each book holds a single quote about 10 % either side of a stale reference (spread about 200,000 ppm), and nothing changed in two 60 s ticker runs or two 100 s socket runs.
The sister platform exmo.me (one BTC_USDT pair) is in liquidation too.

Blockers:

- No perpetual of any family exists, so the engine's active swap filter (connector.ts lines 196 to 203) finds nothing.
- The platform is in wind-down since 2026-07-14: registrations and deposits closed, trading kept only for asset conversion before withdrawal, margin restricted to closing.
- Every one of the 24 books is a single quote band about plus and minus 10 % around a reference that sat 1.1 to 5.9 % under Kraken's mid and did not move during the probes.
- The WebSocket book channel has no sequence or checksum, so gaps cannot be detected.

Open questions:

- The UK sanctions designation was taken from EXMO's own notice.
  It was not checked against an official UK list because the shared web search budget was spent.
- The delta frame shape of spot/order_book_updates was never seen on the wire, because no quote changed during the probes.
- The spot tier table on exmo.com/commissions is rendered by script and was not read.
  Only per-pair fees are known: 1 % now and mostly 0.1 % on 2026-06-02 per a Wayback snapshot.
- It is unknown when the platform will stop answering its public API altogether.

### Nonkyc.io

Verdict: fits with a named change.
NonKYC's perpetuals are not its own book. perp.nonkyc.io is the Orderly builder `nonkyc` on Orderly's shared book, the same book already surveyed as Niza.fun.
NonKYC's own perp flow was 9,904 USDC in the last day, about 0.026% of Orderly's 38.3M.
The Orderly book fits the engine's shape: a delta feed with a prevTs chain plus a snapshot topic, and a one-call anchor with index, mark, rate and next settlement.
The named change is to register it with createExchange `new ccxt.woofipro()`, since no NonKYC class exists.
It also needs a marketFilter that keeps only /^PERP_[A-Z0-9]+_USDC$/, because woofipro sets active to undefined and would pass the 59 other-builder markets.
The feed needs 50 markets per socket for the 100-topic cap.
The engine should carry at most one Orderly leg.
At 1,500 ppm NonKYC is the dearer Orderly route, against the 500 ppm niza.fun shows.
That 1,500 ppm maker and taker is the fee rate Orderly's public feeRate query returned for NonKYC's own published builder account, which has never traded.
The docs give the unit as bps/10,000, so 0.0015 is 15 bps.
The rate is not a published schedule, and Orderly's floor is 300 ppm.

Blockers:

- No NonKYC CCXT class.
  The catalog has to come from new ccxt.woofipro() with a marketFilter for the 80 shared PERP_<BASE>_USDC markets.
- It adds no new book.
  Every Orderly builder, Niza.fun and WOOFi Pro included, shares this one, so the engine should carry at most one Orderly leg.
- US persons may not trade, by Orderly's terms, which bind NonKYC as an integrator.

Open questions:

- Does NonKYC's default user fee equal the 0.15% maker and taker read on the builder's own account?
  Only the builder's private API or a trader's wallet query shows the real default.
- Does the one-time `request` orderbook event's ts sit on the delta chain?
  If so, it would let 100 markets share a socket instead of 50.
- What status code and Retry-After does an Orderly REST rate-limit refusal carry?
  The limit was never reached.
- What does the socket send for an empty or one-sided book?
  None was seen.
- Do the three 1000-scaled markets (1000BONK, 1000PEPE, 1000SHIB) need price scales, and do short tickers such as S, M, SPX, EDGE and BASED need DENIED_PAIRS lines?
- Should the survey record NonKYC's perpetuals as Orderly rather than as a separate venue, like Niza.fun?

### Upbit Indonesia

Verdict: spot only.
Upbit Indonesia lists only spot pairs, and the connector keeps only active swap markets (connector.ts lines 79 and 196 to 203), so the venue would contribute zero markets.
As a spot venue the protocol is clean: whole-book 30-level snapshots and frames with no sequence, reached through CCXT upbit with a host option.
But the fees are high: 5,100 ppm maker and taker on USDT and BTC pairs, and 3,300 taker / 2,300 maker on IDR, against a CCXT constant of 2,500.
The volume is thin: the USDT market turned over about 0.95 to 1.01 M USDT in 24 h, and the IDR market about 3.8k USDT.

Blockers:

- No perpetual of any kind.
  The connector filters to active swaps (server/src/ccxt/connector.ts lines 79 and 196 to 203), so zero markets load.
- CCXT's default host is Upbit Korea (api.upbit.com).
  A registry entry would need new ccxt.upbit({ hostname: 'id-api.upbit.com' }).
- CCXT market.taker is 0.0025 (2,500 ppm) on every pair, against the real 5,100 ppm on USDT/BTC and 3,300 ppm taker on IDR (guest fee table at ccxid.upbit.com and notice 4087).
- Liquidity is thin: 131 of 150 USDT pairs and 31 of 32 IDR pairs turned over under 1,000 USDT in 24 h, and the IDR-BTC spread was 2.1 to 2.6 %.
- Onboarding requires Indonesian identity or a KITAS/KITAP stay permit, so no US-based or Canada-based non-resident account.

Open questions:

- The socket and REST behaviour of a delisted or suspended pair was not probed, because none was available.
  The catalog has no status field, only market_warning NONE/CAUTION.
- Whether the documented 418 block reply carries a Retry-After or a duration field was not probed.
  No limit was provoked.
- Why the wire idle timeout is about 61 s when the global docs say 120 s.
- The web site's own undocumented feed wss://crix-websocket-id.upbit.com/websocket was not probed.
- Deposit and withdrawal fees were not recorded (lookup: https://id.upbit.com/service_center/fees).

### Buda

Verdict: spot only.
Buda lists 26 spot markets and no perpetual, so it cannot be a perpetual leg.
It also has no CCXT class for the catalog and no index, mark or funding for an anchor.
Only BTC-USDC (0 volume in 24 h) and USDT-USDC are quoted in the USD/USDC/USDT family.
Even as spot, a feed would need two things the engine lacks: a REST seed on open and a per-price size lookup for the increment deltas.

Blockers:

- No perpetual, dated future or option is listed.
  Spot only: 7 CLP, 7 COP, 7 PEN, 3 BTC and 2 USDC markets.
- No CCXT class exists in 4.5.68 or in current master, so connector.ts loadMarkets cannot build a catalog.
  The registry.ts createExchange at line 29 needs a ccxt.Exchange.
- No index, mark or funding is published, so every route would be refused as anchor_no_mark (anchorReading.ts lines 37 to 38).
- Only BTC-USDC (0.0 BTC traded in 24 h on both runs) and the stablecoin pair USDT-USDC fall in the USD/USDC/USDT settlement family.
  All other markets quote CLP, COP, PEN or BTC.
- The book feed would need a REST order_book seed on open, because nothing is sent on subscribe and VenueFeed has no seed hook.
  It would also need a per-price size map, because the deltas are increments and OrderBook.setBid/setAsk take absolute sizes with no getter.

Open questions:

- Whether the book-sync period (177.87 s and 2 x 178.98 s observed) is fixed or drifts, and why it differs from the documented 5 minutes.
- Deep-level drift: after resetting from one book-sync, applying 178 s of changes with no missed Nchan id disagreed with the next book-sync on 2 of 26 markets (USDC-CLP 153 vs 150 levels, USDT-CLP 126 vs 124).
  Two REST levels (BTC-CLP bid at 60 CLP, ETH-CLP bid at 2,603,889.1) had no delta explaining them.
  The cause was not found.
- A multiplexed last_event_id resume replayed 43 of 47 messages.
  Not verified whether the 4 missing were on the channel marked '-' in the id.
- How the 13 volume tiers from GET /tiers apply to the stablecoin markets, whose base fee is 0.5% taker and 0.2% maker, is not publicly specified.
- Two regulatory statements conflict: the terms say CMF-regulated under Ley 21.521, the fee page footer says not regulated by the local financial regulator.
  Neither was checked against a CMF register.
- The fee page tier table is rendered client-side and could not be read (403 live, table absent from the archived HTML).
  Tiers came from the undocumented public GET /api/v2/tiers.

### KoinBX

Verdict: blocked.
Every KoinBX perpetual is a Binance USD-M contract margined in INR.
Its book socket forwards one Binance @depth20@100ms frame in five, about 240 ms late, with every price moved outward by a fixed per-contract shift, so as a leg it only shows KoinBX's markup against Binance.
It also has no CCXT class, an undocumented Socket.IO socket and futures REST, and a bulk anchor call without index or next funding that takes seconds.
No contract settles in the engine's USD quote family, and only Indian residents may trade.

Blockers:

- The book is Binance USD-M's @depth20@100ms frame (U and pu equal on every frame), one in five, about 240 ms late, with prices shifted outward 2 to 20 steps per contract and regridded.
  Against Binance it shows only KoinBX's markup, and it never crosses except through tiny extra levels (the furthest was about 44 ppm on 0.002 XAU, far under the 500 ppm taker).
- Every contract is margined in INR, including the 329 USDT-quoted ones, so nothing settles in the engine's USD, USDC or USDT quote family.
- Only Indian residents with KYC-verified KoinBX India accounts may trade futures.
  KoinBX Global futures are not live, and US persons are excluded.
- No CCXT class in 4.5.68 or master (issue #23686 is open), so the catalog would need a custom loader from the undocumented exchangeInfo, which takes 27 s to over 150 s for 715 KB.
- The socket is undocumented, speaks only Socket.IO 4 over Engine.IO 4 (Azure Web PubSub), and acknowledges unknown topics as success.
  One subscribe with a string params stalled every socket of this host for 26 to 39 s.
- Anchor: the only bulk REST call (marketInfo) has mark and funding rate but no index and no next settlement, and takes 0.5 to 16.4 s.
  The index exists only on a per-contract socket topic.
  Mark and index are Binance's anyway.

Open questions:

- Whether the extra book levels are KoinBX users' resting orders (inferred from fixed, often round prices held for minutes), and whether a KoinBX taker actually fills at the regridded prices.
- Whether the string-params stall reached other KoinBX clients or only this host, and whether the unknown event name sent beside it had any effect.
- Which Azure region hosts kbx-futures-prod.webpubsub.azure.com.
  A Socket.IO ping took about 240 ms from the Canadian exit.
- What conversionRates INR_MARGIN_USDT and INR_SETTLEMENT_USDT of 102 are used for, when the wire converts at a fixed 95.55.
- The funding formula, cap and settlement instant (not captured), and what lr and st on the mark frame mean.
- Whether u can go backwards on the book socket, and what a one-sided or empty book looks like (never seen).
- Whether KoinBX Global futures, once live, will offer USDT margin and a book not copied from Binance.
- Prices of the India variant's Gold and Platinum futures passes (not published to this host).

### OmniX

Verdict: blocked.
The book is live and reachable.
The anchor is not usable: the index is frozen 27% to 36% below the market on BTC, ETH and SOL, 26 of 39 checked contracts are 3.9% to 67.7% off, and the mark is derived from that index.
The engine's move guard cannot catch a price that never moves.
On top of that there is no CCXT class, and every socket frame is gzip compressed inside the frame.

Blockers:

- The anchor is frozen: indexPrice has not moved on 26 of 39 contracts checked against Gate's index, for example BTC at 63,050.02 against about 86,470. tagPrice follows it, so a poller would judge the legs against a price 27% to 36% below the market.
  The anchor_moving guard cannot see a price that never moves.
- No bulk mark call: /fapi/v1/index needs one request per contract, 45 of them. /cmc/specifications is bulk but has no mark, and its next_funding_rate_timestamp is stale on 22 of 45 rows.
- There is no CCXT class in 4.5.68 or in master (commit af2441ab5b), so the catalog needs a custom connector instead of loadMarkets.
- Every WebSocket frame is gzip compressed inside a binary frame, pings included, so handleMessage must unzip each message.
  That takes about 64 to 92 µs per frame, roughly 2.5 times the JSON parse.
- The book channel has no sequence number or checksum, and its timestamp is a whole second.
  Unknown symbols come back as empty books with no error.
- The OmniX brand has no API or documentation of its own.
  The API lives on CoinChief hosts (coinchief.live and coinchief.work), and no legal entity, terms or fee schedule is published.

Open questions:

- Which rate is actually settled, currentFundRate or nextFundRate?
  No public funding history exists, and the settlement instant was not captured.
- What are the funding cap and floor?
  The formula names them but gives no values. nextFundRate reads 0.0075 on 20 contracts and 0.015 on 2, which looks like a cap being hit.
- Is the index for the 13 live contracts just the venue's own last price?
  It equalled the CMC last_price exactly on 9 and on 8 of those 13 in two runs.
- What does limitCountryList ["980"] in the config mean, and may US persons trade?
  Neither is published.
- Are the 600 and 250 ppm fees real?
  They come only from the venue's CMC feed and CoinMarketCap.
  No official fee page or tier table exists.
- Is the book and volume data genuine?
  The BTC best bid reached 4.7M contracts (472 BTC) at one price, and the CMC feed computes quote_volume as contracts times price with no multiplier.

### YUBIT

Verdict: no public API.
YUBIT lists 514 USDT-M and 2 inverse perpetuals, but it publishes no public market data API.
Its Open API docs are sent "to each partner individually" by support, openapi.yubit.com answers 403 to the public, and no CCXT class exists in 4.5.68 or on master.
The only interface is the web app's undocumented /mapi REST and realtime_public socket.
The terms (no automated collection without written consent) and the futures rules (no accessing undisclosed APIs) forbid using it.
Even that interface has no REST bulk anchor and no sequence rule, and its book is a 2 Hz conflated picture.

Blockers:

- No public API documentation.
  The Open API docs are distributed to partners individually, and openapi.yubit.com returns 403 Forbidden to the public.
- No CCXT class in 4.5.68 or on current master (commit 1c996ee), so there is no catalog for the engine's connector.
- Terms of Service forbid automated data collection without prior written consent.
  The Futures Trading Rules forbid 'Probing, scanning, or accessing undisclosed APIs' and VPNs, and list small-spread arbitrage as abnormal trading.
- No REST bulk anchor call: index and mark come in bulk only over the undocumented socket topic tickers.all, and funding needs one socket topic or REST call per contract.
- Book feed is conflated to a 500 ms grid with no contiguous sequence, so b1/a1 per delta is the only integrity check.
  Snapshots arrive 4 to 10 s stale with replayed deltas.
- 495 of 514 index baskets are a single source named BinanceFuture or BitgetFuture, which looks like another venue's perpetual (the self-index-style shape that produced false rows before).

Open questions:

- Would YUBIT grant Open API documentation or written consent for read-only market data access?
- What exactly are the BinanceFuture and BitgetFuture index sources (perp last, perp mark, weights)?
- Is the ticker fr the rate for the upcoming settlement or the last settled one?
  BTC read -281, -100, then -280 (scaled 1e6) within 15 minutes while 9 of 9 settled at -0.01 %.
  No settlement was crossed.
- Funding clamp bounds a and b and the mark formula and its clamps are unpublished.
- The catalog's defaultTakerFeeRateE8 of 50000 (0.05 %) and the anonymous fee-rate reply of 0.0005/0.0005 disagree with the published VIP 0 schedule of 0.04 %/0.08 %.
  Which one does an account pay?
- What does the socket send for an empty book side, and can a missed delta that leaves the top of book unchanged be detected at all?
- M1STRKUSDT appears in tickers.all (mark 0.1477, index about 0.0425) but not in the catalog.
  Is it delisted or hidden?
- Access from a US address was not tested (all results are from the Canadian VPN exit).

### UZX

Verdict: fits with a named change.
UZX has real USDT-M perpetuals and a usable public book feed and bulk anchor.
Joining the engine needs these named changes: (1) a catalog loader outside CCXT, since no CCXT class exists.
It would read /v2/products, with product_name as rawMarketId, swap_value as contractSize, and status from the web symbols call.
(2) A feed that resets the book from a whole-book frame on every push and answers server pings in handleMessage.
The parse cost is high, about 70 ms per second for 60 contracts, and resubscribes are capped at 240 per hour.
(3) An anchor poller on the bulk tickers call, plus the funding interval from the undocumented per-contract funding-history call.
(4) UZXUSDT on DENIED_PAIRS, and treating the funding rate as a copy of Binance's rather than a signal of UZX's own premium.

Open questions:

- The settlement instant was not captured.
  Is the charged rate the last Binance-copied estimate?
  Does UZX charge Binance's 4 h rate every 8 h on the contracts where Binance runs 4 h and UZX runs 8 h (9 and 8 of two 10-contract samples)?
- The funding cap/floor values, the mark formula and the index basket are all unpublished.
  Whether UZXUSDT's index basket is mostly UZX's own market is not verified.
- The HTTP status and Retry-After of a REST rate limit (the web client maps code 100429) and the penalty for exceeding 240 WS subscriptions per hour were not triggered, so both are unknown.
- What the socket sends for a one-sided or empty book was not seen.
- The documented 30 s disconnect for an unsubscribed or silent socket did not happen, and a socket stayed open 104 s while answering pings.
  Whether it is enforced elsewhere is unknown.
- The meaning of the change.swap.config frame that every new socket receives (an ICPUSDT notice) is undocumented.
- CoinMarketCap counts 38 derivatives pairs against 66 perpetuals in the venue catalog.

### Echobit

Verdict: fits with a named change.
The book side fits easily: one socket carries all 124 perps, each push is a whole book, there is no sequence to track, and sizes are contracts of multiplier.
Two changes are needed.
(1) Echobit has no CCXT class, so registry.ts line 29 (createExchange returning a ccxt.Exchange) and loadMarkets at connector.ts line 68 cannot supply the catalog.
A hand-written catalog from GET /uapi/contract/list is needed: rawMarketId = symbolId, contractSize = multiplier, active = showState true and baseId 1, with indexId kept for the anchor.
(2) No call returns mark or index in bulk.
A REST round of 1 funding call plus 248 kline calls takes at least 12.45 s at the documented 1,200 GET per 60 s, which is over the reader's 10 s ANCHOR_MAX_AGE_MS.
So the anchor has to be fed from socket subscriptions (markKline_1m and indexKline_1m per indexId, plus fund_rates) and not from a one-call REST fetchRound. takerPpm 600.

Blockers:

- No CCXT class in 4.5.68 or in master, so the registry's createExchange and the loadMarkets catalog path cannot be used without a hand-written catalog.
- No bulk REST mark or index.
  Only per-contract kline calls keyed by indexId (the REST paths on uapi are undocumented), so a one-call-per-second AnchorPoller cannot cover 124 markets inside the 1,200 per 60 s budget.
- Bulk funding over REST exists only on the website's undocumented www.echobit.com/mainapi/contract/fund/rates.
  The documented bulk source is the fund_rates socket.

Open questions:

- The legal entity is not named anywhere read, and whether US persons may trade the perpetuals is not stated.
  The US and Canada are simply absent from the restricted list.
  The FinCEN, FINTRAC and Czech VASP claims were not checked against the registers.
- The index constituent list is not published, so a basket built on Echobit's own perp (the ONE self-index trap) cannot be screened.
- The documented funding formula gives F = 0.01% whenever the premium is within ±0.05%, but BTC read about 0.0000021 to 0.0000031 while its mark sat 348 to 657 ppm below the index.
  The formula and the wire disagree.
- FundRate is read as the rate for nextSettleTime and settleRate as the last settled rate.
  This is an inference from field names: no settlement instant was captured and no public funding history call exists.
  No funding cap is published (hidden rows read -0.02).
- The cause of cut books is unknown: socket first frames and REST depth replies sometimes hold exactly 1, 5 or 20 levels at the same version (ETH limit=100 came back 20/20 on 6 of 10 reads in one run).
- A subscribed socket on a quiet book was not tested for the 60 s silence close.
  Only a busy BTC subscription survived 100 s without pings.
  The documented 5-connection and 60-per-minute limits are stated per API key, and how they apply without a key was not tested.
- Reported volume looks inconsistent with book activity: ETH-SWAP-USDT at 3.5 billion USDT per 24 h went 14.7 to 23.7 s without a book change, and the REST versions confirmed the book was idle.
- The perps traded at a standing discount to the index during the probes (median mark premium about -550 ppm BTC, -470 to -510 ETH, -920 to -1,050 ENA), so the anchor gate would explain away most crosses against other venues.
- TradFi tickers such as CL, BZ, COIN and SPY need a same-token check against other venues before they join a cluster. 1000PEPE and 1000SHIB quote per 1,000 tokens.

### CrypFine

Verdict: blocked.
CrypFine lists USDT perpetuals, but it cannot join as a perpetual leg.
Every documented public REST and WebSocket path refuses this host with a Cloudflare 403.
The docs require an allow-listed client, and futures API access is granted only by application to KYC accounts outside the excluded regions (US and Canada included) that trade 5M USDT per 14 days.
A 2026-07-30 rule also treats 300 trades a day as order brushing.
Even with access, it would need a hand-written catalog (no CCXT class) and a WebSocket-based anchor, because REST has no index and funding comes one contract per call.

Blockers:

- Every documented REST call and the WS handshake return an HTTP 403 Cloudflare block page to this host (Canadian VPN exit), and the docs require whitelisting ('You must apply for a whitelist to access all APIs!', firewall change 2026-05-13).
- The United States and Canada are Excluded Jurisdictions in the Terms of Use (Crypfine LLC, Colorado).
- Futures API needs KYC, an emailed application, and each 14-day cycle 5,000,000 USDT of futures volume with at least 50% maker, or access is revoked.
- The 2026-07-30 abnormal trading notice classes 300+ trades per UID per day, or 20+ orders an hour less than 2 minutes apart, as order brushing, with profit deduction as a penalty.
- No CCXT class in 4.5.68 or on master, so the catalog needs a hand-written loader, and instruments/list has no status field.
- No REST index, and funding is one contract per call at 3 per second, so a full anchor round takes about 10 s.
  Only WS usdt/ticker.all carries index, mark and funding together.

Open questions:

- Whether the 403 is an IP allow-list rule or a country rule (Canada is excluded).
  One exit cannot tell them apart, and no other route was tried.
- Book channel sequence rule: whether `version` steps by exactly 1 per topic, and whether a later 'insert' replaces the book.
- Whether the 5 s server 'ping' is a WebSocket protocol ping or a text frame, and whether the server honours a client that refuses permessage-deflate.
- Whether instrument_id takes 'BTC' or 'BTC-SWAP': REST docs say a bare coin, while replies and WS topics use BTC-SWAP.
- Whether the published funding rate is the upcoming or the last settled one, and what the index basket is.
- Whether sizes are in contracts: the REST depth example implies contracts of `multiplier` coins, but this was not verified.
- What GOLD(XAUT)-SWAP and the 1000-prefixed contracts would need in DENIED_PAIRS or PRICE_SCALE.
- CoinMarketCap's makerFee field reads 0.22, against 0.02% in the help center and in CMC's own description.

### Flipster

Verdict: no public API.
The documented Trading API only gives market data to API-key holders, and keys are issued through a private launch.
All five contract, ticker, funding, orderbook and symbol calls, plus the WebSocket handshake, returned 401 api.unauthorized to this host without a key.
CCXT has no class in 4.5.68 or on master, so the catalog, the book feed and the anchor poller all have nothing public to use.
The only anonymous market data is the flipster.io website's own undocumented stream, which the profiles do not recommend for the engine.

Blockers:

- Every documented market data REST call and the WebSocket handshake return 401 api.unauthorized without an API key.
  API keys come only through a private launch by request to Flipster support.
- Even with a key, the engine would need signed requests: api-key, api-expires and an HMAC-SHA256 api-signature on every REST poll and every socket connect.
  VenueFeed and AnchorPoller send no such headers today.
- CCXT 4.5.68 and CCXT master have no Flipster class, so the catalog would need a custom loader.
  The documented contract call has no base or contract size field.
- US persons are excluded (the United States is on the 62-entry restricted list).

Open questions:

- What the documented orderbook.{symbol} topic actually sends with a key: snapshot or delta, depth, any update id, level order, size unit.
  None of this is documented and it could not be probed.
- Whether Flipster grants a read-only market-data key to a non-trading or Canada-based applicant, and what the per-key RPS/RPM limits are.
- Whether the documented book shows the same zero-spread thin touch as the website book (a 150 to 760 USDT quote one tick wide, with the real book 39 to 54 ppm behind it).
  If it does, a Flipster leg would mostly produce thin_book refusals.
- Whether the ticker's fundingRate is the upcoming estimate or the last settled rate.
  The funding-info call separates the two, but the ticker is described only as the current periodic rate.
- USD1-margined perps are named in the fee, funding and zero-spread articles, but none were listed on 2026-09-23.
- Two different spot taker rates are published: 0.05% in the spot article and 0.06% in the VIP table.
  No liquidation fee is published.
- 133, then 132, of 242 contracts showed turnover24h "0" on the website table, while CoinGecko shows small non-zero volume.
  Many contracts appear to trade only a few thousand USD a day.
- The index basket is not published, so it could not be checked whether any basket is mostly Flipster's own market.

### x.me Exchange

Verdict: fits with a named change.
The book feed fits VenueFeed as a snapshot-only feed: resetBook plus publish on every gzip frame, 30 levels, all 266 perps served on one socket, public and unblocked from this host.
But no CCXT class exists, so the catalog has to be built from GET /fapi/v1/contracts plus the website's public_info (rawMarketId symbol, contractSize multiplier, a subSymbol map for the socket).
There is also no bulk REST anchor.
Index, mark and rate come per contract, a 266-call round takes about 26 s, so the anchor has to come from the market_<sym>_ticker WebSocket channel (frames up to 4.5 s apart), with interval and next settlement polled from public_info.
Both are named changes.
Screen the 41+ TradFi and pre-IPO perps for DENIED_PAIRS, and give the 1000SATS, 1000BONK and 1MBABYDOGE names the same scaled-name care as other venues.

Blockers:

- No CCXT class in 4.5.68 or master, so the connector's loadMarkets catalog cannot load the venue without a custom catalog.
- No bulk REST anchor: index, mark and funding are per contract only (266 calls, about 26 s per round at 2 in flight), so a 1 s REST AnchorPoller is impractical and the anchor must come from the WS ticker channel, which the engine does not support today.
- The book is a timer snapshot every 500 ms with no sequence, so the view can be up to 500 ms plus about 0.2 s transit behind the venue's book.

Open questions:

- X.me publishes no API documentation that could be found (the public_info open_api_url www.chaindown.com/exchange-open-api did not answer.
  Web search was unavailable to this researcher), so rate limits are unknown and no call is officially supported.
- Whether the WS ticker's mark and index equal the REST tagPrice and indexPrice at the same instant was not verified.
- Whether okex, bybit, gate and mexc index sources are spot or perpetual is not published.
  Binancefutures is Binance's futures market.
- The funding cap per contract is not published, except by announcement (HYPER ±1.5%).
- Whether the published rate resets at the settlement instant was not captured.
- The meaning of fee_coin_rate 30.00 in public_info_v4, and whether points offset the taker fee, are not published.
- Whether the VIP tiers apply today, since the VIP system is marked as being upgraded and temporarily unavailable.
- What side 0 means on the one inactive contract E-PENGU-USDT.

### AstralX

Verdict: no public API.
AstralX publishes no API documentation, and CCXT has no class for it in 4.5.68 or master.
Only account holders can create API keys.
The only public market data comes from undocumented web-front endpoints, and those show the perpetuals are an OKX shadow.
The book has the same top-20 prices as OKX's book with sizes about 0.9x.
The multiplier and tick equal OKX's on 32 of 32 contracts.
The index equals the mark, which equals OKX's mark, and the funding rate equals OKX's.
So an AstralX leg would duplicate an OKX leg about 50 ms late, read a mark premium of 0 by construction, and has no REST index or mark for the anchor poller.

Blockers:

- No public API documentation.
  Help center search found only two API maintenance notices, the doc routes return 404, and api.astralx.com is a WAF 403.
  Every usable endpoint is an internal web-front call that can change with any deploy.
- No CCXT class in 4.5.68 or in CCXT master ts/src, and no JSON catalog call.
  The contract specs exist only as a map embedded in the 4.1 MB server-rendered futures page.
- Books, mark and funding are copies of OKX.
  The top 20 prices matched OKX 20 of 20 on BTC, ETH, SOL, XRP and DOGE with sizes about 0.9x.
  The index equals the mark and the mark equals OKX's markPx. fundingRate equals OKX's digit for digit.
  An AstralX route duplicates an OKX leg about 50 ms late.
- No REST index or mark.
  Both exist only as per-symbol WS topics (64 subscriptions for 32 contracts), which does not fit the REST AnchorPoller.
  Since index equals mark, markPremium (anchorReading.ts line 83) is always 0.
- The terms prohibit anyone located in the United States.

Open questions:

- Do AstralX orders fill against OKX, as a broker or liquidity share, or against a market maker quoting OKX's book?
  This cannot be known without an account.
- Does API documentation exist behind login?
  API keys exist at /user/security/api_key/create, and the 2026-05-07 notice says perpetual API trading resumed.
- The VIP tier schedule is unreadable: the article HTML is a 403 Cloudflare challenge and the help center API returns RecordNotFound.
  Tiers above VIP 0 are unknown.
- The funding cap and floor are not published.
  They presumably follow OKX, which reports 0.00375 for BTC and 0.0075 or 0.01 for others.
  The settlement instant was not captured, and /futures/history_funding_rates returns code 330001.
- 22 of the 32 listed contracts show lastSettleTime 0, so their interval is unknown.
  OKX runs some of the same contracts, such as GIGGLE and ZKP, on 4 h.
- The delisting notice for ORDI, W, PNUT and RIVER (2026-07-07) disagrees with the catalog, where ORDI and W are still listed and traded.
- CoinMarketCap put AstralX at rank 55 when read at 06:44 UTC on 2026-09-23, against rank 53 in the brief.
  Its 7.41B USD 24 h derivatives volume is exactly the sum of the ticker qv.

### Hyperliquid

Verdict: fits with a named change.
Researched under its own plan, [`../plans/2026-09-23-hyperliquid-research-plan.md`](../plans/2026-09-23-hyperliquid-research-plan.md), with the decentralised layer in [`2026-09-23-hyperliquid-dex.md`](./2026-09-23-hyperliquid-dex.md).
CCXT's `market.id` is the numeric asset index, so `rawMarketId` must come from `market.info.name`.
The six k-prefixed perps need a price scale of 1,000, and builder-dex (HIP-3) markets stay out at first behind a `marketFilter` on `info.hip3`.
The anchor poller needs a POST helper and a 3 s cadence.

### Koinbay

Verdict: fits with a named change.
Market data is fully public and reachable, and the snapshot-only 30-level book is easy to consume, but joining needs a hand-built adapter: no CCXT class (catalog from /fapi/v1/contracts), a gunzip of every socket frame, REST and socket symbol mapping (E-BTC-USDT vs e_btcusdt), and an anchor read from the mark_price socket channel, since no bulk REST anchor exists.
Liquidity is thin and about a quarter of listed contracts are ghost books.
US persons are prohibited.

Blockers:

- No CCXT class in 4.5.68 or in CCXT master (ts/src checked 2026-09-22), so the catalog has to be built from /fapi/v1/contracts.
- Every WS frame is gzip-compressed inside a binary frame, so the generic feed needs a gunzip step.
- No bulk REST anchor call exists: index, mark and funding are per contract, or come from the mark_price socket channel.
- Funding interval, cap and whether currentFundRate or nextFundRate is the upcoming rate are undocumented.
- US persons prohibited, EU, EEA and UK refused service.
- 35 of 130 active contracts had no trade in over 7 days, and some are one-sided (E-BSV-USDT).
  They need a liveness filter.
- No public rate limit published (-1003 TOO_MANY_REQUESTS exists but its trigger and status were not seen).

Open questions:

- Which of currentFundRate and nextFundRate is charged at nextSettlementTime, and is the interval 8 h?
  A capture across a settlement is needed.
- Index basket and mark formula, and whether the mark premium is clamped.
- Whether the documented pong-or-disconnect rule is enforced: a socket that ignored 7 pings stayed open for 70 s.
- Public REST rate limit and the HTTP status and Retry-After of -1003.
- What S-BTC-USDT (EXUSD margin) and FILCOIN-BTC-USDT are.
- Server/node_modules vanished during the run (server/ is now the Rust crate), so ws-probe.mjs cannot be rerun until ws is available again.

### BITmarkets

Verdict: no public API.
BITmarkets lists about 129 USDT perpetuals (per CoinMarketCap), but it publishes no API documentation and has no CCXT class, in 4.5.68 or on master.
Every candidate REST host either returns a stored "block" error, sits behind an expired certificate, or answers 404 or 401.
The only sockets that open are undocumented web app sockets that close on the first client frame.
So there is no catalog, book feed or anchor poller to build on.

Blockers:

- No public REST or WebSocket API documentation anywhere (no docs subdomain, no API page, /en/api is 404).
- No CCXT class in 4.5.68 or current master ts/src.
- Api.bitmarkets.com serves an expired 2023 certificate and a stored {code:44444444,msg:block} body on every path, and ws.bitmarkets.com serves the same.
- Web app sockets platform-api.bitmarkets.com:8443 and :2096 close with 1000 on any client frame and send no data.
- No public index, mark or funding endpoint.
- US persons restricted (United States on the restricted jurisdictions list).

Open questions:

- Whether the web app's trading socket uses an authenticated or binary protocol (the archived Nuxt bundle holding the socket code was not in the Wayback Machine).
- Funding formula, interval, cap and settlement instant are unpublished, and whether 0.0001 is a default interest term or a cap.
- Whether the live fee page still matches the Wayback capture of 2025-10-25 (page dated 18/09/2025), since the live page is behind a Cloudflare challenge.
- Whether the restricted jurisdictions list changed after the 2024-08-05 capture (the newer restricted-jurisdictions-new document has no capture).
- Whether dated futures exist besides the perpetuals (the site menu has separate Futures Trading and Perpetuals entries).

### Batonex

Verdict: blocked.
The book feed would be easy: one socket, full-book frames, contracts sized by contractMultiplier.
But the catalog and the anchor do not fit.
CCXT has no class, so loadMarkets cannot build the catalog.
Batonex publishes no mark price, so the engine would refuse every route at open with mark 0.
Its index for 107 of 119 perps is the Binance perp mark price itself, so the fresh gate would judge a Binance-Batonex route against the Binance leg's own mark, which is the self-index failure shape.

Blockers:

- No CCXT 4.5.68 class and none in CCXT master ts/src, so the catalog needs a hand-written brokerInfo loader.
- No mark price on REST or WS: the AnchorRow mark would be 0 and every route is refused at open.
- Index is MARK_PRICE_BINANCE for 107 of 119 perps (Binance fapi mark to the last digit), MARK_PRICE_BITGET for 3, and a two-venue mark average for 5.
  That is a self-referential anchor against Binance and Bitget legs.
- US persons cannot register because the United States is absent from the registration country list.

Open questions:

- What price drives liquidation?
  The help centre says TP/SL triggers on the index or the market price, and no mark is named.
- The funding formula, cap and floor are unpublished. nextFundingRate changed only 0.04 times per symbol per minute, so it is a periodic estimate.
- Is the order book a mirror of Binance?
  One-shot bookTicker reads matched the Binance touch exactly on ETH and SOL.
  This is an inference and was not written into the profiles as fact.
- Does a subscribed socket that never pings survive the documented 5 minutes?
  The silence test stopped at 70 s.
- Do the equity and commodity perps (AAPL, TSLA, CL, SOXL) carry the same 0.07% taker?
  The commission page lists only one crypto-contract row.
- What does depth send for an empty side?
  No one-sided book was seen.

### TruBit Pro Exchange

Verdict: fits with a named change.
Public WS book and REST anchor data exist and work from this host, but the venue needs three changes before it can join.
First, there is no CCXT class, so the catalog loader must be written by hand from /basic/refData, and the loader must divide sizes by price because qty is USDT notional.
Second, the book feed must be seeded from REST because the socket sends no snapshot and no sequence.
Third, the funding interval and next funding time must be supplied as constants because the API does not publish them.

Blockers:

- No CCXT class in 4.5.68 or in CCXT master, so the catalog has to be hand-written from GET /basic/refData, which returns only symbol, tick, lotSize and type.
- Book qty is integer USDT notional, so no contractSize constant converts it and a base size must be computed as qty divided by price.
- DepthUpdate has no snapshot, no sequence id and no timestamp, so the book is seeded from REST depth/list and a lost frame is undetectable.
- The anchor has no fundingIntervalHours or nextFundingAt, and the docs conflict: 8 h in the Funding Fee and Overview articles, 4 h in the equity-perp article.
- US persons may not trade under the user agreement.

Open questions:

- VIP 0 taker: the fee chart example says 0.06%, the perpetual overview says 0.04%, and the tier table image returned HTTP 410.
- Funding interval, 8 h or 4 h, and the settlement instants.
  Also whether the rate is the upcoming one or the last one computed at its date field (06:00 UTC for all 40 at 06:42 to 06:57 UTC).
  The settlement instant was not captured.
- 35 of 40 funding rates were exactly ±0.00001, which may be an undocumented minimum magnitude.
- Index freshness: the MASKUSDT index time and price did not change for at least 892 s, and 5 of 40 indexes did not change in 60 s.
  The index basket per contract is not published.
- Whether a subscribed socket that sends no ping is closed after more than 70 s.
  A socket that never subscribed was closed at 30 s.
- Status code and body when a REST rate limit is hit.
  Not provoked.
- What TBTCTUSDT is (same index as BTCUSDT, whole-dollar tick, about 4.6M USDT open interest).
  A loader must skip it or map it explicitly.
- Server/node_modules was removed by the Rust rewrite during this run.
  The probes load ws and ccxt from server/node_modules and fall back to the root node_modules/.pnpm store.
  Sibling venue probes that use the same createRequire pattern and have no fallback will no longer run.

### BitradeX

Verdict: fits with a named change.
The public web-app API has everything the engine needs.
A socket snapshot joins a gap-free sequenced delta chain at 20 levels, and one bulk REST call gives index and mark.
There is no CCXT class, so the catalog must come from a hand-written read of /v1/future-u/market/public/symbol/list.
Funding needs per-symbol polling.
The endpoints are undocumented web-app paths.
The touch equalled Binance exactly on BTC, ETH and SOL, which suggests a Binance-quoted book.

Blockers:

- No CCXT class in 4.5.68 or CCXT master, so the catalog needs a hand-written adapter over /v1/future-u/market/public/symbol/list (the XT-shaped paths differ from CCXT xt's prefix).
- No bulk funding call: q/funding-rate is per symbol (56 calls), so the anchor poller must split index/mark (bulk agg-tickers) from a rotating funding poll.
- No published API documentation: every endpoint and topic is a web-app path read from the _app bundle and may change without notice.
- HTTPS answers the curl user agent with 456, so any client must send a non-curl User-Agent.

Open questions:

- Is the book a Binance mirror? bp/ap equalled Binance USDT-M bookTicker exactly on btc/eth/sol, and the BTC book changed only 34 times in 45 s.
  If so, crosses against Binance are lag artefacts.
- Which fee applies at VIP 0: the step table (600/400 ppm) or the per-symbol symbol/list fields (btc_usdt 650/200, eth_usdt 6,500/200, sol/xrp/bnb 600/200)?
  The eth_usdt 0.0065 taker looks like a data slip but is published.
- Index basket, mark formula and clamps, and the funding cap and floor are unpublished.
  The index differs from Binance's by a median of 578 ppm.
- IsOpenApi is true on only 4 of 72 contracts (btc, xrp, bnb, trb).
  It is unclear whether an official user API exists for the rest.
- The fund_rate@<sym> socket topic was acked but sent nothing in 20 s.
  There is no verified funding push.
- The settlement instant was not captured.
  The 4 h trump_usdt showed the same next settlement (08:00 UTC) as the 8 h contracts.
- The coin-M (future-c) family and spot were not probed.
