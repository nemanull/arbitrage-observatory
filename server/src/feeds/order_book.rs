use crate::engine::cluster::BookLevel;

// Bids descend and asks ascend, so both sides start at the best level.
#[derive(Debug, Default, Clone)]
pub struct OrderBook {
    bids: Vec<BookLevel>,
    asks: Vec<BookLevel>,
}

impl OrderBook {
    pub fn reset(&mut self, bids: &[BookLevel], asks: &[BookLevel]) {
        self.bids.clear();
        self.asks.clear();

        for level in bids {
            self.set_bid(level.price, level.size);
        }

        for level in asks {
            self.set_ask(level.price, level.size);
        }
    }

    // A zero size removes the level, and an invalid price or size changes nothing and returns false.
    pub fn set_bid(&mut self, price: f64, size: f64) -> bool {
        set_level(&mut self.bids, price, size, Side::Bid)
    }

    pub fn set_ask(&mut self, price: f64, size: f64) -> bool {
        set_level(&mut self.asks, price, size, Side::Ask)
    }

    pub fn bids(&self) -> &[BookLevel] {
        &self.bids
    }

    pub fn asks(&self) -> &[BookLevel] {
        &self.asks
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Bid,
    Ask,
}

fn set_level(levels: &mut Vec<BookLevel>, price: f64, size: f64, side: Side) -> bool {
    if !price.is_finite() || price <= 0.0 || !size.is_finite() || size < 0.0 {
        return false;
    }

    // The first level that is not better than this price, which is where the price sits or belongs.
    let i = levels.partition_point(|level| match side {
        Side::Bid => level.price > price,
        Side::Ask => level.price < price,
    });
    let found = i < levels.len() && levels[i].price == price;

    if size == 0.0 {
        if found {
            levels.remove(i);
        }
        return true;
    }

    if found {
        levels[i].size = size;
    } else {
        levels.insert(i, BookLevel { price, size });
    }

    true
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/feeds/book/OrderBook.spec.ts.

    use super::*;
    use crate::engine::cluster::index_builder::DEPTH_LEVEL;
    use crate::engine::engine::Levels;

    fn level(price: f64, size: f64) -> BookLevel {
        BookLevel { price, size }
    }

    #[test]
    fn sorts_bids_descending_and_asks_ascending_whatever_order_they_arrive_in() {
        let mut book = OrderBook::default();

        book.reset(
            &[level(99.0, 1.0), level(101.0, 2.0), level(100.0, 3.0)],
            &[level(104.0, 1.0), level(102.0, 2.0), level(103.0, 3.0)],
        );

        assert_eq!(book.bids(), [level(101.0, 2.0), level(100.0, 3.0), level(99.0, 1.0)]);
        assert_eq!(book.asks(), [level(102.0, 2.0), level(103.0, 3.0), level(104.0, 1.0)]);
    }

    #[test]
    fn drops_zero_sizes_and_keeps_the_last_size_of_a_repeated_price() {
        let mut book = OrderBook::default();

        book.reset(&[level(100.0, 1.0), level(100.0, 5.0), level(99.0, 0.0)], &[]);

        assert_eq!(book.bids(), [level(100.0, 5.0)]);
        assert_eq!(book.asks().len(), 0);
    }

    #[test]
    fn replaces_the_previous_book_entirely() {
        let mut book = OrderBook::default();
        book.reset(&[level(100.0, 1.0)], &[level(101.0, 1.0)]);

        book.reset(&[level(90.0, 2.0)], &[level(91.0, 2.0)]);

        assert_eq!(book.bids(), [level(90.0, 2.0)]);
        assert_eq!(book.asks(), [level(91.0, 2.0)]);
    }

    #[test]
    fn inserts_a_new_level_in_price_order() {
        let mut book = OrderBook::default();
        book.reset(&[level(100.0, 1.0), level(98.0, 1.0)], &[level(101.0, 1.0), level(103.0, 1.0)]);

        book.set_bid(99.0, 4.0);
        book.set_ask(102.0, 4.0);

        assert_eq!(book.bids(), [level(100.0, 1.0), level(99.0, 4.0), level(98.0, 1.0)]);
        assert_eq!(book.asks(), [level(101.0, 1.0), level(102.0, 4.0), level(103.0, 1.0)]);
    }

    #[test]
    fn updates_the_size_of_an_existing_level_in_place() {
        let mut book = OrderBook::default();
        book.reset(&[level(100.0, 1.0)], &[level(101.0, 1.0)]);

        book.set_bid(100.0, 7.0);
        book.set_ask(101.0, 8.0);

        assert_eq!(book.bids(), [level(100.0, 7.0)]);
        assert_eq!(book.asks(), [level(101.0, 8.0)]);
    }

    #[test]
    fn removes_a_level_on_a_zero_size_and_shifts_the_rest_up() {
        let mut book = OrderBook::default();
        book.reset(&[level(100.0, 1.0), level(99.0, 2.0)], &[level(101.0, 1.0)]);

        book.set_bid(100.0, 0.0);

        assert_eq!(book.bids(), [level(99.0, 2.0)]);
    }

    #[test]
    fn ignores_a_zero_size_for_a_price_it_does_not_hold() {
        let mut book = OrderBook::default();
        book.reset(&[level(100.0, 1.0)], &[]);

        assert!(book.set_bid(50.0, 0.0));
        assert_eq!(book.bids(), [level(100.0, 1.0)]);
    }

    #[test]
    fn refuses_a_non_finite_or_non_positive_price_and_a_negative_size_and_changes_nothing() {
        let mut book = OrderBook::default();
        book.reset(&[level(100.0, 1.0)], &[]);

        assert!(!book.set_bid(f64::NAN, 1.0));
        assert!(!book.set_bid(0.0, 1.0));
        assert!(!book.set_bid(-1.0, 1.0));
        assert!(!book.set_bid(100.0, -1.0));
        assert!(!book.set_ask(f64::INFINITY, 1.0));
        assert_eq!(book.bids(), [level(100.0, 1.0)]);
        assert_eq!(book.asks().len(), 0);
    }

    #[test]
    fn inserts_at_both_ends_of_a_side() {
        let mut book = OrderBook::default();
        book.reset(&[level(100.0, 1.0)], &[level(101.0, 1.0)]);

        book.set_bid(105.0, 1.0);
        book.set_bid(1.0, 1.0);
        book.set_ask(200.0, 1.0);
        book.set_ask(100.5, 1.0);

        assert_eq!(book.bids(), [level(105.0, 1.0), level(100.0, 1.0), level(1.0, 1.0)]);
        assert_eq!(book.asks(), [level(100.5, 1.0), level(101.0, 1.0), level(200.0, 1.0)]);
    }

    // topBids(n) became Levels::from_slice, the copy of a side the feed hands the engine.
    #[test]
    fn returns_at_most_the_requested_number_of_levels_and_copies_rather_than_aliases() {
        let mut book = OrderBook::default();
        let mut bids = Vec::new();
        for i in 0..DEPTH_LEVEL + 5 {
            bids.push(level(100.0 - i as f64, 1.0));
        }
        book.reset(&bids, &[]);

        let top = Levels::from_slice(book.bids());
        book.set_bid(100.0, 999.0);

        assert_eq!(top.as_slice(), &bids[..DEPTH_LEVEL]);
        assert_eq!(book.bids()[0], level(100.0, 999.0));
    }

    #[test]
    fn returns_an_empty_array_for_an_empty_side() {
        let book = OrderBook::default();

        assert!(book.bids().is_empty());
        assert!(book.asks().is_empty());
        assert!(Levels::from_slice(book.bids()).as_slice().is_empty());
    }
}
