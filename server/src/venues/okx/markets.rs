use super::anchor::{INSTRUMENTS_PATH, Reply};
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "OKX";
const TAKER_PPM: u32 = 500;

const CODES: &[(&str, &str)] = &[("AE", "AET")];

const DENIED: &[(&str, &str)] = &[
    ("BB-USDT-SWAP", "a different token from the BB that binance, bybit and kraken list"),
    ("QNT-USDT-SWAP", "a different token from the QNT that binance, bybit and kraken list"),
];

// okx quotes these at a tenth of every other venue's price: 209 against binance's 2,025 for ANTHROPIC on 2026-10-01.
const PRICE_SCALES: &[(&str, f64)] = &[("ANTHROPIC-USDT-SWAP", 10.0), ("OPENAI-USDT-SWAP", 10.0)];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply<Instrument> = get_json(http, &format!("{rest}{INSTRUMENTS_PATH}")).await?;
    if reply.code != "0" {
        anyhow::bail!("instruments code {}: {}", reply.code, reply.msg);
    }

    let markets = parse(&reply.data);
    catalog::finish(ID, NAME, reply.data.len(), markets, DENIED)
}

// CCXT's okx parseMarket for a live swap, which takes base and quote from the index id rather than the instrument id.
fn parse(instruments: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in instruments {
        if row.state != "live" || row.inst_id.is_empty() {
            continue;
        }

        let (base_id, quote_id) = match row.uly.split_once('-') {
            Some((base, quote)) => (base, quote),
            None => (row.base_ccy.as_str(), row.quote_ccy.as_str()),
        };
        let base = currency_code(base_id, CODES);
        let quote = currency_code(quote_id, CODES);
        if base.is_empty() || quote.is_empty() {
            continue;
        }

        let price_scale = PRICE_SCALES
            .iter()
            .find(|(id, _)| *id == row.inst_id)
            .map_or(1.0, |&(_, scale)| scale);

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.inst_id.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: quote_id == row.settle_ccy,
            contract_size: contract_size(row.ct_val),
            price_scale,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instrument {
    #[serde(default)]
    inst_id: String,
    #[serde(default)]
    uly: String,
    #[serde(default)]
    base_ccy: String, // "" on a swap
    #[serde(default)]
    quote_ccy: String,
    #[serde(default)]
    settle_ccy: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    ct_val: f64,
    #[serde(default)]
    state: String, // "live", "suspend", "preopen"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    fn instrument(inst_id: &str, uly: &str, settle: &str, ct_val: &str, state: &str) -> Value {
        json!({
            "instId": inst_id, "instType": "SWAP", "uly": uly, "instFamily": uly, "baseCcy": "", "quoteCcy": "",
            "settleCcy": settle, "ctVal": ct_val, "ctValCcy": "", "state": state,
        })
    }

    // Trimmed from the reply of 2026-10-01.
    fn instruments() -> Value {
        json!({ "code": "0", "msg": "", "data": [
            instrument("BTC-USD-SWAP", "BTC-USD", "BTC", "100", "live"),
            instrument("BTC-USDT-SWAP", "BTC-USDT", "USDT", "0.01", "live"),
            instrument("ONE-USDT-SWAP", "ONE-USDT", "USDT", "100", "live"),
            instrument("NEW-USDT-SWAP", "NEW-USDT", "USDT", "1", "preopen"),
            instrument("AE-USDT-SWAP", "AE-USDT", "USDT", "1", "live"),
            instrument("ANTHROPIC-USDT-SWAP", "ANTHROPIC-USDT", "USDT", "1", "live"),
            instrument("BB-USDT-SWAP", "BB-USDT", "USDT", "10", "live"),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let reply: Reply<Instrument> = serde_json::from_value(instruments()).unwrap();
        parse(&reply.data)
    }

    #[test]
    fn keeps_live_swaps_with_base_and_quote_from_the_index_id() {
        let markets = parsed();

        assert_eq!(
            raw_ids(&markets),
            ["BTC-USD-SWAP", "BTC-USDT-SWAP", "ONE-USDT-SWAP", "AE-USDT-SWAP", "ANTHROPIC-USDT-SWAP", "BB-USDT-SWAP"]
        );
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[1].contract_size, 0.01);
        assert_eq!(markets[1].taker_ppm, 500);
    }

    #[test]
    fn reads_a_swap_that_settles_in_its_base_as_inverse() {
        let markets = parsed();

        assert!(!markets[0].linear);
        assert_eq!(markets[0].quote, "USD");
        assert_eq!(markets[0].contract_size, 100.0);
        assert!(markets[1].linear);
    }

    #[test]
    fn maps_codes_through_the_okx_table_and_scales_the_markets_quoted_in_tenths() {
        let markets = parsed();

        assert_eq!(markets[3].base, "AET");
        assert_eq!(markets[4].price_scale, 10.0);
        assert_eq!(markets[1].price_scale, 1.0);
    }

    #[tokio::test]
    async fn drops_the_denied_markets_and_logs_the_scaled_ones() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, instruments());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert!(!raw_ids(&venue.markets).contains(&"BB-USDT-SWAP"));
        assert_eq!(logs.events("market_denied")[0].text("market"), "BB-USDT-SWAP");
        assert_eq!(logs.events("market_price_scaled")[0].text("market"), "ANTHROPIC-USDT-SWAP");
    }

    #[tokio::test]
    async fn fails_on_a_venue_error_code() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "code": "50011", "msg": "Too Many Requests", "data": [] }));

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("instruments code 50011"), "{error:#}");
    }
}
