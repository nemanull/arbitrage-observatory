use super::anchor::get_data;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "DigiFinex";

// The flat perpetual taker of docs/profiles/digifinex/fees.md section 2, where CCXT's constant 0.002 is the spot rate.
const TAKER_PPM: u32 = 500;

// Every perpetual in one reply, both families, weight 5 of the 6,000 a minute.
pub const INSTRUMENTS_PATH: &str = "/swap/v2/public/instruments";

// CCXT 4.5.68's digifinex commonCurrencies.
const CODES: &[(&str, &str)] = &[
    ("BHT", "Black House Test"),
    ("EPS", "Epanus"),
    ("FREE", "FreeRossDAO"),
    ("MBN", "Mobilian Coin"),
    ("TEL", "TEL666"),
];

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

// Three contracts carry base ETH, and the venue does not say what tells BETH and OETH apart from ETH.
// Their index and mark sat within 0.1 of each other, so the engine would cluster all three as ETH.
const DENIED: &[(&str, &str)] = &[
    ("BETHUSDTPERP", "a second ETH contract beside ETHUSDTPERP, unexplained by the venue"),
    ("OETHUSDTPERP", "a third ETH contract beside ETHUSDTPERP, unexplained by the venue"),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let rows: Vec<Instrument> = get_data(http, &format!("{rest}{INSTRUMENTS_PATH}")).await?;
    let markets = parse(&rows);
    catalog::finish(ID, NAME, rows.len(), markets, DENIED)
}

// CCXT's fetchMarketsV2 swap branch, which reads every swap as active because it looks for isTrading where the venue sends is_trading.
// So the venue's own status and is_trading decide here, and a book size counts contracts of contract_value base coins.
fn parse(rows: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        let live = row.kind == "REAL" && row.status == "ONLINE" && row.is_trading;
        let linear = !row.is_inverse && row.clear_currency == row.quote_currency;
        if !live || row.contract_type != "PERPETUAL" || !linear {
            continue;
        }

        // A size counted in another currency than the base would not be coins.
        if row.contract_value_currency != row.base_currency {
            continue;
        }

        let base = currency_code(&row.base_currency, CODES);
        let quote = currency_code(&row.quote_currency, CODES);
        if base.is_empty() || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.instrument_id.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: catalog::contract_size(row.contract_value),
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    instrument_id: String, // "BTCUSDTPERP", the socket's and the tickers' id
    #[serde(rename = "type", default)]
    kind: String, // "REAL", or "SIMULATE" on the rows only type=1 returns
    #[serde(default)]
    contract_type: String, // "PERPETUAL"
    #[serde(default)]
    base_currency: String,
    #[serde(default)]
    quote_currency: String, // "USDT", or "USD" on an inverse row
    #[serde(default)]
    clear_currency: String, // the settlement currency, the base on an inverse row
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_value: f64, // "0.001" on BTC, "10000000" on PEPE, "1" USD on an inverse row
    #[serde(default)]
    contract_value_currency: String,
    #[serde(default)]
    is_inverse: bool,
    #[serde(default)]
    is_trading: bool,
    #[serde(default)]
    status: String, // "ONLINE", "OFFLINE" or "DELIVERY"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of the instruments reply captured live on 2026-10-09, cut to the fields the loader reads and a few it ignores.
    fn row(id: &str, base: &str, value: &str, status: &str, trading: bool) -> Value {
        json!({
            "instrument_id": id, "type": "REAL", "contract_type": "PERPETUAL", "base_currency": base, "quote_currency": "USDT",
            "clear_currency": "USDT", "contract_value": value, "contract_value_currency": base, "is_inverse": false,
            "is_trading": trading, "status": status, "price_precision": 1, "tick_size": "0.1", "min_order_amount": 1,
        })
    }

    fn reply() -> Value {
        json!({ "code": 0, "data": [
            row("BTCUSDTPERP", "BTC", "0.001", "ONLINE", true),
            row("PEPEUSDTPERP", "PEPE", "10000000", "ONLINE", true),
            row("NVDAUSDTPERP", "NVDA", "0.01", "ONLINE", true),
            row("ETHUSDTPERP", "ETH", "0.01", "ONLINE", true),
            row("BETHUSDTPERP", "ETH", "0.001", "ONLINE", true),
            // Every row was ONLINE and trading on the day, so these two are made up to pin the rule.
            row("ORDIUSDTPERP", "ORDI", "0.1", "OFFLINE", true),
            row("MANAUSDTPERP", "MANA", "10", "ONLINE", false),
            {
                "instrument_id": "BTCPERP", "type": "REAL", "contract_type": "PERPETUAL", "base_currency": "BTC",
                "quote_currency": "USD", "clear_currency": "BTC", "contract_value": "1", "contract_value_currency": "USD",
                "is_inverse": true, "is_trading": true, "status": "ONLINE", "price_precision": 1, "tick_size": "0.1",
            },
        ]})
    }

    fn parsed() -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(reply()["data"].clone()).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_trading_linear_perpetuals_with_tradfi_and_drops_offline_halted_and_inverse_rows() {
        assert_eq!(
            raw_ids(&parsed()),
            ["BTCUSDTPERP", "PEPEUSDTPERP", "NVDAUSDTPERP", "ETHUSDTPERP", "BETHUSDTPERP"]
        );
    }

    #[test]
    fn reads_base_and_quote_from_their_fields_with_the_contract_value_as_the_size_in_coins() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[0].contract_size, 0.001);
        assert_eq!(markets[1].contract_size, 10_000_000.0);
        assert_eq!(markets[2].base, "NVDA");
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 500 && m.price_scale == 1.0));
    }

    #[test]
    fn maps_codes_through_the_digifinex_table() {
        let rows: Vec<Instrument> = serde_json::from_value(json!([row("TELUSDTPERP", "TEL", "100", "ONLINE", true)])).unwrap();

        assert_eq!(parse(&rows)[0].base, "TEL666");
    }

    // DigiFinex lists only USDT linear contracts today, so these rows are made up to pin decision 3 and the size rule.
    #[test]
    fn drops_a_simulated_row_another_quote_and_a_size_not_counted_in_the_base() {
        let mut simulated = row("BTCUSDT2PERP", "BTC", "0.001", "ONLINE", true);
        simulated["type"] = json!("SIMULATE");
        let mut euro = row("BTCEURPERP", "BTC", "0.001", "ONLINE", true);
        euro["quote_currency"] = json!("EUR");
        euro["clear_currency"] = json!("EUR");
        let mut in_usd = row("SOLUSDTPERP", "SOL", "10", "ONLINE", true);
        in_usd["contract_value_currency"] = json!("USD");
        let mut usdc = row("BTCUSDCPERP", "BTC", "0.001", "ONLINE", true);
        usdc["quote_currency"] = json!("USDC");
        usdc["clear_currency"] = json!("USDC");
        let rows: Vec<Instrument> = serde_json::from_value(json!([simulated, euro, in_usd, usdc])).unwrap();

        assert_eq!(raw_ids(&parse(&rows)), ["BTCUSDCPERP"]);
    }

    #[tokio::test]
    async fn loads_the_catalog_denies_the_second_eth_contract_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("digifinex", "DigiFinex"));
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDTPERP", "PEPEUSDTPERP", "NVDAUSDTPERP", "ETHUSDTPERP"]);
        let denied = logs.events("market_denied");
        assert_eq!(denied.len(), 1);
        assert_eq!(denied[0].text("market"), "BETHUSDTPERP");
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 8.0);
        assert_eq!(read[0].number("kept"), 4.0);

        let failing = MockRest::start().await;
        failing.reply(INSTRUMENTS_PATH, json!({ "code": 400002, "msg": "invalid InstrumentId" }));
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("code 400002: invalid InstrumentId"), "{error:#}");
    }
}
