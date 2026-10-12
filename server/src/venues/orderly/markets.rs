use super::{Profile, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

pub const INFO_PATH: &str = "/v1/public/info";

// The shared markets every builder trades, as opposed to a builder's own suffixed listing such as PERP_AAPL_USDC_mythos.
const PREFIX: &str = "PERP_";
const SUFFIX: &str = "_USDC";

pub async fn load(profile: &'static Profile, http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(profile, http, REST).await
}

async fn load_from(profile: &'static Profile, http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{INFO_PATH}")).await?;
    if !reply.success {
        anyhow::bail!("{INFO_PATH} answered success false");
    }
    let markets = parse(profile, &reply.data.rows);
    catalog::finish(profile.id, profile.name, reply.data.rows.len(), markets, &[])
}

// "PERP_BTC_USDC" gives BTC, or None for a builder market or anything else.
fn shared_base(symbol: &str) -> Option<&str> {
    let base = symbol.strip_prefix(PREFIX)?.strip_suffix(SUFFIX)?;
    let plain = !base.is_empty() && base.bytes().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit());
    plain.then_some(base)
}

// The one rule the loader and the anchor both apply, so a market the poller sends is always one the loader kept.
pub fn shared_and_active<'a>(symbol: &'a str, broker_id: Option<&str>, status: &str) -> Option<&'a str> {
    let base = shared_base(symbol)?;
    (broker_id.is_none() && status == "ACTIVE").then_some(base)
}

// CCXT has no class for either builder, and its woofipro class reads the same catalog, base from the second part of the id and no table of its own.
// That class keeps every row with active undefined, so only the shared markets that trade are kept here.
fn parse(profile: &Profile, rows: &[Row]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        let Some(base) = shared_and_active(&row.symbol, row.broker_id.as_deref(), &row.status) else {
            continue;
        };

        markets.push(Market {
            venue_id: profile.id.to_string(),
            raw_market_id: row.symbol.clone(),
            base: currency_code(base, &[]),
            quote: "USDC".to_string(),
            taker_ppm: profile.taker_ppm,
            linear: true,
            contract_size: 1.0, // book sizes are base coins, and 1000BONK is its own base
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
pub struct Reply {
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub data: Rows,
}

#[derive(Deserialize, Default)]
pub struct Rows {
    #[serde(default)]
    pub rows: Vec<Row>,
}

#[derive(Deserialize)]
pub struct Row {
    #[serde(default)]
    pub symbol: String, // "PERP_BTC_USDC", the socket's and the anchor call's id
    pub broker_id: Option<String>, // null on a shared market, "mythos" on a builder's own
    #[serde(default)]
    pub status: String, // "ACTIVE", "POST_ONLY" or "REDUCE_ONLY"
    pub funding_period: Option<f64>, // hours, 8 or 4
}

#[cfg(test)]
mod tests {
    use super::super::{NIZA, NONKYC};
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows captured live on 2026-10-09, cut down to a few of the fields the call returns.
    fn btc() -> Value {
        json!({
            "symbol": "PERP_BTC_USDC", "display_symbol_name": "BTC", "broker_id": null, "quote_tick": 0.1, "base_tick": 0.00001,
            "funding_period": 8, "mark_index_price_deviation_floor": 0.97, "mark_index_price_deviation_cap": 1.03,
            "status": "ACTIVE", "is_pretge": false,
        })
    }

    fn rows() -> Value {
        json!([
            btc(),
            { "symbol": "PERP_1000BONK_USDC", "display_symbol_name": "1000BONK", "broker_id": null, "funding_period": 4, "status": "ACTIVE" },
            { "symbol": "PERP_XAU_USDC", "display_symbol_name": "XAU (Gold)", "broker_id": null, "funding_period": 4, "status": "ACTIVE" },
            { "symbol": "PERP_AAPL_USDC_mythos", "display_symbol_name": "AAPL", "broker_id": "mythos", "funding_period": 8, "status": "ACTIVE" },
            { "symbol": "PERP_MET_USDC_mythos", "display_symbol_name": "MET", "broker_id": "mythos", "funding_period": 8, "status": "POST_ONLY" },
        ])
    }

    fn parsed(profile: &Profile, rows: Value) -> Vec<Market> {
        let rows: Vec<Row> = serde_json::from_value(rows).unwrap();
        parse(profile, &rows)
    }

    #[test]
    fn keeps_the_shared_markets_and_drops_every_builder_listing() {
        let markets = parsed(&NIZA, rows());

        assert_eq!(raw_ids(&markets), ["PERP_BTC_USDC", "PERP_1000BONK_USDC", "PERP_XAU_USDC"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[1].base, "1000BONK");
        assert_eq!(markets[2].base, "XAU");
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].price_scale, 1.0);
    }

    // Every shared market read ACTIVE on 2026-10-09, so this row is the BTC capture with the status a builder market carried.
    #[test]
    fn drops_a_shared_market_that_is_not_active() {
        let mut row = btc();
        row["status"] = json!("REDUCE_ONLY");

        assert!(parsed(&NIZA, json!([row])).is_empty());
    }

    #[test]
    fn drops_a_suffix_free_symbol_that_a_builder_owns() {
        let mut row = btc();
        row["broker_id"] = json!("mythos");

        assert!(parsed(&NIZA, json!([row])).is_empty());
    }

    #[test]
    fn reads_the_base_only_from_a_plain_shared_symbol() {
        assert_eq!(shared_base("PERP_BTC_USDC"), Some("BTC"));
        assert_eq!(shared_base("PERP_1000PEPE_USDC"), Some("1000PEPE"));
        assert_eq!(shared_base("PERP_AAPL_USDC_mythos"), None);
        assert_eq!(shared_base("PERP__USDC"), None);
        assert_eq!(shared_base("PERP_btc_USDC"), None);
        assert_eq!(shared_base("SPOT_BTC_USDC"), None);
    }

    #[test]
    fn gives_each_profile_its_own_id_and_taker() {
        let niza = parsed(&NIZA, json!([btc()]));
        let nonkyc = parsed(&NONKYC, json!([btc()]));

        assert_eq!((niza[0].venue_id.as_str(), niza[0].taker_ppm), ("niza", 500));
        assert_eq!((nonkyc[0].venue_id.as_str(), nonkyc[0].taker_ppm), ("nonkyc", 1_500));
    }

    #[tokio::test]
    async fn loads_the_shared_markets_under_the_profile_id_and_name() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, json!({ "success": true, "data": { "rows": rows() }, "timestamp": 1791573507000_i64 }));

        let venue = load_from(&NONKYC, &http(), &rest.url).await.unwrap();

        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("nonkyc", "Nonkyc.io"));
        assert_eq!(venue.markets.len(), 3);
    }

    #[tokio::test]
    async fn fails_a_reply_that_says_it_did_not_succeed() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, json!({ "success": false, "data": { "rows": [] } }));

        assert!(load_from(&NIZA, &http(), &rest.url).await.is_err());
    }
}
