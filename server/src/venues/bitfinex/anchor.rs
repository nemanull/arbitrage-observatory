use super::Bitfinex;
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use std::time::Duration;

// Bitfinex publishes no index apart from its mark, which is the BFX Composite Index itself, see docs/profiles/bitfinex/rest.md section 4.
// A mark copied into the index would read a standing Bitfinex basis as fresh edge, so every row is left out and the engine refuses the venue's routes.
// The status call /v2/status/deriv?keys=ALL carries the mark, the funding rate and the next settlement for the day an engine takes a row without an index.
impl AnchorVenue for Bitfinex {
    // No round can yield a row, so the poller only keeps that failure in the log, and it sends no request.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(60)
    }

    async fn fetch_round(&self, _http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        anyhow::bail!("{} publishes no index, so its anchor rows are left out", super::ID)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::http;

    #[tokio::test]
    async fn fails_every_round_once_a_minute_because_the_venue_publishes_no_index() {
        let error = Bitfinex::new().fetch_round(&http(), 1).await.unwrap_err();

        assert!(error.to_string().contains("no index"), "{error:#}");
        assert_eq!(Bitfinex::new().poll_every(), Duration::from_secs(60));
    }
}
