# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""NexDAX fee and access probe for docs/profiles/nexdax/fees.md.

Public, unauthenticated and read-only.
It checks the venue's web pages as seen from this host, the archived copy of the fee page, CoinMarketCap's exchange record, the API's fee paths, and whether CCXT has a NexDAX class.
Run from the repository root with: uv run scripts/probes/venues/nexdax/fees-probe.py
"""

import json
import pathlib
import re
import urllib.error
import urllib.request

UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}
ROOT = pathlib.Path(__file__).resolve().parents[4]
CCXT_SRC = ROOT / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def get(url, follow=True):
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(urllib.request.Request(url, headers=UA), timeout=60) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "replace")
    except Exception as e:  # timeouts and resets are facts about access too
        return None, {}, f"{type(e).__name__}: {e}"


def text_of(html):
    t = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", " ", html)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t)).strip()


def main():
    print("== web pages from this host, redirects not followed")
    for path in ("/", "/trading-rule.html", "/terms-of-use.html", "/exchange-advanced.html?symbol=BTC_USDT"):
        st, h, body = get("https://nexdax.com" + path, follow=False)
        hl = {k.lower(): v for k, v in h.items()}
        print(path, st, "location", hl.get("location"), "cf-ray", hl.get("cf-ray"), "body", body[:60])
    st, h, body = get("https://nexdax.com/forbidden.html")
    print("forbidden.html", st, "text", text_of(body)[:700])
    st, h, body = get("https://www.nexdax.com/", follow=False)
    print("www.nexdax.com", st, body[:80])

    print("\n== archived fee page")
    st, h, body = get("https://archive.org/wayback/available?url=nexdax.com/trading-rule.html")
    print("availability", st, body[:300])
    try:
        snap = json.loads(body)["archived_snapshots"]["closest"]["timestamp"]
    except Exception:
        snap = None
    if snap:
        st, h, body = get(f"https://web.archive.org/web/{snap}id_/https://nexdax.com/trading-rule.html")
        print("snapshot", snap, "status", st, "bytes", len(body))
        t = text_of(body)
        for m in re.finditer(r"(?i)(maker|taker|fee)", t):
            print("  ...", t[max(0, m.start() - 120): m.start() + 160])
            break

    print("\n== CoinMarketCap exchange record")
    st, h, body = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=nexdax")
    d = json.loads(body)["data"]
    print("status", st, "name", d["name"], "id", d["id"], "makerFee", d.get("makerFee"), "takerFee", d.get("takerFee"))
    print("dateLaunched", d.get("dateLaunched"), "countries", d.get("countries"), "fiats", d.get("fiats"))
    print("urls.fee", d["urls"].get("fee"), "website", d["urls"].get("website"))
    print("description starts", d.get("description", "")[:160].replace("\r\n", " "))

    print("\n== API fee paths")
    for path in ("/api/v1/tradeFee", "/api/v1/fees", "/sapi/v1/asset/tradeFee", "/api/v1/account"):
        st, h, body = get("https://api.nexdax.com" + path)
        print(path, st, body[:100])

    print("\n== CCXT")
    files = sorted(p.name for p in CCXT_SRC.glob("*.js"))
    print("4.5.68 js/src files", len(files), "nexdax.js present", "nexdax.js" in files)
    hits = [p.name for p in CCXT_SRC.glob("*.js") if "nexdax" in p.read_text(errors="replace").lower()]
    print("4.5.68 files containing 'nexdax'", hits)
    st, h, body = get("https://api.github.com/repos/ccxt/ccxt/commits/master")
    c = json.loads(body)
    print("ccxt master", c["sha"], c["commit"]["committer"]["date"])
    st, h, body = get(f"https://api.github.com/repos/ccxt/ccxt/contents/ts/src?ref={c['sha']}")
    names = [x["name"] for x in json.loads(body)]
    ts = [n for n in names if n.endswith(".ts")]
    print("master ts/src entries", len(names), "ts files", len(ts), "names with nex or dax", [n for n in names if "nex" in n.lower() or "dax" in n.lower()])
    st, h, body = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    print("master exchanges.json lists nexdax", "nexdax" in body.lower())


if __name__ == "__main__":
    main()
