use super::{Depth, Profile, Schedule};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::{get_json, post_json};
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::{BTreeMap, HashSet};
use std::sync::Mutex;

pub const CONTRACTS_PATH: &str = "/contracts";

const UNSCHEDULED_SAMPLE: usize = 5;

// The depth step of each Aivora contract, which its socket names in the book channel and no Market field carries.
// The loader writes it and the feed reads it, and every run loads a venue before it starts one.
static DEPTH_STEPS: Mutex<BTreeMap<(String, String), String>> = Mutex::new(BTreeMap::new()); // <(venue id, raw id), "0.1">

pub async fn load(profile: &'static Profile, http: &reqwest::Client) -> anyhow::Result<Venue> {
    let schedule_url = match profile.schedule {
        Schedule::PublicInfo(url) | Schedule::ContractConfig(url) => url,
    };
    load_from(profile, http, profile.rest, schedule_url).await
}

async fn load_from(profile: &'static Profile, http: &reqwest::Client, rest: &str, schedule_url: &str) -> anyhow::Result<Venue> {
    let rows: Vec<Contract> = get_json(http, &format!("{rest}{CONTRACTS_PATH}")).await?;
    let scheduled: HashSet<String> = read_schedule(http, profile.schedule, schedule_url)
        .await?
        .into_iter()
        .map(|row| row.raw)
        .collect();

    let markets = parse(profile, &rows, &scheduled);
    if profile.depth == Depth::Tick {
        for row in &rows {
            set_depth_step(profile.id, &socket_name(&row.symbol), depth_step(row.price_precision));
        }
    }
    catalog::finish(profile.id, profile.name, rows.len(), markets, profile.denied)
}

pub fn set_depth_step(venue_id: &str, raw_market_id: &str, step: String) {
    let mut steps = DEPTH_STEPS.lock().unwrap();
    steps.insert((venue_id.to_string(), raw_market_id.to_string()), step);
}

// The step of a contract's unaggregated book, which equalled the first entry of the web list's depthList on 87 of 87 Aivora contracts on 2026-10-09.
pub fn depth_step_of(venue_id: &str, raw_market_id: &str) -> Option<String> {
    let steps = DEPTH_STEPS.lock().unwrap();
    steps.get(&(venue_id.to_string(), raw_market_id.to_string())).cloned()
}

// No CCXT class exists for any member, so these are the rules of the profiles' rest.md.
// A contract is kept when the open API lists it as a trading linear perpetual and the funding schedule lists it too.
// The schedule is what drops Koinbay's 34 contracts that are listed as trading and had no trade in about two years.
fn parse(profile: &Profile, rows: &[Contract], scheduled: &HashSet<String>) -> Vec<Market> {
    let mut markets = Vec::new();
    let mut unscheduled = Vec::new();

    for row in rows {
        // `type` E is a perpetual, `side` 1 linear and `status` 1 trading.
        if row.kind != "E" || row.side != 1 || row.status != 1 {
            continue;
        }

        let parts: Vec<&str> = row.symbol.split('-').collect();
        let [_, base, quote] = parts.as_slice() else {
            continue;
        };
        if !profile.quotes.contains(quote) || row.margin_coin.as_deref().is_some_and(|margin| margin != *quote) {
            continue;
        }

        // FameEX sizes eight contracts, such as E-BABA-USDT, in USDT, and what one is worth in the base is not published.
        if row.multiplier_coin != *base {
            tracing::info!(
                event = "market_skipped",
                venue = profile.id,
                market = %row.symbol,
                multiplier_coin = %row.multiplier_coin,
                reason = "the contract is not sized in its base",
            );
            continue;
        }

        let raw = socket_name(&row.symbol);
        if !scheduled.contains(&raw) {
            unscheduled.push(raw);
            continue;
        }

        markets.push(Market {
            venue_id: profile.id.to_string(),
            price_scale: price_scale(profile, &raw),
            raw_market_id: raw,
            base: currency_code(base, &[]),
            quote: currency_code(quote, &[]),
            taker_ppm: taker_ppm(row.open_taker_fee, profile.taker_ppm),
            linear: true,
            contract_size: contract_size(row.multiplier), // the books count contracts of `multiplier` priced units
        });
    }

    if !unscheduled.is_empty() {
        tracing::info!(
            event = "markets_unscheduled",
            venue = profile.id,
            count = unscheduled.len(),
            sample = ?&unscheduled[..unscheduled.len().min(UNSCHEDULED_SAMPLE)],
            reason = "listed as trading, with no funding schedule",
        );
    }

    markets
}

fn price_scale(profile: &Profile, raw_market_id: &str) -> f64 {
    let scaled = profile.price_scales.iter().find(|(raw, _)| *raw == raw_market_id);
    scaled.map_or(1.0, |&(_, scale)| scale)
}

// Koinbay states each contract's taker, 0.075 % on 32 of the kept contracts and 0.05 % on 61 on 2026-10-09, and the others state none on this call.
fn taker_ppm(open_taker_fee: f64, fallback: u32) -> u32 {
    if open_taker_fee.is_finite() && open_taker_fee > 0.0 {
        (open_taker_fee * 1_000_000.0).round() as u32
    } else {
        fallback
    }
}

// "E-BTC-USDT" is "e_btcusdt" on the socket: lower case, the first hyphen an underscore and the others gone.
// The rule held on every contract of the web lists that name both on 2026-10-09.
pub fn socket_name(symbol: &str) -> String {
    let lower = symbol.to_lowercase();
    match lower.split_once('-') {
        Some((kind, rest)) => format!("{kind}_{}", rest.replace('-', "")),
        None => lower,
    }
}

// 10^-precision written with that many decimals, "0.1" for 1 and "1" for 0.
fn depth_step(price_precision: i64) -> String {
    if price_precision <= 0 {
        return "1".to_string();
    }
    format!("0.{}1", "0".repeat(price_precision as usize - 1))
}

// One contract's funding interval and next settlement, from the schedule call.
#[derive(Debug, Clone, PartialEq)]
pub struct ScheduleRow {
    pub raw: String,
    pub contract: String, // "E-BTC-USDT", which the open API's per contract calls take
    pub interval_hours: f64,
    pub next_at: i64, // Unix ms, 0 when the call has none, and it can be a settlement that has just passed
}

pub async fn read_schedule(http: &reqwest::Client, schedule: Schedule, url: &str) -> anyhow::Result<Vec<ScheduleRow>> {
    let reply: ScheduleReply = match schedule {
        Schedule::PublicInfo(_) => post_json(http, url, &serde_json::json!({})).await?,
        Schedule::ContractConfig(_) => get_json(http, url).await?,
    };
    if reply.code != "0" {
        anyhow::bail!("{url} answered code {}: {}", reply.code, reply.msg);
    }
    let Some(data) = reply.data else {
        anyhow::bail!("{url} answered no data");
    };

    let mut rows = Vec::with_capacity(data.contract_list.len());
    for entry in data.contract_list {
        if entry.status.is_some_and(|status| status != 1) {
            continue;
        }
        let Some(interval_hours) = interval_hours(entry.capital_frequency, entry.capital_frequency_unit.as_deref()) else {
            continue;
        };
        let raw = if entry.sub_symbol.is_empty() { socket_name(&entry.contract_name) } else { entry.sub_symbol };
        rows.push(ScheduleRow {
            raw,
            contract: entry.contract_name,
            interval_hours,
            next_at: entry.next_capital_sett_time.filter(|&at| at > 0).unwrap_or(0),
        });
    }
    Ok(rows)
}

// Hours on every row read on 2026-10-09, where FameEX alone names the unit.
fn interval_hours(frequency: f64, unit: Option<&str>) -> Option<f64> {
    if !frequency.is_finite() || frequency <= 0.0 {
        return None;
    }
    match unit {
        None | Some("h") => Some(frequency),
        Some("m") => Some(frequency / 60.0),
        Some(_) => None,
    }
}

#[derive(Deserialize)]
struct Contract {
    #[serde(default)]
    symbol: String, // "E-BTC-USDT"
    #[serde(default, rename = "type")]
    kind: String,
    #[serde(default)]
    side: i64,
    #[serde(default)]
    status: i64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    multiplier: f64,
    #[serde(default, rename = "multiplierCoin")]
    multiplier_coin: String,
    #[serde(default, rename = "pricePrecision")]
    price_precision: i64,
    #[serde(default, rename = "marginCoin")]
    margin_coin: Option<String>, // Koinbay only
    #[serde(default = "wire::nan", rename = "openTakerFee", deserialize_with = "wire::num")]
    open_taker_fee: f64, // Koinbay only, 0.00075
}

#[derive(Deserialize)]
struct ScheduleReply {
    #[serde(default)]
    code: String, // "0", and errors arrive under HTTP 200 with another code
    #[serde(default)]
    msg: String,
    data: Option<ScheduleData>,
}

#[derive(Deserialize)]
struct ScheduleData {
    #[serde(default, rename = "contractList")]
    contract_list: Vec<ScheduleEntry>,
}

#[derive(Deserialize)]
struct ScheduleEntry {
    #[serde(default, rename = "contractName")]
    contract_name: String,
    #[serde(default, rename = "subSymbol")]
    sub_symbol: String, // absent on Koinbay's config
    #[serde(default = "wire::nan", rename = "capitalFrequency", deserialize_with = "wire::num")]
    capital_frequency: f64,
    #[serde(default, rename = "capitalFrequencyUnit")]
    capital_frequency_unit: Option<String>, // "h", FameEX only
    #[serde(default, rename = "nextCapitalSettTime")]
    next_capital_sett_time: Option<i64>, // absent on Koinbay's config
    status: Option<i64>, // Koinbay's config only
}

#[cfg(test)]
mod tests {
    use super::super::{AIVORA, FAMEEX, KOINBAY, XME};
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows captured live from each member's /contracts on 2026-10-09, cut to the fields the loader reads plus a few it ignores.
    fn aivora_btc() -> Value {
        json!({"symbol":"E-BTC-USDT","pricePrecision":1,"side":1,"multiplier":0.0001,"minOrderVolume":1,"type":"E","multiplierCoin":"BTC","contractId":1,"status":1})
    }

    fn aivora_btc_usdc() -> Value {
        json!({"symbol":"E-BTC-USDC","pricePrecision":1,"side":1,"multiplier":0.0001,"minOrderVolume":1,"type":"E","multiplierCoin":"BTC","contractId":236,"status":1})
    }

    // Delisted on 2026-06-24.
    fn aivora_ton_closed() -> Value {
        json!({"symbol":"E-TON-USDT","pricePrecision":4,"side":1,"multiplier":1.0,"type":"E","multiplierCoin":"TON","contractId":45,"status":0})
    }

    fn fameex_pepe() -> Value {
        json!({"symbol":"E-1000PEPE-USDT","pricePrecision":7,"side":1,"multiplier":1000.0,"type":"E","multiplierCoin":"1000PEPE","contractId":211,"status":1})
    }

    fn fameex_baba_in_usdt() -> Value {
        json!({"symbol":"E-BABA-USDT","pricePrecision":2,"side":1,"multiplier":0.02,"type":"E","multiplierCoin":"USDT","contractId":224,"status":1})
    }

    // The one row with side 0 in x.me's list, and it is closed.
    fn xme_pengu_side_zero() -> Value {
        json!({"symbol":"E-PENGU-USDT","pricePrecision":6,"side":0,"multiplier":1.0,"type":"E","multiplierCoin":"PENGU","contractId":181,"status":0})
    }

    fn koinbay(symbol: &str, kind: &str, side: i64, margin: &str, coin: &str, multiplier: f64, taker: f64) -> Value {
        json!({"symbol":symbol,"pricePrecision":1,"side":side,"multiplier":multiplier,"marginCoin":margin,"openMakerFee":0.00025,"type":kind,"closeTakerFee":taker,"multiplierCoin":coin,"openTakerFee":taker,"contractId":1,"status":1})
    }

    fn koinbay_rows() -> Value {
        json!([
            koinbay("E-BTC-USDT", "E", 1, "USDT", "BTC", 0.0001, 0.00075),
            koinbay("E-SSV-USDT", "E", 1, "USDT", "SSV", 0.1, 0.0005),
            koinbay("E-BSV-USDT", "E", 1, "USDT", "BSV", 0.01, 0.00075), // no trade since 2022, and absent from the config
            koinbay("E-BTC-USD", "E", 0, "BTC", "USD", 10.0, 0.00075), // inverse
            koinbay("S-BTC-USDT", "S", 1, "EXUSD", "BTC", 0.0001, 0.00075),
            koinbay("FILCOIN-BTC-USDT", "FILCOIN", 1, "FILCOIN", "BTC", 0.00001, 0.00075),
        ])
    }

    fn contracts(rows: Value) -> Vec<Contract> {
        serde_json::from_value(rows).unwrap()
    }

    fn scheduled(raws: &[&str]) -> HashSet<String> {
        raws.iter().map(|raw| raw.to_string()).collect()
    }

    // Rows of the web list captured on 2026-10-09, cut to the fields the schedule reads.
    fn public_info(rows: Value) -> Value {
        json!({"code":"0","msg":"Success","data":{"wsUrl":"wss://futuresws.x.me/kline-api/ws","marginCoinList":["USDT"],"contractList":rows}})
    }

    fn info_row(contract: &str, sub: &str, hours: i64, next: i64) -> Value {
        json!({"id":48,"contractName":contract,"symbol":contract.trim_start_matches("E-"),"contractSide":1,"multiplier":0.001,"capitalStartTime":0,"capitalFrequency":hours,"subSymbol":sub,"nextCapitalSettTime":next})
    }

    #[test]
    fn keeps_trading_linear_perpetuals_quoted_in_usdt_and_usdc_under_their_socket_names() {
        let rows = contracts(json!([aivora_btc(), aivora_btc_usdc(), aivora_ton_closed()]));

        let markets = parse(&AIVORA, &rows, &scheduled(&["e_btcusdt", "e_btcusdc", "e_tonusdt"]));

        assert_eq!(raw_ids(&markets), ["e_btcusdt", "e_btcusdc"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[1].quote, "USDC");
        assert!(markets.iter().all(|m| m.linear && m.contract_size == 0.0001 && m.price_scale == 1.0 && m.taker_ppm == 500));
    }

    #[test]
    fn drops_usdc_where_the_member_lists_only_usdt() {
        let rows = contracts(json!([aivora_btc_usdc()]));

        assert!(parse(&FAMEEX, &rows, &scheduled(&["e_btcusdc"])).is_empty());
    }

    #[test]
    fn keeps_a_bundle_name_as_its_base_with_its_multiplier_as_the_contract_size() {
        let rows = contracts(json!([fameex_pepe()]));

        let markets = parse(&FAMEEX, &rows, &scheduled(&["e_1000pepeusdt"]));

        assert_eq!(raw_ids(&markets), ["e_1000pepeusdt"]);
        assert_eq!(markets[0].base, "1000PEPE");
        assert_eq!(markets[0].contract_size, 1000.0);
        assert_eq!(markets[0].taker_ppm, 600);
    }

    #[test]
    fn skips_with_a_log_a_contract_sized_in_usdt_rather_than_its_base() {
        let (logs, _capture) = capture();
        let rows = contracts(json!([fameex_baba_in_usdt(), fameex_pepe()]));

        let markets = parse(&FAMEEX, &rows, &scheduled(&["e_babausdt", "e_1000pepeusdt"]));

        assert_eq!(raw_ids(&markets), ["e_1000pepeusdt"]);
        assert_eq!(logs.events("market_skipped")[0].text("market"), "E-BABA-USDT");
    }

    #[test]
    fn drops_a_closed_contract_with_side_zero() {
        let rows = contracts(json!([xme_pengu_side_zero()]));

        assert!(parse(&XME, &rows, &scheduled(&["e_penguusdt"])).is_empty());
    }

    #[test]
    fn keeps_koinbay_usdt_contracts_the_config_lists_and_drops_the_inverse_the_odd_btc_and_the_ghosts() {
        let (logs, _capture) = capture();
        let rows = contracts(koinbay_rows());

        let markets = parse(&KOINBAY, &rows, &scheduled(&["e_btcusdt", "e_ssvusdt", "e_btcusd"]));

        assert_eq!(raw_ids(&markets), ["e_btcusdt", "e_ssvusdt"]);
        let unscheduled = logs.events("markets_unscheduled");
        assert_eq!(unscheduled[0].number("count"), 1.0);
    }

    #[test]
    fn scales_koinbay_shib_and_pepe_which_quote_a_thousand_tokens() {
        let rows = contracts(json!([
            koinbay("E-SHIB-USDT", "E", 1, "USDT", "SHIB", 100.0, 0.0005),
            koinbay("E-PEPE-USDT", "E", 1, "USDT", "PEPE", 500.0, 0.0005),
            koinbay("E-BTC-USDT", "E", 1, "USDT", "BTC", 0.0001, 0.00075),
        ]));

        let markets = parse(&KOINBAY, &rows, &scheduled(&["e_shibusdt", "e_pepeusdt", "e_btcusdt"]));

        let scales: Vec<(f64, f64)> = markets.iter().map(|m| (m.price_scale, m.contract_size)).collect();
        assert_eq!(scales, [(0.001, 100.0), (0.001, 500.0), (1.0, 0.0001)]);
    }

    #[test]
    fn reads_the_koinbay_taker_of_each_contract() {
        let rows = contracts(koinbay_rows());

        let markets = parse(&KOINBAY, &rows, &scheduled(&["e_btcusdt", "e_ssvusdt"]));

        assert_eq!(markets[0].taker_ppm, 750);
        assert_eq!(markets[1].taker_ppm, 500);
        assert_eq!(markets[1].contract_size, 0.1);
    }

    #[test]
    fn falls_back_to_the_profile_taker_when_a_row_states_none() {
        assert_eq!(taker_ppm(f64::NAN, 750), 750);
        assert_eq!(taker_ppm(0.0, 600), 600);
        assert_eq!(taker_ppm(0.0005, 750), 500);
    }

    #[test]
    fn the_socket_name_lowercases_and_keeps_one_underscore() {
        assert_eq!(socket_name("E-BTC-USDT"), "e_btcusdt");
        assert_eq!(socket_name("E-1000PEPE-USDT"), "e_1000pepeusdt");
        assert_eq!(socket_name("E-1MBABYDOGE-USDT"), "e_1mbabydogeusdt");
        assert_eq!(socket_name("E-BTC-USDC"), "e_btcusdc");
    }

    #[test]
    fn the_depth_step_is_one_tick_written_with_its_decimals() {
        assert_eq!(depth_step(1), "0.1");
        assert_eq!(depth_step(2), "0.01");
        assert_eq!(depth_step(4), "0.0001");
        assert_eq!(depth_step(10), "0.0000000001");
        assert_eq!(depth_step(0), "1");
    }

    #[tokio::test]
    async fn loads_from_the_contracts_and_the_web_list_and_counts_every_row() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, json!([aivora_btc(), aivora_btc_usdc(), aivora_ton_closed()]));
        rest.reply("/public_info_v2", public_info(json!([info_row("E-BTC-USDT", "e_btcusdt", 8, 1791590400000_i64)])));

        let venue = load_from(&AIVORA, &http(), &rest.url, &format!("{}/public_info_v2", rest.url)).await.unwrap();

        assert_eq!(venue.id, "aivora");
        assert_eq!(venue.name, "Aivora Exchange");
        assert_eq!(raw_ids(&venue.markets), ["e_btcusdt"]);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 3.0);
    }

    #[tokio::test]
    async fn fameex_denies_qcom_whose_book_does_not_trade() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        let mut qcom = fameex_pepe();
        qcom["symbol"] = json!("E-QCOM-USDT");
        qcom["multiplierCoin"] = json!("QCOM");
        rest.reply(CONTRACTS_PATH, json!([qcom, fameex_pepe()]));
        rest.reply(
            "/public_info",
            public_info(json!([info_row("E-QCOM-USDT", "e_qcomusdt", 4, 0), info_row("E-1000PEPE-USDT", "e_1000pepeusdt", 4, 0)])),
        );

        let venue = load_from(&FAMEEX, &http(), &rest.url, &format!("{}/public_info", rest.url)).await.unwrap();

        assert_eq!(raw_ids(&venue.markets), ["e_1000pepeusdt"]);
        assert_eq!(logs.events("market_denied")[0].text("market"), "e_qcomusdt");
    }

    #[tokio::test]
    async fn records_the_depth_step_of_each_aivora_contract() {
        let rest = MockRest::start().await;
        let mut row = aivora_btc();
        row["symbol"] = json!("E-STEPTEST-USDT");
        row["multiplierCoin"] = json!("STEPTEST");
        row["pricePrecision"] = json!(4);
        rest.reply(CONTRACTS_PATH, json!([row]));
        rest.reply("/public_info_v2", public_info(json!([info_row("E-STEPTEST-USDT", "e_steptestusdt", 8, 0)])));

        load_from(&AIVORA, &http(), &rest.url, &format!("{}/public_info_v2", rest.url)).await.unwrap();

        assert_eq!(depth_step_of("aivora", "e_steptestusdt").as_deref(), Some("0.0001"));
        assert_eq!(depth_step_of("fameex", "e_steptestusdt"), None);
    }

    #[tokio::test]
    async fn loads_koinbay_with_its_config_as_the_schedule() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, koinbay_rows());
        rest.reply(
            "/v1/inner/contract_config",
            json!({"code":"0","msg":"Success","data":{"contractList":[
                {"id":1,"contractName":"E-BTC-USDT","symbol":"BTC-USDT","contractSide":1,"multiplier":0.0001,"marginCoin":"USDT","capitalStartTime":0,"capitalFrequency":8,"status":1},
                {"id":114,"contractName":"E-SSV-USDT","symbol":"SSV-USDT","contractSide":1,"multiplier":0.1,"marginCoin":"USDT","capitalStartTime":0,"capitalFrequency":8,"status":1}
            ]}}),
        );

        let venue = load_from(&KOINBAY, &http(), &rest.url, &format!("{}/v1/inner/contract_config", rest.url)).await.unwrap();

        assert_eq!(raw_ids(&venue.markets), ["e_btcusdt", "e_ssvusdt"]);
    }

    #[tokio::test]
    async fn fails_when_the_schedule_answers_an_error_code() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, json!([aivora_btc()]));
        rest.reply("/public_info", json!({"code":"200004","msg":"Invalid parameters","data":null,"succ":false}));

        assert!(load_from(&XME, &http(), &rest.url, &format!("{}/public_info", rest.url)).await.is_err());
    }

    #[tokio::test]
    async fn fails_when_the_contracts_call_answers_an_error_object() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, json!({"code":"-1002","data":null,"msg":"UNAUTHORIZED","succ":false}));
        rest.reply("/public_info", public_info(json!([])));

        assert!(load_from(&XME, &http(), &rest.url, &format!("{}/public_info", rest.url)).await.is_err());
    }

    #[tokio::test]
    async fn the_schedule_reads_interval_and_next_settlement_and_names_each_row_by_its_socket_name() {
        let rest = MockRest::start().await;
        let mut hourly = info_row("E-G-USDT", "e_gusdt", 1, 1791579600000_i64);
        hourly["capitalFrequencyUnit"] = json!("h");
        let mut minutes = info_row("E-M-USDT", "e_musdt", 30, 0);
        minutes["capitalFrequencyUnit"] = json!("m");
        let mut unknown_unit = info_row("E-D-USDT", "e_dusdt", 1, 0);
        unknown_unit["capitalFrequencyUnit"] = json!("d");
        let mut no_sub = info_row("E-ETH-USDT", "", 4, 0);
        no_sub.as_object_mut().unwrap().remove("nextCapitalSettTime");
        rest.reply("/public_info", public_info(json!([hourly, minutes, unknown_unit, no_sub])));

        let rows = read_schedule(&http(), XME.schedule, &format!("{}/public_info", rest.url)).await.unwrap();

        assert_eq!(
            rows,
            [
                ScheduleRow { raw: "e_gusdt".into(), contract: "E-G-USDT".into(), interval_hours: 1.0, next_at: 1791579600000 },
                ScheduleRow { raw: "e_musdt".into(), contract: "E-M-USDT".into(), interval_hours: 0.5, next_at: 0 },
                ScheduleRow { raw: "e_ethusdt".into(), contract: "E-ETH-USDT".into(), interval_hours: 4.0, next_at: 0 },
            ]
        );
    }

    #[tokio::test]
    async fn the_config_schedule_leaves_out_a_contract_that_is_not_status_one() {
        let rest = MockRest::start().await;
        rest.reply(
            "/v1/inner/contract_config",
            json!({"code":"0","msg":"Success","data":{"contractList":[
                {"contractName":"E-BTC-USDT","capitalFrequency":8,"status":1},
                {"contractName":"E-ZIL-USDT","capitalFrequency":8,"status":0}
            ]}}),
        );

        let rows = read_schedule(&http(), KOINBAY.schedule, &format!("{}/v1/inner/contract_config", rest.url)).await.unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].raw, "e_btcusdt");
    }
}
