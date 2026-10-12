# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only fee and scope probe for Bitcoin.me, formerly Klever Exchange.

It reads the legacy CEX VIP table, the product and fee sentences in the cex.bitcoin.me bundle,
and how CoinMarketCap and CoinGecko list the venue today.
Run from the repository root: uv run scripts/probes/venues/bitcoin-me/fees-probe.py
Captures go to .claude/survey-work/bitcoin-me/fees-probe.json.
"""

import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/bitcoin-me")
CURL_UA = "curl/8.14.1"
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
REFERER = "https://cex.bitcoin.me/"
VIP = "https://manager.exchange.klever.io/v1/get-vip-level-table"
CEX = "https://cex.bitcoin.me/"
CMC = "https://coinmarketcap.com/exchanges/klever-exchange/"
COINGECKO = "https://api.coingecko.com/api/v3/exchanges/bitcoin-me"
BUNDLE_KEYS = ["subtitle_line6", "list_2", "list_3", "list_4"]


def get(url: str, headers: dict) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as reply:
            return reply.status, reply.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    out: dict = {"started": datetime.now(timezone.utc).isoformat()}

    status, body = get(VIP, {"User-Agent": CURL_UA, "Referer": REFERER})
    out["vip_status"] = status
    levels = json.loads(body)["VipLevels"]
    levels.sort(key=lambda v: v.get("KlvHolding", 0))
    out["vip"] = [
        {
            "level": v["VipLevel"],
            "klv_holding": v.get("KlvHolding", 0),
            "maker_ppm": round(v.get("MakerFee", 0) * 1e6),
            "taker_ppm": round(v.get("TakerFee", 0) * 1e6),
            "klv_maker_ppm": round(v.get("KlvMakerFee", 0) * 1e6),
            "klv_taker_ppm": round(v.get("KlvTakerFee", 0) * 1e6),
            "maker_field_present": "MakerFee" in v,
        }
        for v in levels
    ]
    for row in out["vip"]:
        print("vip", row)
    time.sleep(0.5)

    status, html = get(CEX, {"User-Agent": BROWSER_UA})
    main_js = re.search(r'src="(/static/js/main\.[0-9a-f]+\.js)"', html.decode())
    out["bundle"] = main_js.group(1) if main_js else None
    status, js = get(CEX.rstrip("/") + out["bundle"], {"User-Agent": BROWSER_UA})
    text = js.decode("utf-8", "replace")
    out["bundle_bytes"] = len(js)
    out["bundle_term_counts"] = {term: len(re.findall(term, text, re.I)) for term in ["futures", "perpetual", "funding", "leverage", "contract"]}
    out["bundle_set_trade_fee_klv_call"] = len(re.findall(r'"v1/set-trade-fee-klv\?key="', text))
    print("bundle term counts", out["bundle_term_counts"], "set-trade-fee-klv calls", out["bundle_set_trade_fee_klv_call"])
    out["bundle_strings"] = {}
    for key in BUNDLE_KEYS:
        match = re.search(rf'"{key}":"([^"]*)"', text)
        out["bundle_strings"][key] = match.group(1) if match else None
        print(key, "=", out["bundle_strings"][key])
    time.sleep(0.5)

    status, page = get(CMC, {"User-Agent": BROWSER_UA})
    out["cmc_status"] = status
    page_text = page.decode("utf-8", "replace")
    start = page_text.find('"pageProps":{"info":')
    if start >= 0:
        props, _ = json.JSONDecoder().raw_decode(page_text[start + len('"pageProps":'):])
        info = props["info"]
        pairs = props.get("marketPairsData", {}).get("marketPairsList", [])
        out["cmc"] = {
            "id": info.get("id"),
            "name": info.get("name"),
            "slug": info.get("slug"),
            "notice": info.get("notice"),
            "status": info.get("status"),
            "category": props.get("category"),
            "maker_fee": info.get("makerFee"),
            "taker_fee": info.get("takerFee"),
            "pairs": len(pairs),
            "pair_categories": sorted({p.get("category") for p in pairs}),
            "pair_url_example": pairs[0].get("marketPairDetailUrl") if pairs else None,
            "volume_usd_24h": round(sum(p.get("volume24h") or 0 for p in pairs)),
        }
        print("cmc", out["cmc"])
    time.sleep(0.5)

    status, body = get(COINGECKO, {"User-Agent": CURL_UA})
    out["coingecko_status"] = status
    if status == 200:
        cg = json.loads(body)
        out["coingecko"] = {k: cg.get(k) for k in ("name", "url", "centralized", "trade_volume_24h_btc", "trust_score")}
        out["coingecko"]["tickers"] = [f"{t['base']}/{t['target']}" for t in cg.get("tickers", [])]
        print("coingecko", out["coingecko"])

    (WORK / "fees-probe.json").write_text(json.dumps(out, indent=1))
    print("wrote", WORK / "fees-probe.json")


if __name__ == "__main__":
    main()
