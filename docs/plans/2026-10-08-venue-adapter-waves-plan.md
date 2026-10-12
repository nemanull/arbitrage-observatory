# Venue adapter waves, plan

Implements [`2026-10-08-venue-adapter-waves-design.md`](./2026-10-08-venue-adapter-waves-design.md), which is the design of record.
Decision numbers below are that doc's.

## Scope guard

This work does not:

- add an id to `ACTIVE_VENUES` or start any new venue,
- change the engine, the opportunity code, the database schema, the migrations or CI,
- change the ten existing adapters, except the `mexc` profiles of decision 10,
- build the 28 blocked venues, Hyperliquid's builder dexes, or any private endpoint,
- add a JS file to the repository, since new probes are Rust per decision 25,
- commit anything, because the user commits.

## Status

| Task | Venues | Status |
|---|---|---|
| 0.1 Feed runtime | shared | Done |
| 0.2 HTTP helpers | shared | Done |
| 0.3 Decompression | shared | Done |
| 0.4 `SocketAnchors` | shared | Done |
| 0.5 `live_identity` | shared | Done |
| 0.6 Verify wave 0 | shared | Done |
| 0.7 Shared follow ups from waves 1 and 2 | shared | In progress |
| 1.1 kucoinfutures | kucoinfutures | Done |
| 1.2 bingx | bingx | Done |
| 1.3 cryptocom | cryptocom | Done |
| 1.4 woo | woo | Done |
| 1.5 whitebit | whitebit | Done |
| 2.1 htx | htx | Done |
| 2.2 phemex | phemex | Done |
| 2.3 deribit | deribit | Done |
| 2.4 hyperliquid | hyperliquid | Done |
| 2.5 bitunix | bitunix | Done |
| 3.1 bitmart | bitmart | Blocked |
| 3.2 xt | xt | Done |
| 3.3 weex | weex | Done |
| 3.4 toobit | toobit | Done |
| 3.5 backpack | backpack | Done |
| 4.1 deepcoin | deepcoin | Done |
| 4.2 bitfinex | bitfinex | Done |
| 4.3 btse | btse | Done |
| 4.4 digifinex | digifinex | Done |
| 4.5 delta | delta | Done |
| 5.1 coinw | coinw | Done |
| 5.2 pionex | pionex | Done |
| 5.3 poloniex | poloniex | Done |
| 5.4 bigone | bigone | Done |
| 5.5 hashkey | hashkey | Done |
| 6.1 orangex | orangex | Done |
| 6.2 hotcoin | hotcoin | Done |
| 6.3 hibt | hibt | Done |
| 6.4 globe | globe | Done |
| 6.5 uzx | uzx | Done |
| 7.1 echobit | echobit | Done |
| 7.2 trubitpro | trubitpro | Done |
| 7.3 valr | valr | Done |
| 7.4 hitbtc family | hitbtc, fmfwio, changellypro, mandala, gleecbtc | Done |
| 7.5 mexc family | ourbit, bydfi | Done |
| 8.1 chainup family | aivora, fameex, xme, koinbay | Done |
| 8.2 biconomy | biconomy | Done |
| 8.3 orderly family | niza, nonkyc | Done |
| 8.4 zoomex | zoomex | Done |
| 8.5 bitradex | bitradex | Done |
| 9.1 tothemoon | tothemoon | Done |
| 10. Triage of the blocked venues | 28 blocked | Done |
| 11. Reconcile | all | In progress |

## How a wave runs

The orchestration files live in the gitignored `.claude/venue-work/` folder at the repository root.
`waves.json` defines every wave's units, their venues, lock slots and notes.
`cards.json` holds the scouts' card for each of the 50 venues, as of 2026-10-08.
`venue_work.py` prepares the copies and merges the results.
`wave.js` is the workflow script that runs one wave.

1. Run `python3 -I .claude/venue-work/venue_work.py prepare <wave>`, which copies `server/` without `target/` into `.claude/venue-work/w<wave>/<unit>/server` for each unit.
2. Run the Workflow tool with `scriptPath` set to `.claude/venue-work/wave.js` and `args` set to `{ date, lanes }`, where each lane lists units from `waves.json` with their wave added.
   Each unit runs as an implementer followed by a verifier, and a lane runs its units one after another.
   From wave 3 on, two workflows of five lanes run at once, so ten agents work at a time.
3. To merge units while the workflow still runs, rebuild a result file from its journal with `python3 -I .claude/venue-work/venue_work.py journal <journal.jsonl> <result.json>`.
   Otherwise save the workflow's output file as `.claude/venue-work/w<wave>/result.json`.
4. Run `python3 -I .claude/venue-work/venue_work.py integrate <wave> .claude/venue-work/w<wave>/result.json`.
   It merges each unit whose verifier passed, after checking that the unit changed only its module and its registration lines, and it reports every unit it refused.
5. From `server/`, run `flock ../.claude/venue-work/build-0.lock cargo test` and `LIVE_VENUES=<wave ids> cargo test live_catalog -- --ignored --nocapture`.
6. Set the tracker above, add each venue's live check numbers to the design's last section, and note each accepted exception and each deliberate CCXT difference under the wave's task below.
7. A unit that is blocked or failed keeps its copy and its status, and the orchestrator decides whether a shared change or a rerun clears it.

## Rules for every unit

These rules are what every implementer and verifier follows.
The design's decisions are the reasons behind them.

### Before writing code

- Read the design's decisions, these rules, the unit's cards in `.claude/venue-work/cards.json`, each venue's profile files `fees.md`, `rest.md` and `websocket.md`, and the venue's section under "Notes per venue" in [`2026-09-22-venue-survey.md`](../research/2026-09-22-venue-survey.md).
- Read the existing adapter closest to the venue.
  [`gate.rs`](../../server/src/venues/gate.rs) is a plain venue, [`binance.rs`](../../server/src/venues/binance.rs) seeds from a snapshot channel beside a diff channel, [`bitstamp/anchor.rs`](../../server/src/venues/bitstamp/anchor.rs) reads funding in turn, [`okx/anchor.rs`](../../server/src/venues/okx/anchor.rs) refreshes a table hourly, and [`gemini/anchor.rs`](../../server/src/venues/gemini/anchor.rs) refreshes beside the rounds.
- Open the venue's JS probe under [`scripts/probes/venues/`](../../scripts/probes/venues/) only for a detail the profile lacks.

### Where to work

- Work only in the unit's copy, `.claude/venue-work/w<wave>/<unit>/server`, and never edit the main tree's `server/`.
- Run no git command, not even a read only one, since the main tree belongs to the user.
- A unit changes only its module, which is `src/venues/<module>.rs` and `src/venues/<module>/`, and its registration lines in `src/venues/mod.rs` and `src/venues/live_tests.rs`.
- The verifier may also correct the venue's profile under `docs/profiles/<profile>/` in the main tree.
- Every build and test runs under the unit's lock slot, as `flock <repo>/.claude/venue-work/build-<slot>.lock cargo test ...` from the copy's `server/`.
- A live test is built under the lock with `cargo test --no-run` first, and then runs without the lock, since it holds no compiler.
- Do not run `cargo fmt`, because the existing code is not rustfmt clean.
  Match the style of the existing adapters by hand.

### Layout and registration

- One venue: `src/venues/<id>.rs` holds the struct and its `BookVenue`, `src/venues/<id>/anchor.rs` its `AnchorVenue`, `src/venues/<id>/markets.rs` its loader, and `src/venues/<id>/tests.rs` its feed tests.
- A family: the same four files under the family's module, with one profile constant per venue that holds its id, name, hosts, taker and every other difference.
- Registration per venue: a `mod` line and a `use` line for the module, one arm in `load_venue` and one in `start_venue` in `src/venues/mod.rs`, and the id in `ALL_VENUES`.

### Loader

- Keep linear perpetuals quoted in USDT, USDC or USD that the venue lists as trading, and drop inverse and coin quoted contracts (decision 3).
- Reproduce the CCXT 4.5.68 class's rules and `commonCurrencies` where a class exists, and follow the venue where the class is wrong (decision 7).
  The class's source is under `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/`.
- Set the taker to the VIP 0 taker of `fees.md` (decision 5) and the contract size to the unit of the book's sizes (decision 6).
- Hand the markets to `catalog::finish` with a deny list, where each entry names the other token it collides with.

### Book

- Follow the profile's socket shape: URL, subscribe frames, keepalive, silence, connect stagger, subscribe gap and the venue's caps per connection.
- Chain deltas by the venue's sequence rule and call `resync` on a gap (decision 21).
- Subscribe at the smallest depth of at least 20 levels, or the deepest offered below that (decision 22).
- Inflate gzip or zlib frames with `wire::gunzip` or `wire::inflate` (decision 12).
- Seed a book from REST through `snapshot_url`, `handle_snapshot` and `request_snapshot` when the socket sends no snapshot (decision 14).
- Log a venue error frame at error as `venue_error` with the connection id, and a venue notice as `venue_notice`.

### Anchor

- Index and mark come from a bulk call, the socket, or a per market sweep of about 3 s (decision 18).
- Use `SocketAnchors` when the socket is the only source of an anchor field (decision 13).
- Read funding in turn, as bitstamp does, when only a per market call carries it.
- Never fill a field with a number that means something else, so a venue with no index leaves its rows out and a venue with no mark sends 0 (decision 19).
- Leave out a contract whose index basket is the venue's own perpetual (decision 4).
- Take the interval and the next funding from the venue, then from the profile's documented constant, and send 0 for an unknown next funding (decision 20).
- Set `poll_every` and `rate_limit_pause` from the venue's limits.

### Tests

- Write the unit tests of decision 23, with replies and frames captured live on the day of the work and a comment naming that date.
- Name each test as a sentence in snake case, as the existing adapters do.

### Gates

Run all four from the copy's `server/`, and paste the summary lines into the report.

1. `flock <lock> cargo test` passes.
2. `LIVE_VENUES=<ids> cargo test live_catalog -- --ignored --nocapture` lists the venue's markets.
   Where a CCXT class exists, a throwaway script beside the copy, never inside `server/`, loads `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/dist/ccxt.cjs`, applies decision 3, and prints the same columns, and the two lists differ only where decision 7 says so.
3. `LIVE_VENUES=<ids> LIVE_SECONDS=90 cargo test live_smoke -- --ignored --nocapture` passes.
4. `LIVE_VENUES=<ids> LIVE_SECONDS=30 cargo test live_identity -- --ignored --nocapture` passes.

### When something does not fit

- When the live venue disagrees with its profile, the live venue wins, and the report lists each disagreement (decision 26).
- A market that never books or a resync the venue causes is accepted only with a verified reason in the report.
- A needed change in a shared file stops the unit, and the report says `blocked` and names the exact change (decision 30).
- When the references disagree with each other by more than 10 percent, the running venues' meaning of the ticker wins, and a market that means the other token is denied with that reason.
  On 2026-10-08 Bybit and OKX listed ON as the ON Semiconductor stock and gate and MEXC as the ON token, so the ON token is denied, as binance's loader already does.
- A venue whose books are mostly one sided or idle in the live smoke needs a verified reason, recorded as an exception, as WOO X's book of non RPI orders has.
- A live test that runs while other units build can starve and miss books, so rerun it before chasing a fault in the adapter.

## Tasks

### 0. Wave 0, the shared pieces

Three implementers build 0.1 and 0.2, 0.3 and 0.4, and 0.5 in three copies at once, the orchestrator merges them, and one verifier runs 0.6.

#### 0.1 Feed runtime, decisions 13, 14 and 17

- `server/src/feeds/venue_feed.rs`:
  - `Connection::frame_recv_ts` returns the arrival of the frame being handled.
  - `BookVenue::snapshot_url(&self, market: &Market)` returns an `Option<String>` and defaults to none.
  - `BookVenue::handle_snapshot(&self, position: usize, body: &[u8], conn: &mut Connection<Self::State>)` returns an `anyhow::Result<()>` and defaults to doing nothing.
  - `Connection::request_snapshot(position)` queues a market once while it is queued or in flight, and `begin` clears the queue.
  - `FeedSettings` gains `snapshot_gap`, the pause between two snapshot requests on one connection, and `headers`, a static list of handshake headers.
  - `run_connection` fetches the queued snapshots one at a time, paced by the gap, and hands each reply to `handle_snapshot` under `catch_panic`, then sends the outbox, flushes the changed books and honours a resync as after a frame.
    A failed fetch queues the market again behind a pause that doubles with each consecutive failure, logging `snapshot_failed` at warn on the first failure of a run and every 30th, and a failed `handle_snapshot` logs `snapshot_handle_failed` at error.
  - The handshake builds its request from the URL and adds `headers`.
  - `spawn_feed` and `run_socket` take the HTTP client.
- `server/src/venues/mod.rs`: `start` passes the run's HTTP client to `spawn_feed`, and the `testing` module becomes `pub(crate)` so the feed tests can use `MockRest`.
- `server/src/feeds/venue_feed/tests.rs`: a snapshot requested on the first delta and applied before the buffered deltas, a failed fetch queued again, a second request for a queued market ignored, the queue cleared by a reconnect, the gap between two requests, and a header that reaches the server.

#### 0.2 HTTP helpers, decision 16

- `server/src/feeds/anchor_poller.rs`: `get_bytes` holds the request, the status check and the rate limit answer, and `get_json` parses its body.
  `post_json` sends a JSON body through the same path.
  `retry_after` reads an all digit value above 10^9 as Unix seconds and above 10^12 as Unix ms.
- `server/src/feeds/anchor_poller/tests.rs`: cases for each.

#### 0.3 Decompression, decision 12

- `server/Cargo.toml`: `flate2` at the version `Cargo.lock` already holds.
- `server/src/venues/wire.rs`: `gunzip` and `inflate`, each taking a frame and returning its inflated bytes, with tests.

#### 0.4 `SocketAnchors`, decision 13

- `server/src/venues/socket_anchors.rs`: `SocketAnchors::new(publishes_mark)`, `set_index`, `set_mark` and `set_funding`, each taking the raw market id and the frame's arrival where it matters, and `rows`, which returns the complete rows.
  A row's `ts` is the older arrival of its index and its mark, or the index's arrival on a venue with no mark.
- `server/src/venues/mod.rs`: the `mod` line.

#### 0.5 `live_identity`, decision 15

- `server/src/venues/live_tests.rs`: `live_identity` and its five reference venues.
- `server/src/orchestrator.rs`: `tracked_venues` becomes `pub(crate)` if the test reuses it.

#### 0.6 Verify wave 0

- A verifier reviews the merged foundation against decisions 12 to 17, reruns `cargo test`, runs `live_smoke` on gate and bitstamp for 60 s as a regression check of the feed runtime, and runs `live_identity` with `LIVE_VENUES=krakenfutures,gemini`.

### 1 to 9. The waves

Each task writes the unit's module and registration lines as the rules above say.
A single venue unit writes `server/src/venues/<id>.rs`, `server/src/venues/<id>/anchor.rs`, `server/src/venues/<id>/markets.rs` and `server/src/venues/<id>/tests.rs`.
A family unit writes the same four files under the family's module.
Every unit also edits `server/src/venues/mod.rs` and `server/src/venues/live_tests.rs` for its registration.
The notes for each unit sit in `waves.json`, and the design's venue table names the shared pieces each venue uses.

| Wave | Units |
|---|---|
| 1 | kucoinfutures, bingx, cryptocom, woo, whitebit |
| 2 | htx, phemex, deribit, hyperliquid, bitunix |
| 3 | bitmart, xt, weex, toobit, backpack |
| 4 | deepcoin, bitfinex, btse, digifinex, delta |
| 5 | coinw, pionex, poloniex, bigone, hashkey |
| 6 | orangex, hotcoin, hibt, globe, uzx |
| 7 | echobit, trubitpro, valr, the hitbtc family, the mexc family |
| 8 | the chainup family, biconomy, the orderly family, zoomex, bitradex |
| 9 | tothemoon |

The mexc family edits `server/src/venues/mexc.rs` and `server/src/venues/mexc/` as decision 10 allows.
Bitradex may edit `server/src/venues/xt.rs` and `server/src/venues/xt/` for the same reason.

#### Wave 1 results

All five units passed their verifiers on 2026-10-08 and were merged, and the main tree passed 706 tests.

- kucoinfutures keeps base ALT on `ALTUSDTM`, which is AltLayer, where CCXT's kucoin table renames ALT to APTOSLAUNCHTOKEN for an old spot token.
  It denies `ONUSDTM`.
  Its five pre market contracts have a basket of KuCoin's own perpetual, so they get books and no anchor rows.
  A quiet contract gets its snapshot only with its first book change, so a few `book_unserved` lines show at each start.
- bingx drops the 150 status 25 contracts that CCXT keeps, because they take no new positions and have no premium index row.
  It denies `ON-USDT`.
  `COOL-USDT` is an accepted identity exception: its index agrees with gate and MEXC within 4.5 percent, while its book and mark sit about 24 percent above them.
- cryptocom denies `EDGEUSD-PERP`, which is Definitive's EDGE at 0.117 while binance, bybit, okx and MEXC list edgeX at 0.365.
  Its anchors come from the socket through `SocketAnchors`.
- woo leaves three rows out of the anchors: a null index on `PERP_SOLV_USDT`, and frozen funding estimators on `PERP_BNB_USDT` and `PERP_SNDK_USDT`.
  Its book of non RPI orders is the exception recorded in the design's last section.
- whitebit keeps the 93 `tradfiFutures` rows that CCXT loads as spot, and its contract sizes differ from CCXT's on 110 markets, because CCXT copies the order step.
- Found outside the wave: gate's `EDGE_USDT` is Definitive's EDGE at 0.116, so activating gate must deny it.

#### Wave 2 results

All five units passed their verifiers on 2026-10-08 and were merged, and the main tree passed 893 tests.

- htx reads marks per market, a third of them each round, because no call carries them in bulk.
  At about twice that pace HTX's EdgeOne front blocked this host for five minutes with HTTP 567, so the poller now pauses on 567 and on its bot challenge page.
  `KR200-USDT` is an accepted identity exception: it matches okx's KOSPI 200 at about 1,037, while gate's `KR200_USDT` quotes it in another unit at about 0.77.

- phemex's book sequence cannot reveal a lost delta, so its feed resyncs on a crossed book or an unreadable frame instead.
  Its 10 USDC-M rows keep contract size 1 where CCXT reads 0.
- deribit subscribes the full depth channel `book.<id>.100ms`, chained by `prev_change_id`, rather than the grouped channel of 20 levels.
  Its 36 RWA perpetuals, 24 equity, 6 ETF, 4 commodity and 2 pre IPO, get books and no anchor rows under Deribit's RWA rules.
- hyperliquid denies `PURR`, the Purr token at 0.116, because bybit, gate and okx list the Nasdaq stock of Hyperliquid Strategies as PURR.
  Its six k-prefixed coins, such as `kPEPE`, cluster as PEPE with `price_scale` 0.001, since one unit is 1,000 tokens, where CCXT names the base KPEPE.
  It subscribes the fast `l2Book` of 5 levels plus `bbo`, an accepted departure from decision 22, because the book of 20 levels arrives only about every 5.4 s.
- bitunix denies `ONUSDT`, and an empty frame now clears a book that had levels, since Bitunix sends such a frame once and then nothing.
- Found outside the wave: gate's `KR200_USDT` is the KOSPI 200 divided by the won per dollar rate, so activating gate must scale or deny it.

#### Waves 3 and 4 results

From wave 3 on, the two waves run at once and units merge as they pass, so these notes grow as units finish.

- bitmart is Blocked by the network rather than the code.
  On 2026-10-08 and 2026-10-09 its REST host `api-cloud-v2.bitmart.com` got no DNS answer from this host, because Cloudflare returns no address for it through the VPN exit in Canada, while its socket host resolves.
  The catalog, funding and interval are only on REST, so the unit reruns unchanged once the name resolves, for example from another exit.
- toobit denies `ON-SWAP-USDT`, the ON token.
  `HK50-SWAP-USDT` is an accepted identity exception: it is the Hang Seng in dollars, as gate's `HK50_USDT` is, while MEXC quotes it in Hong Kong dollar points.
  No running venue lists HK50, but activating toobit or MEXC beside the other needs a unit decision on HK50.
  Its mark call answers HTTP 400 with "Too many requests!" on about 2 of 120 polls at one a second, which fails that round only.
- bitfinex gets no anchor rows at all under decision 19, because its only published price besides the book is its mark.
- btse denies `1KCAT-PERP` (Simon's Cat, not the Caterpillar token), `GAS-PERP` (natural gas, not NEO's GAS) and `QNT-PERP` (the Quantinuum stock, not the Quant token).
  `KR200-PERP` is an accepted identity exception, matching okx's KOSPI 200, as htx's does.
  A crossed snapshot is now refused before it is published.
- digifinex denies `BETHUSDTPERP` and `OETHUSDTPERP`, two extra ETH contracts that CCXT files under the same symbol as `ETHUSDTPERP`.
  `SPYUSDTPERP` keeps CCXT's base SSPY, so it does not cluster with binance's and bybit's SPY although its index matches theirs.
- delta's six markets passed with no exception.
- xt subscribes fewer streams per socket, because about one session in ten served only the first 256 streams of a socket that asked for 400.
  It denies `on_usdt`, the ON token, and `nflx_usdt`, whose index was still on the scale before Netflix's split, 704.83 against a mark of 70.65.
  A gap or a crossed top empties that one market's book and resubscribes its seed stream, an accepted departure from decision 21, since an empty book is never a live leg.
- backpack seeds its books from REST under decision 14, and its 17 equity perpetuals get books and no anchor rows, because outside the US session their index can be Backpack's own average.
- deepcoin reads its index from the socket through `SocketAnchors`.
  Its feed now resyncs on a lost push that leaves a level behind, and on a lost snapshot, where before such a book stayed wrong until a later snapshot.

#### Waves 5 and 6 results

- bigone's feed now resyncs on a level it cannot read and on a book frame that fails to parse, where before the book stayed published without that change.
- globe's 28 markets passed with no exception.
- uzx denies `UZXUSDT`, the venue's own token, whose index is its own price.
  A book frame with a lower `seqId` than the last now resyncs instead of being dropped.
- coinw reads index, mark and funding from the socket and subscribes at its documented five depth subscribes a second, so it needs about 80 s to boot and fails its anchor rounds until then.
  A 90 s smoke on a loaded host left the last 11 markets unanchored, and a 150 s run anchored all 376 from about 83 s.
  Its funding equals Binance's on almost every shared contract, so activating it beside binance needs a decision on two views of one price.
- hashkey's feed now refuses a push that lacks a side and resyncs when the version goes back.
- poloniex's 18 markets passed with no exception.
- orangex keeps the 210 perpetuals with the most turnover out of 579, because OrangeX serves at most 30 channels per socket and caps the sockets an IP may open.
  It seeds its books from REST under decision 14, aligned on `change_id`, and denies ON and `CAT-USDT-PERPETUAL` (Simon's Cat, not the Caterpillar stock).
- pionex denies `ON_USDT_PERP`, and its feed now resyncs on a frame whose action is neither snapshot nor update.
- hotcoin infers each funding interval from three settlements of its rate history, so its anchors fill over about 300 s after a start, and a contract listed within the last two settlements stays unanchored until then.
- hibt sends mark 0 under decision 19, and `hk50_usdt` and `jpn225_usdt` are accepted identity exceptions, since gate quotes those indexes in dollars and HIBT in points.
- weex denies `ONUSDT`, `CATUSDT` (Simon's Cat, not the Caterpillar stock), `UMCUSDT` (another listing and unit), and `PIUSDT`, `FOXAUSDT` and `OUSTUSDT`, which do not trade and sit far from their own index.
  `HK50USDT` is an accepted identity exception, quoting the Hang Seng in points as MEXC does.
  11 listed contracts never showed both sides in 90 s, and each has no trading.

#### Wave 7 results

- The hitbtc family serves hitbtc, fmfwio, changellypro, mandala and gleecbtc from one module, each venue a profile constant.
  hitbtc and fmfwio deny `CELUSDT_PERP`, listed as working with an empty book and a frozen index, and hitbtc's `HITUSDT_PERP` gets no anchor rows, since its index is HitBTC's own spot price.

- echobit reads mark and index from its socket klines through `SocketAnchors`, and a push that lacks a side or does not parse now resyncs instead of leaving the old book published.
- trubitpro seeds its books from REST under decision 14 and reseeds each every 60 s, because its frames carry no sequence.
  `TSLAUSDT`, `NVDAUSDT` and `XAGUSDT` get no anchor rows, because after the US close their index equalled TruBit's own book mid to the digit, and `TBTCTUSDT`, a second bitcoin contract in whole dollars, is denied.
- valr gets no anchor rows under decision 19, because it publishes no index anywhere, and an `UNSUBSCRIBED` frame for one of its own pairs now resyncs.
- The mexc module now carries a profile per venue, and ourbit and bydfi are two of them, while every one of mexc's own 41 tests passed unchanged.
  ourbit denies ON, `CAT_USDT` (Simon's Cat) and `USO_USDT`, which is WTI crude near 91 where okx's USO is the oil fund near 147.
- A flaky test of poloniex's anchor stamp asked for the index reply inside 250 ms, which failed once under the load of parallel builds, so its delays and margins now leave room for a loaded host.

#### Wave 8 results

- zoomex keeps `ONUSDT`, which is the ON Semiconductor stock, as it is on bybit and okx, so the identity check's median over gate's and MEXC's ON token is the outlier rather than zoomex.
  Its feed now sends one topic per subscribe frame, because one refused topic fails a whole frame.
- Found outside the waves: gate quotes `HK50_USDT`, `JPN225_USDT` and `KR200_USDT` in dollars, while every other venue quotes those indexes in points, so activating gate must scale or deny all three.
- The chainup family serves aivora, fameex, xme and koinbay from one module, with gzip frames on fameex, xme and koinbay.
  Index and mark come from the socket ticker on xme and koinbay, and from a REST sweep on aivora and fameex, which now polls fast enough that a row never ages past the engine's limit.
  fameex denies `e_qcomusdt`, whose book was frozen 6.7 percent above its index, and aivora's `e_spcxusdt` gets no anchor rows, because its index and mark read 0.
  An anchor-only socket plan would let fameex read its index from a socket instead of sweeping REST, which is a shared change left for later.
- biconomy seeds its books from REST under decision 14, and its feed now refuses a push that lacks a side and resyncs when the version goes back, while `ICP_USDT` gets no anchor rows because its index is frozen.
- The orderly family serves niza and nonkyc from one module, both relays of Orderly's shared book, with the shared `PERP_<BASE>_USDC` markets only.
- bitradex got its own module, because its paths differ from xt's beyond the prefix, so the xt module is unchanged.

#### Wave 9 results

- tothemoon reads its 13 perpetuals from its socket inside `load`, because it has no REST catalog, and its anchors come only from the socket through `SocketAnchors`.
  `ATOM_USDT_PERPETUAL` and `ETC_USDT_PERPETUAL` get books and no anchor rows under decision 19, because their index is not the market price of their coin.
- bitradex's touch equalled Binance's on btc, eth, sol, sui and trump in 83 to 98 percent of samples, about 1.1 s behind it, while its sizes and deeper levels are its own.
  So it is a maker pegged to Binance on some markets rather than a relay, and activating it beside binance needs the guard against two views of one price.

### 0.7 Shared follow ups from waves 1 and 2

Verifiers found these in shared files, which no unit may change, so each waits for the orchestrator.

- `venue_feed.rs` resets the reconnect backoff on every frame, so a socket the venue closes right after its first frames reopens at once, again and again.
  The reset should wait until a connection has stayed open for a while.
- `get_bytes` fails on a status outside 2xx before it reads the body, so Deribit's rate limit code 10028, which arrives under HTTP 400, reads as a plain failed round instead of `RateLimited`.
- `live_smoke` and `live_identity` build a fresh timeout from the deadline on every received event, which a saturated debug runtime can starve.
- Done on 2026-10-09: `live_identity` streamed five reference venues on every run, which saturated the CPU when five verifiers ran it at once.
  It now reads one REST anchor round from each reference, and a run on krakenfutures and cryptocom took 33 s and 17 s of CPU.
  The other three items are still open.
- `OrderBook::reset` and `set_level` skip a level whose price or size does not read, without a word.
  Verifiers in waves 3 to 8 added a resync for it inside most venues, and one shared check would cover every venue, the ten older ones included.

### 10. Triage of the blocked venues

- Four researchers each re-check seven of the 28 blocked venues from today's network: access, a public book, and an anchor.
- Each venue whose verdict changes gets its row in [`2026-09-22-venue-survey.md`](../research/2026-09-22-venue-survey.md) updated with the date, and each that now fits joins a tenth wave under this plan.
- Done on 2026-10-09: all 28 stayed blocked, so no tenth wave follows.
  The survey's answer section records the groups: seven refused by geography or an edge filter, nine relays of Binance or Bybit, and twelve missing a part the engine needs.

### 11. Reconcile

The content reconcile was done on 2026-10-09: the design describes what shipped, and its `file:line` citations were re-resolved against the merged tree.
The move to [`implemented/`](../implemented/) waits for BitMart, task 3.1, and the shared follow ups of task 0.7.

- Audit the design and this plan against the code, edit every claim that changed, and set every status.
- Re-resolve every `file:line` citation in both docs against the final code.
- Move both docs to [`implemented/`](../implemented/) and update [`README.md`](../README.md).
