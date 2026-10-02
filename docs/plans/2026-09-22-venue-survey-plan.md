# Venue survey research, implementation plan

Implements [`2026-09-22-venue-survey-design.md`](./2026-09-22-venue-survey-design.md).

**Status:** In progress.

## Scope guard

This work does not:

- Add a venue to [`../../server/src/venues/registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/registry.ts), write a feed or a poller, or change any code under `server/` or `app/`.
- Open an account, call an authenticated endpoint, subscribe a private channel, or place an order.
- Probe faster than a venue's published public limit, hold sockets for more than about ten minutes per venue, or route around a geoblock.
- Record deposit, withdrawal, card, staking or earn schedules beyond one line naming the official lookup.
- Detail dated futures or options beyond naming them in the coverage matrix.
- Detail spot on a venue that lists perpetuals beyond its line in the coverage matrix.
- Edit the profiles of the ten venues already researched, or commit.
- Start a wave before the previous wave is written down.

## The profile template

The template is section "The profile template" of [`../implemented/2026-09-15-five-venue-research-plan.md`](../implemented/2026-09-15-five-venue-research-plan.md), and [`../profiles/gate/`](../profiles/gate/) is the worked example.
Three changes apply to this survey.

1. A venue with no perpetuals is profiled on its spot market.
   `fees.md` records the spot VIP 0 maker and taker and the spot tiers.
   `websocket.md` records the spot book channel on the same axes.
   `rest.md` records the spot catalog, states in section 3 that the venue publishes no index, mark or funding, names any index or reference price it does publish, and recommends no anchor poller.
2. Probe scripts go under `scripts/probes/venues/<folder>/`, run from `server/`, and load `ws` and `ccxt` from `server/node_modules` the way [`../../scripts/probes/gate-ws-probe.mjs`](../../scripts/probes/gate-ws-probe.mjs) does.
3. Every file opens with **Status:**, **Retrieved:** and **Probed:** lines, where Probed names the date and the host near Seattle, or says why nothing could be probed.

## Per wave procedure

1. The main session runs one workflow with one researcher per venue of the wave, five at most.
2. Each researcher writes its venue's three profiles and its probe scripts, runs its own second pass, and returns the structured summary of design decision 11.
3. The main session checks the new files as design section "Verification" says, and corrects what fails.
4. The main session writes one row per venue into [`../research/2026-09-22-venue-survey.md`](../research/2026-09-22-venue-survey.md), adds one line per new profile to [`../README.md`](../README.md), and sets the wave's rows below to Done or Blocked.
5. The main session deletes the wave's temporary files from the session scratchpad, because `/tmp` is a RAM-backed tmpfs on the development laptop.
   Each researcher keeps its temporary files in its own scratchpad folder named after its profile folder, so the cleanup is per venue.
6. Only then does the next wave start.

A venue whose researcher died or was skipped stays Not started and is retried in a later wave.

## Changes after wave 1

Wave 1 took 99 minutes and about 2.7 million subagent tokens.
Each researcher's context reached 450,000 to 500,000 tokens, and two researchers spent their last half hour waiting for a funding settlement so they could rerun a probe.
From wave 2 the researcher prompt changes in three ways.

1. A researcher never waits for a settlement instant or any other clock event.
   Settlement behaviour comes from the funding history endpoint and the documentation, and the profile says the instant itself was not captured.
2. Probe wall time is capped at about 30 minutes per venue, and a probe mode longer than 3 minutes is rerun in the second pass only for the numbers the profile cites.
3. The reading list shrinks to named sections and one worked example file, and CCXT classes, downloaded pages and captures are searched instead of read whole.

Ten minutes into wave 2 its five researchers had written 0.74 million tokens of context and read 32.8 million from cache, against 1.09 million and 52.8 million for wave 1 at the same minute.
The user then allowed wave 3 to run beside wave 2, so two waves of five may run at once.
Each wave is still written down on its own as soon as it finishes.
On 2026-09-23 the user moved to a larger subscription and allowed waves 5, 6 and 7 to run beside wave 4, so up to four waves, twenty researchers, may run at once.
The laptop had about 5 GB of free memory and no swap at that point, so from wave 5 each researcher runs its probes one at a time with a 512 MB heap limit, and uses a headless browser only as a last resort.
Waves 8 and 9 were added the same day at the user's request, making six waves and thirty researchers at once, with 8.9 GB of memory free when they started.
Waves 10, 11 and 12 followed, making nine waves and forty-five researchers at once, with 8.3 GB free when they started.
Waves 13, 14 and 15 followed, making twelve waves and sixty researchers at once, with 7.3 GB free when they started.
Waves 16 and 17 followed, making fourteen waves and seventy researchers at once, with 7.2 GB free when they started.

## Wave 32, perpetual venues first

On 2026-09-23 the user asked for one more wave made only of venues that list perpetuals.
It takes the five highest ranked venues still Not started that CoinGecko's derivatives list shows with perpetuals: BigONE, WOO X, Delta Exchange, CoinUp.io and HitBTC.
They leave waves 19, 22, 23, 27 and 29, which keep four venues each, and they carry wave number 32 in the tracker and the survey doc.
Globe, in wave 30, is the one such venue left after it.

## Waves 33 and 34, likely perpetual venues

Later the same day the user asked for two more waves, again with perpetual venues first.
Globe was the last venue left that CoinGecko's derivatives list shows with perpetuals, so the other nine were chosen from the main session's knowledge of which remaining venues sell futures, and their researchers confirm or refute it.
Wave 33 is Globe, BTCC, FameEX, Bitbaby and Aivora Exchange.
Wave 34 is bitcastle, IMBX, ZebPay, Mudrex and LATOKEN.
Each leaves its original wave, which keeps the rest of its venues.

## Waves 18 to 28, repacked

Waves 32, 33 and 34 took fifteen venues out of waves 18 to 31 and left those waves uneven.
On 2026-09-23 the 51 venues still Not started were regrouped in rank order into waves of five, numbered 18 to 28, so wave 28 holds one venue and waves 29 to 31 no longer exist.
The tracker below shows the new numbers.

## Network path

The laptop's traffic leaves through a Surfshark WireGuard tunnel whose exit geolocated to Canada on 2026-09-23, as the survey doc's section "Table" records.
The tunnel was in place before the survey and is the user's own setup, so it is not a route around a refusal in the sense of design decision 5.
From wave 18 the researcher prompt names the tunnel, so each profile states its access results as seen from that exit.

## Tracker

Columns: the wave, the CoinGecko rank, the venue, its profile folder, its CCXT 4.5.68 class, whether CoinGecko's derivatives list shows it with perpetuals on 2026-09-22, and the status.

| wave | rank | venue | folder | CCXT 4.5.68 | perps on CoinGecko | status |
|---|---|---|---|---|---|---|
| 1 | 9 | Crypto.com Exchange | `cryptocom` | `cryptocom` | yes | Done |
| 1 | 10 | OSL Exchange | `osl` | none | no | Done |
| 1 | 12 | KuCoin | `kucoin` | `kucoin`, `kucoinfutures` | yes | Done |
| 1 | 13 | Toobit | `toobit` | `toobit` | yes | Done |
| 1 | 14 | WhiteBIT | `whitebit` | `whitebit` | yes | Done |
| 2 | 15 | Bitvavo | `bitvavo` | `bitvavo` | no | Done |
| 2 | 17 | Bitunix | `bitunix` | none | yes | Done |
| 2 | 18 | BingX | `bingx` | `bingx` | yes | Done |
| 2 | 19 | Bullish | `bullish` | `bullish` | yes | Done |
| 2 | 20 | Bitso | `bitso` | `bitso` | no | Done |
| 3 | 21 | HashKey Exchange | `hashkey-exchange` | none | no | Done |
| 3 | 22 | Ourbit | `ourbit` | none | yes | Done |
| 3 | 23 | Bitkub | `bitkub` | none | no | Done |
| 3 | 25 | Luno | `luno` | `luno` | no | Done |
| 3 | 27 | Bitbank | `bitbank` | `bitbank` | no | Done |
| 4 | 28 | CoinW | `coinw` | none | yes | Done |
| 4 | 29 | Coinstore | `coinstore` | none | no | Done |
| 4 | 30 | LBank | `lbank` | `lbank` | yes | Done |
| 4 | 31 | Bit2Me | `bit2me` | none | no | Done |
| 4 | 32 | Niza.io | `niza` | none | yes | Done |
| 5 | 33 | HashKey Global | `hashkey` | `hashkey` | yes | Done |
| 5 | 34 | Bitazza | `bitazza` | none | no | Done |
| 5 | 35 | Bitfinex | `bitfinex` | `bitfinex` | yes | Done |
| 5 | 36 | GroveX | `grovex` | none | no | Done |
| 5 | 37 | Upbit | `upbit` | `upbit` | no | Done |
| 6 | 38 | Byte Exchange | `byte-exchange` | none | no | Done |
| 6 | 39 | Phemex | `phemex` | `phemex` | yes | Done |
| 6 | 40 | P2B | `p2b` | `p2b` | no | Done |
| 6 | 41 | WEEX | `weex` | `weex` | yes | Done |
| 6 | 42 | GMO Coin Japan | `gmo-coin` | none | yes | Done |
| 7 | 43 | BitKan | `bitkan` | none | yes | Done |
| 7 | 44 | VALR | `valr` | none | yes | Done |
| 7 | 45 | Bitrue | `bitrue` | `bitrue` | yes | Done |
| 7 | 46 | Pionex | `pionex` | none | no | Done |
| 7 | 47 | Webot | `webot` | none | no | Done |
| 8 | 48 | Coins.ph | `coinsph` | `coinsph` | no | Done |
| 8 | 49 | Zoomex | `zoomex` | none | yes | Done |
| 8 | 50 | CoinTR | `cointr` | none | no | Done |
| 8 | 51 | Bithumb | `bithumb` | `bithumb` | no | Done |
| 8 | 52 | HTX | `htx` | `htx` | yes | Done |
| 9 | 53 | Websea | `websea` | none | no | Done |
| 9 | 54 | LeveX | `levex` | none | yes | Done |
| 9 | 55 | Biconomy.com | `biconomy` | none | yes | Done |
| 9 | 56 | Bittime | `bittime` | none | no | Done |
| 9 | 57 | Hotcoin | `hotcoin` | none | yes | Done |
| 10 | 58 | BYDFi | `bydfi` | `bydfi` | yes | Done |
| 10 | 59 | DigiFinex | `digifinex` | `digifinex` | no | Done |
| 10 | 60 | XT.COM | `xt` | `xt` | yes | Done |
| 10 | 61 | OKJ | `okj` | none | no | Done |
| 10 | 62 | PointPay | `pointpay` | none | no | Done |
| 11 | 63 | BitoPro | `bitopro` | `bitopro` | no | Done |
| 11 | 64 | Max Maicoin | `max-maicoin` | none | no | Done |
| 11 | 65 | BtcTurk / Kripto | `btcturk` | `btcturk` | no | Done |
| 11 | 66 | BitTrade | `bittrade` | `bittrade` | no | Done |
| 11 | 67 | Digital X | `digital-x` | none | no | Done |
| 12 | 68 | BloFin | `blofin` | `blofin` | yes | Done |
| 12 | 69 | Deepcoin | `deepcoin` | `deepcoin` | yes | Done |
| 12 | 70 | Koinpark | `koinpark` | none | no | Done |
| 12 | 71 | BTSE | `btse` | none | yes | Done |
| 12 | 72 | Deribit Spot | `deribit` | `deribit` | yes | Done |
| 13 | 73 | Backpack Exchange | `backpack` | `backpack` | yes | Done |
| 13 | 74 | One Trading | `onetrading` | `onetrading` | no | Done |
| 13 | 75 | Hibt | `hibt` | none | no | Done |
| 13 | 76 | SAFEbit | `safebit` | none | no | Done |
| 13 | 77 | CEX.IO | `cex` | `cex` | no | Done |
| 14 | 78 | Gate US | `gate-us` | none | no | Done |
| 14 | 79 | Independent Reserve | `independentreserve` | `independentreserve` | no | Done |
| 14 | 80 | bitFlyer | `bitflyer` | `bitflyer` | yes | Done |
| 14 | 81 | Azbit | `azbit` | none | no | Done |
| 14 | 82 | BVOX | `bvox` | none | yes | Done |
| 15 | 83 | Ondo Stocks | `ondo-stocks` | none | no | Done |
| 15 | 84 | Tothemoon | `tothemoon` | none | no | Done |
| 15 | 85 | TokoCrypto | `tokocrypto` | `tokocrypto` | no | Done |
| 15 | 86 | Coinone | `coinone` | `coinone` | no | Done |
| 15 | 87 | Bitlo | `bitlo` | none | no | Done |
| 16 | 88 | KCEX | `kcex` | none | yes | Done |
| 16 | 89 | OrangeX | `orangex` | none | yes | Done |
| 16 | 90 | BitDelta | `bitdelta` | none | no | Done |
| 16 | 91 | Dex-Trade | `dex-trade` | none | no | Done |
| 16 | 92 | Tapbit | `tapbit` | none | yes | Done |
| 17 | 93 | CoinJar Exchange | `coinjar` | none | no | Done |
| 17 | 94 | CoinEx | `coinex` | `coinex` | yes | Done |
| 17 | 95 | Poloniex | `poloniex` | `poloniex` | no | Done |
| 17 | 96 | BitMart | `bitmart` | `bitmart` | yes | Done |
| 17 | 97 | CoinDCX | `coindcx` | none | no | Done |
| 18 | 98 | Icrypex | `icrypex` | none | no | Done |
| 18 | 99 | Blockchain.com | `blockchaincom` | `blockchaincom` | no | Done |
| 18 | 100 | Hata | `hata` | none | no | Done |
| 18 | 101 | Zaif | `zaif` | `zaif` | no | Done |
| 18 | 102 | SecondBTC | `secondbtc` | none | no | Done |
| 19 | 103 | Figure Markets | `figure-markets` | none | no | Done |
| 19 | 104 | Coincheck | `coincheck` | `coincheck` | no | Done |
| 19 | 106 | Indodax | `indodax` | `indodax` | no | Done |
| 19 | 107 | WazirX | `wazirx` | none | no | Done |
| 19 | 108 | Tokpie | `tokpie` | none | no | Done |
| 20 | 109 | Orbix | `orbix` | none | no | Done |
| 20 | 110 | Catex | `catex` | none | no | Done |
| 20 | 111 | BTCMarkets | `btcmarkets` | `btcmarkets` | no | Done |
| 20 | 112 | Mercado Bitcoin | `mercado` | `mercado` | no | Done |
| 20 | 113 | Coinzoom | `coinzoom` | none | no | Done |
| 21 | 114 | Paribu | `paribu` | none | no | Done |
| 21 | 115 | EarnBIT | `earnbit` | none | no | Done |
| 21 | 116 | FMFW.io | `fmfwio` | `fmfwio` | no | Done |
| 21 | 117 | Bitexlive | `bitexlive` | none | no | Done |
| 21 | 119 | XBO.com | `xbo` | none | no | Done |
| 22 | 120 | Foxbit | `foxbit` | `foxbit` | no | Done |
| 22 | 121 | Young Platform | `young-platform` | none | no | Done |
| 22 | 123 | Changelly PRO | `changelly-pro` | none | no | Done |
| 22 | 126 | Emirex | `emirex` | none | no | Done |
| 22 | 127 | GoPax | `gopax` | none | no | Done |
| 23 | 128 | ALP.COM | `alp` | none | no | Done |
| 23 | 129 | Kinesis Money | `kinesis` | none | no | Done |
| 23 | 130 | INEX | `inex` | none | no | Done |
| 23 | 131 | Bitexen | `bitexen` | none | no | Done |
| 23 | 132 | Kanga Global | `kanga` | none | no | Done |
| 24 | 133 | Digitalexchange.id | `digitalexchange-id` | none | no | Done |
| 24 | 135 | Paymium | `paymium` | `paymium` | no | Done |
| 24 | 136 | ChainEX | `chainex` | none | no | Done |
| 24 | 137 | Giottus | `giottus` | none | no | Done |
| 24 | 138 | Bit2c | `bit2c` | `bit2c` | no | Done |
| 25 | 139 | Buda | `buda` | none | no | Done |
| 25 | 140 | KoinBX | `koinbx` | none | no | Done |
| 25 | 141 | Upbit Indonesia | `upbit-indonesia` | none | no | Done |
| 25 | 142 | Nonkyc.io | `nonkyc` | none | no | Done |
| 25 | 145 | EXMO | `exmo` | `exmo` | no | Done |
| 26 | 147 | Vindax | `vindax` | none | no | Done |
| 26 | 148 | Cryptal | `cryptal` | none | no | Done |
| 26 | 149 | INX One | `inx-one` | none | no | Done |
| 26 | 150 | BitBNS | `bitbns` | `bitbns` | no | Done |
| 26 | 155 | NBX | `nbx` | none | no | Done |
| 27 | 156 | BTC Trade UA | `btc-trade-ua` | none | no | Done |
| 27 | 157 | Bitbegin | `bitbegin` | none | no | Done |
| 27 | 159 | SafeTrade | `safetrade` | none | no | Done |
| 27 | 161 | Bilaxy | `bilaxy` | none | no | Done |
| 27 | 163 | Dinari | `dinari` | none | no | Done |
| 28 | 164 | BTCBOX | `btcbox` | `btcbox` | no | Done |
| 32 | 105 | BigONE | `bigone` | `bigone` | yes | Done |
| 32 | 118 | WOO X | `woo` | `woo` | yes | Done |
| 32 | 124 | Delta Exchange | `delta` | `delta` | yes | Done |
| 32 | 144 | CoinUp.io | `coinup` | none | yes | Done |
| 32 | 153 | HitBTC | `hitbtc` | `hitbtc` | yes | Done |
| 33 | 125 | Aivora Exchange | `aivora` | none | no | Done |
| 33 | 143 | Bitbaby | `bitbaby` | none | no | Done |
| 33 | 146 | BTCC | `btcc` | none | no | Done |
| 33 | 154 | FameEX | `fameex` | none | no | Done |
| 33 | 160 | Globe | `globe` | none | yes | Done |
| 34 | 122 | bitcastle | `bitcastle` | none | no | Done |
| 34 | 134 | LATOKEN | `latoken` | `latoken` | no | Done |
| 34 | 151 | Mudrex | `mudrex` | `mudrex` | no | Done |
| 34 | 152 | ZebPay | `zebpay` | `zebpay` | no | Done |
| 34 | 158 | IMBX | `imbx` | none | no | Done |

## CoinMarketCap additions

On 2026-09-23 the user supplied a second ranking, CoinMarketCap's exchange list at `https://coinmarketcap.com/rankings/exchanges/`, ranks 1 to 236, and asked for its venues to join the queue without starting any research.
138 of the 236 are already covered, by a profile, by an entity section of a profile, or by a venue in the tracker above under another spelling, such as MAX Exchange for Max Maicoin, Korbit for Digital X, Changelly for Changelly PRO and Cat.Ex for Catex.
The other 98 are listed below in CoinMarketCap rank order with provisional waves 35 to 54, and none is scheduled until the user asks, except wave 35 below.
Binance TR and Binance TH are Binance group entities with their own APIs, which the Binance profile does not cover.
WOO X Pro may be the same venue as WOO X, so its researcher settles that first.
Flipster is the only one that CoinGecko's derivatives list shows with perpetuals.

On 2026-09-23 the user asked for one wave of CoinMarketCap additions that list futures.
CoinMarketCap's derivatives ranking, read through its data API with `exType=2`, lists 42 of the 98 additions.
Wave 35 is the five of them it ranks highest: MGBX at 26, Echobit at 28, YUBIT at 32, UZX at 37 and OmniX at 39.
Wave 36 is the next four on that ranking, Bitbase at 42, CrypFine at 44, x.me Exchange at 49 and AstralX at 53, plus Flipster at 59, which CoinGecko also confirms with 243 perpetuals.
Koinbay, at 51, was passed over for Flipster because it reports no open interest.
On the user's request of the same day, waves 37 to 41 take the next 25 additions by that derivatives ranking, run at most ten researchers at a time, and cap each researcher at about 40 minutes.
Waves 39 and 40 were stopped on 2026-09-24 at the user's request.
BiKing finished, IBIT Global and MGBX are In progress with partial files, and the other eight venues of those waves and all of wave 41 are Not started.
The other 63 keep CoinMarketCap rank order in waves 42 to 54, and 7 of them still appear on that derivatives ranking.

| wave | CMC rank | venue | folder | CCXT 4.5.68 | perps on CoinGecko | status |
|---|---|---|---|---|---|---|
| 35 | 34 | MGBX | `mgbx` | none | no | In progress |
| 35 | 38 | Echobit | `echobit` | none | no | Done |
| 35 | 43 | YUBIT | `yubit` | none | no | Done |
| 35 | 52 | UZX | `uzx` | none | no | Done |
| 35 | 57 | OmniX | `omnix` | none | no | Done |
| 36 | 60 | Bitbase | `bitbase` | none | no | Done |
| 36 | 64 | CrypFine | `crypfine` | none | no | Done |
| 36 | 76 | x.me Exchange | `x-me` | none | no | Done |
| 36 | 93 | AstralX | `astralx` | none | no | Done |
| 36 | 112 | Flipster | `flipster` | none | yes | Done |
| 37 | 89 | Koinbay | `koinbay` | none | no | Done |
| 37 | 103 | BITmarkets | `bitmarkets` | none | no | Done |
| 37 | 104 | Batonex | `batonex` | none | no | Done |
| 37 | 111 | TruBit Pro Exchange | `trubit-pro` | none | no | Done |
| 37 | 129 | BitradeX | `bitradex` | none | no | Done |
| 38 | 142 | 4E | `four-e` | none | no | Done |
| 38 | 143 | Mandala Exchange | `mandala` | none | no | Done |
| 38 | 145 | BitxEX | `bitxex` | none | no | Done |
| 38 | 149 | BASEKX | `basekx` | none | no | Done |
| 38 | 157 | Gleec BTC | `gleec-btc` | none | no | Done |
| 39 | 159 | Blockfinex | `blockfinex` | none | no | Not started |
| 39 | 160 | BiKing | `biking` | none | no | Done |
| 39 | 161 | BitTap | `bittap` | none | no | Not started |
| 39 | 166 | IBIT Global | `ibit-global` | none | no | In progress |
| 39 | 168 | WOO X Pro | `woo-x-pro` | none | no | Not started |
| 40 | 170 | OneBullEx | `onebullex` | none | no | Not started |
| 40 | 173 | OneEx | `oneex` | none | no | Not started |
| 40 | 177 | CoinP | `coinp` | none | no | Not started |
| 40 | 184 | idax exchange | `idax` | none | no | Not started |
| 40 | 185 | EasiCoin | `easicoin` | none | no | Not started |
| 41 | 188 | Tebbit | `tebbit` | none | no | Not started |
| 41 | 190 | CZR Exchange | `czr` | none | no | Not started |
| 41 | 200 | AEGET | `aeget` | none | no | Not started |
| 41 | 201 | Cofinex | `cofinex` | none | no | Not started |
| 41 | 205 | KTX | `ktx` | none | no | Not started |
| 42 | 15 | Binance TR | `binance-tr` | none | no | Not started |
| 42 | 30 | Binance TH | `binance-th` | none | no | Not started |
| 42 | 44 | BiFinance | `bifinance` | none | no | Not started |
| 42 | 73 | C-Patex | `c-patex` | none | no | Not started |
| 42 | 99 | Reku | `reku` | none | no | Not started |
| 43 | 102 | Coinmate | `coinmate` | `coinmate` | no | Not started |
| 43 | 107 | IndoEx | `indoex` | none | no | Not started |
| 43 | 114 | LMAX Digital | `lmax-digital` | none | no | Not started |
| 43 | 118 | Ripio | `ripio` | none | no | Not started |
| 43 | 124 | Coinmetro | `coinmetro` | none | no | Not started |
| 44 | 127 | Bitspay | `bitspay` | none | no | Not started |
| 44 | 136 | Altcoin Trader | `altcoin-trader` | none | no | Not started |
| 44 | 137 | SuperEx | `superex` | none | no | Not started |
| 44 | 139 | SWFT Trade | `swft-trade` | none | no | Not started |
| 44 | 140 | Remitano | `remitano` | none | no | Not started |
| 45 | 141 | ZKE | `zke` | none | no | Not started |
| 45 | 146 | AIA Exchange | `aia` | none | no | Not started |
| 45 | 147 | YoBit | `yobit` | none | no | Not started |
| 45 | 151 | Crypton Exchange | `crypton` | none | no | Not started |
| 45 | 153 | Bitcoiva | `bitcoiva` | none | no | Not started |
| 46 | 155 | CoinCorner | `coincorner` | none | no | Not started |
| 46 | 162 | Revolut X | `revolut-x` | none | no | Not started |
| 46 | 164 | Cryptomus | `cryptomus` | `cryptomus` | no | Not started |
| 46 | 167 | TRIV | `triv` | none | no | Not started |
| 46 | 175 | Picol | `picol` | none | no | Not started |
| 47 | 176 | CoinCola | `coincola` | none | no | Not started |
| 47 | 180 | GudangKripto | `gudangkripto` | none | no | Not started |
| 47 | 181 | Dzengi | `dzengi` | none | no | Not started |
| 47 | 186 | BitGW Exchange | `bitgw` | none | no | Not started |
| 47 | 189 | Gems Trade | `gems-trade` | none | no | Not started |
| 48 | 192 | Blynex | `blynex` | none | no | Not started |
| 48 | 193 | BIT.TEAM | `bit-team` | `bitteam` | no | Not started |
| 48 | 195 | COINSPACE | `coinspace` | none | no | Not started |
| 48 | 196 | XXKK | `xxkk` | none | no | Not started |
| 48 | 197 | NexDAX | `nexdax` | none | no | Not started |
| 49 | 198 | Metal X | `metal-x` | none | no | Not started |
| 49 | 202 | CRMClick | `crmclick` | none | no | Not started |
| 49 | 204 | CoinMy | `coinmy` | none | no | Not started |
| 49 | 206 | ChangeNOW | `changenow` | none | no | Not started |
| 49 | 207 | CriptoSwaps | `criptoswaps` | none | no | Not started |
| 50 | 208 | BlockFin | `blockfin` | none | no | Not started |
| 50 | 209 | SunX | `sunx` | none | no | Not started |
| 50 | 210 | Binibit | `binibit` | none | no | Not started |
| 50 | 212 | NEX Exchange | `nex` | none | no | Not started |
| 50 | 214 | Unocoin | `unocoin` | none | no | Not started |
| 51 | 216 | ASTX | `astx` | none | no | Not started |
| 51 | 217 | Feather Exchange | `feather` | none | no | Not started |
| 51 | 218 | Ulink | `ulink` | none | no | Not started |
| 51 | 219 | KlicklX | `klicklx` | none | no | Not started |
| 51 | 220 | Bitonic | `bitonic` | none | no | Not started |
| 52 | 221 | CEEX exchange | `ceex` | none | no | Not started |
| 52 | 222 | Coinut | `coinut` | none | no | Not started |
| 52 | 224 | BlueBit | `bluebit` | none | no | Not started |
| 52 | 225 | Ndax | `ndax` | `ndax` | no | Not started |
| 52 | 226 | CoinLion | `coinlion` | none | no | Not started |
| 53 | 227 | B2Z Exchange | `b2z` | none | no | Not started |
| 53 | 228 | ListaDao | `listadao` | none | no | Not started |
| 53 | 229 | StakeCube | `stakecube` | none | no | Not started |
| 53 | 230 | Bittylicious | `bittylicious` | none | no | Not started |
| 53 | 231 | FreiExchange | `freiexchange` | none | no | Not started |
| 54 | 232 | FOBLGATE | `foblgate` | none | no | Not started |
| 54 | 233 | 5DAX | `5dax` | none | no | Not started |
| 54 | 234 | Bitcoin.me | `bitcoin-me` | none | no | Not started |

## Closing tasks

Task C waits until the CoinMarketCap additions are researched, because this plan still drives them.
MGBX and Bitbase were stopped near the end of their runs on 2026-09-23 about 07:20 UTC because the user's usage was nearly spent, so their profiles may be incomplete and they are In progress.
KoinBX stopped at the session limit on 2026-09-23 05:47 UTC with `fees.md` and `rest.md` written, and a single agent finished `websocket.md` and its summary the same morning.

These run after the last wave.

| task | subject | status |
|---|---|---|
| A | Cross-venue answer in the survey doc: which venues fit the engine as is, which fit with a named change, which are spot only, and which are blocked | Done |
| B | Prose and link check over every new doc in one pass | Done |
| C | Reconcile this plan and the design against what was delivered, and move both to `docs/implemented/` | Blocked |
