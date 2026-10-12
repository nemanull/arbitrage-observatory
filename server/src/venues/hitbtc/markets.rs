use super::Profile;
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;
use serde::de::IgnoredAny;
use std::collections::BTreeMap;

// Every market of the venue as one object keyed by symbol, spot rows included.
pub const SYMBOL_PATH: &str = "/public/symbol";

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

// CCXT 4.5.68's hitbtc commonCurrencies, which fmfwio inherits, without its GMT entry.
// CCXT renames GMT to "GMT Token", while every family venue lists GMT as STEPN, the token other venues list as GMT.
const CODES: &[(&str, &str)] = &[
    ("AUTO", "Cube"),
    ("BCC", "BCC"),
    ("BDP", "BidiPass"),
    ("BET", "DAO.Casino"),
    ("BIT", "BitRewards"),
    ("BOX", "BOX Token"),
    ("CPT", "Cryptaur"),
    ("GET", "Themis"),
    ("HSR", "HC"),
    ("IQ", "IQ.Cash"),
    ("LNC", "LinkerCoin"),
    ("PLA", "PlayChip"),
    ("PNT", "Penta"),
    ("SBTC", "Super Bitcoin"),
    ("STEPN", "GMT"),
    ("STX", "STOX"),
    ("TV", "Tokenville"),
    ("XMT", "MTL"),
    ("XPNT", "PNT"),
];

pub async fn load(profile: &'static Profile, http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(profile, http, profile.rest).await
}

async fn load_from(profile: &'static Profile, http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let rows: BTreeMap<String, Symbol> = get_json(http, &format!("{rest}{SYMBOL_PATH}")).await?;
    let markets = parse(profile, &rows);
    catalog::finish(profile.id, profile.name, rows.len(), markets, profile.denied)
}

// CCXT's hitbtc fetchMarkets for a linear swap, which is a futures row with no expiry.
// CCXT hard codes active to true, so it keeps suspended and expired contracts, and the venue's status decides here instead.
fn parse(profile: &Profile, rows: &BTreeMap<String, Symbol>) -> Vec<Market> {
    let mut markets = Vec::new();

    for (id, row) in rows {
        if id.ends_with("_BQX") || row.kind != "futures" || row.expiry.is_some() {
            continue;
        }
        if row.contract_type != "perpetual" || row.status != "working" {
            continue;
        }

        // A contract's base_currency is null, and its coin sits in underlying.
        let base_id = row.base_currency.as_deref().or(row.underlying.as_deref()).unwrap_or("");
        let base = currency_code(base_id, CODES);
        let quote = currency_code(&row.quote_currency, CODES);
        let settle = currency_code(&row.fee_currency, CODES);
        if base.is_empty() || quote != settle || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: profile.id.to_string(),
            raw_market_id: id.clone(),
            base,
            quote,
            taker_ppm: profile.taker_ppm,
            linear: true,
            contract_size: 1.0, // sizes are base coins on the book, as CCXT's constant 1 says
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Symbol {
    #[serde(rename = "type", default)]
    kind: String, // "spot" or "futures"
    #[serde(default)]
    contract_type: String, // "perpetual" on every futures row listed
    expiry: Option<IgnoredAny>, // null on a perpetual
    #[serde(default)]
    status: String, // "working", "suspended", "clearing" or "expired"
    base_currency: Option<String>,
    underlying: Option<String>,
    #[serde(default)]
    quote_currency: String,
    #[serde(default)]
    fee_currency: String, // the settlement coin
}

#[cfg(test)]
mod tests {
    use super::super::{FMFWIO, HITBTC, MANDALA};
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    fn parsed(profile: &Profile, rows: Value) -> Vec<Market> {
        let rows: BTreeMap<String, Symbol> = serde_json::from_value(rows).unwrap();
        parse(profile, &rows)
    }

    // Rows of GET /api/3/public/symbol on api.hitbtc.com, captured live on 2026-10-09.
    fn btc_perp() -> Value {
        json!({
            "type": "futures", "contract_type": "perpetual", "expiry": null, "underlying": "BTC", "base_currency": null,
            "quote_currency": "USDT", "status": "working", "quantity_increment": "0.0001", "tick_size": "0.01",
            "take_rate": "0.0007", "make_rate": "0.0002", "fee_currency": "USDT", "margin_trading": true,
            "max_initial_leverage": "100.00",
        })
    }

    fn with(row: Value, changes: Value) -> Value {
        let mut row = row;
        for (key, value) in changes.as_object().unwrap() {
            row[key] = value.clone();
        }
        row
    }

    fn btc_spot() -> Value {
        json!({
            "type": "spot", "base_currency": "BTC", "quote_currency": "USDT", "status": "working",
            "quantity_increment": "0.00001", "tick_size": "0.01", "take_rate": "0.0025", "make_rate": "0.0012",
            "fee_currency": "USDT", "margin_trading": true, "max_initial_leverage": "25.00",
        })
    }

    #[test]
    fn keeps_working_usdt_perpetuals_with_the_profile_taker_and_one_coin_per_contract() {
        let markets = parsed(
            &HITBTC,
            json!({
                "BTCUSDT_PERP": btc_perp(),
                "BTCUSDT": btc_spot(),
                "PEPEUSDT_PERP": with(btc_perp(), json!({ "underlying": "PEPE", "status": "suspended" })),
                "TONUSDT_PERP": with(btc_perp(), json!({ "underlying": "TON", "status": "expired" })),
            }),
        );

        assert_eq!(raw_ids(&markets), ["BTCUSDT_PERP"]);
        let btc = &markets[0];
        assert_eq!((btc.base.as_str(), btc.quote.as_str()), ("BTC", "USDT"));
        assert_eq!(btc.venue_id, "hitbtc");
        assert_eq!(btc.taker_ppm, 700);
        assert_eq!(btc.contract_size, 1.0);
        assert_eq!(btc.price_scale, 1.0);
        assert!(btc.linear);
    }

    // No family venue lists such rows today, so these are the BTC row with the documented fields changed.
    #[test]
    fn drops_dated_futures_inverse_and_coin_quoted_contracts() {
        let markets = parsed(
            &HITBTC,
            json!({
                "BTCUSDT_PERP": btc_perp(),
                "UFO-1217": with(btc_perp(), json!({ "contract_type": "cash_settled", "expiry": "2026-12-17T08:00:00.000Z" })),
                "BTCUSD_PERP": with(btc_perp(), json!({ "quote_currency": "USD", "fee_currency": "BTC" })),
                "ETHBTC_PERP": with(btc_perp(), json!({ "underlying": "ETH", "quote_currency": "BTC", "fee_currency": "BTC" })),
                "EOSUSD_BQX": with(btc_perp(), json!({ "underlying": "EOS" })),
            }),
        );

        assert_eq!(raw_ids(&markets), ["BTCUSDT_PERP"]);
    }

    // No family venue lists a USDC or USD contract today, so these are the BTC row with its quote and settlement changed.
    #[test]
    fn keeps_linear_usdc_and_usd_perpetuals_and_drops_a_contract_in_clearing() {
        let markets = parsed(
            &MANDALA,
            json!({
                "BTCUSDC_PERP": with(btc_perp(), json!({ "quote_currency": "USDC", "fee_currency": "USDC" })),
                "BTCUSD_PERP": with(btc_perp(), json!({ "quote_currency": "USD", "fee_currency": "USD" })),
                "BTCUSDT_PERP": with(btc_perp(), json!({ "status": "clearing" })),
            }),
        );

        assert_eq!(raw_ids(&markets), ["BTCUSDC_PERP", "BTCUSD_PERP"]);
        assert_eq!(markets[0].quote, "USDC");
        assert_eq!(markets[1].quote, "USD");
        assert_eq!(markets[0].taker_ppm, 600);
    }

    #[test]
    fn keeps_gmt_as_stepn_and_applies_the_rest_of_the_ccxt_table() {
        let markets = parsed(
            &FMFWIO,
            json!({
                "GMTUSDT_PERP": with(btc_perp(), json!({ "underlying": "GMT", "take_rate": "0.0008" })),
                "STXUSDT_PERP": with(btc_perp(), json!({ "underlying": "STX" })),
            }),
        );

        assert_eq!(markets[0].base, "GMT");
        assert_eq!(markets[0].taker_ppm, 800);
        assert_eq!(markets[1].base, "STOX");
    }

    #[tokio::test]
    async fn loads_the_symbol_call_and_denies_the_profile_list() {
        let rest = MockRest::start().await;
        rest.reply(
            SYMBOL_PATH,
            json!({
                "BTCUSDT_PERP": btc_perp(),
                "CELUSDT_PERP": with(btc_perp(), json!({ "underlying": "CEL" })),
                "BTCUSDT": btc_spot(),
            }),
        );

        let venue = load_from(&HITBTC, &http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [SYMBOL_PATH]);
        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("hitbtc", "HitBTC"));
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT_PERP"]);
    }
}
