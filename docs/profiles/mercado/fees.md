# Mercado Bitcoin Fee Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 04:30 and 04:50 UTC on 2026-09-23 by the UTC clock, through the laptop's Surfshark WireGuard exit that geolocates to Canada.

This profile covers Mercado Bitcoin (CCXT id `mercado`) on its spot market, because the venue lists no perpetual, see section 3.
Every number carries a source from the ledger in section 10, a probe reference, or a CCXT file and line.

## 1. Scope and freshness

The official fee page, `https://www.mercadobitcoin.com.br/taxas-contas-limites`, refused this host with HTTP 403 and a Cloudflare page reading "Sorry, you have been blocked", and it refused a WebFetch with 403 as well on 2026-09-22.
Every page under `www.mercadobitcoin.com.br` tried, the home page, `sitemap.xml`, `api-doc` and `trade-api` included, answered the same 403 to this host.
So the fee schedule below is read from the Internet Archive capture of that page dated 2026-07-27 07:16 UTC (S1), and it is 57 days old on the retrieval date.
The API hosts `api.mercadobitcoin.net`, `www.mercadobitcoin.net` and `ws.mercadobitcoin.net` all answered this host normally, see [`rest.md`](./rest.md) section 1.

| item | value | source |
|---|---|---|
| legal entities | Mercado Bitcoin CTVM S.A., CNPJ 16.683.062/0001-85, and Mercado Bitcoin Instituição de Pagamento Ltda., CNPJ 11.351.086/0001-13, both at Avenida Brigadeiro Faria Lima 2.113, São Paulo | S1 footer |
| regulator | "sujeitas à regulamentação do Banco Central do Brasil aplicável aos prestadores de serviços de ativos virtuais, incluindo as Resoluções BCB nº 520 e nº 521" | S1 footer |
| who may open an individual account | aged 12 or over, with a CPF (Brazilian taxpayer number) or CNPJ in good standing at the Receita Federal, one account per e-mail, CPF or CNPJ | S1 FAQ "Quem pode abrir uma conta no MB?" |
| foreigners | "Estrangeiros podem ter uma conta no MB desde que seu CPF exista e não tenha nenhuma pendência na Receita Federal", and an address inside Brazil is mandatory | S1 FAQ "Como funciona a conta para estrangeiros?" |
| companies | LTDA, S.A., MEI, EIRELI and EI with a CNPJ, and not associations, cooperatives, clubs or religious bodies | S1 FAQ |
| US persons | not named anywhere on the page read, but every account needs a CPF and a Brazilian address, so a US resident without both cannot open one | S1, inference |
| excluded regions | no list published on the pages readable from here | S1 |
| trading products | spot only, see section 3 | S1, S2, P1 |

CoinGecko's exchange API on 2026-09-23 UTC reported Mercado Bitcoin in Brazil, established 2013, trust score 5, trust rank 115 (the survey list gave 112), and 143.39 BTC of 24 h volume, led by USDC/BRL and USDT/BRL (S5).

## 2. Quick answer

| product | VIP 0 maker | VIP 0 taker | source |
|---|---|---|---|
| spot, Clássica and Pro experiences, 30 day volume from 0 to R$ 10.000 | 0.30 %, 3,000 ppm | 0.70 %, 7,000 ppm | S1 |
| spot, crypto to crypto pairs such as `BTC-USDT` | 0 | 0 | S1: "Os ativos cripto-cripto têm taxa zero de negociação (compra e venda). Exemplo: BTC-USDT." |
| perpetuals | absent | absent | section 3 |

The page labels the maker column "Executada (Taxa Maker)" and the taker column "Executora (Taxa Taker)" (S1).
The API documentation's example for the private trading fee call shows the same pair of numbers, `"maker_fee": "0.00300000"` and `"taker_fee": "0.00700000"` (S2).

## 3. Coverage matrix

| product | present | evidence |
|---|---|---|
| USDT-M, USDC-M or coin-M perpetuals | absent | the v4 catalog has four instrument types, `CRYPTO`, `DIGITAL_ASSET`, `DIGITAL_VARIABLE_INCOME` and `UTILITY_TOKEN`, and no contract field (P1). CCXT declares `'swap': false` at `server/node_modules/ccxt/js/src/mercado.js` line 30. The fee page names no derivative (S1) |
| dated futures | absent | CCXT `'future': false` at line 31, and none in the v4 catalog (P1) |
| options | absent | CCXT `'option': false` at line 32, and none in the v4 catalog (P1) |
| margin | absent | CCXT `'margin': false` at line 29 |
| spot | present | 1,360 v4 symbols on 2026-09-23 UTC: 409 `CRYPTO`, 878 `DIGITAL_ASSET` (tokenised fixed income, receivables and consortium quotas), 72 `DIGITAL_VARIABLE_INCOME` and 1 `UTILITY_TOKEN`. By quote, 1,352 in BRL, 3 in USDT, 3 in USDC and 2 in BTC (P1) |

The Internet Archive's URL index for `mercadobitcoin.com.br/*` holds no product page whose address contains `futur`, `perpet`, `alavanc` or `derivat` other than blog articles and a DeFi explainer page, `defi/perpetual-protocol` (S4).
CoinGecko's derivatives list of 2026-09-22 does not show the venue either.

## 4. Spot tiers

### Clássica and Pro experiences, volume in BRL over the last 30 days

| tier | 30 day volume | maker | taker |
|---|---|---|---|
| 1 | 0 a R$ 10.000 | 0.30 % | 0.70 % |
| 2 | R$ 10.000 a R$ 50.000 | 0.27 % | 0.70 % |
| 3 | R$ 50.000 a R$ 100.000 | 0.24 % | 0.70 % |
| 4 | R$ 100.000 a R$ 200.000 | 0.21 % | 0.70 % |
| 5 | R$ 200.000 a R$ 500.000 | 0.18 % | 0.70 % |
| 6 | R$ 500.000 a R$ 1.000.000 | 0.15 % | 0.60 % |
| 7 | R$ 1.000.000 a R$ 5.000.000 | 0.12 % | 0.60 % |
| 8 | R$ 5.000.000 a R$ 10.000.000 | 0.09 % | 0.60 % |
| 9 | R$ 10.000.000 a R$ 20.000.000 | 0.07 % | 0.50 % |
| 10 | R$ 20.000.000 a R$ 50.000.000 | 0.05 % | 0.45 % |
| 11 | R$ 50.000.000 a R$ 100.000.000 | 0.03 % | 0.40 % |
| 12 | R$ 100.000.000 a R$ 200.000.000 | 0.02 % | 0.30 % |
| 13 | Acima de R$ 200.000.000 | 0.015 % | 0.25 % |

The table and its labels are from S1, section "Tabela completa das negociações Clássica e Pro".
The tier numbers are this profile's, and the private `GET /accounts/{accountId}/tier` call returns a tier as a string, with `"13"` as its example (S2).
The taker stays at 0.70 % until R$ 500.000 of monthly volume.

### Negociação Rápida

The three click "quick trade" is priced separately, from "Até 3%" for trades up to R$ 100 to 0.7 % above R$ 10.000, and its quote "pode incluir um valor adicional" of spread "até 2%" (S1).
It is an app flow and not an API order book, so it does not apply to the engine.

### Qualification

"O volume total de trading acumulado em 30 dias, o nível de usuário e as taxas são atualizados diariamente às 02:00 (BRT)" (S1).
The volume of the current order does not count, and trades made at zero fee do not count toward the 30 day volume (S1).
No distinction between web, app and API orders is published (S1, S2).

## 5. Discounts that change the spot taker

| discount | effect | end date | source |
|---|---|---|---|
| new account | "48 horas de negociações ilimitadas com taxa zero" after the account is created | 48 h after opening | S1 |
| crypto to crypto pairs | zero fee in the Pro experience, example `BTC-ETH` on one line and `BTC-USDT` on another | none stated | S1 |
| Renda Fixa Digital | zero fee on the primary market | none stated | S1 |
| token holding, referral, market maker | none published on the pages readable from this host | | S1 |

## 6. Funding as a cost

None.
Mercado Bitcoin lists no perpetual, so there is no funding rate, interval, cap or settlement, see [`rest.md`](./rest.md) section 3.

## 7. Liquidation, settlement and delisting

There is no margin or derivative product, so no liquidation or settlement charge exists.
BRL deposits and withdrawals are free, with limits by account level, and crypto withdrawal fees are returned per asset and network by the public `GET /api/v4/{asset}/fees` call (S1, S2).
No delisting procedure or charge was found on a page readable from this host.

## 8. CCXT

| item | value | source |
|---|---|---|
| class | `mercado`, REST only, no CCXT Pro class exists in 4.5.68 | `server/node_modules/ccxt/js/src/mercado.js`, and no `pro/mercado.js` |
| `market.taker` without credentials | `0.007` on all 1,451 markets | the constant at `mercado.js` line 187, and P1 |
| `market.maker` | `0.003` on all 1,451 markets | line 186, and P1 |
| swap markets | 0 of 1,451 | P1 |
| fee calls | `fetchTradingFee` and `fetchTradingFees` false | lines 110 and 111 |

The CCXT constants equal the tier 1 row of S1, so CCXT is right for a retail account.

## 9. Recommended registry values

No registry entry is recommended.
The connector keeps only markets whose `type` is `swap`, whose `swap` is true and whose `active` is not false, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 196 to 202, and all 1,451 CCXT markets of this venue are spot.
If a spot leg is ever modelled, `takerPpm` 7,000 and `ccxtTakerPpm` 7,000 would be the values, both from the tier 1 taker of S1 and the CCXT constant at line 187.
The markets are also quoted in BRL, which the quote family does not join to USDT, at [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6, so a BRL book would never share a cluster with a USDT perpetual.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | "Conta, taxas e limites", Internet Archive capture of 2026-07-27 07:16 UTC | https://web.archive.org/web/20260727071636/https://www.mercadobitcoin.com.br/taxas-contas-limites | 2026-09-22 | Mercado Bitcoin, Brazil | fee tiers, qualification, zero fee rules, eligibility, entities, sections 1 to 7 |
| S2 | Mercado Bitcoin API v4 reference, `swagger.yaml` version v5.36.1 | https://api.mercadobitcoin.net/api/v4/docs/swagger.yaml | 2026-09-22 | Mercado Bitcoin, Brazil | fee and tier call examples, withdrawal fee call, sections 2, 4 and 7 |
| S3 | CCXT 4.5.68 `mercado.js` | `server/node_modules/ccxt/js/src/mercado.js` | 2026-09-22 | CCXT | constants and flags, sections 3 and 8 |
| S4 | Internet Archive URL index for `mercadobitcoin.com.br/*`, filtered on `futur`, `perpet`, `alavanc` and `derivat` | https://web.archive.org/cdx/search/cdx | 2026-09-22 | Mercado Bitcoin | no derivative product page, section 3 |
| S5 | CoinGecko exchange API, `mercado_bitcoin` | https://api.coingecko.com/api/v3/exchanges/mercado_bitcoin | 2026-09-22 | CoinGecko | country, trust rank, volume, section 1 |
| P1 | `rest-probe.mjs catalog`, runs at 04:30 and 04:41 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/mercado/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | catalog counts, CCXT market fields, sections 3 and 8 |
