# Venue adapter waves, design

Design of record for building the 50 remaining perpetual venues as Rust adapters, in waves of parallel agents.
It fixes how every adapter is built, tested and accepted, the shared pieces the adapters need, and the order of the waves.
The facts of each venue stay in its profile under [`docs/profiles/`](../profiles/), so this doc does not repeat them.
The plan that runs the waves and holds the tracker is [`2026-10-08-venue-adapter-waves-plan.md`](./2026-10-08-venue-adapter-waves-plan.md).

**Status:** In progress.
On 2026-10-09, 49 of the 50 venues were built, verified and merged, with 12,683 markets between them, and the main tree passed 2,054 tests.
BitMart is Blocked, because its REST host gets no DNS answer from this host's network.

## Problem

The Rust server has ten venue adapters, and five of them run, as [`orchestrator.rs:18`](../../server/src/orchestrator.rs) lists.
The survey in [`2026-09-22-venue-survey.md`](../research/2026-09-22-venue-survey.md) recorded 172 venues.
Of those, 50 list perpetuals and fit the engine: 2 as they stand and 48 with a named change, counting Hyperliquid and the CoinMarketCap additions.
Another 28 list perpetuals but are blocked, and 12 have no public API.

The user wants all 50 built now and connected later.
So every adapter is registered in [`venues/mod.rs`](../../server/src/venues/mod.rs) and stays off `ACTIVE_VENUES`, as the five later venues of [`2026-10-01-rust-venue-adapters-design.md`](../implemented/2026-10-01-rust-venue-adapters-design.md) did.

Fifty adapters written one design at a time would restate the same rules fifty times.
The work is also too large for one agent, and parallel agents need a protocol that keeps them out of each other's way.

## The venue contract

The contract is the one recorded in [`2026-10-01-rust-venue-adapters-design.md`](../implemented/2026-10-01-rust-venue-adapters-design.md), section "The venue contract".
In short, a venue is one struct that implements two traits, and `start` at [`venues/mod.rs:264`](../../server/src/venues/mod.rs) hands it to both runtimes.

- `BookVenue` at [`venue_feed.rs:78`](../../server/src/feeds/venue_feed.rs) plans the sockets, builds the subscribe frames and the ping, and parses each frame into a book through `Connection` at [`venue_feed.rs:107`](../../server/src/feeds/venue_feed.rs).
- `AnchorVenue` at [`anchor_poller.rs:55`](../../server/src/feeds/anchor_poller.rs) returns one row per market each round, with index, mark, funding rate, funding interval and next funding.
- A loader reads the instruments call and hands its markets to `catalog::finish` at [`catalog.rs:28`](../../server/src/venues/catalog.rs), which applies the venue's deny list and logs `catalog_read`.

The engine groups markets into clusters by base and quote family at [`index_builder.rs:135`](../../server/src/engine/cluster/index_builder.rs), and USD and USDC sit under USDT at [`quote_family.rs:3`](../../server/src/engine/cluster/quote_family.rs).
So two venues that list different tokens under one ticker meet in one cluster, and their gap reads as an edge.

## What the scouting found on 2026-10-08

Ten read-only scouts each took five venues.
Each read the venue's survey row and notes and its three profile files, and made one live call to its catalog.

The catalogs answered on 48 of the 50 venues.
BitMart's details call got no HTTP response from this host.
Tothemoon has no REST catalog at all and lists its 13 perpetuals only on its socket.
Several profiles are stale by a few percent, such as Crypto.com at 409 perpetuals against 396 and WEEX at 1,032 against 995.

### Shared needs

| Need | Venues |
|---|---|
| Anchor fields that only the socket carries | cryptocom, coinw, deepcoin, bitmart, echobit, xme, koinbay, tothemoon |
| A book seeded from REST, because the socket sends no snapshot | woo, backpack, orangex, trubitpro, biconomy |
| gzip frames | bingx, htx, fameex, xme, koinbay |
| zlib frames | digifinex |
| Public calls that are JSON POSTs | hyperliquid, xme, aivora |
| A per market call for funding, read in turn | htx, zoomex, pionex, poloniex, digifinex, bitradex, aivora, fameex, uzx, koinbay |
| No index on any call or channel | valr, bitfinex |
| No mark | hibt |

### API families

Several venues run one platform, which CCXT already models as one class pointed at other hosts.

| Family | Venues | Evidence |
|---|---|---|
| HitBTC API v3 | hitbtc, fmfwio, changellypro, mandala, gleecbtc | the same `/api/3/public` paths, and CCXT's `fmfwio` is a `hitbtc` subclass with other URLs and fees |
| ChainUp white label futures | aivora, fameex, xme, koinbay | the same `fapi/v1` open API, `contractName=E-BTC-USDT`, `tagPrice` as the mark, and the gzip `kline-api` socket |
| MEXC contract API v1 | mexc, ourbit, bydfi | ourbit and bydfi answer MEXC's `/api/v1/contract/detail` unchanged |
| Orderly | niza, nonkyc | both read `api.orderly.org` and trade Orderly's one shared book |
| Bybit v5 | bybit, zoomex | zoomex serves Bybit's socket protocol unchanged under other REST paths |
| XT futures | xt, bitradex | the same path shapes under the prefix `/v1/future-u/` |

Biconomy speaks MEXC's socket protocol too, but under renamed REST paths and without a snapshot on subscribe, so it is its own module.

### Relays

A relay shows another venue's book, so a cross between the relay and its source is one book seen twice.

| Venue | Source | Evidence |
|---|---|---|
| zoomex | bybit | 693 of 697 perpetuals carry Bybit's update ids, sequence, timestamps and levels frame for frame |
| changellypro | hitbtc | identical trade ids, book levels with the same millisecond timestamps, open interest, index and mark |
| mandala, gleecbtc | each other, likely HitBTC liquidity | identical open interest and premium index in both captures |
| niza, nonkyc | Orderly | both are Orderly broker front ends with no market of their own |
| bitradex, suspected | binance | best bid and ask equalled Binance's on three markets, unverified |

CoinW's and UZX's funding rates equal Binance's on almost every shared contract, but their books are their own, so they are not relays.

## Decisions

### Scope and identity

1. The 50 venues of the venue table below are built as registered adapters that do not start.
   `ACTIVE_VENUES` keeps its five ids, and activating a venue is a separate decision with its own checklist.
2. A venue's id is the CCXT 4.5.68 id when CCXT has a class for that venue itself, such as `kucoinfutures`, `cryptocom` and `woo`.
   Otherwise it is the profile folder name with every hyphen removed, such as `changellypro` and `gleecbtc`.
   A class written for another venue that speaks the same API does not lend its id, so Niza is `niza` and not `woofipro`.
   The database rows and every audit name venues by these ids, as decision 2 of the 2026-10-01 design explains.
3. A loader keeps linear perpetuals quoted in USDT, USDC or USD, and drops inverse and coin quoted contracts.
   `market_rank` at [`quote_family.rs:11`](../../server/src/engine/cluster/quote_family.rs) already ranks every inverse contract below a linear twin, and every scouted inverse family is a handful of contracts with a linear twin on the same venue.
   A coin quoted perpetual can only cluster with another perpetual in the same coin, because the quote family folds only USD and USDC into USDT.
4. TradFi, pre IPO and pre market perpetuals are kept when the venue lists them as trading, as binance keeps its TradFi rows.
   Each one meets the identity check of decision 15 like any other market.
   A contract whose index basket is the venue's own perpetual is left out of the anchor rows, as gate's poller leaves out its pre market contracts.
5. The taker fee is the VIP 0 taker of the venue's `fees.md`, as a ppm constant, as decision 7 of the 2026-10-01 design did.
   CCXT's taker is not used, because the scouts found it missing on phemex, toobit, backpack and bigone and wrong on cryptocom, htx and deepcoin.
6. The contract size is the number of base coins in one unit of the book's sizes.
   Where CCXT's `contractSize` is not that unit, as on whitebit, weex and deribit, the loader follows the book.
   The live smoke cannot see a wrong size, so the verifier checks the size against one REST book and the venue's contract specification.

### Loaders

7. A venue with a CCXT 4.5.68 class reproduces that class's market rules and its `commonCurrencies` table, and a CCXT dump taken in the same minute is the parity target.
   Where the class is wrong, the loader follows the venue, and the plan records the difference and its reason.
   The scouts found such defects on hitbtc and fmfwio, which hard code `active` to true, digifinex, which reads every swap as active, xt, which reads `active` from `isOpenApi` alone, bingx, which keeps contracts in status 25, whitebit and weex, whose contract sizes are wrong, bitmart, which hard codes linear, and bydfi, whose class fails since the venue's migration.
8. A venue with no class follows the catalog rules of its profile's `rest.md`, and the identity check of decision 15 stands in for parity.

### Families and relays

9. Venues that run one platform share one module, and each venue is a profile constant in it that holds its id, name, hosts, taker and whatever else differs.
   The families are `hitbtc` with hitbtc, fmfwio, changellypro, mandala and gleecbtc, `chainup` with aivora, fameex, xme and koinbay, and `orderly` with niza and nonkyc.
   A member that proves to differ beyond its profile constants moves to a module of its own, and the plan records why.
10. Ourbit and bydfi join the existing `mexc` module as profiles, because they run MEXC's contract API unchanged and mexc is not running.
    Every existing mexc test must pass unchanged.
    Zoomex gets its own module, started from bybit's code, because bybit is running and zoomex reads its own anchor calls for the four markets whose numbers are its own.
    Bitradex got a module of its own rather than an `xt` profile, because its reply envelope, active rule, funding interval and socket rules differ from xt's beyond the path prefix.
11. A relay is built like any other venue, and the venue table flags it with its evidence.
    The engine has no guard against a cross between two views of one book, so activating a relay needs that guard or a choice of one side.

### Shared pieces, built first as wave 0

12. `flate2` is a direct dependency, and `venues/wire.rs` has `gunzip` at [`wire.rs:30`](../../server/src/venues/wire.rs) and `inflate` beside it.
    The runtime hands a binary frame to `handle` as bytes at [`venue_feed.rs:620`](../../server/src/feeds/venue_feed.rs), so decompression stays inside the venue that needs it.
    `flate2` is in `Cargo.lock` already, pulled in by reqwest's gzip support.
13. [`socket_anchors.rs`](../../server/src/venues/socket_anchors.rs) holds `SocketAnchors`, a map behind a mutex in the venue struct.
    The venue's book plan subscribes the anchor channels beside the book channels, `handle` writes each field it reads, and `fetch_round` returns the rows that are complete.
    The poller then checks and sends those rows like any REST round, so no second anchor runtime exists.
    A row is complete once every field the venue publishes has arrived, so the poller never logs a half filled row as rejected.
    A row's `ts` is the older arrival of its index and its mark, so a row is never fresher than its stalest price.
    The engine stores that `ts` as the anchor's `written_at` at [`engine.rs:286`](../../server/src/engine/engine.rs), so a row left behind by a dropped socket ages past the engine's limits instead of looking current.
    `Connection::frame_recv_ts` at [`venue_feed.rs:181`](../../server/src/feeds/venue_feed.rs) gives that stamp.
14. A book that the socket never seeds is seeded from REST through the feed runtime.
    `BookVenue` has `snapshot_url` and `handle_snapshot`, `Connection` has `request_snapshot` at [`venue_feed.rs:234`](../../server/src/feeds/venue_feed.rs), and `FeedSettings` has `snapshot_gap`.
    The runtime fetches the queued snapshots of one connection one at a time, paced by the gap, and hands each reply to `handle_snapshot` between frames.
    The venue keeps the deltas that arrive before its snapshot in its `State` and replays the ones newer than the snapshot.
    A failed fetch is queued again behind a pause that doubles with each consecutive failure, from two gaps up to 30 s.
    Only the first failure of a run and every 30th after it is logged, so one dead market cannot flood the log.
    A gap still ends the connection, which reseeds every market on it, so these venues plan small connections.
    `spawn_feed` at [`venue_feed.rs:399`](../../server/src/feeds/venue_feed.rs) takes the run's HTTP client, which `VenueRun` carries.
15. An ignored test, `live_identity` at [`live_tests.rs:339`](../../server/src/venues/live_tests.rs), loads the venues under test and five reference venues, binance, bybit, okx, gate and mexc.
    It builds the clusters with the engine's own `ClusterIndex::build_index`, streams the venues under test on the clusters they share with a reference, and reads one REST anchor round from each reference.
    It compares each market's mid times its `price_scale` with the median of the references' marks, or of their index where a reference publishes no mark.
    The references were streamed too until 2026-10-09, which saturated the CPU when five verifiers ran the check at once, so one anchor round each replaced it.
    It prints every market more than 2 percent away and fails on any market more than 10 percent away.
    A mid counts only while its book's spread is under 10 percent, because a dead book's mid says nothing about the token.
    Kraken's `PF_GBPUSD` showed this on 2026-10-08, with a bid of 1.035 and an ask of 1.99 on a contract whose mark was 1.324.
    A market whose own book is wider, or never two sided, is compared by its own mark, or by its index when it has no mark, and a market with neither is listed without failing.
    An outlier is either another token, which the loader denies through `catalog::finish` with its reason, or another unit, which the loader fixes with `price_scale` or the contract size.
    This is the ticker collision survey that [`2026-09-15-five-venue-adapters-plan.md`](../implemented/2026-09-15-five-venue-adapters-plan.md) left for activation, moved into the build.
16. `post_json` at [`anchor_poller.rs:84`](../../server/src/feeds/anchor_poller.rs) and `get_json` share `get_bytes`, one request path with its rate limit answer.
    `retry_after` at [`anchor_poller.rs:130`](../../server/src/feeds/anchor_poller.rs) reads an all digit value above 10^9 as a Unix time, because BTSE documents both readings and the seconds reading would pause the poller for decades.
17. `FeedSettings` has `headers`, which `handshake_request` at [`venue_feed.rs:787`](../../server/src/feeds/venue_feed.rs) adds to every handshake.
    WEEX documents that its firewall blocks a socket with no User-Agent, although the wire accepted one on 2026-09-23.

### Anchors

18. Index and mark must reach the engine younger than `ANCHOR_MAX_AGE_MS`, 10 s, and within `ANCHOR_SKEW_MS`, 5 s, of the other leg, as [`anchor_reading.rs:4`](../../server/src/engine/opportunity/anchor_reading.rs) sets.
    So they come from a bulk call, from the socket, or from per market calls that finish a sweep in about 3 s.
    Funding moves over minutes, so it may be read in turn, a few markets per round, as [`bitstamp/anchor.rs`](../../server/src/venues/bitstamp/anchor.rs) does.
19. An adapter never fills a field with a number that means something else.
    A venue with no index leaves its rows out, as valr and bitfinex must, and the engine then refuses their routes, because a mark copied into the index would make a standing basis read as fresh.
    A venue with no mark sends mark 0, which the engine refuses at open as a markless leg.
20. The funding interval and the next funding come from the venue's own fields, then from a constant the profile documents, such as 8 h at 00, 08 and 16 UTC.
    An unknown next funding is 0, which `anchor_issue` at [`engine.rs:534`](../../server/src/engine/engine.rs) accepts.

### Books

21. A delta chain follows the venue's sequence rule, and a gap calls `resync`, as every adapter does today.
    A push that carries the whole book replaces the book.
    A checksum is verified only on a delta channel with no sequence.
    xt and deepcoin empty one market's book and resubscribe it instead of ending the connection, because xt's sessions cap their streams and deepcoin's deltas carry no sequence, and the verifiers accepted it since an empty book is never a live leg.
22. A book is subscribed at the smallest depth of at least 20 levels, the depth the engine holds per leg at [`index_builder.rs:8`](../../server/src/engine/cluster/index_builder.rs), or at the deepest the venue offers below that.
    Hyperliquid subscribes its fast book of 5 levels instead, because its book of 20 levels arrives only about every 5.4 s.

### Tests and acceptance

23. Each adapter ships unit tests in the shape of the 2026-10-01 adapters.
    Loader tests feed a reply trimmed from the venue's live reply through the parse function, with one inactive row, one dropped family and one row of every kept family.
    Anchor tests run against the local REST host in [`venues/testing.rs`](../../server/src/venues/testing.rs), and feed tests drive `handle` on `Connection::for_test` with frames captured live.
    Every rule the adapter has gets a case: snapshot, delta, gap, unknown symbol, error frame, keepalive, and each anchor rule.
24. A venue is Done when four gates pass in the integrated tree.
    `cargo test` passes.
    `live_catalog` matches today's catalog and, where a class exists, the CCXT dump.
    `live_smoke` passes on every market for 90 s.
    `live_identity` passes.
    An exception, such as a market that never books, is accepted only with a verified reason recorded in the plan, as mexc's six unopened stock perpetuals were.
25. A new probe is Rust, as an ignored test beside the adapter, never a new `.mjs` file.
    The JS probes under [`scripts/probes/venues/`](../../scripts/probes/venues/) stay as frozen evidence, and an agent opens one only for a detail the profile lacks.
26. When the live venue disagrees with its profile, the live venue wins.
    The adapter follows it, and the verifier corrects the profile in place with the date it checked the fact.

### How the waves run

27. A wave is five units, and a unit is one venue or one family.
    Each unit gets two agents in turn: an implementer, then a verifier with fresh eyes.
    The verifier re-derives the rules from the profile, reruns every gate, attacks the failure paths, and fixes what it finds.
    That is ten agents per wave and at most two per venue.
    From wave 3 on, two waves run at once, as the user asked on 2026-10-09, and each wave runs its five units as lanes.
    A lane starts its next unit as soon as its last one is verified, so no unit waits for the slowest unit of its wave, and ten agents work at a time.
28. Each unit works in its own copy of `server/` under the gitignored `.claude/venue-work/` folder, never in the main tree.
    The verifier corrects its venue's profile in the main tree, since no other unit touches that folder.
29. A build takes one of two lock slots, because the laptop has about 5 GB of free memory and one build of this crate takes about 25 s.
    kache caches the dependencies across copies, so a fresh copy also builds in about 25 s.
    The live tests run as debug builds, which parse a busy venue fast enough.
30. An agent edits no shared file except its unit's registration lines, which are the arms in `venues/mod.rs` and the entry in `ALL_VENUES` at [`live_tests.rs:23`](../../server/src/venues/live_tests.rs).
    An agent that needs a change in a shared file stops and reports it, and the orchestrator makes the change between waves.
    The `mexc` and `xt` profile changes of decision 10 are the planned exceptions, each owned by one unit.
31. As units pass, the orchestrator copies each into the main tree, adds its registration lines, runs `cargo test` and `live_catalog`, and updates the tracker.
    Nothing is committed, because the user commits.
32. The pilot wave holds one venue for each shared piece, so a defect in wave 0 shows up once rather than in every later wave.
    The other waves go by value, with independent books and many perpetuals first and relays and small families last.
    At most two large units share a wave.
33. After the last wave, one research pass re-checks the 28 blocked venues from today's network, and any that now fit go into an extra wave.

## Venue table

Perpetuals are what the scouts counted on 2026-10-08 under decision 3's families, or the profile's count where the call failed.
Shared pieces name the wave 0 parts of decisions 12 to 17 that the venue uses, plus "turn" for funding read in turn.

| Wave | Unit | Venue id | Name | Profile | CCXT 4.5.68 | Perpetuals | Shared pieces | Relay |
|---|---|---|---|---|---|---|---|---|
| 1 | kucoinfutures | kucoinfutures | KuCoin Futures | [`kucoin/`](../profiles/kucoin/) | kucoinfutures | 687 | none | no |
| 1 | bingx | bingx | BingX | [`bingx/`](../profiles/bingx/) | bingx | 952 | gzip | no |
| 1 | cryptocom | cryptocom | Crypto.com Exchange | [`cryptocom/`](../profiles/cryptocom/) | cryptocom | 409 | socket anchors | no |
| 1 | woo | woo | WOO X | [`woo/`](../profiles/woo/) | woo | 222 | REST seed | no |
| 1 | whitebit | whitebit | WhiteBIT | [`whitebit/`](../profiles/whitebit/) | whitebit | 395 | none | no |
| 2 | htx | htx | HTX | [`htx/`](../profiles/htx/) | htx | 376 | gzip, turn | no |
| 2 | phemex | phemex | Phemex | [`phemex/`](../profiles/phemex/) | phemex | 135 | none | no |
| 2 | deribit | deribit | Deribit | [`deribit/`](../profiles/deribit/) | deribit | 134 | none | no |
| 2 | hyperliquid | hyperliquid | Hyperliquid | [`hyperliquid/`](../profiles/hyperliquid/) | hyperliquid | 178 | POST | no |
| 2 | bitunix | bitunix | Bitunix | [`bitunix/`](../profiles/bitunix/) | none | 718 | none | no |
| 3 | bitmart | bitmart | BitMart | [`bitmart/`](../profiles/bitmart/) | bitmart | 355 | socket anchors | no |
| 3 | xt | xt | XT.COM | [`xt/`](../profiles/xt/) | xt | 693 | none | no |
| 3 | weex | weex | WEEX | [`weex/`](../profiles/weex/) | weex | 1,032 | headers | no |
| 3 | toobit | toobit | Toobit | [`toobit/`](../profiles/toobit/) | toobit | 775 | none | no |
| 3 | backpack | backpack | Backpack Exchange | [`backpack/`](../profiles/backpack/) | backpack | 91 | REST seed | no |
| 4 | deepcoin | deepcoin | Deepcoin | [`deepcoin/`](../profiles/deepcoin/) | deepcoin | 359 | socket anchors | no |
| 4 | bitfinex | bitfinex | Bitfinex | [`bitfinex/`](../profiles/bitfinex/) | bitfinex | 76 | none | no |
| 4 | btse | btse | BTSE | [`btse/`](../profiles/btse/) | none | 219 | Retry-After | no |
| 4 | digifinex | digifinex | DigiFinex | [`digifinex/`](../profiles/digifinex/) | digifinex | 103 | zlib, turn | no |
| 4 | delta | delta | Delta Exchange | [`delta/`](../profiles/delta/) | delta | 6 | none | no |
| 5 | coinw | coinw | CoinW | [`coinw/`](../profiles/coinw/) | none | 387 | socket anchors | no |
| 5 | pionex | pionex | Pionex | [`pionex/`](../profiles/pionex/) | none | 553 | turn | no |
| 5 | poloniex | poloniex | Poloniex | [`poloniex/`](../profiles/poloniex/) | poloniex | 18 | turn | no |
| 5 | bigone | bigone | BigONE | [`bigone/`](../profiles/bigone/) | bigone | 97 | none | no |
| 5 | hashkey | hashkey | HashKey Global | [`hashkey/`](../profiles/hashkey/) | hashkey | 2 | none | no |
| 6 | orangex | orangex | OrangeX | [`orangex/`](../profiles/orangex/) | none | 579 | REST seed | no |
| 6 | hotcoin | hotcoin | Hotcoin | [`hotcoin/`](../profiles/hotcoin/) | none | 594 | none | no |
| 6 | hibt | hibt | Hibt | [`hibt/`](../profiles/hibt/) | none | 82 | none | no |
| 6 | globe | globe | Globe | [`globe/`](../profiles/globe/) | none | 28 | none | no |
| 6 | uzx | uzx | UZX | [`uzx/`](../profiles/uzx/) | none | 60 | turn | no |
| 7 | echobit | echobit | Echobit | [`echobit/`](../profiles/echobit/) | none | 126 | socket anchors, turn | no |
| 7 | trubitpro | trubitpro | TruBit Pro Exchange | [`trubit-pro/`](../profiles/trubit-pro/) | none | 40 | REST seed | no |
| 7 | valr | valr | VALR | [`valr/`](../profiles/valr/) | none | 4 | none | no |
| 7 | hitbtc | hitbtc | HitBTC | [`hitbtc/`](../profiles/hitbtc/) | hitbtc | 50 | none | no |
| 7 | hitbtc | fmfwio | FMFW.io | [`fmfwio/`](../profiles/fmfwio/) | fmfwio | 23 | none | no |
| 7 | hitbtc | changellypro | Changelly PRO | [`changelly-pro/`](../profiles/changelly-pro/) | none | 18 | none | hitbtc |
| 7 | hitbtc | mandala | Mandala Exchange | [`mandala/`](../profiles/mandala/) | none | 24 | none | gleecbtc |
| 7 | hitbtc | gleecbtc | Gleec BTC | [`gleec-btc/`](../profiles/gleec-btc/) | none | 30 | none | mandala |
| 7 | mexc | ourbit | Ourbit | [`ourbit/`](../profiles/ourbit/) | none | 752 | none | no |
| 7 | mexc | bydfi | BYDFi | [`bydfi/`](../profiles/bydfi/) | bydfi, broken | 258 | none | no |
| 8 | chainup | aivora | Aivora Exchange | [`aivora/`](../profiles/aivora/) | none | 77 | POST, turn | no |
| 8 | chainup | fameex | FameEX | [`fameex/`](../profiles/fameex/) | none | 217 | gzip, turn | no |
| 8 | chainup | xme | x.me Exchange | [`x-me/`](../profiles/x-me/) | none | 259 | gzip, socket anchors, POST | no |
| 8 | chainup | koinbay | Koinbay | [`koinbay/`](../profiles/koinbay/) | none | 127 | gzip, socket anchors | no |
| 8 | biconomy | biconomy | Biconomy.com | [`biconomy/`](../profiles/biconomy/) | none | 316 | REST seed | no |
| 8 | orderly | niza | Niza.io | [`niza/`](../profiles/niza/) | none | 73 | none | Orderly |
| 8 | orderly | nonkyc | Nonkyc.io | [`nonkyc/`](../profiles/nonkyc/) | none | 73 | none | Orderly |
| 8 | zoomex | zoomex | Zoomex | [`zoomex/`](../profiles/zoomex/) | none | 711 | turn | bybit |
| 8 | bitradex | bitradex | BitradeX | [`bitradex/`](../profiles/bitradex/) | none | 56 | turn | binance, suspected |
| 9 | tothemoon | tothemoon | Tothemoon | [`tothemoon/`](../profiles/tothemoon/) | none | 13 | socket anchors | no |

The chainup family reads index and mark from its socket ticker on every member that has one, because a per contract REST sweep of fameex's 217 contracts cannot finish inside the skew of decision 18.
Hyperliquid is built for its main dex only.

## What the live checks found

Each wave adds one row per venue here once its unit is merged.
The numbers are the verifier's last run, and the plan lists each accepted exception under its wave.

| Venue | Markets | Window | Book updates | No book | Never two sided | Crossed | Sockets closed | Anchored | Identity outliers |
|---|---|---|---|---|---|---|---|---|---|
| kucoinfutures | 686 | 90 s | 235,237 | 0 | 0 | 0 | 0 | all but 5 pre market | ONUSDTM denied as another token |
| bingx | 951 | 90 s | 143,824 | 0 | 0 | 0 | 0 | all | ON-USDT denied, COOL-USDT accepted |
| cryptocom | 408 | 90 s | 93,140 | 0 | 0 | 0 | 0 | all | EDGEUSD-PERP denied as another token |
| woo | 222 | 90 s | 399 | 0 | 168 | 0 | 0 | all but 3 | none |
| whitebit | 395 | 90 s | 33,841 | 0 | 0 | 0 | 0 | all but 93 TradFi | none |
| htx | 377 | 90 s | 77,259 | 0 | 0 | 0 | 0 | all | KR200-USDT accepted |
| phemex | 135 | 90 s | 17,871 | 0 | 0 | 0 | 0 | all | none |
| deribit | 134 | 90 s | 13,154 | 0 | 0 | 0 | 0 | all but 36 RWA | none |
| hyperliquid | 177 | 90 s | 57,061 | 0 | 0 | 0 | 0 | all | PURR denied as another token |
| bitunix | 717 | 90 s | 205,689 | 0 | 0 | 0 | 0 | all | ONUSDT denied as another token |
| toobit | 774 | 90 s | 33,790 | 0 | 0 | 0 | 0 | all | ON-SWAP-USDT denied, HK50-SWAP-USDT accepted |
| bitfinex | 76 | 90 s | 125,690 | 0 | 0 | 0 | 0 | none, no index | none |
| btse | 216 | 90 s | 78,405 | 0 | 0 | 0 | 0 | all | 1KCAT, GAS and QNT denied, KR200-PERP accepted |
| digifinex | 101 | 90 s | 10,813 | 0 | 0 | 0 | 0 | all | BETH and OETH denied as extra ETH contracts |
| delta | 6 | 90 s | 476 | 0 | 0 | 0 | 0 | all | none |
| xt | 691 | 90 s | 98,784 | 0 | 0 | 0 | 0 | all but 2 | on_usdt and nflx_usdt denied |
| backpack | 91 | 90 s | 196,440 | 0 | 0 | 0 | 0 | all but 17 equity | none |
| deepcoin | 359 | 90 s | 143,408 | 0 | 0 | 0 | 0 | all | none |
| bigone | 97 | 90 s | 1,573 | 0 | 0 | 0 | 0 | all | none |
| globe | 28 | 90 s | 24,850 | 0 | 0 | 0 | 0 | all | none |
| uzx | 59 | 90 s | 36,722 | 0 | 0 | 0 | 0 | all | UZXUSDT denied as a self index |
| weex | 1,030 | 90 s | 168,144 | 0 | 11 | 0 | 0 | all | 6 denied, HK50USDT accepted |
| coinw | 376 | 150 s | 157,469 | 0 | 0 | 0 | 0 | all | KR200 accepted |
| hashkey | 2 | 90 s | 176 | 0 | 0 | 0 | 0 | all | none |
| hibt | 76 | 90 s | 17,132 | 0 | 0 | 0 | 0 | all | hk50_usdt and jpn225_usdt accepted |
| zoomex | 711 | 90 s | 328,523 | 0 | 0 | 0 | 0 | all | ONUSDT accepted as the ON stock |
| poloniex | 18 | 90 s | 74,658 | 0 | 0 | 0 | 0 | all | none |
| hotcoin | 597 | 90 s | 74,648 | 0 | 0 | 0 | 0 | 174, the rest fill over about 300 s | kr200usdt, onusdt and hk50usdt accepted |
| orangex | 210 | 90 s | 9,879 | 0 | 0 | 0 | 0 | all | ON and CAT denied |
| hitbtc | 49 | 90 s | 24,152 | 0 | 0 | 0 | 0 | all but 1 | CELUSDT_PERP denied |
| fmfwio | 22 | 90 s | 10,600 | 0 | 0 | 0 | 0 | all | CELUSDT_PERP denied |
| changellypro | 18 | 90 s | 7,875 | 0 | 0 | 0 | 0 | all | none |
| mandala | 24 | 90 s | 11,904 | 0 | 0 | 0 | 0 | all | none |
| gleecbtc | 30 | 90 s | 14,724 | 0 | 0 | 0 | 0 | all | none |
| bitradex | 56 | 90 s | 3,755 | 0 | 0 | 0 | 0 | all | none |
| pionex | 552 | 90 s | 91,631 | 0 | 0 | 0 | 0 | all | ON_USDT_PERP denied |
| echobit | 126 | 90 s | 3,210 | 0 | 0 | 0 | 0 | all | none |
| valr | 4 | 90 s | 422 | 0 | 0 | 0 | 0 | none, no index | none |
| ourbit | 750 | 90 s | 36,984 | 0 | 0 | 0 | 0 | all | ON, CAT and USO denied |
| bydfi | 258 | 90 s | 20,027 | 0 | 0 | 0 | 0 | all | none |
| biconomy | 316 | 90 s | 35,654 | 0 | 0 | 0 | 0 | all but 1 | none |
| niza | 73 | 90 s | 4,625 | 0 | 0 | 0 | 0 | all | none |
| nonkyc | 73 | 90 s | 4,477 | 0 | 0 | 0 | 0 | all | none |
| trubitpro | 39 | 90 s | 5,144 | 0 | 0 | 0 | 0 | all but 3 | TBTCTUSDT denied |
| tothemoon | 13 | 90 s | 5,891 | 0 | 0 | 0 | 0 | all but 2 | none |
| aivora | 87 | 90 s | 5,309 | 0 | 0 | 0 | 0 | all but 1 | none |
| fameex | 208 | 90 s | 36,848 | 0 | 0 | 0 | 0 | all | e_qcomusdt denied |
| xme | 259 | 90 s | 45,781 | 0 | 0 | 0 | 0 | all | none |
| koinbay | 93 | 90 s | 17,223 | 0 | 0 | 0 | 0 | all | none |

- The ON ticker means two things among the reference venues.
  Bybit and OKX list the ON Semiconductor stock at about 80, while gate and MEXC list the ON token at about 0.11.
  Binance's loader already denies its ON as another token from the one OKX and Bybit list, so KuCoin and BingX deny theirs the same way.
- WOO X streams only the book an API taker can fill, which leaves out the retail price improvement orders.
  That book is wide and idle, so 168 of 222 markets never showed both sides, and BTC's top was about 1.9 percent wide.
- WhiteBIT's 93 TradFi perpetuals have an index that is mostly their own last trade, so decision 4 leaves them out of the anchor rows.


## Rejected alternatives

- A design doc per venue.
  The profiles already hold each venue's facts, and the rules are the same fifty times.
- One generic adapter driven by a config file per venue.
  [`2026-07-30-venue-ws-protocol-differences.md`](../research/2026-07-30-venue-ws-protocol-differences.md) found sixteen axes on which five sockets differ, and code per venue reads more plainly than a config language that covers them all.
- Two agents building one venue in parallel, one on the feed and one on the anchor.
  They share one struct and one crate, so each would break the other's build.
- Git worktrees for isolation.
  A worktree starts from HEAD, and the foundation and every earlier wave stay uncommitted, because the user commits.
- Builds without a lock.
  Five parallel builds of this crate would exhaust the free memory.
- A second anchor runtime with sockets of its own.
  It would duplicate the feed's reconnect logic, and the close of an anchor socket must not mark books stale, which the feed's close does.
- A dedicated anchor socket plan beside the book plans.
  `spawn_feed` gives each market one plan, and a venue whose anchor field lives on another socket can read that field from REST in turn.
- A shared helper for funding read in turn.
  The bitstamp pattern is about 25 lines, and each venue's per market call differs.
- Filling the index with the mark where a venue publishes no index.
  The fresh edge would then read a standing basis as fresh.
- A per market stale event, so a REST seeded venue could reseed one market after a gap.
  The engine knows staleness per connection only, and the change would serve five venues against a resync that already works.
- Reusing the bybit module for zoomex.
  Bybit is running, and zoomex's anchor differs for its own four markets.
- Release builds for the live smoke.
  A release build per copy costs minutes and memory, and a debug build keeps up with a busy venue.

## Out of scope

- Starting any venue, and each venue's activation checklist.
- The 28 blocked venues, until the triage pass of decision 33.
- Engine guards the research asks for: a saturated mark rule, an index optional anchor, a guard against crossing two views of one book, and a per market stale book check for streams that stall, as Pionex's busy streams do for about 10 s.
- Hyperliquid's builder deployed dexes, whose markets have their own oracles.
- The exchange timestamp, kernel stamp and lag gate of [`2026-09-17-rust-rewrite-requirements.md`](../backlog/2026-09-17-rust-rewrite-requirements.md).
- Trading and private endpoints.
