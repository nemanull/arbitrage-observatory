# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""BitGW fee probe for docs/profiles/bitgw/fees.md.

Public, unauthenticated and read-only, one request a second.
The web app signs every POST with an md5 over the sorted form fields and a client key shipped in its public bundle.
No account, username or token is sent, so every call is the anonymous view any visitor's browser fetches.
Sections, in order:
  article  the help center fee article "Tiered Trading Fee Discount Program", parsed into tiers.
  service  the "service" field of the anonymous marketDetail reply for every listed market, which the trade form multiplies by size over 100.
  scope    the terms of service scope list and the margin trading clause.
Run from the repository root with: uv run scripts/probes/venues/bitgw/fees-probe.py
Captures land in .claude/survey-work/bitgw/.
"""

import collections
import hashlib
import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "bitgw"
WORK.mkdir(parents=True, exist_ok=True)
API = "https://bitgw.com/api/"
CLIENT_KEY = "BCAB2AE64900D83EAC3114768232F868"  # globalData.key in the public web bundle
UA = "arbitrage-observatory-probe/1.0"


def norm(v):
    return str(v).replace(" ", "").replace("\r", "").replace("\n", "").lower()


def call(controller, params):
    p = dict(params)
    p.update(language=0, platform="H5", system_language="en", version="2.1.2",
             timestamp=int(time.time() * 1000), url=controller)
    base = "&".join(f"{norm(k)}={norm(p[k])}" for k in sorted(p)) + "&key=" + CLIENT_KEY
    p["sign"] = hashlib.md5(norm(base).encode()).hexdigest()
    req = urllib.request.Request(API + controller, data=urllib.parse.urlencode(p).encode(), headers={
        "content-type": "application/x-www-form-urlencoded;charset=utf-8", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300]


def text(h):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h or ""))).strip()


def article():
    print("== article")
    status, body = call("home", {"type": "help"})
    (WORK / "help.json").write_text(json.dumps(body))
    arts = body["data"]["article"]
    print(f"help status={status} articles={len(arts)}")
    api = [a["title"] for a in arts if re.search(r"\bAPI\b", a["title"] + " " + text(a["content"]))]
    print(f"articles naming an API in title or body: {len(api)} {api}")
    for a in arts:
        if a["title"].startswith("Tiered Trading Fee Discount Program"):
            t = text(a["content"])
            print(f"article id={a['id']} created={a['created_at']} updated={a['updated_at']}")
            for m in re.finditer(r"(Regular|VIP\d) 30D Trading Volume: (\S+) USD Total Assets: (\S+) USDT "
                                 r"Referral Assets: (\S+) USDT Spot & Swap Fee: ([\d.]+)% AMM Fee: (\d+)%", t):
                ppm = round(float(m.group(5)) * 10000)
                print(f"  tier={m.group(1)} vol={m.group(2)} assets={m.group(3)} referral={m.group(4)} "
                      f"spot_and_swap={m.group(5)}% = {ppm} ppm amm={m.group(6)}%")
            note = re.search(r"Note: [^.]+\.", t)
            print("  note:", note.group(0) if note else None)
            print("  maker or taker named in the article:", bool(re.search(r"maker|taker", t, re.I)))
    for a in arts:
        if a["title"].startswith(("BitGW Launches Zero Trading Fee", "Swap Feature FAQ")):
            t = text(a["content"])
            print(f"article id={a['id']} title={a['title']!r} updated={a['updated_at']}: {t[:400]}")


def service():
    print("== service")
    status, body = call("home", {"type": "marketInit"})
    markets = body["data"]
    print(f"marketInit status={status} markets={len(markets)}")
    rates, selfrun, rows = collections.Counter(), collections.Counter(), []
    for m in markets:
        st, d = call("home", {"type": "marketDetail", "id": m["id"]})
        if st != 200 or not isinstance(d, dict) or d.get("code") != 200:
            print(f"  {m['key']} status={st} body={str(d)[:200]}")
            continue
        cur = d["data"]["currency"]
        rates[d["data"]["service"]] += 1
        selfrun[cur.get("is_self")] += 1
        rows.append({"key": cur["key"], "id": cur["id"], "service": d["data"]["service"], "is_self": cur.get("is_self"),
                     "status": cur.get("status"), "is_exchange": cur.get("is_exchange"), "trade_limit": cur.get("trade_limit"),
                     "to_fixed": cur.get("to_fixed"), "fixed": d["data"].get("fixed")})
        time.sleep(1.0)
    (WORK / "fees-service.json").write_text(json.dumps(rows, indent=1))
    print(f"service values over {len(rows)} markets: {dict(rates)}")
    print(f"is_self values: {dict(selfrun)}")
    print(f"status values: {dict(collections.Counter(r['status'] for r in rows))}")
    print(f"is_exchange values: {dict(collections.Counter(r['is_exchange'] for r in rows))}")
    print(f"trade_limit examples: {[(r['key'], r['trade_limit']) for r in rows[:3]]}")
    for r, n in rates.items():
        print(f"  service {r} % = {round(float(r) * 10000)} ppm on {n} markets")


def label():
    print("== label")
    js = (WORK / "bundle" / "index.js")
    if not js.exists():
        print("bundle not cached, run endpoints-probe.py first")
        return
    for m in re.finditer(r'"grade\.new\.title5":"([^"]+)"', js.read_text(errors="replace")):
        print("VIP page fee label:", m.group(1))


def scope():
    print("== scope")
    status, body = call("home", {"type": "more"})
    rules = text(body["data"]["user_rules"])
    s = rules.find("1. Scope of Services")
    print("scope:", rules[s:s + 560])
    m = rules.find("5. Margin Trading")
    print("margin clause:", rules[m:m + 300])
    f = rules.find("8. Fees and Credits")
    print("fees clause:", rules[f:f + 200])
    print("about:", text(body["data"]["about"]))
    print("switches:", {k: body["data"][k] for k in ("otcSwitch", "financingSwitch", "AMMSwitch", "InvitationSwitch")})


if __name__ == "__main__":
    print("run at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    article()
    scope()
    label()
    service()
