# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Ulink (ulinkex.com) fee probe for docs/profiles/ulink/fees.md.

Public, unauthenticated and read-only, about 20 requests to the Zendesk help center API and the site.
  1. The help center from this host: the browser page and the article list through the JSON API.
  2. The fee, funding, spot, rebate and agreement articles, with the sentences the profile quotes.
  3. The image attachments that carry the rebate tier tables, fetched to record that they exist.
  4. The fee fields of the live catalog beside the published rate, and where the bundle reads commissionRate.
Run from the repository root with: uv run scripts/probes/venues/ulink/fees-probe.py
"""

import collections
import html
import json
import re
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json, text/html, */*"}
HC = "https://ulinkinc.zendesk.com"
SITE = "https://ulinkex.com"
ARTICLES = {
    7617336092815: ["Taker: 0.04%", "Maker: 0.04%", "Marked price = median", "every 8 hours", "absolute upper limit of the funding rate is 0.15%",
                    "Reference trading markets include", "risk rate is lower than 10%", "does not charge any funding fees"],
    7617335375631: ["0.05%, -0.05%", "0.15%", "UTC+8 00:00"],
    7853411658639: ["both 0", "0.1% fees will be charged"],
    7853520993167: ["transaction fee for each transaction", "exercise fee"],
    15184642171279: ["Calendar month", "KYC", "Futures Account (USDT)"],
    16725080662543: ["Real-Time Rebate", "following month"],
    13808478095631: ["September 19, 2025", "20% of the actual transaction fees"],
    7617423580559: ["neither from the United States or Canada", "deep links", "Place of Arbitration"],
    7617401184911: ["multiple accounts", "ultra-short-term"],
    7617491271311: ["Ulink LTD", "MSB"],
    7617385903375: ["full Trading Fee Rebates"],
    7617363761167: ["0.075% of the transaction amount", "settlement time is 04:00", "x 0.02%"],
}
IMAGES = (15184642171023, 16725080662159)


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000
    except Exception as e:
        return None, {}, f"{type(e).__name__}: {e}".encode(), (time.perf_counter() - t0) * 1000


def plain(body_html):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", body_html))).strip()


def section_hc():
    print("== 1. Help center")
    st, hd, body, ms = get(HC + "/hc/en-us")
    print(f"{HC}/hc/en-us: {st} {len(body)} bytes {ms:.0f} ms server={hd.get('Server') or hd.get('server')}")
    st, hd, body, ms = get(HC + "/api/v2/help_center/en-us/articles.json?per_page=100")
    j = json.loads(body) if st == 200 else {}
    print(f"article list: {st}, count {j.get('count')}")
    for a in j.get("articles", []):
        if any(w in a["title"].lower() for w in ("fee", "rebate", "cashback", "contract guides", "funding", "spot", "agreement", "terms", "msb", "sec")):
            print(f"  {a['id']} updated {a['updated_at'][:10]} {a['title']}")


def section_articles():
    print("== 2. Articles")
    for aid, needles in ARTICLES.items():
        st, hd, body, ms = get(f"{HC}/api/v2/help_center/en-us/articles/{aid}.json")
        if st != 200:
            print(f"{aid}: {st} {body[:120]!r}")
            continue
        a = json.loads(body)["article"]
        t = plain(a["body"])
        print(f"{aid}: {a['title']!r} updated {a['updated_at']} {len(t)} chars, images {len(re.findall(r'<img', a['body']))}, tables {len(re.findall(r'<table', a['body']))}")
        for n in needles:
            i = t.find(n)
            print(f"  [{n}] {t[max(0, i - 120):i + 180] if i >= 0 else 'not found'}")


def section_images():
    print("== 3. Tier table images")
    for img in IMAGES:
        st, hd, body, ms = get(f"{HC}/hc/article_attachments/{img}")
        print(f"attachment {img}: {st} {hd.get('Content-Type')} {len(body)} bytes")


def section_catalog():
    print("== 4. Catalog fee fields and the bundle")
    st, hd, body, ms = get(SITE + "/v1/cfd/public/instruments")
    on = [x for x in json.loads(body)["data"] if x["status"] == "online"]
    for k in ("takerFee", "makerFee", "commissionRate", "openSpread", "closeSpread", "settlementRate"):
        print(f"  {k}:", collections.Counter(x[k] for x in on).most_common(5))
    st, hd, body, ms = get(SITE + "/v1/cfd/public/spot_instruments")
    sp = json.loads(body)["data"]
    print("  spot takerFee:", collections.Counter(x.get("takerFee") for x in sp), "makerFee:", collections.Counter(x.get("makerFee") for x in sp))
    st, hd, body, ms = get(SITE + "/")
    app = re.search(r'src="/(app\.[0-9a-f]+\.js)"', body.decode()).group(1)
    st, hd, js, ms = get(f"{SITE}/{app}", timeout=60)
    s = js.decode("utf-8", "replace")
    print(f"  {app}: reads takerFee {'takerFee' in s}, reads makerFee {'makerFee' in s}, reads commissionRate {'commissionRate' in s}")
    m = re.search(r'"commissionRate"\]\)[^}]{0,200}?PROFESSIONA', s)
    print("  commissionRate read next to the PROFESSIONA (Lightning) branch:", m is not None)


if __name__ == "__main__":
    section_hc()
    section_articles()
    section_images()
    section_catalog()
