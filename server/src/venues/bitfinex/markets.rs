use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};

const NAME: &str = "Bitfinex";

// Every perpetual trades with no maker or taker fee since 2025-12-17, see docs/profiles/bitfinex/fees.md section 2.
// CCXT 4.5.68 still reports 0.002 from its fee table of before that date.
const TAKER_PPM: u32 = 0;

// Every perpetual pair, with no status field, so a listed pair is a live pair.
pub const PAIRS_PATH: &str = "/v2/conf/pub:list:pair:futures";

// CCXT's bitfinex commonCurrencies, which translate Bitfinex's own short codes, such as ALG for ALGO.
const CODES: &[(&str, &str)] = &[
    ("UST", "USDT"),
    ("EUTF0", "EURT"),
    ("USTF0", "USDT"),
    ("ALG", "ALGO"),
    ("AMP", "AMPL"),
    ("ATO", "ATOM"),
    ("BCHABC", "XEC"),
    ("BCHN", "BCH"),
    ("DAT", "DATA"),
    ("DOG", "MDOGE"),
    ("DSH", "DASH"),
    ("EDO", "PNT"),
    ("EUS", "EURS"),
    ("EUT", "EURT"),
    ("HTX", "HT"),
    ("IDX", "ID"),
    ("IOT", "IOTA"),
    ("IQX", "IQ"),
    ("LUNA", "LUNC"),
    ("LUNA2", "LUNA"),
    ("MNA", "MANA"),
    ("ORS", "ORS Group"),
    ("PAS", "PASS"),
    ("QSH", "QASH"),
    ("QTM", "QTUM"),
    ("RBT", "RBTC"),
    ("SNG", "SNGLS"),
    ("STJ", "STORJ"),
    ("TERRAUST", "USTC"),
    ("TSD", "TUSD"),
    ("YGG", "YEED"),
    ("YYW", "YOYOW"),
    ("UDC", "USDC"),
    ("VSY", "VSYS"),
    ("WAX", "WAXP"),
    ("XCH", "XCHF"),
    ("ZBT", "ZB"),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Vec<Vec<String>> = get_json(http, &format!("{rest}{PAIRS_PATH}")).await?;
    let Some(pairs) = reply.first() else {
        anyhow::bail!("{ID} pairs reply holds no list");
    };
    let markets = parse(pairs);
    catalog::finish(ID, NAME, pairs.len(), markets, &[])
}

// CCXT's bitfinex fetchMarkets for a swap, whose pair is "<base>F0:<quote>F0", kept when it settles in USDt.
// CCXT looks a code up with its F0 still on and strips it afterwards, so ALGF0, ATOF0 and IOTF0 miss the table and come out as ALG, ATO and IOT.
// Those are Bitfinex's codes for ALGO, ATOM and IOTA, so the code is looked up after the strip.
// The BTC settled pairs are coin quoted and the TESTUSDT pairs are paper trading, so both stay out.
fn parse(pairs: &[String]) -> Vec<Market> {
    let mut markets = Vec::new();

    for pair in pairs {
        let pair = pair.to_uppercase();
        let Some((base_id, quote_id)) = pair.split_once(':') else {
            continue;
        };
        let (Some(base_id), Some(quote_id)) = (base_id.strip_suffix("F0"), quote_id.strip_suffix("F0")) else {
            continue;
        };

        let base = currency_code(base_id, CODES);
        let quote = currency_code(quote_id, CODES);
        if base.is_empty() || quote != "USDT" {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: format!("t{pair}"), // the socket symbol and the status key, "tBTCF0:USTF0"
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book amounts are coins of the base, with no catalog field
            price_scale: 1.0,
        });
    }

    markets
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Pairs trimmed from the reply captured live on 2026-10-09, which listed 76 USDt, 4 BTC settled and 14 paper pairs.
    fn reply() -> Value {
        json!([[
            "AAVEF0:USTF0",
            "ALGF0:USTF0",
            "ATOF0:USTF0",
            "BTCF0:USTF0",
            "ETHF0:BTCF0",
            "EUROPE50IXF0:USTF0",
            "IOTF0:USTF0",
            "TESTBTCF0:TESTUSDTF0",
            "XAUTF0:BTCF0",
            "XAUTF0:USTF0",
        ]])
    }

    fn parsed() -> Vec<Market> {
        let reply: Vec<Vec<String>> = serde_json::from_value(reply()).unwrap();
        parse(&reply[0])
    }

    #[test]
    fn keeps_the_usdt_settled_pairs_under_their_socket_symbol() {
        assert_eq!(
            raw_ids(&parsed()),
            [
                "tAAVEF0:USTF0",
                "tALGF0:USTF0",
                "tATOF0:USTF0",
                "tBTCF0:USTF0",
                "tEUROPE50IXF0:USTF0",
                "tIOTF0:USTF0",
                "tXAUTF0:USTF0",
            ]
        );
    }

    #[test]
    fn drops_the_btc_settled_and_the_paper_trading_pairs() {
        let ids = raw_ids(&parsed()).join(",");

        assert!(!ids.contains(":BTCF0"));
        assert!(!ids.contains("TEST"));
    }

    #[test]
    fn strips_f0_before_the_code_table_so_alg_ato_and_iot_name_algo_atom_and_iota() {
        let markets = parsed();
        let pairs: Vec<(&str, &str)> = markets.iter().map(|m| (m.base.as_str(), m.quote.as_str())).collect();

        assert_eq!(
            pairs,
            [
                ("AAVE", "USDT"),
                ("ALGO", "USDT"),
                ("ATOM", "USDT"),
                ("BTC", "USDT"),
                ("EUROPE50IX", "USDT"),
                ("IOTA", "USDT"),
                ("XAUT", "USDT"),
            ]
        );
    }

    #[test]
    fn skips_a_pair_that_is_not_a_perpetual() {
        let pairs = vec!["BTCUST".to_string(), "BTC:UST".to_string(), "BTCF0:UST".to_string()];

        assert!(parse(&pairs).is_empty());
    }

    #[test]
    fn counts_one_coin_per_contract_with_no_taker_fee() {
        assert!(parsed().iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0 && m.taker_ppm == 0));
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_an_empty_reply() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(PAIRS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "bitfinex");
        assert_eq!(venue.markets.len(), 7);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 10.0);

        let empty = MockRest::start().await;
        empty.reply(PAIRS_PATH, json!([]));
        assert!(load_from(&http(), &empty.url).await.is_err());
    }
}
