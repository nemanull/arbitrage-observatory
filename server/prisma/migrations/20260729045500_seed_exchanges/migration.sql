-- Reference data for the five spot venues the observatory watches.
-- Every value comes from the profiles under docs/profiles, which record the official source and the retrieval date.
-- Rows are inserted by slug lookup rather than by literal id, because autoincrement ids are only predictable on a database that has never seen a failed insert.

INSERT INTO "Exchange" ("slug", "name") VALUES
  ('binance', 'Binance'),
  ('bybit', 'Bybit'),
  ('okx', 'OKX'),
  ('coinbase', 'Coinbase'),
  ('kraken', 'Kraken');

-- Connection settings for the public spot feed of each venue.
-- Most values are published constants copied from the profile.
-- Two are engineering choices derived from a documented rate limit with headroom left over, and each derivation is noted above its row.

-- Binance uses the combined stream path because the stream envelope names the source stream, which matters once one socket carries hundreds of book ticker streams.
-- The venue pings us every 20 seconds, so we never ping first and keepaliveIntervalMs stays null.
-- subscribeIntervalMs of 500 is two inbound frames per second against a documented budget of five, which also has to cover our pong replies.
-- reconnectMinDelayMs of 2000 is half the documented 300 connection attempts per five minutes per IP.
INSERT INTO "ExchangeConfig" (
  "exchangeId", "wsUrl", "maxStreamsPerConnection", "maxArgsPerSubscribe",
  "subscribeIntervalMs", "keepaliveIntervalMs", "idleTimeoutMs", "maxConnectionAgeMs", "reconnectMinDelayMs"
) VALUES (
  (SELECT "id" FROM "Exchange" WHERE "slug" = 'binance'),
  'wss://stream.binance.com:9443/stream',
  1024, 1024, 500, NULL, 60000, 86400000, 2000
);

-- Bybit publishes no topic count for spot, so maxStreamsPerConnection is derived from the 21,000 character argument budget per connection.
-- The ten arguments per subscribe request is published, and it makes Bybit the most message-hungry venue of the five.
-- No inbound message rate is published for the public feed, so subscribeIntervalMs of 200 is a plain default rather than a derived one.
-- reconnectMinDelayMs of 1500 is 40 percent of the documented 500 connections per five minutes per IP per domain.
INSERT INTO "ExchangeConfig" (
  "exchangeId", "wsUrl", "maxStreamsPerConnection", "maxArgsPerSubscribe",
  "subscribeIntervalMs", "keepaliveIntervalMs", "idleTimeoutMs", "maxConnectionAgeMs", "reconnectMinDelayMs"
) VALUES (
  (SELECT "id" FROM "Exchange" WHERE "slug" = 'bybit'),
  'wss://stream.bybit.com/v5/public/spot',
  900, 10, 200, 20000, 600000, NULL, 1500
);

-- OKX caps the subscription payload at 64 KB rather than by argument count, so 500 arguments of about 43 bytes each uses a third of that ceiling.
-- subscribeIntervalMs of 10000 respects the documented 480 subscribe operations per connection per hour, which is the real constraint here.
-- The long gap costs nothing at startup because one message already carries a full connection of arguments.
-- reconnectMinDelayMs of 1000 is a third of the documented three handshakes per second per IP.
INSERT INTO "ExchangeConfig" (
  "exchangeId", "wsUrl", "maxStreamsPerConnection", "maxArgsPerSubscribe",
  "subscribeIntervalMs", "keepaliveIntervalMs", "idleTimeoutMs", "maxConnectionAgeMs", "reconnectMinDelayMs"
) VALUES (
  (SELECT "id" FROM "Exchange" WHERE "slug" = 'okx'),
  'wss://ws.okx.com:8443/ws/v5/public',
  500, 500, 10000, 25000, 30000, NULL, 1000
);

-- Coinbase Advanced Trade is used rather than Coinbase Exchange, because its level two feed is the only public unauthenticated book among the Coinbase spot platforms.
-- Advanced Trade publishes no subscription count, so 100 products per connection is an engineering cap that follows the official advice to spread verbose channels across connections.
-- Liveness comes from the server-pushed heartbeats channel, so we never ping first.
-- subscribeIntervalMs and reconnectMinDelayMs both take a quarter of the documented eight per second per IP, which is shared by every connection this process opens.
INSERT INTO "ExchangeConfig" (
  "exchangeId", "wsUrl", "maxStreamsPerConnection", "maxArgsPerSubscribe",
  "subscribeIntervalMs", "keepaliveIntervalMs", "idleTimeoutMs", "maxConnectionAgeMs", "reconnectMinDelayMs"
) VALUES (
  (SELECT "id" FROM "Exchange" WHERE "slug" = 'coinbase'),
  'wss://advanced-trade-ws.coinbase.com',
  100, 100, 500, NULL, 60000, NULL, 500
);

-- Kraken publishes no symbol cap for the public v2 channels, so maxStreamsPerConnection borrows the 200 symbols per connection limit documented for its level three endpoint.
-- maxArgsPerSubscribe of 40 comes from the same place, where the 200 unit per second counter costs 5 units for a depth ten symbol.
-- Kraken closes an idle connection after about a minute and accepts any request as activity, so we ping at half that window.
-- reconnectMinDelayMs of 5000 follows Kraken's own recommendation, which is stricter than the 150 attempts per rolling ten minutes the edge network allows.
INSERT INTO "ExchangeConfig" (
  "exchangeId", "wsUrl", "maxStreamsPerConnection", "maxArgsPerSubscribe",
  "subscribeIntervalMs", "keepaliveIntervalMs", "idleTimeoutMs", "maxConnectionAgeMs", "reconnectMinDelayMs"
) VALUES (
  (SELECT "id" FROM "Exchange" WHERE "slug" = 'kraken'),
  'wss://ws.kraken.com/v2',
  200, 40, 1000, 30000, 60000, NULL, 5000
);

-- Published spot rates in parts per million of trade value, so 0.1 percent is 1000 and a maker rebate is negative.
-- These are the entry tier rates a new account pays, with no volume tier, no token discount, and no promotional programme.
-- The entry tier is the most expensive one, so the detector understates the edge rather than overstating it.
-- effectiveFrom is the retrieval date of the profile that supplied the rate, because the column answers when the rate was true and the migration timestamp already answers when the row was written.
-- A fee class exists here only when the venue publishes a different spot rate for a group of markets.
-- Market.feeClass points at these keys, so a class that is missing here cannot be assigned there.
-- Several venues publish a class without publishing which pairs belong to it, and those memberships have to come from live venue data before any market is moved off the default class.

-- Binance charges one rate for ordinary spot pairs and a reduced taker rate on the pairs it treats as USDC pairs.
-- The USDC maker column prints the word Standard, which the profile defines as the standard maker value for that row.
INSERT INTO "ExchangeFee" ("exchangeId", "feeClass", "makerPpm", "takerPpm", "effectiveFrom", "sourceUrl") VALUES
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'binance'), 'default',    1000, 1000, TIMESTAMP '2026-07-26 00:00:00', 'https://www.binance.com/en/fee/trading'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'binance'), 'usdc_pairs', 1000,  950, TIMESTAMP '2026-07-26 00:00:00', 'https://www.binance.com/en/fee/trading');

-- Bybit charges more on fiat-quoted pairs and more again on its Adventure Zone and tokenized equity listings.
-- The fiat row is the lowest fiat volume band inside VIP 0, which is where a new account starts.
INSERT INTO "ExchangeFee" ("exchangeId", "feeClass", "makerPpm", "takerPpm", "effectiveFrom", "sourceUrl") VALUES
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'bybit'), 'default',                    1000, 1000, TIMESTAMP '2026-07-26 00:00:00', 'https://www.bybit.com/en/help-center/article/Trading-Fee-Structure'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'bybit'), 'fiat_pairs',                 1500, 2000, TIMESTAMP '2026-07-26 00:00:00', 'https://www.bybit.com/en/help-center/article/Trading-Fee-Structure'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'bybit'), 'adventure_zone_and_xstocks', 2000, 2000, TIMESTAMP '2026-07-26 00:00:00', 'https://www.bybit.com/en/help-center/article/Trading-Fee-Structure');

-- OKX pair groups one, two, and three all print the same rate at the Regular tier, so they collapse into the default class.
-- The special and zero-fee columns are real classes whose pair membership OKX does not publish in the fee framework.
-- The stablecoin class comes from a later notice that overrides whatever group rate the pair would otherwise take.
INSERT INTO "ExchangeFee" ("exchangeId", "feeClass", "makerPpm", "takerPpm", "effectiveFrom", "sourceUrl") VALUES
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'okx'), 'default',          800, 1000, TIMESTAMP '2026-07-26 00:00:00', 'https://www.okx.com/en-gb/help/updates-to-global-fee-framework'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'okx'), 'special_pairs',   1000, 1500, TIMESTAMP '2026-07-26 00:00:00', 'https://www.okx.com/en-gb/help/updates-to-global-fee-framework'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'okx'), 'stablecoin_pairs',   0,  500, TIMESTAMP '2026-07-26 00:00:00', 'https://www.okx.com/en-gb/help/fee-group-update-for-fee-tokens-update-july'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'okx'), 'zero_fee_pairs',     0,    0, TIMESTAMP '2026-07-26 00:00:00', 'https://www.okx.com/en-gb/help/updates-to-global-fee-framework');

-- Coinbase Advanced Trade does not publish a per-account rate, only a maximum that its help material states Advanced rates do not exceed.
-- That maximum is seeded, which matches the entry tier of the separate Coinbase Exchange schedule.
-- No stable-pair class is seeded, because the reduced stable-pair rate belongs to Coinbase Exchange and Advanced Trade publishes no equivalent.
INSERT INTO "ExchangeFee" ("exchangeId", "feeClass", "makerPpm", "takerPpm", "effectiveFrom", "sourceUrl") VALUES
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'coinbase'), 'default', 4000, 6000, TIMESTAMP '2026-07-26 00:00:00', 'https://help.coinbase.com/en-gb/coinbase/trading-and-funding/advanced-trade/what-is-advanced-trade');

-- Kraken runs the most classes of the five, and the xStocks maker value is a genuine rebate rather than a charge.
-- The maker rebate, stablecoin, and foreign exchange classes are named-pair groups whose membership the fee schedule does not enumerate.
INSERT INTO "ExchangeFee" ("exchangeId", "feeClass", "makerPpm", "takerPpm", "effectiveFrom", "sourceUrl") VALUES
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'kraken'), 'default',             4000, 8000, TIMESTAMP '2026-07-26 00:00:00', 'https://www.kraken.com/gb/features/fee-schedule'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'kraken'), 'maker_rebate_pairs',  3800, 8000, TIMESTAMP '2026-07-26 00:00:00', 'https://www.kraken.com/gb/features/fee-schedule'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'kraken'), 'stablecoin_fx_pairs', 2000, 2000, TIMESTAMP '2026-07-26 00:00:00', 'https://www.kraken.com/gb/features/fee-schedule'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'kraken'), 'usdg_base_pairs',        0,  100, TIMESTAMP '2026-07-26 00:00:00', 'https://www.kraken.com/gb/features/fee-schedule'),
  ((SELECT "id" FROM "Exchange" WHERE "slug" = 'kraken'), 'xstocks',             -200, 1000, TIMESTAMP '2026-07-26 00:00:00', 'https://www.kraken.com/gb/features/fee-schedule');
