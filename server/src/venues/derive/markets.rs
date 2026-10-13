use super::{ID, REST, RpcError};
use crate::clock::now_ms;
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::post_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashSet;

const NAME: &str = "Derive";

// The base perpetual taker, 0.03 %.
// The flat 0.01 USDC per taker order is left out, since it adds 10 ppm or less on a fill of 1,000 USDC or more.
const TAKER_PPM: u32 = 300;

pub const INSTRUMENTS_PATH: &str = "/public/get_all_instruments";

// A page holds 100 rows unless asked for more, and 1,000 is the most it holds.
const PAGE_SIZE: u32 = 1_000;

const PERP: &str = "perp";
const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST, (now_ms() / 1000) as f64).await
}

async fn load_from(http: &reqwest::Client, rest: &str, now_s: f64) -> anyhow::Result<Venue> {
    let body = serde_json::json!({ "instrument_type": PERP, "expired": false, "page_size": PAGE_SIZE });
    let reply: Reply = post_json(http, &format!("{rest}{INSTRUMENTS_PATH}"), &body).await?;

    // An application error comes back as HTTP 200 with an error object.
    if let Some(error) = reply.error {
        anyhow::bail!(
            "{INSTRUMENTS_PATH} answered error {}: {} {}",
            error.code,
            error.message.unwrap_or_default(),
            error.data.unwrap_or_default()
        );
    }
    let Some(result) = reply.result else {
        anyhow::bail!("{INSTRUMENTS_PATH} answered with neither a result nor an error");
    };

    if result.pagination.num_pages > 1 {
        tracing::warn!(
            event = "catalog_truncated",
            venue = ID,
            pages = result.pagination.num_pages,
            rows = result.instruments.len(),
        );
    }

    let markets = parse(&result.instruments, now_s);
    catalog::finish(ID, NAME, result.instruments.len(), markets, &[])
}

// CCXT's derive parseMarket for a perpetual, which keeps a row by is_active, with no commonCurrencies.
// CCXT reads the frozen v2 host, whose rows quote USD, while v3 quotes USDC, so the quote follows v3.
// A row must also sit inside its listing window, as get_all_live_instruments requires.
fn parse(rows: &[Instrument], now_s: f64) -> Vec<Market> {
    let mut listed = Vec::with_capacity(rows.len());
    for row in rows {
        let quote = currency_code(&row.quote_currency, &[]);
        if row.instrument_type != PERP
            || row.instrument_name.is_empty()
            || row.base_currency.is_empty()
            || !row.is_active
            || !row.is_live(now_s)
            || !QUOTES.contains(&quote.as_str())
        {
            continue;
        }
        listed.push((row, quote));
    }

    // A second listing of a currency in another risk universe is named with a suffix, BTC-PERP-5, and the first keeps the plain name.
    // The engine takes one market per pair, and the plain listing is the one to keep.
    let names: HashSet<&str> = listed.iter().map(|(row, _)| row.instrument_name.as_str()).collect();
    let mut markets = Vec::with_capacity(listed.len());
    for (row, quote) in listed {
        let plain = format!("{}-PERP", row.base_currency);
        if row.instrument_name != plain && names.contains(plain.as_str()) {
            tracing::info!(event = "market_twin_skipped", venue = ID, market = %row.instrument_name, kept = %plain);
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.instrument_name.clone(),
            base: currency_code(&row.base_currency, &[]),
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book amounts are coins of the base currency, as CCXT's contractSize 1 says
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Reply {
    result: Option<Listing>,
    error: Option<RpcError>,
}

#[derive(Deserialize)]
struct Listing {
    #[serde(default)]
    instruments: Vec<Instrument>,
    #[serde(default)]
    pagination: Pagination,
}

#[derive(Deserialize, Default)]
struct Pagination {
    #[serde(default)]
    num_pages: u32,
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    instrument_type: String, // "perp", "erc20" or "option"
    #[serde(default)]
    instrument_name: String, // "BTC-PERP", the name the socket channels and their data use
    #[serde(default)]
    is_active: bool,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    scheduled_activation: f64, // Unix seconds
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    scheduled_deactivation: f64, // Unix seconds, 9223372036854775807 when no end is set
    #[serde(default)]
    base_currency: String,
    #[serde(default)]
    quote_currency: String, // "USDC"
}

impl Instrument {
    // A bound the row leaves out does not close the window.
    fn is_live(&self, now_s: f64) -> bool {
        let opened = self.scheduled_activation.is_nan() || self.scheduled_activation <= now_s;
        let ended = self.scheduled_deactivation <= now_s; // false for a NaN
        opened && !ended
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    const NOW_S: f64 = 1_791_845_363.0; // 2026-10-12 22:49:23 UTC, when the rows below were captured

    // Rows of POST /v3/public/get_all_instruments {"instrument_type":"perp","expired":false} captured live on 2026-10-12, three of 15.
    // BTC is whole, and DOGE and PUMP are cut to the fields the loader reads and a few more.
    fn btc() -> Value {
        json!({"instrument_type":"perp","instrument_name":"BTC-PERP","scheduled_activation":1701840228,"scheduled_deactivation":9223372036854775807_u64,
            "is_active":true,"tick_size":"0.1","minimum_amount":"0.01","maximum_amount":"10000","amount_step":"0.0001","mark_price_fee_rate_cap":"0",
            "maker_fee_rate":"0.0001","taker_fee_rate":"0.0003","base_fee":"0.01","base_currency":"BTC","quote_currency":"USDC","option_details":null,
            "perp_details":{"index":"BTC-USD","max_rate_per_hour":"0.000171232876","min_rate_per_hour":"-0.000171232876","aggregate_funding":"26763.573646178742",
                "funding_rate":"0","srm_perp_margin_requirements":{"im_perp_req":"0.066","mm_perp_req":"0.05","max_leverage":"15.15"}},
            "erc20_details":null,"base_asset_address":"0xDBa83C0C654DB1cd914FA2710bA743e925B53086","base_asset_sub_id":"0","pro_rata_fraction":"0",
            "fifo_min_allocation":"0","pro_rata_amount_step":"0.01"})
    }

    fn doge() -> Value {
        json!({"instrument_type":"perp","instrument_name":"DOGE-PERP","scheduled_activation":1714347085,"scheduled_deactivation":4870198916_i64,
            "is_active":true,"tick_size":"0.00001","minimum_amount":"1000","maximum_amount":"100000000","amount_step":"1","taker_fee_rate":"0.0003",
            "base_currency":"DOGE","quote_currency":"USDC","perp_details":{"index":"DOGE-USD","funding_rate":"0"}})
    }

    fn pump() -> Value {
        json!({"instrument_type":"perp","instrument_name":"PUMP-PERP","scheduled_activation":1789426643,"scheduled_deactivation":9223372036854775807_u64,
            "is_active":true,"tick_size":"0.000001","minimum_amount":"1000","maximum_amount":"10000000","amount_step":"10","taker_fee_rate":"0.0003",
            "base_currency":"PUMP","quote_currency":"USDC","perp_details":{"index":"PUMP-USD","funding_rate":"0"}})
    }

    // A spot row of the erc20 listing, captured at 22:56 UTC the same day and cut, as another family a reply could carry.
    fn eth_spot() -> Value {
        json!({"instrument_type":"erc20","instrument_name":"ETH-USDC","scheduled_activation":1728508925,"scheduled_deactivation":9223372036854775807_u64,
            "is_active":true,"tick_size":"0.01","taker_fee_rate":"0.0015","base_currency":"ETH","quote_currency":"USDC","perp_details":null,
            "erc20_details":{"decimals":18,"underlying_erc20_address":"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2","borrow_index":"1","supply_index":"1"}})
    }

    fn reply(instruments: Value, pages: u32) -> Value {
        json!({"id":"49728d03-6c85-484b-bd8e-2483d4fbd373","result":{"instruments":instruments,"pagination":{"num_pages":pages,"count":15}}})
    }

    fn parsed(rows: Value, now_s: f64) -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(rows).unwrap();
        parse(&rows, now_s)
    }

    #[test]
    fn keeps_every_active_perpetual_by_its_name_as_a_linear_usdc_market_at_300_ppm() {
        let markets = parsed(json!([btc(), doge(), pump()]), NOW_S);

        assert_eq!(raw_ids(&markets), ["BTC-PERP", "DOGE-PERP", "PUMP-PERP"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[2].base, "PUMP");
        assert!(markets.iter().all(|m| m.venue_id == "derive" && m.linear && m.taker_ppm == 300));
        assert!(markets.iter().all(|m| m.contract_size == 1.0 && m.price_scale == 1.0));
    }

    #[test]
    fn drops_an_inactive_row_and_a_row_of_another_family() {
        let mut halted = btc();
        halted["is_active"] = json!(false);

        let markets = parsed(json!([halted, eth_spot(), doge()]), NOW_S);

        assert_eq!(raw_ids(&markets), ["DOGE-PERP"]);
    }

    #[test]
    fn keeps_a_row_only_inside_its_listing_window() {
        let rows = json!([btc(), doge(), pump()]);

        assert_eq!(raw_ids(&parsed(rows.clone(), 1_789_426_642.0)), ["BTC-PERP", "DOGE-PERP"]);
        assert_eq!(raw_ids(&parsed(rows.clone(), 1_789_426_643.0)), ["BTC-PERP", "DOGE-PERP", "PUMP-PERP"]);
        assert_eq!(raw_ids(&parsed(rows, 4_870_198_916.0)), ["BTC-PERP", "PUMP-PERP"]);
    }

    #[test]
    fn a_row_that_leaves_out_its_window_is_kept() {
        let mut open = btc();
        open.as_object_mut().unwrap().remove("scheduled_activation");
        open.as_object_mut().unwrap().remove("scheduled_deactivation");

        assert_eq!(raw_ids(&parsed(json!([open]), NOW_S)), ["BTC-PERP"]);
    }

    // No suffixed listing existed on 2026-10-12, so the twin is the BTC row renamed as the instrument names page spells one.
    #[test]
    fn keeps_the_plain_listing_beside_a_suffixed_twin_and_a_suffixed_listing_alone() {
        let (logs, _capture) = capture();
        let mut twin = btc();
        twin["instrument_name"] = json!("BTC-PERP-5");
        let mut alone = doge();
        alone["instrument_name"] = json!("DOGE-PERP-3");

        let markets = parsed(json!([twin, btc(), alone]), NOW_S);

        assert_eq!(raw_ids(&markets), ["BTC-PERP", "DOGE-PERP-3"]);
        assert_eq!(markets[1].base, "DOGE");
        let skipped = logs.events("market_twin_skipped");
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].text("market"), "BTC-PERP-5");
        assert_eq!(skipped[0].text("kept"), "BTC-PERP");
    }

    #[tokio::test]
    async fn loads_the_perpetuals_through_a_post_and_counts_every_row() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, reply(json!([btc(), eth_spot(), doge(), pump()]), 1));

        let venue = load_from(&http(), &rest.url, NOW_S).await.unwrap();

        assert_eq!(rest.calls(), [INSTRUMENTS_PATH]);
        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("derive", "Derive"));
        assert_eq!(raw_ids(&venue.markets), ["BTC-PERP", "DOGE-PERP", "PUMP-PERP"]);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 4.0);
        assert_eq!(read[0].number("kept"), 3.0);
        assert!(logs.events("catalog_truncated").is_empty());
    }

    #[tokio::test]
    async fn warns_when_the_listing_spans_more_than_one_page() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, reply(json!([btc()]), 2));

        load_from(&http(), &rest.url, NOW_S).await.unwrap();

        let truncated = logs.events("catalog_truncated");
        assert_eq!(truncated.len(), 1);
        assert_eq!(truncated[0].number("pages"), 2.0);
    }

    // The error a wrong instrument_type got on 2026-10-12, which came with HTTP 200.
    #[tokio::test]
    async fn an_error_object_in_a_200_reply_fails_the_load() {
        let rest = MockRest::start().await;
        rest.reply(
            INSTRUMENTS_PATH,
            json!({"error":{"code":-32602,"message":"Invalid params","data":"Invalid params: unknown variant `swap`, expected one of `option`, `perp`, `erc20`"}}),
        );

        let error = load_from(&http(), &rest.url, NOW_S).await.unwrap_err();

        assert!(error.to_string().contains("error -32602: Invalid params"), "{error:#}");
    }

    #[tokio::test]
    async fn a_failed_call_fails_the_load() {
        let rest = MockRest::start().await;
        rest.fail(INSTRUMENTS_PATH, 404);

        assert!(load_from(&http(), &rest.url, NOW_S).await.is_err());
    }
}
