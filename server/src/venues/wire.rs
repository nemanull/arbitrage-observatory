use crate::engine::cluster::BookLevel;
use serde::de::{self, Deserialize, Deserializer, IgnoredAny, SeqAccess, Visitor};
use std::fmt;

// Unlike Number, an empty string is NaN rather than 0.
pub fn number(text: &str) -> f64 {
    text.parse().unwrap_or(f64::NAN)
}

// The default of a missing field read with num, as Number(undefined) was NaN.
pub fn nan() -> f64 {
    f64::NAN
}

// A decimal string, a JSON number or a null, for #[serde(deserialize_with)].
pub fn num<'de, D: Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    deserializer.deserialize_any(NumVisitor)
}

// An array of levels, each an array of price then size as strings or numbers, where later entries such as okx's order count are skipped.
// A null reads as no levels.
pub fn levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    deserializer.deserialize_any(LevelsVisitor)
}

struct NumVisitor;

impl<'de> Visitor<'de> for NumVisitor {
    type Value = f64;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a number, a decimal string or null")
    }

    fn visit_f64<E>(self, value: f64) -> Result<f64, E> {
        Ok(value)
    }

    fn visit_u64<E>(self, value: u64) -> Result<f64, E> {
        Ok(value as f64)
    }

    fn visit_i64<E>(self, value: i64) -> Result<f64, E> {
        Ok(value as f64)
    }

    fn visit_str<E>(self, value: &str) -> Result<f64, E> {
        Ok(number(value))
    }

    fn visit_unit<E>(self) -> Result<f64, E> {
        Ok(f64::NAN)
    }

    fn visit_none<E>(self) -> Result<f64, E> {
        Ok(f64::NAN)
    }
}

struct Num(f64);

impl<'de> Deserialize<'de> for Num {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        num(deserializer).map(Num)
    }
}

struct Level(BookLevel);

impl<'de> Deserialize<'de> for Level {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(LevelVisitor)
    }
}

struct LevelVisitor;

impl<'de> Visitor<'de> for LevelVisitor {
    type Value = Level;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a level array of price then size")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Level, A::Error> {
        let Some(Num(price)) = seq.next_element()? else {
            return Err(de::Error::invalid_length(0, &self));
        };
        let Some(Num(size)) = seq.next_element()? else {
            return Err(de::Error::invalid_length(1, &self));
        };
        while seq.next_element::<IgnoredAny>()?.is_some() {}

        Ok(Level(BookLevel { price, size }))
    }
}

struct LevelsVisitor;

impl<'de> Visitor<'de> for LevelsVisitor {
    type Value = Vec<BookLevel>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an array of levels or null")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut levels = Vec::with_capacity(seq.size_hint().unwrap_or(0));
        while let Some(Level(level)) = seq.next_element()? {
            levels.push(level);
        }
        Ok(levels)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Row {
        #[serde(deserialize_with = "num")]
        value: f64,
        #[serde(default = "nan", deserialize_with = "num")]
        missing: f64,
    }

    #[derive(Deserialize)]
    struct Book {
        #[serde(default, deserialize_with = "levels")]
        b: Vec<BookLevel>,
    }

    fn level(price: f64, size: f64) -> BookLevel {
        BookLevel { price, size }
    }

    fn value(json: &str) -> f64 {
        serde_json::from_str::<Row>(json).unwrap().value
    }

    fn book(json: &str) -> Vec<BookLevel> {
        serde_json::from_str::<Book>(json).unwrap().b
    }

    #[test]
    fn number_reads_decimals_and_exponents_and_is_nan_on_anything_else() {
        assert_eq!(number("79909.30"), 79909.3);
        assert_eq!(number("7.548E+4"), 75480.0);
        assert_eq!(number("1e-5"), 0.00001);
        assert!(number("").is_nan());
        assert!(number(" 1").is_nan());
        assert!(number("abc").is_nan());
    }

    #[test]
    fn num_reads_a_decimal_string_a_number_and_a_null() {
        assert_eq!(value(r#"{"value":"0.0001"}"#), 0.0001);
        assert_eq!(value(r#"{"value":42}"#), 42.0);
        assert_eq!(value(r#"{"value":-3}"#), -3.0);
        assert_eq!(value(r#"{"value":1.5e3}"#), 1500.0);
        assert_eq!(value(r#"{"value":1790841600000}"#), 1_790_841_600_000.0);
        assert!(value(r#"{"value":null}"#).is_nan());
        assert!(value(r#"{"value":""}"#).is_nan());
    }

    #[test]
    fn a_missing_field_defaults_to_nan() {
        let row: Row = serde_json::from_str(r#"{"value":"1"}"#).unwrap();

        assert!(row.missing.is_nan());
    }

    #[test]
    fn num_refuses_a_value_that_is_no_number_at_all() {
        assert!(serde_json::from_str::<Row>(r#"{"value":true}"#).is_err());
        assert!(serde_json::from_str::<Row>(r#"{"value":[1]}"#).is_err());
    }

    #[test]
    fn levels_read_string_pairs() {
        assert_eq!(
            book(r#"{"b":[["79909.30","23.163"],["79909.20","1.500"]]}"#),
            [level(79909.3, 23.163), level(79909.2, 1.5)]
        );
    }

    #[test]
    fn levels_skip_every_entry_after_the_size() {
        // okx sends a deprecated field and an order count, mexc sends numbers and an order count.
        assert_eq!(book(r#"{"b":[["8476.98","415","0","13"]]}"#), [level(8476.98, 415.0)]);
        assert_eq!(book(r#"{"b":[[7.548E+4,12,3]]}"#), [level(75480.0, 12.0)]);
    }

    #[test]
    fn levels_read_a_null_an_empty_array_and_an_absent_field_as_no_levels() {
        assert!(book(r#"{"b":null}"#).is_empty());
        assert!(book(r#"{"b":[]}"#).is_empty());
        assert!(book(r#"{}"#).is_empty());
    }

    #[test]
    fn a_level_with_a_bad_number_keeps_its_place_as_nan() {
        let levels = book(r#"{"b":[["x","1"]]}"#);

        assert!(levels[0].price.is_nan());
        assert_eq!(levels[0].size, 1.0);
    }

    #[test]
    fn a_level_without_a_size_refuses_the_frame() {
        assert!(serde_json::from_str::<Book>(r#"{"b":[["1"]]}"#).is_err());
        assert!(serde_json::from_str::<Book>(r#"{"b":["1","2"]}"#).is_err());
    }
}
