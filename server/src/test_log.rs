// The log capture of opportunity_manager/tests.rs, shared by the tests written after it.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, Once};
use tracing::Level;
use tracing::field::{Field, Visit};
use tracing::subscriber::DefaultGuard;
use tracing_subscriber::Layer;
use tracing_subscriber::layer::{Context, SubscriberExt};

// One log line, its numbers kept apart from its text so a case can compare either.
#[derive(Clone, Debug)]
pub struct Logged {
    pub level: Level,
    pub numbers: HashMap<&'static str, f64>,
    pub texts: HashMap<&'static str, String>,
}

impl Logged {
    #[track_caller]
    pub fn number(&self, field: &str) -> f64 {
        match self.numbers.get(field) {
            Some(value) => *value,
            None => panic!("{field} is not a number on {self:?}"),
        }
    }

    #[track_caller]
    pub fn text(&self, field: &str) -> &str {
        match self.texts.get(field) {
            Some(value) => value,
            None => panic!("{field} is not a text on {self:?}"),
        }
    }

    pub fn has(&self, field: &str) -> bool {
        self.numbers.contains_key(field) || self.texts.contains_key(field)
    }
}

// tracing hands each field of an event to the method for its type.
impl Visit for Logged {
    fn record_f64(&mut self, field: &Field, value: f64) {
        self.numbers.insert(field.name(), value);
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.numbers.insert(field.name(), value as f64);
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.numbers.insert(field.name(), value as f64);
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.texts.insert(field.name(), value.to_string());
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.texts.insert(field.name(), value.to_string());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.texts.insert(field.name(), format!("{value:?}"));
    }
}

// Every log line of the capturing thread, in order.
#[derive(Clone, Default)]
pub struct Logs(Arc<Mutex<Vec<Logged>>>);

impl Logs {
    pub fn lines(&self) -> Vec<Logged> {
        self.0.lock().unwrap().clone()
    }

    pub fn events(&self, event: &str) -> Vec<Logged> {
        let mut found = Vec::new();
        for line in self.lines() {
            if line.texts.get("event").is_some_and(|value| value == event) {
                found.push(line);
            }
        }
        found
    }
}

impl<S: tracing::Subscriber> Layer<S> for Logs {
    fn on_event(&self, event: &tracing::Event<'_>, _context: Context<'_, S>) {
        let mut line = Logged {
            level: *event.metadata().level(),
            numbers: HashMap::new(),
            texts: HashMap::new(),
        };
        event.record(&mut line);
        self.0.lock().unwrap().push(line);
    }
}

// Captures this thread's log lines until the guard drops.
// Lines from another thread are not seen, so a tokio test that wants them runs on the default current thread runtime.
pub fn capture() -> (Logs, DefaultGuard) {
    // Without a global subscriber, a callsite first hit on a thread with no capture can be cached as disabled for every thread.
    static GLOBAL: Once = Once::new();
    GLOBAL.call_once(|| {
        let _ = tracing::subscriber::set_global_default(tracing_subscriber::registry());
    });

    let logs = Logs::default();
    let guard = tracing::subscriber::set_default(tracing_subscriber::registry().with(logs.clone()));
    (logs, guard)
}
