// The anchor fields of a venue that publishes them only on its socket.
// The venue's handle writes each field as its frame arrives, and its fetch_round returns rows(), so the poller checks and sends them like any REST round.
// A row stays out until every field the venue publishes has arrived, so the poller never logs a half filled row as rejected.

use crate::feeds::anchor_poller::{AnchorMap, AnchorRow};
use std::collections::HashMap;
use std::sync::Mutex;

pub struct SocketAnchors {
    publishes_mark: bool,
    partials: Mutex<HashMap<String, Partial>>, // <raw market id, fields so far>
}

struct Partial {
    index: f64,
    index_at: i64,
    mark: f64,
    mark_at: i64,
    funding_rate: f64,
    funding_interval_hours: f64,
    next_funding_at: i64, // Unix ms, 0 = unknown
}

impl Default for Partial {
    fn default() -> Self {
        Self {
            index: f64::NAN,
            index_at: 0,
            mark: f64::NAN,
            mark_at: 0,
            funding_rate: f64::NAN,
            funding_interval_hours: f64::NAN,
            next_funding_at: 0,
        }
    }
}

impl SocketAnchors {
    pub fn new(publishes_mark: bool) -> Self {
        Self {
            publishes_mark,
            partials: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_index(&self, raw_market_id: &str, index: f64, at: i64) {
        self.with_partial(raw_market_id, |partial| {
            partial.index = index;
            partial.index_at = at;
        });
    }

    pub fn set_mark(&self, raw_market_id: &str, mark: f64, at: i64) {
        self.with_partial(raw_market_id, |partial| {
            partial.mark = mark;
            partial.mark_at = at;
        });
    }

    pub fn set_funding(&self, raw_market_id: &str, rate: f64, interval_hours: f64, next_funding_at: i64) {
        self.with_partial(raw_market_id, |partial| {
            partial.funding_rate = rate;
            partial.funding_interval_hours = interval_hours;
            partial.next_funding_at = next_funding_at;
        });
    }

    // A row's ts is the older of its index and mark arrivals, so a row is never fresher than its stalest price.
    pub fn rows(&self) -> AnchorMap {
        let partials = self.partials.lock().unwrap();
        partials
            .iter()
            .filter_map(|(raw_market_id, partial)| Some((raw_market_id.clone(), self.row(partial)?)))
            .collect()
    }

    fn row(&self, partial: &Partial) -> Option<AnchorRow> {
        let index_ok = partial.index.is_finite() && partial.index > 0.0;
        let funding_ok = partial.funding_rate.is_finite()
            && partial.funding_interval_hours.is_finite()
            && partial.funding_interval_hours > 0.0;
        if !index_ok || !funding_ok {
            return None;
        }

        let (mark, ts) = if self.publishes_mark {
            if !partial.mark.is_finite() || partial.mark < 0.0 {
                return None;
            }
            (partial.mark, partial.index_at.min(partial.mark_at))
        } else {
            (0.0, partial.index_at)
        };

        Some(AnchorRow {
            index: partial.index,
            mark,
            funding_rate: partial.funding_rate,
            funding_interval_hours: partial.funding_interval_hours,
            next_funding_at: partial.next_funding_at,
            ts: Some(ts),
        })
    }

    fn with_partial(&self, raw_market_id: &str, write: impl FnOnce(&mut Partial)) {
        let mut partials = self.partials.lock().unwrap();
        if let Some(partial) = partials.get_mut(raw_market_id) {
            write(partial);
        } else {
            let mut partial = Partial::default();
            write(&mut partial);
            partials.insert(raw_market_id.to_string(), partial);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete(anchors: &SocketAnchors) {
        anchors.set_index("BTC-PERP", 80_000.0, 1_000);
        anchors.set_mark("BTC-PERP", 80_010.0, 2_000);
        anchors.set_funding("BTC-PERP", 0.0001, 8.0, 1_790_841_600_000);
    }

    #[test]
    fn an_incomplete_row_is_left_out_until_its_last_field_arrives() {
        let anchors = SocketAnchors::new(true);

        anchors.set_index("BTC-PERP", 80_000.0, 1_000);
        assert!(anchors.rows().is_empty());
        anchors.set_mark("BTC-PERP", 80_010.0, 2_000);
        assert!(anchors.rows().is_empty());
        anchors.set_funding("BTC-PERP", 0.0001, 8.0, 1_790_841_600_000);

        assert_eq!(
            anchors.rows()["BTC-PERP"],
            AnchorRow {
                index: 80_000.0,
                mark: 80_010.0,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: 1_790_841_600_000,
                ts: Some(1_000),
            }
        );
    }

    #[test]
    fn a_funding_row_alone_or_a_mark_without_an_index_is_left_out() {
        let anchors = SocketAnchors::new(true);

        anchors.set_funding("BTC-PERP", 0.0001, 8.0, 0);
        anchors.set_mark("BTC-PERP", 80_010.0, 2_000);

        assert!(anchors.rows().is_empty());
    }

    #[test]
    fn a_bad_value_keeps_the_row_out() {
        let anchors = SocketAnchors::new(true);
        complete(&anchors);

        anchors.set_index("BTC-PERP", 0.0, 3_000);
        assert!(anchors.rows().is_empty());
        anchors.set_index("BTC-PERP", 80_000.0, 3_000);
        anchors.set_mark("BTC-PERP", f64::NAN, 3_000);
        assert!(anchors.rows().is_empty());
        anchors.set_mark("BTC-PERP", 80_010.0, 3_000);
        anchors.set_funding("BTC-PERP", 0.0001, 0.0, 0);
        assert!(anchors.rows().is_empty());
        anchors.set_funding("BTC-PERP", f64::NAN, 8.0, 0);
        assert!(anchors.rows().is_empty());
    }

    #[test]
    fn ts_is_the_older_arrival_of_index_and_mark() {
        let anchors = SocketAnchors::new(true);
        complete(&anchors);
        assert_eq!(anchors.rows()["BTC-PERP"].ts, Some(1_000));

        anchors.set_index("BTC-PERP", 80_000.0, 5_000);

        assert_eq!(anchors.rows()["BTC-PERP"].ts, Some(2_000));
    }

    #[test]
    fn a_venue_without_a_mark_sends_mark_zero_with_the_index_arrival() {
        let anchors = SocketAnchors::new(false);

        anchors.set_index("BTC-PERP", 80_000.0, 4_000);
        anchors.set_funding("BTC-PERP", -0.0002, 1.0, 0);
        let row = anchors.rows()["BTC-PERP"];

        assert_eq!(row.mark, 0.0);
        assert_eq!(row.ts, Some(4_000));
        assert_eq!(row.next_funding_at, 0);
    }

    #[test]
    fn a_later_value_overwrites_only_its_own_fields() {
        let anchors = SocketAnchors::new(true);
        complete(&anchors);

        anchors.set_mark("BTC-PERP", 80_020.0, 3_000);
        anchors.set_funding("BTC-PERP", 0.0003, 4.0, 1_790_856_000_000);
        let row = anchors.rows()["BTC-PERP"];

        assert_eq!(row.index, 80_000.0);
        assert_eq!(row.mark, 80_020.0);
        assert_eq!(row.funding_rate, 0.0003);
        assert_eq!(row.funding_interval_hours, 4.0);
        assert_eq!(row.next_funding_at, 1_790_856_000_000);
        assert_eq!(row.ts, Some(1_000));
    }

    #[test]
    fn rows_is_a_copy() {
        let anchors = SocketAnchors::new(true);
        complete(&anchors);

        let rows = anchors.rows();
        anchors.set_index("BTC-PERP", 90_000.0, 9_000);
        anchors.set_index("ETH-PERP", 3_000.0, 9_000);

        assert_eq!(rows.len(), 1);
        assert_eq!(rows["BTC-PERP"].index, 80_000.0);
        assert_eq!(anchors.rows()["BTC-PERP"].index, 90_000.0);
    }

    #[test]
    fn markets_are_kept_apart() {
        let anchors = SocketAnchors::new(false);

        anchors.set_index("BTC-PERP", 80_000.0, 1_000);
        anchors.set_funding("ETH-PERP", 0.0001, 8.0, 0);

        assert!(anchors.rows().is_empty());
    }
}
