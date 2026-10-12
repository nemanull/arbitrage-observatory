# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CEEX fees probe for docs/profiles/ceex/fees.md.

Public, unauthenticated and read-only, about 12 requests.
  1. The public user level table /api/user/get_userlevel_configs, with its discounts and token discount.
  1b. The announcement list /s_api/basic/announcements, and the fee announcements through /api/ceex/basic/announcement.
  2. Whether any public catalog or socket field carries a fee rate, and the login wall on the account calls.
  3. The fee article CoinMarketCap links, its help center root, and the Wayback Machine record of the article.
  4. Whether CCXT 4.5.68 or the current CCXT master has a class for CEEX.
Run from the repository root with: uv run scripts/probes/venues/ceex/fees-probe.py
"""

import json
import pathlib
import re
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json, text/html, */*"}
SITE = "https://www.ceex.com"
ARTICLE = "https://ceexglobal.zendesk.com/hc/en-001/articles/33783887284761-CEEX-Fees-Overview"
CCXT_SRC = pathlib.Path(__file__).resolve().parents[4] / "node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src"


def get(url, timeout=30, redirect=True):
    url = url if url.startswith("http") else SITE + url
    req = urllib.request.Request(url, headers=UA)
    opener = urllib.request.build_opener() if redirect else urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    except Exception as e:  # DNS failure, TLS error, timeout
        return None, {}, f"{type(e).__name__}: {e}".encode()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def text(body, n=300):
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def section_levels():
    print("== 1. User level table")
    st, h, body = get("/api/user/get_userlevel_configs")
    print(f"get_userlevel_configs: {st}, {len(body)} bytes")
    j = json.loads(body)
    for lv in j["levelConfigs"]:
        print(f"  {lv['levelName']}: " + ", ".join(f"{k} {v}" for k, v in lv.items() if k.endswith("Discount")))
    print(f"  haveTokenDiscount {json.dumps(j.get('haveTokenDiscount'))}")


def section_announcements():
    print("== 1b. Announcements")
    st, h, body = get("/s_api/basic/announcements?type=0&page=1")
    rows = json.loads(body)
    print(f"announcement list: {st}, {len(rows)} rows")
    for a in rows:
        if re.search("fee|contract|perpetual|futures|migration", a["title"], re.I):
            print(f"  {a['id']} {time.strftime('%Y-%m-%d', time.gmtime(int(a['publishTime']) / 1000))} {a['title']}")
    for nid in (1680, 1635, 1617):
        st, h, body = get(f"/api/ceex/basic/announcement?id={nid}")
        d = json.loads(body)["data"]
        detail = re.sub(r"<[^>]+>", " ", d.get("detail") or "").replace("&nbsp;", " ")
        detail = re.sub(r"\s+", " ", detail).strip()
        print(f"  {nid}: {st}, published {time.strftime('%Y-%m-%d %H:%M', time.gmtime(int(d['publishTime']) / 1000))} UTC, title {d['title']!r}")
        print(f"    detail {detail!r}, directUrl {d.get('directUrl')!r}")
        if d.get("directUrl"):
            st2, h2, _ = get(d["directUrl"], redirect=False)
            print(f"    directUrl first hop: {st2}, location {str(h2.get('location'))[:90]!r}")


def section_fields():
    print("== 2. Fee fields in public replies, and the login wall")
    st, h, body = get("/api/v3/triggerContract/system/getContractConfigAllList")
    row = json.loads(body)["data"][0]
    print(f"catalog row fee-like fields: { {k: v for k, v in row.items() if re.search('fee|taker|maker|rate', k, re.I)} }")
    st, h, body = get("/openapi/v1/brokerInfo")
    j = json.loads(body)
    keys = set()
    for s in j["symbols"] + j["contracts"]:
        keys.update(k for k in s if re.search("fee|taker|maker", k, re.I))
    print(f"brokerInfo fee-like keys across symbols and contracts: {sorted(keys)}")
    for p in ("/api/v3/triggerContract/pageCalculate/getContractAccountInfo", "/api/user/get_userlevel_info"):
        st, h, body = get(p)
        print(f"{p}: {st} {text(body, 120)}")


def section_article():
    print("== 3. Fee article")
    st, h, body = get(ARTICLE, redirect=False)
    title = re.search(rb"<title>(.*?)</title>", body)
    print(f"article, first hop: {st}, {len(body)} bytes, server {h.get('server')!r}, cf-mitigated {h.get('cf-mitigated')!r}, location {h.get('location')!r}, title {title.group(1).decode() if title else None!r}")
    st, h, body = get(ARTICLE)
    title = re.search(rb"<title>(.*?)</title>", body)
    print(f"article, redirects followed: {st}, {len(body)} bytes, title {title.group(1).decode() if title else None!r}")
    st, h, body = get("https://ceexglobal.zendesk.com/hc/en-001", redirect=False)
    print(f"help center en-001 root: {st}, location {h.get('location')!r}")
    st, h, body = get("https://ceexglobal.zendesk.com/", redirect=False)
    print(f"help center root: {st}, location {h.get('location')!r}")
    st, h, body = get("https://archive.org/wayback/available?url=" + ARTICLE.removeprefix("https://"))
    print(f"wayback availability: {st} {text(body, 400)}")
    try:
        snap = json.loads(body)["archived_snapshots"]["closest"]
    except (ValueError, KeyError):
        return
    raw = snap["url"].replace("/web/" + snap["timestamp"] + "/", "/web/" + snap["timestamp"] + "id_/").replace("http://", "https://")
    for attempt in range(2):
        st, h, body = get(raw, timeout=60)
        print(f"wayback snapshot {snap['timestamp']} try {attempt + 1}: {st}, {len(body)} bytes")
        if st == 200:
            break
        time.sleep(10)
    if st != 200:
        print(f"  body {text(body, 200)}")
        return
    s = body.decode("utf-8", "replace")
    m = re.search(r'class="article-body"[^>]*>(.*?)(<footer|<div class="article-footer|<section class="article-relatives)', s, re.S)
    part = m.group(1) if m else s
    part = re.sub(r"<(br|/p|/tr|/li|/h\d)[^>]*>", "\n", part)
    part = re.sub(r"</t[dh]>", " ; ", part)
    part = re.sub(r"<[^>]+>", "", part)
    part = re.sub(r"\n\s*\n+", "\n", part).replace("&nbsp;", " ").replace("&amp;", "&")
    updated = re.findall(r'datetime="([^"]+)"', s)
    print(f"  datetimes in page {updated[:3]}")
    print("  article text:")
    for line in part.strip().splitlines()[:120]:
        print("   ", line.strip()[:300])


def section_ccxt():
    print("== 4. CCXT")
    hits = sorted(p.name for p in CCXT_SRC.glob("*.js") if re.search("ceex", p.name, re.I))
    print(f"CCXT 4.5.68 js/src files matching ceex: {hits} (of {len(list(CCXT_SRC.glob('*.js')))} files)")
    for url in ("https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/ceex.ts", "https://raw.githubusercontent.com/ccxt/ccxt/master/js/src/ceex.js"):
        st, h, body = get(url)
        print(f"{url}: {st}")
    st, h, body = get("https://raw.githubusercontent.com/ccxt/ccxt/master/exchanges.json")
    if st == 200:
        j = json.loads(body)
        ids = j.get("ids") or list(j)
        print(f"master exchanges.json: {len(ids)} ids, ceex present {any('ceex' in str(i).lower() for i in ids)}")
    else:
        print(f"master exchanges.json: {st}")


def main():
    print(f"host UTC {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())}")
    section_levels()
    section_announcements()
    section_fields()
    section_article()
    section_ccxt()


main()
