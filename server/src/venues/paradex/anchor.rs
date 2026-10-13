use super::Paradex;
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use std::time::{Duration, Instant};

// A socket's last summary is subscribed about 4 s after it opens and every funding period has arrived within 5 s, so the rows fill well inside this.
pub(super) const WARMUP: Duration = Duration::from_secs(15);

// REST summaries are 5 s snapshots that land 1 to 8 s old, so the book sockets subscribe the summaries and handle fills the rows.
// A round makes no request, so the poller's rate limit pause never applies.
impl AnchorVenue for Paradex {
    async fn fetch_round(&self, _http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let rows = self.anchors.rows();

        // The first rounds run before the sockets open, and a round that fails whole logs one line where 66 missing rows would log one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.tracked && first_round.elapsed() < WARMUP {
            anyhow::bail!("warming up, {} of {} markets have their index, mark and funding", rows.len(), self.tracked);
        }

        Ok(rows)
    }
}
