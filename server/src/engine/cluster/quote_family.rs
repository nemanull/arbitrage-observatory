use super::Market;

pub fn cluster_quote(quote: &str) -> &str {
    match quote {
        "USD" | "USDC" => "USDT",
        _ => quote,
    }
}

// A venue contributes one contract per pair. Lower is better: linear before inverse, then the deepest book first.
pub fn market_rank(market: &Market) -> u32 {
    let linear_rank = if market.linear { 0 } else { 10 };
    let quote_rank = match market.quote.as_str() {
        "USDT" => 0,
        "USDC" => 1,
        "USD" => 2,
        _ => 5,
    };
    linear_rank + quote_rank
}
