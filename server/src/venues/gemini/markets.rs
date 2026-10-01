use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};

const NAME: &str = "Gemini";

// CCXT reads no fee and falls back to a constant, and 0.004 matches no Gemini perpetual rate, see docs/profiles/gemini/fees.md section 9.
const TAKER_PPM: u32 = 700;

const SYMBOLS_PATH: &str = "/v1/symbols";

// CCXT's gemini rules for a symbol id: the quotes it splits on in order, the ids it skips, and the one id it spells by hand.
const QUOTES: &[&str] = &["USDT", "GUSD", "USD", "DAI", "EUR", "GBP", "SGD", "BTC", "ETH", "LTC", "BCH", "SOL", "USDC"];
const BROKEN: &[&str] = &["efilusd", "maticrlusd", "maticusdc", "eurusdc", "maticgusd", "maticusd", "efilfil", "eurusd"];
const CONFLICTING: &[(&str, &str, &str)] = &[("paxgusd", "PAXG", "USD")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let symbols: Vec<String> = get_json(http, &format!("{rest}{SYMBOLS_PATH}")).await?;
    let markets = parse(&symbols);
    catalog::finish(ID, NAME, symbols.len(), markets, &[])
}

// CCXT's gemini parseMarket on a bare id: a perpetual names PERP, and base and quote come from splitting the rest at a known quote.
// The registry pinned every contract size to 1, because the books are in base units and CCXT's catalog scrape copies the price tick into it.
fn parse(symbols: &[String]) -> Vec<Market> {
    let mut markets = Vec::new();

    for id in symbols {
        let upper = id.to_uppercase();
        if !upper.contains("PERP") || BROKEN.contains(&id.as_str()) {
            continue;
        }

        let without_perp = upper.replacen("PERP", "", 1);
        let Some((base_id, quote_id)) = split(&without_perp) else {
            continue;
        };
        let base = currency_code(&base_id, &[]);
        let quote = currency_code(&quote_id, &[]);
        if base.is_empty() || quote.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: id.to_lowercase(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0,
            price_scale: 1.0,
        });
    }

    markets
}

fn split(pair: &str) -> Option<(String, String)> {
    let lower = pair.to_lowercase();
    if let Some(&(_, base, quote)) = CONFLICTING.iter().find(|(id, _, _)| *id == lower) {
        return Some((base.to_string(), quote.to_string()));
    }

    let quote = QUOTES.iter().find(|quote| pair.ends_with(*quote))?;
    Some((pair[..pair.len() - quote.len()].to_string(), quote.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::json;

    fn symbols() -> Vec<String> {
        ["btcusd", "btcgusdperp", "btcusdcperp", "ethusdcperp", "maticusdc", "trumpgusdperp", "paxgusd"]
            .iter()
            .map(|id| id.to_string())
            .collect()
    }

    #[test]
    fn keeps_perpetual_ids_and_splits_them_at_the_first_quote_that_ends_them() {
        let markets = parse(&symbols());

        assert_eq!(raw_ids(&markets), ["btcgusdperp", "btcusdcperp", "ethusdcperp", "trumpgusdperp"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "GUSD"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[3].base, "TRUMP");
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 700);
    }

    #[test]
    fn splits_an_id_ccxt_spells_by_hand() {
        assert_eq!(split("PAXGUSD"), Some(("PAXG".to_string(), "USD".to_string())));
        assert_eq!(split("NOQUOTE"), None);
    }

    #[tokio::test]
    async fn loads_the_catalog() {
        let rest = MockRest::start().await;
        rest.reply(SYMBOLS_PATH, json!(symbols()));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "gemini");
        assert_eq!(venue.markets.len(), 4);
    }
}
