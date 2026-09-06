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

- [ ] Write only episodes that live at least one second, so sub-second flickers never reach the table.
- [ ] Record both sides of both legs and the size at the touch at open, peak and close, so a row carries each leg's width and the size behind the reading.
- [ ] Fetch a book snapshot a few levels deep for both legs once per episode at the one second mark, and store the edge at fixed notionals and a stale flag when the cross is gone.
- [ ] Classify long lived spreads such as ANTHROPIC and OPENAI by each leg's index, mark and funding, and use the same index check at cluster build to replace the hand kept denial and scale lists.
