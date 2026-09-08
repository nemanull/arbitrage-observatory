# Roadmap for this project

# Version 0.1

# Phase 1

- [x] Create this repo. Set up the server, docs, agents, and raw frontend.
- [x] Do research on major exchanges.
- [x] Add Prisma, BullMQ, and Redis. Set up all of the infrastructure.

# Phase 2 

- [x] Create core project types
- [x] Create cluster builder
- [x] Set up a simple engine and an opportunity manager

# Phase 3

- [X] Define and implement opportunity monitoring and saving
- [x] Implement ws and it's integration for Binance
- [x] Implement ws and it's integration for Bybit and Okx
- [x] Add signoz
- [x] Add orchestration

# Phase 3
- [x] Add Coinbase and Kraken
- [x] Record why an episode closed, and stop closing on silence

# Phase 4

- [ ] Make the minimum episode age a config value, not a constant.
- [x] Record both sides and the touch sizes of both legs at open, peak and close in the engine.
- [x] Stream a twenty level book for every market from each venue's WebSocket into the engine.
- [ ] Classify long lived spreads such as ANTHROPIC and OPENAI by index, mark and funding, and use the index check at cluster build instead of the hand kept lists.

# Phase 5

The legitimacy ruleset: prove a row was an opportunity and not dust, a stale quote, a thin book or a standing basis.

- [ ] Carry touch sizes and far sides at open, peak and close to the row.
- [ ] Count ticks per leg and record whether both legs moved, excluding the closing tick.
- [ ] Walk the depth block at open into an edge at 1k, 5k and 20k dollars and a crossed flag on the row.
- [ ] Write the ruleset design: hard gates, tags, and the threshold each takes from the audits.
- [ ] Rank in SQL from the tags and re-audit one run before any tag becomes an engine gate.

# Phase 6

- [ ] Fill binance's illiquid markets at subscribe time from a REST snapshot.
- [ ] Measure the resync rate through a busy hour before considering per market resubscription.
- [ ] Decide on the secondary top of book detector, GitHub issue #2, once a gap or a mismatch is seen.
- [ ] Fix the venue profiles: coinbase sequence per connection, okx checksum retired and VIP5, binance chains only pu.
- [ ] Shard by pair when one event loop is not enough, about 20k messages a second.
