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

- [ ] Make the minimum episode age a configuration value rather than a constant, so flickers can be kept out of the table without building the engine around one number.
- [x] Record both sides of both legs and the size at the touch at open, peak and close in the engine, so a row can carry each leg's width and the size behind the reading. The row itself is the next line's work.
- [ ] Fetch a book snapshot a few levels deep for both legs at open and at close, off the tick path, and store the edge at fixed notionals and a stale flag when the snapshot shows no cross. The in-memory depth block and its write path shipped on 2026-09-06, the fetch, the walk and the guard remain.
- [ ] Classify long lived spreads such as ANTHROPIC and OPENAI by each leg's index, mark and funding, and use the same index check at cluster build to replace the hand kept denial and scale lists.
