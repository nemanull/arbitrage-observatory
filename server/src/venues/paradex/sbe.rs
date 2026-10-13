// Paradex's public socket frames in Simple Binary Encoding, schema 1, little endian, as `paradex_1_0.xml` of the paradex-py SDK lays them out.
// Each frame is an 8-byte header, a root block whose length the header gives, then repeating groups and the market name.
// A later schema version appends fields to a block, so every offset here is read inside the block length the header states.
// Every price, size and rate is an int64 mantissa at a constant exponent, and INT64_MIN is null.

use crate::engine::cluster::BookLevel;

pub const SCHEMA_ID: u16 = 1;
pub const BOOK: u16 = 3; // BookEvent
pub const SUMMARY: u16 = 4; // MarketSummaryEvent
pub const FUNDING: u16 = 5; // FundingDataEvent

pub const SNAPSHOT: u8 = 0; // BookEvent pkgType, the whole book
pub const DELTA: u8 = 1; // BookEvent pkgType, changed levels only

const HEADER_LEN: usize = 8;
const NULL: i64 = i64::MIN;
const E8: f64 = 1e8; // prices, sizes and Rate8
const E12: f64 = 1e12; // Rate12, the precise funding rate

// BookEvent: ts 0, seq 8, pkgType 16, then nine best and spread fields that the API feeds leave null, 89 bytes in all.
const BOOK_SEQ: usize = 8;
const BOOK_PKG_TYPE: usize = 16;
const LEVEL_LEN: usize = 16; // a price then a size

// MarketSummaryEvent: 216 bytes at version 0 and 240 from version 1, which appends fundingRatePrecise at 232.
const SUMMARY_MARK: usize = 16;
const SUMMARY_INDEX: usize = 24;
const SUMMARY_FUNDING_RATE: usize = 56; // Rate8, the rate at 8 decimals
const SUMMARY_FUNDING_PRECISE: usize = 232; // Rate12, the same rate at 12 decimals

// FundingDataEvent: fundingPeriodHours is an int16 at 56.
const FUNDING_PERIOD_HOURS: usize = 56;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub block_length: usize,
    pub template_id: u16,
    pub schema_id: u16,
}

#[derive(Debug, PartialEq)]
pub struct Book<'a> {
    pub seq: i64, // the market's book sequence, which every delta advances by exactly 1
    pub pkg_type: u8,
    pub bids: Vec<BookLevel>, // a null price or size reads as NaN
    pub asks: Vec<BookLevel>,
    pub market: &'a str,
}

#[derive(Debug, PartialEq)]
pub struct Summary<'a> {
    pub mark: f64, // NaN when null
    pub index: f64,
    pub funding_rate: f64, // a fraction per funding period, the precise field when present
    pub market: &'a str,
}

#[derive(Debug, PartialEq)]
pub struct Funding<'a> {
    pub period_hours: f64, // NaN when null
    pub market: &'a str,
}

// None for a frame shorter than a header, which no binary frame of this schema is.
// The version at offset 6 is the one the URL negotiated, and the block length already tells what it changed.
pub fn header(frame: &[u8]) -> Option<Header> {
    if frame.len() < HEADER_LEN {
        return None;
    }
    Some(Header {
        block_length: u16_at(frame, 0).ok()? as usize,
        template_id: u16_at(frame, 2).ok()?,
        schema_id: u16_at(frame, 4).ok()?,
    })
}

pub fn book<'a>(frame: &'a [u8], header: &Header) -> anyhow::Result<Book<'a>> {
    let block = block(frame, header, BOOK_PKG_TYPE + 1)?;
    let seq = i64_at(block, BOOK_SEQ)?;
    let pkg_type = block[BOOK_PKG_TYPE];

    let mut at = HEADER_LEN + header.block_length;
    let bids = levels(frame, &mut at)?;
    let asks = levels(frame, &mut at)?;
    let market = var_string(frame, at)?;

    Ok(Book { seq, pkg_type, bids, asks, market })
}

// Version 1 clients read the precise rate and fall back to the 8 decimal one only when it is null, as the schema says.
pub fn summary<'a>(frame: &'a [u8], header: &Header) -> anyhow::Result<Summary<'a>> {
    let block = block(frame, header, SUMMARY_FUNDING_RATE + 8)?;
    let precise = if block.len() >= SUMMARY_FUNDING_PRECISE + 8 { i64_at(block, SUMMARY_FUNDING_PRECISE)? } else { NULL };
    let funding_rate = if precise == NULL {
        decimal(i64_at(block, SUMMARY_FUNDING_RATE)?, E8)
    } else {
        decimal(precise, E12)
    };

    Ok(Summary {
        mark: decimal(i64_at(block, SUMMARY_MARK)?, E8),
        index: decimal(i64_at(block, SUMMARY_INDEX)?, E8),
        funding_rate,
        market: var_string(frame, HEADER_LEN + header.block_length)?,
    })
}

pub fn funding<'a>(frame: &'a [u8], header: &Header) -> anyhow::Result<Funding<'a>> {
    let block = block(frame, header, FUNDING_PERIOD_HOURS + 2)?;
    let hours = i16::from_le_bytes([block[FUNDING_PERIOD_HOURS], block[FUNDING_PERIOD_HOURS + 1]]);

    Ok(Funding {
        period_hours: if hours == i16::MIN { f64::NAN } else { f64::from(hours) },
        market: var_string(frame, HEADER_LEN + header.block_length)?,
    })
}

// The root block, which must hold the fields this decoder reads.
fn block<'a>(frame: &'a [u8], header: &Header, needed: usize) -> anyhow::Result<&'a [u8]> {
    if header.block_length < needed {
        anyhow::bail!("template {} block of {} bytes, under the {needed} this decoder reads", header.template_id, header.block_length);
    }
    let end = HEADER_LEN + header.block_length;
    frame
        .get(HEADER_LEN..end)
        .ok_or_else(|| anyhow::anyhow!("frame of {} bytes cut inside its {}-byte block", frame.len(), header.block_length))
}

// A group header names the length of one entry and the entry count, and an entry may grow in a later version.
fn levels(frame: &[u8], at: &mut usize) -> anyhow::Result<Vec<BookLevel>> {
    let entry_len = u16_at(frame, *at)? as usize;
    let count = u16_at(frame, *at + 2)? as usize;
    *at += 4;
    if entry_len < LEVEL_LEN {
        anyhow::bail!("book entry of {entry_len} bytes, under the {LEVEL_LEN} of a price and a size");
    }

    let mut levels = Vec::with_capacity(count);
    for i in 0..count {
        let entry = *at + i * entry_len;
        levels.push(BookLevel {
            price: decimal(i64_at(frame, entry)?, E8),
            size: decimal(i64_at(frame, entry + 8)?, E8),
        });
    }
    *at += count * entry_len;
    Ok(levels)
}

// A uint8 length, then that many UTF-8 bytes.
fn var_string(frame: &[u8], at: usize) -> anyhow::Result<&str> {
    let len = *frame.get(at).ok_or_else(|| anyhow::anyhow!("frame of {} bytes ends before its market name", frame.len()))? as usize;
    let bytes = frame
        .get(at + 1..at + 1 + len)
        .ok_or_else(|| anyhow::anyhow!("frame of {} bytes cut inside its {len}-byte market name", frame.len()))?;
    Ok(std::str::from_utf8(bytes)?)
}

// Dividing by the power of ten gives the double nearest the decimal, as parsing its text would.
fn decimal(mantissa: i64, scale: f64) -> f64 {
    if mantissa == NULL { f64::NAN } else { mantissa as f64 / scale }
}

fn u16_at(frame: &[u8], at: usize) -> anyhow::Result<u16> {
    let bytes = frame
        .get(at..at + 2)
        .ok_or_else(|| anyhow::anyhow!("frame of {} bytes cut at offset {at}", frame.len()))?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn i64_at(frame: &[u8], at: usize) -> anyhow::Result<i64> {
    let bytes = frame
        .get(at..at + 8)
        .ok_or_else(|| anyhow::anyhow!("frame of {} bytes cut at offset {at}", frame.len()))?;
    Ok(i64::from_le_bytes(bytes.try_into()?))
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub fn hex(text: &str) -> Vec<u8> {
        (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap()).collect()
    }

    // Frames captured live on 2026-10-12 at 23:00 UTC with schema version 1, by capture_frames in tests.rs.
    pub const XPT_SNAPSHOT: &str = "5900030001000100808e00a9ac5d0600efdc7401000000000000000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008010000100807061ae13000000c042c00000000000100001008093431976000000200b2000000000000c5850542d5553442d50455250";
    pub const XPT_SUMMARY: &str = "f0000400010001006040f4aaac5d060000000000000000002627566d27000000b0d93d662700000000685660270000000000000000000000006ea00500000000b0140000000000008066786a2700000000b1d56f27000000100190ccd7d70000bcc40100000000000000000000000080000000000000008000000000000000800000000000000080c6f3f60500000000000000000000000000000000000000000000000000000080000000000000008000000000000000800000000000000080000000000000008046f8a26d2700000060ed542600000000805950260000000000000000000000800000000000000000cb372803000000000c5850542d5553442d50455250";
    pub const XPT_FUNDING: &str = "4200050001000100a08b40abac5d06000000000000000000b0140000000000003e09496405000000a08b40abac5d0600f6c0880000000000b0140000000000000800acd80000000000000c5850542d5553442d50455250";
    pub const ETH_DELTA: &str = "5900030001000100e035a4a8ac5d060048325be301000000010000000000000080000000000000008000000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008000000000000000801000000010000100805bb96d39000000f0a36402000000000c4554482d5553442d50455250";

    fn decoded_header(frame: &[u8]) -> Header {
        header(frame).unwrap()
    }

    // The precise funding rate sits in the last 8 bytes of the 240-byte summary block.
    const PRECISE_AT: usize = HEADER_LEN + SUMMARY_FUNDING_PRECISE;

    #[test]
    fn reads_the_header_and_refuses_a_frame_shorter_than_one() {
        let frame = hex(XPT_SNAPSHOT);

        assert_eq!(decoded_header(&frame), Header { block_length: 89, template_id: BOOK, schema_id: SCHEMA_ID });
        assert_eq!(decoded_header(&hex(XPT_SUMMARY)).block_length, 240);
        assert_eq!(decoded_header(&hex(XPT_FUNDING)).block_length, 66);
        assert!(header(&frame[..7]).is_none());
    }

    #[test]
    fn decodes_a_snapshot_with_its_seq_levels_and_market() {
        let frame = hex(XPT_SNAPSHOT);

        let book = book(&frame, &decoded_header(&frame)).unwrap();

        assert_eq!(
            book,
            Book {
                seq: 24435951,
                pkg_type: SNAPSHOT,
                bids: vec![BookLevel { price: 845.3, size: 0.126 }],
                asks: vec![BookLevel { price: 5072.3, size: 0.021 }],
                market: "XPT-USD-PERP",
            }
        );
    }

    #[test]
    fn decodes_a_delta_whose_bids_group_is_empty() {
        let frame = hex(ETH_DELTA);

        let book = book(&frame, &decoded_header(&frame)).unwrap();

        assert_eq!((book.seq, book.pkg_type, book.market), (8109371976, DELTA, "ETH-USD-PERP"));
        assert!(book.bids.is_empty());
        assert_eq!(book.asks, [BookLevel { price: 2466.54, size: 0.4015 }]);
    }

    #[test]
    fn decodes_a_summary_and_prefers_the_precise_funding_rate() {
        let frame = hex(XPT_SUMMARY);

        let summary = summary(&frame, &decoded_header(&frame)).unwrap();

        assert_eq!(
            summary,
            Summary { mark: 1693.38087206, index: 1692.19054, funding_rate: 0.000052967371, market: "XPT-USD-PERP" }
        );
    }

    #[test]
    fn falls_back_to_the_eight_decimal_rate_when_the_precise_one_is_null() {
        let mut frame = hex(XPT_SUMMARY);
        frame[PRECISE_AT..PRECISE_AT + 8].copy_from_slice(&NULL.to_le_bytes());

        let summary = summary(&frame, &decoded_header(&frame)).unwrap();

        assert_eq!(summary.funding_rate, 0.00005296);
    }

    // The version 0 block of 216 bytes stops before forwardRate, so the same frame cut to that block reads the 8 decimal rate.
    #[test]
    fn a_version_0_summary_block_has_no_precise_rate() {
        let full = hex(XPT_SUMMARY);
        let mut frame = full[..HEADER_LEN + 216].to_vec();
        frame.extend_from_slice(&full[HEADER_LEN + 240..]);
        frame[0..2].copy_from_slice(&216u16.to_le_bytes());

        let summary = summary(&frame, &decoded_header(&frame)).unwrap();

        assert_eq!((summary.mark, summary.funding_rate, summary.market), (1693.38087206, 0.00005296, "XPT-USD-PERP"));
    }

    #[test]
    fn a_null_price_reads_as_nan() {
        let mut frame = hex(XPT_SUMMARY);
        frame[HEADER_LEN + SUMMARY_INDEX..HEADER_LEN + SUMMARY_INDEX + 8].copy_from_slice(&NULL.to_le_bytes());

        let summary = summary(&frame, &decoded_header(&frame)).unwrap();

        assert!(summary.index.is_nan());
        assert_eq!(summary.mark, 1693.38087206);
    }

    #[test]
    fn decodes_the_funding_period_in_hours() {
        let frame = hex(XPT_FUNDING);

        assert_eq!(
            funding(&frame, &decoded_header(&frame)).unwrap(),
            Funding { period_hours: 8.0, market: "XPT-USD-PERP" }
        );
    }

    #[test]
    fn a_null_funding_period_reads_as_nan() {
        let mut frame = hex(XPT_FUNDING);
        let at = HEADER_LEN + FUNDING_PERIOD_HOURS;
        frame[at..at + 2].copy_from_slice(&i16::MIN.to_le_bytes());

        assert!(funding(&frame, &decoded_header(&frame)).unwrap().period_hours.is_nan());
    }

    // Every cut of every captured frame fails to decode rather than panicking or reading past the end.
    #[test]
    fn a_frame_cut_anywhere_is_an_error() {
        for (vector, decode) in [
            (XPT_SNAPSHOT, BOOK),
            (ETH_DELTA, BOOK),
            (XPT_SUMMARY, SUMMARY),
            (XPT_FUNDING, FUNDING),
        ] {
            let frame = hex(vector);
            let header = decoded_header(&frame);
            for len in HEADER_LEN..frame.len() {
                let cut = &frame[..len];
                let failed = match decode {
                    BOOK => book(cut, &header).is_err(),
                    SUMMARY => summary(cut, &header).is_err(),
                    _ => funding(cut, &header).is_err(),
                };
                assert!(failed, "template {decode} cut to {len} of {} bytes decoded", frame.len());
            }
        }
    }

    #[test]
    fn a_block_shorter_than_the_fields_read_is_an_error() {
        let mut frame = hex(XPT_SUMMARY);
        frame[0..2].copy_from_slice(&40u16.to_le_bytes());

        let error = summary(&frame, &decoded_header(&frame)).unwrap_err();

        assert!(error.to_string().contains("block of 40 bytes"), "{error:#}");
    }

    // A later version may append fields to each level, so the entry length from the group header steps from level to level.
    #[test]
    fn a_book_entry_longer_than_a_level_is_stepped_over_by_its_length() {
        let frame = hex(XPT_SNAPSHOT);
        let groups = HEADER_LEN + 89;
        let mut wide = frame[..groups].to_vec();
        for side in 0..2 {
            let at = groups + side * (4 + LEVEL_LEN);
            wide.extend_from_slice(&24u16.to_le_bytes());
            wide.extend_from_slice(&frame[at + 2..at + 4 + LEVEL_LEN]);
            wide.extend_from_slice(&[0xee; 8]);
        }
        wide.extend_from_slice(&frame[groups + 2 * (4 + LEVEL_LEN)..]);

        let book = book(&wide, &decoded_header(&wide)).unwrap();

        assert_eq!(book.bids, [BookLevel { price: 845.3, size: 0.126 }]);
        assert_eq!(book.asks, [BookLevel { price: 5072.3, size: 0.021 }]);
        assert_eq!(book.market, "XPT-USD-PERP");
    }
}
