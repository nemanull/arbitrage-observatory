# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only access probe for CoinP.

Checks whether any CoinP host answers, what the Cloudflare edge returns, and what the third-party listings say.
Every request is a single public GET, so the venue's limits are never approached.

Run from the repository root:
    uv run scripts/probes/venues/coinp/rest-probe.py
"""

import json
import re
import socket
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

WORK = Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "coinp"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

HOSTS = [
    "coinp.com",
    "www.coinp.com",
    "api.coinp.com",
    "openapi.coinp.com",
    "www.coinp1000.com",
    "coinp1000.com",
    "coinp.io",
    "www.coinp.io",
    "no-such-label-7f3a.coinp.com",  # tests for a wildcard record
]

# Common public market data paths on exchange APIs. CoinP publishes none, so these are guesses.
PATHS = [
    ("www.coinp.com", "/"),
    ("www.coinp.com", "/en/fee"),
    ("www.coinp.com", "/robots.txt"),
    ("www.coinp.com", "/api/v1/common/symbols"),
    ("api.coinp.com", "/"),
    ("api.coinp.com", "/api/v1/time"),
    ("api.coinp.com", "/fapi/v1/exchangeInfo"),
    ("openapi.coinp.com", "/sapi/v1/symbols"),
    ("www.coinp1000.com", "/"),
    ("www.coinp.io", "/"),
]


def resolve(host: str) -> list[str]:
    try:
        return sorted({ai[4][0] for ai in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
    except socket.gaierror as e:
        return [f"unresolved: {e.strerror}"]


def get(url: str, timeout: float = 20.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            body = r.read()
            status, headers = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        body, status, headers = e.read(), e.code, dict(e.headers)
    except (urllib.error.URLError, OSError) as e:
        return {"url": url, "error": str(getattr(e, "reason", e)), "ms": round((time.perf_counter() - t0) * 1000)}
    return {
        "url": url,
        "status": status,
        "ms": round((time.perf_counter() - t0) * 1000),
        "server": headers.get("Server") or headers.get("server"),
        "cf_ray": headers.get("CF-RAY") or headers.get("cf-ray"),
        "content_type": headers.get("Content-Type") or headers.get("content-type"),
        "bytes": len(body),
        "body_head": body[:120].decode("utf-8", "replace"),
        "_body": body,
    }


def show(r: dict) -> None:
    out = {k: v for k, v in r.items() if not k.startswith("_")}
    body = r.get("_body", b"").decode("utf-8", "replace")
    title = re.search(r"<title>([^<]*)</title>", body)
    if title:
        out["title"] = " ".join(title.group(1).split())
    if r.get("status") == 521:
        out.pop("body_head", None)
    print(json.dumps(out, ensure_ascii=False))


def get_with_backoff(url: str) -> dict:
    r = get(url)
    if r.get("status") == 429:
        time.sleep(30)  # CoinGecko's public tier answers 429 to a shared exit, one slow retry stays polite
        r = get(url)
    return r


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print("# probe started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))

    print("\n## exit")
    trace = get("https://www.coinp.com/cdn-cgi/trace")
    print({k: v for k, v in (ln.split("=", 1) for ln in trace.get("_body", b"").decode().splitlines() if "=" in ln) if k in ("ip", "colo", "loc", "http")})

    print("\n## DNS")
    for h in HOSTS:
        print(f"{h:32} {' '.join(resolve(h))}")

    print("\n## HTTP, one GET each, twice for www.coinp.com / to see cold and warm time")
    for host, path in PATHS:
        show(get(f"https://{host}{path}"))
    show(get("https://www.coinp.com/"))

    print("\n## CoinMarketCap exchange page")
    page = get("https://coinmarketcap.com/exchanges/coinp/")
    show(page)
    html = page.get("_body", b"").decode("utf-8", "replace")
    (WORK / "cmc.html").write_text(html)
    m = re.search(r'"id":12030,"name":"CoinP".*?"urls":(\{.*?\}),"isHidden"', html, re.S)
    print("urls", m.group(1) if m else None)
    for key in ("makerFee", "takerFee", "dateLaunched", "countries", "status"):
        mm = re.search(rf'"{key}":("[^"]*"|\[[^\]]*\]|[0-9.]+)', html)
        print(key, mm.group(1) if mm else None)
    q = re.search(r'"quote":\{"1":\{.*?\},"2781":(\{.*?\})\}', html)
    print("usd quote", q.group(1) if q else None)
    d = re.search(r'"description":"(### What is CoinP\?.*?)","dateLaunched"', html, re.S)
    if d:
        for sentence in ("0.1% on spot", "0.06% for Takers", "100X leverage", "founded in Singapore"):
            print("description mentions", repr(sentence), sentence in d.group(1))

    print("\n## CoinMarketCap market pairs API")
    for cat in ("spot", "perpetual", "futures"):
        r = get(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=coinp&category={cat}&start=1&limit=100")
        try:
            data = json.loads(r["_body"])["data"]
            print(cat, r["status"], "numMarketPairs", data["numMarketPairs"], "listed", len(data["marketPairs"]), "quotes", data["quotes"])
        except Exception as e:  # noqa: BLE001
            print(cat, r.get("status"), r.get("error"), e)

    print("\n## CoinGecko")
    for url in ("https://api.coingecko.com/api/v3/exchanges/coinp", "https://api.coingecko.com/api/v3/derivatives/exchanges/coinp"):
        show(get_with_backoff(url))

    print("\n## CCXT master on GitHub")
    root = get("https://api.github.com/repos/ccxt/ccxt/git/trees/master")
    try:
        tree = json.loads(root["_body"])
        ts = next(t for t in tree["tree"] if t["path"] == "ts")
        src = next(t for t in json.loads(get(ts["url"])["_body"])["tree"] if t["path"] == "src")
        names = [t["path"] for t in json.loads(get(src["url"])["_body"])["tree"]]
        print("master", tree["sha"], "ts/src entries", len(names), "coinp present", any(n.lower().startswith("coinp") for n in names))
    except Exception as e:  # noqa: BLE001
        print("github", root.get("status"), e)

    print("\n## Telegram channel named by CoinMarketCap")
    tg = get("https://t.me/coinp_en")
    body = tg.get("_body", b"").decode("utf-8", "replace")
    title = re.search(r'property="og:title" content="([^"]*)"', body)
    members = re.search(r'tgme_page_extra">([^<]*)', body)
    print(tg.get("status"), title.group(1) if title else None, members.group(1) if members else None)

    print("\n## Medium blog named by CoinMarketCap, RSS feed")
    feed = get("https://medium.com/feed/@CoinP_")
    xml = feed.get("_body", b"").decode("utf-8", "replace")
    print(feed.get("status"), "items", xml.count("<item>"))

    print("\n## GitHub repository search for a CoinP API")
    gh = get("https://api.github.com/search/repositories?q=%22coinp.com%22")
    try:
        found = json.loads(gh["_body"])
        print(gh["status"], "total", found["total_count"], [i["full_name"] for i in found["items"][:10]], "any coinp-named", any(i["name"].lower().startswith("coinp-") or i["name"].lower() == "coinp" for i in found["items"]))
    except Exception as e:  # noqa: BLE001
        print(gh.get("status"), e)

    print("\n## Wayback Machine capture index, one attempt")
    wb = get("https://web.archive.org/cdx/search/cdx?url=coinp.com/*&collapse=urlkey&fl=timestamp,original,statuscode&limit=300")
    show(wb)


if __name__ == "__main__":
    main()
