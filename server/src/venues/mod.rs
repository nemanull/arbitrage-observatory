// An adapter is one module here, one arm in load_venue and one arm in start_venue.

mod apex;
mod aster;
mod backpack;
mod biconomy;
mod bigone;
mod binance;
mod bingx;
mod bitfinex;
mod bitget;
mod bitradex;
mod bitstamp;
mod bitunix;
mod btse;
mod bybit;
mod catalog;
mod chainup;
mod coinbase;
mod coinw;
mod cryptocom;
mod deepcoin;
mod delta;
mod deribit;
mod derive;
mod digifinex;
mod dydx;
mod echobit;
mod extended;
mod gate;
mod gemini;
mod globe;
mod grvt;
mod hashkey;
mod hibachi;
mod hibt;
mod hitbtc;
mod hotcoin;
mod htx;
mod hyperliquid;
mod krakenfutures;
mod kucoinfutures;
mod lighter;
#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod load_tests;
mod mexc;
mod okx;
mod orangex;
mod orderly;
mod pacifica;
mod paradex;
mod phemex;
mod pionex;
mod poloniex;
mod socket_anchors;
mod toobit;
mod tothemoon;
mod trubitpro;
mod uzx;
mod valr;
mod weex;
mod whitebit;
#[cfg(test)]
pub(crate) mod testing;
mod wire;
mod woo;
mod xt;
mod zoomex;

use crate::engine::cluster::Venue;
use crate::engine::engine::EngineEvent;
use crate::feeds::TrackedMarket;
use crate::feeds::anchor_poller::{AnchorVenue, spawn_poller};
use crate::feeds::venue_feed::{BookVenue, spawn_feed};
use apex::Apex;
use aster::Aster;
use backpack::Backpack;
use biconomy::Biconomy;
use bigone::BigOne;
use binance::Binance;
use bingx::BingX;
use bitfinex::Bitfinex;
use bitget::Bitget;
use bitradex::Bitradex;
use bitstamp::Bitstamp;
use bitunix::Bitunix;
use btse::Btse;
use bybit::Bybit;
use chainup::Chainup;
use coinbase::Coinbase;
use coinw::Coinw;
use cryptocom::Cryptocom;
use deepcoin::Deepcoin;
use delta::Delta;
use deribit::Deribit;
use derive::Derive;
use digifinex::Digifinex;
use dydx::Dydx;
use echobit::Echobit;
use extended::Extended;
use gate::Gate;
use gemini::Gemini;
use globe::Globe;
use grvt::Grvt;
use hashkey::Hashkey;
use hibachi::Hibachi;
use hibt::Hibt;
use hitbtc::HitBtc;
use hotcoin::Hotcoin;
use htx::Htx;
use hyperliquid::Hyperliquid;
use krakenfutures::KrakenFutures;
use kucoinfutures::KucoinFutures;
use lighter::Lighter;
use mexc::Mexc;
use okx::Okx;
use orangex::Orangex;
use orderly::Orderly;
use pacifica::Pacifica;
use paradex::Paradex;
use phemex::Phemex;
use pionex::Pionex;
use poloniex::Poloniex;
use toobit::Toobit;
use tothemoon::Tothemoon;
use trubitpro::TrubitPro;
use uzx::Uzx;
use valr::Valr;
use weex::Weex;
use whitebit::Whitebit;
use woo::Woo;
use xt::Xt;
use zoomex::Zoomex;
use std::sync::Arc;
use tokio::sync::mpsc::Sender;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

// What one venue's tasks need from the run.
pub struct VenueRun {
    pub venue_id: String,
    pub venue_index: usize,
    pub markets: Vec<TrackedMarket>, // only the markets that sit in a cluster
    pub http: reqwest::Client,
    pub tx: Sender<EngineEvent>,
    pub cancel: CancellationToken,
}

// Reads the venue's perpetual markets, each with its taker fee and contract size, from the venue's own instruments call.
pub async fn load_venue(id: &str, http: &reqwest::Client) -> anyhow::Result<Venue> {
    match id {
        binance::ID => binance::load(http).await,
        bybit::ID => bybit::load(http).await,
        okx::ID => okx::load(http).await,
        krakenfutures::ID => krakenfutures::load(http).await,
        coinbase::ID => coinbase::load(http).await,
        gate::ID => gate::load(http).await,
        bitget::ID => bitget::load(http).await,
        mexc::ID => mexc::load(http).await,
        bitstamp::ID => bitstamp::load(http).await,
        gemini::ID => gemini::load(http).await,
        kucoinfutures::ID => kucoinfutures::load(http).await,
        bingx::ID => bingx::load(http).await,
        cryptocom::ID => cryptocom::load(http).await,
        woo::ID => woo::load(http).await,
        whitebit::ID => whitebit::load(http).await,
        phemex::ID => phemex::load(http).await,
        deribit::ID => deribit::load(http).await,
        hyperliquid::ID => hyperliquid::load(http).await,
        bitunix::ID => bitunix::load(http).await,
        htx::ID => htx::load(http).await,
        toobit::ID => toobit::load(http).await,
        bitfinex::ID => bitfinex::load(http).await,
        btse::ID => btse::load(http).await,
        digifinex::ID => digifinex::load(http).await,
        delta::ID => delta::load(http).await,
        backpack::ID => backpack::load(http).await,
        deepcoin::ID => deepcoin::load(http).await,
        bigone::ID => bigone::load(http).await,
        globe::ID => globe::load(http).await,
        uzx::ID => uzx::load(http).await,
        xt::ID => xt::load(http).await,
        weex::ID => weex::load(http).await,
        coinw::ID => coinw::load(http).await,
        hashkey::ID => hashkey::load(http).await,
        hibt::ID => hibt::load(http).await,
        zoomex::ID => zoomex::load(http).await,
        poloniex::ID => poloniex::load(http).await,
        orangex::ID => orangex::load(http).await,
        hotcoin::ID => hotcoin::load(http).await,
        hitbtc::HITBTC_ID => hitbtc::load(&hitbtc::HITBTC, http).await,
        hitbtc::FMFWIO_ID => hitbtc::load(&hitbtc::FMFWIO, http).await,
        hitbtc::CHANGELLYPRO_ID => hitbtc::load(&hitbtc::CHANGELLYPRO, http).await,
        hitbtc::MANDALA_ID => hitbtc::load(&hitbtc::MANDALA, http).await,
        hitbtc::GLEECBTC_ID => hitbtc::load(&hitbtc::GLEECBTC, http).await,
        bitradex::ID => bitradex::load(http).await,
        pionex::ID => pionex::load(http).await,
        echobit::ID => echobit::load(http).await,
        valr::ID => valr::load(http).await,
        mexc::OURBIT_ID => mexc::load_profile(&mexc::OURBIT, http).await,
        mexc::BYDFI_ID => mexc::load_profile(&mexc::BYDFI, http).await,
        biconomy::ID => biconomy::load(http).await,
        orderly::NIZA_ID => orderly::load(&orderly::NIZA, http).await,
        orderly::NONKYC_ID => orderly::load(&orderly::NONKYC, http).await,
        tothemoon::ID => tothemoon::load(http).await,
        trubitpro::ID => trubitpro::load(http).await,
        chainup::AIVORA_ID => chainup::load(&chainup::AIVORA, http).await,
        chainup::FAMEEX_ID => chainup::load(&chainup::FAMEEX, http).await,
        chainup::XME_ID => chainup::load(&chainup::XME, http).await,
        chainup::KOINBAY_ID => chainup::load(&chainup::KOINBAY, http).await,
        aster::ID => aster::load(http).await,
        extended::ID => extended::load(http).await,
        lighter::ID => lighter::load(http).await,
        grvt::ID => grvt::load(http).await,
        apex::ID => apex::load(http).await,
        pacifica::ID => pacifica::load(http).await,
        dydx::ID => dydx::load(http).await,
        paradex::ID => paradex::load(http).await,
        derive::ID => derive::load(http).await,
        hibachi::ID => hibachi::load(http).await,
        _ => anyhow::bail!("{id} has no adapter"),
    }
}

pub fn start_venue(run: VenueRun) -> anyhow::Result<Vec<JoinHandle<()>>> {
    let tasks = match run.venue_id.as_str() {
        binance::ID => start(Binance::new(&run.markets), run),
        bybit::ID => start(Bybit::new(&run.markets), run),
        okx::ID => start(Okx::new(&run.markets), run),
        krakenfutures::ID => start(KrakenFutures::new(), run),
        coinbase::ID => start(Coinbase::new(), run),
        gate::ID => start(Gate::new(), run),
        bitget::ID => start(Bitget::new(&run.markets), run),
        mexc::ID => start(Mexc::new(), run),
        bitstamp::ID => start(Bitstamp::new(&run.markets), run),
        gemini::ID => start(Gemini::new(&run.markets), run),
        kucoinfutures::ID => start(KucoinFutures::new(), run),
        bingx::ID => start(BingX::new(), run),
        cryptocom::ID => start(Cryptocom::new(&run.markets), run),
        woo::ID => start(Woo::new(), run),
        whitebit::ID => start(Whitebit::new(), run),
        phemex::ID => start(Phemex::new(), run),
        deribit::ID => start(Deribit::new(&run.markets), run),
        hyperliquid::ID => start(Hyperliquid::new(), run),
        bitunix::ID => start(Bitunix::new(), run),
        htx::ID => start(Htx::new(&run.markets), run),
        toobit::ID => start(Toobit::new(), run),
        bitfinex::ID => start(Bitfinex::new(), run),
        btse::ID => start(Btse::new(), run),
        digifinex::ID => start(Digifinex::new(&run.markets), run),
        delta::ID => start(Delta::new(), run),
        backpack::ID => start(Backpack::new(), run),
        deepcoin::ID => start(Deepcoin::new(&run.markets), run),
        bigone::ID => start(BigOne::new(), run),
        globe::ID => start(Globe::new(), run),
        uzx::ID => start(Uzx::new(&run.markets), run),
        xt::ID => start(Xt::new(), run),
        weex::ID => start(Weex::new(), run),
        coinw::ID => start(Coinw::new(&run.markets), run),
        hashkey::ID => start(Hashkey::new(&run.markets), run),
        hibt::ID => start(Hibt::new(), run),
        zoomex::ID => start(Zoomex::new(&run.markets), run),
        poloniex::ID => start(Poloniex::new(&run.markets), run),
        orangex::ID => start(Orangex::new(), run),
        hotcoin::ID => start(Hotcoin::new(&run.markets), run),
        hitbtc::HITBTC_ID => start(HitBtc::new(&hitbtc::HITBTC), run),
        hitbtc::FMFWIO_ID => start(HitBtc::new(&hitbtc::FMFWIO), run),
        hitbtc::CHANGELLYPRO_ID => start(HitBtc::new(&hitbtc::CHANGELLYPRO), run),
        hitbtc::MANDALA_ID => start(HitBtc::new(&hitbtc::MANDALA), run),
        hitbtc::GLEECBTC_ID => start(HitBtc::new(&hitbtc::GLEECBTC), run),
        bitradex::ID => start(Bitradex::new(&run.markets), run),
        pionex::ID => start(Pionex::new(&run.markets), run),
        echobit::ID => start(Echobit::new(&run.markets), run),
        valr::ID => start(Valr::new(), run),
        mexc::OURBIT_ID => start(Mexc::for_venue(&mexc::OURBIT), run),
        mexc::BYDFI_ID => start(Mexc::for_venue(&mexc::BYDFI), run),
        biconomy::ID => start(Biconomy::new(), run),
        orderly::NIZA_ID => start(Orderly::new(&orderly::NIZA), run),
        orderly::NONKYC_ID => start(Orderly::new(&orderly::NONKYC), run),
        tothemoon::ID => start(Tothemoon::new(&run.markets), run),
        trubitpro::ID => start(TrubitPro::new(&run.markets), run),
        chainup::AIVORA_ID => start(Chainup::new(&chainup::AIVORA, &run.markets), run),
        chainup::FAMEEX_ID => start(Chainup::new(&chainup::FAMEEX, &run.markets), run),
        chainup::XME_ID => start(Chainup::new(&chainup::XME, &run.markets), run),
        chainup::KOINBAY_ID => start(Chainup::new(&chainup::KOINBAY, &run.markets), run),
        aster::ID => start(Aster::new(), run),
        extended::ID => start(Extended::new(&run.markets), run),
        lighter::ID => start(Lighter::new(&run.markets), run),
        grvt::ID => start(Grvt::new(&run.markets), run),
        apex::ID => start(Apex::new(&run.markets), run),
        pacifica::ID => start(Pacifica::new(), run),
        dydx::ID => start(Dydx::new(), run),
        paradex::ID => start(Paradex::new(&run.markets), run),
        derive::ID => start(Derive::new(&run.markets), run),
        hibachi::ID => start(Hibachi::new(), run),
        _ => anyhow::bail!("{} has no adapter", run.venue_id),
    };
    Ok(tasks)
}

// The book socket and the anchor poll of one venue, the only writers of its slots.
fn start<V: BookVenue + AnchorVenue>(venue: V, run: VenueRun) -> Vec<JoinHandle<()>> {
    let venue = Arc::new(venue);
    let mut tasks = spawn_feed(
        venue.clone(),
        &run.venue_id,
        run.venue_index,
        &run.markets,
        &run.http,
        &run.tx,
        &run.cancel,
    );
    tasks.push(spawn_poller(
        venue,
        &run.venue_id,
        run.markets,
        run.http,
        run.tx,
        run.cancel,
    ));
    tasks
}
