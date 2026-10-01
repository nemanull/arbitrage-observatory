// Shared by the venue tests: market builders and a local REST host that stands in for a venue's API.

use crate::engine::cluster::Market;
use crate::engine::engine::Slot;
use crate::feeds::TrackedMarket;
use axum::Router;
use axum::http::header::CONTENT_TYPE;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;

pub fn market(venue_id: &str, raw_market_id: &str, base: &str, quote: &str, linear: bool) -> Market {
    Market {
        venue_id: venue_id.to_string(),
        raw_market_id: raw_market_id.to_string(),
        base: base.to_string(),
        quote: quote.to_string(),
        taker_ppm: 500,
        linear,
        contract_size: 1.0,
        price_scale: 1.0,
    }
}

// Market i sits in cluster i.
pub fn tracked(markets: &[Market]) -> Vec<TrackedMarket> {
    let mut tracked = Vec::with_capacity(markets.len());
    for (cluster, market) in markets.iter().enumerate() {
        tracked.push(TrackedMarket {
            market: market.clone(),
            slot: Slot { cluster, venue: 0 },
        });
    }
    tracked
}

pub fn raw_ids(markets: &[Market]) -> Vec<&str> {
    let mut ids = Vec::with_capacity(markets.len());
    for market in markets {
        ids.push(market.raw_market_id.as_str());
    }
    ids
}

// No proxy, so a request reaches the local host whatever the environment sets.
pub fn http() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[derive(Clone)]
struct Reply {
    status: StatusCode,
    body: String,
    delay: Duration,
}

#[derive(Clone, Default)]
struct Routes {
    replies: Arc<Mutex<HashMap<String, Reply>>>, // <"/fapi/v1/premiumIndex", reply>
    calls: Arc<Mutex<Vec<String>>>,
}

impl Routes {
    async fn answer(&self, uri: &Uri) -> Response {
        let key = uri.path_and_query().map_or(uri.path(), |p| p.as_str()).to_string();
        self.calls.lock().unwrap().push(key.clone());

        let reply = self.replies.lock().unwrap().get(&key).cloned();
        match reply {
            Some(reply) => {
                tokio::time::sleep(reply.delay).await;
                (reply.status, [(CONTENT_TYPE, "application/json")], reply.body).into_response()
            }
            None => (StatusCode::NOT_FOUND, format!("unexpected {key}")).into_response(),
        }
    }
}

// Answers each path and query with what the case set, 404 for anything else, and records every request in order.
pub struct MockRest {
    pub url: String, // "http://127.0.0.1:41234", which a venue takes as its REST base
    routes: Routes,
}

impl MockRest {
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let routes = Routes::default();
        let answering = routes.clone();
        let app = Router::new().fallback(move |uri: Uri| {
            let routes = answering.clone();
            async move { routes.answer(&uri).await }
        });
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        Self { url, routes }
    }

    pub fn reply(&self, path: &str, body: serde_json::Value) {
        self.answer(path, StatusCode::OK, body.to_string(), Duration::ZERO);
    }

    // Answers after the delay, so a case can order replies in time.
    pub fn reply_after(&self, path: &str, body: serde_json::Value, delay: Duration) {
        self.answer(path, StatusCode::OK, body.to_string(), delay);
    }

    // A request that stays open for as long as any case runs.
    pub fn hang(&self, path: &str) {
        self.answer(path, StatusCode::OK, String::new(), Duration::from_secs(3_600));
    }

    pub fn fail(&self, path: &str, status: u16) {
        self.answer(path, StatusCode::from_u16(status).unwrap(), String::new(), Duration::ZERO);
    }

    pub fn calls(&self) -> Vec<String> {
        self.routes.calls.lock().unwrap().clone()
    }

    fn answer(&self, path: &str, status: StatusCode, body: String, delay: Duration) {
        let reply = Reply { status, body, delay };
        self.routes.replies.lock().unwrap().insert(path.to_string(), reply);
    }
}
