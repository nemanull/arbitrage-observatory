pub mod anchor_poller;
pub mod order_book;
pub mod venue_feed;

use crate::engine::cluster::Market;
use crate::engine::engine::Slot;

// A venue's market that sits in a cluster, with the slot its feed and its poller write.
#[derive(Debug, Clone)]
pub struct TrackedMarket {
    pub market: Market,
    pub slot: Slot,
}
