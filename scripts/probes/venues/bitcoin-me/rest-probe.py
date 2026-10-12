# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for Bitcoin.me, formerly Klever Exchange.

It checks the documented public API, the web app's manager API behind Cloudflare,
the last trade of every legacy CEX pair, and the KleverChain DEX API that the brand now runs.
Run from the repository root: uv run scripts/probes/venues/bitcoin-me/rest-probe.py
Captures go to .claude/survey-work/bitcoin-me/rest-probe.json.
"""

import collections
import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

WORK = Path(".claude/survey-work/bitcoin-me")
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
CURL_UA = "curl/8.14.1"
PY_UA = "Python-urllib/3.13"
REFERER = "https://cex.bitcoin.me/"
DOC_API = "https://api.exchange.bitcoin.me"  # the URL docs.bitcoin.me/docs/intro/ names
MANAGER = "https://manager.exchange.klever.io"  # the base URL the cex.bitcoin.me bundle uses
DEX_API = "https://api.bitcoin.me"  # the URL docs.defi.bitcoin.me/api/ names
HOSTS = ["bitcoin.me", "cex.bitcoin.me", "api.exchange.bitcoin.me", "manager.exchange.klever.io", "events.exchange.klever.io", "api.bitcoin.me"]


def request(url: str, headers: dict, timeout: float = 20) -> dict:
    req = urllib.request.Request(url, headers=headers)
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as reply:
            status, hdrs, body = reply.status, dict(reply.headers), reply.read()
    except urllib.error.HTTPError as err:
        status, hdrs, body = err.code, dict(err.headers), err.read()
    ms = round((time.perf_counter() - start) * 1000)
    return {"status": status, "headers": hdrs, "body": body, "ms": ms}


def summary(reply: dict) -> dict:
    text = reply["body"].decode("utf-8", "replace")
    title = re.search(r"<title>([^<]*)</title>", text)
    return {
        "status": reply["status"],
        "ms": reply["ms"],
        "bytes": len(reply["body"]),
        "content_type": reply["headers"].get("Content-Type") or reply["headers"].get("content-type"),
        "server": reply["headers"].get("Server") or reply["headers"].get("server"),
        "title": title.group(1).strip() if title else None,
        "head": None if title else text[:240],
    }


def manager(path: str) -> dict:
    return request(f"{MANAGER}/{path}", {"User-Agent": CURL_UA, "Referer": REFERER})


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    out: dict = {"started": datetime.now(timezone.utc).isoformat()}

    out["dns"] = {}
    for host in HOSTS:
        try:
            out["dns"][host] = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except OSError as err:
            out["dns"][host] = f"error: {err}"
    print("dns", out["dns"])

    out["documented_api"] = {}
    for path in ["v1/market/symbols", "v1/market/tickers", "v1/market/ticker?symbol=KLV-USDT", "v1/market/orderbook?symbol=KLV-USDT&limit=20"]:
        out["documented_api"][path] = summary(request(f"{DOC_API}/{path}", {"User-Agent": CURL_UA}))
        print("documented", path, out["documented_api"][path])
        time.sleep(0.5)

    # Cloudflare in front of the manager API answers by User-Agent and Referer.
    variants = {
        "python ua, no referer": {"User-Agent": PY_UA},
        "browser ua, no referer": {"User-Agent": BROWSER_UA},
        "browser ua, origin only": {"User-Agent": BROWSER_UA, "Origin": "https://cex.bitcoin.me"},
        "curl ua, referer": {"User-Agent": CURL_UA, "Referer": REFERER},
        "python ua, referer": {"User-Agent": PY_UA, "Referer": REFERER},
    }
    out["waf"] = {}
    for name, headers in variants.items():
        out["waf"][name] = summary(request(f"{MANAGER}/v1/networks", headers))
        print("waf", name, out["waf"][name]["status"], out["waf"][name]["title"] or out["waf"][name]["head"][:120])
        time.sleep(0.5)

    timings = []
    for _ in range(3):
        reply = manager("v1/keypairs?Currency=USD")
        timings.append(reply["ms"])
        time.sleep(1)
    out["catalog_ms"] = timings
    catalog = json.loads(reply["body"])["Keypairs"]
    out["catalog_bytes"] = len(reply["body"])
    date_header = reply["headers"].get("Date") or reply["headers"].get("date")
    if date_header:
        out["clock_offset_s"] = round((parsedate_to_datetime(date_header) - datetime.now(timezone.utc)).total_seconds(), 1)
    out["catalog_count"] = len(catalog)
    out["catalog_by_quote"] = dict(collections.Counter(k["Quote"]["Abbr"] for k in catalog))
    out["catalog_fields"] = sorted({f for k in catalog for f in k})
    out["catalog_trading_fee_values"] = dict(collections.Counter(str(k.get("TradingFee")) for k in catalog))
    out["catalog_beta"] = [k["Name"] for k in catalog if k.get("IsBeta")]
    out["catalog_stats_nonempty"] = [k["Name"] for k in catalog if k.get("Stats")]
    out["catalog_updated_max"] = max(k["UpdatedAt"] for k in catalog)
    out["catalog_sample"] = {f: v for f, v in catalog[0].items() if f not in ("Base", "Quote")}
    print("catalog", out["catalog_count"], out["catalog_by_quote"], timings, out.get("clock_offset_s"))

    card = json.loads(manager("v1/keypairs-card?KeypairsLimit=40&TickersLimit=24&TimeRange=HOUR_1&EnforceTimeRange=true&Currency=USD&Featured=false")["body"])["Keypairs"]
    out["card_count"] = len(card)
    out["card_with_tickers"] = sum(1 for c in card if c.get("Tickers"))
    print("card", out["card_count"], "with tickers", out["card_with_tickers"])

    bad = manager("v1/tickers")
    out["error_shape"] = {"status": bad["status"], "body": json.loads(bad["body"])}
    print("error shape", out["error_shape"]["status"], out["error_shape"]["body"].get("code"), out["error_shape"]["body"].get("message"))

    # v1/tickers returns at most Limit candles ending at the newest one inside the window.
    out["last_trade"] = {}
    now = datetime.now(timezone.utc)
    for k in catalog:
        params = {"KeypairID": k["ID"], "TimeRange": "DAY_1", "Limit": 500, "TimeInterval.Begin": "2025-10-01T00:00:00Z", "TimeInterval.Ends": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
        reply = manager("v1/tickers?" + urllib.parse.urlencode(params))
        candles = json.loads(reply["body"]).get("Tickers", []) if reply["status"] == 200 else []
        out["last_trade"][k["Name"]] = candles[-1]["TickerTime"] if candles else None
        time.sleep(0.5)
    dated = [v for v in out["last_trade"].values() if v]
    out["last_trade_newest"] = max(dated) if dated else None
    out["last_trade_none_since_2025_10"] = [n for n, v in out["last_trade"].items() if not v]
    print("newest candle on any pair", out["last_trade_newest"], "pairs with none since 2025-10-01:", len(out["last_trade_none_since_2025_10"]))

    health = request(f"{DEX_API}/health", {"User-Agent": CURL_UA})
    pools_reply = request(f"{DEX_API}/pools", {"User-Agent": CURL_UA})
    pools = json.loads(pools_reply["body"])
    out["dex"] = {
        "health": summary(health),
        "pools_status": pools_reply["status"],
        "pools_ms": pools_reply["ms"],
        "pools": len(pools),
        "pools_quoted_klv": sum(1 for p in pools if p["quoteName"] == "KLV"),
        "tvl_usd": round(sum(float(p.get("value") or 0) for p in pools)),
        "volume_usd_24h": round(sum(float(p.get("volumeUsd") or 0) for p in pools)),
        "largest": max(pools, key=lambda p: float(p.get("value") or 0))["name"],
        "fields": sorted(pools[0]),
    }
    print("dex", {k: v for k, v in out["dex"].items() if k != "fields"})

    (WORK / "rest-probe.json").write_text(json.dumps(out, indent=1, default=str))
    print("wrote", WORK / "rest-probe.json")


if __name__ == "__main__":
    main()
