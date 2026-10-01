// What every loader shares: CCXT's currency codes, the contract size rule, and the venue facts applied at boot.

use crate::engine::cluster::{Market, Venue};

// CCXT 4.5.68's base commonCurrencies, which every venue table sits over.
const BASE_CODES: &[(&str, &str)] = &[("XBT", "BTC"), ("BCHSV", "BSV")];

// CCXT's safeCurrencyCode when the venue has no currency list loaded: uppercase, then the venue's table, then the base table.
pub fn currency_code(id: &str, venue_codes: &[(&str, &str)]) -> String {
    let upper = id.to_uppercase();

    for &(from, to) in venue_codes.iter().chain(BASE_CODES) {
        if from == upper {
            return to.to_string();
        }
    }

    upper
}

// A size the venue does not state as a positive number counts one coin per contract, as the Nest connector read it.
pub fn contract_size(size: f64) -> f64 {
    if size.is_finite() && size > 0.0 { size } else { 1.0 }
}

// Drops the markets whose ticker names another token than the other venues list under it, and logs every market left out or rescaled.
// `rows` is what the instruments call returned before any rule, for the boot log.
pub fn finish(
    venue_id: &str,
    name: &str,
    rows: usize,
    mut markets: Vec<Market>,
    denied: &[(&str, &str)], // (raw market id, reason)
) -> anyhow::Result<Venue> {
    let perpetuals = markets.len();

    markets.retain(|market| {
        let Some(&(_, reason)) = denied.iter().find(|(id, _)| *id == market.raw_market_id) else {
            return true;
        };
        tracing::info!(event = "market_denied", venue = venue_id, market = %market.raw_market_id, reason);
        false
    });

    for market in &markets {
        if market.price_scale != 1.0 {
            tracing::info!(
                event = "market_price_scaled",
                venue = venue_id,
                market = %market.raw_market_id,
                price_scale = market.price_scale,
            );
        }
    }

    tracing::info!(
        event = "catalog_read",
        venue = venue_id,
        rows,
        perpetuals,
        kept = markets.len(),
    );

    if markets.is_empty() {
        anyhow::bail!("{venue_id} lists no usable perpetual market in {rows} row(s)");
    }

    Ok(Venue {
        id: venue_id.to_string(),
        name: name.to_string(),
        markets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;

    fn market(raw_market_id: &str) -> Market {
        Market {
            venue_id: "alpha".to_string(),
            raw_market_id: raw_market_id.to_string(),
            base: raw_market_id.to_string(),
            quote: "USDT".to_string(),
            taker_ppm: 500,
            linear: true,
            contract_size: 1.0,
            price_scale: 1.0,
        }
    }

    #[test]
    fn currency_code_uppercases_then_applies_the_venue_table_over_the_base_table() {
        assert_eq!(currency_code("btc", &[]), "BTC");
        assert_eq!(currency_code("XBT", &[]), "BTC");
        assert_eq!(currency_code("bchsv", &[]), "BSV");
        assert_eq!(currency_code("GTC", &[("GTC", "GAMECOM")]), "GAMECOM");
        // mexc restores XBT over the base table, and bitget maps to a code that is not uppercase.
        assert_eq!(currency_code("XBT", &[("XBT", "XBT")]), "XBT");
        assert_eq!(currency_code("omni", &[("OMNI", "omni")]), "omni");
    }

    #[test]
    fn contract_size_keeps_a_positive_size_and_reads_anything_else_as_one() {
        assert_eq!(contract_size(0.01), 0.01);
        assert_eq!(contract_size(100.0), 100.0);
        assert_eq!(contract_size(0.0), 1.0);
        assert_eq!(contract_size(-1.0), 1.0);
        assert_eq!(contract_size(f64::NAN), 1.0);
    }

    #[test]
    fn finish_drops_each_denied_market_with_its_reason_and_keeps_the_rest() {
        let (logs, _capture) = capture();
        let markets = vec![market("ONUSDT"), market("BTCUSDT"), market("ONEUSDT")];

        let venue = finish("alpha", "Alpha", 3, markets, &[("ONUSDT", "another token"), ("NOPE", "unlisted")]).unwrap();

        let ids: Vec<&str> = venue.markets.iter().map(|m| m.raw_market_id.as_str()).collect();
        assert_eq!(ids, ["BTCUSDT", "ONEUSDT"]);
        let denied = logs.events("market_denied");
        assert_eq!(denied.len(), 1);
        assert_eq!(denied[0].text("market"), "ONUSDT");
        assert_eq!(denied[0].text("reason"), "another token");
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 3.0);
        assert_eq!(read[0].number("perpetuals"), 3.0);
        assert_eq!(read[0].number("kept"), 2.0);
    }

    #[test]
    fn finish_logs_every_scaled_market() {
        let (logs, _capture) = capture();
        let scaled = Market {
            price_scale: 10.0,
            ..market("ANTHROPIC-USDT-SWAP")
        };

        finish("alpha", "Alpha", 2, vec![scaled, market("BTC-USDT-SWAP")], &[]).unwrap();

        let lines = logs.events("market_price_scaled");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text("market"), "ANTHROPIC-USDT-SWAP");
        assert_eq!(lines[0].number("price_scale"), 10.0);
    }

    #[test]
    fn finish_fails_a_venue_left_with_no_market() {
        let (_logs, _capture) = capture();

        assert!(finish("alpha", "Alpha", 1, vec![market("ONUSDT")], &[("ONUSDT", "another token")]).is_err());
        assert!(finish("alpha", "Alpha", 0, Vec::new(), &[]).is_err());
    }
}

