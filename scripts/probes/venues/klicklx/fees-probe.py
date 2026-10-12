# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""KlicklX fee and access probe for docs/profiles/klicklx/fees.md.

Reads the public help center, the regional restrictions notice, the user terms, the futures risk tiers, and the account fee call without a login.
It also lists the installed CCXT 4.5.68 classes for a KlicklX or IDCM class.
Read-only and unauthenticated, about 12 requests at no more than 1 per second.
Run from the repository root with: uv run scripts/probes/venues/klicklx/fees-probe.py
"""

import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = ROOT / ".claude" / "survey-work" / "klicklx"
CCXT = ROOT / "node_modules" / ".pnpm" / "ccxt@4.5.68" / "node_modules" / "ccxt" / "js" / "src"
BASE = "https://api.klicklx.com/api/idcm/foundation/app"
FUT = "https://ctapi.klicklx.com/api"
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"


def req(url: str, data: bytes | None = None, ctype: str = "application/json"):
    r = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET",
                               headers={"User-Agent": UA, "Accept-Language": "en", "Content-Type": ctype})
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            status, body = resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read().decode("utf-8", "replace")
    time.sleep(1)
    return status, body


def text(content: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", content))).strip()


def article(aid: str) -> str:
    st, body = req(f"{BASE}/HelpCenter/GetHelpCenterShow?id={aid}")
    d = json.loads(body)["Data"]
    return text(d.get("Content") or "")


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    print("== help center categories")
    st, body = req(f"{BASE}/HelpCenter/GetHelpCenterCategoryShowList", b'{"PageIndex":1,"PageSize":50}')
    cats = json.loads(body)
    (OUT / "fees-help-categories.json").write_text(json.dumps(cats, indent=1, ensure_ascii=False))
    titles = [(c["Title"].strip(), h["Title"].strip(), h["Id"]) for c in cats["Data"] for h in c["HelpsList"]]
    print(f"status {st}, categories {cats['TotalItem']}, articles {len(titles)}")
    for cat, t, aid in titles:
        print(f"  [{cat}] {t} ({aid})")
    hits = [t for _, t, _ in titles if re.search(r"futur|perpetual|contract|derivativ|trading fee|maker|taker", t, re.I)]
    print("article titles naming futures, contracts or trading fees:", hits or "none")

    print("\n== regional restrictions notice")
    notice = article("839431674366701568ff42")
    for entity in ("Poland Entity", "UAE Entity"):
        i = notice.find(f"Restricted Countries/Regions under the Klickl {entity}")
        print(f"  {entity}: {notice[i:i + 900] if i >= 0 else 'section not found'}")
    print("  'Canada' in notice:", "Canada" in notice)
    print("  'United States' in notice:", "United States" in notice)

    print("\n== user terms")
    terms = article("774213904318771200d0b9")
    print("  opening:", terms[:420])
    for k in ("futures", "perpetual", "derivative", "leverage", "Fee Schedule"):
        print(f"  occurrences of {k!r}: {len(re.findall(k, terms, re.I))}")

    print("\n== account fee call without a login")
    st, body = req(f"{FUT}/account/GetMyHandlingFee", b"", "application/x-www-form-urlencoded")
    print(f"  POST {FUT}/account/GetMyHandlingFee: {st} {body[:200]}")

    print("\n== BTCUSDT risk tiers, POST /api/baseinfo/GetPositionGearList")
    st, body = req(f"{FUT}/baseinfo/GetPositionGearList", b"contractId=1917057417200713728",
                   "application/x-www-form-urlencoded")
    gears = json.loads(body)
    print(f"  status {st}, total {gears.get('total')}")
    for g in gears["data"]:
        print(f"  gear {g['gear']}: volume {g['minVolumn']} to {g['maxVolumn']}, maintenance {g['keepMargin']}, "
              f"initial {g['minInitialMargin']}, max leverage {g['maxUseLeverage']}")

    print("\n== risk reserve, POST /api/baseinfo/GetRiskReserveList")
    st, body = req(f"{FUT}/baseinfo/GetRiskReserveList", b"contractId=1917057417200713728",
                   "application/x-www-form-urlencoded")
    rr = json.loads(body)
    print(f"  status {st}, rows {len(rr.get('data') or [])}, amounts {sorted({r['amount'] for r in rr.get('data') or []})}")

    print("\n== CCXT 4.5.68")
    files = sorted(p.name for p in CCXT.glob("*.js"))
    print(f"  {len(files)} files in {CCXT.relative_to(ROOT)}")
    print("  names containing klick or idcm:", [f for f in files if re.search("klick|idcm", f, re.I)] or "none")
    hits = [f for f in files if re.search("klickl|idcm", (CCXT / f).read_text(errors="replace"), re.I)]
    print("  files whose source mentions klickl or idcm:", hits or "none")


if __name__ == "__main__":
    main()
