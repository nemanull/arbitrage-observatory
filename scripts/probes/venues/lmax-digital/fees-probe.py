# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6", "pypdf>=4"]
# ///
"""LMAX fees probe for docs/profiles/lmax-digital/fees.md.

Public, unauthenticated and read-only, about 10 requests.
  1. The LMAX Digital spot fee schedule as the members page prints it, and the entity and regulator lines.
  2. The LMAX Global MU perpetual futures page and factsheet: entity, clients, funding, and any fee or commission wording.
  3. The perpetual futures spec: the commission fields of the client settings call, which needs a token.
  4. CoinGecko's derivatives venue list, for an LMAX entry.
Run from the repository root with: uv run scripts/probes/venues/lmax-digital/fees-probe.py
"""

import html
import io
import json
import re
import urllib.error
import urllib.request

import pypdf
import yaml

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def text_of(page):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page.decode(errors="replace"), flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))


def grep(label, text, pattern, width=220, limit=6):
    hits = [m.group(0).strip() for m in re.finditer(r".{0,%d}(?:%s).{0,%d}" % (width, pattern, width), text, flags=re.I)]
    print(f"   {label}: {len(hits)} matches for {pattern!r}")
    for h in hits[:limit]:
        print("     -", h)


def section1():
    print("== 1. LMAX Digital spot fee schedule")
    status, page = get("https://www.lmaxdigital.com/members/")
    t = text_of(page)
    print(f"   members page status {status}")
    i = t.find("Fee schedule")
    print("   fee block:", t[i:i + 640] if i >= 0 else None)
    grep("entity", t, r"trading name of LMAX Digital Broker Limited", 40, 1)
    status, page = get("https://www.lmaxdigital.com/new-clients/")
    t = text_of(page)
    grep("clients", t, r"Who are the clients of LMAX Digital", 60, 1)
    grep("FinCEN", t, r"Money Services Business", 80, 1)


def section2():
    print("\n== 2. LMAX Global MU perpetual futures")
    status, page = get("https://www.lmax.com/global/mu/perpetual-futures")
    t = text_of(page)
    print(f"   page status {status}")
    grep("product line", t, r"available for professional traders", 120, 1)
    grep("specifications", t, r"Product specifications", 20, 1)
    grep("funding", t, r"funding every 8 hours|Funding: every 8 hours", 80, 2)
    grep("entity", t, r"trading name of LMAX Broker Mauritius Limited", 120, 1)
    grep("fee words on the page", t, r"\bfees?\b|commission|bps|basis point", 80, 6)
    status, pdf = get("https://www.lmax.com/documents/LMAXGlobalPerpetualFuturesFactsheet.pdf")
    reader = pypdf.PdfReader(io.BytesIO(pdf))
    ft = re.sub(r"\s+", " ", " ".join(p.extract_text() for p in reader.pages))
    print(f"   factsheet status {status}, pages {len(reader.pages)}, {len(ft)} characters")
    grep("factsheet fee words", ft, r"\bfees?\b|commission|bps|basis point", 80, 4)
    grep("factsheet funding", ft, r"Funding:", 60, 1)
    grep("factsheet clients", ft, r"professional traders", 80, 1)


def section3():
    print("\n== 3. perpetual futures spec, commission fields")
    status, body = get("https://docs.lmax.com/perps-client-api/change-log.json")
    last = json.loads(body)["versions"][-1]["version"]
    status, body = get(f"https://docs.lmax.com/perps-client-api/rest/{last}/openapi.yaml")
    spec = yaml.safe_load(body)
    print(f"   spec {last}, status {status}")
    op = spec["paths"]["/v1/client-settings"]["get"]
    print("   GET /v1/client-settings security", op.get("security"))
    props = spec["components"]["schemas"]["ClientSettingsResponse"]["properties"]
    for k, v in props.items():
        if re.search(r"(?i)commission", k + json.dumps(v)):
            print(f"     {k}: {json.dumps(v)[:300]}")
    trade = spec["components"]["schemas"]["TradeResponse"]["properties"]
    print("   TradeResponse commission", json.dumps(trade.get("commission"))[:300])


def section4():
    print("\n== 4. CoinGecko derivatives venue list")
    status, body = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    if status != 200:
        print(f"   status {status}: {body[:200]!r}")
        return
    venues = json.loads(body)
    print(f"   status {status}, venues {len(venues)}, LMAX entries {[v for v in venues if 'lmax' in (v['id'] + v['name']).lower()]}")
    status, body = get("https://api.coingecko.com/api/v3/exchanges/list")
    if status == 200:
        ex = json.loads(body)
        print(f"   spot exchange list: {len(ex)} venues, LMAX entries {[v for v in ex if 'lmax' in (v['id'] + v['name']).lower()]}")


section1()
section2()
section3()
section4()
