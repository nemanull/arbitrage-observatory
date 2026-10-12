use super::{ID, SOCKET_URL, subscribe};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use anyhow::Context;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::time::Duration;
use tokio::time::timeout;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

const NAME: &str = "Tothemoon";

// The one published perpetual rate, 0.05 % maker and taker at every volume.
const TAKER_PPM: u32 = 500;

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

// No REST call lists the perpetuals, so the catalog is the one frame of this channel, which the web app reads.
const INSTRUMENTS_CHANNEL: &str = "turboFutureInstruments.*";
const INSTRUMENTS_REQUEST: &str = "instruments";

// Halt flags per instrument and for the whole system, one frame on subscribe.
const EMERGENCY_CHANNEL: &str = "turboEmergencyMode.*";
const EMERGENCY_REQUEST: &str = "emergency";

// The socket opened in under a second and each frame came about 160 ms after its subscribe on 2026-10-09.
const CATALOG_WAIT: Duration = Duration::from_secs(15);

// No market's ticker names another token, by live_identity on 2026-10-09.
const DENIED: &[(&str, &str)] = &[];

pub async fn load(_http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(SOCKET_URL).await
}

async fn load_from(url: &str) -> anyhow::Result<Venue> {
    let (instruments, emergency) = timeout(CATALOG_WAIT, read_catalog(url))
        .await
        .with_context(|| format!("{ID} sent no catalog within {} s", CATALOG_WAIT.as_secs()))??;
    let markets = parse(&instruments, &emergency);
    catalog::finish(ID, NAME, instruments.len(), markets, DENIED)
}

// Opens the socket, reads one frame of each catalog channel, and closes it.
async fn read_catalog(url: &str) -> anyhow::Result<(BTreeMap<String, Instrument>, Emergency)> {
    let (mut ws, _response) = connect_async(url).await.with_context(|| format!("{ID} catalog socket failed to open"))?;
    ws.send(subscribe(INSTRUMENTS_CHANNEL, INSTRUMENTS_REQUEST)).await?;
    ws.send(subscribe(EMERGENCY_CHANNEL, EMERGENCY_REQUEST)).await?;

    let mut instruments = None;
    let mut emergency = None;
    while instruments.is_none() || emergency.is_none() {
        let message = ws.next().await.with_context(|| format!("{ID} catalog socket closed"))??;
        let text = match message {
            Message::Text(text) => text,
            Message::Close(close) => anyhow::bail!("{ID} catalog socket closed: {close:?}"),
            _ => continue,
        };

        let frame: Frame = serde_json::from_str(text.as_str())?;
        let payload = frame.payload.unwrap_or_default();
        match frame.kind.as_str() {
            "errorMessage" => anyhow::bail!(
                "{ID} catalog socket answered {}: {}",
                payload.code.unwrap_or_default(),
                payload.message.unwrap_or_default()
            ),
            "subscriptionData" => {}
            _ => continue,
        }

        let data = payload.data.with_context(|| format!("{ID} sent no data on {}", payload.channel))?;
        if payload.channel == INSTRUMENTS_CHANNEL {
            let catalog: Instruments = serde_json::from_value(data)?;
            instruments = Some(catalog.instruments);
        } else if payload.channel == EMERGENCY_CHANNEL {
            emergency = Some(serde_json::from_value(data)?);
        }
    }

    let _ = ws.close(None).await;
    Ok((instruments.unwrap_or_default(), emergency.unwrap_or_default()))
}

// Keeps the enabled USDT, USDC or USD margined perpetuals, which are linear, and leaves out any the emergency map halts.
fn parse(instruments: &BTreeMap<String, Instrument>, emergency: &Emergency) -> Vec<Market> {
    let mut markets = Vec::new();

    for (raw_market_id, row) in instruments {
        if !row.is_enabled || row.expiration_date != 0 {
            continue;
        }

        let quote = currency_code(&row.counter, &[]);
        if !QUOTES.contains(&quote.as_str()) || row.margin_currency.to_uppercase() != quote {
            continue;
        }

        if emergency.enabled_for_system || emergency.enabled_for_instruments.get(raw_market_id).copied().unwrap_or(false) {
            tracing::warn!(event = "market_skipped", venue = ID, market = %raw_market_id, reason = "emergency mode");
            continue;
        }

        // The gold contract is XAU_USDT_PERPETUAL on the XAUT token, which contract_currency names.
        let coin = if row.contract_currency.is_empty() { &row.base } else { &row.contract_currency };
        let base = currency_code(coin, &[]);
        if base.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: raw_market_id.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.contract_size), // the book's sizes are contracts of this many coins
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Frame {
    #[serde(rename = "type")]
    kind: String,
    payload: Option<Payload>,
}

#[derive(Deserialize, Default)]
struct Payload {
    #[serde(default)]
    channel: String,
    data: Option<serde_json::Value>,
    code: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct Instruments {
    #[serde(default)]
    instruments: BTreeMap<String, Instrument>, // <instrument_id, row>, which is the id of the book channel and the ticker
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    base: String, // "XAU" on the gold contract until at least 2026-09-23, "XAUT" on 2026-10-09
    #[serde(default)]
    contract_currency: String, // "XAUT" on the gold contract
    #[serde(default)]
    counter: String, // "USDT" on every perpetual
    #[serde(default)]
    margin_currency: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_size: f64, // "0.000001" on BTC
    #[serde(default)]
    is_enabled: bool,
    #[serde(default)]
    expiration_date: i64, // 0 on a perpetual
}

#[derive(Deserialize, Default)]
struct Emergency {
    #[serde(default)]
    enabled_for_system: bool,
    #[serde(default)]
    enabled_for_instruments: HashMap<String, bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::raw_ids;
    use serde_json::{Value, json};
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    // Rows captured live from turboFutureInstruments.* on 2026-10-09.
    fn btc() -> Value {
        json!({"is_enabled":true,"name":"BTC_USDT_PERPETUAL","instrument_id":"BTC_USDT_PERPETUAL","pair":"BTC_USDT","base":"BTC","counter":"USDT",
            "contract_size":"0.000001","price_step":"0.1","reversed":true,"funding_disabled":true,"expiration_date":0,"default_leverage":"0",
            "margin_currency":"USDT","order_index":0,"price_precision":1,"contract_currency":"BTC"})
    }

    fn xau() -> Value {
        json!({"is_enabled":true,"name":"XAU_USDT_PERPETUAL","instrument_id":"XAU_USDT_PERPETUAL","pair":"XAUT_USDT","base":"XAUT","counter":"USDT",
            "contract_size":"0.01","price_step":"0.01","reversed":true,"funding_disabled":true,"expiration_date":0,"default_leverage":"0",
            "margin_currency":"USDT","order_index":0,"price_precision":2,"contract_currency":"XAUT"})
    }

    fn doge() -> Value {
        json!({"is_enabled":true,"name":"DOGE_USDT_PERPETUAL","instrument_id":"DOGE_USDT_PERPETUAL","pair":"DOGE_USDT","base":"DOGE","counter":"USDT",
            "contract_size":"0.01","price_step":"0.00001","reversed":true,"funding_disabled":true,"expiration_date":0,"default_leverage":"0",
            "margin_currency":"USDT","order_index":0,"price_precision":5,"contract_currency":"DOGE"})
    }

    // Every row was enabled on 2026-10-09, so this is the ETH capture with is_enabled false.
    fn disabled_eth() -> Value {
        json!({"is_enabled":false,"name":"ETH_USDT_PERPETUAL","instrument_id":"ETH_USDT_PERPETUAL","pair":"ETH_USDT","base":"ETH","counter":"USDT",
            "contract_size":"0.00001","expiration_date":0,"margin_currency":"USDT","contract_currency":"ETH"})
    }

    // The retired coin margined BTC_PERPETUAL, which survives only in the emergency map, as a row of its old shape.
    fn coin_margined() -> Value {
        json!({"is_enabled":true,"name":"BTC_PERPETUAL","instrument_id":"BTC_PERPETUAL","pair":"BTC_USD","base":"BTC","counter":"USD",
            "contract_size":"1","expiration_date":0,"margin_currency":"BTC","contract_currency":"USD"})
    }

    // The retired BTC_U22 dated future, as a row of the same shape.
    fn dated() -> Value {
        json!({"is_enabled":true,"name":"BTC_U22","instrument_id":"BTC_U22","pair":"BTC_USDT","base":"BTC","counter":"USDT",
            "contract_size":"0.000001","expiration_date":1664524800000_i64,"margin_currency":"USDT","contract_currency":"BTC"})
    }

    fn rows(rows: Value) -> BTreeMap<String, Instrument> {
        serde_json::from_value(rows).unwrap()
    }

    fn calm() -> Emergency {
        Emergency::default()
    }

    // The frames of 2026-10-09, cut to the rows a case needs.
    fn instruments_frame(instruments: Value) -> Value {
        json!({"type":"subscriptionData","server_timestamp":1791576031895_i64,"request_id":"instruments","payload":{
            "channel":"turboFutureInstruments.*","data":{"offset":0,"provider_offset":0,"instruments":instruments}}})
    }

    fn emergency_frame(halted: bool) -> Value {
        json!({"type":"subscriptionData","server_timestamp":1791576032146_i64,"request_id":"emergency","payload":{
            "channel":"turboEmergencyMode.*","data":{"offset":630544171873_i64,"provider_offset":127580432632_i64,"enabled_for_system":false,
            "enabled_for_instruments":{"BTC_USDT_PERPETUAL":halted,"BTC_PERPETUAL":false,"BTC_U22":false,"XAU_USDT_PERPETUAL":false}}}})
    }

    // A local socket that answers each subscribe with the frames the case gives for its channel, after the welcome the venue sends.
    async fn octopus(answers: Vec<(&'static str, Vec<Value>)>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = accept_async(stream).await.unwrap();
            let welcome = json!({"type":"welcomeMessage","server_timestamp":1791576031744_i64,"payload":{"message":"[prod] Welcome to Cryptology!","connection_id":"6f207b9d"}});
            ws.send(Message::text(welcome.to_string())).await.unwrap();
            while let Some(Ok(Message::Text(text))) = ws.next().await {
                let request: Value = serde_json::from_str(text.as_str()).unwrap();
                for (channel, frames) in &answers {
                    if request["channel"] == *channel {
                        for frame in frames {
                            ws.send(Message::text(frame.to_string())).await.unwrap();
                        }
                    }
                }
            }
        });
        url
    }

    fn ack(channel: &str, request_id: &str) -> Value {
        json!({"type":"subscribedSuccessful","server_timestamp":1791576031895_i64,"request_id":request_id,"payload":{"channel":channel}})
    }

    #[test]
    fn keeps_enabled_usdt_perpetuals_as_linear_contracts_of_their_coin_fraction() {
        let markets = parse(
            &rows(json!({
                "BTC_USDT_PERPETUAL": btc(), "DOGE_USDT_PERPETUAL": doge(), "ETH_USDT_PERPETUAL": disabled_eth(),
                "BTC_PERPETUAL": coin_margined(), "BTC_U22": dated(), "XAU_USDT_PERPETUAL": xau(),
            })),
            &calm(),
        );

        assert_eq!(raw_ids(&markets), ["BTC_USDT_PERPETUAL", "DOGE_USDT_PERPETUAL", "XAU_USDT_PERPETUAL"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[0].contract_size, 0.000001);
        assert_eq!(markets[1].contract_size, 0.01);
        assert!(markets.iter().all(|m| m.linear && m.price_scale == 1.0 && m.taker_ppm == 500));
    }

    #[test]
    fn names_the_gold_contract_by_its_contract_currency_xaut() {
        let mut gold = xau();
        gold["base"] = json!("XAU"); // as the catalog spelled it on 2026-09-23

        let markets = parse(&rows(json!({ "XAU_USDT_PERPETUAL": gold })), &calm());

        assert_eq!(markets[0].base, "XAUT");
    }

    #[test]
    fn falls_back_to_base_when_contract_currency_is_missing() {
        let mut row = btc();
        row.as_object_mut().unwrap().remove("contract_currency");

        assert_eq!(parse(&rows(json!({ "BTC_USDT_PERPETUAL": row })), &calm())[0].base, "BTC");
    }

    #[test]
    fn drops_a_contract_margined_in_another_currency_than_its_quote() {
        let mut row = btc();
        row["margin_currency"] = json!("BTC");

        assert!(parse(&rows(json!({ "BTC_USDT_PERPETUAL": row })), &calm()).is_empty());
    }

    #[test]
    fn skips_with_a_warning_a_market_the_emergency_map_halts_or_every_market_when_the_system_is_halted() {
        let (logs, _capture) = capture();
        let catalog = rows(json!({ "BTC_USDT_PERPETUAL": btc(), "DOGE_USDT_PERPETUAL": doge() }));
        let mut emergency = Emergency::default();
        emergency.enabled_for_instruments.insert("BTC_USDT_PERPETUAL".to_string(), true);

        assert_eq!(raw_ids(&parse(&catalog, &emergency)), ["DOGE_USDT_PERPETUAL"]);
        assert_eq!(logs.events("market_skipped")[0].text("market"), "BTC_USDT_PERPETUAL");

        emergency.enabled_for_system = true;
        assert!(parse(&catalog, &emergency).is_empty());
    }

    #[tokio::test]
    async fn loads_the_catalog_from_the_socket_and_counts_every_row() {
        let (logs, _capture) = capture();
        let url = octopus(vec![
            (
                INSTRUMENTS_CHANNEL,
                vec![
                    ack(INSTRUMENTS_CHANNEL, INSTRUMENTS_REQUEST),
                    instruments_frame(json!({ "BTC_USDT_PERPETUAL": btc(), "BTC_U22": dated(), "XAU_USDT_PERPETUAL": xau() })),
                ],
            ),
            (EMERGENCY_CHANNEL, vec![ack(EMERGENCY_CHANNEL, EMERGENCY_REQUEST), emergency_frame(false)]),
        ])
        .await;

        let venue = load_from(&url).await.unwrap();

        assert_eq!(venue.id, "tothemoon");
        assert_eq!(venue.name, "Tothemoon");
        assert_eq!(raw_ids(&venue.markets), ["BTC_USDT_PERPETUAL", "XAU_USDT_PERPETUAL"]);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 3.0);
    }

    #[tokio::test]
    async fn applies_the_emergency_flags_read_on_the_same_socket() {
        let (_logs, _capture) = capture();
        let url = octopus(vec![
            (INSTRUMENTS_CHANNEL, vec![instruments_frame(json!({ "BTC_USDT_PERPETUAL": btc(), "XAU_USDT_PERPETUAL": xau() }))]),
            (EMERGENCY_CHANNEL, vec![emergency_frame(true)]),
        ])
        .await;

        let venue = load_from(&url).await.unwrap();

        assert_eq!(raw_ids(&venue.markets), ["XAU_USDT_PERPETUAL"]);
    }

    #[tokio::test]
    async fn fails_on_an_error_frame() {
        let error = json!({"type":"errorMessage","server_timestamp":1791576294228_i64,"request_id":"instruments","payload":{
            "code":"COMMON_ERROR","message":"invalid request params: invalid channel turboFutureInstruments"}});
        let url = octopus(vec![(INSTRUMENTS_CHANNEL, vec![error])]).await;

        let failure = load_from(&url).await.unwrap_err();

        assert!(format!("{failure:#}").contains("COMMON_ERROR"));
    }

    #[tokio::test]
    async fn fails_on_a_null_catalog() {
        let null = json!({"type":"subscriptionData","server_timestamp":1791576295315_i64,"request_id":"instruments","payload":{
            "channel":"turboFutureInstruments.*","data":null,"nonce":1}});
        let url = octopus(vec![(INSTRUMENTS_CHANNEL, vec![null]), (EMERGENCY_CHANNEL, vec![emergency_frame(false)])]).await;

        assert!(load_from(&url).await.is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn fails_when_the_catalog_never_comes() {
        let url = octopus(vec![(EMERGENCY_CHANNEL, vec![emergency_frame(false)])]).await;

        let failure = load_from(&url).await.unwrap_err();

        assert!(format!("{failure:#}").contains("sent no catalog within 15 s"));
    }

    #[tokio::test]
    async fn fails_when_the_socket_does_not_open() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        drop(listener);

        assert!(load_from(&url).await.is_err());
    }
}
