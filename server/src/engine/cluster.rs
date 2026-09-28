pub mod index_builder;
pub mod quote_family;

use std::collections::HashMap;

pub type PairKey = String; // "BTC|USDT". USD and USDC markets sit under the USDT key, see quote_family.rs

#[derive(Debug, Clone)]
pub struct Venue {
    pub id: String,   // "binance"
    pub name: String, // "Binance"
    pub markets: Vec<Market>,
}

#[derive(Debug, Clone)]
pub struct Market {
    pub venue_id: String,      // "bybit"
    pub raw_market_id: String, // "BTCUSDT": the symbol exactly as the venue's socket spells it
    pub base: String,          // "BTC"
    pub quote: String,         // "USDT"
    pub taker_ppm: u32,        // taker fee in parts per million: 550 = 0.055%
    pub linear: bool,
    pub contract_size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BookLevel {
    pub price: f64,
    pub size: f64,
}

#[derive(Debug)]
pub struct ClusterDepth {
    pub max_levels: usize, // default at 20
    pub bid_price: Box<[f64]>, // width × max_levels, descending inside a slot
    pub bid_size: Box<[f64]>, // raw contracts
    pub ask_price: Box<[f64]>, // ascending inside a slot
    pub ask_size: Box<[f64]>,
    pub bid_level_count: Box<[u8]>, // filled entries per slot, 0 = nothing held
    pub ask_level_count: Box<[u8]>,
    pub written_at: Box<[i64]>, // Unix ms per slot, 0 = never. A reader refuses depth older than the episode it judges
}

#[derive(Debug, Clone)]
pub struct ClusterAnchor {
    pub index: Box<[f64]>,        // the venue's index price, 0 = never read
    pub mark: Box<[f64]>,         // 0 = the venue publishes none, which refuses the route at open
    pub move_ppm: Box<[f64]>, // how far the index or the mark moved since the previous poll, whichever moved more, in ppm. f64::INFINITY until the slot's second poll, written by Engine::update_anchor
    pub funding_rate: Box<[f64]>, // the rate for the upcoming settlement, as a fraction: -0.0038 = shorts pay longs 0.38%
    pub funding_interval_hours: Box<[f64]>, // 1, 4 or 8
    pub next_funding_at: Box<[i64]>, // Unix ms, 0 = unknown
    pub written_at: Box<[i64]>, // Unix ms per slot, 0 = never. A reader refuses two legs further apart than anchor_reading.rs allows
}

#[derive(Debug, Clone, Copy)]
pub struct AnchorReading {
    pub index: f64,
    pub mark: f64,
    pub funding_rate: f64,
    pub funding_interval_hours: f64,
    pub next_funding_at: i64,
    pub ts: i64, // Unix ms when the venue published it, or when the poll returned
}

#[derive(Debug)]
pub struct Cluster {
    pub pair: PairKey, // "BTC|USDT"
    pub markets: Box<[Option<Market>]>,
    pub bid_mul: Box<[f64]>, // 1 - taker fee, applied when a reading is taken, never at write
    pub ask_mul: Box<[f64]>, // 1 + taker fee
    pub size_mul: Box<[f64]>, // contract_size
    pub bid: Box<[f64]>,      // raw, as the venue quotes it
    pub ask: Box<[f64]>,
    pub bid_size: Box<[f64]>, // raw contracts resting at the bid. Written on every message, but a size-only change is not a tick
    pub ask_size: Box<[f64]>,
    pub recv_ts: Box<[i64]>, // Unix ms. 0 = never spoke, venue does not list this pair, or its socket is down (Engine::mark_stale)
    pub depth: ClusterDepth,
    pub anchor: ClusterAnchor, // written by a poller, not by the book socket, so mark_stale leaves it alone
}

pub type ClusterId = usize; // position in ClusterIndex::clusters

#[derive(Debug)]
pub struct ClusterIndex {
    pub clusters: Vec<Cluster>,
    pub cluster_by_raw_market_id: ClusterByRawMarketId,
    pub venue_index_map: VenueIndexMap,
}

#[derive(Debug)]
pub struct ClusterByRawMarketId {
    index: HashMap<String, HashMap<String, ClusterId>>, // <"binance", <"BTCUSDT", 42>>
}

impl ClusterByRawMarketId {
    pub fn new(clusters: &[Cluster]) -> Self {
        let mut index: HashMap<String, HashMap<String, ClusterId>> = HashMap::new();

        for (cluster_id, cluster) in clusters.iter().enumerate() {
            for market in cluster.markets.iter().flatten() {
                let venue_markets = index.entry(market.venue_id.clone()).or_default();

                if venue_markets.contains_key(&market.raw_market_id) {
                    tracing::error!(pair = %cluster.pair, venue = %market.venue_id, market = %market.raw_market_id, "market already mapped to another cluster, skipping");
                    continue;
                }
                venue_markets.insert(market.raw_market_id.clone(), cluster_id);
            }
        }

        Self { index }
    }

    pub fn get(&self, venue_id: &str, raw_market_id: &str) -> Option<ClusterId> {
        self.index.get(venue_id)?.get(raw_market_id).copied()
    }
}

#[derive(Debug)]
pub struct VenueIndexMap {
    index: HashMap<String, usize>, // <"binance", 0>
}


impl VenueIndexMap {
    pub fn new(venues: &[Venue]) -> Self {
        let mut index = HashMap::with_capacity(venues.len());
        for (i, venue) in venues.iter().enumerate() {
            index.insert(venue.id.clone(), i);
        }
        Self { index }
    }

    pub fn get(&self, venue_id: &str) -> Option<usize> {
        self.index.get(venue_id).copied()
    }
}
  
  
impl ClusterDepth{
    pub fn new(width: usize, levels: usize) -> anyhow::Result<Self> {
        if !(1..=255).contains(&levels){
            anyhow::bail!("depth levels must be an integer from 1 to 255, got {levels}");
        }
        Ok(Self {
            max_levels: levels,
            bid_price: zeroed(width * levels),
            bid_size: zeroed(width * levels),
            ask_price: zeroed(width * levels),
            ask_size: zeroed(width * levels),
            bid_level_count: zeroed(width),
            ask_level_count: zeroed(width),
            written_at: zeroed(width),
        })
    }
}
  
  
impl ClusterAnchor {
    pub fn new(width: usize) -> Self {
        Self {
            index: zeroed(width),
            mark: zeroed(width),
            move_ppm: vec![f64::INFINITY; width].into_boxed_slice(),
            funding_rate: zeroed(width),
            funding_interval_hours: zeroed(width),
            next_funding_at: zeroed(width),
            written_at: zeroed(width),
        }
    }
}

fn zeroed<T: Default + Clone>(len: usize) -> Box<[T]> {
    vec![T::default(); len].into_boxed_slice()
}
