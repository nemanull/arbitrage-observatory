use super::{ID, INFO_PATH, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::post_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;
use serde::de::DeserializeOwned;

const NAME: &str = "Hyperliquid";
const TAKER_PPM: u32 = 450; // the published tier 0 taker of the validator operated perpetuals, and userFees reads cross "0.00045"

// The first dex settles in collateral token 0, which spotMeta names USDC, and CCXT quotes every first dex perpetual in USDC.
const QUOTE: &str = "USDC";

// A k coin is priced and sized per 1,000 tokens: kPEPE read 0.003945 when PEPE spot was 0.000003945.
// So its base is the token, and its prices scale down to one token.
// The bare token is the ticker okx, gate and mexc list for PEPE, SHIB and FLOKI, and the only one anybody lists for NEIRO.
const THOUSANDS_SCALE: f64 = 0.001;

// PURR is the Purr token at 0.117 on 2026-10-08, while bybit, okx and gate list the Nasdaq stock of Hyperliquid Strategies as PURR at 11.5.
const DENIED: &[(&str, &str)] = &[("PURR", "the Purr token, while bybit, okx and gate list the Hyperliquid Strategies stock as PURR")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

pub(super) async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let meta: Meta = info(http, rest, "meta").await?;
    let markets = parse(&meta.universe);
    catalog::finish(ID, NAME, meta.universe.len(), markets, DENIED)
}

// One info call on the first dex, since the body names no `dex`, so the builder dexes stay out.
pub(super) async fn info<T: DeserializeOwned>(http: &reqwest::Client, rest: &str, kind: &str) -> anyhow::Result<T> {
    post_json(http, &format!("{rest}{INFO_PATH}"), &serde_json::json!({ "type": kind })).await
}

// CCXT's hyperliquid parseMarket for a first dex perpetual that is not delisted, with the base of a k coin moved to the token.
// The raw id is the name, which the socket and the contexts key by, where CCXT's id is the asset index.
fn parse(universe: &[Asset]) -> Vec<Market> {
    let mut markets = Vec::new();

    for asset in universe {
        // A builder dex name carries its dex, "xyz:TSLA", and its oracle is set by the deployer.
        if asset.is_delisted || asset.name.is_empty() || asset.name.contains(':') {
            continue;
        }

        let (base, price_scale) = match thousands_token(&asset.name) {
            Some(token) => (currency_code(token, &[]), THOUSANDS_SCALE),
            None => (currency_code(&asset.name, &[]), 1.0),
        };

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: asset.name.clone(),
            base,
            quote: QUOTE.to_string(),
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are coins of the named asset, and a k coin's are thousands, which price_scale carries
            price_scale,
        });
    }

    markets
}

// "kPEPE" names PEPE, while every other name is uppercase, as KAS and KAITO are.
fn thousands_token(name: &str) -> Option<&str> {
    let token = name.strip_prefix('k')?;
    let uppercase = !token.is_empty() && token.bytes().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit());
    uppercase.then_some(token)
}

#[derive(Deserialize)]
pub(super) struct Meta {
    #[serde(default)]
    pub universe: Vec<Asset>, // in asset index order, which the contexts follow
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Asset {
    #[serde(default)]
    pub name: String, // "BTC", "kPEPE"
    #[serde(default)]
    pub is_delisted: bool, // present only when true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Universe rows of POST /info {"type":"meta"} captured live on 2026-10-08, cut to eight of 234 and one margin table.
    fn meta() -> Value {
        json!({
            "universe": [
                { "szDecimals": 5, "name": "BTC", "maxLeverage": 40, "marginTableId": 56 },
                { "szDecimals": 0, "name": "kPEPE", "maxLeverage": 10, "marginTableId": 52 },
                { "szDecimals": 1, "name": "MATIC", "maxLeverage": 20, "marginTableId": 20, "isDelisted": true },
                { "szDecimals": 0, "name": "HPOS", "maxLeverage": 3, "marginTableId": 3, "onlyIsolated": true, "isDelisted": true, "marginMode": "strictIsolated" },
                { "szDecimals": 0, "name": "KAS", "maxLeverage": 3, "marginTableId": 3 },
                { "szDecimals": 0, "name": "kDOGS", "maxLeverage": 3, "marginTableId": 3, "isDelisted": true },
                { "szDecimals": 0, "name": "0G", "maxLeverage": 3, "marginTableId": 3 },
                { "szDecimals": 0, "name": "PURR", "maxLeverage": 3, "marginTableId": 3 },
            ],
            "marginTables": [[50, { "description": "", "marginTiers": [{ "lowerBound": "0.0", "maxLeverage": 50 }] }]],
            "collateralToken": 0,
        })
    }

    fn parsed(meta: Value) -> Vec<Market> {
        let meta: Meta = serde_json::from_value(meta).unwrap();
        parse(&meta.universe)
    }

    #[test]
    fn keeps_every_listed_first_dex_perpetual_by_its_name_as_a_linear_usdc_market() {
        let markets = parsed(meta());

        assert_eq!(raw_ids(&markets), ["BTC", "kPEPE", "KAS", "0G", "PURR"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDC"));
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 450 && m.contract_size == 1.0));
        assert_eq!(markets[2].base, "KAS");
        assert_eq!(markets[2].price_scale, 1.0);
        assert_eq!(markets[3].base, "0G");
    }

    #[test]
    fn a_k_coin_is_the_token_priced_per_thousand() {
        let markets = parsed(meta());

        assert_eq!(markets[1].raw_market_id, "kPEPE");
        assert_eq!(markets[1].base, "PEPE");
        assert_eq!(markets[1].price_scale, 0.001);
        assert_eq!(markets[1].contract_size, 1.0);
    }

    #[test]
    fn only_a_lowercase_k_before_an_uppercase_token_means_thousands() {
        assert_eq!(thousands_token("kPEPE"), Some("PEPE"));
        assert_eq!(thousands_token("kNEIRO"), Some("NEIRO"));
        assert_eq!(thousands_token("KAITO"), None);
        assert_eq!(thousands_token("k"), None);
        assert_eq!(thousands_token("kitty"), None);
        assert_eq!(thousands_token("BTC"), None);
    }

    #[test]
    fn leaves_out_a_builder_dex_name() {
        let markets = parsed(json!({ "universe": [{ "name": "xyz:TSLA" }, { "name": "ETH" }] }));

        assert_eq!(raw_ids(&markets), ["ETH"]);
    }

    #[tokio::test]
    async fn loads_the_first_dex_meta_through_a_post_to_info_and_denies_purr() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, meta());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [INFO_PATH]);
        assert_eq!(venue.id, "hyperliquid");
        assert_eq!(venue.name, "Hyperliquid");
        assert_eq!(raw_ids(&venue.markets), ["BTC", "kPEPE", "KAS", "0G"]);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 8.0);
        assert_eq!(read[0].number("perpetuals"), 5.0);
        assert_eq!(read[0].number("kept"), 4.0);
        assert_eq!(logs.events("market_denied")[0].text("market"), "PURR");
        assert_eq!(logs.events("market_price_scaled")[0].text("market"), "kPEPE");
    }

    #[tokio::test]
    async fn a_failed_meta_call_fails_the_load() {
        let rest = MockRest::start().await;
        rest.fail(INFO_PATH, 500);

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
