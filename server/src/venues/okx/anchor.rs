use super::{ID, Okx};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use futures_util::future::try_join_all;
use serde::Deserialize;
use std::collections::HashMap;

// OKX spreads the three numbers over three endpoints, and each answers for every instrument in one call.
const FUNDING_PATH: &str = "/api/v5/public/funding-rate?instId=ANY";
const MARK_PATH: &str = "/api/v5/public/mark-price?instType=SWAP";
const INDEX_PATH: &str = "/api/v5/market/index-tickers?quoteCcy=";
pub const INSTRUMENTS_PATH: &str = "/api/v5/public/instruments?instType=SWAP";

// The index is keyed by its own id, BTC-USDT for BTC-USDT-SWAP and BTC-USD for BTC-USD-SWAP, which the instrument's uly names.
// Listings change, so the table is reread every hour.
const INSTRUMENTS_REFRESH_MS: i64 = 60 * 60 * 1000;
const HOUR_MS: f64 = 60.0 * 60.0 * 1000.0;

#[derive(Default)]
pub struct Instruments {
    index_id_of: HashMap<String, String>, // instId to uly
    quote_ccys: Vec<String>,              // the index quotes some tracked market settles against
    read_at: i64,                         // Unix ms, 0 = never, so the first round reads the table
}

impl AnchorVenue for Okx {
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let due = ts - self.instruments.lock().unwrap().read_at >= INSTRUMENTS_REFRESH_MS;

        // A failure here fails the round and leaves read_at alone, so the next round tries again.
        if due {
            let reply: Reply<Instrument> = get_json(http, &format!("{}{INSTRUMENTS_PATH}", self.rest)).await?;
            check(&reply, "instruments")?;
            let table = self.read_instruments(reply.data, ts);
            tracing::info!(
                event = "instruments_read",
                venue = ID,
                instruments = table.index_id_of.len(),
                index_quotes = ?table.quote_ccys,
            );
            *self.instruments.lock().unwrap() = table;
        }

        let funding_url = format!("{}{FUNDING_PATH}", self.rest);
        let mark_url = format!("{}{MARK_PATH}", self.rest);
        let mut index_urls = Vec::new();
        for quote in &self.instruments.lock().unwrap().quote_ccys {
            index_urls.push(format!("{}{INDEX_PATH}{quote}", self.rest));
        }

        let (funding, mark, indices) = tokio::try_join!(
            get_json::<Reply<FundingRate>>(http, &funding_url),
            get_json::<Reply<MarkPrice>>(http, &mark_url),
            try_join_all(index_urls.iter().map(|url| get_json::<Reply<IndexTicker>>(http, url))),
        )?;
        check(&funding, "funding-rate")?;
        check(&mark, "mark-price")?;

        let mut index_px = HashMap::new();
        for reply in indices {
            check(&reply, "index-tickers")?;
            for row in reply.data {
                index_px.insert(row.inst_id, row.idx_px);
            }
        }

        let mut mark_px = HashMap::with_capacity(mark.data.len());
        for row in mark.data {
            mark_px.insert(row.inst_id, row.mark_px);
        }

        // The funding reply also lists the tradfi instruments that are not swaps, and those have no mark row, so they fall out on the join.
        let instruments = self.instruments.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(funding.data.len());
        for f in funding.data {
            let Some(&mark) = mark_px.get(&f.inst_id) else {
                continue;
            };
            let Some(&index) = instruments.index_id_of.get(&f.inst_id).and_then(|id| index_px.get(id)) else {
                continue;
            };

            rows.insert(
                f.inst_id,
                AnchorRow {
                    index,
                    mark,
                    funding_rate: f.funding_rate,
                    // No interval field exists, and the gap between the two settlement times is the interval.
                    funding_interval_hours: (f.next_funding_time - f.funding_time) / HOUR_MS,
                    next_funding_at: f.funding_time as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

impl Okx {
    fn read_instruments(&self, rows: Vec<Instrument>, ts: i64) -> Instruments {
        let mut index_id_of = HashMap::with_capacity(rows.len());
        let mut quotes: Vec<String> = Vec::new();
        for row in rows {
            let quote = quote_of(&row.uly).to_string();
            if !quotes.contains(&quote) {
                quotes.push(quote);
            }
            index_id_of.insert(row.inst_id, row.uly);
        }

        // A tracked market reads its quote from its index id when the table has it, and from its own quote otherwise.
        let mut quote_ccys = Vec::new();
        for quote in quotes {
            let tracked = self.tracked.iter().any(|(raw_market_id, market_quote)| {
                let settles = index_id_of.get(raw_market_id).map_or(market_quote.as_str(), |uly| quote_of(uly));
                settles == quote
            });
            if tracked {
                quote_ccys.push(quote);
            }
        }

        Instruments {
            index_id_of,
            quote_ccys,
            read_at: ts,
        }
    }
}

// "BTC-USDT" settles against USDT.
fn quote_of(uly: &str) -> &str {
    uly.find('-').map_or(uly, |dash| &uly[dash + 1..])
}

fn check<T>(reply: &Reply<T>, call: &str) -> anyhow::Result<()> {
    if reply.code != "0" {
        anyhow::bail!("{call} code {}: {}", reply.code, reply.msg);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct Reply<T> {
    pub code: String, // "0" on success
    #[serde(default)]
    pub msg: String,
    #[serde(default = "Vec::new")]
    pub data: Vec<T>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instrument {
    #[serde(default)]
    pub inst_id: String, // "BTC-USDT-SWAP"
    #[serde(default)]
    pub uly: String, // "BTC-USDT", the index the swap settles against
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingRate {
    #[serde(default)]
    inst_id: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // for the settlement at fundingTime, as a fraction
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_time: f64, // Unix ms, the upcoming settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms, the settlement after it
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkPrice {
    #[serde(default)]
    inst_id: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_px: f64,
}

// Keyed by the index id rather than the instrument id.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexTicker {
    #[serde(default)]
    inst_id: String, // "BTC-USDT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    idx_px: f64,
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/okx/anchor.spec.ts.

    use super::*;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};

    const T0: i64 = 1_789_015_953_991;
    const INDEX_USDT_PATH: &str = "/api/v5/market/index-tickers?quoteCcy=USDT";
    const INDEX_USD_PATH: &str = "/api/v5/market/index-tickers?quoteCcy=USD";

    // Shapes captured live on 2026-09-10.
    fn soph_funding() -> Value {
        json!({
            "formulaType": "withRate",
            "fundingRate": "-0.0012630077877366",
            "fundingTime": "1789027200000",
            "impactValue": "2000.0000000000000000",
            "instId": "SOPH-USDT-SWAP",
            "instType": "SWAP",
            "interestRate": "0.0001000000000000",
            "maxFundingRate": "0.01",
            "method": "current_period",
            "minFundingRate": "-0.01",
            "nextFundingRate": "",
            "nextFundingTime": "1789041600000",
            "premium": "-0.0036170725825898",
            "prevFundingTime": "1789012800000",
            "settFundingRate": "-0.0013346896995797",
            "settState": "settled",
            "ts": "1789015936441",
        })
    }

    fn btc_usd_funding() -> Value {
        let mut row = soph_funding();
        row["instId"] = json!("BTC-USD-SWAP");
        row["fundingRate"] = json!("0.0001");
        row["fundingTime"] = json!("1789027200000");
        row["nextFundingTime"] = json!("1789056000000");
        row
    }

    // A tradfi instrument that the funding reply lists and the swap mark reply does not.
    fn xau_funding() -> Value {
        let mut row = soph_funding();
        row["instId"] = json!("XAU-USD_UM_XPERP-310502");
        row
    }

    fn soph_mark() -> Value {
        json!({ "instId": "SOPH-USDT-SWAP", "instType": "SWAP", "markPx": "0.004128", "ts": "1789015953991" })
    }

    fn btc_usd_mark() -> Value {
        json!({ "instId": "BTC-USD-SWAP", "instType": "SWAP", "markPx": "78290.1", "ts": "1789015953991" })
    }

    fn soph_index() -> Value {
        json!({
            "instId": "SOPH-USDT", "idxPx": "0.004147", "high24h": "0.00582", "low24h": "0.003924",
            "open24h": "0.005291", "sodUtc0": "0.004213", "sodUtc8": "0.004963", "ts": "1789015952092",
        })
    }

    fn btc_usd_index() -> Value {
        json!({ "instId": "BTC-USD", "idxPx": "78278.5", "ts": "1789015953095" })
    }

    fn soph_instrument() -> Value {
        json!({ "instId": "SOPH-USDT-SWAP", "uly": "SOPH-USDT", "instFamily": "SOPH-USDT", "settleCcy": "USDT", "ctVal": "100", "state": "live" })
    }

    fn btc_usd_instrument() -> Value {
        json!({ "instId": "BTC-USD-SWAP", "uly": "BTC-USD", "instFamily": "BTC-USD", "settleCcy": "BTC", "ctVal": "100", "state": "live" })
    }

    fn ok(data: Value) -> Value {
        json!({ "code": "0", "msg": "", "data": data })
    }

    fn poller(rest: &MockRest, markets: &[(&str, &str)]) -> Okx {
        let mut listed = Vec::new();
        for &(id, quote) in markets {
            listed.push(market(ID, id, &id[..id.find('-').unwrap()], quote, quote != "USD"));
        }
        Okx::with_rest(&tracked(&listed), &rest.url)
    }

    fn soph_only(rest: &MockRest) {
        rest.reply(INSTRUMENTS_PATH, ok(json!([soph_instrument()])));
        rest.reply(FUNDING_PATH, ok(json!([soph_funding()])));
        rest.reply(MARK_PATH, ok(json!([soph_mark()])));
        rest.reply(INDEX_USDT_PATH, ok(json!([soph_index()])));
    }

    // instruments

    #[tokio::test]
    async fn asks_only_for_the_index_quotes_the_tracked_markets_settle_against() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, ok(json!([soph_instrument(), btc_usd_instrument()])));
        rest.reply(FUNDING_PATH, ok(json!([soph_funding(), btc_usd_funding()])));
        rest.reply(MARK_PATH, ok(json!([soph_mark(), btc_usd_mark()])));
        rest.reply(INDEX_USDT_PATH, ok(json!([soph_index()])));

        poller(&rest, &[("SOPH-USDT-SWAP", "USDT")]).fetch_round(&http(), T0).await.unwrap();

        let calls = rest.calls();
        assert!(calls.contains(&INDEX_USDT_PATH.to_string()));
        assert!(!calls.contains(&INDEX_USD_PATH.to_string()));
    }

    #[tokio::test]
    async fn reads_the_table_on_the_first_round_and_then_once_an_hour() {
        let rest = MockRest::start().await;
        soph_only(&rest);
        let venue = poller(&rest, &[("SOPH-USDT-SWAP", "USDT")]);

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        venue.fetch_round(&http(), T0 + 60 * 60 * 1000).await.unwrap();

        let reads = rest.calls().iter().filter(|call| *call == INSTRUMENTS_PATH).count();
        assert_eq!(reads, 2);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_venue_error_code_from_the_instruments_call() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "code": "50011", "msg": "Too Many Requests", "data": [] }));

        let error = poller(&rest, &[("SOPH-USDT-SWAP", "USDT")]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().contains("instruments code 50011"), "{error:#}");
    }

    // round

    #[tokio::test]
    async fn joins_funding_mark_and_index_and_derives_the_interval_from_the_two_settlement_times() {
        let rest = MockRest::start().await;
        soph_only(&rest);

        let rows = poller(&rest, &[("SOPH-USDT-SWAP", "USDT")]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["SOPH-USDT-SWAP"],
            AnchorRow {
                index: 0.004147,
                mark: 0.004128,
                funding_rate: -0.0012630077877366,
                funding_interval_hours: 4.0,
                next_funding_at: 1789027200000,
                ts: None,
            }
        );
    }

    #[tokio::test]
    async fn reads_an_inverse_swap_through_its_own_usd_index() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, ok(json!([soph_instrument(), btc_usd_instrument()])));
        rest.reply(FUNDING_PATH, ok(json!([soph_funding(), btc_usd_funding()])));
        rest.reply(MARK_PATH, ok(json!([soph_mark(), btc_usd_mark()])));
        rest.reply(INDEX_USDT_PATH, ok(json!([soph_index()])));
        rest.reply(INDEX_USD_PATH, ok(json!([btc_usd_index()])));

        let rows = poller(&rest, &[("SOPH-USDT-SWAP", "USDT"), ("BTC-USD-SWAP", "USD")])
            .fetch_round(&http(), T0)
            .await
            .unwrap();

        assert_eq!(
            rows["BTC-USD-SWAP"],
            AnchorRow {
                index: 78278.5,
                mark: 78290.1,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: 1789027200000,
                ts: None,
            }
        );
    }

    #[tokio::test]
    async fn drops_a_funding_row_that_has_no_mark_which_is_how_the_tradfi_instruments_fall_out() {
        let rest = MockRest::start().await;
        soph_only(&rest);
        rest.reply(FUNDING_PATH, ok(json!([xau_funding(), soph_funding()])));

        let rows = poller(&rest, &[("SOPH-USDT-SWAP", "USDT")]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["SOPH-USDT-SWAP"]);
    }

    #[tokio::test]
    async fn drops_a_swap_whose_index_the_round_did_not_carry() {
        let rest = MockRest::start().await;
        soph_only(&rest);
        rest.reply(INDEX_USDT_PATH, ok(json!([])));

        let rows = poller(&rest, &[("SOPH-USDT-SWAP", "USDT")]).fetch_round(&http(), T0).await.unwrap();

        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn fails_the_round_when_one_of_the_three_calls_returns_a_venue_error() {
        let rest = MockRest::start().await;
        soph_only(&rest);
        rest.reply(MARK_PATH, json!({ "code": "50013", "msg": "System busy", "data": [] }));

        let error = poller(&rest, &[("SOPH-USDT-SWAP", "USDT")]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().contains("mark-price code 50013"), "{error:#}");
    }
}
