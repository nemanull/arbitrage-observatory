# Foxbit Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:23 to 04:38 UTC, and the second pass 04:41 to 04:51 UTC, from the development host near Seattle through its Surfshark WireGuard exit, which Cloudflare places in Canada.

This profile covers spot trading on Foxbit (CCXT id `foxbit`), because Foxbit lists no perpetual, see section 3.
Deposit, withdrawal, card and earn schedules are named once at the end of the coverage matrix.
Every number carries a source ledger row, a probe reference, or a CCXT file and line.
Probe numbers come from [`rest-probe.mjs`](../../../scripts/probes/venues/foxbit/rest-probe.mjs) and [`ws-probe.mjs`](../../../scripts/probes/venues/foxbit/ws-probe.mjs).

## 1. Scope and freshness

| item | value | label | evidence |
|---|---|---|---|
| retrieval date | 2026-09-22 for every source row | | source ledger |
| legal entity | FOXBIT SERVIÇOS DIGITAIS LTDA., CNPJ 21.246.584/0002-30, Osasco, São Paulo, Brazil, "e demais empresas do Grupo" | Published | S3 |
| entity in the site footer | FOXBIT SOCIEDADE PRESTADORA DE SERVICOS DE ATIVOS VIRTUAIS LTDA, CNPJ 21.246.584/0001-50, same address | Published | S3 |
| terms version | "Última atualização: Abril 2026", page modified 2026-06-11 | Published | S3 |
| who may register | individuals of 18 or more, with a CPF, a full Brazilian address with CEP and state, a phone with DDD, a liveness check and a bank or payment account in their own name, or companies with a CNPJ | Published | S3 section 3 |
| excluded regions | none named in the terms of use | Not publicly specified | S3 |
| US persons | not excluded by name, and the terms say FATCA-reportable users' data may go to foreign authorities, which implies US persons with a CPF can hold an account | Inferred | S3 section 3 |
| practical reach | the registration fields are Brazilian documents, so an account needs a Brazilian CPF and bank account, whatever the country | Inferred | S3, S5 |
| API access from this host | public REST and WebSocket both answered 200 and 101 with no refusal, through a Canadian VPN exit (Cloudflare `loc=CA`, colo `YVR` or `SEA`) | Probed | [`rest.md`](./rest.md) section 1 |

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | markets | evidence |
|---|---|---|---|---|
| spot, crypto against BRL | 0.25 %, 2,500 ppm | 0.50 %, 5,000 ppm | 103 of 128 BRL markets carry exactly these `default_fees` | S1, S2, P1 |
| spot, crypto against crypto | 0.02 %, 200 ppm | 0.15 %, 1,500 ppm | the 5 USDT markets carry these `default_fees` | S1, P1 |
| perpetuals | absent | absent | none | section 3 |

The published page calls the taker "Execução de Ordem Ativa (Mercado)" and the maker "Execução de Ordem Passiva (Limite)", and a Stop Market order is charged as a taker, S1.
The 5 USDT markets are `btcusdt`, `ethusdt`, `usdcusdt`, `xrpusdt` and `solusdt`, P1.
They are the only markets in the USD, USDC and USDT settlement family the engine clusters on.

The public `markets` reply carries a `default_fees` pair per market, and 25 BRL markets differ from the published 0.25 % and 0.50 %, P1.

| `default_fees` maker / taker | markets on 2026-09-23 |
|---|---|
| 0.0025 / 0.005 | 103 BRL markets |
| 0.0002 / 0.0015 | the 5 USDT markets |
| 0.0 / 0.0 | 18 BRL markets: 17 Foxbit Crypto Assets tokens (`ft…` and `fxmusics01brl`) and `brl1brl` |
| 0.0025 / 0.0025 | `nearbrl`, `hbarbrl`, `jupbrl`, `xdcbrl` |
| 0.005 / 0.005 | `algobrl`, `ldobrl` |
| 0.0 / 0.005 | `fttec01brl` |

No page read explains the per market exceptions, and whether they are promotions with an end date is Not publicly specified.

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M perpetuals | absent | no futures, funding, margin or leverage path or word in the REST v3 OpenAPI file, S6, and CoinGecko's derivatives exchange list of 214 ids has no Foxbit entry, S8 |
| USDC-M perpetuals | absent | same |
| coin-margined perpetuals | absent | same |
| dated futures | absent | same |
| options | absent | same |
| spot | present, 133 markets: 128 against BRL and 5 against USDT | P1 |
| prediction markets | present, 82 more markets under `GET /rest/v3/markets?category=PREDICTION`, all `pred…brl` at 0 / 0 fees, left out of the default catalog and out of CCXT | P1 |
| margin | absent | CCXT declares `'margin': undefined` and maps every market with `'margin': false`, `server/node_modules/ccxt/js/src/foxbit.js` lines 34 and 1644 |
| RFQ | Prime Desk quotes, authenticated only | S6 |
| deposit, withdrawal, card and earn | out of scope, the lookup is the "Taxas e limites" page S1 and the public `GET /rest/v3/currencies` `withdraw_info.fee` field | S1, S6 |

## 4. Spot tiers

### Crypto against BRL, volume in BRL over 30 days

| tier | 30 day volume, BRL | maker | taker | taker ppm |
|---|---|---:|---:|---:|
| Iniciante | 0 to 25,000 | 0.25 % | 0.50 % | 5,000 |
| VIP 1 | 25,000 to 100,000 | 0.22 % | 0.50 % | 5,000 |
| VIP 2 | 100,000 to 500,000 | 0.20 % | 0.50 % | 5,000 |
| VIP 3 | 500,000 to 1,000,000 | 0.18 % | 0.40 % | 4,000 |
| VIP 4 | 1,000,000 to 2,500,000 | 0.10 % | 0.20 % | 2,000 |
| VIP 5 | 2,500,000 to 5,000,000 | 0.07 % | 0.10 % | 1,000 |
| VIP 6 | 5,000,000 to 10,000,000 | 0.06 % | 0.09 % | 900 |
| VIP 7 | 10,000,000 to 25,000,000 | 0.05 % | 0.07 % | 700 |
| VIP 8 | 25,000,000 to 75,000,000 | 0.04 % | 0.06 % | 600 |
| VIP 9 | 75,000,000 to 150,000,000 | 0.02 % | 0.05 % | 500 |
| VIP 10 | 150,000,000 to 500,000,000 | 0.00 % | 0.05 % | 500 |
| VIP 11 | 500,000,000 to 1,000,000,000 | -0.015 % | 0.05 % | 500 |
| VIP 12 | more than 1,000,000,000 | -0.030 % | 0.05 % | 500 |

The table is from S2, a page last modified 2024-10-14.
The first row equals the S1 rates and the `default_fees` of 103 BRL markets on 2026-09-23, so the base row is current.
The page does not say whether the VIP table also lowers the crypto against crypto rates, and that is Not publicly specified.

### Crypto against crypto

Only the base rate is published: maker 0.02 % and taker 0.15 %, S1.
No tier table for these pairs was found.

### Qualification

Volume traded over the last 30 days is measured every day at 00:00, and the account moves up or down to the matching tier automatically, S2 and S4.
The first discount starts above R$ 25,000 in 30 days, S2.
A member's own rates are behind the authenticated `GET /rest/v3/me/fees/trading`, S6, which this survey did not call.

## 5. Discounts that change the spot taker

| discount | effect | evidence |
|---|---|---|
| exchange token | none, Foxbit has no fee token in any page read | S1, S2 |
| VIP volume tiers | taker 0.50 % down to 0.05 % | section 4 |
| per market `default_fees` exceptions | taker 0 on 18 markets, 0.25 % on 4 | section 2 |
| referral | "Indique amigos" is linked from the fee page, and no fee effect is stated | S1 |
| market maker program | Not publicly specified in the pages read | |
| zero fee promotions | Not publicly specified, apart from the per market exceptions whose end dates are not published | |

## 6. Funding as a cost

Not applicable.
Foxbit lists no perpetual, so there is no funding rate, interval, cap or settlement, see section 3.

## 7. Liquidation, settlement and delisting

Spot only, so there is no liquidation or settlement charge.
Foxbit Crypto Assets tokens carry their own purchase and early redemption fees, for example 0.5 % on purchase and 5 % on early redemption for FTPC-35782, S1, which is out of scope.
No delisting charge is named in the pages read.

## 8. CCXT

| item | value | evidence |
|---|---|---|
| class | `foxbit`, REST only, CCXT Pro has no `foxbit` class | `server/node_modules/ccxt/js/src/foxbit.js` line 70 declares `'ws': false`, and `server/node_modules/ccxt/js/src/pro/` has no `foxbit.js` |
| exchange constant | `fees.trading.taker` 0.005 and `maker` 0.0025, `tierBased: false` | `server/node_modules/ccxt/js/src/foxbit.js` lines 186 to 190 |
| per market fee | `parseMarket` reads `default_fees.taker` and `default_fees.maker` from the markets reply | same file, lines 1633, 1658 and 1659 |
| `market.taker` without credentials | 0.005 on `BTC/BRL` and every other 0.0025 / 0.005 BRL market, 0.0015 on `BTC/USDT` and the other USDT markets, 0 on the 18 zero fee markets | P1, `ccxt_loadMarkets` |
| swap markets | 0 of 133, every market is `type: 'spot'`, `swap: false` | same file, lines 1642 and 1646, and P1 |

The engine keeps only active swaps, at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 79 and 196 to 202, and skips a venue with none, at lines 50 to 53.
So `loadMarkets` on Foxbit gives the engine nothing to track.

## 9. Recommended registry values

None, because Foxbit cannot join the engine as a perpetual leg.

If a spot leg is ever designed, the only markets in the engine's settlement family are the 5 USDT pairs.
For those, `takerPpm` would be 1,500 and `ccxtTakerPpm` 1,500, because CCXT reads the same 0.0015 from `default_fees` at `server/node_modules/ccxt/js/src/foxbit.js` line 1658.
For a BRL pair both would be 5,000, which is also CCXT's exchange constant at line 189.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Taxas e limites, page modified 2025-07-01 | https://foxbit.com.br/taxas/ | 2026-09-22 | Foxbit, Brazil | spot maker and taker per pair group, order type names, token fees, sections 2, 4, 5, 7 |
| S2 | Foxbit VIP, page modified 2024-10-14 | https://foxbit.com.br/vip/ | 2026-09-22 | Foxbit, Brazil | the 13 row tier table and its rules, section 4 |
| S3 | Termos e Condições de Uso, "Última atualização: Abril 2026" | https://foxbit.com.br/termos-de-uso/ | 2026-09-22 | Foxbit, Brazil | entities, CNPJ, registration fields, age, FATCA, section 1 |
| S4 | Como funcionam as taxas regressivas?, updated 2025-07-24 | https://faq.foxbit.com.br/hc/pt-br/articles/29544558959629-Como-funcionam-as-taxas-regressivas | 2026-09-22 | Foxbit, Brazil | 30 day volume, daily re-tiering, section 4 |
| S5 | Como verificar minha conta PF?, updated 2026-09-11 | https://faq.foxbit.com.br/hc/pt-br/articles/35382704204301-Como-verificar-minha-conta-PF | 2026-09-22 | Foxbit, Brazil | CPF and identity document in verification, section 1 |
| S6 | Foxbit REST API v3, and its OpenAPI file | https://docs.foxbit.com.br/rest/v3/ and https://docs.foxbit.com.br/rest/v3/public-docs-openapi.json | 2026-09-22 | Foxbit | 36 paths, none for derivatives, `me/fees/trading`, Prime Desk, `currencies`, section 3 |
| S7 | CoinGecko exchange API, `foxbit` | https://api.coingecko.com/api/v3/exchanges/foxbit | 2026-09-22 | CoinGecko | Brazil, established 2014, trust score 4, `trust_score_rank` 124 in this reply where the survey list had 120, 746 BTC 24 h volume, USDT/BRL the largest pair at about 40.2 M USD, context only |
| S8 | CoinGecko derivatives exchanges list | https://api.coingecko.com/api/v3/derivatives/exchanges/list | 2026-09-22 | CoinGecko | 214 ids, none Foxbit, section 3 |
| S9 | CCXT 4.5.68 `foxbit.js` | `server/node_modules/ccxt/js/src/foxbit.js` | 2026-09-22 | CCXT | fee constants, `parseMarket`, `'ws': false`, section 8 |
| P1 | `rest-probe.mjs catalog`, 04:29 UTC and the second pass | [`rest-probe.mjs`](../../../scripts/probes/venues/foxbit/rest-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | catalog counts, `default_fees` groups, CCXT `market.taker`, sections 2, 3, 8 |
