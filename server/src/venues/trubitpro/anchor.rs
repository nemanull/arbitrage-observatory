use super::TrubitPro;
use super::markets::ref_data;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_json};
use crate::venues::wire;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::time::Duration;

// Index and mark for every contract, each documented at 10 calls a second per IP.
pub const INDEX_PATH: &str = "/market/api/v1/basic/indexPrice";
pub const MARK_PATH: &str = "/market/api/v1/basic/markPrice";

// The rate for every contract it names, documented at 5 calls a second, and refused with code 1 when it names none.
pub const FUNDING_PATH: &str = "/market/api/v1/kLine/fundingRate";

// No call publishes the interval, and the Funding Fee and Perpetual Overview articles say 8 h.
// The equity perpetual launch article says 4 h, which is recorded as an open question for activation.
const FUNDING_INTERVAL_HOURS: f64 = 8.0;

// On 2026-10-09 from 20:25 UTC, after the US close, each index equalled the venue's own book mid to the digit and moved only with it.
// XAGUSDT did so while COMEX silver still traded, and binance and bybit read the silver index 0.04 to 0.06 percent away.
// Decision 4 leaves out a contract whose index is the venue's own perpetual, as backpack leaves out its equity perpetuals.
const SELF_INDEXED: [&str; 3] = ["TSLAUSDT", "NVDAUSDT", "XAGUSDT"];

const UNKNOWN_SYMBOL_CODE: i64 = 24001;

// "Transaction sent too fast", "Operation too fast" and "Operate frequently, try again 60 seconds later", all in a 200 body.
const RATE_LIMIT_CODES: [i64; 3] = [20013, 20089, 20121];
const SIXTY_SECOND_CODE: i64 = 20121;

impl AnchorVenue for TrubitPro {
    // Every limit is a one second window per IP, and no Retry-After was documented or seen.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(1)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let index_url = format!("{}{INDEX_PATH}", self.rest);
        let mark_url = format!("{}{MARK_PATH}", self.rest);
        let (index, mark, funding) = tokio::try_join!(
            rows::<Price>(http, &index_url),
            rows::<Price>(http, &mark_url),
            self.funding(http),
        )?;

        let mut marks = HashMap::with_capacity(mark.len());
        for row in mark {
            marks.insert(row.symbol, row.price);
        }
        let mut rates = HashMap::with_capacity(funding.len());
        for row in funding {
            rates.insert(row.symbol, row.rate);
        }

        let mut anchors = AnchorMap::with_capacity(index.len());
        for row in index {
            if SELF_INDEXED.contains(&row.symbol.as_str()) {
                continue;
            }
            let (Some(&mark), Some(&rate)) = (marks.get(&row.symbol), rates.get(&row.symbol)) else {
                continue;
            };
            anchors.insert(
                row.symbol,
                AnchorRow {
                    index: row.price,
                    mark,
                    funding_rate: rate,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at: 0, // no call publishes the next settlement
                    ts: None,
                },
            );
        }

        Ok(anchors)
    }
}

impl TrubitPro {
    // One unknown symbol fails the whole funding call with code 24001, so a delisted contract would end every round.
    // On that code the catalog is read again, the symbols it no longer lists are dropped, and the call is made once more.
    async fn funding(&self, http: &reqwest::Client) -> anyhow::Result<Vec<Funding>> {
        let symbols = self.symbols.lock().unwrap().join(",");
        match rows::<Funding>(http, &self.funding_url(&symbols)).await {
            Err(error) if error.downcast_ref::<CodeError>().is_some_and(|e| e.code == UNKNOWN_SYMBOL_CODE) => {}
            fetched => return fetched,
        }

        let listed = ref_data(http, &self.rest).await?;
        let pruned = {
            let mut symbols = self.symbols.lock().unwrap();
            let before = symbols.len();
            symbols.retain(|symbol| listed.iter().any(|row| &row.symbol == symbol));
            if symbols.len() == before {
                anyhow::bail!("the funding call refused a symbol the catalog still lists");
            }
            tracing::warn!(event = "funding_symbols_pruned", venue = super::ID, dropped = before - symbols.len(), kept = symbols.len());
            symbols.join(",")
        };
        rows::<Funding>(http, &self.funding_url(&pruned)).await
    }

    fn funding_url(&self, symbols: &str) -> String {
        format!("{}{FUNDING_PATH}?symbols={symbols}", self.rest)
    }
}

// An error arrives as HTTP 200 with a code other than 0.
async fn rows<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<Vec<T>> {
    let reply: Reply<T> = get_json(http, url).await?;
    if RATE_LIMIT_CODES.contains(&reply.code) {
        return Err(RateLimited {
            url: url.to_string(),
            reason: format!("code {}", reply.code),
            retry_after: (reply.code == SIXTY_SECOND_CODE).then_some(Duration::from_secs(60)),
        }
        .into());
    }
    if reply.code != 0 {
        return Err(CodeError { code: reply.code, message: reply.message }.into());
    }
    Ok(reply.result.unwrap_or_default())
}

#[derive(Debug)]
struct CodeError {
    code: i64,
    message: String,
}

impl std::fmt::Display for CodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "code {}: {}", self.code, self.message)
    }
}

impl std::error::Error for CodeError {}

#[derive(Deserialize)]
struct Reply<T> {
    #[serde(default = "super::no_code")]
    code: i64,
    #[serde(default, alias = "msg")]
    message: String,
    result: Option<Vec<T>>,
}

// The time field is the venue's last change, which ran minutes behind on a quiet index, so a row is stamped on arrival as on every venue.
#[derive(Debug, Deserialize)]
struct Price {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    price: f64,
}

#[derive(Deserialize)]
struct Funding {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    rate: f64, // a fraction per interval, recomputed hourly
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use crate::venues::trubitpro::markets::REF_DATA_PATH;
    use serde_json::{Value, json};

    // Rows captured live on 2026-10-09 at 20:04 UTC, with ETHUSDT's index and rate from 20:25 UTC.
    fn index_reply() -> Value {
        json!({ "code": 0, "message": "OK", "result": [
            { "symbol": "MASKUSDT", "price": 0.45709999999999995_f64, "time": 1791576266141_i64 },
            { "symbol": "BTCUSDT", "price": 82324.43666666666_f64, "time": 1791576287455_i64 },
            { "symbol": "ETHUSDT", "price": 2480.5899999999997_f64, "time": 1791577500041_i64 },
        ]})
    }

    fn mark_reply() -> Value {
        json!({ "code": 0, "message": "OK", "result": [
            { "symbol": "MASKUSDT", "price": 0.4560961538461538_f64, "time": 1791576289224_i64 },
            { "symbol": "BTCUSDT", "price": 82299.95, "time": 1791576288222_i64 },
        ]})
    }

    fn funding_row(symbol: &str, rate: f64) -> Value {
        json!({ "symbol": symbol, "rate": rate, "date": "2026-10-09T20:00:00.000+00:00", "timestamp": 1791576000243_i64 })
    }

    fn funding_reply() -> Value {
        json!({ "code": 0, "message": "OK", "result": [
            funding_row("MASKUSDT", 1.0E-5),
            funding_row("BTCUSDT", -4.158E-5),
            funding_row("ETHUSDT", -4.158E-5),
        ]})
    }

    fn venue(rest: &MockRest, symbols: &[&str]) -> TrubitPro {
        let markets: Vec<_> = symbols.iter().map(|s| market("trubitpro", s, s, "USDT", true)).collect();
        TrubitPro::with_rest(&rest.url, &tracked(&markets))
    }

    fn funding_path(symbols: &str) -> String {
        format!("{FUNDING_PATH}?symbols={symbols}")
    }

    const SYMBOLS: [&str; 3] = ["MASKUSDT", "BTCUSDT", "ETHUSDT"];

    #[test]
    fn polls_every_second_and_pauses_one_second_on_a_rate_limit() {
        let venue = TrubitPro::new(&[]);

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn joins_index_mark_and_the_rate_of_every_tracked_symbol_at_the_documented_interval() {
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, index_reply());
        rest.reply(MARK_PATH, mark_reply());
        rest.reply(&funding_path("MASKUSDT,BTCUSDT,ETHUSDT"), funding_reply());

        let rows = venue(&rest, &SYMBOLS).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(
            rows["BTCUSDT"],
            AnchorRow {
                index: 82324.43666666666,
                mark: 82299.95,
                funding_rate: -4.158E-5,
                funding_interval_hours: 8.0,
                next_funding_at: 0,
                ts: None,
            }
        );
        assert_eq!(rows["MASKUSDT"].mark, 0.4560961538461538);
        assert_eq!(rows.len(), 2, "ETHUSDT has no mark in this reply");
    }

    // The TSLAUSDT and XAGUSDT rows of 2026-10-09 at 20:25 UTC, whose index equalled the book mid of 383.01 and 383.02, and of 60.91 and 60.92.
    #[tokio::test]
    async fn leaves_out_the_contracts_whose_index_is_the_venues_own_mid() {
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, json!({ "code": 0, "message": "OK", "result": [
            { "symbol": "BTCUSDT", "price": 82420.70333333332_f64, "time": 1791577514000_i64 },
            { "symbol": "TSLAUSDT", "price": 383.015, "time": 1791577514000_i64 },
            { "symbol": "XAGUSDT", "price": 60.915, "time": 1791577446000_i64 },
        ]}));
        rest.reply(MARK_PATH, json!({ "code": 0, "message": "OK", "result": [
            { "symbol": "BTCUSDT", "price": 82390.05, "time": 1791577512000_i64 },
            { "symbol": "TSLAUSDT", "price": 383.015, "time": 1791577514000_i64 },
            { "symbol": "XAGUSDT", "price": 60.915, "time": 1791577514000_i64 },
        ]}));
        rest.reply(
            &funding_path("BTCUSDT,TSLAUSDT,XAGUSDT"),
            json!({ "code": 0, "message": "OK", "result": [
                funding_row("BTCUSDT", -1.0E-5),
                funding_row("TSLAUSDT", 1.0E-5),
                funding_row("XAGUSDT", 1.0E-5),
            ]}),
        );

        let rows = venue(&rest, &["BTCUSDT", "TSLAUSDT", "XAGUSDT"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn fails_a_round_whose_reply_carries_a_nonzero_code() {
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, json!({ "code": 1, "msg": "FAILED", "data": null }));
        rest.reply(MARK_PATH, mark_reply());
        rest.reply(&funding_path("MASKUSDT,BTCUSDT,ETHUSDT"), funding_reply());

        let error = venue(&rest, &SYMBOLS).fetch_round(&http(), 0).await.unwrap_err();

        assert!(format!("{error:#}").contains("code 1: FAILED"), "{error:#}");
    }

    // The codes are the documented table's, since no limit was provoked.
    #[tokio::test]
    async fn reads_a_rate_limit_code_in_a_200_as_a_rate_limit_that_waits_60_s_after_20121() {
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, json!({ "code": 20013, "message": "Transaction sent too fast", "result": null }));
        rest.reply(MARK_PATH, json!({ "code": 20121, "message": "Operate frequently, try again 60 seconds later", "result": null }));
        rest.reply(&funding_path("BTCUSDT"), funding_reply());

        let error = venue(&rest, &["BTCUSDT"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");

        let wait = |error: anyhow::Error| error.downcast::<RateLimited>().unwrap().retry_after;
        let index = rows::<Price>(&http(), &format!("{}{INDEX_PATH}", rest.url)).await.unwrap_err();
        let mark = rows::<Price>(&http(), &format!("{}{MARK_PATH}", rest.url)).await.unwrap_err();
        assert_eq!(wait(index), None);
        assert_eq!(wait(mark), Some(Duration::from_secs(60)));
    }

    // The 24001 reply is the live answer to an unknown symbol on 2026-10-09.
    #[tokio::test]
    async fn drops_a_symbol_the_catalog_no_longer_lists_when_the_funding_call_refuses_it() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, index_reply());
        rest.reply(MARK_PATH, mark_reply());
        rest.reply(&funding_path("MASKUSDT,GONEUSDT,BTCUSDT"), json!({ "code": 24001, "message": "Symbol not found", "result": null }));
        rest.reply(&funding_path("MASKUSDT,BTCUSDT"), funding_reply());
        rest.reply(REF_DATA_PATH, json!({ "code": 0, "message": "OK", "result": [
            { "symbol": "MASKUSDT", "tick": 1.0E-4, "lotSize": 1.0, "type": "PERP" },
            { "symbol": "BTCUSDT", "tick": 0.1, "lotSize": 1.0, "type": "PERP" },
        ]}));
        let venue = venue(&rest, &["MASKUSDT", "GONEUSDT", "BTCUSDT"]);

        let rows = venue.fetch_round(&http(), 0).await.unwrap();
        let again = venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(again.len(), 2);
        assert_eq!(logs.events("funding_symbols_pruned").len(), 1);
        let refs = rest.calls().iter().filter(|call| call.as_str() == REF_DATA_PATH).count();
        assert_eq!(refs, 1, "the catalog is read only on the refusal");
    }

    #[tokio::test]
    async fn fails_a_refusal_when_the_catalog_still_lists_every_symbol() {
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, index_reply());
        rest.reply(MARK_PATH, mark_reply());
        rest.reply(&funding_path("BTCUSDT"), json!({ "code": 24001, "message": "Symbol not found", "result": null }));
        rest.reply(REF_DATA_PATH, json!({ "code": 0, "message": "OK", "result": [{ "symbol": "BTCUSDT", "type": "PERP" }] }));

        assert!(venue(&rest, &["BTCUSDT"]).fetch_round(&http(), 0).await.is_err());
    }

    #[tokio::test]
    async fn fails_a_round_when_a_call_fails() {
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, index_reply());
        rest.fail(MARK_PATH, 500);
        rest.reply(&funding_path("BTCUSDT"), funding_reply());

        assert!(venue(&rest, &["BTCUSDT"]).fetch_round(&http(), 0).await.is_err());
    }
}
