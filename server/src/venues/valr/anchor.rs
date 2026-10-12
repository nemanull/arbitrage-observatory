use super::Valr;
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use std::time::Duration;

// VALR publishes no index on any call or socket event, see docs/profiles/valr/rest.md section 3.
// A mark copied into the index would read a standing VALR basis as fresh edge, so decision 19 leaves every row out and the engine refuses the venue's routes.
// For the day an engine takes a row without an index, the mark is markPrice of /v1/public/marketsummary or MARK_PRICE_UPDATE on the book socket every 3 s.
// The funding is estimatedFundingRate, a fraction per hour, with nextFundingRun in Unix ms, both on /v1/public/futures/info, and the interval is a constant hour.
// Every /v1/public/* call shares a limit of 30 a minute.
impl AnchorVenue for Valr {
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
        let error = Valr::new().fetch_round(&http(), 1).await.unwrap_err();

        assert!(error.to_string().contains("no index"), "{error:#}");
        assert_eq!(Valr::new().poll_every(), Duration::from_secs(60));
    }
}
