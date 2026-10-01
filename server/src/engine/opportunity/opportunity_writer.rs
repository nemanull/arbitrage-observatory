use super::{CloseReason, Opportunity};
use crate::engine::cluster::quote_family::cluster_quote;
use chrono::DateTime;
use chrono::NaiveDateTime;
use sqlx::PgPool;
use sqlx::postgres::Postgres;
use sqlx::query_builder::QueryBuilder;
use tokio::sync::mpsc::Receiver;
use std::char::DecodeUtf16Error;
use std::time::Duration;

pub const QUEUE_CAPACITY: usize = 1_024;

pub const BATCH: usize = 64;
const ATTEMPTS: u32 = 5;
const RETRY_DELAY: Duration = Duration::from_millis(500);

const INSERT_HEAD: &str = r#"INSERT INTO "ArbitrageOpportunity" (
    "pair", "route",
    "highestBidVenue", "highestBidRawMarketId", "lowestAskVenue", "lowestAskRawMarketId",
    "highestBidTakerPpm", "lowestAskTakerPpm",
    "openedAt", "netPpmAtOpen", "highestBidAtOpen", "lowestAskAtOpen",
    "closedAt", "closeReason", "netPpmAtClose", "lastSeenAt", "durationMs",
    "ticks", "avgNetPpm", "peakNetPpm", "peakAt", "peakHighestBid", "peakLowestAsk", "minNetPpm",
    "sampleTsMs", "netPpmSeries", "highestBidSeries", "lowestAskSeries", "edgeAvgPpmSeries", "edgeNotionalSeries",
    "edgeAvgPpmAtOpen", "edgeSizeAtOpen", "edgeNotionalAtOpen", "edgeExhaustedAtOpen", "edgeBuyLevelsAtOpen", "edgeSellLevelsAtOpen",
    "peakEdgeAvgPpm", "peakEdgeSize", "peakEdgeNotional", "peakEdgeExhausted", "peakEdgeAt",
    "edgeAvgPpmAtClose", "edgeSizeAtClose", "edgeNotionalAtClose", "edgeExhaustedAtClose",
    "maxEdgeNotional", "edgeSamples",
    "highestBidIndexAtOpen", "highestBidMarkAtOpen", "highestBidFreshPremiumAtOpen", "highestBidFundingRateAtOpen",
    "highestBidFundingIntervalHours", "highestBidNextFundingAt", "highestBidAnchorAt",
    "lowestAskIndexAtOpen", "lowestAskMarkAtOpen", "lowestAskFreshPremiumAtOpen", "lowestAskFundingRateAtOpen",
    "lowestAskFundingIntervalHours", "lowestAskNextFundingAt", "lowestAskAnchorAt",
    "freshNetPpmAtOpen", "standingPpmAtOpen", "indexGapPpmAtOpen", "carriedPpmAtOpen",
    "freshNetPpmAtPeak", "standingPpmAtPeak", "indexGapPpmAtPeak", "carriedPpmAtPeak",
    "freshNetPpmAtClose", "standingPpmAtClose", "indexGapPpmAtClose", "carriedPpmAtClose",
    "freshNetPpmSeries", "anchorTsMs",
    "highestBidIndexSeries", "highestBidMarkSeries", "lowestAskIndexSeries", "lowestAskMarkSeries"
) "#;

pub async fn run_writer(pool: PgPool, mut rx: Receiver<Opportunity>) {
    let mut batch: Vec<Opportunity> = Vec::with_capacity(BATCH);

    while rx.recv_many(&mut batch, BATCH).await > 0 {
        write_with_retry(&pool, &batch).await;
        batch.clear(); 
    }
}

pub async fn write_with_retry(pool: &PgPool, batch: &[Opportunity]){
    for a in 0..ATTEMPTS{
        match insert_batch(pool, batch).await {
            Ok(written) => {
                tracing::info!(event = "opportunities_written", rows = batch.len(), written, a)
            }
            Err(error) => {
                tracing::warn!(event = "opportunity_write_failed", rows = batch.len(), a, %error);
                    if a < ATTEMPTS {
                        tokio::time::sleep(RETRY_DELAY * a).await;
                    }

            }
        }
    }
}

pub async fn insert_batch(pool: &PgPool, batch: &[Opportunity]) -> sqlx::Result<u64> {
    let mut query: QueryBuilder<Postgres> = QueryBuilder::new(INSERT_HEAD);
    query.push_values(batch, |mut b, opportunity| {
        let sell = &opportunity.highest_bid_market;
        let buy = &opportunity.lowest_ask_market;
        let open = &opportunity.anchor_at_open;

        b.push_bind(format!("{}|{}", sell.base, cluster_quote(&sell.quote)));
        b.push_bind(format!("{}-{}", sell.venue_id, buy.venue_id));

        b.push_bind(&sell.venue_id);
        b.push_bind(&sell.raw_market_id);
        b.push_bind(&buy.venue_id);
        b.push_bind(&buy.raw_market_id);

        b.push_bind(sell.taker_ppm as i32);
        b.push_bind(buy.taker_ppm as i32);

        b.push_bind(ts(opportunity.opened_at));
        b.push_bind(opportunity.net_ppm_at_open);
        b.push_bind(opportunity.highest_bid_at_open);
        b.push_bind(opportunity.lowest_ask_at_open);

        b.push_bind(opportunity.closed_at.map(ts));
        b.push_bind(opportunity.close_reason.map(close_reason_label));
        b.push_unseparated(r#"::"OpportunityCloseReason""#);
        b.push_bind(opportunity.last_net_ppm);
        b.push_bind(ts(opportunity.last_seen_at));
        b.push_bind(
            opportunity
                .closed_at
                .map(|closed_at| (closed_at - opportunity.opened_at) as i32),
        );

        b.push_bind(opportunity.ticks_since_start as i32);
        b.push_bind(opportunity.net_ppm_sum / opportunity.ticks_since_start as f64);
        b.push_bind(opportunity.peak_net_ppm);
        b.push_bind(ts(opportunity.peak_at));
        b.push_bind(opportunity.peak_highest_bid);
        b.push_bind(opportunity.peak_lowest_ask);
        b.push_bind(opportunity.min_net_ppm);

        b.push_bind(&opportunity.sample_ts);
        b.push_bind(&opportunity.net_ppm_series);
        b.push_bind(&opportunity.highest_bid_series);
        b.push_bind(&opportunity.lowest_ask_series);
        b.push_bind(&opportunity.edge_avg_ppm_series);
        b.push_bind(&opportunity.edge_notional_series);

        b.push_bind(opportunity.edge_at_open.map(|edge| edge.avg_ppm));
        b.push_bind(opportunity.edge_at_open.map(|edge| edge.size));
        b.push_bind(opportunity.edge_at_open.map(|edge| edge.notional));
        b.push_bind(opportunity.edge_at_open.map(|edge| edge.exhausted));
        b.push_bind(opportunity.edge_at_open.map(|edge| edge.buy_levels as i32));
        b.push_bind(opportunity.edge_at_open.map(|edge| edge.sell_levels as i32));

        b.push_bind(opportunity.peak_edge.map(|edge| edge.avg_ppm));
        b.push_bind(opportunity.peak_edge.map(|edge| edge.size));
        b.push_bind(opportunity.peak_edge.map(|edge| edge.notional));
        b.push_bind(opportunity.peak_edge.map(|edge| edge.exhausted));
        b.push_bind(opportunity.peak_edge.map(|_| ts(opportunity.peak_edge_at)));

        b.push_bind(opportunity.last_edge.map(|edge| edge.avg_ppm));
        b.push_bind(opportunity.last_edge.map(|edge| edge.size));
        b.push_bind(opportunity.last_edge.map(|edge| edge.notional));
        b.push_bind(opportunity.last_edge.map(|edge| edge.exhausted));

        b.push_bind(opportunity.max_edge_notional);
        b.push_bind(opportunity.edge_samples as i32);

        b.push_bind(open.sell.index);
        b.push_bind(open.sell.mark);
        b.push_bind(open.sell.fresh_premium);
        b.push_bind(open.sell.funding_rate);
        b.push_bind(open.sell.funding_interval_hours);
        b.push_bind(ts_or_null(open.sell.next_funding_at));
        b.push_bind(ts_or_null(open.sell.written_at));

        b.push_bind(open.buy.index);
        b.push_bind(open.buy.mark);
        b.push_bind(open.buy.fresh_premium);
        b.push_bind(open.buy.funding_rate);
        b.push_bind(open.buy.funding_interval_hours);
        b.push_bind(ts_or_null(open.buy.next_funding_at));
        b.push_bind(ts_or_null(open.buy.written_at));

        b.push_bind(open.fresh_net_ppm);
        b.push_bind(open.standing_ppm);
        b.push_bind(open.index_gap_ppm);
        b.push_bind(open.carried_ppm);

        b.push_bind(opportunity.peak_anchor.map(|anchor| anchor.fresh_net_ppm));
        b.push_bind(opportunity.peak_anchor.map(|anchor| anchor.standing_ppm));
        b.push_bind(opportunity.peak_anchor.map(|anchor| anchor.index_gap_ppm));
        b.push_bind(opportunity.peak_anchor.map(|anchor| anchor.carried_ppm));

        b.push_bind(opportunity.last_anchor.map(|anchor| anchor.fresh_net_ppm));
        b.push_bind(opportunity.last_anchor.map(|anchor| anchor.standing_ppm));
        b.push_bind(opportunity.last_anchor.map(|anchor| anchor.index_gap_ppm));
        b.push_bind(opportunity.last_anchor.map(|anchor| anchor.carried_ppm));

        b.push_bind(&opportunity.fresh_net_ppm_series);
        b.push_bind(&opportunity.anchor_ts_ms);

        b.push_bind(&opportunity.highest_bid_index_series);
        b.push_bind(&opportunity.highest_bid_mark_series);
        b.push_bind(&opportunity.lowest_ask_index_series);
        b.push_bind(&opportunity.lowest_ask_mark_series);
    });

    let done = query.build().execute(pool).await?;
    Ok(done.rows_affected())
}

fn ts(ms: i64) -> NaiveDateTime {
    DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .naive_utc()
}

fn ts_or_null(ms: i64) -> Option<NaiveDateTime> {
    (ms > 0).then(|| ts(ms))
}

pub fn close_reason_label(reason: CloseReason) -> &'static str {
    match reason {
        CloseReason::SpreadCollapsed => "spread_collapsed",
        CloseReason::FreshEdgeCollapsed => "fresh_edge_collapsed",
        CloseReason::FeedDown => "feed_down",
        CloseReason::AgeCap => "age_cap",
        CloseReason::Shutdown => "shutdown",
    }
}
