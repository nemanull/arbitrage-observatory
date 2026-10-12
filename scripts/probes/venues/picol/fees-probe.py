# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Picol fee, terms and CCXT probe for docs/profiles/picol/fees.md.

Read-only and unauthenticated, about a dozen requests, one of them the 9.8 MB web app bundle.
It reads the VIP fee table that the Picol web app loads, the product names and links inside the web app bundle, the same table on Pionex for comparison, the eligibility clause of the terms, two help pages, and the CCXT sources.
Run from the repository root with: uv run scripts/probes/venues/picol/fees-probe.py
"""

import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}
ROOT = pathlib.Path(__file__).resolve().parents[4]
CCXT = ROOT / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt"


def fetch(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            status = r.status
    except urllib.error.HTTPError as exc:
        status, body = exc.code, exc.read().decode("utf-8", "replace")
    time.sleep(0.5)
    return status, body


def text_of(page: str) -> str:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))


def ppm(x: float) -> int:
    return round(x * 1_000_000)


def vip_tables() -> None:
    print("\n=== VIP fee table loaded by the web app")
    tables = {}
    for name, url in [
        ("Picol", "https://config.picol.com/vipLevelConfig.picol.json"),
        ("Pionex", "https://config.pionex.com/vipLevelConfig.json"),
    ]:
        status, body = fetch(url)
        tables[name] = json.loads(body)
        print(f"{name} {url}: HTTP {status}, {len(tables[name])} levels")
    print("level, futures volume rule, Picol futures maker and taker ppm, Picol spot maker and taker ppm, Pionex futures maker and taker ppm")
    for a, b in zip(tables["Picol"], tables["Pionex"]):
        print(
            f"{a['level']}: futureVol >= {a.get('futureVol', 'none')} USDT, spotAndLeverageVol >= {a.get('spotAndLeverageVol', 'none')},"
            f" earnAveDailyAmount >= {a.get('earnAveDailyAmount')},"
            f" Picol futures {ppm(a['futureMaker'])}/{ppm(a['futureTaker'])}, spot {ppm(a['spotMaker'])}/{ppm(a['spotTaker'])},"
            f" Pionex futures {ppm(b['futureMaker'])}/{ppm(b['futureTaker'])}, spot {ppm(b['spotMaker'])}/{ppm(b['spotTaker'])}"
        )
    print("Picol vip0 row:", json.dumps(tables["Picol"][0], ensure_ascii=False, separators=(",", ":")))


def terms() -> None:
    print("\n=== Terms of service")
    status, page = fetch("https://www.picol.com/blog/en/picol-terms-of-service/")
    t = text_of(page)
    m = re.search(r"Picol Terms of Service Uncategorized / (\w+ \d+, \d{4}) (\w+ \d+, \d{4})", t)
    print(f"HTTP {status}, published and updated: {m.groups() if m else 'not found'}")
    i = t.find("constitute the agreement")
    print("party:", t[i - 40 : i + 120])
    i = t.find("You are not in, under the control of")
    j = t.find("(each a", i)
    print("eligibility:", t[i : j + 40])
    i = t.find("governed by and interpreted")
    print("law:", t[i - 30 : i + 110])
    for country in ("Canada", "United States", "Taiwan", "China", "Hong Kong"):
        print(f"{country} in the Prohibited Jurisdiction list: {country in t[t.find('You are not in, under the control of'):j]}")


def help_pages() -> None:
    print("\n=== Help pages")
    status, page = fetch("https://www.picol.com/blog/en/funding-fee/")
    t = text_of(page)
    i = t.find("Funding Rate (F) =")
    print(f"funding-fee HTTP {status}: {t[i : i + 150]}")
    status, page = fetch("https://www.picol.com/blog/en/liquidation/")
    t = text_of(page)
    i = t.find("the trading fee ratio is up to")
    print(f"liquidation HTTP {status}: {t[i - 60 : i + 260]}")


def bundle() -> None:
    print("\n=== Web app bundle")
    status, page = fetch("https://www.picol.com/en/fees")
    m = re.search(r'src="(/static/js3/main\.[^"]+\.js)"', page)
    print(f"/en/fees: HTTP {status}, {len(page)} characters, main bundle {m.group(1) if m else 'not found'}")
    status, js = fetch("https://www.picol.com" + m.group(1))
    print(f"bundle: HTTP {status}, {len(js):,} characters")
    for needle in [
        'e.PICOL="picol",e.PIONEX_COL="pionex_col"',
        'e.PICOL_TW="picol.tw"',
        'e.WEBOT="webot"',
        '_CODE:"pionex_col"',
        'p("stream-v3","wss:")',
        '"/vipLevelConfig").concat(".picol",".json")',
        "futures_fee_discount",
        "notice.futures_fee.enjoying",
        "https://picol-doc.gitbook.io/apidocs",
        "the-trading-pairs-included-in-the-vip-program-commission-rebate",
        "support.picol.com/hc/zh-tw/",
        "wss://stream-v3.pionex.com",
    ]:
        print(f"{needle}: {js.count(needle)}")
    i = js.find("picol_notice_content:")
    print("Picol notice opens with:", json.loads(js[i + len("picol_notice_content:") : js.find('",', i) + 1])[:40])


def ccxt() -> None:
    print("\n=== CCXT")
    version = json.loads((CCXT / "package.json").read_text())["version"]
    files = sorted(p.name for p in (CCXT / "js/src").glob("*.js"))
    hits = [f for f in files if "picol" in f or "pionex" in f]
    print(f"installed {version}: {len(files)} files in js/src, picol or pionex files {hits}")
    index = (CCXT / "js/ccxt.js").read_text()
    print(f"'picol' in js/ccxt.js: {'picol' in index.lower()}, 'pionex': {'pionex' in index.lower()}")
    status, body = fetch("https://api.github.com/repos/ccxt/ccxt/git/trees/master?recursive=1")
    tree = json.loads(body)
    src = [e["path"] for e in tree.get("tree", []) if e["path"].startswith("ts/src/") and e["path"].count("/") == 2 and e["path"].endswith(".ts")]
    hits = [p for p in src if "picol" in p or "pionex" in p]
    print(f"GitHub master: HTTP {status}, truncated {tree.get('truncated')}, {len(src)} files directly under ts/src, picol or pionex files {hits}")


def main() -> None:
    print(f"run at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    vip_tables()
    terms()
    help_pages()
    bundle()
    ccxt()


if __name__ == "__main__":
    main()
